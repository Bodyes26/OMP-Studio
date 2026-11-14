//! Registro delle famiglie di modelli del setup grafico (SET-042).
//!
//! Una famiglia e' un'identita' editoriale ("Opus", "Sol", "Flash Lite"), non
//! un numero di versione: la versione si ricava dall'ID e si confronta **solo
//! dentro la famiglia**. I pattern sono ancorati e ammettono esattamente la
//! forma canonica dell'ID, quindi preview, snapshot datati e varianti
//! commerciali (`-fast`, `-1m`, `-1m-fast`, `:free`) non vengono assorbiti in
//! una famiglia conosciuta: restano selezionabili a mano, ma il resolver
//! deterministico non li propone.
//!
//! Il nome visualizzato non e' mai la fonte di famiglia o versione: nel
//! catalogo reale `gemini-2.5-flash-lite` si chiama "Gemini 3.5 Flash Lite",
//! e vince l'ID.

use super::catalog::CatalogModel;
use regex::Regex;
use std::cmp::Ordering;
use std::sync::LazyLock;

/// Proprietario editoriale della famiglia, distinto dal provider di accesso:
/// un aggregatore espone modelli Anthropic ma la famiglia resta di Anthropic.
/// Serve a rifiutare un ID con namespace che contraddice la famiglia
/// (per esempio `openai/claude-opus-5-5`).
pub const OWNER_ANTHROPIC: &str = "anthropic";
pub const OWNER_OPENAI: &str = "openai";
pub const OWNER_GOOGLE: &str = "google";
pub const OWNER_XAI: &str = "xai";
pub const OWNER_ZAI: &str = "zai";
pub const OWNER_DEEPSEEK: &str = "deepseek";
pub const OWNER_MISTRAL: &str = "mistral";
pub const OWNER_CURSOR: &str = "cursor";

/// Dove un pattern vale. Alcune famiglie esistono solo su un provider
/// (`cursor-grok-*` e' un ID di Cursor, non di xAI): restringere il pattern
/// evita di riconoscere per sbaglio un ID omonimo su un'altra route.
pub enum ProviderScope {
    Any,
    Only(&'static [&'static str]),
}

pub struct FamilyDefinition {
    /// ID editoriale, lo stesso usato dalle tabelle di policy. Il nome
    /// leggibile ("Opus", "Flash Lite") lo traduce il frontend da questo ID:
    /// nessun testo inglese scritto nel Rust.
    pub id: &'static str,
    pub owner: &'static str,
    /// Regex ancorata sull'ID **dopo** lo strip del namespace. Il gruppo 1 e'
    /// la versione, con i componenti separati da `version_separator`.
    pub pattern: &'static str,
    pub version_separator: char,
    pub providers: ProviderScope,
}

const CURSOR_ONLY: &[&str] = &["cursor"];

/// Tabella (ii) di `local://roles-design.md`. "NV" nel documento significa
/// "pattern non verificato su catalogo reale": resta qui perche' la policy lo
/// referenzia, e un ID che non corrisponde semplicemente non produce nulla.
pub static REGISTRY: &[FamilyDefinition] = &[
    // --- Anthropic: versioni a componenti separate da '-' ---
    FamilyDefinition {
        id: "anthropic.opus",
        owner: OWNER_ANTHROPIC,
        pattern: r"^claude-opus-([0-9]+(?:-[0-9]+)?)$",
        version_separator: '-',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "anthropic.sonnet",
        owner: OWNER_ANTHROPIC,
        pattern: r"^claude-sonnet-([0-9]+(?:-[0-9]+)?)$",
        version_separator: '-',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "anthropic.haiku",
        owner: OWNER_ANTHROPIC,
        pattern: r"^claude-haiku-([0-9]+(?:-[0-9]+)?)$",
        version_separator: '-',
        providers: ProviderScope::Any,
    },
    // --- OpenAI: le varianti sol/terra/luna sono famiglie diverse, non
    // suffissi da togliere; `gpt-X` nudo e' un'altra famiglia ancora. ---
    FamilyDefinition {
        id: "openai.sol",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-sol$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.terra",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-terra$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.luna",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-luna$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.astra",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-astra$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.codex",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-codex$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.mini",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)-mini$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "openai.gpt",
        owner: OWNER_OPENAI,
        pattern: r"^gpt-([0-9]+(?:\.[0-9]+)*)$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    // --- Google: `flash` e `flash-lite` sono famiglie distinte ---
    FamilyDefinition {
        id: "google.pro",
        owner: OWNER_GOOGLE,
        pattern: r"^gemini-([0-9]+(?:\.[0-9]+)*)-pro$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "google.flash_lite",
        owner: OWNER_GOOGLE,
        pattern: r"^gemini-([0-9]+(?:\.[0-9]+)*)-flash-lite$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "google.flash",
        owner: OWNER_GOOGLE,
        pattern: r"^gemini-([0-9]+(?:\.[0-9]+)*)-flash$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "cursor.composer",
        owner: OWNER_CURSOR,
        pattern: r"^composer-([0-9]+(?:\.[0-9]+)*)$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    // --- DeepSeek: `deepseek-v` e' parte del nome della famiglia ---
    FamilyDefinition {
        id: "deepseek.pro",
        owner: OWNER_DEEPSEEK,
        pattern: r"^deepseek-v([0-9]+(?:\.[0-9]+)*)-pro$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "deepseek.flash",
        owner: OWNER_DEEPSEEK,
        pattern: r"^deepseek-v([0-9]+(?:\.[0-9]+)*)-flash$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "deepseek.chat",
        owner: OWNER_DEEPSEEK,
        pattern: r"^deepseek-chat$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "deepseek.reasoner",
        owner: OWNER_DEEPSEEK,
        pattern: r"^deepseek-reasoner$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    // --- xAI: su Cursor gli ID sono prefissati `cursor-grok-` ---
    FamilyDefinition {
        id: "xai.grok",
        owner: OWNER_XAI,
        pattern: r"^grok-([0-9]+(?:\.[0-9]+)*)$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "xai.grok",
        owner: OWNER_XAI,
        pattern: r"^cursor-grok-([0-9]+(?:\.[0-9]+)*)$",
        version_separator: '.',
        providers: ProviderScope::Only(CURSOR_ONLY),
    },
    FamilyDefinition {
        id: "xai.grok_mini",
        owner: OWNER_XAI,
        pattern: r"^grok-([0-9]+(?:\.[0-9]+)*)-mini$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    // --- Z.ai: `flashx` non e' `flash` e non entra ---
    FamilyDefinition {
        id: "zai.glm",
        owner: OWNER_ZAI,
        pattern: r"^glm-([0-9]+(?:\.[0-9]+)*)$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "zai.glm_flash",
        owner: OWNER_ZAI,
        pattern: r"^glm-([0-9]+(?:\.[0-9]+)*)-flash$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    // --- Mistral: solo alias ufficiali. Nessun numero di versione inventato
    // da un eventuale ID datato: gli alias non dichiarano una versione. ---
    FamilyDefinition {
        id: "mistral.large",
        owner: OWNER_MISTRAL,
        pattern: r"^mistral-large-latest$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "mistral.small",
        owner: OWNER_MISTRAL,
        pattern: r"^mistral-small-latest$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
    FamilyDefinition {
        id: "mistral.codestral",
        owner: OWNER_MISTRAL,
        pattern: r"^codestral-latest$",
        version_separator: '.',
        providers: ProviderScope::Any,
    },
];

/// Token che dichiarano una versione non definitiva. Sono confrontati come
/// token delimitati dell'ID (e del nome visualizzato, come controllo
/// aggiuntivo), mai come sottostringhe arbitrarie.
const PRERELEASE_TOKENS: &[&str] = &["preview", "experimental", "exp", "alpha", "beta", "rc"];

/// Varianti commerciali o di contesto che il setup non propone mai in
/// automatico: cambiano costo, quota o disponibilita' rispetto alla forma
/// canonica della famiglia. Restano scegliibili a mano.
const VARIANT_TOKENS: &[&str] = &["fast", "ultrafast", "highspeed", "1m", "free"];

/// Prefissi di namespace ammessi, con il proprietario che assegnano. Solo gli
/// aggregatori che pubblicano ID prefissati hanno una regola: per gli altri un
/// prefisso sconosciuto non viene mai rimosso (`split('/').last()` produrrebbe
/// famiglie inesistenti).
fn namespace_table(provider: &str) -> Option<&'static [(&'static str, &'static str)]> {
    const COMMANDCODE: &[(&str, &str)] = &[
        ("anthropic", OWNER_ANTHROPIC),
        ("openai", OWNER_OPENAI),
        ("google", OWNER_GOOGLE),
        ("deepseek", OWNER_DEEPSEEK),
        ("meta", "meta"),
        ("inclusionai", "inclusionai"),
        ("meituan", "meituan"),
        ("xai", OWNER_XAI),
        ("x-ai", OWNER_XAI),
        ("z-ai", OWNER_ZAI),
        ("mistral", OWNER_MISTRAL),
        ("mistralai", OWNER_MISTRAL),
    ];
    const OPENROUTER: &[(&str, &str)] = &[
        ("anthropic", OWNER_ANTHROPIC),
        ("openai", OWNER_OPENAI),
        ("google", OWNER_GOOGLE),
        ("deepseek", OWNER_DEEPSEEK),
        ("x-ai", OWNER_XAI),
        ("z-ai", OWNER_ZAI),
        ("mistralai", OWNER_MISTRAL),
    ];
    match provider {
        "commandcode" => Some(COMMANDCODE),
        // Regola proposta, non verificata su un catalogo reale: OpenCode e
        // OpenRouter usano gli stessi prefissi di proprietario.
        "openrouter" | "opencode-zen" | "opencode-go" => Some(OPENROUTER),
        _ => None,
    }
}

/// ID normalizzato: l'eventuale namespace e' stato rimosso e il proprietario
/// dichiarato dal prefisso resta come indizio da incrociare con la famiglia.
struct NormalizedId<'a> {
    id: &'a str,
    owner_hint: Option<&'static str>,
}

fn normalize_namespace<'a>(provider: &str, id: &'a str) -> NormalizedId<'a> {
    if let (Some(table), Some((prefix, rest))) = (namespace_table(provider), id.split_once('/')) {
        if let Some((_, owner)) = table.iter().find(|(name, _)| *name == prefix) {
            return NormalizedId {
                id: rest,
                owner_hint: Some(owner),
            };
        }
        // Prefisso non documentato: nessuno strip, l'ID intero non
        // corrispondera' a nessun pattern ancorato.
    }
    NormalizedId {
        id,
        owner_hint: None,
    }
}

/// Token dell'ID: separatori `-`, `_`, `.`, `/`, `:` e spazi. Il confronto avviene
/// su token interi, cosi' `exp` non intercetta `experimental` e `fast` non
/// intercetta `flash`.
fn tokens(value: &str) -> impl Iterator<Item = &str> {
    value.split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| !t.is_empty())
}

fn has_token(value: &str, wanted: &[&str]) -> bool {
    tokens(&value.to_ascii_lowercase()).any(|t| wanted.contains(&t))
}

/// Snapshot datato nel selector: un token di 8 cifre (`20251101`). Le forme
/// brevi come `1017`/`1019` compaiono solo su provider che le documentano e
/// non raggiungono mai un pattern canonico, quindi non servono regole
/// universali che potrebbero scambiare una taglia per una data.
fn has_dated_snapshot(id: &str) -> bool {
    tokens(id).any(|t| t.len() == 8 && t.chars().all(|c| c.is_ascii_digit()))
}

/// Vero se il modello dichiara una versione non definitiva.
pub fn is_prerelease(model: &CatalogModel) -> bool {
    has_token(&model.id, PRERELEASE_TOKENS) || has_token(&model.name, PRERELEASE_TOKENS)
}

/// Vero se l'ID porta una variante che il setup non propone in automatico.
pub fn is_excluded_variant(model: &CatalogModel) -> bool {
    has_token(&model.id, VARIANT_TOKENS)
}

/// Un modello e' ammesso nel setup solo se e' una chat, non e' una versione
/// non definitiva, non e' uno snapshot datato e non e' una variante esclusa.
/// Vale sia per il riconoscimento delle famiglie sia per l'euristica.
pub fn is_eligible_for_setup(model: &CatalogModel) -> bool {
    model.kind == "chat"
        && !is_prerelease(model)
        && !has_dated_snapshot(&model.id)
        && !is_excluded_variant(model)
}

/// Regex compilate una volta sola, nello stesso ordine della tabella: il
/// registro e' statico, quindi l'inizializzazione vive con la costante.
static COMPILED: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    REGISTRY
        .iter()
        .map(|family| {
            Regex::new(family.pattern)
                .unwrap_or_else(|e| panic!("pattern non valido per {}: {}", family.id, e))
        })
        .collect()
});

fn compiled() -> &'static [Regex] {
    &COMPILED
}

/// Famiglia riconosciuta e versione ricavata dall'ID.
pub struct Classified {
    pub family: &'static FamilyDefinition,
    pub version: Vec<u32>,
}

/// Riconosce famiglia e versione di un modello sul **suo** provider.
///
/// Restituisce `None` per tutto cio' che il registro non riconosce: quei
/// modelli restano nel selettore manuale e sono materiale dell'euristica, ma
/// non possono diventare una scelta curata.
pub fn classify(provider: &str, model: &CatalogModel) -> Option<Classified> {
    if !is_eligible_for_setup(model) {
        return None;
    }

    let normalized = normalize_namespace(provider, &model.id);

    for (family, regex) in REGISTRY.iter().zip(compiled()) {
        let allowed = match &family.providers {
            ProviderScope::Any => true,
            ProviderScope::Only(list) => list.contains(&provider),
        };
        if !allowed {
            continue;
        }
        // Un namespace che contraddice la famiglia (per esempio
        // `openai/claude-opus-5-5`) non e' quella famiglia su questa route.
        if let Some(hint) = normalized.owner_hint {
            if hint != family.owner {
                continue;
            }
        }
        let Some(captures) = regex.captures(normalized.id) else {
            continue;
        };
        let version = captures
            .get(1)
            .map(|m| {
                m.as_str()
                    .split(family.version_separator)
                    .filter_map(|part| part.parse::<u32>().ok())
                    .collect::<Vec<u32>>()
            })
            .unwrap_or_default();
        return Some(Classified { family, version });
    }

    None
}

/// Ordina due versioni numeriche completando con zeri: `5.10 > 5.9`,
/// `5.5 > 5`, `6.1 > 6`. Mai un confronto fra stringhe.
pub fn compare_versions(a: &[u32], b: &[u32]) -> Ordering {
    let len = a.len().max(b.len());
    for index in 0..len {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    Ordering::Equal
}

/// Versione dichiarata dal nome visualizzato, solo per segnalare le
/// incongruenze con l'ID (il nome non e' mai la fonte, vedi `gemini-2.5-flash-lite`
/// che si presenta come "3.5").
pub fn version_from_name(name: &str) -> Option<Vec<u32>> {
    let start = name.find(|c: char| c.is_ascii_digit())?;
    let candidate: String = name[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    let parts: Vec<u32> = candidate
        .split(['.', '-'])
        .filter_map(|part| part.parse::<u32>().ok())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(provider: &str, id: &str, name: &str) -> CatalogModel {
        CatalogModel {
            id: id.to_string(),
            name: name.to_string(),
            provider: provider.to_string(),
            selector: format!("{}/{}", provider, id),
            kind: "chat".to_string(),
            context_window: None,
            max_tokens: None,
            reasoning: None,
            thinking: None,
            input: None,
            cost: None,
            pricing_status: None,
        }
    }

    fn version_of(provider: &str, id: &str) -> Option<Vec<u32>> {
        classify(provider, &model(provider, id, id)).map(|c| c.version)
    }

    #[test]
    fn versioni_anthropic_a_componenti_separati() {
        assert_eq!(version_of("anthropic", "claude-opus-5-5").as_deref(), Some(&[5, 5][..]));
        assert_eq!(version_of("anthropic", "claude-opus-5").as_deref(), Some(&[5][..]));
        assert_eq!(version_of("cursor", "claude-sonnet-4").as_deref(), Some(&[4][..]));
    }

    #[test]
    fn versioni_openai_a_punti() {
        assert_eq!(version_of("openai-codex", "gpt-6.1-sol").as_deref(), Some(&[6, 1][..]));
        assert_eq!(version_of("openai-codex", "gpt-6-sol").as_deref(), Some(&[6][..]));
        assert_eq!(version_of("openai-codex", "gpt-5.6-luna").as_deref(), Some(&[5, 6][..]));
    }

    #[test]
    fn confronto_numerico_e_non_lessicografico() {
        assert_eq!(compare_versions(&[5, 10], &[5, 9]), Ordering::Greater);
        assert_eq!(compare_versions(&[5, 5], &[5]), Ordering::Greater);
        assert_eq!(compare_versions(&[6], &[6, 0]), Ordering::Equal);
    }

    #[test]
    fn snapshot_datati_non_diventano_versioni() {
        // 8 cifre: snapshot datato, escluso prima del confronto delle versioni.
        assert!(classify("anthropic", &model("anthropic", "claude-opus-4-5-20251101", "Opus 4.5")).is_none());
        assert!(classify("anthropic", &model("anthropic", "claude-haiku-4-5-20251001", "Haiku 4.5")).is_none());
        assert!(classify("commandcode", &model("commandcode", "inclusionai/ling-3.1-flash-1019", "Ling 1019")).is_none());
    }

    #[test]
    fn preview_e_varianti_mai_riconosciute() {
        for (provider, id, name) in [
            ("google-antigravity", "tab_flash_lite_preview", "tab preview"),
            ("commandcode", "deepseek/deepseek-v4-flash-vision-exp", "DeepSeek exp"),
            ("commandcode", "stepfun/Step-5-Preview", "Step 5 Preview"),
            ("cursor", "claude-opus-5-5-fast", "Opus 5.5 Fast"),
            ("cursor", "claude-opus-5-5-1m", "Opus 5.5 1M"),
            ("cursor", "claude-opus-5-5-1m-fast", "Opus 5.5 1M Fast"),
            ("cursor", "composer-2.5-fast", "Composer 2.5 Fast"),
            ("commandcode", "stealth/glyph-cluster:free", "Glyph :free"),
        ] {
            assert!(
                classify(provider, &model(provider, id, name)).is_none(),
                "{id} non deve essere ammesso dal setup"
            );
        }
    }

    #[test]
    fn namespace_strip_solo_con_prefisso_documentato() {
        // Prefisso documentato + proprietario coerente.
        assert_eq!(version_of("commandcode", "deepseek/deepseek-v4-pro").as_deref(), Some(&[4][..]));
        assert_eq!(version_of("commandcode", "google/gemini-3.8-flash").as_deref(), Some(&[3, 8][..]));
        // Prefisso sconosciuto: nessuno strip, nessuna famiglia.
        assert!(classify("commandcode", &model("commandcode", "acme/deepseek-v4-pro", "x")).is_none());
        // Prefisso noto ma proprietario incoerente con la famiglia.
        assert!(classify("commandcode", &model("commandcode", "deepseek/claude-opus-5-5", "x")).is_none());
        // Provider diretto: nessuno strip.
        assert!(classify("anthropic", &model("anthropic", "anthropic/claude-opus-5-5", "x")).is_none());
    }

    #[test]
    fn flash_lite_e_flash_sono_famiglie_distinte() {
        let flash = classify("google-antigravity", &model("google-antigravity", "gemini-3.8-flash", "x"))
            .map(|c| c.family.id);
        let lite = classify("google-antigravity", &model("google-antigravity", "gemini-3.5-flash-lite", "x"))
            .map(|c| c.family.id);
        assert_eq!(flash, Some("google.flash"));
        assert_eq!(lite, Some("google.flash_lite"));
    }

    #[test]
    fn fable_e_mythos_fuori_registro() {
        assert!(classify("anthropic", &model("anthropic", "claude-fable-5-2", "Claude Fable 5.2")).is_none());
        assert!(classify("anthropic", &model("anthropic", "claude-mythos-5-2", "Claude Mythos 5.2")).is_none());
    }

    #[test]
    fn version_from_name_legge_il_primo_numero() {
        assert_eq!(version_from_name("Gemini 3.5 Flash Lite").as_deref(), Some(&[3, 5][..]));
        assert_eq!(version_from_name("Claude Opus 5.5").as_deref(), Some(&[5, 5][..]));
        assert_eq!(version_from_name("Composer 2.5").as_deref(), Some(&[2, 5][..]));
    }
}
