//! Policy editoriale del setup: ruolo -> slot, provider -> famiglie ordinate.
//!
//! Non e' una misura di qualita' dei modelli: e' una decisione di prodotto,
//! modificabile, e sta qui in una sola tabella leggibile. Le frecce della
//! tabella (ii)/(iii) di `local://roles-design.md` sono liste ordinate di
//! family ID: l'ordine e' la policy, la versione si sceglie dopo, dentro la
//! famiglia. Se la prima famiglia non ha modelli idonei si passa alla
//! successiva (fallback di assegnazione), senza inventare versioni.

/// Slot editoriali: quattro liste per provider invece di una per ruolo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// Qualita' principale: `default`, `plan`.
    Quality,
    /// Equilibrio consumo/qualita': `task`.
    Balanced,
    /// Piccolo: `smol`, `commit`.
    Small,
    /// Visione: `vision`, con il requisito `input` contiene `image`.
    Vision,
}

/// Ruoli calcolati dal setup. Gli altri (`slow`, `advisor`, `tiny`, `judge`,
/// `web`, `image`) non vengono toccati: restano quelli di omp o dell'utente.
pub const SETUP_ROLES: [&str; 6] = ["default", "plan", "smol", "vision", "task", "commit"];

/// Ruoli con una card nel setup; `commit` non ce l'ha e copia `smol`.
pub const CARD_ROLES: [&str; 5] = ["default", "plan", "smol", "vision", "task"];

pub fn slot_for_role(role: &str) -> Option<Slot> {
    match role {
        "default" | "plan" => Some(Slot::Quality),
        "task" => Some(Slot::Balanced),
        "smol" | "commit" => Some(Slot::Small),
        "vision" => Some(Slot::Vision),
        _ => None,
    }
}

/// `vision` ha un requisito obbligatorio: se il modello non dichiara il
/// supporto immagini su **quella** route non e' idoneo, nemmeno se lo stesso
/// modello lo dichiara su un altro provider.
pub fn requires_image(role: &str) -> bool {
    role == "vision"
}

pub struct ProviderPolicy {
    /// ID del provider di accesso come lo espone omp.
    pub provider: &'static str,
    pub quality: &'static [&'static str],
    pub balanced: &'static [&'static str],
    pub small: &'static [&'static str],
    pub vision: &'static [&'static str],
}

impl ProviderPolicy {
    pub fn families(&self, slot: Slot) -> &'static [&'static str] {
        match slot {
            Slot::Quality => self.quality,
            Slot::Balanced => self.balanced,
            Slot::Small => self.small,
            Slot::Vision => self.vision,
        }
    }
}

/// Tabella (iii). **L'ordine delle righe e' la priorita' fra provider**: non
/// c'e' una seconda tabella da tenere allineata, e l'ordine di login non conta
/// nulla. I provider non elencati vengono dopo, ordinati per ID, e usano solo
/// l'euristica.
///
/// Le righe verificate su catalogo reale sono `anthropic`, `openai-codex`,
/// `google-antigravity`, `cursor`, `commandcode`: per le altre gli ID sono una
/// policy proposta, non una certificazione (design, stato "NV").
pub static PROVIDER_POLICIES: &[ProviderPolicy] = &[
    ProviderPolicy {
        provider: "anthropic",
        quality: &["anthropic.opus", "anthropic.sonnet"],
        balanced: &["anthropic.sonnet", "anthropic.opus"],
        small: &["anthropic.haiku", "anthropic.sonnet"],
        vision: &["anthropic.sonnet", "anthropic.opus", "anthropic.haiku"],
    },
    ProviderPolicy {
        provider: "openai-codex",
        quality: &[
            "openai.sol",
            "openai.astra",
            "openai.codex",
            "openai.gpt",
            "openai.terra",
        ],
        balanced: &["openai.terra", "openai.codex", "openai.sol", "openai.gpt"],
        small: &["openai.luna", "openai.mini", "openai.terra"],
        vision: &[
            "openai.terra",
            "openai.sol",
            "openai.astra",
            "openai.gpt",
            "openai.luna",
        ],
    },
    ProviderPolicy {
        provider: "google-antigravity",
        quality: &[
            "google.pro",
            "anthropic.opus",
            "anthropic.sonnet",
            "google.flash",
        ],
        balanced: &["google.flash", "anthropic.sonnet"],
        small: &["google.flash_lite", "google.flash"],
        vision: &["google.pro", "google.flash", "anthropic.sonnet", "anthropic.opus"],
    },
    ProviderPolicy {
        provider: "cursor",
        quality: &[
            "anthropic.opus",
            "openai.sol",
            "cursor.composer",
            "anthropic.sonnet",
        ],
        balanced: &["cursor.composer", "anthropic.sonnet", "openai.terra"],
        small: &["anthropic.haiku", "openai.luna", "google.flash_lite", "cursor.composer"],
        vision: &[
            "anthropic.sonnet",
            "anthropic.opus",
            "openai.sol",
            "cursor.composer",
        ],
    },
    ProviderPolicy {
        provider: "commandcode",
        quality: &[
            "anthropic.opus",
            "openai.sol",
            "google.pro",
            "anthropic.sonnet",
        ],
        balanced: &["anthropic.sonnet", "openai.terra", "google.flash", "deepseek.flash"],
        small: &["anthropic.haiku", "openai.luna", "google.flash_lite", "deepseek.flash"],
        vision: &["anthropic.sonnet", "google.pro", "google.flash", "openai.sol"],
    },
    ProviderPolicy {
        provider: "github-copilot",
        quality: &[
            "anthropic.opus",
            "openai.sol",
            "openai.codex",
            "anthropic.sonnet",
        ],
        balanced: &["anthropic.sonnet", "openai.terra", "google.flash"],
        small: &["anthropic.haiku", "openai.luna", "openai.mini", "google.flash_lite"],
        vision: &["anthropic.sonnet", "openai.sol", "google.flash"],
    },
    ProviderPolicy {
        provider: "opencode-zen",
        quality: &[
            "anthropic.opus",
            "openai.sol",
            "google.pro",
            "anthropic.sonnet",
        ],
        balanced: &["anthropic.sonnet", "openai.terra", "google.flash", "deepseek.flash"],
        small: &["anthropic.haiku", "openai.luna", "google.flash_lite", "deepseek.flash"],
        vision: &["anthropic.sonnet", "google.pro", "google.flash", "openai.sol"],
    },
    ProviderPolicy {
        provider: "opencode-go",
        quality: &[
            "anthropic.opus",
            "openai.sol",
            "google.pro",
            "anthropic.sonnet",
        ],
        balanced: &["anthropic.sonnet", "openai.terra", "google.flash", "deepseek.flash"],
        small: &["anthropic.haiku", "openai.luna", "google.flash_lite", "deepseek.flash"],
        vision: &["anthropic.sonnet", "google.pro", "google.flash", "openai.sol"],
    },
    ProviderPolicy {
        provider: "openrouter",
        quality: &["anthropic.opus", "openai.sol", "google.pro", "deepseek.pro"],
        balanced: &["anthropic.sonnet", "openai.terra", "deepseek.flash"],
        small: &["anthropic.haiku", "openai.luna", "google.flash_lite", "deepseek.flash"],
        vision: &["anthropic.sonnet", "google.flash", "openai.sol"],
    },
    ProviderPolicy {
        provider: "deepseek",
        quality: &["deepseek.pro", "deepseek.reasoner", "deepseek.chat", "deepseek.flash"],
        balanced: &["deepseek.flash", "deepseek.chat", "deepseek.pro"],
        small: &["deepseek.flash", "deepseek.chat"],
        vision: &["deepseek.flash", "deepseek.pro", "deepseek.chat"],
    },
    ProviderPolicy {
        provider: "zai",
        quality: &["zai.glm", "zai.glm_flash"],
        balanced: &["zai.glm", "zai.glm_flash"],
        small: &["zai.glm_flash", "zai.glm"],
        vision: &["zai.glm", "zai.glm_flash"],
    },
    ProviderPolicy {
        provider: "z-ai",
        quality: &["zai.glm", "zai.glm_flash"],
        balanced: &["zai.glm", "zai.glm_flash"],
        small: &["zai.glm_flash", "zai.glm"],
        vision: &["zai.glm", "zai.glm_flash"],
    },
    ProviderPolicy {
        provider: "xai",
        quality: &["xai.grok", "xai.grok_mini"],
        balanced: &["xai.grok", "xai.grok_mini"],
        small: &["xai.grok_mini", "xai.grok"],
        vision: &["xai.grok", "xai.grok_mini"],
    },
    ProviderPolicy {
        provider: "xai-oauth",
        quality: &["xai.grok", "xai.grok_mini"],
        balanced: &["xai.grok", "xai.grok_mini"],
        small: &["xai.grok_mini", "xai.grok"],
        vision: &["xai.grok", "xai.grok_mini"],
    },
    ProviderPolicy {
        provider: "mistral",
        quality: &["mistral.large", "mistral.codestral", "mistral.small"],
        balanced: &["mistral.codestral", "mistral.small", "mistral.large"],
        small: &["mistral.small", "mistral.codestral"],
        vision: &["mistral.small", "mistral.large"],
    },
    // Ollama e gli altri runtime locali non hanno una famiglia universale: la
    // policy resta vuota e vale solo l'euristica, che non puo' promettere
    // prestazioni non misurate.
    ProviderPolicy {
        provider: "ollama",
        quality: &[],
        balanced: &[],
        small: &[],
        vision: &[],
    },
    ProviderPolicy {
        provider: "lm-studio",
        quality: &[],
        balanced: &[],
        small: &[],
        vision: &[],
    },
    ProviderPolicy {
        provider: "llama.cpp",
        quality: &[],
        balanced: &[],
        small: &[],
        vision: &[],
    },
];

/// Provider eseguiti sulla macchina dell'utente. Non hanno un abbonamento ne'
/// un prezzo per token: il costo nominale del catalogo non e' il costo reale e
/// le prestazioni dipendono dall'hardware, che il catalogo non descrive.
///
/// `local` e' il runtime incorporato di omp (i modelli on-device che compaiono
/// nel suo catalogo), gli altri sono runtime esterni.
pub const LOCAL_PROVIDERS: &[&str] = &["ollama", "lm-studio", "llama.cpp", "local"];

pub fn is_local_provider(provider: &str) -> bool {
    LOCAL_PROVIDERS.contains(&provider)
}

/// Riga della tabella, se il provider ne ha una. Un provider custom di
/// `models.json` non ce l'ha ed e' trattato come locale solo se sta
/// nell'elenco sopra: altrimenti e' un provider non mappato.
pub fn policy_for(provider: &str) -> Option<&'static ProviderPolicy> {
    PROVIDER_POLICIES
        .iter()
        .find(|row| row.provider == provider)
}

/// Priorita' del provider: indice della riga nella tabella. I provider non
/// elencati stanno dopo tutti gli altri (l'ordinamento finale usa comunque
/// l'ID come ultimo criterio, quindi resta deterministico).
pub fn provider_priority(provider: &str) -> usize {
    PROVIDER_POLICIES
        .iter()
        .position(|row| row.provider == provider)
        .unwrap_or(PROVIDER_POLICIES.len())
}

/// Livelli di pensiero semanticamente "alti" riconosciuti. `xhigh` e `max`
/// sono esclusi per scelta: il setup non alza il ragionamento al massimo
/// perche' cambierebbero consumo e latenza in modo non misurato.
const HIGH_THINKING_LEVELS: &[&str] = &["high"];

/// Livello alto effettivamente dichiarato dal modello, o `None`.
///
/// Non si assume mai che il livello si chiami "high": omp pubblica i livelli
/// reali per route e `minimal`/`low`/`medium`/`xhigh`/`max` convivono. Se il
/// modello non dichiara un livello alto riconosciuto non si scrive nessun
/// suffisso: la selezione resta quella predefinita del modello.
pub fn high_thinking_level(model_thinking: Option<&Vec<String>>) -> Option<String> {
    let levels = model_thinking?;
    levels
        .iter()
        .find(|level| HIGH_THINKING_LEVELS.contains(&level.as_str()))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ruolo_commit_copia_lo_slot_small() {
        assert_eq!(slot_for_role("commit"), Some(Slot::Small));
        assert_eq!(slot_for_role("smol"), Some(Slot::Small));
        assert_eq!(slot_for_role("slow"), None);
        assert_eq!(slot_for_role("judge"), None);
    }

    #[test]
    fn ogni_famiglia_della_policy_esiste_nel_registro() {
        for row in PROVIDER_POLICIES {
            for family in row
                .quality
                .iter()
                .chain(row.balanced)
                .chain(row.small)
                .chain(row.vision)
            {
                assert!(
                    crate::setup_roles::families::REGISTRY
                        .iter()
                        .any(|definition| definition.id == *family),
                    "famiglia {} della policy senza registro",
                    family
                );
            }
        }
    }

    #[test]
    fn thinking_alto_solo_se_dichiarato() {
        assert_eq!(
            high_thinking_level(Some(&vec![
                "low".into(),
                "medium".into(),
                "high".into(),
                "xhigh".into(),
                "max".into()
            ]))
            .as_deref(),
            Some("high")
        );
        // Nessun livello alto riconosciuto: nessun suffisso inventato.
        assert_eq!(high_thinking_level(Some(&vec!["minimal".into(), "low".into()])), None);
        assert_eq!(high_thinking_level(Some(&vec!["xhigh".into(), "max".into()])), None);
        assert_eq!(high_thinking_level(None), None);
    }
}
