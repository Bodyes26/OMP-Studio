use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::model::AutomationQuotaPolicy;

/// Risultato della valutazione del cancello di quota (Contract AUT-029/030/031/076/077).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaEvaluation {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usable_account_id: Option<String>,
}

/// Cache interna per i report di utilizzo (`omp usage --json`), TTL 60 secondi.
/// Evita lo spawning di subprocess per ogni controllo di quota / titolo AI.
static QUOTA_USAGE_CACHE: LazyLock<Mutex<Option<(Instant, Value)>>> =
    LazyLock::new(|| Mutex::new(None));
const CACHE_TTL: Duration = Duration::from_secs(60);

/// Aggiorna manualmente la cache dei report di utilizzo.
pub fn update_cached_usage(value: Value) {
    if let Ok(mut lock) = QUOTA_USAGE_CACHE.lock() {
        *lock = Some((Instant::now(), value));
    }
}

/// Recupera il report di utilizzo dalla cache interna se valido.
pub fn get_cached_usage() -> Option<Value> {
    let lock = QUOTA_USAGE_CACHE.lock().ok()?;
    let (at, val) = lock.as_ref()?;
    if at.elapsed() <= CACHE_TTL {
        Some(val.clone())
    } else {
        None
    }
}

fn starts_with_ignore_ascii_case(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// Ritorna la famiglia di modello secondo Contract C2 (anthropic, google, openai).
pub fn model_family_for(model_id: &str) -> Option<&'static str> {
    let s = model_id.trim();
    let clean = if let Some((before, _)) = s.split_once(':') {
        before.trim()
    } else {
        s
    };
    if starts_with_ignore_ascii_case(clean, "openai/") {
        return Some("openai");
    }
    let leaf = if let Some((_, after)) = clean.split_once('/') {
        after.trim()
    } else {
        clean
    };
    if starts_with_ignore_ascii_case(leaf, "claude-") {
        Some("anthropic")
    } else if starts_with_ignore_ascii_case(leaf, "gemini-") || starts_with_ignore_ascii_case(leaf, "gemma-") {
        Some("google")
    } else if starts_with_ignore_ascii_case(leaf, "gpt-") {
        Some("openai")
    } else {
        None
    }
}

/// Normalizza alias canonici documentati per il confronto dei provider (senza allocazioni).
pub fn canonical_provider(p: &str) -> &str {
    let s = p.trim();
    if s.eq_ignore_ascii_case("github-copilot") || s.eq_ignore_ascii_case("copilot") {
        "copilot"
    } else if s.eq_ignore_ascii_case("command-code") || s.eq_ignore_ascii_case("commandcode") {
        "commandcode"
    } else if s.eq_ignore_ascii_case("claude") {
        "anthropic"
    } else if s.eq_ignore_ascii_case("codex") {
        "openai-codex"
    } else if s.eq_ignore_ascii_case("gemini") || s.eq_ignore_ascii_case("google-antigravity") {
        "google"
    } else {
        s
    }
}

/// Confronta i provider preservando il provider reale e gli alias canonici documentati,
/// senza fondere provider non intercambiabili (es. google-gemini-cli vs google-antigravity vs google).
pub fn providers_match(p1: &str, p2: &str) -> bool {
    let c1 = canonical_provider(p1);
    let c2 = canonical_provider(p2);
    c1.eq_ignore_ascii_case(c2)
}

/// Classifica la finestra temporale di un limite in "short", "weekly" o "other".
pub fn categorize_window(window_id: &str, label: &str, duration_ms: Option<f64>) -> &'static str {
    if let Some(ms) = duration_ms {
        if ms > 0.0 {
            if ms <= 24.0 * 3600.0 * 1000.0 {
                return "short";
            } else if ms <= 7.0 * 24.0 * 3600.0 * 1000.0 {
                return "weekly";
            } else {
                return "other";
            }
        }
    }
    let id_l = window_id.to_lowercase();
    let lbl_l = label.to_lowercase();
    if id_l.contains("short") || id_l.contains("5h") || id_l.contains("day") || id_l.contains("daily") || lbl_l.contains("day") || lbl_l.contains("session") {
        "short"
    } else if id_l.contains("week") || id_l.contains("7d") || lbl_l.contains("week") {
        "weekly"
    } else {
        "other"
    }
}

/// Legge la configurazione dei ruoli modello da ~/.omp/agent/config.yml (con cache 10s).
static MODEL_ROLES_CACHE: LazyLock<Mutex<Option<(Instant, HashMap<String, String>)>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn read_model_roles_cached() -> HashMap<String, String> {
    if let Ok(lock) = MODEL_ROLES_CACHE.lock() {
        if let Some((at, ref roles)) = *lock {
            if at.elapsed() < Duration::from_secs(10) {
                return roles.clone();
            }
        }
    }

    let mut roles = HashMap::new();
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    if !home.is_empty() {
        let config_path = std::path::Path::new(&home).join(".omp").join("agent").join("config.yml");
        if let Ok(content) = std::fs::read_to_string(config_path) {
            if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(&content) {
                if let Some(mapping) = yaml.get("modelRoles").and_then(|v| v.as_mapping()) {
                    for (k, v) in mapping {
                        if let (Some(ks), Some(vs)) = (k.as_str(), v.as_str()) {
                            roles.insert(ks.to_string(), vs.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut lock) = MODEL_ROLES_CACHE.lock() {
        *lock = Some((Instant::now(), roles.clone()));
    }
    roles
}

/// Risolve il selettore modello effettivo a partire da ruolo o selettore esplicito.
pub fn resolve_model_selector(model_or_role: &str, roles: &HashMap<String, String>) -> String {
    let trimmed = model_or_role.trim();
    if trimmed.is_empty() {
        return roles.get("smol")
            .or_else(|| roles.get("default"))
            .cloned()
            .unwrap_or_default();
    }
    if let Some(target) = roles.get(trimmed) {
        return target.clone();
    }
    trimmed.to_string()
}

/// Informazioni estratte per un singolo limite di un account.
#[derive(Debug, Clone)]
struct ParsedLimit {
    window_cat: &'static str,
    window_id: String,
    remaining_pct: f64,
    remaining_amount: Option<f64>,
    limit_amount: Option<f64>,
    is_exhausted: bool,
}

/// Dati estratti per un singolo account attivo.
#[derive(Debug)]
struct AccountData {
    account_id: String,
    limits: Vec<ParsedLimit>,
    is_runnable: bool,
}

/// Valuta il cancello di quota con i report di utilizzo forniti (AUT-029/030/031/032/076/077).
///
/// Semantica esatta:
/// - Aggregazione multi-account pesata se sono presenti limiti fisici comparabili,
///   altrimenti media aritmetica fra account equivalenti dichiarati (es. 24% + 90% = 57%).
/// - Nessun minimo globale cross-account se la capacità aggregata supera la riserva.
/// - Nessun "account virtuale" cross-expired: deve esistere almeno un account reale
///   con nessuna finestra critica esaurita.
/// - Modelli locali (ollama, lmstudio, local) o pay-as-you-go senza limiti non vengono bloccati.
/// - Modelli ad abbonamento con report assenti/ignoti falliscono fail-closed (unknown non assume 100%).
/// - Deduplica degli shared pool (stesso sharedGroup all'interno dell'account).
/// - Account disabilitati o non autorizzati vengono scartati prima del calcolo.
pub fn evaluate_with_usage(
    model_or_role: &str,
    policy: &AutomationQuotaPolicy,
    usage_reports: &[Value],
) -> QuotaEvaluation {
    let roles = read_model_roles_cached();
    let resolved = resolve_model_selector(model_or_role, &roles);
    let resolved_clean = resolved.split(':').next().unwrap_or(&resolved).trim();

    if resolved_clean.is_empty() {
        return QuotaEvaluation {
            allowed: true,
            provider: None,
            remaining_pct: Some(100.0),
            window: None,
            reason: None,
            usable_account_id: None,
        };
    }

    let (provider, model_id) = if let Some((p, m)) = resolved_clean.split_once('/') {
        (p.trim().to_string(), m.trim().to_string())
    } else {
        (resolved_clean.to_string(), resolved_clean.to_string())
    };

    // Provider locali noti: nessun blocco di quota
    let p_canonical = canonical_provider(&provider);
    if p_canonical.eq_ignore_ascii_case("ollama")
        || p_canonical.eq_ignore_ascii_case("local")
        || p_canonical.eq_ignore_ascii_case("lmstudio")
        || p_canonical.eq_ignore_ascii_case("llamacpp")
        || p_canonical.eq_ignore_ascii_case("vllm")
        || p_canonical.eq_ignore_ascii_case("apple")
    {
        return QuotaEvaluation {
            allowed: true,
            provider: Some(provider),
            remaining_pct: Some(100.0),
            window: None,
            reason: None,
            usable_account_id: None,
        };
    }

    // Ricerca report corrispondenti al provider reale o alias canonico
    let matching_reports: Vec<&Value> = usage_reports
        .iter()
        .filter(|r| {
            r.get("provider")
                .and_then(|p| p.as_str())
                .map(|p| providers_match(p, &provider))
                .unwrap_or(false)
        })
        .collect();

    let family = model_family_for(&model_id);

    // Se non troviamo alcun report per un provider commerciale ad abbonamento:
    // AUT-032 / ACC-15: fail-closed, dati mancanti non diventano 100% disponibile.
    if matching_reports.is_empty() {
        let is_known_subscription = family.is_some()
            || p_canonical.eq_ignore_ascii_case("anthropic")
            || p_canonical.eq_ignore_ascii_case("openai")
            || p_canonical.eq_ignore_ascii_case("openai-codex")
            || p_canonical.eq_ignore_ascii_case("google")
            || p_canonical.eq_ignore_ascii_case("google-antigravity")
            || p_canonical.eq_ignore_ascii_case("google-gemini-cli")
            || p_canonical.eq_ignore_ascii_case("github-copilot")
            || p_canonical.eq_ignore_ascii_case("factory-droid");
        if is_known_subscription {
            return QuotaEvaluation {
                allowed: false,
                provider: Some(provider),
                remaining_pct: None,
                window: None,
                reason: Some("unknown".to_string()),
                usable_account_id: None,
            };
        } else {
            // Provider pay-as-you-go o custom non vincolato da quote
            return QuotaEvaluation {
                allowed: true,
                provider: Some(provider),
                remaining_pct: Some(100.0),
                window: None,
                reason: None,
                usable_account_id: None,
            };
        }
    }

    // Filtra account abilitati / attivi
    let mut accounts: Vec<AccountData> = Vec::new();

    for (idx, report) in matching_reports.iter().enumerate() {
        if let Some(meta) = report.get("metadata") {
            if meta.get("allowed").and_then(|v| v.as_bool()) == Some(false) {
                continue;
            }
            if meta.get("disabled").and_then(|v| v.as_bool()) == Some(true) {
                continue;
            }
            if let Some(status) = meta.get("status").and_then(|v| v.as_str()) {
                if status.eq_ignore_ascii_case("disabled") || status.eq_ignore_ascii_case("inactive") {
                    continue;
                }
            }
        }

        let account_id = report
            .get("metadata")
            .and_then(|m| m.get("accountId").or_else(|| m.get("email")).or_else(|| m.get("orgId")))
            .and_then(|v| v.as_str())
            .unwrap_or(&format!("account-{}", idx))
            .to_string();

        let limits_val = match report.get("limits").and_then(|l| l.as_array()) {
            Some(arr) if !arr.is_empty() => arr,
            _ => continue,
        };

        let mut seen_shared_groups = HashSet::new();
        let mut account_limits = Vec::new();
        let mut has_exhausted_window = false;

        for l in limits_val {
            // Deduplica shared pool
            if let Some(shared_group) = l.get("scope").and_then(|s| s.get("sharedGroup")).and_then(|g| g.as_str()) {
                if !seen_shared_groups.insert(shared_group.to_string()) {
                    continue;
                }
            }

            // Filtro famiglia se limit la specifica
            if let Some(fam) = family {
                let limit_id = l.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let label = l.get("label").and_then(|lbl| lbl.as_str()).unwrap_or("");
                let parts: Vec<&str> = limit_id.split(':').collect();
                let limit_fam = if parts.len() >= 2 {
                    let seg = parts[1].to_lowercase();
                    if seg == "anthropic" || seg == "claude" {
                        Some("anthropic")
                    } else if seg == "google" || seg == "gemini" || seg == "gemma" {
                        Some("google")
                    } else if seg == "openai" || seg == "gpt" {
                        Some("openai")
                    } else {
                        None
                    }
                } else {
                    None
                };
                if let Some(lf) = limit_fam {
                    if lf != fam {
                        continue;
                    }
                } else if !limit_id.is_empty() {
                    let lbl_lower = label.to_lowercase();
                    if fam == "anthropic" && (lbl_lower.contains("gemini") || lbl_lower.contains("openai")) {
                        continue;
                    }
                    if fam == "google" && (lbl_lower.contains("anthropic") || lbl_lower.contains("openai")) {
                        continue;
                    }
                    if fam == "openai" && (lbl_lower.contains("anthropic") || lbl_lower.contains("gemini")) {
                        continue;
                    }
                }
            }

            let window_id = l.get("window").and_then(|w| w.get("id")).and_then(|i| i.as_str()).unwrap_or("").to_string();
            let label = l.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let duration_ms = l.get("window").and_then(|w| w.get("durationMs")).and_then(|d| d.as_f64());
            let window_cat = categorize_window(&window_id, &label, duration_ms);

            let amount = l.get("amount");
            let remaining_frac = amount
                .and_then(|a| a.get("remainingFraction").and_then(|f| f.as_f64()))
                .or_else(|| amount.and_then(|a| a.get("usedFraction").and_then(|f| f.as_f64()).map(|u| 1.0 - u)))
                .unwrap_or(1.0);
            let remaining_pct = (remaining_frac.clamp(0.0, 1.0) * 100.0).round();

            let rem_amt = amount.and_then(|a| a.get("remaining").and_then(|v| v.as_f64()));
            let lim_amt = amount.and_then(|a| a.get("limit").and_then(|v| v.as_f64()));

            let status = l.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let is_exhausted = status.eq_ignore_ascii_case("exhausted") || remaining_pct <= 0.0;
            if is_exhausted {
                has_exhausted_window = true;
            }

            account_limits.push(ParsedLimit {
                window_cat,
                window_id,
                remaining_pct,
                remaining_amount: rem_amt,
                limit_amount: lim_amt,
                is_exhausted,
            });
        }

        if !account_limits.is_empty() {
            accounts.push(AccountData {
                account_id,
                limits: account_limits,
                is_runnable: !has_exhausted_window,
            });
        }
    }

    if accounts.is_empty() {
        return QuotaEvaluation {
            allowed: false,
            provider: Some(provider),
            remaining_pct: None,
            window: None,
            reason: Some("noActiveAccount".to_string()),
            usable_account_id: None,
        };
    }

    // AUT-076 / ACC-14: Protezione contro "account virtuale" cross-expired.
    // Se Account A ha short esaurita e Account B ha weekly esaurita, nessuno dei due
    // account reali e' in grado di completare l'operazione. Deve esistere almeno un
    // account runnable reale.
    let usable_account = accounts.iter().find(|a| a.is_runnable);
    let usable_account_id = usable_account.map(|a| a.account_id.clone());

    if usable_account.is_none() {
        return QuotaEvaluation {
            allowed: false,
            provider: Some(provider),
            remaining_pct: Some(0.0),
            window: None,
            reason: Some("noUsableAccount".to_string()),
            usable_account_id: None,
        };
    }

    // Aggregazione per finestra (short, weekly, other, ed eventuali override specifici)
    let window_categories = ["short", "weekly", "other"];
    let mut min_agg_pct = 100.0;
    let mut breached_window: Option<(&'static str, f64)> = None;

    for cat in window_categories {
        let mut account_pcts: Vec<f64> = Vec::new();
        let mut sum_physical_rem = 0.0;
        let mut sum_physical_lim = 0.0;
        let mut all_have_physical = true;
        let mut count_reporting = 0;

        for acc in &accounts {
            if let Some(lim) = acc.limits.iter().find(|l| l.window_cat == cat) {
                count_reporting += 1;
                account_pcts.push(lim.remaining_pct);
                if let (Some(r), Some(l)) = (lim.remaining_amount, lim.limit_amount) {
                    if l > 0.0 {
                        sum_physical_rem += r;
                        sum_physical_lim += l;
                    } else {
                        all_have_physical = false;
                    }
                } else {
                    all_have_physical = false;
                }
            }
        }

        if count_reporting == 0 {
            continue;
        }

        // Calcolo capacità normalizzata/aggregata:
        // Se capacità fisiche confrontabili sono disponibili per tutti gli account:
        // usa peso fisico (sum(remaining) / sum(limit)) * 100.
        // Altrimenti considera gli account equivalenti dichiarati:
        // media aritmetica delle percentuali (es. 24% e 90% = 57%).
        let agg_pct = if all_have_physical && sum_physical_lim > 0.0 {
            ((sum_physical_rem / sum_physical_lim) * 100.0).clamp(0.0, 100.0).round()
        } else {
            let total: f64 = account_pcts.iter().sum();
            (total / (account_pcts.len() as f64)).clamp(0.0, 100.0).round()
        };

        if agg_pct < min_agg_pct {
            min_agg_pct = agg_pct;
        }

        // Soglia per questa finestra da AutomationQuotaPolicy
        let threshold = if let Some(custom) = policy.windows.get(cat) {
            *custom
        } else {
            match cat {
                "short" => policy.short_pct,
                "weekly" => policy.weekly_pct,
                _ => policy.other_pct,
            }
        };

        if agg_pct < threshold && breached_window.is_none() {
            breached_window = Some((cat, agg_pct));
        }
    }

    if let Some((b_win, b_pct)) = breached_window {
        QuotaEvaluation {
            allowed: false,
            provider: Some(provider),
            remaining_pct: Some(b_pct),
            window: Some(b_win.to_string()),
            reason: Some("quotaFloor".to_string()),
            usable_account_id,
        }
    } else {
        QuotaEvaluation {
            allowed: true,
            provider: Some(provider),
            remaining_pct: Some(min_agg_pct),
            window: None,
            reason: None,
            usable_account_id,
        }
    }
}

/// Valuta il cancello di quota per il modello/ruolo specificato usando la cache interna dei report.
/// Non spawna subprocess aggiuntivi a meno che la cache non sia completamente assente.
pub fn evaluate(model_or_role: &str, policy: &AutomationQuotaPolicy) -> QuotaEvaluation {
    let reports_json = match get_cached_usage() {
        Some(val) => val,
        None => {
            // Tenta lettura veloce da omp usage --json se cache assente
            let omp_binary = crate::omp_ops::get_omp_binary();
            let mut cmd = std::process::Command::new(&omp_binary);
            cmd.args(["usage", "--json"]);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            match cmd.output() {
                Ok(out) if out.status.success() => {
                    if let Ok(parsed) = serde_json::from_slice::<Value>(&out.stdout) {
                        update_cached_usage(parsed.clone());
                        parsed
                    } else {
                        Value::Null
                    }
                }
                _ => Value::Null,
            }
        }
    };

    let reports_array = reports_json
        .get("reports")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    evaluate_with_usage(model_or_role, policy, &reports_array)
}
