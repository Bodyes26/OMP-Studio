//! Modulo operativo per la finestra secondaria Companion (S44).
//!
//! Principi guida (docs/DECISIONS.md):
//! 1. **Doppia modalita':**
//!    - *Spotlight (effimera):* richiamata via scorciatoia globale (Alt+Spazio), centrata
//!      sullo schermo attivo, scompare su Esc o sfocatura (`blur`).
//!    - *Widget (pinnata):* persistente, con posizione e dimensioni ricordate su monitor
//!      secondari (es. schermo laterale durante sessioni remote con TeamViewer).
//! 2. **Parsing in linguaggio naturale rapido e isolato:**
//!    - Esecuzione effimera `omp -p --no-session --no-tools --no-skills --no-rules` con il
//!      ruolo `smol` per mappare il testo dell'utente su progetto, ruolo, direttive e modello.
//! 3. **Resilienza alle scorciatoie di sistema:**
//!    - Registrazione tollerante di Alt+Spazio con fallback automatico su Ctrl+Alt+Spazio
//!      se il sistema operativo Windows riserva Alt+Spazio per il menu di sistema.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    command,
    webview::PageLoadEvent,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::directives_ops::{extract_json_payload, run_ephemeral_omp_raw};

/// La finestra Companion e' stata mostrata almeno una volta in questa sessione.
static COMPANION_SHOWN: AtomicBool = AtomicBool::new(false);

/// Stato di persistenza della finestra Companion (posizione, dimensioni e fissaggio).
///
/// La geometria e' in pixel fisici: e' la stessa unita' con cui la si rilegge
/// (`inner_size`) e la si riapplica (`set_size`), quindi il giro di andata e
/// ritorno non introduce conversioni.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionState {
    pub is_pinned: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl Default for CompanionState {
    fn default() -> Self {
        // Nessuna dimensione predefinita: senza geometria salvata la finestra
        // resta a quella di creazione (`tauri.conf.json`, unita' logiche).
        // Riempire questi campi con 560x520 li faceva applicare come pixel
        // fisici, cambiando la larghezza a ogni riapertura sui monitor con
        // scalatura diversa dal 100%.
        Self {
            is_pinned: false,
            x: None,
            y: None,
            width: None,
            height: None,
        }
    }
}

/// Metadati di un progetto noto per il matching del linguaggio naturale.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub label: Option<String>,
    pub path: String,
}

/// Metadati di una direttiva nota per l'attivazione automatica via NL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveSummary {
    pub id: String,
    pub name: String,
    pub tag: Option<String>,
    pub description: Option<String>,
}

/// Risultato del parsing AI del Quick Task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTaskAiParsed {
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub task_prompt: String,
    pub role: Option<String>,
    pub model_selector: Option<String>,
    pub directive_ids: Vec<String>,
    pub ambiguities: Vec<String>,
}

fn get_companion_state_file() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA").ok()
    } else {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .or_else(|| std::env::var("HOME").ok().map(|h| format!("{}/.config", h)))
    }?;

    let dir = PathBuf::from(base).join("omp-studio");

    let _ = fs::create_dir_all(&dir);
    Some(dir.join("companion-state.json"))
}

#[command]
pub fn get_companion_state() -> Result<CompanionState, String> {
    let path = match get_companion_state_file() {
        Some(p) => p,
        None => return Ok(CompanionState::default()),
    };

    if !path.exists() {
        return Ok(CompanionState::default());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Lettura stato companion fallita: {}", e))?;
    let state: CompanionState = serde_json::from_str(&raw).unwrap_or_default();
    Ok(state)
}

fn write_companion_state(state: &CompanionState) -> Result<(), String> {
    let path = get_companion_state_file()
        .ok_or_else(|| "Percorso configurazione companion non disponibile".to_string())?;
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Serializzazione stato companion fallita: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Scrittura stato companion fallita: {}", e))?;
    Ok(())
}

/// Geometria letta dalla finestra, in pixel fisici.
#[derive(Debug, Clone, Copy)]
struct CompanionGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Ultima geometria vista mentre la finestra era aperta.
///
/// All'uscita dell'applicazione la finestra puo' essere gia' distrutta e non
/// rispondere piu': senza questa copia in memoria chi ridimensiona e chiude
/// l'app perderebbe la dimensione. Si aggiorna su `Resized`/`Moved` senza
/// toccare il disco, perche' durante il trascinamento dei bordi quegli eventi
/// arrivano a ogni pixel.
static LAST_GEOMETRY: Mutex<Option<CompanionGeometry>> = Mutex::new(None);

/// Legge la geometria dalla finestra viva, se e' in uno stato significativo.
///
/// Si legge `inner_size`, non `outer_size`, perche' il ripristino usa
/// `set_size`, che dimensiona l'area interna: salvare l'esterna e riapplicarla
/// come interna allargava la finestra dello spessore dei bordi (16x9 px su
/// Windows) a ogni chiusura e riapertura.
fn read_live_geometry(window: &Window) -> Option<CompanionGeometry> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let size = window.inner_size().ok()?;
    let pos = window.outer_position().ok()?;
    if size.width == 0 || size.height == 0 {
        return None;
    }
    Some(CompanionGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

/// Aggiorna la copia in memoria della geometria. Nessuna scrittura su disco.
pub fn track_companion_geometry(window: &Window) {
    if !COMPANION_SHOWN.load(Ordering::Relaxed) {
        return;
    }
    if let Some(geometry) = read_live_geometry(window) {
        if let Ok(mut slot) = LAST_GEOMETRY.lock() {
            *slot = Some(geometry);
        }
    }
}

/// Salva la geometria della finestra conservando il flag di fissaggio.
///
/// Va invocata prima di ogni nascondimento e all'uscita: sono gli unici momenti
/// in cui la dimensione scelta dall'utente esiste ancora. La guardia su
/// `COMPANION_SHOWN` evita che una finestra creata e mai aperta sovrascriva la
/// geometria salvata con la dimensione di creazione.
pub fn persist_companion_geometry(app: &AppHandle) {
    if !COMPANION_SHOWN.load(Ordering::Relaxed) {
        return;
    }

    let live = app
        .get_webview_window("companion")
        .and_then(|window| read_live_geometry(&window.as_ref().window()));
    if let (Some(geometry), Ok(mut slot)) = (live, LAST_GEOMETRY.lock()) {
        *slot = Some(geometry);
    }

    let Some(geometry) = LAST_GEOMETRY.lock().ok().and_then(|slot| *slot) else {
        return;
    };

    let mut state = get_companion_state().unwrap_or_default();
    state.x = Some(geometry.x);
    state.y = Some(geometry.y);
    state.width = Some(geometry.width);
    state.height = Some(geometry.height);
    let _ = write_companion_state(&state);
}

/// Commuta la modalita' Spotlight/Widget senza toccare la geometria salvata.
///
/// Il comando non accetta piu' dimensioni dal frontend: la TopBar della finestra
/// principale non puo' conoscerle e le inviava vuote, azzerando la larghezza
/// memorizzata. Qui la geometria si rilegge dalla finestra vera.
#[command]
pub fn set_companion_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    persist_companion_geometry(&app);
    let mut state = get_companion_state().unwrap_or_default();
    state.is_pinned = pinned;
    write_companion_state(&state)
}

/// Crea la finestra Companion.
///
/// Non puo' essere invocata dal thread principale: la creazione di una finestra
/// dispaccia un messaggio all'event loop e attende la risposta, quindi sul main
/// thread si blocca. Va chiamata da un comando `async` o da un thread dedicato.
fn create_companion_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("/companion".into()))
        .title("OMP Studio Companion")
        .inner_size(560.0, 520.0)
        .min_inner_size(420.0, 360.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .on_page_load(|window, payload| {
            // Il primo summon arriva prima che la vista sia pronta ad ascoltare:
            // lo si ripete a fine caricamento per mettere a fuoco l'input.
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.emit("companion-summon", ());
            }
        })
        .build()
        .map_err(|e| format!("Creazione finestra companion fallita: {}", e))
}

/// Restituisce la finestra Companion, creandola alla prima richiesta.
fn companion_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    match app.get_webview_window("companion") {
        Some(window) => Ok(window),
        None => create_companion_window(app),
    }
}


fn show_companion_window(window: &WebviewWindow) -> Result<(), String> {
    // Da qui in avanti la geometria della finestra e' quella che vede l'utente:
    // solo dopo la prima apertura ha senso salvarla.
    COMPANION_SHOWN.store(true, Ordering::Relaxed);
    window
        .unminimize()
        .map_err(|e| format!("Ripristino finestra companion fallito: {}", e))?;
    window
        .show()
        .map_err(|e| format!("Apertura finestra companion fallita: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Focus finestra companion fallito: {}", e))?;
    window
        .emit("companion-summon", ())
        .map_err(|e| format!("Attivazione finestra companion fallita: {}", e))
}

/// Mostra o nasconde la finestra Companion applicando la geometria appropriata.
pub fn toggle_companion_window_internal(app: &AppHandle) -> Result<(), String> {
    let state = get_companion_state().unwrap_or_default();
    let window = companion_window(app)?;

    let is_visible = window.is_visible().unwrap_or(false);

    if is_visible {
        let is_focused = window.is_focused().unwrap_or(false);
        if is_focused && !state.is_pinned {
            // In modalita Spotlight, se la finestra e' a fuoco la scorciatoia la chiude
            persist_companion_geometry(app);
            window
                .hide()
                .map_err(|e| format!("Chiusura finestra companion fallita: {}", e))?;
            return Ok(());
        }
        // Se visibile ma non a fuoco, o pinnata, la porta in primo piano
        return show_companion_window(&window);
    }

    // Ripristina la dimensione salvata (in pixel fisici, come letta): senza
    // valori memorizzati si lascia la finestra come e' stata creata.
    if let (Some(w), Some(h)) = (state.width, state.height) {
        window
            .set_size(PhysicalSize::new(w, h))
            .map_err(|e| format!("Dimensionamento finestra companion fallito: {}", e))?;
    }

    if state.is_pinned {
        if let (Some(x), Some(y)) = (state.x, state.y) {
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|e| format!("Posizionamento finestra companion fallito: {}", e))?;
        }
    } else {
        // Spotlight mode: centra sul monitor attivo
        window
            .center()
            .map_err(|e| format!("Centratura finestra companion fallita: {}", e))?;
    }

    show_companion_window(&window)
}

#[command]
pub async fn toggle_companion_window(app: AppHandle) -> Result<(), String> {
    toggle_companion_window_internal(&app)
}

#[command]
pub fn hide_companion_window(app: AppHandle) -> Result<(), String> {
    // La dimensione va salvata mentre la finestra e' ancora quella che
    // l'utente ha ridimensionato: dopo `hide()` non c'e' altro momento utile.
    persist_companion_geometry(&app);
    if let Some(window) = app.get_webview_window("companion") {
        let _ = window.hide();
    }
    Ok(())
}

/// Inizializza la scorciatoia globale a livello di sistema operativo.
pub fn init_global_shortcut(app: &AppHandle) {
    let app_handle = app.clone();

    // Proviamo a registrare Alt+Space; se Windows lo riserva per il menu di sistema,
    // registriamo come fallback sicuro Ctrl+Alt+Space.
    let candidates = ["alt+space", "ctrl+alt+space"];
    let mut registered_shortcut: Option<Shortcut> = None;

    for candidate in candidates {
        if let Ok(shortcut) = candidate.parse::<Shortcut>() {
            let app_cb = app_handle.clone();
            let result = app
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, _sc, event| {
                    if event.state() == ShortcutState::Pressed {
                        // La prima pressione puo' dover creare la finestra: fuori
                        // dal thread dell'event loop, altrimenti si blocca.
                        let app_toggle = app_cb.clone();
                        std::thread::spawn(move || {
                            if let Err(err) = toggle_companion_window_internal(&app_toggle) {
                                eprintln!("[companion] {}", err);
                            }
                        });
                    }
                });

            if result.is_ok() {
                registered_shortcut = Some(shortcut);
                break;
            }
        }
    }

    if let Some(sc) = registered_shortcut {
        let _ = sc;
    } else {
        eprintln!(
            "[companion] Impossibile registrare la scorciatoia globale per la finestra Companion"
        );
    }
}

/// Prompt di sistema compatto per il parsing intelligente di un Quick Task.
/// Rimane statico e sotto i 2.000 caratteri: tutti gli elenchi variabili (progetti,
/// direttive, ruoli, modelli) e il testo digitato dall'utente confluiscono nel
/// file di contesto allegato, rispettando il limite Win32 di 32.767 caratteri in argv.
const QUICK_TASK_PARSER_SYSTEM_PROMPT: &str = r#"Sei un parser intelligente di task per l'orchestratore di agenti OMP Studio.
Il tuo compito è analizzare una richiesta utente in linguaggio naturale ed estrarre i parametri del task da accodare, consultando il contesto fornito nel file allegato.

REGOLE DI ESTRAZIONE RIGIDE:
1. "project_name": individua il progetto a cui si riferisce l'utente tramite corrispondenza esatta, parziale o sinonimi evidenti (es. "contratti affitto" -> "ContrattiImmobili", "tarature" -> "Cruscotto Tarature", "psr" -> "Cruscotto PSR"). Se chiaro, restituisci il nome esatto del progetto presente nella lista. Se non corrisponde a nessun progetto noto o è del tutto assente, imposta null e aggiungi una spiegazione in "ambiguities".
2. "project_path": imposta il percorso esatto 'path' del progetto associato al 'project_name' trovato. Se il progetto è nullo, imposta null.
3. "task_prompt": estrai SOLO il vero corpo/descrizione del lavoro da compiere, rimuovendo le parole accessorie utilizzate per indicare il progetto, il ruolo o le direttive (es. da "contratti affitto cambiare colore pulsante nuovo contratto per metterlo soft agente smol ponytail" estrai "cambiare colore pulsante nuovo contratto per metterlo soft"). Il prompt deve essere chiaro, conciso e pronto per l'agente.
4. "role": se l'utente nomina esplicitamente un ruolo (es. "agente smol", "ruolo default", "slow", "plan"), restituisci uno tra i ruoli disponibili. Se non è specificato, restituisci null.
5. "model_selector": se l'utente specifica un modello (es. "usa gpt 5.6 sol", "modello claude sonnet"), cerca la migliore corrispondenza nel catalogo modelli e restituisci il selettore esatto. Se non è specificato un modello, restituisci null.
6. "directive_ids": array contenente gli ID delle direttive richieste (es. se menziona "ponytail", "piano", "discussione", "ricerca online", "grill-me", ecc.). Includi solo ID validi presenti nell'elenco.
7. "ambiguities": array di stringhe. Se il testo contiene elementi poco chiari, riferimenti a progetti inesistenti o comandi contraddittori, inserisci brevi avvisi esplicativi in italiano. Se tutto è chiaro e ben determinato, lascia l'array vuoto [].

RISPONDI ESCLUSIVAMENTE con un oggetto JSON valido privo di testo introduttivo o conclusivo con questa struttura:
{
  "project_name": "NomeProgetto" | null,
  "project_path": "PercorsoProgetto" | null,
  "task_prompt": "Testo pulito del task",
  "role": "smol" | "default" | "slow" | "plan" | null,
  "model_selector": "selettore-modello" | null,
  "directive_ids": ["id_direttiva_1"],
  "ambiguities": []
}"#;

/// Parser intelligente per Quick Task in linguaggio naturale.
#[command]
pub async fn parse_quick_task_ai(
    input: String,
    projects: Vec<ProjectSummary>,
    directives: Vec<DirectiveSummary>,
    roles: Vec<String>,
    catalog_models: Vec<String>,
    model_selector: Option<String>,
) -> Result<QuickTaskAiParsed, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Il testo del task non può essere vuoto".to_string());
    }

    let projects_json = serde_json::to_string(&projects)
        .map_err(|e| format!("Serializzazione progetti fallita: {}", e))?;
    let directives_json = serde_json::to_string(&directives)
        .map_err(|e| format!("Serializzazione direttive fallita: {}", e))?;
    let roles_json = serde_json::to_string(&roles)
        .map_err(|e| format!("Serializzazione ruoli fallita: {}", e))?;
    let catalog_models_json = serde_json::to_string(&catalog_models)
        .map_err(|e| format!("Serializzazione catalogo modelli fallita: {}", e))?;

    // Su Windows CreateProcessW ha un limite di 32.767 caratteri: cataloghi e testo utente
    // confluiscono tutti nel file di contesto allegato via sintassi @ di omp.
    let context_markdown = format!(
        "# Richiesta Utente\n{}\n\n# Elenco Progetti Disponibili\n```json\n{}\n```\n\n# Direttive Speciali Disponibili\n```json\n{}\n```\n\n# Ruoli Standard Disponibili\n```json\n{}\n```\n\n# Modelli Disponibili nel Catalogo\n```json\n{}\n```\n",
        trimmed,
        projects_json,
        directives_json,
        roles_json,
        catalog_models_json
    );

    let user_prompt = "Analizza la richiesta utente contenuta nel file allegato e rispondi solo con il JSON richiesto.";

    let model_sel = model_selector.clone();
    let raw_output = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(
            QUICK_TASK_PARSER_SYSTEM_PROMPT,
            Some(&context_markdown),
            user_prompt,
            model_sel.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;

    let json_text = extract_json_payload(&raw_output)?;

    let parsed: QuickTaskAiParsed = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Parsing risposta JSON da omp fallito: {}. Output grezzo: {}",
            e, json_text
        )
    })?;

    Ok(parsed)
}

