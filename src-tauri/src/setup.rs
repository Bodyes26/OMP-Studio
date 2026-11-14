//! Primo avvio guidato: verifica del contratto con `omp`, installazione del
//! binario quando manca, installazione del font Nerd per l'utente e
//! rilevamento della cartella dei progetti.
//!
//! Perimetro di scrittura (docs/DECISIONS.md, Gate R11): `%LOCALAPPDATA%\omp`,
//! il `Path` utente, la chiave `shellPath` solo se assente (in `config.yml`
//! quando esiste, altrimenti in `settings.json`, che `omp` migra al primo
//! avvio), la cartella font per-utente. Il resto di `config.yml` lo scrive
//! `omp` attraverso il suo wizard.
//!
//! Nessun `powershell.exe`: registro e messaggi di sistema passano per le API
//! native. Su macchine con Sophos il solo avvio di PowerShell termina il
//! processo che lo lancia.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{command, AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Nasconde la finestra di console dei processi ausiliari (`reg.exe`).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const OMP_REPO: &str = "can1357/oh-my-pi";

/// Versione del wizard di `omp` che consideriamo "setup fatto".
/// `CURRENT_SETUP_VERSION = 3` in `packages/tui/src/setup/setup-version.ts`,
/// verificato sul bundle di omp 18.18.3. Se `omp` la alza, il wizard nativo
/// tornera' a proporre le scene nuove: `wizard_pending` lo riflette da solo.
const CURRENT_SETUP_VERSION: u64 = 3;

/// Versione minima di `omp` con cui Studio funziona per intero: dalla 18.18.3
/// il contesto delle estensioni espone `invokeTool`, senza il quale il modulo
/// di `ask` della GUI (`extensions/studio-ask.ts`) non puo' partire. Sotto
/// questa soglia Studio propone l'aggiornamento invece di guastarsi in silenzio.
const MIN_OMP_VERSION: &str = "18.18.3";

/// Font incluso nel binario, come l'estensione-ponte dei diagrammi: una sola
/// verita' nel repo, nessuna risorsa Tauri da configurare. E' lo stesso font
/// che il terminale usa via `@font-face` (`static/fonts/StudioMonoNF-Regular.woff2`),
/// riportato in TTF perche' Windows non installa i `.woff2`.
const NERD_FONT_TTF: &[u8] = include_bytes!("../../assets/fonts/FiraCodeNerdFontMono-Regular.ttf");
const NERD_FONT_FILE: &str = "FiraCodeNerdFontMono-Regular.ttf";
/// Nome interno del font (`name` ID 1), quello che Windows mostra e che i
/// terminali cercano. Diverso da "Studio Mono NF" del `@font-face`: nessuna
/// collisione con lo stack del canvas.
const NERD_FONT_NAME: &str = "FiraCode Nerd Font Mono";

// -----------------------------------------------------------------------------
// Stato del contratto
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub name: String,
    pub exists: bool,
    /// Apribile in sola lettura. Un `false` con `exists: true` e' un database
    /// in uso esclusivo o corrotto: va detto, non aggirato.
    pub readable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub omp_installed: bool,
    pub omp_path: Option<String>,
    /// `true` quando non esiste un binario **funzionante** ma un candidato noto
    /// c'e' lo stesso: un collegamento che punta a un file cancellato (il caso
    /// `~/.bun/bin/omp` -> `../../node_modules/.../cli.js` sparito) oppure un
    /// eseguibile che non risponde a `--version`. La differenza con "non
    /// installato" e' quella che il passo Motore mostra all'utente: "danneggiata"
    /// chiede una riparazione, non un primo download.
    pub omp_broken: bool,
    /// Il candidato rotto, per nominarlo nella schermata e nel registro.
    pub omp_broken_path: Option<String>,
    /// Dove Studio installerebbe (o ha installato) il binario. Il frontend la
    /// mostra invece di indovinare un percorso per piattaforma: qui e' gia'
    /// rispettata anche la variabile `PI_INSTALL_DIR`.
    pub install_dir: Option<String>,
    pub omp_version: Option<String>,
    /// `setupVersion` letto da `config.yml`; 0 quando la chiave o il file mancano.
    pub setup_version: u64,
    /// `true` quando il wizard nativo partirebbe da solo alla prima sessione.
    pub wizard_pending: bool,
    pub has_credentials: bool,
    /// Solo i nomi dei provider con credenziale attiva. Mai un token: la
    /// tabella `auth_credentials` viene aperta in sola lettura e la colonna
    /// `data` non viene nemmeno selezionata.
    pub credential_providers: Vec<String>,
    pub default_model: Option<String>,
    pub theme_dark: Option<String>,
    pub color_blind_mode: bool,
    pub nerd_font_installed: bool,
    /// `shellPath` effettivo per `omp`: da `config.yml`, oppure da
    /// `settings.json` finche' `omp` non l'ha migrato.
    pub shell_path: Option<String>,
    /// Solo Windows: nessuna bash configurata ne' trovata. Non blocca (i
    /// comandi del tool `bash` usano la bash interna di `omp`), ma servizi,
    /// terminali e comandi `!` restano senza una shell POSIX.
    pub bash_missing: bool,
    pub min_omp_version: String,
    /// `omp` installato ma piu' vecchio di `MIN_OMP_VERSION`.
    pub omp_outdated: bool,
    pub databases: Vec<DatabaseStatus>,
    /// Cosa manca, in ordine di carta da mostrare: `omp`, `credentials`, `model`.
    pub missing: Vec<String>,
}

pub(crate) fn omp_binary_if_present() -> Option<PathBuf> {
    let resolved = crate::omp_ops::get_omp_binary();
    let path = PathBuf::from(&resolved);
    if path.is_absolute() {
        return path.exists().then_some(path);
    }
    // Nome nudo: `get_omp_binary` ha ripiegato sul PATH. Verifichiamo che il
    // PATH lo risolva davvero, altrimenti "installato" sarebbe una bugia.
    which_on_path(&resolved)
}

/// Risolve un eseguibile sul `PATH` senza spawnare processi esterni (`where.exe` o `sh -c`).
fn which_on_path(program: &str) -> Option<PathBuf> {
    crate::path_lookup::which(program)
}

pub(crate) fn read_omp_version(binary: &Path) -> Option<String> {
    let canonical = crate::omp_ops::canonicalize_binary(binary);
    // 1. Lettura veloce dalla cache senza acquisire il lock di single-flight
    if let Some(cached) = crate::omp_ops::get_cached_omp_version_for(&canonical) {
        return Some(cached);
    }

    // 2. Single-flight: se piu' chiamate concorrenti (es. setup_status e get_omp_version
    // all'avvio) arrivano insieme a cache fredda, la prima esegue il processo e le altre
    // attendono il suo completamento invece di forkare piu' volte `omp --version`.
    static SPAWN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    // 3. Double-checked locking: ri-verifichiamo la cache dopo aver acquisito il lock
    if let Some(cached) = crate::omp_ops::get_cached_omp_version_for(&canonical) {
        return Some(cached);
    }

    // Il percorso canonico serve solo da chiave di cache: si lancia il binario
    // cosi' come e' stato risolto. Su Windows `canonicalize` produce `\\?\C:\...`,
    // che `cmd.exe /c` non sa eseguire, e su Unix risolverebbe il link di bun
    // fino allo script, cambiando argv[0] rispetto agli altri lanci di omp.
    let ext = binary.extension().and_then(|e| e.to_str()).unwrap_or("");
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut cmd = if cfg!(target_os = "windows")
        && (ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    {
        let mut c = Command::new("cmd.exe");
        c.args(["/c", &binary.to_string_lossy(), "--version"]);
        c
    } else {
        let mut c = Command::new(binary);
        c.arg("--version");
        c
    };
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _span = crate::perf_trace::span(
        "boot",
        crate::perf_trace::command_label(binary.to_string_lossy().as_ref(), ["--version"]),
    );
    // Usiamo omp_capture per raccogliere stdout/stderr ed evitare che il figlio
    // lasci file di log orfani in ~/.omp/logs.
    let output = crate::omp_ops::omp_capture(cmd).ok()?;
    // Con exit diverso da 0 lo stderr e' un messaggio d'errore, non una versione:
    // leggerlo come tale (e metterlo in cache) mostrava l'errore al posto della versione.
    if !output.status.success() {
        return None;
    }
    let ver = parse_version_output(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )?;
    crate::omp_ops::set_cached_omp_version_for(&canonical, ver.clone());
    Some(ver)
}

/// Versione da `omp --version`: stdout, o stderr se stdout e' vuoto.
/// `omp/18.0.4` -> `18.0.4`.
fn parse_version_output(stdout: &str, stderr: &str) -> Option<String> {
    let raw = stdout.trim();
    let text_to_parse = if raw.is_empty() { stderr.trim() } else { raw };
    if text_to_parse.is_empty() {
        return None;
    }
    let first = text_to_parse.lines().next()?;
    let version_part = first
        .rsplit('/')
        .next()
        .unwrap_or(first)
        .trim_start_matches(['v', 'V'])
        .trim();
    (!version_part.is_empty()).then(|| version_part.to_string())
}

fn config_yml_path_in(dir: &Path) -> Option<PathBuf> {
    let yml = dir.join("config.yml");
    if yml.exists() {
        return Some(yml);
    }
    // `omp` accetta `config.yaml` come nome di compatibilita' e lo aggiorna
    // in place quando esiste (docs/settings di omp, "Where settings live").
    let yaml = dir.join("config.yaml");
    yaml.exists().then_some(yaml)
}

struct ConfigFacts {
    setup_version: u64,
    default_model: Option<String>,
    theme_dark: Option<String>,
    color_blind_mode: bool,
    shell_path: Option<String>,
}

impl ConfigFacts {
    fn empty() -> Self {
        ConfigFacts {
            setup_version: 0,
            default_model: None,
            theme_dark: None,
            color_blind_mode: false,
            shell_path: None,
        }
    }
}

fn non_empty_str(value: Option<&serde_yaml::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `shellPath` da `settings.json`. `omp` lo legge solo per migrarlo quando
/// nessun `config.yml`/`config.yaml` esiste ancora: con un YAML presente il
/// file e' inerte e non va consultato.
fn legacy_settings_shell_path(agent: &Path) -> Option<String> {
    let text = std::fs::read_to_string(agent.join("settings.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    value
        .get("shellPath")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_config_facts(agent: &Path) -> ConfigFacts {
    let mut facts = ConfigFacts::empty();
    let Some(path) = config_yml_path_in(agent) else {
        facts.shell_path = legacy_settings_shell_path(agent);
        return facts;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return facts;
    };
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&text) else {
        return facts;
    };

    facts.setup_version = value
        .get("setupVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    facts.default_model = non_empty_str(value.get("modelRoles").and_then(|roles| roles.get("default")));
    facts.theme_dark = non_empty_str(value.get("theme").and_then(|theme| theme.get("dark")));
    facts.shell_path = non_empty_str(value.get("shellPath"));
    facts.color_blind_mode = value
        .get("colorBlindMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    facts
}

/// Provider con almeno una credenziale non disabilitata. La query non tocca
/// la colonna `data`: nessun token entra mai nel processo di Studio.
fn read_credential_providers(agent: &Path) -> Vec<String> {
    let path = agent.join("agent.db");
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let _ = conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;");
    let Ok(mut stmt) =
        conn.prepare("SELECT DISTINCT provider FROM auth_credentials WHERE disabled_cause IS NULL")
    else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

fn database_status(agent: &Path) -> Vec<DatabaseStatus> {
    // `stats.db` e `autoqa.db` vivono un livello sopra `agent/`.
    let root = agent.parent().map(|p| p.to_path_buf());
    let targets: Vec<(String, PathBuf)> = ["agent.db", "history.db", "models.db"]
        .iter()
        .map(|name| ((*name).to_string(), agent.join(name)))
        .chain(root.map(|r| ("stats.db".to_string(), r.join("stats.db"))))
        .collect();

    targets
        .into_iter()
        .map(|(name, path)| {
            let exists = path.exists();
            let readable = exists
                && rusqlite::Connection::open_with_flags(
                    &path,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )
                .is_ok();
            DatabaseStatus {
                name,
                exists,
                readable,
            }
        })
        .collect()
}

/// Il `contract_check` previsto in ARCHITECTURE.md §4.1: quattro esiti, non un
/// booleano. Il frontend decide quali carte mostrare leggendo `missing`.
#[command]
pub async fn setup_status() -> Result<SetupStatus, String> {
    tokio::task::spawn_blocking(|| {
        let agent = crate::omp_ops::agent_dir();
        if let Some(dir) = agent.as_deref() {
            ensure_shell_path_once(dir);
        }
        status_for(agent)
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Verifica del contratto: {}", e),
            format!("Contract check: {}", e)
        )
    })
}

/// Porta `shellPath` anche a chi aveva gia' `omp` prima di Studio, una volta
/// per processo. Solo a setup concluso: mentre il wizard nativo gira, `omp`
/// riscrive `config.yml` da un altro processo e una scrittura concorrente di
/// Studio potrebbe perdere le sue scelte.
fn ensure_shell_path_once(agent: &Path) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static DONE: AtomicBool = AtomicBool::new(false);
    if !cfg!(target_os = "windows") || DONE.load(Ordering::Acquire) {
        return;
    }
    if omp_binary_if_present().is_none()
        || read_config_facts(agent).setup_version < CURRENT_SETUP_VERSION
    {
        return;
    }
    if DONE.swap(true, Ordering::AcqRel) {
        return;
    }
    if let Err(error) = ensure_shell_path_in(agent, find_bash()) {
        eprintln!("[Setup] Avviso: shellPath non scritto: {}", error);
    }
}

/// Una shell configurata esiste davvero: percorso assoluto presente su disco,
/// oppure nome nudo risolto dal `PATH`.
fn shell_resolves(shell: &str) -> bool {
    let path = Path::new(shell);
    if path.is_absolute() {
        path.exists()
    } else {
        which_on_path(shell).is_some()
    }
}

/// `true` quando la versione e' leggibile e sotto `MIN_OMP_VERSION`. Una
/// versione illeggibile non e' una prova di vecchiaia: non si allarma.
fn version_below_minimum(version: &str) -> bool {
    let (Ok(current), Ok(minimum)) = (
        semver::Version::parse(version.trim()),
        semver::Version::parse(MIN_OMP_VERSION),
    ) else {
        return false;
    };
    current < minimum
}

/// Diagnosi di un candidato noto di `omp` che non e' un binario funzionante.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BrokenCandidate {
    /// Un collegamento simbolico la cui destinazione non esiste piu': il caso
    /// reale `~/.bun/bin/omp` -> `../../node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`
    /// dopo che l'utente ha cancellato la cartella di bun.
    DanglingSymlink(PathBuf),
    /// Un file che c'e', ma non risponde a `--version` (corrotto, permessi
    /// sbagliati, architettura diversa).
    NotRunnable(PathBuf),
}

impl BrokenCandidate {
    pub(crate) fn path(&self) -> &Path {
        match self {
            BrokenCandidate::DanglingSymlink(path) | BrokenCandidate::NotRunnable(path) => path,
        }
    }
}

/// Classifica un singolo candidato: `None` se non c'e' niente da riparare.
///
/// `symlink_metadata` non segue il collegamento, quindi distingue un link rotto
/// (`Ok` + `metadata` in errore) da un file assente: solo il primo e' una
/// "installazione danneggiata", il secondo e' semplicemente "non installato".
fn classify_candidate(candidate: &Path, runnable: impl Fn(&Path) -> bool) -> Option<BrokenCandidate> {
    // Assente del tutto: "non installato", non "danneggiato".
    std::fs::symlink_metadata(candidate).ok()?;
    match std::fs::metadata(candidate) {
        // Il link c'e' ma la destinazione no.
        Err(_) => Some(BrokenCandidate::DanglingSymlink(candidate.to_path_buf())),
        // Un link che punta a una cartella: esiste, ma non e' un programma.
        Ok(meta) if !meta.is_file() => Some(BrokenCandidate::NotRunnable(candidate.to_path_buf())),
        Ok(_) if !runnable(candidate) => Some(BrokenCandidate::NotRunnable(candidate.to_path_buf())),
        Ok(_) => None,
    }
}

/// Cerca un'installazione di `omp` danneggiata fra i percorsi noti. Va
/// chiamata **solo** quando nessun binario funzionante e' stato trovato:
/// con uno valido in mano, un link rotto accanto non e' un problema da
/// mostrare (dopo una riparazione in `~/.omp/bin` il vecchio `~/.bun/bin/omp`
/// resta rotto, e `omp_broken` deve tornare `false`).
fn find_broken_candidate() -> Option<BrokenCandidate> {
    find_broken_candidate_in(&crate::omp_ops::omp_binary_candidates())
}

/// Variante con l'elenco esplicito: i test la puntano a una cartella
/// temporanea invece che all'`HOME` della macchina.
pub(crate) fn find_broken_candidate_in(candidates: &[PathBuf]) -> Option<BrokenCandidate> {
    candidates
        .iter()
        .find_map(|candidate| classify_candidate(candidate, |path| read_omp_version(path).is_some()))
}

/// Corpo di `setup_status` con la directory dell'agente esplicita: e' quello
/// che i test possono puntare a una cartella vuota senza toccare la
/// configurazione reale della macchina.
fn status_for(agent: Option<PathBuf>) -> SetupStatus {
    let binary = omp_binary_if_present();
    let omp_version = binary.as_deref().and_then(read_omp_version);
    // Solo senza un binario **funzionante**: un'installazione valida rende
    // irrilevante un vecchio collegamento rotto rimasto accanto (e' il caso
    // della riparazione in `~/.omp/bin`, che non cancella il `~/.bun/bin/omp`
    // rimasto orfano). "Funzionante" e' la versione leggibile: un file che
    // esiste ma non risponde a `--version` e' proprio l'altra forma di
    // installazione danneggiata che il passo Motore deve poter riparare.
    let broken = if omp_version.is_some() {
        None
    } else {
        find_broken_candidate()
    };
    let facts = agent
        .as_deref()
        .map(read_config_facts)
        .unwrap_or_else(ConfigFacts::empty);
    let credential_providers = agent
        .as_deref()
        .map(read_credential_providers)
        .unwrap_or_default();

    let mut missing = Vec::new();
    // Anche quando un file c'e' ma e' danneggiato: per il passo Motore «manca
    // un omp che funziona» e «non c'e' nessun omp» portano alla stessa carta,
    // con `ompBroken` a scegliere fra riparazione e primo download.
    if binary.is_none() || broken.is_some() {
        missing.push("omp".to_string());
    }
    if credential_providers.is_empty() {
        missing.push("credentials".to_string());
    }
    if facts.default_model.is_none() {
        missing.push("model".to_string());
    }

    let bash_missing = cfg!(target_os = "windows")
        && match facts.shell_path.as_deref() {
            Some(shell) => !shell_resolves(shell),
            None => find_bash().is_none(),
        };
    let omp_outdated = omp_version.as_deref().is_some_and(version_below_minimum);

    SetupStatus {
        omp_installed: binary.is_some(),
        omp_path: binary.as_ref().map(|p| p.to_string_lossy().to_string()),
        omp_broken: broken.is_some(),
        omp_broken_path: broken
            .as_ref()
            .map(|candidate| candidate.path().to_string_lossy().to_string()),
        install_dir: install_dir().map(|p| p.to_string_lossy().to_string()),
        omp_version,
        setup_version: facts.setup_version,
        wizard_pending: facts.setup_version < CURRENT_SETUP_VERSION,
        has_credentials: !credential_providers.is_empty(),
        credential_providers,
        default_model: facts.default_model,
        theme_dark: facts.theme_dark,
        color_blind_mode: facts.color_blind_mode,
        nerd_font_installed: nerd_font_target().is_some_and(|p| p.exists()),
        shell_path: facts.shell_path,
        bash_missing,
        min_omp_version: MIN_OMP_VERSION.to_string(),
        omp_outdated,
        databases: agent.as_deref().map(database_status).unwrap_or_default(),
        missing,
    }
}

// -----------------------------------------------------------------------------
// Installazione di omp
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// `resolving` | `downloading` | `verifying` | `installing` | `done` | `error`
    pub status: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub message: Option<String>,
    pub error: Option<String>,
    pub diagnostic: Option<String>,
    pub retryable: bool,
}

impl InstallProgress {
    fn stage(status: &str, message: &str) -> Self {
        Self {
            status: status.to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            percentage: 0.0,
            message: Some(message.to_string()),
            error: None,
            diagnostic: None,
            retryable: false,
        }
    }

    fn failed_with_diag(error: String, diagnostic: String, retryable: bool) -> Self {
        Self {
            status: "error".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            percentage: 0.0,
            message: None,
            error: Some(error),
            diagnostic: Some(diagnostic),
            retryable,
        }
    }
}

const INSTALL_EVENT: &str = "setup://install-progress";

#[derive(serde::Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

/// Nome dell'asset di release per una piattaforma. I nomi sono quelli
/// pubblicati da `can1357/oh-my-pi`, verificati sulla release v18.0.4.
fn release_asset_name_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("windows", "x86_64") => Some("omp-windows-x64.exe"),
        ("macos", "aarch64") => Some("omp-darwin-arm64"),
        ("macos", "x86_64") => Some("omp-darwin-x64"),
        ("linux", "aarch64") => Some("omp-linux-arm64"),
        ("linux", "x86_64") => Some("omp-linux-x64"),
        _ => None,
    }
}

fn release_asset_name() -> Option<&'static str> {
    release_asset_name_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// Cartella di installazione, con la stessa variabile d'ambiente rispettata
/// dallo script ufficiale (`PI_INSTALL_DIR`).
fn install_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_INSTALL_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(local).join("omp"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".omp").join("bin"))
    }
}

fn installed_binary_path() -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") {
        "omp.exe"
    } else {
        "omp"
    };
    Some(install_dir()?.join(name))
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .user_agent(format!("omp-studio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| {
            crate::tr!(
                format!("Inizializzazione client HTTP: {}", e),
                format!("HTTP client initialization: {}", e)
            )
        })
}

/// SHA-256 del file appena scaricato, calcolato nativamente in Rust.
/// Evita dipendenze da PowerShell o shasum ed elimina rischi di timeout
/// o execution policy.
fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| {
        crate::tr!(
            format!("Apertura del file da verificare {}: {}", path.display(), e),
            format!("Opening the file to verify {}: {}", path.display(), e)
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| {
            crate::tr!(
                format!("Lettura del file da verificare {}: {}", path.display(), e),
                format!("Reading the file to verify {}: {}", path.display(), e)
            )
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = hasher.finalize();
    Ok(format!("{:x}", hash))
}

fn normalize_sha256(value: &str) -> Option<String> {
    let value = value.trim();
    (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

fn parse_asset_digest(value: &str) -> Option<String> {
    let (algorithm, hash) = value.trim().split_once(':')?;
    if !algorithm.eq_ignore_ascii_case("sha256") {
        return None;
    }
    normalize_sha256(hash)
}

fn resolve_expected_hash(
    asset_digest: Option<&str>,
    checksum_hash: Option<&str>,
) -> Result<String, String> {
    asset_digest
        .and_then(parse_asset_digest)
        .or_else(|| checksum_hash.and_then(normalize_sha256))
        .ok_or_else(|| {
            crate::tr!(
                "La release non fornisce un'impronta SHA-256 valida per il binario richiesto",
                "The release does not provide a valid SHA-256 digest for the requested binary"
            )
            .to_string()
        })
}

fn verify_file_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let expected = normalize_sha256(expected).ok_or_else(|| {
        crate::tr!(
            "L'impronta SHA-256 attesa non e' valida",
            "The expected SHA-256 digest is not valid"
        )
        .to_string()
    })?;
    let actual = file_sha256(path)?;
    if actual == expected {
        return Ok(());
    }
    Err(crate::tr!(
        format!(
            "Impronta del file scaricato diversa da quella ufficiale pubblicata: attesa {}, trovata {}",
            expected, actual
        ),
        format!(
            "The downloaded file digest differs from the published one: expected {}, found {}",
            expected, actual
        )
    ))
}

/// Stringa UTF-16 terminata da zero per le API `W` di Win32.
#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Valore del `Path` utente con la cartella in coda, o `None` se c'e' gia'.
/// Il confronto ignora maiuscole e barra finale, come Windows risolve i
/// percorsi; le voci esistenti restano intatte e nell'ordine originale.
#[cfg(any(target_os = "windows", test))]
fn path_with_dir(current: &str, dir: &str) -> Option<String> {
    let normalize = |entry: &str| entry.trim().trim_end_matches(['\\', '/']).to_lowercase();
    let wanted = normalize(dir);
    if current
        .split(';')
        .any(|entry| !entry.trim().is_empty() && normalize(entry) == wanted)
    {
        return None;
    }
    let base = current.trim_end_matches(';');
    Some(if base.trim().is_empty() {
        dir.to_string()
    } else {
        format!("{};{}", base, dir)
    })
}

/// Aggiunge la cartella al `Path` **utente** (`HKCU\Environment`) con le API
/// del registro, come fa `scripts/install.ps1` ma senza PowerShell. Non si
/// usa `setx`: troncherebbe il valore oltre 1024 caratteri, cioe' distruggerebbe
/// il PATH dell'utente. Il tipo del valore (`REG_EXPAND_SZ` di solito) si
/// conserva, altrimenti le voci con `%USERPROFILE%` smetterebbero di espandersi.
#[cfg(target_os = "windows")]
fn ensure_user_path_contains(dir: &Path) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let subkey = wide("Environment");
    let name = wide("Path");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: puntatori a buffer locali vivi per tutta la chiamata.
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_QUERY_VALUE | KEY_SET_VALUE,
            &mut key,
        )
    };
    if status != ERROR_SUCCESS {
        eprintln!("[Setup] Avviso: HKCU\\Environment non apribile: errore {}", status);
        return Ok(false);
    }

    let result = (|| {
        let mut kind: REG_VALUE_TYPE = 0;
        let mut size: u32 = 0;
        // SAFETY: prima chiamata con buffer nullo per conoscere la dimensione.
        let status = unsafe {
            RegQueryValueExW(key, name.as_ptr(), std::ptr::null(), &mut kind, std::ptr::null_mut(), &mut size)
        };
        let current = if status == ERROR_FILE_NOT_FOUND {
            kind = REG_EXPAND_SZ;
            String::new()
        } else if status != ERROR_SUCCESS {
            return Err(format!("lettura Path: errore {}", status));
        } else if kind != REG_SZ && kind != REG_EXPAND_SZ {
            // Un Path di tipo inatteso non e' nostro da riscrivere.
            return Err(format!("Path di tipo {} inatteso", kind));
        } else {
            let mut buf = vec![0u16; (size as usize).div_ceil(2) + 1];
            let mut bytes = (buf.len() * 2) as u32;
            // SAFETY: `buf` ha almeno `bytes` byte scrivibili.
            let status = unsafe {
                RegQueryValueExW(key, name.as_ptr(), std::ptr::null(), &mut kind, buf.as_mut_ptr().cast(), &mut bytes)
            };
            if status != ERROR_SUCCESS {
                return Err(format!("lettura Path: errore {}", status));
            }
            let len = buf.iter().position(|unit| *unit == 0).unwrap_or(buf.len());
            String::from_utf16_lossy(&buf[..len])
        };

        let Some(joined) = path_with_dir(&current, &dir.to_string_lossy()) else {
            return Ok(false);
        };
        let value = wide(&joined);
        // SAFETY: `value` e' un buffer UTF-16 terminato da zero.
        let status = unsafe {
            RegSetValueExW(key, name.as_ptr(), 0, kind, value.as_ptr().cast(), (value.len() * 2) as u32)
        };
        if status != ERROR_SUCCESS {
            return Err(format!("scrittura Path: errore {}", status));
        }
        Ok(true)
    })();
    // SAFETY: `key` e' stata aperta sopra con successo.
    unsafe { RegCloseKey(key) };

    match result {
        Ok(true) => {
            // Come `SetEnvironmentVariable(..., 'User')`: senza l'avviso Explorer
            // e i terminali aperti dopo non vedrebbero il nuovo PATH fino al logout.
            let area = wide("Environment");
            let mut ignored = 0usize;
            // SAFETY: `area` resta viva per la durata della chiamata sincrona.
            unsafe {
                SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    0,
                    area.as_ptr() as isize,
                    SMTO_ABORTIFHUNG,
                    5000,
                    &mut ignored,
                )
            };
            Ok(true)
        }
        Ok(false) => Ok(false),
        Err(error) => {
            eprintln!("[Setup] Avviso: aggiornamento PATH utente non riuscito: {}", error);
            Ok(false)
        }
    }
}

/// Delimitatori del blocco che Studio si riserva dentro i profili di shell.
/// Servono a essere idempotenti senza rileggere righe che non sono nostre.
#[cfg(unix)]
const PATH_BLOCK_START: &str = "# >>> omp studio (PATH) >>>";
#[cfg(unix)]
const PATH_BLOCK_END: &str = "# <<< omp studio (PATH) <<<";

/// Riga `export` con il percorso citato per una shell POSIX: senza escape un
/// `$`, un backtick o una virgoletta nel percorso diventerebbe codice.
#[cfg(unix)]
fn posix_path_export(dir: &Path) -> String {
    let quoted = dir
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`");
    format!("export PATH=\"{}:$PATH\"", quoted)
}

/// Profili da aggiornare: quello della shell di login corrente (anche se non
/// esiste ancora, perche' e' quello che l'utente usera') e gli altri solo se
/// esistono gia'. Creare profili che nessuno legge sarebbe rumore.
#[cfg(unix)]
fn shell_profiles_to_update(home: &Path, shell: Option<&str>) -> Vec<PathBuf> {
    let mut profiles: Vec<PathBuf> = Vec::new();

    if let Some(shell) = shell {
        profiles.push(if shell.contains("zsh") {
            home.join(".zprofile")
        } else if shell.contains("bash") {
            home.join(".bash_profile")
        } else {
            home.join(".profile")
        });
    }

    for name in [".zprofile", ".bash_profile", ".profile"] {
        let path = home.join(name);
        if path.is_file() && !profiles.contains(&path) {
            profiles.push(path);
        }
    }

    profiles
}

/// Aggiunge in coda al profilo un blocco delimitato con l'export del PATH.
/// Nessuna riga esistente viene toccata e la scrittura e' atomica: un profilo
/// di shell troncato a meta' lascerebbe l'utente senza ambiente.
#[cfg(unix)]
fn ensure_profile_exports(profile: &Path, dir: &Path) -> Result<bool, String> {
    let existing = match std::fs::read_to_string(profile) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(crate::tr!(
                format!("Lettura di {}: {}", profile.display(), error),
                format!("Reading {}: {}", profile.display(), error)
            ))
        }
    };
    if existing.contains(PATH_BLOCK_START) {
        return Ok(false);
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(PATH_BLOCK_START);
    next.push('\n');
    next.push_str(&posix_path_export(dir));
    next.push('\n');
    next.push_str(PATH_BLOCK_END);
    next.push('\n');

    if let Some(parent) = profile.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            crate::tr!(
                format!("Cartella di {}: {}", profile.display(), error),
                format!("Folder of {}: {}", profile.display(), error)
            )
        })?;
    }
    crate::fs_atomic::atomic_write(profile, next.as_bytes())?;
    Ok(true)
}

/// Su Unix il PATH vive nei profili di shell: senza questo blocco `omp`
/// resterebbe invisibile nei terminali esterni, pur essendo installato.
#[cfg(not(target_os = "windows"))]
fn ensure_user_path_contains(dir: &Path) -> Result<bool, String> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Ok(false);
    };
    let shell = std::env::var("SHELL").ok();

    let mut changed = false;
    for profile in shell_profiles_to_update(&home, shell.as_deref()) {
        match ensure_profile_exports(&profile, dir) {
            Ok(true) => changed = true,
            Ok(false) => {}
            Err(error) => eprintln!(
                "[Setup] Avviso: PATH non aggiornato in {}: {}",
                profile.display(),
                error
            ),
        }
    }
    Ok(changed)
}

/// Percorsi tipici di una bash su Windows, nell'ordine usato dallo script
/// ufficiale (Git for Windows prima di tutto).
fn find_bash() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let git_bash = PathBuf::from(r"C:\Program Files\Git\bin\bash.exe");
        if git_bash.exists() {
            return Some(git_bash);
        }
        which_on_path("bash.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Scrive `shellPath` **solo se la chiave manca**, dove `omp` la legge:
///
/// - in `config.yml` (o `config.yaml`) quando esiste: da li' in poi `omp`
///   ignora `settings.json`, e una chiave scritta solo li' resterebbe lettera
///   morta per chi aveva gia' configurato `omp`;
/// - in `settings.json` quando nessun YAML esiste ancora: al primo avvio `omp`
///   lo migra in `config.yml` insieme alle eventuali impostazioni legacy.
///   Creare noi il YAML salterebbe quella migrazione.
///
/// Replica `Configure-BashShell` di `scripts/install.ps1`: senza la chiave,
/// servizi, terminali e comandi `!` di `omp` non hanno una shell POSIX (Gate R11).
fn ensure_shell_path_in(agent: &Path, bash: Option<PathBuf>) -> Result<Option<String>, String> {
    let Some(bash) = bash else {
        return Ok(None);
    };
    let bash_str = bash.to_string_lossy().to_string();

    if let Some(config) = config_yml_path_in(agent) {
        let written =
            crate::models_ops::insert_config_string_if_absent(&config, "shellPath", &bash_str)?;
        return Ok(written.then_some(bash_str));
    }

    let path = agent.join("settings.json");
    let mut root = match std::fs::read_to_string(&path) {
        Ok(text) => {
            // Un file che non si legge come oggetto JSON non e' nostro: si
            // lascia com'e' invece di sostituirlo con un oggetto vuoto. Il BOM
            // di un file salvato da Windows non e' un motivo per scartarlo.
            match serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')) {
                Ok(value) if value.is_object() => value,
                _ => return Ok(None),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            serde_json::Value::Object(serde_json::Map::new())
        }
        Err(error) => {
            return Err(crate::tr!(
                format!("Lettura di settings.json: {}", error),
                format!("Reading settings.json: {}", error)
            ))
        }
    };
    let Some(map) = root.as_object_mut() else {
        return Ok(None);
    };
    if map
        .get("shellPath")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
    {
        return Ok(None);
    }
    map.insert(
        "shellPath".to_string(),
        serde_json::Value::String(bash_str.clone()),
    );

    std::fs::create_dir_all(agent).map_err(|e| {
        crate::tr!(
            format!("Cartella dell'agente: {}", e),
            format!("Agent folder: {}", e)
        )
    })?;
    let serialized = serde_json::to_string_pretty(&root).map_err(|e| {
        crate::tr!(
            format!("Serializzazione di settings.json: {}", e),
            format!("Serializing settings.json: {}", e)
        )
    })?;
    crate::fs_atomic::atomic_write(&path, serialized.as_bytes())?;
    Ok(Some(bash_str))
}

fn replace_verified_binary(temp_path: &Path, target: &Path) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        // `rename` sostituisce atomicamente un file esistente: un errore lascia
        // quindi intatta la versione gia' installata.
        std::fs::rename(temp_path, target).map_err(|e| {
            crate::tr!(
                format!("Installazione del binario {}: {}", target.display(), e),
                format!("Installing the binary {}: {}", target.display(), e)
            )
        })
    }

    #[cfg(target_os = "windows")]
    {
        if !target.exists() {
            return std::fs::rename(temp_path, target).map_err(|e| {
                crate::tr!(
                    format!("Installazione del binario {}: {}", target.display(), e),
                    format!("Installing the binary {}: {}", target.display(), e)
                )
            });
        }

        // Windows non consente a `rename` di sovrascrivere la destinazione.
        // Conserviamo il binario corrente finche' quello verificato non e'
        // entrato al suo posto, cosi' possiamo ripristinarlo in caso di errore.
        let file_name = target.file_name().ok_or_else(|| {
            crate::tr!(
                format!(
                    "Nome del binario di destinazione non valido: {}",
                    target.display()
                ),
                format!("Invalid destination binary name: {}", target.display())
            )
        })?;
        let backup = target.with_file_name(format!("{}.previous", file_name.to_string_lossy()));
        if backup.exists() {
            std::fs::remove_file(&backup).map_err(|e| {
                crate::tr!(
                    format!(
                        "Rimozione del backup precedente {}: {}",
                        backup.display(),
                        e
                    ),
                    format!("Removing the previous backup {}: {}", backup.display(), e)
                )
            })?;
        }
        std::fs::rename(target, &backup).map_err(|e| {
            crate::tr!(
                format!(
                    "Preparazione della sostituzione di {}: {}",
                    target.display(),
                    e
                ),
                format!("Preparing the replacement of {}: {}", target.display(), e)
            )
        })?;
        if let Err(install_error) = std::fs::rename(temp_path, target) {
            return match std::fs::rename(&backup, target) {
                Ok(()) => Err(crate::tr!(
                    format!(
                        "Installazione del binario {}: {}",
                        target.display(),
                        install_error
                    ),
                    format!(
                        "Installing the binary {}: {}",
                        target.display(),
                        install_error
                    )
                )),
                Err(restore_error) => Err(crate::tr!(
                    format!(
                        "Installazione del binario {}: {}; ripristino del binario precedente non riuscito: {}",
                        target.display(),
                        install_error,
                        restore_error
                    ),
                    format!(
                        "Installing the binary {}: {}; restoring the previous binary failed: {}",
                        target.display(),
                        install_error,
                        restore_error
                    )
                )),
            };
        }
        if let Err(error) = std::fs::remove_file(&backup) {
            eprintln!(
                "[Setup] Avviso: rimozione del backup {} non riuscita: {}",
                backup.display(),
                error
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub version: String,
    pub path: String,
    pub tag: String,
    pub path_updated: bool,
    pub shell_path: Option<String>,
    /// La sostituzione avviene solo dopo una verifica SHA-256 riuscita.
    pub checksum_verified: bool,
}

/// Scarica e installa `omp` replicando il ramo `-Binary` di
/// `scripts/install.ps1`, con progresso, verifica dell'hash e nessuno script
/// remoto eseguito.
#[command]
pub async fn install_omp(app: AppHandle) -> Result<InstallOutcome, String> {
    let result = install_omp_inner(&app).await;
    if let Err(error) = &result {
        let diagnostic = crate::tr!(
            format!(
                "Errore durante l'installazione di omp su {} {}: {}",
                std::env::consts::OS,
                std::env::consts::ARCH,
                error
            ),
            format!(
                "Error while installing omp on {} {}: {}",
                std::env::consts::OS,
                std::env::consts::ARCH,
                error
            )
        );
        let _ = app.emit(
            INSTALL_EVENT,
            InstallProgress::failed_with_diag(error.clone(), diagnostic, true),
        );
    }
    result
}

async fn install_omp_inner(app: &AppHandle) -> Result<InstallOutcome, String> {
    let asset_name = release_asset_name().ok_or_else(|| {
        crate::tr!(
            format!(
                "Nessun binario di omp pubblicato per {} {}",
                std::env::consts::OS,
                std::env::consts::ARCH
            ),
            format!(
                "No omp binary published for {} {}",
                std::env::consts::OS,
                std::env::consts::ARCH
            )
        )
    })?;
    let target = installed_binary_path().ok_or_else(|| {
        crate::tr!(
            "Impossibile risolvere la cartella di installazione",
            "Could not resolve the installation folder"
        )
        .to_string()
    })?;
    let dir = target
        .parent()
        .ok_or_else(|| {
            crate::tr!(
                "Cartella di installazione non valida",
                "Invalid installation folder"
            )
            .to_string()
        })?
        .to_path_buf();

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage(
            "resolving",
            crate::tr!(
                "Cerco l'ultima release di omp",
                "Looking for the latest omp release"
            ),
        ),
    );

    let client = github_client()?;
    let (download_url, tag_name, expected_hash) = match fetch_release_info(&client, asset_name)
        .await
    {
        Ok(info) => info,
        Err(api_error) => {
            eprintln!(
                "[Setup] GitHub API fallita ({}), tento il download diretto dal tag latest...",
                api_error
            );
            let fallback_url = format!(
                "https://github.com/{}/releases/latest/download/{}",
                OMP_REPO, asset_name
            );
            let sums_url = format!(
                "https://github.com/{}/releases/latest/download/SHA256SUMS.txt",
                OMP_REPO
            );
            let expected = fetch_hash_from_url(&client, &sums_url, asset_name)
                    .await
                    .map_err(|checksum_error| {
                        crate::tr!(
                            format!(
                                "Impossibile risolvere un'impronta SHA-256 attendibile: API GitHub: {}; checksum della release: {}",
                                api_error, checksum_error
                            ),
                            format!(
                                "Could not resolve a trusted SHA-256 digest: GitHub API: {}; release checksum: {}",
                                api_error, checksum_error
                            )
                        )
                    })?;
            (fallback_url, "latest".to_string(), expected)
        }
    };

    // Si scarica in un file temporaneo accanto alla destinazione: se il
    // download si interrompe, l'eventuale binario esistente non viene corrotto.
    std::fs::create_dir_all(&dir).map_err(|e| {
        crate::tr!(
            format!(
                "Creazione cartella di installazione {}: {}",
                dir.display(),
                e
            ),
            format!(
                "Creating the installation folder {}: {}",
                dir.display(),
                e
            )
        )
    })?;
    let temp_path = dir.join(format!("{}.download", asset_name));
    if temp_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
    }

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage(
            "downloading",
            crate::tr!("Avvio del download di omp", "Starting the omp download"),
        ),
    );

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Connessione per il download non riuscita: {}", e),
                format!("Connection for the download failed: {}", e)
            )
        })?
        .error_for_status()
        .map_err(|e| {
            crate::tr!(
                format!("Download non disponibile dal server: {}", e),
                format!("Download not available from the server: {}", e)
            )
        })?;
    let total_bytes = response.content_length().unwrap_or(0);

    {
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
            crate::tr!(
                format!("Creazione file temporaneo {}: {}", temp_path.display(), e),
                format!("Creating the temporary file {}: {}", temp_path.display(), e)
            )
        })?;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(crate::tr!(
                        format!("Download interrotto per errore di rete: {}", e),
                        format!("Download interrupted by a network error: {}", e)
                    ));
                }
            };
            if let Err(e) = file.write_all(&chunk).await {
                let _ = std::fs::remove_file(&temp_path);
                return Err(crate::tr!(
                    format!("Scrittura del file scaricato su disco: {}", e),
                    format!("Writing the downloaded file to disk: {}", e)
                ));
            }
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= std::time::Duration::from_millis(100) {
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    INSTALL_EVENT,
                    InstallProgress {
                        status: "downloading".to_string(),
                        downloaded_bytes: downloaded,
                        total_bytes,
                        percentage: if total_bytes > 0 {
                            (downloaded as f64 / total_bytes as f64) * 100.0
                        } else {
                            0.0
                        },
                        message: Some(
                            crate::tr!("Download di omp in corso", "omp download in progress")
                                .to_string(),
                        ),
                        error: None,
                        diagnostic: None,
                        retryable: false,
                    },
                );
            }
        }
        if let Err(e) = file.flush().await {
            let _ = std::fs::remove_file(&temp_path);
            return Err(crate::tr!(
                format!("Chiusura del file scaricato: {}", e),
                format!("Closing the downloaded file: {}", e)
            ));
        }
    }

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage(
            "verifying",
            crate::tr!(
                "Verifico l'impronta di sicurezza SHA-256",
                "Verifying the SHA-256 security digest"
            ),
        ),
    );
    if let Err(error) = verify_file_sha256(&temp_path, &expected_hash) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress::stage(
            "installing",
            crate::tr!("Installazione del binario", "Installing the binary"),
        ),
    );

    if let Err(error) = replace_verified_binary(&temp_path, &target) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }

    // Riprova l'esecuzione fino a 4 volte con backoff per consentire
    // l'eventuale scansione iniziale dell'antivirus.
    // Invalida la cache perche' il binario sul disco e' stato appena rimpiazzato
    crate::omp_ops::invalidate_cached_omp_version();
    let mut detected_version = None;
    for attempt in 0..4 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(250 * attempt)).await;
        }
        if let Some(v) = read_omp_version(&target) {
            detected_version = Some(v);
            break;
        }
    }

    let version = detected_version.ok_or_else(|| {
        crate::tr!(
            format!(
                "Il binario e' stato scritto in {} ma non risponde a 'omp --version'. Verifica che l'antivirus non stia bloccando il file.",
                target.display()
            ),
            format!(
                "The binary was written to {} but does not answer to 'omp --version'. Check that the antivirus is not blocking the file.",
                target.display()
            )
        )
    })?;

    // PATH e impostazioni vengono aggiornati soltanto dopo che il binario
    // sostituito ha risposto correttamente.
    let path_updated = ensure_user_path_contains(&dir).unwrap_or(false);
    let shell_path = crate::omp_ops::agent_dir()
        .and_then(|agent| ensure_shell_path_in(&agent, find_bash()).ok().flatten());

    let outcome = InstallOutcome {
        version,
        path: target.to_string_lossy().to_string(),
        tag: tag_name,
        path_updated,
        shell_path,
        checksum_verified: true,
    };

    let _ = app.emit(
        INSTALL_EVENT,
        InstallProgress {
            status: "done".to_string(),
            downloaded_bytes: total_bytes,
            total_bytes,
            percentage: 100.0,
            message: Some(crate::tr!(
                format!("omp {} installato con successo", outcome.version),
                format!("omp {} installed successfully", outcome.version)
            )),
            error: None,
            diagnostic: None,
            retryable: false,
        },
    );
    Ok(outcome)
}

async fn fetch_release_info(
    client: &reqwest::Client,
    asset_name: &str,
) -> Result<(String, String, String), String> {
    let release: Release = client
        .get(format!(
            "https://api.github.com/repos/{}/releases/latest",
            OMP_REPO
        ))
        .send()
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Connessione a GitHub: {}", e),
                format!("Connection to GitHub: {}", e)
            )
        })?
        .error_for_status()
        .map_err(|e| {
            crate::tr!(
                format!("Status release GitHub: {}", e),
                format!("GitHub release status: {}", e)
            )
        })?
        .json()
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Risposta JSON della release non valida: {}", e),
                format!("Invalid release JSON response: {}", e)
            )
        })?;

    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| {
            crate::tr!(
                format!(
                    "La release {} non contiene l'asset {}",
                    release.tag_name, asset_name
                ),
                format!(
                    "Release {} does not contain the asset {}",
                    release.tag_name, asset_name
                )
            )
        })?;

    let checksum_hash = if asset
        .digest
        .as_deref()
        .and_then(parse_asset_digest)
        .is_some()
    {
        None
    } else {
        Some(fetch_expected_hash(client, &release, asset_name).await?)
    };
    let expected_hash = resolve_expected_hash(asset.digest.as_deref(), checksum_hash.as_deref())?;
    Ok((
        asset.browser_download_url.clone(),
        release.tag_name,
        expected_hash,
    ))
}

async fn fetch_hash_from_url(
    client: &reqwest::Client,
    url: &str,
    asset_name: &str,
) -> Result<String, String> {
    let text = client
        .get(url)
        .send()
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Connessione al file checksum: {}", e),
                format!("Connection to the checksum file: {}", e)
            )
        })?
        .error_for_status()
        .map_err(|e| {
            crate::tr!(
                format!("File checksum non disponibile: {}", e),
                format!("Checksum file not available: {}", e)
            )
        })?
        .text()
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Lettura del file checksum: {}", e),
                format!("Reading the checksum file: {}", e)
            )
        })?;
    parse_checksums(&text, asset_name).ok_or_else(|| {
        crate::tr!(
            format!(
                "Il file checksum non contiene uno SHA-256 valido per {}",
                asset_name
            ),
            format!(
                "The checksum file does not contain a valid SHA-256 for {}",
                asset_name
            )
        )
    })
}

fn parse_checksums(text: &str, asset_name: &str) -> Option<String> {
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else {
            continue;
        };
        let Some(name) = parts.next() else {
            continue;
        };
        if name.trim_start_matches('*') == asset_name {
            if let Some(hash) = normalize_sha256(hash) {
                return Some(hash);
            }
        }
    }
    None
}

async fn fetch_expected_hash(
    client: &reqwest::Client,
    release: &Release,
    asset_name: &str,
) -> Result<String, String> {
    let sums = release
        .assets
        .iter()
        .find(|asset| asset.name == "SHA256SUMS.txt")
        .ok_or_else(|| {
            crate::tr!(
                "La release non pubblica SHA256SUMS.txt",
                "The release does not publish SHA256SUMS.txt"
            )
            .to_string()
        })?;
    fetch_hash_from_url(client, &sums.browser_download_url, asset_name).await
}

// -----------------------------------------------------------------------------
// Font Nerd per-utente
// -----------------------------------------------------------------------------

/// Cartella dei font dell'utente, per piattaforma:
/// - Windows: `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, per-utente e senza
///   privilegi di amministratore (da Windows 10 1809);
/// - macOS: `~/Library/Fonts`, la cartella che il sistema attiva da solo;
/// - altrove: `~/.local/share/fonts`, la convenzione fontconfig.
fn nerd_font_target() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(
            PathBuf::from(local)
                .join("Microsoft")
                .join("Windows")
                .join("Fonts")
                .join(NERD_FONT_FILE),
        )
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Fonts")
                .join(NERD_FONT_FILE),
        )
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("fonts")
                .join(NERD_FONT_FILE),
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInstallOutcome {
    pub family: String,
    pub path: String,
    /// `false` quando il font era gia' installato: l'operazione e' idempotente.
    pub installed: bool,
    /// `true` quando il font e' anche registrato per la sessione corrente.
    /// Con `false` i terminali gia' aperti lo vedranno al prossimo avvio.
    pub registered: bool,
}

/// Installa il font Nerd per l'utente corrente, senza chiedere e senza
/// amministratore. Non serve a Studio (il terminale usa il `@font-face`
/// bundlato): serve a `omp` lanciato in un terminale esterno, dove
/// `symbolPreset` scelto nel wizard disegnerebbe tofu.
#[command]
pub async fn install_nerd_font() -> Result<FontInstallOutcome, String> {
    tokio::task::spawn_blocking(|| {
        let target = nerd_font_target().ok_or_else(|| {
            crate::tr!(
                "Impossibile risolvere la cartella dei font",
                "Could not resolve the font folder"
            )
            .to_string()
        })?;
        let dir = target.parent().ok_or_else(|| {
            crate::tr!("Percorso del font non valido", "Invalid font path").to_string()
        })?;
        std::fs::create_dir_all(dir).map_err(|e| {
            crate::tr!(
                format!("Cartella dei font: {}", e),
                format!("Font folder: {}", e)
            )
        })?;

        let already = target.exists()
            && std::fs::metadata(&target)
                .map(|m| m.len() == NERD_FONT_TTF.len() as u64)
                .unwrap_or(false);
        if !already {
            std::fs::write(&target, NERD_FONT_TTF).map_err(|e| {
                crate::tr!(
                    format!("Copia del font: {}", e),
                    format!("Copying the font: {}", e)
                )
            })?;
        }

        let registered = register_font(&target);
        Ok(FontInstallOutcome {
            family: NERD_FONT_NAME.to_string(),
            path: target.to_string_lossy().to_string(),
            installed: !already,
            registered,
        })
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Installazione del font: {}", e),
            format!("Installing the font: {}", e)
        )
    })?
}

/// Registra il font nel ramo utente del registro e lo carica nella sessione
/// corrente. Il valore per-utente richiede il **percorso assoluto**; quello
/// per-macchina si accontenta del nome file.
#[cfg(target_os = "windows")]
fn register_font(path: &Path) -> bool {
    let value_name = format!("{} (TrueType)", NERD_FONT_NAME);
    let mut reg = Command::new("reg.exe");
    reg.args([
        "add",
        r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts",
        "/v",
        &value_name,
        "/t",
        "REG_SZ",
        "/d",
        &path.to_string_lossy(),
        "/f",
    ]);
    reg.creation_flags(CREATE_NO_WINDOW);
    let registered = reg.output().map(|o| o.status.success()).unwrap_or(false);
    if !registered {
        return false;
    }

    // `AddFontResourceW` rende il font disponibile subito; `WM_FONTCHANGE`
    // avvisa le finestre esistenti. Best effort: se fallisce, il font c'e'
    // comunque al prossimo avvio dei processi.
    use windows_sys::Win32::Graphics::Gdi::AddFontResourceW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
    };
    let font = wide(&path.to_string_lossy());
    let mut ignored = 0usize;
    // SAFETY: `font` e' UTF-16 terminato da zero e vive per tutta la chiamata.
    unsafe {
        AddFontResourceW(font.as_ptr());
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            1000,
            &mut ignored,
        );
    }
    true
}

/// Su macOS non c'e' niente da registrare: il sistema attiva da solo i font
/// dentro `~/Library/Fonts` per i processi avviati dopo la copia. Diciamo
/// "registrato" solo se il file e' davvero dove serve.
#[cfg(target_os = "macos")]
fn register_font(path: &Path) -> bool {
    path.is_file()
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn register_font(_path: &Path) -> bool {
    // Su Linux serve fontconfig: la cartella dell'utente piu' `fc-cache`.
    Command::new("fc-cache")
        .arg("-f")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// -----------------------------------------------------------------------------
// Cartella dei progetti
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRootCandidate {
    pub path: String,
    /// Sottocartelle di primo livello che contengono `.git`.
    pub repo_count: usize,
    pub exists: bool,
}

/// Cartelle in cui si tengono di solito i repository, nell'ordine in cui le
/// proponiamo a parita' di conteggio.
const ROOT_CANDIDATES: [&str; 7] = [
    "source/repos",
    "dev",
    "projects",
    "code",
    "git",
    "repos",
    "Documents/GitHub",
];

fn count_repos(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && entry.path().join(".git").exists()
        })
        .count()
}

/// Propone la cartella dei progetti guardando dove stanno davvero i
/// repository, invece di chiedere un percorso in astratto. Ordinata per
/// numero di repository, poi per ordine dei candidati.
#[command]
pub async fn detect_project_roots() -> Result<Vec<ProjectRootCandidate>, String> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| {
                crate::tr!(
                    "Impossibile risolvere la cartella utente",
                    "Could not resolve the user folder"
                )
                .to_string()
            })?;
        let home = PathBuf::from(home);

        let mut found: Vec<ProjectRootCandidate> = ROOT_CANDIDATES
            .iter()
            .map(|rel| {
                let path = rel
                    .split('/')
                    .fold(home.clone(), |acc, part| acc.join(part));
                let exists = path.is_dir();
                ProjectRootCandidate {
                    repo_count: if exists { count_repos(&path) } else { 0 },
                    path: path.to_string_lossy().to_string(),
                    exists,
                }
            })
            .filter(|candidate| candidate.exists)
            .collect();

        // Ordine stabile: piu' repository prima, e a parita' l'ordine dei
        // candidati (che e' quello in cui `sort_by` li trova).
        found.sort_by_key(|b| std::cmp::Reverse(b.repo_count));
        Ok(found)
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Rilevamento delle cartelle progetto: {}", e),
            format!("Detecting the project folders: {}", e)
        )
    })?
}

// -----------------------------------------------------------------------------
// Scritture di configurazione dei passi del setup grafico
// -----------------------------------------------------------------------------

/// Le sole chiavi di `config.yml` che il setup grafico scrive. Tutte opzionali:
/// il guscio manda solo i passi che l'utente ha davvero confermato.
///
/// I ruoli modello non passano da qui: li scrive `save_model_config` dal passo
/// Ruoli, che conosce i fallback e i ruoli che il setup non tocca.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupConfigPatch {
    /// Passo Aspetto: `theme.dark`.
    pub theme_dark: Option<String>,
    /// Passo Aspetto: `theme.light`.
    pub theme_light: Option<String>,
    /// Passo Aspetto: `colorBlindMode`.
    pub color_blind_mode: Option<bool>,
    /// Passo Aggiornamenti: `update.auto`.
    pub update_auto: Option<bool>,
    /// Riepilogo: `true` scrive `setupVersion: CURRENT_SETUP_VERSION`, la
    /// stessa soglia che Studio legge per considerare fatto il setup.
    pub mark_complete: Option<bool>,
}

/// Sotto-chiave annidata di `config.yml`: `theme` esiste gia' come dizionario
/// con altre voci (il tema scelto dalla TUI, `theme.light`, ...) e va fuso,
/// non sostituito.
fn set_nested(doc: &mut serde_yaml::Mapping, section: &str, key: &str, value: serde_yaml::Value) {
    let section_key = serde_yaml::Value::String(section.to_string());
    let mut sub = match doc.get(&section_key) {
        // Una `theme: "titanium"` scritta a mano (o da una versione vecchia di
        // `omp`) e' un valore che conosciamo: `omp` la migra in `theme.dark`,
        // quindi la trattiamo come tale invece di scartare la sezione.
        Some(serde_yaml::Value::String(theme)) if section == "theme" => {
            let mut migrated = serde_yaml::Mapping::new();
            migrated.insert(
                serde_yaml::Value::String("dark".to_string()),
                serde_yaml::Value::String(theme.clone()),
            );
            migrated
        }
        Some(serde_yaml::Value::Mapping(existing)) => existing.clone(),
        _ => serde_yaml::Mapping::new(),
    };
    sub.insert(
        serde_yaml::Value::String(key.to_string()),
        value,
    );
    doc.insert(section_key, serde_yaml::Value::Mapping(sub));
}

/// Applica la patch al dizionario, toccando solo le chiavi presenti nella patch.
fn merge_setup_patch(doc: &mut serde_yaml::Mapping, patch: &SetupConfigPatch) {
    if let Some(theme) = patch.theme_dark.as_deref().filter(|t| !t.trim().is_empty()) {
        set_nested(doc, "theme", "dark", serde_yaml::Value::String(theme.to_string()));
    }
    if let Some(theme) = patch.theme_light.as_deref().filter(|t| !t.trim().is_empty()) {
        set_nested(doc, "theme", "light", serde_yaml::Value::String(theme.to_string()));
    }
    if let Some(enabled) = patch.color_blind_mode {
        doc.insert(
            serde_yaml::Value::String("colorBlindMode".to_string()),
            serde_yaml::Value::Bool(enabled),
        );
    }
    if let Some(auto) = patch.update_auto {
        set_nested(doc, "update", "auto", serde_yaml::Value::Bool(auto));
    }
    if patch.mark_complete == Some(true) {
        doc.insert(
            serde_yaml::Value::String("setupVersion".to_string()),
            serde_yaml::Value::Number(CURRENT_SETUP_VERSION.into()),
        );
    }
}

/// Corpo di `setup_apply_config` con l'agente esplicito: i test lo puntano a
/// una cartella temporanea.
fn apply_config_in(agent: &Path, patch: &SetupConfigPatch) -> Result<(), String> {
    // `omp` legge `settings.json` **solo** per migrarlo quando nessun YAML
    // esiste (docs/DECISIONS.md, revisione 2026-11-11): scriverlo quando il
    // YAML c'e' gia' sarebbe una chiave inerte. Qui pero' il file va creato
    // quando manca — questi passi valgono anche su una macchina dove `omp` non
    // ha ancora scritto niente — e crearlo salterebbe quella migrazione,
    // lasciando le vecchie impostazioni in un file che nessuno legge piu'.
    // Percio' il nuovo YAML parte dal contenuto di `settings.json`: la stessa
    // fusione che farebbe `omp`, fatta da noi prima di aggiungere le chiavi.
    let (path, base) = match config_yml_path_in(agent) {
        Some(existing) => (existing, None),
        None => (
            agent.join("config.yml"),
            legacy_settings_mapping(agent),
        ),
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            crate::tr!(
                format!("Cartella di {}: {}", path.display(), error),
                format!("Folder of {}: {}", path.display(), error)
            )
        })?;
    }
    crate::models_ops::mutate_config_mapping(&path, base, |doc| merge_setup_patch(doc, patch))
}

/// Le chiavi di un `settings.json` legacy, pronte come punto di partenza del
/// `config.yml` che stiamo per creare. Un file illeggibile o non-oggetto non
/// blocca niente: si parte da un dizionario vuoto, come farebbe `omp`
/// («ignoring non-object legacy settings.json»).
fn legacy_settings_mapping(agent: &Path) -> Option<serde_yaml::Mapping> {
    let text = std::fs::read_to_string(agent.join("settings.json")).ok()?;
    let value: serde_json::Value =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let object = value.as_object()?;
    if object.is_empty() {
        return None;
    }
    // Valori JSON -> YAML uno per uno: `serde_yaml::to_value` su un oggetto
    // intero passerebbe per le stringhe, perdendo i booleani e i numeri che
    // `omp` legge come tali.
    let mut mapping = serde_yaml::Mapping::new();
    for (key, value) in object {
        if let Ok(converted) = serde_yaml::to_value(value) {
            mapping.insert(serde_yaml::Value::String(key.clone()), converted);
        }
    }
    (!mapping.is_empty()).then_some(mapping)
}

/// Scrive nel `config.yml` di `omp` solo le chiavi dei passi che il setup
/// grafico copre, in merge e sotto lo stesso lock delle altre scritture di
/// Studio. Nessun'altra chiave viene toccata.
#[command]
pub async fn setup_apply_config(patch: SetupConfigPatch) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let agent = crate::omp_ops::agent_dir().ok_or_else(|| {
            crate::tr!(
                "Impossibile trovare la cartella di configurazione di omp",
                "Could not find the omp configuration folder"
            )
            .to_string()
        })?;
        apply_config_in(&agent, &patch)
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Scrittura della configurazione: {}", e),
            format!("Writing the configuration: {}", e)
        )
    })?
}

// -----------------------------------------------------------------------------
// Strumenti presenti sulla macchina (passo Progetti)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedTools {
    pub claude_code: bool,
    pub codex_cli: bool,
    pub ollama: bool,
}

/// Cartelle di configurazione note: sono la prova che lo strumento e' stato
/// usato almeno una volta, piu' affidabile del solo PATH (Claude Code si
/// installa come app, Codex come npm globale).
///
/// `has_binary` e' un parametro invece di una chiamata diretta al `PATH`:
/// l'ambiente della macchina di sviluppo non deve poter decidere l'esito dei
/// test (qui `claude` c'e' davvero).
fn detect_tools_with(
    home: Option<&Path>,
    has_binary: impl Fn(&str) -> bool,
) -> DetectedTools {
    let home_dir = |name: &str| home.map(|h| h.join(name)).is_some_and(|d| d.is_dir());

    DetectedTools {
        claude_code: has_binary("claude") || home_dir(".claude"),
        codex_cli: has_binary("codex") || home_dir(".codex"),
        ollama: has_binary("ollama")
            || home_dir(".ollama")
            // Su macOS Ollama si installa come applicazione e il demone vive
            // li', senza niente in `PATH`: l'utente l'ha comunque installato.
            || (cfg!(target_os = "macos") && Path::new("/Applications/Ollama.app").exists()),
    }
}

fn detect_tools_in(home: Option<&Path>) -> DetectedTools {
    detect_tools_with(home, |name| which_on_path(name).is_some())
}

/// Rileva gli strumenti esterni senza avviare processi: un `which` per volta
/// costerebbe fino a 250 ms su Windows con l'antivirus attivo (vedi
/// `path_lookup`), e questo comando gira mentre il passo si apre.
#[command]
pub async fn setup_detect_tools() -> Result<DetectedTools, String> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from);
        Ok(detect_tools_in(home.as_deref()))
    })
    .await
    .map_err(|e| {
        crate::tr!(
            format!("Rilevamento degli strumenti: {}", e),
            format!("Detecting tools: {}", e)
        )
    })?
}

// -----------------------------------------------------------------------------
// Avanzamento del setup (ripresa dopo una chiusura, SET-041)
// -----------------------------------------------------------------------------

/// Dove si era fermato il setup. Vive nella cartella dati di Studio, non in
/// `~/.omp`: e' stato dell'interfaccia, non configurazione di `omp`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    /// Passo su cui riaprire il setup (id del passo del guscio).
    pub step: String,
    /// Passi gia' confermati.
    pub done: Vec<String>,
    /// `true` quando l'utente ha premuto «Entra in Studio».
    pub completed: bool,
    /// Millisecondi dall'epoca: serve solo a ordinare e a mostrare "ripreso".
    pub updated_at: i64,
}

const SETUP_PROGRESS_FILE: &str = "setup-progress.json";

fn setup_progress_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SETUP_PROGRESS_FILE))
        .map_err(|error| {
            crate::tr!(
                format!("Cartella dati di Studio non disponibile: {error}"),
                format!("Studio data folder unavailable: {error}")
            )
        })
}

fn read_progress(path: &Path) -> Result<Option<SetupProgress>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(crate::tr!(
                format!("Lettura {}: {error}", path.display()),
                format!("Reading {}: {error}", path.display())
            ))
        }
    };
    // Un file illeggibile non deve impedire di riaprire il setup: si riparte
    // dal primo passo, che e' esattamente il comportamento senza file.
    Ok(serde_json::from_slice(&bytes).ok())
}

fn write_progress(path: &Path, progress: &SetupProgress) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            crate::tr!(
                format!("Cartella di {}: {error}", path.display()),
                format!("Folder of {}: {error}", path.display())
            )
        })?;
    }
    let serialized = serde_json::to_vec_pretty(progress).map_err(|error| {
        crate::tr!(
            format!("Serializzazione dell'avanzamento: {error}"),
            format!("Serializing progress: {error}")
        )
    })?;
    crate::fs_atomic::atomic_write(path, &serialized)
}

#[command]
pub async fn setup_progress_get(app: AppHandle) -> Result<Option<SetupProgress>, String> {
    let path = setup_progress_path(&app)?;
    tokio::task::spawn_blocking(move || read_progress(&path))
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Lettura dell'avanzamento: {}", e),
                format!("Reading progress: {}", e)
            )
        })?
}

#[command]
pub async fn setup_progress_set(app: AppHandle, progress: SetupProgress) -> Result<(), String> {
    let path = setup_progress_path(&app)?;
    tokio::task::spawn_blocking(move || write_progress(&path, &progress))
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Scrittura dell'avanzamento: {}", e),
                format!("Writing progress: {}", e)
            )
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_output_legge_stdout_o_stderr() {
        assert_eq!(
            parse_version_output("omp/18.0.4\n", "").as_deref(),
            Some("18.0.4")
        );
        assert_eq!(
            parse_version_output("", "v18.1.0\n").as_deref(),
            Some("18.1.0")
        );
        assert_eq!(parse_version_output(" ", " "), None);
    }

    /// Un `omp --version` che fallisce non deve diventare una versione in cache.
    #[cfg(unix)]
    #[test]
    fn read_omp_version_ignora_exit_non_zero() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "omp-studio-read-version-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("omp");
        std::fs::write(
            &fake,
            "#!/bin/sh\necho 'error: libreria mancante' >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(read_omp_version(&fake), None);
        assert_eq!(crate::omp_ops::get_cached_omp_version_for(&fake), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn asset_name_is_known_for_supported_targets() {
        // La mappa deve restare allineata ai nomi pubblicati nelle release.
        assert_eq!(
            release_asset_name_for("windows", "x86_64"),
            Some("omp-windows-x64.exe")
        );
        assert_eq!(
            release_asset_name_for("macos", "aarch64"),
            Some("omp-darwin-arm64")
        );
        assert_eq!(release_asset_name_for("freebsd", "x86_64"), None);
    }

    #[test]
    fn path_utente_aggiunge_la_cartella_una_sola_volta() {
        let dir = r"C:\Users\u\AppData\Local\omp";
        // Gia' presente con altra grafia o barra finale: nessuna riscrittura.
        assert_eq!(path_with_dir(r"C:\a;c:\users\U\appdata\local\OMP\;D:\b", dir), None);
        // Voci esistenti, variabili e ordine restano intatti.
        assert_eq!(
            path_with_dir(r"%USERPROFILE%\bin;C:\a;", dir).as_deref(),
            Some(r"%USERPROFILE%\bin;C:\a;C:\Users\u\AppData\Local\omp")
        );
        assert_eq!(path_with_dir("", dir).as_deref(), Some(dir));
    }

    #[test]
    fn versione_minima_di_omp() {
        assert!(version_below_minimum("18.18.2"));
        assert!(version_below_minimum("17.9.9"));
        assert!(!version_below_minimum(MIN_OMP_VERSION));
        assert!(!version_below_minimum("18.18.8"));
        assert!(!version_below_minimum("19.0.0"));
        // Illeggibile non vuol dire vecchia.
        assert!(!version_below_minimum("unknown"));
    }

    fn shell_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("omp-studio-shell-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn shell_path_va_in_config_yml_quando_esiste() {
        let base = shell_dir("yml");
        std::fs::write(base.join("config.yml"), "setupVersion: 3\nmodelRoles:\n  default: a/b\n").unwrap();
        // Un settings.json residuo non conta piu' per omp: non va scritto.
        std::fs::write(base.join("settings.json"), "{}").unwrap();

        let bash = PathBuf::from(r"C:\Git\bin\bash.exe");
        let written = ensure_shell_path_in(&base, Some(bash.clone())).unwrap();
        assert_eq!(written.as_deref(), Some(r"C:\Git\bin\bash.exe"));
        let facts = read_config_facts(&base);
        assert_eq!(facts.shell_path.as_deref(), Some(r"C:\Git\bin\bash.exe"));
        assert_eq!(facts.setup_version, 3);
        assert_eq!(facts.default_model.as_deref(), Some("a/b"));
        assert_eq!(std::fs::read_to_string(base.join("settings.json")).unwrap(), "{}");

        // La scelta dell'utente non si sostituisce.
        std::fs::write(base.join("config.yml"), "shellPath: D:\\mia\\bash.exe\n").unwrap();
        assert_eq!(ensure_shell_path_in(&base, Some(bash)).unwrap(), None);
        assert_eq!(read_config_facts(&base).shell_path.as_deref(), Some(r"D:\mia\bash.exe"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn senza_yaml_shell_path_va_in_settings_json_da_migrare() {
        let base = shell_dir("json");
        // BOM e chiavi dell'utente come li lascia un file salvato da Windows.
        std::fs::write(base.join("settings.json"), "\u{feff}{\"theme\": \"x\"}").unwrap();

        let bash = PathBuf::from(r"C:\Git\bin\bash.exe");
        ensure_shell_path_in(&base, Some(bash.clone())).unwrap();
        assert!(!base.join("config.yml").exists(), "il YAML lo crea omp migrando");
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(base.join("settings.json")).unwrap()).unwrap();
        assert_eq!(saved["theme"], "x");
        assert_eq!(saved["shellPath"], r"C:\Git\bin\bash.exe");
        assert_eq!(read_config_facts(&base).shell_path.as_deref(), Some(r"C:\Git\bin\bash.exe"));

        // Un file illeggibile non viene sostituito.
        std::fs::write(base.join("settings.json"), "non json").unwrap();
        assert_eq!(ensure_shell_path_in(&base, Some(bash)).unwrap(), None);
        assert_eq!(std::fs::read_to_string(base.join("settings.json")).unwrap(), "non json");
        let _ = std::fs::remove_dir_all(&base);
    }

    // --- Rilevamento dell'installazione danneggiata -------------------------

    /// Nome di cartella unico per test: piu' test in parallelo nella stessa
    /// `TMPDIR` non devono vedersi i file a vicenda.
    fn unique_dir(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "omp-studio-{}-{}-{}",
            label,
            std::process::id(),
            n
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn un_collegamento_rotto_e_un_installazione_danneggiata() {
        // Il caso reale: `~/.bun/bin/omp` -> `../../node_modules/.../cli.js`
        // dopo che l'utente ha cancellato quella cartella.
        let dir = unique_dir("broken-link");
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let link = bin.join("omp");
        std::os::unix::fs::symlink("../node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js", &link)
            .unwrap();

        let found = find_broken_candidate_in(std::slice::from_ref(&link)).expect("link rotto riconosciuto");
        assert_eq!(found, BrokenCandidate::DanglingSymlink(link.clone()));
        assert_eq!(found.path(), link.as_path());

        // Un file assente non e' "danneggiato", e' "non installato": il passo
        // Motore propone il download, non la riparazione.
        assert_eq!(find_broken_candidate_in(&[bin.join("manca")]), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Dopo una riparazione (`install_omp` scrive in `~/.omp/bin`) il vecchio
    /// `~/.bun/bin/omp` resta rotto: `ompBroken` deve comunque tornare `false`,
    /// altrimenti il passo Motore chiederebbe di riparare all'infinito.
    #[cfg(unix)]
    #[test]
    fn dopo_la_riparazione_il_link_rotto_non_conta_piu() {
        use std::os::unix::fs::PermissionsExt;
        let dir = unique_dir("repair");

        let bun_bin = dir.join("bun-bin");
        let omp_bin = dir.join("omp-bin");
        std::fs::create_dir_all(&bun_bin).unwrap();
        std::fs::create_dir_all(&omp_bin).unwrap();
        let rotto = bun_bin.join("omp");
        std::os::unix::fs::symlink("../../node_modules/pi-coding-agent/dist/cli.js", &rotto).unwrap();

        let riparato = omp_bin.join("omp");
        std::fs::write(&riparato, "#!/bin/sh\necho omp/18.18.3\n").unwrap();
        std::fs::set_permissions(&riparato, std::fs::Permissions::from_mode(0o755)).unwrap();

        // Ordine dei candidati reali: bun prima di ~/.omp/bin. Il link rotto
        // viene saltato perche' `exists` segue il collegamento.
        let candidates = vec![rotto.clone(), riparato.clone()];
        assert_eq!(
            crate::omp_ops::first_existing_candidate(&candidates),
            Some(riparato.as_path())
        );

        // Con un binario funzionante in mano la diagnosi non si fa nemmeno:
        // `status_for` la salta quando la versione e' leggibile. Qui si
        // verifica il criterio usato, senza dipendere dall'`HOME` reale.
        assert_eq!(find_broken_candidate_in(&[rotto]), Some(BrokenCandidate::DanglingSymlink(bun_bin.join("omp"))));
        assert_eq!(find_broken_candidate_in(&[riparato]), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn un_binario_che_non_risponde_e_danneggiato_e_uno_valido_no() {
        use std::os::unix::fs::PermissionsExt;
        let dir = unique_dir("not-runnable");

        let rotto = dir.join("rotto");
        std::fs::write(&rotto, "#!/bin/sh\nexit 1\n").unwrap();
        std::fs::set_permissions(&rotto, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            find_broken_candidate_in(std::slice::from_ref(&rotto)),
            Some(BrokenCandidate::NotRunnable(rotto.clone()))
        );

        // Riparazione simulata: accanto al candidato rotto compare uno che
        // funziona. La ricerca parte solo se nessuno risponde, quindi qui la
        // verifica e' che un binario valido non venga mai dichiarato rotto.
        let valido = dir.join("valido");
        std::fs::write(&valido, "#!/bin/sh\necho omp/18.18.3\n").unwrap();
        std::fs::set_permissions(&valido, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(find_broken_candidate_in(&[valido]), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- `setup_apply_config` -----------------------------------------------

    #[test]
    fn apply_config_preserva_le_chiavi_esistenti_e_scrive_solo_la_patch() {
        let base = unique_dir("apply-merge");
        let original = "\
# commento dell'utente: resta dov'e'
setupVersion: 1
modelRoles:
  default: anthropic/claude-opus-5:medium
  slow: x/y
symbolPreset: nerd
theme:
  dark: titanium
  light: light
update:
  channel: stable
";
        std::fs::write(base.join("config.yml"), original).unwrap();

        let patch = SetupConfigPatch {
            theme_dark: Some("omp-studio".into()),
            update_auto: Some(true),
            mark_complete: Some(true),
            ..Default::default()
        };
        apply_config_in(&base, &patch).unwrap();

        let text = std::fs::read_to_string(base.join("config.yml")).unwrap();
        let saved: serde_yaml::Value = serde_yaml::from_str(&text).unwrap();
        assert_eq!(saved["theme"]["dark"], "omp-studio");
        assert_eq!(saved["theme"]["light"], "light", "l'altra modalita' resta");
        assert_eq!(saved["update"]["auto"], true);
        assert_eq!(saved["update"]["channel"], "stable", "chiavi sorelle intatte");
        assert_eq!(saved["setupVersion"].as_u64(), Some(CURRENT_SETUP_VERSION));
        assert_eq!(saved["modelRoles"]["default"], "anthropic/claude-opus-5:medium");
        assert_eq!(saved["modelRoles"]["slow"], "x/y");
        assert_eq!(saved["symbolPreset"], "nerd");
        // Il writer esistente (serde_yaml) non conserva i commenti: il test lo
        // dichiara invece di far finta che li preservi. Nessuna chiave e'
        // andata persa, che e' la garanzia che il merge deve dare.
        assert!(!text.contains("commento dell'utente"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn apply_config_non_tocca_le_chiavi_non_richieste() {
        let base = unique_dir("apply-noop");
        std::fs::write(
            base.join("config.yml"),
            "setupVersion: 3\ntheme:\n  dark: titanium\ncolorBlindMode: false\n",
        )
        .unwrap();
        let before = std::fs::read_to_string(base.join("config.yml")).unwrap();

        // Patch vuota: nessuna chiave passata, nessuna scritta.
        apply_config_in(&base, &SetupConfigPatch::default()).unwrap();
        let after: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(base.join("config.yml")).unwrap()).unwrap();
        assert_eq!(after["theme"]["dark"], "titanium");
        assert_eq!(after["colorBlindMode"], false);
        assert_eq!(after["setupVersion"].as_u64(), Some(3));
        assert!(!before.is_empty());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn apply_config_crea_config_yml_da_settings_json_legacy() {
        let base = unique_dir("apply-legacy");
        // Nessun YAML: e' la macchina nuova, dove `omp` migrerebbe il legacy.
        std::fs::write(
            base.join("settings.json"),
            "\u{feff}{\"shellPath\": \"/bin/bash\", \"symbolPreset\": \"ascii\", \"colorBlindMode\": true}",
        )
        .unwrap();

        let patch = SetupConfigPatch {
            color_blind_mode: Some(false),
            update_auto: Some(false),
            ..Default::default()
        };
        apply_config_in(&base, &patch).unwrap();

        // Il file creato e' il YAML: le chiavi legacy sopravvivono e la patch
        // vince dove l'utente ha appena scelto qualcosa di diverso.
        assert!(!base.join("config.yaml").exists());
        let saved: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(base.join("config.yml")).unwrap()).unwrap();
        assert_eq!(saved["shellPath"], "/bin/bash");
        assert_eq!(saved["symbolPreset"], "ascii");
        assert_eq!(saved["colorBlindMode"], false);
        assert_eq!(saved["update"]["auto"], false);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn apply_config_scrive_in_config_yaml_quando_e_quello_che_esiste() {
        let base = unique_dir("apply-yaml");
        std::fs::write(base.join("config.yaml"), "setupVersion: 2\n").unwrap();

        apply_config_in(
            &base,
            &SetupConfigPatch {
                mark_complete: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        // `omp` aggiorna in place il nome che trova: non ne creiamo un secondo.
        assert!(!base.join("config.yml").exists());
        let saved: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(base.join("config.yaml")).unwrap()).unwrap();
        assert_eq!(saved["setupVersion"].as_u64(), Some(CURRENT_SETUP_VERSION));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn mark_complete_scrive_la_versione_corrente_del_setup() {
        let base = unique_dir("mark-complete");
        apply_config_in(
            &base,
            &SetupConfigPatch {
                mark_complete: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        let facts = read_config_facts(&base);
        assert_eq!(facts.setup_version, CURRENT_SETUP_VERSION);
        assert!(
            !status_for(Some(base.clone())).wizard_pending,
            "il setup risulta fatto"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn un_theme_stringa_scritto_a_mano_diventa_theme_dark() {
        // `omp` migra `theme: titanium` in `theme.dark` (vedi la fusione nel
        // bundle): trattarlo come una sezione da buttare perderebbe la scelta.
        let mut doc = serde_yaml::Mapping::new();
        doc.insert(
            serde_yaml::Value::String("theme".into()),
            serde_yaml::Value::String("titanium".into()),
        );
        merge_setup_patch(
            &mut doc,
            &SetupConfigPatch {
                theme_light: Some("light".into()),
                ..Default::default()
            },
        );
        let doc = serde_yaml::Value::Mapping(doc);
        assert_eq!(doc["theme"]["dark"], "titanium");
        assert_eq!(doc["theme"]["light"], "light");
    }

    // --- Rilevamento degli strumenti ---------------------------------------

    #[test]
    fn detect_tools_legge_le_cartelle_note_e_il_path() {
        let home = unique_dir("tools");
        let empty = unique_dir("tools-empty");
        let no_path = |_: &str| false;

        // Solo cartelle: nessun processo, nessun `which`.
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::create_dir_all(home.join(".ollama")).unwrap();
        let from_dirs = detect_tools_with(Some(&home), no_path);
        assert!(from_dirs.claude_code);
        assert!(from_dirs.codex_cli);
        assert!(from_dirs.ollama);

        // Solo PATH: nessuna cartella.
        let from_path = detect_tools_with(Some(&empty), |name| name == "codex");
        assert!(!from_path.claude_code);
        assert!(from_path.codex_cli);
        // Su macOS il rilevamento guarda anche l'app di Ollama: si verifica il
        // fatto della piattaforma, non un valore che dipende dalla macchina.
        assert_eq!(
            from_path.ollama,
            cfg!(target_os = "macos") && Path::new("/Applications/Ollama.app").exists()
        );

        // Macchina nuda: tutto assente.
        let none = detect_tools_with(None, no_path);
        assert!(!none.claude_code);
        assert!(!none.codex_cli);
        assert!(!none.ollama);

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&empty);
    }

    // --- Avanzamento del setup ---------------------------------------------

    #[test]
    fn progress_roundtrip_nella_cartella_dati() {
        let dir = unique_dir("progress");
        let path = dir.join(SETUP_PROGRESS_FILE);

        // Nessun file: il setup riparte dal primo passo, non da uno stato finto.
        assert!(read_progress(&path).unwrap().is_none());

        let progress = SetupProgress {
            step: "providers".into(),
            done: vec!["engine".into()],
            completed: false,
            updated_at: 1_763_000_000_000,
        };
        write_progress(&path, &progress).unwrap();

        let read = read_progress(&path).unwrap().expect("file scritto");
        assert_eq!(read.step, "providers");
        assert_eq!(read.done, vec!["engine".to_string()]);
        assert!(!read.completed);
        assert_eq!(read.updated_at, 1_763_000_000_000);

        // Il JSON in chiaro e' quello che il frontend si aspetta (camelCase).
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["step"], "providers");
        assert_eq!(raw["updatedAt"], 1_763_000_000_000i64);

        // Un file corrotto non impedisce di riaprire il setup.
        std::fs::write(&path, "{ non json").unwrap();
        assert!(read_progress(&path).unwrap().is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn font_is_a_real_truetype_file() {
        // `include_bytes!` non verifica niente: se il file in assets/ venisse
        // sostituito con un woff2, Windows rifiuterebbe di installarlo.
        assert!(NERD_FONT_TTF.len() > 1_000_000);
        assert_eq!(&NERD_FONT_TTF[0..4], &[0x00, 0x01, 0x00, 0x00]);
    }

    /// La cartella sbagliata e' il difetto piu' silenzioso possibile: il file
    /// viene scritto, l'esito dice "installato" e il font non compare mai.
    #[test]
    fn font_target_follows_platform_convention() {
        let target = nerd_font_target().expect("cartella dei font risolvibile");
        assert!(target.ends_with(NERD_FONT_FILE));
        let shown = target.to_string_lossy().replace('\\', "/");

        #[cfg(target_os = "macos")]
        {
            assert!(
                shown.contains("/Library/Fonts/"),
                "su macOS i font dell'utente stanno in ~/Library/Fonts: {}",
                shown
            );
            assert!(
                !shown.contains("/.local/share/fonts/"),
                "percorso fontconfig di Linux usato su macOS: {}",
                shown
            );
        }
        #[cfg(target_os = "windows")]
        assert!(
            shown.contains("/Microsoft/Windows/Fonts/"),
            "su Windows serve la cartella font per-utente: {}",
            shown
        );
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        assert!(
            shown.contains("/.local/share/fonts/"),
            "altrove vale la convenzione fontconfig: {}",
            shown
        );
    }

    #[test]
    fn repo_counting_only_looks_at_first_level_git_dirs() {
        let base = std::env::temp_dir().join(format!("omp-studio-roots-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("with-git").join(".git")).unwrap();
        std::fs::create_dir_all(base.join("plain")).unwrap();
        std::fs::create_dir_all(base.join("nested").join("inner").join(".git")).unwrap();

        assert_eq!(count_repos(&base), 1);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn empty_agent_dir_reports_credentials_and_model_missing() {
        // Una cartella agente vuota e' l'equivalente esatto di una macchina
        // appena installata: nessun config.yml, nessun agent.db.
        let base = std::env::temp_dir().join(format!("omp-studio-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let status = status_for(Some(base.clone()));
        assert_eq!(status.setup_version, 0);
        assert!(
            status.wizard_pending,
            "il wizard nativo deve risultare da fare"
        );
        assert!(!status.has_credentials);
        assert_eq!(status.default_model, None);
        assert!(status.missing.contains(&"credentials".to_string()));
        assert!(status.missing.contains(&"model".to_string()));
        // I database mancanti non sono illeggibili: la differenza e' quella che
        // distingue "prima installazione" da "installazione rotta".
        assert!(status.databases.iter().all(|db| !db.exists && !db.readable));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn config_facts_read_the_keys_omp_actually_writes() {
        let base = std::env::temp_dir().join(format!("omp-studio-facts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(
            base.join("config.yml"),
            "setupVersion: 2\nmodelRoles:\n  default: anthropic/claude-opus-5:high\n  smol: x/y\ntheme:\n  dark: titanium\ncolorBlindMode: true\n",
        )
        .unwrap();

        let facts = read_config_facts(&base);
        assert_eq!(facts.setup_version, 2);
        assert_eq!(
            facts.default_model.as_deref(),
            Some("anthropic/claude-opus-5:high")
        );
        assert_eq!(facts.theme_dark.as_deref(), Some("titanium"));
        assert!(facts.color_blind_mode);

        let status = status_for(Some(base.clone()));
        assert!(
            status.wizard_pending,
            "setupVersion 2 e' precedente alla soglia 3"
        );
        // Il modello c'e' ma le credenziali no: e' il caso "wizard chiuso con Esc".
        // La soglia non aggiunge una voce a `missing`: il wizard non si riapre da solo.
        assert!(status.missing.contains(&"credentials".to_string()));
        assert!(!status.missing.contains(&"model".to_string()));
        assert!(!status.missing.iter().any(|item| item == "wizard"));

        std::fs::write(
            base.join("config.yml"),
            "setupVersion: 3\nmodelRoles:\n  default: anthropic/claude-opus-5:high\n  smol: x/y\ntheme:\n  dark: titanium\ncolorBlindMode: true\n",
        )
        .unwrap();
        let current = status_for(Some(base.clone()));
        assert!(!current.wizard_pending, "setupVersion 3 e' la soglia corrente");
        assert!(current.missing.contains(&"credentials".to_string()));
        assert!(!current.missing.contains(&"model".to_string()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn il_blocco_path_e_idempotente_e_non_tocca_le_righe_dell_utente() {
        let home = std::env::temp_dir().join(format!("omp-studio-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let profile = home.join(".zprofile");
        std::fs::write(&profile, "export EDITOR=vim\n").unwrap();

        let dir = home.join(".omp").join("bin");
        assert!(ensure_profile_exports(&profile, &dir).unwrap());

        let after_first = std::fs::read_to_string(&profile).unwrap();
        assert!(
            after_first.starts_with("export EDITOR=vim\n"),
            "riga utente perduta"
        );
        assert!(after_first.contains(&posix_path_export(&dir)));
        assert_eq!(after_first.matches(PATH_BLOCK_START).count(), 1);
        assert_eq!(after_first.matches(PATH_BLOCK_END).count(), 1);

        // Seconda installazione: niente da fare, nessun duplicato.
        assert!(!ensure_profile_exports(&profile, &dir).unwrap());
        assert_eq!(std::fs::read_to_string(&profile).unwrap(), after_first);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn un_percorso_ostile_non_diventa_codice_di_shell() {
        let export = posix_path_export(Path::new("/tmp/a b/$(whoami)/`id`/\"x\""));
        assert!(export.contains("\\$(whoami)"), "{}", export);
        assert!(export.contains("\\`id\\`"), "{}", export);
        assert!(export.contains("\\\"x\\\""), "{}", export);
        assert!(export.ends_with(":$PATH\""), "{}", export);
    }

    #[cfg(unix)]
    #[test]
    fn si_aggiorna_il_profilo_della_shell_di_login_e_quelli_esistenti() {
        let home = std::env::temp_dir().join(format!("omp-studio-profiles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join(".profile"), "# esistente\n").unwrap();

        // zsh: `.zprofile` va creato, `.profile` aggiornato perche' c'e' gia',
        // `.bash_profile` no perche' non esiste.
        let profiles = shell_profiles_to_update(&home, Some("/bin/zsh"));
        assert_eq!(
            profiles,
            vec![home.join(".zprofile"), home.join(".profile")]
        );

        // Shell sconosciuta: si ripiega sul profilo POSIX, senza duplicarlo.
        assert_eq!(
            shell_profiles_to_update(&home, Some("/usr/bin/fish")),
            vec![home.join(".profile")]
        );

        // Senza `$SHELL` si toccano solo i profili esistenti.
        assert_eq!(
            shell_profiles_to_update(&home, None),
            vec![home.join(".profile")]
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn file_sha256_computes_correct_hash() {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("omp-test-hash-{}.txt", std::process::id()));
        std::fs::write(&temp_file, b"hello world").unwrap();

        let hash = file_sha256(&temp_file).unwrap();
        let _ = std::fs::remove_file(&temp_file);

        // echo -n "hello world" | sha256sum -> b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn parse_checksums_accepts_only_valid_sha256_for_the_asset() {
        let text = "\n\
                    not-a-hash  omp-windows-x64.exe\n\
                    B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9  omp-windows-x64.exe\n\
                    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 *omp-darwin-arm64\n";
        assert_eq!(
            parse_checksums(text, "omp-windows-x64.exe").as_deref(),
            Some("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
        );
        assert_eq!(
            parse_checksums(text, "omp-darwin-arm64").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
        assert_eq!(
            parse_checksums("not-a-hash  omp-linux-x64", "omp-linux-x64"),
            None
        );
        assert_eq!(parse_checksums(text, "nonexistent"), None);
    }

    #[test]
    fn expected_hash_prefers_digest_and_requires_a_valid_fallback() {
        let digest_hash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        let checksum_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let digest = format!("sha256:{}", digest_hash.to_uppercase());

        assert_eq!(
            resolve_expected_hash(Some(&digest), Some(checksum_hash)).unwrap(),
            digest_hash
        );
        assert_eq!(
            resolve_expected_hash(Some("sha256:malformed"), Some(checksum_hash)).unwrap(),
            checksum_hash
        );
        assert!(resolve_expected_hash(None, None).is_err());
        assert!(resolve_expected_hash(Some("sha512:abcd"), Some("malformed")).is_err());
    }

    #[test]
    fn hash_mismatch_does_not_touch_existing_binary() {
        let base = std::env::temp_dir().join(format!("omp-test-mismatch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let downloaded = base.join("omp.download");
        let existing = base.join("omp");
        std::fs::write(&downloaded, b"new binary").unwrap();
        std::fs::write(&existing, b"existing binary").unwrap();

        let error = verify_file_sha256(
            &downloaded,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )
        .unwrap_err();

        // Il messaggio segue la lingua dell'interfaccia (default inglese): si
        // verifica il fatto, non la frase.
        assert!(
            error.contains("digest differs") || error.contains("diversa"),
            "errore inatteso: {error}"
        );
        assert_eq!(
            std::fs::read(&existing).unwrap().as_slice(),
            b"existing binary"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Installa davvero il font nel profilo dell'utente, quindi non gira nella
    /// suite: `cargo test -- --ignored font_installs_for_the_current_user`.
    /// E' l'unico modo di esercitare copia + registro senza la GUI.
    #[tokio::test]
    #[ignore = "muta il profilo utente: copia un font e scrive in HKCU"]
    async fn font_installs_for_the_current_user() {
        let outcome = install_nerd_font().await.expect("installazione del font");
        assert_eq!(outcome.family, NERD_FONT_NAME);
        let path = std::path::PathBuf::from(&outcome.path);
        assert!(path.exists(), "il file del font non e' stato scritto");
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            NERD_FONT_TTF.len() as u64
        );
        assert!(outcome.registered, "il font non risulta registrato");

        // Idempotenza: una seconda chiamata non riscrive nulla.
        let again = install_nerd_font().await.expect("seconda installazione");
        assert!(!again.installed);
    }
}
