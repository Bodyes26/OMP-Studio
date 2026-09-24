//! Utilitari di data/ora e generazione identificatori per il Laboratorio.

use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Algoritmo di Howard Hinnant per convertire giorni dall'epoca Unix (1970-01-01) in (anno, mese, giorno).
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1020 + doe / 1461 - doe / 146096) / 365;
    let y = (yoe as i64 + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Restituisce la data e l'ora correnti in formato ISO 8601 UTC (es. `2026-09-24T12:34:56.789Z`).
pub fn now_iso8601() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_secs = duration.as_secs() as i64;
    let millis = duration.subsec_millis();

    let days = total_secs.div_euclid(86400);
    let rem_secs = total_secs.rem_euclid(86400);

    let (year, month, day) = civil_from_days(days);
    let hour = rem_secs / 3600;
    let min = (rem_secs % 3600) / 60;
    let sec = rem_secs % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Restituisce la data odierna UTC in formato `YYYYMMDD`.
pub fn today_yyyymmdd() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_secs = duration.as_secs() as i64;
    let days = total_secs.div_euclid(86400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}{month:02}{day:02}")
}

/// Genera un identificatore prototipo univoco e valido per `rpc::is_valid_prototype_id`.
/// Formato: `p-<YYYYMMDD>-<6 caratteri [a-z0-9]>`.
pub fn generate_prototype_id() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let date_str = today_yyyymmdd();

    loop {
        let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        let mut hasher = Sha256::new();
        hasher.update(now.as_nanos().to_le_bytes());
        hasher.update(counter.to_le_bytes());
        hasher.update(std::process::id().to_le_bytes());

        let s = RandomState::new();
        let mut h = s.build_hasher();
        h.write_u64(counter);
        hasher.update(h.finish().to_le_bytes());

        let digest = hasher.finalize();
        let mut random_suffix = String::with_capacity(6);
        for &byte in digest.iter().take(6) {
            let idx = (byte as usize) % ALPHABET.len();
            random_suffix.push(ALPHABET[idx] as char);
        }

        let id = format!("p-{date_str}-{random_suffix}");
        if crate::rpc::is_valid_prototype_id(&id) {
            return id;
        }
    }
}
