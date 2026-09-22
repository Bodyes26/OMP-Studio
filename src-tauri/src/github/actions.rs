use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use super::auth::{find_gh_binary, get_saved_token};
use super::repos::parse_github_url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubActionRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub url: String,
    pub event: String,
    pub head_sha: String,
    pub head_branch: String,
    pub created_at: String,
}

#[derive(Deserialize)]
struct GhCliRun {
    #[serde(rename = "databaseId")]
    database_id: u64,
    name: String,
    status: String,
    conclusion: Option<String>,
    url: String,
    event: String,
    #[serde(rename = "headSha")]
    head_sha: String,
    #[serde(rename = "headBranch")]
    head_branch: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Deserialize)]
struct GhApiWorkflowRuns {
    workflow_runs: Vec<GhApiRun>,
}

#[derive(Deserialize)]
struct GhApiRun {
    id: u64,
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: String,
    event: String,
    head_sha: String,
    head_branch: Option<String>,
    created_at: String,
}

fn get_project_github_slug(project_path: &Path) -> Option<(String, String)> {
    let mut cmd = Command::new("git");
    cmd.current_dir(project_path);
    cmd.args(["remote", "get-url", "origin"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let url = String::from_utf8_lossy(&out.stdout);
    parse_github_url(&url)
}

#[tauri::command]
pub async fn github_get_actions_status(
    project_path: String,
    branch: Option<String>,
) -> Result<Vec<GithubActionRun>, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(format!("Percorso '{project_path}' non trovato"));
    }

    let Some((owner, repo)) = get_project_github_slug(&path) else {
        return Ok(Vec::new());
    };
    let slug = format!("{owner}/{repo}");

    // 1. Prova con gh CLI
    if let Some(gh_path) = find_gh_binary() {
        let mut cmd = Command::new(&gh_path);
        let mut args = vec![
            "run",
            "list",
            "--repo",
            &slug,
            "--limit",
            "5",
            "--json",
            "databaseId,name,status,conclusion,url,event,headSha,headBranch,createdAt",
        ];
        if let Some(b) = &branch {
            if !b.trim().is_empty() {
                args.push("--branch");
                args.push(b.trim());
            }
        }
        cmd.args(&args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(out) = cmd.output() {
            if out.status.success() {
                if let Ok(items) = serde_json::from_slice::<Vec<GhCliRun>>(&out.stdout) {
                    let mapped = items
                        .into_iter()
                        .map(|r| GithubActionRun {
                            id: r.database_id,
                            name: r.name,
                            status: r.status,
                            conclusion: r.conclusion,
                            url: r.url,
                            event: r.event,
                            head_sha: r.head_sha,
                            head_branch: r.head_branch,
                            created_at: r.created_at,
                        })
                        .collect();
                    return Ok(mapped);
                }
            }
        }
    }

    // 2. Prova con token PAT
    if let Some(token) = get_saved_token() {
        let client = reqwest::Client::builder()
            .user_agent("OMP-Studio")
            .build()
            .map_err(|e| e.to_string())?;

        let mut url = format!("https://api.github.com/repos/{slug}/actions/runs?per_page=5");
        if let Some(b) = &branch {
            if !b.trim().is_empty() {
                url.push_str(&format!("&branch={}", b.trim()));
            }
        }

        let res = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Richiesta Actions API fallita: {e}"))?;

        if res.status().is_success() {
            if let Ok(data) = res.json::<GhApiWorkflowRuns>().await {
                let mapped = data
                    .workflow_runs
                    .into_iter()
                    .map(|r| GithubActionRun {
                        id: r.id,
                        name: r.name,
                        status: r.status,
                        conclusion: r.conclusion,
                        url: r.html_url,
                        event: r.event,
                        head_sha: r.head_sha,
                        head_branch: r.head_branch.unwrap_or_default(),
                        created_at: r.created_at,
                    })
                    .collect();
                return Ok(mapped);
            }
        }
    }

    Ok(Vec::new())
}
