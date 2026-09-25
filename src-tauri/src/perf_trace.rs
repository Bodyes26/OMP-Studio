//! Traccia dei tempi: misura dove Studio spende il tempo.
//!
//! Frontend e backend scrivono sullo stesso file (`perf-trace.log` nella
//! cartella dei log dell'app) righe con istante assoluto in millisecondi, cosi'
//! le due origini si allineano senza orologi condivisi. La scrittura avviene su
//! un thread dedicato: chi misura non deve mai pagare l'I/O della misura.
//!
//! Formato riga: `<epoch_ms> <+secondi dall'avvio> <origine> <ambito> <durata_ms> <etichetta>`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};

/// Oltre questa soglia il file riparte: interessa la sessione in corso.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

static SINK: OnceLock<Mutex<Sender<String>>> = OnceLock::new();
static STARTED: LazyLock<Instant> = LazyLock::new(Instant::now);
static PATH: OnceLock<PathBuf> = OnceLock::new();

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn since_start_secs() -> f64 {
    STARTED.elapsed().as_secs_f64()
}

/// Accoda righe al file, azzerandolo oltre il tetto. Separata per i test.
fn append_lines(path: &Path, lines: &[String]) -> std::io::Result<()> {
    if fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        let _ = fs::remove_file(path);
    }
    let mut buffer = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
    for line in lines {
        buffer.push_str(line.trim_end_matches(['\r', '\n']));
        buffer.push('\n');
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(buffer.as_bytes())
}

/// Avvia il thread di scrittura. Le righe registrate prima dell'avvio vanno
/// perse: il setup parte prima di qualunque misura interessante.
pub fn init(app: &AppHandle) {
    LazyLock::force(&STARTED);
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("perf-trace.log");
    let _ = PATH.set(path.clone());
    let (tx, rx) = channel::<String>();
    if SINK.set(Mutex::new(tx)).is_err() {
        return;
    }
    let _ = append_lines(
        &path,
        &[format!(
            "{} {:>8.3} rust app 0 --- avvio Studio v{} ---",
            epoch_ms(),
            0.0,
            env!("CARGO_PKG_VERSION")
        )],
    );
    std::thread::spawn(move || {
        // Un recv bloccante per riga, poi si svuota cio' che e' gia' in coda:
        // una raffica di spawn git diventa una sola scrittura.
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            while let Ok(next) = rx.try_recv() {
                batch.push(next);
            }
            let _ = append_lines(&path, &batch);
        }
    });
}

fn push(line: String) {
    if let Some(sink) = SINK.get() {
        if let Ok(tx) = sink.lock() {
            let _ = tx.send(line);
        }
    }
}

/// Registra una durata misurata nel backend.
pub fn record(scope: &str, label: &str, elapsed: Duration) {
    push(format!(
        "{} {:>8.3} rust {} {:.1} {}",
        epoch_ms(),
        since_start_secs(),
        scope,
        elapsed.as_secs_f64() * 1000.0,
        label.replace(['\r', '\n'], " ")
    ));
}

/// Misura un intervallo: la durata si registra quando la guardia esce di scena.
pub struct Span {
    scope: &'static str,
    label: String,
    started: Instant,
}

impl Drop for Span {
    fn drop(&mut self) {
        record(self.scope, &self.label, self.started.elapsed());
    }
}

pub fn span(scope: &'static str, label: impl Into<String>) -> Span {
    Span {
        scope,
        label: label.into(),
        started: Instant::now(),
    }
}

/// Etichetta leggibile per un comando esterno: programma e argomenti.
pub fn command_label(program: &str, args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>) -> String {
    let mut label = program.to_string();
    for arg in args {
        label.push(' ');
        label.push_str(&arg.as_ref().to_string_lossy());
    }
    label
}

/// Righe gia' formattate dal frontend (origine `web`).
#[command]
pub async fn perf_trace_append(lines: Vec<String>) -> Result<(), String> {
    for line in lines {
        push(line);
    }
    Ok(())
}

/// Percorso del file di traccia, da mostrare a chi deve raccoglierlo.
#[command]
pub async fn perf_trace_path() -> Result<String, String> {
    PATH.get()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Traccia dei tempi non inizializzata".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oltre_il_tetto_il_file_riparte_invece_di_crescere_senza_fine() {
        let path = std::env::temp_dir().join(format!(
            "omp-studio-perf-trace-{}.log",
            std::process::id()
        ));
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();

        append_lines(&path, &["dopo il taglio\n".to_string()]).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "dopo il taglio\n");
        let _ = fs::remove_file(&path);
    }
}
