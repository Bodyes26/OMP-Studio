# Relay di OMP Studio

[English](README.md)

Il relay permette di seguire e guidare le proprie macchine con OMP Studio dal telefono, da un browser o da un altro Studio senza aprire porte su di esse: ogni Studio si collega in uscita al relay, e lo stesso fanno i dispositivi. Il relay serve anche il quadro remoto, una PWA che si può aggiungere alla schermata Home del telefono.

Non esiste un relay condiviso o predefinito. Ognuno ospita il proprio, Studio ne chiede l'indirizzo, e lo usano solo le macchine e i dispositivi che abbini tu.

## Cosa fa il quadro

- Mostra ogni macchina abbinata, collegata o con l'ultimo stato noto: progetti, corsie, attività dell'agente, task in coda e programmati, quote.
- Risponde alle domande dell'agente.
- Avvia un task in coda dopo averti mostrato il prompt completo.
- Mette in attesa del reset della quota o archivia un blocco di quota.
- Apre le chat e invia prompt con gli stessi componenti della GUI per editor, ruoli, modelli, ragionamento e finestra di contesto.
- Allega file e immagini da selettore, appunti o trascinamento; i file sono caricati sulla macchina della corsia, non letti da percorsi locali del telefono.

Gli allegati generici possono arrivare a 50 MiB ciascuno e viaggiano in blocchi. Le immagini usano la stessa preparazione della GUI; testo e immagini restano entro il budget del comando RPC (700.000 caratteri complessivi prima dell'envelope). Se il limite viene superato o l'invio fallisce, il composer conserva la bozza. Le anteprime nella cronologia remota sono incluse solo negli aggiornamenti live piccoli; ricaricando lo storico resta il conteggio delle immagini.

## Requisiti

- Un server raggiungibile da Internet, con Docker e Docker Compose.
- Un nome DNS che punta al server.
- Un reverse proxy che termina il TLS e inoltra le WebSocket (Nginx Proxy Manager, Caddy, Traefik, nginx).

## Installazione

1. Sul server crea una cartella (per esempio `/opt/stacks/studio-relay`) e mettici `compose.example.yml` di questa cartella come `compose.yaml` e `.env.example` come `.env`.
2. Compila `.env`:
   - `RELAY_ADMIN_TOKEN`: un segreto casuale, per esempio `openssl rand -hex 32`. Tienilo per te: abbina il primo dispositivo e apre la pagina di diagnosi.
   - `PROXY_NETWORK`: la rete Docker del container del reverse proxy (`docker network ls`).
3. Avvialo con `docker compose up -d`. Scarica `ghcr.io/bodyes26/omp-studio-relay:latest`; i dati stanno nel volume `relay-data`. Il container non pubblica porte: il reverse proxy lo raggiunge come `studio-relay:8787` sulla rete condivisa.
4. Nel reverse proxy instrada il tuo nome DNS verso `http://studio-relay:8787`, con TLS e WebSocket:
   - **Nginx Proxy Manager:** schema `http`, forward hostname `studio-relay`, porta `8787`, *Websockets Support* attivo; nella scheda SSL un certificato per il nome e *Force SSL*.
   - **Caddy:**
     ```
     relay.example.com {
         reverse_proxy studio-relay:8787
     }
     ```
5. Verifica:
   - `https://relay.example.com/healthz` risponde con la versione del relay e la gamma di protocolli che accetta;
   - `https://relay.example.com/diag`: incolla il segreto di amministrazione e lascia la pagina aperta. La connessione deve restare su, con un battito del server ogni 25 secondi.

## Abbinamento

1. **Primo dispositivo.** Apri `https://relay.example.com` sul telefono, dai un nome al dispositivo, scegli *Usa il token di amministrazione* e incolla `RELAY_ADMIN_TOKEN`. Su iPhone, *Condividi > Aggiungi alla schermata Home* installa il quadro come un'app.
2. **Altri dispositivi.** Nel quadro, *Impostazioni > Aggiungi un dispositivo* mostra un codice valido 10 minuti; inseriscilo sul nuovo dispositivo.
3. **Macchine.** *Impostazioni > Abbina una macchina* mostra un codice. In Studio apri *Impostazioni > Controllo remoto*, inserisci l'indirizzo del relay, un nome per la macchina e il codice, poi *Abbina*. Ogni macchina porta il suo nome ovunque, così sai sempre dove gira cosa.

Hai perso un dispositivo o dismesso una macchina? Revocali da *Impostazioni*: le loro connessioni si chiudono subito.

## Notifiche Web Push

Il relay invia notifiche native Web Push (cifratura RFC 8291 aes128gcm, VAPID RFC 8292) ai dispositivi abbinati quando:
- Un agente fa una domanda o chiede conferma (`<macchina> · <progetto>: domanda`).
- Una corsia incontra un blocco di quota.
- Un agente in una corsia termina il turno di lavoro (passaggio a idle, con debounce anti-flapping).

Le notifiche push richiedono HTTPS.
- Su **Android / Chrome / Firefox / Safari desktop**, attiva le notifiche dalle *Impostazioni* del quadro.
- Su **iOS / iPadOS (16.4+)**, Apple richiede di installare la PWA sulla Schermata Home (*Condividi > Aggiungi alla schermata Home*) per poter abilitare il Web Push.
- La coppia di chiavi VAPID viene generata al primo avvio e memorizzata nel database SQLite (`data/relay.db`), sopravvivendo ai riavvii del container.
- I dispositivi con una finestra del quadro aperta e visibile in primo piano non ricevono notifiche push per evitare avvisi ridondanti.
- Gli endpoint delle sottoscrizioni vengono convalidati rispetto a un'allowlist dei servizi push ufficiali (`fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) sia alla registrazione sia all'invio, e le chiamate HTTP non seguono reindirizzamenti (`redirect: 'error'`) per prevenire attacchi SSRF.

## Aggiornamento

```sh
docker compose pull && docker compose up -d
```

Il pulsante di aggiornamento del tuo gestore di stack fa lo stesso. Immagini: `latest` e `X.Y.Z` seguono i rilasci stabili, `nightly` segue il ramo principale.

Le funzioni nuove si negoziano: un relay più vecchio nasconde soltanto i comandi che non conosce. Quando un rilascio cambia il protocollo, il relay continua ad accettare la versione precedente per almeno un rilascio stabile, così le macchine aggiornate in momenti diversi restano collegate. In Studio, *Impostazioni > Controllo remoto* mostra la versione del relay e, se le versioni non combaciano, dice se va aggiornato il relay o Studio.

Il relay non si aggiorna da solo: gli servirebbe il socket Docker, che sul server equivale ad accesso amministrativo.

## Costruire dai sorgenti

Clona l'intero repository: la build include i componenti condivisi di `src/lib` e compila i messaggi Paraglide. Con `compose.yaml` nella cartella `relay/`, commenta `image` e usa `build: { context: .., dockerfile: relay/Dockerfile }`, poi esegui `docker compose up -d --build`. Il contesto è relativo al file Compose, non alla cartella del terminale: se conservi Compose altrove, indica come `context` il percorso della radice del clone. Con `--build-arg RELAY_VERSION=<versione>` dai un'etichetta alla build.

## Note di sicurezza

- I codici di abbinamento hanno 8 caratteri, valgono una volta sola per 10 minuti, e i tentativi sono limitati. Un codice emesso da un dispositivo smette di valere quando quel dispositivo viene revocato.
- Le sessioni dei dispositivi sono cookie `HttpOnly` e `SameSite=Strict`; ogni modifica verifica l'origine della richiesta.
- La credenziale di una macchina serve solo a pubblicarne lo stato e a riceverne i comandi: non legge le altre macchine e non manda comandi.
- Cambiare `RELAY_ADMIN_TOKEN` (modifica `.env`, poi `docker compose up -d`) non toglie nessun abbinamento.
- Non c'è cifratura end-to-end: il relay vede lo stato dei progetti e le risposte che mandi. Ospitalo su un server di cui ti fidi.
- Un livello d'accesso davanti al relay, come Cloudflare Access, è facoltativo. Se lo aggiungi, lascia raggiungibile `/v1/host` per Studio, che si autentica con la propria credenziale.
- Dietro una CDN le WebSocket proxate funzionano: il battito ogni 25 secondi resta sotto i timeout d'inattività più comuni (100 secondi su Cloudflare).

## Configurazione

| Variabile | Predefinito | Significato |
|---|---|---|
| `RELAY_ADMIN_TOKEN` | obbligatoria, almeno 32 caratteri | Segreto del proprietario: primo abbinamento e diagnosi. |
| `RELAY_PORT` | `8787` | Porta dentro il container. |
| `RELAY_HOSTNAME` | `0.0.0.0` | Indirizzo d'ascolto dentro il container. |
| `RELAY_DATA_DIR` | `/data` nell'immagine, `./data` dai sorgenti | Cartella del database SQLite. |
| `RELAY_WEB_DIR` | la PWA inclusa nell'immagine | Cartella dei file del quadro. |
| `RELAY_VERSION` | fissata alla build dell'immagine, altrimenti `package.json` | Versione mostrata da `/healthz`, Studio e il quadro. |
| `PROXY_NETWORK` | richiesta da `compose.example.yml` | Rete Docker condivisa con il reverse proxy. |

## Sviluppo

```sh
bun install
bun test
bun run check && bun run check:web
bun run build:web
RELAY_ADMIN_TOKEN=$(openssl rand -hex 32) bun run start   # http://localhost:8787
bun run dev:web                                           # quadro con ricarica a caldo, inoltrato a :8787
```
