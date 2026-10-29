# Uso

_Come si usa, dal punto di vista di chi lo usa (non del codice)._

## Installare e aggiornare

- Si scarica l'installer dalle release GitHub: `.exe` per Windows (per utente, senza permessi di amministratore), `.dmg` per macOS, `.deb` o `.AppImage` per Linux [commit 74b7357].
- Studio cerca da solo gli aggiornamenti e li mostra nella barra in basso accanto alla versione; dal modale si legge il changelog e si installa [commit 80bbc96].
- Si può scegliere il canale: stabile, oppure Nightly, che riceve subito ogni build pubblicata mentre si lavora [commit ba3354f] [sessione 01a033e8].
- Al primo avvio, se `omp` manca, Studio guida l'installazione e ospita il wizard di `omp` senza riscriverlo [commit 3d18ace].

## Lavorare su più progetti

- Ogni progetto aperto è una tessera nella barra in alto, con il suo agente sempre vivo; `Ctrl+Alt+N` apre un progetto, `Ctrl+Tab` passa al successivo [commit b997871] [commit 27b699d].
- La tessera dice cosa fa l'agente: al lavoro, in attesa di una risposta, finito [commit 5b71ac3].
- A sinistra file, Git e pannello Agente (coda, storico sessioni, regole, Progetto); al centro editor, diff, browser, Laboratorio; a destra l'agente [commit b997871].

## Parlare con l'agente

- La colonna destra ha due superfici sulla stessa sessione: TERMINAL (la TUI di `omp` intatta) e GUI (chat grafica); si passa dall'una all'altra con `Ctrl+Alt+A` [commit a8e414f].
- Nella GUI ci sono comandi `/`, menzioni `@file`, immagini incollate, modalità Piano, domande a margine (`/btw`), `/loop` e obiettivo guidato [commit 57ef69b] [commit f2c482b] [commit 4278971].

## Coda dei task

- Ogni progetto ha una coda di prompt pronti: un task apre una sessione pulita e parte quando l'agente è libero, anche da solo o al reset della quota; `Ctrl+Alt+K` crea un task [commit 1d36d01] [commit 48a3044] [commit 5271d79].

## Corsie e Laboratorio

- Una corsia fa lavorare un secondo agente in un worktree separato senza toccare il tuo albero; si integra con un solo commit dal pulsante o chiedendolo all'agente [commit 550f804] [commit bafb871].
- Il Laboratorio crea prototipi React di interfaccia fuori dal repository, con anteprima dal vivo e revisioni recuperabili; `Ctrl+Alt+P` apre un prototipo libero [commit c5aff56].

## Companion e controllo remoto

- La Companion (`Ctrl+Alt+C`) è una finestra piccola che raccoglie domande e code di tutti i progetti e permette di rispondere o accodare senza aprire Studio [commit ffa8a34].
- Il controllo remoto, spento per default, permette di seguire e guidare Studio dal telefono tramite un relay ospitato da chi lo usa [commit 85f61c3].

## Quote, modelli e statistiche

- `Ctrl+Alt+U` apre le quote dei provider con il tempo al reset; `Ctrl+Alt+M` apre ruoli, modelli e provider di `omp`; «Impostazioni → Statistiche» mostra costi e uso delle sessioni [commit 80bbc96] [commit b28c593] [commit 7ffc4a7].
