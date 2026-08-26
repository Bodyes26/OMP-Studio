use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const GITHUB_REPO: &str = "Bodyes26/OMP-Studio";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StudioReleaseAsset {
    pub name: String,
    pub size: u64,
    pub download_url: String,
    pub content_type: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StudioUpdateChannel {
    Stable,
    Nightly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub tag_name: String,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: Option<String>,
    pub html_url: String,
    pub has_update: bool,
    pub asset: Option<StudioReleaseAsset>,
    pub release_channel: StudioUpdateChannel,
    pub ahead_of_channel: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioDownloadProgress {
    pub status: String, // "downloading" | "finished" | "error" | "cancelled"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub speed_bytes_per_sec: u64,
    pub error: Option<String>,
}

// GitHub API Models
#[derive(Debug, Clone, Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    pub content_type: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
    pub html_url: String,
    pub prerelease: bool,
    pub draft: bool,
    pub assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
pub struct NightlyManifest {
    pub version: String,
    #[allow(dead_code)]
    pub commit: String,
    pub published_at: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub digest: Option<String>,
}

pub struct StudioReleaseCandidate {
    pub release: GithubRelease,
    pub version: String,
    pub channel: StudioUpdateChannel,
    pub published_at: Option<String>,
    pub manifest_sha256: Option<String>,
}

#[derive(Debug, Clone)]
pub struct VerifiedInstaller {
    pub path: PathBuf,
    pub sha256: String,
}

pub struct StudioUpdaterState {
    pub is_downloading: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
    pub verified_installer: Arc<Mutex<Option<VerifiedInstaller>>>,
    pub current_target_path: Arc<Mutex<Option<PathBuf>>>,
    pub expected_sha256: Arc<Mutex<Option<String>>>,
}

impl StudioUpdaterState {
    pub fn new() -> Self {
        Self {
            is_downloading: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            verified_installer: Arc::new(Mutex::new(None)),
            current_target_path: Arc::new(Mutex::new(None)),
            expected_sha256: Arc::new(Mutex::new(None)),
        }
    }
}

/// Restituisce la versione corrente dell'applicazione Studio definita nel package.
#[tauri::command]
pub async fn get_studio_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Normalizza una stringa di versione rimuovendo prefissi come 'v' o 'V' e spazi.
pub fn normalize_version(v: &str) -> &str {
    v.trim().trim_start_matches(|c| c == 'v' || c == 'V').trim()
}

/// Estrae e normalizza una stringa SHA256 hex a 64 caratteri da vari formati (es. "sha256:<hex>").
pub fn parse_sha256_digest(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let hex_part = if let Some(stripped) = trimmed.strip_prefix("sha256:") {
        stripped.trim()
    } else if let Some(stripped) = trimmed.strip_prefix("SHA256:") {
        stripped.trim()
    } else {
        trimmed
    };

    if hex_part.len() == 64 && hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hex_part.to_ascii_lowercase())
    } else {
        None
    }
}

/// Estrae il checksum SHA256 per un file specifico da un file di checksum (es. SHA256SUMS).
pub fn extract_hash_from_checksum_file(content: &str, target_filename: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() == 1 {
            if let Some(h) = parse_sha256_digest(parts[0]) {
                return Some(h);
            }
        } else if parts.len() >= 2 {
            let file_part = parts[1].trim_start_matches('*');
            if file_part.eq_ignore_ascii_case(target_filename) {
                if let Some(h) = parse_sha256_digest(parts[0]) {
                    return Some(h);
                }
            }
        }
    }
    None
}

/// Verifica se l'URL di download e' sicuro e proviene dai server ufficiali di GitHub / releases.
pub fn is_trusted_download_url(url: &str) -> bool {
    let parsed = match reqwest::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };

    if parsed.scheme() != "https" {
        return false;
    }

    let host = match parsed.host_str() {
        Some(h) => h.to_lowercase(),
        None => return false,
    };

    if host == "github.com" {
        let expected_prefix = format!("/{}/releases/download/", GITHUB_REPO).to_lowercase();
        return parsed.path().to_lowercase().starts_with(&expected_prefix);
    }

    if host == "objects.githubusercontent.com" || host.ends_with(".githubusercontent.com") {
        return true;
    }

    false
}

/// Valida e ripulisce il nome file dell'installer evitando path traversal ed estensioni non ammesse.
pub fn sanitize_installer_filename(raw_name: &str) -> Result<String, String> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return Err("Nome file installer vuoto".to_string());
    }

    // Rifiuta qualsiasi separatore di percorso o sequenza di navigazione nel nome fornito
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") || trimmed.contains(':') {
        return Err("Path traversal o caratteri di percorso rilevati nel nome file".to_string());
    }

    let path = Path::new(trimmed);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Nome file installer non valido".to_string())?;

    if file_name != trimmed {
        return Err("Il nome file contiene componenti di percorso non ammessi".to_string());
    }

    if !file_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("Caratteri non validi o pericolosi nel nome file installer".to_string());
    }

    let lower = file_name.to_lowercase();
    let has_valid_ext = lower.ends_with(".exe")
        || lower.ends_with(".msi")
        || lower.ends_with(".dmg")
        || lower.ends_with(".appimage")
        || lower.ends_with(".deb")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".zip");

    if !has_valid_ext {
        return Err("Estensione file installer non supportata o non sicura".to_string());
    }

    Ok(file_name.to_string())
}

/// Restituisce la cartella temporanea dedicata agli update e la crea se necessario.
pub fn get_safe_temp_updates_dir() -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join("omp-studio-updates");
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Impossibile creare cartella temporanea: {}", e))?;
    }
    Ok(temp_dir)
}

/// Calcola l'hash SHA256 di un file su disco in modo sicuro con buffer.
pub fn compute_file_sha256<P: AsRef<Path>>(path: P) -> Result<String, std::io::Error> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];

    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn github_asset_to_release_asset(a: &GithubAsset) -> StudioReleaseAsset {
    StudioReleaseAsset {
        name: a.name.clone(),
        size: a.size,
        download_url: a.browser_download_url.clone(),
        content_type: a.content_type.clone(),
        sha256: a.digest.as_deref().and_then(parse_sha256_digest),
    }
}

/// Seleziona l'asset piu' adatto per il sistema operativo e l'architettura correnti.
fn pick_best_asset_for(assets: &[GithubAsset], os: &str, arch: &str) -> Option<StudioReleaseAsset> {
    if assets.is_empty() {
        return None;
    }

    // Windows
    if os == "windows" {
        // Priorita 1: installer nsis exe (es. *setup.exe, *Setup.exe)
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("installer"))
        }) {
            return Some(github_asset_to_release_asset(a));
        }

        // Priorita 2: file .msi
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".msi"))
        {
            return Some(github_asset_to_release_asset(a));
        }

        // Priorita 3: qualsiasi .exe
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".exe"))
        {
            return Some(github_asset_to_release_asset(a));
        }

        // Priorita 4: file .zip per windows
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".zip")
                && (lower.contains("win") || lower.contains("x64") || lower.contains("x86"))
        }) {
            return Some(github_asset_to_release_asset(a));
        }
    }

    // macOS
    if os == "macos" {
        // Cerca prima architettura specifica (aarch64 / arm64 o x64 / x86_64)
        let is_arm = arch.contains("aarch64") || arch.contains("arm");
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".dmg")
                && (if is_arm {
                    lower.contains("aarch64") || lower.contains("arm64")
                } else {
                    lower.contains("x64") || lower.contains("x86_64")
                })
        }) {
            return Some(github_asset_to_release_asset(a));
        }

        // Qualsiasi .dmg
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".dmg"))
        {
            return Some(github_asset_to_release_asset(a));
        }

        // File .app.tar.gz o .tar.gz per macOS
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            (lower.ends_with(".app.tar.gz")
                || lower.ends_with(".tar.gz")
                || lower.ends_with(".zip"))
                && lower.contains("mac")
        }) {
            return Some(github_asset_to_release_asset(a));
        }
    }

    // Linux
    if os == "linux" {
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".appimage"))
        {
            return Some(github_asset_to_release_asset(a));
        }
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".deb"))
        {
            return Some(github_asset_to_release_asset(a));
        }
    }

    // Nessun fallback cross-platform: un pacchetto di un altro OS non e' installabile.
    None
}

fn pick_best_asset(assets: &[GithubAsset]) -> Option<StudioReleaseAsset> {
    pick_best_asset_for(assets, std::env::consts::OS, std::env::consts::ARCH)
}

fn github_get(
    client: &reqwest::Client,
    url: &str,
    current_version: &str,
) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("User-Agent", format!("omp-studio-app/{}", current_version))
        .header("Accept", "application/vnd.github.v3+json")
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .header("Pragma", "no-cache")
}

async fn fetch_latest_stable_release(
    client: &reqwest::Client,
    current_version: &str,
) -> Result<Option<GithubRelease>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );
    let response = github_get(client, &url, current_version)
        .send()
        .await
        .map_err(|e| format!("Impossibile contattare GitHub per la verifica: {}", e))?;

    if response.status().is_success() {
        return response
            .json::<GithubRelease>()
            .await
            .map(Some)
            .map_err(|e| format!("Errore nel parsing della release da GitHub: {}", e));
    }

    if response.status().as_u16() != 404 {
        return Err(format!(
            "GitHub API ha risposto con errore HTTP {}",
            response.status()
        ));
    }

    // Se non esiste una "latest", la lista resta il fallback. Le prerelease
    // non devono mai entrare nel canale stabile.
    let list_url = format!("https://api.github.com/repos/{}/releases", GITHUB_REPO);
    let list_response = github_get(client, &list_url, current_version)
        .send()
        .await
        .map_err(|e| format!("Errore nella connessione a GitHub: {}", e))?;

    if !list_response.status().is_success() {
        return Err(format!(
            "GitHub API ha risposto con codice {}",
            list_response.status()
        ));
    }

    let releases = list_response
        .json::<Vec<GithubRelease>>()
        .await
        .map_err(|e| format!("Errore nel parsing dell'elenco releases: {}", e))?;

    Ok(releases
        .into_iter()
        .find(|release| !release.draft && !release.prerelease))
}

async fn fetch_nightly_release(
    client: &reqwest::Client,
    current_version: &str,
) -> Result<Option<StudioReleaseCandidate>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/nightly",
        GITHUB_REPO
    );
    let response = github_get(client, &url, current_version)
        .send()
        .await
        .map_err(|e| format!("Impossibile contattare GitHub per la nightly: {}", e))?;

    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "GitHub API ha risposto con errore HTTP {} per il canale nightly",
            response.status()
        ));
    }

    let release = response
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("Errore nel parsing della release nightly: {}", e))?;
    if release.draft {
        return Ok(None);
    }
    if !release.prerelease {
        return Err("La release nightly non e' marcata come prerelease".to_string());
    }

    let manifest_asset = release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("nightly.json"))
        .ok_or_else(|| "La release nightly non contiene nightly.json".to_string())?;
    let manifest_response = github_get(
        client,
        &manifest_asset.browser_download_url,
        current_version,
    )
    .send()
    .await
    .map_err(|e| format!("Impossibile scaricare il manifest nightly: {}", e))?;

    if !manifest_response.status().is_success() {
        return Err(format!(
            "Download del manifest nightly fallito con HTTP {}",
            manifest_response.status()
        ));
    }

    let manifest = manifest_response
        .json::<NightlyManifest>()
        .await
        .map_err(|e| format!("Manifest nightly non valido: {}", e))?;
    let version = normalize_version(&manifest.version).to_string();
    let parsed_version = semver::Version::parse(&version)
        .map_err(|e| format!("Versione nightly non valida '{}': {}", version, e))?;
    if parsed_version.pre.is_empty() {
        return Err(format!(
            "La versione nightly '{}' non contiene un identificatore prerelease",
            version
        ));
    }

    let manifest_sha256 = manifest
        .digest
        .as_deref()
        .or(manifest.sha256.as_deref())
        .and_then(parse_sha256_digest);
    let published_at = manifest
        .published_at
        .or_else(|| release.published_at.clone());
    Ok(Some(StudioReleaseCandidate {
        release,
        version,
        channel: StudioUpdateChannel::Nightly,
        published_at,
        manifest_sha256,
    }))
}
fn compare_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    let left = semver::Version::parse(normalize_version(left)).ok()?;
    let right = semver::Version::parse(normalize_version(right)).ok()?;
    Some(left.cmp(&right))
}

fn no_release_info(current_version: &str, channel: StudioUpdateChannel) -> StudioUpdateInfo {
    StudioUpdateInfo {
        current_version: current_version.to_string(),
        latest_version: current_version.to_string(),
        tag_name: format!("v{}", current_version),
        release_name: "Nessuna release trovata".to_string(),
        release_notes: String::new(),
        published_at: None,
        html_url: format!("https://github.com/{}/releases", GITHUB_REPO),
        has_update: false,
        asset: None,
        release_channel: channel,
        ahead_of_channel: false,
    }
}

/// Tenta di risolvere il checksum SHA256 per l'asset selezionato consultando manifest o file compagni.
async fn resolve_asset_sha256(
    client: &reqwest::Client,
    asset: &mut StudioReleaseAsset,
    all_assets: &[GithubAsset],
    current_version: &str,
) {
    if asset.sha256.is_some() {
        return;
    }

    // 1. Cerca file compagno con estensione .sha256 o .sha256sum
    let companion_name = format!("{}.sha256", asset.name);
    let companion_name_alt = format!("{}.sha256sum", asset.name);
    if let Some(companion) = all_assets.iter().find(|a| {
        a.name.eq_ignore_ascii_case(&companion_name)
            || a.name.eq_ignore_ascii_case(&companion_name_alt)
    }) {
        if let Ok(res) = github_get(client, &companion.browser_download_url, current_version).send().await {
            if res.status().is_success() {
                if let Ok(text) = res.text().await {
                    if let Some(hash) = extract_hash_from_checksum_file(&text, &asset.name) {
                        asset.sha256 = Some(hash);
                        return;
                    }
                }
            }
        }
    }

    // 2. Cerca manifest globale SHA256SUMS / checksums.txt
    if let Some(sums_asset) = all_assets.iter().find(|a| {
        let n = a.name.to_lowercase();
        n == "sha256sums" || n == "sha256sums.txt" || n == "checksums.txt"
    }) {
        if let Ok(res) = github_get(client, &sums_asset.browser_download_url, current_version).send().await {
            if res.status().is_success() {
                if let Ok(text) = res.text().await {
                    if let Some(hash) = extract_hash_from_checksum_file(&text, &asset.name) {
                        asset.sha256 = Some(hash);
                    }
                }
            }
        }
    }
}

/// Verifica gli aggiornamenti stabili oppure la piu' recente fra stabile e nightly.
#[tauri::command]
pub async fn check_studio_update(
    state: State<'_, StudioUpdaterState>,
    channel: StudioUpdateChannel,
) -> Result<StudioUpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Impossibile inizializzare client HTTP: {}", e))?;

    let stable = fetch_latest_stable_release(&client, current_version)
        .await?
        .map(|release| StudioReleaseCandidate {
            version: normalize_version(&release.tag_name).to_string(),
            published_at: release.published_at.clone(),
            release,
            channel: StudioUpdateChannel::Stable,
            manifest_sha256: None,
        });

    let nightly = if channel == StudioUpdateChannel::Nightly {
        fetch_nightly_release(&client, current_version).await?
    } else {
        None
    };

    let candidate = match (stable, nightly) {
        (Some(stable), Some(nightly))
            if compare_versions(&nightly.version, &stable.version)
                == Some(std::cmp::Ordering::Greater) =>
        {
            nightly
        }
        (Some(stable), _) => stable,
        (None, Some(nightly)) => nightly,
        (None, None) => return Ok(no_release_info(current_version, channel)),
    };

    let relation = compare_versions(&candidate.version, current_version);
    let has_update = match relation {
        Some(std::cmp::Ordering::Greater) => true,
        Some(_) => false,
        None => candidate.version != normalize_version(current_version),
    };
    let ahead_of_channel = relation == Some(std::cmp::Ordering::Less);
    let mut best_asset = pick_best_asset(&candidate.release.assets);

    if let Some(asset) = &mut best_asset {
        if asset.sha256.is_none() {
            if let Some(sha) = &candidate.manifest_sha256 {
                asset.sha256 = Some(sha.clone());
            }
        }
        resolve_asset_sha256(&client, asset, &candidate.release.assets, current_version).await;
        // Memorizza l'hash atteso verificato nello stato globale dell'updater
        *state.expected_sha256.lock() = asset.sha256.clone();
    } else {
        *state.expected_sha256.lock() = None;
    }

    let release_name = candidate
        .release
        .name
        .clone()
        .unwrap_or_else(|| candidate.release.tag_name.clone());

    Ok(StudioUpdateInfo {
        current_version: current_version.to_string(),
        latest_version: candidate.version,
        tag_name: candidate.release.tag_name,
        release_name,
        release_notes: candidate.release.body.unwrap_or_default(),
        published_at: candidate.published_at,
        html_url: candidate.release.html_url,
        has_update,
        asset: best_asset,
        release_channel: candidate.channel,
        ahead_of_channel,
    })
}

/// Scarica l'asset dell'aggiornamento emettendo eventi di progresso all'interfaccia con validazione di integrita'.
#[tauri::command]
pub async fn start_studio_update_download(
    app: AppHandle,
    state: State<'_, StudioUpdaterState>,
    download_url: String,
    filename: String,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    // 1. Prevenzione download concorrenti
    if state
        .is_downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Un download e' gia' in corso".to_string());
    }

    // 2. Risoluzione e validazione obbligatoria dell'hash SHA256
    let stored_expected = state.expected_sha256.lock().clone();
    let verified_expected_hash = match (
        expected_sha256.as_deref().and_then(parse_sha256_digest),
        stored_expected.as_deref().and_then(parse_sha256_digest),
    ) {
        (Some(param_hash), Some(stored_hash)) => {
            if !param_hash.eq_ignore_ascii_case(&stored_hash) {
                state.is_downloading.store(false, Ordering::SeqCst);
                return Err("Discrepanza di checksum SHA256 tra richiesta e release verificata: download rifiutato.".to_string());
            }
            param_hash
        }
        (Some(param_hash), None) => param_hash,
        (None, Some(stored_hash)) => stored_hash,
        (None, None) => {
            state.is_downloading.store(false, Ordering::SeqCst);
            return Err("Checksum SHA256 non disponibile per questa release. Per motivi di sicurezza l'installazione è rifiutata.".to_string());
        }
    };

    // 3. Confinamento URL di download: solo server GitHub ufficiali
    if !is_trusted_download_url(&download_url) {
        state.is_downloading.store(false, Ordering::SeqCst);
        return Err(format!(
            "URL di download non attendibile o non autorizzato: {}",
            download_url
        ));
    }

    // 4. Sanitizzazione e confinamento del nome file
    let safe_filename = match sanitize_installer_filename(&filename) {
        Ok(f) => f,
        Err(e) => {
            state.is_downloading.store(false, Ordering::SeqCst);
            return Err(format!("Nome file installer non sicuro: {}", e));
        }
    };

    let temp_dir = match get_safe_temp_updates_dir() {
        Ok(d) => d,
        Err(e) => {
            state.is_downloading.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    let target_path = temp_dir.join(&safe_filename);
    let part_path = temp_dir.join(format!("{}.downloading", safe_filename));

    // Pulizia preventiva di file parziali o target preesistenti
    if part_path.exists() {
        let _ = std::fs::remove_file(&part_path);
    }
    if target_path.exists() {
        let _ = std::fs::remove_file(&target_path);
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    *state.verified_installer.lock() = None;
    *state.current_target_path.lock() = Some(target_path.clone());

    let is_downloading = Arc::clone(&state.is_downloading);
    let cancel_flag = Arc::clone(&state.cancel_flag);
    let verified_installer = Arc::clone(&state.verified_installer);
    let current_target_path = Arc::clone(&state.current_target_path);
    let app_handle = app.clone();
    let target_path_for_thread = target_path.clone();
    let part_path_for_thread = part_path.clone();
    let target_path_str = target_path.to_string_lossy().to_string();
    let expected_hash = verified_expected_hash;

    tokio::spawn(async move {
        let cleanup_temp_files = || {
            if part_path_for_thread.exists() {
                let _ = std::fs::remove_file(&part_path_for_thread);
            }
            if target_path_for_thread.exists() {
                let _ = std::fs::remove_file(&target_path_for_thread);
            }
        };

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                cleanup_temp_files();
                *current_target_path.lock() = None;
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0,
                        error: Some(format!("Errore inizializzazione client: {}", e)),
                    },
                );
                return;
            }
        };

        let response = match client.get(&download_url).send().await {
            Ok(res) if res.status().is_success() => res,
            Ok(res) => {
                cleanup_temp_files();
                *current_target_path.lock() = None;
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0,
                        error: Some(format!(
                            "Server di download ha risposto con codice {}",
                            res.status()
                        )),
                    },
                );
                return;
            }
            Err(e) => {
                cleanup_temp_files();
                *current_target_path.lock() = None;
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0,
                        error: Some(format!("Errore connessione durante il download: {}", e)),
                    },
                );
                return;
            }
        };

        let total_size = response.content_length().unwrap_or(0);
        let mut stream = response.bytes_stream();

        let mut file = match tokio::fs::File::create(&part_path_for_thread).await {
            Ok(f) => f,
            Err(e) => {
                cleanup_temp_files();
                *current_target_path.lock() = None;
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: total_size,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0,
                        error: Some(format!(
                            "Impossibile creare il file temporaneo su disco: {}",
                            e
                        )),
                    },
                );
                return;
            }
        };

        use tokio::io::AsyncWriteExt;
        let mut downloaded_bytes: u64 = 0;
        let start_time = Instant::now();
        let mut last_progress_emit = Instant::now();
        let mut bytes_since_last_emit: u64 = 0;
        let mut current_speed: u64 = 0;
        let mut hasher = Sha256::new();

        while let Some(chunk_res) = stream.next().await {
            if cancel_flag.load(Ordering::SeqCst) {
                drop(file);
                cleanup_temp_files();
                *current_target_path.lock() = None;
                *verified_installer.lock() = None;
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "cancelled".to_string(),
                        downloaded_bytes,
                        total_bytes: total_size,
                        percentage: if total_size > 0 {
                            (downloaded_bytes as f64 / total_size as f64) * 100.0
                        } else {
                            0.0
                        },
                        speed_bytes_per_sec: 0,
                        error: None,
                    },
                );
                return;
            }

            match chunk_res {
                Ok(chunk) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        drop(file);
                        cleanup_temp_files();
                        *current_target_path.lock() = None;
                        *verified_installer.lock() = None;
                        is_downloading.store(false, Ordering::SeqCst);
                        let _ = app_handle.emit(
                            "studio_update_progress",
                            StudioDownloadProgress {
                                status: "error".to_string(),
                                downloaded_bytes,
                                total_bytes: total_size,
                                percentage: if total_size > 0 {
                                    (downloaded_bytes as f64 / total_size as f64) * 100.0
                                } else {
                                    0.0
                                },
                                speed_bytes_per_sec: 0,
                                error: Some(format!("Errore di scrittura su disco: {}", e)),
                            },
                        );
                        return;
                    }

                    hasher.update(&chunk);

                    let chunk_len = chunk.len() as u64;
                    downloaded_bytes += chunk_len;
                    bytes_since_last_emit += chunk_len;

                    let now = Instant::now();
                    let elapsed = now.duration_since(last_progress_emit);
                    if elapsed >= Duration::from_millis(200)
                        || (total_size > 0 && downloaded_bytes >= total_size)
                    {
                        let secs = elapsed.as_secs_f64();
                        if secs > 0.0 {
                            current_speed = (bytes_since_last_emit as f64 / secs) as u64;
                        }
                        bytes_since_last_emit = 0;
                        last_progress_emit = now;

                        let percentage = if total_size > 0 {
                            ((downloaded_bytes as f64 / total_size as f64) * 100.0).min(100.0)
                        } else {
                            0.0
                        };

                        let _ = app_handle.emit(
                            "studio_update_progress",
                            StudioDownloadProgress {
                                status: "downloading".to_string(),
                                downloaded_bytes,
                                total_bytes: total_size,
                                percentage,
                                speed_bytes_per_sec: current_speed,
                                error: None,
                            },
                        );
                    }
                }
                Err(e) => {
                    drop(file);
                    cleanup_temp_files();
                    *current_target_path.lock() = None;
                    *verified_installer.lock() = None;
                    is_downloading.store(false, Ordering::SeqCst);
                    let _ = app_handle.emit(
                        "studio_update_progress",
                        StudioDownloadProgress {
                            status: "error".to_string(),
                            downloaded_bytes,
                            total_bytes: total_size,
                            percentage: if total_size > 0 {
                                (downloaded_bytes as f64 / total_size as f64) * 100.0
                            } else {
                                0.0
                            },
                            speed_bytes_per_sec: 0,
                            error: Some(format!("Errore durante la ricezione dati: {}", e)),
                        },
                    );
                    return;
                }
            }
        }

        if let Err(e) = file.flush().await {
            drop(file);
            cleanup_temp_files();
            *current_target_path.lock() = None;
            *verified_installer.lock() = None;
            is_downloading.store(false, Ordering::SeqCst);
            let _ = app_handle.emit(
                "studio_update_progress",
                StudioDownloadProgress {
                    status: "error".to_string(),
                    downloaded_bytes,
                    total_bytes: total_size,
                    percentage: 100.0,
                    speed_bytes_per_sec: 0,
                    error: Some(format!("Errore nel completamento scrittura file: {}", e)),
                },
            );
            return;
        }

        drop(file);

        // Validazione finale del checksum SHA-256
        let computed_sha256 = format!("{:x}", hasher.finalize());
        if !computed_sha256.eq_ignore_ascii_case(&expected_hash) {
            cleanup_temp_files();
            *current_target_path.lock() = None;
            *verified_installer.lock() = None;
            is_downloading.store(false, Ordering::SeqCst);

            let err_msg = format!(
                "Validazione integrità fallita: checksum SHA256 non corrispondente (atteso: {}, calcolato: {}). File eliminato per sicurezza.",
                expected_hash, computed_sha256
            );
            let _ = app_handle.emit(
                "studio_update_progress",
                StudioDownloadProgress {
                    status: "error".to_string(),
                    downloaded_bytes,
                    total_bytes: if total_size > 0 {
                        total_size
                    } else {
                        downloaded_bytes
                    },
                    percentage: 100.0,
                    speed_bytes_per_sec: 0,
                    error: Some(err_msg),
                },
            );
            return;
        }

        // Rinomina atomica da .downloading a file definitivo
        if let Err(e) = tokio::fs::rename(&part_path_for_thread, &target_path_for_thread).await {
            cleanup_temp_files();
            *current_target_path.lock() = None;
            *verified_installer.lock() = None;
            is_downloading.store(false, Ordering::SeqCst);
            let _ = app_handle.emit(
                "studio_update_progress",
                StudioDownloadProgress {
                    status: "error".to_string(),
                    downloaded_bytes,
                    total_bytes: total_size,
                    percentage: 100.0,
                    speed_bytes_per_sec: 0,
                    error: Some(format!("Impossibile finalizzare il file scaricato: {}", e)),
                },
            );
            return;
        }

        // Salva le informazioni del pacchetto verificato
        *verified_installer.lock() = Some(VerifiedInstaller {
            path: target_path_for_thread.clone(),
            sha256: computed_sha256,
        });
        *current_target_path.lock() = None;
        is_downloading.store(false, Ordering::SeqCst);

        let total_time = start_time.elapsed().as_secs_f64();
        let avg_speed = if total_time > 0.0 {
            (downloaded_bytes as f64 / total_time) as u64
        } else {
            0
        };

        let _ = app_handle.emit(
            "studio_update_progress",
            StudioDownloadProgress {
                status: "finished".to_string(),
                downloaded_bytes,
                total_bytes: if total_size > 0 {
                    total_size
                } else {
                    downloaded_bytes
                },
                percentage: 100.0,
                speed_bytes_per_sec: avg_speed,
                error: None,
            },
        );
    });

    Ok(target_path_str)
}

/// Annulla il download in corso se presente ed elimina ogni file temporaneo.
#[tauri::command]
pub async fn cancel_studio_update_download(
    state: State<'_, StudioUpdaterState>,
) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);

    if let Some(target) = state.current_target_path.lock().take() {
        let filename = target.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !filename.is_empty() {
            let temp_dir = target.parent().unwrap_or(&target);
            let part_path = temp_dir.join(format!("{}.downloading", filename));
            if part_path.exists() {
                let _ = std::fs::remove_file(&part_path);
            }
        }
        if target.exists() {
            let _ = std::fs::remove_file(&target);
        }
    }

    if let Some(verified) = state.verified_installer.lock().take() {
        if verified.path.exists() {
            let _ = std::fs::remove_file(&verified.path);
        }
    }

    state.is_downloading.store(false, Ordering::SeqCst);
    Ok(())
}

/// Esegue l'installer dell'aggiornamento dopo averne validato rigorosamente l'integrità e il confinamento.
#[tauri::command]
pub async fn install_studio_update_and_restart(
    app: AppHandle,
    state: State<'_, StudioUpdaterState>,
) -> Result<(), String> {
    let verified = {
        let guard = state.verified_installer.lock();
        match guard.as_ref() {
            Some(v) => v.clone(),
            None => {
                return Err(
                    "Nessun pacchetto di aggiornamento verificato trovato su disco. Riprova a scaricarlo con verifica di integrità."
                        .to_string(),
                );
            }
        }
    };

    let installer_path = verified.path;
    if !installer_path.exists() {
        *state.verified_installer.lock() = None;
        return Err(
            "Il file dell'installer non è più presente su disco. Riprova a scaricarlo.".to_string(),
        );
    }

    // 1. Controllo di confinamento: il percorso deve risiedere rigorosamente nella cartella temporanea autorizzata
    let temp_dir = get_safe_temp_updates_dir()?;
    let canonical_temp = temp_dir
        .canonicalize()
        .map_err(|e| format!("Errore risoluzione cartella temp: {}", e))?;
    let canonical_installer = installer_path
        .canonicalize()
        .map_err(|e| format!("Errore risoluzione percorso installer: {}", e))?;

    if !canonical_installer.starts_with(&canonical_temp) {
        let _ = std::fs::remove_file(&installer_path);
        *state.verified_installer.lock() = None;
        return Err(
            "Violazione di sicurezza: il file dell'installer è situato fuori dalla directory temporanea autorizzata."
                .to_string(),
        );
    }

    // 2. Ricalcolo dell'hash SHA256 direttamente dal disco prima dell'esecuzione (TOCTOU protection)
    let disk_sha256 = compute_file_sha256(&installer_path).map_err(|e| {
        let _ = std::fs::remove_file(&installer_path);
        *state.verified_installer.lock() = None;
        format!(
            "Impossibile validare l'hash del file prima dell'installazione: {}",
            e
        )
    })?;

    if !disk_sha256.eq_ignore_ascii_case(&verified.sha256) {
        let _ = std::fs::remove_file(&installer_path);
        *state.verified_installer.lock() = None;
        return Err(format!(
            "Validazione integrità pre-installazione fallita: checksum su disco modificato (atteso: {}, trovato: {}). File eliminato per sicurezza.",
            verified.sha256, disk_sha256
        ));
    }

    let _os = std::env::consts::OS;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

        let current_exe =
            std::env::current_exe().unwrap_or_else(|_| PathBuf::from("OMP Studio.exe"));

        let is_msi = installer_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("msi"))
            .unwrap_or(false);

        let installer_str = canonical_installer.to_string_lossy().to_string();
        let current_exe_str = current_exe.to_string_lossy().to_string();

        // Controllo stringhe per impedire iniezione di comandi shell
        fn contains_shell_meta(p: &str) -> bool {
            p.chars().any(|c| {
                matches!(
                    c,
                    '"' | '&' | '|' | '<' | '>' | '^' | '%' | ';' | '\r' | '\n' | '\0'
                )
            })
        }

        if contains_shell_meta(&installer_str) || contains_shell_meta(&current_exe_str) {
            let _ = std::fs::remove_file(&installer_path);
            *state.verified_installer.lock() = None;
            return Err("Caratteri non consentiti nei percorsi di installazione".to_string());
        }

        let cmd_string = if is_msi {
            format!(
                "msiexec.exe /i \"{}\" /passive /norestart & start \"\" \"{}\"",
                installer_str, current_exe_str
            )
        } else {
            // NSIS setup EXE: /S esegue l'installazione in modalita' silenziosa senza wizard
            format!(
                "start \"\" /wait \"{}\" /S & start \"\" \"{}\"",
                installer_str, current_exe_str
            )
        };

        // La riga deve arrivare a cmd.exe verbatim: Command::args escapa le quote
        // interne come \" e cmd.exe non riconosce quell'escaping, quindi `start`
        // riceverebbe percorsi spezzati e l'installer non partirebbe mai (fallimento
        // silenzioso, perche' lo spawn di cmd.exe riesce comunque e l'app si chiude).
        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg(format!("/D /S /C \"{}\"", cmd_string));
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        cmd.spawn()
            .map_err(|e| format!("Impossibile avviare il processo di aggiornamento: {}", e))?;

        // Breve pausa per essere certi che il processo installer sia stato avviato
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Chiude l'applicazione per rilasciare i file lock di OMP Studio.exe
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let ext = installer_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext.eq_ignore_ascii_case("dmg") {
            Command::new("open")
                .arg(&installer_path)
                .spawn()
                .map_err(|e| format!("Impossibile aprire il DMG: {}", e))?;
        } else {
            Command::new("open")
                .arg("-R")
                .arg(&installer_path)
                .spawn()
                .map_err(|e| format!("Impossibile mostrare il file: {}", e))?;
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
        app.exit(0);
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let ext = installer_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext.eq_ignore_ascii_case("appimage") {
            let _ = Command::new("chmod")
                .arg("+x")
                .arg(&installer_path)
                .status();
            Command::new(&installer_path)
                .spawn()
                .map_err(|e| format!("Impossibile eseguire AppImage: {}", e))?;
        } else {
            Command::new("xdg-open")
                .arg(&installer_path)
                .spawn()
                .map_err(|e| format!("Impossibile aprire il pacchetto: {}", e))?;
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
        app.exit(0);
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(format!(
        "Installazione automatica non supportata su {}",
        _os
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_version() {
        assert_eq!(normalize_version("v0.3.1"), "0.3.1");
        assert_eq!(normalize_version("V1.0.0"), "1.0.0");
        assert_eq!(normalize_version("  v0.2.0  "), "0.2.0");
        assert_eq!(normalize_version("0.3.0"), "0.3.0");
    }

    #[test]
    fn test_semver_comparison() {
        let cur = semver::Version::parse(normalize_version("v0.3.0")).unwrap();
        let lat = semver::Version::parse(normalize_version("v0.3.1")).unwrap();
        assert!(lat > cur);

        let lat_major = semver::Version::parse(normalize_version("1.0.0")).unwrap();
        assert!(lat_major > cur);

        let lat_same = semver::Version::parse(normalize_version("0.3.0")).unwrap();
        assert!(!(lat_same > cur));
    }

    #[test]
    fn test_nightly_version_ordering() {
        assert_eq!(
            compare_versions("1.0.2-nightly.743", "1.0.1"),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            compare_versions("1.0.2-nightly.743", "1.0.2-nightly.742"),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            compare_versions("1.0.2", "1.0.2-nightly.743"),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            compare_versions("1.1.0", "1.0.2-nightly.743"),
            Some(std::cmp::Ordering::Greater)
        );
    }

    #[test]
    fn test_parse_sha256_digest_formats() {
        let valid_hex = "1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad";
        assert_eq!(
            parse_sha256_digest(valid_hex),
            Some(valid_hex.to_string())
        );
        assert_eq!(
            parse_sha256_digest(&format!("sha256:{}", valid_hex)),
            Some(valid_hex.to_string())
        );
        assert_eq!(
            parse_sha256_digest(&format!("SHA256: {}", valid_hex.to_uppercase())),
            Some(valid_hex.to_string())
        );

        // Invalid cases
        assert_eq!(parse_sha256_digest("not-a-hash"), None);
        assert_eq!(parse_sha256_digest("1d96d7"), None); // Too short
        assert_eq!(
            parse_sha256_digest("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006zg"),
            None
        ); // Non-hex char
    }

    #[test]
    fn test_extract_hash_from_checksum_file() {
        let file_content = r#"
# Checksums for OMP Studio
1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad  OMP-Studio_0.3.1_x64-setup.exe
b0613893715ab033d81414c1f905a91e76710ed06c03815d700d62cc76403b5b *OMP.Studio_1.1.0_universal.dmg
"#;
        assert_eq!(
            extract_hash_from_checksum_file(
                file_content,
                "OMP-Studio_0.3.1_x64-setup.exe"
            ),
            Some("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string())
        );
        assert_eq!(
            extract_hash_from_checksum_file(
                file_content,
                "OMP.Studio_1.1.0_universal.dmg"
            ),
            Some("b0613893715ab033d81414c1f905a91e76710ed06c03815d700d62cc76403b5b".to_string())
        );
        assert_eq!(
            extract_hash_from_checksum_file(file_content, "non-existent.exe"),
            None
        );

        // Single hash line format
        let single_line = "1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad\n";
        assert_eq!(
            extract_hash_from_checksum_file(single_line, "any-file.exe"),
            Some("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string())
        );
    }

    #[test]
    fn test_is_trusted_download_url() {
        assert!(is_trusted_download_url(
            "https://github.com/Bodyes26/OMP-Studio/releases/download/v1.1.0/OMP.Studio_1.1.0_x64-setup.exe"
        ));
        assert!(is_trusted_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/12345"
        ));

        // Rejected URLs
        assert!(!is_trusted_download_url("http://github.com/Bodyes26/OMP-Studio/releases/download/v1.1.0/file.exe")); // HTTP insecure
        assert!(!is_trusted_download_url("https://malicious.com/malware.exe")); // Unknown domain
        assert!(!is_trusted_download_url("https://github.com/other-user/other-repo/releases/download/v1.0/file.exe")); // Wrong repo
        assert!(!is_trusted_download_url("not-a-url"));
    }

    #[test]
    fn test_sanitize_installer_filename() {
        assert_eq!(
            sanitize_installer_filename("OMP.Studio_1.1.0_x64-setup.exe").unwrap(),
            "OMP.Studio_1.1.0_x64-setup.exe"
        );
        assert_eq!(
            sanitize_installer_filename("OMP.Studio_universal.dmg").unwrap(),
            "OMP.Studio_universal.dmg"
        );
        assert_eq!(
            sanitize_installer_filename("omp-studio.AppImage").unwrap(),
            "omp-studio.AppImage"
        );

        // Path traversal rejection
        assert!(sanitize_installer_filename("../../malicious.exe").is_err());
        assert!(sanitize_installer_filename("..\\..\\malicious.exe").is_err());
        assert!(sanitize_installer_filename("folder/malicious.exe").is_err());

        // Dangerous / invalid extensions rejection
        assert!(sanitize_installer_filename("script.bat").is_err());
        assert!(sanitize_installer_filename("script.ps1").is_err());
        assert!(sanitize_installer_filename("payload.dll").is_err());
        assert!(sanitize_installer_filename("evil.vbs").is_err());

        // Dangerous characters
        assert!(sanitize_installer_filename("test;calc.exe").is_err());
        assert!(sanitize_installer_filename("test&calc.exe").is_err());
        assert!(sanitize_installer_filename("test|calc.exe").is_err());
    }

    #[test]
    fn test_compute_file_sha256() {
        let temp_dir = std::env::temp_dir().join("omp-studio-test-sha256");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("test_file.txt");

        // Hash of "hello world\n": a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447
        std::fs::write(&test_file, b"hello world\n").unwrap();

        let hash = compute_file_sha256(&test_file).unwrap();
        assert_eq!(
            hash,
            "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
        );

        let _ = std::fs::remove_file(&test_file);
        let _ = std::fs::remove_dir(&temp_dir);
    }

    #[test]
    fn test_pick_best_asset_windows() {
        let assets = vec![
            GithubAsset {
                name: "OMP-Studio_0.3.1_x64-setup.exe".to_string(),
                size: 65432100,
                browser_download_url: "https://github.com/Bodyes26/OMP-Studio/releases/download/v0.3.1/OMP-Studio_0.3.1_x64-setup.exe".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                digest: Some("sha256:1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string()),
            },
            GithubAsset {
                name: "OMP-Studio_0.3.1_x64.msi".to_string(),
                size: 67432100,
                browser_download_url: "https://github.com/Bodyes26/OMP-Studio/releases/download/v0.3.1/OMP-Studio_0.3.1_x64.msi".to_string(),
                content_type: Some("application/octet-stream".to_string()),
                digest: None,
            },
        ];

        let picked = pick_best_asset_for(&assets, "windows", "x86_64");
        assert!(picked.is_some());
        let asset = picked.unwrap();
        assert!(asset.name.contains("setup.exe"));
        assert_eq!(
            asset.sha256,
            Some("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string())
        );
    }

    #[test]
    fn test_pick_best_asset_rejects_other_operating_systems() {
        let mac_assets = vec![GithubAsset {
            name: "OMP.Studio_0.8.1_aarch64.dmg".to_string(),
            size: 12_000_000,
            browser_download_url: "https://example.invalid/OMP.Studio_0.8.1_aarch64.dmg"
                .to_string(),
            content_type: Some("application/x-apple-diskimage".to_string()),
            digest: None,
        }];
        let windows_assets = vec![GithubAsset {
            name: "OMP-Studio_0.8.1_x64-setup.exe".to_string(),
            size: 15_000_000,
            browser_download_url: "https://example.invalid/OMP-Studio_0.8.1_x64-setup.exe"
                .to_string(),
            content_type: Some("application/octet-stream".to_string()),
            digest: None,
        }];

        assert!(pick_best_asset_for(&mac_assets, "windows", "x86_64").is_none());
        assert!(pick_best_asset_for(&windows_assets, "macos", "aarch64").is_none());
    }

    #[test]
    fn test_sanitize_installer_filename_edge_cases() {
        assert!(sanitize_installer_filename("C:malicious.exe").is_err());
        assert!(sanitize_installer_filename("D:\\updates\\setup.exe").is_err());
        assert!(sanitize_installer_filename("setup.exe\0.msi").is_err());
        assert!(sanitize_installer_filename("setup.exe ").is_ok()); // Trimmed
        assert!(sanitize_installer_filename("   ").is_err());
    }

    #[test]
    fn test_extract_hash_multiline_variations() {
        let content = "\n\n# Header comment\n\n  \n  1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad   target.exe  \n";
        assert_eq!(
            extract_hash_from_checksum_file(content, "target.exe"),
            Some("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string())
        );
    }

    #[test]
    fn test_integrity_validation_mismatch_detected() {
        let temp_dir = std::env::temp_dir().join("omp-studio-test-mismatch");
        let _ = std::fs::create_dir_all(&temp_dir);
        let corrupted_file = temp_dir.join("corrupted.exe");
        std::fs::write(&corrupted_file, b"corrupted payload").unwrap();

        let computed_hash = compute_file_sha256(&corrupted_file).unwrap();
        let expected_hash = "1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad";

        assert!(!computed_hash.eq_ignore_ascii_case(expected_hash));

        let _ = std::fs::remove_file(&corrupted_file);
        let _ = std::fs::remove_dir(&temp_dir);
    }

    #[test]
    fn test_nightly_manifest_sha256_parsing() {
        let json = r#"{
            "version": "1.1.1-nightly.12345",
            "commit": "abcdef123456",
            "published_at": "2026-08-26T12:00:00Z",
            "sha256": "1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad"
        }"#;
        let manifest: NightlyManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.version, "1.1.1-nightly.12345");
        assert_eq!(
            manifest.sha256,
            Some("1d96d74b47e829718217d7ff68bd3ff727924c203a6eb294cbe2fbf20d4006ad".to_string())
        );
    }

    #[test]
    fn test_safe_temp_updates_dir_exists() {
        let temp_dir = get_safe_temp_updates_dir().unwrap();
        assert!(temp_dir.exists());
        assert!(temp_dir.ends_with("omp-studio-updates"));
    }
}
