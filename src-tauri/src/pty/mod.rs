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

    let mut cmd = CommandBuilder::new("powershell.exe");
    
    // Genera l'overlay per abilitare il titleState senza toccare la configurazione utente
    let mut overlay_path = std::env::temp_dir();
    overlay_path.push("omp-studio-overlay.yml");
    if let Ok(mut f) = std::fs::File::create(&overlay_path) {
        let _ = f.write_all(b"tui:\n  titleState: true\n");
    }

    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("OMP_STUDIO", "1");
    
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

    let pty_id = {
        let mut id_guard = manager.next_id.lock();
        let id = *id_guard;
        *id_guard += 1;
        id
    };

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