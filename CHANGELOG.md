# Changelog

*Italiano: questo file · English: [CHANGELOG.en.md](CHANGELOG.en.md)*

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

### Added
- Persistenza delle personalizzazioni delle schede progetto: le modifiche apportate alla scheda di un progetto (nome personalizzato, sigla/acronimo, colore/tinta, preferenze di layout e default dei task) vengono salvate in modo permanente nello store e ripristinate automaticamente alla riapertura del progetto. Nel selettore dei progetti (`+`), le cartelle che hanno un nome o una sigla personalizzati mostrano subito tali informazioni e possono essere cercate anche tramite la sigla o il nome assegnato.
- Integrazione completa con GitHub: supporto trasparente sia per GitHub CLI (`gh`) sia per Personal Access Token (PAT). Nel selettore dei progetti (`+`) le cartelle locali mostrano il badge GitHub del repository collegato, mentre una seconda sezione elenca i repository remoti disponibili con azione "Clona e apri" istantanea; le schede della barra superiore e il pannello Git visualizzano la divergenza `↑ ahead / ↓ behind`, pulsante di sincronizzazione rapida (Pull con auto-stash e Push), anteprima dei commit in arrivo ed esito dei workflow CI di GitHub Actions con link diretto. Nuova sezione dedicata nelle impostazioni e onboarding guidato nel setup iniziale.
- PromptBus centralizzato e resiliente per tutte le interazioni utente pendenti (domande ask, selezioni multiple, conferme sì/no, input di testo): le richieste sono identificate da un requestId univoco e persistite temporaneamente nello storage locale per sopravvivere a ricaricamenti della WebView2, disconnessioni temporanee o crash senza bloccare l'agente in attesa indefinita. Sincronizzazione atomica first-response-wins tra Finestra Principale e Companion tramite windowBridge, con recupero e rendering istantaneo delle domande pendenti anche all'apertura tardiva della Companion.
- Escalation a due stadi per l'arresto forzato (Two-Step Force Kill Escalation) sul pulsante di interruzione: un primo click invia un soft abort controllato (SIGINT) e attiva il pulsante in uno stato armato con contorno cremisi pulsante per 2,0 secondi; un secondo click entro la finestra abbatte immediatamente il processo e l'intero albero dei processi figli (SIGKILL, Job Object su Windows, kill del process group su POSIX e taskkill), liberando la sessione anche in caso di loop infiniti o comandi bash bloccati senza dover riavviare Studio. Se l'agente termina regolarmente entro i 2 secondi, lo stato armato decade automaticamente. Disponibile sia nella Chat GUI che nel terminale integrato.
- Autocompletamento fuzzy `@file` nel Composer della Chat GUI: digitando `@` (a inizio riga o dopo spazio) si apre un popover fluido ancorato al cursore con la ricerca fuzzy dei file del progetto tramite `looseSearch`, escludendo directory di build e rumore (`.git`, `node_modules`, `bin`, `obj`, `dist`, `target`), con priorità per file attivo Monaco, file aperti e file modificati dall'agente, navigazione tramite frecce ↑/↓, inserimento del percorso relativo con Invio o Tab e chiusura con Esc senza interferire con i comandi slash `/` o con l'invio ordinario del messaggio.
- Le menzioni `@file` funzionano anche nell'editor dei task e nella Companion, con la stessa palette del Composer. Nella Companion i file si cercano nel progetto di destinazione, quindi prima va indicato `#progetto`. I percorsi con spazi vengono inseriti tra virgolette (`@"Cruscotto PSR/Default.aspx"`), così restano leggibili senza ambiguità.
- Nelle bolle della chat e nelle anteprime dei task in coda ogni `@file` diventa un tag nel punto in cui è stato scritto: mostra il nome del file, il percorso completo compare passandoci sopra e un clic lo apre nell'editor. I tag riappaiono anche quando si riprende una sessione.
- Micro-badge Git `+X -Y` nelle tessere dei progetti, nel relativo pannello e sui task completati: mostrano subito le righe aggiunte e rimosse rispetto a HEAD, includono i nuovi file di testo e si aggiornano dopo scritture dell'agente, commit, salvataggi e cambi di branch senza colori accesi né spostamenti delle cifre.
- Corsie di lavoro isolate sullo stesso repository. Sotto la barra dei progetti compare una riga solo quando, oltre a Principale, c'è almeno un'altra corsia: titolo, stato testuale (al lavoro, richiede input, da revisionare, conflitto, integrazione, in attesa) e «+ Nuova corsia». La corsia è un worktree fratello sul branch `omp/lane-*`; le cartelle `bin`, `obj`, `.vs`, `packages` e `node_modules` non vengono copiate né collegate. Un progetto .NET con PackageReference riusa la cache NuGet, mentre packages.config viene segnalato con la stima di spazio; i file locali che servono ad avviare il progetto (`Parametri.ini`, `.env`) si copiano solo dopo una conferma, riusata dalle corsie successive. Il click su un task in coda parte su Principale se è libera; se sta lavorando Studio chiede se aprire una corsia isolata, e Maiusc+click la apre senza domanda. L'avvio automatico tiene al massimo una corsia aperta da sé, e dal terzo agente contemporaneo un avviso elenca modelli e processi già in esecuzione. Cambiare corsia riallinea insieme file, Git, editor e agente; una domanda in una corsia che non stai guardando non ruba il fuoco e non entra nella chat attiva: pulsa la sua tab, e nel Companion la risposta rapida resta disponibile solo quando la corsia è univoca. «Revisiona e integra» mostra il diff verso il branch di destinazione, con le righe aggiunte e tolte e i comandi davvero eseguiti. L'integrazione parte solo da un tuo gesto e un conflitto resta nel worktree della corsia (vedi sotto). Dal Companion, recuperare o ignorare un blocco di quota agisce sulla corsia bloccata, anche se non è quella in primo piano. I progetti già aperti restano su Principale e non mostrano la riga finché non crei una corsia.
- Integrazione delle corsie in un clic, anche dalla chat. «Integra» nel modale di revisione fa tutto da solo: committa il lavoro rimasto nella corsia, calcola il merge senza toccare i checkout, porta sul branch di destinazione un solo commit squash, poi chiude la sessione della corsia, rimuove il worktree e cancella il branch. Si può chiedere la stessa cosa a un agente («integra la corsia»): il nuovo tool `studio_lane_integrate` esegue la stessa procedura di Studio invece di comandi git a mano. In chat una card mostra commit e file integrati, con «Annulla integrazione» che riporta il branch dov'era e conserva il lavoro in `omp/restored-<corsia>`.
- Se il branch principale ha modifiche non salvate su file diversi da quelli della corsia, l'integrazione procede e le lascia intatte; se toccano gli stessi file, o l'agente principale sta lavorando, l'integrazione va in coda e riparte da sola. Con conflitti, i file tornano all'agente della corsia, che li risolve; dopo una risoluzione l'integrazione chiede un clic di conferma.
- Laboratorio prototipi rifondato come corsia specializzata (`kind: 'lab'`): il Laboratorio diventa una scheda nella barra delle corsie (`LaneStrip`), affiancata a Principale e ai worktree, senza smontare l'area di lavoro né interrompere i terminali TUI attivi. Ogni prototipo vive in un workspace dedicato fuori dal repository con un Git interno che registra ogni richiesta dell'utente come revisione recuperabile. Anteprima live isolata in un iframe a origine opaca su server loopback locale, con supporto a componenti React 19, stili Tailwind CSS v4 e dipendenze esterne risolte automaticamente tramite CDN esm.sh. L'agente del prototipo opera con strumenti standard confinati al workspace e con accesso in sola lettura al progetto originale, con verifica automatica dello stato dell'anteprima e screenshot. I prototipi creati sono tracciati nel file locale `.omp/lab/prototypes.json` (ignorato automaticamente in `.gitignore`), riapribili dal popover della scheda progetto o riutilizzabili come riferimento dall'agente principale. Dallo scratchpad (`Ctrl+Alt+P`) è possibile creare anche prototipi liberi senza cartella di progetto, persistiti in locale e associabili a posteriori a un progetto aperto.
- Azione «Nuova corsia worktree» direttamente nel popover del progetto: consente di creare la prima corsia manuale anche quando la barra delle corsie non è ancora visibile.

### Changed
- Ordinamento barra progetti «Attività recente»: il progetto attivo passa in prima posizione a sinistra solo quando un agente si mette al lavoro (o all'apertura iniziale dal selettore), evitando rimescolamenti continui durante la consultazione. La navigazione ciclica con Ctrl+Tab e la selezione manuale mantengono stabili le posizioni delle tessere, permettendo di scorrere linearmente tutti i progetti aperti senza rimbalzare tra i primi due, e l'ordine delle tessere viene preservato intatto anche al riavvio dell'applicazione.
- Il selettore dei progetti (`+`) esclude le cartelle già aperte nella barra: mostra esclusivamente i progetti non ancora aperti o i repository remoti disponibili, evitando voci ridondanti e conservando in memoria tutte le personalizzazioni (nome, sigla, colore) per quando una cartella chiusa viene riaperta.
- Nella Companion il progetto di destinazione si indica con `#progetto` invece di `@progetto`: la `@` resta dedicata ai file in tutta l'app.
- Transizione respirante (breathing easing) sull'anello ambra nello stato di attenzione dell'agente (`ask` e attesa input): sostituito il lampeggio a gradino intermittente con una pulsazione sinusoidale organica morbida su curva `cubic-bezier(0.4, 0, 0.2, 1)` da 1.9s che varia con continuità opacità ed espansione inset, uniforme tra barra principale e schede del Companion, con blocco statico al 100% di visibilità in modalità movimento ridotto.
- I dialoghi di conferma delle corsie isolate usano i colori del tema: il pulsante principale («Avvia in nuova corsia», «Crea la corsia») è di nuovo leggibile, lo sfondo dietro il dialogo resta visibile in trasparenza anche sui temi chiari invece di diventare un grigio pieno, e il titolo del task compare su due righe in un riquadro dedicato.
- Quando la coda propone di aprire una nuova corsia perché l'agente risulta al lavoro, il dialogo offre anche «Forza in …»: il task parte nella corsia aperta a schermo, interrompendo un turno o una domanda eventualmente ancora aperti.
- Rimosso il pulsante globale «Laboratorio» dalla barra superiore: l'accesso ai prototipi avviene ora per progetto dal popover della scheda o dalla barra delle corsie.

### Fixed
- All'avvio Studio non riapre più l'ultima anteprima di prototipo di una sessione precedente: la colonna centrale non mostra più, a ogni apertura, un'anteprima vuota di un file ormai sparito che non si riusciva a far sparire; compaiono solo le anteprime generate dopo l'avvio.
- Preservato l'ordine cronologico naturale tra testo dell'assistente e chiamate tool: la ricostruzione dello storico della chat non accoda più tutti i tool al fondo del messaggio aggregato, ma intercala spiegazioni, domande interattive (`ask`) ed esecuzioni operative nella loro reale sequenza temporale, omettendo badge modello duplicati prima delle invocazioni dei tool.
- La barra sotto la composer non resta più bloccata su «in avvio...» mentre l'agente sta lavorando: un secondo segnale di avvio dallo stesso processo, un evento non applicabile durante il caricamento della chat o un caricamento superato da una ripresa o da una nuova chat non scollegano più la sessione, e il selettore del modello torna a mostrare il modello in uso.
- L'aggiornamento al canale Nightly non fallisce più con errore 404 subito dopo una pubblicazione: Studio legge l'elenco dei file e il manifest della nightly direttamente dalla release invece che dalla copia in cache di GitHub, che per decine di minuti indicava installer già rimossi, e non ripiega più sull'installer di una build precedente.
- Avviare un task in una nuova corsia con Shift + click non apre più il dialogo «Agenti simultanei» con il conteggio errato «1° agente»: la corsia parte subito e la conferma compare solo dal terzo agente simultaneo.
- Il dialogo «File locali per la corsia isolata» non compare più con «0 file non versionati»: si apre solo quando ci sono file locali nuovi da autorizzare.
- La scheda di una corsia appena creata mostra «Al lavoro» mentre il suo agente lavora, invece di restare su «In attesa».
- Barra di stato, schede delle corsie e coda dei task riportano lo stesso stato dell'agente. La barra di stato indica la corsia aperta invece di tutto il progetto: non segna più «In esecuzione» per un agente che ha finito mentre lavora un'altra corsia, e un agente fermo in Principale non viene più considerato occupato per colpa di un'altra corsia.
- Un agente che chiude il turno con un consiglio o una domanda (con i suggerimenti di risposta sotto la chat) non è più considerato occupato: il task parte nella stessa corsia senza proporre un nuovo worktree.

## [1.6.0] - 2026-09-21

### Added
- Cronometro live su ogni strumento in esecuzione: accanto al nome del tool il tempo trascorso scorre a decimi di secondo (`0.1s`, `12.8s`, e oltre il minuto `1m 14s`) e al termine si ferma sulla durata reale della chiamata, in tinta più attenuata. Durante un comando lungo — build, test, installazione di dipendenze — si vede a colpo d'occhio che il lavoro procede, anche con il gruppo di strumenti chiuso, dove il cronometro compare ora accanto al testo di stato. Le cifre sono a larghezza fissa e la colonna del tempo è riservata: nulla si sposta mentre i numeri cambiano. Un solo orologio serve tutte le chiamate della sessione e si spegne quando nessuno strumento è in esecuzione.
- Strumento di audit e ispezione qualitativa delle icone: nuovo script di verifica `npm run check:icons` (`scripts/check-icons.mjs`) per censire tutte le icone del registro `$lib/icons`, garantire la risoluzione corretta in Lucide, prevenire import diretti non autorizzati e rilevare SVG inline grezzi nei componenti; nuova modale interattiva di ispezione accessibile da «Impostazioni → Aspetto» con anteprima multi-scala (14px, 16px, 20px, 24px), verifica contrasto, copia rapida dell'import e tracciamento dello stato di migrazione.
- Avvio fluido dei task dalla coda: al click su Avvia la riga collassa immediatamente dalla lista della coda e il prompt compare subito come primo messaggio della chat con animazione fluida (sfocatura progressiva, dissolvenza ed espansione d'altezza via `chatReveal`), nascondendo i tempi tecnici di spawn del processo `omp`, handshake RPC e inizializzazione della sessione; se l'avvio richiede più di 400ms compare sotto la bolla l'indicatore discreto «Avvio della nuova sessione...» con effetto shimmer, e in caso di errore o chiusura anomala il prompt si ritira simmetricamente mentre il task rientra in cima alla coda con un lampo visivo.
- Scorciatoia da tastiera Ctrl+Tab (e Ctrl+Shift+Tab) per passare rapidamente al progetto aperto successivo o precedente, con navigazione ciclica coerente con l'ordine della barra progetti e supporto universale sia da chat che da terminale integrato.
- Visualizzazione unificata delle attività per fasi TODO e subagenti: l'avanzamento dei lavori e i processi in background sono presentati in righe compatte con indicatori di stato chiari e coerenti (completato in verde con spunta, errore in rosso con croce, bloccato in ambra con avviso, abbandonato o interrotto in grigio), anello di caricamento per le attività in corso e dettagli tecnici espandibili su richiesta con un click, senza aperture automatiche invadenti e nel pieno rispetto delle impostazioni di movimento ridotto.
- Quando nomini un testo dell'interfaccia — «label Dati dell'immobile da ridurre di dimensione», «riduci il testo Totale contributo», il badge citato fra virgolette o backtick — Studio cerca da solo quel testo nel progetto prima di inviare il messaggio e allega all'agente il file e la riga esatti, con due righe di contesto. L'agente parte già dal punto giusto: una lettura mirata, una modifica, una verifica, senza aprire file a caso. La ricerca è locale e a tempo (si ferma entro un quarto di secondo), usa `git grep` dove disponibile, salta cartelle come `bin`, `obj`, `node_modules` e `.git`, ignora i file binari e non esce mai dalla cartella del progetto; se non trova nulla o non riesce, il messaggio parte identico a prima. Insieme al testo viene allegato anche l'elenco compatto dei file modificati nel progetto (solo nomi e stato, nessun diff e nessun contenuto), assente quando non c'è nulla di modificato.
- Interfaccia bilingue italiano/inglese con selettore in «Impostazioni → Generale»: la lingua segue di default quella del sistema operativo e può essere fissata a mano su Italiano o Inglese. Il cambio è immediato e non ricarica la finestra, quindi sessioni dell'agente, terminali e anteprime live restano attivi mentre i testi si riscrivono. Date, orari, numeri e importi seguono la regione dell'utente, e la documentazione utente (README, scorciatoie, changelog) è disponibile nelle due lingue.
- Rilevamento automatico dell'attesa di input e risposte rapide post-turno via Companion e notifiche OS: estesa l'analisi del turno con modello leggero `smol` per riconoscere quando l'agente termina formulando domande, conferme di piani o richieste di decisione senza invocare formalmente il tool `ask`; il progetto passa immediatamente allo stato di attenzione «Chiede risposta», evidenziandosi nella barra progetti e facendo comparire in cima al Companion la card interattiva con la domanda estratta e le opzioni cliccabili, inoltrate direttamente come nuovo prompt alla chat; se l'app è in background, scatta immediatamente la notifica desktop OS con il testo della domanda per consentire all'utente di rispondere entro i 5 minuti preservando la cache hit di Anthropic.
- Modale di sicurezza alla chiusura di un progetto con protezione dei task in esecuzione e in coda: intercetta la chiusura del singolo progetto e avvisa se sono presenti task in coda o un'elaborazione attiva, lasciando scegliere se conservare o eliminare la coda; chiudendo con un task in avvio (dispatching) il task viene riportato in cima a .omp/tasks.json, intatto alla riapertura. La chiusura dell'applicazione invece non fa domande: le code restano nei rispettivi progetti, i task in dispatching tornano in cima alla propria coda e la finestra si chiude subito.
- Laboratorio prototipi frontend React 19 + Tailwind v4: nuovo spazio GUI dedicato nella colonna centrale di Studio per ideare, confrontare 3-5 varianti di componenti e iterare flussi multischermata con dati simulati in modo isolato e sicuro, operando in concorrenza simultanea con l'agente principale nello stesso progetto.
- Anteprima interattiva con selezione elementi e annotazioni legate alla revisione: toolbar responsive con preset Desktop (1280x800), Tablet (768x1024) e Mobile (375x667), zoom, ricarica e modalità di ispezione visuale a schermo con redazione automatica di password e token Bearer, e blocco preventivo di annotazioni inviate su revisioni non più attive.
- Compilazione ed esecuzione offline senza CDN esterna: compilatore locale `esbuild-wasm` con resolver a VFS chiuso, worker thread isolato e catalogo dipendenze fissate (React 19.2.8, Tailwind v4.3.3, Lucide, Radix Dialog, Recharts, Motion) con bundle fidati precompilati in locale per l'avvio immediato senza connessione internet.
- Renderer Chromium gestito con policy di rete attiva e watchdog crash-recovery: processo Chrome for Testing dedicato con profilo temporaneo privo di dati personali, origine virtuale `http://lab.virtual` senza bridge nativo Tauri, intercettazione CDP nel controller che blocca navigazioni `location.href` e richieste esterne non autorizzate con `BlockedByClient`, e watchdog con arresto istantaneo dei cicli infiniti in meno di 2 ms e riciclo del target.
- Broker di scrittura confinata su percorsi reali e allowlist tool con rifiuto per difetto (deny-by-default) in estensione autonoma per OMP: blocco di shell (`bash`), interpreti (`eval`), scritture generiche, browser host, debugger e MCP; validazione su percorsi canonici con blocco di traversal `..`, percorsi assoluti, confini fra prototipi e symlink/junction; preservazione della delega ai subagenti autori che ereditano i medesimi vincoli.
- Revisioni locali per richiesta di modifica con stato atomico dei file, esito e chiusura esplicita (`rendering-ready`, `verified`, `interrupted`): ripristino non distruttivo di una revisione precedente senza riscrittura della storia e duplicazione del prototipo con registrazione della provenienza (storia e contenuti rimangono fuori da Git nell'archivio locale di Studio).
- Acquisizione del contesto stabile dal progetto con selezione mirata: lettura del working tree effettivo comprese modifiche non committate dell'utente, impronte crittografiche SHA-256 e provenienza, esclusione rigorosa di credenziali e file di segreti, verifica della coerenza a più passaggi contro scritture concorrenti del principale, lettura congelata per i tool di contesto e rilevamento della deriva (drift) con aggiornamento solo su richiesta esplicita dell'utente senza rigenerare il prototipo.
- Export autonomo e handoff adattivo al principale: esportazione di qualsiasi revisione come progetto React indipendente standard con build Vite + Tailwind v4, e pacchetto di consegna strutturato per l'adattamento da parte dell'agente principale allo stack reale del progetto (anche Svelte 5) senza auto-merge forzato.
- Retrocompatibilità e migrazione reversibile di `.gitignore`: i vecchi prototipi HTML generati da `studio_preview` (`proto/*.html`) restano leggibili e apribili, mentre la regola automatica `.gitignore` viene aggiornata a `proto/*.html` per consentire il tracciamento in Git dei nuovi prototipi in `proto/<id>/` senza toccare le regole scritte dall'utente.
- Composer del Companion con suggerimenti `!` per tutti i ruoli configurati e per i modelli più usati tra i progetti, selezionabili da tastiera, e allegati immagine tramite selettore file, incolla o trascinamento con anteprima e rimozione prima del salvataggio.
- Rilevazione dell'arresto per quota esaurita e recupero assistito su GUI, TUI e Companion: rileva in tempo reale quando un agente si ferma per esaurimento quota, crediti o limiti di spesa del provider senza riserve configurate, impostando lo stato di attenzione persistente; propone con un click il cambio verso il prossimo ruolo sano e rilancia il turno fallito tramite `/retry` preservando il contesto ed evitando la riesecuzione non idempotente dei tool già applicati; esteso al Companion con card prioritaria e commutazione automatica da terminale a GUI in un solo click; introdotto avviso preventivo non bloccante «senza riserve» nel composer per modelli privi di catene di fallback.

### Changed
- Le card progetto nella Companion mostrano sempre tutti i progetti aperti, senza il pulsante «+N altri progetti» che li nascondeva. Il nome del progetto e' ora su una riga dedicata, sempre visibile: quota, stato e contatore coda stanno su una seconda riga sotto il nome, cosi' le informazioni non si sovrappongono e nessun chip puo' schiacciare il nome fino a nasconderlo.
- La finestra Companion ha una struttura nuova: il campo del nuovo task sta sempre in cima, sempre grande e prende sempre il fuoco, e sotto ogni progetto aperto ha la sua card. La card del progetto che ti fa una domanda si allarga a tutta la finestra e le altre scendono sotto; un progetto al lavoro mostra su una riga cosa sta facendo, uno fermo i prossimi task in coda (tre, poi il residuo), e uno che ha appena finito le prime righe di cio' che ha detto con quanto tempo e' passato. Il nome del progetto apre la finestra principale su quel progetto: «ha finito, fammi vedere cosa ha fatto» non passa piu' dalla coda dei task. Il `+` accanto allo stato precompila il campo con la menzione di quel progetto. In modalita' Spotlight la finestra adatta la propria altezza al contenuto, in modalita' Widget resta quella che hai scelto. Rimossi il riepilogo aggregato delle code e la paginazione delle richieste: ogni domanda ha adesso la sua card.
- Aggiornamento icona del thinking effort a standard Lucide: sostituito il vecchio SVG inline rudimentale nello slider del thinking effort (`ReasoningSlider.svelte`) con l'icona ufficiale vettoriale ad alta definizione `IconBrain` (da `@lucide/svelte/icons/brain`), dimensionata e stilizzata tramite il token globale `--icon-size` con stroke uniforme e contrasto ottimale.
- «Ha finito» e «fermo, dammi un compito» non sono piu' lo stesso stato: un lavoro concluso resta segnalato come completato finche' non riporti il fuoco su quel progetto, anche quando era il progetto aperto nella finestra principale.
- Laboratorio prototipi frontend isolato e parcheggiato dietro flag alpha (disattivato per difetto): l'accesso alla superficie del Laboratorio è ora regolato dall'impostazione «Laboratorio prototipi (alpha)» in Impostazioni → Generale; con il flag spento i comandi e la scorciatoia Ctrl+Alt+P rimandano alla configurazione, e il codice del Laboratorio viene caricato tramite import dinamico solo all'apertura effettiva, eliminando l'impatto sul tempo di avvio e sul bundle iniziale.
- La cronologia della chat comprime soltanto i tool operativi: commenti e spiegazioni dell'agente restano leggibili nel flusso, mentre le domande `ask` con le relative risposte rimangono come elementi autonomi e separano i gruppi di lavoro.
- L'attesa dell'agente ha un indicatore nuovo: una griglia di nove punti in cui l'accensione scorre da sinistra a destra, la scritta «Sta pensando» attraversata da un riflesso luminoso e, dopo il primo secondo e mezzo, il tempo trascorso in cifre a larghezza fissa (`0.3s`, `12.4s`, `2m 5s`). Il cronometro misura l'attesa dell'intero turno, quindi non riparte da zero quando l'agente alterna pensiero, testo e strumenti. La stessa griglia sostituisce il pallino di stato nell'intestazione dei gruppi di strumenti, dove resta sempre visibile e cambia colore invece di comparire e sparire: grigia a lavoro finito, rossa in caso di errore. Quando uno strumento è in esecuzione e il modello non ha dichiarato un intento, l'intestazione ora dice quale strumento sta usando invece di mostrare solo un numero. Con le animazioni disattivate o con la riduzione del movimento di sistema la griglia resta ferma e leggibile e il cronometro continua a scorrere.
- Le sessioni dell'agente avviate da Studio leggono i file in porzioni più ampie (1200 righe invece del valore predefinito) e ricevono una direttiva permanente di economia: raggruppare in una sola risposta le ricerche indipendenti già individuate, cercare il testo letterale prima di aprire i file, leggere solo i file e gli intervalli utili, gestire da sé un lavoro su un singolo file, delegare soltanto quando ci sono almeno due filoni davvero indipendenti (inviati insieme, senza attese a vuoto) e fare una sola verifica mirata alla fine. Il risultato sono meno giri a vuoto prima della prima modifica. Vale solo per i processi avviati da Studio: la configurazione personale in `~/.omp` non viene toccata, e le sessioni già aperte adottano i nuovi valori alla riapertura.
- Avvio di Studio e delle schede terminale più rapido e stabile: eliminato un processo PowerShell bloccante dalla preparazione delle notifiche Windows, sostituito il wrapper PowerShell del terminale con `cmd.exe`, parallelizzata la lettura iniziale dei progetti e riutilizzati tema e preferenze già risolti prima del primo fotogramma, evitando la schermata «nessun progetto» e il passaggio visibile della quota dal vecchio anello alla barra configurata.
- Companion ridisegnata con componenti dedicati: domande dell'agente più leggibili, token del composer allineati al design system neutro; in Spotlight la chiusura al blur è disattivata di default (solo Esc, configurabile).
- Animazione fluida per l'apertura e chiusura della barra laterale: la comparsa e scomparsa della sidebar azionata dall'icona di Pi in alto a sinistra (e dalla scorciatoia Ctrl+Alt+B) è ora animata con transizione fluida del layout a griglia, dissolvenza e scorrimento del contenuto senza scatti o ricalcoli di reflow, con feedback tattile alla pressione dell'icona e rispetto automatico delle preferenze di movimento ridotto.
- Rendering inline dei token e rimozione del testo duplicato nel Companion: i token riconosciuti (`@progetto`, `/direttiva`, `!ruolo` o `!modello`) vengono renderizzati direttamente come pillole semantiche colorate (blu per i progetti, verde per le direttive, viola per ruoli e modelli) dentro l'area di scrittura preservando l'allineamento perfetto del cursore e la modifica fluida del testo; eliminata la duplicazione del prompt e dei tag sotto il campo, lasciando l'area sottostante solo per eventuali avvisi reali o ambiguità.
- Opzioni di configurazione del task sempre visibili e integrate nel layout: rimosso l'accordion comprimibile e il contenitore a scheda del TaskEditor in favore di un flusso naturale direttamente sotto l'area di testo del prompt, con sezioni dedicate per profilo/ruolo, modello specifico, livello di thinking effort e griglia delle direttive con conteggio attivo.
- Il campo per i task del Companion ha ora la forma di un composer da chat: una sola superficie arrotondata che cresce con il testo (una riga a vuoto, fino a otto), Invio per salvare e Maiusc+Invio per andare a capo, pastiglie cliccabili `@progetto`, `/direttiva` e `!ruolo` al posto del testo di aiuto, e pulsante di invio tondo che gira mentre salva. L'anteprima dell'interpretazione è diventata una striscia sotto il campo invece di una scheda con una scatola dentro, e un progetto non ancora riconosciuto è segnalato come avviso e non come errore.
- La ricerca dei modelli è più tollerante: trattini, punti, barre e spazi non contano più e i termini possono essere scritti in qualsiasi ordine, così «gpt 5.6», «gpt 56» o «gpt sol» trovano tutti `codex-openai/gpt-5.6-sol`. Vale nel menu modello del composer, nel selettore modello, nella scheda Catalogo delle impostazioni e nei suggerimenti `!` del Companion.
- I messaggi di sistema dell'agente non sono più muri di testo con XML in chiaro. Il risultato di un subagente in background diventa una riga compatta con stato, ruolo, durata, peso della risposta e la sua sintesi, e un click apre il transcript completo nel cassetto; i messaggi scambiati tra agenti mostrano mittente, corpo formattato e a cosa rispondono, senza il testo di servizio destinato al modello; i promemoria e le istruzioni interne che `omp` scrive per l'agente e non per te restano nascosti, e il nuovo interruttore «Mostra i messaggi interni dell'agente» in Impostazioni → Generale li riporta a schermo come righe compatte quando serve capire cosa sta guidando l'agente. Tre o più avvisi di sistema di fila si raccolgono in una sola riga espandibile. Il promemoria dei todo rimasti aperti non viene più stampato in chat: la striscia dei todo mostra invece un contatore dei solleciti (`1/3`), che diventa ambra all'ultimo tentativo quando l'agente è in stallo. Lo stesso trattamento vale dentro il cassetto del transcript di un subagente.

### Fixed
- La risposta rapida con testo precompilato (prefill) nella finestra Companion inoltra correttamente la risposta anche senza modifiche manuali, evitando lo stallo dell'agente in attesa di input.
- Il contesto della conversazione nelle domande della Companion non e' piu' testo grezzo: grassetto, elenchi, titoli, citazioni e blocchi di codice sono resi come nella chat, e il riquadro nasce sulla **fine** del messaggio invece che sul suo inizio. La parte che serve a rispondere e' la conclusione, non il preambolo; risalire il messaggio resta possibile scorrendo.
- Raggruppamento dei tool e de-duplicazione dei footer modello nella timeline: le chiamate a tool operativi consecutivi (con i relativi passaggi di thinking/ragionamento interno privi di testo o immagini per l'utente) vengono ora correttamente accorpate in un unico gruppo compatto anziché generare card isolate con footer modello ripetuti a ogni turno; i commenti narrativi e le spiegazioni dell'agente restano leggibili nella timeline principale e il footer con modello e costo ricompare unicamente alla risposta finale.
- I task eliminati esternamente non risorgono più alla rilettura del progetto: la sincronizzazione da file su disco (watcher, finestra Companion o comando /tasks) sostituisce ora la lista in memoria preservando esclusivamente i task in spedizione non ancora consegnati ad omp, evitando che task cancellati ricompaiano al salvataggio successivo.
- Gli errori ordinari dell'agente non bloccano più la coda con falsi allarmi di quota: la condizione di blocco quota viene attivata unicamente a fronte di reali esaurimenti di crediti o limiti di spesa comunicati dal provider, e viene azzerata automaticamente all'invio di un nuovo prompt o all'avvio di un turno di lavoro.
- La modalità di notifica sintetica non mostra più il testo della domanda dell'agente nel centro notifiche o nella schermata di blocco, preservando la riservatezza impostata dall'utente.
- La scorciatoia Ctrl+Tab per scorrere tra i progetti aperti rispetta i campi di testo, l'editor Monaco e i dialoghi modali, evitando cambi accidentali di progetto durante la digitazione o la conferma.
- I menu, le descrizioni delle scorciatoie e i popover di stato rispondono immediatamente al cambio lingua nelle Impostazioni senza richiedere il riavvio dell'applicazione.
- Tutte le azioni e le etichette di stato della finestra Companion sono state localizzate in italiano e in inglese.
- I processi omp avviati tramite RPC vengono terminati in modo pulito alla chiusura di Studio, prevenendo processi orfani in background.
- Il fallimento nel caricamento iniziale dei progetti espone ora un avviso visibile a schermo e attiva la modalità di sola lettura protetta, anziché mostrare una finestra vuota ingannevole.
- La Companion non mostra più in coda un lavoro già svolto. Il task che lasciava la coda per partire veniva ricordato per sempre come «attivo», e la prima interruzione successiva — chiusura del progetto mentre l'agente lavorava, uscita da Studio — lo rimetteva in cima alla coda insieme all'ultimo task lanciato, anche se quel lavoro era finito da ore. Ora il ricordo dura solo la finestra in cui il prompt può davvero perdersi, cioè fino al primo segno di vita del processo omp: se il processo muore prima di riceverlo il task torna in coda come prima, se invece è arrivato in sessione resta nella sua sessione, riprendibile dallo storico, e non riappare fra le cose da fare.
- Studio non riempie più la cartella `~/.omp/logs` di file di log. Ogni interrogazione a `omp` (quote, catalogo modelli, versione, controllo aggiornamenti) fa nascere un processo, e `omp` apre un file di log per processo che poi non riesce più a togliere quando il PID viene riciclato dal sistema: sul profilo di prova erano 9.684 file per 32 MB, quasi 3.000 al giorno, di cui 1.762 solo per il pannello delle quote. Ora il log del processo appena consultato viene cancellato subito dopo la lettura, e all'avvio Studio ripassa i file che `omp` considera scaduti da oltre cinque giorni. I log delle sessioni vere dell'agente non vengono toccati.
- Il pannello delle quote interroga `omp` una volta per tutte le finestre e non lo fa più a finestra minimizzata. Prima ogni finestra aperta partiva col proprio timer da 90 secondi, anche di notte: sei finestre significavano sei processi e sei chiamate alle API dei provider ogni volta, con letture quasi simultanee (sul profilo di prova 716 intervalli sotto i 5 secondi in un giorno). Adesso il dato vive un minuto in una cache condivisa, letto una volta sola anche se sei finestre lo chiedono insieme; il pulsante «Aggiorna» resta immediato, con un pavimento di dieci secondi, e al ritorno in primo piano la quota viene riletta subito se è scaduta.
- Un task che non parte non viene più perso. L'avvio dalla coda considerava consegnato il prompt appena la chiamata di invio ritornava: se omp lo rifiutava, o se la sessione non era ancora stata pubblicata, il task usciva comunque dalla coda e restava soltanto una sessione vuota, senza il testo scritto. Ora il task lascia la coda solo a consegna confermata, altrimenti torna in attesa con il motivo a schermo. Se invece il prompt è in attesa della fine dell'insediamento e il processo omp muore prima di riceverlo, il task torna in cima alla coda con prompt, allegati e configurazione, invece di lasciare solo un avviso in chat. Un task in spedizione conta inoltre come lavoro in coda per la chiusura del progetto, che prima lo portava via senza chiedere nulla perché guardava solo i task ancora fermi.
- Lo storico dei lanci non viene più cancellato dall'altra finestra e non cresce senza limiti. L'elenco che arriva dalla Companion viene fuso con quello locale invece di sostituirlo: una copia più vecchia cancellava il lancio appena registrato, cioè l'unica copia del prompt di un task che ha lasciato la coda. Si conservano i cinquanta lanci più recenti per progetto, con prompt e immagini solo per gli ultimi tre, perché lo store globale dei task viene riscritto per intero a ogni modifica di coda: sul profilo di prova è passato da 3,5 MB a 171 KB.
- Rileggendo la coda di un progetto dopo una modifica esterna (terminale, comando `/tasks`, altra finestra di Studio) i task creati nel frattempo non vengono più scartati: il file resta la fonte, ma un task non ancora salvato rimane in coda invece di sparire.
- Nella scheda Coda del pannello Agente il pulsante «Nuovo task» occupa tutta la larghezza con testo centrato e il badge di stato («OMP sta lavorando», «Sessione OMP non aperta») sta sulla riga sotto, a piena larghezza: prima i due elementi si dividevano una colonna strettissima e l'etichetta del pulsante si spezzava su due righe. Le etichette di stato troppo lunghe vengono ora troncate con i puntini invece di sfondare il chip.
- La coda della Companion si comanda riga per riga: ogni task in attesa ha il suo pulsante per farlo partire subito e il suo cestino per toglierlo, le code lunghe mostrano i primi tre task e il residuo conteggiato senza scorrimento per non occultare i progetti che stanno lavorando.
- Il motivo per cui un lavoro non può partire si legge a schermo, in ambra sotto la coda, invece di stare in un suggerimento su un pulsante disabilitato che né il mouse né la tastiera riescono a interrogare. E il pulsante non è più attivo quando lo stato dell'agente è ancora sconosciuto: prima in quel caso il click non produceva nulla, in silenzio.
- La Companion parla una lingua sola: stato dei progetti, conferma di salvataggio, etichette dei pulsanti finestra e degli allegati passano dalla traduzione come il resto dell'applicazione. Prima, con l'interfaccia in inglese, nello stesso elenco convivevano «Awaiting response» e «Al lavoro».
- Corretti gli angoli del campo di scrittura nel layout Launcher, che risultavano vivi mentre tutto il resto della finestra è raccordato, e ripristinato il riquadro della scheda di recupero quota, che era senza sfondo né bordo: tre valori di stile riferivano nomi inesistenti e si azzeravano in silenzio.
- Testi colorati più leggibili nella Companion: stato «al lavoro», badge «Consigliata», conferma di salvataggio, prefissi dei token e intestazioni della cronologia usano ora la tinta pensata per il testo, superando la soglia di contrasto AA che prima mancavano (da 3,45:1 a oltre 5:1).
- Bersagli di click più grandi dove erano troppo piccoli per essere presi con sicurezza: pulsanti finestra, pastiglie `@ / !`, avvio di un task, «+N altri progetti» e rimozione di un'immagine allegata raggiungono i 24px richiesti, senza ingrossare la grafica.
- La coda task spiega perché un lavoro non può partire — mostrando anche la domanda reale che blocca la chat — invece di ignorare il clic; le domande facoltative poste a lavoro concluso non fermano più la coda e le card mantengono titolo, anteprima e indicatori dentro i propri bordi anche con testi lunghi.
- Il menu dei comandi `/` non copre più il testo del task: nell'editor dei task il pannello dei comandi si apriva sopra il campo di scrittura, nascondendolo per intero, e non si riusciva a rileggere quello che si stava scrivendo. Ora il pannello vive nel livello superiore della finestra, si apre sotto il campo, si ribalta sopra quando sotto non c'è spazio e si accorcia da solo nelle finestre basse, scorrendo al proprio interno invece di sbordare. Vale anche per la palette della chat, che non viene più tagliata dai riquadri circostanti.
- Meno furti di fuoco mentre l'agente lavora: il viewport del browser live non si riprende più il fuoco quando Studio è in secondo piano, i modali che compaiono da soli (avviso di aggiornamento, controllo modelli) non spostano più il fuoco su di sé se stai lavorando in un'altra applicazione, e il salto a una riga nell'editor non porta più il cursore in Monaco a finestra non attiva. Aggiunta inoltre una traccia diagnostica che registra ogni cambio di fuoco con l'attività dell'agente in corso, per individuare i casi residui.
- Digitando nell'editor con un agente attivo, i tasti non vengono più dirottati nel composer della chat: la funzione «type-to-focus» rispetta ora Monaco, il terminale e le altre superfici di scrittura.
- L'avvio di una seconda istanza dell'applicazione (per esempio da test, build o comandi lanciati da un agente) non ruba più il focus alla finestra in uso dell'utente: invece di forzare Studio in primo piano sopra le altre applicazioni aperte, l'evento viene segnalato in modo discreto con un avviso informativo sulla barra delle applicazioni.
- La Companion mostra subito i task in coda dei progetti già aperti, anche dopo un avvio o una riapertura: la sincronizzazione viene ripetuta quando compare la finestra, le code già lette non vengono più cancellate da una lettura globale tardiva e le modifiche effettuate dalla finestra principale raggiungono l'altra webview.
- Il layout della Companion cambia subito: scegliendo un preset in «Impostazioni → Companion» la finestra si ridisegna all'istante, senza chiudere e riaprire Studio. Vale per tutte le impostazioni e per il tema: quello che cambi nella finestra principale arriva alla Companion mentre è aperta.
- In tutti i cinque layout si può premere su un progetto per aprire e richiudere la sua coda task, con il pulsante «Avvia prossimo»: prima rispondeva solo il layout Cruscotto e negli altri il clic non faceva nulla. Le righe progetto sono ora raggiungibili anche da tastiera (Tab, Invio o Barra spaziatrice) e i layout Inbox e Cruscotto mostrano anch'essi l'elenco dei progetti.
- Con la finestra fissata l'elenco progetti è completo: l'invito «+N altri progetti — fissa la finestra» non compare più a finestra già fissata, e da finestra effimera quel pulsante ora la fissa davvero invece di sfissarla. Lo stato «fissata» è condiviso fra le due finestre, quindi la pastiglia della barra superiore e l'header della Companion non si contraddicono più.
- Il layout Cruscotto mostra le richieste di intervento dell'agente: prima erano invisibili proprio nel preset pensato per il monitoraggio, e le domande non si potevano rispondere dalla Companion.
- Nel layout Launcher la pastiglia «N richieste di attenzione» si richiude con un secondo clic; nel layout Inbox il composer compresso si apre con un clic (o da tastiera) mentre ci sono richieste da smaltire.
- In modalità Spotlight la maniglia di trascinamento non intercetta più i clic sul primo elemento della finestra (composer del Launcher, prima riga progetto del Compatto).
- Rinominare un progetto o cambiargli colore si riflette subito nella Companion, che prima restava sul vecchio nome fino al riavvio.
- Le code dei task non spariscono più chiudendo e riaprendo Studio. All'avvio Studio non leggeva `.omp/tasks.json` dei progetti aperti (la lista progetti arriva dal disco un istante dopo, e nessuno rileggeva le code), quindi alla chiusura salvava una coda vuota sopra il file di ogni progetto, cancellandone il contenuto. Ora la coda di un progetto viene letta prima di poter essere scritta: se la lettura non riesce, il salvataggio viene annullato invece di azzerare il file, un task aggiunto mentre il file è ancora in lettura non viene più perso, e svuotare una coda non la fa più riapparire. Anche l'aggiunta di un task dalla Companion e il comando `/tasks` del terminale ora si fermano con un errore invece di sovrascrivere una coda che non sono riusciti a leggere.
- Rimossa l'interruzione accidentale dell'agente con il tasto Esc: premere Esc all'interno di un progetto chiude solo modali, menu o palette e non interrompe più l'elaborazione in corso, che può essere fermata unicamente tramite il pulsante di stop dedicato.
- Risposta personalizzata e opzione «Altro» nel Companion: premendo l'opzione «Altro (scrivi la tua risposta)» o «Other (type your own)» nella card di risposta rapida del Companion si apre immediatamente il campo per digitare la risposta personalizzata con scorciatoia Invio, senza più inviare la stringa letterale al processo e senza scatenare il dump terminale CLI non formattato (con caratteri `▮` e prompt duplicati) come testo di dettaglio della domanda; ripuliti gli artefatti CLI dai messaggi di dettaglio e aggiunta l'etichetta «Consigliata» alle opzioni raccomandate.
- Gli agenti in background che falliscono per esaurimento quota o errore del provider non vengono più mascherati come «Completato»: lo stato del progetto preserva correttamente la condizione di attenzione evitando che l'icona verde di successo tragga in inganno l'utente.
- La chiusura di progetti e scratchpad dal relativo popover funziona di nuovo: il comando viene inoltrato prima che il pannello venga smontato, preservando anche la conferma per i progetti con task in coda o in esecuzione.
- Grafica del popover di progetto e sigla: sostituito il vecchio riquadro quadrato a dimensione fissa con un chip geometrico proporzionato identico a quello del cassetto della coda; le sigle personalizzate (come «OMP-S») non vanno più a capo né debordano, e l'intestazione si allinea con spaziatura e altezze coerenti su nome e percorso.
- Grafica del popover della coda e sigla progetto: sostituito il vecchio pallino rotondo a dimensione fissa con un chip geometrico proporzionato che ospita nitidamente qualsiasi sigla o abbreviazione di progetto (anche personalizzata come "OMP-S") senza andare a capo né sbordare; riorganizzato l'header di ciascun gruppo con allineamento naturale a colonna tra nome del progetto e stato di elaborazione, eliminando l'indentazione fissa disallineata.
- Raggruppamento delle chiamate tool e de-duplicazione del footer modello nella chat GUI: i commenti narrativi o di spiegazione emessi prima e tra le chiamate agli strumenti (tipici di modelli come Muse Spark o modelli contributor che non usano un canale di thinking dedicato) vengono ora inclusi nell'esecuzione del `ToolGroup` compatto anziché spezzare i tool in card singole isolate; all'interno del gruppo espanso i passaggi testuali vengono visualizzati con formattazione pulita e il badge del modello con relativo costo viene de-duplicato, comparendo solo in fondo alla risposta finale dell'assistente.
- Il Companion mostra di nuovo la domanda dell'agente e permette di risponderla: prima un progetto che chiedeva una risposta compariva con il solo stato «Chiede risposta» e nessuna domanda, perché la richiesta veniva scartata quando l'agente non allegava un messaggio di dettaglio (cioè quasi sempre). Ora la card riporta la domanda, la sua posizione nella sequenza (`1/2`), la descrizione di ogni opzione, gli ultimi messaggi della chat con il tasto per vederne di più, e un campo di testo per le richieste a risposta libera. Anche le notifiche di sistema e il popover del progetto mostrano il testo della domanda invece di restare muti.
- L'inserimento rapido dei task nel Companion interpreta localmente progetto, direttive e ruolo mentre si scrive e avvia il modello `smol` solo al salvataggio quando serve, evitando processi continui e l'errore Windows 206 causato da argomenti troppo lunghi.
- Il monitor del Companion mostra ora lo stato effettivo di ogni progetto e, solo per gli agenti al lavoro o in attesa di risposta, la quota del modello e dell'account realmente in uso.
- I delta delle chiamate agli strumenti (toolcall) durante lo streaming non vengono più scambiati per blocchi di pensiero, eliminando la comparsa di falsi riquadri «Ragionamento · 1 riga» intervallati tra risposte e tool.
- Colori del Companion ripristinati: pastiglie, avvisi, conferme e bordi accentati usavano nomi di colore inesistenti nel tema e venivano scartati dal browser, lasciando testo del colore ereditato su fondi trasparenti (il progetto mancante appariva come testo rosso nudo e l'avviso in blu senza riquadro).
- Il suggeritore `@progetto` e `/direttiva` del Companion non viene più tagliato: si apre sotto il campo nel livello superiore della finestra, mentre prima si apriva verso l'alto e finiva fuori dallo schermo o dentro l'area a scorrimento.
- Il punto colorato dei progetti nel Companion ha ora la stessa tinta della barra dei progetti nella finestra principale: la tinta del tema veniva interpretata come gradi HSL e ogni progetto usciva di un altro colore.
- Il focus non viene più strappato mentre si scrive un prompt: le domande dell'agente arrivate da progetti in background non rubano più il fuoco al composer o al TaskEditor, il type-to-focus globale non dirotta più la digitazione dai controlli di altre superfici, il viewport del browser live riprende il fuoco solo se è andato perso nel vuoto dopo un rimontaggio, e i tasti Esc/Ctrl+Invio premuti fuori dal TaskEditor non lo chiudono più.
- Le richieste di risposta dell'agente non riportano più Studio in primo piano mentre stai scrivendo in un'altra applicazione o nella Companion: la card riceve il focus solo se la finestra principale è già attiva.
- Risolto il falso stato di modifica all'apertura dei documenti nell'editor: Monaco ora preserva il BOM UTF-8 (`\uFEFF`) e allinea la baseline iniziale al caricamento, evitando la comparsa ingiustificata del pallino di non salvato e del pulsante «Salva» su file appena aperti dal filetree o dai link della GUI.
- La finestra Companion ricorda la dimensione che le hai dato: prima tornava più larga a ogni riapertura. La misura veniva salvata solo nell'istante in cui la fissavi (e comprendeva i bordi invisibili di ridimensionamento, che si sommavano a ogni giro), mentre fissarla dal pulsante nella barra superiore della finestra principale cancellava del tutto la dimensione memorizzata riportandola a 560x520. Ora posizione e dimensione si salvano quando chiudi la finestra e quando esci dall'applicazione, e restano quelle alla riapertura in entrambe le modalità (Spotlight e fissata).
- La Companion non lampeggia più mentre rispondi a una sequenza di domande nella finestra principale. Lo stato delle attenzioni viaggia con `emit`, che consegna anche a chi lo manda: la finestra principale si riapplicava il proprio annuncio e, poiché il passaggio da JSON toglie i campi vuoti che le domande `ask` portano con sé, lo giudicava diverso da quello appena pubblicato. Ne seguiva un rimbalzo continuo fra le due finestre: la card veniva ridisegnata decine di volte al secondo, il contenuto saltava su e giù e tornava sempre alla prima domanda. Ora ogni finestra scarta i propri annunci e il confronto considera identici un campo assente e un campo vuoto.
- Salvare un task dalla Companion è immediato anche la prima volta. Il salvataggio aspettava il caricamento completo dei modelli, che avvia `omp models --json` (circa due secondi) per un elenco che al task non serve: ora legge solo i ruoli configurati e il catalogo locale, mentre l'elenco completo dei modelli disponibili si carica in sottofondo all'apertura della finestra, dove serve alle menzioni `!ruolo` e `!modello`.
## [1.5.0] - 2026-09-08

### Added
- Layout personalizzabile con supporto a monitor verticali (portrait) e collasso della barra laterale: commutazione automatica o manuale tra vista orizzontale a 3 colonne e vista verticale con editor in alto e terminale/chat in basso divisi da splitter orizzontale, scorciatoia `Ctrl+Alt+L` e chip di stato nella barra superiore per ciclare la modalità, e possibilità di nascondere o mostrare la barra laterale (File/Git/Agente) con `Ctrl+Alt+B` o cliccando sul logo &pi; in alto a sinistra per dedicare tutta la larghezza all'editor e alla conversazione.
- Due stili per il popover delle quote, selezionabili in «Impostazioni → Aspetto» accanto a quello della chip: «Telemetria», con barra sottile, zona già consumata rigata e lettura di stato `OK / WARN / CRIT` per ogni finestra, e «Anello», con un indicatore circolare per finestra che si scarica e mostra una pastiglia di stato quando la quota scende. Le due card mostrano un'anteprima reale che cambia con la scelta, e lo stile vale sia nella finestra principale sia nel Companion.
- Colori semaforo attivabili separatamente per il popover delle quote: ora chip e popover hanno interruttori indipendenti, così si può tenere la barra superiore sui colori del tema e leggere invece verde/ambra/rosso nel dettaglio dei limiti (o viceversa).
- Il controllo dei modelli in «Impostazioni → Modelli» verifica ora anche le riserve di ogni ruolo e non solo i modelli primari, e non si limita più a cercare versioni più recenti: segnala i modelli che non è più possibile usare — ritirati dal catalogo del provider, non più offerti dalle credenziali attive, appartenenti a un provider disabilitato o senza credenziali — così una quota esaurita non porta più a un blocco inspiegabile su una riserva che nel frattempo è scomparsa. Il referto propone la sostituzione con il modello equivalente disponibile o la rimozione della riserva morta, e non modifica mai la configurazione senza conferma.
- Controllo dei modelli in background: parte all'avvio di Studio e si ripete ogni 12 ore, aggiornando il catalogo dai provider solo se ha più di un giorno. L'avviso non interrompe il lavoro: la chip «Impostazioni» mostra un punto esclamativo arancione quando un modello configurato non è più utilizzabile e un pallino blu quando sono disponibili solo aggiornamenti di versione; il clic porta direttamente alla sezione Modelli, dove ogni ruolo e ogni riserva con problemi è evidenziato con il motivo.
- Finestra Companion con doppia modalità Spotlight e Widget persistente (`Alt+Spazio`), Risposta Rapida (Quick Reply) con contesto chat per le richieste dell'agente e inserimento rapido dei task in linguaggio naturale: permette di rispondere alle domande di un agente in background e di catturare task per qualsiasi progetto senza interrompere la lettura o la navigazione su altre applicazioni; include interpretazione AI del testo (estrazione automatica di progetto, ruolo, modello e direttive), verifica preventiva dell'esaurimento quota con avvisi espliciti, memoria multi-monitor di posizione e dimensioni della finestra pinnata, pulsante Companion dedicato nella barra superiore di Studio e popover interattivo rapido sulle tessere di progetto in attenzione senza mai dover cambiare workspace o vista attiva.
- Hardening completo, ripristino automatico e accessibilità per Browser Studio: riconnessione automatica dello stream live con backoff limitato e pulsante di riprova immediata in caso di interruzioni, chiusura pulita e deterministica di tutti i canali del browser alla terminazione o errore della chat per evitare processi o file orfani, isolamento della tastiera alla superficie attiva con supporto alla navigazione (indietro, avanti, ricarica con scorciatoie standard), focus trap completo con gestione del tasto Escape sui dialoghi della pagina e sul selettore di schede Chrome Relay, e limiti rigorosi di memoria e messaggi in coda per garantire fluidità e stabilità in lunghe sessioni multi-progetto.
- Collegamento esplicito di una singola scheda del Chrome personale a Browser Studio tramite il Relay OMP esistente: il selettore mostra solo titolo, origine e stato necessari alla scelta; un grant monouso lega progetto, chat e target; screencast, input e inspector riusano la stessa `BrowserViewer`, i control epochs e il takeover privato; la revoca interrompe subito frame e controlli senza chiudere Chrome o perdere login e sessioni SSO; le capability Relay mancanti producono una diagnostica limitata alla scheda concessa.
- Gestione esplicita di dialoghi, popup, file, permessi e registrazione video per Browser Studio: gli alert, confirm, prompt e prima dell'uscita (beforeunload) generati dalle pagine sono visualizzati con modale dedicato in `BrowserViewer` senza bloccare il supervisor del runtime (interruzione immediata e sicura delle azioni dell'agente in assenza di policy automatica e risposta tracciata); le nuove finestre e popup aperti dalla pagina vengono adottati automaticamente come schede appartenenti alla stessa chat; i download da origini remote vengono trattenuti in quarantena sicura di progetto e trasformati in artifact di conversazione solo su consenso esplicito dell'utente; il caricamento file (`<input type="file">`) è vincolato all'apertura del selettore nativo del sistema operativo escludendo accessi generici o non supervisionati al filesystem da parte dell'agente (`UPLOAD_NOT_AUTHORIZED`); quattro capability distinte a livello di origine (lettura/scrittura appunti, geolocalizzazione, notifiche) configurabili direttamente dalla toolbar; registrazione video locale della scheda in container standard MJPEG/AVI tramite un generatore deterministico puro senza requisiti di `ffmpeg` esterno, con percorsi di salvataggio e cancellazione coordinati.
- Inspector mirato per Browser Studio: integrato direttamente nella superficie `BrowserViewer` senza incorporare Chrome DevTools completo; include Element Picker con highlight overlay non invasivo e tooltip semantico su coordinate CSS del viewport nativo per estrarre tag, ruolo ARIA, nome accessibile, testo, selettore CSS univoco, bounding box, stili computati rilevanti, componente React/Svelte e ritaglio PNG dello screenshot; pannelli Console (500 item con deduplicazione dei messaggi consecutivi e stack trace), Rete (200 item con aggiornamento in-place, filtri avanzati e download del corpo risposta on-demand) e timeline Actions (100 item) gestiti con ring buffer a memoria limitata e redazione automatica di credenziali URL, header sensibili e token Bearer; dock retrattile inferiore con navigazione da tastiera protetta dall'inoltro indebito di input al browser e pulsanti per l'invio selettivo del contesto strutturato e dello screenshot ritagliato direttamente nel prompt del Composer.
- Policy delle origini top-level, consenso persistente per progetto e redazione di sicurezza per Browser Studio: navigazione automatica per origini locali e loopback (localhost, 127.0.0.1, [::1]), consenso esplicito preventivo per nuove origini remote con banner e badge di stato in BrowserViewer, memorizzazione persistente per progetto con possibilità di revoca immediata dalle impostazioni o dalla toolbar, sospensione automatica delle azioni dell'agente in caso di redirect top-level verso origini non autorizzate, separazione netta tra navigazioni documentali e caricamento di risorse secondarie (immagini, script, CDN, API), redazione automatica di credenziali URL, header Authorization, cookie e token nei log, eventi e artifact, e completo isolamento del frontend Svelte da endpoint CDP grezzi e segreti interni.

- Arbitraggio esclusivo del controllo della pagina e takeover privato per Browser Studio: gestione rigorosa dell'alternanza tra controllo dell'agente e dell'utente tramite epoche di controllo crescenti (control epochs), takeover atomico al primo clic o tasto umano con bufferizzazione e invio dell'interazione una sola volta verso Chromium, interruzione immediata con errore strutturato CONTROL_INTERRUPTED di qualsiasi operazione dell'agente in corso e blocco di nuovi comandi, pulsante dedicato nella toolbar per restituire esplicitamente il controllo all'agente con nuovo snapshot della pagina, e modalità di takeover privato (attivabile manualmente o automaticamente su campi password/CAPTCHA) che continua a mostrare lo stream video all'utente nel visualizzatore locale oscurando e bonificando completamente transcript, screenshot, DOM, console e rete all'agente.
- Nuova superficie Browser nella colonna centrale (`BrowserViewer`) per Browser Studio: si apre automaticamente all'avvio del tool `browser` o all'apertura di una scheda gestita preservando lo stato dell'editor Monaco, dei file aperti e delle anteprime statiche; include toolbar con URL, navigazione (indietro, avanti, ricarica), selettore schede, modalità operativa, selettore responsive del viewport (Desktop, Tablet 768px, Mobile 390px), badge dello stato controller (Agente, Utente, Privato) e cattura istantanea dello screenshot negli appunti; renderizza lo stream video live JPEG appena i fotogrammi arrivano, con la politica «vince il fotogramma più recente» e mapping geometrico esatto delle coordinate del puntatore e dello scroll in pixel CSS nativi del viewport Chromium invariante rispetto a ridimensionamento della finestra, zoom e DPI scaling.
- Nuova chip quota contestuale al progetto attivo nella barra superiore con stili selezionabili ("Anello progressivo" e "Pill riempita"), opzione per mostrare sempre la percentuale o solo in allarme, toggle per il nome del provider e riorganizzazione della sezione «Impostazioni → Aspetto» con sincronizzazione automatica della galleria temi.
- Studio e il runtime `omp` concordano ora una capability versionata `browser-live-v1` all'avvio della sessione: e la base del futuro Browser Studio. Finche il runtime non offre il canale live non cambia nulla di visibile — il tool `browser` continua a mostrare riepilogo e screenshot come oggi — e con un runtime privo della capability Studio non tenta alcuna connessione.
- Il runtime `omp` dispone ora del broker delle sessioni browser (`BrowserSessionBroker`) e di un motore Chromium gestito sempre senza finestra desktop: isola cookie e archiviazione per singolo progetto in cartelle dedicate, indirizza le schede tramite identificativi legati alla specifica sessione di chat (evitando collisioni tra schede con lo stesso nome in conversazioni diverse), instrada l'intero controllo CDP attraverso il broker e termina i processi senza lasciare orfani.
- Canale live loopback binario e backpressure per Browser Studio: lo stream video ad alta frequenza viaggia fuori dal canale RPC tramite un formato binario compatto a lunghezza prefissata (BLF1), con gestione della memoria rigorosamente limitata e scarto deterministico dei frame obsoleti in caso di client lento, riconnessione immediata senza perdite di stato e acquisizione diretta degli screenshot alle dimensioni reali del viewport.
- Colori semaforo opzionali per la quota in «Impostazioni → Aspetto»: verde quando la quota è abbondante, giallo sotto il 30%, rosso sotto il 10% o a quota esaurita, con palette dedicate per tema chiaro e scuro. L'opzione è disattivata di default e, se non la si attiva, la chip continua a seguire i colori del tema.
- La chip quota segnala con un piccolo pallino quando una finestra più lunga (per esempio quella settimanale) è quasi esaurita mentre quella di sessione è ancora libera, senza alterare la percentuale mostrata.
- Righe dei task in coda piu leggibili con due viste selezionabili in «Impostazioni → Aspetto»: «Compatta» (predefinita) con titolo ed estratto a tutta larghezza su tre piani e tutti i badge sotto il testo, ed estratto su due righe; «Card» con ogni task come scheda separata, titolo su due righe ed estratto su tre. Vale sia per la scheda Coda sia per il cassetto globale.

### Changed
- Spostata la configurazione della disposizione finestra da «Impostazioni → Generale» a «Impostazioni → Aspetto» con nuovo selettore visuale a schede (Automatico, Orizzontale a 3 colonne, Verticale a stack) con anteprima grafica integrata, e rimossa la chip layout dalla barra superiore per alleggerire l'intestazione dell'applicazione (la scorciatoia Ctrl+Alt+L resta attiva per la commutazione rapida).

### Fixed

- Studio non si chiude più all'improvviso per colpa di una pagina web: un dialogo, un messaggio di console o il nome di un download che contenevano determinate lettere maiuscole non latine facevano terminare l'intera applicazione durante il mascheramento dei dati sensibili, con perdita del lavoro non salvato.
- Il mascheramento dei dati sensibili nei log del browser copre ora tutti i token di autorizzazione presenti in un messaggio (prima solo il primo restava nascosto e gli altri comparivano in chiaro in transcript e artifact) e si applica anche all'origine dei permessi richiesti dalla pagina.
- Il consenso alle origini remote di Browser Studio ha effetto: «Consenti per questo progetto», «Rifiuta» e «Revoca» vengono ora comunicati al runtime `omp`, che possiede l'elenco delle origini rispettato dall'agente. Prima erano scritture locali di Studio, quindi il consenso non sbloccava la navigazione, la revoca non fermava l'agente e il badge dichiarava uno stato che nessuno applicava. Con un runtime `omp` che non conosce ancora la richiesta, la decisione non viene più data per applicata: Studio lo dice esplicitamente e invita ad aggiornarlo.
- La tastiera non muore più dopo un cambio di stato della pagina: la superficie live non viene più smontata a ogni riconnessione o aggiornamento della scheda (lo stato dello stream è ora un velo sopra l'ultimo fotogramma), il focus torna alla superficie quando ricompare e il rilascio di un tasto viene sempre inoltrato, così la pagina non resta con un tasto o un modificatore premuto.
- Ogni aggiornamento della scheda (navigazione, caricamento, presa di controllo) non riapre più il canale live da zero: prima ogni evento consumava un ticket monouso, apriva una nuova sessione verso il limite di 32 e azzerava il conteggio dei tentativi di riconnessione, e all'apertura del pannello le sessioni aperte erano due invece di una.
- Un rifiuto della singola azione (dialogo già risolto, download non consentito, registrazione non attiva) non abbatte più tutto lo stream costringendo a una riconnessione completa: solo gli errori di ticket, sessione o stream chiudono il canale.
- Il takeover privato non lascia più uscire nulla della pagina: il ritaglio dell'elemento ispezionato non viene prodotto né allegato al prompt, l'ispezione è disabilitata e i dati già raccolti vengono scartati appena la modalità privata si attiva.
- Un dialogo della pagina non resta più a coprire il pannello dopo la fine della chat o la chiusura della scheda, non si può più rispondere due volte allo stesso dialogo (Escape tenuto premuto compreso) e i comandi inviati mentre il canale è giù ora lo dicono invece di non fare nulla in silenzio.
- Il semplice passaggio del puntatore sulla pagina non interrompe più il comando dell'agente: il controllo passa all'utente solo con un gesto deliberato (clic, tasto, rotellina).
- Il menu dei permessi non mostra più «Nega» come scelta attiva per permessi su cui nessuno ha ancora deciso: senza risposta della pagina lo stato mostrato è «Chiedi», come prevede il contratto.
- La finestra Companion torna ad aprirsi correttamente al clic sulla chip nella barra superiore e con la scorciatoia da tastiera: risolto il fallimento della creazione della webview nativa su Windows dovuto a parametri del browser disallineati tra le finestre, e garantito il ripristino visivo e del focus a ogni richiamo.
- Riconoscimento corretto dell'account attivo per la chip della quota: quando una conversazione impiega credenziali specifiche di un provider (es. un secondo account con residuo differente), la chip recupera puntualmente il pin dal transcript sia su chat grafica che su terminale senza fermarsi a cache vuote né perdere l'associazione al termine della generazione o alla scadenza delle sessioni recenti.
- Le barre del popover quote non si aggiornavano più dopo la prima apertura: l'animazione partiva una sola volta al montaggio, quindi un aggiornamento dei consumi a popover aperto cambiava la percentuale scritta ma non la barra. Ora barra e anello seguono il valore con la stessa animazione, in comparsa e a ogni aggiornamento.
- Le quote residue vengono ora annunciate ai lettori di schermo come indicatori di livello (con percentuale e tempo di ripristino) e non più come barre di avanzamento, che descrivevano un caricamento inesistente.
- L'anello di attenzione sulla tessera del progetto e la voce «In attesa» nella barra di stato ora compaiono sempre quando l'agente fa una domanda: se la richiesta arrivava prima dell'evento del tool `ask` — cosa che succede a intervalli casuali — lo stato veniva subito riportato a «In esecuzione», la tessera restava senza anello e l'allerta sull'icona dell'app veniva azzerata pur avendo già inviato la notifica di sistema.
- Studio non resta più bloccato con tutti i pannelli in caricamento all'avvio: la sincronizzazione della finestra Companion riscriveva l'elenco delle richieste di attenzione a ogni passata anche quando non era cambiato nulla, e siccome quella scrittura avveniva dentro l'effetto che rilegge lo stesso elenco, l'effetto si richiamava da solo fino a interrompere il disegno dell'interfaccia. Ora si scrive soltanto quando lo stato cambia davvero.
- Risolta l'animazione anomala sul pulsante «Verifica Modelli» in «Impostazioni → Modelli»: durante il controllo la lente d'ingrandimento viene ora sostituita da un indicatore di caricamento circolare dedicato, evitando la rotazione impropria dell'icona statica.
- Corretto il ritaglio (clipping) degli anelli di focus da tastiera in tutta l'applicazione: le tessere del selettore temi, i pulsanti della barra della finestra, le schede aperte, le righe della cronologia sessioni e i menu contestuali utilizzano ora anelli interni (inset) o margini perimetrali dedicati per garantire che l'indicatore di fuoco non venga mai tagliato dai bordi dei contenitori a scorrimento, e ripristinato l'indicatore visivo di focus da tastiera sui toggle switch e sui menu a discesa dei modelli.
- Nomi dei provider corretti nel menu di selezione agente/modello: i modelli pubblicati da un gateway con identificativi del tipo `provider/modello` non vengono piu confusi con quelli del provider nativo, e ruoli, fallback e cassetto del ciclo rapido mostrano il provider giusto.
- I percorsi file emessi dall'assistente come blocchi di codice (fenced code block) vengono ora renderizzati come chip compatti e cliccabili per aprirli direttamente nell'editor (con supporto per elenchi multi-riga e pulsante di copia dedicato), risolvendo percorsi complessi e numeri di riga tramite `resolve_project_file`.
- Riconoscimento intelligente delle nuove versioni dei modelli nella stessa famiglia (es. passaggio da Gemini 3.7 Flash a Gemini 3.8 Flash): la verifica aggiornamenti rinfresca ora automaticamente il catalogo, rispetta i ruoli attivi nel modal impostazioni anche prima del salvataggio, normalizza i formati di numerazione e preview ed evita che le date di snapshot prevalgano sulla versione semantica.
- Rimosso l'anello di focus (outline ring) indesiderato sulle righe dell'albero file e sulla cartella radice all'apertura dell'applicazione, allineando lo stile di focus da tastiera all'evidenziazione di sfondo.
- La chip quota mostrava una percentuale che non corrispondeva alla finestra in corso: con la finestra Anthropic di 5 ore intatta al 100% la barra si fermava a due terzi perché stava riportando la finestra di 7 giorni. Ora barra e percentuale si riferiscono sempre alla finestra più breve, cioè quella che limita il lavoro in quel momento; se una finestra qualsiasi risulta esaurita la chip lo dichiara, perché in quel caso le richieste vengono comunque rifiutate.
- La chip e il popover della quota riempivano le barre in direzioni opposte: la chip indicava la quota disponibile, il popover quella consumata. Ora entrambe si riempiono con la quota ancora disponibile e si svuotano man mano che la si consuma.
- Con più account dello stesso provider la quota mostrata poteva appartenere a un account diverso da quello effettivamente in uso, e l'etichetta «In uso da» compariva su tutti gli account del provider. Studio riconosce ora l'account che la sessione sta realmente utilizzando.
- Sui provider che raggruppano più famiglie di modelli (come Google Antigravity, che tiene contatori separati per Gemini, Claude e GPT) la chip mostra ora il contatore della famiglia del modello in uso, invece del più basso fra tutti.
- La chip non segnala più "Quota esaurita" quando un account inutilizzato ha una finestra esaurita ma un altro account dello stesso provider ha ancora quota disponibile.
## [1.4.0] - 2026-09-02

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
