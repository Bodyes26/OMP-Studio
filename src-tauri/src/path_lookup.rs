//! Risoluzione in-process di eseguibili sul `PATH` di sistema.
//!
//! Evita di spawnare processi esterni (`where.exe` su Windows o `which`/`sh -c` su Unix)
//! per ogni verifica o ricerca di binari (`omp`, `gh`, `bash.exe`, shim di VS Code).
//! Su Windows un singolo spawn puo' richiedere 50-250ms a causa dell'antivirus
//! (es. Sophos / Windows Defender), mentre la ricerca in-process impiega meno di 1ms.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Trova il primo eseguibile corrispondente a `program` sul `PATH` di processo.
pub fn which(program: &str) -> Option<PathBuf> {
    which_in(program, std::env::var_os("PATH").as_deref())
}

/// Trova il primo eseguibile corrispondente a `program` nella variabile PATH specificata.
pub fn which_in(program: &str, path_env: Option<&OsStr>) -> Option<PathBuf> {
    find_all_impl(program, path_env, true).into_iter().next()
}

/// Trova tutti gli eseguibili corrispondenti a `program` sul `PATH` di processo,
/// preservando l'ordine di precedenza delle directory.
// Usata solo dalla ricerca degli shim di VS Code su Windows.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn find_all(program: &str) -> Vec<PathBuf> {
    find_all_in(program, std::env::var_os("PATH").as_deref())
}

/// Trova tutti gli eseguibili corrispondenti a `program` nella variabile PATH specificata.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn find_all_in(program: &str, path_env: Option<&OsStr>) -> Vec<PathBuf> {
    find_all_impl(program, path_env, false)
}

fn find_all_impl(program: &str, path_env: Option<&OsStr>, first_only: bool) -> Vec<PathBuf> {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let p = Path::new(trimmed);
    // Se il nome contiene separatori di percorso o e' assoluto, verifichiamo direttamente
    // il file indicato senza consultare il PATH.
    if p.is_absolute() || p.components().count() > 1 {
        #[cfg(unix)]
        {
            if is_executable_unix(p) {
                return vec![p.to_path_buf()];
            }
            return Vec::new();
        }
        #[cfg(windows)]
        {
            if let Some(parent) = p.parent() {
                if let Some(file_name) = p.file_name().and_then(|n| n.to_str()) {
                    let pathext = get_pathext();
                    return candidates_for_dir_windows(parent, file_name, &pathext);
                }
            }
            return Vec::new();
        }
    }

    let Some(path_val) = path_env else {
        return Vec::new();
    };

    #[cfg(windows)]
    let pathext = get_pathext();

    let mut results = Vec::new();

    for dir in std::env::split_paths(path_val) {
        // In POSIX una voce vuota in PATH indica la directory di lavoro corrente (".")
        let dir_ref = if dir.as_os_str().is_empty() {
            Path::new(".")
        } else {
            dir.as_path()
        };

        #[cfg(unix)]
        {
            let candidates = candidates_for_dir_unix(dir_ref, trimmed);
            for c in candidates {
                results.push(c);
                if first_only {
                    return results;
                }
            }
        }

        #[cfg(windows)]
        {
            let candidates = candidates_for_dir_windows(dir_ref, trimmed, &pathext);
            for c in candidates {
                results.push(c);
                if first_only {
                    return results;
                }
            }
        }
    }

    results
}

#[cfg(unix)]
fn is_executable_unix(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    // `metadata` segue i symlink, a differenza di `symlink_metadata`:
    // un binario symlinkato (es. Homebrew o Bun) deve risultare eseguibile.
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
        .unwrap_or(false)
}

#[cfg(unix)]
fn candidates_for_dir_unix(dir: &Path, program: &str) -> Vec<PathBuf> {
    let candidate = dir.join(program);
    if is_executable_unix(&candidate) {
        vec![candidate]
    } else {
        Vec::new()
    }
}

/// Legge e normalizza le estensioni di `PATHEXT` su Windows.
/// Se `PATHEXT` e' assente o vuoto, ripiega sullo standard di sistema `.COM;.EXE;.BAT;.CMD`.
#[cfg(windows)]
fn get_pathext() -> Vec<String> {
    let raw = std::env::var("PATHEXT").unwrap_or_default();
    parse_pathext(&raw)
}

#[cfg(any(windows, test))]
fn parse_pathext(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![
            ".COM".to_string(),
            ".EXE".to_string(),
            ".BAT".to_string(),
            ".CMD".to_string(),
        ];
    }
    trimmed
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            if s.starts_with('.') {
                s.to_string()
            } else {
                format!(".{}", s)
            }
        })
        .collect()
}

/// Risolve candidati per una cartella su Windows, gestendo sia il caso con estensione
/// esplicita (es. `code.cmd`, `gh.exe`) sia la ricerca con estensioni `PATHEXT`.
#[cfg(any(windows, test))]
fn candidates_for_dir_windows(dir: &Path, program: &str, pathext: &[String]) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    let direct = dir.join(program);
    let has_ext = Path::new(program).extension().is_some();

    // Caso con estensione esplicita: se il file esiste direttamente, e' un candidato valido.
    if has_ext && direct.is_file() {
        matches.push(direct);
    }

    // Se il nome non ha estensione o se cerchiamo estensioni aggiuntive di PATHEXT
    // (es. `prog` -> `prog.exe`, o `script` -> `script.cmd`).
    for ext in pathext {
        let already_has_this_ext = has_ext
            && program.len() >= ext.len()
            && program[program.len() - ext.len()..].eq_ignore_ascii_case(ext);
        if already_has_this_ext {
            continue;
        }
        let with_ext = dir.join(format!("{}{}", program, ext));
        if with_ext.is_file() {
            matches.push(with_ext);
        }
    }

    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pathext_usa_fallback_quando_vuoto() {
        assert_eq!(
            parse_pathext(""),
            vec![".COM", ".EXE", ".BAT", ".CMD"]
        );
        assert_eq!(
            parse_pathext("   "),
            vec![".COM", ".EXE", ".BAT", ".CMD"]
        );
    }

    #[test]
    fn parse_pathext_normalizza_voci() {
        let parsed = parse_pathext(".EXE;.CMD;bat;.PS1;");
        assert_eq!(parsed, vec![".EXE", ".CMD", ".bat", ".PS1"]);
    }

    #[test]
    fn windows_candidati_trova_estensione_esplicita_e_pathext() {
        let dir = std::env::temp_dir().join(format!("path-lookup-win-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let code_cmd = dir.join("code.cmd");
        let code_exe = dir.join("code.exe");
        let script = dir.join("script.bat");
        std::fs::write(&code_cmd, b"dummy").unwrap();
        std::fs::write(&code_exe, b"dummy").unwrap();
        std::fs::write(&script, b"dummy").unwrap();

        // Estensioni in minuscolo come i file: su un filesystem che ignora le
        // maiuscole (Windows, APFS) `code.EXE` esiste ma il PathBuf restituito
        // conserverebbe la grafia di PATHEXT e il confronto fallirebbe.
        let pathext = vec![".exe".to_string(), ".cmd".to_string(), ".bat".to_string()];

        // Caso estensione esplicita: cerca esattamente code.cmd senza duplicati
        let found = candidates_for_dir_windows(&dir, "code.cmd", &pathext);
        assert_eq!(found, vec![code_cmd.clone()]);

        // Caso senza estensione: trova sia code.exe sia code.cmd nell'ordine di pathext
        let found_both = candidates_for_dir_windows(&dir, "code", &pathext);
        assert_eq!(found_both, vec![code_exe.clone(), code_cmd.clone()]);

        // Caso senza estensione per script.bat
        let found_script = candidates_for_dir_windows(&dir, "script", &pathext);
        assert_eq!(found_script, vec![script.clone()]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_richiede_bit_eseguibile() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("path-lookup-unix-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let exec_bin = dir.join("bin_eseguibile");
        let non_exec_bin = dir.join("file_normale");
        let sottocartella = dir.join("cartella_755");

        std::fs::write(&exec_bin, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&exec_bin, std::fs::Permissions::from_mode(0o755)).unwrap();

        std::fs::write(&non_exec_bin, b"testo non eseguibile").unwrap();
        std::fs::set_permissions(&non_exec_bin, std::fs::Permissions::from_mode(0o644)).unwrap();

        std::fs::create_dir_all(&sottocartella).unwrap();
        std::fs::set_permissions(&sottocartella, std::fs::Permissions::from_mode(0o755)).unwrap();

        let path_env = std::ffi::OsString::from(dir.to_string_lossy().as_ref());

        // Il file con permessi 0755 viene trovato
        assert_eq!(
            which_in("bin_eseguibile", Some(&path_env)),
            Some(exec_bin.clone())
        );

        // Il file con permessi 0644 viene ignorato (non e' eseguibile)
        assert_eq!(which_in("file_normale", Some(&path_env)), None);

        // La cartella con permessi 0755 viene ignorata (non e' un file)
        assert_eq!(which_in("cartella_755", Some(&path_env)), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
