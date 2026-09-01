# Idee — parcheggio

Questo file esiste per una sola ragione: **impedire che una buona idea diventi un ritardo.**

Regola: qualunque cosa venga in mente durante le fasi 0-6 e non sia già nel piano, si scrive qui e si va avanti. Si valuta dopo la Fase 6, quando l'app è in uso reale e si sa quali di queste idee servono davvero.

Il rischio R7 in `ARCHITECTURE.md` non è teorico: la deriva verso "un IDE" ha ucciso più progetti simili di qualsiasi problema tecnico.

---

## Formato

```
### <titolo breve>
Problema reale che risolve: <o "nessuno, mi piaceva">
Costo stimato: <ore o giorni>
Dipende da: <fase o feature>
```

---

## Candidati già emersi durante la progettazione

### Anteprima di una sessione storica senza riprenderla
Problema reale che risolve: capire se una sessione è quella giusta prima di pagare un cache miss riaprendola.
Costo stimato: 1 giorno.
Dipende da: Fase 5. `omp --export <file>` produce già HTML, quindi la strada esiste.

### Tema chiaro
Completato: il selettore include anche i temi chiari builtin di `omp`, con una
rampa di contrasto dedicata per guscio, editor e terminale. Le sezioni dello
switcher distinguono i temi chiari da quelli scuri in base alla luminanza reale.

### Colore identità del progetto scelto a mano
Problema reale che risolve: l'hash del path può assegnare due tinte vicine a due progetti aperti insieme.
Costo stimato: mezza giornata.
Dipende da: Fase 3. Da fare solo se il problema si presenta davvero con i progetti reali.

### Ricerca globale sulle sessioni di tutti i progetti
Problema reale che risolve: "dove avevo risolto quella cosa?" senza ricordare il progetto.
Costo stimato: 1 giorno.
Dipende da: Fase 5. L'indice FTS5 di `history.db` copre già tutti i `cwd`, quindi è quasi solo interfaccia.

### Vista costi per progetto nel tempo
Problema reale che risolve: nessuno immediato. `stats.db` ha i dati e la tentazione di farne un dashboard è forte.
Costo stimato: 2 giorni.
Dipende da: Fase 5. `PRODUCT.md` è esplicito: l'usage non è un prodotto di data-viz.

### Più tab di terminale per progetto
Problema reale che risolve: far girare due sessioni `omp` sullo stesso progetto, o tenere una shell accanto all'agente.
Costo stimato: 1-2 giorni.
Dipende da: Fase 3. Il `PtyManager` è già indicizzato per progetto con più sessioni, quindi il backend regge; è lavoro di interfaccia.

---

## Esplorazione integrazioni `omp` ↔ Studio — 2026-07-31

Sessione di ricognizione sulle superfici che `omp` espone e su quali valga la pena
consumare. Verificato su **omp v17.2.1** installato (il contratto in
`ricerca/OMP-INTEGRATION.md` era su 17.1.8: vedere lì il registro degli scostamenti).

Criterio di ammissione: l'idea entra solo se toglie un attrito che oggi si paga
davvero. Le idee che allargano la superficie senza togliere attrito stanno in fondo,
fra le scartate, con la ragione dello scarto: servono a non ridiscuterle.

### Sapere quale sessione `omp` gira in quale scheda
Problema reale che risolve: oggi l'app ospita il processo ma non sa **quale sessione**
ci sta dentro. Senza questo dato non esiste il costo della sessione corrente, non
esiste "esporta questa sessione", non esistono i file toccati, e il piede costi del
popover resta una promessa. È il pezzo che sblocca tutti gli altri.
Costo stimato: mezza giornata, più un gate empirico.
Dipende da: niente di nuovo. `omp` scrive un breadcrumb per terminale in
`~/.omp/agent/terminal-sessions/<terminal-id>` (due righe: cwd e percorso del `.jsonl`).
L'id deriva dal TTY e, in mancanza, da variabili d'ambiente — sulla macchina ci sono
28 file `wt-<uuid>`, cioè su Windows sta usando `WT_SESSION`. Studio può assegnare un
id proprio per PTY nell'ambiente che già costruisce. Gate: verificare che il breadcrumb
venga scritto anche quando la sessione non ha ancora un messaggio assistant.

### Ripresa di una sessione in un click
Problema reale che risolve: è il terzo problema dichiarato in `PRODUCT.md` e oggi il
click sulla scheda della sessione fa `console.log('Resume', s.id)`
(`src/lib/components/SessionList.svelte`). L'elenco e la ricerca ci sono, l'atto no.
Costo stimato: 2-3 ore.
Dipende da: niente. `--resume <id>` accetta il prefisso di ID che `history.db` già
fornisce; il PTY si apre con quell'argomento come per lo scratchpad.

### Pannello "cosa sta facendo l'agente": todo e file toccati
Problema reale che risolve: per sapere a che punto è l'agente bisogna leggere il
terminale; e per aprire il file che sta modificando bisogna cercarlo nell'albero.
Il `.jsonl` di sessione contiene le fasi todo (`details.phases` dell'ultimo risultato
del tool `todo`) e le chiamate di `edit`/`write` con i percorsi: da lì escono una lista
di fasi e una lista di file toccati, cliccabili per aprirli nell'editor con il diff
rispetto a HEAD (macchina già presente). Non è la chat: è lo stato.
Costo stimato: 1,5-2 giorni.
Dipende da: "Sapere quale sessione gira in quale scheda". Il `.jsonl` è append-only,
quindi si legge in coda per offset, non si riparsa.

### Notifica di sistema quando un agente non a schermo chiede attenzione
Problema reale che risolve: lo stato della tessera è leggibile solo se la finestra è
visibile. Con la finestra minimizzata o dietro, "l'agente aspetta te" non arriva:
è esattamente il caso d'uso multi-progetto che giustifica il progetto.
Costo stimato: mezza giornata.
Dipende da: `tauri-plugin-notification`. `omp` emette già notifiche desktop proprie e
si zittiscono con `PI_NOTIFICATIONS=off` nell'ambiente del PTY, quindi non si duplicano.
Attrito con `PRODUCT.md` ("l'unico momento in cui l'app alza la voce è la quota"):
ammessa solo a finestra non focalizzata e solo per `attention`, mai per `working`.

### ~~La quota che riguarda il modello che stai usando~~ → fatta il 2026-07-31, in altra forma
Realizzata come microcopy "In uso da …" sotto ogni barra del popover: invece di
ridurre la vista al provider attivo, dice **chi** sta usando quella quota adesso
(`provider_hosts` in `omp_ops.rs`, catena breadcrumb → `.jsonl` → ultimo messaggio
assistant). Resta aperta la parte del chip in barra colorato per severità e il
countdown a `resetsAt`.

### ~~Il terminale usa il tema di `omp`~~ → fatta il 2026-07-31, rovesciata
Non "Studio legge il tema di `omp`" ma "un tema solo per entrambi": il selettore in
barra sceglie fra i 100 temi builtin (copiati in `src/lib/themes/omp/`, perché
nel binario non sono leggibili), li divide per luminanza, ne scrive uno in
`~/.omp/agent/themes/omp-studio.json` e lo impone alle sole sessioni di Studio
via overlay. Vedi `DECISIONS.md` gate R9 e `DESIGN.md` §2.9.

### ~~Ctrl+click su un percorso apre il file nell'editor~~ → fatta il 2026-07-31, senza estensione
Non serviva l'estensione-ponte: con `tui.hyperlinks: always` nell'overlay `omp`
emette i percorsi come hyperlink OSC 8 `file:///…?line=N`, e xterm li consegna a un
`linkHandler`. Nessuna euristica sul testo, nessun parsing di cornici.

### Rispettare il profilo attivo di `omp`
Problema reale che risolve: l'app punta a `~/.omp/agent/` cablato. Con `--profile` o
`OMP_PROFILE` tutta la base utente si sposta in `~/.omp/profiles/<nome>/agent/`:
l'app mostrerebbe sessioni e quote di un altro profilo senza dirlo. Non è una feature,
è correttezza.
Costo stimato: 2 ore.
Dipende da: niente. `PI_CODING_AGENT_DIR` e `OMP_PROFILE` si leggono dall'ambiente.

### Verifica del contratto all'avvio, con la versione in chiaro
Problema reale che risolve: `omp` è passato a 17.2.1 e una colonna è già cambiata
(`usage_history.account_label` → `account_key`). Oggi un cambio di schema si manifesta
come un pannello vuoto senza spiegazione.
Costo stimato: mezza giornata.
Dipende da: `contract_check` previsto in `ARCHITECTURE.md` §4.1 e mai implementato.
Ogni verifica fallita degrada la singola funzione e lo dichiara nell'interfaccia.

### Estensione-ponte caricata con `--extension`
Problema reale che risolve: dopo il 2026-07-31 questa voce vale **la metà** di
quanto stimato, perché il "Ctrl+click apre il file" si è rivelato ottenibile con
gli hyperlink OSC 8 e zero codice dentro `omp`. Resta l'altra metà, che nessun
file su disco espone in tempo reale: **l'agente sta aspettando una risposta**
(quale domanda, quale approvazione), il contesto vicino al limite, un subagent
partito.
Verificato sul sorgente 17.2.1: gli eventi esistono e hanno payload utili —
`tool_approval_requested {toolCallId, toolName, reason?, approvalMode}` e, per il
tool `ask`, `tool_call` con `input.questions[].question`. Un'estensione che va in
errore non uccide la sessione: al caricamento viene saltata (`loader.ts:313-341`),
in un handler l'errore è loggato e si prosegue (`runner.ts:836-847`), con timeout
di 30 s per handler. `-e/--extension <file>` accetta un percorso qualunque, quindi
il modulo può stare nella cartella di Studio: **niente scritture in `~/.omp`**.
Nell'altro verso `pi.registerTool` permetterebbe all'agente di pilotare il guscio.
Costo stimato: 2-3 giorni.
Dipende da: la "Notifica di sistema" qui sopra, che è il consumatore naturale di
questi eventi. Oggi lo stato `attention` arriva già dal titolo del terminale:
l'estensione aggiunge il *contenuto* della domanda, non il fatto che ce ne sia una.
Precedente utile: l'utente ha già una propria estensione
(`~/.omp/agent/extensions/live-usage.ts`), quindi il meccanismo è noto.


## Evoluzione "Studio Pro" — 2026-08-21

Ricognizione sulle GUI degli harness AI (ChatGPT Desktop/Codex, T3 Code, Claude
Desktop, Cursor, Windsurf) e scelte di roadmap condivise con l'utente.

### Implementato (in `[Unreleased]`, rilascio da decidere)

- **Pannello GIT** (`GitPanel.svelte`): branch, working tree con numstat,
  ultimo commit e storico; diff Monaco per working tree *e* commit già
  effettuati (`git_last_commit`, `git_recent_commits`, `file_git_rev`).
- **Timeline unificata**: sessioni recenti nel pannello GIT, ripresa in un
  click via `--resume` (`TerminalSession.resumeSession`); branch switcher
  con gate su albero sporco (`git_branch_list/checkout/create/merge`).
- **Whiteboard diagrammi**: estensione `extensions/studio-diagram.ts`
  (tool `studio_diagram` via `pi.registerTool` + `pi.typebox`) che scrive in
  `%LOCALAPPDATA%/omp-studio/diagrams`; watcher Rust (`diagrams.rs`) emette
  `diagram://new`; `DiagramViewer.svelte` renderizza Mermaid con pan/zoom.
- **Sandbox prototipi**: `preview_file` + `PreviewViewer.svelte` — iframe
  sandbox (`allow-scripts`, senza same-origin) con viewport desktop/tablet/
  mobile; template `src/lib/prototype/template.ts` (React+Tailwind+Lucide
  da CDN) come punto partenza per i prototipi generati dall'agente.

### Parcheggiate esplicitamente dall'utente

- **Task HUD esterno** (Modulo 2): la TUI ha già il suo tracker todo;
  si rivaluta solo con una eventuale GUI completa dell'agente.
- **Multi-thread / worktree per progetto** (Modulo 3): rifiutato. I progetti
  restano single-threaded per decisione dell'utente.
- **Quick Switcher / Context Gauge** (Modulo 6): non richiesto.

### Note tecniche verificate sul binario omp installato

- `pi.registerTool({ name, label, description, parameters, approval, execute })`;
  schema Zod-compatibile esposto come `pi.zod` (backend omptype), con
  `pi.arktype` per il DSL nativo. `pi.typebox` e' il **namespace** del modulo
  legacy (`{ Type, default }`), non il costruttore: `pi.typebox.String` non
  esiste, serve `pi.typebox.Type.String`. Le estensioni di Studio usano `pi.zod`.
- `execute(toolCallId, params, signal?, onUpdate?, ctx?) -> AgentToolResult`:
  il risultato deve avere `content` come array di blocchi `{ type: "text", text }`
  (piu' `details?`, `isError?`). Un `{ output }` viene sostituito dal loop
  dell'agente con "Tool returned an invalid result: missing content array".
- Description sui parametri: `.optional().describe(...)`; l'ordine inverso
  perde la description sugli enum nello JSON Schema inviato al modello.
- Eventi: `tool_call`/`tool_result` (con `toolName`, `toolCallId`, `input`,
  `content`, `details`, `isError`), `tool_approval_requested/resolved`,
  `agent_start/end`, `turn_start/end`, `session_start`,
  `session_before_switch` (reason: new/fork/resume), `session_tree`,
  `session_before_compact`, `user_bash`, `input`.
- `ctx.sessionManager.getCwd()/getSessionId()/getSessionFile()`;
  `pi.appendEntry(customType, data)` scrive entry custom persistita;
  `pi.sendMessage(msg, { deliverAs: "steer" | ... , triggerTurn })`.
- Caricamento estensioni: `-e/--extension <file>`, disattivabili con
  `--no-extensions`. L'estensione-ponte resta caricabile a costo zero di
  scritture in `~/.omp`.

---

## Scartate, con la ragione

Servono a non ridiscuterle fra un mese.

- **`--mode rpc`, SDK, ACP per "leggere" la sessione in corso.** Non osservano la TUI:
  avviano un **nuovo** agente headless. Usarli significherebbe sostituire la chat, cioè
  l'esatto contrario del progetto.
- **`/collab` come guest per seguire la sessione viva.** Funziona, ma passa da un relay
  WebSocket cifrato e replica il `.jsonl` su disco: rete e complessità per rifare in
  proprio quello che il terminale mostra già.
- **Trascrizione della chat dentro l'app.** Reimplementa la TUI. I file toccati e le
  fasi todo sono stato; il dialogo no.
- **Pulsanti per `/share`, `/fork`, `/tree`.** Si realizzano scrivendo comandi slash nel
  PTY: è pilotare la TUI al posto dell'utente, e la TUI li ha già a due tasti.
- **Studio come server MCP per l'agente.** La registrazione passa solo da `mcp.json`
  (progetto o utente): sporca il repo dell'utente o `~/.omp`. La stessa cosa si ottiene
  con `pi.registerTool` nell'estensione-ponte, a costo zero di scritture.
- **Dashboard costi per progetto nel tempo.** `PRODUCT.md` è esplicito; e comunque
  `stats.db` risulta fermo al 21/07/2026, quindi prima di costruirci sopra qualsiasi
  cosa va capito chi lo aggiorna e quando.
- **Pannello latenza modelli** (`agent.db.model_perf` ha TTFT e ms/token reali).
  Numero interessante, nessuna decisione che cambia.
- **Elenco di skill, comandi slash, plugin e marketplace.** La TUI li scopre già da
  sola; duplicarli fuori è una activity bar a otto icone travestita.
- **Lettura di credenziali** (`auth_credentials`, `broker.token`, `apiKey` in
  `models.yml`). Vietata dal contratto e senza alcun beneficio.
