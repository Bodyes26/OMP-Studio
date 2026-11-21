//! Raggiungibilita' del relay proprio (R-MI-30).
//!
//! Studio distingue «la macchina non risponde» da «il relay non e'
//! raggiungibile da qui»: un GET con timeout breve a un endpoint servito da
//! iroh-relay e i certificati di sistema, come fa il bridge di Studio Remote.
//! `/ping` e' RELAY_PROBE_PATH di iroh-relay 1.4.1 (src/http.rs),
//! registrato sul server HTTPS in src/server.rs: risponde 200 con corpo
//! vuoto. `/generate_204` invece appartiene al listener HTTP separato.
use std::time::Duration;

/// Tempo massimo per un controllo: il giro periodico non deve restare
/// appeso se il relay non risponde.
const RELAY_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Controlla se il relay risponde all'endpoint HTTP. `None` se non c'e'
/// niente da verificare, `Some(true)` solo quando `/ping` risponde 200.
/// Reqwest usa rustls-tls-native-roots, come il bridge di Studio Remote.
pub(crate) async fn relay_reachable(client: &reqwest::Client, url: &str) -> Option<bool> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    // Il relay configurato e' gia' validato come origine HTTPS senza
    // percorso; qui si ricostruisce l'endpoint di prova a partire dall'origine.
    let Ok(base) = reqwest::Url::parse(url) else {
        return None;
    };
    let probe = base.join("ping").ok()?;
    let request = client.get(probe).timeout(RELAY_CHECK_TIMEOUT).send();
    match tokio::time::timeout(RELAY_CHECK_TIMEOUT, request).await {
        Ok(Ok(response)) => Some(response.status() == reqwest::StatusCode::OK),
        Ok(Err(_)) => Some(false),
        Err(_) => Some(false),
    }
}
