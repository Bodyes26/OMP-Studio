//! Gestione e terminazione ricorsiva dell'albero dei processi per PTY e RPC.
//!
//! Assicura che su Windows (tramite Windows Job Object e taskkill) e su macOS/POSIX
//! (tramite segnali di processo e process group) la terminazione forzata abbatta
//! ricorsivamente l'intero albero dei processi figli (bash, nodemon, server dev, dotnet).

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
pub fn kill_process_tree(
    pid: Option<u32>,
    #[cfg(target_os = "windows")] job: Option<&WindowsJob>,
) {
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
}
