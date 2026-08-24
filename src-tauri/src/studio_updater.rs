use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const GITHUB_REPO: &str = "Bodyes26/OMP-Studio";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioReleaseAsset {
    pub name: String,
    pub size: u64,
    pub download_url: String,
    pub content_type: Option<String>,
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
#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    pub prerelease: bool,
    draft: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct NightlyManifest {
    version: String,
    #[allow(dead_code)]
    commit: String,
    published_at: Option<String>,
}

struct StudioReleaseCandidate {
    release: GithubRelease,
    version: String,
    channel: StudioUpdateChannel,
    published_at: Option<String>,
}

pub struct StudioUpdaterState {
    pub is_downloading: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
    pub downloaded_installer: Arc<Mutex<Option<PathBuf>>>,
}

impl StudioUpdaterState {
    pub fn new() -> Self {
        Self {
            is_downloading: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            downloaded_installer: Arc::new(Mutex::new(None)),
        }
    }
}

/// Restituisce la versione corrente dell'applicazione Studio definita nel package.
#[tauri::command]
pub async fn get_studio_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Normalizza una stringa di versione rimuovendo prefissi come 'v' o 'V' e spazi.
fn normalize_version(v: &str) -> &str {
    v.trim().trim_start_matches(|c| c == 'v' || c == 'V').trim()
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
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }

        // Priorita 2: file .msi
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".msi"))
        {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }

        // Priorita 3: qualsiasi .exe
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".exe"))
        {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }

        // Priorita 4: file .zip per windows
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".zip")
                && (lower.contains("win") || lower.contains("x64") || lower.contains("x86"))
        }) {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
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
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }

        // Qualsiasi .dmg
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".dmg"))
        {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }

        // File .app.tar.gz o .tar.gz per macOS
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            (lower.ends_with(".app.tar.gz")
                || lower.ends_with(".tar.gz")
                || lower.ends_with(".zip"))
                && lower.contains("mac")
        }) {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }
    }

    // Linux
    if os == "linux" {
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".appimage"))
        {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
        }
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".deb"))
        {
            return Some(StudioReleaseAsset {
                name: a.name.clone(),
                size: a.size,
                download_url: a.browser_download_url.clone(),
                content_type: a.content_type.clone(),
            });
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

    let published_at = manifest
        .published_at
        .or_else(|| release.published_at.clone());
    Ok(Some(StudioReleaseCandidate {
        release,
        version,
        channel: StudioUpdateChannel::Nightly,
        published_at,
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

/// Verifica gli aggiornamenti stabili oppure la piu' recente fra stabile e nightly.
#[tauri::command]
pub async fn check_studio_update(channel: StudioUpdateChannel) -> Result<StudioUpdateInfo, String> {
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
    let best_asset = pick_best_asset(&candidate.release.assets);
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

/// Scarica l'asset dell'aggiornamento emettendo eventi di progresso all'interfaccia.
#[tauri::command]
pub async fn start_studio_update_download(
    app: AppHandle,
    state: State<'_, StudioUpdaterState>,
    download_url: String,
    filename: String,
) -> Result<String, String> {
    // Evita download multipli concorrenti
    if state
        .is_downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Un download e' gia' in corso".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    *state.downloaded_installer.lock() = None;

    let is_downloading = Arc::clone(&state.is_downloading);
    let cancel_flag = Arc::clone(&state.cancel_flag);
    let downloaded_installer = Arc::clone(&state.downloaded_installer);
    let app_handle = app.clone();

    // Creiamo una directory temporanea pulita per gli aggiornamenti di Studio
    let temp_dir = std::env::temp_dir().join("omp-studio-updates");
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        is_downloading.store(false, Ordering::SeqCst);
        return Err(format!("Impossibile creare cartella temporanea: {}", e));
    }

    let sanitized_filename = if filename.trim().is_empty() {
        "omp-studio-update.exe".to_string()
    } else {
        filename
    };
    let target_path = temp_dir.join(&sanitized_filename);
    let file_path_for_thread = target_path.clone();
    let target_path_str = target_path.to_string_lossy().to_string();

    // Rimuovi eventuale file parziale precedente
    if target_path.exists() {
        let _ = std::fs::remove_file(&target_path);
    }

    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
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

        let mut file = match tokio::fs::File::create(&file_path_for_thread).await {
            Ok(f) => f,
            Err(e) => {
                is_downloading.store(false, Ordering::SeqCst);
                let _ = app_handle.emit(
                    "studio_update_progress",
                    StudioDownloadProgress {
                        status: "error".to_string(),
                        downloaded_bytes: 0,
                        total_bytes: total_size,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0,
                        error: Some(format!("Impossibile creare il file su disco: {}", e)),
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

        while let Some(chunk_res) = stream.next().await {
            if cancel_flag.load(Ordering::SeqCst) {
                is_downloading.store(false, Ordering::SeqCst);
                drop(file);
                let _ = tokio::fs::remove_file(&file_path_for_thread).await;
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

        // Memorizziamo il percorso del file scaricato
        *downloaded_installer.lock() = Some(file_path_for_thread.clone());
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

/// Annulla il download in corso se presente.
#[tauri::command]
pub async fn cancel_studio_update_download(
    state: State<'_, StudioUpdaterState>,
) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Esegue l'installer dell'aggiornamento e chiude l'applicazione per consentire la sovrascrittura.
#[tauri::command]
pub async fn install_studio_update_and_restart(
    app: AppHandle,
    state: State<'_, StudioUpdaterState>,
) -> Result<(), String> {
    let installer_path = {
        let guard = state.downloaded_installer.lock();
        match guard.as_ref() {
            Some(p) if p.exists() => p.clone(),
            _ => return Err(
                "Nessun pacchetto di aggiornamento valido trovato su disco. Riprova a scaricarlo."
                    .to_string(),
            ),
        }
    };

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

        let cmd_string = if is_msi {
            format!(
                "msiexec.exe /i \"{}\" /passive /norestart & start \"\" \"{}\"",
                installer_path.display(),
                current_exe.display()
            )
        } else {
            // NSIS setup EXE: /S esegue l'installazione in modalita' silenziosa senza wizard
            format!(
                "start \"\" /wait \"{}\" /S & start \"\" \"{}\"",
                installer_path.display(),
                current_exe.display()
            )
        };

        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg(format!("/C \"{}\"", cmd_string));
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
            // Su macOS apriamo il file .dmg con `open`
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
            // Rendi eseguibile e lancia
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
    fn test_pick_best_asset_windows() {
        let assets = vec![
            GithubAsset {
                name: "OMP-Studio_0.3.1_x64-setup.exe".to_string(),
                size: 65432100,
                browser_download_url: "https://github.com/Bodyes26/OMP-Studio/releases/download/v0.3.1/OMP-Studio_0.3.1_x64-setup.exe".to_string(),
                content_type: Some("application/octet-stream".to_string()),
            },
            GithubAsset {
                name: "OMP-Studio_0.3.1_x64.msi".to_string(),
                size: 67432100,
                browser_download_url: "https://github.com/Bodyes26/OMP-Studio/releases/download/v0.3.1/OMP-Studio_0.3.1_x64.msi".to_string(),
                content_type: Some("application/octet-stream".to_string()),
            },
        ];

        let picked = pick_best_asset_for(&assets, "windows", "x86_64");
        assert!(picked.is_some());
        let asset = picked.unwrap();
        assert!(asset.name.contains("setup.exe"));
    }

    #[test]
    fn test_pick_best_asset_rejects_other_operating_systems() {
        let mac_assets = vec![GithubAsset {
            name: "OMP.Studio_0.8.1_aarch64.dmg".to_string(),
            size: 12_000_000,
            browser_download_url: "https://example.invalid/OMP.Studio_0.8.1_aarch64.dmg"
                .to_string(),
            content_type: Some("application/x-apple-diskimage".to_string()),
        }];
        let windows_assets = vec![GithubAsset {
            name: "OMP-Studio_0.8.1_x64-setup.exe".to_string(),
            size: 15_000_000,
            browser_download_url: "https://example.invalid/OMP-Studio_0.8.1_x64-setup.exe"
                .to_string(),
            content_type: Some("application/octet-stream".to_string()),
        }];

        assert!(pick_best_asset_for(&mac_assets, "windows", "x86_64").is_none());
        assert!(pick_best_asset_for(&windows_assets, "macos", "aarch64").is_none());
    }
}
