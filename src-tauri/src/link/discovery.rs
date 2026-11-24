//! Scoperta in rete locale e conferma a 6 cifre (R-MI-54).
//!
//! La macchina si annuncia in mDNS soltanto fra `start` e `stop`, cioe' mentre
//! l'utente ha aperto «Aggiungi dispositivo»: fuori da quel percorso nessuno
//! la trova. Chi sceglie una macchina apre una connessione con un ALPN
//! dedicato (nessun token: l'abbinamento non esiste ancora) e propone lo
//! scambio; entrambe le schermate mostrano le stesse 6 cifre, ricavate dalle
//! due chiavi e da un nonce, e l'abbinamento si scrive su entrambe solo dopo
//! che l'altra macchina accetta. Rifiuto o silenzio per 2 minuti non lasciano
//! nulla.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use iroh::address_lookup::{EndpointInfo, UserData};
use iroh::{Endpoint, EndpointAddr, EndpointId};
use iroh_mdns_address_lookup::{DiscoveryEvent, MdnsAddressLookup};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::config::Address;

/// ALPN dell'abbinamento in rete locale: distinto da quello delle istanze
/// (`protocol::ALPN`) perche' qui non c'e' ancora nessun token ne' peer noto.
pub(crate) const PAIR_ALPN: &[u8] = b"omp-studio/pair/1";
/// Oltre due minuti la richiesta non vale piu' (R-MI-54).
pub(crate) const PAIR_TIMEOUT: Duration = Duration::from_secs(120);
/// Nome del servizio mDNS: lo stesso schema di iroh, con il nostro suffisso,
/// cosi' non si annuncia come endpoint di altre applicazioni iroh.
const SERVICE_NAME: &str = "omp-studio-pair";
const MAX_USER_DATA: usize = 245;

/// Macchina vista in rete locale.
#[derive(Clone, Debug)]
pub(crate) struct Discovered {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub relay: String,
    pub ips: Vec<std::net::SocketAddr>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveredView {
    pub id: String,
    pub name: String,
    pub platform: String,
}

impl Discovered {
    pub fn view(&self) -> DiscoveredView {
        DiscoveredView { id: self.id.clone(), name: self.name.clone(), platform: self.platform.clone() }
    }

    pub fn endpoint_addr(&self) -> Result<EndpointAddr, String> {
        let id: EndpointId = self.id.parse().map_err(|_| "Invalid endpoint identity")?;
        let mut addr = EndpointAddr::new(id);
        if let Ok(relay) = self.relay.parse() { addr = addr.with_relay_url(relay); }
        for ip in &self.ips { addr = addr.with_ip_addr(*ip); }
        Ok(addr)
    }

    pub fn address(&self) -> Address {
        Address { id: self.id.clone(), relay: self.relay.clone(), ips: self.ips.clone() }
    }
}

/// Sessione di scoperta attiva.
///
/// `MdnsAddressLookup` annuncia finche' vive una sua copia: la teniamo qui e
/// nello spawned task, quindi `stop` prima ferma il task e poi toglie il
/// servizio dal registro dell'endpoint. Cadendo la sessione, l'annuncio cade.
pub(crate) struct Session {
    #[allow(dead_code)]
    lookup: MdnsAddressLookup,
    task: tauri::async_runtime::JoinHandle<()>,
    pub peers: Arc<Mutex<HashMap<String, Discovered>>>,
}

impl Session {
    pub fn shutdown(self) {
        self.task.abort();
        // `lookup` cade insieme alla sessione: il `DropGuard` di
        // swarm-discovery chiude l'annuncio.
        drop(self.lookup);
    }
}

/// Testo pubblicato con l'annuncio: nome e piattaforma, per l'elenco.
#[derive(Serialize, Deserialize, Default)]
struct Advertised { name: String, platform: String }

fn user_data(name: &str, platform: &str) -> Option<UserData> {
    let mut advertised = Advertised { name: name.to_owned(), platform: platform.to_owned() };
    // `UserData` sta in un record TXT da 255 byte: si tronca il nome, mai il
    // JSON, che senza virgolette chiuse non si leggerebbe dall'altra parte.
    while serde_json::to_string(&advertised).map(|json| json.len() > MAX_USER_DATA).unwrap_or(false)
        && !advertised.name.is_empty() {
        advertised.name.pop();
    }
    serde_json::to_string(&advertised).ok()?.parse().ok()
}

fn view_of(info: &EndpointInfo) -> Option<Discovered> {
    let advertised: Advertised = serde_json::from_str(info.data.user_data()?.as_ref()).ok()?;
    Some(Discovered {
        id: info.endpoint_id.to_string(),
        name: advertised.name,
        platform: advertised.platform,
        relay: info.data.relay_urls().next().map(|url| url.to_string()).unwrap_or_default(),
        ips: info.data.ip_addrs().copied().collect(),
    })
}

/// Avvia annuncio e ascolto. `publish` e' chiamato a ogni variazione
/// dell'elenco (aggiunte e scadenze).
pub(crate) fn start(
    endpoint: &Endpoint,
    name: &str,
    platform: &str,
    publish: impl Fn(Vec<DiscoveredView>) + Send + 'static,
) -> Result<Session, String> {
    if let Some(data) = user_data(name, platform) { endpoint.set_user_data_for_address_lookup(Some(data)); }
    let lookup = MdnsAddressLookup::builder()
        .advertise(true)
        .service_name(SERVICE_NAME)
        .build(endpoint.id())
        .map_err(|error| format!("Local network discovery unavailable: {error}"))?;
    endpoint.address_lookup().map_err(|error| error.to_string())?.add(lookup.clone());
    let peers: Arc<Mutex<HashMap<String, Discovered>>> = Arc::new(Mutex::new(HashMap::new()));
    let shared = peers.clone();
    let subscription = lookup.clone();
    let task = tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        let mut events = subscription.subscribe().await;
        while let Some(event) = events.next().await {
            let changed = {
                let mut peers = shared.lock();
                match event {
                    DiscoveryEvent::Discovered { endpoint_info, .. } => match view_of(&endpoint_info) {
                        Some(peer) => {
                            // Lo stesso annuncio ripetuto non e' un cambiamento: si
                            // confrontano nome e indirizzi, non solo la chiave.
                            let stale = peers.get(&peer.id).is_some_and(|old| {
                                old.name == peer.name && old.platform == peer.platform
                                    && old.relay == peer.relay && old.ips == peer.ips
                            });
                            if stale { false } else { peers.insert(peer.id.clone(), peer); true }
                        }
                        None => false,
                    },
                    DiscoveryEvent::Expired { endpoint_id } => peers.remove(&endpoint_id.to_string()).is_some(),
                    _ => false,
                }
            };
            if !changed { continue; }
            let mut list: Vec<DiscoveredView> = shared.lock().values().map(Discovered::view).collect();
            list.sort_by_key(|entry| entry.name.to_lowercase());
            publish(list);
        }
        publish(Vec::new());
    });
    Ok(Session { lookup, task, peers })
}

/// Ferma annuncio e ascolto: senza servizi di address lookup l'endpoint non
/// pubblica piu' nulla in rete.
pub(crate) fn stop(endpoint: &Endpoint) {
    if let Ok(services) = endpoint.address_lookup() { services.clear(); }
}

/// Le 6 cifre della conferma: `hash(sorted(id_a,id_b) || nonce) mod 10^6`.
/// Lo stesso nonce e le stesse due chiavi danno lo stesso numero su entrambe
/// le macchine; un nonce diverso cambia il numero.
pub(crate) fn sas(first: &str, second: &str, nonce: &str) -> String {
    let (low, high) = if first <= second { (first, second) } else { (second, first) };
    let mut hasher = Sha256::new();
    hasher.update(b"omp-studio-sas:");
    hasher.update(low.as_bytes());
    hasher.update(b"|");
    hasher.update(high.as_bytes());
    hasher.update(b"|");
    hasher.update(nonce.as_bytes());
    let digest = hasher.finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) as u64 % 1_000_000;
    format!("{value:06}")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairRequest {
    pub protocol: u32,
    pub version: String,
    pub name: String,
    pub address: Address,
    /// Nonce della macchina che ha scelto: senza, il numero non sarebbe lo
    /// stesso sui due schermi.
    pub nonce: String,
    pub sas: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairReply {
    pub accept: bool,
    pub name: String,
    #[serde(default)]
    pub version: String,
}

/// Descrizione inviata alla finestra per la conferma.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairPrompt {
    pub request_id: String,
    pub peer_id: String,
    pub name: String,
    pub sas: String,
    /// `incoming` su chi riceve, `outgoing` su chi ha scelto.
    pub direction: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: &str = "aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344";
    const PC: &str = "1122334455667788112233445566778811223344556677881122334455667788";

    #[test]
    fn both_machines_read_the_same_six_digits() {
        let nonce = "nonce-1";
        let here = sas(MAC, PC, nonce);
        let there = sas(PC, MAC, nonce);
        assert_eq!(here, there, "l'ordine delle due chiavi non conta");
        assert_eq!(here.len(), 6);
        assert!(here.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn another_nonce_gives_another_number() {
        // Il nonce viene dalla macchina che sceglie: un secondo tentativo non
        // mostra lo stesso numero, quindi non si puo' riusare una conferma.
        assert_ne!(sas(MAC, PC, "nonce-1"), sas(MAC, PC, "nonce-2"));
        assert_ne!(sas(MAC, PC, "nonce-1"), sas(MAC, "third", "nonce-1"));
    }

    #[test]
    fn the_advertised_user_data_fits_the_txt_record() {
        let data = user_data(&"x".repeat(400), "macos").unwrap();
        let text: &str = data.as_ref();
        assert!(text.len() <= MAX_USER_DATA);
        let parsed: Advertised = serde_json::from_str(text).unwrap();
        assert_eq!(parsed.platform, "macos");
        assert!(!parsed.name.is_empty());
    }

    #[test]
    fn a_discovered_endpoint_is_read_back_with_its_name_and_addresses() {
        use iroh::address_lookup::EndpointData;
        let id: EndpointId = MAC.parse().unwrap();
        let mut data = EndpointData::default();
        data.set_user_data(user_data("MacBook", "macos"));
        data.add_ip_addrs(vec!["192.168.1.8:4242".parse().unwrap()]);
        let info = EndpointInfo::from_parts(id, data);
        let discovered = view_of(&info).unwrap();
        assert_eq!(discovered.name, "MacBook");
        assert_eq!(discovered.platform, "macos");
        assert_eq!(discovered.ips.len(), 1);
        assert!(discovered.endpoint_addr().is_ok());
    }
}
