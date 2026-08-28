use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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

#[command]
pub async fn get_model_config() -> Result<ModelConfigDto, String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    let config_path = agent.join("config.yml");

    if !config_path.exists() {
        return Ok(ModelConfigDto {
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
        });
    }

    let text = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let val: serde_yaml::Value = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;

    let mut model_roles = HashMap::new();
    if let Some(roles_map) = val.get("modelRoles").and_then(|v| v.as_mapping()) {
        for (k, v) in roles_map {
            if let (Some(k_str), Some(v_str)) = (k.as_str(), v.as_str()) {
                model_roles.insert(k_str.to_string(), v_str.to_string());
            }
        }
    }

    let mut cycle_order = Vec::new();
    if let Some(seq) = val.get("cycleOrder").and_then(|v| v.as_sequence()) {
        for item in seq {
            if let Some(s) = item.as_str() {
                cycle_order.push(s.to_string());
            }
        }
    }
    if cycle_order.is_empty() {
        cycle_order = vec![
            "plan".into(),
            "vision".into(),
            "default".into(),
            "smol".into(),
            "task".into(),
            "commit".into(),
        ];
    }

    let mut disabled_providers = Vec::new();
    if let Some(seq) = val.get("disabledProviders").and_then(|v| v.as_sequence()) {
        for item in seq {
            if let Some(s) = item.as_str() {
                disabled_providers.push(s.to_string());
            }
        }
    }

    let mut fallback_chains = HashMap::new();
    if let Some(retry_val) = val.get("retry") {
        if let Some(fb_map) = retry_val.get("fallbackChains").and_then(|v| v.as_mapping()) {
            for (k, v) in fb_map {
                if let (Some(k_str), Some(seq)) = (k.as_str(), v.as_sequence()) {
                    let mut list = Vec::new();
                    for item in seq {
                        if let Some(s) = item.as_str() {
                            list.push(s.to_string());
                        }
                    }
                    fallback_chains.insert(k_str.to_string(), list);
                }
            }
        }
    }

    let default_thinking_level = val
        .get("defaultThinkingLevel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ModelConfigDto {
        model_roles,
        cycle_order,
        disabled_providers,
        fallback_chains,
        default_thinking_level,
    })
}

#[command]
pub async fn save_model_config(config: ModelConfigDto) -> Result<(), String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    let config_path = agent.join("config.yml");

    let mut root_val: serde_yaml::Value = if config_path.exists() {
        let text = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_yaml::from_str(&text)
            .unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()))
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    let mapping = root_val
        .as_mapping_mut()
        .ok_or("Struttura config.yml non valida (atteso dizionario)")?;

    // 1. Aggiorna modelRoles
    let mut roles_map = serde_yaml::Mapping::new();
    for (k, v) in &config.model_roles {
        roles_map.insert(
            serde_yaml::Value::String(k.clone()),
            serde_yaml::Value::String(v.clone()),
        );
    }
    mapping.insert(
        serde_yaml::Value::String("modelRoles".into()),
        serde_yaml::Value::Mapping(roles_map),
    );

    // 2. Aggiorna cycleOrder
    let cycle_seq = config
        .cycle_order
        .iter()
        .map(|s| serde_yaml::Value::String(s.clone()))
        .collect();
    mapping.insert(
        serde_yaml::Value::String("cycleOrder".into()),
        serde_yaml::Value::Sequence(cycle_seq),
    );

    // 3. Aggiorna disabledProviders
    let disabled_seq = config
        .disabled_providers
        .iter()
        .map(|s| serde_yaml::Value::String(s.clone()))
        .collect();
    mapping.insert(
        serde_yaml::Value::String("disabledProviders".into()),
        serde_yaml::Value::Sequence(disabled_seq),
    );

    // 4. Aggiorna retry.fallbackChains
    let mut fallback_map = serde_yaml::Mapping::new();
    for (k, v) in &config.fallback_chains {
        let seq = v
            .iter()
            .map(|s| serde_yaml::Value::String(s.clone()))
            .collect();
        fallback_map.insert(
            serde_yaml::Value::String(k.clone()),
            serde_yaml::Value::Sequence(seq),
        );
    }

    let retry_key = serde_yaml::Value::String("retry".into());
    let mut retry_map = mapping
        .get(&retry_key)
        .and_then(|v| v.as_mapping())
        .cloned()
        .unwrap_or_else(serde_yaml::Mapping::new);

    retry_map.insert(
        serde_yaml::Value::String("fallbackChains".into()),
        serde_yaml::Value::Mapping(fallback_map),
    );
    mapping.insert(retry_key, serde_yaml::Value::Mapping(retry_map));

    // 5. defaultThinkingLevel
    if let Some(lvl) = config.default_thinking_level {
        mapping.insert(
            serde_yaml::Value::String("defaultThinkingLevel".into()),
            serde_yaml::Value::String(lvl),
        );
    }

    let serialized = serde_yaml::to_string(&root_val).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, serialized).map_err(|e| format!("Scrittura config.yml: {}", e))?;

    Ok(())
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
    if let Ok(custom_defs) = get_custom_providers().await {
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

// -----------------------------------------------------------------------------
// Custom Providers (models.json / models.yml)
// -----------------------------------------------------------------------------

#[command]
pub async fn get_custom_providers() -> Result<CustomProvidersFile, String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    let json_path = agent.join("models.json");
    let yml_path = agent.join("models.yml");

    if json_path.exists() {
        let text = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
        if let Ok(file_obj) = serde_json::from_str::<CustomProvidersFile>(&text) {
            return Ok(file_obj);
        }
    }

    if yml_path.exists() {
        let text = std::fs::read_to_string(&yml_path).map_err(|e| e.to_string())?;
        if let Ok(file_obj) = serde_yaml::from_str::<CustomProvidersFile>(&text) {
            return Ok(file_obj);
        }
    }

    Ok(CustomProvidersFile {
        providers: HashMap::new(),
    })
}

#[command]
pub async fn save_custom_providers(data: CustomProvidersFile) -> Result<(), String> {
    let agent = agent_dir().ok_or("Impossibile trovare directory ~/.omp/agent")?;
    let json_path = agent.join("models.json");
    let yml_path = agent.join("models.yml");

    let json_str = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, json_str).map_err(|e| format!("Scrittura models.json: {}", e))?;

    let yml_str = serde_yaml::to_string(&data).map_err(|e| e.to_string())?;
    std::fs::write(&yml_path, yml_str).map_err(|e| format!("Scrittura models.yml: {}", e))?;

    Ok(())
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
            if tpl_cand == tpl_cur {
                if is_version_newer(&ver_cur, date_cur, &ver_cand, date_cand) {
                    if let Some((_, best_ver, best_date)) = &best_upgrade {
                        if is_version_newer(best_ver, *best_date, &ver_cand, date_cand) {
                            best_upgrade = Some((m, ver_cand, date_cand));
                        }
                    } else {
                        best_upgrade = Some((m, ver_cand, date_cand));
                    }
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
    let mut config = get_model_config().await?;

    for item in updates {
        config.model_roles.insert(item.role, item.new_selector);
    }

    save_model_config(config).await
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

fn find_matching_catalog_selector<'a>(
    raw_sel: &str,
    catalog: &'a [ModelDto],
) -> Option<&'a ModelDto> {
    let clean = raw_sel.trim();
    if clean.is_empty() {
        return None;
    }
    // 1. Exact match
    if let Some(m) = catalog
        .iter()
        .find(|m| m.selector == clean || m.id == clean)
    {
        return Some(m);
    }
    // 2. Case insensitive exact match
    let clean_lower = clean.to_lowercase();
    if let Some(m) = catalog
        .iter()
        .find(|m| m.selector.to_lowercase() == clean_lower || m.id.to_lowercase() == clean_lower)
    {
        return Some(m);
    }
    // 3. Substring match
    if let Some(m) = catalog.iter().find(|m| {
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
    let perf_map = get_models_perf_map();

    // 1. Individua provider attivi e abilitati
    let active_providers: Vec<String> = auth_summary
        .iter()
        .filter(|a| a.has_credential && !config.disabled_providers.contains(&a.provider))
        .map(|a| a.provider.clone())
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

            // Escludi categoricamente modelli a pagamento su provider a consumo
            is_sub || is_free_selector || is_zero_cost || is_local
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
                if let Some(matched_model) = find_matching_catalog_selector(&raw_sel, &catalog) {
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
                if let Some(matched_model) = find_matching_catalog_selector(&raw_sel, &catalog) {
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
}
