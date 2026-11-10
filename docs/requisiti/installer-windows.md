# Installer grafico Windows — registro dei requisiti

## Ambito e fonti

Obiettivo: sostituire l'aspetto della procedura NSIS standard con un installer grafico
nostro (strada «E»), senza cambiare il motore di installazione: il setup NSIS generato da
Tauri resta dentro l'installer grafico e fa installazione, associazioni dei file,
WebView2, aggiornamenti e disinstallazione come oggi.

Fonti utente, 2026-11-10, sessione corrente:
- **F1:** «su windows l'installer è ancora quello standard di windows che tra l'altro fa
  veramente cagare»; «quali strade abbiamo per renderlo carino graficamente e soprattutto
  portare il nostro design?».
- **F2:** «l'aspetto vicino al "nativo" windows ma con componenti moderni di windows 11 non
  sarebbe male, e anche il tema scuro automatico è interessante».
- **F3:** «proviamo ad implementare la E allora».
- **F4:** risposte al modulo dei requisiti: un clic con pannello «Opzioni» richiudibile
  (cartella, collegamento sul desktop); pulsante «Apri OMP Studio» a fine installazione;
  collegamento sul desktop come casella attiva di default; lingua secondo Windows (italiano
  o inglese) senza finestra di scelta; cornice Windows 11 con Mica e tema automatico più la
  rovina del DMG resa in ASCII animata; versione installata rilevata, «Aggiorna»/«Reinstalla»,
  e con Studio aperto «Chiudi Studio e continua» oltre a «Riprova».

## Requisiti attivi

| ID | Fonte | Stato | Requisito | Scenario concreto |
|---|---|---|---|---|
| IWN-001 | F1, F3 | attivo | L'asset Windows pubblicato resta `*_x64-setup.exe` ed è l'installer grafico; il setup NSIS di Tauri è incorporato e non è pubblicato a parte. | La release contiene un solo `.exe` Windows; `install-windows.cmd`, `nightly.json`, `SHA256SUMS.txt` e l'updater lo trovano con il nome di sempre. |
| IWN-002 | F3; vincolo dell'updater | attivo | Con `/S` o `/P` l'installer grafico non apre finestre: estrae il setup NSIS, gli passa la riga di comando invariata, attende e restituisce lo stesso codice d'uscita. | L'aggiornamento in-app (`/S`) e `install-windows.cmd` installano in silenzio come oggi, anche da versioni di Studio già installate. |
| IWN-003 | F4 | attivo | Schermata unica: «Installa» con un clic; pannello «Opzioni» richiudibile con cartella di installazione (sfoglia) e casella «Collegamento sul desktop» attiva di default. | Un clic su «Installa» installa nella cartella predefinita per l'utente corrente; togliendo la casella non resta il collegamento sul desktop. |
| IWN-004 | F4 | attivo | A installazione riuscita, «Apri OMP Studio» avvia l'app e chiude l'installer. | Dopo l'installazione il pulsante apre Studio; «Chiudi» esce senza avviarlo. |
| IWN-005 | F4 | attivo | Lingua italiana o inglese secondo la lingua dell'interfaccia di Windows, senza finestra di scelta. | Su Windows in italiano i testi sono in italiano; in ogni altra lingua in inglese. |
| IWN-006 | F2, F4 | attivo | Cornice Windows 11: sfondo Mica, barra del titolo di sistema, tema chiaro o scuro secondo Windows; su Windows 10 fondo pieno al posto di Mica. | Cambiando il tema di Windows l'installer segue; su Windows 10 il testo resta leggibile. |
| IWN-007 | F4 | attivo | La rovina dello sfondo del DMG è resa in caratteri ASCII in un canvas animato: composizione all'avvio, reazione al puntatore, animazione durante l'installazione; con «riduci animazioni» l'immagine è ferma. | All'apertura il pi si compone dai caratteri; passando il mouse i caratteri reagiscono; con `prefers-reduced-motion` compare subito l'immagine finale. |
| IWN-008 | F4 | attivo | Studio già installato: si mostra la versione installata, il pulsante diventa «Aggiorna a x.y» o «Reinstalla» e la cartella resta quella esistente. | Con 1.9 installata e installer 1.10 il pulsante dice «Aggiorna a 1.10.0» e l'installazione non cambia cartella. |
| IWN-009 | F4 | attivo | Studio aperto: avviso con «Riprova» e «Chiudi Studio e continua», che termina l'app avvisando che il lavoro non salvato si perde. | Con Studio aperto «Installa» non parte finché Studio non è chiuso; «Chiudi Studio e continua» lo termina e prosegue. |
| IWN-010 | F3; ripiego tecnico | attivo | Senza WebView2 l'installer grafico non può aprirsi: lancia il setup NSIS classico, che installa anche WebView2. In caso di errore la schermata offre l'installer classico. | Su una macchina senza WebView2 compare la procedura NSIS e l'installazione riesce. |
| IWN-011 | F3; vincolo di pubblicazione | attivo | Nightly locale, Nightly cloud e release stabile producono l'installer grafico; nella release stabile setup interno e installer grafico sono firmati quando il certificato è configurato. | La firma Authenticode verificata in `release.yml` copre l'installer grafico pubblicato. |

## Fuori ambito

- La disinstallazione da Impostazioni → App resta quella di NSIS.
- Gli aggiornamenti dentro l'app restano silenziosi (`/S`): nessuna finestra nuova.

## Verifiche

| Data | Requisito | Scenario | Risultato | Prova |
|---|---|---|---|---|
| 2026-11-10 | IWN-002 | Wrapper con payload innocuo compilato in Rust; `/S`, percorso con spazi e codici d'uscita | Argomenti preservati, codici 41 e 42 restituiti; nessuna cartella temporanea residua. L'utente conferma: «non mi ha segnalato nulla» per Sophos. Non dimostra l'assenza di avvisi con ogni installer reale. | Output del test e conferma utente, sessione corrente. |
| 2026-11-10 | IWN-003, 007, 008 | UI nel browser, API native simulate | Visti chiaro/scuro, Opzioni, avviso app aperta, avanzamento, successo ed errore; risolto il taglio delle Opzioni consentendo lo scorrimento del pannello. Non prova l'installazione. | Screenshot Chromium, sessione corrente. |
| 2026-11-10 | IWN-001, 011 | Compilazione del wrapper con un vero NSIS Nightly esistente | Build riuscita: 18,9 MB di payload, 32,0 MB in profilo dev. Nessuna installazione eseguita; dimensione non rappresentativa del profilo di pubblicazione. | `build-windows-installer.mjs --setup ... --profile dev`, sessione corrente. |
| 2026-11-10 | IWN-005, 006, 008, 009 | Finestra nativa aperta senza installare | API reali: lingua `it`, Mica disponibile, versione installata rilevata, cartella bloccata e Studio aperto; pulsante installazione disabilitato. Chiusura dell'installer riuscita, nessun errore JS. La cattura CDP non include il compositing Mica del desktop. | Snapshot e osservazione del webview nativo su porta CDP locale, sessione corrente. |
| 2026-11-10 | IWN-003, 008 | Test Rust di cartella, validazione e confronto versioni | 3 test passati; clippy del crate senza warning. | `cargo test -p omp-studio-setup`, `cargo clippy -p omp-studio-setup --all-targets -- -D warnings`, sessione corrente. |
| 2026-11-10 | Integrazione frontend | `npm run check` e parsing dei quattro script JavaScript modificati/nuovi | Check: 0 errori, 7 warning in file fuori modifica; `node --check` riuscito. | Output della sessione corrente. |

**Accettazione end-to-end ancora aperta:** installazione reale (cartella e collegamenti),
avvio finale di Studio, aggiornamento reale da una versione precedente, macchina senza
WebView2, Windows 10 e firma/pubblicazione in CI. Non eseguiti sulla postazione per non
chiudere o sostituire lo Studio in uso. Gli scenari UI con dati simulati non li chiudono.
La prova del wrapper usa un NSIS Nightly precedente, con versione diversa da quella
della UI di sviluppo: non e' un installer da distribuire.

## Build e manutenzione

- Crate `src-tauri/installer/`, membro del workspace Cargo; UI statica in `ui/`
  (HTML, CSS, JavaScript senza bundler). La versione mostrata viene da `package.json`.
- Prima generare il setup con Tauri, poi eseguire
  `node scripts/build-windows-installer.mjs --setup <file-setup.exe> --profile release`
  (oppure `nightly`). Il comando incorpora il setup e lo sostituisce con il wrapper
  mantenendo il nome; la copia del payload resta fuori dal bundle, in
  `src-tauri/target/<profilo>/installer-payload/`. Lo script rifiuta la selezione
  ambigua di piu' setup con `--bundle-dir`; un wrapper gia' generato non viene
  annidato di nuovo.
- Nightly locale e i due workflow chiamano lo stesso script. La release stabile
  firma il setup prima dell'incorporamento e il wrapper dopo: i checksum pubblicati
  sono quelli del file finale. La disinstallazione resta NSIS.
- Per rigenerare foto e maschera: `python scripts/generate-installer-art.py` con numpy
  e Pillow. I sorgenti sono gli stessi del DMG in `assets/dmg/`; non servono Menlo
  ne' `tiffutil`, perche' qui i caratteri si disegnano nel canvas.
- Non usare eseguibili di sistema rinominati come payload di prova: il tentativo
  con `cmd.exe` ha prodotto «Evade_13a» di Sophos. Nessuna esclusione antivirus
  applicata; per prove di inoltro usare solo un programma innocuo compilato apposta.
