# Product

## Che cos'è

OMP Studio è il **guscio desktop attorno all'esperienza di `omp`**. Non è un editor con un
agente incollato dentro: è un gestore di workspace multi-progetto che tratta la sessione
dell'agente come cittadino di prima classe, e ci mette un editor accanto.

Una sola finestra, tre colonne flessibili:
- **Sinistra**: Albero dei file, pannello Git (branch, diff, commit, history) e Agente (Coda task e Storico sessioni con ricerca full-text).
- **Centro**: Editor Monaco multi-modello (con visualizzatore diff affiancato, sintassi estesa, ripristino cursore/scroll), Whiteboard per diagrammi Mermaid (`studio_diagram`), Anteprima prototipi UI HTML/SVG in sandbox isolata (`studio_preview`), e Task Editor a sezioni con ruoli, thinking effort, direttive speciali e allegati visivi.
- **Destra**: Superficie duale a schede `TERMINAL | GUI` (Terminale xterm.js Canvas + ConPTY/POSIX PTY ad alte prestazioni, e Chat GUI nativa Svelte 5 su `omp --mode rpc-ui` con 30+ card tool dedicate, raggruppamento semantico tool/thinking, gestione subagent e comandi slash).

In alto, la barra dei progetti permette lo switch istantaneo tra workspace con ordine manuale stabile o per priorità/MRU/alfabetico, badge numerico della coda e indicatore di stato reattivo per ogni agente.

## Piattaforma

Desktop Windows 11 x64 (NSIS, WebView2) e macOS (DMG universale Apple Silicon + Intel, WebKit WKWebView). Nessun mobile, nessuna versione browser, nessun server. L'app gira al 100% in locale e parla solo con il filesystem, con `git` e con `omp` installati sulla macchina.
## I problemi che risolve

**1. Cambiare progetto senza costo mentale.** Con un agente per progetto e una finestra
per progetto, ricordare quale sessione gira in quale finestra è lavoro che ricade
sull'utente. Qui i progetti sono tessere stabili in barra: si clicca, le tre colonne si
ripopolano, la sessione di quel progetto è già lì dov'era.

**2. Sapere quanta quota AI resta, senza interrompere niente.** Chiedere l'usage
dall'interno di una sessione significa aprire un secondo terminale ed eseguire un
comando solo per leggere un numero. Qui l'usage sta dietro un'icona resiliente in barra
(con gestione degli stati offline e non autenticati), con dati reali da `omp usage --json`,
countdown al reset, trend 24h e raccomandazione modelli con protezione zero-cost.

**3. Non perdere il prossimo lavoro e orchestrare i task.** Ogni progetto ha una coda
persistita in `tasks.json`: si compone il task con il TaskEditor (impostando ruoli,
thinking effort, direttive speciali come Piano/Discussione/Minimale/Ricerca e screenshot allegati),
lo si riordina e lo si avvia quando l'agente torna in attesa. L'avvio può avvenire dalla
barra con il popup di anteprima rapida, dalla vista aggregata di tutte le code (`Ctrl+Alt+T`)
o automaticamente appena l'agente si libera se abilitato per quel progetto (`DECISIONS.md` Gate R12).

**4. Riprendere un lavoro interrotto in un click.** Riprendere a mano significa
ricordare il progetto, riaprire la cartella, riavviare l'agente, cercare la sessione
giusta in un elenco. Qui lo storico unifica `history.db` e i file su disco in un elenco
filtrabile e ricercabile full-text, riprendibile in-place con `/resume` nello stesso terminale
o con ricollegamento diretto nella GUI.

**5. Ispezionare modifiche, diagrammi e prototipi sul posto.** Verificare cosa ha fatto
l'agente non richiede un secondo strumento: il pannello Git apre il diff affiancato
nell'editor per qualsiasi file toccato (inclusi i commit recenti), i diagrammi Mermaid
generati via `studio_diagram` si aprono nella whiteboard centrale, e i prototipi UI
HTML/SVG creati via `studio_preview` si animano nella sandbox interattiva con switch del viewport.

**6. Primo avvio a zero attrito.** All'apertura su una macchina nuova, Studio guida
l'utente passo-passo: scarica e verifica SHA-256 di `omp` se mancante, imposta Git Bash,
installa il font Nerd per-utente e ospita il wizard di configurazione modelli/provider
di `omp` dentro una scheda terminale protetta, impostando la cartella dei repository con un click.

**7. Notifiche desktop per non restare bloccati.** Quando un agente richiede una risposta
o completa un task mentre l'app è in background, Studio invia notifiche toast native
(Windows/macOS) con AUMID registrato, aggiunge il pallino rosso/flash sulla barra delle
applicazioni Windows o il badge numerico con rimbalzo nel Dock di macOS, portando l'utente
direttamente al progetto attivo con un click.

**Successo si misura così:** passare da progetto a progetto non richiede di ricordare
nulla; conoscere la quota residua non richiede di interrompere niente; il prossimo
prompt resta nella coda del progetto; riprendere una sessione di ieri richiede un click;
ispezionare il codice o un'anteprima avviene direttamente nel flusso di lavoro.
## Non-obiettivi

- **Non è un IDE generico.** Niente debugger complessi, build pipeline generiche, o
  marketplace di estensioni. L'editor, il diff Git, la whiteboard e la sandbox servono a
  leggere, validare e correggere quello che l'agente produce, non a sostituire l'ambiente
  di sviluppo principale.
- **Non sostituisce la TUI.** La TUI di `omp` gira in un terminale reale ad alte prestazioni
  (renderer Canvas, ConPTY/POSIX) e l'app non la interpreta, la ospita: resta intatta,
  scorciatoie comprese. Accanto a essa, la colonna destra offre la superficie GUI nativa
  che pilota `omp --mode rpc-ui`. Le due superfici sono alternative e cooperanti: un solo
  processo per progetto, e il passaggio riapre la **stessa** sessione con `--resume`.
  Studio non reimplementa l'agente: nessun client ACP verso terzi, nessuna logica di modello
  o prompt hardcoded dentro l'app.
- **Non è un servizio cloud né un dashboard di analytics.** Nessun server remoto, nessun
  account obbligatorio oltre a quelli configurati in `omp`. L'usage risponde a "quanto resta e
  quando si resetta", non produce reportistica aziendale.
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
  nessuna activity bar a otto icone, nessuna status bar con dodici widget. Vale anche
  per le impostazioni: esiste un centro impostazioni, non un albero di preferenze.
  Ogni voce deve rispondere a un attrito reale della giornata di lavoro — la barra dei
  progetti che si sposta sotto il mouse, il font troppo piccolo alle otto di sera — e
  quella che non lo fa non viene aggiunta.
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

3. **Lo stato di un progetto si legge dalla tessera, sempre.** Tre stati dell'agente e
   non uno di più: inattivo, sta lavorando, aspetta te. Accanto a essi, un solo dato
   che non è uno stato ma una quantità: quanti task attendono in coda. Tutto leggibile
   anche per il progetto non a schermo — è l'informazione che manca a chi lavora con
   più agenti in parallelo, e giustifica l'intero progetto. Lo stile del contatore
   (numero, numero più prontezza, puntino, niente) è una preferenza: chi vuole la
   tessera muta lo spegne.

4. **La sessione non muore mai per colpa della UI.** Cambiare progetto, ridimensionare,
   chiudere un pannello, collassare una colonna: nessuna di queste azioni può uccidere,
   riavviare o corrompere un PTY. La persistenza del processo è un invariante, non una
   feature.

5. **Un solo accento, usato con significato.** Neutri, un cremisi e un ambra. L'accento
   marca identità e fuoco; l'ambra marca "attenzione quota". Nessun verde-successo,
   nessun rosso-errore nel guscio: gli errori appartengono al terminale, duplicarli
   fuori è rumore. Il colore per progetto è funzionale — distingue, non decora.

6. **Le tre colonne sono un sistema di priorità, non un layout fisso.** Il terminale / GUI è
   l'unica colonna che non si può nascondere. Albero/Git ed editor/anteprime si collassano con
   scorciatoie dedicate, e le larghezze sono per-progetto e persistenti.

7. **Niente stato inventato.** Ogni numero mostrato viene da una fonte reale di `omp`.
   Se un dato non è disponibile (es. provider non raggiungibile o offline), si mostra chiaramente
   lo stato di errore con opzione di riprova, mai un placeholder plausibile.

8. **Il costo di un errore dell'app deve essere zero.** OMP Studio non scrive dati distruttivi
   dentro `~/.omp` (unica deroga controllata: `themes/omp-studio.json` per allineamento cromatico
   e `shellPath` in merge per Git Bash se assente) e apre i database di `omp` in sola lettura
   rigorosa (`PRAGMA query_only = ON` e `SQLITE_OPEN_READONLY`). Nel caso peggiore l'app è un
   guscio chiuso attorno a dati intatti, recuperabili riaprendo `omp` da terminale.

9. **Accessibilità e precisione ergonomica.** Nessuna informazione affidata al solo colore;
   contrasti conformi WCAG AA (>= 4.5:1), supporto navigazione tastiera completa con roving
   tabindex, focus trap sui modali, annunci `aria-live` per i cambi di stato asincroni e pieno
   rispetto di `prefers-reduced-motion`.
