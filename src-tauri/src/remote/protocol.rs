//! Tipi e costanti del protocollo per il controllo remoto (Gate R44).
//!
//! Specchio fedele di `relay/src/protocol.ts` e `src/lib/remote/bridge.ts`.
//! Tutti i campi JSON scambiati sul wire o con il frontend usano camelCase.

use serde::{Deserialize, Serialize};

/// Nome canonico del protocollo: deve corrispondere a `PROTOCOL.name` in `relay/src/protocol.ts`.
pub const PROTOCOL_NAME: &str = "omp-studio-remote";

/// Versione supportata da questa istanza di Studio (`PROTOCOL.version` in `relay/src/protocol.ts`).
pub const PROTOCOL_VERSION: u32 = 1;

/// Minima versione accettata (`MIN_HOST_PROTOCOL_VERSION` in `relay/src/protocol.ts`).
pub const MIN_HOST_PROTOCOL_VERSION: u32 = 1;

/// Funzioni offerte da Studio: specchio di `FEATURES` in `protocol.ts`.
pub const FEATURES: &[&str] = &[
    "respond_ui",
    "run_task",
    "quota_actions",
    "task_edit",
    "session_control",
    "chat",
    "projects",
];

/// Tetto di un frame JSON (`MAX_FRAME_BYTES` in `protocol.ts`): oltre, il relay chiude la connessione.
pub const MAX_FRAME_BYTES: usize = 512 * 1024;

/// Timeout d'inattivita' prima di considerare la connessione caduta (70 s).
pub const HEARTBEAT_TIMEOUT_MS: u64 = 70_000;

/// Tempo massimo per ricevere il benvenuto dopo l'apertura (5 s).
pub const HELLO_TIMEOUT_MS: u64 = 5_000;

/// Codici di chiusura WebSocket definiti in `protocol.ts`.
pub mod close_code {
    pub const NORMAL: u16 = 1000;
    pub const PROTOCOL_ERROR: u16 = 4400;
    pub const UNAUTHORIZED: u16 = 4401;
    pub const REVOKED: u16 = 4403;
    pub const REPLACED: u16 = 4409;
    pub const INCOMPATIBLE: u16 = 4426;
}

/// Stato della connessione verso il relay.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteConnection {
    Disabled,
    Unpaired,
    Connecting,
    Connected,
    Waiting,
    Revoked,
    Incompatible,
}

/// Indica chi va aggiornato quando le versioni non combaciano.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateNeeded {
    Relay,
    Studio,
}

/// Intervallo di versioni accettate dal relay.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProtocolRange {
    pub min: u32,
    pub max: u32,
}

/// Informazioni su un dispositivo client collegato al relay.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

/// Errore restituito da un comando remoto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

/// Stato complessivo del controllo remoto esposto alla WebView (`RemoteStatus`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    pub relay_url: Option<String>,
    pub machine_name: String,
    pub host_id: String,
    pub paired: bool,
    pub connection: RemoteConnection,
    pub last_error: Option<String>,
    pub retry_at: Option<i64>,
    pub clients: Vec<DeviceInfo>,
    pub relay_version: Option<String>,
    pub relay_protocol: Option<RelayProtocolRange>,
    pub update_needed: Option<UpdateNeeded>,
}

/// Evento di comando inviato alla finestra principale (`remote://command`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandEvent {
    pub command_id: String,
    pub device: DeviceInfo,
    pub command: serde_json::Value,
}

/// Riferimento a una corsia di un progetto (`RemoteLaneRef` in `protocol.ts`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLaneRef {
    pub project_id: String,
    pub lane_id: String,
}

/// Evento emesso alla finestra principale quando cambia l'elenco delle corsie seguite (`remote://chat_watch`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChatWatchEvent {
    pub lanes: Vec<RemoteLaneRef>,
}
/// Identificatore del protocollo scambiato nel frame `hello` / `welcome`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolId {
    pub name: String,
    pub version: u32,
}

/// Gamma di protocollo del relay (`protocol` in `RelayInfo`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProtocolInfo {
    pub name: String,
    pub min: u32,
    pub max: u32,
}

/// Informazioni sul relay restituite nel `welcome`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    pub version: String,
    pub protocol: RelayProtocolInfo,
}

/// Informazioni sulla macchina inviate nel frame `hello`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub name: String,
    pub platform: String,
    pub app_version: String,
}

/// Frame inviati da Studio al relay (Host -> Relay).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum HostFrame {
    #[serde(rename = "hello")]
    Hello {
        protocol: ProtocolId,
        features: Vec<String>,
        host: HostInfo,
    },
    #[serde(rename = "snapshot")]
    Snapshot { seq: u64, state: serde_json::Value },
    #[serde(rename = "command_result")]
    CommandResult {
        #[serde(rename = "commandId")]
        command_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<CommandError>,
        /// Dati del comando (`RemoteCommandData` in `protocol.ts`): Rust li inoltra senza leggerli.
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
    },
    #[serde(rename = "pong")]
    Pong { seq: u64 },
    #[serde(rename = "chat_event")]
    ChatEvent {
        #[serde(rename = "projectId")]
        project_id: String,
        #[serde(rename = "laneId")]
        lane_id: String,
        event: serde_json::Value,
    },
}

/// Frame inviati dal relay a Studio (Relay -> Host).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RelayToHostFrame {
    #[serde(rename = "welcome")]
    Welcome {
        protocol: ProtocolId,
        relay: RelayInfo,
        features: Vec<String>,
        #[serde(rename = "heartbeatMs")]
        heartbeat_ms: u64,
        clients: Vec<DeviceInfo>,
    },
    #[serde(rename = "clients")]
    Clients { clients: Vec<DeviceInfo> },
    #[serde(rename = "command")]
    Command {
        #[serde(rename = "commandId")]
        command_id: String,
        device: DeviceInfo,
        command: serde_json::Value,
    },
    #[serde(rename = "ping")]
    Ping {
        seq: u64,
        #[serde(default)]
        t: u64,
    },
    #[serde(rename = "chat_watch")]
    ChatWatch { lanes: Vec<RemoteLaneRef> },
}
/// Risposta pubblica di `/healthz`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub service: String,
    pub version: String,
    pub protocol: RelayProtocolInfo,
}

/// Risposta a `POST /v1/pair/host`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairHostResponse {
    pub host_id: String,
    pub credential: String,
}

/// Nome della piattaforma corrente conforme al tipo `Platform` di `protocol.ts`.
pub fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "linux"
    }
}
