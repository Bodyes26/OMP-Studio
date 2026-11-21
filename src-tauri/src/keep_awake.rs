//! Impedisce la sospensione del sistema finche' c'e' almeno un lavoro che la
//! richiede (R-MI-36: un job chiesto da un'altra macchina). E' una deroga
//! limitata alla decisione F26 di non intervenire sul sonno: dura solo quanto
//! il job, poi la macchina torna alle sue impostazioni.
use parking_lot::Mutex;

static STATE: Mutex<State> = Mutex::new(State { holders: 0, inhibitor: None });

struct State {
    holders: usize,
    inhibitor: Option<Inhibitor>,
}

/// Finche' esiste, il sistema resta sveglio.
pub(crate) struct KeepAwake(());

impl KeepAwake {
    pub(crate) fn acquire(reason: &str) -> Self {
        let mut state = STATE.lock();
        state.holders += 1;
        if state.holders == 1 {
            state.inhibitor = Inhibitor::start(reason)
                .map_err(|error| crate::studio_log::info("keep_awake", format!("Sospensione non impedita: {error}")))
                .ok();
        }
        KeepAwake(())
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        let mut state = STATE.lock();
        state.holders = state.holders.saturating_sub(1);
        if state.holders == 0 {
            state.inhibitor = None;
        }
    }
}

/// macOS e Linux: un processo di sistema che tiene l'asserzione e muore con
/// Studio (`caffeinate -w`, `tail --pid`), cosi' un crash non lascia la
/// macchina sveglia per sempre.
#[cfg(not(target_os = "windows"))]
struct Inhibitor(std::process::Child);

#[cfg(not(target_os = "windows"))]
impl Inhibitor {
    fn start(reason: &str) -> Result<Self, String> {
        use std::os::unix::process::CommandExt;
        let pid = std::process::id().to_string();
        let mut command = if cfg!(target_os = "macos") {
            let mut command = std::process::Command::new("/usr/bin/caffeinate");
            command.args(["-i", "-w", &pid]);
            command
        } else {
            let mut command = std::process::Command::new("systemd-inhibit");
            command.args(["--what=sleep:idle", "--who=OMP Studio", &format!("--why={reason}"), "--mode=block",
                "tail", &format!("--pid={pid}"), "-f", "/dev/null"]);
            command
        };
        command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        command.process_group(0);
        command.spawn().map(Inhibitor).map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
impl Drop for Inhibitor {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Windows: `SetThreadExecutionState` vale per il thread che lo chiama
/// finche' il thread vive; un thread dedicato lo tiene e lo rilascia alla fine.
#[cfg(target_os = "windows")]
struct Inhibitor(Option<std::sync::mpsc::Sender<()>>);

#[cfg(target_os = "windows")]
impl Inhibitor {
    fn start(_reason: &str) -> Result<Self, String> {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        let (stop, wait) = std::sync::mpsc::channel::<()>();
        let (ready, started) = std::sync::mpsc::channel::<bool>();
        std::thread::Builder::new().name("keep-awake".into()).spawn(move || {
            // SAFETY: chiamata Win32 senza puntatori; agisce solo sul thread corrente.
            let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            let _ = ready.send(previous != 0);
            let _ = wait.recv();
            // SAFETY: come sopra; ripristina lo stato normale del thread.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }).map_err(|error| error.to_string())?;
        match started.recv() {
            Ok(true) => Ok(Inhibitor(Some(stop))),
            _ => Err("SetThreadExecutionState failed".into()),
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for Inhibitor {
    fn drop(&mut self) {
        if let Some(stop) = self.0.take() { let _ = stop.send(()); }
    }
}
