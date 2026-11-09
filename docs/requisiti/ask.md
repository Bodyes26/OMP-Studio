# Ask HTML — requisiti e piano condiviso

## Stato

Implementazione autorizzata il 2026-11-09 (F8), codice scritto per ASK-001…014. Lo stesso giorno l'utente ha provato il percorso sull'app e ha dichiarato: «ho provato tutto funziona». ASK-001…014 sono confermati su quella prova. È autorizzata la Nightly, non la versione stabile.

## Fonti dell'utente

- **F1 — 2026-11-09, sessione corrente:** «facciamo un plan per implementare il nuovo tool ask discutendo insieme [...] il fatto che l'agente restituisca direttamente html permette al tool ask di essere più dinamico [...] Insieme nel plan includi anche le altre piccole correzioni che servono tipo la soglia 3 del setup e robe del genere».
- **F2 — 2026-11-09, sessione corrente:** «la prima opzione», riferita a «Un modulo unico, diviso in sezioni: vedo tutto e modifico liberamente prima di inviare».
- **F3 — 2026-11-09, sessione corrente:** «ricordati che al momento non riesco a rispondere se usi il tool ask».
- **F4 — 2026-11-09, sessione corrente:** «sì assolutamente no invio automatico», in risposta alla proposta di aspettare sempre l'invio esplicito senza spedire opzioni preselezionate dopo inattività.
- **F5 — vincolo preesistente:** `docs/requisiti/laboratorio.md`, F11 del 2026-11-02 e R-LAB-04: screenshot allegabile alla risposta nella scheda ask, associato alla domanda, consegnato con l'invio senza secondo messaggio manuale; bozza conservata riducendo/riaprendo; invio impedito durante preparazione immagini.
- **F6 — 2026-11-09, sessione corrente:** «sì», riferito alla proposta «Aggiungi nota o immagine» in ogni sezione, con area aperta solo quando serve.
- **F7 — 2026-11-09, sessione corrente:** «ho provato una volta a rispondere con un'immagine e ho visto che aveva risposto solo col testo e messo il messaggio con immagine in coda, puoi verificare se si può fare di rispondere direttamente con l'immagine se viene allegata alla risposta?».
- **F8 — 2026-11-09, sessione corrente:** «ok procedi pure con l'implementazione completa. non fare test, non perdere tempo a testare il codice che scrivi, tutti i test vengono fatti quando viene fatta la build per cui non serve fare nulla prima, scrivi solo il codice».

## Requisiti confermati

| ID | Fonte | Requisito e scenario concreto | Approvazione | Implementazione | Verifica |
| --- | --- | --- | --- | --- | --- |
| ASK-001 | F1, F8 | Integrare il nuovo ask HTML di OMP: l'agente compone contenuti e campi diversi nello stesso modulo. Una richiesta contiene scelte, un numero e testo libero e restituisce dati con i nomi dei campi corretti. | Attivo, approvato. | Wrapper `studio-ask.ts` sul builtin OMP e modello `askForm.ts`. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-002 | F2, F8 | Un solo modulo a sezioni, tutte accessibili e modificabili prima dell'invio; niente avanzamento obbligatorio domanda per domanda. | Attivo, approvato. | `AskForm.svelte`, riusato nelle superfici. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-003 | F4, F8 | Nessun invio automatico, nemmeno di valori preselezionati; invio e annullamento richiedono azioni esplicite. Il vincolo vale nel runtime, non solo nella UI. | Attivo, approvato. | Overlay `ask.timeout: 0`, conto alla rovescia rimosso; policy preservata ai cambi prewalk. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-004 | F3, F8 | Risolvere l'impossibilita' di rispondere segnalata dall'utente. Form completo e ripresa dello stesso agente con le risposte corrette, non ripiego seriale. | Attivo, approvato. | Richiesta editor tipizzata, identita' tool/processo e invio tramite owner del bus. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-005 | F1, F8 | Riallineare soglia setup 3 senza attivare aggiornamenti o cambiare credenziali. | Attivo, approvato. | `setup.rs` soglia 3 e riferimento upstream aggiornato. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-006 | F5, F8 | Preservare R-LAB-04: screenshot associato alla domanda, scelta/incolla nella scheda, preparazione prima dell'invio, consegna con risposta e bozza conservata. | Attivo, approvato ed ereditato. | Annotazioni e allegati nel draft condiviso; invio bloccato durante preparazione/errore. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-013 | F7, F8 | Immagine allegata nella risposta ask, non in un successivo messaggio steer/in coda; niente invio del solo testo se un allegato non e' pronto. | Attivo, approvato. | Runtime restituisce testo e immagini nello stesso risultato nativo, con associazioni nei dettagli. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |
| ASK-014 | F6, F8 | «Aggiungi nota o immagine» in ogni sezione; area aperta solo quando serve. | Attivo, approvato. | Disclosure per sezione nel modulo condiviso. | Confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). |

## Direzione approvata con F8

- Mantenere il modulo vicino al composer, scorrevole e allargabile per richieste lunghe, secondo `docs/DESIGN.md` (Action-Point Rule).
- Applicare tema, controlli e accessibilità di Studio al contenuto semantico HTML; non eseguire script, stili o navigazioni arbitrarie del modello.
- Preservare note, bozze, stato di attenzione, notifiche e accesso da Companion/Remote; definire una sola consegna autorevole per richiesta e il comportamento dei client concorrenti.
- Aggiornare anteprima da `html` e storico da `details.answers[]`, senza perdere la leggibilità dello storico legacy.
- Separare le correzioni obbligatorie da nuove funzioni opzionali (es. shell fuori contesto e manutenzione gc), che non diventano automaticamente parte della migrazione.

## Evidenze dell'indagine precedente alla migrazione

- Runtime installato verificato nell'indagine precedente: `omp/18.18.3`.
- Il nuovo tool usa `{ html }` e risultati `details.answers[]`; il contesto RPC upstream non offre `ui.formDialog` e il tool usa il percorso campo per campo. Questo non dimostra che l'utente riesca a rispondere: F3 prevale su quella deduzione.
- Prova diretta precedente con i moduli reali: `askResult.ts` non estrae le risposte da `answers[]`; `askStream.ts` non estrae domande da `html`.
- `npm run check:commands` nella precedente indagine: PASS, 47 builtin. Nessun nuovo comando da aggiungere dimostrato da quel controllo; non è prova del funzionamento di ask.
- Setup: Studio usa soglia 2 in `src-tauri/src/setup.rs`; upstream 18.18.3 usa 3 in `packages/tui/src/setup/setup-version.ts`.

Fonti ufficiali: [release v18.18.3](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.3), [tool ask](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/src/tools/ask.ts), [RPC](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/src/modes/rpc/rpc-mode.ts), [setup](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/tui/src/setup/setup-version.ts). Rapporto locale di dettaglio: `ricerca/omp-18.18.3-impatto-studio-2026-11-09.md`.

## Decisioni di implementazione

- `studio-ask.ts` usa i moduli pubblici del runtime per form e immagini e `ctx.invokeTool` per il builtin `ask`. Il contesto UI pubblico e' condiviso fra tool ed estensioni RPC: il wrapper installa `formDialog` per la durata della chiamata esclusiva e lo ripristina sempre.
- Il canale editor trasporta il modello canonico e una busta di risposta; i valori nominati restano separati da note e immagini. Il wrapper valida tutti gli allegati prima di completare il tool nativo e compone un solo risultato multimodale.
- `promptBus` governa la consegna sul proprietario e l'ack alle finestre secondarie; bozze e stato degli allegati restano associati alla richiesta. La PWA conserva la propria bozza in memoria per host/progetto/richiesta.
- Piccole correzioni incluse: anteprima HTML, storico `answers[]` e legacy, rimozione auto-invio e soglia setup 3. Nuove funzioni shell/manutenzione/provider fuori scope.

## Verifiche del nuovo comportamento

| Data | Requisiti | Scenario e risultato | Prova |
| --- | --- | --- | --- |
| 2026-11-09 | ASK-001…014 | Modulo unico, invio solo esplicito, note e immagini nello stesso risultato, bozza conservata, Companion, Remote e soglia di setup. L'utente li ha usati sull'app e il comportamento è quello atteso. | Utente, 2026-11-09: «ho provato tutto funziona». |

## Cutover proposto: comportamenti esistenti

Non è approvata alcuna rimozione oltre all'invio automatico esplicitamente rifiutato in F4. Una modifica tecnica al contratto non autorizza a cancellare una funzione utente.

| ID / comportamento | Esito proposto | Destinazione o motivo |
| --- | --- | --- |
| ASK-001, ASK-002 — domande a passi | Spostato, scelta approvata F2 | Campi e sezioni nello stesso modulo; tutte le risposte modificabili fino all'invio. |
| ASK-003 — conto alla rovescia e invio dei default | Rimosso, conferma esplicita F4 | Attesa dell'invio o annullamento dell'utente; nessun timer UI o runtime può confermare. Non rimuovere timeout tecnici di rete o rilevamento di processo terminato. |
| ASK-006 / R-LAB-04 — screenshot nella risposta | Mantenuto | Allegati alla domanda/campo del modulo, con preparazione, anteprima e consegna esplicita. |
| Note, risposte libere e delega esplicita all'agente dove già disponibili | Mantenuto, migrazione da definire | Non cancellate dal solo fatto che upstream ha cambiato il formato dei dettagli; distinguere dati del form e annotazioni dell'utente. |
| ATT-003 — stato domanda distinto dall'attesa automatica | Mantenuto | Scheda interattiva vicino al composer e traccia leggibile nello storico; non convertire domanda pendente in fine lavoro. |
| R-REM-05 — domande in chat e richiamo su Remote | Mantenuto | Accesso al modulo senza cambiare progetto/corsia o perdere la bozza per arrivi altrove. |
| Vecchie conversazioni con ask questions/results | Mantenuto | Lettura dello storico legacy; non riattivare per questo il vecchio contratto delle nuove richieste. |
| Isolamento Laboratorio e automazioni in sola lettura | Mantenuto | Nessun tool o permesso aggiunto per il solo fatto di poter mostrare un modulo. |

## Scenari di accettazione proposti

Questa matrice è lo scenario provato dall'utente il 2026-11-09 sull'app. Esito: «ho provato tutto funziona».

| Scenario | Requisiti | Risultato richiesto |
| --- | --- | --- |
| Form misto reale | ASK-001, ASK-002, ASK-004 | Radio, checkbox, select, numero, testo e campo multilinea nello stesso modulo; risposta JSON con nomi, tipi e valori coerenti col runtime OMP; stesso agente riprende dopo un unico invio. |
| Inattività con opzioni preselezionate | ASK-003 | Trascorsa una scadenza di prova, anche con default globali OMP contrari, zero risposte inviate; richiesta ancora pendente. |
| Riduzione e cambio progetto/corsia | ASK-002, ASK-006 | Si torna alla richiesta con valori, note e screenshot ancora presenti; nessun invio implicito. |
| Dato non valido o immagine in preparazione | ASK-001, ASK-006 | Invio impedito con spiegazione vicino al campo/allegato; il resto della bozza resta. |
| Errore di consegna | ASK-004 | Modulo e allegati restano disponibili; errore esplicito; un nuovo invio deliberato non duplica una risposta già consegnata. |
| Risposta da più superfici | ATT-003, R-REM-05 | GUI, Companion e Remote si riferiscono alla stessa richiesta/processo; una sola risposta accettata; altre superfici aggiornate, nessuna doppia consegna di immagini. |
| Annullamento o processo terminato | ASK-003, ASK-004 | Nessun default spedito; stato annullato/scaduto distinto dalla risposta inviata; niente risposta destinata a una nuova sessione. |
| Screenshot nel Laboratorio | ASK-006, ASK-013, R-LAB-04 | Scegli/incolla, riduci/riapri, invia: l'immagine è un blocco del risultato della stessa chiamata ask ed è associata alla domanda; nessun messaggio steer, follow-up o elemento in coda creato dall'allegato; permessi Lab immutati. |
| Anteprima e storico | ASK-001, ATT-003 | Nessuna interazione sul markup incompleto; nuovo storico con domande/risposte reali; vecchio storico ancora leggibile; ripresa sessione non inventa un dialogo vivo. |
| HTML/SVG non attendibile | ASK-001 | Nessuno script, handler, navigazione o accesso arbitrario a file/API Tauri; immagini e diagrammi ammessi tramite percorsi controllati, contenuto non supportato segnalato quando significativo. |
| Setup precedente/corrente | ASK-005 | Profilo con soglia 2 segnalato precedente; soglia 3 completa; credenziali e preferenze intatte; nessuna attivazione implicita di auto-update. |
| Temi, tastiera e schermi piccoli | ASK-002, ATT-005, R-REM-05 | Tema chiaro/scuro, IT/EN, focus e tabulazione corretti; Invio in textarea non spedisce il modulo; nessun campo o pulsante irraggiungibile per overflow. |
| Allegato non consegnabile | ASK-013 | Immagine ancora in preparazione, errore di staging, dimensione non accettata o modello senza supporto immagini: feedback esplicito e bozza conservata; nessun invio del solo testo o accodamento silenzioso. |
| Nota o immagine per sezione | ASK-014 | L'area non occupa spazio aperta finché non richiesta; quando contiene una nota o un allegato resta riconoscibile e non si svuota riducendo la scheda. |

## Requisiti della proposta approvata con F8

Fonte P1: proposta dell'assistente del 2026-11-09, approvata per l'implementazione completa con F8. ASK-007…012 restano attivi: codice scritto nei moduli indicati sotto e confermato dall'utente il 2026-11-09 sull'app («ho provato tutto funziona»). Non sostituiscono gli ID gia' confermati.

| ID | Proposta | Scenario concreto |
| --- | --- | --- |
| ASK-007 | Contenuto semantico HTML con stile Studio, controlli accessibili, immagini/SVG tramite percorsi controllati; nessun codice o stile arbitrario nella WebView. | Un modulo mostra spiegazione, diagramma e campi; markup ostile non esegue codice né legge file arbitrari. |
| ASK-008 | Note e screenshot associati a campi/sezioni, risposta libera dove prevista e «Decidi tu» esplicito preservati; annotazioni distinte dai valori HTML. | Una nota non diventa un'opzione selezionata o il valore invalido di un campo numerico; delegare non finge una compilazione valida. |
| ASK-009 | Bozza legata a richiesta/processo, unica consegna autorevole tra superfici e invio ripetibile solo dopo errore certo; annullamento e richiesta orfana distinti da risposta. | Desktop e Remote rispondono insieme: un solo esito, nessun allegato duplicato, nessuna risposta al processo sbagliato. |
| ASK-010 | Anteprima del nuovo form e storico nuovo/legacy leggibile senza inventare campi o risposte dal markup incompleto. | Una vecchia sessione e una nuova mostrano le decisioni reali; una risposta scaduta non viene mostrata come conferma esplicita. |
| ASK-011 | Migrazione di tutte le superfici che già presentano ask: chat principale, corsie, Lab, Companion e Remote; nessun auto-invio nelle sessioni avviate da Studio, incluse quelle terminale con UI nativa. | La stessa richiesta resta gestibile dal punto di accesso scelto; nessuna configurazione di sessione rimette un timeout mentre l'utente compila. |
| ASK-012 | Modulo vicino al composer, corpo scorrevole ed espansione per richieste lunghe, tema chiaro/scuro, IT/EN, tastiera e focus; invio esplicito anche da tastiera. | Si compila un modulo lungo su schermo piccolo; Invio in textarea inserisce una riga; il comando di invio conferma solo dati validi. |

## Decisione tecnica proposta e limite della ricerca

- **Confermato dal sorgente:** il contesto RPC upstream non implementa `formDialog`; `ctx.ui.editor` può già trasportare contenuto testuale e una decisione JSON, come nella revisione Piano di Studio.
- **Strada locale implementata ed esercitata dall'utente il 2026-11-09:** wrapper del tool standard `ask`, input HTML invariato, parser e tool nativo riusati; il form intero viaggia sul canale editor. Nessuna modifica all'eseguibile installato. La prova sull'app è «ho provato tutto funziona».
- **Nessun blocco export dedotto dai soli package.json:** sia pi-tui sia coding-agent dichiarano subpath wildcard; non è corretto considerarli limitati a file piatti e concludere che parser o AskTool siano sicuramente inaccessibili. Il loader embedded del binario va verificato realmente.
- **Nessuna modifica all'exe installato, import da percorsi interni assoluti o copia divergente del parser.** Se la strada locale non soddisfa il contratto completo, il form intero richiede un'integrazione RPC upstream verificabile. Non sostituire il risultato con il ripiego seriale che l'utente segnala non utilizzabile.
- **No-timeout:** upstream definisce `ask.timeout` in secondi, con 0 per disabilitarlo. Il piano deve applicarlo tramite overlay di sessione GUI, PTY, Lab e automazioni senza toccare il profilo globale. Verificare che la riscrittura dell'overlay prewalk non elimini la policy.

Fonti aggiuntive: [exports pi-tui](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/tui/package.json), [exports coding-agent](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/package.json), [adapter strumenti](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/src/extensibility/extensions/wrapper.ts), [delega al builtin](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/src/extensibility/extensions/runner.ts).

### Precisazione sulla policy di timeout

Verificato nel sorgente upstream `packages/coding-agent/src/modes/settings.ts`: `ask.timeout` ha default 0; `askTimeoutMs` restituisce `undefined` quando il valore è 0. La policy Studio serve quindi anche contro un'eventuale impostazione utente non nulla, senza riscriverla globalmente. La stessa impostazione limita le richieste di approvazione `cfg://`: disabilitarne il timer non deve mai equivalere a concedere un'approvazione. Permessi e azioni sensibili restano soggetti alle regole esistenti.

## Indagine sulla consegna diretta delle immagini — 2026-11-09

La segnalazione F7 è la riproduzione del difetto; non è stata ripetuta con un'altra chiamata all'agente.

- **Causa confermata dal codice:** `AskCard.svelte:611-641` costruisce `imageSteers`; `AgentSession.submitAskAnswers` (`session.svelte.ts:4334-4362`) invia prima `{ answers }` e poi un comando `steer` per ogni gruppo di immagini. Il fallback di errore rimette gli allegati nel composer. È quindi una consegna separata, non un'immagine incorporata nel risultato ask.
- **Contratto upstream confermato:** `AgentToolResult.content` (`packages/agent/src/types.ts:1047-1049`) e `ToolResultMessage.content` (`packages/ai/src/types.ts:1401-1405`) accettano sia `TextContent` sia `ImageContent`. Il formato immagine contiene tipo, MIME e dati base64. Studio usa già risultati testo+immagine in `extensions/studio-diagram.ts:798-814` per gli snapshot di `studio_preview`.
- **Limite del tool ask stock:** `packages/coding-agent/src/tools/ask.ts` restituisce attualmente solo un blocco testo con il JSON delle risposte; immagini mostrate dentro il form e immagini allegate dall'utente alla risposta sono due percorsi distinti. Aggiungere un campo `images` alla vecchia risposta UI o un tag `<img>` nel JSON non cambia automaticamente quel risultato.
- **Decisione per il piano:** l'adattatore runtime deve ricevere una busta con dati, annotazioni e allegati preparati da Studio, validarli per la richiesta/processo proprietari e produrre un unico risultato con blocchi testo e immagine. Conservare dati serializzabili del form e riepiloghi in `details`, senza usarli come sostituto dei blocchi immagine che il modello deve vedere.
- **Vincolo di consegna:** nessun risveglio dell'agente con il solo testo prima che tutti gli allegati siano accettati. Rimuovere dal nuovo percorso `buildAskImageSteers` e la consegna separata quando resi obsoleti dalla migrazione, non introdurre un altro messaggio invisibile in coda.
- **Stato della fattibilità:** supporto multimodale del contratto verificato sui sorgenti ufficiali; risposta ask con immagine nel nuovo adattatore sul binario stock ancora da esercitare in ASKP00/ASKP04. Non è una correzione già applicata o una prova che il modello abbia visto lo screenshot.

Fonti ufficiali: [AgentToolResult](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/agent/src/types.ts#L1047-L1049), [ToolResultMessage e ImageContent](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/ai/src/types.ts#L1401-L1405), [ask stock](https://github.com/can1357/oh-my-pi/blob/v18.18.3/packages/coding-agent/src/tools/ask.ts).

## Mappa del codice — 2026-11-09

| Requisiti | Moduli |
| --- | --- |
| ASK-001, ASK-003, ASK-004, ASK-005 | `extensions/studio-ask.ts`; `src/lib/agent/askForm.ts`; overlay in `src-tauri/src/rpc/mod.rs` e `pty/mod.rs`; soglia in `setup.rs`. |
| ASK-002, ASK-007, ASK-008, ASK-012, ASK-014 | `AskForm.svelte`, `Chat.svelte`, `AskCard.svelte`; controlli canonici, SVG immagine inerte sanificata, disclosure e allegati; testi `ask_form_*` IT/EN. |
| ASK-006, ASK-009, ASK-013 | `session.svelte.ts`, `promptBus.ts`, `sessionRegistry.ts`, `askAnswers.ts`; bozze con pending/errori media, owner e richiesta/ack, risultato testo+immagini nel wrapper runtime. |
| ASK-010 | `askStream.ts`, `AskStreamPreview.svelte`, `askResult.ts`, `AskTrace.svelte`; nuovo schema e lettura delle conversazioni legacy. |
| ASK-011 | Store e viste Companion, proiezione/comandi Remote, protocollo relay, `AttentionCard.svelte`, store bozze PWA; stesso modulo nelle superfici grafiche e timeout disabilitato anche nel PTY nativo. |

I limiti dei frame non autorizzano invii parziali: errore esplicito e bozza conservata. Nel client Remote il budget di preparazione immagini e' ridotto rispetto al collegamento RPC locale per rispettare il frame WebSocket completo. Questa mappa documenta il codice scritto, non prove di riuscita.
