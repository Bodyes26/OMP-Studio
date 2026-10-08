//! «Chiedi al diario» (Gate R41): risposta effimera dalla scheda Progetto.
//!
//! Stesso schema dei suggerimenti post-turno (`suggestions_ops.rs`): chiamata
//! `omp -p --no-session --no-tools` con il modello leggero, nessuna sessione
//! creata, nessuna scrittura. Il frontend sceglie le sezioni pertinenti del
//! diario e dei documenti e le passa come contesto: qui non si legge il disco,
//! cosi' il comando non puo' uscire dalla radice del progetto.

use crate::directives_ops::EphemeralOutcome;
use std::time::Duration;
use tauri::command;

/// Tempo massimo della risposta: una domanda all'utente non deve restare appesa.
const ASK_TIMEOUT_SECS: u64 = 60;

/// Tetto del contesto passato dal frontend (caratteri): oltre, si taglia la coda.
const ASK_CONTEXT_MAX_CHARS: usize = 24_000;

/// Tetto della domanda (caratteri).
const ASK_QUESTION_MAX_CHARS: usize = 600;

const SYSTEM_PROMPT: &str = r#"Rispondi a una domanda sul progetto usando SOLO gli estratti del diario e dei documenti di progetto nel file allegato.
Regole:
1. Rispondi in modo breve (al massimo 6 frasi), nella STESSA LINGUA della domanda, con parole semplici.
2. Cita le fonti come compaiono negli estratti: il percorso del file e, se c'e', la fonte tra parentesi quadre (es. [sessione 5b90c1a2], [commit 41aa0d1]).
3. Se gli estratti non contengono la risposta, dillo chiaramente in una frase e suggerisci di aggiungerla alle domande aperte. Non inventare.
4. Nessun preambolo, nessun blocco di codice."#;

fn take_chars(s: &str, max: usize) -> &str {
    s.char_indices().nth(max).map(|(i, _)| &s[..i]).unwrap_or(s)
}

/// Risposta alla domanda, o `None` se il modello non risponde in tempo.
#[command]
pub async fn project_docs_ask(
    question: String,
    context: String,
    model_selector: Option<String>,
) -> Result<Option<String>, String> {
    let question = question.trim().to_string();
    if question.is_empty() {
        return Ok(None);
    }
    let mut context_md = String::from("# Domanda\n");
    context_md.push_str(take_chars(&question, ASK_QUESTION_MAX_CHARS));
    context_md.push_str("\n\n# Estratti del diario e dei documenti di progetto\n");
    let trimmed_context = context.trim();
    if trimmed_context.is_empty() {
        context_md.push_str("(nessun estratto pertinente)\n");
    } else {
        context_md.push_str(take_chars(trimmed_context, ASK_CONTEXT_MAX_CHARS));
        context_md.push('\n');
    }

    let resolved_model =
        crate::directives_ops::resolve_assistant_model(model_selector.as_deref()).await;
    let spawned = tokio::task::spawn_blocking(move || {
        crate::directives_ops::run_ephemeral_omp(
            SYSTEM_PROMPT,
            Some(&context_md),
            "Rispondi alla domanda del file allegato rispettando le regole.",
            resolved_model.as_deref(),
            Duration::from_secs(ASK_TIMEOUT_SECS),
        )
    })
    .await;

    match spawned {
        // Avvio impossibile: e' un difetto di configurazione, va mostrato.
        Ok(Err(err)) => Err(err),
        Ok(Ok(EphemeralOutcome::Ok(text))) => {
            let answer = text.trim();
            Ok(if answer.is_empty() {
                None
            } else {
                Some(answer.to_string())
            })
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_chars_respects_utf8() {
        assert_eq!(take_chars("perché", 5), "perch");
        assert_eq!(take_chars("ciao", 10), "ciao");
    }

    #[tokio::test]
    async fn empty_question_returns_none() {
        let res = project_docs_ask("   ".to_string(), "x".to_string(), None).await;
        assert_eq!(res.unwrap(), None);
    }
}
