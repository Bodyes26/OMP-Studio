# Opportunità di miglioramento — backlog valutato

**Rilevazione2026-10-25 — Studio1.8.0.**20 opportunità valutate; non20 nuove feature da sviluppare. Alcune sono consolidamenti, alcune da preservare o rifiutare. Nessuna implementazione autorizzata. Collegamenti: [landscape](COMPETITIVE_LANDSCAPE.md), [tecnica](TECHNICAL_FINDINGS.md), [UI](UI_UX_MOTION_AUDIT.md), [roadmap](IMPLEMENTATION_ROADMAP.md#top10).

## Evidenza e metodo di priorità

**SRC** codice letto, **DOC** fonte ufficiale, **OBS** scenario esercitato, **ISSUE** segnalazione non universalizzabile, **INF** rischio/inferenza, **PROP** adattamento proposto. Confidenza nella diagnosi distinta dal beneficio atteso. Frequenza deriva dal workflow documentato, **non** da telemetria: il progetto non fornisce misure d'uso o testimonianze rappresentative.

Classi di sforzo: **S** modifica locale senza nuovo schema; **M** più superfici o persistenza; **L** protocollo/concorrenza/nuovo sottosistema. Priorità **prima**=raccomandata nella tranche iniziale, **poi**=beneficio concreto ma più contratto, **condizionale**=serve prova/capability, **preservare**=non duplicare capacità presente, **no ora**=costo/coerenza sfavorevoli. Nessuno score numerico aggregato.

### Matrice degli otto criteri

A/M/B = alto/medio/basso; le motivazioni sono nelle schede. «Frequente» significa ripetuto nel lavoro previsto, non numero di utilizzi misurato. Rischio basso non significa zero.

| ID | Impatto UX | Valore funzionale | Qualità tecnica | Frequenza prevista | Sforzo | Rischio | Coerenza | Confidenza diagnosi / beneficio |
|---|---|---|---|---|---|---|---|---|
| O01 | A, accesso all'azione | A per tastiera | M, unico clamp | Quotidiana per utente tastiera | S | B/M, focus | A | Alta SRC / alta qualitativa |
| O02 | A, continuità | M | A, ownership persistenza | Ogni switch/riavvio con assetti diversi | M | M, idratazione | A, promessa prodotto | Alta SRC / alta qualitativa |
| O03 | A, evita sorpresa | A, protegge lavoro | A, lifecycle | Al cambio superficie | M | M/A, processo | A | Alta SRC / alta sul rischio, frequenza ignota |
| O04 | A in errore | M | M, contratto esiti | Ogni errore azione | S/M | M, duplicati/retry | A | Alta confine SRC / media caller |
| O05 | M se jank | B diretto | A se misura utile | Ogni burst | S misura, M tuning | B misura / M modifica | A | Alta proprietà SRC / beneficio da misurare |
| O06 | M nel setup corsia | M | A, consenso/dati | Creazione worktree | M se esteso | A, segreti/symlink | A se esplicito | Alta capacità già presente / media gap residuo |
| O07 | M ipotizzato | A in runtime, non shell | B se duplicato | Task su repo grande | L | A, indice/cache | B nella shell | Alta pattern esterno / bassa necessità locale |
| O08 | M | M | M, episodio quota | Quota bassa/reset/reload | S/M | M, alert fatigue | A se sobrio | Alta pattern esterno / media gap locale |
| O09 | A in recovery | A | A, integrità | Integrazione/annulla | Già presente; L nuovi checkpoint | A, dati/Git | A preservazione | Alta SRC / non giustifica nuovo sistema |
| O10 | M | M, intenzione chiara | M | Scelta modalità | S copy / L poteri reali | A se promessa falsa | A senza duplicare | Alta esistenti / media attrito |
| O11 | M | M | A, admission unico | Molte corsie | M/L | A, race/budget | A corsie, B runtime duplicato | Alta cap presente / media estensione |
| O12 | M indiretto | M | A, confini ciclo vita | Ogni apertura/chiusura | M/L | A, eventi tardivi | A mirato | Media rischio, nessun bug nuovo riprodotto |
| O13 | A se molte code | A | M | Quota/nuovo agente | L completo, S advisory | A, stima/dispatch | A advisory locale | Media dati esistenti / beneficio da provare |
| O14 | A nella consegna | A | M, provenienza | Passaggio prototipo→codice | M/L | M/A, note stale | A | Media gap residuo / alta direzione |
| O15 | A, fiducia review | A | A, verifica tracciabile | Ogni integrazione | M/L | A, TOCTOU/dirty | A | Alta gap SRC / media soluzione completa |
| O16 | A, meno memoria umana | M | M | Ogni invio ambiguo | M | M, payload/provenienza | A | Media, contesto già ricco / media beneficio |
| O17 | A su sessioni lunghe | M | A se bottleneck | Storico esteso | S baseline, M/L virtual | A, scroll/focus/copia | A condizionale | Alta crescita SRC / jank non misurato |
| O18 | B corrente | B | M, contratto confine | Overlay eccedenti | S | B/M, geometria | A prevenzione | Alta OBS helper / bassa urgenza consumer |
| O19 | A se output sostenuto | A, disponibilità terminale | A, bounds espliciti | Burst/output lungo; frequenza ignota | M/L | A, blocchi/ordine/chiusura | A | Alta SRC su coda/ACK assente / saturazione non esercitata |
| O20 | M in errore runtime | A, confine memoria | A, framing fisico | Frame malformato; rara/ignota | M | M/A, compatibilità wire | A | Alta SRC read_until / fault runtime non esercitato |

## Quick wins e continuità quotidiana

<a id="o01"></a>
### O01 — Ridimensionamento dei pannelli da tastiera

- **Categoria/priorità:** QUICK WINS, prima; [R01](IMPLEMENTATION_ROADMAP.md#r01), [U01](UI_UX_MOTION_AUDIT.md#u01--ridimensionamento-da-tastiera-p1-confermato-nel-codice).
- **Problema/attuale SRC:** `src/routes/+page.svelte:3622-3629,3746-3753` offre separator con nome/orientamento ma solo pointerdown/doubleclick; no tabindex, frecce o valori ARIA. `startDrag:3160-3212` possiede già geometria/clamp.
- **Fonte DOC:** [WAI splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), [VS Code accessibilità](https://code.visualstudio.com/docs/configure/accessibility/accessibility). Il pattern WAI segnala esempio/review incompleti: necessaria prova assistiva.
- **Proposta:** handler locale frecce secondo orientamento, Home/End, reset, `aria-controls` e valori reali; un solo algoritmo per mouse e tastiera. Non nuova shortcut globale.
- **Valore:** azione oggi non disponibile a pari granularità senza mouse; rischio focus e clamp su finestra piccola.
- **Complessità/dipendenze:** S, nessuna libreria e nessun prerequisito; riusare token focus e limiti.
- **Accettazione:** entrambi i layout usabili con Tab/frecce, focus visibile, sidebar nascosta non tabbabile, editor/TUI ricevono le loro frecce.
- **Alternativa minima:** helper inline e due handler; componente nuovo solo se semplifica, non per principio.

<a id="o02"></a>
### O02 — Persistenza per progetto delle dimensioni delle colonne

- **Categoria/priorità:** PRODUCT IMPROVEMENTS, prima; [R02](IMPLEMENTATION_ROADMAP.md#r02).
- **Attuale SRC:** `+page.svelte:3049-3245`, `leftWidth=260`, `centerWidth=0`, `topHeight=0`, solo route state; ricerca dei riferimenti in route/stores/types non trova salvataggio. **DOC PRODUCT:234 lo promette già**.
- **Fonte:** contratto locale [PRODUCT](../../PRODUCT.md#product-principles); [VS Code persisted zoom](https://code.visualstudio.com/docs/configure/accessibility/accessibility#persisted-zoom-level) come modello di persistenza, non feature equivalente.
- **Proposta:** metadata opzionale di progetto canonico, preferenza distinta dalla misura adattata alla viewport, orientamenti separati; save a fine gesto, store/flush esistenti. La corsia non deve possedere geometria separata.
- **Valore:** evitare riaggiustamenti A→B→A/restart; alta pertinenza, non vantaggio misurato in secondi.
- **Complessità/rischi:** M, idratazione tardiva, salvataggio sotto progetto sbagliato, schermo piccolo che distrugge preferenza grande.
- **Dipendenze:** riusa limiti O01 ma può precederlo; nessuna libreria.
- **Accettazione:** due progetti distinti e riavvio conservano assetti; resize temporaneo non sovrascrive preferenza; zero write per pixel.
- **Alternativa:** persistenza globale più semplice ma insufficiente alla promessa per progetto, da approvare esplicitamente se scelta.

<a id="o03"></a>
### O03 — Cambio TUI/GUI dichiarato e protetto

- **Categoria/priorità:** PRODUCT IMPROVEMENTS, prima; [R03](IMPLEMENTATION_ROADMAP.md#r03).
- **Attuale SRC:** `src/lib/lanes/laneOrchestrator.svelte.ts:433-483`: GUI streaming abort/close, PTY release, setSurface e resume; nessun ramo di conferma in questa funzione. DOC `DECISIONS:100-105` dichiara perdita stato effimero. Tooltip `messages/it.json:49-51` non la esplicita.
- **Riferimento DOC:** [Codex handoff Local/Worktree](https://developers.openai.com/codex/environments/git-worktrees) espone ownership/operazione; non è lo stesso tipo di handoff processo di Studio.
- **Proposta:** preparazione senza mutazioni, avvertenza di lavoro noto attivo/sconosciuto, annulla prima della chiusura, conferma scoped a lane+session/generazione. Riusare ConfirmDialog; non enumerare risorse non esposte dal runtime fingendo certezza.
- **Valore:** evita interruzione inconsapevole; cronologia preservata non significa kernel/job preservati.
- **Complessità/rischio:** M, doppio click e switch corsia durante conferma, fail apertura dopo release; niente nuove dipendenze.
- **Dipendenze:** capability stato runtime; no dipendenza da nuovo event bus.
- **Accettazione:** annulla conserva processo, bozza e stream; conferma singolo owner e stesso transcript; normale cambio progetto non chiede nulla.
- **Alternativa:** solo copy più chiaro è utile ma non protegge un click durante esecuzione: non chiamarlo soluzione completa.

<a id="o04"></a>
### O04 — Errore dell'azione contestuale visibile e recuperabile

- **Categoria/priorità:** QUICK WINS, prima o subito dopo; [R04](IMPLEMENTATION_ROADMAP.md#r04).
- **Attuale SRC:** `ContextMenu.svelte:70-101` chiude, torna all'invoker, attende run; catch solo console.error. I caller possono già notificare: diagnosi sul contratto comune, non su ogni azione.
- **Riferimento DOC:** [VS Code Accessible View](https://code.visualstudio.com/docs/configure/accessibility/accessibility#accessible-view), errore consultabile senza log DevTools.
- **Proposta:** inventario callback, un solo owner del reporting usando notice/alert già presenti; azione+progetto nel messaggio, motivo utile, retry solo idempotente/non eseguito. Non nuovo toast framework.
- **Valore:** capire subito cosa è fallito; tecnica semplice, costo S/M secondo caller.
- **Rischi:** doppio avviso, testo con segreti, retry mutativo duplicato. Dipendenze: nessuna; prima LSP sui caller in implementazione.
- **Accettazione:** errore reale visibile/annunciato e focus restituito; nessun falso successo; nessun retry automatico di integrazione.
- **Alternativa:** correggere i soli caller senza reporter se inventario dimostra che tutti gli altri sono già completi.

## Architectural improvements condizionali

<a id="o05"></a>
### O05 — Budget motion basato su tracce, non più animazioni

- **Attuale SRC:** `motion.ts:68-104` anima height/padding/margin/border+blur su210 ms; `rvLift:36-60` opacity/blur/transform; `motionReduced()` già implementato e `revealScheduler` passa blur→stream.
- **Fonte:** [Svelte transitions](https://svelte.dev/docs/svelte/transition), inversione e WAAPI; inventario con valori reali nell'[audit](UI_UX_MOTION_AUDIT.md#motion-inventario-verificato-e-proposta-di-budget). Nessun easing proprietario stimato come fatto.
- **Proposta/valore:** confrontare stessa fixture300/3000 entry, burst e lane nascosta, motion on/off; rimuovere blur/animazione su elementi non visibili solo se trace mostra costo. Conservare continuità spaziale utile.
- **Priorità:** condizionale, alta come misurazione economica; non bug jank riprodotto. S prova/M tuning; zero dipendenze.
- **Rischi/deps:** variazione misura tra macchina/dev/prod, scroll che salta dopo ottimizzazione; prerequisito baseline per O17.
- **Accettazione:** traccia prima/dopo mostra miglioramento e input/stop immediati; reduced motion durante toggle e outro non lascia nodi focalizzabili invisibili. Non scegliere target120 fps non misurato.

<a id="o06"></a>
### O06 — Onboarding del worktree con consenso e provenienza dei file locali

- **Attuale SRC:** `src/lib/lanes/laneProfile.ts:1-12,83-103` già ha profilo stack, allowlist confermata e solo percorsi relativi/consenso persistiti. Non manca «copia dei file ignorati» in generale.
- **Riferimento DOC:** [Codex `.worktreeinclude`](https://developers.openai.com/codex/environments/git-worktrees#copy-ignored-local-files-into-managed-worktrees) include esplicitamente ignorati, salta symlink, non sovrascrive esistenti.
- **Proposta:** consolidare riepilogo cosa copiato/rifiutato/mancante usando `AllowlistCopyOutcome`, preview prima della prima corsia e link al motivo. Verificare gap UI reale prima di nuova vista. Mai auto-copiare `.env` per euristica.
- **Valore/priorità:** preservare/consolidare, media; evitare corsia non eseguibile o segreti copiati involontariamente.
- **Costo/rischi/deps:** M se nuova provenance UI, nessuna dipendenza; rischio alto dati/symlink/permission, usare resolver backend esistente.
- **Accettazione:** file non autorizzato non copiato, rifiuto conservato, report distingue missing/rejected/already_present; content non finisce in metadata o log. Alternativa: riepilogo testuale degli esiti già restituiti.

<a id="o07"></a>
### O07 — Repo-map AST: buona idea nel runtime, non nuovo indice nella shell

- **Fonte SRC C03:** Aider `RepoMap` usa tag Tree-sitter, cache mtime, grafo+PageRank e budget; dettagli nel registro sotto.
- **Attuale SRC:** `promptPreflight.ts:106-225` estrae literal UI/candidati limitati; contesto editor e Git già esistono. Studio non è un harness LLM secondo PRODUCT.
- **Proposta:** **non adottare ora** Tree-sitter/PageRank in Rust dentro Studio. Se task su repo grandi dimostrano costo/recall insoddisfacenti, valutare capability runtime omp e mostrare provenance/budget via protocollo. Prima O16.
- **Valore:** potenzialmente alto per orientamento; beneficio locale non dimostrato, nessun confronto token reale. L, parser/grammar/cache/invalidazione, rischio indice stale e doppia fonte di contesto.
- **Dipendenze:** decisione ownership runtime, versione/capability; licenze grammar separate. Non nuove dipendenze in questa ricerca.
- **Accettazione futura:** stesso task e codice, symbol recall/context budget e latenza misurati, fallback onesto senza firme inventate. Alternativa semplice: mentions e source hints già presenti.

<a id="o08"></a>
### O08 — Avvisi quota per episodio/account, senza soglie copiate

- **Fonte SRC C04:** VS Code persiste dismiss exhausted, lo azzera solo con snapshot reale disponibile; prima lettura stabilisce baseline, non trigger. Soglie50/75/90/95 sono loro scelta, non validazione per Studio. «Switch to Auto» è azione proposta dal banner, **non** prova di fallback automatico del modello.
- **Attuale SRC:** `quota.svelte.ts:156-159,240-244,348-350,447-450` ha stati quota, polling adattivo, warning e dismiss episodi reset; `usageResets.ts:581-612` chiavi per account/scadenza; `quotaRecovery.ts:123-126` già esclude quote zero e suggerisce alternative.
- **Proposta:** prima verificare reload/account/reset del dismiss attuale; se ripresenta avviso già letto, persistire l'episodio corretto e invalidarlo su recupero reale. Mostrare età dato; non aggiungere4 banner, non migrare modello senza scelta.
- **Valore/priorità:** consolidamento condizionale, S/M; rischio alert fatigue o nascondere nuova quota/account. Dipende da identità episodio attendibile, non da O13.
- **Accettazione:** dato non ancora caricato non è recupero, account B non eredita dismiss A, nuovo reset riabilita avviso corretto. Nessuna percentuale nuova senza motivazione locale. Alternativa: solo copy freshness nella quota già presente.

<a id="o09"></a>
### O09 — Preservare integrazione/undo atomici, non aggiungere shadow Git

- **Attuale SRC:** `src-tauri/src/projects/worktrees/lane_integrate.rs:1-23` e implementazione analizzata nel [documento tecnico](TECHNICAL_FINDINGS.md): merge-tree in memoria, conflict nella corsia, target dirty non sovrapposto preservato, undo con branch restored. `integrationGate.ts:33-64` gate UX non sostituisce backend.
- **Fonte:** Cline checkpoint [C02](#c02) per relazione run/chat; [issue4388](https://github.com/cline/cline/issues/4388) per crash/rename storico, non implementazione attuale provata. Questi meccanismi non sono equivalenti a merge/undo di corsia.
- **Decisione:** preservare, nessun nuovo sistema checkpoint per-tool ora; eventuale gap è etichettare scope «annulla integrazione» vs «torna indietro nella conversazione», non fingere rollback universale.
- **Valore/costo/rischi:** integrità alta, già presente; nuovo rollback L con rischio perdita file utente e divergenza chat/codice. Nessuna dipendenza nuova.
- **Accettazione di qualunque estensione:** abort/crash e modifica umana successiva preservati, niente rinomina `.git`, niente reset cieco. Alternativa sicura: riaprire branch restored e diff.

<a id="o10"></a>
### O10 — Rendere leggibile intento/poteri senza un secondo sistema di modalità

- **Attuale:** Piano e approvazione, task directive, ruoli/modelli e comandi sono già presenti (`planMode.ts`, `planController.svelte.ts`, `taskDirectives.ts`, catalogo comandi); GUI runtime configurato yolo è scelta documentata. Una label «Chiedi» non garantisce isolamento readonly.
- **Fonti DOC:** [Cascade legacy Write/Chat](https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview), [Claude permissions](https://code.claude.com/docs/en/best-practices#configure-permissions), Roo modes come riferimento storico archiviato.
- **Proposta:** consolidare spiegazione di cosa cambia realmente con Piano/Discussione e quali poteri runtime rimangono; non introdurre nuova toolbar Code/Ask/Architect che duplica ruoli e stato.
- **Priorità/valore:** condizionale, M chiarezza; S copy, L una nuova garanzia readonly. Rischio alto falsa sicurezza; capability e enforcement nel runtime, non divieto affidato al testo prompt.
- **Accettazione:** utente distingue intenzione da permesso; operazione vietata davvero rifiutata se si promette readonly; assenza supporto dichiarata. Dipendenze: capability effettive, non nuovo provider LLM.

<a id="o11"></a>
### O11 — Concorrenza governata: completare l'admission delle corsie

- **Attuale SRC:** `queueDispatch.ts:1-22,94-109,123-154` già ha radice canonica, soft-cap2 e avviso dal terzo agente, routing che non usa corsia visibile per osmosi. `autoDispatchArbiter.ts:28-32,43-63` stabilità2,5 s GUI/3 s TUI, verifica autoritativa, lock e cooldown. Controllo subagenti runtime non va inventato dalla GUI.
- **Fonti DOC:** [Zed parallel threads](https://zed.dev/parallel-agents), [Claude subagents](https://code.claude.com/docs/en/best-practices#create-custom-subagents). Non stesso livello di orchestrazione.
- **Decisione:** preservare owner unico e migliorare spiegazione «perché attende» nei componenti esistenti prima di introdurre limiti token/turni non esposti dal runtime.
- **Valore/priorità:** consolidamento, non nuovo fan-out; M/L solo se esteso. Rischi: task duplicati, stato idle transitorio, due scheduler in concorrenza.
- **Dipendenze:** O13 può consumare gli stessi gate, non bypassarli. Nessuna dipendenza npm.
- **Accettazione:** due avvii simultanei non acquisiscono stesso slot, attenzione/background blocca auto-dispatch, arrivo di un'altra corsia non sposta focus o target del task. Alternativa: spiegazione riutilizza le cause del gate attuale.

<a id="o12"></a>
### O12 — Confini lifecycle e generazione degli eventi, non event bus aggiuntivo

- **Categoria:** ARCHITECTURAL IMPROVEMENTS; poi/condizionale, [R08](IMPLEMENTATION_ROADMAP.md#r08).
- **Attuale:** `client.ts`, `session.svelte.ts`, `sessionRegistry.ts`, Rust `rpc/` e proiezioni remoto/Companion già gestiscono eventi, richieste e diagnostica. Non manca un protocollo strutturato NDJSON.
- **Riferimento SRC C01:** Codex `ConnectionRpcGate` distingue chiusura admission da drain handler iniziati. [OpenHands issue15061](https://github.com/OpenHands/OpenHands/issues/15061) propone interprete puro, non prova che sia stato completato sul main corrente.
- **Proposta:** prova mirata late-event dopo close/open, ownership lane/session/generazione; estrarre solo famiglia di reducer/effetti che mostra accoppiamento o duplicazione reale. Una fonte autoritativa, nessuna migrazione event-sourcing.
- **Valore/costo:** A affidabilità potenziale, M/L per race e callsite; zero dipendenze. Diagnosi di rischio media finché non riprodotta nuova failure; non etichettare P0 un file grande.
- **Accettazione:** richiesta dopo close non parte, in-flight può pulire, risposta vecchia non modifica nuova sessione, timeout termina con diagnostica; test deterministici su transizioni. Dipendenze: contratto runtime e prova, non refactoring globale.

## Strategic opportunities

<a id="o13"></a>
### O13 — Admission advisor consapevole di provider, quota ed età del dato

- **Attuale SRC:** quote/reset/recovery, cap e scheduler già presenti (O08/O11). Non manca una coda o la gestione del reset.
- **Ispirazione:** VS Code quota C04 distingue dati assenti/reali e propone azione; [Codex automazioni/worktree](https://developers.openai.com/codex/environments/git-worktrees) separa foreground/background.
- **Proposta originale:** nel dialog avvio mostrare provider/ruolo e concorrenti noti, età quota e scelte attendi reset/scegli ruolo/avvia. **Non blocco predittivo basato su costo task inventato**, non fallback modello silenzioso.
- **Valore/priorità:** strategica condizionale, A quando molte code condividono quota; beneficio da prova. [R09](IMPLEMENTATION_ROADMAP.md#r09).
- **Moduli:** `activeQuota.svelte.ts`, `quota/`, `queueDispatch.ts`, `autoDispatchArbiter.ts`, `LaneDispatchDialog.svelte`, `QueueDrawer.svelte`, Companion/remoto solo proiezioni.
- **Costo/rischi:** L advisor completo/S riepilogo, nessuna libreria; staleness, privacy account, doppio dispatch, confusione quota non disponibile con0.
- **Dipendenze/accettazione:** gate O11 unico, dati freschi o ignoti espliciti; zero task duplicati, zero-cost preservato, utente sceglie; nessuna nuova chiamata modello per stimare costo. Alternativa semplice: quota/provider visibili nel dialog esistente.

<a id="o14"></a>
### O14 — Consegna Lab revisionata con limiti delle simulazioni

- **Attuale DOC/SRC:** PRODUCT:79 e tool `corsia_consegna` già consegnano prototipo; `src/lib/lab/` include revisioni/annotazioni/source location. **Non** opportunità «aggiungere Lab handoff» da zero.
- **Proposta originale:** stessa revisione per screenshot, note e source location; elenco simulato/reale e criteri di accettazione nel pacchetto, con riferimenti target-stack. Prima ispezionare payload attuale per estendere solo campi mancanti.
- **Fonte:** [Cursor artifacts](https://cursor.com/help/ai-features/background-agents) e [Zed review](https://zed.dev/parallel-agents), adattamento proprio al prototipo isolato.
- **Valore/priorità:** strategica dopo continuità, M/L; [R10](IMPLEMENTATION_ROADMAP.md#r10). Confidenza media su gap residuo; nessun claim esclusività.
- **Moduli:** `lab/visualNotes.ts`, `visualNotesStore.svelte.ts`, `catalog.ts`, `LabPreview.svelte`, `lanes/laneActions.ts`, `lane_bridge.rs`/moduli Lab.
- **Rischi/deps:** annotazioni stale, dati sensibili nei fotogrammi, React copiato in shell Svelte, mock scambiati per backend reale; dipende da identità revisione esistente, può riusare O15.
- **Accettazione:** nota r1 non applicata r2, Lab immutato da cutover target, limiti simulazione espliciti, stack target rispettato. Alternativa: manifest testuale verificato senza altra vista UI.

<a id="o15"></a>
### O15 — Evidenze di verifica legate alla revisione corrente

- **Categoria/priorità:** PRODUCT + ARCHITECTURAL, poi ad alto valore; [R05](IMPLEMENTATION_ROADMAP.md#r05).
- **Attuale SRC:** `commandEvidence.ts:11-59` estrae comando/exit/durata/isError/running/snippet; no revisione. `LaneReviewModal:149-157` legge entries live, altrimenti vuoto. Questo non dimostra perdita dei comandi dal transcript su disco, ma limita la view.
- **Fonte:** [Cursor prova del lavoro](https://cursor.com/help/ai-features/background-agents), [Aider lint/test](https://aider.chat/docs/usage/lint-test.html), [Claude verifica](https://code.claude.com/docs/en/best-practices#give-claude-a-way-to-verify-its-work).
- **Proposta:** receipt comando+cwd+lane/session+revisione before/after+esito+artifact redatto, valida/scaduta/sconosciuta. **SHA HEAD da solo non basta** con dirty/untracked; snapshot/fingerprint scelto con limiti e protezione segreti. Comando assente exitCode non è successo.
- **Valore:** review affidabile senza ripetere verifiche a memoria; possibilità di superare «video allegato» con attualità deterministica.
- **Costo/rischi:** M/L, TOCTOU, background mutante, hash costoso, log segreti, prova eseguita altrove. Nessuna dipendenza nuova; metadata additive e backend per identità reale.
- **Dipendenze:** definizione revisione dirty attendibile; no policy bloccante automatica senza scelta prodotto.
- **Accettazione:** successo→edit = scaduto; no snapshot = sconosciuto; reload conserva ricevuta; verifica su B non valida A; artifact è evidenza non istruzione da eseguire. Alternativa S: etichetta «dal transcript, revisione non attestata» subito.

<a id="o16"></a>
### O16 — Provenienza del contesto del singolo invio

- **Attuale SRC:** `promptPreflight.ts`, `editor/editorContext.ts`, `fileMention.ts`, `Composer.svelte`, `ContextPanel.svelte` già compongono fonti esplicite/automatiche; non manca genericamente @file.
- **Fonti:** [Zed agent panel](https://zed.dev/docs/ai/agent-panel), Aider C03 budget e menzioni, entrambi rendono utile fornire contesto specifico.
- **Proposta:** disclosure compatta originata dallo stesso manifest del payload effettivo: fonte, progetto/corsia, buffer/disco, incluso/escluso. Non ricostruire separatamente un preview diverso dall'invio e non esporre segreti del prompt.
- **Valore/priorità:** poi, quotidiana per task ambigui; [R06](IMPLEMENTATION_ROADMAP.md#r06), confidenza media sul bisogno, non uso misurato.
- **Costo/rischio/deps:** M, payload race/cambio corsia e budget; riusa architettura esistente, nessun indice aggiunto O07.
- **Accettazione:** mai fonti A nel prompt B, file dirty chiaramente indicato, exclude rispettato nel wire, fallimento preflight conserva bozza; token sconosciuti non numero inventato. Alternativa: solo lista delle origini senza stima token.

<a id="o17"></a>
### O17 — Render window misurato prima della virtualizzazione

- **Attuale SRC:** `transcriptWindow.ts:9-33` iniziali300, espansione step300, slice/copia; window render cresce, storia in memoria non limitata da helper. `Transcript.svelte` raggruppa e anima entry; no prova di jank.
- **Fonti:** [TanStack Svelte Virtual](https://tanstack.com/virtual/latest/docs/framework/svelte/svelte-virtual), xterm C05 come principio bounds/consumer e non virtualizer chat.
- **Proposta:** baseline300/3000/30000 con DOM/memoria/input/anchor; prima cap/derivazioni selettive, virtualizer solo se soglia pratica dimostra bisogno. Non eliminare eventi autoritativi o Ask/errori per risparmiare DOM.
- **Valore/priorità:** condizionale, [R07](IMPLEMENTATION_ROADMAP.md#r07); O05 baseline motion; sforzo S prova/M-L integrazione.
- **Rischi:** altezze variabili Markdown/tool, copia/find cross-window, screen reader, scroll jump, screenshot/test. `@tanstack/svelte-virtual` MIT candidato, non installato e nessun KB inventato.
- **Accettazione:** carica precedente mantiene anchor, crescita controllata nel caso scelto, stop/input reattivi, completa navigazione ai risultati; confronto stessa macchina/fixture. Alternativa: windowing esistente con cap e ricerca contestuale.

<a id="o18"></a>
### O18 — Contratto di contenimento dei popover sovradimensionati

- **Attuale SRC/OBS:** `anchoredPopover.ts:119-156` ramo point flip/clamp ma non applica constrainHeight; a1440×960, probe point240×1200 produce bottom1208. Anchor con max-height variabile resta dentro. **ContextMenu.svelte:269-270 già limita altezza e scorre**: non bug attuale del menu dimostrato.
- **Fonte:** [Floating UI computePosition](https://floating-ui.com/docs/computePosition) come riferimento se complessità aumenta, non pretesto per dipendenza.
- **Proposta/priorità:** prevenzione ARCHITECTURAL, bassa; esplicitare responsabilità helper/consumer e provare contenimento per nuovi menu. Fix mirato solo sul consumer realmente senza limite.
- **Valore/costo/rischi:** modesto corrente, S; rischio clamp diverso o resize loop. Nessuna libreria.
- **Accettazione:** pannello eccedente viewport ha area interna raggiungibile e ultima azione accessibile, responsive a resize e focus; non prendere la misura negativa per successo. Dipendenze nessuna. Alternativa: CSS max-height condiviso già adottato.

## Bounds dei trasporti — riscontri aggiuntivi del codice

<a id="o19"></a>
### O19 — Backpressure PTY fino al consumer, non solo batch

- **Categoria/priorità:** ARCHITECTURAL IMPROVEMENTS, prima tranche tecnica dopo probe; [T01](TECHNICAL_FINDINGS.md#t01), [R11](IMPLEMENTATION_ROADMAP.md#r11).
- **Attuale SRC:** `src-tauri/src/pty/mod.rs:782-834`: mpsc::channel senza capacità, read64KiB, forward batch fino256KiB. `terminal.ts:489-577` rAF/timer16ms/cap lotto64KiB ma term.write senza callback consumption. Limite lotto non limita backlog end-to-end.
- **Fonte SRC/DOC:** xterm [C05](#c05), callback dopo parser e high/low watermark; implementazione storica distinta dalla versione6 installata.
- **Proposta:** misurare bytes pending per stadio, producer finito e consumer lento; coda bounded cancellabile, ACK a lotti se il backlog si sposta in IPC/xterm. Non semplice drop dati/ANSI o cambio renderer.
- **Valore/confidenza:** rischio di saturazione confermato strutturalmente, nessun leak/crash desktop riprodotto. Impatto potenziale alto su output intenso, frequenza non misurata.
- **Complessità/rischi/deps:** M/L, nessuna dipendenza; evitare deadlock su close/abort/EOF e attesa con manager lock. O05 osservabilità utile, non prerequisito di nuovo framework.
- **Accettazione:** byte/ordine/UTF8/ANSI preservati, bounds osservabili, stop/input e chiusura reattivi anche consumer lento; RSS e backlog misurati sulla stessa macchina. Alternativa minima: bound Rust più probe per dimostrare se serve davvero ACK cross-IPC.

<a id="o20"></a>
### O20 — Limitare il framing fisico RPC prima dell'accumulo completo

- **Categoria/priorità:** ARCHITECTURAL IMPROVEMENTS, hardening mirato; [T02](TECHNICAL_FINDINGS.md#t02), [R12](IMPLEMENTATION_ROADMAP.md#r12).
- **Attuale SRC:** `rpc/mod.rs:466-495` accumula con read_until newline in Vec prima di reassemble; limite64MiB è del frame logico/chunk (`:611-669`), non riga fisica né capacità iniziale64KiB.
- **Fonte/idea:** proprietà locale verificata; proposta originale di framing bounded. Codex C01 separa lifecycle ma non viene citato come implementazione dello stesso cap byte.
- **Proposta:** cap byte per riga concordato con maxFrameBytes/capability e limite handshake prima di negoziazione; overflow con diagnostica+policy close/reset, mai JSON troncato silenziosamente.
- **Valore/confidenza:** alta su allocazione non limitata nel loop, fault runtime/DoS non esercitato e nessuna esposizione remota dedotta.
- **Complessità/rischi/deps:** M, chunk base64/UTF8/protocollo vecchio, no nuove dipendenze; preservare ordering/end/Ask. Distinto da O19 (PTY byte stream senza frame JSON).
- **Accettazione:** riga senza newline oltre cap fallisce senza ulteriore crescita; valido al limite e ricomposizione chunk invariati; EOF/malformed e shutdown rilasciano risorse. Alternativa: cap fisso conservativo documentato prima di negoziazione, poi cap capability senza ridurre arbitrariamente frame validi.

## Registro implementazioni OSS esaminate

Le revisioni sono state **lette**, non compilate/eseguite; sono snapshot verificabili, non necessariamente release installabili né «ultima versione» di ogni prodotto. Le licenze sono state lette dal file radice o dall'header indicato. Nessuna copia di implementazione eseguita. I link SHA sono immutabili; le fonti DOC del landscape sono vive.

<a id="c01"></a>
### C01 — Codex: admission distinta da drain

- **Repo/SHA:** `openai/codex` `970111f6cb62cc02fe36a82ea7d71b37a2889c97`.
- **SRC:** [connection_rpc_gate.rs](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server/src/connection_rpc_gate.rs); [LICENSE Apache-2.0](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/LICENSE).
- **Implementazione letta:** `ConnectionRpcGate::run` acquisisce sotto mutex un token TaskTracker solo se accepting e auth corrente; rilascia mutex prima del future; `close` chiude admission, `shutdown` attende tasks già iniziati. Test separano late future mai pollato e handler iniziato che termina cleanup.
- **Confronto:** `laneOrchestrator.switchSurface` chiude processo e `client/sessionRegistry` hanno già lifecycle. Adattare O12 solo se una prova mostra lavoro tardivo/cambio ownership; non incollare il gate come nuovo strato in ogni richiesta.
- **Trade-off:** drain può attendere un handler che non finisce, quindi shutdown della shell deve avere propria policy osservabile; gate non è sandbox/autorizzazione degli effetti già iniziati. Il pattern rende le fasi esplicite, non garantisce rollback.

<a id="c02"></a>
### C02 — Cline: checkpoint associato al run, non a ogni feedback

- **Repo/SHA:** `cline/cline` `9beea0300bb0c5125451cb8e0858d1bbd8898208`.
- **SRC:** [sdk-checkpoints.ts](https://github.com/cline/cline/blob/9beea0300bb0c5125451cb8e0858d1bbd8898208/apps/vscode/src/sdk/sdk-checkpoints.ts); [LICENSE Apache-2.0](https://github.com/cline/cline/blob/9beea0300bb0c5125451cb8e0858d1bbd8898208/LICENSE).
- **Implementazione letta:** `isCheckpointAnswerMessage` risale ignorando marker checkpoint e distingue risposta a followup/mistake_limit da nuovo task; `isCheckpointRunUserMessage` esclude tali risposte; lookup ricostruisce run count. Non prova l'algoritmo Git di restore.
- **Confronto:** Studio distingue task, Ask, turni e sessioni: stessa lezione per O15, una risposta a domanda non deve diventare una nuova revisione verificata/task originale per semplice posizione nell'array.
- **Trade-off:** ordinali ricostruiti dipendono dalla sequenza; per ricevute persistenti usare identificatori stabili, non solo count o indice UI. Rewind codice/chat sono scope separati; issue storiche Git non vanno attribuite automaticamente a questo file.

<a id="c03"></a>
### C03 — Aider: cache, priorità e budget del contesto

- **Repo/SHA:** `Aider-AI/aider` `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`.
- **SRC:** [repomap.py](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py), letti costruttore, `get_repo_map`, cache/mtime, Tree-sitter capture e `get_ranked_tags`; [LICENSE Apache-2.0](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/LICENSE.txt).
- **Meccanismo:** default map_tokens1024, espansione se no chat files entro context padding; stima token su campione per testo lungo; tag cached per mtime; fallback Pygments quando ci sono def ma non ref; grafo pesato, boost menzioni e PageRank, distribuzione rank alle definizioni. Non è una lista casuale di file.
- **Confronto:** preflight Studio risolve label/literal e contesto corrente, non sostituisce un indice semantico. O16 può esplicitare budget/provenienza, ma O07 richiede ownership nel runtime.
- **Trade-off:** cache mtime non snapshot transazionale, ranking euristico/grammar incomplete, token count campionato è stima, costo primo scan. Non adottare ogni fallback di Aider come «best practice» locale; misurare recall e costo.

<a id="c04"></a>
### C04 — VS Code: quota ignota non equivale a recuperata

- **Repo/SHA:** `microsoft/vscode` `b208bc2501cdd0285e47951603d0c1059c6fb2f7`.
- **SRC:** [chatQuotaNotification.ts](https://github.com/microsoft/vscode/blob/b208bc2501cdd0285e47951603d0c1059c6fb2f7/src/vs/workbench/contrib/chat/browser/chatQuotaNotification.ts), header MIT letto, implementazione `_update`, `_computeQuotaWarning`, `_findCrossedThreshold`, `_isQuotaKnownAvailable`, persisted dismiss e proposta switch Auto.
- **Meccanismo:** prima osservazione baseline, crossing verso soglia più alta, priorità budget bloccato/exhausted/approaching/rate-limit, dismiss conservato finché snapshot reale recuperato. Modello BYOK escluso dal banner specifico.
- **Confronto:** Studio ha quote/provider/account differenti e dismiss per episodi reset; trasferire distinzione stato ignoto e scope, non soglie o politica commerciale Copilot. O08/O13.
- **Trade-off:** modello entitlements/billing di VS Code è specifico;4 soglie possono essere rumore in Studio. L'azione SwitchToModel non dimostra commutazione automatica; nessuna proposta di fallback silenzioso.

<a id="c05"></a>
### C05 — xterm: buffer asincrono e ACK del consumo

- **Snapshot storico dalla guida ufficiale:** [WriteBuffer.ts](https://github.com/xtermjs/xterm.js/blob/7f598a36753f4d950ee63dc91bd6a92290f7e037/src/common/input/WriteBuffer.ts), SHA `7f598a36753f4d950ee63dc91bd6a92290f7e037`, header MIT; [flow-control guide](https://xtermjs.org/docs/guides/flowcontrol/).
- **Codice letto:** contatore pending, callback dopo `_action`, lavorazione time-sliced12 ms e offset/slice dei chunk già consumati; watermark50MB come paracadute nella revisione storica, **non soglia attestata dello xterm6 installato**.
- **Confronto:** batching backend ogni8 ms non prova backpressure consumer end-to-end. Leggere frontend Terminal/ACK e Rust PTY prima di affermare leak o imporre renderer WebGL. Documento tecnico approfondisce stato locale.
- **Trade-off:** pause per ogni chunk inefficiente; high/low watermark e callback a lotti riducono roundtrip ma ACK incoerente può bloccare tutto. Non usare l'esempio del vendor come benchmark locale.

## Decisioni negative e assenza di duplicati

- O07 non entra ora: indice nel posto sbagliato e beneficio non dimostrato.
- O08 non significa aggiungere soglie; O13 non significa nuovo scheduler: stesso owner esistente e dati veri.
- O09/O10/O11 sono soprattutto capacità già presenti da preservare/chiarire, non marketing di feature mancanti.
- O05 misura animazioni; O17 misura scala della lettura: cause diverse, possibile esperimento condiviso, non due riscritture.
- O03 governa processo/superficie; O14 consegna prototipo/revisione: entrambi chiamati handoff ma contratti diversi.
- O15 certifica relazione tra verifica e codice; O09 annulla integrazione: non sono sinonimi.

Fonti di prodotti e stato manutenzione in [COMPETITIVE_LANDSCAPE](COMPETITIVE_LANDSCAPE.md#2-candidati-e-pertinenza). Licenze candidate UI e costo qualitativo nella [sezione librerie](COMPETITIVE_LANDSCAPE.md#6-librerie-e-componenti-pertinenti). Nessuna stima bundle da note preliminari viene trattata come misura.
