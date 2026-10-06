use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

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
    pub method: String,   // "gh_cli" | "token" | "none"
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
    save_token_at(&path, token, protocol)
}

/// Il file contiene un PAT: va scritto in modo atomico (un'interruzione non deve
/// lasciare un JSON troncato che fa sparire il token) e leggibile solo dal
/// proprietario. `atomic_write` copia i permessi della destinazione esistente,
/// quindi un vecchio file 0644 va ristretto prima dello scambio.
fn save_token_at(
    path: &Path,
    token: Option<String>,
    protocol: Option<String>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut cfg = if path.exists() {
        let content = std::fs::read_to_string(path).unwrap_or_default();
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
    restrict_token_file_permissions(path)?;
    crate::fs_atomic::atomic_write(path, json.as_bytes())
        .map_err(|e| format!("Scrittura github.json: {e}"))?;
    restrict_token_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn restrict_token_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) if meta.permissions().mode() & 0o777 != 0o600 => {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Permessi github.json: {e}"))
        }
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Permessi github.json: {e}")),
    }
}

#[cfg(not(unix))]
fn restrict_token_file_permissions(_path: &Path) -> Result<(), String> {
    // Su Windows il profilo utente e' gia' protetto dalle ACL ereditate.
    Ok(())
}

/// Cache del percorso di `gh`: la ricerca puo' lanciare `where`/`which` e perfino
/// una shell di login, troppo costosa per ogni polling di stato. Un risultato
/// positivo vale finche' il file esiste; uno negativo scade dopo un minuto, cosi'
/// un'installazione manuale di gh viene vista senza riavviare Studio.
static GH_BINARY_CACHE: Mutex<Option<(Option<PathBuf>, Instant)>> = Mutex::new(None);
const GH_MISSING_TTL: Duration = Duration::from_secs(60);

/// Risolve il binario `gh` sul sistema (con cache, vedi `GH_BINARY_CACHE`).
pub fn find_gh_binary() -> Option<PathBuf> {
    if let Ok(cache) = GH_BINARY_CACHE.lock() {
        match cache.as_ref() {
            Some((Some(path), _)) if path.exists() => return Some(path.clone()),
            Some((None, at)) if at.elapsed() < GH_MISSING_TTL => return None,
            _ => {}
        }
    }
    let found = resolve_gh_binary();
    if let Ok(mut cache) = GH_BINARY_CACHE.lock() {
        *cache = Some((found.clone(), Instant::now()));
    }
    found
}

/// Dimentica il percorso di `gh` memorizzato (dopo un'installazione o una rimozione).
pub fn invalidate_gh_binary_cache() {
    if let Ok(mut cache) = GH_BINARY_CACHE.lock() {
        *cache = None;
    }
}

/// Esegue un lavoro bloccante (processi esterni) fuori dal runtime async, per non
/// fermare gli altri comandi Tauri mentre gh o git rispondono.
pub(crate) async fn run_blocking<T, F>(job: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|e| format!("Task in background: {e}"))
}

fn resolve_gh_binary() -> Option<PathBuf> {
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
        // Le app GUI su macOS/Linux partono con PATH minimale (senza Homebrew):
        // `which gh` da solo non trova mai gh installato con brew.
        for p in [
            "/opt/homebrew/bin/gh",
            "/usr/local/bin/gh",
            "/opt/local/bin/gh",
            "/usr/bin/gh",
            "/home/linuxbrew/.linuxbrew/bin/gh",
        ] {
            let candidate = PathBuf::from(p);
            if candidate.exists() {
                return Some(candidate);
            }
        }
        if let Some(home) = std::env::var_os("HOME") {
            let candidate = PathBuf::from(home).join(".local/bin/gh");
            if candidate.exists() {
                return Some(candidate);
            }
        }
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
        // Ultimo tentativo: shell di login dell'utente (legge il suo PATH reale).
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(out) = Command::new(shell).args(["-lc", "command -v gh"]).output() {
            if out.status.success() {
                let txt = String::from_utf8_lossy(&out.stdout);
                if let Some(last) = txt.lines().map(str::trim).rfind(|l| l.starts_with('/')) {
                    return Some(PathBuf::from(last));
                }
            }
        }
    }

    None
}

/// Controlla se `gh` è autenticato eseguendo `gh auth status`.
fn check_gh_cli_status(gh_path: &Path) -> (bool, Option<String>, String) {
    let mut cmd = Command::new(gh_path);
    cmd.args(["auth", "status", "--hostname", "github.com"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let Ok(out) = cmd.output() else {
        return (false, None, "https".to_string());
    };

    let mut full_output = String::from_utf8_lossy(&out.stdout).to_string();
    full_output.push_str(&String::from_utf8_lossy(&out.stderr));

    parse_gh_auth_status(out.status.success(), &full_output)
}

/// Estrae l'utente dalle righe "Logged in to github.com account X" (gh >= 2.40)
/// o "Logged in to github.com as X" (gh precedenti).
fn logged_in_user(line: &str) -> Option<String> {
    let idx = line.find("Logged in to github.com")?;
    let rest = &line[idx + "Logged in to github.com".len()..];
    let rest = rest.trim_start();
    let rest = rest
        .strip_prefix("account ")
        .or_else(|| rest.strip_prefix("as "))?;
    let user = rest
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|c: char| c == '(' || c == ')' || c == '\'' || c == '"' || c == ',');
    (!user.is_empty()).then(|| user.to_string())
}

/// Interpreta l'output di `gh auth status`. Autenticato solo con exit 0: con un
/// token scaduto gh stampa comunque "Failed to log in to github.com account X",
/// e il vecchio parser prendeva X per un login riuscito. Con piu' account vince
/// quello marcato "Active account: true".
fn parse_gh_auth_status(success: bool, output: &str) -> (bool, Option<String>, String) {
    let mut first_user: Option<String> = None;
    let mut active_user: Option<String> = None;
    let mut last_user: Option<String> = None;
    let mut protocol = "https".to_string();
    let mut active_protocol: Option<String> = None;
    let mut in_active = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.contains("Failed to log in") {
            last_user = None;
            in_active = false;
            continue;
        }
        if let Some(user) = logged_in_user(trimmed) {
            if first_user.is_none() {
                first_user = Some(user.clone());
            }
            last_user = Some(user);
            in_active = false;
            continue;
        }
        if trimmed.contains("Active account: true") && last_user.is_some() {
            active_user = last_user.clone();
            in_active = true;
            continue;
        }
        if trimmed.contains("Git operations protocol:") {
            let value = if trimmed.to_lowercase().contains("ssh") {
                "ssh"
            } else {
                "https"
            };
            if in_active {
                active_protocol = Some(value.to_string());
            } else if last_user.is_some() && active_user.is_none() {
                protocol = value.to_string();
            }
        }
    }
    if let Some(value) = active_protocol {
        protocol = value;
    }

    if !success {
        return (false, None, protocol);
    }
    (true, active_user.or(first_user), protocol)
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
                    installed: run_blocking(find_gh_binary).await?.is_some(),
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
                if run_blocking(find_gh_binary).await?.is_none() {
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

    // 2. Controllo gh CLI (processi esterni: fuori dal runtime async)
    if let Some(status) = run_blocking(github_status_from_gh_cli).await? {
        return Ok(status);
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

/// Stato ricavato da gh CLI; None se gh non e' installata.
fn github_status_from_gh_cli() -> Option<GithubAuthStatus> {
    let gh_path = find_gh_binary()?;
    let (authenticated, username, protocol) = check_gh_cli_status(&gh_path);
    let mut avatar_url = None;
    let mut name = None;

    if authenticated && username.is_some() {
        let mut cmd = Command::new(&gh_path);
        cmd.args([
            "api",
            "user",
            "--jq",
            "{login: .login, name: .name, avatar_url: .avatar_url}",
        ]);
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

    Some(GithubAuthStatus {
        installed: true,
        authenticated,
        username,
        name,
        avatar_url,
        method: if authenticated {
            "gh_cli".to_string()
        } else {
            "none".to_string()
        },
        protocol,
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
        installed: run_blocking(find_gh_binary).await?.is_some(),
        authenticated: true,
        username: Some(user.login),
        name: user.name,
        avatar_url: user.avatar_url,
        method: "token".to_string(),
        protocol: "https".to_string(),
        error: None,
    })
}

/// Disconnette Studio da GitHub: cancella sempre e solo il PAT salvato da Studio.
/// `gh auth logout` tocca il login globale della GitHub CLI, condiviso con il
/// terminale e con altri strumenti: si esegue solo se l'utente lo chiede
/// esplicitamente (`alsoGhCli`).
#[tauri::command]
pub async fn github_logout(also_gh_cli: Option<bool>) -> Result<(), String> {
    save_token(None, None)?;

    if also_gh_cli.unwrap_or(false) {
        run_blocking(|| -> Result<(), String> {
            let Some(gh_path) = find_gh_binary() else {
                return Ok(());
            };
            let mut cmd = Command::new(gh_path);
            cmd.args(["auth", "logout", "-h", "github.com"]);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let out = cmd
                .output()
                .map_err(|e| format!("Avvio gh auth logout fallito: {e}"))?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                // gh risponde con errore anche se non c'era nessun login: non e' un fallimento.
                if !err.to_lowercase().contains("not logged in") {
                    return Err(format!(
                        "Disconnessione della GitHub CLI non riuscita: {err}"
                    ));
                }
            }
            Ok(())
        })
        .await??;
    }

    Ok(())
}

#[tauri::command]
pub async fn github_install_cli() -> Result<String, String> {
    let result = install_gh_cli().await;
    // Anche un'installazione fallita puo' aver lasciato gh sul disco: si ricerca da capo.
    invalidate_gh_binary_cache();
    result
}

async fn install_gh_cli() -> Result<String, String> {
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
            let out = cmd
                .output()
                .map_err(|e| format!("Avvio winget fallito: {e}"))?;
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

    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(|| {
            let brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
                .iter()
                .map(PathBuf::from)
                .find(|p| p.exists())
                .ok_or_else(|| {
                    "Homebrew non trovato. Installalo da https://brew.sh oppure scarica gh da https://cli.github.com".to_string()
                })?;
            let out = Command::new(&brew)
                .args(["install", "gh"])
                .env("HOMEBREW_NO_AUTO_UPDATE", "1")
                .env("NONINTERACTIVE", "1")
                .output()
                .map_err(|e| format!("Avvio brew fallito: {e}"))?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(format!("Installazione fallita: {err}"));
            }
            Ok("GitHub CLI installata con successo".to_string())
        })
        .await
        .map_err(|e| format!("Task installazione: {e}"))?
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Err("Su Linux installa gh con il gestore di pacchetti di sistema (vedi https://cli.github.com).".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GH_OK: &str = "github.com\n  \u{2713} Logged in to github.com account Bodyes26 (keyring)\n  - Active account: true\n  - Git operations protocol: ssh\n  - Token: gho_************************************\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n";

    const GH_FAILED: &str = "github.com\n  X Failed to log in to github.com account Bodyes26 (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n  - To forget about this account, run: gh auth logout -h github.com -u Bodyes26\n";

    const GH_MULTI: &str = "github.com\n  \u{2713} Logged in to github.com account lavoro (keyring)\n  - Active account: false\n  - Git operations protocol: https\n  - Token: gho_***\n\n  \u{2713} Logged in to github.com account personale (keyring)\n  - Active account: true\n  - Git operations protocol: ssh\n  - Token: gho_***\n";

    const GH_LEGACY: &str = "github.com\n  \u{2713} Logged in to github.com as octocat (/home/u/.config/gh/hosts.yml)\n  \u{2713} Git operations for github.com configured to use https protocol.\n  \u{2713} Token: *******************\n";

    #[test]
    fn gh_status_successo_legge_utente_e_protocollo() {
        let (auth, user, protocol) = parse_gh_auth_status(true, GH_OK);
        assert!(auth);
        assert_eq!(user.as_deref(), Some("Bodyes26"));
        assert_eq!(protocol, "ssh");
    }

    #[test]
    fn gh_status_failed_to_log_in_non_e_autenticato() {
        // Il vecchio parser prendeva l'utente da "account X" e dichiarava il login riuscito.
        let (auth, user, _) = parse_gh_auth_status(false, GH_FAILED);
        assert!(!auth);
        assert_eq!(user, None);
        // Anche con exit 0 una riga "Failed to log in" non fornisce un utente.
        let (_, user, _) = parse_gh_auth_status(true, GH_FAILED);
        assert_eq!(user, None);
    }

    #[test]
    fn gh_status_exit_non_zero_non_e_autenticato() {
        let (auth, user, _) = parse_gh_auth_status(false, GH_OK);
        assert!(!auth);
        assert_eq!(user, None);
    }

    #[test]
    fn gh_status_piu_account_usa_quello_attivo() {
        let (auth, user, protocol) = parse_gh_auth_status(true, GH_MULTI);
        assert!(auth);
        assert_eq!(user.as_deref(), Some("personale"));
        assert_eq!(protocol, "ssh");
    }

    #[test]
    fn gh_status_formato_legacy() {
        let (auth, user, protocol) = parse_gh_auth_status(true, GH_LEGACY);
        assert!(auth);
        assert_eq!(user.as_deref(), Some("octocat"));
        assert_eq!(protocol, "https");
    }

    #[cfg(unix)]
    #[test]
    fn token_salvato_atomico_con_permessi_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "omp-studio-gh-token-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("github.json");
        // File preesistente leggibile da tutti: va ristretto.
        std::fs::write(&path, "{\"protocol\":\"ssh\"}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        save_token_at(&path, Some("ghp_segreto".to_string()), None).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let saved: SavedGithubConfig =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.token.as_deref(), Some("ghp_segreto"));
        assert_eq!(saved.protocol.as_deref(), Some("ssh"));
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
