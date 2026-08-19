use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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

fn resolve_path(project_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    #[cfg(not(target_os = "windows"))]
    let clean_project_path = project_path.replace('\\', "/");
    #[cfg(target_os = "windows")]
    let clean_project_path = project_path.to_string();

    let clean_rel_path = rel_path.replace('\\', "/");

    let base = Path::new(&clean_project_path)
        .canonicalize()
        .map_err(|e| format!("Radice del progetto non valida ({}): {}", clean_project_path, e))?;

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

#[command]
pub async fn tree_read(project_path: String, rel: String) -> Result<Vec<Dirent>, String> {
    let target = resolve_path(&project_path, &rel)?;
    
    let mut entries = Vec::new();
    let dir = fs::read_dir(&target).map_err(|e| e.to_string())?;

    for entry in dir {
        if let Ok(entry) = entry {
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
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[command]
pub async fn file_read(project_path: String, rel: String) -> Result<FileContent, String> {
    let target = resolve_path(&project_path, &rel)?;
    
    // Check encoding (simple fallback to UTF-8 lossy for now)
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    Ok(FileContent { content })
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
            Ok(GitHeadContent { content, exists: true })
        }
        _ => Ok(GitHeadContent { content: String::new(), exists: false })
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

    s = s.trim_end_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '>' | '\'' | '"' | '`'));

    let mut line: Option<usize> = None;
    let mut path_part = s.to_string();

    if let Some(hash_idx) = path_part.rfind('#') {
        let after_hash = &path_part[hash_idx + 1..];
        if let Some(colon_idx) = after_hash.find(':') {
            let line_str = &after_hash[colon_idx + 1..];
            let num_str = line_str.split('-').next().unwrap_or(line_str).split(':').next().unwrap_or(line_str);
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
        } else if path.is_file() {
            if name.eq_ignore_ascii_case(target_name) {
                return Some(path);
            }
        }
    }

    for subdir in subdirs {
        if let Some(found) = find_file_in_dir(&subdir, target_name, depth + 1) {
            return Some(found);
        }
    }

    None
}

pub fn resolve_project_file_sync(project_path: &str, candidate: &str) -> Result<Option<ResolvedFile>, String> {
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

    if raw_path.is_empty() || raw_path.contains('\0') || raw_path.starts_with("http://") || raw_path.starts_with("https://") {
        return Ok(None);
    }

    let candidates_to_try = if (raw_path.starts_with("a/") || raw_path.starts_with("b/")) && raw_path.len() > 2 {
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
pub async fn resolve_project_file(project_path: String, candidate: String) -> Result<Option<ResolvedFile>, String> {
    tokio::task::spawn_blocking(move || {
        resolve_project_file_sync(&project_path, &candidate)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::resolve_path;
    use super::resolve_project_file_sync;
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

        assert!(resolve_path(root.to_str().unwrap(), "../../windows/system32/drivers/etc/hosts").is_err());
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
        assert!(dentro.join("segreto.txt").exists(), "il collegamento non attraversa");

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
        let r1 = resolve_project_file_sync(root_str, "AGENTS.md").unwrap().unwrap();
        assert_eq!(r1.rel_path, "AGENTS.md");
        assert_eq!(r1.line, None);

        // Case insensitive su nome file
        let r2 = resolve_project_file_sync(root_str, "agents.md").unwrap().unwrap();
        assert_eq!(r2.rel_path, "AGENTS.md");

        // Con numero di riga
        let r3 = resolve_project_file_sync(root_str, "src/lib/Editor.svelte:75").unwrap().unwrap();
        assert_eq!(r3.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r3.line, Some(75));

        // Con riga e colonna
        let r4 = resolve_project_file_sync(root_str, "src/lib/Editor.svelte:75:10").unwrap().unwrap();
        assert_eq!(r4.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r4.line, Some(75));

        // Con formato snapshot tool header
        let r5 = resolve_project_file_sync(root_str, "[src/lib/Editor.svelte#A44A:42-80]").unwrap().unwrap();
        assert_eq!(r5.rel_path, "src/lib/Editor.svelte");
        assert_eq!(r5.line, Some(42));

        // Con formato git diff
        let r6 = resolve_project_file_sync(root_str, "b/src/lib/Editor.svelte").unwrap().unwrap();
        assert_eq!(r6.rel_path, "src/lib/Editor.svelte");

        // Ricerca automatica di nome file isolato in sottocartella
        let r7 = resolve_project_file_sync(root_str, "Editor.svelte").unwrap().unwrap();
        assert_eq!(r7.rel_path, "src/lib/Editor.svelte");

        // Con punteggiatura finale
        let r8 = resolve_project_file_sync(root_str, "agents.md.").unwrap().unwrap();
        assert_eq!(r8.rel_path, "AGENTS.md");

        // Con virgolette o backtick
        let r9 = resolve_project_file_sync(root_str, "`AGENTS.md`").unwrap().unwrap();
        assert_eq!(r9.rel_path, "AGENTS.md");
    }
}
