//! Statistiche d'uso per la sezione Impostazioni > Statistiche.
//!
//! I numeri vengono da `~/.omp/stats.db`, il database che `omp stats` riempie
//! leggendo i transcript. Studio lo apre in sola lettura e rifa' la stessa
//! unione esatta della dashboard di omp (`packages/stats/src/rollup.ts`):
//! aggregati orari puliti + righe grezze per l'ora parziale d'inizio e per le
//! ore che i trigger hanno segnato da ricalcolare (`rollup_dirty`).
//!
//! Il database lo aggiorna solo `omp stats`: `stats_sync` lancia
//! `omp stats --json` (ingestione + ricalcolo degli aggregati, poi esce) e la
//! sezione rilegge al termine. La dashboard completa resta quella web di omp.

use crate::omp_ops::{get_omp_binary, omp_capture, open_readonly_db};
use crate::session_index::session_folder_candidates;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::command;

const HOUR_MS: i64 = 3_600_000;
/// Come in omp: oltre questa coda le ore sporche si leggono dagli aggregati
/// (leggermente vecchi) invece di riscansionare le righe grezze.
const EXACT_DIRTY_LIMIT: i64 = 96;
const DASHBOARD_PORT: u16 = 3847;
const DASHBOARD_URL: &str = "http://127.0.0.1:3847";
/// Una sincronizzazione per minuto basta: riaprire la sezione non rilancia omp.
const SYNC_FLOOR: Duration = Duration::from_secs(60);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Fatti additivi di un gruppo (ora, modello, provider, cartella, tipo agente).
#[derive(Default, Clone, Copy)]
struct Facts {
    requests: i64,
    failed: i64,
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    total_tokens: i64,
    cost: f64,
    unpriced: i64,
    cached_prompt_cost: f64,
    no_cache_input_cost: f64,
    ttft_sum: f64,
    ttft_n: i64,
    tps_sum: f64,
    tps_n: i64,
    last_ts: i64,
}

impl Facts {
    fn add(&mut self, o: &Facts) {
        self.requests += o.requests;
        self.failed += o.failed;
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.total_tokens += o.total_tokens;
        self.cost += o.cost;
        self.unpriced += o.unpriced;
        self.cached_prompt_cost += o.cached_prompt_cost;
        self.no_cache_input_cost += o.no_cache_input_cost;
        self.ttft_sum += o.ttft_sum;
        self.ttft_n += o.ttft_n;
        self.tps_sum += o.tps_sum;
        self.tps_n += o.tps_n;
        self.last_ts = self.last_ts.max(o.last_ts);
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsTotals {
    pub requests: i64,
    pub failed: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    /// Stima a prezzi API pubblici, in dollari.
    pub cost: f64,
    /// Richieste senza un prezzo pubblico: escluse dal costo, non gratuite.
    pub unpriced: i64,
    pub cache_rate: f64,
    pub cache_savings: f64,
    pub avg_ttft_ms: Option<f64>,
    pub avg_tokens_per_second: Option<f64>,
    pub last_activity: Option<i64>,
}

impl From<&Facts> for StatsTotals {
    fn from(f: &Facts) -> Self {
        let prompt = f.input + f.cache_read;
        Self {
            requests: f.requests,
            failed: f.failed,
            input_tokens: f.input,
            output_tokens: f.output,
            cache_read_tokens: f.cache_read,
            cache_write_tokens: f.cache_write,
            total_tokens: f.total_tokens,
            cost: f.cost,
            unpriced: f.unpriced,
            cache_rate: if prompt > 0 { f.cache_read as f64 / prompt as f64 } else { 0.0 },
            cache_savings: if f.no_cache_input_cost > 0.0 {
                (f.no_cache_input_cost - f.cached_prompt_cost) / f.no_cache_input_cost
            } else {
                0.0
            },
            avg_ttft_ms: (f.ttft_n > 0).then(|| f.ttft_sum / f.ttft_n as f64),
            avg_tokens_per_second: (f.tps_n > 0).then(|| f.tps_sum / f.tps_n as f64),
            last_activity: (f.last_ts > 0).then_some(f.last_ts),
        }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatsHour {
    /// Inizio dell'ora, millisecondi Unix (UTC).
    pub start: i64,
    pub requests: i64,
    pub failed: i64,
    pub tokens: i64,
    pub cost: f64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsModel {
    pub model: String,
    pub provider: String,
    #[serde(flatten)]
    pub totals: StatsTotals,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsFolder {
    /// Nome della cartella delle sessioni (`-source-repos-progetto`).
    pub folder: String,
    /// Percorso del progetto di Studio a cui corrisponde, se ce n'e' uno.
    pub project_path: Option<String>,
    #[serde(flatten)]
    pub totals: StatsTotals,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsAgent {
    pub agent_type: String,
    #[serde(flatten)]
    pub totals: StatsTotals,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub from: i64,
    pub to: i64,
    pub totals: StatsTotals,
    /// Serie oraria densa (ore vuote a zero) dall'ora di `from` a quella di `to`.
    pub hours: Vec<StatsHour>,
    pub models: Vec<StatsModel>,
    pub folders: Vec<StatsFolder>,
    pub agents: Vec<StatsAgent>,
}

/// Fatti sulle righe grezze di `messages` (`p` = prefisso di tabella),
/// stesse definizioni di `messageFacts` in omp.
fn raw_facts(bucket: &str, p: &str) -> String {
    format!(
        "{bucket} AS bucket, {p}model, {p}provider, {p}folder, {p}agent_type,
         COUNT(*),
         SUM(CASE WHEN {p}stop_reason = 'error' THEN 1 ELSE 0 END),
         SUM({p}input_tokens), SUM({p}output_tokens),
         SUM({p}cache_read_tokens), SUM({p}cache_write_tokens), SUM({p}total_tokens),
         TOTAL({p}cost_total),
         SUM(CASE WHEN {p}total_tokens > 0 AND {p}cost_total = 0
             AND ({p}provider = 'xai-oauth' OR {p}cost_unpriced = 1) THEN 1 ELSE 0 END),
         TOTAL(CASE WHEN {p}cost_no_cache_input > 0
             THEN {p}cost_input + {p}cost_cache_read + {p}cost_cache_write ELSE 0 END),
         TOTAL({p}cost_no_cache_input),
         TOTAL({p}ttft), COUNT({p}ttft),
         TOTAL(CASE WHEN {p}duration > 0 THEN {p}output_tokens * 1000.0 / {p}duration END),
         COUNT(CASE WHEN {p}duration > 0 THEN 1 END),
         MAX({p}timestamp)"
    )
}

const ROLLUP_COLUMNS: &str = "bucket, model, provider, folder, agent_type, requests, failed,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
    cost_total, unpriced, cached_prompt_cost, no_cache_input_cost,
    ttft_sum, ttft_n, tps_sum, tps_n, last_ts";

struct FactRow {
    bucket: i64,
    model: String,
    provider: String,
    folder: String,
    agent_type: String,
    facts: Facts,
}

fn read_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FactRow> {
    let int = |i: usize| -> rusqlite::Result<i64> { Ok(r.get::<_, Option<i64>>(i)?.unwrap_or(0)) };
    let real = |i: usize| -> rusqlite::Result<f64> { Ok(r.get::<_, Option<f64>>(i)?.unwrap_or(0.0)) };
    let text = |i: usize| -> rusqlite::Result<String> { Ok(r.get::<_, Option<String>>(i)?.unwrap_or_default()) };
    Ok(FactRow {
        bucket: int(0)?,
        model: text(1)?,
        provider: text(2)?,
        folder: text(3)?,
        agent_type: text(4)?,
        facts: Facts {
            requests: int(5)?,
            failed: int(6)?,
            input: int(7)?,
            output: int(8)?,
            cache_read: int(9)?,
            cache_write: int(10)?,
            total_tokens: int(11)?,
            cost: real(12)?,
            unpriced: int(13)?,
            cached_prompt_cost: real(14)?,
            no_cache_input_cost: real(15)?,
            ttft_sum: real(16)?,
            ttft_n: int(17)?,
            tps_sum: real(18)?,
            tps_n: int(19)?,
            last_ts: int(20)?,
        },
    })
}

/// Righe di fatti che coprono `[cutoff, adesso]`, senza contare due volte
/// un'ora: vedi l'unione in `messageSource` di omp.
fn fact_rows(conn: &Connection, cutoff: i64) -> rusqlite::Result<Vec<FactRow>> {
    let hi = (cutoff + HOUR_MS - 1).div_euclid(HOUR_MS) * HOUR_MS;
    let dirty: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM (SELECT 1 FROM rollup_dirty LIMIT {})", EXACT_DIRTY_LIMIT + 1),
        [],
        |r| r.get(0),
    )?;
    let exact = dirty <= EXACT_DIRTY_LIMIT;

    let mut rows = Vec::new();
    let clean = format!(
        "SELECT {ROLLUP_COLUMNS} FROM message_rollup WHERE bucket >= ?1{}",
        if exact { " AND bucket NOT IN (SELECT bucket FROM rollup_dirty)" } else { "" }
    );
    let mut stmt = conn.prepare(&clean)?;
    for row in stmt.query_map(params![hi], read_row)? {
        rows.push(row?);
    }

    if cutoff < hi {
        let partial = format!(
            "SELECT {} FROM messages WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY 1, model, provider, folder, agent_type",
            raw_facts(&format!("(timestamp / {HOUR_MS}) * {HOUR_MS}"), "")
        );
        let mut stmt = conn.prepare(&partial)?;
        for row in stmt.query_map(params![cutoff, hi], read_row)? {
            rows.push(row?);
        }
    }

    if exact {
        let dirty_raw = format!(
            "SELECT {} FROM rollup_dirty d
             JOIN messages m ON m.timestamp >= d.bucket AND m.timestamp < d.bucket + {HOUR_MS}
             WHERE d.bucket >= ?1
             GROUP BY d.bucket, m.model, m.provider, m.folder, m.agent_type",
            raw_facts("d.bucket", "m.")
        );
        let mut stmt = conn.prepare(&dirty_raw)?;
        for row in stmt.query_map(params![hi], read_row)? {
            rows.push(row?);
        }
    }
    Ok(rows)
}

fn sorted_by_requests<K, T>(map: HashMap<K, Facts>, build: impl Fn(K, StatsTotals) -> T) -> Vec<T> {
    let mut entries: Vec<(K, Facts)> = map.into_iter().collect();
    entries.sort_by(|a, b| {
        b.1.requests
            .cmp(&a.1.requests)
            .then(b.1.cost.partial_cmp(&a.1.cost).unwrap_or(std::cmp::Ordering::Equal))
    });
    entries.into_iter().map(|(k, f)| build(k, StatsTotals::from(&f))).collect()
}

fn summarize(
    conn: &Connection,
    now: i64,
    range_hours: i64,
    project_paths: &[String],
) -> rusqlite::Result<StatsSummary> {
    let cutoff = now - range_hours * HOUR_MS;
    let rows = fact_rows(conn, cutoff)?;

    let first_hour = cutoff.div_euclid(HOUR_MS) * HOUR_MS;
    let last_hour = now.div_euclid(HOUR_MS) * HOUR_MS;
    let mut hours: Vec<StatsHour> = (0..=((last_hour - first_hour) / HOUR_MS))
        .map(|i| StatsHour { start: first_hour + i * HOUR_MS, requests: 0, failed: 0, tokens: 0, cost: 0.0 })
        .collect();

    let mut totals = Facts::default();
    let mut models: HashMap<(String, String), Facts> = HashMap::new();
    let mut folders: HashMap<String, Facts> = HashMap::new();
    let mut agents: HashMap<String, Facts> = HashMap::new();
    for row in rows {
        totals.add(&row.facts);
        if let Some(hour) = usize::try_from((row.bucket - first_hour) / HOUR_MS).ok().and_then(|i| hours.get_mut(i)) {
            hour.requests += row.facts.requests;
            hour.failed += row.facts.failed;
            hour.tokens += row.facts.total_tokens;
            hour.cost += row.facts.cost;
        }
        models.entry((row.model, row.provider)).or_default().add(&row.facts);
        folders.entry(row.folder).or_default().add(&row.facts);
        agents.entry(row.agent_type).or_default().add(&row.facts);
    }

    let mut by_candidate: HashMap<String, &String> = HashMap::new();
    for path in project_paths {
        for cand in session_folder_candidates(path) {
            by_candidate.entry(cand).or_insert(path);
        }
    }

    Ok(StatsSummary {
        from: cutoff,
        to: now,
        totals: StatsTotals::from(&totals),
        hours,
        models: sorted_by_requests(models, |(model, provider), totals| StatsModel { model, provider, totals }),
        folders: sorted_by_requests(folders, |folder, totals| StatsFolder {
            project_path: by_candidate.get(&folder.to_lowercase()).map(|p| (*p).clone()),
            folder,
            totals,
        }),
        agents: sorted_by_requests(agents, |agent_type, totals| StatsAgent { agent_type, totals }),
    })
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Riepilogo delle ultime `range_hours` ore. Errori con prefisso stabile per
/// l'interfaccia: `missing:` (nessun `stats.db`), `schema:` (formato di omp
/// diverso da quello atteso).
#[command]
pub async fn stats_summary(range_hours: u32, project_paths: Vec<String>) -> Result<StatsSummary, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_readonly_db("stats.db").map_err(|e| format!("missing:{e}"))?;
        summarize(&conn, now_ms(), i64::from(range_hours.clamp(1, 24 * 366)), &project_paths)
            .map_err(|e| format!("schema:{e}"))
    })
    .await
    .map_err(|e| format!("Task stats_summary: {e}"))?
}

static SYNC_LOCK: LazyLock<tokio::sync::Mutex<Option<Instant>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

/// Fa ingerire a omp i transcript nuovi. Un solo processo per volta; entro un
/// minuto dall'ultima riuscita non rilancia. Ritorna `true` se ha sincronizzato.
#[command]
pub async fn stats_sync() -> Result<bool, String> {
    let mut last = SYNC_LOCK.lock().await;
    if last.is_some_and(|at| at.elapsed() < SYNC_FLOOR) {
        return Ok(false);
    }
    tokio::task::spawn_blocking(|| {
        let mut cmd = Command::new(get_omp_binary());
        cmd.args(["stats", "--json"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = omp_capture(cmd).map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| format!("Task stats_sync: {e}"))??;
    *last = Some(Instant::now());
    Ok(true)
}

/// Il server `omp stats` avviato da Studio: vive finche' Studio resta aperto.
static DASHBOARD: LazyLock<Mutex<Option<Child>>> = LazyLock::new(|| Mutex::new(None));

fn dashboard_listening() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], DASHBOARD_PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Apre la dashboard web completa di omp nel browser. Se il server gira gia'
/// (TUI, altra finestra, avvio precedente) apre solo l'indirizzo; altrimenti
/// avvia `omp stats`, che apre il browser da se'.
#[command]
pub async fn stats_open_dashboard() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        if dashboard_listening() {
            return tauri_plugin_opener::open_url(DASHBOARD_URL, None::<&str>).map_err(|e| e.to_string());
        }
        let mut guard = DASHBOARD.lock();
        if let Some(child) = guard.as_mut() {
            // Avviato da poco e non ancora in ascolto: non serve un secondo server.
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        let mut cmd = Command::new(get_omp_binary());
        cmd.args(["stats", "--port", &DASHBOARD_PORT.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        *guard = Some(cmd.spawn().map_err(|e| format!("Avvio di omp stats non riuscito: {e}"))?);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task stats_open_dashboard: {e}"))?
}

/// Chiude il server della dashboard avviato da Studio, all'uscita dell'app.
pub fn stop_dashboard() {
    if let Some(mut child) = DASHBOARD.lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE messages (
                folder TEXT, model TEXT, provider TEXT, timestamp INTEGER, duration REAL, ttft REAL,
                stop_reason TEXT, input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_tokens INTEGER,
                cost_input REAL, cost_output REAL, cost_cache_read REAL, cost_cache_write REAL,
                cost_total REAL, agent_type TEXT, cost_no_cache_input REAL, cost_unpriced INTEGER);
             CREATE TABLE message_rollup (
                bucket INTEGER, model TEXT, provider TEXT, folder TEXT, agent_type TEXT,
                requests INTEGER, failed INTEGER, input_tokens INTEGER, output_tokens INTEGER,
                cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_tokens INTEGER,
                premium_requests REAL, cost_total REAL, cost_input REAL, cost_output REAL,
                cost_cache_read REAL, cost_cache_write REAL, unpriced INTEGER,
                cached_prompt_cost REAL, no_cache_input_cost REAL, duration_sum REAL,
                duration_n INTEGER, ttft_sum REAL, ttft_n INTEGER, tps_sum REAL, tps_n INTEGER,
                first_ts INTEGER, last_ts INTEGER);
             CREATE TABLE rollup_dirty (bucket INTEGER PRIMARY KEY) WITHOUT ROWID;",
        )
        .unwrap();
    }

    fn message(conn: &Connection, ts: i64, folder: &str, agent: &str, stop: &str, cost: f64) {
        conn.execute(
            "INSERT INTO messages VALUES (?1, 'm1', 'p1', ?2, 2000, 500, ?3, 10, 100, 90, 0, 200,
                0, 0, 0, 0, ?4, ?5, 1.0, 0)",
            params![folder, ts, stop, cost, agent],
        )
        .unwrap();
    }

    /// Aggregato pulito di un'ora come lo scriverebbe omp (1 richiesta).
    fn rollup(conn: &Connection, bucket: i64, folder: &str, cost: f64) {
        conn.execute(
            "INSERT INTO message_rollup VALUES (?1, 'm1', 'p1', ?2, 'main', 1, 0, 10, 100, 90, 0, 200,
                0, ?3, 0, 0, 0, 0, 0, 0, 1.0, 2000, 1, 500, 1, 50, 1, ?1, ?1)",
            params![bucket, folder, cost],
        )
        .unwrap();
    }

    #[test]
    fn unione_esatta_senza_doppi_conteggi() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        let h = |n: i64| 1_000 * HOUR_MS + n * HOUR_MS;
        let now = h(10) + 30 * 60_000;
        // Finestra di 6 ore: cutoff a h(4)+30min, prima ora intera h(5).
        // Ora parziale (prima di h(5)): solo il messaggio dopo il cutoff conta.
        message(&conn, h(4) + 10 * 60_000, "--c--a--", "main", "stop", 1.0);
        message(&conn, h(4) + 40 * 60_000, "--c--a--", "main", "stop", 2.0);
        // Ora pulita: conta l'aggregato, non le righe grezze.
        rollup(&conn, h(6), "--c--a--", 4.0);
        // Ora sporca: l'aggregato e' vecchio, contano le righe grezze.
        rollup(&conn, h(8), "--c--a--", 100.0);
        message(&conn, h(8) + 60_000, "--c--b--", "subagent", "error", 8.0);
        message(&conn, h(8) + 120_000, "--c--a--", "main", "stop", 16.0);
        conn.execute("INSERT INTO rollup_dirty VALUES (?1)", params![h(8)]).unwrap();
        // Fuori finestra.
        rollup(&conn, h(1), "--c--a--", 1000.0);

        let s = summarize(&conn, now, 6, &["C:/a".to_string()]).unwrap();
        assert_eq!(s.totals.requests, 4);
        assert_eq!(s.totals.failed, 1);
        assert!((s.totals.cost - 30.0).abs() < 1e-9);
        assert!((s.totals.cache_rate - 0.9).abs() < 1e-9);

        assert_eq!(s.hours.first().unwrap().start, h(4));
        assert_eq!(s.hours.len(), 7);
        let costs: Vec<f64> = s.hours.iter().map(|x| x.cost).collect();
        assert_eq!(costs, vec![2.0, 0.0, 4.0, 0.0, 24.0, 0.0, 0.0]);

        let a = s.folders.iter().find(|f| f.folder == "--c--a--").unwrap();
        assert_eq!(a.project_path.as_deref(), Some("C:/a"));
        assert_eq!(a.totals.requests, 3);
        let b = s.folders.iter().find(|f| f.folder == "--c--b--").unwrap();
        assert_eq!(b.project_path, None);
        let sub = s.agents.iter().find(|x| x.agent_type == "subagent").unwrap();
        assert_eq!(sub.totals.requests, 1);
    }

    #[test]
    fn schema_diverso_e_un_errore() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE rollup_dirty (bucket INTEGER PRIMARY KEY);").unwrap();
        assert!(summarize(&conn, now_ms(), 24, &[]).is_err());
    }
}
