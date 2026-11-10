//! Installer grafico Windows di OMP Studio (docs/requisiti/installer-windows.md).
//!
//! Contiene il setup NSIS generato da Tauri e ne cambia solo l'aspetto: installazione,
//! associazioni dei file, WebView2, aggiornamenti e disinstallazione restano di NSIS.
//! Con argomenti sulla riga di comando (es. `/S` dell'updater di Studio e di
//! `install-windows.cmd`) si comporta come il setup NSIS e non apre finestre.

#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod payload;
#[cfg(windows)]
mod system;

/// Firma dell'installer grafico dentro l'eseguibile: scripts/build-windows-installer.mjs
/// la cerca per non incorporare un installer grafico dentro un altro.
static MARKER: &str = "OMP-STUDIO-GRAPHICAL-SETUP";

#[cfg(windows)]
fn main() {
    std::hint::black_box(MARKER);
    let tail = system::command_line_tail();
    // Senza WebView2 la finestra non puo' aprirsi: il setup NSIS classico lo installa.
    if !tail.trim().is_empty() || !system::webview2_present() {
        std::process::exit(passthrough(&tail));
    }
    app::run();
}

/// Esegue il setup NSIS con la stessa riga di comando e ne restituisce il codice d'uscita.
#[cfg(windows)]
fn passthrough(tail: &str) -> i32 {
    use std::os::windows::process::CommandExt;
    let Ok(setup) = payload::ExtractedSetup::new() else {
        return 2;
    };
    match std::process::Command::new(&setup.exe).raw_arg(tail).status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(_) => 2,
    }
}

#[cfg(not(windows))]
fn main() {
    std::hint::black_box(MARKER);
    eprintln!("L'installer grafico di OMP Studio esiste solo per Windows.");
    std::process::exit(1);
}
