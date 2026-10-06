use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::io::Read;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{LazyLock, Mutex};
use tauri::command;

const WORKTREE_PREFIX: &str = ".omp-wt-";
const LANE_BRANCH_PREFIX: &str = "omp/lane-";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static WORKTREE_MUTATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Chiave della config del branch di corsia con i file copiati via allowlist:
/// copie locali (Parametri.ini, .env) che non devono finire nei commit della
/// corsia ne' rendere "sporca" la sua rimozione.
const ALLOWLIST_KEY: &str = "ompStudioAllowlist";

/// Serializza le mutazioni dei worktree. Un panic in un'operazione precedente
/// avvelena il mutex ma non lo stato Git, che ogni operazione rilegge da capo:
/// si recupera il lock invece di bloccare corsie e integrazioni fino al riavvio.
fn worktree_mutation_lock() -> std::sync::MutexGuard<'static, ()> {
    WORKTREE_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// Versione di Git installata `(major, minor, patch)`, letta una sola volta
/// per esecuzione. `None` se Git manca o stampa una versione illeggibile.
pub fn git_version() -> Option<(u32, u32, u32)> {
    static VERSION: std::sync::OnceLock<Option<(u32, u32, u32)>> = std::sync::OnceLock::new();
    *VERSION.get_or_init(|| {
        let mut command = Command::new("git");
        command.arg("--version");
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        parse_git_version(&String::from_utf8_lossy(&output.stdout))
    })
}

/// `git version 2.43.0`, `git version 2.45.1.windows.1`,
/// `git version 2.39.3 (Apple Git-146)`: contano solo i primi tre numeri.
fn parse_git_version(text: &str) -> Option<(u32, u32, u32)> {
    let version = text.trim().strip_prefix("git version ")?;
    let mut numbers = version
        .split(|c: char| c == '.' || c.is_whitespace())
        .map(|part| part.parse::<u32>().ok());
    let major = numbers.next()??;
    let minor = numbers.next()??;
    let patch = numbers.next().flatten().unwrap_or(0);
    Some((major, minor, patch))
}

mod lane_integrate;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeErrorCode {
    InvalidPath,
    PathTraversal,
    NotGitRepository,
    GitUnavailable,
    NoCommits,
    DetachedHead,
    InvalidBaseCommit,
    InvalidTargetBranch,
    InvalidLaneId,
    PathCollision,
    BranchCollision,
    MissingProjectSubpath,
    UnmanagedWorktree,
    UnsafeWorktreePath,
    ProcessesActive,
    DirtyWorktree,
    TargetDirty,
    TargetMoved,
    CheckoutMismatch,
    ConflictsPresent,
    LaneDivergedAfterIntegrate,
    MessageInvalid,
    ConfirmationRequired,
    CheckoutSyncFailed,
    WorktreeLocked,
    WorktreeInUse,
    GitCommandFailed,
    MetadataCleanupFailed,
    GitTooOld,
    Internal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeError {
    pub code: WorktreeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl WorktreeError {
    fn new(code: WorktreeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    fn with_detail(
        code: WorktreeErrorCode,
        message: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        let detail = detail.into();
        Self {
            code,
            message: message.into(),
            detail: (!detail.is_empty()).then_some(detail),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryHeadState {
    Attached,
    Detached,
    Unborn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInspection {
    pub repository_root: String,
    pub opened_path: String,
    pub relative_subpath: String,
    pub worktree_parent: String,
    pub repository_name: String,
    pub head_state: RepositoryHeadState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub worktree_path: String,
    pub workspace_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub detached: bool,
    pub is_current: bool,
    pub managed_by_studio: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prunable_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectWorktreeArgs {
    pub project_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorktreeArgs {
    pub project_path: String,
    pub lane_id: String,
    pub base_commit: String,
    pub target_branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListWorktreesArgs {
    pub project_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveWorktreeArgs {
    pub project_path: String,
    pub worktree_path: String,
    /// Arresta prima i processi che Studio ha avviato dentro il worktree.
    /// Senza questo consenso esplicito la rimozione viene rifiutata: e' la
    /// scelta "Arresta processi e rimuovi" dell'interfaccia, mai un default.
    #[serde(default)]
    pub stop_processes: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommitInfo {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub time: i64,
    pub subject: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFileDiff {
    pub path: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub is_untracked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReviewInspection {
    pub target_branch: String,
    pub target_sha: String,
    pub base_sha: String,
    pub current_sha: String,
    pub drift_ahead: u32,
    pub drift_behind: u32,
    pub is_target_dirty: bool,
    pub target_dirty_files: Vec<String>,
    pub is_lane_dirty: bool,
    pub lane_dirty_files: Vec<String>,
    pub is_target_checked_out: bool,
    pub has_unresolved_conflicts: bool,
    pub commits: Vec<ReviewCommitInfo>,
    pub files: Vec<ReviewFileDiff>,
    pub total_additions: u64,
    pub total_deletions: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeReviewInspectArgs {
    pub project_path: String,
    pub worktree_path: String,
    #[serde(default)]
    pub target_branch: Option<String>,
}

#[derive(Clone, Debug)]
struct RepositoryContext {
    opened_path: PathBuf,
    repository_root: PathBuf,
    relative_subpath: PathBuf,
    parent: PathBuf,
    repository_name: String,
}

#[derive(Clone, Debug, Default)]
struct PorcelainWorktree {
    path: PathBuf,
    commit: Option<String>,
    branch: Option<String>,
    detached: bool,
    locked_reason: Option<String>,
    prunable_reason: Option<String>,
}

fn git_args(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn run_git(cwd: &Path, args: &[OsString]) -> Result<Output, WorktreeError> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut command = Command::new("git");
    command.current_dir(cwd).args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitUnavailable,
            "Git non e' disponibile",
            error.to_string(),
        )
    })
}

fn output_detail(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn require_git(
    cwd: &Path,
    args: &[OsString],
    code: WorktreeErrorCode,
    message: &str,
) -> Result<Output, WorktreeError> {
    let output = run_git(cwd, args)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(WorktreeError::with_detail(
            code,
            message,
            output_detail(&output),
        ))
    }
}

fn path_string(path: &Path) -> Result<String, WorktreeError> {
    let raw = path.to_str().ok_or_else(|| {
        WorktreeError::new(
            WorktreeErrorCode::InvalidPath,
            "Il percorso contiene caratteri non rappresentabili",
        )
    })?;

    #[cfg(target_os = "windows")]
    {
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return Ok(format!(r"\\{}", rest));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            return Ok(rest.to_string());
        }
    }

    Ok(raw.to_string())
}

fn git_path_arg(path: &Path) -> OsString {
    #[cfg(target_os = "windows")]
    {
        path_string(path)
            .map(OsString::from)
            .unwrap_or_else(|_| path.as_os_str().to_owned())
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.as_os_str().to_owned()
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let left = path_string(left).unwrap_or_else(|_| left.to_string_lossy().into_owned());
        let right = path_string(right).unwrap_or_else(|_| right.to_string_lossy().into_owned());
        left.replace('/', "\\")
            .eq_ignore_ascii_case(&right.replace('/', "\\"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        left == right
    }
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, WorktreeError> {
    let canonical = path.canonicalize().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::InvalidPath,
            format!("{} non valido", label),
            error.to_string(),
        )
    })?;
    if !canonical.is_dir() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidPath,
            format!("{} non e' una cartella", label),
        ));
    }
    Ok(canonical)
}

fn discover_repository(project_path: &str) -> Result<RepositoryContext, WorktreeError> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidPath,
            "Percorso progetto non valido",
        ));
    }

    let opened_path = canonical_directory(Path::new(trimmed), "Percorso progetto")?;
    let output = run_git(&opened_path, &git_args(&["rev-parse", "--show-toplevel"]))?;
    if !output.status.success() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::NotGitRepository,
            "Il percorso non appartiene a un repository Git",
            output_detail(&output),
        ));
    }

    let root_text = String::from_utf8(output.stdout)
        .map_err(|error| {
            WorktreeError::with_detail(
                WorktreeErrorCode::InvalidPath,
                "Git ha restituito una radice repository non valida",
                error.to_string(),
            )
        })?
        .trim()
        .to_string();
    let repository_root = canonical_directory(Path::new(&root_text), "Radice repository")?;
    let relative_subpath = opened_path
        .strip_prefix(&repository_root)
        .map_err(|_| {
            WorktreeError::new(
                WorktreeErrorCode::UnsafeWorktreePath,
                "Il percorso aperto non e' contenuto nella radice Git canonica",
            )
        })?
        .to_path_buf();
    let parent = repository_root
        .parent()
        .ok_or_else(|| {
            WorktreeError::new(
                WorktreeErrorCode::UnsafeWorktreePath,
                "La radice Git non ha una cartella genitore consentita",
            )
        })?
        .canonicalize()
        .map_err(|error| {
            WorktreeError::with_detail(
                WorktreeErrorCode::InvalidPath,
                "Cartella genitore del repository non valida",
                error.to_string(),
            )
        })?;
    let repository_name = repository_root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            WorktreeError::new(
                WorktreeErrorCode::InvalidPath,
                "Il repository non ha un nome utilizzabile",
            )
        })?
        .to_string();

    Ok(RepositoryContext {
        opened_path,
        repository_root,
        relative_subpath,
        parent,
        repository_name,
    })
}

fn optional_git_line(cwd: &Path, args: &[&str]) -> Result<Option<String>, WorktreeError> {
    let output = run_git(cwd, &git_args(args))?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn inspect_sync(project_path: &str) -> Result<RepositoryInspection, WorktreeError> {
    let context = discover_repository(project_path)?;
    let current_branch = optional_git_line(
        &context.repository_root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )?;
    let head_commit = optional_git_line(
        &context.repository_root,
        &["rev-parse", "--verify", "HEAD^{commit}"],
    )?;
    let head_state = match (&head_commit, &current_branch) {
        (Some(_), Some(_)) => RepositoryHeadState::Attached,
        (Some(_), None) => RepositoryHeadState::Detached,
        (None, _) => RepositoryHeadState::Unborn,
    };

    Ok(RepositoryInspection {
        repository_root: path_string(&context.repository_root)?,
        opened_path: path_string(&context.opened_path)?,
        relative_subpath: path_string(&context.relative_subpath)?,
        worktree_parent: path_string(&context.parent)?,
        repository_name: context.repository_name,
        head_state,
        head_commit,
        current_branch,
    })
}

fn ensure_repository_has_commit(context: &RepositoryContext) -> Result<(), WorktreeError> {
    let output = require_git(
        &context.repository_root,
        &git_args(&["rev-list", "--all", "--max-count=1"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile verificare i commit del repository",
    )?;
    if output.stdout.iter().all(u8::is_ascii_whitespace) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::NoCommits,
            "Il repository non contiene ancora alcun commit",
        ));
    }
    Ok(())
}

fn validate_lane_id(lane_id: &str) -> Result<&str, WorktreeError> {
    let lane_id = lane_id.trim();
    let valid = !lane_id.is_empty()
        && lane_id.len() <= 40
        && lane_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        && lane_id
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && lane_id
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric);
    if !valid {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidLaneId,
            "L'identificatore corsia deve contenere 1-40 caratteri ASCII alfanumerici, '-' o '_'",
        ));
    }
    Ok(lane_id)
}

fn repository_slug(name: &str) -> String {
    let mut slug = String::with_capacity(name.len().min(32));
    let mut separator = false;
    for byte in name.bytes() {
        if slug.len() >= 32 {
            break;
        }
        if byte.is_ascii_alphanumeric() {
            slug.push((byte as char).to_ascii_lowercase());
            separator = false;
        } else if !separator && !slug.is_empty() {
            slug.push('-');
            separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    }
}

fn validate_base_commit(context: &RepositoryContext, value: &str) -> Result<String, WorktreeError> {
    let value = value.trim();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidBaseCommit,
            "Il commit base deve essere uno SHA completo esplicito",
        ));
    }
    let revision = format!("{}^{{commit}}", value);
    let output = require_git(
        &context.repository_root,
        &[
            OsString::from("rev-parse"),
            OsString::from("--verify"),
            OsString::from(revision),
        ],
        WorktreeErrorCode::InvalidBaseCommit,
        "Il commit base non esiste nel repository",
    )?;
    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !resolved.eq_ignore_ascii_case(value) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidBaseCommit,
            "Il commit base non corrisponde allo SHA esplicito richiesto",
        ));
    }
    Ok(resolved)
}

fn validate_target_branch(
    context: &RepositoryContext,
    value: &str,
) -> Result<String, WorktreeError> {
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.starts_with("refs/") {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidTargetBranch,
            "Il branch target deve essere il nome breve di un branch locale",
        ));
    }
    require_git(
        &context.repository_root,
        &[
            OsString::from("check-ref-format"),
            OsString::from("--branch"),
            OsString::from(value),
        ],
        WorktreeErrorCode::InvalidTargetBranch,
        "Nome del branch target non valido",
    )?;
    let revision = format!("refs/heads/{}^{{commit}}", value);
    require_git(
        &context.repository_root,
        &[
            OsString::from("rev-parse"),
            OsString::from("--verify"),
            OsString::from(revision),
        ],
        WorktreeErrorCode::InvalidTargetBranch,
        "Il branch target locale non esiste o non contiene commit",
    )?;
    Ok(value.to_string())
}

fn parse_porcelain(stdout: &[u8]) -> Result<Vec<PorcelainWorktree>, WorktreeError> {
    let text = String::from_utf8(stdout.to_vec()).map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Git ha restituito un elenco worktree non valido",
            error.to_string(),
        )
    })?;
    let mut worktrees = Vec::new();
    let mut current: Option<PorcelainWorktree> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(entry) = current.take() {
                worktrees.push(entry);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                worktrees.push(entry);
            }
            current = Some(PorcelainWorktree {
                path: PathBuf::from(path),
                ..PorcelainWorktree::default()
            });
            continue;
        }
        let Some(entry) = current.as_mut() else {
            return Err(WorktreeError::new(
                WorktreeErrorCode::GitCommandFailed,
                "Formato porcelain dei worktree inatteso",
            ));
        };
        if let Some(commit) = line.strip_prefix("HEAD ") {
            if !commit.bytes().all(|byte| byte == b'0') {
                entry.commit = Some(commit.to_string());
            }
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            entry.branch = Some(branch.to_string());
        } else if line == "detached" {
            entry.detached = true;
        } else if let Some(reason) = line.strip_prefix("locked") {
            entry.locked_reason = Some(reason.trim().to_string());
        } else if let Some(reason) = line.strip_prefix("prunable") {
            entry.prunable_reason = Some(reason.trim().to_string());
        }
    }
    if let Some(entry) = current {
        worktrees.push(entry);
    }
    if worktrees
        .iter()
        .any(|entry| entry.path.as_os_str().is_empty())
    {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Git ha restituito un worktree senza percorso",
        ));
    }
    Ok(worktrees)
}

fn porcelain_worktrees(
    context: &RepositoryContext,
) -> Result<Vec<PorcelainWorktree>, WorktreeError> {
    let output = require_git(
        &context.repository_root,
        &git_args(&["worktree", "list", "--porcelain"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile elencare i worktree Git",
    )?;
    parse_porcelain(&output.stdout)
}

fn branch_config_key(branch: &str, suffix: &str) -> String {
    format!("branch.{}.{}", branch, suffix)
}

fn config_get(
    context: &RepositoryContext,
    branch: &str,
    suffix: &str,
) -> Result<Option<String>, WorktreeError> {
    let key = branch_config_key(branch, suffix);
    let output = run_git(
        &context.repository_root,
        &[
            OsString::from("config"),
            OsString::from("--local"),
            OsString::from("--get"),
            OsString::from(key),
        ],
    )?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(Some(value));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(WorktreeError::with_detail(
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile leggere la registrazione Studio del worktree",
        output_detail(&output),
    ))
}

fn config_set(
    context: &RepositoryContext,
    branch: &str,
    suffix: &str,
    value: &str,
) -> Result<(), WorktreeError> {
    let key = branch_config_key(branch, suffix);
    require_git(
        &context.repository_root,
        &[
            OsString::from("config"),
            OsString::from("--local"),
            OsString::from(key),
            OsString::from(value),
        ],
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile registrare i metadati Studio del worktree",
    )?;
    Ok(())
}

fn config_unset(context: &RepositoryContext, branch: &str, suffix: &str) {
    let key = branch_config_key(branch, suffix);
    let _ = run_git(
        &context.repository_root,
        &[
            OsString::from("config"),
            OsString::from("--local"),
            OsString::from("--unset-all"),
            OsString::from(key),
        ],
    );
}

fn clear_registration(context: &RepositoryContext, branch: &str) {
    for suffix in [
        "ompStudioManaged",
        "ompStudioLaneId",
        "ompStudioBaseCommit",
        "ompStudioTargetBranch",
        "ompStudioWorktree",
        ALLOWLIST_KEY,
    ] {
        config_unset(context, branch, suffix);
    }
}

/// Percorsi (relativi, con `/`) copiati nella corsia via allowlist.
fn allowlist_paths(
    context: &RepositoryContext,
    branch: &str,
) -> Result<Vec<String>, WorktreeError> {
    let key = branch_config_key(branch, ALLOWLIST_KEY);
    let output = run_git(
        &context.repository_root,
        &[
            OsString::from("config"),
            OsString::from("--local"),
            OsString::from("-z"),
            OsString::from("--get-all"),
            OsString::from(key),
        ],
    )?;
    if output.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    if !output.status.success() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile leggere i file locali copiati nella corsia",
            output_detail(&output),
        ));
    }
    let mut paths: Vec<String> = Vec::new();
    for raw in output.stdout.split(|byte| *byte == 0) {
        let value = String::from_utf8_lossy(raw).trim().to_string();
        if !value.is_empty() && !paths.contains(&value) {
            paths.push(value);
        }
    }
    Ok(paths)
}

/// Aggiunge alla config del branch i percorsi appena copiati, una voce per
/// percorso (`--add`, argv separati: spazi e caratteri speciali non passano
/// mai da una shell).
fn record_allowlist_paths(
    context: &RepositoryContext,
    branch: &str,
    copied: &[String],
) -> Result<(), WorktreeError> {
    if copied.is_empty() {
        return Ok(());
    }
    let known = allowlist_paths(context, branch)?;
    let key = branch_config_key(branch, ALLOWLIST_KEY);
    for path in copied {
        if known.contains(path) {
            continue;
        }
        require_git(
            &context.repository_root,
            &[
                OsString::from("config"),
                OsString::from("--local"),
                OsString::from("--add"),
                OsString::from(&key),
                OsString::from(path),
            ],
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile registrare i file locali copiati nella corsia",
        )?;
    }
    Ok(())
}

/// Voce di `git status --porcelain=v1 -z`: stato a due lettere e percorso.
fn porcelain_status_entries(raw: &[u8]) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    let mut parts = raw.split(|byte| *byte == 0);
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let status = String::from_utf8_lossy(&entry[..2]).into_owned();
        let path = String::from_utf8_lossy(&entry[3..]).replace('\\', "/");
        // Rinomine e copie occupano due voci: la seconda e' l'origine.
        if status.starts_with('R') || status.starts_with('C') {
            parts.next();
        }
        entries.push((status, path));
    }
    entries
}

/// Modifiche del worktree che ne impediscono la rimozione: tutto tranne i file
/// non tracciati che Studio stesso vi ha copiato via allowlist.
fn blocking_changes(worktree: &Path, allowlisted: &[String]) -> Result<Vec<String>, WorktreeError> {
    let status = require_git(
        worktree,
        &git_args(&["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile verificare lo stato del worktree",
    )?;
    Ok(porcelain_status_entries(&status.stdout)
        .into_iter()
        .filter(|(status, path)| {
            !(status == "??"
                && allowlisted
                    .iter()
                    .any(|allowed| lane_integrate::paths_match(allowed, path)))
        })
        .map(|(_, path)| path)
        .collect())
}

/// Registrazione Studio di un branch, letta dalla config locale.
#[derive(Clone, Debug, Default)]
struct BranchRegistration {
    managed: Option<String>,
    lane_id: Option<String>,
    base_commit: Option<String>,
    target_branch: Option<String>,
    worktree: Option<String>,
}

/// Tutte le registrazioni Studio con un solo `git config`: `worktree_list` ne
/// avrebbe altrimenti lanciati cinque per ogni worktree. Le chiavi tornano con
/// il nome della variabile in minuscolo e il nome del branch intatto.
fn branch_registrations(
    context: &RepositoryContext,
) -> Result<std::collections::HashMap<String, BranchRegistration>, WorktreeError> {
    let output = run_git(
        &context.repository_root,
        &git_args(&[
            "config",
            "--local",
            "-z",
            "--get-regexp",
            r"^branch\..*\.ompstudio",
        ]),
    )?;
    let mut registrations: std::collections::HashMap<String, BranchRegistration> =
        std::collections::HashMap::new();
    if output.status.code() == Some(1) {
        return Ok(registrations);
    }
    if !output.status.success() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile leggere la registrazione Studio del worktree",
            output_detail(&output),
        ));
    }
    for raw in output.stdout.split(|byte| *byte == 0) {
        let text = String::from_utf8_lossy(raw);
        // Con `-z` ogni voce e' "chiave\nvalore".
        let (key, value) = text.split_once('\n').unwrap_or((text.as_ref(), ""));
        let Some((branch, variable)) = key
            .strip_prefix("branch.")
            .and_then(|rest| rest.rsplit_once('.'))
        else {
            continue;
        };
        let value = Some(value.trim().to_string());
        let entry = registrations.entry(branch.to_string()).or_default();
        // Con piu' valori vince l'ultimo, come `git config --get`.
        match variable {
            "ompstudiomanaged" => entry.managed = value,
            "ompstudiolaneid" => entry.lane_id = value,
            "ompstudiobasecommit" => entry.base_commit = value,
            "ompstudiotargetbranch" => entry.target_branch = value,
            "ompstudioworktree" => entry.worktree = value,
            _ => {}
        }
    }
    Ok(registrations)
}

fn registered_values_from(
    registration: Option<&BranchRegistration>,
    actual_path: &Path,
) -> RegisteredWorktreeValues {
    let Some(registration) = registration else {
        return (false, None, None, None);
    };
    let marked = registration
        .managed
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let path_matches = registration
        .worktree
        .as_deref()
        .map(Path::new)
        .is_some_and(|registered| same_path(registered, actual_path));
    (
        marked && path_matches,
        registration.lane_id.clone(),
        registration.base_commit.clone(),
        registration.target_branch.clone(),
    )
}

/// Branch di corsia registrato da Studio per la cartella `root`, con il nome
/// atteso `.omp-wt-<repo>-<corsia>`: e' la prova che una cartella che Git non
/// elenca piu' (o che non esiste piu') era davvero un worktree di Studio.
fn registration_for_root(
    context: &RepositoryContext,
    root: &Path,
) -> Result<Option<String>, WorktreeError> {
    let file_name = root.file_name().and_then(|name| name.to_str());
    for (branch, registration) in branch_registrations(context)? {
        let (managed, lane_id, _, _) = registered_values_from(Some(&registration), root);
        let Some(lane_id) = lane_id.filter(|_| managed) else {
            continue;
        };
        let expected_name = format!(
            "{}{}-{}",
            WORKTREE_PREFIX,
            repository_slug(&context.repository_name),
            lane_id
        );
        if branch == format!("{}{}", LANE_BRANCH_PREFIX, lane_id)
            && file_name == Some(expected_name.as_str())
        {
            return Ok(Some(branch));
        }
    }
    Ok(None)
}

fn register_worktree(
    context: &RepositoryContext,
    branch: &str,
    lane_id: &str,
    base_commit: &str,
    target_branch: &str,
    worktree_path: &Path,
) -> Result<(), WorktreeError> {
    config_set(context, branch, "ompStudioManaged", "true")?;
    config_set(context, branch, "ompStudioLaneId", lane_id)?;
    config_set(context, branch, "ompStudioBaseCommit", base_commit)?;
    config_set(context, branch, "ompStudioTargetBranch", target_branch)?;
    config_set(
        context,
        branch,
        "ompStudioWorktree",
        &path_string(worktree_path)?,
    )?;
    Ok(())
}

type RegisteredWorktreeValues = (bool, Option<String>, Option<String>, Option<String>);

fn registered_values(
    context: &RepositoryContext,
    branch: &str,
    actual_path: &Path,
) -> Result<RegisteredWorktreeValues, WorktreeError> {
    let marked = config_get(context, branch, "ompStudioManaged")?
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let lane_id = config_get(context, branch, "ompStudioLaneId")?;
    let base_commit = config_get(context, branch, "ompStudioBaseCommit")?;
    let target_branch = config_get(context, branch, "ompStudioTargetBranch")?;
    let registered_path = config_get(context, branch, "ompStudioWorktree")?;
    let path_matches = registered_path
        .as_deref()
        .map(Path::new)
        .is_some_and(|registered| same_path(registered, actual_path));
    Ok((marked && path_matches, lane_id, base_commit, target_branch))
}

fn worktree_info(
    context: &RepositoryContext,
    registrations: &std::collections::HashMap<String, BranchRegistration>,
    raw: PorcelainWorktree,
) -> Result<WorktreeInfo, WorktreeError> {
    let canonical_path = raw.path.canonicalize().unwrap_or_else(|_| raw.path.clone());
    let workspace_path = canonical_path.join(&context.relative_subpath);
    let (managed_by_studio, lane_id, base_commit, target_branch) = match raw.branch.as_deref() {
        Some(branch) => registered_values_from(registrations.get(branch), &canonical_path),
        None => (false, None, None, None),
    };

    Ok(WorktreeInfo {
        worktree_path: path_string(&canonical_path)?,
        workspace_path: path_string(&workspace_path)?,
        commit: raw.commit,
        branch: raw.branch,
        detached: raw.detached,
        is_current: same_path(&canonical_path, &context.repository_root),
        managed_by_studio,
        lane_id,
        base_commit,
        target_branch,
        locked_reason: raw.locked_reason,
        prunable_reason: raw.prunable_reason,
    })
}

fn list_sync(project_path: &str) -> Result<Vec<WorktreeInfo>, WorktreeError> {
    let context = discover_repository(project_path)?;
    ensure_repository_has_commit(&context)?;
    let registrations = branch_registrations(&context)?;
    porcelain_worktrees(&context)?
        .into_iter()
        .map(|raw| worktree_info(&context, &registrations, raw))
        .collect()
}

fn branch_exists(context: &RepositoryContext, branch: &str) -> Result<bool, WorktreeError> {
    let reference = format!("refs/heads/{}", branch);
    let output = run_git(
        &context.repository_root,
        &[
            OsString::from("show-ref"),
            OsString::from("--verify"),
            OsString::from("--quiet"),
            OsString::from(reference),
        ],
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile verificare la collisione del branch corsia",
            output_detail(&output),
        )),
    }
}

fn rollback_create(context: &RepositoryContext, path: &Path, branch: &str, base_commit: &str) {
    let _ = run_git(
        &context.repository_root,
        &[
            OsString::from("worktree"),
            OsString::from("remove"),
            OsString::from("--"),
            git_path_arg(path),
        ],
    );
    clear_registration(context, branch);
    let reference = format!("refs/heads/{}", branch);
    let _ = run_git(
        &context.repository_root,
        &[
            OsString::from("update-ref"),
            OsString::from("-d"),
            OsString::from(reference),
            OsString::from(base_commit),
        ],
    );
}

fn create_sync(args: CreateWorktreeArgs) -> Result<WorktreeInfo, WorktreeError> {
    let _mutation = worktree_mutation_lock();
    let context = discover_repository(&args.project_path)?;
    ensure_repository_has_commit(&context)?;
    let inspection = inspect_sync(&args.project_path)?;
    if inspection.head_state == RepositoryHeadState::Detached {
        return Err(WorktreeError::new(
            WorktreeErrorCode::DetachedHead,
            "Il repository e' in detached HEAD: selezionare un branch target prima di creare la corsia",
        ));
    }
    if inspection.head_state == RepositoryHeadState::Unborn {
        return Err(WorktreeError::new(
            WorktreeErrorCode::NoCommits,
            "Il repository non contiene ancora alcun commit",
        ));
    }

    let lane_id = validate_lane_id(&args.lane_id)?.to_string();
    let base_commit = validate_base_commit(&context, &args.base_commit)?;
    let target_branch = validate_target_branch(&context, &args.target_branch)?;
    let branch = format!("{}{}", LANE_BRANCH_PREFIX, lane_id);
    require_git(
        &context.repository_root,
        &[
            OsString::from("check-ref-format"),
            OsString::from("--branch"),
            OsString::from(&branch),
        ],
        WorktreeErrorCode::InvalidLaneId,
        "L'identificatore corsia genera un branch Git non valido",
    )?;

    let path = context.parent.join(format!(
        "{}{}-{}",
        WORKTREE_PREFIX,
        repository_slug(&context.repository_name),
        lane_id
    ));
    if path.symlink_metadata().is_ok() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::PathCollision,
            format!("La destinazione '{}' esiste gia'", path_string(&path)?),
        ));
    }
    if branch_exists(&context, &branch)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::BranchCollision,
            format!("Il branch '{}' esiste gia'", branch),
        ));
    }
    if porcelain_worktrees(&context)?
        .iter()
        .any(|worktree| same_path(&worktree.path, &path))
    {
        return Err(WorktreeError::new(
            WorktreeErrorCode::PathCollision,
            "La destinazione e' gia' registrata da Git come worktree",
        ));
    }

    require_git(
        &context.repository_root,
        &[
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("-b"),
            OsString::from(&branch),
            git_path_arg(&path),
            OsString::from(&base_commit),
        ],
        WorktreeErrorCode::GitCommandFailed,
        "Git non ha creato il worktree",
    )?;

    let canonical_path = match path.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            rollback_create(&context, &path, &branch, &base_commit);
            return Err(WorktreeError::with_detail(
                WorktreeErrorCode::InvalidPath,
                "Il worktree creato non e' canonicalizzabile",
                error.to_string(),
            ));
        }
    };
    if !same_path(
        canonical_path.parent().unwrap_or(&canonical_path),
        &context.parent,
    ) {
        rollback_create(&context, &canonical_path, &branch, &base_commit);
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Git ha creato il worktree fuori dal parent consentito",
        ));
    }
    let workspace_path = canonical_path.join(&context.relative_subpath);
    if !workspace_path.is_dir() {
        rollback_create(&context, &canonical_path, &branch, &base_commit);
        return Err(WorktreeError::new(
            WorktreeErrorCode::MissingProjectSubpath,
            "Il commit base non contiene la sottocartella aperta in Studio",
        ));
    }
    if let Err(error) = register_worktree(
        &context,
        &branch,
        &lane_id,
        &base_commit,
        &target_branch,
        &canonical_path,
    ) {
        rollback_create(&context, &canonical_path, &branch, &base_commit);
        return Err(error);
    }

    Ok(WorktreeInfo {
        worktree_path: path_string(&canonical_path)?,
        workspace_path: path_string(&workspace_path)?,
        commit: Some(base_commit.clone()),
        branch: Some(branch),
        detached: false,
        is_current: false,
        managed_by_studio: true,
        lane_id: Some(lane_id),
        base_commit: Some(base_commit),
        target_branch: Some(target_branch),
        locked_reason: None,
        prunable_reason: None,
    })
}

fn has_parent_component(path: &Path) -> bool {
    path.components()
        .any(|component| component == Component::ParentDir)
}

/// Worktree registrato da Studio, validato per ogni operazione che ci scrive
/// dentro o lo rimuove: percorso assoluto, senza traversal, fratello diretto
/// del repository, noto a Git e marcato dalla registrazione di Studio.
fn resolve_managed_worktree(
    context: &RepositoryContext,
    supplied_path: &str,
) -> Result<(PathBuf, PorcelainWorktree), WorktreeError> {
    let canonical_path = confined_lane_root(context, supplied_path)?;
    let entry = listed_worktree(context, &canonical_path)?.ok_or_else(not_listed_error)?;
    let lane_id = managed_lane_id(context, &canonical_path, &entry)?;
    let expected_name = format!(
        "{}{}-{}",
        WORKTREE_PREFIX,
        repository_slug(&context.repository_name),
        lane_id
    );
    if canonical_path.file_name().and_then(|name| name.to_str()) != Some(expected_name.as_str()) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Il nome del worktree non corrisponde alla registrazione Studio",
        ));
    }
    Ok((canonical_path, entry))
}

fn not_listed_error() -> WorktreeError {
    WorktreeError::new(
        WorktreeErrorCode::UnmanagedWorktree,
        "Il percorso non e' registrato da Git come worktree del repository",
    )
}

fn listed_worktree(
    context: &RepositoryContext,
    root: &Path,
) -> Result<Option<PorcelainWorktree>, WorktreeError> {
    Ok(porcelain_worktrees(context)?
        .into_iter()
        .find(|entry| same_path(&entry.path, root)))
}

fn managed_lane_id(
    context: &RepositoryContext,
    root: &Path,
    entry: &PorcelainWorktree,
) -> Result<String, WorktreeError> {
    let branch = entry.branch.as_deref().ok_or_else(|| {
        WorktreeError::new(
            WorktreeErrorCode::UnmanagedWorktree,
            "Un worktree detached non e' gestito da Studio",
        )
    })?;
    let (managed, lane_id, _, _) = registered_values(context, branch, root)?;
    if !managed {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnmanagedWorktree,
            "Il worktree non risulta creato e registrato da Studio",
        ));
    }
    lane_id.ok_or_else(|| {
        WorktreeError::new(
            WorktreeErrorCode::UnmanagedWorktree,
            "La registrazione Studio non contiene l'identificatore corsia",
        )
    })
}

fn validate_supplied_path(supplied_path: &str) -> Result<&Path, WorktreeError> {
    let supplied = Path::new(supplied_path.trim());
    if !supplied.is_absolute() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "L'operazione richiede un percorso worktree assoluto",
        ));
    }
    if has_parent_component(supplied) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::PathTraversal,
            "Il percorso worktree contiene traversal '..'",
        ));
    }
    Ok(supplied)
}

/// Radice canonica, esistente e confinata del worktree indicato: fratello
/// diretto del repository, raggiunto senza link ne' traversal. Non dice
/// ancora nulla sulla registrazione in Git o in Studio.
fn confined_lane_root(
    context: &RepositoryContext,
    supplied_path: &str,
) -> Result<PathBuf, WorktreeError> {
    let supplied = validate_supplied_path(supplied_path)?;
    let metadata = fs::symlink_metadata(supplied).map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::InvalidPath,
            "Il worktree indicato non esiste",
            error.to_string(),
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Link e junction non sono percorsi worktree consentiti",
        ));
    }
    // Il frontend passa il workspace operativo della corsia, che per un progetto
    // aperto in una sottocartella sta dentro il worktree: si risale alla radice
    // fratella del repository. Traversal e link sono gia' stati rifiutati sopra.
    let supplied_canonical = canonical_directory(supplied, "Percorso worktree")?;
    let canonical_path = supplied_canonical
        .ancestors()
        .find(|candidate| {
            candidate
                .parent()
                .is_some_and(|parent| same_path(parent, &context.parent))
        })
        .map(Path::to_path_buf)
        .unwrap_or(supplied_canonical);
    if same_path(&canonical_path, &context.repository_root)
        || !canonical_path
            .parent()
            .is_some_and(|parent| same_path(parent, &context.parent))
    {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Il worktree non e' un fratello diretto del repository",
        ));
    }
    Ok(canonical_path)
}

/// Riepilogo leggibile dei processi che bloccano il cleanup: serve all'utente
/// per riconoscere cosa sta ancora girando, non a Studio per decidere.
fn describe_processes(processes: &[crate::process_tree::LaneProcessInfo]) -> String {
    processes
        .iter()
        .map(|process| match process.pid {
            Some(pid) => format!("{} (PID {})", process.label, pid),
            None => process.label.clone(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Tempo concesso agli alberi di processi della corsia per svuotarsi dopo
/// l'arresto, prima di toccare la cartella: su Windows un processo in chiusura
/// tiene ancora lock sui file e `git worktree remove` si fermerebbe a meta'.
const LANE_PROCESS_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Pre-cleanup (PLAN W11): un worktree con processi vivi non si rimuove.
/// Git cancellerebbe file sotto i piedi di `dotnet watch` o di IIS Express,
/// e su Windows il primo file lockato lascerebbe la cartella a meta'.
/// Restituisce `true` quando ha arrestato qualcosa.
fn stop_or_refuse_processes(root: &Path, stop_processes: bool) -> Result<bool, WorktreeError> {
    let live = crate::process_tree::lane_processes_under(root);
    if live.is_empty() {
        return Ok(false);
    }
    if !stop_processes {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::ProcessesActive,
            "Il worktree ha processi attivi avviati da Studio e non verra' rimosso",
            describe_processes(&live),
        ));
    }
    let report = crate::process_tree::stop_lane_processes_under(root, LANE_PROCESS_DRAIN_TIMEOUT);
    if !report.remaining.is_empty() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::ProcessesActive,
            "Alcuni processi della corsia non si sono arrestati: rimozione annullata",
            describe_processes(&report.remaining),
        ));
    }
    Ok(true)
}

fn ensure_clean_for_removal(root: &Path, allowlisted: &[String]) -> Result<(), WorktreeError> {
    if blocking_changes(root, allowlisted)?.is_empty() {
        Ok(())
    } else {
        Err(WorktreeError::new(
            WorktreeErrorCode::DirtyWorktree,
            "Il worktree contiene modifiche o file non tracciati e non verra' rimosso",
        ))
    }
}

/// Toglie le copie locali dell'allowlist ancora non tracciate: per Git sono
/// file non tracciati e `git worktree remove` (senza `--force`) rifiuterebbe
/// la cartella. Sono copie dei file del checkout principale, che resta intatto.
fn remove_allowlist_copies(root: &Path, allowlisted: &[String]) -> Result<(), WorktreeError> {
    let status = require_git(
        root,
        &git_args(&["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile verificare lo stato del worktree",
    )?;
    for (status, path) in porcelain_status_entries(&status.stdout) {
        if status != "??"
            || !allowlisted
                .iter()
                .any(|allowed| lane_integrate::paths_match(allowed, &path))
        {
            continue;
        }
        let Ok((_, parts)) = normalize_allowlist_path(&path) else {
            continue;
        };
        let mut target = root.to_path_buf();
        for part in &parts {
            target.push(part);
        }
        let is_file = fs::symlink_metadata(&target)
            .is_ok_and(|metadata| metadata.is_file() || metadata.file_type().is_symlink());
        if !is_file {
            continue;
        }
        fs::remove_file(&target).map_err(|error| {
            WorktreeError::with_detail(
                WorktreeErrorCode::WorktreeInUse,
                format!(
                    "Il file locale '{}' della corsia non e' stato rimosso: chiudi i programmi che lo usano e riprova",
                    path
                ),
                error.to_string(),
            )
        })?;
    }
    Ok(())
}

fn prune_worktrees(context: &RepositoryContext) -> Result<(), WorktreeError> {
    require_git(
        &context.repository_root,
        &git_args(&["worktree", "prune"]),
        WorktreeErrorCode::MetadataCleanupFailed,
        "Il worktree e' stato rimosso, ma Git non ha pulito i metadati obsoleti",
    )?;
    Ok(())
}

/// Radice `.omp-wt-<repo>-*` fratella del repository per un percorso che non
/// esiste piu'. Il primo antenato esistente viene canonicalizzato, cosi' un
/// prefisso con link (`/var` su macOS) torna confrontabile con il genitore.
fn missing_lane_root(context: &RepositoryContext, supplied: &Path) -> Option<PathBuf> {
    let mut existing = supplied;
    let mut missing = Vec::new();
    while fs::symlink_metadata(existing).is_err() {
        missing.push(existing.file_name()?.to_owned());
        existing = existing.parent()?;
    }
    let mut resolved = existing
        .canonicalize()
        .unwrap_or_else(|_| existing.to_path_buf());
    for name in missing.iter().rev() {
        resolved.push(name);
    }
    let prefix = format!(
        "{}{}-",
        WORKTREE_PREFIX,
        repository_slug(&context.repository_name)
    );
    resolved
        .ancestors()
        .find(|candidate| {
            candidate
                .parent()
                .is_some_and(|parent| same_path(parent, &context.parent))
        })
        .filter(|root| {
            !same_path(root, &context.repository_root)
                && root
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix) && name.len() > prefix.len())
        })
        .map(Path::to_path_buf)
}

/// Corsia zombie: la cartella non esiste piu' (cancellata a mano, o rimossa da
/// un tentativo precedente). Se Git la registra ancora si potano i metadati; se
/// non la conosce piu' la rimozione e' gia' avvenuta e il ritentativo riesce.
fn remove_missing_worktree(
    context: &RepositoryContext,
    root: &Path,
    stop_processes: bool,
) -> Result<(), WorktreeError> {
    let Some(entry) = listed_worktree(context, root)? else {
        return prune_worktrees(context);
    };
    let lane_id = managed_lane_id(context, root, &entry)?;
    let expected_name = format!(
        "{}{}-{}",
        WORKTREE_PREFIX,
        repository_slug(&context.repository_name),
        lane_id
    );
    if root.file_name().and_then(|name| name.to_str()) != Some(expected_name.as_str()) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Il nome del worktree non corrisponde alla registrazione Studio",
        ));
    }
    if entry.locked_reason.is_some() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::WorktreeLocked,
            "Il worktree e' bloccato da Git e non puo' essere rimosso",
            entry.locked_reason.unwrap_or_default(),
        ));
    }
    stop_or_refuse_processes(root, stop_processes)?;
    prune_worktrees(context)?;
    if listed_worktree(context, root)?.is_some() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::MetadataCleanupFailed,
            "La cartella della corsia non esiste piu', ma Git la registra ancora come worktree",
        ));
    }
    Ok(())
}

/// Cartella di corsia ancora su disco ma non piu' elencata da Git: succede
/// quando `git worktree remove` fallisce a meta' (un file bloccato su Windows)
/// perche' Git toglie comunque i propri metadati. Si rimuove solo se la
/// registrazione Studio nella config del branch la riconosce come corsia.
/// Vero se `root/.git` e' una cartella (un repository vero) o un file
/// `gitdir: <percorso>` che punta a una gitdir ancora esistente: in entrambi i
/// casi la cartella non e' un residuo da cancellare.
fn still_linked_to_git(root: &Path) -> bool {
    let marker = root.join(".git");
    let Ok(metadata) = fs::symlink_metadata(&marker) else {
        return false;
    };
    if metadata.is_dir() {
        return true;
    }
    let Ok(content) = fs::read_to_string(&marker) else {
        return true;
    };
    let Some(target) = content.trim().strip_prefix("gitdir:") else {
        return true;
    };
    let target = Path::new(target.trim());
    let target = if target.is_absolute() {
        target.to_path_buf()
    } else {
        root.join(target)
    };
    target.exists()
}

fn remove_orphan_folder(
    context: &RepositoryContext,
    root: &Path,
    stop_processes: bool,
) -> Result<(), WorktreeError> {
    if registration_for_root(context, root)?.is_none() {
        return Err(not_listed_error());
    }
    // `confined_lane_root` ha gia' escluso link e junction sul percorso dato;
    // la radice stessa viene ricontrollata subito prima di cancellare.
    let is_plain_directory = fs::symlink_metadata(root)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink());
    if !is_plain_directory {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Link e junction non sono percorsi worktree consentiti",
        ));
    }
    if still_linked_to_git(root) {
        // Git non la elenca ma il collegamento e' intatto: piu' probabile un
        // confronto di percorsi mancato (junction, subst, nomi 8.3) che una
        // cartella orfana. Cancellarla perderebbe modifiche non committate.
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnmanagedWorktree,
            "La cartella della corsia e' ancora collegata a Git: rimuovila con git worktree remove o riprova dopo git worktree prune",
        ));
    }
    stop_or_refuse_processes(root, stop_processes)?;
    fs::remove_dir_all(root).map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::WorktreeInUse,
            "La cartella residua della corsia non e' stata rimossa del tutto: chiudi i programmi che ne usano i file e riprova",
            error.to_string(),
        )
    })?;
    prune_worktrees(context)
}

fn remove_sync(args: RemoveWorktreeArgs) -> Result<(), WorktreeError> {
    let _mutation = worktree_mutation_lock();
    let context = discover_repository(&args.project_path)?;
    ensure_repository_has_commit(&context)?;
    let supplied = validate_supplied_path(&args.worktree_path)?;

    let worktree_path = if fs::symlink_metadata(supplied).is_err() {
        let Some(root) = missing_lane_root(&context, supplied) else {
            return Err(WorktreeError::new(
                WorktreeErrorCode::InvalidPath,
                "Il worktree indicato non esiste",
            ));
        };
        if fs::symlink_metadata(&root).is_err() {
            return remove_missing_worktree(&context, &root, args.stop_processes);
        }
        // Manca solo la sottocartella del workspace: si rimuove la radice.
        path_string(&root)?
    } else {
        args.worktree_path.clone()
    };

    let root = confined_lane_root(&context, &worktree_path)?;
    if listed_worktree(&context, &root)?.is_none() {
        return remove_orphan_folder(&context, &root, args.stop_processes);
    }
    let (canonical_path, entry) = resolve_managed_worktree(&context, &worktree_path)?;
    if entry.locked_reason.is_some() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::WorktreeLocked,
            "Il worktree e' bloccato da Git e non puo' essere rimosso",
            entry.locked_reason.unwrap_or_default(),
        ));
    }
    let allowlisted = match entry.branch.as_deref() {
        Some(branch) => allowlist_paths(&context, branch)?,
        None => Vec::new(),
    };

    if args.stop_processes {
        // Prima il controllo delle modifiche: fermare i processi per poi
        // rifiutare la rimozione interromperebbe il lavoro dell'utente per nulla.
        ensure_clean_for_removal(&canonical_path, &allowlisted)?;
        if stop_or_refuse_processes(&canonical_path, true)? {
            // I processi appena fermati potevano aver scritto ancora qualcosa.
            ensure_clean_for_removal(&canonical_path, &allowlisted)?;
        }
    } else {
        stop_or_refuse_processes(&canonical_path, false)?;
        ensure_clean_for_removal(&canonical_path, &allowlisted)?;
    }
    remove_allowlist_copies(&canonical_path, &allowlisted)?;

    let output = run_git(
        &context.repository_root,
        &[
            OsString::from("worktree"),
            OsString::from("remove"),
            OsString::from("--"),
            git_path_arg(&canonical_path),
        ],
    )?;
    if !output.status.success() {
        let detail = output_detail(&output);
        let lower = detail.to_ascii_lowercase();
        let code = if lower.contains("lock")
            || lower.contains("in use")
            || lower.contains("permission denied")
            || lower.contains("accesso negato")
        {
            WorktreeErrorCode::WorktreeInUse
        } else {
            WorktreeErrorCode::GitCommandFailed
        };
        return Err(WorktreeError::with_detail(
            code,
            "Git ha rifiutato la rimozione sicura del worktree; nessun --force e' stato usato",
            detail,
        ));
    }

    prune_worktrees(&context)
}

// ---------------------------------------------------------------------------
// Profilo worktree: rilevamento stack e file locali non versionati (PLAN W10)
// ---------------------------------------------------------------------------

/// Cartelle rigenerabili da build o restore. Non vengono attraversate dallo
/// scan, non finiscono mai nell'allowlist e non vengono mai collegate con
/// junction: MSBuild e i runtime .NET tengono lock esclusivi sui loro file.
const GENERATED_DIRECTORIES: &[&str] = &[
    "bin",
    "obj",
    ".vs",
    "packages",
    "node_modules",
    "dist",
    "build",
    "out",
    ".svelte-kit",
    "target",
    ".next",
    "TestResults",
    "coverage",
];

const MAX_SCAN_DEPTH: usize = 5;
const MAX_SCAN_ENTRIES: usize = 20_000;
const MAX_PACKAGES_ENTRIES: usize = 60_000;
const MANIFEST_READ_LIMIT: u64 = 256 * 1024;
const MAX_CANDIDATE_BYTES: u64 = 64 * 1024;
const MAX_CANDIDATE_DEPTH: usize = 3;
const MAX_CANDIDATES: usize = 64;
const MAX_ALLOWLIST_BYTES: u64 = 256 * 1024;
const MAX_ALLOWLIST_DEPTH: usize = 8;
const MAX_PACKAGE_JSON_DEPENDENCIES: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManifestKind {
    Solution,
    CsProject,
    VbProject,
    FsProject,
    PackagesConfig,
    PackageJson,
    ViteConfig,
    SvelteConfig,
    WebConfig,
    GlobalJson,
    NugetConfig,
    DirectoryPackagesProps,
    IndexHtml,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub relative_path: String,
    /// Cartella del manifesto relativa alla radice, stringa vuota per la radice.
    pub directory: String,
    pub kind: ManifestKind,
    /// Progetti MSBuild: `true` con attributo `Sdk`, `false` in formato legacy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk_style: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_reference: Option<bool>,
    pub target_frameworks: Vec<String>,
    pub dependencies: Vec<String>,
}

/// Regola che ha proposto un file locale. Nessuna regola autorizza la copia:
/// serve solo a spiegare all'utente perche' il file e' stato mostrato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateRule {
    DotEnv,
    IniFile,
    LocalSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntrackedCandidate {
    pub relative_path: String,
    pub bytes: u64,
    pub ignored: bool,
    pub rule: CandidateRule,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagesDirectory {
    pub relative_path: String,
    pub bytes: u64,
    pub file_count: u64,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeCacheKind {
    Nuget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCacheInfo {
    pub kind: NativeCacheKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeProfileScan {
    pub repository_root: String,
    pub manifests: Vec<ManifestEntry>,
    pub untracked_candidates: Vec<UntrackedCandidate>,
    pub generated_directories: Vec<String>,
    pub packages_directories: Vec<PackagesDirectory>,
    pub native_caches: Vec<NativeCacheInfo>,
    /// `true` quando lo scan ha toccato i propri limiti di profondita' o
    /// numero di voci: il profilo resta valido ma non esaustivo.
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AllowlistCopyStatus {
    Copied,
    AlreadyPresent,
    SourceMissing,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistCopyOutcome {
    pub relative_path: String,
    pub status: AllowlistCopyStatus,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileScanArgs {
    pub project_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyAllowlistArgs {
    pub project_path: String,
    pub worktree_path: String,
    pub files: Vec<String>,
}

fn is_generated_directory(name: &str) -> bool {
    GENERATED_DIRECTORIES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn is_skipped_directory(name: &str) -> bool {
    name.eq_ignore_ascii_case(".git") || is_generated_directory(name)
}

/// Percorso relativo con separatore `/`: e' la forma persistita nel profilo,
/// identica su Windows e POSIX.
fn relative_slash_path(root: &Path, path: &Path) -> Result<String, WorktreeError> {
    let relative = path.strip_prefix(root).map_err(|_| {
        WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "Il percorso analizzato non e' contenuto nella radice del repository",
        )
    })?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => {
                return Err(WorktreeError::new(
                    WorktreeErrorCode::PathTraversal,
                    "Il percorso analizzato contiene componenti non consentiti",
                ))
            }
        }
    }
    Ok(parts.join("/"))
}

fn manifest_kind(file_name: &str) -> Option<ManifestKind> {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".sln") {
        return Some(ManifestKind::Solution);
    }
    if lower.ends_with(".csproj") {
        return Some(ManifestKind::CsProject);
    }
    if lower.ends_with(".vbproj") {
        return Some(ManifestKind::VbProject);
    }
    if lower.ends_with(".fsproj") {
        return Some(ManifestKind::FsProject);
    }
    if lower.starts_with("vite.config.") {
        return Some(ManifestKind::ViteConfig);
    }
    if lower.starts_with("svelte.config.") {
        return Some(ManifestKind::SvelteConfig);
    }
    match lower.as_str() {
        "packages.config" => Some(ManifestKind::PackagesConfig),
        "package.json" => Some(ManifestKind::PackageJson),
        "web.config" => Some(ManifestKind::WebConfig),
        "global.json" => Some(ManifestKind::GlobalJson),
        "nuget.config" => Some(ManifestKind::NugetConfig),
        "directory.packages.props" => Some(ManifestKind::DirectoryPackagesProps),
        "index.html" => Some(ManifestKind::IndexHtml),
        _ => None,
    }
}

fn read_head(path: &Path, limit: u64) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::new();
    file.take(limit).read_to_end(&mut buffer).ok()?;
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

/// Testo interno dei tag richiesti. `lower` conserva gli offset di `content`
/// perche' `to_ascii_lowercase` tocca solo i byte ASCII.
fn xml_inner_values(content: &str, lower: &str, tag: &str) -> Vec<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut values = Vec::new();
    let mut cursor = 0usize;
    while let Some(found) = lower[cursor..].find(&open) {
        let start = cursor + found;
        let Some(tag_end) = lower[start..].find('>') else {
            break;
        };
        let value_start = start + tag_end + 1;
        let Some(value_end) = lower[value_start..].find(&close) else {
            cursor = value_start;
            continue;
        };
        let raw = content[value_start..value_start + value_end].trim();
        if !raw.is_empty() && !raw.contains('<') {
            values.push(raw.to_string());
        }
        cursor = value_start + value_end;
    }
    values
}

fn msbuild_evidence(content: &str) -> (Option<bool>, Option<bool>, Vec<String>) {
    let lower = content.to_ascii_lowercase();
    let sdk_style = lower.find("<project").map(|start| {
        let end = lower[start..].find('>').map_or(lower.len(), |o| start + o);
        lower[start..end].contains("sdk=")
    });
    let package_reference = Some(lower.contains("<packagereference"));
    let mut frameworks = Vec::new();
    for tag in [
        "targetframework",
        "targetframeworks",
        "targetframeworkversion",
    ] {
        for value in xml_inner_values(content, &lower, tag) {
            for piece in value.split(';') {
                let piece = piece.trim();
                if !piece.is_empty() && !frameworks.iter().any(|f| f == piece) {
                    frameworks.push(piece.to_string());
                }
            }
        }
    }
    (sdk_style, package_reference, frameworks)
}

fn package_json_dependencies(content: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for section in ["dependencies", "devDependencies"] {
        let Some(map) = value.get(section).and_then(|entry| entry.as_object()) else {
            continue;
        };
        for key in map.keys() {
            if names.len() >= MAX_PACKAGE_JSON_DEPENDENCIES {
                break;
            }
            if !names.iter().any(|name| name == key) {
                names.push(key.clone());
            }
        }
    }
    names.sort();
    names
}

fn manifest_entry(
    root: &Path,
    path: &Path,
    kind: ManifestKind,
) -> Result<ManifestEntry, WorktreeError> {
    let relative_path = relative_slash_path(root, path)?;
    let directory = relative_path
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default();
    let mut entry = ManifestEntry {
        relative_path,
        directory,
        kind,
        sdk_style: None,
        package_reference: None,
        target_frameworks: Vec::new(),
        dependencies: Vec::new(),
    };
    match kind {
        ManifestKind::CsProject | ManifestKind::VbProject | ManifestKind::FsProject => {
            if let Some(content) = read_head(path, MANIFEST_READ_LIMIT) {
                let (sdk_style, package_reference, frameworks) = msbuild_evidence(&content);
                entry.sdk_style = sdk_style;
                entry.package_reference = package_reference;
                entry.target_frameworks = frameworks;
            }
        }
        ManifestKind::PackageJson => {
            if let Some(content) = read_head(path, MANIFEST_READ_LIMIT) {
                entry.dependencies = package_json_dependencies(&content);
            }
        }
        _ => {}
    }
    Ok(entry)
}

/// Stima limitata del peso di una cartella `packages/`: serve solo ad avvisare
/// l'utente del costo su disco di un restore `packages.config`.
fn estimate_packages_directory(
    root: &Path,
    path: &Path,
) -> Result<PackagesDirectory, WorktreeError> {
    let relative_path = relative_slash_path(root, path)?;
    let mut bytes = 0u64;
    let mut file_count = 0u64;
    let mut budget = MAX_PACKAGES_ENTRIES;
    let mut truncated = false;
    let mut stack = vec![path.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if budget == 0 {
                truncated = true;
                break;
            }
            budget -= 1;
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                file_count += 1;
                if let Ok(metadata) = entry.metadata() {
                    bytes += metadata.len();
                }
            }
        }
    }
    Ok(PackagesDirectory {
        relative_path,
        bytes,
        file_count,
        truncated,
    })
}

/// Regole di proposta dei file locali. Deliberatamente strette: un file fuori
/// da queste forme non viene nemmeno mostrato, e nessuna di esse basta a
/// copiarlo senza il consenso esplicito dell'utente.
fn candidate_rule(file_name: &str) -> Option<CandidateRule> {
    const LOCAL_SETTINGS: &[&str] = &[
        "secrets.json",
        "local.settings.json",
        "appsettings.local.json",
        "appsettings.development.json",
        "connectionstrings.config",
        ".npmrc",
    ];
    let lower = file_name.to_ascii_lowercase();
    if lower == ".env" || lower.starts_with(".env.") {
        return Some(CandidateRule::DotEnv);
    }
    if lower.ends_with(".ini") {
        return Some(CandidateRule::IniFile);
    }
    if LOCAL_SETTINGS.contains(&lower.as_str())
        || lower.ends_with(".local.json")
        || lower.ends_with(".local.config")
    {
        return Some(CandidateRule::LocalSettings);
    }
    None
}

fn untracked_candidates(
    context: &RepositoryContext,
) -> Result<Vec<UntrackedCandidate>, WorktreeError> {
    let output = require_git(
        &context.repository_root,
        &git_args(&[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--ignored=traditional",
            "-z",
        ]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile elencare i file locali non versionati",
    )?;

    let mut candidates: Vec<UntrackedCandidate> = Vec::new();
    let mut entries = output.stdout.split(|byte| *byte == 0);
    while let Some(raw) = entries.next() {
        if raw.len() < 4 {
            continue;
        }
        let index = raw[0];
        let worktree = raw[1];
        // Rinomine e copie occupano due voci: la seconda e' il percorso di origine.
        if matches!(index, b'R' | b'C') || matches!(worktree, b'R' | b'C') {
            entries.next();
        }
        let ignored = index == b'!' && worktree == b'!';
        if !ignored && !(index == b'?' && worktree == b'?') {
            continue;
        }
        let path = String::from_utf8_lossy(&raw[3..]).trim().to_string();
        if path.is_empty() || path.ends_with('/') {
            continue;
        }
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        if parts.is_empty() || parts.len() > MAX_CANDIDATE_DEPTH {
            continue;
        }
        if parts
            .iter()
            .any(|part| is_skipped_directory(part) || *part == ".." || *part == ".")
        {
            continue;
        }
        let Some(rule) = candidate_rule(parts[parts.len() - 1]) else {
            continue;
        };
        let mut absolute = context.repository_root.clone();
        for part in &parts {
            absolute.push(part);
        }
        let Ok(metadata) = fs::symlink_metadata(&absolute) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let bytes = metadata.len();
        if bytes > MAX_CANDIDATE_BYTES {
            continue;
        }
        candidates.push(UntrackedCandidate {
            relative_path: parts.join("/"),
            bytes,
            ignored,
            rule,
        });
    }

    candidates.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    candidates.dedup_by(|left, right| left.relative_path == right.relative_path);
    candidates.truncate(MAX_CANDIDATES);
    Ok(candidates)
}

fn home_directory() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Cache globale NuGet: con `PackageReference` il restore la riusa e il
/// worktree non duplica un solo byte di pacchetti.
fn nuget_cache() -> NativeCacheInfo {
    let configured = std::env::var_os("NUGET_PACKAGES")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());
    let path = configured.or_else(|| home_directory().map(|home| home.join(".nuget/packages")));
    let available = path.as_deref().is_some_and(Path::is_dir);
    NativeCacheInfo {
        kind: NativeCacheKind::Nuget,
        path: path.as_deref().and_then(|value| path_string(value).ok()),
        available,
    }
}

fn scan_sync(project_path: &str) -> Result<WorktreeProfileScan, WorktreeError> {
    let context = discover_repository(project_path)?;
    let root = context.repository_root.clone();

    let mut manifests: Vec<ManifestEntry> = Vec::new();
    let mut generated_directories: Vec<String> = Vec::new();
    let mut packages_directories: Vec<PackagesDirectory> = Vec::new();
    let mut truncated = false;
    let mut budget = MAX_SCAN_ENTRIES;
    let mut stack = vec![(root.clone(), 0usize)];

    while let Some((directory, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if budget == 0 {
                truncated = true;
                break;
            }
            budget -= 1;
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // Junction e symlink non vengono mai seguiti: un worktree .NET
            // deve restare fisicamente separato.
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if file_type.is_dir() {
                if is_generated_directory(&name) {
                    if name.eq_ignore_ascii_case("packages") {
                        packages_directories.push(estimate_packages_directory(&root, &path)?);
                    }
                    generated_directories.push(relative_slash_path(&root, &path)?);
                    continue;
                }
                if name.eq_ignore_ascii_case(".git") {
                    continue;
                }
                if depth < MAX_SCAN_DEPTH {
                    stack.push((path, depth + 1));
                } else {
                    truncated = true;
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if let Some(kind) = manifest_kind(&name) {
                manifests.push(manifest_entry(&root, &path, kind)?);
            }
        }
    }

    manifests.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    generated_directories.sort();
    generated_directories.dedup();
    packages_directories.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(WorktreeProfileScan {
        repository_root: path_string(&root)?,
        manifests,
        untracked_candidates: untracked_candidates(&context)?,
        generated_directories,
        packages_directories,
        native_caches: vec![nuget_cache()],
        truncated,
    })
}

/// Normalizza un percorso dell'allowlist. Restituisce la forma canonica con
/// separatore `/` e i segmenti da unire, oppure il motivo del rifiuto.
fn normalize_allowlist_path(raw: &str) -> Result<(String, Vec<String>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("Percorso vuoto o non valido".to_string());
    }
    if Path::new(trimmed).is_absolute() || trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err("Sono ammessi solo percorsi relativi alla radice del repository".to_string());
    }
    if trimmed.len() > 1 && trimmed.as_bytes()[1] == b':' {
        return Err("Sono ammessi solo percorsi relativi alla radice del repository".to_string());
    }
    let parts: Vec<String> = trimmed
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect();
    if parts.is_empty() || parts.len() > MAX_ALLOWLIST_DEPTH {
        return Err("Percorso non consentito".to_string());
    }
    if parts.iter().any(|part| part == ".." || part == ".") {
        return Err("Il percorso contiene traversal".to_string());
    }
    if parts.iter().any(|part| is_skipped_directory(part)) {
        return Err("Le cartelle generate non vengono mai copiate".to_string());
    }
    Ok((parts.join("/"), parts))
}

fn apply_allowlist_sync(
    args: ApplyAllowlistArgs,
) -> Result<Vec<AllowlistCopyOutcome>, WorktreeError> {
    let context = discover_repository(&args.project_path)?;
    // La corsia registra il proprio `workspacePath`, che per un progetto in
    // sottocartella non coincide con la radice del worktree: Git risolve la
    // radice reale prima delle validazioni di sicurezza.
    let workspace = Path::new(args.worktree_path.trim());
    if has_parent_component(workspace) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::PathTraversal,
            "Il percorso worktree contiene traversal '..'",
        ));
    }
    let canonical_workspace = canonical_directory(workspace, "Percorso worktree")?;
    let toplevel = require_git(
        &canonical_workspace,
        &git_args(&["rev-parse", "--show-toplevel"]),
        WorktreeErrorCode::UnmanagedWorktree,
        "Il percorso della corsia non appartiene a un worktree Git",
    )?;
    let toplevel_text = String::from_utf8_lossy(&toplevel.stdout).trim().to_string();
    let (worktree_root, entry) = resolve_managed_worktree(&context, &toplevel_text)?;

    let mut outcomes = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for raw in &args.files {
        let (relative_path, parts) = match normalize_allowlist_path(raw) {
            Ok(value) => value,
            Err(reason) => {
                outcomes.push(AllowlistCopyOutcome {
                    relative_path: raw.trim().to_string(),
                    status: AllowlistCopyStatus::Rejected,
                    bytes: 0,
                    reason: Some(reason),
                });
                continue;
            }
        };
        if seen.contains(&relative_path) {
            continue;
        }
        seen.push(relative_path.clone());

        let mut source = context.repository_root.clone();
        let mut destination = worktree_root.clone();
        for part in &parts {
            source.push(part);
            destination.push(part);
        }

        let metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) => metadata,
            Err(_) => {
                outcomes.push(AllowlistCopyOutcome {
                    relative_path,
                    status: AllowlistCopyStatus::SourceMissing,
                    bytes: 0,
                    reason: None,
                });
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            outcomes.push(AllowlistCopyOutcome {
                relative_path,
                status: AllowlistCopyStatus::Rejected,
                bytes: 0,
                reason: Some("Solo i file regolari vengono copiati".to_string()),
            });
            continue;
        }
        let bytes = metadata.len();
        if bytes > MAX_ALLOWLIST_BYTES {
            outcomes.push(AllowlistCopyOutcome {
                relative_path,
                status: AllowlistCopyStatus::Rejected,
                bytes,
                reason: Some(format!(
                    "Il file supera il limite di {} KiB previsto per i file locali",
                    MAX_ALLOWLIST_BYTES / 1024
                )),
            });
            continue;
        }
        if destination.exists() {
            outcomes.push(AllowlistCopyOutcome {
                relative_path,
                status: AllowlistCopyStatus::AlreadyPresent,
                bytes,
                reason: None,
            });
            continue;
        }

        let contents = match fs::read(&source) {
            Ok(contents) => contents,
            Err(error) => {
                outcomes.push(AllowlistCopyOutcome {
                    relative_path,
                    status: AllowlistCopyStatus::Rejected,
                    bytes,
                    reason: Some(error.to_string()),
                });
                continue;
            }
        };
        if let Some(parent) = destination.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                outcomes.push(AllowlistCopyOutcome {
                    relative_path,
                    status: AllowlistCopyStatus::Rejected,
                    bytes,
                    reason: Some(error.to_string()),
                });
                continue;
            }
        }
        // Scrittura atomica: il worktree non vede mai un file a meta'.
        match crate::fs_atomic::atomic_write(&destination, &contents) {
            Ok(()) => outcomes.push(AllowlistCopyOutcome {
                relative_path,
                status: AllowlistCopyStatus::Copied,
                bytes,
                reason: None,
            }),
            Err(error) => outcomes.push(AllowlistCopyOutcome {
                relative_path,
                status: AllowlistCopyStatus::Rejected,
                bytes,
                reason: Some(error),
            }),
        }
    }

    // Le copie sono configurazione locale (Parametri.ini, .env): restano
    // registrate sul branch della corsia, cosi' il commit automatico
    // dell'integrazione le esclude e la rimozione non le scambia per lavoro.
    // Anche le copie gia' presenti e non tracciate: corsie create prima di
    // questa registrazione hanno il file ma non la voce in config.
    let mut copied: Vec<String> = Vec::new();
    for outcome in &outcomes {
        let record = match outcome.status {
            AllowlistCopyStatus::Copied => true,
            AllowlistCopyStatus::AlreadyPresent => {
                let tracked = require_git(
                    &worktree_root,
                    &[
                        OsString::from("ls-files"),
                        OsString::from("-z"),
                        OsString::from("--"),
                        OsString::from(format!(":(literal){}", outcome.relative_path)),
                    ],
                    WorktreeErrorCode::GitCommandFailed,
                    "Impossibile verificare i file locali della corsia",
                )?;
                tracked.stdout.is_empty()
            }
            _ => false,
        };
        if record {
            copied.push(outcome.relative_path.clone());
        }
    }
    if let Some(branch) = entry.branch.as_deref() {
        record_allowlist_paths(&context, branch, &copied)?;
    }

    Ok(outcomes)
}

fn parse_porcelain_z_dirty_files(raw: &[u8]) -> Vec<String> {
    let mut files = Vec::new();
    let mut parts = raw.split(|b| *b == 0);
    while let Some(entry) = parts.next() {
        if entry.is_empty() {
            continue;
        }
        if let Ok(entry_str) = std::str::from_utf8(entry) {
            if entry_str.len() >= 3 {
                let status = &entry_str[..2];
                let path = &entry_str[3..];
                files.push(path.replace('\\', "/"));
                if status.starts_with('R') || status.starts_with('C') {
                    if let Some(second) = parts.next() {
                        if let Ok(second_str) = std::str::from_utf8(second) {
                            if !second_str.is_empty() {
                                files.push(second_str.replace('\\', "/"));
                            }
                        }
                    }
                }
            }
        }
    }
    files
}

fn inspect_review_sync(
    args: WorktreeReviewInspectArgs,
) -> Result<WorktreeReviewInspection, WorktreeError> {
    let context = discover_repository(&args.project_path)?;
    let (canonical_worktree, porcelain_entry) =
        resolve_managed_worktree(&context, &args.worktree_path)?;

    let (_managed, _lane_id, registered_base_commit, registered_target_branch) =
        match porcelain_entry.branch.as_deref() {
            Some(branch) => registered_values(&context, branch, &canonical_worktree)?,
            None => (false, None, None, None),
        };

    // 1. Risoluzione target branch
    let target_branch = match args
        .target_branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        Some(tb) => tb.trim().to_string(),
        None => match registered_target_branch.as_deref() {
            Some(tb) => tb.to_string(),
            None => "main".to_string(),
        },
    };

    // 2. SHA del branch target
    let target_sha = {
        let out = run_git(
            &context.repository_root,
            &git_args(&[
                "rev-parse",
                "--verify",
                &format!("refs/heads/{}", target_branch),
            ]),
        );
        match out {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => {
                let fallback = run_git(
                    &context.repository_root,
                    &git_args(&["rev-parse", "--verify", &target_branch]),
                );
                match fallback {
                    Ok(f) if f.status.success() => {
                        String::from_utf8_lossy(&f.stdout).trim().to_string()
                    }
                    _ => {
                        return Err(WorktreeError::with_detail(
                            WorktreeErrorCode::InvalidTargetBranch,
                            format!("Branch di destinazione '{}' non trovato", target_branch),
                            "",
                        ));
                    }
                }
            }
        }
    };

    // 3. SHA corrente di HEAD della corsia
    let current_sha = {
        let out = require_git(
            &canonical_worktree,
            &git_args(&["rev-parse", "--verify", "HEAD"]),
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile determinare HEAD della corsia",
        )?;
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };

    // 4. SHA del base commit (merge-base tra target e HEAD della corsia)
    let base_sha = {
        let merge_base = run_git(
            &canonical_worktree,
            &git_args(&[
                "merge-base",
                &format!("refs/heads/{}", target_branch),
                "HEAD",
            ]),
        );
        match merge_base {
            Ok(m) if m.status.success() => {
                let sha = String::from_utf8_lossy(&m.stdout).trim().to_string();
                if sha.len() == 40 {
                    sha
                } else {
                    registered_base_commit
                        .clone()
                        .unwrap_or_else(|| target_sha.clone())
                }
            }
            _ => registered_base_commit
                .clone()
                .unwrap_or_else(|| target_sha.clone()),
        }
    };

    // 5. Drift (ahead: target avanzato rispetto alla corsia; behind: corsia avanzata rispetto a target)
    let (drift_ahead, drift_behind) = {
        let out = run_git(
            &canonical_worktree,
            &git_args(&[
                "rev-list",
                "--left-right",
                "--count",
                &format!("refs/heads/{}...HEAD", target_branch),
            ]),
        );
        match out {
            Ok(o) if o.status.success() => {
                let txt = String::from_utf8_lossy(&o.stdout);
                let mut parts = txt.split_whitespace();
                let ahead = parts
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0);
                let behind = parts
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0);
                (ahead, behind)
            }
            _ => (0, 0),
        }
    };

    // 6. Pulizia e checkout: un errore di lettura fallisce chiuso, mai "pulito".
    let target_dirty_files = lane_integrate::porcelain_files(&context.repository_root)?;
    let is_target_dirty = !target_dirty_files.is_empty();
    let lane_dirty_files = lane_integrate::porcelain_files(&canonical_worktree)?;
    let is_lane_dirty = !lane_dirty_files.is_empty();
    let is_target_checked_out = lane_integrate::attached_branch(&context.repository_root)?
        .as_deref()
        == Some(target_branch.as_str());

    // 7. Conflitti non risolti (nella corsia o nel target)
    let has_unresolved_conflicts = !lane_integrate::unmerged_paths(&canonical_worktree)?.is_empty()
        || !lane_integrate::unmerged_paths(&context.repository_root)?.is_empty();

    // 8. Lista dei commit eseguiti nella corsia
    let commits = {
        let sep = '\u{1f}';
        let fmt = format!("%H{sep}%h{sep}%an{sep}%at{sep}%s");
        let log_out = run_git(
            &canonical_worktree,
            &git_args(&[
                "log",
                &format!("--pretty=format:{}", fmt),
                &format!("refs/heads/{}..HEAD", target_branch),
            ]),
        );
        let mut list = Vec::new();
        if let Ok(o) = log_out {
            if o.status.success() {
                for line in String::from_utf8_lossy(&o.stdout).lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let parts: Vec<&str> = line.split(sep).collect();
                    if parts.len() >= 5 {
                        list.push(ReviewCommitInfo {
                            hash: parts[0].to_string(),
                            short: parts[1].to_string(),
                            author: parts[2].to_string(),
                            time: parts[3].parse::<i64>().unwrap_or(0),
                            subject: parts[4].to_string(),
                        });
                    }
                }
            }
        }
        list
    };

    // 9. Diff aggregato file (tracked da base_sha a working copy, piu' untracked rilevanti)
    let (files, total_additions, total_deletions) = {
        let mut diff_files: std::collections::BTreeMap<String, ReviewFileDiff> =
            std::collections::BTreeMap::new();

        // Tracked changes via git diff base_sha
        let status_out = run_git(
            &canonical_worktree,
            &git_args(&[
                "-c",
                "core.quotepath=false",
                "diff",
                &base_sha,
                "--name-status",
                "-M",
            ]),
        );
        let numstat_out = run_git(
            &canonical_worktree,
            &git_args(&[
                "-c",
                "core.quotepath=false",
                "diff",
                &base_sha,
                "--numstat",
                "-M",
            ]),
        );

        if let (Ok(s_out), Ok(n_out)) = (status_out, numstat_out) {
            if s_out.status.success() && n_out.status.success() {
                let merged = super::merge_name_status_numstat(&s_out.stdout, &n_out.stdout);
                for entry in merged {
                    let additions = entry.insertions.unwrap_or(0) as u64;
                    let deletions = entry.deletions.unwrap_or(0) as u64;
                    diff_files.insert(
                        entry.path.clone(),
                        ReviewFileDiff {
                            path: entry.path,
                            status: entry.status,
                            additions,
                            deletions,
                            is_untracked: false,
                        },
                    );
                }
            }
        }

        // Untracked files rilevanti in worktree
        if let Ok(untracked_out) = run_git(
            &canonical_worktree,
            &git_args(&["ls-files", "--others", "--exclude-standard", "-z"]),
        ) {
            if untracked_out.status.success() {
                for raw_path in untracked_out
                    .stdout
                    .split(|b| *b == 0)
                    .filter(|b| !b.is_empty())
                {
                    if let Ok(rel) = std::str::from_utf8(raw_path) {
                        let normalized = rel.replace('\\', "/");
                        let full_path = canonical_worktree.join(rel);
                        let additions = super::count_untracked_text_lines(&full_path).unwrap_or(0);
                        diff_files.insert(
                            normalized.clone(),
                            ReviewFileDiff {
                                path: normalized,
                                status: "A".to_string(),
                                additions,
                                deletions: 0,
                                is_untracked: true,
                            },
                        );
                    }
                }
            }
        }

        let mut total_add = 0_u64;
        let mut total_del = 0_u64;
        let list: Vec<ReviewFileDiff> = diff_files
            .into_values()
            .inspect(|f| {
                total_add = total_add.saturating_add(f.additions);
                total_del = total_del.saturating_add(f.deletions);
            })
            .collect();

        (list, total_add, total_del)
    };

    Ok(WorktreeReviewInspection {
        target_branch,
        target_sha,
        base_sha,
        current_sha,
        drift_ahead,
        drift_behind,
        is_target_dirty,
        target_dirty_files,
        is_lane_dirty,
        lane_dirty_files,
        is_target_checked_out,
        has_unresolved_conflicts,
        commits,
        files,
        total_additions,
        total_deletions,
    })
}

fn task_join_error(operation: &str, error: tokio::task::JoinError) -> WorktreeError {
    WorktreeError::with_detail(
        WorktreeErrorCode::Internal,
        format!("Task {} interrotto", operation),
        error.to_string(),
    )
}

#[command]
pub async fn worktree_inspect(
    args: InspectWorktreeArgs,
) -> Result<RepositoryInspection, WorktreeError> {
    tokio::task::spawn_blocking(move || inspect_sync(&args.project_path))
        .await
        .map_err(|error| task_join_error("worktree_inspect", error))?
}

#[command]
pub async fn worktree_create(args: CreateWorktreeArgs) -> Result<WorktreeInfo, WorktreeError> {
    tokio::task::spawn_blocking(move || create_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_create", error))?
}

#[command]
pub async fn worktree_list(args: ListWorktreesArgs) -> Result<Vec<WorktreeInfo>, WorktreeError> {
    tokio::task::spawn_blocking(move || list_sync(&args.project_path))
        .await
        .map_err(|error| task_join_error("worktree_list", error))?
}

#[command]
pub async fn worktree_remove(args: RemoveWorktreeArgs) -> Result<(), WorktreeError> {
    tokio::task::spawn_blocking(move || remove_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_remove", error))?
}

#[command]
pub async fn worktree_profile_scan(
    args: ProfileScanArgs,
) -> Result<WorktreeProfileScan, WorktreeError> {
    tokio::task::spawn_blocking(move || scan_sync(&args.project_path))
        .await
        .map_err(|error| task_join_error("worktree_profile_scan", error))?
}

#[command]
pub async fn worktree_apply_allowlist(
    args: ApplyAllowlistArgs,
) -> Result<Vec<AllowlistCopyOutcome>, WorktreeError> {
    tokio::task::spawn_blocking(move || apply_allowlist_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_apply_allowlist", error))?
}

#[command]
pub async fn worktree_review_inspect(
    args: WorktreeReviewInspectArgs,
) -> Result<WorktreeReviewInspection, WorktreeError> {
    tokio::task::spawn_blocking(move || inspect_review_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_review_inspect", error))?
}

#[command]
pub async fn worktree_land(
    args: lane_integrate::WorktreeLandArgs,
) -> Result<lane_integrate::WorktreeLandOutcome, WorktreeError> {
    tokio::task::spawn_blocking(move || lane_integrate::land_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_land", error))?
}

#[command]
pub async fn worktree_undo_land(
    args: lane_integrate::WorktreeUndoLandArgs,
) -> Result<lane_integrate::WorktreeUndoLandOutcome, WorktreeError> {
    tokio::task::spawn_blocking(move || lane_integrate::undo_land_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_undo_land", error))?
}
#[command]
pub async fn worktree_delete_lane_branch(
    args: lane_integrate::DeleteLaneBranchArgs,
) -> Result<(), WorktreeError> {
    tokio::task::spawn_blocking(move || lane_integrate::delete_lane_branch_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_delete_lane_branch", error))?
}

/// Commit e file del branch di corsia che eliminarlo farebbe perdere: serve
/// alla conferma "scarta il lavoro non integrato". Sola lettura.
#[command]
pub async fn worktree_lane_unintegrated_summary(
    args: lane_integrate::LaneBranchQueryArgs,
) -> Result<lane_integrate::LaneUnintegratedSummary, WorktreeError> {
    tokio::task::spawn_blocking(move || lane_integrate::lane_unintegrated_summary_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_lane_unintegrated_summary", error))?
}

/// Esiste il branch della corsia, ed e' integrato? Sola lettura: all'avvio
/// riconcilia le corsie rimaste in stato `integrating`.
#[command]
pub async fn worktree_lane_integration_state(
    args: lane_integrate::LaneBranchQueryArgs,
) -> Result<lane_integrate::LaneIntegrationState, WorktreeError> {
    tokio::task::spawn_blocking(move || lane_integrate::lane_integration_state_sync(args))
        .await
        .map_err(|error| task_join_error("worktree_lane_integration_state", error))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_tree::LaneProcessControl;
    use lane_integrate::WorktreeLandOutcome;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestRepository {
        container: PathBuf,
        root: PathBuf,
        nested: PathBuf,
        commit: Option<String>,
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.container);
        }
    }

    fn test_git(cwd: &Path, args: &[&str]) -> Output {
        let mut command = Command::new("git");
        command.current_dir(cwd).args(args);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .output()
            .expect("git deve essere disponibile nei test");
        assert!(
            output.status.success(),
            "git {:?}: {}",
            args,
            output_detail(&output)
        );
        output
    }

    fn repository(with_commit: bool) -> TestRepository {
        let sequence = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let container = std::env::temp_dir().join(format!(
            "omp-studio-worktrees-{}-{}",
            std::process::id(),
            sequence
        ));
        let _ = fs::remove_dir_all(&container);
        fs::create_dir_all(&container).unwrap();
        let root = container.join("Repo Con Spazi");
        fs::create_dir_all(&root).unwrap();
        test_git(&root, &["init"]);
        test_git(&root, &["config", "user.name", "OMP Studio Test"]);
        test_git(
            &root,
            &["config", "user.email", "studio-test@example.invalid"],
        );
        // I test confrontano byte: l'autocrlf globale dell'utente li renderebbe
        // dipendenti dalla macchina.
        test_git(&root, &["config", "core.autocrlf", "false"]);
        let nested = root.join("cartella con spazi");
        fs::create_dir_all(&nested).unwrap();

        let commit = if with_commit {
            fs::write(nested.join("tracked.txt"), "contenuto\n").unwrap();
            test_git(&root, &["add", "."]);
            test_git(&root, &["commit", "-m", "commit iniziale"]);
            test_git(&root, &["branch", "-M", "main"]);
            Some(
                String::from_utf8_lossy(&test_git(&root, &["rev-parse", "HEAD"]).stdout)
                    .trim()
                    .to_string(),
            )
        } else {
            None
        };

        TestRepository {
            container,
            root,
            nested,
            commit,
        }
    }

    fn create_args(repo: &TestRepository, lane_id: &str) -> CreateWorktreeArgs {
        CreateWorktreeArgs {
            project_path: path_string(&repo.nested).unwrap(),
            lane_id: lane_id.to_string(),
            base_commit: repo.commit.clone().unwrap(),
            target_branch: "main".to_string(),
        }
    }

    #[test]
    fn crea_elenca_e_rimuove_un_worktree_fratello_da_una_sottocartella() {
        let repo = repository(true);
        let inspection = inspect_sync(&path_string(&repo.nested).unwrap()).unwrap();
        assert_eq!(inspection.head_state, RepositoryHeadState::Attached);
        assert_eq!(inspection.relative_subpath, "cartella con spazi");

        let created = create_sync(create_args(&repo, "lane-01")).unwrap();
        assert_eq!(created.branch.as_deref(), Some("omp/lane-lane-01"));
        assert_eq!(created.target_branch.as_deref(), Some("main"));
        assert!(created.managed_by_studio);
        assert!(Path::new(&created.worktree_path)
            .file_name()
            .is_some_and(|name| name == ".omp-wt-repo-con-spazi-lane-01"));
        assert!(created.workspace_path.ends_with("cartella con spazi"));

        let listed = list_sync(&path_string(&repo.nested).unwrap()).unwrap();
        let lane = listed
            .iter()
            .find(|entry| entry.branch.as_deref() == Some("omp/lane-lane-01"))
            .unwrap();
        assert!(lane.managed_by_studio);
        assert_eq!(lane.base_commit, repo.commit);
        assert_eq!(lane.target_branch.as_deref(), Some("main"));

        let collision = create_sync(create_args(&repo, "lane-01")).unwrap_err();
        assert_eq!(collision.code, WorktreeErrorCode::PathCollision);

        remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.nested).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: false,
        })
        .unwrap();
        assert!(!Path::new(&created.worktree_path).exists());
    }

    #[test]
    fn rifiuta_traversal_path_non_registrati_e_worktree_sporchi() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "safe-02")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        let dirty_file = worktree.join("non-tracciato.txt");
        fs::write(&dirty_file, "da conservare").unwrap();

        let dirty = remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: false,
        })
        .unwrap_err();
        assert_eq!(dirty.code, WorktreeErrorCode::DirtyWorktree);
        assert!(dirty_file.exists());

        let arbitrary = repo.container.join(".omp-wt-repo-con-spazi-arbitrario");
        fs::create_dir_all(&arbitrary).unwrap();
        let unmanaged = remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: path_string(&arbitrary).unwrap(),
            stop_processes: false,
        })
        .unwrap_err();
        assert_eq!(unmanaged.code, WorktreeErrorCode::UnmanagedWorktree);
        assert!(arbitrary.exists());

        let traversal = format!(
            "{}{}..{}{}",
            created.worktree_path,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            worktree.file_name().unwrap().to_string_lossy()
        );
        let traversal_error = remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: traversal,
            stop_processes: false,
        })
        .unwrap_err();
        assert_eq!(traversal_error.code, WorktreeErrorCode::PathTraversal);
        assert!(worktree.exists());

        fs::remove_file(dirty_file).unwrap();
        remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path,
            stop_processes: false,
        })
        .unwrap();
    }

    /// Processo di prova posseduto dal test: nessun PID reale, la stessa
    /// interfaccia di proprieta' che usano PTY e RPC.
    struct FakeLaneProcess {
        alive: std::sync::atomic::AtomicBool,
    }

    impl FakeLaneProcess {
        fn new() -> std::sync::Arc<Self> {
            std::sync::Arc::new(Self {
                alive: std::sync::atomic::AtomicBool::new(true),
            })
        }
    }

    impl crate::process_tree::LaneProcessControl for FakeLaneProcess {
        fn is_alive(&self) -> bool {
            self.alive.load(Ordering::Relaxed)
        }

        fn stop_and_wait(&self) {
            self.alive.store(false, Ordering::Relaxed);
        }
    }

    fn register_fake(
        owner_id: u64,
        project: &str,
        lane: &str,
        root: &Path,
        control: std::sync::Arc<FakeLaneProcess>,
    ) {
        crate::process_tree::register_lane_process(crate::process_tree::LaneProcessRegistration {
            kind: crate::process_tree::LaneProcessKind::Terminal,
            owner_id,
            project_id: project.to_string(),
            lane_id: lane.to_string(),
            workspace_root: path_string(root).unwrap(),
            pid: Some(4242),
            label: "Terminale".to_string(),
            control,
        });
    }

    #[test]
    fn w11_blocca_la_rimozione_finche_la_corsia_ha_processi_attivi() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "proc-11")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        let lane_process = FakeLaneProcess::new();
        let main_process = FakeLaneProcess::new();
        register_fake(
            7701,
            "proj-w11",
            "wt-proc-11",
            &worktree,
            lane_process.clone(),
        );
        register_fake(7702, "proj-w11", "main", &repo.root, main_process.clone());

        // Senza consenso esplicito la rimozione e' rifiutata e non tocca nulla.
        let blocked = remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: false,
        })
        .unwrap_err();
        assert_eq!(blocked.code, WorktreeErrorCode::ProcessesActive);
        assert!(blocked.detail.unwrap_or_default().contains("PID 4242"));
        assert!(worktree.exists());
        assert!(lane_process.is_alive());

        // "Arresta processi e rimuovi": ferma solo cio' che gira nel worktree.
        remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: true,
        })
        .unwrap();
        assert!(!worktree.exists());
        assert!(!lane_process.is_alive());
        assert!(main_process.is_alive());
        assert_eq!(
            crate::process_tree::lane_processes_for("proj-w11", "main").len(),
            1
        );

        crate::process_tree::unregister_lane_process(
            crate::process_tree::LaneProcessKind::Terminal,
            7702,
        );
    }

    #[test]
    fn distingue_repository_non_git_unborn_e_detached() {
        let not_git = std::env::temp_dir().join(format!(
            "omp-studio-not-git-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&not_git);
        fs::create_dir_all(&not_git).unwrap();
        let not_git_error = inspect_sync(&path_string(&not_git).unwrap()).unwrap_err();
        assert_eq!(not_git_error.code, WorktreeErrorCode::NotGitRepository);
        fs::remove_dir_all(not_git).unwrap();

        let unborn = repository(false);
        let inspection = inspect_sync(&path_string(&unborn.root).unwrap()).unwrap();
        assert_eq!(inspection.head_state, RepositoryHeadState::Unborn);
        let list_error = list_sync(&path_string(&unborn.root).unwrap()).unwrap_err();
        assert_eq!(list_error.code, WorktreeErrorCode::NoCommits);

        let detached = repository(true);
        test_git(&detached.root, &["checkout", "--detach"]);
        let inspection = inspect_sync(&path_string(&detached.root).unwrap()).unwrap();
        assert_eq!(inspection.head_state, RepositoryHeadState::Detached);
        let create_error = create_sync(create_args(&detached, "detached-03")).unwrap_err();
        assert_eq!(create_error.code, WorktreeErrorCode::DetachedHead);
    }

    fn write_file(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    /// Repository misto: progetto .NET Framework legacy con `packages.config`,
    /// frontend Vite/Svelte, cartelle rigenerabili e file locali non versionati.
    fn mixed_stack_repository() -> TestRepository {
        let repo = repository(true);
        write_file(
            &repo.root.join("Legacy/Legacy.vbproj"),
            "<Project ToolsVersion=\"15.0\">\n  <PropertyGroup>\n    <TargetFrameworkVersion>v4.6.2</TargetFrameworkVersion>\n  </PropertyGroup>\n</Project>\n",
        );
        write_file(
            &repo.root.join("Legacy/packages.config"),
            "<packages><package id=\"Newtonsoft.Json\" version=\"13.0.1\" /></packages>\n",
        );
        write_file(&repo.root.join("Legacy/Web.config"), "<configuration />\n");
        write_file(&repo.root.join("Legacy/bin/Legacy.dll"), "binario");
        write_file(&repo.root.join("Legacy/obj/Debug/temp.cache"), "cache");
        write_file(
            &repo
                .root
                .join("packages/Newtonsoft.Json.13.0.1/lib/net45/lib.dll"),
            &"x".repeat(2048),
        );
        write_file(
            &repo.root.join("frontend/package.json"),
            "{\"dependencies\":{\"svelte\":\"^5.0.0\"},\"devDependencies\":{\"vite\":\"^5.0.0\"}}",
        );
        write_file(
            &repo.root.join("frontend/vite.config.ts"),
            "export default {};\n",
        );
        write_file(
            &repo.root.join("frontend/node_modules/left-pad/index.js"),
            "module.exports = 1;",
        );
        write_file(
            &repo.root.join(".gitignore"),
            "bin/\nobj/\npackages/\nnode_modules/\n.env\n",
        );
        write_file(
            &repo.root.join("Parametri.ini"),
            "[db]\nserver=piesqlsrv01\n",
        );
        write_file(
            &repo.root.join("frontend/.env"),
            "VITE_API=http://localhost\n",
        );
        write_file(&repo.root.join("dump.ini"), &"y".repeat(128 * 1024));
        write_file(&repo.root.join("uno/due/tre/secrets.json"), "{}");
        repo
    }

    #[test]
    fn profila_stack_misto_con_evidenza_e_propone_solo_i_file_locali_piccoli() {
        let repo = mixed_stack_repository();
        let scan = scan_sync(&path_string(&repo.root).unwrap()).unwrap();

        let vbproj = scan
            .manifests
            .iter()
            .find(|entry| entry.relative_path == "Legacy/Legacy.vbproj")
            .expect("il progetto legacy deve essere rilevato");
        assert_eq!(vbproj.kind, ManifestKind::VbProject);
        assert_eq!(vbproj.sdk_style, Some(false));
        assert_eq!(vbproj.package_reference, Some(false));
        assert_eq!(vbproj.target_frameworks, vec!["v4.6.2".to_string()]);
        assert_eq!(vbproj.directory, "Legacy");

        let package_json = scan
            .manifests
            .iter()
            .find(|entry| entry.relative_path == "frontend/package.json")
            .expect("il manifesto Node deve essere rilevato");
        assert_eq!(
            package_json.dependencies,
            vec!["svelte".to_string(), "vite".to_string()]
        );
        assert!(scan
            .manifests
            .iter()
            .any(|entry| entry.kind == ManifestKind::PackagesConfig));
        assert!(scan
            .manifests
            .iter()
            .any(|entry| entry.kind == ManifestKind::ViteConfig));
        assert!(scan
            .manifests
            .iter()
            .any(|entry| entry.kind == ManifestKind::WebConfig));

        for expected in [
            "Legacy/bin",
            "Legacy/obj",
            "packages",
            "frontend/node_modules",
        ] {
            assert!(
                scan.generated_directories.iter().any(|dir| dir == expected),
                "cartella generata assente: {} in {:?}",
                expected,
                scan.generated_directories
            );
        }
        // Nessun manifesto viene letto dentro le cartelle rigenerabili.
        assert!(!scan
            .manifests
            .iter()
            .any(|entry| entry.relative_path.contains("node_modules")
                || entry.relative_path.contains("/bin/")));

        let packages = scan
            .packages_directories
            .iter()
            .find(|entry| entry.relative_path == "packages")
            .expect("la cartella packages deve essere stimata");
        assert!(packages.bytes >= 2048);
        assert_eq!(packages.file_count, 1);

        let candidates: Vec<&str> = scan
            .untracked_candidates
            .iter()
            .map(|candidate| candidate.relative_path.as_str())
            .collect();
        assert_eq!(candidates, vec!["Parametri.ini", "frontend/.env"]);
        let parametri = &scan.untracked_candidates[0];
        assert_eq!(parametri.rule, CandidateRule::IniFile);
        assert!(!parametri.ignored);
        assert!(scan.untracked_candidates[1].ignored);
        assert_eq!(scan.native_caches.len(), 1);
        assert_eq!(scan.native_caches[0].kind, NativeCacheKind::Nuget);
    }

    #[test]
    fn copia_nel_worktree_solo_i_percorsi_consentiti() {
        let repo = mixed_stack_repository();
        let created = create_sync(create_args(&repo, "profile-10")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        let outcomes = apply_allowlist_sync(ApplyAllowlistArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            files: vec![
                "Parametri.ini".to_string(),
                "../fuga.txt".to_string(),
                "Legacy/bin/Legacy.dll".to_string(),
                "assente.ini".to_string(),
            ],
        })
        .unwrap();

        assert_eq!(outcomes[0].status, AllowlistCopyStatus::Copied);
        assert_eq!(outcomes[1].status, AllowlistCopyStatus::Rejected);
        assert_eq!(outcomes[2].status, AllowlistCopyStatus::Rejected);
        assert_eq!(outcomes[3].status, AllowlistCopyStatus::SourceMissing);

        let copied = worktree.join("Parametri.ini");
        assert_eq!(
            fs::read_to_string(&copied).unwrap(),
            fs::read_to_string(repo.root.join("Parametri.ini")).unwrap()
        );
        assert!(!worktree.join("Legacy/bin/Legacy.dll").exists());

        let repeated = apply_allowlist_sync(ApplyAllowlistArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            files: vec!["Parametri.ini".to_string()],
        })
        .unwrap();
        assert_eq!(repeated[0].status, AllowlistCopyStatus::AlreadyPresent);

        let estraneo = repo.container.join(".omp-wt-repo-con-spazi-estraneo");
        fs::create_dir_all(&estraneo).unwrap();
        let error = apply_allowlist_sync(ApplyAllowlistArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: path_string(&estraneo).unwrap(),
            files: vec!["Parametri.ini".to_string()],
        })
        .unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::UnmanagedWorktree);
        assert!(!estraneo.join("Parametri.ini").exists());
    }

    #[test]
    fn review_inspect_non_muta_il_target() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "lane-review")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        // 1. Modifica tracciata con commit nella corsia
        fs::write(worktree.join("lane-file.txt"), "riga 1\nriga 2\n").unwrap();
        test_git(&worktree, &["add", "lane-file.txt"]);
        test_git(&worktree, &["commit", "-m", "aggiunto file corsia"]);

        // 2. File untracked nella corsia
        fs::write(
            worktree.join("untracked-lane.txt"),
            "nuova riga untracked\n",
        )
        .unwrap();

        // 3. Modifica dirty nel target principale (uncommitted)
        fs::write(
            repo.root.join("dirty-target.txt"),
            "modifica utente target\n",
        )
        .unwrap();

        // 4. Esegue review inspect
        let inspection = inspect_review_sync(WorktreeReviewInspectArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            target_branch: Some("main".to_string()),
        })
        .unwrap();

        assert_eq!(inspection.target_branch, "main");
        assert!(inspection.is_target_dirty, "Target deve risultare dirty");
        assert!(
            inspection
                .target_dirty_files
                .iter()
                .any(|f| f.ends_with("dirty-target.txt")),
            "dirty-target.txt deve comparire nei file dirty del target"
        );
        assert_eq!(inspection.commits.len(), 1);
        assert_eq!(inspection.commits[0].subject, "aggiunto file corsia");

        // Verifica che files contenga sia il file tracciato committato che il file untracked
        let tracked_diff = inspection
            .files
            .iter()
            .find(|f| f.path.ends_with("lane-file.txt"))
            .expect("lane-file.txt deve essere presente nel diff");
        assert_eq!(tracked_diff.additions, 2);
        assert!(!tracked_diff.is_untracked);

        let untracked_diff = inspection
            .files
            .iter()
            .find(|f| f.path.ends_with("untracked-lane.txt"))
            .expect("untracked-lane.txt deve essere presente nel diff");
        assert_eq!(untracked_diff.additions, 1);
        assert!(untracked_diff.is_untracked);

        // 5. Verifica che il target repository NON sia stato minimamente alterato dalla review
        assert!(repo.root.join("dirty-target.txt").exists());
        assert!(!repo.root.join("lane-file.txt").exists());
        assert!(!repo.root.join("untracked-lane.txt").exists());
    }

    fn sha_of(cwd: &Path) -> String {
        String::from_utf8_lossy(&test_git(cwd, &["rev-parse", "HEAD"]).stdout)
            .trim()
            .to_string()
    }

    fn subjects_of(cwd: &Path) -> Vec<String> {
        String::from_utf8_lossy(&test_git(cwd, &["log", "--format=%s"]).stdout)
            .lines()
            .map(str::to_string)
            .filter(|line| !line.is_empty())
            .collect()
    }

    fn commit_file(cwd: &Path, relative: &str, contents: &str, message: &str) {
        let path = cwd.join(relative);
        fs::write(&path, contents).unwrap();
        test_git(cwd, &["add", "--", relative]);
        test_git(cwd, &["commit", "-m", message]);
    }

    fn land_request(
        repo: &TestRepository,
        worktree: &str,
        lane_id: &str,
        message: &str,
    ) -> lane_integrate::WorktreeLandArgs {
        lane_integrate::WorktreeLandArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: worktree.to_string(),
            lane_id: lane_id.to_string(),
            target_branch: Some("main".to_string()),
            message: message.to_string(),
            exempt_owners: Vec::new(),
        }
    }

    #[test]
    fn squash_crea_un_commit_e_il_ritento_non_ne_crea_un_altro() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "sq13")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        commit_file(&worktree, "nota.txt", "dalla corsia\n", "lavoro corsia");
        let lane = sha_of(&worktree);
        let before = subjects_of(&repo.root);

        let first = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "sq13",
            "Obiettivo della corsia",
        ))
        .unwrap();
        let commit = match first {
            WorktreeLandOutcome::Integrated { commit, .. } => commit,
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        };
        assert_eq!(sha_of(&repo.root), commit);
        let blob = test_git(&repo.root, &["show", "HEAD:nota.txt"]);
        assert_eq!(String::from_utf8_lossy(&blob.stdout), "dalla corsia\n");
        let log = test_git(&repo.root, &["log", "-1", "--format=%B"]);
        let body = String::from_utf8_lossy(&log.stdout);
        assert!(body.contains("Obiettivo della corsia"));
        assert!(body.contains(&format!("OMP-Lane-Head: {lane}")));
        assert_eq!(subjects_of(&repo.root).len(), before.len() + 1);
        assert!(worktree.join("nota.txt").exists());

        let again = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "sq13",
            "Obiettivo della corsia",
        ))
        .unwrap();
        match again {
            WorktreeLandOutcome::AlreadyIntegrated {
                commit: again_commit,
                ..
            } => {
                assert_eq!(again_commit, commit);
            }
            other => panic!("Atteso AlreadyIntegrated, ottenuto {:?}", other),
        }
        assert_eq!(subjects_of(&repo.root).len(), before.len() + 1);

        remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: false,
        })
        .unwrap();
        assert!(!worktree.exists());
        assert!(branch_exists(
            &discover_repository(&path_string(&repo.root).unwrap()).unwrap(),
            "omp/lane-sq13"
        )
        .unwrap());

        let refused =
            lane_integrate::delete_lane_branch_sync(lane_integrate::DeleteLaneBranchArgs {
                project_path: path_string(&repo.root).unwrap(),
                lane_id: "sq13".to_string(),
                confirm: false,
                discard_unintegrated: false,
            })
            .unwrap_err();
        assert_eq!(refused.code, WorktreeErrorCode::ConfirmationRequired);
        assert!(branch_exists(
            &discover_repository(&path_string(&repo.root).unwrap()).unwrap(),
            "omp/lane-sq13"
        )
        .unwrap());

        lane_integrate::delete_lane_branch_sync(lane_integrate::DeleteLaneBranchArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: "sq13".to_string(),
            confirm: true,
            discard_unintegrated: false,
        })
        .unwrap();
        assert!(!branch_exists(
            &discover_repository(&path_string(&repo.root).unwrap()).unwrap(),
            "omp/lane-sq13"
        )
        .unwrap());
        assert_eq!(sha_of(&repo.root), commit);
    }

    #[test]
    fn rifiuta_messaggio_vuoto_e_branch_non_integrato() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "dy13")).unwrap();
        let target = sha_of(&repo.root);

        let empty =
            lane_integrate::land_sync(land_request(&repo, &created.worktree_path, "dy13", "   "))
                .unwrap_err();
        assert_eq!(empty.code, WorktreeErrorCode::MessageInvalid);
        assert_eq!(sha_of(&repo.root), target);

        let unknown =
            lane_integrate::delete_lane_branch_sync(lane_integrate::DeleteLaneBranchArgs {
                project_path: path_string(&repo.root).unwrap(),
                lane_id: "dy13".to_string(),
                confirm: true,
                discard_unintegrated: false,
            })
            .unwrap_err();
        assert_eq!(unknown.code, WorktreeErrorCode::WorktreeInUse);
        assert!(branch_exists(
            &discover_repository(&path_string(&repo.root).unwrap()).unwrap(),
            "omp/lane-dy13"
        )
        .unwrap());
    }

    #[test]
    fn land_con_modifiche_non_committate_e_target_avanzato_integra_e_ritento_idempotente() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "ln01")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        fs::write(
            worktree.join("lane-uncommitted.txt"),
            "dalla corsia uncommitted\n",
        )
        .unwrap();
        commit_file(
            &repo.root,
            "target-file.txt",
            "dal target\n",
            "target commit",
        );
        let target_sha_before = sha_of(&repo.root);
        let before_subjects = subjects_of(&repo.root);

        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "ln01",
            "Integrazione ln01",
        ))
        .unwrap();

        let (commit, previous_target, files) = match outcome {
            WorktreeLandOutcome::Integrated {
                commit,
                previous_target,
                files,
                ..
            } => (commit, previous_target, files),
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        };

        assert_eq!(previous_target, target_sha_before);
        assert_eq!(sha_of(&repo.root), commit);
        assert_eq!(
            fs::read_to_string(repo.root.join("target-file.txt")).unwrap(),
            "dal target\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("lane-uncommitted.txt")).unwrap(),
            "dalla corsia uncommitted\n"
        );
        assert_eq!(subjects_of(&repo.root).len(), before_subjects.len() + 1);
        let log = test_git(&repo.root, &["log", "-1", "--format=%B"]);
        let body = String::from_utf8_lossy(&log.stdout);
        assert!(body.contains("OMP-Lane-Head:"));
        assert!(body.contains("OMP-Lane-Id: ln01"));
        assert!(files.iter().any(|f| f.ends_with("lane-uncommitted.txt")));

        // Ritento -> already_integrated
        let again = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "ln01",
            "Integrazione ln01",
        ))
        .unwrap();
        match again {
            WorktreeLandOutcome::AlreadyIntegrated {
                commit: again_commit,
                ..
            } => {
                assert_eq!(again_commit, commit);
            }
            other => panic!("Atteso AlreadyIntegrated, ottenuto {:?}", other),
        }
        assert_eq!(subjects_of(&repo.root).len(), before_subjects.len() + 1);
    }

    #[test]
    fn land_con_conflitto_ritorna_conflitti_e_dopo_risoluzione_integra() {
        let repo = repository(true);
        commit_file(&repo.root, "shared.txt", "riga base\n", "base shared");
        let created = create_sync(create_args(&repo, "cf02")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        commit_file(
            &repo.root,
            "shared.txt",
            "modifica target\n",
            "target modifica shared",
        );
        let target_sha_before = sha_of(&repo.root);

        commit_file(
            &worktree,
            "shared.txt",
            "modifica corsia\n",
            "lane modifica shared",
        );

        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "cf02",
            "Merge conflitto",
        ))
        .unwrap();

        match outcome {
            WorktreeLandOutcome::Conflicts { files, .. } => {
                assert!(files.iter().any(|f| f.ends_with("shared.txt")));
            }
            other => panic!("Atteso Conflicts, ottenuto {:?}", other),
        }

        assert_eq!(sha_of(&repo.root), target_sha_before);
        assert_eq!(
            fs::read_to_string(repo.root.join("shared.txt")).unwrap(),
            "modifica target\n"
        );
        assert!(!lane_integrate::unmerged_paths(&worktree)
            .unwrap()
            .is_empty());
        assert!(fs::read_to_string(worktree.join("shared.txt"))
            .unwrap()
            .contains("<<<<<<<"));

        // Risoluzione conflitto (modifica file + git add, senza commit)
        fs::write(worktree.join("shared.txt"), "modifica risolta insieme\n").unwrap();
        test_git(&worktree, &["add", "shared.txt"]);

        let resolved = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "cf02",
            "Risolto conflitto",
        ))
        .unwrap();

        match resolved {
            WorktreeLandOutcome::Integrated { commit, .. } => {
                assert_eq!(sha_of(&repo.root), commit);
                assert_eq!(
                    fs::read_to_string(repo.root.join("shared.txt")).unwrap(),
                    "modifica risolta insieme\n"
                );
            }
            other => panic!("Atteso Integrated dopo risoluzione, ottenuto {:?}", other),
        }
    }

    #[test]
    fn land_con_target_sporco_su_file_disgiunto_preserva_modifica_locale() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "cl03")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        commit_file(
            &worktree,
            "lane-feature.txt",
            "feature dalla corsia\n",
            "feature corsia",
        );
        fs::write(
            repo.root.join("target-dirty-local.txt"),
            "modifica locale target non committata\n",
        )
        .unwrap();

        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "cl03",
            "Integra feature",
        ))
        .unwrap();

        match outcome {
            WorktreeLandOutcome::Integrated { commit, .. } => {
                assert_eq!(sha_of(&repo.root), commit);
            }
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        }

        assert!(repo.root.join("target-dirty-local.txt").exists());
        assert_eq!(
            fs::read_to_string(repo.root.join("target-dirty-local.txt")).unwrap(),
            "modifica locale target non committata\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("lane-feature.txt")).unwrap(),
            "feature dalla corsia\n"
        );
    }

    #[test]
    fn land_con_target_sporco_su_stesso_file_va_in_coda_senza_modificare_target() {
        let repo = repository(true);
        commit_file(
            &repo.root,
            "shared-file.txt",
            "iniziale\n",
            "commit iniziale shared",
        );
        // Base = HEAD attuale: con il commit iniziale il file nascerebbe su
        // entrambi i lati (add/add) e l'esito sarebbe un conflitto, non la coda.
        let mut args = create_args(&repo, "ov04");
        args.base_commit = sha_of(&repo.root);
        let created = create_sync(args).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        commit_file(
            &worktree,
            "shared-file.txt",
            "cambiato in corsia\n",
            "corsia update shared",
        );
        let target_sha_before = sha_of(&repo.root);
        fs::write(repo.root.join("shared-file.txt"), "sporco sul target\n").unwrap();

        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "ov04",
            "Tentativo overlap",
        ))
        .unwrap();

        match outcome {
            WorktreeLandOutcome::Queued { reason, files } => {
                assert_eq!(reason, "target_overlap");
                assert!(files.iter().any(|f| f.ends_with("shared-file.txt")));
            }
            other => panic!("Atteso Queued per target_overlap, ottenuto {:?}", other),
        }

        assert_eq!(sha_of(&repo.root), target_sha_before);
        assert_eq!(
            fs::read_to_string(repo.root.join("shared-file.txt")).unwrap(),
            "sporco sul target\n"
        );
    }

    #[test]
    fn undo_land_ripristina_target_preserva_sporco_e_crea_branch_restored() {
        let repo = repository(true);
        let target_init = sha_of(&repo.root);
        let created = create_sync(create_args(&repo, "un05")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);

        commit_file(
            &worktree,
            "da-annullare.txt",
            "lavoro corsia\n",
            "lavoro corsia",
        );

        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "un05",
            "Commit da annullare",
        ))
        .unwrap();

        let (commit, previous_target) = match outcome {
            WorktreeLandOutcome::Integrated {
                commit,
                previous_target,
                ..
            } => (commit, previous_target),
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        };
        assert_eq!(previous_target, target_init);
        assert_eq!(sha_of(&repo.root), commit);

        fs::write(repo.root.join("disjoint-local.txt"), "non toccato\n").unwrap();

        let undo_args = lane_integrate::WorktreeUndoLandArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: "un05".to_string(),
            target_branch: "main".to_string(),
            commit: commit.clone(),
            previous_target: previous_target.clone(),
        };
        let undo_outcome = lane_integrate::undo_land_sync(undo_args).unwrap();

        assert_eq!(undo_outcome.target_branch, "main");
        assert_eq!(undo_outcome.head, previous_target);
        assert_eq!(undo_outcome.restored_branch, "omp/restored-un05");
        assert_eq!(sha_of(&repo.root), previous_target);
        assert!(!repo.root.join("da-annullare.txt").exists());
        assert_eq!(
            fs::read_to_string(repo.root.join("disjoint-local.txt")).unwrap(),
            "non toccato\n"
        );

        let restored_sha = String::from_utf8_lossy(
            &test_git(&repo.root, &["rev-parse", "refs/heads/omp/restored-un05"]).stdout,
        )
        .trim()
        .to_string();
        assert_eq!(restored_sha, commit);

        // Con un commit successivo sul target -> TargetMoved
        commit_file(&repo.root, "nuovo.txt", "nuovo target\n", "nuovo commit");
        let moved_err = lane_integrate::undo_land_sync(lane_integrate::WorktreeUndoLandArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: "un05".to_string(),
            target_branch: "main".to_string(),
            commit: commit.clone(),
            previous_target,
        })
        .unwrap_err();
        assert_eq!(moved_err.code, WorktreeErrorCode::TargetMoved);
    }

    #[test]
    fn land_su_branch_assente_fallisce_con_invalid_target_branch() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "ms13")).unwrap();
        let mut req = land_request(&repo, &created.worktree_path, "ms13", "test");
        req.target_branch = Some("inesistente".to_string());
        let err = lane_integrate::land_sync(req).unwrap_err();
        assert_eq!(err.code, WorktreeErrorCode::InvalidTargetBranch);
    }

    /// Due worktree vivi insieme: file distinti, main pulito, niente junction
    /// su bin/packages, scan che distingue PackageReference da packages.config,
    /// e un worktree cancellato a mano che Git marca prunable senza toccare l'altro.
    #[test]
    fn due_worktree_concorrenti_isolano_i_file_e_distinguono_i_profili_dotnet() {
        let repo = repository(true);
        write_file(
            &repo.root.join("Sdk/Sdk.csproj"),
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include=\"Newtonsoft.Json\" Version=\"13.0.3\" />\n  </ItemGroup>\n</Project>\n",
        );
        write_file(
            &repo.root.join("Legacy/Legacy.vbproj"),
            "<Project ToolsVersion=\"15.0\">\n  <PropertyGroup>\n    <TargetFrameworkVersion>v4.6.2</TargetFrameworkVersion>\n  </PropertyGroup>\n</Project>\n",
        );
        write_file(
            &repo.root.join("Legacy/packages.config"),
            "<packages><package id=\"Newtonsoft.Json\" version=\"13.0.1\" /></packages>\n",
        );
        write_file(
            &repo.root.join(".gitignore"),
            "bin/\nobj/\npackages/\nnode_modules/\n",
        );
        test_git(&repo.root, &["add", "."]);
        test_git(&repo.root, &["commit", "-m", "profili dotnet"]);
        write_file(&repo.root.join("Legacy/bin/Legacy.dll"), "binario-main");
        write_file(
            &repo.root.join("packages/Newtonsoft.Json.13.0.1/lib.dll"),
            "pkg",
        );
        let head = sha_of(&repo.root);
        let mut args_a = create_args(&repo, "lane-a");
        args_a.base_commit = head.clone();
        let mut args_b = create_args(&repo, "lane-b");
        args_b.base_commit = head.clone();

        let created_a = create_sync(args_a).unwrap();
        let created_b = create_sync(args_b).unwrap();
        let path_a = PathBuf::from(&created_a.worktree_path);
        let path_b = PathBuf::from(&created_b.worktree_path);
        assert_ne!(created_a.worktree_path, created_b.worktree_path);
        assert_eq!(
            path_a.file_name().and_then(|name| name.to_str()),
            Some(".omp-wt-repo-con-spazi-lane-a")
        );
        assert_eq!(
            path_b.file_name().and_then(|name| name.to_str()),
            Some(".omp-wt-repo-con-spazi-lane-b")
        );
        // temp_dir() puo' essere il nome 8.3 (MAURIZ~1) mentre il worktree
        // canonico usa il nome lungo: si confronta la stessa directory finale.
        let parent_repo = repo.root.parent().unwrap().canonicalize().unwrap();
        assert!(same_path(
            &path_a.parent().unwrap().canonicalize().unwrap(),
            &parent_repo
        ));
        assert!(same_path(
            &path_b.parent().unwrap().canonicalize().unwrap(),
            &parent_repo
        ));

        fs::write(path_a.join("solo-a.txt"), "corsia A\n").unwrap();
        fs::write(path_b.join("solo-b.txt"), "corsia B\n").unwrap();
        assert!(!repo.root.join("solo-a.txt").exists());
        assert!(!repo.root.join("solo-b.txt").exists());
        assert!(!path_a.join("solo-b.txt").exists());
        assert!(!path_b.join("solo-a.txt").exists());
        assert!(repo.root.join("Legacy/bin/Legacy.dll").exists());
        assert!(!path_a.join("Legacy/bin").exists());
        assert!(!path_b.join("packages").exists());
        assert!(
            !fs::symlink_metadata(repo.root.join("Legacy/bin/Legacy.dll"))
                .unwrap()
                .file_type()
                .is_symlink()
        );

        let scan = scan_sync(&path_string(&repo.root).unwrap()).unwrap();
        let sdk = scan
            .manifests
            .iter()
            .find(|entry| entry.relative_path == "Sdk/Sdk.csproj")
            .expect("il progetto SDK deve essere rilevato");
        assert_eq!(sdk.sdk_style, Some(true));
        assert_eq!(sdk.package_reference, Some(true));
        assert!(sdk
            .target_frameworks
            .iter()
            .any(|framework| framework == "net8.0"));
        let legacy = scan
            .manifests
            .iter()
            .find(|entry| entry.relative_path == "Legacy/Legacy.vbproj")
            .expect("il progetto legacy deve essere rilevato");
        assert_eq!(legacy.sdk_style, Some(false));
        assert_eq!(legacy.package_reference, Some(false));
        assert!(scan
            .manifests
            .iter()
            .any(|entry| entry.kind == ManifestKind::PackagesConfig));

        let listed = list_sync(&path_string(&repo.nested).unwrap()).unwrap();
        assert!(listed.iter().any(|entry| {
            entry.lane_id.as_deref() == Some("lane-a")
                && entry.managed_by_studio
                && entry.prunable_reason.is_none()
        }));
        assert!(listed.iter().any(|entry| {
            entry.lane_id.as_deref() == Some("lane-b") && entry.managed_by_studio
        }));

        fs::remove_dir_all(&path_b).unwrap();
        let after = list_sync(&path_string(&repo.root).unwrap()).unwrap();
        let gone = after
            .iter()
            .find(|entry| entry.lane_id.as_deref() == Some("lane-b"))
            .expect("il worktree cancellato resta elencato come prunable");
        assert!(
            gone.prunable_reason
                .as_deref()
                .is_some_and(|reason| !reason.is_empty()),
            "atteso prunable, ottenuto {:?}",
            gone.prunable_reason
        );
        let alive = after
            .iter()
            .find(|entry| entry.lane_id.as_deref() == Some("lane-a"))
            .unwrap();
        assert!(alive.prunable_reason.is_none());
        assert!(path_a.join("solo-a.txt").exists());
        assert_eq!(sha_of(&repo.root), head);
        let status =
            String::from_utf8_lossy(&test_git(&repo.root, &["status", "--porcelain"]).stdout)
                .to_string();
        assert!(!status.contains("solo-a"));
        assert!(!status.contains("solo-b"));
        assert!(!status.contains("Sdk.csproj"));

        // Il frontend passa il workspace operativo (sottocartella del worktree):
        // la rimozione deve risalire alla radice fratella, non rifiutarla.
        fs::remove_file(path_a.join("solo-a.txt")).unwrap();
        remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created_a.workspace_path.clone(),
            stop_processes: false,
        })
        .unwrap();
        assert!(!path_a.exists());
    }

    fn delete_branch_request(
        repo: &TestRepository,
        lane_id: &str,
        confirm: bool,
        discard_unintegrated: bool,
    ) -> lane_integrate::DeleteLaneBranchArgs {
        lane_integrate::DeleteLaneBranchArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: lane_id.to_string(),
            confirm,
            discard_unintegrated,
        }
    }

    fn lane_query(repo: &TestRepository, lane_id: &str) -> lane_integrate::LaneBranchQueryArgs {
        lane_integrate::LaneBranchQueryArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: lane_id.to_string(),
        }
    }

    fn lane_branch_exists(repo: &TestRepository, branch: &str) -> bool {
        branch_exists(
            &discover_repository(&path_string(&repo.root).unwrap()).unwrap(),
            branch,
        )
        .unwrap()
    }

    fn remove_request(repo: &TestRepository, path: &str) -> RemoveWorktreeArgs {
        RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: path.to_string(),
            stop_processes: false,
        }
    }

    #[test]
    fn versione_git_letta_da_formati_diversi() {
        assert_eq!(parse_git_version("git version 2.43.0\n"), Some((2, 43, 0)));
        assert_eq!(
            parse_git_version("git version 2.45.1.windows.1"),
            Some((2, 45, 1))
        );
        assert_eq!(
            parse_git_version("git version 2.39.3 (Apple Git-146)"),
            Some((2, 39, 3))
        );
        assert_eq!(parse_git_version("git version 2.38"), Some((2, 38, 0)));
        assert_eq!(parse_git_version("non e' git"), None);
        assert!(git_version().is_some());
    }

    /// Corsia zombie: cartella cancellata a mano. La rimozione pota i metadati
    /// invece di fallire con "Il worktree indicato non esiste", e il
    /// ritentativo (cartella e metadati gia' spariti) riesce di nuovo.
    #[test]
    fn rimozione_idempotente_con_cartella_gia_sparita() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "zb01")).unwrap();
        fs::remove_dir_all(&created.worktree_path).unwrap();

        // Il frontend passa il workspace (sottocartella), anch'esso sparito.
        remove_sync(remove_request(&repo, &created.workspace_path)).unwrap();
        let listed = list_sync(&path_string(&repo.root).unwrap()).unwrap();
        assert!(!listed
            .iter()
            .any(|entry| entry.lane_id.as_deref() == Some("zb01")));

        remove_sync(remove_request(&repo, &created.workspace_path)).unwrap();
        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();

        // Un percorso inesistente fuori dalle corsie resta un errore.
        let outside = repo.container.join("non-una-corsia");
        let error =
            remove_sync(remove_request(&repo, &path_string(&outside).unwrap())).unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::InvalidPath);
    }

    /// Caso inverso: `git worktree remove` fallito a meta' toglie comunque i
    /// metadati di Git e lascia la cartella. Se la registrazione Studio la
    /// riconosce, la rimozione la cancella invece di dire UnmanagedWorktree.
    #[test]
    fn rimuove_la_cartella_residua_non_piu_elencata_da_git() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "zb02")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        // Metadati del worktree nella gitdir comune: e' cio' che Git toglie
        // anche quando la cancellazione della cartella fallisce.
        let gitfile = fs::read_to_string(worktree.join(".git")).unwrap();
        let admin = PathBuf::from(gitfile.trim().strip_prefix("gitdir: ").unwrap());
        fs::remove_dir_all(&admin).unwrap();
        fs::write(worktree.join("residuo.txt"), "file rimasto bloccato\n").unwrap();
        assert!(!list_sync(&path_string(&repo.root).unwrap())
            .unwrap()
            .iter()
            .any(|entry| entry.lane_id.as_deref() == Some("zb02")));

        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();
        assert!(!worktree.exists());
        // Ritentativo dopo il successo.
        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();
    }

    #[test]
    fn una_cartella_ancora_collegata_a_git_non_e_un_residuo() {
        let base = std::env::temp_dir().join(format!(
            "omp-wt-linked-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let admin = base.join("admin");
        let root = base.join("corsia");
        fs::create_dir_all(&admin).unwrap();
        fs::create_dir_all(&root).unwrap();
        // Nessun .git: residuo.
        assert!(!still_linked_to_git(&root));
        // .git che punta a una gitdir esistente: worktree vivo.
        fs::write(root.join(".git"), format!("gitdir: {}\n", admin.display())).unwrap();
        assert!(still_linked_to_git(&root));
        // Gitdir sparita: residuo.
        fs::remove_dir_all(&admin).unwrap();
        assert!(!still_linked_to_git(&root));
        // .git cartella: repository vero.
        fs::remove_file(root.join(".git")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        assert!(still_linked_to_git(&root));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn elimina_il_branch_di_una_corsia_senza_commit_propri_senza_flag() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "nb01")).unwrap();
        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();

        let summary =
            lane_integrate::lane_unintegrated_summary_sync(lane_query(&repo, "nb01")).unwrap();
        assert_eq!(
            summary,
            lane_integrate::LaneUnintegratedSummary {
                branch_exists: true,
                integrated: false,
                commits: 0,
                files: 0,
            }
        );

        lane_integrate::delete_lane_branch_sync(delete_branch_request(&repo, "nb01", true, false))
            .unwrap();
        assert!(!lane_branch_exists(&repo, "omp/lane-nb01"));
        // Ritentativo: branch gia' sparito.
        lane_integrate::delete_lane_branch_sync(delete_branch_request(&repo, "nb01", true, false))
            .unwrap();
        let state = lane_integrate::lane_integration_state_sync(lane_query(&repo, "nb01")).unwrap();
        assert!(!state.branch_exists);
        assert!(!state.integrated);
    }

    #[test]
    fn branch_con_commit_non_integrati_richiede_il_consenso_a_scartarli() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "nb02")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        commit_file(&worktree, "lavoro.txt", "da non perdere\n", "lavoro corsia");
        commit_file(&worktree, "altro.txt", "ancora\n", "altro lavoro");
        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();

        let summary =
            lane_integrate::lane_unintegrated_summary_sync(lane_query(&repo, "nb02")).unwrap();
        assert!(summary.branch_exists);
        assert!(!summary.integrated);
        assert_eq!(summary.commits, 2);
        assert_eq!(summary.files, 2);

        let refused = lane_integrate::delete_lane_branch_sync(delete_branch_request(
            &repo, "nb02", true, false,
        ))
        .unwrap_err();
        assert_eq!(refused.code, WorktreeErrorCode::ConfirmationRequired);
        assert!(lane_branch_exists(&repo, "omp/lane-nb02"));

        // Il flag da solo non basta: serve anche la conferma.
        let unconfirmed = lane_integrate::delete_lane_branch_sync(delete_branch_request(
            &repo, "nb02", false, true,
        ))
        .unwrap_err();
        assert_eq!(unconfirmed.code, WorktreeErrorCode::ConfirmationRequired);
        assert!(lane_branch_exists(&repo, "omp/lane-nb02"));

        lane_integrate::delete_lane_branch_sync(delete_branch_request(&repo, "nb02", true, true))
            .unwrap();
        assert!(!lane_branch_exists(&repo, "omp/lane-nb02"));
    }

    #[test]
    fn branch_gia_contenuto_nel_target_si_elimina_senza_flag() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "nb03")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        commit_file(&worktree, "unito.txt", "unito a mano\n", "lavoro unito");
        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();
        test_git(&repo.root, &["merge", "--ff-only", "omp/lane-nb03"]);

        lane_integrate::delete_lane_branch_sync(delete_branch_request(&repo, "nb03", true, false))
            .unwrap();
        assert!(!lane_branch_exists(&repo, "omp/lane-nb03"));
    }

    #[test]
    fn stato_di_integrazione_e_riepilogo_dopo_lo_squash() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "st01")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        commit_file(&worktree, "nota.txt", "integrata\n", "lavoro corsia");
        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "st01",
            "Integrazione st01",
        ))
        .unwrap();
        assert!(matches!(outcome, WorktreeLandOutcome::Integrated { .. }));

        let state = lane_integrate::lane_integration_state_sync(lane_query(&repo, "st01")).unwrap();
        assert!(state.branch_exists);
        assert!(state.integrated);
        let summary =
            lane_integrate::lane_unintegrated_summary_sync(lane_query(&repo, "st01")).unwrap();
        assert!(summary.integrated);
        assert_eq!((summary.commits, summary.files), (0, 0));

        // Lavoro nuovo dopo lo squash: conta solo cio' che segue la ricevuta.
        commit_file(&worktree, "dopo.txt", "dopo\n", "lavoro successivo");
        let summary =
            lane_integrate::lane_unintegrated_summary_sync(lane_query(&repo, "st01")).unwrap();
        assert!(!summary.integrated);
        assert_eq!((summary.commits, summary.files), (1, 1));
        let state = lane_integrate::lane_integration_state_sync(lane_query(&repo, "st01")).unwrap();
        assert!(!state.integrated);
    }

    /// Parametri.ini non ignorato, copiato via allowlist: non entra nel commit
    /// della corsia ne' nello squash, e da solo non rende la corsia "sporca".
    #[test]
    fn file_allowlist_fuori_dal_commit_e_non_blocca_la_rimozione() {
        let repo = mixed_stack_repository();
        let created = create_sync(create_args(&repo, "al01")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        let outcomes = apply_allowlist_sync(ApplyAllowlistArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            files: vec!["Parametri.ini".to_string()],
        })
        .unwrap();
        assert_eq!(outcomes[0].status, AllowlistCopyStatus::Copied);
        let context = discover_repository(&path_string(&repo.root).unwrap()).unwrap();
        assert_eq!(
            allowlist_paths(&context, "omp/lane-al01").unwrap(),
            vec!["Parametri.ini".to_string()]
        );

        fs::write(worktree.join("lavoro.txt"), "dalla corsia\n").unwrap();
        let outcome = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "al01",
            "Integrazione con file locali",
        ))
        .unwrap();
        let (commit, files) = match outcome {
            WorktreeLandOutcome::Integrated { commit, files, .. } => (commit, files),
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        };
        assert!(files.iter().any(|file| file == "lavoro.txt"));
        assert!(!files.iter().any(|file| file == "Parametri.ini"));
        let squash_files = String::from_utf8_lossy(
            &test_git(&repo.root, &["show", "--name-only", "--format=", &commit]).stdout,
        )
        .to_string();
        assert!(!squash_files.contains("Parametri.ini"));
        let lane_tree = String::from_utf8_lossy(
            &test_git(&worktree, &["ls-tree", "-r", "--name-only", "HEAD"]).stdout,
        )
        .to_string();
        assert!(!lane_tree.contains("Parametri.ini"));
        assert!(worktree.join("Parametri.ini").exists());
        // L'originale nel checkout principale non e' stato toccato.
        assert_eq!(
            fs::read_to_string(repo.root.join("Parametri.ini")).unwrap(),
            "[db]\nserver=piesqlsrv01\n"
        );

        // Ritento: la copia locale non conta come lavoro nuovo.
        let again = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "al01",
            "Integrazione con file locali",
        ))
        .unwrap();
        assert!(matches!(
            again,
            WorktreeLandOutcome::AlreadyIntegrated { .. }
        ));

        remove_sync(remove_request(&repo, &created.worktree_path)).unwrap();
        assert!(!worktree.exists());
    }

    /// Un `secret.json` ignorato in locale nel checkout principale e
    /// versionato dalla corsia: `reset --hard` lo sovrascriverebbe in silenzio.
    #[test]
    fn integrazione_rifiutata_se_sovrascriverebbe_file_ignorati_del_target() {
        let repo = repository(true);
        let exclude = repo.root.join(".git").join("info").join("exclude");
        fs::create_dir_all(exclude.parent().unwrap()).unwrap();
        fs::write(&exclude, "secret.json\n").unwrap();
        fs::write(repo.root.join("secret.json"), "{\"locale\":true}\n").unwrap();
        let created = create_sync(create_args(&repo, "ig01")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        fs::write(worktree.join("secret.json"), "{\"corsia\":true}\n").unwrap();
        test_git(&worktree, &["add", "-f", "secret.json"]);
        test_git(&worktree, &["commit", "-m", "versiona secret.json"]);
        let target_before = sha_of(&repo.root);

        let error = lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "ig01",
            "Integrazione con file ignorato",
        ))
        .unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::TargetDirty);
        assert!(error.message.contains("secret.json"), "{}", error.message);
        assert_eq!(sha_of(&repo.root), target_before);
        assert_eq!(
            fs::read_to_string(repo.root.join("secret.json")).unwrap(),
            "{\"locale\":true}\n"
        );
    }

    /// Ripristino del checkout dopo un aggiornamento interrotto a meta': i
    /// percorsi dell'aggiornamento tornano al commit voluto, i file sporchi
    /// disgiunti dell'utente restano.
    #[test]
    fn ripristino_del_checkout_interrotto_a_meta() {
        let repo = repository(true);
        commit_file(&repo.root, "f1.txt", "v1\n", "f1 v1");
        fs::create_dir_all(repo.root.join("d")).unwrap();
        commit_file(&repo.root, "d/f2.txt", "resta\n", "f2");
        let old = sha_of(&repo.root);
        commit_file(&repo.root, "f1.txt", "v2\n", "f1 v2");
        commit_file(&repo.root, "nuovo.txt", "nuovo\n", "nuovo");
        commit_file(&repo.root, "conf.ini", "della corsia\n", "conf");
        test_git(&repo.root, &["rm", "-q", "d/f2.txt"]);
        test_git(&repo.root, &["commit", "-m", "via f2"]);
        let new = sha_of(&repo.root);
        test_git(&repo.root, &["reset", "--hard", "-q", &old]);

        // Stato "a meta'": ref e indice su old, alcuni file gia' scritti da new.
        fs::write(repo.root.join("f1.txt"), "v2\n").unwrap();
        fs::write(repo.root.join("nuovo.txt"), "nuovo\n").unwrap();
        fs::remove_file(repo.root.join("d/f2.txt")).unwrap();
        fs::write(repo.root.join("locale.txt"), "lavoro utente\n").unwrap();
        // File locale dell'utente che l'aggiornamento non e' riuscito a
        // sovrascrivere: era sporco prima, il ripristino non deve cancellarlo.
        fs::write(repo.root.join("conf.ini"), "dell'utente\n").unwrap();

        let dirty_before = vec!["locale.txt".to_string(), "conf.ini".to_string()];
        lane_integrate::restore_checkout_for_tests(&repo.root, &dirty_before, &new, &old).unwrap();
        assert_eq!(
            fs::read_to_string(repo.root.join("conf.ini")).unwrap(),
            "dell'utente\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("f1.txt")).unwrap(),
            "v1\n"
        );
        assert!(!repo.root.join("nuovo.txt").exists());
        assert_eq!(
            fs::read_to_string(repo.root.join("d/f2.txt")).unwrap(),
            "resta\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("locale.txt")).unwrap(),
            "lavoro utente\n"
        );
        let status =
            String::from_utf8_lossy(&test_git(&repo.root, &["status", "--porcelain"]).stdout)
                .to_string();
        let mut lines: Vec<&str> = status.lines().map(str::trim).collect();
        lines.sort_unstable();
        assert_eq!(lines, vec!["?? conf.ini", "?? locale.txt"]);

        // Checkout pulito prima: si torna indietro con reset --hard.
        fs::remove_file(repo.root.join("locale.txt")).unwrap();
        fs::remove_file(repo.root.join("conf.ini")).unwrap();
        fs::write(repo.root.join("f1.txt"), "v2\n").unwrap();
        lane_integrate::restore_checkout_for_tests(&repo.root, &[], &new, &old).unwrap();
        assert_eq!(
            fs::read_to_string(repo.root.join("f1.txt")).unwrap(),
            "v1\n"
        );
        assert!(test_git(&repo.root, &["status", "--porcelain"])
            .stdout
            .is_empty());
    }

    /// L'annullamento sposta il ref solo al genitore diretto dello squash.
    #[test]
    fn undo_rifiuta_un_target_precedente_che_non_e_il_genitore() {
        let repo = repository(true);
        let first = sha_of(&repo.root);
        commit_file(&repo.root, "base.txt", "base\n", "secondo commit");
        let created = create_sync(create_args(&repo, "un06")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        commit_file(&worktree, "lavoro.txt", "corsia\n", "lavoro");
        let commit = match lane_integrate::land_sync(land_request(
            &repo,
            &created.worktree_path,
            "un06",
            "Integrazione un06",
        ))
        .unwrap()
        {
            WorktreeLandOutcome::Integrated { commit, .. } => commit,
            other => panic!("Atteso Integrated, ottenuto {:?}", other),
        };

        let error = lane_integrate::undo_land_sync(lane_integrate::WorktreeUndoLandArgs {
            project_path: path_string(&repo.root).unwrap(),
            lane_id: "un06".to_string(),
            target_branch: "main".to_string(),
            commit: commit.clone(),
            previous_target: first,
        })
        .unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::TargetMoved);
        assert_eq!(sha_of(&repo.root), commit);
        assert!(repo.root.join("base.txt").exists());
    }

    /// Con l'arresto richiesto, un worktree sporco viene rifiutato prima di
    /// fermare i processi: il lavoro in corso non si interrompe per nulla.
    #[test]
    fn worktree_sporco_rifiutato_prima_di_fermare_i_processi() {
        let repo = repository(true);
        let created = create_sync(create_args(&repo, "pr12")).unwrap();
        let worktree = PathBuf::from(&created.worktree_path);
        fs::write(worktree.join("in-corso.txt"), "non salvato\n").unwrap();
        let process = FakeLaneProcess::new();
        register_fake(7712, "proj-pr12", "wt-pr12", &worktree, process.clone());

        let error = remove_sync(RemoveWorktreeArgs {
            project_path: path_string(&repo.root).unwrap(),
            worktree_path: created.worktree_path.clone(),
            stop_processes: true,
        })
        .unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::DirtyWorktree);
        assert!(process.is_alive());
        assert!(worktree.exists());

        crate::process_tree::unregister_lane_process(
            crate::process_tree::LaneProcessKind::Terminal,
            7712,
        );
    }
}
