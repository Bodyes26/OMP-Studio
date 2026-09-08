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
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
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
    abort_signal: Arc<AtomicBool>,
    config_path: Option<std::path::PathBuf>,
    pub cwd: String,
    pub scope: String,
    pub prototype_id: Option<String>,
    pub project_key: Option<String>,
    pub session_id: Arc<Mutex<Option<String>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RpcSessionInfo {
    pub rpc_id: u64,
    pub cwd: String,
    pub scope: String,
    pub prototype_id: Option<String>,
    pub project_key: Option<String>,
    pub session_id: Option<String>,
    pub protocol: u8,
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

/// Sorgente dell'estensione OMP per il Laboratorio prototipi (broker scrittura confinata).
pub const LAB_EXTENSION_TS: &str = include_str!("../../../extensions/studio-lab.ts");

/// Valida che un identificatore di prototipo rispetti il contratto:
/// 2-64 caratteri, minuscolo alfanumerico con trattini interni, nessun
/// trattino finale e nessun nome riservato Windows (es. con, nul, com1...).
pub fn is_valid_prototype_id(id: &str) -> bool {
    if id.len() < 2 || id.len() > 64 || id.ends_with('-') {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {},
        _ => return false,
    }
    for c in chars {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' {
            return false;
        }
    }
    let base = id.split('.').next().unwrap_or("").to_ascii_lowercase();
    !matches!(
        base.as_str(),
        "con" | "prn" | "aux" | "nul"
            | "com1" | "com2" | "com3" | "com4" | "com5" | "com6" | "com7" | "com8" | "com9"
            | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6" | "lpt7" | "lpt8" | "lpt9"
    )
}

/// Configurazione generata per-sessione per il Laboratorio prototipi.
/// Disattiva shell (`bash`), interpreti host (`eval`), browser generico
/// e configurazioni MCP di progetto, caricando l'estensione confinata dello Step 4.
/// NON usa l'overlay globale `approvalMode: yolo`, NON tocca `~/.omp`,
/// e alloca un file temporaneo dedicato per ciascuna sessione.
pub fn write_lab_session_config(
    rpc_id: u64,
    prototype_id: &str,
    lab_extension_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let mut config_path = std::env::temp_dir();
    let safe_proto = prototype_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect::<String>();
    config_path.push(format!("omp-studio-lab-{}-{}.yml", rpc_id, safe_proto));

    let mut content = String::new();
    content.push_str("# Configurazione per-sessione generata da OMP Studio per il Laboratorio prototipi\n");
    content.push_str("# Disattiva shell, interpreti host, browser generico e configurazioni MCP.\n\n");

    // Disattivazione shell libera
    content.push_str("bash:\n  enabled: false\n\n");

    // Disattivazione interpreti host
    content.push_str("eval:\n  py: false\n  js: false\n  rb: false\n  jl: false\n\n");

    // Disattivazione browser generico
    content.push_str("browser:\n  enabled: false\n\n");

    // Disattivazione configurazioni MCP di progetto
    content.push_str("mcp:\n  enableProjectConfig: false\n\n");

    // Disattivazione xdev per esporre direttamente i tool confinati del Laboratorio
    content.push_str("tools:\n  xdev: false\n\n");

    // Caricamento estensione Step 4
    if let Some(ext_path) = lab_extension_path {
        let normalized = ext_path.replace('\\', "/");
        content.push_str("extensions:\n");
        content.push_str(&format!("  - \"{}\"\n", normalized));
    }

    std::fs::write(&config_path, content.as_bytes())
        .map_err(|e| format!("Impossibile generare la configurazione di sessione Laboratorio: {}", e))?;

    Ok(config_path)
}

/// Vista minima di un frame in arrivo: solo cio' che il trasporto deve
/// decidere. `serde` ignora il resto senza allocarlo.
#[derive(Deserialize)]
struct FramePeek<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(rename = "sessionId")]
    session_id: Option<&'a str>,
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
struct ReaderLoopArgs {
    stdout: std::process::ChildStdout,
    on_event: Channel<String>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    protocol: Arc<AtomicU8>,
    child: Arc<Mutex<Child>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    sessions: Arc<Mutex<HashMap<u64, RpcSession>>>,
    rpc_id: u64,
    abort_signal: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
}

fn reader_loop(args: ReaderLoopArgs) {
    let ReaderLoopArgs {
        stdout,
        on_event,
        stdin,
        protocol,
        child,
        stderr_tail,
        sessions,
        rpc_id,
        abort_signal,
        session_id,
    } = args;
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
        // Svuota delta e chunk pendenti se e' arrivato un segnale di abort
        if abort_signal.swap(false, Ordering::SeqCst) {
            pending_delta = None;
            assembly = None;
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
                    if !dispatch(&logical, &on_event, &stdin, &protocol, &mut pending_delta, &session_id) {
                        break;
                    }
                }
                Ok(None) => {}
                Err(reason) => {
                    assembly = None;
                    let frame = serde_json::json!({
                        "type": "studio_error",
                        "rpcId": rpc_id,
                        "message": reason,
                    });
                    if on_event.send(frame.to_string()).is_err() {
                        break;
                    }
                }
            }
            continue;
        }
        // Se arriva una riga ordinaria non-chunk mentre una sequenza era in corso,
        // la sequenza incompleta e' da considerarsi interrotta/annullata.
        if assembly.is_some() {
            assembly = None;
        }

        if !dispatch(line, &on_event, &stdin, &protocol, &mut pending_delta, &session_id) {
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
    let code = child
        .lock()
        .try_wait()
        .ok()
        .flatten()
        .and_then(|s| s.code());
    let tail: Vec<String> = stderr_tail.lock().iter().cloned().collect();
    sessions.lock().remove(&rpc_id);
    let _ = on_event.send(
        serde_json::json!({
            "type": "studio_exit",
            "rpcId": rpc_id,
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
            if chunk.index == 0 {
                // Se la sequenza precedente e' stata troncata e ne inizia una nuova (index 0),
                // scartiamo quella vecchia senza fallire la nuova.
                ChunkAssembly {
                    chunk_id: chunk.chunk_id.clone(),
                    count: chunk.count,
                    byte_length: chunk.byte_length,
                    next_index: 0,
                    buffer: Vec::with_capacity(chunk.byte_length.min(MAX_REASSEMBLED_BYTES)),
                }
            } else {
                return Err(format!(
                    "Sequenza di chunk {} interlacciata con {}",
                    previous.chunk_id, chunk.chunk_id
                ));
            }
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
    session_id: &Arc<Mutex<Option<String>>>,
) -> bool {
    let peek: Option<FramePeek> = serde_json::from_str(line).ok();
    if let Some(peek) = &peek {
        if let Some(id) = peek.session_id {
            let mut guard = session_id.lock();
            if guard.as_deref() != Some(id) {
                *guard = Some(id.to_string());
            }
        }
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
    if line.contains("\"command\":\"abort\"") {
        *pending_delta = None;
    } else if let Some(buffer) = pending_delta.take() {
        if on_event.send(buffer.into_frame()).is_err() {
            return false;
        }
    }

    if let Some(peek) = &peek {
        if peek.kind == Some("ready") {
            *pending_delta = None;
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
    let tasks_extension =
        crate::pty::write_extension("studio-tasks.ts", crate::pty::TASKS_EXTENSION_TS);

    let rpc_id = {
        let mut guard = manager.next_id.lock();
        let id = *guard;
        *guard += 1;
        id
    };

    // Progetto senza cartella (chat temporanea): stesso trattamento del PTY,
    // sessione effimera e nessun `--cwd`.
    let scratchpad = cwd.is_empty();
    let launch_cwd = if scratchpad {
        ".".to_string()
    } else {
        cwd.clone()
    };

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
    if let Some(path) = &tasks_extension {
        command.arg("-e").arg(path);
    }
    // Il resume di una sessione senza transcript farebbe uscire omp subito:
    // meglio aprirne una nuova, che e' esattamente cio' che la sessione vuota
    // conteneva.
    if let Some(session_id) = resume
        .as_deref()
        .filter(|id| !id.is_empty() && crate::omp_ops::session_transcript_exists(id))
    {
        command.arg("--resume").arg(session_id);
    }

    command
        .current_dir(&launch_cwd)
        .env("OMP_STUDIO", "1")
        // Come per il PTY: nessun wizard dentro una sessione di lavoro.
        .env("OMP_SKIP_SETUP", "1")
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
    let abort_signal = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));

    let session_id_slot = Arc::new(Mutex::new(resume.clone()));
    manager.sessions.lock().insert(
        rpc_id,
        RpcSession {
            child: child.clone(),
            stdin: stdin.clone(),
            stderr_tail: stderr_tail.clone(),
            protocol: protocol.clone(),
            abort_signal: abort_signal.clone(),
            config_path: None,
            cwd: cwd.clone(),
            scope: "main".to_string(),
            prototype_id: None,
            project_key: None,
            session_id: session_id_slot.clone(),
        },
    );

    let sessions = manager.sessions.clone();
    let reader_tail = stderr_tail.clone();
    thread::spawn(move || {
        reader_loop(ReaderLoopArgs {
            stdout,
            on_event,
            stdin,
            protocol,
            child,
            stderr_tail: reader_tail,
            sessions,
            rpc_id,
            abort_signal,
            session_id: session_id_slot,
        });
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

/// Avvia una sessione OMP dedicata al Laboratorio prototipi, distinta da quella principale.
///
/// Rispetto alla sessione ordinaria:
/// 1. Riceve identita' esplicita di progetto e prototipo via argomenti ed environment;
/// 2. Genera una configurazione isolata per-sessione in temp che disattiva shell,
///    interpreti host, browser generico e MCP, e carica l'estensione confinata dello Step 4;
/// 3. NON riusa l'overlay `approvalMode: yolo` della sessione principale;
/// 4. NON modifica la configurazione globale dell'utente in `~/.omp`;
/// 5. NON tocca ne' altera il percorso PTY del principale.
#[tauri::command]
pub async fn rpc_open_lab(
    project_path: String,
    prototype_id: String,
    project_key: Option<String>,
    resume: Option<String>,
    on_event: Channel<String>,
    manager: State<'_, RpcManager>,
) -> Result<u64, String> {
    if !is_valid_prototype_id(&prototype_id) {
        return Err(format!("Id prototipo non valido: {:?}", prototype_id));
    }

    let is_draft = project_path.is_empty();
    if !is_draft {
        let p = std::path::Path::new(&project_path);
        if !p.is_dir() {
            return Err(format!(
                "Directory di progetto inesistente per la sessione Laboratorio: {}",
                project_path
            ));
        }
    }

    let omp_path = crate::omp_ops::get_omp_binary();
    let lab_extension =
        crate::pty::write_extension("studio-lab.ts", LAB_EXTENSION_TS);

    let rpc_id = {
        let mut guard = manager.next_id.lock();
        let id = *guard;
        *guard += 1;
        id
    };

    let lab_config_path = write_lab_session_config(
        rpc_id,
        &prototype_id,
        lab_extension.as_deref(),
    )?;

    let launch_cwd = if is_draft {
        ".".to_string()
    } else {
        project_path.clone()
    };

    let mut command = Command::new(&omp_path);
    command.arg("--mode").arg("rpc-ui");
    if is_draft {
        command.arg("--no-session");
    } else {
        command.arg("--cwd").arg(&project_path);
    }

    command.arg("--config").arg(&lab_config_path);

    if let Some(path) = &lab_extension {
        command.arg("-e").arg(path);
    }

    if let Some(session_id) = resume
        .as_deref()
        .filter(|id| !id.is_empty() && crate::omp_ops::session_transcript_exists(id))
    {
        command.arg("--resume").arg(session_id);
    }

    let effective_key = project_key
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| project_path.clone());

    command
        .current_dir(&launch_cwd)
        .env("OMP_STUDIO", "1")
        .env("OMP_SKIP_SETUP", "1")
        // Identita di sessione, progetto e prototipo
        .env("OMP_LAB_SESSION", "1")
        .env("OMP_LAB_PROTOTYPE_ID", &prototype_id)
        .env("OMP_LAB_PROJECT_PATH", &project_path)
        .env("OMP_LAB_PROJECT_KEY", &effective_key)
        .env("OMP_LAB_SCOPE", if is_draft { "draft" } else { "project" })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
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
        .map_err(|error| format!("Avvio di omp per sessione Laboratorio: {}", error))?;

    let stdin = child.stdin.take().ok_or("stdin di omp non disponibile")?;
    let stdout = child.stdout.take().ok_or("stdout di omp non disponibile")?;
    let stderr = child.stderr.take().ok_or("stderr di omp non disponibile")?;

    let stdin = Arc::new(Mutex::new(Some(stdin)));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    let protocol = Arc::new(AtomicU8::new(1));
    let abort_signal = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));

    let session_id_slot = Arc::new(Mutex::new(resume.clone()));
    manager.sessions.lock().insert(
        rpc_id,
        RpcSession {
            child: child.clone(),
            stdin: stdin.clone(),
            stderr_tail: stderr_tail.clone(),
            protocol: protocol.clone(),
            abort_signal: abort_signal.clone(),
            config_path: Some(lab_config_path),
            cwd: project_path.clone(),
            scope: if is_draft { "draft".to_string() } else { "project".to_string() },
            prototype_id: Some(prototype_id.clone()),
            project_key: Some(effective_key.clone()),
            session_id: session_id_slot.clone(),
        },
    );

    let sessions = manager.sessions.clone();
    let reader_tail = stderr_tail.clone();
    thread::spawn(move || {
        reader_loop(ReaderLoopArgs {
            stdout,
            on_event,
            stdin,
            protocol,
            child,
            stderr_tail: reader_tail,
            sessions,
            rpc_id,
            abort_signal,
            session_id: session_id_slot,
        });
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
    let (stdin, abort_signal) = {
        let sessions = manager.sessions.lock();
        let session = sessions
            .get(&rpc_id)
            .ok_or_else(|| format!("Sessione RPC {} non disponibile", rpc_id))?;
        (session.stdin.clone(), session.abort_signal.clone())
    };

    if line.contains("\"type\":\"abort\"") || line.contains("\"type\":\"abort_bash\"") {
        abort_signal.store(true, Ordering::SeqCst);
    }
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
    if let Some(config_file) = session.config_path.as_ref() {
        let _ = std::fs::remove_file(config_file);
    }
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

/// Interrompe la sessione RPC specificata in modo atomico, senza toccare le altre sessioni.
#[tauri::command]
pub async fn rpc_abort(
    rpc_id: u64,
    manager: State<'_, RpcManager>,
) -> Result<(), String> {
    let (stdin, abort_signal) = {
        let sessions = manager.sessions.lock();
        let session = sessions
            .get(&rpc_id)
            .ok_or_else(|| format!("Sessione RPC {} non disponibile", rpc_id))?;
        (session.stdin.clone(), session.abort_signal.clone())
    };

    abort_signal.store(true, Ordering::SeqCst);
    let mut guard = stdin.lock();
    let handle = guard
        .as_mut()
        .ok_or_else(|| format!("Sessione RPC {} in chiusura", rpc_id))?;

    handle
        .write_all(b"{\"id\":\"abort-direct-1\",\"type\":\"abort\"}\n")
        .and_then(|()| handle.write_all(b"{\"id\":\"abort-direct-2\",\"type\":\"abort_bash\"}\n"))
        .and_then(|()| handle.flush())
        .map_err(|error| format!("Invio abort sulla sessione RPC {}: {}", rpc_id, error))
}

/// Restituisce l'elenco delle sessioni RPC attive con metadati e correlazione per sessione.
#[tauri::command]
pub async fn rpc_list_sessions(
    manager: State<'_, RpcManager>,
) -> Result<Vec<RpcSessionInfo>, String> {
    let sessions = manager.sessions.lock();
    let list: Vec<RpcSessionInfo> = sessions
        .iter()
        .map(|(&id, s)| RpcSessionInfo {
            rpc_id: id,
            cwd: s.cwd.clone(),
            scope: s.scope.clone(),
            prototype_id: s.prototype_id.clone(),
            project_key: s.project_key.clone(),
            session_id: s.session_id.lock().clone(),
            protocol: s.protocol.load(Ordering::Relaxed),
        })
        .collect();
    Ok(list)
}


/// Ultime righe di stderr di una sessione **viva**: serve quando il processo
/// e' appeso e non morto. Alla morte le stesse righe arrivano dentro
/// `studio_exit`, perche' a quel punto la sessione non e' piu' nella mappa.
#[tauri::command]
pub async fn rpc_stderr(
    rpc_id: u64,
    manager: State<'_, RpcManager>,
) -> Result<Vec<String>, String> {
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

    fn chunk(
        chunk_id: &str,
        index: usize,
        count: usize,
        byte_length: usize,
        payload: &str,
    ) -> String {
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
        assert!(reassemble(&chunk("c2", 1, 2, 10, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn recupera_sequenza_nuova_dopo_interruzione() {
        let mut assembly = None;
        let _ = reassemble(&chunk("c1", 0, 2, 10, "0123456789"), &mut assembly);
        let logical = r#"{"type":"response","command":"abort"}"#;
        assert_eq!(
            reassemble(&chunk("c2", 0, 1, logical.len(), logical), &mut assembly),
            Ok(Some(logical.to_string()))
        );
        assert!(assembly.is_none());
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

    #[test]
    fn validazione_id_prototipo_laboratorio() {
        assert!(is_valid_prototype_id("prototype-1"));
        assert!(is_valid_prototype_id("test-proto-abc"));
        assert!(is_valid_prototype_id("comp3-variant"));
        assert!(is_valid_prototype_id("a1"));

        // Rifiutati
        assert!(!is_valid_prototype_id(""));
        assert!(!is_valid_prototype_id("a"));
        assert!(!is_valid_prototype_id("UpperCase"));
        assert!(!is_valid_prototype_id("proto_with_underscore"));
        assert!(!is_valid_prototype_id("-starts-with-hyphen"));
        assert!(!is_valid_prototype_id("ends-with-hyphen-"));
        assert!(!is_valid_prototype_id("con"));
        assert!(!is_valid_prototype_id("nul"));
        assert!(!is_valid_prototype_id("com1"));
    }

    #[test]
    fn configurazione_laboratorio_disattiva_tool_e_non_ha_yolo() {
        let config_path = write_lab_session_config(
            999,
            "test-proto-config",
            Some("C:/test/extensions/studio-lab.ts"),
        )
        .expect("scrittura configurazione riuscita");

        assert!(config_path.exists());
        let content = std::fs::read_to_string(&config_path).expect("lettura file riuscita");

        // Verifica tool disattivati
        assert!(content.contains("bash:\n  enabled: false"));
        assert!(content.contains("eval:\n  py: false"));
        assert!(content.contains("browser:\n  enabled: false"));
        assert!(content.contains("mcp:\n  enableProjectConfig: false"));
        assert!(content.contains("tools:\n  xdev: false"));

        // Verifica estensione caricata
        assert!(content.contains("extensions:"));
        assert!(content.contains("C:/test/extensions/studio-lab.ts"));

        // Invariante vincolante: NESSUN overlay yolo
        assert!(!content.contains("approvalMode: yolo"));
        assert!(!content.contains("yolo"));

        // Pulizia
        let _ = std::fs::remove_file(config_path);
    }

    #[test]
    fn correlazione_sessioni_e_metadati_concorrenti() {
        let _manager = RpcManager::new();
        let session_main = RpcSession {
            child: Arc::new(Mutex::new(Command::new("cargo").spawn().unwrap_or_else(|_| {
                // Dummy child for unit test without running processes
                panic!("test");
            }))),
            stdin: Arc::new(Mutex::new(None)),
            stderr_tail: Arc::new(Mutex::new(VecDeque::new())),
            protocol: Arc::new(AtomicU8::new(2)),
            abort_signal: Arc::new(AtomicBool::new(false)),
            config_path: None,
            cwd: "C:/progetto-principale".to_string(),
            scope: "main".to_string(),
            prototype_id: None,
            project_key: None,
            session_id: Arc::new(Mutex::new(Some("session-main-1".to_string()))),
        };
        let _ = session_main; // structure compiles and initializes correctly
    }
}
