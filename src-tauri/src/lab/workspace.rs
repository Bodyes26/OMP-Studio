//! Gestione dei workspace dei prototipi (template, creazione, snapshot, duplicazione, esportazione).

use super::git::{git_init, git_initial_commit};
use super::index::{ensure_project_gitignore, read_index, resolve_index_path, write_index};
use super::paths::prototype_workspace_path;
use super::types::{LabFile, LabIndexEntry, LabPrototypeStatus};
use super::util::{generate_prototype_id, now_iso8601};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

const TEMPLATE_PACKAGE_JSON: &str = include_str!("template/package.json");
const TEMPLATE_INDEX_HTML: &str = include_str!("template/index.html");
const TEMPLATE_VITE_CONFIG: &str = include_str!("template/vite.config.ts.template");
const TEMPLATE_TSCONFIG: &str = include_str!("template/tsconfig.json");
const TEMPLATE_MAIN_TSX: &str = include_str!("template/src/main.tsx");
const TEMPLATE_APP_TSX: &str = include_str!("template/src/App.tsx");
const TEMPLATE_INDEX_CSS: &str = include_str!("template/src/index.css");
const TEMPLATE_GITIGNORE: &str = include_str!("template/.gitignore");
const TEMPLATE_META_JSON: &str = include_str!("template/.lab/meta.json");

/// Istanzia tutti i file del template all'interno della cartella del workspace.
/// `empty_hint` e' il testo della pagina vuota, gia' nella lingua dell'interfaccia.
fn instantiate_template(
    workspace_path: &Path,
    prototype_id: &str,
    title: &str,
    empty_hint: &str,
    created_at: &str,
) -> Result<(), String> {
    fs::create_dir_all(workspace_path.join("src")).map_err(|e| {
        crate::tr!(
            format!("Creazione cartella src fallita: {e}"),
            format!("Creating the src folder failed: {e}")
        )
    })?;
    fs::create_dir_all(workspace_path.join(".lab")).map_err(|e| {
        crate::tr!(
            format!("Creazione cartella .lab fallita: {e}"),
            format!("Creating the .lab folder failed: {e}")
        )
    })?;

    let package_json = TEMPLATE_PACKAGE_JSON.replace("{{SLUG}}", prototype_id);
    fs::write(workspace_path.join("package.json"), package_json).map_err(|e| {
        crate::tr!(
            format!("Scrittura package.json fallita: {e}"),
            format!("Writing package.json failed: {e}")
        )
    })?;

    fs::write(workspace_path.join("index.html"), TEMPLATE_INDEX_HTML).map_err(|e| {
        crate::tr!(
            format!("Scrittura index.html fallita: {e}"),
            format!("Writing index.html failed: {e}")
        )
    })?;
    fs::write(workspace_path.join("vite.config.ts"), TEMPLATE_VITE_CONFIG).map_err(|e| {
        crate::tr!(
            format!("Scrittura vite.config.ts fallita: {e}"),
            format!("Writing vite.config.ts failed: {e}")
        )
    })?;
    fs::write(workspace_path.join("tsconfig.json"), TEMPLATE_TSCONFIG).map_err(|e| {
        crate::tr!(
            format!("Scrittura tsconfig.json fallita: {e}"),
            format!("Writing tsconfig.json failed: {e}")
        )
    })?;
    fs::write(workspace_path.join("src/main.tsx"), TEMPLATE_MAIN_TSX).map_err(|e| {
        crate::tr!(
            format!("Scrittura src/main.tsx fallita: {e}"),
            format!("Writing src/main.tsx failed: {e}")
        )
    })?;
    // Letterali JSON: sono anche stringhe JS valide, quindi titolo e testo non
    // possono rompere il TSX qualunque carattere contengano.
    let escaped_title = serde_json::to_string(title).unwrap_or_else(|_| format!("\"{title}\""));
    let escaped_hint =
        serde_json::to_string(empty_hint).unwrap_or_else(|_| format!("\"{empty_hint}\""));
    let app_tsx = TEMPLATE_APP_TSX
        .replace("\"{{TITLE}}\"", &escaped_title)
        .replace("\"{{EMPTY_HINT}}\"", &escaped_hint);
    fs::write(workspace_path.join("src/App.tsx"), app_tsx).map_err(|e| {
        crate::tr!(
            format!("Scrittura src/App.tsx fallita: {e}"),
            format!("Writing src/App.tsx failed: {e}")
        )
    })?;
    fs::write(workspace_path.join("src/index.css"), TEMPLATE_INDEX_CSS).map_err(|e| {
        crate::tr!(
            format!("Scrittura src/index.css fallita: {e}"),
            format!("Writing src/index.css failed: {e}")
        )
    })?;
    fs::write(workspace_path.join(".gitignore"), TEMPLATE_GITIGNORE).map_err(|e| {
        crate::tr!(
            format!("Scrittura .gitignore fallita: {e}"),
            format!("Writing .gitignore failed: {e}")
        )
    })?;

    let meta_json = TEMPLATE_META_JSON
        .replace("\"{{TITLE}}\"", &escaped_title)
        .replace("{{UPDATED_AT}}", created_at);
    fs::write(workspace_path.join(".lab/meta.json"), meta_json).map_err(|e| {
        crate::tr!(
            format!("Scrittura .lab/meta.json fallita: {e}"),
            format!("Writing .lab/meta.json failed: {e}")
        )
    })?;

    Ok(())
}

/// Esegue un passo della creazione di un workspace appena nato e, se fallisce,
/// rimuove la cartella: un workspace a meta' che nessun indice conosce resterebbe
/// sul disco per sempre.
fn with_workspace_cleanup<T>(
    ws_path: &Path,
    step: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    step().inspect_err(|_| {
        let _ = fs::remove_dir_all(ws_path);
    })
}

/// Crea un nuovo prototipo dal template standard Vite + React + Tailwind v4.
#[command]
pub async fn lab_prototype_create(
    project_path: Option<String>,
    title: Option<String>,
    empty_hint: Option<String>,
) -> Result<LabIndexEntry, String> {
    tokio::task::spawn_blocking(move || {
        let title = title
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| {
                // La lingua del titolo segue l'interfaccia: il frontend riconosce i
                // segnaposto in entrambe le forme (isPlaceholderLaneTitle).
                crate::tr!("Nuovo prototipo", "New prototype").to_string()
            });
        let empty_hint = empty_hint
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| {
                crate::tr!(
                    "Descrivi l'interfaccia desiderata nella chat per iniziare a costruire il prototipo.",
                    "Describe the interface you want in the chat to start building the prototype."
                )
                .to_string()
            });

        let prototype_id = generate_prototype_id();
        let ws_path = prototype_workspace_path(&prototype_id).ok_or_else(|| {
            crate::tr!(
                "Radice del Laboratorio non disponibile",
                "Lab root not available"
            ).to_string()
        })?;

        if ws_path.exists() {
            return Err(crate::tr!(
                format!("La cartella di destinazione {} esiste gia'", ws_path.display()),
                format!("The destination folder {} already exists", ws_path.display())
            ));
        }

        let now = now_iso8601();

        // 1-2. Template, git init e commit iniziale. La cartella e' appena nata (sopra
        // si e' verificato che non esistesse): se un passo fallisce si rimuove, invece
        // di lasciare un workspace a meta' che nessun indice conosce.
        let initial_rev = with_workspace_cleanup(&ws_path, || {
            instantiate_template(&ws_path, &prototype_id, &title, &empty_hint, &now)?;
            git_init(&ws_path)?;
            git_initial_commit(&ws_path)
        })?;

        // 3. Prepara la voce dell'indice
        let entry = LabIndexEntry {
            id: prototype_id,
            title,
            title_locked: false,
            summary: String::new(),
            status: LabPrototypeStatus::Active,
            created_at: now.clone(),
            updated_at: now,
            closed_at: None,
            workspace_path: ws_path.to_string_lossy().to_string(),
            last_revision: Some(initial_rev),
            duplicated_from: None,
        };

        // 4. Salva la voce nell'indice appropriato (progetto o bozze)
        with_workspace_cleanup(&ws_path, || {
            let index_path = resolve_index_path(project_path.as_deref())?;
            let mut index_file = read_index(&index_path)?;
            index_file.prototypes.push(entry.clone());
            write_index(&index_path, &index_file)
        })?;

        // 5. Se associato a un progetto git, assicurati che .omp/lab/ sia ignorato
        if let Some(p_str) = &project_path {
            let _ = ensure_project_gitignore(Path::new(p_str));
        }

        Ok(entry)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Estensioni che il compiler dell'anteprima legge come sorgenti: se non sono UTF-8
/// scartarle in silenzio farebbe sparire moduli (o l'ingresso) con errori fuorvianti.
const SOURCE_EXTENSIONS: &[&str] = &["tsx", "ts", "jsx", "js", "mjs", "json", "css", "html"];

/// Decodifica un file dello snapshot. I file binari (immagini, font) non servono al
/// compiler e restano fuori; un sorgente non UTF-8 invece e' un errore esplicito.
pub(super) fn decode_snapshot_text(
    rel_path: &str,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    match String::from_utf8(bytes) {
        Ok(content) => Ok(Some(content)),
        Err(_) => {
            let is_source = Path::new(rel_path)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| SOURCE_EXTENSIONS.iter().any(|s| s.eq_ignore_ascii_case(e)));
            if is_source {
                Err(crate::tr!(
                    format!(
                        "Il file {rel_path} non e' codificato in UTF-8: salvalo in UTF-8 per compilarlo"
                    ),
                    format!(
                        "File {rel_path} is not UTF-8 encoded: save it as UTF-8 so it can compile"
                    )
                ))
            } else {
                Ok(None)
            }
        }
    }
}

/// Attraversa ricorsivamente la cartella del workspace raccogliendo i file di testo.
fn walk_snapshot_dir(root: &Path, current: &Path, files: &mut Vec<LabFile>) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| {
        crate::tr!(
            format!("Lettura directory {} fallita: {e}", current.display()),
            format!("Reading directory {} failed: {e}", current.display())
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| {
            crate::tr!(
                format!("Voce non valida: {e}"),
                format!("Invalid entry: {e}")
            )
        })?;
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        // `file_type` non segue i link simbolici: una cartella collegata a un antenato
        // porterebbe la ricorsione in un ciclo infinito.
        let file_type = entry.file_type().map_err(|e| {
            crate::tr!(
                format!("Tipo di {} non disponibile: {e}", path.display()),
                format!("File type of {} not available: {e}", path.display())
            )
        })?;

        if file_type.is_dir() {
            if file_name == ".git"
                || file_name == ".lab"
                || file_name == "node_modules"
                || file_name == "dist"
            {
                continue;
            }
            walk_snapshot_dir(root, &path, files)?;
        } else if path.is_file() {
            let rel = path.strip_prefix(root).map_err(|e| {
                crate::tr!(
                    format!("Prefisso non valido: {e}"),
                    format!("Invalid prefix: {e}")
                )
            })?;
            let normalized = rel.to_string_lossy().replace('\\', "/");

            if files.len() >= 400 {
                return Err(crate::tr!(
                    "Il workspace supera il limite massimo di 400 file",
                    "The workspace exceeds the maximum limit of 400 files"
                )
                .to_string());
            }

            let meta = entry.metadata().map_err(|e| {
                crate::tr!(
                    format!("Metadata {normalized} non disponibili: {e}"),
                    format!("Metadata for {normalized} not available: {e}")
                )
            })?;
            if meta.len() > 1_048_576 {
                return Err(crate::tr!(
                    format!("Il file {normalized} supera la dimensione massima di 1 MiB"),
                    format!("File {normalized} exceeds the maximum size of 1 MiB")
                ));
            }

            let bytes = fs::read(&path).map_err(|e| {
                crate::tr!(
                    format!("Lettura del file {normalized} fallita: {e}"),
                    format!("Reading file {normalized} failed: {e}")
                )
            })?;
            if let Some(content) = decode_snapshot_text(&normalized, bytes)? {
                files.push(LabFile {
                    path: normalized,
                    content,
                });
            }
        }
    }
    Ok(())
}

/// Snapshot di tutti i file di testo del workspace (esclusi .git, node_modules, dist,
/// e l'intera cartella .lab salvo .lab/brief.md), con percorsi relativi alla radice e separatori `/`.
fn snapshot_workspace(root: &Path) -> Result<Vec<LabFile>, String> {
    if !root.is_dir() {
        return Err(crate::tr!(
            format!("Workspace non trovato o non cartella: {}", root.display()),
            format!("Workspace not found or not a folder: {}", root.display())
        ));
    }

    let mut files = Vec::new();
    walk_snapshot_dir(root, root, &mut files)?;

    // Include .lab/brief.md come unico file permesso da .lab nello snapshot
    let brief_path = root.join(".lab").join("brief.md");
    if brief_path.is_file() {
        if let Ok(meta) = brief_path.metadata() {
            if meta.len() <= 1_048_576 {
                if let Ok(bytes) = fs::read(&brief_path) {
                    if let Some(content) = decode_snapshot_text(".lab/brief.md", bytes)? {
                        files.push(LabFile {
                            path: ".lab/brief.md".to_string(),
                            content,
                        });
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Scatta uno snapshot completo di tutti i file di testo del workspace.
#[command]
pub async fn lab_workspace_snapshot(workspace_path: String) -> Result<Vec<LabFile>, String> {
    tokio::task::spawn_blocking(move || snapshot_workspace(Path::new(&workspace_path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Verifica se la directory del workspace esiste fisicamente sul filesystem.
#[command]
pub async fn lab_workspace_exists(workspace_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || Ok(Path::new(&workspace_path).is_dir()))
        .await
        .map_err(|e| e.to_string())?
}

/// Copia ricorsiva selettiva di una cartella.
fn copy_dir_filtered(
    src: &Path,
    dst: &Path,
    include_git: bool,
    exclude_lab: bool,
) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| {
        crate::tr!(
            format!("Creazione cartella {} fallita: {e}", dst.display()),
            format!("Creating folder {} failed: {e}", dst.display())
        )
    })?;

    let entries = fs::read_dir(src).map_err(|e| {
        crate::tr!(
            format!("Lettura cartella {} fallita: {e}", src.display()),
            format!("Reading folder {} failed: {e}", src.display())
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| {
            crate::tr!(
                format!("Errore elemento directory: {e}"),
                format!("Directory entry error: {e}")
            )
        })?;
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();

        if file_name == "node_modules" || file_name == "dist" {
            continue;
        }
        if !include_git && file_name == ".git" {
            continue;
        }
        if exclude_lab && file_name == ".lab" {
            continue;
        }
        if file_name.starts_with(".brief-approved") || file_name == "preview-status.json" {
            continue;
        }
        let target = dst.join(file_name);
        if path.is_dir() {
            copy_dir_filtered(&path, &target, include_git, exclude_lab)?;
        } else if path.is_file() {
            fs::copy(&path, &target).map_err(|e| {
                crate::tr!(
                    format!(
                        "Copia da {} a {} fallita: {e}",
                        path.display(),
                        target.display()
                    ),
                    format!(
                        "Copy from {} to {} failed: {e}",
                        path.display(),
                        target.display()
                    )
                )
            })?;
        }
    }
    Ok(())
}

/// Duplica un prototipo creando una copia ricorsiva del workspace (incluso .git) e una nuova voce d'indice.
#[command]
pub async fn lab_prototype_duplicate(
    project_path: Option<String>,
    id: String,
) -> Result<LabIndexEntry, String> {
    tokio::task::spawn_blocking(move || {
        let index_path = resolve_index_path(project_path.as_deref())?;
        let mut index_file = read_index(&index_path)?;

        let orig_entry = index_file
            .prototypes
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or_else(|| {
                crate::tr!(
                    format!("Prototipo {id} da duplicare non trovato nell'indice"),
                    format!("Prototype {id} to duplicate not found in the index")
                )
            })?;

        let orig_ws = PathBuf::from(&orig_entry.workspace_path);
        if !orig_ws.is_dir() {
            return Err(crate::tr!(
                format!("Workspace di origine non esistente: {}", orig_ws.display()),
                format!("Source workspace does not exist: {}", orig_ws.display())
            ));
        }

        let new_id = generate_prototype_id();
        let new_ws = prototype_workspace_path(&new_id).ok_or_else(|| {
            crate::tr!(
                "Radice del Laboratorio non disponibile",
                "Lab root not available"
            )
            .to_string()
        })?;

        // Copia ricorsiva del workspace (incluso .git, esclusi node_modules e dist)
        copy_dir_filtered(&orig_ws, &new_ws, true, false)?;
        // Rimuove marker transitori di approvazione per evitare che la copia
        // erediti lo stato di approvazione del prototipo originale.
        let _ = fs::remove_file(new_ws.join(".lab").join(".brief-approved.json"));
        let _ = fs::remove_file(new_ws.join(".lab").join("preview-status.json"));

        let now = now_iso8601();
        let new_title = crate::tr!(
            format!("{} (copia)", orig_entry.title),
            format!("{} (copy)", orig_entry.title)
        );

        // Aggiorna nome in package.json
        let pkg_path = new_ws.join("package.json");
        if pkg_path.exists() {
            if let Ok(content) = fs::read_to_string(&pkg_path) {
                let updated = content.replace(&orig_entry.id, &new_id);
                let _ = fs::write(&pkg_path, updated);
            }
        }

        // Aggiorna .lab/meta.json
        let meta_path = new_ws.join(".lab/meta.json");
        let meta_obj = serde_json::json!({
            "title": new_title,
            "summary": orig_entry.summary,
            "updatedAt": now
        });
        if let Ok(meta_bytes) = serde_json::to_vec_pretty(&meta_obj) {
            let _ = fs::write(&meta_path, meta_bytes);
        }

        // Crea la nuova voce nell'indice
        let new_entry = LabIndexEntry {
            id: new_id,
            title: new_title,
            summary: orig_entry.summary.clone(),
            title_locked: false,
            status: LabPrototypeStatus::Active,
            created_at: now.clone(),
            updated_at: now,
            closed_at: None,
            workspace_path: new_ws.to_string_lossy().to_string(),
            last_revision: orig_entry.last_revision.clone(),
            duplicated_from: Some(id),
        };

        index_file.prototypes.push(new_entry.clone());
        write_index(&index_path, &index_file)?;

        Ok(new_entry)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Esporta il workspace in una cartella di destinazione (privo di .git, .lab, node_modules, dist).
/// La destinazione non deve esistere o deve essere una cartella vuota.
#[command]
pub async fn lab_export(workspace_path: String, destination: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let src = Path::new(&workspace_path);
        if !src.is_dir() {
            return Err(crate::tr!(
                format!("Workspace di origine non valido: {}", src.display()),
                format!("Invalid source workspace: {}", src.display())
            ));
        }

        let dst = Path::new(&destination);
        if dst.exists() {
            if !dst.is_dir() {
                return Err(crate::tr!(
                    "La destinazione indicata esiste gia' e non e' una cartella",
                    "The destination already exists and is not a folder"
                )
                .to_string());
            }
            let is_empty = fs::read_dir(dst)
                .map_err(|e| {
                    crate::tr!(
                        format!("Controllo cartella destinazione fallito: {e}"),
                        format!("Checking the destination folder failed: {e}")
                    )
                })?
                .next()
                .is_none();
            if !is_empty {
                return Err(crate::tr!(
                    "La cartella di destinazione deve essere vuota",
                    "The destination folder must be empty"
                )
                .to_string());
            }
        }

        copy_dir_filtered(src, dst, false, true)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creazione_fallita_rimuove_la_cartella() {
        let ws = std::env::temp_dir().join(format!(
            "omp-studio-lab-cleanup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let result: Result<(), String> = with_workspace_cleanup(&ws, || {
            fs::create_dir_all(ws.join("src")).unwrap();
            fs::write(ws.join("index.html"), "x").unwrap();
            Err("git init fallito".to_string())
        });
        assert!(result.is_err());
        assert!(!ws.exists(), "la cartella a meta' deve sparire");

        let ok = with_workspace_cleanup(&ws, || {
            fs::create_dir_all(&ws).unwrap();
            Ok(7)
        });
        assert_eq!(ok, Ok(7));
        assert!(ws.exists());
        let _ = fs::remove_dir_all(&ws);
    }

    /// Radice temporanea unica, scritta come la passa Studio su Windows: lettera di
    /// unita' e separatori misti (`C:\Users\...\Temp/lab-.../p-...`).
    fn temp_workspace(tag: &str) -> (PathBuf, String) {
        let dir = std::env::temp_dir().join(format!(
            "lab-snapshot-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ws = dir.join("p-test");
        fs::create_dir_all(&ws).unwrap();
        let mixed = format!("{}/p-test", dir.to_string_lossy());
        (dir, mixed)
    }

    #[test]
    fn snapshot_includes_template_sources_in_subfolders() {
        let (dir, mixed_root) = temp_workspace("tpl");
        let root = Path::new(&mixed_root);
        instantiate_template(root, "p-test", "Test", "Hint", "2026-01-01T00:00:00Z").unwrap();
        fs::create_dir_all(root.join("src/components/ui")).unwrap();
        fs::write(root.join("src/components/ui/Button.tsx"), "export {}").unwrap();
        fs::create_dir_all(root.join("node_modules/react")).unwrap();
        fs::write(root.join("node_modules/react/index.js"), "x").unwrap();

        let paths: Vec<String> = snapshot_workspace(root)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        let _ = fs::remove_dir_all(&dir);

        for expected in [
            "index.html",
            "package.json",
            "src/App.tsx",
            "src/index.css",
            "src/main.tsx",
            "src/components/ui/Button.tsx",
        ] {
            assert!(
                paths.iter().any(|p| p == expected),
                "manca {expected} in {paths:?}"
            );
        }
        assert!(
            paths.iter().all(|p| !p.contains('\\')),
            "separatori non normalizzati: {paths:?}"
        );
        assert!(
            paths
                .iter()
                .all(|p| !p.starts_with("node_modules") && !p.starts_with(".lab")),
            "cartelle escluse incluse: {paths:?}"
        );
    }

    #[test]
    fn snapshot_rejects_non_utf8_source_and_skips_binary_assets() {
        let (dir, mixed_root) = temp_workspace("utf8");
        let root = Path::new(&mixed_root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/logo.png"),
            [0x89, b'P', b'N', b'G', 0xff, 0xfe],
        )
        .unwrap();
        let binary_ok = snapshot_workspace(root).unwrap();
        // "caffè" in Windows-1252: non e' UTF-8 valido
        fs::write(root.join("src/main.tsx"), b"const s = 'caff\xe8';").unwrap();
        let err = snapshot_workspace(root).unwrap_err();
        let _ = fs::remove_dir_all(&dir);

        assert!(binary_ok.is_empty(), "asset binario incluso: {binary_ok:?}");
        assert!(
            err.contains("src/main.tsx") && err.contains("UTF-8"),
            "{err}"
        );
    }
}
