//! S40 — Browser Live: stream binario loopback e backpressure per Browser Studio.
//!
//! Questo modulo gestisce il canale live autenticato lato backend Studio:
//! - Connessione WebSocket strettamente su loopback (`127.0.0.1`, `localhost`, `[::1]`);
//! - Riscatto del ticket monouso con token segreto;
//! - Decodifica dei frame binari ad alta frequenza nel formato BLF1;
//! - Gestione backpressure lato client con invio deterministico degli ack;
//! - Inoltro dei frame e degli stati della tab a Svelte tramite `tauri::ipc::Channel`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

pub const BLF1_MAGIC: &[u8; 4] = b"BLF1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionIdentity {
    pub project_id: String,
    pub chat_session_id: String,
    pub browser_session_id: String,
    pub tab_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrameMeta {
    pub sequence: u64,
    pub browser_session_id: String,
    pub tab_id: String,
    pub timestamp_ms: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub device_scale_factor: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub control_epoch: u64,
    pub privacy: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserLiveEvent {
    #[serde(rename = "connecting")]
    Connecting,
    #[serde(rename = "connected")]
    Connected {
        identity: BrowserSessionIdentity,
        state: serde_json::Value,
    },
    #[serde(rename = "frame")]
    Frame {
        meta: BrowserFrameMeta,
        image_base64: String,
    },
    #[serde(rename = "tab_state")]
    TabState { state: serde_json::Value },
    #[serde(rename = "closed")]
    Closed {
        identity: BrowserSessionIdentity,
        reason: String,
    },
    #[serde(rename = "error")]
    Error { code: String, message: String },
    #[serde(rename = "inspected_element")]
    InspectedElement { element: serde_json::Value },
    #[serde(rename = "console_entry")]
    ConsoleEntry { entry: serde_json::Value },
    #[serde(rename = "network_entry")]
    NetworkEntry { entry: serde_json::Value },
    #[serde(rename = "network_body_response")]
    NetworkBodyResponse {
        request_id: String,
        body: Option<String>,
        error: Option<String>,
    },
    #[serde(rename = "action_entry")]
    ActionEntry { entry: serde_json::Value },
    #[serde(rename = "dialog_state")]
    DialogState { dialog: serde_json::Value },
    #[serde(rename = "download_state")]
    DownloadState { download: serde_json::Value },
    #[serde(rename = "file_chooser_state")]
    FileChooserState { chooser: serde_json::Value },
    #[serde(rename = "capability_state")]
    CapabilityState { capability: serde_json::Value },
    #[serde(rename = "recording_state")]
    RecordingState { recording: serde_json::Value },
    #[serde(rename = "disconnected")]
    Disconnected,
}

/// Decodifica un messaggio binario WebSocket nel formato BLF1.
pub fn decode_binary_frame(data: &[u8]) -> Option<(BrowserFrameMeta, Vec<u8>)> {
    if data.len() < 8 {
        return None;
    }
    if &data[0..4] != BLF1_MAGIC {
        return None;
    }
    let meta_len = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;
    if 8 + meta_len > data.len() {
        return None;
    }
    let meta_bytes = &data[8..8 + meta_len];
    let meta: BrowserFrameMeta = serde_json::from_slice(meta_bytes).ok()?;
    let image_bytes = data[8 + meta_len..].to_vec();
    Some((meta, image_bytes))
}

/// Codifica un messaggio binario nel formato BLF1.
pub fn encode_binary_frame(meta: &BrowserFrameMeta, image: &[u8]) -> Option<Vec<u8>> {
    let meta_bytes = serde_json::to_vec(meta).ok()?;
    let meta_len = meta_bytes.len() as u32;
    let total_len = 8 + meta_bytes.len() + image.len();
    let mut out = Vec::with_capacity(total_len);
    out.extend_from_slice(BLF1_MAGIC);
    out.extend_from_slice(&meta_len.to_be_bytes());
    out.extend_from_slice(&meta_bytes);
    out.extend_from_slice(image);
    Some(out)
}

/// Valida che l'endpoint sia strettamente un WebSocket non cifrato su loopback.
pub fn is_loopback_endpoint(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    if url.scheme() != "ws" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    host == "127.0.0.1" || host == "localhost" || host == "[::1]" || host == "::1"
}

/// Rimuove credenziali da un URL (user:pass@ -> [REDACTED]@)
pub fn redact_url_credentials(url_str: &str) -> String {
    if !url_str.contains('@') || !url_str.contains("://") {
        return url_str.to_string();
    }
    if let Ok(mut parsed) = reqwest::Url::parse(url_str) {
        if !parsed.username().is_empty() || parsed.password().is_some() {
            let _ = parsed.set_username("[REDACTED]");
            let _ = parsed.set_password(None);
            return parsed.to_string().replace("%5BREDACTED%5D@", "[REDACTED]@");
        }
    }
    if let Some(idx_proto) = url_str.find("://") {
        let after_proto = &url_str[idx_proto + 3..];
        if let Some(idx_at) = after_proto.find('@') {
            return format!(
                "{}://[REDACTED]@{}",
                &url_str[..idx_proto],
                &after_proto[idx_at + 1..]
            );
        }
    }
    url_str.to_string()
}

/// Maschera token, password e authorization headers in stringhe arbitrarie.
///
/// La ricerca di `bearer ` e' case-insensitive ASCII e lavora sugli stessi byte
/// che vengono affettati: calcolare l'indice su `to_lowercase()` lo disallinea
/// per i caratteri la cui minuscola cambia lunghezza (`U+0130` -> `i` + `U+0307`)
/// e qui il testo arriva dalla pagina remota (dialoghi, console, rete), quindi
/// un `alert()` costruito ad arte diventerebbe un panic e - con `panic = "abort"`
/// nel profilo release - la terminazione dell'intero processo Studio.
pub fn redact_sensitive_string(text: &str) -> String {
    const NEEDLE: &[u8] = b"bearer ";
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while cursor < bytes.len() {
        let Some(offset) = bytes[cursor..]
            .windows(NEEDLE.len())
            .position(|window| window.eq_ignore_ascii_case(NEEDLE))
        else {
            break;
        };
        // I sette byte riconosciuti sono ASCII: nessun byte di continuazione
        // UTF-8 puo' valere come lettera ASCII, quindi gli estremi calcolati
        // cadono sempre su un confine di carattere.
        let prefix_end = cursor + offset + NEEDLE.len();
        let token_end = text[prefix_end..]
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .map_or(text.len(), |idx| prefix_end + idx);

        out.push_str(&text[cursor..prefix_end]);
        if token_end > prefix_end {
            out.push_str("[REDACTED]");
        }
        cursor = token_end;
    }

    out.push_str(&text[cursor..]);
    redact_url_credentials(&out)
}

/// Sanitizza il JSON dello stato tab rimuovendo credenziali dagli URL
pub fn sanitize_tab_state(state: &mut serde_json::Value) {
    if let Some(obj) = state.as_object_mut() {
        if let Some(url_val) = obj.get_mut("url") {
            if let Some(url_str) = url_val.as_str() {
                *url_val = serde_json::Value::String(redact_url_credentials(url_str));
            }
        }
    }
}

const SENSITIVE_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization",
    "sec-websocket-key",
    "x-auth-token",
];

/// Sanitizza il JSON di un log console mascherando segreti, token e credenziali
pub fn sanitize_console_entry(entry: &mut serde_json::Value) {
    if let Some(obj) = entry.as_object_mut() {
        if let Some(text_val) = obj.get_mut("text") {
            if let Some(text_str) = text_val.as_str() {
                *text_val = serde_json::Value::String(redact_sensitive_string(text_str));
            }
        }
        if let Some(url_val) = obj.get_mut("url") {
            if let Some(url_str) = url_val.as_str() {
                *url_val = serde_json::Value::String(redact_url_credentials(url_str));
            }
        }
        if let Some(stack_val) = obj.get_mut("stackTrace") {
            if let Some(stack_str) = stack_val.as_str() {
                *stack_val = serde_json::Value::String(redact_sensitive_string(stack_str));
            }
        }
    }
}

/// Sanitizza il JSON di una richiesta/risposta di rete mascherando URL, header e secret
pub fn sanitize_network_entry(entry: &mut serde_json::Value) {
    if let Some(obj) = entry.as_object_mut() {
        if let Some(url_val) = obj.get_mut("url") {
            if let Some(url_str) = url_val.as_str() {
                *url_val = serde_json::Value::String(redact_url_credentials(url_str));
            }
        }
        if let Some(headers_val) = obj.get_mut("headers") {
            if let Some(headers_obj) = headers_val.as_object_mut() {
                for (key, val) in headers_obj.iter_mut() {
                    let lower_key = key.to_lowercase();
                    if SENSITIVE_HEADERS.contains(&lower_key.as_str()) {
                        *val = serde_json::Value::String("[REDACTED]".to_string());
                    }
                }
            }
        }
        if let Some(err_val) = obj.get_mut("errorText") {
            if let Some(err_str) = err_val.as_str() {
                *err_val = serde_json::Value::String(redact_sensitive_string(err_str));
            }
        }
        if let Some(body_val) = obj.get_mut("body") {
            if let Some(body_str) = body_val.as_str() {
                *body_val = serde_json::Value::String(redact_sensitive_string(body_str));
            }
        }
    }
}

/// Sanitizza il JSON di una voce timeline azioni
pub fn sanitize_action_entry(entry: &mut serde_json::Value) {
    if let Some(obj) = entry.as_object_mut() {
        if let Some(label_val) = obj.get_mut("label") {
            if let Some(label_str) = label_val.as_str() {
                *label_val = serde_json::Value::String(redact_sensitive_string(label_str));
            }
        }
        if let Some(det_val) = obj.get_mut("details") {
            if let Some(det_str) = det_val.as_str() {
                *det_val = serde_json::Value::String(redact_sensitive_string(det_str));
            }
        }
    }
}

/// Sanitizza il JSON di un elemento ispezionato
pub fn sanitize_inspected_element(element: &mut serde_json::Value) {
    if let Some(obj) = element.as_object_mut() {
        if let Some(text_val) = obj.get_mut("text") {
            if let Some(text_str) = text_val.as_str() {
                *text_val = serde_json::Value::String(redact_sensitive_string(text_str));
            }
        }
        if let Some(acc_val) = obj.get_mut("accessibleName") {
            if let Some(acc_str) = acc_val.as_str() {
                *acc_val = serde_json::Value::String(redact_sensitive_string(acc_str));
            }
        }
    }
}

/// Applica una redazione a ogni campo testuale indicato di un oggetto JSON.
fn redact_fields(value: &mut serde_json::Value, fields: &[&str], strip_credentials: bool) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    for field in fields {
        let Some(field_val) = obj.get_mut(*field) else {
            continue;
        };
        let Some(text) = field_val.as_str() else {
            continue;
        };
        let cleaned = if strip_credentials {
            redact_sensitive_string(&redact_url_credentials(text))
        } else {
            redact_sensitive_string(text)
        };
        *field_val = serde_json::Value::String(cleaned);
    }
}

/// Sanitizza lo stato di un dialogo JS: il testo lo controlla la pagina.
pub fn sanitize_dialog_state(dialog: &mut serde_json::Value) {
    redact_fields(dialog, &["url"], true);
    redact_fields(
        dialog,
        &["message", "defaultPrompt", "promptText", "error"],
        false,
    );
}

/// Sanitizza lo stato di un download: URL e nome file arrivano dalla pagina.
pub fn sanitize_download_state(download: &mut serde_json::Value) {
    redact_fields(download, &["url", "origin"], true);
    redact_fields(download, &["suggestedFilename", "error"], false);
}

/// Sanitizza lo stato di un selettore file: restano solo i nomi base.
pub fn sanitize_file_chooser_state(chooser: &mut serde_json::Value) {
    redact_fields(chooser, &["error"], false);
}

/// Sanitizza lo stato di una capability: l'origine arriva dalla pagina.
pub fn sanitize_capability_state(capability: &mut serde_json::Value) {
    redact_fields(capability, &["origin"], true);
    redact_fields(capability, &["error"], false);
}

/// Sanitizza lo stato di una registrazione locale.
pub fn sanitize_recording_state(recording: &mut serde_json::Value) {
    redact_fields(recording, &["error"], false);
}

/// Distingue gli errori che invalidano il canale da quelli della singola azione.
///
/// Un `DIALOG_ALREADY_SETTLED` o un `DOWNLOAD_NOT_ALLOWED` riguardano il comando
/// appena inviato: chiudere il loop su questi codici abbatterebbe lo stream e
/// costringerebbe a un giro completo di riconnessione con ticket nuovo.
pub fn is_fatal_error_code(code: &str) -> bool {
    matches!(
        code,
        "BROWSER_LIVE_UNAVAILABLE"
            | "BROWSER_LIVE_NOT_NEGOTIATED"
            | "TICKET_INVALID"
            | "TICKET_EXPIRED"
            | "TICKET_ALREADY_REDEEMED"
            | "TICKET_IDENTITY_MISMATCH"
            | "ENDPOINT_NOT_LOOPBACK"
            | "SESSION_NOT_FOUND"
            | "TAB_NOT_FOUND"
            | "RELAY_REVOKED"
            | "STREAM_ERROR"
    )
}

struct ActiveSession {
    stop_tx: oneshot::Sender<()>,
    msg_tx: mpsc::Sender<Message>,
}

pub struct BrowserLiveManager {
    sessions: Arc<Mutex<HashMap<u64, ActiveSession>>>,
    next_id: AtomicU64,
}

impl Default for BrowserLiveManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserLiveManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn send_message(&self, session_id: u64, msg: Message) -> Result<(), String> {
        let lock = self.sessions.lock();
        if let Some(session) = lock.get(&session_id) {
            session
                .msg_tx
                .try_send(msg)
                .map_err(|e| format!("Invio messaggio fallito: {}", e))?;
            Ok(())
        } else {
            Err(format!("Sessione live {} non trovata", session_id))
        }
    }
}

/// Connette Studio al canale loopback live della tab specificata usando il ticket monouso.
#[tauri::command]
pub async fn browser_live_connect(
    _app: AppHandle,
    endpoint: String,
    token: String,
    identity: BrowserSessionIdentity,
    on_event: Channel<BrowserLiveEvent>,
    manager: State<'_, BrowserLiveManager>,
) -> Result<u64, String> {
    if !is_loopback_endpoint(&endpoint) {
        return Err(format!("Endpoint non loopback rifiutato: {}", endpoint));
    }

    let session_id = manager.next_id.fetch_add(1, Ordering::SeqCst);
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    let (msg_tx, mut msg_rx) = mpsc::channel::<Message>(128);

    {
        let mut lock = manager.sessions.lock();
        if lock.len() >= 32 {
            return Err("Limite massimo di 32 sessioni live simultanee raggiunto".to_string());
        }
        lock.insert(session_id, ActiveSession { stop_tx, msg_tx });
    }

    let _ = on_event.send(BrowserLiveEvent::Connecting);

    let identity_clone = identity.clone();
    let sessions_map = manager.sessions.clone();

    tokio::spawn(async move {
        let connect_result = connect_async(&endpoint).await;
        let (mut ws_stream, _) = match connect_result {
            Ok(pair) => pair,
            Err(err) => {
                let _ = on_event.send(BrowserLiveEvent::Error {
                    code: "BROWSER_LIVE_UNAVAILABLE".to_string(),
                    message: redact_sensitive_string(&format!(
                        "Connessione WebSocket fallita: {}",
                        err
                    )),
                });
                let _ = on_event.send(BrowserLiveEvent::Disconnected);
                sessions_map.lock().remove(&session_id);
                return;
            }
        };

        // Invia riscatto del ticket monouso
        let redeem_msg = serde_json::json!({
            "type": "redeem",
            "token": token,
            "identity": identity_clone
        });
        if let Err(err) = ws_stream
            .send(Message::Text(redeem_msg.to_string().into()))
            .await
        {
            let _ = on_event.send(BrowserLiveEvent::Error {
                code: "TICKET_INVALID".to_string(),
                message: redact_sensitive_string(&format!("Invio ticket fallito: {}", err)),
            });
            let _ = on_event.send(BrowserLiveEvent::Disconnected);
            sessions_map.lock().remove(&session_id);
            return;
        }

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    let _ = ws_stream.close(None).await;
                    break;
                }
                Some(outbound) = msg_rx.recv() => {
                    if let Err(err) = ws_stream.send(outbound).await {
                        let _ = on_event.send(BrowserLiveEvent::Error {
                            code: "STREAM_ERROR".to_string(),
                            message: redact_sensitive_string(&format!("Errore invio messaggio client: {}", err)),
                        });
                        break;
                    }
                }
                msg_opt = ws_stream.next() => {
                    let Some(msg_res) = msg_opt else {
                        break;
                    };
                    let msg = match msg_res {
                        Ok(m) => m,
                        Err(err) => {
                            let _ = on_event.send(BrowserLiveEvent::Error {
                                code: "STREAM_ERROR".to_string(),
                                message: redact_sensitive_string(&format!("Errore stream WebSocket: {}", err)),
                            });
                            break;
                        }
                    };

                    match msg {
                        Message::Binary(bin) => {
                            if let Some((meta, image_bytes)) = decode_binary_frame(&bin) {
                                let seq = meta.sequence;
                                let image_base64 = base64::engine::general_purpose::STANDARD.encode(&image_bytes);
                                let _ = on_event.send(BrowserLiveEvent::Frame { meta, image_base64 });

                                // Backpressure: invia ack al runtime per segnalare ricezione
                                let ack_msg = serde_json::json!({
                                    "type": "ack",
                                    "sequence": seq
                                });
                                let _ = ws_stream.send(Message::Text(ack_msg.to_string().into())).await;
                            }
                        }
                        Message::Text(text) => {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                if let Some(kind) = val.get("type").and_then(|t| t.as_str()) {
                                    match kind {
                                        "redeemed" => {
                                            let identity_val: BrowserSessionIdentity = val.get("identity")
                                                .and_then(|id| serde_json::from_value(id.clone()).ok())
                                                .unwrap_or_else(|| identity_clone.clone());
                                            let mut state_val = val.get("state").cloned().unwrap_or(serde_json::Value::Null);
                                            sanitize_tab_state(&mut state_val);
                                            let _ = on_event.send(BrowserLiveEvent::Connected {
                                                identity: identity_val,
                                                state: state_val,
                                            });
                                        }
                                        "tab_state" => {
                                            if let Some(mut state) = val.get("state").cloned() {
                                                sanitize_tab_state(&mut state);
                                                let _ = on_event.send(BrowserLiveEvent::TabState { state });
                                            }
                                        }
                                        "closed" => {
                                            let id: BrowserSessionIdentity = val.get("identity")
                                                .and_then(|i| serde_json::from_value(i.clone()).ok())
                                                .unwrap_or_else(|| identity_clone.clone());
                                            let reason = val.get("reason").and_then(|r| r.as_str()).unwrap_or("closed").to_string();
                                            let safe_reason = redact_sensitive_string(&reason);
                                            let _ = on_event.send(BrowserLiveEvent::Closed { identity: id, reason: safe_reason });
                                            break;
                                        }
                                        "error" => {
                                            let code = val.get("code").and_then(|c| c.as_str()).unwrap_or("ERROR").to_string();
                                            let message = val.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
                                            let safe_message = redact_sensitive_string(&message);
                                            let fatal = is_fatal_error_code(&code);
                                            let _ = on_event.send(BrowserLiveEvent::Error { code, message: safe_message });
                                            if fatal {
                                                break;
                                            }
                                        }
                                        "inspected_element" => {
                                            if let Some(mut el) = val.get("element").cloned() {
                                                sanitize_inspected_element(&mut el);
                                                let _ = on_event.send(BrowserLiveEvent::InspectedElement { element: el });
                                            }
                                        }
                                        "console_entry" => {
                                            if let Some(mut entry) = val.get("entry").cloned() {
                                                sanitize_console_entry(&mut entry);
                                                let _ = on_event.send(BrowserLiveEvent::ConsoleEntry { entry });
                                            }
                                        }
                                        "network_entry" => {
                                            if let Some(mut entry) = val.get("entry").cloned() {
                                                sanitize_network_entry(&mut entry);
                                                let _ = on_event.send(BrowserLiveEvent::NetworkEntry { entry });
                                            }
                                        }
                                        "network_body_response" => {
                                            let req_id = val.get("requestId").and_then(|r| r.as_str()).unwrap_or("").to_string();
                                            let body = val.get("body").and_then(|b| b.as_str()).map(redact_sensitive_string);
                                            let error = val.get("error").and_then(|e| e.as_str()).map(redact_sensitive_string);
                                            let _ = on_event.send(BrowserLiveEvent::NetworkBodyResponse {
                                                request_id: req_id,
                                                body,
                                                error,
                                            });
                                        }
                                        "action_entry" => {
                                            if let Some(mut entry) = val.get("entry").cloned() {
                                                sanitize_action_entry(&mut entry);
                                                let _ = on_event.send(BrowserLiveEvent::ActionEntry { entry });
                                            }
                                        }
                                        "dialog_state" => {
                                            if let Some(mut dialog) = val.get("dialog").cloned() {
                                                sanitize_dialog_state(&mut dialog);
                                                let _ = on_event.send(BrowserLiveEvent::DialogState { dialog });
                                            }
                                        }
                                        "download_state" => {
                                            if let Some(mut download) = val.get("download").cloned() {
                                                sanitize_download_state(&mut download);
                                                let _ = on_event.send(BrowserLiveEvent::DownloadState { download });
                                            }
                                        }
                                        "file_chooser_state" => {
                                            if let Some(mut chooser) = val.get("chooser").cloned() {
                                                sanitize_file_chooser_state(&mut chooser);
                                                let _ = on_event.send(BrowserLiveEvent::FileChooserState { chooser });
                                            }
                                        }
                                        "capability_state" => {
                                            if let Some(mut capability) = val.get("capability").cloned() {
                                                sanitize_capability_state(&mut capability);
                                                let _ = on_event.send(BrowserLiveEvent::CapabilityState { capability });
                                            }
                                        }
                                        "recording_state" => {
                                            if let Some(mut recording) = val.get("recording").cloned() {
                                                sanitize_recording_state(&mut recording);
                                                let _ = on_event.send(BrowserLiveEvent::RecordingState { recording });
                                            }
                                        }
                                        "pong" => {}
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Message::Close(_) => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        sessions_map.lock().remove(&session_id);
        let _ = on_event.send(BrowserLiveEvent::Disconnected);
    });

    Ok(session_id)
}

/// Messaggi che possono nascere solo qui nel backend, mai nel webview.
///
/// `authorize_upload` porta percorsi del filesystem: l'unico produttore
/// legittimo e' `browser_live_pick_upload_files`, dopo la scelta dell'utente nel
/// dialogo di sistema. Accettarlo dal webview renderebbe falsa quella garanzia.
const BACKEND_ONLY_MESSAGE_TYPES: &[&str] = &["authorize_upload"];

/// Invia un messaggio di controllo JSON al server live (takeover, input, return_control, set_privacy, etc.).
#[tauri::command]
pub async fn browser_live_send_message(
    session_id: u64,
    message: serde_json::Value,
    manager: State<'_, BrowserLiveManager>,
) -> Result<(), String> {
    if let Some(kind) = message.get("type").and_then(|t| t.as_str()) {
        if BACKEND_ONLY_MESSAGE_TYPES.contains(&kind) {
            return Err(format!(
                "Messaggio '{kind}' consentito solo al selettore file nativo"
            ));
        }
    }
    manager.send_message(session_id, Message::Text(message.to_string().into()))
}

/// Apre il selettore file nativo e autorizza i percorsi scelti per un file input.
///
/// Il webview non puo' fornire percorsi: il messaggio `authorize_upload` nasce
/// qui, dopo che l'utente ha scelto nel dialogo di sistema. E' l'unico punto in
/// cui un percorso del filesystem entra nel canale live, e non esiste alcun
/// comando che conceda accesso generico al filesystem al browser gestito.
#[tauri::command]
pub async fn browser_live_pick_upload_files(
    app: AppHandle,
    session_id: u64,
    chooser_id: String,
    multiple: bool,
    manager: State<'_, BrowserLiveManager>,
) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = oneshot::channel::<Vec<String>>();
    let builder = app.dialog().file().set_title("Scegli i file da caricare");
    if multiple {
        builder.pick_files(move |paths| {
            let chosen = paths
                .unwrap_or_default()
                .into_iter()
                .filter_map(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = tx.send(chosen);
        });
    } else {
        builder.pick_file(move |path| {
            let chosen = path
                .and_then(|p| p.into_path().ok())
                .map(|p| vec![p.to_string_lossy().to_string()])
                .unwrap_or_default();
            let _ = tx.send(chosen);
        });
    }

    let paths = rx
        .await
        .map_err(|_| "Selezione file annullata".to_string())?;
    if paths.is_empty() {
        // Annullamento esplicito: il chooser della pagina va chiuso, non lasciato pendente.
        let cancel = serde_json::json!({ "type": "cancel_file_chooser", "chooserId": chooser_id });
        manager.send_message(session_id, Message::Text(cancel.to_string().into()))?;
        return Ok(0);
    }
    let count = paths.len();
    let authorize = serde_json::json!({
        "type": "authorize_upload",
        "chooserId": chooser_id,
        "paths": paths
    });
    manager.send_message(session_id, Message::Text(authorize.to_string().into()))?;
    Ok(count)
}

/// Disconnette un canale live attivo.
#[tauri::command]
pub async fn browser_live_disconnect(
    session_id: u64,
    manager: State<'_, BrowserLiveManager>,
) -> Result<(), String> {
    if let Some(session) = manager.sessions.lock().remove(&session_id) {
        let _ = session.stop_tx.send(());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loopback_endpoint_validation() {
        assert!(is_loopback_endpoint("ws://127.0.0.1:54321/browser-live"));
        assert!(is_loopback_endpoint("ws://localhost:54321/browser-live"));
        assert!(is_loopback_endpoint("ws://[::1]:54321/browser-live"));

        assert!(!is_loopback_endpoint("wss://127.0.0.1:54321/browser-live"));
        assert!(!is_loopback_endpoint("ws://192.168.1.5:54321/browser-live"));
        assert!(!is_loopback_endpoint("ws://example.com/browser-live"));
        assert!(!is_loopback_endpoint("http://127.0.0.1:54321/browser-live"));
        assert!(!is_loopback_endpoint("invalid"));
    }

    #[test]
    fn test_binary_frame_roundtrip() {
        let meta = BrowserFrameMeta {
            sequence: 1,
            browser_session_id: "managed-proj".to_string(),
            tab_id: "chat-1::main".to_string(),
            timestamp_ms: 1725350000000.0,
            viewport_width: 1280.0,
            viewport_height: 800.0,
            device_scale_factor: 1.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            control_epoch: 0,
            privacy: "normal".to_string(),
            mime_type: "image/jpeg".to_string(),
        };
        let image = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];

        let encoded = encode_binary_frame(&meta, &image).expect("encoding failed");
        assert!(encoded.len() > image.len() + 8);

        let (decoded_meta, decoded_image) = decode_binary_frame(&encoded).expect("decoding failed");
        assert_eq!(decoded_meta, meta);
        assert_eq!(decoded_image, image);
    }

    #[test]
    fn test_binary_frame_corrupt_magic() {
        let data = vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        assert!(decode_binary_frame(&data).is_none());
    }

    #[test]
    fn test_manager_send_message_lifecycle() {
        let manager = BrowserLiveManager::new();
        // Session not found error
        let res = manager.send_message(999, Message::Text("{\"type\":\"ping\"}".into()));
        assert!(res.is_err());

        // Register mock session
        let (stop_tx, _) = oneshot::channel::<()>();
        let (msg_tx, mut msg_rx) = mpsc::channel::<Message>(128);
        manager
            .sessions
            .lock()
            .insert(1, ActiveSession { stop_tx, msg_tx });

        let send_res = manager.send_message(
            1,
            Message::Text("{\"type\":\"takeover\",\"expectedEpoch\":0}".into()),
        );
        assert!(send_res.is_ok());

        let received = msg_rx.try_recv().expect("message should be in channel");
        match received {
            Message::Text(t) => assert!(t.contains("takeover")),
            _ => panic!("Expected text message"),
        }
    }

    #[test]
    fn test_redact_url_credentials() {
        let url = "https://user:SuperSecretPassword@example.com/api?query=1";
        let clean = redact_url_credentials(url);
        assert!(!clean.contains("SuperSecretPassword"));
        assert!(clean.contains("[REDACTED]"));
        assert!(clean.contains("example.com"));
    }

    #[test]
    fn test_redact_sensitive_string() {
        let text = "Failed to fetch: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz from server";
        let clean = redact_sensitive_string(text);
        assert!(!clean.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
        assert!(clean.contains("Bearer [REDACTED]"));
    }

    #[test]
    fn redazione_maschera_tutti_i_token_bearer_della_stringa() {
        let text = "Authorization: Bearer AAA111 poi retry con bearer BBB222 e fine";
        let clean = redact_sensitive_string(text);
        assert!(!clean.contains("AAA111"), "primo token in chiaro: {clean}");
        assert!(!clean.contains("BBB222"), "secondo token in chiaro: {clean}");
        assert!(clean.contains("Bearer [REDACTED]"));
        assert!(clean.contains("bearer [REDACTED]"));
    }

    #[test]
    fn redazione_non_va_in_panic_su_maiuscole_unicode_dalla_pagina() {
        // `alert("\u{0130} Bearer ")`: la minuscola di U+0130 occupa un byte in
        // piu', quindi un indice calcolato sulla stringa minuscola cadrebbe
        // fuori dai limiti di quella originale.
        let mut dialog = serde_json::json!({
            "message": "\u{0130} Bearer ",
            "promptText": "\u{1E9E} bearer segreto",
        });
        sanitize_dialog_state(&mut dialog);
        assert_eq!(dialog["message"], "\u{0130} Bearer ");
        assert_eq!(dialog["promptText"], "\u{1E9E} bearer [REDACTED]");
    }

    #[test]
    fn test_sanitize_console_entry() {
        let mut entry = serde_json::json!({
            "id": "c1",
            "level": "error",
            "text": "Auth error with Bearer secret-token-12345",
            "url": "https://admin:pass123@app.local/bundle.js",
            "stackTrace": "Error: Bearer secret-token-12345\n at https://admin:pass123@app.local/bundle.js:12"
        });
        sanitize_console_entry(&mut entry);
        assert_eq!(entry["text"], "Auth error with Bearer [REDACTED]");
        assert_eq!(entry["url"], "https://[REDACTED]@app.local/bundle.js");
        assert!(entry["stackTrace"]
            .as_str()
            .unwrap()
            .contains("Bearer [REDACTED]"));
        assert!(entry["stackTrace"]
            .as_str()
            .unwrap()
            .contains("[REDACTED]@app.local"));
    }

    #[test]
    fn test_sanitize_network_entry() {
        let mut entry = serde_json::json!({
            "id": "n1",
            "url": "https://user:pass@api.test/v1/auth",
            "headers": {
                "Authorization": "Bearer token123",
                "Cookie": "session=secret",
                "Content-Type": "application/json"
            },
            "errorText": "Connection refused: Bearer errortoken",
            "body": "{\"secret\": \"Bearer bodytoken\"}"
        });
        sanitize_network_entry(&mut entry);
        assert_eq!(entry["url"], "https://[REDACTED]@api.test/v1/auth");
        assert_eq!(entry["headers"]["Authorization"], "[REDACTED]");
        assert_eq!(entry["headers"]["Cookie"], "[REDACTED]");
        assert_eq!(entry["headers"]["Content-Type"], "application/json");
        assert_eq!(entry["errorText"], "Connection refused: Bearer [REDACTED]");
        assert_eq!(entry["body"], "{\"secret\": \"Bearer [REDACTED]\"}");
    }

    #[test]
    fn test_sanitize_inspected_element() {
        let mut el = serde_json::json!({
            "tag": "button",
            "accessibleName": "Login with Bearer secret-token",
            "text": "User token: Bearer user-token"
        });
        sanitize_inspected_element(&mut el);
        assert_eq!(el["accessibleName"], "Login with Bearer [REDACTED]");
        assert_eq!(el["text"], "User token: Bearer [REDACTED]");
    }

    #[test]
    fn errori_per_azione_non_chiudono_il_canale_live() {
        // Il rifiuto di una singola azione non invalida ticket ne' stream.
        for code in [
            "DIALOG_ALREADY_SETTLED",
            "DIALOG_NOT_FOUND",
            "DOWNLOAD_NOT_ALLOWED",
            "UPLOAD_NOT_AUTHORIZED",
            "CONTROL_INTERRUPTED",
            "ORIGIN_NOT_ALLOWED",
            "RECORDING_NOT_ACTIVE",
        ] {
            assert!(
                !is_fatal_error_code(code),
                "{code} non deve chiudere il canale"
            );
        }
        for code in [
            "TICKET_EXPIRED",
            "TICKET_INVALID",
            "SESSION_NOT_FOUND",
            "RELAY_REVOKED",
        ] {
            assert!(is_fatal_error_code(code), "{code} deve chiudere il canale");
        }
    }
}
