//! Suite di test per il controllo remoto (Gate R44).
//!
//! Copre:
//! - Validazione e normalizzazione URL;
//! - Calcolo del backoff e intervallo del jitter;
//! - Mappatura dei codici di chiusura WebSocket;
//! - Roundtrip della configurazione e permessi 0600 su Unix;
//! - Serializzazione/deserializzazione JSON dei frame;
//! - Test d'integrazione in-process con server tokio-tungstenite locale (Bearer, hello, ping/pong, command, riconnessione e rinvio snapshot).
#![allow(clippy::result_large_err)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as WsCloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::remote::config::{
    load_or_create_config, save_config, validate_and_normalize_relay_url, RemoteConfig,
};
use crate::remote::connection::{
    attempt_after_session, backoff_base_secs, backoff_delay_ms_with_jitter,
    compute_backoff_delay_ms, map_close_code, run_single_session, start_connection_task,
    stop_connection_task, CloseOutcome, ConnectionContext,
};
use crate::remote::protocol::{
    close_code, HealthResponse, HostFrame, HostInfo, ProtocolId, RelayToHostFrame,
    RemoteCommandEvent, RemoteConnection, RemoteLaneRef, RemoteStatus, FEATURES, PROTOCOL_NAME,
    PROTOCOL_VERSION,
};
use crate::remote::RemoteManager;
#[test]
fn test_url_validation_and_normalization() {
    // 1. HTTPS valido senza percorso
    let res = validate_and_normalize_relay_url("https://relay.example.com").unwrap();
    assert_eq!(res.http_url, "https://relay.example.com");
    assert_eq!(res.ws_url, "wss://relay.example.com/v1/host");

    // 2. Trailing slash rimossa
    let res = validate_and_normalize_relay_url("https://relay.example.com/").unwrap();
    assert_eq!(res.http_url, "https://relay.example.com");
    assert_eq!(res.ws_url, "wss://relay.example.com/v1/host");

    // 3. Porta esplicita
    let res = validate_and_normalize_relay_url("https://relay.example.com:8443").unwrap();
    assert_eq!(res.http_url, "https://relay.example.com:8443");
    assert_eq!(res.ws_url, "wss://relay.example.com:8443/v1/host");

    // 4. HTTP consentito solo per localhost/127.0.0.1/[::1]
    let res = validate_and_normalize_relay_url("http://localhost:3000").unwrap();
    assert_eq!(res.http_url, "http://localhost:3000");
    assert_eq!(res.ws_url, "ws://localhost:3000/v1/host");

    let res = validate_and_normalize_relay_url("http://127.0.0.1:8080").unwrap();
    assert_eq!(res.http_url, "http://127.0.0.1:8080");
    assert_eq!(res.ws_url, "ws://127.0.0.1:8080/v1/host");

    let res = validate_and_normalize_relay_url("http://[::1]:8080").unwrap();
    assert_eq!(res.http_url, "http://[::1]:8080");
    assert_eq!(res.ws_url, "ws://[::1]:8080/v1/host");

    // 5. Rifiuto HTTP per domini non loopback
    assert!(validate_and_normalize_relay_url("http://relay.example.com").is_err());

    // 6. Rifiuto percorsi aggiuntivi
    assert!(validate_and_normalize_relay_url("https://relay.example.com/subpath").is_err());

    // 7. Rifiuto query o frammenti
    assert!(validate_and_normalize_relay_url("https://relay.example.com?token=123").is_err());
    assert!(validate_and_normalize_relay_url("https://relay.example.com#section").is_err());

    // 8. Rifiuto schemi non HTTP/HTTPS (es. ws:// direttamente)
    assert!(validate_and_normalize_relay_url("wss://relay.example.com").is_err());
    assert!(validate_and_normalize_relay_url("not-a-url").is_err());
    assert!(validate_and_normalize_relay_url("").is_err());
}

#[test]
fn test_backoff_bounds_and_jitter_range() {
    // Verifica tabella canonica: 1, 2, 5, 10, 30, 60
    assert_eq!(backoff_base_secs(0), 1);
    assert_eq!(backoff_base_secs(1), 2);
    assert_eq!(backoff_base_secs(2), 5);
    assert_eq!(backoff_base_secs(3), 10);
    assert_eq!(backoff_base_secs(4), 30);
    assert_eq!(backoff_base_secs(5), 60);
    assert_eq!(backoff_base_secs(10), 60); // Oltre il 5-esimo tentativo resta 60s

    // Con jitter 0%: esattamente base * 1000 ms
    assert_eq!(backoff_delay_ms_with_jitter(0, 0.0), 1000);
    assert_eq!(backoff_delay_ms_with_jitter(1, 0.0), 2000);
    assert_eq!(backoff_delay_ms_with_jitter(2, 0.0), 5000);
    assert_eq!(backoff_delay_ms_with_jitter(3, 0.0), 10000);
    assert_eq!(backoff_delay_ms_with_jitter(4, 0.0), 30000);
    assert_eq!(backoff_delay_ms_with_jitter(5, 0.0), 60000);

    // Con jitter 20%: base * 1.20
    assert_eq!(backoff_delay_ms_with_jitter(0, 0.20), 1200);
    assert_eq!(backoff_delay_ms_with_jitter(1, 0.20), 2400);
    assert_eq!(backoff_delay_ms_with_jitter(2, 0.20), 6000);
    assert_eq!(backoff_delay_ms_with_jitter(3, 0.20), 12000);
    assert_eq!(backoff_delay_ms_with_jitter(4, 0.20), 36000);
    assert_eq!(backoff_delay_ms_with_jitter(5, 0.20), 72000);

    // Con funzione pseudocasuale: sempre compreso tra base e base * 1.20
    for attempt in 0..7 {
        for _ in 0..50 {
            let delay = compute_backoff_delay_ms(attempt);
            let base_ms = backoff_base_secs(attempt) * 1000;
            let max_ms = (base_ms as f64 * 1.20).round() as u64;
            assert!(
                delay >= base_ms && delay <= max_ms,
                "delay {delay} fuori dai limiti [{base_ms}, {max_ms}] per attempt {attempt}"
            );
        }
    }
}

#[test]
fn test_backoff_restarts_after_a_healthy_session() {
    // Una sessione durata almeno quanto il watchdog era collegata: si riparte da 1 s.
    assert_eq!(attempt_after_session(5, Duration::from_secs(70)), 0);
    assert_eq!(attempt_after_session(5, Duration::from_secs(3 * 3600)), 0);
    // Cadute rapide in fila (relay giu', rete assente) continuano a salire.
    assert_eq!(attempt_after_session(5, Duration::from_secs(69)), 5);
    assert_eq!(attempt_after_session(2, Duration::from_millis(300)), 2);
}

#[test]
fn test_close_code_mapping() {
    // 4401 o 4403 -> Revoked (nessun ritentativo)
    assert!(matches!(
        map_close_code(Some(close_code::UNAUTHORIZED), None),
        CloseOutcome::Revoked(_)
    ));
    assert!(matches!(
        map_close_code(Some(close_code::REVOKED), Some("cred revoked")),
        CloseOutcome::Revoked(r) if r == "cred revoked"
    ));

    // 4426 -> Incompatible
    assert!(matches!(
        map_close_code(Some(close_code::INCOMPATIBLE), None),
        CloseOutcome::Incompatible(_)
    ));

    // 4409 -> WaitReplaced con attesa 60 s
    assert!(matches!(
        map_close_code(Some(close_code::REPLACED), None),
        CloseOutcome::WaitReplaced(60_000)
    ));

    // Altri codici o interruzioni generiche -> Backoff
    assert!(matches!(
        map_close_code(Some(1000), None),
        CloseOutcome::Backoff(_)
    ));
    assert!(matches!(
        map_close_code(Some(1006), None),
        CloseOutcome::Backoff(_)
    ));
    assert!(matches!(
        map_close_code(None, None),
        CloseOutcome::Backoff(_)
    ));
}

#[test]
fn test_config_roundtrip_host_id_and_permissions() {
    let temp_dir = std::env::temp_dir().join(format!("omp-test-remote-{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&temp_dir);
    let config_path = temp_dir.join("remote.json");

    // Primo caricamento: file assente -> generato con hostId stabile e salvato
    let first = load_or_create_config(&config_path).expect("creazione config fallita");
    assert!(!first.host_id.is_empty());
    assert!(!first.enabled);
    assert_eq!(first.credential, None);

    // Secondo caricamento: hostId conservato
    let second = load_or_create_config(&config_path).expect("lettura config fallita");
    assert_eq!(first.host_id, second.host_id);
    assert_eq!(first.machine_name, second.machine_name);

    // Modifica e salvataggio credenziale
    let mut updated = second.clone();
    updated.credential = Some("test-credential-secret".to_string());
    updated.enabled = true;
    updated.relay_url = Some("https://relay.example.com".to_string());
    save_config(&config_path, &updated).expect("salvataggio config fallito");

    let third = load_or_create_config(&config_path).expect("rilettura config fallita");
    assert_eq!(third.credential.as_deref(), Some("test-credential-secret"));
    assert!(third.enabled);
    assert_eq!(third.host_id, first.host_id);

    // Verifica permessi 0600 su Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(&config_path).expect("metadata");
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "I permessi del file devono essere 0600 su Unix"
        );
    }

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_frame_json_shapes() {
    // 1. HostFrame::Hello
    let hello = HostFrame::Hello {
        protocol: ProtocolId {
            name: PROTOCOL_NAME.to_string(),
            version: PROTOCOL_VERSION,
        },
        features: FEATURES.iter().map(|s| s.to_string()).collect(),
        host: HostInfo {
            name: "MacBook-Pro".to_string(),
            platform: "macos".to_string(),
            app_version: "1.7.2".to_string(),
        },
    };
    let json_val = serde_json::to_value(&hello).unwrap();
    assert_eq!(json_val["type"], "hello");
    assert_eq!(json_val["protocol"]["name"], "omp-studio-remote");
    assert_eq!(json_val["protocol"]["version"], 1);
    assert_eq!(json_val["host"]["name"], "MacBook-Pro");
    assert_eq!(json_val["host"]["appVersion"], "1.7.2");
    assert!(FEATURES.contains(&"chat_rich"));
    assert!(FEATURES.contains(&"lane_config"));
    let features_arr = json_val["features"].as_array().unwrap();
    assert!(features_arr.iter().any(|f| f == "chat_rich"));
    assert!(features_arr.iter().any(|f| f == "lane_config"));

    // 2. HostFrame::Snapshot
    let snapshot = HostFrame::Snapshot {
        seq: 1,
        state: serde_json::json!({ "projects": [] }),
    };
    let snap_json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(snap_json["type"], "snapshot");
    assert_eq!(snap_json["seq"], 1);
    assert_eq!(snap_json["state"]["projects"], serde_json::json!([]));

    // 3. HostFrame::CommandResult
    let cmd_res = HostFrame::CommandResult {
        command_id: "cmd-uuid-1".to_string(),
        ok: true,
        error: None,
        data: None,
    };
    let cmd_json = serde_json::to_value(&cmd_res).unwrap();
    assert_eq!(cmd_json["type"], "command_result");
    assert_eq!(cmd_json["commandId"], "cmd-uuid-1");
    assert_eq!(cmd_json["ok"], true);
    assert!(cmd_json.get("error").is_none());
    assert!(cmd_json.get("data").is_none());

    // 4. RelayToHostFrame::Welcome
    let welcome_raw = serde_json::json!({
        "type": "welcome",
        "protocol": { "name": "omp-studio-remote", "version": 1 },
        "relay": {
            "version": "1.2.0",
            "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
        },
        "features": ["respond_ui"],
        "heartbeatMs": 25000,
        "clients": [{ "id": "dev-1", "name": "Phone" }]
    });
    let welcome: RelayToHostFrame = serde_json::from_value(welcome_raw).unwrap();
    match welcome {
        RelayToHostFrame::Welcome {
            relay,
            heartbeat_ms,
            clients,
            features,
            ..
        } => {
            assert_eq!(relay.version, "1.2.0");
            assert_eq!(heartbeat_ms, 25000);
            assert_eq!(clients.len(), 1);
            assert_eq!(clients[0].name, "Phone");
            assert_eq!(features, vec!["respond_ui"]);
        }
        _ => panic!("Atteso frame Welcome"),
    }

    // 5. HealthResponse
    let health_raw = serde_json::json!({
        "ok": true,
        "service": "omp-studio-relay",
        "version": "1.2.0",
        "protocol": { "name": "omp-studio-remote", "min": 1, "max": 2 }
    });
    let health: HealthResponse = serde_json::from_value(health_raw).unwrap();
    assert!(health.ok);
    assert_eq!(health.version, "1.2.0");
    assert_eq!(health.protocol.max, 2);

    // 6. HostFrame::ChatEvent
    let chat_ev = HostFrame::ChatEvent {
        project_id: "proj-1".to_string(),
        lane_id: "lane-a".to_string(),
        event: serde_json::json!({
            "kind": "delta",
            "messageId": "msg-123",
            "text": "ciao da studio"
        }),
    };
    let chat_json = serde_json::to_value(&chat_ev).unwrap();
    assert_eq!(chat_json["type"], "chat_event");
    assert_eq!(chat_json["projectId"], "proj-1");
    assert_eq!(chat_json["laneId"], "lane-a");
    assert_eq!(chat_json["event"]["kind"], "delta");
    assert_eq!(chat_json["event"]["text"], "ciao da studio");

    // 7. RelayToHostFrame::ChatWatch
    let watch_raw = serde_json::json!({
        "type": "chat_watch",
        "lanes": [
            { "projectId": "proj-1", "laneId": "main" },
            { "projectId": "proj-2", "laneId": "lane-b" }
        ]
    });
    let watch: RelayToHostFrame = serde_json::from_value(watch_raw).unwrap();
    match watch {
        RelayToHostFrame::ChatWatch { lanes } => {
            assert_eq!(lanes.len(), 2);
            assert_eq!(lanes[0].project_id, "proj-1");
            assert_eq!(lanes[0].lane_id, "main");
            assert_eq!(lanes[1].project_id, "proj-2");
            assert_eq!(lanes[1].lane_id, "lane-b");
        }
        _ => panic!("Atteso frame ChatWatch"),
    }
}

#[tokio::test]
async fn test_chat_watch_and_chat_event_queue() {
    let cfg = RemoteConfig {
        host_id: "test-host".to_string(),
        machine_name: "TestMachine".to_string(),
        relay_url: Some("http://127.0.0.1:18790".to_string()),
        credential: Some("cred".to_string()),
        enabled: true,
    };
    let ctx = ConnectionContext::new(None, cfg);

    // 1. Hook per chat_watch
    let received_lanes = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let rl_clone = received_lanes.clone();
    *ctx.chat_watch_hook.lock() = Some(Arc::new(move |lanes| {
        *rl_clone.lock() = lanes;
    }));

    ctx.emit_chat_watch_event(vec![RemoteLaneRef {
        project_id: "p1".to_string(),
        lane_id: "main".to_string(),
    }]);
    assert_eq!(received_lanes.lock().len(), 1);
    assert_eq!(received_lanes.lock()[0].project_id, "p1");

    // 2. Queue chat event quando connesso
    ctx.status.lock().connection = RemoteConnection::Connected;
    ctx.queue_chat_event(
        "p1".to_string(),
        "main".to_string(),
        serde_json::json!({ "kind": "message", "text": "hello" }),
    );
    assert_eq!(ctx.chat_events.lock().len(), 1);
}

#[tokio::test]
#[allow(clippy::result_large_err)]
async fn test_in_process_local_relay_integration() {
    // Configura un server WebSocket locale tokio-tungstenite su 127.0.0.1:0
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind tcp");
    let local_addr = listener.local_addr().expect("local addr");
    let test_credential = "secret-token-test-12345";

    // Canali per sincronizzare il test con il server
    let (bearer_tx, bearer_rx) = oneshot::channel::<String>();
    let (hello_tx, hello_rx) = oneshot::channel::<serde_json::Value>();
    let (snapshot1_tx, snapshot1_rx) = oneshot::channel::<serde_json::Value>();
    let (pong_tx, pong_rx) = oneshot::channel::<u64>();
    let (cmd_result_tx, cmd_result_rx) = oneshot::channel::<serde_json::Value>();
    let (snapshot2_tx, snapshot2_rx) = oneshot::channel::<serde_json::Value>();

    let bearer_tx = Arc::new(parking_lot::Mutex::new(Some(bearer_tx)));
    let hello_tx = Arc::new(parking_lot::Mutex::new(Some(hello_tx)));
    let snapshot1_tx = Arc::new(parking_lot::Mutex::new(Some(snapshot1_tx)));
    let pong_tx = Arc::new(parking_lot::Mutex::new(Some(pong_tx)));
    let cmd_result_tx = Arc::new(parking_lot::Mutex::new(Some(cmd_result_tx)));
    let snapshot2_tx = Arc::new(parking_lot::Mutex::new(Some(snapshot2_tx)));

    let connection_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let connection_count_clone = connection_count.clone();

    // Server WebSocket di test
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let conn_num = connection_count_clone.fetch_add(1, Ordering::SeqCst);
            let b_tx = bearer_tx.clone();
            let h_tx = hello_tx.clone();
            let s1_tx = snapshot1_tx.clone();
            let p_tx = pong_tx.clone();
            let cr_tx = cmd_result_tx.clone();
            let s2_tx = snapshot2_tx.clone();

            let callback =
                move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                    if let Some(auth) = req.headers().get("Authorization") {
                        if let Ok(auth_str) = auth.to_str() {
                            if let Some(tx) = b_tx.lock().take() {
                                let _ = tx.send(auth_str.to_string());
                            }
                        }
                    }
                    Ok(resp)
                };

            let ws_stream = tokio_tungstenite::accept_hdr_async(stream, callback)
                .await
                .expect("accept ws");
            let (mut ws_write, mut ws_read) = ws_stream.split();

            // Prima connessione
            if conn_num == 0 {
                // 1. Ricevi `hello`
                if let Some(Ok(Message::Text(text))) = ws_read.next().await {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if let Some(tx) = h_tx.lock().take() {
                        let _ = tx.send(v);
                    }
                }

                // Invia `welcome`
                let welcome = serde_json::json!({
                    "type": "welcome",
                    "protocol": { "name": "omp-studio-remote", "version": 1 },
                    "relay": {
                        "version": "1.0.0",
                        "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
                    },
                    "features": ["respond_ui"],
                    "heartbeatMs": 25000,
                    "clients": []
                });
                ws_write
                    .send(Message::Text(welcome.to_string().into()))
                    .await
                    .unwrap();

                // Ricevi primo snapshot (seq = 1)
                if let Some(Ok(Message::Text(text))) = ws_read.next().await {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if let Some(tx) = s1_tx.lock().take() {
                        let _ = tx.send(v);
                    }
                }

                // Invia Ping
                let ping = serde_json::json!({ "type": "ping", "seq": 99, "t": 1234 });
                ws_write
                    .send(Message::Text(ping.to_string().into()))
                    .await
                    .unwrap();

                // Ricevi Pong
                if let Some(Ok(Message::Text(text))) = ws_read.next().await {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if v["type"] == "pong" {
                        if let Some(tx) = p_tx.lock().take() {
                            let _ = tx.send(v["seq"].as_u64().unwrap());
                        }
                    }
                }

                // Invia Command verso Studio
                let cmd = serde_json::json!({
                    "type": "command",
                    "commandId": "cmd-42",
                    "device": { "id": "dev-phone", "name": "iPhone" },
                    "command": { "kind": "run_task", "projectId": "p1", "taskId": "t1" }
                });
                ws_write
                    .send(Message::Text(cmd.to_string().into()))
                    .await
                    .unwrap();

                // Ricevi CommandResult
                if let Some(Ok(Message::Text(text))) = ws_read.next().await {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if v["type"] == "command_result" {
                        if let Some(tx) = cr_tx.lock().take() {
                            let _ = tx.send(v);
                        }
                    }
                }

                // Chiudi forzatamente per testare la riconnessione
                let _ = ws_write
                    .send(Message::Close(Some(CloseFrame {
                        code: WsCloseCode::Away,
                        reason: "reconnect test".into(),
                    })))
                    .await;
            } else {
                // Seconda connessione (riconnessione)
                // Ricevi `hello`
                let _ = ws_read.next().await;

                // Invia `welcome`
                let welcome = serde_json::json!({
                    "type": "welcome",
                    "protocol": { "name": "omp-studio-remote", "version": 1 },
                    "relay": {
                        "version": "1.0.0",
                        "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
                    },
                    "features": ["respond_ui"],
                    "heartbeatMs": 25000,
                    "clients": []
                });
                ws_write
                    .send(Message::Text(welcome.to_string().into()))
                    .await
                    .unwrap();

                // Ricevi nuovo snapshot (seq riparte da 1 con l'ultimo stato)
                if let Some(Ok(Message::Text(text))) = ws_read.next().await {
                    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if let Some(tx) = s2_tx.lock().take() {
                        let _ = tx.send(v);
                    }
                }
                break;
            }
        }
    });

    // Inizializza client Studio
    let config = RemoteConfig {
        enabled: true,
        relay_url: Some(format!("http://127.0.0.1:{}", local_addr.port())),
        machine_name: "TestMachine".to_string(),
        host_id: "host-uuid-123".to_string(),
        credential: Some(test_credential.to_string()),
    };

    let ctx = ConnectionContext::new(None, config);

    // Imposta lo stato iniziale della macchina prima della connessione
    *ctx.latest_state.lock() = Some(serde_json::json!({ "state": "first_snapshot" }));

    // Hook per catturare i comandi
    let (received_cmd_tx, mut received_cmd_rx) = mpsc::channel::<RemoteCommandEvent>(1);
    *ctx.command_hook.lock() = Some(Arc::new(move |cmd_event| {
        let _ = received_cmd_tx.try_send(cmd_event);
    }));

    // Avvia la connessione client
    let handle = start_connection_task(ctx.clone());

    // 1. Verifica header Bearer
    let bearer = tokio::time::timeout(Duration::from_secs(2), bearer_rx)
        .await
        .expect("timeout bearer")
        .expect("recv bearer");
    assert_eq!(bearer, format!("Bearer {test_credential}"));

    // 2. Verifica frame `hello`
    let hello_val = tokio::time::timeout(Duration::from_secs(2), hello_rx)
        .await
        .expect("timeout hello")
        .expect("recv hello");
    assert_eq!(hello_val["type"], "hello");
    assert_eq!(hello_val["host"]["name"], "TestMachine");

    // 3. Verifica primo snapshot ricevuto dal relay con seq = 1
    let snap1_val = tokio::time::timeout(Duration::from_secs(2), snapshot1_rx)
        .await
        .expect("timeout snapshot1")
        .expect("recv snapshot1");
    assert_eq!(snap1_val["type"], "snapshot");
    assert_eq!(snap1_val["seq"], 1);
    assert_eq!(snap1_val["state"]["state"], "first_snapshot");

    // 4. Verifica Pong inviato a seguito di Ping
    let pong_seq = tokio::time::timeout(Duration::from_secs(2), pong_rx)
        .await
        .expect("timeout pong")
        .expect("recv pong");
    assert_eq!(pong_seq, 99);

    // 5. Verifica che il comando dal relay arrivi al command_hook
    let received_cmd = tokio::time::timeout(Duration::from_secs(2), received_cmd_rx.recv())
        .await
        .expect("timeout cmd")
        .expect("recv cmd");
    assert_eq!(received_cmd.command_id, "cmd-42");
    assert_eq!(received_cmd.device.name, "iPhone");

    // 6. Invia il risultato del comando tramite remote_command_result
    ctx.queue_command_result(
        "cmd-42".to_string(),
        true,
        None,
        Some(serde_json::json!({ "taskId": "t-1" })),
    );

    let cr_val = tokio::time::timeout(Duration::from_secs(2), cmd_result_rx)
        .await
        .expect("timeout cmd result")
        .expect("recv cmd result");
    assert_eq!(cr_val["type"], "command_result");
    assert_eq!(cr_val["commandId"], "cmd-42");
    assert_eq!(cr_val["ok"], true);
    assert_eq!(cr_val["data"]["taskId"], "t-1");

    // Aggiorna lo stato della macchina prima della riconnessione
    *ctx.latest_state.lock() = Some(serde_json::json!({ "state": "updated_snapshot" }));

    // Il server ha chiuso la prima connessione: il client si ricollega
    // 7. Verifica che il nuovo snapshot venga rimandato subito dopo il benvenuto della riconnessione
    let snap2_val = tokio::time::timeout(Duration::from_secs(5), snapshot2_rx)
        .await
        .expect("timeout snapshot2")
        .expect("recv snapshot2");
    assert_eq!(snap2_val["type"], "snapshot");
    assert_eq!(snap2_val["seq"], 1); // Ripartito da 1
    assert_eq!(snap2_val["state"]["state"], "updated_snapshot");

    // Termina il task di test
    if let Some(tx) = ctx.shutdown_sender.lock().take() {
        let _ = tx.send(true);
    }
    handle.abort();
}

#[tokio::test]
async fn test_handshake_401_maps_to_revoked_without_retry() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let attempts = Arc::new(AtomicUsize::new(0));
    let attempts_clone = attempts.clone();

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            attempts_clone.fetch_add(1, Ordering::SeqCst);
            let callback = |_req: &Request, _resp: Response| -> Result<Response, ErrorResponse> {
                let mut err = ErrorResponse::new(Some("Unauthorized".to_string()));
                *err.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                Err(err)
            };
            let _ = tokio_tungstenite::accept_hdr_async(stream, callback).await;
        }
    });

    let config = RemoteConfig {
        enabled: true,
        relay_url: Some(format!("http://{addr}")),
        credential: Some("test-token".to_string()),
        machine_name: "TestMachine".to_string(),
        host_id: "host-401".to_string(),
    };
    let ctx = ConnectionContext::new(None, config);

    let _handle = start_connection_task(ctx.clone());

    // Attesa che lo stato diventi Revoked
    let mut revoked = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let st = ctx.status.lock().clone();
        if st.connection == RemoteConnection::Revoked {
            revoked = true;
            assert!(
                st.retry_at.is_none(),
                "retry_at deve essere None su Revoked"
            );
            assert!(st.last_error.is_some(), "last_error deve essere presente");
            break;
        }
    }
    assert!(revoked, "Lo stato doveva diventare Revoked");

    // Attesa per confermare che nessun secondo tentativo venga effettuato
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "Non devono esserci ulteriori tentativi di connessione dopo 401"
    );

    stop_connection_task(&ctx);
}

#[tokio::test]
async fn test_watchdog_fires_with_only_outbound_traffic() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let (connected_tx, connected_rx) = oneshot::channel();

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let callback = |_req: &Request, resp: Response| Ok(resp);
            if let Ok(ws_stream) = tokio_tungstenite::accept_hdr_async(stream, callback).await {
                let (mut ws_write, mut ws_read) = ws_stream.split();
                // Ricevi hello
                if let Some(Ok(Message::Text(_))) = ws_read.next().await {
                    let welcome = serde_json::json!({
                        "type": "welcome",
                        "protocol": { "name": "omp-studio-remote", "version": 1 },
                        "relay": {
                            "version": "1.0.0",
                            "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
                        },
                        "features": [],
                        "heartbeatMs": 25000,
                        "clients": []
                    });
                    let _ = ws_write
                        .send(Message::Text(welcome.to_string().into()))
                        .await;
                    let _ = connected_tx.send(());

                    // Riceve traffico in uscita senza mai inviare frame verso Studio
                    while let Some(Ok(_)) = ws_read.next().await {}
                }
            }
        }
    });

    let config = RemoteConfig {
        enabled: true,
        relay_url: Some(format!("http://{addr}")),
        credential: Some("test-token".to_string()),
        machine_name: "TestMachine".to_string(),
        host_id: "host-wd".to_string(),
    };
    let ctx = ConnectionContext::new(None, config);
    let (_shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    let session_task = tokio::spawn({
        let ctx = ctx.clone();
        async move {
            run_single_session(
                &ctx,
                &ws_url,
                "test-token",
                "TestMachine",
                &mut shutdown_rx,
                0,
            )
            .await
        }
    });

    connected_rx
        .await
        .expect("connessione handshake completata");
    for _ in 0..20 {
        if ctx.status.lock().connection == RemoteConnection::Connected {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(ctx.status.lock().connection, RemoteConnection::Connected);

    // Mettiamo in pausa il tempo di Tokio per verificare l'inattivita' a 70 s istantaneamente
    tokio::time::pause();
    // Inviamo traffico in uscita ogni 15s per 5 volte (totale 75s > 70s).
    // Con la correzione, il watchdog a 70 s non viene ricreato sul traffico in uscita
    // e scade a 70 s dall'avvio della sessione.
    for i in 0..5 {
        tokio::time::advance(Duration::from_secs(15)).await;
        *ctx.latest_state.lock() = Some(serde_json::json!({ "tick": i }));
        ctx.snapshot_notify.notify_one();
        tokio::task::yield_now().await;
    }

    let outcome = session_task.await.expect("session task terminato");
    match outcome {
        Err(CloseOutcome::Backoff(msg)) => {
            assert!(
                msg.contains("70 s") || msg.contains("heartbeat timeout"),
                "Messaggio di timeout inatteso: {msg}"
            );
        }
        other => panic!("Esito inatteso della sessione: {:?}", other),
    }
}

#[tokio::test]
async fn test_disable_during_pending_welcome_leaves_disabled_and_no_snapshot() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (hello_received_tx, hello_received_rx) = oneshot::channel();
    let (allow_welcome_tx, allow_welcome_rx) = oneshot::channel();
    let (snapshot_received_tx, mut snapshot_received_rx) = mpsc::channel(1);

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let callback = |_req: &Request, resp: Response| Ok(resp);
            if let Ok(ws_stream) = tokio_tungstenite::accept_hdr_async(stream, callback).await {
                let (mut ws_write, mut ws_read) = ws_stream.split();
                // 1. Ricevi hello
                if let Some(Ok(Message::Text(_))) = ws_read.next().await {
                    let _ = hello_received_tx.send(());
                    // Attendi che il client disabiliti la connessione
                    let _ = allow_welcome_rx.await;

                    // Invia welcome frame
                    let welcome = serde_json::json!({
                        "type": "welcome",
                        "protocol": { "name": "omp-studio-remote", "version": 1 },
                        "relay": {
                            "version": "1.0.0",
                            "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
                        },
                        "features": [],
                        "heartbeatMs": 25000,
                        "clients": []
                    });
                    let _ = ws_write
                        .send(Message::Text(welcome.to_string().into()))
                        .await;

                    // Verifica se arriva o meno uno snapshot
                    if let Ok(Some(Ok(Message::Text(text)))) =
                        tokio::time::timeout(Duration::from_millis(300), ws_read.next()).await
                    {
                        let _ = snapshot_received_tx.send(text).await;
                    }
                }
            }
        }
    });

    let config = RemoteConfig {
        enabled: true,
        relay_url: Some(format!("http://{addr}")),
        credential: Some("test-token".to_string()),
        machine_name: "TestMachine".to_string(),
        host_id: "host-welcome-cancel".to_string(),
    };
    let ctx = ConnectionContext::new(None, config);
    // Prepariamo uno stato macchina che verrebbe inviato come snapshot iniziale se connesso
    *ctx.latest_state.lock() = Some(serde_json::json!({ "state": "must_not_send" }));

    start_connection_task(ctx.clone());

    // Attendi ricezione di hello sul server
    hello_received_rx.await.expect("hello ricevuto dal server");

    // L'utente disabilita il controllo remoto mentre e' in attesa del benvenuto
    stop_connection_task(&ctx);
    {
        let mut st = ctx.status.lock();
        st.enabled = false;
        st.connection = RemoteConnection::Disabled;
    }

    // Permetti al server di inviare welcome
    let _ = allow_welcome_tx.send(());

    // Nessun snapshot deve pervenire al server
    let received = snapshot_received_rx.recv().await;
    assert!(
        received.is_none(),
        "Nessuno snapshot doveva essere inviato dopo disable: {received:?}"
    );

    // Lo stato deve rimanere Disabled
    assert_eq!(ctx.status.lock().connection, RemoteConnection::Disabled);
    assert!(!ctx.status.lock().enabled);
}

#[tokio::test]
async fn test_stale_pairing_completion_after_disable_does_not_enable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (req_received_tx, req_received_rx) = oneshot::channel();
    let (allow_resp_tx, allow_resp_rx) = oneshot::channel();

    // Mock HTTP server con risposta ritardata
    tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 2048];
            let _ = stream.read(&mut buf).await;
            let _ = req_received_tx.send(());
            let _ = allow_resp_rx.await;

            let body = r#"{"hostId":"host-pair-stale","credential":"token-stale-pair"}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
        }
    });

    let dir = std::env::temp_dir().join(format!("omp-test-pair-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let config_path = dir.join("remote.json");

    let cfg = RemoteConfig {
        enabled: false,
        relay_url: None,
        credential: None,
        machine_name: "Machine".to_string(),
        host_id: "host-pair-stale".to_string(),
    };
    save_config(&config_path, &cfg).unwrap();

    let manager = RemoteManager::new(None, config_path.clone()).unwrap();

    // Avvia la richiesta di pairing HTTP
    let mgr_clone = manager.clone();
    let pair_task = tokio::spawn(async move {
        mgr_clone
            .pair(&format!("http://{addr}"), "123456", "Machine")
            .await
    });

    // Attendi che la richiesta HTTP arrivi al server
    req_received_rx.await.expect("richiesta HTTP ricevuta");

    // L'utente disabilita l'operazione prima del completamento (modifica configurazione ed epoca)
    manager.set_enabled(false).unwrap();

    // Sblocca la risposta HTTP
    let _ = allow_resp_tx.send(());

    // La chiamata pair si conclude ma con epoca superata
    let pair_status = pair_task.await.unwrap().expect("pair completato");
    assert!(
        !pair_status.enabled,
        "Lo stato restituito deve risultare non abilitato"
    );
    assert!(
        pair_status.last_error.is_some(),
        "Deve essere presente last_error esplicativo"
    );

    // Verifica configurazione su disco: non deve essere stata salvata ne' abilitata
    let disk_cfg = load_or_create_config(&config_path).unwrap();
    assert!(
        !disk_cfg.enabled,
        "La configurazione su disco deve restare disabilitata"
    );
    assert!(
        disk_cfg.credential.is_none(),
        "La credenziale non deve essere stata salvata"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn test_command_reaches_test_hook_exactly_once() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (connected_tx, connected_rx) = oneshot::channel();

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let callback = |_req: &Request, resp: Response| Ok(resp);
            if let Ok(ws_stream) = tokio_tungstenite::accept_hdr_async(stream, callback).await {
                let (mut ws_write, mut ws_read) = ws_stream.split();
                // 1. Ricevi hello
                if let Some(Ok(Message::Text(_))) = ws_read.next().await {
                    let welcome = serde_json::json!({
                        "type": "welcome",
                        "protocol": { "name": "omp-studio-remote", "version": 1 },
                        "relay": {
                            "version": "1.0.0",
                            "protocol": { "name": "omp-studio-remote", "min": 1, "max": 1 }
                        },
                        "features": [],
                        "heartbeatMs": 25000,
                        "clients": []
                    });
                    let _ = ws_write
                        .send(Message::Text(welcome.to_string().into()))
                        .await;
                    let _ = connected_tx.send(());

                    // Invia esattamente un comando
                    let cmd = serde_json::json!({
                        "type": "command",
                        "commandId": "cmd-once",
                        "device": { "id": "dev1", "name": "Tester" },
                        "command": { "kind": "ping" }
                    });
                    let _ = ws_write.send(Message::Text(cmd.to_string().into())).await;

                    while let Some(Ok(_)) = ws_read.next().await {}
                }
            }
        }
    });

    let config = RemoteConfig {
        enabled: true,
        relay_url: Some(format!("http://{addr}")),
        credential: Some("test-token".to_string()),
        machine_name: "TestMachine".to_string(),
        host_id: "host-cmd-once".to_string(),
    };
    let ctx = ConnectionContext::new(None, config);

    let cmd_counter = Arc::new(AtomicUsize::new(0));
    let cmd_counter_clone = cmd_counter.clone();
    *ctx.command_hook.lock() = Some(Arc::new(move |_cmd| {
        cmd_counter_clone.fetch_add(1, Ordering::SeqCst);
    }));

    start_connection_task(ctx.clone());
    connected_rx.await.expect("connesso");

    // Attendi la ricezione del comando
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        if cmd_counter.load(Ordering::SeqCst) > 0 {
            break;
        }
    }

    // Ulteriore attesa per verificare che non arrivino duplicati
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        cmd_counter.load(Ordering::SeqCst),
        1,
        "Il comando deve raggiungere l'hook esattamente una sola volta"
    );

    stop_connection_task(&ctx);
}

#[test]
fn test_connection_task_startup_outside_tokio_runtime() {
    let dir = std::env::temp_dir().join(format!("omp-test-startup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let config_path = dir.join("remote.json");

    let cfg = RemoteConfig {
        enabled: true,
        relay_url: Some("http://127.0.0.1:9999".to_string()),
        credential: Some("test-credential".to_string()),
        machine_name: "Test Machine".to_string(),
        host_id: "host-startup".to_string(),
    };
    save_config(&config_path, &cfg).unwrap();

    let manager = RemoteManager::new(None, config_path).unwrap();
    // Questo e' l'entry point identico a quello invocato durante il bootstrap di Tauri (remote::init):
    // `manager.start_if_enabled()` che a sua volta invoca `start_connection_task(ctx)`.
    // In assenza di un runtime Tokio attivo nel thread corrente, l'uso originario di `tokio::spawn`
    // causava panico immediato: con `tauri::async_runtime::spawn`, il task viene avviato regolarmente.
    manager.start_if_enabled();

    assert_eq!(
        manager.ctx.status.lock().connection,
        RemoteConnection::Connecting
    );

    manager.stop_connection();
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_remote_machines_window_has_no_capabilities() {
    use std::fs;
    use std::path::{Path, PathBuf};

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let capabilities_dir = manifest_dir.join("capabilities");

    assert!(
        capabilities_dir.is_dir(),
        "Cartella capabilities non trovata: {:?}",
        capabilities_dir
    );

    let mut capability_files = Vec::new();

    fn collect_files(dir: &Path, files: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect_files(&path, files);
                } else if let Some(ext) = path.extension() {
                    if ext == "json" || ext == "toml" {
                        files.push(path);
                    }
                }
            }
        }
    }

    collect_files(&capabilities_dir, &mut capability_files);
    assert!(
        !capability_files.is_empty(),
        "Nessun file capability trovato in {:?}",
        capabilities_dir
    );

    let mut checked_files = 0;

    for path in &capability_files {
        let content = fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("Impossibile leggere file {:?}: {}", path, e));

        let json: serde_json::Value = if path.extension().and_then(|s| s.to_str()) == Some("json") {
            serde_json::from_str(&content)
                .unwrap_or_else(|e| panic!("JSON non valido in {:?}: {}", path, e))
        } else {
            continue;
        };

        let cap_id = json
            .get("identifier")
            .and_then(|v| v.as_str())
            .unwrap_or("<unknown>");

        for key in ["windows", "webviews"] {
            if let Some(list) = json.get(key).and_then(|v| v.as_array()) {
                for item in list {
                    if let Some(pattern_str) = item.as_str() {
                        let pattern = glob::Pattern::new(pattern_str).unwrap_or_else(|e| {
                            panic!(
                                "Pattern glob non valido {:?} in {:?}: {}",
                                pattern_str, path, e
                            )
                        });

                        assert!(
                            !pattern.matches(crate::remote::MACHINES_WINDOW_LABEL),
                            "VIOLAZIONE SICUREZZA ACL: La capability {:?} nel file {:?} applica il pattern {:?} ({}) alla finestra confinata {:?}!",
                            cap_id,
                            path.file_name().unwrap_or_default(),
                            pattern_str,
                            key,
                            crate::remote::MACHINES_WINDOW_LABEL
                        );
                    }
                }
            }
        }

        checked_files += 1;
    }

    assert!(
        checked_files > 0,
        "Almeno un file di capability deve essere stato verificato"
    );
}

#[test]
fn test_acl_checker_catches_broad_globs_and_exact_matches() {
    let label = crate::remote::MACHINES_WINDOW_LABEL;

    // Il checker deve riconoscere wildcard universale
    let wildcard = glob::Pattern::new("*").unwrap();
    assert!(wildcard.matches(label));

    // Wildcard con prefisso
    let prefix_wildcard = glob::Pattern::new("remote-*").unwrap();
    assert!(prefix_wildcard.matches(label));

    // Match esatto
    let exact = glob::Pattern::new("remote-machines").unwrap();
    assert!(exact.matches(label));

    // Finestre legittime di Studio NON devono corrispondere alla nuova finestra
    let main_pat = glob::Pattern::new("main").unwrap();
    assert!(!main_pat.matches(label));
    assert!(main_pat.matches("main"));

    let companion_pat = glob::Pattern::new("companion").unwrap();
    assert!(!companion_pat.matches(label));
    assert!(companion_pat.matches("companion"));
}

#[test]
fn test_remote_status_relay_features_lifecycle() {
    // 1. Serde di default: campo relayFeatures opzionale in JSON vecchio
    let raw_status = serde_json::json!({
        "enabled": true,
        "relayUrl": "https://relay.example.com",
        "machineName": "Test",
        "hostId": "host-1",
        "paired": true,
        "connection": "connected",
        "lastError": null,
        "retryAt": null,
        "clients": [],
        "relayVersion": "1.2.0",
        "relayProtocol": null,
        "updateNeeded": null
    });
    let status: RemoteStatus = serde_json::from_value(raw_status).unwrap();
    assert_eq!(status.relay_features, Vec::<String>::new());

    // 2. Serde con relayFeatures popolato
    let raw_status_with_features = serde_json::json!({
        "enabled": true,
        "relayUrl": "https://relay.example.com",
        "machineName": "Test",
        "hostId": "host-1",
        "paired": true,
        "connection": "connected",
        "lastError": null,
        "retryAt": null,
        "clients": [],
        "relayVersion": "1.2.0",
        "relayProtocol": null,
        "updateNeeded": null,
        "relayFeatures": ["respond_ui", "chat_rich"]
    });
    let status_rich: RemoteStatus = serde_json::from_value(raw_status_with_features).unwrap();
    assert_eq!(status_rich.relay_features, vec!["respond_ui", "chat_rich"]);

    let serialized = serde_json::to_value(&status_rich).unwrap();
    assert_eq!(
        serialized["relayFeatures"],
        serde_json::json!(["respond_ui", "chat_rich"])
    );
}
