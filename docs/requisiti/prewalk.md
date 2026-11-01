# Prewalk — registro dei requisiti

## Stato del documento

Requisiti approvati il 2026-11-01 e implementati lo stesso giorno contro omp 18.14.2, che da 18.14.0 porta le impostazioni `prewalk.into` e `prewalk.from` e il comando `/prewalk [into] | restart [from] [into] | off`. Verifiche: vedi la tabella in fondo; la prova sull'app desktop resta all'utente (AGENTS.md vieta di avviare una seconda istanza).

Supera la decisione del 2026-10-06 «Prewalk: overlay per sessione, destinazione solo `@smol`, nessun riavvio» (DECISIONS.md) soltanto per la destinazione: overlay per sessione, armo a caldo e conferma via notice restano.

## Fonte

Utente, 2026-11-01: «sistemiamo prewalk con la nuova aggiunta, magari possiamo mostrare una piccola card di configurazione quando si manda il comando o si attiva col pulsante dal composer per mostrare se è attivo o no e verso quale modello andrà configurabile. Togli il doppio avviso che ora mi mostra sia il toast pill sia in chat l'info [prewalk].»

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| PRW-001 | attivo | La destinazione del prewalk è configurabile: un ruolo (`@smol`, `@task`, …) o un modello preciso, non più solo `@smol`. | Con `@task` scelto, al primo edit dopo la lista todo la chat passa al modello del ruolo task. |
| PRW-002 | attivo | Una scheda sopra il composer mostra se il prewalk è spento, armato (verso quale modello) o già passato (a quale modello). | Dopo l'armo la scheda dice «Attivo: passa a provider/modello al primo edit». |
| PRW-003 | attivo | La scheda si apre dal pulsante prewalk della riga di stato e da `/prewalk` nella chat. Il pulsante, da spento, arma e apre la scheda, come `/prewalk` senza argomenti in omp. | Clic sul pulsante spento: prewalk armato e scheda visibile con la destinazione. |
| PRW-004 | attivo | Dalla scheda si cambia destinazione e ripartenza di «Ripeti»; la scelta si salva in `config.yml` (`prewalk.into`/`prewalk.from`) e, se il prewalk è armato, lo riarma verso la nuova destinazione. | Cambio da `@smol` a `@task` con prewalk armato: la scheda passa a «Attivo: passa a» il modello di task. Una nuova chat parte con `@task`. |
| PRW-005 | attivo | `/prewalk <destinazione>` e `/prewalk restart [from] [into]` valgono solo per la chat corrente; `/prewalk off` disarma. Argomenti in eccesso: messaggio d'uso, nessuna azione. | `/prewalk openai/gpt-x` arma verso quel modello senza cambiare il predefinito. |
| PRW-006 | attivo | Armo e disarmo non compaiono più nel transcript: lo stato lo mostrano pulsante e scheda. Gli errori del prewalk vanno nella scheda se aperta, altrimenti nell'etichetta sopra il composer, mai in entrambi. Il passaggio effettivo («switched to …») resta nel transcript, perché segna il punto della conversazione in cui il modello cambia. | `/prewalk`: nessun avviso info `[prewalk]` in chat e nessuna pillola duplicata. |

## Verifiche

| Data | Requisiti | Scenario | Esito | Prova |
|---|---|---|---|---|
| 2026-11-01 | PRW-005 | Grammatica di `/prewalk` (apertura, destinazione, restart con 0–2 argomenti, off, eccessi) e ripiego sui predefiniti di omp | superata | `test/prewalk.test.ts`, `npm test` |
| 2026-11-01 | PRW-001, PRW-004 | Overlay di sessione con `prewalk.into`/`prewalk.from` nello stesso file di `enabled`, valori `@ruolo` quotati in YAML, chiavi rimosse se vuote | superata | `overlay_gui_prewalk_porta_destinazione_e_ripartenza_della_sessione` in `src-tauri/src/rpc/mod.rs`, `cargo test` |
| — | PRW-002, PRW-003, PRW-004, PRW-006 | Percorso reale nell'app: pulsante, `/prewalk`, cambio destinazione da armato, assenza del doppio avviso | da verificare dall'utente nell'app | — |
