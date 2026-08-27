# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added

- Il pannello di un progetto si apre anche col **click destro** sulla tessera (o col tasto `Menu`): resta fissato finché non scegli un comando, premi `Esc` o clicchi fuori. Il menu contestuale della WebView, con voci come «Ricarica» e «Stampa», non compare più da nessuna parte dell'app tranne nei campi di testo, nell'editor e nel terminale, dove serve per copiare e incollare.
- Menu contestuale tematizzato uniforme in tutta l'applicazione: click destro nei campi di testo, nell'editor di codice, nel terminale e nell'albero dei file apre un menu coerente con il tema attivo, con icone, scorciatoie di sistema (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `Ctrl+A`, `Ctrl+S`, `Ctrl+W`) e navigazione completa da tastiera (`Freccia Giù/Su`, `Home`, `End`, `Invio`, `Esc`).
- Gestione file e cartelle dall'albero: creazione rapida inline di nuovi file e cartelle, rinomina e spostamento nel Cestino con aggiornamento immediato delle schede aperte nell'editor, sincronizzazione dei badge Git e protezione contro la perdita di modifiche non salvate.
- Menu contestuale sulle schede dell'editor per salvare, aprire il diff, copiare il percorso, mostrare il file nel file manager di sistema (Esplora file / Finder), chiudere la scheda o chiudere tutte le altre.
- Nuove azioni nel pannello del progetto: copia percorso, apri nel terminale, apri nell'editor esterno, nuovo task, interruttore dell'avvio automatico dei task, spostamento della tessera e chiusura degli altri progetti.
- Il pannello dice in una riga cosa sta facendo l'agente e, quando un task in coda non può partire, il motivo per cui non parte.
- Nuova opzione «Larghezza chat» nelle impostazioni generali: permette di scegliere tra il layout centrato con margini bilanciati per la leggibilità e il layout a tutta colonna.

### Changed

- Tutte le icone di Studio vengono da un unico set disegnato (Lucide) al posto delle emoji del sistema: stesso tratto, stessa dimensione e stesso colore del tema su Windows e su macOS.
- Il colore di un progetto si sceglie da una striscia di tinte resa con i colori del tema: ogni tinta mostrata è esattamente quella che prenderà la tessera. Spariti il pallino arcobaleno e il selettore di colori del browser, che promettevano sedici milioni di colori per poi conservarne uno su quarantamila.
- I pallini delle tinte predefinite mostrano il colore reale della tessera nel tema attivo, non più una tonalità fissa diversa dal risultato.
- La tessera del progetto non mostra più il tooltip col nome: nome e percorso sono già nel pannello.
- Il pannello del progetto ha una larghezza fissa: con task in coda dai prompt lunghi non si allarga più oltre il bordo dello schermo.
- Il pannello non viene più tagliato dalla barra dei progetti, si ribalta verso l'alto quando in basso non c'è spazio e resta agganciato alla tessera anche facendo scorrere la barra.
- Il pannello aperto col click destro è navigabile da tastiera e chiude restituendo il fuoco alla tessera.
- Lo slider dello sforzo di ragionamento è una pillola col riempimento nel colore del tema: i pallini dei livelli non hanno più le etichette e attirano magneticamente il pomello durante il trascinamento.
- Il chip dello slider di ragionamento mostra unicamente l'identificativo del livello (minimal, low, medium, high, xhigh, max, auto, off), rimuovendo il conteggio e i riferimenti numerici ai token dedicati.
- Nell'editor di un nuovo task il modello e lo sforzo di ragionamento mostrano subito quelli del ruolo predefinito, invece di restare vuoti finché non si ritocca il ruolo.
- La barra dei progetti è stata rifatta: ogni tessera mostra un punto nel colore del progetto e la sua sigla, e il progetto aperto allarga la propria tessera per scrivere il nome per intero. Il colore identifica sempre tutti i progetti, anche quelli chiusi, e non c'è più nessun rettangolo colorato pieno in cima allo schermo.
- Il nome del progetto attivo non è più scritto al centro della barra: è dentro la sua tessera, scritto una volta sola.
- Cambia il segnale di stato sulle tessere: pulsa l'anello ambra del progetto che **aspetta una risposta**, mentre «sta lavorando» si legge dal punto pieno e dalla sigla accesa, più un piccolo arco che gira sulla tessera aperta. Prima si muoveva ogni progetto al lavoro e restava fermo proprio quello che aveva bisogno di te.
- Un progetto senza agente aperto sbiadisce: punto neutro e sigla tenue, senza sparire dalla barra.
- A ogni cambio di stato dell'agente la tessera lampeggia una volta nel colore del progetto: te ne accorgi con la coda dell'occhio anche mentre leggi il terminale.
- Il contatore dei task in coda è dentro la tessera del progetto aperto invece di essere un bollino sovrapposto: resta nei quattro stili di sempre, e il totale su tutti i progetti continua a essere nel chip «Coda».
- L'impostazione «Puntino di stato agente» si chiama «Segno di stato agente» e accende o spegne i due anelli di stato; «Etichetta tessera» diventa «Nome sulle tessere» e sceglie se il nome del progetto compare solo sulla tessera aperta o su tutte.

### Fixed

- Rimosso il limite rigido di 65 caratteri sui paragrafi Markdown della chat, che causava l'andata a capo anticipata del testo lasciando spazio vuoto solo a destra rispetto alle card dei tool.

## [1.2.0] - 2026-08-26

### Added

- I task di ogni progetto vivono in `.omp/tasks.json` dentro il progetto stesso: restano accanto al codice, si escludono da git da soli e i task già presenti in Studio vengono migrati automaticamente.
- Studio e il terminale condividono la stessa coda in tempo reale: ciò che aggiungi da una parte compare subito dall'altra, senza conflitti di scrittura.
- Nuovo comando `/tasks` nel terminale: overlay a schermo intero per scorrere i task con le frecce, cambiarne lo stato con `Spazio`, aggiungerne con `A`, eliminarne con `D`, riordinarli con `J`/`K` e avviarli con `Invio`.
- L'agente gestisce la coda del progetto da sé con il nuovo strumento `project_tasks` (elenco, aggiunta, modifica, eliminazione, riordino), disponibile in tutte le sessioni.
- I task hanno stati reali — in corso, completato, abbandonato — con indicatori visibili nel pannello agente e nel cassetto delle code.
- Nuovo editor dei task a sezioni: prompt al centro, scelta del profilo di ruolo (`smol`, `default`, `slow`, `plan`, personalizzato), regolazione dello sforzo di ragionamento e pulsanti «Salva e chiudi» (`Esc`) e «Salva e avvia subito» (`Ctrl+Invio`).
- Direttive rapide per i task: Modalità Piano, Discussione & Requisiti, Soluzione Minimale e Ricerca Online, con inclusione facoltativa del contesto dell'editor (file aperti, selezione, posizione del cursore).
- Allegati visivi nei prompt: incolla uno screenshot con `Ctrl+V`, trascina un file o scegline uno dal pulsante, sia nell'editor dei task sia nella chat.
- Completamento automatico dei comandi `/` con l'elenco delle skill installate, distinguendo i comandi di Studio da quelli dell'agente.
- Vista unica delle code di tutti i progetti (`Ctrl+Alt+T`, o il chip in barra col totale dei task in attesa): avvii il prompt di un altro progetto senza cambiare workspace e vedi il motivo quando un progetto non è pronto.
- Avvio automatico dei task in coda, attivabile progetto per progetto, che parte solo quando l'agente è davvero pronto.
- Barra dei progetti configurabile: ordine manuale, ultimo aperto, priorità dei task o alfabetico, con contatore dei task in attesa in quattro stili e anteprima ad avvio immediato al passaggio del mouse.
- Cambio rapido dei ruoli nella chat (`Ctrl+P` e `Alt+R`) fra `default`, `plan`, `smol`, `slow`, `vision`, `task`, `commit` e `advisor`, con modello e livello di ragionamento associati.
- Percorsi di file cliccabili in tutta la chat: dai chip dei tool, dai link markdown o dai blocchi di codice il file si apre direttamente nell'editor.
- Le sequenze di esecuzione dell'agente sono raccolte in un unico blocco espandibile con cronometro, così la risposta finale resta in primo piano.
- Tutti i comandi `/` e le skill funzionano anche nella chat grafica, comprese le operazioni sulle sessioni (`/login`, `/logout`, `/copy`, `/fork`, `/tree`, `/sessions`, `/drop`).
- La chat mostra lo stato di avvio dell'agente e accoda i prompt scritti durante l'inizializzazione, inoltrandoli appena è pronto.
- Il contesto dell'editor allegato ai messaggi diventa un chip cliccabile con anteprima richiudibile, al posto del testo grezzo nel fumetto.
- Primo avvio guidato: Studio rileva ciò che manca, scarica e installa `omp`, configura Git Bash, installa il font monospazio e ospita la configurazione di credenziali e modelli in una scheda protetta.
- Chip «⚠ Setup» nella barra superiore quando la configurazione è incompleta, per riaprire la procedura guidata in qualsiasi momento.
- Notifiche di sistema su Windows 10/11 e macOS quando l'agente chiede attenzione o completa un task con l'app in secondo piano, con clic diretto sul progetto interessato.
- Segnale visivo sull'icona dell'app: pallino rosso lampeggiante sulla barra delle applicazioni di Windows e badge numerato con rimbalzo nel Dock di macOS.
- Nuova sezione «Notifiche» nelle impostazioni: attivazione, testo sintetico o completo, allerta sull'icona, segnale sonoro e invio di una notifica di prova.
- Centro impostazioni unificato (`Ctrl+Alt+,`) con sei sezioni: Generale, Notifiche, Barra progetti, Workspace, Task & Agenti e Modelli.
- Editor e terminale personalizzabili — carattere, dimensione, minimappa, ritorno a capo, tabulazione, numeri di riga, scrollback, campanello e cursore — applicati subito, senza riavviare.
- Valori predefiniti dei nuovi task impostabili globalmente e sovrascrivibili per singolo progetto.
- Pannello consumi in finestra dedicata, con quote più critiche, conto alla rovescia al ripristino, andamento nelle 24 ore e velocità stimata.
- Anteprima dedicata per i file SVG aperti nell'editor.
- Schermate iniziali utili in workspace e pannello agenti, con azioni consigliate e griglia delle scorciatoie da tastiera.
- Avvisi di sistema uniformi che spiegano la causa dell'errore e offrono un pulsante per riprovare, al posto di pannelli vuoti o bloccati su «Caricamento».
- Nuova icona dell'applicazione per Windows e macOS.

### Changed

- Avvio più rapido e streaming più fluido: bundle suddiviso fra editor, terminale e diagrammi, aggiornamenti sincronizzati al refresh dello schermo e binario compilato con ottimizzazioni complete.
- Editor dei task e chat riorganizzati: prompt al centro, opzioni avanzate in un pannello richiudibile con riassunto, pulsanti di azione uniformi.
- Trascritto della chat più leggibile: indentazione e luminanza al posto dei bordi colorati decorativi, nessun limite di altezza sui blocchi di codice, prosa limitata a 65 caratteri per riga.
- Comparsa, espansione e chiusura dei blocchi avvengono con animazioni fluide, disattivate quando il sistema richiede movimento ridotto.
- La chat esegue direttamente i comandi standard (bash, write, edit, eval) senza chiedere approvazione, allineandosi al terminale.

### Fixed

- Accessibilità: etichette su tutti i controlli, `Tab` che resta dentro modali e cassetti, chiusura con `Esc`, contrasti conformi e annunci dei cambi di stato dell'agente.
- Alla chiusura di una scheda o dell'applicazione vengono terminati anche tutti i processi figli: niente più processi orfani in background.
- Il tasto di stop interrompe l'agente all'istante (`Esc`, `Alt+C`, `Ctrl+C`).
- Lo storico unisce le sessioni su disco e la cronologia, così anche le sessioni nate da un task si riprendono correttamente.
- Nessun disallineamento dei messaggi quando ci si aggancia a una sessione già in corso.
- Il pannello consumi non segnala più progetti attivi che non lo sono e ripulisce le tracce rimaste indietro.
- La chat resta ancorata in fondo durante lo streaming e si riaggancia da sola quando ti riavvicini al fondo.
- L'editor conserva posizione di scorrimento e cursore di ogni file al cambio di scheda o di progetto.
- Corretti il doppio anello di focus sul prompt, l'altezza della casella di testo dopo l'invio, la barra di aiuto della palette dei comandi, le immagini incollate due volte e gli avvisi spuri all'avvio.
- Il controllo aggiornamenti di `omp` legge la versione corretta anche quando l'output contiene sequenze di colore, e gestisce gli errori di rete.
- Canale Nightly: l'aggiornamento propone sempre l'installer della build annunciata, e quelli delle build precedenti vengono rimossi alla pubblicazione.

### Security

- Le anteprime SVG e i prototipi HTML vengono aperti in un contenitore isolato, privo di script e di accesso all'applicazione, con il contenuto ripulito prima del rendering.
- L'aggiornamento di Studio rifiuta qualsiasi pacchetto privo di impronta SHA-256 verificata, ricontrolla il file su disco subito prima di eseguirlo e cancella sempre i file temporanei.
- L'installazione di `omp` si interrompe se l'impronta pubblicata su GitHub non corrisponde al file scaricato.
- I database di `omp` vengono aperti in sola lettura, senza possibilità di modificarli o bloccarli, e le interrogazioni non bloccano l'interfaccia.
- Ogni percorso richiesto viene risolto e verificato dentro la radice del progetto, bloccando le uscite tramite `..` o collegamenti simbolici.
- Dall'interfaccia sono raggiungibili solo i comandi dichiarati nei permessi dell'applicazione; su Windows Studio registra la propria identità per le notifiche di sistema.
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
