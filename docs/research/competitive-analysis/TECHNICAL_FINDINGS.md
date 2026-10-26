# Technical findings — architettura e implementazioni

**2026-10-25, Studio1.8.0.** Audit di ricerca del working tree. Nessun refactoring, dipendenza o test permanente aggiunto. **SRC** codice letto, **DOC** documento, **OBS** prova eseguita, **ISSUE** segnalazione esterna, **INF** conseguenza da verificare, **PROP** proposta. La presenza di un rischio nel codice non prova un incidente reale.

## 1. Mappa tecnica attuale

| Confine | Implementazione/proprietario | Contratto importante |
|---|---|---|
| Shell | `src/routes/+page.svelte`, componenti Svelte5, `app.css`, store rune | Monta superfici e collega comandi; non è un IDE generico né runtime LLM |
| Identità | `sessionRegistry.ts:71-153`, `sessionKeys.ts`, `laneOrchestrator.svelte.ts` | Chiave progetto+corsia; cwd immutabile per sessione; registro separato dal processo |
| Stato agente | `AgentSession` in `session.svelte.ts`, helper di piano/Ask/settle/queue/btw | Sessione autoritativa, transcript/bozza/eventi; proiezioni Companion/remoto non nuovi owner |
| IPC GUI | `client.ts`, `wire.ts`, `src-tauri/src/rpc/mod.rs` | Richieste correlate per id, stdio NDJSON, chunk protocollo, eventi delta coalesciati |
| TUI | `src/lib/terminal/terminal.ts`, `src-tauri/src/pty/mod.rs` | Terminale xterm6 nativo di `omp`, PTY reale; cambio superficie è riavvio/resume |
| Processi | `process_tree.rs`, registro per corsia, adapter PTY/RPC | Termina alberi posseduti, non PID cercati per nome; Job Objects Windows ≠ sandbox |
| Task | `tasks.svelte.ts`, `taskHydration.ts`, `taskSerialization.ts`, Rust `projects/tasks.rs` | `.omp/tasks.json` solo radice canonica; leggere prima di scrivere; reload disco autoritativo salvo dispatch in volo |
| Corsie/Git | `lanes.svelte.ts`, `lanePersistence.ts`, Rust `projects/worktrees/` | Worktree/branch separati, gate backend, integrazione e undo; niente modifiche target in conflitto |
| Editor | Monaco e `Editor.svelte`, `monaco.ts` | Modelli e diff, buffer dirty/cursore; superficie di ispezione, non fork VS Code |
| Browser/Lab | `browser-live.ts`, `BrowserViewer`, `src/lib/lab/` e backend dedicati | Takeover/private e prototype revisionati; sicurezza specifica del confine, non garanzia su tutto host |
| Persistenza configurazioni | `fs_atomic.rs`, plugin-store, schema code/corsie | Temp nello stesso filesystem, replace; atomicità file non sostituisce concorrenza logica |
| Diagnostica | `diagnostics/`, `studio_log.rs`, `perf.ts`, diagnosi RPC | Log vita e trace tempi distinti, limiti e batching; non telemetria SaaS |
| Suite | `scripts/run-smoke-tests.mjs`, `test/`, Rust test | Node type-stripping, shim rune per helper, non montaggio interattivo Svelte |

**Stack SRC `package.json`:** TypeScript/Svelte5, SvelteKit con adapter-static e Vite6, Tauri2/Rust, Monaco0.56, xterm6; marked, DOMPurify, Mermaid; esbuild-wasm nel Lab. Nessuna ragione emersa per sostituire lo stack. La separazione UI/trasporto/Git è già utile; dimensione di un file non è da sola prova di cattivo design.

### Invarianti di prodotto

- DOC `PRODUCT:128-159`: shell dell'agente, non nuovo agent harness/IDE estensibile; shortcut TUI non catturate.
- SRC `laneOrchestrator:433-483`: una sola superficie/processo per corsia, Lab GUI-only; sessione persistita condivisa, strumenti effimeri no.
- SRC `sessionRegistry:127-132`: sessione con stessa chiave e cwd diverso rifiutata, prevenzione di routing ambiguo.
- SRC `queueDispatch:94-104`: coda ancorata alla radice canonica, non al worktree visibile. Non introdurre un secondo task store per corsia.
- SRC `autoDispatchArbiter:11-32,43-63`: quiete/stabilità, snapshot autorevole, lock per progetto e cooldown. Non basta un frame idle.

## 2. Riscontri e opportunità

<a id="t01"></a>
### T01 — PTY: batching efficiente, backpressure non end-to-end

**SRC:** `src-tauri/src/pty/mod.rs:782-834` usa `std::sync::mpsc::channel::<Vec<u8>>()`, senza capacità; reader64 KiB fa `to_vec` e send, forwarder aggrega fino256 KiB e invia IPC. Il limite256 KiB vale **per messaggio**, non per la coda. `terminal.ts:489-577` accumula fino64 KiB o rAF/timer16 ms, poi `term.write` senza callback di consumo nei rami letti.

**Conclusione SRC:** esistono batching e cap del lotto, non un limite dimostrato sul backlog produttore→IPC→parser xterm. **INF:** con produttore sostenuto più veloce del consumer, memoria e input possono peggiorare; non è stato riprodotto un leak/crash desktop. Non usare «zero latency» del commento come misura.

**Confronto sorgente:** [xterm WriteBuffer, SHA7f598a3](https://github.com/xtermjs/xterm.js/blob/7f598a36753f4d950ee63dc91bd6a92290f7e037/src/common/input/WriteBuffer.ts), MIT, implementazione storica collegata dalla [guida flow control](https://xtermjs.org/docs/guides/flowcontrol/): write è asincrono, callback solo dopo action, time slicing12 ms e pending bytes. Soglia50MB di quel commit non attestata sullo xterm6 installato. Guida propone high/low watermark e ACK batch, avverte pause per ogni chunk inefficienti e rischio deadlock da conteggi incoerenti.

**PROP O19:** prima misurare bytes pending per stadio su producer finito/consumer rallentato; poi coda bounded cancellabile in Rust e, se IPC/xterm resta collo di bottiglia, ACK del consumo con watermark. Non scartare ANSI a caso, non cambiare renderer per mascherare backlog, non tenere un lock del manager mentre si attende capacità.

**Costo/rischio:** M/L, shutdown/EOF/abort devono sbloccare reader e forwarder; bounded Rust da solo può spostare backlog sul Channel. Buffer copy necessaria fra thread va misurata, non «zero-copy» inventato. Possibile soluzione minima: capacità Rust osservata e probe per verificare se basta, senza nuovo protocollo ACK.

**Verifica futura:** stream finito con UTF-8 spezzato/ANSI, consumer lento e lane nascosta, byte esatti/ordine conservati; input/stop ancora reattivi; close termina ogni attesa e processo. Stessa macchina, misurare RSS/backlog, niente benchmark di throughput del vendor trasferito.

<a id="t02"></a>
### T02 — RPC: limite del frame ricomposto non limita la riga fisica

**SRC:** `rpc/mod.rs:466-495` `BufReader`64 KiB e `raw:Vec` iniziale64 KiB; `read_until('\n',&mut raw)` completa la riga prima del decode. `MAX_REASSEMBLED_BYTES=67_108_864` è controllato in `reassemble` (`:611-669`) dopo ingresso/parsing del chunk. Capacità iniziale del Vec non è tetto.

**Conclusione SRC:** non risulta un cap dell'accumulo della singola linea nel ciclo letto. **INF:** runtime guasto o output malformato molto lungo/senza newline può allocare oltre limiti dei frame logici. Non prova exploit remoto o errore del runtime normale; processi ospitati restano la fonte del dato.

**PROP O20:** framing fisico incrementale con tetto concordato sulla capability maxFrameBytes e margine envelope, distinto da ricomposizione logica; on overflow errore di trasporto esplicito e reset/close definito, mai troncamento che trasforma un payload in altro JSON valido. Proteggere handshake prima della negoziazione con limite iniziale ragionevole documentato, non copiare64MiB su ogni stadio.

**Riferimento/adattamento:** Codex [C01](IMPROVEMENT_OPPORTUNITIES.md#c01) dimostra separazione admission/drain, non è un esempio di cap byte; xterm [C05](IMPROVEMENT_OPPORTUNITIES.md#c05) mostra limite risorsa come confine distinto. La proposta di framing è nostra.

**Costo/rischio:** M; compatibilità runtime/frame validi, UTF-8 multibyte, chunk base64, EOF senza newline e chiusura processi. Il raw frame massimo non deve essere inferito dal numero di caratteri JS.

**Accettazione:** input finito senza newline oltre cap non cresce ulteriormente e produce diagnostica, frame valido al limite passa, sequence chunk valida produce stesso evento; boundary/errori non perdono Ask o risposte terminali. Prima probe del parser isolato, non inviare payload ostile alla sessione desktop dell'utente.

<a id="t03"></a>
### T03 — Coalescenza delta: due livelli e un limite temporale non assoluto

**SRC Rust:** `rpc/mod.rs:709-762` coalescenza per kind+content index, flush quando arriva altro delta dopo8 ms o frame non-delta/end. Nessun timer indipendente: un delta isolato prima di una pausa può restare fino al prossimo frame. È trade-off di latenza, non necessariamente bug.

**SRC frontend:** `wire.ts:696-779` `StreamBatcher`, key kind:index, default4096 caratteri, rAF con timer fallback **32 ms**, non16 indicato dal commento. `session.svelte.ts:3679-3700` applica soltanto streaming/nonaborting e inoltra delta ai listener remoti quando presenti. `AssistantText.svelte:36-79` limita lexing a48 ms e fa cleanup timer/scheduler.

**Forza:** riduce IPC/reactivity/Markdown, preserva flush prima di end, evita reveal su statico. Non provare O(n²) evitato globalmente dai soli8 ms: `existing.text += delta` e parse del testo completo restano operazioni da profilare.

**PROP O05/O17:** traccia receive→batch flush→parse→paint, incluso primo delta seguito da pausa e pagina nascosta. Cambiare finestra solo sullo stadio provato bottleneck; timer separato Rust solo se latenza isolata influisce davvero. Contatore byte/char e mantenimento ordering richiedono invarianti esplicite.

**Accettazione:** end vede tutto testo, abort non riapplica batch precedente, toolcall Ask preview non aspetta fine argomenti, nessuna attesa indefinita frontend in hidden. Niente riscrittura dello streaming senza scenario riproducibile.

<a id="t04"></a>
### T04 — Transcript: windowing del DOM, non limite della storia

**SRC `transcriptWindow.ts:9-33`:**300 entry iniziali, incrementi a blocchi, slice/copia. `Transcript.svelte` raggruppa/todo/diff su entry visibili. Il numero renderizzato aumenta quando si carica lo storico: non virtualizzazione fissa; memoria entries della sessione indipendente.

**PROP O17/R07:** baseline prima di TanStack. Misurare derivazioni del gruppo, parsing e DOM separatamente. Prima riuso di finestre/anchor, successivamente virtualizer se serve. Nessuna cancellazione di storia autoritativa per ottimizzare viewport.

**Trade-off:** virtualizzazione altezze variabili può rompere copia/search browser, screen reader, tool espanso e scroll. Alternativa più semplice: windowing esistente con cap navigabile e ricerca contestuale. Benchmark richiesto300/3000/30000 entry, no conclusione «lento» senza trace.

<a id="t05"></a>
### T05 — Lifecycle: protezioni epoch già presenti, non nuova race inventata

**SRC `client.ts:133-172,174-211`:** ogni apertura incrementa `openEpoch`; channel vecchio ignorato; apertura superata/chiusa che risolve tardi richiude il nuovo rpcId. `send:225-257` correla richieste id, timeout per categoria, errori transport espliciti. `sessionRegistry.ts:127-132` impedisce cambio cwd sulla stessa chiave. `AgentSession:1382,1410` usa attachGeneration.

**Confronto SRC:** [Codex ConnectionRpcGate](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server/src/connection_rpc_gate.rs), Apache2: run acquisisce token TaskTracker sotto mutex se accepting/auth corrente, poi attende fuori mutex; close stop admission, shutdown drain. È meccanismo diverso e complementare agli epoch Studio, non prova che Studio debba importarlo.

**PROP O12/R08:** conservare epoch, chiarire ownership e fasi close/drain solo dove nuove race sono dimostrate; una famiglia di reducer/effetti alla volta. `AgentSession` accoppia trasporto, transcript, startup prompt e proiezioni, ma molti helper già separano responsabilità (`SessionBtw`, suggestions, settle, plan). Non sostituire con FSM framework o event sourcing generale.

**Test/accettazione:** apertura A lenta, B successiva, A tardiva, close durante handshake, autenticazione/capability cambiate e late events: nessun evento A in B e nessun processo orfano. Suite contiene `rpc-open-lifecycle`, non prova ogni percorso nativo. Un nuovo test deve catturare una race plausibile, non assert su import/file-size.

<a id="t06"></a>
### T06 — Code task: buoni confini di idratazione e persistenza

**SRC:** `tasks.svelte.ts:104-167` legge store legacy senza sovrascrivere code già idratate, attende projectStore; `loadProject:175-197` passa da `QueueHydration`. `taskHydration.ts:16-74` condivide tentativo per chiave, marca hydrated solo su esito corrente, epoch invalidata da forget; `mergeReloadedTasks:94-109` conserva dispatching ma disco prevale su rimozioni esterne. Non reintrodurre task eliminati dalla TUI.

**SRC backend:** `projects/tasks.rs:95-119` usa `fs_atomic::atomic_write` e registra timestamp scrittura prima di watcher; root queue definita dal routing. `fs_atomic.rs:22-49,129-144` temp create_new con0600 Unix, write/flush/sync_all, replace o cleanup. POSIX preserva permessi e rename; Windows ReplaceFileW.

**Forza:** idratazione prima di save, writer comune e parser/versione, eccezioni visibili invece di default distruttivo. Atomicità file non prova merge concorrente tra due processi: se futuro editing concorrente richiede CAS/revision bisogna misurare il caso, non aggiungere database per principio.

**PROP:** O02 deve usare lo stesso stile di owner/flush e metadata additive, non una scrittura localStorage parallela; O13 non deve bypassare dispatching. In fault injection valutare anche failure del watcher/errore store, non solo happy path. Nessuna migrazione SQLite proposta per tasks.

**Limite di garanzia:** sync del file e rename non dimostrano durabilità contro ogni power-loss/filesystem; nessuna prova fsync directory su POSIX nel percorso letto. Descrivere crash-safety entro garanzie OS, non «impossibile perdere dati» assoluto.

<a id="t07"></a>
### T07 — Git integration: preservare algoritmi e gate backend

**SRC:** `lane_integrate.rs` definisce outcome discriminati `Integrated/AlreadyIntegrated/Conflicts/Queued/Nothing`, args deny_unknown_fields, controllo Git2.38 (`:169-185`), porcelain -z e ls-files -u (`:198-232`). `update_ref:436-450` passa old SHA per CAS; `merge_tree_write:1204-1237` distingue clean/conflict/error e valida OID; `:1542-1640` verifica checkout/conflicts/overlap, applica CAS, scrive ricevuta, sincronizza e tenta rollback dei ref/checkout su failure. Questi controlli sono codice letto, non prova end-to-end di tutte le race.

**Forza:** compute merge fuori target e separazione conflitto/atterraggio/undo sono più pertinenti di snapshot per ogni tool-call. `integrationGate.ts:33-64` è gate UX; backend possiede i controlli di mutazione. Target dirty non sovrapposto può essere preservato: vecchie docs con «target sempre pulito/mai merge automatico» non sono contratto corrente.

**Confronto:** Cline [sdk-checkpoints](https://github.com/cline/cline/blob/9beea0300bb0c5125451cb8e0858d1bbd8898208/apps/vscode/src/sdk/sdk-checkpoints.ts) associa run di messaggi, non fa lo stesso merge. [Issue4388](https://github.com/cline/cline/issues/4388)2025 racconta rischi di rename nested Git; non attribuirli al file attuale letto o chiamare Studio immune da ogni errore Git.

**PROP O09/O15:** conservare pipeline e aggiungere, separatamente, evidence receipt. Undo integrazione non è undo conversazione, nemmeno sandbox. Non introdurre reset hard indiscriminato: il percorso attuale `sync_checkout:793-826` lo usa dopo controlli di checkout/stato, mentre `sync_checkout_preserving:829-855` usa read-tree per dirty disgiunti.

**Verifica futura:** target avanti, dirty sovrapposto/non sovrapposto, ref cambiato durante integrazione, crash in ogni fase, conflitto e conferma umana, undo dopo modifica successiva. Non eseguito merge sul repository in questa ricerca.

<a id="t08"></a>
### T08 — Review evidence: esito vero, revisione non attestata

`commandEvidence.ts:11-59` estrae command/exit/durata/isError/running e snippet300 caratteri; se exit assente non lo inventa. `LaneReviewModal:149-157` ricava dalla sessione viva. Non c'è fingerprint del codice verificato nel record.

**PROP O15/R05:** snapshot before/after comando, HEAD **e dirty/untracked rilevanti**, lane/session/cwd/artifact; stati valida/scaduta/sconosciuta. Se il codice cambia dopo test, cambiare etichetta non cancellare storia. Se runtime non espone revisione attendibile, dichiarare sconosciuto.

**Confronto DOC:** [Cursor](https://cursor.com/help/ai-features/background-agents) allega prove alla PR; [Aider](https://aider.chat/docs/usage/lint-test.html) verifica dopo edit; [Claude](https://code.claude.com/docs/en/best-practices#give-claude-a-way-to-verify-its-work) chiede verifica e output. Nessuna di queste pagine prova automaticamente fingerprint transazionale: adattamento più rigoroso è proposta propria.

**Trade-off:** snapshot può costare e fallire con tool background; HEAD-only insufficiente, log può contenere segreti. Soluzione minima immediata: «comando nel transcript, attualità non attestata», senza falso verde. Test successo→edit, comando altra corsia, exit ignoto, reload senza sessione montata.

<a id="t09"></a>
### T09 — Context: ownership prima dell'indice

**SRC:** `promptPreflight.ts:28-37,106-225` inietta dipendenze search/Git/timeout ed estrae candidati literal fino8 con limiti; `editorContext` e file mention già integrati. Non manca ogni context injection.

**Confronto SRC Aider:** [repomap.py](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py), Apache2, costruttore1024 token, cache mtime, Tree-sitter/Pygments, personalization menzioni e PageRank. Token su testo lungo stimati da campione; cache non snapshot transazionale. Algoritmo utile al runtime, non automaticamente alla shell.

**PROP O16 prima di O07:** manifest per invio dal payload reale, provenienza editor/disco/corsia e stime esplicite. Evitare altro indice AST/Git status polling nello shell finché task/benchmark non mostrano necessità. Test invio dopo cambio corsia, buffer dirty, deadline search e bozza su failure.

<a id="t10"></a>
### T10 — Quota: stato unknown distinto da zero/recovery, non modello cambiato di nascosto

**SRC locale:** `quota.svelte.ts:240-244` polling adattivo, `:348-350` dismiss episodi, `:447-450` warning; `usageResets:581-612` chiave account/scadenza; `quotaRecovery:123-126` raccomandazione evita modello fallito e quote zero. O08/O13 non devono rifare quanto esiste.

**Confronto SRC VS Code:** [chatQuotaNotification.ts](https://github.com/microsoft/vscode/blob/b208bc2501cdd0285e47951603d0c1059c6fb2f7/src/vs/workbench/contrib/chat/browser/chatQuotaNotification.ts), header MIT, baseline primo campione, crossing e priorità; dismiss exhausted persistente ripulito solo da snapshot reale recuperato. Proposta SwitchToModel è azione del banner, non fallback automatico. Soglie50/75/90/95 non da copiare senza ragione.

**PROP:** consolidare freshness/account episode e advisor nel gate esistente, non predire costo task con falsa precisione; no nuovo scheduler. Prova deterministica snapshot assente, exhausted, dismiss, reload, account nuovo e reset; visuale non deve trattare unknown come0 o recuperato.

<a id="t11"></a>
### T11 — Diagnostica già concreta; limiti del logging non equivalgono a privacy totale

**SRC `studioLog.ts`:** batch1 s, max500 pending, error flush immediato, conto dropped e snapshot provider; `capture.svelte.ts:20-24,50-111`: errore/unhandled rejection/console, snapshot di focus/layer, longtask oltre1000 ms. `studio_log.rs:21-25,85-122` rotazione4MiB e trunc riga8Ki caratteri. `perf.ts:15-39` batch2 s/128 righe, stessa scala tempi del backend.

**Forza:** osservabilità cross-boundary, no nuove metriche SaaS; non chiamarla assente. `client.ts` tally e hang report distingue IPC fermo da runtime.

**Limiti:** metrica longtask1000 ms non vede tutti i frame mancati; `sanitize` appiattisce/tronca, **non redige segreti**. Non è stato dimostrato che token vengano loggati, ma console capture può ricevere testi arbitrari; prima di export condivisibile fare review del payload. Il sink Rust usa `mpsc::channel` per logging: limite file non prova limite backlog. Meno critico del PTY per ritmo naturale ma va incluso nella stessa misura di risorse, non allarmismo di leak.

**PROP:** usare perf esistente per O05/O17/O19 e metadata minima; prova redaction con segreti sintetici, mai dati reali; export solo esplicito con preview. Non nuova telemetria né logging del prompt integrale per comodità. Nessuna modifica al logger proposta senza caso concreto.

<a id="t12"></a>
### T12 — Suite forte sui contratti puri, limite dichiarato sulla reattività UI

**SRC:** runner importa aggregatore e rifiuta file test orfani; Node strip-types + alias; `test/runes-shim.mjs:1-24` `$state` identità, `$derived` una volta, `$effect` no-op. Questo è appropriato per parser/helper, **non esercita grafo reattivo Svelte, layout, focus o Tauri nativo**. Un test testo sorgente/prop forwarding non prova un workflow.

**OBS baseline:** `npm test` eseguito:1346 test,1345 pass,0 fail,1 skipped,338 suite. Skip fixture browser-live perché checkout runtime assente. Output conteneva `window is not defined` del GitHubStore e scenari di errore disco/timeout/RPC hang, ma runner exit0 e zero failure. Non dichiarare output privo di warning né trattare la suite come benchmark desktop.

**OBS runtime:** Vite avviato e root Chromium caricata; fallisce dipendenza metadata Tauri in TopBar. È limite ambiente browser senza bridge, non bug desktop. Helper `anchoredPopover` reale esercitato su DOM isolato, dati nell'[audit](UI_UX_MOTION_AUDIT.md#metodo-prove-e-limiti). Nessuna seconda istanza Tauri, nessun modello chiamato per test.

**PROP:** per le future modifiche smoke reale sull'istanza già aperta e uno scenario mirato; per helper test deterministico con fake clock/I/O, non mock che ripete il risultato. Non serve introdurre ora una suite completa diversa per questa ricerca documentale. Native multi-OS/VoiceOver/benchmark restano non verificati.

## 3. Derive documentali osservate

| Documento/affermazione | Codice corrente o evidenza | Decisione |
|---|---|---|
| ARCHITECTURE:85-86 PTY batching8 ms, trunc vecchio oltre1MiB | PTY:782-834 mpsc non bounded, batching256KiB per messaggio senza timer8 ms nel percorso | Rettificare docs durante lavoro O19; non ripetere promessa di backpressure già implementata |
| PRODUCT:135/diagramma architettura parla Canvas terminale | package xterm6 e architettura:35-37 dice DOM; frontend nessun renderer Canvas aggiunto nel percorso letto | Distinguere versioni e renderer effettivo; nessuna stima RAM dal renderer |
| PRODUCT:234 larghezze persistenti per progetto | Route:3049-3245 solo state locale | O02 completa comportamento, non semplice cambio copy |
| Vecchio DECISIONS:1081-1084 nessun auto-merge/target sempre pulito | PRODUCT:77 e gate attuale/backend consentono flusso agentico e dirty non sovrapposto | Storico decisioni deve essere marcato superato/collegato, non rimosso indiscriminatamente |
| Commento StreamBatcher fallback~16 ms | `wire.ts:737-744` fallback32 ms | Dato di implementazione; non correzione funzionale richiesta in ricerca |
| PRODUCT:192-194 riferimento `/chat-bench`, `src/lib/agent/bench/scenarios.ts` | Route/glob non trova banco o percorso | Riferimento documentale non accessibile nel checkout, non prova feature runtime attiva |
| ARCHITECTURE intestazione release1.0, package1.8 | Documento ha sezioni aggiornate e storico | Non usare versione intestazione per dedurre intero inventario; sorgente e contratti prevalgono |

Nessuna di queste docs di prodotto viene cambiata qui: scope richiesto sono cinque deliverable di ricerca, evitando riscrittura non autorizzata dello storico decisionale.

## 4. Refactoring e dipendenze: decisioni

1. **Preservare helper puri e dependency seams esistenti.** QueueHydration, AutoDispatchArbiter, TwoStepStop, reveal engine, gate e parsing hanno testabilità senza framework. DI appropriata su clock/I/O, non container DI generale.
2. **Refactoring mirato della sessione, non riscrittura.** Trasporto/correlazione nel client, domain helpers per singola famiglia, effetti nella sessione/superficie. OpenHands issue15061 è un avvertimento contro provider gonfi e duplicati, non un ordine di replicare Effect[] in ogni feature.
3. **Ridurre copie solo dove misurate.** PTY richiede possesso buffer fra thread e concatenazione per parser; sostituire con pool/zero-copy generalizzato aumenta lifetime/locking. Prima bounds, poi copie calde da trace.
4. **Niente nuovo renderer/virtualizer subito.** WebGL ha vincoli WebView/driver, virtualizer ha vincoli focus/copia; riportati come alternative condizionali, non default.
5. **Niente nuovo bus o DB per configurazioni.** Ownership/correlazione/revisioni additive sono più semplici di event sourcing o stato distribuito.
6. **Niente riuso letterale GPL dal core Zed in progetto MIT.** Zed root primariamente GPL3-or-later con componenti Apache dove marcati. Studiare pattern e reimplementare originariamente; Cline/Codex/Aider Apache2 e VS Code/xterm MIT comunque richiedono notices/licenze se copiati. Non copiato codice in questa ricerca.

## 5. Cinque miglioramenti tecnici da valutare per primi

| Ordine tecnico | Miglioramento | Perché, confidenza e limite |
|---|---|---|
| 1 | O19 bounds PTY/consumer e misure end-to-end | Coda senza capacità e write non ACK confermati; saturazione reale da esercitare in ambiente isolato |
| 2 | O20 framing fisico RPC prima dell'allocazione non limitata | Limite chunk attuale non limita read_until; runtime malformato come fault case, non exploit dimostrato |
| 3 | O15 receipt di verifica revisionata | Gap del record confermato; fiducia nelle integrazioni con costo snapshot da definire |
| 4 | O17/O05 render lungo e motion su baseline | Costo strutturale noto, jank non misurato; prima profiling con perf esistente |
| 5 | O02 geometria con owner/flush unici | Feature visibile ma buon esempio di stato e persistenza coerenti, non altro localStorage parallelo |

O12 rimane investimento condizionale di manutenibilità: epoch e lifecycle protection esistono già. Non è una ragione per rimandare i primi tre interventi UX piccoli raccomandati nella [roadmap](IMPLEMENTATION_ROADMAP.md).

## 6. Registro verifiche e limiti

Eseguiti: suite npm baseline, avvio Vite, osservazione Chromium/screenshot root e probe reale geometria helper. Letti: quattro implementazioni OSS e licenze con SHA nel [registro C01-C04](IMPROVEMENT_OPPORTUNITIES.md#registro-implementazioni-oss-esaminate), più xterm storico C05; fonti ufficiali e issue esplicitamente etichettate. Non eseguiti: cargo check/test, benchmark/heap profile, build produzione, test saturazione PTY o input RPC ostile, merge/rollback su repository utente, app concorrenti live. Nessuna promessa di sicurezza/performance basata soltanto sui commenti.
