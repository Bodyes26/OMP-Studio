//! Identita' e abbinamenti locali; nessun segreto nelle risposte alla WebView.
use std::{collections::BTreeMap, path::{Path, PathBuf}};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{EndpointAddr, EndpointId, RelayUrl, SecretKey};
use serde::{Deserialize, Serialize};
use super::catalog::Permissions;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Address {
    pub id: String,
    pub relay: String,
    pub ips: Vec<std::net::SocketAddr>,
}
impl Address {
    pub(crate) fn from_endpoint(addr: EndpointAddr, relay: &str) -> Self {
        Self { id: addr.id.to_string(), relay: relay.to_owned(), ips: addr.ip_addrs().copied().collect() }
    }
    pub(crate) fn endpoint(&self, expected_relay: &str) -> Result<EndpointAddr, String> {
        if self.relay != expected_relay { return Err("Pairing code uses a different relay".into()); }
        let id: EndpointId = self.id.parse().map_err(|_| "Invalid endpoint identity")?;
        let relay: RelayUrl = self.relay.parse().map_err(|_| "Invalid relay URL")?;
        let mut addr = EndpointAddr::new(id).with_relay_url(relay);
        for ip in &self.ips { addr = addr.with_ip_addr(*ip); }
        Ok(addr)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Peer {
    pub name: String,
    pub address: Address,
    pub permissions: Permissions,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Config {
    pub enabled: bool,
    pub name: String,
    pub relay_url: String,
    pub relay_token: String,
    secret_key: String,
    pub peers: BTreeMap<String, Peer>,
}

impl Config {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let config: Self = serde_json::from_slice(&bytes).map_err(|error| format!("Invalid instance configuration: {error}"))?;
                config.secret()?;
                Ok(config)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let config = Self {
                    enabled: false,
                    name: std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME"))
                        .unwrap_or_else(|_| "Studio".to_string()),
                    relay_url: String::new(), relay_token: String::new(),
                    secret_key: URL_SAFE_NO_PAD.encode(SecretKey::generate().to_bytes()),
                    peers: BTreeMap::new(),
                };
                config.save(path)?;
                Ok(config)
            }
            Err(error) => Err(format!("Reading instance configuration: {error}")),
        }
    }
    pub(crate) fn secret(&self) -> Result<SecretKey, String> {
        let bytes: [u8; 32] = URL_SAFE_NO_PAD.decode(&self.secret_key)
            .map_err(|_| "Invalid instance key")?.try_into().map_err(|_| "Invalid instance key length")?;
        Ok(SecretKey::from_bytes(&bytes))
    }
    pub(crate) fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Invalid instance configuration path")?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        // Anche un vecchio file troppo permissivo va corretto prima dello swap:
        // fs_atomic conserva i permessi del file che sostituisce.
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            match std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => return Err(error.to_string()),
            }
        }
        crate::fs_atomic::atomic_write(path, &serde_json::to_vec_pretty(self).map_err(|error| error.to_string())?)
    }
}

pub(crate) fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("instances.json"))
}

pub(crate) fn validate_relay(input: &str) -> Result<String, String> {
    let url = url::Url::parse(input.trim()).map_err(|_| "Invalid relay URL")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty()
        || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || url.path() != "/" {
        return Err("Use the HTTPS origin of your iroh relay, without credentials, paths or query parameters".into());
    }
    Ok(url.to_string())
}
