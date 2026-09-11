//! Operazioni AI per la generazione di suggerimenti rapidi di prompt nel composer.
//!
//! Principi guida:
//! 1. **Esecuzione effimera e isolata.** L'invocazione di `omp` avviene con `-p --no-session --no-tools --no-skills --no-rules`,
//!    senza contaminare lo storico delle sessioni attive e senza tool o skill abilitati.
//! 2. **Nessuna scrittura automatica.** I suggerimenti vengono restituiti al frontend solo per precompilare il composer su richiesta dell'utente.
//! 3. **Modello leggero.** Viene utilizzato il modello configurato nel ruolo `smol` (o fallback su `default` o selettore esplicito),
//!    riducendo al minimo costi e latenza.
//! 4. **Fallimento silenzioso.** Qualsiasi errore di timeout o di parsing restituisce un array vuoto, evitando di mostrare toast o errori
//!    invisibili per una funzionalita' accessoria.

use crate::directives_ops::EphemeralOutcome;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;
use tauri::command;
/// Timeout massimo di sicurezza (secondi) per l'esecuzione del processo omp effimero.
const SUGGESTIONS_TIMEOUT_SECS: u64 = 30;

/// Risultato strutturato dell'analisi rapida post-turno dell'assistente.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptSuggestionsResult {
    /// Risposte rapide consigliate per il composer o la card interattiva.
    pub suggestions: Vec<String>,
    /// Indica se l'agente e' fermo in attesa di una risposta, decisione o conferma dell'utente.
    pub awaits_user_input: bool,
    /// Sintesi breve della domanda o richiesta posta dall'agente (es. "Confermi e procedo?").
    pub question_summary: Option<String>,
}

impl PromptSuggestionsResult {
    pub fn empty() -> Self {
        Self {
            suggestions: Vec::new(),
            awaits_user_input: false,
            question_summary: None,
        }
    }
}

/// Payload grezzo atteso dal modello (con tolleranza e camelCase).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStructuredSuggestions {
    #[serde(default)]
    awaits_user_input: Option<bool>,
    #[serde(default)]
    question_summary: Option<String>,
    #[serde(default)]
    suggestions: Vec<String>,
}

/// Prompt di sistema per l'analisi del turno e la generazione di risposte rapide.
const SYSTEM_PROMPT: &str = r#"Sei un assistente specializzato nell'analizzare l'ultimo messaggio di un agente di coding (Oh My Pi / OMP) e suggerire le risposte rapide piu' probabili che lo sviluppatore darebbe.
Ricevi l'ultimo messaggio dell'agente e il prompt precedente dell'utente.

Regole tassative:
1. Rispondi ESCLUSIVAMENTE con un oggetto JSON valido avente questa struttura esatta:
{
  "awaitsUserInput": true | false,
  "questionSummary": "domanda o richiesta di conferma sintetica (max 120 caratteri) oppure null",
  "suggestions": ["risposta 1", "risposta 2"]
}
Nessun testo introduttivo, nessun commento, nessun blocco markdown prima o dopo.

2. Campo "awaitsUserInput":
   - Deve essere TRUE se l'agente ha terminato il turno ponendo una domanda diretta, chiedendo conferma per procedere (es. "Confermi e procedo?", "Vuoi che applichi le modifiche?"), presentando opzioni tra cui scegliere, o sollecitando un input/decisione dell'utente.
   - Deve essere FALSE se l'agente ha semplicemente terminato un compito informativo o esecutivo senza richiedere nulla (es. "Ho corretto il file", "Ecco il risultato").

3. Campo "questionSummary":
   - Se awaitsUserInput e' true, estrai la domanda o richiesta di conferma principale in modo conciso e pulito (max 120 caratteri, es. "Confermi e procedo dalla Fase 1?", "Quale approccio preferisci tra A e B?").
   - Se awaitsUserInput e' false, imposta questionSummary a null.

4. Campo "suggestions":
   - Array con al massimo N stringhe di risposta pronta da inviare, scritte in PRIMA PERSONA come la scriverebbe l'utente (es. "Procedi pure", "Spiega la scelta", "Mostrami prima il diff").
   - Massimo 60 caratteri per ogni stringa.
   - Scrivi nella STESSA LINGUA dell'ultimo messaggio dell'agente.
   - Se l'agente ha presentato un piano o chiede conferma, la prima risposta deve essere l'approvazione (es. "Procedi pure").
   - Se l'agente ha posto una domanda a scelta multipla, includi opzioni plausibili.
   - Se non hai nulla di utile da proporre, usa []."#;

/// Tronca una stringa preservando gli ultimi `max_chars` caratteri (la coda) su confini UTF-8 validi.
fn truncate_suffix_chars(s: &str, max_chars: usize) -> &str {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s
    } else {
        let skip_count = char_count - max_chars;
        s.char_indices()
            .nth(skip_count)
            .map(|(idx, _)| &s[idx..])
            .unwrap_or(s)
    }
}

/// Tronca una stringa preservando i primi `max_chars` caratteri (il prefisso) su confini UTF-8 validi.
fn truncate_prefix_chars(s: &str, max_chars: usize) -> &str {
    s.char_indices()
        .nth(max_chars)
        .map(|(idx, _)| &s[..idx])
        .unwrap_or(s)
}

/// Ripulisce e deduplica le stringhe dei suggerimenti.
fn clean_suggestion_strings(raw_items: Vec<String>, max_items: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::with_capacity(max_items);

    for item in raw_items {
        let trimmed = item.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 90 {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if seen.insert(lower) {
            cleaned.push(trimmed.to_string());
            if cleaned.len() >= max_items {
                break;
            }
        }
    }

    cleaned
}

/// Estrae e ripulisce il risultato strutturato dal testo grezzo prodotto dal modello.
pub(crate) fn parse_and_clean_suggestions(
    raw_response: &str,
    max_items: usize,
) -> PromptSuggestionsResult {
    let json_text = match crate::directives_ops::extract_json_payload(raw_response) {
        Ok(j) => j,
        Err(_) => return PromptSuggestionsResult::empty(),
    };

    // Caso 1: Oggetto JSON strutturato (formato primario)
    if let Ok(structured) = serde_json::from_str::<RawStructuredSuggestions>(&json_text) {
        let cleaned_suggestions = clean_suggestion_strings(structured.suggestions, max_items);
        let awaits = structured.awaits_user_input.unwrap_or_else(|| {
            // Euristica di riserva: se questionSummary e' presente o i suggerimenti iniziano con approvazione
            structured.question_summary.is_some()
        });
        let summary = structured.question_summary.and_then(|q| {
            let trimmed = q.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(truncate_prefix_chars(trimmed, 120).to_string())
            }
        });

        return PromptSuggestionsResult {
            suggestions: cleaned_suggestions,
            awaits_user_input: awaits,
            question_summary: summary,
        };
    }

    // Caso 2: Fallback retrocompatibile - array semplice di stringhe
    if let Ok(items) = serde_json::from_str::<Vec<String>>(&json_text) {
        let cleaned = clean_suggestion_strings(items, max_items);
        return PromptSuggestionsResult {
            suggestions: cleaned,
            awaits_user_input: false,
            question_summary: None,
        };
    }

    PromptSuggestionsResult::empty()
}


/// Genera suggerimenti contestuali per il composer a partire dall'ultimo messaggio dell'assistente.
#[command]
pub async fn generate_prompt_suggestions(
    last_assistant: String,
    last_user: String,
    model_selector: Option<String>,
    max_items: u8,
) -> Result<PromptSuggestionsResult, String> {
    let assistant_trimmed = last_assistant.trim();
    if assistant_trimmed.is_empty() {
        return Ok(PromptSuggestionsResult::empty());
    }

    let max_items_clamped = max_items.clamp(1, 3) as usize;

    // Tronca gli input su confini di carattere validi per contenere costi e latenza:
    // la coda del messaggio dell'agente (dove risiedono domande/richieste di conferma) e la testa del prompt utente.
    let truncated_assistant = truncate_suffix_chars(assistant_trimmed, 2000);
    let user_trimmed = last_user.trim();
    let truncated_user = truncate_prefix_chars(user_trimmed, 500);

    // Su Windows CreateProcessW ha un limite di 32.767 caratteri: messaggi di testo e trascritti
    // viaggiano all'interno di un file di contesto temporaneo (gestito da run_ephemeral_omp_raw),
    // lasciando in argv solo un'istruzione breve e costante.
    let mut context_md = String::new();
    if !truncated_user.is_empty() {
        context_md.push_str(&format!(
            "# Prompt precedente dell'utente\n{}\n\n",
            truncated_user
        ));
    }
    context_md.push_str(&format!(
        "# Ultimo messaggio dell'agente\n{}\n",
        truncated_assistant
    ));

    let user_prompt = format!(
        "Genera al massimo {} risposte suggerite in formato array JSON basandoti sui messaggi nel file allegato.",
        max_items_clamped
    );

    let resolved_model =
        crate::directives_ops::resolve_assistant_model(model_selector.as_deref()).await;

    // Runner condiviso: il timeout vive dentro il runner, cosi' allo scadere il processo
    // viene davvero terminato invece di restare orfano in background.
    let spawned = tokio::task::spawn_blocking(move || {
        crate::directives_ops::run_ephemeral_omp(
            SYSTEM_PROMPT,
            Some(&context_md),
            &user_prompt,
            resolved_model.as_deref(),
            Duration::from_secs(SUGGESTIONS_TIMEOUT_SECS),
        )
    })
    .await;

    let raw_response = match spawned {
        // Avvio impossibile o payload fuori soglia: e' un difetto di configurazione, va mostrato.
        Ok(Err(err_msg)) => return Err(err_msg),
        Ok(Ok(EphemeralOutcome::Ok(output))) => output,
        // Principio 4: timeout, uscita non zero o panico del task degradano a risultato vuoto.
        _ => return Ok(PromptSuggestionsResult::empty()),
    };

    Ok(parse_and_clean_suggestions(
        &raw_response,
        max_items_clamped,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_prefix_chars() {
        assert_eq!(truncate_prefix_chars("hello", 3), "hel");
        assert_eq!(truncate_prefix_chars("hello", 10), "hello");
        assert_eq!(truncate_prefix_chars("🚀🦀✨💡", 2), "🚀🦀");
        assert_eq!(truncate_prefix_chars("città", 4), "citt");
        assert_eq!(truncate_prefix_chars("", 5), "");
    }

    #[test]
    fn test_truncate_suffix_chars() {
        assert_eq!(truncate_suffix_chars("hello", 3), "llo");
        assert_eq!(truncate_suffix_chars("hello", 10), "hello");
        assert_eq!(truncate_suffix_chars("🚀🦀✨💡", 2), "✨💡");
        assert_eq!(truncate_suffix_chars("città", 3), "ttà");
        assert_eq!(truncate_suffix_chars("", 5), "");
    }

    #[test]
    fn test_parse_and_clean_suggestions_structured_json() {
        let raw = r#"{
            "awaitsUserInput": true,
            "questionSummary": "Confermi e procedo dalla Fase 1?",
            "suggestions": ["Procedi pure", "Mostrami prima il diff", "Annulla"]
        }"#;
        let res = parse_and_clean_suggestions(raw, 3);
        assert!(res.awaits_user_input);
        assert_eq!(res.question_summary.as_deref(), Some("Confermi e procedo dalla Fase 1?"));
        assert_eq!(
            res.suggestions,
            vec!["Procedi pure", "Mostrami prima il diff", "Annulla"]
        );
    }

    #[test]
    fn test_parse_and_clean_suggestions_fallback_array() {
        let raw = r#"["Procedi pure", "Mostrami prima il diff", "Annulla"]"#;
        let res = parse_and_clean_suggestions(raw, 3);
        assert!(!res.awaits_user_input);
        assert_eq!(res.question_summary, None);
        assert_eq!(
            res.suggestions,
            vec!["Procedi pure", "Mostrami prima il diff", "Annulla"]
        );
    }

    #[test]
    fn test_parse_and_clean_suggestions_markdown_fence() {
        let raw = "Ecco l'analisi:\n```json\n{\n  \"awaitsUserInput\": true,\n  \"questionSummary\": \"Vuoi procedere?\",\n  \"suggestions\": [\"Procedi pure\", \"Esegui i test\"]\n}\n```\n";
        let res = parse_and_clean_suggestions(raw, 2);
        assert!(res.awaits_user_input);
        assert_eq!(res.question_summary.as_deref(), Some("Vuoi procedere?"));
        assert_eq!(res.suggestions, vec!["Procedi pure", "Esegui i test"]);
    }

    #[test]
    fn test_parse_and_clean_suggestions_deduplication_and_limits() {
        let too_long = "a".repeat(95);
        let raw = format!(
            r#"{{"awaitsUserInput": false, "suggestions": ["Procedi pure", "procedi pure", "  ", "{}", "Esegui i test", "Altro"]}}"#,
            too_long
        );
        let res = parse_and_clean_suggestions(&raw, 2);
        assert!(!res.awaits_user_input);
        assert_eq!(res.suggestions, vec!["Procedi pure", "Esegui i test"]);
    }

    #[test]
    fn test_parse_and_clean_suggestions_invalid_json() {
        assert_eq!(parse_and_clean_suggestions("non è un json", 3), PromptSuggestionsResult::empty());
        assert_eq!(parse_and_clean_suggestions("", 3), PromptSuggestionsResult::empty());
        assert_eq!(parse_and_clean_suggestions("[]", 3), PromptSuggestionsResult::empty());
    }

    #[tokio::test]
    async fn test_empty_assistant_returns_empty() {
        let res = generate_prompt_suggestions("   ".to_string(), "ciao".to_string(), None, 3).await;
        assert_eq!(res.unwrap(), PromptSuggestionsResult::empty());
    }
}
