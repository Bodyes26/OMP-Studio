//! Scatola nera del trasporto RPC.
//!
//! Quando un comando resta senza risposta, i sintomi visibili (chat ferma,
//! barra "in esecuzione", prompt rifiutato dopo 60 s) sono identici per tre
//! guasti diversi: omp che non scrive piu' su stdout, omp che non legge piu'
//! stdin, e frame che Rust ha spedito ma che il WebView non ha mai consegnato
//! al Channel (che li consegna solo in ordine: un indice perso ferma tutti i
//! successivi). Questi contatori separano i tre casi: il frontend confronta i
//! frame spediti qui con quelli ricevuti dal suo `onmessage`.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use tauri::ipc::Channel;

/// Soglia oltre la quale Tauri non valuta il frame direttamente nel WebView
/// ma lo consegna con una `fetch` interna (`MAX_JSON_DIRECT_EXECUTE_THRESHOLD`
/// in `tauri/src/ipc/channel.rs`). Un fallimento di quella fetch finisce solo
/// in `console.error`: e' il punto in cui un frame puo' sparire.
const TAURI_FETCH_PATH_BYTES: usize = 8192;

/// Ultimi frame spediti conservati: bastano a vedere cosa e' stato
/// spedito attorno all'ultimo indice consegnato.
const RECENT_FRAMES: usize = 48;

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

struct SentFrame {
    /// Indice del frame sul Channel: coincide con l'indice che Tauri assegna,
    /// perche' Tauri lo consuma anche quando l'invio fallisce.
    index: u64,
    at_ms: u64,
    bytes: usize,
    kind: String,
}

#[derive(Default)]
pub(super) struct RpcStats {
    stdout_lines: AtomicU64,
    /// Byte letti da stdout: righe medie da decine di KB vogliono dire che
    /// omp sta spedendo istantanee intere del messaggio, non delta.
    stdout_bytes: AtomicU64,
    last_stdout_ms: AtomicU64,
    frames_sent: AtomicU64,
    fetch_path_frames: AtomicU64,
    send_errors: AtomicU64,
    last_sent_ms: AtomicU64,
    stdin_writes: AtomicU64,
    last_stdin_ms: AtomicU64,
    /// Istante d'inizio della scrittura su stdin in corso, 0 se nessuna:
    /// una scrittura che non finisce vuol dire che omp non legge piu'.
    stdin_write_since_ms: AtomicU64,
    reader_exited: AtomicBool,
    recent: Mutex<VecDeque<SentFrame>>,
}

impl RpcStats {
    pub(super) fn stdout_line(&self, bytes: usize) {
        self.stdout_lines.fetch_add(1, Ordering::Relaxed);
        self.stdout_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.last_stdout_ms.store(now_ms(), Ordering::Relaxed);
    }

    pub(super) fn reader_exited(&self) {
        self.reader_exited.store(true, Ordering::Relaxed);
    }

    pub(super) fn stdin_write_started(&self) {
        self.stdin_write_since_ms.store(now_ms(), Ordering::Relaxed);
    }

    pub(super) fn stdin_write_finished(&self) {
        self.stdin_write_since_ms.store(0, Ordering::Relaxed);
        self.stdin_writes.fetch_add(1, Ordering::Relaxed);
        self.last_stdin_ms.store(now_ms(), Ordering::Relaxed);
    }

    /// Spedisce un frame sul Channel registrandone indice, dimensione e tipo.
    /// Tutti gli invii del lettore passano di qui: un invio non contato
    /// sfaserebbe il confronto con i frame ricevuti dal frontend.
    pub(super) fn send(&self, channel: &Channel<String>, kind: &str, frame: String) -> bool {
        let bytes = frame.len();
        let at_ms = now_ms();
        let index = self.frames_sent.fetch_add(1, Ordering::Relaxed);
        if bytes >= TAURI_FETCH_PATH_BYTES {
            self.fetch_path_frames.fetch_add(1, Ordering::Relaxed);
        }
        {
            let mut recent = self.recent.lock();
            // Il buffer piu' vecchio si riusa: a regime nessuna allocazione
            // per frame.
            let mut slot = if recent.len() == RECENT_FRAMES {
                recent.pop_front().expect("buffer pieno")
            } else {
                SentFrame {
                    index: 0,
                    at_ms: 0,
                    bytes: 0,
                    kind: String::new(),
                }
            };
            slot.index = index;
            slot.at_ms = at_ms;
            slot.bytes = bytes;
            slot.kind.clear();
            slot.kind.push_str(kind);
            recent.push_back(slot);
        }
        let ok = channel.send(frame).is_ok();
        if ok {
            self.last_sent_ms.store(at_ms, Ordering::Relaxed);
        } else {
            self.send_errors.fetch_add(1, Ordering::Relaxed);
        }
        ok
    }

    pub(super) fn snapshot(&self) -> serde_json::Value {
        let recent: Vec<serde_json::Value> = self
            .recent
            .lock()
            .iter()
            .map(|frame| {
                serde_json::json!({
                    "index": frame.index,
                    "atMs": frame.at_ms,
                    "bytes": frame.bytes,
                    "kind": frame.kind,
                    "tauriFetchPath": frame.bytes >= TAURI_FETCH_PATH_BYTES,
                })
            })
            .collect();
        let since = self.stdin_write_since_ms.load(Ordering::Relaxed);
        serde_json::json!({
            "nowMs": now_ms(),
            "stdoutLines": self.stdout_lines.load(Ordering::Relaxed),
            "stdoutBytes": self.stdout_bytes.load(Ordering::Relaxed),
            "lastStdoutMs": self.last_stdout_ms.load(Ordering::Relaxed),
            "framesSent": self.frames_sent.load(Ordering::Relaxed),
            "tauriFetchPathFrames": self.fetch_path_frames.load(Ordering::Relaxed),
            "sendErrors": self.send_errors.load(Ordering::Relaxed),
            "lastSentMs": self.last_sent_ms.load(Ordering::Relaxed),
            "stdinWrites": self.stdin_writes.load(Ordering::Relaxed),
            "lastStdinMs": self.last_stdin_ms.load(Ordering::Relaxed),
            "stdinWriteSinceMs": if since == 0 { serde_json::Value::Null } else { since.into() },
            "readerExited": self.reader_exited.load(Ordering::Relaxed),
            "recentFrames": recent,
        })
    }
}

/// Rapporti conservati: ognuno documenta un blocco, i piu' vecchi non
/// servono piu' quando il guasto e' gia' stato analizzato.
const KEPT_REPORTS: usize = 20;

/// Scrive `rpc-hang-<epoch_ms>.json` in `dir`, eliminando i rapporti oltre
/// gli ultimi `KEPT_REPORTS`.
pub(super) fn write_hang_report(dir: &Path, report: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|error| format!("Cartella dei log: {}", error))?;
    let mut existing: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok().map(|e| e.path()))
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| {
                            name.starts_with("rpc-hang-") && name.ends_with(".json")
                        })
                })
                .collect()
        })
        .unwrap_or_default();
    // Il nome porta l'epoca in millisecondi a cifre fisse: l'ordine
    // lessicografico e' quello cronologico.
    existing.sort();
    let excess = (existing.len() + 1).saturating_sub(KEPT_REPORTS);
    for old in existing.iter().take(excess) {
        let _ = fs::remove_file(old);
    }
    let path = dir.join(format!("rpc-hang-{}.json", now_ms()));
    fs::write(&path, report).map_err(|error| format!("Scrittura del rapporto: {}", error))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// L'indice registrato deve restare allineato a quello che Tauri assegna,
    /// anche dopo un invio fallito: e' l'unico modo per dire quale frame il
    /// frontend non ha ricevuto.
    #[test]
    fn indici_e_contatori_restano_allineati_al_channel() {
        let fail = std::sync::Arc::new(AtomicBool::new(false));
        let fail_in_channel = fail.clone();
        let channel = Channel::<String>::new(move |_| {
            if fail_in_channel.load(Ordering::Relaxed) {
                Err(tauri::Error::WindowNotFound)
            } else {
                Ok(())
            }
        });
        let stats = RpcStats::default();
        let total = RECENT_FRAMES as u64 + 5;
        for i in 0..total {
            fail.store(i == 2, Ordering::Relaxed);
            let frame = if i == 3 {
                "x".repeat(TAURI_FETCH_PATH_BYTES)
            } else {
                "{}".to_string()
            };
            assert_eq!(stats.send(&channel, "message_end", frame), i != 2);
        }
        let snap = stats.snapshot();
        assert_eq!(snap["framesSent"], total);
        assert_eq!(snap["sendErrors"], 1);
        assert_eq!(snap["tauriFetchPathFrames"], 1);
        let frames = snap["recentFrames"].as_array().unwrap();
        assert_eq!(frames.len(), RECENT_FRAMES);
        assert_eq!(frames[0]["index"], 5);
        assert_eq!(frames[RECENT_FRAMES - 1]["index"], total - 1);
    }
}
