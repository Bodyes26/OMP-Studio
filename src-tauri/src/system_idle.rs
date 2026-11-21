//! Da quanti secondi l'utente non tocca tastiera e mouse su questa macchina
//! (R-MI-31). Le macchine collegate lo chiedono a vicenda per decidere chi
//! notifica: e' una durata misurata sul posto, quindi resta confrontabile anche
//! con gli orologi delle due macchine sfasati, a differenza di un orario.

/// Secondi di inattivita' dell'utente; `None` dove il sistema non lo dice.
#[tauri::command]
pub fn system_idle_seconds() -> Option<u64> {
    idle_seconds()
}

#[cfg(target_os = "macos")]
fn idle_seconds() -> Option<u64> {
    // Stato combinato della sessione e qualunque tipo di evento: e' il valore
    // che usa anche il sistema per lo screensaver.
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT_TYPE: u32 = u32::MAX;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    // SAFETY: funzione di CoreGraphics senza puntatori, utilizzabile da
    // qualunque thread; restituisce un numero di secondi.
    let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT_TYPE) };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds as u64)
}

#[cfg(target_os = "windows")]
fn idle_seconds() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` e' una struttura valida con `cbSize` impostato, come
    // chiede l'API; la chiamata la riempie e non conserva il puntatore.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    // Entrambi i valori sono millisecondi dall'avvio su 32 bit: la sottrazione
    // modulare resta corretta anche dopo il giro del contatore (49 giorni).
    let now = unsafe { GetTickCount() };
    Some(u64::from(now.wrapping_sub(info.dwTime)) / 1000)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn idle_seconds() -> Option<u64> {
    None
}
