//! Icona della finestra principale che segue il colore della taskbar di Windows.
//!
//! Il pi greco di Studio non ha riquadro: su Windows vive direttamente sulla
//! taskbar, che puo' essere chiara o scura. L'icona statica dell'eseguibile
//! (`icons/icon.ico`, la stessa di Esplora risorse e del menu Start) e' quella a
//! gambe scure, leggibile su fondo chiaro; la finestra la sostituisce con le gambe
//! bianche quando la taskbar e' scura.
//!
//! Il colore della taskbar e' `SystemUsesLightTheme`, distinto dal tema delle app
//! (`AppsUseLightTheme`) che Tauri riporta con `WindowEvent::ThemeChanged`: un
//! utente puo' avere app chiare e taskbar scura. Si rilegge quindi il registro
//! sugli eventi di tema e di focus, una lettura da pochi microsecondi.

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicU8, Ordering};
    use tauri::image::Image;
    use tauri::{Runtime, Window};

    const ON_DARK: &[u8] = include_bytes!("../icons/window/pi-on-dark.png");
    const ON_LIGHT: &[u8] = include_bytes!("../icons/window/pi-on-light.png");

    // 0 = mai impostata, 1 = taskbar chiara, 2 = taskbar scura: evita di
    // ricreare l'HICON a ogni focus quando il colore non e' cambiato.
    static APPLIED: AtomicU8 = AtomicU8::new(0);

    /// `true` se la taskbar e' chiara. Senza il valore nel registro Windows usa
    /// la taskbar scura, quindi il default e' `false`.
    fn taskbar_is_light() -> bool {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD,
        };

        let subkey =
            super::wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
        let name = super::wide("SystemUsesLightTheme");
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut value as *mut u32).cast(),
                &mut size,
            )
        };
        status == ERROR_SUCCESS && value != 0
    }

    pub fn sync<R: Runtime>(window: &Window<R>) {
        if window.label() != "main" {
            return;
        }
        let light = taskbar_is_light();
        let state = if light { 1 } else { 2 };
        if APPLIED.swap(state, Ordering::Relaxed) == state {
            return;
        }
        let bytes = if light { ON_LIGHT } else { ON_DARK };
        let result = Image::from_bytes(bytes).and_then(|icon| window.set_icon(icon));
        if let Err(err) = result {
            // Al prossimo evento si riprova invece di restare sull'icona sbagliata.
            APPLIED.store(0, Ordering::Relaxed);
            eprintln!("[WindowIcon] set_icon: {err}");
        }
    }
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Allinea l'icona della finestra principale al colore attuale della taskbar.
/// Fuori da Windows non fa nulla: su macOS l'icona del Dock e' il riquadro.
#[cfg(target_os = "windows")]
pub fn sync<R: tauri::Runtime>(window: &tauri::Window<R>) {
    imp::sync(window);
}

#[cfg(not(target_os = "windows"))]
pub fn sync<R: tauri::Runtime>(_window: &tauri::Window<R>) {}
