//! Apertura del progetto in un'applicazione esterna.
//!
//! `plugin-opener` sa aprire un percorso con l'app predefinita, ma non sa
//! passarle argomenti: `wt.exe <cartella>` interpreta il percorso come comando
//! da eseguire, non come cartella di lavoro, quindi serve `wt -d <cartella>`.
//! Da qui questo comando, che conosce la forma giusta per ogni piattaforma e
//! restituisce un errore leggibile quando l'applicazione non c'e'.

use std::path::Path;
use std::process::Command;
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Cosa aprire sulla cartella del progetto.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalTarget {
    /// Emulatore di terminale con la cartella come directory di lavoro.
    Terminal,
    /// Editor di codice esterno sulla cartella.
    Editor,
}

fn validate(project_path: &str) -> Result<&Path, String> {
    let path = Path::new(project_path);
    if project_path.trim().is_empty() || !path.is_dir() {
        return Err(format!("Cartella di progetto non valida: {project_path}"));
    }
    Ok(path)
}

/// Avvia il primo candidato che parte davvero. `None` se nessuno esiste.
fn spawn_first(candidates: Vec<(&str, Vec<String>)>) -> Option<&str> {
    for (program, args) in &candidates {
        let mut cmd = Command::new(program);
        cmd.args(args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if cmd.spawn().is_ok() {
            return Some(program);
        }
    }
    None
}

/// Vero se il comando esiste nel PATH. Serve perche' su Windows l'editor si
/// lancia tramite `cmd /C`, che parte sempre: senza questa verifica un `code`
/// assente passerebbe per successo.
fn command_exists(name: &str) -> bool {
    #[cfg(target_os = "windows")]
    let mut probe = {
        let mut cmd = Command::new("where.exe");
        cmd.arg(name);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };
    #[cfg(not(target_os = "windows"))]
    let mut probe = {
        let mut cmd = Command::new("which");
        cmd.arg(name);
        cmd
    };
    probe
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[command]
pub async fn open_project_external(
    project_path: String,
    target: ExternalTarget,
) -> Result<(), String> {
    let path = validate(&project_path)?;
    let dir = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let candidates: Vec<(&str, Vec<String>)> = match target {
        ExternalTarget::Terminal => vec![
            ("wt.exe", vec!["-d".into(), dir.clone()]),
            (
                "cmd.exe",
                vec![
                    "/C".into(),
                    "start".into(),
                    String::new(),
                    "/D".into(),
                    dir.clone(),
                    "cmd.exe".into(),
                ],
            ),
        ],
        ExternalTarget::Editor => ["code", "code-insiders"]
            .into_iter()
            .filter(|name| command_exists(name))
            .map(|name| {
                (
                    "cmd.exe",
                    vec!["/C".into(), name.to_string(), dir.clone()],
                )
            })
            .collect(),
    };

    #[cfg(target_os = "macos")]
    let candidates: Vec<(&str, Vec<String>)> = match target {
        ExternalTarget::Terminal => {
            vec![("open", vec!["-a".into(), "Terminal".into(), dir.clone()])]
        }
        ExternalTarget::Editor => vec![
            (
                "open",
                vec!["-a".into(), "Visual Studio Code".into(), dir.clone()],
            ),
            ("code", vec![dir.clone()]),
        ],
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let candidates: Vec<(&str, Vec<String>)> = match target {
        ExternalTarget::Terminal => vec![
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec![format!("--working-directory={dir}")]),
        ],
        ExternalTarget::Editor => vec![("code", vec![dir.clone()])],
    };

    match spawn_first(candidates) {
        Some(_) => Ok(()),
        None => Err(match target {
            ExternalTarget::Terminal => {
                "Nessun terminale disponibile su questo sistema".to_string()
            }
            ExternalTarget::Editor => {
                "Nessun editor esterno trovato: serve il comando `code` nel PATH".to_string()
            }
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rifiuta_percorsi_che_non_sono_cartelle() {
        assert!(validate("").is_err());
        assert!(validate("   ").is_err());
        assert!(validate("percorso/che/non/esiste/mai").is_err());
    }

    #[test]
    fn accetta_una_cartella_esistente() {
        let dir = std::env::temp_dir();
        assert!(validate(&dir.to_string_lossy()).is_ok());
    }
}
