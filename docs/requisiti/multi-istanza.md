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

- **F21 — Provenienza e azioni su barra e popover (2026-11-17):** revisione in anteprima (`proto/multi-istanza-topbar-popover.html`, `proto/multi-istanza-tessera-alternative.html`, `proto/multi-istanza-glifi.html`, locali). Sul badge della tessera: «così com'è non mi piace assolutamente né con la sigla né il badge. Perché per i nomi troppo lunghi va con i puntini [...] E anche per quelli che hanno più [...] computer». Fra sei alternative: «mi piace l'idea del A, glifo nudo», con icone disegnate per Studio invece di quelle di libreria («lo schermo [...] potrebbe essere confuso come per dire gira su questo computer»; i due fogli «sembra un tasto di copia»). Scelta: «per il punto uno la c, per il punto due la b, per il punto tre la a», con ambra più chiara sul tema chiaro e onde che partono dall'angolo dello schermo; conferma: «Perfetto così». Sulle domande della stessa discussione: chiudere e solo nascondere dalla finestra «entrambe le opzioni»; la macchina controllata «basta il chip nella barra di stato»; il selettore come «un'unica lista con un calderone dei progetti di tutte le macchine, con indicazioni e filtri»; la divergenza delle copie avvisata nel popover e «anche nella gui», perché «è abbastanza grave».

- **F22 — Anteprima e pannello del progetto (2026-11-17):** sulla prima proposta (`proto/multi-istanza-popover.html`): nell'anteprima «non mi piace che mi faccia solo vedere su due macchine in uso MacBook di Maurizio [...] sarebbe utile vedere su che macchina è in giro come prima cosa, e poi dire disponibile anche su»; nel pannello «c'è troppo testo con il percorso completo, i pulsanti non sono capibili». Fra tre alternative per ciascuno (`proto/multi-istanza-pannello.html`): «per l'anteprima l'opzione B con la macchina in testa, e invece per il pannello completo l'opzione C sotto vista».

- **F23 — Avviso, selettore, nascondi e chiudi (2026-11-17):** fra tre alternative per ciascun punto (`proto/multi-istanza-avviso-selettore.html`): «Per l'avviso, farei l'opzione B, la striscia sopra il composer. Per il selettore progetti, però, farei l'opzione C. Per nascondere il progetto, invece farei l'opzione A.»

- **F24 — Tessera unica anche per tastiera e stato (2026-11-18):** «su un progetto multi-istanza il ctrl tab non fa passare al prossimo progetto ma scorre da una macchina all'altra [...] il ctrl+tab dovrebbe contarli una sola volta. Possiamo valutare piuttosto una scorciatoia rapida per passare da una macchina all'altra»; «c'era il lavoro da rispondere su questo progetto sul macbook ma aprendo la tab da windows mi mostrava la sessione vuota sul pc windows invece di prendermi questa del mac». Scelte nel modulo della stessa sessione: `Ctrl+Alt+↑/↓` per le macchine, saltando quelle spente; la tessera apre prima la copia che aspetta una risposta; lo stato della tessera unisce tutte le copie (R-MI-24, R-MI-25, TPR-040).

- **F25 — Copie sincronizzate via git (2026-11-18):** «secondo me è meglio avere il sync con git, perché tipo adesso sto facendo un lavoro dal pc windows sul mac, ora mi dice che le copie divergono ma appunto, devono syncarsi. Secondo me dovremmo fare che un progetto ha copie che divergono solo nel momento in cui su una macchina si fa una modifica in esterno o offline o solo in locale per cui non c'è modo di aggiornare git e ottenere la stessa versione su tutte le macchine». Scelte nel modulo della stessa sessione: i commit viaggiano **direttamente fra le macchine** sul collegamento, senza passare da GitHub; le modifiche non committate si spostano **solo al cambio di macchina** con «Porta qui le modifiche»; la copia indietro si aggiorna **solo con fast-forward, pulita e senza agente al lavoro**, altrimenti resta «da aggiornare»; nuova regola di divergenza (sotto R-MI-22); **nessun push automatico** su origin; requisiti e piano prima del codice (R-MI-26, R-MI-27, R-MI-28; risolve Q6, sostituisce la regola Q5).

- **F26 — Casi limite (2026-11-20):** dopo il piano dei casi limite proposto nella sessione: «Direi che come ordine va bene. Saltiamo pure il punto di test»; sulla sospensione: «il Mac voglio che resti sveglio sempre, ma in teoria resta sveglio sempre già di suo»; «le notifiche. Va bene la macchina usata per ultima»; «fork senza origin. Va bene a chiedere conferma»; «maiuscole nei branch, le segnali come divergenza»; «tieni tutto fermo senza commit, facciamo poi un'unica build finale». Decisioni registrate: niente intervento di Studio sulla sospensione (il Mac resta sveglio per impostazione del sistema); test di integrazione con due istanze simulate esclusi da questo lavoro.

- **F27 — Esecuzione su un'altra macchina e build Nightly distribuita (2026-11-21):** sulla build distribuita proposta nell'esplorazione del 2026-11-20: «non basterebbe avere che la build quando la lancio sul Mac, vede se c'è un computer Windows collegato, lancia la build anche sul computer Windows dello stesso commit, e poi si riprende il file una volta che ha finito. Così comunque l'invio [su GitHub] lo fa solo uno dei due [...] il flusso è solo il Mac che dice al computer Windows di eseguire un comando e aspetta. Il Mac aspetta e legge il risultato e si prende il file»; sul canale della domanda: «ovviamente deve essere una funzione esclusiva di studio [...] Questa cosa di fare la build su entrambe le macchine è una specifica interpretazione della funzione di esecuzione di codice da una macchina all'altra». Scelte nei moduli della stessa sessione: prima la primitiva «Esegui su macchina», la build ne è il primo uso; se l'altra macchina manca all'avvio Studio chiede con un proprio dialogo (attendi senza limite, cloud, solo la mia piattaforma), se la sua build fallisce a metà ripiego sul cloud; Linux sempre in cloud; log dell'altra macchina sia nell'output dello script sia in un pannello di Studio; basta l'ambito Terminale, senza conferma per comando; esecuzione in una cartella di lavoro dedicata al commit, una per progetto e riusata; lanciano script avviati da Studio e agenti (non l'utente dall'interfaccia né i task della coda); artefatti dichiarati da chi lancia; annullamento propagato; un job alla volta per progetto; Studio impedisce la sospensione della macchina finché un job remoto è in corso (deroga limitata alla decisione di F26).

- **F28 — Aggiornare l'altra macchina con un clic (2026-11-21):** completamento di R-MI-10 discusso dopo F27. Scelte nel modulo della stessa sessione: l'altra macchina si aggiorna alla stessa versione di chi lancia, se pubblicata, altrimenti all'ultima del canale di chi lancia, dicendolo prima; se lì c'è lavoro in corso scarica subito e installa e riavvia appena è libera; la proposta compare sulla tessera e nel pannello del progetto, nelle Impostazioni accanto alla macchina e a fine Nightly distribuita come «Aggiorna entrambe»; nessun aggiornamento automatico delle altre macchine.

- **F29 — Spostamento dell'agente, scelte aperte di R-MI-14 (2026-11-21):** scelte nel modulo della stessa sessione: la storia della sessione resta intatta e alla ripresa l'agente riceve una nota con la nuova radice del progetto e il sistema operativo; se il modello della sessione manca sulla destinazione Studio lo dice prima e propone il modello del ruolo predefinito di lì, con possibilità di annullare; la sessione di partenza resta nello storico in sola lettura con il rimando alla macchina di arrivo; lo spostamento si comanda dall'indicatore sotto il composer e da `Ctrl+Alt+↑/↓` su una sessione ferma, non da un tool dell'agente; si spostano anche le sessioni di una corsia.

- **F30 — Registro, anteprima, corsie, impostazioni di omp, chiave, decisioni condivise e ordine (2026-11-21):** dopo lo smistamento dei punti rimasti, tutti tenuti. Scelte nei moduli della stessa sessione: il registro delle azioni remote raccoglie ciò che cambia qualcosa o esegue, non le letture, si consulta in Impostazioni › Altre istanze anche da un'altra macchina, dura 30 giorni; l'anteprima del server di sviluppo si apre dai link `localhost:PORTA` e da «Apri porta…», nel Browser di Studio o in quello di sistema, con l'ambito Terminale; la corsia parte di base sulla macchina della sessione che la apre ma se ne può indicare un'altra, l'integrazione gira sulla macchina della corsia, le corsie di tutte le macchine stanno in un'unica barra; le impostazioni di omp (ruoli, agenti, skill, regole, server MCP senza token) si sincronizzano per file, vince l'ultima modifica, chiedendo se cambiate su entrambe, spente di base e accese per macchina e categoria; sui ruoli: «dobbiamo però ipotizzare di poter dire "ok questo ruolo lasciami modello X sul mac e modello Y sul pc"»; chiave sparita dal portachiavi con uscita guidata; decisioni «unisci / non unire» condivise fra le macchine, vince la più recente. Ordine di lavoro: registro, «Esegui su macchina», build distribuita, aggiornamento con un clic, chiave e decisioni condivise, anteprima, corsie, spostamento dell'agente, impostazioni di omp.

- **F31 — Gestione del progetto multi-istanza rivista (2026-11-23):** «ogni volta che apro studio su windows mi mostra i due progetti separati nella topbar invece che uniti, devo cliccare su uno per aggiornarlo»; «molte volte quando fa la build nightly poi aggiorna il diario e non committa quindi finisco con una modifica e mi dice che le copie divergono e non riesce a fare l'auto sync»; «Mancano poi feedback da sistema per quando sono su un progetto multi istanza per lo stato in tempo reale delle altre macchine, di eventuali sync in corso»; «C'è anche da ridisegnare da zero la schermata in impostazioni [...] collegare una macchina è difficile e scomodo e gestire le connessioni è brutto, in più ci sono due sezioni diverse per remote e per la multi istanza». Scelte nel modulo della stessa sessione: diario committato da chi lo scrive, avanzamento tollerante dei file sporchi non toccati, unione automatica del solo diario (cambia R-MI-27); chip «Macchine» nella barra di stato, sincronizzazione animata sul glifo con «sincronizzata N min fa», avvisi sugli eventi; una sola sezione «Dispositivi» con dettaglio per dispositivo e «Aggiungi dispositivo»; codice che porta relay e token, scoperta in rete locale con 6 cifre di conferma, codice corto fra reti diverse depositato sul relay di Studio Remote, codice del telefono generabile dal desktop; un solo «Server di collegamento» con gli indirizzi separati in «Avanzate»; implementazione diretta senza anteprima.

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
| R-MI-09 | 1 | Attivo; ambiti confermati il 2026-11-16 (F16) | Abbinamento, revoca e controlli per comando scritti; 2026-11-20: confinamento dei percorsi per i peer senza Agenti né Terminale, su ogni comando (prima solo con tutti gli ambiti spenti); azioni host sulla coda confinate alle radici, `projectId` verificati; istantanee WIP leggibili solo con File e Git; indicatore e copertura completa ancora da integrare | 2026-11-16: test Rust mirati di autorizzazione e confinamento delle letture; 2026-11-20: vedi «Correzioni del 2026-11-20»; revoca su due istanze reali non provata |
| R-MI-10 | 1 | Attivo, proposta accettata il 2026-11-12 (F9); precisato da R-MI-38 | Compatibilità sulla versione stabile di base, snapshot ridotto per versioni incompatibili, indicazione e aggiornamento comandato tramite R-MI-38 | 2026-11-20: test Rust su compatibilità e snapshot ridotto; accettazione dell'aggiornamento non eseguita |
| R-MI-11 | 1 | Attivo, confermato il 2026-11-12 (F11) | MI02/MI03: ripresa senza buchi né duplicati, sessione e terminale vivi senza consumatori; ripresa delle superfici dal collegamento scritta | 2026-11-16: test Rust di ripresa; scenario di rete interrotta con due istanze reali ancora da eseguire |
| R-MI-12 | 2 | Attivo, approvato il 2026-11-12 (F6, F9, F11); fase 2 avviata in F17, F19, F20 | Fatto il 2026-11-17: identità per `origin`/primo commit (`repoSlug`/`rootCommit` in `git_upstream_status`), una tessera per repository (`projectOrder.unified`), **coda replicata** fra le copie (fusione per task, vince l'ultima modifica, `queueReplication.ts` + comandi `read_queue`/`write_queue`), **storico sessioni unificato con badge** della macchina (`sessionCopies.ts`) e scelta della macchina sul task (`StudioTask.machineId`) | 2026-11-17: 12 test su identità, 9 su fusione coda, 9 su sessioni, 13 su detentore; 1537 smoke, 529 Rust, clippy `-D warnings`, `npm run check` 0 errori, `npm run build` verde, relay `tsc` pulito. Prova con due macchine reali da fare |
| R-MI-13 | 2 | Attivo, approvato il 2026-11-12 (F2, F6); macchina proposta in F18, indicatore in F19, auto-avvio esclusivo in F20 | Fatto il 2026-11-17: indicatore sotto il composer (`MachineIndicator`), auto-avvio acceso su una sola copia (`autoDispatchOwner.ts`), programmati compresi nella regola, comando `set_auto_dispatch` anche da remoto, macchina per task nel Task Editor | 2026-11-17: 13 test su proposta e cambio, 13 su detentore e accensione; verifiche come sopra. Prova con due macchine reali da fare |
| R-MI-14 | 3 | Attivo; trasferimento con bundle e JSONL confermato il 2026-11-16 (F16); scelte aperte e accettazione precisate il 2026-11-21 (F29) | Trasferimento attraverso `session_move.rs`, WIP Git e scelta «Continua su»; storico in sola lettura, con ripresa dalla destinazione | Accettazione non eseguita |
| R-MI-15 | 1 | Attivo, approvato il 2026-11-12 (F11, F12) | 2026-11-20: specchio della coda dei progetti remoti (`remoteQueue.ts`, `taskStore.applyHostQueues`): segue il riepilogo dell'host, le modifiche fatte qui partono con `write_queue` e restano «in attesa di …» (salvate fra i riavvii) finché l'host non le pubblica; orario già passato alla consegna → `missed` (F12); tessere ricostruite dall'ultimo riepilogo salvato (`remoteHostCache.ts`) quando l'altra macchina è spenta al riavvio. Corretto anche il difetto per cui la finestra leggeva e scriveva la coda remota sul proprio disco | 2026-11-20: 7 test in `test/remote-queue.test.ts`; scenario con due macchine reali da provare |
| R-MI-16 | 1 | Attivo, approvato il 2026-11-16 (F4, F13, F15) | MI05: endpoint iroh, chiavi persistenti, abbinamento con codice, revoca | 2026-11-16: abbinamento provato fuori dall'app (MI00); pannello su due installazioni reali non provato |
| R-MI-17 | 1 | Attivo, approvato il 2026-11-16 (F8, F13, F15) | MI05: endpoint e relay proprio configurabile con certificati di sistema | Trasporto provato fuori dall'app il 2026-11-16 (MI00): caso ufficio–casa riuscito; altri casi assunti (F15) |
| R-MI-18 | 1 | Attivo; segnalato il 2026-11-17 (F17) | Fatto il 2026-11-17: `src-tauri/src/link/activity.rs` osserva i frame del run e pubblica il riepilogo; frontend in `laneActivity.ts`, consumato da `laneAgentState` e `laneBusy` | 2026-11-17: 6 test Rust sul tracker, 9 test TS sul riepilogo, 529 test Rust e 1485 smoke verdi; scenario con due finestre reali da provare |
| R-MI-19 | 1–2 | Attivo, approvato il 2026-11-17 (F21) | Fatto il 2026-11-17: `src/lib/ui/MachineGlyph.svelte`, tessera in `TopBar.svelte` (glifo, etichetta accessibile), rappresentante stabile in `projectOrder.unified`, token `--warn-glyph` (`app.css`, `theme.ts`) | 2026-11-17: `npm run check` 0 errori, 1554 smoke, build verde; glifi verificati in anteprima su tema scuro e chiaro; resa nell'app con due macchine reali da provare |
| R-MI-20 | 1–2 | Attivo, approvato il 2026-11-17 (F21, F23) | Fatto il 2026-11-17: «Nascondi da questa finestra» (`projectStore.hideRemote`, persistito come `hiddenRemoteProjects`) e vista «Chiudi progetto…» nel popover; comando `close_project` (ambito Agenti) verso la macchina che possiede la copia | 2026-11-17: tipi, smoke, `cargo check`, test Rust `link::`, relay `tsc`; scenario con due macchine reali da provare |
| R-MI-21 | 1 | Attivo, approvato il 2026-11-17 (F21, F23) | Fatto il 2026-11-17: `ProjectPicker.svelte` in tre gruppi con filtri per macchina; unione per repository in `pickerEntries.ts` (le cartelle remote portano `repo`) | 2026-11-17: 5 test in `test/picker-entries.test.ts`; elenco con due macchine reali da provare |
| R-MI-22 | 2 | Attivo; interfaccia approvata il 2026-11-17 (F23); regola sostituita il 2026-11-18 (F25, al posto di Q5) | Fatto il 2026-11-17: striscia `CopyDivergenceStrip.svelte` sopra il composer, dettaglio nella vista Macchine. 2026-11-18: nuova regola in `projectCopies.ts` (commit propri su entrambe da `copySync.svelte.ts`, modifiche su almeno due copie). Limite: i commit si confrontano solo dalla finestra che ha una copia locale del progetto | 2026-11-18: 6 test della regola in `test/project-copies.test.ts`; scenario con due copie reali da provare |
| R-MI-23 | 1–2 | Attivo, approvato il 2026-11-17 (F22) | Fatto il 2026-11-17: anteprima con la macchina in testa e «Anche su», riga e vista «Macchine» in `ProjectPopover.svelte`, stato condiviso in `projectMachines.svelte.ts`; l'auto-avvio delle copie remote ora arriva dal riepilogo dell'host | 2026-11-17: tipi, smoke e build verdi; prova con due macchine reali da fare |
| R-MI-24 | 2 | Attivo, approvato il 2026-11-18 (F24) | 2026-11-18: `tileCopy` in `projectCopies.ts`, stato unito in `projectActivity.ts`, `projectOrder.unified` | Scenario con due macchine reali da provare |
| R-MI-25 | 2 | Attivo, approvato il 2026-11-18 (F24) | 2026-11-18: `Ctrl+Alt+↑/↓` in `+page.svelte` sulle copie di `provenance()` | Scenario con due macchine reali da provare |
| R-MI-26 | 2 | Attivo, approvato il 2026-11-18 (F25) | Fatto il 2026-11-18 (MI21): `copy_sync_heads`/`copy_sync_bundle` (sola lettura, sull'altra macchina) e `copy_sync` in `src-tauri/src/github/copies.rs`; richiesta da Rust a Rust con `link::call_peer`; riferimenti `refs/studio/<macchina>/heads/*`; giri da `copySync.svelte.ts` al cambio delle cime e ogni minuto | 2026-11-18: 10 test Rust con due repository senza origin (`github::copies`); scenario con due macchine reali da provare |
| R-MI-27 | 2 | Attivo, approvato il 2026-11-18 (F25) | Fatto il 2026-11-18 (MI22): solo fast-forward in `advance`, cartelle occupate (agente al lavoro o in attesa anche da remoto, file non salvati, automazioni) passate dalla finestra proprietaria; «da aggiornare» nel glifo (punto sopra le frecce), nell'etichetta accessibile e nella vista Macchine | 2026-11-18: test Rust su cartella pulita/sporca/occupata, branch non in uso e worktree di corsia; scenario con agente al lavoro da provare |
| R-MI-28 | 2 | Attivo, approvato il 2026-11-18 (F25) | Fatto il 2026-11-18 (MI23): `copy_wip_snapshot`/`copy_wip_receive`/`copy_wip_finish`, orchestrazione in `copyMove.ts`, proposta in `switchCopy` (`+page.svelte`) dall'indicatore sotto il composer e da `Ctrl+Alt+↑/↓`; 2026-11-20: pulizia della partenza dall'istantanea, senza stash | 2026-11-18: test Rust su modifiche, file nuovi, cancellazioni, partenza cambiata e arrivo non allineato; scenario con due macchine da provare |
| R-MI-29 | 1 | Attivo, approvato il 2026-11-20 (F26) | 2026-11-21: `lastSeen` per macchina in `link/config.rs` (compatibile con i file precedenti), aggiornato all'hello e col battito; Impostazioni con «vista l'ultima volta», evidenza oltre 30 giorni e proposta di sostituzione per stesso nome dopo un nuovo abbinamento | 2026-11-21: test Rust di persistenza e compatibilità; scenario di reinstallazione reale da provare |
| R-MI-30 | 1 | Attivo, approvato il 2026-11-20 (F26) | 2026-11-21: `GET /ping` del relay con i certificati di sistema (`link/relay.rs`, endpoint verificato nel sorgente di iroh-relay 1.4.1), `relayReachable` nello stato, `offlineReason()`; etichetta «relay non raggiungibile da qui» in Impostazioni e nel pannello del progetto | 2026-11-21: `cargo test` e clippy verdi; prova con relay spento da fare |
| R-MI-31 | 1–2 | Attivo, approvato il 2026-11-20 (F26) | 2026-11-20: comando `system_idle_seconds` (macOS CoreGraphics, Windows `GetLastInputInfo`), decisione pura in `notificationPresence.ts`, applicata a notifiche di attenzione, heads-up, aggiornamenti Git e lampeggio dell'icona | 2026-11-20: 4 test in `test/notification-presence.test.ts`; scenario con due macchine reali da provare |
| R-MI-32 | 2 | Attivo, approvato il 2026-11-20 (F26); precisato da R-MI-44 | Copie senza origin unite solo per conferma; decisioni condivise in R-MI-44. La rinomina GitHub non separa le copie e si può aggiornare l'origin dal pannello del progetto | 2026-11-21: test TS su conferma e rinomina, test Rust su formato dell'indirizzo e slug; prova reale con rinomina su GitHub da fare |
| R-MI-33 | 2 | Attivo, approvato il 2026-11-20 (F26) | 2026-11-21: pacchetti aperti sull'host e letti a pezzi da 16 MB con verifica di dimensione e SHA-256 (`copy_*_bundle_chunk`), tetto di sicurezza 2 GiB, scrittura su disco man mano; stima `copy_wip_estimate` mostrata nella domanda di «Porta qui le modifiche»; disco pieno riconosciuto nei messaggi | 2026-11-21: test Rust (commit oltre un pezzo, pacchetto danneggiato, permesso WIP, stima); prova reale con un file grande fra le due macchine da fare |
| R-MI-34 | 1 | Attivo, approvato il 2026-11-20 (F26); precisato da R-MI-43 | Chiave nel portachiavi con migrazione verificata, ripiego su Linux, revoca propagata; uscita guidata quando manca la chiave in R-MI-43 | 2026-11-21: test Rust con portachiavi finto e regola della revoca; accettazione Keychain e Credential Manager non eseguita |
| R-MI-35 | 2 | Attivo, approvato il 2026-11-20 (F26) | 2026-11-21: `case_conflicts` in `copies.rs`: nomi che differiscono solo per maiuscole non si scaricano né si tracciano e tornano come `caseConflict`; divergenza `case` con la riga che nomina le due branch | 2026-11-21: test Rust con `Feature`/`feature`, test TS sulla regola di divergenza |
| R-MI-36 | 3 | Attivo, approvato il 2026-11-21 (F27) | Bridge `macchina_*`, worktree riusato a commit esatto, stato, log, annullamento e artefatti | Accettazione non eseguita |
| R-MI-37 | 3 | Attivo, approvato il 2026-11-21 (F27); dipende da R-MI-36 | Verifica della macchina candidata, coordinatore e worker con stesso commit e `build_id`, manifest unico, ripiego cloud; `--no-remote` per la prima Nightly | Accettazione non eseguita |
| R-MI-38 | 1 | Attivo, approvato il 2026-11-21 (F28); precisa R-MI-10 | Aggiornamento comandato, risoluzione sulla macchina di arrivo da GitHub, attesa di macchina libera | Accettazione non eseguita |
| R-MI-39 | 1 | Attivo, approvato il 2026-11-21 (F30); precisa R-MI-09 | Registro JSONL delle azioni remote, filtro per progetto, consultazione locale e remota, scadenza a 30 giorni | Accettazione non eseguita |
| R-MI-40 | 1 | Attivo, approvato il 2026-11-21 (F30); supera per questo caso l'esclusione del Browser di Studio di F16 | Inoltro loopback con ambito Terminale; apertura da link o porta manuale, in una finestra Studio isolata o nel browser di sistema | Accettazione non eseguita |
| R-MI-41 | 2 | Attivo, approvato il 2026-11-21 (F30) | Scelta della macchina nel menu delle corsie e in `corsia_avvia`; barra condivisa e integrazione gestita dall'host della corsia | Accettazione non eseguita |
| R-MI-42 | 2 | Attivo, approvato il 2026-11-21 (F30) | Opt-in per macchina e categoria, confronto per file e scelta in caso di conflitto, eccezioni locali per i ruoli, proiezione MCP senza `env` e `headers` | Accettazione non eseguita |
| R-MI-43 | 1 | Attivo, approvato il 2026-11-21 (F30); precisa R-MI-34 | Recupero guidato; la chiave viene ricontrollata prima di sostituire l'identità | Accettazione non eseguita |
| R-MI-44 | 2 | Attivo, approvato il 2026-11-21 (F30); precisa R-MI-32 | Decisioni per coppia replicate con lo snapshot e modificabili dal pannello; rifiuti rispettati anche fra più fork | Accettazione non eseguita |
| R-MI-45 | 2 | Attivo, segnalato il 2026-11-23 (F31); precisa R-MI-12 e R-MI-24 | 2026-11-24: identità nello snapshot desktop (`projection.svelte.ts`) e nel record salvato (`Project.identity`), `knownIdentityOf`, `upstreamFor(macchina, percorso)`, chiave `identityCacheKey`; giro d'avvio di `TopBar.svelte` che non si annulla e mette prima le copie senza identità | 2026-11-24: 6 test in `test/project-identity-startup.test.ts` (unione senza git, stesso percorso su due macchine, identità salvata); prova al riavvio su Windows da fare |
| R-MI-46 | 2 | Attivo, approvato il 2026-11-23 (F31) | 2026-11-24: `commitDocsFiles`/`commitDiary` in `extensions/studio-docs.ts` (`commit --only` sui soli percorsi scritti, salti con motivo nel risultato del tool, hook non saltati) | 2026-11-24: test in `test/studio-docs.test.ts` (file estraneo in stage resta fuori, HEAD staccato, merge in corso, fuori da git, cambio di archivio) |
| R-MI-47 | 2 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-27 | 2026-11-24: `move_branch`/`advance_with_snapshot`/`rollback_advance` in `copies.rs`; fusione anticipata con `git merge-tree --write-tree`, nessuna modifica se confligge | 2026-11-24: test Rust `github::copies` (file non toccato, riapplicazione pulita, conflitto con HEAD e file invariati, corsia) |
| R-MI-48 | 2 | Attivo, approvato il 2026-11-23 (F31); eccezione a R-MI-27 | 2026-11-24: `merge_journal_branch`/`journal_union_commit` in `copies.rs` (`merge-file --union`, genitori fissi, id macchina minore da `link::local_machine_id`), stato `mergedJournal`, attesa `journalPeer` | 2026-11-24: test Rust (unione dal minore, attesa e fast-forward del maggiore, divergenza con `src/`, nessun file fuori dal diario); prova su due macchine da fare |
| R-MI-49 | 1–2 | Attivo, approvato il 2026-11-23 (F31) | 2026-11-24: chip in `StatusBarChips.svelte`, `machines/MachinesPopover.svelte`, regole in `machineStatus.ts`, stato del giro in `copySync.svelte.ts`; chip della macchina verso `openDevice` | 2026-11-24: `test/machine-status.test.ts`; resa con macchine reali da provare |
| R-MI-50 | 2 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-19 e R-MI-23 | 2026-11-24: prop `syncing` di `MachineGlyph.svelte` (ferma con movimento ridotto), testo nell'anteprima di `ProjectPopover.svelte` | Da provare nell'app |
| R-MI-51 | 1–2 | Attivo, approvato il 2026-11-23 (F31) | 2026-11-24: `machineAlerts.ts` (deduplica pura), `machineAlertFeed.svelte.ts`, superficie toast esistente in `+page.svelte` | 2026-11-24: `test/machine-alerts.test.ts`; prova reale da fare |
| R-MI-52 | 1 | Attivo, approvato il 2026-11-23 (F31); sposta R-MI-29, R-MI-30, R-MI-38, R-MI-39, R-MI-42, R-MI-43 nella nuova sezione | 2026-11-24: `settings/devices/` (sezione, questo computer, dettaglio computer e telefono, aggiunta guidata, richiesta in arrivo, chiave mancante); `devices_set_name`; tolte `RemoteSection`/`InstancesSection` | 2026-11-24: tipi verdi; resa da provare nell'app |
| R-MI-53 | 1 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-16 | 2026-11-24: `PairingCode.relayToken`, adozione del relay in `link_pair`, errore `relay_mismatch` e `adoptRelay` | 2026-11-24: test Rust `link::` (adozione del relay); installazione nuova da provare |
| R-MI-54 | 1 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-16 | 2026-11-24: `link/discovery.rs` con `iroh-mdns-address-lookup`, ALPN `omp-studio/pair/1`, SAS `SHA-256(id minore‖id maggiore‖nonce) mod 10^6`; annuncio solo fra `link_discovery_start` e `stop` | 2026-11-24: test Rust (SAS uguale/diverso, rifiuto senza peer scritto); due macchine in LAN da provare |
| R-MI-55 | 1 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-16 | 2026-11-24: `link/depot.rs` (8 caratteri Crockford, Argon2id + AES-256-GCM), relay `POST /v1/host/mailbox` e `GET /v1/mailbox/:id` con ritiro unico, TTL 10 min, limite per indirizzo | 2026-11-24: test Rust (codice sbagliato) e `relay/test/pairing.test.ts`; relay distribuito su `studio.myapollo.it`: deposito con la credenziale del Mac, primo ritiro 200, secondo 404. Abbinamento fra due macchine da provare |
| R-MI-56 | 1 | Attivo, approvato il 2026-11-23 (F31); precisa R-MI-16 e R-MI-17 | 2026-11-24: `devices_set_server`, `GET /v1/host/info` dal relay con `RELAY_IROH_RELAY_URL` | 2026-11-24: test del relay; relay distribuito con `RELAY_IROH_RELAY_URL=https://iroh-relay.myapollo.it`: `GET /v1/host/info` con la credenziale del Mac restituisce l'indirizzo, senza credenziale 401 |

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
**Forma del badge:** precisata il 2026-11-17 da R-MI-19 (F21): un glifo senza testo al posto del badge con il nome.
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

**Precisazioni del 2026-11-21 (F29):** il JSONL non si riscrive; alla ripresa l'agente riceve un messaggio di sistema con la nuova radice del progetto e il sistema operativo («i percorsi sotto X ora sono sotto Y»). Se il modello della sessione non esiste sulla destinazione, Studio lo dice prima di spostare e propone il modello del ruolo predefinito della destinazione; si può annullare. La sessione di partenza resta nello storico in sola lettura, con il badge della macchina e il rimando «continua su M». Lo spostamento si comanda dall'indicatore della macchina sotto il composer e con `Ctrl+Alt+↑/↓` su una sessione ferma, che propone «Continua su M» invece di aprire una sessione vuota; nessun tool per l'agente. Le sessioni di una corsia si spostano anch'esse: branch con R-MI-26, modifiche con R-MI-28, worktree ricreato sulla destinazione.

**Accettazione:** dal PC Windows una sessione ferma con file non tracciati si sposta sul Mac; sul Mac la conversazione riprende con i file presenti e l'agente usa i percorsi del Mac; sul PC la sessione resta leggibile ma non scrivibile; con un modello assente sul Mac la proposta compare prima dello spostamento; la stessa prova vale per una corsia.
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

**Precisazione 2026-11-23:** «quando ho aperto un progetto e provo a far partire un task dalla coda anche se il progetto in realtà è in attesa mi dice che è in esecuzione». L'avvio esplicito non scambia una vista remota inattiva per lavoro in corso; un run effettivo resta protetto. L'auto-avvio conserva la riserva della vista remota.

**Diagnosi (2026-11-17, per lettura del codice).** `laneOrchestrator.laneAgentState` (`src/lib/lanes/laneOrchestrator.svelte.ts:275`) ricava lo stato da `sessionRegistry.getLaneSession(project.id, laneId)` del **frontend della finestra**. Le corsie pubblicate nello snapshot (`src/lib/remote/projection.svelte.ts:91`, `agentState: l.agentState`) e quelle mostrate dalla tessera vengono quindi dallo stato noto a quella finestra: la sessione aperta dalla macchina collegata vive nel processo del backend dell'host, non in `sessionRegistry` della finestra locale, che continua a riportare `unknown`/`idle`. Serve che le sessioni aperte tramite `link_open_rpc` risultino nel registro locale (o che lo stato delle corsie sia composto anche dal backend) prima che la finestra calcoli `laneAgentState`.

**Verifiche:**

| Data | Scenario | Esito | Prova |
|---|---|---|---|
| 2026-11-17 | Progetto del Mac aperto dal PC, chat avviata dal PC, finestra del Mac osservata | Fallito: la finestra del Mac mostra il progetto fermo mentre l'agente risponde al PC | Segnalazione dell'utente (F17); causa individuata per lettura del codice |
| 2026-11-17 | Correzione: il backend link conta le superfici remote per corsia e riconosce i confini del run dai frame che già trasporta (`agent_start` apre, `agent_end` terminale o `session_settled` chiude, `studio_exit` libera); il riepilogo arriva alla finestra con `link:activity` e una revisione che scarta i pacchetti vecchi | Verde: 6 test Rust sul tracker (conto delle superfici, yield non terminale, delta ignorati, processo uscito, corsie distinte) e 9 test TS sul riepilogo (revisione, pacchetti malformati, corsia aperta ma ferma). `cargo test` 529, smoke 1485, clippy `-D warnings` senza avvisi, `npm run check` 0 errori | `src-tauri/src/link/activity.rs`, `src/lib/backend/laneActivity.ts`, `test/lane-activity.test.ts` |
| — | Scenario con due finestre reali: la corsia del Mac deve passare a «al lavoro» mentre il PC scrive | Da fare: richiede una build con la correzione su entrambe | — |

## R-MI-19 — Provenienza sulla tessera con un glifo senza testo

**Fonti:** F21. Precisa la forma del badge di R-MI-03 e il segno delle copie di R-MI-12.

La tessera di un progetto non porta più un riquadro con il nome della macchina: dopo la sigla compare un glifo disegnato per Studio, alto quanto il testo, in `--ink-faint` (`--ink-muted` sulla tessera attiva). Il nome delle macchine si legge al passaggio del mouse, nel pannello del progetto e nell'etichetta accessibile della tessera.

- **Solo su questa macchina:** nessun glifo.
- **Solo su un'altra macchina:** schermo con due onde che partono dall'angolo in alto a destra.
- **Macchina spenta o non raggiungibile:** schermo barrato.
- **Su più macchine:** uno schermo per copia, separati da frecce di andata e ritorno; schermo pieno = copia in uso, contorno = in linea, tratteggio = spenta.
- **Copie divergenti:** fra le copie, al posto delle frecce, il segno ≠ in ambra; solo quella parte è colorata.

Sul tema chiaro l'ambra dei segni grafici è più chiara di `--warn` (`oklch(0.64 0.17 68)` nell'anteprima, almeno 3:1 sul fondo), perché `--warn` chiaro (luminanza 0.42) è tarato per il testo e accanto ai grigi della barra non si riconosce. Il testo in ambra resta `--warn`.

**Accettazione:** con un progetto locale, uno remoto, uno su due macchine, uno con copie divergenti e uno su una macchina spenta, la barra mostra i cinque casi distinti senza testo troncato, sia sul tema scuro sia sul chiaro; il glifo non cambia quando la tessera diventa attiva; un lettore di schermo legge la macchina.
**Precisazione del 2026-11-18 (F24, R-MI-24):** quando la tessera non è in primo piano non rappresenta più sempre l'ultima copia usata, ma prima la copia che aspetta una risposta. Il glifo della copia in uso resta la regola F18.
**Errore da evitare:** riquadri con nomi troncati; un'icona che si legga come «questo computer» o come «copia»; ambra marrone sul tema chiaro.

## R-MI-20 — Nascondere o chiudere un progetto remoto o su più macchine

**Fonti:** F21.

Il pannello del progetto offre due azioni distinte: «Nascondi da questa finestra», che toglie la tessera solo qui e lascia il progetto aperto sulle macchine che lo eseguono (si ritrova nel selettore), e «Chiudi progetto…», che chiede su quali macchine chiuderlo e avvisa del lavoro attivo che verrebbe interrotto.

**Accettazione:** su un progetto presente su due macchine, nascondere dalla finestra di W non chiude nulla su M; chiudere scegliendo solo M lascia la copia di W aperta e la tessera in barra.
**Interfaccia approvata (F23, variante A):** nella pagina principale del pannello, sotto le azioni, «Nascondi da questa finestra» e «Chiudi progetto…». La seconda apre una sottovista con una casella per ogni macchina (tutte spuntate), il glifo della macchina e, per ciascuna, il lavoro che verrebbe interrotto o «Spento: si chiude quando torna in linea»; il pulsante dice su quante macchine chiude. Sui progetti solo di questa macchina resta il solo «Chiudi progetto», come oggi, senza sottovista.
**Precisazione (2026-11-17, confermata dall'utente nel modulo di pubblicazione):** «Nascondi da questa finestra» compare solo quando nessuna copia è su questa macchina. Una copia locale vive nei processi di questa finestra: nasconderla senza chiuderla lascerebbe un agente senza interfaccia. Per toglierla si usa «Chiudi progetto…» spuntando questa macchina; la tessera resta finché il progetto è aperto altrove.
**Errore da evitare:** «Chiudi» che chiude soltanto la copia mostrata e fa ricomparire l'altra come tessera separata (comportamento del 2026-11-17).

## R-MI-21 — Un elenco solo dei progetti di tutte le macchine

**Fonti:** F21. Precisa R-MI-04.

Il selettore dei progetti mostra un elenco unico con i progetti di tutte le macchine abbinate, con le copie dello stesso repository già unite, l'indicazione di dove esiste e dove è aperto ciascuno, e filtri per macchina e per stato.

**Accettazione:** con progetti su W, su M e su entrambe, il selettore li elenca una volta ciascuno; il filtro per M mostra solo quelli presenti su M; un progetto aperto su M ma non in barra su W si apre da qui.
**Interfaccia approvata (F23, variante C):** l'elenco è diviso in tre gruppi con il conteggio: «In questa finestra», «Aperti su altre macchine», «Chiusi». Ogni riga ha sigla, nome e, a destra, un'etichetta per macchina con glifo (R-MI-19) e nome intero: in evidenza dove il progetto è aperto, tratteggiata se la macchina è spenta. Le copie divergenti sono segnalate accanto al nome. Sopra l'elenco, i filtri sono le macchine.

## R-MI-22 — Avviso quando le copie divergono

**Fonti:** F17 («avviso quando divergono»), F21.

Quando le copie dello stesso progetto divergono, Studio lo segnala nel glifo della tessera (R-MI-19), nel pannello del progetto con il dettaglio della differenza, e nella finestra del progetto attivo, dove si lavora.

**Interfaccia approvata (F23, variante B):** una striscia agganciata sopra il composer del progetto attivo, come la riga di attenzione del vassoio (fondo ambra al 15%), con il glifo ≠ di R-MI-19, il riassunto della differenza e due azioni: «Confronta» (apre il confronto in Git) e «Più tardi» (la riduce finché lo stato delle copie non cambia). Il dettaglio resta anche nel pannello del progetto (R-MI-23).

**Regola (F25, 2026-11-18, sostituisce Q5 del 2026-11-17):** il confronto è per branch, fra la stessa branch sulle due copie. Due copie divergono solo se entrambe hanno commit che l'altra non ha (nessun fast-forward possibile) oppure se entrambe hanno modifiche non committate. Una copia soltanto indietro, o con modifiche da una parte sola, **non diverge**: si sincronizza (R-MI-26, R-MI-27). Branch diversi fra le due copie non sono una divergenza. Il lavoro fatto offline o fuori da Studio diverge solo se, al ritorno, ricade in uno dei due casi.

*Regola precedente (Q5, 2026-11-17, sostituita da F25):* divergenza anche per branch diversi e per HEAD diversi sullo stesso branch, perché senza i commit dell'altra macchina non si distingueva «indietro» da «divergente».

**Accettazione:** con commit nuovi su una sola copia la striscia non compare e l'altra copia risulta «da aggiornare» (poi aggiornata, R-MI-27); con commit nuovi su entrambe la striscia compare con il riassunto corretto; «Più tardi» la toglie e torna solo se le copie cambiano; quando le copie tornano allineate sparisce; con modifiche non committate su una sola copia non compare; due copie su branch diversi non la fanno comparire.

## R-MI-23 — Anteprima e pannello del progetto con la macchina

**Fonti:** F22. Precisa R-MI-03, R-MI-12 e R-MI-13 per il popover del progetto; il disegno è in `proto/multi-istanza-pannello.html` (varianti B e C).

**Anteprima al passaggio del mouse.** Per un progetto che non è solo su questa macchina, la macchina su cui gira sta sopra il nome del progetto, come un'etichetta con il suo glifo (R-MI-19); se è spenta lo dice. In fondo, separata da una linea, «Anche su» con un segno per ogni altra macchina (glifo e nome intero, tratteggiato se spenta). Nessun percorso completo; per i progetti solo locali resta il percorso breve di oggi.

**Pannello (tre puntini o tasto destro).** La pagina principale resta corta: una riga «Macchine» (o «Macchina» con una copia sola) con il glifo del progetto e, sotto, dove partono le nuove chat; porta a una sottovista dedicata, come Coda e Git. La sottovista contiene:

- «Nuove chat e task partono su»: scelta fra le macchine in linea (è la copia in uso, la stessa dell'indicatore sotto il composer, R-MI-13);
- «La coda parte da sola su»: scelta dell'unica macchina con l'auto-avvio (F20);
- «Copie»: una riga per macchina con sistema, corsie e lavoro in corso, e il pulsante per copiare il percorso.

Le macchine spente sono visibili ma non si scelgono. Niente pulsanti generici come «Usa questa copia» e niente percorsi completi nella pagina principale.

**Accettazione:** su un progetto presente su tre macchine con una spenta, l'anteprima mostra prima la macchina in uso e poi le altre due, quella spenta riconoscibile; nella sottovista cambiare «Nuove chat e task partono su» cambia la macchina dell'indicatore sotto il composer e il pieno del glifo in barra; la macchina spenta non è selezionabile in nessuna delle due scelte.

## R-MI-24 — Una tessera, lo stato di tutte le copie

**Fonti:** F24. Precisa R-MI-12 e R-MI-19.

Lo stato della tessera (al lavoro, domanda in attesa, finito) unisce tutte le copie: se l'agente aspetta sul Mac, la tessera lo mostra anche quando rappresenta la copia di Windows. Quando il progetto non è in primo piano, clic, `Ctrl+Tab` e `Ctrl+N` aprono la copia che aspetta una risposta (domanda, conflitto della corsia); se sono più d'una, l'ultima usata; se nessuna aspetta, l'ultima usata come da F18. La macchina proposta per le nuove chat resta l'ultima usata (F18).

**Accettazione:** progetto su Windows e Mac, ultima usata Windows, domanda in attesa sul Mac: la tessera da Windows mostra l'attesa e un clic apre la sessione del Mac.
**Errore da evitare:** la tessera ferma mentre un'altra copia aspetta; aprire una sessione vuota mentre il lavoro è altrove.

## R-MI-25 — Cambiare macchina da tastiera

**Fonti:** F24.

Con in primo piano un progetto presente su più macchine, `Ctrl+Alt+↓` passa alla copia della macchina successiva e `Ctrl+Alt+↑` alla precedente, nell'ordine del pannello «Macchine» (questa macchina, poi le altre per nome). Le macchine spente si saltano. Su un progetto con una sola copia raggiungibile la combinazione non fa nulla.

**Accettazione:** progetto su tre macchine con una spenta: `Ctrl+Alt+↓` alterna le due in linea.

## R-MI-26 — I commit viaggiano fra le copie

**Fonti:** F25. Risolve Q6.

Ogni macchina tiene aggiornata la propria copia leggendo i commit delle copie gemelle in linea, direttamente sul collegamento di Studio: niente push su GitHub, funziona anche senza `origin`. Ogni macchina scrive solo sul proprio repository: dall'altra legge soltanto. I commit ricevuti stanno in riferimenti propri di Studio (per macchina e per branch), separati dai branch di lavoro, così ogni macchina sa da sola se è allineata, indietro, avanti o divergente rispetto all'altra. Se `origin` c'è, lo si legge come oggi. Studio non fa mai push da solo.

**Accettazione:** due copie dello stesso repository senza `origin`; un commit sul Mac compare, entro il successivo aggiornamento dello stato, fra i riferimenti della copia di Windows, che risulta «indietro di 1»; nessun push su GitHub; con il permesso di sola lettura la lettura dei commit funziona e nessun file dell'altra macchina cambia.
**Errore da evitare:** scrivere sul repository dell'altra macchina; commit di lavoro pubblicati su GitHub senza una scelta dell'utente.

## R-MI-27 — La copia indietro si aggiorna da sola

**Fonti:** F25.

Una branch che sulla copia locale è soltanto indietro avanza con un fast-forward. Se la branch è in uso nella cartella del progetto o in una corsia, l'avanzamento avviene solo se quella cartella non ha modifiche non committate, l'editor non ha file non salvati e nessun agente o terminale sta lavorando lì; altrimenti la tessera la segna «da aggiornare» e l'aggiornamento parte appena la cartella si libera. Mai merge, rebase o reset automatici.

**Accettazione:** commit sul Mac, copia di Windows ferma e pulita: Windows avanza da sola e l'editor ricarica i file aperti; con un agente al lavoro su Windows resta «da aggiornare» e avanza a turno finito; con commit su entrambe nessun avanzamento e compare l'avviso di R-MI-22.
**Errore da evitare:** toccare la cartella mentre un agente scrive; perdere modifiche non salvate.
**Precisazioni del 2026-11-23 (F31):** i file sporchi che i commit in arrivo non toccano non bloccano più l'avanzamento (R-MI-47); il solo diario si unisce in automatico anche su branch divergenti (R-MI-48). Restano vietati merge, rebase e reset automatici su qualunque altro file.

## R-MI-28 — Portare le modifiche non committate cambiando macchina

**Fonti:** F25. Precisa R-MI-13 e R-MI-25; anticipa una parte di R-MI-14.

Le modifiche non committate restano sulla loro macchina. Cambiando macchina (indicatore sotto il composer, `Ctrl+Alt+↑/↓`) quando la copia di partenza ne ha, Studio offre «Porta qui le modifiche». La copia di arrivo prima si allinea ai commit (R-MI-27), poi riceve un'istantanea delle modifiche, file nuovi compresi, e la applica. La copia di partenza torna pulita solo dopo la conferma dell'arrivo, e l'istantanea resta recuperabile su entrambe. Serve che nessun agente lavori su nessuna delle due copie. La sessione della chat non si sposta: resta R-MI-14.

**Accettazione:** modifiche non committate sul Mac, passaggio a Windows con «Porta qui le modifiche»: su Windows compaiono gli stessi file modificati, nuovi e cancellati, e il Mac torna pulito; se l'applicazione fallisce a metà, il Mac non perde nulla.
**Errore da evitare:** modifiche sincronizzate in automatico (resta scartata la sincronizzazione continua dei file); pulire la copia di partenza prima della conferma.

## R-MI-29 — Macchine non più raggiungibili e reinstallate

**Fonti:** F26.

Ogni macchina abbinata porta l'istante dell'ultimo contatto, conservato fra i riavvii e mostrato nelle Impostazioni («vista l'ultima volta …»); oltre 30 giorni senza contatto la riga è evidenziata. Quando una macchina si abbina con lo stesso nome di una già abbinata e mai più vista dopo il cambio di chiave (reinstallazione), Studio propone di sostituire la vecchia. Nessuna revoca o cancellazione automatica.

**Accettazione:** reinstallare Studio sul Mac e riabbinarlo dal PC: il PC propone di sostituire il vecchio «MacBook» e, accettando, ne resta uno solo; una macchina mai vista da oltre 30 giorni è evidenziata ma non sparisce.

## R-MI-30 — Relay irraggiungibile o macchina spenta

**Fonti:** F26. Precisa R-MI-17.

Studio distingue «la macchina non risponde» da «il relay non è raggiungibile da qui»: verifica da sé il relay configurato e lo dice nelle Impostazioni e nell'etichetta della macchina spenta.

**Accettazione:** con il relay spento, le macchine non raggiungibili risultano «relay non raggiungibile» e non «spenta»; con il relay acceso e il Mac spento risulta «non raggiungibile».

## R-MI-31 — Una notifica sola, sulla macchina usata per ultima

**Fonti:** F26.

Un evento di un progetto (agente che finisce, domanda, errore) notifica e fa lampeggiare l'icona dell'app solo sulla macchina con l'input dell'utente più recente fra quelle in linea. Il confronto usa da quanti secondi ogni macchina è inattiva, misurato sul posto, non orari di macchine diverse. Se tutte le macchine sono inattive da più di 10 minuti notificano tutte.

**Precisazione (2026-11-20, implementazione):** il Companion non emette suoni; il suo elenco di richieste e il numero sul badge dell'icona restano su tutte le macchine, perché descrivono lo stato e non sono avvisi. Se l'altra macchina non risponde entro 1,5 s si notifica comunque: un avviso doppio è meglio di uno perso.

**Accettazione:** con l'utente al PC e un agente del Mac che finisce, la notifica compare solo sul PC; allontanandosi da entrambe per oltre 10 minuti compare su tutte e due.

## R-MI-32 — Identità del progetto: rinomina e fork senza origin

**Fonti:** F26. Precisa R-MI-12.

Se una copia ha l'`origin` col nome vecchio di un repository rinominato su GitHub, Studio lo riconosce e propone di aggiornare l'indirizzo, così le copie tornano unite. Due copie senza `origin` con lo stesso primo commit non si uniscono da sole: Studio chiede «È lo stesso progetto?» e ricorda la risposta.

**Accettazione:** rinominare il repository su GitHub con le due copie collegate: compare la proposta e, accettandola, la tessera torna una; due fork locali senza origin compaiono separati finché l'utente non conferma.

## R-MI-33 — Trasferimenti grandi fra le copie

**Fonti:** F26. Precisa R-MI-26 e R-MI-28.

I commit e le istantanee viaggiano a pezzi, senza il tetto di 60 MB di una sola risposta. «Porta qui le modifiche» indica prima quanto pesa lo spostamento. Un disco pieno produce un messaggio chiaro, non l'errore di git.

**Accettazione:** un commit con un file da 200 MB arriva sull'altra copia; la domanda di «Porta qui le modifiche» mostra la dimensione.

## R-MI-34 — Chiave della macchina protetta e revoca propagata

**Fonti:** F26. Precisa R-MI-09.

La chiave segreta della macchina vive nel portachiavi del sistema (Keychain su macOS, archivio credenziali su Windows), non in chiaro nel file di configurazione; una chiave già salvata in chiaro si sposta al primo avvio. Revocando una macchina si può chiedere di revocarla anche su tutte le altre macchine abbinate in linea.

**Accettazione:** dopo l'avvio il file di configurazione non contiene la chiave; con tre macchine, revocare il portatile dal Mac con «anche sulle altre» lo revoca anche sulla terza.

## R-MI-35 — Branch che differiscono solo per maiuscole

**Fonti:** F26. Precisa R-MI-22 e R-MI-26.

Branch delle copie che differiscono solo per maiuscole (`Feature` e `feature`) collidono sui filesystem di macOS e Windows: Studio non le sincronizza e le segnala come divergenza, con il nome delle due branch.

**Accettazione:** con `Feature` sul Mac e `feature` sul PC compare la striscia di divergenza che le nomina, e nessuna delle due viene sovrascritta.

## R-MI-36 — Esegui su macchina

**Fonti:** F27. Usa R-MI-09 (ambito Terminale) e R-MI-33 (trasferimento a pezzi).

Uno script avviato da Studio (attraverso il bridge locale che Studio passa ad agenti e terminali) o un agente (tool `macchina_esegui`, `macchina_stato`, `macchina_risultato`) lancia un comando su un'altra macchina abbinata. Il comando gira in una cartella di lavoro dedicata al progetto su quella macchina, spostata al commit richiesto: la copia dove lavorano l'utente o gli agenti non viene toccata. La cartella è una per progetto e viene riusata, con la cache di compilazione, così i job successivi partono caldi. Chi lancia riceve il log in diretta, il codice d'uscita e gli artefatti che ha dichiarato (percorsi o glob relativi alla cartella del job), trasferiti a pezzi con verifica SHA-256 fino a 2 GiB. Fermare chi ha lanciato ferma il job remoto con tutti i processi figli. Sulla stessa macchina gira un job alla volta per progetto; gli altri attendono in fila. Finché un job è in corso Studio impedisce la sospensione di quella macchina. Basta l'ambito Terminale, senza conferma per singolo comando; sulla macchina che esegue resta visibile cosa gira e chi l'ha chiesto. Fuori da Studio (terminale esterno, senza bridge) la funzione non esiste.

**Accettazione:** dal Mac un agente esegue `npm test` sul PC Windows allo stesso commit, vede il log mentre scorre, riceve il codice d'uscita e un file di rapporto dichiarato; con un'interruzione dal Mac il processo sul PC termina; la cartella di lavoro del progetto sul PC resta com'era.

## R-MI-37 — Build Nightly distribuita su Mac e Windows

**Fonti:** F27. Primo uso di R-MI-36; vale per la Nightly, la stabile resta su `release.yml` in cloud.

`npm run nightly` lanciato dentro Studio usa l'altra macchina collegata: dopo preflight, commit e push sul coordinatore (la macchina da cui si lancia), chiede all'altra di compilare la propria piattaforma allo stesso commit e con lo stesso `build_id`, mentre il coordinatore compila la sua. Il log dell'altra macchina appare nell'output dello script, con il prefisso della macchina, e in un pannello di Studio. A fine build il coordinatore si riprende installer e firme e pubblica tutto da solo: un solo caricamento, un solo `nightly.json` con i checksum di entrambe le piattaforme, un solo spostamento del tag. Linux si compila sempre in cloud. Se all'avvio l'altra macchina manca (spenta, non collegata, versione incompatibile, progetto o chiave di firma assenti), Studio chiede con un proprio dialogo: attendere senza limite, affidare l'altra piattaforma al cloud, oppure pubblicare solo la propria. Se la build dell'altra macchina fallisce a metà, la sua piattaforma passa al cloud e il riepilogo finale lo dice. Fuori da Studio `npm run nightly` resta com'è oggi.

**Accettazione:** lanciata dal Mac con il PC collegato, la prerelease `nightly` contiene DMG e installer Windows della stessa versione, `nightly.json` con entrambe le piattaforme verificabili dall'aggiornamento, e il workflow cloud compila solo Linux; con il PC spento compare il dialogo con le tre scelte.

**Precisazione 2026-11-23:** «diceva che il macbook air non è online anche se lo è». Una macchina raggiungibile ma non pronta mostra il motivo del controllo fallito; «Attendi» registra i cambi di stato senza ripetere lo stesso errore. Prova in Chromium: il vero dialogo, con evento IPC di prova, mostra MacBook Air in linea e il blocco di firma e restituisce `scelta: cloud` dopo l'attivazione da tastiera. La build distribuita su due macchine resta da esercitare.

## R-MI-38 — Aggiornare l'altra macchina con un clic

**Fonti:** F28. Precisa R-MI-10 e completa la riga R-MI-10 della tabella (indicazione e aggiornamento comandato).

Quando un'altra macchina ha una versione di Studio diversa, la sua tessera, il pannello del progetto e la sua riga in Impostazioni › Altre istanze mostrano «Aggiorna Studio su M». Il comando porta M alla stessa versione della macchina da cui si clicca, se è pubblicata; altrimenti all'ultima del canale di chi clicca, e la domanda lo dice prima di partire. Se su M c'è lavoro in corso (agente al lavoro, domanda in attesa, job remoto di R-MI-36, file non salvati), M scarica subito e installa e riavvia appena è libera; intanto la tessera mostra «aggiornamento in attesa che finisca …». A fine Nightly distribuita (R-MI-37) Studio propone «Aggiorna entrambe». Nessuna macchina si aggiorna da sola perché si è aggiornata un'altra.

**Accettazione:** con M su una Nightly precedente, un clic da W porta M alla versione di W e il collegamento torna pieno; con un agente al lavoro su M l'installazione aspetta la fine del turno e la tessera lo dice.

## R-MI-39 — Registro delle azioni remote

**Fonti:** F30. Precisa R-MI-09 («il registro di M riporta le azioni di W»).

Ogni macchina registra le azioni che un'altra macchina le fa fare e che cambiano qualcosa o eseguono: messaggi e risposte all'agente, scritture di file, operazioni Git, terminali aperti, job di R-MI-36, aggiornamenti di R-MI-38, inoltri di porta di R-MI-40, revoche, spostamenti di copie e di sessioni. Le sole letture non si registrano. Ogni voce dice quando, quale macchina, quale progetto e cosa. Il registro si consulta in Impostazioni › Altre istanze, «Attività» per ogni macchina, filtrabile per progetto, anche da un'altra macchina con l'ambito Lettura. Le voci più vecchie di 30 giorni si cancellano.

**Accettazione:** dal PC si invia un messaggio all'agente sul Mac, si salva un file e si lancia un job; nel registro del Mac compaiono tre voci col nome del PC, consultabili anche dal PC; aprire un file in sola lettura non aggiunge voci.

## R-MI-40 — Anteprima del server di sviluppo dell'altra macchina

**Fonti:** F30. Supera, per il solo server di sviluppo, l'esclusione del Browser di Studio dal vivo sui progetti remoti approvata in F16; parità MI11.

Un indirizzo `localhost:PORTA` scritto dall'agente o dal terminale di un progetto che gira su un'altra macchina diventa cliccabile: Studio apre un inoltro dalla porta di quella macchina a una porta locale e mostra la pagina nel Browser di Studio o nel browser di sistema, a scelta. Il pannello del progetto offre anche «Apri porta…» per indicare la porta a mano. Si inoltrano solo porte di `localhost` della macchina remota e serve l'ambito Terminale. L'inoltro si chiude chiudendo la scheda o il progetto, o quando la macchina si scollega; il ricaricamento a caldo del server di sviluppo continua a funzionare.

**Accettazione:** con `npm run dev` avviato sul Mac, dal PC il link scritto nel terminale apre il sito nel Browser di Studio; una modifica salvata sul Mac si vede sul PC senza ricaricare a mano; senza ambito Terminale il link non apre l'inoltro e lo dice.

## R-MI-41 — Corsie dello stesso progetto su macchine diverse

**Fonti:** F30. Usa R-MI-26 e R-MI-27.

Una corsia parte di base sulla macchina della sessione che la apre; dall'interfaccia di avvio e da `corsia_avvia` se ne può indicare un'altra fra quelle con una copia del progetto. Le corsie di tutte le macchine compaiono in un'unica barra delle corsie del progetto, ciascuna col glifo della propria macchina. L'integrazione di una corsia gira sulla macchina della corsia, nella sua copia; il risultato raggiunge le altre copie con la sincronizzazione dei commit. Gli eventuali conflitti si risolvono su quella macchina, anche comandandola da un'altra.

**Accettazione:** dal PC si avviano due corsie, una sul PC e una sul Mac; entrambe compaiono nella stessa barra con il loro glifo; integrata dal PC, la corsia del Mac porta i suoi commit nella copia del Mac e poi in quella del PC.

## R-MI-42 — Impostazioni di omp sincronizzate

**Fonti:** F30.

Le impostazioni di omp si possono sincronizzare fra le macchine abbinate: ruoli modello e impostazioni generali, agenti utente (`~/.omp/agent/agents`), skill utente, regole globali (`~/.omp/agent/AGENTS.md`), server MCP. Le credenziali non viaggiano mai: di un server MCP viaggia la configurazione, mentre i valori di `env` e `headers` restano su ogni macchina. La sincronizzazione è spenta di base e si accende per macchina e per categoria. Funziona per file e vince l'ultima modifica; se lo stesso file è cambiato su entrambe le macchine dall'ultimo giro, Studio mostra le due versioni e chiede quale tenere. Un ruolo si può fissare su una macchina («su questo Mac il ruolo X usa il modello A») e quell'eccezione non viaggia. Un ruolo che punta a un modello senza credenziali sulla macchina di arrivo viaggia comunque, e le Impostazioni di quella macchina lo segnalano come inutilizzabile finché non si accede al provider.

**Accettazione:** con la categoria agenti accesa, un agente creato sul Mac compare sul PC; un ruolo fissato sul PC resta com'è quando sul Mac lo si cambia; un file di regole cambiato su entrambe fa comparire la scelta fra le due versioni; nessun token MCP compare sull'altra macchina.

## R-MI-43 — Chiave della macchina sparita dal portachiavi

**Fonti:** F30. Precisa R-MI-34.

Se il portachiavi risponde ma la chiave della macchina non c'è più, Studio non crea da solo una nuova identità e non resta bloccato in silenzio: Impostazioni › Altre istanze mostra un avviso con tre scelte. «Riprova» serve se il portachiavi era bloccato. «Crea una nuova identità» avvisa che le altre macchine vanno riabbinate; su di esse compare la proposta di sostituzione per stesso nome di R-MI-29. «Lascia spento il collegamento» non cambia nulla. Non serve più cancellare a mano `instances.json`.

**Accettazione:** tolta la chiave dal portachiavi, all'avvio compare l'avviso; con «Crea una nuova identità» e un nuovo abbinamento, l'altra macchina propone di sostituire la vecchia voce con lo stesso nome.

## R-MI-44 — Decisioni su fork e rinomina condivise

**Fonti:** F30. Precisa R-MI-32, dove le decisioni valevano solo per la finestra che le prendeva.

La risposta a «unisci / non unire» per le copie senza origin con lo stesso primo commit viaggia fra le macchine collegate come la coda: vale ovunque e vince la più recente. Si cambia dal pannello del progetto su qualunque macchina.

**Accettazione:** rispondendo «non unire» sul Mac, il PC non pone la stessa domanda; cambiata la scelta dal PC, il Mac la segue.

## R-MI-45 — Tessera unita fin dall'avvio

**Fonti:** F31. Precisa R-MI-12 e R-MI-24.

Un progetto presente su più macchine compare come una sola tessera dal primo disegno della barra, senza clic e senza aspettare lo stato git della copia. L'identità del repository (`origin` normalizzato, primo commit) arriva con lo snapshot dell'host e si conserva nella cache delle macchine, quindi vale anche con l'altra macchina spenta. Lo stato git della copia la conferma o la corregge, ma non è più la condizione per unire. Le chiavi della cache di identità distinguono la macchina: due copie con lo stesso percorso su macchine diverse non si scambiano l'identità.

**Accettazione:** riavviare Studio su Windows con `omp-studio` presente su Windows e Mac: la barra mostra una sola tessera dal primo disegno, senza clic; con il Mac spento e il riepilogo in cache, la tessera è comunque una.
**Errore da evitare:** due tessere che si uniscono solo dopo un clic; tessere unite per errore perché due macchine usano lo stesso percorso.

## R-MI-46 — Diario e documenti del progetto committati da chi li scrive

**Fonti:** F31.

Quando `project_docs` scrive il diario (`docs/diario/AAAA-MM.md`) o un documento di progetto in un repository git, committa subito solo i file che ha scritto, con un messaggio «diario: …» o «docs: …», senza includere altro già in stage né file dell'utente. Se il commit non è possibile (merge o rebase in corso, HEAD staccato, errore di git) il file resta modificato e il tool lo dice nel risultato. Il commit non viene mai pubblicato da solo (resta R-MI-26: nessun push automatico).

**Accettazione:** a fine Nightly l'agente aggiorna il diario: `git status` resta pulito e c'è un commit «diario: …» con il solo file del diario; con altri file in stage, quelli restano in stage e fuori dal commit.
**Errore da evitare:** working tree sporco dopo un aggiornamento del diario; commit che trascina modifiche dell'utente.

## R-MI-47 — Avanzamento con file sporchi che i commit non toccano

**Fonti:** F31. Precisa R-MI-27.

Una copia indietro con modifiche non committate avanza lo stesso se i commit in arrivo non toccano i file modificati: le modifiche restano dove sono, come con `git pull --autostash`. Se li toccano, Studio salva un'istantanea delle modifiche (la stessa di R-MI-28), avanza e la riapplica; se la riapplicazione va in conflitto, ripristina la copia com'era e la lascia «da aggiornare», dicendo quale file blocca. Restano i vincoli di R-MI-27 sull'agente al lavoro, i file non salvati nell'editor e le automazioni.

**Accettazione:** commit sul Mac che tocca `src/a.ts`, copia di Windows con `docs/diario/2026-11.md` modificato: Windows avanza e il diario resta modificato; con modifiche locali in conflitto con il commit in arrivo la copia resta intatta e risulta «da aggiornare» con il nome del file.
**Errore da evitare:** perdere modifiche non committate; avanzamento bloccato da un file che i commit non toccano.

## R-MI-48 — Il solo diario si unisce da sé

**Fonti:** F31. Eccezione approvata a «mai merge automatici» di R-MI-27.

Se la stessa branch è divergente fra due copie e, dal punto di separazione, i commit di entrambe le parti toccano solo file sotto `docs/diario/`, la sincronizzazione unisce le due storie con l'unione per righe (driver `union` di git), senza conflitti. Per non produrre due commit di unione diversi, unisce una sola delle due macchine, scelta in modo deterministico (identificativo di macchina minore); l'altra avanza poi con il fast-forward di R-MI-27. Valgono gli stessi vincoli di cartella libera di R-MI-27 e R-MI-47. Se anche un solo commit tocca altri file, resta la divergenza di R-MI-22.

**Accettazione:** diario committato su Mac e su Windows nello stesso giorno: entro due giri di sincronizzazione le due copie hanno la stessa cima, il file contiene le righe di entrambe e la striscia di divergenza non compare; con un commit che tocca anche `src/` la striscia compare come oggi.
**Errore da evitare:** due commit di unione diversi che fanno divergere di nuovo; righe del diario perse; unione automatica di file che non sono il diario.

## R-MI-49 — Chip «Macchine» nella barra di stato

**Fonti:** F31.

Con almeno una macchina abbinata, la barra di stato mostra un chip «Macchine» con un punto di stato per ogni macchina (in linea, spenta, relay non raggiungibile, versione incompatibile) e un indicatore animato mentre una sincronizzazione delle copie è in corso. Il popover elenca ogni macchina con: stato e motivo, via (diretta o relay) e latenza, ultima sincronizzazione, copie da aggiornare o divergenti con il motivo, job in corso (R-MI-36), aggiornamento in corso o disponibile (R-MI-38), e porta al dettaglio della macchina in Impostazioni › Dispositivi.

**Accettazione:** con il Mac in linea il chip mostra il punto verde; spegnendo il Mac il punto cambia entro un minuto; durante un giro di sincronizzazione l'indicatore si anima; il clic sul popover porta al dettaglio della macchina giusta.
**Errore da evitare:** il chip che apre la sezione sbagliata (difetto del 2026-11-23: il chip della macchina apriva Studio Remote).

## R-MI-50 — Sincronizzazione visibile sulla tessera

**Fonti:** F31. Precisa R-MI-19 e R-MI-23.

Sulla tessera di un progetto su più macchine le frecce del glifo si animano mentre la sincronizzazione delle copie di quel progetto è in corso. L'anteprima al passaggio del mouse aggiunge «sincronizzata N min fa» (o «mai sincronizzata», «sincronizzazione in corso»). L'animazione rispetta la preferenza di movimento ridotto.

**Accettazione:** durante un giro le frecce si muovono e l'anteprima dice «sincronizzazione in corso»; a giro finito dice «sincronizzata adesso»; con movimento ridotto le frecce non si muovono e resta il testo.

## R-MI-51 — Avvisi sugli eventi delle macchine

**Fonti:** F31.

Studio mostra un avviso breve, non bloccante, quando: una macchina abbinata torna in linea o cade; arrivano commit dall'altra macchina e la copia avanza («3 commit arrivati dal Mac»); l'unione del diario di R-MI-48 è avvenuta; un avanzamento resta bloccato e perché (agente al lavoro, file in conflitto, file non salvati). Lo stesso evento non si ripete finché lo stato non cambia; all'avvio non si annunciano le macchine già in linea.

**Accettazione:** spegnendo il Mac compare «MacBook non raggiungibile» una volta sola; riaccendendolo «MacBook di nuovo in linea»; un commit sul Mac produce «1 commit arrivato dal MacBook» quando la copia avanza.
**Errore da evitare:** avvisi ripetuti a ogni giro; avvisi all'avvio per lo stato già noto.

## R-MI-52 — Una sola sezione «Dispositivi» nelle Impostazioni

**Fonti:** F31. Sostituisce nell'interfaccia le sezioni «Remote» e «Altre istanze»; non toglie funzioni.

Le Impostazioni hanno una sola sezione «Dispositivi». In testa c'è questo computer: un solo nome, usato sia per i computer abbinati sia per Studio Remote, e il «Server di collegamento» (R-MI-56). Sotto c'è un elenco unico di computer e telefoni, ciascuno con il proprio stato. Una riga apre il dettaglio del dispositivo: per un computer stato e via, ambiti di permesso, aggiornamento di Studio (R-MI-38), job (R-MI-36), sincronizzazione di omp (R-MI-42), registro attività (R-MI-39), revoca; per un telefono stato e disconnessione. Un solo pulsante «Aggiungi dispositivo» apre il percorso guidato: computer in rete locale (R-MI-54), computer con codice (R-MI-53, R-MI-55), telefono (R-REM-25). Gli avvisi di R-MI-29 (vista l'ultima volta, sostituzione) e R-MI-43 (chiave mancante) stanno qui.

**Accettazione:** non esistono più due voci separate nel menu delle Impostazioni; cambiare il nome di questo computer lo cambia per il telefono e per le altre macchine; ogni funzione delle due sezioni precedenti si raggiunge dalla nuova.
**Errore da evitare:** due nomi per lo stesso computer; un'impostazione delle sezioni precedenti non più raggiungibile.

**Cutover (2026-11-23):**

| Da | A | Esito |
|---|---|---|
| Impostazioni › Remote (abilita, stato, nome, relay, dispositivi, dimentica abbinamento, abbina) | Dispositivi: testata, elenco telefoni, dettaglio, «Aggiungi dispositivo» | Spostato |
| Impostazioni › Altre istanze (abilita, nome, relay iroh e token, codice, peer, permessi, aggiornamento, job, sync omp, attività, revoca, avvisi) | Dispositivi: testata, «Avanzate» del server, dettaglio del computer, «Aggiungi dispositivo» | Spostato |
| «Altre macchine» (finestra con la PWA del relay) | Dettaglio dei computer dalla sezione Dispositivi | Spostato |

## R-MI-53 — Il codice porta relay e token

**Fonti:** F31. Precisa R-MI-16.

Il codice di abbinamento di un computer contiene l'indirizzo del relay iroh e, se c'è, il suo token. Una macchina che non ha ancora configurato il collegamento lo adotta incollando il codice: non serve configurare né accendere nulla prima. Se ha già un relay diverso, Studio chiede se passare a quello del codice.

**Accettazione:** su un'installazione nuova, «Aggiungi dispositivo › Ho un codice», incollare il codice del Mac: l'abbinamento riesce senza altri campi e il relay risulta configurato.

## R-MI-54 — Scoperta in rete locale con conferma a 6 cifre

**Fonti:** F31. Precisa R-MI-16.

Con «Aggiungi dispositivo» aperto, i computer con Studio sulla stessa rete locale compaiono da soli (scoperta mDNS di iroh, senza servizi esterni). Scelto un computer, entrambi gli schermi mostrano le stesse 6 cifre, ricavate dalle chiavi delle due macchine; l'abbinamento si completa solo se l'altra macchina accetta. Fuori da questo percorso la macchina non si annuncia in rete come disponibile all'abbinamento.

**Accettazione:** Mac e PC sulla stessa rete: il Mac compare nell'elenco del PC; il PC sceglie il Mac, il Mac mostra la richiesta con le stesse 6 cifre e, accettando, entrambe risultano abbinate; rifiutando non resta nulla.
**Errore da evitare:** abbinamento senza conferma dall'altra macchina; macchine annunciate in rete mentre nessuno sta abbinando.

## R-MI-55 — Codice corto fra reti diverse

**Fonti:** F31. Precisa R-MI-16.

Se il server di Studio Remote è configurato, il codice da digitare è corto (`XXXX-XXXX`): Studio deposita il codice completo sul relay di Studio Remote per 10 minuti, cifrato con una chiave ricavata dal codice corto, e l'altra macchina lo ritira una sola volta. Il relay non può leggerlo. Il codice completo resta disponibile da copiare per chi non usa Studio Remote.

**Accettazione:** dal PC in ufficio si digita il codice corto mostrato dal Mac a casa: l'abbinamento riesce; un secondo ritiro dello stesso codice fallisce; dopo 10 minuti il codice non vale più.
**Errore da evitare:** il codice completo leggibile dal relay; codici corti riutilizzabili.

## R-MI-56 — Un solo «Server di collegamento»

**Fonti:** F31. Precisa R-MI-16 e R-MI-17.

L'utente inserisce un solo indirizzo, quello del relay di Studio Remote. Studio ricava da lì l'indirizzo del relay iroh, che il server dichiara a chi si autentica; il token del relay iroh viaggia con il codice di abbinamento (R-MI-53). In «Avanzate» restano modificabili i due indirizzi e il token separati, per i server che non dichiarano il relay iroh.

**Accettazione:** con il server che dichiara il relay iroh, inserire solo `https://studio.myapollo.it` basta per telefono e computer; con un server che non lo dichiara, «Avanzate» chiede il relay iroh e lo dice.

## Correzioni del 2026-11-20 (revisione del codice)

Revisione per lettura del codice di tutta la funzione (rapporto della sessione, 25 voci) e correzione in un unico lavoro, su richiesta dell'utente del 2026-11-20: «ok parti dalla risoluzione dei bug, elenco completo». Nessun requisito cambia: le correzioni riportano il codice ai requisiti esistenti. Nessuna prova con due macchine reali.

| Voce | Requisito | Difetto | Correzione | Prova |
|---|---|---|---|---|
| C1 | R-MI-12 | Task cancellati o avviati tornavano in coda dalla copia dell'altra macchina; l'auto-avvio poteva rilanciarli | Rimozioni con istante che viaggiano con la coda (`queueReplication.ts`, `removed` nello store globale), anche quelle fatte da fuori (tool di omp, Companion) | `test/queue-replication.test.ts` |
| C2, C3 | R-MI-12, R-MI-13 | «Vince l'ultima modifica» e copia in uso decise da `Date.now()` di macchine diverse | `logicalClock.ts`: ogni istante supera quelli già visti, locali o remoti | `test/queue-replication.test.ts` (orologio) |
| A4, M8 | R-MI-13, F20 | Auto-avvio acceso su due macchine dopo un comando perso; interruttore remoto che tornava indietro | Istante dell'interruttore (`autoDispatchAt`); vince l'accensione più recente e ogni macchina spegne da sé la propria copia; riepiloghi più vecchi della scelta ignorati | `test/auto-dispatch-owner.test.ts` |
| — | R-MI-12 | Code rilette solo all'apertura del progetto | Rilettura e rinvio a ogni cambio delle copie in linea | `npm run check`, smoke |
| A1, A2 | R-MI-27, R-MI-28 | Controllo «cartella occupata» solo dalla finestra, prima del giro di rete | Il backend controlla il turno in corso della sessione RPC (`SessionHub::is_running`, `rpc::turn_running_in`) subito prima di muovere la cartella; non il lock interattivo, che dura quanto la sessione e avrebbe bloccato R-MI-27 per sempre | `rpc::hub` test del turno; `github::copies` |
| A3, B2 | R-MI-28 | Ricezione dell'istantanea non ripetibile, applicazione a metà | Ricezione idempotente (`refs/studio/wip-applied/<id>`), ripristino solo se l'applicazione era partita, nuovi tentativi dalla finestra, avviso quando la partenza non conferma la pulizia; verifica che il commit ricevuto sia quello del ref | `github::copies` (idempotenza, file dell'utente intatti) |
| A6 | R-MI-09, R-MI-26 | La sola Lettura scaricava le modifiche non committate | `copy_wip_bundle` con permesso File e Git; `copy_sync_bundle` solo branch | `github::copies`, `acl-coverage` |
| A5, M11 | R-MI-09 | Confinamento solo con tutti gli ambiti spenti; `write_queue` scriveva ovunque | Vedi riga R-MI-09 sopra | `link::catalog`, `link::` |
| M1 | R-MI-10 | A versione diversa i progetti sparivano dalla barra | Snapshot ridotto dall'host, tessere ricostruite nella finestra (`expandReducedSnapshot`) | `link::host` |
| M2–M7 | R-MI-26, R-MI-27, R-MI-28 | HEAD staccato, repo shallow o senza commit, stash dell'utente usato per la partenza, CRLF/filemode, chiave macchina collassata, `SyncGuard` sulla stringa | Worktree staccato blocca l'avanzamento («detached» nel pannello); root commit ignorato sui repo shallow; partenza ripulita dal ref senza stash; `core.autocrlf`/`core.filemode` fissati per processo; id macchina intero; guardia sul percorso canonico | `github::copies`, `github::sync` |
| M9 | R-MI-22, R-MI-27 | «≠» e «da aggiornare» accesi con la macchina spenta | Esiti delle macchine non raggiungibili ignorati; giro immediato al ritorno | `npm run check` |
| B1, B3 | R-MI-11, R-MI-26 | Frame scartati in silenzio; pacchetti grandi oltre i 300 s | `Resync` che fa riagganciare da capo; 900 s per i pacchetti | `link::streams` |
| Battito | R-MI-11 | `Ping` mai inviato | Battito ogni 10 s, tre fallimenti di fila chiudono la connessione | `link::` |

Verifiche eseguite il 2026-11-20: `cargo test --lib` 558 passati, `cargo clippy --lib --tests -D warnings` pulito, `npm run check` 0 errori, `npm run check:commands` allineato, `npm test` 1566 passati. Rimandato con motivo: collisione di branch che differiscono solo per maiuscole su filesystem che non le distinguono (M6, seconda parte), da decidere con l'utente.

## Strade scartate

Confermate dall'utente il 2026-11-12 (F5):

| Strada | Motivo |
|---|---|
| Collab di omp | Una stanza per sessione, solo chat, relay non ospitabile in proprio; già scartata in `IDEAS.md` e nel Gate R44 |
| omp via SSH senza Studio | Tutto ciò che non è chat andrebbe riscritto sopra SSH; richiede una porta raggiungibile |
| Sincronizzazione continua dei file | Conflitti, file a metà, sessioni rovinate da due scrittori, percorsi non portabili. Resta scartata anche dopo F25: si sincronizzano i commit (R-MI-26) e le modifiche non committate si spostano solo su richiesta, cambiando macchina (R-MI-28) |

## Domande aperte

- **Q1 — Uso a macchina spenta.** Risolta il 2026-11-12 (F11): nessuna replica; il progetto si mostra non raggiungibile e si possono solo registrare task in coda (R-MI-11, R-MI-12, R-MI-15).
- **Q2 — Punto d'incontro.** Risolta il 2026-11-16 (F13, F15): iroh, con un `iroh-relay` ospitato dall'utente sul proprio server (R-MI-16, R-MI-17). Il relay Bun di Studio Remote resta per il telefono.
- **Q3 — Ambiti dei permessi** di R-MI-09. Risolta il 2026-11-16 (F16): Lettura (sempre), Agenti, File e Git, Terminale; tutti accesi all'abbinamento, modificabili e revocabili per macchina.
- **Q4 — Interfaccia** di abbinamento, elenco macchine e badge. Risolta il 2026-11-16 (F16): implementazione diretta con i componenti di Studio, senza anteprima.
- **Q5 — Quando due copie divergono** (R-MI-22). Risolta il 2026-11-17 nel modulo della sessione: branch diversi, commit presenti in una copia e non nell'altra, modifiche non committate su entrambe; esclusa la sola copia con modifiche non committate. **Sostituita il 2026-11-18 da F25** (nuova regola in R-MI-22).
- **Q6 — Una sola copia per ramo.** Risolta il 2026-11-18 (F25): le copie restano una per macchina ma si sincronizzano via git, con i commit scambiati direttamente fra le macchine (R-MI-26, R-MI-27, R-MI-28); divergono solo quando una sincronizzazione automatica non basta (R-MI-22).

---

Gli ID restano stabili. Una sostituzione conserva qui il requisito precedente, il successore e la data della conferma; una rimozione conserva motivazione e conferma dedicata dell'utente. Il piano operativo e le note di rilascio che toccano questi comportamenti devono indicare gli ID interessati. Le regole comuni sono in [AGENTS.md](../../AGENTS.md), sezione «Requisiti delle funzioni e tracciabilità».
