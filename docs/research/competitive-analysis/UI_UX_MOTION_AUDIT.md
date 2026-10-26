# UI, UX e motion audit

Verifica: **2026-10-25**, OMP Studio `package.json` 1.8.0. Ricerca, non redesign né certificazione WCAG. Nessuna modifica funzionale.

## Metodo, prove e limiti

Legenda comune: **SRC** codice letto; **DOC** documentazione ufficiale; **OBS** comportamento esercitato; **ISSUE** segnalazione di terzi, non difetto universale; **INF** inferenza da confermare; **PROP** proposta originale. I riferimenti locali indicano la revisione del working tree analizzata; i numeri di riga possono cambiare.

**Contesto intenzionale:** [PRODUCT](../../PRODUCT.md#brand-commitments): sviluppatori che governano più agenti otto ore al giorno, «strumento, silenzioso, preciso». [DESIGN](../../DESIGN.md#overview) distingue voce della conversazione e officina densa. Non applicare criteri da landing page, non sostituire Inter per gusto, non introdurre palette generica, animazioni celebrative o mobile-first nella shell desktop.

### Registro delle osservazioni

1. **OBS — avvio web reale:** `npm run dev -- --host 127.0.0.1 --port 5194`, Chromium 1440×960, scala 1,25. Root caricata, ma superficie vuota: `TopBar` chiama `getCurrentWindow`, assente `window.__TAURI_INTERNALS__.metadata`; console registra anche caricamento progetti e GitHub falliti. Questo dimostra la dipendenza dal bridge Tauri, **non** un crash dell'app desktop. Nessun mock in questa prova, nessuna seconda istanza desktop.
2. **OBS — helper di produzione:** import dinamico da Vite di `src/lib/anchoredPopover.ts`, DOM sintetico isolato, non un workflow desktop simulato. A 1440×960: pannello point 240×100 dentro viewport (x1188,y848,bottom948); pannello point 240×1200 oltre viewport (top8,bottom1208); anchor con `max-height:var(--anchored-space)` limitato a916 px e bottom952. La geometria conferma un limite del **contratto dell'helper**. `ContextMenu.svelte:269-270` ha già max-height/scroll: non chiamarlo bug del menu attuale.
3. **Immagini esaminate:** [shell](../../../assets/screenshots/screen_hero.png), [revisione corsia](../../../assets/screenshots/screen_lanes.png). Sono screenshot preesistenti Windows tema chiaro: nel footer si legge nightly 1.6.1. **Non rappresentano una cattura aggiornata della 1.8.0**, né provano interazioni, contrasto misurato o fluidità.
4. **SRC — interazioni lette:** shell/resize, primitive dialog/tab/tooltip/menu, autoscroll chat, reduced motion e transizioni; dettagli sotto.

Non verificati: VoiceOver/NVDA, zoom nativo desktop, input IME completo, temi multipli, drag reale nei worktree, finestre macOS/Linux, Chrome Relay reale e takeover. Nessuna percentuale di successo o misurazione FPS inventata. Non eseguito detector estetico esterno: non necessario alla ricerca e nessuna nuova dipendenza. Non assegniamo un punteggio aggregato AA/FPS su una superficie desktop non esercitata.

## Mappa delle superfici e del carico decisionale

| Superficie | Elementi e workflow | Evidenza/forza | Attrito o verifica necessaria |
|---|---|---|---|
| Barra progetti e corsie | Progetto → corsia → file/Git/agente coerenti | SRC `TopBar.svelte`, `LaneStrip.svelte`, `laneOrchestrator.svelte.ts`; screenshot shell | Identità radice vs worktree deve restare evidente prima di integrare; non aumentare badge indiscriminatamente |
| Sidebar | File, Git, agente/coda/storico/regole/diario | DOC PRODUCT:24-27; SRC import/montaggio in `+page.svelte` | Evitare ulteriore activity bar; azioni dove il contesto è già presente |
| Centro | Monaco, diff, immagini/SVG/Markdown, Browser, whiteboard, Lab | SRC `Editor.svelte:1-78`, route:3631-3744; screenshot review | Diff ampio è utile; verificare nomi lunghi/zoom e alternativa lineare accessibile |
| Conversazione | Transcript, thinking/tool group, piano, domande, todo, subagenti, composer | SRC `Chat.svelte:1-83`, `Transcript.svelte:1-83` | Molti stati vivi competono nel vassoio: preservare bozza e focus quando arrivano Ask/quote |
| TUI alternativa | Terminale reale, stesso transcript con resume | SRC orchestrator:433-483 | Cambia processo, non solo scheda; perdita dello stato effimero non va nascosta |
| Revisione corsia | File/commit/evidenze, diff, integra/rigetta/ritorna | SRC `LaneReviewModal.svelte:148-157,746-765`; screenshot review | Comando riuscito non equivale a verifica della revisione corrente |
| Companion | Conversazione stabile e attenzione multi-progetto | DOC PRODUCT:81, SRC route import/proiezione | Promessa importante: nessun arrivo deve sostituire lettura o bozza; non provato live qui |
| Impostazioni/setup/quota | Centro unico, errori autentici, provider e Doctor | DOC PRODUCT:37-41,62-71; SRC route import | Non moltiplicare toggle per ogni nuova opportunità |

Il numero di componenti non dimostra sovraccarico: la disclosure condizionale è già una scelta intenzionale. Occorre valutare scenari con Ask+quota+job+bozza prima di comprimere tutto in un pannello nuovo.

## Cinque interventi UI prioritari

### U01 — Ridimensionamento da tastiera (P1, confermato nel codice)

**Attuale:** `+page.svelte:3622-3629,3746-3753`: `div role="separator"`, nome e orientamento, `onpointerdown`, doppio click reset. Mancano `tabindex`, handler tastiera, `aria-valuenow/min/max` e `aria-controls`. La shortcut per collassare la sidebar non sostituisce il ridimensionamento fine. Il percorso `startDrag:3160-3212` offre il limite/clamp da riusare.

**Riferimento DOC:** [WAI Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), con nota della specifica sullo stato ancora incompleto dell'esempio. [VS Code accessibilità](https://code.visualstudio.com/docs/configure/accessibility/accessibility) documenta navigazione per parti, colonne da tastiera e diff accessibile; adottare il comportamento, non la command palette.

**PROP:** separatore focusable; frecce secondo orientamento, Home/End nei limiti consentiti, reset esplicito; focus visibile; valore percentuale derivato dalla geometria reale. Non catturare frecce globalmente né sottrarle a Monaco/xterm. Nessuna dipendenza. Eventuale `PaneSplitter.svelte` solo se elimina davvero duplicazione dei due separatori.

**Accettazione:** raggiungere entrambi senza mouse, cambiare misura nei due layout, annunciare valore aggiornato, pannello nascosto non focusable; tastiera nell'editor resta intatta. Verifica desktop con screen reader ancora necessaria.

### U02 — Geometria che sopravvive a progetto e riavvio (P2, confermato nel codice)

`+page.svelte:3049-3245` conserva `leftWidth=260`, `centerWidth=0`, `topHeight=0` in stato locale della route; drag/reset/ResizeObserver modificano solo quei valori. Ricerca dei riferimenti in route/stores/types non trova persistenza equivalente. `PRODUCT.md:232-234` promette larghezze persistenti per progetto: **disallineamento concreto documentazione/codice**, non feature da aggiungere perché Zed la possiede.

**PROP:** geometria nella metadata del progetto canonico, non corsia; vista orizzontale e verticale distinte; default elastico mantenuto con `0` o valore esplicito tipizzato. Salvataggio a fine gesto, non per pixel; ridimensionamento transitorio non deve sovrascrivere l'assetto preferito. Riutilizzare `projectStore` e flush esistenti.

**Accettazione:** A e B con assetti diversi, switch di corsia invariato, reload e finestra più piccola senza pannelli irraggiungibili; reset torna al default. Nessuna scrittura durante ogni pointermove. Una nuova preferenza UI non serve.

### U03 — Errore dell'azione vicino al punto d'azione (P2, confermato al confine condiviso)

`ContextMenu.svelte:70-101` chiude il menu, ripristina invoker, attende `item.run()`/azione secondaria e in catch chiama solo `console.error`. Alcuni caller possono già mostrare errori: questo non prova che ogni azione fallisca in silenzio. Il confine comune però non garantisce un feedback visibile.

**PROP:** contratto singolo di esito/errore con etichetta operazione e contesto progetto/corsia. Prima censire caller che gestiscono l'errore per evitare doppi avvisi. Riutilizzare notice/alert locali, non nuovo toast system. Retry solo per operazioni sicuramente non eseguite o idempotenti; niente retry automatico su merge/eliminazione.

**Accettazione:** permesso negato su un'azione reale mostra motivo e azione recuperabile; focus su invoker; un solo messaggio; nessun falso successo; nessun errore su altri progetti.

### U04 — Cambio TUI/GUI dichiarato e protetto (P1 per rischio, SRC; frequenza non misurata)

`laneOrchestrator.svelte.ts:433-483` abortisce stream GUI e chiude sessione, oppure rilascia terminale, poi riapre/resume. Il tooltip della scheda dice soltanto superficie/shortcut (`messages/it.json:49-51`). `DECISIONS.md:100-105` dichiara perdita di job, kernel eval e browser effimeri. Non è switch istantaneo e lossless.

**PROP:** se streaming/background risultano attivi, riepilogo dell'interruzione prima della chiusura; annulla senza mutazioni. Per risorse effimere non enumerabili, avvertenza onesta «la cronologia resta, gli strumenti in memoria possono interrompersi». Mai promettere censimento completo; non reinventare logica runtime o dedurre idle dal solo ultimo testo. Cambio a riposo può restare rapido con spiegazione contestuale.

**Accettazione:** annulla conserva processo/bozza, conferma mantiene sessionId e riapre una sola superficie, fallimento apertura non finge riuscita; nessuna chiusura da un semplice cambio progetto.

### U05 — Revisione con evidenze legate alla revisione (P2, parte UI di miglioramento prodotto)

Lo screenshot revisione mostra tre tab: file, commit, evidenze. `LaneReviewModal.svelte:149-157` ricava evidenze dal transcript; assenza sessione produce elenco vuoto. Serve distinguere «nessuna evidenza disponibile» da «test non eseguiti» e «verifica passata prima di ulteriori modifiche».

**PROP:** nella testata revisione mostrare HEAD verificato, comando, exit code e stato valido/scaduto/sconosciuto. Non colore verde se l'unica informazione è una stringa di output. Diff e gate backend restano autoritativi; vedere [roadmap](IMPLEMENTATION_ROADMAP.md).

**Accettazione:** test riuscito seguito da edit mostra evidenza scaduta; dopo reload dati mancanti mostrano sconosciuto; nessuna esecuzione automatica arbitraria tratta dal transcript.

## Altri risultati e piccoli dettagli

| ID | Severità | Riscontro e decisione |
|---|---|---|
| U06 | P2 da misurare | `motion.ts:68-104` interpola height, padding, margin, bordi, blur e transform per entry. È una scelta di continuità spaziale, non un bug provato. Profilare burst prima di cambiare; se necessario solo transizioni su righe vive/visibili e breve opacity senza blur su burst |
| U07 | P3, prevenzione | Helper point non applica `constrainHeight`; prova OBS sopra. I menu attuali hanno CSS di contenimento. Chiarire contratto helper e aggiungere protezione nel consumatore che ne ha bisogno, non introdurre Floating UI per correggere un caso teorico |
| U08 | P2 da verificare | `EmptyState.svelte:59-67` stampa shortcut `Ctrl+Alt+…` letterali, mentre `composerShortcuts` gestisce Mac. Candidato a formatter platform-aware, non affermare che tutti i label siano errati. Verificare visualizzazione macOS prima del fix |
| U09 | P2 di verifica | Contrasto: token semantici e più temi, nessuna matrice di rapporti misurata. Misurare testo/placeholder/focus/diff in almeno chiaro/scuro ad alto contrasto; non trasformare OKLCH in prova di conformità |
| U10 | P2 di verifica | Diff Monaco affiancato: controllare percorso unified/accessible e focus prima di aggiungere componente. La presenza di Monaco non garantisce che la shell esponga le sue azioni accessibili |
| U11 | P2 condizionale | Layout automatico a1100 px o portrait (`+page:3075-3079`), clamp colonne minimo160 px. Provare 1024×768 e zoom200%; non imporre target touch44 px a tutte le toolbar desktop senza distinguere SC2.5.8 ed eccezioni |

### Cose già mature da preservare

- **SRC `Dialog.svelte:74-95`:** `<dialog>.showModal()` e focus trap con ripristino; top layer anziché z-index arbitrari. `focusTrap.ts:71-105` evita focus iniziale quando app non attiva. Non sostituire con modali div custom.
- **SRC `ColumnTabs.svelte:64-110`:** roving focus, salta disabled, frecce spostano il fuoco e Enter/Space selezionano. Per il cambio processo è meglio dell'attivazione immediata ad ogni freccia. `Segmented` usa attivazione automatica: distinzione motivata dal costo, non duplicazione automaticamente sbagliata.
- **SRC `Tooltip.svelte:23-28,77-92,160-197`:** ritardo300 ms, quick switch60 ms entro250 ms, close80 ms, Escape, hover persistente e `aria-describedby` aggiunto/rimosso senza cancellare altre descrizioni. Non serve un'altra tooltip library.
- **SRC `Chat.svelte:279-300`:** autoscroll solo se pinned/visibile e utente non risalito; rAF singolo. `:124-134` marca lettura solo a fondo, app visibile/focalizzata, non durante stream/background. Evita che una notifica sparisca senza lettura.
- **SRC `Transcript.svelte:73-83`:** avvio indicato dopo400 ms evita flicker delle richieste rapide. Non aggiungere spinner su ogni delta.
- **SRC `anchoredPopover.ts:249-275`:** scroll capture/resize, ResizeObserver, coalescenza rAF e cleanup; fallback per WebKit senza Popover API. Non migrare a CSS Anchor Positioning ignorando macOS supportati.
- **SRC `motionState.svelte.ts:17-20,67-84`:** OS + preferenza app, con cancellazione immediata del lingering quando motion è ridotto.

## Motion: inventario verificato e proposta di budget

Non abbiamo misurato easing o durata di animazioni proprietarie di Cursor/Windsurf. I valori seguenti sono **SRC Studio**, non stime estratte da un video concorrente.

| Interazione | Trigger/proprietà | Timing/easing verificato | Interruzione/costo e decisione |
|---|---|---|---|
| Hover/focus controlli | Colore/bordo/opacity | `app.css:130-146`, fast120 ms, ease-out `(0.22,1,0.36,1)` | Feedback immediato, nessuna attesa prima dell'azione. Paint limitato; non promettere GPU per qualunque CSS |
| Menu/popover | Apertura; translate8 px, opacity, blur3 px | `anchoredPopover.ts:94-105`, token menu150 ms; `motion.ts:36-60` curva reveal | Ingresso solo; rapido riapri/chiudi non deve lasciare focus/overlay orfano. Blur può costare paint |
| Dialog | showModal; superficie separata dal positioner | `Dialog.svelte:104-107`,240 ms, rvLift | Direttiva bidirezionale Svelte può invertire; mantenere sfondo inert e fuoco al termine della chiusura |
| Riga transcript/Ask | Inserimento/rimozione; height/padding/margin/border/opacity/blur5/translate3 | `motion.ts:68-104`, default210 ms; Ask220 ms blur4 | Il testo cambia altezza: continuità utile ma layout non gratuito. Non eseguire reveal su tutto storico |
| Vassoio Companion | Sezione entra/esce; fold+blur6 | `trayFold:114-120`,420 ms | `Lingering` cancella timer su nuovo valore e smonta su dispose; testare inversioni e focus su nodi in uscita |
| Badge | Inserimento quantità/stato; max-width/spacing/scale0,82→1/blur3 | `badgeReveal:135-169`, default210 ms | Layout circoscritto, preservare leggibilità; evitare che arrivo numeri sposti azione primaria |
| Switch progetto/corsia | Solo regioni cambiate | `app.css:145-146`, dissolve300 ms; specifica DESIGN:434 cascata35 ms/tetto420 ms (**DOC**, non profiling) | Terminale escluso. Conservare selezione testo e input; non animare intere colonne |
| Stream testo | Reveal a frasi, stream o modalità configurata | `revealScheduler:29-43`, blur→stream con reduced motion; DOC reveal700 ms | Non confondere tempo reveal con latenza provider. Stop deve mostrare testo già ricevuto senza coda decorativa |

**Svelte prima delle librerie:** [transition](https://svelte.dev/docs/svelte/transition) documenta inversione e permanenza DOM durante outro, e avverte che WAAPI non viene spenta dalla sola media query CSS. Studio gestisce già `motionReduced()` nel transition factory: preservarlo. Per riordino futuro usare `animate:flip` solo su lista keyed piccola e stabile, non su tutto transcript. Nessun GSAP/Framer Motion.

**PROP budget, non benchmark:** registrare input latency, frame time p95, long task, Layout/Paint durante burst su chat300/3000 entry con motion on/off e background lane. Usare stesso transcript e stessa macchina. Accettare una semplificazione solo se migliora la traccia senza peggiorare ancoraggio/leggibilità. Niente target «120 fps» copiato da marketing.

## Riferimenti visivi e cosa trasferire

- [Zed Parallel Agents](https://zed.dev/parallel-agents): sidebar thread per progetto, anteprima branch/diff, scelta worktree e review. Pagina contiene immagini/video/demo promozionale, non sessione utente osservata. Trasferire riconoscibilità di progetto/branch e poche azioni contestuali; non ricostruire l'editor.
- [Codex Worktrees](https://developers.openai.com/codex/environments/git-worktrees): sequenza crea/lavora/handoff, distinzioni Local/Worktree e copia file ignorati esplicita. Trasferire spiegazione dell'ownership e scelta sicura, non auto-copiare segreti.
- [VS Code accessibilità](https://code.visualstudio.com/docs/configure/accessibility/accessibility): screenshot high contrast, navigazione tra parti e diff accessibile. Trasferire testabilità tastiera e accesso lineare; palette generica resta fuori visione Studio.
- [Screenshot Studio shell](../../../assets/screenshots/screen_hero.png): densità alta, surfaces per luminanza, tool compatti. Non emerge necessità di un restyling completo.
- [Screenshot Studio review](../../../assets/screenshots/screen_lanes.png): spazio dedicato al diff e azioni sul fondo; conservare ritorno alla corsia e separazione tra rigetto e integrazione.

## Matrice di verifica proposta

| Scenario | Prova finale necessaria | Esito di questa ricerca |
|---|---|---|
| Primo avvio/ripresa | Setup reale senza progetti transitori, errore rete con retry | Non eseguito desktop |
| Mouse/tastiera | Due splitter + menu + dialog annidato + ritorno invoker | SRC; helper popover OBS; nessuna certificazione globale |
| Stream lungo | 300/3000 entry, scroll risalito, stop, cerca/carica precedenti | Fonte helper windowing e smoke suite; non carico UI |
| Molti agenti | A/B con Ask simultanei, arrivi Companion senza focus steal | Contratti e test esistenti, non runtime live |
| Resize/zoom | Orizzontale/verticale,1024×768,200%, nome lungo | SRC auto layout; da eseguire desktop |
| Accessibilità | VoiceOver/NVDA, contrasto temi, reduced motion cambiato a metà | SRC motion; screen reader/rapporti non misurati |
| Revisione | Target avanzato/edit dopo test/crash/ripresa | Gate backend analizzati nel documento tecnico; no merge reale |

Priorità: chiudere U01/U02/U04 prima di aggiungere motion. Poi U03/U05; U06 solo con traccia prestazionale. U07 è prevenzione di confine, non emergenza. I relativi interventi sono collegati al [backlog](IMPROVEMENT_OPPORTUNITIES.md) e ai criteri operativi della [roadmap](IMPLEMENTATION_ROADMAP.md).
