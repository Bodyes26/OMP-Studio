# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added

- Scelta immediata della modalità di accodamento al momento dell'invio: durante lo streaming dell'agente il pulsante di invio si sdoppia (split button) per inviare con il comportamento predefinito o aprire il menu a tendina e forzare la modalità Steer o Follow-up, con scorciatoie da tastiera `Invio` (modalità predefinita) e `Alt+Invio` (modalità opposta).
- Nuove preferenze di accodamento in «Impostazioni → Generali» per scegliere il comportamento di invio predefinito (Steer o Follow-up), le modalità di estrazione dei messaggi (singolo o tutti insieme) e la modalità di interruzione.
- Pulsante "Nuova chat" nell'intestazione della colonna destra, con scorciatoia `Alt+N`.
- Il popover della quota può mostrare anche provider che `omp` non sa interrogare da solo (per esempio quelli aggiunti da un plugin): basta descrivere la sorgente in un file JSON dentro `%LOCALAPPDATA%/omp-studio/usage-sources/` indicando il comando da eseguire, e le sue quote compaiono accanto alle altre. Senza quella cartella nulla cambia.

### Changed

- I chip dei messaggi in coda nella chat sono ora badge informativi di sola lettura con spiegazione contestuale, rispecchiando con chiarezza che i messaggi già presi in carico da `omp` non possono essere modificati né riordinati.

### Removed

- Rimosso il popover di configurazione della coda con icona a ingranaggio dal campo di scrittura della chat e le scorciatoie `Alt+Q` e `Alt+S`, sostituite dalle impostazioni generali e dalla selezione rapida all'invio.
- Rimossa la scorciatoia orfana non funzionante `Alt+Q Opzioni coda` dallo stato vuoto della colonna dei task.

### Fixed

- Sincronizzazione affidabile del focus e digitazione diretta nella chat: il cursore animato (smooth cursor) si spegne tempestivamente quando la finestra o l'applicazione perde il focus evitando falsi lampeggi a vuoto, l'intera area del riquadro di input trasferisce il focus alla casella di scrittura al clic, la digitazione non intercetta i tasti quando sono aperti modali o dialoghi preservando l'uso della barra spaziatrice sugli elementi interattivi, e la posizione del cursore resta allineata durante lo scorrimento.
- Completamento affidabile delle scelte multiple con opzione personalizzata («Altro»): la risposta a testo libero su domande a scelta multipla viene instradata con il passo di chiusura corretto preservando l'esecuzione dell'intero piano di risposte per tutte le domande del wizard.
- Caricamento coalescente dei modelli e provider: l'inizializzazione in background elimina le chiamate concorrenti duplicate a `omp models` all'avvio dell'applicazione e azzera i cicli reattivi di ricarica in caso di errore.
- Sicurezza e robustezza delle sorgenti di quota: confinamento rigoroso dei percorsi con fallback protetto in caso di variabili d'ambiente vuote, limitazione a flusso del buffer di output dei processi figli e validazione difensiva dei valori numerici nel popover delle quote.
- Modulo unico e navigazione libera per le domande multiple dell'agente (`ask`): la card riceve ed espone tutte le domande fin dalla prima richiesta grazie all'arricchimento bidirezionale immediato all'arrivo degli argomenti del tool, consentendo di spostarsi liberamente avanti e indietro tra i passaggi e di verificare il riepilogo prima dell'invio definitivo, azzerando le card frammentate e la perdita di navigazione sulle domande precedenti.
- Preservazione delle note nelle scelte multiple e validazione rigorosa della coda di consegna: l'aggiunta di note a risposte a scelta multipla viene instradata correttamente senza generare opzioni fantasma per l'agente, e i passi automatici in coda vengono verificati per metodo, firma delle opzioni e identificativo di chiamata prima di essere consegnati a `omp`, arrestando la sequenza con avviso chiaro in caso di disallineamento.
- I menu dei modelli mostrano le capacità come icone: accanto a ogni modello compaiono la finestra di contesto, l'occhio per il supporto alle immagini e il simbolo del ragionamento esteso, con i livelli di sforzo nel suggerimento. Prima l'elenco aperto scriveva «Vision» e «Reasoning» a parole solo nel selettore del task, e nel menu rapido della chat non diceva nulla.
- Le opzioni avanzate del task restano raggiungibili anche con un prompt lungo: quando la casella di testo cresce, il corpo dell'editor scorre invece di tagliare l'accordion, quindi le ultime modalità tornano selezionabili.
- I menu a comparsa non vengono più tagliati: selettore del modello, menu di assegnazione ai ruoli del catalogo, menu «Aggiungi provider» e i menu di ruolo, modello, thinking e modalità di invio della chat si aprono sopra tutto il resto, si ribaltano quando manca spazio sotto e scorrono al proprio interno.
- Le riserve dei ruoli, il modello primario, il ciclo rapido e il modello dei suggerimenti propongono soltanto i modelli dei provider effettivamente configurati e abilitati, non l'intero catalogo di OMP.
- I suggerimenti AI per i ruoli non propongono più modelli di provider che non hai: la validazione avviene sull'elenco realmente disponibile e i provider personalizzati definiti in `models.json` (compresi i server locali) ora vengono inclusi invece di essere sempre esclusi.
- Pannelli e liste ad altezza vincolata scorrono invece di troncare il contenuto: elenco ruoli e dettaglio ruolo, elenco provider e dettaglio provider, cassetto del ciclo rapido, pannello e cassetto dei subagenti, selettore di progetto e popover delle quote.
## [1.3.0] - 2026-09-01

### Added

- Supporto completo alla compilazione e distribuzione per sistemi Linux (x86_64): generazione automatica dei pacchetti Debian (`.deb`) e portabili universali (`.AppImage`) nei canali Nightly e Release stabili di GitHub Actions con promozione candidate senza ricompilazione, script di build locale e ottimizzazione del fallback shell POSIX.
- I suggerimenti di risposta nel composer: chip cliccabili sopra il campo di scrittura che precompilano il prompt con un click o con Alt+1, Alt+2, Alt+3; l'invio resta un tuo gesto esplicito.
- La nuova sezione «Suggerimenti» delle impostazioni per creare, modificare, riordinare, nascondere o ripristinare i suggerimenti fissi.
- I suggerimenti generati dal modello leggero al termine di ogni risposta dell'agente, che leggono l'ultimo messaggio e propongono fino a tre risposte pronte; disattivati per impostazione predefinita, con scelta del modello e del limite.
- Ricerca fuzzy nel filetree di progetto: barra di ricerca sempre accessibile in cima al pannello FILE con filtro istantaneo, evidenziazione dei caratteri corrispondenti nel nome e percorso del file, navigazione rapida da tastiera (Frecce, Invio, Esc) e menu contestuale sui risultati.
- Direttive e modalità del task completamente personalizzabili: nuova libreria in «Impostazioni → Task & Agenti» per creare, modificare, riordinare, nascondere o ripristinare le modalità di prompt (inclusi i preset Piano, Discussione, Minimale e Ricerca), impostandone il posizionamento prima o dopo il testo principale.
- Assistente AI per le direttive: generazione guidata di nuove modalità da una descrizione in linguaggio naturale, miglioramento e affinamento del prompt con anteprima delle modifiche e analisi su richiesta delle ricorrenze nei prompt recenti del progetto per suggerire nuove direttive utili.
- Snapshot deterministici e aggiornamento controllato: ogni task in coda congela la versione esatta delle direttive al momento della creazione, con avviso visivo e pulsante «Aggiorna» quando la libreria contiene una versione più recente.
- Nuova sezione «Aspetto» nel modale Impostazioni con galleria visiva a griglia di tutti i temi disponibili (scuri e chiari), ricerca in tempo reale, anteprima grafica con campioni di colore (sfondo, accento, testo) e indicatore del tema attivo con applicazione immediata.
- Gestione avanzata dei provider e supporto completo ai plugin: la sezione «Impostazioni → Modelli → Provider» adotta un layout a due colonne che rileva dinamicamente tutti i provider built-in, plugin (come Command Code) e custom, mostrando lo stato di abilitazione, il conteggio dei modelli disponibili e gli account associati.
- Gestione multi-account con identificativi e disconnessione selettiva: visualizzazione trasparente di email, ID account e organizzazione/piano per ogni credenziale memorizzata, con possibilità di disconnettere singoli account tramite dialogo di conferma protetto senza invalidare l'intero provider.
- Catalogo modelli basato sui modelli realmente disponibili: la scheda «Catalogo» organizza i modelli per provider con badge contestuali (finestra di contesto, token massimi di output, reasoning con livelli di thinking e costi), filtri rapidi (Vision, Reasoning, Gratis), ricerca full-text e aggiornamento mirato del catalogo.
- Il terminale dice cosa sta facendo mentre parte: durante l'avvio dell'ambiente compare una riga di attesa attenuata al posto del riquadro nero, con testo diverso a seconda del contesto (avvio, ripresa di una sessione, configurazione guidata). Sparisce da sé al primo output e, se l'ambiente non risponde entro dieci secondi, lascia il posto a un avviso con l'indicazione di cosa verificare.
- Anteprima dei file apribile e chiudibile: per Markdown e SVG l'editor mostra un selettore a tre stati nella barra superiore (solo codice, codice e anteprima affiancate, solo anteprima) che ricorda la scelta scheda per scheda. `Ctrl+Shift+V` cicla tra le tre viste.
- Le schede dell'editor si riordinano trascinandole, si chiudono col clic centrale del mouse, scorrono con la rotellina e mostrano le frecce di scorrimento quando i file aperti non stanno nella barra; la scheda attiva resta sempre in vista.
- Nuova voce «Chiudi tutti» nel menu contestuale delle schede, con scorciatoia `Ctrl+Shift+W`.

### Changed

- Popover della quota d'utilizzo: l'indicazione dei progetti attivi per ciascun provider mostra ora direttamente il solo nome del progetto (es. «ContrattiImmobili»), eliminando il prefisso ridondante dell'applicativo («OMP Studio»).
- Disattivata l'espansione automatica dell'accordion e delle card dei tool in caso di errore: i passaggi rimangono compatti e sotto l'accordion chiuso compare un microcopy che indica il tool fallito e la breve descrizione del motivo, lasciando l'apertura completa al clic manuale.
- Ottimizzati i tempi di compilazione e pubblicazione: adozione di Thin LTO e generazione di codice parallela nel profilo Rust release, eliminazione dei chunk ridondanti nella build Vite frontend e introduzione della cache delle dipendenze Rust (rust-cache) nei workflow GitHub Actions, riducendo drasticamente i tempi di build locali e cloud.
- Rimossa la barra di evidenziazione sinistra e il testo in grassetto sulla voce di sezione attiva nella colonna sinistra della finestra Impostazioni, per una navigazione più pulita e uniforme.
- Spostata la selezione del tema dalla barra superiore (TopBar) alla nuova sezione dedicata nelle Impostazioni, rimuovendo il badge e il popover galleggiante per una barra più pulita ed essenziale.
- I controlli di scelta singola (radio button) in tutta l'applicazione sono stati ridisegnati con uno stile personalizzato coerente con il tema attivo (anello reattivo e punto interno centrato nel colore del brand), rinnovando il selettore del canale aggiornamenti (nelle impostazioni generali e nel dialogo di aggiornamento dalla barra inferiore, con schede dedicate e badge «Consigliato»/«Anteprima») e le opzioni di ordinamento della barra dei progetti.
- Semplificata la descrizione dell'opzione di ordinamento «Ultimo aperto» nelle impostazioni della barra progetti, rimuovendo il prefisso ridondante «Comportamento storico:».
- Le schede dell'editor non hanno più il pulsante «Diff» dentro la linguetta: il confronto con HEAD è ora un'icona nella barra superiore, attiva solo sul file in primo piano, e resta nel menu contestuale della scheda come «Confronta con HEAD». La linguetta mostra il nome del file in corsivo quando ci sono modifiche non salvate e sostituisce il pallino con il pulsante di chiusura al passaggio del mouse, così la sua larghezza non cambia mai; la scheda attiva è segnata da una barra colorata in alto.
- L'anteprima Markdown dell'editor usa lo stesso motore della chat: tabelle, blocchi di codice con colorazione della sintassi, elenchi annidati, link e citazioni sono resi correttamente, dove prima venivano ignorati.

- I comandi slash `/login` e `/logout` supportano l'indicazione opzionale del provider (es. `/login anthropic`, `/logout openai-codex`) per aprire direttamente la scheda Provider con il provider di destinazione pre-selezionato.

### Fixed
- Confinamento e sicurezza delle operazioni file: bloccata la creazione o rinomina di percorsi con prefissi di disco Windows (`C:`) o componenti non normali al di fuori della radice di progetto, con protezione deterministica contro la perdita accidentale di file.
- Ricerca file resiliente a caratteri Unicode: il fuzzy matching gestisce correttamente l'espansione a lunghezza variabile dei caratteri minuscoli (es. `İ`), eliminando i crash per indice fuori limite e garantendo l'evidenziazione esatta dei caratteri corrispondenti.
- Navigazione ad albero accessibile da tastiera: abilitata l'esplorazione completa del file tree tramite standard ARIA (`role="tree"`, `role="treeitem"`, `aria-expanded`, roving tabindex) con navigazione fluida (`Frecce Su/Giù/Destra/Sinistra`, `Home`, `End`, `Invio`) e visualizzazione chiara dell'errore in caso di mancato spostamento nel Cestino.
- Salvataggio protetto delle impostazioni e delle API key: le scritture atomiche su macOS e Linux preservano i permessi restrittivi `0600` prevenendo l'esposizione accidentale delle credenziali nel filesystem locale.
- Strumento `studio_preview` vincolato a permessi di scrittura e anti-traversal: registrazione con approvazione esplicita (`approval: "write"`), rifiuto di symlink su `.gitignore` o cartella `proto/` e restituzione immediata degli errori di salvataggio del prototipo.
- Ripristinato lo scorrimento dello storico nella chat: il pulsante «Carica precedenti» torna a mostrare le entry nascoste a blocchi di 300 preservando la posizione di lettura corrente senza salti di viewport.
- Unificato l'ascolto delle scorciatoie globali: premere `Alt+H`, `Alt+K` o `F1` dalla chat, dal terminale o dall'editor apre la guida scorciatoie con un solo tocco senza chiusure immediate per doppi toggle concorrenti.
- Aggiornamento mirato dei modelli senza troncamento: il comando di ricaricamento per singolo provider preserva i modelli degli altri provider attivi, mantenendo stabili i ruoli configurati e i cicli veloci.
- Integrità della pipeline e verifica delle firme: ripristinato il comando di firma Authenticode per i binari ed installer Windows, isolamento deterministico della versione Node nel gate di qualità, e staging piatto degli asset multipiattaforma per garantire la coerenza dei checksum SHA-256 su Windows, macOS e Linux.
- Coerenza visiva dei controlli finestra su Linux: la barra superiore disattiva i controlli personalizzati di stile Windows su distribuzioni Linux preservando le decorazioni native GTK/sistema.
- Le immagini PNG, JPEG, GIF, WebP, BMP e ICO tornano visibili nell'editor: il visualizzatore non usa più il protocollo `asset:` di Tauri, disabilitato di default e limitato a percorsi fissi, ma legge i byte del file e li mostra da un blob locale. Quando la lettura fallisce compare un messaggio con il motivo, al posto del riquadro vuoto senza spiegazioni.
- `Ctrl+W` e `Ctrl+F4` chiudono di nuovo la scheda del file: prima funzionavano solo col cursore dentro l'area di testo e smettevano del tutto dopo il primo passaggio tra un file con anteprima e un file di codice. Ora valgono in tutta la finestra, tranne nel terminale (dove `Ctrl+W` cancella la parola nella shell) e nei campi di testo, e con nessun file aperto non chiudono la finestra. Lo stesso vale per `Ctrl+S`, che era colpito dal medesimo difetto.
- Tornano attivi gli strumenti dell'agente forniti da Studio (`studio_diagram`, `studio_preview` e `project_tasks`, con il comando `/tasks`): all'avvio del terminale le due estensioni non venivano più caricate e comparivano gli avvisi «Failed to load extension … Type.String is not a function» e «Type.Literal is not a function», perché la nuova versione di omp ha cambiato il modo in cui espone il costruttore degli schemi. Aggiornato anche il formato dei risultati dei tool, che altrimenti sarebbero stati scartati con «Tool returned an invalid result».
- Riordino schede progetto tramite trascinamento (drag & drop): ripristinato il trascinamento delle tessere dei progetti nella barra superiore quando l'ordinamento è impostato su «Manuale», risolvendo il mancato avvio del drag e il conflitto con la finestra su WebView2/Chromium.
- Ripristinato il funzionamento del comando slash `/compact` e `/handoff` dalla chat grafica: risolto il blocco della palette comandi all'invio, aggiunto il feedback visivo di compattazione in corso con riga animata, aggiornamento immediato del transcript e del conteggio token al termine, e messaggi di avviso chiari quando la cronologia è troppo breve.
- Dialogo aggiornamenti compatto per il canale Nightly: abbreviata la nomenclatura dei build ID e resa reattiva la visualizzazione delle versioni nel modale di aggiornamento, evitando lo scorrimento orizzontale.
- Le domande dell'agente (`ask`) tornano a rispondere ai clic: cambiare opzione dopo la prima scelta non aveva più effetto, la spunta restava sull'opzione iniziale e l'agente riceveva una risposta diversa da quella scelta.
- Le frecce `Su`/`Giù` nelle domande a scelta singola spostano la risposta e non solo l'anello di fuoco: prima si poteva scorrere fino all'opzione desiderata e confermare, mentre all'agente veniva inviata l'opzione consigliata.
- Nelle sequenze di più domande la card mostra la domanda che l'agente sta effettivamente chiedendo, con «Domanda 2 di 3» e il pulsante `Avanti` al posto di `Conferma`: prima la prima domanda veniva riproposta una seconda volta e le risposte finivano sfalsate di una posizione.
- Le risposte a scelta multipla di una singola domanda vengono inviate per intero: prima veniva spedita solo la prima spunta e la stessa domanda si ripresentava.
- `Invio` su una domanda a scelta multipla non svuota più la card lasciando l'agente in attesa.
- Riprendere una chat dallo storico subito dopo l'avvio di Studio non lascia più la conversazione vuota: cliccare una sessione mentre il processo del progetto stava ancora partendo ne avviava un secondo, la chat si insediava su quello sbagliato (una sessione nuova, senza messaggi) e i messaggi non comparivano mai, benché l'agente rispondesse conoscendo tutto lo storico. Ora la ripresa scelta dall'utente ha la precedenza, il processo superato viene chiuso invece di restare vivo in background e il transcript viene ricostruito a ogni nuovo agganciamento.
- Nelle domande a più risposte le altre domande non risultano più «ok» prima di essere lette: l'opzione consigliata resta pre-selezionata come proposta, ma vale come risposta solo dopo che la domanda è stata aperta. Il riepilogo indica le domande ancora da vedere e l'invio resta bloccato finché ne manca una, così non partono più scelte mai viste dall'utente.
- Le domande già inviate di una sequenza `ask` restano visibili nella barra dei passaggi, contrassegnate come «inviata» e non modificabili: prima sparivano del tutto e la numerazione delle domande rimaste risultava incomprensibile.
## [1.2.1] - 2026-08-28

### Added

- Caricamenti animati e reveal fluido delle sessioni: spinner di caricamento e ingresso graduale (staggered) delle voci nello storico delle sessioni, micro-indicatore durante la ricerca e scheletro animato (skeleton stream) con transizione morbida durante la ripresa o apertura di una sessione nella chat GUI.
- Nuova sezione «Accessibilità» nelle Impostazioni con interruttore per disattivare animazioni e transizioni dell'interfaccia, garantendo una risposta visiva istantanea e a basso consumo di risorse.
- Indicatori di caricamento e transizioni graduali nel pannello Git (stato del repository e commit recenti) e nella scheda Regole durante l'analisi dell'attrito.
- Cursore fluido e animato (smooth cursor) nella casella di testo della chat della GUI: scorrimento morbido e reattivo durante la digitazione, navigazione tra i caratteri o selezione, con respiro/lampeggio morbido a riposo e rispetto delle preferenze di movimento ridotto del sistema.
- Nuovo wizard interattivo per le domande dell'agente (`ask`): navigazione a schede tra domande multiple (`Freccia Sinistra/Destra`), aggiunta di note o specifiche opzionali a qualsiasi risposta (`N`), spunte a casella per le scelte multiple con stato visivo immediato e schermata finale di riepilogo per verificare tutte le risposte prima dell'invio.
- Il renderer dello storico del tool `ask` nella chat mostra tutte le domande poste con le relative scelte selezionate, le risposte personalizzate e le note dell'utente.
- Il pannello di un progetto si apre anche col **click destro** sulla tessera (o col tasto `Menu`): resta fissato finché non scegli un comando, premi `Esc` o clicchi fuori. Il menu contestuale della WebView, con voci come «Ricarica» e «Stampa», non compare più da nessuna parte dell'app tranne nei campi di testo, nell'editor e nel terminale, dove serve per copiare e incollare.
- Menu contestuale tematizzato uniforme in tutta l'applicazione: click destro nei campi di testo, nell'editor di codice, nel terminale e nell'albero dei file apre un menu coerente con il tema attivo, con icone, scorciatoie di sistema (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `Ctrl+A`, `Ctrl+S`, `Ctrl+W`) e navigazione completa da tastiera (`Freccia Giù/Su`, `Home`, `End`, `Invio`, `Esc`).
- Gestione file e cartelle dall'albero: creazione rapida inline di nuovi file e cartelle, rinomina e spostamento nel Cestino con aggiornamento immediato delle schede aperte nell'editor, sincronizzazione dei badge Git e protezione contro la perdita di modifiche non salvate.
- Menu contestuale sulle schede dell'editor per salvare, aprire il diff, copiare il percorso, mostrare il file nel file manager di sistema (Esplora file / Finder), chiudere la scheda o chiudere tutte le altre.
- Nuove azioni nel pannello del progetto: copia percorso, apri nel terminale, apri nell'editor esterno, nuovo task, interruttore dell'avvio automatico dei task, spostamento della tessera e chiusura degli altri progetti.
- Il pannello dice in una riga cosa sta facendo l'agente e, quando un task in coda non può partire, il motivo per cui non parte.
- Nuova opzione «Larghezza chat» nelle impostazioni generali: permette di scegliere tra il layout centrato con margini bilanciati per la leggibilità e il layout a tutta colonna.
- Nuova scheda **Regole** nel pannello AGENTE: elenca i file di contesto del progetto (`AGENTS.md`, `.omp/rules/*.md`, `CLAUDE.md`, `GEMINI.md`) e le skill disponibili, di progetto e globali, con nome, comando `/nome` e descrizione. Un click apre il file nell'editor; le skill fuori dal progetto si mostrano nel file manager. Se il progetto non ha `AGENTS.md`, un pulsante lo crea con uno scheletro e lo apre subito.
- La scheda Regole segnala le correzioni che ti tocca ripetere: quando lo storico locale mostra due o più volte la stessa richiesta (eseguire i test, verificare la build, non toccare file estranei), propone la regola corrispondente da aggiungere ad `AGENTS.md`, con l'anteprima esatta delle righe e i pulsanti Applica, Modifica e Ignora. Una proposta per volta, un contatore sulla scheda, e nessuna scrittura senza il tuo click.
- L'editor dei task propone i modelli usati più spesso nel progetto: i chip «Usati spesso» ricordano le coppie modello + sforzo di ragionamento delle esecuzioni recenti e le applicano con un click.
- Sotto il modello scelto compare cosa costa usarlo: la quota residua del provider con le finestre e gli orari di ripristino nel tooltip se è un abbonamento, il prezzo per milione di token se è a consumo, più un avviso quando lo stesso modello è già al lavoro in un altro progetto.

### Changed

- Il riepilogo delle scorciatoie da tastiera (`Alt+H`, `Alt+K`, `F1`) è ora un modale globale di Studio disponibile ovunque (GUI, Terminale, Editor, Barra), ridisegnato su due colonne bilanciate con altezza contenuta, ricerca in tempo reale e chiusura immediata con `Esc`.
- Tutte le icone di Studio vengono da un unico set disegnato (Lucide) al posto delle emoji del sistema: stesso tratto, stessa dimensione e stesso colore del tema su Windows e su macOS.
- Il colore di un progetto si sceglie da una striscia di tinte resa con i colori del tema: ogni tinta mostrata è esattamente quella che prenderà la tessera. Spariti il pallino arcobaleno e il selettore di colori del browser, che promettevano sedici milioni di colori per poi conservarne uno su quarantamila.
- La selezione a scelta multipla nel tool `ask` sostituisce la voce tecnica «Done selecting» con un pulsante dedicato «Conferma selezione» e permette di selezionare le opzioni con `Spazio` e confermare con `Invio`.
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
- L'elenco dei modelli nell'editor dei task contiene solo quelli davvero utilizzabili con le credenziali configurate, interrogando direttamente `omp`, invece dell'intero catalogo scaricato dai provider.
- Il modello selezionato si legge a colpo d'occhio: provider sopra, nome del modello sotto, e tre icone per finestra di contesto, immagini e ragionamento al posto delle etichette testuali.
- Modello e sforzo di ragionamento scelti in un task vengono applicati davvero alla sessione della chat grafica: se il modello richiesto non è disponibile il task resta in coda con l'errore, invece di partire in silenzio con un altro modello.
- Sulla superficie terminale la configurazione del task viene verificata prima di lanciarlo: se la sessione di `omp` usa un altro modello il task resta in coda spiegando cosa allineare, perché il terminale non ha alcun comando per cambiare modello a una sessione.

### Fixed

- L'installazione guidata di `omp` verifica obbligatoriamente l'impronta crittografica SHA-256 ufficiale prima di sostituire il binario: se il controllo fallisce o l'impronta non è disponibile, l'eseguibile esistente resta intatto.
- Salvataggio sicuro e atomico della configurazione dei modelli e dei provider: la scrittura conserva tutti i campi non gestiti direttamente da Studio e previene la corruzione del file in caso di spegnimento o errore di I/O.
- Finestra nativa e barra superiore ottimizzate per macOS: ripristinati i pulsanti semaforo di sistema nel rispetto delle convenzioni di Apple, eliminando i controlli duplicati di stile Windows e garantendo l'area di trascinamento corretta.
- Corretta l'installazione del font Nerd su macOS nella cartella `~/Library/Fonts`, rendendolo disponibile alle shell esterne senza richiedere utility Linux.
- Il primo avvio guidato attende il caricamento dei progetti salvati prima di decidere se aprirsi, evitando la comparsa del wizard per gli utenti che hanno già progetti configurati.
- Nelle domande dell'agente (`ask`) è ora richiesta una scelta esplicita per ciascun passaggio: eliminato qualsiasi ripiego automatico sulla prima opzione e disabilitato l'avanzamento per risposte personalizzate vuote.
- Le risposte del wizard delle domande vengono associate in modo rigido alla specifica richiesta in corso, prevenendo l'applicazione accidentale di risposte residue a richieste successive.
- Apertura sicura di editor e terminali esterni: i percorsi dei progetti vengono passati come argomenti strutturati senza interpreti di comandi intermedi, e i link esterni sono vincolati a protocolli web autorizzati (`https:`, `http:`, `mailto:`).
- Supporto alla rinomina di file e cartelle con sola variazione di maiuscole/minuscole (es. `appunti.txt` → `Appunti.txt`) su filesystem APFS di macOS.
- Scrittura atomica e protetta della coda dei task `.omp/tasks.json`, azzerando il rischio di perdita di dati durante modifiche concorrenti.
- Riconoscimento resiliente degli errori di sessione non trovata da parte di `omp`, ripristinando correttamente la chat anche con formattazioni di testo eterogenee.
- Navigazione da tastiera accessibile con standard ARIA (`role="listbox"`, `role="tablist"`, `role="tree"`) nel wizard delle domande, nella barra dei progetti e nell'albero dei file.
- Ottimizzazione dei tempi di avvio e delle dimensioni del bundle iniziale: Monaco Editor e Mermaid vengono caricati in memoria su richiesta solo quando le rispettive superfici sono visualizzate.
- Aggiornate le dipendenze di sicurezza del frontend e azzerate le vulnerabilità nel runtime applicativo.
- Aprendo il selettore del tema o il menu di ordinamento della barra superiore la finestra di Studio non diventa più tutta grigia: il velo sotto questi popover era un pulsante a piena finestra che ereditava lo sfondo grigio e la cornice del sistema. Stessa correzione per il selettore progetto e il cassetto della coda.
- Passando dalla chat grafica al terminale (o viceversa) con una sessione ancora senza messaggi non compare più una shell nuda con «Session not found»: una sessione viene ripresa solo se ha davvero un transcript su disco, altrimenti la superficie ne apre una nuova.
- Rimosso il limite rigido di 65 caratteri sui paragrafi Markdown della chat, che causava l'andata a capo anticipata del testo lasciando spazio vuoto solo a destra rispetto alle card dei tool.
- Lo storico delle sessioni si apre in un istante invece che dopo oltre un minuto: Studio leggeva l'inizio di ogni transcript di ogni progetto (centinaia di file, decine di megabyte) per capire a quale progetto appartenesse; adesso ne legge la sola riga di intestazione e la tiene a mente.
- Cambiando progetto la colonna delle sessioni non mostra più, per un istante, lo storico del progetto precedente: la risposta arrivata in ritardo viene scartata e l'elenco vecchio sparisce subito.
- Riprendere una sessione dallo storico nella chat grafica torna a funzionare: la chat non resta più su «OMP in avvio...» con il transcript vuoto, ma ricarica davvero i messaggi della sessione ripresa. Stesso rimedio per il passaggio tra TERMINAL e GUI.
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
