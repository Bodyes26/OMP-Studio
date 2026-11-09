//! Lingua del backend per i testi che arrivano all'utente (errori dei comandi
//! Tauri, notifiche, titoli di finestre native, valori di default scritti su disco).
//!
//! La lingua e' quella dell'interfaccia: il frontend la invia con
//! `desktop_presence_set_locale` all'avvio e a ogni cambio. Prima del primo invio
//! vale l'inglese, che e' la lingua base del progetto.
//!
//! Uso: `tr!("testo italiano", "english text")`, oppure con interpolazione
//! `tr!(format!("Errore: {e}"), format!("Error: {e}"))`. Il ramo non scelto non
//! viene valutato.

use std::sync::atomic::{AtomicBool, Ordering};

static ITALIAN: AtomicBool = AtomicBool::new(false);

/// Vero per qualunque locale che inizia con `it` (case-insensitive).
///
/// Unica definizione della regola: la usano sia `set_locale` sia chi deve
/// scegliere fra due testi senza toccare lo stato globale (menu della tray).
pub fn is_italian(locale: &str) -> bool {
    locale.trim().to_ascii_lowercase().starts_with("it")
}

/// Aggiorna la lingua del backend. Ogni locale che inizia con `it` e' italiano.
pub fn set_locale(locale: &str) {
    ITALIAN.store(is_italian(locale), Ordering::Relaxed);
}

pub fn is_it() -> bool {
    ITALIAN.load(Ordering::Relaxed)
}

/// Codice lingua corrente (`"it"` o `"en"`).
pub fn code() -> &'static str {
    if is_it() {
        "it"
    } else {
        "en"
    }
}

#[macro_export]
macro_rules! tr {
    ($it:expr, $en:expr $(,)?) => {
        if $crate::i18n::is_it() {
            $it
        } else {
            $en
        }
    };
}
