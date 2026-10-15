//! Modulo di controllo remoto di Studio (Gate R44).
//!
//! Gestisce configurazione locale, abbinamento con il relay, credenziale segreta,
//! ciclo di vita della connessione WebSocket e inoltro dei comandi alla WebView.

pub mod config;
pub mod connection;
pub mod machines_window;
pub mod protocol;
pub use machines_window::{
    remote_open_machines_window, MACHINES_WINDOW_LABEL, MACHINES_WINDOW_TITLE,
};

#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::remote::config::{
    default_config_path, load_or_create_config, save_config, validate_and_normalize_relay_url,
};
use crate::remote::connection::{start_connection_task, stop_connection_task, ConnectionContext};
use crate::remote::protocol::{
    current_platform, CommandError, PairHostResponse, RemoteConnection, RemoteStatus,
};

/// Struttura conservata nel gestore di stato di Tauri (`app.manage`).
#[derive(Clone)]
pub struct RemoteManager {
    pub ctx: Arc<ConnectionContext>,
    pub config_path: PathBuf,
}

impl RemoteManager {
    pub fn new(app: Option<AppHandle>, config_path: PathBuf) -> Result<Self, String> {
        let cfg = load_or_create_config(&config_path)?;
        let ctx = ConnectionContext::new(app, cfg);
        Ok(Self { ctx, config_path })
    }

    /// Avvia la connessione in background se la funzione e' attiva e abbinata.
    pub fn start_if_enabled(&self) {
        let (enabled, paired) = {
            let cfg = self.ctx.config.lock();
            (
                cfg.enabled,
                cfg.credential.is_some() && cfg.relay_url.is_some(),
            )
        };
        if enabled && paired {
            start_connection_task(self.ctx.clone());
        }
    }

    /// Riavvia la connessione (ferma il task precedente e ne avvia uno nuovo).
    pub fn restart_connection(&self) {
        self.stop_connection();
        start_connection_task(self.ctx.clone());
    }

    /// Interrompe la connessione in corso.
    pub fn stop_connection(&self) {
        stop_connection_task(&self.ctx);
    }

    /// Esegue l'abbinamento della macchina verso il relay.
    pub async fn pair(
        &self,
        relay_url: &str,
        code: &str,
        machine_name: &str,
    ) -> Result<RemoteStatus, String> {
        let epoch = self.ctx.next_epoch();
        let normalized = validate_and_normalize_relay_url(relay_url)?;
        let host_id = self.ctx.config.lock().host_id.clone();
        let name = if machine_name.trim().is_empty() {
            self.ctx.config.lock().machine_name.clone()
        } else {
            machine_name.trim().to_string()
        };

        let pair_endpoint = format!("{}/v1/pair/host", normalized.http_url);
        let request_body = serde_json::json!({
            "code": code.trim(),
            "hostId": host_id,
            "name": name,
            "platform": current_platform(),
            "appVersion": env!("CARGO_PKG_VERSION"),
        });

        let response = self
            .ctx
            .http_client
            .post(&pair_endpoint)
            .json(&request_body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Errore di rete o TLS durante l'abbinamento: {e}"))?;

        let status_code = response.status();
        if status_code == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Codice di abbinamento non valido o scaduto".to_string());
        }
        if status_code == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err("Troppi tentativi di abbinamento, riprova piu' tardi".to_string());
        }
        if !status_code.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(format!(
                "Abbinamento rifiutato dal relay ({status_code}): {text}"
            ));
        }

        let pair_resp: PairHostResponse = response
            .json()
            .await
            .map_err(|e| format!("Risposta non valida dal relay: {e}"))?;

        // Se l'epoca e' cambiata mentre attendevamo la risposta HTTP (es. unpair o disable),
        // scartiamo la risposta senza salvare ne' connettere.
        if self.ctx.current_epoch() != epoch {
            let mut st = self.ctx.status.lock();
            st.last_error = Some(
                "Abbinamento annullato: configurazione modificata durante l'operazione".to_string(),
            );
            let status = st.clone();
            drop(st);
            self.ctx.emit_status_update();
            return Ok(status);
        }

        // Salvataggio della credenziale e attivazione
        {
            let mut cfg = self.ctx.config.lock();
            cfg.relay_url = Some(normalized.http_url.clone());
            cfg.machine_name = name.clone();
            cfg.credential = Some(pair_resp.credential);
            cfg.enabled = true;
            save_config(&self.config_path, &cfg)?;
        }

        {
            let mut st = self.ctx.status.lock();
            st.enabled = true;
            st.paired = true;
            st.relay_url = Some(normalized.http_url);
            st.machine_name = name;
            st.connection = RemoteConnection::Connecting;
            st.last_error = None;
            st.retry_at = None;
        }
        self.ctx.emit_status_update();

        // Avvia la connessione
        self.restart_connection();
        let status = self.ctx.status.lock().clone();
        Ok(status)
    }

    /// Abilita o disabilita il controllo remoto.
    pub fn set_enabled(&self, enabled: bool) -> Result<RemoteStatus, String> {
        self.ctx.next_epoch();

        {
            let mut cfg = self.ctx.config.lock();
            cfg.enabled = enabled;
            save_config(&self.config_path, &cfg)?;
        }

        if !enabled {
            self.stop_connection();
            let mut st = self.ctx.status.lock();
            st.enabled = false;
            st.connection = RemoteConnection::Disabled;
            st.retry_at = None;
            st.clients.clear();
            st.relay_features.clear();
            drop(st);
            self.ctx.emit_status_update();
        } else {
            let paired = {
                let cfg = self.ctx.config.lock();
                cfg.credential.is_some() && cfg.relay_url.is_some()
            };
            {
                let mut st = self.ctx.status.lock();
                st.enabled = true;
                st.connection = if paired {
                    RemoteConnection::Connecting
                } else {
                    RemoteConnection::Unpaired
                };
                st.retry_at = None;
            }
            self.ctx.emit_status_update();
            if paired {
                self.restart_connection();
            }
        }

        let status = self.ctx.status.lock().clone();
        Ok(status)
    }

    /// Rimuove l'abbinamento della macchina.
    pub fn unpair(&self) -> Result<RemoteStatus, String> {
        self.ctx.next_epoch();

        {
            let mut cfg = self.ctx.config.lock();
            cfg.credential = None;
            save_config(&self.config_path, &cfg)?;
        }

        self.stop_connection();

        {
            let mut st = self.ctx.status.lock();
            let enabled = st.enabled;
            st.paired = false;
            st.connection = if enabled {
                RemoteConnection::Unpaired
            } else {
                RemoteConnection::Disabled
            };
            st.clients.clear();
            st.relay_features.clear();
            st.retry_at = None;
            st.last_error = None;
        }
        self.ctx.emit_status_update();

        let status = self.ctx.status.lock().clone();
        Ok(status)
    }
}

/// Inizializza il modulo durante il bootstrap di Tauri (`lib.rs`).
pub fn init(app: AppHandle) {
    let path = match default_config_path(&app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[remote] Inizializzazione percorso fallita: {e}");
            return;
        }
    };

    match RemoteManager::new(Some(app.clone()), path) {
        Ok(manager) => {
            manager.start_if_enabled();
            app.manage(manager);
        }
        Err(e) => {
            eprintln!("[remote] Caricamento configurazione fallito: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// Comandi Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn remote_get_status(app: AppHandle) -> Result<RemoteStatus, String> {
    let manager = app.state::<RemoteManager>();
    let status = manager.ctx.status.lock().clone();
    Ok(status)
}

#[tauri::command]
pub async fn remote_pair(
    app: AppHandle,
    relay_url: String,
    code: String,
    machine_name: String,
) -> Result<RemoteStatus, String> {
    let manager = app.state::<RemoteManager>();
    manager.pair(&relay_url, &code, &machine_name).await
}

#[tauri::command]
pub async fn remote_set_enabled(app: AppHandle, enabled: bool) -> Result<RemoteStatus, String> {
    let manager = app.state::<RemoteManager>();
    manager.set_enabled(enabled)
}

#[tauri::command]
pub async fn remote_set_machine_name(
    app: AppHandle,
    machine_name: String,
) -> Result<RemoteStatus, String> {
    let manager = app.state::<RemoteManager>();
    let trimmed = machine_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Il nome della macchina non puo' essere vuoto".to_string());
    }

    {
        let mut cfg = manager.ctx.config.lock();
        cfg.machine_name = trimmed.clone();
        save_config(&manager.config_path, &cfg)?;
    }

    let is_connected = manager.ctx.status.lock().connection == RemoteConnection::Connected;
    {
        let mut st = manager.ctx.status.lock();
        st.machine_name = trimmed;
    }
    manager.ctx.emit_status_update();

    if is_connected {
        // Riconnetti per inviare il nuovo nome nel frame `hello`
        manager.ctx.reconnect_notify.notify_one();
    }

    let status = manager.ctx.status.lock().clone();
    Ok(status)
}

#[tauri::command]
pub async fn remote_unpair(app: AppHandle) -> Result<RemoteStatus, String> {
    let manager = app.state::<RemoteManager>();
    manager.unpair()
}

#[tauri::command]
pub async fn remote_publish_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let manager = app.state::<RemoteManager>();
    *manager.ctx.latest_state.lock() = Some(state);
    manager.ctx.snapshot_notify.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn remote_command_result(
    app: AppHandle,
    command_id: String,
    ok: bool,
    error: Option<CommandError>,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    let manager = app.state::<RemoteManager>();
    manager
        .ctx
        .queue_command_result(command_id, ok, error, data);
    Ok(())
}

#[tauri::command]
pub async fn remote_publish_chat_event(
    app: AppHandle,
    project_id: String,
    lane_id: String,
    event: serde_json::Value,
) -> Result<(), String> {
    let manager = app.state::<RemoteManager>();
    manager.ctx.queue_chat_event(project_id, lane_id, event);
    Ok(())
}
