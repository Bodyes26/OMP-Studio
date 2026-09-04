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
use tauri::{command, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::directives_ops::{extract_json_payload, run_ephemeral_omp_raw};

/// Stato di persistenza della finestra Companion (posizione, dimensioni e fissaggio).
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
        Self {
            is_pinned: false,
            x: None,
            y: None,
            width: Some(560),
            height: Some(520),
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

    let dir = PathBuf::from(base).join(if cfg!(target_os = "windows") {
        "omp-studio"
    } else {
        "omp-studio"
    });

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

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Lettura stato companion fallita: {}", e))?;
    let state: CompanionState = serde_json::from_str(&raw)
        .unwrap_or_default();
    Ok(state)
}

#[command]
pub fn save_companion_state(state: CompanionState) -> Result<(), String> {
    let path = get_companion_state_file()
        .ok_or_else(|| "Percorso configurazione companion non disponibile".to_string())?;
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Serializzazione stato companion fallita: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Scrittura stato companion fallita: {}", e))?;
    Ok(())
}

/// Mostra o nasconde la finestra Companion applicando la geometria appropriata.
pub fn toggle_companion_window_internal(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window("companion") {
        Some(w) => w,
        None => return Err("Finestra companion non trovata".to_string()),
    };

    let is_visible = window.is_visible().unwrap_or(false);
    let state = get_companion_state().unwrap_or_default();

    if is_visible {
        let is_focused = window.is_focused().unwrap_or(false);
        if is_focused && !state.is_pinned {
            // In modalita Spotlight, se la finestra e' a fuoco la scorciatoia la chiude
            let _ = window.hide();
            return Ok(());
        }
        // Se visibile ma non a fuoco, o pinnata, la porta in primo piano
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("companion-summon", ());
        return Ok(());
    }

    // Ripristina dimensioni e posizione salvata se disponibili
    if let (Some(w), Some(h)) = (state.width, state.height) {
        let _ = window.set_size(PhysicalSize::new(w, h));
    }

    if state.is_pinned {
        if let (Some(x), Some(y)) = (state.x, state.y) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    } else {
        // Spotlight mode: centra sul monitor attivo
        let _ = window.center();
    }

    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("companion-summon", ());
    Ok(())
}

#[command]
pub fn toggle_companion_window(app: AppHandle) -> Result<(), String> {
    toggle_companion_window_internal(&app)
}

#[command]
pub fn hide_companion_window(app: AppHandle) -> Result<(), String> {
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
            let result = app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = toggle_companion_window_internal(&app_cb);
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
        eprintln!("[companion] Impossibile registrare la scorciatoia globale per la finestra Companion");
    }
}

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

    let system_prompt = format!(
        r#"Sei un parser intelligente di task per l'orchestratore di agenti OMP Studio.
Il tuo compito è analizzare una richiesta utente in linguaggio naturale ed estrarre i parametri del task da accodare.

ELENCO PROGETTI DISPONIBILI:
{}

DIRETTIVE SPECIALI DISPONIBILI:
{}

RUOLI STANDARD DISPONIBILI:
{}

MODELLI DISPONIBILI NEL CATALOGO:
{}

REGOLE DI ESTRAZIONE RIGIDE:
1. "project_name": individua il progetto a cui si riferisce l'utente tramite corrispondenza esatta, parziale o sinonimi evidenti (es. "contratti affitto" -> "ContrattiImmobili", "tarature" -> "Cruscotto Tarature", "psr" -> "Cruscotto PSR"). Se chiaro, restituisci il nome esatto del progetto presente nella lista. Se non corrisponde a nessun progetto noto o è del tutto assente, imposta null e aggiungi una spiegazione in "ambiguities".
2. "project_path": imposta il percorso esatto 'path' del progetto associato al 'project_name' trovato. Se il progetto è nullo, imposta null.
3. "task_prompt": estrai SOLO il vero corpo/descrizione del lavoro da compiere, rimuovendo le parole accessorie utilizzate per indicare il progetto, il ruolo o le direttive (es. da "contratti affitto cambiare colore pulsante nuovo contratto per metterlo soft agente smol ponytail" estrai "cambiare colore pulsante nuovo contratto per metterlo soft"). Il prompt deve essere chiaro, conciso e pronto per l'agente.
4. "role": se l'utente nomina esplicitamente un ruolo (es. "agente smol", "ruolo default", "slow", "plan"), restituisci uno tra i ruoli disponibili. Se non è specificato, restituisci null.
5. "model_selector": se l'utente specifica un modello (es. "usa gpt 5.6 sol", "modello claude sonnet"), cerca la migliore corrispondenza nel catalogo modelli e restituisci il selettore esatto. Se non è specificato un modello, restituisci null.
6. "directive_ids": array contenente gli ID delle direttive richieste (es. se menziona "ponytail", "piano", "discussione", "ricerca online", "grill-me", ecc.). Includi solo ID validi presenti nell'elenco.
7. "ambiguities": array di stringhe. Se il testo contiene elementi poco chiari, riferimenti a progetti inesistenti o comandi contraddittori, inserisci brevi avvisi esplicativi in italiano. Se tutto è chiaro e ben determinato, lascia l'array vuoto [].

RISPONDI ESCLUSIVAMENTE con un oggetto JSON valido privo di testo introduttivo o conclusivo con questa struttura:
{{
  "project_name": "NomeProgetto" | null,
  "project_path": "PercorsoProgetto" | null,
  "task_prompt": "Testo pulito del task",
  "role": "smol" | "default" | "slow" | "plan" | null,
  "model_selector": "selettore-modello" | null,
  "directive_ids": ["id_direttiva_1"],
  "ambiguities": []
}}"#,
        projects_json, directives_json, roles_json, catalog_models_json
    );

    let raw_output = run_ephemeral_omp_raw(&system_prompt, trimmed, model_selector.as_deref())?;
    let json_text = extract_json_payload(&raw_output)?;

    let parsed: QuickTaskAiParsed = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Parsing risposta JSON da omp fallito: {}. Output grezzo: {}",
            e, json_text
        )
    })?;

    Ok(parsed)
}
