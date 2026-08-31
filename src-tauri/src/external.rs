//! Apertura del progetto in un'applicazione esterna.
//!
//! `plugin-opener` sa aprire un percorso con l'app predefinita, ma non sa
//! passarle argomenti: `wt.exe <cartella>` interpreta il percorso come comando
//! da eseguire, non come cartella di lavoro, quindi serve `wt -d <cartella>`.
//! Da qui questo comando, che conosce la forma giusta per ogni piattaforma e
//! restituisce un errore leggibile quando l'applicazione non c'e'.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Nessuna finestra di console: il processo avviato disegna la propria.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Console nuova e visibile: serve al `cmd.exe` avviato come terminale, che
/// senza console non avrebbe alcuna interfaccia.
#[cfg(target_os = "windows")]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

/// Nomi degli eseguibili di VS Code. Sul PATH di Windows c'e' lo shim
/// `code.cmd`, che `CreateProcess` non sa avviare: da qui la necessita' di
/// risalire all'eseguibile vero accanto alla cartella `bin`.
#[cfg(any(target_os = "windows", test))]
const VSCODE_EXE_NAMES: [&str; 2] = ["Code.exe", "Code - Insiders.exe"];

/// Cosa aprire sulla cartella del progetto.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalTarget {
    /// Emulatore di terminale con la cartella come directory di lavoro.
    Terminal,
    /// Editor di codice esterno sulla cartella.
    Editor,
}

fn validate(project_path: &str, rel: Option<&str>) -> Result<PathBuf, String> {
    let clean_project_path = project_path.trim();
    if clean_project_path.is_empty() {
        return Err("Cartella di progetto non valida: percorso vuoto".to_string());
    }

    let base_raw = Path::new(clean_project_path);
    if !base_raw.is_dir() {
        return Err(format!(
            "Cartella di progetto non valida: {clean_project_path}"
        ));
    }

    let base = base_raw.canonicalize().map_err(|e| {
        format!(
            "Cartella di progetto non valida ({}): {}",
            clean_project_path, e
        )
    })?;

    match rel {
        None => Ok(base_raw.to_path_buf()),
        Some(r) => {
            let clean_rel = r.replace('\\', "/");
            let clean_rel = clean_rel.trim_matches('/');
            if clean_rel.is_empty() || clean_rel == "." {
                return Ok(base_raw.to_path_buf());
            }

            let target = base.join(clean_rel);
            let canonical = target
                .canonicalize()
                .map_err(|e| format!("Sottocartella non valida o inesistente ({}): {}", r, e))?;

            if !canonical.starts_with(&base) {
                return Err("Il percorso esce dalla cartella del progetto".to_string());
            }

            if !canonical.is_dir() {
                return Err(format!(
                    "Il percorso specificato non e' una cartella: {}",
                    r
                ));
            }

            #[cfg(target_os = "windows")]
            {
                let s = canonical.to_string_lossy();
                let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
                Ok(PathBuf::from(stripped))
            }
            #[cfg(not(target_os = "windows"))]
            {
                Ok(canonical)
            }
        }
    }
}

/// Un avvio descritto per argomenti separati. Il percorso del progetto resta
/// sempre un argomento del sistema operativo o la working directory del
/// processo: non viene mai concatenato in una riga di comando interpretata da
/// `cmd.exe`, dove `&`, `|`, `^` o le parentesi avvierebbero altri comandi.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Launch {
    program: OsString,
    args: Vec<OsString>,
    /// Vero solo per i processi che devono ricevere una console visibile.
    needs_console: bool,
    /// Vero per i lanciatori che terminano subito (`open`, il CLI `code`):
    /// solo il loro codice di uscita dice se l'applicazione e' partita
    /// davvero. Falso per le applicazioni che restano aperte, dove aspettare
    /// bloccherebbe fino alla chiusura della finestra.
    wait_for_exit: bool,
}

/// Candidati di avvio per piattaforma. Il sistema operativo e' un parametro
/// esplicito perche' la forma degli argomenti di Windows deve restare
/// verificabile dai test anche quando girano su un'altra piattaforma.
fn launch_candidates(
    os: &str,
    target: ExternalTarget,
    dir: &Path,
    editors: &[PathBuf],
) -> Vec<Launch> {
    let dir_arg = dir.as_os_str().to_os_string();

    match (os, target) {
        ("windows", ExternalTarget::Terminal) => vec![
            Launch {
                program: "wt.exe".into(),
                args: vec!["-d".into(), dir_arg],
                needs_console: false,
                wait_for_exit: false,
            },
            // `cmd.exe` non riceve argomenti: la cartella arriva come working
            // directory del processo, quindi nulla del percorso puo' essere
            // interpretato come comando.
            Launch {
                program: "cmd.exe".into(),
                args: Vec::new(),
                needs_console: true,
                wait_for_exit: false,
            },
        ],
        ("windows", ExternalTarget::Editor) => editors
            .iter()
            .map(|exe| Launch {
                program: exe.as_os_str().to_os_string(),
                args: vec![dir_arg.clone()],
                needs_console: false,
                wait_for_exit: false,
            })
            .collect(),
        ("macos", ExternalTarget::Terminal) => vec![Launch {
            program: "open".into(),
            args: vec!["-a".into(), "Terminal".into(), dir_arg],
            needs_console: false,
            wait_for_exit: true,
        }],
        ("macos", ExternalTarget::Editor) => vec![
            Launch {
                program: "open".into(),
                args: vec!["-a".into(), "Visual Studio Code".into(), dir_arg.clone()],
                needs_console: false,
                wait_for_exit: true,
            },
            Launch {
                program: "code".into(),
                args: vec![dir_arg],
                needs_console: false,
                wait_for_exit: true,
            },
        ],
        (_, ExternalTarget::Terminal) => {
            let mut working_directory = OsString::from("--working-directory=");
            working_directory.push(dir);
            vec![
                Launch {
                    program: "x-terminal-emulator".into(),
                    args: Vec::new(),
                    needs_console: false,
                    wait_for_exit: false,
                },
                Launch {
                    program: "gnome-terminal".into(),
                    args: vec![working_directory],
                    needs_console: false,
                    wait_for_exit: false,
                },
            ]
        }
        (_, ExternalTarget::Editor) => vec![Launch {
            program: "code".into(),
            args: vec![dir_arg],
            needs_console: false,
            wait_for_exit: true,
        }],
    }
}

/// Dal percorso di uno shim (`...\Microsoft VS Code\bin\code.cmd`) ricava i
/// possibili eseguibili reali. Un `.exe` viene restituito tale e quale.
#[cfg(any(target_os = "windows", test))]
fn vscode_exe_candidates_from_shim(shim: &Path) -> Vec<PathBuf> {
    if shim
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return vec![shim.to_path_buf()];
    }
    let Some(root) = shim.parent().and_then(Path::parent) else {
        return Vec::new();
    };
    VSCODE_EXE_NAMES.iter().map(|name| root.join(name)).collect()
}

/// Percorsi che `where.exe` associa a un nome, senza passare da una shell.
#[cfg(target_os = "windows")]
fn where_on_path(name: &str) -> Vec<PathBuf> {
    let mut cmd = Command::new("where.exe");
    cmd.arg(name);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect()
}

/// Eseguibili di VS Code effettivamente presenti, in ordine di preferenza.
/// Vuoto significa "nessun editor": l'apertura fallisce con un errore, invece
/// di far partire una shell che riuscirebbe comunque.
#[cfg(target_os = "windows")]
fn resolve_editors() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    for shim in ["code.cmd", "code-insiders.cmd", "code.exe"] {
        for path in where_on_path(shim) {
            candidates.extend(vscode_exe_candidates_from_shim(&path));
        }
    }

    let bases = [
        std::env::var_os("LOCALAPPDATA").map(|v| PathBuf::from(v).join("Programs")),
        std::env::var_os("ProgramFiles").map(PathBuf::from),
        std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
    ];
    for base in bases.into_iter().flatten() {
        for folder in ["Microsoft VS Code", "Microsoft VS Code Insiders"] {
            for name in VSCODE_EXE_NAMES {
                candidates.push(base.join(folder).join(name));
            }
        }
    }

    let mut editors: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if candidate.is_file() && !editors.contains(&candidate) {
            editors.push(candidate);
        }
    }
    editors
}

/// Fuori da Windows l'editor si avvia con `open`/`code`, che sono eseguibili
/// veri: non serve risolvere nessuno shim.
#[cfg(not(target_os = "windows"))]
fn resolve_editors() -> Vec<PathBuf> {
    Vec::new()
}

/// Avvia il primo candidato che parte davvero. Per i lanciatori che terminano
/// subito si guarda il codice di uscita: `open -a` esiste sempre, quindi
/// "avviato" non direbbe niente sull'applicazione richiesta.
fn spawn_first(candidates: &[Launch], working_dir: &Path) -> bool {
    for candidate in candidates {
        let mut cmd = Command::new(&candidate.program);
        cmd.args(&candidate.args).current_dir(working_dir);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(if candidate.needs_console {
            CREATE_NEW_CONSOLE
        } else {
            CREATE_NO_WINDOW
        });

        if candidate.wait_for_exit {
            if cmd.status().map(|status| status.success()).unwrap_or(false) {
                return true;
            }
        } else if cmd.spawn().is_ok() {
            return true;
        }
    }
    false
}

#[command]
pub async fn open_project_external(
    project_path: String,
    target: ExternalTarget,
    rel: Option<String>,
) -> Result<(), String> {
    let path = validate(&project_path, rel.as_deref())?;

    // `open -a` e il CLI `code` vengono attesi: il lavoro va su un thread
    // dedicato per non bloccare il runtime dei comandi.
    let launched = tokio::task::spawn_blocking(move || {
        let editors = match target {
            ExternalTarget::Editor => resolve_editors(),
            ExternalTarget::Terminal => Vec::new(),
        };
        let candidates = launch_candidates(std::env::consts::OS, target, &path, &editors);
        spawn_first(&candidates, &path)
    })
    .await
    .map_err(|error| format!("Avvio dell'applicazione esterna: {}", error))?;

    if launched {
        Ok(())
    } else {
        Err(match target {
            ExternalTarget::Terminal => {
                "Nessun terminale disponibile su questo sistema".to_string()
            }
            ExternalTarget::Editor => {
                "Nessun editor esterno trovato: installa VS Code oppure rendi disponibile il comando `code`".to_string()
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rifiuta_percorsi_che_non_sono_cartelle() {
        assert!(validate("", None).is_err());
        assert!(validate("   ", None).is_err());
        assert!(validate("percorso/che/non/esiste/mai", None).is_err());
    }

    #[test]
    fn accetta_una_cartella_esistente() {
        let dir = std::env::temp_dir();
        assert!(validate(&dir.to_string_lossy(), None).is_ok());
    }

    #[test]
    fn accetta_sottocartella_valida() {
        let root = std::env::temp_dir().join("omp-studio-ext-sub-ok");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub/nested")).unwrap();

        let res = validate(&root.to_string_lossy(), Some("sub/nested"));
        assert!(res.is_ok());
        assert!(res.unwrap().ends_with("nested"));
    }

    #[test]
    fn rifiuta_file_come_sottocartella() {
        let root = std::env::temp_dir().join("omp-studio-ext-file-err");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("file.txt"), "hello").unwrap();

        let res = validate(&root.to_string_lossy(), Some("file.txt"));
        assert!(res.is_err());
    }

    #[test]
    fn rifiuta_traversal_sottocartella() {
        let root = std::env::temp_dir().join("omp-studio-ext-traversal");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let res = validate(&root.to_string_lossy(), Some("../../windows"));
        assert!(res.is_err());
    }

    /// Percorso ostile: ogni carattere qui e' un metacarattere di `cmd.exe`.
    const HOSTILE_DIR: &str = r"C:\repos\a & b | c ^ (d)";

    fn all_candidates(dir: &Path, editors: &[PathBuf]) -> Vec<Launch> {
        ["windows", "macos", "linux"]
            .into_iter()
            .flat_map(|os| {
                [ExternalTarget::Terminal, ExternalTarget::Editor]
                    .into_iter()
                    .flat_map(move |target| launch_candidates(os, target, dir, editors))
            })
            .collect()
    }

    #[test]
    fn nessun_candidato_passa_da_un_interprete_di_comandi() {
        let editors = vec![PathBuf::from(r"C:\VS Code\Code.exe")];
        for candidate in all_candidates(Path::new(HOSTILE_DIR), &editors) {
            let program = candidate.program.to_string_lossy().to_lowercase();
            assert!(
                !program.ends_with("powershell.exe") && !program.ends_with("bash"),
                "nessun candidato deve avviare una shell: {}",
                program
            );
            for arg in &candidate.args {
                let flag = arg.to_string_lossy().to_lowercase();
                assert_ne!(flag, "/c", "nessun candidato deve usare `/C`");
                assert_ne!(flag, "-c", "nessun candidato deve usare `-c`");
                assert_ne!(flag, "start", "nessun candidato deve usare `start`");
            }
            if program.ends_with("cmd.exe") {
                assert!(
                    candidate.args.is_empty(),
                    "cmd.exe riceve la cartella come working directory, non come argomento"
                );
                assert!(
                    candidate.needs_console,
                    "un terminale senza console non avrebbe interfaccia"
                );
            }
        }
    }

    /// `open -a` e il CLI `code` esistono sempre: senza guardare il codice di
    /// uscita, un'applicazione assente passerebbe per apertura riuscita e il
    /// fallback non partirebbe mai.
    #[test]
    fn i_lanciatori_che_terminano_subito_vengono_attesi() {
        let editors = vec![PathBuf::from(r"C:\VS Code\Code.exe")];
        for candidate in all_candidates(Path::new(HOSTILE_DIR), &editors) {
            let program = candidate.program.to_string_lossy().to_string();
            let is_launcher = program == "open" || program == "code";
            assert_eq!(
                candidate.wait_for_exit, is_launcher,
                "attesa sbagliata per {}",
                program
            );
        }
    }

    #[test]
    fn il_percorso_ostile_resta_un_argomento_solo() {
        let dir = Path::new(HOSTILE_DIR);
        let editors = vec![PathBuf::from(r"C:\VS Code\Code.exe")];

        let terminal = launch_candidates("windows", ExternalTarget::Terminal, dir, &editors);
        assert_eq!(terminal[0].program, OsString::from("wt.exe"));
        assert_eq!(
            terminal[0].args,
            vec![OsString::from("-d"), OsString::from(HOSTILE_DIR)]
        );

        let editor = launch_candidates("windows", ExternalTarget::Editor, dir, &editors);
        assert_eq!(editor.len(), 1);
        assert_eq!(editor[0].program, OsString::from(r"C:\VS Code\Code.exe"));
        assert_eq!(editor[0].args, vec![OsString::from(HOSTILE_DIR)]);
    }

    #[test]
    fn senza_editor_risolti_windows_non_ha_candidati() {
        // Fail closed: meglio l'errore che una shell avviata "con successo".
        let candidates =
            launch_candidates("windows", ExternalTarget::Editor, Path::new(HOSTILE_DIR), &[]);
        assert!(candidates.is_empty());
    }

    #[test]
    fn dallo_shim_si_risale_agli_eseguibili_di_vs_code() {
        let from_shim =
            vscode_exe_candidates_from_shim(Path::new("C:/Programs/Microsoft VS Code/bin/code.cmd"));
        assert_eq!(
            from_shim,
            vec![
                PathBuf::from("C:/Programs/Microsoft VS Code/Code.exe"),
                PathBuf::from("C:/Programs/Microsoft VS Code/Code - Insiders.exe"),
            ]
        );

        // Un `.exe` gia' risolto resta invariato.
        assert_eq!(
            vscode_exe_candidates_from_shim(Path::new("C:/Programs/VS Code/Code.exe")),
            vec![PathBuf::from("C:/Programs/VS Code/Code.exe")]
        );

        // Uno shim senza cartella superiore non produce candidati inventati.
        assert!(vscode_exe_candidates_from_shim(Path::new("code.cmd")).is_empty());
    }
}
