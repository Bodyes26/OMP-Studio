//! Finestra dell'installer e comandi chiamati dalla UI (ui/app.js).

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

use serde::Serialize;
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use crate::{payload, system};

/// Durante l'installazione la finestra non si chiude: NSIS resterebbe a meta' senza nessuno che lo aspetti.
static INSTALLING: AtomicBool = AtomicBool::new(false);

struct InstallingGuard;

impl InstallingGuard {
    fn new() -> Self {
        INSTALLING.store(true, AtomicOrdering::SeqCst);
        Self
    }
}

impl Drop for InstallingGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, AtomicOrdering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    version: String,
    lang: &'static str,
    installed_version: Option<String>,
    /// Rispetto alla versione dell'installer: "older", "same", "newer" o "unknown".
    installed_relation: Option<&'static str>,
    install_dir: String,
    /// Con Studio gia' installato la cartella resta quella: con `/D=` NSIS installerebbe altrove.
    dir_locked: bool,
    running: bool,
    payload: bool,
    mica: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
enum InstallFailure {
    Running,
    Payload,
    Folder,
    Spawn(String),
    Exit(Option<i32>),
    NotRegistered,
}

fn relation(installed: &str, current: &semver::Version) -> &'static str {
    match semver::Version::parse(installed.trim()) {
        Ok(installed) => match installed.cmp(current) {
            Ordering::Less => "older",
            Ordering::Equal => "same",
            Ordering::Greater => "newer",
        },
        Err(_) => "unknown",
    }
}

#[tauri::command]
fn snapshot(app: AppHandle) -> Snapshot {
    let current = &app.package_info().version;
    let installed = system::installed();
    Snapshot {
        version: current.to_string(),
        lang: system::ui_lang(),
        installed_relation: installed.as_ref().map(|i| relation(&i.version, current)),
        installed_version: installed.as_ref().map(|i| i.version.clone()),
        install_dir: installed
            .as_ref()
            .map(|i| i.dir.clone())
            .unwrap_or_else(system::default_install_dir)
            .display()
            .to_string(),
        dir_locked: installed.is_some(),
        running: system::studio_running(),
        payload: payload::available(),
        mica: system::supports_mica(),
    }
}

#[tauri::command]
fn show_window(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn studio_running() -> bool {
    tauri::async_runtime::spawn_blocking(system::studio_running).await.unwrap_or(true)
}

#[tauri::command]
async fn close_studio() -> bool {
    tauri::async_runtime::spawn_blocking(system::terminate_studio).await.unwrap_or(false)
}

/// Come la pagina cartella di NSIS: la cartella scelta riceve la sottocartella del prodotto.
fn with_product_folder(path: PathBuf) -> PathBuf {
    let named = path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(system::PRODUCT_NAME));
    if named {
        path
    } else {
        path.join(system::PRODUCT_NAME)
    }
}

#[tauri::command]
async fn pick_folder(window: WebviewWindow, current: String) -> Option<String> {
    let start = Path::new(&current).ancestors().find(|p| p.is_dir()).map(Path::to_path_buf);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = window.dialog().file().set_parent(&window);
        if let Some(start) = start {
            dialog = dialog.set_directory(start);
        }
        dialog.blocking_pick_folder()
    })
    .await
    .ok()
    .flatten()?;
    picked.into_path().ok().map(|p| with_product_folder(p).display().to_string())
}

fn valid_dir(dir: &str) -> bool {
    let trimmed = dir.trim();
    !trimmed.is_empty() && !trimmed.contains('"') && Path::new(trimmed).is_absolute()
}

fn install_blocking(dir: String, desktop: bool) -> Result<String, InstallFailure> {
    if system::studio_running() {
        return Err(InstallFailure::Running);
    }
    let fresh = system::installed().is_none();
    if fresh && !valid_dir(&dir) {
        return Err(InstallFailure::Folder);
    }
    let _guard = InstallingGuard::new();
    let setup = payload::ExtractedSetup::new().map_err(|_| InstallFailure::Payload)?;
    let mut command = Command::new(&setup.exe);
    command.arg("/S");
    if fresh {
        use std::os::windows::process::CommandExt;
        // NSIS vuole /D= per ultimo e senza virgolette, anche con spazi nel percorso.
        command.raw_arg(format!("/D={}", dir.trim()));
    }
    let status = command.status().map_err(|e| InstallFailure::Spawn(e.to_string()))?;
    if status.code() != Some(0) {
        return Err(InstallFailure::Exit(status.code()));
    }
    if !desktop {
        system::remove_desktop_shortcut();
    }
    system::installed()
        .map(|i| i.dir.display().to_string())
        .ok_or(InstallFailure::NotRegistered)
}

#[tauri::command]
async fn install(dir: String, desktop: bool) -> Result<String, InstallFailure> {
    tauri::async_runtime::spawn_blocking(move || install_blocking(dir, desktop))
        .await
        .map_err(|e| InstallFailure::Spawn(e.to_string()))?
}

#[tauri::command]
fn launch_studio(app: AppHandle) -> Result<(), String> {
    let installed = system::installed().ok_or("OMP Studio non risulta installato")?;
    Command::new(installed.dir.join(&installed.binary))
        .current_dir(&installed.dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Ripiego: la procedura NSIS classica, con le sue pagine. L'installer grafico si
/// nasconde e ne aspetta la fine per cancellare il setup estratto.
#[tauri::command]
async fn run_classic(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let setup = payload::ExtractedSetup::new().map_err(|e| e.to_string())?;
    let _ = window.hide();
    let code = tauri::async_runtime::spawn_blocking(move || {
        let code = Command::new(&setup.exe).status().ok().and_then(|s| s.code()).unwrap_or(1);
        drop(setup);
        code
    })
    .await
    .unwrap_or(1);
    app.exit(code);
    Ok(())
}

pub fn run() {
    // Dati del webview in una cartella temporanea: l'installer non lascia tracce in AppData.
    let webview_data = std::env::temp_dir().join(format!("omp-studio-setup-webview-{}", std::process::id()));
    let data_for_window = webview_data.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            show_window,
            studio_running,
            close_studio,
            pick_folder,
            install,
            launch_studio,
            run_classic,
            quit
        ])
        .setup(move |app| {
            let title = if system::ui_lang() == "it" { "Installazione di OMP Studio" } else { "OMP Studio Setup" };
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(900.0, 540.0)
                .resizable(false)
                .maximizable(false)
                .center()
                // La UI chiama show_window dopo il primo disegno: niente lampo bianco.
                .visible(false)
                .data_directory(data_for_window.clone());
            if system::supports_mica() {
                builder = builder.transparent(true).effects(WindowEffectsConfig {
                    effects: vec![Effect::Mica],
                    state: None,
                    radius: None,
                    color: None,
                });
            }
            builder.build()?;
            Ok(())
        })
        .on_window_event(|_, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if INSTALLING.load(AtomicOrdering::SeqCst) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("avvio dell'installer grafico fallito");
    app.run(move |handle, event| {
        if let RunEvent::Exit = event {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.destroy();
            }
            let _ = std::fs::remove_dir_all(&webview_data);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_cartella_scelta_riceve_la_sottocartella_del_prodotto() {
        assert_eq!(with_product_folder(PathBuf::from(r"D:\Apps")), PathBuf::from(r"D:\Apps\OMP Studio"));
        assert_eq!(
            with_product_folder(PathBuf::from(r"D:\Apps\omp studio")),
            PathBuf::from(r"D:\Apps\omp studio")
        );
    }

    #[test]
    fn la_versione_installata_si_confronta_in_semver() {
        let current = semver::Version::parse("1.10.0").unwrap();
        assert_eq!(relation("1.9.2", &current), "older");
        assert_eq!(relation("1.10.0", &current), "same");
        assert_eq!(relation("1.10.1-nightly.1794315686181", &current), "newer");
        assert_eq!(relation("non-una-versione", &current), "unknown");
    }

    #[test]
    fn la_cartella_deve_essere_assoluta_e_senza_virgolette() {
        assert!(valid_dir(r"C:\Users\me\AppData\Local\OMP Studio"));
        assert!(!valid_dir(r"OMP Studio"));
        assert!(!valid_dir(r#"C:\a"b"#));
        assert!(!valid_dir("  "));
    }
}
