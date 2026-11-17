# Multi-istanza — registro dei requisiti

**Data dell'accordo:** 2026-11-12. **Decisione:** Gate R49 in [DECISIONS.md](../DECISIONS.md).
**Piano operativo:** «Piano Multi-istanza — Gate R49» in [PLAN.md](../PLAN.md).
**Stato generale:** requisiti registrati; trasporto scelto il 2026-11-16 (iroh con relay proprio, R-MI-16 e R-MI-17); MI00, MI01 e MI02 chiusi; Q3 e Q4 risolte il 2026-11-16 (F16); il resto del piano in corso in un unico lavoro.

Questo documento è la fonte di verità dei requisiti concordati. «Attivo» significa vincolante; implementazione e verifica sono indicate separatamente. Ogni verifica va registrata con data, scenario, risultato e riferimento alla prova.

## Fonti e motivazione

L'utente lavora su due computer, un PC Windows e un Mac, entrambi con Studio. Vuole guidare dalla finestra di uno i progetti che vivono sull'altro, come se fossero locali, e in seguito vedere una sola volta lo stesso progetto presente su entrambi e spostare il lavoro di un agente da una macchina all'altra. Studio Remote (Gate R44 e R48) resta com'è e serve un altro scopo: seguire e concludere il lavoro dal telefono.

Citazioni dell'utente dalla discussione del 2026-11-12:

- **F1 — Scenario guida:** «io sono sul mio pc windows, il mac è a casa acceso e con Studio aperto, io devo avere in topbar i miei progetti che ho aperto sul pc windows e poter aprire e gestire uno qualsiasi dei progetti che sono aperti sul mac».
- **F2 — Elenco e creazione:** «oltre che dalla finestra per aprire un progetto vedere anche l'elenco completo dei progetti sul mac che non sono aperti come schede lì, oltre che poter creare un nuovo progetto e decidere su quale macchina gira».
- **F3 — Parità:** «Devo avere il controllo completo del progetto, quindi quando sono sul mio pc windows all'apparenza che io stia interagendo con un progetto e agente che gira in locale o con un progetto e agente che gira sul mac all'occhio deve essere uguale, tutte le funzioni devono esistere e funzionare correttamente, l'unica cosa devo vedere sul badge del progetto che sta girando sul mac e non in locale».
- **F4 — Punto d'incontro:** «un servizio che gira su qualche sistema gratuito se possibile tipo cloudlfare workers o sistemi serverless che si rende disponibile da fare punto d'incontro, senza dover ragionare su account o roba simile ma solo una chiave da generare la prima volta e poi diventa connessione diretta».
- **F5 — Strade:** «l'opzione 6 è ovviamente la soluzione più completa, però capisco che rivoluzionerebbe studio proprio tantissimo e se può essere fatto a step è meglio. Escluderei la collab di omp, l'ssh e il sync continuo»; «come inizio ci sta questo, quindi la strada 1».
- **F6 — Progetto unico:** «se sia sul mac sia sul pc ho il progetto del mio sito web lo devo vedere una sola volta, non come due progetti diversi e devo decidere dove farlo partire, però il resto deve restare syncato ovvero worktree, task e storico sessioni».
- **F7 — Obiettivo lontano:** «istanze dello stesso progetto siano sincronizzate e si possa passare l'esecuzione di un agente da un computer all'altro».
- **F8 — Rete:** collegamento diretto fra due istanze «indipendentemente che siano sulla stessa rete o due reti esterne».
- **F9 — Proposte accettate:** dopo il confronto con T3 Code e le proposte dell'agente (stato della sessione agganciabile da più finestre, vista unita invece di replica, più vie per la stessa macchina, permessi per ambito, blocco sulle versioni incompatibili): «ok ci sta allora, procedi pure col prossimo step».
- **F10 — Gate:** «sì va bene superare il gate, registra pure tutto».
- **F11 — Macchina spenta (risposta a Q1):** «possiamo partire da niente, cioè vedere che il progetto è inaccessibile perché il mac è spento, secondo me ci sta però almeno poter registrare task in coda».
- **F12 — Programmazione scaduta alla consegna:** «si salva in coda e non parte da solo».
- **F13 — Relay su iroh (2026-11-15):** «potremmo riscrivere il relay facendo sì che si basi su iroh invece che sul nostro codice. Così che quella parte che ci fa comoda del passaggio in rete diretta se nella stessa rete o la criptografia end to end è già fatto da quello e noi ci aggiungiamo solo le nostre cose sopra».
- **F14 — Una finestra sola (2026-11-15):** «io ho una sola finestra di studio dove vedo un progetto in locale e un progetto in remoto e sono fisicamente uguali. Nel senso, posso farci su tutti e due le stesse identiche cose». Conferma R-MI-03 e R-MI-06.
- **F15 — Approvazione del trasporto (2026-11-16):** dopo la prova MI00 riuscita dall'ufficio e la proposta di registrare iroh come scelta di Q2 e di riscrivere R-MI-01/02: «direi ok per tutto, prendiamo per buono che gli altri casi funzionano come dovrebbero, questo dall'ufficio era il caso peggiore quindi siamo tranquilli».
- **F16 — Decisioni per l'implementazione completa (2026-11-16):** «ok procedi pure con implementare tutto, non fare step per step, fai tutto quello che manca». Scelte nel modulo della stessa sessione: lavoro nel working tree principale; quattro ambiti di permesso (Lettura sempre, Agenti, File e Git, Terminale) tutti accesi all'abbinamento, revocabili per macchina; interfaccia implementata direttamente senza anteprima (sezione «Altre istanze» nelle Impostazioni, badge della macchina nella barra, una scheda per macchina nel selettore dei progetti, chip nella barra di stato della macchina controllata); eccezioni a R-MI-06 approvate: «Apri nell'editor esterno»/«Mostra nella cartella» assenti sui progetti remoti e Browser Studio dal vivo escluso; l'aggiornamento di omp e di Studio della macchina remota **non** è un'eccezione e deve funzionare da remoto; «Nuova chat» o ripresa dallo storico da una finestra la fa seguire anche all'altra; stesso progetto = stesso `origin` normalizzato, altrimenti stesso primo commit; macchina proposta = l'ultima usata nel progetto, modificabile dal composer; spostamento a fine turno con `git bundle` (modifiche non committate comprese) e `.jsonl` con percorsi corretti.

- **F17 — Fase 2 approvata e stato condiviso (2026-11-17):** «io questo progetto omp-studio ce l'ho anche aperto sul mio pc windows ma ora come ora sono mostrati come due progetti diversi, anche se condividono lo stesso origin github». Scelte: fondere su origin git normalizzato; «di default le nuove chat partono sulla macchina fisica, ma devo poter impostare in qualche modo da gui di passare all'altra macchina. Anche sulla scrittura e salvataggio dei task devo poterlo segnare»; accettato che la fusione è di presentazione e che due working tree possono divergere, con avviso quando divergono. Segnalato anche il difetto di R-MI-18: «io ora sto interagendo su questo progetto che è sul mac dal mio pc windows, ma se guardo lo schermo del mac sulla finestra di studio questo progetto è fermo. Secondo me dovrebbe mostrare lo stesso uso, se no potrei far partire qualcosa in principale mentre in realtà ci sto lavorando da qua».

- **F18 — Correzione della macchina proposta (2026-11-17):** «sì teniamo allora macchina ultima usata, ovviamente il dubbio c'è solo su un progetto che esiste fisicamente su entrambi: su un progetto che c'è solo su una macchina partirà per forza su quella macchina». Ripristina F16 su questo punto: la macchina proposta per una chat o un task è **l'ultima usata nel progetto**, non la locale. Su un progetto presente su una sola macchina non c'è scelta: parte lì. Lo spostamento di un lavoro già avviato fra macchine resta la fase 3 (R-MI-14), fuori da questo lavoro.

- **F19 — Coda unificata, sessioni con badge, indicatore di macchina (2026-11-17):** «la coda deve unificarsi se il progetto è su più macchine, per cui ogni macchina si salva una copia della coda e quando una istanza salva un nuovo messaggio tutte le altre si aggiornano [...] su un task non si vede di che macchina è, è sempre di tutte quelle con quel progetto. Lo storico sessioni invece sì, mostra un badge [...] su un progetto che è solo su una macchina invece sia coda che sessioni sappiamo essere solo di quella macchina»; «possiamo mettere sotto il composer un piccolo indicatore che mostra su quale computer sta girando, cliccandolo si può cambiare. Questo si userà poi anche per il passaggio della sessione aperta da una macchina all'altra, in un momento dove è fermo».
  Scelte nel modulo della stessa sessione: **la coda si replica** su tutte le macchine col progetto con aggiornamento in tempo reale in entrambe le direzioni (creazione, modifica, avvio); **l'avvio lo fa una sola macchina**, quella designata per il progetto, perché l'auto-avvio locale su più copie avvierebbe lo stesso task due volte; **conflitti di modifica: vince l'ultima modifica** (per campo, con orologio); ordine di lavoro: prima l'indicatore sotto il composer, poi lo storico sessioni con badge, poi la coda.
  Nota: F19 cambia R-MI-12 come era registrato («i dati non si replicano», Q1 del 2026-11-12). La replica vale **solo per la coda dei task**, che non è codice di lavoro; worktree e file restano non sincronizzati.

- **F20 — Auto-avvio esclusivo per progetto (2026-11-17):** «l'auto avvio su un progetto condiviso da più macchine si può impostare su solo una macchina, attivarlo su una macchina lo disattiva sulle altre e fa sì che i task partano in locale su quella macchina che ce l'ha attivo».
  Scelte nel modulo della stessa sessione: **anche i task programmati** seguono la stessa regola (partono solo dove l'auto-avvio è acceso, quindi cambia il comportamento attuale per cui la programmazione li faceva partire comunque); l'auto-avvio **si può accendere da un'altra macchina** (il comando viaggia al proprietario della copia, che accende il proprio e spegne gli altri); con la macchina designata **spenta** la coda aspetta, nessuno eredita il ruolo.
  F20 sostituisce la «macchina designata» di F19: la designazione non è un'impostazione separata, **è** l'auto-avvio acceso su quella copia.

Le sei strade valutate sono illustrate in `proto/multi-istanza-strade.html` (locale, fuori da git): è materiale di discussione, non un'anteprima di interfaccia approvata. F16 autorizza l'implementazione diretta dell'interfaccia secondo le convenzioni di Studio, senza un'ulteriore approvazione su anteprima.

## Stato dei requisiti

| ID | Fase | Stato del requisito | Implementazione | Verifica |
|---|---|---|---|---|
| R-MI-01 | 1 | Sostituito il 2026-11-16 da R-MI-16 (F15) | — | — |
| R-MI-02 | 1 | Sostituito il 2026-11-16 da R-MI-17 (F15) | — | — |
| R-MI-03 | 1 | Attivo, approvato il 2026-11-12 (F1, F3) | MI07: progetti dell'altra macchina in barra con badge, chat/albero/editor/Git/terminale instradati | 2026-11-16: test di proiezione `test/remote-projects.test.ts`; scenario con due istanze reali non eseguito |
| R-MI-04 | 1 | Attivo, approvato il 2026-11-12 (F2) | MI07: sezione per macchina nel selettore, cartelle aperte con `open_project` | 2026-11-16: solo verifica di compilazione; prova con l'utente da fare |
| R-MI-05 | 1 | Attivo, approvato il 2026-11-12 (F2) | Non iniziata | — |
| R-MI-06 | 1 | Attivo, approvato il 2026-11-12 (F3) | MI01+MI06+MI07: confine IPC, catalogo e instradamento per macchina; superfici remote (chat, albero, editor, Git, terminale) e selettore progetti; restano fuori le eccezioni approvate in F16 e i passi MI08–MI11 | 2026-11-16: 258 comandi censiti, nessun import IPC diretto residuo, tipi senza errori, 1.467 smoke test e 523 test Rust passati; giro completo di parità su progetto remoto non eseguito |
| R-MI-07 | 1 | Attivo, proposta accettata il 2026-11-12 (F1, F9) | MI02–MI04: eventi, terminale e domande in attesa distribuiti a più consumatori | 2026-11-16: test Rust di ripresa, terminale condiviso e risposta unica; scenario con due finestre reali non eseguito |
| R-MI-08 | 1 | Attivo, proposta accettata il 2026-11-12 (F3, F9) | Non iniziata | — |
| R-MI-09 | 1 | Attivo; ambiti confermati il 2026-11-16 (F16) | Abbinamento, revoca e controlli per comando scritti; indicatore e copertura completa ancora da integrare | 2026-11-16: test Rust mirati di autorizzazione e confinamento delle letture; revoca su due istanze reali non provata |
| R-MI-10 | 1 | Attivo, proposta accettata il 2026-11-12 (F9) | Non iniziata | — |
| R-MI-11 | 1 | Attivo, confermato il 2026-11-12 (F11) | MI02/MI03: ripresa senza buchi né duplicati, sessione e terminale vivi senza consumatori; ripresa delle superfici dal collegamento scritta | 2026-11-16: test Rust di ripresa; scenario di rete interrotta con due istanze reali ancora da eseguire |
| R-MI-12 | 2 | Attivo, approvato il 2026-11-12 (F6, F9, F11); fase 2 avviata in F17, F19, F20 | Fatto il 2026-11-17: identità per `origin`/primo commit (`repoSlug`/`rootCommit` in `git_upstream_status`), una tessera per repository (`projectOrder.unified`), **coda replicata** fra le copie (fusione per task, vince l'ultima modifica, `queueReplication.ts` + comandi `read_queue`/`write_queue`), **storico sessioni unificato con badge** della macchina (`sessionCopies.ts`) e scelta della macchina sul task (`StudioTask.machineId`) | 2026-11-17: 12 test su identità, 9 su fusione coda, 9 su sessioni, 13 su detentore; 1537 smoke, 529 Rust, clippy `-D warnings`, `npm run check` 0 errori, `npm run build` verde, relay `tsc` pulito. Prova con due macchine reali da fare |
| R-MI-13 | 2 | Attivo, approvato il 2026-11-12 (F2, F6); macchina proposta in F18, indicatore in F19, auto-avvio esclusivo in F20 | Fatto il 2026-11-17: indicatore sotto il composer (`MachineIndicator`), auto-avvio acceso su una sola copia (`autoDispatchOwner.ts`), programmati compresi nella regola, comando `set_auto_dispatch` anche da remoto, macchina per task nel Task Editor | 2026-11-17: 13 test su proposta e cambio, 13 su detentore e accensione; verifiche come sopra. Prova con due macchine reali da fare |
| R-MI-14 | 3 | Attivo; trasferimento con bundle e JSONL confermato il 2026-11-16 (F16) | Non iniziata | — |
| R-MI-15 | 1 | Attivo, approvato il 2026-11-12 (F11, F12) | Non iniziata | — |
| R-MI-16 | 1 | Attivo, approvato il 2026-11-16 (F4, F13, F15) | MI05: endpoint iroh, chiavi persistenti, abbinamento con codice, revoca | 2026-11-16: abbinamento provato fuori dall'app (MI00); pannello su due installazioni reali non provato |
| R-MI-17 | 1 | Attivo, approvato il 2026-11-16 (F8, F13, F15) | MI05: endpoint e relay proprio configurabile con certificati di sistema | Trasporto provato fuori dall'app il 2026-11-16 (MI00): caso ufficio–casa riuscito; altri casi assunti (F15) |
| R-MI-18 | 1 | Attivo; segnalato il 2026-11-17 (F17) | Fatto il 2026-11-17: `src-tauri/src/link/activity.rs` osserva i frame del run e pubblica il riepilogo; frontend in `laneActivity.ts`, consumato da `laneAgentState` e `laneBusy` | 2026-11-17: 6 test Rust sul tracker, 9 test TS sul riepilogo, 529 test Rust e 1485 smoke verdi; scenario con due finestre reali da provare |

Nei testi che seguono **W** è la macchina da cui si guarda (nello scenario il PC Windows) e **M** quella che possiede il progetto (il Mac).

## R-MI-01 — Abbinamento con una chiave, senza account

**Fonti:** F4.
**Stato:** sostituito il 2026-11-16 da R-MI-16 (F15): il punto d'incontro è un relay ospitato dall'utente, non un servizio di terzi senza installazione.

Due istanze di Studio si abbinano una volta sola scambiandosi una chiave (codice o QR mostrato da una e inserito nell'altra). Non servono account, registrazioni né un server ospitato dall'utente. Dopo l'abbinamento le due istanze si riconoscono da sole a ogni avvio.

**Accettazione:** su due installazioni mai collegate, generare il codice su M, inserirlo su W: M compare fra le macchine di W senza creare account; dopo il riavvio di entrambe il collegamento torna da solo.
**Errore da evitare:** richiedere un accesso, un indirizzo da configurare o un relay da installare.

## R-MI-02 — Collegamento diretto, in rete locale e fra reti diverse

**Fonti:** F4, F8.
**Stato:** sostituito il 2026-11-16 da R-MI-17 (F15): stesso comportamento, con il relay proprio come unico ripiego e la verifica dei certificati di sistema.

Sulla stessa rete le due istanze si collegano senza passare da Internet. Fra reti diverse un punto d'incontro le presenta, poi i dati passano diretti; se i router non lo permettono, i dati passano da un relay che vede solo pacchetti cifrati. Il contenuto è sempre cifrato da capo a capo con le chiavi dell'abbinamento. Quando sono disponibili più vie si usa la più diretta e si torna a quella appena risponde. L'indirizzo del punto d'incontro è configurabile.

**Accettazione:** (a) stessa rete con Internet scollegato: il progetto remoto resta utilizzabile; (b) W su rete mobile e M a casa: collegamento stabilito e Studio indica se la via è diretta o di ripiego; (c) tornando sulla stessa rete il collegamento passa alla via locale senza interrompere la sessione.
**Errore da evitare:** far passare stabilmente i dati da un server quando la via diretta esiste; contenuti leggibili dal punto d'incontro.

## R-MI-03 — Progetti remoti in barra, con il badge della macchina

**Fonti:** F1, F3.

I progetti aperti su M si possono aprire nella barra dei progetti di W, accanto a quelli locali, con le stesse tessere e gli stessi segni di stato. L'unica differenza visibile è un badge con la macchina su cui il progetto gira.

**Accettazione:** con due progetti locali e due aperti su M, la barra di W ne mostra quattro; quelli di M portano il badge; lo stato (al lavoro, domanda in attesa, fermo) corrisponde a quello che si vede su M.
**Errore da evitare:** una finestra o una vista separata per le macchine remote; differenze di aspetto oltre al badge.

## R-MI-04 — Elenco completo dei progetti dell'altra macchina

**Fonti:** F2.

La finestra per aprire un progetto mostra anche i progetti di M, compresi quelli che su M non sono aperti come schede, distinti per macchina. Aprirne uno da W lo apre anche su M, perché è la macchina che lo fa girare.

**Accettazione:** un progetto noto a M ma chiuso lì compare nell'elenco di W e si apre con la sessione e lo storico corretti.

## R-MI-05 — Creare un progetto scegliendo la macchina

**Fonti:** F2.

Alla creazione o all'aggiunta di un progetto si sceglie su quale macchina vive. Per M la cartella si sceglie navigando il disco di M da W.

**Accettazione:** da W, creare un progetto su M in una cartella scelta navigando il disco di M: il progetto esiste su M e compare in barra su W con il badge.
**Errore da evitare:** aprire il dialogo cartelle di Windows per un progetto che vive sul Mac.

## R-MI-06 — Parità di funzioni

**Fonti:** F3.

Su un progetto remoto funzionano tutte le funzioni di progetto di Studio, con lo stesso aspetto e lo stesso comportamento: chat GUI e terminale sulla stessa sessione, albero dei file ed editor, Git, corsie e worktree, coda dei task con avvio e programmazione, domande e conferme, storico delle sessioni, diario e documenti di progetto, Laboratorio, anteprime e diagrammi, quote dei provider di M, impostazioni di omp di M (modelli, ruoli). Gli aggiornamenti di omp e di Studio di M devono essere comandabili da W (F16).

Restano della macchina da cui si guarda, per loro natura: finestra, tema e preferenze dell'interfaccia, Companion e presenza sul desktop, notifiche. Eccezioni approvate il 2026-11-16 (F16): «Apri nell'editor esterno» e «Mostra nella cartella» non disponibili sui progetti remoti; Browser Studio dal vivo escluso dalla parità remota. Nessun'altra eccezione è approvata: prima del rilascio ogni ulteriore esclusione richiede una conferma dedicata.

**Accettazione:** per ogni voce dell'elenco, eseguire su un progetto remoto lo stesso gesto che si fa in locale e ottenere lo stesso risultato; l'elenco delle eccezioni approvate coincide con ciò che l'app non offre da remoto.
**Errore da evitare:** una funzione che da remoto manca, è disattivata o si comporta diversamente senza essere fra le eccezioni approvate.
**Verifica 2026-11-17 (controllo del codice, nessuna prova con due macchine):** letti tutti i punti che chiamano i 162 comandi instradabili. Ora vanno alla macchina del progetto: ruoli e catalogo dei modelli della sessione (composer, `/role`, piano, prewalk, ripiego, Studio Remote), allegati, menzioni `@file`, contesto automatico del prompt, anteprime immagini/PDF, Regole, Diario, statistiche git, branch e checkout. Il pin della credenziale si legge sulla macchina della sessione. Restano aperti: **quote di M** (l'istantanea delle quote è ancora quella di questa macchina; è giusta solo se le due macchine usano lo stesso account) e **corsie e worktree** su un progetto remoto (creazione, integrazione, rimozione e `lanes_store` girano sul disco locale, senza un modello per stabilire a chi appartiene la corsia). Altri comandi locali usati con percorsi di progetto e non ancora instradati: `LaneReviewModal`, `laneLanding`, `laneLifecycle`, `processSupervisor`, `laneProfile`, `laneNaming`, `suggestions`.
**Aggiornamento 2026-11-17 (scelte dell'utente nel modulo «Corsie su progetto remoto: le gestisce la macchina che possiede il progetto»; «Quote lette dalla macchina del progetto attivo»):** le corsie di un progetto remoto si creano, adottano e archiviano con il comando di host `lane_action` (ambito File e Git) eseguito dalla macchina proprietaria; la finestra che guarda ne legge la proiezione dal riepilogo dell'host (`projectStore.remoteLanes`) e non scrive `lanes.json`. Revisione, integrazione, annullamento e rimozione instradano i comandi git alla macchina del progetto. Le quote si leggono con uno store per macchina (`quotaStoreFor`) seguendo il progetto attivo; `quotaStore` resta quello locale per scheduler e automazioni. Restano locali: elenco dei processi di corsia (`lane_processes_list`) e nome generato della corsia. Verifica: `test/remote-projects.test.ts` (proiezione, corsia scelta mantenuta, macchina irraggiungibile), smoke 1540/1540, `npm run check` 0 errori, `cargo check` verde; prova con due macchine reali da fare.

## R-MI-07 — Due finestre sullo stesso progetto

**Fonti:** F1 (il Mac è acceso con Studio aperto), F9.

Mentre W guida un progetto, la finestra di M resta aperta e utilizzabile sullo stesso progetto. Entrambe vedono lo stesso stato in tempo reale: messaggi, strumenti, todo, corsie, coda. Una domanda dell'agente compare su entrambe e la prima risposta la chiude ovunque. Ciò che parte da solo (avvio della coda, programmazioni, automazioni, integrazione delle corsie) parte una volta sola.

F16 precisa che «Nuova chat» e la ripresa dallo storico su una finestra portano anche l'altra sulla stessa conversazione della corsia. La macchina M resta l'unica autorità delle esecuzioni automatiche: W non avvia una seconda coda, programmazione o automazione.

**Accettazione:** con il progetto aperto su entrambe, un prompt inviato da W compare su M mentre arriva la risposta; una domanda risposta da M sparisce da W; un task in coda con avvio automatico parte una volta e crea un solo worktree.
**Errore da evitare:** doppie esecuzioni; una finestra che resta indietro o mostra uno stato diverso; dover chiudere il progetto su M per usarlo da W.

## R-MI-08 — File e percorsi fra sistemi diversi

**Fonti:** F3, F9.

I percorsi di un progetto remoto si mostrano e si usano secondo il sistema di M, anche quando W ha un sistema diverso. I file trascinati, scelti o incollati su W arrivano a M come contenuto. Le azioni «apri in…» e «mostra nella cartella» o agiscono in modo sensato per chi guarda o sono fra le eccezioni di R-MI-06.

**Accettazione:** da Windows su un progetto del Mac: aprire, modificare e salvare un file in una sottocartella; menzionare un file con `@`; trascinare un'immagine dal desktop di Windows nel composer e vederla usata dall'agente.
**Errore da evitare:** percorsi con i separatori sbagliati; allegati che puntano a un file che su M non esiste.

## R-MI-09 — Sicurezza e controllo dell'accesso

**Fonti:** F9.

La funzione è spenta per default su ogni macchina. Un'istanza abbinata con pieno accesso equivale a una shell sulla macchina: l'abbinamento lo dice chiaramente. Ogni macchina elenca i dispositivi abbinati e li revoca singolarmente; la revoca interrompe subito il collegamento. Mentre un'altra istanza è collegata, la macchina controllata lo mostra, e ogni azione remota entra nel registro attività con il nome del dispositivo. Ambiti confermati da F16: Lettura sempre disponibile; Agenti, File e Git, Terminale inizialmente abilitati, revocabili separatamente per macchina. Gli ambiti non costituiscono una sandbox per i programmi eseguiti da agenti o terminale.

**Accettazione:** revocare W da M mentre W ha un progetto aperto: il progetto diventa non raggiungibile su W e nessun comando successivo viene eseguito; il registro di M riporta le azioni di W.

## R-MI-10 — Versioni diverse di Studio

**Fonti:** F9.

Se le due versioni non sono compatibili le operazioni di progetto non si aprono, e Studio dice quale macchina va aggiornata. Nessun funzionamento parziale. F16 richiede l'aggiornamento di Studio di M comandato da W: i comandi necessari all'aggiornamento restano accessibili anche con versioni diverse, senza riabilitare le operazioni di progetto.

**Accettazione:** con una versione incompatibile su M, W mostra il progetto come non disponibile con l'indicazione «aggiorna Studio su M», senza errori sparsi nelle singole funzioni.

## R-MI-11 — Macchina non raggiungibile

**Fonti:** F11; ripresa automatica proposta dall'agente il 2026-11-12.

Se M si spegne o il collegamento cade, i suoi progetti restano in barra su W come non raggiungibili, con schede e bozze conservate. Al ritorno il collegamento riprende da solo e la sessione si riallinea senza perdere messaggi. Il lavoro dell'agente su M continua anche mentre W è scollegato.

**Accettazione:** interrompere la rete di W durante un turno dell'agente per due minuti: al ritorno la chat su W mostra tutto il turno, senza buchi né duplicati, e la bozza nel composer è intatta.

## R-MI-12 — Lo stesso progetto una volta sola (fase 2)

**Fonti:** F6.

Un progetto presente su entrambe le macchine compare una sola volta. Corsie e worktree, coda dei task e storico delle sessioni delle due copie si vedono insieme, ciascuno con la macchina a cui appartiene.

Modalità decisa (F9, F11): la vista si unisce interrogando entrambe le macchine; ogni corsia e ogni sessione vive su una sola macchina e i dati non si replicano. A macchina spenta la sua parte del progetto si vede come non raggiungibile; resta possibile solo registrare task in coda (R-MI-15).

**Accettazione:** con il progetto presente su W e su M: in barra compare una volta; corsie, coda e storico mostrano le voci di entrambe con la macchina di appartenenza; spegnendo M le sue voci risultano non raggiungibili e quelle di W restano utilizzabili.
**Errore da evitare:** sincronizzazione continua dei file di lavoro fra le due copie (strada scartata, F5).

## R-MI-13 — Scegliere dove parte un lavoro (fase 2)

**Fonti:** F2, F6.

In un progetto presente su più macchine, all'avvio di una chat, di un task o di una corsia si sceglie la macchina che lo esegue. Una sessione resta sulla macchina in cui è nata, salvo spostamento esplicito (R-MI-14).

**Accettazione:** nel progetto unificato, avviare un task su M e uno su W: ognuno gira sulla macchina scelta e porta il suo badge.

## R-MI-14 — Spostare l'esecuzione di un agente (fase 3)

**Fonti:** F7.

Una sessione o una corsia si sposta da una macchina all'altra con un'azione esplicita, a fine turno. Viaggiano lo storico della sessione e lo stato del codice, comprese le modifiche non committate. Non viaggiano shell aperte, job in background e schede del browser: Studio lo dice prima di spostare. Dopo lo spostamento la sessione prosegue sulla nuova macchina e l'origine può spegnersi.

**Accettazione:** da definire prima della fase 3; deve comprendere uno spostamento fra Windows e macOS con file non tracciati e la ripresa della conversazione sulla destinazione.
**Errore da evitare:** spostamento a metà turno; due macchine che scrivono la stessa sessione.

## R-MI-15 — Registrare task in coda a macchina spenta

**Fonti:** F11, F12.

Quando M non è raggiungibile, da W si possono comunque aggiungere task alla coda di un suo progetto, con testo, immagini, direttive, ruolo e modello. I task restano su W, visibili come «in attesa di M», modificabili ed eliminabili. Al ritorno di M entrano nella sua coda nell'ordine in cui sono stati scritti, una volta sola. Fino a quel momento non partono. Un task con programmazione già scaduta al momento della consegna si salva in coda e non parte da solo (F12).

**Accettazione:** con M spento, registrare da W due task su un suo progetto e modificarne uno; riaccendere M: i due task compaiono nella coda di M nell'ordine giusto, con le modifiche, senza duplicati, e su W non risultano più in attesa.
**Errore da evitare:** task persi o duplicati se il collegamento cade durante la consegna; task che partono su W invece che su M; task con programmazione scaduta che parte appena consegnato.

## R-MI-16 — Abbinamento con una chiave, relay proprio

**Fonti:** F4, F13, F15. Sostituisce R-MI-01.

Due istanze di Studio si abbinano una volta sola scambiandosi una chiave (codice o QR mostrato da una e inserito nell'altra) che porta l'identità della macchina e l'indirizzo del relay. Non servono account. Il relay è un `iroh-relay` ospitato dall'utente, con indirizzo e token configurabili in Studio; Studio non contatta relay o servizi di scoperta di terzi. Dopo l'abbinamento le due istanze si riconoscono da sole a ogni avvio.

**Accettazione:** su due installazioni mai collegate, con lo stesso relay configurato, generare il codice su M e inserirlo su W: M compare fra le macchine di W senza creare account; dopo il riavvio di entrambe il collegamento torna da solo; nessuna connessione verso servizi di n0.
**Errore da evitare:** account, relay pubblici di terzi, indirizzi da configurare oltre al relay.

**Verifiche:**

| Data | Scenario | Esito | Prova |
|---|---|---|---|
| 2026-11-17 | Primo uso reale del pannello su Windows (nightly `1.10.1-nightly.1794865373032`): salvataggio con nome macchina e relay `https://iroh-relay.myapollo.it` | Fallito: «Command link_configure not allowed by ACL». I 14 comandi `link_*` non erano in nessun permesso di `src-tauri/permissions/`; `test/acl-coverage.test.ts` non li vedeva perché scartava le voci con percorso (`link::link_configure`) invece di ridurle all'ultimo segmento, che è il nome usato da Tauri sia nella ACL sia in `invoke` | Segnalazione dell'utente; `generate_handler!` in `lib.rs` (272 voci, 258 controllate prima del fix); manifest ACL generato dopo il fix con i 14 comandi |
| 2026-11-17 | Dopo il fix: `allow-instance-link` in `app-commands.toml`, incluso nel set `studio-app` | Comandi consentiti: 272 su 272; togliendo il permesso ne mancano esattamente 14, tutti `link_*`. `node --test test/acl-coverage.test.ts` verde. `cargo check` verde, manifest ACL generato con i 14 comandi | Sessione corrente; `src-tauri/target/debug/build/omp-studio-app-*/out/acl-manifests.json` |
| 2026-11-17 | Abbinamento reale fra Windows e Mac dopo il token del relay | Riuscito: la macchina compare in elenco. Ma i progetti del Mac aperti da Windows restavano su «Caricamento sessione in corso»; il log del Mac mostrava `avvio di omp fallito rpc=N cwd=\Users\maurizio\...: No such file or directory`, cioè un percorso Windows inviato alla macchina POSIX | `~/Library/Logs/sh.omp.studio/studio.log`; `test/remote-projects.test.ts`, `test/paths.test.ts` |
| 2026-11-17 | Causa del percorso corrotto e correzione | `syncRemoteProjects` normalizzava i percorsi dello snapshot con `isWindows` di **chi guarda**: da Windows il percorso del Mac diventava `\Users\...`, `cwd` della sessione non esisteva e `attach()` restava bloccato perché `refreshState()` non si completava. Ora `isWindowsPath(snapshot.platform)` dà la semantica della macchina proprietaria; test deterministici sulle due direzioni | `npm test` 1473/1473, `npm run check` 0 errori |
| — | Conferma del fix su due istanze reali | Non ancora eseguita: serve una build con la correzione installata su Windows e Mac | — |

## R-MI-17 — Collegamento diretto quando possibile, altrimenti dal relay proprio

**Fonti:** F8, F13, F15. Sostituisce R-MI-02.

Sulla stessa rete le due istanze si collegano direttamente. Fra reti diverse passano dirette se la rete lo permette, altrimenti attraverso il relay proprio. Il contenuto è sempre cifrato da capo a capo con le chiavi delle istanze: il relay vede solo pacchetti cifrati. Quando sono disponibili più vie si usa la più diretta e si torna a quella appena risponde. Il certificato HTTPS del relay si verifica con l'archivio dei certificati del sistema, come fa il bridge di Studio Remote: le reti aziendali con ispezione HTTPS presentano certificati firmati da una CA presente solo lì. Studio indica se la via è diretta o tramite relay.

**Accettazione:** (a) stessa rete: via diretta; (b) W sulla rete dell'ufficio e M a casa: collegamento via relay; (c) cambiando rete il collegamento passa alla via migliore senza interrompere la sessione.
**Errore da evitare:** dati leggibili dal relay; collegamento che fallisce in una rete aziendale perché il certificato si verifica solo con le radici incorporate.

**Verifiche:**

| Data | Scenario | Esito | Prova |
|---|---|---|---|
| 2026-11-16 | (b) fuori dall'app, `ricerca/link-probe` con iroh 1.4.1: PC Windows in ufficio, Mac a casa, relay `iroh-relay` sul VPS | Riuscito: 531 ms, sempre via relay, ping mediano 87,5 ms, 52 Mbit/s. Con le radici incorporate di iroh falliva; riuscito con `CaTlsConfig::system()` | `docs/PLAN.md`, MI00; diario del 2026-11-16 |
| — | (a), (c) | Non provati: assunti dall'utente (F15) | — |

## R-MI-18 — La macchina controllata mostra il lavoro che arriva da fuori

**Fonti:** F17.

Mentre una finestra guida un progetto da un'altra macchina, la finestra della macchina che possiede il progetto mostra la stessa attività: la corsia non è «ferma» se l'agente sta lavorando per la sessione aperta dall'altra parte. Lo stesso vale per le altre finestre collegate. Senza questo, chi sta davanti al Mac può avviare un secondo lavoro in Principale mentre l'agente è già occupato, e la coda automatica può partire sopra un turno in corso.

**Accettazione:** con il progetto aperto su M e una chat avviata da W, la finestra di M mostra la corsia al lavoro (e poi la risposta), senza doverla ricaricare. Se su M si prova ad avviare un secondo lavoro nella stessa corsia, lo stato lo impedisce come farebbe per un lavoro locale.
**Errore da evitare:** mostrare «fermo» mentre un agente lavora; permettere due lavori nella stessa corsia perché una finestra non sa del primo.

**Diagnosi (2026-11-17, per lettura del codice).** `laneOrchestrator.laneAgentState` (`src/lib/lanes/laneOrchestrator.svelte.ts:275`) ricava lo stato da `sessionRegistry.getLaneSession(project.id, laneId)` del **frontend della finestra**. Le corsie pubblicate nello snapshot (`src/lib/remote/projection.svelte.ts:91`, `agentState: l.agentState`) e quelle mostrate dalla tessera vengono quindi dallo stato noto a quella finestra: la sessione aperta dalla macchina collegata vive nel processo del backend dell'host, non in `sessionRegistry` della finestra locale, che continua a riportare `unknown`/`idle`. Serve che le sessioni aperte tramite `link_open_rpc` risultino nel registro locale (o che lo stato delle corsie sia composto anche dal backend) prima che la finestra calcoli `laneAgentState`.

**Verifiche:**

| Data | Scenario | Esito | Prova |
|---|---|---|---|
| 2026-11-17 | Progetto del Mac aperto dal PC, chat avviata dal PC, finestra del Mac osservata | Fallito: la finestra del Mac mostra il progetto fermo mentre l'agente risponde al PC | Segnalazione dell'utente (F17); causa individuata per lettura del codice |
| 2026-11-17 | Correzione: il backend link conta le superfici remote per corsia e riconosce i confini del run dai frame che già trasporta (`agent_start` apre, `agent_end` terminale o `session_settled` chiude, `studio_exit` libera); il riepilogo arriva alla finestra con `link:activity` e una revisione che scarta i pacchetti vecchi | Verde: 6 test Rust sul tracker (conto delle superfici, yield non terminale, delta ignorati, processo uscito, corsie distinte) e 9 test TS sul riepilogo (revisione, pacchetti malformati, corsia aperta ma ferma). `cargo test` 529, smoke 1485, clippy `-D warnings` senza avvisi, `npm run check` 0 errori | `src-tauri/src/link/activity.rs`, `src/lib/backend/laneActivity.ts`, `test/lane-activity.test.ts` |
| — | Scenario con due finestre reali: la corsia del Mac deve passare a «al lavoro» mentre il PC scrive | Da fare: richiede una build con la correzione su entrambe | — |

## Strade scartate

Confermate dall'utente il 2026-11-12 (F5):

| Strada | Motivo |
|---|---|
| Collab di omp | Una stanza per sessione, solo chat, relay non ospitabile in proprio; già scartata in `IDEAS.md` e nel Gate R44 |
| omp via SSH senza Studio | Tutto ciò che non è chat andrebbe riscritto sopra SSH; richiede una porta raggiungibile |
| Sincronizzazione continua dei file | Conflitti, file a metà, sessioni rovinate da due scrittori, percorsi non portabili |

## Domande aperte

- **Q1 — Uso a macchina spenta.** Risolta il 2026-11-12 (F11): nessuna replica; il progetto si mostra non raggiungibile e si possono solo registrare task in coda (R-MI-11, R-MI-12, R-MI-15).
- **Q2 — Punto d'incontro.** Risolta il 2026-11-16 (F13, F15): iroh, con un `iroh-relay` ospitato dall'utente sul proprio server (R-MI-16, R-MI-17). Il relay Bun di Studio Remote resta per il telefono.
- **Q3 — Ambiti dei permessi** di R-MI-09. Risolta il 2026-11-16 (F16): Lettura (sempre), Agenti, File e Git, Terminale; tutti accesi all'abbinamento, modificabili e revocabili per macchina.
- **Q4 — Interfaccia** di abbinamento, elenco macchine e badge. Risolta il 2026-11-16 (F16): implementazione diretta con i componenti di Studio, senza anteprima.

---

Gli ID restano stabili. Una sostituzione conserva qui il requisito precedente, il successore e la data della conferma; una rimozione conserva motivazione e conferma dedicata dell'utente. Il piano operativo e le note di rilascio che toccano questi comportamenti devono indicare gli ID interessati. Le regole comuni sono in [AGENTS.md](../../AGENTS.md), sezione «Requisiti delle funzioni e tracciabilità».
