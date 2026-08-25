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
