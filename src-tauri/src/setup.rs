//! Primo avvio guidato: verifica del contratto con `omp`, installazione del
//! binario quando manca, installazione del font Nerd per l'utente e
//! rilevamento della cartella dei progetti.
//!
//! Perimetro di scrittura (docs/DECISIONS.md, Gate R11): `%LOCALAPPDATA%\omp`,
//! il `Path` utente, `~/.omp/agent/settings.json` limitatamente alla chiave
//! `shellPath` e solo se assente, la cartella font per-utente. `config.yml`
//! non si tocca: lo scrive `omp` attraverso il suo wizard.

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{command, AppHandle, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Nasconde la finestra di console dei processi ausiliari (PowerShell, reg).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const OMP_REPO: &str = "can1357/oh-my-pi";

/// Versione del wizard di `omp` che consideriamo "setup fatto".
/// `CURRENT_SETUP_VERSION = 2` in `packages/coding-agent/src/modes/setup-version.ts`,
/// verificato sul bundle di omp 18.0.4. Se `omp` la alza, il wizard nativo
/// tornera' a proporre le scene nuove: `wizard_pending` lo riflette da solo.
const CURRENT_SETUP_VERSION: u64 = 2;

/// Font incluso nel binario, come l'estensione-ponte dei diagrammi: una sola
/// verita' nel repo, nessuna risorsa Tauri da configurare. E' lo stesso font
/// che il terminale usa via `@font-face` (`static/fonts/StudioMonoNF-Regular.woff2`),
/// riportato in TTF perche' Windows non installa i `.woff2`.
const NERD_FONT_TTF: &[u8] = include_bytes!("../../assets/fonts/FiraCodeNerdFontMono-Regular.ttf");
const NERD_FONT_FILE: &str = "FiraCodeNerdFontMono-Regular.ttf";
/// Nome interno del font (`name` ID 1), quello che Windows mostra e che i
/// terminali cercano. Diverso da "Studio Mono NF" del `@font-face`: nessuna
/// collisione con lo stack del canvas.
const NERD_FONT_NAME: &str = "FiraCode Nerd Font Mono";

// -----------------------------------------------------------------------------
// Stato del contratto
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub name: String,
    pub exists: bool,
    /// Apribile in sola lettura. Un `false` con `exists: true` e' un database
    /// in uso esclusivo o corrotto: va detto, non aggirato.
    pub readable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub omp_installed: bool,
    pub omp_path: Option<String>,
    pub omp_version: Option<String>,
    /// `setupVersion` letto da `config.yml`; 0 quando la chiave o il file mancano.
    pub setup_version: u64,
    /// `true` quando il wizard nativo partirebbe da solo alla prima sessione.
    pub wizard_pending: bool,
    pub has_credentials: bool,
    /// Solo i nomi dei provider con credenziale attiva. Mai un token: la
    /// tabella `auth_credentials` viene aperta in sola lettura e la colonna
    /// `data` non viene nemmeno selezionata.
    pub credential_providers: Vec<String>,
    pub default_model: Option<String>,
    pub theme_dark: Option<String>,
    pub color_blind_mode: bool,
    pub nerd_font_installed: bool,
    pub databases: Vec<DatabaseStatus>,
    /// Cosa manca, in ordine di carta da mostrare: `omp`, `credentials`, `model`.
    pub missing: Vec<String>,
}

fn omp_binary_if_present() -> Option<PathBuf> {
    let resolved = crate::omp_ops::get_omp_binary();
    let path = PathBuf::from(&resolved);
    if path.is_absolute() {
        return path.exists().then_some(path);
    }
    // Nome nudo: `get_omp_binary` ha ripiegato sul PATH. Verifichiamo che il
    // PATH lo risolva davvero, altrimenti "installato" sarebbe una bugia.
    which_on_path(&resolved)
}

/// Risolve un eseguibile sul `PATH` senza dipendenze: `where` su Windows,
/// `command -v` altrove.
fn which_on_path(program: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where.exe");
        cmd.arg(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = text.lines().next().map(|l| l.trim()) {
                    if !first.is_empty() {
                        return Some(PathBuf::from(first));
                    }
                }
            }
        }
        // Prova con estensioni comuni se non presenti
        if !program.ends_with(".exe") && !program.ends_with(".cmd") && !program.ends_with(".bat") {
            for ext in &[".exe", ".cmd", ".bat", ".ps1"] {
                let candidate = format!("{}{}", program, ext);
                let mut cmd = Command::new("where.exe");
                cmd.arg(&candidate);
                cmd.creation_flags(CREATE_NO_WINDOW);
                if let Ok(out) = cmd.output() {
                    if out.status.success() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        if let Some(first) = text.lines().next().map(|l| l.trim()) {
                            if !first.is_empty() {
                                return Some(PathBuf::from(first));
                            }
                        }
                    }
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("sh")
            .arg("-c")
            .arg(format!("command -v {}", program))
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let first = text.lines().next()?.trim();
        (!first.is_empty()).then(|| PathBuf::from(first))
    }
}

fn read_omp_version(binary: &Path) -> Option<String> {
    let ext = binary.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut cmd = if cfg!(target_os = "windows")
        && (ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    {
        let mut c = Command::new("cmd.exe");
        c.args(["/c", &binary.to_string_lossy(), "--version"]);
        c
    } else {
        let mut c = Command::new(binary);
        c.arg("--version");
        c
    };
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    let stdout_text = String::from_utf8_lossy(&output.stdout);
    let raw = stdout_text.trim();
    let text_to_parse = if raw.is_empty() {
        let stderr_text = String::from_utf8_lossy(&output.stderr);
        let err_trimmed = stderr_text.trim().to_string();
        if err_trimmed.is_empty() {
            return None;
        }
        err_trimmed
    } else {
        raw.to_string()
    };
    // `omp/18.0.4` -> `18.0.4`
    let version_part = text_to_parse
        .lines()
        .next()?
        .rsplit('/')
        .next()
        .unwrap_or(&text_to_parse)
        .trim_start_matches(['v', 'V'])
        .trim();
    (!version_part.is_empty()).then(|| version_part.to_string())
}

fn config_yml_path_in(dir: &Path) -> Option<PathBuf> {
    let yml = dir.join("config.yml");
    if yml.exists() {
        return Some(yml);
    }
    // `omp` accetta `config.yaml` come nome di compatibilita' e lo aggiorna
    // in place quando esiste (docs/settings di omp, "Where settings live").
    let yaml = dir.join("config.yaml");
    yaml.exists().then_some(yaml)
}

struct ConfigFacts {
    setup_version: u64,
    default_model: Option<String>,
    theme_dark: Option<String>,
    color_blind_mode: bool,
}

fn read_config_facts(agent: &Path) -> ConfigFacts {
    let mut facts = ConfigFacts {
        setup_version: 0,
        default_model: None,
        theme_dark: None,
        color_blind_mode: false,
    };
    let Some(path) = config_yml_path_in(agent) else {
        return facts;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return facts;
    };
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&text) else {
        return facts;
    };

    facts.setup_version = value
        .get("setupVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    facts.default_model = value
        .get("modelRoles")
        .and_then(|roles| roles.get("default"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    facts.theme_dark = value
        .get("theme")
        .and_then(|theme| theme.get("dark"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    facts.color_blind_mode = value
        .get("colorBlindMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    facts
}

/// Provider con almeno una credenziale non disabilitata. La query non tocca
/// la colonna `data`: nessun token entra mai nel processo di Studio.
fn read_credential_providers(agent: &Path) -> Vec<String> {
    let path = agent.join("agent.db");
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return Vec::new();
    };
    let _ = conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
    let Ok(mut stmt) = conn.prepare(
        "SELECT DISTINCT provider FROM auth_credentials WHERE disabled_cause IS NULL",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

fn database_status(agent: &Path) -> Vec<DatabaseStatus> {
    // `stats.db` e `autoqa.db` vivono un livello sopra `agent/`.
    let root = agent.parent().map(|p| p.to_path_buf());
    let targets: Vec<(String, PathBuf)> = ["agent.db", "history.db", "models.db"]
        .iter()
        .map(|name| ((*name).to_string(), agent.join(name)))
        .chain(
            root.map(|r| ("stats.db".to_string(), r.join("stats.db")))
                .into_iter(),
        )
        .collect();

    targets
        .into_iter()
        .map(|(name, path)| {
            let exists = path.exists();
            let readable = exists
                && rusqlite::Connection::open_with_flags(
                    &path,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )
                .is_ok();
            DatabaseStatus {
                name,
                exists,
                readable,
            }
        })
        .collect()
}

/// Il `contract_check` previsto in ARCHITECTURE.md §4.1: quattro esiti, non un
/// booleano. Il frontend decide quali carte mostrare leggendo `missing`.
#[command]
pub async fn setup_status() -> Result<SetupStatus, String> {
    tokio::task::spawn_blocking(|| status_for(crate::omp_ops::agent_dir()))
        .await
        .map_err(|e| format!("Verifica del contratto: {}", e))
}

/// Corpo di `setup_status` con la directory dell'agente esplicita: e' quello
/// che i test possono puntare a una cartella vuota senza toccare la
/// configurazione reale della macchina.
fn status_for(agent: Option<PathBuf>) -> SetupStatus {
    let binary = omp_binary_if_present();
    let omp_version = binary.as_deref().and_then(read_omp_version);
    let facts = agent
        .as_deref()
        .map(read_config_facts)
        .unwrap_or(ConfigFacts {
            setup_version: 0,
            default_model: None,
            theme_dark: None,
            color_blind_mode: false,
        });
    let credential_providers = agent
        .as_deref()
        .map(read_credential_providers)
        .unwrap_or_default();

    let mut missing = Vec::new();
    if binary.is_none() {
        missing.push("omp".to_string());
    }
    if credential_providers.is_empty() {
        missing.push("credentials".to_string());
    }
    if facts.default_model.is_none() {
        missing.push("model".to_string());
    }

    SetupStatus {
        omp_installed: binary.is_some(),
        omp_path: binary.as_ref().map(|p| p.to_string_lossy().to_string()),
        omp_version,
        setup_version: facts.setup_version,
        wizard_pending: facts.setup_version < CURRENT_SETUP_VERSION,
        has_credentials: !credential_providers.is_empty(),
        credential_providers,
        default_model: facts.default_model,
        theme_dark: facts.theme_dark,
        color_blind_mode: facts.color_blind_mode,
        nerd_font_installed: nerd_font_target().is_some_and(|p| p.exists()),
        databases: agent.as_deref().map(database_status).unwrap_or_default(),
        missing,
    }
}

// -----------------------------------------------------------------------------
// Installazione di omp
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// `resolving` | `downloading` | `verifying` | `installing` | `done` | `error`
    pub status: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub message: Option<String>,
    pub error: Option<String>,
    pub diagnostic: Option<String>,
    pub retryable: bool,
}

impl InstallProgress {
    fn stage(status: &str, message: &str) -> Self {
        Self {
            status: status.to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            percentage: 0.0,
            message: Some(message.to_string()),
            error: None,
            diagnostic: None,
            retryable: false,
        }
    }

    fn failed_with_diag(error: String, diagnostic: String, retryable: bool) -> Self {
        Self {
            status: "error".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            percentage: 0.0,
            message: None,
            error: Some(error),
            diagnostic: Some(diagnostic),
            retryable,
        }
    }
}

const INSTALL_EVENT: &str = "setup://install-progress";

#[derive(serde::Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

/// Nome dell'asset di release per una piattaforma. I nomi sono quelli
/// pubblicati da `can1357/oh-my-pi`, verificati sulla release v18.0.4.
fn release_asset_name_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("windows", "x86_64") => Some("omp-windows-x64.exe"),
        ("macos", "aarch64") => Some("omp-darwin-arm64"),
        ("macos", "x86_64") => Some("omp-darwin-x64"),
        ("linux", "aarch64") => Some("omp-linux-arm64"),
        ("linux", "x86_64") => Some("omp-linux-x64"),
        _ => None,
    }
}

fn release_asset_name() -> Option<&'static str> {
    release_asset_name_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// Cartella di installazione, con la stessa variabile d'ambiente rispettata
/// dallo script ufficiale (`PI_INSTALL_DIR`).
fn install_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_INSTALL_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(local).join("omp"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".omp").join("bin"))
    }
}

fn installed_binary_path() -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") {
        "omp.exe"
    } else {
        "omp"
    };
    Some(install_dir()?.join(name))
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .user_agent(format!("omp-studio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Inizializzazione client HTTP: {}", e))
}

/// SHA-256 del file appena scaricato, calcolato nativamente in Rust.
/// Evita dipendenze da PowerShell o shasum ed elimina rischi di timeout
/// o execution policy.
fn file_sha256(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = hasher.finalize();
    Some(format!("{:x}", hash))
}

/// Quota una stringa per una riga di comando PowerShell in apici singoli.
fn ps_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Aggiunge la cartella al `Path` **utente** leggendolo e riscrivendolo con
/// PowerShell, come fa `scripts/install.ps1`. Non si usa `setx`: troncherebbe
/// il valore oltre 1024 caratteri, cioe' distruggerebbe il PATH dell'utente.
#[cfg(target_os = "windows")]
fn ensure_user_path_contains(dir: &Path) -> Result<bool, String> {
    let dir_literal = ps_single_quote(&dir.to_string_lossy());
    let script = format!(
        "$dir = {d};\
         $current = [Environment]::GetEnvironmentVariable('Path','User');\
         if ($null -eq $current) {{ $current = '' }};\
         $parts = $current.Split(';') | Where-Object {{ $_ -ne '' }};\
         if ($parts -contains $dir) {{ 'present' }} else {{\
            $joined = if ($current.TrimEnd(';') -eq '') {{ $dir }} else {{ $current.TrimEnd(';') + ';' + $dir }};\
            [Environment]::SetEnvironmentVariable('Path', $joined, 'User'); 'added' }}",
        d = dir_literal
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[Setup] Avviso: esecuzione powershell per PATH non riuscita: {}", e);
            return Ok(false);
        }
    };
    if !out.status.success() {
        let err_msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        eprintln!("[Setup] Avviso: aggiornamento PATH utente non riuscito: {}", err_msg);
        return Ok(false);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim() == "added")
}

#[cfg(not(target_os = "windows"))]
fn ensure_user_path_contains(_dir: &Path) -> Result<bool, String> {
    // Su Unix il PATH e' responsabilita' del profilo della shell: non lo
    // riscriviamo alle spalle dell'utente.
    Ok(false)
}

/// Percorsi tipici di una bash su Windows, nell'ordine usato dallo script
/// ufficiale (Git for Windows prima di tutto).
fn find_bash() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let git_bash = PathBuf::from(r"C:\Program Files\Git\bin\bash.exe");
        if git_bash.exists() {
            return Some(git_bash);
        }
        which_on_path("bash.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Scrive `shellPath` in `~/.omp/agent/settings.json` **solo se la chiave
/// manca**, in merge sul JSON esistente. Replica `Configure-BashShell` di
/// `scripts/install.ps1`: senza quella chiave il tool `bash` di `omp` ripiega
/// sulla shell interna. E' la sola aggiunta dentro `~/.omp` oltre al file di
/// tema (docs/DECISIONS.md, Gate R11).
fn ensure_shell_path() -> Result<Option<String>, String> {
    let Some(agent) = crate::omp_ops::agent_dir() else {
        return Ok(None);
    };
    let path = agent.join("settings.json");

    let mut root = if path.exists() {
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("Lettura di settings.json: {}", e))?;
        serde_json::from_str::<serde_json::Value>(&text)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()))
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    let Some(map) = root.as_object_mut() else {
        // Il file esiste ma non e' un oggetto: non e' nostro, non lo tocchiamo.
        return Ok(None);
    };
    if map
        .get("shellPath")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
    {
        return Ok(None);
    }
    let Some(bash) = find_bash() else {
        return Ok(None);
    };
    let bash_str = bash.to_string_lossy().to_string();
    map.insert(
        "shellPath".to_string(),
        serde_json::Value::String(bash_str.clone()),
    );

    std::fs::create_dir_all(&agent).map_err(|e| format!("Cartella dell'agente: {}", e))?;
    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Serializzazione di settings.json: {}", e))?;
    std::fs::write(&path, serialized).map_err(|e| format!("Scrittura di settings.json: {}", e))?;
    Ok(Some(bash_str))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub version: String,
    pub path: String,
    pub tag: String,
    pub path_updated: bool,
    pub shell_path: Option<String>,
    /// `None` quando la release non pubblica `SHA256SUMS.txt` o l'hash non
    /// e' calcolabile: l'installazione prosegue, ma lo dichiariamo.
    pub checksum_verified: Option<bool>,
}

/// Scarica e installa `omp` replicando il ramo `-Binary` di
/// `scripts/install.ps1`, con progresso, verifica dell'hash e nessuno script
/// remoto eseguito.
#[command]
pub async fn install_omp(app: AppHandle) -> Result<InstallOutcome, String> {
    let result = install_omp_inner(&app).await;
    if let Err(error) = &result {
        let diagnostic = format!(
            "Errore durante l'installazione di omp su {} {}: {}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            error
        );
        let _ = app.emit(
            INSTALL_EVENT,
            InstallProgress::failed_with_diag(error.clone(), diagnostic, true),
        );
    }
    result
}

async fn install_omp_inner(app: &AppHandle) -> Result<InstallOutcome, String> {
    let asset_name = release_asset_name().ok_or_else(|| {
        format!(
            "Nessun binario di omp pubblicato per {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let target = installed_binary_path()
        .ok_or("Impossibile risolvere la cartella di installazione")?;
    let dir = target
        .parent()
        .ok_or("Cartella di installazione non valida")?
        .to_path_buf();

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage("resolving", "Cerco l'ultima release di omp"),
    );

    let client = github_client()?;
    let (download_url, tag_name, expected_hash) = match fetch_release_info(&client, asset_name).await {
        Ok(info) => info,
        Err(err) => {
            eprintln!("[Setup] GitHub API fallita ({}), tento il download diretto dal tag latest...", err);
            let fallback_url = format!(
                "https://github.com/{}/releases/latest/download/{}",
                OMP_REPO, asset_name
            );
            let sums_url = format!(
                "https://github.com/{}/releases/latest/download/SHA256SUMS.txt",
                OMP_REPO
            );
            let expected = fetch_hash_from_url(&client, &sums_url, asset_name).await;
            (fallback_url, "latest".to_string(), expected)
        }
    };

    // Si scarica in un file temporaneo accanto alla destinazione: se il
    // download si interrompe, l'eventuale binario esistente non viene corrotto.
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Creazione cartella di installazione {}: {}", dir.display(), e))?;
    let temp_path = dir.join(format!("{}.download", asset_name));
    if temp_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
    }

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage("downloading", "Avvio del download di omp"),
    );

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Connessione per il download non riuscita: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Download non disponibile dal server: {}", e))?;
    let total_bytes = response.content_length().unwrap_or(0);

    {
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("Creazione file temporaneo {}: {}", temp_path.display(), e))?;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!("Download interrotto per errore di rete: {}", e));
                }
            };
            if let Err(e) = file.write_all(&chunk).await {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Scrittura del file scaricato su disco: {}", e));
            }
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= std::time::Duration::from_millis(100) {
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    INSTALL_EVENT,
                    InstallProgress {
                        status: "downloading".to_string(),
                        downloaded_bytes: downloaded,
                        total_bytes,
                        percentage: if total_bytes > 0 {
                            (downloaded as f64 / total_bytes as f64) * 100.0
                        } else {
                            0.0
                        },
                        message: Some("Download di omp in corso".to_string()),
                        error: None,
                        diagnostic: None,
                        retryable: false,
                    },
                );
            }
        }
        if let Err(e) = file.flush().await {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Chiusura del file scaricato: {}", e));
        }
    }

    let checksum_verified = match expected_hash {
        Some(expected) => {
            let _ = app.emit(
                INSTALL_EVENT,
                InstallProgress::stage("verifying", "Verifico l'impronta di sicurezza SHA-256"),
            );
            match file_sha256(&temp_path) {
                Some(actual) if actual == expected => Some(true),
                Some(actual) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!(
                        "Impronta del file scaricato diversa da quella ufficiale pubblicata: attesa {}, trovata {}",
                        expected, actual
                    ));
                }
                None => None,
            }
        }
        None => None,
    };

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage("installing", "Installazione del binario"),
    );

    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }
    std::fs::rename(&temp_path, &target)
        .map_err(|e| format!("Installazione del binario {}: {}", target.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    let path_updated = ensure_user_path_contains(&dir).unwrap_or(false);
    let shell_path = ensure_shell_path().ok().flatten();

    // Riprova l'esecuzione fino a 4 volte con backoff per consentire
    // l'eventuale scansione iniziale dell'antivirus.
    let mut detected_version = None;
    for attempt in 0..4 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(250 * attempt)).await;
        }
        if let Some(v) = read_omp_version(&target) {
            detected_version = Some(v);
            break;
        }
    }

    let version = detected_version.ok_or_else(|| {
        format!(
            "Il binario e' stato scritto in {} ma non risponde a 'omp --version'. Verifica che l'antivirus non stia bloccando il file.",
            target.display()
        )
    })?;

    let outcome = InstallOutcome {
        version,
        path: target.to_string_lossy().to_string(),
        tag: tag_name,
        path_updated,
        shell_path,
        checksum_verified,
    };

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress {
            status: "done".to_string(),
            downloaded_bytes: total_bytes,
            total_bytes,
            percentage: 100.0,
            message: Some(format!("omp {} installato con successo", outcome.version)),
            error: None,
            diagnostic: None,
            retryable: false,
        },
    );
    Ok(outcome)
}

async fn fetch_release_info(
    client: &reqwest::Client,
    asset_name: &str,
) -> Result<(String, String, Option<String>), String> {
    let release: Release = client
        .get(format!(
            "https://api.github.com/repos/{}/releases/latest",
            OMP_REPO
        ))
        .send()
        .await
        .map_err(|e| format!("Connessione a GitHub: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Status release GitHub: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Risposta JSON della release non valida: {}", e))?;

    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| format!("La release {} non contiene l'asset {}", release.tag_name, asset_name))?;

    let expected_hash = fetch_expected_hash(client, &release, asset_name).await;
    Ok((asset.browser_download_url.clone(), release.tag_name, expected_hash))
}

async fn fetch_hash_from_url(
    client: &reqwest::Client,
    url: &str,
    asset_name: &str,
) -> Option<String> {
    let text = client
        .get(url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    parse_checksums(&text, asset_name)
}

fn parse_checksums(text: &str, asset_name: &str) -> Option<String> {
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next().unwrap_or_default().trim_start_matches('*');
        if name == asset_name {
            return Some(hash.to_lowercase());
        }
    }
    None
}

async fn fetch_expected_hash(
    client: &reqwest::Client,
    release: &Release,
    asset_name: &str,
) -> Option<String> {
    let sums = release.assets.iter().find(|a| a.name == "SHA256SUMS.txt")?;
    fetch_hash_from_url(client, &sums.browser_download_url, asset_name).await
}

// -----------------------------------------------------------------------------
// Font Nerd per-utente
// -----------------------------------------------------------------------------

/// `%LOCALAPPDATA%\Microsoft\Windows\Fonts`: installazione per-utente,
/// disponibile da Windows 10 1809 e senza privilegi di amministratore.
fn nerd_font_target() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(
            PathBuf::from(local)
                .join("Microsoft")
                .join("Windows")
                .join("Fonts")
                .join(NERD_FONT_FILE),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("fonts")
                .join(NERD_FONT_FILE),
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInstallOutcome {
    pub family: String,
    pub path: String,
    /// `false` quando il font era gia' installato: l'operazione e' idempotente.
    pub installed: bool,
    /// `true` quando il font e' anche registrato per la sessione corrente.
    /// Con `false` i terminali gia' aperti lo vedranno al prossimo avvio.
    pub registered: bool,
}

/// Installa il font Nerd per l'utente corrente, senza chiedere e senza
/// amministratore. Non serve a Studio (il terminale usa il `@font-face`
/// bundlato): serve a `omp` lanciato in un terminale esterno, dove
/// `symbolPreset` scelto nel wizard disegnerebbe tofu.
#[command]
pub async fn install_nerd_font() -> Result<FontInstallOutcome, String> {
    tokio::task::spawn_blocking(|| {
        let target = nerd_font_target().ok_or("Impossibile risolvere la cartella dei font")?;
        let dir = target.parent().ok_or("Percorso del font non valido")?;
        std::fs::create_dir_all(dir).map_err(|e| format!("Cartella dei font: {}", e))?;

        let already = target.exists()
            && std::fs::metadata(&target)
                .map(|m| m.len() == NERD_FONT_TTF.len() as u64)
                .unwrap_or(false);
        if !already {
            std::fs::write(&target, NERD_FONT_TTF)
                .map_err(|e| format!("Copia del font: {}", e))?;
        }

        let registered = register_font(&target);
        Ok(FontInstallOutcome {
            family: NERD_FONT_NAME.to_string(),
            path: target.to_string_lossy().to_string(),
            installed: !already,
            registered,
        })
    })
    .await
    .map_err(|e| format!("Installazione del font: {}", e))?
}

/// Registra il font nel ramo utente del registro e lo carica nella sessione
/// corrente. Il valore per-utente richiede il **percorso assoluto**; quello
/// per-macchina si accontenta del nome file.
#[cfg(target_os = "windows")]
fn register_font(path: &Path) -> bool {
    let value_name = format!("{} (TrueType)", NERD_FONT_NAME);
    let mut reg = Command::new("reg.exe");
    reg.args([
        "add",
        r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
        "/v",
        &value_name,
        "/t",
        "REG_SZ",
        "/d",
        &path.to_string_lossy(),
        "/f",
    ]);
    reg.creation_flags(CREATE_NO_WINDOW);
    let registered = reg.output().map(|o| o.status.success()).unwrap_or(false);
    if !registered {
        return false;
    }

    // `AddFontResourceW` rende il font disponibile subito; `WM_FONTCHANGE`
    // avvisa le finestre esistenti. Best effort: se fallisce, il font c'e'
    // comunque al prossimo avvio dei processi.
    let script = format!(
        "Add-Type -Namespace OmpStudio -Name Fonts -MemberDefinition '\
         [DllImport(\"gdi32.dll\", CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f);\
         [DllImport(\"user32.dll\")] public static extern int SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint fl, uint t, out IntPtr r);' \
         -PassThru | Out-Null;\
         [void][OmpStudio.Fonts]::AddFontResourceW({p});\
         $r = [IntPtr]::Zero;\
         [void][OmpStudio.Fonts]::SendMessageTimeout([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$r)",
        p = ps_single_quote(&path.to_string_lossy())
    );
    let mut ps = Command::new("powershell.exe");
    ps.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    ps.creation_flags(CREATE_NO_WINDOW);
    let _ = ps.output();
    true
}

#[cfg(not(target_os = "windows"))]
fn register_font(_path: &Path) -> bool {
    // Su Linux basta la cartella font dell'utente piu' `fc-cache`.
    Command::new("fc-cache")
        .arg("-f")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// -----------------------------------------------------------------------------
// Cartella dei progetti
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRootCandidate {
    pub path: String,
    /// Sottocartelle di primo livello che contengono `.git`.
    pub repo_count: usize,
    pub exists: bool,
}

/// Cartelle in cui si tengono di solito i repository, nell'ordine in cui le
/// proponiamo a parita' di conteggio.
const ROOT_CANDIDATES: [&str; 7] = [
    "source/repos",
    "dev",
    "projects",
    "code",
    "git",
    "repos",
    "Documents/GitHub",
];

fn count_repos(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && entry.path().join(".git").exists()
        })
        .count()
}

/// Propone la cartella dei progetti guardando dove stanno davvero i
/// repository, invece di chiedere un percorso in astratto. Ordinata per
/// numero di repository, poi per ordine dei candidati.
#[command]
pub async fn detect_project_roots() -> Result<Vec<ProjectRootCandidate>, String> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Impossibile risolvere la cartella utente".to_string())?;
        let home = PathBuf::from(home);

        let mut found: Vec<ProjectRootCandidate> = ROOT_CANDIDATES
            .iter()
            .map(|rel| {
                let path = rel
                    .split('/')
                    .fold(home.clone(), |acc, part| acc.join(part));
                let exists = path.is_dir();
                ProjectRootCandidate {
                    repo_count: if exists { count_repos(&path) } else { 0 },
                    path: path.to_string_lossy().to_string(),
                    exists,
                }
            })
            .filter(|candidate| candidate.exists)
            .collect();

        // Ordine stabile: piu' repository prima, e a parita' l'ordine dei
        // candidati (che e' quello in cui `sort_by` li trova).
        found.sort_by(|a, b| b.repo_count.cmp(&a.repo_count));
        Ok(found)
    })
    .await
    .map_err(|e| format!("Rilevamento delle cartelle progetto: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_name_is_known_for_supported_targets() {
        // La mappa deve restare allineata ai nomi pubblicati nelle release.
        assert_eq!(
            release_asset_name_for("windows", "x86_64"),
            Some("omp-windows-x64.exe")
        );
        assert_eq!(
            release_asset_name_for("macos", "aarch64"),
            Some("omp-darwin-arm64")
        );
        assert_eq!(release_asset_name_for("freebsd", "x86_64"), None);
    }

    #[test]
    fn ps_quoting_escapes_single_quotes() {
        assert_eq!(ps_single_quote(r"C:\a b"), r"'C:\a b'");
        assert_eq!(ps_single_quote("it's"), "'it''s'");
    }

    #[test]
    fn font_is_a_real_truetype_file() {
        // `include_bytes!` non verifica niente: se il file in assets/ venisse
        // sostituito con un woff2, Windows rifiuterebbe di installarlo.
        assert!(NERD_FONT_TTF.len() > 1_000_000);
        assert_eq!(&NERD_FONT_TTF[0..4], &[0x00, 0x01, 0x00, 0x00]);
    }

    #[test]
    fn repo_counting_only_looks_at_first_level_git_dirs() {
        let base = std::env::temp_dir().join(format!("omp-studio-roots-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("with-git").join(".git")).unwrap();
        std::fs::create_dir_all(base.join("plain")).unwrap();
        std::fs::create_dir_all(base.join("nested").join("inner").join(".git")).unwrap();

        assert_eq!(count_repos(&base), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn empty_agent_dir_reports_credentials_and_model_missing() {
        // Una cartella agente vuota e' l'equivalente esatto di una macchina
        // appena installata: nessun config.yml, nessun agent.db.
        let base = std::env::temp_dir().join(format!("omp-studio-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let status = status_for(Some(base.clone()));
        assert_eq!(status.setup_version, 0);
        assert!(status.wizard_pending, "il wizard nativo deve risultare da fare");
        assert!(!status.has_credentials);
        assert_eq!(status.default_model, None);
        assert!(status.missing.contains(&"credentials".to_string()));
        assert!(status.missing.contains(&"model".to_string()));
        // I database mancanti non sono illeggibili: la differenza e' quella che
        // distingue "prima installazione" da "installazione rotta".
        assert!(status.databases.iter().all(|db| !db.exists && !db.readable));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn config_facts_read_the_keys_omp_actually_writes() {
        let base = std::env::temp_dir().join(format!("omp-studio-facts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(
            base.join("config.yml"),
            "setupVersion: 2\nmodelRoles:\n  default: anthropic/claude-opus-5:high\n  smol: x/y\ntheme:\n  dark: titanium\ncolorBlindMode: true\n",
        )
        .unwrap();

        let facts = read_config_facts(&base);
        assert_eq!(facts.setup_version, 2);
        assert_eq!(
            facts.default_model.as_deref(),
            Some("anthropic/claude-opus-5:high")
        );
        assert_eq!(facts.theme_dark.as_deref(), Some("titanium"));
        assert!(facts.color_blind_mode);

        let status = status_for(Some(base.clone()));
        assert!(!status.wizard_pending);
        // Il modello c'e' ma le credenziali no: e' esattamente il caso
        // "wizard chiuso con Esc" che non deve chiudere il modal.
        assert_eq!(status.missing, vec!["credentials".to_string()]);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn file_sha256_computes_correct_hash() {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("omp-test-hash-{}.txt", std::process::id()));
        std::fs::write(&temp_file, b"hello world").unwrap();

        let hash = file_sha256(&temp_file);
        let _ = std::fs::remove_file(&temp_file);

        // echo -n "hello world" | sha256sum -> b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
        assert_eq!(
            hash.as_deref(),
            Some("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
        );
    }

    #[test]
    fn parse_checksums_finds_asset_hash() {
        let text = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9  omp-windows-x64.exe\n\
                    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *omp-darwin-arm64\n";
        assert_eq!(
            parse_checksums(text, "omp-windows-x64.exe").as_deref(),
            Some("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
        );
        assert_eq!(
            parse_checksums(text, "omp-darwin-arm64").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
        assert_eq!(parse_checksums(text, "nonexistent"), None);
    }

    /// Installa davvero il font nel profilo dell'utente, quindi non gira nella
    /// suite: `cargo test -- --ignored font_installs_for_the_current_user`.
    /// E' l'unico modo di esercitare copia + registro senza la GUI.
    #[tokio::test]
    #[ignore = "muta il profilo utente: copia un font e scrive in HKCU"]
    async fn font_installs_for_the_current_user() {
        let outcome = install_nerd_font().await.expect("installazione del font");
        assert_eq!(outcome.family, NERD_FONT_NAME);
        let path = std::path::PathBuf::from(&outcome.path);
        assert!(path.exists(), "il file del font non e' stato scritto");
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            NERD_FONT_TTF.len() as u64
        );
        assert!(outcome.registered, "il font non risulta registrato");

        // Idempotenza: una seconda chiamata non riscrive nulla.
        let again = install_nerd_font().await.expect("seconda installazione");
        assert!(!again.installed);
    }
}


