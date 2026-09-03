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
use tokio::sync::oneshot;
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
    TabState {
        state: serde_json::Value,
    },
    #[serde(rename = "closed")]
    Closed {
        identity: BrowserSessionIdentity,
        reason: String,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
    },
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

pub struct BrowserLiveManager {
    sessions: Arc<Mutex<HashMap<u64, oneshot::Sender<()>>>>,
    next_id: AtomicU64,
}

impl BrowserLiveManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
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

    {
        manager.sessions.lock().insert(session_id, stop_tx);
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
                    message: format!("Connessione WebSocket fallita: {}", err),
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
        if let Err(err) = ws_stream.send(Message::Text(redeem_msg.to_string().into())).await {
            let _ = on_event.send(BrowserLiveEvent::Error {
                code: "TICKET_INVALID".to_string(),
                message: format!("Invio ticket fallito: {}", err),
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
                msg_opt = ws_stream.next() => {
                    let Some(msg_res) = msg_opt else {
                        break;
                    };
                    let msg = match msg_res {
                        Ok(m) => m,
                        Err(err) => {
                            let _ = on_event.send(BrowserLiveEvent::Error {
                                code: "STREAM_ERROR".to_string(),
                                message: format!("Errore stream WebSocket: {}", err),
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
                                            let state_val = val.get("state").cloned().unwrap_or(serde_json::Value::Null);
                                            let _ = on_event.send(BrowserLiveEvent::Connected {
                                                identity: identity_val,
                                                state: state_val,
                                            });
                                        }
                                        "tab_state" => {
                                            if let Some(state) = val.get("state") {
                                                let _ = on_event.send(BrowserLiveEvent::TabState { state: state.clone() });
                                            }
                                        }
                                        "closed" => {
                                            let id: BrowserSessionIdentity = val.get("identity")
                                                .and_then(|i| serde_json::from_value(i.clone()).ok())
                                                .unwrap_or_else(|| identity_clone.clone());
                                            let reason = val.get("reason").and_then(|r| r.as_str()).unwrap_or("closed").to_string();
                                            let _ = on_event.send(BrowserLiveEvent::Closed { identity: id, reason });
                                            break;
                                        }
                                        "error" => {
                                            let code = val.get("code").and_then(|c| c.as_str()).unwrap_or("ERROR").to_string();
                                            let message = val.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
                                            let _ = on_event.send(BrowserLiveEvent::Error { code, message });
                                            break;
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

/// Disconnette un canale live attivo.
#[tauri::command]
pub async fn browser_live_disconnect(
    session_id: u64,
    manager: State<'_, BrowserLiveManager>,
) -> Result<(), String> {
    if let Some(stop_tx) = manager.sessions.lock().remove(&session_id) {
        let _ = stop_tx.send(());
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
}
