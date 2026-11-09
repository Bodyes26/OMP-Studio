//! Censimento delle regole di contesto e delle skill dell'agente, piu' il
//! rilevamento dell'attrito ricorrente nello storico dei prompt.
//!
//! Due invarianti governano questo modulo:
//!
//! 1. **Sola lettura sullo storico.** Lo storico di `omp` si apre con
//!    `open_readonly_db` (`PRAGMA query_only = ON`, `busy_timeout = 3000`): il
//!    runtime dell'agente non viene mai toccato ne' bloccato.
//! 2. **Scrittura solo su richiesta esplicita.** `create_project_agents_md` e
//!    `apply_rule_suggestion` scrivono solo dentro la cartella del progetto e
//!    solo quando l'utente clicca. Le skill globali sotto `~/.omp/agent` si
//!    censiscono e non si modificano: l'unico file che Studio scrive dentro
//!    `~/.omp` resta il tema (docs/DECISIONS.md).

use crate::omp_ops::{agent_dir, open_readonly_db};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::command;
/// Un file di contesto del progetto: `AGENTS.md`, una regola in `.omp/rules/`
/// oppure un file di linee guida alternativo. `path` e' sempre relativo alla
/// radice del progetto, cosi' com'e' atteso da `file_read`/`file_write`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextRuleItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    /// "agents_md" | "omp_rule" | "guidelines"
    pub rule_type: String,
    pub description: Option<String>,
}

/// Una skill censita. `path` e' assoluto (serve per rivelarla nel file
/// manager); `rel_path` esiste solo per le skill dentro il progetto, le sole
/// che l'editor centrale puo' aprire e salvare.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkillItem {
    pub name: String,
    pub path: String,
    pub rel_path: Option<String>,
    /// "project" | "global" | "managed"
    pub scope: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectContextSummary {
    pub rules: Vec<ContextRuleItem>,
    pub skills: Vec<SkillItem>,
}

/// File di linee guida alternativi riconosciuti nella radice del progetto,
/// con la descrizione mostrata nel pannello nella lingua dell'interfaccia.
fn alt_context_files() -> [(&'static str, &'static str); 3] {
    [
        (
            "CLAUDE.md",
            crate::tr!(
                "Istruzioni di contesto Claude",
                "Claude context instructions"
            ),
        ),
        (
            "GEMINI.md",
            crate::tr!(
                "Istruzioni di contesto Gemini",
                "Gemini context instructions"
            ),
        ),
        (
            ".impeccable.md",
            crate::tr!(
                "Regole e principi interfaccia",
                "Interface rules and principles"
            ),
        ),
    ]
}

/// Censisce le regole e le skill per il percorso specificato in modo sincrono.
pub(crate) fn get_project_context_sync(
    project_path: &str,
) -> Result<ProjectContextSummary, String> {
    let root = Path::new(project_path);
    if !root.is_dir() {
        return Err(crate::tr!(
            format!("Directory di progetto non trovata: {}", project_path),
            format!("Project directory not found: {}", project_path)
        ));
    }
    let mut rules = Vec::new();
    let mut skills = Vec::new();

    // 1. AGENTS.md: censito anche quando manca, cosi' il pannello puo' offrire
    //    l'inizializzazione invece di uno stato vuoto muto.
    rules.push(ContextRuleItem {
        id: "agents_md".to_string(),
        name: "AGENTS.md".to_string(),
        path: "AGENTS.md".to_string(),
        exists: root.join("AGENTS.md").is_file(),
        rule_type: "agents_md".to_string(),
        description: Some(
            crate::tr!(
                "Linee guida primarie e convenzioni operative del progetto",
                "Primary guidelines and operating conventions for the project"
            )
            .to_string(),
        ),
    });

    // 2. .omp/preview.md: regole di design per le anteprime dell'agente (ANT-001, ANT-002).
    //    Censito in prima classe come AGENTS.md; etichetta e descrizione localizzate nel frontend.
    let preview_exists = root.join(".omp").join("preview.md").is_file();
    rules.push(ContextRuleItem {
        id: "preview_rules".to_string(),
        name: "preview.md".to_string(),
        path: ".omp/preview.md".to_string(),
        exists: preview_exists,
        rule_type: "preview_rules".to_string(),
        description: Some(
            crate::tr!(
                "Design applicato dall'agente alle anteprime",
                "Design applied by the agent to previews"
            )
            .to_string(),
        ),
    });

    // 3. Regole modulari in .omp/rules/*.md
    let mut omp_rules = Vec::new();
    if let Ok(entries) = fs::read_dir(root.join(".omp").join("rules")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !has_md_extension(&path) {
                continue;
            }
            let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            omp_rules.push(ContextRuleItem {
                id: format!("rule_{}", file_name),
                name: file_name.clone(),
                path: format!(".omp/rules/{}", file_name),
                exists: true,
                rule_type: "omp_rule".to_string(),
                description: Some(
                    crate::tr!(
                        "Regola di contesto di progetto",
                        "Project context rule"
                    )
                    .to_string(),
                ),
            });
        }
    }
    omp_rules.sort_by(|left, right| left.name.cmp(&right.name));
    rules.append(&mut omp_rules);

    // 4. File di contesto aggiuntivi nella radice.
    for (filename, desc) in alt_context_files() {
        if root.join(filename).is_file() {
            rules.push(ContextRuleItem {
                id: format!("extra_{}", filename),
                name: filename.to_string(),
                path: filename.to_string(),
                exists: true,
                rule_type: "guidelines".to_string(),
                description: Some(desc.to_string()),
            });
        }
    }

    // 5. Skill di progetto: apribili nell'editor, quindi con percorso relativo.
    scan_skills_directory(
        &root.join(".omp").join("skills"),
        "project",
        Some(".omp/skills"),
        &mut skills,
    );

    // 6. Skill globali e managed: sola ispezione dal file manager.
    if let Some(base_agent) = agent_dir() {
        scan_skills_directory(&base_agent.join("skills"), "global", None, &mut skills);
        scan_skills_directory(
            &base_agent.join("managed-skills"),
            "managed",
            None,
            &mut skills,
        );
    }

    Ok(ProjectContextSummary { rules, skills })
}

#[command]
pub async fn get_project_context(project_path: String) -> Result<ProjectContextSummary, String> {
    tokio::task::spawn_blocking(move || get_project_context_sync(&project_path))
        .await
        .map_err(|e| crate::tr!(format!("Task get_project_context fallito: {}", e), format!("Task get_project_context failed: {}", e)))?
}

fn has_md_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

/// Censisce una cartella di skill nelle due forme che `omp` accetta:
/// `<nome>/SKILL.md` oppure `<nome>.md`. `rel_base` e' il percorso della
/// cartella relativo alla radice del progetto, presente solo per le skill di
/// progetto.
fn scan_skills_directory(
    dir: &Path,
    scope: &str,
    rel_base: Option<&str>,
    output: &mut Vec<SkillItem>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if !skill_md.is_file() {
                continue;
            }
            let Some(dir_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            found.push(SkillItem {
                description: extract_skill_description(&skill_md),
                rel_path: rel_base.map(|base| format!("{}/{}/SKILL.md", base, dir_name)),
                name: dir_name,
                path: skill_md.to_string_lossy().to_string(),
                scope: scope.to_string(),
            });
        } else if path.is_file() && has_md_extension(&path) {
            let Some(stem) = path.file_stem().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            found.push(SkillItem {
                description: extract_skill_description(&path),
                rel_path: rel_base.map(|base| format!("{}/{}", base, file_name)),
                name: stem,
                path: path.to_string_lossy().to_string(),
                scope: scope.to_string(),
            });
        }
    }

    found.sort_by(|left, right| left.name.cmp(&right.name));
    output.append(&mut found);
}

/// Prima riga utile di un SKILL.md: la `description` del frontmatter quando
/// c'e', altrimenti la prima riga di prosa.
fn extract_skill_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines().take(10) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("description:") {
            return Some(
                rest.trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim()
                    .to_string(),
            );
        }
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("---") {
            continue;
        }
        if trimmed.starts_with("name:") {
            continue;
        }
        return Some(trimmed.to_string());
    }
    None
}

/// Contenuto iniziale di `AGENTS.md`, scritto nella lingua dell'interfaccia al
/// momento della creazione: il file appartiene all'utente e resta com'e'.
fn default_agents_md() -> &'static str {
    crate::tr!(
        r#"# AGENTS.md

Linee guida e convenzioni per gli agenti che operano su questo repository.

## Panoramica del progetto
- Scopo:
- Stack tecnologico:

## Comandi di verifica
- Build:
- Test:
- Lint/Typecheck:

## Invarianti e convenzioni
- Correttezza e manutenibilita' al primo posto.
- Verificare le modifiche con test o comandi specifici prima di dichiarare
  completato il lavoro.
"#,
        r#"# AGENTS.md

Guidelines and conventions for agents working in this repository.

## Project overview
- Purpose:
- Technology stack:

## Verification commands
- Build:
- Test:
- Lint/Typecheck:

## Invariants and conventions
- Correctness and maintainability come first.
- Verify changes with tests or specific commands before calling the work done.
"#
    )
}

/// Crea il file `AGENTS.md` nella radice del progetto in modo sicuro e sincrono:
/// valida il contenimento canonico del genitore, rifiuta collegamenti e symlink
/// dangling, e usa `create_new` per prevenire scritture fuori dallo spazio di lavoro.
pub(crate) fn create_project_agents_md_sync(project_path: &str) -> Result<String, String> {
    let base = crate::projects::canonical_project_base(project_path)?;
    let target = base.join("AGENTS.md");

    // `symlink_metadata` non segue i collegamenti: intercetta symlink validi o dangling
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            return Err(crate::tr!(
                "Percorso non ammesso: AGENTS.md e' un collegamento e potrebbe puntare fuori dal progetto",
                "Path not allowed: AGENTS.md is a link and may point outside the project"
            )
            .to_string());
        }
        if meta.is_file() {
            return Ok("AGENTS.md".to_string());
        }
        if meta.is_dir() {
            return Err(crate::tr!(
                "Percorso non ammesso: AGENTS.md e' una cartella",
                "Path not allowed: AGENTS.md is a directory"
            )
            .to_string());
        }
        return Err(crate::tr!(
            "Percorso non ammesso: tipo di elemento non valido per AGENTS.md",
            "Path not allowed: invalid item type for AGENTS.md"
        )
        .to_string());
    }

    // Creazione atomica esclusiva: `create_new(true)` impedisce sovrascritture concorrenti o traversal
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let meta = fs::symlink_metadata(&target).map_err(|e| {
                crate::tr!(
                    format!("Errore verifica AGENTS.md: {}", e),
                    format!("AGENTS.md check error: {}", e)
                )
            })?;
            if meta.file_type().is_symlink() {
                return Err(crate::tr!(
                    "Percorso non ammesso: AGENTS.md e' un collegamento e potrebbe puntare fuori dal progetto",
                    "Path not allowed: AGENTS.md is a link and may point outside the project"
                )
                .to_string());
            }
            return Ok("AGENTS.md".to_string());
        }
        Err(e) => {
            return Err(crate::tr!(
                format!("Errore durante la creazione di AGENTS.md: {}", e),
                format!("Error while creating AGENTS.md: {}", e)
            ))
        }
    };

    file.write_all(default_agents_md().as_bytes()).map_err(|e| {
        crate::tr!(
            format!("Errore durante la scrittura di AGENTS.md: {}", e),
            format!("Error while writing AGENTS.md: {}", e)
        )
    })?;

    Ok("AGENTS.md".to_string())
}

#[command]
pub async fn create_project_agents_md(project_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || create_project_agents_md_sync(&project_path))
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Task create_project_agents_md fallito: {}", e),
                format!("Task create_project_agents_md failed: {}", e)
            )
        })?
}

/// Intestazione di `.omp/preview.md` quando il progetto non ha documenti di
/// design: scritta nella lingua dell'interfaccia al momento della creazione.
fn preview_rules_header() -> &'static str {
    crate::tr!(
        "# Regole delle anteprime\n<!-- Linee guida di design applicate dall'agente alle anteprime di Studio. Inizializzato da DESIGN.md/PRODUCT.md; modificabile liberamente e mai sovrascritto da Studio. -->\n\n",
        "# Preview rules\n<!-- Design guidelines the agent applies to Studio previews. Initialised from DESIGN.md/PRODUCT.md; edit freely, Studio never overwrites it. -->\n\n"
    )
}

/// Cerca un documento di design o prodotto prima nella radice del progetto, poi in `docs/`.
/// Rifiuta e non segue collegamenti (symlink) che puntano fuori dalla radice del progetto.
fn find_and_read_project_doc(base: &Path, base_name: &str) -> Option<(String, String)> {
    let candidates = [
        (base_name.to_string(), base.join(base_name)),
        (base_name.to_lowercase(), base.join(base_name.to_lowercase())),
        (format!("docs/{}", base_name), base.join("docs").join(base_name)),
        (format!("docs/{}", base_name.to_lowercase()), base.join("docs").join(base_name.to_lowercase())),
    ];

    for (rel_label, candidate_path) in candidates {
        if !candidate_path.is_file() {
            continue;
        }
        if let Ok(canonical) = candidate_path.canonicalize() {
            if !canonical.starts_with(base) {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&canonical) {
                return Some((rel_label, content));
            }
        }
    }

    None
}

/// Assicura che `.omp/preview.md` esista nella radice del progetto (ANT-001).
/// Se il file esiste gia', non fa nulla e non sovrascrive mai (idempotente).
/// Altrimenti cerca `DESIGN.md` e `PRODUCT.md` nella radice del progetto, poi in `docs/`:
/// se presenti, li copia alla lettera preceduti da un'intestazione e separatori con il nome del file sorgente.
/// Se mancano entrambi, scrive il contenuto predefinito fornito dal frontend (`default_content`).
pub(crate) fn ensure_preview_rules_sync(
    project_path: &str,
    default_content: &str,
) -> Result<bool, String> {
    let base = crate::projects::canonical_project_base(project_path)?;
    let omp_dir = base.join(".omp");
    let target = omp_dir.join("preview.md");

    // 1. Se il file esiste gia', verifica che non sia un symlink fuori progetto e non toccarlo mai.
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            let canonical = target.canonicalize().map_err(|e| {
                crate::tr!(
                    format!("Errore risoluzione symlink .omp/preview.md: {}", e),
                    format!("Symlink resolution error for .omp/preview.md: {}", e)
                )
            })?;
            if !canonical.starts_with(&base) {
                return Err(crate::tr!(
                    "Percorso non ammesso: .omp/preview.md e' un collegamento e punta fuori dal progetto",
                    "Path not allowed: .omp/preview.md is a link pointing outside the project"
                )
                .to_string());
            }
        } else if meta.is_dir() {
            return Err(crate::tr!(
                "Percorso non ammesso: .omp/preview.md e' una cartella",
                "Path not allowed: .omp/preview.md is a directory"
            )
            .to_string());
        }
        return Ok(false);
    }

    // 2. Cartella .omp: se e' un symlink, deve rimanere dentro il progetto.
    if let Ok(meta) = fs::symlink_metadata(&omp_dir) {
        if meta.file_type().is_symlink() {
            let canonical = omp_dir.canonicalize().map_err(|e| {
                crate::tr!(
                    format!("Errore risoluzione symlink .omp: {}", e),
                    format!("Symlink resolution error for .omp: {}", e)
                )
            })?;
            if !canonical.starts_with(&base) {
                return Err(crate::tr!(
                    "Percorso non ammesso: .omp e' un collegamento e punta fuori dal progetto",
                    "Path not allowed: .omp is a link pointing outside the project"
                )
                .to_string());
            }
        }
    } else if let Err(e) = fs::create_dir_all(&omp_dir) {
        return Err(crate::tr!(
            format!("Impossibile creare la cartella .omp: {}", e),
            format!("Unable to create the .omp directory: {}", e)
        ));
    }

    // 3. Cerca DESIGN.md e PRODUCT.md nella radice, poi in docs/
    let design = find_and_read_project_doc(&base, "DESIGN.md");
    let product = find_and_read_project_doc(&base, "PRODUCT.md");
    // Il marcatore di provenienza finisce nel file dell'utente: segue la sua lingua.
    let source_marker = |name: &str| {
        crate::tr!(
            format!("<!-- Source: {} -->\n", name),
            format!("<!-- Source: {} -->\n", name)
        )
    };

    let content = if design.is_none() && product.is_none() {
        default_content.to_string()
    } else {
        let mut text = preview_rules_header().to_string();
        if let Some((source_name, doc_content)) = design {
            text.push_str(&source_marker(&source_name));
            text.push_str(&doc_content);
            if !text.ends_with('\n') {
                text.push('\n');
            }
            text.push('\n');
        }
        if let Some((source_name, doc_content)) = product {
            text.push_str(&source_marker(&source_name));
            text.push_str(&doc_content);
            if !text.ends_with('\n') {
                text.push('\n');
            }
        }
        text
    };

    // 4. Creazione atomica esclusiva: `create_new(true)` impedisce sovrascritture concorrenti
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(false);
        }
        Err(e) => {
            return Err(crate::tr!(
                format!("Errore durante la creazione di .omp/preview.md: {}", e),
                format!("Error while creating .omp/preview.md: {}", e)
            ))
        }
    };

    file.write_all(content.as_bytes()).map_err(|e| {
        crate::tr!(
            format!("Errore durante la scrittura di .omp/preview.md: {}", e),
            format!("Error while writing .omp/preview.md: {}", e)
        )
    })?;
    file.flush().map_err(|e| {
        crate::tr!(
            format!("Errore durante il flush di .omp/preview.md: {}", e),
            format!("Error while flushing .omp/preview.md: {}", e)
        )
    })?;

    Ok(true)
}

#[command]
pub async fn ensure_preview_rules(
    project_path: String,
    default_content: String,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || ensure_preview_rules_sync(&project_path, &default_content))
        .await
        .map_err(|e| {
            crate::tr!(
                format!("Task ensure_preview_rules fallito: {}", e),
                format!("Task ensure_preview_rules failed: {}", e)
            )
        })?
}

/// Una proposta di regola nata dall'attrito osservato nei prompt recenti.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RuleSuggestion {
    pub id: String,
    pub title: String,
    pub reason: String,
    /// "agents_md"
    pub target_type: String,
    pub target_file: String,
    pub proposed_content: String,
    pub occurrences: usize,
}

/// Numero di sessioni in cui la stessa correzione deve ripetersi prima di
/// diventare una proposta. Due volte e' una abitudine, una volta e' un caso.
const MIN_OCCURRENCES: usize = 2;

/// Prompt esaminati: la finestra recente, non tutta la storia del progetto.
const PROMPT_WINDOW: usize = 60;

struct FrictionPattern {
    id: &'static str,
    title: String,
    /// Completa la frase "In N sessioni recenti ...".
    evidence: String,
    /// Intestazioni della sezione, in entrambe le lingue: un AGENTS.md scritto
    /// in inglese o in italiano zittisce la proposta allo stesso modo.
    markers: &'static [&'static str],
    /// Testo proposto per AGENTS.md: scritto nella lingua dell'interfaccia,
    /// perche' finisce nel file dell'utente.
    section: String,
    keywords: &'static [&'static str],
}

fn friction_patterns() -> Vec<FrictionPattern> {
    vec![
        FrictionPattern {
            id: "sug_verification_step",
            title: crate::tr!(
                "Aggiungi la verifica dei test a AGENTS.md",
                "Add test verification to AGENTS.md"
            )
            .to_string(),
            evidence: crate::tr!(
                "hai dovuto chiedere esplicitamente di verificare i test.",
                "you had to ask explicitly to verify the tests."
            )
            .to_string(),
            markers: &["## Verifica delle modifiche", "## Change verification"],
            section: crate::tr!(
                "## Verifica delle modifiche\n- Eseguire sempre la suite di test del progetto e il controllo tipi prima di concludere il task.\n",
                "## Change verification\n- Always run the project test suite and type checks before finishing a task.\n"
            )
            .to_string(),
            keywords: &[
                "esegui i test",
                "fai girare i test",
                "lancia i test",
                "run test",
                "run the test",
                "mancano i test",
                "hai eseguito i test",
            ],
        },
        FrictionPattern {
            id: "sug_build_check",
            title: crate::tr!(
                "Includi il comando di build o typecheck in AGENTS.md",
                "Include the build or typecheck command in AGENTS.md"
            )
            .to_string(),
            evidence: crate::tr!(
                "sono emersi errori di compilazione o typecheck non verificati prima della consegna.",
                "compile or typecheck errors surfaced that were not verified before delivery."
            )
            .to_string(),
            markers: &["## Vincolo di build", "## Build requirement"],
            section: crate::tr!(
                "## Vincolo di build\n- Verificare con il comando di compilazione o di typecheck che non vi siano regressioni sintattiche o di tipo.\n",
                "## Build requirement\n- Use the build or typecheck command to confirm there are no syntax or type regressions.\n"
            )
            .to_string(),
            keywords: &[
                "non compila",
                "errore di build",
                "build fallita",
                "typecheck",
                "svelte-check",
                "does not compile",
                "build error",
            ],
        },
        FrictionPattern {
            id: "sug_scope_protection",
            title: crate::tr!(
                "Definisci il perimetro dei file in AGENTS.md",
                "Define the file scope in AGENTS.md"
            )
            .to_string(),
            evidence: crate::tr!(
                "hai dovuto ripristinare o vietare modifiche a file non correlati.",
                "you had to revert or forbid changes to unrelated files."
            )
            .to_string(),
            markers: &["## Perimetro delle modifiche", "## Change scope"],
            section: crate::tr!(
                "## Perimetro delle modifiche\n- Modificare esclusivamente i file necessari al task: nessuna configurazione o file non correlato senza richiesta esplicita.\n",
                "## Change scope\n- Only touch the files the task needs: no unrelated configuration or files without an explicit request.\n"
            )
            .to_string(),
            keywords: &[
                "non modificare quel file",
                "non toccare",
                "rimetti come prima",
                "ripristina il file",
                "avevi cambiato",
                "revert",
            ],
        },
    ]
}

/// Costruisce le proposte a partire dai prompt recenti. Funzione pura: la
/// lettura dello storico e di AGENTS.md resta nel comando.
fn build_suggestions(prompts: &[String], agents_md: Option<&str>) -> Vec<RuleSuggestion> {
    let lowered: Vec<String> = prompts.iter().map(|p| p.to_lowercase()).collect();
    let mut suggestions = Vec::new();

    for pattern in friction_patterns() {
        let already_documented = agents_md.is_some_and(|content| {
            let content = content.to_lowercase();
            pattern
                .markers
                .iter()
                .any(|marker| content.contains(&marker.to_lowercase()))
        });
        if already_documented {
            continue;
        }

        let occurrences = lowered
            .iter()
            .filter(|prompt| pattern.keywords.iter().any(|kw| prompt.contains(kw)))
            .count();
        if occurrences < MIN_OCCURRENCES {
            continue;
        }

        suggestions.push(RuleSuggestion {
            id: pattern.id.to_string(),
            title: pattern.title,
            reason: crate::tr!(
                format!("In {} prompt recenti {}", occurrences, pattern.evidence),
                format!("In {} recent prompts {}", occurrences, pattern.evidence)
            ),
            target_type: "agents_md".to_string(),
            target_file: "AGENTS.md".to_string(),
            proposed_content: pattern.section,
            occurrences,
        });
    }

    suggestions
}

/// Esegue l'analisi dell'attrito in modo sincrono isolando la connessione SQLite.
pub(crate) fn analyze_project_friction_sync(
    project_path: &str,
) -> Result<Vec<RuleSuggestion>, String> {
    // Storico assente (prima installazione, agente mai avviato): nessun
    // attrito da mostrare, non un errore da segnalare.
    let Ok(conn) = open_readonly_db("history.db") else {
        return Ok(Vec::new());
    };

    let mut stmt = conn
        .prepare(
            "SELECT prompt FROM history
             WHERE cwd = ?1 COLLATE NOCASE AND prompt NOT LIKE '/%'
             ORDER BY created_at DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![project_path, PROMPT_WINDOW as i64],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;

    let prompts: Vec<String> = rows.flatten().collect();
    let agents_md = fs::read_to_string(Path::new(project_path).join("AGENTS.md")).ok();

    Ok(build_suggestions(&prompts, agents_md.as_deref()))
}

#[command]
pub async fn analyze_project_friction(project_path: String) -> Result<Vec<RuleSuggestion>, String> {
    tokio::task::spawn_blocking(move || analyze_project_friction_sync(&project_path))
        .await
        .map_err(|e| crate::tr!(format!("Task analyze_project_friction fallito: {}", e), format!("Task analyze_project_friction failed: {}", e)))?
}

/// Applica la proposta di regola in modo sincrono con contenimento canonico e controllo symlink.
pub(crate) fn apply_rule_suggestion_sync(
    project_path: &str,
    target_rel_path: &str,
    append_content: &str,
) -> Result<(), String> {
    // Contenimento canonico riusato da `projects`: il genitore deve stare
    // dentro la radice reale del progetto, non solo sembrarlo.
    let base = crate::projects::canonical_project_base(project_path)?;
    let (parent_rel, leaf_name) = crate::projects::split_rel_path(target_rel_path)?;
    let parent_dir = crate::projects::resolve_parent_dir(&base, &parent_rel)?;
    let full_path = parent_dir.join(&leaf_name);

    // `symlink_metadata` non segue il collegamento: un `AGENTS.md` che punta
    // fuori dal progetto verrebbe altrimenti riscritto sulla destinazione.
    let meta = fs::symlink_metadata(&full_path).map_err(|_| {
        crate::tr!(
            format!(
                "File {} non trovato: inizializzalo prima di applicare la proposta",
                target_rel_path
            ),
            format!(
                "File {} not found: initialise it before applying the suggestion",
                target_rel_path
            )
        )
    })?;
    if meta.file_type().is_symlink() {
        return Err(crate::tr!(
            format!(
                "Percorso non ammesso: {} e' un collegamento e potrebbe puntare fuori dal progetto",
                target_rel_path
            ),
            format!(
                "Path not allowed: {} is a link and may point outside the project",
                target_rel_path
            )
        ));
    }
    if !meta.is_file() {
        return Err(crate::tr!(
            format!("Percorso non ammesso: {} non e' un file", target_rel_path),
            format!("Path not allowed: {} is not a file", target_rel_path)
        ));
    }

    let current = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let mut next = current.trim_end_matches(['\n', '\r']).to_string();
    next.push_str("\n\n");
    next.push_str(append_content.trim_start_matches(['\n', '\r']));
    if !next.ends_with('\n') {
        next.push('\n');
    }

    fs::write(&full_path, next).map_err(|e| e.to_string())
}

#[command]
pub async fn apply_rule_suggestion(
    project_path: String,
    target_rel_path: String,
    append_content: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        apply_rule_suggestion_sync(&project_path, &target_rel_path, &append_content)
    })
    .await
    .map_err(|e| crate::tr!(format!("Task apply_rule_suggestion fallito: {}", e), format!("Task apply_rule_suggestion failed: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[tokio::test]
    async fn censisce_agents_md_anche_quando_manca() {
        let root = temp_root("omp-studio-rules-vuoto");
        let summary = get_project_context(root.to_string_lossy().to_string())
            .await
            .unwrap();

        assert_eq!(summary.rules.len(), 2);
        assert_eq!(summary.rules[0].id, "agents_md");
        assert!(!summary.rules[0].exists);
        assert_eq!(summary.rules[1].id, "preview_rules");
        assert!(!summary.rules[1].exists);
    }

    #[tokio::test]
    async fn censisce_regole_modulari_e_file_alternativi() {
        let root = temp_root("omp-studio-rules-censimento");
        fs::write(root.join("AGENTS.md"), "# A").unwrap();
        fs::write(root.join("CLAUDE.md"), "# C").unwrap();
        fs::create_dir_all(root.join(".omp/rules")).unwrap();
        fs::write(root.join(".omp/rules/zeta.md"), "z").unwrap();
        fs::write(root.join(".omp/rules/alfa.md"), "a").unwrap();
        fs::write(root.join(".omp/rules/note.txt"), "ignorato").unwrap();

        let summary = get_project_context(root.to_string_lossy().to_string())
            .await
            .unwrap();
        let paths: Vec<&str> = summary.rules.iter().map(|r| r.path.as_str()).collect();

        assert_eq!(
            paths,
            vec![
                "AGENTS.md",
                ".omp/preview.md",
                ".omp/rules/alfa.md",
                ".omp/rules/zeta.md",
                "CLAUDE.md"
            ]
        );
        assert!(summary.rules[0].exists);
        assert!(!summary.rules[1].exists);
    }

    #[tokio::test]
    async fn censisce_skill_di_progetto_con_percorso_relativo() {
        let root = temp_root("omp-studio-rules-skill");
        fs::create_dir_all(root.join(".omp/skills/deploy")).unwrap();
        fs::write(
            root.join(".omp/skills/deploy/SKILL.md"),
            "---\nname: deploy\ndescription: Pubblica il progetto\n---\n\nCorpo.\n",
        )
        .unwrap();
        fs::write(
            root.join(".omp/skills/lint.md"),
            "# Lint\n\nControlla lo stile.\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".omp/skills/incompleta")).unwrap();

        let summary = get_project_context(root.to_string_lossy().to_string())
            .await
            .unwrap();
        let project: Vec<&SkillItem> = summary
            .skills
            .iter()
            .filter(|s| s.scope == "project")
            .collect();

        assert_eq!(project.len(), 2);
        assert_eq!(project[0].name, "deploy");
        assert_eq!(
            project[0].rel_path.as_deref(),
            Some(".omp/skills/deploy/SKILL.md")
        );
        assert_eq!(
            project[0].description.as_deref(),
            Some("Pubblica il progetto")
        );
        assert_eq!(project[1].name, "lint");
        assert_eq!(project[1].rel_path.as_deref(), Some(".omp/skills/lint.md"));
        assert_eq!(
            project[1].description.as_deref(),
            Some("Controlla lo stile.")
        );
    }

    #[tokio::test]
    async fn crea_agents_md_una_sola_volta() {
        let root = temp_root("omp-studio-rules-init");
        let path = root.to_string_lossy().to_string();

        assert_eq!(
            create_project_agents_md(path.clone()).await.unwrap(),
            "AGENTS.md"
        );
        fs::write(root.join("AGENTS.md"), "contenuto utente").unwrap();
        assert_eq!(create_project_agents_md(path).await.unwrap(), "AGENTS.md");
        assert_eq!(
            fs::read_to_string(root.join("AGENTS.md")).unwrap(),
            "contenuto utente"
        );
    }

    #[tokio::test]
    async fn crea_agents_md_rifiuta_radice_non_valida() {
        assert!(create_project_agents_md("".to_string()).await.is_err());
        assert!(
            create_project_agents_md("C:/percorso/non/esistente/xyz123".to_string())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn crea_agents_md_rifiuta_symlink_esistente_o_dangling() {
        let root = temp_root("omp-studio-rules-create-symlink");
        let outside = temp_root("omp-studio-rules-create-symlink-target");
        let secret = outside.join("AGENTS.md");
        fs::write(&secret, "# Fuori\n").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("AGENTS.md")).unwrap();

        let err = create_project_agents_md(root.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert!(
            err.to_lowercase().contains("link") || err.contains("collegamento"),
            "errore inatteso: {}",
            err
        );
        assert_eq!(fs::read_to_string(&secret).unwrap(), "# Fuori\n");

        // Dangling symlink: cancelliamo il target esterno
        let _ = fs::remove_file(&secret);
        let err_dangling = create_project_agents_md(root.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert!(
            err_dangling.to_lowercase().contains("link") || err_dangling.contains("collegamento"),
            "errore inatteso per dangling symlink: {}",
            err_dangling
        );
    }

    #[test]
    fn propone_solo_attrito_ripetuto() {
        let uno = vec!["esegui i test prima di finire".to_string()];
        assert!(build_suggestions(&uno, None).is_empty());

        let due = vec![
            "Esegui i test prima di finire".to_string(),
            "mancano i test su questo modulo".to_string(),
        ];
        let suggestions = build_suggestions(&due, None);
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].id, "sug_verification_step");
        assert_eq!(suggestions[0].occurrences, 2);
        assert_eq!(suggestions[0].target_file, "AGENTS.md");
    }

    #[test]
    fn tace_se_la_regola_e_gia_scritta() {
        let prompts = vec![
            "non compila".to_string(),
            "errore di build sul frontend".to_string(),
        ];
        assert_eq!(build_suggestions(&prompts, None).len(), 1);
        assert!(
            build_suggestions(&prompts, Some("# AGENTS\n\n## Vincolo di build\n- ...\n"))
                .is_empty()
        );
    }

    #[tokio::test]
    async fn applica_la_proposta_normalizzando_le_righe() {
        let root = temp_root("omp-studio-rules-apply");
        fs::write(root.join("AGENTS.md"), "# AGENTS\n\nTesto.\n\n\n").unwrap();

        apply_rule_suggestion(
            root.to_string_lossy().to_string(),
            "AGENTS.md".to_string(),
            "## Vincolo di build\n- Verificare.\n".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(
            fs::read_to_string(root.join("AGENTS.md")).unwrap(),
            "# AGENTS\n\nTesto.\n\n## Vincolo di build\n- Verificare.\n"
        );
    }

    #[tokio::test]
    async fn rifiuta_percorsi_fuori_dal_progetto() {
        let root = temp_root("omp-studio-rules-traversal");
        fs::write(root.join("AGENTS.md"), "# AGENTS\n").unwrap();
        let path = root.to_string_lossy().to_string();

        assert!(
            apply_rule_suggestion(path.clone(), "../AGENTS.md".to_string(), "x\n".to_string())
                .await
                .is_err()
        );
        assert!(
            apply_rule_suggestion(path.clone(), "".to_string(), "x\n".to_string())
                .await
                .is_err()
        );
        assert!(
            apply_rule_suggestion(path, "DA_CREARE.md".to_string(), "x\n".to_string())
                .await
                .is_err()
        );
    }

    /// Un `AGENTS.md` che e' un collegamento a un file esterno non deve poter
    /// essere riscritto: la proposta agirebbe fuori dal progetto.
    #[tokio::test]
    #[cfg(unix)]
    async fn rifiuta_un_collegamento_che_punta_fuori() {
        let root = temp_root("omp-studio-rules-symlink");
        let outside = temp_root("omp-studio-rules-symlink-target");
        let secret = outside.join("AGENTS.md");
        fs::write(&secret, "# Fuori\n").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("AGENTS.md")).unwrap();

        let err = apply_rule_suggestion(
            root.to_string_lossy().to_string(),
            "AGENTS.md".to_string(),
            "## Iniettato\n".to_string(),
        )
        .await
        .unwrap_err();

        assert!(
            err.to_lowercase().contains("link") || err.contains("collegamento"),
            "errore inatteso: {}",
            err
        );
        assert_eq!(fs::read_to_string(&secret).unwrap(), "# Fuori\n");
    }

    #[tokio::test]
    async fn ensure_preview_rules_crea_da_design_e_product_radice() {
        let root = temp_root("omp-studio-preview-rules-root");
        fs::write(root.join("DESIGN.md"), "# Design\nColori primari: blu\n").unwrap();
        fs::write(root.join("PRODUCT.md"), "# Prodotto\nDashboard gestionale\n").unwrap();
        let path = root.to_string_lossy().to_string();

        let created = ensure_preview_rules(path.clone(), "default".to_string())
            .await
            .unwrap();
        assert!(created);

        let target = root.join(".omp").join("preview.md");
        assert!(target.is_file());
        let text = fs::read_to_string(&target).unwrap();
        assert!(text.contains("DESIGN.md -->"), "marcatore di provenienza mancante: {text}");
        assert!(text.contains("# Design\nColori primari: blu\n"));
        assert!(text.contains("PRODUCT.md -->"), "marcatore di provenienza mancante: {text}");
        assert!(text.contains("# Prodotto\nDashboard gestionale\n"));

        // Seconda chiamata: non sovrascrive
        let created_again = ensure_preview_rules(path, "default".to_string())
            .await
            .unwrap();
        assert!(!created_again);
    }

    #[tokio::test]
    async fn ensure_preview_rules_crea_da_docs_quando_mancano_nella_radice() {
        let root = temp_root("omp-studio-preview-rules-docs");
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs").join("DESIGN.md"), "# Design in docs\n").unwrap();
        fs::write(root.join("docs").join("PRODUCT.md"), "# Product in docs\n").unwrap();
        let path = root.to_string_lossy().to_string();

        let created = ensure_preview_rules(path, "default".to_string())
            .await
            .unwrap();
        assert!(created);

        let text = fs::read_to_string(root.join(".omp").join("preview.md")).unwrap();
        assert!(text.contains("docs/DESIGN.md -->"), "marcatore di provenienza mancante: {text}");
        assert!(text.contains("# Design in docs\n"));
        assert!(text.contains("docs/PRODUCT.md -->"), "marcatore di provenienza mancante: {text}");
        assert!(text.contains("# Product in docs\n"));
    }

    #[tokio::test]
    async fn ensure_preview_rules_usa_default_quando_entrambi_mancano() {
        let root = temp_root("omp-studio-preview-rules-default");
        let path = root.to_string_lossy().to_string();

        let created = ensure_preview_rules(path, "# Modello default\n".to_string())
            .await
            .unwrap();
        assert!(created);

        let text = fs::read_to_string(root.join(".omp").join("preview.md")).unwrap();
        assert_eq!(text, "# Modello default\n");
    }

    #[tokio::test]
    async fn ensure_preview_rules_non_sovrascrive_file_esistente() {
        let root = temp_root("omp-studio-preview-rules-esistente");
        fs::create_dir_all(root.join(".omp")).unwrap();
        fs::write(root.join(".omp").join("preview.md"), "# File utente esistente\n").unwrap();
        fs::write(root.join("DESIGN.md"), "# Nuovo design\n").unwrap();
        let path = root.to_string_lossy().to_string();

        let created = ensure_preview_rules(path, "default".to_string())
            .await
            .unwrap();
        assert!(!created);

        let text = fs::read_to_string(root.join(".omp").join("preview.md")).unwrap();
        assert_eq!(text, "# File utente esistente\n");
    }
}
