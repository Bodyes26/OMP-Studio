use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::command;

const VERIFIED_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const CHECK_DEBOUNCE_MS: i64 = 10_000;
const COMMANDCODE_POLL_TTL_MS: i64 = 5 * 60 * 1000;
const PROBE_TIMEOUT_SECS: u64 = 5;
const COMMANDCODE_IDENTITY_URL: &str = "https://api.commandcode.ai/alpha/whoami";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthenticationDto {
    pub status: String,
    pub checked_at: Option<i64>,
    pub detail: Option<String>,
}

#[derive(Clone)]
struct CredentialInfo {
    signature: [u8; 32],
    active: usize,
    disabled: bool,
}

#[derive(Clone)]
struct Observation {
    signature: Option<[u8; 32]>,
    status: &'static str,
    checked_at: i64,
}

#[derive(Default)]
struct AuthStore {
    credentials: HashMap<String, CredentialInfo>,
    observations: HashMap<String, Observation>,
}

static AUTH_STORE: LazyLock<Mutex<AuthStore>> = LazyLock::new(|| Mutex::new(AuthStore::default()));
static AUTH_CHECK_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

fn canonical_provider(provider: &str) -> &str {
    match provider {
        "openai-codex-device" => "openai-codex",
        "zai-coding-plan" => "zai",
        other => other,
    }
}

fn dto(status: &'static str, checked_at: Option<i64>) -> ProviderAuthenticationDto {
    ProviderAuthenticationDto {
        status: status.to_string(),
        checked_at,
        detail: None,
    }
}

/// Una lettura per snapshot, fuori dal lock dello stato. I segreti entrano solo nell'hash.
/// Anche un login nello stesso secondo cambia firma se cambia il contenuto della credenziale.
pub fn refresh_credentials() -> Result<(), String> {
    let conn = crate::omp_ops::open_readonly_db("agent.db")?;
    let mut stmt = conn.prepare(
        "SELECT provider, id, updated_at, disabled_cause, data FROM auth_credentials ORDER BY id"
    ).map_err(|_| "Impossibile leggere lo stato delle credenziali".to_string())?;
    let mut rows = stmt
        .query([])
        .map_err(|_| "Impossibile leggere le credenziali".to_string())?;
    let mut hashes: HashMap<String, (Sha256, usize, bool)> = HashMap::new();
    while let Some(row) = rows
        .next()
        .map_err(|_| "Lettura credenziali interrotta".to_string())?
    {
        let provider: String = row
            .get(0)
            .map_err(|_| "Provider non leggibile".to_string())?;
        if provider.contains(':') {
            continue;
        }
        let id: i64 = row
            .get(1)
            .map_err(|_| "Identita credenziale non leggibile".to_string())?;
        let updated: i64 = row
            .get(2)
            .map_err(|_| "Data credenziale non leggibile".to_string())?;
        let disabled: Option<String> = row
            .get(3)
            .map_err(|_| "Stato credenziale non leggibile".to_string())?;
        let data: String = row
            .get(4)
            .map_err(|_| "Credenziale non leggibile".to_string())?;
        let entry = hashes
            .entry(canonical_provider(&provider).to_string())
            .or_insert_with(|| (Sha256::new(), 0, false));
        entry.0.update(id.to_le_bytes());
        entry.0.update(updated.to_le_bytes());
        let cause = disabled.as_deref().unwrap_or("");
        entry.0.update((cause.len() as u64).to_le_bytes());
        entry.0.update(cause.as_bytes());
        entry.0.update((data.len() as u64).to_le_bytes());
        entry.0.update(data.as_bytes());
        if disabled.is_none() {
            entry.1 += 1;
        } else if cause != "deleted by user" && cause != "removed by user" {
            entry.2 = true;
        }
    }
    // Il plugin documenta questa sorgente anche senza login salvato in agent.db.
    if let Ok(key) = std::env::var("COMMAND_CODE_API_KEY") {
        if !key.trim().is_empty() {
            let entry = hashes
                .entry("commandcode".to_string())
                .or_insert_with(|| (Sha256::new(), 0, false));
            entry.0.update(key.trim().as_bytes());
            entry.1 += 1;
        }
    }
    let credentials: HashMap<_, _> = hashes
        .into_iter()
        .map(|(provider, (hash, active, disabled))| {
            (
                provider,
                CredentialInfo {
                    signature: hash.finalize().into(),
                    active,
                    disabled,
                },
            )
        })
        .collect();
    let mut store = AUTH_STORE.lock();
    store.observations.retain(|provider, observation| {
        observation.signature == credentials.get(provider).map(|info| info.signature)
    });
    store.credentials = credentials;
    Ok(())
}

fn signature(provider: &str) -> Option<[u8; 32]> {
    AUTH_STORE
        .lock()
        .credentials
        .get(provider)
        .map(|info| info.signature)
}

fn cached_state(
    store: &AuthStore,
    provider: &str,
    configured: bool,
    now: i64,
) -> ProviderAuthenticationDto {
    if let Some(observation) = store.observations.get(provider) {
        let current_signature = store.credentials.get(provider).map(|info| info.signature);
        if observation.signature == current_signature {
            let status = if observation.status == "verified"
                && now.saturating_sub(observation.checked_at) > VERIFIED_TTL_MS
            {
                "unverified"
            } else {
                observation.status
            };
            return dto(status, Some(observation.checked_at));
        }
    }
    if let Some(info) = store.credentials.get(provider) {
        if info.active == 0 && info.disabled {
            return dto("reauth_required", None);
        }
        if info.active > 0 {
            return dto("unverified", None);
        }
    }
    dto(
        if configured {
            "unverified"
        } else {
            "unconfigured"
        },
        None,
    )
}

/// Nessun I/O sotto il lock: il chiamante aggiorna una volta i metadati dello snapshot.
pub fn provider_authentication(provider: &str, configured: bool) -> ProviderAuthenticationDto {
    cached_state(
        &AUTH_STORE.lock(),
        canonical_provider(provider),
        configured,
        Utc::now().timestamp_millis(),
    )
}

pub fn has_configured_credentials(provider: &str) -> bool {
    AUTH_STORE
        .lock()
        .credentials
        .get(canonical_provider(provider))
        .is_some_and(|info| info.active > 0)
}

fn save_observation(
    provider: &str,
    expected: Option<[u8; 32]>,
    status: &'static str,
) -> ProviderAuthenticationDto {
    let mut store = AUTH_STORE.lock();
    if expected != store.credentials.get(provider).map(|info| info.signature) {
        return cached_state(&store, provider, true, Utc::now().timestamp_millis());
    }
    let now = Utc::now().timestamp_millis();
    // Un timeout non annulla una revoca gia osservata sulle stesse credenziali.
    if status == "unavailable"
        && store
            .observations
            .get(provider)
            .is_some_and(|entry| entry.status == "reauth_required")
    {
        return cached_state(&store, provider, true, now);
    }
    store.observations.insert(
        provider.to_string(),
        Observation {
            signature: expected,
            status,
            checked_at: now,
        },
    );
    dto(status, Some(now))
}

#[derive(Default)]
struct UsageEvidence {
    verified: bool,
    failed_auth: bool,
    unavailable: bool,
}

/// Aggregazione per snapshot: un successo corrente vince sull'errore di un altro account,
/// non un vecchio successo conservato nella cache.
fn usage_evidence(value: &serde_json::Value) -> HashMap<String, UsageEvidence> {
    let mut evidence = HashMap::<String, UsageEvidence>::new();
    if let Some(reports) = value.get("reports").and_then(|value| value.as_array()) {
        for report in reports {
            let Some(provider) = report
                .get("provider")
                .and_then(|value| value.as_str())
                .filter(|id| !id.is_empty())
            else {
                continue;
            };
            let entry = evidence
                .entry(canonical_provider(provider).to_string())
                .or_default();
            let status = report
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let failed = report.get("error").is_some_and(|error| !error.is_null())
                || matches!(status, "offline" | "error" | "unavailable" | "unauthorized");
            if failed {
                entry.unavailable = true;
            } else if report.get("limits").is_some_and(|limits| limits.is_array())
                || report
                    .get("metadata")
                    .is_some_and(|metadata| metadata.is_object())
            {
                entry.verified = true;
            }
        }
    }
    if let Some(disabled) = value
        .get("disabledCredentials")
        .and_then(|value| value.as_array())
    {
        for account in disabled {
            let cause = account
                .get("cause")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if cause == "deleted by user" || cause == "removed by user" {
                continue;
            }
            let Some(provider) = account
                .get("provider")
                .and_then(|value| value.as_str())
                .filter(|id| !id.is_empty())
            else {
                continue;
            };
            evidence
                .entry(canonical_provider(provider).to_string())
                .or_default()
                .failed_auth = true;
        }
    }
    evidence
}

fn evidence_status(evidence: &UsageEvidence, active: usize) -> &'static str {
    if evidence.verified {
        "verified"
    } else if evidence.failed_auth && active == 0 {
        "reauth_required"
    } else if evidence.unavailable {
        "unavailable"
    } else {
        "unverified"
    }
}

pub fn observe_usage(value: &serde_json::Value) {
    if refresh_credentials().is_err() {
        return;
    }
    for (provider, evidence) in usage_evidence(value) {
        let (expected, active) = {
            let store = AUTH_STORE.lock();
            (
                store.credentials.get(&provider).map(|info| info.signature),
                store
                    .credentials
                    .get(&provider)
                    .map_or(0, |info| info.active),
            )
        };
        save_observation(&provider, expected, evidence_status(&evidence, active));
    }
}

fn commandcode_keys() -> Result<Vec<String>, String> {
    let conn = crate::omp_ops::open_readonly_db("agent.db")?;
    let mut stmt = conn.prepare("SELECT data FROM auth_credentials WHERE provider = 'commandcode' AND disabled_cause IS NULL")
        .map_err(|_| "Credenziali Command Code non leggibili".to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "Credenziali Command Code non leggibili".to_string())?;
    let mut keys = Vec::new();
    for row in rows {
        let data = row.map_err(|_| "Credenziale Command Code non leggibile".to_string())?;
        let value: serde_json::Value = serde_json::from_str(&data)
            .map_err(|_| "Formato credenziale Command Code non leggibile".to_string())?;
        // Il plugin salva una API key in access; nessun refresh OAuth viene reimplementato.
        let key = value
            .get("access")
            .or_else(|| value.get("key"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if !key.is_empty() && !keys.iter().any(|existing| existing == key) {
            keys.push(key.to_string());
        }
    }
    if let Ok(key) = std::env::var("COMMAND_CODE_API_KEY") {
        let key = key.trim();
        if !key.is_empty() && !keys.iter().any(|existing| existing == key) {
            keys.push(key.to_string());
        }
    }
    Ok(keys)
}

fn http_status(status: u16) -> &'static str {
    match status {
        200..=299 | 429 => "verified",
        401 => "reauth_required",
        _ => "unavailable",
    }
}

#[cfg(target_os = "windows")]
async fn commandcode_curl(key: String) -> &'static str {
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        // Percorso di sistema: non eseguire un curl.exe trovato nel progetto corrente.
        let Some(root) = std::env::var_os("SystemRoot") else {
            return "unavailable";
        };
        let curl = std::path::PathBuf::from(root)
            .join("System32")
            .join("curl.exe");
        let mut command = std::process::Command::new(curl);
        command.creation_flags(0x08000000);
        command
            .args([
                "--silent",
                "--output",
                "NUL",
                "--write-out",
                "%{http_code}",
                "--max-time",
                "5",
                "--connect-timeout",
                "5",
                "--proto",
                "=https",
                "--config",
                "-",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let Ok(mut child) = command.spawn() else {
            return "unavailable";
        };
        if let Some(mut stdin) = child.stdin.take() {
            // La quotatura protegge anche virgolette e backslash: il token non compare in argv.
            let Ok(header) = serde_json::to_string(&format!("Authorization: Bearer {key}")) else {
                return "unavailable";
            };
            if writeln!(
                stdin,
                "header = {header}\nurl = \"{COMMANDCODE_IDENTITY_URL}\""
            )
            .is_err()
            {
                let _ = child.kill();
                let _ = child.wait();
                return "unavailable";
            }
        }
        let Ok(output) = child.wait_with_output() else {
            return "unavailable";
        };
        if !output.status.success() {
            return "unavailable";
        }
        std::str::from_utf8(&output.stdout)
            .ok()
            .and_then(|text| text.trim().parse::<u16>().ok())
            .map_or("unavailable", http_status)
    })
    .await
    .unwrap_or("unavailable")
}

async fn probe_commandcode(key: &str) -> &'static str {
    if key.is_empty() || key.bytes().any(|byte| !(0x21..=0x7e).contains(&byte)) {
        return "unavailable";
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build();
    if let Ok(client) = client {
        if let Ok(response) = client
            .get(COMMANDCODE_IDENTITY_URL)
            .bearer_auth(key)
            .header("Accept", "application/json")
            .send()
            .await
        {
            return http_status(response.status().as_u16());
        }
    }
    // Schannel usa le CA enterprise del sistema quando rustls non riesce a verificarle.
    #[cfg(target_os = "windows")]
    {
        return commandcode_curl(key.to_string()).await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        "unavailable"
    }
}

async fn probe_commandcode_accounts() -> &'static str {
    let Ok(keys) = commandcode_keys() else {
        return "unavailable";
    };
    if keys.is_empty() {
        return "unverified";
    }
    let mut all_rejected = true;
    for key in keys {
        match probe_commandcode(&key).await {
            "verified" => return "verified",
            "reauth_required" => {}
            _ => all_rejected = false,
        }
    }
    if all_rejected {
        "reauth_required"
    } else {
        "unavailable"
    }
}

async fn probe_omp_usage(provider: &str) -> &'static str {
    let cli_provider = provider.to_string();
    let output = tokio::task::spawn_blocking(move || {
        let mut command = std::process::Command::new(crate::omp_ops::get_omp_binary());
        command.args(["usage", "--provider", &cli_provider, "--json"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        crate::omp_ops::omp_capture(command)
    })
    .await;
    let Ok(Ok(output)) = output else {
        return "unavailable";
    };
    if !output.status.success() {
        return "unavailable";
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return "unavailable";
    };
    let evidence = usage_evidence(&value);
    let Some(evidence) = evidence.get(provider) else {
        // Non tutti i provider espongono quote: nessuna richiesta al modello per verificarli.
        return "unverified";
    };
    let active = AUTH_STORE
        .lock()
        .credentials
        .get(provider)
        .map_or(0, |info| info.active);
    evidence_status(evidence, active)
}

#[command]
pub async fn check_provider_authentication(
    provider_id: String,
) -> Result<ProviderAuthenticationDto, String> {
    let provider = canonical_provider(provider_id.trim()).to_string();
    if provider.is_empty() || provider.contains('/') || provider.starts_with('-') {
        return Err("Provider non valido".to_string());
    }
    let _serial = AUTH_CHECK_LOCK.lock().await;
    if refresh_credentials().is_err() {
        return Ok(dto("unavailable", Some(Utc::now().timestamp_millis())));
    }
    let (expected, active, cached) = {
        let store = AUTH_STORE.lock();
        let info = store.credentials.get(&provider);
        (
            info.map(|info| info.signature),
            info.map_or(0, |info| info.active),
            cached_state(&store, &provider, true, Utc::now().timestamp_millis()),
        )
    };
    if cached
        .checked_at
        .is_some_and(|at| Utc::now().timestamp_millis().saturating_sub(at) < CHECK_DEBOUNCE_MS)
    {
        return Ok(cached);
    }
    if active == 0 {
        return Ok(cached);
    }
    let status = if provider == "commandcode" {
        probe_commandcode_accounts().await
    } else {
        probe_omp_usage(&provider).await
    };
    if refresh_credentials().is_err() {
        return Ok(dto("unavailable", Some(Utc::now().timestamp_millis())));
    }
    Ok(save_observation(&provider, expected, status))
}

#[command]
pub async fn record_provider_authentication(
    provider_id: String,
    outcome: String,
) -> Result<ProviderAuthenticationDto, String> {
    if outcome == "reauth_required" {
        // L'evento non identifica l'account: riverifica prima di invalidare l'intero provider.
        AUTH_STORE
            .lock()
            .observations
            .remove(canonical_provider(&provider_id));
        return check_provider_authentication(provider_id).await;
    }
    let status = match outcome.as_str() {
        "verified" => "verified",
        "unavailable" => "unavailable",
        _ => return Err("Esito autenticazione non valido".to_string()),
    };
    refresh_credentials()?;
    let provider = canonical_provider(&provider_id);
    let expected = signature(provider);
    Ok(save_observation(provider, expected, status))
}

#[command]
pub async fn get_provider_authentication_states(
) -> Result<HashMap<String, ProviderAuthenticationDto>, String> {
    tokio::task::spawn_blocking(|| {
        refresh_credentials()?;
        let store = AUTH_STORE.lock();
        let now = Utc::now().timestamp_millis();
        let mut states = HashMap::new();
        for provider in store.credentials.keys().chain(store.observations.keys()) {
            if !states.contains_key(provider) {
                states.insert(provider.clone(), cached_state(&store, provider, false, now));
            }
        }
        Ok(states)
    })
    .await
    .map_err(|e| format!("Task get_provider_authentication_states fallito: {e}"))?
}

pub async fn check_commandcode_if_due() {
    if refresh_credentials().is_err() {
        return;
    }
    let due = {
        let store = AUTH_STORE.lock();
        store
            .credentials
            .get("commandcode")
            .is_some_and(|info| info.active > 0)
            && !store
                .observations
                .get("commandcode")
                .is_some_and(|observation| {
                    Utc::now()
                        .timestamp_millis()
                        .saturating_sub(observation.checked_at)
                        < COMMANDCODE_POLL_TTL_MS
                })
    };
    if due {
        let _ = check_provider_authentication("commandcode".to_string()).await;
    }
}

pub async fn refresh_auth_snapshot() -> Result<(), String> {
    let _ = crate::omp_ops::usage_snapshot(true).await;
    // usage_snapshot puo' essere in cache: il debounce impedisce richieste duplicate.
    check_commandcode_if_due().await;
    refresh_credentials()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn current_success_wins_over_a_disabled_account_but_old_success_does_not() {
        let value = json!({"reports":[{"provider":"example","limits":[]}],"disabledCredentials":[{"provider":"example","cause":"invalid token"}]});
        assert_eq!(
            evidence_status(&usage_evidence(&value)["example"], 1),
            "verified"
        );
        let rejected = json!({"reports":[],"disabledCredentials":[{"provider":"example","cause":"invalid token"}]});
        assert_eq!(
            evidence_status(&usage_evidence(&rejected)["example"], 0),
            "reauth_required"
        );
        assert_eq!(
            evidence_status(&usage_evidence(&rejected)["example"], 1),
            "unverified"
        );
    }

    #[test]
    fn network_failures_and_deleted_accounts_do_not_prove_a_login_failure() {
        let network = json!({"reports":[{"provider":"example","status":"offline","limits":[]}]});
        assert_eq!(
            evidence_status(&usage_evidence(&network)["example"], 1),
            "unavailable"
        );
        let deleted =
            json!({"disabledCredentials":[{"provider":"example","cause":"deleted by user"}]});
        assert!(!usage_evidence(&deleted).contains_key("example"));
        assert_eq!(http_status(403), "unavailable");
        assert_eq!(http_status(401), "reauth_required");
        assert_eq!(http_status(429), "verified");
    }

    #[test]
    fn new_credentials_invalidate_a_previous_rejection() {
        let mut store = AuthStore::default();
        store.credentials.insert(
            "example".into(),
            CredentialInfo {
                signature: [2; 32],
                active: 1,
                disabled: false,
            },
        );
        store.observations.insert(
            "example".into(),
            Observation {
                signature: Some([1; 32]),
                status: "reauth_required",
                checked_at: 10,
            },
        );
        assert_eq!(
            cached_state(&store, "example", true, 20).status,
            "unverified"
        );
        store.observations.get_mut("example").unwrap().signature = Some([2; 32]);
        store.observations.get_mut("example").unwrap().status = "verified";
        assert_eq!(cached_state(&store, "example", true, 20).status, "verified");
        assert_eq!(
            cached_state(&store, "example", true, VERIFIED_TTL_MS + 11).status,
            "unverified"
        );
    }
}
