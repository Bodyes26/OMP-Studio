//! File sincronizzabili di omp (R-MI-42). La selezione vive sul dispositivo.
use serde::{Deserialize, Serialize};
use serde_json::{Value, Map};
use std::{collections::{BTreeMap, BTreeSet}, path::{Path, PathBuf}, time::UNIX_EPOCH};
use parking_lot::Mutex;

const LIMIT: usize = 512 * 1024;
const AGGREGATE: usize = 8 * 1024 * 1024;
const GENERAL: &[&str] = &["symbolPreset", "colorBlindMode", "cycleOrder", "disabledProviders", "defaultThinkingLevel", "omitThinking"];
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preferences {
    categories: BTreeMap<String, BTreeSet<String>>,
    pinned: BTreeSet<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Document {
    category: String,
    key: String,
    text: Option<String>,
    updated: u64,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pinned: BTreeSet<String>,
}

fn pref_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("omp-settings-sync.json"))
}
fn read_prefs(app: &tauri::AppHandle) -> Result<Preferences, String> {
    match std::fs::read(pref_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn category_ok(category: &str) -> bool { matches!(category, "roles" | "general" | "agents" | "skills" | "rules" | "mcp") }
fn agent() -> Result<PathBuf, String> { crate::omp_ops::agent_dir().ok_or_else(|| "omp settings folder unavailable".into()) }
fn config(root: &Path) -> PathBuf {
    let yml = root.join("config.yml");
    if !yml.exists() && root.join("config.yaml").exists() { root.join("config.yaml") } else { yml }
}
fn skills(root: &Path) -> PathBuf {
    if root.join("skills").exists() { return root.join("skills"); }
    if let Some(home) = root.parent().and_then(Path::parent) {
        let shared = home.join(".agents").join("skills");
        if shared.is_dir() { return shared; }
    }
    root.join("skills")
}
fn valid_parts(key: &str) -> bool {
    !key.is_empty() && key.split('/').all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with('.') &&
        part.chars().all(|c| !c.is_control() && !matches!(c, '\\' | ':' | '<' | '>' | '|' | '?' | '*' | '"')))
}
fn file_for(root: &Path, category: &str, key: &str) -> Result<PathBuf, String> {
    match (category, key) {
        ("roles" | "general", "config.yml") => Ok(config(root)),
        ("mcp", "mcp.json") | ("rules", "AGENTS.md") => Ok(root.join(key)),
        ("agents" | "skills", key) if valid_parts(key) && key.ends_with(".md") => {
            let mut path = if category == "agents" { root.join("agents") } else { skills(root) };
            for part in std::iter::once("").chain(key.split('/')) {
                if !part.is_empty() { path.push(part); }
                if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) { return Err("Symbolic links are not synchronized".into()); }
            }
            Ok(path)
        }
        _ => Err("Invalid omp sync document".into()),
    }
}
fn read_bytes(path: &Path) -> Result<Option<(Vec<u8>, u64)>, String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.is_file() || meta.len() > LIMIT as u64 { return Err("Invalid or oversized omp settings file".into()); }
    let time = meta.modified().ok().and_then(|at| at.duration_since(UNIX_EPOCH).ok()).map(|at| at.as_millis() as u64).unwrap_or(0);
    Ok(Some((std::fs::read(path).map_err(|e| e.to_string())?, time)))
}
fn map(bytes: &[u8], yaml: bool) -> Result<Map<String, Value>, String> {
    let value: Value = if yaml { serde_yaml::from_slice(bytes).map_err(|e| e.to_string())? } else { serde_json::from_slice(bytes).map_err(|e| e.to_string())? };
    match value { Value::Object(m) => Ok(m), Value::Null => Ok(Map::new()), _ => Err("Expected an omp settings object".into()) }
}
fn clean_url(raw: &str) -> Option<&str> {
    let url = url::Url::parse(raw).ok()?;
    (matches!(url.scheme(), "https" | "http") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none()).then_some(raw)
}
fn project_settings(full: &Map<String, Value>, category: &str) -> Map<String, Value> {
    let mut result = Map::new();
    if category == "mcp" {
        let mut result_servers = Map::new();
        if let Some(servers) = full.get("mcpServers").and_then(Value::as_object) {
            for (name, server) in servers {
                let Some(server) = server.as_object() else { continue };
                let mut safe = Map::new();
                if let Some(url) = server.get("url").and_then(Value::as_str).and_then(clean_url) { safe.insert("url".into(), Value::from(url)); }
                if let Some(command) = server.get("command").and_then(Value::as_str).filter(|s| s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))) {
                    safe.insert("command".into(), Value::from(command));
                    if let Some(args) = server.get("args").and_then(Value::as_array) {
                        if args.iter().all(|arg| arg.as_str().is_some_and(|arg| !arg.contains(['=', ':', '?', '&']) && !arg.chars().any(char::is_control))) {
                            safe.insert("args".into(), Value::Array(args.clone()));
                        } else { continue; }
                    }
                }
                if safe.is_empty() { continue; }
                if let Some(kind) = server.get("type").and_then(Value::as_str).filter(|s| matches!(*s, "stdio" | "http" | "sse" | "streamable-http")) { safe.insert("type".into(), Value::from(kind)); }
                result_servers.insert(name.clone(), Value::Object(safe));
            }
        }
        result.insert("mcpServers".into(), Value::Object(result_servers));
    } else {
        let keys: &[&str] = if category == "roles" { &["modelRoles"] } else { GENERAL };
        for &key in keys {
            let Some(value) = full.get(key) else { continue };
            let valid = match key {
                "modelRoles" => value.as_object().is_some_and(|v| v.values().all(Value::is_string)),
                "cycleOrder" | "disabledProviders" => value.as_array().is_some_and(|v| v.iter().all(Value::is_string)),
                _ => value.is_boolean() || value.is_string(),
            };
            if valid { result.insert(key.into(), value.clone()); }
        }
    }
    result
}
fn read_doc(root: &Path, prefs: &Preferences, category: &str, key: &str) -> Result<Document, String> {
    let path = file_for(root, category, key)?;
    let (text, updated) = match read_bytes(&path)? {
        None => (None, 0),
        Some((bytes, at)) if matches!(category, "roles" | "general" | "mcp") => {
            let data = map(&bytes, category != "mcp")?;
            let mut safe = project_settings(&data, category);
            if category == "roles" {
                if let Some(roles) = safe.get_mut("modelRoles").and_then(Value::as_object_mut) {
                    roles.retain(|role, _| !prefs.pinned.contains(role));
                }
            }
            (Some(serde_json::to_string(&safe).map_err(|e| e.to_string())?), at)
        }
        Some((bytes, at)) => (Some(String::from_utf8(bytes).map_err(|e| e.to_string())?), at),
    };
    let pinned = if category == "roles" { prefs.pinned.clone() } else { BTreeSet::new() };
    Ok(Document { category: category.into(), key: key.into(), text, updated, pinned })
}
fn tree(path: &Path, tail: &str, depth: usize, out: &mut Vec<String>) -> Result<(), String> {
    if depth > 12 || out.len() >= 1_000 { return Err("Too many omp settings files".into()); }
    let files = match std::fs::read_dir(path) {
        Ok(files) => files,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for file in files {
        let file = file.map_err(|e| e.to_string())?;
        let kind = file.file_type().map_err(|e| e.to_string())?;
        let name = file.file_name().to_string_lossy().into_owned();
        let key = if tail.is_empty() { name } else { format!("{tail}/{name}") };
        if !valid_parts(&key) { continue; }
        if kind.is_dir() { tree(&file.path(), &key, depth + 1, out)?; }
        else if kind.is_file() && key.ends_with(".md") { out.push(key); }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn omp_sync_preferences(app: tauri::AppHandle, value: Option<Preferences>) -> Result<Preferences, String> {
    let _guard = LOCK.lock();
    if let Some(value) = value {
        let path = pref_path(&app)?;
        crate::fs_atomic::atomic_write(&path, &serde_json::to_vec(&value).map_err(|e| e.to_string())?)?;
        Ok(value)
    } else { read_prefs(&app) }
}
fn peer(request: &tauri::ipc::Request<'_>, machine: Option<String>) -> Result<String, String> {
    request.headers().get("x-studio-authenticated-peer").and_then(|v| v.to_str().ok()).map(str::to_owned)
        .or(machine).ok_or_else(|| "Missing paired machine".into())
}

#[tauri::command]
pub(crate) fn omp_sync_snapshot(app: tauri::AppHandle, request: tauri::ipc::Request<'_>, machine: Option<String>) -> Result<Vec<Document>, String> {
    let peer = peer(&request, machine)?;
    let _guard = LOCK.lock();
    let prefs = read_prefs(&app)?;
    let Some(categories) = prefs.categories.get(&peer) else { return Ok(Vec::new()); };
    let root = agent()?;
    let mut docs = Vec::new();
    let mut bytes = 0;
    for category in categories.iter().filter(|c| category_ok(c)) {
        // Il marcatore distingue categoria disattivata da categoria vuota.
        docs.push(Document { category: category.clone(), key: String::new(), text: None, updated: 0, pinned: BTreeSet::new() });
        let mut keys = Vec::new();
        match category.as_str() {
            "agents" => tree(&root.join("agents"), "", 0, &mut keys)?,
            "skills" => tree(&skills(&root), "", 0, &mut keys)?,
            "rules" => keys.push("AGENTS.md".into()),
            "mcp" => keys.push("mcp.json".into()),
            _ => keys.push("config.yml".into()),
        }
        for key in keys {
            let doc = read_doc(&root, &prefs, category, &key)?;
            bytes += doc.text.as_ref().map_or(0, String::len);
            if bytes > AGGREGATE { return Err("omp settings exceed the sync size limit".into()); }
            docs.push(doc);
        }
    }
    Ok(docs)
}

#[tauri::command]
pub(crate) fn omp_sync_apply(app: tauri::AppHandle, request: tauri::ipc::Request<'_>, machine: Option<String>, document: Document, expected: Option<String>) -> Result<(), String> {
    let peer = peer(&request, machine)?;
    let _guard = LOCK.lock();
    let prefs = read_prefs(&app)?;
    let category = document.category.as_str();
    if !category_ok(category) || !prefs.categories.get(&peer).is_some_and(|enabled| enabled.contains(category)) { return Err("This sync category is disabled".into()); }
    let root = agent()?;
    let path = file_for(&root, category, &document.key)?;
    let current = read_doc(&root, &prefs, category, &document.key)?;
    if current.text != expected { return Err("The file changed while synchronizing".into()); }
    let payload = document.text.as_deref();
    if payload.is_some_and(|text| text.len() > LIMIT) { return Err("omp settings file exceeds the sync size limit".into()); }
    if matches!(category, "roles" | "general" | "mcp") {
        let yaml = category != "mcp";
        let mut full = read_bytes(&path)?.map(|(bytes, _)| map(&bytes, yaml)).transpose()?.unwrap_or_default();
        let incoming = project_settings(&payload.map(|text| map(text.as_bytes(), false)).transpose()?.unwrap_or_default(), category);
        if category == "roles" {
            let mut roles = incoming.get("modelRoles").and_then(Value::as_object).cloned().unwrap_or_default();
            let local = full.get("modelRoles").and_then(Value::as_object);
            for role in prefs.pinned.union(&document.pinned) {
                roles.remove(role);
                if let Some(value) = local.and_then(|map| map.get(role)) { roles.insert(role.clone(), value.clone()); }
            }
            full.insert("modelRoles".into(), Value::Object(roles));
        } else if category == "general" {
            for &key in GENERAL {
                if let Some(value) = incoming.get(key) { full.insert(key.into(), value.clone()); }
                else { full.remove(key); }
            }
        } else {
            let mut servers = incoming.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default();
            if let Some(local) = full.get("mcpServers").and_then(Value::as_object) {
                for (name, old) in local {
                    let Some(old) = old.as_object() else { continue };
                    if let Some(new) = servers.get_mut(name).and_then(Value::as_object_mut) {
                        for key in ["env", "headers"] {
                            if let Some(value) = old.get(key) { new.insert(key.into(), value.clone()); }
                        }
                    } else if old.contains_key("env") || old.contains_key("headers") || !project_settings(&Map::from_iter([(String::from("mcpServers"), Value::Object(Map::from_iter([(name.clone(), Value::Object(old.clone()))])))]), "mcp")["mcpServers"].as_object().is_some_and(|m| m.contains_key(name)) {
                        servers.insert(name.clone(), Value::Object(old.clone()));
                    }
                }
            }
            full.insert("mcpServers".into(), Value::Object(servers));
        }
        let bytes = if yaml { serde_yaml::to_string(&full).map(String::into_bytes).map_err(|e| e.to_string())? }
            else { serde_json::to_vec_pretty(&full).map_err(|e| e.to_string())? };
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        crate::fs_atomic::atomic_write(&path, &bytes)
    } else if let Some(text) = payload {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        crate::fs_atomic::atomic_write(&path, text.as_bytes())
    } else if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string()) } else { Ok(()) }
}
