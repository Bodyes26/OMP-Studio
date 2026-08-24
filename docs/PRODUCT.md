# Product

## Che cos'è

OMP Studio è il **guscio desktop attorno alla TUI di `omp`**. Non è un editor con un
agente incollato dentro: è un gestore di workspace multi-progetto che tratta la sessione
dell'agente come cittadino di prima classe, e ci mette un editor accanto.

Una sola finestra, tre colonne — albero dei file, editor, terminale — e una barra di
progetti in alto. Ogni progetto ha la sua sessione `omp` viva, che continua a girare
anche quando non è a schermo.

## Piattaforma

Desktop Windows 11 x64, Tauri 2 + WebView2. Nessun mobile, nessuna versione browser,
nessun server. L'app gira in locale e parla solo con il filesystem, con `git` e con
`omp` installati sulla macchina.

## I quattro problemi che risolve

**1. Cambiare progetto senza costo mentale.** Con un agente per progetto e una finestra
per progetto, ricordare quale sessione gira in quale finestra è lavoro che ricade
sull'utente. Qui i progetti sono tessere in barra: si clicca, le tre colonne si
ripopolano, la sessione di quel progetto è già lì dov'era.

**2. Sapere quanta quota AI resta, senza interrompere niente.** Chiedere l'usage
dall'interno di una sessione significa aprire un secondo terminale ed eseguire un
comando solo per leggere un numero. Qui l'usage sta dietro un'icona in barra, con dati
reali da `omp usage --json`, aggiornati mentre l'agente lavora.

**3. Non perdere il prossimo lavoro mentre l'agente è occupato.** Ogni progetto ha una
coda manuale di prompt: si scrive il prossimo task, lo si riordina e lo si avvia quando
`omp` torna in attesa. Studio crea una sessione pulita con `/new`, invia il prompt e
mantiene nello storico l'origine del task.

**4. Riprendere un lavoro interrotto in un click.** Riprendere a mano significa
ricordare il progetto, riaprire la cartella, riavviare l'agente, cercare la sessione
giusta in un elenco. Qui lo storico è una lista per progetto, con il primo prompt come
titolo, ricercabile full-text e riprendibile con `/resume` nello stesso terminale.

**Successo si misura così:** passare da progetto a progetto non richiede di ricordare
nulla; conoscere la quota residua non richiede di interrompere niente; il prossimo
prompt resta nella coda del progetto; riprendere una sessione di ieri richiede un click.

## Non-obiettivi

- **Non è un IDE.** Niente build, debug, refactoring, GUI per git, estensioni.
  L'editor serve a leggere e correggere quello che l'agente tocca, non a sostituire
  l'ambiente di sviluppo.
- **Non sostituisce la TUI.** La TUI di `omp` gira in un terminale reale e l'app non la
  interpreta, la ospita: resta intatta, scorciatoie comprese. Accanto a essa, dalla 1.0,
  la colonna destra ha una seconda superficie — una GUI nativa che pilota lo stesso
  `omp` su `--mode rpc-ui`. Le due superfici sono alternative, non sovrapposte: un solo
  processo per progetto, e il passaggio riapre la **stessa** sessione con `--resume`.
  Quello che l'app continua a non fare è reimplementare l'agente: nessun client ACP
  verso agenti terzi, nessuna logica di modello, di prompt o di tool dentro Studio.
- **Non è multipiattaforma.** Un solo bersaglio, ottimizzato, invece di tre approssimati.
- **Non è un dashboard di analytics.** L'usage risponde a "quanto resta e quando si
  resetta", non produce grafici.

## Personalità

`omp` è uno strumento da officina, non un prodotto SaaS. Tre parole: **strumento,
silenzioso, preciso**.

- Il tono è quello di un banco di lavoro ben tenuto: tutto ha il suo posto, niente
  chiede attenzione se non serve.
- L'interfaccia è **cornice**, non contenuto. Il contenuto è l'output ANSI dell'agente
  e il codice. Il guscio è cromaticamente silenzioso perché i colori che contano sono
  quelli dentro il terminale e dentro l'editor.
- Densità alta senza affollamento: è uno strumento da otto ore, non una demo da trenta
  secondi.
- Zero celebrazione. Nessun "Welcome back", nessuna animazione che si fa notare due
  volte, nessun vuoto illustrato.
- L'unico momento in cui l'app alza la voce è quando una quota sta finendo: è l'unica
  informazione che ha diritto di interrompere.

## Anti-riferimenti

- **VS Code.** OMP Studio non deve diventarne un clone con meno funzioni. Se una feature
  esiste solo perché "VS Code ce l'ha", si taglia. Nessuna command palette generica,
  nessuna activity bar a otto icone, nessuna status bar con dodici widget.
- **Cursor / Windsurf / OpenCode Desktop.** Rimpiazzano la TUI dell'agente con una chat
  GUI che diventa l'unica interfaccia possibile, e con essa reimplementano prompt, tool
  e approvazioni. Questo resta il rifiuto: la GUI di Studio **affianca** la TUI, non la
  sostituisce, e non contiene logica di agente — è un client di `--mode rpc-ui` che
  rende quello che `omp` dichiara. Chi vuole la TUI la trova nella scheda accanto, sulla
  stessa sessione.
- **Zed.** Ottimo editor, ma resta un editor con una nozione di workspace da editor.
  Qui il primo cittadino è la sessione agente per progetto.
- **AI slop 2025-2026.** Glassmorphism decorativo, gradient text, card con bordo sottile
  e ombra larga, angoli da 24-32px, eyebrow uppercase sopra ogni sezione, marcatori
  `01 / 02 / 03`, sfondi a griglia, illustrazioni SVG "sketchy".
- **Tema incoerente.** Temi chiari e scuri sono ammessi, ma guscio e TUI devono
  sempre cambiare insieme: nessuna superficie chiara attorno a un terminale scuro
  o tema manuale diverso tra Studio e `omp`.
- **Il terminale "abbellito".** Nessun padding decorativo dentro la viewport, nessun
  font proporzionale, nessuna reinterpretazione dei sedici colori ANSI. Il terminale è
  sacro: pixel-perfect e veloce.
- **La cattura di scorciatoie.** Ogni shortcut che l'app si prende è una shortcut
  rubata alla TUI. Il set di scorciatoie dell'app è deliberatamente minuscolo e vive su
  un modificatore che `omp` non usa.

## Principi di design

1. **Il terminale è il contenuto, l'app è la cornice.** La viewport non viene mai
   decorata, sovrapposta né animata. Nessun overlay dell'app può coprirla mentre
   l'agente scrive. La cornice usa neutri a croma 0 esatta proprio per non alterare la
   percezione dei colori ANSI adiacenti.

2. **Lo switch di progetto è istantaneo, quindi non si anima.** Cambiare progetto è
   cambiare stanza, non navigare una pagina. Le tre colonne appaiono senza transizione:
   si muove solo l'indicatore di tessera attiva. Animare lo swap aggiungerebbe latenza
   percepita a gratis.

3. **Lo stato di un progetto si legge dalla tessera, sempre.** Tre stati e non uno di
   più: inattivo, l'agente sta lavorando, l'agente aspetta te. Leggibili anche per il
   progetto non a schermo. È l'informazione che manca a chi lavora con più agenti in
   parallelo, e giustifica l'intero progetto.

4. **La sessione non muore mai per colpa della UI.** Cambiare progetto, ridimensionare,
   chiudere un pannello, collassare una colonna: nessuna di queste azioni può uccidere,
   riavviare o corrompere un PTY. La persistenza del processo è un invariante, non una
   feature.

5. **Un solo accento, usato con significato.** Neutri, un cremisi e un ambra. L'accento
   marca identità e fuoco; l'ambra marca "attenzione quota". Nessun verde-successo,
   nessun rosso-errore nel guscio: gli errori appartengono al terminale, duplicarli
   fuori è rumore. Il colore per progetto è funzionale — distingue, non decora.

6. **Le tre colonne sono un sistema di priorità, non un layout fisso.** Il terminale è
   l'unica colonna che non si può nascondere. Albero ed editor si collassano con una
   scorciatoia, e la larghezza è per-progetto e persistente: un progetto in cui si legge
   molto codice non ha lo stesso layout di uno in cui si guarda solo l'agente.

7. **Niente stato inventato.** Ogni numero mostrato viene da una fonte reale di `omp`.
   Se un dato non è disponibile, si mostra che non è disponibile. Mai un placeholder
   plausibile.

8. **Il costo di un errore dell'app deve essere zero.** OMP Studio non scrive niente
   dentro `~/.omp` e apre i database di `omp` in sola lettura. Nel caso peggiore l'app è
   un guscio rotto attorno a dati intatti, recuperabili riaprendo `omp` da terminale.
