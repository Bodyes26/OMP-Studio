use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub username: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub method: String, // "gh_cli" | "token" | "none"
    pub protocol: String, // "https" | "ssh"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SavedGithubConfig {
    pub token: Option<String>,
    pub protocol: Option<String>,
}

fn github_config_path() -> Option<PathBuf> {
    crate::omp_ops::agent_dir().map(|dir| dir.join("github.json"))
}

pub fn get_saved_token() -> Option<String> {
    let path = github_config_path()?;
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let cfg: SavedGithubConfig = serde_json::from_str(&content).ok()?;
    cfg.token.filter(|t| !t.trim().is_empty())
}

pub fn save_token(token: Option<String>, protocol: Option<String>) -> Result<(), String> {
    let path = github_config_path().ok_or_else(|| "Cartella agent_dir non trovata".to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut cfg = if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str::<SavedGithubConfig>(&content).unwrap_or_default()
    } else {
        SavedGithubConfig::default()
    };
    cfg.token = token;
    if protocol.is_some() {
        cfg.protocol = protocol;
    }
    let json = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Serializzazione config GitHub: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Scrittura github.json: {e}"))?;
    Ok(())
}

/// Risolve il binario `gh` sul sistema.
pub fn find_gh_binary() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let candidate = PathBuf::from(r"C:\Program Files\GitHub CLI\gh.exe");
        if candidate.exists() {
            return Some(candidate);
        }
        let mut cmd = Command::new("where.exe");
        cmd.arg("gh.exe");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let txt = String::from_utf8_lossy(&out.stdout);
                if let Some(first) = txt.lines().next().map(|l| l.trim()) {
                    if !first.is_empty() {
                        return Some(PathBuf::from(first));
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("which");
        cmd.arg("gh");
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let txt = String::from_utf8_lossy(&out.stdout);
                let first = txt.trim();
                if !first.is_empty() {
                    return Some(PathBuf::from(first));
                }
            }
        }
    }

    None
}

/// Controlla se `gh` è autenticato eseguendo `gh auth status`.
fn check_gh_cli_status(gh_path: &Path) -> (bool, Option<String>, String) {
    let mut cmd = Command::new(gh_path);
    cmd.args(["auth", "status"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let Ok(out) = cmd.output() else {
        return (false, None, "https".to_string());
    };

    let mut full_output = String::from_utf8_lossy(&out.stdout).to_string();
    full_output.push_str(&String::from_utf8_lossy(&out.stderr));

    let mut username = None;
    let mut protocol = "https".to_string();

    for line in full_output.lines() {
        let trimmed = line.trim();
        // Esempi: "Logged in to github.com account Bodyes26"
        // oppure "account Bodyes26"
        if trimmed.contains("Logged in to github.com") || trimmed.contains("account ") {
            if let Some(idx) = trimmed.find("account ") {
                let rest = &trimmed[idx + 8..];
                let user = rest
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches(|c: char| c == '(' || c == ')' || c == '\'' || c == '"');
                if !user.is_empty() {
                    username = Some(user.to_string());
                }
            }
        }
        if trimmed.contains("Git operations protocol:") {
            if trimmed.to_lowercase().contains("ssh") {
                protocol = "ssh".to_string();
            } else {
                protocol = "https".to_string();
            }
        }
    }

    let authenticated = out.status.success() || username.is_some();
    (authenticated, username, protocol)
}

#[derive(Deserialize)]
struct GithubUserApi {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

/// Valida un Personal Access Token interrogando GitHub API.
async fn validate_github_token(token: &str) -> Result<GithubUserApi, String> {
    let client = reqwest::Client::builder()
        .user_agent("OMP-Studio")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Richiesta API GitHub fallita: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Token GitHub non valido (HTTP {})", res.status()));
    }

    let user: GithubUserApi = res
        .json()
        .await
        .map_err(|e| format!("Parsing risposta utente GitHub: {e}"))?;

    Ok(user)
}

#[tauri::command]
pub async fn github_get_status() -> Result<GithubAuthStatus, String> {
    let saved_token = get_saved_token();

    // 1. Se c'è un token salvato manualmente, prova a validarlo
    if let Some(token) = &saved_token {
        match validate_github_token(token).await {
            Ok(user) => {
                return Ok(GithubAuthStatus {
                    installed: find_gh_binary().is_some(),
                    authenticated: true,
                    username: Some(user.login),
                    name: user.name,
                    avatar_url: user.avatar_url,
                    method: "token".to_string(),
                    protocol: "https".to_string(),
                    error: None,
                });
            }
            Err(err) => {
                // Token salvato ma non valido
                let gh = find_gh_binary();
                if gh.is_none() {
                    return Ok(GithubAuthStatus {
                        installed: false,
                        authenticated: false,
                        username: None,
                        name: None,
                        avatar_url: None,
                        method: "token".to_string(),
                        protocol: "https".to_string(),
                        error: Some(err),
                    });
                }
            }
        }
    }

    // 2. Controllo gh CLI
    let gh = find_gh_binary();

    if let Some(gh_path) = gh {
        let (authenticated, username, protocol) = check_gh_cli_status(&gh_path);
        let mut avatar_url = None;
        let mut name = None;

        if authenticated && username.is_some() {
            let mut cmd = Command::new(&gh_path);
            cmd.args(["api", "user", "--jq", "{login: .login, name: .name, avatar_url: .avatar_url}"]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);

            if let Ok(out) = cmd.output() {
                if out.status.success() {
                    #[derive(Deserialize)]
                    struct BriefUser {
                        name: Option<String>,
                        avatar_url: Option<String>,
                    }
                    if let Ok(b) = serde_json::from_slice::<BriefUser>(&out.stdout) {
                        name = b.name;
                        avatar_url = b.avatar_url;
                    }
                }
            }
        }

        return Ok(GithubAuthStatus {
            installed: true,
            authenticated,
            username,
            name,
            avatar_url,
            method: if authenticated { "gh_cli".to_string() } else { "none".to_string() },
            protocol,
            error: None,
        });
    }

    // 3. Né token né gh CLI
    Ok(GithubAuthStatus {
        installed: false,
        authenticated: false,
        username: None,
        name: None,
        avatar_url: None,
        method: "none".to_string(),
        protocol: "https".to_string(),
        error: None,
    })
}

#[tauri::command]
pub async fn github_set_token(token: String) -> Result<GithubAuthStatus, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        save_token(None, None)?;
        return github_get_status().await;
    }

    let user = validate_github_token(trimmed).await?;
    save_token(Some(trimmed.to_string()), Some("https".to_string()))?;

    Ok(GithubAuthStatus {
        installed: find_gh_binary().is_some(),
        authenticated: true,
        username: Some(user.login),
        name: user.name,
        avatar_url: user.avatar_url,
        method: "token".to_string(),
        protocol: "https".to_string(),
        error: None,
    })
}

#[tauri::command]
pub async fn github_logout() -> Result<(), String> {
    save_token(None, None)?;

    if let Some(gh_path) = find_gh_binary() {
        let mut cmd = Command::new(gh_path);
        cmd.args(["auth", "logout", "-h", "github.com"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }

    Ok(())
}

#[tauri::command]
pub async fn github_install_cli() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(|| {
            let mut cmd = Command::new("winget");
            cmd.args([
                "install",
                "--id",
                "GitHub.cli",
                "-e",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--silent",
            ]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let out = cmd.output().map_err(|e| format!("Avvio winget fallito: {e}"))?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                let stdout = String::from_utf8_lossy(&out.stdout);
                return Err(format!("Installazione fallita: {err} {stdout}"));
            }
            Ok("GitHub CLI installata con successo".to_string())
        })
        .await
        .map_err(|e| format!("Task installazione: {e}"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("L'installazione automatica è supportata tramite winget su Windows. Su macOS usa 'brew install gh', su Linux il gestore di pacchetti di sistema.".to_string())
    }
}
