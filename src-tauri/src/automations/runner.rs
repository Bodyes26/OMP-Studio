//! Runner nativo per le esecuzioni di comandi (AUT-000, AUT-034..036, AUT-043, AUT-048, AUT-065, AUT-088..089).
//!
//! Gestisce l'esecuzione di comandi shell, eseguibili diretti e script:
//! - Risoluzione varianti OS e validazione piattaforme ammesse
//! - Rifiuto assoluto di PowerShell / pwsh / script .ps1 per policy di sicurezza
//! - Argv strutturati, gestione specifica cmd/bat/npm.cmd su Windows
//! - sh /bin/sh non interattivo senza profili utente su Unix
//! - Directory di lavoro (CWD) esplicita e verificata
//! - Ambiente ereditato + override + riferimenti vault (fail-closed)
//! - Mascheramento best-effort dei segreti su stdout e stderr
//! - Iniezione di OMP_AUTOMATION_CONTEXT tramite variabile d'ambiente (percorso file JSON, no interpolazione)
//! - Stdin chiuso immediatamente (Stdio::null())
//! - Stdout e stderr drenati contemporaneamente in thread dedicati per prevenire deadlock di pipe OS
//! - Streaming continuo con bound di memoria per chunk/linea
//! - Timeout configurabile e cancellazione atomica via AtomicBool
//! - Contenimento e terminazione ricorsiva dell'intero albero di processi (JobObject su Windows, PGID su Unix)
//! - Attesa e drenaggio effettivo dei processi figli, nessun processo orfano lasciato fuori controllo

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::model::{AutomationAction, CommandAction, CommandVariant};

/// Richiesta di esecuzione di un comando proveniente dal coordinatore nativo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest {
    pub execution_id: String,
    pub cwd: PathBuf,
    pub action: serde_json::Value,
    pub environment: HashMap<String, String>,
    pub timeout: Duration,
    pub context_path: PathBuf,
}

/// Esito dell'esecuzione di un comando.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    pub state: String, // "completed" | "error" | "timeout" | "interrupted"
    pub exit_code: Option<i32>,
    pub detail: Option<String>,
}

/// Verifica se una stringa fa riferimento a PowerShell in qualsiasi variante.
fn is_powershell(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower == "powershell"
        || lower == "powershell.exe"
        || lower == "pwsh"
        || lower == "pwsh.exe"
        || lower.ends_with(".ps1")
        || lower.contains("powershell")
        || lower.contains("pwsh")
}

/// Maschera i valori dei segreti noti con "***".
fn mask_secrets(text: &str, secrets: &[String]) -> String {
    if secrets.is_empty() {
        return text.to_string();
    }
    let mut out = text.to_string();
    for secret in secrets {
        if !secret.is_empty() && secret.len() >= 2 {
            out = out.replace(secret, "***");
        }
    }
    out
}

/// Deserializza l'azione del comando supportando sia `CommandAction` diretto,
/// sia `AutomationAction::Command`, sia un oggetto JSON libero con campi del comando.
fn parse_action(val: &serde_json::Value) -> Result<CommandAction, String> {
    if let Ok(cmd) = serde_json::from_value::<CommandAction>(val.clone()) {
        return Ok(cmd);
    }
    if let Ok(AutomationAction::Command(cmd)) =
        serde_json::from_value::<AutomationAction>(val.clone())
    {
        return Ok(cmd);
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LooseCommandAction {
        #[serde(default)]
        mode: Option<String>,
        #[serde(default)]
        command: Option<String>,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        interpreter: Option<String>,
        #[serde(default)]
        platforms: Vec<String>,
        #[serde(default)]
        variants: HashMap<String, CommandVariant>,
        #[serde(default)]
        environment: HashMap<String, String>,
        #[serde(default)]
        secret_refs: HashMap<String, String>,
        #[serde(default)]
        script_policy: Option<String>,
        #[serde(default)]
        approved_files: HashMap<String, String>,
        #[serde(default)]
        watched_files: Vec<String>,
    }

    if let Ok(loose) = serde_json::from_value::<LooseCommandAction>(val.clone()) {
        if loose.command.is_some() || loose.mode.is_some() {
            return Ok(CommandAction {
                mode: loose.mode.unwrap_or_else(|| "shell".to_string()),
                command: loose.command.unwrap_or_default(),
                args: loose.args,
                interpreter: loose.interpreter.unwrap_or_default(),
                platforms: loose.platforms,
                variants: loose.variants,
                environment: loose.environment,
                secret_refs: loose.secret_refs,
                script_policy: loose.script_policy.unwrap_or_else(|| "review".to_string()),
                approved_files: loose.approved_files,
                watched_files: loose.watched_files,
            });
        }
    }

    Err(format!(
        "Impossibile deserializzare l'azione come CommandAction o AutomationAction::Command: {:?}",
        val
    ))
}

/// Su Windows risolve l'eseguibile controllando estensioni .cmd/.bat o tool noti di Node
/// che necessitano dell'invocazione tramite cmd.exe.
#[cfg(target_os = "windows")]
fn resolve_windows_executable(command_str: &str, cwd: &Path) -> (String, bool) {
    let trimmed = command_str.trim();
    let lower = trimmed.to_ascii_lowercase();

    // 1. Estensione esplicita batch
    if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        return (trimmed.to_string(), true);
    }
    if lower.ends_with(".exe") {
        return (trimmed.to_string(), false);
    }

    // 2. Comandi noti del tooling Node che su Windows sono wrapper .cmd
    let known_batch_tools = [
        "npm", "npx", "pnpm", "yarn", "corepack", "ng", "tsc", "vite", "turbo", "lerna",
    ];
    if known_batch_tools.iter().any(|&tool| lower == tool) {
        return (format!("{}.cmd", trimmed), true);
    }

    // 3. Controllo nel percorso CWD
    let in_cwd = cwd.join(trimmed);
    if in_cwd.is_file() {
        let ext = in_cwd.extension().and_then(|e| e.to_str()).unwrap_or("");
        let is_batch = ext.eq_ignore_ascii_case("bat") || ext.eq_ignore_ascii_case("cmd");
        return (in_cwd.to_string_lossy().to_string(), is_batch);
    }
    let bat_in_cwd = cwd.join(format!("{}.bat", trimmed));
    if bat_in_cwd.is_file() {
        return (bat_in_cwd.to_string_lossy().to_string(), true);
    }
    let cmd_in_cwd = cwd.join(format!("{}.cmd", trimmed));
    if cmd_in_cwd.is_file() {
        return (cmd_in_cwd.to_string_lossy().to_string(), true);
    }
    let exe_in_cwd = cwd.join(format!("{}.exe", trimmed));
    if exe_in_cwd.is_file() {
        return (exe_in_cwd.to_string_lossy().to_string(), false);
    }

    // 4. Risoluzione tramite variabile PATH di sistema
    if let Some(path_os) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_os) {
            let candidate_bat = dir.join(format!("{}.bat", trimmed));
            if candidate_bat.is_file() {
                return (candidate_bat.to_string_lossy().to_string(), true);
            }
            let candidate_cmd = dir.join(format!("{}.cmd", trimmed));
            if candidate_cmd.is_file() {
                return (candidate_cmd.to_string_lossy().to_string(), true);
            }
            let candidate_exe = dir.join(format!("{}.exe", trimmed));
            if candidate_exe.is_file() {
                return (candidate_exe.to_string_lossy().to_string(), false);
            }
            let candidate_raw = dir.join(trimmed);
            if candidate_raw.is_file() {
                let ext = candidate_raw
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                let is_batch = ext.eq_ignore_ascii_case("bat") || ext.eq_ignore_ascii_case("cmd");
                return (candidate_raw.to_string_lossy().to_string(), is_batch);
            }
        }
    }

    (trimmed.to_string(), false)
}

/// Drena uno stream di output (stdout o stderr) in blocchi di dimensione massima limitata
/// (max 64 KiB), applicando il mascheramento dei segreti e inviando i chunk al canale.
fn drain_stream<R: Read + Send + 'static>(
    reader: R,
    is_stderr: bool,
    secrets: Vec<String>,
    sender: mpsc::Sender<(String, bool)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf_reader = BufReader::with_capacity(32 * 1024, reader);
        let mut chunk_buf = Vec::with_capacity(4096);
        const MAX_CHUNK_BYTES: usize = 64 * 1024; // Bounded a 64 KiB per segmento

        loop {
            chunk_buf.clear();
            let mut read_bytes = 0;

            while read_bytes < MAX_CHUNK_BYTES {
                let available = match buf_reader.fill_buf() {
                    Ok(b) if b.is_empty() => break, // EOF
                    Ok(b) => b,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break, // Pipe chiusa o errore I/O
                };

                if let Some(pos) = available.iter().position(|&b| b == b'\n') {
                    chunk_buf.extend_from_slice(&available[..=pos]);
                    let consumed = pos + 1;
                    buf_reader.consume(consumed);
                    break;
                } else {
                    let to_take = available.len().min(MAX_CHUNK_BYTES - read_bytes);
                    chunk_buf.extend_from_slice(&available[..to_take]);
                    buf_reader.consume(to_take);
                    read_bytes += to_take;
                }
            }

            if chunk_buf.is_empty() {
                break; // EOF raggiunto
            }

            let mut text = String::from_utf8_lossy(&chunk_buf).to_string();
            if text.ends_with('\n') {
                text.pop();
                if text.ends_with('\r') {
                    text.pop();
                }
            }

            let masked = mask_secrets(&text, &secrets);
            if sender.send((masked, is_stderr)).is_err() {
                break; // Il chiamante ha chiuso la ricezione
            }
        }
    })
}

/// Esegue il comando specificato con le garanzie complete di piattaforma, ambiente,
/// mascheramento segreti, timeout e controllo gerarchico dei processi.
pub fn execute(
    request: &CommandRequest,
    cancel: &AtomicBool,
    on_output: &(dyn Fn(&str, bool) + Send + Sync),
) -> Result<CommandOutcome, String> {
    // 1. Parsing dell'azione
    let action = parse_action(&request.action)?;

    // 2. Identificazione piattaforma OS corrente
    let current_os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };

    // 3. Controllo piattaforme ammesse
    if !action.platforms.is_empty()
        && !action
            .platforms
            .iter()
            .any(|p| p.eq_ignore_ascii_case(current_os))
    {
        return Err(format!(
            "Piattaforma corrente '{}' non supportata dall'azione (supportate: {:?})",
            current_os, action.platforms
        ));
    }

    // 4. Risoluzione della variante effettiva per l'OS corrente
    let variant = action.effective_variant(current_os);

    // 5. Divieto di sicurezza assoluto su PowerShell
    if is_powershell(&variant.command) || is_powershell(&variant.interpreter) {
        return Err(
            "Esecuzione di PowerShell / pwsh / script .ps1 non consentita dalle policy di sicurezza di Studio (AUT-035/ACC-16)"
                .to_string(),
        );
    }
    for arg in &variant.args {
        if arg.ends_with(".ps1") {
            return Err(
                "Argomento script .ps1 non consentito dalle policy di sicurezza di Studio (AUT-035/ACC-16)"
                    .to_string(),
            );
        }
    }

    // 6. Validazione della working directory esplicita
    if !request.cwd.exists() || !request.cwd.is_dir() {
        return Err(format!(
            "Directory di lavoro non valida o inesistente: {}",
            request.cwd.display()
        ));
    }

    // 7. Risoluzione ambiente: ereditato + override + vault refs (fail-closed)
    let mut env_map: HashMap<String, String> = std::env::vars().collect();
    for (k, v) in &action.environment {
        env_map.insert(k.clone(), v.clone());
    }
    for (k, v) in &request.environment {
        env_map.insert(k.clone(), v.clone());
    }

    let mut secrets_to_mask: Vec<String> = Vec::new();
    for (env_var, secret_id) in &action.secret_refs {
        let secret_val = super::secrets::get(secret_id).map_err(|err| {
            format!(
                "Risoluzione segreto vault fallita (fail-closed) per '{}' (variabile '{}'): {}",
                secret_id, env_var, err
            )
        })?;
        if !secret_val.is_empty() {
            secrets_to_mask.push(secret_val.clone());
        }
        env_map.insert(env_var.clone(), secret_val);
    }
    // Ordina i segreti per lunghezza decrescente per evitare sostituzioni parziali
    secrets_to_mask.sort_by(|a, b| b.len().cmp(&a.len()));

    // Iniezione sicura del percorso contesto JSON via variabile OMP_AUTOMATION_CONTEXT (nessuna interpolazione)
    env_map.insert(
        "OMP_AUTOMATION_CONTEXT".to_string(),
        request.context_path.to_string_lossy().to_string(),
    );

    // Su piattaforme Unix garantisce "sh senza profili": rimuove BASH_ENV e ENV
    // ereditati se non sovrascritti esplicitamente dall'automazione, per evitare che
    // sh o bash eseguano script non tracciati all'avvio (AUT-035).
    #[cfg(not(target_os = "windows"))]
    {
        if !action.environment.contains_key("BASH_ENV")
            && !request.environment.contains_key("BASH_ENV")
        {
            env_map.remove("BASH_ENV");
        }
        if !action.environment.contains_key("ENV") && !request.environment.contains_key("ENV") {
            env_map.remove("ENV");
        }
    }

    // 8. Costruzione del comando di processo in base alla modalita'
    let mut cmd: Command;
    let mode_clean = variant.mode.trim().to_ascii_lowercase();

    match mode_clean.as_str() {
        "shell" => {
            #[cfg(target_os = "windows")]
            {
                cmd = Command::new("cmd.exe");
                cmd.args(["/d", "/c", &variant.command]);
                if !variant.args.is_empty() {
                    cmd.args(&variant.args);
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let interp = if variant.interpreter.is_empty() {
                    "sh"
                } else {
                    variant.interpreter.as_str()
                };

                if interp == "sh" || interp == "/bin/sh" {
                    cmd = Command::new("/bin/sh");
                    cmd.args(["-c", &variant.command]);
                } else if interp.ends_with("bash") {
                    cmd = Command::new(interp);
                    cmd.args(["--noprofile", "--norc", "-c", &variant.command]);
                } else if interp.ends_with("zsh") {
                    cmd = Command::new(interp);
                    cmd.args(["-f", "-c", &variant.command]);
                } else {
                    cmd = Command::new(interp);
                    cmd.args(["-c", &variant.command]);
                }

                if !variant.args.is_empty() {
                    cmd.arg(interp);
                    cmd.args(&variant.args);
                }
            }
        }
        "executable" => {
            #[cfg(target_os = "windows")]
            {
                let (resolved_cmd, is_batch) =
                    resolve_windows_executable(&variant.command, &request.cwd);
                if is_batch {
                    cmd = Command::new("cmd.exe");
                    cmd.args(["/d", "/c", &resolved_cmd]);
                    cmd.args(&variant.args);
                } else {
                    cmd = Command::new(&resolved_cmd);
                    cmd.args(&variant.args);
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                cmd = Command::new(&variant.command);
                cmd.args(&variant.args);
            }
        }
        "script" => {
            let script_path = if Path::new(&variant.command).is_absolute() {
                PathBuf::from(&variant.command)
            } else {
                request.cwd.join(&variant.command)
            };

            if !script_path.is_file() {
                return Err(format!(
                    "File di script '{}' non trovato o non accessibile in '{}'",
                    variant.command,
                    request.cwd.display()
                ));
            }

            let ext = script_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if ext.eq_ignore_ascii_case("ps1") {
                return Err(
                    "Esecuzione di script PowerShell (.ps1) non consentita dalle policy di sicurezza di Studio (AUT-035/ACC-16)"
                        .to_string(),
                );
            }

            if !variant.interpreter.is_empty() {
                if is_powershell(&variant.interpreter) {
                    return Err(
                        "Interprete PowerShell non consentito dalle policy di sicurezza di Studio (AUT-035/ACC-16)"
                            .to_string(),
                    );
                }

                #[cfg(target_os = "windows")]
                {
                    let (resolved_interp, is_batch) =
                        resolve_windows_executable(&variant.interpreter, &request.cwd);
                    if is_batch {
                        cmd = Command::new("cmd.exe");
                        cmd.args(["/d", "/c", &resolved_interp, &script_path.to_string_lossy()]);
                        cmd.args(&variant.args);
                    } else {
                        cmd = Command::new(&resolved_interp);
                        cmd.arg(&script_path);
                        cmd.args(&variant.args);
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    cmd = Command::new(&variant.interpreter);
                    cmd.arg(&script_path);
                    cmd.args(&variant.args);
                }
            } else {
                let ext_lower = ext.to_ascii_lowercase();
                match ext_lower.as_str() {
                    "py" => {
                        let py_bin = if cfg!(target_os = "windows") {
                            "python"
                        } else {
                            "python3"
                        };
                        cmd = Command::new(py_bin);
                        cmd.arg(&script_path);
                        cmd.args(&variant.args);
                    }
                    "js" | "mjs" | "cjs" => {
                        cmd = Command::new("node");
                        cmd.arg(&script_path);
                        cmd.args(&variant.args);
                    }
                    "bat" | "cmd" => {
                        #[cfg(target_os = "windows")]
                        {
                            cmd = Command::new("cmd.exe");
                            cmd.args(["/d", "/c", &script_path.to_string_lossy()]);
                            cmd.args(&variant.args);
                        }
                        #[cfg(not(target_os = "windows"))]
                        {
                            return Err(
                                "File batch .bat/.cmd non supportati su sistemi POSIX".to_string()
                            );
                        }
                    }
                    "sh" => {
                        #[cfg(not(target_os = "windows"))]
                        {
                            cmd = Command::new("/bin/sh");
                            cmd.arg(&script_path);
                            cmd.args(&variant.args);
                        }
                        #[cfg(target_os = "windows")]
                        {
                            cmd = Command::new("sh");
                            cmd.arg(&script_path);
                            cmd.args(&variant.args);
                        }
                    }
                    _ => {
                        #[cfg(not(target_os = "windows"))]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let is_exec = script_path
                                .metadata()
                                .map(|m| (m.permissions().mode() & 0o111) != 0)
                                .unwrap_or(false);
                            if is_exec {
                                cmd = Command::new(&script_path);
                                cmd.args(&variant.args);
                            } else {
                                cmd = Command::new("/bin/sh");
                                cmd.arg(&script_path);
                                cmd.args(&variant.args);
                            }
                        }
                        #[cfg(target_os = "windows")]
                        {
                            return Err(format!(
                                "Nessun interprete specificato per lo script con estensione '.{}' su Windows",
                                ext_lower
                            ));
                        }
                    }
                }
            }
        }
        other => {
            return Err(format!(
                "Modalita' di comando '{}' non supportata (valide: 'shell', 'executable', 'script')",
                other
            ));
        }
    }

    // 9. Configurazione I/O e parametri di processo
    cmd.current_dir(&request.cwd);
    cmd.envs(&env_map);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    // 10. Avvio del processo
    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Impossibile avviare il processo '{}' in '{}': {}",
            variant.command,
            request.cwd.display(),
            e
        )
    })?;
    let pid = child.id();

    // 11. Associazione al Windows Job Object (su Windows)
    #[cfg(target_os = "windows")]
    let job = match crate::process_tree::WindowsJob::create_for_process(pid) {
        Ok(j) => Some(j),
        Err(e) => {
            eprintln!(
                "[runner] Avviso: associazione a Windows Job Object fallita per PID {}: {}",
                pid, e
            );
            None
        }
    };

    // 12. Drenaggio simultaneo di stdout e stderr su thread separati
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossibile acquisire stdout del processo".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Impossibile acquisire stderr del processo".to_string())?;

    let (tx, rx) = mpsc::channel::<(String, bool)>();
    let stdout_handle = drain_stream(stdout, false, secrets_to_mask.clone(), tx.clone());
    let stderr_handle = drain_stream(stderr, true, secrets_to_mask, tx);

    // 13. Ciclo di attesa con timeout, cancellazione e inoltro progressivo dell'output
    let start = Instant::now();
    let poll_interval = Duration::from_millis(50);
    let (outcome_state, outcome_detail, exit_code) = loop {
        // Inoltro progressivo dei messaggi di output ricevuti finora
        while let Ok((line, is_stderr)) = rx.try_recv() {
            on_output(&line, is_stderr);
        }

        // Controllo richiesta di cancellazione
        if cancel.load(Ordering::Relaxed) {
            break (
                "interrupted".to_string(),
                Some("Esecuzione annullata dall'utente".to_string()),
                None,
            );
        }

        // Controllo timeout
        if start.elapsed() >= request.timeout {
            break (
                "timeout".to_string(),
                Some(format!(
                    "Timeout superato dopo {}s (limite: {}s)",
                    start.elapsed().as_secs(),
                    request.timeout.as_secs()
                )),
                None,
            );
        }

        // Controllo stato uscita del processo
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code();
                if status.success() {
                    break ("completed".to_string(), None, code);
                } else {
                    let detail = Some(match code {
                        Some(c) => format!("Comando terminato con codice di errore {}", c),
                        None => "Comando terminato in modo anomalo da un segnale".to_string(),
                    });
                    break ("error".to_string(), detail, code);
                }
            }
            Ok(None) => {
                thread::sleep(poll_interval);
            }
            Err(e) => {
                break (
                    "error".to_string(),
                    Some(format!("Errore durante l'attesa del processo: {}", e)),
                    None,
                );
            }
        }
    };

    // 14. Gestione conclusione albero processi (interruzione forzata o pulizia figli orfani)
    if outcome_state == "interrupted" || outcome_state == "timeout" {
        // Chiusura ricorsiva dell'intero gruppo di processi
        #[cfg(target_os = "windows")]
        {
            crate::process_tree::kill_process_tree(Some(pid), job.as_ref());
            let drain_deadline = Instant::now() + Duration::from_millis(3000);
            while !crate::process_tree::job_drained(job.as_ref()) && Instant::now() < drain_deadline
            {
                thread::sleep(Duration::from_millis(50));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            crate::process_tree::kill_process_tree(Some(pid));
            let drain_deadline = Instant::now() + Duration::from_millis(3000);
            while crate::process_tree::process_group_alive(pid) && Instant::now() < drain_deadline {
                thread::sleep(Duration::from_millis(50));
            }
        }
        let _ = child.wait();
    } else {
        // Conclusione ordinaria: assicura che nessun processo figlio o nipote rimanga orfano in background
        #[cfg(target_os = "windows")]
        {
            if let Some(j) = &job {
                j.terminate();
            }
            let drain_deadline = Instant::now() + Duration::from_millis(1500);
            while !crate::process_tree::job_drained(job.as_ref()) && Instant::now() < drain_deadline
            {
                thread::sleep(Duration::from_millis(50));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            crate::process_tree::kill_orphaned_group(pid);
            let drain_deadline = Instant::now() + Duration::from_millis(1500);
            while crate::process_tree::process_group_alive(pid) && Instant::now() < drain_deadline {
                thread::sleep(Duration::from_millis(50));
            }
        }
    }

    // 15. Attesa conclusione dei lettori di output e drenaggio residuo
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    while let Ok((line, is_stderr)) = rx.try_recv() {
        on_output(&line, is_stderr);
    }

    Ok(CommandOutcome {
        state: outcome_state,
        exit_code,
        detail: outcome_detail,
    })
}
