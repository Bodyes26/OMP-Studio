//! Un canale nativo per superficie; la rete non possiede il processo omp.
use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use tauri::ipc::Channel;
use crate::rpc::hub::{FrameSink, Resume};
use crate::pty::hub::ByteSink;
use protocol::StreamFrame;

const MAX_QUEUED: usize = 64 * 1024 * 1024;
struct Packet { header: StreamFrame, bytes: Vec<u8> }
struct Outbox {
    sender: tokio::sync::mpsc::Sender<Packet>,
    bytes: Arc<AtomicUsize>,
    /// Diventa vero quando una consegna ha superato il tetto della coda: il
    /// consumatore deve ripartire da capo, perche' un frame scartato apre un
    /// buco nel flusso. Il giro di `open_stream` lo legge e lo azzera mentre
    /// emette `Resync`, poi riprende a inviare frame normali.
    resync: Arc<AtomicBool>,
}
impl Outbox {
    /// Segnala al mittente che la coda e' andata oltre il tetto e il
    /// consumatore va rimesso in pari (B1). Non azzera qui: il flag si
    /// consuma nel giro di `open_stream`, che emette `Resync` e poi torna a
    /// inviare i frame, svuotando la coda.
    fn overflow(&self) {
        self.resync.store(true, Ordering::SeqCst);
    }
    fn queue(&self, header: StreamFrame, size: usize, bytes: impl FnOnce() -> Vec<u8>) -> bool {
        if self.bytes.fetch_add(size, Ordering::SeqCst).saturating_add(size) > MAX_QUEUED {
            self.bytes.fetch_sub(size, Ordering::SeqCst);
            self.overflow();
            return false;
        }
        if self.sender.try_send(Packet { header, bytes: bytes() }).is_err() {
            self.bytes.fetch_sub(size, Ordering::SeqCst);
            self.overflow();
            return false;
        }
        true
    }
    fn push(&self, header: StreamFrame, bytes: &[u8]) -> bool {
        self.queue(header, bytes.len(), || bytes.to_vec())
    }
}
impl FrameSink for Outbox {
    fn deliver(&mut self, seq: u64, kind: &str, frame: &str) -> bool {
        let header = match kind {
            "studio_rebind" => {
                let Ok(value) = serde_json::from_str::<Value>(frame) else { return false; };
                let Some(id) = value.get("rpcId").and_then(Value::as_u64) else { return false; };
                StreamFrame::Rebind { id, len: frame.len() }
            }
            "studio_exit" => StreamFrame::Exit { seq, len: frame.len() },
            _ => StreamFrame::Rpc { seq, len: frame.len() },
        };
        self.push(header, frame.as_bytes())
    }
    fn caught_up(&mut self, seq: u64) -> bool {
        self.push(StreamFrame::Cursor { seq }, &[])
    }
}
impl ByteSink for Outbox {
    fn deliver(&mut self, offset: u64, bytes: &[u8]) -> bool {
        self.push(StreamFrame::Bytes { offset, len: bytes.len() }, bytes)
    }
    fn snapshot(&mut self, offset: u64, bytes: Vec<u8>) -> bool {
        self.queue(StreamFrame::Snapshot { offset, len: bytes.len() }, bytes.len(), || bytes)
    }
    fn resize(&mut self, cols: u16, rows: u16) -> bool {
        self.push(StreamFrame::Resize { cols, rows }, &[])
    }
}

struct DetachOnExit { app: tauri::AppHandle, owner: String }
impl Drop for DetachOnExit {
    fn drop(&mut self) {
        self.app.state::<crate::rpc::RpcManager>().detach_owner(&self.owner);
        self.app.state::<crate::pty::PtyManager>().detach_window(&self.owner);
    }
}

/// Tiene occupata la corsia finché la superficie remota resta aperta: il
/// conto si fa all'apertura e si disfa all'uscita, qualunque sia la ragione
/// (chiusura del flusso, rete caduta, processo finito). R-MI-18.
struct ActivityGuard {
    app: tauri::AppHandle,
    activity: activity::SharedActivity,
    project: String,
    lane: String,
    peer_id: String,
}
impl ActivityGuard {
    fn new(app: tauri::AppHandle, activity: activity::SharedActivity, project: String, lane: String, peer_id: String) -> Self {
        activity.attach(&project, &lane, &peer_id);
        publish_activity(&app, &activity);
        Self { app, activity, project, lane, peer_id }
    }
}
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        self.activity.detach(&self.project, &self.lane, &self.peer_id);
        // La corsia si libera subito, senza aspettare che il frontend
        // interroghi: chi guarda vede il progetto tornare fermo.
        publish_activity(&self.app, &self.activity);
    }
}

/// Manda il riepilogo alla finestra proprietaria. Il payload è piccolo e
/// cambia solo ai confini del run, non a ogni token.
fn publish_activity(app: &tauri::AppHandle, activity: &activity::SharedActivity) {
    let snapshot = activity::LinkActivitySnapshot {
        revision: activity.revision(),
        lanes: activity.snapshot(),
    };
    if let Err(error) = app.emit("link:activity", &snapshot) {
        crate::studio_log::info("link", format!("Pubblicazione attivita' corsie: {error}"));
    }
}

/// Corsia a cui appartiene la sessione richiesta. `rpc_open_lab` non ha un
/// progetto vero e proprio: si tiene la sua chiave come corsia, così due
/// prototipi non si confondono.
fn lane_of(args: &Value) -> Option<(String, String)> {
    let project = args.get("projectId").and_then(Value::as_str)
        .or_else(|| args.get("prototypeId").and_then(Value::as_str))?;
    let lane = args.get("laneId").and_then(Value::as_str).unwrap_or("main");
    Some((project.to_owned(), lane.to_owned()))
}

pub(super) enum Surface {
    Rpc(Channel<InvokeResponseBody>),
    Pty(Channel<Response>),
}
impl Surface {
    fn deliver(&self, bytes: Vec<u8>) -> bool {
        match self {
            Self::Rpc(channel) => String::from_utf8(bytes).ok()
                .is_some_and(|frame| channel.send(InvokeResponseBody::Json(frame)).is_ok()),
            Self::Pty(channel) => channel.send(Response::new(bytes)).is_ok(),
        }
    }
    fn resize(&self, cols: u16, rows: u16) -> bool {
        match self {
            Self::Pty(channel) => channel.send(Response::new(InvokeResponseBody::Json(
                format!(r#"{{"type":"studio_pty_resize","cols":{cols},"rows":{rows}}}"#)
            ))).is_ok(),
            Self::Rpc(_) => false,
        }
    }
}

pub(super) struct Subscription {
    pub machine: String,
    pub window: String,
    pub command: String,
    pub id: AtomicU64,
    pub token: Mutex<String>,
    closed: AtomicBool,
    cancelled: tokio::sync::Notify,
}
impl Subscription {
    pub(super) fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.cancelled.notify_one();
    }
}

impl Runtime {
    // La firma espone i pezzi della richiesta remota (comando, argomenti,
    // consumatore, ripresa) e i due capi del flusso: raggrupparli in una
    // struct non toglierebbe un solo campo.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn open_stream(
        &self, connection: &Connection, command: String, args: Value, consumer: String,
        session_id: Option<u64>, after: Option<u64>, send: &mut iroh::endpoint::SendStream,
        generation: u64,
    ) -> Result<(), String> {
        let machine = connection.remote_id().to_string();
        if consumer.len() > 128 || consumer.is_empty() { return Err("Invalid stream consumer".into()); }
        if self.authorize(&machine, &command, generation)? != "stream" { return Err("Not a streaming command".into()); }
        // Corsia della sessione, per dire alla finestra proprietaria che è
        // occupata (R-MI-18). Il terminale non ha una corsia con agente: solo
        // le sessioni RPC entrano nel conteggio.
        let lane = (command == "rpc_open" || command == "rpc_open_lab")
            .then(|| lane_of(&args))
            .flatten();
        let owner = format!("link:{machine}:{consumer}");
        let _detach = DetachOnExit { app: self.app.clone(), owner: owner.clone() };
        let _activity = lane.as_ref().map(|(project, lane)| {
            ActivityGuard::new(self.app.clone(), self.activity.clone(), project.clone(), lane.clone(), machine.clone())
        });
        let (tx, mut rx) = tokio::sync::mpsc::channel(8192);
        let queued = Arc::new(AtomicUsize::new(0));
        let resync = Arc::new(AtomicBool::new(false));
        let outbox = Outbox { sender: tx, bytes: queued.clone(), resync: resync.clone() };
        // Aprire un terminale o una sessione nuova esegue qualcosa (R-MI-39);
        // riagganciarsi a una gia' aperta e' solo guardare.
        if session_id.is_none() {
            self.audit(&machine, super::catalog::permission(&command).unwrap_or("read"), &command, &args);
        }
        let app = self.app.clone();
        let opening_command = command.clone();
        let (id, continued) = tokio::task::spawn_blocking(move || -> Result<(u64, bool), String> {
            match opening_command.as_str() {
                "rpc_open" | "rpc_open_lab" => {
                    let manager = app.state::<crate::rpc::RpcManager>();
                    let consumer = crate::rpc::NewConsumer::sink(owner, Box::new(outbox));
                    if let Some(id) = session_id {
                        let attached = manager.attach(id, consumer, after.map_or(Resume::Fresh, Resume::After))?;
                        Ok((id, attached.continued))
                    } else {
                        let id = if opening_command == "rpc_open" {
                            crate::rpc::open_main_session(&manager, serde_json::from_value(args).map_err(|error| error.to_string())?, consumer)?
                        } else {
                            crate::rpc::open_lab_session(&manager, serde_json::from_value(args).map_err(|error| error.to_string())?, consumer)?
                        };
                        Ok((id, false))
                    }
                }
                "pty_open" => {
                    let manager = app.state::<crate::pty::PtyManager>();
                    let args: crate::pty::OpenPtyArgs = serde_json::from_value(args).map_err(|error| error.to_string())?;
                    if let Some(id) = session_id {
                        let (_, continued) = manager.attach(id, Box::new(outbox), owner, (args.cols, args.rows), after)?;
                        Ok((id, continued))
                    } else {
                        crate::pty::open_session(&manager, args, Box::new(outbox), owner).map(|id| (id, false))
                    }
                }
                _ => Err("Unknown streaming command".into()),
            }
        }).await.map_err(|error| error.to_string())??;
        send_json(send, &Reply::Opened { id, continued }).await?;
        loop {
            let packet = tokio::select! {
                packet = rx.recv() => match packet { Some(packet) => packet, None => break },
                _ = connection.closed() => break,
                _ = send.stopped() => break,
            };
            self.authorize(&machine, &command, generation)?;
            // La coda dell'host ha scartato un frame per il tetto: il
            // consumatore deve ripartire da capo, non ricevere un flusso con
            // un buco. Il Resync e' un pacchetto vuoto fuori banda.
            if resync.swap(false, Ordering::SeqCst) {
                send_json(send, &StreamFrame::Resync).await?;
            }
            // Un confronto di prefisso per frame: i delta escono subito senza
            // toccare il JSON. Solo un cambio di stato del run pubblica.
            if let Some((project, lane)) = lane.as_ref() {
                if let Ok(frame) = std::str::from_utf8(&packet.bytes) {
                    if self.activity.observe(project, lane, frame) != activity::FrameEffect::Unchanged {
                        publish_activity(&self.app, &self.activity);
                    }
                }
            }
            send_json(send, &packet.header).await?;
            send.write_all(&packet.bytes).await.map_err(|error| error.to_string())?;
            queued.fetch_sub(packet.bytes.len(), Ordering::SeqCst);
        }
        Ok(())
    }

    pub(super) async fn subscribe(
        self: &Arc<Self>, machine: String, window: String, command: String, args: Value, surface: Surface,
    ) -> Result<u64, String> {
        let key = uuid::Uuid::new_v4().to_string();
        let subscription = Arc::new(Subscription {
            machine, window, command, id: AtomicU64::new(0), token: Mutex::new(String::new()),
            closed: AtomicBool::new(false), cancelled: tokio::sync::Notify::new(),
        });
        let (connection, mut recv, id, _continued) = self.start_subscription(&subscription, &args, None).await?;
        subscription.id.store(id, Ordering::SeqCst);
        self.streams.lock().insert(key.clone(), subscription.clone());
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut connection = connection;
            let mut after = None;
            loop {
                let result: Result<(), String> = loop {
                    let packet = tokio::select! {
                        _ = subscription.cancelled.notified() => break Err("Stream closed".to_string()),
                        _ = connection.closed() => break Err("Connection interrupted".to_string()),
                        packet = read_json::<StreamFrame>(&mut recv) => match packet { Ok(packet) => packet, Err(error) => break Err(error) },
                    };
                    let (len, position, snapshot, exited) = match packet {
                        StreamFrame::Cursor { seq } => { after = Some(seq); continue; }
                        StreamFrame::Resize { cols, rows } => {
                            if !surface.resize(cols, rows) {
                                subscription.close();
                                break Err("Terminal surface detached".into());
                            }
                            continue;
                        }
                        StreamFrame::Resync => {
                            // L'host ha scartato un frame per il tetto (B1):
                            // continuare lascerebbe un buco nel flusso. Si
                            // chiude e si riaggancia da capo, cosi' la
                            // superficie riceve `studio_rebind` e ricostruisce
                            // lo stato come dopo una ripresa oltre la coda.
                            after = None;
                            break Err("Host dropped frames: resubscribing from scratch".into());
                        }
                        StreamFrame::Rebind { id, len } => {
                            subscription.id.store(id, Ordering::SeqCst);
                            // Il rebind cambia la sessione (nuovo hub, nuova
                            // numerazione): la posizione di ripresa del vecchio
                            // flusso non vale piu'. L'host ha gia' riallineato
                            // con `ready` e i frame conservati, che qui sotto
                            // riporteranno `after` alla cima corretta.
                            after = None;
                            (len, 0, false, false)
                        }
                        StreamFrame::Rpc { seq, len } => (len, seq, false, false),
                        StreamFrame::Exit { seq, len } => (len, seq, false, true),
                        StreamFrame::Bytes { offset, len } => (len, offset, false, false),
                        StreamFrame::Snapshot { offset, len } => (len, offset, true, false),
                    };
                    let body = tokio::select! {
                        _ = subscription.cancelled.notified() => break Err("Stream closed".to_string()),
                        body = read_body(&mut recv, len) => match body { Ok(body) => body, Err(error) => break Err(error) },
                    };
                    if !surface.deliver(body) { subscription.close(); break Err("Surface detached".into()); }
                    if exited { subscription.close(); break Ok(()); }
                    after = Some(if subscription.command == "pty_open" && !snapshot {
                        position + len as u64
                    } else { after.map_or(position, |seen| seen.max(position)) });
                };
                if subscription.closed.load(Ordering::SeqCst) { break; }
                if let Err(error) = result { crate::studio_log::info("link", format!("Ripresa superficie {}: {error}", subscription.command)); }
                loop {
                    tokio::select! {
                        _ = subscription.cancelled.notified() => break,
                        _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                    }
                    if subscription.closed.load(Ordering::SeqCst) { break; }
                    if !runtime.config.lock().peers.contains_key(&subscription.machine) { subscription.close(); break; }
                    match runtime.start_subscription(&subscription, &args, after).await {
                        Ok((new_connection, new_recv, id, continued)) => {
                            connection = new_connection; recv = new_recv;
                            subscription.id.store(id, Ordering::SeqCst);
                            if !continued && subscription.command != "pty_open" {
                                let rebind = json!({ "type": "studio_rebind", "rpcId": id }).to_string().into_bytes();
                                if !surface.deliver(rebind) { subscription.close(); }
                            }
                            break;
                        }
                        Err(_) => continue,
                    }
                }
                if subscription.closed.load(Ordering::SeqCst) { break; }
            }
            runtime.streams.lock().remove(&key);
        });
        Ok(id)
    }

    async fn start_subscription(&self, subscription: &Subscription, args: &Value, after: Option<u64>) -> Result<(Connection, iroh::endpoint::RecvStream, u64, bool), String> {
        let connection = self.live_connection(&subscription.machine).ok_or("Machine is unreachable")?;
        let token = uuid::Uuid::new_v4().to_string();
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
        let id = subscription.id.load(Ordering::SeqCst);
        send_json(&mut send, &Operation::Open { command: subscription.command.clone(), args: args.clone(), consumer: token.clone(),
            session_id: (id != 0).then_some(id), after }).await?;
        send.finish().map_err(|error| error.to_string())?;
        let reply = tokio::time::timeout(CONNECT_TIMEOUT, read_json::<Reply>(&mut recv)).await.map_err(|_| "Opening remote surface timed out")??;
        match reply {
            Reply::Opened { id, continued } => {
                *subscription.token.lock() = token;
                Ok((connection, recv, id, continued))
            }
            Reply::Error { error } => Err(error.to_string()),
            _ => Err("Unexpected remote stream response".into()),
        }
    }
}

#[tauri::command]
pub(crate) async fn link_open_rpc(app: tauri::AppHandle, webview: tauri::Webview, machine: String, command: String, args: Value, on_event: Channel<InvokeResponseBody>, manager: tauri::State<'_, LinkManager>) -> Result<u64, String> {
    if !matches!(command.as_str(), "rpc_open" | "rpc_open_lab") { return Err("Not an RPC open command".into()); }
    manager.runtime(&app).await?.subscribe(machine, webview.label().to_owned(), command, args, Surface::Rpc(on_event)).await
}
#[tauri::command]
pub(crate) async fn link_open_pty(app: tauri::AppHandle, webview: tauri::Webview, machine: String, args: Value, on_output: Channel<Response>, manager: tauri::State<'_, LinkManager>) -> Result<u64, String> {
    manager.runtime(&app).await?.subscribe(machine, webview.label().to_owned(), "pty_open".into(), args, Surface::Pty(on_output)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_outbox_overflow_signals_resync_instead_of_silently_dropping() {
        // Senza rete: un frame oltre il tetto non passa, ma alza il flag che
        // fa emettere Resync, cosi' il consumatore sa di dover ripartire (B1).
        let (tx, _rx) = tokio::sync::mpsc::channel::<Packet>(1);
        let bytes = Arc::new(AtomicUsize::new(0));
        let resync = Arc::new(AtomicBool::new(false));
        let outbox = Outbox { sender: tx, bytes: bytes.clone(), resync: resync.clone() };
        let oversized = vec![0u8; MAX_QUEUED + 1];
        assert!(!outbox.push(StreamFrame::Rpc { seq: 1, len: oversized.len() }, &oversized));
        assert!(resync.load(Ordering::SeqCst));
        // Il contatore non e' stato toccato: il frame e' stato scartato, non
        // accodato.
        assert_eq!(bytes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn an_outbox_within_the_cap_does_not_signal_resync() {
        let (tx, _rx) = tokio::sync::mpsc::channel::<Packet>(1);
        let bytes = Arc::new(AtomicUsize::new(0));
        let resync = Arc::new(AtomicBool::new(false));
        let outbox = Outbox { sender: tx, bytes: bytes.clone(), resync: resync.clone() };
        let small = b"ok".to_vec();
        assert!(outbox.push(StreamFrame::Cursor { seq: 1 }, &small));
        assert!(!resync.load(Ordering::SeqCst));
        assert_eq!(bytes.load(Ordering::SeqCst), small.len());
    }
}
