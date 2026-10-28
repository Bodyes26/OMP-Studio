# Laboratorio — registro dei requisiti

**Data dell'accordo:** 2026-10-28. **Decisione:** Gate R47 in [DECISIONS.md](../DECISIONS.md).
**Piano operativo:** «Piano Laboratorio con brief — Gate R47» in [PLAN.md](../PLAN.md).

Questo documento è la fonte di verità dei requisiti concordati. «Attivo» significa vincolante; implementazione e verifica sono indicate separatamente. Ogni verifica va registrata con data, scenario, risultato e riferimento alla prova. Il codice del Gate R47 è implementato per la consegna Nightly, ma gli scenari completi sotto riportati non sono stati eseguiti.

## Fonti e motivazione

Il caso che ha riaperto la discussione è il prototipo ChronoDash su GestioneFlotta, creato il 2026-10-27 con la richiesta «voglio rivedere la grafica del calendario della dashboard»: l'agente ha prodotto un'agenda personale anziché un calendario pertinente alla gestione della flotta.

Citazioni dell'utente dalla discussione del 2026-10-28:

- **F1 — Autonomia dal principale:** «se io apro un progetto che magari ho già e non ho mai aperto in studio [...] mi aspetto che [...] l'agente del prototipo esplora il progetto e recupera tutto il contesto necessario».
- **F2 — Sequenza:** «come primo step fa esplorazione del progetto in riferimento alla richiesta, poi prepara il brief anche facendo piccola intervista all'utente».
- **F3 — Enforcement:** «sì va bene imposto da Studio».
- **F4 — Approvazione:** «come fosse una sorta di Plan prima di operare».
- **F5 — Esecuzione:** «sì ci sta solo le prime due», riferito a «Compatta e continua» e «Continua così com'è».
- **F6 — Ricette:** «va bene», in risposta alla proposta delle quattro ricette e di un sottoagente per variante.
- **F7 — Screenshot:** «va bene solo A», riferito all'allegato manuale, senza apertura dell'app reale o cattura automatica dal Browser di Studio.
- **F8 — Registro:** «va bene», in risposta al registro R-LAB-01…08, alle regole in AGENTS.md e ai documenti del Gate R47.
- **F9 — Consegna Nightly senza suite di test:** «procedi con l'implementazione completa» e «Non fare test [...] Quando hai finito il codice mi fai il flow di pubblicazione nightly». Questa autorizzazione riguarda la consegna del codice e la pubblicazione, non attesta il superamento degli scenari di accettazione.

Le fonti complete sono nella conversazione di progetto del 2026-10-28. Le citazioni abbreviate sopra conservano il significato della decisione; i dettagli verificabili sono definiti nei requisiti seguenti.

## Stato dei requisiti

**Modalità di consegna richiesta il 2026-10-28:** implementazione e Nightly senza esecuzione di suite di test. Compilazione e osservazioni limitate del runtime vanno riportate per ciò che dimostrano; gli scenari non eseguiti restano tali. Nessuna spunta tecnica può essere interpretata come approvazione di un prototipo o collaudo funzionale completo.

| ID | Stato del requisito | Implementazione | Verifica |
|---|---|---|---|
| R-LAB-01 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-02 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-03 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-04 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-05 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-06 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-07 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |
| R-LAB-08 | Attivo, approvato il 2026-10-28 | Implementato | Scenario completo non eseguito |

### Mappa dell'implementazione

- **R-LAB-01, R-LAB-04, R-LAB-05, R-LAB-06, R-LAB-08:** ricognizione, intervista, ricette e prompt degli autori in `extensions/studio-plan.ts`; configurazione e percorso ospite in `src-tauri/src/rpc/mod.rs`; contesto delle richieste in `src/lib/agent/session.svelte.ts`.
- **R-LAB-02:** approvazione e salvataggio atomico in `studio-plan.ts`, guardia condivisa in `studio-lab.ts`, revisione esistente in `src/lib/agent/planController.svelte.ts` e componenti `Plan*`. Marker protetto `.lab/.brief-approved.json`, legato a prototipo, workspace e progetto ospite; la sola presenza del brief non sblocca le scritture.
- **R-LAB-03:** modalità Lab e compattazione in `src/lib/agent/planMode.ts`, `planController.svelte.ts` e `PlanApprovalCard.svelte`.
- **R-LAB-02, R-LAB-07, R-LAB-08:** revisioni, snapshot e pulizia dei marker in `src-tauri/src/lab/`; consegna coerente con la revisione in `src/lib/lanes/agentLanes.svelte.ts` e `agentLaneRoutes.ts`.

**Cutover dei prototipi preesistenti:** sorgenti e revisioni restano intatti. Senza marker di approvazione valido la prossima richiesta entra nel Piano obbligatorio; il brief ricostruisce il contesto anche se esiste già codice. Duplicazione, ripristino di revisione e cambio di progetto ospite non concedono automaticamente l'approvazione.

### Osservazioni limitate del 2026-10-28

- **Runtime reale `omp/18.13.2`, sessione RPC Lab effimera:** caricamento delle estensioni riuscito; stato pubblicato `enabled: true`, `kind: lab`, `briefApproved: false`. `/studio-plan off` produce l'avviso di approvazione obbligatoria e lascia il Piano attivo. Nessuna richiesta al modello e nessuna costruzione di prototipo in questa osservazione.
- **Componenti reali in Vite:** resa del documento a sei sezioni e della scheda di approvazione con sole opzioni `compact` e `keep`, archivio obbligatorio e selezione `compact` predefinita. Il clic seleziona `keep`; la freccia sinistra ritorna a `compact`. Dati dimostrativi e collegamento nativo simulato solo per la resa: non è una prova end-to-end della generazione o del salvataggio su disco.
- **Limite:** non eseguite suite di test né gli scenari completi GestioneFlotta, autori delle varianti, ripristino e approvazione dopo riavvio. La compilazione dell'installer appartiene alla pipeline Nightly e non sostituisce queste prove.

## R-LAB-01 — Ricognizione del progetto da parte dell'agente Lab

**Fonti:** F1, F2, F8.

L'agente del prototipo acquisisce direttamente il contesto necessario dal working tree corrente del progetto, comprese le modifiche non committate pertinenti. Funziona senza storico di chat e senza intervento dell'agente principale.

La ricognizione è mirata alla richiesta: istruzioni applicabili, DESIGN.md e PRODUCT.md dove presenti, superficie citata, sorgenti, stili, forma dei dati e terminologia. Per Web Forms considera anche code-behind e definizioni di stored procedure disponibili nei sorgenti. Non richiede accesso al database. I documenti assenti non vengono inventati: si ricavano i fatti dai sorgenti e si dichiarano le lacune. Il progetto resta in sola lettura e i file sensibili restano esclusi. Gli scout possono aiutare nell'esplorazione.

Il brief è memoria di lavoro dello stesso agente, non uno snapshot congelato del progetto. L'agente lo aggiorna quando cambia lo scopo e rilegge i sorgenti pertinenti quando serve; non riceve un brief precalcolato dal principale.

**Accettazione:** aprire in Studio un progetto mai usato prima, senza chat precedente, e creare un prototipo con «voglio rivedere la grafica del calendario della dashboard». Per GestioneFlotta il brief identifica i file effettivi della dashboard, il calendario delle prenotazioni dei veicoli, le funzioni e i termini riscontrati nei sorgenti. Il risultato non è un'agenda personale. La prova usa solo letture del progetto e dati simulati nel prototipo.

**Errore da evitare:** se non trova la superficie, l'agente espone il dubbio nell'intervista; non la sostituisce con una pagina generica.

## R-LAB-02 — Brief come Piano approvato, con guardia reale

**Fonti:** F2, F3, F4, F8.

La prima richiesta di un nuovo prototipo entra automaticamente nella modalità Piano. Si riusano l'estensione e la revisione a sezioni del Piano di Studio, adattandole al Lab: non si introduce una seconda scheda di approvazione equivalente.

Sezioni del brief:

1. Superficie: pagina/componente e file sorgenti di riferimento.
2. Dominio e terminologia.
3. Dati: forma reale e simulazioni previste.
4. Vincoli di design: token, convenzioni e grado di fedeltà scelto.
5. Varianti/esplorazione: obiettivo, operazioni, cosa resta fisso e cosa può cambiare.
6. Assunzioni: lacune e scelte non deducibili dai sorgenti.

L'utente può commentare le sezioni, chiedere modifiche e approvare. La presenza di un file brief o una risposta ad `ask` non equivale all'approvazione del Piano. Prima di essa Studio blocca le modifiche al prototipo, anche in `package.json`, HTML, CSS e asset, non soltanto in `src/`. Restano possibili le scritture necessarie al documento di pianificazione nei percorsi autorizzati. La guardia vale anche per i sottoagenti: un autore delegato non aggira il blocco.

All'approvazione Studio salva `.lab/brief.md` nel workspace e sblocca la costruzione. Il brief deve essere incluso nelle revisioni Git interne: non basta scriverlo sotto `.lab/`, attualmente ignorata dal template. Gli aggiornamenti successivi del brief sono segnalati e versionati senza imporre di nuovo il blocco iniziale; l'utente può chiedere esplicitamente un nuovo Piano.

**Accettazione:** prima dell'approvazione tentare scritture in `src/`, `package.json` e `index.html`, anche tramite sottoagente: vengono negate. Chiedere una correzione al brief non sblocca nulla. Approvare permette la costruzione; la revisione interna contiene il brief approvato. Chiudere e riaprire a revisione pendente non concede implicitamente l'approvazione.

## R-LAB-03 — Due sole strade dopo l'approvazione

**Fonti:** F5, F8.

La revisione del Piano nel Lab offre solo:

- **Compatta e continua**, preselezionata: conserva brief e informazioni utili dell'esplorazione nella stessa sessione, eliminando il dettaglio grezzo non necessario.
- **Continua così com'è:** conserva il contesto integrale della stessa sessione.

Non offre nuova sessione o nuova corsia. La scelta non cambia il workspace né interrompe altre corsie.

**Accettazione:** approvare una volta per ciascuna strada e costruire il prototipo nella stessa sessione e nello stesso workspace. Dopo compattazione restano disponibili il brief approvato e i riferimenti necessari ai dati e alla superficie; con l'altra strada la cronologia resta integra. Nessuna delle due crea una corsia.

## R-LAB-04 — Intervista adattiva e screenshot manuale

**Fonti:** F2, F7, F8.

L'agente usa `ask` per chiarire soltanto decisioni che cambiano il risultato: superficie ambigua, operazioni da esplorare, fedeltà al design, ricetta e varianti. Le risposte deducibili dal progetto si cercano nei sorgenti. Una richiesta precisa evita domande ridondanti ma passa comunque dall'approvazione del Piano.

Per una superficie visiva senza immagine allegata, l'agente chiede uno screenshot come riferimento. L'utente può incollarlo o trascinarlo nel composer; può anche proseguire senza. In tal caso il brief dichiara che la pagina reale non è stata osservata visivamente.

**Accettazione:** una richiesta ambigua produce domande pertinenti dopo la ricognizione; una richiesta completa non ripete domande già risolte. Allegare uno screenshot lo rende disponibile all'agente; rinunciarvi consente comunque di approvare il brief e costruire sui sorgenti, senza dichiarare una verifica visiva dell'app reale.

## R-LAB-05 — Quattro ricette testuali

**Fonti:** F6, F8.

Studio fornisce ricette come istruzioni, non un catalogo di componenti già scritti. L'agente propone la ricetta nell'intervista; se la richiesta la determina già, evita una domanda duplicata. Ricetta e fedeltà al design vengono registrate nel brief e approvate con il Piano.

| Ricetta | Contratto |
|---|---|
| Fedele | Riusa token e convenzioni del progetto, cambia la superficie richiesta e rende riconoscibili le differenze rispetto all'esistente. |
| Varianti divergenti | Confronta 3–5 alternative con dati e funzioni comuni e assi di differenziazione dichiarati; vedi R-LAB-06. |
| Flusso | Rende navigabili passi e stati pertinenti, inclusi vuoto, errore, caricamento e successo, con dati coerenti fra i passi. |
| Libera | Esplora senza vincolo del design system esistente; i fatti di prodotto e i vincoli funzionali dichiarati nel brief restano validi. |

Le varianti divergenti possono restare fedeli ai token del progetto: la ricetta e il grado di libertà visiva non sono la stessa scelta.

**Accettazione:** il brief registra la ricetta scelta. Una prova per ricetta esercita il relativo contratto: confronto con la superficie per Fedele; alternative per Varianti divergenti; navigazione e stati per Flusso; libertà visiva senza perdita dell'obiettivo per Libera.

## R-LAB-06 — Autori distinti e confronto reale delle varianti

**Fonti:** F6, F8.

Con Varianti divergenti, un sottoagente distinto costruisce ogni variante. L'agente Lab definisce prima i dati simulati e le funzioni comuni, assegna gli assi di differenziazione e separa i file degli autori. I dati condivisi rimangono in una fonte comune; l'orchestratore integra e verifica. Tutti gli autori ereditano i confini di lettura e scrittura del Lab e lo stato di approvazione.

Ogni variante ha un nome e una motivazione. Un selettore visibile permette il confronto sugli stessi dati. Differenze puramente cromatiche non soddisfano un brief che richiede layout o interazioni differenti.

**Accettazione:** chiedere tre alternative del calendario con assi dichiarati, per esempio densità, gerarchia e interazione. La traccia mostra tre autori distinti; il selettore apre tutte le alternative; prenotazioni e veicoli simulati coincidono fra le viste e le differenze richieste sono esercitabili. Un tentativo delegato di scrivere nel progetto ospite resta negato.

## R-LAB-07 — Identità del progetto comunicata correttamente

**Fonti:** F1, F8; difetto emerso nell'indagine del 2026-10-28.

Il prompt comunica il percorso assoluto reale del progetto ospite, distinguendolo dal workspace del prototipo. Non contiene `$OMP_LAB_PROJECT_PATH` letterale né altri segnaposto di ambiente irrisolti. Preflight e contesto editor risolvono i riferimenti al progetto ospite, senza confonderlo con lo scaffold del prototipo; le modifiche restano confinate nel workspace.

**Accettazione:** aprire un progetto in un percorso con spazi e inviare una richiesta con un riferimento a un suo file o testo distintivo. L'agente riceve il percorso reale e legge il file corretto; il riferimento non si perde perché assente nello scaffold. Una verifica mirata rifiuta il prompt con il segnaposto irrisolto. Questa verifica tecnica integra, ma non sostituisce, lo scenario R-LAB-01.

## R-LAB-08 — Bozze libere senza progetto ospite

**Fonti:** F8.

Una bozza libera non finge di avere un progetto: omette la ricognizione del repository e costruisce il brief dall'intervista e dagli eventuali riferimenti allegati. Conserva approvazione obbligatoria, ricette, confini di scrittura e le due strade di esecuzione del Lab. Un progetto associato ma privo di storico non è una bozza libera: vale R-LAB-01.

**Accettazione:** aprire una bozza senza progetto, specificare utenti, obiettivo e interazioni e completare l'intervista. Nessuna ricerca di un repository inesistente; la costruzione resta bloccata fino all'approvazione e parte usando il brief concordato.

## Esclusioni approvate

- Il Lab non apre, autentica o aziona l'applicazione reale del progetto. Il browser resta confinato all'anteprima; gli screenshot della pagina reale arrivano soltanto dall'utente. Nessuna cattura automatica dal Browser della Principale, nemmeno come idea da parcheggiare in questo lavoro.
- Nessun database o backend reale del progetto viene contattato; i dati del prototipo sono simulati.
- Nessun brief preparato dall'agente principale, snapshot congelato o storico chat obbligatorio.
- Nessun editor di ricette per progetto o globale concordato in questo intervento.

## Tracciabilità dei cambiamenti

Gli ID restano stabili. Una sostituzione conserva qui il requisito precedente, il successore e la data della conferma; una rimozione conserva motivazione e conferma dedicata dell'utente. Il piano operativo e le note di rilascio che toccano questi comportamenti devono indicare gli ID interessati. Le regole comuni sono in [AGENTS.md](../../AGENTS.md), sezione «Requisiti delle funzioni e tracciabilità».
