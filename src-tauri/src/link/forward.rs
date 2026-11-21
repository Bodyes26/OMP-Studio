//! Anteprima del server di sviluppo dell'altra macchina (R-MI-40): una porta
//! di `localhost` dell'host diventa una porta locale di chi guarda.
//!
//! Ogni connessione TCP accettata qui apre uno stream sul collegamento
//! (`Operation::Forward`); l'host si collega solo a `127.0.0.1`/`::1` sulla
//! porta chiesta e copia i byte nei due sensi. Basta questo perche' anche il
//! ricaricamento a caldo (websocket) funzioni. Serve l'ambito Terminale: un
//! server locale dell'altra macchina vale quanto una sua shell.
use std::{collections::HashMap, sync::LazyLock, time::Duration};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::Manager;
use tokio::{net::{TcpListener, TcpStream}, task::JoinSet};
use super::{LinkManager, Runtime};
use super::protocol::{Operation, Reply, read_json, send_json};

const CONNECT: Duration = Duration::from_secs(10);
const CHECK: Duration = Duration::from_secs(2);
const MAX_CONNECTIONS: usize = 32;

struct Forward {
    owner: String,
    local_port: u16,
    task: tokio::task::AbortHandle,
}

impl Drop for Forward {
    fn drop(&mut self) { self.task.abort(); }
}

static FORWARDS: LazyLock<Mutex<HashMap<String, Forward>>> = LazyLock::new(Default::default);

fn allowed_port(port: u16) -> bool { port != 0 }

impl Runtime {
    pub(super) async fn serve_forward(&self, machine: &str, port: u16, project: &str,
        probe: bool, generation: u64, streams: (&mut iroh::endpoint::SendStream, &mut iroh::endpoint::RecvStream)) -> Result<(), String> {
        let (send, recv) = streams;
        self.authorize(machine, "pty_open", generation)?;
        self.require_known_project(project)?;
        if !allowed_port(port) { return Err(format!("Port {port} cannot be forwarded")); }
        let mut target = tokio::time::timeout(CONNECT, async {
            match TcpStream::connect(("127.0.0.1", port)).await {
                Ok(stream) => Ok(stream),
                Err(_) => TcpStream::connect(("::1", port)).await,
            }
        }).await.map_err(|_| format!("localhost:{port} did not answer"))?
            .map_err(|error| format!("Nothing is listening on localhost:{port}: {error}"))?;
        send_json(send, &Reply::Pong).await?;
        if probe {
            self.audit(machine, "terminal", "port_forward", &json!({ "projectId": project, "port": port }));
            return Ok(());
        }
        let mut remote = tokio::io::join(recv, send);
        tokio::select! {
            _ = tokio::io::copy_bidirectional(&mut remote, &mut target) => {}
            _ = async {
                loop {
                    tokio::time::sleep(CHECK).await;
                    if self.authorize(machine, "pty_open", generation).is_err() ||
                        self.require_known_project(project).is_err() { break; }
                }
            } => {}
        }
        Ok(())
    }
}

async fn open_stream(connection: &iroh::endpoint::Connection, port: u16, project: &str, probe: bool)
    -> Result<(iroh::endpoint::SendStream, iroh::endpoint::RecvStream), String> {
    tokio::time::timeout(CONNECT + CONNECT, async {
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
        send_json(&mut send, &Operation::Forward { port, project: project.into(), probe }).await?;
        match read_json::<Reply>(&mut recv).await? {
            Reply::Pong => Ok((send, recv)),
            Reply::Error { error } => Err(error.as_str().map(str::to_owned).unwrap_or_else(|| error.to_string())),
            _ => Err("Unexpected forward reply".into()),
        }
    }).await.map_err(|_| "The remote preview did not answer".to_owned())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForwardInfo {
    id: String,
    local_port: u16,
}

fn close(app: &tauri::AppHandle, ids: Vec<String>) {
    for id in ids {
        FORWARDS.lock().remove(&id);
        if let Some(window) = app.get_webview_window(&format!("devserver-{id}")) {
            let _ = window.close();
        }
    }
}

#[tauri::command]
pub(crate) async fn link_forward_open(app: tauri::AppHandle, machine: String, port: u16,
    project: String, owner: String, manager: tauri::State<'_, LinkManager>) -> Result<ForwardInfo, String> {
    let runtime = manager.runtime(&app).await?;
    let connection = runtime.live_connection(&machine).ok_or("Machine is unreachable")?;
    open_stream(&connection, port, &project, true).await?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| error.to_string())?;
    let local_port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let id = uuid::Uuid::new_v4().simple().to_string();
    let task_id = id.clone();
    let mut forwards = FORWARDS.lock();
    let task = tokio::spawn(async move {
        let mut children = JoinSet::new();
        loop {
            tokio::select! {
                _ = connection.closed() => break,
                _ = children.join_next(), if !children.is_empty() => {}
                accepted = listener.accept(), if children.len() < MAX_CONNECTIONS => {
                    let Ok((mut local, _)) = accepted else { break };
                    let (connection, project) = (connection.clone(), project.clone());
                    children.spawn(async move {
                        if let Ok((mut send, mut recv)) = open_stream(&connection, port, &project, false).await {
                            let mut remote = tokio::io::join(&mut recv, &mut send);
                            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                        }
                    });
                }
            }
        }
        drop(children);
        close(&app, vec![task_id]);
    });
    forwards.insert(id.clone(), Forward { owner, local_port, task: task.abort_handle() });
    Ok(ForwardInfo { id, local_port })
}

#[tauri::command]
pub(crate) fn link_forward_close(app: tauri::AppHandle, id: Option<String>, owner: Option<String>) {
    let ids = if let Some(id) = id { vec![id] } else {
        let Some(owner) = owner else { return };
        FORWARDS.lock().iter().filter(|(_, forward)| forward.owner == owner)
            .map(|(id, _)| id.clone()).collect()
    };
    close(&app, ids);
}

/// La finestra non ha capability IPC e non puo' navigare fuori dall'origine
/// assegnata a questo inoltro.
#[tauri::command]
pub(crate) async fn link_forward_window(app: tauri::AppHandle, id: String, url: String, title: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    let port = FORWARDS.lock().get(&id).map(|forward| forward.local_port).ok_or("Preview is closed")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str() != Some("127.0.0.1") ||
        parsed.port_or_known_default() != Some(port) || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Only the forwarded origin is available in this window".into());
    }
    let origin = parsed.origin();
    let window = tauri::WebviewWindowBuilder::new(&app, format!("devserver-{id}"), tauri::WebviewUrl::External(parsed))
        .on_navigation(move |target| target.origin() == origin)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .title(title)
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|error| error.to_string())?;
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) { FORWARDS.lock().remove(&id); }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_zero_is_not_a_destination() {
        assert!(allowed_port(5173));
        assert!(allowed_port(3000));
        assert!(allowed_port(80));
        assert!(!allowed_port(0));
    }
}
