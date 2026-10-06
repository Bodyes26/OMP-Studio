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
//!
//! I byte arrivano con l'IPC grezzo di Tauri 2 (corpo binario, metadati negli
//! header): un array JSON di numeri costava circa quattro byte per byte e
//! teneva in memoria tre copie del file.
//!
//! Le immagini trascinate dal sistema operativo non si copiano: si leggono dal
//! loro percorso (`chat_attachment_read_image`) solo per l'anteprima, entro 5 MB.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Limite massimo di dimensione per un allegato: 50 MiB.
pub const MAX_ATTACHMENT_SIZE: usize = 50 * 1024 * 1024;

/// Limite delle immagini trascinate lette per l'anteprima: 5 MiB.
pub const MAX_DROPPED_IMAGE_SIZE: u64 = 5 * 1024 * 1024;

/// Header dell'IPC grezzo di `stage_chat_attachment` (valori percent-encoded:
/// un header HTTP non porta caratteri non ASCII, i nomi dei file si').
const HEADER_SESSION_KEY: &str = "x-omp-session-key";
const HEADER_FILE_NAME: &str = "x-omp-file-name";

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
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanifica la chiave di sessione per l'uso come nome di directory.
pub fn sanitize_session_key(session_key: &str) -> String {
    let sanitized: String = session_key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
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
    // Normalizza i separatori di percorso per supportare percorsi Windows anche su POSIX (Linux/macOS)
    let normalized = name.replace('\\', "/");
    let base_raw = Path::new(&normalized)
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
        Some(dot_idx) if dot_idx > 0 => (&cleaned[..dot_idx], Some(&cleaned[dot_idx..])),
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
pub fn resolve_session_attachments_dir(
    data_dir: &Path,
    session_key: &str,
) -> Result<PathBuf, String> {
    let attachments_root = data_dir.join("attachments");
    let safe_key = sanitize_session_key(session_key);
    let session_dir = attachments_root.join(safe_key);

    // Verifica di confinamento: nessun componente genitore `..` o radice deve uscire
    for comp in session_dir
        .strip_prefix(data_dir)
        .map_err(|e| e.to_string())?
        .components()
    {
        if matches!(
            comp,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err("Tentativo di path traversal nella chiave di sessione".to_string());
        }
    }

    Ok(session_dir)
}

/// Decodifica un valore percent-encoded (`encodeURIComponent` lato web).
pub fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| "Sequenza percent-encoding non valida".to_string())?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Valore dell'header non e' UTF-8 valido".to_string())
}

fn header_value(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Header {name} mancante"))?
        .to_str()
        .map_err(|_| format!("Header {name} non valido"))?;
    percent_decode(raw)
}

/// Scrive i byte nella cartella della sessione con il prefisso numerico `<n>-`.
pub fn stage_into_dir(
    session_dir: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<StagedAttachment, String> {
    if bytes.len() > MAX_ATTACHMENT_SIZE {
        return Err(format!(
            "Dimensione file eccede il limite consentito di {} MiB",
            MAX_ATTACHMENT_SIZE / (1024 * 1024)
        ));
    }
    fs::create_dir_all(session_dir)
        .map_err(|e| format!("Impossibile creare cartella allegati: {e}"))?;

    // Determina il prefisso numerico sequenziale <n>-
    let count = match fs::read_dir(session_dir) {
        Ok(entries) => entries.filter_map(Result::ok).count() + 1,
        Err(_) => 1,
    };

    let safe_name = sanitize_attachment_filename(file_name);
    let prefixed_name = format!("{count}-{safe_name}");
    let target_path = session_dir.join(&prefixed_name);

    // Verifica confinamento finale
    if target_path.parent() != Some(session_dir) {
        return Err("Tentativo di path traversal nel nome dell'allegato".to_string());
    }

    fs::write(&target_path, bytes)
        .map_err(|e| format!("Impossibile scrivere il file allegato: {e}"))?;

    Ok(StagedAttachment {
        path: target_path.to_string_lossy().to_string(),
        name: safe_name,
        size: bytes.len() as u64,
    })
}

/// Salva un allegato nella cartella locale della sessione e restituisce il percorso assoluto.
///
/// Corpo: i byte grezzi del file. Header: `x-omp-session-key` e
/// `x-omp-file-name`, percent-encoded.
#[tauri::command]
pub async fn stage_chat_attachment(
    app: AppHandle,
    request: Request<'_>,
) -> Result<StagedAttachment, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Corpo dell'allegato atteso in forma binaria".to_string());
    };
    let session_key = header_value(&request, HEADER_SESSION_KEY)?;
    let file_name = header_value(&request, HEADER_FILE_NAME)?;

    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Impossibile risolvere cartella dati app: {e}"))?;

    let session_dir = resolve_session_attachments_dir(&data_dir, &session_key)?;
    stage_into_dir(&session_dir, &file_name, bytes)
}

/// Immagine letta da disco per l'anteprima di un file trascinato.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DroppedImage {
    pub mime_type: String,
    pub base64: String,
    pub size: u64,
}

/// Errore con codice stabile: il frontend distingue «troppo grande» e «non
/// immagine» (resta solo la menzione, senza avvisi) da un errore di lettura.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReadImageError {
    pub code: &'static str,
    pub message: String,
}

impl ReadImageError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Tipo dell'immagine dai primi byte: l'estensione puo' mentire, e un file
/// qualsiasi rinominato `.png` non deve arrivare al modello come immagine.
pub fn image_mime_from_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Legge un'immagine (PNG, JPEG, GIF, WebP) di al massimo `max` byte.
pub fn read_image_file(path: &Path, max: u64) -> Result<DroppedImage, ReadImageError> {
    let meta = fs::metadata(path).map_err(|e| ReadImageError::new("io", e.to_string()))?;
    if !meta.is_file() {
        return Err(ReadImageError::new(
            "not_image",
            "Il percorso non e' un file",
        ));
    }
    if meta.len() > max {
        return Err(ReadImageError::new(
            "too_large",
            format!("Immagine oltre il limite di {} MiB", max / (1024 * 1024)),
        ));
    }
    // `take` difende dal file che cresce tra metadata e lettura.
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    fs::File::open(path)
        .and_then(|file| file.take(max + 1).read_to_end(&mut bytes))
        .map_err(|e| ReadImageError::new("io", e.to_string()))?;
    if bytes.len() as u64 > max {
        return Err(ReadImageError::new(
            "too_large",
            format!("Immagine oltre il limite di {} MiB", max / (1024 * 1024)),
        ));
    }
    let mime = image_mime_from_magic(&bytes).ok_or_else(|| {
        ReadImageError::new(
            "not_image",
            "Il file non e' un'immagine PNG, JPEG, GIF o WebP",
        )
    })?;
    Ok(DroppedImage {
        mime_type: mime.to_string(),
        size: bytes.len() as u64,
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// Legge un'immagine trascinata dal sistema operativo per allegarla come
/// anteprima. Nessuna copia: il file resta dov'e' e il messaggio lo cita per
/// percorso.
#[tauri::command]
pub async fn chat_attachment_read_image(path: String) -> Result<DroppedImage, ReadImageError> {
    tokio::task::spawn_blocking(move || read_image_file(Path::new(&path), MAX_DROPPED_IMAGE_SIZE))
        .await
        .map_err(|e| ReadImageError::new("io", e.to_string()))?
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
        assert_eq!(
            sanitize_attachment_filename("..\\..\\windows\\system32\\calc.exe"),
            "calc.exe"
        );
        assert_eq!(
            sanitize_attachment_filename("folder/subfolder/file.pdf"),
            "file.pdf"
        );
    }

    #[test]
    fn test_sanitize_filename_invalid_chars() {
        assert_eq!(
            sanitize_attachment_filename("report:2026*final?.pdf"),
            "report_2026_final_.pdf"
        );
        assert_eq!(
            sanitize_attachment_filename("<script>alert.js"),
            "_script_alert.js"
        );
        assert_eq!(
            sanitize_attachment_filename("  test file .txt  "),
            "test file .txt"
        );
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
        assert_eq!(
            sanitize_session_key("valid-session_123"),
            "valid-session_123"
        );
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
        let dir = scratch_dir("stage-limit");
        let oversized = vec![0u8; MAX_ATTACHMENT_SIZE + 1];
        assert!(stage_into_dir(&dir, "big.bin", &oversized).is_err());
        assert!(!dir.exists() || fs::read_dir(&dir).unwrap().next().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "omp-chat-attachments-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn test_stage_into_dir_writes_bytes_with_prefix() {
        let dir = scratch_dir("stage");
        let staged = stage_into_dir(&dir, "../nota è.txt", b"ciao").unwrap();
        assert_eq!(staged.name, "nota è.txt");
        assert_eq!(staged.size, 4);
        assert!(staged.path.ends_with("1-nota è.txt"));
        assert_eq!(fs::read(&staged.path).unwrap(), b"ciao");
        let second = stage_into_dir(&dir, "b.bin", &[1, 2]).unwrap();
        assert!(second.path.ends_with("2-b.bin"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_percent_decode() {
        assert_eq!(percent_decode("nota%20%C3%A8.txt").unwrap(), "nota è.txt");
        assert_eq!(
            percent_decode("lane%3Aproj%3Amain").unwrap(),
            "lane:proj:main"
        );
        assert_eq!(percent_decode("semplice").unwrap(), "semplice");
        assert!(percent_decode("rotto%2").is_err());
        assert!(percent_decode("%FF").is_err());
    }

    #[test]
    fn test_image_magic_bytes() {
        assert_eq!(
            image_mime_from_magic(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("image/png")
        );
        assert_eq!(
            image_mime_from_magic(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(image_mime_from_magic(b"GIF89a...."), Some("image/gif"));
        assert_eq!(
            image_mime_from_magic(b"RIFF\x10\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(image_mime_from_magic(b"%PDF-1.7"), None);
        assert_eq!(image_mime_from_magic(b""), None);
    }

    #[test]
    fn test_read_image_file_limits_and_type() {
        let dir = scratch_dir("read");
        fs::create_dir_all(&dir).unwrap();
        let png: Vec<u8> = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
            .into_iter()
            .chain(std::iter::repeat_n(7u8, 32))
            .collect();
        let png_path = dir.join("a.png");
        fs::write(&png_path, &png).unwrap();
        let ok = read_image_file(&png_path, 1024).unwrap();
        assert_eq!(ok.mime_type, "image/png");
        assert_eq!(ok.size, png.len() as u64);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(ok.base64)
                .unwrap(),
            png
        );

        assert_eq!(
            read_image_file(&png_path, 16).unwrap_err().code,
            "too_large"
        );

        let fake = dir.join("finta.png");
        fs::write(&fake, b"non sono un'immagine").unwrap();
        assert_eq!(read_image_file(&fake, 1024).unwrap_err().code, "not_image");

        assert_eq!(read_image_file(&dir, 1024).unwrap_err().code, "not_image");
        assert_eq!(
            read_image_file(&dir.join("manca.png"), 1024)
                .unwrap_err()
                .code,
            "io"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
