//! Integrazione transazionale di una corsia nel branch target (Gate R27 / PLAN W13).
//!
//! Il target viene mosso solo con `update-ref` confronta-e-scambia, dopo un
//! ricontrollo di checkout, pulizia e SHA. I conflitti restano nel worktree
//! della corsia: un merge fallito che non sia un conflitto viene annullato.
//! Se il commit e' gia' sul target, un secondo tentativo non crea un altro
//! merge e lascia al chiamante solo il cleanup.

use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

use super::{
    describe_processes, discover_repository, git_args, output_detail, path_string,
    registered_values, require_git, resolve_managed_worktree, run_git, same_path, validate_lane_id,
    validate_target_branch, WorktreeError, WorktreeErrorCode, WorktreeUpdateArgs,
    WorktreeUpdateOutcome, CREATE_NO_WINDOW, LANE_BRANCH_PREFIX, WORKTREE_MUTATION_LOCK,
};

const RECEIPT_COMMIT: &str = "ompStudioIntegratedCommit";
const RECEIPT_SOURCE: &str = "ompStudioIntegratedSource";
const RECEIPT_STRATEGY: &str = "ompStudioIntegratedStrategy";
const MAX_MESSAGE_BYTES: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrateStrategy {
    Squash,
    Preserve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegratePhase {
    Integrated,
    AlreadyIntegrated,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeIntegrateOutcome {
    pub phase: IntegratePhase,
    pub commit: String,
    pub target_branch: String,
    pub strategy: IntegrateStrategy,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeIntegrateArgs {
    pub project_path: String,
    pub worktree_path: String,
    pub lane_id: String,
    #[serde(default)]
    pub target_branch: Option<String>,
    pub expected_target_sha: String,
    pub expected_lane_sha: String,
    pub message: String,
    pub strategy: IntegrateStrategy,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteLaneBranchArgs {
    pub project_path: String,
    pub lane_id: String,
    pub confirm: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct IntegrationReceipt {
    commit: String,
    source: String,
    strategy: IntegrateStrategy,
}

fn mutation_lock() -> Result<std::sync::MutexGuard<'static, ()>, WorktreeError> {
    WORKTREE_MUTATION_LOCK.lock().map_err(|_| {
        WorktreeError::new(
            WorktreeErrorCode::Internal,
            "Lock del gestore worktree non disponibile",
        )
    })
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

/// Working tree e indice coincidono ancora con `sha`, compresi i non tracciati.
fn worktree_matches_commit(cwd: &Path, sha: &str) -> Result<bool, WorktreeError> {
    Ok(diff_quiet(cwd, &[sha])? && diff_quiet(cwd, &["--cached", sha])? && untracked_empty(cwd)?)
}

fn empty_hooks_path() -> Result<String, WorktreeError> {
    let directory = std::env::temp_dir().join("omp-studio-empty-hooks");
    std::fs::create_dir_all(&directory).map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::Internal,
            "Impossibile preparare una directory hook vuota",
            error.to_string(),
        )
    })?;
    path_string(&directory)
}

fn reset_hard(cwd: &Path, sha: &str) -> Result<(), WorktreeError> {
    let hooks = empty_hooks_path()?;
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .arg("-c")
        .arg(format!("core.hooksPath={hooks}"))
        .args(["reset", "--hard", "--quiet", sha])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitUnavailable,
            "Git non e' disponibile",
            error.to_string(),
        )
    })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::GitCommandFailed,
            "Il checkout non si e' allineato al commit",
            output_detail(&output),
        ))
    }
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
            "Il branch target e' cambiato durante l'integrazione e non e' stato modificato",
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
        IntegrateStrategy::Preserve => "preserve",
    };
    super::config_set(context, branch, RECEIPT_STRATEGY, strategy)
}

fn parse_strategy(value: &str) -> Option<IntegrateStrategy> {
    match value {
        "squash" => Some(IntegrateStrategy::Squash),
        "preserve" => Some(IntegrateStrategy::Preserve),
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
            "L'aggiornamento non viene eseguito nel worktree principale",
        ));
    }
    Ok(())
}

fn live_processes(worktree: &Path) -> Result<(), WorktreeError> {
    let live = crate::process_tree::lane_processes_under(worktree);
    if live.is_empty() {
        Ok(())
    } else {
        Err(WorktreeError::with_detail(
            WorktreeErrorCode::ProcessesActive,
            "La corsia ha processi attivi e l'integrazione non parte",
            describe_processes(&live),
        ))
    }
}

pub(crate) fn update_from_target_sync(
    args: WorktreeUpdateArgs,
) -> Result<WorktreeUpdateOutcome, WorktreeError> {
    let _lock = mutation_lock()?;
    let context = discover_repository(&args.project_path)?;
    let (worktree, entry) = resolve_managed_worktree(&context, &args.worktree_path)?;
    ensure_lane_not_main(&worktree, &context.repository_root)?;
    let target_branch = resolve_target_name(
        &context,
        &worktree,
        entry.branch.as_deref(),
        args.target_branch.as_deref(),
    )?;

    let head_before = resolve_commit(&worktree, "HEAD")?;
    let target_ref = format!("refs/heads/{target_branch}");
    let target_before = resolve_commit(&context.repository_root, &target_ref)?;
    let existing_conflicts = unmerged_paths(&worktree)?;
    if !existing_conflicts.is_empty() {
        return Ok(conflict_outcome(
            &target_branch,
            existing_conflicts,
            "La corsia ha gia' conflitti non risolti",
        ));
    }
    if merge_in_progress(&worktree)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConflictsPresent,
            "Un merge e' gia' in corso nella corsia e non e' stato toccato",
        ));
    }

    let mut command = Command::new("git");
    command
        .current_dir(&worktree)
        .env("GIT_MERGE_AUTOEDIT", "no")
        .args(["merge", "--no-edit", &target_ref])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| {
        WorktreeError::with_detail(
            WorktreeErrorCode::GitUnavailable,
            "Git non e' disponibile",
            error.to_string(),
        )
    })?;

    let target_after = resolve_commit(&context.repository_root, &target_ref)?;
    if target_after != target_before {
        return Err(WorktreeError::new(
            WorktreeErrorCode::Internal,
            "L'aggiornamento della corsia ha modificato il branch target",
        ));
    }

    if output.status.success() {
        return Ok(WorktreeUpdateOutcome {
            success: true,
            conflicted: false,
            conflict_files: Vec::new(),
            message: format!("Corsia aggiornata con successo dal branch '{target_branch}'"),
        });
    }

    let conflict_files = unmerged_paths(&worktree)?;
    if !conflict_files.is_empty() {
        return Ok(conflict_outcome(
            &target_branch,
            conflict_files,
            &output_detail(&output),
        ));
    }

    if merge_in_progress(&worktree)? {
        abort_merge(&worktree)?;
    }
    let head_after = resolve_commit(&worktree, "HEAD")?;
    if head_after != head_before || merge_in_progress(&worktree)? {
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

fn conflict_outcome(
    target_branch: &str,
    conflict_files: Vec<String>,
    detail: &str,
) -> WorktreeUpdateOutcome {
    WorktreeUpdateOutcome {
        success: false,
        conflicted: true,
        conflict_files,
        message: format!(
            "Rilevati conflitti durante l'aggiornamento da '{target_branch}': {detail}"
        ),
    }
}

fn validate_message(strategy: IntegrateStrategy, message: &str) -> Result<String, WorktreeError> {
    if message.contains('\0') || message.len() > MAX_MESSAGE_BYTES {
        return Err(WorktreeError::new(
            WorktreeErrorCode::MessageInvalid,
            "Il messaggio di commit non e' utilizzabile",
        ));
    }
    let trimmed = message.trim();
    if strategy == IntegrateStrategy::Squash && trimmed.is_empty() {
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

fn sync_checkout(
    root: &Path,
    target_branch: &str,
    from_sha: &str,
    to_sha: &str,
) -> Result<(), WorktreeError> {
    if attached_branch(root)?.as_deref() != Some(target_branch) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' piu' sul branch target",
        ));
    }
    if resolve_commit(root, "HEAD")? == to_sha && porcelain_files(root)?.is_empty() {
        return Ok(());
    }
    if !worktree_matches_commit(root, from_sha)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetDirty,
            "Il checkout target e' cambiato durante l'integrazione",
        ));
    }
    reset_hard(root, to_sha)?;
    if resolve_commit(root, "HEAD")? != to_sha || !porcelain_files(root)?.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "Il checkout target non coincide con il commit di integrazione",
        ));
    }
    Ok(())
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

fn preflight_clean(
    context: &super::RepositoryContext,
    worktree: &Path,
    target_branch: &str,
    expected_target: &str,
    expected_lane: &str,
) -> Result<(), WorktreeError> {
    if attached_branch(&context.repository_root)?.as_deref() != Some(target_branch) {
        return Err(WorktreeError::new(
            WorktreeErrorCode::CheckoutMismatch,
            "Il checkout principale non e' sul branch di destinazione",
        ));
    }
    let target_head = resolve_commit(&context.repository_root, "HEAD")?;
    let branch_head = resolve_commit(
        &context.repository_root,
        &format!("refs/heads/{target_branch}"),
    )?;
    if target_head != expected_target || branch_head != expected_target {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetMoved,
            "Lo SHA del target non coincide piu' con quello confermato",
        ));
    }
    if !porcelain_files(&context.repository_root)?.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetDirty,
            "Il branch target ha modifiche non committate",
        ));
    }
    if !unmerged_paths(&context.repository_root)?.is_empty()
        || !unmerged_paths(worktree)?.is_empty()
    {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConflictsPresent,
            "Ci sono conflitti non risolti",
        ));
    }
    let lane_head = resolve_commit(worktree, "HEAD")?;
    if lane_head != expected_lane {
        return Err(WorktreeError::new(
            WorktreeErrorCode::LaneMoved,
            "Lo SHA della corsia non coincide piu' con quello confermato",
        ));
    }
    if !porcelain_files(worktree)?.is_empty() {
        return Err(WorktreeError::new(
            WorktreeErrorCode::LaneDirty,
            "La corsia ha modifiche o file non tracciati: il commit deve essere pulito",
        ));
    }
    Ok(())
}

pub(crate) fn integrate_sync(
    args: WorktreeIntegrateArgs,
) -> Result<WorktreeIntegrateOutcome, WorktreeError> {
    let _lock = mutation_lock()?;
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
    live_processes(&worktree)?;
    let message = validate_message(args.strategy, &args.message)?;
    let expected_target = require_explicit_sha(
        &args.expected_target_sha,
        WorktreeErrorCode::TargetMoved,
        "Lo SHA target confermato deve essere completo",
    )?;
    let expected_lane = require_explicit_sha(
        &args.expected_lane_sha,
        WorktreeErrorCode::LaneMoved,
        "Lo SHA della corsia confermato deve essere completo",
    )?;
    let current_lane = resolve_commit(&worktree, "HEAD")?;
    let current_target = resolve_commit(
        &context.repository_root,
        &format!("refs/heads/{target_branch}"),
    )?;

    if let Some(receipt) = receipt_on_target(&context, &lane_branch, &target_branch, &current_lane)?
    {
        if receipt.source == current_lane {
            return Ok(WorktreeIntegrateOutcome {
                phase: IntegratePhase::AlreadyIntegrated,
                commit: receipt.commit,
                target_branch,
                strategy: receipt.strategy,
            });
        }
        if expected_target != current_target || expected_lane != current_lane {
            return Err(WorktreeError::new(
                WorktreeErrorCode::LaneDivergedAfterIntegrate,
                "L'integrazione precedente e' gia' sul target e la corsia ha commit nuovi non confermati",
            ));
        }
    }

    preflight_clean(
        &context,
        &worktree,
        &target_branch,
        &expected_target,
        &expected_lane,
    )?;
    if !is_ancestor(&context.repository_root, &expected_target, &expected_lane)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::TargetAdvanced,
            "Il target e' avanzato: va aggiornata la corsia, il branch di destinazione non viene toccato",
        ));
    }

    let new_commit = match args.strategy {
        IntegrateStrategy::Squash => {
            let lane_tree = resolve_tree(&worktree, &expected_lane)?;
            let target_tree = resolve_tree(&context.repository_root, &expected_target)?;
            if lane_tree == target_tree {
                return Err(WorktreeError::new(
                    WorktreeErrorCode::NothingToIntegrate,
                    "La corsia non contiene modifiche rispetto al target",
                ));
            }
            commit_tree(
                &context.repository_root,
                &lane_tree,
                &expected_target,
                &squash_message(&message, &lane_id, &expected_lane),
            )?
        }
        IntegrateStrategy::Preserve => {
            if expected_lane == expected_target {
                return Err(WorktreeError::new(
                    WorktreeErrorCode::NothingToIntegrate,
                    "La corsia non contiene commit da conservare",
                ));
            }
            expected_lane.clone()
        }
    };

    preflight_clean(
        &context,
        &worktree,
        &target_branch,
        &expected_target,
        &expected_lane,
    )?;
    update_ref(
        &context.repository_root,
        &target_branch,
        &new_commit,
        &expected_target,
    )?;
    let receipt = IntegrationReceipt {
        commit: new_commit.clone(),
        source: expected_lane.clone(),
        strategy: args.strategy,
    };
    if let Err(error) = write_receipt(&context, &lane_branch, &receipt) {
        let _ = rollback_ref(
            &context,
            &lane_branch,
            &target_branch,
            &expected_target,
            &new_commit,
        );
        return Err(error);
    }
    if let Err(error) = sync_checkout(
        &context.repository_root,
        &target_branch,
        &expected_target,
        &new_commit,
    ) {
        if rollback_ref(
            &context,
            &lane_branch,
            &target_branch,
            &expected_target,
            &new_commit,
        )
        .is_ok()
        {
            return Err(WorktreeError::with_detail(
                WorktreeErrorCode::GitCommandFailed,
                "Integrazione annullata senza modificare il target",
                error.message,
            ));
        }
        return Err(WorktreeError::with_detail(
            WorktreeErrorCode::CheckoutSyncFailed,
            "Il commit e' sul target ma il checkout non e' allineato: il tentativo successivo non crea un altro merge",
            error.message,
        ));
    }

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
    if args.strategy == IntegrateStrategy::Squash
        && resolve_tree(&context.repository_root, &new_commit)?
            != resolve_tree(&worktree, &expected_lane)?
    {
        return Err(WorktreeError::new(
            WorktreeErrorCode::GitCommandFailed,
            "L'albero del commit squash non coincide con la corsia",
        ));
    }

    Ok(WorktreeIntegrateOutcome {
        phase: IntegratePhase::Integrated,
        commit: new_commit,
        target_branch,
        strategy: args.strategy,
    })
}

fn branch_checked_out(
    context: &super::RepositoryContext,
    branch: &str,
) -> Result<bool, WorktreeError> {
    Ok(super::porcelain_worktrees(context)?
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(branch)))
}

pub(crate) fn delete_lane_branch_sync(args: DeleteLaneBranchArgs) -> Result<(), WorktreeError> {
    let _lock = mutation_lock()?;
    if !args.confirm {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConfirmationRequired,
            "L'eliminazione del branch richiede una conferma distinta",
        ));
    }
    let context = discover_repository(&args.project_path)?;
    let lane_id = validate_lane_id(&args.lane_id)?;
    let branch = format!("{LANE_BRANCH_PREFIX}{lane_id}");
    if !super::branch_exists(&context, &branch)? {
        return Ok(());
    }
    if branch_checked_out(&context, &branch)? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::WorktreeInUse,
            "Il branch e' ancora checked out: nessun force e' stato usato",
        ));
    }
    let Some(receipt) = read_config_receipt(&context, &branch)? else {
        return Err(WorktreeError::new(
            WorktreeErrorCode::ConfirmationRequired,
            "Il branch non ha un'integrazione riconosciuta e non viene forzato",
        ));
    };
    let tip = resolve_commit(&context.repository_root, &format!("refs/heads/{branch}"))?;
    if tip != receipt.source {
        return Err(WorktreeError::new(
            WorktreeErrorCode::LaneDivergedAfterIntegrate,
            "Il branch contiene commit non compresi nell'integrazione e non viene forzato",
        ));
    }
    let target = super::config_get(&context, &branch, "ompStudioTargetBranch")?
        .unwrap_or_else(|| "main".to_string());
    if !is_ancestor(
        &context.repository_root,
        &receipt.commit,
        &format!("refs/heads/{target}"),
    )? {
        return Err(WorktreeError::new(
            WorktreeErrorCode::LaneDivergedAfterIntegrate,
            "Il commit di integrazione non e' sul target: il branch non viene eliminato",
        ));
    }

    let deleted = run_git(
        &context.repository_root,
        &git_args(&["branch", "-d", &branch]),
    )?;
    if deleted.status.success() {
        return Ok(());
    }
    // `-D` solo sul tip appena integrato. Lo squash non risulta "merged" per
    // Git, ma l'albero e' quello del receipt: non e' lavoro sconosciuto.
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
