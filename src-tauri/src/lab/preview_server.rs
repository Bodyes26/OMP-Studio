//! Server HTTP loopback per l'anteprima del Laboratorio prototipi.
//!
//! Avvia un listener HTTP minimale su `127.0.0.1:0` in modo lazy alla prima
//! pubblicazione. Serve file in memoria per le rotte:
//! - `/_vendor/<path>` per asset condivisi (vendor React, runtime Tailwind)
//! - `/p/<token>/<path>` per i file del prototipo (`index.html` se path vuoto)
//!
//! Solo richieste GET e HEAD. Path traversal impossibile perche' tutti i file
//! sono mappati in memoria senza toccare il filesystem durante le richieste.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

/// Rappresenta un file servito dal server di anteprima.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabServedFile {
    /// Relativo alla radice pubblicata, sempre con `/` e senza `/` iniziale.
    pub path: String,
    pub content: String,
    pub content_type: String,
}

/// Risposta del comando di pubblicazione dell'anteprima.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabPreviewPublishResponse {
    pub url: String,
}

static PREVIEW_PORT: OnceCell<u16> = OnceCell::const_new();

struct PreviewState {
    /// Asset condivisi serviti su `/_vendor/<path>`
    shared_files: HashMap<String, LabServedFile>,
    /// Mappa chiave -> token per mantenere un URL stabile durante la vita del processo
    key_to_token: HashMap<String, String>,
    /// Mappa inversa token -> chiave
    token_to_key: HashMap<String, String>,
    /// Mappa token -> (path relativo normalizzato -> file servito)
    token_to_files: HashMap<String, HashMap<String, LabServedFile>>,
}

static STATE: LazyLock<Mutex<PreviewState>> = LazyLock::new(|| {
    Mutex::new(PreviewState {
        shared_files: HashMap::new(),
        key_to_token: HashMap::new(),
        token_to_key: HashMap::new(),
        token_to_files: HashMap::new(),
    })
});

static TOKEN_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Genera un token pseudocasuale univoco a 128 bit (32 caratteri esadecimali)
/// per isolare l'origine del prototipo nell'anteprima.
fn generate_token(key: &str) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let r0 = RandomState::new().build_hasher().finish();
    let r1 = RandomState::new().build_hasher().finish();
    let counter = TOKEN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(r0.to_le_bytes());
    hasher.update(r1.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    let hash = hasher.finalize();

    format!("{:x}", hash)[..32].to_string()
}

/// Normalizza i percorsi rimuovendo backslash, spazi e slash iniziali.
fn normalize_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim();
    let stripped = trimmed.trim_start_matches('/');
    stripped.to_string()
}

/// Decodifica percentuali da una stringa URI (es. `%20` -> ` `).
fn url_decode(s: &str) -> String {
    let mut result = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                result.push(b);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| s.to_string())
}

/// Avvia il server HTTP in modo lazy su `127.0.0.1:0` alla prima pubblicazione.
async fn ensure_server_started() -> Result<u16, String> {
    let port = PREVIEW_PORT
        .get_or_try_init(|| async {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Avvio listener server anteprima fallito: {}", e))?;
            let port = listener
                .local_addr()
                .map_err(|e| format!("Risoluzione porta server anteprima fallita: {}", e))?
                .port();
            tokio::spawn(server_loop(listener));
            Ok::<u16, String>(port)
        })
        .await?;
    Ok(*port)
}

/// Loop principale del listener HTTP.
async fn server_loop(listener: TcpListener) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(async move {
                    let _ = handle_connection(stream).await;
                });
            }
            Err(e) => {
                eprintln!("[LabPreviewServer] Errore accept: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Legge linea di richiesta ed header HTTP con limite di sicurezza di 16 KiB.
async fn read_request_line(stream: &mut TcpStream) -> Result<(String, String), ()> {
    const HEADER_LIMIT: usize = 16 * 1024;
    let mut buffer = Vec::with_capacity(2048);
    let mut chunk = [0u8; 1024];

    let header_end = loop {
        if let Some(pos) = find_subslice(&buffer, b"\r\n\r\n") {
            break pos;
        }
        if let Some(pos) = find_subslice(&buffer, b"\n\n") {
            break pos;
        }
        if buffer.len() > HEADER_LIMIT {
            return Err(());
        }
        match stream.read(&mut chunk).await {
            Ok(0) => return Err(()),
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            Err(_) => return Err(()),
        }
    };

    let header_str = String::from_utf8_lossy(&buffer[..header_end]);
    let first_line = header_str.lines().next().unwrap_or("").to_string();
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let uri = parts.next().unwrap_or("").to_string();
    Ok((method, uri))
}

/// Gestisce una singola connessione HTTP.
async fn handle_connection(mut stream: TcpStream) -> Result<(), std::io::Error> {
    let (method, uri) = match read_request_line(&mut stream).await {
        Ok((m, u)) => (m, u),
        Err(_) => return Ok(()),
    };

    let is_head = method == "HEAD";
    if method != "GET" && !is_head {
        return send_405(&mut stream).await;
    }

    // Rimuove parametri di query o frammenti hash
    let raw_path = uri
        .split('?')
        .next()
        .unwrap_or("")
        .split('#')
        .next()
        .unwrap_or("");
    let decoded_path = url_decode(raw_path);

    // Rotta 1: Asset condivisi /_vendor/<path>
    if decoded_path.starts_with("/_vendor/") {
        let subpath = normalize_path(&decoded_path["/_vendor/".len()..]);
        if subpath.is_empty() {
            return send_404(&mut stream, is_head).await;
        }

        let file = {
            let state = STATE.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "Lock state fallito")
            })?;
            state.shared_files.get(&subpath).cloned()
        };

        return match file {
            Some(f) => send_file_response(&mut stream, &f, is_head).await,
            None => send_404(&mut stream, is_head).await,
        };
    }

    // Rotta 2: Anteprima prototipo /p/<token>/<path>
    if decoded_path.starts_with("/p/") {
        let rest = &decoded_path["/p/".len()..];
        let (token, subpath) = match rest.split_once('/') {
            Some((t, s)) => (t, s),
            None => (rest, ""),
        };

        let mut subpath_clean = normalize_path(subpath);
        if subpath_clean.is_empty() {
            subpath_clean = "index.html".to_string();
        }

        let file = {
            let state = STATE.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "Lock state fallito")
            })?;
            state
                .token_to_files
                .get(token)
                .and_then(|files| files.get(&subpath_clean).cloned())
        };

        return match file {
            Some(f) => send_file_response(&mut stream, &f, is_head).await,
            None => send_404(&mut stream, is_head).await,
        };
    }

    // Qualsiasi altra rotta restituisce 404
    send_404(&mut stream, is_head).await
}

/// Invia risposta HTTP 200 OK con gli header di sicurezza obbligatori.
async fn send_file_response(
    stream: &mut TcpStream,
    file: &LabServedFile,
    is_head: bool,
) -> Result<(), std::io::Error> {
    let body_bytes = file.content.as_bytes();

    let content_type = if !file.content_type.is_empty() {
        file.content_type.as_str()
    } else if file.path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if file.path.ends_with(".js") || file.path.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if file.path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if file.path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if file.path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    };

    let is_html = content_type.to_ascii_lowercase().contains("text/html")
        || file.path.ends_with(".html")
        || file.path == "index.html";

    let mut headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n",
        content_type,
        body_bytes.len()
    );

    if is_html {
        headers.push_str(
            "Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self' https://esm.sh; media-src 'self' https: data: blob:; worker-src 'self' blob:\r\n"
        );
    }

    headers.push_str("\r\n");

    stream.write_all(headers.as_bytes()).await?;
    if !is_head {
        stream.write_all(body_bytes).await?;
    }
    stream.flush().await?;
    Ok(())
}

/// Invia risposta 404 Not Found.
async fn send_404(stream: &mut TcpStream, is_head: bool) -> Result<(), std::io::Error> {
    let body = b"Not Found";
    let headers = format!(
        "HTTP/1.1 404 Not Found\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    if !is_head {
        stream.write_all(body).await?;
    }
    stream.flush().await?;
    Ok(())
}

/// Invia risposta 405 Method Not Allowed per metodi diversi da GET e HEAD.
async fn send_405(stream: &mut TcpStream) -> Result<(), std::io::Error> {
    let body = b"Method Not Allowed";
    let headers = format!(
        "HTTP/1.1 405 Method Not Allowed\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Allow: GET, HEAD\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await?;
    Ok(())
}

// --- Comandi Tauri ---

/// Pubblica asset condivisi serviti sotto `/_vendor/<path>`.
#[tauri::command]
pub async fn lab_preview_publish_shared(files: Vec<LabServedFile>) -> Result<(), String> {
    ensure_server_started().await?;
    let mut state = STATE
        .lock()
        .map_err(|e| format!("Lock state anteprima fallito: {}", e))?;
    for file in files {
        let clean_path = normalize_path(&file.path);
        state.shared_files.insert(clean_path, file);
    }
    Ok(())
}

/// Pubblica i file di un'anteprima prototipo associata a `key`.
///
/// Restituisce `{ url }` nella forma `http://127.0.0.1:<porta>/p/<token>/`.
/// Il token e' stabile per la chiave durante la vita del processo.
#[tauri::command]
pub async fn lab_preview_publish(
    key: String,
    files: Vec<LabServedFile>,
) -> Result<LabPreviewPublishResponse, String> {
    let port = ensure_server_started().await?;
    let mut state = STATE
        .lock()
        .map_err(|e| format!("Lock state anteprima fallito: {}", e))?;

    let token = if let Some(existing_token) = state.key_to_token.get(&key) {
        existing_token.clone()
    } else {
        let new_token = generate_token(&key);
        state.key_to_token.insert(key.clone(), new_token.clone());
        state.token_to_key.insert(new_token.clone(), key.clone());
        new_token
    };

    let mut files_map = HashMap::new();
    for file in files {
        let clean_path = normalize_path(&file.path);
        files_map.insert(clean_path, file);
    }
    state.token_to_files.insert(token.clone(), files_map);

    Ok(LabPreviewPublishResponse {
        url: format!("http://127.0.0.1:{}/p/{}/", port, token),
    })
}

/// Rimuove la pubblicazione dell'anteprima per `key`.
#[tauri::command]
pub async fn lab_preview_unpublish(key: String) -> Result<(), String> {
    let mut state = STATE
        .lock()
        .map_err(|e| format!("Lock state anteprima fallito: {}", e))?;
    if let Some(token) = state.key_to_token.remove(&key) {
        state.token_to_key.remove(&token);
        state.token_to_files.remove(&token);
    }
    Ok(())
}
