# Decisioni Architetturali e Gate

Qui documentiamo gli esiti dei "gate" previsti dal piano di lavoro: scelte bloccanti su cui dovevamo avere certezza pratica prima di costruire.

---

## Gate R1: Finestra senza decorazioni vs Barra nativa

**Data:** 2026-07-29  
**Esito:** FALLITO  
**Decisione:** Usare `"decorations": true` e mantenere la barra nativa di Windows.

**Motivazione:**  
Durante la Fase 1 abbiamo testato la configurazione `"decorations": false` combinata con le API manuali (`getCurrentWindow().startDragging()` / `minimize()` / `toggleMaximize()`). Come documentato nell'issue `tauri #8519`, l'integrazione su Windows 11 manca di comportamenti nativi fondamentali quando le decorazioni vengono nascoste a livello di OS:
1. Lo snap di Windows (Win+Frecce) e lo snap layout trascinando la finestra ai bordi non scattano correttamente.
2. Il resize diagonale dai bordi non funziona sempre come atteso.

Dato il principio in `PRODUCT.md` che "una finestra che non si ridimensiona o non fa snap è rotta" e che lo strumento vive nel desktop per ore, l'affidabilità delle API di windowing di Windows 11 prevale sull'estetica di una top bar unificata.

La top bar dei progetti è stata spostata appena sotto la barra nativa e l'attributo `data-tauri-drag-region` è stato rimosso per delegare tutto al sistema operativo.

---

## Gate R9: una sola scrittura dentro `~/.omp` per il tema condiviso

**Data:** 2026-07-31
**Esito:** DEROGA CONCESSA, con perimetro
**Decisione:** Studio scrive `~/.omp/agent/themes/omp-studio.json`, e nient'altro.

**Motivazione:**
`PRODUCT.md` §8 dice che l'app non scrive niente dentro `~/.omp`. Il selettore di
tema unico non è realizzabile in sola lettura, e la ragione è nel sorgente di
`omp` (verificata su 17.2.1):

1. I 100 temi builtin sono compilati dentro l'eseguibile
   (`modes/theme/theme.ts` li importa con `with { type: "json" }`): sulla
   macchina utente non esistono su disco.
2. `loadThemeJson` restituisce l'oggetto builtin **prima** di guardare il disco
   (`theme.ts:2026-2030`), quindi un file `themes/titanium.json` sarebbe ignorato.
   Solo un nome **non** builtin fa leggere il file.
3. Il watcher dei temi osserva `<themes>/<tema attivo>.json` e parte solo se quel
   file esiste già (`theme.ts:2437-2453`).

Quindi: nome `omp-studio` (non builtin), un file che Studio crea e possiede,
`theme.dark`/`theme.light` impostati **solo** nell'overlay `--config` passato ai
PTY di Studio. La configurazione dell'utente non viene toccata e `omp` lanciato
fuori da Studio mantiene il suo tema.

**Perché la deroga non annulla il principio "il costo di un errore è zero":**
il file è nuovo (la cartella `themes/` non esiste in un'installazione standard),
non è letto da nient'altro, e cancellarlo riporta `omp` esattamente a com'era.
Nessun database, nessuna sessione, nessuna credenziale è raggiungibile da questo
percorso di scrittura.

**Verificato empiricamente il 2026-07-31.** Con l'overlay che imposta
`theme.dark: omp-studio` e un file di tema volutamente incompleto, `omp` logga
`Theme loading failed, falling back to dark theme` con l'elenco dei token
mancanti: prova che l'overlay è onorato e che il file viene letto e validato.
Con una copia valida di un tema builtin il caricamento è silenzioso.
**Non verificato:** il ricaricamento a caldo delle TUI già aperte quando il file
viene riscritto. Il meccanismo esiste nel sorgente e tutti i suoi gate sono
soddisfatti, ma non è stato osservato: l'interfaccia non lo promette.

---

## Gate R10: seconda superficie via `--mode rpc-ui`

**Data:** 2026-08-24
**Esito:** SUPERATO, con perimetro
**Decisione:** la colonna destra diventa a schede `TERMINAL | GUI`. La scheda GUI è un
client nativo che pilota `omp --mode rpc-ui` su stdio NDJSON. Un solo processo `omp` per
progetto: cambiare scheda chiude quel processo e riapre la **stessa** sessione con
`--resume <sessionId>`.

**Cosa rovescia.** Fino alla 0.9 tre punti dicevano il contrario, e sono stati riscritti,
non aggirati: il non-obiettivo «non reimplementa la chat dell'agente» (`PRODUCT.md`),
l'anti-riferimento Cursor/Windsurf (`PRODUCT.md`), e «`--mode rpc` … significherebbe
sostituire la TUI» (`ricerca/OMP-INTEGRATION.md` §5.5). La distinzione che regge il
rovesciamento: *sostituire* la TUI era il rifiuto, *affiancarla* non lo è. La TUI resta
la superficie di default, resta intatta, e ogni comando che vive solo lì continua a
viverci — la GUI lo dichiara e offre il passaggio, non lo emula.

**Perché `rpc-ui` e non `rpc`.** `--mode rpc` mette `hasUI = false` e il tool `ask` muore
con `Ask tool requires interactive mode`. Senza `ask` un agente che chiede una scelta si
interrompe: non è una superficie, è una demo.

**Verificato empiricamente il 2026-08-24** su `omp/18.0.4`, avviando
`omp --mode rpc-ui --cwd <repo>` con stdio in pipe:

1. frame `ready` con `supportedProtocolVersions: [1, 2]`, `maxFrameBytes: 1048576`,
   `maxReassembledFrameBytes: 67108864`;
2. `{"type":"negotiate_protocol","protocolVersion":2}` risponde
   `success: true, data.protocolVersion: 2`;
3. `get_state` restituisce `sessionId`, `sessionFile`, `contextUsage`, `todoPhases`,
   `queuedMessageCount` e i tre modi di coda;
4. `available_commands_update` arriva non richiesto all'avvio;
5. arrivano `extension_ui_request` che **non** sono domande (`method: "setWidget"`): il
   client non può assumere che ogni `extension_ui_request` richieda una risposta.

**Perimetro, dichiarato nell'interfaccia e non nascosto.**

- **Un solo proprietario per sessione.** Le due superfici non coesistono per lo stesso
  progetto. L'handoff è esplicito, mai automatico.
- **Il passaggio perde lo stato non persistito**: job in background, kernel `eval`, tab
  del browser, sessioni shell di `bash`. Il transcript no: è lo stesso `.jsonl`.
- **Nessun controllo dei subagent dalla GUI.** Il protocollo espone solo `get_subagents` e
  `get_subagent_messages`: il pannello è in sola lettura e lo scrive.
- **Esecuzione diretta e allineata alla TUI.** L'overlay GUI imposta `tools.approvalMode: yolo`
  permettendone l'esecuzione automatica senza prompt bloccanti o richieste di permessi,
  allineando il comportamento della GUI a quello della TUI.

---

## Gate R11: il primo avvio ospita il wizard di `omp`, non lo riscrive

**Data:** 2026-08-25
**Esito:** SUPERATO, con perimetro di scrittura chiuso
**Decisione:** l'onboarding di `omp` resta di `omp`. Studio lo esegue dentro un modal
con una scheda di terminale (`omp setup --no-session`), rileva la fine leggendo lo stato
reale, e chiede per conto proprio solo la cartella dei progetti.

**Perché ospitare e non reimplementare.** Il wizard nativo è versionato: `setupVersion`
contro `CURRENT_SETUP_VERSION`, e ogni scena dichiara il suo `minVersion`.
`composer-shape` è arrivata con `minVersion: 2`, cioè l'insieme delle domande è già
cambiato una volta. Una GUI custom si disallineerebbe alla prossima, e nessuno se ne
accorgerebbe finché un utente non resta senza una configurazione che `omp` dà per fatta.
Ospitare la TUI è anche coerente con il principio 1 di `PRODUCT.md`: il terminale è il
contenuto, l'app è la cornice.

**Il segnale di fine non è la fine.** Verificato nel bundle di `omp/18.0.4`:
`markSetupWizardComplete()` è chiamata **dopo** `await run()` dentro il `try` di
`runSetupWizard`, quindi `setupVersion: 2` viene scritto anche da chi esce con Esc da
tutte e cinque le scene. Chiudere il modal su quel segnale consegnerebbe una GUI rotta
in silenzio — il fallimento che questa fase esiste per eliminare. La condizione di
chiusura è quindi semantica: `setupVersion >= 2` **e** almeno una credenziale attiva
**e** `modelRoles.default` valorizzato. Altrimenti il modal resta e dichiara cosa manca,
con `/setup` (alias `/providers`, riapre la sola scena provider senza rimarcare il setup)
come azione di rimedio.

**Perimetro di scrittura, chiuso ed elencato.** Il flusso scrive esattamente questo, e
`config.yml` **non** è nella lista: lo scrive `omp` stesso attraverso il suo wizard.

| Percorso | Quando | Modo |
|---|---|---|
| `%LOCALAPPDATA%\omp\omp.exe` | solo se `omp` è assente | file nuovo, fuori da `~/.omp` |
| `HKCU\Environment` → `Path` | solo se la cartella non c'è già | append, mai riscrittura |
| `~/.omp/agent/settings.json` → `shellPath` | solo se la chiave è assente | merge, mai sovrascrittura |
| `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + `HKCU\...\Fonts` | installazione font per-utente | file nuovo + un valore |
| `%APPDATA%\omp-studio\settings.json` → `projectRoot` | carta finale | store di Studio, non di `omp` |

`shellPath` è la sola aggiunta dentro `~/.omp` oltre a R9, e replica ciò che fa
`Configure-BashShell` nell'installer ufficiale (`scripts/install.ps1`): senza quella
chiave il tool `bash` di `omp` ricade sulla shell interna. Scritta in merge e solo se
assente, non può distruggere una configurazione esistente.

**Perché l'installazione di `omp` sta nell'app e non in un hook NSIS.** L'installer è
`installMode: currentUser`, quindi un hook sarebbe tecnicamente possibile. Ma il binario
è ~143 MB: dentro NSIS non c'è progresso né retry, e la via pratica (`powershell -Command
"irm https://omp.sh/install.ps1 | iex"`) può fallire per proxy, ExecutionPolicy, TLS o
antivirus **lasciando l'installer riuscito** e l'utente con Studio aperto e `omp`
assente. La carta in-app servirebbe comunque da fallback: se serve comunque, l'hook è
macchinario duplicato con la UX peggiore. In-app c'è già tutto (`reqwest` con `stream`,
il pattern di `studio_updater.rs`) e copre anche Nightly e installazioni non-NSIS.

**Perché il font si installa lo stesso, pur non servendo a Studio.** Dentro Studio i
glifi Nerd già rendono: `static/fonts/StudioMonoNF-Regular.woff2` è primo nello stack del
canvas xterm (`terminal.ts:17-23`) proprio per non dipendere dai font di sistema.
L'installazione serve a `omp` lanciato **fuori** da Studio, dove la scena `glyph-mode`
scrive `symbolPreset` e un terminale senza Nerd Font disegna tofu. È una scelta
deliberata a favore della coerenza fra le due superfici, non un requisito di Studio.
Il font è ricavabile senza aggiungere asset: il `.woff2` bundlato è **FiraCode Nerd Font
Mono Regular** completo (12.415 glifi, 11.969 in cmap, 10.396 nell'area Private Use, 328
latini), contorni TrueType, non sottoinsiemato; togliere il flavor `woff2` produce un TTF
valido di 2,63 MB senza perdita. Verificato con fontTools il 2026-08-25.

**Il tema non si forza.** La scena `theme` del wizard scrive `theme.dark`; il guscio si
adegua a quella scelta (`titanium` → scuro, `light` → chiaro, `colorblind` →
`colorBlindMode`) invece di imporre `omp-studio` sopra una decisione presa venti secondi
prima. Guscio e TUI restano allineati come chiede `PRODUCT.md`, senza una seconda domanda.

**Il prerequisito mancante.** `contract_check`, specificato in `ARCHITECTURE.md` §4.1 e
`PLAN.md` Fase 6 e mai implementato (annotato in `IDEAS.md`), è ciò che decide quale carta
mostrare. Va scritto prima del modal: oggi al suo posto ci sono un `console.error` e il
messaggio rosso di PowerShell dentro il PTY.

---

## Gate R12: la barra dei progetti diventa configurabile, e la coda può avviarsi da sola

**Data:** 2026-08-26
**Esito:** SUPERATO, con perimetro
**Decisione:** l'ordine delle tessere è manuale per default e non cambia più da sé; la
tessera mostra quanti task attendono; i task si avviano dalla barra o da una vista
aggregata senza cambiare progetto; l'auto-avvio del prossimo task esiste, ma solo come
interruttore per singolo progetto, spento di default. Tutte le personalizzazioni vivono
in un centro impostazioni unico (`Ctrl+Alt+,`), di cui i modelli diventano una sezione.

**Il problema misurato.** Con `setActive` che faceva `unshift` sull'array e lo persisteva,
ogni click riscriveva l'ordine della barra: nessuna tessera aveva una posizione stabile,
e la memoria spaziale — il motivo per cui una barra esiste — non si formava. In più lo
stato della coda era invisibile dall'alto: per sapere se un progetto aveva task in attesa
bisognava aprirlo, spostandolo in testa, e guardare il pannello di sinistra. Su cinque
progetti aperti sono cinque cambi di stanza per rispondere a "dove c'è lavoro da lanciare".

**Cosa rovescia.** Due frasi di `PRODUCT.md`, riscritte e non aggirate:

1. «Tre stati e non uno di più» (§Principi/3). Il contatore della coda è un quarto
   segnale sulla tessera. La distinzione che regge il rovesciamento: i tre stati
   descrivono l'**agente**, il contatore descrive il **lavoro in attesa**, che non è uno
   stato dell'agente e non ne aggiunge uno. Resta spegnibile (`queueBadge: 'off'`).
2. «coda **manuale** di prompt … si avvia quando `omp` torna in attesa» (§Problema 3).
   L'auto-avvio contraddice l'aggettivo. Perimetro che lo rende accettabile: spento di
   default, per progetto e mai globale, mai retroattivo su progetti esistenti, e sempre
   subordinato alla stessa condizione di prontezza dell'avvio manuale
   (`automationReason() === 'Pronto'`): non forza un agente occupato, non accoda niente
   di nascosto, non riordina la coda.

**Perché l'ordinamento non-manuale non muta l'array.** `priority` e `alpha` sono viste
derivate (`projectOrder.list`), non riscritture di `projectStore.projects`. Così tornare
a `Manuale` restituisce esattamente l'ordine che l'utente aveva costruito trascinando le
tessere, invece di un ordine alfabetico congelato. La migrazione di chi aggiorna congela
l'ordine MRU corrente: nessuno si ritrova le tessere rimescolate al primo avvio.

**Perché l'auto-avvio esce dall'effetto.** `handleRunTask` scrive `terminalBusy` e
`markDispatching`, cioè lo stato che l'effetto di auto-avvio legge per decidere. Scrivere
dentro l'effetto che ha appena letto quello stato è il difetto che in questo stesso file
aveva già prodotto `effect_update_depth_exceeded` (commento in `routes/+page.svelte`): la
spedizione passa da `queueMicrotask` e da un lock per progetto.

**Perimetro di scrittura.** Una sola chiave nuova, `studioSettings` in
`%APPDATA%\omp-studio\settings.json`, più due campi per progetto (`autoDispatch`,
`taskDefaults`) nell'array `projects` già persistito. Niente dentro `~/.omp`. Ogni campo
viene riletto con validazione campo per campo (`parseSettings`): un file troncato o
scritto a mano riporta i default, non una GUI rotta.

---

## Gate R13: Promozione diretta degli artefatti validati da Release Candidate a Stabile con verifica di consistenza

**Data:** 2026-08-26
**Esito:** SUPERATO
**Decisione:** la release stabile non ricompila più da zero il codice se esiste una Release Candidate testata; promuove direttamente gli stessi file binari (installer `.exe` e `.dmg`) controllando in modo bloccante che il commit del tag stabile coincida con quello della candidate. Lo script `scripts/release.mjs` valida preventivamente l'allineamento perfetto dei 4 file di versione (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`).

**Il problema risolto.** Ricompilando da zero durante la release stabile, c'era il rischio concreto che discrepanze nell'ambiente runner, risoluzione di pacchetti o tempistiche producessero binari differenti da quelli effettivamente testati durante la fase di candidate.

**La garanzia di consistenza.** Il job `resolve` di `.github/workflows/release.yml` recupera il commit SHA del tag stabile e della candidate associata:
- Se i commit coincidono, salta la compilazione di Windows e macOS e scarica gli asset firmati e testati della RC, calcolando i checksum `SHA256SUMS.txt`.
- Se i commit divergono, il workflow fallisce con errore bloccante, impedendo il rilascio di codice non testato sotto l'egida della RC.

---

## Gate R14: Disaccoppiamento dello stato dei Task in `tasks.json` dedicato su Tauri store

**Data:** 2026-08-26  
**Esito:** SUPERATO  
**Decisione:** Lo stato dei task, le code di prompt, le viste e le associazioni di origine sessione vivono in un file separato `tasks.json` gestito con `tauri-plugin-store`, completamente isolato da `settings.json`.

**Il problema risolto:** Unire la configurazione globale del guscio (`settings.json`) con i dati operativi ad alta frequenza dei task (`tasks.json`) aumentava la probabilità di conflitti di I/O, sovrascritture concorrenti e corruzioni. Inoltre, i task appartengono al progetto e devono sopravvivere a chiusure e riaperture del workspace.

**Architettura di persistenza:**
1. I task vengono indicizzati tramite chiave di progetto normalizzata (`projectKey = normalizeProjectPath(path).toLowerCase()`).
2. Il salvataggio su disco è asincrono e atomico con debounce di 250 ms, convertendo gli array reattivi Svelte 5 con `$state.snapshot`.
3. Le opzioni avanzate del task (ruolo, thinking effort, direttive speciali Plan/Discussione/Minimale/Ricerca, inclusione contesto editor e screenshot allegati in base64) sono modellate con tipi TypeScript rigorosi (`StudioTask`, `PersistedTaskState`) e sanitizzate al caricamento per prevenire dati malformati.

---

## Gate R15: Difesa in profondità per anteprime vettoriali SVG e prototipi UI

**Data:** 2026-08-26  
**Esito:** SUPERATO  
**Decisione:** L'anteprima dei file SVG e dei prototipi UI generati dall'agente (`studio_preview`) viene isolata all'interno di un `<iframe>` con sandbox restrittiva, origine `null` disaccoppiata e CSP ermetica, preceduta da sanitizzazione con `DOMPurify`.

**Il problema risolto:** L'ambiente Tauri opera in un contesto con privilegi nativi di sistema. L'esecuzione o visualizzazione diretta di markup SVG o codice HTML prodotto dall'agente senza isolamento comporterebbe gravi rischi di Cross-Site Scripting (XSS), furto di token o invocazione indebita di comandi IPC (`window.__TAURI__`).

**Garanzia tecnica multistrato:**
1. **Sanitizzazione primaria:** passaggio su `DOMPurify` (profilo SVG restrittivo, rimozione di tag `<script>`, `<foreignObject>`, `<iframe>`, attributi `on*` e URI `javascript:`).
2. **Content Security Policy ermetica:** `default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;` (blocca script, fetch, connessioni esterne, worker ed oggetti).
3. **Iframe Sandboxing:** l'anteprima risiede all'interno di un `<iframe sandbox="">` privo di `allow-scripts` e `allow-same-origin`, con origine `null`. Il motore del browser disabilita l'esecuzione JavaScript alla radice e impedisce qualunque accesso a `window.parent` o alle API IPC di Tauri.

---

## Gate R16: Raggruppamento semantico delle chiamate tool (`ToolGroup`), thinking accordion e accessibilità chat

**Data:** 2026-08-26  
**Esito:** SUPERATO  
**Decisione:** Nel transcript della chat GUI, le chiamate consecutive ai tool e i relativi blocchi di ragionamento intermedio (`thinking`) vengono accorpati in un unico blocco compatto `ToolGroup`, con cronometro live tabulare, autoscroll resiliente ancorato in fondo e navigazione accessibile con `roving tabindex` sulle card interattive (`AskCard`).

**Il problema risolto:** Lo streaming asincrono di OMP produceva frammentazioni visive con decine di card separate e salti di scroll fastidiosi durante la generazione di risposte lunghe. Inoltre, l'audit Impeccable ha evidenziato disallineamenti di focus tastiera sulle scelte multiple e contrasti cromatici insufficienti.

**Risultato verificato:**
1. Il transcript mantiene la risposta finale dell'assistente in primo piano e raggruppa le sequenze di tool intermedi in un blocco espandibile/collassabile con chevron animato e timer in tempo reale.
2. L'autoscroll resta saldamente ancorato in fondo durante lo streaming; se l'utente scorre intenzionalmente verso l'alto la visuale si blocca, e si riaggancia automaticamente quando si torna vicino al fondo o si preme il pulsante dedicato.
3. Le card di scelta interattiva (`AskCard`) implementano il pattern WAI-ARIA con `roving tabindex`, sincronizzando la navigazione con i tasti freccia e il fuoco effettivo per evitare invii accidentali. Tutti i badge e gli stati di errore rispettano la soglia di contrasto WCAG AA (>= 4.5:1).

---

## Gate R17: Notifiche desktop cross-platform con AUMID Windows registrato e avvisi visivi su Dock/Taskbar

**Data:** 2026-08-26  
**Esito:** SUPERATO  
**Decisione:** Quando un agente richiede attenzione (`agentState === 'attention'`) o completa un task mentre l'applicazione non è a fuoco o su un altro progetto, Studio emette una notifica toast nativa e attiva segnali visivi di allerta: pallino rosso lampeggiante sull'icona della barra delle applicazioni di Windows e badge numerico con rimbalzo animato nel Dock di macOS. Cliccando sulla notifica, Studio viene portato in primo piano aprendo direttamente il progetto interessato.

**Il problema risolto:** L'utente che delega compiti lunghi a più agenti in parallelo non deve monitorare costantemente la finestra. Su Windows, le notifiche toast senza un AppUserModelId esplicito fallivano o venivano mostrate come script generici di PowerShell; registrando `sh.omp.studio` nel registro di sistema Windows, l'icona ufficiale e il nome vengono sempre visualizzati correttamente nel Centro Notifiche.

**Perimetro e integrazione:**
1. Registrazione dell'AUMID `sh.omp.studio` nel registro utente Windows (`HKCU\Software\Classes\AppUserModelId\sh.omp.studio`) con percorso icona nativo.
2. Dispatch toast tramite `tauri-plugin-notification` con due stili configurabili (sintetico o dettagliato con la domanda dell'agente).
3. Integrazione bidirezionale con reset automatico dello stato di attenzione (`clear_app_attention`) appena la finestra o la scheda del progetto torna in primo piano.

---

## Gate R18: un solo set di icone, click destro sulle tessere e tinta di progetto senza selettore RGB

**Data:** 2026-08-27
**Esito:** SUPERATO
**Decisione:** Le icone di Studio vengono da **Lucide** (`@lucide/svelte`),
esposte da un registro locale `src/lib/icons.ts`; il click destro su una tessera
apre il pannello del progetto invece del menu della WebView, soppresso in tutta
l'app tranne dove serve la clipboard nativa; il colore personalizzato di un
progetto resta **una tinta** e si sceglie da un selettore reso con i token del
tema, non dal selettore di colori del browser.

**Il problema risolto:** tre difetti con la stessa radice, cioe' un'interfaccia
che promette piu' di quanto il sistema sotto sappia mantenere.

1. **Emoji come icone.** 108 righe in 37 file usavano glifi del font emoji di
   sistema, che porta il proprio colore, ignora la palette (`DESIGN.md` §2) e
   cambia disegno fra Windows e macOS. Verificato prima di scegliere:
   `@lucide/svelte@1.34.0` dichiara `svelte: ^5` come peer, non ha dipendenze,
   e' ISC, ha `sideEffects: false` ed espone ogni icona come componente Svelte 5
   su un sottopercorso proprio (`@lucide/svelte/icons/folder-open`), quindi il
   bundle porta solo le icone usate. Scartati: `lucide-svelte` (deprecato),
   `@iconify/svelte` (scarica gli SVG in rete, incompatibile con la CSP
   `connect-src 'self'`), `phosphor-svelte` (richiede un plugin Vite),
   `@tabler/icons-svelte` (piu' pesante, tratto meno coerente). Lucide era gia'
   il vocabolario dei prototipi in `src/lib/prototype/template.ts`.
   Il registro esiste perche' l'import diretto dal barrel del pacchetto
   servirebbe 1777 moduli in sviluppo, e perche' cambiare il glifo di un'azione
   deve costare una riga.
2. **Menu contestuale della WebView.** Verificato nel sorgente di `wry 0.55.1`:
   `default_context_menus` resta `true` anche in release, dove cade soltanto
   «Ispeziona elemento». Le voci «Ricarica / Indietro / Stampa» non hanno senso
   in un guscio desktop. La soppressione e' un solo listener con whitelist
   (`input`, `textarea`, `contenteditable`, `.monaco-editor`, `.xterm`, e il
   caso del testo selezionato), quindi copiare e incollare resta possibile dove
   serve. Il trascinamento della finestra non ne soffre: `drag.js` di
   `tauri 2.11.5` filtra `e.button === 0` e ignora il tasto destro, e
   `data-tauri-drag-region="deep"` (introdotto in `tauri 2.11.0`) continua a
   valere per il tasto sinistro sui figli non interattivi.
   Scartato il menu nativo `tauri::menu::ContextMenu::popup_at`: non accetta
   icone vettoriali, non si tematizza e non puo' ospitare il campo di rinomina
   ne' il selettore di tinta.
3. **Selettore di colore.** `Project` conserva `hue: number`; luminosita' e
   croma arrivano da `--proj-l-fill` e `--proj-c-fill`. Il vecchio
   `input type="color"` faceva scegliere fra sedici milioni di colori e ne
   conservava la sola tinta (`hexToHue`), quindi un pastello tornava saturo. La
   scelta e' stata **non allargare il modello dati**: nessuna migrazione,
   nessun rischio di tessere illeggibili contro `--on-project`, e un selettore
   che mostra solo cio' che il sistema sa produrre. I pallini predefiniti sono
   passati dai valori cablati `oklch(0.68 0.16 H)` ai token del tema: prima
   l'anteprima non corrispondeva al colore reale della tessera.

**Perimetro tecnico del pannello:** `popover="manual"` per vivere nel top layer,
piazzamento in JavaScript (`src/lib/anchoredPopover.ts`) perche' CSS Anchor
Positioning non esiste su WKWebView prima di Safari 26 e macOS 14/15 resta un
bersaglio di distribuzione; `role="dialog"` non modale, come prescrivono le APG
WAI-ARIA per un pannello che contiene elementi attivabili; larghezza fissa, dopo
che le righe della coda — prime righe di prompt su una riga sola — spingevano il
pannello fuori dallo schermo.

---

## Gate R19: si muove chi chiede una risposta, non chi lavora

**Data:** 2026-08-27
**Esito:** ROVESCIAMENTO ACCETTATO
**Decisione:** la tessera di progetto porta il colore in un punto da 8px invece che
nel riempimento; il nome del progetto vive dentro la tessera aperta e non più al
centro della barra; l'unico movimento persistente passa da «sta lavorando» a
«aspetta una risposta»; il contatore dei task in coda si mostra solo sulla tessera
aperta.

**Origine.** Un prototipo separato ("Quiet Dots", React + Tailwind) ha permesso di
guardare le alternative fuori dall'app, con interruttori per tema chiaro/scuro,
controlli macOS/Windows e trigger di stato. L'analisi completa del prototipo è in
`ricerca/topbar-quiet-dots-analisi.md` (fuori da git).

**Le quattro cose che cambiano, e perché.**

1. **Il colore nel punto, non nel riempimento.** Prima il colore del progetto
   compariva solo sulla tessera attiva, come riempimento pieno: un blocco saturo
   in cima allo schermo e, soprattutto, **nessun colore sui progetti chiusi**, che
   sono esattamente quelli che l'utente deve riconoscere a colpo d'occhio. Con il
   punto, tutti i progetti hanno sempre la loro tinta e nessuno è un blocco pieno.
   La regola «un solo blocco saturo per schermata» non è stata rilassata: è stata
   portata a zero.

2. **Il nome dentro la tessera.** Il nome del progetto attivo era scritto due
   volte (tessera + titolo centrato). Rivelandolo dentro la tessera con
   un'animazione di larghezza, la barra perde un elemento e guadagna un
   indicatore di posizione che si muove insieme al fuoco. Il titolo centrato è
   diventato pura area di trascinamento.

3. **Si muove chi chiama.** `DESIGN.md` faceva respirare `working` e lasciava
   `attention` fermo. È l'inverso di ciò che serve: «sta lavorando» è
   un'informazione che si consulta, «aspetta una risposta» è una richiesta che
   deve interrompere. Con cinque progetti aperti e tre agenti al lavoro, la
   vecchia regola metteva in movimento tre tessere su cinque e rendeva invisibile
   la sola che aveva bisogno di qualcuno. Ora pulsa solo l'ambra, e il costo a
   riposo dell'animazione si paga solo quando c'è davvero qualcosa da chiedere.
   L'arco che gira sulla tessera aperta in `working` resta, perché è locale al
   progetto che si sta già guardando.

4. **Il contatore solo sulla tessera aperta.** Il badge in overlay su ogni
   tessera era il quarto segnale contemporaneo su un quadrato da 30px (lettera,
   anello, punto di stato, badge). Un numero va letto, non intravisto: resta
   dentro la tessera aperta, mentre il totale su tutti i progetti è già nel chip
   «Coda» e l'elenco per progetto nel pannello della tessera. È una perdita di
   informazione periferica accettata consapevolmente, e la sola in questo giro.

**Cosa NON è stato portato dal prototipo:** l'alone da 12px attorno all'anello di
attenzione (`DESIGN.md` §4: nessuna ombra sulle tessere), il `title` che ripeteva
sigla e nome (§9), l'assenza di un fallback `prefers-reduced-motion`, e i colori
di progetto cablati in oklch — la tinta continua a nascere dal tema di `omp`.
Il prototipo, inoltre, nascondeva `working` e la coda su **tutte** le tessere
chiuse: quella parte è stata rifiutata, perché lo stato dell'agente fuori schermo
è il motivo per cui questa barra esiste (`PRODUCT.md` §3).

**Impostazioni.** Le cinque preferenze di `projectBar` restano tutte, senza
migrazione dei dati: `queueBadge` continua a scegliere fra numero, numero più
prontezza, puntino e niente (adesso dentro la tessera aperta), e `label` decide se
il nome compare solo sulla tessera aperta o su tutte, che è l'interruttore
«sigla / sigla + nome» del prototipo. `showAgentDot` cambia oggetto e non nome:
prima accendeva il puntino accanto alla tessera, ora accende i due anelli di
stato, che dicono la stessa cosa nello stesso posto.

---

## Gate R20: l'attesa del terminale è testo nel buffer, non un velo sopra la viewport

**Decisione.** Durante l'avvio di una sessione il terminale scrive nel proprio
buffer una riga attenuata (`avvio ambiente`, `ripresa della sessione`,
`preparazione della configurazione guidata`) e la cancella al primo byte reale.
Nessun overlay, nessuno spinner, nessuna transizione: il feedback è **contenuto
del terminale**, esattamente come l'errore di spawn che `terminal.ts` scriveva
già in ANSI rosso.

**Il problema misurato.** Fra `pty_open` e il primo frame della TUI passano
~0.75 s (`ARCHITECTURE.md` §11), e di più quando `--resume` rilegge un transcript
da disco. In quella finestra la viewport era un rettangolo nero: nessun segnale
che ConPTY, PowerShell e `omp` fossero in moto. Sotto la soglia di 1 s canonica
non serve un indicatore di progresso, ma serve sapere che il sistema ha ricevuto
il comando.

**Perché non un overlay, pur essendo la strada già battuta nella GUI.**
`Transcript.svelte` ha skeleton e spinner, e riusarli qui sarebbe stato meccanico.
`DESIGN.md` §6.2 lo vieta: «il terminale non è mai il soggetto di un'animazione…
la viewport appare già disegnata». La lettera della regola motiva il divieto col
reflow su un canvas che sta ridisegnando testo — motivo che durante il boot non
si applica, perché il buffer è vuoto e non c'è nulla in disegno. Il divieto è
stato mantenuto comunque, perché la ragione **vera** della regola è un'altra e
resta valida: la cornice non entra dentro la viewport. Un messaggio scritto nel
buffer rispetta il confine invece di negoziarlo, e costa un `write` invece di un
wrapper DOM, un ciclo di stato reattivo e una regola CSS.

**Attenuazione, non colore.** La riga usa SGR 2 (dim) e non un colore ANSI: i 16
colori appartengono al tema di `omp` (`PRODUCT.md` §3.1). Verificato che il
renderer Canvas applichi il flag dim e lasci `fgColorMode` a default.

**I due segnali sono distinti, e non è ridondanza.** La riga sparisce al primo
output, perché è l'unico istante in cui si può cancellare senza che la TUI le si
disegni sopra a metà; lo stato di avvio si chiude invece al primo titolo `π` di
`omp`, che è il segnale semantico di «TUI viva» (l'equivalente in casa di OSC 133).
Entrambi chiamano lo stesso metodo idempotente: chi arriva secondo non fa nulla.
La documentazione di xterm.js è esplicita sul fatto che un chunk scritto è
*parsato*, non necessariamente dipinto, quindi il primo output non è una prova di
«pronto» e non viene usato come tale.

**Soglia e resa.** Sotto i 150 ms non si scrive niente: un avvio a caldo
produrrebbe solo un lampo di testo subito sovrascritto. Oltre i 10 s senza un
solo byte la riga diventa un avviso con la causa e cosa verificare, invece di
restare un'attesa perenne — la stessa scelta già fatta per i pannelli FILE, GIT
e quote.

## Gate R21: le quote dei provider aggiunti da plugin entrano da sorgenti dichiarate dall'utente, non da codice per-provider

**Data:** 2026-09-02
**Esito:** SUPERATO, con perimetro

**Decisione.** Il popover quote continua a nascere da `omp usage --json`, ma
`usage_snapshot` fonde in `reports[]` anche l'output dei descrittori trovati in
`%LOCALAPPDATA%/omp-studio/usage-sources/*.json` (`~/.omp-studio/usage-sources`
altrove). Ogni descrittore dichiara un comando; Studio lo esegue e si aspetta
sullo stdout la stessa forma del comando `omp` (`{"reports":[…]}`, un array di
report o un report singolo). **Nel codice di Studio non compare il nome di
nessun provider**: cartella assente o vuota significa il comportamento
precedente, byte per byte, per chiunque non abbia dichiarato nulla.

**Il problema misurato.** `omp usage --json` non carica né estensioni né
plugin: il suo percorso CLI istanzia un `ModelRegistry` nudo
(`packages/coding-agent/src/cli/usage-cli.ts:1102`) mentre `omp models` passa da
`loadCliExtensionProviders()`. Conseguenza: un provider aggiunto da un plugin —
`commandcode` via `pi-commandcode-provider` — resta senza alcun report anche
quando l'API per leggerne la quota esiste e risponde. Il popover era corretto e
vuoto allo stesso tempo.

**Perché non le tre strade più ovvie.** Verificate sul sorgente, tutte chiuse:

1. *Un `UsageProvider` in un'estensione dell'utente.* Non verrebbe mai
   interrogato: `omp usage` non carica estensioni, quindi
   `#runtimeUsageProviderOverrides` (`packages/ai/src/auth-storage.ts:3627`) è
   vuoto in quel processo.
2. *`pi.registerProvider("commandcode", { usage })` per aggiungere il pezzo
   mancante.* È un **source handoff**: `model-registry.ts:2565-2578` azzera lo
   stato runtime del provider, quindi passare solo `usage` gli farebbe perdere
   modelli e transport del plugin. E le estensioni native si caricano **prima**
   dei plugin (`extensions/loader.ts:684-717`), quindi il plugin cancellerebbe
   comunque l'usage registrato dall'estensione.
3. *Una riga in `models.yml`.* Lo schema dei provider non ha alcun campo
   `usage` (`config/models-config-schema-bundle.ts:296-339`).

Da qui anche il corollario che ha deciso la scelta: **una PR al plugin non
basterebbe**, perché il comando `usage` non lo caricherebbe comunque. Il buco è
a monte, e finché resta tale l'unico posto in cui la conoscenza specifica di un
provider può stare senza sporcare l'app è la configurazione di chi lo usa.

**Scartato.** Eseguire `/commandcode-quota` nel PTY e leggerne l'output: un
parser su testo destinato a un umano si rompe al primo cambio di wording.
Scartato anche il codice per-provider dentro Studio: farebbe spedire a tutti il
supporto di un provider che nessun altro ha configurato.

**Perimetro.**

- Studio **non legge credenziali**: il divieto di `IDEAS.md` resta intatto. È lo
  script dell'utente a procurarsi la chiave, e lo fa dalla superficie supportata
  `omp token <provider>`, non da `auth_credentials`.
- Timeout per sorgente: 15 s di default, `timeoutSec` fino a 60, processo ucciso
  allo scadere (`kill_on_drop`); stdout oltre 2 MB scartato.
- I report di `omp usage` vincono: una sorgente non può oscurare un provider che
  ha già dati reali (confronto per nome, case-insensitive).
- Ogni fallimento è isolato e non fatale: descrittore malformato, comando
  assente, uscita diversa da zero o JSON irriconoscibile finiscono su stderr e
  lasciano il resto del popover intatto.
- `fetchedAt` viene timbrato da Studio solo se la sorgente non lo dichiara.

**Verifica.** Tre test in `omp_ops.rs` (le tre forme di output accettate, la
fusione che non oscura i duplicati, `fetchedAt` preservato) più l'esecuzione
reale del percorso `usage_source_specs → run_usage_source → merge_extra_reports`
con il descrittore `commandcode.json` di questa macchina: due limiti (finestra
5 ore e settimana) fusi accanto ai report di `omp usage`.
