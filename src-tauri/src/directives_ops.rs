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
use std::path::Path;
use std::process::Command;
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
async fn resolve_assistant_model(model_override: Option<&str>) -> Option<String> {
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

/// Esegue una chiamata effimera a `omp -p --no-session` e raccoglie l'output standard.
fn run_ephemeral_omp_raw(
    system_prompt: &str,
    user_prompt: &str,
    model_selector: Option<&str>,
) -> Result<String, String> {
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

    cmd.arg(user_prompt);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Avvio processo omp fallito: {}", e))?;

    if !output.status.success() {
        let stderr_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr_msg.is_empty() {
            format!("omp è terminato con codice di errore {:?}", output.status.code())
        } else {
            stderr_msg
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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

    let mut user_prompt = format!("Crea una direttiva di prompt per questo obiettivo:\n\"{}\"", topic_trimmed);
    if let Some(ctx) = context.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        user_prompt.push_str(&format!("\n\nContesto aggiuntivo o vincoli:\n{}", ctx));
    }

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(system_prompt, &user_prompt, resolved_model.as_deref())
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;

    let json_text = extract_json_payload(&raw_response)?;
    let proposal: TaskDirectiveAiProposal = serde_json::from_str(&json_text)
        .map_err(|e| format!("Parsing risposta AI non riuscito: {}. Risposta grezza: {}", e, raw_response))?;

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

    let user_prompt = format!(
        "Direttiva attuale:\n- Nome: {}\n- Tag: {}\n- Posizione: {}\n- Descrizione: {}\n- Prompt:\n{}\n\nFeedback / Istruzioni di miglioramento:\n{}",
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

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(system_prompt, &user_prompt, resolved_model.as_deref())
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;

    let json_text = extract_json_payload(&raw_response)?;
    let mut proposal: TaskDirectiveAiProposal = serde_json::from_str(&json_text)
        .map_err(|e| format!("Parsing risposta AI non riuscito: {}. Risposta grezza: {}", e, raw_response))?;

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
        .map(|d| format!("- {} (tag: {}, pos: {}): {}", d.name, d.tag, d.placement, d.description))
        .collect::<Vec<_>>()
        .join("\n");

    let prompts_list = prompts
        .iter()
        .enumerate()
        .map(|(idx, p)| format!("{}. {}", idx + 1, p))
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "Direttive attualmente già esistenti nel catalogo:\n{}\n\nPrompt recenti dell'utente in questo progetto:\n{}",
        if existing_desc.is_empty() { "Nessuna direttiva personalizzata." } else { &existing_desc },
        prompts_list
    );

    let resolved_model = resolve_assistant_model(model_selector.as_deref()).await;
    let raw_response = tokio::task::spawn_blocking(move || {
        run_ephemeral_omp_raw(system_prompt, &user_prompt, resolved_model.as_deref())
    })
    .await
    .map_err(|e| format!("Task thread interrotto: {}", e))??;

    let json_text = extract_json_payload(&raw_response)?;
    let proposals: Vec<TaskDirectiveAiProposal> = serde_json::from_str(&json_text)
        .map_err(|e| format!("Parsing array proposte AI non riuscito: {}. Risposta grezza: {}", e, raw_response))?;

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
