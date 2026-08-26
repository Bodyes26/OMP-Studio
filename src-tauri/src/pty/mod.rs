use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::State;

pub struct PtySession {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// Cita un argomento per la riga di comando di PowerShell (single-quoted).
#[allow(dead_code)]
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Cita un argomento per la riga di comando POSIX shell (single-quoted).
#[allow(dead_code)]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub session_id: String,
    pub session_path: String,
    pub cwd: String,
    pub fresh: bool,
}

fn session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    let session_id = stem
        .rsplit_once('_')
        .map_or(stem.as_ref(), |(_, suffix)| suffix);
    (!session_id.is_empty()).then(|| session_id.to_string())
}

fn read_session_info(pty_id: u64) -> Result<Option<PtySessionInfo>, String> {
    let Some(mut breadcrumb) = crate::omp_ops::agent_dir() else {
        return Ok(None);
    };
    breadcrumb.push("terminal-sessions");
    breadcrumb.push(format!("wt-{}", terminal_id(pty_id)));

    let content = match std::fs::read_to_string(&breadcrumb) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Lettura breadcrumb PTY: {}", error)),
    };
    let mut lines = content.lines();
    let Some(cwd) = lines.next() else {
        return Ok(None);
    };
    let Some(session_path) = lines.next() else {
        return Ok(None);
    };
    let path = Path::new(session_path.trim_end_matches('\r'));
    let Some(session_id) = session_id_from_path(path) else {
        return Ok(None);
    };
    let fresh = lines
        .next()
        .is_some_and(|line| line.trim_end_matches('\r') == "fresh");

    Ok(Some(PtySessionInfo {
        session_id,
        session_path: path.to_string_lossy().into_owned(),
        cwd: cwd.trim_end_matches('\r').to_string(),
        fresh,
    }))
}

#[tauri::command]
pub async fn pty_session_info(
    pty_id: u64,
    manager: State<'_, PtyManager>,
) -> Result<Option<PtySessionInfo>, String> {
    if !manager.sessions.lock().contains_key(&pty_id) {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || read_session_info(pty_id))
        .await
        .map_err(|error| format!("Lettura sessione PTY: {}", error))?
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

/// Sorgente dell'estensione-ponte (tool `studio_diagram`). Inclusa nel
/// binario con `include_str!` dal repo: una sola verita', nessuna risorsa
/// Tauri da configurare.
pub const DIAGRAM_EXTENSION_TS: &str = include_str!("../../../extensions/studio-diagram.ts");

/// Cartella delle estensioni di Studio: `%LOCALAPPDATA%/omp-studio/extensions`
/// su Windows, `~/.omp-studio/extensions` altrove. Mai dentro `~/.omp`.
fn extensions_dir() -> Option<std::path::PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").ok()?
    } else {
        std::env::var("HOME").ok()?
    };
    let dir = std::path::Path::new(&base)
        .join(if cfg!(target_os = "windows") {
            "omp-studio"
        } else {
            ".omp-studio"
        })
        .join("extensions");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Estrae un'estensione inclusa nel binario e ritorna il percorso da passare
/// a omp con `-e`. Riscrive il file quando il sorgente incluso differisce
/// dalla copia su disco: aggiornando Studio si aggiornano le estensioni.
/// None = impossibile scrivere: le sessioni partono comunque, solo senza
/// quell'estensione.
pub fn write_extension(file_name: &str, source: &str) -> Option<String> {
    let path = extensions_dir()?.join(file_name);
    let stale = match std::fs::read_to_string(&path) {
        Ok(existing) => existing != source,
        Err(_) => true,
    };
    if stale {
        std::fs::write(&path, source).ok()?;
    }
    Some(path.to_string_lossy().to_string())
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

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let omp_path = crate::omp_ops::get_omp_binary();
    println!(
        "[PTY] pty_open called: cwd={:?}, omp_path={:?}, args={:?}, cols={}, rows={}",
        cwd, omp_path, args, cols, rows
    );
    let pty_id = {
        let mut id_guard = manager.next_id.lock();
        let id = *id_guard;
        *id_guard += 1;
        id
    };

    let overlay_path = write_overlay();

    // Estensione-ponte per la whiteboard dei diagrammi: vive nel repo di
    // Studio (risorsa inclusa nel binario, scritta accanto all'exe alla
    // prima apertura). Se il file non esiste ancora lo si estrae: nessuna
    // scrittura in ~/.omp, la copia sta in %LOCALAPPDATA%/omp-studio.
    let extension_arg = write_extension("studio-diagram.ts", DIAGRAM_EXTENSION_TS);

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        let mut launch = format!("& {}", ps_quote(&omp_path));
        launch.push_str(" --config ");
        launch.push_str(&ps_quote(&overlay_path.to_string_lossy()));
        if let Some(ext) = &extension_arg {
            launch.push_str(" -e ");
            launch.push_str(&ps_quote(ext));
        }
        for arg in &args {
            launch.push(' ');
            launch.push_str(&ps_quote(arg));
        }

        c.arg("-NoLogo");
        c.arg("-NoProfile");
        c.arg("-NoExit");
        c.arg("-Command");
        c.arg(&launch);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut c = CommandBuilder::new(&shell);
        let mut launch = if std::path::Path::new(&omp_path).exists() {
            format!(
                "{} --config {}",
                sh_quote(&omp_path),
                sh_quote(&overlay_path.to_string_lossy())
            )
        } else {
            format!("exec {} -l", sh_quote(&shell))
        };
        if let Some(ext) = &extension_arg {
            launch.push_str(" -e ");
            launch.push_str(&sh_quote(ext));
        }
        for arg in &args {
            launch.push(' ');
            launch.push_str(&sh_quote(arg));
        }
        launch.push_str(&format!("; exec {} -l", sh_quote(&shell)));

        c.arg("-c");
        c.arg(&launch);
        c
    };
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("OMP_STUDIO", "1");
    // Identifica il terminale per `omp`: senza, niente breadcrumb e nessun
    // modo di sapere quale sessione appartiene a questa scheda.
    cmd.env("WT_SESSION", terminal_id(pty_id));
    cmd.env("PI_FORCE_HYPERLINKS", "1");
    // Il wizard di primo avvio di `omp` non deve comparire in una scheda di
    // lavoro: lo esegue il modal di setup con `omp setup`, che forza le scene
    // e ignora questa variabile. Fuori da Studio l'onboarding nativo resta
    // intatto.
    cmd.env("OMP_SKIP_SETUP", "1");

    #[cfg(not(target_os = "windows"))]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        if let Ok(home) = std::env::var("HOME") {
            let extra_paths = format!(
                "{}/.bun/bin:{}/.cargo/bin:{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{}",
                home, home, home, current_path
            );
            cmd.env("PATH", extra_paths);
        }
        cmd.env("FIG_DISABLE", "1");
    }
    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => {
            println!("[PTY] spawn_command succeeded for pty_id {}", pty_id);
            c
        }
        Err(e) => {
            eprintln!("[PTY] spawn_command failed: {}", e);
            return Err(format!("spawn_command failed: {}", e));
        }
    };

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
    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {} non disponibile", pty_id))?;
    let mut writer = session.writer.lock();
    writer
        .write_all(&data)
        .map_err(|error| format!("Scrittura PTY {}: {}", pty_id, error))?;
    writer
        .flush()
        .map_err(|error| format!("Flush PTY {}: {}", pty_id, error))
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
        let _ = master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_close(pty_id: u64, manager: State<'_, PtyManager>) -> Result<(), String> {
    let session = manager.sessions.lock().remove(&pty_id);
    if let Some(session) = session {
        let mut child = session.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut breadcrumb) = crate::omp_ops::agent_dir() {
        breadcrumb.push("terminal-sessions");
        breadcrumb.push(format!("wt-{}", terminal_id(pty_id)));
        let _ = std::fs::remove_file(breadcrumb);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::session_id_from_path;
    use std::path::Path;

    #[test]
    fn estrae_id_uuid_dal_nome_sessione_omp() {
        let path = Path::new(
            r"C:\Users\utente\.omp\agent\sessions\progetto\2026-08-24T06-25-03-854Z_01a03271-a569-7000-add2-1e09089f3e60.jsonl",
        );
        assert_eq!(
            session_id_from_path(path).as_deref(),
            Some("01a03271-a569-7000-add2-1e09089f3e60")
        );
    }
}
