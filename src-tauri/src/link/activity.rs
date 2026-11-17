//! Cosa sta facendo una sessione aperta da un'altra macchina, visto dalla
//! macchina che possiede il progetto (R-MI-18).
//!
//! Perche' serve: la finestra del proprietario ricava lo stato della corsia da
//! `sessionRegistry`, cioè dalle sessioni aperte *da lei*. La sessione che
//! arriva dal collegamento vive nel backend, quindi quella finestra la ignorava
//! e mostrava il progetto fermo mentre l'agente lavorava. Il rischio non è
//! solo l'etichetta: la coda automatica vede la Principale libera e avvia un
//! secondo lavoro sopra il primo.
//!
//! Perche' qui e non nel frontend: i frame passano già da `Outbox::deliver`,
//! quindi riconoscere l'inizio e la fine di un turno costa un confronto di
//! prefisso per frame. Ricostruire il transcript in locale per saperne lo
//! stato sarebbe un secondo riduttore da tenere allineato, e iscriversi al
//! processo con una sessione locale rischierebbe di avviarne uno nuovo quando
//! l'altro è già finito.
//!
//! Si pubblica solo un riepilogo: progetto, corsia, se sta lavorando e se c'è
//! almeno un turno aperto. Nient'altro esce dal backend.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;

/// Una corsia occupata da una sessione remota.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaneActivity {
    pub project_id: String,
    pub lane_id: String,
    /// Un run è vivo: fra `agent_start` e la sua fine.
    pub working: bool,
}

/// Riepilogo letto dalla finestra proprietaria.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkActivitySnapshot {
    pub revision: u64,
    pub lanes: Vec<LaneActivity>,
}

#[derive(Default)]
struct Entry {
    /// Quante superfici remote stanno guardando la sessione: due macchine
    /// possono seguire la stessa corsia, e la corsia resta occupata finché
    /// almeno una c'è.
    views: u32,
    working: bool,
    /// Il processo è finito (`studio_exit`): la voce si toglie.
    ended: bool,
}

#[derive(Default)]
pub(crate) struct Activity {
    /// Chiave: `projectId\0laneId`. Ordine di inserimento stabile per la
    /// pubblicazione, così un aggiornamento non cambia l'ordine nella UI.
    lanes: Mutex<HashMap<String, Entry>>,
    /// Cresce a ogni cambiamento: il frontend scarta i riepiloghi vecchi
    /// arrivati in ritardo, come fa con le generazioni di sessione.
    revision: AtomicU64,
}

impl Activity {
    pub(crate) fn revision(&self) -> u64 {
        self.revision.load(Ordering::SeqCst)
    }

    /// Riepilogo corrente, in ordine stabile di chiave.
    pub(crate) fn snapshot(&self) -> Vec<LaneActivity> {
        let lanes = self.lanes.lock();
        let mut out: Vec<LaneActivity> = lanes
            .iter()
            .filter(|(_, entry)| !entry.ended)
            .map(|(key, entry)| {
                let (project_id, lane_id) = split(key);
                LaneActivity {
                    project_id: project_id.to_owned(),
                    lane_id: lane_id.to_owned(),
                    working: entry.working,
                }
            })
            .collect();
        out.sort_by(|a, b| (a.project_id.as_str(), a.lane_id.as_str()).cmp(&(b.project_id.as_str(), b.lane_id.as_str())));
        out
    }

    /// Una superficie remota ha aperto (o ripreso) una sessione.
    pub(crate) fn attach(&self, project: &str, lane: &str) -> bool {
        let key = key(project, lane);
        let mut lanes = self.lanes.lock();
        let entry = lanes.entry(key).or_default();
        entry.views = entry.views.saturating_add(1);
        entry.ended = false;
        self.revision.fetch_add(1, Ordering::SeqCst);
        true
    }

    /// La superficie si è staccata. Quando l'ultima se ne va, la voce sparisce:
    /// nessuno sta più lavorando su quella corsia da fuori.
    pub(crate) fn detach(&self, project: &str, lane: &str) {
        let key = key(project, lane);
        let mut lanes = self.lanes.lock();
        let Some(entry) = lanes.get_mut(&key) else { return };
        entry.views = entry.views.saturating_sub(1);
        let gone = entry.views == 0 || entry.ended;
        if gone {
            lanes.remove(&key);
        }
        self.revision.fetch_add(1, Ordering::SeqCst);
    }

    /// Osserva un frame della sessione. Riconosce solo i confini del run: il
    /// resto (delta compresi) torna indietro con un confronto di prefisso e
    /// nessuna allocazione. Restituisce `true` quando il riepilogo è cambiato.
    pub(crate) fn observe(&self, project: &str, lane: &str, frame: &str) -> FrameEffect {
        // I delta sono la grande maggioranza dei frame: il primo carattere
        // diverso da `{"type":"agent_`/`{"type":"turn_`/`{"type":"session_`
        // li scarta senza toccare il JSON.
        let effect = if frame.starts_with("{\"type\":\"agent_start\"") {
            FrameEffect::Working
        } else if frame.starts_with("{\"type\":\"agent_end\"") {
            if is_terminal_end(frame) { FrameEffect::Idle } else { FrameEffect::Unchanged }
        } else if frame.starts_with("{\"type\":\"session_settled\"") {
            FrameEffect::Idle
        } else if frame.starts_with("{\"type\":\"studio_exit\"") {
            FrameEffect::Ended
        } else {
            FrameEffect::Unchanged
        };
        let key = key(project, lane);
        let mut lanes = self.lanes.lock();
        let Some(entry) = lanes.get_mut(&key) else { return FrameEffect::Unchanged };
        match effect {
            FrameEffect::Working => {
                if entry.working { return FrameEffect::Unchanged; }
                entry.working = true;
            }
            FrameEffect::Idle => {
                if !entry.working { return FrameEffect::Unchanged; }
                entry.working = false;
            }
            FrameEffect::Ended => {
                entry.ended = true;
                entry.working = false;
            }
            FrameEffect::Unchanged => return FrameEffect::Unchanged,
        }
        drop(lanes);
        self.revision.fetch_add(1, Ordering::SeqCst);
        effect
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FrameEffect {
    Unchanged,
    Working,
    Idle,
    Ended,
}

/// `agent_end` è terminale quando lo dice (`isTerminal`) o quando non porta
/// l'indicazione della pausa: uno yield con lavoro in background non chiude il
/// run, e senza questo una corsia con un subagente asincrono sembrerebbe ferma.
fn is_terminal_end(frame: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(frame) else { return true };
    value.get("isTerminal").and_then(Value::as_bool).unwrap_or(true)
}

fn key(project: &str, lane: &str) -> String {
    // `\0` non può comparire in un id di progetto o di corsia.
    format!("{project}\0{lane}")
}

fn split(key: &str) -> (&str, &str) {
    key.split_once('\0').unwrap_or((key, "main"))
}

pub(crate) type SharedActivity = Arc<Activity>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_corsia_resta_occupata_finche_una_superficie_la_guarda() {
        let activity = Activity::default();
        activity.attach("p", "main");
        activity.attach("p", "main");
        assert_eq!(activity.snapshot(), vec![LaneActivity { project_id: "p".into(), lane_id: "main".into(), working: false }]);
        activity.detach("p", "main");
        assert_eq!(activity.snapshot().len(), 1, "la seconda superficie tiene viva la corsia");
        activity.detach("p", "main");
        assert!(activity.snapshot().is_empty());
    }

    #[test]
    fn il_run_si_apre_su_agent_start_e_si_chiude_solo_col_terminale() {
        let activity = Activity::default();
        activity.attach("p", "main");
        assert_eq!(activity.observe("p", "main", r#"{"type":"agent_start"}"#), FrameEffect::Working);
        assert!(activity.snapshot()[0].working);
        assert_eq!(
            activity.observe("p", "main", r#"{"type":"agent_end","isTerminal":false}"#),
            FrameEffect::Unchanged,
            "uno yield con lavoro in background non chiude il run"
        );
        assert!(activity.snapshot()[0].working);
        assert_eq!(activity.observe("p", "main", r#"{"type":"agent_end","isTerminal":true}"#), FrameEffect::Idle);
        assert!(!activity.snapshot()[0].working);
    }

    #[test]
    fn session_settled_e_uno_yield_senza_indicazione_chiudono_il_run() {
        let activity = Activity::default();
        activity.attach("p", "main");
        activity.observe("p", "main", r#"{"type":"agent_start"}"#);
        assert_eq!(activity.observe("p", "main", r#"{"type":"session_settled"}"#), FrameEffect::Idle);

        activity.observe("p", "main", r#"{"type":"agent_start"}"#);
        assert_eq!(activity.observe("p", "main", r#"{"type":"agent_end"}"#), FrameEffect::Idle);
    }

    #[test]
    fn i_delta_e_i_frame_ignoti_non_cambiano_nulla() {
        let activity = Activity::default();
        activity.attach("p", "main");
        for frame in [
            r#"{"type":"studio_delta","kind":"text","contentIndex":0,"delta":"x"}"#,
            r#"{"type":"message_update"}"#,
            "non json",
        ] {
            assert_eq!(activity.observe("p", "main", frame), FrameEffect::Unchanged);
        }
        assert!(!activity.snapshot()[0].working);
    }

    #[test]
    fn un_processo_uscito_libera_subito_la_corsia() {
        let activity = Activity::default();
        activity.attach("p", "main");
        activity.observe("p", "main", r#"{"type":"agent_start"}"#);
        assert_eq!(activity.observe("p", "main", r#"{"type":"studio_exit","code":0}"#), FrameEffect::Ended);
        assert!(activity.snapshot().is_empty(), "una voce terminata non resta appesa");
    }

    #[test]
    fn una_corsia_remota_non_confonde_le_altre() {
        let activity = Activity::default();
        activity.attach("p", "main");
        activity.attach("p", "wt-1");
        activity.observe("p", "wt-1", r#"{"type":"agent_start"}"#);
        let lanes = activity.snapshot();
        assert_eq!(lanes.len(), 2);
        assert!(!lanes[0].working, "la Principale non lavora");
        assert!(lanes[1].working, "la corsia wt-1 sì");
    }
}
