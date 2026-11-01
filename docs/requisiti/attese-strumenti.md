# Attese e strumenti contestuali — registro dei requisiti

## Fonte e direzione approvata

2026-11-01, utente: «quando l'agente chiama il wait perché sta aspettando il lavoro di un subagente mostrarlo […] tipo "in attesa di x…"», con una valutazione generale delle attese e degli altri comandi.
2026-11-01, proposta B: attesa compatta con dettagli espandibili, destinazioni certe, tono preciso e discreto, azione + oggetto + esito per gli strumenti.
2026-11-01, utente: «sì va bene b» e «Procedi pure.» — approvazione della direzione e dell'implementazione. Nessuna rimozione di comportamenti esistenti.

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

Limiti della verifica: nessuna seconda istanza desktop avviata. Lo smoke SSR del riduttore non è utilizzabile per l'import CommonJS di xterm; lo stesso scenario è stato eseguito con successo sul modulo browser reale. Il controllo del movimento è stato esercitato tramite la preferenza globale di Studio; la regola `prefers-reduced-motion` riusa anche la soppressione globale esistente.

## Dati e mantenimento dei comportamenti

Il contratto di omp 18.14.2 è stato ispezionato nel modulo embedded `packages/tui/src/tools/wait.ts`: `details.jobs`, `details.agents`, `details.waited`, `details.interrupted`. Nessun target viene ricavato dal testo dell'intento o da argomenti ipotetici. `live: false` da solo non prova il successo di un agente; un peer privo di corrispondenza nel contesto non riceve un collegamento al cassetto dei subagenti. Il protocollo e l'icona del Companion includono la nuova categoria `wait`; non cambiano schema delle domande, scheduling o semantica di esecuzione dei tool.
