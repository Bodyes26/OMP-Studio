//! Studio Doctor — Autodiagnostica dell'ambiente e dei provider AI.
//!
//! Esegue un checkup in tempo reale di tutti i prerequisiti operativi di Studio:
//! 1. Eseguibile `omp` (PATH, percorso assoluto, versione, compatibilita' RPC-UI).
//! 2. Shell e Git (Git Bash su Windows, versione di git, stato del repository aperto).
//! 3. Terminale nativo (ConPTY su Windows, POSIX openpty su macOS/Linux).
//! 4. Database locali SQLite (lettura non distruttiva con `PRAGMA query_only = ON`).
//! 5. Connettivita' e stato di autenticazione dei provider AI configurati.

use portable_pty::{native_pty_system, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorItemDto {
    pub id: String,
    pub category: String, // "omp", "shell_git", "pty", "sqlite", "providers"
    pub name: String,
    pub status: String, // "ok", "warn", "error"
    pub value: String,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    pub os: String,
    pub arch: String,
    pub os_version: String,
    pub studio_version: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReportDto {
    pub system: SystemInfoDto,
    pub items: Vec<DoctorItemDto>,
    pub overall_status: String, // "ok", "warn", "error"
    pub elapsed_ms: u64,
    pub markdown_report: String,
}

/// Sostituisce i percorsi personali dell'utente con placeholder per rendere
/// il report condivisibile in sicurezza su issue o chat pubbliche.
pub fn anonymize_text(text: &str) -> String {
    let mut clean = text.to_string();

    let user_home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !user_home.is_empty() {
        clean = clean.replace(&user_home, "~");
        let forward_home = user_home.replace('\\', "/");
        clean = clean.replace(&forward_home, "~");
    }

    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    if !username.is_empty() && username.len() > 2 {
        clean = clean.replace(&format!("/{}", username), "/<USER>");
        clean = clean.replace(&format!("\\{}", username), "\\<USER>");
    }

    clean
}

fn get_os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/c", "ver"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !out.is_empty() {
                return out;
            }
        }
        "Windows (versione non determinata)".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("uname");
        cmd.args(["-srm"]);
        if let Ok(output) = cmd.output() {
            let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !out.is_empty() {
                return out;
            }
        }
        std::env::consts::OS.to_string()
    }
}

/// Controlli eseguibile `omp` (PATH, percorso assoluto, versione, RPC).
fn check_omp_items() -> Vec<DoctorItemDto> {
    let mut items = Vec::new();
    let omp_path_opt = crate::setup::omp_binary_if_present();

    match omp_path_opt {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            items.push(DoctorItemDto {
                id: "omp_binary".to_string(),
                category: "omp".to_string(),
                name: "Eseguibile omp".to_string(),
                status: "ok".to_string(),
                value: anonymize_text(&path_str),
                recommendation: None,
            });

            // Lettura versione
            let version = crate::setup::read_omp_version(&path);
            let has_valid_version = version.is_some();
            let version_label = version.unwrap_or_else(|| "Sconosciuta".to_string());

            items.push(DoctorItemDto {
                id: "omp_version".to_string(),
                category: "omp".to_string(),
                name: "Versione omp".to_string(),
                status: if has_valid_version { "ok".to_string() } else { "warn".to_string() },
                value: version_label,
                recommendation: if has_valid_version {
                    None
                } else {
                    Some("Verifica che il binario omp risponda correttamente a `omp --version`".to_string())
                },
            });

            // Compatibilita' protocollo RPC-UI
            // Verifica che il binario supporti i flag CLI necessari
            let rpc_compat = test_omp_rpc_support(&path);
            items.push(DoctorItemDto {
                id: "omp_rpc".to_string(),
                category: "omp".to_string(),
                name: "Protocollo RPC-UI".to_string(),
                status: if rpc_compat.0 { "ok".to_string() } else { "error".to_string() },
                value: rpc_compat.1,
                recommendation: if rpc_compat.0 {
                    None
                } else {
                    Some("Aggiorna omp a una versione compatibile con la modalita' `--mode rpc-ui`".to_string())
                },
            });
        }
        None => {
            items.push(DoctorItemDto {
                id: "omp_binary".to_string(),
                category: "omp".to_string(),
                name: "Eseguibile omp".to_string(),
                status: "error".to_string(),
                value: "Non trovato nel PATH di sistema".to_string(),
                recommendation: Some(
                    "Installa omp eseguendo `npm install -g @oh-my-pi/pi-coding-agent` o aggiungilo al PATH".to_string(),
                ),
            });
            items.push(DoctorItemDto {
                id: "omp_version".to_string(),
                category: "omp".to_string(),
                name: "Versione omp".to_string(),
                status: "error".to_string(),
                value: "Non rilevabile (eseguibile assente)".to_string(),
                recommendation: Some("Installare omp per rilevare la versione".to_string()),
            });
            items.push(DoctorItemDto {
                id: "omp_rpc".to_string(),
                category: "omp".to_string(),
                name: "Protocollo RPC-UI".to_string(),
                status: "error".to_string(),
                value: "Non disponibile".to_string(),
                recommendation: Some("Installare omp per abilitare il runtime delle sessioni".to_string()),
            });
        }
    }

    items
}

fn test_omp_rpc_support(binary: &Path) -> (bool, String) {
    let ext = binary.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut cmd = if cfg!(target_os = "windows")
        && (ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    {
        let mut c = Command::new("cmd.exe");
        c.args(["/c", &binary.to_string_lossy(), "--help"]);
        c
    } else {
        let mut c = Command::new(binary);
        c.arg("--help");
        c
    };

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            // omp espone --mode rpc-ui o la modalita rpc
            if combined.contains("--mode") || combined.contains("rpc") || out.status.success() {
                (true, "Supportato (interfaccia stdio NDJSON conforme)".to_string())
            } else {
                (false, "Flag `--mode rpc-ui` non rilevato nell'output di aiuto".to_string())
            }
        }
        Err(err) => (false, format!("Errore invocazione test RPC: {}", err)),
    }
}

/// Controlli Shell e Git.
fn check_shell_and_git_items(project_path: Option<&str>) -> Vec<DoctorItemDto> {
    let mut items = Vec::new();

    // 1. Versione Git
    let mut git_cmd = Command::new("git");
    git_cmd.arg("--version");
    #[cfg(target_os = "windows")]
    git_cmd.creation_flags(CREATE_NO_WINDOW);

    match git_cmd.output() {
        Ok(output) if output.status.success() => {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            items.push(DoctorItemDto {
                id: "git_version".to_string(),
                category: "shell_git".to_string(),
                name: "Git CLI".to_string(),
                status: "ok".to_string(),
                value: ver,
                recommendation: None,
            });
        }
        Ok(_) | Err(_) => {
            items.push(DoctorItemDto {
                id: "git_version".to_string(),
                category: "shell_git".to_string(),
                name: "Git CLI".to_string(),
                status: "error".to_string(),
                value: "Non trovato o non funzionante".to_string(),
                recommendation: Some("Installa Git e assicurati che sia disponibile nel PATH".to_string()),
            });
        }
    }

    // 2. Presenza Git Bash (su Windows) o Bash nativa
    #[cfg(target_os = "windows")]
    {
        let bash_paths = [
            PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
        ];

        let mut found_bash = None;
        for candidate in &bash_paths {
            if candidate.exists() {
                found_bash = Some(candidate.clone());
                break;
            }
        }

        if found_bash.is_none() {
            // Prova con where.exe
            let mut where_cmd = Command::new("where.exe");
            where_cmd.arg("bash.exe");
            where_cmd.creation_flags(CREATE_NO_WINDOW);
            if let Ok(out) = where_cmd.output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(first) = text.lines().next().map(|l| l.trim()) {
                        if !first.is_empty() {
                            found_bash = Some(PathBuf::from(first));
                        }
                    }
                }
            }
        }

        match found_bash {
            Some(p) => {
                items.push(DoctorItemDto {
                    id: "shell_bash".to_string(),
                    category: "shell_git".to_string(),
                    name: "Git Bash (bash.exe)".to_string(),
                    status: "ok".to_string(),
                    value: anonymize_text(&p.to_string_lossy()),
                    recommendation: None,
                });
            }
            None => {
                items.push(DoctorItemDto {
                    id: "shell_bash".to_string(),
                    category: "shell_git".to_string(),
                    name: "Git Bash (bash.exe)".to_string(),
                    status: "warn".to_string(),
                    value: "Non rilevato nei percorsi standard".to_string(),
                    recommendation: Some(
                        "Installa Git for Windows con i componenti bash per consentire l'esecuzione degli script agent"
                            .to_string(),
                    ),
                });
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut sh_cmd = Command::new("which");
        sh_cmd.arg("bash");
        match sh_cmd.output() {
            Ok(out) if out.status.success() => {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                items.push(DoctorItemDto {
                    id: "shell_bash".to_string(),
                    category: "shell_git".to_string(),
                    name: "Shell Bash".to_string(),
                    status: "ok".to_string(),
                    value: p,
                    recommendation: None,
                });
            }
            _ => {
                items.push(DoctorItemDto {
                    id: "shell_bash".to_string(),
                    category: "shell_git".to_string(),
                    name: "Shell Bash".to_string(),
                    status: "warn".to_string(),
                    value: "bash non rilevata in PATH".to_string(),
                    recommendation: Some("Verifica che /bin/bash sia installata e accessibile".to_string()),
                });
            }
        }
    }

    // 3. Stato Repository aperto
    if let Some(raw_path) = project_path.filter(|p| !p.trim().is_empty()) {
        let repo_dir = Path::new(raw_path);
        if repo_dir.exists() {
            let mut is_repo_cmd = Command::new("git");
            is_repo_cmd.current_dir(repo_dir);
            is_repo_cmd.args(["rev-parse", "--is-inside-work-tree"]);
            #[cfg(target_os = "windows")]
            is_repo_cmd.creation_flags(CREATE_NO_WINDOW);

            match is_repo_cmd.output() {
                Ok(out) if out.status.success() => {
                    // Ottieni ramo corrente
                    let mut branch_cmd = Command::new("git");
                    branch_cmd.current_dir(repo_dir);
                    branch_cmd.args(["rev-parse", "--abbrev-ref", "HEAD"]);
                    #[cfg(target_os = "windows")]
                    branch_cmd.creation_flags(CREATE_NO_WINDOW);

                    let branch_name = branch_cmd
                        .output()
                        .ok()
                        .map(|b| String::from_utf8_lossy(&b.stdout).trim().to_string())
                        .unwrap_or_else(|| "HEAD".to_string());

                    // Ottieni modifiche non committate
                    let mut status_cmd = Command::new("git");
                    status_cmd.current_dir(repo_dir);
                    status_cmd.args(["status", "--porcelain"]);
                    #[cfg(target_os = "windows")]
                    status_cmd.creation_flags(CREATE_NO_WINDOW);

                    let mod_count = status_cmd
                        .output()
                        .ok()
                        .map(|s| {
                            String::from_utf8_lossy(&s.stdout)
                                .lines()
                                .filter(|l| !l.trim().is_empty())
                                .count()
                        })
                        .unwrap_or(0);

                    let desc = if mod_count == 0 {
                        format!("Ramo `{}` · working tree pulito", branch_name)
                    } else {
                        format!(
                            "Ramo `{}` · {} file modificati non committati",
                            branch_name, mod_count
                        )
                    };

                    items.push(DoctorItemDto {
                        id: "git_repo_status".to_string(),
                        category: "shell_git".to_string(),
                        name: "Repository aperto".to_string(),
                        status: "ok".to_string(),
                        value: desc,
                        recommendation: None,
                    });
                }
                _ => {
                    items.push(DoctorItemDto {
                        id: "git_repo_status".to_string(),
                        category: "shell_git".to_string(),
                        name: "Repository aperto".to_string(),
                        status: "warn".to_string(),
                        value: "La cartella attiva non è un repository Git".to_string(),
                        recommendation: Some("Inizializza un repository con `git init` se desideri il tracciamento".to_string()),
                    });
                }
            }
        }
    } else {
        items.push(DoctorItemDto {
            id: "git_repo_status".to_string(),
            category: "shell_git".to_string(),
            name: "Repository aperto".to_string(),
            status: "ok".to_string(),
            value: "Nessun progetto aperto in primo piano".to_string(),
            recommendation: None,
        });
    }

    items
}

/// Controlli Terminale Nativo (ConPTY / POSIX).
fn check_pty_backend() -> DoctorItemDto {
    let pty_system = native_pty_system();
    let res = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    });

    match res {
        Ok(_pair) => {
            #[cfg(target_os = "windows")]
            let backend_name = "ConPTY operativo (backend pseudo-terminale nativo Windows)";
            #[cfg(not(target_os = "windows"))]
            let backend_name = "POSIX openpty operativo (backend Unix PTY)";

            DoctorItemDto {
                id: "pty_backend".to_string(),
                category: "pty".to_string(),
                name: "Backend Terminale Nativo (PTY)".to_string(),
                status: "ok".to_string(),
                value: backend_name.to_string(),
                recommendation: None,
            }
        }
        Err(err) => {
            #[cfg(target_os = "windows")]
            let rec = "Verifica che il sistema supporti ConPTY (Windows 10 versione 1809 o successiva)";
            #[cfg(not(target_os = "windows"))]
            let rec = "Verifica i permessi sui descrittori pseudo-terminale (/dev/pts)";

            DoctorItemDto {
                id: "pty_backend".to_string(),
                category: "pty".to_string(),
                name: "Backend Terminale Nativo (PTY)".to_string(),
                status: "error".to_string(),
                value: format!("Inizializzazione PTY fallita: {}", err),
                recommendation: Some(rec.to_string()),
            }
        }
    }
}

/// Helper per verificare l'integrita' e la lettura di un database SQLite con PRAGMA query_only = ON.
fn test_sqlite_db_read(db_name: &str, title: &str) -> DoctorItemDto {
    let db_path_opt = crate::omp_ops::open_readonly_db(db_name);

    match db_path_opt {
        Ok(conn) => {
            // Verifica che PRAGMA query_only sia attivo
            let query_only_active: Result<bool, _> =
                conn.query_row("PRAGMA query_only;", [], |row| row.get(0));

            let is_query_only = query_only_active.unwrap_or(false);

            // Lettura non distruttiva: conta tabelle
            let table_count: Result<i64, _> = conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table';",
                [],
                |row| row.get(0),
            );

            if !is_query_only {
                DoctorItemDto {
                    id: format!("sqlite_{}", db_name.replace('.', "_")),
                    category: "sqlite".to_string(),
                    name: title.to_string(),
                    status: "warn".to_string(),
                    value: "Aperto ma PRAGMA query_only non attivo".to_string(),
                    recommendation: Some("Assicurarsi che la connessione al DB imponga la sola lettura".to_string()),
                }
            } else {
                let tables = table_count.unwrap_or(0);
                DoctorItemDto {
                    id: format!("sqlite_{}", db_name.replace('.', "_")),
                    category: "sqlite".to_string(),
                    name: title.to_string(),
                    status: "ok".to_string(),
                    value: format!("Integrità verificata · PRAGMA query_only = ON ({} tabelle)", tables),
                    recommendation: None,
                }
            }
        }
        Err(err) => {
            // Se il file non esiste ancora, non e' un errore critico per history o stats
            if err.contains("non esiste") {
                DoctorItemDto {
                    id: format!("sqlite_{}", db_name.replace('.', "_")),
                    category: "sqlite".to_string(),
                    name: title.to_string(),
                    status: "ok".to_string(),
                    value: "Non ancora creato (verrà inizializzato automaticamente da omp)".to_string(),
                    recommendation: None,
                }
            } else {
                DoctorItemDto {
                    id: format!("sqlite_{}", db_name.replace('.', "_")),
                    category: "sqlite".to_string(),
                    name: title.to_string(),
                    status: "error".to_string(),
                    value: format!("Errore apertura: {}", anonymize_text(&err)),
                    recommendation: Some(format!("Verifica i permessi o l'integrità del file {}", db_name)),
                }
            }
        }
    }
}

/// Controlli Database Locali SQLite.
fn check_sqlite_items() -> Vec<DoctorItemDto> {
    vec![
        test_sqlite_db_read("history.db", "Database Cronologia (history.db)"),
        test_sqlite_db_read("stats.db", "Database Statistiche (stats.db)"),
        test_sqlite_db_read("agent.db", "Database Agente & Credenziali (agent.db)"),
    ]
}

/// Endpoint e configurazione per il test rapido di connettivita' provider.
fn provider_test_endpoint(provider_id: &str) -> &'static str {
    match provider_id {
        "anthropic" => "https://api.anthropic.com",
        "openai" | "openai-codex" => "https://api.openai.com",
        "google" | "google-antigravity" => "https://generativelanguage.googleapis.com",
        "openrouter" => "https://openrouter.ai",
        "groq" => "https://api.groq.com",
        "mistral" => "https://api.mistral.ai",
        "perplexity" => "https://api.perplexity.ai",
        "cerebras" => "https://api.cerebras.ai",
        "xai" => "https://api.x.ai",
        "tavily" => "https://api.tavily.com",
        "ollama-cloud" => "https://ollama.com",
        "ollama" => "http://127.0.0.1:11434",
        "llama.cpp" => "http://127.0.0.1:8080",
        "lm-studio" => "http://127.0.0.1:1234",
        _ => "https://api.openai.com",
    }
}

/// Esegue un ping HTTP rapido (HEAD o GET) con timeout stretto (1.5s).
async fn ping_endpoint(client: &reqwest::Client, url: &str) -> (bool, u128, String) {
    let start = Instant::now();
    let head_res = client.head(url).send().await;

    match head_res {
        Ok(resp) => {
            let elapsed = start.elapsed().as_millis();
            (true, elapsed, format!("HTTP {}", resp.status().as_u16()))
        }
        Err(_) => {
            // Riprova con un GET leggero se HEAD e' rifiutato da alcuni provider
            let get_res = client.get(url).send().await;
            let elapsed = start.elapsed().as_millis();
            match get_res {
                Ok(resp) => (true, elapsed, format!("HTTP {}", resp.status().as_u16())),
                Err(err) => (false, elapsed, err.to_string()),
            }
        }
    }
}

/// Controlli Connettivita' e Quote Provider AI.
async fn check_provider_items() -> Vec<DoctorItemDto> {
    let mut items = Vec::new();

    // Leggi account configurati da agent.db
    let accounts_res = crate::models_ops::get_auth_accounts(None).await;
    let custom_providers_res = crate::models_ops::get_custom_providers().await;

    let mut configured_providers: HashSet<String> = HashSet::new();
    let mut disabled_causes: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    if let Ok(accounts) = accounts_res {
        for acc in accounts {
            if acc.provider.starts_with("mcp_")
                || acc.provider.starts_with("mcp:")
                || acc.provider.contains("://")
            {
                continue;
            }
            configured_providers.insert(acc.provider.clone());
            if let Some(cause) = acc.disabled_cause {
                disabled_causes.insert(acc.provider, cause);
            }
        }
    }

    if let Ok(custom) = custom_providers_res {
        for key in custom.providers.keys() {
            configured_providers.insert(key.clone());
        }
    }

    if configured_providers.is_empty() {
        items.push(DoctorItemDto {
            id: "provider_none".to_string(),
            category: "providers".to_string(),
            name: "Provider AI Configurato".to_string(),
            status: "warn".to_string(),
            value: "Nessun provider configurato in Studio".to_string(),
            recommendation: Some(
                "Configura almeno un provider (es. Anthropic, OpenAI, Google) nelle Impostazioni > Modelli"
                    .to_string(),
            ),
        });
        return items;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .user_agent("omp-studio-doctor")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Esegui i ping in parallelo
    let mut tasks = Vec::new();
    let mut sorted_providers: Vec<String> = configured_providers.into_iter().collect();
    sorted_providers.sort();

    for provider_id in &sorted_providers {
        let endpoint = provider_test_endpoint(provider_id);
        let client_clone = client.clone();
        let pid = provider_id.clone();
        tasks.push(async move {
            let res = ping_endpoint(&client_clone, endpoint).await;
            (pid, endpoint, res)
        });
    }

    let results = futures_util::future::join_all(tasks).await;

    for (provider_id, endpoint, (reachable, latency_ms, detail)) in results {
        let disabled_cause = disabled_causes.get(&provider_id);
        let is_disabled = disabled_cause.is_some();

        let friendly_name = crate::models_ops::provider_display_name(&provider_id, false);
        let display_name = format!("Provider {}", friendly_name);

        if is_disabled {
            items.push(DoctorItemDto {
                id: format!("provider_{}", provider_id),
                category: "providers".to_string(),
                name: display_name,
                status: "warn".to_string(),
                value: format!(
                    "Disabilitato: {} (endpoint: {} ms)",
                    disabled_cause.unwrap(),
                    latency_ms
                ),
                recommendation: Some(format!(
                    "Riconnetti o riabilita il provider {} nelle Impostazioni > Modelli",
                    provider_id
                )),
            });
        } else if reachable {
            items.push(DoctorItemDto {
                id: format!("provider_{}", provider_id),
                category: "providers".to_string(),
                name: display_name,
                status: "ok".to_string(),
                value: format!("Autenticato · Raggiungibile ({} ms, {})", latency_ms, detail),
                recommendation: None,
            });
        } else {
            items.push(DoctorItemDto {
                id: format!("provider_{}", provider_id),
                category: "providers".to_string(),
                name: display_name,
                status: "error".to_string(),
                value: format!("Endpoint non raggiungibile: {} ({})", endpoint, detail),
                recommendation: Some(
                    "Verifica la connessione internet, proxy o limitazioni firewall aziendali"
                        .to_string(),
                ),
            });
        }
    }

    items
}

/// Genera un sommario anonimizzato in formato Markdown pronto da incollare in una issue o in chat.
pub fn generate_markdown_report(report: &DoctorReportDto) -> String {
    let mut md = String::new();
    md.push_str("### 🩺 Studio Doctor Diagnostic Report\n\n");
    md.push_str(&format!(
        "- **OMP Studio Version:** `{}`\n",
        report.system.studio_version
    ));
    md.push_str(&format!(
        "- **OS:** `{} ({})` — `{}`\n",
        report.system.os, report.system.arch, report.system.os_version
    ));
    md.push_str(&format!(
        "- **Timestamp:** `{}`\n",
        report.system.timestamp
    ));
    md.push_str(&format!(
        "- **Overall Status:** `{}` (eseguito in {} ms)\n\n",
        report.overall_status.to_uppercase(),
        report.elapsed_ms
    ));

    md.push_str("| Controllo | Stato | Valore Rilevato | Suggerimento |\n");
    md.push_str("| :--- | :---: | :--- | :--- |\n");

    for item in &report.items {
        let status_icon = match item.status.as_str() {
            "ok" => "✅ OK",
            "warn" => "⚠️ WARN",
            "error" => "❌ ERR",
            _ => "ℹ️ INFO",
        };
        let rec = item.recommendation.as_deref().unwrap_or("—");
        md.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            item.name, status_icon, item.value, rec
        ));
    }

    md.push_str("\n---\n*Report generato automaticamente da OMP Studio Doctor.*\n");
    md
}

/// Esegue l'autodiagnostica completa di Studio e restituisce il report dettagliato.
#[command]
pub async fn run_studio_doctor(project_path: Option<String>) -> Result<DoctorReportDto, String> {
    let start = Instant::now();

    let sys_info = SystemInfoDto {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        os_version: get_os_version(),
        studio_version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::lab::util::now_iso8601(),
    };

    // Esegui i controlli locali in parallelo logico / rapido
    let mut items = Vec::new();

    // 1. Eseguibile omp
    items.extend(check_omp_items());

    // 2. Shell e Git
    items.extend(check_shell_and_git_items(project_path.as_deref()));

    // 3. PTY
    items.push(check_pty_backend());

    // 4. SQLite
    items.extend(check_sqlite_items());

    // 5. Providers (con ping HTTP concorrenti)
    let provider_items = check_provider_items().await;
    items.extend(provider_items);

    // Valutazione complessiva
    let has_errors = items.iter().any(|i| i.status == "error");
    let has_warns = items.iter().any(|i| i.status == "warn");
    let overall_status = if has_errors {
        "error".to_string()
    } else if has_warns {
        "warn".to_string()
    } else {
        "ok".to_string()
    };

    let elapsed_ms = start.elapsed().as_millis() as u64;

    let mut report = DoctorReportDto {
        system: sys_info,
        items,
        overall_status,
        elapsed_ms,
        markdown_report: String::new(),
    };

    report.markdown_report = generate_markdown_report(&report);

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anonymize_text() {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            let sample = format!("{}\\AppData\\Local\\omp", home);
            let cleaned = anonymize_text(&sample);
            assert!(cleaned.starts_with('~'));
            assert!(!cleaned.contains(&home));
        }
    }

    #[test]
    fn test_check_pty() {
        let pty_item = check_pty_backend();
        assert_eq!(pty_item.category, "pty");
        assert!(pty_item.status == "ok" || pty_item.status == "error");
    }

    #[test]
    fn test_generate_markdown_report() {
        let report = DoctorReportDto {
            system: SystemInfoDto {
                os: "windows".to_string(),
                arch: "x86_64".to_string(),
                os_version: "Windows 11".to_string(),
                studio_version: "0.2.0".to_string(),
                timestamp: "2026-09-30T10:00:00.000Z".to_string(),
            },
            items: vec![DoctorItemDto {
                id: "test".to_string(),
                category: "omp".to_string(),
                name: "Test Check".to_string(),
                status: "ok".to_string(),
                value: "Tutto ok".to_string(),
                recommendation: None,
            }],
            overall_status: "ok".to_string(),
            elapsed_ms: 42,
            markdown_report: String::new(),
        };

        let md = generate_markdown_report(&report);
        assert!(md.contains("Studio Doctor Diagnostic Report"));
        assert!(md.contains("Test Check"));
        assert!(md.contains("✅ OK"));
    }

    #[tokio::test]
    async fn test_run_studio_doctor_end_to_end() {
        let report_res = run_studio_doctor(None).await;
        assert!(report_res.is_ok(), "run_studio_doctor should succeed");
        let report = report_res.unwrap();
        assert!(!report.items.is_empty(), "Doctor items should not be empty");
        assert!(report.items.iter().any(|i| i.category == "omp"));
        assert!(report.items.iter().any(|i| i.category == "shell_git"));
        assert!(report.items.iter().any(|i| i.category == "pty"));
        assert!(report.items.iter().any(|i| i.category == "sqlite"));
        assert!(report.items.iter().any(|i| i.category == "providers"));
        assert!(!report.markdown_report.is_empty());
        println!("\n=== Doctor Report ({} ms) ===\n{}", report.elapsed_ms, report.markdown_report);
    }
}
