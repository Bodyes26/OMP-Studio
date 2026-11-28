//! Commit automatici di Studio sul repository: il lavoro dell'agente a fine
//! turno (R-MI-73) e le modifiche in sospeso di una copia per «Allinea tutto»
//! (R-MI-74).
//!
//! R-MI-73 non committa «tutto quello che e' sporco»: confronta lo stato del
//! working tree all'inizio del turno (istantanea presa da
//! `git_turn_snapshot`) con quello alla fine e prende solo i file cambiati in
//! quel mezzo. Un file gia' modificato a mano prima del turno e non toccato
//! dall'agente resta fuori dal commit, e anche un file nuovo creato prima del
//! turno. Il commit e' path-scoped come quello del diario (R-MI-46): gli altri
//! file sporchi dell'utente restano non committati.
//!
//! Le operazioni si serializzano per repository con il `SyncGuard` della serie
//! delle copie (`copies.rs`): due `git commit` paralleli sullo stesso indice
//! finirebbero in `index.lock`, e la stessa guardia tiene gia' fuori i giri di
//! sincronizzazione. Chi la trova occupata riprova per un paio di secondi e
//! poi risponde `busy` invece di far fallire il turno.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use super::copies::{is_busy_in_backend, SyncGuard};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Quante volte si riprova un git che scrive prima di dichiarare l'indice
/// occupato. Con l'attesa sotto sono un paio di secondi.
const LOCK_ATTEMPTS: u32 = 12;
const LOCK_WAIT: Duration = Duration::from_millis(200);

/// Identita' dei commit di Studio: le stesse variabili che usa l'unione delle
/// copie, cosi' un repository senza `user.name` configurato non fa fallire il
/// commit di fine turno con un errore grezzo di git.
const STUDIO_IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "OMP Studio"),
    ("GIT_AUTHOR_EMAIL", "studio@omp.local"),
    ("GIT_COMMITTER_NAME", "OMP Studio"),
    ("GIT_COMMITTER_EMAIL", "studio@omp.local"),
];

/// Voce dell'istantanea: un file sporco o nuovo non ignorato e l'impronta del
/// suo contenuto (`git hash-object`). Per un file cancellato l'impronta e'
/// vuota: non c'e' contenuto da confrontare, la cancellazione e' il cambiamento.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotEntry {
    pub path: String,
    pub hash: String,
}

/// Esito del commit di fine turno (R-MI-73).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnCommit {
    /// File entrati nel commit, in ordine di percorso.
    pub committed: Vec<String>,
    pub commit: Option<String>,
    /// Perche' non si e' committato, quando non si e' committato.
    pub skipped: Option<String>,
}

/// Esito del commit di «Allinea tutto» (R-MI-74).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingCommit {
    pub commit: Option<String>,
    pub skipped: Option<String>,
}

/// Un file sporco secondo `git status --porcelain=v2 -z`.
#[derive(Debug, Clone)]
struct DirtyFile {
    path: String,
    /// Cancellato nel working tree: non ha un contenuto da calcolare.
    deleted: bool,
}

// ── git ────────────────────────────────────────────────────────────────────

fn git_env(extra: &[(&str, &str)], read: bool) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        ("LC_ALL".into(), "C".into()),
        ("LANGUAGE".into(), "C".into()),
        // Mai una richiesta di credenziali a meta' di un commit automatico.
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
    ];
    if read {
        // Le sole letture non devono prendere `index.lock`: altrimenti lo
        // stato letto mentre l'agente scrive blocca il commit che segue.
        env.push(("GIT_OPTIONAL_LOCKS".into(), "0".into()));
    }
    for (key, value) in extra {
        env.push(((*key).to_string(), (*value).to_string()));
    }
    env
}

fn run_git(
    dir: &Path,
    args: &[&str],
    extra: &[(&str, &str)],
    read: bool,
    stdin: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir)
        .args(["-c", "core.autocrlf=false", "-c", "core.filemode=false"])
        .args(args)
        .envs(git_env(extra, read))
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("git {}: {error}", args.join(" ")))?;
    if let Some(input) = stdin {
        use std::io::Write;
        // Scrittura su un thread: con molti percorsi git potrebbe riempire
        // stdout prima di aver finito di leggere stdin.
        let mut pipe = child.stdin.take().ok_or("git stdin unavailable")?;
        let input = input.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&input);
        });
    }
    let out = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        });
    }
    Ok(out.stdout)
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, &[], true, None).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

fn git_write(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, &[], false, None).map(|out| String::from_utf8_lossy(&out).trim().to_string())
}

// ── stato del working tree ─────────────────────────────────────────────────

/// Divide una riga `--porcelain=v2` nei suoi campi e restituisce il percorso.
/// I percorsi possono contenere spazi, quindi si taglia dopo un numero fisso
/// di campi invece di dividere tutta la riga.
fn path_after(record: &str, fields: usize) -> Option<&str> {
    let parts: Vec<&str> = record.splitn(fields + 1, ' ').collect();
    if parts.len() <= fields {
        return None;
    }
    Some(parts[fields])
}

/// File sporchi o nuovi non ignorati, con il flag «da mettere in stage».
/// `-z` separa con NUL e non mette virgolette: i nomi con spazi o caratteri
/// non ASCII arrivano intatti.
fn dirty_files(dir: &Path) -> Result<Vec<DirtyFile>, String> {
    let raw = run_git(
        dir,
        &["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        &[],
        true,
        None,
    )?;
    let text = String::from_utf8_lossy(&raw);
    let mut entries = text.split('\0').filter(|entry| !entry.is_empty());
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        let kind = entry.as_bytes().first().copied();
        match kind {
            // `? <percorso>`: non tracciato, non ignorato.
            Some(b'?') => {
                if let Some(path) = path_after(entry, 1) {
                    files.push(DirtyFile {
                        path: path.to_owned(),
                        deleted: false,
                    });
                }
            }
            // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <percorso>`
            // `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <percorso>`
            // `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <percorso>`
            Some(b'1') | Some(b'2') | Some(b'u') => {
                let fields = match kind {
                    Some(b'1') => 8,
                    Some(b'2') => 9,
                    _ => 10,
                };
                let Some(path) = path_after(entry, fields) else {
                    continue;
                };
                let xy = entry.split(' ').nth(1).unwrap_or("");
                // La lettera di sinistra e' l'indice, quella di destra il
                // working tree: una rinomina sta in una delle due a seconda di
                // dove e' stata fatta, e in entrambi i casi conta.
                let bytes = xy.as_bytes();
                let renamed = bytes.first() == Some(&b'R') || bytes.get(1) == Some(&b'R');
                // `D` nel working tree: cancellato, nessun contenuto da
                // confrontare.
                let deleted = bytes.get(1) == Some(&b'D');
                files.push(DirtyFile {
                    path: path.to_owned(),
                    deleted,
                });
                // Rinomina e copia portano il percorso di origine
                // nell'elemento successivo, separato da NUL. In una rinomina
                // l'origine non esiste piu' e fa parte dello stesso
                // cambiamento: senza, un commit path-scoped lascerebbe il
                // vecchio file al suo posto. In una copia l'origine resta e
                // non si tocca: trascinarla nel commit prenderebbe anche
                // modifiche che l'agente non ha fatto li'.
                if kind == Some(b'2') {
                    if let Some(origin) = entries.next() {
                        // In una copia (`C`) l'origine esiste ancora e non fa
                        // parte del cambiamento: conta solo il percorso nuovo.
                        if renamed {
                            files.push(DirtyFile {
                                path: origin.to_owned(),
                                deleted: true,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(files)
}

/// Impronta del contenuto di ogni file che esiste sul disco, in un solo
/// processo git (`--stdin-paths`). I file cancellati restano senza impronta:
/// sono un cambiamento anche senza contenuto da confrontare.
fn content_hashes(dir: &Path, files: &[DirtyFile]) -> Result<Vec<SnapshotEntry>, String> {
    // Un percorso puo' comparire due volte (una rinomina porta il percorso
    // nuovo e quello di origine): vale una voce sola, e la cancellazione vince
    // sul contenuto. `BTreeMap` tiene gia' l'ordine dei percorsi.
    let mut state: std::collections::BTreeMap<&str, bool> = std::collections::BTreeMap::new();
    for file in files {
        let deleted = state.entry(file.path.as_str()).or_insert(false);
        *deleted = *deleted || file.deleted;
    }
    let present: Vec<&str> = state
        .iter()
        .filter(|(path, deleted)| !**deleted && dir.join(path).is_file())
        .map(|(path, _)| *path)
        .collect();
    let mut hashes: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    if !present.is_empty() {
        // `--stdin-paths` legge percorsi separati da newline: un nome con
        // newline non e' rappresentabile qui, ma e' anche un caso che git
        // stesso non gestisce nei percorsi quotati.
        if present.iter().any(|path| path.contains('\n')) {
            return Err("Unsupported path with newline".into());
        }
        let stdin = format!("{}\n", present.join("\n"));
        let raw = run_git(
            dir,
            &["hash-object", "--stdin-paths"],
            &[],
            true,
            Some(stdin.as_bytes()),
        )?;
        let values: Vec<String> = String::from_utf8_lossy(&raw)
            .lines()
            .map(|line| line.trim().to_owned())
            .collect();
        if values.len() != present.len() {
            return Err("Unexpected hash-object output".into());
        }
        for (path, hash) in present.iter().copied().zip(values) {
            hashes.insert(path, hash);
        }
    }
    Ok(state
        .into_iter()
        .map(|(path, deleted)| SnapshotEntry {
            // Un file cancellato non ha contenuto: l'impronta vuota e' la firma
            // della cancellazione, e cambiarla non la distingue piu'.
            hash: if deleted {
                String::new()
            } else {
                hashes.get(path).cloned().unwrap_or_default()
            },
            path: path.to_owned(),
        })
        .collect())
}

fn snapshot(dir: &Path) -> Result<Vec<SnapshotEntry>, String> {
    let files = dirty_files(dir)?;
    content_hashes(dir, &files)
}

// ── condizioni che fermano il commit ───────────────────────────────────────

fn git_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let raw = git(dir, &["rev-parse", "--git-path", name]).ok()?;
    let candidate = PathBuf::from(raw.trim());
    Some(if candidate.is_absolute() {
        candidate
    } else {
        dir.join(candidate)
    })
}

/// Merge, rebase, cherry-pick o revert in corso: un commit adesso entrerebbe
/// in un'operazione dell'utente, che resta sua.
fn operation_in_progress(dir: &Path) -> bool {
    [
        "MERGE_HEAD",
        "rebase-merge",
        "rebase-apply",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
    ]
    .iter()
    .any(|name| git_path(dir, name).is_some_and(|path| path.exists()))
}

fn detached_head(dir: &Path) -> bool {
    git(dir, &["symbolic-ref", "-q", "HEAD"]).is_err()
}

/// Il repository ha gia' un commit. Su un repository senza commit `HEAD` non
/// risolve e `git commit --only` fallisce con un errore grezzo che all'utente
/// non dice niente: si salta, come gia' fa l'istantanea delle copie (M3).
fn has_head(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
}

/// Un prototipo del Laboratorio non si committa mai (R-MI-73): le revisioni le
/// gestisce il Laboratorio con i propri comandi.
fn inside_lab(dir: &Path) -> bool {
    let Some(root) = crate::lab::paths::lab_root() else {
        return false;
    };
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    let target = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    target.starts_with(root)
}

fn canonical_or_self(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Vero solo per una cartella di lavoro git. `rev-parse
/// --is-inside-work-tree` esce con 0 anche in un repository nudo, stampando
/// `false`: guardare il solo codice di uscita farebbe passare un bare repo, e
/// il `git status` che segue fallirebbe con «this operation must be run in a
/// work tree» al posto di un salto pulito.
fn is_repository(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--is-inside-work-tree"]).is_ok_and(|out| out == "true")
}

/// Prende la guardia del repository aspettando un giro in corso: fra
/// l'istantanea e il commit la sincronizzazione delle copie puo' averla in
/// mano per qualche centinaio di millisecondi. Passata l'attesa si risponde
/// `None`: il commit lo riprende il turno dopo (o il giro delle copie), non e'
/// un errore.
fn take_guard(dir: &Path) -> Result<Option<SyncGuard>, String> {
    SyncGuard::acquire_waiting(&dir.to_string_lossy())
}

// ── commit ─────────────────────────────────────────────────────────────────

/// L'errore di git dice che un altro processo tiene l'indice. Succede se la
/// sincronizzazione delle copie (o un git dell'utente) sta scrivendo adesso:
/// non e' un errore da mostrare, e' un «riprova fra un istante».
fn index_locked(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("index.lock")
        || lower.contains("unable to create")
        || lower.contains("another git process")
}

/// Git non ha trovato nulla da registrare: i file che l'istantanea dava per
/// cambiati erano tornati al contenuto di HEAD, oppure un altro processo li ha
/// gia' committati. Non e' un errore, e' un commit che non serve.
fn is_nothing_to_commit(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("nothing to commit")
        || lower.contains("nothing added to commit")
        || lower.contains("no changes added")
        || lower.contains("nothing specified")
}

/// Elenca i file da committare e li committa con un commit path-scoped
/// (R-MI-46): solo i percorsi indicati, gli altri file sporchi restano
/// dell'utente. Restituisce i file entrati nel commit.
fn commit_paths(dir: &Path, wanted: &[String], message: &str) -> Result<Vec<String>, String> {
    if wanted.is_empty() {
        return Err("nothing to commit".into());
    }
    // Un file nuovo creato e poi cancellato nello stesso turno non e' ne'
    // tracciato ne' sul disco: `git add`/`commit --only` fallirebbero sul
    // pathspec, e non c'e' niente da registrare.
    let mut paths: Vec<&str> = Vec::with_capacity(wanted.len());
    let mut untracked: Vec<&str> = Vec::new();
    for path in wanted.iter().map(String::as_str) {
        if git(dir, &["ls-files", "--error-unmatch", "--", path]).is_ok() {
            paths.push(path);
        } else if dir.join(path).exists() {
            paths.push(path);
            untracked.push(path);
        }
    }
    if paths.is_empty() {
        return Err("nothing to commit".into());
    }
    if !untracked.is_empty() {
        let mut add: Vec<&str> = vec!["add", "--"];
        add.extend(untracked.iter().copied());
        add_with_lock_retry(dir, &add)?;
    }
    let mut args: Vec<&str> = vec!["commit", "--only", "-m", message, "--"];
    args.extend(paths.iter().copied());
    match commit_with_lock_retry(dir, &args) {
        Ok(_) => Ok(paths.iter().map(|path| (*path).to_owned()).collect()),
        Err(error) => {
            // L'aggiunta appena fatta non deve restare in stage: si toglie solo
            // l'indice dei file nuovi, che restano sul disco.
            if !untracked.is_empty() {
                let mut reset: Vec<&str> = vec!["rm", "-q", "--cached", "--"];
                reset.extend(untracked.iter().copied());
                let _ = git_write(dir, &reset);
            }
            Err(if index_locked(&error) {
                "busy".into()
            } else {
                error
            })
        }
    }
}

/// Ripete un git che scrive finche' l'indice e' di qualcun altro. L'attesa e'
/// breve di proposito: se l'altro processo e' lungo, il commit si salta e lo
/// riprende il turno successivo (o il giro delle copie), non si resta appesi.
fn retry_on_lock<T>(mut run: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let mut last = Err("nothing attempted".to_string());
    for attempt in 0..LOCK_ATTEMPTS {
        match run() {
            Err(error) if index_locked(&error) && attempt + 1 < LOCK_ATTEMPTS => {
                std::thread::sleep(LOCK_WAIT);
                last = Err(error);
            }
            other => return other,
        }
    }
    last
}

fn add_with_lock_retry(dir: &Path, args: &[&str]) -> Result<String, String> {
    retry_on_lock(|| git_write(dir, args))
}

fn commit_with_lock_retry(dir: &Path, args: &[&str]) -> Result<String, String> {
    retry_on_lock(|| {
        run_git(dir, args, &STUDIO_IDENTITY, false, None)
            .map(|out| String::from_utf8_lossy(&out).trim().to_string())
    })
}

fn head_commit(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "HEAD"])
        .ok()
        .filter(|value| !value.is_empty())
}

/// File cambiati rispetto alla baseline: i nuovi, i modificati e i cancellati.
/// Un file gia' sporco prima del turno e rimasto identico non entra.
fn changed_since(baseline: &[SnapshotEntry], now: &[SnapshotEntry]) -> Vec<String> {
    let before: std::collections::HashMap<&str, &str> = baseline
        .iter()
        .map(|entry| (entry.path.as_str(), entry.hash.as_str()))
        .collect();
    let current: std::collections::HashSet<&str> =
        now.iter().map(|entry| entry.path.as_str()).collect();
    let mut changed: Vec<String> = now
        .iter()
        .filter(|entry| {
            !before
                .get(entry.path.as_str())
                .is_some_and(|hash| *hash == entry.hash.as_str())
        })
        .map(|entry| entry.path.clone())
        .collect();
    // Un file sporco all'inizio e pulito alla fine e' tornato al contenuto di
    // HEAD durante il turno: e' un cambiamento anche se `status` non lo
    // elenca piu'. Nel commit path-scoped non registra nulla (o registra il
    // ritorno a HEAD se l'indice era diverso), quindi includerlo non porta
    // dentro lavoro altrui.
    changed.extend(
        baseline
            .iter()
            .filter(|entry| !current.contains(entry.path.as_str()))
            .map(|entry| entry.path.clone()),
    );
    changed.sort();
    changed.dedup();
    changed
}

/// I file da committare per «Allinea tutto»: tutto cio' che e' in sospeso.
fn pending_paths(files: &[DirtyFile]) -> Vec<String> {
    let mut paths: Vec<String> = files.iter().map(|file| file.path.clone()).collect();
    paths.sort();
    paths.dedup();
    paths
}

// ── comandi ────────────────────────────────────────────────────────────────

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// Istantanea dei file sporchi o nuovi non ignorati (R-MI-73). La prende la
/// finestra all'inizio del turno e la ripassa al commit: senza, «cambiato
/// dall'agente» non si distingue da «sporco da prima».
#[tauri::command]
pub async fn git_turn_snapshot(project_path: String) -> Result<Vec<SnapshotEntry>, String> {
    blocking(move || {
        let dir = canonical_or_self(Path::new(&project_path));
        if !is_repository(&dir) {
            return Ok(Vec::new());
        }
        snapshot(&dir)
    })
    .await
}

/// Committa i soli file cambiati dall'inizio del turno (R-MI-73).
#[tauri::command]
pub async fn git_turn_commit(
    project_path: String,
    baseline: Vec<SnapshotEntry>,
    message: String,
) -> Result<TurnCommit, String> {
    let skipped = |reason: &str| TurnCommit {
        committed: Vec::new(),
        commit: None,
        skipped: Some(reason.to_owned()),
    };
    blocking(move || {
        let dir = canonical_or_self(Path::new(&project_path));
        if !is_repository(&dir) {
            return Ok(skipped("notGit"));
        }
        if inside_lab(&dir) {
            return Ok(skipped("lab"));
        }
        if operation_in_progress(&dir) {
            return Ok(skipped("merging"));
        }
        if detached_head(&dir) {
            return Ok(skipped("detached"));
        }
        if !has_head(&dir) {
            return Ok(skipped("noCommit"));
        }
        let Some(_guard) = take_guard(&dir)? else {
            return Ok(skipped("busy"));
        };
        // Lo stato si rilegge sotto la guardia: fra l'istantanea e il commit
        // puo' essere passato del tempo, ma la baseline resta quella del turno.
        let now = snapshot(&dir)?;
        let wanted = changed_since(&baseline, &now);
        if wanted.is_empty() {
            return Ok(skipped("nothing"));
        }
        match commit_paths(&dir, &wanted, &message) {
            Ok(committed) => Ok(TurnCommit {
                committed,
                commit: head_commit(&dir),
                skipped: None,
            }),
            Err(error) if is_nothing_to_commit(&error) => Ok(skipped("nothing")),
            Err(error) => Err(error),
        }
    })
    .await
}

/// Committa tutte le modifiche in sospeso di questa copia (R-MI-74): tracciate
/// e nuove non ignorate. Non parte con un agente al lavoro nella cartella ne'
/// durante un'unione: in quei casi la copia si nomina e si aspetta.
#[tauri::command]
pub async fn copy_commit_pending(
    project_path: String,
    message: String,
) -> Result<PendingCommit, String> {
    let skipped = |reason: &str| PendingCommit {
        commit: None,
        skipped: Some(reason.to_owned()),
    };
    blocking(move || {
        let dir = canonical_or_self(Path::new(&project_path));
        if !is_repository(&dir) {
            return Ok(skipped("notGit"));
        }
        if inside_lab(&dir) {
            return Ok(skipped("lab"));
        }
        if operation_in_progress(&dir) {
            return Ok(skipped("merging"));
        }
        if detached_head(&dir) {
            return Ok(skipped("detached"));
        }
        if !has_head(&dir) {
            return Ok(skipped("noCommit"));
        }
        // Occupazione e guardia insieme: l'agente puo' partire fra il
        // controllo e il commit, e il controllo va rifatto dentro la serie
        // serializzata per repository (A1, A2).
        let Some(_guard) = take_guard(&dir)? else {
            return Ok(skipped("busy"));
        };
        if is_busy_in_backend(&dir) {
            return Ok(skipped("busy"));
        }
        let files = dirty_files(&dir)?;
        let wanted = pending_paths(&files);
        if wanted.is_empty() {
            return Ok(skipped("nothing"));
        }
        match commit_paths(&dir, &wanted, &message) {
            Ok(_) => Ok(PendingCommit {
                commit: head_commit(&dir),
                skipped: None,
            }),
            Err(error) if is_nothing_to_commit(&error) => Ok(skipped("nothing")),
            Err(error) => Err(error),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempRepo(PathBuf);
    impl TempRepo {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("studio-turn-{}", uuid::Uuid::new_v4().simple()));
            std::fs::create_dir_all(&path).unwrap();
            let repo = Self(path);
            repo.run(&["init", "-q", "-b", "main"]);
            repo
        }
        fn run(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .envs(STUDIO_IDENTITY)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
        fn write(&self, file: &str, content: &str) {
            if let Some(parent) = self.0.join(file).parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(self.0.join(file), content).unwrap();
        }
        fn commit_all(&self, message: &str) {
            self.run(&["add", "-A"]);
            self.run(&["commit", "-q", "-m", message]);
        }
        fn tracked(&self, commit: &str) -> Vec<String> {
            // `--no-renames`: una rinomina deve mostrare sia il percorso
            // cancellato sia quello nuovo, cioe' tutto cio' che il commit tocca.
            let raw = self.run(&["show", "--name-only", "--no-renames", "--pretty=format:", commit]);
            raw.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_owned)
                .collect()
        }
    }
    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Il cuore di R-MI-73: sporco prima del turno e non toccato resta fuori;
    /// nuovo e modificato entrano; cancellato entra.
    #[test]
    fn il_commit_di_fine_turno_prende_solo_il_lavoro_del_turno() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.write("b.txt", "b");
        repo.write("c.txt", "c");
        repo.write("mano.txt", "mano");
        repo.commit_all("base");
        // Sporco prima del turno: modificato a mano e mai toccato dall'agente.
        repo.write("mano.txt", "mano, modificato prima");
        let baseline = snapshot(&repo.0).unwrap();
        assert!(baseline.iter().any(|entry| entry.path == "mano.txt"));

        // Il turno: modifica `a.txt`, cancella `b.txt`, crea `nuovo.txt`.
        repo.write("a.txt", "a, cambiato");
        std::fs::remove_file(repo.0.join("b.txt")).unwrap();
        repo.write("nuovo.txt", "nuovo");

        let now = snapshot(&repo.0).unwrap();
        let wanted = changed_since(&baseline, &now);
        assert_eq!(
            wanted,
            vec![
                "a.txt".to_string(),
                "b.txt".to_string(),
                "nuovo.txt".to_string()
            ]
        );
        let committed = commit_paths(&repo.0, &wanted, "Studio · Mac · chat").unwrap();
        assert_eq!(committed.len(), 3);

        let head = head_commit(&repo.0).unwrap();
        let mut files = repo.tracked(&head);
        files.sort();
        assert_eq!(
            files,
            vec![
                "a.txt".to_string(),
                "b.txt".to_string(),
                "nuovo.txt".to_string()
            ]
        );
        // Il file sporco di prima resta fuori dal commit e sporco.
        assert!(!files.contains(&"mano.txt".to_string()));
        assert!(git(&repo.0, &["status", "--porcelain"])
            .unwrap()
            .contains("mano.txt"));
    }

    /// Il caso che ha generato R-MI-73: un file scritto a mano prima del turno
    /// e uno nuovo creato prima del turno restano fuori, anche se l'agente
    /// tocca altri file nella stessa cartella.
    #[test]
    fn lavoro_a_mano_prima_del_turno_resta_fuori() {
        let repo = TempRepo::new();
        repo.write("tracciato.txt", "tracciato");
        repo.commit_all("base");
        repo.write("tracciato.txt", "a mano");
        repo.write("nuovo-a-mano.txt", "a mano");
        let baseline = snapshot(&repo.0).unwrap();
        repo.write("agente.txt", "agente");
        let wanted = changed_since(&baseline, &snapshot(&repo.0).unwrap());
        assert_eq!(wanted, vec!["agente.txt".to_string()]);
        commit_paths(&repo.0, &wanted, "Studio · Windows · chat").unwrap();
        let status = git(&repo.0, &["status", "--porcelain"]).unwrap();
        assert!(status.contains("tracciato.txt"));
        assert!(status.contains("nuovo-a-mano.txt"));
    }

    /// Rinomina: il percorso vecchio e quello nuovo sono lo stesso
    /// cambiamento, e il commit path-scoped deve portare entrambi.
    #[test]
    fn una_rinomina_porta_anche_il_percorso_di_origine() {
        let repo = TempRepo::new();
        repo.write("vecchio.txt", "contenuto");
        repo.commit_all("base");
        let baseline = snapshot(&repo.0).unwrap();
        std::fs::rename(repo.0.join("vecchio.txt"), repo.0.join("nuovo.txt")).unwrap();
        let now = snapshot(&repo.0).unwrap();
        let wanted = changed_since(&baseline, &now);
        assert_eq!(
            wanted,
            vec!["nuovo.txt".to_string(), "vecchio.txt".to_string()]
        );
        commit_paths(&repo.0, &wanted, "Studio · Mac · chat").unwrap();
        let head = head_commit(&repo.0).unwrap();
        let mut files = repo.tracked(&head);
        files.sort();
        assert_eq!(
            files,
            vec!["nuovo.txt".to_string(), "vecchio.txt".to_string()]
        );
        assert!(dirty_files(&repo.0).unwrap().is_empty());
    }

    /// La guardia del repository e' una sola anche quando arriva con una
    /// grafia diversa del percorso: due commit in parallelo sullo stesso
    /// indice non devono correre.
    #[test]
    fn la_guardia_riconosce_lo_stesso_repository() {
        let repo = TempRepo::new();
        let first = SyncGuard::acquire(&repo.0.to_string_lossy()).unwrap();
        assert!(SyncGuard::acquire(&repo.0.to_string_lossy()).is_err());
        drop(first);
        assert!(SyncGuard::acquire(&repo.0.to_string_lossy()).is_ok());
    }

    /// Un file gia' sporco e cambiato di nuovo dall'agente entra nel commit.
    #[test]
    fn un_file_gia_sporco_e_cambiato_ancora_entra() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        repo.write("a.txt", "sporco");
        let baseline = snapshot(&repo.0).unwrap();
        repo.write("a.txt", "sporco, piu' il turno");
        let now = snapshot(&repo.0).unwrap();
        assert_eq!(changed_since(&baseline, &now), vec!["a.txt".to_string()]);
    }

    /// Nessun cambiamento rispetto alla baseline: niente commit.
    #[test]
    fn senza_cambiamenti_non_si_committa() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        repo.write("a.txt", "sporco");
        let baseline = snapshot(&repo.0).unwrap();
        assert!(changed_since(&baseline, &snapshot(&repo.0).unwrap()).is_empty());
    }

    /// Un'unione, un rebase o un cherry-pick in corso ferma il commit.
    #[test]
    fn un_unione_in_corso_ferma_il_commit() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        assert!(!operation_in_progress(&repo.0));
        std::fs::write(git_path(&repo.0, "MERGE_HEAD").unwrap(), "0000").unwrap();
        assert!(operation_in_progress(&repo.0));
    }

    /// Un repository nudo non e' una cartella di lavoro: `rev-parse
    /// --is-inside-work-tree` esce comunque con 0, quindi il solo codice di
    /// uscita lo farebbe passare e `git status` fallirebbe dopo, con un errore
    /// grezzo. Serve la parola `true`, non l'assenza di errore.
    #[test]
    fn un_repository_nudo_non_e_una_cartella_di_lavoro() {
        let dir =
            std::env::temp_dir().join(format!("studio-bare-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(Command::new("git")
            .current_dir(&dir)
            .args(["init", "-q", "--bare"])
            .output()
            .unwrap()
            .status
            .success());
        // Il comando esce con 0 e stampa `false`: e' il caso che ingannava.
        assert!(!is_repository(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Un repository senza commit non si tocca: `git commit --only` fallirebbe
    /// con un errore grezzo (M3).
    #[test]
    fn un_repository_senza_commit_non_si_committa() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        assert!(!has_head(&repo.0));
        assert!(dirty_files(&repo.0)
            .unwrap()
            .iter()
            .any(|file| file.path == "a.txt"));
        repo.commit_all("base");
        assert!(has_head(&repo.0));
    }

    /// Un file modificato durante il turno e riportato al contenuto di HEAD
    /// resta nell'elenco dei cambiati: l'impronta e' diversa da quella di
    /// partenza. Che `git commit` non trovi nulla da registrare non e' un
    /// errore da mostrare, e' un `nothing` (e il prossimo turno riparte da
    /// un'istantanea pulita).
    #[test]
    fn un_file_riportato_al_contenuto_di_head_resta_un_cambiamento() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        repo.write("a.txt", "sporco a mano");
        let baseline = snapshot(&repo.0).unwrap();
        repo.write("a.txt", "a");
        assert_eq!(
            changed_since(&baseline, &snapshot(&repo.0).unwrap()),
            vec!["a.txt".to_string()]
        );
    }

    /// Le parole con cui git dice «non c'e' niente da committare» sono le
    /// sole che il comando traduce in `nothing`: un errore vero non lo e'.
    #[test]
    fn solo_i_messaggi_di_nulla_da_committare_sono_nothing() {
        assert!(is_nothing_to_commit(
            "nothing to commit, working tree clean"
        ));
        assert!(is_nothing_to_commit("no changes added to commit"));
        assert!(is_nothing_to_commit("Nothing specified, nothing added"));
        assert!(!is_nothing_to_commit(
            "fatal: unable to create '.git/index.lock': File exists"
        ));
        assert!(!is_nothing_to_commit(
            "error: pathspec 'a.txt' did not match any file(s) known to git"
        ));
    }

    /// Working tree pulito: «Allinea tutto» non ha niente da committare e lo
    /// dice con `nothing`, invece di far fallire git su un commit vuoto.
    #[test]
    fn un_working_tree_pulito_non_ha_niente_da_committare() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        assert!(pending_paths(&dirty_files(&repo.0).unwrap()).is_empty());
        // Un file ignorato non e' «in sospeso»: non entra nel commit ne'
        // nell'istantanea.
        repo.write(".gitignore", "ignorato.log");
        repo.commit_all("ignora");
        repo.write("ignorato.log", "rumore");
        assert!(pending_paths(&dirty_files(&repo.0).unwrap()).is_empty());
    }

    /// R-MI-74: «Allinea tutto» committa tutto cio' che e' in sospeso.
    #[test]
    fn il_commit_di_allineamento_prende_tutto_il_pendente() {
        let repo = TempRepo::new();
        repo.write("a.txt", "a");
        repo.commit_all("base");
        repo.write("a.txt", "cambiato");
        repo.write("nuovo.txt", "nuovo");
        let files = dirty_files(&repo.0).unwrap();
        let wanted = pending_paths(&files);
        assert_eq!(wanted, vec!["a.txt".to_string(), "nuovo.txt".to_string()]);
        commit_paths(&repo.0, &wanted, "Studio · Mac · allineamento").unwrap();
        let head = head_commit(&repo.0).unwrap();
        let mut tracked = repo.tracked(&head);
        tracked.sort();
        assert_eq!(tracked, vec!["a.txt".to_string(), "nuovo.txt".to_string()]);
        assert!(dirty_files(&repo.0).unwrap().is_empty());
    }
}

#[cfg(test)]
mod debug_probe {
    use super::*;
    #[test]
    fn probe() {
        let dir = std::env::temp_dir().join(format!("studio-probe-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| { let o = Command::new("git").current_dir(&dir).args(args).envs(STUDIO_IDENTITY).output().unwrap(); String::from_utf8_lossy(&o.stdout).trim().to_string() };
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("vecchio.txt"), "contenuto").unwrap();
        g(&["add", "-A"]); g(&["commit", "-q", "-m", "base"]);
        std::fs::rename(dir.join("vecchio.txt"), dir.join("nuovo.txt")).unwrap();
        let raw = run_git(&dir, &["status", "--porcelain=v2", "-z", "--untracked-files=all"], &[], true, None).unwrap();
        eprintln!("RAW={:?}", String::from_utf8_lossy(&raw));
        eprintln!("FILES={:?}", dirty_files(&dir).unwrap().iter().map(|f| format!("{}{}", f.path, if f.deleted {" (del)"} else {""})).collect::<Vec<_>>());
        eprintln!("SNAP={:?}", snapshot(&dir).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
