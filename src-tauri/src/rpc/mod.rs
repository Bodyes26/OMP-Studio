//! Trasporto della seconda superficie: `omp --mode rpc-ui` su stdio NDJSON.
//!
//! Gemello di `pty/mod.rs`, con tre differenze che contano:
//!
//! 1. **Nessuna shell.** `std::process::Command` diretto sul binario: nel
//!    percorso RPC non serve un terminale e il quoting di PowerShell sarebbe
//!    solo un rischio.
//! 2. **Nessun `WT_SESSION`.** Il breadcrumb serviva a scoprire quale sessione
//!    girava in quale scheda; qui `get_state.sessionId` lo dice.
//! 3. **Il webview non vede il filo grezzo.** Questo modulo riassembla i
//!    `rpc_chunk` e coalesce i delta di streaming, perche' ogni
//!    `message_update` porta il messaggio intero due volte (in
//!    `assistantMessageEvent.partial` e in `message`): inoltrarli tutti
//!    costerebbe O(n^2) byte su IPC per una singola risposta lunga.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;

/// Tetto di riassemblaggio annunciato dal frame `ready` (64 MiB). Oltre
/// questo un frame logico e' un errore, non un caso da gestire.
const MAX_REASSEMBLED_BYTES: usize = 67_108_864;

/// Finestra di coalescenza dei delta. Un solo numero: se il profiling
/// mostrasse che il collo di bottiglia e' la reattivita' Svelte e non l'IPC,
/// si allarga qui.
const DELTA_WINDOW: Duration = Duration::from_millis(8);

/// Righe di stderr conservate per la diagnostica di crash. Un avvio fallito
/// (binario mancante, provider non autenticato, estensione rotta) altrimenti
/// si manifesterebbe solo come stdin chiuso.
const STDERR_TAIL_LINES: usize = 200;


pub struct RpcSession {
    child: Arc<Mutex<Child>>,
    /// `None` dopo `rpc_close`: chiudere stdin e' il modo documentato di far
    /// drenare i comandi accettati e uscire con codice 0.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    protocol: Arc<AtomicU8>,
}

pub struct RpcManager {
    sessions: Arc<Mutex<HashMap<u64, RpcSession>>>,
    next_id: Mutex<u64>,
}

impl RpcManager {
    pub fn new() -> Self {
        RpcManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Mutex::new(1),
        }
    }
}

/// Overlay `--config` del percorso GUI. `tools.approvalMode: yolo`:
/// permette l'esecuzione automatica e diretta di tutti i tool senza
/// blocchi o prompt di autorizzazione, allineando la GUI alla TUI.
/// Niente `tui.*` (non c'e' terminale) e niente `theme.*` (non c'e'
/// rendering ANSI).
fn write_gui_overlay() -> std::path::PathBuf {
    let mut overlay_path = std::env::temp_dir();
    overlay_path.push("omp-studio-gui-overlay.yml");
    if let Ok(mut file) = std::fs::File::create(&overlay_path) {
        let _ = file.write_all(b"tools:\n  approvalMode: yolo\n");
    }
    overlay_path
}

/// Vista minima di un frame in arrivo: solo cio' che il trasporto deve
/// decidere. `serde` ignora il resto senza allocarlo.
#[derive(Deserialize)]
struct FramePeek<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(rename = "supportedProtocolVersions")]
    supported_protocol_versions: Option<Vec<u8>>,
    #[serde(rename = "assistantMessageEvent")]
    assistant_message_event: Option<AssistantEventPeek<'a>>,
}

#[derive(Deserialize)]
struct AssistantEventPeek<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "contentIndex")]
    content_index: Option<u32>,
    delta: Option<String>,
}

#[derive(Deserialize)]
struct ChunkFrame {
    #[serde(rename = "chunkId")]
    chunk_id: String,
    index: usize,
    count: usize,
    #[serde(rename = "byteLength")]
    byte_length: usize,
    data: String,
}

/// Sequenza di `rpc_chunk` in corso. Una sola per volta: il protocollo
/// garantisce che i chunk di un frame logico arrivino ininterrotti, quindi
/// una sequenza interlacciata e' un errore da rifiutare, non da tollerare.
struct ChunkAssembly {
    chunk_id: String,
    count: usize,
    byte_length: usize,
    next_index: usize,
    buffer: Vec<u8>,
}

/// Delta accumulati in attesa di essere spediti come un solo frame.
struct DeltaBuffer {
    kind: &'static str,
    content_index: u32,
    text: String,
    since: Instant,
}

impl DeltaBuffer {
    fn into_frame(self) -> String {
        // Serializzato a mano: e' un oggetto di quattro campi, e passare da
        // serde_json::Value per costruirlo allocherebbe una mappa per token.
        let mut out = String::with_capacity(self.text.len() + 96);
        out.push_str("{\"type\":\"studio_delta\",\"kind\":\"");
        out.push_str(self.kind);
        out.push_str("\",\"contentIndex\":");
        out.push_str(&self.content_index.to_string());
        out.push_str(",\"delta\":");
        // `to_string` su una stringa produce un letterale JSON valido con
        // tutti gli escape: e' l'unica parte che non conviene fare a mano.
        out.push_str(&serde_json::Value::String(self.text).to_string());
        out.push('}');
        out
    }
}

fn delta_kind(event_kind: &str) -> Option<&'static str> {
    match event_kind {
        "text_delta" => Some("text"),
        "thinking_delta" => Some("thinking"),
        "toolcall_delta" => Some("toolcall"),
        _ => None,
    }
}

/// Legge stdout riga per riga. Le righe arrivano fino a 1 MiB, quindi
/// `read_until` su un `Vec` che si ridimensiona, non `lines()` con il buffer
/// di default.
fn reader_loop(
    stdout: std::process::ChildStdout,
    on_event: Channel<String>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    protocol: Arc<AtomicU8>,
    child: Arc<Mutex<Child>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    sessions: Arc<Mutex<HashMap<u64, RpcSession>>>,
    rpc_id: u64,
) {
    let mut reader = BufReader::with_capacity(1 << 16, stdout);
    let mut raw = Vec::with_capacity(1 << 16);
    let mut assembly: Option<ChunkAssembly> = None;
    let mut pending_delta: Option<DeltaBuffer> = None;

    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        while raw.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
            raw.pop();
        }
        if raw.is_empty() {
            continue;
        }
        let Ok(line) = std::str::from_utf8(&raw) else {
            // stdout di omp e' UTF-8 per contratto: una riga non decodificabile
            // e' corruzione del filo, non un frame da inoltrare.
            continue;
        };

        // I chunk si riassemblano qui: il webview non ne vede mai uno.
        if line.contains("\"rpc_chunk\"") {
            match reassemble(line, &mut assembly) {
                Ok(Some(logical)) => {
                    if !dispatch(&logical, &on_event, &stdin, &protocol, &mut pending_delta) {
                        break;
                    }
                }
                Ok(None) => {}
                Err(reason) => {
                    assembly = None;
                    let frame = serde_json::json!({
                        "type": "studio_error",
                        "message": reason,
                    });
                    if on_event.send(frame.to_string()).is_err() {
                        break;
                    }
                }
            }
            continue;
        }

        if !dispatch(line, &on_event, &stdin, &protocol, &mut pending_delta) {
            break;
        }
    }

    if let Some(buffer) = pending_delta.take() {
        let _ = on_event.send(buffer.into_frame());
    }

    // La morte del processo va raccontata con la sua causa: senza le righe di
    // stderr un avvio fallito (provider non autenticato, estensione rotta) si
    // vedrebbe solo come una superficie che smette di rispondere. Il codice
    // puo' essere `null` se il figlio non e' ancora stato raccolto: e' un
    // dettaglio diagnostico, non un valore su cui ramificare.
    let code = child.lock().try_wait().ok().flatten().and_then(|s| s.code());
    let tail: Vec<String> = stderr_tail.lock().iter().cloned().collect();
    sessions.lock().remove(&rpc_id);
    let _ = on_event.send(
        serde_json::json!({
            "type": "studio_exit",
            "code": code,
            "stderr": tail,
        })
        .to_string(),
    );
}

/// Riassembla una sequenza di `rpc_chunk`. `Ok(Some(_))` quando il frame
/// logico e' completo. Ogni violazione del contratto (chunkId che cambia a
/// meta', indice fuori ordine, lunghezza dichiarata diversa) fa fallire la
/// sequenza invece di consegnare byte plausibili.
fn reassemble(line: &str, assembly: &mut Option<ChunkAssembly>) -> Result<Option<String>, String> {
    let chunk: ChunkFrame =
        serde_json::from_str(line).map_err(|error| format!("Chunk RPC illeggibile: {}", error))?;

    if chunk.count == 0 || chunk.index >= chunk.count {
        return Err(format!(
            "Chunk RPC incoerente: index {} su count {}",
            chunk.index, chunk.count
        ));
    }
    if chunk.byte_length > MAX_REASSEMBLED_BYTES {
        return Err(format!(
            "Frame RPC da {} byte oltre il tetto di riassemblaggio",
            chunk.byte_length
        ));
    }

    let current = match assembly.take() {
        Some(current) if current.chunk_id == chunk.chunk_id => {
            if chunk.index != current.next_index || chunk.count != current.count {
                return Err(format!(
                    "Sequenza di chunk {} interrotta all'indice {}",
                    chunk.chunk_id, chunk.index
                ));
            }
            current
        }
        Some(previous) => {
            return Err(format!(
                "Sequenza di chunk {} interlacciata con {}",
                previous.chunk_id, chunk.chunk_id
            ));
        }
        None => {
            if chunk.index != 0 {
                return Err(format!(
                    "Sequenza di chunk {} iniziata dall'indice {}",
                    chunk.chunk_id, chunk.index
                ));
            }
            ChunkAssembly {
                chunk_id: chunk.chunk_id.clone(),
                count: chunk.count,
                byte_length: chunk.byte_length,
                next_index: 0,
                buffer: Vec::with_capacity(chunk.byte_length.min(MAX_REASSEMBLED_BYTES)),
            }
        }
    };

    let mut current = current;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(chunk.data.as_bytes())
        .map_err(|error| format!("Chunk RPC non decodificabile: {}", error))?;
    current.buffer.extend_from_slice(&decoded);
    if current.buffer.len() > MAX_REASSEMBLED_BYTES {
        return Err("Frame RPC oltre il tetto di riassemblaggio".to_string());
    }
    current.next_index = chunk.index + 1;

    if current.next_index < current.count {
        *assembly = Some(current);
        return Ok(None);
    }

    if current.buffer.len() != current.byte_length {
        return Err(format!(
            "Frame RPC ricomposto da {} byte invece dei {} dichiarati",
            current.buffer.len(),
            current.byte_length
        ));
    }
    String::from_utf8(current.buffer)
        .map(Some)
        .map_err(|_| "Frame RPC ricomposto non e' UTF-8 valido".to_string())
}

/// Instrada un frame logico verso il frontend. `false` quando il canale e'
/// chiuso e il thread di lettura deve fermarsi.
fn dispatch(
    line: &str,
    on_event: &Channel<String>,
    stdin: &Arc<Mutex<Option<ChildStdin>>>,
    protocol: &Arc<AtomicU8>,
    pending_delta: &mut Option<DeltaBuffer>,
) -> bool {
    let peek: Option<FramePeek> = serde_json::from_str(line).ok();

    if let Some(peek) = &peek {
        if let Some(event) = &peek.assistant_message_event {
            if let Some(kind) = delta_kind(event.kind) {
                let index = event.content_index.unwrap_or(0);
                let delta = event.delta.as_deref().unwrap_or("");
                // Delta vuoti esistono (`toolcall_delta` con `delta: ""`) e non
                // portano informazione: si scartano prima di allocare.
                if delta.is_empty() {
                    return true;
                }
                match pending_delta {
                    Some(buffer) if buffer.kind == kind && buffer.content_index == index => {
                        buffer.text.push_str(delta);
                    }
                    _ => {
                        if let Some(buffer) = pending_delta.take() {
                            if on_event.send(buffer.into_frame()).is_err() {
                                return false;
                            }
                        }
                        *pending_delta = Some(DeltaBuffer {
                            kind,
                            content_index: index,
                            text: delta.to_string(),
                            since: Instant::now(),
                        });
                    }
                }
                // Si spedisce quando la finestra e' scaduta: nessun timer,
                // e il frame terminale (`text_end`, `toolcall_end`) fa
                // comunque da flush.
                if pending_delta
                    .as_ref()
                    .is_some_and(|buffer| buffer.since.elapsed() >= DELTA_WINDOW)
                {
                    let buffer = pending_delta.take().expect("appena verificato");
                    if on_event.send(buffer.into_frame()).is_err() {
                        return false;
                    }
                }
                return true;
            }
        }
    }

    // Qualsiasi frame che non sia un delta e' un punto di riallineamento:
    // i delta accumulati vanno spediti prima, o arriverebbero dopo il
    // `*_end` che li rende autorevoli.
    if let Some(buffer) = pending_delta.take() {
        if on_event.send(buffer.into_frame()).is_err() {
            return false;
        }
    }

    if let Some(peek) = &peek {
        if peek.kind == Some("ready") {
            let supports_v2 = peek
                .supported_protocol_versions
                .as_ref()
                .is_some_and(|versions| versions.contains(&2));
            if supports_v2 {
                let negotiated = {
                    let mut guard = stdin.lock();
                    match guard.as_mut() {
                        Some(handle) => handle
                            .write_all(
                                b"{\"id\":\"studio-proto-1\",\"type\":\"negotiate_protocol\",\"protocolVersion\":2}\n",
                            )
                            .and_then(|()| handle.flush())
                            .is_ok(),
                        None => false,
                    }
                };
                if negotiated {
                    protocol.store(2, Ordering::Relaxed);
                }
            }
        }
    }

    on_event.send(line.to_string()).is_ok()
}

#[tauri::command]
pub async fn rpc_open(
    cwd: String,
    resume: Option<String>,
    on_event: Channel<String>,
    manager: State<'_, RpcManager>,
) -> Result<u64, String> {
    let omp_path = crate::omp_ops::get_omp_binary();
    let overlay_path = write_gui_overlay();
    let diagram_extension =
        crate::pty::write_extension("studio-diagram.ts", crate::pty::DIAGRAM_EXTENSION_TS);

    let rpc_id = {
        let mut guard = manager.next_id.lock();
        let id = *guard;
        *guard += 1;
        id
    };

    // Progetto senza cartella (chat temporanea): stesso trattamento del PTY,
    // sessione effimera e nessun `--cwd`.
    let scratchpad = cwd.is_empty();
    let launch_cwd = if scratchpad { ".".to_string() } else { cwd.clone() };

    let mut command = Command::new(&omp_path);
    command.arg("--mode").arg("rpc-ui");
    if scratchpad {
        command.arg("--no-session");
    } else {
        command.arg("--cwd").arg(&cwd);
    }
    command.arg("--config").arg(&overlay_path);
    if let Some(path) = &diagram_extension {
        command.arg("-e").arg(path);
    }
    if let Some(session_id) = resume.as_deref().filter(|id| !id.is_empty()) {
        command.arg("--resume").arg(session_id);
    }

    command
        .current_dir(&launch_cwd)
        .env("OMP_STUDIO", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: senza, ogni sessione GUI farebbe lampeggiare una
        // console.
        command.creation_flags(0x08000000);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        if let Ok(home) = std::env::var("HOME") {
            command.env(
                "PATH",
                format!(
                    "{}/.bun/bin:{}/.cargo/bin:{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{}",
                    home, home, home, current_path
                ),
            );
        }
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Avvio di omp in modalita' RPC: {}", error))?;

    let stdin = child.stdin.take().ok_or("stdin di omp non disponibile")?;
    let stdout = child.stdout.take().ok_or("stdout di omp non disponibile")?;
    let stderr = child.stderr.take().ok_or("stderr di omp non disponibile")?;

    let stdin = Arc::new(Mutex::new(Some(stdin)));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    let protocol = Arc::new(AtomicU8::new(1));
    let child = Arc::new(Mutex::new(child));

    manager.sessions.lock().insert(
        rpc_id,
        RpcSession {
            child: child.clone(),
            stdin: stdin.clone(),
            stderr_tail: stderr_tail.clone(),
            protocol: protocol.clone(),
        },
    );

    let sessions = manager.sessions.clone();
    let reader_tail = stderr_tail.clone();
    thread::spawn(move || {
        reader_loop(
            stdout,
            on_event,
            stdin,
            protocol,
            child,
            reader_tail,
            sessions,
            rpc_id,
        );
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut tail = stderr_tail.lock();
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    });

    Ok(rpc_id)
}

#[tauri::command]
pub async fn rpc_send(
    rpc_id: u64,
    line: String,
    manager: State<'_, RpcManager>,
) -> Result<(), String> {
    let stdin = {
        let sessions = manager.sessions.lock();
        let session = sessions
            .get(&rpc_id)
            .ok_or_else(|| format!("Sessione RPC {} non disponibile", rpc_id))?;
        session.stdin.clone()
    };
    let mut guard = stdin.lock();
    let handle = guard
        .as_mut()
        .ok_or_else(|| format!("Sessione RPC {} in chiusura", rpc_id))?;
    handle
        .write_all(line.as_bytes())
        .and_then(|()| handle.write_all(b"\n"))
        .and_then(|()| handle.flush())
        .map_err(|error| format!("Scrittura sulla sessione RPC {}: {}", rpc_id, error))
}

#[tauri::command]
pub async fn rpc_close(rpc_id: u64, manager: State<'_, RpcManager>) -> Result<(), String> {
    let Some(session) = manager.sessions.lock().remove(&rpc_id) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || {
        // Chiudere stdin e' la via documentata: omp drena i comandi accettati,
        // dispone la sessione ed esce con codice 0. Il kill resta l'ultima
        // risorsa, non la prima.
        session.stdin.lock().take();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Ok(Some(_)) = session.child.lock().try_wait() {
                return;
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let mut child = session.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    })
    .await
    .map_err(|error| format!("Chiusura della sessione RPC {}: {}", rpc_id, error))
}

/// Ultime righe di stderr di una sessione **viva**: serve quando il processo
/// e' appeso e non morto. Alla morte le stesse righe arrivano dentro
/// `studio_exit`, perche' a quel punto la sessione non e' piu' nella mappa.
#[tauri::command]
pub async fn rpc_stderr(rpc_id: u64, manager: State<'_, RpcManager>) -> Result<Vec<String>, String> {
    let tail = {
        let sessions = manager.sessions.lock();
        let session = sessions
            .get(&rpc_id)
            .ok_or_else(|| format!("Sessione RPC {} non disponibile", rpc_id))?;
        session.stderr_tail.clone()
    };
    let lines: Vec<String> = tail.lock().iter().cloned().collect();
    Ok(lines)
}

/// Versione di protocollo effettivamente negoziata: serve al frontend per
/// sapere se un frame gigante arrivera' riassemblato o come errore.
#[tauri::command]
pub async fn rpc_protocol(rpc_id: u64, manager: State<'_, RpcManager>) -> Result<u8, String> {
    let sessions = manager.sessions.lock();
    let protocol = sessions
        .get(&rpc_id)
        .ok_or_else(|| format!("Sessione RPC {} non disponibile", rpc_id))?
        .protocol
        .load(Ordering::Relaxed);
    Ok(protocol)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(chunk_id: &str, index: usize, count: usize, byte_length: usize, payload: &str) -> String {
        format!(
            r#"{{"type":"rpc_chunk","chunkId":"{}","index":{},"count":{},"byteLength":{},"data":"{}"}}"#,
            chunk_id,
            index,
            count,
            byte_length,
            base64::engine::general_purpose::STANDARD.encode(payload)
        )
    }

    #[test]
    fn riassembla_una_sequenza_completa() {
        let mut assembly = None;
        let logical = r#"{"type":"response","command":"get_state"}"#;
        let (head, tail) = logical.split_at(20);
        assert_eq!(
            reassemble(&chunk("c1", 0, 2, logical.len(), head), &mut assembly),
            Ok(None)
        );
        assert_eq!(
            reassemble(&chunk("c1", 1, 2, logical.len(), tail), &mut assembly),
            Ok(Some(logical.to_string()))
        );
        assert!(assembly.is_none());
    }

    #[test]
    fn rifiuta_una_sequenza_interlacciata() {
        let mut assembly = None;
        let _ = reassemble(&chunk("c1", 0, 2, 10, "0123456789"), &mut assembly);
        assert!(reassemble(&chunk("c2", 0, 2, 10, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn rifiuta_un_indice_fuori_ordine() {
        let mut assembly = None;
        assert!(reassemble(&chunk("c1", 1, 2, 10, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn rifiuta_una_lunghezza_dichiarata_diversa() {
        let mut assembly = None;
        assert!(reassemble(&chunk("c1", 0, 1, 99, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn coniazione_del_frame_di_delta() {
        let buffer = DeltaBuffer {
            kind: "text",
            content_index: 3,
            text: "riga \"citata\"\n".to_string(),
            since: Instant::now(),
        };
        assert_eq!(
            buffer.into_frame(),
            r#"{"type":"studio_delta","kind":"text","contentIndex":3,"delta":"riga \"citata\"\n"}"#
        );
    }
}
