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
spedizione passa da `queueMicrotask` e da un lock per progetto. *Aggiornato da
«Gate R34»: il microtask diventa un timer di stabilita' con
ri-verifica, la prontezza dell'auto-avvio diventa «ferma e stabile».*

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

---

## Gate R22: la modalità di accodamento è decisa all'invio, chip di sola lettura e nessuna coda locale in Studio

**Data:** 2026-09-02  
**Esito:** APPROVATO, con perimetro  
**Decisione:** la modalità di accodamento (`steer` vs `followUp`) viene scelta e trasmessa irrevocabilmente al momento dell'invio del prompt. I chip dei messaggi in coda diventano badge informativi di sola lettura. Le modalità di gestione della coda (`steeringMode`, `followUpMode`, `interruptMode`) e il comportamento predefinito di invio vengono centralizzati come preferenze persistenti in *Impostazioni > Generali*, eliminando il popover ingranaggio del composer e le scorciatoie `Alt+Q` e `Alt+S`. Nessun buffer o coda locale viene introdotto in Studio.

**Motivazione:**

1. **Il protocollo `omp` non rende mutabile la coda accodata.**  
   L'ispezione dello schema RPC di `omp` (`omp://rpc.md:109-205`) conferma che il parametro `streamingBehavior` (`"steer"` | `"followUp"`) viene accettato esclusivamente come argomento del comando `prompt` nell'istante in cui il messaggio viene immesso nel processo. Il protocollo non espone alcuna chiamata per interrogare, modificare, riordinare o estrarre messaggi già presenti nella coda (nessun comando `dequeue` o `clear_queue`; il `dequeue` visibile nella TUI è un keybinding puramente interno al processo terminale non esposto via RPC). Il toggle della modalità di accodamento sui chip di coda precedentemente presente nell'interfaccia di Studio era un placebo: modificava lo stato reattivo locale senza alcun effetto sul comportamento reale di `omp`. `AgentSession.setQueuedBehavior()` è stato rimosso come codice morto.

2. **Scelta esplicita all'invio invece che post-accodamento.**  
   Poiché la natura del messaggio è immutabile una volta inoltrato, la decisione deve avvenire prima o durante la sottomissione:
   - `Invio`: invia il messaggio adottando la modalità predefinita configurata nelle impostazioni generali (`steer` o `followUp`).
   - `Alt+Invio`: invia il messaggio adottando la modalità opposta al default.
   - `Shift+Invio` e `Ctrl+Invio`: restano dedicati all'inserimento di una nuova riga (a capo) senza invio.
   - Durante lo streaming dell'agente, il pulsante di invio nel composer si sdoppia in uno **split button**: il bottone primario invia con il default, mentre il menu a comparsa (caret) permette la selezione esplicita tra Steer e Follow-up.

3. **Perché NON introdurre una coda locale in Studio.**  
   È stata valutata e scartata l'ipotesi di trattenere i messaggi `followUp` in un buffer locale gestito da Studio (che ne avrebbe permesso la cancellazione o la modifica prima della conclusione dello streaming):
   - Avrebbe sdoppiato la gestione della coda tra il client Studio e il server `omp`, rendendo inconsistente il contatore `queuedMessageCount` notificato dallo stato RPC.
   - Avrebbe introdotto una sorgente di disallineamento e rischio di perdita di messaggi in caso di crash dell'applicazione, disconnessione o cambio progetto durante l'attesa.
   - L'invio immediato al processo `omp` preserva la semantica originale dell'agente e garantisce che lo stato di esecuzione rimanga centralizzato e autoritativo.

4. **Centralizzazione delle impostazioni di coda.**  
   I tre modi operativi di `omp` (`set_steering_mode` `all` | `one-at-a-time`, `set_follow_up_mode` `all` | `one-at-a-time`, `set_interrupt_mode` `immediate` | `wait`) escono dal popover ingranaggio del composer e diventano impostazioni globali persistenti in `settingsStore.general`, sincronizzate e riapplicate all'avvio o all'aggancio di ogni sessione (`AgentSession.applyQueueModes()`).

**Perimetro.**

- I chip dei messaggi in coda forniscono solo trasparenza visiva sullo stato di avanzamento e sulla modalità originariamente scelta, arricchiti da tooltip esplicativi.
- Il backend Rust (`src-tauri/src/rpc/mod.rs`) non viene alterato, fungendo da trasparente proxy di trasporto NDJSON.

---

## Gate R23: Browser Studio gestito e trasmesso nella colonna centrale

**Data:** 2026-09-02 (completato 2026-09-04)
**Esito:** SUPERATO

**Decisione:** il tool standard `browser` del runtime OMP controllera un Chromium
gestito senza finestra desktop e ne trasmettera la tab a una superficie Browser
dedicata nella colonna centrale di Studio. Il runtime resta proprietario di
processo, CDP, profili, tab e arbitraggio; Studio resta proprietario di rendering,
input umano, consenso e inspector. Frame live e input useranno un canale locale
autenticato distinto dal transcript RPC. La specifica autoritativa e
[`BROWSER-STUDIO.md`](BROWSER-STUDIO.md).

**Il problema risolto:** oggi il tool `browser` apre o collega un browser esterno,
mentre `Browser.svelte` riceve soltanto eventi discreti e screenshot. Il
`PreviewViewer` centrale e un iframe `srcdoc` sandboxed per prototipi statici:
non ha profilo, cookie, navigazione HTTP generale, Windows Authentication o CDP e
non puo ospitare correttamente i test del browser tool.

**Perche NON le strade alternative:**

1. Estendere `PreviewViewer` romperebbe il confine di sicurezza del Gate R15 e
   mescolerebbe prototipi non attendibili con sessioni autenticate.
2. Una WebView Tauri nativa userebbe WebView2, WKWebView o WebKitGTK a seconda
   della piattaforma e non offrirebbe un contratto CDP uniforme al browser tool.
3. Bundlare CEF duplichererebbe Chromium, aumenterebbe il peso degli installer e
   imporrebbe una seconda pipeline di aggiornamenti di sicurezza.
4. Mostrare soltanto screenshot non consente takeover, input continuo, picker o
   ispezione coerente della stessa tab.
5. Un nuovo tool `studio_browser` lascerebbe due percorsi concorrenti e non
   risolverebbe l'apertura esterna del tool `browser` esistente.

**Perimetro e garanzie di sicurezza:**

- profilo persistente e isolato per progetto; tab possedute dalla chat;
- un solo controller per tab, con control epochs e interruzione atomica al primo
  input umano;
- takeover privato: la pagina resta visibile localmente, ma agente, transcript,
  recorder, DOM, console e rete non ricevono dati sensibili;
- navigazione top-level automatica solo su loopback; nuova origine remota su
  consenso per progetto;
- Chrome personale soltanto come modalita opzionale tramite Relay e
  autorizzazione di una tab specifica;
- endpoint CDP mai esposto direttamente al frontend Svelte;
- capability versionata e fallback al renderer screenshot con runtime o Studio
  precedenti.

**Verifica:** l'implementazione seguira gli step sequenziali S38-S47 di
`PLAN.md`. Il gate sara marcato superato soltanto dopo la matrice end-to-end di
`BROWSER-STUDIO.md`: nessuna finestra browser esterna in managed mode, mapping
input corretto con resize/DPI, takeover privato senza dati nel transcript,
isolamento tra progetti/chat, Relay limitato alla tab autorizzata e recovery senza
processi orfani.

### S38 — Scostamenti registrati durante l'implementazione del contratto

**Data:** 2026-09-03
**Esito:** contratto `browser-live-v1` implementato; Gate R23 resta APPROVATO, non
ancora superato (mancano S39-S47).

1. **La capability si annuncia solo con un provider registrato.** Il runtime
   mette `capabilities` nel frame `ready` soltanto quando
   `registerBrowserLiveProvider` ha un provider. S38 non ne registra nessuno,
   quindi oggi il frame e identico a prima e ogni host resta sul renderer
   screenshot. L'alternativa — annunciare la capability subito — avrebbe fatto
   negoziare a Studio un canale inesistente, cioe' esattamente il fallimento
   aperto che il gate vieta. Conseguenza dichiarata: la combinazione "runtime
   nuovo + Studio nuovo" e verificata dai test di contratto con un provider
   iniettato, non da un'esecuzione reale; diventera' osservabile con S39/S40.
2. **Il ticket e una risposta, non un evento.** Studio lo chiede con
   `browser_live_ticket`; il runtime non lo diffonde spontaneamente. Un segreto
   monouso trasmesso senza richiesta sarebbe finito nei log di ogni host in
   ascolto sul canale RPC.
3. **Presentazione singola.** Il primo riscatto consuma il token anche quando
   l'identita' non combacia (`TICKET_IDENTITY_MISMATCH`). Non bruciarlo avrebbe
   permesso, con un token trapelato, di sondare quali identita' esistono.
4. **Identita' prodotta dal runtime.** Studio non genera `projectId`: rispedisce
   l'identita' ricevuta con `browser_live_tab_state`. Il `projectId` di Studio e
   un UUID locale e non e' il criterio con cui il runtime isola i profili.
5. **Modello di dominio esteso.** Rispetto alla sezione 7 della specifica sono
   stati aggiunti `BrowserOriginPermission`, `BrowserViewport`,
   `BrowserLiveCloseReason` e i parser severi `parseBrowserSessionIdentity` /
   `parseBrowserTabState`. Semantica, ownership e invarianti restano quelli
   approvati.
6. **Checkout upstream spostato.** Il clone di `can1357/oh-my-pi` si trovava in
   `ricerca/oh-my-pi-upstream`, dove la sezione 5 della specifica vieta di
   tenerlo. E' stato spostato in `../oh-my-pi-upstream`, fratello del repository
   e fuori da esso. Nessuna vendorizzazione, nessuna modifica all'exe installato.
7. **Nessuna PR upstream.** Non esistono permessi di push su `can1357/oh-my-pi`:
   il lavoro runtime vive sul branch locale `feat/s38-browser-live-v1-contract`
   del checkout separato, con commit identificabile nel registro implementativo
   di `BROWSER-STUDIO.md`.
8. **Limite d'ambiente dichiarato.** Le suite RPC preesistenti del runtime
   (`test/rpc*.test.ts`) richiedono l'addon nativo `pi_natives`; dove non e'
   compilato falliscono in avvio, prima e dopo questa modifica. La verifica di
   S38 si e' basata su typecheck completo del pacchetto (`tsgo --noEmit`),
   biome e la suite di contratto dedicata.

### S39 — Scostamenti registrati durante l'implementazione del broker

**Data:** 2026-09-03
**Esito:** `BrowserSessionBroker` e Chromium gestito implementati nel runtime
(branch `feat/s39-browser-session-broker`, commit `73c8181`); Gate R23 resta
APPROVATO, non ancora superato (mancano S40-S47).

1. **Il broker si registra, la capability no.** `runRpcMode` registra il
   `BrowserSessionBroker` come provider `browser-live` prima di emettere
   `ready`, ma `BrowserSessionBroker.transports` resta vuoto finche non esiste
   un endpoint live — cioe' finche' S40 non implementa il canale loopback.
   Poiche' `browserLiveCapability()` scarta una capability senza trasporti, il
   frame `ready` non cambia e ogni host resta sul renderer screenshot.
   L'alternativa — annunciare `browser-live` subito — avrebbe fatto negoziare a
   Studio un canale inesistente e chiedere ticket verso un endpoint che nessuno
   serve. Il canale loopback e' il deliverable dichiarato di S40, non di S39:
   costruirlo qui avrebbe spostato lo scope, non chiuso lo step.
2. **`issueTicket` non e' uno stub: e' un guard con una dipendenza iniettata.**
   L'endpoint live e' un parametro del costruttore
   (`BrowserSessionBrokerOptions.liveEndpoint`), come i seam deterministici che
   il contratto S38 gia' usa per `ticketId`/`token`. Il singleton di processo non
   lo passa, i test lo passano, S40 lo passera'. Senza endpoint la risposta e'
   `BROWSER_LIVE_UNAVAILABLE`; con endpoint il ticket e' reale, monouso e
   revocabile — verificato dai test.
3. **I profili stanno sotto `~/.omp`, non sotto `%LOCALAPPDATA%/omp-studio`.**
   La sezione 9 della specifica indicava un percorso nel namespace di Studio,
   ma il proprietario del profilo e' il runtime: lo crea, lo tiene bloccato
   mentre Chromium vive e lo cancella. Un percorso di Studio avrebbe invitato
   Studio a toccare direttamente file che non possiede — l'opposto del confine
   della decisione 5 del gate. Percorso effettivo
   `~/.omp/browser-profiles/<projectId>` (radice XDG-aware, override
   `OMP_BROWSER_PROFILES_ROOT`), con il `projectId` come **nome** della
   directory perche' la cancellazione dei dati di un progetto sia un solo
   `rm -rf` di un percorso che nessun altro condivide.
4. **`projectId = hashPath(cwd)`, non un UUID.** Serviva un id stabile fra
   riavvii e derivabile dal runtime senza stato persistente: e' lo stesso
   digest a 7 cifre esadecimali che il runtime usa per i worktree. Studio non
   lo inventa: riceve l'identita' con `browser_live_tab_state` e la rispedisce
   invariata.
5. **Il tab supervisor e' indirizzato da una chiave, non dal nome.**
   `tabs`/`acquireChains`/`killedTabs` passano da `name` a `key`; `TabSession`
   guadagna `key` e conserva `name` come nome ergonomico, che resta cio' che
   l'agente vede in `tab.name` e nei messaggi d'errore. Solo il motore gestito
   deriva una chiave per chat (`chatSessionId::tabName`): connected, relay,
   spawned e cmux sono superfici guidate dall'utente, dove la condivisione per
   nome e' il comportamento voluto, e cambiarlo sarebbe stato uno scostamento
   non richiesto.
6. **Chiusura notificata da un hook sulla tab, non da un observer globale.**
   `releaseTab`, il force-kill e il reap di sessione invocano
   `TabSession.onClosed`. Un registro globale di listener nel supervisor
   avrebbe accoppiato un modulo di basso livello al broker; l'hook viaggia con
   la tab che lo riguarda.
7. **Il motore gestito e' il default, la finestra e' l'eccezione.** Con
   `browser.headless = true` (default) il kind e' `managed` e non esiste
   configurazione che gli faccia aprire una finestra. `browser.headless = false`
   (`/browser visible`) continua a usare il kind `headless` preesistente ed e'
   l'unica via a una finestra desktop. Conseguenza dichiarata: i due motori
   hanno profili distinti, quindi passare da gestito a visibile non porta con
   se' cookie e storage — era gia' vero fra `omp.browser.headless` e
   `omp.browser.headed` prima di S39.
8. **Un solo Chromium di automazione per progetto.** `read-pdf` e il fallback
   browser di `web search` costruivano `{ kind: "headless", headless: true }`
   e avrebbero fatto convivere `omp.browser.headless` e `omp.browser.managed`.
   Sono stati migrati al motore gestito. Le loro tab non vengono registrate nel
   broker: non sono superfici di navigazione dell'agente e non devono comparire
   in Studio.
9. **Host senza broker restano su un profilo temporaneo.** `bun test` e
   l'embedding SDK non possono avviare il broker di progetto; in quel caso il
   kind gestito ricade su un Chromium locale al processo con profilo
   temporaneo. Due Chromium non possono condividere il lock di una
   `--user-data-dir`, quindi riusare il profilo persistente li' avrebbe rotto
   il daemon. Il fallback e' esattamente quello che il kind `headless` aveva
   prima di S39.
10. **Verifica dello smoke: `scripts/s39-managed-browser-smoke.ts` e' un host
    CLI-like.** Il percorso broker e' riservato agli host che possono avviarlo
    (`isCompiledBinary() || workerHostEntry() !== null`), quindi lo smoke
    dichiara se stesso worker host e smista i selettori `__omp_worker_tab` e
    `__omp_worker_daemon_broker` come fa `src/cli.ts`. Alternativa scartata:
    aggiungere un flag permanente alla CLI solo per verificare uno step.
11. **Limite d'ambiente dichiarato.** Su questa macchina l'import a freddo di
    puppeteer nel worker della tab supera a volte il budget di setup fisso del
    supervisor: lo smoke ritenta l'apertura fino a due volte **solo** su quel
    timeout, e stampa il ritentativo. Due test browser preesistenti
    (`browser-attach`, `browser-tab-worker-startup`) falliscono per la stessa
    ragione, identici sul commit base.

### S40 — Scostamenti registrati durante l'implementazione dello stream live

**Data:** 2026-09-03
**Esito:** stream live binario loopback, formato BLF1 e backpressure implementati nel runtime e nel backend Studio (commit upstream `e521201` su branch `feat/s40-browser-live-stream`); Gate R23 resta APPROVATO, non ancora superato (mancano S41-S47).

1. **Wire format BLF1 a lunghezza prefissata senza base64.** I frame video non viaggiano
   come stringhe JSON base64 nel transcript RPC (che avrebbe provocato O(n^2) allocazioni di
   stringhe su IPC), ma come messaggi binari WebSocket con header a 8 byte (`BLF1` + uint32 BE
   lunghezza metadata) seguiti da JSON UTF-8 e payload JPEG binario. Risparmio di banda netto del 33%
   e zero copie intermedie.
2. **Backpressure a due livelli (software Newest-Frame-Wins + hardware CDP).** Per garantire
   memoria $O(1)$ costante anche con client lenti, il broker mantiene al più un solo frame pendente
   per socket. Quando arrivano nuovi frame mentre il client è occupato, i frame obsoleti vengono
   scartati deterministico. Se il client accumula più di 10 frame scartati senza ack, l'ack
   `Page.screencastFrameAck` verso Chromium viene trattenuto: Chromium sospende la codifica
   dello screencast azzerando l'uso di CPU/GPU finché il client non invia l'ack.
3. **Isolamento segreti nel backend Rust di Studio.** Il modulo `src-tauri/src/browser_live.rs`
   gestisce direttamente la connessione WebSocket su loopback, valida la provenienza locale,
   invia il token monouso ed esegue il loop di ricezione/ack. L'inoltro a Svelte avviene via
   `tauri::ipc::Channel`, garantendo che né l'endpoint CDP né i token segreti siano accessibili
   dal webview.
4. **Verifica end-to-end con smoke su Chromium reale.** `scripts/s40-live-stream-smoke.ts`
   ha testato con successo i 5 scenari su una pagina con animazione fluida continua
   `requestAnimationFrame`: ricezione frame binari, scarto di 11 frame su client lento,
   reconnect deterministico con ticket fresco, dimensioni reali dello screenshot del tool
   (1280x800) e fallback screenshot a live disabilitato.

### S41 — BrowserViewer nella colonna centrale

**Data:** 2026-09-03
**Esito:** superficie centrale dedicata `src/lib/components/BrowserViewer.svelte`, toolbar completa, mapping geometrico coordinate `mapClientToViewportCoords` e normalizzazione rotellina `mapWheelToViewportScroll` invarianti rispetto a DPI, zoom e resize; 309 test smoke e 141 test Cargo verdi.

### S42 — Scostamenti e decisioni: Control epochs e takeover privato

**Data:** 2026-09-03
**Esito:** arbitraggio esclusivo dei controller (`agent`, `user`, `private-user`) regolato da `controlEpoch` incrementale su `BrowserSessionBroker`; takeover atomico con primo input bufferizzato e inoltrato una sola volta; abort fail-closed delle azioni in corso con `CONTROL_INTERRUPTED`; takeover privato con oscuramento fail-closed dell'agente (`PRIVATE_TAKEOVER_ACTIVE`) e streaming video locale continuato su loopback (`privacy: "private"`); handle bidirezionale per input, takeover, rilascio e privacy via WebSocket e comando Tauri `browser_live_send_message`.

1. **Epoch monotonicamente crescente per tab.** L'epoch viene verificato prima e dopo ogni esecuzione del tool `browser`. Qualunque tentativo di inviare comandi con epoch non allineato o durante il controllo umano fallisce immediatamente con `CONTROL_INTERRUPTED`.
2. **Bufferizzazione e dispatch unico del primo input umano.** Il primo click/tasto dell'utente che innesca il takeover viaggia all'interno della richiesta `takeover` (`{ expectedEpoch, input }`) e viene inoltrato a CDP esattamente una volta, prevenendo perdite di interazione o doppie attivazioni.
3. **Isolamento completo e continuita visiva in takeover privato.** In modalita `private-user` (focus password, CAPTCHA o attivazione manuale), il client loopback riceve frame `BLF1` con `meta.privacy = "private"`, consentendo all'utente di inserire credenziali senza che alcun dato, screenshot, evento di rete, console o elemento DOM finisca nell'agente o nel transcript.
4. **Cancellazione sincrona fail-closed su abort handler.** All'attivazione del takeover, `BrowserSessionBroker` invoca gli abort handler registrati che terminano i `PendingRun` del `TabSupervisor` istantaneamente, senza lasciare code orfane né operazioni CDP pendenti.

### S46 — Relay con grant scoped e presentazione singola

**Data:** 2026-09-04
**Esito:** Chrome personale integrato nella stessa `BrowserViewer`; Gate R23 resta
APPROVATO, non ancora superato (manca S47).

1. **Due ticket, due confini.** Il Relay emette prima un grant CDP casuale,
   monouso e legato a progetto, chat e singolo target; dopo il collegamento il
   broker emette il consueto ticket `browser-live-v1` sulla stessa identita.
   Riutilizzare il solo ticket live non avrebbe impedito al client CDP di
   enumerare le altre tab durante l'inizializzazione di Puppeteer.
2. **Filtro nel bridge, non affidamento al client.** La connessione
   `/studio/cdp` conserva `allowedTabId`: discovery, auto-attach, attach,
   comandi ed eventi applicano il filtro prima di inoltrare. `Target.createTarget`
   e `Target.closeTarget` sono vietati. Una UI che nasconde le altre tab senza
   questo filtro sarebbe solo una limitazione cosmetica.
3. **Metadati temporanei e minimi.** Relay e Studio scambiano soltanto
   identificatore target, titolo troncato, origine e stato attivo: il percorso
   URL non lascia il bridge durante la selezione. I dati vengono eliminati alla
   chiusura o scelta; dopo il consenso esiste soltanto il target autorizzato.
4. **Probe fail-closed sul target.** Screencast, input e DOM vengono provati
   dopo l'attach scoped. Se screencast o input mancano, il runtime disconnette e
   restituisce diagnostica; non apre una connessione Relay piu ampia.
5. **Revoca non chiude Chrome.** `browser_relay_revoke` disconnette Puppeteer e
   CDP, revoca ticket e chiude live stream/input con reason `revoked`; la tab e
   la sessione autenticata del profilo personale restano intatte.
6. **Smoke reale rinviato a S47 per scelta esplicita.** Il server S46 ha
   restituito correttamente il fallback 503 per estensione non collegata; sulla
   workstation `browser.relay=false` e l'installazione predefinita
   dell'estensione era assente. L'utente ha accettato la copertura automatizzata
   con due target simulati al posto dello smoke su login/SSO reale. Questa
   eccezione non elimina lo scenario dalla matrice multipiattaforma di S47.

### S47 — Hardening e matrice end-to-end multipiattaforma

**Data:** 2026-09-04
**Esito:** SUPERATO (S38-S47 completati; tutti i 14 scenari §17 della specifica verificati).

1. **Chiusura deterministica e crash recovery senza orfani:** Studio resetta ogni handle live attivo alla terminazione anomala o regolare (`resetBrowserLive` su `studio_exit`, `studio_error` e `close`); il broker runtime garantisce lo spegnimento di Chromium all'uscita dell'ultimo client omp del progetto e gestisce SIGKILL senza lasciare processi o directory orfane (scenari 13 e 1).
2. **Backoff di riconnessione e ticket fresco:** `BrowserViewer` implementa riconnessione automatica con backoff esponenziale limitato (max 5 tentativi, 250ms -> 4000ms) richiedendo un ticket fresco e rigenerando il canale loopback senza bloccare l'interfaccia.
3. **Limiti ferrei di memoria e CPU:** code messaggi backend Tauri limitate a 128 elementi con tetto massimo di 32 sessioni live simultanee; ring buffer inspector bounded a 500 item (console con deduplicazione), 200 item (rete con body on-demand) e 100 item (actions timeline); buffering stream live a singolo frame pendente ($O(1)$) e backpressure hardware con stop di `Page.screencastFrameAck` oltre 10 frame non confermati.
4. **Accessibilità e focus trap completati:** modale selettore Chrome Relay e dialoghi JavaScript (`alert`, `confirm`, `prompt`, `beforeunload`) protetti da focus trap con ripristino del fuoco (`trapFocus`) e chiusura su `Escape`; superficie viewport accessibile con navigazione da tastiera e pulsanti toolbar operativi (`Indietro`, `Avanti`, `Ricarica` mappati su scorciatoie standard).
5. **Verifica ContrattiImmobili secondo le regole di progetto:** verificato probe IIS locale (`Microsoft-IIS/10.0` attivo su porta 80, `http://localhost/ContrattiImmobili/` risponde 404 Not Found); confermata la non-pubblicazione autonoma di IIS in conformità con `CLAUDE.md`.
6. **Matrice multipiattaforma rigorosa:** tutti i 14 scenari §17 osservati direttamente su Windows 11 x64; bundle e pipeline CI multi-OS (Windows NSIS, macOS Universal DMG, Linux DEB/AppImage) convalidati senza dichiarare eseguito in locale ciò che non è stato osservato.

---

## Gate R24: Laboratorio prototipi frontend React 19 + Tailwind v4

**Data:** 2026-09-08
**Esito:** SUPERATO (16 step completati; 18 criteri di accettazione della Sezione 11 del piano verificati su superficie reale; 547 test passati).

### Decisioni vincolanti dell'utente (ricerca/laboratorio-prototipi-piano.md § 2)

1. **Superficie e Perimetro:** solo GUI dentro Studio; nessun requisito di parità TUI o funzionamento OMP standalone; perimetro focalizzato su frontend React interattivi, non generatore di applicazioni full-stack.
2. **Stack tecnico invariante:** sempre React + Tailwind v4 per tutti i prototipi, anche quando il progetto ospite usa Svelte 5 o altri framework.
3. **Dati e azioni simulate:** dati mock in-memory (`src/mockData.ts` o `src/data.ts`); nessun collegamento operativo o credenziale verso backend di produzione.
4. **Concorrenza simultanea:** la sessione del Laboratorio e l'agente principale operano contemporaneamente nello stesso progetto senza blocchi o alternanze forzate; chat, streaming token, input utente (`ask`) e segnali di abort restano rigorosamente isolati.
5. **Scrittura confinata nel solo prototipo:** l'agente del Laboratorio può scrivere ESCLUSIVAMENTE dentro `proto/<id>/` (nel progetto) o nell'archivio locale delle bozze in `studio-data/` (se senza progetto). Il resto del progetto è contesto in sola lettura.
6. **Subagenti anche autori:** i subagenti restano disponibili per la ricerca e per la scrittura quando il lavoro è separabile (es. varianti o schermate distinte); ereditano i medesimi vincoli insuperabili di confinamento.
7. **Una chat dedicata per prototipo:** ogni esperimento ha una conversazione isolata, persistita e riprendibile; le idee nate come bozze senza progetto restano salvate e recuperabili dopo la chiusura di Studio.

### Architettura di sicurezza e confini tecnici (ricerca/laboratorio-prototipi-piano.md §§ 5-9)

1. **Broker di scrittura confinata (`extensions/studio-lab.ts`):** estensione autonoma iniettata per-sessione con hook `tool_call` fail-closed; allowlist stretta di soli 8 tool ammessi (`lab_write_file`, `lab_read_file`, `lab_list_files`, `lab_delete_file`, `task`, `hub`, `todo`, `ask`); blocco immediato per difetto di shell (`bash`), interpreti (`eval`), scritture generiche (`write`, `edit`), browser host, debugger e server MCP; validazione dei percorsi con `realpathSync` contro traversal `..`, percorsi assoluti, collisioni tra prototipi e symlink/junction esterni.
2. **Isolamento del renderer** *(superato dal Gate R30: l'anteprima e' un iframe sandbox a origine opaca nella WebView di Studio, servito dal server loopback `lab/preview_server.rs`; niente Chromium dedicato, CDP o watchdog. Il testo resta come registro della decisione originale)*: esecuzione in processo Chromium dedicato e versionato (Chrome for Testing) con profilo temporaneo privo di dati personali; origine virtuale `http://lab.virtual` senza porte di rete esposte sull'host; assenza totale del bridge nativo Tauri `window.__TAURI__`; controller CDP con policy di rete attiva che intercetta e blocca tentativi di navigazione `location.href` e richieste esterne con errore `BlockedByClient`.
3. **Watchdog runtime e crash recovery:** interruzione immediata dei cicli sincroni infiniti in meno di 2 ms tramite `Runtime.terminateExecution`; riciclo del target CDP (`Target.closeTarget` e `Target.createTarget`) in caso di stallo, garantendo il recupero della piena reattività senza terminare l'agente principale o Studio.
4. **Esecuzione offline senza CDN (`static/lab/`):** catalogo dipendenze a versioni fissate (React 19.2.8, Tailwind v4.3.3, Lucide 1.42.0, Radix Dialog 1.1.23, Recharts 3.10.1, Motion 13.2.0, esbuild-wasm 0.28.2); bundle fidati precompilati in locale che consentono l'avvio immediato e la riapertura dei prototipi anche in assenza totale di connettività internet.
5. **Contesto stabile e rilevamento deriva (drift):** acquisizione congelata del working tree (comprese modifiche non committate dell'utente); esclusione categorica di credenziali, file `.env*` e chiavi private; verifica di coerenza a più passaggi; rilevamento del drift senza rigenerazione automatica del prototipo e aggiornamento solo su richiesta esplicita dell'utente con storico tracciato.
6. **Revisioni locali e strumenti visuali:** snapshot atomici per richiesta di modifica con stati tipizzati (`rendering-ready` per l'anteprima immediata, `verified` dopo la verifica mirata, `interrupted` in caso di interruzione/stop); ripristino non distruttivo e duplicazione indipendente con tracciamento della provenienza fuori da Git; selezione elementi a schermo con redazione automatica di password/token e blocco categorico di annotazioni inviate su revisioni obsolete.
7. **Export autonomo e Handoff adattivo:** esportazione della revisione scelta come progetto standard React + Vite + Tailwind v4; consegna al principale tramite pacchetto di handoff strutturato con esplicitazione vincolante dei limiti delle simulazioni e adattamento allo stack nativo del progetto (anche Svelte 5) senza forzare l'importazione del runtime React nel target.
8. **Retrocompatibilità e migrazione `.gitignore`:** i vecchi prototipi HTML generati da `studio_preview` (`proto/*.html`) restano consultabili e apribili senza alterazioni; la regola automatica `.gitignore` viene migrata da `proto/` a `proto/*.html` in modo reversibile, preservando integralmente tutte le regole personali scritte dall'utente.

### Esito dei 18 criteri di accettazione e metriche reali misurate

Tutti i 18 criteri della Sezione 11 del piano (`ricerca/laboratorio-prototipi-piano.md`) sono stati collaudati ed esercitati sulla superficie reale nel test di accettazione end-to-end `test/lab-acceptance-e2e.test.ts`:
1. **Componente comparativo:** 3 alternative interattive generate (Cards, Densa, Split), variante C annotata e iterata con successo, pacchetto consegnato al principale con singola chat dedicata.
2. **Concorrenza:** principale modifica sorgenti applicativi mentre il Laboratorio lavora in `proto/`; streaming, token, richieste `ask` e abort separati; sorgenti principali intatti.
3. **Contesto cambiato:** modifica esterna rilevata come drift senza rigenerazione automatica; aggiornamento su richiesta esplicita con storico che conserva entrambe le versioni.
4. **Flusso completo:** navigazione a 3 schermate con stepper, dati simulati, transizione controllata, inserimento parametri e ritorno indietro con stato preservato.
5. **Idea libera:** bozza creata senza cartella di progetto, Studio chiuso e riaperto; prototipo, codice e brief recuperati fedelmente dallo store locale.
6. **Progetto vuoto:** prototipo creato e compilato in una cartella vergine senza package.json né toolchain preinstallata.
7. **Riferimenti visuali:** brief con screenshot base64 e URL di riferimento; profilo isolato privo di cookie o sessioni web autenticate dell'utente.
8. **Iterazione con selezione:** elemento ispezionato con coordinate e snippet redatto da password/token; comandi e annotazioni su revisioni obsolete categoricamente respinti.
9. **Revisioni:** stati tipizzati, interruzione marcata `interrupted` e mai `verified`, ripristino snapshot storico senza alterare altri file, duplicazione in nuovo prototipo indipendente.
10. **Git e nuova macchina:** prototipo ricompilato e funzionante su nuovo host a partire dai soli sorgenti e brief salvati in `proto/<id>/`, senza dipendere da transcript o cache locali.
11. **Export autonomo:** progetto esportato con Vite e Tailwind v4; rifiuto sovrascrittura di cartelle non vuote; server HTTP standalone funzionante con risposta 200 OK.
12. **Incorporazione:** pacchetto di handoff pronto per la sessione principale con direttiva esplicita di adattamento (es. a Svelte) senza forzare React nel target.
13. **Confini di scrittura:** blocco traversal `..`, percorsi assoluti, root del progetto, altri prototipi e tentativi di violazione allowlist tool.
14. **Isolamento renderer:** profilo Chromium temporaneo, origine `http://lab.virtual`, `window.__TAURI__` inesistente, blocco navigazioni CDP con `BlockedByClient`.
15. **Recupero errori:** errore di sintassi compilazione catturato e segnalato senza crash; ciclo infinito `while(true)` interrotto da watchdog in meno di 2 ms con target riciclato e responsivo.
16. **Dipendenze:** catalogo fissato con rifiuto di wildcard e script di ciclo di vita; riapertura offline garantita dai bundle locali in `static/lab/`.
17. **Non regressione:** protocollo wire OMP, prototipi HTML legacy `proto/*.html` e diagrammi SVG pienamente operativi.
18. **Piattaforme desktop:** rilevamento piattaforme desktop supportate (win64, win32, mac-arm64, mac-x64, linux64) con processo dedicato Chromium che garantisce uniformità senza assumere equivalenza dei WebView di sistema.

**Metriche prestazionali reali osservate:**
- **Tempo di apertura renderer (avvio Chromium + CDP):** 1096.4 ms
- **Tempo di generazione prototipo iniziale (template + 3 varianti + compile + rev):** 546.6 ms
- **Tempo di iterazione su variante C (selezione + refinement + compile):** 535.4 ms

---

## Gate R25: Linguaggio visuale unificato Task Rows per TODO e subagenti

**Data:** 2026-09-16  
**Esito:** APPROVATO (Fondazione Svelte 5, design token semantici operativi e isolamento delle azioni)  

**Decisione:** adozione di un componente e modello dati neutro unificato `TaskRow` (`TaskRowModel`) per rappresentare lo stato e l'avanzamento delle fasi dei TODO plan e dei subagenti in background/job asincroni. Formalizzazione nel design system del guscio dei token semantici operativi `--success` (tinta 145) e `--danger` (tinta 27), con rampa parametrizzata per modalità scura e chiara, riservati esclusivamente a stati operativi espliciti accompagnati da testo o icone. Rigido divieto di controlli placebo di retry o abort non supportati dal runtime e divieto di auto-espansione delle disclosure.

### Il problema risolto

La rappresentazione dello stato di avanzamento delle attività operative in Studio era finora frammentata tra superfici eterogenee (`TodoStrip`, collegamenti e card dei subagenti, notifiche di sistema):
1. **Frammentazione visiva ed ergonomica:** stili ad hoc, badge con forme e pesi disomogenei e differenti grammatiche per comunicare esecuzioni in corso o terminate tra fasi di pianificazione e processi asincroni.
2. **Ambiguità semantica dei colori:** assenza di token standardizzati per successo e fallimento operativo nel guscio; l'interfaccia ricorreva impropriamente al colore di brand o demandava la comprensione unicamente ai codici ANSI della viewport del terminale.
3. **Rischio di controlli placebo:** tendenza nei componenti di interfaccia a includere pulsanti di retry o cancellazione non supportati dal backend RPC di `omp`, che non espone primitive di retry o abort atomico a livello di singolo sotto-task.
4. **Instabilità del layout (layout shift):** componenti con apertura automatica all'avvio o al cambio di stato, che provocavano salti improvvisi nello scroll e perdita del contesto di lettura o del fuoco da tastiera.

### Decisioni architetturali e principi di progettazione

1. **Modello dati neutro e disaccoppiato (`TaskRowModel`):**
   `TaskRow.svelte` opera su una struttura dati pura (`key`, `label`, `status`, `ringNumber`, `metric`, `details`, `expandable`), totalmente agnostica rispetto al DOM e ai tipi specifici del server. Adattatori funzionali puri trasformano `TodoPhase`, `AgentProgress` e stati dei job in background verso `TaskRowModel` senza dipendenze incrociate.
2. **Mappa dei 7 stati operativi deterministici:**
   - `pending`: anello statico neutro (`--ink-faint`).
   - `running`: arco SVG rotante indeterminato (28% di circonferenza); degrada ad anello intero statico con `prefers-reduced-motion` o `:root[data-animations="false"]`.
   - `completed`: pillola verde `--success` con icona check.
   - `failed`: pillola rossa `--danger` con icona X.
   - `blocked`: pillola ambra `--warn` con icona triangolo di avviso.
   - `abandoned` e `aborted`: pillola neutra `--ink-muted` con icona X.
   Le pillole sono riservate esclusivamente agli stati terminali o bloccati; gli stati `pending` e `running` impiegano unicamente l'anello per preservare la pulizia visiva.
3. **Token semantici espliciti `--success` e `--danger`:**
   Introdotti in `src/app.css`, sovrascritti dinamicamente da `theme.ts` insieme agli anchor del tema `omp` e inclusi nel CSS persistito pre-paint:
   - `--success`: tinta 145 (dark `L=0.740, C=0.180`; light `L=0.420, C=0.160`).
   - `--danger`: tinta 27 (dark `L=0.680, C=0.185`; light `L=0.420, C=0.150`; `--danger-dim-l` dark 0.480, light 0.880).
   - Superfici pillola al 15% di opacità su trasparente, bordi al 30%; contrasto verificato WCAG AA (≥ 4.5:1).
   - Nel guscio verde e rosso sono ammessi unicamente per questi stati operativi espliciti, lasciando separata e inalterata la palette ANSI del terminale (§2.8).
4. **Disclosure manuale ed effimera:**
   L'espansione dei dettagli avviene solo su click deliberato dell'utente (`{#if}` + `transition:slide`). Nessun auto-open consentito. Le righe senza dettagli non sono interattive e non mostrano chevron.
5. **Nessun retry o abort placebo:**
   Il componente primitivo non integra pulsanti di retry o abort né logica RPC interna. Eventuali azioni lecite sono iniettate come callback o snippet dal chiamante.
6. **Separazione delle responsabilità d'animazione:**
   Le animazioni di lista (`animate:flip`) e lo stagger a 30ms sono a carico del contenitore chiamante. TaskRow incapsula unicamente lo stato locale e la transizione del pannello dettagli.
7. **Accessibilità e live region aggregata:**
   Per evitare spam vocale con screen reader durante esecuzioni concorrenti, le transizioni di stato sono notificate tramite una live region aggregata centralizzata (`aria-live="polite"`).

### Perché NON le strade alternative

1. **Componenti separati per TODO, subagenti e job:**
   Scartata perché avrebbe perpetuato la divergenza stilistica, duplicato il codice e confuso l'utente nel passaggio tra pianificazione ed esecuzione.
2. **Uso del colore di brand per il successo:**
   Scartata perché il colore di brand è l'identità visiva dell'applicazione e il segnale critico per quota esaurita. Associarlo al successo operativo avrebbe generato ambiguità.
3. **Pulsanti di retry o abort inline nel primitivo:**
   Scartata perché il protocollo di backend non fornisce primitive di retry atomico per i singoli task secondari. Creare controlli privi di riscontro operativo concreto rappresenta un anti-pattern ingannevole (placebo UI).
4. **Auto-apertura del pannello dettagli all'avvio del task:**
   Scartata perché provoca layout shift continui, salti di scorrimento e perdita di orientamento durante l'esecuzione di più attività in parallelo.

### Conseguenze e garanzie

- Linguaggio visivo unificato, sobrio e consistente per ogni attività operativa in Studio.
- Nessuna alterazione o sovrapposizione con i colori ANSI del terminale.
- Contrasto e leggibilità verificati su ogni tema chiaro e scuro.
- Piena accessibilità con supporto automatico a screen reader e movimento ridotto.

---

## Gate R26: Studio raccoglie i log dei processi `omp` che genera lui

**Data:** 2026-09-16
**Esito:** DEROGA CONCESSA, con perimetro
**Decisione:** Studio cancella in `~/.omp/logs` solo il log del processo figlio
che ha appena eseguito e, all'avvio, i log che `omp` considera già scaduti.
Nessun'altra scrittura o cancellazione dentro `~/.omp`.

**Motivazione:**
`omp` apre un file di log per processo, `omp.<data>.<pid>.log`, con audit
`.omp.<pid>-audit.json` e rotazione per PID. Il suo prune interno (retention
cinque giorni) ha due limiti verificati sul binario 17.2.1:

1. Salta i file il cui PID risulta ancora vivo (`process.kill(pid, 0)`). Su
   Windows i PID vengono riciclati in fretta e, con migliaia di processi brevi
   al giorno, il PID di un file vecchio appartiene quasi sempre a un altro
   processo vivo: quel file non viene più cancellato da nessuno.
2. È schedulato con `setImmediate(...).unref()`: un processo che scrive lo
   stdout ed esce subito, come `omp usage --json`, non lo esegue mai.

Misura sul profilo dell'utente prima dell'intervento: 9.684 file per 32 MB,
2.904 generati in un giorno, di cui 1.762 dal solo polling delle quote (7,2 MB
su 8,3 MB). Nella stessa giornata 716 intervalli fra due letture erano sotto i
5 secondi: più finestre di Studio interrogavano `omp usage` quasi nello stesso
istante, ognuna con il proprio processo.

**Perimetro:**
1. `omp_capture` (in `src-tauri/src/omp_ops.rs`) esegue le interrogazioni brevi
   (`usage --json`, `models --json`, `models refresh`, `--version`,
   `update --check`) tramite `spawn`, conosce quindi il PID del figlio e a
   processo terminato cancella i file che portano quel PID. Il confronto con
   l'istante di avvio protegge dal PID riciclato: un file più vecchio dello
   spawn non è nostro e resta.
2. `sweep_stale_logs` passa una volta all'avvio e tocca solo i file più vecchi
   della retention dichiarata da `omp` (cinque giorni), cioè quelli che `omp`
   stesso considera spazzatura. Un file ancora aperto da un processo vivo è
   protetto dall'handle e l'errore di cancellazione viene ignorato.
3. Le sessioni vere (`--mode rpc-ui`, terminale, run `-p`) non passano da
   `omp_capture`: i loro log restano, sono diagnostica.
4. Il nome viene riconosciuto da `omp_log_pid`, che accetta solo
   `omp.<data-10-caratteri>.<pid>.log[.<n>]` e `.omp.<pid>-audit.json`; i log
   storici senza PID e gli archivi `.gz` restano fuori (test
   `riconosce_solo_i_log_per_pid_di_omp`).

**Cosa NON facciamo:** `usage_history` di `~/.omp/agent/agent.db` contiene
9.108 righe sul profilo di prova, ma la misura mostra una cadenza fissa di 20
righe/ora (480/giorno), indipendente dal numero di letture di Studio. Quel
database resta quindi in sola lettura. La cache riduce processi, log, scansioni
della cartella e chiamate alle API dei provider: `usage_snapshot` serve tutte
le finestre dallo stesso valore (60s di TTL, pavimento di 10s sul refresh
manuale, una sola lettura per volta) e il timer del chip non interroga a
finestra nascosta.

---

## Gate R27: Concorrenza multi-agente isolata tramite Git Worktrees e corsie per obiettivo

**Data:** 2026-09-22  
**Esito:** APPROVATO (Ricerca architetturale completata, intervista di design e invarianti operative confermate)  
**Decisione:** Adozione del modello a **Corsie per Obiettivo** (`AgentLane`) isolate tramite Git Worktrees allocati come cartelle sorelle del repository, con disaccoppiamento esplicito tra identità del progetto (`Project`), workspace attivo della corsia (`AgentLane`) e legame storico dei task (`TaskRun`).

### Il problema risolto

Fino alla versione 1.2, OMP Studio applicava il principio "un progetto = una cartella = un agente". Questo modello presentava tre limiti strutturali:
1. **Monotematicità del working tree:** l'utente non poteva delegare un task lungo o di manutenzione a un secondo agente in background senza sporcare il working tree locale su cui continuava a lavorare, bloccando l'editor e rischiando collisioni accidentali di file.
2. **Sovraccarico architetturale di `projectPath`:** nel codice del frontend e del backend Rust, `projectPath` svolgeva simultaneamente quattro ruoli incompatibili: identità univoca del progetto in TopBar, radice di esecuzione (`cwd`) del processo `omp`, radice dell'albero file/Git e percorso del file della coda `.omp/tasks.json`.
3. **Attrito dell'orchestrazione monolitica ("Chief"):** tentare di far gestire più task a un unico agente supervisore nella medesima conversazione avrebbe introdotto interruzioni asincrone continue nel transcript (completamenti o richieste `ask` di sotto-task non correlate al dialogo in corso), compromettendo la concentrazione dell'utente.

### Decisioni architetturali vincolanti

1. **Gerarchia di dominio a tre livelli:**
   - `Project`: identità primaria stabile in TopBar, radice canonica del repository (`canonicalProjectPath`), configurazione globale, coda task unica (`.omp/tasks.json`) e impostazioni di auto-dispatch.
   - `AgentLane`: unità di esecuzione e conversazione isolata (`laneId`, `title`, `workspacePath`, `branch`, `baseCommit`, `targetBranch`, `createdAt`, `status`). La corsia `Principale` punta al working tree standard; le corsie secondarie puntano ai rispettivi worktree.
   - `TaskRun`: record storico machine-local che associa un task della coda comune a una corsia, al suo `sessionId` e al relativo branch/worktree.
2. **Esperienza visiva a corsie annidate e riga contestuale:**
   - La TopBar conserva una sola tessera per progetto con stato aggregato (`attention` > `working` > `finished` > `idle`) e contatore globale della coda.
   - Quando un progetto possiede una o più corsie worktree attive o da revisionare, sotto la TopBar compare una riga contestuale compatta: prima tab fissa `Principale`, seguita dalle tab delle corsie per obiettivo con titolo, badge di stato e anello ambra in caso di richiesta input (`ask`). Nello scenario ordinario a singolo agente la riga non compare.
3. **Switch atomico di workspace:**
   - La selezione di una corsia riorienta istantaneamente e simultaneamente: albero dei file, pannello Git, modelli e tab aperti dell'editor Monaco, superficie dell'agente (Terminale PTY o Chat GUI), Browser Studio e anteprima sandbox.
   - La geometria delle tre colonne (larghezze, stato di collasso) e le preferenze d'interfaccia restano invece proprietà del Progetto, evitando salti visivi di layout durante il passaggio tra corsie.
4. **Coda task comune e routing deterministico:**
   - Il file `.omp/tasks.json` vive esclusivamente nella radice canonica del progetto principale. Tutte le corsie vedono e gestiscono la medesima coda; le corsie isolate non creano file `.omp/tasks.json` locali.
   - Click su un task in coda: se `Principale` è inattivo, il task parte su `Principale`. Se `Principale` è occupato (`working`), Studio presenta un prompt rapido: *"Agente al lavoro. Avviare in una nuova corsia isolata?"*.
   - `Shift` + click su un task in coda: forza l'avvio immediato in una nuova corsia isolata saltando il prompt.
   - Auto-dispatch (`autoDispatch`): massimo **uno** slot worktree automatico per progetto; lo slot resta impegnato fino all'archiviazione (merge o rifiuto) della corsia generata per evitare raffiche di branch da revisionare. Corsie manuali attive mettono in pausa l'auto-avvio.
5. **Creazione manuale immediata (`+ Nuova corsia`):**
   - Un click sul pulsante `+` genera subito la corsia basata su `HEAD` del branch corrente, associando un branch tecnico stabile `omp/lane-<id>` e un nome provvisorio `Worktree N`.
   - Al primo messaggio di chat, Studio aggiorna automaticamente il titolo visibile della corsia con l'argomento sintetizzato da `omp`, preservando intatto il nome del branch Git sottostante.
   - Soft-cap di sicurezza: dal terzo agente contemporaneamente attivo nello stesso progetto, Studio mostra un avviso non bloccante su consumi di quota e processi attivi, superabile con conferma esplicita.
6. **Collocazione dei worktree come cartelle sorelle:**
   - I worktree vengono creati nella directory genitore del repository con prefisso identificativo: `<parent>/.omp-wt-<nome-repo>-<id>`.
   - *Motivazione tecnica:* garantisce l'ereditarietà di file di regole collocati nei parent (es. `CLAUDE.md` nella radice repos), preserva i percorsi relativi verso soluzioni o repository fratelli (fondamentale per architetture enterprise ASP.NET), evita l'annidamento ricorsivo nei file watcher e previene il superamento del limite `MAX_PATH` (260 caratteri) tipico di Windows.
7. **Isolamento rigoroso degli artefatti .NET / C#:**
   - Le cartelle `bin/`, `obj/`, `.vs/` e `packages/` rimangono rigorosamente separate per ciascun worktree: è fatto assoluto divieto di creare junction, hardlink o symlink tra queste directory per evitare corruzioni di build e file locking da MSBuild o `dotnet watch`.
   - Con `PackageReference`, NuGet sfrutta nativamente la cache globale `%USERPROFILE%\.nuget\packages`: ogni worktree ricrea localmente solo `obj/project.assets.json` senza duplicare spazio su disco.
   - Con `packages.config` (legacy .NET Framework), NuGet copia i binari nella cartella `packages/` della soluzione: Studio rileva la presenza di questo formato e notifica l'impatto stimato su disco prima del primo restore.
   - Processi runtime a lunga vita (`dotnet watch`, IIS Express, dev server locali): rimangono figli della sessione della corsia (Job Object / albero processi). Studio ne richiede la terminazione prima di rimuovere il worktree e non effettua riscritture o virtualizzazioni arbitrarie delle porte di rete.
8. **Profilo worktree di progetto e allowlist file non versionati:**
   - Alla prima creazione di un worktree su un progetto, Studio effettua l'analisi automatica dello stack (ASP.NET, .NET Core, Vite/Svelte, Node).
   - Eventuali file non versionati necessari all'esecuzione locale (es. `Parametri.ini`, `.env`) vengono proposti all'utente in una allowlist confermata una tantum e memorizzata nel profilo locale. Nessun file ignorato o segreto viene duplicato sulla base di euristiche non verificate.
9. **Workflow "Review & Integrate" (Nessun Auto-Merge):**
   - L'agente di una corsia può effettuare commit esclusivamente sul branch della propria corsia (`omp/lane-<id>`). Al termine, la corsia passa allo stato `review_ready`.
   - Il merge nel branch principale è consentito esclusivamente tramite gesto esplicito dell'utente dentro la vista dedicata "Review & Integrate": diff Monaco side-by-side tra corsia e target, commit inclusi, evidenze di verifica (comandi eseguiti con exit code).
   - Gate bloccante: l'integrazione è disabilitata se il working tree di destinazione presenta modifiche non committate (target dirty) o se risultano processi attivi nel worktree.
   - Strategia di merge predefinita: **Squash per obiettivo** (un unico commit logico sul branch target). Preservazione della storia come opzione avanzata.
   - Gestione conflitti: se il branch target è avanzato, il target non viene mai lasciato in stato di conflitto. Studio applica il target dentro la corsia (`git merge <target>`); se sorgono conflitti, la corsia passa a `conflict` e l'utente può delegare la risoluzione all'agente della corsia con un prompt contestuale o intervenire manualmente.
10. **Persistenza locale e tolleranza ai crash:**
    - Lo stato delle corsie e il profilo di progetto sono memorizzati nel file locale atomico `lanes.json` gestito con `tauri-plugin-store`, isolato sia da `settings.json` sia dalla coda `.omp/tasks.json`.
    - In caso di crash o chiusura dell'app, nessun worktree viene eliminato. Al riavvio, Studio interroga `git worktree list --porcelain`, riconcilia il registro `lanes.json` e ripristina le corsie con stato e transcript pronti per la ripresa.
    - La rimozione fisica del worktree avviene automaticamente solo dopo un'integrazione completata con successo. Il rifiuto esplicito di una corsia richiede una conferma di sicurezza prima dell'eliminazione.

### Perché NON le strade alternative

1. **Tessere di pari grado nella TopBar:**
   Scartata perché avrebbe saturato rapidamente la barra dei progetti, duplicato i pannelli informativi per lo stesso repository e distrutto il principio ergonomico fondamentale di Studio: "una tessera stabile per progetto, zero costo mentale al cambio di contesto".
2. **Orchestratore unico "Chief" con subagenti invisibili:**
   Scartata perché la commistione di notifiche asincrone e flussi di dialogo all'interno della stessa chat produce distrazione e frustrazione. Il modello a corsie indipendenti fornisce conversazioni pulite e mirate; un eventuale Chief potrà essere introdotto come livello superiore solo dopo aver consolidato un bus eventi asincrono dedicato.
3. **Auto-merge automatico al termine del task:**
   Scartata perché l'uscita con successo di un agente non equivale a codice collaudato e approvato. Consentire scritture automatiche sul branch principale mentre l'utente lavora avrebbe violato l'inviolabilità del working tree locale.
4. **Worktree annidati dentro `.omp/worktrees/` o in `%LOCALAPPDATA%`:**
   Scartata: posizionarli dentro il repository avrebbe innescato ricorsioni nei file watcher e allungato i percorsi; posizionarli in AppData avrebbe spezzato l'ereditarietà delle regole di contesto nei parent (es. `CLAUDE.md`) e rotto i collegamenti relativi tra repository fratelli.
5. **Condivisione delle cartelle `bin/` e `obj/` tramite junction:**
   Scartata perché i processi di compilazione MSBuild e runtime .NET mantengono lock esclusivi sui file intermedi e generano file strettamente vincolati ai percorsi assoluti: la condivisione avrebbe causato fallimenti casuali e deadlock durante compilazioni concorrenti.

### Conseguenze e garanzie

- Concorrenza multi-agente reale e sicura: 2 o più agenti lavorano contemporaneamente sullo stesso progetto senza collisioni nel filesystem.
- Conservazione assoluta del lavoro dell'utente sul branch principale: nessun auto-merge, nessun auto-stash distruttivo.
- Supporto nativo e verificato per stack complessi .NET Framework e .NET Core.
- Piena reversibilità: ogni corsia è un ramo Git standard con transcript persistito, consultabile e riprendibile in qualsiasi momento.
- Isolamento dichiarato: cooperativo e deterministico a livello di filesystem e processi di Studio; non costituisce una sandbox OS contro codice malevolo intenzionale.

### Nota di implementazione (2026-09-23)

La scrittura di `lanes.json` non passa dal `save` del plugin store: quel save usa `fs::write`. `lanes_store_write_atomic` tiene un lock tra le webview e sostituisce il file in modo atomico; il plugin viene aperto e chiuso all'avvio proprio per non lasciare una riscrittura non atomica in uscita. Il resto del gate e' implementato come sopra: nessun auto-merge, nessun junction su `bin`/`obj`/`packages`, conflitti confinati alla corsia.

## Gate R28: `@` indica sempre un file, `#` il progetto del Companion

**Data:** 2026-09-23
**Esito:** APPROVATO

**Decisione.** `@` apre la palette dei file in ogni campo di testo che finisce a un agente: Composer della chat, editor dei task, Companion. Nel Companion il progetto di destinazione passa da `@progetto` a `#progetto`. Un simbolo con lo stesso significato ovunque vale più della continuità con la vecchia sintassi del Companion, che non viene mai salvata: il token del progetto viene tolto dal testo del task.

**Vincoli.**
- La menzione resta testo nel prompt (`@percorso`, `@"percorso con spazi"`): niente metadati nel protocollo RPC. Il tag nelle bolle e nelle anteprime si ricava rileggendo il testo, quindi ricompare anche quando la sessione viene ripresa.
- Diventa tag solo ciò che sembra un percorso: una `@` a inizio testo o dopo uno spazio, seguita da un token con `/` o con un'estensione che contiene una lettera. `@Main`, `@utente` e le email restano testo. Non si controlla che il file esista: significherebbe caricare il catalogo in modo asincrono e cambiare la bolla dopo che è già stata disegnata.
- Nel Companion i file si cercano solo nel progetto già indicato con `#`: un percorso preso da un altro progetto non esisterebbe nel progetto di destinazione.
- La sintassi vive in `src/lib/agent/fileMentionSyntax.ts` (modulo puro), mentre stato e tastiera della palette stanno in `FileMentionController`. Chi aggiunge una nuova superficie riusa entrambi e non scrive un altro parser.

## Gate R29: l'integrazione di una corsia è una sola pipeline, dal pulsante o dall'agente

**Data:** 2026-09-23
**Esito:** APPROVATO (rivede il punto 9 del Gate R27)

### Il problema

Il 2026-09-23 una corsia di `ContrattiImmobili` non si è potuta integrare. Il lavoro della corsia non era mai stato committato (`Commit (0)`, head = base), il principale aveva appena committato sullo stesso file e il modale chiedeva, in sequenza: aggiornare dal target (un `git merge` su un worktree sporco, rifiutato da Git, con il motivo scartato dall'interfaccia), fare un commit che nessun pulsante permetteva, fermare l'agente della corsia che la chat teneva vivo. L'utente ha finito con un commit e un `git merge` fatti a mano, che hanno prodotto un merge commit al posto dello squash.

### Decisioni

1. **Una sola pipeline Rust (`worktree_land`) con due ingressi.** Il pulsante "Integra" del modale e il tool `studio_lane_integrate` (estensione `extensions/studio-lanes.ts`, caricata con `-e` come le altre) eseguono lo stesso codice. L'agente non fa operazioni git per integrare: chiede a Studio di farle.
2. **Commit della corsia fatto da Studio all'integrazione**, con `git add -A` e hook disabilitati; il messaggio arriva dall'agente o dal titolo della corsia. Se un merge nella corsia era rimasto aperto e i conflitti sono stati risolti (`git add`), la pipeline lo completa.
3. **Merge calcolato in memoria** con `git merge-tree --write-tree` fra target e corsia: il target avanzato non obbliga più ad aggiornare la corsia prima. Solo se ci sono conflitti la pipeline esegue il merge nel worktree della corsia e restituisce i file al chiamante.
4. **Sempre squash.** Un commit sul target con i trailer `OMP-Lane-Id`, `OMP-Lane-Head`, `OMP-Strategy: squash`, mosso con `update-ref` confronta-e-scambia. La strategia `Preserve` è rimossa.
5. **Conferma solo dopo conflitti.** Merge pulito: integra senza chiedere. Corsia che ha avuto conflitti risolti da un agente: serve un clic su una card in chat. A integrazione fatta una card mostra SHA e file con "Annulla integrazione".
6. **Checkout principale sporco.** Si integra se i file sporchi non toccano quelli cambiati dall'integrazione, aggiornando il checkout con `git read-tree -m -u` (che rifiuta di sovrascrivere modifiche locali). Se si sovrappongono, o se l'agente principale sta lavorando, l'integrazione va in coda e riparte da sola.
7. **Pulizia completa automatica** dopo l'integrazione: sessione della corsia chiusa (dopo la fine del turno, se è lei a chiamare il tool), worktree rimosso, branch `omp/lane-*` cancellato, corsia archiviata.
8. **Annullamento** (`worktree_undo_land`): riporta il target allo SHA precedente solo se nessun commit è arrivato dopo, preserva le modifiche locali disgiunte e crea `omp/restored-<laneId>` sul commit annullato, così il lavoro resta raggiungibile.
9. **Canale estensione -> Studio.** Server HTTP su `127.0.0.1` con porta effimera; ogni sessione `omp` lanciata da Studio per un progetto riceve `OMP_STUDIO_BRIDGE_URL` e un token casuale in `OMP_STUDIO_BRIDGE_TOKEN`, revocato alla chiusura. Il token identifica la sessione chiamante: il controllo "processi attivi" esclude quel processo, fermo in attesa della risposta. Le sessioni del Laboratorio non ricevono il canale.

### Perchè non le alternative

- **L'agente fa merge e commit da solo:** flessibile, ma non deterministico; è esattamente la strada che ha prodotto il merge commit manuale.
- **Corsia riallineata al target in automatico mentre è ferma:** evita l'accumulo di drift, ma cambia il worktree sotto una chat ancora aperta; con il merge in memoria il drift non blocca più e questa complessità non serve.
- **Scambio di file al posto dell'HTTP:** niente rete, ma servono polling e pulizia dei file di richiesta; il tool deve ricevere una risposta sincrona.

### Rischi accettati

- Fra il controllo "agente principale fermo" e `read-tree` resta una finestra di millisecondi in cui un comando manuale dell'utente potrebbe scrivere nel checkout; `read-tree` non sovrascrive comunque modifiche locali.
- Il commit automatico include tutto cio' che `.gitignore` non esclude: la card di esito elenca i file e l'integrazione si annulla con un clic.
- L'esclusione del processo chiamante copre anche i job in background di quell'agente, che non sono registrati singolarmente.
- L'alternativa 3 scartata dal Gate R27 (auto-merge al termine del task) resta valido nel senso di gesto esplicito: l'integrazione parte solo da un clic o da una richiesta esplicita all'agente, mai alla fine del task.

## Gate R30: Il Laboratorio prototipi diventa una corsia di progetto

**Data:** 2026-09-24
**Esito:** APPROVATO (rifonda il Gate R24 sulla base delle corsie del Gate R27)

### Il problema

La prima implementazione del Laboratorio (Gate R24, vista separata `LabView` da ~3400 righe) soffriva di tre falle strutturali:
1. Aprire il Laboratorio smontava `<main>` con tutti i `Terminal`, chiudendo via `pty_close` / `kill_tree` gli agenti TUI attivi;
2. L'anteprima `srcdoc` con `sandbox="allow-scripts allow-forms allow-same-origin"` ereditava l'origine di Studio annullando l'isolamento (accesso a IPC Tauri nativo `__TAURI_INTERNALS__`);
3. La chat era simulata con un `setTimeout` e non dialogava con la sessione OMP;
4. Le revisioni, il contesto stabile e l'export contenevano bug logici (archivio revisioni nel repo dell'utente, `export` su nuove cartelle fallimentare, export senza stili CSS per omissione di `index.css`).

### Decisioni

1. **Il Laboratorio e' una corsia speciale di progetto (`kind: 'lab'`).** Vive come scheda nella `LaneStrip` accanto alla `Principale` e ai worktree. Non e' un worktree Git del repo: e' un ramo parallelo il cui workspace e' il prototipo; dal progetto originale prende solo contesto e riferimenti in sola lettura. Il cambio corsia avviene via CSS (`visibility: hidden`) senza smontare nulla.
2. **Workspace fuori dal repository.** Collocato in `%LOCALAPPDATA%/sh.omp.studio/lab/prototypes/<id>` con **Git interno**: ogni richiesta dell'utente chiude un commit atomico che funge da revisione recuperabile.
3. **Indice nel progetto (`.omp/lab/prototypes.json`) e bozze globali.** Scritto solo da Rust in modo atomico. `status` (`active` | `closed`), date, `workspacePath`, `lastRevision` e `summary` (2-3 righe mantenuto dall'agente Lab). Le idee libere senza cartella vivono nell'indice bozze in app data e possono essere associate a un progetto.
4. **Indice non versionato.** Studio aggiunge automaticamente `.omp/lab/` al `.gitignore` del progetto con un blocco marcato dedicato.
5. **Runtime anteprima via loopback isolato.** Server HTTP in Rust su `127.0.0.1:0` avviato on-demand; iframe `sandbox="allow-scripts allow-forms allow-modals allow-popups"` con origine opaca `null` (IPC Tauri non iniettato, capability remote assenti); bundle compilato via Web Worker esbuild-wasm; pacchetti npm di terze parti risolti su CDN esm.sh con versioni fissate; React e Tailwind CSS serviti localmente.
6. **Sessione agente confinata.** `rpc_open_lab` usa il workspace come CWD, carica l'estensione `studio-lab.ts` con hook `tool_call` fail-closed (tool nativi `read`/`write`/`edit`/`glob`/`grep` limitati ai confini, shell/eval disabilitati, browser limitato all'URL locale dell'anteprima, tool `lab_preview_status` e `lab_set_summary`).
7. **Ingresso dal popover del progetto e scratchpad.** Rimosso il chip globale in TopBar. L'apertura avviene dal popover della scheda progetto ("Nuovo prototipo Lab" e "Prototipi Lab (n)"); le idee libere si aprono dal menu del pulsante fantasma (scratchpad) con `Ctrl+Alt+P`.
8. **Cutover completo.** Eliminati i moduli obsoleti (`LabView.svelte`, `renderer.ts`, `revisions.ts`, `context.ts`, `migration.ts`, `export-handoff.ts`, `storage.ts`, `visual-tools.ts`).

## Gate R31: la barra delle corsie mostra solo cio' che chiede attenzione, e le corsie si chiudono senza perdersi

**Data:** 2026-09-28
**Esito:** APPROVATO (rivede la resa della `LaneStrip` del Gate R27, il punto 7 del Gate R30 e ripristina il punto 7 del Gate R24)

### Il problema

1. Ogni tab della `LaneStrip` portava un pallino verde (processi vivi, ma contava anche il processo `omp` della chat, quindi era sempre acceso), un badge testuale di stato anche a riposo ("In attesa") e, sui prototipi, una beuta in colore accent che sembrava uno stato.
2. I titoli erano descrizioni: la prima riga del prompt tagliata a 36 caratteri per i worktree, fino a 80 caratteri scelti dall'agente Lab per i prototipi, ricalcolati a ogni turno.
3. «+ ▾ Nuova corsia» e il popover mescolavano creazione e prototipi esistenti con la stessa grafica; il popover duplicava la logica del menu.
4. La X su un worktree archiviava con motivo `integrated` e rimuoveva la cartella: una corsia mai integrata non era piu' recuperabile. Una pulizia post-integrazione fallita veniva ignorata e «Scarta» lasciava il branch orfano.
5. Il sessionId di omp non era salvato: un prototipo riaperto o un riavvio di Studio partivano da una chat vuota, contro il punto 7 del Gate R24.

### Decisioni

1. **Tab = icona del tipo + nome.** Nessuna icona per Principale, ramo per i worktree, beuta per i prototipi; grigia, accent solo sulla tab selezionata. Lo stato si vede solo con gli anelli della barra progetti: ambra pulsante per domanda o conflitto, accent fermo per "finito da leggere" o pronto per la revisione; niente per fermo o al lavoro. Il "finito" delle corsie GUI e' il confronto fra `runEndSeq` della sessione e l'ultimo visto dall'utente, azzerato entrando o uscendo dalla corsia.
2. **Nomi da progetto generati da smol.** Al primo prompt di una corsia con titolo segnaposto, una chiamata effimera al ruolo `smol` produce 1-3 parole entro 24 caratteri: inventivo per i prototipi, area toccata per i worktree, diverso dai nomi gia' presenti. `lab_set_summary` aggiorna solo il riepilogo. La rinomina manuale (doppio clic o menu contestuale) imposta `titleLocked` e nessun automatismo la sovrascrive.
3. **Stato `closed` reversibile.** La X toglie la tab, ferma sessione e processi e lascia cartella e branch. Integrare rimuove cartella e branch e segnala le pulizie fallite; «Elimina» (con conferma) rimuove cartella e branch e archivia con motivo `rejected`. Le corsie chiuse non contano nel soft-cap e non occupano lo slot di auto-dispatch.
4. **Un solo menu di corsie.** Il «+» della barra e il popover leggono la stessa sorgente (`projectLaneActions`, `listClosedLanes`): «Crea» e «Riapri» separati, corsie chiuse e prototipi non aperti in un solo elenco con data. Il popover resta l'ingresso quando la barra e' nascosta.
5. **Chat continua.** I prototipi hanno una sola chat: la sessione si apre sempre con `omp --continue` nel workspace del prototipo, e «Nuova chat», `Alt+N`, `/new`, `/clear`, `/quit` sono disattivati. I worktree riprendono l'ultima chat con `--continue` secondo l'impostazione per progetto `worktreeResumeChat` (predefinita attiva); «Nuova chat» resta disponibile. Principale invariata.
6. **Pannello sinistro per tipo di corsia.** I prototipi hanno una memoria di visibilita' propria (`labSidebarCollapsed`, chiusa per partire); la scheda Sessioni non compare nel Lab perche' mostrerebbe le sessioni del progetto originale.

### Rischi accettati

- `--continue` riprende la sessione piu' recente della cartella: nel workspace di un prototipo e' per costruzione l'unica, in un worktree e' l'ultima aperta anche se l'utente aveva scelto una chat precedente.
- Le cartelle dei worktree chiusi occupano disco finche' non vengono integrati o eliminati.
- «Elimina» non forza Git: un worktree con modifiche non committate resta su disco e l'errore viene mostrato.

## Gate R32: la chat GUI 2.0 segue il prototipo "CodeAgent Flow"

**Data:** 2026-09-28
**Esito:** APPROVATO (riscrittura della resa della chat GUI; piano operativo in `PLAN.md`, "Piano Chat v2 — Gate R32")

### Il problema

1. Il testo dell'agente compare carattere per carattere dietro un ritardo di 500 ms con una rampa di opacita': si legge mentre si muove, e le frasi restano a meta' per tutto lo streaming.
2. Tool, todo, subagenti e domande hanno ciascuno una grammatica visiva propria (card con chip, griglia di pixel, barra con modale, scheda nel flusso): un turno lungo e' una pila di riquadri.
3. Lo stato vivo del turno (todo, subagenti, domanda aperta) sta in punti diversi e si perde scorrendo.
4. La coda dei messaggi e' di sola lettura, gli allegati sono solo immagini, il composer non distingue file e comandi dal testo.

### Decisioni

1. **Fonte del design.** Il prototipo Lab `p-20260925-dyyhe6` (revisione `fd3b4c2`) e' la specifica visiva. Si reimplementa in Svelte 5 con i token del tema: forme, spaziature e movimento del prototipo, colori da `--bg-*`, `--ink*`, `--line*`, `--brand`, `--warn`, `--success`, `--danger`. La chat segue tutti i temi omp.
2. **Rivelazione per frasi.** Il testo si mostra un'unita' completa alla volta (frase, voce di elenco, titolo; blocchi di codice e tabelle interi) con blur-fade (`rv-blur`, 700 ms, blur 10 px, 140 ms tra unita'). Nuova impostazione `general.chatReveal`: `blur` (predefinita), `stream` (token per token senza animazioni), `final` (messaggio intero a fine risposta). Con animazioni disattivate `blur` si comporta come `stream`.
3. **Traccia leggera nel flusso, stato vivo nel vassoio.** Nel transcript restano righe compatte: gruppi di chiamate (dal vivo le ultime 5, poi un riepilogo espandibile), "Lista di N todo", marcatori di passo, riepilogo dei subagenti, richiamo della domanda. Todo, subagenti, coda dei follow-up e domanda ridotta stanno in un vassoio agganciato al composer; una sola sezione aperta alla volta.
4. **Domande al posto del composer.** La scheda domanda sostituisce il composer (che resta montato con la bozza); `Esc` la riduce a una riga del vassoio senza chiuderla; inviare un messaggio con una domanda aperta risponde `Chat about this` se il canale RPC lo supporta, altrimenti annulla la domanda.
5. **Coda dei follow-up in Studio.** Il protocollo RPC non ha comandi sulla coda: i follow-up restano in Studio, modificabili, e partono a `agent_end`; gli steer vanno subito a omp e restano immutabili.
6. **Editor a badge.** Il composer diventa un `contenteditable` con badge per `@file` e `/comando`; il cursore animato viene rimosso.
7. **Allegati per percorso.** Le immagini restano inline nel prompt; gli altri file vengono salvati nella cartella della sessione e citati per percorso assoluto.
8. **Cutover diretto a fasi.** Nessun flag e nessun doppio codice: ogni step sostituisce il pezzo v1 corrispondente ed elimina il codice superato.

### Eccezioni al design system

- **Movimento persistente nella chat.** Oltre al respiro ambra, sono ammessi lo shimmer del testo (`.text-shimmer`) e la ghost line **solo** sugli indicatori di lavoro in corso ("Al lavoro", "Sto pensando…", testo in arrivo, subagente attivo) e solo finche' lo stato e' vivo; a conclusione tornano statici. Con movimento ridotto restano fermi e leggibili.
- **Tipografia della chat.** La prosa del transcript usa 15/28 px invece della scala UI a 13 px: la chat e' una superficie di lettura, non di controllo.
- **Parentesi delle chiamate parallele.** Un tratto verticale di 2 px in `--line-strong`, neutro, raggruppa le chiamate partite insieme. E' struttura, non accento colorato.

### Vincoli verificati su `omp` 18.4.1

- `prompt` accetta solo `images`; `ContextUsage` solo `tokens`, `contextWindow`, `percent`; nessun comando RPC sulla coda (la TUI ha `app.message.dequeue` su `Alt+↑`/`Maiusc+↑`).
- Lo strumento `ask` richiede un'interfaccia: i subagenti non possono fare domande.
- `ask` riserva `Other (type your own)` e `Chat about this`; l'annullamento interrompe il turno.

### Rischi accettati

- `filter: blur` costa sulla GPU integrata: solo le unita' in animazione lo portano, e il testo concluso torna statico.
- La coda locale dei follow-up si perde se Studio si chiude prima di `agent_end`.
- Rimuovere il cursore animato cambia la sensazione di scrittura per chi ci si era abituato.

## Prewalk: overlay per sessione, destinazione solo `@smol`, nessun riavvio

**Data:** 2026-10-06
**Esito:** IMPLEMENTATO

### Decisioni

1. **Modello di partenza = modello attivo; destinazione = solo `@smol`.** Non si introduce un ruolo prewalk e non si riscrive `modelRoles.smol`. Qualità, thinking e riserve si configurano nella scheda Ruoli con `smol` e `fallbackChains.smol`; omp risolve il candidato effettivamente disponibile all'armo.
2. **Overlay GUI dedicato al processo.** Ogni RPC possiede un file temporaneo `--config`, inizialmente spento, che conserva la base GUI (`yolo`, limite lettura 1200). Il comando Tauri `rpc_set_prewalk` usa la scrittura atomica già condivisa dal backend; la chiusura elimina il file. L'overlay condiviso avrebbe armato altre chat.
3. **Armo/disarmo a caldo, senza riavvio.** Si sfrutta il watcher di omp, preservando processo e conversazione. Studio attende un notice di conferma, non deduce l'armo da `get_state`, che non lo espone. «Ripeti» torna a `@default` e riarma tramite `/prewalk restart`.
4. **Transizioni reali del valore.** Dopo il passaggio l'overlay torna falso. Per disarmare un armo slash quando il file è già falso si scrive vero, si lasciano 400 ms al watcher e si scrive falso; il notice finale resta obbligatorio. Prima di nuova chat o fork si disarma: con overlay vero `new_session` riarma silenziosamente.
5. **Opzione sul task, non sui subagenti.** La chat arma prima del prompt e mantiene il task in coda se l'armo fallisce; il terminale invia `/prewalk` dopo `/new`. L'overlay TUI `/tasks` mostra `[prewalk]` ma Invio non arma: l'opzione viene applicata dal dispatch di Studio. Lab e `task.prewalk`/`task.agentPrewalk` restano fuori perimetro.

### Evidenza e limiti

- Le decisioni partono dalle verifiche su omp 18.4.10; gli smoke di implementazione usano il binario disponibile, omp 18.6.1, in `rpc-ui` e ConPTY, senza avviare una seconda istanza desktop.
- Un turno reale con `todo` e `write` emette `model_changed` senza payload, `thinking_level_changed: high` e `Prewalk: switched to google-antigravity/gemini-3.8-flash after first write call.` Il parser riconosce anche questo notice.
- `true` su una sessione già armata è un no-op senza notice. Il ciclo «Ripeti» → `true` → `false` produce il disarmo; nuova chat e fork tornano spenti, così come la ripresa da processo nuovo.
- Se modello e thinking coincidono già con il target, omp risponde `nothing to switch`: non è un armo riuscito e Studio restituisce quel motivo senza attendere il timeout.
- Composer e `TerminalSession` sono esercitati in Vite con un bridge temporaneo verso processi omp reali, inclusi task chat/PTY e file di risultato. Il bridge sostituisce l'IPC fisico Tauri: lo smoke non equivale a una nuova esecuzione del binario desktop compilato.
- Il watcher non fornisce una conferma per i no-op: l'intervallo intermedio è una misura empirica, mentre il notice finale entro cinque secondi è il criterio di successo. Un watcher rallentato causa un errore visibile, non un task avviato senza prewalk.

## Dialogo `ask` nativo via `set_ask_dialog`

**Data:** 2026-10-07
**Esito:** IMPLEMENTATO (supera il riscontro C16 di omp 18.4.1)

### Decisioni

1. **Adozione del comando `set_ask_dialog`.** Su sorgenti omp 18.8 (e da omp 18.4.9+) l'host RPC può optare per il dialogo nativo inviando `{"type":"set_ask_dialog","enabled":true}` dopo `ready`. Lo strumento `ask` invia quindi tutte le domande in un unico frame `extension_ui_request` con `method: "ask"`, `questions` e `timeout`.
2. **Rimozione del motore sequenziale.** Il vecchio meccanismo di ricostruzione incrementale (matching per firma delle opzioni, round multipli simulati via `select`/`editor`, sentinelle `Done selecting`, passi di flush e recovery) è eliminato.
3. **Risposta singola e codifica fedele.** L'utente risponde con un unico frame `extension_ui_response` contenente `answers: [{ id, selectedOptions, customInput }]`:
   - Scelte ordinarie: etichette verbatim in `selectedOptions`.
   - "Altro…" / testo libero: testo in `customInput`, `selectedOptions: []`.
   - Note: a scelta multipla viaggiano in `customInput: "nota: …"`; a scelta singola, poiché il parser di omp vieta sia opzione che customInput contemporanei per domande single-select, l'etichetta e la nota vengono unite in `customInput: "etichetta (nota: …)"`.
   - "Decidi tu": invia il testo convenzionale in `customInput`.
   - Timeout locale: invia `{ cancelled: true, timedOut: true }`, consentendo a omp di applicare le scelte consigliate (`timedOutAskDialogResult`).
   - Annullamento/chiusura: invia `{ cancelled: true }`.
4. **Retrocompatibilità flussi non-ask.** Le richieste interattive delle estensioni e del login (`select`, `confirm`, `input`, `editor`) continuano a funzionare inalterate sul loro canale dedicato.

## Coda dei messaggi nativa di omp al posto della coda locale di Studio

**Data:** 2026-10-07
**Esito:** IMPLEMENTATO (supera la motivazione del Gate R22 e il punto 5 del Gate R32)

### Il problema

Il Gate R22 (2026-09-02) e il Gate R32 (2026-09-28) avevano deciso che la coda
dei messaggi restasse in Studio, perche' su omp 18.4.1 il protocollo RPC non
esponeva alcun comando per interrogare, modificare, riordinare o estrarre i
messaggi gia' in coda. Studio teneva quindi una coda locale dei soli follow-up
(modulo `localFollowUpQueue.ts` + macchina a stati `followUpDispatcher.ts`),
con pausa dopo Stop, 'Invia ora' e invio a `agent_end`; gli steer partivano
subito e restavano chip di sola lettura. Il costo era il doppio stato: i chip
locali e il `queuedMessageCount` di omp potevano divergere, e un crash prima di
`agent_end` perdeva i follow-up.

### Decisioni

1. **Sorgente di verita' = omp.** La coda arriva da `get_state.queuedMessages`
   (`{ steering: string[], followUp: string[] }`) e dall'evento `queue_update`,
   che ne e' uno snapshot e sostituisce lo stato precedente. Lo specchio
   ottimistico `queued`, la coda locale `localFollowUps`, il flag
   `localFollowUpsPaused` e i moduli `localFollowUpQueue.ts` e
   `followUpDispatcher.ts` (con il loro test) sono eliminati. Il testo dei chip
   e' opaco: si rimanda identico a omp. Nuovo modulo di supporto, puro e
   testato: `src/lib/agent/queueRestore.ts`.

2. **Invio durante lo streaming: si continua a usare `prompt` con
   `streamingBehavior`.** La scelta steer/follow-up (default, split button,
   `Alt+Enter`) resta quella di sempre. `prompt` e' l'unico percorso che
   preserva la pipeline di Studio: `attachEditorContext`, il preflight
   (`orchestratePromptPreflight`) e la gestione delle skill/comandi di omp
   (incluso il `queueChipText` che omp registra dai comandi `/`), oltre a
   mantenere il contratto `prompt_result` a cui Studio e' agganciato. I comandi
   `/` intercettati da Studio non passano da qui: `Composer.handleSubmit` li
   dirotta su `onSlashCommand` prima di `session.prompt`, anche mentre l'agente
   lavora, quindi non finiscono mai nella coda di omp come testo.

3. **Modifica dei chip con i comandi di omp.** Edit = `remove_queued_message`
   (che restituisce testo e immagini del messaggio rimosso) e ripristino nel
   composer; Remove = `remove_queued_message`; Promote sui follow-up =
   `promote_queued_message` (etichetta «Steer ora» / «Steer now»). Se la
   risposta omette le immagini (`imagesDropped`) lo si dice con un avviso. Il
   chip e' identificato dal suo testo, non da un id locale.

4. **Stop con recupero della coda.** Il primo stadio dell'escalation invia
   `abort_and_restore_queue` invece del solo `abort`; `abort_bash` continua a
   fermare il processo figlio in corso (viaggia dentro lo stesso comando del
   client). La risposta riporta `steering` e `followUp` ritirati (dal piu'
   vecchio), che tornano nel composer. Il libro contabile sta nel client
   (`abortAndRestoreQueue`), non in Rust: `abortPendingRequests` sblocca le
   altre promise in volo *prima* dell'invio, poi il comando parte dal percorso
   normale delle richieste e si attende con il suo timeout — cosi' non si uccide
   mai la risposta che ci serve. Se il processo e' bloccato la richiesta scade e
   `forceKill` (una `invoke` separata) resta comunque disponibile: il doppio
   stadio e' intatto. Su un omp piu' vecchio di 18.4.4 il comando non esiste e
   si ripiega su `abort`.

5. **Ripristino accanto alla bozza.** Il contenuto ritirato entra nell'editor
   dopo la bozza corrente, separato da una riga vuota (come l'editor della TUI
   quando si scrive mentre si preme `Esc`); con la bozza vuota resta solo lui.
   Le immagini ritirate tornano tra gli allegati. Il ripristino passa da un
   handler registrato dal composer (`registerQueueRestoreHandler`): la sessione
   non conosce il DOM. Senza composer montato il contenuto resta in attesa e
   viene consegnato al primo che si registra. `Alt+↑` richiama l'ultimo
   messaggio in coda (prima i follow-up, poi gli steer) con lo stesso percorso.

### Vincoli verificati su `omp` 18.8.0

- `remove_queued_message { message, queue }` restituisce `{ removed, images?, imagesDropped? }`;
  `promote_queued_message { message }` restituisce `{ promoted }`;
  `abort_and_restore_queue` restituisce `{ steering, followUp, imagesDropped?, truncated? }`.
- `queue_update` e' uno snapshot coalescato: omp non lo riemette se la coda
  visibile non cambia.
- `prompt` con `streamingBehavior` accoda il messaggio nella coda scelta;
  `steer`/`follow_up` accodano senza avviare un turno ma non eseguono i comandi
  `/` (li rifiutano con `#throwIfExtensionCommand`) ne' il resto della pipeline.

### Perimetro

- Rimozione di `localFollowUpQueue.ts`, `followUpDispatcher.ts`,
  `test/local-follow-up-queue.test.ts`, delle chiavi i18n
  `chat_v2_queue_paused`/`_send_now`/`_edit_blocked`/`_start_timeout`/
  `_attachments`/`_server_count` e delle azioni di pausa/ripresa.
- `backend Rust` invariato.

---

## Controllo per-subagente e calcolo costi disgiunti (omp 18.8 RPC)

**Data:** 2026-10-07  
**Esito:** IMPLEMENTATO

### Decisioni

1. **Comandi RPC `cancel_subagent` e `steer_subagent`.** Studio adotta i comandi RPC per controllare i subagenti singoli senza interrompere la sessione madre:
   - `cancel_subagent { subagentId }`: esegue l'abort del turno vivo e registra la tombstone del subagente; restituisce `{ cancelled: boolean }`. Se `cancelled === false` il subagente era gia' terminato (notifica informativa).
   - `steer_subagent { subagentId, message }`: invia il messaggio utente alla sessione viva del subagente via prompt steer al prossimo confine di passo.
2. **Affordance UI unificata.**
   - In `SubagentDrawer`: pulsante «Ferma» visibile se running/pending con stile pericolo e disabilitazione durante la chiamata; barra compatta inferiore con campo monoriga e invio per steerare il subagente attivo.
   - In `ComposerTray`: pulsante icona stop (`IconStop`) con tooltip su ciascuna riga di subagente in esecuzione/coda (senza catturare il clic che apre il cassetto).
   - In `TaskRow` (tramite `AgentLink`): slot snippet `action` che ospita il pulsante stop con tooltip per i subagenti attivi.
3. **Calcolo dei costi dei subagenti via Rust (`session_subagent_cost`).**
   - Poiche' `get_session_stats` di omp calcola solo i messaggi della sessione principale, i costi dei subagenti risiedono nei rispettivi transcript `.jsonl` nella cartella artifacts (`<sessionFile senza .jsonl>/`).
   - Il nuovo comando Rust legge in streaming con `BufReader` tutti i file `.jsonl` ricorsivamente ed estrae `message.usage.cost.total` dai messaggi con `role == "assistant"`.
   - Il file `__advisor.jsonl` alla radice della cartella artifacts e' escluso (advisor della sessione principale); i file `__advisor.jsonl` dentro le sottocartelle dei subagenti sono inclusi.
4. **Visualizzazione costo diviso.**
   - La sessione tiene traccia di `sessionCost`, `subagentCost` e del derivato `totalCost`.
   - `subagentCost` viene aggiornato insieme a `refreshCost()` e alla conclusione del ciclo di vita di ciascun subagente.
   - Nel pulsante/tooltip di contesto e nel popover `ContextPanel`, quando `subagentCost > 0` viene esposta la ripartizione: `Sessione $x · Subagenti $y`.

---

## Testi del catalogo comandi nel manifesto bilingue, non in messages/*.json

**Data:** 2026-10-07  
**Esito:** IMPLEMENTATO  
**Decisione:** I testi estesi del catalogo dei comandi (titoli, descrizioni, benefici, esempi e indicazioni d'uso) risiedono direttamente nelle strutture dati del manifesto TypeScript (`text: { it: CommandText, en: CommandText }`), anziché nei file Paraglide `messages/it.json` e `messages/en.json`.

**Motivazione:**
1. **Atomicità delle voci del catalogo:** Un comando nuovo o modificato in omp richiede un set corposo di informazioni (titolo, sintesi, array di vantaggi, array di esempi con comando e nota, indicazione d'uso). Con il formato bilingue in-line, ogni comando è un unico blocco TypeScript autosufficiente: aggiungere, revisionare o rimuovere una voce tocca un solo file anziché dover sincronizzare frammenti di chiavi distinte tra `messages/it.json`, `messages/en.json` e i componenti.
2. **Generazione e verifica assistita per gli agenti:** Quando il gate di release (`scripts/check-commands.mjs`) rileva comandi nuovi da `omp`, l'agente può generare una singola bozza `CommandManifestEntry` completa, sottoporla all'utente con il tool `ask` e inserirla nel file appropriato (`omp-modes.ts` o `omp-session.ts`) con una sola operazione atomica.
3. **Controllo dei tipi a tempo di compilazione:** I contratti di `CommandText` (`CommandTexts = { it: CommandText, en: CommandText }`) impongono staticamente che entrambe le lingue contengano tutti i campi obbligatori (`title`, `summary`, `benefits`, `examples`), evitando chiavi mancanti o disallineate che in JSON richiederebbero controlli a runtime o linter aggiuntivi.
4. **Perimetro Paraglide preservato:** Le etichette strutturali dell'interfaccia utente (titoli delle sezioni, pulsanti di azione, messaggi di stato, attributi aria) restano interamente gestite tramite Paraglide (`messages/*.json`), mantenendo la coerenza applicativa per tutti gli elementi del guscio.

---

## Gate R33: diramazioni e albero dei rami nella GUI con i comandi RPC di omp

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (rivede lo scarto «Pulsanti per `/share`, `/fork`, `/tree`» di `IDEAS.md` per la sola superficie GUI)

### Il problema

1. `/fork` nella chat GUI mandava `new_session { parentSession }`: omp registrava il genitore ma apriva una sessione **vuota**, mentre il catalogo prometteva di «clonare la cronologia corrente». Era un difetto visibile.
2. Non c'era modo di ripartire da un punto della conversazione: quando l'agente prende la strada sbagliata a meta' sessione l'unica via era una chat nuova o la TUI.
3. `/tree` di Studio era un alias di `/resume`/`/sessions`: stesso nome del comando omp che naviga l'albero della sessione, funzione diversa.
4. `IDEAS.md` aveva scartato i pulsanti per `/fork` e `/tree` perche' significavano scrivere comandi slash nel PTY, cioe' pilotare la TUI al posto dell'utente. Quella ragione vale per la superficie Terminale; la GUI e' un client `omp --mode rpc-ui` e omp 18.8 espone `fork`, `branch`, `get_entries`, `get_tree` e `get_branch_messages` come comandi RPC dichiarati (`docs/rpc.md`, «Session» e «Pi-compatible history/tree commands»). Per la GUI lo scarto non vale piu'; per il Terminale resta valido (la TUI li ha gia').

### Decisioni

1. **`/fork` = comando RPC `fork` senza `entryId`.** Copia l'intera sessione con gli artefatti in un file nuovo e ci resta sopra; poi `get_state` (nuovo `sessionId`/`sessionFile`, la corsia lo persiste) e ricostruzione paginata del transcript con `get_messages_page`. `cancelled: true` (veto di un'estensione, sessione non persistita) e l'errore `code: "session_busy"` lasciano la sessione di prima intatta, transcript e coda compresi, e producono un avviso sopra il composer. Prima del comando si disarma il prewalk come per la nuova chat (decisione «Prewalk»).
2. **Le diramazioni partono solo a sessione ferma.** omp rifiuta `fork` con `session_busy`, ma `branch` no: un ramo preso a meta' turno perderebbe la risposta in arrivo. Studio blocca prima (streaming, compattazione, domanda aperta, diramazione gia' in corso) e spiega il motivo nella voce disabilitata. Le corsie Laboratorio non diramano (Gate R30: una sola chat continua).
3. **Messaggi del transcript -> entry durevoli.** Il `messageId` degli eventi e' un id di processo; l'entry di omp si ricava da `get_entries`, tenuto in una copia locale aggiornata in coda con `since` (ricarica completa su `unknown_since`, cambio di sessione o foglia fuori copia). La chiave e' `message.timestamp`, lo stesso valore che omp scrive nel file: Studio lo conserva su ogni entry utente/assistente (`messageTs`), sia dalla diretta sia dalla ricostruzione. Senza timestamp si allinea per posizione dalla coda del ramo attivo con confronto del testo, che regge anche dopo una compattazione.
4. **«Dirama da qui» su un messaggio utente = nuova sessione fino a *prima* di quel messaggio** (`fork` sul messaggio precedente, artefatti compresi). «Modifica e riprova» fa lo stesso e rimette nel composer testo e immagini del messaggio, senza il blocco di contesto editor che Studio ricalcola all'invio. Per il primo messaggio della sessione non c'e' nulla da copiare e si usa `branch`, che apre la sessione vuota. **Sotto una risposta conclusa** «Dirama da qui» usa `fork` sull'ultimo messaggio del turno (omp estende il taglio fino ai risultati tool del batch).
5. **Pannello «Rami» da `get_tree`.** Nodi = messaggi utente; il ramo attivo resta una linea dritta a sinistra, i rami alternativi si mostrano rientrati dove si staccano; fuori dal ramo attivo prosegue il figlio piu' recente, come nella TUI. Costruzione iterativa: una sessione lineare lunga ha migliaia di livelli.
6. **Aprire un ramo crea una sessione nuova.** Via RPC non esiste lo spostamento della foglia nello stesso file (il `navigateTree` del `/tree` della TUI); il clic su un ramo inattivo fa `fork` sulla punta di quel ramo. Il pannello lo dice e rimanda al Terminale per la navigazione nello stesso file. Se omp aggiungera' un comando RPC per `navigateTree`, il clic passera' a quello senza cambiare l'interfaccia.
7. **Comandi.** `/sessions` diventa alias di `/resume` (elenco sessioni); `/tree` apre il pannello Rami; `/branch` resta l'alias del pannello Git. L'instradamento di questi comandi vive in `src/lib/agent/slashRouter.ts` con test puri: e' il primo pezzo estratto da `handleGuiSlashCommand`, senza spostare il resto.

### Alternative scartate

- **`branch` per «Dirama da qui» su ogni messaggio utente.** Ripartirebbe dal genitore del messaggio come `fork`, ma senza copiare gli artefatti: i risultati tool conservati che citano `artifact://N` non si risolverebbero piu'.
- **Pilotare `/tree` nel PTY dalla GUI.** E' l'esatto motivo dello scarto di `IDEAS.md` e resta escluso.
- **Spostare la foglia nello stesso file con `branch` + `new_session`.** Non esiste un comando RPC che lo faccia; simularlo creerebbe comunque file nuovi con un nome che non lo dice.

---

## Fine lavoro «vera» (`session_settled`) e stato/widget delle estensioni (omp 18.8 RPC)

**Data:** 2026-10-08  
**Esito:** IMPLEMENTATO

### Il problema

- Lo stato della sessione GUI tornava `idle` su `agent_end`. Con subagenti asincroni, bash in background o follow-up in coda l'agente si risveglia dopo: notifica «ha finito» e auto-avvio della coda potevano scattare sopra lavoro ancora in volo.
- `setStatus` leggeva `event.message`, ma omp manda `statusKey`/`statusText`; `setWidget` e `setTitle` erano ignorati. Lo stato delle estensioni non compariva mai.

### Decisioni

1. **Yield e quiete sono due momenti.** Lo yield (`agent_end` terminale, oppure non terminale con `awaitingAsyncWork: true`) libera il composer e chiude il turno: piè di turno, suggerimenti, `runEndSeq`. La quiete (`session_settled`, `prompt_result.sessionSettled: true`, `get_state.isSettled`) e' la fine del lavoro: solo li' `agentState` passa da `working` a `idle`, quindi `finished`, annuncio e companion. La logica pura sta in `src/lib/agent/settle.ts`.
2. **Il background resta `working` per tessere e notifiche, ma ha un motivo suo nel cancello.** `GuiGateSnapshot.backgroundWork` produce il blocco `background` («Lavoro in background»): non pronto, niente auto-avvio, ma instradabile verso un'altra corsia come `working`. Nel composer una voce discreta «in background» nella riga di stato.
3. **Compatibilita' per capability, non per versione.** Finche' omp non mostra `isSettled` o `session_settled` (`settle.aware === false`) lo yield vale come quiete: con omp precedenti il comportamento e' identico a prima. Una fine non terminale con `awaitingAsyncWork` e' trattata come yield solo quando omp riporta la quiete; altrimenti resta l'attesa del prossimo `agent_end`.
4. **Rete di sicurezza.** Mentre si aspetta la quiete, `get_state` ogni 15 s riallinea `isSettled` nel caso un `session_settled` vada perso. Un processo nuovo (`ready`), un'uscita o la chiusura azzerano quiete e stato delle estensioni.
5. **`prompt_result.status === "error"`** con `agentInvoked: true` diventa un avviso in chat con provider, modello, HTTP e «si puo' riprovare» (`error.retryable`). Non si duplica con la riga della quota nel vassoio ne' con la risposta d'errore legacy dei prompt rifiutati prima dell'agente.
6. **Estensioni.** `extensionStatus` (per `statusKey`; testo vuoto o assente toglie la voce) e `extensionWidgets` (`widgetKey` → righe + `aboveEditor`/`belowEditor`; righe assenti tolgono il widget). Le voci di stato sono chip nella riga di stato del composer (overflow nel menu «…»), i widget blocchi monospazio sopra o sotto il composer. I colori ANSI si riducono ai toni semantici del tema (`--danger`, `--success`, `--warn`, `--brand-ink`, `--ink`, `--ink-faint`): la palette a sedici colori resta del terminale (Sacred Terminal Rule). La logica pura e' in `src/lib/agent/extensionUi.ts`.
7. **`setTitle` ignorato di proposito.** E' il titolo del terminale, che omp in RPC sopprime senza `PI_RPC_EMIT_TITLE=1`; il nome della chat Studio lo genera e lo salva da se'.

### Vincoli verificati su `omp` 18.8.4

- `docs/rpc.md` § «Yield vs settled», `prompt` payload, forma di `agent_end` (`isTerminal`, `yielded`, `awaitingAsyncWork`).
- `rpc-types.ts`: `RpcPromptResultFrame`, `RpcSessionSettledFrame`, `RpcSessionState.isSettled`/`hasPendingAsyncWork`, `RpcExtensionUIRequest` (`setStatus`, `setWidget`, `setTitle`).
- `rpc-mode.ts`: `setWidget` inoltra solo array di stringhe; i widget disegnati da factory TUI (dashboard `autoresearch`) arrivano solo come rimozione.

---

## Gate R34: l'auto-avvio parte solo a sessione ferma e stabile

**Data:** 2026-10-08  
**Esito:** IMPLEMENTATO  
**Aggiorna:** Gate R12 (condizione di prontezza dell'auto-avvio e uscita dall'effetto)

### Il problema riportato

Con l'interruttore acceso i task in coda partivano uno dopo l'altro senza aspettare la fine del precedente, anche mentre l'agente era solo in pausa fra un tool e l'altro. Per questo l'auto-avvio non veniva mai usato.

### Cause trovate (con evidenza)

1. **`turn_end` fra un giro di tool e l'altro (GUI, causa principale).** `AgentSession` spegne `isStreaming` e riporta `agentState` a `idle` (`resolveSettledState`) a ogni `turn_end`; `turn_start` lo riaccende. Il cancello leggeva solo quei due campi: nella fixture reale `tools-real.ndjson` si apre quattro volte dentro un solo run. L'effetto spediva al primo frame con un `queueMicrotask` e `dispatchTaskInLane` chiamava `newSession()` sopra il run vivo.
2. **Prompt ammesso, run non ancora partito (GUI).** In omp 18.8 (`rpc-mode.ts`, `#promptWithMessage`) la risposta al comando `prompt` parte su `onPromptAdmitted`, prima di preflight, controllo della chiave, compattazione pre-prompt e `agent_start`. Dopo la consegna `newSession()` aveva lasciato `agentState = idle` e `terminalBusy` tornava falso: il task successivo partiva subito, con un altro `new_session` sopra il prompt appena inviato.
3. **Retry e compattazione che continuano il run.** Passano da un `agent_end` non terminale (`yielded: false`): Studio lo ignorava giustamente, ma il `turn_end` precedente aveva gia' aperto il cancello, per tutta la durata del backoff (secondi) o della compattazione.
4. **Coda nativa di omp.** Steer/follow-up accodati faranno partire un altro turno; con un omp senza quiete nessun campo lo diceva al cancello.
5. **Terminale: stesso buco di (2).** Il titolo resta `π >` finche' omp non avvia il run; `assertAutomationReady` guardava solo il titolo e il secondo task scriveva `/new` sopra il primo. Il titolo invece **non** va a `idle` fra i tool, ne' durante retry e compattazione che continua il run (verificato in `event-controller.ts` di omp 18.8).
6. **Nessuna stabilita' ne' ri-verifica.** Un singolo frame `ready` bastava; un fallimento su Principale veniva ritentato in un ciclo stretto.

### Decisioni

1. **Il cancello conosce il run, non il giro di tool.** `GuiGateSnapshot` aggiunge `runActive` (`settle.running`), `awaitingRun`, `retrying`, `nativeQueue`, `subagentsRunning` (solo omp senza quiete). Run vivo, attesa del run e retry danno `working`; coda nativa e subagenti danno `background`. Entrambi restano instradabili in corsia. Logica pura in `src/lib/agent/runActivity.ts`.
2. **Stabilita' continuata e ri-verifica autorevole.** `AutoDispatchArbiter` (`src/lib/lanes/autoDispatchArbiter.ts`): 2,5 s di idoneita' continuata (3 s nel terminale), in GUI anche 2,5 s dall'ultimo evento del ciclo di vita; poi `get_state` (GUI) o lo stato del PTY (terminale) e una seconda lettura del cancello. Se non e' quieto, nuovo tentativo dopo 5 s senza `get_state` a raffica. 2,5 s sono molto piu' delle pause fra i giri di tool (millisecondi) e restano impercettibili rispetto alla durata di un task.
3. **Lock per progetto** dalla ri-verifica alla consegna; spedizione da timer, fuori dall'effetto. Fallimento su Principale: pausa di 30 s per quel task.
4. **Le voci di stato delle estensioni non sono attivita'.** Un'estensione che aggiorna la riga di stato a vuoto non deve tenere ferma la coda per sempre.
5. **Terminale: il segnale piu' affidabile e' il titolo, piu' l'attesa del run.** Dopo la scrittura del task Studio ignora `idle` fino al primo `working`/`attention` (o 30 s). La barra OSC 9;4 si legge quando c'e' (`terminal.showProgress` in omp), ma non si attiva da Studio: cambierebbe le preferenze dell'utente. Limite dichiarato: un job in background porta il titolo a `idle`; per code con subagenti asincroni la superficie consigliata e' la GUI.
6. **Reti di sicurezza contro il blocco opposto.** `awaitingRun` scade dopo 30 s senza `agent_start` (non durante una compattazione); con un omp senza quiete un run senza eventi da 20 s si chiude se `get_state.isStreaming` e' falso; errori, uscita del processo e rete dello Stop chiudono il run.

### Alternative scartate

- **Solo debounce.** Copre le pause fra i tool, non il backoff dei retry ne' la finestra prima di `agent_start` con preflight lente.
- **Aspettare il `prompt_result` del task precedente.** Esiste solo con omp 18.8 e non copre il terminale.
- **Forzare `TERM_PROGRAM=tern` nel PTY per avere sempre la barra OSC 9;4.** Cambia anche titolo e capability della TUI.

---

## Gate R35: coda che parte al reset della quota

**Data:** 2026-10-08  
**Esito:** IMPLEMENTATO (da verificare su Windows con omp reale)  
**Aggiorna:** Gate R12 (un task programmato parte anche con l'auto-avvio spento), Gate R34 (stesso arbitro)  
**Prototipo:** `coda-reset.html`, variante A (etichetta sul task)

### Il problema

Con la quota del provider finita, un task in coda va a sbattere sul limite oppure resta fermo finche' l'utente non torna al PC al momento del reset. Una sessione fermata dal limite si poteva solo spostare su un altro modello.

### Decisioni (di Maurizio)

1. **Programmazione per task, con l'orologio.** Un'icona orologio (non il menu «⋯») sulla riga della coda e nel TaskEditor: «Al reset della quota», «Non prima delle HH:MM», «Scegli un orario…». Il campo `schedule` sta alla **radice** dello `StudioTask` (in `options` sparirebbe: `sanitizeLoadedTasks` lo ricostruisce con chiavi fisse), con `resume` per le voci di ripresa. Estensione `studio-tasks` e tool `project_tasks` lo conservano, lo mostrano e lo accettano.
2. **Parte anche con l'auto-avvio spento.** La programmazione e' gia' il gesto esplicito (Read-Before-Run). Passa dallo stesso arbitro dell'auto-avvio: stabilita', ri-verifica, lock per progetto, slot unico di R27.
3. **Il reset non si congela.** Ruolo → provider → finestra, riletto a ogni giro da `omp usage`; multi-account (vale il primo che si libera) e finestra settimanale (l'etichetta mostra la data). Prima di partire, snapshot forzato. Senza dati, l'orario salvato e' dichiarato «stima» (Principio 7).
4. **«Aspetta il prossimo reset» nel blocco di quota** accanto a «Passa a…»: voce di ripresa in testa alla coda (`/retry` nella stessa sessione), solo su clic (nessuna rimessa in coda automatica).
5. **Studio chiuso al reset: banner, mai partenza automatica** («Avvia ora / Lasciali in coda»), nemmeno con l'auto-avvio acceso.
6. **Visibilita' senza cruscotti:** chip con orologio e conto alla rovescia in coda, orario sulla riga della Companion, contatore sulla chip della quota e riga nel popover usage.

### Alternative scartate

- **Interruttore di progetto «Rispetta la quota»** (variante B): implicito, una sola soglia, richiede l'auto-avvio acceso, niente «dopo le 19».
- **Sezione «Più tardi» con linea del tempo** (variante C): troppa superficie in 300 px, scivola verso il cruscotto che `PRODUCT.md` evita.
- **`setTimeout` fino al reset:** con lo standby scade in ritardo o tutto insieme; si usa un passo fisso di 30 s piu' fuoco e risveglio.

### Limiti dichiarati

- Studio deve restare aperto (e il PC acceso): non c'e' vassoio di sistema.
- Non fatti in questa iterazione: la «guardia» all'avvio con quota ≤ 10%, il trattenimento automatico dei task non programmati, il parsing «al reset/stanotte» nel Companion, la riga nella barra inferiore.

---

## Gate R36: modalita' Piano nella chat GUI con l'estensione `studio-plan`

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (segnaposto: il numero del Gate si assegna al merge). Riferimento visivo: prototipo `plan-mode.html`, variante A.

### Il problema

1. Il `/plan` di omp (18.8.x) esiste solo nella TUI: `builtin-modes.ts` lo dichiara con `handleTui`, non c'e' un comando RPC `plan`, `get_state` non riporta lo stato del Piano e la revisione del piano (`PlanReviewOverlay`) e' un overlay della TUI. Nella chat GUI (`omp --mode rpc-ui`) `/plan` non faceva nulla di utile.
2. Il Piano e' il modo giusto per i compiti lunghi: esplorare in sola lettura, scrivere un piano completo, approvarlo e farlo eseguire da una sessione pulita. Mancava proprio nella superficie pensata per chi non usa la TUI.
3. Pilotare `/plan` nel PTY dalla GUI e' escluso per la stessa ragione dello scarto di `IDEAS.md` sui pulsanti per i comandi TUI (vedi Gate R33).

### Decisioni

1. **Un'estensione di Studio fa la parte di omp.** `extensions/studio-plan.ts` viene passata con `-e` a ogni processo omp (come `studio-tasks`/`studio-lanes`) ma si accende solo nel processo GUI: `rpc/mod.rs` imposta `OMP_STUDIO_PLAN=gui`; nel PTY la variabile manca e l'estensione resta inerte, cosi' nel Terminale vale il `/plan` nativo. Offre il comando nascosto `/studio-plan on|off|status|review`, l'hook `before_agent_start` (prompt di sistema del Piano; per i subagenti quello dei subagenti), l'hook `tool_call` (guardia di scrittura) e lo strumento `studio_plan_submit({slug, title})`.
2. **Prompt copiati da omp.** I testi del Piano sono adattati da `plan-mode-active.md`, `plan-mode-subagent.md`, `plan-mode-approved.md` e `plan-mode-compact-instructions.md` di oh-my-pi 18.8.4 (MIT, attribuzione nei file). L'adattamento sostituisce `resolve { action: "apply" }` con `studio_plan_submit`. Vanno riallineati a ogni release di omp (controllo in `docs/COMMANDS.md`).
3. **Guardia di scrittura come quella nativa, fail-closed.** In Piano `write`/`edit`/`ast_edit`/`notebook*`/`apply_patch` passano solo verso `local://` e `<cwd>/.omp/plans/`; rinomina ed eliminazione sono sempre vietate; uno strumento di scrittura senza un percorso riconoscibile e' bloccato. `bash` e gli strumenti di lettura non sono toccati: come in omp, la sola lettura dei comandi e' affidata al prompt.
4. **Revisione = `extension_ui_request` di tipo `editor` riconoscibile.** `studio_plan_submit` legge `local://<slug>-plan.md` e chiama `ctx.ui.editor` con titolo `studio-plan-review:<meta JSON>` e il piano come testo precompilato. Studio riconosce il prefisso (`parsePlanReviewRequest`), apre la card del piano a sezioni (`##`) con commenti, modifica ed eliminazione per sezione, e risponde con la decisione JSON (`approve | refine | save | cancel`, strada, ruolo, autosalvataggio, contenuto riscritto). Un client RPC che non conosce il prefisso vede un normale editor e il flusso resta usabile.
5. **Lo stato viaggia su `setStatus('studio-plan', json)`** ed e' salvato nella sessione come voce custom `studio-plan-state`: dopo un resume l'estensione lo ripristina e lo ripubblica, e la GUI lo prende come fonte di verita'.
6. **Il passaggio di compito lo orchestra Studio con i comandi RPC esistenti.** All'approvazione l'estensione salva la copia in `.omp/plans/<TITOLO>_PLAN.md` (stessa regola di `planSaveFileName` di omp, senza sovrascrivere) e spegne la guardia; lo strumento chiude il turno. Studio poi, a sessione ferma, segue la strada scelta (tasti 1-4): **nuova sessione** (predefinita, `new_session`), **nuova corsia** (worktree via `createNewLane`, la vista la segue), **compatta e continua** (`compact` con le istruzioni del piano), **mantieni il contesto**; applica il ruolo d'esecuzione (solo i ruoli configurati, `default` sempre) e consegna il prompt «piano approvato» con il piano incollato. Ogni passo e' visibile nella card del passaggio, con «Torna alla sessione di pianificazione».
7. **Ingressi.** `/plan [testo]` (con testo entra e manda), `/plan-review`, la pillola «Piano» del composer e `Alt+Maiusc+P` (`Ctrl+Opzione+Maiusc+P` su Mac, come `app.plan.toggle` di omp). All'entrata si passa al ruolo `plan` se configurato e il modello precedente torna all'uscita senza approvazione. I messaggi mandati in Piano hanno il badge «Piano». Il Laboratorio e' escluso (Gate R30: una sola chat continua).
8. **Le card del Piano sono voci del solo client** (`PlanEntry`): non sono nella storia di omp; si ancorano al `messageTs` dell'ultimo messaggio e tornano al loro posto quando il transcript si ricostruisce (`reanchorEntries`).

### Limiti noti

- Se omp aggiunge un comando RPC per il Piano (vedi bozza di issue upstream), l'estensione va sostituita: il frontend parla gia' in termini di stato, revisione e decisione e cambia solo il trasporto.
- La guardia non risolve i symlink (la nativa usa `realpath` sull'antenato esistente): un symlink dentro `.omp/plans/` che punta fuori resterebbe scrivibile. Rischio basso, da chiudere se emerge.
- `bash` non e' bloccato, come nel Piano nativo: un agente che ignora il prompt puo' cambiare file con la shell.
- I prompt sono copie: tra una release di omp e il riallineamento il comportamento della GUI puo' divergere da quello della TUI.
- Lo stato del Piano e' per processo omp: i subagenti vedono la stessa guardia; due sessioni principali nello stesso processo non sono un caso di Studio.
- Non verificato con omp reale su Windows: radice di `local://` con percorsi lunghi (ripiego in `%TEMP%\omp-local\<id>` come omp), corsie worktree dal passaggio, ripresa dopo il riavvio di Studio a revisione aperta. La parte Rust (`pty/mod.rs`, `rpc/mod.rs`) non e' stata compilata in sandbox.

### Alternative scartate

- **Pilotare il `/plan` della TUI nel PTY.** Stesso motivo dello scarto di `IDEAS.md`.
- **Solo prompt, senza estensione.** Nessuna guardia di scrittura reale e nessun punto in cui fermare l'agente fino alla decisione.
- **Domanda `ask` per l'approvazione.** Non porta il piano completo ne' le modifiche per sezione; il prompt di omp vieta esplicitamente di chiedere l'approvazione con `ask`.

---

## Gate R37: domande a margine (`/btw`) nella chat GUI con i comandi RPC di omp

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (variante A del prototipo `btw.html`: riquadro effimero sopra il composer)

### Il problema

1. In omp `/btw` ha solo il gestore della TUI: in RPC il dispatcher dei builtin lo salta e il testo arriva a `session.prompt`. Scritto nella chat GUI, `/btw perché…` diventava un messaggio normale al modello principale, entrava nel contesto e, ad agente occupato, finiva in coda.
2. Non c'era un modo di chiedere qualcosa sulla sessione **mentre** l'agente lavora senza interromperlo (steer) o accodare un messaggio (follow-up).
3. omp (dalla 18.6.3) espone invece la funzione completa come comandi RPC dichiarati: `btw`, `btw_cancel`, `get_btw_history` e i frame `btw_record`/`btw_delta` (`docs/rpc.md`, «Side questions»), con lo storico salvato accanto alla sessione e condiviso con la TUI.

### Decisioni

1. **Riquadro effimero sopra il composer (variante A).** Il gesto piu' rapido e la chat resta pulita; il pannello laterale (variante B) toglierebbe larghezza alla chat e la bolla nel transcript (C) rischia di confondere cio' che e' nel contesto con cio' che non lo e'. Lo Storico sta in una tendina del riquadro: se servira' sempre a portata, il riquadro puo' evolvere in B senza cambiare lo stato (`SessionBtw`).
2. **Tre ingressi, un solo stato.** Pulsante «A margine» nel composer, `Ctrl+B` (`⌘B` su Mac) e `/btw [domanda]`. Studio intercetta sempre `/btw` nel guscio (`routeBtwSlash`): non va mai a omp come prompt. Senza domanda apre il riquadro; con la domanda la manda subito.
3. **Niente nel transcript.** I frame `btw_*` vanno a `AgentSession.btw` e mai a `entries`. Esc chiude il riquadro ma la domanda continua: l'argomento aperto resta una riga del vassoio («sta rispondendo» / «risposta pronta» · «Apri»); la X della riga la toglie senza annullare.
4. **Approfondimenti nello stesso argomento.** Dopo una risposta il campo del riquadro approfondisce (`recordId`); «Nuova domanda» apre un argomento nuovo. Una domanda per volta per sessione, come impone omp: Studio non manda la seconda e lo dice invece di mostrare l'errore di omp.
5. **«Usa nel messaggio» = citazione, non promozione.** Domanda e ultima risposta diventano un chip nel composer e un blockquote anteposto al testo **solo all'invio**: entrano nel contesto solo se l'utente invia. Il *branch* della TUI (promuovere lo scambio nella sessione) non ha un comando RPC; resta una richiesta upstream (`btw_branch`).
6. **omp senza `/btw`.** `get_btw_history` a fine insediamento fa da sonda: `Unknown command` (o un `parse` senza id) nasconde il pulsante, e `/btw` o `Ctrl+B` lasciano un avviso che chiede di aggiornare omp dalla barra di stato. Nessun rimando al terminale. Un processo nuovo risonda.
7. **Cambio di sessione.** omp annulla la domanda in corso su nuova chat, ripresa, fork e ramo; Studio azzera storico e argomento aperto quando `get_state` porta un altro `sessionId`. Bozza del riquadro e citazione restano: sono testo dell'utente.
8. **Suggerimenti statici.** Il prototipo mostrava domande legate alla sessione; per non spendere una chiamata al modello all'apertura il riquadro propone tre domande generiche (cosa sta facendo, quanto manca, riassunto delle decisioni).

### Alternative scartate

- **Lasciare `/btw` a omp.** In RPC diventa un prompt: e' esattamente il difetto da correggere.
- **Estensione Studio che intercetta `/btw`.** Inutile: i comandi RPC coprono domanda, approfondimenti, annullamento, storico e streaming.
- **Un pin del layout per il pulsante.** Il layout salvato non riceve le voci nuove (vanno in «Nuovi»): il pulsante e' fisso nel composer e la voce `btw` del catalogo resta fissabile sotto il composer.

### Rischi accettati

- Con il protocollo v1 lo storico non e' paginato: uno storico molto grande puo' superare il limite del trasporto (con la v2 omp lo spezza in chunk, che Studio gia' ricompone).
- Il riquadro copre l'ultima parte del transcript finche' e' aperto; Esc lo chiude senza perdere la risposta.

---

## Gate R38: /loop nella chat GUI con un'estensione di Studio

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (numerazione definitiva al merge)

### Il problema

In omp `/loop` ha solo `handleTui` e tutto il motore vive in `InteractiveMode`: via RPC il dispatcher salta i comandi solo-TUI e il testo arrivava al modello come prompt normale. Non esiste un comando RPC `loop`. I mattoni ci sono (`prompt`, `abort`, `compact`, `new_session`, `agent_end`), mancano il motore e una condizione shell che non finisca nel contesto: il comando RPC `bash` registra l'output nella sessione.

### Decisioni

1. **Motore in un'estensione di Studio, `extensions/studio-loop.ts`**, caricata con `-e` come le altre (`pty/mod.rs`, `rpc/mod.rs`). L'handler `input` gira prima dei builtin anche in RPC (`emitInput(…, "rpc")`) e consuma `/loop …` e le righe di controllo `/studio-loop pause|resume|stop|dismiss|probe|status` anche a turno in corso. `agent_end` chiude il giro, `sendUserMessage` avvia il successivo dopo 800 ms. Semantica della TUI: il primo giro parte sempre, il limite (giri o durata) si controlla prima della condizione, la condizione gira prima di ogni giro dal secondo; exit 0/1 sono risposte, il resto (127, timeout di 30 s, mancato avvio) e' una condizione rotta che ferma il loop e lo spiega. Un abort esterno (Esc, Stop del turno) mette in pausa come nella TUI.
2. **Solo GUI.** L'estensione si registra solo nei processi `--mode rpc-ui` e agisce solo sulla sessione principale (`ctx.mode === "rpc"`, profondita' 0: le estensioni vengono rilegate anche ai subagenti). Nel Terminale resta il `/loop` nativo; la GUI non rimanda mai al terminale.
3. **Condizione in una shell separata con `pi.exec`.** `pi.exec` non passa da una shell e `executeBash` non e' nell'API delle estensioni: l'estensione cerca la shell come `resolveWindowsShell` di omp (Git Bash nei percorsi noti, poi `bash`/`sh` sul PATH, poi `cmd.exe /d /s /c`); su POSIX `$SHELL` se bash/zsh, altrimenti `/bin/bash` o `sh`. L'output non entra nel contesto. Non legge `shellPath` delle impostazioni di omp.
4. **Stato verso la GUI con `setStatus("studio.loop", json)`** (snapshot: loop e ultimo «Prova ora»), lo stesso canale che leggono Companion e coda tramite `AgentSession.loop`. Persistenza con `appendEntry("studio-loop", { loop })` a ogni transizione: al resume un loop vivo torna **in pausa**, mai in corsa da solo; un giro lasciato a meta' conta come interrotto. Dopo l'insediamento Studio chiede `/studio-loop status`, perche' il frame di `session_start` puo' arrivare prima che la chat ascolti.
5. **Presenza del motore verificata prima di inviare.** L'estensione registra il comando `studio-loop` (compare in `get_available_commands`, nascosto dai menu di Studio): senza, Studio non manda nulla, perche' `/loop` finirebbe al modello come testo.
6. **«Tra i giri»:** `prompt` (continua), `compact` (`ctx.compact()` prima del giro), `reset` (sessione nuova). Le estensioni hanno `newSession` solo nei comandi: con `reset` il motore si ferma in `resetting`, Studio manda `new_session` e il giro riparte su `session_switch` con motivo `new`. In omp e' l'impostazione `loop.mode`; nella GUI e' il flag `--between` (solo Studio).
7. **Interfaccia: variante B del prototipo** (`out/prototipi/loop.html?v=B`). Il composer diventa la modalita' ripetizione (pillole con menu, anteprima della riga `/loop …`, «Avvia»), poi il pannello di controllo (barra a segmenti, contatore grande, Pausa a fine giro / Riprendi / Stop immediato al posto di Invia, «Prova ora»). Implementata come `shellOverride` del `Composer`: avvisi e riga di stato restano, la bozza resta nell'editor nascosto. I giri si riconoscono dal prompt ripetuto (`UserEntry.loopGiro`, marcato perche' lo stato del giro arriva prima del prompt) e si ripiegano nel transcript (`foldLoopItems`).
8. **La sessione resta occupata finche' il loop e' attivo**, pausa compresa: `GuiGateSnapshot.loopActive` blocca il cancello della coda (blocco `loop`, instradabile su un'altra corsia) e `laneBusy`; fra due giri la corsia risulta al lavoro.
9. **Il loop non parte a turno in corso**: il primo giro diventerebbe uno steer del turno attivo.

### Alternative scartate

- **Motore dentro Studio** (`loopRunner` + comando Rust per la condizione): semantica duplicata lato GUI e un secondo runner shell da mantenere.
- **Comando RPC `bash` per la condizione:** registra l'output nella sessione e sporca il contesto.
- **Ripristinare un loop in corsa dopo il resume:** ripartirebbe da solo senza che l'utente lo veda.

### Da verificare su Windows con omp reale

Caricamento dell'estensione in `rpc-ui`, ordine `setStatus` → messaggio utente del giro, shell scelta per la condizione (Git Bash vs `cmd.exe`), `compact` e `reset` tra i giri, ripristino in pausa dopo il resume.

---

## Gate R39: obiettivo guidato nella chat GUI (intervista, variante B)

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (prototipo `guided-goal.html`, variante B approvata)

### Il problema

1. In omp `/goal` e `/guided-goal` hanno solo la versione TUI. Nella chat GUI (`omp --mode rpc-ui`) il testo arrivava al modello come prompt normale: niente obiettivo, contesto sporcato.
2. Il goal mode era raggiungibile via RPC (`goal {op}` + `goal_updated`) e Studio aveva gia' il vassoio con Pausa/Riprendi/Elimina, ma **nessun punto di creazione**.
3. Via RPC un obiettivo **non prosegue da solo**: `goal.continuationModes` vale `["interactive"]` di default, quindi in Studio faceva un turno e si fermava.
4. omp applica solo il `token_budget`: il «tetto di tentativi» dell'intervista di omp e' testo nell'obiettivo.

### Decisioni

1. **Intervista in chat, una domanda alla volta (variante B).** Cinque campi come l'intervista di omp (criteri binari, verifica, tetto, confini, stop). La domanda corrente si risponde da una scheda a scelte che prende il posto del composer (grammatica di AskCard, «Altro…» per la risposta libera, Salta, Annulla con Esc); una striscia in cima alla chat mostra i cinque campi che si spuntano. Alla fine la bozza arriva come card nel transcript, modificabile sul posto.
2. **Il flusso e' di Studio ed e' deterministico.** Domande e risposte proposte sono fisse (`src/lib/agent/guidedGoal.ts`), le risposte libere si interpretano con parser puri; nessun turno del modello e' necessario. Le entry dell'intervista sono locali al transcript: non vanno a omp e non entrano nel contesto (il «contro» della variante B, «occupa la sessione per 5 turni», non c'e').
3. **L'agente puo' affinare le proposte, senza occupare la sessione.** Estensione `extensions/studio-goal.ts` (solo GUI): comando `/studio-goal suggest {…}` mandato come prompt (i comandi delle estensioni partono prima di tutto e anche a turno in corso), lettura dei comandi del progetto, `ctx.runEphemeralTurn({tools:false})` come `/btw`, risposta con `setStatus("studio.goal", json)` subito azzerato. Le proposte sostituiscono solo le domande non ancora risposte e possono riformulare l'obiettivo in modo misurabile. Senza estensione, con omp senza turni a margine o con un errore, nulla cambia nel flusso.
4. **Controlli prima dell'avvio.** «Avvia obiettivo» resta spento con obiettivo vuoto, nessun criterio, un criterio vago («più veloce», «più pulito», «faster» senza numero, comando, exit code o test), nessuna verifica o tetto incompleto. Confini e stop mancanti sono consigli non bloccanti. Il criterio vago e' segnalato gia' nella scheda (risposta libera) e in giallo nella striscia e nella bozza.
5. **`goal create` con markdown a sezioni fisse** e `token_budget` dal tetto; il tetto di tentativi entra nelle condizioni di stop (`Stop after N attempts and ask the user how to proceed.`) e **Studio lo fa rispettare**: conta un tentativo per ogni `agent_start` con l'obiettivo attivo e fa `goal pause` all'`agent_end` terminale che raggiunge il tetto, con un avviso. Il conteggio vive in Studio: dopo un riavvio riparte da zero (il tetto si rilegge dal testo).
6. **Continuazione abilitata da Studio, senza voce nelle Impostazioni.** L'overlay GUI per-sessione aggiunge `goal.continuationModes: [interactive, rpc]`. Vale solo per i processi `rpc-ui` lanciati da Studio; la config dell'utente e il terminale non cambiano.
7. **Banner fisso in cima alla chat** per ogni obiettivo della sessione (anche creato con `/goal` o dallo strumento `goal` dell'agente): titolo, stato, tentativi contro il tetto a segmenti, budget con barra, tempo, Pausa/Riprendi/Stop (Stop = `drop` con conferma), criteri e verifica a scomparsa. Sostituisce la sezione obiettivo del vassoio: l'obiettivo e' la cornice della sessione, non un'attivita' accanto al composer. Completato resta verde e chiudibile.
8. **La coda considera la chat occupata** finche' l'obiettivo e' attivo o in definizione (`goalHold` nel cancello, `laneBusy` nel routing): fra un tentativo e l'altro l'agente risulta fermo ma omp sta per ripartire.
9. **Ingressi.** Pulsante «Obiettivo» fissato di fabbrica nella barra del composer (voce `guided-goal` del catalogo, unica eccezione alla regola «comandi del guscio non fissati»), `/guided-goal [idea]`, `/goal` senza argomenti (intervista se non c'e' un obiettivo, stato se c'e'), `/goal <obiettivo>` crea subito come in omp, `/goal pause|resume|drop|stop|show`. `/goal budget` non ha un RPC: Studio lo spiega. Mai rimandi al terminale. In Laboratorio non e' disponibile.

### Alternative scartate

- **Kickoff nascosto con il prompt `guided-goal-interview.md` di omp** (l'agente intervista nella sessione): servirebbero `prompt synthetic` e `set_active_tools` via RPC, che non esistono; ogni domanda sarebbe un turno nel contesto e l'intervista non funzionerebbe senza modello.
- **Domande generate dall'agente con `ask`**: stessa occupazione della sessione e nessun flusso deterministico.
- **Voce in Impostazioni per `goal.continuationModes`**: senza continuazione un obiettivo creato dalla GUI non serve a nulla; non e' una preferenza.
- **Tetto di tentativi applicato da omp**: non esiste il campo; resta la richiesta upstream (insieme a un'op `goal interview`).

---

## Gate R40: heads-up di fine turno, una frase sola e solo se serve

**Data:** 2026-10-08
**Esito:** APPROVATO (variante A del prototipo `heads-up.html`, ridotta su indicazione di Maurizio)

### Il problema

Nei turni lunghi la cosa importante (un test fallito e lasciato lì, una modifica allo schema del database, una domanda posta a metà risposta) sta in mezzo al racconto e si perde. Il prototipo proponeva una scheda «Da guardare» con fino a cinque voci e un'azione per voce: troppo. Maurizio vuole una card piccola con **al massimo una frase**, che compare solo quando c'è davvero qualcosa.

### Decisioni

1. **Una frase, tre fonti, priorità fissa.** Agente (`studio_headsup`) > sintesi smol > frase composta dai fatti. L'agente vince perché solo lui sa cosa non ha verificato o cosa ha deciso da solo; smol sostituisce i fatti perché li riceve in ingresso e li fonde col racconto; i fatti sono il ripiego deterministico a costo zero.
2. **Fatti certi calcolati da Studio** (`turnHeadsUp.ts`, funzioni pure): comando di **verifica** (test, build, typecheck, lint) fallito e mai riuscito dopo con la stessa chiave; domanda `ask` scaduta e risolta da omp col default; comando rischioso riuscito (`git push`, `reset --hard`, `clean -f`, `rm -r` fuori da `node_modules`/`dist`/`/tmp`…, `DROP TABLE`, `publish`); file delicato modificato (manifest delle dipendenze, migrazioni e `.sql`, `schema.prisma`, CI, `.env*`, `AGENTS.md`/`CLAUDE.md`, `tauri.conf.json`, capability). Un `grep` che esce con 1 non è un fatto; i lockfile da soli non contano. La frase dai fatti usa al massimo le due categorie più gravi.
3. **Tool `studio_headsup`** in `extensions/studio-headsup.ts`, caricato con `-e` in GUI e PTY come le altre estensioni. Nessuna riga nel prompt di sistema: la regola d'uso (quando chiamarlo e quando no, una frase, max 200 caratteri) sta nella descrizione del tool. Restituisce subito «ok»; la frase sta negli argomenti, quindi resta nel `.jsonl` e torna anche dopo una ripresa.
4. **Ripiego smol nella chiamata esistente.** Nessuna seconda chiamata: `generate_prompt_suggestions` riceve `turnDigest` e `wantHeadsUp` e risponde con `headsUp` (una frase o `null`). Si chiede solo se l'agente ha taciuto e il turno è grande (fatti certi, almeno 8 chiamate o 1.500 caratteri di testo). Con i suggerimenti dinamici spenti smol non parte e restano i fatti.
5. **Dove:** card prima del piè di turno; la stessa frase nella card del progetto della companion e nella notifica di sistema (una per turno, dopo l'analisi post-turno; mai se il turno chiede già una risposta o se stai guardando quel progetto; con lo stile compatto la frase resta fuori dalla notifica). I turni passati mostrano solo la frase dell'agente.
6. **Gesti:** clic sulla frase = vai al punto (primo fatto, altrimenti ultima risposta); X = visto. Il «visto» è machine-local (`localStorage`, chiave sessione + hash della frase), non in `~/.omp` né nel repo.

### Perché non le alternative

- **Elenco di voci con azioni (prototipo A pieno):** più informazione, ma occupa metà chat e diventa un secondo racconto da leggere.
- **Solo smol:** vede solo il testo, non sa cosa non è stato verificato e tende a inventare cautele generiche.
- **Solo agente:** può dimenticarsene, e su un fallimento è giudice di parte.
- **Riga fissa nel prompt di sistema:** costa token a ogni turno; la descrizione del tool basta.

### Rischi accettati

- La lista dei file delicati e dei comandi di verifica è un default fisso, non ancora configurabile per progetto.
- Nelle sessioni terminale (PTY) la card non esiste: la TUI mostra la chiamata `studio_headsup` come un tool qualsiasi, e companion e notifica non ricevono la frase.
- Il modello può chiamare `studio_headsup` anche quando non serve: la descrizione lo vieta esplicitamente, ma l'effetto va osservato sull'uso reale.

---

## Gate R41: diario di bordo e documenti di progetto tenuti dall'agente

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (variante A del prototipo `diario-progetto.html`; numero del Gate da assegnare al merge)

### Il problema

1. Cio' che si decide in una sessione (scelte, motivi, strade scartate, dubbi) resta nel transcript: la sessione successiva, un'altra corsia o un altro modello non lo sanno, e Maurizio deve rispiegarlo.
2. `AGENTS.md` e le regole dicono all'agente *come* lavorare, non *cosa* e' il progetto e *perche'* e' fatto cosi'; mescolarci la storia farebbe crescere il contesto di ogni turno.
3. Chiedere all'utente di approvare ogni riga di diario (schede da confermare) trasforma un aiuto in un compito: Maurizio vuole che l'agente lo tenga quasi interamente da solo.

### Decisioni

1. **Un'estensione, un tool, un comando.** `extensions/studio-docs.ts` si carica con `-e` nelle sessioni di progetto PTY e RPC (non nel Laboratorio), come `studio-tasks` e `studio-lanes`. Registra il tool `project_docs` (`list`, `read`, `search`, `update`, `sources`, `init`) e il comando `/diario` (`init [locale]`, `aggiorna`, `locale`, `repo`, `<domanda>`). Il prompt di sistema riceve **una sola riga** (~60 token, hook `before_agent_start`) e solo nei progetti col diario attivo: documenti e diario si leggono su richiesta.
2. **Dove vivono i file: nel repo, per default.** Diario mensile in `docs/diario/AAAA-MM.md`, documenti tematici in `docs/progetto/{scopo,uso,decisioni,storia,domande-aperte}.md`, manifest in `.omp/progetto.json`. Motivazione della cartella:
   - il diario e' conoscenza del progetto, non della macchina: deve viaggiare col codice (clone, altro PC, collaboratori, revisione nelle PR) e git ne conserva data e autore gratis; in `~/.omp` andrebbe perso cambiando macchina e mescolerebbe i progetti;
   - `docs/` e' dove gli esseri umani e gli agenti cercano gia' la documentazione; `.omp/` e' spesso ignorato da git e nascosto negli editor;
   - due sottocartelle distinte perche' sono due forme diverse: `diario/` e' cronologico e cresce solo in coda, `progetto/` descrive lo stato attuale per tema e si riscrive;
   - un file per mese tiene i file corti (leggibili a colpo d'occhio, poco contesto quando l'agente li apre) e limita i conflitti di merge al mese corrente;
   - nomi in italiano come il resto del lavoro di Maurizio; il manifest permette di mapparli su documenti gia' esistenti (es. `decisioni -> docs/DECISIONS.md`) invece di duplicarli.
3. **Opzione per progetto fuori da git.** `/diario init locale`, `/diario locale` e il pulsante «Inizializza fuori da git» usano `storage: "local"`: tutto in `.omp/progetto/`, escluso con `.omp/.gitignore` (lo stesso file di `tasks.json`). Serve per repository di clienti o pubblici. `/diario repo` lo riporta in `docs/`. I documenti mappati su file dell'utente non si spostano mai. Lo stato macchina (impronte delle sezioni scritte dall'agente) sta sempre in `.omp/progetto-stato.json`, fuori da git.
4. **L'agente scrive da solo, citando la fonte.** A fine task con contenuto durevole (decisioni e perche', cosa cambia per chi usa il progetto, tappe, domande aperte) l'agente aggiorna diario e documenti con `project_docs update` senza chiedere; ogni riga porta la fonte (`[sessione 1a2b3c4d]`, `[commit abc1234]`). Nessuna scheda da approvare.
5. **Le righe scritte a mano sono dell'utente.** `replace_section` riscrive una sezione solo se il corpo e' ancora identico all'impronta lasciata dall'agente; altrimenti rifiuta e l'agente deve chiedere (`force` solo dopo il si'). `append` e `add_section` non toccano il testo esistente.
6. **`/diario init` legge prima di chiedere.** Se il progetto ha materiale (documentazione, piu' di qualche commit, sessioni passate) l'agente ricava i documenti da README/AGENTS/docs/CHANGELOG, `git log` e storico delle sessioni (`history.db` e transcript `.jsonl` di omp, **in sola lettura**) e mette cio' che non trova in `domande-aperte`. Su un progetto nuovo fa un'intervista breve: una domanda per messaggio, al massimo 6-8. Dalla GUI l'inizializzazione parte come un task normale, cosi' segue l'instradamento della coda e resta nello storico.
7. **Un diario per progetto, anche nelle corsie.** La radice e' il checkout principale (`git rev-parse --git-common-dir`): scriverlo nel worktree lo spezzerebbe in rami che si scontrano al merge.
8. **Scheda «Progetto» in sola lettura.** Il pannello Agente guadagna la quarta sottoscheda: documenti, ultime voci del diario, apertura nell'editor per correggere a mano, e «Chiedi al diario» con una chiamata effimera al modello leggero (`project_docs_ask`, stesso schema dei suggerimenti: `omp -p --no-session --no-tools`, 60 s). Il frontend sceglie gli estratti pertinenti e li passa come contesto; Rust non legge il disco, quindi il comando non puo' uscire dal progetto.

### Rischi accettati

- Lavorando in una corsia, l'agente scrive il diario nel checkout principale: le modifiche compaiono li' come file non committati finche' qualcuno non le committa.
- `history.db` si legge con `bun:sqlite`: fuori da Bun (test con Node) l'elenco dei prompt e' vuoto e l'init si basa su documenti, git e transcript.
- Se `.omp/` e' ignorato dal `.gitignore` di radice, il manifest (e quindi le mappature) resta solo su questa macchina; l'agente lo segnala in una riga all'init.
- «Chiedi al diario» risponde solo dagli estratti scelti per parole: una domanda formulata con parole diverse puo' non trovarli; in chat `/diario <domanda>` usa l'agente completo.

---

## Gate R42: «Indica e disegna» nel Laboratorio (versione semplificata)

**Data:** 2026-10-08
**Esito:** IMPLEMENTATO (da collaudare su Windows, macOS e Linux con omp reale)

### Decisioni di Maurizio

1. **Solo due modalita':** *Punta* (clic su un elemento, Maiusc+clic per aggiungerne altri alla stessa nota) e *Riquadro* (si trascina un rettangolo e si raccolgono gli elementi DOM significativi al suo interno, raggruppati per componente e `file:riga`). Niente penna, niente ritocco diretto: sostituiscono il vecchio pulsante «Seleziona».
2. **Note numerate in una coda nel composer:** ogni selezione ha numero e nota facoltativa; un componente nuovo (`LabNotesQueue.svelte`), non `ComposerPinnedItem` (che e' il pulsante dei comandi fissati). All'invio diventano un blocco compatto `<lab-notes>`.
3. **Un solo fotogramma annotato per messaggio**, allegato come immagine con il meccanismo degli allegati del composer.
4. **Cattura multipiattaforma senza codice nativo:** niente `CapturePreview` di WebView2. Il DOM si rasterizza dentro l'iframe (tecnica di modern-screenshot/html-to-image: clone con stili calcolati → SVG `foreignObject` → canvas, immagini e font come data URL), implementata come modulo vendorizzato nello script ispettore, senza dipendenze npm. Fallback: solo testo con avviso.
5. **Riaggancio dopo la ricompilazione** tramite `data-lab-loc` + indice d'istanza + selettore; una nota il cui elemento sparisce resta, marcata «superata».
6. **Scorciatoia `Alt+I` solo nel Laboratorio** (Ctrl+Opzione+I su macOS, come le altre scorciatoie a lettera della GUI).

### Motivazioni tecniche

- **Mappa sorgente al momento della compilazione.** React 19 ha tolto `_debugSource` e il bundle vendorizzato e' di produzione: l'unica fonte affidabile di `file:riga` e' esbuild con `jsxDev`, che passa `{fileName, lineNumber, columnNumber}` allo shim. Costo: un attributo per elemento host, trascurabile in locale.
- **Rasterizzazione nell'iframe invece della cattura nativa.** Il parent non puo' leggere i pixel di un iframe a origine opaca; la cattura nativa richiederebbe tre implementazioni (WebView2, WKWebView, WebKitGTK) non compilabili qui e andrebbe ritagliata per non includere la chat. Il clone del DOM resta dentro il prototipo, e' identico sui tre sistemi e non tocca Rust. Limiti accettati: canvas WebGL, video e iframe annidati diventano segnaposto; immagini e font di altre origini senza CORS vengono sostituiti; la resa di WebKit puo' differire di qualche pixel.
- **Sicurezza.** Nessun `allow-same-origin`; il parent accetta solo messaggi dal proprio iframe. Il prototipo potrebbe falsificare un messaggio dell'ispettore, ma l'effetto massimo e' una nota visibile nella coda, che non parte senza l'invio dell'utente.
- **Gate R24 aggiornato:** il punto «Isolamento del renderer» descriveva il Chromium dedicato con origine `lab.virtual`, superato dal Gate R30; ora lo dice esplicitamente.

---

## Gate R33: le corsie le guida l'agente con un tool per verbo, il "come" resta a Studio

**Data:** 2026-10-07
**Esito:** APPROVATO (estende il Gate R29 e rivede il punto 9; rivede il punto 5 sui conflitti)

### Il problema

L'agente poteva solo integrare una corsia (`studio_lane_integrate`). Per aprirne una, sapere a che punto era, leggerne l'esito, chiuderla o consegnare un prototipo del Laboratorio servivano clic dell'utente, oppure l'agente ripiegava su `git worktree`, `git merge` e `git add` fatti a mano: proprio cio' che il Gate R29 voleva togliere. Sui conflitti il tool chiedeva all'agente di risolverli e fare `git add` nel worktree, cioe' gli consegnava percorsi e comandi git.

### Decisioni

1. **Un tool per verbo, ciascuno con la sua approvazione.** `corsia_avvia` (write), `corsia_stato` (read), `corsia_risultato` (read), `corsia_integra` (write), `corsia_chiudi` e `corsia_scarta` (write), `corsia_consegna` (write), `corsia_fatto` (read), `corsia_proponi` (read). L'agente nomina cosa vuole; branch, worktree, commit, merge e pulizia restano a Studio, che riusa i flussi della GUI (spedizione del task in corsia nuova, `worktree_land`, `closeLane`, `deleteWorktreeLane`, `deleteLabPrototype`).
2. **Bridge a router.** `lane_bridge.rs` espone `POST /v1/corsie/{avvia,stato,risultato,integra,chiudi,scarta,consegna,fatto,proponi}`; `/v1/lane/integrate` resta come alias di `integra`. Stesso token per sessione, stesso confronto in tempo costante, stesso `BridgeOwner`, stesso inoltro al frontend (`lane-bridge://request` + `lane_bridge_respond`), ora con `route` e `body`.
3. **Permessi dal proprietario del token.** Dentro una corsia (worktree o Laboratorio) si possono chiamare solo `fatto` e `stato`: una corsia non apre, integra o scarta corsie. Il controllo e' in Rust (403) e ripetuto nel frontend; l'estensione registra solo i tool ammessi.
4. **Integrazione pulita automatica, conflitti all'utente.** Merge pulito: squash e pulizia senza conferma, come oggi. Con conflitti l'agente riceve l'elenco dei file e l'istruzione di non risolverli; la corsia passa in `conflict` e Studio apre la revisione (`LaneReviewModal`) quando il progetto e' in vista.
5. **Soft-cap: l'agente non chiede, mette in coda.** Oltre `CONCURRENCY_SOFT_CAP` l'obiettivo di `corsia_avvia` entra nella coda del progetto come task e parte da solo quando si libera un posto; la risposta e' "in coda". I prototipi del Laboratorio non contano nel cap, come nel routing della coda.
6. **Scartare lavoro mai integrato chiede sempre conferma.** `corsia_scarta` su un worktree con commit mai integrati, con processi vivi o su un prototipo non cancella nulla: apre il dialogo di eliminazione della `LaneStrip` e risponde all'agente di non ritentare.
7. **`corsia_fatto` lascia il riassunto nel record della corsia.** Il testo e l'ora sono persistiti in `lanes.json` (`agentSummary`, `agentSummaryAt`, campi opzionali: i registri precedenti restano validi); un worktree attivo passa a `review_ready`. `corsia_risultato` lo restituisce con il diffstat, o con revisione e anteprima per un prototipo.
8. **Il Laboratorio riceve il canale, ma solo per `corsia_fatto`.** La sessione Lab di un prototipo di progetto riceve il token e carica `studio-lanes.ts` dopo `studio-lab.ts`; l'allowlist fail-closed ammette `corsia_fatto` e nessun altro `corsia_*`. Le bozze libere restano senza canale.
9. **Proporre un worktree e' un gesto esplicito.** Prima di operazioni rischiose o sperimentali l'agente chiama `corsia_proponi`: una card dedicata (non la domanda di `ask`) con «Operazione pericolosa, facciamo worktree?», il motivo e due pillole, «No, resta su main» e «Crea nuovo worktree». Il tool resta bloccato fino al clic (fino a 30 minuti); «Crea» crea la corsia e le affida l'obiettivo, o la apre vuota all'utente. Le descrizioni dei tool vietano di creare corsie in silenzio.
10. **Ogni tool ha la sua card in chat**, fuori dal gruppo di esecuzione, con i colori e gli anelli della `LaneStrip` e i pulsanti Apri, Revisiona, Conferma eliminazione.

### Perche' non le alternative

- **Un solo tool con un parametro `azione`:** meno superficie, ma un'unica approvazione per letture e cancellazioni e descrizioni troppo generiche per guidare il modello.
- **L'agente risolve i conflitti da solo:** veloce, ma riporta git nelle mani dell'agente e nasconde all'utente proprio il momento in cui due lavori si toccano.
- **Oltre il soft-cap si chiede conferma come nella GUI:** il tool resterebbe bloccato su un dialogo che l'utente non ha chiesto; la coda e' reversibile e visibile.

### Rischi accettati

- Una proposta lasciata senza risposta tiene il turno dell'agente fermo fino a 30 minuti. Se l'agente viene fermato prima del clic la card perde le pillole e mostra la proposta come chiusa; le proposte aperte non accendono l'anello d'attenzione del progetto.
- Il riassunto di `corsia_fatto` e' quello che l'agente scrive: Studio non lo verifica contro il diff, che `corsia_risultato` mostra accanto.
- Il conflitto risolto dall'agente della corsia su richiesta dell'utente (pulsante della revisione) usa ancora `git add` nel worktree, perche' `worktree_land` lo richiede per chiudere il merge.
