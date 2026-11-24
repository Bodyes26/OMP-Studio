//! Copie dello stesso repository su piu' macchine, sincronizzate via git
//! (R-MI-26, R-MI-27, R-MI-28).
//!
//! Ogni macchina scrive solo sul proprio repository: dall'altra legge le cime
//! delle branch e un pacchetto git con i commit che le mancano, li tiene in
//! `refs/studio/<macchina>/heads/*` e da li' decide se e' allineata, indietro,
//! avanti o divergente. La copia indietro avanza con un fast-forward anche con
//! modifiche non committate, purche' i commit in arrivo non tocchino i file
//! sporchi; se li toccano si mettono da parte con un'istantanea e si
//! riapplicano (R-MI-47). Le modifiche non committate non viaggiano mai da
//! sole fra le macchine: si spostano con un'istantanea esplicita quando si
//! cambia macchina. Se la divergenza riguarda solo `docs/diario/`, la macchina
//! con id minore unisce le due storie con l'unione per righe (R-MI-48).
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use crate::link::{call_peer, call_peer_with_timeout, PeerBody};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Limite di sicurezza per un pacchetto (R-MI-33). Il trasferimento va a
/// pezzi, quindi non serve piu' il tetto di 60 MB imposto dalla singola
/// risposta da 64 MB del collegamento. Resta un tetto alto per non lasciare
/// riempire il disco temporaneo con un pacchetto corrotto o malintenzionato:
/// 2 GiB coprono comodamente anche i file da 200 MB dell'accettazione.
const MAX_BUNDLE: usize = 2 * 1024 * 1024 * 1024;
/// Dimensione di un pezzo: abbastanza piccola da stare sotto il corpo di
/// 64 MB del collegamento e da rientrare nei timeout di una chiamata,
/// abbastanza grande da non moltiplicare i giri su un relay lento.
const BUNDLE_CHUNK_SIZE: usize = 16 * 1024 * 1024;
/// Quanto resta leggibile un pacchetto aperto in attesa dei pezzi.
const BUNDLE_EXPIRY: std::time::Duration = std::time::Duration::from_secs(600);
/// Quanti pacchetti aperti si tengono su disco e in memoria: oltre si butta
/// il piu' vecchio, che un ricevente caduto ricrea da capo.
const MAX_OPEN_BUNDLES: usize = 8;
/// Tetto ai commit dichiarati come gia' presenti: bastano le cime delle branch.
const MAX_HAVES: usize = 2000;
/// Tempo concesso a un pacchetto: fino a `MAX_BUNDLE` su un relay lento
/// (l'ufficio misurava ~50 Mbit/s, ma i relay condivisi scendono molto sotto)
/// i 300 s generici delle chiamate non bastavano (B3).
const BUNDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(900);
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
    /// Era divergente solo sul diario e questa macchina ha unito le due
    /// storie con l'unione per righe (R-MI-48). `behind` sono i commit
    /// arrivati dall'altra copia.
    MergedJournal,
    /// E' indietro ma non si puo' avanzare ora: `reason` dice perche'.
    Pending,
    /// La branch esiste solo sull'altra macchina: non si crea da sola.
    OnlyPeer,
    /// Il nome differisce solo per maiuscole da un'altra branch (dell'altra
    /// macchina o di questa): su macOS e Windows i due riferimenti sarebbero
    /// lo stesso file, quindi non si sincronizza e si segnala (R-MI-35).
    /// `reason` porta il nome dell'altra branch.
    CaseConflict,
}

/// Pacchetto pronto sull'altra macchina, da leggere a pezzi (R-MI-33).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleTicket {
    pub id: String,
    pub size: u64,
    pub sha256: String,
}

/// Quanto pesa lo spostamento delle modifiche non committate (R-MI-33).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WipEstimate {
    pub files: u32,
    pub bytes: u64,
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
    /// Per `Pending`: `busy` (agente, editor o automazione),
    /// `conflict:<file>[,<file>…]` (le modifiche locali non si riapplicano sui
    /// commit in arrivo, R-MI-47), `journalPeer` (il diario divergente lo
    /// unisce l'altra macchina, R-MI-48), oppure il messaggio di git. Il
    /// vecchio `dirty` non esiste piu': i file sporchi che i commit in arrivo
    /// non toccano non fermano piu' l'avanzamento.
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

/// Esegue git per le operazioni delle copie con configurazione deterministica
/// fra Windows e macOS (M5): `core.autocrlf=false` e `core.filemode=false`
/// valgono solo per questo processo, cosi' istantanee e confronti non dipendono
/// dalla configurazione dell'utente e non la modificano. Le istantanee
/// devono memorizzare gli stessi blob sulle due macchine, e `git status`
/// dell'utente resta governato dalla sua configurazione.
fn git_raw(dir: &Path, args: &[&str], env: &[(&str, &str)], stdin: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.autocrlf=false", "-c", "core.filemode=false"])
        .current_dir(dir).args(args).envs(env.iter().copied())
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
    let out = child.wait_with_output().map_err(|error| explain_disk_full(error.to_string()))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(explain_disk_full(if stderr.is_empty() { format!("git {} failed", args.join(" ")) } else { stderr }));
    }
    Ok(out.stdout)
}

/// Lo spazio su disco finito arriva da git o dal sistema con testi diversi
/// per piattaforma (`No space left on device`, errore 28 su Unix, 112 su
/// Windows): all'utente si dice cosa succede invece dell'errore grezzo (R-MI-33).
fn explain_disk_full(error: String) -> String {
    let lower = error.to_lowercase();
    let full = lower.contains("no space left on device")
        || lower.contains("not enough space on the disk")
        || lower.contains("os error 28)")
        || lower.contains("os error 112)");
    if !full { return error; }
    crate::tr!(
        format!("Spazio su disco esaurito su questa macchina: libera spazio e riprova ({error})"),
        format!("This machine ran out of disk space: free some space and try again ({error})")
    ).to_string()
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    git_raw(dir, args, &[], None).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

/// Git che puo' uscire con codice diverso da zero lasciando un'uscita utile
/// (`merge-tree` coi conflitti): restituisce se e' andata e cosa ha scritto.
fn git_allow_failure(dir: &Path, args: &[&str]) -> Result<(bool, Vec<u8>), String> {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.autocrlf=false", "-c", "core.filemode=false"])
        .current_dir(dir).args(args)
        .env("LC_ALL", "C").env("LANGUAGE", "C").env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|error| format!("git {}: {error}", args.join(" ")))?;
    Ok((out.status.success(), out.stdout))
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

/// L'id della macchina che arriva qui e' l'identita' iroh (esadecimale, gia'
/// univoca): si usa cosi' com'e', senza collassare caratteri. Collassare piu'
/// caratteri a `_` (M6) faceva collidere id diversi; l'id reale non contiene
/// mai caratteri da mappare, quindi si conserva per intero.
fn machine_key(machine: &str) -> String {
    machine.to_owned()
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

/// Pacchetto con i commit mancanti: accetta solo `refs/heads/*` (A6).
fn create_bundle(dir: &Path, refs: &[String], haves: &[String]) -> Result<BundleTicket, String> {
    open_bundle(dir, refs, haves, false)
}

/// Pacchetto con le sole istantanee WIP (A6): si legge solo con File e Git.
fn create_wip_bundle(dir: &Path, refs: &[String], haves: &[String]) -> Result<BundleTicket, String> {
    open_bundle(dir, refs, haves, true)
}

/// Pacchetto aperto in attesa che il ricevente lo legga a pezzi.
struct OpenBundle {
    file: TempPath,
    size: u64,
    wip: bool,
    created: Instant,
}

/// Pacchetti aperti da questa macchina per le altre. Il collegamento porta al
/// massimo 64 MB per risposta: il pacchetto resta qui e viaggia a pezzi
/// (R-MI-33), invece di fallire oltre i 60 MB come prima.
static OPEN_BUNDLES: LazyLock<Mutex<HashMap<String, OpenBundle>>> = LazyLock::new(Default::default);

fn open_bundle(dir: &Path, refs: &[String], haves: &[String], wip_only: bool) -> Result<BundleTicket, String> {
    for name in refs {
        let allowed = if wip_only {
            name.strip_prefix("refs/studio/wip/").is_some_and(valid_wip_id)
        } else {
            name.strip_prefix("refs/heads/").is_some_and(valid_branch)
        };
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
    let size = std::fs::metadata(&file.0).map_err(|error| explain_disk_full(error.to_string()))?.len();
    if size > MAX_BUNDLE as u64 {
        return Err(crate::tr!(
            "Troppi dati da trasferire fra le macchine in una volta: allinea le copie una volta tramite origin (push e pull), poi la sincronizzazione continua da sola",
            "Too much data to transfer between machines at once: align the copies once through origin (push and pull), then syncing continues on its own"
        ).to_string());
    }
    let sha256 = file_sha256(&file.0)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let mut open = OPEN_BUNDLES.lock().map_err(|_| "bundle registry poisoned")?;
    open.retain(|_, bundle| bundle.created.elapsed() < BUNDLE_EXPIRY);
    // Oltre il tetto si toglie il piu' vecchio: un ricevente caduto a meta'
    // lo ricrea da capo al giro successivo.
    while open.len() >= MAX_OPEN_BUNDLES {
        let Some(oldest) = open.iter().min_by_key(|(_, bundle)| bundle.created).map(|(id, _)| id.clone()) else { break };
        open.remove(&oldest);
    }
    open.insert(id.clone(), OpenBundle { file, size, wip: wip_only, created: Instant::now() });
    Ok(BundleTicket { id, size, sha256 })
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Un pezzo di un pacchetto aperto. Il permesso del comando deve essere lo
/// stesso di chi l'ha aperto (`wip`): un peer in sola lettura non legge le
/// modifiche non committate nemmeno a pezzi (A6). Letto l'ultimo pezzo il
/// pacchetto si chiude.
fn read_bundle_chunk(id: &str, offset: u64, wip: bool) -> Result<Vec<u8>, String> {
    let mut open = OPEN_BUNDLES.lock().map_err(|_| "bundle registry poisoned")?;
    let bundle = open.get(id).filter(|bundle| bundle.wip == wip && bundle.created.elapsed() < BUNDLE_EXPIRY)
        .ok_or("Bundle expired or unknown")?;
    if offset >= bundle.size { return Err("Bundle offset out of range".into()); }
    let len = (bundle.size - offset).min(BUNDLE_CHUNK_SIZE as u64) as usize;
    let mut file = std::fs::File::open(&bundle.file.0).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
    let mut chunk = vec![0u8; len];
    file.read_exact(&mut chunk).map_err(|error| error.to_string())?;
    if offset + len as u64 >= bundle.size { open.remove(id); }
    Ok(chunk)
}

/// Il pacchetto in arrivo, scritto su disco pezzo per pezzo: in memoria non
/// sta mai piu' di un pezzo, anche per pacchetti di centinaia di MB.
struct BundleWriter {
    file: TempPath,
    out: std::fs::File,
    hasher: Sha256,
    written: u64,
    size: u64,
    sha256: String,
}

impl BundleWriter {
    fn new(ticket: &BundleTicket) -> Result<Self, String> {
        if ticket.size > MAX_BUNDLE as u64 { return Err("Bundle too large".into()); }
        let file = TempPath::new(".bundle");
        let out = std::fs::File::create(&file.0).map_err(|error| explain_disk_full(error.to_string()))?;
        Ok(Self { file, out, hasher: Sha256::new(), written: 0, size: ticket.size, sha256: ticket.sha256.clone() })
    }

    fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        if chunk.is_empty() || self.written + chunk.len() as u64 > self.size { return Err("Bundle chunk out of range".into()); }
        self.out.write_all(chunk).map_err(|error| explain_disk_full(error.to_string()))?;
        self.hasher.update(chunk);
        self.written += chunk.len() as u64;
        Ok(())
    }

    /// Dimensione e impronta devono coincidere prima di dare il pacchetto a
    /// git: un pezzo perso o corrotto non deve finire nel repository.
    fn finish(mut self) -> Result<TempPath, String> {
        self.out.flush().map_err(|error| explain_disk_full(error.to_string()))?;
        if self.written != self.size || format!("{:x}", self.hasher.finalize()) != self.sha256 {
            return Err(crate::tr!(
                "Il pacchetto ricevuto dall'altra macchina è arrivato danneggiato: riprovo al prossimo giro",
                "The bundle received from the other machine arrived damaged: retrying on the next round"
            ).to_string());
        }
        Ok(self.file)
    }
}

fn fetch_bundle(dir: &Path, bundle: &Path, refspecs: &[String]) -> Result<(), String> {
    let path = bundle.to_string_lossy().to_string();
    let mut args = vec!["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", path.as_str()];
    args.extend(refspecs.iter().map(String::as_str));
    git(dir, &args).map(|_| ())
}

/// Quanto pesano le modifiche non committate rispetto a HEAD, file nuovi
/// compresi, senza creare l'istantanea: la domanda di «Porta qui le
/// modifiche» lo mostra prima di cominciare (R-MI-33).
fn estimate_wip(dir: &Path) -> Result<WipEstimate, String> {
    let raw = git_raw(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], &[], None)?;
    let text = String::from_utf8_lossy(&raw);
    let mut entries = text.split('\0').filter(|entry| !entry.is_empty());
    let mut estimate = WipEstimate { files: 0, bytes: 0 };
    while let Some(entry) = entries.next() {
        if entry.len() < 4 { continue; }
        let (status, name) = entry.split_at(3);
        // Rinomina e copia portano dopo il percorso nuovo quello di origine.
        if status.contains('R') || status.contains('C') { entries.next(); }
        estimate.files += 1;
        // Un file cancellato non pesa: manca, e la sua assenza viaggia gratis.
        if let Ok(metadata) = std::fs::metadata(dir.join(name)) {
            if metadata.is_file() { estimate.bytes += metadata.len(); }
        }
    }
    Ok(estimate)
}

/// Nomi che differiscono solo per maiuscole (R-MI-35): fra le branch
/// dell'altra macchina, o fra una sua e una di questa con un nome diverso.
/// Restituisce, per ogni nome dell'altra macchina in conflitto, l'altro nome.
fn case_conflicts(peer: &[BranchHead], local: &[String]) -> HashMap<String, String> {
    let mut conflicts = HashMap::new();
    for (index, head) in peer.iter().enumerate() {
        let folded = head.name.to_lowercase();
        let other = peer.iter().enumerate()
            .find(|(other, candidate)| *other != index && candidate.name != head.name && candidate.name.to_lowercase() == folded)
            .map(|(_, candidate)| candidate.name.clone())
            .or_else(|| local.iter().find(|name| **name != head.name && name.to_lowercase() == folded).cloned());
        if let Some(other) = other { conflicts.insert(head.name.clone(), other); }
    }
    conflicts
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
    let mut detached: Vec<PathBuf> = Vec::new();
    for line in raw.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current = Some(PathBuf::from(path));
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if let Some(path) = current.clone() { map.insert(branch.to_owned(), path); }
        } else if line == "detached" {
            // HEAD staccato: nessuna branch da mappare qui, ma il worktree
            // resta in uso e non deve avanzare le branch per riflesso (M2).
            if let Some(path) = current.clone() { detached.push(path); }
        }
    }
    // Un worktree staccato puo' essere su un commit di una branch qualunque: la
    // regola conservativa e' trattarlo come occupato per tutte le branch, cosi'
    // nessun `update-ref` lo lascia indietro mentre i file restano al commit
    // staccato. La chiave vuota marca il worktree senza associarlo a una branch.
    for path in detached {
        map.insert(String::new(), path);
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

/// Vero se il repository ha un commit (HEAD risolvibile). Senza commit non si
/// puo' fare un'istantanea ne' un pacchetto: i comandi lo segnalano prima di
/// far fallire git con un errore grezzo (M3).
fn has_head(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
}

/// La cartella non puo' essere toccata da un avanzamento o da un'istantanea
/// mentre un'automazione o un turno dell'agente ci lavora (A1, A2). Il turno
/// si legge dalla sessione RPC adesso, dentro la serie serializzata dal
/// `SyncGuard`: l'elenco della finestra e' calcolato prima del giro di rete.
/// Non si usa il lock interattivo delle automazioni, che resta preso per
/// tutta la vita della sessione e bloccherebbe l'avanzamento per sempre.
fn is_busy_in_backend(path: &Path) -> bool {
    crate::automations::is_project_locked(&path.to_string_lossy(), None)
        || crate::rpc::turn_running_in(path)
}

/// File che `to` aggiunge rispetto a `from`, letti con `-z`: con l'elenco
/// normale git mette fra virgolette i nomi non ASCII e la rimozione mancava
/// proprio quei file.
fn added_files(dir: &Path, from: &str, to: &str) -> Result<Vec<String>, String> {
    let raw = git_raw(dir, &["diff-tree", "-r", "-z", "--name-only", "--diff-filter=A", from, to], &[], None)?;
    Ok(String::from_utf8_lossy(&raw).split('\0').filter(|name| !name.is_empty()).map(str::to_owned).collect())
}

/// Percorsi separati da NUL, come li stampa git con `-z`.
fn split_paths(raw: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(raw).split('\0').filter(|path| !path.is_empty()).map(str::to_owned).collect()
}

/// File toccati dai commit fra `from` e `to`, cancellazioni comprese: sono
/// quelli che un avanzamento sovrascriverebbe (R-MI-47). `--no-renames` evita
/// che una rinomina nasconda il percorso di partenza.
fn changed_files(dir: &Path, from: &str, to: &str) -> Result<Vec<String>, String> {
    let raw = git_raw(dir, &["diff", "--name-only", "-z", "--no-renames", from, to], &[], None)?;
    Ok(split_paths(&raw))
}

/// File sporchi adesso: modificati, cancellati, in stage e non tracciati
/// (R-MI-47). I nomi sono relativi alla radice del worktree.
fn dirty_files(dir: &Path) -> Result<Vec<String>, String> {
    // `-z` divide con NUL e non mette virgolette: lo stato occupa i primi due
    // caratteri, che qui contano (uno spazio significa «modificato, non in
    // stage») e che `git()` taglierebbe.
    let raw = git_raw(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"], &[], None)?;
    let text = String::from_utf8_lossy(&raw);
    let mut entries = text.split('\0').filter(|entry| !entry.is_empty());
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 { continue; }
        let (status, name) = entry.split_at(3);
        // Rinomina e copia portano il percorso di origine nell'elemento dopo.
        if status.contains('R') || status.contains('C') { entries.next(); }
        files.push(name.to_owned());
    }
    Ok(files)
}

fn conflict_reason(files: &[String]) -> String {
    let mut unique: Vec<&str> = files.iter().map(String::as_str).collect();
    unique.sort_unstable();
    unique.dedup();
    format!("conflict:{}", unique.join(","))
}

fn counts(dir: &Path, local: &str, peer: &str) -> Result<(u32, u32), String> {
    let raw = git(dir, &["rev-list", "--left-right", "--count", &format!("{local}...{peer}")])?;
    let mut parts = raw.split_whitespace().map(|value| value.parse::<u32>().unwrap_or(0));
    Ok((parts.next().unwrap_or(0), parts.next().unwrap_or(0)))
}

/// Porta i riferimenti di tracciamento sulle cime dell'altra macchina e
/// decide per ogni branch. `busy` sono le cartelle in cui un agente lavora,
/// l'editor ha file non salvati o un'automazione e' attiva.
fn reconcile(dir: &Path, machine: &str, local_id: Option<&str>, peer: &[BranchHead], busy: &[String]) -> Result<Vec<BranchSync>, String> {
    let prefix = tracking_prefix(machine);
    let local: HashMap<String, String> = heads(dir)?.into_iter().map(|head| (head.name, head.commit)).collect();
    // Nomi che collidono per maiuscole (R-MI-35): niente riferimenti di
    // tracciamento per loro, che sui filesystem di macOS e Windows
    // finirebbero nello stesso file.
    let local_names: Vec<String> = local.keys().cloned().collect();
    let conflicts = case_conflicts(peer, &local_names);
    let peer_names: HashSet<&str> = peer.iter()
        .filter(|head| !conflicts.contains_key(&head.name))
        .map(|head| head.name.as_str())
        .collect();
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
    let worktrees = checked_out(dir)?;
    // Un worktree con HEAD staccato occupa la cartella per ogni branch (M2).
    let has_detached = worktrees.keys().any(|branch| branch.is_empty());
    let mut result = Vec::new();
    for head in peer {
        if let Some(other) = conflicts.get(&head.name) {
            result.push(BranchSync {
                name: head.name.clone(), local: local.get(&head.name).cloned(), peer: head.commit.clone(),
                ahead: 0, behind: 0, state: BranchState::CaseConflict, reason: Some(other.clone()),
            });
            continue;
        }
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
                // Divergenza: di norma resta tale (R-MI-22), ma se entrambe le
                // parti hanno toccato solo il diario si unisce da sole
                // (R-MI-48), con un solo commit di unione deciso dall'id
                // minore fra le due macchine.
                merge_journal_branch(dir, &head.name, mine, &head.commit, local_id, machine, worktrees.get(&head.name), has_detached, busy)
                    .map(|merged| if merged { BranchState::MergedJournal } else { BranchState::Diverged })
                    .unwrap_or_else(|reason| { entry.reason = Some(reason); BranchState::Pending })
            } else {
                match advance(dir, &head.name, mine, &head.commit, worktrees.get(&head.name), has_detached, busy) {
                    Ok(()) => BranchState::Advanced,
                    Err(reason) => { entry.reason = Some(reason); BranchState::Pending }
                }
            };
        }
        result.push(entry);
    }
    Ok(result)
}

/// Solo fast-forward (R-MI-27): mai merge, rebase o reset su file altrui.
///
/// `has_detached` e' vero se esiste un worktree con HEAD staccato: occupato
/// per ogni branch, cosi' nessun avanzamento lascia i suoi file al commit
/// staccato mentre la branch avanza (M2).
///
/// I file sporchi che i commit in arrivo non toccano non fermano piu'
/// l'avanzamento (R-MI-47): restano dove sono, come con `git pull --autostash`.
/// Se invece li toccano, si salva un'istantanea con il meccanismo WIP,
/// si avanza e la si riapplica; se la riapplicazione confligge si torna
/// esattamente allo stato di prima e si dice quale file blocca.
fn advance(dir: &Path, branch: &str, from: &str, to: &str, worktree: Option<&PathBuf>, has_detached: bool, busy: &[String]) -> Result<(), String> {
    // Il controllo occupato/pulito e il movimento devono essere atomici
    // rispetto al backend: si ricontrolla lo stato proprio qui, dentro la
    // stessa serie di processi git serializzata dal SyncGuard, e non si da'
    // fiducia al solo elenco `busy` arrivato dal frontend (A1).
    let Some(worktree) = worktree else {
        // Branch non in uso: il riferimento si sposta, ma solo se nessun
        // worktree e' staccato (M2). Un worktree staccato puo' essere su un
        // commit di questa branch: avanzarla lascerebbe i suoi file al commit
        // staccato. La regola conservativa e' trattare qualunque worktree
        // staccato come occupato per l'avanzamento delle branch non in uso.
        if has_detached {
            return Err("detached".into());
        }
        // Spostare il riferimento di una branch non in uso non tocca nessuna
        // cartella: un agente al lavoro altrove non e' un motivo per aspettare.
        return git(dir, &["update-ref", &format!("refs/heads/{branch}"), to, from]).map(|_| ());
    };
    // Ricontrolla occupazione e pulizia subito prima del merge: un agente puo'
    // aver cominciato a lavorare dopo il calcolo dell'elenco della finestra.
    ensure_free(worktree, busy)?;
    move_branch(worktree, branch, from, to)
}

/// Un avanzamento non parte se un agente sta lavorando nella cartella o se il
/// frontend l'ha dichiarata occupata (A1, R-MI-27).
fn ensure_free(worktree: &Path, busy: &[String]) -> Result<(), String> {
    if busy.iter().any(|candidate| same_path(worktree, candidate)) || is_busy_in_backend(worktree) {
        return Err("busy".into());
    }
    Ok(())
}

/// Sposta la branch di questa cartella da `from` a `to` conservando le
/// modifiche non committate (R-MI-47).
fn move_branch(worktree: &Path, branch: &str, from: &str, to: &str) -> Result<(), String> {
    let incoming = changed_files(worktree, from, to)?;
    let dirty = dirty_files(worktree)?;
    // Solo i file sporchi che i commit in arrivo toccano vanno messi da
    // parte: gli altri restano esattamente come sono (R-MI-47).
    let overlapping = dirty.iter().any(|path| incoming.contains(path));
    if !overlapping {
        // Il fast-forward lascia intatte le modifiche che non tocca; se git
        // rifiuta lo stesso (file non tracciato da sovrascrivere) l'errore
        // arriva al chiamante e la copia resta «da aggiornare».
        return git(worktree, &["merge", "--ff-only", "--quiet", to]).map(|_| ());
    }
    advance_with_snapshot(worktree, branch, from, to)
}

/// Avanzamento con modifiche locali che i commit in arrivo toccano
/// (R-MI-47): istantanea della cartella, ff, riapplicazione a tre vie dei soli
/// file. Niente stash dell'utente. Se qualcosa va storto si torna allo stato
/// di prima, HEAD compreso.
///
/// Se la fusione anticipata confligge non si tocca niente: HEAD e file
/// restano esattamente com'erano. Quando invece si arriva in fondo, le
/// modifiche locali sono di nuovo nel working tree ma non in stage:
/// l'avanzamento ha riportato l'indice su HEAD, come dopo un `git pull`.
fn advance_with_snapshot(worktree: &Path, branch: &str, from: &str, to: &str) -> Result<(), String> {
    if git(worktree, &["rev-parse", "HEAD"])? != from {
        return Err("La copia non è sul commit da cui partire".into());
    }
    // Stessa istantanea di R-MI-28, ma senza lasciare un ref: serve solo qui
    // per riportare indietro il lavoro se la riapplicazione non riesce.
    let tree = worktree_tree(worktree)?;
    let message = "OMP Studio: modifiche locali durante l'avanzamento";
    let snapshot = String::from_utf8_lossy(
        &git_raw(worktree, &["commit-tree", &tree, "-p", from, "-m", message], &STUDIO_IDENTITY, None)?
    ).trim().to_string();
    // La fusione si prova prima, senza indice e senza working tree: se
    // confligge si esce senza aver toccato ne' HEAD ne' i file.
    let merged = merge_tree(worktree, to, &snapshot)?;
    let outcome = (|| -> Result<(), String> {
        // Cartella pulita rispetto a `from`: l'istantanea e' gia' nel commit
        // temporaneo, quindi si possono togliere anche i file nuovi.
        git(worktree, &["read-tree", "--reset", "-u", from])?;
        for name in added_files(worktree, from, &snapshot)? {
            let _ = std::fs::remove_file(worktree.join(name));
        }
        git(worktree, &["merge", "--ff-only", "--quiet", to])?;
        // `read-tree -m -u` scrive nel working tree il risultato della fusione
        // e lo mette nell'indice; il `--reset` finale riporta l'indice a HEAD,
        // cosi' le modifiche restano non in stage come prima.
        git(worktree, &["read-tree", "-m", "-u", to, &merged])?;
        git(worktree, &["read-tree", "--reset", to])?;
        Ok(())
    })();
    if let Err(error) = outcome {
        rollback_advance(worktree, branch, from, to, &snapshot);
        return Err(error);
    }
    Ok(())
}

/// Cartella del diario (R-MI-48): l'unione automatica vale solo per i file
/// che stanno qui, senza eccezioni.
const JOURNAL_DIR: &str = "docs/diario/";

fn is_journal_file(path: &str) -> bool {
    path.starts_with(JOURNAL_DIR)
}

/// Unione del diario fra due storie divergenti (R-MI-48).
///
/// Restituisce `Ok(true)` quando questa macchina ha unito, `Ok(false)` quando
/// la divergenza non riguarda solo il diario (resta `Diverged`, R-MI-22) o
/// quando l'unione spetta all'altra macchina (id maggiore, che qui aspetta
/// `journalPeer`), `Err(reason)` quando l'unione spetta a questa macchina ma
/// non puo' avvenire ora (cartella occupata, errore di git).
#[allow(clippy::too_many_arguments)]
fn merge_journal_branch(dir: &Path, branch: &str, mine: &str, peer: &str, local_id: Option<&str>, machine: &str,
    worktree: Option<&PathBuf>, has_detached: bool, busy: &[String]) -> Result<bool, String> {
    let Some(base) = merge_base(dir, mine, peer) else { return Ok(false) };
    let incoming = changed_files(dir, &base, peer)?;
    let mine_files = changed_files(dir, &base, mine)?;
    // Basta un file fuori dal diario, in una delle due parti, perche' la
    // divergenza resti quella di sempre (R-MI-22).
    let others: Vec<&String> = incoming.iter().chain(mine_files.iter()).filter(|path| !is_journal_file(path)).collect();
    if !others.is_empty() { return Ok(false); }
    // Entrambe le parti devono aver toccato almeno un file del diario,
    // altrimenti non e' una divergenza ma un caso di avanzamento normale.
    if incoming.is_empty() || mine_files.is_empty() { return Ok(false); }
    // Chi unisce si sceglie in modo deterministico: id minore fra le due
    // macchine. L'altra aspetta il commit di unione e poi fara' fast-forward.
    let Some(local_id) = local_id else {
        return Err(crate::tr!(
            "Identità della macchina non disponibile: il diario divergente non si unisce",
            "Machine identity unavailable: the diverged journal is not merged"
        ).to_string());
    };
    if local_id >= machine { return Err("journalPeer".into()); }
    // Stessi vincoli di cartella di R-MI-27/R-MI-47.
    let Some(worktree) = worktree else {
        if has_detached { return Err("detached".into()); }
        // La branch non e' in uso: si costruisce il commit di unione e si
        // sposta il riferimento, senza toccare nessuna cartella.
        let union = journal_union_commit(dir, mine, peer, &base)?;
        return git(dir, &["update-ref", &format!("refs/heads/{branch}"), &union, mine]).map(|_| true);
    };
    ensure_free(worktree, busy)?;
    let union = journal_union_commit(dir, mine, peer, &base)?;
    // Le modifiche locali seguono le stesse regole dell'avanzamento: se i file
    // del diario sono sporchi si passa dall'istantanea, altrimenti il
    // fast-forward li lascia stare.
    let dirty = dirty_files(worktree)?;
    let touched: Vec<String> = changed_files(worktree, &base, &union)?;
    if dirty.iter().any(|path| touched.contains(path)) {
        advance_with_snapshot(worktree, branch, mine, &union)
    } else {
        git(worktree, &["merge", "--ff-only", "--quiet", &union]).map(|_| ())
    }?;
    Ok(true)
}

/// Genitore comune piu' recente, `None` se le due storie non si toccano (repo
/// riscritto o shallow): in quel caso non si unisce niente.
fn merge_base(dir: &Path, a: &str, b: &str) -> Option<String> {
    git(dir, &["merge-base", a, b]).ok().filter(|base| is_hash(base))
}

/// Commit di unione del diario con due genitori in ordine fisso (ours, theirs)
/// e contenuto per file dall'unione per righe (R-MI-48).
///
/// Si costruisce con il plumbing su un indice temporaneo: l'albero di `ours`
/// meno i file del diario piu' quelli uniti. Nessun file fuori dal diario
/// viene riscritto, e il commit e' identico su qualunque macchina lo produca
/// (stessi genitori, stesso albero, stesso messaggio).
fn journal_union_commit(dir: &Path, ours: &str, theirs: &str, base: &str) -> Result<String, String> {
    // File del diario toccati da entrambe le parti: la base e' il genitore
    // comune, i due lati sono i commit. Nessun altro file entra qui.
    let index = TempPath::new(".index");
    let path = index.0.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", path.as_str())];
    git_raw(dir, &["read-tree", ours], &env, None)?;
    let mut journal: Vec<String> = changed_files(dir, base, ours)?.into_iter().chain(changed_files(dir, base, theirs)?)
        .filter(|path| is_journal_file(path)).collect();
    journal.sort_unstable();
    journal.dedup();
    for rel in &journal {
        let merged = union_blob(dir, base, ours, theirs, rel)?;
        let mode = blob_mode(dir, ours, rel).or(blob_mode(dir, theirs, rel)).unwrap_or("100644");
        let spec = format!("{mode},{merged},{rel}");
        git_raw(dir, &["update-index", "--add", "--replace", "--cacheinfo", &spec], &env, None)?;
    }
    let tree = String::from_utf8_lossy(&git_raw(dir, &["write-tree"], &env, None)?).trim().to_string();
    // Messaggio fisso e senza traduzione: insieme ai genitori nell'ordine
    // ours/theirs rende il commit identico ovunque venga costruito.
    let commit = String::from_utf8_lossy(
        &git_raw(dir, &["commit-tree", &tree, "-p", ours, "-p", theirs, "-m", "OMP Studio: journal union"], &STUDIO_IDENTITY, None)?
    ).trim().to_string();
    Ok(commit)
}

/// Modalita' di un file nel commit, per conservarne i bit eseguibili.
/// `ls-tree` comincia sempre con la modalita' su sei cifre.
fn blob_mode(dir: &Path, commit: &str, rel: &str) -> Option<&'static str> {
    let entry = git(dir, &["ls-tree", "-z", commit, "--", rel]).ok()?;
    Some(if entry.starts_with("100755") { "100755" } else { "100644" })
}

/// Blob del file unito con `git merge-file --union` (base, ours, theirs):
/// restano le righe di entrambe le parti, senza marcature.
///
/// Un file aggiunto da una parte sola non ha una base ne' un altro lato: si
/// prende cosi' com'e', e le righe dell'altra parte non possono mancare
/// perche' non esistono.
fn union_blob(dir: &Path, base: &str, ours: &str, theirs: &str, rel: &str) -> Result<String, String> {
    let base_content = blob_content(dir, base, rel)?;
    let ours_content = blob_content(dir, ours, rel)?;
    let theirs_content = blob_content(dir, theirs, rel)?;
    let content = match (&base_content, &ours_content, &theirs_content) {
        (None, Some(side), None) | (None, None, Some(side)) => side.clone(),
        _ => {
            let files = [("base", &base_content), ("ours", &ours_content), ("theirs", &theirs_content)];
            // I `TempPath` restano vivi fino a `merge-file`: i percorsi da soli
            // non bastano, il file sparisce appena il valore esce dallo scope.
            let inputs: Vec<TempPath> = files.iter().map(|(label, blob)| {
                let file = TempPath::new(&format!(".{label}"));
                std::fs::write(&file.0, blob.as_deref().unwrap_or_default())
                    .map_err(|error| explain_disk_full(error.to_string()))?;
                Ok(file)
            }).collect::<Result<_, String>>()?;
            let path = |index: usize| inputs[index].0.to_string_lossy().to_string();
            // `--union` risolve ogni conflitto tenendo le righe di entrambe le
            // parti: e' il driver chiesto da R-MI-48, senza conflitti.
            git_raw(dir, &["merge-file", "-p", "--union", &path(1), &path(0), &path(2)], &[], None)?
        }
    };
    let blob = git_raw(dir, &["hash-object", "-w", "--stdin"], &[], Some(&content))?;
    Ok(String::from_utf8_lossy(&blob).trim().to_string())
}

fn blob_content(dir: &Path, commit: &str, rel: &str) -> Result<Option<Vec<u8>>, String> {
    match git_raw(dir, &["cat-file", "blob", &format!("{commit}:{rel}")], &[], None) {
        Ok(content) => Ok(Some(content)),
        // Un file assente in quel commit e' normale: non c'e' nulla da unire.
        Err(_) => Ok(None),
    }
}

/// Rimette la copia com'era prima di `advance_with_snapshot`: branch a `from`,
/// file uguali all'istantanea. Ogni passo ignora l'errore: si tenta di
/// ripristinare tutto anche se un passaggio non riesce.
fn rollback_advance(worktree: &Path, branch: &str, from: &str, to: &str, snapshot: &str) {
    let _ = git(worktree, &["update-ref", &format!("refs/heads/{branch}"), from, to]);
    let _ = git(worktree, &["read-tree", "--reset", "-u", from]);
    for commit in [to, snapshot] {
        for name in added_files(worktree, from, commit).unwrap_or_default() {
            let _ = std::fs::remove_file(worktree.join(name));
        }
    }
    let _ = git(worktree, &["read-tree", "-m", "-u", from, snapshot]);
    let _ = git(worktree, &["read-tree", "--reset", from]);
}

/// Albero della fusione a tre vie fra `ours` e `theirs` (base implicita: il
/// loro genitore comune), senza toccare indice, HEAD o working tree.
///
/// `merge-tree --write-tree` fa la fusione di contenuto vera, che `read-tree`
/// non fa: con modifiche su righe diverse dello stesso file restituisce
/// l'albero gia' unito. Se restano conflitti il risultato e' l'elenco dei file.
fn merge_tree(dir: &Path, ours: &str, theirs: &str) -> Result<String, String> {
    // `merge-tree` esce con 1 quando la fusione ha conflitti: l'uscita resta
    // utile (albero parziale e nomi dei file), quindi non si passa da `git_raw`
    // che la tratterebbe come errore.
    // `--name-only` fa stampare i soli nomi dei file in conflitto (con l'uscita
    // predefinita sarebbero righe d'indice con modo e blob).
    let (ok, raw) = git_allow_failure(dir, &["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", ours, theirs])?;
    let text = String::from_utf8_lossy(&raw);
    let mut parts = text.split('\0');
    if !ok {
        // Primo campo: l'albero parziale; poi i nomi dei file in conflitto.
        let _ = parts.next();
        let conflicts: Vec<String> = parts.filter(|part| !part.is_empty()).map(str::to_owned).collect();
        return Err(if conflicts.is_empty() { "Fusione non riuscita".into() } else { conflict_reason(&conflicts) });
    }
    parts.next().map(|tree| tree.trim().to_owned()).filter(|tree| !tree.is_empty())
        .ok_or_else(|| "Fusione non riuscita".to_owned())
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
    if !has_head(dir) {
        return Err(crate::tr!(
            "Il repository non ha ancora commit: niente da portare",
            "The repository has no commits yet: nothing to move"
        ).to_string());
    }
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
/// partenza, pulita e ferma: il risultato sono le stesse modifiche, non in
/// stage. Su errore a meta' ripristina l'albero base, cosi' non resta stato
/// parziale (A3).
fn apply_snapshot(dir: &Path, base: &str, commit: &str) -> Result<(), String> {
    // La cartella di arrivo non deve avere un agente al lavoro o
    // un'automazione attiva (A2): il backend lo vede anche se il frontend del
    // chiamante non ha passato la cartella come occupata.
    if is_busy_in_backend(dir) {
        return Err(crate::tr!(
            "La copia di arrivo è occupata da un agente o un'automazione",
            "The target copy is busy with an agent or an automation"
        ).to_string());
    }
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
    // `read-tree -m -u` non tocca nulla se fallisce (per esempio un file non
    // tracciato o ignorato sarebbe sovrascritto): in quel caso non c'e' niente
    // da ripristinare, e cancellare i «file nuovi» toglierebbe quelli
    // dell'utente. Il ripristino serve solo se fallisce il passo dopo.
    if let Err(error) = git(dir, &["read-tree", "-m", "-u", "HEAD", commit]) {
        return Err(crate::tr!(
            format!("Istantanea non applicata, la copia di arrivo è invariata: {error}"),
            format!("Snapshot not applied, the target copy is unchanged: {error}")
        ).to_string());
    }
    if let Err(error) = git(dir, &["reset", "--quiet"]) {
        // L'albero dell'istantanea e' gia' nei file: si torna a `base`. Con
        // `-u` git toglie anche i file che l'istantanea aveva aggiunto, perche'
        // stanno nell'indice e non in `base`; il giro esplicito copre il caso
        // in cui l'indice fosse gia' stato toccato da `reset`.
        let _ = git(dir, &["read-tree", "--reset", "-u", base]);
        if let Ok(added) = added_files(dir, base, commit) {
            for name in added {
                let _ = std::fs::remove_file(dir.join(name));
            }
        }
        return Err(crate::tr!(
            format!("Applicazione dell'istantanea interrotta e ripristinata: {error}"),
            format!("Applying the snapshot was interrupted and rolled back: {error}")
        ).to_string());
    }
    Ok(())
}

/// Marcatore locale di «istantanea gia' applicata» (A3): un riferimento che
/// ricorda il commit dell'istantanea gia' materializzata nel working tree.
fn wip_applied_reference(id: &str) -> String {
    format!("refs/studio/wip-applied/{id}")
}

/// Vero se l'istantanea `id` risulta gia' applicata qui. Prima controlla il
/// marcatore `refs/studio/wip-applied/<id>`, poi, come ripiego per una caduta
/// avvenuta prima di scriverlo, confronta l'albero di lavoro con l'albero
/// dell'istantanea (A3). In entrambi i casi un nuovo tentativo converge senza
/// riapplicare ne' fallire sulla copia «sporca».
fn is_wip_applied(dir: &Path, id: &str, commit: &str) -> Result<bool, String> {
    if let Ok(applied) = git(dir, &["rev-parse", "--verify", "-q", &wip_applied_reference(id)]) {
        if !applied.is_empty() && applied == commit {
            return Ok(true);
        }
    }
    if has_head(dir) {
        let snapshot_tree = git(dir, &["rev-parse", &format!("{commit}^{{tree}}")])?;
        if worktree_tree(dir)? == snapshot_tree {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Applica l'istantanea gia' ricevuta (il ref esiste ed e' stato verificato):
/// se e' gia' applicata torna successo senza riapplicare, altrimenti applica e
/// scrive il marcatore (A3).
fn receive_snapshot(dir: &Path, id: &str, base: &str, commit: &str) -> Result<(), String> {
    if is_wip_applied(dir, id, commit)? {
        return Ok(());
    }
    apply_snapshot(dir, base, commit)?;
    git(dir, &["update-ref", &wip_applied_reference(id), commit]).map(|_| ())
}

/// Pulisce la copia di partenza dopo la conferma dell'arrivo, solo se e'
/// ancora come nell'istantanea. Le modifiche sono gia' nel ref
/// `refs/studio/wip/<id>`: si riporta il working tree a HEAD senza usare lo
/// stash dell'utente (M4), togliendo solo i file inclusi nell'istantanea.
fn finish_snapshot(dir: &Path, id: &str) -> Result<(), String> {
    let reference = format!("refs/studio/wip/{id}");
    let commit = git(dir, &["rev-parse", "--verify", &reference])?;
    if worktree_tree(dir)? != git(dir, &["rev-parse", &format!("{commit}^{{tree}}")])? {
        return Err(crate::tr!(
            "La copia di partenza è cambiata dopo l'istantanea: non la pulisco",
            "The source copy changed after the snapshot: leaving it untouched"
        ).to_string());
    }
    // Riporta indice e working tree all'albero di HEAD (la base): rimuove i
    // file nuovi dell'istantanea e ripristina modifiche e cancellazioni, solo
    // sui file che l'istantanea conteneva. Lo stash dell'utente resta intatto.
    let head = git(dir, &["rev-parse", "HEAD"])?;
    git(dir, &["read-tree", "--reset", "-u", &head])?;
    // `read-tree` ripristina i file tracciati ma lascia i file nuovi: si
    // elencano quelli aggiunti dall'istantanea rispetto a HEAD e si rimuovono
    // uno a uno (M4). La guardia sopra garantisce che il working tree coincide
    // con l'istantanea, quindi non esistono altri file non tracciati.
    for name in added_files(dir, &head, &commit)? {
        let _ = std::fs::remove_file(dir.join(name));
    }
    Ok(())
}

// ── comandi ────────────────────────────────────────────────────────────────

static SYNCING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Una sincronizzazione alla volta per repository: il giro successivo trova
/// lo stato aggiornato. La chiave e' il percorso canonico (M7), cosi' due
/// grafie dello stesso repository si serializzano invece di correre in
/// parallelo su `index.lock` e `update-ref`.
struct SyncGuard(String);
impl SyncGuard {
    fn acquire(path: &str) -> Result<Self, String> {
        // Il percorso canonico distingue i repository anche quando arrivano
        // con spazi, case o separatori diversi; se la canonizzazione fallisce
        // si ripiega sulla stringa ricevuta (il comando git fallirebbe comunque).
        let key = crate::projects::canonical_project_base(path)
            .map(|base| base.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_owned());
        let mut set = SYNCING.lock().map_err(|_| "sync lock poisoned")?;
        if !set.insert(key.clone()) { return Err("sync already running".into()); }
        Ok(Self(key))
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

/// Pacchetto con i commit mancanti di `refs` letti dall'altra macchina, a
/// pezzi (R-MI-33), e importati con `refspecs`. `wip` sceglie i comandi del
/// peer: quelli delle branch (Lettura) o quelli delle istantanee (File e Git).
async fn fetch_from_peer(app: &tauri::AppHandle, dir: PathBuf, machine: &str, peer_path: &str, refs: Vec<String>, refspecs: Vec<String>, wip: bool) -> Result<(), String> {
    let (open_command, chunk_command) = if wip {
        ("copy_wip_bundle", "copy_wip_bundle_chunk")
    } else {
        ("copy_sync_bundle", "copy_sync_bundle_chunk")
    };
    let haves = { let dir = dir.clone(); blocking(move || local_tips(&dir)).await? };
    let args = json!({ "projectPath": peer_path, "refs": refs, "haves": haves });
    let PeerBody::Json(value) = call_peer_with_timeout(app, machine, open_command, &args, BUNDLE_TIMEOUT).await? else {
        return Err("Unexpected bundle response".into());
    };
    let ticket: BundleTicket = serde_json::from_value(value).map_err(|error| error.to_string())?;
    // I pezzi si chiedono in ordine e si scrivono su disco man mano: in
    // memoria non sta mai piu' di un pezzo.
    let mut writer = BundleWriter::new(&ticket)?;
    while writer.written < ticket.size {
        let args = json!({ "id": ticket.id, "offset": writer.written });
        let PeerBody::Raw(chunk) = call_peer_with_timeout(app, machine, chunk_command, &args, BUNDLE_TIMEOUT).await? else {
            return Err("Unexpected bundle chunk".into());
        };
        writer = blocking(move || { writer.push(&chunk)?; Ok(writer) }).await?;
    }
    blocking(move || {
        let file = writer.finish()?;
        fetch_bundle(&dir, &file.0, &refspecs)
    }).await
}

#[tauri::command]
pub async fn copy_sync_heads(project_path: String) -> Result<CopyHeads, String> {
    blocking(move || heads(Path::new(&project_path)).map(|branches| CopyHeads { branches })).await
}

/// Apre il pacchetto delle branch richieste (Lettura); i dati si leggono a
/// pezzi con `copy_sync_bundle_chunk` (R-MI-33).
#[tauri::command]
pub async fn copy_sync_bundle(project_path: String, refs: Vec<String>, haves: Vec<String>) -> Result<BundleTicket, String> {
    blocking(move || create_bundle(Path::new(&project_path), &refs, &haves)).await
}

#[tauri::command]
pub async fn copy_sync_bundle_chunk(id: String, offset: u64) -> Result<tauri::ipc::Response, String> {
    blocking(move || read_bundle_chunk(&id, offset, false)).await.map(tauri::ipc::Response::new)
}

/// Pacchetto con le sole istantanee WIP (A6): permesso File e Git, cosi' un
/// peer in sola lettura non puo' leggere le modifiche non committate
/// dell'altra macchina, nemmeno a pezzi.
#[tauri::command]
pub async fn copy_wip_bundle(project_path: String, refs: Vec<String>, haves: Vec<String>) -> Result<BundleTicket, String> {
    blocking(move || create_wip_bundle(Path::new(&project_path), &refs, &haves)).await
}

#[tauri::command]
pub async fn copy_wip_bundle_chunk(id: String, offset: u64) -> Result<tauri::ipc::Response, String> {
    blocking(move || read_bundle_chunk(&id, offset, true)).await.map(tauri::ipc::Response::new)
}

/// Quanto pesano le modifiche non committate, per la domanda di «Porta qui
/// le modifiche» (R-MI-33).
#[tauri::command]
pub async fn copy_wip_estimate(project_path: String) -> Result<WipEstimate, String> {
    blocking(move || estimate_wip(Path::new(&project_path))).await
}

/// Porta in questa copia la branch `branch` della copia di `machine`, nei
/// riferimenti `refs/studio/<macchina>/heads/*` della sincronizzazione
/// (R-MI-26): serve a un job di «Esegui su macchina» (R-MI-36) chiesto a un
/// commit che qui non c'e' ancora. Non tocca branch locali ne' cartelle.
pub(crate) async fn fetch_branch(app: &tauri::AppHandle, project_path: &Path, machine: &str, peer_path: &str, branch: &str) -> Result<(), String> {
    if !valid_branch(branch) { return Err(format!("Invalid branch name: {branch}")); }
    let prefix = tracking_prefix(machine);
    fetch_from_peer(app, project_path.to_path_buf(), machine, peer_path,
        vec![format!("refs/heads/{branch}")], vec![format!("+refs/heads/{branch}:{prefix}{branch}")], false).await
}

#[tauri::command]
pub(crate) async fn copy_receive_lane_branch(app: tauri::AppHandle, project_path: String,
    machine: String, peer_path: String, branch: String, commit: String, session: String) -> Result<String, String> {
    let session = uuid::Uuid::parse_str(&session).map_err(|_| "Invalid session id")?;
    if !is_hash(&commit) { return Err("Invalid lane commit".into()); }
    let path = PathBuf::from(project_path);
    fetch_branch(&app, &path, &machine, &peer_path, &branch).await?;
    let received = format!("{}{}", tracking_prefix(&machine), branch);
    blocking(move || {
        let copied = git(&path, &["rev-parse", "--verify", &received])?;
        if copied != commit { return Err("The source lane changed during transfer".into()); }
        let name = format!("omp/continued-{session}");
        let reference = format!("refs/heads/{name}");
        match git(&path, &["rev-parse", "--verify", &reference]) {
            Ok(previous) if previous == commit => {}
            Ok(_) => return Err("The destination lane already has different commits".into()),
            Err(_) => { git(&path, &["branch", "--", &name, &commit])?; }
        }
        Ok(name)
    }).await
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
    // Le branch che collidono per maiuscole non si scaricano (R-MI-35):
    // `reconcile` le riporta come conflitto.
    let conflicted: HashSet<String> = {
        let dir = dir.clone();
        let branches = branches.clone();
        blocking(move || {
            let local: Vec<String> = heads(&dir)?.into_iter().map(|head| head.name).collect();
            Ok(case_conflicts(&branches, &local).into_keys().collect())
        }).await?
    };
    let missing: Vec<&BranchHead> = branches.iter()
        .filter(|head| !known.contains(&head.commit) && !conflicted.contains(&head.name))
        .collect();
    if !missing.is_empty() {
        let prefix = tracking_prefix(&machine);
        let refs = missing.iter().map(|head| format!("refs/heads/{}", head.name)).collect();
        let refspecs = missing.iter().map(|head| format!("+refs/heads/{0}:{prefix}{0}", head.name)).collect();
        fetch_from_peer(&app, dir.clone(), &machine, &peer_path, refs, refspecs, false).await?;
    }
    // Id di questa macchina (R-MI-48): decide chi unisce il diario divergente.
    // Se manca (collegamento mai configurato) l'unione del diario non parte e
    // la divergenza resta quella di R-MI-22.
    let local_id = crate::link::local_machine_id(&app).await.ok();
    let report_machine = machine.clone();
    blocking(move || {
        // Una cima che il pacchetto non ha portato (branch spostata nel
        // frattempo) si salta: la vedra' il giro successivo.
        let shas: Vec<&str> = branches.iter().map(|head| head.commit.as_str()).collect();
        let known = known_commits(&dir, &shas)?;
        let present: Vec<BranchHead> = branches.into_iter()
            .filter(|head| known.contains(&head.commit) || conflicted.contains(&head.name))
            .collect();
        reconcile(&dir, &machine, local_id.as_deref(), &present, &busy_paths)
            .map(|branches| CopySyncReport { machine: report_machine, branches })
    }).await
}

#[tauri::command]
pub async fn copy_wip_snapshot(project_path: String) -> Result<WipSnapshot, String> {
    blocking(move || snapshot(Path::new(&project_path))).await
}

/// Riceve l'istantanea `id` dalla copia di `machine` e la applica qui
/// (R-MI-28). Idempotente (A3): se e' gia' applicata torna successo senza
/// riapplicare, cosi' un nuovo tentativo dopo una caduta prima di
/// `copy_wip_finish` converge. Verifica anche che `commit` sia esattamente il
/// valore di `refs/studio/wip/<id>` ricevuto e abbia genitore `base` (B2).
#[tauri::command]
pub async fn copy_wip_receive(app: tauri::AppHandle, project_path: String, machine: String, peer_path: String, id: String, base: String, commit: String) -> Result<(), String> {
    if !valid_wip_id(&id) || !is_hash(&base) || !is_hash(&commit) { return Err("Invalid snapshot".into()); }
    let _guard = SyncGuard::acquire(&project_path)?;
    let dir = PathBuf::from(&project_path);
    let reference = format!("refs/studio/wip/{id}");
    let present = { let (dir, commit) = (dir.clone(), commit.clone()); blocking(move || Ok(has_commit(&dir, &commit))).await? };
    if present {
        let (dir, reference, commit) = (dir.clone(), reference.clone(), commit.clone());
        blocking(move || git(&dir, &["update-ref", &reference, &commit]).map(|_| ())).await?;
    } else {
        fetch_from_peer(&app, dir.clone(), &machine, &peer_path, vec![reference.clone()], vec![format!("+{reference}:{reference}")], true).await?;
    }
    blocking(move || {
        // Il ref ricevuto deve valere esattamente il commit dichiarato (B2) e
        // quel commit deve avere `base` come genitore: si rifiuta un albero
        // arbitrario gia' presente nel repository.
        let received = git(&dir, &["rev-parse", "--verify", &reference])?;
        if received != commit { return Err("Snapshot mismatch".into()); }
        if git(&dir, &["rev-parse", &format!("{commit}^")])? != base {
            return Err("Istantanea non basata sul commit indicato".into());
        }
        receive_snapshot(&dir, &id, &base, &commit)
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
        if let Some(parent) = dir.join(file).parent() { std::fs::create_dir_all(parent).unwrap(); }
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

    /// Il viaggio di un pacchetto senza collegamento: aperto sull'host, letto
    /// a pezzi e ricomposto come fa `fetch_from_peer` (R-MI-33).
    fn transfer(ticket: BundleTicket, wip: bool) -> TempPath {
        let mut writer = BundleWriter::new(&ticket).unwrap();
        while writer.written < ticket.size {
            let chunk = read_bundle_chunk(&ticket.id, writer.written, wip).unwrap();
            writer.push(&chunk).unwrap();
        }
        writer.finish().unwrap()
    }

    /// Porta in `target` i commit di `source`, come il giro di rete vero.
    fn fetch_into(target: &Path, source: &Path, machine: &str) {
        let peer = heads(source).unwrap();
        let missing: Vec<&BranchHead> = peer.iter().filter(|head| !has_commit(target, &head.commit)).collect();
        if missing.is_empty() { return; }
        let refs: Vec<String> = missing.iter().map(|head| format!("refs/heads/{}", head.name)).collect();
        let bundle = transfer(create_bundle(source, &refs, &local_tips(target).unwrap()).unwrap(), false);
        let specs: Vec<String> = missing.iter().map(|head| format!("+refs/heads/{0}:{1}{0}", head.name, tracking_prefix(machine))).collect();
        fetch_bundle(target, &bundle.0, &specs).unwrap();
    }

    /// Un giro di sincronizzazione di `target` verso `source` con l'id della
    /// macchina di qui: serve a scegliere chi unisce il diario (R-MI-48).
    fn sync_as(target: &Path, source: &Path, machine: &str, local_id: Option<&str>, busy: &[String]) -> Vec<BranchSync> {
        fetch_into(target, source, machine);
        let peer = heads(source).unwrap();
        reconcile(target, machine, local_id, &peer, busy).unwrap()
    }

    /// Un giro di sincronizzazione di `win` verso `mac`, senza collegamento.
    /// L'id locale e' maggiore di quello del peer: se il diario diverge e'
    /// l'altra macchina a unirlo.
    fn sync(win: &Path, mac: &Path, busy: &[String]) -> Vec<BranchSync> {
        sync_as(win, mac, "mac", Some("zz-local"), busy)
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
    fn a_busy_copy_waits_instead_of_moving() {
        let (_root, mac, win) = pair();
        commit(&mac, "b.txt", "b");
        let report = sync(&win, &mac, &[win.to_string_lossy().to_string()]);
        assert_eq!((report[0].state, report[0].reason.as_deref()), (BranchState::Pending, Some("busy")));
        assert_eq!(sync(&win, &mac, &[])[0].state, BranchState::Advanced);
    }

    #[test]
    fn a_dirty_file_the_incoming_commits_do_not_touch_advances_and_keeps_the_change() {
        // R-MI-47: il diario scritto e non committato non blocca piu' i commit
        // che toccano altri file.
        let (_root, mac, win) = pair();
        std::fs::create_dir_all(win.join("docs/diario")).unwrap();
        std::fs::create_dir_all(mac.join("docs/diario")).unwrap();
        std::fs::write(mac.join("docs/diario/2026-11.md"), "# Diario\n").unwrap();
        run(&mac, &["add", "-A"]);
        run(&mac, &["commit", "-q", "-m", "diario"]);
        sync(&win, &mac, &[]);
        let head = commit(&mac, "src/a.ts", "export {};\n");
        std::fs::write(win.join("docs/diario/2026-11.md"), "# Diario\n- voce locale\n").unwrap();
        let report = sync(&win, &mac, &[]);
        assert_eq!((report[0].state, report[0].behind), (BranchState::Advanced, 1));
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), head);
        assert_eq!(std::fs::read_to_string(win.join("docs/diario/2026-11.md")).unwrap(), "# Diario\n- voce locale\n");
        assert_eq!(run(&win, &["status", "--porcelain"]), "M docs/diario/2026-11.md");
        assert_eq!(run(&win, &["diff", "--cached", "--name-only"]), "", "niente in stage");
    }

    /// `o.txt` presente su entrambe le copie, cosi' una modifica locale e una
    /// remota hanno una base comune su cui fare la fusione a tre vie.
    fn pair_with_shared_file(mac: &Path, win: &Path) {
        commit(mac, "o.txt", "l1\nl2\nl3\n");
        sync(win, mac, &[]);
    }

    #[test]
    fn dirty_changes_that_the_incoming_commits_touch_are_reapplied_cleanly() {
        // R-MI-47: parti diverse dello stesso file si uniscono e la modifica
        // locale resta, non in stage.
        let (_root, mac, win) = pair();
        pair_with_shared_file(&mac, &win);
        commit(&mac, "o.txt", "rem\nl2\nl3\n");
        std::fs::write(win.join("o.txt"), "l1\nl2\nloc\n").unwrap();
        let report = sync(&win, &mac, &[]);
        assert_eq!(report[0].state, BranchState::Advanced, "{:?}", report[0].reason);
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), run(&mac, &["rev-parse", "HEAD"]));
        assert_eq!(std::fs::read_to_string(win.join("o.txt")).unwrap(), "rem\nl2\nloc\n");
        assert_eq!(run(&win, &["status", "--porcelain"]), "M o.txt");
        assert_eq!(run(&win, &["diff", "--cached", "--name-only"]), "", "modifica non in stage");
    }

    #[test]
    fn a_conflicting_reapply_leaves_head_and_files_untouched() {
        // R-MI-47: se le modifiche locali non si riapplicano, la copia torna
        // esattamente com'era e il motivo nomina il file.
        let (_root, mac, win) = pair();
        pair_with_shared_file(&mac, &win);
        commit(&mac, "o.txt", "remote\n");
        std::fs::write(win.join("o.txt"), "local\n").unwrap();
        let before = run(&win, &["rev-parse", "HEAD"]);
        let report = sync(&win, &mac, &[]);
        assert_eq!(report[0].state, BranchState::Pending);
        assert_eq!(report[0].reason.as_deref(), Some("conflict:o.txt"));
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), before);
        assert_eq!(std::fs::read_to_string(win.join("o.txt")).unwrap(), "local\n");
        assert_eq!(run(&win, &["status", "--porcelain"]), "M o.txt");
        assert_eq!(run(&win, &["diff", "--cached", "--name-only"]), "", "modifica non in stage");
        // Nessun file di appoggio lasciato indietro dalla fusione.
        assert_eq!(run(&win, &["ls-files", "-u"]), "");
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

    /// Diario di partenza condiviso, poi una voce per parte.
    fn diverged_journal(mac: &Path, win: &Path) -> (String, String) {
        std::fs::create_dir_all(mac.join("docs/diario")).unwrap();
        std::fs::write(mac.join("docs/diario/2026-11.md"), "# Diario\n\n## 2026-11-23\n- base\n").unwrap();
        run(mac, &["add", "-A"]);
        run(mac, &["commit", "-q", "-m", "diario"]);
        sync(win, mac, &[]);
        std::fs::write(mac.join("docs/diario/2026-11.md"), "# Diario\n\n## 2026-11-23\n- base\n- dal mac\n").unwrap();
        let theirs = commit(mac, "docs/diario/2026-11.md", "# Diario\n\n## 2026-11-23\n- base\n- dal mac\n");
        let mine = commit(win, "docs/diario/2026-11.md", "# Diario\n\n## 2026-11-23\n- base\n- dal win\n");
        (mine, theirs)
    }

    #[test]
    fn a_disjunction_only_in_the_journal_is_merged_by_the_lower_machine_id() {
        // R-MI-48: unisce solo la macchina con id minore, con un contenuto
        // che tiene le righe di entrambe.
        let (_root, mac, win) = pair();
        let (mine, theirs) = diverged_journal(&mac, &win);
        let report = sync_as(&win, &mac, "mac", Some("aaa-local"), &[]);
        assert_eq!(report[0].state, BranchState::MergedJournal, "{:?}", report[0].reason);
        // Il commit di unione ha due genitori: il mio e quello del peer.
        let merger = run(&win, &["rev-parse", "HEAD"]);
        assert_ne!(merger, mine);
        assert_ne!(merger, theirs);
        let parents = run(&win, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        let mut parents = parents.split_whitespace();
        assert_eq!(parents.next(), Some(merger.as_str()));
        assert_eq!(parents.next(), Some(mine.as_str()), "primo genitore: ours");
        assert_eq!(parents.next(), Some(theirs.as_str()), "secondo genitore: theirs");
        assert_eq!(parents.next(), None);
        let journal = std::fs::read_to_string(win.join("docs/diario/2026-11.md")).unwrap();
        assert!(journal.contains("- dal mac"), "{journal}");
        assert!(journal.contains("- dal win"), "{journal}");
        assert_eq!(run(&win, &["status", "--porcelain"]), "", "cartella pulita");
    }

    #[test]
    fn the_higher_machine_waits_for_the_journal_union_then_fast_forwards() {
        // R-MI-48: l'altra macchina non unisce, aspetta `journalPeer`; al giro
        // successivo legge il commit di unione e avanza.
        let (_root, mac, win) = pair();
        let (_mine, _theirs) = diverged_journal(&mac, &win);
        let waiting = sync_as(&win, &mac, "mac", Some("zzz-local"), &[]);
        assert_eq!((waiting[0].state, waiting[0].reason.as_deref()), (BranchState::Pending, Some("journalPeer")));
        // La macchina con id minore unisce.
        let merged = sync_as(&win, &mac, "mac", Some("aaa-local"), &[]);
        assert_eq!(merged[0].state, BranchState::MergedJournal);
        let union = run(&win, &["rev-parse", "HEAD"]);
        // L'altra copia legge l'unione e arriva alla stessa cima.
        let follower = sync_as(&mac, &win, "win", Some("zzz-local"), &[]);
        assert_eq!(follower[0].state, BranchState::Advanced);
        assert_eq!(run(&mac, &["rev-parse", "HEAD"]), union);
        // Entrambe le cime coincidono e il giro dopo e' Equal.
        assert_eq!(sync_as(&mac, &win, "win", Some("zzz-local"), &[])[0].state, BranchState::Equal);
    }

    #[test]
    fn a_disjunction_with_source_files_stays_diverged() {
        // R-MI-48: basta un file fuori dal diario e la divergenza resta
        // quella di R-MI-22, senza unione.
        let (_root, mac, win) = pair();
        let (mine, _theirs) = diverged_journal(&mac, &win);
        commit(&win, "src/a.ts", "export {};\n");
        let before = run(&win, &["rev-parse", "HEAD"]);
        let report = sync_as(&win, &mac, "mac", Some("aaa-local"), &[]);
        assert_eq!(report[0].state, BranchState::Diverged);
        assert_eq!(run(&win, &["rev-parse", "HEAD"]), before);
        assert_ne!(before, mine);
    }

    #[test]
    fn the_journal_union_never_touches_files_outside_the_journal() {
        // Il commit di unione conserva gli altri file del mio albero.
        let (_root, mac, win) = pair();
        diverged_journal(&mac, &win);
        let report = sync_as(&win, &mac, "mac", Some("aaa-local"), &[]);
        assert_eq!(report[0].state, BranchState::MergedJournal);
        // `a.txt` era nel commit di partenza e non e' cambiato.
        assert_eq!(run(&win, &["show", "HEAD:a.txt"]), "a");
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
    fn a_lane_worktree_advances_in_its_own_folder_keeping_untouched_scratch_files() {
        let (root, mac, win) = pair();
        run(&mac, &["branch", "lane"]);
        let lane = root.0.join("win-lane");
        run(&win, &["worktree", "add", "-q", "-b", "lane", lane.to_str().unwrap()]);
        run(&mac, &["checkout", "-q", "lane"]);
        let head = commit(&mac, "l.txt", "l");
        // Un file nuovo che i commit in arrivo non toccano non ferma piu'
        // l'avanzamento (R-MI-47) e resta al suo posto.
        std::fs::write(lane.join("scratch.txt"), "wip").unwrap();
        let state = |report: &[BranchSync]| report.iter().find(|branch| branch.name == "lane").map(|branch| (branch.state, branch.reason.clone())).unwrap();
        assert_eq!(state(&sync(&win, &mac, &[])).0, BranchState::Advanced);
        assert_eq!(run(&lane, &["rev-parse", "HEAD"]), head);
        assert!(lane.join("l.txt").exists());
        assert_eq!(std::fs::read_to_string(lane.join("scratch.txt")).unwrap(), "wip");
    }

    #[test]
    fn a_win_ahead_of_mac_waits_for_mac_to_read() {
        let (_root, mac, win) = pair();
        commit(&win, "c.txt", "c");
        assert_eq!(sync(&win, &mac, &[])[0].state, BranchState::Ahead);
    }

    #[test]
    fn uncommitted_changes_move_with_a_snapshot_and_the_source_recovers_from_the_ref() {
        let (_root, mac, win) = pair();
        commit(&mac, "gone.txt", "x");
        sync(&win, &mac, &[]);
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        std::fs::write(mac.join("new.txt"), "new").unwrap();
        std::fs::remove_file(mac.join("gone.txt")).unwrap();

        let snap = snapshot(&mac).unwrap();
        assert_eq!((snap.branch.as_str(), snap.files), ("main", 3));
        let reference = format!("refs/studio/wip/{}", snap.id);
        // Il pacchetto WIP esce solo dal comando dedicato (A6).
        let bundle = transfer(create_wip_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap(), true);
        fetch_bundle(&win, &bundle.0, &[format!("+{reference}:{reference}")]).unwrap();
        apply_snapshot(&win, &snap.base, &snap.commit).unwrap();
        assert_eq!(std::fs::read_to_string(win.join("a.txt")).unwrap(), "changed");
        assert_eq!(std::fs::read_to_string(win.join("new.txt")).unwrap(), "new");
        assert!(!win.join("gone.txt").exists());
        assert_eq!(run(&win, &["diff", "--cached", "--name-only"]), "", "nothing staged");

        finish_snapshot(&mac, &snap.id).unwrap();
        assert_eq!(run(&mac, &["status", "--porcelain"]), "");
        // Lo stash dell'utente non viene toccato (M4): il recupero resta dal ref.
        assert!(!run(&mac, &["stash", "list"]).contains(&snap.id));
        assert_eq!(run(&mac, &["rev-parse", "--verify", &reference]), snap.commit);
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
        let bundle = transfer(create_wip_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap(), true);
        fetch_bundle(&win, &bundle.0, &[format!("+{reference}:{reference}")]).unwrap();
        std::fs::write(win.join("mine.txt"), "mine").unwrap();
        assert!(apply_snapshot(&win, &snap.base, &snap.commit).is_err());
        std::fs::remove_file(win.join("mine.txt")).unwrap();
        commit(&win, "other.txt", "o");
        assert!(apply_snapshot(&win, &snap.base, &snap.commit).is_err());
    }

    #[test]
    fn a_snapshot_that_cannot_start_leaves_the_users_files_alone() {
        let (_root, mac, win) = pair();
        std::fs::write(mac.join("new.txt"), "new").unwrap();
        let snap = snapshot(&mac).unwrap();
        let reference = format!("refs/studio/wip/{}", snap.id);
        let bundle = transfer(create_wip_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap(), true);
        fetch_bundle(&win, &bundle.0, &[format!("+{reference}:{reference}")]).unwrap();
        // Un file ignorato dell'utente con lo stesso nome di un file nuovo
        // dell'istantanea, e un indice bloccato: `read-tree` fallisce prima di
        // toccare qualcosa, e il ripristino non deve cancellare quel file.
        std::fs::write(win.join(".git/info/exclude"), "new.txt\n").unwrap();
        std::fs::write(win.join("new.txt"), "user").unwrap();
        std::fs::write(win.join(".git/index.lock"), "").unwrap();
        assert!(apply_snapshot(&win, &snap.base, &snap.commit).is_err());
        assert_eq!(std::fs::read_to_string(win.join("new.txt")).unwrap(), "user");
    }

    #[test]
    fn names_from_the_other_machine_cannot_smuggle_options_or_refspecs() {
        for bad in ["-x", "a..b", "a:b", "a b", "x^", "@{1}", "a/", "/a", "a.lock"] {
            assert!(!valid_branch(bad), "{bad}");
        }
        assert!(valid_branch("feature/copy-sync"));
        assert!(create_bundle(Path::new("."), &["refs/tags/v1".into()], &[]).is_err());
    }

    #[test]
    fn read_bundle_rejects_wip_but_wip_bundle_accepts_only_wip() {
        let (_root, mac, _win) = pair();
        // Lo scope read non deve esportare il WIP non committato (A6).
        assert!(create_bundle(&mac, &["refs/studio/wip/abc123".into()], &[]).is_err());
        assert!(create_bundle(&mac, &["refs/heads/main".into()], &[]).is_ok());
        // Il pacchetto dedicato al WIP accetta solo le istantanee.
        assert!(create_wip_bundle(&mac, &["refs/studio/wip/abc123".into()], &[]).is_err(), "wip id non valido come branch");
        assert!(create_wip_bundle(&mac, &["refs/heads/main".into()], &[]).is_err());
        let snap = {
            std::fs::write(mac.join("a.txt"), "changed").unwrap();
            snapshot(&mac).unwrap()
        };
        let reference = format!("refs/studio/wip/{}", snap.id);
        assert!(create_wip_bundle(&mac, &[reference], &[]).is_ok());
    }

    #[test]
    fn a_detached_worktree_blocks_branch_advance() {
        let (_root, mac, win) = pair();
        run(&mac, &["branch", "feature"]);
        run(&win, &["branch", "feature"]);
        run(&mac, &["checkout", "-q", "feature"]);
        let head = commit(&mac, "f.txt", "f");
        run(&mac, &["checkout", "-q", "main"]);
        // win resta su main: la branch feature non e' in uso. Ora si stacca il
        // worktree principale di win: la regola conservativa (M2) lo tratta
        // come occupato per tutte le branch e non avanza feature via update-ref.
        run(&win, &["checkout", "-q", "--detach", "refs/heads/main"]);
        let report = sync(&win, &mac, &[]);
        let state = report.iter().find(|branch| branch.name == "feature")
            .map(|branch| (branch.state, branch.reason.clone())).unwrap();
        assert_eq!(state, (BranchState::Pending, Some("detached".into())));
        assert_ne!(run(&win, &["rev-parse", "refs/heads/feature"]), head);
        // Rimettendo main in uso l'avanzamento torna possibile.
        run(&win, &["checkout", "-q", "main"]);
        let state = sync(&win, &mac, &[]).iter().find(|branch| branch.name == "feature")
            .map(|branch| branch.state).unwrap();
        assert_eq!(state, BranchState::Advanced);
    }

    #[test]
    fn a_repo_without_commits_has_no_snapshot_head() {
        let root = TempPath::new("");
        std::fs::create_dir_all(&root.0).unwrap();
        run(&root.0, &["init", "-q", "-b", "main"]);
        assert!(!has_head(&root.0));
        assert!(snapshot(&root.0).is_err());
        assert!(create_bundle(&root.0, &["refs/heads/main".into()], &[]).is_err());
    }

    #[test]
    fn machine_key_keeps_the_hex_id_intact() {
        // L'id e' esadecimale: nessun carattere da collassare, si conserva (M6).
        assert_eq!(machine_key("0123456789abcdef"), "0123456789abcdef");
        assert_eq!(machine_key("ABCDEF0123"), "ABCDEF0123");
    }

    #[test]
    fn sync_guard_uses_the_canonical_path() {
        let (_root, mac, _win) = pair();
        let path = mac.to_string_lossy().to_string();
        let _guard = SyncGuard::acquire(&path).unwrap();
        // La stessa cartella con un'altra grafia non entra in parallelo (M7).
        let with_dot = format!("{path}/./");
        assert!(SyncGuard::acquire(&with_dot).is_err());
    }

    #[test]
    fn receive_snapshot_is_idempotent() {
        let (_root, mac, win) = pair();
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        let snap = snapshot(&mac).unwrap();
        let reference = format!("refs/studio/wip/{}", snap.id);
        let bundle = transfer(create_wip_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap(), true);
        fetch_bundle(&win, &bundle.0, &[format!("+{reference}:{reference}")]).unwrap();
        receive_snapshot(&win, &snap.id, &snap.base, &snap.commit).unwrap();
        // Un secondo tentativo converge senza riapplicare (A3).
        receive_snapshot(&win, &snap.id, &snap.base, &snap.commit).unwrap();
        assert_eq!(std::fs::read_to_string(win.join("a.txt")).unwrap(), "changed");
        assert_eq!(run(&win, &["rev-parse", "--verify", &wip_applied_reference(&snap.id)]), snap.commit);
    }

    #[test]
    fn receive_converges_even_if_the_marker_was_never_written() {
        // Caduta dopo l'applicazione ma prima di scrivere
        // `refs/studio/wip-applied/<id>`: un nuovo tentativo deve riconoscere
        // l'istantanea gia' materializzata confrontando l'albero (A3) e non
        // fallire sulla copia «sporca».
        let (_root, mac, win) = pair();
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        let snap = snapshot(&mac).unwrap();
        let reference = format!("refs/studio/wip/{}", snap.id);
        let bundle = transfer(create_wip_bundle(&mac, std::slice::from_ref(&reference), &local_tips(&win).unwrap()).unwrap(), true);
        fetch_bundle(&win, &bundle.0, &[format!("+{reference}:{reference}")]).unwrap();
        apply_snapshot(&win, &snap.base, &snap.commit).unwrap();
        // Nessun marcatore, ma il working tree coincide con l'istantanea.
        assert!(git(&win, &["rev-parse", "--verify", "-q", &wip_applied_reference(&snap.id)]).is_err());
        receive_snapshot(&win, &snap.id, &snap.base, &snap.commit).unwrap();
        assert_eq!(std::fs::read_to_string(win.join("a.txt")).unwrap(), "changed");
    }

    #[test]
    fn snapshot_refuses_a_commit_with_a_different_parent() {
        // B2: il commit dichiarato deve avere `base` come genitore. Si
        // costruisce una catena di commit su win e si dichiara come istantanea
        // un commit il cui genitore non e' la base richiesta: l'applicazione
        // deve rifiutarlo, non forzare un albero arbitrario.
        let (_root, _mac, win) = pair();
        let base = run(&win, &["rev-parse", "HEAD"]);
        commit(&win, "b.txt", "b");
        commit(&win, "c.txt", "c");
        let wrong = run(&win, &["rev-parse", "HEAD"]);
        run(&win, &["checkout", "-q", &base]);
        let err = apply_snapshot(&win, &base, &wrong).unwrap_err();
        assert!(err.contains("Istantanea non basata") || err.contains("not based"), "{err}");
    }

    /// Byte che git non riesce a comprimere: il pacchetto pesa quanto il file.
    fn incompressible(len: usize) -> Vec<u8> {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        (0..len).map(|_| { state ^= state << 13; state ^= state >> 7; state ^= state << 17; state as u8 }).collect()
    }

    #[test]
    fn a_commit_larger_than_one_piece_arrives_whole() {
        // Prima il pacchetto viaggiava in una sola risposta e oltre i 60 MB
        // falliva (R-MI-33): ora passa a pezzi, qui piu' di uno.
        let (_root, mac, win) = pair();
        std::fs::write(mac.join("big.bin"), incompressible(BUNDLE_CHUNK_SIZE + 1024 * 1024)).unwrap();
        run(&mac, &["add", "-A"]);
        run(&mac, &["commit", "-q", "-m", "big"]);
        let ticket = create_bundle(&mac, &["refs/heads/main".into()], &local_tips(&win).unwrap()).unwrap();
        assert!(ticket.size > BUNDLE_CHUNK_SIZE as u64, "il pacchetto deve stare in piu' pezzi");
        let synced = sync(&win, &mac, &[]);
        assert_eq!(synced[0].state, BranchState::Advanced);
        assert!(win.join("big.bin").exists());
    }

    #[test]
    fn a_damaged_bundle_is_refused_before_git() {
        let (_root, mac, win) = pair();
        commit(&mac, "b.txt", "b");
        let mut ticket = create_bundle(&mac, &["refs/heads/main".into()], &local_tips(&win).unwrap()).unwrap();
        let real = ticket.clone();
        ticket.sha256 = "0".repeat(64);
        let mut writer = BundleWriter::new(&ticket).unwrap();
        while writer.written < ticket.size {
            let chunk = read_bundle_chunk(&real.id, writer.written, false).unwrap();
            writer.push(&chunk).unwrap();
        }
        assert!(writer.finish().is_err());
    }

    #[test]
    fn wip_pieces_need_the_wip_command() {
        // Un peer in sola lettura usa il comando delle branch: anche con l'id
        // giusto non legge un pacchetto di modifiche non committate (A6).
        let (_root, mac, _win) = pair();
        std::fs::write(mac.join("a.txt"), "changed").unwrap();
        let snap = snapshot(&mac).unwrap();
        let ticket = create_wip_bundle(&mac, &[format!("refs/studio/wip/{}", snap.id)], &[]).unwrap();
        assert!(read_bundle_chunk(&ticket.id, 0, false).is_err());
        assert!(read_bundle_chunk(&ticket.id, 0, true).is_ok());
    }

    #[test]
    fn branches_differing_only_by_case_are_reported_and_left_alone() {
        // R-MI-35: `Feature` sul Mac e `feature` qui finirebbero nello stesso
        // file di riferimento su macOS e Windows.
        let (_root, mac, win) = pair();
        run(&mac, &["branch", "Feature"]);
        run(&win, &["branch", "feature"]);
        let before = run(&win, &["rev-parse", "feature"]);
        let report = sync(&win, &mac, &[]);
        let conflict = report.iter().find(|branch| branch.name == "Feature").unwrap();
        assert_eq!(conflict.state, BranchState::CaseConflict);
        assert_eq!(conflict.reason.as_deref(), Some("feature"));
        assert_eq!(run(&win, &["rev-parse", "feature"]), before, "la branch di qui resta com'era");
        assert_eq!(run(&win, &["for-each-ref", &format!("{}Feature", tracking_prefix("mac"))]), "", "nessun riferimento di tracciamento");
    }

    #[test]
    fn the_move_estimate_counts_modified_new_and_deleted_files() {
        let (_root, mac, _win) = pair();
        commit(&mac, "gone.txt", "x");
        std::fs::write(mac.join("a.txt"), "12345").unwrap();
        std::fs::write(mac.join("new.txt"), "123").unwrap();
        std::fs::remove_file(mac.join("gone.txt")).unwrap();
        assert_eq!(estimate_wip(&mac).unwrap(), WipEstimate { files: 3, bytes: 8 });
    }
}
