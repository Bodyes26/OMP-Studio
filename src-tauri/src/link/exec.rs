//! «Esegui su macchina» (R-MI-36): un comando lanciato su un'altra macchina
//! abbinata, in una cartella di lavoro dedicata al progetto e spostata al
//! commit richiesto, con log, codice d'uscita e artefatti dichiarati.
//!
//! Due lati. Chi esegue (host) tiene i job in `HOST_JOBS`: uno alla volta per
//! progetto, gli altri in fila. Chi chiede tiene i propri in `LOCAL_JOBS` e
//! interroga l'host ogni mezzo secondo con comandi del catalogo (ambito
//! Terminale): niente protocollo nuovo, permessi e registro (R-MI-39) sono
//! quelli di ogni comando instradato. L'interrogazione e' anche il guinzaglio:
//! se chi ha chiesto smette di chiedere (Studio chiuso, rete persa) l'host
//! ferma il job da solo, cosi' l'annullamento si propaga anche quando il
//! messaggio di annullamento non puo' arrivare.
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, atomic::{AtomicBool, AtomicU64, Ordering}},
    time::{Duration, Instant},
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use super::{epoch_ms, LinkManager, PeerBody};

/// Coda del log tenuta in memoria per job: i log di una build Rust superano
/// facilmente qualche MB e chi guarda vuole la fine, non l'inizio.
const LOG_CAP: usize = 4 * 1024 * 1024;
/// Log restituito per interrogazione: sotto il limite di una chiamata.
const LOG_PAGE: usize = 512 * 1024;
/// Senza interrogazioni per questo tempo il job si ferma (vedi sopra).
const LEASE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(500);
/// Pezzi degli artefatti, come i pacchetti di R-MI-33.
const CHUNK: u64 = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// I job finiti restano consultabili (e i loro artefatti scaricabili) per un'ora.
const KEEP_FINISHED_MS: u64 = 60 * 60 * 1000;
/// Oltre questo tempo senza risposta l'altra macchina conta come persa.
const UNREACHABLE_AFTER: Duration = Duration::from_secs(90);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub(crate) enum JobState {
    Queued,
    Preparing,
    Running,
    Exited { code: i32 },
    Failed { error: String },
    Cancelled,
}

impl JobState {
    pub(crate) fn finished(&self) -> bool {
        matches!(self, JobState::Exited { .. } | JobState::Failed { .. } | JobState::Cancelled)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Artifact {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// Coda del log con l'offset assoluto del primo byte tenuto.
#[derive(Default)]
pub(crate) struct LogBuffer {
    base: u64,
    bytes: Vec<u8>,
}

impl LogBuffer {
    pub(crate) fn push(&mut self, data: &[u8]) {
        self.bytes.extend_from_slice(data);
        if self.bytes.len() > LOG_CAP {
            let overflow = self.bytes.len() - LOG_CAP;
            self.bytes.drain(..overflow);
            self.base += overflow as u64;
        }
    }

    pub(crate) fn end(&self) -> u64 { self.base + self.bytes.len() as u64 }

    /// Testo dall'offset richiesto (o dal primo tenuto, se e' gia' uscito
    /// dalla coda), al massimo `max` byte, tagliato su un confine UTF-8.
    pub(crate) fn read(&self, offset: u64, max: usize) -> (u64, String, u64) {
        let start = offset.clamp(self.base, self.end());
        let from = (start - self.base) as usize;
        let mut to = (from + max).min(self.bytes.len());
        while to > from && to < self.bytes.len() && (self.bytes[to] & 0xC0) == 0x80 { to -= 1; }
        (start, String::from_utf8_lossy(&self.bytes[from..to]).into_owned(), self.base + to as u64)
    }
}

// ---------------------------------------------------------------------------
// Lato host: la macchina che esegue.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartRequest {
    pub repo_slug: Option<String>,
    pub root_commit: Option<String>,
    pub commit: String,
    /// Branch di chi chiede: se il commit qui manca, la si scarica dalla sua
    /// copia come nella sincronizzazione (R-MI-26).
    pub branch: Option<String>,
    pub peer_path: String,
    pub command: String,
    #[serde(default)]
    pub artifacts: Vec<String>,
}

struct HostJob {
    id: String,
    peer: String,
    peer_name: String,
    project_path: PathBuf,
    project_name: String,
    command: String,
    commit: String,
    state: Mutex<JobState>,
    log: Mutex<LogBuffer>,
    artifacts: Mutex<Vec<Artifact>>,
    artifacts_error: Mutex<Option<String>>,
    artifact_dir: PathBuf,
    last_poll: Mutex<Instant>,
    cancel: AtomicBool,
    started_at: u64,
    ended_at: AtomicU64,
}

impl HostJob {
    fn note(&self, line: &str) {
        self.log.lock().push(format!("[studio] {line}\n").as_bytes());
    }
    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::SeqCst) || self.last_poll.lock().elapsed() > LEASE
    }
}

static HOST_JOBS: LazyLock<Mutex<HashMap<String, Arc<HostJob>>>> = LazyLock::new(Default::default);
static PROJECT_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = LazyLock::new(Default::default);

fn exec_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("exec"))
}

fn short_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

fn authenticated_peer(request: &tauri::ipc::Request<'_>) -> Result<String, String> {
    request.headers().get("x-studio-authenticated-peer")
        .and_then(|value| value.to_str().ok()).map(str::to_owned)
        .ok_or_else(|| "Remote jobs can only be started from another machine".into())
}

fn host_job(id: &str, peer: &str) -> Result<Arc<HostJob>, String> {
    let job = HOST_JOBS.lock().get(id).cloned().ok_or("Unknown remote job")?;
    if job.peer != peer { return Err("Remote job belongs to another machine".into()); }
    Ok(job)
}

/// Copia del progetto su questa macchina con la stessa identita' di quella di
/// chi chiede: origin GitHub, altrimenti primo commit (R-MI-12). Si cerca
/// solo fra i progetti che la finestra pubblica (le radici dichiarate).
fn resolve_project(snapshot: Option<&str>, slug: Option<&str>, root: Option<&str>) -> Result<(PathBuf, String), String> {
    let snapshot: Value = snapshot.and_then(|text| serde_json::from_str(text).ok())
        .ok_or("Host window has not published its projects yet")?;
    let projects = snapshot.get("projects").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut by_root = None;
    for project in projects {
        let Some(path) = project.get("canonicalProjectPath").and_then(Value::as_str).filter(|path| !path.is_empty()) else { continue };
        let name = project.get("name").and_then(Value::as_str).unwrap_or(path).to_owned();
        let (project_slug, project_root) = crate::github::sync::repo_identity(Path::new(path));
        if slug.is_some() && project_slug.as_deref() == slug { return Ok((PathBuf::from(path), name)); }
        if slug.is_none() && project_slug.is_none() && root.is_some() && project_root.as_deref() == root {
            if by_root.is_some() { return Err("This machine has several projects with the same Git root".into()); }
            by_root = Some((PathBuf::from(path), name));
        }
    }
    by_root.ok_or_else(|| "This project is not open on the other machine".into())
}

#[tauri::command]
pub(crate) async fn exec_nightly_ready(app: tauri::AppHandle, request: tauri::ipc::Request<'_>,
    repo_slug: Option<String>, root_commit: Option<String>, platform: String,
    manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    authenticated_peer(&request)?;
    if platform != std::env::consts::OS { return Err("The machine has a different build platform".into()); }
    let runtime = manager.runtime(&app).await?;
    let snapshot = runtime.snapshot.borrow().clone();
    tokio::task::spawn_blocking(move || {
        resolve_project(snapshot.as_deref().map(String::as_str), repo_slug.as_deref(), root_commit.as_deref())?;
        #[cfg(target_os = "macos")]
        {
            let identity = std::env::var("APPLE_SIGNING_IDENTITY").unwrap_or_else(|_| "OMP Studio Self-Signed".into());
            let output = std::process::Command::new("security").args(["find-identity", "-p", "codesigning", "-v"])
                .output().map_err(|error| error.to_string())?;
            if !output.status.success() || !String::from_utf8_lossy(&output.stdout).contains(&format!("\"{identity}\"")) {
                return Err("The macOS signing identity is unavailable".into());
            }
        }
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

pub(crate) async fn check_nightly_ready(app: &tauri::AppHandle, cwd: PathBuf, machine: &str, platform: &str) -> Result<(), String> {
    let (slug, root) = tokio::task::spawn_blocking(move || crate::github::sync::repo_identity(&cwd))
        .await.map_err(|error| error.to_string())?;
    if slug.is_none() && root.is_none() { return Err("The current project has no Git identity".into()); }
    super::call_peer_with_timeout(app, machine, "exec_nightly_ready",
        &json!({ "repoSlug": slug, "rootCommit": root, "platform": platform }), Duration::from_secs(20)).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn exec_start(app: tauri::AppHandle, request: tauri::ipc::Request<'_>, job: StartRequest, manager: tauri::State<'_, LinkManager>) -> Result<Value, String> {
    let peer = authenticated_peer(&request)?;
    if job.command.trim().is_empty() { return Err("Missing command".into()); }
    if !matches!(job.commit.len(), 40 | 64) || !job.commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid commit".into());
    }
    let runtime = manager.runtime(&app).await?;
    let peer_name = runtime.config.lock().peers.get(&peer).map(|peer| peer.name.clone()).ok_or("Device pairing was revoked")?;
    let snapshot = runtime.snapshot.borrow().clone();
    let (slug, root) = (job.repo_slug.clone(), job.root_commit.clone());
    let (project_path, project_name) = tokio::task::spawn_blocking(move || {
        resolve_project(snapshot.as_deref().map(String::as_str), slug.as_deref(), root.as_deref())
    }).await.map_err(|error| error.to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    let artifact_dir = exec_root(&app)?.join("jobs").join(&id);
    runtime.audit(&peer, "terminal", "remote_job_start", &json!({ "cwd": project_path.to_string_lossy() }));
    let host = Arc::new(HostJob {
        id: id.clone(), peer, peer_name, project_path, project_name, command: job.command.clone(), commit: job.commit.clone(),
        state: Mutex::new(JobState::Queued), log: Mutex::new(LogBuffer::default()), artifacts: Mutex::new(Vec::new()),
        artifacts_error: Mutex::new(None), artifact_dir, last_poll: Mutex::new(Instant::now()),
        cancel: AtomicBool::new(false), started_at: epoch_ms(), ended_at: AtomicU64::new(0),
    });
    prune_host_jobs(&app);
    HOST_JOBS.lock().insert(id.clone(), host.clone());
    emit_changed(&app);
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = run_host_job(&task_app, &host, &job).await;
        let state = match outcome {
            Ok(state) => state,
            Err(error) => { host.note(&error); JobState::Failed { error } }
        };
        *host.state.lock() = state;
        host.ended_at.store(epoch_ms(), Ordering::SeqCst);
        emit_changed(&task_app);
    });
    Ok(json!({ "job": id }))
}

async fn run_host_job(app: &tauri::AppHandle, job: &Arc<HostJob>, request: &StartRequest) -> Result<JobState, String> {
    // Un job alla volta per progetto: due build Cargo sulla stessa cartella
    // si bloccherebbero comunque a vicenda.
    let lock = PROJECT_LOCKS.lock().entry(job.project_path.clone()).or_default().clone();
    let _turn = loop {
        if job.stopped() { return Ok(JobState::Cancelled); }
        if let Ok(guard) = lock.clone().try_lock_owned() { break guard; }
        tokio::time::sleep(POLL).await;
    };
    let _awake = crate::keep_awake::KeepAwake::acquire("Studio remote job");
    *job.state.lock() = JobState::Preparing;
    emit_changed(app);
    let worktree = exec_root(app)?.join("worktrees").join(short_hash(&job.project_path.to_string_lossy()));
    ensure_commit(app, job, request).await?;
    if job.stopped() { return Ok(JobState::Cancelled); }
    {
        let (job, worktree) = (job.clone(), worktree.clone());
        tokio::task::spawn_blocking(move || prepare_worktree(&job, &worktree)).await.map_err(|error| error.to_string())??;
    }
    if job.stopped() { return Ok(JobState::Cancelled); }
    *job.state.lock() = JobState::Running;
    emit_changed(app);
    let state = {
        let (job, worktree) = (job.clone(), worktree.clone());
        tokio::task::spawn_blocking(move || run_process(&job, &worktree)).await.map_err(|error| error.to_string())??
    };
    if matches!(state, JobState::Exited { .. }) && !request.artifacts.is_empty() {
        let (collector, worktree, patterns) = (job.clone(), worktree.clone(), request.artifacts.clone());
        let collected = tokio::task::spawn_blocking(move || collect_artifacts(&worktree, &patterns, &collector.artifact_dir))
            .await.map_err(|error| error.to_string())?;
        match collected {
            Ok(list) => {
                for artifact in &list { job.note(&format!("artifact {} ({} bytes)", artifact.path, artifact.size)); }
                *job.artifacts.lock() = list;
            }
            Err(error) => { job.note(&error); *job.artifacts_error.lock() = Some(error); }
        }
    }
    Ok(state)
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    crate::github::sync::run_git_in(dir, args)
}

fn has_commit(dir: &Path, commit: &str) -> bool {
    git(dir, &["cat-file", "-e", &format!("{commit}^{{commit}}")]).is_ok()
}

/// Il commit deve esistere qui: prima `origin`, poi la copia di chi chiede.
async fn ensure_commit(app: &tauri::AppHandle, job: &Arc<HostJob>, request: &StartRequest) -> Result<(), String> {
    let (path, commit) = (job.project_path.clone(), job.commit.clone());
    let present = tokio::task::spawn_blocking(move || {
        if has_commit(&path, &commit) { return true; }
        let _ = git(&path, &["fetch", "--quiet", "origin"]);
        has_commit(&path, &commit)
    }).await.map_err(|error| error.to_string())?;
    if present { return Ok(()); }
    let Some(branch) = request.branch.as_deref() else {
        return Err(format!("Commit {} is not on this machine and is not on a branch that can be fetched", &job.commit[..12]));
    };
    job.note(&format!("fetching {branch} from {}", job.peer_name));
    crate::github::copies::fetch_branch(app, &job.project_path, &job.peer, &request.peer_path, branch).await?;
    let (path, commit) = (job.project_path.clone(), job.commit.clone());
    if tokio::task::spawn_blocking(move || has_commit(&path, &commit)).await.map_err(|error| error.to_string())? {
        Ok(())
    } else {
        Err(format!("Commit {} is not on this machine", &job.commit[..12]))
    }
}

/// Cartella di lavoro staccata, una per progetto e riusata: i file ignorati
/// (`node_modules`, `target`) restano e la build successiva parte calda;
/// i file tracciati e quelli nuovi non ignorati tornano esattamente al commit.
fn prepare_worktree(job: &HostJob, worktree: &Path) -> Result<(), String> {
    let commit = job.commit.as_str();
    let valid = worktree.join(".git").exists() && git(worktree, &["rev-parse", "--git-dir"]).is_ok();
    if valid {
        job.note(&format!("checkout {}", &commit[..12]));
        git(worktree, &["checkout", "--quiet", "--detach", "--force", commit])?;
        git(worktree, &["clean", "-fdq"])?;
    } else {
        if worktree.exists() { std::fs::remove_dir_all(worktree).map_err(|error| error.to_string())?; }
        if let Some(parent) = worktree.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let _ = git(&job.project_path, &["worktree", "prune"]);
        job.note(&format!("worktree {} at {}", worktree.display(), &commit[..12]));
        git(&job.project_path, &["worktree", "add", "--detach", "--force", &worktree.to_string_lossy(), commit])?;
    }
    if worktree.join(".gitmodules").exists() {
        git(worktree, &["submodule", "update", "--init", "--recursive", "--quiet"])?;
    }
    Ok(())
}

fn shell_command(command: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut process = std::process::Command::new("cmd.exe");
        process.raw_arg(format!("/d /s /c \"{command}\""));
        process
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Shell di login: un'app grafica su macOS non eredita il PATH del
        // terminale, e `npm`/`cargo` stanno li'.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
        let mut process = std::process::Command::new(shell);
        process.args(["-lc", command]);
        process
    }
}

fn run_process(job: &Arc<HostJob>, worktree: &Path) -> Result<JobState, String> {
    job.note(&format!("$ {}", job.command));
    let mut process = shell_command(&job.command);
    process.current_dir(worktree)
        .env("OMP_STUDIO_REMOTE_JOB", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::process::CommandExt;
        process.process_group(0);
    }
    let mut child = process.spawn().map_err(|error| format!("Unable to start the command: {error}"))?;
    let pid = child.id();
    #[cfg(target_os = "windows")]
    let windows_job = crate::process_tree::WindowsJob::create_for_process(pid).ok();
    let readers: Vec<_> = [child.stdout.take().map(|out| Box::new(out) as Box<dyn Read + Send>),
        child.stderr.take().map(|err| Box::new(err) as Box<dyn Read + Send>)]
        .into_iter().flatten().map(|mut stream| {
            let job = job.clone();
            std::thread::spawn(move || {
                let mut buffer = [0u8; 16 * 1024];
                while let Ok(read) = stream.read(&mut buffer) {
                    if read == 0 { break; }
                    job.log.lock().push(&buffer[..read]);
                }
            })
        }).collect();
    let state = loop {
        match child.try_wait() {
            Ok(Some(status)) => break JobState::Exited { code: status.code().unwrap_or(-1) },
            Ok(None) => {}
            Err(error) => break JobState::Failed { error: error.to_string() },
        }
        if job.stopped() {
            job.note(if job.cancel.load(Ordering::SeqCst) { "cancelled" } else { "requester stopped polling: cancelled" });
            #[cfg(target_os = "windows")]
            crate::process_tree::kill_process_tree(Some(pid), windows_job.as_ref());
            #[cfg(not(target_os = "windows"))]
            crate::process_tree::kill_process_tree(Some(pid));
            let _ = child.wait();
            break JobState::Cancelled;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    for reader in readers { let _ = reader.join(); }
    if let JobState::Exited { code } = &state { job.note(&format!("exit code {code}")); }
    Ok(state)
}

/// Parte letterale di un glob: la cartella da cui cercare, per non scendere
/// in tutto `node_modules` quando l'artefatto sta in `target/release/bundle`.
fn literal_prefix(pattern: &str) -> &str {
    let cut = pattern.find(['*', '?', '[', '{']).unwrap_or(pattern.len());
    match pattern[..cut].rfind('/') { Some(slash) => &pattern[..slash], None => "" }
}

fn validate_pattern(pattern: &str) -> Result<String, String> {
    let pattern = pattern.trim().replace('\\', "/");
    if pattern.is_empty() || pattern.starts_with('/') || pattern.contains(':') || pattern.split('/').any(|part| part == "..") {
        return Err(format!("Artifact pattern must be relative to the project: {pattern}"));
    }
    Ok(pattern)
}

pub(crate) fn collect_artifacts(root: &Path, patterns: &[String], destination: &Path) -> Result<Vec<Artifact>, String> {
    let mut found: Vec<String> = Vec::new();
    for pattern in patterns {
        let pattern = validate_pattern(pattern)?;
        let matcher = globset::GlobBuilder::new(&pattern).literal_separator(true).build()
            .map_err(|error| error.to_string())?.compile_matcher();
        let base = root.join(literal_prefix(&pattern));
        let mut stack = vec![base];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(kind) = entry.file_type() else { continue };
                if kind.is_dir() {
                    if entry.file_name() != ".git" { stack.push(path); }
                } else if kind.is_file() {
                    let relative = path.strip_prefix(root).map_err(|error| error.to_string())?
                        .to_string_lossy().replace('\\', "/");
                    if matcher.is_match(&relative) && !found.contains(&relative) { found.push(relative); }
                }
            }
        }
    }
    if found.is_empty() { return Err(format!("No artifact matches {}", patterns.join(", "))); }
    found.sort();
    std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut total = 0u64;
    let mut artifacts = Vec::new();
    for (index, relative) in found.iter().enumerate() {
        let source = root.join(relative);
        let size = std::fs::metadata(&source).map_err(|error| error.to_string())?.len();
        total += size;
        if total > MAX_ARTIFACT_BYTES { return Err("Artifacts exceed 2 GiB".into()); }
        let mut input = std::fs::File::open(&source).map_err(|error| error.to_string())?;
        let mut output = std::fs::File::create(destination.join(index.to_string())).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 { break; }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        }
        artifacts.push(Artifact { path: relative.clone(), size, sha256: format!("{:x}", hasher.finalize()) });
    }
    Ok(artifacts)
}

fn prune_host_jobs(app: &tauri::AppHandle) {
    let now = epoch_ms();
    let expired: Vec<Arc<HostJob>> = {
        let mut jobs = HOST_JOBS.lock();
        let expired: Vec<String> = jobs.iter().filter(|(_, job)| {
            let ended = job.ended_at.load(Ordering::SeqCst);
            ended != 0 && now.saturating_sub(ended) > KEEP_FINISHED_MS
        }).map(|(id, _)| id.clone()).collect();
        expired.iter().filter_map(|id| jobs.remove(id)).collect()
    };
    for job in expired { let _ = std::fs::remove_dir_all(&job.artifact_dir); }
    let _ = app;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusReply {
    #[serde(flatten)]
    state: JobState,
    log: String,
    log_start: u64,
    next: u64,
    artifacts: Vec<Artifact>,
    artifacts_error: Option<String>,
}

#[tauri::command]
pub(crate) async fn exec_status(request: tauri::ipc::Request<'_>, job: String, offset: u64) -> Result<Value, String> {
    let job = host_job(&job, &authenticated_peer(&request)?)?;
    *job.last_poll.lock() = Instant::now();
    let (log_start, log, next) = job.log.lock().read(offset, LOG_PAGE);
    let reply = StatusReply {
        state: job.state.lock().clone(), log, log_start, next,
        artifacts: job.artifacts.lock().clone(), artifacts_error: job.artifacts_error.lock().clone(),
    };
    serde_json::to_value(reply).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn exec_cancel(request: tauri::ipc::Request<'_>, job: String) -> Result<(), String> {
    host_job(&job, &authenticated_peer(&request)?)?.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub(crate) async fn exec_artifact_chunk(request: tauri::ipc::Request<'_>, job: String, index: usize, offset: u64) -> Result<tauri::ipc::Response, String> {
    let job = host_job(&job, &authenticated_peer(&request)?)?;
    let size = job.artifacts.lock().get(index).map(|artifact| artifact.size).ok_or("Unknown artifact")?;
    let path = job.artifact_dir.join(index.to_string());
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use std::io::Seek;
        let mut file = std::fs::File::open(&path).map_err(|error| error.to_string())?;
        file.seek(std::io::SeekFrom::Start(offset)).map_err(|error| error.to_string())?;
        let length = size.saturating_sub(offset).min(CHUNK) as usize;
        let mut buffer = vec![0u8; length];
        file.read_exact(&mut buffer).map_err(|error| error.to_string())?;
        Ok(buffer)
    }).await.map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------------------
// Lato di chi chiede.
// ---------------------------------------------------------------------------

/// Chi ha lanciato il job dal bridge: serve a fermarlo quando il proprietario
/// se ne va (sessione chiusa) e a non mostrare i job altrui.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct JobOwner {
    pub kind: String,
    pub id: u64,
}

struct LocalJob {
    id: String,
    remote: String,
    machine: String,
    machine_name: String,
    owner: Option<JobOwner>,
    project_path: PathBuf,
    command: String,
    commit: String,
    dirty: bool,
    /// Gli script tengono vivo il job interrogando: se smettono (Ctrl+C) il
    /// job si ferma. Gli agenti invece aspettano il risultato quando vogliono.
    leased: bool,
    state: Mutex<JobState>,
    log: Mutex<LogBuffer>,
    artifacts: Mutex<Vec<Artifact>>,
    artifacts_error: Mutex<Option<String>>,
    cancel: AtomicBool,
    last_client_poll: Mutex<Instant>,
    started_at: u64,
    ended_at: AtomicU64,
}

static LOCAL_JOBS: LazyLock<Mutex<HashMap<String, Arc<LocalJob>>>> = LazyLock::new(Default::default);

pub(crate) struct StartLocal {
    pub machine: Option<String>,
    pub cwd: PathBuf,
    pub command: String,
    pub artifacts: Vec<String>,
    pub owner: Option<JobOwner>,
    pub leased: bool,
    pub expected_commit: Option<String>,
}

/// Macchina indicata per id o per nome (senza maiuscole); senza indicazione
/// va bene solo se ce n'e' una sola in linea.
async fn resolve_machine(app: &tauri::AppHandle, hint: Option<&str>) -> Result<(String, String), String> {
    let runtime = app.state::<LinkManager>().runtime(app).await?;
    let peers: Vec<(String, String)> = runtime.config.lock().peers.iter()
        .map(|(id, peer)| (id.clone(), peer.name.clone())).collect();
    let online: Vec<&(String, String)> = peers.iter().filter(|(id, _)| runtime.live_connection(id).is_some()).collect();
    let chosen = match hint.map(str::trim).filter(|hint| !hint.is_empty()) {
        Some(hint) => peers.iter().find(|(id, name)| id == hint || name.eq_ignore_ascii_case(hint))
            .ok_or_else(|| format!("No paired machine named {hint}"))?,
        None => match online.as_slice() {
            [only] => *only,
            [] => return Err("No other machine is online".into()),
            _ => return Err(format!("Several machines are online, name one: {}", online.iter().map(|(_, name)| name.as_str()).collect::<Vec<_>>().join(", "))),
        },
    };
    if runtime.live_connection(&chosen.0).is_none() { return Err(format!("{} is not reachable", chosen.1)); }
    Ok(chosen.clone())
}

pub(crate) async fn start_local(app: &tauri::AppHandle, request: StartLocal) -> Result<String, String> {
    if request.command.trim().is_empty() { return Err("Missing command".into()); }
    let patterns = request.artifacts.iter().map(|pattern| validate_pattern(pattern)).collect::<Result<Vec<_>, _>>()?;
    let (machine, machine_name) = resolve_machine(app, request.machine.as_deref()).await?;
    let cwd = request.cwd.clone();
    let (root, commit, branch, slug, root_commit, dirty) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let root = PathBuf::from(git(&cwd, &["rev-parse", "--show-toplevel"]).map_err(|_| "The current folder is not a git repository")?);
        let commit = git(&root, &["rev-parse", "HEAD"])?;
        let branch = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
        let (slug, root_commit) = crate::github::sync::repo_identity(&root);
        let dirty = git(&root, &["status", "--porcelain"]).map(|out| !out.is_empty()).unwrap_or(false);
        Ok((root, commit, branch, slug, root_commit, dirty))
    }).await.map_err(|error| error.to_string())??;
    if request.expected_commit.as_deref().is_some_and(|expected| expected != commit.as_str()) {
        return Err("The local commit changed before starting the remote job".into());
    }
    if slug.is_none() && root_commit.is_none() { return Err("The project has no identity to find it on the other machine".into()); }
    let body = json!({ "job": {
        "repoSlug": slug, "rootCommit": root_commit, "commit": commit, "branch": branch,
        "peerPath": root.to_string_lossy(), "command": request.command, "artifacts": patterns,
    }});
    let PeerBody::Json(reply) = super::call_peer(app, &machine, "exec_start", &body).await? else {
        return Err("Unexpected reply to exec_start".into());
    };
    let remote = reply.get("job").and_then(Value::as_str).ok_or("Missing remote job id")?.to_owned();
    let id = uuid::Uuid::new_v4().to_string();
    let job = Arc::new(LocalJob {
        id: id.clone(), remote, machine, machine_name, owner: request.owner, project_path: root, command: request.command,
        commit, dirty, leased: request.leased, state: Mutex::new(JobState::Queued), log: Mutex::new(LogBuffer::default()),
        artifacts: Mutex::new(Vec::new()), artifacts_error: Mutex::new(None), cancel: AtomicBool::new(false),
        last_client_poll: Mutex::new(Instant::now()), started_at: epoch_ms(), ended_at: AtomicU64::new(0),
    });
    if job.dirty {
        job.log.lock().push(b"[studio] uncommitted changes are not included: the job runs at the last commit\n");
    }
    LOCAL_JOBS.lock().insert(id.clone(), job.clone());
    emit_changed(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move { follow(&app, &job).await });
    Ok(id)
}

/// Segue il job sull'host finche' finisce: log, stato, annullamento.
async fn follow(app: &tauri::AppHandle, job: &Arc<LocalJob>) {
    let mut offset = 0u64;
    let mut last_contact = Instant::now();
    let mut cancel_sent = false;
    loop {
        if job.leased && !job.cancel.load(Ordering::SeqCst) && job.last_client_poll.lock().elapsed() > LEASE {
            job.log.lock().push(b"[studio] the script stopped waiting: cancelling\n");
            job.cancel.store(true, Ordering::SeqCst);
        }
        if job.cancel.load(Ordering::SeqCst) && !cancel_sent {
            cancel_sent = super::call_peer_with_timeout(app, &job.machine, "exec_cancel", &json!({ "job": job.remote }), Duration::from_secs(20)).await.is_ok();
        }
        match super::call_peer_with_timeout(app, &job.machine, "exec_status", &json!({ "job": job.remote, "offset": offset }), Duration::from_secs(30)).await {
            Ok(PeerBody::Json(reply)) => {
                last_contact = Instant::now();
                let start = reply.get("logStart").and_then(Value::as_u64).unwrap_or(offset);
                if start > offset { job.log.lock().push(format!("[studio] {} bytes of log skipped\n", start - offset).as_bytes()); }
                if let Some(text) = reply.get("log").and_then(Value::as_str).filter(|text| !text.is_empty()) {
                    job.log.lock().push(text.as_bytes());
                }
                offset = reply.get("next").and_then(Value::as_u64).unwrap_or(offset);
                let state: Option<JobState> = serde_json::from_value(reply.clone()).ok();
                if let Some(artifacts) = reply.get("artifacts").and_then(|value| serde_json::from_value::<Vec<Artifact>>(value.clone()).ok()) {
                    *job.artifacts.lock() = artifacts;
                }
                *job.artifacts_error.lock() = reply.get("artifactsError").and_then(Value::as_str).map(str::to_owned);
                if let Some(state) = state {
                    let changed = *job.state.lock() != state;
                    let finished = state.finished();
                    *job.state.lock() = state;
                    if changed { emit_changed(app); }
                    // Ultimo giro per il log scritto fra la fine e questa risposta.
                    if finished && reply.get("log").and_then(Value::as_str).is_none_or(str::is_empty) { break; }
                }
            }
            Ok(PeerBody::Raw(_)) => {}
            Err(error) => {
                if last_contact.elapsed() > UNREACHABLE_AFTER {
                    *job.state.lock() = JobState::Failed { error: format!("{} unreachable: {error}", job.machine_name) };
                    break;
                }
            }
        }
        tokio::time::sleep(POLL).await;
    }
    job.ended_at.store(epoch_ms(), Ordering::SeqCst);
    emit_changed(app);
}

fn local_job(id: &str, owner: Option<&JobOwner>) -> Result<Arc<LocalJob>, String> {
    let job = LOCAL_JOBS.lock().get(id).cloned().ok_or("Unknown job")?;
    if let (Some(owner), Some(job_owner)) = (owner, job.owner.as_ref()) {
        if owner != job_owner { return Err("Job belongs to another session".into()); }
    }
    Ok(job)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalStatus {
    pub id: String,
    pub machine: String,
    pub command: String,
    pub commit: String,
    #[serde(flatten)]
    pub state: JobState,
    pub log: String,
    pub next: u64,
    pub artifacts: Vec<Artifact>,
    pub artifacts_error: Option<String>,
}

/// Senza `offset` restituisce la coda del log: e' cio' che serve a un agente
/// che chiede «a che punto e'»; uno script passa l'offset e segue il flusso.
pub(crate) fn status_local(id: &str, owner: Option<&JobOwner>, offset: Option<u64>) -> Result<LocalStatus, String> {
    let job = local_job(id, owner)?;
    *job.last_client_poll.lock() = Instant::now();
    let (_, log, next) = {
        let buffer = job.log.lock();
        let start = offset.unwrap_or_else(|| buffer.end().saturating_sub(64 * 1024));
        buffer.read(start, LOG_PAGE)
    };
    let state = job.state.lock().clone();
    let artifacts = job.artifacts.lock().clone();
    let artifacts_error = job.artifacts_error.lock().clone();
    Ok(LocalStatus {
        id: job.id.clone(), machine: job.machine_name.clone(), command: job.command.clone(), commit: job.commit.clone(), state, log, next,
        artifacts, artifacts_error,
    })
}

/// Testo per l'agente o lo script: stato, codice d'uscita e coda del log.
pub(crate) fn describe(status: &LocalStatus) -> String {
    let state = match &status.state {
        JobState::Queued => crate::tr!("in fila", "queued").to_string(),
        JobState::Preparing => crate::tr!("in preparazione", "preparing").to_string(),
        JobState::Running => crate::tr!("in esecuzione", "running").to_string(),
        JobState::Exited { code } => crate::tr!(format!("finito, codice d'uscita {code}"), format!("finished, exit code {code}")),
        JobState::Failed { error } => crate::tr!(format!("fallito: {error}"), format!("failed: {error}")),
        JobState::Cancelled => crate::tr!("annullato", "cancelled").to_string(),
    };
    let mut text = format!("{} · {} · {}", status.machine, status.command, state);
    if let Some(error) = &status.artifacts_error { text.push_str(&format!("\nartifacts: {error}")); }
    let tail: Vec<&str> = status.log.lines().rev().take(40).collect();
    if !tail.is_empty() {
        text.push_str("\n---\n");
        text.push_str(&tail.into_iter().rev().collect::<Vec<_>>().join("\n"));
    }
    text
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MachineInfo {
    pub id: String,
    pub name: String,
    pub online: bool,
    /// Sistema dell'altra macchina (`macos`, `windows`, `linux`) dall'ultimo
    /// stato che ha pubblicato; serve alla build distribuita (R-MI-37).
    pub platform: Option<String>,
}

pub(crate) async fn machines(app: &tauri::AppHandle) -> Result<Vec<MachineInfo>, String> {
    let runtime = app.state::<LinkManager>().runtime(app).await?;
    let peers: Vec<(String, String)> = runtime.config.lock().peers.iter().map(|(id, peer)| (id.clone(), peer.name.clone())).collect();
    let states = runtime.peer_states.lock().clone();
    Ok(peers.into_iter().map(|(id, name)| {
        let platform = states.get(&id)
            .and_then(|state| serde_json::from_str::<Value>(state).ok())
            .and_then(|state| state.get("platform").and_then(Value::as_str).map(str::to_owned));
        MachineInfo { online: runtime.live_connection(&id).is_some(), id, name, platform }
    }).collect())
}

pub(crate) fn cancel_local(id: &str, owner: Option<&JobOwner>) -> Result<(), String> {
    local_job(id, owner)?.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// La sessione che aveva lanciato dei job se ne e' andata: si fermano.
pub(crate) fn owner_gone(kind: &str, id: u64) {
    for job in LOCAL_JOBS.lock().values() {
        if job.owner.as_ref().is_some_and(|owner| owner.kind == kind && owner.id == id) && !job.state.lock().finished() {
            job.cancel.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalResult {
    pub status: LocalStatus,
    pub files: Vec<String>,
    pub finished: bool,
}

/// Aspetta la fine (fino a `wait`), poi scarica gli artefatti in
/// `destination` (di base `<progetto>/.omp/remote-artifacts/<job>`) con
/// verifica di dimensione e SHA-256.
pub(crate) async fn result_local(app: &tauri::AppHandle, id: &str, owner: Option<&JobOwner>, destination: Option<PathBuf>, wait: Duration) -> Result<LocalResult, String> {
    let job = local_job(id, owner)?;
    let deadline = Instant::now() + wait;
    while job.ended_at.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        *job.last_client_poll.lock() = Instant::now();
        tokio::time::sleep(POLL).await;
    }
    let finished = job.ended_at.load(Ordering::SeqCst) != 0;
    let mut files = Vec::new();
    if finished {
        let artifacts = job.artifacts.lock().clone();
        if !artifacts.is_empty() {
            let destination = destination.unwrap_or_else(|| job.project_path.join(".omp").join("remote-artifacts").join(&job.id));
            for (index, artifact) in artifacts.iter().enumerate() {
                files.push(download(app, &job, index, artifact, &destination).await?.to_string_lossy().into_owned());
            }
        }
    }
    Ok(LocalResult { status: status_local(id, owner, None)?, files, finished })
}

async fn download(app: &tauri::AppHandle, job: &LocalJob, index: usize, artifact: &Artifact, destination: &Path) -> Result<PathBuf, String> {
    let name = Path::new(&artifact.path).file_name().ok_or("Invalid artifact name")?;
    let target = destination.join(name);
    if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let partial = target.with_extension("part");
    let mut file = std::fs::File::create(&partial).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut offset = 0u64;
    while offset < artifact.size {
        let PeerBody::Raw(bytes) = super::call_peer_with_timeout(app, &job.machine, "exec_artifact_chunk",
            &json!({ "job": job.remote, "index": index, "offset": offset }), Duration::from_secs(900)).await? else {
            return Err("Unexpected artifact chunk".into());
        };
        if bytes.is_empty() { return Err("Artifact ended early".into()); }
        hasher.update(&bytes);
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        offset += bytes.len() as u64;
    }
    drop(file);
    if offset != artifact.size || format!("{:x}", hasher.finalize()) != artifact.sha256 {
        let _ = std::fs::remove_file(&partial);
        return Err(format!("Artifact {} failed verification", artifact.path));
    }
    std::fs::rename(&partial, &target).map_err(|error| error.to_string())?;
    Ok(target)
}

// ---------------------------------------------------------------------------
// Finestra: elenco dei job delle due direzioni e annullamento.
// ---------------------------------------------------------------------------

fn emit_changed(app: &tauri::AppHandle) {
    let _ = app.emit("link:exec", ());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobSummary {
    id: String,
    /// `outgoing`: chiesto da qui; `incoming`: chiesto da un'altra macchina.
    direction: &'static str,
    machine_id: String,
    machine_name: String,
    project: String,
    command: String,
    commit: String,
    #[serde(flatten)]
    state: JobState,
    started_at: u64,
    ended_at: Option<u64>,
}

#[tauri::command]
pub(crate) async fn exec_jobs() -> Result<Vec<JobSummary>, String> {
    let ended = |value: u64| (value != 0).then_some(value);
    let mut jobs: Vec<JobSummary> = LOCAL_JOBS.lock().values().map(|job| JobSummary {
        id: job.id.clone(), direction: "outgoing", machine_id: job.machine.clone(), machine_name: job.machine_name.clone(),
        project: job.project_path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        command: job.command.clone(), commit: job.commit.clone(), state: job.state.lock().clone(),
        started_at: job.started_at, ended_at: ended(job.ended_at.load(Ordering::SeqCst)),
    }).collect();
    jobs.extend(HOST_JOBS.lock().values().map(|job| JobSummary {
        id: job.id.clone(), direction: "incoming", machine_id: job.peer.clone(), machine_name: job.peer_name.clone(),
        project: job.project_name.clone(), command: job.command.clone(), commit: job.commit.clone(), state: job.state.lock().clone(),
        started_at: job.started_at, ended_at: ended(job.ended_at.load(Ordering::SeqCst)),
    }));
    jobs.sort_by_key(|job| std::cmp::Reverse(job.started_at));
    Ok(jobs)
}

#[tauri::command]
pub(crate) async fn exec_job_log(id: String, offset: u64) -> Result<Value, String> {
    let (start, log, next) = if let Some(job) = LOCAL_JOBS.lock().get(&id) {
        job.log.lock().read(offset, LOG_PAGE)
    } else if let Some(job) = HOST_JOBS.lock().get(&id) {
        job.log.lock().read(offset, LOG_PAGE)
    } else {
        return Err("Unknown job".into());
    };
    Ok(json!({ "logStart": start, "log": log, "next": next }))
}

/// Annullamento dalla finestra: un job chiesto da qui, oppure uno che
/// un'altra macchina sta facendo girare qui (chi ospita resta padrone).
#[tauri::command]
pub(crate) async fn exec_job_cancel(id: String) -> Result<(), String> {
    if let Some(job) = LOCAL_JOBS.lock().get(&id) { job.cancel.store(true, Ordering::SeqCst); return Ok(()); }
    if let Some(job) = HOST_JOBS.lock().get(&id) { job.cancel.store(true, Ordering::SeqCst); return Ok(()); }
    Err("Unknown job".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_keeps_the_tail_and_reports_where_reading_restarts() {
        let mut log = LogBuffer::default();
        log.push(&vec![b'a'; LOG_CAP]);
        log.push(b"bcd");
        assert_eq!(log.end(), LOG_CAP as u64 + 3);
        let (start, text, next) = log.read(0, 10);
        assert_eq!(start, 3, "l'inizio e' uscito dalla coda");
        assert_eq!(text.len(), 10);
        assert_eq!(next, 13);
        let (_, tail, next) = log.read(LOG_CAP as u64, 10);
        assert_eq!(tail, "bcd");
        assert_eq!(next, log.end());
    }

    #[test]
    fn log_pages_never_split_a_utf8_character() {
        let mut log = LogBuffer::default();
        log.push("aè".as_bytes());
        let (_, text, next) = log.read(0, 2);
        assert_eq!(text, "a");
        assert_eq!(next, 1);
        let (_, rest, _) = log.read(next, 10);
        assert_eq!(rest, "è");
    }

    #[test]
    fn artifact_patterns_stay_inside_the_project() {
        assert!(validate_pattern("src-tauri/target/release/bundle/dmg/*.dmg").is_ok());
        assert!(validate_pattern("C:/Windows/*.exe").is_err());
        assert!(validate_pattern("/etc/passwd").is_err());
        assert!(validate_pattern("../secret").is_err());
        assert_eq!(literal_prefix("target/release/bundle/**/*.exe"), "target/release/bundle");
        assert_eq!(literal_prefix("*.log"), "");
    }

    #[test]
    fn artifacts_are_copied_with_size_and_digest() {
        let root = std::env::temp_dir().join(format!("omp-exec-artifacts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("out/nested")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("out/app.dmg"), b"dmg").unwrap();
        std::fs::write(root.join("out/nested/app.exe"), b"exe").unwrap();
        std::fs::write(root.join("node_modules/x/app.dmg"), b"no").unwrap();
        let destination = root.join("collected");
        let artifacts = collect_artifacts(&root, &["out/**/*.exe".into(), "out/*.dmg".into()], &destination).unwrap();
        assert_eq!(artifacts.iter().map(|artifact| artifact.path.as_str()).collect::<Vec<_>>(), vec!["out/app.dmg", "out/nested/app.exe"]);
        assert_eq!(artifacts[0].size, 3);
        assert_eq!(artifacts[0].sha256, format!("{:x}", Sha256::digest(b"dmg")));
        assert_eq!(std::fs::read(destination.join("1")).unwrap(), b"exe");
        assert!(collect_artifacts(&root, &["missing/*.zip".into()], &destination).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod host_tests {
    use super::*;

    fn sh(dir: &Path, args: &[&str]) -> String {
        crate::github::sync::run_git_in(dir, args).unwrap()
    }

    fn job(project: &Path, commit: &str, command: &str) -> Arc<HostJob> {
        Arc::new(HostJob {
            id: "t".into(), peer: "p".into(), peer_name: "PC".into(), project_path: project.to_path_buf(), project_name: "x".into(),
            command: command.into(), commit: commit.into(), state: Mutex::new(JobState::Running), log: Mutex::new(LogBuffer::default()),
            artifacts: Mutex::new(Vec::new()), artifacts_error: Mutex::new(None), artifact_dir: project.join("never"),
            last_poll: Mutex::new(Instant::now()), cancel: AtomicBool::new(false), started_at: 0, ended_at: AtomicU64::new(0),
        })
    }

    #[test]
    fn worktree_follows_the_commit_keeps_ignored_files_and_leaves_the_copy_alone() {
        let base = std::env::temp_dir().join(format!("omp-exec-host-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let project = base.join("project");
        std::fs::create_dir_all(&project).unwrap();
        sh(&project, &["init", "-q"]);
        sh(&project, &["config", "user.email", "t@example.com"]);
        sh(&project, &["config", "user.name", "t"]);
        std::fs::write(project.join(".gitignore"), "cache/\n").unwrap();
        std::fs::write(project.join("a.txt"), "one").unwrap();
        sh(&project, &["add", "."]);
        sh(&project, &["commit", "-qm", "one"]);
        let first = sh(&project, &["rev-parse", "HEAD"]);
        std::fs::write(project.join("a.txt"), "two").unwrap();
        sh(&project, &["commit", "-qam", "two"]);
        let second = sh(&project, &["rev-parse", "HEAD"]);
        // Lavoro in corso nella copia: non deve essere toccato.
        std::fs::write(project.join("a.txt"), "wip").unwrap();

        let worktree = base.join("wt");
        prepare_worktree(&job(&project, &first, "x"), &worktree).unwrap();
        assert_eq!(std::fs::read_to_string(worktree.join("a.txt")).unwrap(), "one");
        std::fs::create_dir_all(worktree.join("cache")).unwrap();
        std::fs::write(worktree.join("cache/warm"), "keep").unwrap();
        std::fs::write(worktree.join("stray.txt"), "drop").unwrap();
        prepare_worktree(&job(&project, &second, "x"), &worktree).unwrap();
        assert_eq!(std::fs::read_to_string(worktree.join("a.txt")).unwrap(), "two");
        assert!(worktree.join("cache/warm").exists(), "la cache ignorata resta");
        assert!(!worktree.join("stray.txt").exists(), "i file nuovi non ignorati spariscono");
        assert_eq!(std::fs::read_to_string(project.join("a.txt")).unwrap(), "wip");

        let ok = job(&project, &second, if cfg!(windows) { "echo hi && exit 3" } else { "echo hi; exit 3" });
        assert_eq!(run_process(&ok, &worktree).unwrap(), JobState::Exited { code: 3 });
        assert!(ok.log.lock().read(0, LOG_CAP).1.contains("hi"));

        let stopped = job(&project, &second, if cfg!(windows) { "ping -n 30 127.0.0.1" } else { "sleep 30" });
        stopped.cancel.store(true, Ordering::SeqCst);
        let started = Instant::now();
        assert_eq!(run_process(&stopped, &worktree).unwrap(), JobState::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
        let _ = std::fs::remove_dir_all(&base);
    }
}
