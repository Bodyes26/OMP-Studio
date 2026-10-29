//! Gestione della presenza desktop nativa: area di notifica (system tray su Windows,
//! menu bar su macOS), criteri di chiusura, prevenzione uscite accidentali con lavori
//! attivi e avvio automatico opzionale al login.
//!
//! Requisiti implementati:
//! - AUT-054: Prima chiusura propone uscita o permanenza nell'area di notifica con preferenza memorizzabile.
//!   Minimizzazione distinta; Esci termina effettivamente.
//! - AUT-055: Da nascosto continuano tutti i lavori in background e automazioni con le medesime garanzie.
//!   Nessun furto di focus e nessuna chiusura o alterazione della finestra Companion.
//! - AUT-056: Autostart al login opzionale (disattivato di default), avviabile visibile o nascosto nel tray.
//!   Nessun servizio pre-login, nessuno script PowerShell, persistenza nello store locale.
//! - AUT-057: Menu essenziale: Stato, Apri Studio, Automazioni, Attenzione (se richiesta), Esci.
//! - AUT-058: macOS nascosto solo in menu bar (policy Accessory senza icona Dock); al ripristino torna Regular (Dock e focus).
//! - AUT-084: Fallback sicuro se l'area di notifica fallisce o non e' supportata (es. Linux): divieto di
//!   nascondimento che lascerebbe l'app orfana. Ricreazione tray su Windows in caso di riavvio di Explorer.
//! - Intercettazione nativa di `CloseRequested` ed `ExitRequested` prima di qualsiasi cleanup; cancellazione dell'uscita
//!   non interrompe ne' killa alcun processo; uscita confermata esegue teardown ordinato.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
/// Preferenze salvate su disco in app_local_data_dir/desktop-presence.json.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPresenceSettings {
    /// Azione alla chiusura della finestra principale: "ask" | "hide" | "quit"
    pub close_action: String,
    /// Se `true`, non chiede piu' e applica direttamente `close_action`
    pub remember_close_action: bool,
    /// Se l'avvio automatico al login e' abilitato
    pub autostart_enabled: bool,
    /// Se abilitato, se avviare Studio direttamente nascosto nella tray
    pub autostart_start_hidden: bool,
}

impl Default for DesktopPresenceSettings {
    fn default() -> Self {
        Self {
            close_action: "ask".to_string(),
            remember_close_action: false,
            autostart_enabled: false,
            autostart_start_hidden: true,
        }
    }
}

/// Stato complessivo della presenza desktop esposto al frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPresenceState {
    pub tray_available: bool,
    pub close_action: String,
    pub remember_close_action: bool,
    pub autostart_enabled: bool,
    pub autostart_start_hidden: bool,
    pub active_automations_count: usize,
    pub active_interactive_count: usize,
    pub attention: bool,
    pub platform: String,
    pub main_window_visible: bool,
}

/// Riepilogo dei lavori attivi per i dialoghi di conferma uscita.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveJobsSummary {
    pub total_jobs: usize,
    pub automation_jobs: usize,
    pub interactive_jobs: usize,
}

/// Esito della richiesta di chiusura della finestra.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequestOutcome {
    /// "hidden" | "ask" | "confirm_exit" | "quit"
    pub action: String,
    pub total_jobs: usize,
    pub automation_jobs: usize,
    pub interactive_jobs: usize,
}

/// Esito della richiesta di uscita dall'applicazione.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitRequestOutcome {
    pub requires_confirmation: bool,
    pub total_jobs: usize,
    pub automation_jobs: usize,
    pub interactive_jobs: usize,
}

struct InnerPresenceState {
    settings: DesktopPresenceSettings,
    settings_file: Option<PathBuf>,
    tray_available: bool,
    attention: bool,
    locale: String,
    main_window_visible: bool,
    tray_handle: Option<TrayIcon>,
}

static STATE: Mutex<Option<InnerPresenceState>> = Mutex::new(None);
static EXIT_CONFIRMED: AtomicBool = AtomicBool::new(false);
static EXIT_CONFIRMED_EXPIRES_AT_MS: AtomicU64 = AtomicU64::new(0);
static EXIT_PENDING: AtomicBool = AtomicBool::new(false);

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_exit_confirmed() -> bool {
    if !EXIT_CONFIRMED.load(Ordering::SeqCst) {
        return false;
    }
    let expires = EXIT_CONFIRMED_EXPIRES_AT_MS.load(Ordering::SeqCst);
    if expires == 0 {
        return true;
    }
    if now_epoch_ms() > expires {
        // Permesso scaduto (TTL superato senza che l'uscita o il restart abbiano avuto luogo)
        EXIT_CONFIRMED.store(false, Ordering::SeqCst);
        EXIT_CONFIRMED_EXPIRES_AT_MS.store(0, Ordering::SeqCst);
        false
    } else {
        true
    }
}
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn get_active_counts() -> (usize, usize) {
    let auto = crate::automations::active_count();
    let interactive = crate::automations::interactive_active_count();
    (auto, interactive)
}

fn load_settings(path: &std::path::Path) -> DesktopPresenceSettings {
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(path) {
            if let Ok(s) = serde_json::from_str::<DesktopPresenceSettings>(&raw) {
                return s;
            }
        }
    }
    DesktopPresenceSettings::default()
}

fn save_settings(path: &std::path::Path, settings: &DesktopPresenceSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Serializzazione impostazioni presenza fallita: {e}"))?;
    crate::fs_atomic::atomic_write(path, json.as_bytes())
}

// =========================================================================
// Autostart tramite tauri-plugin-autostart (ManagerExt)
// =========================================================================

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|e| format!("Abilitazione autostart fallita: {e}"))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| format!("Disabilitazione autostart fallita: {e}"))?;
    }
    Ok(())
}

// =========================================================================
// Creazione e Aggiornamento Menu / Tray
// =========================================================================

fn build_tray_menu(app: &AppHandle, attention: bool, locale: &str) -> Result<Menu<tauri::Wry>, String> {
    let (auto_count, interactive_count) = get_active_counts();
    let is_it = locale.starts_with("it");

    let status_label = if is_it {
        if attention {
            "Studio — Attenzione richiesta".to_string()
        } else if auto_count > 0 || interactive_count > 0 {
            format!("Studio — {auto_count} automazioni, {interactive_count} chat attive")
        } else {
            "Studio — In ascolto".to_string()
        }
    } else {
        if attention {
            "Studio — Attention required".to_string()
        } else if auto_count > 0 || interactive_count > 0 {
            format!("Studio — {auto_count} automations, {interactive_count} chats active")
        } else {
            "Studio — Listening".to_string()
        }
    };

    let open_label = if is_it { "Apri Studio" } else { "Open Studio" };
    let automations_label = if is_it { "Automazioni" } else { "Automations" };
    let attention_label = if is_it { "Vedi notifiche" } else { "View notifications" };
    let quit_label = if is_it { "Esci da Studio" } else { "Exit Studio" };

    let status_item = MenuItem::with_id(
        app,
        "tray_status",
        status_label,
        false,
        None::<&str>,
    )
    .map_err(|e| format!("Creazione voce stato tray fallita: {e}"))?;

    let open_item = MenuItem::with_id(
        app,
        "tray_open",
        open_label,
        true,
        None::<&str>,
    )
    .map_err(|e| format!("Creazione voce apri tray fallita: {e}"))?;

    let automations_item = MenuItem::with_id(
        app,
        "tray_automations",
        automations_label,
        true,
        None::<&str>,
    )
    .map_err(|e| format!("Creazione voce automazioni tray fallita: {e}"))?;

    let attention_item = MenuItem::with_id(
        app,
        "tray_attention",
        attention_label,
        attention,
        None::<&str>,
    )
    .map_err(|e| format!("Creazione voce attenzione tray fallita: {e}"))?;

    let quit_item = MenuItem::with_id(
        app,
        "tray_quit",
        quit_label,
        true,
        None::<&str>,
    )
    .map_err(|e| format!("Creazione voce esci tray fallita: {e}"))?;
    let sep1 = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Creazione separatore fallita: {e}"))?;
    let sep2 = PredefinedMenuItem::separator(app)
        .map_err(|e| format!("Creazione separatore fallita: {e}"))?;

    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &open_item,
            &automations_item,
            &attention_item,
            &sep2,
            &quit_item,
        ],
    )
    .map_err(|e| format!("Costruzione menu tray fallita: {e}"))?;

    Ok(menu)
}

fn create_tray(app: &AppHandle) -> Result<TrayIcon, String> {
    let menu = build_tray_menu(app, false, "it")?;
    let icon = Image::from_bytes(TRAY_ICON_BYTES)
        .map_err(|e| format!("Caricamento icona tray fallito: {e}"))?;
    let app_handle_click = app.clone();
    let app_handle_menu = app.clone();

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("OMP Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(&app_handle_click);
            }
        })
        .on_menu_event(move |_app, event| match event.id.as_ref() {
            "tray_open" => {
                let _ = show_main_window(&app_handle_menu);
            }
            "tray_automations" => {
                let _ = open_automations_view(&app_handle_menu);
            }
            "tray_attention" => {
                let _ = show_main_window(&app_handle_menu);
            }
            "tray_quit" => {
                let _ = handle_tray_quit(&app_handle_menu);
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| format!("Inizializzazione tray icon fallita: {e}"))?;

    Ok(tray)
}

fn update_tray_menu_state(app: &AppHandle) {
    let mut lock = STATE.lock();
    if let Some(state) = &mut *lock {
        if let Some(tray) = &state.tray_handle {
            if let Ok(new_menu) = build_tray_menu(app, state.attention, &state.locale) {
                let _ = tray.set_menu(Some(new_menu));
            }
            let (auto_count, _) = get_active_counts();
            let is_it = state.locale.starts_with("it");
            let tip = if state.attention {
                if is_it {
                    "OMP Studio — Attenzione richiesta".to_string()
                } else {
                    "OMP Studio — Attention required".to_string()
                }
            } else if auto_count > 0 {
                if is_it {
                    format!("OMP Studio — {auto_count} automazioni in corso")
                } else {
                    format!("OMP Studio — {auto_count} automations in progress")
                }
            } else {
                "OMP Studio".to_string()
            };
            let _ = tray.set_tooltip(Some(tip));
        }
    }
}

// =========================================================================
// API Pubbliche del Modulo (Init, Hook Window Event, Hook Run Event)
// =========================================================================

/// Inizializza il modulo di presenza desktop, caricando le preferenze e istanziando
/// la tray icon su Windows e macOS. Su Linux o in caso di errore, garantisce fallback
/// trasparente senza lasciare la finestra nascosta orfana (AUT-084).
pub fn init(app: &AppHandle) -> Result<(), String> {
    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Risoluzione app_local_data_dir fallita: {e}"))?;
    let settings_file = local_data.join("desktop-presence.json");
    let settings = load_settings(&settings_file);

    let (tray_handle, tray_available) = if cfg!(target_os = "windows") || cfg!(target_os = "macos") {
        match create_tray(app) {
            Ok(tray) => (Some(tray), true),
            Err(err) => {
                crate::studio_log::warn(
                    "desktop_presence",
                    format!("Inizializzazione tray non riuscita ({err}): fallback a finestra standard"),
                );
                (None, false)
            }
        }
    } else {
        // Su Linux gestione ordinaria (AUT-084)
        (None, false)
    };

    let start_hidden = std::env::args().any(|arg| arg == "--hidden" || arg == "--minimized");
    let initial_visible = if start_hidden && tray_available {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
        }
        false
    } else {
        true
    };

    let inner = InnerPresenceState {
        settings,
        settings_file: Some(settings_file),
        tray_available,
        attention: false,
        locale: "it".to_string(),
        main_window_visible: initial_visible,
        tray_handle,
    };
    *STATE.lock() = Some(inner);

    Ok(())
}

/// Intercettatore di eventi della finestra principale.
/// Restituisce `true` se l'evento e' stato gestito e non deve procedere con la distruzione.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) -> bool {
    if window.label() != "main" {
        return false;
    }

    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // Se l'uscita complessiva e' gia' stata confermata dall'utente, lasciamo procedere
            if is_exit_confirmed() {
                return false;
            }
            // Altrimenti intercettiamo sempre la chiusura nativa (X, Alt+F4, ecc.)
            api.prevent_close();

            // Verifichiamo la preferenza memorizzata
            let (close_action, remember, tray_available) = {
                let lock = STATE.lock();
                if let Some(st) = &*lock {
                    (
                        st.settings.close_action.clone(),
                        st.settings.remember_close_action,
                        st.tray_available,
                    )
                } else {
                    ("ask".to_string(), false, false)
                }
            };

            // Se l'utente ha scelto "hide" e la tray e' attiva, nascondiamo direttamente
            if remember && close_action == "hide" && tray_available {
                let _ = hide_main_window(window.app_handle());
                return true;
            }

            // Se l'utente ha scelto "quit", emettiamo sempre exit-requested affinche' il frontend
            // esegua prima il callback di salvataggio (setBeforeExit) e solo poi confermi l'uscita
            if remember && close_action == "quit" {
                let (auto, interactive) = get_active_counts();
                let total = auto + interactive;
                EXIT_PENDING.store(true, Ordering::SeqCst);
                let _ = window.emit(
                    "desktop-presence://exit-requested",
                    serde_json::json!({
                        "totalJobs": total,
                        "automationJobs": auto,
                        "interactiveJobs": interactive,
                    }),
                );
                return true;
            }

            // Caso "ask" o prima chiusura: emettiamo l'evento verso la webview per aprire il dialogo
            let (auto, interactive) = get_active_counts();
            let _ = window.emit(
                "desktop-presence://close-requested",
                serde_json::json!({
                    "trayAvailable": tray_available,
                    "totalJobs": auto + interactive,
                    "automationJobs": auto,
                    "interactiveJobs": interactive,
                }),
            );

            true
        }
        WindowEvent::Destroyed => {
            if let Some(st) = &mut *STATE.lock() {
                st.main_window_visible = false;
            }
            false
        }
        _ => false,
    }
}

/// Intercettatore dell'evento di uscita applicativa globale (Cmd+Q, OS shutdown, app.exit).
/// Restituisce `true` se l'uscita viene intercettata/sospesa per chiedere conferma.
pub fn on_run_event(app: &AppHandle, event: &RunEvent) -> bool {
    match event {
        RunEvent::ExitRequested { api, .. } => {
            if is_exit_confirmed() {
                // Uscita gia' approvata: lasciamo eseguire il cleanup del genitore
                return false;
            }

            // Intercettiamo sempre prima di qualunque teardown affinche' il frontend
            // esegua prima il callback di salvataggio (setBeforeExit) e poi confermi
            api.prevent_exit();
            EXIT_PENDING.store(true, Ordering::SeqCst);
            let _ = show_main_window(app);
            let (auto, interactive) = get_active_counts();
            let total = auto + interactive;
            let _ = app.emit(
                "desktop-presence://exit-requested",
                serde_json::json!({
                    "totalJobs": total,
                    "automationJobs": auto,
                    "interactiveJobs": interactive,
                }),
            );
            true
        }
        _ => false,
    }
}

// =========================================================================
// Operazioni Finestra e Tray
// =========================================================================

pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Finestra main non trovata".to_string())?;

    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    if let Some(st) = &mut *STATE.lock() {
        st.main_window_visible = true;
    }

    let _ = app.emit("desktop-presence://window-shown", ());
    Ok(())
}

pub fn hide_main_window(app: &AppHandle) -> Result<(), String> {
    let tray_ok = {
        let lock = STATE.lock();
        lock.as_ref().map(|s| s.tray_available).unwrap_or(false)
    };

    if !tray_ok {
        return Err("Impossibile nascondere: area di notifica non disponibile (AUT-084)".to_string());
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Finestra main non trovata".to_string())?;

    let _ = window.hide();

    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    if let Some(st) = &mut *STATE.lock() {
        st.main_window_visible = false;
    }

    let _ = app.emit("desktop-presence://window-hidden", ());
    Ok(())
}

pub fn open_automations_view(app: &AppHandle) -> Result<(), String> {
    show_main_window(app)?;
    let _ = app.emit("desktop-presence://navigate-automations", ());
    Ok(())
}

fn handle_tray_quit(app: &AppHandle) -> Result<(), String> {
    let _ = show_main_window(app);
    let (auto, interactive) = get_active_counts();
    let total = auto + interactive;
    EXIT_PENDING.store(true, Ordering::SeqCst);
    let _ = app.emit(
        "desktop-presence://exit-requested",
        serde_json::json!({
            "totalJobs": total,
            "automationJobs": auto,
            "interactiveJobs": interactive,
        }),
    );
    Ok(())
}

// =========================================================================
// Comandi Tauri IPC (chiamabili dal frontend)
// =========================================================================

#[tauri::command]
pub fn desktop_presence_get_state(app: AppHandle) -> Result<DesktopPresenceState, String> {
    let lock = STATE.lock();
    let state = lock
        .as_ref()
        .ok_or_else(|| "Modulo desktop_presence non inizializzato".to_string())?;

    let (auto, interactive) = get_active_counts();

    Ok(DesktopPresenceState {
        tray_available: state.tray_available,
        close_action: state.settings.close_action.clone(),
        remember_close_action: state.settings.remember_close_action,
        autostart_enabled: state.settings.autostart_enabled,
        autostart_start_hidden: state.settings.autostart_start_hidden,
        active_automations_count: auto,
        active_interactive_count: interactive,
        attention: state.attention,
        platform: current_platform().to_string(),
        main_window_visible: state.main_window_visible,
    })
}

#[tauri::command]
pub fn desktop_presence_update_settings(
    app: AppHandle,
    settings: DesktopPresenceSettings,
) -> Result<DesktopPresenceState, String> {
    let path_opt = {
        let mut lock = STATE.lock();
        let state = lock
            .as_mut()
            .ok_or_else(|| "Modulo desktop_presence non inizializzato".to_string())?;

        // Applichiamo l'eventuale variazione di autostart tramite plugin
        if settings.autostart_enabled != state.settings.autostart_enabled {
            apply_autostart(&app, settings.autostart_enabled)?;
        }

        state.settings = settings;
        state.settings_file.clone()
    };

    if let Some(path) = path_opt {
        let lock = STATE.lock();
        if let Some(st) = &*lock {
            save_settings(&path, &st.settings)?;
        }
    }

    update_tray_menu_state(&app);
    desktop_presence_get_state(app)
}

#[tauri::command]
pub fn desktop_presence_request_close(app: AppHandle) -> Result<CloseRequestOutcome, String> {
    let (close_action, remember, tray_available) = {
        let lock = STATE.lock();
        let state = lock
            .as_ref()
            .ok_or_else(|| "Modulo desktop_presence non inizializzato".to_string())?;
        (
            state.settings.close_action.clone(),
            state.settings.remember_close_action,
            state.tray_available,
        )
    };

    let (auto, interactive) = get_active_counts();
    let total = auto + interactive;

    if remember && close_action == "hide" && tray_available {
        hide_main_window(&app)?;
        return Ok(CloseRequestOutcome {
            action: "hidden".to_string(),
            total_jobs: total,
            automation_jobs: auto,
            interactive_jobs: interactive,
        });
    }

    if remember && close_action == "quit" {
        if total > 0 {
            EXIT_PENDING.store(true, Ordering::SeqCst);
            return Ok(CloseRequestOutcome {
                action: "confirm_exit".to_string(),
                total_jobs: total,
                automation_jobs: auto,
                interactive_jobs: interactive,
            });
        } else {
            return Ok(CloseRequestOutcome {
                action: "quit".to_string(),
                total_jobs: 0,
                automation_jobs: 0,
                interactive_jobs: 0,
            });
        }
    }

    Ok(CloseRequestOutcome {
        action: "ask".to_string(),
        total_jobs: total,
        automation_jobs: auto,
        interactive_jobs: interactive,
    })
}

#[tauri::command]
pub fn desktop_presence_respond_close(
    app: AppHandle,
    action: String,
    remember: bool,
) -> Result<(), String> {
    match action.as_str() {
        "hide" => {
            if remember {
                let mut current = {
                    let lock = STATE.lock();
                    lock.as_ref()
                        .map(|s| s.settings.clone())
                        .unwrap_or_default()
                };
                current.close_action = "hide".to_string();
                current.remember_close_action = true;
                let _ = desktop_presence_update_settings(app.clone(), current);
            }
            hide_main_window(&app)?;
        }
        "quit" => {
            if remember {
                let mut current = {
                    let lock = STATE.lock();
                    lock.as_ref()
                        .map(|s| s.settings.clone())
                        .unwrap_or_default()
                };
                current.close_action = "quit".to_string();
                current.remember_close_action = true;
                let _ = desktop_presence_update_settings(app.clone(), current);
            }
            let (auto, interactive) = get_active_counts();
            let total = auto + interactive;
            EXIT_PENDING.store(true, Ordering::SeqCst);
            let _ = app.emit(
                "desktop-presence://exit-requested",
                serde_json::json!({
                    "totalJobs": total,
                    "automationJobs": auto,
                    "interactiveJobs": interactive,
                }),
            );
        }
        "cancel" => {
            // L'utente ha annullato la finestra di dialogo: non fare nulla
        }
        _ => return Err(format!("Azione non valida: {action}")),
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_presence_request_exit(app: AppHandle) -> Result<ExitRequestOutcome, String> {
    let (auto, interactive) = get_active_counts();
    let total = auto + interactive;
    let requires_confirmation = total > 0;
    if requires_confirmation {
        EXIT_PENDING.store(true, Ordering::SeqCst);
        let _ = app.emit(
            "desktop-presence://exit-requested",
            serde_json::json!({
                "totalJobs": total,
                "automationJobs": auto,
                "interactiveJobs": interactive,
            }),
        );
    }
    Ok(ExitRequestOutcome {
        requires_confirmation,
        total_jobs: total,
        automation_jobs: auto,
        interactive_jobs: interactive,
    })
}

/// Prepara l'uscita (es. prima di install_studio_update_and_restart o run_omp_update):
/// se non ci sono lavori in corso, autorizza direttamente la successiva uscita senza
/// forzare l'arresto immediato del processo; se ci sono lavori, richiede conferma.
#[tauri::command]
pub fn desktop_presence_prepare_exit(app: AppHandle) -> Result<ExitRequestOutcome, String> {
    let (auto, interactive) = get_active_counts();
    let total = auto + interactive;
    let requires_confirmation = total > 0;
    if requires_confirmation {
        EXIT_PENDING.store(true, Ordering::SeqCst);
        let _ = app.emit(
            "desktop-presence://exit-requested",
            serde_json::json!({
                "totalJobs": total,
                "automationJobs": auto,
                "interactiveJobs": interactive,
            }),
        );
    } else {
        // Nessun lavoro: pre-autorizziamo l'uscita con TTL di 60 secondi affinche' installer/updater
        // possa procedere senza essere bloccato da on_run_event
        EXIT_CONFIRMED.store(true, Ordering::SeqCst);
        EXIT_CONFIRMED_EXPIRES_AT_MS.store(now_epoch_ms() + 60_000, Ordering::SeqCst);
        EXIT_PENDING.store(false, Ordering::SeqCst);
    }
    Ok(ExitRequestOutcome {
        requires_confirmation,
        total_jobs: total,
        automation_jobs: auto,
        interactive_jobs: interactive,
    })
}

/// Autorizza o annulla l'uscita successiva senza chiamare app.exit(0):
/// se allow e' true, marca EXIT_CONFIRMED affinche' il chiamante (updater/parent)
/// possa eseguire il teardown ed invocare il restart nativo; se false, resetta i flag
/// e nessun processo viene terminato.
#[tauri::command]
pub fn desktop_presence_authorize_exit(_app: AppHandle, allow: bool) -> Result<(), String> {
    if allow {
        EXIT_CONFIRMED.store(true, Ordering::SeqCst);
        EXIT_CONFIRMED_EXPIRES_AT_MS.store(now_epoch_ms() + 60_000, Ordering::SeqCst);
        EXIT_PENDING.store(false, Ordering::SeqCst);
    } else {
        EXIT_CONFIRMED.store(false, Ordering::SeqCst);
        EXIT_CONFIRMED_EXPIRES_AT_MS.store(0, Ordering::SeqCst);
        EXIT_PENDING.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_presence_respond_exit(app: AppHandle, confirm: bool) -> Result<(), String> {
    if confirm {
        EXIT_CONFIRMED.store(true, Ordering::SeqCst);
        EXIT_PENDING.store(false, Ordering::SeqCst);
        app.exit(0);
    } else {
        // Annullamento dell'uscita: nessun processo viene toccato o killato (AUT-045, AUT-054)
        EXIT_PENDING.store(false, Ordering::SeqCst);
        EXIT_CONFIRMED.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_presence_show_main(app: AppHandle) -> Result<(), String> {
    show_main_window(&app)
}

#[tauri::command]
pub fn desktop_presence_hide_main(app: AppHandle) -> Result<(), String> {
    hide_main_window(&app)
}

#[tauri::command]
pub fn desktop_presence_open_automations(app: AppHandle) -> Result<(), String> {
    open_automations_view(&app)
}

#[tauri::command]
pub fn desktop_presence_set_attention(app: AppHandle, attention: bool) -> Result<(), String> {
    {
        let mut lock = STATE.lock();
        if let Some(st) = &mut *lock {
            st.attention = attention;
        }
    }
    update_tray_menu_state(&app);
    let _ = app.emit(
        "desktop-presence://attention-changed",
        serde_json::json!({ "attention": attention }),
    );
    Ok(())
}

#[tauri::command]
pub fn desktop_presence_get_active_jobs(app: AppHandle) -> Result<ActiveJobsSummary, String> {
    let (auto, interactive) = get_active_counts();
    Ok(ActiveJobsSummary {
        total_jobs: auto + interactive,
        automation_jobs: auto,
        interactive_jobs: interactive,
    })
}

#[tauri::command]
pub fn desktop_presence_set_locale(app: AppHandle, locale: String) -> Result<(), String> {
    {
        let mut lock = STATE.lock();
        if let Some(st) = &mut *lock {
            st.locale = locale;
        }
    }
    update_tray_menu_state(&app);
    Ok(())
}
