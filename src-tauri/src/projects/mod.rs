use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::command;
use tauri::ipc::Response;

pub mod tasks;
pub use tasks::*;

#[derive(Serialize, Deserialize)]
pub struct Dirent {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize, Deserialize)]
pub struct FileContent {
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct GitHeadContent {
    pub content: String,
    pub exists: bool,
}

#[derive(Serialize, Deserialize)]
pub struct FileGitStatus {
    pub statuses: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub score: i64,
    pub name_indices: Vec<usize>,
    pub path_indices: Vec<usize>,
}

pub const IGNORED_SEARCH_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "bin",
    "obj",
    ".vs",
    "packages",
    "target",
    ".idea",
    ".svelte-kit",
    ".next",
    ".nuxt",
    "dist",
    "build",
    ".cache",
];

fn fuzzy_match_str(target: &str, query: &str) -> Option<(i64, Vec<usize>)> {
    if query.is_empty() {
        return Some((0, Vec::new()));
    }
    let orig_target: Vec<char> = target.chars().collect();
    if orig_target.is_empty() {
        return None;
    }

    // Mappa ogni carattere minuscolo all'indice del carattere originale in orig_target.
    // Alcuni caratteri Unicode (es. 'İ') si espandono in piu' caratteri minuscoli ('i' + '\u{0307}').
    let mut target_lower: Vec<char> = Vec::new();
    let mut lower_to_orig: Vec<usize> = Vec::new();
    for (orig_idx, &c) in orig_target.iter().enumerate() {
        for lc in c.to_lowercase() {
            target_lower.push(lc);
            lower_to_orig.push(orig_idx);
        }
    }

    let query_lower: Vec<char> = query.chars().flat_map(|c| c.to_lowercase()).collect();
    if query_lower.is_empty() {
        return Some((0, Vec::new()));
    }

    if query_lower.len() > target_lower.len() {
        return None;
    }

    fn find_best(
        target_lower: &[char],
        orig_target: &[char],
        lower_to_orig: &[usize],
        query: &[char],
        t_idx: usize,
        q_idx: usize,
        prev_matched_idx: Option<usize>,
        current_indices: &mut Vec<usize>,
        current_score: i64,
        best_score: &mut Option<(i64, Vec<usize>)>,
        calls: &mut usize,
    ) {
        *calls += 1;
        if *calls > 1000 {
            return;
        }

        if q_idx == query.len() {
            let is_better = match best_score {
                Some((score, _)) => current_score > *score,
                None => true,
            };
            if is_better {
                // Rimappa gli indici della sequenza minuscola sugli indici originali e deduplica
                let mut orig_indices = Vec::with_capacity(current_indices.len());
                for &idx in current_indices.iter() {
                    let orig_i = lower_to_orig[idx];
                    if orig_indices.last() != Some(&orig_i) {
                        orig_indices.push(orig_i);
                    }
                }
                *best_score = Some((current_score, orig_indices));
            }
            return;
        }

        let q_char = query[q_idx];
        let remaining_q = query.len() - q_idx;
        let remaining_t = target_lower.len() - t_idx;
        if remaining_t < remaining_q {
            return;
        }

        for i in t_idx..=target_lower.len() - remaining_q {
            if target_lower[i] == q_char {
                let mut match_score = 10i64;

                if let Some(prev) = prev_matched_idx {
                    if i == prev + 1 {
                        match_score += 20;
                    } else {
                        let dist = (i - prev - 1) as i64;
                        match_score -= dist.min(10);
                    }
                }

                if i == 0 {
                    match_score += 35;
                } else {
                    let prev_char = target_lower[i - 1];
                    let orig_idx = lower_to_orig[i];

                    if prev_char == '/'
                        || prev_char == '\\'
                        || prev_char == '.'
                        || prev_char == '_'
                        || prev_char == '-'
                        || prev_char == ' '
                    {
                        match_score += 25;
                    } else if orig_idx > 0 && orig_idx < orig_target.len() {
                        let orig_prev = orig_target[orig_idx - 1];
                        let orig_curr = orig_target[orig_idx];

                        if orig_prev.is_lowercase() && orig_curr.is_uppercase() {
                            match_score += 20;
                        }
                    }
                }

                current_indices.push(i);
                find_best(
                    target_lower,
                    orig_target,
                    lower_to_orig,
                    query,
                    i + 1,
                    q_idx + 1,
                    Some(i),
                    current_indices,
                    current_score + match_score,
                    best_score,
                    calls,
                );
                current_indices.pop();

                if *calls > 1000 {
                    break;
                }
            }
        }
    }

    let mut best_score = None;
    let mut current_indices = Vec::new();
    let mut calls = 0;

    find_best(
        &target_lower,
        &orig_target,
        &lower_to_orig,
        &query_lower,
        0,
        0,
        None,
        &mut current_indices,
        0,
        &mut best_score,
        &mut calls,
    );

    best_score
}

fn resolve_path(project_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    #[cfg(not(target_os = "windows"))]
    let clean_project_path = project_path.replace('\\', "/");
    #[cfg(target_os = "windows")]
    let clean_project_path = project_path.to_string();

    let clean_rel_path = rel_path.replace('\\', "/");

    let base = Path::new(&clean_project_path).canonicalize().map_err(|e| {
        format!(
            "Radice del progetto non valida ({}): {}",
            clean_project_path, e
        )
    })?;
    if clean_rel_path.contains('\0') {
        return Err("Il percorso relativo contiene caratteri non ammessi".to_string());
    }
    #[cfg(target_os = "windows")]
    if clean_rel_path.contains(':') {
        return Err("Il percorso relativo contiene caratteri non ammessi".to_string());
    }

    let target = if clean_rel_path.is_empty() {
        base.clone()
    } else {
        base.join(&clean_rel_path)
    };

    let resolved = match target.canonicalize() {
        Ok(path) => path,
        Err(_) => {
            let parent = target.parent().ok_or("Percorso senza cartella padre")?;
            let name = target.file_name().ok_or("Percorso senza nome file")?;
            parent
                .canonicalize()
                .map_err(|e| format!("Cartella di destinazione non valida: {}", e))?
                .join(name)
        }
    };

    if !resolved.starts_with(&base) {
        return Err("Il percorso esce dalla cartella del progetto".to_string());
    }

    Ok(resolved)
}
/// Valida un singolo nome base (file o cartella).
/// Rifiuta stringhe vuote, '.' o '..', separatori di percorso e byte NUL.
/// Su Windows rifiuta inoltre i due punti ':' per impedire prefissi drive (es. 'C:') e stream NTFS.
pub(crate) fn validate_basename(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Il nome non puo' essere vuoto".to_string());
    }
    if name == "." || name == ".." || trimmed == "." || trimmed == ".." {
        return Err("Nome non valido: '.' e '..' non sono ammessi".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(
            "Il nome non puo' contenere separatori di percorso o caratteri nulli".to_string(),
        );
    }
    #[cfg(target_os = "windows")]
    if name.contains(':') {
        return Err("Il nome non puo' contenere due punti o prefissi drive".to_string());
    }
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(comp)), None) if comp == name => {}
        _ => {
            return Err("Nome non valido: deve essere un singolo componente normale".to_string());
        }
    }
    Ok(name)
}

/// Risolve e canonizza la radice del progetto, garantendo che esista e sia valida.
pub(crate) fn canonical_project_base(project_path: &str) -> Result<PathBuf, String> {
    #[cfg(not(target_os = "windows"))]
    let clean_project_path = project_path.replace('\\', "/");
    #[cfg(target_os = "windows")]
    let clean_project_path = project_path.to_string();

    if clean_project_path.trim().is_empty() {
        return Err("Percorso del progetto non specificato".to_string());
    }

    Path::new(&clean_project_path).canonicalize().map_err(|e| {
        format!(
            "Radice del progetto non valida ({}): {}",
            clean_project_path, e
        )
    })
}

/// Risolve e canonizza la cartella genitore rispetto alla base del progetto,
/// assicurando che non esca dai confini della radice.
pub(crate) fn resolve_parent_dir(base: &Path, parent_rel: &str) -> Result<PathBuf, String> {
    if parent_rel.contains('\0') {
        return Err("Percorso relativo non valido: contiene caratteri non ammessi".to_string());
    }
    #[cfg(target_os = "windows")]
    if parent_rel.contains(':') {
        return Err("Percorso relativo non valido: contiene caratteri non ammessi".to_string());
    }
    let clean_parent = parent_rel.replace('\\', "/");
    let clean_parent = clean_parent.trim_matches('/');

    let target = if clean_parent.is_empty() || clean_parent == "." {
        base.to_path_buf()
    } else {
        for comp in Path::new(clean_parent).components() {
            match comp {
                Component::Normal(_) | Component::CurDir | Component::ParentDir => {}
                _ => return Err("Percorso relativo non valido: contiene radici o prefissi".to_string()),
            }
        }
        base.join(clean_parent)
    };

    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Cartella genitore non valida o inesistente: {}", e))?;

    if !canonical.starts_with(base) {
        return Err("Il percorso esce dalla cartella del progetto".to_string());
    }

    if !canonical.is_dir() {
        return Err("Il percorso genitore non e' una cartella".to_string());
    }

    Ok(canonical)
}

/// Suddivide un percorso relativo di un elemento esistente in (parent_rel_norm, leaf_name).
/// Rifiuta operazioni sulla radice del progetto.
pub(crate) fn split_rel_path(rel: &str) -> Result<(String, String), String> {
    if rel.contains('\0') {
        return Err("Percorso non valido: contiene caratteri non ammessi".to_string());
    }
    #[cfg(target_os = "windows")]
    if rel.contains(':') {
        return Err("Percorso non valido: contiene caratteri non ammessi".to_string());
    }
    let clean = rel.replace('\\', "/");
    let clean = clean.trim_matches('/');
    if clean.is_empty() || clean == "." {
        return Err("Operazione non consentita sulla radice del progetto".to_string());
    }

    let parts: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("Operazione non consentita sulla radice del progetto".to_string());
    }

    let leaf = parts.last().unwrap();
    validate_basename(leaf)?;

    let parent_parts = &parts[..parts.len() - 1];
    let parent_rel = parent_parts.join("/");
    Ok((parent_rel, leaf.to_string()))
}

/// Risolve un elemento esistente senza seguire symlink/junction sull'ultimo segmento (leaf),
/// in modo che operazioni di rinomina o cestinazione agiscano sul link stesso e non sulla destinazione.
pub(crate) fn resolve_existing_entry(
    project_path: &str,
    rel: &str,
    ) -> Result<(PathBuf, String, String, bool), String> {
    let base = canonical_project_base(project_path)?;
    let (parent_rel, leaf_name) = split_rel_path(rel)?;
    let parent_dir = resolve_parent_dir(&base, &parent_rel)?;
    let entry_path = parent_dir.join(&leaf_name);

    if !entry_path.starts_with(&base) || entry_path.parent() != Some(&parent_dir) {
        return Err("Il percorso esce dalla cartella del progetto".to_string());
    }

    // Leaf non seguito: verifichiamo l'esistenza dell'entry con symlink_metadata
    let _meta = fs::symlink_metadata(&entry_path)
        .map_err(|e| format!("Elemento '{}' non trovato: {}", rel, e))?;

    let is_dir = entry_path.is_dir();

    Ok((entry_path, parent_rel, leaf_name, is_dir))
}

/// Risolve la destinazione per un nuovo elemento (file o directory),
/// validando che il genitore sia dentro la radice e che non ci siano collisioni.
pub(crate) fn resolve_new_destination(
    project_path: &str,
    parent_rel: &str,
    name: &str,
) -> Result<(PathBuf, String, String), String> {
    let base = canonical_project_base(project_path)?;
    validate_basename(name)?;

    let clean_parent = parent_rel.replace('\\', "/");
    let clean_parent = clean_parent.trim_matches('/').to_string();

    let parent_dir = resolve_parent_dir(&base, &clean_parent)?;
    let dest_path = parent_dir.join(name);

    if !dest_path.starts_with(&base) || dest_path.parent() != Some(&parent_dir) {
        return Err("La destinazione esce dalla cartella del progetto".to_string());
    }

    // Collision check: rifiuta se esiste gia' file, cartella, symlink o junction
    if fs::symlink_metadata(&dest_path).is_ok() {
        return Err(format!("Un elemento con il nome '{}' esiste gia'", name));
    }

    Ok((dest_path, clean_parent, name.to_string()))
}

#[command]
pub async fn path_create_file(
    project_path: String,
    parent_rel: String,
    name: String,
) -> Result<Dirent, String> {
    let (dest_path, parent_norm, file_name) =
        resolve_new_destination(&project_path, &parent_rel, &name)?;

    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest_path)
        .map_err(|e| format!("Impossibile creare il file '{}': {}", name, e))?;

    drop(file);

    let rel_path = if parent_norm.is_empty() {
        file_name.clone()
    } else {
        format!("{}/{}", parent_norm, file_name)
    };

    Ok(Dirent {
        name: file_name,
        path: rel_path,
        is_dir: false,
    })
}

#[command]
pub async fn path_create_directory(
    project_path: String,
    parent_rel: String,
    name: String,
) -> Result<Dirent, String> {
    let (dest_path, parent_norm, dir_name) =
        resolve_new_destination(&project_path, &parent_rel, &name)?;

    fs::create_dir(&dest_path)
        .map_err(|e| format!("Impossibile creare la cartella '{}': {}", name, e))?;

    let rel_path = if parent_norm.is_empty() {
        dir_name.clone()
    } else {
        format!("{}/{}", parent_norm, dir_name)
    };

    Ok(Dirent {
        name: dir_name,
        path: rel_path,
        is_dir: true,
    })
}

/// Contatore dei nomi temporanei della rinomina in due passi: il pid da solo
/// non basta se due rinomine convivono nello stesso processo.
static RENAME_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Vero quando i due percorsi indicano lo stesso elemento sul disco. Serve a
/// distinguere `foo` -> `Foo` su filesystem case-insensitive, dove la
/// destinazione "esiste" solo perche' e' la sorgente, da una collisione reale
/// con un elemento diverso.
#[cfg(unix)]
fn is_same_entry(old_path: &Path, new_path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    // symlink_metadata e non metadata: il leaf non va seguito, altrimenti un
    // link e il suo bersaglio sembrerebbero lo stesso elemento.
    match (
        fs::symlink_metadata(old_path),
        fs::symlink_metadata(new_path),
    ) {
        (Ok(old_meta), Ok(new_meta)) => {
            old_meta.dev() == new_meta.dev() && old_meta.ino() == new_meta.ino()
        }
        _ => false,
    }
}

/// Windows non espone dev/ino sulla `Metadata` stabile. NTFS e' comunque
/// case-insensitive, quindi due nomi che differiscono solo per il case e che
/// risolvono entrambi a un elemento esistente sono lo stesso elemento.
#[cfg(not(unix))]
fn is_same_entry(old_path: &Path, new_path: &Path) -> bool {
    match (old_path.file_name(), new_path.file_name()) {
        (Some(old_name), Some(new_name)) => {
            let old_str = old_name.to_string_lossy();
            let new_str = new_name.to_string_lossy();
            (old_str.eq_ignore_ascii_case(&new_str)
                || old_str.to_lowercase() == new_str.to_lowercase())
                && fs::symlink_metadata(new_path).is_ok()
        }
        _ => false,
    }
}

/// Rinomina in due passi per il caso "stesso elemento, solo case diverso":
/// un rename diretto verso un percorso che risolve alla sorgente puo' essere
/// trattato come no-op e lasciare sul disco il nome vecchio. Passiamo da un
/// nome temporaneo unico nella stessa directory (un rename tra directory
/// diverse non sarebbe atomico) e, se il secondo passo fallisce, riportiamo
/// l'elemento al nome originale: nessun temporaneo resta sul disco.
fn rename_via_temp(old_path: &Path, new_path: &Path) -> io::Result<()> {
    let parent = old_path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "percorso senza directory"))?;

    let temp_path = loop {
        let counter = RENAME_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".omp-rename.{}.{}", std::process::id(), counter));
        if fs::symlink_metadata(&candidate).is_err() {
            break candidate;
        }
    };

    fs::rename(old_path, &temp_path)?;
    if let Err(error) = fs::rename(&temp_path, new_path) {
        // Ripristino: il nome di partenza e' preferibile a un elemento orfano
        // sotto un nome temporaneo.
        let _ = fs::rename(&temp_path, old_path);
        return Err(error);
    }

    Ok(())
}

#[command]
pub async fn path_rename(
    project_path: String,
    rel: String,
    new_name: String,
) -> Result<Dirent, String> {
    validate_basename(&new_name)?;
    let (old_path, parent_rel, old_name, is_dir) = resolve_existing_entry(&project_path, &rel)?;

    if new_name == old_name {
        let rel_path = if parent_rel.is_empty() {
            new_name.clone()
        } else {
            format!("{}/{}", parent_rel, new_name)
        };
        return Ok(Dirent {
            name: new_name,
            path: rel_path,
            is_dir,
        });
    }

    let parent_dir = old_path.parent().ok_or("Cartella genitore non trovata")?;
    let new_path = parent_dir.join(&new_name);

    let base = canonical_project_base(&project_path)?;
    if !new_path.starts_with(&base) || new_path.parent() != Some(parent_dir) {
        return Err("La destinazione della rinomina esce dalla cartella consentita".to_string());
    }

    // Su un filesystem case-insensitive (APFS, NTFS) il percorso di
    // destinazione risolve alla sorgente: la collisione e' apparente e la
    // rinomina richiesta e' proprio quella. Il confronto e' sull'identita'
    // dell'elemento, non sul nome, cosi' una collisione vera con un file
    // diverso continua a essere rifiutata.
    let is_case_only_rename = is_same_entry(&old_path, &new_path);

    if !is_case_only_rename && fs::symlink_metadata(&new_path).is_ok() {
        return Err(format!(
            "Un elemento con il nome '{}' esiste gia'",
            new_name
        ));
    }

    let outcome = if is_case_only_rename {
        rename_via_temp(&old_path, &new_path)
    } else {
        fs::rename(&old_path, &new_path)
    };

    outcome.map_err(|e| {
        format!(
            "Impossibile rinominare '{}' in '{}': {}",
            old_name, new_name, e
        )
    })?;

    let rel_path = if parent_rel.is_empty() {
        new_name.clone()
    } else {
        format!("{}/{}", parent_rel, new_name)
    };

    Ok(Dirent {
        name: new_name,
        path: rel_path,
        is_dir,
    })
}

#[command]
pub async fn path_trash(project_path: String, rel: String) -> Result<(), String> {
    let (target_path, _, _, _) = resolve_existing_entry(&project_path, &rel)?;
    trash::delete(&target_path)
        .map_err(|e| format!("Impossibile spostare nel cestino '{}': {}", rel, e))?;
    Ok(())
}

#[command]
pub async fn tree_read(project_path: String, rel: String) -> Result<Vec<Dirent>, String> {
    let target = resolve_path(&project_path, &rel)?;

    let mut entries = Vec::new();
    let dir = fs::read_dir(&target).map_err(|e| e.to_string())?;

    for entry in dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = path.is_dir();

        // Normalize path string
        let rel_p = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel, name)
        };

        entries.push(Dirent {
            name,
            path: rel_p,
            is_dir,
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[command]
pub async fn project_files_search(
    project_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    let base = canonical_project_base(&project_path)?;
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let max_results = limit.unwrap_or(100).clamp(1, 500);

    let mut collected: Vec<(String, String, bool)> = Vec::new();
    let mut stack = vec![(base.clone(), String::new())];

    while let Some((current_dir, current_rel)) = stack.pop() {
        let dir_entries = match fs::read_dir(&current_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in dir_entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };

            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = file_type.is_dir();

            if is_dir {
                if IGNORED_SEARCH_DIRS.contains(&name.as_str()) {
                    continue;
                }
                let rel = if current_rel.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", current_rel, name)
                };
                stack.push((entry.path(), rel.clone()));
                collected.push((name, rel, true));
            } else {
                let rel = if current_rel.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", current_rel, name)
                };
                collected.push((name, rel, false));
            }
        }
    }

    let query_lower = clean_query.to_lowercase();
    let has_slash = clean_query.contains('/') || clean_query.contains('\\');
    let normalized_query_slash = clean_query.replace('\\', "/").to_lowercase();

    let mut results = Vec::new();

    for (name, rel_path, is_dir) in collected {
        let name_lower = name.to_lowercase();
        let path_lower = rel_path.to_lowercase();

        let parent_offset = if rel_path.len() > name.len() {
            rel_path[..rel_path.len() - name.len()].chars().count()
        } else {
            0
        };

        let mut matched = false;
        let mut best_score = i64::MIN;
        let mut res_name_indices = Vec::new();
        let mut res_path_indices = Vec::new();

        // 1. Corrispondenza sul nome del file
        if let Some((score, indices)) = fuzzy_match_str(&name, clean_query) {
            let mut final_score = score + 100;
            if name_lower == query_lower {
                final_score += 150;
            } else if name_lower.starts_with(&query_lower) {
                final_score += 60;
            } else if name_lower.contains(&query_lower) {
                final_score += 30;
            }

            if !is_dir {
                final_score += 10;
            }

            let path_idx: Vec<usize> = indices.iter().map(|&i| i + parent_offset).collect();
            if final_score > best_score {
                best_score = final_score;
                res_name_indices = indices;
                res_path_indices = path_idx;
                matched = true;
            }
        }

        // 2. Corrispondenza sul percorso relativo completo
        let q_for_path = if has_slash {
            &normalized_query_slash
        } else {
            clean_query
        };
        if let Some((score, indices)) = fuzzy_match_str(&rel_path, q_for_path) {
            let mut final_score = score;
            if has_slash {
                final_score += 120;
            }
            if path_lower == normalized_query_slash {
                final_score += 150;
            } else if path_lower.starts_with(&normalized_query_slash) {
                final_score += 50;
            } else if path_lower.contains(&normalized_query_slash) {
                final_score += 25;
            }

            if !is_dir {
                final_score += 10;
            }

            if final_score > best_score {
                best_score = final_score;
                res_path_indices = indices.clone();
                res_name_indices = indices
                    .into_iter()
                    .filter(|&i| i >= parent_offset)
                    .map(|i| i - parent_offset)
                    .collect();
                matched = true;
            }
        }

        if matched {
            results.push(FileSearchResult {
                name,
                path: rel_path,
                is_dir,
                score: best_score,
                name_indices: res_name_indices,
                path_indices: res_path_indices,
            });
        }
    }

    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.path.len().cmp(&b.path.len()))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    results.truncate(max_results);
    Ok(results)
}

#[command]
pub async fn file_read(project_path: String, rel: String) -> Result<FileContent, String> {
    let target = resolve_path(&project_path, &rel)?;

    // Check encoding (simple fallback to UTF-8 lossy for now)
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).to_string();

    Ok(FileContent { content })
}

/// Byte grezzi di un file, senza passare da JSON: `Response` viaggia sull'IPC
/// come corpo binario, quindi il frontend riceve un ArrayBuffer da cui fare un
/// Blob. Serve alle immagini raster, che una `String::from_utf8_lossy`
/// distruggerebbe.
#[command]
pub async fn file_read_bytes(project_path: String, rel: String) -> Result<Response, String> {
    let target = resolve_path(&project_path, &rel)?;
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[command]
pub async fn file_write(project_path: String, rel: String, content: String) -> Result<(), String> {
    let target = resolve_path(&project_path, &rel)?;
    fs::write(&target, content).map_err(|e| e.to_string())?;
    Ok(())
}
#[command]
pub async fn file_git_head(project_path: String, rel: String) -> Result<GitHeadContent, String> {
    let rel_norm = rel.replace('\\', "/");
    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["show", &format!("HEAD:{}", rel_norm)]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let content = String::from_utf8_lossy(&output.stdout).to_string();
            Ok(GitHeadContent {
                content,
                exists: true,
            })
        }
        _ => Ok(GitHeadContent {
            content: String::new(),
            exists: false,
        }),
    }
}

#[command]
pub async fn project_git_status(project_path: String) -> Result<FileGitStatus, String> {
    let mut statuses = HashMap::new();

    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["status", "--porcelain", "-u", "-z"]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = match cmd.output() {
        Ok(out) if out.status.success() => out,
        _ => return Ok(FileGitStatus { statuses }),
    };

    let bytes = output.stdout;
    let parts: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();

    let mut idx = 0;
    while idx < parts.len() {
        let entry = parts[idx];
        idx += 1;
        if entry.len() < 4 {
            continue;
        }

        let x = entry[0] as char;
        let y = entry[1] as char;
        let path_str = match std::str::from_utf8(&entry[3..]) {
            Ok(s) => s.replace('\\', "/"),
            Err(_) => continue,
        };

        let status_code = match (x, y) {
            ('?', '?') => "U",
            ('U', _) | (_, 'U') => "C",
            ('A', 'A') | ('D', 'D') => "C",
            ('A', _) | (_, 'A') => "A",
            ('R', _) | (_, 'R') => {
                if idx < parts.len() {
                    idx += 1;
                }
                "R"
            }
            ('C', _) | (_, 'C') => {
                if idx < parts.len() {
                    idx += 1;
                }
                "C"
            }
            ('D', _) | (_, 'D') => "D",
            ('M', _) | (_, 'M') => "M",
            _ => "M",
        };

        statuses.insert(path_str, status_code.to_string());
    }

    Ok(FileGitStatus { statuses })
}

// ---------- Storico git ----------
//
// L'agente spesso committa al termine del lavoro: lo stato "pulito" di
// `git status` nasconde cosa e' appena cambiato. Questi comandi espongono
// l'ultimo commit e lo storico recente cosi' il pannello GIT puo' offrire
// il diff anche di quanto gia' committato, senza terminale esterno.

#[derive(Serialize)]
pub struct CommitFileEntry {
    pub path: String,
    pub status: String,
    pub insertions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub author: String,
    /// Unix seconds: `stats.db` usa millisecondi, git no. Restare in secondi.
    pub time: i64,
    pub subject: String,
    pub files: Vec<CommitFileEntry>,
}

#[derive(Serialize)]
pub struct NumStat {
    pub insertions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Serialize)]
pub struct GitRevContent {
    pub content: String,
    pub exists: bool,
}

/// Git con finestra nascosta su Windows. Ritorna None se git manca, la
/// cartella non e' un repository o il comando fallisce: il pannello degrada
/// a vuoto senza errori, come fa `project_git_status`.
fn run_git(project_path: &str, args: &[&str]) -> Option<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.current_dir(project_path);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(out.stdout)
}

/// Unisce `--name-status` e `--numstat` sulla stessa lista di path.
/// Le rinomine ("R100\tvecchio\tnuovo") vengono attribuite al nuovo nome.
fn merge_name_status_numstat(status_out: &[u8], numstat_out: &[u8]) -> Vec<CommitFileEntry> {
    use std::collections::BTreeMap;
    let mut files: BTreeMap<String, (String, Option<u32>, Option<u32>)> = BTreeMap::new();

    for line in String::from_utf8_lossy(status_out).lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let raw_status = parts.next().unwrap_or("M");
        let status = raw_status.chars().next().unwrap_or('M').to_string();
        let path = match (parts.next(), parts.next()) {
            (_, Some(new_path)) => new_path,
            (Some(old_only), None) => old_only,
            _ => continue,
        };
        files.insert(path.replace('\\', "/"), (status, None, None));
    }

    for line in String::from_utf8_lossy(numstat_out).lines() {
        let mut parts = line.splitn(3, '\t');
        let (ins, del, path) = (parts.next(), parts.next(), parts.next());
        if let Some(p) = path {
            if let Some(entry) = files.get_mut(&p.replace('\\', "/")) {
                entry.1 = ins.and_then(|s| s.parse().ok());
                entry.2 = del.and_then(|s| s.parse().ok());
            }
        }
    }

    files
        .into_iter()
        .map(|(path, (status, insertions, deletions))| CommitFileEntry {
            path,
            status,
            insertions,
            deletions,
        })
        .collect()
}

#[command]
pub async fn git_last_commit(project_path: String) -> Result<Option<CommitInfo>, String> {
    let sep = '\u{1f}';
    let fmt = format!("%H{sep}%h{sep}%an{sep}%at{sep}%s");
    let Some(out) = run_git(
        &project_path,
        &["log", "-1", &format!("--pretty=format:{fmt}")],
    ) else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(&out).to_string();
    let parts: Vec<&str> = text.split(sep).collect();
    if parts.len() < 5 || parts[0].is_empty() {
        return Ok(None);
    }
    let hash = parts[0].to_string();
    let status = run_git(
        &project_path,
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            &hash,
        ],
    )
    .unwrap_or_default();
    let numstat = run_git(
        &project_path,
        &[
            "diff-tree",
            "--no-commit-id",
            "--numstat",
            "-r",
            "-M",
            &hash,
        ],
    )
    .unwrap_or_default();
    Ok(Some(CommitInfo {
        short: parts[1].to_string(),
        author: parts[2].to_string(),
        time: parts[3].parse().unwrap_or(0),
        subject: parts[4].to_string(),
        files: merge_name_status_numstat(&status, &numstat),
        hash,
    }))
}

#[command]
pub async fn git_recent_commits(
    project_path: String,
    limit: Option<u32>,
) -> Result<Vec<CommitInfo>, String> {
    let n = limit.unwrap_or(10).clamp(1, 50);
    let sep = '\u{1f}';
    let rec = '\u{1e}';
    let fmt = format!("{rec}%H{sep}%h{sep}%an{sep}%at{sep}%s");
    let Some(out) = run_git(
        &project_path,
        &[
            "log",
            &format!("-n{n}"),
            &format!("--pretty=format:{fmt}"),
            "--name-status",
            "-M",
        ],
    ) else {
        return Ok(Vec::new());
    };

    let mut commits = Vec::new();
    for record in String::from_utf8_lossy(&out).split(rec) {
        if record.trim().is_empty() {
            continue;
        }
        let mut lines = record.lines();
        let header = lines.next().unwrap_or("");
        let hp: Vec<&str> = header.split(sep).collect();
        if hp.len() < 5 || hp[0].is_empty() {
            continue;
        }
        let mut files = Vec::new();
        for line in lines {
            if line.trim().is_empty() {
                continue;
            }
            let mut parts = line.splitn(3, '\t');
            let raw_status = parts.next().unwrap_or("M");
            let status = raw_status.chars().next().unwrap_or('M').to_string();
            let path = match (parts.next(), parts.next()) {
                (_, Some(new_path)) => new_path,
                (Some(old_only), None) => old_only,
                _ => continue,
            };
            files.push(CommitFileEntry {
                path: path.replace('\\', "/"),
                status,
                insertions: None,
                deletions: None,
            });
        }
        commits.push(CommitInfo {
            hash: hp[0].to_string(),
            short: hp[1].to_string(),
            author: hp[2].to_string(),
            time: hp[3].parse().unwrap_or(0),
            subject: hp[4].to_string(),
            files,
        });
    }
    Ok(commits)
}

#[command]
pub async fn git_current_branch(project_path: String) -> Result<String, String> {
    Ok(
        run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"])
            .map(|b| String::from_utf8_lossy(&b).trim().to_string())
            .unwrap_or_default(),
    )
}

#[command]
pub async fn git_working_numstat(project_path: String) -> Result<HashMap<String, NumStat>, String> {
    let Some(out) = run_git(&project_path, &["diff", "HEAD", "--numstat", "-M"]) else {
        return Ok(HashMap::new());
    };
    let mut map = HashMap::new();
    for line in String::from_utf8_lossy(&out).lines() {
        let mut parts = line.splitn(3, '\t');
        let (ins, del, path) = (parts.next(), parts.next(), parts.next());
        if let Some(p) = path {
            map.insert(
                p.replace('\\', "/"),
                NumStat {
                    insertions: ins.and_then(|s| s.parse().ok()),
                    deletions: del.and_then(|s| s.parse().ok()),
                },
            );
        }
    }
    Ok(map)
}

/// Contenuto di un file a una revisione arbitraria ("HEAD~1", hash, ...).
/// Serve al diff dei commit: l'originale e' `<hash>~1`, il modificato e'
/// `<hash>`. Il blocco `..` e' una difesa in piu' rispetto a `file_git_head`.
#[command]
pub async fn file_git_rev(
    project_path: String,
    rel: String,
    rev: String,
) -> Result<GitRevContent, String> {
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("Percorso non valido".to_string());
    }
    let rel_norm = rel.replace('\\', "/");
    let spec = format!("{rev}:{rel_norm}");
    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["show", &spec]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    match cmd.output() {
        Ok(output) if output.status.success() => Ok(GitRevContent {
            content: String::from_utf8_lossy(&output.stdout).to_string(),
            exists: true,
        }),
        _ => Ok(GitRevContent {
            content: String::new(),
            exists: false,
        }),
    }
}

#[derive(Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

/// Elenco dei branch locali. `current` marca quello attivo.
#[command]
pub async fn git_branch_list(project_path: String) -> Result<Vec<GitBranch>, String> {
    let Some(out) = run_git(
        &project_path,
        &["branch", "--list", "--format=%(HEAD)%00%(refname:short)"],
    ) else {
        return Ok(Vec::new());
    };
    let mut branches = Vec::new();
    for line in String::from_utf8_lossy(&out).lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, '\u{0}');
        let head = parts.next().unwrap_or(" ");
        let name = parts.next().unwrap_or("").trim().to_string();
        if name.is_empty() {
            continue;
        }
        branches.push(GitBranch {
            current: head == "*",
            name,
        });
    }
    Ok(branches)
}

/// Checkout di un branch esistente. Rifiuta se ci sono modifiche non
/// committate: l'agente potrebbe stare lavorando e un checkout le
/// mescolerebbe con il branch di destinazione.
#[command]
pub async fn git_branch_checkout(project_path: String, name: String) -> Result<(), String> {
    let status = project_git_status(project_path.clone()).await?;
    if !status.statuses.is_empty() {
        return Err(
            "Ci sono modifiche non committate: committale o scartale prima di cambiare branch"
                .to_string(),
        );
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["checkout", &name]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Crea un branch e ci si sposta sopra (`git checkout -b`).
#[command]
pub async fn git_branch_create(project_path: String, name: String) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains("..") || trimmed.starts_with('-') {
        return Err("Nome di branch non valido".to_string());
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["checkout", "-b", trimmed]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Unisce `name` nel branch corrente (`git merge --no-ff`). Nessun rebase:
/// il merge commit preserva la storia del lavoro dell'agente.
#[command]
pub async fn git_branch_merge(project_path: String, name: String) -> Result<String, String> {
    let status = project_git_status(project_path.clone()).await?;
    if !status.statuses.is_empty() {
        return Err("Ci sono modifiche non committate: committale prima di fare merge".to_string());
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(&project_path);
    cmd.args(["merge", "--no-ff", &name]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        // Conflitto: git lascia il repo in merge parziale. L'utente risolve
        // a mano; qui si segnala senza nascondere nulla.
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(stdout)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ResolvedFile {
    pub rel_path: String,
    pub line: Option<usize>,
}

fn parse_candidate(raw: &str) -> (String, Option<usize>) {
    let mut s = raw.trim();

    while (s.starts_with('`') && s.ends_with('`'))
        || (s.starts_with('"') && s.ends_with('"'))
        || (s.starts_with('\'') && s.ends_with('\''))
        || (s.starts_with('[') && s.ends_with(']'))
        || (s.starts_with('(') && s.ends_with(')'))
        || (s.starts_with('<') && s.ends_with('>'))
    {
        if s.len() >= 2 {
            s = s[1..s.len() - 1].trim();
        } else {
            break;
        }
    }

    if let Some(rest) = s.strip_prefix("file:///") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("file://") {
        s = rest;
    }

    s = s.trim_end_matches(|c: char| {
        matches!(
            c,
            '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '>' | '\'' | '"' | '`'
        )
    });

    let mut line: Option<usize> = None;
    let mut path_part = s.to_string();

    if let Some(hash_idx) = path_part.rfind('#') {
        let after_hash = &path_part[hash_idx + 1..];
        if let Some(colon_idx) = after_hash.find(':') {
            let line_str = &after_hash[colon_idx + 1..];
            let num_str = line_str
                .split('-')
                .next()
                .unwrap_or(line_str)
                .split(':')
                .next()
                .unwrap_or(line_str);
            if let Ok(n) = num_str.parse::<usize>() {
                if n > 0 {
                    line = Some(n);
                }
            }
        } else if let Some(line_str) = after_hash.strip_prefix('L') {
            if let Ok(n) = line_str.parse::<usize>() {
                if n > 0 {
                    line = Some(n);
                }
            }
        } else if let Ok(n) = after_hash.parse::<usize>() {
            if n > 0 {
                line = Some(n);
            }
        }
        path_part.truncate(hash_idx);
    }

    if line.is_none() {
        if let Some(colon_idx) = path_part.rfind(':') {
            let after_colon = &path_part[colon_idx + 1..];
            let num_candidate = after_colon.split('-').next().unwrap_or(after_colon);
            if let Ok(n) = num_candidate.parse::<usize>() {
                if n > 0 {
                    line = Some(n);
                    let remainder = &path_part[..colon_idx];
                    if let Some(prev_colon) = remainder.rfind(':') {
                        let prev_after = &remainder[prev_colon + 1..];
                        if let Ok(prev_n) = prev_after.parse::<usize>() {
                            if prev_n > 0 {
                                line = Some(prev_n);
                                path_part = remainder[..prev_colon].to_string();
                            } else {
                                path_part = remainder.to_string();
                            }
                        } else {
                            path_part = remainder.to_string();
                        }
                    } else {
                        path_part = remainder.to_string();
                    }
                }
            }
        }
    }

    if line.is_none() {
        if let Some(paren_idx) = path_part.rfind('(') {
            if path_part.ends_with(')') {
                let inside = &path_part[paren_idx + 1..path_part.len() - 1];
                let num_str = inside.split(',').next().unwrap_or(inside).trim();
                if let Ok(n) = num_str.parse::<usize>() {
                    if n > 0 {
                        line = Some(n);
                        path_part.truncate(paren_idx);
                    }
                }
            }
        }
    }

    (path_part, line)
}

/// Contenuto di un file del progetto per l'anteprima nella sandbox.
/// Il frontend lo inietta in un iframe sandbox via `srcdoc`: per i vettoriali SVG
/// l'iframe e' rigorosamente sandboxed senza 'allow-scripts' e senza 'allow-same-origin',
/// con CSP ermetica (default-src 'none') per isolare completamente il rendering
/// dal contesto WebView privilegiato di Tauri (nessun accesso a IPC, store o filesystem).
#[command]
pub async fn preview_file(project_path: String, rel: String) -> Result<GitRevContent, String> {
    let resolved = resolve_path(&project_path, &rel)?;
    if !resolved.is_file() {
        return Ok(GitRevContent {
            content: String::new(),
            exists: false,
        });
    }
    let bytes = fs::read(&resolved).map_err(|e| e.to_string())?;
    Ok(GitRevContent {
        content: String::from_utf8_lossy(&bytes).to_string(),
        exists: true,
    })
}

fn find_file_in_dir(dir: &Path, target_name: &str, depth: usize) -> Option<PathBuf> {
    if depth > 8 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !matches!(
                name.as_str(),
                "node_modules"
                    | ".git"
                    | "target"
                    | "bin"
                    | "obj"
                    | ".vs"
                    | ".svelte-kit"
                    | "dist"
                    | "build"
                    | ".next"
                    | ".nuxt"
            ) {
                subdirs.push(path);
            }
        } else if path.is_file() && name.eq_ignore_ascii_case(target_name) {
            return Some(path);
        }
    }

    for subdir in subdirs {
        if let Some(found) = find_file_in_dir(&subdir, target_name, depth + 1) {
            return Some(found);
        }
    }

    None
}

pub fn resolve_project_file_sync(
    project_path: &str,
    candidate: &str,
) -> Result<Option<ResolvedFile>, String> {
    if project_path.trim().is_empty() || candidate.trim().is_empty() {
        return Ok(None);
    }

    #[cfg(not(target_os = "windows"))]
    let clean_project_path = project_path.replace('\\', "/");
    #[cfg(target_os = "windows")]
    let clean_project_path = project_path.to_string();

    let base = match Path::new(&clean_project_path).canonicalize() {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };

    let (mut raw_path, line) = parse_candidate(candidate);
    raw_path = raw_path.trim().replace('\\', "/");

    #[cfg(target_os = "windows")]
    if raw_path.starts_with('/') && raw_path.len() >= 3 && raw_path.chars().nth(2) == Some(':') {
        raw_path.remove(0);
    }

    while raw_path.starts_with("./") {
        raw_path = raw_path[2..].to_string();
    }

    if raw_path.is_empty()
        || raw_path.contains('\0')
        || raw_path.starts_with("http://")
        || raw_path.starts_with("https://")
    {
        return Ok(None);
    }

    let candidates_to_try =
        if (raw_path.starts_with("a/") || raw_path.starts_with("b/")) && raw_path.len() > 2 {
            vec![raw_path.clone(), raw_path[2..].to_string()]
        } else {
            vec![raw_path.clone()]
        };

    for path_str in &candidates_to_try {
        let p = Path::new(path_str);
        let target = if p.is_absolute() {
            p.to_path_buf()
        } else {
            base.join(path_str)
        };

        if let Ok(canon) = target.canonicalize() {
            if canon.starts_with(&base) && canon.is_file() {
                if let Ok(rel) = canon.strip_prefix(&base) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    return Ok(Some(ResolvedFile {
                        rel_path: rel_str,
                        line,
                    }));
                }
            }
        }
    }

    if !raw_path.contains('/') {
        if let Some(found) = find_file_in_dir(&base, &raw_path, 0) {
            if let Ok(canon) = found.canonicalize() {
                if canon.starts_with(&base) && canon.is_file() {
                    if let Ok(rel) = canon.strip_prefix(&base) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        return Ok(Some(ResolvedFile {
                            rel_path: rel_str,
                            line,
                        }));
                    }
                }
            }
        }
    }

    Ok(None)
}

#[command]
pub async fn resolve_project_file(
    project_path: String,
    candidate: String,
) -> Result<Option<ResolvedFile>, String> {
    tokio::task::spawn_blocking(move || resolve_project_file_sync(&project_path, &candidate))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        file_git_rev, fuzzy_match_str, git_last_commit, git_recent_commits,
        merge_name_status_numstat, path_create_directory, path_create_file, path_rename,
        project_files_search, rename_via_temp, resolve_existing_entry, resolve_new_destination,
        resolve_parent_dir, resolve_path, resolve_project_file_sync, split_rel_path,
        validate_basename, Dirent,
    };
    use std::fs;
    #[cfg(windows)]
    use std::process::Command;

    /// Crea una cartella temporanea vuota e ne restituisce il percorso.
    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("omp-studio-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accetta_un_file_dentro_la_radice() {
        let root = temp_dir("dentro");
        fs::write(root.join("file.txt"), "x").unwrap();

        let resolved = resolve_path(root.to_str().unwrap(), "file.txt").unwrap();

        assert!(resolved.ends_with("file.txt"));
        assert!(resolved.starts_with(root.canonicalize().unwrap()));
    }

    #[test]
    fn accetta_un_file_non_ancora_esistente() {
        let root = temp_dir("nuovo");
        fs::create_dir(root.join("sub")).unwrap();

        let resolved = resolve_path(root.to_str().unwrap(), "sub/nuovo.txt").unwrap();

        assert!(resolved.ends_with("nuovo.txt"));
        assert!(resolved.starts_with(root.canonicalize().unwrap()));
    }

    #[test]
    fn rifiuta_la_risalita_fuori_dalla_radice() {
        let root = temp_dir("risalita");

        assert!(resolve_path(
            root.to_str().unwrap(),
            "../../windows/system32/drivers/etc/hosts"
        )
        .is_err());
    }

    /// Il caso che il conteggio dei componenti non vedeva: un collegamento dentro la
    /// radice che punta fuori. Su Windows si usa una junction, che non richiede
    /// privilegi ed e' il caso che si incontra davvero nei repository.
    #[test]
    fn rifiuta_un_collegamento_che_punta_fuori() {
        let root = temp_dir("link-radice");
        let fuori = temp_dir("link-fuori");
        fs::write(fuori.join("segreto.txt"), "x").unwrap();
        let dentro = root.join("scorciatoia");

        #[cfg(windows)]
        let creato = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&dentro)
            .arg(&fuori)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        #[cfg(not(windows))]
        let creato = std::os::unix::fs::symlink(&fuori, &dentro).is_ok();

        assert!(creato, "impossibile creare il collegamento di prova");
        assert!(
            dentro.join("segreto.txt").exists(),
            "il collegamento non attraversa"
        );

        assert!(resolve_path(root.to_str().unwrap(), "scorciatoia/segreto.txt").is_err());
    }

    #[test]
    fn risolve_file_con_formati_diversi() {
        let root = temp_dir("risolvi");
        fs::create_dir_all(root.join("src/lib")).unwrap();
        fs::write(root.join("AGENTS.md"), "test").unwrap();
        fs::write(root.join("src/lib/Editor.svelte"), "test").unwrap();

        let root_str = root.to_str().unwrap();

        // Percorso relativo esatto
        let r1 = resolve_project_file_sync(root_str, "AGENTS.md")
            .unwrap()
            .unwrap();
        assert_eq!(r1.rel_path, "AGENTS.md");
        assert_eq!(r1.line, None);

        // Case insensitive su nome file
        let r2 = resolve_project_file_sync(root_str, "agents.md")
            .unwrap()
            .unwrap();
        assert_eq!(r2.rel_path, "AGENTS.md");

        // Con numero di riga
        let r3 = resolve_project_file_sync(root_str, "src/lib/Editor.svelte:75")
            .unwrap()
            .unwrap();
        assert_eq!(r3.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r3.line, Some(75));

        // Con riga e colonna
        let r4 = resolve_project_file_sync(root_str, "src/lib/Editor.svelte:75:10")
            .unwrap()
            .unwrap();
        assert_eq!(r4.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r4.line, Some(75));

        // Con formato snapshot tool header
        let r5 = resolve_project_file_sync(root_str, "[src/lib/Editor.svelte#A44A:42-80]")
            .unwrap()
            .unwrap();
        assert_eq!(r5.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r5.line, Some(42));

        // Con formato git diff
        let r6 = resolve_project_file_sync(root_str, "b/src/lib/Editor.svelte")
            .unwrap()
            .unwrap();
        assert_eq!(r6.rel_path, "src/lib/Editor.svelte");

        // Ricerca automatica di nome file isolato in sottocartella
        let r7 = resolve_project_file_sync(root_str, "Editor.svelte")
            .unwrap()
            .unwrap();
        assert_eq!(r7.rel_path, "src/lib/Editor.svelte");

        // Con punteggiatura finale
        let r8 = resolve_project_file_sync(root_str, "agents.md.")
            .unwrap()
            .unwrap();
        assert_eq!(r8.rel_path, "AGENTS.md");

        // Con virgolette o backtick
        let r9 = resolve_project_file_sync(root_str, "`AGENTS.md`")
            .unwrap()
            .unwrap();
        assert_eq!(r9.rel_path, "AGENTS.md");
    }

    #[test]
    fn unisce_name_status_e_numstat_sugli_stessi_path() {
        let status = b"M\tsrc/a.rs\nA\tsrc/b.rs\nR90\told.txt\tnew.txt\n";
        let numstat = b"12\t3\tsrc/a.rs\n0\t0\tsrc/b.rs\n5\t1\tnew.txt\n";

        let files = merge_name_status_numstat(status, numstat);

        assert_eq!(files.len(), 3);
        let a = files.iter().find(|f| f.path == "src/a.rs").unwrap();
        assert_eq!(a.status, "M");
        assert_eq!(a.insertions, Some(12));
        assert_eq!(a.deletions, Some(3));
        let r = files.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(r.status, "R");
        assert_eq!(r.insertions, Some(5));
    }

    #[test]
    fn numstat_binario_restata_none() {
        let status = b"M\tbin.dat\n";
        let numstat = b"-\t-\tbin.dat\n";

        let files = merge_name_status_numstat(status, numstat);

        assert_eq!(files[0].insertions, None);
        assert_eq!(files[0].deletions, None);
    }

    /// Il pannello GIT vive di questi comandi: su un repository reale
    /// (questo) devono restituire l'ultimo commit e i file toccati.
    #[test]
    fn last_commit_su_repository_reale() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let commit = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(git_last_commit(repo.to_string()))
            .unwrap();
        let c = commit.expect("il repository ha almeno un commit");
        assert_eq!(c.hash.len(), 40);
        assert!(!c.subject.is_empty());
        // L'ultimo commit e' una release: tocca CHANGELOG e i file versione.
        assert!(!c.files.is_empty());
    }

    #[test]
    fn recent_commits_limita_e_ordina() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let commits = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(git_recent_commits(repo.to_string(), Some(3)))
            .unwrap();
        assert!(commits.len() <= 3);
        for w in commits.windows(2) {
            assert!(w[0].time >= w[1].time, "i commit non sono in ordine");
        }
    }

    #[test]
    fn file_git_rev_legge_head_e_rifiuta_traversal() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let ok = rt
            .block_on(file_git_rev(
                repo.to_string(),
                "src-tauri/Cargo.toml".to_string(),
                "HEAD".to_string(),
            ))
            .unwrap();
        assert!(ok.exists);
        assert!(ok.content.contains("[package]"));

        let bad = rt.block_on(file_git_rev(
            repo.to_string(),
            "../fuori.toml".to_string(),
            "HEAD".to_string(),
        ));
        assert!(bad.is_err());
    }

    #[test]
    fn basename_validazione() {
        assert!(validate_basename("file.txt").is_ok());
        assert!(validate_basename("my-dir_123").is_ok());
        assert!(validate_basename("file with spaces.png").is_ok());
        assert!(validate_basename("İtem.txt").is_ok());

        assert!(validate_basename("").is_err());
        assert!(validate_basename("   ").is_err());
        assert!(validate_basename(".").is_err());
        assert!(validate_basename("..").is_err());
        assert!(validate_basename(" . ").is_err());
        assert!(validate_basename(" .. ").is_err());
        assert!(validate_basename("a/b").is_err());
        assert!(validate_basename("a\\b").is_err());
        assert!(validate_basename("name\0bad").is_err());

        #[cfg(windows)]
        {
            assert!(validate_basename("C:evil.txt").is_err());
            assert!(validate_basename("D:").is_err());
            assert!(validate_basename("file:stream").is_err());
            assert!(validate_basename("foo:bar").is_err());
        }

        #[cfg(not(windows))]
        {
            assert!(validate_basename("file:meta").is_ok());
            assert!(validate_basename("foo:bar").is_ok());
        }
    }

    #[test]
    fn creazione_file_e_collisione() {
        let root = temp_dir("create-file");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let root_str = root.to_str().unwrap().to_string();

        // Creazione file in radice
        let d1 = rt
            .block_on(path_create_file(
                root_str.clone(),
                "".to_string(),
                "nuovo.txt".to_string(),
            ))
            .unwrap();
        assert_eq!(d1.name, "nuovo.txt");
        assert_eq!(d1.path, "nuovo.txt");
        assert!(!d1.is_dir);
        assert!(root.join("nuovo.txt").is_file());

        // Creazione in sottocartella
        fs::create_dir(root.join("sub")).unwrap();
        let d2 = rt
            .block_on(path_create_file(
                root_str.clone(),
                "sub".to_string(),
                "nested.txt".to_string(),
            ))
            .unwrap();
        assert_eq!(d2.name, "nested.txt");
        assert_eq!(d2.path, "sub/nested.txt");
        assert!(!d2.is_dir);
        assert!(root.join("sub/nested.txt").is_file());

        // Collisione: tentare di ricreare lo stesso file deve fallire
        let err_coll = rt.block_on(path_create_file(
            root_str.clone(),
            "".to_string(),
            "nuovo.txt".to_string(),
        ));
        assert!(err_coll.is_err());

        // Traversal nel genitore deve fallire
        let err_trav = rt.block_on(path_create_file(
            root_str,
            "../../fuori".to_string(),
            "hacked.txt".to_string(),
        ));
        assert!(err_trav.is_err());
    }

    #[test]
    fn creazione_cartella_singolo_livello() {
        let root = temp_dir("create-dir");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let root_str = root.to_str().unwrap().to_string();

        // Creazione cartella in radice
        let d1 = rt
            .block_on(path_create_directory(
                root_str.clone(),
                "".to_string(),
                "assets".to_string(),
            ))
            .unwrap();
        assert_eq!(d1.name, "assets");
        assert_eq!(d1.path, "assets");
        assert!(d1.is_dir);
        assert!(root.join("assets").is_dir());

        // Collisione con cartella esistente
        let err_coll = rt.block_on(path_create_directory(
            root_str.clone(),
            "".to_string(),
            "assets".to_string(),
        ));
        assert!(err_coll.is_err());

        // Singolo livello: creazione sotto genitore inesistente fallisce
        let err_nonexistent_parent = rt.block_on(path_create_directory(
            root_str,
            "inesistente/path".to_string(),
            "child".to_string(),
        ));
        assert!(err_nonexistent_parent.is_err());
    }

    #[test]
    fn rinomina_file_e_cartella() {
        let root = temp_dir("rename");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let root_str = root.to_str().unwrap().to_string();

        fs::write(root.join("vecchio.txt"), "dati").unwrap();
        fs::create_dir_all(root.join("sub/old_dir")).unwrap();

        // Rinomina file in radice
        let d1 = rt
            .block_on(path_rename(
                root_str.clone(),
                "vecchio.txt".to_string(),
                "nuovo.txt".to_string(),
            ))
            .unwrap();
        assert_eq!(d1.name, "nuovo.txt");
        assert_eq!(d1.path, "nuovo.txt");
        assert!(!d1.is_dir);
        assert!(!root.join("vecchio.txt").exists());
        assert!(root.join("nuovo.txt").is_file());

        // Rinomina cartella annidata
        let d2 = rt
            .block_on(path_rename(
                root_str.clone(),
                "sub/old_dir".to_string(),
                "new_dir".to_string(),
            ))
            .unwrap();
        assert_eq!(d2.name, "new_dir");
        assert_eq!(d2.path, "sub/new_dir");
        assert!(d2.is_dir);
        assert!(!root.join("sub/old_dir").exists());
        assert!(root.join("sub/new_dir").is_dir());

        // Collisione su rinomina
        fs::write(root.join("esiste.txt"), "e").unwrap();
        let err_coll = rt.block_on(path_rename(
            root_str.clone(),
            "nuovo.txt".to_string(),
            "esiste.txt".to_string(),
        ));
        assert!(err_coll.is_err());

        // Rinomina della radice vietata
        let err_root = rt.block_on(path_rename(
            root_str,
            "".to_string(),
            "altra_radice".to_string(),
        ));
        assert!(err_root.is_err());
    }

    /// Nomi dei residui della rinomina in due passi presenti in una directory.
    fn residui_rinomina(dir: &std::path::Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with(".omp-rename."))
            .collect()
    }

    /// Nomi effettivamente presenti sul disco, ordinati. Su un filesystem
    /// case-insensitive `exists()` non distingue `foo` da `Foo`: solo la
    /// lettura della directory dice quale nome e' stato registrato.
    fn nomi_su_disco(dir: &std::path::Path) -> Vec<String> {
        let mut nomi: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        nomi.sort();
        nomi
    }

    /// Messaggio d'errore di una rinomina che deve fallire. Evita
    /// `unwrap_err`, che pretenderebbe `Debug` su `Dirent`: un tipo di
    /// produzione non deve derivare tratti solo per i test.
    fn errore_di(esito: Result<Dirent, String>) -> String {
        match esito {
            Ok(dirent) => panic!("rinomina riuscita inattesa su '{}'", dirent.path),
            Err(errore) => errore,
        }
    }

    /// S21: su APFS e NTFS la destinazione con case diverso risolve alla
    /// sorgente. La rinomina deve comunque cambiare il nome sul disco, senza
    /// lasciare temporanei.
    #[test]
    fn rinomina_solo_di_case() {
        let root = temp_dir("rename-case");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let root_str = root.to_str().unwrap().to_string();

        fs::write(root.join("appunti.txt"), "dati").unwrap();
        fs::create_dir(root.join("componenti")).unwrap();
        fs::write(root.join("componenti/interno.txt"), "figlio").unwrap();

        let d1 = rt
            .block_on(path_rename(
                root_str.clone(),
                "appunti.txt".to_string(),
                "Appunti.txt".to_string(),
            ))
            .unwrap();
        assert_eq!(d1.name, "Appunti.txt");
        assert_eq!(d1.path, "Appunti.txt");
        assert!(!d1.is_dir);

        let d2 = rt
            .block_on(path_rename(
                root_str,
                "componenti".to_string(),
                "Componenti".to_string(),
            ))
            .unwrap();
        assert_eq!(d2.name, "Componenti");
        assert!(d2.is_dir);

        assert_eq!(
            nomi_su_disco(&root),
            vec!["Appunti.txt".to_string(), "Componenti".to_string()]
        );
        assert_eq!(
            fs::read_to_string(root.join("Appunti.txt")).unwrap(),
            "dati"
        );
        // La cartella e' stata rinominata, non ricreata: il figlio c'e' ancora
        assert_eq!(
            fs::read_to_string(root.join("Componenti/interno.txt")).unwrap(),
            "figlio"
        );
        assert!(residui_rinomina(&root).is_empty());
    }

    /// S21: il rilassamento della collisione vale solo per lo stesso elemento.
    /// Un nome diverso, o un nome che differisce solo per il case su un
    /// filesystem case-sensitive, resta un errore e non tocca nulla.
    #[test]
    fn collisione_reale_rifiutata_su_rinomina() {
        let root = temp_dir("rename-collisione");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let root_str = root.to_str().unwrap().to_string();

        fs::write(root.join("uno.txt"), "1").unwrap();
        fs::write(root.join("due.txt"), "2").unwrap();

        let err = errore_di(rt.block_on(path_rename(
            root_str.clone(),
            "uno.txt".to_string(),
            "due.txt".to_string(),
        )));
        assert!(err.contains("esiste gia'"), "errore inatteso: {}", err);
        assert_eq!(fs::read_to_string(root.join("uno.txt")).unwrap(), "1");
        assert_eq!(fs::read_to_string(root.join("due.txt")).unwrap(), "2");
        assert!(residui_rinomina(&root).is_empty());

        // Su un filesystem case-sensitive due nomi che differiscono solo per
        // il case sono elementi distinti: la rinomina resta una collisione.
        fs::write(root.join("sonda"), "s").unwrap();
        let case_sensitive = fs::read_to_string(root.join("SONDA")).is_err();
        if case_sensitive {
            fs::write(root.join("TRE.txt"), "3").unwrap();
            fs::write(root.join("tre.txt"), "4").unwrap();

            let err_case = errore_di(rt.block_on(path_rename(
                root_str,
                "tre.txt".to_string(),
                "TRE.txt".to_string(),
            )));
            assert!(
                err_case.contains("esiste gia'"),
                "errore inatteso: {}",
                err_case
            );
            assert_eq!(fs::read_to_string(root.join("TRE.txt")).unwrap(), "3");
            assert_eq!(fs::read_to_string(root.join("tre.txt")).unwrap(), "4");
        }
    }

    /// S21: se il secondo passo della rinomina in due passi fallisce,
    /// l'elemento torna al nome originale e la directory resta pulita.
    /// Su POSIX `rename` di un file su una directory esistente non riesce:
    /// e' il modo piu' diretto per far fallire il secondo passo.
    #[test]
    fn rinomina_in_due_passi_ripristina_dopo_un_errore() {
        let root = temp_dir("rename-ripristino");
        let sorgente = root.join("file.txt");
        let destinazione = root.join("ostacolo");
        fs::write(&sorgente, "dati").unwrap();
        fs::create_dir(&destinazione).unwrap();
        fs::write(destinazione.join("dentro.txt"), "x").unwrap();

        let errore = rename_via_temp(&sorgente, &destinazione).unwrap_err();

        assert!(
            errore.raw_os_error().is_some(),
            "errore inatteso: {}",
            errore
        );
        assert_eq!(fs::read_to_string(&sorgente).unwrap(), "dati");
        assert!(destinazione.join("dentro.txt").is_file());
        assert!(
            residui_rinomina(&root).is_empty(),
            "temporaneo rimasto: {:?}",
            residui_rinomina(&root)
        );
    }

    #[test]
    fn radice_e_traversal_protetti() {
        let root = temp_dir("root-prot");
        let root_str = root.to_str().unwrap();

        assert!(split_rel_path("").is_err());
        assert!(split_rel_path(".").is_err());
        assert!(split_rel_path("/").is_err());
        assert!(resolve_existing_entry(root_str, "").is_err());
        assert!(resolve_existing_entry(root_str, ".").is_err());

        assert!(resolve_new_destination(root_str, "../..", "evil.txt").is_err());
        assert!(resolve_new_destination(root_str, "sub/../../fuori", "evil.txt").is_err());
    }

    #[test]
    fn symlink_e_junction_leaf_non_seguito() {
        let root = temp_dir("link-leaf");
        let fuori = temp_dir("link-fuori-dest");
        fs::write(fuori.join("segreto.txt"), "contenuto protetto").unwrap();
        let dentro_link = root.join("collegamento");

        #[cfg(windows)]
        let creato = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&dentro_link)
            .arg(&fuori)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        #[cfg(not(windows))]
        let creato = std::os::unix::fs::symlink(&fuori, &dentro_link).is_ok();

        assert!(creato, "impossibile creare il collegamento per il test");

        let root_str = root.to_str().unwrap();

        // Risoluzione dell'entry del link: punta al link dentro il workspace, NON al target fuori
        let (entry_path, parent_rel, leaf_name, _is_dir) =
            resolve_existing_entry(root_str, "collegamento").unwrap();
        assert_eq!(leaf_name, "collegamento");
        assert_eq!(parent_rel, "");
        assert_eq!(
            entry_path,
            root.canonicalize().unwrap().join("collegamento")
        );

        // Rinomina del link: deve rinominare il collegamento senza toccare o spostare la cartella esterna
        let rt = tokio::runtime::Runtime::new().unwrap();
        let d = rt
            .block_on(path_rename(
                root_str.to_string(),
                "collegamento".to_string(),
                "collegamento_rinominato".to_string(),
            ))
            .unwrap();
        assert_eq!(d.name, "collegamento_rinominato");
        assert!(root.join("collegamento_rinominato").exists());
        assert!(!root.join("collegamento").exists());
        // La cartella esterna e il suo file rimangono intatti
        assert!(fuori.join("segreto.txt").exists());

        // Attraversamento oltre il link verso l'esterno: viene bloccato perche' il genitore esce da base
        assert!(resolve_existing_entry(root_str, "collegamento_rinominato/segreto.txt").is_err());
    }
    #[test]
    fn fuzzy_match_ranking_e_boundaries() {
        let res1 = fuzzy_match_str("FileTree.svelte", "ftr");
        assert!(res1.is_some());
        let (score1, indices1) = res1.unwrap();
        assert_eq!(indices1, vec![0, 4, 5]); // F, T, r
        assert!(score1 > 0);

        let res2 = fuzzy_match_str("format_tree.ts", "ftr");
        assert!(res2.is_some());
        let (_, indices2) = res2.unwrap();
        assert_eq!(indices2, vec![0, 7, 8]); // f, t, r

        // Ricerca senza match
        assert!(fuzzy_match_str("FileTree.svelte", "xyz").is_none());
    }

    #[test]
    fn ricerca_file_progetto_con_esclusioni_e_ranking() {
        let root = temp_dir("search-files");
        let root_str = root.to_str().unwrap().to_string();

        // Struttura fittizia
        fs::create_dir_all(root.join("src/lib/components")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::create_dir_all(root.join("target/debug")).unwrap();

        fs::write(root.join("src/lib/components/FileTree.svelte"), "<script></script>").unwrap();
        fs::write(root.join("src/lib/components/TopBar.svelte"), "<script></script>").unwrap();
        fs::write(root.join("src/lib/icons.ts"), "export const a = 1;").unwrap();
        fs::write(root.join("README.md"), "# Progetto").unwrap();

        // File nelle cartelle ignorate (non devono comparire)
        fs::write(root.join("node_modules/pkg/index.js"), "console.log(1);").unwrap();
        fs::write(root.join(".git/objects/blob.txt"), "git data").unwrap();
        fs::write(root.join("target/debug/build.log"), "build data").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();

        // Ricerca per nome file
        let results_ftr = rt
            .block_on(project_files_search(root_str.clone(), "ftree".to_string(), None))
            .unwrap();
        assert!(!results_ftr.is_empty());
        assert_eq!(results_ftr[0].name, "FileTree.svelte");
        assert_eq!(results_ftr[0].path, "src/lib/components/FileTree.svelte");

        // Nessun file da node_modules o .git deve essere presente
        for r in &results_ftr {
            assert!(!r.path.starts_with("node_modules"));
            assert!(!r.path.starts_with(".git"));
            assert!(!r.path.starts_with("target"));
        }

        // Ricerca con slash nel percorso
        let results_slash = rt
            .block_on(project_files_search(root_str.clone(), "comp/top".to_string(), None))
            .unwrap();
        assert!(!results_slash.is_empty());
        assert_eq!(results_slash[0].name, "TopBar.svelte");

        // Ricerca vuota ritorna vettore vuoto
        let results_empty = rt
            .block_on(project_files_search(root_str, "".to_string(), None))
            .unwrap();
        assert!(results_empty.is_empty());
    }

    #[test]
    fn fuzzy_match_unicode_espansione_i_e_range() {
        // 'İ' (U+0130) si espande in 2 caratteri lowercase ('i' + U+0307)
        let target = "İtem.txt";
        let res = fuzzy_match_str(target, "item");
        assert!(res.is_some());
        let (score, indices) = res.unwrap();
        assert!(score > 0);
        // Tutti gli indici devono essere all'interno del range di caratteri dell'originale target (0..8)
        let orig_char_count = target.chars().count();
        for &idx in &indices {
            assert!(
                idx < orig_char_count,
                "indice {} fuori range ({})",
                idx,
                orig_char_count
            );
        }
        // Indici validi e deduplicati
        assert_eq!(indices, vec![0, 1, 2, 3]);

        // Match su 'İ' con query 'İ'
        let res_exact = fuzzy_match_str(target, "İ");
        assert!(res_exact.is_some());
        let (_, indices_exact) = res_exact.unwrap();
        // L'indice deve essere deduplicato a [0] (e non duplicato [0, 0])
        assert_eq!(indices_exact, vec![0]);

        // Stringa con multiple espansioni Unicode
        let multi = "İ_İ.txt";
        let res_multi = fuzzy_match_str(multi, "ii");
        assert!(res_multi.is_some());
        let (_, indices_multi) = res_multi.unwrap();
        let multi_char_count = multi.chars().count();
        for &idx in &indices_multi {
            assert!(idx < multi_char_count, "indice {} fuori range", idx);
        }
        assert_eq!(indices_multi, vec![0, 2]);

        // Nessun panic su stringhe speciali o query senza match
        assert!(fuzzy_match_str("İ", "xyz").is_none());
        assert_eq!(fuzzy_match_str("İ", "İ").unwrap().1, vec![0]);
    }

    #[test]
    #[cfg(windows)]
    fn protezione_prefissi_windows_due_punti_e_traversal() {
        let root = temp_dir("windows-traversal");
        let root_str = root.to_str().unwrap().to_string();
        let rt = tokio::runtime::Runtime::new().unwrap();

        // Tentativi di creare file con prefissi Windows drive o due punti
        let err_drive = rt.block_on(path_create_file(
            root_str.clone(),
            "".to_string(),
            "C:evil.txt".to_string(),
        ));
        assert!(err_drive.is_err());

        let err_stream = rt.block_on(path_create_file(
            root_str.clone(),
            "".to_string(),
            "test.txt:stream".to_string(),
        ));
        assert!(err_stream.is_err());

        // Tentativi di creare directory con prefissi Windows drive o due punti
        let err_dir_drive = rt.block_on(path_create_directory(
            root_str.clone(),
            "".to_string(),
            "D:cartella".to_string(),
        ));
        assert!(err_dir_drive.is_err());

        // Tentativi di rinomina verso nomi con prefissi Windows o due punti
        fs::write(root.join("innocuo.txt"), "dati").unwrap();
        let err_rename_drive = rt.block_on(path_rename(
            root_str.clone(),
            "innocuo.txt".to_string(),
            "C:fuga.txt".to_string(),
        ));
        assert!(err_rename_drive.is_err());

        let err_rename_stream = rt.block_on(path_rename(
            root_str.clone(),
            "innocuo.txt".to_string(),
            "innocuo.txt:hidden".to_string(),
        ));
        assert!(err_rename_stream.is_err());

        // Tentativi con genitore contenente prefisso drive o due punti
        assert!(resolve_parent_dir(&root, "C:sub").is_err());
        assert!(resolve_parent_dir(&root, "sub:bad").is_err());
        assert!(split_rel_path("C:evil.txt").is_err());
        assert!(split_rel_path("folder/file:stream").is_err());
        assert!(resolve_new_destination(&root_str, "C:sub", "file.txt").is_err());
        assert!(resolve_new_destination(&root_str, "", "C:file.txt").is_err());
    }

    #[test]
    #[cfg(not(windows))]
    fn posix_accetta_due_punti_nel_nome() {
        let root = temp_dir("posix-colons");
        let root_str = root.to_str().unwrap().to_string();
        let rt = tokio::runtime::Runtime::new().unwrap();

        // Su POSIX 'file:meta' e' un nome valido dentro il workspace
        let d = rt
            .block_on(path_create_file(
                root_str.clone(),
                "".to_string(),
                "file:meta".to_string(),
            ))
            .unwrap();
        assert_eq!(d.name, "file:meta");
        assert!(root.join("file:meta").is_file());

        // Rinomina con due punti su POSIX
        let d_ren = rt
            .block_on(path_rename(
                root_str.clone(),
                "file:meta".to_string(),
                "file:meta:v2".to_string(),
            ))
            .unwrap();
        assert_eq!(d_ren.name, "file:meta:v2");
        assert!(root.join("file:meta:v2").is_file());
        assert!(!root.join("file:meta").exists());
    }
}
