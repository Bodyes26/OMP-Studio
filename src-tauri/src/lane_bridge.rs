//! Server HTTP bridge loopback per l'integrazione delle corsie.
//!
//! Espone un endpoint HTTP minimale su `127.0.0.1:<port>` riservato ai processi
//! figli (tool omp ed estensione `studio_lane_integrate`).
//! L'autenticazione avviene tramite token monouso/per-sessione confrontato
//! in tempo costante.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, OnceLock};
use std::time::{Duration, SystemTime};

use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// Informazioni sul proprietario di un token emesso (sessione agente o PTY).
#[derive(Clone, Debug)]
pub struct BridgeOwner {
    pub owner_kind: String, // "agent" | "terminal"
    pub owner_id: u64,
    pub project_id: Option<String>,
    pub lane_id: Option<String>,
    pub cwd: String,
}

/// Payload dell'evento Tauri emesso verso il frontend quando arriva una richiesta HTTP valida.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LaneBridgeRequestEvent {
    pub request_id: String,
    pub owner_kind: String,
    pub owner_id: u64,
    pub project_id: Option<String>,
    pub caller_lane_id: Option<String>,
    pub cwd: String,
    pub lane_id: Option<String>,
    pub message: String,
}

static BRIDGE_PORT: OnceLock<u16> = OnceLock::new();
static TOKENS: LazyLock<Mutex<HashMap<String, BridgeOwner>>> = LazyLock::new(Default::default);
static PENDING_REQUESTS: LazyLock<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>> =
    LazyLock::new(Default::default);

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);
static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Genera un token crittograficamente resistente di 256 bit in formato esadecimale (64 caratteri).
fn generate_token_256() -> String {
    let mut hasher = Sha256::new();
    for _ in 0..4 {
        let s = RandomState::new();
        let mut h = s.build_hasher();
        h.write_u64(TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed));
        let finish = h.finish();
        hasher.update(&finish.to_le_bytes());
    }
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    hasher.update(&now.as_nanos().to_le_bytes());
    let pid = std::process::id();
    hasher.update(&pid.to_le_bytes());
    let result = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in result {
        use std::fmt::Write;
        let _ = write!(hex, "{:02x}", b);
    }
    hex
}

/// Confronto in tempo costante di due sequenze di byte per mitigare attacchi di temporizzazione.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Cerca il proprietario del token confrontando tutti i token attivi in tempo costante.
fn lookup_token(incoming: &str) -> Option<BridgeOwner> {
    let tokens = TOKENS.lock();
    let incoming_bytes = incoming.as_bytes();
    let mut matched_owner = None;
    for (tok, owner) in tokens.iter() {
        if constant_time_eq(tok.as_bytes(), incoming_bytes) {
            matched_owner = Some(owner.clone());
        }
    }
    matched_owner
}

/// Genera un identificativo univoco per la richiesta di integrazione.
fn generate_request_id() -> String {
    let counter = REQ_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("req_{}_{}", now, counter)
}

/// Emette un nuovo token per una sessione Studio.
/// Restituisce `Some((url, token))` se il listener HTTP e' attivo, altrimenti `None`.
pub fn issue_token(owner: BridgeOwner) -> Option<(String, String)> {
    let port = *BRIDGE_PORT.get()?;
    let token = generate_token_256();
    let url = format!("http://127.0.0.1:{}", port);
    TOKENS.lock().insert(token.clone(), owner);
    Some((url, token))
}

/// Revoca tutti i token appartenenti al proprietario indicato (es. alla chiusura del processo).
pub fn revoke_owner(owner_kind: &str, owner_id: u64) {
    let mut tokens = TOKENS.lock();
    tokens.retain(|_, owner| !(owner.owner_kind == owner_kind && owner.owner_id == owner_id));
}

/// Comando Tauri invocato dal frontend quando l'integrazione e' stata gestita.
/// Risolve il canale oneshot associato alla richiesta HTTP in attesa.
#[tauri::command]
pub async fn lane_bridge_respond(
    request_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    let sender = PENDING_REQUESTS.lock().remove(&request_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(response);
            Ok(())
        }
        None => Err(format!(
            "Richiesta bridge '{}' non trovata o gia' scaduta",
            request_id
        )),
    }
}

/// Invia una risposta HTTP/1.1 con Content-Type: application/json e Connection: close.
async fn send_response(
    stream: &mut TcpStream,
    status_code: u16,
    reason: &str,
    body: &serde_json::Value,
) -> Result<(), std::io::Error> {
    let body_bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status_code,
        reason,
        body_bytes.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(&body_bytes).await?;
    stream.flush().await?;
    Ok(())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Rifiuto HTTP: codice, frase di stato e testo per il tool.
type Rejection = (u16, &'static str, String);

fn rejection(code: u16, reason: &'static str, text: impl Into<String>) -> Rejection {
    (code, reason, text.into())
}

/// Richiesta autenticata e gia' validata.
struct BridgeRequest {
    owner: BridgeOwner,
    lane_id: Option<String>,
    message: String,
}

/// Legge header e corpo di una sola richiesta. Il timeout copre l'intera
/// lettura: un client lento dopo gli header non tiene aperta la connessione.
async fn read_request(stream: &mut TcpStream) -> Result<BridgeRequest, Rejection> {
    const HEADER_LIMIT: usize = 16 * 1024;
    const BODY_LIMIT: usize = 64 * 1024;

    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(position) = find_subslice(&buffer, b"\r\n\r\n") {
            break position;
        }
        if buffer.len() > HEADER_LIMIT {
            return Err(rejection(
                431,
                "Request Header Fields Too Large",
                "Header HTTP oltre 16 KiB",
            ));
        }
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| rejection(400, "Bad Request", error.to_string()))?;
        if read == 0 {
            return Err(rejection(400, "Bad Request", "Richiesta HTTP incompleta"));
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| rejection(400, "Bad Request", "Header HTTP non UTF-8"))?;
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split_whitespace();
    let (method, path) = (
        request_line.next().unwrap_or_default(),
        request_line.next().unwrap_or_default(),
    );
    if path != "/v1/lane/integrate" {
        return Err(rejection(
            404,
            "Not Found",
            format!("Percorso '{path}' non trovato"),
        ));
    }
    if method != "POST" {
        return Err(rejection(405, "Method Not Allowed", "Usare POST"));
    }

    let mut content_length = None;
    let mut token = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name.trim().eq_ignore_ascii_case("content-length") {
            content_length = value.parse::<usize>().ok();
        } else if name.trim().eq_ignore_ascii_case("authorization") {
            token = value
                .split_once(' ')
                .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
                .map(|(_, credential)| credential.trim().to_string());
        }
    }
    let owner = token.as_deref().and_then(lookup_token).ok_or_else(|| {
        rejection(
            401,
            "Unauthorized",
            "Token del bridge assente, non valido o revocato",
        )
    })?;
    let length = content_length
        .ok_or_else(|| rejection(411, "Length Required", "Header Content-Length obbligatorio"))?;
    if length > BODY_LIMIT {
        return Err(rejection(413, "Payload Too Large", "Corpo oltre 64 KiB"));
    }

    let mut body = buffer.split_off(header_end + 4);
    while body.len() < length {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| rejection(400, "Bad Request", error.to_string()))?;
        if read == 0 {
            return Err(rejection(
                400,
                "Bad Request",
                "Corpo piu' corto di Content-Length",
            ));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    let json: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| rejection(400, "Bad Request", "Il corpo non e' JSON valido"))?;
    let message = json
        .get("message")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| rejection(400, "Bad Request", "Campo 'message' obbligatorio"))?
        .to_string();
    let lane_id = json
        .get("laneId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(BridgeRequest {
        owner,
        lane_id,
        message,
    })
}

/// Gestisce una singola connessione HTTP.
async fn handle_connection(mut stream: TcpStream, app: AppHandle) -> Result<(), std::io::Error> {
    let request = match tokio::time::timeout(Duration::from_secs(10), read_request(&mut stream))
        .await
    {
        Ok(Ok(request)) => request,
        Ok(Err((code, reason, text))) => {
            return send_response(
                &mut stream,
                code,
                reason,
                &serde_json::json!({ "ok": false, "text": text }),
            )
            .await;
        }
        Err(_) => {
            let body =
                serde_json::json!({ "ok": false, "text": "Timeout nella lettura della richiesta" });
            return send_response(&mut stream, 408, "Request Timeout", &body).await;
        }
    };

    let request_id = generate_request_id();
    let (tx, rx) = oneshot::channel::<serde_json::Value>();
    PENDING_REQUESTS.lock().insert(request_id.clone(), tx);

    let event_payload = LaneBridgeRequestEvent {
        request_id: request_id.clone(),
        owner_kind: request.owner.owner_kind,
        owner_id: request.owner.owner_id,
        project_id: request.owner.project_id,
        caller_lane_id: request.owner.lane_id,
        cwd: request.owner.cwd,
        lane_id: request.lane_id,
        message: request.message,
    };
    if let Err(error) = app.emit("lane-bridge://request", &event_payload) {
        PENDING_REQUESTS.lock().remove(&request_id);
        let body = serde_json::json!({ "ok": false, "text": format!("Studio non ha ricevuto la richiesta: {error}") });
        return send_response(&mut stream, 500, "Internal Server Error", &body).await;
    }

    // Il frontend risponde sempre con `lane_bridge_respond`; il timeout copre
    // solo una finestra ricaricata o bloccata.
    let outcome = tokio::time::timeout(Duration::from_secs(180), rx).await;
    PENDING_REQUESTS.lock().remove(&request_id);
    match outcome {
        Ok(Ok(value)) => send_response(&mut stream, 200, "OK", &value).await,
        Ok(Err(_)) => {
            let body = serde_json::json!({ "ok": false, "text": "Studio ha chiuso la richiesta senza esito" });
            send_response(&mut stream, 500, "Internal Server Error", &body).await
        }
        Err(_) => {
            let body =
                serde_json::json!({ "ok": false, "text": "Studio non ha risposto in tempo" });
            send_response(&mut stream, 504, "Gateway Timeout", &body).await
        }
    }
}

/// Avvia il server bridge HTTP loopback su 127.0.0.1:0 in un task asincrono dedicato.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[LaneBridge] Impossibile avviare listener TCP su 127.0.0.1:0: {}",
                    e
                );
                return;
            }
        };

        let port = match listener.local_addr() {
            Ok(addr) => addr.port(),
            Err(e) => {
                eprintln!("[LaneBridge] Impossibile determinare porta locale: {}", e);
                return;
            }
        };

        let _ = BRIDGE_PORT.set(port);
        println!("[LaneBridge] Server HTTP avviato su 127.0.0.1:{}", port);

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app_clone = app.clone();
                    tokio::spawn(async move {
                        let _ = handle_connection(stream, app_clone).await;
                    });
                }
                Err(e) => {
                    eprintln!("[LaneBridge] Errore accept listener: {}", e);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scrive `raw` su una connessione loopback reale e legge la richiesta
    /// dal lato server con lo stesso parser del bridge.
    async fn parse(raw: String) -> Result<BridgeRequest, Rejection> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(raw.as_bytes()).await.unwrap();
            stream
        });
        let (mut server, _) = listener.accept().await.unwrap();
        let _client = client.await.unwrap();
        read_request(&mut server).await
    }

    fn request(token: &str, body: &str) -> String {
        format!(
            "POST /v1/lane/integrate HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn owner(owner_id: u64) -> BridgeOwner {
        BridgeOwner {
            owner_kind: "agent".to_string(),
            owner_id,
            project_id: Some("progetto".to_string()),
            lane_id: Some("wt1".to_string()),
            cwd: "C:/repo".to_string(),
        }
    }

    #[tokio::test]
    async fn token_valido_restituisce_proprietario_e_corsia() {
        let token = generate_token_256();
        TOKENS.lock().insert(token.clone(), owner(9101));
        let parsed = parse(request(
            &token,
            r#"{"laneId":"wt2","message":"Preavviso 6 mesi"}"#,
        ))
        .await
        .unwrap_or_else(|(code, _, text)| panic!("{code}: {text}"));
        assert_eq!(parsed.owner.owner_id, 9101);
        assert_eq!(parsed.lane_id.as_deref(), Some("wt2"));
        assert_eq!(parsed.message, "Preavviso 6 mesi");
        revoke_owner("agent", 9101);
    }

    #[tokio::test]
    async fn token_revocato_o_ignoto_viene_rifiutato() {
        let token = generate_token_256();
        TOKENS.lock().insert(token.clone(), owner(9102));
        revoke_owner("agent", 9102);
        let revoked = parse(request(&token, r#"{"message":"x"}"#)).await;
        assert_eq!(revoked.err().map(|(code, _, _)| code), Some(401));
        let unknown = parse(request("0000", r#"{"message":"x"}"#)).await;
        assert_eq!(unknown.err().map(|(code, _, _)| code), Some(401));
    }

    #[tokio::test]
    async fn messaggio_vuoto_e_percorso_sbagliato_vengono_rifiutati() {
        let token = generate_token_256();
        TOKENS.lock().insert(token.clone(), owner(9103));
        let empty = parse(request(&token, r#"{"message":"  "}"#)).await;
        assert_eq!(empty.err().map(|(code, _, _)| code), Some(400));
        let wrong = parse(request(&token, "{}").replace("/v1/lane/integrate", "/v1/altro")).await;
        assert_eq!(wrong.err().map(|(code, _, _)| code), Some(404));
        revoke_owner("agent", 9103);
    }
}
