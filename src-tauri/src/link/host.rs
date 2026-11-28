//! La coda e le azioni automatiche restano nella finestra che possiede il progetto.
use super::*;
use tauri::ipc::InvokeResponseBody;
use tauri::Listener;

const HOST_EVENTS: [&str; 3] = ["studio://file-changed", "lab://changed", "diagram://new"];

pub(super) struct HostEvent {
    name: &'static str,
    payload: String,
}

fn shared_event(name: &'static str, payload: &str, roots: &super::access::Roots) -> Result<HostEvent, String> {
    if !HOST_EVENTS.contains(&name) { return Err("Unknown host event".into()); }
    if payload.len() > MAX_BODY { return Err("Host event exceeds limit".into()); }
    validate_json(payload)?;
    if name == "studio://file-changed" {
        let value: Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
        if value.get("path").and_then(Value::as_str).is_none() { return Err("Missing changed file path".into()); }
        roots.authorize("host_event", &value)?;
    }
    Ok(HostEvent { name, payload: payload.to_owned() })
}

type ActionResult = Result<Value, Value>;
pub(super) struct PendingAction {
    pub result: tokio::sync::oneshot::Sender<ActionResult>,
}

fn action_permission(kind: &str) -> Result<&'static str, String> {
    match kind {
        "get_task" | "refresh_quota" | "chat_history" | "list_project_folders" | "composer_catalog"
            | "refresh_context" | "list_sessions" | "session_history" | "get_artifact" => Ok("read"),
        // Replica della coda (F19): leggere e scrivere i task del progetto.
        // Scrivere è «Agenti», come creare e modificare un task.
        "read_queue" => Ok("read"),
        "write_queue" => Ok("agents"),
        "open_project" | "create_project" => Ok("files"),
        // Corsie di un progetto (R-MI-06): creano e rimuovono worktree sul
        // disco di questa macchina, come gli altri comandi «File e Git».
        "lane_action" => Ok("files"),

        "respond_ui" | "run_task" | "wait_quota_reset" | "dismiss_quota_blocked" | "create_task"
            | "update_task" | "delete_task" | "move_task" | "respond_dispatch" | "abort" | "send_prompt"
            | "set_lane_role" | "set_lane_model" | "set_lane_thinking" | "stage_attachment"
            // Cambia chi avvia i task del progetto (F20): stessa famiglia degli
            // altri comandi che governano l'esecuzione, non una lettura.
            | "set_auto_dispatch"
            // Chiudere il progetto ferma le sue chat (R-MI-20): governa
            // l'esecuzione degli agenti, come Stop.
            | "close_project"
            | "compact_context" | "mark_session_seen" => Ok("agents"),
        _ => Err("Unknown host action".into()),
    }
}

impl Runtime {
    pub(super) fn listen_host_events(self: &Arc<Self>) {
        for name in HOST_EVENTS {
            let runtime = Arc::downgrade(self);
            self.app.listen_any(name, move |event| {
                let Some(runtime) = runtime.upgrade() else { return; };
                if runtime.events.receiver_count() == 0 { return; }
                let roots = runtime.roots.read();
                let accepted = shared_event(name, event.payload(), &roots);
                drop(roots);
                if let Ok(shared) = accepted {
                    let _ = runtime.events.send(Arc::new(shared));
                }
            });
        }
    }

    pub(super) fn authorize_action(&self, peer: &str, command: &Value) -> Result<(), String> {
        let kind = command.get("kind").and_then(Value::as_str).ok_or("Missing host action kind")?;
        let scope = action_permission(kind)?;
        let config = self.config.lock();
        if !config.enabled { return Err("Instance link is disabled".into()); }
        let peer = config.peers.get(peer).ok_or("Device pairing was revoked")?;
        let allowed = match scope { "read" => true, "agents" => peer.permissions.agents, "files" => peer.permissions.files, _ => false };
        if allowed { Ok(()) } else { Err(format!("Permission denied: {scope}")) }
    }

    async fn host_action(&self, peer: Option<String>, command: Value) -> ActionResult {
        let kind = command.get("kind").and_then(Value::as_str).ok_or_else(|| json!("Missing host action kind"))?;
        let permission = action_permission(kind).map_err(Value::String)?;
        let name = if let Some(id) = &peer {
            self.authorize_action(id, &command).map_err(Value::String)?;
            self.config.lock().peers.get(id).ok_or_else(|| json!("Device pairing was revoked"))?.name.clone()
        } else { self.config.lock().name.clone() };
        // Stessa regola di `serve_request`: una riga INFO per le azioni, un
        // conteggio per le letture (S2-07).
        self.log_command(&name, kind, permission);
        if let Some(id) = &peer { self.audit(id, permission, kind, &command); }
        let command_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.actions.lock().insert(command_id.clone(), PendingAction { result: tx });
        let event = json!({ "commandId": command_id, "device": { "id": peer.as_deref().unwrap_or(&self.id), "name": name }, "command": command });
        if let Err(error) = self.app.emit_to("main", "link:command", &event) {
            self.actions.lock().remove(&command_id);
            return Err(json!(error.to_string()));
        }
        let result = tokio::time::timeout(REQUEST_TIMEOUT, rx).await;
        self.actions.lock().remove(&command_id);
        result.map_err(|_| json!("Host action timed out; its outcome may be unknown"))?
            .map_err(|_| json!("Host action response was interrupted"))?
    }
}

#[tauri::command]
pub(crate) async fn link_host_action(app: tauri::AppHandle, command: Value, request: Request<'_>, manager: tauri::State<'_, LinkManager>) -> Result<Value, Value> {
    let peer = request.headers().get("x-studio-authenticated-peer").map(|value| value.to_str().map(str::to_owned))
        .transpose().map_err(|error| json!(error.to_string()))?;
    manager.runtime(&app).await.map_err(Value::String)?.host_action(peer, command).await
}

#[tauri::command]
pub(crate) async fn link_command_result(app: tauri::AppHandle, webview: tauri::Webview, command_id: String, ok: bool, error: Option<Value>, data: Option<Value>, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    if webview.label() != "main" { return Err("Only the host window may answer host actions".into()); }
    let runtime = manager.runtime(&app).await?;
    let pending = runtime.actions.lock().remove(&command_id).ok_or("Host action is no longer pending")?;
    let result = if ok { Ok(data.unwrap_or(Value::Null)) } else { Err(error.unwrap_or(json!("Host action failed"))) };
    let _ = pending.result.send(result);
    Ok(())
}

#[tauri::command]
pub(crate) async fn link_publish_state(app: tauri::AppHandle, webview: tauri::Webview, state: String, manager: tauri::State<'_, LinkManager>) -> Result<(), String> {
    if webview.label() != "main" { return Err("Only the host window may publish its state".into()); }
    if state.len() > MAX_BODY { return Err("Host snapshot exceeds limit".into()); }
    let runtime = manager.runtime(&app).await?;
    // Le radici sono un aiuto al confinamento, non una condizione per
    // pubblicare: un errore qui non deve impedire allo snapshot di arrivare
    // alle altre macchine (S3-06). Le radici scartate sono gia' nel log.
    if let Err(error) = runtime.roots.write().update(&state) {
        crate::studio_log::info("link", format!("Radici dello snapshot non aggiornate: {error}"));
    }
    runtime.snapshot.send_replace(Some(Arc::new(state)));
    Ok(())
}

#[tauri::command]
pub(crate) async fn link_host_snapshot(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<Response, String> {
    let runtime = manager.runtime(&app).await?;
    let state = runtime.snapshot.borrow().clone().ok_or("Host window is still initializing")?;
    Ok(Response::new(InvokeResponseBody::Json(state.as_ref().clone())))
}

pub(super) fn validate_json(text: &str) -> Result<(), String> {
    let mut deserializer = serde_json::Deserializer::from_str(text);
    serde::de::IgnoredAny::deserialize(&mut deserializer).map_err(|error| error.to_string())?;
    deserializer.end().map_err(|error| error.to_string())
}

/// Forma ridotta dello snapshot per una macchina con versione incompatibile
/// (R-MI-10): separata dal `Runtime` per essere provata senza Tauri. Esclude
/// lo stato operativo (corsie, task, sessioni) ma conserva l'identita' della
/// macchina e l'elenco dei progetti, cosi' la finestra puo' materializzare la
/// tessera e mostrare «aggiorna Studio».
fn reduced_snapshot(machine_id: &str, machine_name: &str, snapshot: &str) -> Result<String, String> {
    let full: Value = serde_json::from_str(snapshot).map_err(|error| error.to_string())?;
    let projects = full.get("projects").and_then(Value::as_array).map(|projects| {
        projects.iter().map(|project| {
            let id = project.get("id").cloned().unwrap_or(Value::Null);
            let name = project.get("name").cloned().unwrap_or(Value::Null);
            let canonical = project.get("canonicalProjectPath").cloned().unwrap_or(Value::Null);
            let repo = project.get("repo").cloned().unwrap_or(Value::Null);
            let lane = project.get("lane").cloned().unwrap_or(Value::Null);
            json!({
                "id": id,
                "name": name,
                "canonicalProjectPath": canonical,
                "repo": repo,
                "branch": lane.get("branch").cloned().unwrap_or(Value::Null),
            })
        }).collect::<Vec<Value>>()
    }).unwrap_or_default();
    Ok(json!({
        "version": 1,
        "reduced": true,
        // Lo stesso valore dello snapshot pieno: la finestra lo usa per sapere
        // con che separatori leggere i percorsi della macchina.
        "platform": full.get("platform").cloned().unwrap_or(Value::Null),
        "machineId": machine_id,
        "machineName": machine_name,
        "studioVersion": VERSION,
        "projectRoot": full.get("projectRoot").cloned().unwrap_or(Value::Null),
        "projects": projects,
    }).to_string())
}

impl Runtime {
    pub(super) async fn serve_host_state(&self, connection: &Connection, send: &mut iroh::endpoint::SendStream, generation: u64) -> Result<(), String> {
        let peer = connection.remote_id().to_string();
        // R-MI-10: con versione incompatibile lo snapshot pieno non passa, ma
        // la finestra deve comunque materializzare la tessera e mostrare
        // «aggiorna Studio». Qui si decide una volta per tutte la forma da
        // servire: ridotta se il peer non e' compatibile, piena altrimenti.
        let mut state = self.snapshot.subscribe();
        let mut events = self.events.subscribe();
        let mut send_state = true;
        loop {
            // Controllo di vita e di abbinamento (senza versione: lo snapshot
            // ridotto deve arrivare anche a una macchina da aggiornare, R-MI-10).
            if generation != self.generation.load(Ordering::SeqCst) { return Err("Obsolete connection".into()); }
            self.authorize_scope(&peer, "link_host_snapshot")?;
            // Un collegamento che diventa compatibile a meta' (aggiornamento
            // completato) passa allo snapshot pieno al giro successivo.
            let now_reduced = !self.connections.lock().get(&peer).is_some_and(|entry| versions_compatible(&entry.version, VERSION));
            if send_state {
                let current = state.borrow_and_update().clone();
                if let Some(current) = current {
                    let payload: Arc<String> = if now_reduced {
                        Arc::new(self.reduced_snapshot(&current)?)
                    } else {
                        current
                    };
                    send_json(send, &Reply::Json { len: payload.len() }).await?;
                    send.write_all(payload.as_bytes()).await.map_err(|error| error.to_string())?;
                }
            }
            send_state = false;
            tokio::select! {
                _ = connection.closed() => break,
                _ = send.stopped() => break,
                result = state.changed() => {
                    if result.is_err() { break; }
                    send_state = true;
                },
                event = events.recv() => {
                    // Con versione incompatibile lo snapshot e' ridotto e non
                    // porta stato operativo: gli eventi dal vivo non si
                    // servono ne' si autorizzano (il controllo di versione li
                    // rifiuterebbe comunque).
                    if now_reduced {
                        continue;
                    }
                    self.authorize(&peer, "link_host_snapshot", generation)?;
                    match event {
                        Ok(event) => {
                            send_json(send, &Reply::Event {
                                event: std::borrow::Cow::Borrowed(event.name), len: event.payload.len()
                            }).await?;
                            send.write_all(event.payload.as_bytes()).await.map_err(|error| error.to_string())?;
                        },
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            send_json(send, &Reply::Resync).await?;
                            send_state = true;
                        },
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                },
            }
        }
        Ok(())
    }

    /// Snapshot ridotto per una macchina con versione incompatibile (R-MI-10):
    /// solo identita', versione, piattaforma e l'elenco dei progetti con nome,
    /// percorso e repository, senza stato operativo. Il frontend lo riconosce
    /// da `"reduced": true` e mostra «aggiorna Studio» invece di provare ad
    /// aprire il progetto. Nessuna operazione di progetto resta consentita:
    /// il controllo di versione in `authorize` le rifiuta comunque.
    fn reduced_snapshot(&self, snapshot: &str) -> Result<String, String> {
        let name = self.config.lock().name.clone();
        reduced_snapshot(&self.id, &name, snapshot)
    }

    pub(super) async fn watch_peer_state(&self, connection: Connection) -> Result<(), String> {
        loop {
            if connection.close_reason().is_some() { return Ok(()); }
            if let Err(error) = self.watch_peer_state_once(&connection).await {
                crate::studio_log::info("link", format!("Ripresa stato {}: {error}", connection.remote_id()));
            }
            tokio::select! {
                _ = connection.closed() => return Ok(()),
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    }

    async fn watch_peer_state_once(&self, connection: &Connection) -> Result<(), String> {
        let peer = connection.remote_id().to_string();
        let (mut send, mut recv) = connection.open_bi().await.map_err(|error| error.to_string())?;
        send_json(&mut send, &Operation::WatchState).await?;
        send.finish().map_err(|error| error.to_string())?;
        let prefix = format!("{{\"machine\":{},\"state\":", serde_json::to_string(&peer).map_err(|error| error.to_string())?);
        let mut first_state = true;
        loop {
            let reply: Reply = read_json(&mut recv).await?;
            let len = match reply {
                Reply::Event { event, len } => {
                    if !HOST_EVENTS.contains(&event.as_ref()) { return Err("Unknown host event".into()); }
                    let bytes = read_body(&mut recv, len).await?;
                    let payload = String::from_utf8(bytes).map_err(|error| error.to_string())?;
                    validate_json(&payload)?;
                    self.app.emit_str_to("main", &format!("link:event:{peer}:{event}"), payload)
                        .map_err(|error| error.to_string())?;
                    continue;
                },
                Reply::Resync => {
                    self.app.emit_to("main", &format!("link:resync:{peer}"), ())
                        .map_err(|error| error.to_string())?;
                    continue;
                },
                Reply::Json { len } => len,
                _ => return Err("Host state subscription was refused".into()),
            };
            let bytes = read_body(&mut recv, len).await?;
            let state = Arc::new(String::from_utf8(bytes).map_err(|error| error.to_string())?);
            // emit_str_to inserisce JSON nel trasporto WebView: dati del peer
            // non validati diventerebbero codice anziche' una semplice notifica.
            validate_json(&state)?;
            self.peer_states.lock().insert(peer.clone(), state.clone());
            let mut payload = String::with_capacity(prefix.len() + state.len() + 1);
            payload.push_str(&prefix);
            payload.push_str(&state);
            payload.push('}');
            self.app.emit_str_to("main", "link:host_state", payload).map_err(|error| error.to_string())?;
            if first_state {
                first_state = false;
                self.app.emit_to("main", &format!("link:resync:{peer}"), ())
                    .map_err(|error| error.to_string())?;
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn link_host_states(app: tauri::AppHandle, manager: tauri::State<'_, LinkManager>) -> Result<Response, String> {
    let runtime = manager.runtime(&app).await?;
    let states = runtime.peer_states.lock();
    let mut bytes = Vec::with_capacity(states.values().map(|state| state.len() + 80).sum::<usize>() + 2);
    bytes.push(b'{');
    for (index, (peer, state)) in states.iter().enumerate() {
        if index > 0 { bytes.push(b','); }
        serde_json::to_writer(&mut bytes, peer).map_err(|error| error.to_string())?;
        bytes.push(b':');
        bytes.extend_from_slice(state.as_bytes());
    }
    bytes.push(b'}');
    Ok(Response::new(InvokeResponseBody::Json(String::from_utf8(bytes).map_err(|error| error.to_string())?)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn peer_state_cannot_escape_the_json_event_payload() {
        assert!(validate_json(r#"{"name":"a 'quoted' project","path":"C:\\work"}"#).is_ok());
        for text in [r#"{}); window.__TAURI_INTERNALS__.invoke("pty_open", {}); ("#,
            "{} {}", "{\"value\":undefined}", "{\"value\":NaN}", "/*not JSON*/{}"] {
            assert!(validate_json(text).is_err(), "{text}");
        }
    }
    #[test]
    fn unknown_actions_are_not_implicitly_granted() {
        assert!(action_permission("plugin:shell|execute").is_err());
        assert_eq!(action_permission("get_task").unwrap(), "read");
        assert_eq!(action_permission("run_task").unwrap(), "agents");
        assert_eq!(action_permission("create_project").unwrap(), "files");
    }

    #[test]
    fn shared_file_events_do_not_reveal_paths_outside_projects() {
        let temp = std::env::temp_dir().join(format!("studio-events-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp).unwrap();
        let mut roots = super::super::access::Roots::default();
        roots.update(&json!({ "projectRoot": temp, "projects": [], "lanes": [] }).to_string()).unwrap();
        let changed = json!({ "path": temp.join("changed.txt") }).to_string();
        assert_eq!(shared_event("studio://file-changed", &changed, &roots).unwrap().payload, changed);
        let private = json!({ "path": temp.parent().unwrap().join("private.txt") }).to_string();
        assert!(shared_event("studio://file-changed", &private, &roots).is_err());
        assert!(shared_event("studio://file-changed", "{}", &roots).is_err());
        assert!(shared_event("auth:secret", &changed, &roots).is_err());
        assert!(shared_event("lab://changed", "{}); alert(1)", &roots).is_err());
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn a_reduced_snapshot_carries_identity_and_projects_without_operational_state() {
        let full = json!({
            "version": 1,
            "platform": "macos",
            "projectRoot": "/Users/maurizio/dev",
            "projects": [
                { "id": "p1", "name": "OMP Studio", "canonicalProjectPath": "/Users/maurizio/dev/omp", "repo": "owner/omp", "lane": { "branch": "main" }, "autoDispatch": true },
                { "id": "p2", "name": "Sito", "canonicalProjectPath": null, "repo": null, "lane": {} }
            ],
            "lanes": [{ "projectId": "p1" }],
            "tasks": [{ "id": "t1" }],
            "sessions": [{ "projectId": "p1" }],
            "state": { "activeProjectId": "p1" }
        }).to_string();
        let reduced = reduced_snapshot("mac-id", "MacBook", &full).unwrap();
        let value: Value = serde_json::from_str(&reduced).unwrap();
        assert_eq!(value.get("reduced"), Some(&json!(true)));
        assert_eq!(value.get("machineId"), Some(&json!("mac-id")));
        assert_eq!(value.get("machineName"), Some(&json!("MacBook")));
        assert_eq!(value.get("studioVersion"), Some(&json!(VERSION)));
        assert_eq!(value.get("platform"), Some(&json!("macos")));
        assert_eq!(value.get("projectRoot"), Some(&json!("/Users/maurizio/dev")));
        let projects = value.get("projects").and_then(Value::as_array).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].get("id"), Some(&json!("p1")));
        assert_eq!(projects[0].get("name"), Some(&json!("OMP Studio")));
        assert_eq!(projects[0].get("canonicalProjectPath"), Some(&json!("/Users/maurizio/dev/omp")));
        assert_eq!(projects[0].get("repo"), Some(&json!("owner/omp")));
        assert_eq!(projects[0].get("branch"), Some(&json!("main")));
        // Nessuno stato operativo nel ridotto: niente lanes/tasks/sessions/state.
        assert!(value.get("lanes").is_none());
        assert!(value.get("tasks").is_none());
        assert!(value.get("sessions").is_none());
        assert!(value.get("state").is_none());
    }
}
