use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;
// Deserializzazione minimale per estrarre solo usage.cost.total dai messaggi
// assistente nei transcript JSONL dei subagent.
#[derive(serde::Deserialize)]
struct CostEntry {
    total: Option<f64>,
}

#[derive(serde::Deserialize)]
struct UsageEntry {
    cost: Option<CostEntry>,
}

#[derive(serde::Deserialize)]
struct MessageEntry {
    role: Option<String>,
    usage: Option<UsageEntry>,
}

#[derive(serde::Deserialize)]
struct LineEntry {
    message: Option<MessageEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct TranscriptCacheKey {
    path: PathBuf,
    mtime: SystemTime,
    len: u64,
}

/// Limite massimo di transcript subagent memorizzati in memoria (PERF-17).
const MAX_CACHE_ENTRIES: usize = 2048;

struct BoundedCostCache {
    entries: HashMap<TranscriptCacheKey, f64>,
    order: VecDeque<TranscriptCacheKey>,
}

impl BoundedCostCache {
    fn new() -> Self {
        Self {
            entries: HashMap::with_capacity(256),
            order: VecDeque::with_capacity(256),
        }
    }

    fn get(&self, key: &TranscriptCacheKey) -> Option<f64> {
        self.entries.get(key).copied()
    }

    fn insert(&mut self, key: TranscriptCacheKey, cost: f64) {
        if self.entries.contains_key(&key) {
            self.entries.insert(key, cost);
            return;
        }
        if self.entries.len() >= MAX_CACHE_ENTRIES {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key, cost);
    }
}

static COST_CACHE: LazyLock<Mutex<BoundedCostCache>> =
    LazyLock::new(|| Mutex::new(BoundedCostCache::new()));

/// Legge in streaming riga per riga un file di transcript `.jsonl`, estraendo e
/// sommando i costi dei messaggi assistente senza caricare l'intero file in memoria.
fn file_subagent_cost(path: &Path) -> f64 {
    let Ok(file) = File::open(path) else {
        return 0.0;
    };
    let reader = BufReader::new(file);
    let mut total = 0.0;

    for line in reader.lines().map_while(Result::ok) {
        // Fast-path: salta senza deserializzare le righe prive di costo o messaggio assistente
        if !line.contains("\"cost\"") || !line.contains("\"assistant\"") {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<LineEntry>(&line) {
            if let Some(msg) = entry.message {
                if msg.role.as_deref() == Some("assistant") {
                    if let Some(usage) = msg.usage {
                        if let Some(cost) = usage.cost {
                            if let Some(amount) = cost.total {
                                if amount.is_finite() && amount > 0.0 {
                                    total += amount;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    total
}

/// Raccoglie ricorsivamente tutti i file `.jsonl` nella cartella degli artifacts.
/// Il file `__advisor.jsonl` alla radice appartiene alla sessione principale e
/// va escluso; eventuali `__advisor.jsonl` dentro sottocartelle appartengono a
/// subagent e vanno conteggiati (come da specifica omp).
fn collect_subagent_jsonl_files(dir: &Path, is_root: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_subagent_jsonl_files(&path, false, out);
        } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            if is_root && path.file_name().and_then(|s| s.to_str()) == Some("__advisor.jsonl") {
                continue;
            }
            out.push(path);
        }
    }
}

pub fn session_subagent_cost_sync(session_file: &str) -> f64 {
    let artifacts_dir = match session_file.strip_suffix(".jsonl") {
        Some(stem) => PathBuf::from(stem),
        None => PathBuf::from(session_file),
    };

    if !artifacts_dir.is_dir() {
        return 0.0;
    }

    let mut files = Vec::new();
    collect_subagent_jsonl_files(&artifacts_dir, true, &mut files);

    let mut total = 0.0;
    for file in files {
        // Memoizzazione per file (PERF-17): la chiave unisce percorso,
        // data di modifica e dimensione. Se il transcript e' immutato si
        // evita di riaprire e ri-deserializzare l'intero file JSONL.
        let meta = std::fs::metadata(&file).ok();
        let key = meta.map(|m| TranscriptCacheKey {
            path: file.clone(),
            mtime: m.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            len: m.len(),
        });

        if let Some(k) = &key {
            let cached = {
                let cache = COST_CACHE.lock().unwrap_or_else(|p| p.into_inner());
                cache.get(k)
            };
            if let Some(cost) = cached {
                total += cost;
                continue;
            }
        }

        let cost = file_subagent_cost(&file);
        if let Some(k) = key {
            let mut cache = COST_CACHE.lock().unwrap_or_else(|p| p.into_inner());
            cache.insert(k, cost);
        }
        total += cost;
    }
    total
}

/// Comando IPC: calcola il costo totale sostenuto dai subagenti scansionando la
/// cartella degli artifacts della sessione specificata.
#[tauri::command]
pub async fn session_subagent_cost(session_file: String) -> Result<f64, String> {
    tokio::task::spawn_blocking(move || session_subagent_cost_sync(&session_file))
        .await
        .map_err(|e| format!("Task session_subagent_cost: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_nonexistent_session_returns_zero() {
        assert_eq!(session_subagent_cost_sync("/nonexistent/session.jsonl"), 0.0);
    }

    #[test]
    fn test_subagent_cost_calculation_tree() {
        let temp_dir = std::env::temp_dir().join(format!("omp_test_subagents_{}", std::process::id()));
        let session_file = temp_dir.join("test_session.jsonl");
        let artifacts_dir = temp_dir.join("test_session");

        fs::create_dir_all(&artifacts_dir).unwrap();
        // 1. Root advisor: deve essere ESCLUSO
        let mut root_advisor = File::create(artifacts_dir.join("__advisor.jsonl")).unwrap();
        writeln!(
            root_advisor,
            r#"{{"type":"message","message":{{"role":"assistant","usage":{{"cost":{{"total":5.0}}}}}}}}"#
        )
        .unwrap();

        // 2. Subagent A: deve essere INCLUSO (0.10)
        let mut sub_a = File::create(artifacts_dir.join("sub_a.jsonl")).unwrap();
        writeln!(
            sub_a,
            r#"{{"type":"message","message":{{"role":"user","content":"hello"}}}}"#
        )
        .unwrap();
        writeln!(
            sub_a,
            r#"{{"type":"message","message":{{"role":"assistant","usage":{{"cost":{{"total":0.10}}}}}}}}"#
        )
        .unwrap();
        // Riga malformata che deve essere tollerata
        writeln!(sub_a, "corrupted json line").unwrap();

        // 3. Subagent annidato in sottocartella: deve essere INCLUSO (0.02)
        let sub_b_dir = artifacts_dir.join("sub_a");
        fs::create_dir_all(&sub_b_dir).unwrap();
        let mut sub_b = File::create(sub_b_dir.join("sub_b.jsonl")).unwrap();
        writeln!(
            sub_b,
            r#"{{"type":"message","message":{{"role":"assistant","usage":{{"cost":{{"total":0.02}}}}}}}}"#
        )
        .unwrap();

        // 4. Advisor di un subagent dentro la sottocartella: deve essere INCLUSO (0.003)
        let mut sub_b_advisor = File::create(sub_b_dir.join("__advisor.jsonl")).unwrap();
        writeln!(
            sub_b_advisor,
            r#"{{"type":"message","message":{{"role":"assistant","usage":{{"cost":{{"total":0.003}}}}}}}}"#
        )
        .unwrap();

        let cost = session_subagent_cost_sync(session_file.to_str().unwrap());
        let expected = 0.123;
        assert!((cost - expected).abs() < 1e-6);

        // Pulizia
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_subagent_cost_memoization() {
        let temp_dir = std::env::temp_dir().join(format!("omp_test_subagents_memo_{}", std::process::id()));
        let session_file = temp_dir.join("memo_session.jsonl");
        let artifacts_dir = temp_dir.join("memo_session");

        fs::create_dir_all(&artifacts_dir).unwrap();
        let sub_file = artifacts_dir.join("sub_memo.jsonl");
        let mut sub = File::create(&sub_file).unwrap();
        writeln!(
            sub,
            r#"{{"type":"message","message":{{"role":"assistant","usage":{{"cost":{{"total":0.50}}}}}}}}"#
        )
        .unwrap();

        let cost1 = session_subagent_cost_sync(session_file.to_str().unwrap());
        assert!((cost1 - 0.50).abs() < 1e-6);

        // Seconda chiamata: deve restituire lo stesso risultato via cache
        let cost2 = session_subagent_cost_sync(session_file.to_str().unwrap());
        assert_eq!(cost1, cost2);

        // Pulizia
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
