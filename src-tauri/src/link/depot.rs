//! Codice corto del deposito sul relay di Studio Remote (R-MI-55).
//!
//! Il codice di abbinamento completo (1-2 KB, con relay e token) non e'
//! digitabile: quando il server di Studio Remote e' configurato lo si deposita
//! sul relay sotto un codice di 8 caratteri, cifrato con una chiave ricavata
//! dal codice stesso. Il relay vede solo il cifrato; chi ritira il codice ha
//! una sola possibilita' (il deposito si consuma alla lettura) e 10 minuti.
//!
//! Entropia del codice corto: 8 caratteri dell'alfabeto Crockford, cioe' 5 bit
//! ciascuno, 40 bit. Non basterebbe da solo contro un attacco offline, quindi
//! la chiave passa da Argon2id (19 MiB, 2 passaggi) e il relay limita i
//! tentativi di ritiro: 10 fallimenti ogni 15 minuti per indirizzo e 100 in
//! tutto. Con quei limiti indovinare 40 bit richiede secoli anche ignorando
//! Argon2id.
use std::time::Duration;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

/// Alfabeto Crockford, lo stesso dei codici del relay: niente I, L, O, U.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub(crate) const SHORT_CODE_LENGTH: usize = 8;
/// Validita' del deposito sul relay; la stessa del codice del telefono.
pub(crate) const MAILBOX_TTL_MS: u64 = 10 * 60_000;
/// Tetto del corpo cifrato accettato dal relay: il codice completo e' molto
/// piu' piccolo, questo lascia margine senza permettere abusi.
const MAX_PAYLOAD_BYTES: usize = 8 * 1024;
const SALT_LEN: usize = 16;

/// Genera un codice corto casuale. `uuid` v4 usa il generatore di sistema:
/// 32 byte di entropia, ridotti a 8 caratteri (40 bit).
pub(crate) fn generate_short_code() -> String {
    let mut bytes = [0u8; 8];
    let first = uuid::Uuid::new_v4();
    let second = uuid::Uuid::new_v4();
    bytes[..8].copy_from_slice(&first.as_bytes()[..8]);
    bytes[0] ^= second.as_bytes()[0];
    bytes[7] ^= second.as_bytes()[15];
    bytes.iter().map(|byte| ALPHABET[*byte as usize % ALPHABET.len()] as char).collect()
}

/// Riporta un codice digitato alla forma canonica (`ABCD-1234` compreso).
/// `None` se non e' un codice corto: cosi' un codice completo non viene mai
/// scambiato per un codice del deposito.
pub(crate) fn normalize_short_code(input: &str) -> Option<String> {
    let code: String = input
        .trim()
        .to_ascii_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c { 'O' => '0', 'I' | 'L' => '1', other => other })
        .collect();
    if code.len() != SHORT_CODE_LENGTH { return None; }
    if !code.bytes().all(|byte| ALPHABET.contains(&byte)) { return None; }
    Some(code)
}

/// `ABCD1234` -> `ABCD-1234`, come si mostra e si detta.
pub(crate) fn format_short_code(code: &str) -> String {
    if code.len() != SHORT_CODE_LENGTH { return code.to_owned(); }
    format!("{}-{}", &code[..4], &code[4..])
}

/// Identificativo del deposito: un'impronta del codice, cosi' il relay non
/// conserva mai il codice in chiaro nemmeno come chiave di riga.
pub(crate) fn mailbox_id(code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"omp-studio-mailbox:");
    hasher.update(code.as_bytes());
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Chiave AES-256 derivata dal codice corto con Argon2id.
fn derive_key(code: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|error| error.to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon.hash_password_into(code.as_bytes(), salt, &mut key).map_err(|error| error.to_string())?;
    Ok(key)
}

/// Cifra il codice completo: `salt || nonce || ciphertext`, base64url.
pub(crate) fn encrypt(code: &str, plaintext: &str) -> Result<String, String> {
    let uuid = uuid::Uuid::new_v4();
    let salt = &uuid.as_bytes()[..SALT_LEN];
    let key = derive_key(code, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes()).map_err(|_| "Encryption failed".to_string())?;
    let mut payload = Vec::with_capacity(SALT_LEN + 12 + ciphertext.len());
    payload.extend_from_slice(salt);
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ciphertext);
    Ok(URL_SAFE_NO_PAD.encode(payload))
}

/// Decifra il deposito. Un codice sbagliato non produce testo: AES-GCM
/// rifiuta il tag, quindi non c'e' nessun «quasi giusto» da distinguere.
pub(crate) fn decrypt(code: &str, payload: &str) -> Result<String, String> {
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim()).map_err(|_| "Invalid mailbox payload".to_string())?;
    if bytes.len() < SALT_LEN + 12 + 16 { return Err("Invalid mailbox payload".into()); }
    let (salt, rest) = bytes.split_at(SALT_LEN);
    let (nonce, ciphertext) = rest.split_at(12);
    let key = derive_key(code, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let plaintext = cipher.decrypt(nonce.into(), ciphertext)
        .map_err(|_| crate::tr!("Codice non valido o scaduto", "Invalid or expired code").to_string())?;
    String::from_utf8(plaintext).map_err(|_| "Invalid mailbox payload".into())
}

/// Corpo del deposito accettato dal relay.
#[derive(serde::Serialize)]
struct DepositBody<'a> { id: &'a str, payload: &'a str }

/// Esito del deposito: il relay restituisce solo la scadenza.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositReply { expires_at: Option<u64> }

#[derive(serde::Deserialize)]
struct WithdrawReply { payload: String }

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|error| error.to_string())
}

/// Deposita il codice completo sul relay di Studio Remote, autenticandosi con
/// la credenziale dell'host. `Err` quando il server non e' configurato o non
/// risponde: chi chiama ripiega sul solo codice completo.
pub(crate) async fn deposit(relay: &str, credential: &str, code: &str, plaintext: &str) -> Result<u64, String> {
    let payload = encrypt(code, plaintext)?;
    if payload.len() > MAX_PAYLOAD_BYTES { return Err("Pairing code is too large for the mailbox".into()); }
    let id = mailbox_id(code);
    let response = client()?.post(format!("{relay}/v1/host/mailbox"))
        .bearer_auth(credential)
        .json(&DepositBody { id: &id, payload: &payload })
        .send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Mailbox deposit refused ({})", response.status()));
    }
    let reply: DepositReply = response.json().await.map_err(|error| error.to_string())?;
    Ok(reply.expires_at.unwrap_or_else(|| super::epoch_ms() + MAILBOX_TTL_MS))
}

/// Ritira una volta sola il deposito e restituisce il codice completo. Il
/// ritiro non e' autenticato: la protezione e' il codice corto (chiave e
/// indice) piu' i limiti del relay.
pub(crate) async fn withdraw(relay: &str, code: &str) -> Result<String, String> {
    let id = mailbox_id(code);
    let response = client()?.get(format!("{relay}/v1/mailbox/{id}"))
        .send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(crate::tr!(
            "Codice scaduto o gia' usato su un'altra macchina",
            "Code expired or already used on another machine"
        ).into());
    }
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(crate::tr!("Troppi tentativi, riprova piu' tardi", "Too many attempts, try again later").into());
    }
    if !response.status().is_success() {
        return Err(format!("Mailbox withdrawal failed ({})", response.status()));
    }
    let reply: WithdrawReply = response.json().await.map_err(|error| error.to_string())?;
    decrypt(code, &reply.payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_short_code_travels_between_its_two_forms_only_once() {
        let code = generate_short_code();
        assert_eq!(code.len(), SHORT_CODE_LENGTH);
        let formatted = format_short_code(&code);
        assert_eq!(formatted.len(), SHORT_CODE_LENGTH + 1);
        assert_eq!(normalize_short_code(&formatted).as_deref(), Some(code.as_str()));
        assert_eq!(normalize_short_code(&code.to_lowercase()).as_deref(), Some(code.as_str()));
        // Un codice completo non e' un codice corto, e viceversa.
        assert!(normalize_short_code("studio1:eyJwcm90b2NvbCI6MX0").is_none());
        assert!(normalize_short_code("ABCD-123").is_none());
        assert!(normalize_short_code("ABCD-123I").is_some(), "I si legge come 1");
    }

    #[test]
    fn the_deposit_round_trips_and_a_wrong_code_never_returns_text() {
        let code = generate_short_code();
        let plaintext = "{\"protocol\":1,\"address\":{\"id\":\"mac\"},\"token\":\"t\"}";
        let payload = encrypt(&code, plaintext).unwrap();
        assert!(!payload.contains("mac"), "il relay non deve leggere l'identita'");
        assert_eq!(decrypt(&code, &payload).unwrap(), plaintext);
        // Un altro codice corto (una cifra cambiata) non decifra.
        let mut other: Vec<char> = code.chars().collect();
        other[0] = if other[0] == 'A' { 'B' } else { 'A' };
        let other: String = other.into_iter().collect();
        assert!(decrypt(&other, &payload).is_err());
        assert!(decrypt(&code, "not-base64!!").is_err());
    }

    #[test]
    fn the_mailbox_id_depends_only_on_the_code_and_hides_it() {
        let code = generate_short_code();
        assert_eq!(mailbox_id(&code), mailbox_id(&code));
        assert!(!mailbox_id(&code).contains(&code));
        let other = generate_short_code();
        if other != code { assert_ne!(mailbox_id(&code), mailbox_id(&other)); }
    }

    #[test]
    fn two_deposits_of_the_same_code_use_different_keys_and_nonces() {
        let code = generate_short_code();
        let first = encrypt(&code, "same").unwrap();
        let second = encrypt(&code, "same").unwrap();
        assert_ne!(first, second);
        assert_eq!(decrypt(&code, &first).unwrap(), "same");
        assert_eq!(decrypt(&code, &second).unwrap(), "same");
    }
}
