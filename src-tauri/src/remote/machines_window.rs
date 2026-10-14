//! Finestra secondaria «Altre macchine» (Gate R44, passo R10).
//!
//! Apre la PWA del relay configurato in una finestra Tauri completamente confinata:
//! - Nessuna capability Tauri: nessuna IPC, nessun comando nativo esposto;
//! - Navigazione vincolata all'origine del relay: link esterni aperti nel browser predefinito;
//! - Sessione isolata: la finestra non condivide cookie ne' credenziali con Studio;
//! - Geometria salvata e ripristinata tramite il plugin `tauri-plugin-window-state`.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::remote::config::validate_and_normalize_relay_url;
use crate::remote::RemoteManager;

/// Etichetta univoca della finestra «Altre macchine».
pub const MACHINES_WINDOW_LABEL: &str = "remote-machines";

/// Titolo visualizzato nella barra del titolo della finestra.
pub const MACHINES_WINDOW_TITLE: &str = "Altre macchine";

/// Decisione di navigazione per le richieste originate all'interno della Webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    /// Navigazione consentita all'interno della stessa Webview (stessa origine del relay).
    Allow,
    /// Link HTTP/HTTPS verso domini esterni: aperta nel browser predefinito del sistema.
    OpenExternal,
    /// Schemi non autorizzati (javascript:, file:, about:, ecc.): bloccati.
    Block,
}

/// Valida l'URL del target e stabilisce se la navigazione deve essere consentita,
/// deviata al browser di sistema o bloccata.
pub fn decide_navigation(target: &url::Url, allowed_origin: &url::Origin) -> NavigationDecision {
    if &target.origin() == allowed_origin {
        NavigationDecision::Allow
    } else if target.scheme() == "http" || target.scheme() == "https" {
        NavigationDecision::OpenExternal
    } else {
        NavigationDecision::Block
    }
}

/// Costruisce l'URL della PWA remota garantendo lo slash finale sull'origine del relay.
pub fn build_machines_url(relay_url: &str) -> Result<url::Url, String> {
    let normalized = validate_and_normalize_relay_url(relay_url)?;
    let url_str = format!("{}/", normalized.http_url.trim_end_matches('/'));
    url::Url::parse(&url_str).map_err(|e| format!("URL relay non valido per la finestra: {e}"))
}

/// Apre o mette a fuoco la finestra «Altre macchine».
#[tauri::command]
pub async fn remote_open_machines_window(app: AppHandle) -> Result<(), String> {
    // 1. Se la finestra esiste gia', portala in primo piano e dalle il fuoco.
    if let Some(window) = app.get_webview_window(MACHINES_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        window
            .set_focus()
            .map_err(|e| format!("Focus finestra altre macchine fallito: {e}"))?;
        return Ok(());
    }

    // 2. Verifica che il controllo remoto sia configurato e abbinato.
    let manager = app
        .try_state::<RemoteManager>()
        .ok_or_else(|| "Modulo di controllo remoto non inizializzato".to_string())?;

    let (enabled, paired, relay_url) = {
        let cfg = manager.ctx.config.lock();
        (
            cfg.enabled,
            cfg.credential.is_some() && cfg.relay_url.is_some(),
            cfg.relay_url.clone(),
        )
    };

    if !enabled || !paired {
        return Err("Controllo remoto non configurato o non abbinato".to_string());
    }

    let relay_url = relay_url.ok_or_else(|| "URL del relay non configurato".to_string())?;
    let machines_url = build_machines_url(&relay_url)?;
    let allowed_origin = machines_url.origin();

    // 3. Creazione finestra priva di capability Tauri.
    let window = WebviewWindowBuilder::new(
        &app,
        MACHINES_WINDOW_LABEL,
        WebviewUrl::External(machines_url),
    )
    .title(MACHINES_WINDOW_TITLE)
    .inner_size(1024.0, 720.0)
    .min_inner_size(480.0, 400.0)
    .resizable(true)
    .decorations(true)
    .on_navigation(
        move |nav_url| match decide_navigation(nav_url, &allowed_origin) {
            NavigationDecision::Allow => true,
            NavigationDecision::OpenExternal => {
                let _ = tauri_plugin_opener::open_url(nav_url.as_str(), None::<&str>);
                false
            }
            NavigationDecision::Block => false,
        },
    )
    .build()
    .map_err(|e| format!("Creazione finestra altre macchine fallita: {e}"))?;

    // 4. Ripristino geometria salvata, se disponibile.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_window_state::{StateFlags, WindowExt};
        let _ = window.restore_state(StateFlags::all() & !StateFlags::DECORATIONS);
    }

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_machines_url_valid_https() {
        let url = build_machines_url("https://relay.example.com").expect("url valido");
        assert_eq!(url.as_str(), "https://relay.example.com/");
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://relay.example.com"
        );

        let url_trailing =
            build_machines_url("https://relay.example.com/").expect("url valido con slash");
        assert_eq!(url_trailing.as_str(), "https://relay.example.com/");
    }

    #[test]
    fn test_build_machines_url_localhost() {
        let url = build_machines_url("http://127.0.0.1:18795").expect("url loopback valido");
        assert_eq!(url.as_str(), "http://127.0.0.1:18795/");
        assert_eq!(url.origin().ascii_serialization(), "http://127.0.0.1:18795");

        let url_localhost =
            build_machines_url("http://localhost:18795/").expect("url localhost valido");
        assert_eq!(url_localhost.as_str(), "http://localhost:18795/");
    }

    #[test]
    fn test_build_machines_url_rejects_insecure_remote() {
        let err = build_machines_url("http://insecure-relay.example.com").unwrap_err();
        assert!(
            err.contains("HTTPS"),
            "L'errore deve richiedere HTTPS: {err}"
        );
    }

    #[test]
    fn test_build_machines_url_rejects_path_query_fragment() {
        assert!(build_machines_url("https://relay.example.com/nested/path").is_err());
        assert!(build_machines_url("https://relay.example.com?token=123").is_err());
        assert!(build_machines_url("https://relay.example.com#section").is_err());
        assert!(build_machines_url("").is_err());
    }

    #[test]
    fn test_decide_navigation_same_origin() {
        let base = url::Url::parse("https://relay.example.com/").unwrap();
        let allowed_origin = base.origin();

        let sub_path = url::Url::parse("https://relay.example.com/login").unwrap();
        assert_eq!(
            decide_navigation(&sub_path, &allowed_origin),
            NavigationDecision::Allow
        );

        let sub_assets = url::Url::parse("https://relay.example.com/assets/index-D82A.js").unwrap();
        assert_eq!(
            decide_navigation(&sub_assets, &allowed_origin),
            NavigationDecision::Allow
        );

        let query_url = url::Url::parse("https://relay.example.com/?tab=hosts").unwrap();
        assert_eq!(
            decide_navigation(&query_url, &allowed_origin),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn test_decide_navigation_external_links() {
        let base = url::Url::parse("https://relay.example.com/").unwrap();
        let allowed_origin = base.origin();

        let external_https = url::Url::parse("https://github.com/login").unwrap();
        assert_eq!(
            decide_navigation(&external_https, &allowed_origin),
            NavigationDecision::OpenExternal
        );

        let external_http = url::Url::parse("http://example.org/doc").unwrap();
        assert_eq!(
            decide_navigation(&external_http, &allowed_origin),
            NavigationDecision::OpenExternal
        );

        // Origine diversa anche se e' lo stesso host con porta diversa
        let different_port = url::Url::parse("https://relay.example.com:8443/").unwrap();
        assert_eq!(
            decide_navigation(&different_port, &allowed_origin),
            NavigationDecision::OpenExternal
        );
    }

    #[test]
    fn test_decide_navigation_blocks_unauthorized_schemes() {
        let base = url::Url::parse("https://relay.example.com/").unwrap();
        let allowed_origin = base.origin();

        let file_url = url::Url::parse("file:///etc/passwd").unwrap();
        assert_eq!(
            decide_navigation(&file_url, &allowed_origin),
            NavigationDecision::Block
        );

        let js_url = url::Url::parse("javascript:alert(1)").unwrap();
        assert_eq!(
            decide_navigation(&js_url, &allowed_origin),
            NavigationDecision::Block
        );

        let data_url = url::Url::parse("data:text/html,<b>hello</b>").unwrap();
        assert_eq!(
            decide_navigation(&data_url, &allowed_origin),
            NavigationDecision::Block
        );
    }
}
