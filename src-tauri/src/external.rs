//! Apertura del progetto in un'applicazione esterna.
//!
//! `plugin-opener` sa aprire un percorso con l'app predefinita, ma non sa
//! passarle argomenti: `wt.exe <cartella>` interpreta il percorso come comando
//! da eseguire, non come cartella di lavoro, quindi serve `wt -d <cartella>`.
//! Da qui questo comando, che conosce la forma giusta per ogni piattaforma e
//! restituisce un errore leggibile quando l'applicazione non c'e'.

use std::path::{Path, PathBuf};
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

fn validate(project_path: &str, rel: Option<&str>) -> Result<PathBuf, String> {
    let clean_project_path = project_path.trim();
    if clean_project_path.is_empty() {
        return Err("Cartella di progetto non valida: percorso vuoto".to_string());
    }

    let base_raw = Path::new(clean_project_path);
    if !base_raw.is_dir() {
        return Err(format!(
            "Cartella di progetto non valida: {clean_project_path}"
        ));
    }

    let base = base_raw.canonicalize().map_err(|e| {
        format!(
            "Cartella di progetto non valida ({}): {}",
            clean_project_path, e
        )
    })?;

    match rel {
        None => Ok(base_raw.to_path_buf()),
        Some(r) => {
            let clean_rel = r.replace('\\', "/");
            let clean_rel = clean_rel.trim_matches('/');
            if clean_rel.is_empty() || clean_rel == "." {
                return Ok(base_raw.to_path_buf());
            }

            let target = base.join(clean_rel);
            let canonical = target
                .canonicalize()
                .map_err(|e| format!("Sottocartella non valida o inesistente ({}): {}", r, e))?;

            if !canonical.starts_with(&base) {
                return Err("Il percorso esce dalla cartella del progetto".to_string());
            }

            if !canonical.is_dir() {
                return Err(format!(
                    "Il percorso specificato non e' una cartella: {}",
                    r
                ));
            }

            #[cfg(target_os = "windows")]
            {
                let s = canonical.to_string_lossy();
                let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
                Ok(PathBuf::from(stripped))
            }
            #[cfg(not(target_os = "windows"))]
            {
                Ok(canonical)
            }
        }
    }
}

/// Avvia il primo candidato che parte davvero.
fn spawn_first(candidates: Vec<(&str, Vec<String>)>, working_dir: &Path) -> bool {
    for (program, args) in &candidates {
        let mut cmd = Command::new(program);
        cmd.args(args).current_dir(working_dir);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if cmd.spawn().is_ok() {
            return true;
        }
    }
    false
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
    rel: Option<String>,
) -> Result<(), String> {
    let path = validate(&project_path, rel.as_deref())?;
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
            .map(|name| ("cmd.exe", vec!["/C".into(), name.to_string(), dir.clone()]))
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

    if spawn_first(candidates, &path) {
        Ok(())
    } else {
        Err(match target {
            ExternalTarget::Terminal => {
                "Nessun terminale disponibile su questo sistema".to_string()
            }
            ExternalTarget::Editor => {
                "Nessun editor esterno trovato: serve il comando `code` nel PATH".to_string()
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rifiuta_percorsi_che_non_sono_cartelle() {
        assert!(validate("", None).is_err());
        assert!(validate("   ", None).is_err());
        assert!(validate("percorso/che/non/esiste/mai", None).is_err());
    }

    #[test]
    fn accetta_una_cartella_esistente() {
        let dir = std::env::temp_dir();
        assert!(validate(&dir.to_string_lossy(), None).is_ok());
    }

    #[test]
    fn accetta_sottocartella_valida() {
        let root = std::env::temp_dir().join("omp-studio-ext-sub-ok");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub/nested")).unwrap();

        let res = validate(&root.to_string_lossy(), Some("sub/nested"));
        assert!(res.is_ok());
        assert!(res.unwrap().ends_with("nested"));
    }

    #[test]
    fn rifiuta_file_come_sottocartella() {
        let root = std::env::temp_dir().join("omp-studio-ext-file-err");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("file.txt"), "hello").unwrap();

        let res = validate(&root.to_string_lossy(), Some("file.txt"));
        assert!(res.is_err());
    }

    #[test]
    fn rifiuta_traversal_sottocartella() {
        let root = std::env::temp_dir().join("omp-studio-ext-traversal");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let res = validate(&root.to_string_lossy(), Some("../../windows"));
        assert!(res.is_err());
    }
}
