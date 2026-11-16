//! Terminale condiviso fra piu' consumatori (Gate R49, MI03).
//!
//! L'output del PTY va a tutte le finestre iscritte (questa, un'altra istanza
//! collegata) e una coda di storia permette a chi si aggancia dopo di vedere
//! lo schermo: una finestra ricaricata o un'istanza che apre il terminale di
//! un progetto remoto. Le misure dei consumatori sono diverse: il PTY prende
//! la piu' piccola, cosi' nessuno vede righe spezzate.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::ipc::{Channel, Response};

/// La coda serve solo alla ripresa incrementale. Un nuovo consumatore riceve
/// lo stato VT, non byte tagliati a meta' di una sequenza di controllo.
const HISTORY_MAX_BYTES: usize = 1024 * 1024;

/// Come per le sessioni GUI: dopo una ricarica la superficie si riapre in
/// pochi secondi, oltre questo tempo nessuno reclamera' piu' il terminale.
pub(super) const ORPHAN_GRACE: Duration = Duration::from_secs(600);

/// Destinazione dell'output del terminale. `offset` e' la posizione del
/// primo byte nel flusso completo: chi si ricollega riparte da li'.
pub(crate) trait ByteSink: Send {
    fn deliver(&mut self, offset: u64, bytes: &[u8]) -> bool;
    fn snapshot(&mut self, offset: u64, bytes: Vec<u8>) -> bool {
        self.deliver(offset, &bytes)
    }
    fn resize(&mut self, _cols: u16, _rows: u16) -> bool { true }
}

pub(crate) struct ChannelByteSink(pub Channel<Response>);

impl ByteSink for ChannelByteSink {
    fn deliver(&mut self, _offset: u64, bytes: &[u8]) -> bool {
        self.0.send(Response::new(bytes.to_vec())).is_ok()
    }
    fn snapshot(&mut self, _offset: u64, bytes: Vec<u8>) -> bool {
        self.0.send(Response::new(bytes)).is_ok()
    }
    fn resize(&mut self, cols: u16, rows: u16) -> bool {
        self.0.send(Response::new(tauri::ipc::InvokeResponseBody::Json(
            format!(r#"{{"type":"studio_pty_resize","cols":{cols},"rows":{rows}}}"#)
        ))).is_ok()
    }
}

struct Consumer {
    owner: String,
    size: Option<(u16, u16)>,
    sink: Box<dyn ByteSink>,
}

struct Inner {
    /// Byte prodotti dal processo dall'avvio.
    written: u64,
    history: VecDeque<u8>,
    consumers: Vec<Consumer>,
    orphaned_since: Option<Instant>,
    size: (u16, u16),
    screen: vt100::Parser,
    last_resize_offset: u64,
}

pub(crate) struct TerminalHub {
    inner: Mutex<Inner>,
}

impl TerminalHub {
    pub(crate) fn new(cols: u16, rows: u16) -> Self {
        Self {
            inner: Mutex::new(Inner {
                written: 0,
                history: VecDeque::new(),
                consumers: Vec::new(),
                orphaned_since: Some(Instant::now()),
                size: (cols, rows),
                screen: vt100::Parser::new(rows, cols, 0),
                last_resize_offset: 0,
            }),
        }
    }

    pub(crate) fn publish(&self, bytes: &[u8]) {
        let mut inner = self.inner.lock();
        let offset = inner.written;
        inner.written += bytes.len() as u64;
        inner.screen.process(bytes);
        inner
            .consumers
            .retain_mut(|consumer| consumer.sink.deliver(offset, bytes));
        if inner.consumers.is_empty() && inner.orphaned_since.is_none() {
            inner.orphaned_since = Some(Instant::now());
        }
        inner.history.extend(bytes.iter().copied());
        let excess = inner.history.len().saturating_sub(HISTORY_MAX_BYTES);
        if excess > 0 {
            inner.history.drain(..excess);
        }
    }

    /// Con `after` riprende dai byte conservati; altrimenti invia uno snapshot
    /// dello schermo, compresi attributi e posizione del cursore.
    pub(crate) fn attach(
        &self,
        mut sink: Box<dyn ByteSink>,
        owner: String,
        size: Option<(u16, u16)>,
        after: Option<u64>,
    ) -> Result<(u64, bool), String> {
        if size.is_some_and(|(cols, rows)| cols == 0 || rows == 0) {
            return Err("Terminal dimensions must be positive".into());
        }
        let mut inner = self.inner.lock();
        let first_available = inner.written - inner.history.len() as u64;
        let (start, continued) = match after {
            Some(offset) if offset >= first_available && offset >= inner.last_resize_offset
                && offset <= inner.written => (offset, true),
            _ => (inner.written, false),
        };
        let replay = if continued {
            inner.history.iter().skip((start - first_available) as usize).copied().collect()
        } else if inner.written == 0 {
            Vec::new()
        } else {
            inner.screen.screen().state_formatted()
        };
        let delivered = sink.resize(inner.size.0, inner.size.1) && (replay.is_empty() || if continued {
            sink.deliver(start, &replay)
        } else {
            sink.snapshot(start, replay)
        });
        if !delivered {
            return Err(crate::tr!(
                "Il consumatore del terminale non riceve l'output",
                "The terminal consumer does not receive output"
            )
            .to_string());
        }
        inner.consumers.push(Consumer { owner, size, sink });
        inner.orphaned_since = None;
        Ok((start, continued))
    }

    /// Il resize fisico avviene sotto il lock dell'output: nessun frame della
    /// nuova geometria arriva prima della notifica ai consumatori.
    pub(crate) fn set_size(
        &self, owner: &str, cols: u16, rows: u16,
        apply: impl FnOnce(u16, u16) -> Result<(), String>,
    ) -> Result<Option<(u16, u16)>, String> {
        if cols == 0 || rows == 0 {
            return Err("Terminal dimensions must be positive".into());
        }
        let mut inner = self.inner.lock();
        if !inner.consumers.iter().any(|consumer| consumer.owner == owner) {
            return Err("Terminal consumer is no longer attached".into());
        }
        let size = minimum_size(inner.consumers.iter().filter_map(|consumer| {
            if consumer.owner == owner { Some((cols, rows)) } else { consumer.size }
        }), inner.size);
        let changed = resize_inner(&mut inner, size, Some(owner), apply)?;
        for consumer in inner.consumers.iter_mut().filter(|consumer| consumer.owner == owner) {
            consumer.size = Some((cols, rows));
        }
        Ok(changed)
    }

    pub(crate) fn detach_owner(
        &self, owner: &str, apply: impl FnOnce(u16, u16) -> Result<(), String>,
    ) -> Result<(usize, Option<(u16, u16)>), String> {
        let mut inner = self.inner.lock();
        let before = inner.consumers.len();
        inner.consumers.retain(|consumer| consumer.owner != owner);
        let removed = before - inner.consumers.len();
        if removed > 0 && inner.consumers.is_empty() {
            inner.orphaned_since = Some(Instant::now());
        }
        let size = minimum_size(inner.consumers.iter().filter_map(|consumer| consumer.size), inner.size);
        let changed = resize_inner(&mut inner, size, Some(owner), apply)?;
        Ok((removed, changed))
    }

    pub(crate) fn has_owner(&self, owner: &str) -> bool {
        self.inner.lock().consumers.iter().any(|c| c.owner == owner)
    }

    pub(crate) fn is_orphaned(&self) -> bool {
        self.inner.lock().consumers.is_empty()
    }

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

fn minimum_size(sizes: impl Iterator<Item = (u16, u16)>, fallback: (u16, u16)) -> (u16, u16) {
    sizes.fold(None, |acc: Option<(u16, u16)>, (cols, rows)| {
        Some(match acc {
            Some((c, r)) => (c.min(cols), r.min(rows)),
            None => (cols, rows),
        })
    }).unwrap_or(fallback)
}

fn resize_inner(
    inner: &mut Inner, size: (u16, u16), owner: Option<&str>,
    apply: impl FnOnce(u16, u16) -> Result<(), String>,
) -> Result<Option<(u16, u16)>, String> {
    let changed = size != inner.size;
    if changed {
        apply(size.0, size.1)?;
        inner.size = size;
        inner.screen.screen_mut().set_size(size.1, size.0);
        inner.last_resize_offset = inner.written;
    }
    inner.consumers.retain_mut(|consumer| {
        (!changed && Some(consumer.owner.as_str()) != owner) || consumer.sink.resize(size.0, size.1)
    });
    if inner.consumers.is_empty() && inner.orphaned_since.is_none() {
        inner.orphaned_since = Some(Instant::now());
    }
    Ok(changed.then_some(size))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct Recorder(Arc<Mutex<Vec<u8>>>);

    impl ByteSink for Recorder {
        fn deliver(&mut self, _offset: u64, bytes: &[u8]) -> bool {
            self.0.lock().extend_from_slice(bytes);
            true
        }
    }

    fn recorder() -> (Box<dyn ByteSink>, Arc<Mutex<Vec<u8>>>) {
        let out = Arc::new(Mutex::new(Vec::new()));
        (Box::new(Recorder(out.clone())), out)
    }

    #[test]
    fn chi_si_aggancia_dopo_vede_la_storia_e_poi_lo_stesso_output() {
        let hub = TerminalHub::new(120, 40);
        let (first, first_out) = recorder();
        hub.attach(first, "main".into(), Some((120, 40)), None).unwrap();
        hub.publish(b"$ npm test\r\n");
        hub.publish(b"ok 1\r\n");

        let (late, late_out) = recorder();
        hub.attach(late, "link:pc:main".into(), Some((100, 30)), None).unwrap();
        hub.publish(b"ok 2\r\n");

        let mut first_screen = vt100::Parser::new(40, 120, 0);
        first_screen.process(&first_out.lock());
        let mut late_screen = vt100::Parser::new(40, 120, 0);
        late_screen.process(&late_out.lock());
        assert_eq!(first_screen.screen().contents(), "$ npm test\nok 1\nok 2");
        assert_eq!(late_screen.screen().contents(), first_screen.screen().contents());
        assert_eq!(late_screen.screen().cursor_position(), first_screen.screen().cursor_position());
    }

    #[test]
    fn la_ripresa_da_una_posizione_non_duplica_ne_salta_byte() {
        let hub = TerminalHub::new(80, 24);
        hub.publish(b"abc");
        hub.publish(b"def");
        let (sink, out) = recorder();
        let (start, continued) = hub.attach(sink, "w".into(), None, Some(3)).unwrap();
        assert_eq!((start, continued), (3, true));
        hub.publish(b"ghi");
        assert_eq!(&*out.lock(), b"defghi");
    }

    #[test]
    fn il_terminale_prende_la_misura_piu_piccola_e_torna_grande_quando_esce() {
        let hub = TerminalHub::new(120, 40);
        let (big, _) = recorder();
        let (small, _) = recorder();
        hub.attach(big, "main".into(), Some((120, 40)), None).unwrap();
        hub.attach(small, "link:pc:main".into(), Some((80, 24)), None).unwrap();
        assert_eq!(hub.set_size("link:pc:main", 80, 24, |_, _| Ok(())).unwrap(), Some((80, 24)));
        assert_eq!(hub.set_size("main", 130, 45, |_, _| Ok(())).unwrap(), None, "il piu' piccolo resta 80x24");
        assert_eq!(hub.detach_owner("link:pc:main", |_, _| Ok(())).unwrap(), (1, Some((130, 45))));
    }

    #[test]
    fn la_storia_troncata_ricostruisce_lo_schermo_e_non_riproduce_escape_parziali() {
        let hub = TerminalHub::new(80, 24);
        let line = vec![b'x'; 1000];
        for _ in 0..(HISTORY_MAX_BYTES / 1000 + 10) {
            hub.publish(&line);
            hub.publish(b"\r\n");
        }
        let (sink, out) = recorder();
        let (_, continued) = hub.attach(sink, "late".into(), None, Some(0)).unwrap();
        assert!(!continued);
        let replay = out.lock().clone();
        let mut restored = vt100::Parser::new(24, 80, 0);
        restored.process(&replay);
        let inner = hub.inner.lock();
        assert_eq!(restored.screen().contents(), inner.screen.screen().contents());
        assert_eq!(restored.screen().cursor_position(), inner.screen.screen().cursor_position());
    }
    #[test]
    fn un_resize_rifiutato_non_cambia_lo_schermo_ne_la_misura_richiesta() {
        let hub = TerminalHub::new(120, 40);
        let (main, _) = recorder();
        hub.attach(main, "main".into(), Some((120, 40)), None).unwrap();
        assert!(hub.set_size("main", 80, 24, |_, _| Err("PTY closed".into())).is_err());
        let (other, _) = recorder();
        hub.attach(other, "other".into(), Some((100, 30)), None).unwrap();
        let mut physical_size = None;
        hub.set_size("other", 100, 30, |cols, rows| {
            physical_size = Some((cols, rows));
            Ok(())
        }).unwrap();
        assert_eq!(physical_size, Some((100, 30)), "il resize fallito non deve imporre 80x24");
    }

    #[test]
    fn un_resize_durante_lo_scollegamento_impone_uno_snapshot_invece_di_byte_con_misure_sbagliate() {
        let hub = TerminalHub::new(80, 24);
        let (main, _) = recorder();
        hub.attach(main, "main".into(), Some((80, 24)), None).unwrap();
        hub.publish(b"abc");
        let seen = 3;
        hub.publish(b"def");
        hub.set_size("main", 20, 5, |_, _| Ok(())).unwrap();
        hub.publish(b"\r\nnew");
        let (late, output) = recorder();
        let (_, continued) = hub.attach(late, "late".into(), Some((20, 5)), Some(seen)).unwrap();
        assert!(!continued);
        let mut restored = vt100::Parser::new(5, 20, 0);
        restored.process(&output.lock());
        assert_eq!(restored.screen().contents(), "abcdef\nnew");
    }

}
