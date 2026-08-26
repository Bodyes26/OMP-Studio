use tauri::{AppHandle, Manager, UserAttentionType};
#[cfg(target_os = "windows")]
use tauri::WebviewWindow;

#[tauri::command]
pub fn set_app_attention(
    app: AppHandle,
    count: u32,
    alert: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if count > 0 {
            #[cfg(target_os = "windows")]
            {
                win_set_overlay_icon(&window, count);
            }
            #[cfg(target_os = "macos")]
            {
                // Il badge del Dock e' esposto dalla finestra, non da AppHandle.
                let _ = window.set_badge_count(Some(count as i64));
            }
            if alert {
                let _ = window.request_user_attention(Some(UserAttentionType::Informational));
            }
        } else {
            clear_app_attention(app)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn clear_app_attention(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
            win_clear_overlay_icon(&window);
        }
        #[cfg(target_os = "macos")]
        {
            let _ = window.set_badge_count(None);
        }
        let _ = window.request_user_attention(None);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[allow(non_snake_case)]
#[repr(C)]
struct ITaskbarList3Vtbl {
    // IUnknown
    pub QueryInterface: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        riid: *const windows_sys::core::GUID,
        ppvObject: *mut *mut std::ffi::c_void,
    ) -> i32,
    pub AddRef: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> u32,
    pub Release: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> u32,
    // ITaskbarList
    pub HrInit: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> i32,
    pub AddTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: windows_sys::Win32::Foundation::HWND) -> i32,
    pub DeleteTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: windows_sys::Win32::Foundation::HWND) -> i32,
    pub ActivateTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: windows_sys::Win32::Foundation::HWND) -> i32,
    pub SetActiveAlt: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: windows_sys::Win32::Foundation::HWND) -> i32,
    // ITaskbarList2
    pub MarkFullscreenWindow: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        fFullscreen: i32,
    ) -> i32,
    // ITaskbarList3
    pub SetProgressValue: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        ullCompleted: u64,
        ullTotal: u64,
    ) -> i32,
    pub SetProgressState: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        tbpFlags: i32,
    ) -> i32,
    pub RegisterTab: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwndTab: windows_sys::Win32::Foundation::HWND,
        hwndMDI: windows_sys::Win32::Foundation::HWND,
    ) -> i32,
    pub UnregisterTab: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwndTab: windows_sys::Win32::Foundation::HWND,
    ) -> i32,
    pub SetTabOrder: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwndTab: windows_sys::Win32::Foundation::HWND,
        hwndInsertBefore: windows_sys::Win32::Foundation::HWND,
    ) -> i32,
    pub SetTabActive: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwndTab: windows_sys::Win32::Foundation::HWND,
        hwndMDI: windows_sys::Win32::Foundation::HWND,
        dwFlags: u32,
    ) -> i32,
    pub ThumbBarAddButtons: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        cButtons: u32,
        pButton: *const std::ffi::c_void,
    ) -> i32,
    pub ThumbBarUpdateButtons: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        cButtons: u32,
        pButton: *const std::ffi::c_void,
    ) -> i32,
    pub ThumbBarSetImageList: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        himl: *mut std::ffi::c_void,
    ) -> i32,
    pub SetOverlayIcon: unsafe extern "system" fn(
        this: *mut std::ffi::c_void,
        hwnd: windows_sys::Win32::Foundation::HWND,
        hIcon: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
        pszDescription: *const u16,
    ) -> i32,
}

#[cfg(target_os = "windows")]
const CLSID_TASKBAR_LIST: windows_sys::core::GUID = windows_sys::core::GUID::from_u128(0x56fdf344_fd6d_11d0_958a_006097c9a090);
#[cfg(target_os = "windows")]
const IID_ITASKBAR_LIST3: windows_sys::core::GUID = windows_sys::core::GUID::from_u128(0xea1afb91_9e28_4b86_90e9_9e9f8a5eefaf);

#[cfg(target_os = "windows")]
static RED_DOT_ICON: std::sync::LazyLock<usize> = std::sync::LazyLock::new(|| {
    use windows_sys::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, ICONINFO};

    unsafe {
        // Disegna un cerchio rosso 16x16 con anti-aliasing leggero (canale alpha premoltiplicato)
        const W: u32 = 16;
        const H: u32 = 16;
        let mut color_pixels = [0u32; (W * H) as usize];
        let mask_bits = [0u8; ((W + 7) / 8 * H) as usize];

        let cx = 7.5f32;
        let cy = 7.5f32;
        let radius = 6.0f32;

        for y in 0..H {
            for x in 0..W {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                let dist = (dx * dx + dy * dy).sqrt();

                let idx = (y * W + x) as usize;
                if dist <= radius - 0.75 {
                    // Rosso pieno brillante #E53935 con bordo leggermente piu scuro
                    let (r, g, b) = if dist >= radius - 1.5 {
                        (0xC6, 0x28, 0x28) // Bordo rosso scuro
                    } else {
                        (0xEF, 0x44, 0x44) // Centro rosso vivo
                    };
                    // Formato BGRA premoltiplicato
                    color_pixels[idx] = (0xFF << 24) | (r << 16) | (g << 8) | b;
                } else if dist <= radius + 0.75 {
                    // Bordo sfumato anti-alias
                    let factor = (radius + 0.75 - dist) / 1.5;
                    let alpha = (factor * 255.0).clamp(0.0, 255.0) as u32;
                    let r = ((0xC6 as f32) * factor) as u32;
                    let g = ((0x28 as f32) * factor) as u32;
                    let b = ((0x28 as f32) * factor) as u32;
                    color_pixels[idx] = (alpha << 24) | (r << 16) | (g << 8) | b;
                } else {
                    color_pixels[idx] = 0;
                }
            }
        }

        let color_bmp = CreateBitmap(W as i32, H as i32, 1, 32, color_pixels.as_ptr() as *const _);
        let mask_bmp = CreateBitmap(W as i32, H as i32, 1, 1, mask_bits.as_ptr() as *const _);

        let icon_info = ICONINFO {
            fIcon: 1,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask_bmp,
            hbmColor: color_bmp,
        };

        let icon = CreateIconIndirect(&icon_info);
        DeleteObject(color_bmp);
        DeleteObject(mask_bmp);
        icon as usize
    }
});

#[cfg(target_os = "windows")]
fn win_set_overlay_icon(window: &WebviewWindow, _count: u32) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::HICON;

    let hicon_raw = *RED_DOT_ICON;

    if let Ok(hwnd_raw) = window.hwnd() {
        unsafe {
            let _ = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED as u32);
            let mut obj: *mut std::ffi::c_void = std::ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_TASKBAR_LIST,
                std::ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_ITASKBAR_LIST3,
                &mut obj,
            );

            if hr >= 0 && !obj.is_null() {
                let vtable = *(obj as *mut *mut ITaskbarList3Vtbl);
                let _ = ((*vtable).HrInit)(obj);
                let desc: [u16; 10] = [
                    'A' as u16, 't' as u16, 't' as u16, 'e' as u16, 'n' as u16, 'z' as u16,
                    'i' as u16, 'o' as u16, 'n' as u16, 0,
                ];
                let _ = ((*vtable).SetOverlayIcon)(
                    obj,
                    hwnd_raw.0 as HWND,
                    hicon_raw as HICON,
                    desc.as_ptr(),
                );
                let _ = ((*vtable).Release)(obj);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn win_clear_overlay_icon(window: &WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::HICON;

    if let Ok(hwnd_raw) = window.hwnd() {
        unsafe {
            let _ = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED as u32);
            let mut obj: *mut std::ffi::c_void = std::ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_TASKBAR_LIST,
                std::ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_ITASKBAR_LIST3,
                &mut obj,
            );

            if hr >= 0 && !obj.is_null() {
                let vtable = *(obj as *mut *mut ITaskbarList3Vtbl);
                let _ = ((*vtable).HrInit)(obj);
                let _ = ((*vtable).SetOverlayIcon)(
                    obj,
                    hwnd_raw.0 as HWND,
                    0 as HICON,
                    std::ptr::null(),
                );
                let _ = ((*vtable).Release)(obj);
            }
        }
    }
}

/// Configura l'AppUserModelId (AUMID) e i metadati di notifica per Windows 10/11.
/// Questo assicura che le notifiche toast mostrino l'icona e il nome di OMP Studio
/// e vengano integrate correttamente nel Centro Notifiche di Windows.
#[cfg(target_os = "windows")]
pub fn init_windows_aumid() {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;

    const AUMID_STR: &str = "sh.omp.studio";
    let aumid: Vec<u16> = std::ffi::OsStr::new(AUMID_STR)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let hr = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(aumid.as_ptr());
        if hr < 0 {
            eprintln!("[Alerts] SetCurrentProcessExplicitAppUserModelID HRESULT: 0x{:08X}", hr);
        }
    }

    // Registra nel registro HKCU\Software\Classes\AppUserModelId\sh.omp.studio
    if let Ok(exe) = std::env::current_exe() {
        let exe_path = exe.to_string_lossy().to_string();
        let script = format!(
            "$path = 'HKCU:\\Software\\Classes\\AppUserModelId\\{}';\
             if (-not (Test-Path $path)) {{ New-Item -Path $path -Force | Out-Null }};\
             Set-ItemProperty -Path $path -Name 'DisplayName' -Value 'OMP Studio' -Force;\
             Set-ItemProperty -Path $path -Name 'IconBackgroundColor' -Value '0' -Force;\
             Set-ItemProperty -Path $path -Name 'ShowInSettings' -Value 1 -Type DWord -Force;\
             Set-ItemProperty -Path $path -Name 'IconUri' -Value '{}' -Force;",
            AUMID_STR,
            exe_path.replace('\'', "''")
        );
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ]);
        cmd.creation_flags(0x0800_0000);
        let _ = cmd.output();
    }
}

#[cfg(not(target_os = "windows"))]
pub fn init_windows_aumid() {}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[test]
    #[cfg(target_os = "windows")]
    fn test_init_windows_aumid_registers_registry_keys() {
        init_windows_aumid();

        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\AppUserModelId\\sh.omp.studio').DisplayName",
        ]);
        cmd.creation_flags(0x0800_0000);
        let out = cmd.output().expect("verifica AUMID");
        let display_name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(display_name, "OMP Studio");
    }
}
