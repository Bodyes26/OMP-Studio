//! Gestione percorsi per il Laboratorio prototipi.
//!
//! Risolve e memorizza la radice del Laboratorio all'avvio dell'applicazione
//! (`app_local_data_dir()/lab`). Espone funzioni di utilita' per recuperare
//! la radice, l'indice globale delle bozze e i percorsi dei workspace.

use super::types::LabPaths;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::command;

static LAB_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Inizializza la radice del Laboratorio a partire dalla directory locale dell'app.
pub fn init(app_local_data_dir: PathBuf) {
    let lab_dir = app_local_data_dir.join("lab");
    let _ = LAB_ROOT.set(lab_dir);
}

/// Identificatore dell'app (`identifier` in tauri.conf.json): Tauri lo usa come nome
/// della cartella di `app_local_data_dir`.
const APP_IDENTIFIER: &str = "sh.omp.studio";

/// Radice globale del Laboratorio (`<app_local_data_dir>/lab`).
/// Se non ancora inizializzata da Tauri, ricostruisce lo stesso percorso che
/// restituirebbe `app_local_data_dir`: un fallback diverso (prima `omp-studio`)
/// faceva finire i prototipi in una seconda cartella che l'app poi non vedeva.
pub fn lab_root() -> Option<PathBuf> {
    if let Some(root) = LAB_ROOT.get() {
        return Some(root.clone());
    }
    fallback_local_data_dir().map(|dir| dir.join("lab"))
}

/// `%LOCALAPPDATA%\sh.omp.studio` su Windows.
#[cfg(target_os = "windows")]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|local| PathBuf::from(local).join(APP_IDENTIFIER))
}

/// `~/Library/Application Support/sh.omp.studio` su macOS.
#[cfg(target_os = "macos")]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_IDENTIFIER)
    })
}

/// `$XDG_DATA_HOME/sh.omp.studio`, altrimenti `~/.local/share/sh.omp.studio`.
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .map(|dir| dir.join(APP_IDENTIFIER))
}

/// Percorso dell'indice globale delle bozze (`<lab_root>/drafts/prototypes.json`).
pub fn drafts_index_path() -> Option<PathBuf> {
    lab_root().map(|root| root.join("drafts").join("prototypes.json"))
}

/// Rimuove l'eventuale prefisso UNC di Windows (`\\?\`) dal percorso canonico.
pub fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

/// Risolve il percorso canonico della radice del progetto, ripulito da prefissi UNC su Windows.
pub fn canonical_project_path(project_path: &Path) -> PathBuf {
    let canon = project_path
        .canonicalize()
        .unwrap_or_else(|_| project_path.to_path_buf());
    strip_unc_prefix(canon)
}

/// Percorso dell'indice di progetto (`<canonicalProjectPath>/.omp/lab/prototypes.json`).
pub fn project_index_path(project_path: &Path) -> PathBuf {
    canonical_project_path(project_path)
        .join(".omp")
        .join("lab")
        .join("prototypes.json")
}

/// Percorso del workspace per un prototipo (`<lab_root>/prototypes/<id>`).
pub fn prototype_workspace_path(id: &str) -> Option<PathBuf> {
    lab_root().map(|root| root.join("prototypes").join(id))
}

/// Workspace del Laboratorio richiesto dal frontend, canonico e confinato a
/// `<lab_root>/prototypes` (S8-02).
///
/// I comandi `lab_*` arrivano con un percorso scelto dalla finestra: per un
/// progetto di un'altra macchina e' un percorso Windows che qui e' relativo, e
/// senza questo controllo `lab_preview_status_write` creava cartelle dentro la
/// cartella di lavoro del processo e `lab_workspace_snapshot` leggeva ovunque.
/// Stesso confinamento dei `lab_git_*`, che lo avevano gia'.
pub(super) fn confined_lab_workspace(workspace_path: &str) -> Result<PathBuf, String> {
    let prototypes_dir = lab_root()
        .ok_or_else(|| {
            crate::tr!(
                "Radice del Laboratorio non disponibile",
                "Lab root not available"
            )
            .to_string()
        })?
        .join("prototypes");
    super::index::confined_prototype_workspace(&prototypes_dir, Path::new(workspace_path))
}

/// Ritorna la radice dei dati del Laboratorio e il percorso dell'indice bozze globale.
#[command]
pub async fn lab_paths() -> Result<LabPaths, String> {
    let root = lab_root().ok_or_else(|| {
        crate::tr!(
            "Radice del Laboratorio non disponibile",
            "Lab root not available"
        )
        .to_string()
    })?;
    let drafts_index = drafts_index_path().ok_or_else(|| {
        crate::tr!(
            "Percorso indice bozze non disponibile",
            "Drafts index path not available"
        )
        .to_string()
    })?;
    Ok(LabPaths {
        root: root.to_string_lossy().to_string(),
        drafts_index: drafts_index.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identificatore_allineato_a_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"].as_str(), Some(APP_IDENTIFIER));
    }

    #[test]
    fn fallback_usa_la_cartella_dell_identificatore() {
        if let Some(dir) = fallback_local_data_dir() {
            assert!(dir.ends_with(APP_IDENTIFIER), "{}", dir.display());
        }
    }

    /// S8-02: un percorso che non e' un prototipo (percorso Windows visto dal
    /// Mac, o una cartella qualsiasi) non deve essere accettato dai comandi
    /// `lab_*`: senza, `lab_preview_status_write` creava cartelle relative.
    #[test]
    fn rifiuta_i_workspace_fuori_dai_prototypi() {
        for outside in [r"C:\Users\nome\progetto\lab\prototypes\p-1", "/tmp", "."] {
            assert!(
                confined_lab_workspace(outside).is_err(),
                "{outside} doveva essere rifiutato"
            );
        }
    }
}
