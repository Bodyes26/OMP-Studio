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
    // La radice va canonicalizzata per prima: e' il metro di paragone di tutto il resto.
    let base = Path::new(project_path)
        .canonicalize()
        .map_err(|e| format!("Radice del progetto non valida: {}", e))?;

    let target = base.join(rel_path);

    // Un file in scrittura puo' non esistere ancora: in quel caso si canonicalizza la
    // cartella padre e le si riattacca il nome, cosi' il confronto resta su percorsi reali.
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

    // Confronto sui percorsi risolti: intercetta `..`, link simbolici e junction che
    // puntano fuori dalla radice, cosa che il solo conteggio dei componenti non vede.
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

#[cfg(test)]
mod tests {
    use super::resolve_path;
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
}
