//! Distribuzione degli eventi di una sessione omp a piu' consumatori (Gate R49, MI02).
//!
//! Prima il lettore di stdout spediva ogni frame al solo `Channel` della
//! finestra che aveva aperto la sessione. Una seconda finestra non poteva
//! agganciarsi, e dopo una ricarica della WebView i frame finivano nel vuoto
//! mentre la finestra ricaricata avviava un secondo omp sullo stesso progetto.
//!
//! Qui ogni frame riceve un numero crescente, resta per un po' in una coda
//! limitata e va a tutti i consumatori iscritti. Chi si riaggancia indicando
//! l'ultimo numero visto riceve il seguito senza buchi ne' duplicati, se la
//! coda lo contiene ancora; altrimenti riparte dal frame `ready` e ricostruisce
//! lo stato chiedendolo a omp, come all'avvio.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::diag::RpcStats;

/// Tetti della coda di ripresa: bastano a coprire un collegamento caduto per
/// qualche minuto durante lo streaming senza tenere in memoria una sessione
/// intera. Un frame piu' grande del tetto non resta in coda: chi lo perde
/// riparte da `ready`.
const BACKLOG_MAX_BYTES: usize = 4 * 1024 * 1024;
const BACKLOG_MAX_FRAMES: usize = 4096;

/// Quanto una sessione resta viva senza consumatori. Dopo una ricarica della
/// finestra le superfici GUI si riaprono in pochi secondi e la riprendono;
/// oltre questo tempo nessuno la reclamera' piu' e il suo omp va chiuso.
pub(super) const ORPHAN_GRACE: Duration = Duration::from_secs(600);

/// Destinazione dei frame di una sessione. `false` quando non puo' piu'
/// riceverne: il distributore la toglie dagli iscritti.
pub(crate) trait FrameSink: Send {
    fn deliver(&mut self, seq: u64, kind: &str, frame: &str) -> bool;
    fn caught_up(&mut self, _seq: u64) -> bool { true }
}

/// Il `Channel` di una WebView. Il numero di sequenza non le serve: dopo una
/// ricarica il suo stato e' perso e si ricostruisce comunque da `ready`.
pub(crate) struct ChannelSink {
    channel: Channel<InvokeResponseBody>,
    stats: Arc<RpcStats>,
}

impl ChannelSink {
    pub(crate) fn new(channel: Channel<InvokeResponseBody>, stats: Arc<RpcStats>) -> Self {
        Self { channel, stats }
    }
}

impl FrameSink for ChannelSink {
    fn deliver(&mut self, _seq: u64, kind: &str, frame: &str) -> bool {
        self.stats.send(&self.channel, kind, frame.to_owned())
    }
}

/// Punto da cui riprende un consumatore.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Resume {
    /// Consumatore senza stato: riceve `ready` e ricostruisce.
    Fresh,
    /// Ultimo numero ricevuto: riceve i frame successivi. La usa chi tiene il
    /// conto dei numeri, cioe' il collegamento fra istanze (MI06): una WebView
    /// ricaricata perde tutto e riparte sempre da `Fresh`.
    #[cfg_attr(not(test), allow(dead_code))]
    After(u64),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Attached {
    pub consumer_id: u64,
    /// Vero se il consumatore ha ricevuto tutti i frame dopo quello indicato;
    /// falso se riparte da `ready` e deve ricostruire lo stato.
    pub continued: bool,
    pub last_seq: u64,
}

struct Backlogged {
    seq: u64,
    kind: Box<str>,
    frame: String,
}

struct Consumer {
    #[cfg_attr(not(test), allow(dead_code))]
    id: u64,
    /// Etichetta della WebView che si e' iscritta, se e' una WebView: alla
    /// sua ricarica l'iscrizione cade (`detach_owner`).
    owner: Option<String>,
    sink: Box<dyn FrameSink>,
}

struct HubInner {
    next_seq: u64,
    backlog: VecDeque<Backlogged>,
    backlog_bytes: usize,
    /// L'handshake del processo, emesso una sola volta: e' cio' da cui riparte
    /// un consumatore che non puo' riprendere dalla coda.
    ready: Option<(u64, String)>,
    /// Stato pubblicato dalle estensioni (`setStatus`, `setWidget`): l'ultimo
    /// per chiave. Chi si aggancia dopo vede piano, obiettivo e loop correnti.
    retained: Vec<(String, u64, String)>,
    /// Domande dell'agente ancora senza risposta (MI04, R-MI-07): chi si
    /// aggancia dopo le vede, la prima risposta le chiude per tutti.
    pending_ui: Vec<(String, u64, String)>,
    answered_ui: VecDeque<String>,
    consumers: Vec<Consumer>,
    next_consumer_id: u64,
    orphaned_since: Option<Instant>,
}

/// Esito della consegna di una risposta a una domanda dell'agente.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum UiClaim {
    /// Prima risposta: va a omp, le altre finestre chiudono la domanda.
    Accepted,
    /// Un'altra finestra ha gia' risposto: questa non deve arrivare a omp.
    AlreadyAnswered,
    /// Id mai visto (frame precedente all'aggancio o richiesta senza
    /// tracciamento): la risposta passa come prima.
    Unknown,
}

/// Metodi di `extension_ui_request` che non aspettano risposta.
const UI_METHODS_WITHOUT_ANSWER: &[&str] = &[
    "notify",
    "setStatus",
    "setWidget",
    "setTitle",
    "open_url",
    "set_editor_text",
    "cancel",
];
const ANSWERED_UI_KEPT: usize = 256;

#[derive(serde::Deserialize)]
struct UiRequestPeek {
    id: Option<String>,
    method: Option<String>,
    #[serde(rename = "targetId")]
    target_id: Option<String>,
    #[serde(rename = "statusKey")]
    status_key: Option<String>,
    #[serde(rename = "widgetKey")]
    widget_key: Option<String>,
}

pub(crate) struct SessionHub {
    inner: Mutex<HubInner>,
    response_gate: Mutex<()>,
}

impl SessionHub {
    pub(crate) fn new() -> Self {
        Self {
            response_gate: Mutex::new(()),
            inner: Mutex::new(HubInner {
                next_seq: 1,
                backlog: VecDeque::new(),
                backlog_bytes: 0,
                ready: None,
                retained: Vec::new(),
                pending_ui: Vec::new(),
                answered_ui: VecDeque::new(),
                consumers: Vec::new(),
                next_consumer_id: 1,
                orphaned_since: Some(Instant::now()),
            }),
        }
    }

    /// Numera il frame, lo consegna a tutti gli iscritti e lo mette in coda.
    /// Consegna e coda stanno sotto lo stesso lock di `attach`: un consumatore
    /// che si aggancia vede ogni frame una volta sola.
    pub(crate) fn publish(&self, kind: &str, frame: String) {
        let mut inner = self.inner.lock();
        let seq = inner.next_seq;
        inner.next_seq += 1;

        inner
            .consumers
            .retain_mut(|consumer| consumer.sink.deliver(seq, kind, &frame));
        if inner.consumers.is_empty() && inner.orphaned_since.is_none() {
            inner.orphaned_since = Some(Instant::now());
        }

        if kind == "ready" {
            inner.ready = Some((seq, frame.clone()));
        } else if kind == "extension_ui_request" {
            track_ui_request(&mut inner, seq, &frame);
        }
        inner.backlog_bytes += frame.len();
        inner.backlog.push_back(Backlogged {
            seq,
            kind: kind.into(),
            frame,
        });
        while inner.backlog_bytes > BACKLOG_MAX_BYTES || inner.backlog.len() > BACKLOG_MAX_FRAMES {
            let Some(evicted) = inner.backlog.pop_front() else {
                break;
            };
            inner.backlog_bytes -= evicted.frame.len();
        }
    }

    /// Serializza le risposte fino alla scrittura effettiva: un rifiuto di
    /// ammissione o un errore di stdin non deve chiudere la domanda.
    pub(crate) fn answer_ui_request(
        &self,
        id: &str,
        send: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), serde_json::Value> {
        let _gate = self.response_gate.lock();
        if self.inner.lock().answered_ui.iter().any(|answered| answered == id) {
            return Err(serde_json::json!({
                "code": "ui_already_answered",
                "requestId": id,
                "message": crate::tr!(
                    "Questa domanda ha gia' ricevuto una risposta da un'altra finestra",
                    "This question was already answered from another window"
                ),
            }));
        }
        if !self.inner.lock().pending_ui.iter().any(|(pending, _, _)| pending == id) {
            return Err(serde_json::json!({
                "code": "ui_request_closed",
                "requestId": id,
                "message": crate::tr!(
                    "Questa domanda non e' piu' in attesa di risposta",
                    "This question is no longer waiting for an answer"
                ),
            }));
        }
        send().map_err(serde_json::Value::String)?;
        self.claim_ui_response(id);
        Ok(())
    }

    /// Registra la risposta di una finestra a una domanda dell'agente. Con
    /// `Accepted` le altre finestre ricevono la chiusura della domanda.
    fn claim_ui_response(&self, id: &str) -> UiClaim {
        let claim = {
            let mut inner = self.inner.lock();
            if let Some(index) = inner.pending_ui.iter().position(|(pending, _, _)| pending == id) {
                inner.pending_ui.remove(index);
                remember_answered(&mut inner, id);
                UiClaim::Accepted
            } else if inner.answered_ui.iter().any(|answered| answered == id) {
                UiClaim::AlreadyAnswered
            } else {
                remember_answered(&mut inner, id);
                UiClaim::Unknown
            }
        };
        if claim == UiClaim::Accepted {
            let closed = serde_json::json!({
                "type": "extension_ui_request",
                "id": format!("studio-answered-{id}"),
                "method": "cancel",
                "targetId": id,
                "answeredElsewhere": true,
            });
            self.publish("extension_ui_request", closed.to_string());
        }
        claim
    }

    /// Iscrive un consumatore. Con `Resume::After` riceve prima i frame persi,
    /// se la coda li contiene ancora tutti; altrimenti, come con `Fresh`,
    /// riceve il frame `ready` gia' emesso e da li' i frame nuovi.
    pub(crate) fn attach(
        &self,
        mut sink: Box<dyn FrameSink>,
        owner: Option<String>,
        resume: Resume,
    ) -> Result<Attached, String> {
        let mut inner = self.inner.lock();
        let last_seq = inner.next_seq - 1;
        let first_available = inner
            .backlog
            .front()
            .map_or(inner.next_seq, |frame| frame.seq);

        let continued = match resume {
            Resume::After(seen) if seen <= last_seq && seen + 1 >= first_available => {
                for frame in inner.backlog.iter().filter(|frame| frame.seq > seen) {
                    if !sink.deliver(frame.seq, &frame.kind, &frame.frame) {
                        return Err(attach_failed());
                    }
                }
                true
            }
            _ => {
                if let Some((seq, frame)) = &inner.ready {
                    if !sink.deliver(*seq, "ready", frame) {
                        return Err(attach_failed());
                    }
                }
                let mut retained = inner.retained.iter().peekable();
                let mut pending = inner.pending_ui.iter().peekable();
                loop {
                    let next = match (retained.peek(), pending.peek()) {
                        (Some(a), Some(b)) if a.1 <= b.1 => retained.next(),
                        (Some(_), Some(_)) | (None, Some(_)) => pending.next(),
                        (Some(_), None) => retained.next(),
                        (None, None) => break,
                    };
                    if let Some((_, seq, frame)) = next {
                        if !sink.deliver(*seq, "extension_ui_request", frame) {
                            return Err(attach_failed());
                        }
                    }
                }
                false
            }
        };
        if !sink.caught_up(last_seq) {
            return Err(attach_failed());
        }

        let consumer_id = inner.next_consumer_id;
        inner.next_consumer_id += 1;
        inner.consumers.push(Consumer {
            id: consumer_id,
            owner,
            sink,
        });
        inner.orphaned_since = None;
        Ok(Attached {
            consumer_id,
            continued,
            last_seq,
        })
    }

    /// Uscita volontaria di un consumatore che resta in vita (collegamento
    /// fra istanze); la WebView esce con `detach_owner`. Oggi la esercita solo
    /// il test di ripresa: nessun percorso di produzione chiude un solo
    /// consumatore senza chiudere la superficie.
    #[cfg(test)]
    pub(crate) fn detach(&self, consumer_id: u64) -> bool {
        let mut inner = self.inner.lock();
        let before = inner.consumers.len();
        inner
            .consumers
            .retain(|consumer| consumer.id != consumer_id);
        let removed = inner.consumers.len() != before;
        if removed && inner.consumers.is_empty() {
            inner.orphaned_since = Some(Instant::now());
        }
        removed
    }

    /// Toglie le iscrizioni di una WebView che si sta ricaricando: il suo
    /// `Channel` non ha piu' nessuno in ascolto.
    pub(crate) fn detach_owner(&self, owner: &str) -> usize {
        let mut inner = self.inner.lock();
        let before = inner.consumers.len();
        inner
            .consumers
            .retain(|consumer| consumer.owner.as_deref() != Some(owner));
        let removed = before - inner.consumers.len();
        if removed > 0 && inner.consumers.is_empty() {
            inner.orphaned_since = Some(Instant::now());
        }
        removed
    }

    pub(crate) fn conversation_changed(&self, request_id: Option<&str>) {
        {
            let mut inner = self.inner.lock();
            inner.pending_ui.clear();
            inner.answered_ui.clear();
        }
        self.publish("studio_session_changed", serde_json::json!({
            "type": "studio_session_changed",
            "requestId": request_id,
        }).to_string());
    }

    pub(crate) fn is_orphaned(&self) -> bool {
        self.inner.lock().consumers.is_empty()
    }

    pub(crate) fn has_owner(&self, owner: &str) -> bool {
        self.inner
            .lock()
            .consumers
            .iter()
            .any(|consumer| consumer.owner.as_deref() == Some(owner))
    }

    /// Toglie dagli iscritti tutti tranne `keep_out`: «Nuova chat» chiesta da
    /// una finestra porta con se' le altre sulla sessione che la sostituisce.
    pub(crate) fn take_consumers_except(
        &self,
        closer: &str,
    ) -> Vec<(Option<String>, Box<dyn FrameSink>)> {
        let mut inner = self.inner.lock();
        let consumers = std::mem::take(&mut inner.consumers);
        let mut taken = Vec::new();
        for consumer in consumers {
            if consumer.owner.as_deref() == Some(closer) {
                continue;
            }
            taken.push((consumer.owner, consumer.sink));
        }
        inner.orphaned_since = Some(Instant::now());
        taken
    }

    /// Da quanto la sessione e' senza consumatori, se lo e'.
    pub(crate) fn orphaned_for(&self, now: Instant) -> Option<Duration> {
        let inner = self.inner.lock();
        if !inner.consumers.is_empty() {
            return None;
        }
        inner
            .orphaned_since
            .map(|since| now.saturating_duration_since(since))
    }
}

fn remember_answered(inner: &mut HubInner, id: &str) {
    if inner.answered_ui.len() == ANSWERED_UI_KEPT {
        inner.answered_ui.pop_front();
    }
    inner.answered_ui.push_back(id.to_string());
}

fn track_ui_request(inner: &mut HubInner, seq: u64, frame: &str) {
    let Ok(peek) = serde_json::from_str::<UiRequestPeek>(frame) else {
        return;
    };
    let Some(method) = peek.method.as_deref() else {
        return;
    };
    match method {
        "cancel" => {
            if let Some(target) = peek.target_id.as_deref() {
                inner.pending_ui.retain(|(id, _, _)| id != target);
            }
        }
        "setStatus" | "setWidget" => {
            let key = match (method, peek.status_key, peek.widget_key) {
                ("setStatus", Some(key), _) => format!("status:{key}"),
                ("setWidget", _, Some(key)) => format!("widget:{key}"),
                _ => return,
            };
            inner.retained.retain(|(retained, _, _)| retained != &key);
            inner.retained.push((key, seq, frame.to_string()));
        }
        method if UI_METHODS_WITHOUT_ANSWER.contains(&method) => {}
        _ => {
            if let Some(id) = peek.id {
                inner.pending_ui.push((id, seq, frame.to_string()));
            }
        }
    }
}

fn attach_failed() -> String {
    crate::tr!(
        "Il consumatore della sessione RPC non riceve i frame",
        "The RPC session consumer does not receive frames"
    )
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    type Received = Arc<Mutex<Vec<(u64, String)>>>;

    struct Recorder {
        received: Received,
        alive: Arc<std::sync::atomic::AtomicBool>,
    }

    impl FrameSink for Recorder {
        fn deliver(&mut self, seq: u64, _kind: &str, frame: &str) -> bool {
            if !self.alive.load(std::sync::atomic::Ordering::SeqCst) {
                return false;
            }
            self.received.lock().push((seq, frame.to_owned()));
            true
        }
    }

    fn recorder() -> (
        Box<dyn FrameSink>,
        Received,
        Arc<std::sync::atomic::AtomicBool>,
    ) {
        let received: Received = Arc::new(Mutex::new(Vec::new()));
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        (
            Box::new(Recorder {
                received: received.clone(),
                alive: alive.clone(),
            }),
            received,
            alive,
        )
    }

    fn frames(received: &Received) -> Vec<String> {
        received
            .lock()
            .iter()
            .map(|(_, frame)| frame.clone())
            .collect()
    }

    #[test]
    fn due_consumatori_ricevono_gli_stessi_frame_e_la_ripresa_non_lascia_buchi_ne_doppioni() {
        let hub = SessionHub::new();
        let (first, first_received, _) = recorder();
        let (second, second_received, _) = recorder();
        hub.attach(first, Some("main".into()), Resume::Fresh)
            .unwrap();
        hub.publish("ready", r#"{"type":"ready"}"#.into());
        let second_id = hub
            .attach(second, Some("remote".into()), Resume::Fresh)
            .unwrap()
            .consumer_id;

        hub.publish("message_start", "m1".into());
        hub.publish("message_update", "m2".into());
        let last_seen = second_received.lock().last().unwrap().0;
        assert!(hub.detach(second_id));

        // Il turno continua mentre il secondo consumatore e' scollegato.
        hub.publish("message_update", "m3".into());
        hub.publish("message_end", "m4".into());

        let (again, again_received, _) = recorder();
        let attached = hub
            .attach(again, Some("remote".into()), Resume::After(last_seen))
            .unwrap();
        assert!(attached.continued);
        hub.publish("agent_end", "m5".into());

        assert_eq!(
            frames(&first_received),
            vec![r#"{"type":"ready"}"#, "m1", "m2", "m3", "m4", "m5"]
        );
        assert_eq!(
            frames(&second_received),
            vec![r#"{"type":"ready"}"#, "m1", "m2"]
        );
        assert_eq!(frames(&again_received), vec!["m3", "m4", "m5"]);
        let seqs: Vec<u64> = again_received.lock().iter().map(|(seq, _)| *seq).collect();
        assert_eq!(seqs, vec![last_seen + 1, last_seen + 2, last_seen + 3]);
    }

    #[test]
    fn ripresa_oltre_la_coda_riparte_da_ready_e_chiede_la_ricostruzione() {
        let hub = SessionHub::new();
        hub.publish("ready", "ready".into());
        let big = "x".repeat(BACKLOG_MAX_BYTES / 2 + 1);
        hub.publish("message_end", big.clone());
        hub.publish("message_end", big.clone());
        hub.publish("message_end", big);

        let (sink, received, _) = recorder();
        let attached = hub.attach(sink, None, Resume::After(1)).unwrap();
        assert!(!attached.continued);
        assert_eq!(frames(&received), vec!["ready"]);

        hub.publish("agent_end", "dopo".into());
        assert_eq!(frames(&received), vec!["ready", "dopo"]);
    }

    #[test]
    fn la_ricarica_di_una_finestra_lascia_la_sessione_ai_consumatori_rimasti() {
        let hub = SessionHub::new();
        let (main, _, _) = recorder();
        let (remote, remote_received, _) = recorder();
        hub.attach(main, Some("main".into()), Resume::Fresh)
            .unwrap();
        hub.attach(remote, Some("remote".into()), Resume::Fresh)
            .unwrap();

        assert_eq!(hub.detach_owner("main"), 1);
        assert!(!hub.is_orphaned());
        hub.publish("message_end", "ancora".into());
        assert_eq!(frames(&remote_received), vec!["ancora"]);

        assert_eq!(hub.detach_owner("remote"), 1);
        assert!(hub.is_orphaned());
        assert!(hub.orphaned_for(Instant::now()).is_some());
    }

    #[test]
    fn un_consumatore_che_non_riceve_piu_viene_tolto_senza_fermare_gli_altri() {
        let hub = SessionHub::new();
        let (dead, _, dead_alive) = recorder();
        let (live, live_received, _) = recorder();
        hub.attach(dead, None, Resume::Fresh).unwrap();
        hub.attach(live, None, Resume::Fresh).unwrap();

        dead_alive.store(false, std::sync::atomic::Ordering::SeqCst);
        hub.publish("message_end", "uno".into());
        hub.publish("message_end", "due".into());

        assert_eq!(frames(&live_received), vec!["uno", "due"]);
        assert!(!hub.is_orphaned());
    }
    #[test]
    fn risposta_fallita_resta_visibile_e_puo_essere_ritentata() {
        let hub = SessionHub::new();
        let request = r#"{"type":"extension_ui_request","method":"input","id":"q1"}"#;
        hub.publish("extension_ui_request", request.into());
        assert!(hub.answer_ui_request("q1", || Err("stdin closed".into())).is_err());
        let (sink, received, _) = recorder();
        hub.attach(sink, None, Resume::Fresh).unwrap();
        assert_eq!(frames(&received), vec![request]);
        hub.answer_ui_request("q1", || Ok(())).unwrap();
        let (late, late_received, _) = recorder();
        hub.attach(late, None, Resume::Fresh).unwrap();
        assert!(frames(&late_received).is_empty());
        assert!(hub.answer_ui_request("q1", || panic!("duplicate write")).is_err());
    }

    #[test]
    fn due_risposte_concorrenti_scrivono_solo_la_prima() {
        let hub = Arc::new(SessionHub::new());
        hub.publish("extension_ui_request",
            r#"{"type":"extension_ui_request","method":"input","id":"q1"}"#.into());
        let writes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = (0..2).map(|_| {
            let hub = hub.clone();
            let writes = writes.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                hub.answer_ui_request("q1", || {
                    writes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(())
                })
            })
        }).collect();
        barrier.wait();
        let successes = workers.into_iter().map(|worker| worker.join().unwrap())
            .filter(Result::is_ok).count();
        assert_eq!(successes, 1);
        assert_eq!(writes.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn una_risposta_vecchia_non_torna_valida_quando_scade_la_memoria_degli_id_gia_risposti() {
        let hub = SessionHub::new();
        for index in 0..=ANSWERED_UI_KEPT {
            let id = format!("q{index}");
            hub.publish("extension_ui_request", serde_json::json!({
                "type": "extension_ui_request", "method": "input", "id": id,
            }).to_string());
            hub.answer_ui_request(&id, || Ok(())).unwrap();
        }
        let error = hub.answer_ui_request("q0", || panic!("stale answer was sent")).unwrap_err();
        assert_eq!(error["code"], "ui_request_closed");
    }

}
