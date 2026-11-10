//! Letture di sistema: registro, processi, lingua, cartelle note, riga di comando.

use std::path::PathBuf;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

/// Valori scritti dal template NSIS di Tauri in modalita' `currentUser` (HKCU).
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\OMP Studio";
pub const PRODUCT_NAME: &str = "OMP Studio";
const DEFAULT_BINARY: &str = "omp-studio-app.exe";
const WEBVIEW2_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn reg_string(root: HKEY, subkey: &str, value: &str) -> Option<String> {
    let subkey = wide(subkey);
    let value = wide(value);
    let mut len: u32 = 0;
    // SAFETY: puntatori a buffer UTF-16 terminati, validi per tutta la chiamata.
    let status = unsafe {
        RegGetValueW(root, subkey.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, null_mut(), null_mut(), &mut len)
    };
    if status != ERROR_SUCCESS || len == 0 {
        return None;
    }
    let mut buf = vec![0u16; (len as usize).div_ceil(2)];
    // SAFETY: `buf` ha la dimensione in byte appena restituita dal registro.
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buf.as_mut_ptr().cast(),
            &mut len,
        )
    };
    (status == ERROR_SUCCESS).then(|| from_wide(&buf))
}

pub struct Installed {
    pub version: String,
    pub dir: PathBuf,
    pub binary: String,
}

/// Installazione per l'utente corrente gia' presente, letta come fa il setup NSIS.
pub fn installed() -> Option<Installed> {
    let version = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "DisplayVersion")?;
    let dir = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "InstallLocation")?;
    let dir = dir.trim().trim_matches('"');
    if dir.is_empty() {
        return None;
    }
    let binary = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "MainBinaryName")
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| DEFAULT_BINARY.to_string());
    Some(Installed { version, dir: PathBuf::from(dir), binary })
}

pub fn studio_binary() -> String {
    installed().map(|i| i.binary).unwrap_or_else(|| DEFAULT_BINARY.to_string())
}

/// Cartella predefinita del template NSIS in modalita' `currentUser`.
pub fn default_install_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(PRODUCT_NAME)
}

/// Stesse tre chiavi che controlla il setup NSIS prima di installare WebView2.
pub fn webview2_present() -> bool {
    let wow = format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}");
    let native = format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}");
    let present = |root: HKEY, key: &str| {
        reg_string(root, key, "pv").is_some_and(|version| !version.is_empty() && version != "0.0.0.0")
    };
    present(HKEY_LOCAL_MACHINE, &wow) || present(HKEY_LOCAL_MACHINE, &native) || present(HKEY_CURRENT_USER, &native)
}

/// Mica esiste da Windows 11 (build 22000); su Windows 10 si usa un fondo pieno.
pub fn supports_mica() -> bool {
    reg_string(HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber")
        .and_then(|build| build.trim().parse::<u32>().ok())
        .is_some_and(|build| build >= 22000)
}

/// Italiano se la lingua dell'interfaccia di Windows e' l'italiano, altrimenti inglese.
pub fn ui_lang() -> &'static str {
    // SAFETY: nessun argomento, restituisce un LANGID.
    let langid = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    if langid & 0x3ff == 0x10 {
        "it"
    } else {
        "en"
    }
}

/// Riga di comando originale senza il percorso dell'eseguibile, da passare intatta
/// al setup NSIS: `/D=` va per ultimo e senza virgolette, e il parsing di std la cambierebbe.
pub fn command_line_tail() -> String {
    // SAFETY: GetCommandLineW restituisce una stringa terminata valida per tutta la vita del processo.
    let line = unsafe {
        let ptr = windows_sys::Win32::System::Environment::GetCommandLineW();
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    };
    let line = line.trim_start();
    let rest = if let Some(quoted) = line.strip_prefix('"') {
        quoted.find('"').map_or("", |end| &quoted[end + 1..])
    } else {
        line.find(char::is_whitespace).map_or("", |end| &line[end..])
    };
    rest.trim_start().to_string()
}

/// Processi di Studio dell'utente corrente: quelli di altri utenti non si aprono e non contano.
fn studio_processes(binary: &str) -> Vec<HANDLE> {
    let mut handles = Vec::new();
    // SAFETY: snapshot e PROCESSENTRY32W usati secondo il contratto di Toolhelp32.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return handles;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry) != 0;
        while ok {
            if from_wide(&entry.szExeFile).eq_ignore_ascii_case(binary) {
                let handle = OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | PROCESS_SYNCHRONIZE,
                    0,
                    entry.th32ProcessID,
                );
                if !handle.is_null() {
                    handles.push(handle);
                }
            }
            ok = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    handles
}

pub fn studio_running() -> bool {
    let handles = studio_processes(&studio_binary());
    let running = !handles.is_empty();
    for handle in handles {
        // SAFETY: handle aperto da studio_processes.
        unsafe { CloseHandle(handle) };
    }
    running
}

/// Termina Studio e aspetta che i processi escano, cosi' NSIS puo' sostituire l'eseguibile.
pub fn terminate_studio() -> bool {
    for handle in studio_processes(&studio_binary()) {
        // SAFETY: handle aperto con PROCESS_TERMINATE | PROCESS_SYNCHRONIZE.
        unsafe {
            TerminateProcess(handle, 1);
            WaitForSingleObject(handle, 5000);
            CloseHandle(handle);
        }
    }
    !studio_running()
}

/// Toglie il collegamento sul desktop che il setup NSIS crea sempre in modalita' silenziosa.
pub fn remove_desktop_shortcut() {
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath};
    let mut raw = null_mut();
    // SAFETY: SHGetKnownFolderPath alloca `raw`, liberato con CoTaskMemFree anche in errore.
    let desktop = unsafe {
        let hr = SHGetKnownFolderPath(&FOLDERID_Desktop, 0, null_mut(), &mut raw);
        let path = if hr >= 0 && !raw.is_null() {
            let mut len = 0;
            while *raw.add(len) != 0 {
                len += 1;
            }
            Some(PathBuf::from(String::from_utf16_lossy(std::slice::from_raw_parts(raw, len))))
        } else {
            None
        };
        CoTaskMemFree(raw.cast());
        path
    };
    if let Some(desktop) = desktop {
        let _ = std::fs::remove_file(desktop.join(format!("{PRODUCT_NAME}.lnk")));
    }
}
