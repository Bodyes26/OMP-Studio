//! Motore calendariale nativo per le automazioni di OMP Studio.
//! Implementa la specifica AUT-009, AUT-020, AUT-037, AUT-038, AUT-039, AUT-040, AUT-085, AUT-104.
//!
//! Fornisce a NativeCore il calcolo deterministico delle prossime occorrenze per:
//! - Trigger una-tantum (`once`) a data/ora specifica;
//! - Trigger giornalieri (`daily`) a un dato orario nel fuso IANA specificato;
//! - Trigger settimanali (`weekly`) nei giorni selezionati a un dato orario nel fuso IANA;
//! - Intervalli fissi ricorrenti (`interval`) ancorati a un istante iniziale (`anchor_ms`);
//! - Intervalli dalla conclusione (`afterFinish`) computati a partire da `last_finished_ms`;
//!
//! Garanzie chiave:
//! - Fusi orari IANA tramite `chrono-tz`;
//! - DST: orari inesistenti (salto in avanti primaverile) saltati senza errori (AUT-038);
//! - DST: orari ripetuti (salto indietro autunnale) eseguiti SOLO alla prima occorrenza (AUT-038);
//! - Risoluzione al minuto (minimo 1 minuto, nessuna frazione di secondo);
//! - Prevenzione duplicati al riavvio di Studio o nello stesso minuto (AUT-039).

use super::model::AutomationTrigger;
use chrono::{DateTime, Datelike, LocalResult, NaiveDate, NaiveTime, TimeZone, Timelike};
use chrono_tz::Tz;

/// Millisecondi in un minuto intero.
const MS_PER_MINUTE: i64 = 60_000;

/// Limite massimo di sicurezza sui giorni futuri da esaminare (10 anni) per evitare loop infiniti.
const MAX_SEARCH_DAYS: i64 = 3652;

/// Parsing e convalida di un identificatore di fuso orario IANA (es. "Europe/Rome", "UTC").
pub fn parse_timezone(timezone: &str) -> Result<Tz, String> {
    let name = timezone.trim();
    if name.is_empty() {
        return Err("Fuso orario IANA non specificato o vuoto".to_string());
    }
    name.parse::<Tz>()
        .map_err(|_| format!("Fuso orario IANA '{}' sconosciuto o non supportato", name))
}

/// Parsea una stringa oraria nel formato "HH:MM".
/// Rispetta AUT-039: precisione rigorosamente al minuto, secondi diversi da zero rifiutati con errore.
pub fn parse_time_str(time_str: &str) -> Result<(u32, u32, u32), String> {
    let trimmed = time_str.trim();
    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err(format!(
            "Formato orario non valido '{}': atteso 'HH:MM'",
            time_str
        ));
    }

    let h: u32 = parts[0]
        .parse()
        .map_err(|_| format!("Ora non valida '{}' in '{}'", parts[0], time_str))?;
    let m: u32 = parts[1]
        .parse()
        .map_err(|_| format!("Minuto non valido '{}' in '{}'", parts[1], time_str))?;

    if h > 23 {
        return Err(format!("Ora fuori intervallo (0-23): {} in '{}'", h, time_str));
    }
    if m > 59 {
        return Err(format!("Minuto fuori intervallo (0-59): {} in '{}'", m, time_str));
    }

    if parts.len() == 3 {
        let s: u32 = parts[2]
            .parse()
            .map_err(|_| format!("Secondo non valido '{}' in '{}'", parts[2], time_str))?;
        if s != 0 {
            return Err(format!(
                "Precisione secondi non ammessa (trovati {}s in '{}'): la pianificazione calendariale (AUT-039) è rigorosamente al minuto (HH:MM)",
                s, time_str
            ));
        }
    }

    Ok((h, m, 0))
}

/// Verifica se il giorno della settimana soddisfa l'elenco configurato.
/// Supporta sia la convenzione JavaScript (0 = Domenica, 1 = Lunedì, ..., 6 = Sabato)
/// sia la convenzione ISO (1 = Lunedì, ..., 7 = Domenica).
fn matches_weekday(weekday: chrono::Weekday, allowed: &[u32]) -> bool {
    let sun0 = weekday.num_days_from_sunday(); // Sun=0, Mon=1, ..., Sat=6
    let iso1 = weekday.number_from_monday(); // Mon=1, ..., Sun=7
    allowed.iter().any(|&w| w == sun0 || w == iso1)
}

/// Valida la configurazione di un trigger calendariale o a eventi rispetto al fuso specificato.
pub fn validate_trigger(
    trigger: &super::model::AutomationTrigger,
    timezone: &str,
) -> Result<(), String> {
    if trigger.id.trim().is_empty() {
        return Err("Identificatore trigger vuoto".to_string());
    }

    let is_calendar = matches!(
        trigger.kind.as_str(),
        "once" | "daily" | "weekly" | "interval" | "afterFinish"
    );

    if is_calendar || !timezone.trim().is_empty() {
        parse_timezone(timezone)?;
    }

    match trigger.kind.as_str() {
        "once" => {
            let at = trigger
                .at
                .ok_or_else(|| "Trigger 'once' richiede il timestamp 'at'".to_string())?;
            if at <= 0 {
                return Err(format!("Timestamp 'at' non valido per trigger 'once': {}", at));
            }
        }
        "daily" => {
            let time_str = trigger
                .time
                .as_ref()
                .ok_or_else(|| "Trigger 'daily' richiede il campo 'time' (HH:MM)".to_string())?;
            parse_time_str(time_str)?;
        }
        "weekly" => {
            let time_str = trigger
                .time
                .as_ref()
                .ok_or_else(|| "Trigger 'weekly' richiede il campo 'time' (HH:MM)".to_string())?;
            parse_time_str(time_str)?;
            if trigger.weekdays.is_empty() {
                return Err(
                    "Trigger 'weekly' richiede almeno un giorno della settimana selezionato"
                        .to_string(),
                );
            }
            for &day in &trigger.weekdays {
                if day > 7 {
                    return Err(format!(
                        "Giorno della settimana non valido: {} (ammessi 0-6 per Dom-Sab o 1-7 per Lun-Dom)",
                        day
                    ));
                }
            }
        }
        "interval" => {
            let interval = trigger
                .interval_minutes
                .ok_or_else(|| "Trigger 'interval' richiede 'intervalMinutes'".to_string())?;
            if interval < 1 {
                return Err("L'intervallo minimo per trigger 'interval' è di 1 minuto (valore 0 non consentito)".to_string());
            }
        }
        "afterFinish" => {
            let interval = trigger
                .interval_minutes
                .ok_or_else(|| "Trigger 'afterFinish' richiede 'intervalMinutes'".to_string())?;
            if interval < 1 {
                return Err("L'intervallo minimo per trigger 'afterFinish' è di 1 minuto (valore 0 non consentito)".to_string());
            }
        }
        "manual"
        | "gitCommit"
        | "gitBranch"
        | "gitDirty"
        | "gitClean"
        | "file"
        | "agentFinished"
        | "agentQuota"
        | "agentError"
        | "studioStarted"
        | "projectOpened" => {
            // Trigger a eventi o manuali validi
        }
        other => {
            return Err(format!("Kind di trigger sconosciuto: '{}'", other));
        }
    }

    Ok(())
}

/// Calcola le prossime `count` occorrenze temporali (in millisecondi epoca) strettamente successive ad `after_ms`.
///
/// Parametri:
/// - `trigger`: definizione del trigger (once, daily, weekly, interval, afterFinish o evento)
/// - `timezone`: nome del fuso IANA (es. "Europe/Rome", "UTC")
/// - `after_ms`: istante temporale di riferimento; le occorrenze restituite sono strettamente > after_ms
/// - `count`: numero massimo di occorrenze desiderate
/// - `anchor_ms`: istante di ancoraggio per intervalli fissi o prima esecuzione (se <= 0 usa after_ms)
/// - `last_finished_ms`: istante di completamento dell'ultima esecuzione (per `afterFinish`)
pub fn next_occurrences(
    trigger: &super::model::AutomationTrigger,
    timezone: &str,
    after_ms: i64,
    count: usize,
    anchor_ms: i64,
    last_finished_ms: Option<i64>,
) -> Result<Vec<i64>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }

    match trigger.kind.as_str() {
        "once" => compute_once_occurrences(trigger, after_ms),
        "daily" => compute_daily_occurrences(trigger, timezone, after_ms, count),
        "weekly" => compute_weekly_occurrences(trigger, timezone, after_ms, count),
        "interval" => compute_interval_occurrences(trigger, after_ms, count, anchor_ms),
        "afterFinish" => {
            compute_after_finish_occurrences(trigger, after_ms, count, anchor_ms, last_finished_ms)
        }
        // I trigger reattivi a eventi o manuali non generano scadenze calendariali
        _ => Ok(Vec::new()),
    }
}

/// Comodità per ottenere la singola prossima occorrenza.
pub fn next_occurrence(
    trigger: &super::model::AutomationTrigger,
    timezone: &str,
    after_ms: i64,
    anchor_ms: i64,
    last_finished_ms: Option<i64>,
) -> Result<Option<i64>, String> {
    let occs = next_occurrences(trigger, timezone, after_ms, 1, anchor_ms, last_finished_ms)?;
    Ok(occs.into_iter().next())
}

/// Calcolo occorrenze per trigger una-tantum (`once`).
fn compute_once_occurrences(
    trigger: &super::model::AutomationTrigger,
    after_ms: i64,
) -> Result<Vec<i64>, String> {
    let at = trigger
        .at
        .ok_or_else(|| "Trigger 'once' privo del campo 'at'".to_string())?;

    if at <= 0 {
        return Err(format!("Timestamp 'at' non valido per trigger 'once': {}", at));
    }

    if at > after_ms {
        Ok(vec![at])
    } else {
        Ok(Vec::new())
    }
}

/// Calcolo occorrenze per trigger giornaliero (`daily`).
/// Rispetta pienamente AUT-038 (DST: orari inesistenti saltati, ripetuti solo prima occorrenza).
fn compute_daily_occurrences(
    trigger: &super::model::AutomationTrigger,
    timezone: &str,
    after_ms: i64,
    count: usize,
) -> Result<Vec<i64>, String> {
    let time_str = trigger
        .time
        .as_ref()
        .ok_or_else(|| "Trigger 'daily' privo del campo 'time'".to_string())?;
    let (hour, minute, second) = parse_time_str(time_str)?;
    let tz = parse_timezone(timezone)?;

    let utc_dt = DateTime::from_timestamp_millis(after_ms)
        .ok_or_else(|| format!("Timestamp after_ms non valido: {}", after_ms))?;
    let local_dt = utc_dt.with_timezone(&tz);
    let mut current_date = local_dt.date_naive();

    let mut occurrences = Vec::with_capacity(count);
    let mut days_checked = 0;

    while occurrences.len() < count && days_checked < MAX_SEARCH_DAYS {
        days_checked += 1;

        if let Some(naive_time) = NaiveTime::from_hms_opt(hour, minute, second) {
            let naive_dt = current_date.and_time(naive_time);

            match tz.from_local_datetime(&naive_dt) {
                LocalResult::Single(dt) => {
                    let ts = dt.timestamp_millis();
                    if ts > after_ms {
                        occurrences.push(ts);
                    }
                }
                LocalResult::Ambiguous(earliest, _latest) => {
                    // AUT-038: DST autunnale (orario ripetuto): si esegue SOLO la prima occorrenza.
                    // Nessuna doppia pubblicazione nel cambio d'ora.
                    let ts = earliest.timestamp_millis();
                    if ts > after_ms {
                        occurrences.push(ts);
                    }
                }
                LocalResult::None => {
                    // AUT-038: DST primaverile (orario inesistente saltato nel cambio d'ora locale).
                    // Si salta il giorno e si procede al successivo.
                }
            }
        }

        current_date = match current_date.succ_opt() {
            Some(d) => d,
            None => break,
        };
    }

    Ok(occurrences)
}

/// Calcolo occorrenze per trigger settimanale (`weekly`).
/// Rispetta AUT-038 (DST) e filtra rigorosamente per i giorni specificati in `weekdays`.
fn compute_weekly_occurrences(
    trigger: &super::model::AutomationTrigger,
    timezone: &str,
    after_ms: i64,
    count: usize,
) -> Result<Vec<i64>, String> {
    let time_str = trigger
        .time
        .as_ref()
        .ok_or_else(|| "Trigger 'weekly' privo del campo 'time'".to_string())?;
    let (hour, minute, second) = parse_time_str(time_str)?;

    if trigger.weekdays.is_empty() {
        return Err("Trigger 'weekly' privo di giorni della settimana selezionati".to_string());
    }

    let tz = parse_timezone(timezone)?;

    let utc_dt = DateTime::from_timestamp_millis(after_ms)
        .ok_or_else(|| format!("Timestamp after_ms non valido: {}", after_ms))?;
    let local_dt = utc_dt.with_timezone(&tz);
    let mut current_date = local_dt.date_naive();

    let mut occurrences = Vec::with_capacity(count);
    let mut days_checked = 0;

    while occurrences.len() < count && days_checked < MAX_SEARCH_DAYS {
        days_checked += 1;

        if matches_weekday(current_date.weekday(), &trigger.weekdays) {
            if let Some(naive_time) = NaiveTime::from_hms_opt(hour, minute, second) {
                let naive_dt = current_date.and_time(naive_time);

                match tz.from_local_datetime(&naive_dt) {
                    LocalResult::Single(dt) => {
                        let ts = dt.timestamp_millis();
                        if ts > after_ms {
                            occurrences.push(ts);
                        }
                    }
                    LocalResult::Ambiguous(earliest, _latest) => {
                        // AUT-038: Prima occorrenza univoca nel cambio d'ora autunnale
                        let ts = earliest.timestamp_millis();
                        if ts > after_ms {
                            occurrences.push(ts);
                        }
                    }
                    LocalResult::None => {
                        // AUT-038: Salto orario inesistente
                    }
                }
            }
        }

        current_date = match current_date.succ_opt() {
            Some(d) => d,
            None => break,
        };
    }

    Ok(occurrences)
}

/// Calcolo occorrenze a intervallo fisso (`interval`).
/// Ancorato a `anchor_ms`, con passo minimo di 1 minuto, allineato alle unità di minuto.
/// Previene esecuzioni duplicate nello stesso minuto o in caso di riavvio (AUT-039).
fn compute_interval_occurrences(
    trigger: &super::model::AutomationTrigger,
    after_ms: i64,
    count: usize,
    anchor_ms: i64,
) -> Result<Vec<i64>, String> {
    let interval_minutes = trigger
        .interval_minutes
        .ok_or_else(|| "Trigger 'interval' privo del campo 'intervalMinutes'".to_string())?;
    if interval_minutes < 1 {
        return Err("L'intervallo minimo per trigger 'interval' è di 1 minuto (valore 0 non consentito)".to_string());
    }
    let interval_ms = (interval_minutes as i64) * MS_PER_MINUTE;

    // Se l'ancora non e' specificata o non valida, usiamo after_ms come punto zero
    let raw_anchor = if anchor_ms > 0 { anchor_ms } else { after_ms };
    // Allineamento al minuto
    let anchor_minute = (raw_anchor / MS_PER_MINUTE) * MS_PER_MINUTE;

    let mut occurrences = Vec::with_capacity(count);

    let first_slot = if anchor_minute > after_ms {
        anchor_minute
    } else {
        // Calcola il passo k >= 1 tale che anchor_minute + k * interval_ms > after_ms
        let diff = after_ms - anchor_minute;
        let k = (diff / interval_ms) + 1;
        anchor_minute + k * interval_ms
    };

    let mut current = first_slot;
    while occurrences.len() < count {
        occurrences.push(current);
        current += interval_ms;
    }

    Ok(occurrences)
}

/// Calcolo occorrenze per intervallo dopo la fine (`afterFinish`).
/// Basato su `last_finished_ms` (se presente) o su `anchor_ms` per la prima esecuzione (AUT-037).
/// Garantisce almeno `interval_minutes` di quiete dopo la fine e allineamento al minuto.
fn compute_after_finish_occurrences(
    trigger: &super::model::AutomationTrigger,
    after_ms: i64,
    count: usize,
    anchor_ms: i64,
    last_finished_ms: Option<i64>,
) -> Result<Vec<i64>, String> {
    let interval_minutes = trigger
        .interval_minutes
        .ok_or_else(|| "Trigger 'afterFinish' privo del campo 'intervalMinutes'".to_string())?;
    if interval_minutes < 1 {
        return Err("L'intervallo minimo per trigger 'afterFinish' è di 1 minuto (valore 0 non consentito)".to_string());
    }
    let interval_ms = (interval_minutes as i64) * MS_PER_MINUTE;

    let base_time = match last_finished_ms {
        Some(lf) if lf > 0 => {
            // Arrotonda per eccesso al minuto per assicurare che siano trascorsi almeno interval_minutes
            let raw_target = lf + interval_ms;
            ((raw_target + MS_PER_MINUTE - 1) / MS_PER_MINUTE) * MS_PER_MINUTE
        }
        _ => {
            // Prima esecuzione mai completata: ancorata a anchor_ms
            let raw_anchor = if anchor_ms > 0 { anchor_ms } else { after_ms };
            (raw_anchor / MS_PER_MINUTE) * MS_PER_MINUTE
        }
    };

    let first_slot = if base_time > after_ms {
        base_time
    } else {
        // Se la scadenza calcolata e' nel passato (es. Studio riaperto dopo ore di chiusura),
        // avanziamo a passi interi fino al primo minuto utile strettamente futuro rispetto ad after_ms
        let diff = after_ms - base_time;
        let k = (diff / interval_ms) + 1;
        base_time + k * interval_ms
    };

    let mut occurrences = Vec::with_capacity(count);
    let mut current = first_slot;
    while occurrences.len() < count {
        occurrences.push(current);
        current += interval_ms;
    }

    Ok(occurrences)
}
