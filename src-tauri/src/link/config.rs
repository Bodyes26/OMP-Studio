//! Identita' e abbinamenti locali; nessun segreto nelle risposte alla WebView.
use std::{collections::BTreeMap, path::{Path, PathBuf}};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{EndpointAddr, EndpointId, RelayUrl, SecretKey};
use serde::{Deserialize, Serialize};
use super::catalog::Permissions;

/// Nome del servizio di sistema che isola la chiave dell'istanza nel
/// portachiavi (R-MI-34), distinto da quello delle automazioni.
const KEYRING_SERVICE: &str = "omp-studio-instance";
const KEYRING_ACCOUNT: &str = "instance-secret-key";

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
        // R-MI-54: l'abbinamento in rete locale non ha ancora nessun relay su
        // una delle due macchine. Con un relay configurato qui resta il
        // controllo di identita' dell'indirizzo; senza, valgono solo gli
        // indirizzi diretti (e il relay del peer, se ne dichiara uno).
        if !expected_relay.is_empty() && self.relay != expected_relay {
            return Err("Pairing code uses a different relay".into());
        }
        let id: EndpointId = self.id.parse().map_err(|_| "Invalid endpoint identity")?;
        let mut addr = EndpointAddr::new(id);
        if !self.relay.is_empty() {
            let relay: RelayUrl = self.relay.parse().map_err(|_| "Invalid relay URL")?;
            addr = addr.with_relay_url(relay);
        }
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
    /// Ultimo contatto riuscito, in millisecondi epoch (R-MI-29). `None`
    /// finche' non arriva il primo hello: un abbinamento mai completato da
    /// un lato non deve risultare «visto adesso».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Config {
    pub enabled: bool,
    pub name: String,
    pub relay_url: String,
    pub relay_token: String,
    /// Presente solo nei file precedenti o nel ripiego Linux senza Secret
    /// Service. Si cancella solo dopo la verifica della copia nel portachiavi.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    secret_key: String,
    #[serde(skip)]
    resolved_key: Option<SecretKey>,
    pub peers: BTreeMap<String, Peer>,
}

/// Accesso al portachiavi di sistema dietro un trait, cosi' i test possono
/// usare un backend finto senza toccare il portachiavi vero.
pub(crate) trait KeyringStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn put(&self, value: &str) -> Result<(), String>;
}

/// Backend reale basato sul crate `keyring` (Keychain macOS, Credential
/// Manager Windows, secret-service Linux).
pub(crate) struct SystemKeyring;

impl KeyringStore for SystemKeyring {
    fn get(&self) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|error| keyring_error(&error))?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(&error)),
        }
    }
    fn put(&self, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|error| keyring_error(&error))?;
        entry.set_password(value).map_err(|error| keyring_error(&error))
    }
}

/// Messaggio chiaro per un portachiavi che non risponde: senza distinguere
/// i dettagli, chi legge capisce che non e' stato generato un nuovo segreto.
fn keyring_error(error: &keyring::Error) -> String {
    crate::tr!(
        format!("Portachiavi di sistema non disponibile per la chiave della macchina: {error}. Nessuna identita' nuova e' stata creata; sblocca il portachiavi e riprova."),
        format!("System keychain unavailable for the machine key: {error}. No new identity was created; unlock the keychain and retry.")
    )
}


fn decode_secret(encoded: &str) -> Result<SecretKey, String> {
    let bytes: [u8; 32] = URL_SAFE_NO_PAD.decode(encoded)
        .map_err(|_| crate::tr!("Chiave della macchina non valida", "Invalid machine key"))?
        .try_into().map_err(|_| crate::tr!("Lunghezza della chiave non valida", "Invalid machine key length"))?;
    Ok(SecretKey::from_bytes(&bytes))
}


impl Config {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        Self::load_with(path, &SystemKeyring, cfg!(target_os = "linux"))
    }

    fn load_with(path: &Path, keyring: &dyn KeyringStore, allow_file: bool) -> Result<Self, String> {
        let (mut config, fresh) = match std::fs::read(path) {
            Ok(bytes) => (serde_json::from_slice::<Self>(&bytes).map_err(|error| crate::tr!(
                format!("Configurazione delle istanze non valida: {error}"),
                format!("Invalid instance configuration: {error}")
            ))?, false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Self {
                enabled: false,
                name: std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_else(|_| "Studio".to_owned()),
                relay_url: String::new(), relay_token: String::new(),
                secret_key: String::new(), resolved_key: None, peers: BTreeMap::new(),
            }, true),
            Err(error) => return Err(crate::tr!(
                format!("Lettura della configurazione delle istanze: {error}"),
                format!("Reading instance configuration: {error}")
            )),
        };
        if !config.secret_key.is_empty() {
            config.resolved_key = Some(decode_secret(&config.secret_key)?);
            match keyring.put(&config.secret_key).and_then(|()| keyring.get()) {
                Ok(Some(stored)) if stored == config.secret_key => {
                    config.secret_key.clear();
                    config.save(path)?;
                }
                Err(error) if allow_file => {
                    // Secret Service non e' garantito su Linux: conservare
                    // il vecchio segreto e' meglio che cambiare identita'.
                    crate::studio_log::info("link", format!("Ripiego Linux sul file instances.json (0600): {error}"));
                }
                Err(error) => return Err(error),
                _ => return Err(crate::tr!(
                    "Il portachiavi non ha confermato la chiave; il file originale e' conservato",
                    "The keychain did not confirm the key; the original file is preserved"
                ).into()),
            }
        } else {
            let stored = match keyring.get() {
                Ok(stored) => stored,
                Err(error) if fresh && allow_file => {
                    crate::studio_log::info("link", format!("Ripiego Linux sul file instances.json (0600): {error}"));
                    None
                }
                Err(error) => return Err(error),
            };
            if let Some(encoded) = stored {
                config.resolved_key = Some(decode_secret(&encoded)?);
            } else if fresh {
                let key = SecretKey::generate();
                let encoded = URL_SAFE_NO_PAD.encode(key.to_bytes());
                match keyring.put(&encoded).and_then(|()| keyring.get()) {
                    Ok(Some(stored)) if stored == encoded => {}
                    Err(error) if allow_file => {
                        crate::studio_log::info("link", format!("Ripiego Linux sul file instances.json (0600): {error}"));
                        config.secret_key = encoded;
                    }
                    Err(error) => return Err(error),
                    _ => return Err(crate::tr!("Salvataggio della chiave non confermato", "Machine key storage was not confirmed").into()),
                }
                config.resolved_key = Some(key);
            } else {
                return Err(crate::tr!(
                    "Chiave della macchina assente dal portachiavi. Ripristinala: Studio non crea una nuova identita' per non perdere gli abbinamenti.",
                    "Machine key missing from the keychain. Restore it: Studio will not create a new identity and lose existing pairings."
                ).into());
            }
            if fresh { config.save(path)?; }
        }
        Ok(config)
    }

    pub(crate) fn secret(&self) -> Result<SecretKey, String> {
        self.resolved_key.clone().ok_or_else(|| crate::tr!(
            "Chiave della macchina non disponibile", "Machine key unavailable"
        ).to_owned())
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

/// R-MI-43: il file esiste (la macchina aveva gia' un'identita'), non tiene
/// la chiave in chiaro e il portachiavi risponde senza la chiave. Diverso da
/// un portachiavi bloccato (errore), dove la chiave puo' tornare riprovando.
pub(crate) fn key_missing(path: &Path) -> bool {
    key_missing_with(path, &SystemKeyring)
}

fn key_missing_with(path: &Path, keyring: &dyn KeyringStore) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let Ok(config) = serde_json::from_slice::<Config>(&bytes) else { return false };
    config.secret_key.is_empty() && matches!(keyring.get(), Ok(None))
}

/// Nuova identita' dopo la perdita della chiave (R-MI-43), solo su scelta
/// esplicita dell'utente: nome e relay restano, gli abbinamenti no, perche'
/// le altre macchine conoscono l'identita' vecchia e vanno riabbinate.
pub(crate) fn reset_identity(path: &Path) -> Result<(), String> {
    reset_identity_with(path, &SystemKeyring, cfg!(target_os = "linux"))
}

fn reset_identity_with(path: &Path, keyring: &dyn KeyringStore, allow_file: bool) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let mut config: Config = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if !config.secret_key.is_empty() || keyring.get()?.is_some() {
        return Err("The machine key is already available; retry the link instead".into());
    }
    let key = SecretKey::generate();
    let encoded = URL_SAFE_NO_PAD.encode(key.to_bytes());
    match keyring.put(&encoded).and_then(|()| keyring.get()) {
        Ok(Some(stored)) if stored == encoded => config.secret_key.clear(),
        Err(error) if allow_file => {
            crate::studio_log::info("link", format!("Ripiego Linux sul file instances.json (0600): {error}"));
            config.secret_key = encoded;
        }
        Err(error) => return Err(error),
        _ => return Err(crate::tr!("Salvataggio della chiave non confermato", "Machine key storage was not confirmed").into()),
    }
    config.peers.clear();
    config.save(path)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use serde_json::json;

    #[derive(Default)]
    struct Vault {
        value: RefCell<Option<String>>,
        fail: bool,
        writes: RefCell<usize>,
    }
    impl KeyringStore for Vault {
        fn get(&self) -> Result<Option<String>, String> {
            if self.fail { return Err("locked".into()); }
            Ok(self.value.borrow().clone())
        }
        fn put(&self, value: &str) -> Result<(), String> {
            *self.writes.borrow_mut() += 1;
            if self.fail { return Err("locked".into()); }
            *self.value.borrow_mut() = Some(value.into());
            Ok(())
        }
    }
    fn fixture(secret: Option<&str>) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("studio-link-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("instances.json");
        let mut value = json!({
            "enabled": false, "name": "MacBook", "relayUrl": "", "relayToken": "",
            "peers": { "pc": {
                "name": "PC", "address": { "id": "pc", "relay": "", "ips": [] },
                "permissions": { "agents": true, "files": true, "terminal": true }
            }}
        });
        if let Some(secret) = secret { value["secretKey"] = json!(secret); }
        std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        (dir, path)
    }

    #[test]
    fn legacy_config_migrates_and_persists_last_seen_without_changing_identity() {
        let encoded = URL_SAFE_NO_PAD.encode([17; 32]);
        let (dir, path) = fixture(Some(&encoded));
        let vault = Vault::default();
        let mut config = Config::load_with(&path, &vault, false).unwrap();
        assert_eq!(config.peers["pc"].last_seen, None);
        assert_eq!(config.secret().unwrap().to_bytes(), [17; 32]);
        assert_eq!(vault.get().unwrap().as_deref(), Some(encoded.as_str()));
        let disk: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(disk.get("secretKey").is_none());
        config.peers.get_mut("pc").unwrap().last_seen = Some(1_795_000_000_123);
        config.save(&path).unwrap();
        let reloaded = Config::load_with(&path, &vault, false).unwrap();
        assert_eq!(reloaded.peers["pc"].last_seen, Some(1_795_000_000_123));
        assert_eq!(reloaded.secret().unwrap().to_bytes(), [17; 32]);
        assert_eq!(*vault.writes.borrow(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn locked_or_missing_keychain_never_replaces_an_existing_identity() {
        let encoded = URL_SAFE_NO_PAD.encode([31; 32]);
        let (dir, path) = fixture(Some(&encoded));
        let before = std::fs::read(&path).unwrap();
        let locked = Vault { fail: true, ..Vault::default() };
        assert!(Config::load_with(&path, &locked, false).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let fallback = Config::load_with(&path, &locked, true).unwrap();
        assert_eq!(fallback.secret().unwrap().to_bytes(), [31; 32]);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir_all(dir).unwrap();
        let (dir, path) = fixture(None);
        let vault = Vault::default();
        assert!(Config::load_with(&path, &vault, false).is_err());
        assert_eq!(*vault.writes.borrow(), 0);
        assert!(Config::load_with(&path, &locked, true).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_config_recovers_vault_identity_and_linux_can_start_without_vault() {
        let dir = std::env::temp_dir().join(format!("studio-link-new-{}", uuid::Uuid::new_v4()));
        let path = dir.join("instances.json");
        let vault = Vault { value: RefCell::new(Some(URL_SAFE_NO_PAD.encode([42; 32]))), ..Vault::default() };
        let config = Config::load_with(&path, &vault, false).unwrap();
        assert_eq!(config.secret().unwrap().to_bytes(), [42; 32]);
        assert_eq!(*vault.writes.borrow(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
        let locked = Vault { fail: true, ..Vault::default() };
        let config = Config::load_with(&path, &locked, true).unwrap();
        let identity = config.secret().unwrap().public();
        assert_eq!(Config::load_with(&path, &locked, true).unwrap().secret().unwrap().public(), identity);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_key_is_told_apart_from_a_locked_keychain_and_reset_needs_a_choice() {
        let (dir, path) = fixture(None);
        let empty = Vault::default();
        let locked = Vault { fail: true, ..Vault::default() };
        assert!(key_missing_with(&path, &empty), "portachiavi che risponde senza la chiave");
        assert!(!key_missing_with(&path, &locked), "portachiavi bloccato: si riprova, niente nuova identita'");
        assert!(Config::load_with(&path, &empty, false).is_err(), "nessuna identita' nuova da sola");
        reset_identity_with(&path, &empty, false).unwrap();
        let config = Config::load_with(&path, &empty, false).unwrap();
        assert!(config.peers.is_empty(), "le altre macchine vanno riabbinate");
        assert_eq!(config.name, "MacBook");
        assert!(!key_missing_with(&path, &empty));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
