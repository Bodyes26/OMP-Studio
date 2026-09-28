//! Gestione sicura degli allegati non immagine della chat (C23).
//!
//! Gli allegati non immagine (e video) vengono salvati nella cartella locale
//! dell'applicazione `%LOCALAPPDATA%/sh.omp.studio/attachments/<sessionKey>/<n>-<nome>`
//! e citati per percorso assoluto nel prompt dell'agente.
//!
//! Vincoli di sicurezza:
//! - Limite di dimensione: massimo 50 MB per file.
//! - Confinamento del percorso: nessun traversal fuori da `attachments/<sessionKey>`.
//! - Sanificazione del nome file e della chiave sessione: eliminazione caratteri
//!   pericolosi, nomi riservati Windows e separatori di percorso.

use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

/// Limite massimo di dimensione per un allegato: 50 MiB.
pub const MAX_ATTACHMENT_SIZE: usize = 50 * 1024 * 1024;

/// Risultato dello staging di un allegato sul filesystem locale.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachment {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// Nomi riservati su Windows che non possono essere usati come nome file base.
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanifica la chiave di sessione per l'uso come nome di directory.
pub fn sanitize_session_key(session_key: &str) -> String {
    let sanitized: String = session_key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let trimmed = sanitized.trim_matches(|c| c == '.' || c == '_' || c == ' ');
    if trimmed.is_empty() {
        "default_session".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Sanifica il nome del file eliminando traversal, caratteri non validi e nomi riservati.
pub fn sanitize_attachment_filename(name: &str) -> String {
    // Estrae solo l'ultimo componente del percorso nel caso fosse stato passato un percorso completo
    let base_raw = Path::new(name)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(name);

    // Rimuove caratteri di controllo, null byte e caratteri vietati su filesystem
    let mut cleaned: String = base_raw
        .chars()
        .filter(|c| !c.is_control() && *c != '\0')
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            other => other,
        })
        .collect();

    // Rimuove punti e spazi iniziali e finali
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        return "attachment.bin".to_string();
    }
    cleaned = trimmed.to_string();

    // Separa estensione per preservarla durante eventuali troncamenti
    let (stem, ext) = match cleaned.rfind('.') {
        Some(dot_idx) if dot_idx > 0 => {
            (&cleaned[..dot_idx], Some(&cleaned[dot_idx..]))
        }
        _ => (cleaned.as_str(), None),
    };

    // Controlla nomi riservati Windows
    let stem_upper = stem.to_ascii_uppercase();
    let safe_stem = if WINDOWS_RESERVED_NAMES.contains(&stem_upper.as_str()) {
        format!("_{stem}")
    } else {
        stem.to_string()
    };

    // Limita la lunghezza del nome a 120 caratteri
    let ext_str = ext.unwrap_or("");
    let max_stem_len = 120usize.saturating_sub(ext_str.len()).max(1);
    let final_stem: String = safe_stem.chars().take(max_stem_len).collect();

    format!("{final_stem}{ext_str}")
}

/// Risolve e valida la cartella degli allegati di una sessione garantendo il confinamento.
pub fn resolve_session_attachments_dir(data_dir: &Path, session_key: &str) -> Result<PathBuf, String> {
    let attachments_root = data_dir.join("attachments");
    let safe_key = sanitize_session_key(session_key);
    let session_dir = attachments_root.join(safe_key);

    // Verifica di confinamento: nessun componente genitore `..` o radice deve uscire
    for comp in session_dir.strip_prefix(data_dir).map_err(|e| e.to_string())?.components() {
        if matches!(comp, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Tentativo di path traversal nella chiave di sessione".to_string());
        }
    }

    Ok(session_dir)
}

/// Salva un allegato nella cartella locale della sessione e restituisce il percorso assoluto.
#[tauri::command]
pub async fn stage_chat_attachment(
    app: AppHandle,
    session_key: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<StagedAttachment, String> {
    if bytes.len() > MAX_ATTACHMENT_SIZE {
        return Err(format!(
            "Dimensione file eccede il limite consentito di {} MiB",
            MAX_ATTACHMENT_SIZE / (1024 * 1024)
        ));
    }

    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Impossibile risolvere cartella dati app: {e}"))?;

    let session_dir = resolve_session_attachments_dir(&data_dir, &session_key)?;
    fs::create_dir_all(&session_dir)
        .map_err(|e| format!("Impossibile creare cartella allegati: {e}"))?;

    // Determina il prefisso numerico sequenziale <n>-
    let count = match fs::read_dir(&session_dir) {
        Ok(entries) => entries.filter_map(Result::ok).count() + 1,
        Err(_) => 1,
    };

    let safe_name = sanitize_attachment_filename(&file_name);
    let prefixed_name = format!("{count}-{safe_name}");
    let target_path = session_dir.join(&prefixed_name);

    // Verifica confinamento finale
    if target_path.parent() != Some(&session_dir) {
        return Err("Tentativo di path traversal nel nome dell'allegato".to_string());
    }

    fs::write(&target_path, &bytes)
        .map_err(|e| format!("Impossibile scrivere il file allegato: {e}"))?;

    let size = bytes.len() as u64;
    let path_str = target_path.to_string_lossy().to_string();

    Ok(StagedAttachment {
        path: path_str,
        name: safe_name,
        size,
    })
}

/// Elimina la cartella degli allegati associata alla sessione.
#[tauri::command]
pub async fn cleanup_chat_attachments(app: AppHandle, session_key: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Impossibile risolvere cartella dati app: {e}"))?;

    let session_dir = resolve_session_attachments_dir(&data_dir, &session_key)?;
    if session_dir.exists() {
        fs::remove_dir_all(&session_dir)
            .map_err(|e| format!("Impossibile eliminare cartella allegati: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename_traversal() {
        assert_eq!(sanitize_attachment_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_attachment_filename("..\\..\\windows\\system32\\calc.exe"), "calc.exe");
        assert_eq!(sanitize_attachment_filename("folder/subfolder/file.pdf"), "file.pdf");
    }

    #[test]
    fn test_sanitize_filename_invalid_chars() {
        assert_eq!(sanitize_attachment_filename("report:2026*final?.pdf"), "report_2026_final_.pdf");
        assert_eq!(sanitize_attachment_filename("<script>alert.js"), "_script_alert.js");
        assert_eq!(sanitize_attachment_filename("  test file .txt  "), "test file .txt");
        assert_eq!(sanitize_attachment_filename("..."), "attachment.bin");
        assert_eq!(sanitize_attachment_filename(""), "attachment.bin");
    }

    #[test]
    fn test_sanitize_filename_windows_reserved() {
        assert_eq!(sanitize_attachment_filename("con.txt"), "_con.txt");
        assert_eq!(sanitize_attachment_filename("PRN.log"), "_PRN.log");
        assert_eq!(sanitize_attachment_filename("NUL"), "_NUL");
        assert_eq!(sanitize_attachment_filename("com1.dat"), "_com1.dat");
    }

    #[test]
    fn test_sanitize_session_key() {
        assert_eq!(sanitize_session_key("lane:proj:main"), "lane_proj_main");
        assert_eq!(sanitize_session_key("../../evil/path"), "evil_path");
        assert_eq!(sanitize_session_key("valid-session_123"), "valid-session_123");
        assert_eq!(sanitize_session_key("..."), "default_session");
    }

    #[test]
    fn test_resolve_session_attachments_dir_confinement() {
        let base = PathBuf::from("/tmp/app_data");
        let dir = resolve_session_attachments_dir(&base, "lane:my-project:feat/1").unwrap();
        assert!(dir.starts_with(base.join("attachments")));
        assert_eq!(dir, base.join("attachments").join("lane_my-project_feat_1"));

        // Tentativo di traversal con ../
        let traversal_dir = resolve_session_attachments_dir(&base, "../../../etc").unwrap();
        assert!(traversal_dir.starts_with(base.join("attachments")));
        assert_eq!(traversal_dir, base.join("attachments").join("etc"));
    }

    #[test]
    fn test_size_limit_rejection() {
        let oversized = MAX_ATTACHMENT_SIZE + 1;
        assert!(oversized > MAX_ATTACHMENT_SIZE);
    }
}
