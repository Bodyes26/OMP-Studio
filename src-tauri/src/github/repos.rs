use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use super::auth::{find_gh_binary, get_saved_token, run_blocking};

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
pub async fn project_detect_github_remotes(
    project_root: String,
) -> Result<Vec<DetectedGithubRemote>, String> {
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&project_root);
        if !root.is_dir() {
            return Ok(Vec::new());
        }

        let entries =
            std::fs::read_dir(&root).map_err(|e| format!("Lettura cartella radice: {e}"))?;

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
                        let resolved = if target.is_absolute() {
                            target
                        } else {
                            path.join(target)
                        };
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

    // 1. Prova con gh CLI se disponibile (processo esterno: fuori dal runtime async)
    let from_gh = run_blocking(move || -> Option<Vec<GithubRemoteRepo>> {
        let gh_path = find_gh_binary()?;
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

        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        let items = serde_json::from_slice::<Vec<GhCliRepo>>(&out.stdout).ok()?;
        Some(
            items
                .into_iter()
                .map(|r| GithubRemoteRepo {
                    name: r.name,
                    full_name: r.name_with_owner,
                    is_private: r.is_private,
                    description: r.description,
                    url: r.url,
                    ssh_url: r.ssh_url,
                    default_branch: r
                        .default_branch_ref
                        .map(|b| b.name)
                        .unwrap_or_else(|| "main".to_string()),
                    updated_at: r.updated_at.unwrap_or_default(),
                })
                .collect(),
        )
    })
    .await?;
    if let Some(mapped) = from_gh {
        return Ok(mapped);
    }

    // 2. Se gh CLI non ha risposto o non è presente, prova con token PAT salvato
    if let Some(token) = get_saved_token() {
        let client = reqwest::Client::builder()
            .user_agent("OMP-Studio")
            .build()
            .map_err(|e| e.to_string())?;

        let url = format!(
            "https://api.github.com/user/repos?per_page={}&sort=updated",
            lim.min(100)
        );
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
            return Err(format!(
                "La cartella di destinazione '{}' esiste già.",
                target_path
            ));
        }

        let mut cmd = Command::new("git");
        // `--` impedisce che un URL che inizia con '-' venga letto come opzione di git.
        cmd.args(["clone", "--progress", "--", &repo_url, &target_path]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let out = cmd
            .output()
            .map_err(|e| format!("Avvio git clone fallito: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Clonazione fallita: {stderr}"));
        }

        Ok(target_path)
    })
    .await
    .map_err(|e| format!("Task clone repo: {e}"))?
}

/// Nome di repository accettato da GitHub. Il controllo sta anche qui, e non solo
/// in `project_create_new`, perche' il comando e' invocabile direttamente: un nome
/// che inizia con '-' finirebbe letto da gh come opzione.
fn validate_github_repo_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Il nome del repository è obbligatorio.".to_string());
    }
    if name.len() > 100 {
        return Err("Il nome del repository è troppo lungo (max 100 caratteri).".to_string());
    }
    if name.starts_with('-') {
        return Err("Il nome del repository non può iniziare con un trattino.".to_string());
    }
    if name == "." || name == ".." {
        return Err("Nome del repository non valido.".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(
            "Il nome del repository può contenere solo lettere, numeri, trattino, underscore e punto."
                .to_string(),
        );
    }
    Ok(())
}

/// Esito di `gh repo create`: il repository creato oppure lo stderr di gh.
enum GhCreateOutcome {
    Created(Result<GithubRemoteRepo, String>),
    Failed(String),
}

/// Risposta costruita dai dati noti quando `gh repo view` non risponde: il repo
/// esiste gia', ripiegare sul PAT tenterebbe di crearlo una seconda volta.
fn repo_from_known_data(
    owner: &str,
    name: &str,
    description: Option<String>,
    is_private: bool,
) -> GithubRemoteRepo {
    GithubRemoteRepo {
        name: name.to_string(),
        full_name: format!("{owner}/{name}"),
        is_private,
        description: description.filter(|d| !d.trim().is_empty()),
        url: format!("https://github.com/{owner}/{name}"),
        ssh_url: Some(format!("git@github.com:{owner}/{name}.git")),
        default_branch: "main".to_string(),
        updated_at: String::new(),
    }
}

/// Owner del repo appena creato: gh stampa l'URL su stdout; in mancanza si chiede
/// il login dell'utente a gh.
fn created_repo_owner(gh_path: &Path, create_stdout: &str) -> Option<String> {
    if let Some((owner, _)) = create_stdout.split_whitespace().find_map(parse_github_url) {
        return Some(owner);
    }
    let mut cmd = Command::new(gh_path);
    cmd.args(["api", "user", "--jq", ".login"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let login = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!login.is_empty()).then_some(login)
}

fn gh_create_repo(
    gh_path: &Path,
    name: &str,
    description: Option<String>,
    is_private: bool,
    auto_init: bool,
) -> GhCreateOutcome {
    let mut cmd = Command::new(gh_path);
    cmd.args(["repo", "create"]);
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
    // Il nome dopo `--`: mai interpretabile come opzione.
    cmd.args(["--", name]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = match cmd.output() {
        Ok(out) => out,
        Err(e) => return GhCreateOutcome::Failed(format!("Avvio gh repo create: {e}")),
    };
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return GhCreateOutcome::Failed(if detail.is_empty() {
            "gh repo create non riuscito".to_string()
        } else {
            detail
        });
    }

    // Da qui il repo esiste: qualunque cosa succeda non si passa piu' al PAT.
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let owner = created_repo_owner(gh_path, &stdout);
    let target = owner
        .as_ref()
        .map(|o| format!("{o}/{name}"))
        .unwrap_or_else(|| name.to_string());

    let mut info_cmd = Command::new(gh_path);
    info_cmd.args([
        "repo",
        "view",
        &target,
        "--json",
        "name,nameWithOwner,isPrivate,description,url,sshUrl,defaultBranchRef",
    ]);
    #[cfg(target_os = "windows")]
    info_cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(info_out) = info_cmd.output() {
        if info_out.status.success() {
            if let Ok(r) = serde_json::from_slice::<GhCliRepo>(&info_out.stdout) {
                return GhCreateOutcome::Created(Ok(GithubRemoteRepo {
                    name: r.name,
                    full_name: r.name_with_owner,
                    is_private: r.is_private,
                    description: r.description,
                    url: r.url,
                    ssh_url: r.ssh_url,
                    default_branch: r
                        .default_branch_ref
                        .map(|b| b.name)
                        .unwrap_or_else(|| "main".to_string()),
                    updated_at: String::new(),
                }));
            }
        }
    }

    GhCreateOutcome::Created(match owner {
        Some(owner) => Ok(repo_from_known_data(&owner, name, description, is_private)),
        None => Err(format!(
            "Il repository '{name}' è stato creato su GitHub, ma non è stato possibile leggerne i dati. Collegalo manualmente."
        )),
    })
}

/// Crea un nuovo repository su GitHub.
#[tauri::command]
pub async fn github_create_repo(
    name: String,
    description: Option<String>,
    is_private: bool,
    auto_init: bool,
) -> Result<GithubRemoteRepo, String> {
    let name = name.trim().to_string();
    validate_github_repo_name(&name)?;

    // Prova prima con gh CLI (processi esterni: fuori dal runtime async)
    let gh_outcome = {
        let name = name.clone();
        let description = description.clone();
        run_blocking(move || {
            find_gh_binary()
                .map(|gh_path| gh_create_repo(&gh_path, &name, description, is_private, auto_init))
        })
        .await?
    };
    let gh_error = match gh_outcome {
        Some(GhCreateOutcome::Created(result)) => return result,
        Some(GhCreateOutcome::Failed(stderr)) => Some(stderr),
        None => None,
    };

    // Fallback con token PAT (solo se gh manca o non ha creato nulla)
    let Some(token) = get_saved_token() else {
        return Err(match gh_error {
            Some(stderr) => {
                format!("Creazione del repository con GitHub CLI non riuscita: {stderr}")
            }
            None => {
                "Impossibile creare il repository: nessun account GitHub collegato.".to_string()
            }
        });
    };
    let with_gh_error = |message: String| match &gh_error {
        Some(stderr) => format!("{message}\nGitHub CLI: {stderr}"),
        None => message,
    };

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
        .map_err(|e| with_gh_error(format!("Richiesta creazione repo GitHub fallita: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let detail = res
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_default();
        return Err(with_gh_error(if detail.is_empty() {
            format!("Creazione repo fallita (HTTP {status})")
        } else {
            format!("Creazione repo fallita (HTTP {status}): {detail}")
        }));
    }

    let r: GhApiRepo = res
        .json()
        .await
        .map_err(|e| format!("Parsing risposta creazione: {e}"))?;

    Ok(GithubRemoteRepo {
        name: r.name,
        full_name: r.full_name,
        is_private: r.private,
        description: r.description,
        url: r.html_url,
        ssh_url: r.ssh_url,
        default_branch: r.default_branch.unwrap_or_else(|| "main".to_string()),
        updated_at: r.updated_at.unwrap_or_default(),
    })
}

/// Valida il nome di una nuova cartella progetto (e, se serve, di un repo GitHub).
fn validate_new_project_name(name: &str, for_github: bool) -> Result<(), String> {
    if name.is_empty() {
        return Err("Il nome del progetto è obbligatorio.".to_string());
    }
    if name.len() > 100 {
        return Err("Il nome del progetto è troppo lungo (max 100 caratteri).".to_string());
    }
    if name == "." || name == ".." || name.starts_with('.') {
        return Err("Il nome non può iniziare con un punto.".to_string());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("Il nome non può finire con punto o spazio.".to_string());
    }
    if name.chars().any(|c| {
        matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
    }) {
        return Err("Il nome contiene caratteri non validi per una cartella.".to_string());
    }
    if for_github && name.starts_with('-') {
        return Err("Per GitHub il nome non può iniziare con un trattino.".to_string());
    }
    if for_github
        && !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(
            "Per GitHub il nome può contenere solo lettere, numeri, trattino, underscore e punto."
                .to_string(),
        );
    }
    Ok(())
}

/// Crea un nuovo progetto vuoto in `parent_dir/name`: cartella + `git init`.
/// Con `visibility` "public"/"private" crea prima il repo GitHub (così un errore
/// remoto non lascia cartelle a metà) e poi collega `origin`. Nessun commit
/// iniziale: il repo remoto resta vuoto finché l'utente non fa il primo push.
#[tauri::command]
pub async fn project_create_new(
    parent_dir: String,
    name: String,
    visibility: String,
    use_ssh: bool,
) -> Result<String, String> {
    let name = name.trim().to_string();
    let on_github = match visibility.as_str() {
        "local" => false,
        "public" | "private" => true,
        other => return Err(format!("Visibilità non valida: {other}")),
    };
    validate_new_project_name(&name, on_github)?;

    let parent = PathBuf::from(&parent_dir);
    if !parent.is_dir() {
        return Err(format!(
            "La cartella dei progetti '{parent_dir}' non esiste."
        ));
    }
    let target = parent.join(&name);
    if target.exists() {
        return Err(format!("Esiste già '{}' in {parent_dir}.", name));
    }

    let remote_url = if on_github {
        let repo = github_create_repo(name.clone(), None, visibility == "private", false).await?;
        Some(match (use_ssh, repo.ssh_url) {
            (true, Some(ssh)) => ssh,
            _ => repo.url,
        })
    } else {
        None
    };

    tokio::task::spawn_blocking(move || {
        std::fs::create_dir(&target).map_err(|e| format!("Creazione cartella fallita: {e}"))?;

        let run_git = |args: &[&str]| -> Result<(), String> {
            let mut cmd = Command::new("git");
            cmd.arg("-C").arg(&target).args(args);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let out = cmd
                .output()
                .map_err(|e| format!("Avvio git fallito: {e}"))?;
            if out.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "git {} fallito: {}",
                    args.first().copied().unwrap_or(""),
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
        };

        run_git(&["init", "-b", "main"])?;
        if let Some(url) = &remote_url {
            run_git(&["remote", "add", "origin", url])?;
        }
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task creazione progetto: {e}"))?
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

    #[test]
    fn validates_new_project_names() {
        assert!(validate_new_project_name("mio-progetto", true).is_ok());
        assert!(validate_new_project_name("Mio Progetto", false).is_ok());
        assert!(validate_new_project_name("Mio Progetto", true).is_err());
        assert!(validate_new_project_name("", false).is_err());
        assert!(validate_new_project_name("..", false).is_err());
        assert!(validate_new_project_name(".nascosto", false).is_err());
        assert!(validate_new_project_name("a/b", false).is_err());
        assert!(validate_new_project_name("a\\b", false).is_err());
        assert!(validate_new_project_name("-x", true).is_err());
    }

    #[test]
    fn validates_github_repo_names() {
        assert!(validate_github_repo_name("OMP-Studio").is_ok());
        assert!(validate_github_repo_name("my_repo.v2").is_ok());
        assert!(validate_github_repo_name("").is_err());
        assert!(validate_github_repo_name("-help").is_err());
        assert!(validate_github_repo_name("--public").is_err());
        assert!(validate_github_repo_name("a b").is_err());
        assert!(validate_github_repo_name("owner/repo").is_err());
        assert!(validate_github_repo_name("..").is_err());
        assert!(validate_github_repo_name("perché").is_err());
    }

    #[test]
    fn known_data_repo_points_to_github() {
        let repo = repo_from_known_data("octo", "nuovo", Some(" ".to_string()), true);
        assert_eq!(repo.full_name, "octo/nuovo");
        assert_eq!(repo.url, "https://github.com/octo/nuovo");
        assert_eq!(
            repo.ssh_url.as_deref(),
            Some("git@github.com:octo/nuovo.git")
        );
        assert!(repo.is_private);
        assert_eq!(repo.description, None);
    }

    #[test]
    fn owner_from_gh_create_stdout() {
        let stdout = "https://github.com/octo/nuovo\n";
        let owner = stdout
            .split_whitespace()
            .find_map(parse_github_url)
            .map(|(o, _)| o);
        assert_eq!(owner.as_deref(), Some("octo"));
    }

    /// Un exec subito dopo la scrittura dello script puo' fallire con ETXTBSY se un
    /// altro test fa fork nello stesso istante: si riprova qualche volta.
    #[cfg(unix)]
    fn create_with_fake(fake: &Path, name: &str, is_private: bool) -> GhCreateOutcome {
        for _ in 0..10 {
            match gh_create_repo(fake, name, None, is_private, false) {
                GhCreateOutcome::Failed(e) if e.contains("busy") => {
                    std::thread::sleep(std::time::Duration::from_millis(20))
                }
                other => return other,
            }
        }
        gh_create_repo(fake, name, None, is_private, false)
    }

    #[cfg(unix)]
    #[test]
    fn gh_create_failure_returns_stderr() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("omp-studio-fake-gh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("gh");
        std::fs::write(
            &fake,
            "#!/bin/sh\necho 'GraphQL: Name already exists on this account' >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let outcome = create_with_fake(&fake, "doppio", true);
        let _ = std::fs::remove_dir_all(&dir);
        match outcome {
            GhCreateOutcome::Failed(stderr) => {
                assert!(stderr.contains("Name already exists"), "{stderr}")
            }
            GhCreateOutcome::Created(_) => panic!("gh fallito non deve risultare creato"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn gh_create_success_with_failing_view_uses_known_data() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("omp-studio-fake-gh-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("gh");
        // create riesce e stampa l'URL; view fallisce.
        std::fs::write(
            &fake,
            "#!/bin/sh\nif [ \"$2\" = create ]; then echo https://github.com/octo/nuovo; exit 0; fi\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let outcome = create_with_fake(&fake, "nuovo", false);
        let _ = std::fs::remove_dir_all(&dir);
        match outcome {
            GhCreateOutcome::Created(Ok(repo)) => {
                assert_eq!(repo.full_name, "octo/nuovo");
                assert_eq!(repo.url, "https://github.com/octo/nuovo");
                assert!(!repo.is_private);
            }
            GhCreateOutcome::Created(Err(e)) => panic!("dati noti attesi: {e}"),
            GhCreateOutcome::Failed(e) => panic!("create riuscito letto come fallito: {e}"),
        }
    }
}
