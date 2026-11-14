//! Proposta deterministica dei ruoli del setup grafico (SET-012, SET-042).
//!
//! Nessuna chiamata di rete e nessun LLM: la proposta e' una funzione del
//! catalogo di omp, delle credenziali attive e di `modelRoles`. Il design e la
//! tabella delle famiglie stanno in `local://roles-design.md` (round 2, che
//! prevale sul round 1); il contratto TS del comando in
//! `local://setup-impl.md`.
//!
//! Moduli:
//!
//! - `families`: registro delle famiglie, riconoscimento e confronto versioni;
//! - `policy`: ruolo -> slot, provider -> famiglie ordinate, livello di
//!   pensiero;
//! - `resolver`: la logica pura (`propose`), senza I/O;
//! - `catalog`: il catalogo che il resolver consuma e le fixture dei test.
//!
//! Il comando legge i dati reali e delega tutto a `resolver::propose`: cosi'
//! test e produzione eseguono lo stesso codice, e i test non hanno bisogno ne'
//! di omp ne' di credenziali.

pub mod catalog;
pub mod families;
pub mod policy;
pub mod resolver;

use crate::models_ops::get_model_config;
use resolver::{
    propose, AccessKind, Connection, RoleProposal, RoleProposalResponse,
};
use tauri::command;

/// Credenziali attive da `agent.db`, nella forma `(provider, tipo)`. Stessa
/// query di `get_role_suggestions`: `disabled_cause IS NULL` esclude gli
/// account spenti, che non possono autenticare nulla e non devono far
/// risultare collegato il loro provider. Un database assente o illeggibile non
/// fa fallire la proposta: resta solo senza connessioni, e le card diranno che
/// non c'e' nessun candidato.
fn read_active_credentials() -> Vec<(String, String)> {
    let Ok(conn) = crate::omp_ops::open_readonly_db("agent.db") else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn
        .prepare("SELECT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL")
    else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });
    match rows {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

/// Provider con una connessione utilizzabile.
///
/// Un provider locale non ha una riga in `auth_credentials`: entra solo se il
/// suo catalogo lo espone, cioe' se il runtime e' effettivamente in funzione.
/// Non si presume la presenza di Ollama solo perche' l'app e' installata.
fn connections(catalog: &[catalog::CatalogModel]) -> Vec<Connection> {
    connections_from(&read_active_credentials(), catalog)
}

/// Come `connections`, sulle credenziali gia' lette: la parte pura, cosi' i
/// test non dipendono dallo stato di login della macchina.
fn connections_from(
    credentials: &[(String, String)],
    catalog: &[catalog::CatalogModel],
) -> Vec<Connection> {
    let mut connections = Connection::from_credentials(credentials);

    let local_present: std::collections::HashSet<&str> =
        crate::setup_roles::policy::LOCAL_PROVIDERS
            .iter()
            .copied()
            .filter(|provider| catalog.iter().any(|model| model.provider == *provider))
            .collect();
    for provider in local_present {
        if !connections
            .iter()
            .any(|connection| connection.provider == provider)
        {
            connections.push(Connection {
                provider: provider.to_string(),
                access: AccessKind::Local,
            });
        }
    }
    connections
}

/// Provider spenti in `config.yml` (`disabledProviders`): le loro credenziali
/// possono essere ancora nel database, ma l'utente li ha esclusi e nessun
/// ruolo deve finire su di loro.
fn without_disabled(connections: Vec<Connection>, disabled: &[String]) -> Vec<Connection> {
    connections
        .into_iter()
        .filter(|connection| !disabled.contains(&connection.provider))
        .collect()
}

/// Ruoli proposti per il setup grafico.
///
/// Il risultato contiene sempre i sei ruoli del setup, nell'ordine
/// `default, plan, smol, vision, task, commit`. Un ruolo senza candidati ha
/// `selector: null` e una motivazione di assenza: la UI deve dirlo, non
/// inventare un modello.
#[command]
pub async fn setup_propose_roles() -> Result<RoleProposalResponse, String> {
    let catalog = catalog::catalog_for_setup().await;
    let config = get_model_config().await?;
    let connections = without_disabled(connections(&catalog), &config.disabled_providers);
    let roles: Vec<RoleProposal> = propose(&catalog, &connections, &config.model_roles);
    Ok(RoleProposalResponse { roles })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup_roles::policy::{CARD_ROLES, SETUP_ROLES};
    use resolver::Confidence;
    use std::collections::HashSet;

    fn connections_of(providers: &[(&str, AccessKind)]) -> Vec<Connection> {
        providers
            .iter()
            .map(|(provider, access)| Connection {
                provider: provider.to_string(),
                access: *access,
            })
            .collect()
    }

    fn by_role<'a>(roles: &'a [RoleProposal], role: &str) -> &'a RoleProposal {
        roles
            .iter()
            .find(|proposal| proposal.role == role)
            .unwrap_or_else(|| panic!("ruolo {} assente", role))
    }

    fn fixture_catalog(providers: &[&str]) -> Vec<catalog::CatalogModel> {
        catalog::fixtures::load_many(providers)
    }

    #[test]
    fn fixture_reali_di_anthropic() {
        let catalog = fixture_catalog(&["anthropic"]);
        let roles = propose(&catalog, &connections_of(&[("anthropic", AccessKind::Subscription)]), &Default::default());
        // Esiti attesi del design (sezione 9, aggiornata dalla policy finale).
        assert_eq!(by_role(&roles, "default").selector.as_deref(), Some("anthropic/claude-opus-5-5"));
        assert_eq!(by_role(&roles, "task").selector.as_deref(), Some("anthropic/claude-sonnet-5-5"));
        assert_eq!(by_role(&roles, "smol").selector.as_deref(), Some("anthropic/claude-haiku-5-5"));
        assert_eq!(by_role(&roles, "vision").selector.as_deref(), Some("anthropic/claude-sonnet-5-5"));
        assert_eq!(by_role(&roles, "plan").thinking.as_deref(), Some("high"));
    }

    #[test]
    fn fixture_reali_di_openai_codex() {
        let catalog = fixture_catalog(&["openai-codex"]);
        let roles = propose(&catalog, &connections_of(&[("openai-codex", AccessKind::Subscription)]), &Default::default());
        assert_eq!(by_role(&roles, "default").selector.as_deref(), Some("openai-codex/gpt-6.1-sol"));
        assert_eq!(by_role(&roles, "task").selector.as_deref(), Some("openai-codex/gpt-6.1-terra"));
        assert_eq!(by_role(&roles, "smol").selector.as_deref(), Some("openai-codex/gpt-6-luna"));
    }

    #[test]
    fn fixture_reali_di_cursor() {
        let catalog = fixture_catalog(&["cursor"]);
        let roles = propose(&catalog, &connections_of(&[("cursor", AccessKind::Subscription)]), &Default::default());
        // Forma standard: ne' `-fast` ne' `-1m`.
        assert_eq!(by_role(&roles, "default").selector.as_deref(), Some("cursor/claude-opus-5-5"));
        assert_eq!(by_role(&roles, "task").selector.as_deref(), Some("cursor/composer-2.5"));
        assert_eq!(by_role(&roles, "smol").selector.as_deref(), Some("cursor/claude-haiku-5-5"));
        assert_eq!(by_role(&roles, "vision").selector.as_deref(), Some("cursor/claude-sonnet-5-5"));
    }

    #[test]
    fn fixture_reali_di_google_antigravity() {
        let catalog = fixture_catalog(&["google-antigravity"]);
        let roles = propose(&catalog, &connections_of(&[("google-antigravity", AccessKind::Subscription)]), &Default::default());
        assert_eq!(by_role(&roles, "vision").selector.as_deref(), Some("google-antigravity/gemini-3.8-flash"));
        // Flash Lite per ID piu' alto: 3.5, non 2.5 (il cui nome dice "3.5").
        assert_eq!(
            by_role(&roles, "smol").selector.as_deref(),
            Some("google-antigravity/gemini-3.5-flash-lite")
        );
    }

    #[test]
    fn fixture_reali_di_commandcode_escludono_vision_senza_immagini() {
        let catalog = fixture_catalog(&["commandcode"]);
        let roles = propose(&catalog, &connections_of(&[("commandcode", AccessKind::ApiKey)]), &Default::default());
        let vision = by_role(&roles, "vision");
        let selector = vision.selector.clone().expect("vision risolto");
        let model = catalog
            .iter()
            .find(|model| model.selector == selector)
            .expect("selector presente nel catalogo");
        // Le capability sono quelle della route: se non dichiara `image` su
        // CommandCode non vale per la visione, anche se Anthropic lo fa.
        assert!(model
            .input
            .as_ref()
            .map(|values| values.iter().any(|value| value == "image"))
            .unwrap_or(false));
    }

    #[test]
    fn fixture_reali_abbonamento_anthropic_batte_commandcode_api() {
        let catalog = fixture_catalog(&["anthropic", "commandcode"]);
        let roles = propose(
            &catalog,
            &connections_of(&[
                ("anthropic", AccessKind::Subscription),
                ("commandcode", AccessKind::ApiKey),
            ]),
            &Default::default(),
        );
        assert_eq!(by_role(&roles, "default").selector.as_deref(), Some("anthropic/claude-opus-5-5"));
        assert!(by_role(&roles, "default")
            .notes
            .contains(&resolver::NoteCode::SubscriptionPreferred));
    }

    #[test]
    fn fixture_reali_ordine_del_catalogo_irrilevante() {
        let mut catalog = fixture_catalog(&[
            "anthropic",
            "openai-codex",
            "google-antigravity",
            "cursor",
            "commandcode",
        ]);
        let connections = connections_of(&[
            ("anthropic", AccessKind::Subscription),
            ("openai-codex", AccessKind::Subscription),
            ("google-antigravity", AccessKind::Subscription),
            ("cursor", AccessKind::Subscription),
            ("commandcode", AccessKind::ApiKey),
        ]);
        let first = propose(&catalog, &connections, &Default::default());
        catalog.reverse();
        let second = propose(&catalog, &connections, &Default::default());
        let selectors = |roles: &[RoleProposal]| -> Vec<Option<String>> {
            roles.iter().map(|role| role.selector.clone()).collect()
        };
        assert_eq!(selectors(&first), selectors(&second));
    }

    #[test]
    fn fixture_reali_nessun_selector_fuori_catalogo_o_con_varianti() {
        let catalog = fixture_catalog(&catalog::fixtures::PROVIDERS);
        let connections = connections_of(&[
            ("anthropic", AccessKind::Subscription),
            ("openai-codex", AccessKind::Subscription),
            ("google-antigravity", AccessKind::Subscription),
            ("cursor", AccessKind::Subscription),
            ("commandcode", AccessKind::ApiKey),
            ("local", AccessKind::Local),
        ]);
        let roles = propose(&catalog, &connections, &Default::default());
        let known: HashSet<&str> = catalog.iter().map(|model| model.selector.as_str()).collect();

        for role in &roles {
            let Some(selector) = &role.selector else {
                continue;
            };
            // Ogni selector proposto esiste nel catalogo della sua route.
            assert!(known.contains(selector.as_str()), "selector inesistente: {selector}");
            // Nessuna variante esclusa, nessuna versione non definitiva.
            for token in ["-fast", "-1m", ":free", "preview", "-beta", "-alpha", "-rc"] {
                assert!(
                    !selector.contains(token),
                    "selector {selector} contiene la variante {token}"
                );
            }
            // `commit` non porta mai thinking.
            if role.role == "commit" {
                assert_eq!(role.thinking, None);
            }
        }
    }

    #[test]
    fn fixture_reali_thinking_sempre_supportato_dal_modello() {
        let catalog = fixture_catalog(&catalog::fixtures::PROVIDERS);
        let connections = connections_of(&[
            ("anthropic", AccessKind::Subscription),
            ("openai-codex", AccessKind::Subscription),
            ("google-antigravity", AccessKind::Subscription),
            ("cursor", AccessKind::Subscription),
            ("commandcode", AccessKind::ApiKey),
        ]);
        let roles = propose(&catalog, &connections, &Default::default());
        for role in &roles {
            let (Some(selector), Some(thinking)) = (&role.selector, &role.thinking) else {
                continue;
            };
            let model = catalog
                .iter()
                .find(|model| &model.selector == selector)
                .expect("modello del selector");
            let levels = model.thinking.as_ref().expect("livelli dichiarati");
            assert!(
                levels.contains(thinking),
                "{} non dichiara il livello {} su {}",
                selector,
                thinking,
                model.provider
            );
        }
    }

    #[test]
    fn fixture_reali_tutti_i_ruoli_nell_ordine_del_contratto() {
        let catalog = fixture_catalog(&["anthropic"]);
        let roles = propose(&catalog, &connections_of(&[("anthropic", AccessKind::Subscription)]), &Default::default());
        let ids: Vec<&str> = roles.iter().map(|role| role.role.as_str()).collect();
        assert_eq!(ids, SETUP_ROLES.to_vec());
        assert_eq!(roles.len(), CARD_ROLES.len() + 1);
    }

    #[test]
    fn fixture_reali_stato_vuoto_senza_ruoli() {
        let catalog = fixture_catalog(&["anthropic"]);
        let roles = propose(&catalog, &[], &Default::default());
        assert!(roles.iter().all(|role| role.confidence == Confidence::None));
        assert!(roles.iter().all(|role| role.selector.is_none()));
    }

    #[test]
    fn provider_locale_entra_solo_se_il_catalogo_lo_espone() {
        let catalog = fixture_catalog(&["local"]);
        // La fixture `local` espone il runtime incorporato di omp: entra come
        // connessione locale. Ollama invece non compare, e non va inventato:
        // un runtime assente dal catalogo non e' in funzione.
        let found = connections_from(&[], &catalog);
        assert!(found
            .iter()
            .any(|connection| connection.provider == "local" && connection.access == AccessKind::Local));
        assert!(found.iter().all(|connection| connection.provider != "ollama"));

        let mut renamed = catalog.clone();
        for model in &mut renamed {
            model.provider = "ollama".to_string();
            model.selector = format!("ollama/{}", model.id);
        }
        let found = connections_from(&[], &renamed);
        assert!(found
            .iter()
            .any(|connection| connection.provider == "ollama" && connection.access == AccessKind::Local));
    }

    #[test]
    fn provider_disabilitati_esclusi() {
        let connections = connections_of(&[
            ("anthropic", AccessKind::Subscription),
            ("cursor", AccessKind::Subscription),
        ]);
        let filtered = without_disabled(connections, &["cursor".to_string()]);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].provider, "anthropic");
    }

    /// Controllo **live, non bloccante**, sul catalogo di omp di questa
    /// macchina: elenca le famiglie preferite dalla policy che non hanno
    /// nessun modello idoneo e gli ID nuovi che nessun pattern riconosce. Non
    /// fa fallire la suite (`#[ignore]`): la CI lavora sulle fixture, questo
    /// serve a chi sta aggiungendo una famiglia.
    ///
    /// `cargo test --manifest-path src-tauri/Cargo.toml --lib setup_roles::tests::controllo_live_del_catalogo -- --ignored --nocapture`
    #[test]
    #[ignore = "controllo live non bloccante: richiede omp e il catalogo della macchina"]
    fn controllo_live_del_catalogo() {
        use crate::setup_roles::families::classify;
        use crate::setup_roles::policy::policy_for;

        let runtime = tokio::runtime::Runtime::new().expect("runtime tokio");
        let catalog = runtime.block_on(catalog::catalog_for_setup());
        if catalog.is_empty() {
            println!("catalogo vuoto: nessun controllo possibile");
            return;
        }

        // Stessi dati del comando: credenziali attive, provider spenti e
        // `modelRoles` reali, cosi' `current` e `currentInCatalog` sono quelli
        // che la UI vedrebbe davvero.
        let config = runtime.block_on(get_model_config()).ok();
        let empty_roles = std::collections::HashMap::new();
        let disabled = config
            .as_ref()
            .map(|config| config.disabled_providers.clone())
            .unwrap_or_default();
        let current_roles = config
            .as_ref()
            .map(|config| &config.model_roles)
            .unwrap_or(&empty_roles);
        let connections = without_disabled(connections(&catalog), &disabled);
        let connected: Vec<&str> = connections
            .iter()
            .map(|connection| connection.provider.as_str())
            .collect();
        println!("provider collegati: {:?}", connected);

        for connection in &connections {
            let Some(policy) = policy_for(&connection.provider) else {
                continue;
            };
            let eligible: Vec<_> = catalog
                .iter()
                .filter(|model| model.provider == connection.provider)
                .filter(|model| crate::setup_roles::families::is_eligible_for_setup(model))
                .collect();

            for family_id in policy
                .quality
                .iter()
                .chain(policy.balanced)
                .chain(policy.small)
                .chain(policy.vision)
            {
                let matched = eligible
                    .iter()
                    .any(|model| classify(&connection.provider, model)
                        .map(|c| c.family.id == *family_id)
                        .unwrap_or(false));
                if !matched {
                    println!(
                        "attenzione: {} non ha modelli idonei per la famiglia {}",
                        connection.provider, family_id
                    );
                }
            }

            for model in &eligible {
                if classify(&connection.provider, model).is_none() {
                    println!(
                        "id non classificato su {}: {} ({})",
                        connection.provider, model.id, model.name
                    );
                }
            }
        }

        let roles = propose(&catalog, &connections, current_roles);
        println!(
            "{}",
            serde_json::to_string_pretty(&RoleProposalResponse { roles })
                .unwrap_or_else(|_| "risposta non serializzabile".to_string())
        );
    }
}
