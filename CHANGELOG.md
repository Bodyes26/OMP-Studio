# Changelog

Tutte le modifiche rilevanti a omp-studio-app.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
versionamento secondo [Semantic Versioning](https://semver.org/lang/it/).

La sezione `[Unreleased]` è il parcheggio dei lavori completati ma non ancora
rilasciati: vengono chiusi in una versione con `npm run release -- <versione>`.

## [Unreleased]

## [0.3.1] - 2026-08-13

### Added

- Supporto completo cross-platform per macOS (Apple Silicon e Intel): shell PTY nativa ($SHELL zsh/bash), risoluzione automatica del binario `omp`, scorciatoie da tastiera con `Cmd` (⌘) e gestione percorsi POSIX.
- Iniezione automatica dei percorsi binari utente (`~/.bun/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, ecc.) nella variabile `$PATH` per le sessioni PTY su macOS.

### Fixed

- Corretto errore di compilazione `libsqlite3-sys` con versioni recenti del compilatore Rust.
- Risolto limite di memoria V8 durante la build frontend di Monaco Editor.
## [0.3.0] - 2026-08-03

### Added

- Apri più file nello stesso progetto come schede dell'editor, con diff e chiusura su ogni scheda; `Ctrl+W` e `Ctrl+F4` chiudono il file attivo.
- Rinomina un progetto e imposta una sigla personale di più caratteri dal suo riquadro.

### Changed

- Il selettore temi separa chiari e scuri in due tab, riapre sull'ultima tab usata e mostra il nome del tema applicato accanto al colore.
- I colori automatici dei progetti seguono ora la palette e la luminanza del tema attivo; le scelte manuali restano invariate.
- Il percorso nel riquadro di un progetto viene ellissato senza uscire dal bordo.
## [0.2.1] - 2026-08-03

### Added

- Aggiunge i 48 temi chiari builtin di `omp` e li separa dai 52 temi scuri nello
  switcher; la scelta aggiorna insieme guscio, editor, terminale e sessioni `omp`.

### Changed

- All'avvio riconosce anche `theme.light` quando `theme.dark` non è impostato.

## [0.2.0] - 2026-08-03

### Added

- Il pannello consumi si apre e si chiude con `Ctrl+Alt+U`, senza staccare le mani
  dalla tastiera. La scorciatoia è indicata anche nel suggerimento del pulsante.
- Sotto ogni barra del pannello consumi c'è ora scritto chi sta usando quella quota
  in questo momento — per esempio "In uso da: OMP Studio · AreaIT, Windows Terminal ·
  GestioneFlotta" — così si sa subito se il conto lo sta facendo salire un'altra
  finestra. Se nessuno la sta usando non compare niente.
- Selettore di tema nella barra superiore: 52 temi scuri di `omp`, con filtro.
  Cambia insieme i colori di Studio e quelli della TUI, che d'ora in poi partono
  dallo stesso tema. All'avvio Studio adotta da solo il tema già scelto in `omp`.
- `Ctrl+click` su un percorso di file stampato dall'agente lo apre nell'editor, alla
  riga indicata. I percorsi fuori dalla cartella del progetto vengono ignorati.

### Changed

- Interfaccia più silenziosa: gli stati dell'agente non usano più aloni luminosi
  colorati né verde e blu. Restano un anello e un punto in due soli colori —
  cremisi quando lavora o ha finito, ambra quando aspetta una risposta.
- La barra superiore non si ingrandisce più al passaggio del mouse: schede, logo e
  spaziature restano fermi. È ora alta 48px, con schede e logo proporzionati.
- Un solo progetto colorato per volta: la scheda attiva è piena nel colore del
  progetto, le altre sono neutre con la sola iniziale tinta. Prima ogni progetto
  aperto era un blocco saturo.
- Una sola animazione continua in tutta l'app, al posto di sette: il respiro della
  scheda "al lavoro", ridisegnato per non tenere occupata la scheda video a riposo.
- Nel riquadro della scheda il percorso viene troncato al centro invece di scorrere
  avanti e indietro: la coda del percorso è la parte che serve.
- Colori e raggi dell'interfaccia derivano ora da poche costanti, quindi stati come
  "riga sotto il mouse" o "riga selezionata" si comportano allo stesso modo in ogni
  pannello, anche sopra il terminale e dentro i popover.
- Le colonne si separano per differenza di sfondo invece che per linee: spariti i
  divisori verticali e i bordi sotto le intestazioni. Le righe dell'albero
  svaniscono passando sotto l'intestazione, e il divisore trascinabile compare in
  cremisi solo quando ci passi sopra.

### Removed

- Sfocatura di sfondo dietro le finestre di dialogo: costava un ridisegno continuo
  del terminale sottostante senza aggiungere informazione.
## [0.1.0] - 2026-07-30

### Added

- Prima versione pubblica: guscio desktop multi-progetto per l'agente `omp`, con
  terminale integrato, albero dei file, editor e pannello consumi in una sola finestra.
- Barra dei progetti in alto: ogni progetto è una scheda con il proprio terminale
  sempre vivo, ordinamento automatico per ultimo uso e colore personalizzabile
  (palette di otto tonalità o selettore libero).
- Stato dell'agente leggibile a colpo d'occhio sulla scheda e nella barra inferiore:
  inattivo, al lavoro, in attesa di una risposta, lavoro concluso.
- Selettore di progetti dal pulsante `+` o con `Ctrl+Alt+N`: elenca le cartelle nella
  radice dei repository segnalando quelle già aperte, e permette di sfogliarne altre.
- Albero dei file con icone per tipo, indicatori di stato Git (modificato, aggiunto,
  non tracciato, rimosso, rinominato) e aggiornamento automatico quando l'agente
  tocca un file.
- Editor Monaco con confronto affiancato rispetto alla versione in Git, marcatori nel
  margine per le righe cambiate, indicatore di modifiche non salvate e salvataggio
  con `Ctrl+S`. Ogni progetto ricorda il file che aveva aperto.
- Anteprima dal vivo per Markdown e SVG accanto all'editor, con divisorio trascinabile,
  e visualizzatore dedicato per le immagini con zoom, spostamento e ripristino 1:1.
- Elenco e ricerca full-text delle sessioni dell'agente, per riprendere un lavoro
  interrotto senza cercarlo a mano.
- Pannello consumi con quota residua per fornitore, aggiornamento manuale, indicazione
  dell'ultimo aggiornamento e animazioni di riempimento delle barre.
- Controllo e installazione degli aggiornamenti di `omp` dalla barra inferiore, con
  conferma, log e proposta di riavvio.
- Controlli finestra nativi integrati nella barra superiore e ripristino di posizione
  e dimensione all'avvio.
