//! Configurazione locale del controllo remoto (`remote.json`).
//!
//! Contiene l'URL del relay, l'identificatore univoco della macchina (`hostId`),
//! il nome visualizzato e la credenziale di autenticazione a 256 bit.
//! La credenziale non viene mai esposta alla WebView ne' registrata nei log.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use uuid::Uuid;

/// Lock per serializzare le scritture su `remote.json` ed evitare corse.
static REMOTE_CONFIG_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn remote_config_lock() -> std::sync::MutexGuard<'static, ()> {
    REMOTE_CONFIG_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// Modello serializzato in `remote.json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfig {
    pub enabled: bool,
    #[serde(default)]
    pub relay_url: Option<String>,
    pub machine_name: String,
    pub host_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

impl RemoteConfig {
    pub fn new_default() -> Self {
        Self {
            enabled: false,
            relay_url: None,
            machine_name: default_machine_name(),
            host_id: Uuid::new_v4().to_string(),
            credential: None,
        }
    }
}

/// Ricava il nome predefinito della macchina dall'hostname del sistema operativo.
pub fn default_machine_name() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(name) = std::env::var("HOSTNAME") {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Ok(output) = std::process::Command::new("hostname").output() {
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    "omp-studio".to_string()
}

/// URL normalizzato e URL WebSocket derivato per la connessione host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedRelayUrl {
    pub http_url: String,
    pub ws_url: String,
}

/// Valida e normalizza l'URL del relay inserito dall'utente.
///
/// Regole:
/// - Richiede schema `https://`, tranne per loopback/localhost dove `http://` e' ammesso;
/// - Rifiuta percorsi (tranne eventuale `/` finale che viene rimossa), query o frammenti;
/// - Deriva l'URL WebSocket cambiando schema in `wss://` (o `ws://`) e aggiungendo `/v1/host`.
pub fn validate_and_normalize_relay_url(input: &str) -> Result<NormalizedRelayUrl, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL del relay non specificato".to_string());
    }

    let parsed =
        reqwest::Url::parse(trimmed).map_err(|e| format!("URL del relay non valido: {e}"))?;

    if parsed.fragment().is_some() {
        return Err("L'URL del relay non puo' contenere frammenti (#...)".to_string());
    }

    if parsed.query().is_some() {
        return Err("L'URL del relay non puo' contenere parametri di query (?...)".to_string());
    }

    let path = parsed.path();
    if !path.is_empty() && path != "/" {
        return Err("L'URL del relay non puo' contenere percorsi aggiuntivi".to_string());
    }

    let scheme = parsed.scheme();
    let host_str = parsed
        .host_str()
        .ok_or_else(|| "URL privo di host".to_string())?;

    let is_localhost = is_localhost_host(host_str);

    match scheme {
        "http" => {
            if !is_localhost {
                return Err("Il protocollo HTTP e' consentito solo per localhost/127.0.0.1; per tutti gli altri host e' richiesto HTTPS".to_string());
            }
        }
        "https" => {}
        other => {
            return Err(format!(
                "Schema non supportato '{other}': usare https:// (o http:// per localhost)"
            ));
        }
    }

    // Costruzione URL canonico senza slash finale
    let port_suffix = match parsed.port() {
        Some(port) => format!(":{port}"),
        None => String::new(),
    };

    let formatted_host = if host_str.contains(':') && !host_str.starts_with('[') {
        format!("[{host_str}]")
    } else {
        host_str.to_string()
    };

    let http_url = format!("{scheme}://{formatted_host}{port_suffix}");
    let ws_scheme = if scheme == "https" { "wss" } else { "ws" };
    let ws_url = format!("{ws_scheme}://{formatted_host}{port_suffix}/v1/host");

    Ok(NormalizedRelayUrl { http_url, ws_url })
}

fn is_localhost_host(host: &str) -> bool {
    let unbracketed = host.trim_start_matches('[').trim_end_matches(']');
    unbracketed.eq_ignore_ascii_case("localhost")
        || unbracketed == "127.0.0.1"
        || unbracketed == "::1"
}

/// Carica la configurazione da disco; se il file non esiste, lo crea con un nuovo `hostId`.
pub fn load_or_create_config(path: &Path) -> Result<RemoteConfig, String> {
    let _guard = remote_config_lock();
    if !path.exists() {
        let default_config = RemoteConfig::new_default();
        save_config_inner(path, &default_config)?;
        return Ok(default_config);
    }

    let bytes = fs::read(path).map_err(|e| format!("Lettura {} fallita: {e}", path.display()))?;
    let mut config: RemoteConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Parsing JSON di {} fallito: {e}", path.display()))?;

    let mut modified = false;
    if config.host_id.trim().is_empty() {
        config.host_id = Uuid::new_v4().to_string();
        modified = true;
    }
    if config.machine_name.trim().is_empty() {
        config.machine_name = default_machine_name();
        modified = true;
    }

    if modified {
        save_config_inner(path, &config)?;
    }

    Ok(config)
}

/// Salva la configurazione sul file indicato in modo atomico e con permessi 0600 su Unix.
pub fn save_config(path: &Path, config: &RemoteConfig) -> Result<(), String> {
    let _guard = remote_config_lock();
    save_config_inner(path, config)
}

fn save_config_inner(path: &Path, config: &RemoteConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Creazione cartella {} fallita: {e}", parent.display()))?;
    }

    let json_bytes = serde_json::to_vec_pretty(config)
        .map_err(|e| format!("Serializzazione configurazione remota fallita: {e}"))?;

    crate::fs_atomic::atomic_write(path, &json_bytes)?;

    // Su Unix assicura modalita' restrittiva 0600 (lettura/scrittura solo per il proprietario)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// Percorso canonico di `remote.json` nella cartella dati locali dell'applicazione.
pub fn default_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("remote.json"))
        .map_err(|e| format!("Impossibile determinare app_local_data_dir: {e}"))
}
