# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added
- Notifiche di sistema e allerta su icona (Dock e barra delle applicazioni): quando un agente richiede un intervento o una risposta mentre Studio è in background o su un altro progetto, l'app mostra una notifica toast (Windows/macOS) e aggiunge il pallino rosso all'icona della barra delle applicazioni di Windows (con breve flash) o il badge numerico con rimbalzo nel Dock di macOS. Cliccando sulla notifica, Studio viene portato in primo piano aprendo direttamente il progetto interessato.
- Nuova sezione «Notifiche» nel centro impostazioni (`Ctrl+Alt+,`): controlli per attivare/disattivare le notifiche toast del sistema operativo, configurare lo stile del messaggio (sintetico fisso o completo con la domanda dell'agente), abilitare gli avvisi visivi sull'icona e gestire il segnale sonoro.
- Centro impostazioni unificato (`Ctrl+Alt+,`) con cinque sezioni — Generale, Barra progetti, Editor & Terminale, Task & Agenti, Modelli: la configurazione di modelli e ruoli diventa una sezione di questo pannello e resta raggiungibile direttamente con `Ctrl+Alt+M`.
- La barra dei progetti non si riordina più da sola: l'ordine è manuale, si cambia trascinando le tessere (o con `Ctrl+Alt+Maiusc+Frecce`) e resta quello anche dopo un riavvio. Restano disponibili gli ordinamenti «Ultimo aperto» (il comportamento precedente), «Priorità task» e «Alfabetico».
- Le tessere della barra mostrano quanti task attendono in coda, con quattro stili a scelta: numero con indicazione di prontezza, solo numero, puntino o niente.
- Avvio dei task direttamente dalla barra: passando su una tessera, il pannello elenca i task in attesa e li lancia sul posto senza cambiare progetto; `Ctrl+click` avvia e apre il progetto.
- Nuova vista aggregata delle code (`Ctrl+Alt+T`, o il chip in barra col totale dei task in attesa): tutte le code di tutti i progetti in un elenco unico, con avvio diretto e motivo esplicito quando un progetto non è pronto.
- Avvio automatico del prossimo task, attivabile progetto per progetto: quando l'agente di quel progetto torna libero, il primo task della coda parte da solo. Spento di default.
- Dimensione e famiglia del font, minimappa, ritorno a capo, ampiezza tabulazione e numeri di riga dell'editor sono configurabili, così come font, dimensione, scrollback, campanello e cursore del terminale: le modifiche si applicano subito, senza riavviare le sessioni.
- Valori predefiniti dei nuovi task configurabili (ruolo, livello di ragionamento, modalità Discussione/Piano/Minimale/Ricerca, contesto editor), con possibilità di sovrascriverli per singolo progetto.
- Impostazioni generali: superficie con cui nasce un progetto nuovo (Terminale o GUI), cosa fare della coda quando si chiude un progetto che ha task in attesa, cartella radice dei progetti e canale di aggiornamento.
- Primo avvio guidato: all'apertura Studio verifica che `omp` sia installato, autenticato e con un modello predefinito, e apre un modal che accompagna solo i passaggi che mancano davvero.
- Se `omp` non è installato, Studio lo scarica dalle release ufficiali con barra di progresso, ne verifica l'impronta SHA-256 pubblicata e lo installa senza chiedere privilegi di amministratore; configura anche Git Bash come shell di `omp` quando non è già impostata.
- Il setup dei provider, del modello, dei glifi, del composer e del tema è quello nativo di `omp`, eseguito in una scheda di terminale dentro il modal: le stesse scene del terminale, senza doverle imparare due volte. Il modal si chiude solo quando la configurazione è davvero utilizzabile, e se il setup viene abbandonato a metà dice cosa manca e permette di riaprirlo.
- Il tema del guscio adotta quello scelto durante il setup di `omp`, invece di sovrascriverlo.
- Installazione silenziosa del font Nerd nel profilo utente, così le icone di `omp` si vedono anche nei terminali esterni a Studio.
- Al termine Studio propone la cartella dei progetti in cui hai più repository, col conteggio, e permette di aprirne subito uno.
- Chip `⚠ Setup` nella barra superiore: compare solo quando alla configurazione di `omp` manca qualcosa e riapre il primo avvio guidato.
- Nuovo editor di task a sezioni con layout scrollabile: textarea compatta, pulsanti primari espliciti «Salva e Chiudi» (`Esc`) e «Salva e Avvia subito» (`Ctrl+Invio`), ed eliminazione con conferma rapida.
- Selezione del livello di complessità e profilo di ruolo (`smol`, `default`, `slow`, `plan`, `custom`) per ciascun task, con sincronizzazione e override libero del modello specifico e dello slider di thinking effort.
- Modalità e direttive speciali attivabili tramite spunte dedicate nell'editor di task: «Modalità Piano (Plan Mode)», «Modalità Discussione & Requisiti (/grill-me)», «Soluzione Minimale (/ponytail)», «Modalità Ricerca Online» e inclusione selettiva del contesto editor.
- Autocompletamento contestuale dei comandi slash (`/`) a qualsiasi posizione nel testo del prompt (sia nell'editor dei task che nel Composer della chat): rileva la posizione del cursore e sostituisce chirurgicamente il solo token del comando senza alterare il resto del testo.
- Badge visivi per i task nella lista della coda (`AgentPanel`) con indicazione a colpo d'occhio del profilo di ruolo (`⚡ smol`, `⌘ default`, `∞ slow`, `◆ plan`) e dei tag delle modalità attive (`Plan`, `Grill-Me`, `Ponytail`, `Research`, allegati).
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
- Nella palette dei comandi slash (`/`), le skill dell'agente vengono censite con il loro nome pulito (es. `/pubblicazione-progetto` oltre all'alias `/skill:pubblicazione-progetto`), badge visivo dedicato `Skill` in evidenza e descrizione dettagliata, caricate automaticamente all'apertura della sessione.
- Raggruppamento unificato delle sequenze di esecuzione nella chat GUI: le chiamate ai tool e i relativi blocchi di ragionamento (`thinking`) intermedi vengono accorpati in un unico blocco compatto (`ToolGroup`), evitando frammentazioni nel transcript ed evidenziando chiaramente la risposta finale dell'assistente.
- Nuova modalità «Modalità Ricerca Online» nello step di creazione ed editing dei task: istruisce l'agente ad approfondire l'ambito e la richiesta con ricerche online mirate (documentazione, riferimenti, librerie e best practice) dopo aver completato l'analisi del repository e del codice collegato prima di applicare modifiche.

### Fixed
- Interruzione immediata dell'agente con priorità massima: la pressione del pulsante di stop (o `Esc` / `Alt+C` / `Ctrl+C`) azzera all'istante lo stato locale di streaming, arresta le card dei tool e i subagent in corso, svuota le richieste in sospeso e sblocca l'interfaccia a latenza zero, inviando i frame di abort prioritari a OMP ed eliminando i falsi allarmi di timeout a 60 secondi.
- Generato e incluso l'asset icona `icon.icns` per il Dock su macOS e per i bundle multipiattaforma (`bundle.icon`), garantendo che il Dock e la barra delle applicazioni mostrino sempre l'icona Pi aggiornata dell'applicazione.
- Rimosso il doppio anello di focus durante la digitazione dei prompt nella chat GUI (eliminato il contorno `:focus-within` sul contenitore dell'input ed eliminato ogni outline/ring nativo o globale sulla textarea del Composer).
- Risolto il falso rilevamento di progetti e quote in uso nel pannello dei consumi: i progetti GUI vengono considerati attivi solo quando l'agente o i subagenti stanno effettivamente generando risposte o eseguendo tool, la finestra di inattività per le sessioni terminale è ridotta a 2 minuti (evitando di considerare attive sessioni completate in precedenza o chiuse) e i breadcrumb orfani dei PTY terminati vengono ripuliti automaticamente.
- Ripristino immediato dell'altezza predefinita a riga singola per la textarea del prompt nel Composer della chat dopo l'invio o la cancellazione del messaggio, evitando che rimanga espansa a vuoto quando si inviano prompt lunghi o multilinea.
- Risolto il blocco permanente delle sessioni create da task su GUI con stato «in sincronizzazione» e riga non cliccabile: la lettura dello storico unifica i file di sessione persistiti su disco (`~/.omp/agent/sessions/`) e la cronologia, consentendo di riprendere regolarmente le sessioni anche dopo la chiusura o il riavvio di Studio.
- Supporto unificato per tutti i comandi slash (`/`) nella chat e nell'editor dei task della superficie GUI: rimossa ogni restrizione che imponeva il passaggio alla scheda TERMINAL. Tutti i comandi builtin di configurazione/stato di `omp` (`/fast`, `/security`, `/todo`, `/mcp`, `/jobs`, `/tools`, `/context`, `/ssh`, `/dirs`, `/plugins`, `/export`, ecc.) e le modalità/prompt dell'agente (`/plan`, `/plan-review`, `/vibe`, `/goal`, `/loop`, `/init`, `/green`, `/review`, e tutte le skill `/skill:...`) vengono eseguiti direttamente dalla GUI.
- Integrazione grafica nativa per i comandi di sessione e autenticazione nella GUI: `/login` e `/logout` aprono il pannello di gestione Provider, `/copy` copia l'intera trascrizione negli appunti, `/fork` crea una nuova diramazione di sessione, `/tree` e `/sessions` aprono lo storico laterale, e `/drop` guida alla gestione dei rami.
### Changed
- Nuova icona dell'applicazione e logo topbar: icona Pi neon luminescente per temi scuri e dock/taskbar, e variante Pi glass scura ad alto contrasto per temi chiari nella barra superiore.
- Rimosso ogni bordo laterale colorato (side-stripe) da card dei tool, messaggi utente, righe dei subagent e modali di aggiornamento: la gerarchia visiva del transcript e' ora affidata all'indentazione proporzionale, alla luminanza delle superfici e al pallino di stato, nel rispetto del design system.
- Struttura dei turni di esecuzione unificata e appiattita: rimossi i contenitori annidati a piu' livelli e rimosso il limite di altezza a 10.5 righe sui blocchi di codice, che ora scorrono liberamente col transcript.
- Unificato il vocabolario di espansione in tutto il pannello (chevron che ruota a 90° su tool, thinking, blocchi di codice, task e json), eliminato ogni keyframe ridondante fuori da `app.css` e limitato il respiro `state-pulse` al solo gruppo di esecuzione attivo.
- Cronometro live sull'esecuzione dei tool e dei gruppi: il tempo trascorso viene visualizzato e aggiornato in tempo reale con allineamento numerico tabulare, evitando che l'utente debba distinguere uno stato di lavoro da un blocco.
- Scala tipografica dei titoli markdown, limite a 65 caratteri per riga sulla prosa, e rimozione delle label con testo in maiuscolo tracciato (eyebrow uppercase) da tutti i renderer dei tool.
- La chat accompagna la comparsa, l'espansione e la compattazione di tool, thinking, richieste e righe di sistema con un reveal fluido di altezza, opacita' e messa a fuoco, eliminando i salti del transcript e rispettando il movimento ridotto.
### Fixed
- Risolto il disallineamento fra selezione e fuoco nella scheda di richiesta (`AskCard`): implementato il roving tabindex in modo che la selezione con le frecce sposti contemporaneamente il fuoco tastiera, evitando l'invio accidentale di un'opzione diversa da quella evidenziata.
- Corretto il contrasto di tutte le etichette e badge di errore e fallimento nel transcript (ora sempre conformi alla soglia WCAG >= 4.5:1), unificando la semantica d'errore sul colore dedicato ed eliminando l'uso improprio del colore brand come testo.
- Ripristinati gli indicatori di fuoco visibili (`:focus-visible` e `:focus-within`) sul campo di scrittura del prompt e sui controlli interattivi della GUI, con pulsante di arresto differenziato graficamente da quello di invio.
- Spostato il selettore «steer / follow-up» dal campo di scrittura del prompt
  direttamente sui singoli chip dei messaggi in coda, consentendo di digitare e
  inviare direttamente con Invio e commutare il comportamento dall'interfaccia della coda.
- Rimossa la richiesta bloccante dei permessi/approvazioni nella GUI per l'esecuzione dei tool
  (bash, write, edit, eval, ecc.): le azioni vengono eseguite direttamente e senza interruzioni,
  allineando il comportamento della GUI a quello della TUI.
- Rimosso il pannello «Approvazioni» dal modale di gestione modelli e l'estensione di gate delle approvazioni.
- Rimosso il selettore fisso «steer / follow-up» dalla barra di inserimento del prompt.
### Fixed

- Controllo aggiornamenti OMP CLI: corretto il rilevamento delle nuove versioni dall'output di `omp update --check`, con eliminazione delle sequenze ANSI, estrazione della versione più recente e gestione affidabile degli errori di rete, segnalando tempestivamente la nuova versione nella barra di stato e consentendone l'aggiornamento diretto.
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
