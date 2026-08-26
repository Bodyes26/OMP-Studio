# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added
- **Gestione Interattiva Task (.omp/tasks.json) da GUI e TUI:**
  - Persistenza dei task locale al progetto in `.omp/tasks.json`, non più confinata nello store globale di Studio, con auto-esclusione in `.omp/.gitignore` e migrazione automatica trasparente dei task esistenti.
  - File watcher bidirezionale non bloccante con scritture atomiche (temp + rename) per sincronizzazione in tempo reale tra Studio GUI e OMP TUI senza lock sui file.
  - Nuovo slash command `/tasks` per OMP: overlay interattivo a tutto schermo nel terminale per navigare con le frecce (`↑`/`↓`), cambiare stato con `Spazio`, aggiungere prompt con `A`, eliminare con `D`, riordinare con `J`/`K` e avviare immediatamente il task con `Invio`.
  - Nuovo tool agente `project_tasks` per OMP con supporto completo a `list`, `add`, `update`, `delete`, `reorder` e `get`, integrato automaticamente in tutte le sessioni PTY e RPC via flag `-e`.
  - Nuovi stati operativi per i task (`in_progress`, `completed`, `abandoned`) con chip visivi dedicati sia nell'AgentPanel che nel QueueDrawer e pulsante di commutazione stato rapido nel TaskEditor.
- **Gestione Task e Coda Multi-progetto:**
  - Nuovo `TaskEditor` a sezioni con layout scrollabile, textarea ad auto-dimensionamento, selezione del profilo di ruolo (`smol`, `default`, `slow`, `plan`, `custom`), slider interattivo del thinking effort e pulsanti primari espliciti «Salva e Chiudi» (`Esc`) e «Salva e Avvia subito» (`Ctrl+Invio`).
  - Modalità e direttive speciali per task: «Modalità Piano (Plan Mode)», «Modalità Discussione & Requisiti (/grill-me)», «Soluzione Minimale (/ponytail)», «Modalità Ricerca Online» e inclusione selettiva del contesto dell'editor attivo (file aperti, selezione e posizione cursore).
  - Supporto per allegati visivi nei prompt: acquisizione e rendering di screenshot dagli appunti (`Ctrl+V`), trascinamento file o selezione da pulsante, sia nel `TaskEditor` che nel `Composer` della chat.
  - Autocompletamento contestuale dei comandi slash (`/`) e censimento automatico delle skill installate con visualizzazione chiara dei comandi nativi del guscio Studio e delle estensioni.
  - Vista aggregata delle code di tutti i progetti (`Ctrl+Alt+T`, o chip in barra con il totale dei task in attesa): visualizzazione e avvio diretto dei prompt senza cambiare workspace, con motivo esplicito quando un progetto non è pronto.
  - Avvio automatico dei task in coda (`autoDispatch`), attivabile per singolo progetto con lock anti-race e subordinato alla verifica di prontezza dell'agente.
  - Configurazione della barra dei progetti con ordinamento manuale stabile (`fixed`), oltre a «Ultimo aperto», «Priorità task» e «Alfabetico»; badge contatore dei task in attesa con 4 stili personalizzabili e anteprima rapida con avvio a 1-click al passaggio del mouse sulla tessera.
- **Superficie GUI e Transcript Avanzato:**
  - Switcher rapido e ciclo dei ruoli (`Ctrl+P` e `Alt+R`) nel Composer della GUI per alternare sequenzialmente tra `default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit`, `advisor`, impostando modello e livello di thinking associato.
  - Collegamenti interattivi ai file nel transcript della chat: cliccando su qualsiasi percorso di file nei chip di intestazione dei tool (`edit`, `write`, ecc.), nei link markdown o nei blocchi di codice, il file corrispondente viene aperto e visualizzato automaticamente nell'editor Monaco.
  - Raggruppamento unificato delle sequenze di esecuzione (`ToolGroup`): accorpa chiamate ai tool e blocchi di pensiero (`thinking`) intermedi in un unico elemento compatto ed espandibile con cronometro live tabulare, mantenendo la risposta finale dell'assistente in primo piano.
  - Supporto per tutti i comandi slash (`/`) e skill direttamente nella GUI, con palette dei comandi filtrabile e comandi grafici per gestione sessioni (`/login`, `/logout`, `/copy`, `/fork`, `/tree`, `/sessions`, `/drop`).
  - Indicatore visivo dello stato di avvio di OMP nella barra inferiore della chat, con accodamento e inoltro automatico dei prompt digitati durante l'inizializzazione.
  - Separazione visuale del contesto editor nei messaggi chat: i file aperti e il codice selezionato continuano a essere inviati nel prompt effettivo all'agente, ma nella grafica del messaggio vengono sostituiti da chip interattivi cliccabili (con indicazione file attivo, cursore o righe selezionate e anteprima comprimibile del codice), rimuovendo il testo raw dal fumetto utente.
- **Primo Avvio Guidato (Setup Wizard):**
  - Procedura di onboarding all'avvio con rilevamento semantico della configurazione mancante: download e installazione automatica di `omp` da GitHub Releases, configurazione shell Git Bash, installazione silenziosa del font monospazio Nerd nel profilo utente e wizard di configurazione credenziali/modelli nativo di `omp` ospitato in una scheda terminale protetta.
  - Chip `⚠ Setup` nella barra superiore che segnala configurazioni incomplete e consente di riaprire il wizard guidato in qualsiasi momento.
- **Notifiche OS e Allerte di Sistema:**
  - Notifiche toast native (Windows 10/11 e macOS) quando un agente richiede attenzione o termina un task mentre l'app è in background, con click-to-focus diretto sul progetto interessato.
  - Segnalazione visiva dell'attenzione: pallino rosso lampeggiante sull'icona della barra delle applicazioni di Windows e badge numerico con rimbalzo animato nel Dock di macOS.
  - Nuova sezione «Notifiche» nel centro impostazioni (`Ctrl+Alt+,`) con controllo abilitazione, scelta dello stile del testo (sintetico o completo con la domanda dell'agente), allerta visiva su icona, segnale sonoro e pulsante «Invia notifica di prova».
- **Centro Impostazioni e Personalizzazione Guscio:**
  - Centro impostazioni unificato (`Ctrl+Alt+,`) con sei sezioni (Generale, Notifiche, Barra progetti, Workspace/Editor & Terminale, Task & Agenti, Modelli).
  - Configurabilità avanzata dell'editor Monaco (font, dimensione, minimappa, ritorno a capo, tabulazione, numeri di riga) e del terminale (font, dimensione, scrollback, campanello sonoro, cursore), applicabili immediatamente a caldo.
  - Valori predefiniti globali dei nuovi task con possibilità di override per singolo progetto.
  - Componente `EmptyState` interattivo nel workspace e nel pannello agenti con inviti all'azione primari e griglia interattiva delle scorciatoie da tastiera.
  - Componente `AlertBanner` unificato per diagnostica ed errori di sistema con feedback azionabile e pulsanti di riprova immediata.
- **Release Pipeline e Packaging:**
  - Promozione diretta degli artefatti validati da Release Candidate a Stabile nel workflow GitHub Actions, con verifica crittografica di consistenza tra commit del tag stabile e commit della pre-release testata.
  - Validazione preventiva dell'allineamento dei quattro file di versione (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`) tramite `npm run release -- --check`.
  - Icona applicazione `icon.icns` per macOS e `icon.ico` per Windows con logo Pi neon luminescente e variante Pi glass ad alto contrasto.

### Changed
- Ottimizzazione delle prestazioni di streaming e avvio: suddivisione del bundle JavaScript con code-splitting dedicato per Monaco editor, xterm e Mermaid per ridurre il tempo di caricamento iniziale della WebView; micro-batching sincronizzato con requestAnimationFrame per lo streaming ad alta frequenza nel terminale e nella chat dell'agente eliminando blocchi o scatti della UI; abilitazione di Link Time Optimization (LTO), eliminazione dei simboli di debug e ottimizzazioni per la dimensione del binario nel profilo release di Rust.
- Riorganizzazione dell'interfaccia di `TaskEditor` e `Composer`: prompt del task al centro con textarea ad auto-dimensionamento dinamico, opzioni avanzate racchiuse in un pannello collassabile con riassunto visivo, e pulsanti di azione unificati.
- Design del transcript della chat: rimozione dei bordi laterali colorati decorativi in favore di indentazione proporzionale, luminanza delle superfici e chevron unificato a 90°; rimozione del limite di altezza a 10.5 righe sui blocchi di codice; scala tipografica dei titoli markdown con limite a 65 caratteri per riga sulla prosa.
- Animazioni fluide progressive: la chat accompagna comparsa, espansione e compattazione di tool e thinking con un reveal fluido di altezza e opacità senza salti del transcript, con pieno rispetto di `prefers-reduced-motion`.
- Esecuzione diretta dei tool nella GUI: rimossa la richiesta bloccante di approvazione per i comandi standard (bash, write, edit, eval), allineando il comportamento della GUI a quello della TUI tramite overlay `approvalMode: yolo`.

### Fixed
- Accessibilità completa (WAI-ARIA e WCAG AA): aggiunti `aria-label` descrittivi su tutti i pulsanti e controlli interattivi; focus trap con loop del tasto Tab e chiusura con `Esc` su modali, cassetti (`QueueDrawer`) e popover; risolto il disallineamento fra selezione e fuoco nella scheda `AskCard` tramite implementazione del `roving tabindex`; conformità del contrasto cromatico su tutti i badge e messaggi di errore (>= 4.5:1); annunci `aria-live` per i cambi di stato asincroni degli agenti.
- Lifecycle dei processi e gestione PTY/RPC: terminazione ad albero dei processi figli e discendenti (PowerShell, runtime OMP, processi figli) alla chiusura della scheda o dell'applicazione tramite Windows Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), eliminando processi orfani in background; interruzione immediata dell'agente su pressione del tasto stop (`Esc` / `Alt+C` / `Ctrl+C`) azzerando all'istante lo stato locale di streaming e inviando i frame di abort prioritari a OMP.
- Robustezza sessioni GUI e storico: unificazione della lettura dello storico da disco (`~/.omp/agent/sessions/`) e cronologia per riprendere regolarmente le sessioni create da task; sincronizzazione FIFO all'aggancio sessione evitando disallineamenti di messaggi; risolto il falso rilevamento di progetti attivi nel pannello consumi con riduzione della finestra di inattività a 2 minuti e pulizia automatica dei breadcrumb orfani.
- Autoscroll chat GUI: risolto il problema della perdita di ancoraggio durante lo streaming e la comparsa spuria del pulsante di scorrimento; lo scroll resta ancorato in fondo e si riaggancia automaticamente quando ci si riavvicina al fondo.
- Editor Monaco: ripristino e conservazione della posizione di scorrimento e cursore per ciascun file aperto al cambio di scheda o progetto.
- Correzioni grafiche ed ergonomiche: rimosso il doppio anello di focus durante la digitazione dei prompt; ripristino dell'altezza predefinita a riga singola della textarea dopo l'invio; corretta la barra di aiuto con i tasti di navigazione nella palette dei comandi slash; deduplicato l'incollamento di immagini dagli appunti (Ctrl+V) ed eliminati avvisi di log spuri all'avvio.
- Controllo aggiornamenti OMP CLI: estrazione affidabile della versione più recente dall'output di `omp update --check` con eliminazione delle sequenze ANSI e gestione degli errori di rete.
- Canale Nightly: l'aggiornamento propone sempre l'installer della build annunciata anche quando la prerelease conserva ancora quelli delle build precedenti, che vengono ora rimossi alla pubblicazione.

### Security
- Isolamento e sicurezza delle anteprime vettoriali SVG e prototipi UI: rendering eseguito all'interno di una sandbox iframe rigorosa (priva di privilegi script e con origine `null` disaccoppiata), protetto da Content Security Policy ermetica (`default-src 'none'`) e sanitizzazione preventiva con DOMPurify, neutralizzando vettori XSS, tag script ed handler malevoli.
- Integrità e sicurezza dell'updater di Studio e dell'installer OMP: calcolo e validazione obbligatoria dell'impronta crittografica SHA-256 rispetto ai digest pubblicati su GitHub Releases prima dell'esecuzione, confino dei comandi IPC e distruzione garantita dei file temporanei in caso di errore.
- Accesso ai database SQLite rigorosamente in sola lettura: apertura delle connessioni con flag `SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only = ON` e validazione delle query per prevenire mutazioni o lock concorrenti, delegando l'I/O al thread pool asincrono `tokio::task::spawn_blocking`.
- Isolamento del filesystem: tutti i percorsi relativi passano dalla validazione `resolve_path` con `canonicalize` e verifica del prefisso della radice del progetto, bloccando attacchi di directory traversal e symlink escaping.
- Registrazione dell'AUMID `sh.omp.studio` su Windows 10/11 per prevenire spoofing di script e garantire identità affidabile delle notifiche desktop.
## [1.1.0] - 2026-08-24

### Added

- La chat GUI mostra uno stato iniziale utile e una palette slash completa di
  firma, alias, descrizione e sottocomandi.
- I pannelli FILE, GIT, quote e anteprima mostrano gli errori reali e consentono
  di riprovare, invece di restare vuoti o su «Caricamento».
- Gli aggiornamenti possono seguire il canale stabile oppure Nightly, che riceve
  automaticamente le build più recenti senza esporle agli utenti stabili.

### Changed

- Le risposte, il ragionamento e i risultati degli strumenti si aggiornano
  progressivamente in Markdown mantenendo la vista agganciata in fondo.
- Le card degli strumenti mostrano già durante l'esecuzione percorsi, opzioni,
  task e dati strutturati; gli errori hanno uno stato visivo distinto.
- Dialoghi, menu e scorciatoie rispettano il fuoco attivo, si chiudono con
  `Esc` e usano i livelli e i colori semantici dell'interfaccia.

### Fixed

- La superficie GUI non si congela più appena omp pubblica l'identificativo
  della sessione: invio, transcript e menu restano reattivi.
- I messaggi dell'assistente, i delta di streaming e i risultati dei tool
  compaiono nel transcript invece di restare invisibili o perennemente attivi.
- I comandi slash vengono eseguiti una volta sola con `Invio`; quelli non
  disponibili nella GUI indirizzano esplicitamente alla scheda TERMINAL.
- `Invio` nel composer non approva più accidentalmente una chiamata a uno
  strumento mentre è visibile una richiesta di conferma.
- Il passaggio tra GUI e TERMINAL conserva la stessa sessione in entrambi i
  versi e la chiusura di un progetto termina il relativo processo omp.
- Le sessioni lunghe non perdono richieste RPC valide per risposte senza
  identificativo e i comandi shell dispongono del timeout esteso.
## [1.0.1] - 2026-08-24

### Fixed

- La scheda GUI resta utilizzabile quando la sessione da riprendere non esiste
  più: apre automaticamente una nuova chat invece di lasciare `omp` terminato.
## [1.0.0] - 2026-08-24

### Added

- Seconda superficie nativa per l'agente: la colonna destra diventa a schede
  `TERMINAL | GUI`, con handoff esplicito e conservazione della stessa sessione
  tramite `--resume`.
- Client nativo Svelte 5 che pilota `omp --mode rpc-ui` su stdio NDJSON con
  trasporto Rust a coalescenza di delta e riassemblaggio di chunk protocollo v2.
- Transcript nativo con rendering markdown, blocchi di ragionamento collassabili,
  30 card dedicate per i tool di sistema, gestione subagent e visualizzazione todo.
- Gate di approvazione strutturato con policy configurabile (`ask-writes`,
  `ask-all`, `yolo`) nel pannello impostazioni, salvata in locale senza toccare `~/.omp`.
- Intercettazione intelligente dei comandi slash e gestione della coda di prompt
  con interruttore steer/follow-up.
## [0.9.0] - 2026-08-24

### Added

- Ogni progetto dispone di una coda ordinabile di prompt: un task avvia una
  sessione pulita, passa automaticamente allo storico e mantiene il badge `TASK`.
- Le sessioni storiche si riprendono con un click nello stesso terminale, senza
  riavviare il processo `omp`.

### Fixed

- Gli aggiornamenti di Studio non propongono più installer destinati a un altro
  sistema operativo quando nella release manca il pacchetto compatibile.
- Ogni nuova release viene pubblicata solo dopo aver generato sia l'installer
  Windows x64 sia il DMG universale per Mac Intel e Apple Silicon.
## [0.8.1] - 2026-08-21

### Changed

- Il terminale su macOS tratta Option come Meta: le scorciatoie Alt di `omp`
  (es. Option+P per il selettore modelli) funzionano invece di inserire i
  caratteri speciali della mappatura italiana.

### Fixed

- Il terminale su macOS mostra di nuovo le icone Nerd Font: Studio include ora
  il proprio font monospazio con glifi Nerd e non dipende più dal font matching
  di sistema di WebKit, che su macOS 27 disegna i glifi privati come quadretti.
## [0.8.0] - 2026-08-21

### Added

- Nuovo tool `studio_preview` per l'agente: permette a `omp` di creare prototipi di
  componenti UI (React, Tailwind CSS, Lucide) e aprirli istantaneamente nella
  sandbox interattiva al centro dell'app durante il vibecoding.
- Salvataggio automatico dei prototipi generati nella cartella `proto/` del progetto,
  con aggiunta automatica a `.gitignore` per evitare di sporcare il working tree.
- Supporto per rendering e compilazione a caldo di componenti TSX/JSX, visualizzatore
  del codice sorgente con pulsante di copia rapida e switch del viewport (Desktop, Tablet, Mobile).
## [0.7.1] - 2026-08-21

### Fixed

- Il tool `studio_diagram` per la whiteboard dei diagrammi è ora caricato
  automaticamente in ogni sessione `omp` avviata da Studio: non serve più
  passare l'estensione a mano con `-e`.
## [0.7.0] - 2026-08-21

### Added

- Nuovo pannello GIT nella colonna sinistra: mostra il branch corrente, i file con
  modifiche non committate (con righe aggiunte/rimosse), l'ultimo commit dell'agente
  e lo storico recente. Un click su un file apre il confronto affiancato nell'editor,
  anche per le modifiche già committate — non serve più cercare a mano cosa ha
  toccato l'agente quando il suo lavoro finisce con un commit.
- Cambio branch e creazione di un nuovo branch direttamente dal pannello GIT,
  con blocco automatico quando ci sono modifiche non committate.
- Le sessioni recenti dell'agente compaiono nella timeline del pannello GIT:
  un click le riprende nel terminale del progetto con `--resume`.
- Whiteboard dei diagrammi: l'agente può usare il tool `studio_diagram` per
  disegnare un diagramma Mermaid che compare renderizzato e ingrandibile
  nella colonna centrale, al posto dell'ASCII art nel terminale.
- Anteprima live in sandbox per i file HTML: il pulsante "Anteprima"
  nell'editor apre il prototipo interattivo (desktop/tablet/mobile) senza
  uscire dall'app, isolato dal resto del sistema.
## [0.6.5] - 2026-08-20

### Changed

- Riprogettata la logica di raccomandazione dei modelli per i ruoli operativi: priorità assoluta ai modelli Tier 1/Top ELO dagli account in abbonamento (OAuth flat) per i ruoli principali e riserve cross-provider con safety-net gratuita (Zero-Cost).
- Integrazione delle metriche di velocità reali (token/sec misurati da `agent.db`) per la selezione ottimale dei ruoli veloci (`smol`, `commit`).
- Protezione totale dai costi imprevisti: esclusione automatica di modelli a consumo pay-per-token non inclusi negli abbonamenti dell'utente.
- Arricchiti i chip di suggerimento e i tooltip con badge informativi su Coding ELO stimato, velocità effettiva misurata (tok/s), provider in abbonamento e riserva a costo zero.
- Introdotto un motore di fallback deterministico basato sulla matrice ELO che garantisce raccomandazioni istantanee e resilienti anche in caso di latenza o disservizio temporaneo del motore AI.
## [0.6.4] - 2026-08-20

### Added

- Raccomandazione intelligente dei modelli per i ruoli operativi OMP basata su analisi AI one-shot in background: selezione contestuale dei migliori modelli primari e riserve di fallback cross-provider per garantire resilienza a rate-limit (429) e disservizi.
- Cache reattiva per le raccomandazioni AI con pre-filtraggio anti-obsolescenza e pulsante per forzare la rianalisi su richiesta.
## [0.6.3] - 2026-08-20

### Changed

- Riprogettata la gestione dei ruoli operativi OMP nel modale modelli con layout Master-Detail a due colonne e cassetto laterale dedicato al Ciclo Rapido (Ctrl+P).
- Introdotti suggerimenti intelligenti a 1-click basati sul catalogo reale per i modelli primari e le riserve di ciascun ruolo.
- Sostituito il menu a tendina del reasoning con il nuovo componente ReasoningSlider interattivo a gradini, con snapping, supporto da tastiera e indicazione visiva del budget token.
- Gestione riordinabile e potenziata delle catene di fallback con badge di provider, metriche di contesto/funzionalità e avvisi di ridondanza.
## [0.6.2] - 2026-08-20

### Changed

- Passaggio dall'installer Windows standard .msi al setup NSIS (.exe) leggero con modalità per-utente (`currentUser`), eliminando le richieste di permessi amministratore (UAC) e velocizzando l'installazione iniziale.
- Aggiornamento in-app completamente silenzioso: l'applicazione esegue il setup in background con riavvio automatico senza aprire procedure guidate esterne.
- Riprogettazione completa dell'interfaccia di gestione modelli e ruoli: rimossi tutti gli emoji decorativi e colori semantici non conformi in favore di badge tipografici monocolore, token di sistema e icone SVG pulite.
- Unificato il modello di persistenza nella gestione modelli: aggiunta la gestione a bozza per i provider personalizzati e protezione contro la perdita accidentale di modifiche non salvate alla chiusura del modale.
- Accessibilità e navigazione da tastiera nel selettore modelli e nei modali di sistema: aggiunta semantica WAI-ARIA (`role="dialog"`, `role="tablist"`, `role="listbox"`), supporto ai tasti freccia nel menu a discesa dei modelli e chiusura con `Esc`.
- Estesa l'assegnazione rapida dei fallback nel catalogo a tutti gli 8 ruoli operativi di OMP.
## [0.6.1] - 2026-08-19

### Added

- Aggiunto il pulsante "Ricontrolla" nell'intestazione e nel piè di pagina del modale di aggiornamento di OMP Studio, per consentire di verificare in qualsiasi momento la presenza di versioni ancora più recenti su GitHub bypassando la cache HTTP.
## [0.6.0] - 2026-08-19

### Added

- Gestione completa di provider, modelli e ruoli OMP integrata nella GUI: modale dedicato accessibile dalla barra superiore o con scorciatoia `Ctrl+Alt+M` (`Ctrl+Alt+,`).
- Assegnazione visiva dei modelli ai ruoli operativi OMP (`default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit`, `advisor`), livello di reasoning/thinking e ordinamento della sequenza di ciclo rapido (`Ctrl+P`).
- Gestione semplificata delle catene di fallback per ciascun ruolo con aggiunta rapida, eliminazione e riordinamento della priorità dei modelli di riserva.
- Rilevamento automatico e intelligente di nuove versioni dei modelli: pulsante dedicato per verificare la disponibilità di aggiornamenti (es. `opus-5` → `opus-5.1`, `gemini-3.6` → `gemini-3.7`) con finestra di riepilogo comparativa e applicazione in blocco a tutti i ruoli confermati.
- Esploratore del catalogo modelli OMP con ricerca full-text, filtri per provider e capacità (Vision, Reasoning), specifiche tecniche e azione rapida di assegnazione ai ruoli.
- Gestione dei provider supportati (attivazione/disattivazione e stato credenziali autenticate) e configurazione visiva di provider ed endpoint custom (OpenAI-compatibili, Ollama locali, proxy) in `models.json`.
- Pulsante per il riavvio immediato delle sessioni OMP nei terminali dei progetti aperti per applicare all'istante le modifiche alla configurazione dei modelli.
- Rilevamento dei provider e modelli utilizzati dai subagenti e dai fallback di `omp` nel popover dei consumi, mostrando il progetto in uso sotto ciascun fornitore attivo.
## [0.5.1] - 2026-08-19

### Added

- Evidenziazione della sintassi per i file SQL e formati di configurazione/script (.sql, .xml, .config, .csproj, .vbproj, .props, .targets, .resx, .py, .yaml, .toml, .ini, .sh, .ps1, .bat) nell'editor Monaco.
- Riconoscimento automatico e clic diretto sui percorsi di file e nomi menzionati nel terminale (es. "agents.md", percorsi relativi/assoluti, diff Git, tag snapshot `[file#tag:riga]` e numeri di riga `:riga:col`) per aprirli direttamente nell'editor.

### Fixed

- Apertura corretta dei link web cliccati nel terminale nel browser di sistema predefinito tramite il plugin opener.
## [0.5.0] - 2026-08-19

### Added

- Mostra il conto alla rovescia al reset per ciascun limite nel popover dei consumi (es. "· tra 1h 25m"), con data e ora esatta nel tooltip.

### Changed

- Nel popover dei consumi l'indicazione dei progetti in uso è mostrata una sola volta sotto l'intestazione del provider anziché sotto ogni singola barra di limite.

### Fixed

- Nella barra superiore il pallino di stato delle tessere di progetto (completato o attenzione richiesta) non viene più tagliato dal bordo arrotondato.
- Nel popover dei consumi l'animazione di aggiornamento ruota esclusivamente l'icona interna senza ruotare l'intero pulsante.
## [0.4.0] - 2026-08-17

### Added

- Controllo e installazione degli aggiornamenti di OMP Studio direttamente in app dalla barra inferiore, con verifica da GitHub Releases, download tracciato in percentuale e velocità, visualizzazione note di rilascio e riavvio per l'installazione.

### Changed

- Nell'editor le righe lunghe non vanno più a capo: scorrono in orizzontale mantenendo visibili i numeri di riga.
- Nel pannello consumi l'indicazione dei progetti che usano un provider mostra solo i nomi dei progetti.

## [0.3.1] - 2026-08-13

### Added

- Supporto completo cross-platform per macOS (Apple Silicon e Intel): shell PTY nativa ($SHELL zsh/bash), risoluzione automatica del binario `omp`, scorciatoie da tastiera con `Cmd` (⌘) e gestione percorsi POSIX.
- Iniezione automatica dei percorsi binari utente (`~/.bun/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, ecc.) nella variabile `$PATH` per le sessioni PTY su macOS.

### Fixed

- Corretto errore di compilazione `libsqlite3-sys` con versioni recenti del compilatore Rust.
- Risolto limite di memoria V8 durante la build frontend di Monaco Editor.
## [0.3.0] - 2026-08-03

### Added

- Apri più file nello stesso progetto come schede dell'editor, con diff e chiusura su ogni scheda; `Ctrl+W` e `Ctrl+F4` chiudono il file attivo.
- Rinomina un progetto e imposta una sigla personale di più caratteri dal suo riquadro.

### Changed

- Il selettore temi separa chiari e scuri in due tab, riapre sull'ultima tab usata e mostra il nome del tema applicato accanto al colore.
- I colori automatici dei progetti seguono ora la palette e la luminanza del tema attivo; le scelte manuali restano invariate.
- Il percorso nel riquadro di un progetto viene ellissato senza uscire dal bordo.
## [0.2.1] - 2026-08-03

### Added

- Aggiunge i 48 temi chiari builtin di `omp` e li separa dai 52 temi scuri nello
  switcher; la scelta aggiorna insieme guscio, editor, terminale e sessioni `omp`.

### Changed

- All'avvio riconosce anche `theme.light` quando `theme.dark` non è impostato.

## [0.2.0] - 2026-08-03

### Added

- Il pannello consumi si apre e si chiude con `Ctrl+Alt+U`, senza staccare le mani
  dalla tastiera. La scorciatoia è indicata anche nel suggerimento del pulsante.
- Sotto ogni barra del pannello consumi c'è ora scritto chi sta usando quella quota
  in questo momento — per esempio "In uso da: OMP Studio · AreaIT, Windows Terminal ·
  GestioneFlotta" — così si sa subito se il conto lo sta facendo salire un'altra
  finestra. Se nessuno la sta usando non compare niente.
- Selettore di tema nella barra superiore: 52 temi scuri di `omp`, con filtro.
  Cambia insieme i colori di Studio e quelli della TUI, che d'ora in poi partono
  dallo stesso tema. All'avvio Studio adotta da solo il tema già scelto in `omp`.
- `Ctrl+click` su un percorso di file stampato dall'agente lo apre nell'editor, alla
  riga indicata. I percorsi fuori dalla cartella del progetto vengono ignorati.

### Changed

- Interfaccia più silenziosa: gli stati dell'agente non usano più aloni luminosi
  colorati né verde e blu. Restano un anello e un punto in due soli colori —
  cremisi quando lavora o ha finito, ambra quando aspetta una risposta.
- La barra superiore non si ingrandisce più al passaggio del mouse: schede, logo e
  spaziature restano fermi. È ora alta 48px, con schede e logo proporzionati.
- Un solo progetto colorato per volta: la scheda attiva è piena nel colore del
  progetto, le altre sono neutre con la sola iniziale tinta. Prima ogni progetto
  aperto era un blocco saturo.
- Una sola animazione continua in tutta l'app, al posto di sette: il respiro della
  scheda "al lavoro", ridisegnato per non tenere occupata la scheda video a riposo.
- Nel riquadro della scheda il percorso viene troncato al centro invece di scorrere
  avanti e indietro: la coda del percorso è la parte che serve.
- Colori e raggi dell'interfaccia derivano ora da poche costanti, quindi stati come
  "riga sotto il mouse" o "riga selezionata" si comportano allo stesso modo in ogni
  pannello, anche sopra il terminale e dentro i popover.
- Le colonne si separano per differenza di sfondo invece che per linee: spariti i
  divisori verticali e i bordi sotto le intestazioni. Le righe dell'albero
  svaniscono passando sotto l'intestazione, e il divisore trascinabile compare in
  cremisi solo quando ci passi sopra.

### Removed

- Sfocatura di sfondo dietro le finestre di dialogo: costava un ridisegno continuo
  del terminale sottostante senza aggiungere informazione.
## [0.1.0] - 2026-07-30

### Added

- Prima versione pubblica: guscio desktop multi-progetto per l'agente `omp`, con
  terminale integrato, albero dei file, editor e pannello consumi in una sola finestra.
- Barra dei progetti in alto: ogni progetto è una scheda con il proprio terminale
  sempre vivo, ordinamento automatico per ultimo uso e colore personalizzabile
  (palette di otto tonalità o selettore libero).
- Stato dell'agente leggibile a colpo d'occhio sulla scheda e nella barra inferiore:
  inattivo, al lavoro, in attesa di una risposta, lavoro concluso.
- Selettore di progetti dal pulsante `+` o con `Ctrl+Alt+N`: elenca le cartelle nella
  radice dei repository segnalando quelle già aperte, e permette di sfogliarne altre.
- Albero dei file con icone per tipo, indicatori di stato Git (modificato, aggiunto,
  non tracciato, rimosso, rinominato) e aggiornamento automatico quando l'agente
  tocca un file.
- Editor Monaco con confronto affiancato rispetto alla versione in Git, marcatori nel
  margine per le righe cambiate, indicatore di modifiche non salvate e salvataggio
  con `Ctrl+S`. Ogni progetto ricorda il file che aveva aperto.
- Anteprima dal vivo per Markdown e SVG accanto all'editor, con divisorio trascinabile,
  e visualizzatore dedicato per le immagini con zoom, spostamento e ripristino 1:1.
- Elenco e ricerca full-text delle sessioni dell'agente, per riprendere un lavoro
  interrotto senza cercarlo a mano.
- Pannello consumi con quota residua per fornitore, aggiornamento manuale, indicazione
  dell'ultimo aggiornamento e animazioni di riempimento delle barre.
- Controllo e installazione degli aggiornamenti di `omp` dalla barra inferiore, con
  conferma, log e proposta di riavvio.
- Controlli finestra nativi integrati nella barra superiore e ripristino di posizione
  e dimensione all'avvio.
