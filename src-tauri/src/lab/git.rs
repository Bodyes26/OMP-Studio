//! Operazioni Git interne al workspace del prototipo.
//!
//! Ogni richiesta all'agente o azione utente produce un commit nel repository
//! interno al workspace (`<lab_root>/prototypes/<id>/.git`).
//! I comandi girano sempre con finestra nascosta (`CREATE_NO_WINDOW`), nessun hook
//! (`-c core.hooksPath=`), nessuna firma GPG e autore fisso "OMP Studio Lab", senza
//! toccare la configurazione globale. La ricerca del repository non risale mai oltre
//! il workspace (`GIT_CEILING_DIRECTORIES`).

use super::types::{LabFile, LabRevision};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tauri::command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Costruisce un comando Git isolato per la cartella di lavoro specificata.
pub fn git_command(cwd: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd);
    // I file del workspace (compresa `.git/hooks`) li scrive l'agente: nessun hook
    // deve essere eseguito. Con hooksPath vuoto git cerca gli hook in un percorso
    // inesistente.
    cmd.arg("-c").arg("core.hooksPath=");
    // Una firma GPG configurata globalmente farebbe fallire (o chiedere la passphrase
    // a) ogni commit automatico del Lab.
    cmd.arg("-c").arg("commit.gpgsign=false");
    cmd.arg("-c").arg("tag.gpgsign=false");
    // Variabili ereditate che punterebbero git a un altro repository.
    for var in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
    ] {
        cmd.env_remove(var);
    }
    // Se `<cwd>/.git` mancasse, git risalirebbe fino a un repository antenato
    // (ad esempio una home versionata) e `add -A`/`clean`/`restore` agirebbero li'.
    if let Some(parent) = cwd.parent().filter(|p| p.is_absolute()) {
        cmd.env("GIT_CEILING_DIRECTORIES", parent);
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Risolve il workspace di un comando `lab_git_*`: deve stare sotto
/// `<lab_root>/prototypes` e avere il proprio `.git`. Il percorso arriva dal
/// frontend: senza questo controllo `restore`/`clean` potevano girare su qualunque
/// cartella, o su un repository antenato.
fn resolve_lab_workspace(workspace_path: &str) -> Result<PathBuf, String> {
    let cwd = Path::new(workspace_path);
    if !cwd.exists() {
        return Err(format!("Workspace non esistente: {}", cwd.display()));
    }
    let prototypes_dir = super::paths::lab_root()
        .ok_or_else(|| "Radice del Laboratorio non disponibile".to_string())?
        .join("prototypes");
    let canonical = super::index::confined_prototype_workspace(&prototypes_dir, cwd)?;
    ensure_own_git_dir(&canonical)?;
    // Il percorso canonico serve solo al controllo: su Windows ha il prefisso `\\?\`,
    // che non va passato come cartella di lavoro ne' a GIT_CEILING_DIRECTORIES.
    if cwd.is_absolute() {
        Ok(cwd.to_path_buf())
    } else {
        Ok(canonical)
    }
}

fn ensure_own_git_dir(cwd: &Path) -> Result<(), String> {
    if cwd.join(".git").exists() {
        Ok(())
    } else {
        Err(format!(
            "Il workspace {} non ha un repository git proprio",
            cwd.display()
        ))
    }
}

/// Una revisione arriva dal frontend e finisce come argomento di git: solo hash
/// esadecimali, cosi' un valore come `--output=...` non diventa un'opzione.
fn validate_revision(sha: &str) -> Result<(), String> {
    let valid = (4..=64).contains(&sha.len()) && sha.chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(())
    } else {
        Err(format!("Revisione non valida: {sha}"))
    }
}

/// Costruisce un comando Git con autore predefinito del Laboratorio.
pub fn git_command_with_author(cwd: &Path) -> Command {
    let mut cmd = git_command(cwd);
    cmd.arg("-c").arg("user.name=OMP Studio Lab");
    cmd.arg("-c").arg("user.email=lab@omp-studio.local");
    cmd
}

/// Esegue un comando Git verificandone lo stato di uscita.
fn run_git_checked(cmd: &mut Command, desc: &str) -> Result<Output, String> {
    let output = cmd
        .output()
        .map_err(|e| format!("Errore avvio git {desc}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let err_msg = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("git {desc} fallito: {err_msg}"));
    }
    Ok(output)
}

/// Effettua il parsing di una riga formattata con `%H%x1f%s%x1f%aI`.
fn parse_revision_line(line: &str) -> Option<LabRevision> {
    let parts: Vec<&str> = line.split('\x1f').collect();
    if parts.len() >= 3 {
        Some(LabRevision {
            sha: parts[0].trim().to_string(),
            message: parts[1].trim().to_string(),
            date: parts[2].trim().to_string(),
        })
    } else {
        None
    }
}

/// Inizializza un repository Git all'interno del workspace del prototipo.
pub fn git_init(cwd: &Path) -> Result<(), String> {
    let mut cmd = git_command(cwd);
    cmd.args(["init", "-b", "main"]);
    if run_git_checked(&mut cmd, "init").is_err() {
        // Fallback per versioni di git che non supportano `-b main` in `init`
        let mut fallback = git_command(cwd);
        fallback.arg("init");
        run_git_checked(&mut fallback, "init fallback")?;
    }
    Ok(())
}

/// Registra il commit iniziale nel workspace appena generato dal template.
pub fn git_initial_commit(cwd: &Path) -> Result<LabRevision, String> {
    let mut add_cmd = git_command(cwd);
    add_cmd.args(["add", "-A"]);
    run_git_checked(&mut add_cmd, "add -A iniziale")?;

    let mut commit_cmd = git_command_with_author(cwd);
    commit_cmd.args(["commit", "-m", "Prototipo creato"]);
    run_git_checked(&mut commit_cmd, "commit iniziale")?;

    let mut log_cmd = git_command(cwd);
    log_cmd.args(["log", "-1", "--format=%H\x1f%s\x1f%aI"]);
    let out = run_git_checked(&mut log_cmd, "log iniziale")?;
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    parse_revision_line(&line).ok_or_else(|| "Formato commit iniziale non valido".to_string())
}

/// Aggiunge tutte le modifiche e committa. Restituisce `None` se non c'erano modifiche.
#[command]
pub async fn lab_git_commit(
    workspace_path: String,
    message: String,
) -> Result<Option<LabRevision>, String> {
    tokio::task::spawn_blocking(move || {
        let cwd_buf = resolve_lab_workspace(&workspace_path)?;
        let cwd = cwd_buf.as_path();

        // git add -A
        let mut add_cmd = git_command(cwd);
        add_cmd.args(["add", "-A"]);
        run_git_checked(&mut add_cmd, "add -A")?;

        // Verifica se ci sono differenze staged rispetto all'albero attuale
        let mut diff_cmd = git_command(cwd);
        diff_cmd.args(["diff", "--cached", "--quiet"]);
        let diff_out = diff_cmd
            .output()
            .map_err(|e| format!("Errore controllo modifiche: {e}"))?;

        if diff_out.status.code() == Some(0) {
            // Nessuna modifica staged da committare
            return Ok(None);
        }

        // git commit -m <message>
        let mut commit_cmd = git_command_with_author(cwd);
        commit_cmd.args(["commit", "-m", &message]);
        run_git_checked(&mut commit_cmd, "commit")?;

        // Recupera revisione appena creata
        let mut log_cmd = git_command(cwd);
        log_cmd.args(["log", "-1", "--format=%H\x1f%s\x1f%aI"]);
        let out = run_git_checked(&mut log_cmd, "log")?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let rev = parse_revision_line(&line)
            .ok_or_else(|| "Formato revisione git non valido".to_string())?;

        Ok(Some(rev))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Elenca le revisioni dalla piu' recente.
#[command]
pub async fn lab_git_log(
    workspace_path: String,
    limit: Option<usize>,
) -> Result<Vec<LabRevision>, String> {
    tokio::task::spawn_blocking(move || {
        let cwd_buf = resolve_lab_workspace(&workspace_path)?;
        let cwd = cwd_buf.as_path();

        let max_commits = limit.unwrap_or(100).max(1);
        let mut cmd = git_command(cwd);
        cmd.args([
            "log",
            &format!("-n{max_commits}"),
            "--format=%H\x1f%s\x1f%aI",
        ]);

        let out = match cmd.output() {
            Ok(o) if o.status.success() => o,
            _ => {
                // In un repository appena inizializzato senza commit, il log puo' essere vuoto
                return Ok(Vec::new());
            }
        };

        let stdout = String::from_utf8_lossy(&out.stdout);
        let mut revisions = Vec::new();
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(rev) = parse_revision_line(trimmed) {
                revisions.push(rev);
            }
        }
        Ok(revisions)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Recupera l'elenco dei file di testo presenti a una specifica revisione.
#[command]
pub async fn lab_git_files_at(workspace_path: String, sha: String) -> Result<Vec<LabFile>, String> {
    tokio::task::spawn_blocking(move || {
        validate_revision(&sha)?;
        let cwd_buf = resolve_lab_workspace(&workspace_path)?;
        let cwd = cwd_buf.as_path();

        let mut cmd = git_command(cwd);
        cmd.args(["ls-tree", "-r", "--name-only", &sha, "--"]);
        let out = run_git_checked(&mut cmd, "ls-tree")?;

        let stdout = String::from_utf8_lossy(&out.stdout);
        let mut files = Vec::new();

        for line in stdout.lines() {
            let rel_path = line.trim();
            if rel_path.is_empty() {
                continue;
            }
            let normalized = rel_path.replace('\\', "/");

            // Ignora le directory escluse dal contratto
            if normalized == ".git"
                || normalized.starts_with(".git/")
                || normalized == ".lab"
                || normalized.starts_with(".lab/")
                || normalized == "node_modules"
                || normalized.starts_with("node_modules/")
                || normalized == "dist"
                || normalized.starts_with("dist/")
            {
                continue;
            }

            if files.len() >= 400 {
                return Err(
                    "Il workspace alla revisione supera il limite massimo di 400 file".to_string(),
                );
            }

            // Verifica dimensione file prima della lettura completa
            let target_spec = format!("{sha}:{rel_path}");
            let mut size_cmd = git_command(cwd);
            size_cmd.args(["cat-file", "-s", &target_spec]);
            if let Ok(size_out) = size_cmd.output() {
                if size_out.status.success() {
                    let size_str = String::from_utf8_lossy(&size_out.stdout).trim().to_string();
                    if let Ok(size_bytes) = size_str.parse::<usize>() {
                        if size_bytes > 1_048_576 {
                            return Err(format!(
                                "Il file {rel_path} supera la dimensione massima di 1 MiB"
                            ));
                        }
                    }
                }
            }

            // Legge il contenuto
            let mut show_cmd = git_command(cwd);
            show_cmd.args(["show", &target_spec]);
            let show_out = run_git_checked(&mut show_cmd, &format!("show {target_spec}"))?;

            if let Some(content) =
                super::workspace::decode_snapshot_text(&normalized, show_out.stdout)?
            {
                files.push(LabFile {
                    path: normalized,
                    content,
                });
            }
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Riporta l'albero di lavoro e l'indice alla revisione `sha` e registra un commit di ripristino.
#[command]
pub async fn lab_git_restore(workspace_path: String, sha: String) -> Result<LabRevision, String> {
    tokio::task::spawn_blocking(move || {
        validate_revision(&sha)?;
        let cwd_buf = resolve_lab_workspace(&workspace_path)?;
        let cwd = cwd_buf.as_path();

        // Recupera il messaggio originale del commit da ripristinare
        let mut log_cmd = git_command(cwd);
        log_cmd.args(["log", "-1", "--format=%s", &sha, "--"]);
        let log_out = run_git_checked(&mut log_cmd, "log messaggio commit")?;
        let subject = String::from_utf8_lossy(&log_out.stdout).trim().to_string();

        let sha7 = if sha.len() >= 7 { &sha[..7] } else { &sha };
        let restore_message = format!("Ripristino di {sha7}: {subject}");

        // git add -A per tracciare eventuali file nuovi prima del restore no-overlay
        let mut add_cmd = git_command(cwd);
        add_cmd.args(["add", "-A"]);
        let _ = add_cmd.output();

        // git restore --source=<sha> --staged --worktree --no-overlay -- .
        let mut restore_cmd = git_command(cwd);
        restore_cmd.args([
            "restore",
            &format!("--source={sha}"),
            "--staged",
            "--worktree",
            "--no-overlay",
            "--",
            ".",
        ]);
        run_git_checked(&mut restore_cmd, "restore no-overlay")?;

        // Pulisce untracked preservando .lab
        let mut clean_cmd = git_command(cwd);
        clean_cmd.args(["clean", "-fd", "-e", ".lab"]);
        let _ = clean_cmd.output();

        // Registra il commit di ripristino (allow-empty nel caso il tree fosse identico)
        let mut commit_cmd = git_command_with_author(cwd);
        commit_cmd.args(["commit", "--allow-empty", "-m", &restore_message]);
        run_git_checked(&mut commit_cmd, "commit ripristino")?;

        // Recupera i dettagli del nuovo commit di ripristino
        let mut new_log_cmd = git_command(cwd);
        new_log_cmd.args(["log", "-1", "--format=%H\x1f%s\x1f%aI"]);
        let out = run_git_checked(&mut new_log_cmd, "log nuova revisione")?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        parse_revision_line(&line)
            .ok_or_else(|| "Formato commit di ripristino non valido".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "omp-studio-labgit-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn revisione_solo_esadecimale() {
        assert!(validate_revision("0123abcdef").is_ok());
        assert!(validate_revision(&"a".repeat(40)).is_ok());
        assert!(validate_revision("--output=/tmp/x").is_err());
        assert!(validate_revision("HEAD").is_err());
        assert!(validate_revision("abc").is_err());
    }

    #[test]
    fn senza_git_proprio_non_risale_al_repository_antenato() {
        let root = scratch("ceiling");
        // Repository antenato con un file da non toccare
        let mut init = Command::new("git");
        init.current_dir(&root).args(["init", "-q"]);
        assert!(init.status().unwrap().success());
        let ws = root.join("prototypes").join("p1");
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("file.txt"), "x").unwrap();

        assert!(ensure_own_git_dir(&ws).is_err());
        // Anche se si eseguisse git, il soffitto impedisce di trovare l'antenato.
        let out = git_command(&ws)
            .args(["rev-parse", "--show-toplevel"])
            .output()
            .unwrap();
        assert!(
            !out.status.success(),
            "git ha trovato il repository antenato"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_iniziale_ignora_firma_gpg_e_hook() {
        let ws = scratch("gpg");
        fs::write(ws.join("index.html"), "<p>ciao</p>").unwrap();
        git_init(&ws).unwrap();
        // Configurazione locale ostile: firma obbligatoria con un programma che fallisce
        // e un hook pre-commit che fallisce.
        for (key, value) in [
            ("commit.gpgsign", "true"),
            ("gpg.program", "false-gpg-inesistente"),
        ] {
            let mut cfg = Command::new("git");
            cfg.current_dir(&ws).args(["config", key, value]);
            assert!(cfg.status().unwrap().success());
        }
        let hook = ws.join(".git").join("hooks").join("pre-commit");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let rev = git_initial_commit(&ws);
        let _ = fs::remove_dir_all(&ws);
        assert!(rev.is_ok(), "{rev:?}");
    }
}
