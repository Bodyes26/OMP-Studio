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
mod depot;
mod discovery;
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
/// Attesa dopo un `Config::load` fallito (S2-10): basta a non riproporre un
/// dialogo del portachiavi a ogni comando, corta abbastanza perche' «Riprova»
/// dall'interfaccia abbia effetto.
const LOAD_RETRY: Duration = Duration::from_secs(10);
/// Intervallo minimo fra due scritture di `lastSeen` su `instances.json`
/// (S2-14): R-MI-29 chiede la granularita' del giorno, non del minuto.
const PEER_SEEN_PERSIST_MS: u64 = 5 * 60 * 1000;
/// Ogni quanto si scrive una riga con i conteggi dei comandi remoti invece di
/// una riga per comando (S2-07, S2-15). Il log ruota a 4 MB: una riga INFO per
/// ogni `get_omp_version` lo riempiva in tre giorni e nascondeva gli errori.
const LOG_SUMMARY_INTERVAL: Duration = Duration::from_secs(600);
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
    // Il deposito corto si ritira una volta sola: conserva il codice completo
    // solo mentre la finestra chiede conferma per il cambio di relay.
    pair_relay_confirmation: Mutex<Option<RelayConfirmation>>,
    /// Chiave della macchina sparita dal portachiavi (R-MI-43): lo stato lo
    /// dice alla finestra invece di un errore generico.
    key_missing: std::sync::atomic::AtomicBool,
    /// Ultimo errore di `Config::load` e fino a quando non si riprova
    /// (S2-10): senza, ogni comando successivo rileggeva il portachiavi.
    load_error: Mutex<Option<String>>,
    load_retry_at: Mutex<Option<Instant>>,
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

struct RelayConfirmation {
    short_code: String,
    full_code: String,
    expires: Instant,
}

/// Richiesta di abbinamento in rete locale in attesa di risposta (R-MI-54).
/// Una richiesta rifiutata o scaduta viene tolta senza lasciare stato: nessun
/// peer scritto, nessun invito consumato.
struct PendingPair {
    /// Chi riceve la richiesta risponde con `true`/`false`; chi l'ha scelta
    /// non ha un canale e aspetta la risposta dell'altra macchina.
    answer: Option<tokio::sync::oneshot::Sender<bool>>,
    expires: Instant,
}
struct Runtime {
    app: tauri::AppHandle,
    id: String,
    /// Identita' di questo runtime, nuova a ogni avvio dell'app (S1-rpc-03):
    /// viaggia in `Reply::Opened`, cosi' il viewer sa che gli id numerici
    /// dell'host non valgono piu' e non prova a riagganciarsi per numero.
    instance: String,
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
    /// Macchine viste in rete locale, solo mentre la scoperta e' accesa
    /// (R-MI-54). Annuncio e ascolto vivono dentro `discovery`.
    discovery: Mutex<Option<discovery::Session>>,
    /// Richieste di abbinamento in rete locale in attesa (R-MI-54), per id.
    pairs: Mutex<HashMap<String, PendingPair>>,
    /// Relay con cui l'endpoint vivo e' stato costruito: vuoto quando la
    /// scoperta in rete locale ha acceso un endpoint senza relay (R-MI-54).
    /// Serve a capire che un codice con relay richiede di ripartire.
    endpoint_relay: Mutex<String>,
    /// Serializza la costruzione dell'endpoint (S2-17): `link_discovery_start`
    /// e `devices_set_server` non passano da `configuration_gate`, e due
    /// `bind()` concorrenti lasciavano vivo un secondo endpoint con la stessa
    /// `generation`.
    start_gate: tokio::sync::Mutex<()>,
    /// Ultimo stato emesso su `link:status` (S2-03): il giro di riconnessione
    /// gira ogni 5 s anche quando nulla cambia, e ogni emissione faceva
    /// ripartire tutti gli effetti della finestra.
    last_status: Mutex<Option<String>>,
    /// Righe di log gia' contate per (peer, comando), scritte in un riepilogo
    /// ogni `LINK_LOG_SUMMARY_INTERVAL` (S2-07, S2-15).
    log_counts: Mutex<HashMap<String, u64>>,
    log_summary_at: Mutex<Instant>,
    /// Un salvataggio di `instances.json` alla volta, ma fuori dal lock della
    /// config (S2-14).
    save_gate: Mutex<()>,
    /// Quando `lastSeen` di ogni peer e' stato scritto su disco l'ultima volta
    /// (S2-14): in memoria cambia a ogni battito, il file ogni qualche minuto.
    last_persisted_seen: Mutex<HashMap<String, u64>>,
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
    /// Stacca le superfici remote di una finestra che si ricarica (S1-rpc-02,
    /// C1). Il `Runtime` esiste solo dopo l'inizializzazione del collegamento:
    /// prima non c'e' nessuna iscrizione da staccare.
    pub(crate) fn detach_window(&self, label: &str) {
        let Ok(guard) = self.runtime.try_lock() else { return };
        if let Some(runtime) = guard.as_ref() { runtime.detach_window(label); }
    }

    async fn runtime(&self, app: &tauri::AppHandle) -> Result<Arc<Runtime>, String> {        let mut guard = self.runtime.lock().await;
        if let Some(runtime) = guard.as_ref() { return Ok(runtime.clone()); }
        let path = config::path(app)?;
        // `Config::load` legge il portachiavi di sistema, che puo' aprire un
        // dialogo e bloccare a lungo: sul worker tokio fermerebbe ogni altro
        // comando async, questo compreso (S2-10). L'esito negativo si ricorda
        // con un backoff: senza, ogni chiamata successiva rileggeva il
        // portachiavi e riproponeva il dialogo.
        if let Some(until) = *self.load_retry_at.lock() {
            if Instant::now() < until { return Err(self.load_error.lock().clone().unwrap_or_else(|| "Link startup failed".into())); }
        }
        let load_path = path.clone();
        let loaded = tokio::task::spawn_blocking(move || Config::load(&load_path))
            .await.map_err(|error| error.to_string())?;
        let config = match loaded {
            Ok(config) => {
                self.key_missing.store(false, Ordering::SeqCst);
                *self.load_error.lock() = None;
                *self.load_retry_at.lock() = None;
                config
            }
            Err(error) => {
                self.key_missing.store(config::key_missing(&path), Ordering::SeqCst);
                // Dieci secondi: abbastanza per non riproporre un dialogo a
                // ogni comando, poco perche' "Riprova" dall'interfaccia
                // (`link_reset_identity`, `link_configure`) abbia effetto.
                *self.load_error.lock() = Some(error.clone());
                *self.load_retry_at.lock() = Some(Instant::now() + LOAD_RETRY);
                return Err(error);
            }
        };
        let id = config.secret()?.public().to_string();
        let runtime = Arc::new(Runtime {
            app: app.clone(), path, config: Mutex::new(config), endpoint: Mutex::new(None),
            id,
            instance: uuid::Uuid::new_v4().to_string(),
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
            discovery: Mutex::new(None),
            pairs: Mutex::new(HashMap::new()),
            endpoint_relay: Mutex::new(String::new()),
            start_gate: tokio::sync::Mutex::new(()),
            last_status: Mutex::new(None),
            log_counts: Mutex::new(HashMap::new()),
            log_summary_at: Mutex::new(Instant::now()),
            save_gate: Mutex::new(()),
            last_persisted_seen: Mutex::new(HashMap::new()),
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
                // Passi di 10 ms: il confronto fra due stati deve vedere la
                // stessa latenza quando non e' cambiata in modo percepibile
                // (S2-03).
                let latency = entry.connection.rtt(path.id())
                    .map(|duration| (duration.as_secs_f64() * 100.0).round() / 100.0);
                (Some(if path.is_ip() { "direct" } else { "relay" }), latency)
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

    /// Emissione dello stato alle finestre. Il giro di riconnessione la chiama
    /// ogni 5 s, ma quasi sempre non e' cambiato niente: emetterla lo stesso
    /// faceva ripartire tutti gli effetti della finestra e, per uno di loro, un
    /// `get_omp_version` verso ogni peer (S2-03, S3-link-front-01/-02).
    /// La latenza entra nello stato arrotondata a passi di 10 ms: cambia a ogni
    /// giro di qualche frazione di ms, e da sola non e' una notizia.
    fn changed(&self) {
        let Ok(status) = self.status() else { return };
        let Ok(serialized) = serde_json::to_string(&status) else { return };
        {
            let mut last = self.last_status.lock();
            if last.as_deref() == Some(serialized.as_str()) { return; }
            *last = Some(serialized);
        }
        let _ = self.app.emit("link:status", &status);
    }

    async fn start(self: &Arc<Self>) -> Result<(), String> {
        self.start_with(false).await
    }

    /// `start` con `force` per la sola scoperta in rete locale (R-MI-54): il
    /// percorso «Aggiungi dispositivo» deve funzionare anche a collegamento
    /// spento e senza relay, altrimenti la prima macchina non potrebbe
    /// abbinarne nessuna.
    async fn start_with(self: &Arc<Self>, force: bool) -> Result<(), String> {
        // Due avvii concorrenti costruivano due endpoint con la stessa
        // `generation` (S2-17): accept, battito e giro di connessione
        // duplicati. Qui si serializza l'intera costruzione.
        let _starting = self.start_gate.lock().await;
        let (enabled, relay_url, token, secret) = {
            let config = self.config.lock();
            (config.enabled, config.relay_url.clone(), config.relay_token.clone(), config.secret()?)
        };
        if !enabled && !force {
            // Collegamento spento: nessun relay da verificare (R-MI-30).
            *self.relay_reachable.lock() = None;
            return Ok(());
        }
        if self.endpoint.lock().is_some() { return Ok(()); }
        // R-MI-54: il percorso «Aggiungi dispositivo › rete locale» deve
        // funzionare anche prima che esista un relay configurato. Senza
        // indirizzo l'endpoint non usa relay (solo via diretta); appena il
        // codice ne adotta uno, `start` viene richiamato con l'indirizzo.
        let relay_mode = if relay_url.trim().is_empty() {
            RelayMode::Disabled
        } else {
            let url: RelayUrl = relay_url.parse().map_err(|_| "Invalid iroh relay URL")?;
            let mut relay_map = RelayMode::custom([url]).relay_map();
            if !token.is_empty() { relay_map = relay_map.with_auth_token(token); }
            RelayMode::Custom(relay_map)
        };
        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret).relay_mode(relay_mode)
            .ca_tls_config(CaTlsConfig::system())
            // L'ALPN dell'abbinamento in rete locale resta registrato sempre;
            // accettarlo richiede pero' la scoperta accesa (vedi `accept_pair`).
            .alpns(vec![ALPN.to_vec(), discovery::PAIR_ALPN.to_vec()])
            .bind().await.map_err(|error| format!("Starting instance link: {error}"))?;
        *self.endpoint.lock() = Some(endpoint.clone());
        *self.endpoint_relay.lock() = relay_url.trim().to_owned();
        let generation = self.generation.load(Ordering::SeqCst);
        let runtime = self.clone();
        let accepting = endpoint.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let runtime = runtime.clone();
                tauri::async_runtime::spawn(async move {
                    let result = tokio::time::timeout(CONNECT_TIMEOUT, async {
                        let connection = incoming.await.map_err(|error| error.to_string())?;
                        // L'ALPN dell'abbinamento non porta un token: si accetta
                        // solo con la scoperta accesa, cioe' mentre l'utente ha
                        // aperto «Aggiungi dispositivo» (R-MI-54).
                        if connection.alpn() == discovery::PAIR_ALPN {
                            return runtime.accept_pair(connection).await;
                        }
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
        self.pairs.lock().clear();
        // L'annuncio in rete locale segue l'endpoint: senza endpoint non c'e'
        // niente da scoprire, e la sessione cadrebbe comunque.
        if let Some(session) = self.discovery.lock().take() { session.shutdown(); }
        let connections = std::mem::take(&mut *self.connections.lock());
        for (_, connected) in connections { connected.connection.close(0u32.into(), b"configuration changed"); }
        let endpoint = self.endpoint.lock().take();
        *self.endpoint_relay.lock() = String::new();
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
        let mut updated = None;
        if !config.peers.contains_key(&id) {
            if !initiated_pairing {
                let mut invitation = self.invitation.lock();
                let valid = invitation.as_ref().is_some_and(|entry| entry.expires > Instant::now()
                    && hello.pairing.as_deref() == Some(entry.token.as_str()));
                if !valid { return Err("Device is not paired, or pairing code expired".into()); }
                invitation.take();
            }
            if !versions_compatible(&hello.version, VERSION) { return Err(format!("Update Studio before pairing: {VERSION} / {}", hello.version)); }
            let mut next = config.clone();
            next.peers.insert(id.clone(), Peer { name: hello.name.clone(), address: hello.address.clone(), permissions: catalog::Permissions::default(), last_seen: Some(now) });
            *config = next.clone();
            updated = Some(next);
        } else if let Some(peer) = config.peers.get_mut(&id) {
            // Gli indirizzi diretti cambiano con la rete, l'identita' resta la chiave QUIC.
            peer.address = hello.address.clone();
            peer.name = hello.name.clone();
            peer.last_seen = Some(now);
            updated = Some(config.clone());
        }
        // Il lock si lascia prima di scrivere (S2-14): lo stesso `config` lo
        // prendono `authorize` a ogni frame e `status()` ogni giro, e l'fsync
        // di `instances.json` li faceva aspettare.
        drop(config);
        if let Some(updated) = updated { self.persist(updated); }
        Ok(())
    }

    /// Il battito persiste al massimo ogni qualche minuto per peer: a R-MI-29
    /// basta la granularita' del giorno (S2-14). `lastSeen` in memoria cambia a
    /// ogni battito, il file no.
    fn touch_peer(&self, id: &str) -> Result<(), String> {
        let now = epoch_ms();
        if self.last_persisted_seen.lock().get(id).is_some_and(|last| now.saturating_sub(*last) < PEER_SEEN_PERSIST_MS) {
            return Ok(());
        }
        let updated = {
            let mut config = self.config.lock();
            let Some(peer) = config.peers.get_mut(id) else { return Ok(()) };
            peer.last_seen = Some(now);
            config.clone()
        };
        self.last_persisted_seen.lock().insert(id.to_owned(), now);
        self.persist(updated);
        Ok(())
    }

    /// Scrittura di `instances.json` fuori dal lock della config, una alla
    /// volta (S2-14): lo snapshot da scrivere si prende sotto lock, l'fsync no.
    fn persist(&self, config: Config) {
        let _writing = self.save_gate.lock();
        if let Err(error) = config.save(&self.path) {
            crate::studio_log::info("link", format!("Salvataggio instances.json: {error}"));
        }
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

    /// Scrive un peer appena abbinato (R-MI-54). I permessi restano quelli
    /// gia' scelti dall'utente; per una macchina nuova valgono quelli iniziali
    /// di R-MI-09 (`Permissions::default`).
    fn add_peer(&self, peer: Peer) -> Result<(), String> {
        let mut config = self.config.lock();
        let mut updated = config.clone();
        // Un abbinamento in rete locale aggiorna l'indirizzo ma non i permessi
        // gia' scelti: quelli sono dell'utente (R-MI-09), non del trasporto.
        let previous = updated.peers.get(peer.address.id.as_str()).map(|existing| existing.permissions);
        let mut peer = peer;
        if let Some(permissions) = previous { peer.permissions = permissions; }
        updated.peers.insert(peer.address.id.clone(), peer);
        // Un abbinamento esplicito accende il collegamento: `authorize_hello`
        // rifiuta i peer quando e' spento, quindi senza questo le due macchine
        // risulterebbero abbinate ma mai collegate (R-MI-09, R-MI-54).
        updated.enabled = true;
        updated.save(&self.path)?;
        *config = updated;
        drop(config);
        self.changed();
        Ok(())
    }

    /// Lato di chi riceve una richiesta di abbinamento in rete locale: mostra
    /// la conferma e scrive il peer solo dopo l'accettazione dell'utente.
    async fn accept_pair(self: &Arc<Self>, connection: Connection) -> Result<(), String> {
        let open = self.discovery.lock().is_some();
        if !open {
            connection.close(1u32.into(), b"pairing is not open");
            return Err("Local network discovery is not running".into());
        }
        let (mut send, mut recv) = connection.accept_bi().await.map_err(|error| error.to_string())?;
        let request: discovery::PairRequest = read_json(&mut recv).await?;
        let reply = |accept: bool, name: &str| discovery::PairReply { accept, name: name.to_owned(), version: VERSION.into() };
        let remote = connection.remote_id().to_string();
        let sas = discovery::sas(&self.id, &remote, &request.nonce);
        // Le due macchine devono leggere lo stesso numero: se il nonce non
        // torna, la richiesta non e' quella che l'altra schermata mostra.
        let admission = lan_admission(
            open, request.protocol, versions_compatible(&request.version, VERSION),
            request.address.id == remote, remote == self.id, sas == request.sas,
        );
        if let Err(refused) = admission {
            let name = self.config.lock().name.clone();
            send_json(&mut send, &reply(false, &name)).await?;
            let _ = send.finish();
            return Err(match refused {
                LanAdmission::Incompatible if request.protocol != PROTOCOL => "Incompatible Studio link protocol".into(),
                LanAdmission::Incompatible => format!("Update Studio before pairing: {VERSION} / {}", request.version),
                LanAdmission::IdentityMismatch => "Endpoint identity mismatch".into(),
                LanAdmission::SelfPair => "Cannot pair Studio with itself".into(),
                LanAdmission::ConfirmationMismatch => "Pairing confirmation does not match".into(),
                LanAdmission::DiscoveryClosed | LanAdmission::AwaitingAnswer => "Local network discovery is not running".into(),
            });
        }
        let request_id = uuid::Uuid::new_v4().simple().to_string();
        let (answer_tx, answer_rx) = tokio::sync::oneshot::channel();
        self.pairs.lock().insert(request_id.clone(), PendingPair {
            answer: Some(answer_tx), expires: Instant::now() + discovery::PAIR_TIMEOUT,
        });
        let prompt = discovery::PairPrompt {
            request_id: request_id.clone(), peer_id: remote.clone(), name: request.name.clone(),
            sas, direction: "incoming",
        };
        let _ = self.app.emit("link:pair_request", &prompt);
        // Due minuti: oltre, la richiesta non vale piu' e non resta nulla.
        let accepted = tokio::time::timeout(discovery::PAIR_TIMEOUT, answer_rx).await.ok().and_then(Result::ok).unwrap_or(false);
        self.pairs.lock().remove(&request_id);
        let name = self.config.lock().name.clone();
        send_json(&mut send, &reply(accepted, &name)).await?;
        let _ = send.finish();
        // Rifiuto o silenzio: nessun peer scritto, nessun invito consumato.
        if !lan_pair_writes_peer(&LanAdmission::AwaitingAnswer, accepted) { return Ok(()); }
        self.add_peer(Peer {
            name: request.name.clone(), address: request.address.clone(),
            permissions: catalog::Permissions::default(), last_seen: Some(epoch_ms()),
        })?;
        Ok(())
    }

    /// Lato di chi sceglie una macchina in rete locale (R-MI-54): propone
    /// l'abbinamento e aspetta la risposta; senza accettazione non scrive
    /// nulla.
    async fn pair_lan(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let endpoint = self.endpoint.lock().clone().ok_or("Enable instance control first")?;
        let discovered = {
            let guard = self.discovery.lock();
            let session = guard.as_ref().ok_or("Local network discovery is not running")?;
            let found = session.peers.lock().get(id).cloned();
            found.ok_or("That machine is no longer on the local network")?
        };
        let address = discovered.endpoint_addr()?;
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let sas = discovery::sas(&self.id, id, &nonce);
        let own = self.hello(None)?;
        let request = discovery::PairRequest {
            protocol: PROTOCOL, version: VERSION.into(), name: own.name.clone(),
            address: own.address, nonce, sas: sas.clone(),
        };
        let request_id = uuid::Uuid::new_v4().simple().to_string();
        let prompt = discovery::PairPrompt {
            request_id: request_id.clone(), peer_id: id.to_owned(), name: discovered.name.clone(),
            sas, direction: "outgoing",
        };
        let _ = self.app.emit("link:pair_request", &prompt);
        let exchange = async {
            let connection = endpoint.connect(address, discovery::PAIR_ALPN).await.map_err(|error| error.to_string())?;
            let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
            send_json(&mut send, &request).await?;
            send.finish().map_err(|error| error.to_string())?;
            let reply: discovery::PairReply = read_json(&mut recv).await?;
            if !reply.accept { return Err(crate::tr!("L'altra macchina ha rifiutato l'abbinamento", "The other machine declined the pairing").to_string()); }
            if !versions_compatible(&reply.version, VERSION) {
                return Err(format!("Update Studio before pairing: {VERSION} / {}", reply.version));
            }
            let name = if reply.name.trim().is_empty() { discovered.name.clone() } else { reply.name.clone() };
            self.add_peer(Peer {
                name, address: discovered.address(),
                permissions: catalog::Permissions::default(), last_seen: Some(epoch_ms()),
            })?;
            Ok::<(), String>(())
        };
        let outcome = tokio::time::timeout(discovery::PAIR_TIMEOUT, exchange).await
            .unwrap_or_else(|_| Err(crate::tr!("Nessuna risposta dall'altra macchina", "The other machine did not answer").to_string()));
        let _ = self.app.emit("link:pair_result", &json!({
            "requestId": request_id, "ok": outcome.is_ok(),
            "error": outcome.as_ref().err().cloned(),
        }));
        outcome
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
        let peer = id;
        tauri::async_runtime::spawn(async move {
            while let Ok((send, recv)) = connection.accept_bi().await {
                let runtime = runtime.clone();
                let connection = connection.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = runtime.serve(&connection, send, recv, generation).await;
                });
            }
            // R-MI-18: una connessione chiusa non deve lasciare una corsia
            // «occupata da fuori». Le guardie dei flussi si rilasciano da sole,
            // ma qui si toglie l'intera macchina: una superficie appesa non
            // tiene bloccata la coda della macchina proprietaria.
            //
            // Solo se questa e' ancora la connessione registrata: quando una
            // nuova la sostituisce, le viste sono gia' della nuova e toglierle
            // qui libererebbe una corsia che qualcuno sta ancora guardando.
            let current = runtime.connections.lock().get(&peer)
                .is_some_and(|entry| entry.connection.stable_id() == connection.stable_id());
            if current {
                runtime.activity.detach_peer(&peer);
                streams::publish_activity(&runtime.app, &runtime.activity);
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
            // Con la coda la cartella puo' pero' essere quella di un progetto
            // chiuso su questa macchina (S3-06): un `projectId` noto all'host
            // basta, perche' il task deve poter restare in attesa (R-MI-15).
            "read_queue" | "write_queue" => {
                let id = command.get("projectId").and_then(Value::as_str).unwrap_or("");
                if !id.is_empty() && self.require_known_project(id).is_ok() { Ok(()) }
                else { self.check_host_path(&roots, command, "projectPath", kind) }
            }
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

    /// Righe di log di una richiesta servita a un peer. `INFO` solo per i
    /// comandi che cambiano qualcosa o eseguono, con lo stesso criterio del
    /// registro azioni; le letture si contano per (peer, comando) e si
    /// scrivono in un riepilogo ogni `LOG_SUMMARY_INTERVAL` (S2-07, S2-15).
    fn log_command(&self, peer_name: &str, command: &str, permission: &str) {
        if !matches!(permission, "read" | "local") {
            crate::studio_log::info("link", format!("{peer_name}: {command}"));
            return;
        }
        let mut counts = self.log_counts.lock();
        *counts.entry(format!("{peer_name}: {command}")).or_insert(0) += 1;
        let mut at = self.log_summary_at.lock();
        if at.elapsed() < LOG_SUMMARY_INTERVAL { return; }
        *at = Instant::now();
        let mut summary: Vec<String> = counts.drain().map(|(key, count)| format!("{key} {count}x")).collect();
        drop(counts);
        if summary.is_empty() { return; }
        // Il riepilogo va letto come una riga sola: i comandi piu' frequenti
        // per primi, cosi' un log troncato dice comunque i principali.
        summary.sort_by_key(|line| std::cmp::Reverse(line.rsplit_once(' ').and_then(|(_, count)| count.trim_end_matches('x').parse::<u64>().ok()).unwrap_or(0)));
        crate::studio_log::info("link", format!("letture: {}", summary.join(", ")));
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
        // `rpc_send` e' il canale di ogni comando della chat: le letture di
        // stato (`get_state`, `set_steering_mode`, ...) non sono azioni, solo
        // prompt, steer, follow_up, abort e risposte UI lo sono (S2-15).
        if action == "rpc_send" && !audit::rpc_send_is_action(args) { return; }
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
                // Una riga per comando che cambia qualcosa; le letture (che
                // sono la grande maggioranza: `get_omp_version`,
                // `git_upstream_status`, ...) vanno contate e riassunte ogni
                // dieci minuti, altrimenti il log ruota ogni tre giorni e
                // perde gli errori (S2-07, S2-15).
                self.log_command(&name, &command, permission);
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
            let subscription = streams.values().filter(|stream| stream.machine == machine && stream.window == window
                && stream.id.load(Ordering::SeqCst) == id
                && ((command == "rpc_close") != (stream.command == "pty_open")))
                // Piu' sottoscrizioni omonime (una sopravvissuta a una
                // ricarica): si chiude quella viva, cioe' la piu' recente
                // (S1-rpc-02).
                .max_by_key(|stream| stream.sequence)
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

/// Codice di abbinamento (R-MI-16, R-MI-53): porta l'identita' e gli
/// indirizzi della macchina, il token monouso dell'invito e, se c'e', il
/// token del relay iroh, cosi' una macchina nuova non deve configurare nulla.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingCode {
    protocol: u32,
    address: Address,
    token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    relay_token: Option<String>,
}

/// Cosa fare col relay del codice rispetto a quello configurato qui
/// (R-MI-53). Separata dal resto per essere provata senza rete.
#[derive(Debug, PartialEq, Eq)]
enum RelayPlan {
    /// Stesso relay: si procede.
    Same,
    /// Questa macchina non ha ancora un relay, oppure l'utente ha scelto di
    /// sostituirlo: si adotta quello del codice (con il suo token).
    Adopt,
    /// Relay diverso e nessuna scelta esplicita: l'errore dice quale sarebbe.
    Mismatch,
}

/// Ammissione di una richiesta di abbinamento in rete locale (R-MI-54),
/// separata dalla rete per essere provata da sola: dice se la richiesta puo'
/// arrivare all'utente, e se alla fine il peer va scritto. `accepted` e' la
/// risposta dell'utente; senza di essa non si scrive nulla.
#[derive(Debug, PartialEq, Eq)]
enum LanAdmission {
    /// Il percorso non e' aperto: la macchina non si annuncia ne' si abbina.
    DiscoveryClosed,
    /// Protocollo o versione non compatibili.
    Incompatible,
    /// La chiave del richiedente non corrisponde all'identita' della connessione.
    IdentityMismatch,
    /// La macchina ha provato ad abbinarsi con se stessa.
    SelfPair,
    /// Le due schermate non mostrano lo stesso numero: la richiesta non e' quella.
    ConfirmationMismatch,
    /// In attesa della risposta dell'utente.
    AwaitingAnswer,
}

fn lan_admission(discovery_open: bool, protocol: u32, compatible: bool, same_identity: bool, same_machine: bool, sas_matches: bool) -> Result<LanAdmission, LanAdmission> {
    if !discovery_open { return Err(LanAdmission::DiscoveryClosed); }
    if protocol != PROTOCOL || !compatible { return Err(LanAdmission::Incompatible); }
    if !same_identity { return Err(LanAdmission::IdentityMismatch); }
    if same_machine { return Err(LanAdmission::SelfPair); }
    if !sas_matches { return Err(LanAdmission::ConfirmationMismatch); }
    Ok(LanAdmission::AwaitingAnswer)
}

/// Un abbinamento in rete locale scrive il peer solo con l'accettazione
/// dell'utente: rifiuto o silenzio non lasciano stato (R-MI-54).
fn lan_pair_writes_peer(admission: &LanAdmission, accepted: bool) -> bool {
    matches!(admission, LanAdmission::AwaitingAnswer) && accepted
}

/// Origine di relay confrontabile: uno slash finale di troppo non e' un
/// relay diverso (i file vecchi non lo normalizzavano sempre).
fn relay_origin(url: &str) -> &str {
    url.trim().trim_end_matches('/')
}

fn relay_plan(local: &str, from_code: &str, adopt: bool) -> Result<RelayPlan, String> {
    let code_relay = relay_origin(from_code);
    if code_relay.is_empty() { return Err("Pairing code has no relay".into()); }
    let local = relay_origin(local);
    if local.is_empty() { return Ok(RelayPlan::Adopt); }
    if local == code_relay { return Ok(RelayPlan::Same); }
    if adopt { return Ok(RelayPlan::Adopt); }
    Ok(RelayPlan::Mismatch)
}

/// Esito del codice di abbinamento per la finestra (R-MI-53, R-MI-55).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingCodeView {
    /// Codice completo, sempre copiabile.
    code: String,
    /// `XXXX-XXXX` quando il server di Remote e' configurato e il deposito
    /// e' riuscito; `null` altrimenti.
    short_code: Option<String>,
    /// Scadenza in millisecondi epoch.
    expires_at: u64,
}

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

/// Relay di Studio Remote configurato, con la credenziale dell'host, se c'e'
/// (R-MI-55): serve a depositare il codice corto e a chiedere il relay iroh.
fn remote_host(credential: Option<String>, relay_url: Option<String>) -> Option<(String, String)> {
    match (credential, relay_url) {
        (Some(credential), Some(relay_url)) if !credential.trim().is_empty() && !relay_url.trim().is_empty() =>
            Some((relay_url, credential)),
        _ => None,
    }
}

#[tauri::command]
pub(crate) async fn link_pairing_code(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<PairingCodeView, String> {
    let runtime = manager.runtime(&app).await?;
    // Generare un invito è un'accensione esplicita: un endpoint forzato
    // per la sola scoperta altrimenti rifiuta l'hello del nuovo computer.
    {
        let _configuration = manager.configuration_gate.lock().await;
        let changed = {
            let mut config = runtime.config.lock();
            if config.relay_url.trim().is_empty() {
                return Err(crate::tr!(
                    "Per un codice di abbinamento serve il relay: configuralo, oppure usa «rete locale»",
                    "A pairing code needs the relay: configure it, or use «local network»"
                ).into());
            }
            if config.enabled { false } else {
                let mut updated = config.clone();
                updated.enabled = true;
                updated.save(&runtime.path)?;
                *config = updated;
                true
            }
        };
        if changed || runtime.endpoint.lock().is_none() || runtime.endpoint_relay.lock().trim().is_empty() {
            runtime.stop().await;
            runtime.start().await?;
            runtime.changed();
        }
    }
    let hello = runtime.hello(None)?;
    let relay_token = { let config = runtime.config.lock(); config.relay_token.clone() };
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let expires = Instant::now() + Duration::from_secs(600);
    let code = PairingCode {
        protocol: PROTOCOL, address: hello.address, token: token.clone(),
        relay_token: (!relay_token.is_empty()).then_some(relay_token),
    };
    *runtime.invitation.lock() = Some(Invitation { token, expires });
    let full = format!("studio1:{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&code).map_err(|error| error.to_string())?));
    let expires_at = epoch_ms() + 600_000;
    // R-MI-55: con Studio Remote configurato il codice corto esiste, ma il
    // codice completo resta disponibile per chi non usa Remote.
    let remote = app.try_state::<crate::remote::RemoteManager>().map(|manager| {
        let config = manager.ctx.config.lock();
        (config.relay_url.clone(), config.credential.clone())
    });
    let short_code = match remote.and_then(|(relay, credential)| remote_host(credential, relay)) {
        Some((relay, credential)) => {
            let short = depot::generate_short_code();
            match depot::deposit(&relay, &credential, &short, &full).await {
                Ok(_) => Some(depot::format_short_code(&short)),
                Err(error) => {
                    crate::studio_log::info("link", format!("Deposito del codice corto non riuscito: {error}"));
                    None
                }
            }
        }
        None => None,
    };
    Ok(PairingCodeView { code: full, short_code, expires_at })
}

/// Codice completo da un codice corto: ritiro unico dal relay di Remote
/// configurato, decifrato con la chiave ricavata dal codice (R-MI-55).
async fn withdraw_short_code(app: &tauri::AppHandle, short: &str, server: Option<&str>) -> Result<String, String> {
    let relay = match server {
        Some(url) => crate::remote::config::validate_and_normalize_relay_url(url)?.http_url,
        None => {
            let manager = app.try_state::<crate::remote::RemoteManager>()
                .ok_or_else(|| crate::tr!("Modulo di controllo remoto non inizializzato", "Remote control module not initialized").to_string())?;
            let configured = manager.ctx.config.lock().relay_url.clone();
            configured.ok_or_else(|| crate::tr!(
                "Per un codice corto serve il server di Studio Remote configurato",
                "A short code requires the Studio Remote server to be configured"
            ).to_string())?
        }
    };
    depot::withdraw(&relay, short).await
}

#[tauri::command]
pub(crate) async fn link_pair(app: tauri::AppHandle, code: String, adopt_relay: Option<bool>, server: Option<String>, progress: tauri::ipc::Channel<&'static str>, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    if code.len() > 16384 { return Err("Pairing code is too long".into()); }
    let trimmed = code.trim();
    let adopt = adopt_relay.unwrap_or(false);
    let notify = |stage| {
        let _ = progress.send(stage);
    };
    let waiting = manager.pair_relay_confirmation.lock().take();
    let mut short_code = None;
    // Codice corto (R-MI-55): lo si ritira una volta sola e si prosegue col
    // codice completo che conteneva.
    let full = match trimmed.strip_prefix("studio1:") {
        Some(_) => trimmed.to_owned(),
        None => {
            let short = depot::normalize_short_code(trimmed)
                .ok_or_else(|| crate::tr!("Codice di abbinamento non valido", "Invalid pairing code").to_string())?;
            short_code = Some(short.clone());
            match waiting {
                Some(pending) if adopt && pending.short_code == short && pending.expires > Instant::now() => pending.full_code,
                _ => {
                    notify("server");
                    withdraw_short_code(&app, &short, server.as_deref()).await?
                }
            }
        }
    };
    let encoded = full.strip_prefix("studio1:").ok_or("Invalid pairing code")?;
    let code: PairingCode = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "Invalid pairing code")?).map_err(|_| "Invalid pairing code")?;
    if code.protocol != PROTOCOL { return Err("Incompatible pairing code".into()); }
    let runtime = manager.runtime(&app).await?;
    // R-MI-53: su una macchina non configurata il relay e il token arrivano
    // dal codice; con un relay diverso si chiede prima all'utente.
    let local_relay = runtime.config.lock().relay_url.clone();
    notify("configuration");
    match relay_plan(&local_relay, &code.address.relay, adopt)? {
        RelayPlan::Mismatch => {
            if let Some(short) = short_code {
                *manager.pair_relay_confirmation.lock() = Some(RelayConfirmation {
                    short_code: short, full_code: full, expires: Instant::now() + Duration::from_secs(60),
                });
            }
            return Err(format!("relay_mismatch:{}", code.address.relay.trim()));
        }
        RelayPlan::Adopt => {
            let _configuration = manager.configuration_gate.lock().await;
            {
                let mut config = runtime.config.lock();
                let mut updated = config.clone();
                updated.relay_url = config::validate_relay(&code.address.relay)?;
                updated.relay_token = code.relay_token.clone().unwrap_or_default();
                updated.enabled = true;
                updated.save(&runtime.path)?;
                *config = updated;
            }
            runtime.stop().await;
            runtime.start().await?;
            runtime.changed();
        }
        RelayPlan::Same => {
            // Endpoint spento o collegamento da accendere: il codice porta
            // tutto il necessario, non serve un salvataggio a parte.
            let _configuration = manager.configuration_gate.lock().await;
            let needs_start = {
                let config = runtime.config.lock();
                // Un endpoint acceso dalla sola scoperta in rete locale non ha
                // relay: il codice ne porta uno, va costruito da capo (R-MI-54).
                let live_without_relay = runtime.endpoint.lock().is_some()
                    && runtime.endpoint_relay.lock().trim().is_empty();
                runtime.endpoint.lock().is_none()
                    || live_without_relay
                    || (!config.enabled && !config.relay_url.trim().is_empty())
            };
            if needs_start {
                {
                    let mut config = runtime.config.lock();
                    let mut updated = config.clone();
                    updated.enabled = true;
                    // Un token locale assente si prende dal codice: e' il caso
                    // della macchina che ha gia' l'indirizzo ma non il token.
                    if updated.relay_token.is_empty() {
                        if let Some(token) = code.relay_token.clone() { updated.relay_token = token; }
                    }
                    updated.save(&runtime.path)?;
                    *config = updated;
                }
                runtime.stop().await;
                runtime.start().await?;
                runtime.changed();
            }
        }
    }
    let endpoint = runtime.endpoint.lock().clone().ok_or("Enable instance control first")?;
    if code.address.id == endpoint.id().to_string() { return Err("Cannot pair Studio with itself".into()); }
    let generation = runtime.generation.load(Ordering::SeqCst);
    notify("peer");
    tokio::time::timeout(CONNECT_TIMEOUT, runtime.connect(&endpoint, &code.address, Some(code.token), generation)).await
        .map_err(|_| "Pairing timed out")??;
    runtime.status()
}

/// Nessun `relay_mismatch` e un codice completo lasciano la scelta all'utente:
/// `adoptRelay: true` sostituisce relay e token con quelli del codice.
#[tauri::command]
pub(crate) async fn link_discovery_start(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    let runtime = manager.runtime(&app).await?;
    if runtime.discovery.lock().is_some() { return Ok(()); }
    // R-MI-54: la scoperta accende anche un endpoint senza relay; il
    // collegamento vero resta spento finché non c'è un relay da usare.
    if runtime.endpoint.lock().is_none() { runtime.start_with(true).await?; }
    let endpoint = runtime.endpoint.lock().clone().ok_or("Enable instance control first")?;
    let (name, platform) = { let config = runtime.config.lock(); (config.name.clone(), std::env::consts::OS) };
    let app = app.clone();
    let session = discovery::start(&endpoint, &name, platform, move |list| {
        let _ = app.emit("link:discovered", &list);
    })?;
    *runtime.discovery.lock() = Some(session);
    Ok(())
}

#[tauri::command]
pub(crate) async fn link_discovery_stop(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    let runtime = manager.runtime(&app).await?;
    // Le richieste ancora in attesa non hanno piu' senso senza il percorso
    // aperto: chi aspettava riceve «nessuna risposta», non resta appesa.
    runtime.pairs.lock().clear();
    let session = runtime.discovery.lock().take();
    if let Some(endpoint) = runtime.endpoint.lock().clone() { discovery::stop(&endpoint); }
    if let Some(session) = session { session.shutdown(); }
    let _ = app.emit("link:discovered", &Vec::<discovery::DiscoveredView>::new());
    Ok(())
}

#[tauri::command]
pub(crate) async fn link_pair_lan(app: tauri::AppHandle, id: String, manager: tauri::State<'_, LinkManager>) -> Result<LinkStatus, String> {
    let runtime = manager.runtime(&app).await?;
    runtime.pair_lan(&id).await?;
    runtime.status()
}

#[tauri::command]
pub(crate) async fn link_pair_lan_answer(app: tauri::AppHandle, request_id: String, accept: bool, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    let runtime = manager.runtime(&app).await?;
    let sender = {
        let mut pairs = runtime.pairs.lock();
        let pending = pairs.get_mut(&request_id).ok_or("Unknown pairing request")?;
        if pending.expires <= Instant::now() { pairs.remove(&request_id); return Err("Pairing request expired".into()); }
        pending.answer.take()
    };
    // Chi sceglie non ha un canale: la sua risposta arriva dall'altra macchina.
    let Some(sender) = sender else { return Err("This pairing request is waiting for the other machine".into()); };
    sender.send(accept).map_err(|_| "Pairing request expired".to_string())?;
    let _ = app.emit("link:pair_result", &json!({ "requestId": request_id, "ok": accept }));
    Ok(())
}

/// Nome unico per computer e telefoni (R-MI-52): lo stesso valore in
/// `instances.json` e in `remote.json`.
#[tauri::command]
pub(crate) async fn devices_set_name(app: tauri::AppHandle, name: String, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 { return Err("Machine name must contain 1–128 bytes".into()); }
    let name = name.to_owned();
    // remote.json prima: se il modulo non c'e' non c'e' niente da allineare.
    if app.try_state::<crate::remote::RemoteManager>().is_some() {
        crate::remote::remote_set_machine_name(app.clone(), name.clone()).await?;
    }
    let runtime = manager.runtime(&app).await?;
    {
        let mut config = runtime.config.lock();
        let mut updated = config.clone();
        updated.name = name;
        updated.save(&runtime.path)?;
        *config = updated;
    }
    runtime.changed();
    Ok(())
}

/// Un solo «Server di collegamento» (R-MI-56): l'utente inserisce il relay
/// di Studio Remote e il server dichiara a chi si autentica il relay iroh.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicesServer {
    pub remote_relay: String,
    pub iroh_relay: Option<String>,
}

#[tauri::command]
pub(crate) async fn devices_set_server(app: tauri::AppHandle, url: String, manager: tauri::State<'_, LinkManager>) -> Result<DevicesServer, String> {
    let normalized = crate::remote::config::validate_and_normalize_relay_url(&url)?;
    let remote = app.try_state::<crate::remote::RemoteManager>()
        .ok_or_else(|| crate::tr!("Modulo di controllo remoto non inizializzato", "Remote control module not initialized").to_string())?;
    {
        let mut config = remote.ctx.config.lock();
        config.relay_url = Some(normalized.http_url.clone());
        crate::remote::config::save_config(&remote.config_path, &config)?;
    }
    {
        let mut status = remote.ctx.status.lock();
        status.relay_url = Some(normalized.http_url.clone());
    }
    remote.ctx.emit_status_update();
    // Una macchina gia' abbinata deve riconnettersi al nuovo server: senza
    // questo il cambio di indirizzo resterebbe solo scritto sul disco.
    let resume = { let config = remote.ctx.config.lock(); config.credential.is_some() && config.enabled };
    if resume { remote.restart_connection(); }
    // Endpoint autenticato del relay Bun: senza credenziale non c'e' nulla da
    // chiedere, e la UI mostra «Avanzate».
    let iroh_relay = {
        let credential = remote.ctx.config.lock().credential.clone();
        match credential {
            Some(credential) => crate::link::host_info(&remote.ctx.http_client, &normalized.http_url, &credential).await,
            None => None,
        }
    };
    // Se il server dichiara il relay iroh lo si adotta qui: l'utente non
    // digita due indirizzi.
    if let Some(dedicated) = &iroh_relay {
        if let Ok(valid) = config::validate_relay(dedicated) {
            let runtime = manager.runtime(&app).await?;
            let changed = {
                let mut config = runtime.config.lock();
                if config.relay_url == valid { false } else {
                    let mut updated = config.clone();
                    updated.relay_url = valid;
                    // Il token iroh viaggia col codice: qui non si inventa.
                    updated.save(&runtime.path)?;
                    *config = updated;
                    true
                }
            };
            if changed { runtime.stop().await; let _ = runtime.start().await; runtime.changed(); }
        }
    }
    Ok(DevicesServer { remote_relay: normalized.http_url, iroh_relay })
}

/// Relay iroh dichiarato dal server di Studio Remote (R-MI-56), letto con
/// l'endpoint autenticato dell'host.
pub(crate) async fn host_info(client: &reqwest::Client, relay: &str, credential: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Info { iroh_relay: Option<String> }
    let response = client.get(format!("{relay}/v1/host/info"))
        .bearer_auth(credential)
        .timeout(Duration::from_secs(10))
        .send().await.ok()?;
    if !response.status().is_success() { return None; }
    let info: Info = response.json().await.ok()?;
    info.iroh_relay.filter(|value| !value.trim().is_empty())
}

/// Codice per un nuovo telefono (R-REM-25), generato dal desktop con la
/// credenziale dell'host.
#[tauri::command]
pub(crate) async fn remote_create_phone_code(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let remote = app.try_state::<crate::remote::RemoteManager>()
        .ok_or_else(|| crate::tr!("Modulo di controllo remoto non inizializzato", "Remote control module not initialized").to_string())?;
    let (relay, credential) = {
        let config = remote.ctx.config.lock();
        (config.relay_url.clone(), config.credential.clone())
    };
    let (relay, credential) = remote_host(credential, relay).ok_or_else(|| crate::tr!(
        "Questo computer non e' abbinato a un server di Studio Remote",
        "This computer is not paired with a Studio Remote server"
    ).to_string())?;
    #[derive(serde::Deserialize)]
    struct Created { code: String, expires_at: Option<u64> }
    let response = remote.ctx.http_client.post(format!("{relay}/v1/host/codes"))
        .bearer_auth(&credential)
        .json(&json!({ "kind": "device" }))
        .timeout(Duration::from_secs(15))
        .send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(crate::tr!("Credenziale dell'host rifiutata dal relay", "Host credential rejected by the relay").into());
    }
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(crate::tr!("Troppi codici attivi, attendi la scadenza", "Too many active codes, wait for one to expire").into());
    }
    if !response.status().is_success() {
        return Err(format!("The relay refused the phone code ({})", response.status()));
    }
    let created: Created = response.json().await.map_err(|error| error.to_string())?;
    Ok(json!({
        "code": created.code,
        "url": relay,
        "expiresAt": created.expires_at.unwrap_or_else(|| epoch_ms() + 600_000),
    }))
}

/// Revoca di un telefono abbinato al relay (R-MI-52: «per un telefono stato e
/// disconnessione»), autenticata con la credenziale dell'host.
#[tauri::command]
pub(crate) async fn remote_revoke_device(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let remote = app.try_state::<crate::remote::RemoteManager>()
        .ok_or_else(|| crate::tr!("Modulo di controllo remoto non inizializzato", "Remote control module not initialized").to_string())?;
    let (relay, credential) = {
        let config = remote.ctx.config.lock();
        (config.relay_url.clone(), config.credential.clone())
    };
    let (relay, credential) = remote_host(credential, relay).ok_or_else(|| crate::tr!(
        "Questo computer non e' abbinato a un server di Studio Remote",
        "This computer is not paired with a Studio Remote server"
    ).to_string())?;
    // Gli id dei dispositivi sono UUID generati dal relay: niente caratteri da
    // codificare, e un id che non lo fosse non deve finire nel percorso.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid device id".into());
    }
    let response = remote.ctx.http_client
        .delete(format!("{relay}/v1/host/devices/{id}"))
        .bearer_auth(&credential)
        .timeout(Duration::from_secs(15))
        .send().await.map_err(|error| error.to_string())?;
    match response.status() {
        status if status.is_success() => Ok(()),
        reqwest::StatusCode::NOT_FOUND => Err(crate::tr!("Dispositivo non trovato", "Device not found").into()),
        reqwest::StatusCode::UNAUTHORIZED => Err(crate::tr!("Credenziale dell'host rifiutata dal relay", "Host credential rejected by the relay").into()),
        status => Err(format!("The relay refused the revocation ({status})")),
    }
}

/// Id della macchina locale (R-MI-48): chi unisce il diario si sceglie
/// confrontando questo id con quello del peer.
pub(crate) async fn local_machine_id(app: &tauri::AppHandle) -> Result<String, String> {
    Ok(app.state::<LinkManager>().runtime(app).await?.id.clone())
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
        // La CI riscrive CARGO_PKG_VERSION prima di eseguire i test.
        assert!(versions_compatible("1.10.1", "1.10.1"));
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
    fn a_new_machine_adopts_the_relay_from_the_code() {
        // R-MI-53: installazione nuova, il codice porta relay e token.
        let relay = "https://iroh-relay.myapollo.it/";
        assert_eq!(relay_plan("", relay, false).unwrap(), RelayPlan::Adopt);
        // Stesso relay (con o senza slash finale, che `validate_relay` normalizza): si prosegue.
        assert_eq!(relay_plan("https://iroh-relay.myapollo.it/", relay, false).unwrap(), RelayPlan::Same);
        // Relay diverso senza scelta: la finestra riceve l'indirizzo da proporre.
        assert_eq!(relay_plan("https://other.example/", relay, false).unwrap(), RelayPlan::Mismatch);
        // Relay diverso con `adoptRelay`: si sostituisce.
        assert_eq!(relay_plan("https://other.example/", relay, true).unwrap(), RelayPlan::Adopt);
        // Un codice senza relay non e' utilizzabile.
        assert!(relay_plan("", "  ", false).is_err());
    }

    #[test]
    fn the_mismatch_error_carries_the_relay_of_the_code() {
        // Il contratto D1 -> D2: `relay_mismatch:<url>`, prefisso letterale.
        let relay = "https://iroh-relay.myapollo.it";
        let error = match relay_plan("https://other.example", relay, false).unwrap() {
            RelayPlan::Mismatch => format!("relay_mismatch:{}", relay.trim()),
            other => panic!("atteso Mismatch, trovato {other:?}"),
        };
        assert!(error.starts_with("relay_mismatch:"));
        assert_eq!(error.trim_start_matches("relay_mismatch:"), relay);
    }

    #[test]
    fn the_full_code_carries_the_relay_token_and_a_short_code_is_never_one() {
        let code = PairingCode {
            protocol: PROTOCOL,
            address: Address { id: "mac".into(), relay: "https://iroh-relay.myapollo.it/".into(), ips: vec![] },
            token: "one-shot".into(),
            relay_token: Some("relay-secret".into()),
        };
        let encoded = format!("studio1:{}", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&code).unwrap()));
        // R-MI-53: una macchina che non sa nulla ricava relay e token dal codice.
        let decoded: PairingCode = serde_json::from_slice(
            &URL_SAFE_NO_PAD.decode(encoded.trim_start_matches("studio1:")).unwrap()
        ).unwrap();
        assert_eq!(decoded.address.relay, code.address.relay);
        assert_eq!(decoded.relay_token.as_deref(), Some("relay-secret"));
        // Un codice completo non e' scambiato per un codice corto (R-MI-55).
        assert!(depot::normalize_short_code(&encoded).is_none());
    }

    #[test]
    fn a_lan_pairing_writes_the_peer_only_after_the_confirmation() {
        // R-MI-54: il rifiuto non lascia nulla, e senza accettazione la
        // richiesta non arriva nemmeno a scrivere.
        let ok = lan_admission(true, PROTOCOL, true, true, false, true).unwrap();
        assert_eq!(ok, LanAdmission::AwaitingAnswer);
        assert!(lan_pair_writes_peer(&ok, true), "accettata: il peer si scrive");
        assert!(!lan_pair_writes_peer(&ok, false), "rifiutata o scaduta: niente peer");
        for refused in [
            LanAdmission::DiscoveryClosed,
            LanAdmission::Incompatible,
            LanAdmission::IdentityMismatch,
            LanAdmission::SelfPair,
            LanAdmission::ConfirmationMismatch,
        ] {
            assert!(!lan_pair_writes_peer(&refused, true), "{refused:?}");
        }
    }

    #[test]
    fn lan_pairing_refuses_a_closed_path_or_a_mismatched_confirmation() {
        // Nessun annuncio fuori dal percorso: una richiesta che arriva lo
        // stesso viene rifiutata prima di mostrare qualcosa.
        assert_eq!(lan_admission(false, PROTOCOL, true, true, false, true), Err(LanAdmission::DiscoveryClosed));
        // Il numero mostrato deve essere lo stesso sulle due macchine.
        assert_eq!(lan_admission(true, PROTOCOL, true, true, false, false), Err(LanAdmission::ConfirmationMismatch));
        // Versione o protocollo diversi: si aggiorna prima.
        assert_eq!(lan_admission(true, PROTOCOL + 1, true, true, false, true), Err(LanAdmission::Incompatible));
        assert_eq!(lan_admission(true, PROTOCOL, false, true, false, true), Err(LanAdmission::Incompatible));
        // Una chiave che non corrisponde alla connessione non e' quella macchina.
        assert_eq!(lan_admission(true, PROTOCOL, true, false, false, true), Err(LanAdmission::IdentityMismatch));
        assert_eq!(lan_admission(true, PROTOCOL, true, true, true, true), Err(LanAdmission::SelfPair));
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

    /// Comandi instradati che girano sul worker tokio di `dispatch`, quindi
    /// anche quelli **sincroni**, che in locale prendono il main thread.
    /// `dispatch` non li sposta sul main thread: un comando sincrono che
    /// tocca finestre, menu o tray lo farebbe da un thread sbagliato, che e'
    /// la classe del crash tao (S2-18). Oggi nessuno lo fa; questo test
    /// impedisce che ne compaia uno domani. Un comando che ne ha bisogno va
    /// reso `async` e spostato sul main thread, oppure aggiunto qui dopo la
    /// verifica.
    const ROUTED_SYNC_COMMANDS: &[(&str, &str)] = &[
        ("background_job_cancel", "task_title_ops.rs"),
        ("omp_sync_apply", "link/omp_settings.rs"),
        ("omp_sync_snapshot", "link/omp_settings.rs"),
        ("omp_update_remote_start", "omp_ops.rs"),
        ("omp_update_remote_status", "omp_ops.rs"),
        ("studio_update_remote_status", "studio_updater.rs"),
        ("system_idle_seconds", "system_idle.rs"),
    ];

    /// API che vanno chiamate solo dal main thread di Tauri.
    const MAIN_THREAD_APIS: &[&str] = &[
        "get_webview_window", "get_window(", "WebviewWindowBuilder", "MenuBuilder", "SubmenuBuilder",
        "MenuItemBuilder", "PredefinedMenuItem", "TrayIconBuilder", "show_main_window", "hide_main_window",
        "set_activation_policy", "set_focus(", "window.show(", "window.hide(",
    ];

    /// Corpo di `fn <name>` in `source`, dal `{` alla sua chiusura.
    fn function_body<'a>(source: &'a str, name: &str) -> Option<&'a str> {
        let needle = format!("fn {name}");
        let start = source.find(&needle)?;
        let open = start + source[start..].find('{')?;
        let mut depth = 0usize;
        for (offset, character) in source[open..].char_indices() {
            match character {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 { return Some(&source[open..open + offset]); }
                }
                _ => {}
            }
        }
        None
    }

    #[test]
    fn routed_synchronous_commands_do_not_touch_windows_menu_or_tray() {
        // Ogni nome deve esistere nel catalogo ed essere davvero instradato:
        // un comando `local` o sconosciuto sarebbe una lista inutile.
        for (command, _) in ROUTED_SYNC_COMMANDS {
            let scope = catalog::permission(command);
            assert!(scope.is_some(), "{command} non e' nel catalogo");
            assert_ne!(scope, Some("local"), "{command} non viene instradato");
        }
        for (command, file) in ROUTED_SYNC_COMMANDS {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file);
            let source = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            let body = function_body(&source, command)
                .unwrap_or_else(|| panic!("{command} non trovato in {}", path.display()));
            // Deve restare sincrono (e' la ragione per cui sta in questa lista):
            // se qualcuno lo rende `async`, va tolto da qui.
            let declaration = &source[source.find(&format!("fn {command}")).unwrap()..];
            assert!(!declaration[..declaration.find('{').unwrap_or(declaration.len())].contains("async"),
                "{command} e' async: toglilo da ROUTED_SYNC_COMMANDS");
            for api in MAIN_THREAD_APIS {
                assert!(!body.contains(api), "{command} chiama {api} dal worker tokio di `dispatch`");
            }
        }
    }
}
