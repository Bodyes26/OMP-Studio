use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
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
        serde_yaml::from_str(&text).unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()))
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
            let clean_provider = provider_id.split(':').next().unwrap_or(&provider_id).to_string();

            if let Ok(raw_models) = serde_json::from_str::<Vec<serde_json::Value>>(&json_str) {
                for m in raw_models {
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if id.is_empty() {
                        continue;
                    }
                    let name = m.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
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
                            let mode = th.get("mode").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let efforts = th.get("efforts").and_then(|v| v.as_array()).map(|arr| {
                                arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()
                            });
                            thinking_info = Some(ModelThinkingInfo { mode, efforts });
                        }
                    }

                    let input = m.get("input").and_then(|v| v.as_array()).map(|arr| {
                        arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()
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
        .prepare("SELECT provider, credential_type, identity_key, disabled_cause FROM auth_credentials")
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
        let date_digits: String = suffix.chars().filter(|c| c.is_ascii_digit()).take(8).collect();
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
                if prefix == "v" { "v{V}" } else { "k{V}" }
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

fn find_matching_catalog_selector<'a>(raw_sel: &str, catalog: &'a [ModelDto]) -> Option<&'a ModelDto> {
    let clean = raw_sel.trim();
    if clean.is_empty() {
        return None;
    }
    // 1. Exact match
    if let Some(m) = catalog.iter().find(|m| m.selector == clean || m.id == clean) {
        return Some(m);
    }
    // 2. Case insensitive exact match
    let clean_lower = clean.to_lowercase();
    if let Some(m) = catalog.iter().find(|m| m.selector.to_lowercase() == clean_lower || m.id.to_lowercase() == clean_lower) {
        return Some(m);
    }
    // 3. Substring match
    if let Some(m) = catalog.iter().find(|m| m.selector.to_lowercase().contains(&clean_lower) || clean_lower.contains(&m.selector.to_lowercase())) {
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

    // 1. Individua provider attivi e abilitati
    let active_providers: Vec<String> = auth_summary
        .into_iter()
        .filter(|a| a.has_credential && !config.disabled_providers.contains(&a.provider))
        .map(|a| a.provider)
        .collect();

    if active_providers.is_empty() {
        return Ok(RoleSuggestionsResponse {
            role_id,
            primary: Vec::new(),
            fallback: Vec::new(),
        });
    }

    // 2. Filtra catalogo per provider attivi e requisiti minimi di ruolo
    let candidate_models: Vec<ModelDto> = catalog
        .iter()
        .filter(|m| active_providers.contains(&m.provider))
        .filter(|m| {
            if role_id == "vision" {
                m.input.as_ref().map(|i| i.iter().any(|v| v == "image")).unwrap_or(false)
            } else {
                true
            }
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
                if tpl_other == tpl_cur && is_version_newer(&ver_cur, date_cur, &ver_other, date_other) {
                    has_newer = true;
                    break;
                }
            }
        }
        if !has_newer {
            deduplicated.push(m.clone());
        }
    }

    // 4. Limita a max 12 modelli per provider per mantenere compatto il prompt
    let mut grouped_by_prov: HashMap<String, Vec<ModelDto>> = HashMap::new();
    for m in deduplicated {
        grouped_by_prov.entry(m.provider.clone()).or_default().push(m);
    }

    let mut final_candidates: Vec<ModelDto> = Vec::new();
    for (_, mut list) in grouped_by_prov {
        if list.len() > 12 {
            list.truncate(12);
        }
        final_candidates.extend(list);
    }

    // 5. Costruzione del sommario dei modelli disponibili
    let mut models_summary = String::new();
    for m in &final_candidates {
        let mut tags: Vec<String> = Vec::new();
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
        if m.selector.ends_with(":free") {
            tags.push("FREE".to_string());
        }
        let tags_str = if tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", tags.join(", "))
        };
        models_summary.push_str(&format!(
            "- {} (nome: \"{}\", provider: {}){}\n",
            m.selector, m.name, m.provider, tags_str
        ));
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
Modelli disponibili dai provider autenticati dell'utente:\n\
{models_summary}\n\
OBIETTIVO:\n\
1. Suggerisci 2-3 modelli PRIMARI per questo ruolo (es. Top Quality, Miglior Velocita/Costo, Free se disponibile).\n\
2. Suggerisci 2-3 modelli di RISERVA (FALLBACK).\n\
REGOLA FONDAMENTALE SUI FALLBACK:\n\
I modelli di fallback DEVONO appartenere a un PROVIDER DIVERSO da quello del modello primario \"{primary_info}\" per garantire continuita operativa in caso di rate-limit (429) o disservizio.\n\n\
Rispondi ESCLUSIVAMENTE con un JSON valido con questa struttura esatta:\n\
{{\n\
  \"primary\": [\n\
    {{\n\
      \"selector\": \"selettore-esatto-dalla-lista\",\n\
      \"reason\": \"Breve spiegazione in italiano (max 10 parole)\",\n\
      \"badge\": \"Consigliato\",\n\
      \"recommendedThinking\": \"auto\"\n\
    }}\n\
  ],\n\
  \"fallback\": [\n\
    {{\n\
      \"selector\": \"selettore-esatto-da-provider-diverso\",\n\
      \"reason\": \"Breve spiegazione in italiano del perche come riserva\",\n\
      \"badge\": \"Riserva Google\"\n\
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

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("Errore esecuzione omp per suggerimenti: {}", e);
            return Ok(RoleSuggestionsResponse {
                role_id,
                primary: Vec::new(),
                fallback: Vec::new(),
            });
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let trimmed = stdout_str.trim();

    // Estrai JSON valido se ci sono wrapper markdown
    let json_candidate = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end >= start {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let parsed: RawLlmSuggestions = match serde_json::from_str(json_candidate) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Impossibile deserializzare suggerimenti LLM: {}. Raw: {}", e, trimmed);
            return Ok(RoleSuggestionsResponse {
                role_id,
                primary: Vec::new(),
                fallback: Vec::new(),
            });
        }
    };

    let mut validated_primary: Vec<SuggestedModelItem> = Vec::new();
    if let Some(items) = parsed.primary {
        for it in items {
            if let Some(raw_sel) = it.selector {
                if let Some(matched_model) = find_matching_catalog_selector(&raw_sel, &catalog) {
                    if !validated_primary.iter().any(|p| p.selector == matched_model.selector) {
                        validated_primary.push(SuggestedModelItem {
                            selector: matched_model.selector.clone(),
                            reason: it.reason.unwrap_or_else(|| "Modello consigliato per questo ruolo".to_string()),
                            badge: it.badge,
                            recommended_thinking: it.recommended_thinking,
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
                    if !validated_fallback.iter().any(|f| f.selector == matched_model.selector) {
                        validated_fallback.push(SuggestedModelItem {
                            selector: matched_model.selector.clone(),
                            reason: it.reason.unwrap_or_else(|| "Riserva consigliata su rate-limit".to_string()),
                            badge: it.badge,
                            recommended_thinking: it.recommended_thinking,
                        });
                    }
                }
            }
        }
    }

    Ok(RoleSuggestionsResponse {
        role_id,
        primary: validated_primary,
        fallback: validated_fallback,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
