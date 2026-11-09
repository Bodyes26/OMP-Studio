# Attese e strumenti contestuali — registro dei requisiti

## Fonte e direzione approvata

2026-11-01, utente: «quando l'agente chiama il wait perché sta aspettando il lavoro di un subagente mostrarlo […] tipo "in attesa di x…"», con una valutazione generale delle attese e degli altri comandi.
2026-11-01, proposta B: attesa compatta con dettagli espandibili, destinazioni certe, tono preciso e discreto, azione + oggetto + esito per gli strumenti.
2026-11-01, utente: «sì va bene b» e «Procedi pure.» — approvazione della direzione e dell'implementazione. Nessuna rimozione di comportamenti esistenti.

2026-11-09, utente: «la chat gui si interrompe dicendo che ha finito ma l'agente ha lavorato in background […] Verifica il bug e risolvi, poi fai build nightly». Precisazione di ATT-003: un risultato asincrono che riavvia il run mantiene chat e streaming al lavoro; solo `isSettled = true` chiude il lavoro. Durante l'attesa il transcript mostra il lavoro aperto invece del piè finale.

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| ATT-001 | attivo, approvato e implementato; verificato nello smoke browser | Attesa compatta con durata; destinazioni solo quando collegate da dati certi, altrimenti «In attesa di aggiornamenti…». | `wait` senza target non attribuisce l'attesa a un subagente arbitrario. |
| ATT-002 | attivo, approvato e implementato; verificato nel browser e sul riduttore reale | Dettagli espandibili per subagenti e processi, attività recente e accesso alla conversazione dove esiste un'identità verificabile. | Durante un'attesa si possono consultare le attività note; il transcript storico non viene associato ai lavori di una sessione successiva. |
| ATT-003 | attivo, approvato e implementato; verificato nello smoke browser e nelle regressioni | Distinguere attesa automatica, domanda all'utente, fine attesa ed errore; la fine di `wait` non implica la fine di tutti i lavori. La domanda mantiene `AskTrace` e la scheda esistenti. | Arriva il primo risultato, gli altri lavori restano in corso senza un falso completamento collettivo. |
| ATT-004 | attivo, approvato e implementato; verificato nel browser e nella suite | Sintesi degli strumenti con azione, oggetto ed esito disponibili; comando, argomenti, intento e output restano consultabili. | Lettura, ricerca, modifica, shell e web mostrano etichette leggibili e dettagli tecnici espandibili. |
| ATT-005 | attivo, approvato e implementato; verificato nel browser | Riutilizzare stile e icone di Studio, movimento discreto solo durante l'attività, supporto a movimento ridotto e testi italiano/inglese; nessuna percentuale o stima inventata. | In tema chiaro/scuro e con animazioni disattivate l'attesa rimane riconoscibile senza spinner insistente. |

## Verifiche

L'anteprima `proto/attese-strumenti-proposte.html` rimane una proposta con dati dimostrativi, non prova dell'integrazione.

| Data | Requisiti | Scenario e risultato | Prova |
|---|---|---|---|
| 2026-11-01 | ATT-001…005 | Componente `ToolGroup` e renderer `Wait` reali montati via Vite nel browser: attesa nominativa, disclosure, apertura transcript (hook riceve `review`), fallback con solo contesto, fine wait con processo ancora running, messaggio peer e corpo, errore con output; resa chiara/scura e animazioni disattivate (`animationName: none`). Italiano e inglese osservati. Superato. | Smoke temporaneo rimosso; output e screenshot nella sessione corrente. |
| 2026-11-01 | ATT-002 | `AgentSession` reale compilata da Vite ed esercitata nel browser: intent da `args.i`, snapshot aggiornato durante wait, congelato dopo `tool_execution_end`, preservato nel replay della stessa chiamata; nessun backfill per una chiamata storica senza snapshot anche con subagenti attuali presenti. Superato. | Output `PASS: intent live, aggiornamento durante wait, congelamento dopo fine, replay preservato, nessun backfill da attivita attuali` nella sessione corrente; route temporanea rimossa. |
| 2026-11-01 | ATT-001…005 | `npm run check`: 0 errori, 6 warning in file non modificati. `npm test`: 1386 passati, 0 falliti, 1 saltato. Le regressioni proteggono deduplicazione agente/job, prevalenza del fallimento nativo, peer non live senza falso successo/link, identità distinte con nomi uguali, contesto senza falsa attribuzione di target. | Suite finale, output nella sessione corrente. |
| 2026-11-03 | ATT-002 | Allineamento a omp 18.15/18.16: `details.jobs[].intent` (scopo dato dal modello) precede `label` nelle righe di attesa, nei job osservati e nella scheda `job`, con ripiego sul comando quando manca; regressioni su precedenza e ripiego. `npm test`: 0 falliti, 1 saltato; `npm run check`: 0 errori, 6 warning in file non modificati. Nessuna resa visiva verificata nel browser. | Suite e output nella sessione corrente. |
| 2026-11-09 | ATT-003 | `AgentSession` reale compilata da Vite e chiamata in Chromium attraverso `refreshState`, client RPC di fixture: background=true/working → snapshot streaming=true/settled=false conserva streaming=true e working → snapshot streaming=false/settled=true porta idle. Superato. | Output browser della sessione corrente: `before: {streaming:false,background:true,state:'working'}`, `resumed: {streaming:true,background:false,state:'working',settled:false}`, `final: {streaming:false,state:'idle',settled:true}`. Nessun processo agente reale o seconda istanza desktop avviato. |
| 2026-11-09 | ATT-003, ATT-005 | Componente reale `BackgroundWait` montato in Chromium: mostra «Verifica Nightly», esclude il job già completato; a 360 px nessun overflow; con movimento ridotto `animationName: none`. Resa scura osservata in inglese. | Screenshot e assert browser nella sessione corrente; harness temporaneo rimosso. La suite Node non importa `AgentSession` senza ampliare il loader (`ERR_UNSUPPORTED_DIR_IMPORT` sul modulo icons): la transizione è provata sul modulo browser reale, non su una copia del riduttore. |

Limiti della verifica del 2026-11-09: nessuna seconda istanza desktop avviata; `AgentSession` usa risposte RPC di fixture, mentre l'indicatore è il componente Svelte reale. Il controllo del movimento ridotto usa `prefers-reduced-motion` di Chromium. Il nuovo indicatore è stato osservato in inglese e tema scuro; italiano e tema chiaro non sono stati riesercitati in questa sessione.

## Dati e mantenimento dei comportamenti

Il contratto di omp 18.14.2 è stato ispezionato nel modulo embedded `packages/tui/src/tools/wait.ts`: `details.jobs`, `details.agents`, `details.waited`, `details.interrupted`. Nessun target viene ricavato dal testo dell'intento o da argomenti ipotetici. `live: false` da solo non prova il successo di un agente; un peer privo di corrispondenza nel contesto non riceve un collegamento al cassetto dei subagenti. Il protocollo e l'icona del Companion includono la nuova categoria `wait`; non cambiano schema delle domande, scheduling o semantica di esecuzione dei tool.
