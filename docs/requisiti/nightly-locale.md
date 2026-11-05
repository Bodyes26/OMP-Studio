# Nightly locale — registro dei requisiti

## Ambito e fonti

Obiettivo: ridurre il tempo dalla modifica alla disponibilita dell'installer Nightly locale Windows, comprese le verifiche che precedono `npm run nightly`. Non ottimizzare le build cloud degli altri OS, non modificare Sophos e non ridurre implicitamente la copertura.

Fonti utente, 2026-11-05, sessione corrente:
- **F1:** «la build nightly a fare tutti i test che fa ci mette veramente una vita»; «preparare degli script standard che eseguono un po' di test in parallelo per accelerare».
- **F2:** «cargo test ci metta sempre una vita e mezza, anche su questa macchina»; «mi interessa quella locale che sia veloce».
- **F3:** «nella build l'unica cosa che deve interessare del diario e che la funzione "Diario" funzioni correttamente, non quello che c'e specifico di questo diario».
- **F4:** «queste ottimizzazioni consigliate mi piacciono»; «invece di chiamare 10 volte git per dieci cose diverse si invoca una sola volta».
- **F5:** «ok prepara un plan completo per tutte le ottimizzazioni».
- **F6:** «ok procedi pure»: approvata l'esecuzione del piano NL0…NL8, senza autorizzare commit, push o pubblicazione.

F4 approva la direzione; F5 richiede il piano; F6 ne approva l'esecuzione. L'approvazione non prova implementazione o verifica e non autorizza a pubblicare.

## Requisiti attivi

| ID | Fonte | Stato | Requisito | Scenario concreto |
|---|---|---|---|---|
| NLC-001 | F1, F2, F5 | attivo; obiettivo approvato | Misurare il flusso locale completo, distinguendo preparazione, controlli frontend, compilazione test Rust, esecuzione test Rust, build frontend, build Rust, packaging e upload. | Un rilascio lento indica fase, durata ed esito; la somma sequenziale non viene confusa con il tempo totale di fasi sovrapposte. |
| NLC-002 | F1, F4, F5 | attivo; direzione approvata | Un preflight locale standard orchestra i controlli e impedisce ripetizioni equivalenti sullo stesso stato; i comandi individuali restano utilizzabili. | L'agente non deve ricostruire a mano check, test, comandi e controlli nativi prima di ogni Nightly. |
| NLC-003 | F3 | attivo; approvato | I test della funzione Diario usano esclusivamente progetti, sessioni e archivi di prova isolati; il diario reale non e un input di accettazione della build. | Lo scenario sources passa con sessioni sintetiche di due progetti, filtra quelle estranee e non apre gli archivi personali dell'utente. |
| NLC-004 | F4 | attivo; direzione approvata | Ridurre i processi Git delle fixture: accorpare letture equivalenti, configurare senza un processo per chiave e condividere solo basi immutabili di prova. | Due test partono da copie indipendenti dello stesso seed; modificare una copia non modifica l'altra; diminuiscono i processi di preparazione. |
| NLC-005 | F1, F2, F4 | attivo; direzione approvata | Parallelismo limitato e misurato, rispettando file generati, singleton e lock Cargo. | Le traduzioni sono preparate una volta; i test JS isolati per processo e il ramo Rust non corrompono risorse condivise; nessun comando Cargo contende la stessa target directory con un altro comando Cargo. |
| NLC-006 | F4, F5; proposta tecnica derivata | attivo; progettato, non implementato | Riutilizzare esiti Rust riusciti solo quando tutti gli input rilevanti sono identici e la prova e completa; input sconosciuti o prova invalida obbligano al controllo completo. | Una modifica solo frontend puo riusare la verifica nativa; cambiare build.rs, dipendenza, test incluso, toolchain o configurazione la invalida. |
| NLC-007 | F2, F4; vincolo di correttezza | attivo; progettato, non implementato | Conservare gli scenari comportamentali, inclusi Git/worktree reali, ed errori bloccanti; non sostituire operazioni verificate con mock o skip silenziosi. | Un pull fast-forward reale riesce; repository dirty/untracked e conflitti mantengono i rifiuti previsti; un gate fallito impedisce la pubblicazione. |
| NLC-008 | F2, F5 | attivo; approvato come perimetro | Non modificare build cloud, piattaforme distribuite, configurazione Sophos o comportamento Git di produzione per accelerare i test. | Il flusso continua a distribuire le stesse piattaforme; i repository di lavoro e le impostazioni globali Git non vengono alterati dalle fixture. |
| NLC-009 | F4, F5; vincolo operativo | attivo; progettato, non implementato | Preservare lavoro parcheggiato, versioni stabili, autorizzazione esplicita a pubblicare e identita del commit/installer. | Preparazione locale senza commit; dry-run non carica asset; un errore ripristina le versioni; modifica durante i controlli invalida la prova. |
| NLC-010 | F1, F2, F5 | attivo; direzione approvata | Scegliere le ottimizzazioni con confronti locali omogenei, senza promettere durate non misurate. | Report prima/dopo sullo stesso scenario e toolchain, con cache fredda/calda distinte, numero di processi e risultati funzionali. |

Nessun requisito esistente viene rimosso o sostituito. Il piano operativo e in `../PLAN.md`, sezione «Nightly locale Windows — accelerazione delle verifiche e del rilascio».

## Evidenze raccolte, non accettazione dell'implementazione

| Data | Scenario | Risultato osservato | Prova |
|---|---|---|---|
| 2026-11-05 | `npm test`, sequenziale | 73,0 s; 1384 passati, 1 fallito, 1 saltato. Lo scenario sources del diario richiede 55,1 s. | Output nella sessione corrente; runner `scripts/run-smoke-tests.mjs`. |
| 2026-11-05 | Stesso scenario sources con cartella agente temporanea | 135 ms; documenti trovati e nessuna `.omp` creata. Non e una modifica permanente della suite. | Probe temporaneo in memoria, rimosse le directory create, sessione corrente. |
| 2026-11-05 | `npm run check`; `npm run check:commands` | 89,7 s, 0 errori e 6 warning; 4,4 s, catalogo allineato. | Output nella sessione corrente. |
| 2026-11-05 | `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` | 55,4 s complessivi, 54,92 s Cargo; successo, 16 warning; nessun test eseguito. | Output nella sessione corrente. Non rappresenta il tempo dell'intera suite. |
| 2026-11-05 | Help del test harness Rust | I test sono paralleli per default; `RUST_TEST_THREADS` non impostata nell'ambiente osservato. | Eseguibile lib-test esistente, opzioni `--list` e `--help`, sessione corrente. |
| 2026-11-03 | Sei scenari Git/worktree dopo ottimizzazione fixture | 284 s complessivi, 221 processi Git, nessuna manutenzione automatica; pull a seed pronto 22,3 s. | `../diario/2026-11.md`, sessione 01a1a066. Misura storica, non rieseguita qui. |

Fallimento noto da correggere prima del confronto verde: `test/studio-docs.test.ts:272`, confronto percorso Windows lungo/alias 8.3. Non eliminarlo ne trasformarlo in uno skip.

## Implementazione e verifica dei requisiti

Tutti NLC-001…010: implementazione **non eseguita**; accettazione end-to-end **non eseguita**. Aggiornare questa sezione con data, scenario, esito e riferimento alla prova dopo l'esecuzione delle fasi del piano; non dedurre la verifica da una spunta.
