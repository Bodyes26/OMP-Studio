# Browser Studio — Specifica canonica

**Stato:** S38-S41 implementati (contratto `browser-live-v1`, broker/Chromium gestito, stream binario BLF1 e BrowserViewer centrale); S42-S47 non implementati  
**Gate:** R23  
**Ultimo aggiornamento:** 2026-09-03  
**Owner documentale:** ogni agente che completa uno step S38-S47

Questo documento e la fonte autoritativa per l'implementazione del Browser Studio. Gli agenti assegnati agli step in `docs/PLAN.md` devono leggerlo prima di modificare codice e aggiornarlo al termine del proprio step con i dettagli realmente implementati. Non devono ripetere la ricerca sui competitor ne introdurre una seconda architettura.

## 1. Problema

Il tool `browser` del runtime OMP controlla oggi un processo Chromium/Chrome separato tramite Puppeteer e Chrome DevTools Protocol (CDP). Quando il browser e headed, Windows mostra una finestra desktop esterna. Studio riceve soltanto eventi discreti `tool_execution_start`, `tool_execution_update` e `tool_execution_end`, piu screenshot allegati al risultato.

Il viewer centrale esistente non puo ospitare quella sessione:

- `src/lib/components/PreviewViewer.svelte` renderizza prototipi locali in un iframe `srcdoc` sandboxed;
- `extensions/studio-diagram.ts` genera file statici sotto `proto/` e notifica Studio tramite file JSON;
- `src-tauri/src/previews.rs` osserva le notifiche e apre il prototipo;
- `src/lib/agent/tools/renderers/Browser.svelte` mostra solo riepilogo e screenshot del tool `browser` nel transcript.

`PreviewViewer` non ha navigazione HTTP generale, profilo, cookie, Windows Authentication o un endpoint CDP. Deve restare dedicato ai prototipi statici e non va trasformato in un browser.

## 2. Risultato di prodotto

Quando un agente invoca il tool standard `browser`:

1. il runtime apre o riusa un Chromium gestito senza finestra desktop;
2. Studio passa alla superficie Browser nella colonna centrale;
3. utente e agente vedono e controllano la stessa tab;
4. il primo input umano interrompe atomicamente l'agente;
5. login, password e CAPTCHA possono avvenire in takeover privato;
6. console, rete, elementi e azioni sono ispezionabili senza aprire DevTools completo;
7. quando serve una sessione autenticata personale, l'utente puo collegare una singola tab del proprio Chrome tramite OMP Browser Relay.

Il tool resta `browser`: non introdurre un tool concorrente `studio_browser`.

## 3. Decisioni vincolanti

Le decisioni seguenti sono gia state prese e non vanno riaperte durante gli step:

1. **Superficie distinta.** Creare un BrowserViewer dedicato; non estendere `PreviewViewer`.
2. **Motore predefinito.** Chromium gestito dal runtime OMP, senza finestra desktop, trasmesso dentro Studio.
3. **Coerenza multipiattaforma.** Non usare WebView2/WKWebView/WebKitGTK come motore automatico: cambierebbe comportamento per sistema operativo e non offrirebbe un CDP uniforme.
4. **Niente CEF nel bundle.** Non incorporare Chromium Embedded Framework dentro Tauri: peso, aggiornamenti di sicurezza e duplicazione del runtime non sono giustificati.
5. **Confine runtime/Studio.** Il runtime OMP possiede browser, CDP, profili, tab e broker; Studio possiede presentazione, input utente e inspector. Il CDP grezzo non viene esposto al frontend Svelte.
6. **Trasporto dedicato.** Frame live e input usano un canale locale autenticato separato dal transcript RPC. Gli eventi tool esistenti restano per lifecycle, risultato e fallback.
7. **Profilo per progetto, tab per chat.** Cookie e storage persistono per progetto; ownership di tab e controllo appartengono alla chat.
8. **Controllo esclusivo.** Agente e utente non inviano input contemporaneamente. Il primo input umano incrementa il control epoch e invalida le azioni agente obsolete.
9. **Ritorno esplicito.** Dopo il takeover l'agente riprende solo tramite “Restituisci controllo”.
10. **Takeover privato.** Durante input sensibile Studio continua a mostrare localmente la pagina, ma agente, transcript, registrazione, DOM, console e rete non ricevono dati.
11. **Origini.** Navigazione top-level automatica per `localhost` e `127.0.0.1`; nuova origine remota solo dopo consenso per progetto. Un redirect non autorizzato sospende l'agente.
12. **Chrome personale opzionale.** Collegare una tab scelta tramite OMP Relay; non controllare direttamente l'intero profilo e non copiarne i database.
13. **Inspector mirato.** Element picker, Console, Network, Actions, viewport, screenshot e registrazione; non incorporare Chrome DevTools completo.
14. **Fallback compatibile.** Runtime o Studio privi della capability live continuano a usare il renderer screenshot attuale.
15. **Nessun servizio cloud.** Broker, stream, profili e artefatti restano locali.

## 4. Riferimenti verificati

La ricerca e gia stata completata. Gli step non devono ripeterla.

### T3 Code

Pattern principale adottato:

- Chromium embedded;
- CDP e runtime Playwright iniettato;
- profili persistenti isolati;
- toolkit MCP browser;
- control epochs;
- input umano attendibile che interrompe l'agente.

Fonti:

- <https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/preview/BrowserSession.ts>
- <https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/preview/Manager.ts>
- <https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/preview/PickPreload.ts>
- <https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/toolkits/preview/tools.ts>

T3 Code e Electron: OMP Studio adotta control epochs, isolamento e UX, non la sua topologia `<webview>`.

### Cursor

Pattern adottato: sessione persistente per workspace e policy per origine.

- <https://cursor.com/docs/agent/tools/browser>

### Claude

Pattern adottato: browser pulito per sviluppo, Chrome personale opzionale e takeover manuale per login/CAPTCHA.

- <https://code.claude.com/docs/en/chrome>
- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool>

### Hermes

Pattern adottato: broker autenticato, separazione driver/supervisor/controller e trattamento esplicito di dialoghi e frame cross-origin.

- <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md>
- <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/browser-supervisor.md>
- <https://github.com/NousResearch/hermes-agent/blob/main/gateway/browser_control_broker.py>

### Codex

Pattern adottato: policy per origine, capability granulari e takeover senza raccolta di credenziali.

- <https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/browser_use_config.rs>
- <https://openai.com/index/operator-system-card/>
- <https://developers.openai.com/api/docs/guides/tools-computer-use>

### Anti-pattern

Cline lancia Chrome esterno o Chromium headless senza superficie live integrata; OpenHands mostra snapshot ma non offre takeover completo. Questi modelli non soddisfano il requisito.

- <https://github.com/cline/cline/blob/main/apps/vscode/src/services/browser/BrowserSession.ts>
- <https://github.com/OpenHands/OpenHands/blob/main/src/stores/browser-store.ts>

## 5. Confine dei repository

`omp-studio-app` contiene UI, backend Tauri, estensioni e questa specifica. Il browser tool, il tab supervisor e il Relay appartengono al runtime upstream `can1357/oh-my-pi`.

Il sorgente upstream non e presente in questo workspace. Gli step runtime richiedono un checkout separato del repository OMP e devono produrre un commit/PR upstream identificabile. Non vendorizzare il runtime dentro `omp-studio-app`, non modificare `%LOCALAPPDATA%/omp/omp.exe` e non salvare una copia del sorgente sotto `ricerca/`.

Checkout usato da S38 e S39: `../oh-my-pi-upstream`, fratello di `omp-studio-app` e fuori dal repository. I test di Studio lo cercano li, oppure al percorso indicato da `OMP_UPSTREAM_ROOT`; se manca, il confronto della fixture condivisa viene saltato e dichiarato come tale, mai simulato con uno shim Studio-only.

S39 e interamente runtime: `omp-studio-app` non ha ricevuto codice, soltanto documentazione. Moduli toccati nel runtime:

| File | Ruolo |
|---|---|
| `packages/coding-agent/src/tools/browser/session-broker.ts` | `BrowserSessionBroker`: identita, profili, registro tab, ticket, cancellazione dati |
| `packages/coding-agent/src/tools/browser/shared-daemon.ts` | `ensureManagedBrowser` + `MANAGED_BROWSER_DAEMON_NAME` (`omp.browser.managed`) |
| `packages/coding-agent/src/tools/browser/registry.ts` | nuovo `BrowserKind` `managed` e `openManagedHandle` |
| `packages/coding-agent/src/tools/browser/tab-supervisor.ts` | tab indirizzate da chiave opaca, `tabName` separato, hook `onClosed`, `dropAutomationTabs` |
| `packages/coding-agent/src/tools/browser.ts` | motore predefinito `managed`, chiavi per chat, pubblicazione stato al broker |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | registrazione del provider, ponte eventi, teardown |
| `packages/coding-agent/src/slash-commands/builtin-collaboration.ts` | `/browser clear-data` |
| `packages/coding-agent/src/tools/read-pdf.ts`, `src/web/search/providers/browser-page.ts` | caller migrati al motore gestito |
| `packages/utils/src/dirs.ts` | `getBrowserProfilesRoot` / `getBrowserProfileDir` |
| `packages/coding-agent/scripts/s39-managed-browser-smoke.ts` | smoke reale dei sei scenari di accettazione |
| `packages/coding-agent/test/tools/browser-session-broker.test.ts` | 19 test comportamentali sul broker |

Ogni cambio di protocollo deve essere documentato qui prima di essere consumato da Studio. La compatibilita tra release viene negoziata tramite capability, non tramite assunzioni sulla versione installata.

## 6. Architettura target

```mermaid
flowchart LR
    A[Agente OMP] -->|browser open/run/close| B[BrowserSessionBroker]
    B --> C[Chromium gestito]
    B -->|modalita opzionale| D[Chrome Relay: tab autorizzata]
    C --> E[CDP Session Multiplexer]
    D --> E
    E -->|frame binari e stato| F[BrowserViewer Studio]
    F -->|input e takeover| B
    E -->|DOM console rete| G[Inspector mirato]
    B -->|risultato sintetico| H[Transcript tool browser]
```

### 6.1 Responsabilita del runtime OMP

- lifecycle Chromium e target CDP — **S39**;
- profili persistenti per progetto — **S39**;
- ownership delle tab per chat — **S39**;
- serializzazione e cancellazione delle azioni;
- control epochs;
- stream con backpressure;
- gating del takeover privato;
- policy delle origini lato agente;
- popup, dialoghi, download e upload;
- connessione a una tab Chrome Relay autorizzata;
- sanitizzazione dei dati prima di renderli disponibili all'agente.

### 6.2 Responsabilita di Studio

- apertura automatica della superficie Browser;
- rendering dei frame;
- mapping input pannello → pixel CSS viewport;
- toolbar, viewport e tab;
- stato agente/utente/privato;
- richieste di consenso per origini remote;
- inspector e selezione elementi;
- visualizzazione console, rete, azioni e download;
- canale privato locale che non alimenta transcript o modello.

## 7. Modello di dominio

Identificatori obbligatori:

```typescript
interface BrowserSessionIdentity {
  projectId: string;
  chatSessionId: string;
  browserSessionId: string;
  tabId: string;
}

type BrowserMode = "managed" | "chrome-relay";
type BrowserController = "agent" | "user" | "private-user";
```

Stato minimo della tab:

```typescript
interface BrowserTabState extends BrowserSessionIdentity {
  mode: BrowserMode;
  controller: BrowserController;
  controlEpoch: number;
  url: string;
  title: string;
  loading: boolean;
  originPermission: "local" | "granted" | "pending" | "denied";
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  streamState: "detached" | "connecting" | "live" | "private" | "failed";
}
```

I nomi sono stati confermati in S38 e implementati identici nei due repository
(`src/lib/agent/browser-live.ts` in Studio,
`packages/coding-agent/src/modes/rpc/browser-live.ts` nel runtime), con
l'aggiunta di `BrowserOriginPermission`, `BrowserViewport` e dei parser severi
`parseBrowserSessionIdentity` e `parseBrowserTabState`: un valore fuori
dall'enum fa scartare il frame invece di degradare a un default. Gli
scostamenti sono elencati nella sezione 18.

## 8. Protocollo live

### 8.1 Handshake — implementato in S38

L'handshake estende quello gia esistente (`ready` → `negotiate_protocol`) senza
sostituirlo. Il frame `ready` guadagna un campo **opzionale** `capabilities`:

```json
{
  "type": "ready",
  "protocolVersion": 1,
  "supportedProtocolVersions": [1, 2],
  "maxFrameBytes": 1048576,
  "maxReassembledFrameBytes": 67108864,
  "capabilities": [
    {
      "name": "browser-live",
      "version": 1,
      "transports": ["local-websocket"],
      "features": ["binary-frames", "control-epochs", "private-takeover", "inspector", "chrome-relay"]
    }
  ]
}
```

Il runtime annuncia `browser-live` **soltanto** quando un provider e registrato
(`registerBrowserLiveProvider`) **e** quel provider dichiara almeno un
trasporto utilizzabile.

Dopo S39 il provider esiste: `runRpcMode` registra il `BrowserSessionBroker`
prima di emettere `ready`, e lo deregistra allo spegnimento. Ma
`BrowserSessionBroker.transports` e vuoto finche non esiste un endpoint live —
cioe finche S40 non implementa il canale loopback — quindi
`browserLiveCapability()` resta `null`, il campo `capabilities` resta assente e
il frame `ready` e ancora byte-per-byte quello che i client precedenti
leggono. Studio non manda `negotiate_capabilities`, non chiede ticket e resta
sul renderer screenshot. Il fallback non-live non e una modalita degradata: e
lo stato corrente e osservato del sistema.

Con un provider che dichiara il trasporto (iniettato nei test, reale in S40) la
capability annunciata e
`{ name: "browser-live", version: 1, transports: ["local-websocket"], features: [] }`:
nessuna delle cinque feature e implementata da S39, e un'intersezione di
feature vuota resta una capability valida.

`browser_live_ticket` di conseguenza fallisce oggi con
`BROWSER_LIVE_NOT_NEGOTIATED` (nessuna negoziazione possibile). Con capability
negoziata e nessun endpoint live il broker risponde
`BROWSER_LIVE_UNAVAILABLE`; per un'identita che non corrisponde a nessuna
sessione gestita `SESSION_NOT_FOUND`, e per una sessione nota con una tab
ignota `TAB_NOT_FOUND`.

Gli eventi `browser_live_tab_state` e `browser_live_closed` sono cablati dal
broker al canale RPC in `runRpcMode`, ma vengono emessi solo verso un host che
ha negoziato `browser-live`: senza negoziazione l'evento viene scartato alla
sorgente, non inviato e ignorato.

Studio, sul frame `ready`, calcola l'intersezione in locale e manda
`negotiate_capabilities` solo se qualcosa e realmente negoziabile:

```json
{ "id": "s3", "type": "negotiate_capabilities", "capabilities": [ /* offerta di Studio */ ] }
```

La risposta e autorevole:

```json
{ "id": "s3", "type": "response", "command": "negotiate_capabilities", "success": true,
  "data": { "accepted": [ /* intersezione */ ] } }
```

Regole dell'intersezione, identiche riga per riga nei due repository:

- nome e versione devono coincidere esattamente;
- almeno un trasporto deve essere condiviso, altrimenti la capability e
  scartata (transports mancanti = inutilizzabile);
- le feature sono l'intersezione, e un'intersezione vuota resta valida;
- l'ordine del risultato e quello dell'offerente, mai quello del richiedente;
- nomi ignoti, versioni diverse e voci malformate cadono in silenzio.

Il ticket monouso non viaggia in un evento: Studio lo chiede esplicitamente con
`browser_live_ticket`, che senza negoziazione fallisce con
`BROWSER_LIVE_NOT_NEGOTIATED` e, negoziato ma senza provider, con
`BROWSER_LIVE_UNAVAILABLE`.

```typescript
interface BrowserLiveTicket {
  ticketId: string;
  token: string;          // segreto monouso, mai in log, transcript o artifact
  endpoint: string;       // ws:// su 127.0.0.1, localhost o [::1]
  transport: "local-websocket";
  identity: BrowserSessionIdentity;
  runtimePid: number;
  issuedAtMs: number;
  expiresAtMs: number;    // TTL 30 s
}
```

Il ticket e a **presentazione singola**: il primo tentativo di riscatto consuma
il token qualunque sia l'esito, quindi un token trapelato non e riproducibile
ne utilizzabile per sondare identita. Gli esiti sono `TICKET_INVALID`,
`TICKET_EXPIRED`, `TICKET_ALREADY_REDEEMED`, `TICKET_IDENTITY_MISMATCH`.
Endpoint non loopback vengono rifiutati sia all'emissione sia prima della
connessione (`ENDPOINT_NOT_LOOPBACK`). Il server non ascolta su interfacce di
rete esterne.

Studio non inventa mai `projectId`: l'identita e quella ricevuta dal runtime
con `browser_live_tab_state`, e viene rispedita invariata nella richiesta di
ticket.

### 8.2 Separazione dei canali

- RPC OMP: start/update/end del tool, errori, risultato persistibile e fallback.
- Canale live: frame binari, stato effimero, input, takeover e inspector.
- Canale privato: stesso trasporto locale autenticato, ma subscriber agente, transcript e recorder sono disabilitati dal broker.

Non inserire frame base64 ad alta frequenza nel JSON RPC.

Lifecycle definito in S38 e trasportato dal canale RPC (nessun frame binario,
nessun segreto):

```typescript
type BrowserLiveEventType = "browser_live_tab_state" | "browser_live_closed";
type BrowserLiveCloseReason = "closed" | "session-ended" | "runtime-shutdown" | "revoked" | "failed";
```

`browser_live_tab_state` porta un `BrowserTabState` completo;
`browser_live_closed` porta identita e motivo. Studio scarta entrambi finche
`browser-live` non e negoziato: e il fail-closed, non una svista.

### 8.3 Frame e wire format binario — implementato in S40

I frame video ad alta frequenza viaggiano esclusivamente sul canale loopback
WebSocket autenticato, mai sul canale RPC o nel transcript dei messaggi.

Ogni frame e trasmesso come messaggio binario WebSocket secondo il formato **BLF1**
(*Browser Live Frame v1*):

```text
+-------------------+--------------------+------------------------+-----------------------+
| Magic (4 byte)    | MetaLen (4 byte)   | JSON Metadata (MetaLen)| Binary Image Payload  |
| "BLF1" (ASCII)    | uint32 big-endian  | UTF-8 BrowserFrameMeta | raw JPEG / PNG bytes  |
+-------------------+--------------------+------------------------+-----------------------+
 0                 4                    8                        8+MetaLen               Total
```

1. **Magic:** `[0x42, 0x4c, 0x46, 0x31]` (`"BLF1"` ASCII). Pacchetti con magic diverso
   o troncati sotto gli 8 byte vengono scartati all'istante senza deallocazioni.
2. **MetaLen:** lunghezza in byte del payload JSON dei metadati, codificata come intero
   a 32 bit unsigned big-endian.
3. **JSON Metadata:** serializzazione JSON UTF-8 conforme a `BrowserFrameMeta`:

```typescript
interface BrowserFrameMeta {
  sequence: number;
  browserSessionId: string;
  tabId: string;
  timestampMs: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  scrollX: number;
  scrollY: number;
  controlEpoch: number;
  privacy: "normal" | "private";
  mimeType: "image/jpeg" | "image/png";
}
```

4. **Binary Image Payload:** byte grezzi dell'immagine (JPEG qualità 80 generata da
   `Page.startScreencast` CDP). Zero overhead base64 (33% di banda risparmiata) e zero
   allocazioni di stringhe nel parsing.

#### Messaggi di controllo sul WebSocket (frame di testo JSON)

- **Client -> Server (Riscatto ticket):**
  `{"type": "redeem", "token": string, "identity": BrowserSessionIdentity}`
- **Server -> Client (Conferma riscatto):**
  `{"type": "redeemed", "identity": BrowserSessionIdentity, "state": BrowserTabState}`
- **Client -> Server (Ack ricezione frame):**
  `{"type": "ack", "sequence": number}`
- **Server -> Client (Aggiornamento stato tab):**
  `{"type": "tab_state", "state": BrowserTabState}`
- **Server -> Client (Chiusura tab):**
  `{"type": "closed", "identity": BrowserSessionIdentity, "reason": BrowserLiveCloseReason}`
- **Server -> Client (Errore autenticazione/stream):**
  `{"type": "error", "code": BrowserLiveErrorCode, "message": string}`

#### Backpressure e buffering limitato (Newest-Frame-Wins)

1. **Coda limitata:** il server mantiene al piu **un solo** frame in attesa per
   ciascun client connesso (`pendingFrame`). La memoria per client e rigorosamente
   $O(1)$ (~30-80 KB) e non cresce mai in modo illimitato.
2. **Newest-Frame-Wins:** se un nuovo frame arriva mentre il client ha ancora un frame
   in volo non confermato, il nuovo frame sovrascrive `pendingFrame` e il contatore
   dei frame scartati (`droppedFrames`) viene incrementato. I frame obsoleti non
   vengono mai inviati.
3. **Ripresa all'ack:** quando il client invia `{"type": "ack", "sequence": N}`, il
   canale sblocca la trasmissione e invia immediatamente il frame piu fresco
   presente in `pendingFrame`.
4. **Backpressure hardware su CDP:** il server invia `Page.screencastFrameAck` a
   Chromium per mantenere fluido il compositing su pagine dinamiche. Se tuttavia un
   client congelato o bloccato accumula piu di 10 frame scartati senza inviare ack,
   l'ack verso CDP viene sospeso: Chromium interrompe la generazione di screencast frame,
   azzerando il consumo di CPU e memoria fino allo sblocco del client.
5. **Screenshot del tool indipendenti:** `tab.screenshot()` continua ad acquisire
   direttamente da Chromium (`page.screenshot()`) alle dimensioni reali del viewport
   dichiarato (es. 1280x800), del tutto indipendenti dalla risoluzione video dello
   screencast o dal canvas ridimensionato di Studio.
### 8.4 Fallback non negoziato — verificato in S38

Quando `browser-live` non e negoziato — runtime precedente, Studio precedente,
versione o trasporto non condivisi — nulla cambia rispetto a oggi:

- il tool resta `browser` e il suo ciclo di vita resta
  `tool_execution_start` / `tool_execution_update` / `tool_execution_end`;
- `src/lib/agent/tools/renderers/Browser.svelte` continua a disegnare
  `result.details.screenshots` e i blocchi immagine del risultato;
- Studio non manda `negotiate_capabilities`, non chiede ticket e non apre
  nessun endpoint.

### 8.5 Codici di errore

`BROWSER_LIVE_UNAVAILABLE`, `BROWSER_LIVE_NOT_NEGOTIATED`, `TICKET_INVALID`,
`TICKET_EXPIRED`, `TICKET_ALREADY_REDEEMED`, `TICKET_IDENTITY_MISMATCH`,
`ENDPOINT_NOT_LOOPBACK`, `SESSION_NOT_FOUND`, `TAB_NOT_FOUND`,
`CONTROL_INTERRUPTED`, `PRIVATE_TAKEOVER_ACTIVE`, `ORIGIN_NOT_ALLOWED`.

L'elenco e pinnato nella fixture condivisa: aggiungere un codice senza
aggiornarla fa fallire i test dei due repository.

## 9. Profili, processi e tab — implementato in S39

### 9.1 Identita

`projectId` non viene mai inventato da Studio: e `hashPath(cwd)` del runtime,
cioe il digest esadecimale a 7 caratteri della directory di progetto
canonicalizzata, lo stesso helper usato per i worktree sotto `~/.omp/wt/`. Da
esso derivano gli altri identificatori:

```text
projectId        = hashPath(cwd)                     es. "1f3a9c0"
browserSessionId = `managed-${projectId}`            es. "managed-1f3a9c0"
tabId            = `${chatSessionId}::${tabName}`    es. "01K7Q...::main"
```

Le funzioni sono `managedProjectId`, `managedBrowserSessionId` e
`managedTabId` in `session-broker.ts`; `BrowserSessionBroker.identityFor()`
compone l'identita completa. Un acquirente che non si identifica (embedding
SDK, test) usa `chatSessionId = "anonymous"`: non riceve un'identita finta,
riceve una identita dichiaratamente anonima.

### 9.2 Profilo persistente

Profilo persistente fuori dal repository, **posseduto dal runtime** e non da
Studio:

```text
~/.omp/browser-profiles/<projectId>/
```

Su Windows con i default XDG del runtime la radice e
`%USERPROFILE%\.omp\browser-profiles`; l'override `OMP_BROWSER_PROFILES_ROOT`
la rialloca (usato dallo smoke e disponibile agli operatori). Il nome della
directory *e* il `projectId`, cosi la cancellazione dei dati di un progetto e
un solo `rm -rf` di un percorso che nessun altro condivide.

Persistono per progetto (verificato: scenari 2 e 4 dello smoke):

- cookie;
- localStorage;
- IndexedDB;
- service worker;
- permessi approvati.

Non persistono come stato globale:

- control epoch;
- controller;
- registrazioni;
- ownership agente;
- tab di chat chiuse.

### 9.3 Lifecycle effettivo

1. `browser open` risolve il kind: senza `app.*`, senza relay, senza
   `browser.cdpUrl` e senza cmux, con `browser.headless = true` (default) il
   kind e `{ kind: "managed", projectId }`. `browser.headless = false`
   (`/browser visible`) resta l'unica via a una finestra desktop, e usa il kind
   `headless` preesistente.
2. `openManagedHandle` chiede l'endpoint a `BrowserSessionBroker.ensureEndpoint()`.
   Nessun altro punto del codice deriva un endpoint gestito.
3. Il broker chiama `ensureManagedBrowser({ projectDir, profileDir })`, che
   avvia **lazy** il daemon `omp.browser.managed` sotto il broker di progetto
   (`persist: false`, `detached: false`), con argv `--headless=new`,
   `--no-startup-window`, `--remote-debugging-port=0` e
   `--user-data-dir=<profilo del progetto>`.
4. La tab viene aperta dal tab supervisor con chiave `tabId`; il nome
   ergonomico (`main`) resta in `TabSession.name` ed e quello che l'agente vede
   in `tab.name` e nei messaggi d'errore.
5. Alla creazione il broker pubblica un `BrowserTabState`
   (`mode: "managed"`, `controller: "agent"`, `controlEpoch: 0`,
   `originPermission: "local"`, `streamState: "detached"`); `run` che naviga
   aggiorna URL e titolo.
6. Chiusura: `releaseTab`, force-kill e reap di sessione invocano l'hook
   `onClosed` della tab, che rimuove il record dal broker e revoca i ticket
   della sessione quando non resta piu nessuna tab.
7. Terminazione del processo Chromium: la possiede il broker di progetto, che
   ferma il daemon quando l'ultimo client omp del progetto esce. Non esiste un
   percorso in cui Chromium sopravviva a omp (verificato: scenari 5 e 6).

Il password manager del browser gestito resta disabilitato
(`--password-store=basic` dai default puppeteer, nessun profilo utente reale).

### 9.4 Cancellazione esplicita dei dati

`BrowserSessionBroker.deleteProjectData(cwd)` revoca i ticket della sessione e
rimuove la directory di profilo del solo progetto indicato. Rifiuta finche il
progetto ha tab gestite aperte — cancellare un profilo sotto un Chromium vivo
lascerebbe una directory mezza rimossa su cui il browser continua a scrivere —
e in quel caso restituisce `{ deleted: false, openTabs }`.

Entry point utente lato runtime: `/browser clear-data`. Studio esporra il
proprio comando sulla stessa API negli step UI (S41+).

### 9.5 Fallback senza broker

Un host che non puo avviare il broker (`bun test`, embedding SDK senza entry
CLI) ottiene un Chromium locale al processo con profilo temporaneo, non il
profilo persistente: due Chromium non possono condividere il lock di una
`--user-data-dir`, e il profilo di progetto appartiene al daemon. Il
comportamento e identico a quello che il kind `headless` aveva prima di S39.

## 10. Control epochs

Ogni azione agente acquisisce l'epoch corrente e lo verifica prima e dopo ogni comando significativo. Le chiamate CDP passano dal broker; un client Puppeteer non deve avere un percorso alternativo che aggiri il controllo.

Primo input umano:

```text
request_takeover(expectedEpoch, bufferedInput)
```

Transizione atomica:

1. verificare `expectedEpoch`;
2. incrementare l'epoch;
3. bloccare nuovi comandi agente;
4. cancellare o chiudere in sicurezza il comando attivo;
5. restituire `CONTROL_INTERRUPTED` all'agente;
6. inoltrare una sola volta l'input umano bufferizzato;
7. impostare controller `user`.

Il pannello deve mostrare sempre chi controlla la tab. Il ritorno all'agente richiede un comando esplicito e produce un nuovo snapshot semantico prima della ripresa.

Stato dopo S39: il `controlEpoch` esiste nello stato tab ed e sempre `0`, il
`controller` e sempre `agent`; l'arbitraggio e S42. Cio che S39 ha reso vero e
la premessa: l'endpoint CDP del motore gestito nasce in un unico punto
(`BrowserSessionBroker.ensureEndpoint`), non compare in nessun frame RPC, in
nessun risultato di tool e in nessun ticket, e le tab sono raggiungibili solo
tramite la chiave che il broker assegna. Non esiste una via per cui il client
ottenga un endpoint Puppeteer con cui aggirare il broker.

## 11. Takeover privato

Attivazione:

- focus su campo password;
- CAPTCHA riconosciuto;
- richiesta login/credenziali del tool;
- pulsante manuale.

Durante il takeover privato:

- il BrowserViewer continua a ricevere frame su canale locale;
- l'agente non riceve frame, DOM, accessibility tree, console, rete o screenshot;
- nessuna immagine entra nel transcript;
- registrazione e buffer diagnostici vengono sospesi e ripuliti;
- il tool vede soltanto `PRIVATE_TAKEOVER_ACTIVE`;
- la riattivazione e manuale.

La modalita privata non deve rendere cieco l'utente e non deve affidarsi solo a mascherare i tasti.

## 12. Origini e sicurezza

La policy governa la navigazione top-level dell'agente, non blocca indiscriminatamente CDN e risorse secondarie necessarie all'applicazione.

- `http://localhost:*` e `http://127.0.0.1:*`: consentiti automaticamente;
- origini remote: consenso una tantum per progetto;
- redirect top-level verso origine non autorizzata: sospensione prima di proseguire;
- grant revocabili dalle impostazioni del progetto;
- header `Authorization`, cookie, token e valori sensibili sempre redatti;
- body di rete disponibile solo su richiesta e con limiti di dimensione;
- URL, titoli e testo pagina sono input non attendibili e non vanno promossi a istruzioni di sistema.

Il frontend Svelte non riceve segreti del broker ne un endpoint CDP utilizzabile liberamente. Ticket e capability falliscono chiusi alla disconnessione.

## 13. BrowserViewer — implementato in S41

La colonna centrale espone superfici distinte `Browser` (`src/lib/components/BrowserViewer.svelte`), `Preview` (`PreviewViewer.svelte`) ed `Editor` (`Editor.svelte`). `browser open` o l'arrivo di una tab gestita in sessione seleziona automaticamente la superficie `Browser` senza distruggere né alterare lo stato dei modelli Monaco, dei file aperti o delle anteprime statiche.

### 13.1 Toolbar Browser Studio

La toolbar è integrata in alto e riutilizza strettamente i token di design globali (`--bg-raised`, `--line`, `--ink`, `--radius-sm`):

- **Navigazione:** pulsanti `Indietro` (`IconArrowLeft`), `Avanti` (`IconArrowRight`), `Ricarica` (`IconRefresh` con spinner durante il caricamento);
- **URL Bar:** visualizzazione URL della tab attiva con icona di sicurezza (`IconLock` per locale/HTTPS o `IconGlobe` per HTTP) e indicatore pulsante di caricamento;
- **Selettore Schede (Tab):** visualizzazione badge con nome sintetico (es. `main`) o selettore a pulsanti pill quando sono presenti più tab simultanee della chat;
- **Modalità:** indicatore esplicito `Browser Studio` (motore gestito locale) o `Chrome Relay` (tab autorizzata);
- **Viewport Responsive:** selettore integrato `Desktop` (100%), `Tablet` (768px), `Mobile` (390px) per collaudo rapido del layout; badge device scale factor (es. `@1x`, `@2x`);
- **Stato Controller:** badge semantico dello stato corrente (`Agente` in accento brand, `Utente` in avviso ambra, `Privato` in magenta);
- **Azioni rapide e Cattura:** pulsante `Cattura` (`IconCamera`) per copiare istantaneamente negli appunti lo screenshot a risoluzione reale del frame attivo;
- **Chiusura:** pulsante `Chiudi (Esc)` (`IconClose`) per ritornare immediatamente all'Editor senza perdita di stato.

### 13.2 Rendering Live e Mapping Coordinate CSS

La superficie visualizza i frame binari JPEG decodificati dallo stream loopback WebSocket (`BLF1`) a 60 fps con backpressure.

Il mapping delle interazioni (mouse down/move/up, click, double click, wheel, drag) traduce le coordinate client DOM in **pixel CSS esatti del viewport Chromium** usando i metadati del frame confermato:

```typescript
export function mapClientToViewportCoords(
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
    meta: { viewportWidth: number; viewportHeight: number }
): { x: number; y: number } | null {
    if (rect.width <= 0 || rect.height <= 0 || meta.viewportWidth <= 0 || meta.viewportHeight <= 0) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    return {
        x: Math.round(Math.max(0, Math.min(meta.viewportWidth, relX * meta.viewportWidth)) * 100) / 100,
        y: Math.round(Math.max(0, Math.min(meta.viewportHeight, relY * meta.viewportHeight)) * 100) / 100
    };
}
```

Questa proiezione è matematicamente invariante rispetto a:
1. Ridimensionamento della finestra Studio o delle colonne laterali;
2. Zoom dell'interfaccia e DPI scaling del display (100%, 125%, 150%, 200%);
3. Preset responsive di viewport (Desktop/Tablet/Mobile);
4. Scorrimento del contenitore centrale.

I delta di scroll della rotellina vengono normalizzati tramite `mapWheelToViewportScroll` supportando modalità a pixel, linee (16px) e pagine (400px).
## 14. Inspector mirato

### Element picker

Produce contesto strutturato:

```text
tag, role, accessibleName, text, selector, boundingBox,
computedStyles rilevanti, componente React se disponibile,
screenshot ritagliato
```

Il contesto puo essere allegato al prompt senza ricopia manuale.

### Console

- ring buffer limitato;
- errori e warning deduplicati;
- stack trace;
- valori sensibili redatti;
- invio selettivo al prompt.

### Network

- URL, metodo, stato, durata e tipo risorsa;
- body solo su richiesta;
- header sensibili redatti;
- filtri per errori e richieste lente;
- invio selettivo al prompt.

### Actions

Timeline condivisa di navigazioni, azioni agente, takeover, privacy, dialoghi, download e cambio tab.

## 15. Dialoghi, popup e file

- `alert`, `confirm`, `prompt`, `beforeunload`: evento esplicito e risposta tracciata;
- popup: nuova tab della stessa chat;
- download: artifact associato alla chat, con conferma per origine remota;
- upload: file scelto dall'utente o gia autorizzato, senza accesso libero al filesystem;
- clipboard, geolocalizzazione e notifiche: capability e permessi distinti;
- recording: artifact video locale con stato e percorso espliciti.

## 16. Chrome personale tramite Relay

Flusso vincolante:

1. l'utente sceglie `Usa il mio Chrome`;
2. Studio mostra le tab collegabili tramite l'estensione Relay;
3. l'utente autorizza una tab specifica;
4. il Relay emette un ticket monouso legato a progetto, chat e target;
5. Studio mostra la stessa tab tramite stream;
6. control epochs e takeover privato restano attivi;
7. `Disconnetti` revoca immediatamente il target.

Non copiare il profilo, non aprire il database cookie e non concedere accesso implicito alle altre tab. La tab originale puo restare visibile o in background nel Chrome dell'utente, ma Studio non apre una nuova finestra esterna.

## 17. Compatibilita e verifica end-to-end

La feature e completa solo quando sono osservati almeno questi scenari:

1. managed mode non apre finestre browser desktop;
2. `browser open/run/close` controlla la stessa tab mostrata in Studio;
3. resize e DPI scaling non spostano i click;
4. il primo input umano interrompe l'azione agente e viene applicato una volta sola;
5. durante takeover privato l'utente vede la pagina ma transcript e modello non ricevono dati;
6. profili di due progetti non condividono cookie o storage;
7. tab omonime di due chat non collidono;
8. redirect remoto non autorizzato sospende l'agente;
9. dialoghi, popup, download e upload hanno stati espliciti;
10. Console, Network e picker derivano dalla stessa tab e dallo stesso viewport;
11. Chrome Relay controlla soltanto la tab autorizzata;
12. runtime/Studio senza `browser-live-v1` mantengono il renderer screenshot attuale;
13. crash o chiusura Studio revocano ticket e non lasciano processi orfani;
14. smoke reale su Windows e almeno una verifica sulle altre piattaforme supportate.

Stato per S38 (contratto). Lo scenario 12 e osservato, non solo dedotto:

- `omp.exe` installato (runtime precedente) emette
  `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}`,
  senza `capabilities`: Studio non manda `negotiate_capabilities` e resta sul
  renderer screenshot;
- il runtime compilato dal branch S38 (`bun src/cli.ts --mode rpc-ui`) emette lo
  stesso frame byte per byte, risponde a `negotiate_capabilities` con
  `{"accepted":[]}` e rifiuta `browser_live_ticket` con
  `BROWSER_LIVE_NOT_NEGOTIATED`, perche nessun provider e registrato prima di
  S39;
- test di contratto verdi nei due repository: 267 test in Studio
  (`test/browser-live-contract.test.ts`, incluso il confronto byte a byte della
  fixture con il checkout runtime) e 38 test nel runtime
  (`packages/coding-agent/test/browser-live-contract.test.ts`), piu `tsgo
  --noEmit` e `biome check` sui file toccati;
- suite RPC preesistenti del runtime rieseguite: unico fallimento e il test
  Fireworks dipendente dalla rete, che fallisce identico anche sul commit base
  `311b390`.

La combinazione "runtime nuovo con provider registrato + Studio nuovo" e
coperta dai test con provider iniettato: diventa osservabile end-to-end con
S40, quando il trasporto live esiste.

Stato per S39 (broker e Chromium gestito). Osservati con smoke reale su
Windows 11, `bun packages/coding-agent/scripts/s39-managed-browser-smoke.ts`,
6/6 scenari:

| Scenario | Esito osservato |
|---|---|
| 1 — nessuna finestra desktop | daemon `omp.browser.managed` avviato, albero di processi del suo pid ispezionato via `Get-Process`/`Win32_Process`: nessuna finestra top-level (`MainWindowHandle != 0`) |
| 6 — isolamento profili | progetto A scrive `s39=project-a` + `localStorage` su `http://127.0.0.1:<porta>/`; il progetto B, sulla **stessa** origine, legge `{"cookie":"","stored":null}` |
| 7 — tab omonime | `chat-a::main` e `chat-b::main` sono due tab distinte nello stesso browser gestito, con titoli indipendenti |
| riapertura | dopo `releaseAllTabs`, il progetto A ritrova cookie e `localStorage`, il progetto B resta vuoto |
| 13 (parziale) — chiusura senza orfani | `releaseAllTabs` azzera il registro del broker; lo stop del daemon fa uscire il pid Chromium |
| 13 (parziale) — crash senza orfani | un host figlio apre una tab gestita e viene ucciso con `SIGKILL` senza teardown: il Chromium del suo progetto esce comunque, per teardown dell'ultimo client del broker |

Altre verifiche di S39:

- 19 test comportamentali nuovi
  (`packages/coding-agent/test/tools/browser-session-broker.test.ts`) e 38 test
  di contratto S38 ancora verdi;
- suite browser preesistenti del runtime: 78 test verdi su
  `browser-session-broker`, `browser-live-contract`, `browser-lifecycle-leak`,
  `browser-open-lease`, `browser-dispose-timeout`, `browser-profile-cleanup`,
  `browser-cmux-release-mid-run`;
- `browser-attach` e `browser-tab-worker-startup` hanno due fallimenti che si
  riproducono identici sul commit base `e0e1a9d` (avvio Chromium reale su
  questa macchina), quindi non sono regressioni di S39;
- suite `test/rpc`: 4 fallimenti sul branch contro 5 sul commit base — tutti
  preesistenti e dipendenti da rete/tempi;
- `tsgo --noEmit` e `biome check` verdi sui pacchetti toccati.

Stato per S40 (stream live binario e backpressure). Osservati con smoke reale su
Windows 11, `bun packages/coding-agent/scripts/s40-live-stream-smoke.ts`,
5/5 scenari:

| Scenario | Esito osservato |
|---|---|
| 1 — stream live su pagina dinamica | ricezione continua di frame binari con header BLF1, sequenza monotona crescente, metadati viewport 1280x800 e payload JPEG reale da Chromium gestito |
| 2 — backpressure e newest-frame-wins | client lento che trattiene l'ack; scarto deterministico di 11 frame intermedi obsoleti; all'ack il client riceve il frame più recente senza backlog |
| 3 — reconnect deterministico | chiusura WebSocket e riconnessione con ticket fresco; ripresa istantanea dello stream live sulla stessa tab senza perdite di stato |
| 4 — screenshot tool a risoluzione reale | `page.screenshot()` mantiene il viewport reale dichiarato (1280x800), non influenzato da canvas o stream |
| 5 — fallback screenshot non negoziato | `issueTicket` risponde `BROWSER_LIVE_UNAVAILABLE` quando il live server non e avviato; gli screenshot del tool continuano a funzionare regolarmente |

Altre verifiche di S40:

- 10 nuovi test di streaming, backpressure e autenticazione loopback
  (`packages/coding-agent/test/tools/browser-live-stream.test.ts`), 19 test del broker e
  38 test di contratto S38 verdi (totale 67 test browser nel runtime upstream);
- 272 test smoke e di contratto verdi in Studio (`npm test`);
- 136 unit test Rust verdi in `src-tauri` (`cargo test`);
- `tsgo --noEmit` e `biome check` verdi nel runtime upstream;
- `npm run check` (904 file controllati, 0 errori, 0 warning) e `cargo check` verdi in Studio;
- Modulo backend Studio `src-tauri/src/browser_live.rs` con connessione loopback WebSocket,
  parsing BLF1, invio automatico ack e inoltro a Svelte via IPC `Channel`.

### ContrattiImmobili

Per componenti serviti localmente, Browser Studio naviga verso il server di sviluppo. Per l'app completa, le regole del progetto restano vincolanti: l'agente non pubblica o avvia autonomamente IIS. L'utente rende disponibile l'URL; Browser Studio lo verifica. Se Windows Authentication non funziona nel profilo gestito, si usa una tab Chrome personale autorizzata tramite Relay.

## 18. Registro implementativo

Ogni step aggiunge una voce senza riscrivere la storia:

| Data | Step | Repository/commit | Contratto effettivo | Scostamenti e decisioni |
|---|---|---|---|---|
| 2026-09-02 | Pianificazione | `omp-studio-app` | Gate R23 e task S38-S47 | Specifica iniziale; nessun codice implementato |
| 2026-09-03 | S38 | `oh-my-pi` (checkout `../oh-my-pi-upstream`, branch `feat/s38-browser-live-v1-contract`, commit `e0e1a9d` su base `311b390`) + `omp-studio-app` (working tree, non committato al momento della stesura) | `browser-live-v1`: `capabilities` opzionale nel frame `ready`, comandi `negotiate_capabilities` e `browser_live_ticket`, identita `projectId/chatSessionId/browserSessionId/tabId`, `BrowserTabState`, `BrowserFrameMeta`, eventi `browser_live_tab_state` e `browser_live_closed`, 12 codici di errore, ticket loopback monouso con TTL 30 s. Fixture condivisa `browser-live-v1.json` identica nei due repository. | Capability annunciata solo con provider registrato (nessuno in S38); ticket come risposta e non come evento; presentazione singola del token; checkout upstream spostato fuori da `ricerca/`; nessuna PR upstream (branch locale). Dettaglio in `DECISIONS.md`, voce "S38 — Scostamenti". |
| 2026-09-03 | S39 | `oh-my-pi` (checkout `../oh-my-pi-upstream`, branch `feat/s39-browser-session-broker`, commit `73c8181` su base `e0e1a9d`); `omp-studio-app`: solo documentazione | `BrowserSessionBroker` in `packages/coding-agent/src/tools/browser/session-broker.ts`. Nuovo `BrowserKind` `managed`, motore predefinito con `browser.headless = true`. Profilo persistente `~/.omp/browser-profiles/<projectId>` con `projectId = hashPath(cwd)`, override `OMP_BROWSER_PROFILES_ROOT`. Daemon `omp.browser.managed` avviato lazy (`--headless=new`, `--no-startup-window`, `--remote-debugging-port=0`, `persist:false`). Tab indirizzate da chiave opaca `chatSessionId::tabName` con nome ergonomico separato e hook `onClosed`. `deleteProjectData` + `/browser clear-data`. Provider `browser-live` registrato in `runRpcMode` con ponte eventi e teardown. | `transports` vuoto finche non esiste il canale live di S40: la capability resta non annunciata e il fallback screenshot e lo stato osservato, non una degradazione. Profili sotto `~/.omp` del runtime, non `%LOCALAPPDATA%/omp-studio`: li possiede e li cancella il runtime. `read-pdf` e il fallback browser di web search migrati al motore gestito. Host senza broker (bun test, SDK) restano su Chromium locale al processo con profilo temporaneo. `/browser visible` resta l'unica finestra desktop possibile. Dettaglio in `DECISIONS.md`, Gate R23 / S39. |
| 2026-09-03 | S40 | `oh-my-pi` (checkout `../oh-my-pi-upstream`, branch `feat/s40-browser-live-stream`, commit `e521201` su base `73c8181`); `omp-studio-app` (working tree) | Canale loopback WebSocket autenticato per live streaming; wire format binario `BLF1` (4B magic + 4B uint32 BE lunghezza + JSON `BrowserFrameMeta` + JPEG binary bytes); controllo text JSON per ticket redemption (`redeem`/`redeemed`), ack (`ack`), stati (`tab_state`) e chiusura (`closed`); buffering limitato $O(1)$ con politica newest-frame-wins; backpressure hardware su `Page.screencastFrameAck` con pausa oltre 10 frame scartati; modulo backend Studio Rust `browser_live` con gestione connessione e isolamento segreti; fallback screenshot preservato quando live non disponibile. | Fixture condivisa `browser-live-v1.json` aggiornata e verificata identica nei due repository. |
| 2026-09-03 | S41 | `omp-studio-app` (working tree) | Superficie BrowserViewer nella colonna centrale (`src/lib/components/BrowserViewer.svelte`), distinta da Preview/File e dal transcript; toolbar con URL/back/forward/reload/tab/mode/viewport/stato; apertura automatica all'arrivo di tab gestite senza distruggere lo stato Monaco/Preview; rendering frame BLF1 live e proiezione coordinate in pixel CSS con `mapClientToViewportCoords` e `mapWheelToViewportScroll`; preset responsive desktop/tablet/mobile; 284 test verdi e 0 errori/warning su svelte-check. | Nessuno scostamento dal piano; PreviewViewer preservato invariato e isolato; takeover/inspector non anticipati. |
Uno step non e concluso finche questa tabella, le sezioni tecniche interessate e `docs/PLAN.md` non riflettono il comportamento effettivo. Se il codice rende una parte della specifica non valida, aggiornare prima la decisione in `docs/DECISIONS.md`; non lasciare documentazione aspirazionale presentata come implementata.

## 19. Sequenza dei task

| Step | Ambito | Dipende da | Deliverable principale |
|---|---|---|---|
| S38 | Contratto `browser-live-v1` | Gate R23 | Schema versionato e fixture compatibilita |
| S39 | Runtime broker e Chromium gestito | S38 | Sessioni/profili/tab senza finestra |
| S40 | Stream live e backpressure | S39 | Frame binari e stato tab |
| S41 | BrowserViewer centrale | S40 | Superficie live e toolbar |
| S42 | Control epochs e takeover privato | S41 | Arbitraggio completo agente/utente |
| S43 | Origini, capability e redazione | S42 | Confini di sicurezza fail-closed |
| S44 | Inspector mirato | S43 | Picker, Console, Network, Actions |
| S45 | Dialoghi, popup, file e recording | S44 | Edge case browser espliciti |
| S46 | Chrome Relay su tab scelta | S45 | Sessione personale opzionale |
| S47 | Hardening e verifica multipiattaforma | S46 | Matrice E2E, recovery e docs finali |

Gli step sono strettamente sequenziali. Ogni task in `.omp/tasks.json` deve citare questo documento e aggiornare il registro implementativo prima di essere marcato completato.
