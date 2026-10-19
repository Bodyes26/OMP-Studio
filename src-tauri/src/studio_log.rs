//! Registro di vita di Studio (`studio.log` nella cartella dei log dell'app).
//!
//! Racconta cosa e' successo, non quanto e' durato (per i tempi c'e'
//! `perf-trace.log`): avvii e uscite, finestre, processi `omp`, cambi di
//! progetto, errori JavaScript, panic, blocchi dell'interfaccia. E' sempre
//! attivo e deve sopravvivere al riavvio che segue un blocco: per questo il
//! file non si azzera mai, oltre il tetto passa a `studio.prev.log` e riparte.
//!
//! Formato riga: `<ISO UTC> <origine> <LIVELLO> <categoria> <messaggio>`,
//! con origine `rust` o `web:<finestra>`. Le righe del frontend arrivano gia'
//! formattate; la scrittura avviene su un thread dedicato.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};

/// Oltre questa soglia il file corrente diventa `studio.prev.log`.
const MAX_BYTES: u64 = 4 * 1024 * 1024;
/// Una riga oltre questa lunghezza e' quasi sempre un payload incollato per
/// errore: si tronca, il registro deve restare leggibile.
const MAX_LINE_CHARS: usize = 8 * 1024;

static SINK: OnceLock<Mutex<Sender<Vec<String>>>> = OnceLock::new();
static PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `2026-10-19T10:06:42.123Z`. UTC come nel frontend (`toISOString`): le due
/// origini si leggono sulla stessa scala senza conoscere il fuso.
fn iso_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let millis = ms % 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Algoritmo civil_from_days di Howard Hinnant.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60,
        millis
    )
}

/// Una riga per voce: a capo e ritorni diventano ` | `, cosi' uno stack resta
/// su una riga e il file si legge e si filtra per righe.
fn sanitize(line: &str) -> String {
    let flat = line.trim_end_matches(['\r', '\n']).replace("\r\n", " | ").replace(['\r', '\n'], " | ");
    if flat.chars().count() <= MAX_LINE_CHARS {
        return flat;
    }
    let mut cut: String = flat.chars().take(MAX_LINE_CHARS).collect();
    cut.push_str(" …[troncata]");
    cut
}

fn format_line(ms: u64, level: Level, category: &str, message: &str) -> String {
    sanitize(&format!("{} rust {} {} {}", iso_utc(ms), level.as_str(), category, message))
}

fn prev_path(path: &Path) -> PathBuf {
    path.with_file_name("studio.prev.log")
}

/// Oltre il tetto il file corrente prende il posto del precedente: restano
/// sempre l'ultima porzione e quella prima, mai un file vuoto dopo un blocco.
fn rotate_if_needed(path: &Path) {
    if fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        let _ = fs::rename(path, prev_path(path));
    }
}

fn append_lines(path: &Path, lines: &[String]) -> std::io::Result<()> {
    rotate_if_needed(path);
    let mut buffer = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
    for line in lines {
        buffer.push_str(line);
        buffer.push('\n');
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(buffer.as_bytes())
}

/// Avvia il thread di scrittura e il gancio dei panic. Va chiamata per prima
/// nel setup: cio' che succede prima non si registra.
pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("studio.log");
    if PATH.set(path.clone()).is_err() {
        return;
    }
    let (tx, rx) = channel::<Vec<String>>();
    if SINK.set(Mutex::new(tx)).is_err() {
        return;
    }
    let _ = append_lines(
        &path,
        &[format_line(
            epoch_ms(),
            Level::Info,
            "app",
            &format!(
                "--- avvio Studio v{} pid={} os={} arch={} ---",
                env!("CARGO_PKG_VERSION"),
                std::process::id(),
                std::env::consts::OS,
                std::env::consts::ARCH
            ),
        )],
    );
    install_panic_hook(path.clone());
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = first;
            while let Ok(next) = rx.try_recv() {
                batch.extend(next);
            }
            let _ = append_lines(&path, &batch);
        }
    });
}

/// Il panic puo' chiudere il processo prima che il thread di scrittura
/// raggiunga il disco: la riga si scrive qui, in modo sincrono.
fn install_panic_hook(path: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "?".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic senza messaggio".to_string());
        let thread = std::thread::current().name().unwrap_or("senza nome").to_string();
        let _ = append_lines(
            &path,
            &[format_line(
                epoch_ms(),
                Level::Error,
                "panic",
                &format!("thread={} {} @ {}", thread, payload, location),
            )],
        );
        previous(info);
    }));
}

fn push(lines: Vec<String>) {
    if let Some(sink) = SINK.get() {
        if let Ok(tx) = sink.lock() {
            let _ = tx.send(lines);
        }
    }
}

/// Registra un evento del backend.
pub fn log(level: Level, category: &str, message: impl AsRef<str>) {
    push(vec![format_line(epoch_ms(), level, category, message.as_ref())]);
}

pub fn info(category: &str, message: impl AsRef<str>) {
    log(Level::Info, category, message);
}

pub fn warn(category: &str, message: impl AsRef<str>) {
    log(Level::Warn, category, message);
}

/// Righe gia' formattate dal frontend (origine `web:<finestra>`).
#[command]
pub async fn studio_log_append(lines: Vec<String>) -> Result<(), String> {
    push(lines.iter().map(|line| sanitize(line)).collect());
    Ok(())
}

/// Percorso del registro, da mostrare o aprire per chi deve raccoglierlo.
#[command]
pub async fn studio_log_path() -> Result<String, String> {
    PATH.get()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Registro di Studio non inizializzato".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_utc_formatta_date_e_bisestili() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_utc(1_792_399_244_231), "2026-10-19T08:40:44.231Z");
        assert_eq!(iso_utc(1_798_761_599_999), "2026-12-31T23:59:59.999Z");
    }

    #[test]
    fn sanitize_porta_ogni_voce_su_una_riga_e_tronca_le_enormi() {
        assert_eq!(sanitize("Errore\n    at a\r\n    at b\n"), "Errore |     at a |     at b");
        let long = "x".repeat(MAX_LINE_CHARS + 10);
        let cut = sanitize(&long);
        assert!(cut.ends_with("…[troncata]"));
        assert_eq!(cut.chars().count(), MAX_LINE_CHARS + "…[troncata]".chars().count() + 1);
    }

    #[test]
    fn oltre_il_tetto_il_registro_passa_al_precedente_senza_perderlo() {
        let dir = std::env::temp_dir().join(format!("omp-studio-log-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("studio.log");
        let prev = prev_path(&path);
        let _ = fs::remove_file(&prev);
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();

        append_lines(&path, &["riga nuova".to_string()]).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "riga nuova\n");
        assert_eq!(fs::metadata(&prev).unwrap().len(), MAX_BYTES + 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
