//! Copie dello stesso repository su piu' macchine, sincronizzate via git
//! (R-MI-26, R-MI-27, R-MI-28).
//!
//! Ogni macchina scrive solo sul proprio repository: dall'altra legge le cime
//! delle branch e un pacchetto git con i commit che le mancano, li tiene in
//! `refs/studio/<macchina>/heads/*` e da li' decide se e' allineata, indietro,
//! avanti o divergente. La copia indietro avanza soltanto con un fast-forward,
//! a cartella pulita e ferma. Le modifiche non committate non viaggiano mai da
//! sole: si spostano con un'istantanea esplicita quando si cambia macchina.
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};

use crate::link::{call_peer, PeerBody};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Il collegamento porta al massimo 64 MB per risposta: un pacchetto piu'
/// grande (prima sincronizzazione di una storia lunga) si rifiuta con un
/// messaggio che indica `origin` come strada.
const MAX_BUNDLE: usize = 60 * 1024 * 1024;
/// Tetto ai commit dichiarati come gia' presenti: bastano le cime delle branch.
const MAX_HAVES: usize = 2000;
const STUDIO_IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "OMP Studio"),
    ("GIT_AUTHOR_EMAIL", "studio@omp.local"),
    ("GIT_COMMITTER_NAME", "OMP Studio"),
    ("GIT_COMMITTER_EMAIL", "studio@omp.local"),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchHead {
    pub name: String,
    pub commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyHeads {
    pub branches: Vec<BranchHead>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BranchState {
    /// Stesso commit sulle due copie.
    Equal,
    /// Questa copia ha commit che l'altra non ha: sara' l'altra a leggerli.
    Ahead,
    /// Entrambe hanno commit propri: nessun fast-forward possibile (R-MI-22).
    Diverged,
    /// Era indietro ed e' avanzata con un fast-forward (R-MI-27).
    Advanced,
    /// E' indietro ma non si puo' avanzare ora: `reason` dice perche'.
    Pending,
    /// La branch esiste solo sull'altra macchina: non si crea da sola.
    OnlyPeer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSync {
    pub name: String,
    pub local: Option<String>,
    pub peer: String,
    /// Commit solo di questa copia.
    pub ahead: u32,
    /// Commit solo dell'altra.
    pub behind: u32,
    pub state: BranchState,
    /// Per `Pending`: `busy` (agente, editor o automazione), `dirty`
    /// (modifiche non committate), oppure il messaggio di git.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySyncReport {
    pub machine: String,
    pub branches: Vec<BranchSync>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WipSnapshot {
    pub id: String,
    pub commit: String,
    pub base: String,
    pub branch: String,
    pub files: u32,
}

// ── git ────────────────────────────────────────────────────────────────────

fn git_raw(dir: &Path, args: &[&str], env: &[(&str, &str)], stdin: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir).args(args).envs(env.iter().copied())
        .env("LC_ALL", "C").env("LANGUAGE", "C").env("GIT_TERMINAL_PROMPT", "0")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|error| format!("git {}: {error}", args.join(" ")))?;
    if let Some(input) = stdin {
        // Scrittura in un thread: con molti dati git potrebbe riempire stdout
        // prima di aver letto tutto stdin.
        let mut pipe = child.stdin.take().ok_or("git stdin unavailable")?;
        let input = input.to_vec();
        std::thread::spawn(move || { let _ = pipe.write_all(&input); });
    }
    let out = child.wait_with_output().map_err(|error| error.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() { format!("git {} failed", args.join(" ")) } else { stderr });
    }
    Ok(out.stdout)
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    git_raw(dir, args, &[], None).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

fn has_commit(dir: &Path, commit: &str) -> bool {
    git(dir, &["cat-file", "-e", &format!("{commit}^{{commit}}")]).is_ok()
}

fn is_hash(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Nomi di branch che arrivano dall'altra macchina: niente che git possa
/// leggere come opzione, intervallo o refspec.
fn valid_branch(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && !name.starts_with('/') && !name.ends_with('/')
        && !name.ends_with(".lock") && !name.contains("..") && !name.contains("//") && !name.contains("@{")
        && !name.chars().any(|c| c.is_control() || matches!(c, ' ' | ':' | '^' | '~' | '?' | '*' | '[' | '\\'))
}

fn valid_wip_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// L'id della macchina diventa un pezzo di nome di riferimento.
fn machine_key(machine: &str) -> String {
    machine.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

fn tracking_prefix(machine: &str) -> String {
    format!("refs/studio/{}/heads/", machine_key(machine))
}

fn heads(dir: &Path) -> Result<Vec<BranchHead>, String> {
    let raw = git(dir, &["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"])?;
    Ok(raw.lines().filter_map(|line| {
        let (commit, name) = line.split_once(' ')?;
        let name = name.strip_prefix("refs/heads/")?;
        Some(BranchHead { name: name.to_owned(), commit: commit.to_owned() })
    }).collect())
}

/// Quali di questi hash sono commit presenti qui: un solo processo git.
fn known_commits(dir: &Path, shas: &[&str]) -> Result<HashSet<String>, String> {
    let candidates: Vec<&&str> = shas.iter().filter(|sha| is_hash(sha)).collect();
    if candidates.is_empty() { return Ok(HashSet::new()); }
    let input = candidates.iter().map(|sha| format!("{sha}\n")).collect::<String>();
    let out = git_raw(dir, &["cat-file", "--batch-check=%(objectname) %(objecttype)"], &[], Some(input.as_bytes()))?;
    Ok(String::from_utf8_lossy(&out).lines()
        .filter_map(|line| line.strip_suffix(" commit").map(str::to_owned))
        .collect())
}

/// Cime che questa copia ha gia': l'altra le esclude dal pacchetto.
fn local_tips(dir: &Path) -> Result<Vec<String>, String> {
    let raw = git(dir, &["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/remotes", "refs/studio", "refs/tags"])?;
    let mut seen = HashSet::new();
    Ok(raw.lines().filter(|sha| is_hash(sha) && seen.insert(sha.to_string())).take(MAX_HAVES).map(str::to_owned).collect())
}

fn create_bundle(dir: &Path, refs: &[String], haves: &[String]) -> Result<Vec<u8>, String> {
    for name in refs {
        let allowed = name.strip_prefix("refs/heads/").is_some_and(valid_branch)
            || name.strip_prefix("refs/studio/wip/").is_some_and(valid_wip_id);
        if !allowed { return Err(format!("Riferimento non sincronizzabile: {name}")); }
    }
    if refs.is_empty() { return Err("Nessun riferimento richiesto".into()); }
    // Si escludono solo i commit che questa copia conosce: un hash ignoto
    // farebbe fallire `bundle create`.
    let candidates: Vec<&str> = haves.iter().map(String::as_str).take(MAX_HAVES).collect();
    let known = known_commits(dir, &candidates)?;
    let file = TempPath::new(".bundle");
    let path = file.0.to_string_lossy().to_string();
    let mut input = refs.join("\n");
    for sha in &known { input.push_str(&format!("\n^{sha}")); }
    input.push('\n');
    git_raw(dir, &["bundle", "create", "--quiet", &path, "--stdin"], &[], Some(input.as_bytes()))?;
    let bytes = std::fs::read(&file.0).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_BUNDLE {
        return Err(crate::tr!(
            "Troppi commit da trasferire fra le macchine in una volta: allinea le copie una volta tramite origin (push e pull), poi la sincronizzazione continua da sola",
            "Too many commits to transfer between machines at once: align the copies once through origin (push and pull), then syncing continues on its own"
        ).to_string());
    }
    Ok(bytes)
}

fn fetch_bundle(dir: &Path, bundle: &[u8], refspecs: &[String]) -> Result<(), String> {
    let file = TempPath::new(".bundle");
    std::fs::write(&file.0, bundle).map_err(|error| error.to_string())?;
    let path = file.0.to_string_lossy().to_string();
    let mut args = vec!["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", path.as_str()];
    args.extend(refspecs.iter().map(String::as_str));
    git(dir, &args).map(|_| ())
}

/// File o cartella temporanea che sparisce col valore. Il nome non esiste
/// ancora: git lo crea (pacchetti, indici).
struct TempPath(PathBuf);
impl TempPath {
    fn new(suffix: &str) -> Self {
        Self(std::env::temp_dir().join(format!("studio-copy-{}{suffix}", uuid::Uuid::new_v4().simple())))
    }
}
impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = if self.0.is_dir() { std::fs::remove_dir_all(&self.0) } else { std::fs::remove_file(&self.0) };
    }
}

/// Cartella in cui ogni branch e' in uso (progetto principale e worktree delle corsie).
fn checked_out(dir: &Path) -> Result<HashMap<String, PathBuf>, String> {
    let raw = git(dir, &["worktree", "list", "--porcelain"])?;
    let mut map = HashMap::new();
    let mut current: Option<PathBuf> = None;
    for line in raw.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current = Some(PathBuf::from(path));
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if let Some(path) = current.clone() { map.insert(branch.to_owned(), path); }
        }
    }
    Ok(map)
}

fn same_path(a: &Path, b: &str) -> bool {
    let canonical = |path: &str| crate::projects::canonical_project_base(path).ok();
    match (canonical(&a.to_string_lossy()), canonical(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

fn counts(dir: &Path, local: &str, peer: &str) -> Result<(u32, u32), String> {
    let raw = git(dir, &["rev-list", "--left-right", "--count", &format!("{local}...{peer}")])?;
    let mut parts = raw.split_whitespace().map(|value| value.parse::<u32>().unwrap_or(0));
    Ok((parts.next().unwrap_or(0), parts.next().unwrap_or(0)))
}

/// Porta i riferimenti di tracciamento sulle cime dell'altra macchina e
/// decide per ogni branch. `busy` sono le cartelle in cui un agente lavora,
/// l'editor ha file non salvati o un'automazione e' attiva.
fn reconcile(dir: &Path, machine: &str, peer: &[BranchHead], busy: &[String]) -> Result<Vec<BranchSync>, String> {
    let prefix = tracking_prefix(machine);
    let peer_names: HashSet<&str> = peer.iter().map(|head| head.name.as_str()).collect();
    // Le branch sparite dall'altra macchina non restano a far numero; quelle
    // invariate non si riscrivono a ogni giro.
    let raw = git(dir, &["for-each-ref", "--format=%(objectname) %(refname)", prefix.trim_end_matches('/')])?;
    let mut tracked = HashMap::new();
    for line in raw.lines() {
        let Some((commit, name)) = line.split_once(' ') else { continue };
        let Some(branch) = name.strip_prefix(&prefix) else { continue };
        if peer_names.contains(branch) {
            tracked.insert(branch.to_owned(), commit.to_owned());
        } else {
            git(dir, &["update-ref", "-d", name])?;
        }
    }
    let local: HashMap<String, String> = heads(dir)?.into_iter().map(|head| (head.name, head.commit)).collect();
    let worktrees = checked_out(dir)?;
    let mut result = Vec::new();
    for head in peer {
        if tracked.get(&head.name) != Some(&head.commit) {
            git(dir, &["update-ref", &format!("{prefix}{}", head.name), &head.commit])?;
        }
        let Some(mine) = local.get(&head.name) else {
            result.push(BranchSync { name: head.name.clone(), local: None, peer: head.commit.clone(), ahead: 0, behind: 0, state: BranchState::OnlyPeer, reason: None });
            continue;
        };
        let mut entry = BranchSync { name: head.name.clone(), local: Some(mine.clone()), peer: head.commit.clone(), ahead: 0, behind: 0, state: BranchState::Equal, reason: None };
        if *mine != head.commit {
            let (ahead, behind) = counts(dir, mine, &head.commit)?;
            entry.ahead = ahead;
            entry.behind = behind;
            entry.state = if behind == 0 {
                BranchState::Ahead
            } else if ahead > 0 {
                BranchState::Diverged
            } else {
                match advance(dir, &head.name, mine, &head.commit, worktrees.get(&head.name), busy) {
                    Ok(()) => BranchState::Advanced,
                    Err(reason) => { entry.reason = Some(reason); BranchState::Pending }
                }
            };
        }
        result.push(entry);
    }
    Ok(result)
}

/// Solo fast-forward (R-MI-27): mai merge, rebase o reset.
fn advance(dir: &Path, branch: &str, from: &str, to: &str, worktree: Option<&PathBuf>, busy: &[String]) -> Result<(), String> {
    let Some(worktree) = worktree else {
        // Branch non in uso: si sposta il riferimento, solo se nessuno l'ha
        // mossa nel frattempo.
        return git(dir, &["update-ref", &format!("refs/heads/{branch}"), to, from]).map(|_| ());
    };
    let path = worktree.to_string_lossy().to_string();
    if busy.iter().any(|candidate| same_path(worktree, candidate)) || crate::automations::is_project_locked(&path, None) {
        return Err("busy".into());
    }
    if !git(worktree, &["status", "--porcelain"])?.is_empty() { return Err("dirty".into()); }
    git(worktree, &["merge", "--ff-only", "--quiet", to]).map(|_| ())
}

// ── istantanea delle modifiche non committate (R-MI-28) ────────────────────

/// Albero di cartella e indice cosi' come sono, file nuovi compresi, senza
/// toccare l'indice vero: si lavora su un indice temporaneo.
fn worktree_tree(dir: &Path) -> Result<String, String> {
    // Percorso non ancora esistente: un file vuoto sarebbe un indice corrotto.
    let index = TempPath::new(".index");
    let index_path = index.0.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", index_path.as_str())];
    git_raw(dir, &["read-tree", "HEAD"], &env, None)?;
    git_raw(dir, &["add", "-A"], &env, None)?;
    git_raw(dir, &["write-tree"], &env, None).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

fn snapshot(dir: &Path) -> Result<WipSnapshot, String> {
    let branch = git(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).map_err(|_| crate::tr!(
        "La copia non è su una branch: niente da portare",
        "The copy is not on a branch: nothing to move"
    ).to_string())?;
    let base = git(dir, &["rev-parse", "HEAD"])?;
    let tree = worktree_tree(dir)?;
    if tree == git(dir, &["rev-parse", "HEAD^{tree}"])? {
        return Err(crate::tr!("Nessuna modifica da portare", "No changes to move").to_string());
    }
    let files = git(dir, &["diff-tree", "-r", "--name-only", &base, &tree])?.lines().count() as u32;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let message = format!("OMP Studio: modifiche non committate ({id})");
    let commit = String::from_utf8_lossy(&git_raw(dir, &["commit-tree", &tree, "-p", &base, "-m", &message], &STUDIO_IDENTITY, None)?).trim().to_string();
    git(dir, &["update-ref", &format!("refs/studio/wip/{id}"), &commit])?;
    Ok(WipSnapshot { id, commit, base, branch, files })
}

/// Applica l'istantanea sulla copia di arrivo, che deve essere sul commit di
/// partenza e pulita: il risultato sono le stesse modifiche, non in stage.
fn apply_snapshot(dir: &Path, base: &str, commit: &str) -> Result<(), String> {
    if git(dir, &["rev-parse", "HEAD"])? != base {
        return Err(crate::tr!(
            "La copia di arrivo non è sullo stesso commit di quella di partenza: deve prima allinearsi",
            "The target copy is not on the same commit as the source: it must align first"
        ).to_string());
    }
    if !git(dir, &["status", "--porcelain"])?.is_empty() {
        return Err(crate::tr!(
            "La copia di arrivo ha modifiche non committate",
            "The target copy has uncommitted changes"
        ).to_string());
    }
    if git(dir, &["rev-parse", &format!("{commit}^")])? != base {
        return Err("Istantanea non basata sul commit indicato".into());
    }
    git(dir, &["read-tree", "-m", "-u", "HEAD", commit])?;
    git(dir, &["reset", "--quiet"]).map(|_| ())
}

/// Pulisce la copia di partenza dopo la conferma dell'arrivo, solo se e'
/// ancora come nell'istantanea. Le modifiche finiscono nello stash, quindi
/// restano recuperabili anche qui.
fn finish_snapshot(dir: &Path, id: &str) -> Result<(), String> {
    let commit = git(dir, &["rev-parse", "--verify", &format!("refs/studio/wip/{id}")])?;
    if worktree_tree(dir)? != git(dir, &["rev-parse", &format!("{commit}^{{tree}}")])? {
        return Err(crate::tr!(
            "La copia di partenza è cambiata dopo l'istantanea: non la pulisco",
            "The source copy changed after the snapshot: leaving it untouched"
        ).to_string());
    }
    git_raw(dir, &["stash", "push", "--include-untracked", "--quiet", "-m", &format!("OMP Studio: modifiche portate su un'altra macchina ({id})")], &STUDIO_IDENTITY, None).map(|_| ())
}

// ── comandi ────────────────────────────────────────────────────────────────

static SYNCING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Una sincronizzazione alla volta per repository: il giro successivo trova
/// lo stato aggiornato.
struct SyncGuard(String);
impl SyncGuard {
    fn acquire(path: &str) -> Result<Self, String> {
        let mut set = SYNCING.lock().map_err(|_| "sync lock poisoned")?;
        if !set.insert(path.to_owned()) { return Err("sync already running".into()); }
        Ok(Self(path.to_owned()))
    }
}
impl Drop for SyncGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = SYNCING.lock() { set.remove(&self.0); }
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

/// Pacchetto con i commit mancanti di `refs` letti dall'altra macchina e
/// importati con `refspecs`.
async fn fetch_from_peer(app: &tauri::AppHandle, dir: PathBuf, machine: &str, peer_path: &str, refs: Vec<String>, refspecs: Vec<String>) -> Result<(), String> {
    let haves = { let dir = dir.clone(); blocking(move || local_tips(&dir)).await? };
    let args = json!({ "projectPath": peer_path, "refs": refs, "haves": haves });
    let PeerBody::Raw(bundle) = call_peer(app, machine, "copy_sync_bundle", &args).await? else {
        return Err("Unexpected bundle response".into());
    };
    blocking(move || fetch_bundle(&dir, &bundle, &refspecs)).await
}

#[tauri::command]
pub async fn copy_sync_heads(project_path: String) -> Result<CopyHeads, String> {
    blocking(move || heads(Path::new(&project_path)).map(|branches| CopyHeads { branches })).await
}

#[tauri::command]
pub async fn copy_sync_bundle(project_path: String, refs: Vec<String>, haves: Vec<String>) -> Result<tauri::ipc::Response, String> {
    blocking(move || create_bundle(Path::new(&project_path), &refs, &haves)).await.map(tauri::ipc::Response::new)
}

/// Allinea questa copia a quella di `machine` (R-MI-26, R-MI-27).
#[tauri::command]
pub async fn copy_sync(app: tauri::AppHandle, project_path: String, machine: String, peer_path: String, busy_paths: Vec<String>) -> Result<CopySyncReport, String> {
    let _guard = SyncGuard::acquire(&project_path)?;
    let dir = PathBuf::from(&project_path);
    let PeerBody::Json(value) = call_peer(&app, &machine, "copy_sync_heads", &json!({ "projectPath": peer_path })).await? else {
        return Err("Unexpected heads response".into());
    };
    let peer: CopyHeads = serde_json::from_value(value).map_err(|error| error.to_string())?;
    let branches: Vec<BranchHead> = peer.branches.into_iter().filter(|head| valid_branch(&head.name) && is_hash(&head.commit)).collect();
    let known = {
        let dir = dir.clone();
        let shas: Vec<String> = branches.iter().map(|head| head.commit.clone()).collect();
        blocking(move || known_commits(&dir, &shas.iter().map(String::as_str).collect::<Vec<_>>())).await?
    };
    let missing: Vec<&BranchHead> = branches.iter().filter(|head| !known.contains(&head.commit)).collect();
    if !missing.is_empty() {
        let prefix = tracking_prefix(&machine);
        let refs = missing.iter().map(|head| format!("refs/heads/{}", head.name)).collect();
        let refspecs = missing.iter().map(|head| format!("+refs/heads/{0}:{prefix}{0}", head.name)).collect();
        fetch_from_peer(&app, dir.clone(), &machine, &peer_path, refs, refspecs).await?;
    }
    let report_machine = machine.clone();
    blocking(move || {
        // Una cima che il pacchetto non ha portato (branch spostata nel
        // frattempo) si salta: la vedra' il giro successivo.
        let shas: Vec<&str> = branches.iter().map(|head| head.commit.as_str()).collect();
        let known = known_commits(&dir, &shas)?;
        let present: Vec<BranchHead> = branches.into_iter().filter(|head| known.contains(&head.commit)).collect();
        reconcile(&dir, &machine, &present, &busy_paths).map(|branches| CopySyncReport { machine: report_machine, branches })
    }).await
}

#[tauri::command]
pub async fn copy_wip_snapshot(project_path: String) -> Result<WipSnapshot, String> {
    blocking(move || snapshot(Path::new(&project_path))).await
}

/// Riceve l'istantanea `id` dalla copia di `machine` e la applica qui (R-MI-28).
#[tauri::command]
pub async fn copy_wip_receive(app: tauri::AppHandle, project_path: String, machine: String, peer_path: String, id: String, base: String, commit: String) -> Result<(), String> {
    if !valid_wip_id(&id) || !is_hash(&base) || !is_hash(&commit) { return Err("Invalid snapshot".into()); }
    let dir = PathBuf::from(&project_path);
    let reference = format!("refs/studio/wip/{id}");
    let present = { let (dir, commit) = (dir.clone(), commit.clone()); blocking(move || Ok(has_commit(&dir, &commit))).await? };
    if present {
        let (dir, reference, commit) = (dir.clone(), reference.clone(), commit.clone());
        blocking(move || git(&dir, &["update-ref", &reference, &commit]).map(|_| ())).await?;
    } else {
        fetch_from_peer(&app, dir.clone(), &machine, &peer_path, vec![reference.clone()], vec![format!("+{reference}:{reference}")]).await?;
    }
    blocking(move || {
        if git(&dir, &["rev-parse", "--verify", &reference])? != commit { return Err("Snapshot mismatch".into()); }
        apply_snapshot(&dir, &base, &commit)
    }).await
}

#[tauri::command]
pub async fn copy_wip_finish(project_path: String, id: String) -> Result<(), String> {
    if !valid_wip_id(&id) { return Err("Invalid snapshot".into()); }
    blocking(move || finish_snapshot(Path::new(&project_path), &id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").current_dir(dir).args(args).envs(STUDIO_IDENTITY).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, file: &str, content: &str) -> String {
        std::fs::write(dir.join(file), content).unwrap();
        run(dir, &["add", "-A"]);
        run(dir, &["commit", "-q", "-m", file]);
        run(dir, &["rev-parse", "HEAD"])
    }

    /// Due copie dello stesso repository, senza origin: come due macchine.
    fn pair() -> (TempPath, PathBuf, PathBuf) {
        let root = TempPath::new("");
        std::fs::create_dir_all(&root.0).unwrap();
        let root_path = root.0.clone();
        let mac = root_path.join("mac");
        let win = root_path.join("win");
        std::fs::create_dir_all(&mac).unwrap();
        run(&mac, &["init", "-q", "-b", "main"]);
        commit(&mac, "a.txt", "a");
        run(&root_path, &["clone", "-q", mac.to_str().unwrap(), win.to_str().unwrap()]);
        run(&win, &["remote", "remove", "origin"]);
        (root, mac, win)
    }

    /// Un giro di sincronizzazione di `win` verso `mac`, senza collegamento.
    fn sync(win: &Path, mac: &Path, busy: &[String]) -> Vec<BranchSync> {
        let peer = heads(mac).unwrap();
        let missing: Vec<&BranchHead> = peer.iter().filter(|head| !has_commit(win, &head.commit)).collect();
        if !missing.is_empty() {
            let refs: Vec<String> = missing.iter().map(|head| format!("refs/heads/{}", head.name)).collect();
            let bundle = create_bundle(mac, &refs, &local_tips(win).unwrap()).unwrap();
            let specs: Vec<String> = missing.iter().map(|head| format!("+refs/heads/{0}:{1}{0}", head.name, tracking_prefix("mac"))).collect();
            fetch_bundle(win, &bundle, &specs).unwrap();
        }
        reconcile(win, "mac", &peer, busy).unwrap()
    }

    #[test]
    fn a_copy_that_is_only_behind_fast_forwards_without_origin() {
        let (_root, mac, win) = pair();
        let head = commit(&mac, "b.txt", "b");
        let report = sync(&win, &mac, &[]);
        assert_eq!(report[0].state, BranchState::Advanced);
        assert_eq!(report[0].behind, 1);
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), head);
        assert_eq!(std::fs::read_to_string(win.join("b.txt")).unwrap(), "b");
        assert_eq!(run(&win, &["rev-parse", "refs/studio/mac/heads/main"]), head);
        // Un secondo giro trova le copie allineate e non chiede pacchetti.
        assert_eq!(sync(&win, &mac, &[])[0].state, BranchState::Equal);
    }

    #[test]
    fn a_dirty_or_busy_copy_waits_instead_of_moving() {
        let (_root, mac, win) = pair();
        commit(&mac, "b.txt", "b");
        std::fs::write(win.join("a.txt"), "edited").unwrap();
        let report = sync(&win, &mac, &[]);
        assert_eq!((report[0].state, report[0].reason.as_deref()), (BranchState::Pending, Some("dirty")));
        assert_eq!(std::fs::read_to_string(win.join("a.txt")).unwrap(), "edited");

        run(&win, &["checkout", "-q", "--", "a.txt"]);
        let report = sync(&win, &mac, &[win.to_string_lossy().to_string()]);
        assert_eq!((report[0].state, report[0].reason.as_deref()), (BranchState::Pending, Some("busy")));
        assert_eq!(sync(&win, &mac, &[])[0].state, BranchState::Advanced);
    }

    #[test]
    fn commits_on_both_copies_diverge_and_nothing_moves() {
        let (_root, mac, win) = pair();
        commit(&mac, "b.txt", "b");
        let mine = commit(&win, "c.txt", "c");
        let report = sync(&win, &mac, &[]);
        assert_eq!((report[0].state, report[0].ahead, report[0].behind), (BranchState::Diverged, 1, 1));
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), mine);
    }

    #[test]
    fn a_branch_not_in_use_moves_and_peer_only_branches_are_not_created() {
        let (_root, mac, win) = pair();
        run(&mac, &["branch", "feature"]);
        run(&win, &["branch", "feature"]);
        run(&mac, &["checkout", "-q", "feature"]);
        let head = commit(&mac, "f.txt", "f");
        run(&mac, &["branch", "only-mac"]);
        let report = sync(&win, &mac, &[]);
        let state = |name: &str| report.iter().find(|branch| branch.name == name).unwrap().state;
        assert_eq!(state("feature"), BranchState::Advanced);
        assert_eq!(state("only-mac"), BranchState::OnlyPeer);
        assert_eq!(run(&win, &["rev-parse", "refs/heads/feature"]), head);
        assert!(git(&win, &["rev-parse", "--verify", "refs/heads/only-mac"]).is_err());
    }

    #[test]
    fn a_lane_worktree_advances_in_its_own_folder_only_when_clean() {
        let (root, mac, win) = pair();
        run(&mac, &["branch", "lane"]);
        let lane = root.0.join("win-lane");
        run(&win, &["worktree", "add", "-q", "-b", "lane", lane.to_str().unwrap()]);
        run(&mac, &["checkout", "-q", "lane"]);
        let head = commit(&mac, "l.txt", "l");
        std::fs::write(lane.join("scratch.txt"), "wip").unwrap();
        let state = |report: &[BranchSync]| report.iter().find(|branch| branch.name == "lane").map(|branch| (branch.state, branch.reason.clone())).unwrap();
        assert_eq!(state(&sync(&win, &mac, &[])), (BranchState::Pending, Some("dirty".into())));
        std::fs::remove_file(lane.join("scratch.txt")).unwrap();
        assert_eq!(state(&sync(&win, &mac, &[])).0, BranchState::Advanced);
        assert_eq!(run(&lane, &["rev-parse", "HEAD"]), head);
        assert!(lane.join("l.txt").exists());
    }

    #[test]
    fn a_win_ahead_of_mac_waits_for_mac_to_read() {
        let (_root, mac, win) = pair();
        commit(&win, "c.txt", "c");
        assert_eq!(sync(&win, &mac, &[])[0].state, BranchState::Ahead);
    }

    #[test]
    fn uncommitted_changes_move_with_a_snapshot_and_the_source_keeps_them_in_the_stash() {
        let (_root, mac, win) = pair();
        commit(&mac, "gone.txt", "x");
        sync(&win, &mac, &[]);
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        std::fs::write(mac.join("new.txt"), "new").unwrap();
        std::fs::remove_file(mac.join("gone.txt")).unwrap();

        let snap = snapshot(&mac).unwrap();
        assert_eq!((snap.branch.as_str(), snap.files), ("main", 3));
        let reference = format!("refs/studio/wip/{}", snap.id);
        let bundle = create_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap();
        fetch_bundle(&win, &bundle, &[format!("+{reference}:{reference}")]).unwrap();
        apply_snapshot(&win, &snap.base, &snap.commit).unwrap();
        assert_eq!(std::fs::read_to_string(win.join("a.txt")).unwrap(), "changed");
        assert_eq!(std::fs::read_to_string(win.join("new.txt")).unwrap(), "new");
        assert!(!win.join("gone.txt").exists());
        assert_eq!(run(&win, &["diff", "--cached", "--name-only"]), "", "nothing staged");

        finish_snapshot(&mac, &snap.id).unwrap();
        assert_eq!(run(&mac, &["status", "--porcelain"]), "");
        assert!(run(&mac, &["stash", "list"]).contains(&snap.id));
    }

    #[test]
    fn the_source_is_not_cleaned_if_it_changed_after_the_snapshot() {
        let (_root, mac, _win) = pair();
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        let snap = snapshot(&mac).unwrap();
        std::fs::write(mac.join("a.txt"), "changed again").unwrap();
        assert!(finish_snapshot(&mac, &snap.id).is_err());
        assert_eq!(std::fs::read_to_string(mac.join("a.txt")).unwrap(), "changed again");
    }

    #[test]
    fn a_snapshot_never_lands_on_a_copy_with_other_changes_or_another_commit() {
        let (_root, mac, win) = pair();
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        let snap = snapshot(&mac).unwrap();
        let reference = format!("refs/studio/wip/{}", snap.id);
        let bundle = create_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap();
        fetch_bundle(&win, &bundle, &[format!("+{reference}:{reference}")]).unwrap();
        std::fs::write(win.join("mine.txt"), "mine").unwrap();
        assert!(apply_snapshot(&win, &snap.base, &snap.commit).is_err());
        std::fs::remove_file(win.join("mine.txt")).unwrap();
        commit(&win, "other.txt", "o");
        assert!(apply_snapshot(&win, &snap.base, &snap.commit).is_err());
    }

    #[test]
    fn names_from_the_other_machine_cannot_smuggle_options_or_refspecs() {
        for bad in ["-x", "a..b", "a:b", "a b", "x^", "@{1}", "a/", "/a", "a.lock"] {
            assert!(!valid_branch(bad), "{bad}");
        }
        assert!(valid_branch("feature/copy-sync"));
        assert!(create_bundle(Path::new("."), &["refs/tags/v1".into()], &[]).is_err());
    }
}
