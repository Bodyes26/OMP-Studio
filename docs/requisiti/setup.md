# Setup di primo avvio — interfaccia grafica nativa

## Stato e fonti

Discussione del 2026-11-13, nata dopo un avvio in cui Studio ha aperto il setup perché il collegamento `~/.bun/bin/omp` puntava a una cartella cancellata dall'utente. Fonti:

- **Q1**, messaggio dell'utente del 2026-11-13: «possiamo ricreare completamente il setup in gui nativa, non solo provider e modelli [...] in footer un piccolo "preferisci la TUI?"», modale «che deve essere praticamente una finestra [...] come background [...] l'immagine nostra di hero del sito [...] noise di sottofondo e un'ombra», «comparsa animata [...] lunga, cioè epica», «setup per i provider fatto bene, mettendo i loghi dei provider più comuni e anche l'aiuto alla creazione dei ruoli», «la cartella progetti [...] ci sta che sia un passo del setup», «già che c'è un installer, avere due setup diversi, è una ripetizione».
- **Q2**, modulo `ask` del 2026-11-13, tutte le proposte consigliate accettate: Windows `uniform`, ritorno `same-window-jump`, passi `motore, provider, ruoli, aspetto, update, progetti, github, riepilogo`, ruoli `preset`, ingresso `long`, TUI `footer-link`.
- **Q3**, modulo `ask` del 2026-11-13, conferma delle rimozioni R1–R5 (tabella di cutover). Nota dell'utente su R2: «così comunque se uno vuole fare il passaggio alla tui ha già il font». Nota su R3: «poi quando finisce il setup ci sarà la schermata di studio vuota che dice "apri un progetto" e mostra il selettore con l'elenco dei progetti di quella cartella».

Questa scelta rivede il Gate R11 (`DECISIONS.md`, «il primo avvio ospita il wizard di `omp`, non lo riscrive»). Per tutti gli ID: stato **attivo**, **non implementato**, **non verificato**.

## Forma e ingresso

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| SET-001 | Q1; Q4 | Il setup è un'interfaccia grafica nativa di Studio che copre l'intera configurazione iniziale, non solo provider e modelli. Su una macchina nuova, con provider OAuth, l'utente arriva a Studio pronto senza vedere un terminale. Unica eccezione: il mini-terminale di login dei provider a chiave (SET-040). |
| SET-002 | Q1 | Forma: una finestra di setup in primo piano, con ombra, sopra uno sfondo che non è il semplice velo scuro sull'app. Lo sfondo usa l'immagine hero del sito (la rovina col pi) con grana e vignettatura. Al primo avvio non si vede l'interfaccia di Studio dietro. |
| SET-003 | Q1; Q2 `long` | Ingresso lungo e curato, circa 2,5–3 s: la rovina si compone dai caratteri ASCII, poi la finestra sale. Un clic o un tasto salta l'animazione. Con «riduci animazioni» (sistema o Studio) tutto compare subito, fermo. |
| SET-004 | Q1; Q2 `footer-link` | Nel piede c'è un link discreto «Preferisci la TUI?»: chiude il setup grafico e apre `omp setup` in un terminale dentro una finestra semplice. Chi sceglie la TUI completa il setup senza tornare alla GUI; Studio ne riconosce la fine dallo stato reale, come oggi. |

## Passi

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| SET-010 | Q2 `motore`; Q2 `uniform` | Passo **Motore**: Studio controlla omp, lo scarica se manca (impronta SHA-256 verificata, progresso visibile), lo ripara se l'installazione è rotta e lo aggiorna se è sotto la versione minima. Un collegamento che punta a un file inesistente è dichiarato «installazione di omp danneggiata», non «omp non installato». Il download può partire durante l'ingresso. |
| SET-011 | Q1; Q2 `provider` | Passo **Provider**: griglia con i loghi dei provider più comuni e una ricerca negli altri. I provider OAuth fanno il login nel browser, con lo stato in tempo reale («in attesa del browser», «collegato») e senza terminale; quelli a chiave seguono SET-040. Si possono collegare più provider; ne serve almeno uno per proseguire. |
| SET-012 | Q1; Q2 `ruoli`, `preset` | Passo **Modello e ruoli**: modello predefinito tra quelli dei provider collegati, più un preset di ruoli (predefinito, piano, veloce, commit, visione…) proposto in base ai provider, con una riga di spiegazione per ruolo. «Personalizza» apre l'editor completo dei ruoli. |
| SET-013 | Q2 `aspetto` | Passo **Aspetto**: tema per Studio e per omp, una sola scelta che vale per entrambi. |
| SET-014 | Q2 `update` | Passo **Aggiornamenti**: scelta fra aggiornamento automatico di omp e solo notifica (`update.auto`). |
| SET-015 | Q1; Q2 `progetti`; Q3 R3 | Passo **Progetti**: chiede solo la cartella predefinita dei progetti su questo computer, con le cartelle rilevate proposte e «Sfoglia…». Non apre progetti. |
| SET-016 | Q2 `github` | Passo **GitHub**, facoltativo e saltabile: collegamento a GitHub. |
| SET-017 | Q2 `riepilogo` | **Riepilogo** finale con quanto configurato e l'azione «Entra in Studio». |
| SET-018 | Q3, nota su R3 | Dopo il setup, se non c'è un progetto aperto, Studio mostra la sua schermata vuota «Apri un progetto» con il selettore che elenca i progetti della cartella scelta. |

## Ritorno e piattaforme

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| SET-020 | Q2 `same-window-jump` | Quando, dopo il primo setup, manca un pezzo bloccante (omp assente o rotto, nessun provider, nessun modello predefinito), si apre la stessa finestra senza l'ingresso lungo, direttamente sul passo che manca, con gli altri segnati come fatti. |
| SET-021 | Q2 `same-window-jump`; Q3 R4 | I problemi non bloccanti (omp sotto la versione minima, Git Bash mancante, database illeggibili) non aprono il setup da soli: vanno nel chip in barra e nelle notifiche. |
| SET-022 | Q1; Q2 `uniform` | Stesso setup su macOS, Linux e Windows. L'installer di Windows resta solo installazione di Studio: non scarica omp e non contiene passi di configurazione. |

## Vincoli derivati dalle rimozioni

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| SET-030 | Q3 R1 | Il setup grafico non chiede glifi (`symbolPreset`) né forma del composer (`composer.shape`): restano i valori di omp, scelti eventualmente dalla TUI. |
| SET-031 | Q3 R2 | Dopo il download di omp Studio installa ancora in silenzio il font Nerd per l'utente, così chi passa alla TUI o usa omp fuori da Studio ha già i glifi. |

## Login a chiave, chiusura, ruoli, controllo in build

Fonte **Q4**, modulo `ask` del 2026-11-13: API key `pty-only`, chiusura `confirm-inwindow`, ruoli «va bene così, deve ovviamente gestire i principali provider ovvero anthropic, chatgpt/codex, google, opencode, cursor ecc, cioè i principali provider di omp», controllo `strict`. Nel messaggio precedente l'utente: «nelle regole di quando si fa una build, release un check come abbiamo già anche per i nuovi comandi di OMP [...] se cambia il flow di setup iniziale di OMP, mi blocchi la build», «se chiudi l'applicazione, metti anche solo che fai Alt F4 deve potersi chiudere [...] il setup riprende poi da dove era stato interrotto», «non metterei [...] la versione specifica del modello».

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| SET-040 | Q4 `pty-only` | I provider che chiedono una chiave (OpenRouter, Groq, DeepSeek…) si collegano da un piccolo terminale dentro la loro tessera, che esegue `omp login <id>`. omp chiede la chiave nascosta e la salva; Studio rilegge lo stato alla chiusura. Nessuna modifica a omp, nessuna scrittura di Studio in `agent.db`. Ci si arriva solo scegliendo un provider a chiave: per gli OAuth (SET-011) niente terminale. |
| SET-041 | Q4 `confirm-inwindow` | «Esci dal setup» (Esc o pulsante) chiede conferma. Cmd+Q e Alt+F4 chiudono Studio subito, senza domande. Ogni passo salva quando viene confermato; Studio ricorda il passo raggiunto e, al riavvio, il setup riparte da lì. |
| SET-042 | Q4; messaggio dell'utente | Il preset dei ruoli è una tabella fissa di famiglie per provider (es. Anthropic: predefinito = Opus più recente, veloce = Haiku più recente), senza numeri di versione. Il modello preciso si sceglie al momento dal catalogo dal vivo di omp: la versione più alta della famiglia, escluse preview e versioni datate. Copre i principali provider di omp: Anthropic, ChatGPT/Codex, Google, OpenCode, Cursor e gli altri principali. Quando esce un modello nuovo il setup lo propone senza cambiare codice. |
| SET-043 | Q4 `strict`; messaggio dell'utente | `verify:nightly` e il rilascio confrontano i sorgenti del wizard di omp pubblicati in `@oh-my-pi/pi-tui` (`src/setup/**`: versione del setup, scene, chiavi scritte) con un'impronta registrata in Studio. Qualsiasi cambiamento blocca la build con la procedura da seguire, come per il catalogo dei comandi. Lo stesso controllo segnala una famiglia di SET-042 che non trova più nessun modello. |

## Cutover dal setup attuale

| Funzione attuale | Esito | Destinazione o motivo |
|---|---|---|
| Installazione di omp con impronta e progresso | mantenuta | SET-010 |
| Terminale con `omp setup` come passo centrale | spostata | SET-004 (Q3 R5) |
| Rilevamento della fine dallo stato reale | mantenuta | SET-004, SET-020 |
| Riapertura della sola scena provider (`/setup`) | sostituita | SET-011, SET-020 |
| Adozione del tema scelto nella TUI | sostituita | SET-013 |
| Glifi e forma del composer (dalla TUI) | rimossa dal setup grafico | Q3 R1, confermata 2026-11-13; restano nella TUI |
| Font Nerd silenzioso | mantenuta | SET-031 (Q3 R2) |
| Scelta della cartella dei progetti | mantenuta | SET-015 |
| Elenco «Apri subito un progetto» | rimossa | Q3 R3, confermata 2026-11-13; sostituita da SET-018 |
| Stato di GitHub in sola lettura | sostituita | SET-016 |
| Avvisi di database, Git Bash e omp vecchio nel setup | spostati | SET-021 (Q3 R4); aggiornamento di omp in SET-010 |

## Domande risolte

1. **Login senza sessione.** Processo omp dedicato in modalità RPC senza sessione (`OmpRpcClient.open('', null)`, `--no-session`), aperto dal passo Provider e chiuso quando il passo si smonta.
2. **Riconoscere le famiglie.** Il catalogo non ha date né famiglie: le famiglie si riconoscono con regex ancorate sull'id, la versione si confronta solo dentro la famiglia (decisione in `DECISIONS.md`, «Proposta dei ruoli nel setup»).

## Stato

Implementazione nella Principale il 2026-11-13, dal prototipo FirstSpark (p-20261113-6iv9k8, revisione c0aa18e) approvato dall'utente («abbiamo fatto la grafica sul prototipo e sono soddisfatto, la puoi implementare in toto nel codice»). Copertura **parziale**: l'app desktop non si può avviare in sessione (AGENTS.md), quindi il percorso completo nella finestra reale non è ancora provato.

## Verifiche

| Data | ID | Scenario | Esito | Prova |
|---|---|---|---|---|
| 2026-11-13 | SET-043 | `npm run check:setup-flow` su omp 18.20.0; hash di `wizard.ts` alterato nel lock; `release.mjs` con lock alterato | Passa sul lock generato; con l'hash alterato esce 1 con il diff per file e la procedura; il rilascio si ferma prima del bump | Output degli script, sessione corrente |
| 2026-11-13 | SET-012, SET-042 | Test Rust del resolver su fixture del catalogo reale (anthropic, openai-codex, google-antigravity, cursor, commandcode, local) e proposta sul catalogo vivo con le credenziali di questa macchina | 46 test verdi. Sul catalogo vivo: default e plan `anthropic/claude-opus-5-5` (plan con `high`), smol e commit `claude-haiku-5-5`, vision e task `claude-sonnet-5-5`; i ruoli già configurati restano `current` | `cargo test --lib setup_roles`, sessione corrente |
| 2026-11-13 | SET-010, SET-041 | Test Rust: link rotto con la forma reale `../../node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`, binario che non risponde, stato dopo la riparazione; merge di `config.yml`; progresso salvato e riletto | Verdi (76 test `setup`). Nessuna prova nella finestra reale | `cargo test --lib setup`, sessione corrente |
| 2026-11-13 | SET-011, SET-040 | `omp --mode rpc --no-session`: `get_login_providers`; `login deepseek` senza rispondere; `login google-antigravity` | 93 provider; deepseek apre l'URL e chiede la chiave con `input`, che Studio manda al terminale; antigravity rifiutato per prompt interattivi, quindi terminale. Nessuna credenziale scritta. Tessere non provate a schermo | Script di prova (rimosso), sessione corrente |
| 2026-11-13 | SET-002, SET-003, SET-013, SET-017 | Vite nel browser con una rotta temporanea (rimossa): ingresso, salto con tasto, 8 passi, tema chiaro applicato, conferme Esc e TUI, Riepilogo | Visibili e navigabili; senza Tauri non ci sono `invoke` né PTY, quindi Motore, login e terminale non sono esercitati | Smoke dell'agente del guscio, sessione corrente |
| 2026-11-13 | tutti | `npm run check`, `npm test` (compresa la copertura ACL dei comandi nativi) | 0 errori; smoke verdi dopo aver concesso i cinque comandi nuovi nella capability | Sessione corrente |
