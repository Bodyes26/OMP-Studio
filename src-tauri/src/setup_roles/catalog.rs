//! Voce di catalogo vista dal resolver dei ruoli.
//!
//! Tipo proprio invece di `models_ops::ModelDto` per una ragione concreta:
//! `pricingStatus` — che decide se un prezzo e' affidabile e quindi se un
//! modello puo' vincere come "piu' economico" — esiste solo nell'output vivo di
//! `omp models --kind all --json`, non nella cache `models.db` letta da
//! `get_models_catalog`. Il resolver ha bisogno di quel campo, quindi legge il
//! catalogo vivo e usa la cache solo come ripiego.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCost {
    pub input: Option<f64>,
    pub output: Option<f64>,
}

fn default_kind() -> String {
    "chat".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub provider: String,
    pub selector: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
    /// Livelli di pensiero dichiarati, nell'ordine pubblicato da omp.
    pub thinking: Option<Vec<String>>,
    pub input: Option<Vec<String>>,
    pub cost: Option<CatalogCost>,
    /// `fixed` | `variable` | `unknown`. Solo `fixed` rende utilizzabile il
    /// prezzo dichiarato per un confronto.
    pub pricing_status: Option<String>,
}

impl CatalogModel {
    fn from_dto(model: &crate::models_ops::ModelDto) -> Self {
        CatalogModel {
            id: model.id.clone(),
            name: model.name.clone(),
            provider: model.provider.clone(),
            selector: model.selector.clone(),
            kind: model.kind.clone(),
            context_window: model.context_window,
            max_tokens: model.max_tokens,
            reasoning: model.reasoning,
            thinking: model
                .thinking
                .as_ref()
                .and_then(|info| info.efforts.clone()),
            input: model.input.clone(),
            cost: model.cost.as_ref().map(|cost| CatalogCost {
                input: cost.input,
                output: cost.output,
            }),
            // La cache non conserva lo stato del prezzo: resta `None`, che
            // vale "non affidabile" e non "gratis".
            pricing_status: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    models: Vec<CatalogModel>,
}

/// Interpreta la risposta di `omp models --kind all --json`.
fn parse_catalog(bytes: &[u8]) -> Result<Vec<CatalogModel>, String> {
    serde_json::from_slice::<ModelsResponse>(bytes)
        .map(|response| response.models)
        .map_err(|error| {
            crate::tr!(
                format!("Catalogo modelli non leggibile: {}", error),
                format!("Models catalog could not be parsed: {}", error)
            )
        })
}

/// Catalogo per il resolver: quello vivo di omp, perche' e' l'unico che
/// dichiara `pricingStatus`; se il binario non risponde, la cache locale
/// (senza stato del prezzo, quindi con l'euristica economica disattivata).
async fn load_catalog() -> Vec<CatalogModel> {
    let omp_path = crate::omp_ops::get_omp_binary();
    let live = tokio::task::spawn_blocking(move || {
        let mut command = std::process::Command::new(omp_path);
        command.arg("models").arg("--kind").arg("all").arg("--json");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        crate::omp_ops::omp_capture(command)
    })
    .await;

    let live_models = match live {
        Ok(Ok(output)) if output.status.success() => parse_catalog(&output.stdout).unwrap_or_default(),
        _ => Vec::new(),
    };

    // `omp models` senza login elenca solo i provider effettivamente
    // disponibili; la cache `models.db` ne contiene molti di piu' (aggregatori,
    // provider visti in passato). Il resolver deve vedere lo stesso elenco del
    // resto dell'app, altrimenti un provider collegato non avrebbe candidati:
    // quindi l'unione, con la voce viva che vince perche' e' l'unica che
    // dichiara `pricingStatus`.
    let cached = crate::models_ops::get_models_catalog()
        .await
        .unwrap_or_default();

    let mut merged = live_models;
    let known: std::collections::HashSet<String> =
        merged.iter().map(|model| model.selector.clone()).collect();
    for model in &cached {
        let entry = CatalogModel::from_dto(model);
        if !known.contains(&entry.selector) {
            merged.push(entry);
        }
    }
    merged
}

/// Catalogo per il comando Tauri. Nessuna rete: `omp models` legge cache e
/// definizioni locali.
pub async fn catalog_for_setup() -> Vec<CatalogModel> {
    load_catalog().await
}

#[cfg(test)]
pub mod fixtures {
    use super::CatalogModel;

    /// Catalogo sanitizzato da `omp models --kind all --json` della macchina
    /// di sviluppo: solo metadati, nessuna credenziale ne' dato account. Il
    /// file e' la stessa forma dell'output di omp, quindi il test esercita
    /// anche il parsing reale.
    pub fn load(provider: &str) -> Vec<CatalogModel> {
        let raw = match provider {
            "anthropic" => include_bytes!("fixtures/anthropic.json").as_slice(),
            "openai-codex" => include_bytes!("fixtures/openai-codex.json").as_slice(),
            "google-antigravity" => include_bytes!("fixtures/google-antigravity.json").as_slice(),
            "cursor" => include_bytes!("fixtures/cursor.json").as_slice(),
            "commandcode" => include_bytes!("fixtures/commandcode.json").as_slice(),
            "local" => include_bytes!("fixtures/local.json").as_slice(),
            other => panic!("fixture {} inesistente", other),
        };
        super::parse_catalog(raw).expect("fixture di catalogo non valida")
    }

    /// Catalogo con le fixture dei provider indicati, nell'ordine dato.
    pub fn load_many(providers: &[&str]) -> Vec<CatalogModel> {
        providers.iter().flat_map(|provider| load(provider)).collect()
    }

    pub const PROVIDERS: [&str; 6] = [
        "anthropic",
        "openai-codex",
        "google-antigravity",
        "cursor",
        "commandcode",
        "local",
    ];
}
