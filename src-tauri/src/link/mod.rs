//! Collegamento nativo fra istanze: relay proprio, identita' persistenti e ACL.
mod catalog;
mod config;
mod protocol;
mod access;
mod activity;
pub(crate) mod streams;
pub(crate) mod host;

use std::{collections::HashMap, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{Endpoint, RelayMode, RelayUrl, endpoint::{Connection, presets}, tls::CaTlsConfig};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody, Request, Response};
use config::{Address, Config, Peer};
use protocol::{Hello, Operation, Reply, ALPN, PROTOCOL, MAX_BODY, read_body, read_json, send_json};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub(crate) struct LinkManager {
    runtime: tokio::sync::Mutex<Option<Arc<Runtime>>>,
    configuration_gate: tokio::sync::Mutex<()>,
}

struct Connected {
    connection: Connection,
    version: String,
    canonical: bool,
}
struct Invitation {
    token: String,
    expires: Instant,
}
struct Runtime {
    app: tauri::AppHandle,
    id: String,
    path: std::path::PathBuf,
    config: Mutex<Config>,
    endpoint: Mutex<Option<Endpoint>>,
    connections: Mutex<HashMap<String, Connected>>,
    invitation: Mutex<Option<Invitation>>,
    streams: Mutex<HashMap<String, Arc<streams::Subscription>>>,
    generation: AtomicU64,
    requests: tokio::sync::Semaphore,
    stream_slots: tokio::sync::Semaphore,
    connecting: Mutex<std::collections::HashSet<String>>,
    actions: Mutex<HashMap<String, host::PendingAction>>,
    snapshot: tokio::sync::watch::Sender<Option<Arc<String>>>,
    events: tokio::sync::broadcast::Sender<Arc<host::HostEvent>>,
    peer_states: Mutex<HashMap<String, Arc<String>>>,
    roots: parking_lot::RwLock<access::Roots>,
    /// Cosa stanno facendo le sessioni aperte da un'altra macchina (R-MI-18).
    pub(crate) activity: activity::SharedActivity,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkStatus {
    enabled: bool,
    name: String,
    machine_id: String,
    platform: &'static str,
    relay_url: String,
    has_relay_token: bool,
    peers: Vec<PeerStatus>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeerStatus {
    id: String,
    name: String,
    permissions: catalog::Permissions,
    online: bool,
    compatible: bool,
    version: Option<String>,
    route: Option<&'static str>,
    latency_ms: Option<f64>,
}

impl LinkManager {
    async fn runtime(&self, app: &tauri::AppHandle) -> Result<Arc<Runtime>, String> {
        let mut guard = self.runtime.lock().await;
        if let Some(runtime) = guard.as_ref() { return Ok(runtime.clone()); }
        let path = config::path(app)?;
        let config = Config::load(&path)?;
        let id = config.secret()?.public().to_string();
        let runtime = Arc::new(Runtime {
            app: app.clone(), path, config: Mutex::new(config), endpoint: Mutex::new(None),
            id,
            connections: Mutex::new(HashMap::new()), invitation: Mutex::new(None), generation: AtomicU64::new(0),
            streams: Mutex::new(HashMap::new()),
            requests: tokio::sync::Semaphore::new(8),
            stream_slots: tokio::sync::Semaphore::new(128),
            connecting: Mutex::new(std::collections::HashSet::new()),
            actions: Mutex::new(HashMap::new()),
            snapshot: tokio::sync::watch::channel(None).0,
            events: tokio::sync::broadcast::channel(64).0,
            peer_states: Mutex::new(HashMap::new()),
            roots: parking_lot::RwLock::new(access::Roots::default()),
            activity: Arc::new(activity::Activity::default()),
        });
        *guard = Some(runtime.clone());
        runtime.listen_host_events();
        runtime.start().await?;
        Ok(runtime)
    }
}

impl Runtime {
    fn status(&self) -> Result<LinkStatus, String> {
        let config = self.config.lock();
        let connections = self.connections.lock();
        let peers = config.peers.iter().map(|(id, peer)| {
            let connected = connections.get(id).filter(|entry| entry.connection.close_reason().is_none());
            let (route, latency_ms) = connected.map_or((None, None), |entry| {
                let paths = entry.connection.paths();
                let Some(path) = paths.iter().find(|path| path.is_selected()) else { return (None, None); };
                (Some(if path.is_ip() { "direct" } else { "relay" }),
                    entry.connection.rtt(path.id()).map(|duration| duration.as_secs_f64() * 1000.0))
            });
            PeerStatus {
                id: id.clone(), name: peer.name.clone(), permissions: peer.permissions,
                online: connected.is_some(), compatible: connected.is_none_or(|entry| entry.version == VERSION),
                version: connected.map(|entry| entry.version.clone()), route, latency_ms,
            }
        }).collect();
        Ok(LinkStatus { enabled: config.enabled, name: config.name.clone(), machine_id: self.id.clone(),
            platform: std::env::consts::OS,
            relay_url: config.relay_url.clone(), has_relay_token: !config.relay_token.is_empty(), peers })
    }

    fn changed(&self) {
        if let Ok(status) = self.status() { let _ = self.app.emit("link:status", &status); }
    }

    async fn start(self: &Arc<Self>) -> Result<(), String> {
        let (enabled, relay_url, token, secret) = {
            let config = self.config.lock();
            (config.enabled, config.relay_url.clone(), config.relay_token.clone(), config.secret()?)
        };
        if !enabled { return Ok(()); }
        let url: RelayUrl = relay_url.parse().map_err(|_| "Invalid iroh relay URL")?;
        let mut relay_map = RelayMode::custom([url]).relay_map();
        if !token.is_empty() { relay_map = relay_map.with_auth_token(token); }
        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret).relay_mode(RelayMode::Custom(relay_map))
            .ca_tls_config(CaTlsConfig::system()).alpns(vec![ALPN.to_vec()])
            .bind().await.map_err(|error| format!("Starting instance link: {error}"))?;
        *self.endpoint.lock() = Some(endpoint.clone());
        let generation = self.generation.load(Ordering::SeqCst);
        let runtime = self.clone();
        let accepting = endpoint.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let runtime = runtime.clone();
                tauri::async_runtime::spawn(async move {
                    let result = tokio::time::timeout(CONNECT_TIMEOUT, async {
                        let connection = incoming.await.map_err(|error| error.to_string())?;
                        runtime.accept(connection, generation).await
                    }).await;
                    if let Ok(Err(error)) = result {
                        crate::studio_log::info("link", format!("Collegamento rifiutato: {error}"));
                    }
                });
            }
        });
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if runtime.generation.load(Ordering::SeqCst) != generation { break; }
                let own_id = endpoint.id().to_string();
                let peers: Vec<_> = runtime.config.lock().peers.values().filter(|peer| own_id < peer.address.id).cloned().collect();
                for peer in peers {
                    if runtime.live_connection(&peer.address.id).is_some() { continue; }
                    if !runtime.connecting.lock().insert(peer.address.id.clone()) { continue; }
                    let runtime = runtime.clone();
                    let endpoint = endpoint.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = tokio::time::timeout(CONNECT_TIMEOUT, runtime.connect(&endpoint, &peer.address, None, generation)).await;
                        runtime.connecting.lock().remove(&peer.address.id);
                    });
                }
                runtime.changed();
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
        Ok(())
    }

    async fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.invitation.lock().take();
        let connections = std::mem::take(&mut *self.connections.lock());
        for (_, connected) in connections { connected.connection.close(0u32.into(), b"configuration changed"); }
        let endpoint = self.endpoint.lock().take();
        if let Some(endpoint) = endpoint { endpoint.close().await; }
    }

    fn hello(&self, pairing: Option<String>) -> Result<Hello, String> {
        let endpoint = self.endpoint.lock().clone().ok_or("Instance link is disabled")?;
        let config = self.config.lock();
        Ok(Hello { protocol: PROTOCOL, version: VERSION.into(), name: config.name.clone(),
            address: Address::from_endpoint(endpoint.addr(), &config.relay_url), pairing })
    }

    fn authorize_hello(&self, connection: &Connection, hello: &Hello, generation: u64, initiated_pairing: bool) -> Result<(), String> {
        if generation != self.generation.load(Ordering::SeqCst) { return Err("Obsolete connection".into()); }
        if hello.protocol != PROTOCOL { return Err("Incompatible Studio link protocol".into()); }
        let id = connection.remote_id().to_string();
        if hello.address.id != id { return Err("Endpoint identity mismatch".into()); }
        let mut config = self.config.lock();
        if !config.enabled { return Err("Instance link is disabled".into()); }
        hello.address.endpoint(&config.relay_url)?;
        if !config.peers.contains_key(&id) {
            if !initiated_pairing {
                let mut invitation = self.invitation.lock();
                let valid = invitation.as_ref().is_some_and(|entry| entry.expires > Instant::now()
                    && hello.pairing.as_deref() == Some(entry.token.as_str()));
                if !valid { return Err("Device is not paired, or pairing code expired".into()); }
                invitation.take();
            }
            if hello.version != VERSION { return Err(format!("Update Studio before pairing: {VERSION} / {}", hello.version)); }
            let mut updated = config.clone();
            updated.peers.insert(id.clone(), Peer { name: hello.name.clone(), address: hello.address.clone(), permissions: catalog::Permissions::default() });
            updated.save(&self.path)?;
            *config = updated;
        } else if let Some(peer) = config.peers.get_mut(&id) {
            // Gli indirizzi diretti cambiano con la rete, l'identita' resta la chiave QUIC.
            peer.address = hello.address.clone();
            peer.name = hello.name.clone();
            config.save(&self.path)?;
        }
        Ok(())
    }

    fn register(self: &Arc<Self>, connection: Connection, version: String, generation: u64, outgoing: bool) {
        let id = connection.remote_id().to_string();
        if generation != self.generation.load(Ordering::SeqCst) { connection.close(0u32.into(), b"obsolete"); return; }
        let canonical = outgoing == (self.id.as_str() < id.as_str());
        {
            let mut connections = self.connections.lock();
            if let Some(current) = connections.get(&id).filter(|entry| entry.connection.close_reason().is_none()) {
                if current.canonical || !canonical {
                    connection.close(0u32.into(), b"duplicate connection");
                    return;
                }
                current.connection.close(0u32.into(), b"preferred connection");
            }
            connections.insert(id.clone(), Connected { connection: connection.clone(), version, canonical });
        }
        self.changed();
        let watch_runtime = self.clone();
        let watch_connection = connection.clone();
        tauri::async_runtime::spawn(async move {
            let _ = watch_runtime.watch_peer_state(watch_connection).await;
        });
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok((send, recv)) = connection.accept_bi().await {
                let runtime = runtime.clone();
                let connection = connection.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = runtime.serve(&connection, send, recv, generation).await;
                });
            }
            runtime.changed();
        });
    }

    async fn accept(self: &Arc<Self>, connection: Connection, generation: u64) -> Result<(), String> {
        let (mut send, mut recv) = connection.accept_bi().await.map_err(|error| error.to_string())?;
        let hello: Hello = read_json(&mut recv).await?;
        if let Err(error) = self.authorize_hello(&connection, &hello, generation, false) {
            send_json(&mut send, &Reply::Error { error: json!(error) }).await?;
            let _ = send.finish();
            connection.close(1u32.into(), b"not authorized");
            return Err(error);
        }
        send_json(&mut send, &self.hello(None)?).await?;
        send.finish().map_err(|error| error.to_string())?;
        self.register(connection, hello.version, generation, false);
        Ok(())
    }

    async fn connect(self: &Arc<Self>, endpoint: &Endpoint, address: &Address, token: Option<String>, generation: u64) -> Result<(), String> {
        let relay = self.config.lock().relay_url.clone();
        let connection = endpoint.connect(address.endpoint(&relay)?, ALPN).await.map_err(|error| error.to_string())?;
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
        let pairing = token.is_some();
        send_json(&mut send, &self.hello(token)?).await?;
        send.finish().map_err(|error| error.to_string())?;
        let hello: Hello = read_json(&mut recv).await?;
        self.authorize_hello(&connection, &hello, generation, pairing)?;
        self.register(connection, hello.version, generation, true);
        Ok(())
    }

    fn live_connection(&self, id: &str) -> Option<Connection> {
        self.connections.lock().get(id).filter(|entry| entry.connection.close_reason().is_none()).map(|entry| entry.connection.clone())
    }

    fn authorize(&self, id: &str, command: &str, generation: u64) -> Result<&'static str, String> {
        if generation != self.generation.load(Ordering::SeqCst) { return Err("Obsolete connection".into()); }
        let config = self.config.lock();
        if !config.enabled { return Err("Instance link is disabled".into()); }
        let peer = config.peers.get(id).ok_or("Device pairing was revoked")?;
        let scope = peer.permissions.authorize(command)?;
        let compatible = self.connections.lock().get(id).is_some_and(|entry| entry.version == VERSION);
        if !compatible && !matches!(command, "get_studio_version" | "check_studio_update" | "start_studio_update" | "cancel_studio_update" | "install_studio_update_and_restart") {
            return Err(format!("Update Studio on {}: incompatible version", peer.name));
        }
        Ok(scope)
    }

    async fn serve(&self, connection: &Connection, mut send: iroh::endpoint::SendStream, mut recv: iroh::endpoint::RecvStream, generation: u64) -> Result<(), String> {
        if let Err(error) = self.serve_request(connection, &mut send, &mut recv, generation).await {
            send_json(&mut send, &Reply::Error { error: json!(error) }).await?;
        }
        send.finish().map_err(|error| error.to_string())
    }

    async fn serve_request(&self, connection: &Connection, send: &mut iroh::endpoint::SendStream, recv: &mut iroh::endpoint::RecvStream, generation: u64) -> Result<(), String> {
        let operation: Operation = tokio::time::timeout(CONNECT_TIMEOUT, read_json(recv)).await
            .map_err(|_| "Reading remote request timed out")??;
        let machine = connection.remote_id().to_string();
        match operation {
            Operation::Ping => {
                self.authorize(&machine, "get_studio_version", generation)?;
                send_json(send, &Reply::Pong).await?;
            }
            Operation::WatchState => {
                let _slot = self.stream_slots.try_acquire().map_err(|_| "Too many remote surfaces")?;
                self.serve_host_state(connection, send, generation).await?;
            }
            Operation::Open { command, args, consumer, session_id, after } => {
                let _slot = self.stream_slots.try_acquire().map_err(|_| "Too many remote surfaces")?;
                self.open_stream(connection, command, args, consumer, session_id, after, send, generation).await?;
            }
            Operation::Invoke { command, mut headers, body_len, raw, consumer } => {
                let _slot = self.requests.acquire().await.map_err(|_| "Remote command service is closed")?;
                let scope = self.authorize(&machine, &command, generation)?;
                let body = tokio::time::timeout(CONNECT_TIMEOUT, read_body(recv, body_len)).await
                    .map_err(|_| "Reading remote request body timed out")??;
                let body = if raw { InvokeBody::Raw(body) } else {
                    InvokeBody::Json(serde_json::from_slice(&body).map_err(|error| error.to_string())?)
                };
                if command != "link_host_action" {
                    let restricted = {
                        let config = self.config.lock();
                        let permissions = config.peers.get(&machine).ok_or("Device pairing was revoked")?.permissions;
                        !permissions.agents && !permissions.files && !permissions.terminal
                    };
                    if restricted {
                        if let InvokeBody::Json(args) = &body {
                            self.roots.read().authorize(&command, args)?;
                        }
                    }
                }
                // I canali di streaming hanno un protocollo dedicato: non si
                // trasformano mai in Channel della WebView della macchina host.
                if scope == "stream" { return Err("Streaming command requires a stream subscription".into()); }
                self.authorize(&machine, &command, generation)?;
                headers.insert("x-studio-authenticated-peer".into(), machine.clone());
                let name = self.config.lock().peers.get(&machine).ok_or("Device pairing was revoked")?.name.clone();
                crate::studio_log::info("link", format!("{name}: {command}"));
                let response = if matches!(command.as_str(), "rpc_close" | "pty_close" | "pty_resize") {
                    let token = consumer.ok_or("Surface subscription is missing")?;
                    let owner = format!("link:{}:{token}", connection.remote_id());
                    let InvokeBody::Json(args) = body else { return Err("Invalid surface command body".into()); };
                    let result = match command.as_str() {
                        "rpc_close" => {
                            let id = args.get("rpcId").and_then(Value::as_u64).ok_or("Missing RPC id")?;
                            crate::rpc::close_session(&self.app.state::<crate::rpc::RpcManager>(), id, &owner,
                                args.get("replacing").and_then(Value::as_bool).unwrap_or(false)).await
                        }
                        "pty_close" => {
                            let id = args.get("ptyId").and_then(Value::as_u64).ok_or("Missing terminal id")?;
                            crate::pty::close_session(&self.app.state::<crate::pty::PtyManager>(), id, &owner).await
                        }
                        _ => {
                            let id = args.get("ptyId").and_then(Value::as_u64).ok_or("Missing terminal id")?;
                            let dimension = |key| args.get(key).and_then(Value::as_u64)
                                .and_then(|value| u16::try_from(value).ok()).filter(|value| *value != 0)
                                .ok_or_else(|| "Invalid terminal dimensions".to_string());
                            crate::pty::resize_session(&self.app.state::<crate::pty::PtyManager>(), id, &owner,
                                dimension("cols")?, dimension("rows")?)
                        }
                    };
                    InvokeResponse::from(result)
                } else {
                    tokio::time::timeout(REQUEST_TIMEOUT, dispatch(&self.app, command, body, headers)).await
                        .map_err(|_| "Host command timed out")??
                };
                match response {
                    InvokeResponse::Ok(InvokeResponseBody::Json(value)) => {
                        if value.len() > MAX_BODY { return Err("Link response exceeds limit".into()); }
                        send_json(send, &Reply::Json { len: value.len() }).await?;
                        send.write_all(value.as_bytes()).await.map_err(|error| error.to_string())?;
                    }
                    InvokeResponse::Ok(InvokeResponseBody::Raw(bytes)) => {
                        if bytes.len() > MAX_BODY { return Err("Link response exceeds limit".into()); }
                        send_json(send, &Reply::Raw { len: bytes.len() }).await?;
                        send.write_all(&bytes).await.map_err(|error| error.to_string())?;
                    }
                    InvokeResponse::Err(error) => send_json(send, &Reply::Error { error: error.0 }).await?,
                }
            }
        }
        Ok(())
    }

    async fn invoke(&self, machine: &str, window: &str, command: String, body: Vec<u8>, raw: bool, headers: HashMap<String, String>) -> Result<Response, Value> {
        if body.len() > MAX_BODY { return Err(json!("Link body exceeds limit")); }
        let consumer = if matches!(command.as_str(), "rpc_close" | "pty_close" | "pty_resize") {
            let args: Value = serde_json::from_slice(&body).map_err(|error| json!(error.to_string()))?;
            let id = args.get(if command == "rpc_close" { "rpcId" } else { "ptyId" }).and_then(Value::as_u64)
                .ok_or_else(|| json!("Missing surface id"))?;
            let streams = self.streams.lock();
            let subscription = streams.values().find(|stream| stream.machine == machine && stream.window == window
                && stream.id.load(Ordering::SeqCst) == id
                && ((command == "rpc_close") != (stream.command == "pty_open")))
                .ok_or_else(|| json!("Surface subscription is unavailable"))?;
            let token = subscription.token.lock().clone();
            if command != "pty_resize" { subscription.close(); }
            Some(token)
        } else { None };
        let connection = self.live_connection(machine).ok_or_else(|| json!("Machine is unreachable"))?;
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| json!(error.to_string()))?;
        send_json(&mut send, &Operation::Invoke { command, headers, body_len: body.len(), raw, consumer }).await.map_err(Value::String)?;
        send.write_all(&body).await.map_err(|error| json!(error.to_string()))?;
        send.finish().map_err(|error| json!(error.to_string()))?;
        match read_json(&mut recv).await.map_err(Value::String)? {
            Reply::Json { len } => {
                let bytes = read_body(&mut recv, len).await.map_err(Value::String)?;
                let value = String::from_utf8(bytes).map_err(|error| json!(error.to_string()))?;
                Ok(Response::new(InvokeResponseBody::Json(value)))
            }
            Reply::Raw { len } => Ok(Response::new(read_body(&mut recv, len).await.map_err(Value::String)?)),
            Reply::Error { error } => Err(error),
            _ => Err(json!("Unexpected remote command response")),
        }
    }
}

/// Risposta di un comando chiesto da Rust a un'altra macchina.
pub(crate) enum PeerBody {
    Json(Value),
    Raw(Vec<u8>),
}

/// Chiede un comando del catalogo a una macchina abbinata senza passare dalla
/// WebView: la sincronizzazione delle copie (R-MI-26) sposta pacchetti git
/// fino a decine di MB, che non devono attraversare due volte il ponte IPC.
/// L'altra macchina applica gli stessi permessi di una richiesta della finestra.
pub(crate) async fn call_peer(app: &tauri::AppHandle, machine: &str, command: &str, args: &Value) -> Result<PeerBody, String> {
    let runtime = app.state::<LinkManager>().runtime(app).await?;
    let body = serde_json::to_vec(args).map_err(|error| error.to_string())?;
    if body.len() > MAX_BODY { return Err("Link body exceeds limit".into()); }
    let request = async {
        let connection = runtime.live_connection(machine).ok_or("Machine is unreachable")?;
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
        send_json(&mut send, &Operation::Invoke {
            command: command.to_owned(), headers: HashMap::new(), body_len: body.len(), raw: false, consumer: None,
        }).await?;
        send.write_all(&body).await.map_err(|error| error.to_string())?;
        send.finish().map_err(|error| error.to_string())?;
        match read_json(&mut recv).await? {
            Reply::Json { len } => serde_json::from_slice(&read_body(&mut recv, len).await?)
                .map(PeerBody::Json).map_err(|error| error.to_string()),
            Reply::Raw { len } => Ok(PeerBody::Raw(read_body(&mut recv, len).await?)),
            Reply::Error { error } => Err(error.as_str().map(str::to_owned).unwrap_or_else(|| error.to_string())),
            _ => Err("Unexpected remote command response".to_string()),
        }
    };
    tokio::time::timeout(REQUEST_TIMEOUT, request).await.map_err(|_| "Remote command timed out".to_string())?
}

async fn dispatch(app: &tauri::AppHandle, command: String, body: InvokeBody, headers: HashMap<String, String>) -> Result<InvokeResponse, String> {
    let window = app.get_webview_window("main").ok_or("Host Studio window is unavailable")?;
    let webview: &tauri::Webview = window.as_ref();
    let webview = webview.clone();
    let url = webview.url().map_err(|error| error.to_string())?;
    let mut request_headers = tauri::http::HeaderMap::new();
    for (name, value) in headers {
        let name = tauri::http::header::HeaderName::from_bytes(name.as_bytes()).map_err(|error| error.to_string())?;
        let value = tauri::http::header::HeaderValue::from_str(&value).map_err(|error| error.to_string())?;
        request_headers.insert(name, value);
    }
    let request = tauri::webview::InvokeRequest { cmd: command, callback: CallbackFn(0), error: CallbackFn(0),
        url, body, headers: request_headers, invoke_key: app.invoke_key().to_owned() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview.on_message(request, Box::new(move |_, _, response, _, _| { let _ = tx.send(response); }));
    rx.await.map_err(|_| "Host command response was interrupted".to_owned())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingCode { protocol: u32, address: Address, token: String }

#[tauri::command]
pub(crate) async fn link_status(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    manager.runtime(&app).await?.status()
}

/// Corsie occupate da sessioni aperte su un'altra macchina (R-MI-18).
///
/// La finestra del proprietario non ha queste sessioni in `sessionRegistry`
/// (vivono nel backend), quindi senza questo riepilogo le vedeva ferme e la
/// coda poteva avviare un secondo lavoro sopra il primo. Il numero di
/// revisione è il seme con cui la finestra scarta un riepilogo arrivato in
/// ritardo, come fa con le generazioni di sessione.
#[tauri::command]
pub(crate) async fn link_activity(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<activity::LinkActivitySnapshot, String> {
    let runtime = manager.runtime(&app).await?;
    Ok(activity::LinkActivitySnapshot {
        revision: runtime.activity.revision(),
        lanes: runtime.activity.snapshot(),
    })
}

#[tauri::command]
pub(crate) async fn link_configure(app: tauri::AppHandle, enabled: bool, name: String, relay_url: String, relay_token: Option<String>, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let _configuration = manager.configuration_gate.lock().await;
    let runtime = manager.runtime(&app).await?;
    let relay_url = if enabled || !relay_url.trim().is_empty() { config::validate_relay(&relay_url)? } else { String::new() };
    let name = name.trim();
    if name.is_empty() || name.len() > 128 { return Err("Machine name must contain 1–128 bytes".into()); }
    {
        let mut config = runtime.config.lock();
        let mut updated = config.clone();
        updated.enabled = enabled; updated.name = name.into(); updated.relay_url = relay_url;
        if let Some(token) = relay_token { updated.relay_token = token; }
        updated.save(&runtime.path)?;
        *config = updated;
    }
    runtime.stop().await;
    runtime.start().await?;
    runtime.changed();
    runtime.status()
}

#[tauri::command]
pub(crate) async fn link_pairing_code(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<String, String> {
    let runtime = manager.runtime(&app).await?;
    let hello = runtime.hello(None)?;
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let code = PairingCode { protocol: PROTOCOL, address: hello.address, token: token.clone() };
    *runtime.invitation.lock() = Some(Invitation { token, expires: Instant::now() + Duration::from_secs(300) });
    Ok(format!("studio1:{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&code).map_err(|error| error.to_string())?)))
}

#[tauri::command]
pub(crate) async fn link_pair(app: tauri::AppHandle, code: String, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    if code.len() > 16384 { return Err("Pairing code is too long".into()); }
    let code = code.trim().strip_prefix("studio1:").ok_or("Invalid pairing code")?;
    let code: PairingCode = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(code).map_err(|_| "Invalid pairing code")?).map_err(|_| "Invalid pairing code")?;
    if code.protocol != PROTOCOL { return Err("Incompatible pairing code".into()); }
    let runtime = manager.runtime(&app).await?;
    let endpoint = runtime.endpoint.lock().clone().ok_or("Enable instance control first")?;
    if code.address.id == endpoint.id().to_string() { return Err("Cannot pair Studio with itself".into()); }
    let generation = runtime.generation.load(Ordering::SeqCst);
    tokio::time::timeout(CONNECT_TIMEOUT, runtime.connect(&endpoint, &code.address, Some(code.token), generation)).await
        .map_err(|_| "Pairing timed out")??;
    runtime.status()
}

#[tauri::command]
pub(crate) async fn link_permissions(app: tauri::AppHandle, machine: String, permissions: catalog::Permissions, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let runtime = manager.runtime(&app).await?;
    {
        let mut config = runtime.config.lock();
        let mut updated = config.clone();
        updated.peers.get_mut(&machine).ok_or("Unknown machine")?.permissions = permissions;
        updated.save(&runtime.path)?;
        *config = updated;
    }
    if let Some(connected) = runtime.connections.lock().remove(&machine) {
        connected.connection.close(0u32.into(), b"permissions changed");
    }
    runtime.changed();
    runtime.status()
}

#[tauri::command]
pub(crate) async fn link_revoke(app: tauri::AppHandle, machine: String, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let runtime = manager.runtime(&app).await?;
    {
        let mut config = runtime.config.lock();
        let mut updated = config.clone();
        updated.peers.remove(&machine);
        updated.save(&runtime.path)?;
        *config = updated;
    }
    if let Some(connected) = runtime.connections.lock().remove(&machine) { connected.connection.close(1u32.into(), b"pairing revoked"); }
    runtime.peer_states.lock().remove(&machine);
    runtime.changed();
    runtime.status()
}

#[tauri::command]
pub(crate) async fn link_invoke(app: tauri::AppHandle, webview: tauri::Webview, request: Request<'_>, manager: tauri::State<'_, LinkManager>) -> Result<Response, Value> {
    let (machine, command, body, raw, headers) = match request.body() {
        InvokeBody::Json(envelope) => {
            let machine = envelope.get("machine").and_then(Value::as_str).ok_or_else(|| json!("Missing target machine"))?.to_owned();
            let command = envelope.get("command").and_then(Value::as_str).ok_or_else(|| json!("Missing command"))?.to_owned();
            let body = serde_json::to_vec(envelope.get("args").unwrap_or(&json!({}))).map_err(|error| json!(error.to_string()))?;
            let headers: HashMap<String, String> = serde_json::from_value(envelope.get("headers").cloned().unwrap_or(json!({}))).map_err(|error| json!(error.to_string()))?;
            (machine, command, body, false, headers)
        }
        InvokeBody::Raw(bytes) => {
            let header = |name| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or_else(|| json!("Missing link routing header"));
            let machine = header("x-studio-machine")?;
            let command = header("x-studio-command")?;
            let headers = request.headers().iter().filter(|(name, _)| !matches!(name.as_str(), "x-studio-machine" | "x-studio-command"))
                .map(|(name, value)| Ok((name.to_string(), value.to_str().map_err(|error| json!(error.to_string()))?.to_owned())))
                .collect::<Result<HashMap<_, _>, Value>>()?;
            (machine, command, bytes.clone(), true, headers)
        }
    };
    let runtime = manager.runtime(&app).await.map_err(Value::String)?;
    tokio::time::timeout(REQUEST_TIMEOUT, runtime.invoke(&machine, webview.label(), command, body, raw, headers)).await
        .map_err(|_| json!("Remote command timed out"))?
}

pub(crate) fn initialize(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = app.state::<LinkManager>().runtime(&app).await {
            crate::studio_log::info("link", format!("Collegamento fra istanze non avviato: {error}"));
        }
    });
}
