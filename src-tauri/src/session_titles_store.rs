//! Modulo di salvataggio titoli sessioni.
//!
//! I titoli delle sessioni sono ora gestiti in modo unificato e persistente
//! dall'indice SQLite `studio-sessions.db` (in `crate::session_index`).
#[allow(unused_imports)]
pub use crate::session_index::session_title_save;
