//! Operazioni AI per la generazione automatica dei nomi di corsia (worktree e prototipi Lab).
//!
//! Principi guida:
//! 1. **Esecuzione effimera e isolata.** L'invocazione di `omp` avviene con `-p --no-session --no-tools --no-skills --no-rules`,
//!    senza contaminare lo storico o le sessioni attive e senza tool abilitati.
//! 2. **Modello leggero.** Viene utilizzato il modello configurato nel ruolo `smol` (o fallback su default),
//!    riducendo al minimo costi e latenza.
//! 3. **Fallimento silenzioso.** Qualsiasi errore, timeout o risposta non conforme restituisce `Ok(None)`
//!    per non disturbare il flusso utente.

use crate::directives_ops::EphemeralOutcome;
use std::time::Duration;
use tauri::command;

/// Timeout massimo di sicurezza per la generazione effimera del nome.
const NAMING_TIMEOUT_SECS: u64 = 25;

/// Prompt di sistema per la denominazione di un prototipo Lab.
const LAB_SYSTEM_PROMPT: &str = r#"Sei un assistente specializzato nel dare un nome sintetico e memorabile a un prototipo interattivo (Lab prototype).
Ricevi la richiesta o descrizione dell'utente per il prototipo.

Regole TASSATIVE:
1. Rispondi con ESCLUSIVAMENTE il nome generato, su una sola riga. Nessun testo introduttivo, nessun commento, nessuna spiegazione, nessun blocco markdown o virgolette.
2. Lunghezza: da 1 a 3 parole, MASSIMO 24 caratteri totali.
3. Stile: nome inventivo, memorabile, da prodotto software (es. "ChatAI Reveal", "Ultimate AI Chat", "Kanban Flow", "DataPulse").
4. Nessun verbo coniugato, nessuna frase completa, nessun punto o punteggiatura finale.
5. Il nome DEVE essere diverso da quelli gia' esistenti forniti nel contesto."#;

/// Prompt di sistema per la denominazione di un worktree Git.
const GIT_SYSTEM_PROMPT: &str = r#"Sei un assistente specializzato nel dare un nome breve e chiaro all'area funzionale di un worktree Git in un progetto software.
Ricevi la richiesta o il prompt dell'utente per questo task/worktree.

Regole TASSATIVE:
1. Rispondi con ESCLUSIVAMENTE il nome generato, su una sola riga. Nessun testo introduttivo, nessun commento, nessuna spiegazione, nessun blocco markdown o virgolette.
2. Lunghezza: da 1 a 3 parole, MASSIMO 24 caratteri totali.
3. Stile: l'area funzionale toccata o il componente (es. "Ricerca V2", "Login AD", "Export Excel", "Fatture PDF", "Auth Token"), nella stessa lingua della richiesta dell'utente.
4. Nessun verbo coniugato, nessuna frase completa, nessun punto o punteggiatura finale.
5. Il nome DEVE essere diverso da quelli gia' esistenti forniti nel contesto."#;

/// Ripulisce e valida il nome generato per una corsia o prototipo.
///
/// Regole:
/// 1. Prende la prima riga non vuota.
/// 2. Rimuove blocchi markdown (backticks, grassetto, corsivo), apici, virgolette e punteggiatura iniziale/finale.
/// 3. Normalizza gli spazi interni.
/// 4. Se la stringa supera i 24 caratteri o contiene piu' di 3 parole, tenta di troncarla
///    per parole (fino a un massimo di 3 parole) entro la soglia di 24 caratteri.
/// 5. Se la prima parola da sola supera i 24 caratteri o la stringa e' vuota, restituisce None.
pub fn clean_lane_name(raw: &str) -> Option<String> {
    let first_line = raw
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())?;

    // Rimuove markdown di blocco o inline code
    let stripped_md = first_line
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // Rimuove elenchi puntati o numerati (es. "- Nome", "1. Nome", "* Nome")
    let without_prefix = if let Some(rest) = stripped_md.strip_prefix(|c: char| c == '-' || c == '*' || c == '•') {
        rest.trim()
    } else if let Some(pos) = stripped_md.find(". ") {
        let prefix = &stripped_md[..pos];
        if prefix.chars().all(|c| c.is_ascii_digit()) {
            stripped_md[pos + 2..].trim()
        } else {
            stripped_md
        }
    } else {
        stripped_md
    };

    // Virgolette, marcatori markdown e punteggiatura vanno tolti insieme: il
    // modello li alterna (`'Login AD'.`), e toglierli in due passate separate
    // lascerebbe l'apice chiuso dietro al punto.
    let cleaned_punct = without_prefix
        .trim_matches(|c: char| {
            matches!(
                c,
                '"' | '\'' | '`' | '“' | '”' | '„' | '«' | '»' | '*' | '_' | ':' | '.' | ',' | ';'
                    | '!' | '?' | '-' | '…'
            ) || c.is_whitespace()
        });

    if cleaned_punct.is_empty() {
        return None;
    }

    // Normalizza gli spazi multipli
    let words: Vec<&str> = cleaned_punct.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }

    // Se la prima parola supera gia' 24 caratteri, non e' un nome valido
    if words[0].chars().count() > 24 {
        return None;
    }

    // Prova ad accumulare fino a 3 parole restando entro 24 caratteri
    let mut selected_words = Vec::new();
    let mut current_len = 0;

    for &word in words.iter().take(3) {
        let word_len = word.chars().count();
        let needed = if selected_words.is_empty() {
            word_len
        } else {
            current_len + 1 + word_len
        };

        if needed <= 24 {
            selected_words.push(word);
            current_len = needed;
        } else {
            break;
        }
    }

    if selected_words.is_empty() {
        return None;
    }

    let result = selected_words.join(" ");
    let final_clean = result
        .trim_end_matches(|c: char| {
            c == '.' || c == ',' || c == ';' || c == ':' || c == '!' || c == '?' || c == '-' || c == '…'
        })
        .trim();

    if final_clean.is_empty() || final_clean.chars().count() > 24 {
        None
    } else {
        Some(final_clean.to_string())
    }
}

/// Genera un nome sintetico per una corsia (worktree o prototipo Lab) a partire dal prompt iniziale.
#[command]
pub async fn generate_lane_name(
    kind: String,
    prompt: String,
    existing_names: Vec<String>,
) -> Result<Option<String>, String> {
    let prompt_trimmed = prompt.trim();
    if prompt_trimmed.is_empty() {
        return Ok(None);
    }

    let is_lab = kind.trim().eq_ignore_ascii_case("lab");
    let system_prompt = if is_lab {
        LAB_SYSTEM_PROMPT
    } else {
        GIT_SYSTEM_PROMPT
    };

    let truncated_prompt = if prompt_trimmed.chars().count() > 2000 {
        prompt_trimmed.chars().take(2000).collect::<String>()
    } else {
        prompt_trimmed.to_string()
    };

    let mut context_md = String::new();
    let valid_existing: Vec<&str> = existing_names
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if !valid_existing.is_empty() {
        context_md.push_str("# Nomi gia' esistenti da NON riutilizzare:\n");
        for name in &valid_existing {
            context_md.push_str(&format!("- {}\n", name));
        }
        context_md.push('\n');
    }
    context_md.push_str("# Richiesta utente:\n");
    context_md.push_str(&truncated_prompt);

    let user_prompt = "Genera il nome rispettando rigorosamente le regole indicate.";

    let resolved_model = crate::directives_ops::resolve_assistant_model(None).await;

    let spawned = tokio::task::spawn_blocking(move || {
        crate::directives_ops::run_ephemeral_omp(
            system_prompt,
            Some(&context_md),
            user_prompt,
            resolved_model.as_deref(),
            Duration::from_secs(NAMING_TIMEOUT_SECS),
        )
    })
    .await;

    let raw_response = match spawned {
        Ok(Ok(EphemeralOutcome::Ok(text))) => text,
        _ => return Ok(None), // Fallimento silenzioso: timeout, errore omp o panico
    };

    let cleaned = match clean_lane_name(&raw_response) {
        Some(name) => name,
        None => return Ok(None),
    };

    // Verifica difensiva: se il nome generato e' identico a uno esistente (case-insensitive), scartalo
    if valid_existing
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(&cleaned))
    {
        return Ok(None);
    }

    Ok(Some(cleaned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_lane_name_simple() {
        assert_eq!(clean_lane_name("ChatAI Reveal"), Some("ChatAI Reveal".to_string()));
        assert_eq!(clean_lane_name("Login AD"), Some("Login AD".to_string()));
        assert_eq!(clean_lane_name("Export Excel"), Some("Export Excel".to_string()));
    }

    #[test]
    fn test_clean_lane_name_strips_quotes_and_punctuation() {
        assert_eq!(clean_lane_name("\"Ultimate AI Chat\""), Some("Ultimate AI Chat".to_string()));
        assert_eq!(clean_lane_name("'Login AD'."), Some("Login AD".to_string()));
        assert_eq!(clean_lane_name("«Ricerca V2»!"), Some("Ricerca V2".to_string()));
        assert_eq!(clean_lane_name("“ChatAI Reveal”..."), Some("ChatAI Reveal".to_string()));
    }

    #[test]
    fn test_clean_lane_name_strips_markdown_and_list_prefixes() {
        assert_eq!(clean_lane_name("`ChatAI`"), Some("ChatAI".to_string()));
        assert_eq!(clean_lane_name("**Login AD**"), Some("Login AD".to_string()));
        assert_eq!(clean_lane_name("- Export Excel"), Some("Export Excel".to_string()));
        assert_eq!(clean_lane_name("1. Ricerca V2"), Some("Ricerca V2".to_string()));
    }

    #[test]
    fn test_clean_lane_name_truncates_words_to_fit_24_chars() {
        // "Nuova interfaccia utente" e' esattamente 24 caratteri
        assert_eq!(
            clean_lane_name("Nuova interfaccia utente per il carrello"),
            Some("Nuova interfaccia utente".to_string())
        );
        // Troncamento a 3 parole massimo
        assert_eq!(
            clean_lane_name("One Two Three Four Five"),
            Some("One Two Three".to_string())
        );
    }

    #[test]
    fn test_clean_lane_name_rejects_empty_or_oversized_first_word() {
        assert_eq!(clean_lane_name(""), None);
        assert_eq!(clean_lane_name("   "), None);
        assert_eq!(clean_lane_name("...---..."), None);
        assert_eq!(clean_lane_name("Supercalifragilisticexpialidocious"), None);
    }
}
