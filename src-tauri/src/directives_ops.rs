//! Operazioni AI per la gestione e l'ottimizzazione delle direttive dei task.
//!
//! Principi guida (docs/DECISIONS.md):
//! 1. **Esecuzione effimera e isolata.** L'invocazione di `omp` avviene con `-p --no-session --no-tools --no-skills --no-rules`,
//!    senza contaminare lo storico o le sessioni attive e senza tool abilitati.
//! 2. **Nessuna scrittura o applicazione automatica.** Tutte le proposte vengono restituite al frontend per revisione esplicita.
//! 3. **Modello leggero.** Viene utilizzato il modello configurato nel ruolo `smol` (o fallback su default), evitando consumi imprevisti.

use crate::omp_ops::{get_omp_binary, open_readonly_db};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Direttiva per i task (definizione di catalogo).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDirectiveDto {
    pub id: String,
    pub factory_key: Option<String>,
    pub name: String,
    pub description: String,
    pub tag: String,
    pub prompt: String,
    pub placement: String, // "before" | "after"
    pub order: u32,
    pub revision: u32,
    pub hidden: Option<bool>,
}

/// Proposta generata o raffinata dall'AI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDirectiveAiProposal {
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub tag: String,
    pub prompt: String,
    pub placement: String, // "before" | "after"
    pub reason: Option<String>,
}

/// Risolve il selettore del modello da usare per l'assistente effimero.
/// Priorità: 1. `model_selector` esplicito se fornito; 2. ruolo `smol` da config; 3. ruolo `default` da config; 4. None.
pub(crate) async fn resolve_assistant_model(model_override: Option<&str>) -> Option<String> {
    if let Some(m) = model_override {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Ok(config) = crate::models_ops::get_model_config().await {
        if let Some(smol) = config.model_roles.get("smol") {
            let clean = smol.split(':').next().unwrap_or(smol).trim();
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
        if let Some(def) = config.model_roles.get("default") {
            let clean = def.split(':').next().unwrap_or(def).trim();
            if !clean.is_empty() {
                return Some(clean.to_string());
            }
        }
    }

    None
}

/// Estrae il primo blocco JSON valido da una stringa (gestisce anche markdown ```json ... ```).
pub fn extract_json_payload(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Risposta del modello vuota".to_string());
    }

    // Se racchiuso in fence markdown ```json ... ``` o ``` ... ```
    if let Some(start) = trimmed.find("```") {
        let after_fence = &trimmed[start + 3..];
        let content_start = if let Some(newline) = after_fence.find('\n') {
            newline + 1
        } else {
            0
        };
        let inner = &after_fence[content_start..];
        if let Some(end) = inner.find("```") {
            let fenced_content = inner[..end].trim();
            if !fenced_content.is_empty() {
                return Ok(fenced_content.to_string());
            }
        }
    }

    // Ricerca diretta di oggetto {...} o array [...]
    let first_obj = trimmed.find('{');
    let first_arr = trimmed.find('[');

    match (first_obj, first_arr) {
        (Some(o), Some(a)) => {
            if o < a {
                if let Some(last_o) = trimmed.rfind('}') {
                    if last_o > o {
                        return Ok(trimmed[o..=last_o].to_string());
                    }
                }
            } else if let Some(last_a) = trimmed.rfind(']') {
                if last_a > a {
                    return Ok(trimmed[a..=last_a].to_string());
                }
            }
        }
        (Some(o), None) => {
            if let Some(last_o) = trimmed.rfind('}') {
                if last_o > o {
                    return Ok(trimmed[o..=last_o].to_string());
                }
            }
        }
        (None, Some(a)) => {
            if let Some(last_a) = trimmed.rfind(']') {
                if last_a > a {
                    return Ok(trimmed[a..=last_a].to_string());
                }
            }
        }
        (None, None) => {}
    }

    Ok(trimmed.to_string())
}

/// Guardia per garantire la cancellazione automatica di un file temporaneo su qualsiasi via d'uscita (Drop).
struct TempFileGuard {
    path: std::path::PathBuf,
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Esito di una chiamata effimera a `omp`.
pub(crate) enum EphemeralOutcome {
    /// Il processo ha risposto correttamente.
    Ok(String),
    /// Il processo e' uscito con codice non zero: il messaggio e' quello di stderr.
    Failed(String),
    /// Il processo non ha risposto entro il tempo massimo ed e' stato terminato.
    TimedOut,
}

/// Tempo massimo concesso a una chiamata effimera prima della terminazione forzata.
pub(crate) const EPHEMERAL_TIMEOUT: Duration = Duration::from_secs(90);

/// Esegue una chiamata effimera a `omp -p --no-session` e raccoglie l'output standard.
///
/// Su Windows, l'API Win32 `CreateProcessW` impone un limite rigido di 32.767 caratteri
/// per l'intera riga di comando. Quando `context` è fornito, viene salvato in un file
/// temporaneo e passato come argomento `@<percorso>` prima di `user_prompt`, garantendo
/// che in argv viaggino solo stringhe costanti e brevi per evitare `os error 206`.
///
/// Il processo viene terminato allo scadere di `timeout`: senza questa rete un `omp`
/// bloccato terrebbe occupato per sempre il thread che ha invocato il comando.
pub(crate) fn run_ephemeral_omp(
    system_prompt: &str,
    context: Option<&str>,
    user_prompt: &str,
    model_selector: Option<&str>,
    timeout: Duration,
) -> Result<EphemeralOutcome, String> {
    // Guardia difensiva: se la combinazione di system_prompt e user_prompt supera 24.000 byte,
    // restituiamo un errore esplicito in italiano spiegando che il contenuto voluminoso va passato
    // nel contesto su file temporaneo, anziché far fallire CreateProcessW con os error 206.
    if system_prompt.len() + user_prompt.len() > 24_000 {
        return Err(
            "La dimensione combinata di system_prompt e user_prompt supera la soglia di sicurezza (24.000 byte). \
             Il contenuto voluminoso o variabile deve essere passato tramite il parametro `context` su file temporaneo \
             per rispettare il limite Win32 di 32.767 caratteri per la riga di comando.".to_string()
        );
    }

    // Se context è presente, viene scritto in un file temporaneo con nome univoco.
    // La guardia TempFileGuard ne assicura la cancellazione automatica su qualsiasi via d'uscita.
    let (_guard, context_file_arg) = if let Some(ctx) = context.filter(|c| !c.trim().is_empty()) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let filename = format!("omp-studio-ctx-{}-{}.md", now, pid);
        let temp_path = std::env::temp_dir().join(filename);

        std::fs::write(&temp_path, ctx)
            .map_err(|e| format!("Scrittura file temporaneo di contesto fallita: {}", e))?;

        let normalized_path = temp_path.to_string_lossy().replace('\\', "/");
        let arg = format!("@{}", normalized_path);
        let guard = TempFileGuard { path: temp_path };
        (Some(guard), Some(arg))
    } else {
        (None, None)
    };

    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);

    cmd.arg("-p");
    cmd.arg("--no-session");
    cmd.arg("--no-tools");
    cmd.arg("--no-skills");
    cmd.arg("--no-rules");
    cmd.arg("--no-title");
    cmd.arg("--system-prompt").arg(system_prompt);

    if let Some(model) = model_selector {
        cmd.arg("--model").arg(model);
    }

    if let Some(ctx_arg) = context_file_arg {
        cmd.arg(ctx_arg);
    }

    cmd.arg(user_prompt);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Avvio processo omp fallito: {}", e))?;

    // Le pipe si leggono su thread dedicati: riempiendosi bloccherebbero il child
    // prima ancora che possa terminare, e l'attesa non scadrebbe mai.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    // Terminazione forzata piu' attesa, per non lasciare processi orfani
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Attesa del processo omp fallita: {}", e)),
        }
    };

    let stdout_bytes = stdout_reader.join().unwrap_or_default();
    let stderr_bytes = stderr_reader.join().unwrap_or_default();

    let Some(status) = status else {
        return Ok(EphemeralOutcome::TimedOut);
    };

    if !status.success() {
        let stderr_msg = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
        return Ok(EphemeralOutcome::Failed(if stderr_msg.is_empty() {
            format!("omp è terminato con codice di errore {:?}", status.code())
        } else {
            stderr_msg
        }));
    }

    Ok(EphemeralOutcome::Ok(
        String::from_utf8_lossy(&stdout_bytes).trim().to_string(),
    ))
}

/// Variante che considera errore qualunque esito diverso da una risposta valida.
pub(crate) fn run_ephemeral_omp_raw(
    system_prompt: &str,
    context: Option<&str>,
    user_prompt: &str,
    model_selector: Option<&str>,
) -> Result<String, String> {
    match run_ephemeral_omp(
        system_prompt,
        context,
        user_prompt,
        model_selector,
        EPHEMERAL_TIMEOUT,
    )? {
        EphemeralOutcome::Ok(out) => Ok(out),
        EphemeralOutcome::Failed(msg) => Err(msg),
        EphemeralOutcome::TimedOut => Err(format!(
            "omp non ha risposto entro {} secondi ed è stato interrotto",
            EPHEMERAL_TIMEOUT.as_secs()
        )),
    }
}


/// Genera una nuova direttiva per task a partire da un obiettivo o argomento descritto dall'utente.
#[command]
pub async fn generate_task_directive_ai(
    topic: String,
    context: Option<String>,
    model_selector: Option<String>,
) -> Result<TaskDirectiveAiProposal, String> {
    let topic_trimmed = topic.trim();
    if topic_trimmed.is_empty() {
        return Err("L'argomento o obiettivo della direttiva non può essere vuoto".to_string());
    }

    let system_prompt = r#"Sei un assistente esperto di prompt engineering per agenti software (Oh My Pi / OMP).
Il tuo compito è creare una singola direttiva di prompt per task riutilizzabile.

Devi rispondere ESCLUSIVAMENTE con un oggetto JSON valido (senza testo introduttivo o conclusivo) con la seguente struttura esatta:
{
  "name": "Nome conciso della modalità (es. Verifica Rigorosa)",
  "description": "Breve descrizione dell'effetto (max 120 caratteri)",
  "tag": "Etichetta compatta (max 16 caratteri, es. /test-first o Audit)",
  "prompt": "[Direttiva: Istruzioni operative chiare, imperative e precise per l'agente. Es. Esegui sempre i test unitari prima di concludere.]",
  "placement": "before", // "before" se deve istruire l'agente prima del compito, oppure "after" se è una post-condizione
  "reason": "Spiegazione sintetica del perché è utile"
}"#;

    let (context_payload, user_prompt) = match context.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(ctx) => {
            let md = format!(
                "# Obiettivo Direttiva\n{}\n\n# Contesto o Vincoli Aggiuntivi\n{}",
                topic_trimmed, ctx
            );
            (
                Some(md),
                "Crea una direttiva di prompt per l'obiettivo e i vincoli specificati nel file allegato.".to_string(),
            )
        }
        None => {
            (
                None,
                format!(
                    "Crea una direttiva di prompt per questo obiettivo:\n\"{}\"",
                    topic_trimmed
                ),
            )
        }
    };

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(
            system_prompt,
            context_payload.as_deref(),
            &user_prompt,
            resolved_model.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;
    let json_text = extract_json_payload(&raw_response)?;
    let proposal: TaskDirectiveAiProposal = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Parsing risposta AI non riuscito: {}. Risposta grezza: {}",
            e, raw_response
        )
    })?;

    Ok(proposal)
}

/// Raffina o migliora una direttiva esistente applicando feedback o istruzioni di ottimizzazione.
#[command]
pub async fn refine_task_directive_ai(
    directive: TaskDirectiveDto,
    feedback: String,
    model_selector: Option<String>,
) -> Result<TaskDirectiveAiProposal, String> {
    let system_prompt = r#"Sei un assistente esperto di prompt engineering per agenti software (Oh My Pi / OMP).
Il tuo compito è perfezionare e ottimizzare una direttiva di prompt esistente seguendo il feedback dell'utente.

Devi rispondere ESCLUSIVAMENTE con un oggetto JSON valido con la seguente struttura esatta:
{
  "name": "Nome conciso e chiaro",
  "description": "Descrizione sintetica migliorata",
  "tag": "Etichetta compatta",
  "prompt": "[Direttiva: Testo raffinato e ottimizzato, rigoroso ed esplicito per l'agente]",
  "placement": "before", // "before" o "after"
  "reason": "Spiegazione delle modifiche e miglioramenti apportati"
}"#;

    let context_md = format!(
        "# Direttiva Attuale\n- Nome: {}\n- Tag: {}\n- Posizione: {}\n- Descrizione: {}\n- Prompt:\n{}\n\n# Feedback / Istruzioni di Miglioramento\n{}",
        directive.name,
        directive.tag,
        directive.placement,
        directive.description,
        directive.prompt,
        if feedback.trim().is_empty() {
            "Rendi il prompt più chiaro, rigoroso ed efficace secondo le best practice di prompt engineering."
        } else {
            feedback.trim()
        }
    );
    let user_prompt = "Perfeziona la direttiva descritta nel file allegato secondo il feedback fornito e rispondi solo con il JSON richiesto.";

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(
            system_prompt,
            Some(&context_md),
            user_prompt,
            resolved_model.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;
    let json_text = extract_json_payload(&raw_response)?;
    let mut proposal: TaskDirectiveAiProposal = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Parsing risposta AI non riuscito: {}. Risposta grezza: {}",
            e, raw_response
        )
    })?;

    proposal.id = Some(directive.id);
    Ok(proposal)
}

/// Raccoglie i prompt recenti di un progetto da history.db e da .omp/tasks.json.
fn collect_project_recent_prompts(project_path: &str, limit: usize) -> Vec<String> {
    let mut prompts = Vec::new();

    // 1. Da history.db (prompt delle sessioni del progetto)
    if let Ok(conn) = open_readonly_db("history.db") {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT prompt FROM history
             WHERE cwd = ?1 COLLATE NOCASE AND prompt NOT LIKE '/%'
             ORDER BY created_at DESC
             LIMIT ?2",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![project_path, limit as i64], |row| {
                row.get::<_, String>(0)
            }) {
                for p in rows.flatten() {
                    let trimmed = p.trim().to_string();
                    if !trimmed.is_empty() && !prompts.contains(&trimmed) {
                        prompts.push(trimmed);
                    }
                }
            }
        }
    }

    // 2. Da .omp/tasks.json (task in coda o recenti)
    let tasks_file = Path::new(project_path).join(".omp").join("tasks.json");
    if let Ok(content) = fs::read_to_string(&tasks_file) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            let task_list = if let Some(arr) = parsed.as_array() {
                Some(arr)
            } else {
                parsed.get("tasks").and_then(|t| t.as_array())
            };
            if let Some(tasks) = task_list {
                for t in tasks {
                    if let Some(p) = t.get("prompt").and_then(|s| s.as_str()) {
                        let trimmed = p.trim().to_string();
                        if !trimmed.is_empty() && !prompts.contains(&trimmed) {
                            prompts.push(trimmed);
                        }
                    }
                }
            }
        }
    }

    prompts.truncate(limit);
    prompts
}

/// Analizza i prompt e le richieste recenti del progetto per proporre nuove direttive ricorrenti.
#[command]
pub async fn analyze_task_directives_friction(
    project_path: String,
    existing_directives: Vec<TaskDirectiveDto>,
    model_selector: Option<String>,
) -> Result<Vec<TaskDirectiveAiProposal>, String> {
    let prompts = collect_project_recent_prompts(&project_path, 30);

    if prompts.len() < 2 {
        return Ok(Vec::new());
    }

    let system_prompt = r#"Sei un assistente di analisi per agenti software (Oh My Pi / OMP).
Analizza i prompt e le richieste recenti dell'utente in questo progetto e identifica se esistono schemi, vincoli o istruzioni ricorrenti (ad es. convenzioni sui test, regole di stile, documentazione, controllo modifiche) che beneficerebbero di una direttiva riutilizzabile dedicata.

NON proporre direttive per concetti già chiaramente coperti dalle direttive esistenti.

Devi rispondere ESCLUSIVAMENTE con un array JSON di proposte (da 0 a 3 elementi):
[
  {
    "name": "Nome conciso (es. Standard Test & Verifica)",
    "description": "Descrizione sintetica del vincolo ricorrente",
    "tag": "Etichetta compatta",
    "prompt": "[Direttiva: Testo imperativo chiaro per l'agente]",
    "placement": "before",
    "reason": "Rilevato in X prompt recenti: spiegazione sintetica dell'attrito"
  }
]"#;

    let existing_desc = existing_directives
        .iter()
        .map(|d| {
            format!(
                "- {} (tag: {}, pos: {}): {}",
                d.name, d.tag, d.placement, d.description
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompts_list = prompts
        .iter()
        .enumerate()
        .map(|(idx, p)| format!("{}. {}", idx + 1, p))
        .collect::<Vec<_>>()
        .join("\n");

    let context_md = format!(
        "# Direttive Attualmente Esistenti\n{}\n\n# Prompt Recenti nel Progetto\n{}",
        if existing_desc.is_empty() {
            "Nessuna direttiva personalizzata."
        } else {
            &existing_desc
        },
        prompts_list
    );
    let user_prompt = "Analizza i prompt e le direttive esistenti descritte nel file allegato e proponi da 0 a 3 direttive ricorrenti in formato JSON.";

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(
            system_prompt,
            Some(&context_md),
            user_prompt,
            resolved_model.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;
    let json_text = extract_json_payload(&raw_response)?;
    let proposals: Vec<TaskDirectiveAiProposal> =
        serde_json::from_str(&json_text).map_err(|e| {
            format!(
                "Parsing array proposte AI non riuscito: {}. Risposta grezza: {}",
                e, raw_response
            )
        })?;

    Ok(proposals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_payload_plain() {
        let raw = r#"{"name": "Test", "description": "Desc", "tag": "test", "prompt": "P", "placement": "before"}"#;
        let extracted = extract_json_payload(raw).unwrap();
        assert_eq!(extracted, raw);
    }

    #[test]
    fn test_extract_json_payload_fenced() {
        let raw = "Ecco la direttiva richiesta:\n```json\n{\n  \"name\": \"Test\",\n  \"description\": \"Desc\",\n  \"tag\": \"test\",\n  \"prompt\": \"P\",\n  \"placement\": \"before\"\n}\n```\nSpero sia utile!";
        let extracted = extract_json_payload(raw).unwrap();
        assert!(extracted.starts_with('{'));
        assert!(extracted.ends_with('}'));
        let parsed: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(parsed["name"], "Test");
    }

    #[test]
    fn test_extract_json_payload_array() {
        let raw = "Proposte:\n```\n[\n  {\"name\": \"P1\", \"description\": \"D1\", \"tag\": \"t1\", \"prompt\": \"p1\", \"placement\": \"before\"}\n]\n```";
        let extracted = extract_json_payload(raw).unwrap();
        let parsed: Vec<TaskDirectiveAiProposal> = serde_json::from_str(&extracted).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "P1");
    }
}
