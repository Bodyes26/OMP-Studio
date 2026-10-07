use serde::{Deserialize, Serialize};
use std::io::Read;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUpstreamStatus {
    pub is_git: bool,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub incoming_commits: Vec<CommitSummary>,
    pub outgoing_commits: Vec<CommitSummary>,
    pub has_uncommitted: bool,
}

fn run_git_in(dir: &Path, args: &[&str]) -> Result<String, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .map_err(|e| format!("Esecuzione git {:?}: {e}", args))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Esito grezzo di un comando git: serve quando anche un exit 0 va interpretato
/// (l'autostash che non si riapplica non cambia il codice di uscita).
struct GitRawOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

impl GitRawOutput {
    fn combined(&self) -> String {
        let mut text = self.stdout.trim().to_string();
        let err = self.stderr.trim();
        if !err.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(err);
        }
        text
    }
}

/// Esegue git con messaggi in inglese (LC_ALL/LANGUAGE=C): l'output viene
/// analizzato per riconoscere l'autostash non riapplicato, e una traduzione
/// locale di git renderebbe il controllo inaffidabile.
fn run_git_raw(dir: &Path, args: &[&str]) -> Result<GitRawOutput, String> {
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(args);
    cmd.env("LC_ALL", "C");
    cmd.env("LANGUAGE", "C");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.stdin(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd
        .output()
        .map_err(|e| format!("Esecuzione git {:?}: {e}", args))?;
    Ok(GitRawOutput {
        success: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}

/// Hash della cima di refs/stash (None se lo stash e' vuoto). Confrontarlo prima e
/// dopo il pull dice, indipendentemente dalla lingua di git, se l'autostash e'
/// finito nello stash invece di tornare nel working tree.
fn stash_top(dir: &Path) -> Option<String> {
    run_git_in(dir, &["rev-parse", "-q", "--verify", "refs/stash"])
        .ok()
        .filter(|hash| !hash.is_empty())
}

/// Vero se nella gitdir del worktree e' rimasto un rebase interrotto.
/// `--git-path` risolve la gitdir giusta anche per i worktree collegati.
fn rebase_in_progress(dir: &Path) -> bool {
    ["rebase-merge", "rebase-apply"].iter().any(|name| {
        run_git_in(dir, &["rev-parse", "--git-path", name])
            .map(|raw| {
                let candidate = Path::new(raw.trim());
                let full = if candidate.is_absolute() {
                    candidate.to_path_buf()
                } else {
                    dir.join(candidate)
                };
                full.exists()
            })
            .unwrap_or(false)
    })
}

fn autostash_left_in_stash(output: &str) -> bool {
    output.contains("Applying autostash resulted in conflicts")
        || output.contains("Your changes are safe in the stash")
}

const PULL_CONFLICT_ABORTED: &str =
    "Pull annullato: conflitto con il remoto. Le tue modifiche locali sono intatte.";
const AUTOSTASH_IN_STASH: &str = "Pull completato, ma le tue modifiche locali non si sono riapplicate senza conflitti: sono al sicuro nello stash di git (vedi `git stash list`). Recuperale con `git stash pop` dopo aver risolto i conflitti.";

/// Pull con rebase che non perde mai lavoro locale.
///
/// Lo stash manuale (`stash push` + `stash pop`) era pericoloso: con soli file non
/// tracciati `stash push` non crea nulla e il `pop` successivo applicava uno stash
/// preesistente dell'utente; con un conflitto il pop falliva in silenzio. Con
/// `--autostash` git salva solo cio' che ha messo da parte lui e, se non riesce a
/// riapplicarlo, lo lascia nello stash. Un rebase rimasto a meta' viene annullato,
/// cosi' il repository torna esattamente com'era prima del pull.
fn pull_rebase_autostash(dir: &Path) -> Result<String, String> {
    // Un rebase gia' in corso e' dell'utente: annullarlo dopo il pull fallito
    // butterebbe via i conflitti che sta risolvendo.
    if rebase_in_progress(dir) {
        return Err(
            "Pull non eseguito: nel repository c'è già un rebase in corso. Completalo o annullalo prima di sincronizzare."
                .to_string(),
        );
    }
    let stash_before = stash_top(dir);
    let pull = run_git_raw(dir, &["pull", "--rebase", "--autostash"])?;
    let pull_text = pull.combined();

    if !pull.success {
        if rebase_in_progress(dir) {
            let abort = run_git_raw(dir, &["rebase", "--abort"])?;
            if !abort.success || rebase_in_progress(dir) {
                return Err(format!(
                    "Pull interrotto da un conflitto e annullamento del rebase non riuscito: risolvi i conflitti o esegui `git rebase --abort` nel repository.\n{}\n{}",
                    pull_text,
                    abort.combined()
                ));
            }
            if autostash_left_in_stash(&abort.combined()) || stash_top(dir) != stash_before {
                return Err(format!(
                    "Pull annullato: conflitto con il remoto. Le tue modifiche locali non si sono riapplicate e sono al sicuro nello stash di git (vedi `git stash list`).\n{pull_text}"
                ));
            }
            return Err(format!("{PULL_CONFLICT_ABORTED}\n{pull_text}"));
        }
        if autostash_left_in_stash(&pull_text) || stash_top(dir) != stash_before {
            return Err(format!(
                "Pull non riuscito. Le tue modifiche locali sono al sicuro nello stash di git (vedi `git stash list`).\n{pull_text}"
            ));
        }
        return Err(if pull_text.is_empty() {
            "Pull non riuscito".to_string()
        } else {
            pull_text
        });
    }

    if autostash_left_in_stash(&pull_text) || stash_top(dir) != stash_before {
        return Err(format!("{AUTOSTASH_IN_STASH}\n{pull_text}"));
    }

    let stdout = pull.stdout.trim();
    Ok(if stdout.is_empty() {
        "Pull completato".to_string()
    } else {
        stdout.to_string()
    })
}

fn append_batch_mode_flag(cmd: &str) -> String {
    let lower = cmd.to_lowercase();
    // Se ha già BatchMode=yes o -batch (plink/tortoise), non duplicare
    if lower.contains("batchmode=yes") || lower.contains("-batch") {
        return cmd.to_string();
    }

    if lower.contains("plink") {
        format!("{cmd} -batch")
    } else {
        format!("{cmd} -o BatchMode=yes")
    }
}

fn resolve_ssh_batch_command(dir: &Path) -> String {
    // 1. Controlla la variabile d'ambiente GIT_SSH_COMMAND
    let env_ssh_cmd = std::env::var("GIT_SSH_COMMAND").ok().and_then(|val| {
        let trimmed = val.trim().to_string();
        if !trimmed.is_empty() {
            Some(trimmed)
        } else {
            None
        }
    });

    // 2. Se assente, controlla la configurazione git core.sshCommand (locale o globale)
    let git_cfg_ssh = env_ssh_cmd.or_else(|| {
        run_git_in(dir, &["config", "--get", "core.sshCommand"])
            .ok()
            .and_then(|val| {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    Some(trimmed)
                } else {
                    None
                }
            })
    });

    // 3. Se assente, controlla GIT_SSH
    let base_cmd = git_cfg_ssh.or_else(|| {
        std::env::var("GIT_SSH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|path| format!("\"{path}\""))
    });

    match base_cmd {
        Some(cmd) => append_batch_mode_flag(&cmd),
        None => "ssh -o BatchMode=yes".to_string(),
    }
}

fn run_git_fetch_background_with_timeout(dir: &Path, timeout: Duration) -> Result<String, String> {
    let ssh_cmd = resolve_ssh_batch_command(dir);
    let ssh_cfg_arg = format!("core.sshCommand={ssh_cmd}");
    let args = ["-c", &ssh_cfg_arg, "fetch", "--prune"];
    let _span = crate::perf_trace::span("git", crate::perf_trace::command_label("git", args));

    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "Never");
    cmd.env("GIT_SSH_COMMAND", &ssh_cmd);
    cmd.env("GIT_ASKPASS", "");
    cmd.env("SSH_ASKPASS", "");
    cmd.env("SSH_ASKPASS_REQUIRE", "never");
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Esecuzione git fetch in background fallita: {e}"))?;

    let pid = child.id();
    #[cfg(target_os = "windows")]
    let job = crate::process_tree::WindowsJob::create_for_process(pid).ok();

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let (stdout_tx, stdout_rx) = mpsc::channel();
    let (stderr_tx, stderr_rx) = mpsc::channel();

    let _stdout_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stdout_tx.send(buf);
    });

    let _stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = stderr_tx.send(buf);
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    #[cfg(target_os = "windows")]
                    crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
                    #[cfg(not(target_os = "windows"))]
                    crate::process_tree::kill_process_tree(Some(pid));
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                #[cfg(target_os = "windows")]
                crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
                #[cfg(not(target_os = "windows"))]
                crate::process_tree::kill_process_tree(Some(pid));
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Attesa processo git fetch in background fallita: {e}"
                ));
            }
        }
    };

    if timed_out {
        return Err(format!(
            "Operazione git fetch in background terminata per timeout ({}s)",
            timeout.as_secs()
        ));
    }

    let status = status.ok_or_else(|| "Processo git terminato in modo anomalo".to_string())?;

    // Un helper che eredita i pipe non deve trasformare un fetch fallito in un successo.
    let drain_timeout =
        Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now()));
    let output = stdout_rx.recv_timeout(drain_timeout).and_then(|stdout| {
        let remaining =
            Duration::from_secs(3).min(deadline.saturating_duration_since(Instant::now()));
        stderr_rx
            .recv_timeout(remaining)
            .map(|stderr| (stdout, stderr))
    });
    let (stdout_bytes, stderr_bytes) = match output {
        Ok(output) => output,
        Err(error) => {
            #[cfg(target_os = "windows")]
            crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
            #[cfg(not(target_os = "windows"))]
            crate::process_tree::kill_process_tree(Some(pid));
            return Err(format!(
                "Lettura output git fetch in background fallita: {error}"
            ));
        }
    };

    if !status.success() {
        let err = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
        let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }

    let out = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
    Ok(if out.is_empty() {
        "Fetch completato con successo".to_string()
    } else {
        out
    })
}

fn run_git_fetch_background(dir: &Path) -> Result<String, String> {
    const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
    run_git_fetch_background_with_timeout(dir, DEFAULT_TIMEOUT)
}

fn parse_commit_log(raw: &str) -> Vec<CommitSummary> {
    let mut list = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() >= 5 {
            list.push(CommitSummary {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                subject: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            });
        }
    }
    list
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GitPorcelainV2BranchInfo {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub has_uncommitted: bool,
}

/// Parsing di `git status --porcelain=v2 --branch`.
/// Le righe header iniziano con '# ':
/// - '# branch.head <head>' indica il branch corrente o '(detached)'
/// - '# branch.upstream <upstream>' indica il branch remoto tracciato
/// - '# branch.ab +<ahead> -<behind>' indica il disallineamento numerico
/// Qualsiasi riga non vuota che non inizi con '#' rappresenta modifiche
/// al working tree (modificati, untracked, conflitti, rinomine).
pub(crate) fn parse_porcelain_v2_branch(raw: &str) -> GitPorcelainV2BranchInfo {
    let mut branch = String::new();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut has_uncommitted = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix('#') {
            let header = rest.trim_start();
            if let Some(b) = header.strip_prefix("branch.head ") {
                branch = b.trim().to_string();
            } else if let Some(u) = header.strip_prefix("branch.upstream ") {
                let u_clean = u.trim();
                if !u_clean.is_empty() {
                    upstream = Some(u_clean.to_string());
                }
            } else if let Some(ab) = header.strip_prefix("branch.ab ") {
                for part in ab.split_whitespace() {
                    if let Some(a) = part.strip_prefix('+') {
                        ahead = a.parse::<u32>().unwrap_or(0);
                    } else if let Some(b) = part.strip_prefix('-') {
                        behind = b.parse::<u32>().unwrap_or(0);
                    }
                }
            }
        } else {
            // Qualsiasi voce fuori dagli header (#) segnala file modificati,
            // aggiunti, rimossi o untracked nel working tree
            has_uncommitted = true;
        }
    }

    if branch.is_empty() {
        branch = "HEAD".to_string();
    }

    GitPorcelainV2BranchInfo {
        branch,
        upstream,
        ahead,
        behind,
        has_uncommitted,
    }
}

#[tauri::command]
pub async fn git_upstream_status(project_path: String) -> Result<GitUpstreamStatus, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&project_path);
        if !path.exists() {
            return Err(format!("Percorso '{project_path}' non trovato"));
        }

        // Singolo spawn git: `status --porcelain=v2 --branch` restituisce
        // in una sola chiamata se il path e' un repo git, il branch corrente,
        // l'upstream, ahead/behind e la presenza di modifiche locali.
        // Riduce da 5 a 1 i processi git creati ogni ciclo di polling.
        let status_raw = match run_git_in(path, &["status", "--porcelain=v2", "--branch"]) {
            Ok(out) => out,
            Err(_) => {
                return Ok(GitUpstreamStatus {
                    is_git: false,
                    branch: String::new(),
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    incoming_commits: Vec::new(),
                    outgoing_commits: Vec::new(),
                    has_uncommitted: false,
                });
            }
        };

        let parsed = parse_porcelain_v2_branch(&status_raw);
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();

        if parsed.upstream.is_some() {
            // Se ci sono commit incoming
            if parsed.behind > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) =
                    run_git_in(path, &["log", format_arg, "HEAD..@{u}", "-n", "10"])
                {
                    incoming = parse_commit_log(&raw_log);
                }
            }

            // Se ci sono commit outgoing
            if parsed.ahead > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) =
                    run_git_in(path, &["log", format_arg, "@{u}..HEAD", "-n", "10"])
                {
                    outgoing = parse_commit_log(&raw_log);
                }
            }
        }

        Ok(GitUpstreamStatus {
            is_git: true,
            branch: parsed.branch,
            upstream: parsed.upstream,
            ahead: parsed.ahead,
            behind: parsed.behind,
            incoming_commits: incoming,
            outgoing_commits: outgoing,
            has_uncommitted: parsed.has_uncommitted,
        })
    })
    .await
    .map_err(|e| format!("Task upstream status: {e}"))?
}


#[tauri::command]
pub async fn git_sync_repo(project_path: String, action: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&project_path);
        if !path.exists() {
            return Err(format!("Percorso '{project_path}' non trovato"));
        }

        let act = action.trim().to_lowercase();
        match act.as_str() {
            "fetch" => {
                run_git_in(path, &["fetch", "--prune"])?;
                Ok("Fetch completato con successo".to_string())
            }
            "fetch-background" => run_git_fetch_background(path),
            "pull-ff" => {
                // Rifiuta modifiche non committate o file non tracciati (fail closed su errore git status)
                let status_out = run_git_in(path, &["status", "--porcelain"])
                    .map_err(|e| format!("Impossibile verificare lo stato del repository: {e}"))?;
                if !status_out.trim().is_empty() {
                    return Err(
                        "Impossibile eseguire il pull: sono presenti modifiche locali non salvate o file non tracciati"
                            .to_string(),
                    );
                }

                let pull_res = run_git_in(
                    path,
                    &[
                        "-c",
                        "rebase.autoStash=false",
                        "-c",
                        "merge.autoStash=false",
                        "pull",
                        "--ff-only",
                    ],
                );

                pull_res.map(|msg| {
                    if msg.is_empty() {
                        "Pull completato".to_string()
                    } else {
                        msg
                    }
                })
            }
            "pull" => pull_rebase_autostash(path),
            "push" => {
                let push_res = run_git_in(path, &["push"])?;
                Ok(if push_res.is_empty() {
                    "Push completato con successo".to_string()
                } else {
                    push_res
                })
            }
            "sync" => {
                // 1. Fetch
                let _ = run_git_in(path, &["fetch", "--prune"]);

                // 2. Pull con rebase: se non e' riuscito del tutto (anche solo
                // l'autostash rimasto nello stash) non si pubblica nulla.
                pull_rebase_autostash(path)?;

                // 3. Push
                let push_res = run_git_in(path, &["push"])?;
                Ok(format!("Sincronizzazione completata: {push_res}"))
            }
            _ => Err(format!(
                "Azione di sincronizzazione sconosciuta: '{action}'"
            )),
        }
    })
    .await
    .map_err(|e| format!("Task git sync: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn test_append_batch_mode_flag_preserves_custom_ssh() {
        assert_eq!(
            append_batch_mode_flag("ssh -i ~/.ssh/id_rsa"),
            "ssh -i ~/.ssh/id_rsa -o BatchMode=yes"
        );
        assert_eq!(
            append_batch_mode_flag("ssh -o BatchMode=yes -i ~/.ssh/id_rsa"),
            "ssh -o BatchMode=yes -i ~/.ssh/id_rsa"
        );
        assert_eq!(
            append_batch_mode_flag("plink.exe -i key.ppk"),
            "plink.exe -i key.ppk -batch"
        );
        assert_eq!(
            append_batch_mode_flag("plink.exe -batch -i key.ppk"),
            "plink.exe -batch -i key.ppk"
        );
    }

    fn run_git_test_cmd(cwd: &Path, args: &[&str]) -> std::process::Output {
        let mut command = Command::new("git");
        command.current_dir(cwd).args(args);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .output()
            .expect("git deve essere disponibile nell'ambiente di test");
        assert!(
            output.status.success(),
            "git {:?} fallito in {:?}:\nstdout: {}\nstderr: {}",
            args,
            cwd,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    struct TestGitSetup {
        container: PathBuf,
        work_a: PathBuf,
        work_b: PathBuf,
    }

    impl Drop for TestGitSetup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.container);
        }
    }

    fn init_configured_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        run_git_test_cmd(path, &["init"]);
        run_git_test_cmd(path, &["config", "user.name", "OMP Studio Test"]);
        run_git_test_cmd(path, &["config", "user.email", "test@coldiretti.invalid"]);
        run_git_test_cmd(path, &["config", "commit.gpgsign", "false"]);
        run_git_test_cmd(path, &["config", "core.autocrlf", "false"]);
    }

    fn setup_test_repos() -> TestGitSetup {
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let container = std::env::temp_dir().join(format!(
            "omp-studio-sync-test-{}-{}-{}",
            std::process::id(),
            seq,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&container);
        fs::create_dir_all(&container).unwrap();

        let remote_bare = container.join("remote.git");
        fs::create_dir_all(&remote_bare).unwrap();
        run_git_test_cmd(&remote_bare, &["init", "--bare"]);

        let work_a = container.join("work_a");
        init_configured_repo(&work_a);
        fs::write(work_a.join("initial.txt"), "v1\n").unwrap();
        run_git_test_cmd(&work_a, &["add", "."]);
        run_git_test_cmd(&work_a, &["commit", "-m", "initial commit"]);
        run_git_test_cmd(&work_a, &["branch", "-M", "main"]);

        let remote_str = remote_bare.to_str().unwrap();
        run_git_test_cmd(&work_a, &["remote", "add", "origin", remote_str]);
        run_git_test_cmd(&work_a, &["push", "-u", "origin", "main"]);
        run_git_test_cmd(&remote_bare, &["symbolic-ref", "HEAD", "refs/heads/main"]);

        let work_b = container.join("work_b");
        run_git_test_cmd(
            &container,
            &["-c", "core.autocrlf=false", "clone", remote_str, "work_b"],
        );
        run_git_test_cmd(&work_b, &["config", "user.name", "OMP Studio Test"]);
        run_git_test_cmd(
            &work_b,
            &["config", "user.email", "test@coldiretti.invalid"],
        );
        run_git_test_cmd(&work_b, &["config", "commit.gpgsign", "false"]);
        run_git_test_cmd(&work_b, &["config", "core.autocrlf", "false"]);

        TestGitSetup {
            container,
            work_a,
            work_b,
        }
    }

    #[tokio::test]
    async fn test_detect_remote_advancement_only_after_background_fetch() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // 1. Commit e push su work_a
        fs::write(setup.work_a.join("feature.txt"), "feature content\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "feat: new remote commit"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // 2. Prima del fetch, work_b non vede il commit remoto
        let status_before = git_upstream_status(path_b_str.clone()).await.unwrap();
        assert_eq!(
            status_before.behind, 0,
            "Non deve vedere commit incoming prima del fetch"
        );
        assert!(status_before.incoming_commits.is_empty());

        // 3. Esegui fetch-background
        let fetch_res = git_sync_repo(path_b_str.clone(), "fetch-background".to_string()).await;
        assert!(
            fetch_res.is_ok(),
            "fetch-background deve avere successo: {:?}",
            fetch_res
        );

        // 4. Dopo il fetch in background, work_b rileva l'avanzamento del remote
        let status_after = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(
            status_after.behind, 1,
            "Deve vedere 1 commit incoming dopo fetch-background"
        );
        assert_eq!(status_after.incoming_commits.len(), 1);
        assert_eq!(
            status_after.incoming_commits[0].subject,
            "feat: new remote commit"
        );
    }

    #[tokio::test]
    async fn test_successful_clean_ff_pull() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Commit su work_a e push su remote
        fs::write(setup.work_a.join("new_file.txt"), "clean fast forward\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "feat: pull me"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // Fetch background per aggiornare refs
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        // Esegui pull-ff con albero pulito
        let pull_res = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(
            pull_res.is_ok(),
            "pull-ff su albero pulito deve riuscire: {:?}",
            pull_res
        );

        // Verifica che il file esista e il contenuto sia corretto
        assert!(setup.work_b.join("new_file.txt").exists());
        assert_eq!(
            fs::read_to_string(setup.work_b.join("new_file.txt")).unwrap(),
            "clean fast forward\n"
        );

        // Verifica che lo stato upstream sia allineato
        let status = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(status.behind, 0);
        assert_eq!(status.ahead, 0);
    }

    #[tokio::test]
    async fn test_dirty_and_untracked_refusal_preserving_files() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Commit su work_a e push su remote
        fs::write(setup.work_a.join("remote_file.txt"), "from remote\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "remote commit"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // Fetch background
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        // CASO 1: File non tracciato
        let untracked_path = setup.work_b.join("untracked_file.txt");
        fs::write(&untracked_path, "precious untracked data").unwrap();

        let pull_err = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(
            pull_err.is_err(),
            "pull-ff deve fallire in presenza di file untracked"
        );
        assert!(
            untracked_path.exists(),
            "Il file non tracciato deve essere preservato"
        );
        assert_eq!(
            fs::read_to_string(&untracked_path).unwrap(),
            "precious untracked data"
        );

        // Puliamo il file non tracciato per testare la modifica a un file tracciato
        fs::remove_file(&untracked_path).unwrap();

        // CASO 2: Modifica non committata a file tracciato
        let tracked_path = setup.work_b.join("initial.txt");
        fs::write(&tracked_path, "modified locally without commit\n").unwrap();

        let pull_err2 = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(
            pull_err2.is_err(),
            "pull-ff deve fallire in presenza di modifiche uncommitted"
        );
        assert_eq!(
            fs::read_to_string(&tracked_path).unwrap(),
            "modified locally without commit\n",
            "Il file tracciato modificato deve preservare il contenuto locale"
        );
    }

    #[tokio::test]
    async fn test_divergence_refusal_preserving_head() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // 1. Commit su work_a e push su remote (commit X)
        fs::write(setup.work_a.join("commit_x.txt"), "commit X on remote\n").unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", "commit X"]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);

        // 2. Commit divergente locale su work_b (commit Y)
        fs::write(setup.work_b.join("commit_y.txt"), "commit Y locally\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "."]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "commit Y"]);

        // Albero di lavoro in work_b è pulito (tutto committato), ma diverso da upstream
        let head_before = run_git_in(&setup.work_b, &["rev-parse", "HEAD"]).unwrap();

        // 3. fetch-background rileva la divergenza
        git_sync_repo(path_b_str.clone(), "fetch-background".to_string())
            .await
            .unwrap();

        let status = git_upstream_status(path_b_str.clone()).await.unwrap();
        assert_eq!(status.ahead, 1, "Deve essere ahead di 1");
        assert_eq!(status.behind, 1, "Deve essere behind di 1");

        // 4. pull-ff deve rifiutare perché non è un fast-forward
        let pull_res = git_sync_repo(path_b_str.clone(), "pull-ff".to_string()).await;
        assert!(pull_res.is_err(), "pull-ff deve rifiutare rami divergenti");

        // 5. Verifica che HEAD sia preservato inalterato
        let head_after = run_git_in(&setup.work_b, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(
            head_before, head_after,
            "HEAD deve essere rigorosamente preservato"
        );
        assert!(
            setup.work_b.join("commit_y.txt").exists(),
            "I commit locali devono restare intatti"
        );
    }

    fn push_remote_change(setup: &TestGitSetup, file: &str, content: &str, message: &str) {
        fs::write(setup.work_a.join(file), content).unwrap();
        run_git_test_cmd(&setup.work_a, &["add", "."]);
        run_git_test_cmd(&setup.work_a, &["commit", "-m", message]);
        run_git_test_cmd(&setup.work_a, &["push", "origin", "main"]);
    }

    fn stash_list(dir: &Path) -> String {
        String::from_utf8_lossy(
            &run_git_test_cmd(dir, &["stash", "list", "--format=%H %gs"]).stdout,
        )
        .trim()
        .to_string()
    }

    #[tokio::test]
    async fn test_pull_with_only_untracked_keeps_preexisting_stash() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Stash preesistente dell'utente su work_b
        fs::write(setup.work_b.join("initial.txt"), "lavoro parcheggiato\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["stash", "push", "-m", "stash utente"]);
        let stash_before = stash_list(&setup.work_b);
        assert!(stash_before.contains("stash utente"));

        push_remote_change(&setup, "remote.txt", "dal remoto\n", "remote commit");

        // Solo un file non tracciato: il vecchio stash manuale non creava nulla e
        // il pop applicava lo stash dell'utente.
        let untracked = setup.work_b.join("bozza.txt");
        fs::write(&untracked, "non tracciato\n").unwrap();

        let res = git_sync_repo(path_b_str, "pull".to_string()).await;
        assert!(res.is_ok(), "pull deve riuscire: {res:?}");

        assert_eq!(
            stash_list(&setup.work_b),
            stash_before,
            "lo stash utente deve restare intatto"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "v1\n",
            "lo stash utente non deve essere applicato"
        );
        assert_eq!(fs::read_to_string(&untracked).unwrap(), "non tracciato\n");
        assert!(setup.work_b.join("remote.txt").exists());
    }

    #[tokio::test]
    async fn test_pull_preserves_tracked_changes() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "remote.txt", "dal remoto\n", "remote commit");

        // Commit locale divergente + modifica tracciata non committata su un altro file
        fs::write(setup.work_b.join("local.txt"), "commit locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "."]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "local commit"]);
        fs::write(setup.work_b.join("initial.txt"), "v1 modificato\n").unwrap();

        let res = git_sync_repo(path_b_str.clone(), "pull".to_string()).await;
        assert!(res.is_ok(), "pull deve riuscire: {res:?}");

        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "v1 modificato\n"
        );
        assert!(setup.work_b.join("remote.txt").exists());
        assert!(setup.work_b.join("local.txt").exists());
        assert!(
            stash_list(&setup.work_b).is_empty(),
            "l'autostash non deve restare nello stash"
        );
        let status = git_upstream_status(path_b_str).await.unwrap();
        assert_eq!(status.behind, 0);
        assert_eq!(status.ahead, 1);
    }

    #[tokio::test]
    async fn test_pull_conflict_aborts_rebase_and_restores_tree() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");

        // Commit locale in conflitto con il remoto + modifica non committata
        fs::write(setup.work_b.join("initial.txt"), "versione locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["commit", "-am", "local edit"]);
        fs::write(setup.work_b.join("other.txt"), "tracciato\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["add", "other.txt"]);
        run_git_test_cmd(&setup.work_b, &["commit", "-m", "other"]);
        fs::write(setup.work_b.join("other.txt"), "modifica in corso\n").unwrap();
        fs::write(setup.work_b.join("untracked.txt"), "nuovo\n").unwrap();
        let head_before = run_git_in(&setup.work_b, &["rev-parse", "HEAD"]).unwrap();

        let res = git_sync_repo(path_b_str.clone(), "pull".to_string()).await;
        let err = res.expect_err("il pull in conflitto deve fallire");
        assert!(
            err.starts_with(PULL_CONFLICT_ABORTED),
            "messaggio inatteso: {err}"
        );

        assert!(
            !rebase_in_progress(&setup.work_b),
            "il rebase deve essere annullato"
        );
        assert_eq!(
            run_git_in(&setup.work_b, &["rev-parse", "HEAD"]).unwrap(),
            head_before
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("initial.txt")).unwrap(),
            "versione locale\n"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("other.txt")).unwrap(),
            "modifica in corso\n"
        );
        assert_eq!(
            fs::read_to_string(setup.work_b.join("untracked.txt")).unwrap(),
            "nuovo\n"
        );
        assert!(stash_list(&setup.work_b).is_empty());

        // sync non deve pubblicare nulla se il pull fallisce
        let remote_head = run_git_in(&setup.work_a, &["rev-parse", "HEAD"]).unwrap();
        let sync = git_sync_repo(path_b_str, "sync".to_string()).await;
        assert!(sync.is_err());
        let remote_after = run_git_in(&setup.work_b, &["rev-parse", "origin/main"]).unwrap();
        assert_eq!(
            remote_after, remote_head,
            "sync non deve fare push dopo un pull fallito"
        );
    }

    #[tokio::test]
    async fn test_pull_does_not_abort_user_rebase() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        // Rebase dell'utente fermo su un conflitto
        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");
        fs::write(setup.work_b.join("initial.txt"), "versione locale\n").unwrap();
        run_git_test_cmd(&setup.work_b, &["commit", "-am", "local edit"]);
        run_git_test_cmd(&setup.work_b, &["fetch"]);
        let rebase = Command::new("git")
            .current_dir(&setup.work_b)
            .args(["rebase", "origin/main"])
            .output()
            .unwrap();
        assert!(
            !rebase.status.success(),
            "il rebase deve fermarsi sul conflitto"
        );
        assert!(rebase_in_progress(&setup.work_b));

        let err = git_sync_repo(path_b_str, "pull".to_string())
            .await
            .expect_err("il pull deve rifiutarsi");
        assert!(err.contains("rebase in corso"), "{err}");
        assert!(
            rebase_in_progress(&setup.work_b),
            "il rebase dell'utente non va annullato"
        );
    }

    #[tokio::test]
    async fn test_pull_autostash_conflict_reports_stash() {
        let setup = setup_test_repos();
        let path_b_str = setup.work_b.to_str().unwrap().to_string();

        push_remote_change(&setup, "initial.txt", "versione remota\n", "remote edit");
        // Modifica non committata sullo stesso file: il rebase riesce (fast-forward)
        // ma l'autostash non si riapplica senza conflitti.
        fs::write(setup.work_b.join("initial.txt"), "modifica locale\n").unwrap();

        let err = git_sync_repo(path_b_str, "pull".to_string())
            .await
            .expect_err("l'autostash in conflitto va segnalato");
        assert!(err.contains("stash"), "messaggio inatteso: {err}");
        let list = stash_list(&setup.work_b);
        assert!(!list.is_empty(), "le modifiche devono essere nello stash");
        let stashed = String::from_utf8_lossy(
            &run_git_test_cmd(&setup.work_b, &["show", "stash@{0}:initial.txt"]).stdout,
        )
        .to_string();
        assert_eq!(stashed, "modifica locale\n");
    }

    #[tokio::test]
    async fn test_pull_ff_fails_closed_on_non_git_dir() {
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp =
            std::env::temp_dir().join(format!("omp-not-a-git-repo-{}-{}", std::process::id(), seq));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();

        let res = git_sync_repo(temp.to_str().unwrap().to_string(), "pull-ff".to_string()).await;
        let _ = fs::remove_dir_all(&temp);

        assert!(
            res.is_err(),
            "pull-ff su cartella non git deve fallire chiuso"
        );
    }

    #[test]
    fn test_parse_porcelain_v2_upstream_ahead_behind() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head feature/login
# branch.upstream origin/feature/login
# branch.ab +3 -2
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "feature/login");
        assert_eq!(info.upstream, Some("origin/feature/login".to_string()));
        assert_eq!(info.ahead, 3);
        assert_eq!(info.behind, 2);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_detached_head() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head (detached)
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "(detached)");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_no_upstream() {
        let raw = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "main");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_initial_unborn_branch() {
        let raw = "\
# branch.oid (initial)
# branch.head main
";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "main");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_dirty_vs_clean() {
        let raw_clean = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
";
        let info_clean = parse_porcelain_v2_branch(raw_clean);
        assert!(!info_clean.has_uncommitted);

        let raw_dirty = "\
# branch.oid 881a25b3e1fa841ed15c654789cc993158a08c45
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
1 .M N... 100644 100644 100644 123 456 src/main.rs
? untracked.txt
";
        let info_dirty = parse_porcelain_v2_branch(raw_dirty);
        assert!(info_dirty.has_uncommitted);
    }

    #[test]
    fn test_parse_porcelain_v2_fallback_head() {
        let raw = "";
        let info = parse_porcelain_v2_branch(raw);
        assert_eq!(info.branch, "HEAD");
        assert_eq!(info.upstream, None);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert!(!info.has_uncommitted);
    }
}
