//! Gestione sicura dei segreti tramite portachiavi nativo del sistema operativo (OS Vault).
//! Implementa la specifica AUT-048, AUT-083, AUT-106.
//!
//! Principi di sicurezza:
//! - Archiviazione esclusivamente nel credential store nativo del sistema operativo:
//!   - Windows: Windows Credential Manager (`windows-native`)
//!   - macOS: Apple Keychain (`apple-native`)
//!   - Linux: Secret Service DBus (`sync-secret-service` + `crypto-rust`)
//! - Fail-closed assoluto: NESSUN fallback in chiaro (plaintext/file JSON/variabili d'ambiente);
//! - Se il portachiavi di sistema e' assente, disabilitato, bloccato o privo di permessi,
//!   l'operazione fallisce con errore esplicito richiedendo intervento manuale dell'utente;
//! - Validazione rigorosa degli identificatori di segreto per prevenire injection o collisioni;
//! - Isolamento di servizio: tutte le credenziali sono confinate al servizio `omp-studio-automations`;
//! - Nessuna enumerazione o lettura di credenziali estranee al di fuori di quelle esplicitamente referenziate;
//! - I valori dei segreti NON vengono mai loggati o inclusi nei messaggi di errore.

use keyring::Entry;

/// Nome del servizio di sistema utilizzato per isolare le credenziali delle automazioni.
const SERVICE_NAME: &str = "omp-studio-automations";

/// Lunghezza massima consentita per l'identificatore di un segreto.
const MAX_SECRET_ID_LEN: usize = 128;

/// Valida l'identificatore di un segreto.
/// Sono ammessi caratteri alfanumerici ASCII, underscore, trattino, punto e due punti.
pub fn validate_secret_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("L'identificatore del segreto non può essere vuoto".to_string());
    }
    if id.len() != trimmed.len() {
        return Err(format!(
            "L'identificatore del segreto '{}' contiene spazi iniziali o finali non consentiti",
            id
        ));
    }
    if id.len() > MAX_SECRET_ID_LEN {
        return Err(format!(
            "L'identificatore del segreto supera la lunghezza massima consentita di {} caratteri (lunghezza: {})",
            MAX_SECRET_ID_LEN,
            id.len()
        ));
    }

    for ch in id.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' && ch != '.' && ch != ':' {
            return Err(format!(
                "Carattere non consentito '{}' nell'identificatore del segreto '{}'. Sono ammessi solo caratteri alfanumerici ASCII, '_', '-', '.' e ':'",
                ch, id
            ));
        }
    }

    Ok(())
}

/// Converte un errore del crate `keyring` in un messaggio diagnostico esplicito e sicuro (AUT-083).
/// Non include MAI il valore del segreto nei messaggi.
fn format_keyring_error(action: &str, id: &str, err: &keyring::Error) -> String {
    match err {
        keyring::Error::NoEntry => {
            format!("Segreto '{}' non presente nel portachiavi di sistema", id)
        }
        keyring::Error::NoStorageAccess(e) => {
            format!(
                "Impossibile accedere al portachiavi di sistema durante {} per '{}' (vault bloccato, sessione grafica/DBus mancante o permessi insufficienti): {}",
                action, id, e
            )
        }
        keyring::Error::PlatformFailure(e) => {
            format!(
                "Errore del backend del portachiavi di sistema durante {} per '{}': {}",
                action, id, e
            )
        }
        keyring::Error::BadEncoding(_) => {
            format!(
                "Il segreto '{}' archiviato nel portachiavi non contiene una stringa UTF-8 valida",
                id
            )
        }
        keyring::Error::TooLong(attr, max_len) => {
            format!(
                "Attributo '{}' per il segreto '{}' supera il limite massimo della piattaforma ({})",
                attr, id, max_len
            )
        }
        keyring::Error::Invalid(attr, reason) => {
            format!(
                "Attributo '{}' non valido per il segreto '{}': {}",
                attr, id, reason
            )
        }
        keyring::Error::Ambiguous(items) => {
            format!(
                "Rilevati più record ambigui nel portachiavi per il segreto '{}' ({} elementi)",
                id,
                items.len()
            )
        }
        other => {
            format!(
                "Errore del portachiavi di sistema durante {} per '{}': {}",
                action, id, other
            )
        }
    }
}

/// Salva un segreto nel portachiavi nativo del sistema operativo.
/// Fail-closed: se il portachiavi non e' accessibile, restituisce `Err` e non effettua salvataggi in chiaro.
pub fn put(id: &str, value: &str) -> Result<(), String> {
    validate_secret_id(id)?;

    let entry = Entry::new(SERVICE_NAME, id)
        .map_err(|e| format_keyring_error("creazione entry", id, &e))?;

    entry
        .set_password(value)
        .map_err(|e| format_keyring_error("salvataggio valore", id, &e))?;

    Ok(())
}

/// Recupera un segreto dal portachiavi nativo del sistema operativo.
/// Utilizzato dal runner per popolare le variabili d'ambiente segrete `secretRefs`.
/// Restituisce `Err` esplicito se assente, bloccato o inaccessibile.
pub fn get(id: &str) -> Result<String, String> {
    validate_secret_id(id)?;

    let entry = Entry::new(SERVICE_NAME, id)
        .map_err(|e| format_keyring_error("creazione entry", id, &e))?;

    entry
        .get_password()
        .map_err(|e| format_keyring_error("lettura valore", id, &e))
}

/// Elimina un segreto dal portachiavi nativo del sistema operativo.
/// Se il segreto era già assente (`NoEntry`), l'operazione ha esito positivo (idempotenza).
pub fn remove(id: &str) -> Result<(), String> {
    validate_secret_id(id)?;

    let entry = Entry::new(SERVICE_NAME, id)
        .map_err(|e| format_keyring_error("creazione entry", id, &e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => {
            // Segreto già assente dal portachiavi, rimozione completata
            Ok(())
        }
        Err(e) => Err(format_keyring_error("eliminazione", id, &e)),
    }
}

/// Verifica se un segreto esiste nel portachiavi nativo senza esporne il valore.
pub fn exists(id: &str) -> Result<bool, String> {
    validate_secret_id(id)?;

    let entry = Entry::new(SERVICE_NAME, id)
        .map_err(|e| format_keyring_error("creazione entry", id, &e))?;

    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format_keyring_error("verifica esistenza", id, &e)),
    }
}
