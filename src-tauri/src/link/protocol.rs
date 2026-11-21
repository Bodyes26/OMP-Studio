//! Messaggi incorniciati: i binari non passano da JSON/base64.
use std::collections::HashMap;
use iroh::endpoint::{RecvStream, SendStream};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use super::config::Address;

pub(crate) const ALPN: &[u8] = b"omp-studio/instances/1";
pub(crate) const PROTOCOL: u32 = 1;
const MAX_HEADER: usize = 1024 * 1024;
pub(crate) const MAX_BODY: usize = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hello {
    pub protocol: u32,
    pub version: String,
    pub name: String,
    pub address: Address,
    pub pairing: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub(crate) enum Operation {
    Invoke { command: String, headers: HashMap<String, String>, body_len: usize, raw: bool, consumer: Option<String> },
    Open { command: String, args: Value, consumer: String, session_id: Option<u64>, after: Option<u64> },
    WatchState,
    Ping,
    /// Revoca propagata (R-MI-34): una macchina abbinata chiede alle altre di
    /// revocare lo stesso id. Non viaggia mai come comando del catalogo: e'
    /// un messaggio del protocollo, accettato solo da un peer abbinato.
    Revoke { id: String },
    /// Inoltro di una porta di `localhost` dell'host (R-MI-40): dopo la
    /// risposta lo stream porta i byte di una connessione TCP nei due sensi.
    Forward { port: u16, project: String, probe: bool },
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Reply {
    Json { len: usize },
    Raw { len: usize },
    Error { error: Value },
    Pong,
    Event { event: std::borrow::Cow<'static, str>, len: usize },
    Resync,
    Opened { id: u64, continued: bool },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "frame", rename_all = "camelCase")]
pub(crate) enum StreamFrame {
    Rpc { seq: u64, len: usize },
    Rebind { id: u64, len: usize },
    Exit { seq: u64, len: usize },
    Bytes { offset: u64, len: usize },
    Snapshot { offset: u64, len: usize },
    Resize { cols: u16, rows: u16 },
    Cursor { seq: u64 },
    /// La coda dell'host ha scartato un frame per il tetto: il consumatore
    /// deve ripartire da capo invece di ricevere un flusso con un buco (B1).
    Resync,
}

pub(crate) async fn send_json<T: Serialize>(send: &mut SendStream, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_HEADER { return Err("Link header exceeds limit".into()); }
    send.write_all(&(bytes.len() as u32).to_be_bytes()).await.map_err(|error| error.to_string())?;
    send.write_all(&bytes).await.map_err(|error| error.to_string())
}

pub(crate) async fn read_json<T: DeserializeOwned>(recv: &mut RecvStream) -> Result<T, String> {
    let mut length = [0; 4];
    recv.read_exact(&mut length).await.map_err(|error| error.to_string())?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_HEADER { return Err("Link header exceeds limit".into()); }
    let mut bytes = vec![0; length];
    recv.read_exact(&mut bytes).await.map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

pub(crate) async fn read_body(recv: &mut RecvStream, len: usize) -> Result<Vec<u8>, String> {
    if len > MAX_BODY { return Err("Link body exceeds limit".into()); }
    let mut body = vec![0; len];
    recv.read_exact(&mut body).await.map_err(|error| error.to_string())?;
    Ok(body)
}
