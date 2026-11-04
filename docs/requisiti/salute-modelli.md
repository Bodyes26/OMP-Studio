# Salute dei modelli e autenticazione provider

## Fonte e approvazione

2026-11-04: segnalazioni utente «studio mi perde i modelli di tavily [...] 28 modelli da assegnare» e «nei provider mi fa vedere commandcode ma in realtà mi ha buttato fuori dovrei rifare il login». Proposta della sessione corrente approvata con «ok applica le correzioni, non perdere tempo con mille test basta il test alla pubblicazione nightly».

## Registro

| ID | Stato | Requisito e scenario |
| --- | --- | --- |
| SAL-001 | Approvato; implementato; verificato su dati locali | Conservare le assegnazioni e le credenziali. Tavily configurato come `web/tavily` resta assegnato e non genera falsi allarmi per l'assenza di un account `web`. |
| SAL-002 | Approvato; implementato; verificato nel percorso nativo e nelle regressioni | Leggere i cataloghi completi di omp preservando `kind`; le scelte chat restano chat, i motori search non sono giudicati assenti sulla base della cache chat. Motori senza chiave non richiedono credenziali inventate. |
| SAL-003 | Approvato; implementato; verificato nel percorso nativo e nella resa visiva isolata | Distinguere configurazione salvata, accesso verificato, accesso da rinnovare e verifica non disponibile. Un elenco modelli non prova il login; un errore auth esplicito di Command Code deve raggiungere Provider e avvisi. |
| SAL-004 | Approvato; implementato; regressioni isolate superate; rinnovo login reale non eseguito | Rete, timeout e quota esaurita non provocano falsi logout. Un account non valido non invalida un altro account funzionante dello stesso provider. Il login ripristinato aggiorna lo stato. |
| SAL-005 | Approvato; implementato; verificato nelle regressioni | Distinguere numero di modelli da numero di assegnazioni interessate; mantenere visibili gli errori reali senza cancellare automaticamente ruoli o riserve. |
| SAL-006 | Approvato; implementato; verificato nel percorso nativo | Nessuna richiesta AI a pagamento per verificare il login e nessuna gestione OAuth duplicata: utilizzare risultati e percorsi di omp, senza trasmettere token al frontend. |

## Verifiche

- 2026-11-04, diagnosi precedente alla correzione: con CLI reale Tavily assente in `omp models --json` e presente in `omp models --kind all --json`; rigiocando le regole correnti sui metadati locali risultano 28 segnalazioni, 20 su assegnazioni web. Configurazione e credenziali invariate. Fonte: sessione corrente. Questa prova non certifica la correzione.
- 2026-11-04, gate finale frontend: `npm run check` con 0 errori e 6 avvisi in file non modificati; `npm test` con 1387 superati, 1 saltato e 0 falliti; `npm run check:commands` allineato a omp 18.16.0. Fonte: sessione corrente, output del gate frontend.
- 2026-11-04, gate finale backend: `cargo check` riuscito; `cargo test` con 409 superati, 3 ignorati, 0 falliti. Fonte: sessione corrente, output del gate backend.
- 2026-11-04, smoke del comando nativo reale `check_model_health` con CLI e dati locali: Tavily presente come `kind=search`, nessun finding Tavily, stato Command Code `reauth_required`, `config.yml` identico byte per byte prima e dopo. Scenario eseguito dal solo binario test Rust, senza avviare una seconda istanza di Studio; helper temporaneo rimosso dopo la prova. Fonte: sessione corrente, `smoke_live_check_model_health`, output gate backend.
- 2026-11-04, resa visiva del componente Provider reale in Chromium, bridge e store di fixture isolati: Command Code mostra «Accesso da rinnovare» e «Accedi di nuovo», Tavily «Accesso non verificato»; nessuna falsa etichetta «Connesso» e nessun overflow orizzontale. Screenshot nella sessione corrente. La prova visiva non certifica il bridge desktop o il rinnovo login reale. Harness rimosso dopo la prova; rinnovo dell'account reale non eseguito per non intervenire sull'account dell'utente. Firma credenziali ed esiti multi-account coperti da regressioni isolate.
- 2026-11-04, Nightly `1.9.1-nightly.1793803047176` pubblicata dal commit `201a040032f042bb94ef67fb157639a99996520f`: verificati via API GitHub della release ID `394517444` installer Windows x64 e `nightly.json`, con commit e SHA-256 coincidenti. Stabile `1.9.0` invariata e changelog in Unreleased; build macOS/Linux avviata dal workflow `41851318847`, ancora in corso alla verifica Windows. Fonte: sessione corrente, https://github.com/Bodyes26/OMP-Studio/releases/tag/nightly.
