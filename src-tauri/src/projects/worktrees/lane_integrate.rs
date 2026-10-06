//! Pipeline deterministica e sicura per l'integrazione e il ripristino delle corsie (Gate R27 / PLAN W13).
//!
//! L'integrazione di una corsia isolata (`omp/lane-*`) nel branch principale (o target designato)
//! deve garantire l'assenza di perdita dati sia sul target che sulla corsia, anche in presenza
//! di concorrenza tra agenti o modifiche locali pendenti nel checkout principale.
//! Per questo motivo la pipeline adotta le seguenti garanzie architetturali:
//!
//! 1. **Commit automatico della corsia**: le modifiche pendenti o i merge risolti nella corsia
//!    vengono salvati prima del calcolo dell'integrazione, cosi' che lo stato finale della corsia
//!    sia sempre tracciato e verificabile.
//! 2. **Merge in memoria senza toccare il checkout**: la fusione viene calcolata tramite
//!    `git merge-tree --write-tree`, garantendo che nessun albero sporco o conflitto parziale
//!    alteri l'albero di lavoro dell'utente se l'operazione non puo' essere completata.
//! 3. **Risoluzione conflitti delegata alla corsia**: in caso di conflitto, il target viene
//!    fuso nella corsia isolata cosi' che l'agente o l'utente possano risolvere il conflitto
//!    nel contesto della corsia senza interferire con il lavoro principale.
//! 4. **Preservazione delle modifiche locali del target**: se il checkout principale contiene
//!    file sporchi non sovrapposti a quelli toccati dall'integrazione, l'aggiornamento viene
//!    applicato tramite `git read-tree -m -u` preservando il lavoro locale intatto; se c'e'
//!    sovrapposizione, l'integrazione viene accodata in modo sicuro senza muovere i ref.
//! 5. **Annullabilita' transazionale**: ogni atterraggio puo' essere annullato (`undo_land`)
//!    riportando il target al commit precedente, salvaguardando eventuali modifiche locali
//!    e preservando il commit della corsia in un branch `omp/restored-*`.

use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use super::CREATE_NO_WINDOW;
use super::{
    allowlist_paths, blocking_changes, describe_processes, discover_repository, git_args,
    output_detail, path_string, registered_values, require_git, resolve_managed_worktree, run_git,
    same_path, validate_lane_id, validate_target_branch, worktree_mutation_lock, WorktreeError,
    WorktreeErrorCode, LANE_BRANCH_PREFIX,
};

const RECEIPT_COMMIT: &str = "ompStudioIntegratedCommit";
const RECEIPT_SOURCE: &str = "ompStudioIntegratedSource";
const RECEIPT_STRATEGY: &str = "ompStudioIntegratedStrategy";
const MAX_MESSAGE_BYTES: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntegrateStrategy {
    Squash,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorktreeLandOutcome {
    #[serde(rename_all = "camelCase")]
    Integrated {
        commit: String,
        previous_target: String,
        target_branch: String,
        lane_head: String,
        files: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    AlreadyIntegrated {
        commit: String,
        target_branch: String,
    },
    #[serde(rename_all = "camelCase")]
    Conflicts {
        files: Vec<String>,
        worktree_path: String,
        target_branch: String,
    },
    #[serde(rename_all = "camelCase")]
    Queued { reason: String, files: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Nothing { target_branch: String },
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeLandArgs {
    pub project_path: String,
    pub worktree_path: String,
    pub lane_id: String,
    #[serde(default)]
    pub target_branch: Option<String>,
    pub message: String,
    /// Sessione che ha chiesto l'integrazione: e' ferma nella tool call, quindi
    /// non scrive nel worktree. Id di PTY e RPC collidono: conta anche il tipo.
    #[serde(default)]
    pub exempt_owners: Vec<ExemptOwner>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExemptOwner {
    pub kind: crate::process_tree::LaneProcessKind,
    pub owner_id: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeUndoLandArgs {
    pub project_path: String,
    pub lane_id: String,
    pub target_branch: String,
    pub commit: String,
    pub previous_target: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeUndoLandOutcome {
    pub target_branch: String,
    pub head: String,
    pub restored_branch: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteLaneBranchArgs {
    pub project_path: String,
    pub lane_id: String,
    pub confirm: bool,
    /// Consenso esplicito a scartare commit della corsia mai integrati. Senza,
    /// un branch con lavoro proprio non integrato non viene mai forzato.
    #[serde(default)]
    pub discard_unintegrated: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaneBranchQueryArgs {
    pub project_path: String,
    pub lane_id: String,
}

/// Lavoro del branch di corsia che andrebbe perso eliminandolo.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneUnintegratedSummary {
    pub branch_exists: bool,
    pub integrated: bool,
    /// Commit del branch non raggiungibili dal target (o dal commit base se il
    /// target non esiste piu'). Zero quando la corsia e' integrata.
    pub commits: u32,
    /// File che quei commit cambiano rispetto al punto di diramazione.
    pub files: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneIntegrationState {
    pub branch_exists: bool,
    pub integrated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IntegrationReceipt {
    commit: String,
    source: String,
    strategy: IntegrateStrategy,
}

/// Prima versione di Git con `merge-tree --write-tree`, su cui si regge il
/// merge in memoria dell'integrazione.
const MIN_MERGE_TREE_VERSION: (u32, u32, u32) = (2, 38, 0);

fn ensure_git_supports_merge_tree(version: Option<(u32, u32, u32)>) -> Result<(), WorktreeError> {
    match version {
        Some((major, minor, patch)) if (major, minor, patch) < MIN_MERGE_TREE_VERSION => {
            Err(WorktreeError::new(
                WorktreeErrorCode::GitTooOld,
                format!(
                    "Integrazione corsie: serve Git 2.38 o successivo (trovato {major}.{minor})"
                ),
            ))
        }
        // Versione illeggibile: decide `merge-tree` stesso, con il suo errore.
        _ => Ok(()),
    }
}

fn git_text(cwd: &Path, args: &[&str]) -> Result<String, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(args),
        WorktreeErrorCode::GitCommandFailed,
        "Git ha rifiutato un controllo richiesto dall'integrazione",
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn porcelain_files(cwd: &Path) -> Result<Vec<String>, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(&["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile verificare se il working tree e' pulito",
    )?;
    Ok(super::parse_porcelain_z_dirty_files(&output.stdout))
}

pub(crate) fn unmerged_paths(cwd: &Path) -> Result<Vec<String>, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(&["ls-files", "-u", "-z"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile verificare i conflitti Git",
    )?;
    let mut files = Vec::new();
    for raw in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|raw| !raw.is_empty())
    {
        let Ok(text) = std::str::from_utf8(raw) else {
            continue;
        };
        let Some((_, path)) = text.split_once('\t') else {
            continue;
        };
        let normalized = path.replace('\\', "/");
        if !files.contains(&normalized) {
            files.push(normalized);
        }
    }
    Ok(files)
}

pub(crate) fn attached_branch(cwd: &Path) -> Result<Option<String>, WorktreeError> {
    let output = run_git(cwd, &git_args(&["symbolic-ref", "--quiet", "HEAD"]))?;
    if output.status.success() {
        let full = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(full
            .strip_prefix("refs/heads/")
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string()));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(WorktreeError::with_detail(
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile determinare il branch checked out",
        output_detail(&output),
    ))
}

fn merge_in_progress(cwd: &Path) -> Result<bool, WorktreeError> {
    let output = run_git(
        cwd,
        &git_args(&["rev-parse", "-q", "--verify", "MERGE_HEAD"]),
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile verificare se un merge e' in corso",
            output_detail(&output),
        )),
    }
}

fn is_ancestor(cwd: &Path, ancestor: &str, descendant: &str) -> Result<bool, WorktreeError> {
    let output = run_git(
        cwd,
        &git_args(&["merge-base", "--is-ancestor", ancestor, descendant]),
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile confrontare la storia dei commit",
            output_detail(&output),
        )),
    }
}

fn resolve_commit(cwd: &Path, revision: &str) -> Result<String, WorktreeError> {
    let spec = format!("{revision}^{{commit}}");
    Ok(git_text(cwd, &["rev-parse", "--verify", &spec])?.to_ascii_lowercase())
}

fn resolve_tree(cwd: &Path, revision: &str) -> Result<String, WorktreeError> {
    let spec = format!("{revision}^{{tree}}");
    Ok(git_text(cwd, &["rev-parse", "--verify", &spec])?.to_ascii_lowercase())
}

fn require_explicit_sha(
    value: &str,
    code: WorktreeErrorCode,
    message: &str,
) -> Result<String, WorktreeError> {
    let value = value.trim();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorktreeError::new(code, message));
    }
    Ok(value.to_ascii_lowercase())
}

fn diff_quiet(cwd: &Path, extra: &[&str]) -> Result<bool, WorktreeError> {
    let mut args = vec!["diff", "--quiet"];
    args.extend_from_slice(extra);
    let output = run_git(cwd, &git_args(&args))?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Impossibile confrontare il working tree con il commit atteso",
            output_detail(&output),
        )),
    }
}

fn untracked_empty(cwd: &Path) -> Result<bool, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(&["ls-files", "--others", "--exclude-standard", "-z"]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile elencare i file non tracciati",
    )?;
    Ok(output.stdout.iter().all(|byte| *byte == 0))
}

fn worktree_matches_commit(cwd: &Path, sha: &str) -> Result<bool, WorktreeError> {
    Ok(diff_quiet(cwd, &[sha])? && diff_quiet(cwd, &["--cached", sha])? && untracked_empty(cwd)?)
}

/// Prima cartella `omp-studio-no-hooks[-N]` utilizzabile sotto `base`: assente
/// (Git allora non trova alcun hook) oppure vuota. Non viene mai creata.
fn unused_hooks_dir(base: &Path) -> Option<PathBuf> {
    (0..16).find_map(|attempt| {
        let name = if attempt == 0 {
            "omp-studio-no-hooks".to_string()
        } else {
            format!("omp-studio-no-hooks-{attempt}")
        };
        let candidate = base.join(name);
        match std::fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(candidate),
            Ok(metadata)
                if metadata.is_dir()
                    && !metadata.file_type().is_symlink()
                    && std::fs::read_dir(&candidate)
                        .is_ok_and(|mut entries| entries.next().is_none()) =>
            {
                Some(candidate)
            }
            _ => None,
        }
    })
}

/// `core.hooksPath` dei passaggi interni: una cartella senza hook.
///
/// Prima stava in `temp_dir()`, che su Linux e macOS e' condivisa fra utenti:
/// chiunque poteva creare `/tmp/omp-studio-empty-hooks` con hook propri, poi
/// eseguiti con i permessi di chi integra. Ora la base e' privata: la cartella
/// dati locale dell'app dell'utente o, se non disponibile, la gitdir comune del
/// repository, dove scrive solo chi potrebbe gia' scrivere `.git/hooks`. La
/// cartella non viene creata: un percorso assente basta a Git per non trovare
/// hook, e se qualcosa vi esiste gia' con dei file si sceglie un altro nome.
fn no_hooks_path(cwd: &Path) -> Result<String, WorktreeError> {
    let app_dir = crate::lab::paths::lab_root().and_then(|lab| lab.parent().map(Path::to_path_buf));
    if let Some(candidate) = app_dir.as_deref().and_then(unused_hooks_dir) {
        return path_string(&candidate);
    }
    let common = git_text(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if let Some(candidate) = unused_hooks_dir(Path::new(&common)) {
        return path_string(&candidate);
    }
    Err(WorktreeError::new(
        WorktreeErrorCode::Internal,
        "Impossibile scegliere una cartella hook vuota per l'integrazione",
    ))
}

/// Git senza hook dell'utente, firma o editor: sono passaggi interni della
/// pipeline e l'unico commit che resta sul target e' lo squash di `commit-tree`.
fn git_without_hooks(cwd: &Path, args: &[&str]) -> Result<std::process::Output, WorktreeError> {
    let hooks = no_hooks_path(cwd)?;
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .env("GIT_MERGE_AUTOEDIT", "no")
        .arg("-c")
        .arg(format!("core.hooksPath={hooks}"))
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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

fn git_without_hooks_ok(cwd: &Path, args: &[&str], failure: &str) -> Result<(), WorktreeError> {
    let output = git_without_hooks(cwd, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            failure,
            output_detail(&output),
        ))
    }
}

fn reset_hard(cwd: &Path, sha: &str) -> Result<(), WorktreeError> {
    git_without_hooks_ok(
        cwd,
        &["reset", "--hard", "--quiet", sha],
        "Il checkout non si e' allineato al commit",
    )
}

fn update_ref(cwd: &Path, branch: &str, new_sha: &str, old_sha: &str) -> Result<(), WorktreeError> {
    let reference = format!("refs/heads/{branch}");
    let output = run_git(
        cwd,
        &git_args(&["update-ref", &reference, new_sha, old_sha]),
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::TargetMoved,
            "Il branch target e' cambiato durante l'operazione e non e' stato modificato",
            output_detail(&output),
        ))
    }
}

fn abort_merge(cwd: &Path) -> Result<(), WorktreeError> {
    let output = run_git(cwd, &git_args(&["merge", "--abort"]))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Il merge nella corsia non e' stato annullato",
            output_detail(&output),
        ))
    }
}

fn clear_receipt(context: &super::RepositoryContext, branch: &str) {
    for suffix in [RECEIPT_COMMIT, RECEIPT_SOURCE, RECEIPT_STRATEGY] {
        super::config_unset(context, branch, suffix);
    }
}

fn write_receipt(
    context: &super::RepositoryContext,
    branch: &str,
    receipt: &IntegrationReceipt,
) -> Result<(), WorktreeError> {
    super::config_set(context, branch, RECEIPT_COMMIT, &receipt.commit)?;
    super::config_set(context, branch, RECEIPT_SOURCE, &receipt.source)?;
    let strategy = match receipt.strategy {
        IntegrateStrategy::Squash => "squash",
    };
    super::config_set(context, branch, RECEIPT_STRATEGY, strategy)
}

fn parse_strategy(value: &str) -> Option<IntegrateStrategy> {
    match value {
        "squash" => Some(IntegrateStrategy::Squash),
        _ => None,
    }
}

fn read_config_receipt(
    context: &super::RepositoryContext,
    branch: &str,
) -> Result<Option<IntegrationReceipt>, WorktreeError> {
    let Some(commit) = super::config_get(context, branch, RECEIPT_COMMIT)? else {
        return Ok(None);
    };
    let Some(source) = super::config_get(context, branch, RECEIPT_SOURCE)? else {
        return Ok(None);
    };
    let Some(strategy) = super::config_get(context, branch, RECEIPT_STRATEGY)?
        .as_deref()
        .and_then(parse_strategy)
    else {
        return Ok(None);
    };
    if require_explicit_sha(&commit, WorktreeErrorCode::GitCommandFailed, "receipt").is_err()
        || require_explicit_sha(&source, WorktreeErrorCode::GitCommandFailed, "receipt").is_err()
    {
        return Ok(None);
    }
    Ok(Some(IntegrationReceipt {
        commit: commit.to_ascii_lowercase(),
        source: source.to_ascii_lowercase(),
        strategy,
    }))
}

fn read_trailer_receipt(
    context: &super::RepositoryContext,
    target_branch: &str,
    lane_sha: &str,
) -> Result<Option<IntegrationReceipt>, WorktreeError> {
    let reference = format!("refs/heads/{target_branch}");
    let pattern = format!("OMP-Lane-Head: {lane_sha}");
    let output = run_git(
        &context.repository_root,
        &git_args(&[
            "log",
            "-1",
            "--format=%H",
            &reference,
            "--fixed-strings",
            "--grep",
            &pattern,
        ]),
    )?;
    if !output.status.success() {
        return Ok(None);
    }
    let commit = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    if commit.is_empty() {
        return Ok(None);
    }
    if resolve_tree(&context.repository_root, &commit)?
        != resolve_tree(&context.repository_root, lane_sha)?
    {
        return Ok(None);
    }
    Ok(Some(IntegrationReceipt {
        commit,
        source: lane_sha.to_ascii_lowercase(),
        strategy: IntegrateStrategy::Squash,
    }))
}

fn receipt_on_target(
    context: &super::RepositoryContext,
    lane_branch: &str,
    target_branch: &str,
    lane_sha: &str,
) -> Result<Option<IntegrationReceipt>, WorktreeError> {
    let reference = format!("refs/heads/{target_branch}");
    if let Some(receipt) = read_config_receipt(context, lane_branch)? {
        if is_ancestor(&context.repository_root, &receipt.commit, &reference)? {
            return Ok(Some(receipt));
        }
    }
    if let Some(receipt) = read_trailer_receipt(context, target_branch, lane_sha)? {
        if is_ancestor(&context.repository_root, &receipt.commit, &reference)? {
            write_receipt(context, lane_branch, &receipt)?;
            return Ok(Some(receipt));
        }
    }
    Ok(None)
}

fn resolve_target_name(
    context: &super::RepositoryContext,
    worktree: &Path,
    branch: Option<&str>,
    requested: Option<&str>,
) -> Result<String, WorktreeError> {
    let (_, _, _, registered) = match branch {
        Some(branch) => registered_values(context, branch, worktree)?,
        None => (false, None, None, None),
    };
    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    let name = match (requested, registered.as_deref()) {
        (Some(requested), Some(registered)) if requested != registered => {
            return Err(WorktreeError::new(
                WorktreeErrorCode::InvalidTargetBranch,
                "Il branch richiesto non coincide con il target registrato della corsia",
            ));
        }
        (Some(requested), _) => requested.to_string(),
        (None, Some(registered)) => registered.to_string(),
        (None, None) => "main".to_string(),
    };
    validate_target_branch(context, &name)
}

fn ensure_lane_not_main(worktree: &Path, repository_root: &Path) -> Result<(), WorktreeError> {
    if same_path(worktree, repository_root) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::UnsafeWorktreePath,
            "L'operazione non viene eseguita nel worktree principale",
        ));
    }
    Ok(())
}

fn validate_message(message: &str) -> Result<String, WorktreeError> {
    if message.contains('\0') || message.len() > MAX_MESSAGE_BYTES {
        return Err(WorktreeError::new(
            WorktreeErrorCode::MessageInvalid,
            "Il messaggio di commit non e' utilizzabile",
        ));
    }
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::MessageInvalid,
            "Lo squash richiede un messaggio di commit",
        ));
    }
    Ok(trimmed.to_string())
}

fn squash_message(user: &str, lane_id: &str, lane_sha: &str) -> String {
    format!("{user}\n\nOMP-Lane-Id: {lane_id}\nOMP-Lane-Head: {lane_sha}\nOMP-Strategy: squash\n")
}

fn commit_tree(
    cwd: &Path,
    tree: &str,
    parent: &str,
    message: &str,
) -> Result<String, WorktreeError> {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args([
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            "-p",
            parent,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitUnavailable,
            "Git non e' disponibile",
            error.to_string(),
        )
    })?;
    {
        let mut stdin = child.stdin.take().ok_or_else(|| {
            WorktreeError::new(
                WorktreeErrorCode::Internal,
                "Impossibile scrivere il messaggio di commit",
            )
        })?;
        stdin.write_all(message.as_bytes()).map_err(|error| {
            WorktreeError::with_detail(
                WorktreeErrorCode::GitCommandFailed,
                "Impossibile scrivere il messaggio di commit",
                error.to_string(),
            )
        })?;
    }
    let output = child.wait_with_output().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "commit-tree non e' terminato",
            error.to_string(),
        )
    })?;
    if !output.status.success() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Git non ha creato il commit di integrazione",
            output_detail(&output),
        ));
    }
    let sha = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    require_explicit_sha(
        &sha,
        WorktreeErrorCode::GitCommandFailed,
        "Git ha restituito un commit di integrazione non valido",
    )
}

/// Sincronizzazione del checkout fallita. `touched` dice se il working tree
/// puo' essere gia' stato modificato (errore durante o dopo `reset`/`read-tree`)
/// o se il fallimento e' avvenuto nei controlli preliminari, a disco intatto.
struct SyncFailure {
    error: WorktreeError,
    touched: bool,
}

fn untouched(error: WorktreeError) -> SyncFailure {
    SyncFailure {
        error,
        touched: false,
    }
}

fn touched(error: WorktreeError) -> SyncFailure {
    SyncFailure {
        error,
        touched: true,
    }
}

/// Allinea il checkout target, se pulito, al nuovo commit con `reset --hard`.
fn sync_checkout(
    root: &Path,
    target_branch: &str,
    from_sha: &str,
    to_sha: &str,
) -> Result<(), SyncFailure> {
    if attached_branch(root).map_err(untouched)?.as_deref() != Some(target_branch) {
        return Err(untouched(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' piu' sul branch target",
        )));
    }
    if resolve_commit(root, "HEAD").map_err(untouched)? == to_sha
        && porcelain_files(root).map_err(untouched)?.is_empty()
    {
        return Ok(());
    }
    if !worktree_matches_commit(root, from_sha).map_err(untouched)? {
        return Err(untouched(WorktreeError::new(
            WorktreeErrorCode::TargetDirty,
            "Il checkout target e' cambiato durante l'operazione",
        )));
    }
    reset_hard(root, to_sha).map_err(touched)?;
    if resolve_commit(root, "HEAD").map_err(touched)? != to_sha
        || !porcelain_files(root).map_err(touched)?.is_empty()
    {
        return Err(touched(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Il checkout target non coincide con il commit atteso",
        )));
    }
    Ok(())
}

/// Allinea il checkout target con file sporchi disgiunti: `read-tree -m -u` a
/// due alberi aggiorna solo i percorsi cambiati e lascia il resto com'e'.
fn sync_checkout_preserving(
    root: &Path,
    target_branch: &str,
    from_sha: &str,
    to_sha: &str,
) -> Result<(), SyncFailure> {
    if attached_branch(root).map_err(untouched)?.as_deref() != Some(target_branch) {
        return Err(untouched(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' piu' sul branch target",
        )));
    }
    git_without_hooks_ok(
        root,
        &["read-tree", "-m", "-u", from_sha, to_sha],
        "read-tree non ha aggiornato il checkout target",
    )
    .map_err(touched)?;
    if resolve_commit(root, "HEAD").map_err(touched)? != to_sha {
        return Err(touched(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Il checkout target non coincide con il commit di destinazione",
        )));
    }
    Ok(())
}

/// Git senza hook con `input` su stdin (liste `--pathspec-from-file` lunghe
/// oltre il limite della riga di comando di Windows).
fn git_without_hooks_input(
    cwd: &Path,
    args: &[&str],
    input: &[u8],
    failure: &str,
) -> Result<(), WorktreeError> {
    let hooks = no_hooks_path(cwd)?;
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .arg("-c")
        .arg(format!("core.hooksPath={hooks}"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitUnavailable,
            "Git non e' disponibile",
            error.to_string(),
        )
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        // Un errore di scrittura emerge comunque dall'esito di Git.
        let _ = stdin.write_all(input);
    }
    let output = child.wait_with_output().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            failure,
            error.to_string(),
        )
    })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            failure,
            output_detail(&output),
        ))
    }
}

/// Riporta a `to_sha` i soli percorsi che differiscono da `from_sha`, senza
/// toccare il resto del checkout (i file sporchi disgiunti dell'utente). Un
/// `read-tree` interrotto puo' aver scritto file senza aggiornare l'indice:
/// un secondo `read-tree` li lascerebbe com'erano, il checkout dei percorsi no.
fn restore_changed_paths(
    root: &Path,
    from_sha: &str,
    to_sha: &str,
    preserve: &[String],
) -> Result<(), WorktreeError> {
    let output = require_git(
        root,
        &git_args(&[
            "diff",
            "--name-status",
            "--no-renames",
            "-z",
            from_sha,
            to_sha,
        ]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile determinare i file da ripristinare",
    )?;
    let mut to_checkout: Vec<u8> = Vec::new();
    let mut to_delete: Vec<String> = Vec::new();
    let mut fields = output.stdout.split(|byte| *byte == 0);
    while let (Some(status), Some(path)) = (fields.next(), fields.next()) {
        if status.is_empty() || path.is_empty() {
            continue;
        }
        // I file gia' sporchi prima dell'operazione sono dell'utente: il
        // ripristino non li riscrive ne' li cancella, qualunque cosa dica il diff.
        let text = String::from_utf8_lossy(path);
        if preserve.iter().any(|kept| paths_match(kept, &text)) {
            continue;
        }
        if status.first() == Some(&b'D') {
            // Assente in `to_sha`: c'e' solo perche' l'aggiornamento l'ha scritto.
            to_delete.push(String::from_utf8_lossy(path).into_owned());
        } else {
            to_checkout.extend_from_slice(path);
            to_checkout.push(0);
        }
    }
    if !to_checkout.is_empty() {
        git_without_hooks_input(
            root,
            &[
                "--literal-pathspecs",
                "checkout",
                to_sha,
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            &to_checkout,
            "Impossibile ripristinare i file del checkout target",
        )?;
    }
    for path in &to_delete {
        let input = format!("{path}\0");
        git_without_hooks_input(
            root,
            &[
                "--literal-pathspecs",
                "rm",
                "-q",
                "--cached",
                "--ignore-unmatch",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            input.as_bytes(),
            "Impossibile togliere dall'indice un file dell'aggiornamento annullato",
        )?;
        let absolute = root.join(path);
        if std::fs::symlink_metadata(&absolute)
            .is_ok_and(|metadata| !metadata.is_dir() || metadata.file_type().is_symlink())
        {
            std::fs::remove_file(&absolute).map_err(|error| {
                WorktreeError::with_detail(
                    WorktreeErrorCode::GitCommandFailed,
                    format!("Impossibile rimuovere '{path}' dal checkout target"),
                    error.to_string(),
                )
            })?;
        }
    }
    Ok(())
}

/// Riporta il working tree a `to_sha` dopo che il ref e' gia' stato rimesso
/// a posto ma la sincronizzazione si era fermata a meta' (tipicamente un file
/// bloccato da un altro programma su Windows). Un checkout pulito prima
/// dell'operazione torna indietro con `reset --hard` senza perdere nulla; uno
/// con file sporchi disgiunti ripristina solo i percorsi dell'aggiornamento,
/// che per costruzione non si sovrappongono a quei file.
fn restore_checkout(
    root: &Path,
    dirty_before: &[String],
    from_sha: &str,
    to_sha: &str,
) -> Result<(), WorktreeError> {
    if dirty_before.is_empty() {
        reset_hard(root, to_sha)?;
    } else {
        restore_changed_paths(root, from_sha, to_sha, dirty_before)?;
    }
    if resolve_commit(root, "HEAD")? != to_sha {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Il checkout target non coincide con il commit ripristinato",
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn restore_checkout_for_tests(
    root: &Path,
    dirty_before: &[String],
    from_sha: &str,
    to_sha: &str,
) -> Result<(), WorktreeError> {
    restore_checkout(root, dirty_before, from_sha, to_sha)
}

/// Errore per un checkout rimasto a meta' con il ref gia' ripristinato.
fn checkout_left_halfway(detail: String) -> WorktreeError {
    WorktreeError::with_detail(
        WorktreeErrorCode::CheckoutSyncFailed,
        "Il branch target e' stato ripristinato, ma alcuni file del checkout principale sono rimasti a meta'. Esegui git status nel progetto, chiudi i programmi che bloccano i file e riprova",
        detail,
    )
}

fn rollback_ref(
    context: &super::RepositoryContext,
    lane_branch: &str,
    target_branch: &str,
    from_sha: &str,
    to_sha: &str,
) -> Result<(), WorktreeError> {
    update_ref(&context.repository_root, target_branch, from_sha, to_sha)?;
    clear_receipt(context, lane_branch);
    Ok(())
}

fn diff_name_only_z(cwd: &Path, from: &str, to: &str) -> Result<Vec<String>, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(&["diff", "--name-only", "--no-renames", "-z", from, to]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile determinare i file modificati",
    )?;
    let mut files = Vec::new();
    for raw in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|raw| !raw.is_empty())
    {
        if let Ok(text) = std::str::from_utf8(raw) {
            let normalized = text.replace('\\', "/");
            if !files.contains(&normalized) {
                files.push(normalized);
            }
        }
    }
    Ok(files)
}

pub(super) fn paths_match(a: &str, b: &str) -> bool {
    let norm_a = a.replace('\\', "/");
    let norm_b = b.replace('\\', "/");
    // Windows e macOS (APFS/HFS+ di default) non distinguono le maiuscole:
    // `Readme.md` e `README.md` sono lo stesso file e vanno protetti insieme.
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        norm_a.eq_ignore_ascii_case(&norm_b)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        norm_a == norm_b
    }
}

/// File sporchi del checkout che l'aggiornamento toccherebbe. Le copie locali
/// dell'allowlist non hanno eccezioni: i commit della corsia le escludono,
/// quindi di norma non compaiono in `changed`; se ci sono (corsia che le ha
/// committate prima dell'esclusione) l'aggiornamento sovrascriverebbe
/// l'originale dell'utente, e l'integrazione va in coda come per ogni altro file.
fn overlapping_paths(dirty: &[String], changed: &[String]) -> Vec<String> {
    let mut overlapping: Vec<String> = Vec::new();
    for path in dirty {
        if changed.iter().any(|other| paths_match(path, other))
            && !overlapping
                .iter()
                .any(|existing| paths_match(existing, path))
        {
            overlapping.push(path.clone());
        }
    }
    overlapping
}

/// Vero se `path` sta dentro la cartella `dir` (entrambi con `/`).
fn path_within(path: &str, dir: &str) -> bool {
    path.len() > dir.len()
        && path.as_bytes()[dir.len()] == b'/'
        && path
            .get(..dir.len())
            .is_some_and(|prefix| paths_match(prefix, dir))
}

/// Massimo di file elencati in un messaggio d'errore.
const MAX_LISTED_FILES: usize = 10;

fn list_for_message(files: &[String]) -> String {
    let mut text = files
        .iter()
        .take(MAX_LISTED_FILES)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if files.len() > MAX_LISTED_FILES {
        text.push_str(&format!(" (e altri {})", files.len() - MAX_LISTED_FILES));
    }
    text
}

/// File ignorati presenti nel checkout target che l'aggiornamento scriverebbe.
/// `reset --hard` li sovrascrive senza chiedere (un `secret.json` ignorato in
/// locale e versionato dalla corsia), quindi vanno trovati prima di muovere il
/// ref. `--directory` riduce una cartella ignorata intera a una voce: per quei
/// casi conta se il file esiste davvero sul disco.
fn ignored_files_overwritten(
    root: &Path,
    changed: &[String],
) -> Result<Vec<String>, WorktreeError> {
    if changed.is_empty() {
        return Ok(Vec::new());
    }
    let output = require_git(
        root,
        &git_args(&[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ]),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile elencare i file ignorati del checkout target",
    )?;
    let ignored: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|raw| !raw.is_empty())
        .map(|raw| String::from_utf8_lossy(raw).replace('\\', "/"))
        .collect();
    let mut hits: Vec<String> = Vec::new();
    for path in changed {
        let hit = ignored.iter().any(|entry| match entry.strip_suffix('/') {
            Some(dir) => {
                paths_match(dir, path)
                    || (path_within(path, dir)
                        && std::fs::symlink_metadata(root.join(path)).is_ok())
            }
            None => paths_match(entry, path),
        });
        if hit && !hits.iter().any(|existing| paths_match(existing, path)) {
            hits.push(path.clone());
        }
    }
    Ok(hits)
}

fn ensure_no_ignored_overwrite(root: &Path, changed: &[String]) -> Result<(), WorktreeError> {
    let hits = ignored_files_overwritten(root, changed)?;
    if hits.is_empty() {
        return Ok(());
    }
    Err(WorktreeError::with_detail(
        WorktreeErrorCode::TargetDirty,
        format!(
            "Il checkout target contiene file ignorati da Git che l'operazione sovrascriverebbe: {}. Spostali o rinominali e riprova",
            list_for_message(&hits)
        ),
        hits.join("\n"),
    ))
}

enum MergeTreeResult {
    Clean { tree: String },
    Conflicts,
}

fn merge_tree_write(
    cwd: &Path,
    target_sha: &str,
    lane_head: &str,
) -> Result<MergeTreeResult, WorktreeError> {
    let output = run_git(
        cwd,
        &git_args(&[
            "merge-tree",
            "--write-tree",
            "--name-only",
            "--no-messages",
            target_sha,
            lane_head,
        ]),
    )?;
    match output.status.code() {
        Some(0) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let first_line = stdout.lines().next().unwrap_or("").trim();
            let tree = require_explicit_sha(
                first_line,
                WorktreeErrorCode::GitCommandFailed,
                "merge-tree ha restituito un OID albero non valido",
            )?;
            Ok(MergeTreeResult::Clean { tree })
        }
        Some(1) => Ok(MergeTreeResult::Conflicts),
        _ => Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "git merge-tree e' fallito",
            output_detail(&output),
        )),
    }
}

enum MergeLaneOutcome {
    Clean,
    Conflicted(Vec<String>),
}

fn merge_target_into_lane(
    context: &super::RepositoryContext,
    worktree: &Path,
    target_branch: &str,
) -> Result<MergeLaneOutcome, WorktreeError> {
    let target_ref = format!("refs/heads/{target_branch}");
    let target_before = resolve_commit(&context.repository_root, &target_ref)?;
    let head_before = resolve_commit(worktree, "HEAD")?;

    let output = git_without_hooks(worktree, &["merge", "--no-edit", &target_ref])?;

    let target_after = resolve_commit(&context.repository_root, &target_ref)?;
    if target_after != target_before {
        return Err(WorktreeError::new(
            WorktreeErrorCode::Internal,
            "L'aggiornamento della corsia ha modificato il branch target",
        ));
    }

    if output.status.success() {
        return Ok(MergeLaneOutcome::Clean);
    }

    let conflict_files = unmerged_paths(worktree)?;
    if !conflict_files.is_empty() {
        return Ok(MergeLaneOutcome::Conflicted(conflict_files));
    }

    if merge_in_progress(worktree)? {
        abort_merge(worktree)?;
    }
    let head_after = resolve_commit(worktree, "HEAD")?;
    if head_after != head_before || merge_in_progress(worktree)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "L'aggiornamento della corsia e' fallito e il rollback non ha ripristinato HEAD",
        ));
    }
    Err(WorktreeError::with_detail(
        WorktreeErrorCode::GitCommandFailed,
        format!("Impossibile aggiornare la corsia da '{target_branch}'"),
        output_detail(&output),
    ))
}

/// `git add -A` della corsia senza le copie locali dell'allowlist: un percorso
/// escluso per argomento, con `literal` perche' `*` o `[` nel nome non diventino
/// pattern. Argv separati, mai una shell: spazi e apici passano intatti.
fn lane_add_args(allowlisted: &[String]) -> Vec<String> {
    let mut args = vec!["add".to_string(), "-A".to_string()];
    if !allowlisted.is_empty() {
        args.push("--".to_string());
        args.push(".".to_string());
        for path in allowlisted {
            args.push(format!(":(exclude,literal){path}"));
        }
    }
    args
}

pub(crate) fn land_sync(args: WorktreeLandArgs) -> Result<WorktreeLandOutcome, WorktreeError> {
    let _lock = worktree_mutation_lock();
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?.to_string();
    let (worktree, entry) = resolve_managed_worktree(&context, &args.worktree_path)?;
    ensure_lane_not_main(&worktree, &context.repository_root)?;
    let lane_branch = entry.branch.clone().ok_or_else(|| {
        WorktreeError::new(
            WorktreeErrorCode::UnmanagedWorktree,
            "La corsia non ha un branch",
        )
    })?;
    let expected_branch = format!("{LANE_BRANCH_PREFIX}{lane_id}");
    if lane_branch != expected_branch {
        return Err(WorktreeError::new(
            WorktreeErrorCode::InvalidLaneId,
            "Il branch della corsia non corrisponde all'identificatore confermato",
        ));
    }
    let target_branch = resolve_target_name(
        &context,
        &worktree,
        Some(&lane_branch),
        args.target_branch.as_deref(),
    )?;
    let message = validate_message(&args.message)?;
    // Prima di qualsiasi commit automatico: con un Git senza `merge-tree
    // --write-tree` la corsia resterebbe committata senza poter integrare.
    ensure_git_supports_merge_tree(super::git_version())?;

    // Controllo processi attivi escludendo quelli esenti
    let active_processes: Vec<_> = crate::process_tree::lane_processes_under(&worktree)
        .into_iter()
        .filter(|proc| {
            !args
                .exempt_owners
                .iter()
                .any(|owner| owner.kind == proc.kind && owner.owner_id == proc.owner_id)
        })
        .collect();
    if !active_processes.is_empty() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::ProcessesActive,
            "La corsia ha processi attivi e l'integrazione non parte",
            describe_processes(&active_processes),
        ));
    }

    // Copie locali dell'allowlist: mai nel commit della corsia, mai "lavoro".
    let allowlisted = allowlist_paths(&context, &lane_branch)?;

    // Idempotenza preliminare: se la corsia e' pulita e HEAD corrisponde alla ricevuta gia' sul target
    let current_lane = resolve_commit(&worktree, "HEAD")?;
    if blocking_changes(&worktree, &allowlisted)?.is_empty() && !merge_in_progress(&worktree)? {
        if let Some(receipt) =
            receipt_on_target(&context, &lane_branch, &target_branch, &current_lane)?
        {
            if receipt.source == current_lane {
                return Ok(WorktreeLandOutcome::AlreadyIntegrated {
                    commit: receipt.commit,
                    target_branch,
                });
            }
        }
    }

    // Se ci sono percorsi in conflitto non risolti nel worktree, ritorna conflicts
    let unmerged = unmerged_paths(&worktree)?;
    if !unmerged.is_empty() {
        return Ok(WorktreeLandOutcome::Conflicts {
            files: unmerged,
            worktree_path: path_string(&worktree)?,
            target_branch,
        });
    }

    // Se MERGE_HEAD esiste e nessun unmerged path, completa il merge con commit --no-edit
    if merge_in_progress(&worktree)? {
        git_without_hooks_ok(
            &worktree,
            &["commit", "--no-edit"],
            "Impossibile completare il merge in corso nella corsia",
        )?;
    }

    // Modifiche della corsia (copie dell'allowlist escluse): add e commit.
    if !blocking_changes(&worktree, &allowlisted)?.is_empty() {
        let add_args = lane_add_args(&allowlisted);
        let add_refs: Vec<&str> = add_args.iter().map(String::as_str).collect();
        git_without_hooks_ok(
            &worktree,
            &add_refs,
            "Impossibile preparare le modifiche della corsia (git add)",
        )?;
        // Senza nulla in stage (es. solo file locali esclusi) `commit` fallirebbe.
        if !diff_quiet(&worktree, &["--cached"])? {
            git_without_hooks_ok(
                &worktree,
                &["commit", "-m", &message],
                "Impossibile creare il commit delle modifiche della corsia",
            )?;
        }
    }

    let mut lane_head = resolve_commit(&worktree, "HEAD")?;
    let target_ref = format!("refs/heads/{target_branch}");
    let target_sha = resolve_commit(&context.repository_root, &target_ref)?;

    // Idempotenza post-commit: se l'HEAD attuale ha gia' una ricevuta sul target
    if let Some(receipt) = receipt_on_target(&context, &lane_branch, &target_branch, &lane_head)? {
        if receipt.source == lane_head {
            return Ok(WorktreeLandOutcome::AlreadyIntegrated {
                commit: receipt.commit,
                target_branch,
            });
        }
    }

    // Merge in memoria tramite git merge-tree
    let mut retried_clean = false;
    let (merged_tree, final_lane_head) = loop {
        match merge_tree_write(&context.repository_root, &target_sha, &lane_head)? {
            MergeTreeResult::Clean { tree } => break (tree, lane_head),
            MergeTreeResult::Conflicts => {
                match merge_target_into_lane(&context, &worktree, &target_branch)? {
                    MergeLaneOutcome::Conflicted(files) => {
                        return Ok(WorktreeLandOutcome::Conflicts {
                            files,
                            worktree_path: path_string(&worktree)?,
                            target_branch,
                        });
                    }
                    MergeLaneOutcome::Clean => {
                        if retried_clean {
                            return Err(WorktreeError::new(
                                WorktreeErrorCode::Internal,
                                "Conflitto inaspettato dopo il merge del target nella corsia",
                            ));
                        }
                        retried_clean = true;
                        lane_head = resolve_commit(&worktree, "HEAD")?;
                    }
                }
            }
        }
    };
    lane_head = final_lane_head;

    // Se merged_tree == tree(target_sha) non ci sono modifiche da integrare
    let target_tree = resolve_tree(&context.repository_root, &target_sha)?;
    if merged_tree == target_tree {
        return Ok(WorktreeLandOutcome::Nothing { target_branch });
    }

    // Creazione del commit di squash in memoria
    let squash_msg = squash_message(&message, &lane_id, &lane_head);
    let new_commit = commit_tree(
        &context.repository_root,
        &merged_tree,
        &target_sha,
        &squash_msg,
    )?;

    // Verifica stato del checkout principale
    if attached_branch(&context.repository_root)?.as_deref() != Some(&target_branch) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' sul branch di destinazione",
        ));
    }
    if !unmerged_paths(&context.repository_root)?.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConflictsPresent,
            "Il checkout principale ha conflitti non risolti",
        ));
    }

    let dirty = porcelain_files(&context.repository_root)?;
    let changed = diff_name_only_z(&context.repository_root, &target_sha, &new_commit)?;

    let overlapping = overlapping_paths(&dirty, &changed);
    if !overlapping.is_empty() {
        return Ok(WorktreeLandOutcome::Queued {
            reason: "target_overlap".to_string(),
            files: overlapping,
        });
    }
    ensure_no_ignored_overwrite(&context.repository_root, &changed)?;

    // CAS update-ref del branch target
    update_ref(
        &context.repository_root,
        &target_branch,
        &new_commit,
        &target_sha,
    )?;

    let receipt = IntegrationReceipt {
        commit: new_commit.clone(),
        source: lane_head.clone(),
        strategy: IntegrateStrategy::Squash,
    };
    if let Err(error) = write_receipt(&context, &lane_branch, &receipt) {
        let _ = rollback_ref(
            &context,
            &lane_branch,
            &target_branch,
            &target_sha,
            &new_commit,
        );
        return Err(error);
    }

    // Sincronizzazione checkout (preservando eventuali file sporchi disgiunti)
    let sync_res = if dirty.is_empty() {
        sync_checkout(
            &context.repository_root,
            &target_branch,
            &target_sha,
            &new_commit,
        )
    } else {
        sync_checkout_preserving(
            &context.repository_root,
            &target_branch,
            &target_sha,
            &new_commit,
        )
    };

    if let Err(failure) = sync_res {
        if rollback_ref(
            &context,
            &lane_branch,
            &target_branch,
            &target_sha,
            &new_commit,
        )
        .is_err()
        {
            return Err(WorktreeError::with_detail(
                WorktreeErrorCode::CheckoutSyncFailed,
                "Il commit e' sul target ma il checkout non e' allineato: il tentativo successivo non crea un altro merge",
                failure.error.message,
            ));
        }
        // Il ref e' tornato indietro: se il checkout era gia' stato toccato va
        // riportato anche lui, o il target mostrerebbe file dell'integrazione
        // annullata come modifiche locali.
        if failure.touched {
            if let Err(restore_error) =
                restore_checkout(&context.repository_root, &dirty, &new_commit, &target_sha)
            {
                return Err(checkout_left_halfway(format!(
                    "{}; ripristino: {}",
                    failure.error.message, restore_error.message
                )));
            }
        }
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Integrazione annullata senza modificare il target",
            failure.error.message,
        ));
    }

    // Verifica finale
    let verified = resolve_commit(
        &context.repository_root,
        &format!("refs/heads/{target_branch}"),
    )?;
    if verified != new_commit {
        return Err(WorktreeError::new(
            WorktreeErrorCode::CheckoutSyncFailed,
            "Il commit di integrazione non risulta sul branch target",
        ));
    }
    if resolve_tree(&context.repository_root, &new_commit)? != merged_tree {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "L'albero del commit squash non coincide con quello generato dal merge",
        ));
    }

    Ok(WorktreeLandOutcome::Integrated {
        commit: new_commit,
        previous_target: target_sha,
        target_branch,
        lane_head,
        files: changed,
    })
}

pub(crate) fn undo_land_sync(
    args: WorktreeUndoLandArgs,
) -> Result<WorktreeUndoLandOutcome, WorktreeError> {
    let _lock = worktree_mutation_lock();
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?.to_string();
    let target_branch = validate_target_branch(&context, &args.target_branch)?;
    let commit = require_explicit_sha(
        &args.commit,
        WorktreeErrorCode::TargetMoved,
        "Lo SHA del commit da annullare non e' valido",
    )?;
    let previous_target = require_explicit_sha(
        &args.previous_target,
        WorktreeErrorCode::TargetMoved,
        "Lo SHA del target precedente non e' valido",
    )?;

    if attached_branch(&context.repository_root)?.as_deref() != Some(&target_branch) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' sul branch target",
        ));
    }

    let current_target = resolve_commit(
        &context.repository_root,
        &format!("refs/heads/{target_branch}"),
    )?;
    if current_target != commit {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetMoved,
            "Il branch target e' avanzato rispetto al commit da annullare",
        ));
    }
    // L'annullamento riporta il ref al genitore diretto dello squash: con un
    // `previousTarget` diverso (stato del frontend vecchio o manomesso) si
    // butterebbero via commit che non appartengono all'integrazione.
    let parent = resolve_commit(&context.repository_root, &format!("{commit}^"))?;
    if parent != previous_target {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetMoved,
            "Il commit da annullare non e' figlio diretto del target precedente indicato",
        ));
    }

    if !unmerged_paths(&context.repository_root)?.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConflictsPresent,
            "Il checkout principale ha conflitti non risolti",
        ));
    }

    let dirty = porcelain_files(&context.repository_root)?;
    let changed = diff_name_only_z(&context.repository_root, &commit, &previous_target)?;
    let overlapping = overlapping_paths(&dirty, &changed);
    if !overlapping.is_empty() {
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::TargetDirty,
            "I file modificati localmente nel target si sovrappongono alle modifiche da annullare",
            overlapping.join(", "),
        ));
    }
    ensure_no_ignored_overwrite(&context.repository_root, &changed)?;

    // CAS update_ref: da commit a previous_target
    update_ref(
        &context.repository_root,
        &target_branch,
        &previous_target,
        &commit,
    )?;

    let lane_branch = format!("{LANE_BRANCH_PREFIX}{lane_id}");

    let sync_res = if dirty.is_empty() {
        sync_checkout(
            &context.repository_root,
            &target_branch,
            &commit,
            &previous_target,
        )
    } else {
        sync_checkout_preserving(
            &context.repository_root,
            &target_branch,
            &commit,
            &previous_target,
        )
    };

    if let Err(failure) = sync_res {
        if update_ref(
            &context.repository_root,
            &target_branch,
            &commit,
            &previous_target,
        )
        .is_err()
        {
            // Il ref e' rimasto sul target precedente: l'integrazione e' di
            // fatto annullata e la ricevuta non vale piu'.
            clear_receipt(&context, &lane_branch);
            return Err(WorktreeError::with_detail(
                WorktreeErrorCode::CheckoutSyncFailed,
                "Il branch target e' tornato al commit precedente ma il checkout non e' allineato. Esegui git status nel progetto, chiudi i programmi che bloccano i file e riprova",
                failure.error.message,
            ));
        }
        if failure.touched {
            if let Err(restore_error) =
                restore_checkout(&context.repository_root, &dirty, &previous_target, &commit)
            {
                return Err(checkout_left_halfway(format!(
                    "{}; ripristino: {}",
                    failure.error.message, restore_error.message
                )));
            }
        }
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::CheckoutSyncFailed,
            "Impossibile allineare il checkout target al commit precedente durante l'annullamento",
            failure.error.message,
        ));
    }

    // La ricevuta si toglie solo ad annullamento riuscito: se il checkout non
    // si allinea il commit resta sul target e la corsia resta integrata.
    clear_receipt(&context, &lane_branch);

    // Creazione esclusiva del branch di ripristino refs/heads/omp/restored-<laneId>
    let mut counter = 1;
    let restored_branch = loop {
        let name = if counter == 1 {
            format!("omp/restored-{lane_id}")
        } else {
            format!("omp/restored-{lane_id}-{counter}")
        };
        let ref_name = format!("refs/heads/{name}");
        let output = run_git(
            &context.repository_root,
            &git_args(&["update-ref", &ref_name, &commit, ""]),
        )?;
        if output.status.success() {
            break name;
        }
        counter += 1;
        if counter > 1000 {
            return Err(WorktreeError::new(
                WorktreeErrorCode::Internal,
                "Impossibile creare il branch di ripristino della corsia",
            ));
        }
    };

    Ok(WorktreeUndoLandOutcome {
        target_branch,
        head: previous_target,
        restored_branch,
    })
}

/// Stato del branch di corsia rispetto all'integrazione, in sola lettura.
struct LaneBranchState {
    branch: String,
    tip: String,
    target: String,
    receipt: Option<IntegrationReceipt>,
    /// Ricevuta valida, tip == sorgente della ricevuta e commit sul target.
    integrated: bool,
}

/// `None` se il branch `omp/lane-<id>` non esiste.
fn lane_branch_state(
    context: &super::RepositoryContext,
    lane_id: &str,
) -> Result<Option<LaneBranchState>, WorktreeError> {
    let branch = format!("{LANE_BRANCH_PREFIX}{lane_id}");
    if !super::branch_exists(context, &branch)? {
        return Ok(None);
    }
    let tip = resolve_commit(&context.repository_root, &format!("refs/heads/{branch}"))?;
    let target = super::config_get(context, &branch, "ompStudioTargetBranch")?
        .unwrap_or_else(|| "main".to_string());
    let receipt = read_config_receipt(context, &branch)?;
    let integrated = match &receipt {
        Some(receipt) if receipt.source == tip => {
            super::branch_exists(context, &target)?
                && is_ancestor(
                    &context.repository_root,
                    &receipt.commit,
                    &format!("refs/heads/{target}"),
                )?
        }
        _ => false,
    };
    Ok(Some(LaneBranchState {
        branch,
        tip,
        target,
        receipt,
        integrated,
    }))
}

/// Commit base registrato alla creazione, se ancora risolvibile.
fn registered_base(context: &super::RepositoryContext, branch: &str) -> Option<String> {
    super::config_get(context, branch, "ompStudioBaseCommit")
        .ok()
        .flatten()
        .and_then(|base| resolve_commit(&context.repository_root, &base).ok())
}

/// Vero se il branch non porta lavoro proprio: il tip e' ancora il commit
/// base registrato, oppure e' gia' contenuto nel target (merge esterno).
fn lane_has_no_own_work(
    context: &super::RepositoryContext,
    state: &LaneBranchState,
) -> Result<bool, WorktreeError> {
    if registered_base(context, &state.branch).as_deref() == Some(state.tip.as_str()) {
        return Ok(true);
    }
    if super::branch_exists(context, &state.target)? {
        return is_ancestor(
            &context.repository_root,
            &state.tip,
            &format!("refs/heads/{}", state.target),
        );
    }
    Ok(false)
}

/// Voci dell'output di Git separate da `separator` (righe o NUL di `-z`).
fn count_entries(cwd: &Path, args: &[&str], separator: u8) -> Result<u32, WorktreeError> {
    let output = require_git(
        cwd,
        &git_args(args),
        WorktreeErrorCode::GitCommandFailed,
        "Impossibile contare il lavoro non integrato della corsia",
    )?;
    let count = output
        .stdout
        .split(|byte| *byte == separator)
        .filter(|raw| !raw.iter().all(u8::is_ascii_whitespace))
        .count();
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

pub(crate) fn lane_unintegrated_summary_sync(
    args: LaneBranchQueryArgs,
) -> Result<LaneUnintegratedSummary, WorktreeError> {
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?;
    let Some(state) = lane_branch_state(&context, lane_id)? else {
        return Ok(LaneUnintegratedSummary {
            branch_exists: false,
            integrated: false,
            commits: 0,
            files: 0,
        });
    };
    if state.integrated {
        return Ok(LaneUnintegratedSummary {
            branch_exists: true,
            integrated: true,
            commits: 0,
            files: 0,
        });
    }
    let root = &context.repository_root;
    // Riferimento: la sorgente gia' integrata se la corsia e' andata avanti dopo
    // lo squash (i commit squashati non sono "nel target" per Git, il loro
    // contenuto si'), altrimenti il target, altrimenti il commit base.
    let integrated_source = match &state.receipt {
        Some(receipt) if is_ancestor(root, &receipt.source, &state.tip)? => {
            Some(receipt.source.clone())
        }
        _ => None,
    };
    let reference = match integrated_source {
        Some(source) => Some(source),
        None if super::branch_exists(&context, &state.target)? => {
            Some(format!("refs/heads/{}", state.target))
        }
        None => registered_base(&context, &state.branch),
    };
    let (commits, files) = match reference {
        Some(reference) => {
            let commits = count_entries(
                root,
                &["rev-list", &format!("{reference}..{}", state.tip)],
                b'\n',
            )?;
            let fork = git_text(root, &["merge-base", &reference, &state.tip]).ok();
            let files = match fork.filter(|fork| !fork.is_empty()) {
                Some(fork) => count_entries(
                    root,
                    &[
                        "diff",
                        "--name-only",
                        "--no-renames",
                        "-z",
                        &fork,
                        &state.tip,
                    ],
                    0,
                )?,
                None => {
                    count_entries(root, &["ls-tree", "-r", "--name-only", "-z", &state.tip], 0)?
                }
            };
            (commits, files)
        }
        None => (
            count_entries(root, &["rev-list", &state.tip], b'\n')?,
            count_entries(root, &["ls-tree", "-r", "--name-only", "-z", &state.tip], 0)?,
        ),
    };
    Ok(LaneUnintegratedSummary {
        branch_exists: true,
        integrated: false,
        commits,
        files,
    })
}

pub(crate) fn lane_integration_state_sync(
    args: LaneBranchQueryArgs,
) -> Result<LaneIntegrationState, WorktreeError> {
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?;
    Ok(match lane_branch_state(&context, lane_id)? {
        Some(state) => LaneIntegrationState {
            branch_exists: true,
            integrated: state.integrated,
        },
        None => LaneIntegrationState {
            branch_exists: false,
            integrated: false,
        },
    })
}

fn delete_branch(
    context: &super::RepositoryContext,
    branch: &str,
    force: bool,
) -> Result<bool, WorktreeError> {
    let flag = if force { "-D" } else { "-d" };
    let output = run_git(
        &context.repository_root,
        &git_args(&["branch", flag, branch]),
    )?;
    Ok(output.status.success())
}

pub(crate) fn delete_lane_branch_sync(args: DeleteLaneBranchArgs) -> Result<(), WorktreeError> {
    let _lock = worktree_mutation_lock();
    if !args.confirm {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConfirmationRequired,
            "L'eliminazione del branch richiede una conferma distinta",
        ));
    }
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?;
    // Solo `omp/lane-<id>`: l'id e' validato, quindi il nome non puo' uscire
    // dal prefisso di corsia.
    let Some(state) = lane_branch_state(&context, lane_id)? else {
        return Ok(());
    };
    let branch = state.branch.clone();
    let is_checked_out = super::porcelain_worktrees(&context)?
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(&branch));
    if is_checked_out {
        return Err(WorktreeError::new(
            WorktreeErrorCode::WorktreeInUse,
            "Il branch e' ancora checked out: nessun force e' stato usato",
        ));
    }

    // Lavoro gia' al sicuro: integrato (squash, che per Git non risulta
    // "merged") oppure nessun commit proprio. Si prova `-d` e solo per questi
    // casi si ripiega su `-D`: il tip non contiene nulla che andrebbe perso.
    let safe = state.integrated || lane_has_no_own_work(&context, &state)?;
    if !safe {
        if !args.discard_unintegrated {
            return Err(match &state.receipt {
                Some(_) => WorktreeError::new(
                    WorktreeErrorCode::LaneDivergedAfterIntegrate,
                    "Il branch contiene commit non compresi nell'integrazione e non viene forzato",
                ),
                None => WorktreeError::new(
                    WorktreeErrorCode::ConfirmationRequired,
                    "Il branch non ha un'integrazione riconosciuta e non viene forzato",
                ),
            });
        }
        // Consenso esplicito a scartare il lavoro non integrato.
        if delete_branch(&context, &branch, true)? {
            return Ok(());
        }
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Git non ha eliminato il branch della corsia",
        ));
    }

    if delete_branch(&context, &branch, false)? {
        return Ok(());
    }
    let forced = run_git(
        &context.repository_root,
        &git_args(&["branch", "-D", &branch]),
    )?;
    if forced.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Git non ha eliminato il branch della corsia",
            output_detail(&forced),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rifiuta_git_precedente_alla_2_38_con_messaggio_esplicito() {
        let error = ensure_git_supports_merge_tree(Some((2, 37, 9))).unwrap_err();
        assert_eq!(error.code, WorktreeErrorCode::GitTooOld);
        assert_eq!(
            error.message,
            "Integrazione corsie: serve Git 2.38 o successivo (trovato 2.37)"
        );
        assert!(ensure_git_supports_merge_tree(Some((2, 38, 0))).is_ok());
        assert!(ensure_git_supports_merge_tree(Some((3, 0, 0))).is_ok());
        assert!(ensure_git_supports_merge_tree(None).is_ok());
    }

    #[test]
    fn esclude_le_copie_allowlist_dal_git_add() {
        assert_eq!(lane_add_args(&[]), vec!["add", "-A"]);
        assert_eq!(
            lane_add_args(&["Parametri.ini".to_string(), "conf/a b*.ini".to_string()]),
            vec![
                "add",
                "-A",
                "--",
                ".",
                ":(exclude,literal)Parametri.ini",
                ":(exclude,literal)conf/a b*.ini",
            ]
        );
    }

    #[test]
    fn overlap_protegge_anche_le_copie_allowlist_e_confronta_le_cartelle_per_componenti() {
        // Parametri.ini locale e' sporco; se la corsia lo cambia (perche' lo
        // aveva committato) l'integrazione deve fermarsi, non sovrascriverlo.
        let dirty = vec!["Parametri.ini".to_string(), "src/a.txt".to_string()];
        let changed = vec!["Parametri.ini".to_string(), "src/b.txt".to_string()];
        assert_eq!(
            overlapping_paths(&dirty, &changed),
            vec!["Parametri.ini".to_string()]
        );
        assert!(path_within("build/out.js", "build"));
        assert!(!path_within("buildx/out.js", "build"));
        assert!(!path_within("build", "build"));
    }

    #[test]
    fn elenco_file_nel_messaggio_si_ferma_a_dieci() {
        let files: Vec<String> = (0..12).map(|i| format!("f{i}")).collect();
        let text = list_for_message(&files);
        assert!(text.starts_with("f0, f1"));
        assert!(text.contains("f9"));
        assert!(!text.contains("f10,"));
        assert!(text.ends_with("(e altri 2)"));
    }

    #[test]
    fn cartella_hook_assente_o_vuota_mai_una_con_file() {
        let base =
            std::env::temp_dir().join(format!("omp-studio-hooks-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        assert_eq!(
            unused_hooks_dir(&base),
            Some(base.join("omp-studio-no-hooks"))
        );

        // Una cartella con dentro un hook non viene mai usata.
        let planted = base.join("omp-studio-no-hooks");
        std::fs::create_dir_all(&planted).unwrap();
        std::fs::write(planted.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        assert_eq!(
            unused_hooks_dir(&base),
            Some(base.join("omp-studio-no-hooks-1"))
        );
        // Vuota: utilizzabile.
        std::fs::create_dir_all(base.join("omp-studio-no-hooks-1")).unwrap();
        assert_eq!(
            unused_hooks_dir(&base),
            Some(base.join("omp-studio-no-hooks-1"))
        );
        // Il percorso scelto non e' mai sotto la cartella temporanea condivisa.
        let chosen = no_hooks_path(&base).unwrap_or_default();
        assert!(!chosen.contains("omp-studio-empty-hooks"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
