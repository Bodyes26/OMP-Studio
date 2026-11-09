//! Apertura di file dall'esterno ("Apri con… Studio", EXT-001/002/003/008).
//!
//! I percorsi arrivano da tre canali: gli argomenti all'avvio, gli argomenti
//! inoltrati dalla seconda istanza (single-instance) e `RunEvent::Opened` su
//! macOS. Finiscono tutti in una coda: il frontend la svuota quando e' pronto
//! (`external_open_take`) e a ogni nuovo arrivo riceve solo un segnale, cosi'
//! un file aperto prima che la webview ascolti non va perso e uno aperto dopo
//! non arriva due volte.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Manager, State};

pub const OPEN_PATHS_EVENT: &str = "studio://open-paths";

#[derive(Default)]
pub struct PendingOpens(Mutex<Vec<String>>);

/// Estrae dagli argomenti i file da aprire: salta l'eseguibile e i flag
/// (`--hidden`, `--minimized` dell'avvio automatico), risolve i relativi
/// rispetto alla cartella di chi ha lanciato Studio e tiene solo file esistenti.
pub fn paths_from_args<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .filter_map(|arg| {
            let arg = arg.as_ref();
            if arg.is_empty() || arg.starts_with('-') {
                return None;
            }
            let path = Path::new(arg);
            let full = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };
            full.is_file().then(|| display_path(&full))
        })
        .collect()
}

/// Accoda i percorsi senza toccare la finestra: all'avvio la webview non
/// ascolta ancora e li prendera' con `external_open_take`.
pub fn push(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingOpens>() {
        if let Ok(mut queue) = state.0.lock() {
            queue.extend(paths);
        }
    }
}

/// Accoda i percorsi e avvisa il frontend. Porta la finestra in primo piano
/// solo qui: l'utente ha chiesto esplicitamente di aprire un file, a
/// differenza di un processo figlio che rilancia Studio senza argomenti.
pub fn enqueue(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    push(app, paths);
    // Passa dal gestore della presenza: tiene allineato lo stato della tray
    // quando la finestra era nascosta.
    let _ = crate::desktop_presence::show_main_window(app);
    let _ = app.emit(OPEN_PATHS_EVENT, ());
}

#[command]
pub fn external_open_take(state: State<'_, PendingOpens>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut queue| std::mem::take(&mut *queue))
        .unwrap_or_default()
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRoute {
    /// Percorso assoluto del file, senza prefisso `\\?\`.
    pub file: String,
    /// Indice in `roots` della radice che contiene il file (la piu' interna),
    /// oppure `None` se il file sta fuori da tutte.
    pub root_index: Option<usize>,
    /// Cartella di lavoro: la radice trovata, altrimenti la radice del
    /// repository git che contiene il file, altrimenti la sua cartella.
    pub workdir: String,
    /// Percorso del file relativo a `workdir`, con `/`.
    pub rel: String,
}

/// Decide dove aprire un file: dentro una delle `roots` (progetti e corsie
/// gia' aperti, EXT-003) oppure nella sua cartella di lavoro (EXT-008).
pub fn route_sync(path: &str, roots: &[String]) -> Result<ExternalRoute, String> {
    let file = Path::new(path).canonicalize().map_err(|e| {
        crate::tr!(
            format!("File non trovato ({path}): {e}"),
            format!("File not found ({path}): {e}")
        )
    })?;
    if !file.is_file() {
        return Err(crate::tr!(
            format!("Non e' un file: {path}"),
            format!("Not a file: {path}")
        ));
    }

    let inside = roots
        .iter()
        .enumerate()
        .filter_map(|(index, root)| {
            let base = Path::new(root).canonicalize().ok()?;
            file.starts_with(&base).then_some((index, base))
        })
        .max_by_key(|(_, base)| base.components().count());

    let (root_index, workdir) = match inside {
        Some((index, base)) => (Some(index), base),
        None => (None, workdir_for(&file)),
    };
    let rel = file
        .strip_prefix(&workdir)
        .map_err(|_| {
            crate::tr!(
                "Il file non sta nella sua cartella di lavoro",
                "The file is not inside its working folder"
            )
            .to_string()
        })?
        .to_string_lossy()
        .replace('\\', "/");

    Ok(ExternalRoute {
        file: display_path(&file),
        root_index,
        workdir: display_path(&workdir),
        rel,
    })
}

#[command]
pub async fn external_route(path: String, roots: Vec<String>) -> Result<ExternalRoute, String> {
    tokio::task::spawn_blocking(move || route_sync(&path, &roots))
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Task external_route: {e}"),
                format!("external_route task: {e}")
            )
        })?
}

/// Radice del repository git che contiene `file` (`.git` cartella o file,
/// come nei worktree), altrimenti la cartella del file.
fn workdir_for(file: &Path) -> PathBuf {
    let parent = file.parent().unwrap_or(file);
    parent
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .unwrap_or(parent)
        .to_path_buf()
}

/// `canonicalize` su Windows restituisce `\\?\C:\…`: il resto di Studio
/// lavora con i percorsi normali.
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(stripped) if !stripped.starts_with("UNC\\") => stripped.to_string(),
        _ => text.into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio-external-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn args_keep_only_existing_files_and_skip_flags() {
        let dir = tmp("args");
        fs::write(dir.join("a.txt"), "x").unwrap();
        fs::create_dir_all(dir.join("cartella")).unwrap();
        let args = ["studio.exe", "--hidden", "a.txt", "manca.txt", "cartella"];
        let paths = paths_from_args(args, &dir);
        assert_eq!(paths, vec![display_path(&dir.join("a.txt"))]);
    }

    #[test]
    fn route_prefers_innermost_open_root() {
        let dir = tmp("roots");
        let inner = dir.join("progetto").join("worktree");
        fs::create_dir_all(inner.join("src")).unwrap();
        fs::write(inner.join("src/a.ts"), "x").unwrap();
        let roots = vec![
            display_path(&dir.join("progetto")),
            display_path(&inner),
            display_path(&dir.join("altro")),
        ];
        let route = route_sync(&display_path(&inner.join("src/a.ts")), &roots).unwrap();
        assert_eq!(route.root_index, Some(1));
        assert_eq!(route.rel, "src/a.ts");
        assert_eq!(route.workdir, display_path(&inner));
    }

    #[test]
    fn route_outside_roots_uses_git_root_then_parent() {
        let dir = tmp("workdir");
        let repo = dir.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("src/lib")).unwrap();
        fs::write(repo.join("src/lib/a.ts"), "x").unwrap();
        let loose = dir.join("download");
        fs::create_dir_all(&loose).unwrap();
        fs::write(loose.join("note.txt"), "x").unwrap();

        let in_repo = route_sync(&display_path(&repo.join("src/lib/a.ts")), &[]).unwrap();
        assert_eq!(in_repo.root_index, None);
        assert_eq!(in_repo.workdir, display_path(&repo));
        assert_eq!(in_repo.rel, "src/lib/a.ts");

        let outside = route_sync(&display_path(&loose.join("note.txt")), &[]).unwrap();
        assert_eq!(outside.workdir, display_path(&loose));
        assert_eq!(outside.rel, "note.txt");
    }

    #[test]
    fn route_rejects_directories_and_missing_files() {
        let dir = tmp("reject");
        assert!(route_sync(&display_path(&dir), &[]).is_err());
        assert!(route_sync(&display_path(&dir.join("manca.txt")), &[]).is_err());
    }
}
