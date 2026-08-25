# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added
- Switcher rapido e ciclo dei ruoli (`Ctrl+P` e `Alt+R`) nel Composer della GUI: `Ctrl+P` cicla sequenzialmente tra i ruoli configurati (`default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit`, `advisor`), impostando modello e livello di thinking associato e visualizzando il chip di ruolo attivo (`⌘ default`, `◆ plan`, ecc.).
- Menu rapido dei ruoli (`Alt+R`) con ricerca per nome/descrizione/modello, navigazione da tastiera e pulsante rapido per aprire la configurazione completa (`Ctrl+Alt+M`).
- Supporto per il comando slash `/role` (con sottocomandi per impostare ruoli specifici o ciclare al successivo con `/role next`).
- Collegamenti interattivi ai file nel transcript della chat: cliccando su qualsiasi percorso di file (nei chip di intestazione/dettaglio dei tool come `edit` e `write`, nei link markdown o nei blocchi di codice inline che contengono percorsi del progetto) il file corrispondente viene aperto e visualizzato automaticamente nell'editor Monaco.
- Indicatore visivo dello stato di avvio di OMP nella barra inferiore della chat, con badge dedicato, spinner nel chip del modello e possibilità di scrivere e inviare prompt immediatamente durante l'inizializzazione, che vengono accodati e inoltrati in automatico non appena OMP è pronto.
- Inclusione automatica del contesto dell'editor (file aperti, file attivo in focus con posizione cursore ed eventuale testo selezionato) nei prompt inviati a omp.
- Nella colonna centrale dell'editor di task, alla creazione di un nuovo task il focus si posiziona automaticamente sull'area di scrittura, che diventa un rich input con supporto per allegare e visualizzare screenshot (tramite incolla, trascina o pulsante) e autocompletamento interattivo dei comandi slash (`/`) con palette dei comandi censiti da omp e Studio.
- Scorciatoie da tastiera di `omp` nella superficie GUI: `Ctrl+P` per ciclare i ruoli configurati, `Alt+R` per il menu ruoli, `Alt+P` per il catalogo modelli, `Alt+M` per il menu thinking, `Alt+T` per ciclare rapidamente il ragionamento, `Alt+Q` per le impostazioni della coda, `Alt+S` per alternare lo steering, `Alt+C`/`Ctrl+C` per interrompere o cancellare il testo, `Alt+E` per mettere a fuoco il composer e `Alt+H`/`Alt+K`/`F1` per la guida completa delle scorciatoie.
- La palette dei comandi slash (`/`) include i comandi nativi del guscio Studio
  (`/new`, `/clear`, `/resume`, `/compact`, `/thinking`, `/role`, ecc.) con badge di origine
  visibile, sottocomandi interattivi e anteprima dettagliata.
- Raggruppamento unificato delle sequenze di esecuzione nella chat GUI: le chiamate ai tool e i relativi blocchi di ragionamento (`thinking`) intermedi vengono accorpati in un unico blocco compatto (`ToolGroup`), evitando frammentazioni nel transcript ed evidenziando chiaramente la risposta finale dell'assistente.

### Fixed
- Risolto il blocco permanente delle sessioni create da task su GUI con stato «in sincronizzazione» e riga non cliccabile: la lettura dello storico unifica i file di sessione persistiti su disco (`~/.omp/agent/sessions/`) e la cronologia, consentendo di riprendere regolarmente le sessioni anche dopo la chiusura o il riavvio di Studio.

### Changed
- Differenziata chiaramente la grafica dei messaggi inseriti dall'utente nel transcript della chat rispetto al testo generato: ogni messaggio utente ha ora un blocco dedicato con sfondo `--bg-raised`, bordo con accento a sinistra e badge `› Tu` (o attribuzione personalizzata), rendendo immediata la distinzione rispetto alle risposte dell'assistente.
- Ottimizzato il comportamento del gruppo strumenti (`ToolGroup`) nella chat: durante l'esecuzione rimane chiuso e compatto di default per evitare salti o aperture a flash dei singoli tool, aggiungendo e aggiornando i chip e l'intento con animazioni fluide (`slide` e transizioni CSS morbide).
- Blocchi di codice nelle risposte dell'assistente resi collassabili ad accordion cliccando sull'intestazione (con indicatore del numero di righe e pulsante di copia dedicato), con altezza massima fissata a 10.5 righe, scorrimento interno e sfumatura d'ombra sul fondo in presenza di contenuto eccedente.
- La chat GUI presenta le risposte con una cadenza continua anche quando il
  provider invia blocchi grandi, restando circa mezzo secondo dietro al dato in
  arrivo: i caratteri compaiono con una dissolvenza progressiva invece di
  apparire a scatti, e lo stato «Sta pensando» resta visibile.
- Spostato il selettore «steer / follow-up» dal campo di scrittura del prompt
  direttamente sui singoli chip dei messaggi in coda, consentendo di digitare e
  inviare direttamente con Invio e commutare il comportamento dall'interfaccia della coda.
- Rimossa la richiesta bloccante dei permessi/approvazioni nella GUI per l'esecuzione dei tool
  (bash, write, edit, eval, ecc.): le azioni vengono eseguite direttamente e senza interruzioni,
  allineando il comportamento della GUI a quello della TUI.
- Rimosso il pannello «Approvazioni» dal modale di gestione modelli e l'estensione di gate delle approvazioni.
- Rimosso il selettore fisso «steer / follow-up» dalla barra di inserimento del prompt.
### Fixed

- Risolto un bug grafico nella palette dei comandi slash (`/`) per cui la barra di aiuto con i tasti di navigazione (`↑↓ naviga`, `Invio seleziona`, `Esc chiude`) non rimaneva fissata al fondo durante lo scorrimento e si sovrapponeva all'elenco dei comandi.
- Risolto il problema dell'inserimento duplicato delle immagini quando incollate dagli appunti (Ctrl+V) nel campo di scrittura o nell'editor dei task.
- Filtrati gli avvisi interni di sistema relativi al montaggio dei tool MCP (`xd://: mounted mcp__...`) per evitare messaggi di log e avvisi spuri all'avvio della sessione.
- Risolto il caricamento e l'incollamento delle immagini nel prompt della GUI (Composer e Task Editor): abilitata la decodifica diretta in memoria via `createImageBitmap` con fallback su data URL e aggiunta l'origine `blob:` alla Content Security Policy (`img-src`), consentendo di allegare screenshot e immagini dagli appunti (Ctrl+V), da file o tramite drag & drop senza errori.
- L'editor ricorda la posizione di scorrimento e del cursore di ogni file: passando da un progetto all'altro, o da un tab all'altro, il documento riprende da dove era stato lasciato invece di tornare in cima.
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
