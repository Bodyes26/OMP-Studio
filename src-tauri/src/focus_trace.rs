//! Tracciatore diagnostico del fuoco.
//!
//! Strumentazione temporanea: serve a capire chi porta la finestra principale
//! in primo piano, o sposta il fuoco sul composer, mentre un agente lavora.
//! Il frontend accumula gli eventi in un anello di memoria e li scarica qui a
//! lotti; qui vengono accodati a un unico file di testo. Niente rotazione:
//! oltre un tetto il file riparte, perche' la traccia interessa la sessione in
//! corso e non lo storico.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

/// Oltre questa soglia il file riparte da zero.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn trace_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Cartella dei log non risolvibile: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Creazione cartella log fallita: {}", e))?;
    Ok(dir.join("focus-trace.log"))
}

/// Percorso del file di traccia, da mostrare a chi deve raccoglierlo.
#[command]
pub fn focus_trace_path(app: AppHandle) -> Result<String, String> {
    Ok(trace_path(&app)?.to_string_lossy().to_string())
}

/// Accoda un lotto di righe al file indicato, azzerandolo se ha superato il
/// tetto. Separata dal comando per poterla provare senza un `AppHandle`.
fn append_lines(path: &Path, lines: &[String]) -> Result<(), String> {
    if fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        let _ = fs::remove_file(path);
    }
    let mut buffer = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
    for line in lines {
        buffer.push_str(line.trim_end_matches(['\r', '\n']));
        buffer.push('\n');
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Apertura file di traccia fallita: {}", e))?;
    file.write_all(buffer.as_bytes())
        .map_err(|e| format!("Scrittura traccia fallita: {}", e))
}

/// Accoda un lotto di righe gia' formattate dal frontend.
#[command]
pub fn focus_trace_append(app: AppHandle, lines: Vec<String>) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    append_lines(&trace_path(&app)?, &lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "omp-studio-focus-trace-{}-{}.log",
            label,
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn le_righe_si_accodano_una_per_riga_senza_doppi_a_capo() {
        let path = temp_file("append");
        append_lines(&path, &["prima".to_string(), "seconda\n".to_string()]).unwrap();
        append_lines(&path, &["terza\r\n".to_string()]).unwrap();

        let written = fs::read_to_string(&path).unwrap();
        assert_eq!(written, "prima\nseconda\nterza\n");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn oltre_il_tetto_il_file_riparte_invece_di_crescere_senza_fine() {
        let path = temp_file("rotate");
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();

        append_lines(&path, &["dopo il taglio".to_string()]).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "dopo il taglio\n");
        let _ = fs::remove_file(&path);
    }
}
