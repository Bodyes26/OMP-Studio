//! Gestione e terminazione ricorsiva dell'albero dei processi per PTY e RPC,
//! piu' il registro di proprieta' dei processi per corsia (Gate R27 / PLAN W11).
//!
//! Assicura che su Windows (tramite Windows Job Object e taskkill) e su macOS/POSIX
//! (tramite segnali di processo e process group) la terminazione forzata abbatta
//! ricorsivamente l'intero albero dei processi figli (bash, nodemon, server dev, dotnet).
//!
//! Il registro sotto (`LaneProcessRegistry`) associa ogni albero avviato da una
//! sessione PTY o RPC alla corsia che lo ha chiesto. Non e' un supervisore
//! separato: ogni voce porta con se' il controllo della sessione che l'ha
//! creata, quindi Studio puo' fermare solo cio' che possiede e non deve mai
//! cercare PID per nome ne' indovinare chi sia il padrone di un processo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;

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
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
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
                return Err(format!(
                    "Assegnazione processo {} al Job Object fallita",
                    pid
                ));
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

/// Abbattimento ricorsivo e forzato dell'albero dei processi (SIGKILL / Job Object terminate / taskkill).
pub fn kill_process_tree(pid: Option<u32>, #[cfg(target_os = "windows")] job: Option<&WindowsJob>) {
    #[cfg(target_os = "windows")]
    {
        // 1. Termina l'intero Windows Job Object: il kernel uccide ricorsivamente
        // tutti i processi child e grandchild (PowerShell, omp, bash, node, dotnet, ecc.)
        if let Some(j) = job {
            j.terminate();
        }
        // 2. Ridondanza di sicurezza: taskkill /F /T per garantire la pulizia
        // anche in caso di processi dissociati
        if let Some(p) = pid {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &p.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(p) = pid {
            // Invia SIGTERM e poi SIGKILL al gruppo di processi (-PID)
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &format!("-{}", p)])
                .output();
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &format!("-{}", p)])
                .output();
            // Termina anche il PID singolo direttamente nel caso non fosse process group leader
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &p.to_string()])
                .output();
            // Termina ricorsivamente eventuali processi figli via pkill
            let _ = std::process::Command::new("pkill")
                .args(["-KILL", "-P", &p.to_string()])
                .output();
        }
    }
}

// ---------------------------------------------------------------------------
// Registro di proprieta' dei processi per corsia (PLAN W11)
// ---------------------------------------------------------------------------

/// Corsia implicita quando il frontend non ne indica una: il progetto sta
/// lavorando sulla Principale, non su un worktree sorella.
pub const MAIN_LANE_ID: &str = "main";

/// Chi ha avviato l'albero. Insieme all'id della sessione forma la chiave di
/// proprieta': un processo non registrato non viene mai toccato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaneProcessKind {
    /// Sessione PTY: shell della corsia e tutto cio' che vi si avvia dentro
    /// (`dotnet watch`, `npm run dev`, IIS Express).
    Terminal,
    /// Sessione agente `omp --mode rpc-ui` della corsia.
    Agent,
}

/// Controllo dell'albero posseduto, implementato dalla sessione che lo ha
/// avviato. Il registro non apre handle propri e non conosce i PID figli:
/// delega alla sessione, che gia' possiede Job Object e `Child`.
pub trait LaneProcessControl: Send + Sync {
    /// Vero finche' il processo radice non e' uscito.
    fn is_alive(&self) -> bool;
    /// Abbatte l'albero e attende l'uscita. Deve essere idempotente.
    fn stop_and_wait(&self);
}

struct LaneProcessEntry {
    project_id: String,
    lane_id: String,
    workspace_root: PathBuf,
    pid: Option<u32>,
    label: String,
    started_at_ms: u64,
    control: Arc<dyn LaneProcessControl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneProcessInfo {
    pub kind: LaneProcessKind,
    pub owner_id: u64,
    pub project_id: String,
    pub lane_id: String,
    pub workspace_root: String,
    pub pid: Option<u32>,
    pub label: String,
    pub started_at_ms: u64,
}

/// Esito di un arresto mirato. `remaining` non e' un dettaglio: finche' non e'
/// vuoto la rimozione del worktree resta bloccata.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneProcessStopReport {
    pub stopped: Vec<LaneProcessInfo>,
    pub remaining: Vec<LaneProcessInfo>,
}

pub struct LaneProcessRegistration {
    pub kind: LaneProcessKind,
    pub owner_id: u64,
    pub project_id: String,
    pub lane_id: String,
    pub workspace_root: String,
    pub pid: Option<u32>,
    pub label: String,
    pub control: Arc<dyn LaneProcessControl>,
}

type RegistryKey = (LaneProcessKind, u64);

static LANE_PROCESSES: LazyLock<Mutex<HashMap<RegistryKey, LaneProcessEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_millis() as u64)
        .unwrap_or(0)
}

/// Forma confrontabile di un percorso: niente prefisso verbatim di Windows,
/// separatori uniformi e confronto senza distinzione di maiuscole dove il
/// filesystem non la fa.
fn comparable_components(path: &Path) -> Vec<String> {
    let raw = path.to_string_lossy();
    let raw: &str = raw.as_ref();
    #[cfg(target_os = "windows")]
    let raw = raw
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{}", rest))
        .unwrap_or_else(|| raw.strip_prefix(r"\\?\").unwrap_or(raw).to_string());
    #[cfg(not(target_os = "windows"))]
    let raw = raw.to_string();

    Path::new(&raw)
        .components()
        .map(|component| {
            let value = component.as_os_str().to_string_lossy().to_string();
            if cfg!(target_os = "windows") {
                value.to_ascii_lowercase()
            } else {
                value
            }
        })
        .collect()
}

/// Vero quando `candidate` e' la radice stessa o vi sta dentro. Il confronto e'
/// per componenti: `C:\repos\progetto2` non e' dentro `C:\repos\progetto`.
fn is_within(root: &Path, candidate: &Path) -> bool {
    let root = comparable_components(root);
    let candidate = comparable_components(candidate);
    if root.is_empty() || root.len() > candidate.len() {
        return false;
    }
    root.iter().zip(candidate.iter()).all(|(a, b)| a == b)
}

/// Radice memorizzata: canonicalizzata quando possibile, cosi' un `cwd`
/// relativo o con junction resta confrontabile con il percorso del worktree.
fn normalize_root(raw: &str) -> PathBuf {
    let path = PathBuf::from(raw);
    path.canonicalize().unwrap_or(path)
}

fn entry_info(key: &RegistryKey, entry: &LaneProcessEntry) -> LaneProcessInfo {
    LaneProcessInfo {
        kind: key.0,
        owner_id: key.1,
        project_id: entry.project_id.clone(),
        lane_id: entry.lane_id.clone(),
        workspace_root: entry.workspace_root.to_string_lossy().to_string(),
        pid: entry.pid,
        label: entry.label.clone(),
        started_at_ms: entry.started_at_ms,
    }
}

/// Registra l'albero appena avviato. Senza id di progetto non c'e' proprieta'
/// da tracciare (Laboratorio, prototipi): la voce non viene creata.
pub fn register_lane_process(registration: LaneProcessRegistration) {
    let project_id = registration.project_id.trim().to_string();
    if project_id.is_empty() {
        return;
    }
    let lane_id = {
        let trimmed = registration.lane_id.trim();
        if trimmed.is_empty() {
            MAIN_LANE_ID.to_string()
        } else {
            trimmed.to_string()
        }
    };
    let entry = LaneProcessEntry {
        project_id,
        lane_id,
        workspace_root: normalize_root(&registration.workspace_root),
        pid: registration.pid,
        label: registration.label,
        started_at_ms: now_ms(),
        control: registration.control,
    };
    LANE_PROCESSES
        .lock()
        .insert((registration.kind, registration.owner_id), entry);
}

pub fn unregister_lane_process(kind: LaneProcessKind, owner_id: u64) {
    LANE_PROCESSES.lock().remove(&(kind, owner_id));
}

/// Voci ancora vive, ordinate in modo deterministico. Le voci di processi
/// gia' usciti vengono potate qui: nessun indicatore fantasma sulla corsia.
fn snapshot(filter: impl Fn(&LaneProcessEntry) -> bool) -> Vec<LaneProcessInfo> {
    let mut registry = LANE_PROCESSES.lock();
    registry.retain(|_, entry| entry.control.is_alive());
    let mut list: Vec<LaneProcessInfo> = registry
        .iter()
        .filter(|(_, entry)| filter(entry))
        .map(|(key, entry)| entry_info(key, entry))
        .collect();
    list.sort_by(|a, b| {
        a.started_at_ms
            .cmp(&b.started_at_ms)
            .then(a.owner_id.cmp(&b.owner_id))
    });
    list
}

pub fn lane_processes() -> Vec<LaneProcessInfo> {
    snapshot(|_| true)
}

pub fn lane_processes_for(project_id: &str, lane_id: &str) -> Vec<LaneProcessInfo> {
    snapshot(|entry| entry.project_id == project_id && entry.lane_id == lane_id)
}

/// Processi vivi radicati dentro `root`: e' il controllo pre-cleanup del
/// worktree, e vale anche per un `cwd` in una sottocartella.
pub fn lane_processes_under(root: &Path) -> Vec<LaneProcessInfo> {
    snapshot(|entry| is_within(root, &entry.workspace_root))
}

fn stop_matching(filter: impl Fn(&LaneProcessEntry) -> bool) -> LaneProcessStopReport {
    // Il lock del registro non viene mai tenuto durante l'arresto: la sessione
    // che sta uscendo si deregistra da sola e richiederebbe lo stesso lock.
    let targets: Vec<(RegistryKey, Arc<dyn LaneProcessControl>, LaneProcessInfo)> = {
        let registry = LANE_PROCESSES.lock();
        registry
            .iter()
            .filter(|(_, entry)| filter(entry))
            .map(|(key, entry)| (*key, entry.control.clone(), entry_info(key, entry)))
            .collect()
    };

    let mut report = LaneProcessStopReport::default();
    for (key, control, info) in targets {
        control.stop_and_wait();
        if control.is_alive() {
            report.remaining.push(info);
        } else {
            LANE_PROCESSES.lock().remove(&key);
            report.stopped.push(info);
        }
    }
    report
}

/// Arresta i soli processi della corsia indicata. Principale e le altre corsie
/// non vengono mai toccate: il filtro e' sull'identita' registrata, non sul
/// nome del processo.
pub fn stop_lane_processes(project_id: &str, lane_id: &str) -> LaneProcessStopReport {
    stop_matching(|entry| entry.project_id == project_id && entry.lane_id == lane_id)
}

/// Arresto mirato per il cleanup di un worktree: tutto e solo cio' che Studio
/// ha avviato dentro quella radice.
pub fn stop_lane_processes_under(root: &Path) -> LaneProcessStopReport {
    stop_matching(|entry| is_within(root, &entry.workspace_root))
}

#[tauri::command]
pub async fn lane_processes_list() -> Result<Vec<LaneProcessInfo>, String> {
    Ok(lane_processes())
}

#[tauri::command]
pub async fn lane_processes_stop(
    project_id: String,
    lane_id: String,
) -> Result<LaneProcessStopReport, String> {
    tokio::task::spawn_blocking(move || stop_lane_processes(&project_id, &lane_id))
        .await
        .map_err(|error| format!("Arresto dei processi della corsia: {}", error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kill_process_tree_termina_processo() {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut child = std::process::Command::new("cmd")
                .args(["/c", "timeout", "/t", "10"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .expect("avvio child cmd");

            let pid = child.id();
            let job = WindowsJob::create_for_process(pid).ok();
            kill_process_tree(Some(pid), job.as_ref());
            let status = child.wait().expect("wait su child");
            assert!(!status.success());
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut child = std::process::Command::new("sleep")
                .arg("10")
                .spawn()
                .expect("avvio child sleep");
            let pid = child.id();
            kill_process_tree(Some(pid));
            let status = child.wait().expect("wait su child");
            assert!(!status.success());
        }
    }

    /// Processo innocuo di prova, posseduto dal test come una sessione
    /// possiede il proprio albero.
    struct OwnedChild {
        child: Mutex<std::process::Child>,
        pid: u32,
    }

    impl OwnedChild {
        fn spawn() -> Arc<Self> {
            #[cfg(target_os = "windows")]
            let child = {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                // Vita lunga rispetto a taskkill, che su Windows puo' impiegare
                // decine di secondi: il processo non deve uscire da solo.
                std::process::Command::new("cmd")
                    .args(["/c", "ping", "-n", "600", "127.0.0.1"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .stdout(std::process::Stdio::null())
                    .spawn()
                    .expect("avvio processo di prova")
            };
            #[cfg(not(target_os = "windows"))]
            let child = std::process::Command::new("sleep")
                .arg("600")
                .spawn()
                .expect("avvio processo di prova");

            let pid = child.id();
            Arc::new(Self {
                child: Mutex::new(child),
                pid,
            })
        }
    }

    impl LaneProcessControl for OwnedChild {
        fn is_alive(&self) -> bool {
            self.child
                .lock()
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false)
        }

        fn stop_and_wait(&self) {
            #[cfg(target_os = "windows")]
            kill_process_tree(Some(self.pid), None);
            #[cfg(not(target_os = "windows"))]
            kill_process_tree(Some(self.pid));
            let mut child = self.child.lock();
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("omp-studio-w11-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&root).expect("creazione radice di prova");
        root.canonicalize().unwrap_or(root)
    }

    fn register(owner_id: u64, project: &str, lane: &str, root: &Path, control: Arc<OwnedChild>) {
        register_lane_process(LaneProcessRegistration {
            kind: LaneProcessKind::Terminal,
            owner_id,
            project_id: project.to_string(),
            lane_id: lane.to_string(),
            workspace_root: root.to_string_lossy().to_string(),
            pid: Some(control.pid),
            label: "Terminale".to_string(),
            control,
        });
    }

    #[test]
    fn test_is_within_confronta_per_componenti() {
        let root = Path::new("C:/repos/progetto");
        assert!(is_within(root, Path::new("C:/repos/progetto")));
        assert!(is_within(root, Path::new("C:/repos/progetto/src/lib")));
        // Prefisso testuale ma cartella diversa: non deve mai combaciare.
        assert!(!is_within(root, Path::new("C:/repos/progetto2")));
        assert!(!is_within(root, Path::new("C:/repos")));
    }

    #[test]
    fn w11_processi_confinati_alla_corsia_che_li_ha_avviati() {
        let project = "proj-confine";
        let lane_root = temp_root("lane");
        let main_root = temp_root("main");
        let lane_child = OwnedChild::spawn();
        let main_child = OwnedChild::spawn();
        register(9001, project, "wt-1", &lane_root, lane_child.clone());
        register(9002, project, MAIN_LANE_ID, &main_root, main_child.clone());

        assert_eq!(lane_processes_for(project, "wt-1").len(), 1);
        assert_eq!(lane_processes_for(project, MAIN_LANE_ID).len(), 1);
        let under_lane = lane_processes_under(&lane_root);
        assert_eq!(under_lane.len(), 1);
        assert_eq!(under_lane[0].lane_id, "wt-1");
        assert_eq!(under_lane[0].pid, Some(lane_child.pid));

        // Arresto della sola corsia: la Principale resta viva.
        let report = stop_lane_processes(project, "wt-1");
        assert_eq!(report.stopped.len(), 1);
        assert!(report.remaining.is_empty());
        assert!(!lane_child.is_alive());
        assert!(main_child.is_alive());
        assert!(lane_processes_for(project, "wt-1").is_empty());
        assert_eq!(lane_processes_for(project, MAIN_LANE_ID).len(), 1);
        assert!(lane_processes_under(&lane_root).is_empty());

        let report = stop_lane_processes_under(&main_root);
        assert_eq!(report.stopped.len(), 1);
        assert!(!main_child.is_alive());
        assert!(lane_processes_for(project, MAIN_LANE_ID).is_empty());

        let _ = std::fs::remove_dir_all(&lane_root);
        let _ = std::fs::remove_dir_all(&main_root);
    }

    #[test]
    fn test_voci_morte_potate_dallo_snapshot() {
        let project = "proj-potatura";
        let root = temp_root("potatura");
        let child = OwnedChild::spawn();
        register(9101, project, "wt-9", &root, child.clone());
        assert_eq!(lane_processes_for(project, "wt-9").len(), 1);

        child.stop_and_wait();
        assert!(lane_processes_for(project, "wt-9").is_empty());
        assert!(lane_processes_under(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
}
