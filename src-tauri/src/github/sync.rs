use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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
    let mut cmd = Command::new("git");
    cmd.current_dir(dir);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| format!("Esecuzione git {:?}: {e}", args))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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

#[tauri::command]
pub async fn git_upstream_status(project_path: String) -> Result<GitUpstreamStatus, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&project_path);
        if !path.exists() {
            return Err(format!("Percorso '{project_path}' non trovato"));
        }

        // Verifica se è un git worktree
        if run_git_in(path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
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

        // Branch corrente
        let branch = run_git_in(path, &["symbolic-ref", "--short", "HEAD"])
            .or_else(|_| run_git_in(path, &["rev-parse", "--abbrev-ref", "HEAD"]))
            .unwrap_or_else(|_| "HEAD".to_string());

        // File modificati locali
        let status_out = run_git_in(path, &["status", "--porcelain"]).unwrap_or_default();
        let has_uncommitted = !status_out.trim().is_empty();

        // Upstream tracking branch
        let upstream = run_git_in(path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok();

        let mut ahead = 0;
        let mut behind = 0;
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();

        if upstream.is_some() {
            // Conta ahead / behind
            if let Ok(counts) = run_git_in(path, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
                let parts: Vec<&str> = counts.split_whitespace().collect();
                if parts.len() >= 2 {
                    ahead = parts[0].parse::<u32>().unwrap_or(0);
                    behind = parts[1].parse::<u32>().unwrap_or(0);
                }
            }

            // Se ci sono commit incoming
            if behind > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) = run_git_in(path, &["log", format_arg, "HEAD..@{u}", "-n", "10"]) {
                    incoming = parse_commit_log(&raw_log);
                }
            }

            // Se ci sono commit outgoing
            if ahead > 0 {
                let format_arg = "--pretty=format:%H\u{1f}%h\u{1f}%s\u{1f}%an\u{1f}%ar";
                if let Ok(raw_log) = run_git_in(path, &["log", format_arg, "@{u}..HEAD", "-n", "10"]) {
                    outgoing = parse_commit_log(&raw_log);
                }
            }
        }

        Ok(GitUpstreamStatus {
            is_git: true,
            branch,
            upstream,
            ahead,
            behind,
            incoming_commits: incoming,
            outgoing_commits: outgoing,
            has_uncommitted,
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
            "pull" => {
                // Auto-stash se ci sono modifiche
                let status_out = run_git_in(path, &["status", "--porcelain"]).unwrap_or_default();
                let dirty = !status_out.trim().is_empty();

                if dirty {
                    run_git_in(path, &["stash", "push", "-m", "omp-studio-auto-stash"])?;
                }

                let pull_res = run_git_in(path, &["pull", "--rebase"]);

                if dirty {
                    let _ = run_git_in(path, &["stash", "pop"]);
                }

                pull_res.map(|msg| {
                    if msg.is_empty() {
                        "Pull completato".to_string()
                    } else {
                        msg
                    }
                })
            }
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

                // 2. Pull con rebase
                let status_out = run_git_in(path, &["status", "--porcelain"]).unwrap_or_default();
                let dirty = !status_out.trim().is_empty();

                if dirty {
                    run_git_in(path, &["stash", "push", "-m", "omp-studio-auto-stash"])?;
                }

                let pull_res = run_git_in(path, &["pull", "--rebase"]);

                if dirty {
                    let _ = run_git_in(path, &["stash", "pop"]);
                }

                pull_res?;

                // 3. Push
                let push_res = run_git_in(path, &["push"])?;
                Ok(format!("Sincronizzazione completata: {push_res}"))
            }
            _ => Err(format!("Azione di sincronizzazione sconosciuta: '{action}'")),
        }
    })
    .await
    .map_err(|e| format!("Task git sync: {e}"))?
}
