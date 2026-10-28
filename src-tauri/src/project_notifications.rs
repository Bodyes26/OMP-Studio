//! Gestione notifiche toast native per progetto su Windows.

use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use parking_lot::Mutex;
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::sync::LazyLock;
#[cfg(target_os = "windows")]
use tauri::Emitter;
#[cfg(target_os = "windows")]
use windows::core::HSTRING;
#[cfg(target_os = "windows")]
use windows::Data::Xml::Dom::XmlDocument;
#[cfg(target_os = "windows")]
use windows::Foundation::TypedEventHandler;
#[cfg(target_os = "windows")]
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

pub const TOAST_TAG: &str = "alert";

pub fn project_to_group(project_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn escape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

pub fn is_main_window_focused(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if window.is_minimized().unwrap_or(false) {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd_raw) = window.hwnd() {
            let fg = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
            if !fg.is_null() && fg == (hwnd_raw.0 as windows_sys::Win32::Foundation::HWND) {
                return true;
            }
        }
    }
    window.is_focused().unwrap_or(false)
}

#[cfg(target_os = "windows")]
struct ComGuard(bool);

#[cfg(target_os = "windows")]
impl ComGuard {
    fn new() -> Self {
        let hr = unsafe {
            windows_sys::Win32::System::Com::CoInitializeEx(
                std::ptr::null_mut(),
                windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED as u32,
            )
        };
        Self(hr == 0 || hr == 1)
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe { windows_sys::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(target_os = "windows")]
fn get_aumid(app: &AppHandle) -> Result<String, String> {
    let id = app.config().identifier.clone();
    if id.is_empty() {
        return Err("AUMID non configurato in tauri.conf.json".to_string());
    }
    Ok(id)
}

#[cfg(target_os = "windows")]
struct WindowsNotificationManager {
    active_toasts: HashMap<String, ToastNotification>,
}

#[cfg(target_os = "windows")]
static MANAGER: LazyLock<Mutex<WindowsNotificationManager>> = LazyLock::new(|| {
    Mutex::new(WindowsNotificationManager {
        active_toasts: HashMap::new(),
    })
});

#[cfg(target_os = "windows")]
fn show_toast_native(
    aumid: &str,
    project_id: &str,
    title: &str,
    body: &str,
    silent: bool,
    on_activate: Option<Box<dyn Fn() + Send + 'static>>,
) -> Result<ToastNotification, String> {
    let _com = ComGuard::new();
    let group = project_to_group(project_id);
    let audio = if silent {
        "<audio silent=\"true\"/>"
    } else {
        ""
    };
    let xml = format!(
        "<toast launch=\"{}\">\
            <visual>\
                <binding template=\"ToastGeneric\">\
                    <text>{}</text>\
                    <text>{}</text>\
                </binding>\
            </visual>\
            {}\
        </toast>",
        escape_xml(project_id),
        escape_xml(title),
        escape_xml(body),
        audio
    );

    let doc = XmlDocument::new().map_err(|e| format!("XmlDocument::new: {e}"))?;
    doc.LoadXml(&HSTRING::from(xml.as_str()))
        .map_err(|e| format!("LoadXml: {e}"))?;
    let toast = ToastNotification::CreateToastNotification(&doc)
        .map_err(|e| format!("CreateToastNotification: {e}"))?;
    toast
        .SetGroup(&HSTRING::from(group.as_str()))
        .map_err(|e| format!("SetGroup: {e}"))?;
    toast
        .SetTag(&HSTRING::from(TOAST_TAG))
        .map_err(|e| format!("SetTag: {e}"))?;

    if let Some(callback) = on_activate {
        toast
            .Activated(&TypedEventHandler::new(move |_sender, _args| {
                callback();
                Ok(())
            }))
            .map_err(|e| format!("Activated: {e}"))?;
    }

    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))
        .map_err(|e| format!("CreateToastNotifierWithId: {e}"))?;
    notifier.Show(&toast).map_err(|e| format!("Show: {e}"))?;
    Ok(toast)
}

#[cfg(target_os = "windows")]
fn hide_and_clear_toast_native(
    aumid: &str,
    project_id: &str,
    active_toast: Option<&ToastNotification>,
) -> Result<(), String> {
    let _com = ComGuard::new();
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))
        .map_err(|e| format!("CreateToastNotifierWithId: {e}"))?;

    if let Some(toast) = active_toast {
        notifier.Hide(toast).map_err(|e| format!("Hide: {e}"))?;
    }

    let group = project_to_group(project_id);
    let history = ToastNotificationManager::History().map_err(|e| format!("History: {e}"))?;
    let gh = HSTRING::from(group.as_str());
    let ah = HSTRING::from(aumid);
    history
        .RemoveGroupWithId(&gh, &ah)
        .map_err(|e| format!("RemoveGroupWithId: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn send_project_notification(
    app: AppHandle,
    project_id: String,
    title: String,
    body: String,
    silent: bool,
    test: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut manager = MANAGER.lock();
        if !test && is_main_window_focused(&app) {
            return Ok(());
        }

        let aumid = get_aumid(&app)?;
        let app_handle = app.clone();
        let pid_activation = project_id.clone();

        let on_activate: Option<Box<dyn Fn() + Send + 'static>> = if test {
            None
        } else {
            Some(Box::new(move || {
                let _ = app_handle.emit(
                    "studio-focus-project",
                    serde_json::json!({ "projectId": pid_activation }),
                );
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }))
        };

        let toast = show_toast_native(&aumid, &project_id, &title, &body, silent, on_activate)?;
        manager.active_toasts.insert(project_id, toast);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, project_id, title, body, silent, test);
        Err("send_project_notification is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn dismiss_project_notifications(app: AppHandle, project_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut manager = MANAGER.lock();
        let aumid = get_aumid(&app)?;
        let active = manager.active_toasts.remove(&project_id);
        hide_and_clear_toast_native(&aumid, &project_id, active.as_ref())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, project_id);
        Err("dismiss_project_notifications is only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_xml() {
        assert_eq!(
            escape_xml("a & b < c > d \" e '"),
            "a &amp; b &lt; c &gt; d &quot; e &apos;"
        );
        assert_eq!(escape_xml("normal text 123"), "normal text 123");
    }

    #[test]
    fn test_project_group_stability_and_no_collision() {
        let g1 = project_to_group("a/b");
        let g2 = project_to_group("a_b");
        assert_ne!(
            g1, g2,
            "Different project IDs must have distinct SHA-256 groups"
        );
        assert_eq!(g1.len(), 64);
        assert_eq!(g2.len(), 64);
        assert_eq!(g1, project_to_group("a/b"), "Group must be stable");
    }

    #[test]
    #[ignore]
    #[cfg(target_os = "windows")]
    fn test_native_winrt_toast_smoke() {
        let _com = ComGuard::new();
        let aumid = "sh.omp.studio";
        let p1 = "__smoke_test_project_1__";
        let p2 = "__smoke_test_project_2__";
        let process_id: Vec<u16> = aumid.encode_utf16().chain(Some(0)).collect();
        let hr = unsafe {
            windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
                process_id.as_ptr(),
            )
        };
        assert!(hr >= 0, "Setting smoke process AUMID failed: {hr:#x}");

        let _ = hide_and_clear_toast_native(aumid, p1, None);
        let _ = hide_and_clear_toast_native(aumid, p2, None);

        let run = || -> Result<(), String> {
            let t1 = show_toast_native(aumid, p1, "Smoke 1", "Body 1", true, None)?;
            let t2 = show_toast_native(aumid, p2, "Smoke 2", "Body 2", true, None)?;

            let history = ToastNotificationManager::History().map_err(|e| format!("{e}"))?;
            let wait_for_groups = |first: bool, second: bool| -> Result<(), String> {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                loop {
                    let items = history
                        .GetHistoryWithId(&HSTRING::from(aumid))
                        .map_err(|e| format!("GetHistoryWithId: {e}"))?;
                    let mut found = (false, false);
                    for i in 0..items.Size().map_err(|e| format!("History.Size: {e}"))? {
                        let item = items
                            .GetAt(i)
                            .map_err(|e| format!("History.GetAt({i}): {e}"))?;
                        let project = item
                            .Content()
                            .and_then(|doc| doc.DocumentElement())
                            .and_then(|root| root.GetAttribute(&HSTRING::from("launch")))
                            .map_err(|e| format!("History[{i}].Content: {e}"))?
                            .to_string();
                        found.0 |= project == p1;
                        found.1 |= project == p2;
                    }
                    if found == (first, second) {
                        return Ok(());
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err(format!(
                            "History groups: expected {first:?}/{second:?}, found {found:?}"
                        ));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            };
            wait_for_groups(true, true)?;

            hide_and_clear_toast_native(aumid, p1, Some(&t1))?;

            wait_for_groups(false, true)?;

            hide_and_clear_toast_native(aumid, p2, Some(&t2))?;
            Ok(())
        };

        let result = run();
        let _ = hide_and_clear_toast_native(aumid, p1, None);
        let _ = hide_and_clear_toast_native(aumid, p2, None);

        assert!(result.is_ok(), "Smoke WinRT failed: {:?}", result);
    }
}
