# File esterni ("Apri con… Studio") — registro dei requisiti

Ambito: aprire in Studio file che non appartengono a un progetto già aperto, come farebbe un editor di sistema (VS Code, Blocco note). Esclusi: apertura di cartelle intere come progetto dal sistema operativo, tipi binari.

## Fonte e direzione approvata

2026-11-08, utente: «Dobbiamo permettere di aprire file esterni in studio, cioè che Studio, oltre che poter aprire file dei progetti aperti, possa funzionare da editore esterno […] si può aprire un file con VS Code o con blocco note a poterlo aprire anche con Studio».

Stato di partenza (2026-11-08): tab dell'editor legate alla corsia del progetto con percorsi relativi; `file_read`/`file_write` confinati alla radice del progetto (`resolve_path`, `src-tauri/src/projects/mod.rs`); callback di single-instance che ignora gli argomenti; nessuna `fileAssociations`, nessun `RunEvent::Opened`, nessun dialog "Apri file", nessun watcher sui file aperti.

2026-11-08, utente, scelte sulla proposta:
- posizione: «Spazio 'File esterni' nella barra progetti», con la nota: «al posto di una cartella fittizia, avere il pulsante che dice apri cartella come progetto […] una volta premuto registra direttamente il progetto come aperto su studio»;
- associazioni: «Solo 'Apri con…' per i file di testo e codice», con la nota: «Per i file che hanno l'anteprima tipo Markdown e simili o mermaid deve mostrare anche l'opzione dell'anteprima […] e se si aprono file HTML anche deve potersi essere l'anteprima […] però ci sta Non metterlo su tutto»;
- agente: «Sì, l'agente vede e può modificare il file», con la nota: «si avvia l'agente sulla cartella di lavoro dove c'era il file che è stato aperto […] neanche da dover chiedere altri permessi specifici […] nel momento in cui l'utente apre un file su studio ci ha dato già il consenso».

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| EXT-001 | attivo, approvato | Studio si registra nel sistema operativo come voce di "Apri con…" per un elenco di estensioni di testo e codice, senza diventare l'applicazione predefinita e senza voci per tutti i tipi di file. | Clic destro su `note.txt` in Esplora risorse → "Apri con" → Studio è nell'elenco; il doppio clic continua ad aprire il programma predefinito. |
| EXT-002 | attivo, approvato | Aprire un file con Studio funziona sia a Studio chiuso (argomento all'avvio, `RunEvent::Opened` su macOS) sia a Studio già aperto (argomenti inoltrati dalla seconda istanza): la finestra esistente viene portata in primo piano con il file aperto. | Studio aperto su un progetto; "Apri con… Studio" su un file di Download → nessuna seconda finestra, il file compare in Studio. |
| EXT-003 | attivo, approvato | Se il file sta dentro un progetto già aperto in Studio, si apre come tab di quel progetto, che diventa attivo. | `C:/repo/OMP-Studio/README.md` aperto da Esplora risorse → tab in OMP-Studio, non in File esterni. |
| EXT-004 | attivo, approvato | I file fuori dai progetti aperti finiscono in uno spazio fisso "File esterni" nella barra progetti, con le sue tab. | `Download/appunti.md` aperto con Studio → compare lo spazio File esterni con la tab `appunti.md`. |
| EXT-005 | attivo, approvato | Nello spazio File esterni l'albero file non mostra una cartella fittizia: per la cartella del file non ancora aperta come progetto mostra il pulsante "Apri cartella come progetto", che registra subito il progetto in Studio. | Clic su "Apri cartella come progetto" → la cartella compare nella barra progetti come progetto aperto, senza altri passaggi. |
| EXT-006 | attivo, approvato | I file esterni con anteprima la mantengono come nei progetti: Markdown, Mermaid e HTML. | `schema.mmd` e `pagina.html` aperti da fuori → l'anteprima è disponibile come per i file di un progetto. |
| EXT-007 | attivo, approvato | L'agente può lavorare sui file esterni: la sessione parte nella cartella di lavoro del file (vedi EXT-008) e può leggere e modificare il file senza chiedere altri permessi. L'apertura del file da parte dell'utente vale come consenso. | Aprire `Download/config.json` e chiedere in chat di correggerlo → l'agente lavora in `Download/` e modifica il file. |
| EXT-008 | attivo, approvato il 2026-11-08 | La cartella di lavoro di un file esterno è la radice del repository git che lo contiene; se il file non sta in un repository, è la cartella che lo contiene. Vale sia per "Apri cartella come progetto" (EXT-005) sia per l'agente (EXT-007). Fonte: utente, «La radice del repository git». | `C:/repo/altro/src/lib/a.ts` aperto da fuori → "Apri cartella come progetto" registra `C:/repo/altro`; `Download/x.txt` → `Download/`. |
| EXT-009 | attivo, approvato il 2026-11-08 | Una sessione agente per ogni cartella di lavoro: cambiando tab tra file di cartelle diverse cambia anche la chat, e nessuna sessione vede le cartelle delle altre. Fonte: utente, «Una sessione per cartella». | Aperti `Download/a.md` e `Documenti/b.md` → due chat distinte; passando da una tab all'altra si passa da una chat all'altra. |
| EXT-010 | attivo, approvato il 2026-11-08 | Le tab di File esterni si ripristinano al riavvio come quelle dei progetti; quelle di file che non esistono più vengono tolte. Fonte: utente, «Sì, come nei progetti». | Chiudere Studio con due file esterni aperti e cancellarne uno → al riavvio resta solo la tab dell'altro. |
| EXT-011 | attivo, approvato il 2026-11-08 | Se un altro programma modifica un file aperto in Studio, la tab si ricarica da sola quando non ci sono modifiche non salvate; altrimenti compare un avviso per scegliere quale versione tenere. Vale per i file esterni e per i file dei progetti. Fonte: utente, «Ricarica automatica se non ci sono modifiche non salvate, altrimenti avviso». | File aperto senza modifiche, salvato da Blocco note → Studio mostra il nuovo testo. Con modifiche non salvate → avviso, nessuna perdita. |
| EXT-012 | attivo, approvato il 2026-11-08 | Estensioni registrate per "Apri con…": testo, documenti e configurazione (txt, md, mmd, json, jsonc, yaml, yml, toml, ini, xml, csv, log, html, css, svg, env) più il codice sorgente (ts, js, svelte, py, rs, vb, cs, sql, sh, bat, ps1 e simili). Fonte: utente, «Quelle sopra più il codice sorgente». | `script.py` e `config.yaml` hanno Studio tra le voci di "Apri con". |

## Domande aperte

Nessuna al 2026-11-08.

## Verifiche

| Data | Requisiti | Scenario e risultato | Prova |
|---|---|---|---|
| 2026-11-08 | EXT-002, EXT-003, EXT-008 | Test Rust `external_open::tests`: dagli argomenti restano solo i file esistenti (flag e cartelle scartati); un file dentro due radici aperte va nella più interna; fuori dalle radici la cartella di lavoro è la radice git, altrimenti la cartella del file; cartelle e file mancanti sono rifiutati. Superato (4/4). | `cargo test --lib external_open`, sessione corrente. |
| 2026-11-08 | EXT-001, EXT-012 | Gli hook NSIS (`src-tauri/windows/hooks.nsh`) compilati con `makensis` 3.13 in uno script che riproduce l'ordine del template di Tauri: le variabili `MAINBINARYNAME` e `PRODUCTNAME` vengono risolte e le chiavi scritte sono solo `OpenWithProgids`, il ProgId `OMPStudio.File` e `Applications\omp-studio-app.exe`, nessuna scrittura del valore predefinito di `.<ext>`. Config macOS letta da `cargo check` senza errori. Superato. | Script temporaneo (rimosso), sessione corrente. |
| 2026-11-08 | EXT-003, EXT-004, EXT-005, EXT-010 | `test/external-files.test.ts`: la cartella esterna nasce con `external: true` e viene riusata per lo stesso percorso; `openProject` e «Apri cartella come progetto» la promuovono; schede aperte e chiuse, la cartella resta anche senza schede; esclusa dalle tessere normali e dai metadati dei progetti registrati. `npm run check`: 0 errori. `npm test`: 1413 superati, 0 falliti. | Sessione corrente. |
| 2026-11-08 | EXT-011 | Test Rust `file_watch`: modifica di un file in una cartella temporanea ricevuta dal watcher, filtro degli eventi, unione dei percorsi di più editor. `test/file-reload-decision.test.ts`: contenuto uguale all'ultimo caricamento → ignora (copre i salvataggi di Studio); file pulito → ricarica; file con modifiche → avviso; file cancellato → stato dedicato; stessi esiti al ritorno su una scheda o su un progetto non osservati nel frattempo. Superato. | Sessione corrente. |
| 2026-11-08 | EXT-006 | Traccia del codice: Markdown e HTML leggono il file tramite `file_read`/`preview_file` con la cartella di lavoro come radice, senza requisiti di git. Per `.mmd`/`.mermaid` l'anteprima non esisteva neanche nei progetti: aggiunta all'editor con codice/divisa/anteprima e messaggio d'errore sulla sintassi non valida (`computeMermaidPreviewState` testata con input valido, non valido e vuoto). Superato. | Sessione corrente. |
| 2026-11-08 | EXT-007, EXT-009 | Traccia del codice: la sessione si crea per progetto e corsia (`sessionRegistry.ts`) con cwd = cartella di lavoro, e `omp` parte con `--cwd`. Per le cartelle esterne restano esclusi task, worktree, regole di anteprima e automazioni; menu corsie, coda, regole e scheda Progetto nascosti; scheda Git solo se la cartella è un repository. Test: `openPaths` passa alla Principale quando il file sta nella cartella principale e la corsia attiva è un worktree. `npm run check` 0 errori, `npm test` 1422 superati. | Sessione corrente. |

Ancora da verificare sulla prima Nightly (le regole del repo vietano di avviare l'app desktop): la voce «Apri con» su Windows e su macOS, l'avvio a freddo con un file, l'inoltro alla finestra già aperta.
