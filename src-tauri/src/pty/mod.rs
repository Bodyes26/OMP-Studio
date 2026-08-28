use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::State;

#[cfg(target_os = "windows")]
pub struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsJob {}
#[cfg(target_os = "windows")]
unsafe impl Sync for WindowsJob {}

#[cfg(target_os = "windows")]
impl WindowsJob {
    pub fn create_for_process(pid: u32) -> Result<Self, String> {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        unsafe {
            let job_handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job_handle.is_null() {
                return Err("Creazione Job Object fallita".to_string());
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let res = SetInformationJobObject(
                job_handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if res == 0 {
                CloseHandle(job_handle);
                return Err("Configurazione Job Object (KILL_ON_JOB_CLOSE) fallita".to_string());
            }

            let proc_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid);
            if proc_handle.is_null() {
                CloseHandle(job_handle);
                return Err(format!("Apertura processo PID {} fallita", pid));
            }

            let assign_res = AssignProcessToJobObject(job_handle, proc_handle);
            CloseHandle(proc_handle);

            if assign_res == 0 {
                CloseHandle(job_handle);
                return Err(format!("Assegnazione processo {} al Job Object fallita", pid));
            }

            Ok(Self { handle: job_handle })
        }
    }

    pub fn terminate(&self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        unsafe {
            if !self.handle.is_null() {
                let _ = TerminateJobObject(self.handle, 1);
            }
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        unsafe {
            if !self.handle.is_null() {
                CloseHandle(self.handle);
            }
        }
    }
}

pub struct PtySession {
    pub pty_id: u64,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    pub pid: Option<u32>,
    #[cfg(target_os = "windows")]
    pub job: Option<Arc<WindowsJob>>,
    killed: Arc<AtomicBool>,
}

impl PtySession {
    pub fn kill_tree(&self) {
        if self.killed.swap(true, Ordering::SeqCst) {
            return;
        }

        #[cfg(target_os = "windows")]
        {
            // 1. Termina l'intero Windows Job Object: il kernel uccide ricorsivamente
            // tutti i processi child e grandchild (PowerShell, omp, node, ecc.)
            if let Some(job) = &self.job {
                job.terminate();
            }
            // 2. Ridondanza di sicurezza: taskkill /F /T per garantire la pulizia
            // anche in caso di processi dissociati
            if let Some(pid) = self.pid {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Some(pid) = self.pid {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &format!("-{}", pid)])
                    .output();
                let _ = std::process::Command::new("kill")
                    .args(["-KILL", &format!("-{}", pid)])
                    .output();
            }
        }

        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();

        remove_breadcrumb(self.pty_id);
    }
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
    pub model_selector: Option<String>,
    pub thinking_level: Option<String>,
}

fn session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    let session_id = stem
        .rsplit_once('_')
        .map_or(stem.as_ref(), |(_, suffix)| suffix);
    (!session_id.is_empty()).then(|| session_id.to_string())
}

fn read_session_configuration(path: &Path) -> (Option<String>, Option<String>) {
    const TAIL_BYTES: u64 = 128 * 1024;
    let Ok(mut file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
        return (None, None);
    };
    let start = length.saturating_sub(TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return (None, None);
    }
    let mut bytes = Vec::with_capacity((length - start) as usize);
    if file.read_to_end(&mut bytes).is_err() {
        return (None, None);
    }
    let tail = String::from_utf8_lossy(&bytes);
    let mut lines = tail.lines();
    if start > 0 {
        lines.next();
    }

    let mut model_selector = None;
    let mut thinking_level = None;
    for line in lines {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match value.get("type").and_then(|kind| kind.as_str()) {
            Some("model_change") => {
                if let Some(model) = value.get("model").and_then(|model| model.as_str()) {
                    model_selector = Some(model.to_string());
                }
            }
            Some("thinking_level_change") => {
                if let Some(level) = value
                    .get("thinkingLevel")
                    .and_then(|level| level.as_str())
                {
                    thinking_level = Some(level.to_string());
                }
            }
            _ => {}
        }
    }
    (model_selector, thinking_level)
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
    let (model_selector, thinking_level) = read_session_configuration(path);

    Ok(Some(PtySessionInfo {
        session_id,
        session_path: path.to_string_lossy().into_owned(),
        cwd: cwd.trim_end_matches('\r').to_string(),
        fresh,
        model_selector,
        thinking_level,
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
pub const TASKS_EXTENSION_TS: &str = include_str!("../../../extensions/studio-tasks.ts");

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
    sessions: Arc<Mutex<HashMap<u64, PtySession>>>,
    next_id: Mutex<u64>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Mutex::new(1),
        }
    }

    pub fn close_all(&self) {
        let sessions: Vec<(u64, PtySession)> = {
            let mut lock = self.sessions.lock();
            lock.drain().collect()
        };
        for (pty_id, session) in sessions {
            session.kill_tree();
            remove_breadcrumb(pty_id);
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.close_all();
    }
}

pub fn remove_breadcrumb(pty_id: u64) {
    if let Some(mut breadcrumb) = crate::omp_ops::agent_dir() {
        breadcrumb.push("terminal-sessions");
        breadcrumb.push(format!("wt-{}", terminal_id(pty_id)));
        let _ = std::fs::remove_file(breadcrumb);
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
    let tasks_extension_arg = write_extension("studio-tasks.ts", TASKS_EXTENSION_TS);

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
        if let Some(ext) = &tasks_extension_arg {
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
        if let Some(ext) = &tasks_extension_arg {
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

    let pid = child.process_id();

    #[cfg(target_os = "windows")]
    let job = if let Some(proc_id) = pid {
        match WindowsJob::create_for_process(proc_id) {
            Ok(j) => {
                println!(
                    "[PTY] Associato processo {} a Windows Job Object (kill on close)",
                    proc_id
                );
                Some(Arc::new(j))
            }
            Err(e) => {
                eprintln!(
                    "[PTY] Avviso: associazione Job Object fallita per PID {}: {}",
                    proc_id, e
                );
                None
            }
        }
    } else {
        None
    };

    let session = PtySession {
        pty_id,
        master: master_arc.clone(),
        writer: writer_arc.clone(),
        child: Arc::new(Mutex::new(child)),
        pid,
        #[cfg(target_os = "windows")]
        job,
        killed: Arc::new(AtomicBool::new(false)),
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
    let writer = {
        let sessions = manager.sessions.lock();
        let session = sessions
            .get(&pty_id)
            .ok_or_else(|| format!("PTY {} non disponibile", pty_id))?;
        session.writer.clone()
    };
    tokio::task::spawn_blocking(move || {
        let mut writer = writer.lock();
        writer
            .write_all(&data)
            .map_err(|error| format!("Scrittura PTY {}: {}", pty_id, error))?;
        writer
            .flush()
            .map_err(|error| format!("Flush PTY {}: {}", pty_id, error))
    })
    .await
    .map_err(|e| format!("Task pty_write: {}", e))?
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
    tokio::task::spawn_blocking(move || {
        if let Some(session) = session {
            session.kill_tree();
        }
        remove_breadcrumb(pty_id);
    })
    .await
    .map_err(|e| format!("Chiusura PTY {}: {}", pty_id, e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn legge_ultima_configurazione_dalla_coda_della_sessione() {
        let path = std::env::temp_dir().join(format!(
            "omp-studio-session-config-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        // Righe piu' vecchie della finestra di coda: la funzione legge gli
        // ultimi 128 KiB, quindi la configurazione iniziale di una sessione
        // lunghissima resta invisibile e vince quella recente.
        let mut content = String::new();
        content.push_str(
            "{\"type\":\"model_change\",\"model\":\"anthropic/claude-opus-5\"}\n\
             {\"type\":\"thinking_level_change\",\"thinkingLevel\":\"low\"}\n",
        );
        while content.len() < 200 * 1024 {
            content.push_str("{\"type\":\"message\",\"message\":{\"role\":\"user\"}}\n");
        }
        content.push_str(
            "{\"type\":\"model_change\",\"model\":\"openai-codex/gpt-5.6-sol\"}\n\
             {\"type\":\"thinking_level_change\",\"thinkingLevel\":\"high\"}\n\
             {\"type\":\"model_change\",\"model\":\"anthropic/claude-sonnet-5\"}\n",
        );
        std::fs::write(&path, &content).unwrap();

        let (model, thinking) = read_session_configuration(&path);
        assert_eq!(model.as_deref(), Some("anthropic/claude-sonnet-5"));
        assert_eq!(thinking.as_deref(), Some("high"));

        // File corto: nessuna riga viene scartata, la prima resta leggibile.
        std::fs::write(
            &path,
            "{\"type\":\"model_change\",\"model\":\"google/gemini-3.7-flash\"}\n",
        )
        .unwrap();
        let (model, thinking) = read_session_configuration(&path);
        assert_eq!(model.as_deref(), Some("google/gemini-3.7-flash"));
        assert_eq!(thinking, None);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pty_manager_close_all_gestisce_mappa_vuota() {
        let manager = PtyManager::new();
        manager.close_all();
        assert!(manager.sessions.lock().is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_job_creazione_e_terminazione_child_process() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut child = Command::new("cmd")
            .args(["/c", "timeout", "/t", "10"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .expect("avvio child cmd");

        let pid = child.id();
        let job = WindowsJob::create_for_process(pid);
        assert!(job.is_ok(), "Job Object associato al child process");

        // Termina il Job Object e verifica che il processo sia stato terminato
        if let Ok(j) = job {
            j.terminate();
        }
        let status = child.wait().expect("wait su child");
        assert!(!status.success());
    }
}
