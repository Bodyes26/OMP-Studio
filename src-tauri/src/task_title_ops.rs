//! Titolo sintetico dei task in coda, generato dal modello leggero.
//!
//! Stesso schema della denominazione delle corsie (`lane_naming_ops`):
//! chiamata `omp` effimera e isolata, modello del ruolo `smol` (o `default`),
//! fallimento silenzioso. La coda mostra comunque un titolo euristico finche'
//! questo non arriva, quindi un errore qui non deve mai raggiungere l'utente.

use crate::directives_ops::EphemeralOutcome;
use crate::lane_naming_ops::clean_short_label;
use std::time::Duration;
use tauri::command;

/// La coda si titola in serie: un `omp` bloccato non deve fermare gli altri task.
const TITLE_TIMEOUT_SECS: u64 = 25;

/// Oltre questa soglia il prompt non aggiunge informazione utile al titolo.
const TITLE_PROMPT_MAX_CHARS: usize = 2000;

const SYSTEM_PROMPT: &str = r#"Sei un assistente che assegna un'etichetta brevissima a un task di sviluppo software in coda.
Ricevi il testo del task scritto dall'utente.

Regole TASSATIVE:
1. Rispondi con ESCLUSIVAMENTE l'etichetta, su una sola riga. Nessun testo introduttivo, nessun commento, nessun blocco markdown o virgolette.
2. Lunghezza: da 1 a 3 parole, MASSIMO 24 caratteri totali.
3. Contenuto: l'intento del task, cioe' cosa cambia e dove (es. "Ordina quote popover", "Fix overlay anteprima", "Elimina prototipi Lab").
4. Lingua: la stessa del testo del task.
5. Nessuna frase completa, nessuna punteggiatura finale."#;

/// Cancella un job di generazione in background registrato con `job_id`.
/// Restituisce `true` se il processo era attivo ed e' stato terminato.
#[command]
pub fn background_job_cancel(job_id: String) -> bool {
    crate::directives_ops::cancel_background_job(&job_id)
}

/// Genera l'etichetta del task. `None` per prompt vuoto, errore, timeout o
/// risposta inutilizzabile. Se cancellato tramite `background_job_cancel`,
/// restituisce `Err("cancelled")`.
#[command]
pub async fn generate_task_title(
    prompt: String,
    model: Option<String>,
    job_id: Option<String>,
) -> Result<Option<String>, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let mut context_md = String::from("# Testo del task:\n");
    context_md.extend(trimmed.chars().take(TITLE_PROMPT_MAX_CHARS));

    let resolved_model = crate::directives_ops::resolve_assistant_model(model.as_deref()).await;
    let spawned = tokio::task::spawn_blocking(move || {
        crate::directives_ops::run_ephemeral_omp_cancellable(
            SYSTEM_PROMPT,
            Some(&context_md),
            "Genera l'etichetta rispettando rigorosamente le regole indicate.",
            resolved_model.as_deref(),
            Duration::from_secs(TITLE_TIMEOUT_SECS),
            job_id.as_deref(),
        )
    })
    .await;

    match spawned {
        Ok(Ok(EphemeralOutcome::Cancelled)) => Err("cancelled".to_string()),
        Ok(Ok(EphemeralOutcome::Ok(text))) => Ok(clean_short_label(&text)),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_background_job_cancel_not_found() {
        assert!(!background_job_cancel("nonexistent_job_123".to_string()));
    }
}
