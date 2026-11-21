//! Collegamento nativo fra istanze: relay proprio, identita' persistenti e ACL.
mod audit;
pub(crate) mod exec;
pub(crate) mod forward;
pub(crate) mod omp_settings;
mod catalog;
mod config;
mod protocol;
mod access;
mod activity;
mod relay;
pub(crate) mod streams;
pub(crate) mod host;

use std::{collections::HashMap, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant, SystemTime}};
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
/// Giro del battito che tiene accese le connessioni e chiude i peer morti.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
/// Oltre questo tempo un Ping senza risposta conta come fallito. Largo: su un
/// relay occupato da un pacchetto git grande la risposta puo' tardare, e
/// chiudere la connessione interromperebbe proprio quel trasferimento.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
/// Fallimenti consecutivi che chiudono la connessione: un peer spento risulta
/// offline entro circa un minuto, uno lento non viene staccato per un picco.
const HEARTBEAT_MAX_FAILURES: u8 = 3;
/// Frequenza del controllo di raggiungibilita' del relay (R-MI-30): ogni 30 s
/// quando il collegamento e' acceso, e a ogni cambio di stato della config.
const RELAY_CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// Versione stabile di confronto: `major.minor.patch` senza suffissi prerelease.
///
/// Le nightly restano sullo stesso codice e differiscono solo per il numero di
/// build: `1.10.1-nightly.1794865373032` e `1.10.1-nightly.1795999999999` sono
/// la stessa build logica e devono potersi collegare (R-MI-10). Confrontare la
/// stringa intera le farebbe sembrare incompatibili e le due finestre si
/// bloccherebbero a vicenda senza motivo. Il cambio di protocollo resta il
/// vero spartiacque: `PROTOCOL` coincide e la base stabile coincide.
fn stable_version(version: &str) -> &str {
    match version.split_once('-') {
        Some((base, _suffix)) => base,
        None => version,
    }
}

/// Due istanze si capiscono se il protocollo coincide e la base stabile
/// (major.minor.patch) coincide. Il campo `protocol` e' gia' nell'hello.
fn versions_compatible(a: &str, b: &str) -> bool {
    stable_version(a) == stable_version(b)
}

/// Comandi ammessi anche verso una macchina con versione incompatibile:
/// servono ad aggiornarla (R-MI-10, R-MI-38). Stesso elenco di
/// `UPDATE_COMMANDS` in `src/lib/backend/ipc.ts`. Il download e l'installazione
/// partono soltanto sulla macchina che ha verificato la release.
const UPDATE_COMMANDS: &[&str] = &[
    "get_studio_version", "check_studio_update", "studio_update_remote_start",
    "studio_update_remote_status",
];

/// Conta un fallimento del battito per un peer e dice se la connessione va
/// chiusa (`HEARTBEAT_MAX_FAILURES` di fila). Separata da `Runtime` per
/// essere provata senza rete; il successo azzera il contatore.
fn register_heartbeat_failure(failures: &mut HashMap<String, u8>, peer: &str) -> bool {
    let count = failures.entry(peer.to_owned()).and_modify(|count| *count = count.saturating_add(1)).or_insert(1);
    if *count >= HEARTBEAT_MAX_FAILURES {
        failures.remove(peer);
        true
    } else {
        false
    }
}

/// Millisecondi epoch correnti; `0` se l'orologio e' precedente all'epoch
/// (impossibile in pratica, ma mai fallire l'hello per questo).
pub(crate) fn epoch_ms() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64).unwrap_or(0)
}

#[derive(Default)]
pub(crate) struct LinkManager {
    runtime: tokio::sync::Mutex<Option<Arc<Runtime>>>,
    configuration_gate: tokio::sync::Mutex<()>,
    /// Chiave della macchina sparita dal portachiavi (R-MI-43): lo stato lo
    /// dice alla finestra invece di un errore generico.
    key_missing: std::sync::atomic::AtomicBool,
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
    /// Ultimo esito del controllo di raggiungibilita' del relay (R-MI-30).
    /// `None` finche' non c'e' stato un controllo (es. collegamento spento).
    relay_reachable: Mutex<Option<bool>>,
    relay_check: tokio::sync::Notify,
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
    /// Esito del controllo di raggiungibilita' del relay (R-MI-30): `null`
    /// finche' non c'e' stato un controllo, poi `true`/`false`.
    relay_reachable: Option<bool>,
    peers: Vec<PeerStatus>,
    /// La chiave della macchina non c'e' piu' nel portachiavi (R-MI-43).
    key_missing: bool,
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
    last_seen: Option<u64>,
}

impl LinkManager {
    async fn runtime(&self, app: &tauri::AppHandle) -> Result<Arc<Runtime>, String> {
        let mut guard = self.runtime.lock().await;
        if let Some(runtime) = guard.as_ref() { return Ok(runtime.clone()); }
        let path = config::path(app)?;
        let config = match Config::load(&path) {
            Ok(config) => { self.key_missing.store(false, Ordering::SeqCst); config }
            Err(error) => {
                self.key_missing.store(config::key_missing(&path), Ordering::SeqCst);
                return Err(error);
            }
        };
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
            relay_reachable: Mutex::new(None),
            relay_check: tokio::sync::Notify::new(),
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
                online: connected.is_some(), compatible: connected.is_none_or(|entry| versions_compatible(&entry.version, VERSION)),
                version: connected.map(|entry| entry.version.clone()), route, latency_ms,
                last_seen: peer.last_seen,
            }
        }).collect();
        Ok(LinkStatus { enabled: config.enabled, name: config.name.clone(), machine_id: self.id.clone(),
            platform: std::env::consts::OS,
            relay_url: config.relay_url.clone(), has_relay_token: !config.relay_token.is_empty(),
            relay_reachable: *self.relay_reachable.lock(), peers, key_missing: false })
    }

    fn changed(&self) {
        if let Ok(status) = self.status() { let _ = self.app.emit("link:status", &status); }
    }

    async fn start(self: &Arc<Self>) -> Result<(), String> {
        let (enabled, relay_url, token, secret) = {
            let config = self.config.lock();
            (config.enabled, config.relay_url.clone(), config.relay_token.clone(), config.secret()?)
        };
        if !enabled {
            // Collegamento spento: nessun relay da verificare (R-MI-30).
            *self.relay_reachable.lock() = None;
            return Ok(());
        }
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
        // Raggiungibilita' del relay (R-MI-30): un controllo subito all'avvio
        // e poi ogni RELAY_CHECK_INTERVAL. L'esito e' nello stato e la
        // WebView lo legge con `link_status`; cambiamenti intermedi arrivano
        // con `link:status` da `changed()`.
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let client = reqwest::Client::new();
            loop {
                if runtime.generation.load(Ordering::SeqCst) != generation { break; }
                let url = runtime.config.lock().relay_url.clone();
                let reached = relay::relay_reachable(&client, &url).await;
                if runtime.generation.load(Ordering::SeqCst) != generation { break; }
                *runtime.relay_reachable.lock() = reached;
                runtime.changed();
                tokio::select! {
                    _ = tokio::time::sleep(RELAY_CHECK_INTERVAL) => {},
                    _ = runtime.relay_check.notified() => {},
                }
            }
        });
        // Battito verso i peer collegati: un Ping ogni HEARTBEAT_INTERVAL,
        // HEARTBEAT_TIMEOUT per la risposta, due fallimenti di fila chiudono
        // la connessione cosi' `link:status` passa offline in pochi secondi
        // invece di aspettare i timeout di iroh.
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut failures: HashMap<String, u8> = HashMap::new();
            loop {
                if runtime.generation.load(Ordering::SeqCst) != generation { break; }
                tokio::time::sleep(HEARTBEAT_INTERVAL).await;
                if runtime.generation.load(Ordering::SeqCst) != generation { break; }
                let connected: Vec<Connection> = runtime.connections.lock()
                    .values().filter(|entry| entry.connection.close_reason().is_none())
                    .map(|entry| entry.connection.clone()).collect();
                for connection in connected {
                    let peer = connection.remote_id().to_string();
                    let ping = async {
                        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
                        send_json(&mut send, &Operation::Ping).await?;
                        send.finish().map_err(|error| error.to_string())?;
                        match read_json::<Reply>(&mut recv).await? {
                            Reply::Pong => Ok(()),
                            Reply::Error { error } => Err(format!("Ping refused: {error}")),
                            _ => Err("Unexpected ping reply".into()),
                        }
                    };
                    match tokio::time::timeout(HEARTBEAT_TIMEOUT, ping).await {
                        Ok(Ok(())) => {
                            failures.remove(&peer);
                            // Un minuto basta per datare il contatto senza
                            // riscrivere il config a ogni battito.
                            let _ = runtime.touch_peer(&peer);
                        }
                        _ => runtime.note_heartbeat_failure(&mut failures, &peer, &connection),
                    }
                }
            }
        });
        Ok(())
    }

    /// Registra un fallimento del battito e chiude la connessione al secondo
    /// consecutivo: a quel punto il giro di riconnessione la ristabilisce
    /// rapidamente, ma `link:status` smette di mostrare online un peer morto.
    fn note_heartbeat_failure(&self, failures: &mut HashMap<String, u8>, peer: &str, connection: &Connection) {
        if register_heartbeat_failure(failures, peer) {
            connection.close(0u32.into(), b"heartbeat timeout");
            self.changed();
        }
    }

    async fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.relay_check.notify_one();
        *self.relay_reachable.lock() = None;
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
        let now = epoch_ms();
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
            if !versions_compatible(&hello.version, VERSION) { return Err(format!("Update Studio before pairing: {VERSION} / {}", hello.version)); }
            let mut updated = config.clone();
            updated.peers.insert(id.clone(), Peer { name: hello.name.clone(), address: hello.address.clone(), permissions: catalog::Permissions::default(), last_seen: Some(now) });
            updated.save(&self.path)?;
            *config = updated;
        } else if let Some(peer) = config.peers.get_mut(&id) {
            // Gli indirizzi diretti cambiano con la rete, l'identita' resta la chiave QUIC.
            peer.address = hello.address.clone();
            peer.name = hello.name.clone();
            peer.last_seen = Some(now);
            config.save(&self.path)?;
        }
        Ok(())
    }

    /// Il battito persiste al massimo una volta al minuto per peer.
    fn touch_peer(&self, id: &str) -> Result<(), String> {
        let now = epoch_ms();
        let mut config = self.config.lock();
        let Some(peer) = config.peers.get(id) else { return Ok(()); };
        if peer.last_seen.is_some_and(|last| now.saturating_sub(last) < 60_000) { return Ok(()); }
        let mut updated = config.clone();
        if let Some(peer) = updated.peers.get_mut(id) { peer.last_seen = Some(now); }
        updated.save(&self.path)?;
        *config = updated;
        Ok(())
    }

    /// Regola pura della revoca propagata (R-MI-34): chi riceve accetta solo
    /// da un peer abbinato, non revoca se stesso ne' il mittente. Separata
    /// per essere provata senza rete ne' stato.
    fn accept_propagated_revoke(from_peer: &str, self_id: &str, target: &str, from_is_paired: bool) -> bool {
        from_is_paired && target != self_id && target != from_peer
    }

    /// Revoca un peer applicando la regola, anche quando l'operazione arriva
    /// da un'altra macchina abbinata.
    fn propagated_revoke(&self, from_peer: &str, target: &str) -> Result<(), String> {
        let mut config = self.config.lock();
        // Solo una macchina con Agenti o Terminale (che equivale gia' a una
        // shell, R-MI-09) puo' far revocare altre macchine: con la sola Lettura
        // un portatile rubato staccherebbe fra loro tutte le altre.
        let paired = config.enabled && config.peers.get(from_peer)
            .is_some_and(|peer| !peer.permissions.confines_paths());
        if !Self::accept_propagated_revoke(from_peer, &self.id, target, paired) {
            return Err(crate::tr!("Revoca propagata non consentita", "Propagated revocation is not allowed").into());
        }
        {
            let mut updated = config.clone();
            updated.peers.remove(target);
            updated.save(&self.path)?;
            *config = updated;
        }
        drop(config);
        if let Some(connected) = self.connections.lock().remove(target) {
            connected.connection.close(1u32.into(), b"pairing revoked");
        }
        self.peer_states.lock().remove(target);
        self.changed();
        Ok(())
    }

    /// La propagazione precede la revoca locale. Le macchine spente non
    /// ricevono la richiesta; i fallimenti in linea sono riferiti alla UI.
    async fn revoke(&self, machine: &str, everywhere: bool) -> Result<(), String> {
        let mut failed = Vec::new();
        if everywhere {
            let connections: Vec<Connection> = self.connections.lock()
                .values().filter(|entry| entry.connection.close_reason().is_none())
                .map(|entry| entry.connection.clone()).collect();
            for connection in connections {
                let peer = connection.remote_id().to_string();
                if peer == machine { continue; }
                let send = async {
                    let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
                    send_json(&mut send, &Operation::Revoke { id: machine.to_owned() }).await?;
                    send.finish().map_err(|error| error.to_string())?;
                    match read_json::<Reply>(&mut recv).await? {
                        Reply::Pong => Ok(()),
                        Reply::Error { error } => Err(format!("Propagation refused: {error}")),
                        _ => Err("Unexpected propagation reply".into()),
                    }
                };
                if let Err(error) = tokio::time::timeout(CONNECT_TIMEOUT, send).await.unwrap_or(Err("Propagation timed out".into())) {
                    failed.push(format!("{peer}: {error}"));
                }
            }
        }
        {
            let mut config = self.config.lock();
            let mut updated = config.clone();
            updated.peers.remove(machine);
            updated.save(&self.path)?;
            *config = updated;
        }
        if let Some(connected) = self.connections.lock().remove(machine) {
            connected.connection.close(1u32.into(), b"pairing revoked");
        }
        self.peer_states.lock().remove(machine);
        if !failed.is_empty() {
            return Err(crate::tr!(
                format!("Revoca locale completata, ma non su tutte le macchine: {}", failed.join("; ")),
                format!("Local revocation completed, but not on all machines: {}", failed.join("; "))
            ));
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
        self.relay_check.notify_one();
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
            runtime.relay_check.notify_one();
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

    /// Ambito del comando secondo i permessi del peer, senza il controllo di
    /// versione: serve a `serve_request`, che valida la versione solo per i
    /// comandi effettivamente instradati e lascia passare lo snapshot ridotto
    /// di una macchina da aggiornare (R-MI-10).
    fn authorize_scope(&self, id: &str, command: &str) -> Result<&'static str, String> {
        let config = self.config.lock();
        if !config.enabled { return Err("Instance link is disabled".into()); }
        let peer = config.peers.get(id).ok_or("Device pairing was revoked")?;
        peer.permissions.authorize(command)
    }

    fn authorize(&self, id: &str, command: &str, generation: u64) -> Result<&'static str, String> {
        if generation != self.generation.load(Ordering::SeqCst) { return Err("Obsolete connection".into()); }
        let scope = self.authorize_scope(id, command)?;
        let compatible = self.connections.lock().get(id).is_some_and(|entry| versions_compatible(&entry.version, VERSION));
        if !compatible && !UPDATE_COMMANDS.contains(&command) {
            let name = self.config.lock().peers.get(id).map(|peer| peer.name.clone()).unwrap_or_default();
            return Err(format!("Update Studio on {name}: incompatible version"));
        }
        Ok(scope)
    }

    /// Confinamento dei percorsi delle azioni host (M11): `link_host_action`
    /// gira nella finestra del proprietario, ma `projectPath`/`projectId`/
    /// `path` arrivano dal peer e qui vengono validati prima di emettere
    /// `link:command`. I percorsi espliciti si confinano alle radici
    /// dichiarate; gli id di progetto devono esistere fra i progetti noti
    /// all'host (quelli pubblicati nello snapshot, R-MI-04).
    fn authorize_host_action(&self, command: &Value) -> Result<(), String> {
        // Il comando arriva come `link_host_action` con il corpo
        // `{ "command": { "kind": ... } }`: la forma diretta della WebView e'
        // il solo oggetto RemoteCommand, quella instradata lo avvolge nel
        // campo `command`.
        let command = command.get("command").unwrap_or(command);
        let kind = command.get("kind").and_then(Value::as_str).ok_or("Missing host action kind")?;
        let roots = self.roots.read();
        match kind {
            // Percorso esplicito di una copia: deve stare nelle radici
            // dichiarate dell'host, come qualunque altra lettura/scrittura.
            "read_queue" | "write_queue" => self.check_host_path(&roots, command, "projectPath", kind),
            // `open_project` non si confina: richiede Agenti, cioe' una shell
            // sulla macchina, e i progetti noti ma chiusi possono stare fuori
            // dalla radice dei progetti (R-MI-04).
            // Id locale all'host: deve essere un progetto noto a questa
            // macchina, non un id arbitrario inventato dal peer.
            "lane_action" | "set_auto_dispatch" | "close_project" => {
                let id = command.get("projectId").and_then(Value::as_str).unwrap_or("");
                self.require_known_project(id)
            }
            // `create_project` prende `name`, non un percorso: il frontend
            // crea sempre sotto la radice dei progetti dell'host.
            "create_project" => Ok(()),
            // Le altre azioni (agenti) riguardano un progetto aperto: se
            // portano un `projectId` deve essere noto a questa macchina.
            _ => {
                if let Some(id) = command.get("projectId").and_then(Value::as_str) {
                    self.require_known_project(id)?;
                }
                Ok(())
            }
        }
    }

    fn check_host_path(&self, roots: &access::Roots, command: &Value, key: &str, kind: &str) -> Result<(), String> {
        let path = command.get(key).and_then(Value::as_str).filter(|path| !path.is_empty())
            .ok_or_else(|| format!("Missing {key} in {kind}"))?;
        roots.authorize(&format!("host_action:{kind}"), &json!({ key: path }))
    }

    /// `projectId` di un'azione host deve corrispondere a un progetto che
    /// questa macchina conosce. L'elenco e' quello che la finestra del
    /// proprietario pubblica nello snapshot: il peer conosce gli id solo
    /// perche' glieli ha dati lo snapshot, quindi se non c'e' piu' il
    /// progetto non e' piu' utilizzabile.
    fn require_known_project(&self, id: &str) -> Result<(), String> {
        if id.is_empty() { return Err("Missing project id".into()); }
        let Some(snapshot) = self.snapshot.borrow().clone() else {
            return Err("Host window has not published its projects yet".into());
        };
        let parsed: Value = serde_json::from_str(&snapshot).map_err(|error| error.to_string())?;
        let known = parsed.get("projects").and_then(Value::as_array).is_some_and(|projects| {
            projects.iter().any(|project| project.get("id").and_then(Value::as_str) == Some(id))
        });
        if known { Ok(()) } else { Err(format!("Unknown project on this machine: {id}")) }
    }

    /// Registra un'azione di un peer che cambia qualcosa o esegue
    /// (R-MI-39). `permission` e' l'ambito del comando: le letture non
    /// entrano nel registro.
    fn audit(&self, machine: &str, permission: &str, action: &str, args: &Value) {
        if matches!(permission, "read" | "local") || audit::is_noise(action) { return; }
        let Some(machine_name) = self.config.lock().peers.get(machine).map(|peer| peer.name.clone()) else { return };
        let snapshot = self.snapshot.borrow().clone()
            .and_then(|snapshot| serde_json::from_str::<Value>(&snapshot).ok());
        let (project_id, project_name) = audit::resolve_project(snapshot.as_ref(), args);
        audit::record(&self.app, audit::Entry {
            at: epoch_ms(), machine_id: machine.to_owned(), machine_name, action: action.to_owned(), project_id, project_name,
        });
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
                // Il battito verifica solo che la connessione sia viva.
                // `get_studio_version` e' esente dal controllo di versione,
                // quindi anche un peer incompatibile risponde e la finestra
                // continua a mostrare «aggiorna Studio» (R-MI-10).
                self.authorize(&machine, "get_studio_version", generation)?;
                send_json(send, &Reply::Pong).await?;
            }
            Operation::Revoke { id } => {
                // Revoca propagata (R-MI-34): si accetta solo da un peer
                // abbinato (non si arriva qui altrimenti, `authorize` lo
                // controlla), mai il proprio id ne' quello del mittente.
                self.authorize(&machine, "get_studio_version", generation)?;
                self.propagated_revoke(&machine, &id)?;
                self.audit(&machine, "agents", "revoke", &json!({}));
                send_json(send, &Reply::Pong).await?;
            }
            Operation::WatchState => {
                let _slot = self.stream_slots.try_acquire().map_err(|_| "Too many remote surfaces")?;
                self.serve_host_state(connection, send, generation).await?;
            }
            Operation::Forward { port, project, probe } => {
                let _slot = self.stream_slots.try_acquire().map_err(|_| "Too many remote surfaces")?;
                self.serve_forward(&machine, port, &project, probe, generation, (send, recv)).await?;
            }
            Operation::Open { command, args, consumer, session_id, after } => {
                let _slot = self.stream_slots.try_acquire().map_err(|_| "Too many remote surfaces")?;
                self.open_stream(connection, command, args, consumer, session_id, after, send, generation).await?;
            }
            Operation::Invoke { command, mut headers, body_len, raw, consumer } => {
                let _slot = self.requests.acquire().await.map_err(|_| "Remote command service is closed")?;
                // L'ambito si decide subito: un comando sconosciuto o non
                // permesso non deve nemmeno leggere il corpo. La versione si
                // controlla dopo, solo per i comandi che verranno davvero
                // eseguiti: lo snapshot ridotto di una macchina da aggiornare
                // deve arrivare comunque (R-MI-10).
                let scope = self.authorize_scope(&machine, &command)?;
                let body = tokio::time::timeout(CONNECT_TIMEOUT, read_body(recv, body_len)).await
                    .map_err(|_| "Reading remote request body timed out")??;
                let body = if raw { InvokeBody::Raw(body) } else {
                    InvokeBody::Json(serde_json::from_slice(&body).map_err(|error| error.to_string())?)
                };
                // Confinamento dei percorsi (A5): solo per i peer senza Agenti
                // ne' Terminale, e allora per ogni comando (vedi
                // `Permissions::confines_paths`).
                let confined = self.config.lock().peers.get(&machine)
                    .ok_or("Device pairing was revoked")?.permissions.confines_paths();
                if confined {
                    if let InvokeBody::Json(args) = &body {
                        self.roots.read().authorize(&command, args)?;
                    }
                }
                // Le azioni host girano nella finestra del proprietario ma
                // prendono `projectPath`/`projectId`/`path` dal peer (M11):
                // qui si validano contro le radici e i progetti noti
                // all'host, prima che il frontend le esegua.
                if command == "link_host_action" {
                    if let InvokeBody::Json(args) = &body {
                        self.authorize_host_action(args)?;
                    }
                }
                // I canali di streaming hanno un protocollo dedicato: non si
                // trasformano mai in Channel della WebView della macchina host.
                if scope == "stream" { return Err("Streaming command requires a stream subscription".into()); }
                // Il controllo di versione resta qui: l'esecuzione vera e'
                // solo per i comandi compatibili (R-MI-10).
                let permission = self.authorize(&machine, &command, generation).map(|_| catalog::permission(&command).unwrap_or("read"))?;
                headers.insert("x-studio-authenticated-peer".into(), machine.clone());
                let name = self.config.lock().peers.get(&machine).ok_or("Device pairing was revoked")?.name.clone();
                crate::studio_log::info("link", format!("{name}: {command}"));
                // Le azioni host (`link_host_action`, Lettura nel catalogo)
                // si registrano in `host_action` col loro `kind` e il loro ambito.
                if let InvokeBody::Json(args) = &body { self.audit(&machine, permission, &command, args); }
                else { self.audit(&machine, permission, &command, &json!({})); }
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
    call_peer_with_timeout(app, machine, command, args, REQUEST_TIMEOUT).await
}

/// Come `call_peer`, con un timeout per chiamata (B3). I pacchetti git grandi
/// su un relay lento superavano i 300s fissi e bloccavano il giro successivo;
/// chi conosce il costo della chiamata puo' chiedere un tetto piu' largo.
pub(crate) async fn call_peer_with_timeout(app: &tauri::AppHandle, machine: &str, command: &str, args: &Value, timeout: Duration) -> Result<PeerBody, String> {
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
    tokio::time::timeout(timeout, request).await.map_err(|_| "Remote command timed out".to_string())?
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
    match manager.runtime(&app).await {
        Ok(runtime) => runtime.status(),
        // Senza chiave non c'e' runtime: la finestra riceve uno stato che
        // propone le tre uscite di R-MI-43 invece di un errore.
        Err(_) if manager.key_missing.load(Ordering::SeqCst) => Ok(LinkStatus {
            enabled: false, name: String::new(), machine_id: String::new(), platform: std::env::consts::OS,
            relay_url: String::new(), has_relay_token: false, relay_reachable: None, peers: Vec::new(), key_missing: true,
        }),
        Err(error) => Err(error),
    }
}

/// «Crea una nuova identita'» (R-MI-43): solo da qui, su scelta esplicita.
#[tauri::command]
pub(crate) async fn link_reset_identity(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let _configuration = manager.configuration_gate.lock().await;
    if !manager.key_missing.load(Ordering::SeqCst) {
        return Err("The machine key is not missing".into());
    }
    config::reset_identity(&config::path(&app)?)?;
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

/// Registro delle azioni remote di questa macchina (R-MI-39). Nel catalogo
/// e' Lettura e instradabile: un'altra macchina abbinata consulta cosa e'
/// stato fatto qui, filtrando per macchina e progetto.
#[tauri::command]
pub(crate) async fn link_audit(app: tauri::AppHandle, machine_id: Option<String>, project_id: Option<String>) -> Result<Vec<audit::Entry>, String> {
    let path = audit::path(&app)?;
    tokio::task::spawn_blocking(move || audit::query(&path, machine_id.as_deref(), project_id.as_deref(), epoch_ms()))
        .await.map_err(|error| error.to_string())?
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
pub(crate) async fn link_revoke(app: tauri::AppHandle, machine: String, everywhere: Option<bool>, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let runtime = manager.runtime(&app).await?;
    let result = runtime.revoke(&machine, everywhere.unwrap_or(false)).await;
    runtime.changed();
    result?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compatibility_ignores_nightly_build_suffix() {
        assert!(versions_compatible("1.10.1-nightly.1794865373032", "1.10.1-nightly.1795999999999"));
        assert!(versions_compatible("1.10.1", "1.10.1-nightly.123"));
        assert!(versions_compatible("1.10.1-nightly.123", "1.10.1"));
        assert!(versions_compatible("1.10.0", VERSION));
        assert!(!versions_compatible("1.9.0", "1.10.0"));
        assert!(!versions_compatible("1.10.0", "1.10.1"));
        assert!(!versions_compatible("2.0.0-nightly.1", "1.10.0-nightly.1"));
    }

    #[test]
    fn stable_version_strips_only_the_prerelease_suffix() {
        assert_eq!(stable_version("1.10.1-nightly.1794865373032"), "1.10.1");
        assert_eq!(stable_version("1.10.0"), "1.10.0");
        assert_eq!(stable_version("1.10.0-rc.1"), "1.10.0");
    }

    #[test]
    fn a_host_action_path_outside_the_roots_is_refused() {
        // La coda di una copia si legge e si scrive solo dentro le radici
        // dichiarate dall'host (M11): `write_queue` scriveva `.omp/tasks.json`
        // sotto qualunque percorso indicato dal peer.
        let temp = std::env::temp_dir().join(format!("studio-link-roots-{}", uuid::Uuid::new_v4()));
        let project = temp.join("project");
        let private = temp.join("private");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&private).unwrap();
        let mut roots = access::Roots::default();
        roots.update(&json!({ "projectRoot": project, "projects": [], "lanes": [] }).to_string()).unwrap();
        assert!(roots.authorize("host_action:write_queue", &json!({ "projectPath": private })).is_err());
        assert!(roots.authorize("host_action:write_queue", &json!({ "projectPath": project })).is_ok());
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn heartbeat_closes_only_after_consecutive_failures() {
        // Regola senza rete: un successo azzera, solo
        // `HEARTBEAT_MAX_FAILURES` fallimenti di fila chiedono la chiusura.
        let mut failures: HashMap<String, u8> = HashMap::new();
        assert!(!register_heartbeat_failure(&mut failures, "peer"));
        failures.remove("peer");
        for _ in 1..HEARTBEAT_MAX_FAILURES {
            assert!(!register_heartbeat_failure(&mut failures, "peer"));
        }
        assert!(register_heartbeat_failure(&mut failures, "peer"));
        assert!(!failures.contains_key("peer"), "il contatore riparte dopo la chiusura");
    }

    #[test]
    fn propagated_revoke_requires_pairing_and_protects_receiver_and_sender() {
        assert!(Runtime::accept_propagated_revoke("mac", "pc", "laptop", true));
        assert!(!Runtime::accept_propagated_revoke("mac", "pc", "laptop", false));
        assert!(!Runtime::accept_propagated_revoke("mac", "pc", "pc", true));
        assert!(!Runtime::accept_propagated_revoke("mac", "pc", "mac", true));
    }

    #[test]
    fn update_commands_reach_a_machine_with_another_version() {
        // Ogni comando dell'elenco deve esistere davvero nel catalogo e
        // girare sull'altra macchina: un nome sbagliato bloccava il download.
        for command in UPDATE_COMMANDS {
            let permission = catalog::permission(command);
            assert!(permission.is_some_and(|permission| permission != "local"), "{command}");
        }
    }
}
