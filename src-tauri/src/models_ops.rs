use crate::fs_atomic::atomic_write;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

static CONFIG_MUTATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
/// Serve solo a dare un nome unico alle directory dei test.
#[cfg(test)]
static TEMP_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

fn mutation_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CONFIG_MUTATION_LOCK
        .lock()
        .map_err(|_| "Lock configurazione non disponibile".to_string())
}

fn read_yaml_mapping(path: &Path) -> Result<Option<serde_yaml::Mapping>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("Lettura {}: {}", path.display(), error));
        }
    };
    let value: serde_yaml::Value = serde_yaml::from_slice(&bytes)
        .map_err(|error| format!("Parsing YAML {}: {}", path.display(), error))?;
    value
        .as_mapping()
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("Struttura {} non valida (atteso dizionario)", path.display()))
}

fn read_json_mapping(path: &Path) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("Lettura {}: {}", path.display(), error));
        }
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Parsing JSON {}: {}", path.display(), error))?;
    value
        .as_object()
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("Struttura {} non valida (atteso dizionario)", path.display()))
}

fn get_user_home() -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(home);
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.is_empty() {
            return Some(home);
        }
    }
    None
}

fn agent_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    let home = get_user_home()?;
    let mut path = PathBuf::from(home);
    path.push(".omp");
    path.push("agent");
    Some(path)
}

fn get_db_path(db_name: &str) -> Option<PathBuf> {
    let mut path = agent_dir()?;
    path.push(db_name);
    Some(path)
}

fn open_readonly_db(db_name: &str) -> Result<Connection, String> {
    let path = get_db_path(db_name).ok_or("Impossibile risolvere il percorso del database")?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Impossibile aprire {} : {}", db_name, e))?;
    let _ = conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
    Ok(conn)
}

/// Come `open_readonly_db`, ma in scrittura: serve solo a disattivare una
/// credenziale (`remove_auth_account`). Nessuna creazione automatica del
/// file: se `agent.db` non esiste non c'e' nulla da rimuovere.
fn open_readwrite_db(db_name: &str) -> Result<Connection, String> {
    let path = get_db_path(db_name).ok_or("Impossibile risolvere il percorso del database")?;
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("Impossibile aprire {} in scrittura: {}", db_name, e))?;
    let _ = conn.execute_batch("PRAGMA busy_timeout = 3000;");
    Ok(conn)
}

// -----------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigDto {
    pub model_roles: HashMap<String, String>,
    pub cycle_order: Vec<String>,
    pub disabled_providers: Vec<String>,
    pub fallback_chains: HashMap<String, Vec<String>>,
    pub default_thinking_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelThinkingInfo {
    pub mode: Option<String>,
    pub efforts: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDto {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub selector: String,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
    pub thinking: Option<ModelThinkingInfo>,
    pub input: Option<Vec<String>>,
    pub cost: Option<ModelCost>,
    pub is_custom: bool,
}

#[derive(Debug, Deserialize)]
struct AvailableModelsResponse {
    models: Vec<AvailableModel>,
}

/// `omp models --json` pubblica `thinking` come elenco piatto degli sforzi
/// supportati, non come l'oggetto `{mode, efforts}` della cache locale: il
/// catalogo dei modelli disponibili ha quindi un DTO proprio, convertito poi
/// nella forma che il frontend riceve da `get_models_catalog`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvailableModel {
    id: String,
    name: Option<String>,
    provider: String,
    selector: String,
    context_window: Option<u64>,
    max_tokens: Option<u64>,
    reasoning: Option<bool>,
    thinking: Option<Vec<String>>,
    input: Option<Vec<String>>,
    cost: Option<ModelCost>,
}

impl From<AvailableModel> for ModelDto {
    fn from(model: AvailableModel) -> Self {
        let name = model.name.unwrap_or_else(|| model.id.clone());
        ModelDto {
            id: model.id,
            name,
            provider: model.provider,
            selector: model.selector,
            context_window: model.context_window,
            max_tokens: model.max_tokens,
            reasoning: model.reasoning,
            thinking: model.thinking.map(|efforts| ModelThinkingInfo {
                mode: None,
                efforts: Some(efforts),
            }),
            input: model.input,
            cost: model.cost,
            is_custom: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModelDef {
    pub id: String,
    pub name: String,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
    pub input: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderDef {
    pub base_url: String,
    pub api_key: Option<String>,
    pub api: Option<String>,
    pub models: Vec<CustomModelDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProvidersFile {
    pub providers: HashMap<String, CustomProviderDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProviderSummary {
    pub provider: String,
    pub credential_type: String,
    pub identity_key: Option<String>,
    pub has_credential: bool,
    pub disabled_cause: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummaryDto {
    pub id: String,
    pub name: String,
    /// "builtin" | "plugin" | "custom"
    pub source: String,
    pub enabled: bool,
    pub configured: bool,
    /// "oauth" | "api_key" | "env" | "custom"
    pub auth_origin: Option<String>,
    pub available_model_count: usize,
    pub account_count: usize,
    pub has_oauth: bool,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthAccountDto {
    pub id: i64,
    pub provider: String,
    pub credential_type: String,
    pub identity_key: Option<String>,
    /// Metadati identificativi non segreti, ricavati da `identity_key` e dal
    /// payload `data`. Mai token, chiavi o segreti: quelli restano nel
    /// database e non attraversano mai questo DTO.
    pub email: Option<String>,
    pub account_id: Option<String>,
    pub org_id: Option<String>,
    pub org_name: Option<String>,
    pub plan: Option<String>,
    pub disabled_cause: Option<String>,
    pub has_credential: bool,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpgradeCandidate {
    pub role: String,
    pub current_selector: String,
    pub current_model_id: String,
    pub current_provider: String,
    pub current_thinking: Option<String>,
    pub suggested_selector: String,
    pub suggested_model_id: String,
    pub suggested_model_name: String,
    pub reason: String,
}

// -----------------------------------------------------------------------------
// Commands: Configurazione Ruoli e Modelli
// -----------------------------------------------------------------------------

fn default_model_config() -> ModelConfigDto {
    ModelConfigDto {
        model_roles: HashMap::new(),
        cycle_order: vec![
            "plan".into(),
            "vision".into(),
            "default".into(),
            "smol".into(),
            "task".into(),
            "commit".into(),
        ],
        disabled_providers: Vec::new(),
        fallback_chains: HashMap::new(),
        default_thinking_level: Some("auto".into()),
    }
}

fn yaml_key(name: &str) -> serde_yaml::Value {
    serde_yaml::Value::String(name.to_string())
}

fn parse_yaml_field<T>(
    mapping: &serde_yaml::Mapping,
    name: &str,
    path: &Path,
) -> Result<Option<T>, String>
where
    T: serde::de::DeserializeOwned,
{
    mapping
        .get(yaml_key(name))
        .cloned()
        .map(|value| {
            serde_yaml::from_value(value)
                .map_err(|error| format!("Campo {} non valido in {}: {}", name, path.display(), error))
        })
        .transpose()
}

fn model_config_from_mapping(
    mapping: &serde_yaml::Mapping,
    path: &Path,
) -> Result<ModelConfigDto, String> {
    let mut config = default_model_config();
    config.default_thinking_level = None;
    config.model_roles = parse_yaml_field(mapping, "modelRoles", path)?.unwrap_or_default();
    if let Some(cycle_order) = parse_yaml_field(mapping, "cycleOrder", path)? {
        config.cycle_order = cycle_order;
        if config.cycle_order.is_empty() {
            config.cycle_order = default_model_config().cycle_order;
        }
    }
    config.disabled_providers = parse_yaml_field(mapping, "disabledProviders", path)?.unwrap_or_default();

    if let Some(retry_value) = mapping.get(yaml_key("retry")) {
        let retry = retry_value.as_mapping().ok_or_else(|| {
            format!(
                "Campo retry non valido in {} (atteso dizionario)",
                path.display()
            )
        })?;
        config.fallback_chains = parse_yaml_field(retry, "fallbackChains", path)?.unwrap_or_default();
    }

    if let Some(level) =
        parse_yaml_field::<Option<String>>(mapping, "defaultThinkingLevel", path)?
    {
        config.default_thinking_level = level;
    }
    Ok(config)
}

fn read_model_config_path(path: &Path) -> Result<ModelConfigDto, String> {
    match read_yaml_mapping(path)? {
        Some(mapping) => model_config_from_mapping(&mapping, path),
        None => Ok(default_model_config()),
    }
}

fn save_model_config_locked(path: &Path, config: &ModelConfigDto) -> Result<(), String> {
    let mut mapping = match read_yaml_mapping(path)? {
        Some(mapping) => {
            model_config_from_mapping(&mapping, path)?;
            mapping
        }
        None => serde_yaml::Mapping::new(),
    };

    let roles = serde_yaml::to_value(&config.model_roles)
        .map_err(|error| format!("Serializzazione modelRoles: {}", error))?;
    mapping.insert(yaml_key("modelRoles"), roles);

    let cycle_order = serde_yaml::to_value(&config.cycle_order)
        .map_err(|error| format!("Serializzazione cycleOrder: {}", error))?;
    mapping.insert(yaml_key("cycleOrder"), cycle_order);

    let disabled = serde_yaml::to_value(&config.disabled_providers)
        .map_err(|error| format!("Serializzazione disabledProviders: {}", error))?;
    mapping.insert(yaml_key("disabledProviders"), disabled);

    let retry_key = yaml_key("retry");
    let mut retry = match mapping.get(&retry_key) {
        Some(value) => value.as_mapping().cloned().ok_or_else(|| {
            format!(
                "Campo retry non valido in {} (atteso dizionario)",
                path.display()
            )
        })?,
        None => serde_yaml::Mapping::new(),
    };
    let fallbacks = serde_yaml::to_value(&config.fallback_chains)
        .map_err(|error| format!("Serializzazione fallbackChains: {}", error))?;
    retry.insert(yaml_key("fallbackChains"), fallbacks);
    mapping.insert(retry_key, serde_yaml::Value::Mapping(retry));

    if let Some(level) = &config.default_thinking_level {
        mapping.insert(
            yaml_key("defaultThinkingLevel"),
            serde_yaml::Value::String(level.clone()),
        );
    }

    let serialized = serde_yaml::to_string(&serde_yaml::Value::Mapping(mapping))
        .map_err(|error| format!("Serializzazione {}: {}", path.display(), error))?;
    atomic_write(path, serialized.as_bytes())
}

fn save_model_config_path(path: &Path, config: &ModelConfigDto) -> Result<(), String> {
    let _guard = mutation_lock()?;
    save_model_config_locked(path, config)
}

fn mutate_model_config_path<F>(path: &Path, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut ModelConfigDto),
{
    let _guard = mutation_lock()?;
    let mut config = read_model_config_path(path)?;
    mutate(&mut config);
    save_model_config_locked(path, &config)
}

#[command]
pub async fn get_model_config() -> Result<ModelConfigDto, String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    read_model_config_path(&agent.join("config.yml"))
}

#[command]
pub async fn save_model_config(config: ModelConfigDto) -> Result<(), String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    save_model_config_path(&agent.join("config.yml"), &config)
}

// -----------------------------------------------------------------------------
// Catalogo Modelli (da models.db + models.json)
// -----------------------------------------------------------------------------

#[command]
pub async fn get_models_catalog() -> Result<Vec<ModelDto>, String> {
    let mut catalog = Vec::new();
    let mut seen_selectors = std::collections::HashSet::new();

    // 1. Leggi models.db
    if let Ok(conn) = open_readonly_db("models.db") {
        let mut stmt = conn
            .prepare("SELECT provider_id, models FROM model_cache")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let p_id: String = row.get(0)?;
                let models_json: String = row.get(1)?;
                Ok((p_id, models_json))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (provider_id, json_str) = row;
            let clean_provider = provider_id
                .split(':')
                .next()
                .unwrap_or(&provider_id)
                .to_string();

            if let Ok(raw_models) = serde_json::from_str::<Vec<serde_json::Value>>(&json_str) {
                for m in raw_models {
                    let id = m
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if id.is_empty() {
                        continue;
                    }
                    let name = m
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&id)
                        .to_string();
                    let provider = m
                        .get("provider")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&clean_provider)
                        .to_string();

                    let selector = format!("{}/{}", provider, id);
                    if seen_selectors.contains(&selector) {
                        continue;
                    }
                    seen_selectors.insert(selector.clone());

                    let context_window = m.get("contextWindow").and_then(|v| v.as_u64());
                    let max_tokens = m.get("maxTokens").and_then(|v| v.as_u64());
                    let reasoning = m.get("reasoning").and_then(|v| v.as_bool());

                    let mut thinking_info = None;
                    if let Some(th) = m.get("thinking") {
                        if !th.is_null() {
                            let mode = th
                                .get("mode")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let efforts = th.get("efforts").and_then(|v| v.as_array()).map(|arr| {
                                arr.iter()
                                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                    .collect()
                            });
                            thinking_info = Some(ModelThinkingInfo { mode, efforts });
                        }
                    }

                    let input = m.get("input").and_then(|v| v.as_array()).map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect()
                    });

                    let mut cost_info = None;
                    if let Some(c) = m.get("cost") {
                        cost_info = Some(ModelCost {
                            input: c.get("input").and_then(|v| v.as_f64()),
                            output: c.get("output").and_then(|v| v.as_f64()),
                            cache_read: c.get("cacheRead").and_then(|v| v.as_f64()),
                            cache_write: c.get("cacheWrite").and_then(|v| v.as_f64()),
                        });
                    }

                    catalog.push(ModelDto {
                        id,
                        name,
                        provider,
                        selector,
                        context_window,
                        max_tokens,
                        reasoning,
                        thinking: thinking_info,
                        input,
                        cost: cost_info,
                        is_custom: false,
                    });
                }
            }
        }
    }

    // 2. Leggi provider e modelli custom da models.json
    let custom_defs = get_custom_providers().await?;
    for (provider_name, p_def) in custom_defs.providers {
        for m in p_def.models {
            let selector = format!("{}/{}", provider_name, m.id);
            if seen_selectors.contains(&selector) {
                continue;
            }
            seen_selectors.insert(selector.clone());

            catalog.push(ModelDto {
                id: m.id,
                name: m.name,
                provider: provider_name.clone(),
                selector,
                context_window: m.context_window,
                max_tokens: m.max_tokens,
                reasoning: m.reasoning,
                thinking: None,
                input: m.input,
                cost: None,
                is_custom: true,
            });
        }
    }

    Ok(catalog)
}

fn parse_available_models(stdout: &[u8]) -> Result<Vec<ModelDto>, String> {
    serde_json::from_slice::<AvailableModelsResponse>(stdout)
        .map(|response| response.models.into_iter().map(ModelDto::from).collect())
        .map_err(|error| format!("Risposta di `omp models --json` non valida: {}", error))
}

#[command]
pub async fn get_available_models_catalog() -> Result<Vec<ModelDto>, String> {
    let omp_path = crate::omp_ops::get_omp_binary();
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(omp_path);
        cmd.arg("models").arg("--json");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.output()
    })
    .await
    .map_err(|error| format!("Esecuzione di `omp models --json` interrotta: {}", error))?
    .map_err(|error| format!("Avvio di `omp models --json` fallito: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "`omp models --json` e' terminato con errore: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_available_models(&output.stdout)
}

#[command]
pub async fn refresh_models_catalog() -> Result<Vec<ModelDto>, String> {
    let omp_path = crate::omp_ops::get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("models").arg("refresh");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let _ = cmd.output();
    get_models_catalog().await
}

#[command]
pub async fn refresh_model_provider(provider_id: Option<String>) -> Result<Vec<ModelDto>, String> {
    // `omp models refresh` e' sempre globale: la CLI espone solo
    // `ls|find|refresh|<provider>` come azione, non un refresh per singolo
    // provider. `provider_id` filtra quindi la lista restituita, non la
    // chiamata al binario.
    let catalog = refresh_models_catalog().await?;
    match provider_id {
        Some(provider) => Ok(catalog
            .into_iter()
            .filter(|model| model.provider == provider)
            .collect()),
        None => Ok(catalog),
    }
}

// -----------------------------------------------------------------------------
// Custom Providers (models.json / models.yml)
// -----------------------------------------------------------------------------

fn custom_providers_from_yaml(
    mapping: &serde_yaml::Mapping,
    path: &Path,
) -> Result<CustomProvidersFile, String> {
    serde_yaml::from_value(serde_yaml::Value::Mapping(mapping.clone()))
        .map_err(|error| format!("Struttura provider non valida in {}: {}", path.display(), error))
}

fn json_mapping_to_yaml(
    mapping: serde_json::Map<String, serde_json::Value>,
    path: &Path,
) -> Result<serde_yaml::Mapping, String> {
    let value = serde_yaml::to_value(serde_json::Value::Object(mapping))
        .map_err(|error| format!("Conversione {}: {}", path.display(), error))?;
    value
        .as_mapping()
        .cloned()
        .ok_or_else(|| format!("Struttura {} non valida (atteso dizionario)", path.display()))
}

fn read_custom_providers_paths(
    json_path: &Path,
    yml_path: &Path,
) -> Result<CustomProvidersFile, String> {
    if let Some(mapping) = read_json_mapping(json_path)? {
        return serde_json::from_value(serde_json::Value::Object(mapping)).map_err(|error| {
            format!(
                "Struttura provider non valida in {}: {}",
                json_path.display(),
                error
            )
        });
    }
    if let Some(mapping) = read_yaml_mapping(yml_path)? {
        return custom_providers_from_yaml(&mapping, yml_path);
    }
    Ok(CustomProvidersFile {
        providers: HashMap::new(),
    })
}

fn copy_yaml_fields(
    target: &mut serde_yaml::Mapping,
    source: &serde_yaml::Mapping,
    fields: &[&str],
) {
    for field in fields {
        let key = yaml_key(field);
        if let Some(value) = source.get(&key) {
            target.insert(key, value.clone());
        }
    }
}

fn merge_provider_models(
    existing: Option<&serde_yaml::Value>,
    desired: &serde_yaml::Value,
    provider_name: &str,
) -> Result<serde_yaml::Value, String> {
    let desired_models = desired
        .as_sequence()
        .ok_or_else(|| format!("Models provider {} non validi", provider_name))?;
    let existing_models: &[serde_yaml::Value] = match existing {
        Some(value) => value
            .as_sequence()
            .ok_or_else(|| format!("Models provider {} non validi", provider_name))?
            .as_slice(),
        None => &[],
    };
    let mut merged = Vec::with_capacity(desired_models.len());

    for desired_model in desired_models {
        let desired_mapping = desired_model
            .as_mapping()
            .ok_or_else(|| format!("Modello provider {} non valido", provider_name))?;
        let id = desired_mapping
            .get(yaml_key("id"))
            .and_then(serde_yaml::Value::as_str)
            .ok_or_else(|| format!("Modello provider {} senza id", provider_name))?;
        let mut model_mapping = match existing_models
            .iter()
            .filter_map(serde_yaml::Value::as_mapping)
            .find(|mapping| {
                mapping
                    .get(yaml_key("id"))
                    .and_then(serde_yaml::Value::as_str)
                    == Some(id)
            }) {
            Some(mapping) => mapping.clone(),
            None => serde_yaml::Mapping::new(),
        };
        copy_yaml_fields(
            &mut model_mapping,
            desired_mapping,
            &[
                "id",
                "name",
                "contextWindow",
                "maxTokens",
                "reasoning",
                "input",
            ],
        );
        merged.push(serde_yaml::Value::Mapping(model_mapping));
    }

    Ok(serde_yaml::Value::Sequence(merged))
}

fn merge_custom_providers(
    root: &mut serde_yaml::Mapping,
    data: &CustomProvidersFile,
) -> Result<(), String> {
    let desired = serde_yaml::to_value(data)
        .map_err(|error| format!("Serializzazione provider: {}", error))?;
    let desired_root = desired
        .as_mapping()
        .ok_or("Serializzazione provider non valida")?;
    let desired_providers = desired_root
        .get(yaml_key("providers"))
        .and_then(serde_yaml::Value::as_mapping)
        .ok_or("Serializzazione providers non valida")?;

    let providers_key = yaml_key("providers");
    let existing_providers = match root.get(&providers_key) {
        Some(value) => value
            .as_mapping()
            .ok_or("Campo providers non valido (atteso dizionario)")?
            .clone(),
        None => serde_yaml::Mapping::new(),
    };
    let mut merged_providers = serde_yaml::Mapping::new();

    for (provider_key, desired_provider) in desired_providers {
        let provider_name = provider_key
            .as_str()
            .ok_or("Nome provider non valido")?;
        let desired_mapping = desired_provider
            .as_mapping()
            .ok_or_else(|| format!("Provider {} non valido", provider_name))?;
        let mut provider_mapping = match existing_providers.get(provider_key) {
            Some(value) => value
                .as_mapping()
                .cloned()
                .ok_or_else(|| format!("Provider {} non valido", provider_name))?,
            None => serde_yaml::Mapping::new(),
        };
        copy_yaml_fields(
            &mut provider_mapping,
            desired_mapping,
            &["baseUrl", "apiKey", "api"],
        );
        let models_key = yaml_key("models");
        let desired_models = desired_mapping
            .get(&models_key)
            .ok_or_else(|| format!("Provider {} senza models", provider_name))?;
        let models = merge_provider_models(
            provider_mapping.get(&models_key),
            desired_models,
            provider_name,
        )?;
        provider_mapping.insert(models_key, models);
        merged_providers.insert(
            provider_key.clone(),
            serde_yaml::Value::Mapping(provider_mapping),
        );
    }

    root.insert(
        providers_key,
        serde_yaml::Value::Mapping(merged_providers),
    );
    Ok(())
}

fn save_custom_providers_paths(
    json_path: &Path,
    yml_path: &Path,
    data: &CustomProvidersFile,
) -> Result<(), String> {
    let _guard = mutation_lock()?;
    let json_mapping = read_json_mapping(json_path)?;
    let yaml_mapping = read_yaml_mapping(yml_path)?;

    let json_yaml = json_mapping
        .map(|mapping| json_mapping_to_yaml(mapping, json_path))
        .transpose()?;
    if let Some(mapping) = &json_yaml {
        custom_providers_from_yaml(mapping, json_path)?;
    }
    if let Some(mapping) = &yaml_mapping {
        custom_providers_from_yaml(mapping, yml_path)?;
    }

    let mut json_root = match (&json_yaml, &yaml_mapping) {
        (Some(mapping), _) | (None, Some(mapping)) => mapping.clone(),
        (None, None) => serde_yaml::Mapping::new(),
    };
    let mut yaml_root = match (&yaml_mapping, &json_yaml) {
        (Some(mapping), _) | (None, Some(mapping)) => mapping.clone(),
        (None, None) => serde_yaml::Mapping::new(),
    };
    merge_custom_providers(&mut json_root, data)?;
    merge_custom_providers(&mut yaml_root, data)?;

    let json_value = serde_json::to_value(serde_yaml::Value::Mapping(json_root))
        .map_err(|error| format!("Serializzazione {}: {}", json_path.display(), error))?;
    let json = serde_json::to_vec_pretty(&json_value)
        .map_err(|error| format!("Serializzazione {}: {}", json_path.display(), error))?;
    let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(yaml_root))
        .map_err(|error| format!("Serializzazione {}: {}", yml_path.display(), error))?;

    atomic_write(json_path, &json)?;
    atomic_write(yml_path, yaml.as_bytes())
}

#[command]
pub async fn get_custom_providers() -> Result<CustomProvidersFile, String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    read_custom_providers_paths(&agent.join("models.json"), &agent.join("models.yml"))
}

#[command]
pub async fn save_custom_providers(data: CustomProvidersFile) -> Result<(), String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    save_custom_providers_paths(
        &agent.join("models.json"),
        &agent.join("models.yml"),
        &data,
    )
}

// -----------------------------------------------------------------------------
// Autenticazione Provider (agent.db)
// -----------------------------------------------------------------------------

#[command]
pub async fn get_auth_providers_summary() -> Result<Vec<AuthProviderSummary>, String> {
    let conn = open_readonly_db("agent.db")?;
    let mut stmt = conn
        .prepare(
            "SELECT provider, credential_type, identity_key, disabled_cause FROM auth_credentials",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let provider: String = row.get(0)?;
            let credential_type: String = row.get(1)?;
            let identity_key: Option<String> = row.get(2)?;
            let disabled_cause: Option<String> = row.get(3)?;
            Ok(AuthProviderSummary {
                provider,
                credential_type,
                identity_key,
                has_credential: true,
                disabled_cause,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows.flatten() {
        list.push(r);
    }
    Ok(list)
}

/// Metadati identificativi ricavati da `identity_key` (mai un segreto: e'
/// solo una chiave di deduplica leggibile scritta da `omp`), nelle forme
/// osservate `email:...`, `account:...|org:...`, `org:...`, `project:...`.
#[derive(Debug, Default, Clone)]
struct IdentityKeyFields {
    email: Option<String>,
    account_id: Option<String>,
    org_id: Option<String>,
}

fn parse_identity_key(identity_key: &str) -> IdentityKeyFields {
    let mut fields = IdentityKeyFields::default();
    for segment in identity_key.split('|') {
        let Some((key, value)) = segment.trim().split_once(':') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "email" if fields.email.is_none() => fields.email = Some(value.to_string()),
            "account" if fields.account_id.is_none() => fields.account_id = Some(value.to_string()),
            "org" | "organization" if fields.org_id.is_none() => fields.org_id = Some(value.to_string()),
            // Nessun campo dedicato per un identificativo di progetto (GCP e
            // simili): resta comunque l'identita' dell'account sul provider.
            "project" if fields.account_id.is_none() => fields.account_id = Some(value.to_string()),
            _ => {}
        }
    }
    fields
}

/// Legge la prima chiave presente tra varie forme lecite di un oggetto JSON
/// e ne restituisce il valore stringa, mai vuoto. Usata solo su campi non
/// segreti (email, id account/org, piano, hint di provenienza): le chiavi
/// del token (`access`, `refresh`, `key`, ...) non vengono mai lette qui.
fn extract_json_string(data: &serde_json::Value, keys: &[&str]) -> Option<String> {
    let obj = data.as_object()?;
    keys.iter().find_map(|key| {
        obj.get(*key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    })
}

#[allow(clippy::too_many_arguments)]
fn build_auth_account_dto(
    id: i64,
    provider: String,
    credential_type: String,
    identity_key: Option<String>,
    disabled_cause: Option<String>,
    data: &str,
    created_at: Option<i64>,
    updated_at: Option<i64>,
) -> AuthAccountDto {
    let identity_fields = identity_key
        .as_deref()
        .map(parse_identity_key)
        .unwrap_or_default();
    // Il payload puo' non essere JSON valido (schema futuro/estensioni): un
    // parsing fallito non deve mai far fallire la lista degli account, resta
    // solo senza i metadati opzionali.
    let data_json = serde_json::from_str::<serde_json::Value>(data).ok();

    let email = identity_fields.email.or_else(|| {
        data_json
            .as_ref()
            .and_then(|d| extract_json_string(d, &["email", "userEmail", "user_email"]))
    });
    let account_id = identity_fields.account_id.or_else(|| {
        data_json
            .as_ref()
            .and_then(|d| extract_json_string(d, &["accountId", "account_id", "userId", "user_id"]))
    });
    let org_id = identity_fields.org_id.or_else(|| {
        data_json.as_ref().and_then(|d| {
            extract_json_string(d, &["orgId", "org_id", "organizationId", "organization_id"])
        })
    });
    let org_name = data_json.as_ref().and_then(|d| {
        extract_json_string(
            d,
            &["orgName", "org_name", "organizationName", "organization_name"],
        )
    });
    let plan = data_json
        .as_ref()
        .and_then(|d| extract_json_string(d, &["plan", "planType", "plan_type", "subscription"]));

    AuthAccountDto {
        id,
        provider,
        credential_type,
        identity_key,
        email,
        account_id,
        org_id,
        org_name,
        plan,
        disabled_cause,
        has_credential: true,
        created_at,
        updated_at,
    }
}

#[command]
pub async fn get_auth_accounts(provider_id: Option<String>) -> Result<Vec<AuthAccountDto>, String> {
    let conn = open_readonly_db("agent.db")?;
    let mut stmt = conn
        .prepare(
            "SELECT id, provider, credential_type, identity_key, disabled_cause, data, created_at, updated_at \
             FROM auth_credentials WHERE ?1 IS NULL OR provider = ?1 ORDER BY provider, id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![provider_id], |row| {
            let id: i64 = row.get(0)?;
            let provider: String = row.get(1)?;
            let credential_type: String = row.get(2)?;
            let identity_key: Option<String> = row.get(3)?;
            let disabled_cause: Option<String> = row.get(4)?;
            let data: String = row.get(5)?;
            let created_at: Option<i64> = row.get(6)?;
            let updated_at: Option<i64> = row.get(7)?;
            Ok((
                id,
                provider,
                credential_type,
                identity_key,
                disabled_cause,
                data,
                created_at,
                updated_at,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (id, provider, credential_type, identity_key, disabled_cause, data, created_at, updated_at) =
            row.map_err(|e| e.to_string())?;
        list.push(build_auth_account_dto(
            id,
            provider,
            credential_type,
            identity_key,
            disabled_cause,
            &data,
            created_at,
            updated_at,
        ));
    }
    Ok(list)
}

#[command]
pub async fn remove_auth_account(provider: String, credential_id: i64) -> Result<(), String> {
    let conn = open_readwrite_db("agent.db")?;
    // Disattivazione soft: stesso meccanismo di `disabled_cause` che `omp`
    // usa gia' per le credenziali scadute o non valide. La riga resta per
    // storia/diagnostica, ma smette immediatamente di essere utilizzabile.
    let changed = conn
        .execute(
            "UPDATE auth_credentials SET disabled_cause = ?1, updated_at = CAST(strftime('%s','now') AS INTEGER) \
             WHERE id = ?2 AND provider = ?3",
            rusqlite::params!["deleted by user", credential_id, provider],
        )
        .map_err(|e| format!("Rimozione credenziale: {}", e))?;

    if changed == 0 {
        return Err(format!(
            "Nessuna credenziale con id {} per il provider '{}'",
            credential_id, provider
        ));
    }
    Ok(())
}

// -----------------------------------------------------------------------------
// Provider Aggregati (builtin + plugin + custom)
// -----------------------------------------------------------------------------

/// Nome leggibile dei provider curati da Studio, allineato a
/// `KNOWN_BUILTIN_PROVIDERS` in `ProvidersTab.svelte`. Chi non compare qui ma
/// esiste nel catalogo o nel database credenziali e' un plugin scoperto a
/// runtime da `omp`, non un provider curato da Studio.
const BUILTIN_PROVIDER_NAMES: &[(&str, &str)] = &[
    ("anthropic", "Anthropic Claude"),
    ("openai-codex", "OpenAI Codex"),
    ("google-antigravity", "Google Antigravity"),
    ("opencode-go", "OpenCode Go"),
    ("opencode-zen", "OpenCode Zen"),
    ("perplexity", "Perplexity Search"),
    ("cerebras", "Cerebras"),
    ("tavily", "Tavily Search"),
    ("ollama-cloud", "Ollama Cloud"),
    ("ollama", "Ollama (Local)"),
    ("openrouter", "OpenRouter"),
    ("cursor", "Cursor AI"),
    ("devin", "Devin AI"),
    ("groq", "Groq LPU"),
    ("mistral", "Mistral AI"),
    ("xai", "xAI Grok"),
    ("zai", "Zhipu AI (GLM)"),
    ("llama.cpp", "llama.cpp (Local)"),
    ("lm-studio", "LM Studio (Local)"),
];

/// Nomi leggibili di plugin conosciuti ma non curati staticamente (registrati
/// da `omp` a runtime, non da Studio). Solo cosmetica: un plugin assente da
/// questa lista resta comunque "plugin", solo con un nome ricavato dall'id.
const PLUGIN_PROVIDER_NAMES: &[(&str, &str)] = &[
    ("commandcode", "Command Code"),
    ("tokenrouter", "TokenRouter"),
    ("xkiro", "Xkiro"),
];

fn humanize_provider_id(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn provider_display_name(id: &str, is_custom: bool) -> String {
    if is_custom {
        return humanize_provider_id(id);
    }
    if let Some((_, name)) = BUILTIN_PROVIDER_NAMES.iter().find(|(bid, _)| *bid == id) {
        return (*name).to_string();
    }
    if let Some((_, name)) = PLUGIN_PROVIDER_NAMES.iter().find(|(bid, _)| *bid == id) {
        return (*name).to_string();
    }
    humanize_provider_id(id)
}

#[derive(Debug, Default, Clone)]
struct ProviderAccountAggregate {
    total: usize,
    has_oauth: bool,
    origin: Option<String>,
}

fn extract_credential_source(data: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(data)
        .ok()
        .and_then(|value| extract_json_string(&value, &["source"]))
}

/// Aggrega gli account per provider. Legge la colonna `data` solo per capire
/// come e' stata ottenuta una `api_key` (`source: "env"` vs interattiva);
/// nessun campo estratto qui attraversa mai un DTO verso il frontend.
/// Fallisce in silenzio (mappa vuota) se `agent.db` manca o non e' leggibile:
/// la lista provider resta comunque utile senza lo stato delle credenziali.
fn read_provider_account_aggregates() -> HashMap<String, ProviderAccountAggregate> {
    let mut aggregates: HashMap<String, ProviderAccountAggregate> = HashMap::new();
    let Ok(conn) = open_readonly_db("agent.db") else {
        return aggregates;
    };
    let Ok(mut stmt) = conn.prepare("SELECT provider, credential_type, data FROM auth_credentials")
    else {
        return aggregates;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let provider: String = row.get(0)?;
        let credential_type: String = row.get(1)?;
        let data: String = row.get(2)?;
        Ok((provider, credential_type, data))
    }) else {
        return aggregates;
    };

    for (provider, credential_type, data) in rows.flatten() {
        // La stessa tabella ospita anche le credenziali OAuth dei server MCP
        // (chiave "mcp_oauth:profile:..."): non sono provider di modelli.
        if provider.contains(':') {
            continue;
        }
        let entry = aggregates.entry(provider).or_default();
        entry.total += 1;
        if credential_type == "oauth" {
            entry.has_oauth = true;
            entry.origin = Some("oauth".to_string());
        } else if entry.origin.as_deref() != Some("oauth") {
            let is_env = extract_credential_source(&data).as_deref() == Some("env");
            entry.origin = Some(if is_env { "env" } else { "api_key" }.to_string());
        }
    }
    aggregates
}

/// Catalogo live (`omp models --json`) arricchito dai provider custom, che
/// il comando `omp` non conosce. Se il binario non risponde ripiega sulla
/// cache locale (`get_models_catalog`), che li include gia'.
async fn build_provider_catalog() -> Vec<ModelDto> {
    match get_available_models_catalog().await {
        Ok(mut live) => {
            let mut seen: std::collections::HashSet<String> =
                live.iter().map(|m| m.selector.clone()).collect();
            if let Ok(custom_defs) = get_custom_providers().await {
                for (provider_name, provider_def) in custom_defs.providers {
                    for model in provider_def.models {
                        let selector = format!("{}/{}", provider_name, model.id);
                        if seen.insert(selector.clone()) {
                            live.push(ModelDto {
                                id: model.id,
                                name: model.name,
                                provider: provider_name.clone(),
                                selector,
                                context_window: model.context_window,
                                max_tokens: model.max_tokens,
                                reasoning: model.reasoning,
                                thinking: None,
                                input: model.input,
                                cost: None,
                                is_custom: true,
                            });
                        }
                    }
                }
            }
            live
        }
        Err(_) => get_models_catalog().await.unwrap_or_default(),
    }
}

#[command]
pub async fn get_model_providers() -> Result<Vec<ProviderSummaryDto>, String> {
    let config = get_model_config()
        .await
        .unwrap_or_else(|_| default_model_config());
    let custom_defs = get_custom_providers().await.unwrap_or_else(|_| CustomProvidersFile {
        providers: HashMap::new(),
    });
    let catalog = build_provider_catalog().await;
    let account_aggregates = read_provider_account_aggregates();

    let mut model_counts: HashMap<String, usize> = HashMap::new();
    for model in &catalog {
        *model_counts.entry(model.provider.clone()).or_insert(0) += 1;
    }

    let mut provider_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    provider_ids.extend(BUILTIN_PROVIDER_NAMES.iter().map(|(id, _)| id.to_string()));
    provider_ids.extend(custom_defs.providers.keys().cloned());
    provider_ids.extend(model_counts.keys().cloned());
    provider_ids.extend(account_aggregates.keys().cloned());

    let mut summaries: Vec<ProviderSummaryDto> = provider_ids
        .into_iter()
        .map(|id| {
            let is_custom = custom_defs.providers.contains_key(&id);
            let aggregate = account_aggregates.get(&id);
            let account_count = aggregate.map(|a| a.total).unwrap_or(0);
            let has_oauth = aggregate.map(|a| a.has_oauth).unwrap_or(false);
            let auth_origin = aggregate
                .and_then(|a| a.origin.clone())
                .or(if is_custom { Some("custom".to_string()) } else { None });
            let source = if is_custom {
                "custom"
            } else if BUILTIN_PROVIDER_NAMES.iter().any(|(bid, _)| *bid == id) {
                "builtin"
            } else {
                "plugin"
            };

            ProviderSummaryDto {
                name: provider_display_name(&id, is_custom),
                source: source.to_string(),
                enabled: !config.disabled_providers.contains(&id),
                configured: account_count > 0 || is_custom,
                auth_origin,
                available_model_count: model_counts.get(&id).copied().unwrap_or(0),
                account_count,
                has_oauth,
                is_custom,
                id,
            }
        })
        .collect();

    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

// -----------------------------------------------------------------------------
// Rilevamento Intelligente Aggiornamenti Versioni Modelli
// -----------------------------------------------------------------------------

/// Estrae il template della famiglia e i numeri di versione/data da un model_id
fn parse_model_signature(model_id: &str) -> (String, Vec<f64>, Option<u64>) {
    let mut clean_id = model_id.to_string();

    // Cerca date nel formato YYYYMMDD o YYYY-MM-DD
    let mut date_val = None;
    if let Some(pos) = clean_id.find("-202") {
        let suffix = &clean_id[pos + 1..];
        let date_digits: String = suffix
            .chars()
            .filter(|c| c.is_ascii_digit())
            .take(8)
            .collect();
        if date_digits.len() == 8 {
            if let Ok(num) = date_digits.parse::<u64>() {
                date_val = Some(num);
            }
        }
        clean_id = clean_id[..pos].to_string();
    }

    // Tokenizza per '-' o '_' o '.'
    let mut template_parts = Vec::new();
    let mut versions = Vec::new();

    let tokens: Vec<&str> = clean_id.split(['-', '_']).collect();
    for (i, t) in tokens.iter().enumerate() {
        if i > 0 {
            template_parts.push("-");
        }

        let mut candidate = *t;
        let mut prefix = "";
        if candidate.starts_with('v') || candidate.starts_with('V') {
            prefix = "v";
            candidate = &candidate[1..];
        } else if candidate.starts_with('k') || candidate.starts_with('K') {
            prefix = "k";
            candidate = &candidate[1..];
        }

        // Verifica se candidate contiene solo numeri e punti (es. "5.6", "4", "2.7")
        let is_version = !candidate.is_empty()
            && candidate
                .split('.')
                .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));

        if is_version {
            for part in candidate.split('.') {
                if let Ok(n) = part.parse::<f64>() {
                    versions.push(n);
                }
            }
            template_parts.push(if !prefix.is_empty() {
                if prefix == "v" {
                    "v{V}"
                } else {
                    "k{V}"
                }
            } else {
                "{V}"
            });
        } else {
            template_parts.push(t);
        }
    }

    (template_parts.concat(), versions, date_val)
}

fn is_version_newer(
    ver_a: &[f64],
    date_a: Option<u64>,
    ver_b: &[f64],
    date_b: Option<u64>,
) -> bool {
    if let (Some(da), Some(db)) = (date_a, date_b) {
        if db > da {
            return true;
        }
    }

    if !ver_a.is_empty() && !ver_b.is_empty() {
        for (a, b) in ver_a.iter().zip(ver_b.iter()) {
            if b > a {
                return true;
            } else if b < a {
                return false;
            }
        }
        if ver_b.len() > ver_a.len() {
            return true;
        }
    } else if ver_a.is_empty() && !ver_b.is_empty() {
        return true;
    }

    false
}

#[command]
pub async fn check_model_upgrades() -> Result<Vec<ModelUpgradeCandidate>, String> {
    let config = get_model_config().await?;
    let catalog = get_models_catalog().await?;

    let mut candidates = Vec::new();

    // 1. Controlla i ruoli configurati
    for (role, full_selector) in &config.model_roles {
        let (raw_selector, thinking_level) = match full_selector.split_once(':') {
            Some((sel, th)) => (sel, Some(th.to_string())),
            None => (full_selector.as_str(), None),
        };

        let (provider, model_id) = match raw_selector.split_once('/') {
            Some((p, m)) => (p, m),
            None => ("", raw_selector),
        };

        if provider.is_empty() || model_id.is_empty() {
            continue;
        }

        let (tpl_cur, ver_cur, date_cur) = parse_model_signature(model_id);

        let mut best_upgrade: Option<(&ModelDto, Vec<f64>, Option<u64>)> = None;

        for m in &catalog {
            if m.provider != provider || m.id == model_id {
                continue;
            }

            let (tpl_cand, ver_cand, date_cand) = parse_model_signature(&m.id);
            if tpl_cand == tpl_cur
                && is_version_newer(&ver_cur, date_cur, &ver_cand, date_cand)
            {
                if let Some((_, best_ver, best_date)) = &best_upgrade {
                    if is_version_newer(best_ver, *best_date, &ver_cand, date_cand) {
                        best_upgrade = Some((m, ver_cand, date_cand));
                    }
                } else {
                    best_upgrade = Some((m, ver_cand, date_cand));
                }
            }
        }

        if let Some((newer_m, _, _)) = best_upgrade {
            let suggested_selector = match &thinking_level {
                Some(th) => format!("{}:{}", newer_m.selector, th),
                None => newer_m.selector.clone(),
            };

            candidates.push(ModelUpgradeCandidate {
                role: role.clone(),
                current_selector: full_selector.clone(),
                current_model_id: model_id.to_string(),
                current_provider: provider.to_string(),
                current_thinking: thinking_level,
                suggested_selector,
                suggested_model_id: newer_m.id.clone(),
                suggested_model_name: newer_m.name.clone(),
                reason: format!("Disponibile nuova versione: {}", newer_m.name),
            });
        }
    }

    Ok(candidates)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeApplyItem {
    pub role: String,
    pub new_selector: String,
}

#[command]
pub async fn apply_model_upgrades(updates: Vec<UpgradeApplyItem>) -> Result<(), String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    let path = agent.join("config.yml");
    mutate_model_config_path(&path, move |config| {
        for item in updates {
            config.model_roles.insert(item.role, item.new_selector);
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedModelItem {
    pub selector: String,
    pub reason: String,
    pub badge: Option<String>,
    pub recommended_thinking: Option<String>,
    pub arena_elo: Option<u32>,
    pub tokens_per_sec: Option<f64>,
    pub is_subscription: Option<bool>,
    pub is_free: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSuggestionsResponse {
    pub role_id: String,
    pub primary: Vec<SuggestedModelItem>,
    pub fallback: Vec<SuggestedModelItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawLlmSuggestedItem {
    pub selector: Option<String>,
    pub reason: Option<String>,
    pub badge: Option<String>,
    #[serde(rename = "recommendedThinking")]
    pub recommended_thinking: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawLlmSuggestions {
    pub primary: Option<Vec<RawLlmSuggestedItem>>,
    pub fallback: Option<Vec<RawLlmSuggestedItem>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntelligenceTier {
    Tier1Plus, // Top Quality (Claude Opus 5, GPT-5.6 Sol/Terra, Claude Fable 5) ~1565+ ELO
    Tier1, // High Intelligence (Gemini 3.7 Flash, Gemini 3.1 Pro, DeepSeek V4 Pro, Claude Opus 4.8) ~1550+ ELO
    Tier2, // Workhorse (Claude Sonnet 5, Claude Sonnet 4.6, Gemini 3.6 Flash, GPT-5.4, GLM-5.3) ~1505+ ELO
    Tier3, // Fast / Daily (DeepSeek V4 Flash, GPT-5.6 Luna, GPT-5.4 Mini, Gemini 3.5 Flash) ~1450+ ELO
    Tier4, // Ultra-light / Atomic (Gemini 3.1 Flash Lite, GPT-5-nano, Gemma 4, Hy3) ~1380-1420 ELO
}

fn get_model_benchmark_profile(model_id: &str, model_name: &str) -> (IntelligenceTier, u32) {
    let lower = format!("{} {}", model_id, model_name).to_lowercase();

    // Tier 1+: Leaderboard top (Coding ELO ~1565+)
    if lower.contains("claude-opus-5")
        || lower.contains("claude-fable-5")
        || lower.contains("gpt-5.6-sol")
        || lower.contains("gpt-5.6-terra")
        || lower.contains("claude-mythos-5")
    {
        return (IntelligenceTier::Tier1Plus, 1566);
    }
    if lower.contains("gpt-5.5-pro") || lower.contains("gpt-5.4-pro") {
        return (IntelligenceTier::Tier1Plus, 1560);
    }

    // Tier 1: Deep reasoning & high ELO (~1550-1558)
    if lower.contains("gemini-3.7-flash")
        || lower.contains("gemini-3.1-pro")
        || lower.contains("deepseek-v4-pro")
        || lower.contains("claude-opus-4-8")
        || lower.contains("claude-opus-4-7")
        || lower.contains("gpt-5.5")
        || lower.contains("grok-4.6")
        || lower.contains("kimi-k3")
        || lower.contains("qwen3.8-max")
    {
        return (IntelligenceTier::Tier1, 1555);
    }

    // Tier 2: Workhorses (~1505-1540)
    if lower.contains("claude-sonnet-5")
        || lower.contains("claude-sonnet-4-6")
        || lower.contains("claude-opus-4-6")
        || lower.contains("gemini-3.6-flash")
        || lower.contains("gemini-3-pro")
        || lower.contains("gpt-5.4")
        || lower.contains("glm-5.3")
        || lower.contains("grok-4.5")
        || lower.contains("claude-opus-4-5")
        || lower.contains("claude-sonnet-4-5")
    {
        return (IntelligenceTier::Tier2, 1520);
    }

    // Tier 3: Fast utility / Daily (~1450-1470)
    if lower.contains("deepseek-v4-flash")
        || lower.contains("gpt-5.6-luna")
        || lower.contains("gpt-5.4-mini")
        || lower.contains("gemini-3.5-flash")
        || lower.contains("gemini-3-flash")
        || lower.contains("gemini-2.5-pro")
        || lower.contains("glm-5.2")
        || lower.contains("glm-5.1")
        || lower.contains("claude-haiku-4-5")
        || lower.contains("claude-3-7-sonnet")
        || lower.contains("gpt-5.2")
        || lower.contains("gpt-5.1")
        || lower.contains("gpt-5")
    {
        return (IntelligenceTier::Tier3, 1465);
    }

    // Tier 4: Lightweight / atomic (~1380-1420)
    if lower.contains("flash-lite")
        || lower.contains("nano")
        || lower.contains("mini")
        || lower.contains("gemma")
        || lower.contains("haiku")
        || lower.contains("deepseek-chat")
        || lower.contains("hy3")
    {
        return (IntelligenceTier::Tier4, 1410);
    }

    (IntelligenceTier::Tier3, 1440)
}

#[derive(Debug, Clone)]
struct ModelPerfStat {
    pub tokens_per_sec: f64,
    #[allow(dead_code)]
    pub avg_ttft_ms: u64,
}

fn get_models_perf_map() -> HashMap<String, ModelPerfStat> {
    let mut map = HashMap::new();
    if let Ok(conn) = open_readonly_db("agent.db") {
        if let Ok(mut stmt) = conn.prepare("SELECT model_key, samples, output_tokens, gen_ms, ttft_samples, ttft_ms FROM model_perf") {
            let rows = stmt.query_map([], |row| {
                let key: String = row.get(0)?;
                let _samples: f64 = row.get(1).unwrap_or(0.0);
                let out_tokens: f64 = row.get(2).unwrap_or(0.0);
                let gen_ms: f64 = row.get(3).unwrap_or(0.0);
                let ttft_samples: f64 = row.get(4).unwrap_or(0.0);
                let ttft_ms: f64 = row.get(5).unwrap_or(0.0);
                Ok((key, out_tokens, gen_ms, ttft_samples, ttft_ms))
            });
            if let Ok(mapped) = rows {
                for r in mapped.flatten() {
                    let (key, out_tokens, gen_ms, ttft_samples, ttft_ms) = r;
                    let tok_per_sec = if gen_ms > 0.0 {
                        out_tokens / (gen_ms / 1000.0)
                    } else {
                        0.0
                    };
                    let avg_ttft_ms = if ttft_samples > 0.0 {
                        (ttft_ms / ttft_samples) as u64
                    } else {
                        0
                    };
                    map.insert(key, ModelPerfStat {
                        tokens_per_sec: tok_per_sec,
                        avg_ttft_ms,
                    });
                }
            }
        }
    }
    map
}

/// Risolve il selettore proposto da un modello di linguaggio dentro un pool
/// ristretto. Il pool si passa come slice di riferimenti perche' il chiamante
/// lo compone da liste diverse senza clonare i modelli.
fn find_matching_catalog_selector<'a>(
    raw_sel: &str,
    pool: &[&'a ModelDto],
) -> Option<&'a ModelDto> {
    let clean = raw_sel.trim();
    if clean.is_empty() {
        return None;
    }
    // 1. Exact match
    if let Some(m) = pool
        .iter()
        .copied()
        .find(|m| m.selector == clean || m.id == clean)
    {
        return Some(m);
    }
    // 2. Case insensitive exact match
    let clean_lower = clean.to_lowercase();
    if let Some(m) = pool
        .iter()
        .copied()
        .find(|m| m.selector.to_lowercase() == clean_lower || m.id.to_lowercase() == clean_lower)
    {
        return Some(m);
    }
    // 3. Substring match
    if let Some(m) = pool.iter().copied().find(|m| {
        m.selector.to_lowercase().contains(&clean_lower)
            || clean_lower.contains(&m.selector.to_lowercase())
    }) {
        return Some(m);
    }
    None
}

#[command]
pub async fn get_role_suggestions(
    role_id: String,
    current_primary: Option<String>,
    current_fallbacks: Vec<String>,
) -> Result<RoleSuggestionsResponse, String> {
    let config = get_model_config().await?;
    let catalog = get_models_catalog().await?;
    let auth_summary = get_auth_providers_summary().await?;
    let custom_defs = get_custom_providers()
        .await
        .unwrap_or_else(|_| CustomProvidersFile {
            providers: HashMap::new(),
        });
    let perf_map = get_models_perf_map();

    // 1. Individua provider attivi e abilitati. I provider custom di
    // `models.json` tengono baseUrl e chiave nel proprio file e non hanno
    // riga in `auth_credentials`: pesarli solo su `auth_summary` li
    // escludeva sempre, e chi ha soltanto provider locali non vedeva mai un
    // suggerimento.
    let active_providers: Vec<String> = auth_summary
        .iter()
        .filter(|a| a.has_credential)
        .map(|a| a.provider.clone())
        .chain(custom_defs.providers.keys().cloned())
        .filter(|provider| !config.disabled_providers.contains(provider))
        .collect();

    if active_providers.is_empty() {
        return Ok(RoleSuggestionsResponse {
            role_id,
            primary: Vec::new(),
            fallback: Vec::new(),
        });
    }

    // Provider con abbonamento OAuth / flat (costo extra per chiamata: 0€)
    let subscription_providers: Vec<String> = auth_summary
        .iter()
        .filter(|a| {
            a.has_credential
                && a.credential_type == "oauth"
                && !config.disabled_providers.contains(&a.provider)
        })
        .map(|a| a.provider.clone())
        .collect();

    // 2. Filtra catalogo per provider attivi, requisiti di ruolo ed ESCLUSIONE MODELLI PAY-PER-TOKEN
    let candidate_models: Vec<ModelDto> = catalog
        .iter()
        .filter(|m| active_providers.contains(&m.provider))
        .filter(|m| {
            if role_id == "vision" {
                m.input
                    .as_ref()
                    .map(|i| i.iter().any(|v| v == "image"))
                    .unwrap_or(false)
            } else {
                true
            }
        })
        .filter(|m| {
            // Inclusione: account in abbonamento (OAuth), modelli :free / -free, o provider locali
            let is_sub = subscription_providers.contains(&m.provider);
            let is_free_selector =
                m.selector.ends_with(":free") || m.id.ends_with("-free") || m.id.contains("-free-");
            let is_zero_cost = m
                .cost
                .as_ref()
                .map(|c| c.input.unwrap_or(0.0) == 0.0 && c.output.unwrap_or(0.0) == 0.0)
                .unwrap_or(false);
            let is_local =
                m.provider == "ollama" || m.provider == "llama.cpp" || m.provider == "lm-studio";
            // Un provider custom non passa per la contabilita' di OMP e in
            // `models.json` non dichiara costi: escluderlo per "costo
            // sconosciuto" lo avrebbe reso invisibile ai suggerimenti.
            let is_custom_provider = custom_defs.providers.contains_key(&m.provider);

            // Escludi categoricamente modelli a pagamento su provider a consumo
            is_sub || is_free_selector || is_zero_cost || is_local || is_custom_provider
        })
        .cloned()
        .collect();

    if candidate_models.is_empty() {
        return Ok(RoleSuggestionsResponse {
            role_id,
            primary: Vec::new(),
            fallback: Vec::new(),
        });
    }

    // 3. Deduplicazione versioni per mantenere solo le piu recenti per famiglia
    let mut deduplicated: Vec<ModelDto> = Vec::new();
    for m in &candidate_models {
        let (tpl_cur, ver_cur, date_cur) = parse_model_signature(&m.id);
        let mut has_newer = false;
        for other in &candidate_models {
            if other.provider == m.provider && other.id != m.id {
                let (tpl_other, ver_other, date_other) = parse_model_signature(&other.id);
                if tpl_other == tpl_cur
                    && is_version_newer(&ver_cur, date_cur, &ver_other, date_other)
                {
                    has_newer = true;
                    break;
                }
            }
        }
        if !has_newer {
            deduplicated.push(m.clone());
        }
    }

    // 4. Separa modelli in abbonamento (Pro/OAuth) e modelli gratuiti (Zero-Cost)
    let mut sub_models: Vec<ModelDto> = Vec::new();
    let mut free_models: Vec<ModelDto> = Vec::new();

    for m in deduplicated {
        if subscription_providers.contains(&m.provider) {
            sub_models.push(m);
        } else {
            free_models.push(m);
        }
    }

    // Ordina i modelli in abbonamento per ELO decrescente
    sub_models.sort_by(|a, b| {
        let (_, elo_a) = get_model_benchmark_profile(&a.id, &a.name);
        let (_, elo_b) = get_model_benchmark_profile(&b.id, &b.name);
        elo_b.cmp(&elo_a)
    });
    if sub_models.len() > 16 {
        sub_models.truncate(16);
    }

    // Ordina i modelli free per ELO decrescente
    free_models.sort_by(|a, b| {
        let (_, elo_a) = get_model_benchmark_profile(&a.id, &a.name);
        let (_, elo_b) = get_model_benchmark_profile(&b.id, &b.name);
        elo_b.cmp(&elo_a)
    });
    if free_models.len() > 10 {
        free_models.truncate(10);
    }

    // Elenco esatto mostrato al modello: le sue risposte si validano solo su
    // questo. Sul catalogo completo il match per sottostringa risolveva un
    // nome inventato su un provider senza credenziali, e il suggerimento
    // finiva su un provider che l'utente non ha.
    let offered: Vec<&ModelDto> = sub_models.iter().chain(free_models.iter()).collect();

    // 5. Costruzione del sommario dei modelli disponibili
    let mut models_summary = String::new();
    if !sub_models.is_empty() {
        models_summary.push_str(
            "### MODELLI DA ACCOUNT IN ABBONAMENTO (FLAT / PRIORITA ELEVATA / ZERO EXTRA COST):\n",
        );
        for m in &sub_models {
            let (_tier, elo) = get_model_benchmark_profile(&m.id, &m.name);
            let perf_stat = perf_map.get(&m.selector).or_else(|| perf_map.get(&m.id));
            let speed_tag = match perf_stat {
                Some(p) if p.tokens_per_sec > 0.0 => {
                    format!(" [{} tok/s reali]", p.tokens_per_sec as u32)
                }
                _ => String::new(),
            };
            let mut tags = vec![format!("Coding ELO: ~{}", elo)];
            if let Some(ctx) = m.context_window {
                if ctx >= 1_000_000 {
                    tags.push(format!("{}M ctx", ctx / 1_000_000));
                } else if ctx >= 1_000 {
                    tags.push(format!("{}k ctx", ctx / 1_000));
                }
            }
            if m.reasoning.unwrap_or(false) {
                tags.push("reasoning".to_string());
            }
            models_summary.push_str(&format!(
                "- {} (nome: \"{}\", provider: {}) [{}] {}\n",
                m.selector,
                m.name,
                m.provider,
                tags.join(", "),
                speed_tag
            ));
        }
    }

    if !free_models.is_empty() {
        models_summary.push_str("\n### MODELLI COMPLETAMENTE GRATUITI / ZERO-COST (IDEALI PER RISERVE E SICUREZZA 429):\n");
        for m in &free_models {
            let (_tier, elo) = get_model_benchmark_profile(&m.id, &m.name);
            let perf_stat = perf_map.get(&m.selector).or_else(|| perf_map.get(&m.id));
            let speed_tag = match perf_stat {
                Some(p) if p.tokens_per_sec > 0.0 => {
                    format!(" [{} tok/s reali]", p.tokens_per_sec as u32)
                }
                _ => String::new(),
            };
            let mut tags = vec!["FREE".to_string(), format!("Coding ELO: ~{}", elo)];
            if let Some(ctx) = m.context_window {
                if ctx >= 1_000_000 {
                    tags.push(format!("{}M ctx", ctx / 1_000_000));
                } else if ctx >= 1_000 {
                    tags.push(format!("{}k ctx", ctx / 1_000));
                }
            }
            models_summary.push_str(&format!(
                "- {} (nome: \"{}\", provider: {}) [{}] {}\n",
                m.selector,
                m.name,
                m.provider,
                tags.join(", "),
                speed_tag
            ));
        }
    }

    let role_desc = match role_id.as_str() {
        "default" => "Conversazione generale, coding principale e tool use. Richiede alta intelligenza ed equilibrio velocita/costo.",
        "plan" => "Pianificazione architetturale, analisi requisiti e decomposizione task. Richiede reasoning profondo e contesto ampio.",
        "smol" => "Scouting rapido, ispezione file leggeri e compiti atomici. Richiede massima velocita e costo minimo.",
        "slow" => "Ragionamento complesso, deduzione logica e debug difficile. Richiede modelli ad alto reasoning computazionale.",
        "vision" => "Comprensione immagini, screenshot UI, diagrammi ed OCR. Richiede supporto nativo per input visivo.",
        "task" => "Esecuzione di subagenti paralleli. Richiede affidabilita con i tool e velocita di esecuzione.",
        "commit" => "Generazione messaggi di commit e note di changelog. Richiede sintesi, brevita e costo basso.",
        "advisor" => "Revisione passiva e controllo qualita/sicurezza del codice. Richiede precisione analitica e prospettiva neutrale.",
        _ => "Ruolo operativo per agenti OMP.",
    };

    let primary_info = current_primary.as_deref().unwrap_or("non configurato");
    let fallbacks_info = if current_fallbacks.is_empty() {
        "nessuna riserva".to_string()
    } else {
        current_fallbacks.join(", ")
    };

    let user_prompt = format!(
        "Sei l'assistente esperto di configurazione modelli per OMP Studio.\n\
Ruolo target: \"{role_id}\"\n\
Scopo del ruolo: {role_desc}\n\
Modello primario attualmente scelto: {primary_info}\n\
Riserve attuali: {fallbacks_info}\n\n\
MODELLI DISPONIBILI:\n\
{models_summary}\n\
REGOLE FONDAMENTALI DI ASSEGNAZIONE:\n\
1. MODELLI PRIMARI (Suggerisci 2-3 scelte):\n\
   - Per ruoli critici/pesanti (default, plan, slow, advisor, task, vision): scegli OBBLIGATORIAMENTE modelli dagli ACCOUNT IN ABBONAMENTO con il più alto Coding ELO (Tier 1+ o Tier 1, es. Claude Opus 5, Gemini 3.7 Flash, GPT-5.6 Sol/Terra). NON proporre modelli FREE o di basso livello come primari quando sono disponibili modelli in abbonamento.\n\
   - Per ruoli atomici/veloci (smol, commit): premia i modelli con la velocità più alta (>200 tok/s reali, es. Gemini Flash su abbonamento o DeepSeek Flash Free).\n\
   - Includi una variante 'Top Quality' e una variante 'High-Speed' o 'Bilanciato'.\n\
2. MODELLI DI RISERVA / FALLBACK (Suggerisci 2-3 scelte):\n\
   - REQUISITO CROSS-PROVIDER: ogni fallback DEVE appartenere a un PROVIDER DIVERSO dal modello primario \"{primary_info}\" per garantire continuita su 429 (rate-limit) o blackout.\n\
   - Suggerisci come prima riserva un modello di alto livello su un altro provider in abbonamento.\n\
   - Suggerisci come ulteriore riserva un modello COMPLETAMENTE GRATUITO (Zero-Cost) come safety-net se tutte le quote a pagamento dovessero esaurirsi.\n\n\
Rispondi ESCLUSIVAMENTE con un JSON valido con questa struttura esatta:\n\
{{\n\
  \"primary\": [\n\
    {{\n\
      \"selector\": \"selettore-esatto-dalla-lista\",\n\
      \"reason\": \"Breve spiegazione in italiano (max 10 parole)\",\n\
      \"badge\": \"Top ELO 1566\",\n\
      \"recommendedThinking\": \"auto\"\n\
    }}\n\
  ],\n\
  \"fallback\": [\n\
    {{\n\
      \"selector\": \"selettore-esatto-da-provider-diverso\",\n\
      \"reason\": \"Breve spiegazione in italiano del perche come riserva\",\n\
      \"badge\": \"Zero-Cost Backup\"\n\
    }}\n\
  ]\n\
}}"
    );

    let omp_path = crate::omp_ops::get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("-p")
        .arg("--no-tools")
        .arg("--no-session")
        .arg("--system-prompt")
        .arg("Sei un assistente per la selezione ottimale dei modelli AI. Restituisci SOLO un JSON valido, senza blocchi di codice markdown o testo aggiuntivo.")
        .arg(&user_prompt);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output_res = cmd.output();

    let parsed_res: Option<RawLlmSuggestions> = match output_res {
        Ok(o) if o.status.success() => {
            let stdout_str = String::from_utf8_lossy(&o.stdout).to_string();
            let trimmed = stdout_str.trim();
            let json_candidate =
                if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
                    if end >= start {
                        &trimmed[start..=end]
                    } else {
                        trimmed
                    }
                } else {
                    trimmed
                };
            serde_json::from_str(json_candidate).ok()
        }
        _ => None,
    };

    let parsed = parsed_res.unwrap_or(RawLlmSuggestions {
        primary: None,
        fallback: None,
    });
    let mut validated_primary: Vec<SuggestedModelItem> = Vec::new();
    if let Some(items) = parsed.primary {
        for it in items {
            if let Some(raw_sel) = it.selector {
                if let Some(matched_model) = find_matching_catalog_selector(&raw_sel, &offered) {
                    if !validated_primary
                        .iter()
                        .any(|p| p.selector == matched_model.selector)
                    {
                        let (_, elo) =
                            get_model_benchmark_profile(&matched_model.id, &matched_model.name);
                        let perf_stat = perf_map
                            .get(&matched_model.selector)
                            .or_else(|| perf_map.get(&matched_model.id));
                        let is_sub = subscription_providers.contains(&matched_model.provider);
                        let is_free = !is_sub
                            && (matched_model.selector.ends_with(":free")
                                || matched_model.id.ends_with("-free")
                                || matched_model
                                    .cost
                                    .as_ref()
                                    .map(|c| {
                                        c.input.unwrap_or(0.0) == 0.0
                                            && c.output.unwrap_or(0.0) == 0.0
                                    })
                                    .unwrap_or(false));

                        // Badge intelligente di fallback se mancante o generico
                        let badge = it
                            .badge
                            .filter(|b| !b.is_empty() && b != "Consigliato")
                            .or_else(|| {
                                if elo >= 1560 {
                                    Some(format!("Top ELO {}", elo))
                                } else if let Some(p) = perf_stat {
                                    if p.tokens_per_sec >= 200.0 {
                                        Some(format!("{} tok/s", p.tokens_per_sec as u32))
                                    } else if is_sub {
                                        Some("Abbonamento".to_string())
                                    } else {
                                        Some(format!("ELO {}", elo))
                                    }
                                } else if is_sub {
                                    Some("Abbonamento".to_string())
                                } else {
                                    Some(format!("ELO {}", elo))
                                }
                            });

                        validated_primary.push(SuggestedModelItem {
                            selector: matched_model.selector.clone(),
                            reason: it.reason.unwrap_or_else(|| {
                                "Modello consigliato per questo ruolo".to_string()
                            }),
                            badge,
                            recommended_thinking: it.recommended_thinking,
                            arena_elo: Some(elo),
                            tokens_per_sec: perf_stat.map(|p| p.tokens_per_sec),
                            is_subscription: Some(is_sub),
                            is_free: Some(is_free),
                        });
                    }
                }
            }
        }
    }

    let mut validated_fallback: Vec<SuggestedModelItem> = Vec::new();
    if let Some(items) = parsed.fallback {
        for it in items {
            if let Some(raw_sel) = it.selector {
                if let Some(matched_model) = find_matching_catalog_selector(&raw_sel, &offered) {
                    if !validated_fallback
                        .iter()
                        .any(|f| f.selector == matched_model.selector)
                    {
                        let (_, elo) =
                            get_model_benchmark_profile(&matched_model.id, &matched_model.name);
                        let perf_stat = perf_map
                            .get(&matched_model.selector)
                            .or_else(|| perf_map.get(&matched_model.id));
                        let is_sub = subscription_providers.contains(&matched_model.provider);
                        let is_free = !is_sub
                            && (matched_model.selector.ends_with(":free")
                                || matched_model.id.ends_with("-free")
                                || matched_model
                                    .cost
                                    .as_ref()
                                    .map(|c| {
                                        c.input.unwrap_or(0.0) == 0.0
                                            && c.output.unwrap_or(0.0) == 0.0
                                    })
                                    .unwrap_or(false));

                        let badge = it.badge.filter(|b| !b.is_empty()).or_else(|| {
                            if is_free {
                                Some("Zero-Cost Backup".to_string())
                            } else {
                                Some(format!("Riserva {}", matched_model.provider))
                            }
                        });

                        validated_fallback.push(SuggestedModelItem {
                            selector: matched_model.selector.clone(),
                            reason: it
                                .reason
                                .unwrap_or_else(|| "Riserva consigliata su rate-limit".to_string()),
                            badge,
                            recommended_thinking: it.recommended_thinking,
                            arena_elo: Some(elo),
                            tokens_per_sec: perf_stat.map(|p| p.tokens_per_sec),
                            is_subscription: Some(is_sub),
                            is_free: Some(is_free),
                        });
                    }
                }
            }
        }
    }
    if validated_primary.is_empty() {
        return Ok(build_deterministic_suggestions(
            &role_id,
            current_primary.as_deref(),
            &sub_models,
            &free_models,
            &perf_map,
            &subscription_providers,
        ));
    }

    Ok(RoleSuggestionsResponse {
        role_id,
        primary: validated_primary,
        fallback: validated_fallback,
    })
}

fn build_deterministic_suggestions(
    role_id: &str,
    current_primary: Option<&str>,
    sub_models: &[ModelDto],
    free_models: &[ModelDto],
    perf_map: &HashMap<String, ModelPerfStat>,
    subscription_providers: &[String],
) -> RoleSuggestionsResponse {
    let mut primary = Vec::new();
    let mut fallback = Vec::new();

    let primary_provider = current_primary
        .and_then(|p| p.split('/').next())
        .unwrap_or("");

    // Primari: se ruolo atomico (smol/commit), ordina per velocità, altrimenti per ELO
    let mut primary_candidates = sub_models.to_vec();
    if role_id == "smol" || role_id == "commit" {
        primary_candidates.sort_by(|a, b| {
            let speed_a = perf_map
                .get(&a.selector)
                .or_else(|| perf_map.get(&a.id))
                .map(|p| p.tokens_per_sec)
                .unwrap_or(0.0);
            let speed_b = perf_map
                .get(&b.selector)
                .or_else(|| perf_map.get(&b.id))
                .map(|p| p.tokens_per_sec)
                .unwrap_or(0.0);
            speed_b
                .partial_cmp(&speed_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    if primary_candidates.is_empty() {
        primary_candidates = free_models.to_vec();
    }

    for m in primary_candidates.iter().take(3) {
        let (_, elo) = get_model_benchmark_profile(&m.id, &m.name);
        let perf_stat = perf_map.get(&m.selector).or_else(|| perf_map.get(&m.id));
        let is_sub = subscription_providers.contains(&m.provider);
        let is_free = !is_sub
            && (m.selector.ends_with(":free")
                || m.id.ends_with("-free")
                || m.cost
                    .as_ref()
                    .map(|c| c.input.unwrap_or(0.0) == 0.0 && c.output.unwrap_or(0.0) == 0.0)
                    .unwrap_or(false));

        let badge = if elo >= 1560 {
            Some(format!("Top ELO {}", elo))
        } else if let Some(p) = perf_stat {
            if p.tokens_per_sec >= 200.0 {
                Some(format!("{} tok/s", p.tokens_per_sec as u32))
            } else if is_sub {
                Some("Abbonamento".to_string())
            } else {
                Some(format!("ELO {}", elo))
            }
        } else if is_sub {
            Some("Abbonamento".to_string())
        } else {
            Some(format!("ELO {}", elo))
        };

        primary.push(SuggestedModelItem {
            selector: m.selector.clone(),
            reason: format!("Modello ottimale per {}", role_id),
            badge,
            recommended_thinking: Some("auto".to_string()),
            arena_elo: Some(elo),
            tokens_per_sec: perf_stat.map(|p| p.tokens_per_sec),
            is_subscription: Some(is_sub),
            is_free: Some(is_free),
        });
    }

    // Fallback: 1) miglior modello da altro provider in abbonamento
    for m in sub_models {
        if m.provider != primary_provider && !primary.iter().any(|p| p.selector == m.selector) {
            let (_, elo) = get_model_benchmark_profile(&m.id, &m.name);
            let perf_stat = perf_map.get(&m.selector).or_else(|| perf_map.get(&m.id));
            fallback.push(SuggestedModelItem {
                selector: m.selector.clone(),
                reason: format!("Riserva di continuità da {}", m.provider),
                badge: Some(format!("Riserva {}", m.provider)),
                recommended_thinking: Some("auto".to_string()),
                arena_elo: Some(elo),
                tokens_per_sec: perf_stat.map(|p| p.tokens_per_sec),
                is_subscription: Some(true),
                is_free: Some(false),
            });
            break;
        }
    }

    // Fallback: 2) miglior modello completamente GRATUITO da provider diverso
    for m in free_models {
        if m.provider != primary_provider
            && !fallback.iter().any(|f| f.selector == m.selector)
            && !primary.iter().any(|p| p.selector == m.selector)
        {
            let (_, elo) = get_model_benchmark_profile(&m.id, &m.name);
            let perf_stat = perf_map.get(&m.selector).or_else(|| perf_map.get(&m.id));
            fallback.push(SuggestedModelItem {
                selector: m.selector.clone(),
                reason: "Riserva gratuita a costo zero su rate-limit".to_string(),
                badge: Some("Zero-Cost Backup".to_string()),
                recommended_thinking: Some("auto".to_string()),
                arena_elo: Some(elo),
                tokens_per_sec: perf_stat.map(|p| p.tokens_per_sec),
                is_subscription: Some(false),
                is_free: Some(true),
            });
            break;
        }
    }

    RoleSuggestionsResponse {
        role_id: role_id.to_string(),
        primary,
        fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let counter = TEMP_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "omp-studio-models-{}-{}-{}",
                label,
                std::process::id(),
                counter
            ));
            fs::create_dir(&path).expect("creazione directory test");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_custom_providers() -> CustomProvidersFile {
        CustomProvidersFile {
            providers: HashMap::from([(
                "custom".to_string(),
                CustomProviderDef {
                    base_url: "https://new.example/v1".to_string(),
                    api_key: Some("new-secret".to_string()),
                    api: Some("openai-completions".to_string()),
                    models: vec![CustomModelDef {
                        id: "model-a".to_string(),
                        name: "Model A updated".to_string(),
                        context_window: Some(200),
                        max_tokens: Some(20),
                        reasoning: Some(true),
                        input: Some(vec!["text".to_string()]),
                    }],
                },
            )]),
        }
    }

    #[test]
    fn parses_identity_key_variants() {
        let email_only = parse_identity_key("email:foo@bar.com");
        assert_eq!(email_only.email.as_deref(), Some("foo@bar.com"));
        assert_eq!(email_only.account_id, None);
        assert_eq!(email_only.org_id, None);

        let account_and_org = parse_identity_key("account:acc-123|org:org-456");
        assert_eq!(account_and_org.account_id.as_deref(), Some("acc-123"));
        assert_eq!(account_and_org.org_id.as_deref(), Some("org-456"));

        let org_only = parse_identity_key("org:org-456");
        assert_eq!(org_only.org_id.as_deref(), Some("org-456"));

        let project = parse_identity_key("project:my-gcp-project");
        assert_eq!(project.account_id.as_deref(), Some("my-gcp-project"));

        let malformed = parse_identity_key("garbage-without-colon|:empty-key");
        assert_eq!(malformed.email, None);
        assert_eq!(malformed.account_id, None);
        assert_eq!(malformed.org_id, None);
    }

    #[test]
    fn extracts_first_matching_json_key_never_empty() {
        let data: serde_json::Value =
            serde_json::from_str(r#"{"email":"  ","orgName":"Acme Inc","plan":""}"#).unwrap();
        assert_eq!(
            extract_json_string(&data, &["email", "orgName"]),
            Some("Acme Inc".to_string())
        );
        assert_eq!(extract_json_string(&data, &["plan", "planType"]), None);
        assert_eq!(extract_json_string(&data, &["missing"]), None);
    }

    #[test]
    fn builds_auth_account_dto_merging_identity_key_and_data_payload() {
        // Forma reale osservata in agent.db per una credenziale OAuth: i
        // segreti (`access`, `refresh`, `expires`) non devono mai comparire
        // nel DTO risultante.
        let dto = build_auth_account_dto(
            22,
            "openai-codex".to_string(),
            "oauth".to_string(),
            Some("email:jane@example.com".to_string()),
            None,
            r#"{"access":"secret-access","refresh":"secret-refresh","expires":1234,"accountId":"acc-1","email":"jane@example.com","orgId":"org-9","orgName":"Acme Inc"}"#,
            Some(1_700_000_000),
            Some(1_700_000_100),
        );

        assert_eq!(dto.email.as_deref(), Some("jane@example.com"));
        assert_eq!(dto.account_id.as_deref(), Some("acc-1"));
        assert_eq!(dto.org_id.as_deref(), Some("org-9"));
        assert_eq!(dto.org_name.as_deref(), Some("Acme Inc"));
        assert_eq!(dto.plan, None);
        assert!(dto.has_credential);
        assert_eq!(dto.created_at, Some(1_700_000_000));

        let serialized = serde_json::to_string(&dto).expect("serializzazione DTO");
        assert!(!serialized.contains("secret-access"));
        assert!(!serialized.contains("secret-refresh"));
    }

    #[test]
    fn builds_auth_account_dto_tolerates_malformed_data_payload() {
        let dto = build_auth_account_dto(
            5,
            "tavily".to_string(),
            "api_key".to_string(),
            None,
            None,
            "not valid json",
            None,
            None,
        );
        assert_eq!(dto.email, None);
        assert_eq!(dto.account_id, None);
        assert!(dto.has_credential);
    }

    #[test]
    fn humanizes_provider_ids_without_static_name() {
        assert_eq!(humanize_provider_id("tokenrouter"), "Tokenrouter");
        assert_eq!(humanize_provider_id("my-local-endpoint"), "My Local Endpoint");
        assert_eq!(humanize_provider_id("solo_underscore"), "Solo Underscore");
    }

    #[test]
    fn provider_display_name_prefers_builtin_then_plugin_then_humanized() {
        assert_eq!(provider_display_name("anthropic", false), "Anthropic Claude");
        assert_eq!(provider_display_name("commandcode", false), "Command Code");
        assert_eq!(provider_display_name("brand-new-plugin", false), "Brand New Plugin");
        // Un provider custom prende sempre il nome umanizzato dell'id: non
        // ha un campo "name" proprio in `CustomProviderDef`.
        assert_eq!(provider_display_name("anthropic", true), "Anthropic");
    }

    #[test]
    fn parses_available_models_with_flat_thinking_list() {
        // Payload reale di `omp models --json`: `thinking` e' l'elenco piatto
        // degli sforzi (o null), `cost` porta chiavi extra come longContext e
        // nessun modello dichiara isCustom.
        let raw = br#"{"models":[
            {"provider":"anthropic","id":"claude-3-5-sonnet-20240620","selector":"anthropic/claude-3-5-sonnet-20240620","name":"Claude Sonnet 3.5","contextWindow":200000,"maxTokens":8192,"reasoning":false,"thinking":null,"input":["text","image"],"cost":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75}},
            {"provider":"anthropic","id":"claude-opus-5","selector":"anthropic/claude-opus-5","name":"Claude Opus 5","contextWindow":200000,"maxTokens":64000,"reasoning":true,"thinking":["low","medium","high","max"],"input":["text","image"],"cost":{"input":5,"output":25,"cacheRead":0.5,"cacheWrite":6.25,"longContext":10}}
        ]}"#;
        let models = parse_available_models(raw).expect("catalogo OMP valido");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].selector, "anthropic/claude-3-5-sonnet-20240620");
        assert_eq!(models[0].context_window, Some(200000));
        assert!(models[0].thinking.is_none());
        assert!(!models[0].is_custom);

        let opus = &models[1];
        assert_eq!(opus.selector, "anthropic/claude-opus-5");
        assert_eq!(
            opus.thinking.as_ref().and_then(|t| t.efforts.as_deref()),
            Some(["low", "medium", "high", "max"].map(String::from).as_slice())
        );
        assert_eq!(opus.cost.as_ref().and_then(|c| c.output), Some(25.0));
        assert!(!opus.is_custom);
    }

    #[test]
    fn test_parse_model_signature_semantic() {
        let (tpl1, ver1, date1) = parse_model_signature("claude-opus-5");
        assert_eq!(tpl1, "claude-opus-{V}");
        assert_eq!(ver1, vec![5.0]);
        assert_eq!(date1, None);

        let (tpl2, ver2, date2) = parse_model_signature("claude-opus-5.1");
        assert_eq!(tpl2, "claude-opus-{V}");
        assert_eq!(ver2, vec![5.0, 1.0]);
        assert_eq!(date2, None);

        assert!(is_version_newer(&ver1, date1, &ver2, date2));
    }

    #[test]
    fn test_parse_model_signature_dates() {
        let (tpl1, ver1, date1) = parse_model_signature("claude-3-5-sonnet-20241022");
        let (tpl2, ver2, date2) = parse_model_signature("claude-3-7-sonnet-20250219");

        assert_eq!(tpl1, "claude-{V}-{V}-sonnet");
        assert_eq!(tpl2, "claude-{V}-{V}-sonnet");
        assert_eq!(ver1, vec![3.0, 5.0]);
        assert_eq!(ver2, vec![3.0, 7.0]);
        assert_eq!(date1, Some(20241022));
        assert_eq!(date2, Some(20250219));

        assert!(is_version_newer(&ver1, date1, &ver2, date2));
    }

    #[test]
    fn test_parse_model_signature_families() {
        let (tpl_gem1, ver_gem1, _) = parse_model_signature("gemini-3.6-flash-tiered");
        let (tpl_gem2, ver_gem2, _) = parse_model_signature("gemini-3.7-flash-tiered");
        assert_eq!(tpl_gem1, tpl_gem2);
        assert!(is_version_newer(&ver_gem1, None, &ver_gem2, None));

        let (tpl_ds1, ver_ds1, _) = parse_model_signature("deepseek-v4-flash");
        let (tpl_ds2, ver_ds2, _) = parse_model_signature("deepseek-v4.1-flash");
        assert_eq!(tpl_ds1, tpl_ds2);
        assert!(is_version_newer(&ver_ds1, None, &ver_ds2, None));
    }

    #[test]
    fn test_benchmark_profile_ratings() {
        let (tier1, elo1) = get_model_benchmark_profile("claude-opus-5", "Claude Opus 5");
        assert_eq!(tier1, IntelligenceTier::Tier1Plus);
        assert!(elo1 >= 1560);

        let (tier2, elo2) = get_model_benchmark_profile("gemini-3.7-flash", "Gemini 3.7 Flash");
        assert_eq!(tier2, IntelligenceTier::Tier1);
        assert_eq!(elo2, 1555);

        let (tier3, elo3) = get_model_benchmark_profile("claude-sonnet-5", "Claude Sonnet 5");
        assert_eq!(tier3, IntelligenceTier::Tier2);
        assert_eq!(elo3, 1520);

        let (tier4, elo4) = get_model_benchmark_profile("deepseek-v4-flash", "DeepSeek V4 Flash");
        assert_eq!(tier4, IntelligenceTier::Tier3);
        assert_eq!(elo4, 1465);

        let (tier5, elo5) =
            get_model_benchmark_profile("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite");
        assert_eq!(tier5, IntelligenceTier::Tier4);
        assert_eq!(elo5, 1410);
    }

    #[test]
    fn invalid_yaml_is_not_replaced_by_save() {
        let dir = TestDir::new("invalid-yaml");
        let path = dir.path().join("config.yml");
        let original = b"modelRoles: [unterminated";
        fs::write(&path, original).expect("scrittura fixture");

        let error = save_model_config_path(&path, &default_model_config())
            .expect_err("il salvataggio deve fallire");

        assert!(error.contains("Parsing YAML"));
        assert_eq!(fs::read(&path).expect("rilettura fixture"), original);
    }

    #[test]
    fn invalid_json_is_not_replaced_or_mapped_to_yaml() {
        let dir = TestDir::new("invalid-json");
        let json_path = dir.path().join("models.json");
        let yml_path = dir.path().join("models.yml");
        let original = b"{\"providers\": ";
        fs::write(&json_path, original).expect("scrittura fixture");

        let error = save_custom_providers_paths(
            &json_path,
            &yml_path,
            &sample_custom_providers(),
        )
        .expect_err("il salvataggio deve fallire");

        assert!(error.contains("Parsing JSON"));
        assert_eq!(fs::read(&json_path).expect("rilettura fixture"), original);
        assert!(!yml_path.exists());
    }

    #[test]
    fn model_save_preserves_unknown_root_and_retry_fields() {
        let dir = TestDir::new("yaml-extras");
        let path = dir.path().join("config.yml");
        fs::write(
            &path,
            "unknownRoot:\n  keep: true\nretry:\n  backoffMs: 250\n  fallbackChains:\n    default: [old/model]\nmodelRoles:\n  default: old/model\n",
        )
        .expect("scrittura fixture");
        let mut config = default_model_config();
        config
            .model_roles
            .insert("default".to_string(), "new/model".to_string());

        save_model_config_path(&path, &config).expect("salvataggio config");

        let mapping = read_yaml_mapping(&path)
            .expect("lettura config")
            .expect("config presente");
        assert_eq!(
            mapping
                .get(yaml_key("unknownRoot"))
                .and_then(|value| value.get("keep"))
                .and_then(serde_yaml::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            mapping
                .get(yaml_key("retry"))
                .and_then(|value| value.get("backoffMs"))
                .and_then(serde_yaml::Value::as_u64),
            Some(250)
        );
    }

    #[test]
    fn provider_save_preserves_unknown_fields_in_both_formats() {
        let dir = TestDir::new("provider-extras");
        let json_path = dir.path().join("models.json");
        let yml_path = dir.path().join("models.yml");
        fs::write(
            &json_path,
            r#"{
  "rootExtra": {"keep": true},
  "providers": {
    "custom": {
      "baseUrl": "https://old.example/v1",
      "apiKey": "old-secret",
      "api": "openai-completions",
      "providerExtra": 7,
      "models": [{
        "id": "model-a",
        "name": "Old",
        "contextWindow": 100,
        "maxTokens": 10,
        "reasoning": false,
        "input": ["text"],
        "modelExtra": "keep"
      }]
    }
  }
}"#,
        )
        .expect("scrittura JSON fixture");
        fs::write(
            &yml_path,
            "rootExtra:\n  keep: true\nproviders:\n  custom:\n    baseUrl: https://old.example/v1\n    apiKey: old-secret\n    api: openai-completions\n    providerExtra: 7\n    models:\n      - id: model-a\n        name: Old\n        contextWindow: 100\n        maxTokens: 10\n        reasoning: false\n        input: [text]\n        modelExtra: keep\n",
        )
        .expect("scrittura YAML fixture");

        save_custom_providers_paths(
            &json_path,
            &yml_path,
            &sample_custom_providers(),
        )
        .expect("salvataggio provider");

        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(&json_path).expect("lettura JSON"))
                .expect("JSON valido");
        assert_eq!(json.pointer("/rootExtra/keep").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            json.pointer("/providers/custom/providerExtra")
                .and_then(|v| v.as_u64()),
            Some(7)
        );
        assert_eq!(
            json.pointer("/providers/custom/models/0/modelExtra")
                .and_then(|v| v.as_str()),
            Some("keep")
        );
        assert_eq!(
            json.pointer("/providers/custom/models/0/name")
                .and_then(|v| v.as_str()),
            Some("Model A updated")
        );

        let yaml = serde_yaml::Value::Mapping(
            read_yaml_mapping(&yml_path)
                .expect("lettura YAML")
                .expect("YAML presente"),
        );
        assert_eq!(
            yaml.get("providers")
                .and_then(|v| v.get("custom"))
                .and_then(|v| v.get("providerExtra"))
                .and_then(serde_yaml::Value::as_u64),
            Some(7)
        );
        assert_eq!(
            yaml.get("providers")
                .and_then(|v| v.get("custom"))
                .and_then(|v| v.get("models"))
                .and_then(serde_yaml::Value::as_sequence)
                .and_then(|models| models.first())
                .and_then(|v| v.get("modelExtra"))
                .and_then(serde_yaml::Value::as_str),
            Some("keep")
        );
    }

    #[test]
    fn missing_files_create_defaults_and_new_configs() {
        let dir = TestDir::new("missing");
        let config_path = dir.path().join("config.yml");
        let json_path = dir.path().join("models.json");
        let yml_path = dir.path().join("models.yml");

        let config = read_model_config_path(&config_path).expect("default config");
        assert!(config.model_roles.is_empty());
        save_model_config_path(&config_path, &config).expect("creazione config");
        assert!(config_path.exists());

        let providers =
            read_custom_providers_paths(&json_path, &yml_path).expect("default provider");
        assert!(providers.providers.is_empty());
        save_custom_providers_paths(&json_path, &yml_path, &sample_custom_providers())
            .expect("creazione provider");
        assert!(json_path.exists());
        assert!(yml_path.exists());
    }

    #[test]
    fn atomic_write_cleans_temp_after_replace_error() {
        let dir = TestDir::new("temp-cleanup");
        let target = dir.path().join("target");
        fs::create_dir(&target).expect("creazione destinazione non sostituibile");

        atomic_write(&target, b"new contents").expect_err("replace deve fallire");

        let prefix = format!(".target.{}.", std::process::id());
        let leaked_temp = fs::read_dir(dir.path())
            .expect("lettura directory")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix));
        assert!(!leaked_temp);
        assert!(target.is_dir());
    }

    #[test]
    fn concurrent_model_mutations_do_not_lose_roles() {
        let dir = TestDir::new("concurrency");
        let path = dir.path().join("config.yml");
        fs::write(&path, "unknownRoot: keep\n").expect("scrittura fixture");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let mut threads = Vec::new();

        for index in 0..8 {
            let path = path.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                mutate_model_config_path(&path, |config| {
                    config
                        .model_roles
                        .insert(format!("role-{}", index), format!("model-{}", index));
                })
            }));
        }
        for thread in threads {
            thread
                .join()
                .expect("thread mutazione")
                .expect("mutazione config");
        }

        let config = read_model_config_path(&path).expect("lettura config finale");
        assert_eq!(config.model_roles.len(), 8);
        let mapping = read_yaml_mapping(&path)
            .expect("lettura YAML finale")
            .expect("config presente");
        assert_eq!(
            mapping
                .get(yaml_key("unknownRoot"))
                .and_then(serde_yaml::Value::as_str),
            Some("keep")
        );
    }
}
