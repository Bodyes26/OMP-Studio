use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use super::auth::{find_gh_binary, get_saved_token};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGithubRemote {
    pub folder_name: String,
    pub path: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub full_name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRemoteRepo {
    pub name: String,
    pub full_name: String,
    pub is_private: bool,
    pub description: Option<String>,
    pub url: String,
    pub ssh_url: Option<String>,
    pub default_branch: String,
    pub updated_at: String,
}

/// Estrae owner e nome repo da un URL GitHub (HTTPS o SSH).
pub fn parse_github_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim().trim_end_matches(".git");
    // Formato SSH: git@github.com:owner/repo
    if let Some(idx) = trimmed.find("github.com:") {
        let path = &trimmed[idx + 11..];
        let mut parts = path.split('/');
        let owner = parts.next()?.trim();
        let repo = parts.next()?.trim();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner.to_string(), repo.to_string()));
        }
    }
    // Formato HTTPS/SSH URL: https://github.com/owner/repo o ssh://git@github.com/owner/repo
    if let Some(idx) = trimmed.find("github.com/") {
        let path = &trimmed[idx + 11..];
        let mut parts = path.split('/');
        let owner = parts.next()?.trim();
        let repo = parts.next()?.trim();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner.to_string(), repo.to_string()));
        }
    }
    None
}

/// Legge il remote "origin" da un file config Git.
fn read_remote_origin(git_config_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(git_config_path).ok()?;
    let mut in_remote_origin = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_remote_origin = trimmed.eq_ignore_ascii_case("[remote \"origin\"]");
            continue;
        }
        if in_remote_origin && trimmed.starts_with("url =") {
            let val = trimmed[5..].trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Rileva i repository collegati a GitHub scansionando le cartelle in `project_root`.
#[tauri::command]
pub async fn project_detect_github_remotes(project_root: String) -> Result<Vec<DetectedGithubRemote>, String> {
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&project_root);
        if !root.is_dir() {
            return Ok(Vec::new());
        }

        let entries = std::fs::read_dir(&root)
            .map_err(|e| format!("Lettura cartella radice: {e}"))?;

        let mut results = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let folder_name = entry.file_name().to_string_lossy().to_string();
            if folder_name.starts_with('.') {
                continue;
            }

            let git_dir = path.join(".git");
            let config_path = if git_dir.is_dir() {
                git_dir.join("config")
            } else if git_dir.is_file() {
                // Possibile worktree: legge 'gitdir: <path>'
                if let Ok(content) = std::fs::read_to_string(&git_dir) {
                    let trimmed = content.trim();
                    if let Some(rest) = trimmed.strip_prefix("gitdir:") {
                        let target = PathBuf::from(rest.trim());
                        let resolved = if target.is_absolute() { target } else { path.join(target) };
                        resolved.join("config")
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            } else {
                continue;
            };

            if let Some(remote_url) = read_remote_origin(&config_path) {
                if let Some((owner, repo)) = parse_github_url(&remote_url) {
                    results.push(DetectedGithubRemote {
                        folder_name,
                        path: path.to_string_lossy().to_string(),
                        repo_owner: owner.clone(),
                        repo_name: repo.clone(),
                        full_name: format!("{owner}/{repo}"),
                        url: remote_url,
                    });
                }
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task detect remotes: {e}"))?
}

#[derive(Deserialize)]
struct GhCliRepo {
    name: String,
    #[serde(rename = "nameWithOwner")]
    name_with_owner: String,
    #[serde(rename = "isPrivate")]
    is_private: bool,
    description: Option<String>,
    url: String,
    #[serde(rename = "sshUrl")]
    ssh_url: Option<String>,
    #[serde(rename = "defaultBranchRef")]
    default_branch_ref: Option<GhBranchRef>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
}

#[derive(Deserialize)]
struct GhBranchRef {
    name: String,
}

#[derive(Deserialize)]
struct GhApiRepo {
    name: String,
    full_name: String,
    private: bool,
    description: Option<String>,
    html_url: String,
    ssh_url: Option<String>,
    default_branch: Option<String>,
    updated_at: Option<String>,
}

/// Recupera l'elenco dei repository GitHub dell'utente.
#[tauri::command]
pub async fn github_list_remote_repos(limit: Option<u32>) -> Result<Vec<GithubRemoteRepo>, String> {
    let lim = limit.unwrap_or(100);

    // 1. Prova con gh CLI se disponibile
    if let Some(gh_path) = find_gh_binary() {
        let mut cmd = Command::new(&gh_path);
        cmd.args([
            "repo",
            "list",
            "--limit",
            &lim.to_string(),
            "--json",
            "name,nameWithOwner,isPrivate,description,url,sshUrl,defaultBranchRef,updatedAt",
        ]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(out) = cmd.output() {
            if out.status.success() {
                if let Ok(items) = serde_json::from_slice::<Vec<GhCliRepo>>(&out.stdout) {
                    let mapped = items
                        .into_iter()
                        .map(|r| GithubRemoteRepo {
                            name: r.name,
                            full_name: r.name_with_owner,
                            is_private: r.is_private,
                            description: r.description,
                            url: r.url,
                            ssh_url: r.ssh_url,
                            default_branch: r.default_branch_ref.map(|b| b.name).unwrap_or_else(|| "main".to_string()),
                            updated_at: r.updated_at.unwrap_or_default(),
                        })
                        .collect();
                    return Ok(mapped);
                }
            }
        }
    }

    // 2. Se gh CLI non ha risposto o non è presente, prova con token PAT salvato
    if let Some(token) = get_saved_token() {
        let client = reqwest::Client::builder()
            .user_agent("OMP-Studio")
            .build()
            .map_err(|e| e.to_string())?;

        let url = format!("https://api.github.com/user/repos?per_page={}&sort=updated", lim.min(100));
        let res = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Richiesta API GitHub fallita: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Errore API GitHub (HTTP {})", res.status()));
        }

        let items: Vec<GhApiRepo> = res
            .json()
            .await
            .map_err(|e| format!("Parsing risposta repository: {e}"))?;

        let mapped = items
            .into_iter()
            .map(|r| GithubRemoteRepo {
                name: r.name,
                full_name: r.full_name,
                is_private: r.private,
                description: r.description,
                url: r.html_url,
                ssh_url: r.ssh_url,
                default_branch: r.default_branch.unwrap_or_else(|| "main".to_string()),
                updated_at: r.updated_at.unwrap_or_default(),
            })
            .collect();

        return Ok(mapped);
    }

    Err("Nessun account GitHub collegato (né GitHub CLI né Personal Access Token)".to_string())
}

/// Clona un repository GitHub remoto in locale.
#[tauri::command]
pub async fn github_clone_repo(repo_url: String, target_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let target = PathBuf::from(&target_path);
        if target.exists() {
            return Err(format!("La cartella di destinazione '{}' esiste già.", target_path));
        }

        let mut cmd = Command::new("git");
        cmd.args(["clone", "--progress", &repo_url, &target_path]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd.output().map_err(|e| format!("Avvio git clone fallito: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Clonazione fallita: {stderr}"));
        }

        Ok(target_path)
    })
    .await
    .map_err(|e| format!("Task clone repo: {e}"))?
}

/// Crea un nuovo repository su GitHub.
#[tauri::command]
pub async fn github_create_repo(
    name: String,
    description: Option<String>,
    is_private: bool,
    auto_init: bool,
) -> Result<GithubRemoteRepo, String> {
    // Prova prima con gh CLI
    if let Some(gh_path) = find_gh_binary() {
        let mut cmd = Command::new(&gh_path);
        cmd.args(["repo", "create", &name]);
        if is_private {
            cmd.arg("--private");
        } else {
            cmd.arg("--public");
        }
        if let Some(desc) = &description {
            if !desc.trim().is_empty() {
                cmd.args(["--description", desc.trim()]);
            }
        }
        if auto_init {
            cmd.arg("--add-readme");
        }
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd.output().map_err(|e| format!("Avvio gh repo create: {e}"))?;
        if out.status.success() {
            // Recupera il repo appena creato
            let mut info_cmd = Command::new(&gh_path);
            info_cmd.args(["repo", "view", &name, "--json", "name,nameWithOwner,isPrivate,description,url,sshUrl,defaultBranchRef"]);
            #[cfg(target_os = "windows")]
            info_cmd.creation_flags(CREATE_NO_WINDOW);

            if let Ok(info_out) = info_cmd.output() {
                if info_out.status.success() {
                    if let Ok(r) = serde_json::from_slice::<GhCliRepo>(&info_out.stdout) {
                        return Ok(GithubRemoteRepo {
                            name: r.name,
                            full_name: r.name_with_owner,
                            is_private: r.is_private,
                            description: r.description,
                            url: r.url,
                            ssh_url: r.ssh_url,
                            default_branch: r.default_branch_ref.map(|b| b.name).unwrap_or_else(|| "main".to_string()),
                            updated_at: String::new(),
                        });
                    }
                }
            }
        }
    }

    // Fallback con token PAT
    if let Some(token) = get_saved_token() {
        let client = reqwest::Client::builder()
            .user_agent("OMP-Studio")
            .build()
            .map_err(|e| e.to_string())?;

        let body = serde_json::json!({
            "name": name,
            "description": description.unwrap_or_default(),
            "private": is_private,
            "auto_init": auto_init,
        });

        let res = client
            .post("https://api.github.com/user/repos")
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Richiesta creazione repo GitHub fallita: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Creazione repo fallita (HTTP {})", res.status()));
        }

        let r: GhApiRepo = res
            .json()
            .await
            .map_err(|e| format!("Parsing risposta creazione: {e}"))?;

        return Ok(GithubRemoteRepo {
            name: r.name,
            full_name: r.full_name,
            is_private: r.private,
            description: r.description,
            url: r.html_url,
            ssh_url: r.ssh_url,
            default_branch: r.default_branch.unwrap_or_else(|| "main".to_string()),
            updated_at: r.updated_at.unwrap_or_default(),
        });
    }

    Err("Impossibile creare il repository: nessun account GitHub collegato.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_various_github_urls() {
        assert_eq!(
            parse_github_url("https://github.com/Bodyes26/OMP-Studio.git"),
            Some(("Bodyes26".to_string(), "OMP-Studio".to_string()))
        );
        assert_eq!(
            parse_github_url("https://github.com/owner/repo"),
            Some(("owner".to_string(), "repo".to_string()))
        );
        assert_eq!(
            parse_github_url("git@github.com:owner/my-repo.git"),
            Some(("owner".to_string(), "my-repo".to_string()))
        );
        assert_eq!(
            parse_github_url("ssh://git@github.com/owner/project"),
            Some(("owner".to_string(), "project".to_string()))
        );
        assert_eq!(parse_github_url("https://gitlab.com/owner/repo.git"), None);
    }
}
