# Multi-istanza — registro dei requisiti

**Data dell'accordo:** 2026-11-12. **Decisione:** Gate R49 in [DECISIONS.md](../DECISIONS.md).
**Piano operativo:** «Piano Multi-istanza — Gate R49» in [PLAN.md](../PLAN.md).
**Stato generale:** requisiti registrati, nessun codice scritto, nessuna verifica eseguita.

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

Le sei strade valutate sono illustrate in `proto/multi-istanza-strade.html` (locale, fuori da git): è materiale di discussione, non un'anteprima di interfaccia approvata. L'interfaccia di abbinamento, elenco macchine e badge resta da progettare e approvare.

## Stato dei requisiti

| ID | Fase | Stato del requisito | Implementazione | Verifica |
|---|---|---|---|---|
| R-MI-01 | 1 | Attivo, approvato il 2026-11-12 (F4) | Non iniziata | — |
| R-MI-02 | 1 | Attivo, approvato il 2026-11-12 (F4, F8) | Non iniziata | — |
| R-MI-03 | 1 | Attivo, approvato il 2026-11-12 (F1, F3) | Non iniziata | — |
| R-MI-04 | 1 | Attivo, approvato il 2026-11-12 (F2) | Non iniziata | — |
| R-MI-05 | 1 | Attivo, approvato il 2026-11-12 (F2) | Non iniziata | — |
| R-MI-06 | 1 | Attivo, approvato il 2026-11-12 (F3) | Non iniziata | — |
| R-MI-07 | 1 | Attivo, proposta accettata il 2026-11-12 (F1, F9) | Non iniziata | — |
| R-MI-08 | 1 | Attivo, proposta accettata il 2026-11-12 (F3, F9) | Non iniziata | — |
| R-MI-09 | 1 | Attivo, proposta accettata il 2026-11-12 (F9); dettaglio dei permessi da confermare | Non iniziata | — |
| R-MI-10 | 1 | Attivo, proposta accettata il 2026-11-12 (F9) | Non iniziata | — |
| R-MI-11 | 1 | Attivo, confermato il 2026-11-12 (F11) | Non iniziata | — |
| R-MI-12 | 2 | Attivo, approvato il 2026-11-12 (F6, F9, F11) | Non iniziata | — |
| R-MI-13 | 2 | Attivo, approvato il 2026-11-12 (F2, F6) | Non iniziata | — |
| R-MI-14 | 3 | Attivo nell'obiettivo (F7); dettaglio da definire | Non iniziata | — |
| R-MI-15 | 1 | Attivo, approvato il 2026-11-12 (F11, F12) | Non iniziata | — |

Nei testi che seguono **W** è la macchina da cui si guarda (nello scenario il PC Windows) e **M** quella che possiede il progetto (il Mac).

## R-MI-01 — Abbinamento con una chiave, senza account

**Fonti:** F4.

Due istanze di Studio si abbinano una volta sola scambiandosi una chiave (codice o QR mostrato da una e inserito nell'altra). Non servono account, registrazioni né un server ospitato dall'utente. Dopo l'abbinamento le due istanze si riconoscono da sole a ogni avvio.

**Accettazione:** su due installazioni mai collegate, generare il codice su M, inserirlo su W: M compare fra le macchine di W senza creare account; dopo il riavvio di entrambe il collegamento torna da solo.
**Errore da evitare:** richiedere un accesso, un indirizzo da configurare o un relay da installare.

## R-MI-02 — Collegamento diretto, in rete locale e fra reti diverse

**Fonti:** F4, F8.

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

Su un progetto remoto funzionano tutte le funzioni di progetto di Studio, con lo stesso aspetto e lo stesso comportamento: chat GUI e terminale sulla stessa sessione, albero dei file ed editor, Git, corsie e worktree, coda dei task con avvio e programmazione, domande e conferme, storico delle sessioni, diario e documenti di progetto, Laboratorio, anteprime e diagrammi, Browser Studio, quote dei provider di M, impostazioni di omp di M (modelli, ruoli).

Restano della macchina da cui si guarda, per loro natura: finestra, tema e preferenze dell'interfaccia, aggiornamento di Studio, Companion e presenza sul desktop, notifiche. Ogni altra funzione che non possa valere da remoto va elencata qui con la motivazione e confermata dall'utente prima del rilascio.

**Accettazione:** per ogni voce dell'elenco, eseguire su un progetto remoto lo stesso gesto che si fa in locale e ottenere lo stesso risultato; l'elenco delle eccezioni approvate coincide con ciò che l'app non offre da remoto.
**Errore da evitare:** una funzione che da remoto manca, è disattivata o si comporta diversamente senza essere fra le eccezioni approvate.

## R-MI-07 — Due finestre sullo stesso progetto

**Fonti:** F1 (il Mac è acceso con Studio aperto), F9.

Mentre W guida un progetto, la finestra di M resta aperta e utilizzabile sullo stesso progetto. Entrambe vedono lo stesso stato in tempo reale: messaggi, strumenti, todo, corsie, coda. Una domanda dell'agente compare su entrambe e la prima risposta la chiude ovunque. Ciò che parte da solo (avvio della coda, programmazioni, automazioni, integrazione delle corsie) parte una volta sola.

**Accettazione:** con il progetto aperto su entrambe, un prompt inviato da W compare su M mentre arriva la risposta; una domanda risposta da M sparisce da W; un task in coda con avvio automatico parte una volta e crea un solo worktree.
**Errore da evitare:** doppie esecuzioni; una finestra che resta indietro o mostra uno stato diverso; dover chiudere il progetto su M per usarlo da W.

## R-MI-08 — File e percorsi fra sistemi diversi

**Fonti:** F3, F9.

I percorsi di un progetto remoto si mostrano e si usano secondo il sistema di M, anche quando W ha un sistema diverso. I file trascinati, scelti o incollati su W arrivano a M come contenuto. Le azioni «apri in…» e «mostra nella cartella» o agiscono in modo sensato per chi guarda o sono fra le eccezioni di R-MI-06.

**Accettazione:** da Windows su un progetto del Mac: aprire, modificare e salvare un file in una sottocartella; menzionare un file con `@`; trascinare un'immagine dal desktop di Windows nel composer e vederla usata dall'agente.
**Errore da evitare:** percorsi con i separatori sbagliati; allegati che puntano a un file che su M non esiste.

## R-MI-09 — Sicurezza e controllo dell'accesso

**Fonti:** F9.

La funzione è spenta per default su ogni macchina. Un'istanza abbinata con pieno accesso equivale a una shell sulla macchina: l'abbinamento lo dice chiaramente. Ogni macchina elenca i dispositivi abbinati e li revoca singolarmente; la revoca interrompe subito il collegamento. Mentre un'altra istanza è collegata, la macchina controllata lo mostra, e ogni azione remota entra nel registro attività con il nome del dispositivo. L'abbinamento può concedere permessi per ambito (leggere, operare sugli agenti, terminale, scrivere file): l'elenco esatto degli ambiti va confermato.

**Accettazione:** revocare W da M mentre W ha un progetto aperto: il progetto diventa non raggiungibile su W e nessun comando successivo viene eseguito; il registro di M riporta le azioni di W.

## R-MI-10 — Versioni diverse di Studio

**Fonti:** F9.

Se le due versioni non sono compatibili il collegamento non si apre, e Studio dice quale macchina va aggiornata. Nessun funzionamento parziale. L'aggiornamento di M comandato da W è un'estensione possibile, non parte di questo requisito.

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

## Strade scartate

Confermate dall'utente il 2026-11-12 (F5):

| Strada | Motivo |
|---|---|
| Collab di omp | Una stanza per sessione, solo chat, relay non ospitabile in proprio; già scartata in `IDEAS.md` e nel Gate R44 |
| omp via SSH senza Studio | Tutto ciò che non è chat andrebbe riscritto sopra SSH; richiede una porta raggiungibile |
| Sincronizzazione continua dei file | Conflitti, file a metà, sessioni rovinate da due scrittori, percorsi non portabili |

## Domande aperte

- **Q1 — Uso a macchina spenta.** Risolta il 2026-11-12 (F11): nessuna replica; il progetto si mostra non raggiungibile e si possono solo registrare task in coda (R-MI-11, R-MI-12, R-MI-15).
- **Q2 — Punto d'incontro.** Libreria con relay pubblici già esistenti oppure servizio proprio su piattaforma gratuita. La scelta segue la prova tecnica del piano (MI00) e comprende chi pubblica il servizio predefinito.
- **Q3 — Ambiti dei permessi** di R-MI-09: elenco e valore predefinito.
- **Q4 — Interfaccia** di abbinamento, elenco macchine e badge: da progettare e approvare su anteprima.

---

Gli ID restano stabili. Una sostituzione conserva qui il requisito precedente, il successore e la data della conferma; una rimozione conserva motivazione e conferma dedicata dell'utente. Il piano operativo e le note di rilascio che toccano questi comportamenti devono indicare gli ID interessati. Le regole comuni sono in [AGENTS.md](../../AGENTS.md), sezione «Requisiti delle funzioni e tracciabilità».
