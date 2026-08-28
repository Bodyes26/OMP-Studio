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

/// File di linee guida alternativi riconosciuti nella radice del progetto.
const ALT_CONTEXT_FILES: &[(&str, &str)] = &[
    ("CLAUDE.md", "Istruzioni di contesto Claude"),
    ("GEMINI.md", "Istruzioni di contesto Gemini"),
    (".impeccable.md", "Regole e principi interfaccia"),
];

#[command]
pub fn get_project_context(project_path: String) -> Result<ProjectContextSummary, String> {
    let root = Path::new(&project_path);
    if !root.is_dir() {
        return Err(format!(
            "Directory di progetto non trovata: {}",
            project_path
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
        description: Some("Linee guida primarie e convenzioni operative del progetto".to_string()),
    });

    // 2. Regole modulari in .omp/rules/*.md
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
                description: Some("Regola di contesto di progetto".to_string()),
            });
        }
    }
    omp_rules.sort_by(|left, right| left.name.cmp(&right.name));
    rules.append(&mut omp_rules);

    // 3. File di contesto aggiuntivi nella radice.
    for (filename, desc) in ALT_CONTEXT_FILES {
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

    // 4. Skill di progetto: apribili nell'editor, quindi con percorso relativo.
    scan_skills_directory(
        &root.join(".omp").join("skills"),
        "project",
        Some(".omp/skills"),
        &mut skills,
    );

    // 5. Skill globali e managed: sola ispezione dal file manager.
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

const DEFAULT_AGENTS_MD: &str = r#"# AGENTS.md

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
"#;

#[command]
pub fn create_project_agents_md(project_path: String) -> Result<String, String> {
    let root = Path::new(&project_path);
    if !root.is_dir() {
        return Err(format!(
            "Directory di progetto non trovata: {}",
            project_path
        ));
    }
    let target = root.join("AGENTS.md");
    if target.exists() {
        return Ok("AGENTS.md".to_string());
    }
    fs::write(&target, DEFAULT_AGENTS_MD)
        .map_err(|e| format!("Errore durante la creazione di AGENTS.md: {}", e))?;
    Ok("AGENTS.md".to_string())
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
    title: &'static str,
    /// Completa la frase "In N sessioni recenti ...".
    evidence: &'static str,
    /// Intestazione della sezione: se e' gia' in AGENTS.md la proposta tace.
    marker: &'static str,
    section: &'static str,
    keywords: &'static [&'static str],
}

const FRICTION_PATTERNS: &[FrictionPattern] = &[
    FrictionPattern {
        id: "sug_verification_step",
        title: "Aggiungi la verifica dei test a AGENTS.md",
        evidence: "hai dovuto chiedere esplicitamente di verificare i test.",
        marker: "## Verifica delle modifiche",
        section: "## Verifica delle modifiche\n- Eseguire sempre la suite di test del progetto e il controllo tipi prima di concludere il task.\n",
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
        title: "Includi il comando di build o typecheck in AGENTS.md",
        evidence: "sono emersi errori di compilazione o typecheck non verificati prima della consegna.",
        marker: "## Vincolo di build",
        section: "## Vincolo di build\n- Verificare con il comando di compilazione o di typecheck che non vi siano regressioni sintattiche o di tipo.\n",
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
        title: "Definisci il perimetro dei file in AGENTS.md",
        evidence: "hai dovuto ripristinare o vietare modifiche a file non correlati.",
        marker: "## Perimetro delle modifiche",
        section: "## Perimetro delle modifiche\n- Modificare esclusivamente i file necessari al task: nessuna configurazione o file non correlato senza richiesta esplicita.\n",
        keywords: &[
            "non modificare quel file",
            "non toccare",
            "rimetti come prima",
            "ripristina il file",
            "avevi cambiato",
            "revert",
        ],
    },
];

/// Costruisce le proposte a partire dai prompt recenti. Funzione pura: la
/// lettura dello storico e di AGENTS.md resta nel comando.
fn build_suggestions(prompts: &[String], agents_md: Option<&str>) -> Vec<RuleSuggestion> {
    let lowered: Vec<String> = prompts.iter().map(|p| p.to_lowercase()).collect();
    let mut suggestions = Vec::new();

    for pattern in FRICTION_PATTERNS {
        if agents_md.is_some_and(|content| {
            content
                .to_lowercase()
                .contains(&pattern.marker.to_lowercase())
        }) {
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
            title: pattern.title.to_string(),
            reason: format!("In {} prompt recenti {}", occurrences, pattern.evidence),
            target_type: "agents_md".to_string(),
            target_file: "AGENTS.md".to_string(),
            proposed_content: pattern.section.to_string(),
            occurrences,
        });
    }

    suggestions
}

#[command]
pub fn analyze_project_friction(project_path: String) -> Result<Vec<RuleSuggestion>, String> {
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
        .query_map(rusqlite::params![&project_path, PROMPT_WINDOW as i64], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;

    let prompts: Vec<String> = rows.flatten().collect();
    let agents_md = fs::read_to_string(Path::new(&project_path).join("AGENTS.md")).ok();

    Ok(build_suggestions(&prompts, agents_md.as_deref()))
}

#[command]
pub fn apply_rule_suggestion(
    project_path: String,
    target_rel_path: String,
    append_content: String,
) -> Result<(), String> {
    // Contenimento canonico riusato da `projects`: il genitore deve stare
    // dentro la radice reale del progetto, non solo sembrarlo.
    let base = crate::projects::canonical_project_base(&project_path)?;
    let (parent_rel, leaf_name) = crate::projects::split_rel_path(&target_rel_path)?;
    let parent_dir = crate::projects::resolve_parent_dir(&base, &parent_rel)?;
    let full_path = parent_dir.join(&leaf_name);

    // `symlink_metadata` non segue il collegamento: un `AGENTS.md` che punta
    // fuori dal progetto verrebbe altrimenti riscritto sulla destinazione.
    let meta = fs::symlink_metadata(&full_path).map_err(|_| {
        format!(
            "File {} non trovato: inizializzalo prima di applicare la proposta",
            target_rel_path
        )
    })?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "Percorso non ammesso: {} e' un collegamento e potrebbe puntare fuori dal progetto",
            target_rel_path
        ));
    }
    if !meta.is_file() {
        return Err(format!(
            "Percorso non ammesso: {} non e' un file",
            target_rel_path
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn censisce_agents_md_anche_quando_manca() {
        let root = temp_root("omp-studio-rules-vuoto");
        let summary = get_project_context(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(summary.rules.len(), 1);
        assert_eq!(summary.rules[0].id, "agents_md");
        assert!(!summary.rules[0].exists);
    }

    #[test]
    fn censisce_regole_modulari_e_file_alternativi() {
        let root = temp_root("omp-studio-rules-censimento");
        fs::write(root.join("AGENTS.md"), "# A").unwrap();
        fs::write(root.join("CLAUDE.md"), "# C").unwrap();
        fs::create_dir_all(root.join(".omp/rules")).unwrap();
        fs::write(root.join(".omp/rules/zeta.md"), "z").unwrap();
        fs::write(root.join(".omp/rules/alfa.md"), "a").unwrap();
        fs::write(root.join(".omp/rules/note.txt"), "ignorato").unwrap();

        let summary = get_project_context(root.to_string_lossy().to_string()).unwrap();
        let paths: Vec<&str> = summary.rules.iter().map(|r| r.path.as_str()).collect();

        assert_eq!(
            paths,
            vec![
                "AGENTS.md",
                ".omp/rules/alfa.md",
                ".omp/rules/zeta.md",
                "CLAUDE.md"
            ]
        );
        assert!(summary.rules[0].exists);
    }

    #[test]
    fn censisce_skill_di_progetto_con_percorso_relativo() {
        let root = temp_root("omp-studio-rules-skill");
        fs::create_dir_all(root.join(".omp/skills/deploy")).unwrap();
        fs::write(
            root.join(".omp/skills/deploy/SKILL.md"),
            "---\nname: deploy\ndescription: Pubblica il progetto\n---\n\nCorpo.\n",
        )
        .unwrap();
        fs::write(root.join(".omp/skills/lint.md"), "# Lint\n\nControlla lo stile.\n").unwrap();
        fs::create_dir_all(root.join(".omp/skills/incompleta")).unwrap();

        let summary = get_project_context(root.to_string_lossy().to_string()).unwrap();
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
        assert_eq!(project[0].description.as_deref(), Some("Pubblica il progetto"));
        assert_eq!(project[1].name, "lint");
        assert_eq!(project[1].rel_path.as_deref(), Some(".omp/skills/lint.md"));
        assert_eq!(project[1].description.as_deref(), Some("Controlla lo stile."));
    }

    #[test]
    fn crea_agents_md_una_sola_volta() {
        let root = temp_root("omp-studio-rules-init");
        let path = root.to_string_lossy().to_string();

        assert_eq!(create_project_agents_md(path.clone()).unwrap(), "AGENTS.md");
        fs::write(root.join("AGENTS.md"), "contenuto utente").unwrap();
        assert_eq!(create_project_agents_md(path).unwrap(), "AGENTS.md");
        assert_eq!(
            fs::read_to_string(root.join("AGENTS.md")).unwrap(),
            "contenuto utente"
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
        assert!(build_suggestions(&prompts, Some("# AGENTS\n\n## Vincolo di build\n- ...\n")).is_empty());
    }

    #[test]
    fn applica_la_proposta_normalizzando_le_righe() {
        let root = temp_root("omp-studio-rules-apply");
        fs::write(root.join("AGENTS.md"), "# AGENTS\n\nTesto.\n\n\n").unwrap();

        apply_rule_suggestion(
            root.to_string_lossy().to_string(),
            "AGENTS.md".to_string(),
            "## Vincolo di build\n- Verificare.\n".to_string(),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(root.join("AGENTS.md")).unwrap(),
            "# AGENTS\n\nTesto.\n\n## Vincolo di build\n- Verificare.\n"
        );
    }

    #[test]
    fn rifiuta_percorsi_fuori_dal_progetto() {
        let root = temp_root("omp-studio-rules-traversal");
        fs::write(root.join("AGENTS.md"), "# AGENTS\n").unwrap();
        let path = root.to_string_lossy().to_string();

        assert!(apply_rule_suggestion(
            path.clone(),
            "../AGENTS.md".to_string(),
            "x\n".to_string()
        )
        .is_err());
        assert!(apply_rule_suggestion(
            path.clone(),
            "".to_string(),
            "x\n".to_string()
        )
        .is_err());
        assert!(apply_rule_suggestion(
            path,
            "DA_CREARE.md".to_string(),
            "x\n".to_string()
        )
        .is_err());
    }

    /// Un `AGENTS.md` che e' un collegamento a un file esterno non deve poter
    /// essere riscritto: la proposta agirebbe fuori dal progetto.
    #[test]
    #[cfg(unix)]
    fn rifiuta_un_collegamento_che_punta_fuori() {
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
        .unwrap_err();

        assert!(err.contains("collegamento"), "errore inatteso: {}", err);
        assert_eq!(fs::read_to_string(&secret).unwrap(), "# Fuori\n");
    }
}
