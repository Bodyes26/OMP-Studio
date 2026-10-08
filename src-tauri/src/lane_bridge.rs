//! Server HTTP bridge loopback per la gestione delle corsie da parte degli agenti.
//!
//! Espone un router minimale su `127.0.0.1:<port>` riservato ai processi figli
//! (estensione `studio-lanes.ts`, tool `corsia_*`):
//! `POST /v1/corsie/{avvia,stato,risultato,integra,chiudi,scarta,consegna,fatto,proponi}`.
//! `POST /v1/lane/integrate` resta come alias retrocompatibile di `integra`.
//! L'autenticazione avviene tramite token per-sessione confrontato in tempo
//! costante; il proprietario del token decide i permessi: un agente dentro una
//! corsia puo' solo dire `fatto` e leggere lo `stato`, mai aprire o chiudere
//! corsie (una corsia non genera corsie).

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, OnceLock};
use std::time::{Duration, SystemTime};

use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// Informazioni sul proprietario di un token emesso (sessione agente o PTY).
#[derive(Clone, Debug)]
pub struct BridgeOwner {
    pub owner_kind: String, // "agent" | "terminal"
    pub owner_id: u64,
    pub project_id: Option<String>,
    pub lane_id: Option<String>,
    pub cwd: String,
}

/// Verbo richiesto al bridge. Studio fa il "come": l'agente nomina solo cosa vuole.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CorsiaRoute {
    Avvia,
    Stato,
    Risultato,
    Integra,
    Chiudi,
    Scarta,
    Consegna,
    Fatto,
    Proponi,
}

impl CorsiaRoute {
    pub const ALL: [CorsiaRoute; 9] = [
        CorsiaRoute::Avvia,
        CorsiaRoute::Stato,
        CorsiaRoute::Risultato,
        CorsiaRoute::Integra,
        CorsiaRoute::Chiudi,
        CorsiaRoute::Scarta,
        CorsiaRoute::Consegna,
        CorsiaRoute::Fatto,
        CorsiaRoute::Proponi,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            CorsiaRoute::Avvia => "avvia",
            CorsiaRoute::Stato => "stato",
            CorsiaRoute::Risultato => "risultato",
            CorsiaRoute::Integra => "integra",
            CorsiaRoute::Chiudi => "chiudi",
            CorsiaRoute::Scarta => "scarta",
            CorsiaRoute::Consegna => "consegna",
            CorsiaRoute::Fatto => "fatto",
            CorsiaRoute::Proponi => "proponi",
        }
    }

    /// Percorso HTTP -> verbo. Il secondo valore segnala l'alias storico
    /// `/v1/lane/integrate`, il cui corpo usa ancora `laneId`/`message`.
    pub fn from_path(path: &str) -> Option<(CorsiaRoute, bool)> {
        let path = path.split('?').next().unwrap_or_default();
        let path = path.trim_end_matches('/');
        if path == "/v1/lane/integrate" {
            return Some((CorsiaRoute::Integra, true));
        }
        let verb = path.strip_prefix("/v1/corsie/")?;
        CorsiaRoute::ALL
            .into_iter()
            .find(|route| route.as_str() == verb)
            .map(|route| (route, false))
    }

    /// Dentro una corsia l'agente segnala la fine del lavoro e legge lo stato:
    /// creare, integrare o scartare corsie resta alla Principale.
    pub fn allowed_inside_lane(self) -> bool {
        matches!(self, CorsiaRoute::Stato | CorsiaRoute::Fatto)
    }

    /// Campo testuale obbligatorio del corpo, se il verbo ne ha uno.
    /// `integra` accetta la corsia implicita (una sola aperta): la sceglie Studio.
    pub fn required_field(self) -> Option<&'static str> {
        match self {
            CorsiaRoute::Avvia => Some("obiettivo"),
            CorsiaRoute::Stato => None,
            CorsiaRoute::Risultato | CorsiaRoute::Chiudi | CorsiaRoute::Scarta => Some("corsia"),
            CorsiaRoute::Integra => Some("messaggio"),
            CorsiaRoute::Consegna => Some("prototipo"),
            CorsiaRoute::Fatto => Some("riassunto"),
            CorsiaRoute::Proponi => Some("motivo"),
        }
    }

    /// Attesa massima della risposta del frontend. `proponi` aspetta un clic
    /// dell'utente, che puo' essere lontano dalla tastiera: tre minuti
    /// farebbero fallire la proposta mentre la card e' ancora a schermo.
    pub fn response_timeout(self) -> Duration {
        match self {
            CorsiaRoute::Proponi => Duration::from_secs(30 * 60),
            _ => Duration::from_secs(180),
        }
    }
}

/// Vero se il token appartiene a un agente dentro una corsia secondaria
/// (worktree o Laboratorio). Una sessione senza corsia e' la Principale.
pub fn owner_inside_lane(owner: &BridgeOwner) -> bool {
    owner
        .lane_id
        .as_deref()
        .map(str::trim)
        .is_some_and(|lane| !lane.is_empty() && lane != "main")
}

/// Payload dell'evento Tauri emesso verso il frontend quando arriva una richiesta HTTP valida.
/// `lane_id` e `message` restano per i lettori dell'alias storico; il router usa `route` e `body`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LaneBridgeRequestEvent {
    pub request_id: String,
    pub route: String,
    pub owner_kind: String,
    pub owner_id: u64,
    pub project_id: Option<String>,
    pub caller_lane_id: Option<String>,
    pub cwd: String,
    pub lane_id: Option<String>,
    pub message: String,
    pub body: serde_json::Value,
}

static BRIDGE_PORT: OnceLock<u16> = OnceLock::new();
static TOKENS: LazyLock<Mutex<HashMap<String, BridgeOwner>>> = LazyLock::new(Default::default);
static PENDING_REQUESTS: LazyLock<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>> =
    LazyLock::new(Default::default);

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);
static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Genera un token crittograficamente resistente di 256 bit in formato esadecimale (64 caratteri).
fn generate_token_256() -> String {
    let mut hasher = Sha256::new();
    for _ in 0..4 {
        let s = RandomState::new();
        let mut h = s.build_hasher();
        h.write_u64(TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed));
        let finish = h.finish();
        hasher.update(finish.to_le_bytes());
    }
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    hasher.update(now.as_nanos().to_le_bytes());
    let pid = std::process::id();
    hasher.update(pid.to_le_bytes());
    let result = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in result {
        use std::fmt::Write;
        let _ = write!(hex, "{:02x}", b);
    }
    hex
}

/// Confronto in tempo costante di due sequenze di byte per mitigare attacchi di temporizzazione.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Cerca il proprietario del token confrontando tutti i token attivi in tempo costante.
fn lookup_token(incoming: &str) -> Option<BridgeOwner> {
    let tokens = TOKENS.lock();
    let incoming_bytes = incoming.as_bytes();
    let mut matched_owner = None;
    for (tok, owner) in tokens.iter() {
        if constant_time_eq(tok.as_bytes(), incoming_bytes) {
            matched_owner = Some(owner.clone());
        }
    }
    matched_owner
}

/// Genera un identificativo univoco per la richiesta di integrazione.
fn generate_request_id() -> String {
    let counter = REQ_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("req_{}_{}", now, counter)
}

/// Emette un nuovo token per una sessione Studio.
/// Restituisce `Some((url, token))` se il listener HTTP e' attivo, altrimenti `None`.
pub fn issue_token(owner: BridgeOwner) -> Option<(String, String)> {
    let port = *BRIDGE_PORT.get()?;
    let token = generate_token_256();
    let url = format!("http://127.0.0.1:{}", port);
    TOKENS.lock().insert(token.clone(), owner);
    Some((url, token))
}

/// Revoca tutti i token appartenenti al proprietario indicato (es. alla chiusura del processo).
pub fn revoke_owner(owner_kind: &str, owner_id: u64) {
    let mut tokens = TOKENS.lock();
    tokens.retain(|_, owner| !(owner.owner_kind == owner_kind && owner.owner_id == owner_id));
}

/// Comando Tauri invocato dal frontend quando la richiesta e' stata gestita.
/// Risolve il canale oneshot associato alla richiesta HTTP in attesa.
#[tauri::command]
pub async fn lane_bridge_respond(
    request_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    let sender = PENDING_REQUESTS.lock().remove(&request_id);
    match sender {
        Some(tx) => {
            let _ = tx.send(response);
            Ok(())
        }
        None => Err(format!(
            "Richiesta bridge '{}' non trovata o gia' scaduta",
            request_id
        )),
    }
}

/// Invia una risposta HTTP/1.1 con Content-Type: application/json e Connection: close.
async fn send_response(
    stream: &mut TcpStream,
    status_code: u16,
    reason: &str,
    body: &serde_json::Value,
) -> Result<(), std::io::Error> {
    let body_bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status_code,
        reason,
        body_bytes.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(&body_bytes).await?;
    stream.flush().await?;
    Ok(())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Rifiuto HTTP: codice, frase di stato e testo per il tool.
type Rejection = (u16, &'static str, String);

fn rejection(code: u16, reason: &'static str, text: impl Into<String>) -> Rejection {
    (code, reason, text.into())
}

/// Richiesta autenticata, autorizzata e gia' validata.
struct BridgeRequest {
    owner: BridgeOwner,
    route: CorsiaRoute,
    /// Corpo normalizzato: l'alias storico viene riscritto con i nomi italiani.
    body: serde_json::Map<String, serde_json::Value>,
}

impl BridgeRequest {
    fn text(&self, field: &str) -> Option<String> {
        self.body
            .get(field)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }
}

/// Permesso del proprietario del token sul verbo richiesto.
fn authorize(route: CorsiaRoute, owner: &BridgeOwner) -> Result<(), Rejection> {
    if owner_inside_lane(owner) && !route.allowed_inside_lane() {
        return Err(rejection(
            403,
            "Forbidden",
            format!(
                "Dentro una corsia sono ammessi solo corsia_fatto e corsia_stato: '{}' spetta alla Principale",
                route.as_str()
            ),
        ));
    }
    Ok(())
}

/// Legge header e corpo di una sola richiesta. Il timeout copre l'intera
/// lettura: un client lento dopo gli header non tiene aperta la connessione.
async fn read_request(stream: &mut TcpStream) -> Result<BridgeRequest, Rejection> {
    const HEADER_LIMIT: usize = 16 * 1024;
    const BODY_LIMIT: usize = 64 * 1024;

    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(position) = find_subslice(&buffer, b"\r\n\r\n") {
            break position;
        }
        if buffer.len() > HEADER_LIMIT {
            return Err(rejection(
                431,
                "Request Header Fields Too Large",
                "Header HTTP oltre 16 KiB",
            ));
        }
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| rejection(400, "Bad Request", error.to_string()))?;
        if read == 0 {
            return Err(rejection(400, "Bad Request", "Richiesta HTTP incompleta"));
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| rejection(400, "Bad Request", "Header HTTP non UTF-8"))?;
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split_whitespace();
    let (method, path) = (
        request_line.next().unwrap_or_default(),
        request_line.next().unwrap_or_default(),
    );
    let Some((route, legacy)) = CorsiaRoute::from_path(path) else {
        return Err(rejection(
            404,
            "Not Found",
            format!("Percorso '{path}' non trovato"),
        ));
    };
    if method != "POST" {
        return Err(rejection(405, "Method Not Allowed", "Usare POST"));
    }

    let mut content_length = None;
    let mut token = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name.trim().eq_ignore_ascii_case("content-length") {
            content_length = value.parse::<usize>().ok();
        } else if name.trim().eq_ignore_ascii_case("authorization") {
            token = value
                .split_once(' ')
                .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
                .map(|(_, credential)| credential.trim().to_string());
        }
    }
    let owner = token.as_deref().and_then(lookup_token).ok_or_else(|| {
        rejection(
            401,
            "Unauthorized",
            "Token del bridge assente, non valido o revocato",
        )
    })?;
    authorize(route, &owner)?;
    let length = content_length
        .ok_or_else(|| rejection(411, "Length Required", "Header Content-Length obbligatorio"))?;
    if length > BODY_LIMIT {
        return Err(rejection(413, "Payload Too Large", "Corpo oltre 64 KiB"));
    }

    let mut body = buffer.split_off(header_end + 4);
    while body.len() < length {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| rejection(400, "Bad Request", error.to_string()))?;
        if read == 0 {
            return Err(rejection(
                400,
                "Bad Request",
                "Corpo piu' corto di Content-Length",
            ));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);

    let json: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| rejection(400, "Bad Request", "Il corpo non e' JSON valido"))?;
    let serde_json::Value::Object(mut fields) = json else {
        return Err(rejection(
            400,
            "Bad Request",
            "Il corpo deve essere un oggetto JSON",
        ));
    };
    if legacy {
        // `/v1/lane/integrate` parlava inglese: si traduce una volta qui, cosi'
        // il frontend conosce un solo vocabolario.
        if let Some(message) = fields.remove("message") {
            fields.entry("messaggio").or_insert(message);
        }
        if let Some(lane) = fields.remove("laneId") {
            fields.entry("corsia").or_insert(lane);
        }
    }
    let request = BridgeRequest {
        owner,
        route,
        body: fields,
    };
    if let Some(field) = route.required_field() {
        if request.text(field).is_none() {
            return Err(rejection(
                400,
                "Bad Request",
                format!("Campo '{field}' obbligatorio"),
            ));
        }
    }
    Ok(request)
}

/// Gestisce una singola connessione HTTP.
async fn handle_connection(mut stream: TcpStream, app: AppHandle) -> Result<(), std::io::Error> {
    let request = match tokio::time::timeout(Duration::from_secs(10), read_request(&mut stream))
        .await
    {
        Ok(Ok(request)) => request,
        Ok(Err((code, reason, text))) => {
            return send_response(
                &mut stream,
                code,
                reason,
                &serde_json::json!({ "ok": false, "text": text }),
            )
            .await;
        }
        Err(_) => {
            let body =
                serde_json::json!({ "ok": false, "text": "Timeout nella lettura della richiesta" });
            return send_response(&mut stream, 408, "Request Timeout", &body).await;
        }
    };

    let request_id = generate_request_id();
    let (tx, rx) = oneshot::channel::<serde_json::Value>();
    PENDING_REQUESTS.lock().insert(request_id.clone(), tx);

    let route = request.route;
    let lane_id = request.text("corsia");
    let message = request.text("messaggio").unwrap_or_default();
    let event_payload = LaneBridgeRequestEvent {
        request_id: request_id.clone(),
        route: route.as_str().to_string(),
        owner_kind: request.owner.owner_kind,
        owner_id: request.owner.owner_id,
        project_id: request.owner.project_id,
        caller_lane_id: request.owner.lane_id,
        cwd: request.owner.cwd,
        lane_id,
        message,
        body: serde_json::Value::Object(request.body),
    };
    if let Err(error) = app.emit("lane-bridge://request", &event_payload) {
        PENDING_REQUESTS.lock().remove(&request_id);
        let body = serde_json::json!({ "ok": false, "text": format!("Studio non ha ricevuto la richiesta: {error}") });
        return send_response(&mut stream, 500, "Internal Server Error", &body).await;
    }

    // Il frontend risponde sempre con `lane_bridge_respond`; il timeout copre
    // solo una finestra ricaricata o bloccata (o, per `proponi`, un utente assente).
    let outcome = tokio::time::timeout(route.response_timeout(), rx).await;
    PENDING_REQUESTS.lock().remove(&request_id);
    match outcome {
        Ok(Ok(value)) => send_response(&mut stream, 200, "OK", &value).await,
        Ok(Err(_)) => {
            let body = serde_json::json!({ "ok": false, "text": "Studio ha chiuso la richiesta senza esito" });
            send_response(&mut stream, 500, "Internal Server Error", &body).await
        }
        Err(_) => {
            let body =
                serde_json::json!({ "ok": false, "text": "Studio non ha risposto in tempo" });
            send_response(&mut stream, 504, "Gateway Timeout", &body).await
        }
    }
}

/// Avvia il server bridge HTTP loopback su 127.0.0.1:0 in un task asincrono dedicato.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[LaneBridge] Impossibile avviare listener TCP su 127.0.0.1:0: {}",
                    e
                );
                return;
            }
        };

        let port = match listener.local_addr() {
            Ok(addr) => addr.port(),
            Err(e) => {
                eprintln!("[LaneBridge] Impossibile determinare porta locale: {}", e);
                return;
            }
        };

        let _ = BRIDGE_PORT.set(port);

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app_clone = app.clone();
                    tokio::spawn(async move {
                        let _ = handle_connection(stream, app_clone).await;
                    });
                }
                Err(e) => {
                    eprintln!("[LaneBridge] Errore accept listener: {}", e);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scrive `raw` su una connessione loopback reale e legge la richiesta
    /// dal lato server con lo stesso parser del bridge.
    async fn parse(raw: String) -> Result<BridgeRequest, Rejection> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(raw.as_bytes()).await.unwrap();
            stream
        });
        let (mut server, _) = listener.accept().await.unwrap();
        let _client = client.await.unwrap();
        read_request(&mut server).await
    }

    fn post(path: &str, token: &str, body: &str) -> String {
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn request(token: &str, body: &str) -> String {
        post("/v1/lane/integrate", token, body)
    }

    fn owner(owner_id: u64, lane: Option<&str>) -> BridgeOwner {
        BridgeOwner {
            owner_kind: "agent".to_string(),
            owner_id,
            project_id: Some("progetto".to_string()),
            lane_id: lane.map(str::to_string),
            cwd: "C:/repo".to_string(),
        }
    }

    fn register(owner_id: u64, lane: Option<&str>) -> String {
        let token = generate_token_256();
        TOKENS.lock().insert(token.clone(), owner(owner_id, lane));
        token
    }

    fn code(result: Result<BridgeRequest, Rejection>) -> Option<u16> {
        result.err().map(|(code, _, _)| code)
    }

    #[tokio::test]
    async fn alias_storico_restituisce_proprietario_e_corsia_tradotti() {
        let token = register(9101, Some("main"));
        let parsed = parse(request(
            &token,
            r#"{"laneId":"wt2","message":"Preavviso 6 mesi"}"#,
        ))
        .await
        .unwrap_or_else(|(code, _, text)| panic!("{code}: {text}"));
        assert_eq!(parsed.owner.owner_id, 9101);
        assert_eq!(parsed.route, CorsiaRoute::Integra);
        assert_eq!(parsed.text("corsia").as_deref(), Some("wt2"));
        assert_eq!(
            parsed.text("messaggio").as_deref(),
            Some("Preavviso 6 mesi")
        );
        assert!(parsed.body.get("laneId").is_none());
        revoke_owner("agent", 9101);
    }

    #[tokio::test]
    async fn token_revocato_o_ignoto_viene_rifiutato() {
        let token = register(9102, None);
        revoke_owner("agent", 9102);
        let revoked = parse(request(&token, r#"{"message":"x"}"#)).await;
        assert_eq!(code(revoked), Some(401));
        let unknown = parse(request("0000", r#"{"message":"x"}"#)).await;
        assert_eq!(code(unknown), Some(401));
    }

    #[tokio::test]
    async fn messaggio_vuoto_e_percorso_sbagliato_vengono_rifiutati() {
        let token = register(9103, None);
        let empty = parse(request(&token, r#"{"message":"  "}"#)).await;
        assert_eq!(code(empty), Some(400));
        let wrong = parse(post("/v1/altro", &token, "{}")).await;
        assert_eq!(code(wrong), Some(404));
        let unknown_verb = parse(post("/v1/corsie/merge", &token, "{}")).await;
        assert_eq!(code(unknown_verb), Some(404));
        let not_object = parse(post("/v1/corsie/stato", &token, "[]")).await;
        assert_eq!(code(not_object), Some(400));
        revoke_owner("agent", 9103);
    }

    #[test]
    fn ogni_verbo_ha_il_suo_percorso() {
        for route in CorsiaRoute::ALL {
            let path = format!("/v1/corsie/{}", route.as_str());
            assert_eq!(CorsiaRoute::from_path(&path), Some((route, false)));
            assert_eq!(
                CorsiaRoute::from_path(&format!("{path}/")),
                Some((route, false))
            );
        }
        assert_eq!(
            CorsiaRoute::from_path("/v1/lane/integrate"),
            Some((CorsiaRoute::Integra, true))
        );
        assert_eq!(CorsiaRoute::from_path("/v1/corsie/"), None);
        assert_eq!(CorsiaRoute::from_path("/v1/corsie/avvia/extra"), None);
    }

    #[tokio::test]
    async fn la_principale_puo_usare_tutti_i_verbi() {
        let token = register(9104, Some("main"));
        let parsed = parse(post(
            "/v1/corsie/avvia",
            &token,
            r#"{"obiettivo":"Rifai il login","tipo":"worktree"}"#,
        ))
        .await
        .unwrap_or_else(|(code, _, text)| panic!("{code}: {text}"));
        assert_eq!(parsed.route, CorsiaRoute::Avvia);
        assert_eq!(parsed.text("obiettivo").as_deref(), Some("Rifai il login"));
        assert_eq!(parsed.text("tipo").as_deref(), Some("worktree"));

        let stato = parse(post("/v1/corsie/stato", &token, "{}")).await;
        assert!(stato.is_ok());
        let proponi = parse(post(
            "/v1/corsie/proponi",
            &token,
            r#"{"motivo":"rm -rf dist"}"#,
        ))
        .await;
        assert!(proponi.is_ok());
        revoke_owner("agent", 9104);

        // Una sessione senza corsia (terminale della Principale) vale come Principale.
        let token = register(9105, None);
        let integra = parse(post(
            "/v1/corsie/integra",
            &token,
            r#"{"corsia":"wt1","messaggio":"Fix"}"#,
        ))
        .await;
        assert!(integra.is_ok());
        revoke_owner("agent", 9105);
    }

    #[tokio::test]
    async fn dentro_una_corsia_solo_fatto_e_stato() {
        let token = register(9106, Some("wt1"));
        let fatto = parse(post(
            "/v1/corsie/fatto",
            &token,
            r#"{"riassunto":"Login rifatto, test verdi"}"#,
        ))
        .await;
        assert!(fatto.is_ok());
        let stato = parse(post("/v1/corsie/stato", &token, "{}")).await;
        assert!(stato.is_ok());

        for verb in [
            "avvia",
            "integra",
            "chiudi",
            "scarta",
            "consegna",
            "proponi",
            "risultato",
        ] {
            let denied = parse(post(
                &format!("/v1/corsie/{verb}"),
                &token,
                r#"{"obiettivo":"x","corsia":"wt2","messaggio":"x","prototipo":"p","motivo":"x"}"#,
            ))
            .await;
            assert_eq!(code(denied), Some(403), "verbo {verb}");
        }
        // Neppure l'alias storico apre una scappatoia: una corsia non si integra da sola.
        let legacy = parse(request(&token, r#"{"message":"x"}"#)).await;
        assert_eq!(code(legacy), Some(403));
        revoke_owner("agent", 9106);
    }

    #[tokio::test]
    async fn campi_obbligatori_per_verbo() {
        let token = register(9107, Some("main"));
        for route in CorsiaRoute::ALL {
            let Some(field) = route.required_field() else {
                continue;
            };
            let path = format!("/v1/corsie/{}", route.as_str());
            let missing = parse(post(&path, &token, r#"{"altro":"x"}"#)).await;
            assert_eq!(code(missing), Some(400), "verbo {}", route.as_str());
            let blank = parse(post(&path, &token, &format!(r#"{{"{field}":"   "}}"#))).await;
            assert_eq!(code(blank), Some(400), "verbo {}", route.as_str());
            let ok = parse(post(&path, &token, &format!(r#"{{"{field}":"valore"}}"#))).await;
            assert!(ok.is_ok(), "verbo {}", route.as_str());
        }
        revoke_owner("agent", 9107);
    }

    #[test]
    fn proponi_aspetta_l_utente_piu_a_lungo() {
        assert!(CorsiaRoute::Proponi.response_timeout() >= Duration::from_secs(600));
        assert_eq!(
            CorsiaRoute::Integra.response_timeout(),
            Duration::from_secs(180)
        );
        assert!(!owner_inside_lane(&owner(1, None)));
        assert!(!owner_inside_lane(&owner(1, Some("main"))));
        assert!(!owner_inside_lane(&owner(1, Some("  "))));
        assert!(owner_inside_lane(&owner(1, Some("lab-p-20260101-abc"))));
    }
}
