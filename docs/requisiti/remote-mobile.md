# Studio Remote mobile — registro dei requisiti

**Data dell'accordo:** 2026-11-01. **Decisione:** Gate R48 in [DECISIONS.md](../DECISIONS.md).
**Piano operativo:** «Piano Studio Remote mobile — Gate R48» in [PLAN.md](../PLAN.md).
**Anteprima approvata:** [remote-mobile-anteprima.html](remote-mobile-anteprima.html), struttura «B — Elenco espandibile», copia versionata del prototipo `proto/studio-remote-b-espandibile.html`. Dati e comandi dell'anteprima sono simulati; il tema chiaro serve solo alla revisione, l'app reale segue il tema di Studio.

Questo documento è la fonte di verità dei requisiti concordati. «Attivo» significa vincolante; implementazione e verifica sono indicate separatamente. Ogni verifica va registrata con data, scenario, risultato e riferimento alla prova. I riferimenti `anteprima: nomeFunzione` indicano le funzioni del file di anteprima che mostrano il comportamento atteso.

## Fonti e motivazione

L'utente non era convinto dell'interfaccia di Remote, «soprattutto da mobile». Dopo un confronto con Codex Remote, Claude Code, Cursor, GitHub Copilot, Replit e Happy, sono state provate tre strutture (A lineare, B espandibile, C spazio di progetto) e la B è stata approvata con iterazioni successive.

Citazioni dell'utente dalla discussione del 2026-11-01:

- **F1 — Scopo:** «Studio Remote è principalmente l'interfaccia dove controllo e termino il lavoro quando sono lontano dal computer o quando devo far partire un lavoro urgente».
- **F2 — Un progetto per riga:** «un progetto c'è una sola volta nell'elenco, che abbia una richiesta da intervenire, stia lavorando o sia fermo [...] quando sono dentro un progetto vedo la sessione attiva e posso volendo nel menù vedermi lo storico delle sessioni». Con più rami: «mi deve fare quel passaggio in più».
- **F3 — Questionario UX:** solo progetti aperti in Studio; ordine richieste → al lavoro → fermi; richiesta unica aperta direttamente «deve essere chiaro in che ramo mi ha messo»; con più rami e nessuna richiesta scelta esplicita del ramo; verifica tramite «solo le anteprime generate, non andare a vedere il codice specifico o file diff»; Git e pubblicazione si chiedono all'agente, con aggiornamento di Remote se il ramo si chiude; avvio urgente sia dal progetto sia globale; messaggi in coda per impostazione predefinita con reindirizzamento esplicito; passaggio rapido anteprima/chat; una macchina alla volta; ramo chiuso con esito leggibile; segnalazione di richieste altrui senza spostare la vista; progetto chiuso con vista conservata; configurazione sintetica nel composer; «Studio, ma più arioso e touch».
- **F4 — Mobile first:** «del messaggio non si legge nulla [...] DEVE ESSERE PENSATO MOBILE FIRST».
- **F5 — Struttura B:** «l'espansione dei rami della B mi piace»; «confermiamo B»; «Va bene x per chiudere chat, freccia per tornare indietro da anteprima»; nessuna barra di sezioni e nessuna vista Attività: «di sicuro non gli dedico più spazio».
- **F6 — Nuovo lavoro:** progetto facile da scegliere; «poter salvare il task in coda, non farlo partire per forza»; «impostazione del modello/ruolo». Sulla conversazione: «non ha molto senso che per continuare una chat mi chiede su quale ramo continuare ma su nuova chat non mi chiede su quale ramo».
- **F7 — Quote:** «mostrare rapidamente le quote d'utilizzo, sia come informazione generale alla macchina sia dettaglio del provider sui progetti al lavoro»; «vanno benissimo mostrate le barre dei provider in uso e premuto mostra tutti i provider configurati come fa il popover di studio».
- **F8 — Disposizione di Nuovo lavoro:** progetto e «nuovo worktree» al 50% sulla stessa riga, ruolo/modello al 100% sotto, con il livello di ragionamento «con icona a barre come col composer (senza testo)».
- **F9 — Selettore modello:** «riusare i componenti di studio ove possibile»; «anche remote adesso aveva un modo credo carino per mostrare e selezionare modello»; risultato «molto meglio, confermiamo questo».
- **F10 — Coda:** «vorrei poterli gestire quindi avviarne uno, modificarlo in tutte le sue impostazioni o cancellarlo [...] potrei sempre avviare un task su una nuova worktree». Scelte: coda dentro il progetto, modifica nello stesso pannello di Nuovo lavoro, impostazioni aggiuntive immagini e direttive, conferme risolte dal telefono.
- **F11 — Rimozioni:** confermate con domanda dedicata il 2026-11-01 (tabella «Cutover»).

Le fonti complete sono nella conversazione di progetto del 2026-11-01 e nel diario `docs/diario/2026-11.md`.

## Stato dei requisiti

| ID | Stato del requisito | Implementazione | Verifica |
|---|---|---|---|
| R-REM-01 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-02 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-03 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-04 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-05 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-06 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-07 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-08 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-09 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-10 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-11 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-12 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-13 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-14 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-15 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |
| R-REM-16 | Attivo, approvato il 2026-11-01 | Codice scritto il 2026-11-01 | Non verificato nell'app |

«Solo anteprima» significa che il comportamento è stato esercitato nel prototipo con dati simulati (vedi «Prove sull'anteprima»), non nell'app reale. «Codice scritto» significa che l'implementazione esiste ma, per scelta dell'utente del 2026-11-01 («non fare test»), non sono stati scritti test nuovi né fatte prove nel browser o sul telefono. Per la Nightly del 2026-11-02 sono passati i controlli di pubblicazione (`npm run check`, `npm test`, `npm run check:commands`, `cargo test`; in `relay/` `bun run check`, `bun run check:web`, `bun test`, `bun run build:web`): provano che il codice compila e non rompe le suite esistenti, non gli scenari di accettazione, che restano da eseguire.

### Prove sull'anteprima (2026-11-01)

Browser Chromium senza interfaccia, viewport 390×844 salvo dove indicato, file `proto/studio-remote-b-espandibile.html`, nessun errore JavaScript nei giri finali:

- area di lettura della chat 733 px (circa 29 righe di testo) a 390×844, 556 px a 375×667, nessuno scorrimento orizzontale a 320 px;
- apertura diretta del ramo con richiesta e risposta; scelta di un ramo; bozza e stato dell'anteprima conservati; messaggio in coda; storico in sola lettura; chiusura simulata del ramo con esito e «Vai a Principale»; affiancamento chat/anteprima a 1280 px;
- Nuovo lavoro: progetto e worktree 175/175 px a 390 px e 140/140 px a 320 px; spiegazione della destinazione per Principale libera e occupata; messa in coda con programmazione; avvio in nuovo worktree;
- ruolo `plan`, modello GPT-5, ragionamento Extra High (5 barre), ricerca «gem»; aggiornamento dei chip in Nuovo lavoro e in chat;
- quote: striscia con i soli provider in uso, foglio con tutti i provider e «Non in uso»;
- coda: modifica di testo, direttive, ruolo e immagini con salvataggio; programmazione alle 18:00; spostamento in cima; eliminazione con conferma; avvio con conferma degli agenti attivi e dei file locali; uscita del lavoro dalla coda.

### Mappa dell'implementazione

Contratto in `relay/src/protocol.ts` (funzioni `task_options`, `dispatch_confirm`, `quota_refresh`; comandi `new_session` e `create_lane` rimossi) e `src-tauri/src/remote/protocol.rs`.

| ID | Studio (macchina) | PWA (`relay/web/src/`) |
|---|---|---|
| R-REM-01 | — | `machine.svelte.ts`, `components/HomeView.svelte`, `components/MachinesSheet.svelte`, `projectHelpers.ts` (`getOtherMachinePendingRequests`) |
| R-REM-02 | `src/lib/remote/projection.svelte.ts` (ordine di `projectOrder.list`) | `projectHelpers.ts` (`sortProjects`, `getProjectMeta`), `components/ProjectRow.svelte` |
| R-REM-03 | `projection.ts` (corsie Lab) | `projectHelpers.ts` (`decideProjectOpenTarget`), `components/ProjectRow.svelte` |
| R-REM-04 | — | `components/chat/ChatView.svelte` (intestazione, menu ⋯), `navigation.svelte.ts`, `App.svelte` |
| R-REM-05 | `src/lib/remote/completion.svelte.ts` (subagenti e job) | `chat/ChatView.svelte` (richiamo e avviso), `chat/Transcript.svelte`, `chat/ToolGroup.svelte` |
| R-REM-06 | — | `chat/Composer.svelte`, `work/ConfigChips.svelte` |
| R-REM-07 | — | `preview.svelte.ts`, `chat/PreviewSurface.svelte`, `navigation.svelte.ts` |
| R-REM-08 | `+page.svelte` (`refreshQuota`), `projection.ts` (account) | `components/QuotaStrip.svelte`, `components/QuotaSheet.svelte`, `projectHelpers.ts` (`providerDisplayName`) |
| R-REM-09 | `src/lib/remote/taskCommands.ts` (opzioni e immagini), `laneConfigCommands.ts` (direttive), `commands.ts` (`create_task.start`), `+page.svelte` (`handleRunTask` con `destination`) | `work.svelte.ts`, `work.ts`, `components/work/WorkSheet.svelte` |
| R-REM-10 | `src/lib/lanes/dispatchConfirmations.svelte.ts`, `+page.svelte` (`respondDispatch`, dialoghi), `projection.ts` | `work.svelte.ts` (`syncConfirmation`, `respond`), `work/WorkSheet.svelte` |
| R-REM-11 | `projection.ts` (campi del task) | `components/work/QueueList.svelte`, `components/ProjectRow.svelte` |
| R-REM-12 | `taskCommands.ts` (`getRemoteTask`, `updateRemoteTask`), `commands.ts` | `work.svelte.ts` (`openTask`, `save`, `applySchedule`, `move`, `remove`), `work/WorkSheet.svelte` |
| R-REM-13 | `projection.ts` (`RemoteProject.path`) | `chat/ChatView.svelte` (ultimo stato visto, «Vai a Principale», «Riapri») |
| R-REM-14 | — | `App.svelte`, `chat/ChatView.svelte`, `chat/PreviewSurface.svelte` |
| R-REM-15 | — | `components/ProjectHistorySheet.svelte`, `chat/HistoryChatView.svelte`, `navigation.svelte.ts` |
| R-REM-16 | — | `notificationRouting.ts`, `components/MachinesSheet.svelte`, `i18n.ts` |

Componenti rimossi con il cutover: `Dashboard`, `Header`, `HostSection`, `ProjectCard`, `QuotaCard`, `TaskRow`, `TaskDetailModal`, `NewTaskModal`, la cartella `components/inbox/`, `chat/ComposerTray`, `chat/ComposerStatusLine`, `fleet.ts`, `projectSort.ts`; lato Studio `src/lib/remote/worktreeCommands.ts` e `newRemoteSession`.

## Cutover dalla Remote attuale

Le funzioni non elencate come rimosse restano, spostate dove indicato. Le rimozioni sono state confermate dall'utente con domanda dedicata il 2026-11-01 (F11).

| Funzione attuale | Componenti attuali | Esito | Destinazione / motivo |
|---|---|---|---|
| Abbinamento con codice o token | `PairingView` | Mantenuto | Invariato |
| Impostazioni: dispositivi, codici, notifiche, lingua, disconnessione | `SettingsSheet`, `CodeModal`, `PushNotificationToggle` | Spostato | Accesso dal foglio Macchine della pagina iniziale (R-REM-16) |
| Notifiche push e apertura dalla notifica | `notificationRouting.ts` | Mantenuto, adattato | La notifica apre progetto e ramo nella nuova navigazione (R-REM-16) |
| Avviso offline e riconnessione | `OfflineBanner`, `backoff.ts` | Mantenuto | Invariato |
| Lingue IT/EN, tema di Studio, correzioni viewport iOS | `i18n.ts`, `theme.ts`, `viewport.ts` | Mantenuto | Tutti i nuovi testi in entrambe le lingue |
| Chat dal vivo, ragionamento, strumenti, diff, allegati, comandi `/`, Stop, invio in coda o reindirizzamento | `ChatView`, `Transcript`, `ToolGroup`, `AssistantText`, `Composer`, `SuggestTray`, `AttachButton` | Mantenuto, adattato | Nuova cornice della chat (R-REM-04…R-REM-06) |
| Ruolo, modello, ragionamento | `Composer` con `RoleMenu`, `ModelPickerList`, `ReasoningSlider`, `ThinkingMeter` | Mantenuto | Riusato in chat e in Nuovo lavoro (R-REM-06, R-REM-09) |
| Domande, conferme e quote esaurite | `AttentionCard` | Mantenuto | Nella chat, con richiamo «Domanda in attesa» (R-REM-05) |
| Contesto e compattazione | `ContextControl`, `CompactionRow` | Spostato | Menu `⋯` della chat; la riga di compattazione resta nel transcript (R-REM-04) |
| Anteprime di diagrammi, SVG e prototipi | `ArtifactCard`, `PreviewSurface`, `preview.svelte.ts` | Mantenuto, adattato | Schermo intero con ‹ sul telefono, affiancata su schermo largo (R-REM-07) |
| Storico in sola lettura | `HistoryChatView` | Spostato | Dentro il progetto: espansione e menu `⋯` (R-REM-15) |
| Coda: elenco, modifica, nuovo task | `TaskRow`, `TaskDetailModal`, `NewTaskModal` | Sostituito | Coda nel progetto e pannello Nuovo lavoro / Lavoro in coda (R-REM-11, R-REM-12) |
| Nuova chat su progetto con destinazione | `NewChatModal` | Sostituito | Nuovo lavoro con regole di avvio di Studio (R-REM-09) |
| Quote | `QuotaCard`, `HostSection` | Spostato | Striscia e foglio quote (R-REM-08) |
| Apri o crea progetto | `ProjectSheet` | Spostato | Foglio Macchine (R-REM-16) |
| Corsie Lab nell'elenco della macchina | `ProjectCard` | Spostato | Rami del progetto nell'espansione (R-REM-03) |
| **Inbox unificata** multi-macchina con raggruppamenti e filtro | `InboxView`, `SessionRow`, `MiniMachine` | **Rimosso** (F11) | Sostituita da elenco progetti di una macchina alla volta (R-REM-01, R-REM-02) |
| **Schede Inbox / Cronologia / Macchine** | `Dashboard` | **Rimosso** (F11) | Una sola pagina iniziale |
| **Cronologia globale** | `HistoryView` come scheda | **Rimosso** (F11) | Storico per progetto (R-REM-15) |
| **Riepilogo flotta su schermo largo** | `FleetOverview` | **Rimosso** (F11) | Stato vuoto «Scegli un progetto»; quote nella striscia |
| **Approva/Rifiuta dalla riga** | `SessionRow` | **Rimosso** (F11) | Risposta nella chat; con una richiesta il progetto apre la chat del ramo |
| **Dettagli operativi** (avanzamento, subagenti, job, coda) | `OperationalDetails` | **Rimosso** (F11) | Subagenti e job nella riga compressa dei passaggi (R-REM-05); coda nel progetto (R-REM-11) |
| **«Continua corsia» e «Nuova chat su Principale»** in Nuova chat | `NewChatModal` | **Rimosso** (F11) | Continuare = scrivere nella chat del progetto (R-REM-09) |
| **Vista Macchine** con schede progetto | `HostSection`, `ProjectCard`, `QuotaCard` | **Rimosso** (F11) | Contenuti ridistribuiti come indicato sopra |
| **Nuova sessione nel ramo** | `ComposerTray` | **Rimosso** (F11) | Nessuna sostituzione |

## R-REM-01 — Una macchina alla volta

**Fonti:** F1, F3.

La pagina iniziale mostra una sola macchina, scelta da un selettore. Se un'altra macchina ha richieste in attesa, un'indicazione accanto al selettore lo dice («● 1 richiesta su Studio Windows») e porta al foglio Macchine; la vista non cambia da sola. Il foglio Macchine elenca le macchine con progetti aperti e richieste, e contiene anche apertura/creazione di progetti e impostazioni (R-REM-16). Anteprima: `homeHTML`, azione `machines`.

**Accettazione:** con due macchine abbinate e una richiesta sulla seconda, la prima resta visibile e l'indicazione porta a scegliere la seconda; la scelta mostra solo i suoi progetti.
**Errore da evitare:** mescolare progetti di più macchine nello stesso elenco.

## R-REM-02 — Elenco dei progetti aperti, uno per riga

**Fonti:** F2, F3, F7.

L'elenco contiene solo i progetti aperti in Studio sulla macchina scelta, ciascuno una sola volta indipendentemente da rami e sessioni. Ordine: prima i progetti con una richiesta, poi quelli al lavoro, poi quelli fermi; dentro ogni gruppo l'ordine dei progetti di Studio. Ogni riga mostra pallino di stato, nome e una riga «stato · contesto», con il ramo della richiesta quando i rami sono più d'uno, «N rami al lavoro», «N in coda» e le percentuali dei provider usati dai rami attivi. Le sessioni storiche non compaiono mai come righe. Anteprima: `rowHTML`, `projectMeta`, `ordered`.

**Accettazione:** un progetto con due rami al lavoro e una domanda occupa una sola riga in cima; un progetto fermo con due lavori in coda mostra «2 in coda».
**Errore da evitare:** righe duplicate per sessioni o rami dello stesso progetto.

## R-REM-03 — Apertura del progetto ed espansione

**Fonti:** F2, F3, F5, F10.

Toccando un progetto:
1. con una sola richiesta si apre la chat del ramo interessato, il cui nome è visibile nell'intestazione;
2. con un solo ramo e coda vuota si apre la sua chat;
3. altrimenti il progetto si espande nell'elenco, sotto la riga: rami con stato e sintesi, coda (R-REM-11), azioni «Nuovo lavoro» e «Storico». Un secondo tocco richiude.

I rami comprendono Principale, i worktree e le corsie Lab. Anteprima: `openProject`, `expandHTML`, `branchListHTML`.

**Accettazione:** i tre casi su progetti distinti; con due richieste in due rami l'espansione mostra entrambi e nessuno si apre automaticamente.

## R-REM-04 — Chat mobile first

**Fonti:** F3, F4, F5.

Sul telefono la chat copre l'elenco; la × in alto a sinistra la chiude e riporta l'elenco con l'espansione com'era. L'intestazione occupa una sola riga: ×, nome del progetto con il ramo sotto (tocco: selettore dei rami se più d'uno), `⋯`. Il menu `⋯` contiene Nuovo lavoro, Cambia ramo, Storico delle sessioni, Quote di utilizzo, Contesto e compattazione. Nessuna etichetta fissa aggiuntiva tra intestazione e composer.

**Accettazione:** a 390×844 l'area del transcript è almeno 700 px; a 375×667 almeno 520 px; nessuno scorrimento orizzontale a 320 px. Con la tastiera aperta il composer resta visibile sopra la tastiera su iPhone (verifica sul dispositivo).
**Errore da evitare:** intestazione su due righe, stato/modello/macchina fissi sopra il composer, sopratitoli.

## R-REM-05 — Contenuto della conversazione

**Fonti:** F3, F4, F11.

Le risposte dell'agente si leggono per intero come testo; i messaggi dell'utente in un fumetto. Strumenti, ragionamento e passaggi sono raccolti in una riga richiudibile («N passaggi»), che riporta anche subagenti e job in background quando presenti («· 2 subagenti al lavoro») e ne mostra il dettaglio quando si apre. Domande e conferme dell'agente compaiono nella chat; se sono fuori vista, un richiamo galleggiante «↑/↓ Domanda in attesa» le raggiunge. Una richiesta da un altro progetto appare come avviso sovrapposto con «Apri» e ×, senza cambiare vista né perdere la bozza. Anteprima: `transcriptHTML`, `watchAsk`, `noticeHTML`.

**Accettazione:** con un subagente attivo la riga dei passaggi lo indica; con la domanda fuori vista il richiamo la porta in vista; l'arrivo di una richiesta altrove non sposta lo scorrimento né la bozza.

## R-REM-06 — Composer compatto

**Fonti:** F3, F4, F9.

A riposo il composer occupa una riga: allegati, campo di testo, invio. Al tocco del campo compaiono il chip ruolo (pallino colorato e `id`, apre `RoleMenu`), il chip modello (logo del provider, nome e `ThinkingMeter` senza testo, apre il pannello mobile di Remote con `ModelPickerList`, `ReasoningSlider` e ricerca in basso) e, se l'agente lavora, «In coda | Reindirizza» con In coda predefinito. Il segnaposto dice se il messaggio parte a fine turno. Restano comandi `/`, allegati e Stop. Anteprima: `composerHTML`, `roleChip`, `modelChip`, `roleSheetHTML`, `modelSheetHTML`.

**Accettazione:** a riposo il composer è alto al massimo 64 px; il cambio di ruolo, modello e ragionamento si riflette sui chip e sulla corsia; un messaggio inviato durante il lavoro risulta «In coda».
**Errore da evitare:** un secondo selettore di modello diverso da quello di Remote/Studio.

## R-REM-07 — Anteprime generate

**Fonti:** F3, F5.

Gli artefatti generati compaiono in chat come scheda. Sul telefono l'anteprima occupa lo schermo con ‹ per tornare alla chat; su schermo largo (≥ 1024 px) si affianca alla chat e può allargarsi. Bozza, scorrimento e stato dell'anteprima si conservano tornando indietro. Il ritorno indietro del sistema (gesto o tasto) chiude prima l'anteprima, poi la chat. Anteprima: `previewHTML`, `chatScreen`.

**Accettazione:** scegliere uno stato nell'anteprima, tornare alla chat, riaprire: stato e bozza intatti; a 1280 px chat e anteprima affiancate senza scorrimento orizzontale.

## R-REM-08 — Quote di utilizzo

**Fonti:** F7.

Sotto il selettore della macchina una striscia mostra, per ogni provider usato dai rami attivi, nome, percentuale e finestra più consumata con una barra; senza provider in uso mostra «Nessun provider in uso · Quote». Il tocco apre il foglio con tutti i provider configurati, come il popover di Studio: account, finestre con barra, percentuale e azzeramento, progetti che li usano o «Non in uso», pulsante Aggiorna. Le righe dei progetti attivi riportano la percentuale dei loro provider. Le soglie colore sono quelle di Studio. Anteprima: `quotaHeader`, `quotaDetailHTML`, `providersInUse`.

**Accettazione:** con Claude e ChatGPT in uso e Gemini configurato ma inattivo, la striscia mostra due provider e il foglio tre, Gemini come «Non in uso».

## R-REM-09 — Nuovo lavoro

**Fonti:** F1, F6, F8, F9.

Il pannello parte dal testo. Sotto: barra con allegati immagine e «Direttive · N»; prima riga «Progetto ▾» e «Nuovo worktree» al 50% ciascuno; seconda riga a tutta larghezza con chip ruolo e chip modello (R-REM-06). Una riga spiega la destinazione: «Avvia ora parte in Principale», «Principale è al lavoro: Avvia ora apre un nuovo worktree», «Avvia ora apre un nuovo worktree». Azioni: «Metti in coda» (poi: quando lo avvio io, al reset della quota con orario stimato, a un orario) e «Avvia ora». Le regole sono quelle della coda di Studio (`src/lib/lanes/queueDispatch.ts`): Principale se libera, altrimenti un worktree creato apposta; mai dentro un ramo già aperto. Continuare una conversazione esistente si fa scrivendo nella sua chat. Accessibile dalla pagina iniziale, dall'espansione del progetto e dal menu della chat. Anteprima: `nwRender`, `nwStartsInBranch`, `nwLaunch`.

**Accettazione:** con Principale libera il lavoro parte in Principale; con Principale occupata o «Nuovo worktree» attivo parte in un worktree nuovo; «Metti in coda» al reset salva il lavoro con ruolo, modello, ragionamento, direttive e immagini scelti.
**Errore da evitare:** chiedere la conversazione di destinazione; ignorare ruolo/modello nei lavori in coda.

## R-REM-10 — Conferme di avvio dal telefono

**Fonti:** F10.

Quando l'avvio di un nuovo worktree richiede una conferma in Studio, Remote mostra la stessa domanda e invia la risposta:
- soglia degli agenti attivi: elenco dei rami attivi con modello, «Annulla» e «Avvia comunque»;
- file locali non versionati da copiare nel worktree: elenco selezionabile, «Non copiare nulla» e «Copia e avvia»; la scelta viene ricordata per il progetto come in Studio.

Una conferma data su una superficie chiude la domanda sull'altra. Anteprima: `nwRender` viste `concurrency` e `consent`.

**Accettazione:** con quattro agenti attivi e file locali mai approvati, l'avvio in worktree da Remote mostra le due conferme in sequenza e completa l'avvio senza toccare il computer; annullando non viene creato alcun worktree.

## R-REM-11 — Coda dentro il progetto

**Fonti:** F10.

Nell'espansione del progetto la sezione «Coda · N» elenca i lavori in ordine. Ogni lavoro mostra titolo, «Prossimo» sul primo, ruolo, modello con ragionamento, programmazione, numero di direttive e di immagini. Un progetto a ramo unico con lavori in coda si espande invece di aprire la chat. Il tocco su un lavoro apre il pannello di modifica (R-REM-12). Anteprima: `taskRowHTML`, `expandHTML`.

**Accettazione:** su un progetto fermo con due lavori in coda il tocco espande il progetto e mostra la coda nell'ordine di Studio.

## R-REM-12 — Modifica, avvio, riordino ed eliminazione dei lavori in coda

**Fonti:** F10.

Il lavoro si modifica nello stesso pannello di Nuovo lavoro, intitolato «Lavoro in coda», con progetto fisso. Modificabili: testo completo, immagini, direttive, ruolo, modello, ragionamento. «Nuovo worktree» vale per l'avvio. Azioni «Salva» e «Avvia ora» (R-REM-09, R-REM-10). Il menu `⋯` del pannello offre Programmazione (con «Nessuna programmazione»), Sposta su, Sposta giù ed Elimina lavoro con conferma. Le impostazioni non gestite da Remote — prewalk, solo avvio manuale, contesto editor — restano invariate al salvataggio. Dopo l'avvio il lavoro esce dalla coda e si apre la chat del ramo, come in Studio. Anteprima: `nwRender` (`n.edit`, viste `menu`, `delete`, `queue`), azioni `taskSave`, `taskMove`, `taskDelete`.

**Accettazione:** su un lavoro con testo oltre 4.000 caratteri, prewalk attivo e due immagini: cambiare ruolo e una direttiva, salvare; in Studio testo integro, prewalk ancora attivo, immagini conservate.
**Errore da evitare:** troncare il testo o azzerare opzioni non mostrate.

## R-REM-13 — Chiusure di rami e progetti

**Fonti:** F3.

Se l'agente integra e chiude il ramo aperto, il ramo sparisce dall'elenco ma la chat resta leggibile con l'esito finale; al posto del composer «Ramo chiuso · sola lettura» e «Vai a Principale». Se il progetto viene chiuso in Studio, esce dall'elenco; la chat aperta resta visibile con «Progetto chiuso su Studio», invio disabilitato e «Riapri». Anteprima: `composerHTML` (rami `S.closed`, `p.closed`).

**Accettazione:** chiudere il ramo da Studio mentre la chat è aperta su Remote: esito leggibile e passaggio a Principale; chiudere il progetto: riga sparita, chat conservata, invio disabilitato.

## R-REM-14 — Schermi larghi

**Fonti:** F3, F5.

Da 1024 px l'elenco dei progetti resta a sinistra e la chat a destra; senza chat, «Scegli un progetto per aprire la conversazione». L'anteprima si affianca alla chat (R-REM-07). Anteprima: `view`, classi `b-layout`, `wide-split`.

**Accettazione:** a 1280 px elenco, chat e anteprima visibili insieme, nessuno scorrimento orizzontale.

## R-REM-15 — Storico per progetto

**Fonti:** F2, F11.

Lo storico delle sessioni di un progetto si apre da «Storico» nell'espansione o dal menu `⋯` della chat, in sola lettura, con ricerca e caricamento delle pagine precedenti, senza cambiare la sessione attiva. Anteprima: azione `history`.

**Accettazione:** aprire una sessione storica, scorrere indietro, tornare: la sessione attiva del ramo è invariata.

## R-REM-16 — Funzioni trasversali mantenute

**Fonti:** F11.

Restano: abbinamento; impostazioni (dispositivi, codici, notifiche push, lingua, disconnessione) dal foglio Macchine; apertura e creazione di progetti dal foglio Macchine; notifiche che aprono il progetto e il ramo interessati; avviso offline e riconnessione; testi IT/EN; tema di Studio chiaro o scuro; correzioni di viewport e aree sicure per iPhone; funzioni negoziate per macchina, per cui le macchine con Studio precedente mostrano solo i controlli che supportano.

**Accettazione:** una notifica di domanda apre la chat del ramo giusto; una macchina che non dichiara le nuove funzioni non mostra controlli che non può eseguire; tutti i testi nuovi hanno la traduzione inglese.

---

Gli ID restano stabili. Una sostituzione conserva qui il requisito precedente, il successore e la data della conferma; una rimozione conserva motivazione e conferma dedicata dell'utente. Il piano operativo e le note di rilascio che toccano questi comportamenti devono indicare gli ID interessati. Le regole comuni sono in [AGENTS.md](../../AGENTS.md), sezione «Requisiti delle funzioni e tracciabilità».
