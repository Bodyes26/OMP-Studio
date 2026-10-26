# Roadmap tecnica e decisioni

Ricerca del **2026-10-25**, base `omp-studio-app` 1.8.0. **Nessun intervento descritto è stato implementato o autorizzato da questo documento.** Le classi di complessità esprimono superficie e rischi, non giorni o preventivi.

## Raccomandazione

Sviluppare per primi **R01 divisori da tastiera**, **R02 geometria persistente per progetto**, **R03 cambio superficie protetto e veritiero**. Risolvono problemi dimostrabili nel codice, senza nuove dipendenze, senza sostituire l'agente e senza una riscrittura. Sono preferibili a una nuova grande feature perché rendono affidabili azioni quotidiane già promesse dal prodotto.

Secondo blocco: errori recuperabili R04 e ricevute di verifica R05. Prestazioni R07 solo dopo baseline. Repo-map semantica, nuova shell editor, marketplace e cloud gestito non sono prerequisiti.

### Metodo di priorità

- Prima perdita/interruzione del lavoro e accesso all'azione, poi attrito ripetuto, poi estensioni.
- Evidenza SRC/OBS più forte di promessa commerciale; una ISSUE motiva una prova, non un bug locale.
- Frequenza stimata qualitativamente dal workflow documentato: non è telemetria d'uso.
- S: percorso locale e modello invariato; M: più superfici o schema persistito; L: protocollo/runtime/concorrenza o nuova capacità.
- Nessuna somma numerica di impatto, sforzo e confidenza: falsa precisione senza utenti o benchmark.
- Per i dettagli e le valutazioni per opportunità: [backlog](IMPROVEMENT_OPPORTUNITIES.md). Per priorità UI: [audit](UI_UX_MOTION_AUDIT.md#cinque-interventi-ui-prioritari).

<a id="top10"></a>
### Le dieci opportunità complessive, ordinate

L'ordine privilegia fattibilità e certezza rispetto all'ampiezza della funzionalità. Non significa che una ricevuta di verifica valga meno in assoluto di un divisore: richiede un contratto più impegnativo.

| Ordine | Opportunità / piano | Motivo concreto | Confidenza e compromesso |
|---|---|---|---|
| 1 | [O01](IMPROVEMENT_OPPORTUNITIES.md#o01) → [R01](#r01), resize da tastiera | Sblocca un'azione oggi solo pointer; fix locale | Alta SRC; smoke assistivo ancora necessario |
| 2 | [O02](IMPROVEMENT_OPPORTUNITIES.md#o02) → [R02](#r02), geometria per progetto | Toglie riaggiustamenti e completa promessa prodotto | Alta SRC; attenzione idratazione/salvataggio |
| 3 | [O03](IMPROVEMENT_OPPORTUNITIES.md#o03) → [R03](#r03), handoff sicuro | Espone/protegge l'interruzione di processo oggi dietro una scheda | Alta SRC; inventario TUI può essere incompleto |
| 4 | [O04](IMPROVEMENT_OPPORTUNITIES.md#o04) → [R04](#r04), errori azioni visibili | Evita console come unica garanzia al confine condiviso | Alta sul catch SRC, media sui caller; evitare doppio avviso |
| 5 | [O15](IMPROVEMENT_OPPORTUNITIES.md#o15) → [R05](#r05), verifica legata al codice | Riduce fiducia in test relativi a una revisione precedente | Alta sul gap SRC, media sul beneficio non misurato; M/L |
| 6 | [O19](IMPROVEMENT_OPPORTUNITIES.md#o19) → [R11](#r11), backpressure PTY | Coda Rust senza capacità e consumo xterm non confermato: prima probe, poi bounds | Alta SRC sul confine, saturazione runtime non riprodotta; M/L |
| 7 | [O16](IMPROVEMENT_OPPORTUNITIES.md#o16) → [R06](#r06), provenienza contesto | Rende riconoscibili le fonti di un invio senza ricordarle | Media; contesto esiste già, non duplicare payload |
| 8 | [O05](IMPROVEMENT_OPPORTUNITIES.md#o05), profiling motion prima di tuning | Verifica il costo reale di blur e layout nel burst | Alta su proprietà animate, non su jank; nessuna ottimizzazione senza traccia |
| 9 | [O17](IMPROVEMENT_OPPORTUNITIES.md#o17) → [R07](#r07), lettura di sessioni lunghe | Windowing attuale cresce con caricamenti; stabilire limite pratico | Media; virtualizzazione condizionale e rischio copia/focus |
| 10 | [O14](IMPROVEMENT_OPPORTUNITIES.md#o14) → [R10](#r10), consegna Lab tracciabile | Rafforza una capacità distintiva già esistente | Media; prima verificare completezza del payload attuale |

**Cinque UI/UX:** O01, O02, O03, O04, O15; dettaglio [U01-U05](UI_UX_MOTION_AUDIT.md#cinque-interventi-ui-prioritari).

**Cinque interventi tecnici:** bounds/backpressure PTY O19, framing fisico RPC O20, identità delle evidenze O15, bounded rendering/profiling O17/O05, geometria persistita con owner/flush unici O02. O12 resta condizionale: protezioni epoch esistono già. Sono candidati con prove di accettazione nei piani, non cinque bug tutti riprodotti.

**Tre opportunità originali:** ricevuta di verifica O15, ammissione quota trasparente O13/[R09](#r09), handoff Lab revisionato O14. Originalità della combinazione proposta, non esclusività mondiale.

**Mappatura completa dei piani:** R01/O01, R02/O02, R03/O03, R04/O04, R05/O15, R06/O16, R07/O17, R08/O12, R09/O13, R10/O14, R11/O19, R12/O20. O05 è prerequisito di misura per R07; O06/O09/O10/O11 sono principalmente consolidamenti di capacità già presenti o responsabilità del runtime; O07/O08 non giustificano adozione nella forma massiva o a soglie arbitrarie.


## Sequenza per gate, non per calendario

| Fase | Pacchetti | Dipendenze reali | Condizione di uscita |
|---|---|---|---|
| Quick wins | R01 tastiera; R04 errore azioni; correzioni copy platform-aware dopo verifica | Nessuna dipendenza tra tastiera ed errori; entrambi toccano shell/primitive condivise, ownership esplicita | Percorsi esercitati con errore e tastiera, nessun furto focus/TUI |
| Continuità a breve termine | R02 geometria; R03 handoff; R06 provenienza del contesto | R02 riusa limiti R01 ma può riusare helper locale prima; R03 dipende solo da stato runtime disponibile | Riavvio/cambio progetto non perde assetto; annulla handoff non chiude processi |
| Affidabilità strutturale | R11 bounds PTY; R12 framing RPC; R05 ricevute; R07 baseline/windowing; R08 lifecycle condizionale | Bounds dei trasporti hanno probe distinti; R05 definisce identità revisione; R08 solo dopo prova race, senza cambiare stessi reducer insieme | Backlog e framing limitati senza perdita semantica, evidenze scadono correttamente |
| Opportunità future | R09 ammissione quota; R10 handoff Lab verificabile | R09 richiede quota attendibile e owner unico dispatch; R10 riusa revisioni Lab e piano/review | Miglioramento dimostrato contro workflow manuale senza inferenze spacciate per certezza |

Per ogni pacchetto: leggere riferimenti dei simboli esportati via LSP prima di cambiarli; controllare modifiche utente; aggiornare callsite, contratti e docs bilingui di rilascio solo nell'implementazione autorizzata; verifica tipi, test pertinenti e smoke del percorso reale. Non fare bump o pubblicazione per questa ricerca solo documentale.

<a id="r01"></a>
## R01 — Divisori accessibili da tastiera

1. **Obiettivo:** stessa regolazione fine disponibile senza puntatore.
2. **Attuale SRC:** `src/routes/+page.svelte:3049-3245,3622-3629,3746-3753`, splitter con pointer/double click e nome/orientamento, non focusable; limiti160 px colonne/120 px righe.
3. **Desiderato:** Tab raggiunge il divisore, frecce cambiano misura nel verso corretto, Home/End limiti, reset esplicito, lettura del valore. Separatore nascosto escluso dal focus.
4. **Riferimento:** [WAI splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/); [VS Code accessibilità](https://code.visualstudio.com/docs/configure/accessibility/accessibility). Non copiare la palette.
5. **File:** route; eventuale componente `src/lib/ui/PaneSplitter.svelte` **nuovo proposto**, solo se semplifica due callsite; cataloghi `messages/it.json`, `messages/en.json` se servono descrizioni; test interazione esistente se appropriato.
6. **Riuso:** `clamp`, `maxCenter`, `maxTop`, `resetSplit`, token focus. Non introdurre un secondo algoritmo geometrico.
7. **Stato:** stesso valore del drag, `aria-valuenow` derivato, non seconda copia reattiva.
8. **Strategia:** prima estrarre operazione di delta comune pointer/key, poi attaccare keydown localmente; orientamento reale dal layout; `aria-controls` verso pannello con id stabile. Valori percentuali o pixel con `aria-valuetext` coerenti, non percentuale nominale diversa dal layout.
9. **Dipendenze/costo:** nessuna libreria; S con prova screen reader.
10. **Rischi:** frecce rubate alla TUI, focus su sidebar collassata, limite superiore inferiore al minimo in finestra piccola.
11. **Test:** direzioni nei due layout, clamp e reset, no-op modificatori; non testare stringhe sorgente/numero import.
12. **Accettazione:** tastiera completa, focus visibile, valore aggiornato, mouse invariato, nessun evento globale catturato.
13. **Prova del beneficio:** completare «dai più spazio alla chat» senza mouse prima impossibile dal divisore, dopo possibile; osservare desktop con VoiceOver/NVDA.
14. **Rollback:** revert cambi componente/route; nessuna migrazione dati.
15. **Alternativa semplice:** mantenere i due elementi inline con helper geometrico condiviso; non serve un design-system package.

<a id="r02"></a>
## R02 — Geometria persistente del progetto, non della corsia

1. **Obiettivo:** riaprire un progetto con le dimensioni lasciate dall'utente, promessa `PRODUCT.md:232-234`.
2. **Attuale:** `leftWidth`, `centerWidth`, `topHeight` locali alla route, default globali; reset e resize non salvano in store.
3. **Desiderato:** A/B con assetti diversi, corsie nello stesso progetto con geometria uguale, restore dopo riavvio e adattamento non distruttivo a schermo piccolo.
4. **Ispirazione:** persistenza delle preferenze di [VS Code](https://code.visualstudio.com/docs/configure/accessibility/accessibility#persisted-zoom-level), ma soprattutto contratto già scritto in Studio.
5. **File:** `src/routes/+page.svelte`, `src/lib/stores/projects.svelte.ts`, serializer metadata realmente usato dallo store, tipi relativi; non presumere un file/schema nuovo senza leggere persistenza; `docs/PRODUCT.md` solo per riallineare descrizione al comportamento finale.
6. **Nuovi componenti:** nessuno; helper puro opzionale per clamp/restore. Riutilizzare flush/save esistenti.
7. **Modello:** metadata opzionale versionabile `{horizontal, vertical}` con preferenza separata da misura effettiva clamped. Proprietario: progetto canonico. L'assenza conserva layout elastico attuale.
8. **Strategia:** caricare su cambio progetto quando pronto; pointerup/reset salvano una volta; keyboard salva con debounce o a fine gesto; observer adatta geometria effettiva senza cancellare preferenza. Salvataggi concorrenti devono attraversare la coda dello store, non scrivere settings separati.
9. **Dipendenze/costo:** zero dipendenze; M per migrazione/flush e concorrenza con idratazione.
10. **Rischi:** salvare A sotto chiave B durante switch, ripristino prima di misura DOM, finestra ridotta sovrascrive assetto preferito, file utente con campi sconosciuti.
11. **Test:** persistenza A/B, schema legacy assente, orientamenti, resize temporaneo, reload/chiusura durante flush.
12. **Accettazione:** A260/… e B diverso restano distinti; cambio corsia non salta layout; reset riporta default; no pannello a0 px; nessuna scrittura per ogni pointermove.
13. **Misura del beneficio:** numero di riaggiustamenti manuali tra A→B→A e dopo restart scende a0 nello scenario fissato, non percentuale inventata.
14. **Rollback:** campo opzionale ignorabile; mantenere valori salvati senza migrazione distruttiva.
15. **Alternativa:** una geometria globale persistita costa meno ma **non soddisfa** la promessa per progetto; ammissibile solo cambiando esplicitamente decisione di prodotto.

<a id="r03"></a>
## R03 — Handoff TUI/GUI senza sorprese

1. **Obiettivo:** non interrompere lavoro effimero per una scheda percepita come puramente visuale.
2. **Attuale SRC:** `laneOrchestrator.svelte.ts:433-483` abort/close GUI o release PTY, resume stesso ID; errori in `agentErrors`. La cronologia resta, gli strumenti in memoria no (`DECISIONS.md:100-105`).
3. **Desiderato:** quando esiste lavoro noto attivo, spiegare impatto e consentire annullamento prima di chiudere. Stato non enumerabile dichiarato come tale.
4. **Riferimenti:** [Codex Local/Worktree handoff](https://developers.openai.com/codex/environments/git-worktrees), chiarezza dell'ownership; principio Studio un processo per corsia. Non equivalere handoff checkout Codex a ripartenza processo omp: sono operazioni diverse.
5. **File:** orchestrator, `src/routes/+page.svelte`, stato sessione/gate già esistente; `ColumnTabs.svelte` **solo se necessario** (manual activation già corretta), `ConfirmDialog.svelte` da riusare, cataloghi IT/EN. `sessionModes.ts` gestisce fast/cache/usage, non creare lì un secondo lifecycle.
6. **Nuovo componente:** nessuno necessario; riusare confirm/dialog e indicatori esistenti.
7. **Stato:** decisione scoped a projectId+laneId+sessionId; snapshot delle risorse note e generazione della sessione. Non creare mirror del lifecycle runtime.
8. **Strategia:** classificare stato dal protocollo/capability: streaming/background/risorse note/sconosciute; preparazione senza mutazioni; su conferma ricontrollare identità e stato; cambiare una sola superficie; mantenere accesso al motivo di errore. Nessun auto-resume di comandi non idempotenti.
9. **Dipendenze/costo:** nessuna; M perché incrocia processi e race.
10. **Rischi:** conferma su corsia ormai cambiata, doppio click, processo chiuso ma target fallisce, falso «nessun job» quando TUI non espone inventory.
11. **Test:** annulla, conferma mentre arriva nuova attività, doppia richiesta, fallimento open/release, Lab solo GUI, chiusura app.
12. **Accettazione:** annulla non chiude nulla; conferma conserva transcript e un solo owner; warning non sostiene conservazione di kernel/browser; cambio progetto normale non apre dialog.
13. **Beneficio:** scenario stream/job+switch non può più perdere stato senza una scelta consapevole; traccia numero spawn e sessionId, non solo tab selezionata.
14. **Rollback:** rimuovere guard senza modificare transcript; nessuna migrazione. Se il runtime non espone attività TUI, fallback è avvertenza onesta, non euristica che dichiara sicurezza.
15. **Alternativa:** sola descrizione persistente del riavvio riduce ambiguità ma non protegge uno switch durante stream; non considerarla piena soluzione.

<a id="r04"></a>
## R04 — Esiti visibili delle azioni contestuali

- **Obiettivo/attuale:** il catch comune `ContextMenu.svelte:70-101` logga; callback possono già mostrare errori. Garantire un esito visibile una volta sola, non nascondere exception.
- **Desiderato:** azione fallita mantiene contesto/bozza e mostra motivo, «Riprova» solo quando sicuro.
- **Riferimento:** [VS Code notification/accessible view](https://code.visualstudio.com/docs/configure/accessibility/accessibility#accessible-view); principio recuperabilità, non nuova infrastruttura di toast.
- **File/riuso:** `src/lib/components/ContextMenu.svelte`, `src/lib/contextMenu.svelte.ts`, notice/alert locali esistenti, caller interessati trovati con LSP. Nessun nuovo store globale di notifiche se basta callback di reporting.
- **Modello:** esito tipizzato o reporter obbligatorio; distinguere errore già mostrato senza flag fragili duplicati. Scelta API da fare dopo inventario caller.
- **Strategia:** un solo owner visuale; correlare operazione e progetto; restituire focus all'invoker se ancora presente. Logger resta per diagnostica redatta.
- **Costo:** S/M secondo numero callback; zero dipendenze. Rischi: doppio avviso, retry duplicativo, dati sensibili nel testo errore.
- **Test/accettazione:** rejection reale visibile e annunciata, nessun falso successo, invoker preservato; retry non esegue merge due volte; callback già gestita non duplicata.
- **Verifica beneficio:** utente identifica cosa non è riuscito senza aprire log. Rollback contrattuale con migrazione di tutti i caller, niente shim legacy. Alternativa: garantire reporter nei pochi caller che oggi rigettano, se inventario dimostra sufficienza.

<a id="r05"></a>
## R05 — Ricevuta di verifica legata al codice

- **Obiettivo:** prima di integrare sapere *quale revisione* è stata verificata, non soltanto che un test è apparso nel transcript.
- **Attuale SRC:** `commandEvidence.ts:11-59` registra comando, exitCode, durata, running e snippet; nessun commit/dirty fingerprint. `LaneReviewModal.svelte:149-157` dipende da entries della sessione viva. `integrationGate.ts` non usa esito test come policy: preservare questa separazione.
- **Desiderato:** review mostra ricevuta valida/scaduta/sconosciuta e provenienza; edit successivo invalida relazione col codice, non cancella lo storico.
- **Ispirazione:** [Cursor Cloud Agents](https://cursor.com/help/ai-features/background-agents) allega video/screenshot/log alla PR; [Aider lint/test](https://aider.chat/docs/usage/lint-test.html) verifica dopo edit. Studio può essere più preciso con codice locale e ricevuta deterministica, senza generare un altro riassunto LLM.
- **File:** `src/lib/lanes/commandEvidence.ts`, `LaneReviewModal.svelte`, `lanePersistence.ts`/store solo per metadata ricevuta; Rust `projects/worktrees` per snapshot attendibile se non esiste comando adatto; client/session protocol adapter se serve provenienza. Riusare perf/log non output completo indiscriminato.
- **Nuovo record PROP:** receiptId, project/lane/session, base/HEAD, stato dirty identificato, commandId/comando selezionato dall'utente, cwd, tempi, exitCode, digest/riferimento artifact. **HEAD da solo non basta** per file non committati; fingerprint deve includere tracked+untracked rilevanti. Evitare hash dell'intero node_modules o lettura segreti.
- **Strategia:** registrare snapshot prima/dopo verifica, dichiarare sconosciuto se mutazioni durante comando o snapshot non attendibile; non promuovere `exitCode` assente a0. Ricevuta non autorizza codice, è evidenza. Gate integrazione può restare informativo inizialmente; policy bloccante richiede decisione esplicita.
- **Costo:** M/L, nessuna libreria iniziale. Dipende dalla definizione della revisione dirty e dalle capability runtime; non classificare come quick win.
- **Rischi:** TOCTOU dopo snapshot, comandi async fuori dal cwd, verifica falsa importata da testo, log con segreti, ricevuta troppo costosa su repo grande.
- **Test:** edit dopo successo, successo dopo failure, senza exitCode, verifica eseguita in altra corsia, riavvio, dirty+untracked, target avanzato, comando ancora running; probe reale su repo temporaneo nel repo, nessun merge sul progetto utente.
- **Accettazione:** mai verde «verificato» per revisione diversa; preserva evidenze anche senza sessione montata; nessun comando eseguito automaticamente leggendo testo tool.
- **Misura:** contare casi falsamente presentati come attuali nello scenario controllato prima/dopo; tempi di snapshot su repo rappresentativa. Rollback: ignorare metadata additive e mantenere transcript. Alternativa S: semplice etichetta «comando nel transcript, attualità non verificata», utile subito ma non equivalente a ricevuta.

<a id="r06"></a>
## R06 — Provenienza del contesto prima dell'invio

- **Obiettivo/attuale:** Studio ha già file mention, allegati, editor context, preflight, /context; non manca genericamente «gestione contesto». `Composer.svelte` importa questi percorsi, il documento tecnico ne dettaglia il flusso.
- **Desiderato:** disclosure compatta di cosa sarà allegato automaticamente, da quale progetto/corsia, modificato/salvato, con limiti dichiarati. Non riesporre l'intero prompt di sistema o segreti.
- **Riferimenti:** [Zed agent panel](https://zed.dev/docs/ai/agent-panel), contesto esplicito; [Aider repo map](https://aider.chat/docs/repomap.html), budget del contesto. L'indicizzazione globale è alternativa più complessa, non primo passo.
- **File/riuso:** `promptPreflight.ts`, `editor/editorContext.ts`, `fileMention.ts`, `ContextPanel.svelte`, `Composer.svelte`, flusso submit esistente. Riusare report/capability, nessun secondo composer.
- **Stato/strategia:** manifest per il singolo invio con origine e versione del buffer, UI derivata dalla stessa busta effettivamente spedita; non preview costruita a parte e poi diversa dal payload.
- **Costo:** M, zero dipendenze. Rischi: buffer dirty vs disco, cambio corsia durante preflight, payload già troppo grande, prompt segreto esposto.
- **Test/accettazione:** A/B mai mescolati; allegati esclusi non inviati; bozza intatta su preflight fallito; token ignoti etichettati stima/non disponibile. Misura beneficio con task ambiguo senza dover ricordare file attivi. Rollback disabilita disclosure ma conserva contratto payload; alternativa mostra solo elenco origini senza token estimate.

<a id="r07"></a>
## R07 — Transcript lungo: misurare prima, limitare poi

- **Attuale SRC:** `transcriptWindow.ts` render300 iniziali, «precedenti» aggiunge300 e conserva tutte le entries; non virtualizzazione a limite fisso. `Transcript.svelte` deriva gruppi dal sottoinsieme; `motion.ts` anima layout. Non è prova di lentezza.
- **Desiderato:** input e scroll reattivi anche dopo molte espansioni, con ricerca, copia e accessibilità preservate.
- **Riferimenti:** [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/) come principio di consumer/bounds, non virtualizer chat; [TanStack Virtual](https://tanstack.com/virtual/latest/docs/framework/svelte/svelte-virtual) solo se baseline giustifica la dipendenza; native Svelte per motion.
- **File/riuso:** `transcriptWindow.ts`, `Transcript.svelte`, `session.svelte.ts` solo visibilità/derivazioni necessarie, `Chat.svelte`, `revealEngine.ts`, `perf.ts`. Niente riscrittura del transcript model.
- **Strategia:** baseline riproducibile300/3000/30000 entry con stesso input; misurare DOM nodes, memoria, long task/input, IPC, parsing Markdown e Layout/Paint. Prima evitare ricostruzioni globali/cap window render e preservare anchor; solo poi virtualizzare altezze variabili con resize, espansione tool e focus.
- **Modello:** visual window separata dalla storia autoritativa; mai perdere fine tool/Ask/errori per ridurre RAM.
- **Costo:** S per esperimento, M/L per virtualizer; costo libreria da misurare bundle e lifecycle, non inventare KB. Rischi: find browser/copia testo cross-window, screen reader, jumping, contenuto multimediale che cresce.
- **Test/accettazione:** carica precedenti mantiene entry/offset anchor; Ask e job visibili anche se fuori finestra; stop non aspetta reveal; benchmark prima/dopo con stessa macchina, anche motion off. Nessuna nuova suite source-text.
- **Rollback:** mantenere algoritmo precedente dietro commit reversibile, non due implementazioni permanenti. Alternativa: windowing attuale con cap e azione esplicita cerca/mostra contesto, se sufficiente.

<a id="r08"></a>
## R08 — Lifecycle sessione e trasporto: rafforzare confini, non riscrivere runtime

Obiettivo: ridurre rischio di regressioni mentre crescono Companion, corsie e remoto. Attuale: registro sessioni, client RPC, reducer/state monolitico e helper puri esistono già; diagnosi canale e stop prioritario sono punti di forza. [TECHNICAL_FINDINGS](TECHNICAL_FINDINGS.md) distingue invarianti provati e rischi.

- File candidati: `session.svelte.ts`, `client.ts`, `sessionRegistry.ts`, `wire.ts`, `src-tauri/src/rpc/`, adapter remoto/Companion **solo** quando dipendono dal confine modificato.
- Riferimenti: [Codex app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server), [OpenHands](https://github.com/OpenHands/OpenHands). Usare envelope tipizzato e ownership; non importare event sourcing generale o nuovo bus.
- Modello proposto: identità sessione/lane/generazione preservata dall'ingresso al comando e all'esito; separare reducer puro per singola famiglia eventi ad alto rischio, mantenendo una sola fonte autoritativa. Nuova persistenza replay solo se protocollo garantisce idempotenza.
- Strategia: prima prova evento tardivo dopo dispose/open e stall IPC; poi estrazione mirata di parsing/lifecycle a helper; rimuovere vecchio ramo al cutover. Non cambiare contemporaneamente serializzazione task, algoritmo merge e stream.
- Costo M/L per rischi concorrenti, zero dipendenze. Rischi: eventi fuori ordine, duplicati, timeout/abort che non liberano risorsa, mirror remoto divergente.
- Test: apertura concorrente, close durante handshake, late response, chunk incompleto, errori trasporto, prompt risolto una sola volta. Smoke reale di piccolo runtime stub temporaneo distingue wire da modello, dichiarandolo esplicitamente.
- Accettazione: nessun frame applicato alla sessione nuova, nessun processo orfano, nessuna attesa infinita su richiesta scaduta, diagnostica distingue runtime da IPC. Beneficio: scenario riproducibile fallisce prima e passa dopo; non LOC ridotte come KPI. Rollback per singola estrazione; alternativa lasciare struttura e aggiungere solo guard generation dove serve.

<a id="r09"></a>
## R09 — Ammissione dei lavori consapevole della quota

**Opportunità originale**, non capacità universalmente assente nei concorrenti. Studio dispone già di quote, reset scheduling, modelli/ruoli, `autoDispatchArbiter` e code; non aggiungere un secondo scheduler.

Desiderato: prima di aprire altra corsia, dire «questi lavori stanno usando questo provider; quota stale/non nota; puoi attendere reset o scegliere ruolo». Non convertire token residui in numero di task garantiti.

- File: `quota/`, `activeQuota.svelte.ts`, `scheduleRunner.svelte.ts`, `lanes/autoDispatchArbiter.ts`, `queueDispatch.ts`, `LaneDispatchDialog.svelte`, `QueueDrawer.svelte`, proiezioni Companion/remoto.
- Riferimenti: [Codex worktrees/automations](https://developers.openai.com/codex/environments/git-worktrees), [Roo modes](https://github.com/RooCodeInc/Roo-Code) come riferimento storico, non dipendenza mantenuta.
- Stato: età dato, provider/account/ruolo, cause di blocco già esistenti; decisione atomica dal solo owner dispatch. Risorse note vs stima separate.
- Strategia: avviso informativo prima; nessuna selezione modello silenziosa, nessuna preemption lavoro utente, niente costo extra LLM per stimare costo.
- Complessità L per concorrenza e privacy account; zero dipendenze iniziali. Test: due dispatch simultanei, dato stale, quota sconosciuta, reset mentre offline, ruolo cambiato durante attesa.
- Accettazione: nessuna duplicazione task, zero-cost preservato, utente distingue stima da blocco reale; auto-avvio non scatta se background pending. Beneficio da prova su fixture di code/provider, poi sessioni reali; rollback mantiene scheduling attuale e ignora advisor. Alternativa semplice: mostrare quota e numero agenti nel dialog esistente.

<a id="r10"></a>
## R10 — Handoff Lab → implementazione con provenienza verificabile

**Opportunità originale incrementale:** Lab ha già revisioni, annotazioni e tool `corsia_consegna`; non ricreare handoff o copiare automaticamente React nel progetto Svelte.

Desiderato: pacchetto consegna con revisione selezionata, screenshot/annotazioni riferiti a quella revisione, comportamento simulato vs reale, componenti da riusare nel target e criteri di accettazione eseguibili. Alla nuova revisione dichiarare obsolete le note precedenti invece di applicarle a file spostati.

- File: `src/lib/lab/visualNotes.ts`, `visualNotesStore.svelte.ts`, `catalog.ts`, `LabPreview.svelte`, `src/lib/lanes/laneActions.ts`, tool bridge `src-tauri/src/lane_bridge.rs` e moduli Lab scoperti dal percorso reale. Riusare revisione Git e payload consegna esistenti.
- Riferimenti: [Cursor prove allegate](https://cursor.com/help/ai-features/background-agents), [Zed review](https://zed.dev/parallel-agents); proposta propria sul contratto di prototipo, non copia asset.
- Stato: revision/source-location/capture riferiti alla stessa revisione, elenco simulazioni e capacità reali. No esecuzione automatica di istruzioni contenute nell'anteprima.
- Strategia: validare revisione nel backend al momento consegna, manifest minimale, task implementazione nel target con stack rilevato; approvazione esplicita del cutover, review evidenze R05 quando disponibile.
- Costo M/L per compatibilità revisione e trasporto screenshot, zero librerie nuove. Rischi: nota stale, source map non valida, allegati privati, confusione mock/produzione.
- Test/accettazione: nota r1 non attribuita a r2, workspace Lab immutato da implementazione target, payload dichiara dati simulati, Svelte target non riceve React come code dump. Misura: stessa consegna produce criteri rintracciabili senza ricerca manuale della revisione; nessuna promessa di generazione full-stack. Rollback conserva pacchetti già consegnati e non rimuove revisioni. Alternativa: manifest testuale con revisione e limiti, senza nuova vista.

<a id="r11"></a>
## R11 — Bounds del PTY e consumo del terminale

1. **Obiettivo:** output sostenuto non faccia crescere backlog senza limite né renda impossibile fermare la sessione.
2. **Attuale SRC:** `src-tauri/src/pty/mod.rs:782-834` mpsc senza capacità e cap256KiB per messaggio; `src/lib/terminal/terminal.ts:489-577` batching64KiB/rAF/timer16ms, term.write senza ACK del parsing. Saturazione non esercitata qui.
3. **Desiderato:** memoria degli stadi limitata e osservabile, backpressure reale oppure policy esplicita di overflow, nessuna perdita silenziosa.
4. **Riferimento:** [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/), sorgente storico [C05](IMPROVEMENT_OPPORTUNITIES.md#c05); le soglie dell'esempio non sono parametri automaticamente validi per Studio.
5. **File:** PTY Rust, `terminal.ts`, comandi IPC per eventuale ACK e cleanup; `process_tree.rs` solo se il contratto di shutdown lo richiede. Riusare perf/diagnostica e owner PTY, non creare supervisore parallelo.
6. **Componenti nuovi:** nessuna nuova vista necessaria; helper/counter solo nei confini del trasporto.
7. **Stato:** bytes prodotti/inviati/consumati, generazione PTY, watermark alto/basso e closed. Contatori in byte coerenti, non confondere string length UTF16 e UTF8.
8. **Strategia:** probe finito con consumer deliberatamente rallentato; individuare dove accumula; bound Rust con chiusura cancellabile; se insufficiente ACK dal callback write a lotti e propagazione verso reader. Non bloccare mentre si possiede lock globale, non pausare ogni singolo chunk.
9. **Costo/dipendenze:** M/L per protocollo/lifecycle, std esistente e xterm già presente; niente libreria nuova.
10. **Rischi:** ACK perso/doppio, deadlock consumer nascosto, EOF prima flush, close che lascia thread fermo, UTF8/ANSI spezzati; bounded Rust da solo sposta backlog su IPC.
11. **Test:** producer finito più veloce del consumer, riordino vietato, callback lento, cancel/close/dispose durante attesa e generazione nuova.
12. **Accettazione:** output esatto nello scenario lossless; coda entro bound misurato; stop/input accessibili; chiusura sblocca attese senza processi orfani.
13. **Beneficio da dimostrare:** RSS/backlog e latenza input prima/dopo a parità di fixture/macchina, non throughput teorico del vendor.
14. **Rollback:** protocollo interno cambia con tutti i caller nello stesso commit; revert conserva output/sessioni, nessuna migrazione dati.
15. **Alternativa minima:** bound Rust e diagnostica se probe dimostra che gli altri stadi consumano abbastanza; nessun ACK nuovo senza bisogno.

<a id="r12"></a>
## R12 — Cap della riga fisica RPC prima del parsing

1. **Obiettivo:** output runtime malformato non accumuli una linea arbitrariamente lunga prima di qualsiasi limite.
2. **Attuale SRC:** `rpc/mod.rs:466-495` read_until in Vec prima di decode/reassemble; cap64MiB controlla frame logico/chunk più avanti.
3. **Desiderato:** framing incrementale byte-bounded; limite per handshake e poi capacità negoziata, distinto dalla ricomposizione.
4. **Fonte:** riscontro locale [T02](TECHNICAL_FINDINGS.md#t02); proposta originale, non copiata da un concorrente che usa protocollo diverso.
5. **File:** `src-tauri/src/rpc/mod.rs` o modulo reader esistente se separabile; fixtures wire/Rust test pertinenti; `client.ts` solo se cambia evento errore.
6. **Riuso/componenti:** error frame e process cleanup esistenti; helper puro di framing per test, nessun package protocollo nuovo.
7. **Stato:** bytes della linea corrente e limite accettato; envelope/capability validati. Non usare la capacità iniziale del Vec come presunto tetto.
8. **Strategia:** leggere fino al prossimo separatore entro cap, overflow esplicito con close/reset definito; aggiornare limite dopo ready solo entro limiti locali sicuri. Non troncare e tentare JSON parse su payload parziale.
9. **Costo/dipendenze:** M, Rust std esistente, niente libreria nuova.
10. **Rischi:** limitare frame validi dei runtime vecchi, base64 envelope, EOF senza newline e UTF8 spezzato; handshake che promette cap eccessivo.
11. **Test:** cap-1/cap/cap+1 in byte, senza newline, multibyte, newline tardivo, sequenza rpc_chunk valida, abort/EOF.
12. **Accettazione:** sopra cap memoria non cresce ulteriormente per quella riga, errore diagnostico non finto evento; frame validi e ordering/end/Ask invariati.
13. **Prova beneficio:** producer malformato isolato e finito, memoria/errore osservati; non inviare fault alla sessione dell'utente.
14. **Rollback:** revert reader e contratto errore insieme, nessuna migrazione dati; no parser legacy duplicato permanente.
15. **Alternativa:** limite iniziale conservativo esplicito senza negoziazione dinamica solo se compatibilità dimostrata; non adottare un numero arbitrario dal tetto logico64MiB.

## Cosa non entra nella roadmap

1. **Fork di VS Code / riscrittura GPUI:** non risolve attriti della sessione e amplia enormemente manutenzione. Archiviazione Void/Roo/Continue non dimostra da sola la causa del fallimento dei progetti.
2. **Shadow Git generalizzato per tool-call:** non adottare rinomina `.git` o rollback che sovrascrive modifiche umane. Le corsie e undo integrazione esistenti sono base migliore; non chiamarle sandbox di sicurezza.
3. **Repo-map Tree-sitter/PageRank dentro Studio subito:** interessante Aider, ma Studio non è il runtime di agente; duplica prewalk/context. Prima R06 con strumenti esistenti; se serve capacità nuova, proporla al runtime omp.
4. **Palette globale e marketplace:** anti-riferimenti espliciti PRODUCT. Migliorare comandi slash/azioni contestuali già presenti.
5. **Animazioni aggiunte a ogni delta:** blur/fold già ricchi; misurare e possibilmente ridurre, mai animare terminale.
6. **Retry automatici per operazioni mutative:** rischio duplicazione/spostamento ref. Errore esplicito, stato reale e ripresa guidata.
7. **Copia automatica `.env` o provisioning cloud gestito:** consenso sui file locali e impostazione local-first restano invarianti.
8. **Dashboard costi aziendale:** il prodotto risponde a quota/reset. Un advisor locale trasparente può essere utile, non una piattaforma analytics.

## Verifica della roadmap

Questi piani non sono stime di delivery. Prima di autorizzare R05/R08/R09 occorre confermare capability/versione runtime ospitato e protocollo. Desktop smoke significativo deve usare l'istanza già aperta o una prova browser dichiaratamente limitata; mai avviare seconda Tauri. Ogni fase lascia una capacità completa e reversibile, non uno scaffold. Le assenze di benchmark/telemetria e la superficie nativa non esercitata restano esplicite nei documenti di audit.
