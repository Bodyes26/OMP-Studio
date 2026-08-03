use std::sync::Arc;
use parking_lot::Mutex;
use std::thread;
use std::collections::HashMap;
use std::io::{Read, Write};
use portable_pty::{CommandBuilder, native_pty_system, PtySize, MasterPty, Child};
use tauri::ipc::{Channel, Response};
use tauri::State;

pub struct PtySession {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// Cita un argomento per la riga di comando di PowerShell (single-quoted).
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Prefisso dell'id di terminale che Studio si assegna. `omp` deriva l'id da
/// `WT_SESSION` (packages/tui/src/ttyid.ts) e scrive il breadcrumb
/// `~/.omp/agent/terminal-sessions/wt-<id>` con cwd e file di sessione: e' il
/// solo modo deterministico di sapere quale sessione gira in quale scheda.
/// Fingersi Windows Terminal abilita anche truecolor e gli hyperlink OSC 8.
pub const TERMINAL_ID_PREFIX: &str = "0MP57UD10";

/// Id di terminale per un PTY: stabile dentro l'esecuzione, riconoscibile
/// come nostro, mai in collisione con un UUID vero di Windows Terminal.
pub fn terminal_id(pty_id: u64) -> String {
    format!("{}-{:016}", TERMINAL_ID_PREFIX, pty_id)
}

/// Overlay di configurazione passato con `--config`: non tocca la config
/// dell'utente e vale solo per le sessioni lanciate da Studio.
/// `theme.dark`/`theme.light` puntano al tema scritto da `theme_apply`, e solo
/// se quel file esiste: un nome di tema inesistente farebbe ripiegare `omp`
/// sul tema builtin `dark`, cambiando l'aspetto della TUI dell'utente.
fn write_overlay() -> std::path::PathBuf {
    let mut overlay_path = std::env::temp_dir();
    overlay_path.push("omp-studio-overlay.yml");

    let mut yml = String::from("tui:\n  titleState: true\n  hyperlinks: always\n");
    if crate::omp_ops::studio_theme_file().is_some_and(|p| p.exists()) {
        yml.push_str("theme:\n  dark: ");
        yml.push_str(crate::omp_ops::STUDIO_THEME_NAME);
        yml.push_str("\n  light: ");
        yml.push_str(crate::omp_ops::STUDIO_THEME_NAME);
        yml.push('\n');
    }

    if let Ok(mut f) = std::fs::File::create(&overlay_path) {
        let _ = f.write_all(yml.as_bytes());
    }
    overlay_path
}

pub struct PtyManager {
    sessions: Mutex<HashMap<u64, PtySession>>,
    next_id: Mutex<u64>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            sessions: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

#[tauri::command]
pub async fn pty_open(
    cwd: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<Response>,
    manager: State<'_, PtyManager>,
) -> Result<u64, String> {
    let pty_system = native_pty_system();
    
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let omp_path = if !local_app_data.is_empty() {
        format!("{}\\omp\\omp.exe", local_app_data)
    } else {
        "omp.exe".to_string()
    };

    let pty_id = {
        let mut id_guard = manager.next_id.lock();
        let id = *id_guard;
        *id_guard += 1;
        id
    };

    let mut cmd = CommandBuilder::new("powershell.exe");
    
    let overlay_path = write_overlay();

    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("OMP_STUDIO", "1");
    // Identifica il terminale per `omp`: senza, niente breadcrumb e nessun
    // modo di sapere quale sessione appartiene a questa scheda.
    cmd.env("WT_SESSION", terminal_id(pty_id));
    cmd.env("PI_FORCE_HYPERLINKS", "1");
    
    // omp gira dentro una shell interattiva (-NoExit): all'uscita di omp
    // l'utente resta su un prompt vero invece che su un PTY morto.
    let mut launch = format!("& {}", ps_quote(&omp_path));
    launch.push_str(" --config ");
    launch.push_str(&ps_quote(&overlay_path.to_string_lossy()));
    for arg in &args {
        launch.push(' ');
        launch.push_str(&ps_quote(arg));
    }

    cmd.arg("-NoLogo");
    cmd.arg("-NoProfile");
    cmd.arg("-NoExit");
    cmd.arg("-Command");
    cmd.arg(&launch);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let master_pty = pair.master;
    let reader = master_pty.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master_pty.take_writer().map_err(|e| e.to_string())?;

    let master_arc = Arc::new(Mutex::new(master_pty));
    let writer_arc = Arc::new(Mutex::new(writer));

    let session = PtySession {
        master: master_arc.clone(),
        writer: writer_arc.clone(),
        child: Arc::new(Mutex::new(child)),
    };

    manager.sessions.lock().insert(pty_id, session);

    // Read thread
    thread::spawn(move || {
        let mut buf = [0u8; 65536];
        let mut reader = reader;
        
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    if let Err(_) = on_output.send(Response::new(buf[..n].to_vec())) {
                        break;
                    }
                }
                _ => break,
            }
        }
    });

    Ok(pty_id)
}

#[tauri::command]
pub async fn pty_write(
    pty_id: u64,
    data: Vec<u8>,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = manager.sessions.lock();
    if let Some(session) = sessions.get(&pty_id) {
        let mut writer = session.writer.lock();
        let _ = writer.write_all(&data);
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_resize(
    pty_id: u64,
    cols: u16,
    rows: u16,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = manager.sessions.lock();
    if let Some(session) = sessions.get(&pty_id) {
        let master = session.master.lock();
        let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_close(
    pty_id: u64,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let session = manager.sessions.lock().remove(&pty_id);
    if let Some(session) = session {
        let mut child = session.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}