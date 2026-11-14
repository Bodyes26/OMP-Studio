//! Risoluzione deterministica dei ruoli del setup (SET-012, SET-042).
//!
//! Due strati netti: la **logica pura** in `propose` (catalogo + connessioni +
//! ruoli attuali, nessun I/O) e il comando Tauri che legge i dati reali. Cosi'
//! i test girano sulle fixture di catalogo e lo stesso codice e' quello che
//! gira in produzione.
//!
//! Regole non negoziabili:
//!
//! - nessuna chiamata di rete o a un LLM: la proposta e' una funzione dei dati;
//! - un modello proposto esiste nel catalogo **di quella connessione** e le sue
//!   capability sono quelle della route, non quelle della famiglia (CommandCode
//!   espone Opus/Sonnet 5.5 e GPT-6.1 senza immagini);
//! - la versione si confronta solo dentro la famiglia, mai fra famiglie;
//! - priorita' fra connessioni: abbonamento -> chiave API -> locale, poi
//!   confidenza curata -> euristica, poi ordine della tabella di policy, poi
//!   selector. L'ordine di login non entra in nessun punto.

use super::catalog::CatalogModel;
use super::families::{classify, compare_versions, is_eligible_for_setup, version_from_name};
use super::policy::{
    high_thinking_level, is_local_provider, policy_for, provider_priority, requires_image,
    slot_for_role, Slot, CARD_ROLES, SETUP_ROLES,
};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

/// Come e' collegato un provider. Determina il primo criterio di scelta: un
/// abbonamento ha costo marginale zero, una chiave API si paga a consumo, il
/// locale non si confronta con nessuno dei due.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessKind {
    Subscription,
    ApiKey,
    Local,
}

impl AccessKind {
    fn rank(self) -> u8 {
        match self {
            AccessKind::Subscription => 0,
            AccessKind::ApiKey => 1,
            AccessKind::Local => 2,
        }
    }
}

/// Una connessione utilizzabile: provider di accesso e modo di accesso. una
/// voce per provider basta, perche' il resolver sceglie comunque il modo
/// migliore fra quelli disponibili.
#[derive(Debug, Clone)]
pub struct Connection {
    pub provider: String,
    pub access: AccessKind,
}

impl Connection {
    /// Riduce le credenziali osservate a una connessione per provider, tenendo
    /// il modo di accesso migliore: un abbonamento batte una chiave API anche
    /// se la chiave e' stata aggiunta dopo, quindi l'ordine di login sparisce.
    pub fn from_credentials(credentials: &[(String, String)]) -> Vec<Connection> {
        let mut best: HashMap<String, AccessKind> = HashMap::new();
        for (provider, credential_type) in credentials {
            // Un provider locale non ha credenziali: viene aggiunto a parte da
            // `with_locals`. Qui il tipo dichiarato da `agent.db` decide.
            let access = if credential_type == "oauth" {
                AccessKind::Subscription
            } else {
                AccessKind::ApiKey
            };
            best.entry(provider.clone())
                .and_modify(|current| {
                    if access.rank() < current.rank() {
                        *current = access;
                    }
                })
                .or_insert(access);
        }
        let mut connections: Vec<Connection> = best
            .into_iter()
            .map(|(provider, access)| Connection { provider, access })
            .collect();
        // Deterministico anche prima dell'ordinamento finale del resolver.
        connections.sort_by(|a, b| a.provider.cmp(&b.provider));
        connections
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Curated,
    Heuristic,
    None,
}

impl Confidence {
    fn rank(self) -> u8 {
        match self {
            Confidence::Curated => 0,
            Confidence::Heuristic => 1,
            Confidence::None => 2,
        }
    }
}

/// Codici di motivazione principali, uno per card. I testi stanno nel
/// frontend (sezione (v) di `local://roles-design.md`): qui c'e' solo il
/// codice, cosi' nessuna traduzione finisce nel Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCode {
    CuratedQuality,
    CuratedPlan,
    CuratedBalanced,
    CuratedSmall,
    VisionSupported,
    HeuristicSelection,
    HeuristicLowestKnownCost,
    NoEligibleModel,
    NoVisionModel,
}

/// Dettagli secondari (tooltip).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NoteCode {
    SubscriptionPreferred,
    PlanHighThinking,
    LocalPerformanceUnknown,
    CurrentModelNotInCatalog,
    PricingUnknown,
    CatalogMetadataConflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleProposal {
    pub role: String,
    /// Selector concreto del catalogo (`provider/modelId`), `None` se nessun
    /// candidato: la UI deve dichiarare l'assenza, non inventare un valore.
    pub selector: Option<String>,
    /// Solo `plan`, solo livello alto realmente dichiarato dal modello.
    pub thinking: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub family_id: Option<String>,
    pub reason: ReasonCode,
    pub notes: Vec<NoteCode>,
    pub params: HashMap<String, String>,
    pub confidence: Confidence,
    /// Valore attuale di `modelRoles`, thinking compreso.
    pub current: Option<String>,
    pub current_in_catalog: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleProposalResponse {
    pub roles: Vec<RoleProposal>,
}

/// Token attesi per il costo stimato di un compito breve. Sono parametri di
/// prodotto, non un benchmark: servono solo a confrontare i prezzi dichiarati
/// su uno stesso carico fittizio.
const SMALL_WORKLOAD_INPUT_TOKENS: f64 = 20_000.0;
const SMALL_WORKLOAD_OUTPUT_TOKENS: f64 = 4_000.0;

/// Fasce di contesto: si premia la sufficienza, non il numero piu' alto. Oltre
/// l'ultima fascia non c'e' nessun vantaggio ulteriore.
fn context_band(context_window: Option<u64>) -> u8 {
    match context_window.unwrap_or(0) {
        0..=99_999 => 0,
        100_000..=199_999 => 1,
        200_000..=999_999 => 2,
        _ => 3,
    }
}

/// Fasce di output disponibile: un modello che non puo' scrivere abbastanza e'
/// meno adatto a un agente principale, ma oltre la seconda fascia la
/// differenza non cambia piu' nulla.
fn output_band(max_tokens: Option<u64>) -> u8 {
    match max_tokens.unwrap_or(0) {
        0..=8_191 => 0,
        8_192..=32_767 => 1,
        _ => 2,
    }
}

/// Prezzo fidato solo se il catalogo lo dichiara `fixed`: `unknown` e `variable`
/// non sono zero, e un costo nominale `0/0` su una route a consumo significa
/// "non lo sappiamo", non "gratis".
fn has_reliable_price(model: &CatalogModel) -> bool {
    model.pricing_status.as_deref() == Some("fixed")
        && model
            .cost
            .as_ref()
            .map(|cost| cost.input.is_some() && cost.output.is_some())
            .unwrap_or(false)
}

fn estimated_cost(model: &CatalogModel) -> Option<f64> {
    if !has_reliable_price(model) {
        return None;
    }
    let cost = model.cost.as_ref()?;
    let input = cost.input?;
    let output = cost.output?;
    Some(
        (SMALL_WORKLOAD_INPUT_TOKENS * input + SMALL_WORKLOAD_OUTPUT_TOKENS * output) / 1_000_000.0,
    )
}

fn has_image_input(model: &CatalogModel) -> bool {
    model
        .input
        .as_ref()
        .map(|values| values.iter().any(|value| value == "image"))
        .unwrap_or(false)
}

/// Modelli della route che il setup puo' proporre: chat, stabili (niente
/// preview ne' snapshot datati), forma canonica della famiglia (niente
/// `-fast`, `-1m`, `:free`) e, per `vision`, con le immagini dichiarate.
fn eligible_models<'a>(provider: &str, models: &'a [CatalogModel], role: &str) -> Vec<&'a CatalogModel> {
    models
        .iter()
        .filter(|model| model.provider == provider)
        .filter(|model| is_eligible_for_setup(model))
        .filter(|model| !requires_image(role) || has_image_input(model))
        .collect()
}

/// Scelta per un ruolo su una connessione. Possiede il modello della route:
/// cosi' il confronto fra connessioni non tiene in vita prestiti del catalogo
/// ne' inventa durate artificiali.
struct Pick {
    model: CatalogModel,
    family_id: Option<&'static str>,
    confidence: Confidence,
    reason: ReasonCode,
    notes: Vec<NoteCode>,
}

/// Migliore modello della famiglia sul catalogo gia' filtrato: versione piu'
/// alta fra quelle ammesse, poi selector piu' basso per determinismo. La forma
/// standard della famiglia e' unica dopo il filtro delle varianti, quindi il
/// selector serve solo a non dipendere dall'ordine del catalogo.
fn best_of_family<'a>(
    provider: &str,
    eligible: &[&'a CatalogModel],
    family_id: &str,
) -> Option<(&'a CatalogModel, Vec<u32>)> {
    let mut best: Option<(&CatalogModel, Vec<u32>)> = None;
    for model in eligible {
        let Some(classified) = classify(provider, model) else {
            continue;
        };
        if classified.family.id != family_id {
            continue;
        }
        best = match best {
            None => Some((model, classified.version)),
            Some((current_model, current_version)) => {
                match compare_versions(&classified.version, &current_version) {
                    Ordering::Greater => Some((model, classified.version)),
                    Ordering::Equal if model.selector < current_model.selector => {
                        Some((model, classified.version))
                    }
                    _ => Some((current_model, current_version)),
                }
            }
        };
    }
    best
}

fn curated_reason(slot: Slot) -> ReasonCode {
    match slot {
        Slot::Quality => ReasonCode::CuratedQuality,
        Slot::Balanced => ReasonCode::CuratedBalanced,
        Slot::Small => ReasonCode::CuratedSmall,
        Slot::Vision => ReasonCode::VisionSupported,
    }
}

/// Prima famiglia risolvibile della policy per lo slot, in ordine. Le famiglie
/// assenti vengono saltate in silenzio: e' il fallback di assegnazione, non un
/// errore. Non genera rifiniture: la versione si sceglie dentro la famiglia.
fn curated_pick(
    provider: &str,
    role: &str,
    slot: Slot,
    eligible: &[&CatalogModel],
) -> Option<Pick> {
    let policy = policy_for(provider)?;
    // `plan` e `default` condividono lo slot Q ma hanno una motivazione
    // diversa: la pianificazione si spiega da sola.
    let reason = if role == "plan" {
        ReasonCode::CuratedPlan
    } else {
        curated_reason(slot)
    };
    for family_id in policy.families(slot) {
        let Some((model, _version)) = best_of_family(provider, eligible, family_id) else {
            continue;
        };
        return Some(Pick {
            model: model.clone(),
            family_id: Some(family_id),
            confidence: Confidence::Curated,
            reason,
            notes: Vec::new(),
        });
    }
    None
}

/// Euristica per provider senza policy o senza famiglie disponibili.
///
/// Per i ruoli "piccoli" il costo noto piu' basso su un carico fisso, **solo**
/// con prezzi affidabili: un prezzo sconosciuto non e' zero. Per gli altri
/// ruoli il ragionamento e la fascia di contesto; il prezzo non e' mai un proxy
/// di qualita', perche' non misura il livello del modello e premierebbe route
/// inefficienti.
fn heuristic_pick(provider: &str, role: &str, eligible: &[&CatalogModel]) -> Option<Pick> {
    if eligible.is_empty() {
        return None;
    }

    let local = is_local_provider(provider);
    let small_role = matches!(role, "smol" | "commit");

    if small_role {
        let best = eligible
            .iter()
            .copied()
            .filter(|model| estimated_cost(model).is_some())
            .min_by(|a, b| {
                let cost_a = estimated_cost(a).unwrap_or(f64::MAX);
                let cost_b = estimated_cost(b).unwrap_or(f64::MAX);
                cost_a
                    .partial_cmp(&cost_b)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| a.selector.cmp(&b.selector))
            });
        if let Some(best) = best {
            let mut notes = Vec::new();
            if local {
                notes.push(NoteCode::LocalPerformanceUnknown);
            }
            return Some(Pick {
                model: best.clone(),
                family_id: None,
                confidence: Confidence::Heuristic,
                reason: ReasonCode::HeuristicLowestKnownCost,
                notes,
            });
        }
    }

    // Il ragionamento e' una preferenza, non un requisito: un modello che non
    // lo espone puo' comunque essere la scelta migliore disponibile, e
    // `vision` deve restare risolvibile anche senza reasoning.
    let best = eligible.iter().copied().max_by(|a, b| {
        let key_a = (
            a.reasoning.unwrap_or(false),
            context_band(a.context_window),
            output_band(a.max_tokens),
        );
        let key_b = (
            b.reasoning.unwrap_or(false),
            context_band(b.context_window),
            output_band(b.max_tokens),
        );
        key_a.cmp(&key_b).then_with(|| b.selector.cmp(&a.selector))
    })?;

    let mut notes = Vec::new();
    if local {
        notes.push(NoteCode::LocalPerformanceUnknown);
    }
    // Senza alcun prezzo affidabile la scelta non ha un criterio economico: lo
    // dichiariamo invece di far sembrare misurata una preferenza.
    if eligible.iter().all(|model| estimated_cost(model).is_none()) {
        notes.push(NoteCode::PricingUnknown);
    }

    Some(Pick {
        model: best.clone(),
        family_id: None,
        confidence: Confidence::Heuristic,
        reason: ReasonCode::HeuristicSelection,
        notes,
    })
}

fn pick_for_connection(connection: &Connection, role: &str, models: &[CatalogModel]) -> Option<Pick> {
    let slot = slot_for_role(role)?;
    let eligible = eligible_models(&connection.provider, models, role);
    curated_pick(&connection.provider, role, slot, &eligible)
        .or_else(|| heuristic_pick(&connection.provider, role, &eligible))
}

/// Nome dichiarato dal modello per la versione, se contraddice l'ID. Il nome
/// non decide mai famiglia o versione (nel catalogo vero
/// `gemini-2.5-flash-lite` si presenta come "Gemini 3.5 Flash Lite"), ma la
/// contraddizione e' un'informazione utile.
fn version_conflicts_with_name(provider: &str, model: &CatalogModel) -> bool {
    let Some(classified) = classify(provider, model) else {
        return false;
    };
    match version_from_name(&model.name) {
        Some(from_name) => compare_versions(&classified.version, &from_name) != Ordering::Equal,
        None => false,
    }
}

/// Base di un valore `provider/model[:livello]` scritto in `modelRoles`. Il
/// suffisso si toglie solo se il valore intero **non** e' un selector del
/// catalogo: nel catalogo vivono id che contengono `:` (`:free`), e tagliare
/// per l'ultimo due punti produrrebbe selector inesistenti.
fn selector_base(value: &str, known: &HashSet<String>) -> String {
    if known.contains(value) {
        return value.to_string();
    }
    match value.rsplit_once(':') {
        Some((base, level)) if crate::models_ops::THINKING_LEVELS.contains(&level) => base.to_string(),
        _ => value.to_string(),
    }
}

fn build_proposal(
    role: &str,
    pick: Option<&(Pick, AccessKind)>,
    current: Option<String>,
    catalog_selectors: &HashSet<String>,
) -> RoleProposal {
    let mut notes = Vec::new();
    let mut params = HashMap::new();

    let (selector, thinking, provider, model_name, family_id, reason, confidence) = match pick {
        Some((pick, access)) => {
            let provider_name = pick.model.provider.clone();
            notes.extend(pick.notes.iter().copied());
            if *access == AccessKind::Subscription {
                notes.push(NoteCode::SubscriptionPreferred);
            }
            if version_conflicts_with_name(&provider_name, &pick.model) {
                notes.push(NoteCode::CatalogMetadataConflict);
            }
            // Solo `plan` riceve un livello di pensiero, e solo quello
            // realmente dichiarato dal modello su questa route.
            let thinking = if role == "plan" && pick.model.reasoning.unwrap_or(false) {
                let level = high_thinking_level(pick.model.thinking.as_ref());
                if let Some(level) = &level {
                    notes.push(NoteCode::PlanHighThinking);
                    params.insert("level".to_string(), level.clone());
                }
                level
            } else {
                None
            };
            // Contratto: `family`, `provider`, `model` (e `level` per `plan`).
            // L'etichetta leggibile della famiglia la ricava il frontend dal
            // familyId tradotto, non da un testo inglese scritto qui.
            let family_id = pick.family_id.map(str::to_string);
            if let Some(family_id) = &family_id {
                params.insert("family".to_string(), family_id.clone());
            }
            params.insert("provider".to_string(), provider_name.clone());
            params.insert("model".to_string(), pick.model.name.clone());
            (
                Some(pick.model.selector.clone()),
                thinking,
                Some(provider_name),
                Some(pick.model.name.clone()),
                family_id,
                pick.reason,
                pick.confidence,
            )
        }
        None => (
            None,
            None,
            None,
            None,
            None,
            if requires_image(role) {
                ReasonCode::NoVisionModel
            } else {
                ReasonCode::NoEligibleModel
            },
            Confidence::None,
        ),
    };

    let current_in_catalog = match &current {
        Some(value) => {
            let present = catalog_selectors.contains(&selector_base(value, catalog_selectors));
            if !present {
                notes.push(NoteCode::CurrentModelNotInCatalog);
            }
            present
        }
        None => false,
    };

    RoleProposal {
        role: role.to_string(),
        selector,
        thinking,
        provider,
        model_name,
        family_id,
        reason,
        notes,
        params,
        confidence,
        current,
        current_in_catalog,
    }
}

/// Chiave di confronto fra le scelte delle connessioni, nell'ordine in cui il
/// design le elenca: accesso, confidenza, riga della policy, selector.
fn pick_key(pick: &Pick, access: AccessKind) -> (u8, u8, usize, String) {
    (
        access.rank(),
        pick.confidence.rank(),
        provider_priority(&pick.model.provider),
        pick.model.selector.clone(),
    )
}

/// Proposta dei ruoli del setup. Funzione pura: nessun I/O, cosi' i test usano
/// le fixture e la produzione passa gli stessi dati dal comando.
///
/// `current_roles` e' `modelRoles` di `config.yml`: la configurazione esistente
/// resta la selezione corrente, la proposta e' un suggerimento separato che il
/// frontend applica solo se l'utente lo sceglie.
pub fn propose(
    catalog: &[CatalogModel],
    connections: &[Connection],
    current_roles: &HashMap<String, String>,
) -> Vec<RoleProposal> {
    let catalog_selectors: HashSet<String> =
        catalog.iter().map(|model| model.selector.clone()).collect();

    let mut proposals: HashMap<&str, RoleProposal> = HashMap::new();

    for role in CARD_ROLES {
        // Una scelta per connessione, poi la migliore: accesso, confidenza,
        // riga della policy, selector.
        let mut best: Option<(Pick, AccessKind)> = None;
        for connection in connections {
            let Some(pick) = pick_for_connection(connection, role, catalog) else {
                continue;
            };
            let better = match &best {
                None => true,
                Some((current, current_access)) => {
                    pick_key(&pick, connection.access) < pick_key(current, *current_access)
                }
            };
            if better {
                best = Some((pick, connection.access));
            }
        }

        let current = current_roles.get(role).cloned();
        let proposal = build_proposal(role, best.as_ref(), current, &catalog_selectors);
        proposals.insert(role, proposal);
    }

    // `commit` non ha una card: e' la stessa proposta di `smol` (il frontend
    // salva la selezione **finale** di smol, che puo' essere stata cambiata a
    // mano), senza thinking, con il proprio valore corrente.
    let commit_current = current_roles.get("commit").cloned();
    let commit = match proposals.get("smol") {
        Some(smol) => {
            let mut commit = smol.clone();
            commit.role = "commit".to_string();
            commit.thinking = None;
            commit.params.remove("level");
            commit.notes.retain(|note| *note != NoteCode::PlanHighThinking);
            // `current` e `currentInCatalog` di `commit` riguardano il suo
            // valore, non quello di `smol`.
            commit.notes.retain(|note| *note != NoteCode::CurrentModelNotInCatalog);
            commit.current_in_catalog = match &commit_current {
                Some(value) => catalog_selectors.contains(&selector_base(value, &catalog_selectors)),
                None => false,
            };
            if commit_current.is_some() && !commit.current_in_catalog {
                commit.notes.push(NoteCode::CurrentModelNotInCatalog);
            }
            commit.current = commit_current;
            commit
        }
        None => build_proposal("commit", None, commit_current, &catalog_selectors),
    };
    proposals.insert("commit", commit);

    SETUP_ROLES
        .iter()
        .filter_map(|role| proposals.get(role).cloned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup_roles::catalog::CatalogCost;

    #[allow(clippy::too_many_arguments)]
    fn model(
        provider: &str,
        id: &str,
        name: &str,
        context: Option<u64>,
        reasoning: bool,
        input: &[&str],
        cost: Option<(f64, f64)>,
        pricing: Option<&str>,
    ) -> CatalogModel {
        CatalogModel {
            id: id.to_string(),
            name: name.to_string(),
            provider: provider.to_string(),
            selector: format!("{}/{}", provider, id),
            kind: "chat".to_string(),
            context_window: context,
            max_tokens: Some(8_000),
            reasoning: Some(reasoning),
            thinking: if reasoning {
                Some(vec![
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                    "xhigh".to_string(),
                    "max".to_string(),
                ])
            } else {
                None
            },
            input: Some(input.iter().map(|value| value.to_string()).collect()),
            cost: cost.map(|(input, output)| CatalogCost {
                input: Some(input),
                output: Some(output),
            }),
            pricing_status: pricing.map(str::to_string),
        }
    }

    fn sub(provider: &str) -> Connection {
        Connection {
            provider: provider.to_string(),
            access: AccessKind::Subscription,
        }
    }

    fn api(provider: &str) -> Connection {
        Connection {
            provider: provider.to_string(),
            access: AccessKind::ApiKey,
        }
    }

    fn local_conn(provider: &str) -> Connection {
        Connection {
            provider: provider.to_string(),
            access: AccessKind::Local,
        }
    }

    fn by_role(proposals: &[RoleProposal], role: &str) -> RoleProposal {
        proposals
            .iter()
            .find(|proposal| proposal.role == role)
            .cloned()
            .unwrap_or_else(|| panic!("ruolo {} assente", role))
    }

    fn selector_of(proposals: &[RoleProposal], role: &str) -> Option<String> {
        by_role(proposals, role).selector
    }

    fn opus_5_5() -> CatalogModel {
        model("anthropic", "claude-opus-5-5", "Claude Opus 5.5", Some(1_000_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed"))
    }

    #[test]
    fn solo_anthropic_segue_la_policy() {
        let catalog = vec![
            opus_5_5(),
            model("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", Some(1_000_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5", Some(100_000), true, &["text", "image"], Some((0.1, 0.5)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[sub("anthropic")], &HashMap::new());
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("anthropic/claude-opus-5-5"));
        assert_eq!(selector_of(&proposals, "plan").as_deref(), Some("anthropic/claude-opus-5-5"));
        assert_eq!(selector_of(&proposals, "task").as_deref(), Some("anthropic/claude-sonnet-5-5"));
        assert_eq!(selector_of(&proposals, "smol").as_deref(), Some("anthropic/claude-haiku-5-5"));
        assert_eq!(selector_of(&proposals, "vision").as_deref(), Some("anthropic/claude-sonnet-5-5"));
        assert_eq!(selector_of(&proposals, "commit").as_deref(), Some("anthropic/claude-haiku-5-5"));
        assert_eq!(by_role(&proposals, "default").family_id.as_deref(), Some("anthropic.opus"));
    }

    #[test]
    fn plan_riceve_solo_il_livello_alto_e_mai_xhigh() {
        let catalog = vec![opus_5_5()];
        let proposals = propose(&catalog, &[sub("anthropic")], &HashMap::new());
        let plan = by_role(&proposals, "plan");
        assert_eq!(plan.thinking.as_deref(), Some("high"));
        assert!(plan.notes.contains(&NoteCode::PlanHighThinking));
        // Gli altri ruoli non portano suffisso: restano sul default di omp.
        assert_eq!(by_role(&proposals, "default").thinking, None);
        assert_eq!(by_role(&proposals, "smol").thinking, None);

        // Senza un livello alto riconosciuto non si inventa nulla.
        let mut no_high = catalog.clone();
        no_high[0].thinking = Some(vec!["minimal".to_string(), "low".to_string()]);
        let proposals = propose(&no_high, &[sub("anthropic")], &HashMap::new());
        assert_eq!(by_role(&proposals, "plan").thinking, None);
        assert!(!by_role(&proposals, "plan").notes.contains(&NoteCode::PlanHighThinking));

        // `xhigh`/`max` non sono mai scelti in automatico.
        let mut only_xhigh = catalog.clone();
        only_xhigh[0].thinking = Some(vec!["xhigh".to_string(), "max".to_string()]);
        let proposals = propose(&only_xhigh, &[sub("anthropic")], &HashMap::new());
        assert_eq!(by_role(&proposals, "plan").thinking, None);
    }

    #[test]
    fn solo_openai_codex_segue_la_policy() {
        let catalog = vec![
            model("openai-codex", "gpt-6-sol", "GPT-6 Sol", Some(272_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("openai-codex", "gpt-6.1-sol", "GPT-6.1 Sol", Some(500_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("openai-codex", "gpt-6-luna", "GPT-6 Luna", Some(272_000), true, &["text", "image"], Some((0.1, 0.5)), Some("fixed")),
            model("openai-codex", "gpt-5.6-luna", "GPT-5.6 Luna", Some(272_000), true, &["text", "image"], Some((0.2, 1.2)), Some("fixed")),
            model("openai-codex", "gpt-6.1-terra", "GPT-6.1 Terra", Some(500_000), true, &["text", "image"], Some((1.0, 5.0)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[sub("openai-codex")], &HashMap::new());
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("openai-codex/gpt-6.1-sol"));
        assert_eq!(selector_of(&proposals, "task").as_deref(), Some("openai-codex/gpt-6.1-terra"));
        assert_eq!(selector_of(&proposals, "smol").as_deref(), Some("openai-codex/gpt-6-luna"));
        assert_eq!(by_role(&proposals, "smol").family_id.as_deref(), Some("openai.luna"));
        assert_eq!(by_role(&proposals, "default").family_id.as_deref(), Some("openai.sol"));
    }

    #[test]
    fn cursor_sceglie_la_forma_standard_non_fast_ne_1m() {
        let catalog = vec![
            model("cursor", "claude-opus-5-5", "Claude Opus 5.5", Some(300_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed")),
            model("cursor", "claude-opus-5-5-fast", "Claude Opus 5.5 Fast", Some(300_000), true, &["text", "image"], Some((8.0, 40.0)), Some("fixed")),
            model("cursor", "claude-opus-5-5-1m", "Claude Opus 5.5 1M", Some(1_000_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed")),
            model("cursor", "claude-opus-5-5-1m-fast", "Claude Opus 5.5 1M Fast", Some(1_000_000), true, &["text", "image"], Some((8.0, 40.0)), Some("fixed")),
            model("cursor", "composer-2.5", "Composer 2.5", Some(200_000), true, &["text", "image"], Some((0.5, 2.5)), Some("fixed")),
            model("cursor", "composer-2.5-fast", "Composer 2.5 Fast", Some(200_000), true, &["text", "image"], Some((3.0, 15.0)), Some("fixed")),
            model("cursor", "claude-sonnet-5-5", "Claude Sonnet 5.5", Some(300_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("cursor", "claude-haiku-5-5", "Claude Haiku 5.5", Some(100_000), true, &["text", "image"], Some((0.1, 0.5)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[sub("cursor")], &HashMap::new());
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("cursor/claude-opus-5-5"));
        assert_eq!(selector_of(&proposals, "task").as_deref(), Some("cursor/composer-2.5"));
        assert_eq!(selector_of(&proposals, "vision").as_deref(), Some("cursor/claude-sonnet-5-5"));
        assert_eq!(selector_of(&proposals, "smol").as_deref(), Some("cursor/claude-haiku-5-5"));
    }

    #[test]
    fn google_antigravity_usa_flash_e_il_flash_lite_con_id_piu_alto() {
        let catalog = vec![
            model("google-antigravity", "claude-opus-4-6", "Claude Opus 4.6", Some(250_000), true, &["text", "image"], Some((5.0, 25.0)), Some("fixed")),
            model("google-antigravity", "gemini-2.5-flash", "Gemini 2.5 Flash", Some(1_048_576), true, &["text", "image"], Some((0.3, 2.5)), Some("fixed")),
            // Il nome dice "3.5": vince l'ID, quindi 2.5.
            model("google-antigravity", "gemini-2.5-flash-lite", "Gemini 3.5 Flash Lite", Some(1_048_576), true, &["text", "image"], Some((0.1, 0.4)), Some("fixed")),
            model("google-antigravity", "gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", Some(1_048_576), true, &["text", "image"], Some((0.25, 1.5)), Some("fixed")),
            model("google-antigravity", "gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", Some(1_048_576), true, &["text", "image"], Some((0.3, 2.5)), Some("fixed")),
            model("google-antigravity", "gemini-3.8-flash", "Gemini 3.8 Flash", Some(1_048_576), true, &["text", "image"], Some((0.75, 3.75)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[sub("google-antigravity")], &HashMap::new());
        assert_eq!(selector_of(&proposals, "vision").as_deref(), Some("google-antigravity/gemini-3.8-flash"));
        // Flash Lite: la versione piu' alta per ID e' 3.5, non 2.5 (nome "3.5").
        assert_eq!(
            selector_of(&proposals, "smol").as_deref(),
            Some("google-antigravity/gemini-3.5-flash-lite")
        );
        // Q: Gemini Pro non c'e', quindi la policy passa a Opus.
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("google-antigravity/claude-opus-4-6"));
    }

    #[test]
    fn vision_su_commandcode_esclude_i_modelli_senza_immagini() {
        let catalog = vec![
            // Stessa famiglia, versione piu' alta, ma senza immagini su questa route.
            model("commandcode", "claude-sonnet-5-5", "Claude Sonnet 5.5 (CC)", Some(1_000_000), true, &["text"], None, Some("unknown")),
            model("commandcode", "claude-sonnet-5", "Claude Sonnet 5 (CC)", Some(1_000_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("commandcode", "claude-opus-5-5", "Claude Opus 5.5 (CC)", Some(1_000_000), true, &["text"], None, Some("unknown")),
        ];
        let proposals = propose(&catalog, &[api("commandcode")], &HashMap::new());
        let vision = by_role(&proposals, "vision");
        // I requisiti si filtrano prima dell'ordinamento per versione.
        assert_eq!(vision.selector.as_deref(), Some("commandcode/claude-sonnet-5"));
        // `default` invece prende la versione piu' alta anche senza immagini.
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("commandcode/claude-opus-5-5"));
        assert!(!vision.notes.contains(&NoteCode::SubscriptionPreferred));
    }

    #[test]
    fn abbonamento_batte_la_chiave_api_indipendentemente_dall_ordine() {
        let catalog = vec![
            opus_5_5(),
            model("commandcode", "claude-opus-5-5", "Claude Opus 5.5 (CC)", Some(1_000_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed")),
        ];
        for connections in [
            vec![sub("anthropic"), api("commandcode")],
            vec![api("commandcode"), sub("anthropic")],
        ] {
            let proposals = propose(&catalog, &connections, &HashMap::new());
            let default = by_role(&proposals, "default");
            assert_eq!(default.selector.as_deref(), Some("anthropic/claude-opus-5-5"));
            assert!(default.notes.contains(&NoteCode::SubscriptionPreferred));
        }
    }

    #[test]
    fn risultato_indipendente_dall_ordine_del_catalogo() {
        let mut catalog = vec![
            model("anthropic", "claude-opus-5", "Opus 5", Some(1_000_000), true, &["text", "image"], Some((5.0, 25.0)), Some("fixed")),
            opus_5_5(),
            model("anthropic", "claude-sonnet-5-5", "Sonnet 5.5", Some(1_000_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
            model("openai-codex", "gpt-6.1-sol", "GPT-6.1 Sol", Some(500_000), true, &["text", "image"], Some((2.0, 10.0)), Some("fixed")),
        ];
        let connections = [sub("anthropic"), sub("openai-codex")];
        let first = propose(&catalog, &connections, &HashMap::new());
        catalog.reverse();
        let second = propose(&catalog, &connections, &HashMap::new());
        let selectors = |proposals: &[RoleProposal]| -> Vec<Option<String>> {
            proposals.iter().map(|proposal| proposal.selector.clone()).collect()
        };
        assert_eq!(selectors(&first), selectors(&second));
    }

    #[test]
    fn snapshot_datati_e_preview_mai_scelti() {
        let catalog = vec![
            model("anthropic", "claude-opus-4-5-20251101", "Claude Opus 4.5", Some(200_000), true, &["text", "image"], Some((5.0, 25.0)), Some("fixed")),
            model("anthropic", "claude-opus-5-preview", "Claude Opus 5 Preview", Some(1_000_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed")),
            model("anthropic", "claude-opus-5-5-beta", "Claude Opus 5.5 Beta", Some(1_000_000), true, &["text", "image"], Some((4.0, 20.0)), Some("fixed")),
            model("anthropic", "claude-opus-5", "Claude Opus 5", Some(1_000_000), true, &["text", "image"], Some((5.0, 25.0)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[sub("anthropic")], &HashMap::new());
        assert_eq!(selector_of(&proposals, "default").as_deref(), Some("anthropic/claude-opus-5"));
    }

    #[test]
    fn fable_e_mythos_non_sostituiscono_opus() {
        let catalog = vec![
            model("anthropic", "claude-fable-5-2", "Claude Fable 5.2", Some(1_000_000), true, &["text", "image"], Some((8.0, 40.0)), Some("fixed")),
            model("anthropic", "claude-mythos-5-2", "Claude Mythos 5.2", Some(1_000_000), true, &["text", "image"], Some((8.0, 40.0)), Some("fixed")),
            opus_5_5(),
        ];
        let proposals = propose(&catalog, &[sub("anthropic")], &HashMap::new());
        for role in CARD_ROLES {
            let selector = selector_of(&proposals, role).unwrap_or_default();
            assert!(
                !selector.contains("fable") && !selector.contains("mythos"),
                "ruolo {role} non deve usare Fable/Mythos: {selector}"
            );
        }
    }

    #[test]
    fn current_preservato_e_segnato_fuori_catalogo() {
        let catalog = vec![opus_5_5()];
        let mut current = HashMap::new();
        current.insert("default".to_string(), "anthropic/claude-opus-5-5:medium".to_string());
        current.insert("smol".to_string(), "anthropic/claude-haiku-9:low".to_string());
        current.insert("commit".to_string(), "anthropic/claude-haiku-9".to_string());
        let proposals = propose(&catalog, &[sub("anthropic")], &current);

        let default = by_role(&proposals, "default");
        assert_eq!(default.current.as_deref(), Some("anthropic/claude-opus-5-5:medium"));
        assert!(default.current_in_catalog);
        // Il selector proposto resta senza thinking: il valore attuale e' un
        // altro campo, non viene sovrascritto.
        assert_eq!(default.selector.as_deref(), Some("anthropic/claude-opus-5-5"));
        assert!(!default.notes.contains(&NoteCode::CurrentModelNotInCatalog));

        let smol = by_role(&proposals, "smol");
        assert!(smol.current.is_some());
        assert!(!smol.current_in_catalog);
        assert!(smol.notes.contains(&NoteCode::CurrentModelNotInCatalog));

        let commit = by_role(&proposals, "commit");
        assert_eq!(commit.current.as_deref(), Some("anthropic/claude-haiku-9"));
        assert!(!commit.current_in_catalog);
        assert!(commit.notes.contains(&NoteCode::CurrentModelNotInCatalog));
    }

    #[test]
    fn commit_copia_la_proposta_di_smol_senza_thinking() {
        let catalog = vec![model("anthropic", "claude-haiku-5-5", "Haiku 5.5", Some(100_000), true, &["text", "image"], Some((0.1, 0.5)), Some("fixed"))];
        let proposals = propose(&catalog, &[sub("anthropic")], &HashMap::new());
        let smol = by_role(&proposals, "smol");
        let commit = by_role(&proposals, "commit");
        assert_eq!(commit.selector, smol.selector);
        assert_eq!(commit.family_id, smol.family_id);
        assert_eq!(commit.reason, smol.reason);
        assert_eq!(commit.thinking, None);
    }

    #[test]
    fn nessun_provider_collegato_nessuna_proposta() {
        let catalog = vec![opus_5_5()];
        let proposals = propose(&catalog, &[], &HashMap::new());
        assert_eq!(proposals.len(), 6);
        for proposal in &proposals {
            assert_eq!(proposal.selector, None);
            assert_eq!(proposal.confidence, Confidence::None);
            let expected = if proposal.role == "vision" {
                ReasonCode::NoVisionModel
            } else {
                ReasonCode::NoEligibleModel
            };
            assert_eq!(proposal.reason, expected);
        }
    }

    #[test]
    fn euristica_sceglie_il_costo_noto_piu_basso_e_non_il_gratis_sconosciuto() {
        let catalog = vec![
            // Prezzo sconosciuto: non vale zero, quindi non e' "il piu' economico".
            model("acme", "zeta-small", "Zeta Small", Some(200_000), false, &["text"], None, Some("unknown")),
            model("acme", "eco-small", "Eco Small", Some(200_000), false, &["text"], Some((0.5, 1.0)), Some("fixed")),
            model("acme", "delta-large", "Delta Large", Some(1_000_000), true, &["text"], Some((10.0, 40.0)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[api("acme")], &HashMap::new());
        let smol = by_role(&proposals, "smol");
        assert_eq!(smol.selector.as_deref(), Some("acme/eco-small"));
        assert_eq!(smol.confidence, Confidence::Heuristic);
        assert_eq!(smol.reason, ReasonCode::HeuristicLowestKnownCost);

        // Per la qualita' vince il ragionamento, non il prezzo piu' alto.
        let default = by_role(&proposals, "default");
        assert_eq!(default.selector.as_deref(), Some("acme/delta-large"));
        assert_eq!(default.reason, ReasonCode::HeuristicSelection);
        assert_eq!(default.confidence, Confidence::Heuristic);
    }

    #[test]
    fn euristica_senza_prezzi_noti_dichiara_il_prezzo_sconosciuto() {
        let catalog = vec![
            model("acme", "eco-a", "Eco A", Some(200_000), true, &["text"], None, Some("unknown")),
            model("acme", "eco-b", "Eco B", Some(128_000), true, &["text"], None, Some("unknown")),
        ];
        let proposals = propose(&catalog, &[api("acme")], &HashMap::new());
        let smol = by_role(&proposals, "smol");
        assert_eq!(smol.reason, ReasonCode::HeuristicSelection);
        assert!(smol.notes.contains(&NoteCode::PricingUnknown));
        // Fascia di contesto piu' alta fra pari ragionamento.
        assert_eq!(smol.selector.as_deref(), Some("acme/eco-a"));
    }

    #[test]
    fn variabili_di_prezzo_non_sono_affidabili() {
        let catalog = vec![
            model("acme", "eco-a", "Eco A", Some(200_000), false, &["text"], Some((0.0, 0.0)), Some("variable")),
            model("acme", "eco-b", "Eco B", Some(200_000), false, &["text"], Some((2.0, 8.0)), Some("fixed")),
        ];
        let proposals = propose(&catalog, &[api("acme")], &HashMap::new());
        // `variable` con 0/0 non e' gratis: non vince sul prezzo noto.
        assert_eq!(selector_of(&proposals, "smol").as_deref(), Some("acme/eco-b"));
    }

    #[test]
    fn locale_ha_nota_sulle_prestazioni_e_perde_contro_un_abbonamento() {
        let catalog = vec![
            model("ollama", "llama3.2:3b", "Llama 3.2 3B", None, false, &["text"], None, Some("unknown")),
            model("anthropic", "claude-haiku-5-5", "Haiku 5.5", Some(100_000), true, &["text", "image"], Some((0.1, 0.5)), Some("fixed")),
        ];
        let local_only = propose(&catalog, &[local_conn("ollama")], &HashMap::new());
        let smol = by_role(&local_only, "smol");
        assert_eq!(smol.selector.as_deref(), Some("ollama/llama3.2:3b"));
        assert!(smol.notes.contains(&NoteCode::LocalPerformanceUnknown));
        assert_eq!(smol.confidence, Confidence::Heuristic);

        let with_subscription = propose(
            &catalog,
            &[local_conn("ollama"), sub("anthropic")],
            &HashMap::new(),
        );
        assert_eq!(
            selector_of(&with_subscription, "smol").as_deref(),
            Some("anthropic/claude-haiku-5-5")
        );
    }

    #[test]
    fn vision_senza_modelli_con_immagini_dichiara_l_assenza() {
        let catalog = vec![model("acme", "eco-text", "Eco Text", Some(200_000), true, &["text"], Some((1.0, 2.0)), Some("fixed"))];
        let proposals = propose(&catalog, &[api("acme")], &HashMap::new());
        let vision = by_role(&proposals, "vision");
        assert_eq!(vision.selector, None);
        assert_eq!(vision.reason, ReasonCode::NoVisionModel);
        assert_eq!(vision.confidence, Confidence::None);
    }

    #[test]
    fn nome_incoerente_segnalato_senza_cambiare_la_famiglia() {
        let catalog = vec![model("google-antigravity", "gemini-2.5-flash-lite", "Gemini 3.5 Flash Lite", Some(1_048_576), true, &["text", "image"], Some((0.1, 0.4)), Some("fixed"))];
        let proposals = propose(&catalog, &[sub("google-antigravity")], &HashMap::new());
        let smol = by_role(&proposals, "smol");
        assert_eq!(smol.family_id.as_deref(), Some("google.flash_lite"));
        assert!(smol.notes.contains(&NoteCode::CatalogMetadataConflict));
        // La versione resta quella dell'ID: 2.5, non 3.5.
        assert_eq!(smol.selector.as_deref(), Some("google-antigravity/gemini-2.5-flash-lite"));
    }

    #[test]
    fn credenziali_ridotte_alla_migliore_per_provider() {
        let credentials = vec![
            ("cursor".to_string(), "api_key".to_string()),
            ("cursor".to_string(), "oauth".to_string()),
            ("commandcode".to_string(), "api_key".to_string()),
        ];
        let connections = Connection::from_credentials(&credentials);
        assert_eq!(connections.len(), 2);
        let cursor = connections
            .iter()
            .find(|connection| connection.provider == "cursor")
            .unwrap();
        assert_eq!(cursor.access, AccessKind::Subscription);
        let commandcode = connections
            .iter()
            .find(|connection| connection.provider == "commandcode")
            .unwrap();
        assert_eq!(commandcode.access, AccessKind::ApiKey);
    }

    #[test]
    fn selector_con_thinking_non_intacca_i_selector_con_due_punti() {
        let mut known = HashSet::new();
        known.insert("kilo/arcee-ai/trinity-large-preview:free".to_string());
        assert_eq!(
            selector_base("kilo/arcee-ai/trinity-large-preview:free", &known),
            "kilo/arcee-ai/trinity-large-preview:free"
        );
        assert_eq!(
            selector_base("anthropic/claude-opus-5-5:medium", &known),
            "anthropic/claude-opus-5-5"
        );
    }
}
