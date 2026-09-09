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
use std::collections::HashSet;
use std::time::Duration;
use tauri::command;
/// Timeout massimo di sicurezza (secondi) per l'esecuzione del processo omp effimero.
const SUGGESTIONS_TIMEOUT_SECS: u64 = 30;

/// Prompt di sistema per la generazione delle risposte rapide.
const SYSTEM_PROMPT: &str = r#"Sei un assistente specializzato nel suggerire le risposte rapide piu' probabili che uno sviluppatore darebbe al proprio agente di coding (Oh My Pi / OMP).
Ricevi l'ultimo messaggio dell'agente e il prompt precedente dell'utente.

Regole tassative:
1. Rispondi ESCLUSIVAMENTE con un array JSON di stringhe (es. ["Procedi pure", "Mostrami prima il diff"]). Nessun testo introduttivo, nessun commento, nessun blocco markdown o chiave extra.
2. Ogni stringa e' una risposta pronta da inviare, scritta in PRIMA PERSONA come la scriverebbe l'utente, imperativa e concreta.
3. Massimo 60 caratteri per ogni stringa.
4. Scrivi nella STESSA LINGUA dell'ultimo messaggio dell'agente.
5. Se l'agente ha presentato un piano o chiede conferma, la prima risposta deve essere l'approvazione (es. "Procedi pure").
6. Se l'agente ha posto una domanda diretta, le risposte devono essere risposte plausibili a quella domanda.
7. Niente risposte generiche tipo "Dimmi di piu": ogni risposta deve essere ancorata al contenuto del messaggio.
8. Se non hai nulla di utile da proporre, rispondi con []"#;

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

/// Estrae e ripulisce le risposte suggerite dal testo grezzo prodotto dal modello.
pub(crate) fn parse_and_clean_suggestions(raw_response: &str, max_items: usize) -> Vec<String> {
    let json_text = match crate::directives_ops::extract_json_payload(raw_response) {
        Ok(j) => j,
        Err(_) => return Vec::new(),
    };

    let parsed: Vec<String> = match serde_json::from_str(&json_text) {
        Ok(items) => items,
        Err(_) => return Vec::new(),
    };

    let mut seen = HashSet::new();
    let mut cleaned = Vec::with_capacity(max_items);

    for item in parsed {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > 90 {
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


/// Genera suggerimenti contestuali per il composer a partire dall'ultimo messaggio dell'assistente.
#[command]
pub async fn generate_prompt_suggestions(
    last_assistant: String,
    last_user: String,
    model_selector: Option<String>,
    max_items: u8,
) -> Result<Vec<String>, String> {
    let assistant_trimmed = last_assistant.trim();
    if assistant_trimmed.is_empty() {
        return Ok(Vec::new());
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
        // Principio 4: timeout, uscita non zero o panico del task degradano a lista vuota.
        _ => return Ok(Vec::new()),
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
    fn test_parse_and_clean_suggestions_valid_json() {
        let raw = r#"["Procedi pure", "Mostrami prima il diff", "Annulla"]"#;
        let suggestions = parse_and_clean_suggestions(raw, 3);
        assert_eq!(
            suggestions,
            vec!["Procedi pure", "Mostrami prima il diff", "Annulla"]
        );
    }

    #[test]
    fn test_parse_and_clean_suggestions_markdown_fence() {
        let raw = "Ecco i suggerimenti:\n```json\n[\"Procedi pure\", \"Esegui i test\"]\n```\n";
        let suggestions = parse_and_clean_suggestions(raw, 2);
        assert_eq!(suggestions, vec!["Procedi pure", "Esegui i test"]);
    }

    #[test]
    fn test_parse_and_clean_suggestions_deduplication_and_limits() {
        let too_long = "a".repeat(95);
        let raw = format!(
            r#"["Procedi pure", "procedi pure", "  ", "{}", "Esegui i test", "Altro"]"#,
            too_long
        );
        let suggestions = parse_and_clean_suggestions(&raw, 2);
        assert_eq!(suggestions, vec!["Procedi pure", "Esegui i test"]);
    }

    #[test]
    fn test_parse_and_clean_suggestions_invalid_json() {
        assert!(parse_and_clean_suggestions("non è un json", 3).is_empty());
        assert!(parse_and_clean_suggestions("", 3).is_empty());
        assert!(parse_and_clean_suggestions("[]", 3).is_empty());
    }

    #[tokio::test]
    async fn test_empty_assistant_returns_empty() {
        let res = generate_prompt_suggestions("   ".to_string(), "ciao".to_string(), None, 3).await;
        assert_eq!(res.unwrap(), Vec::<String>::new());
    }
}
