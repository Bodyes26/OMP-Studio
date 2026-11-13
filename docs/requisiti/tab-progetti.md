# Tab progetti — popover e interazioni

## Stato e fonti

Discussione del 2026-11-12/13, domande Q1–Q27 della sessione corrente. Il 2026-11-13 l'utente conferma separatamente tutte le rimozioni (Q26) e risponde **«Confermo la specifica e autorizzo l'implementazione completa nell'app, con verifiche dei percorsi reali»** (Q27, `approve_and_implement`). Dopo il timeout della proposta di isolamento sceglie esplicitamente la **Principale**.

Il prototipo esplorativo è `proto/project-tabs-interaction.html` (non versionato). La storia delle revisioni e delle decisioni è nel diario di progetto. Il prototipo usa dati in memoria e operazioni simulate: non è codice da trasferire integralmente nell'app.

Per tutti gli ID sotto: stato **attivo** salvo diversa indicazione. Implementazione Svelte integrata nella Principale il 2026-11-13; verifiche di tipi, regressioni e smoke UI registrate sotto. La copertura è **parziale**, non una certificazione end-to-end di ogni scenario desktop/nativo; approvazione, implementazione e prova restano distinte.

Motivazione iniziale, utente 2026-11-12: «il popover compare all'hover ma i menu dentro si aprono solo al click [...] non ho più il mouse sopra e quindi si chiude subito». Obiettivo: ridurre il sovraccarico e rendere stabili e prevedibili le interazioni.

## Apertura, continuità e gerarchia

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-001 | Q1, 2026-11-12, proposta approvata: «sì il consigliato» | Separare anteprima informativa all'hover e menu operativo persistente. Il click normale sul tab seleziona il progetto; tre puntini o click destro aprono i comandi. Uscire col mouse non chiude il menu operativo. Esc e click esterno lo chiudono, rispettando prima i controlli figli aperti. |
| TPR-002 | Q3–Q4, 2026-11-12: «solo all'hover della parte del nome progetto» | L'area dei tre puntini non attiva l'anteprima. Tab compatti; tre puntini sempre visibili e cliccabili senza un bersaglio minuscolo. L'hover della parte nome ha angoli destri squadrati contro il divisore. |
| TPR-003 | Q4, 2026-11-12: «la stessa card/popover che si sposta [...] e il contenuto che si aggiorna»; Q4 approvata | Una sola card informativa si sposta tra i tab senza ripetere smontaggio/ingresso per ogni progetto. Ritardo alla prima comparsa, transizione breve nei passaggi successivi; nessun furto del focus all'hover. |
| TPR-004 | Q4, 2026-11-12: «lo stesso effetto deve esserci anche col popover completo» | Anche click destro o tre puntini su un altro progetto spostano la card operativa già aperta aggiornandone il contenuto. Il click destro non deve prima chiudere la card durante il pointerdown. Gli stati del vecchio progetto non vengono applicati al nuovo. |
| TPR-005 | Q5, 2026-11-12, approvazione `keep`; Q8–Q9 | Coda, Git e Corsie/prototipi sono viste interne della stessa card, senza menu laterali. Passaggi avanti/indietro e variazioni di altezza animati; nessuna scrollbar temporanea durante la transizione. Scorrimento normale disponibile al termine per gli elenchi lunghi. |
| TPR-006 | Q8, 2026-11-12: «la x [...] deve restare fissa in alto a destra» | Chiusura della card indipendente dal titolo e dai contenuti animati, sempre in alto a destra. Layout, focus, hover e movimento rispettano il design system esistente in tema chiaro/scuro e movimento ridotto. Lo switch tema esterno è solo uno strumento del prototipo, non una nuova preferenza locale del popover nell'app. |

## Identità e menu principale

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-007 | Q2, 2026-11-12: «sigla e titolo [...] cliccandoli diventano subito modificabili e si salva al volo»; Q6 approvata | Sigla e titolo modificabili sul posto. Invio o uscita dal campo salvano; Esc annulla la modifica corrente. Sigla centrata nel badge. Conservare i contratti reali di nome/sigla: limiti dimostrativi del prototipo non introducono nuove restrizioni nell'app. |
| TPR-008 | Q5–Q6, 2026-11-12; Q6: «color picker e colori consigliati con una opzione random [...] per il tema» | Colore integrato nella testata accanto a sigla/titolo, non come voce separata nel menu. Palette inline con apertura e chiusura animate: selettore tinta, consigliati per il tema, scelta casuale tra i consigliati e modalità automatica. Applicazione immediata. Il modello reale conserva una tinta; luminosità/croma seguono il tema, senza promettere un RGB arbitrario che non sarebbe conservato. |
| TPR-009 | Q2 e Q6, 2026-11-12: «tilde per [...] percorso [...] impostato [...] per i suoi progetti» | `~` indica la radice progetti configurata dall'utente, non la home di sistema. Mostrare le sottocartelle relative; fuori dalla radice mostrare il percorso completo. Percorso sottolineato che apre la cartella, senza fondo grigio all'hover; tooltip esplicativo. Icona Copia accanto, senza chiudere la card. |
| TPR-010 | Q2, 2026-11-12: «nuovo task [...] apre la scheda nuovo task [...] va bene così» | Nuovo task resta diretto nel menu principale e apre il Task Editor esistente per il progetto scelto. Nessun secondo form nel popover. |
| TPR-011 | Q22–Q23, 2026-11-13, proposta approvata `direct` | Automazioni chiude il popover e apre la vista esistente già filtrata sul progetto selezionato, senza sottovista, riepilogo o secondo editor dentro la card. |

## Coda del progetto

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-012 | Q7, 2026-11-12; Q18, 2026-11-13 | Avvio automatico in alto, switch piccolo e allineato verticalmente alla label, senza spiegazione permanente; tooltip facoltativo. Click sulla label attiva lo switch, come per Riprendi chat. |
| TPR-013 | Q7: «solo titolo, badge modello»; Q8, 2026-11-12: «deve avere il logo del provider» | Ogni task mostra titolo e badge modello con logo provider corretto. Nessun corpo del prompt o elenco di direttive aggiuntivo in questa vista rapida. Dati del modello risolti dai contratti reali della coda, senza inventare provider/modelli mancanti. |
| TPR-014 | Q7, 2026-11-12, quattro azioni richieste; Q9 approvata 2026-11-13 | Quattro pulsanti sempre disponibili come icone: Avvia, Avvia su nuovo worktree, Modifica, Programma. All'hover o focus l'azione si espande mostrando il testo, le altre scorrono/riducono lo spazio senza spostare titolo e badge. Etichette accessibili anche quando visivamente nascoste. |
| TPR-015 | Q7, 2026-11-12 | Entrambi gli avvii operano in background; Ctrl/Cmd + click segue il lavoro aprendo il progetto/corsia corretti. Modifica apre il progetto e il task nel Task Editor esistente. Conservare gate, limiti e motivi di blocco dell'avvio reale. |
| TPR-016 | Q7: «come da coda normale»; Q8–Q9 | Programma riusa il controllo esistente: reset quota quando disponibile, orari rapidi, orario personalizzato e rimozione programmazione. Popover figlio appartenente alla card: interagirvi non chiude il genitore; Esc chiude prima il figlio. Conservare la semantica reale: programmazione esplicita anche con avvio automatico spento. |
| TPR-017 | Q7, 2026-11-12: «Niente nuovo task [...] niente tutte le code» | Nessun Nuovo task o Tutte le code nella vista Coda, piena o vuota. Nuovo task resta nel menu principale; la vista aggregata delle code resta disponibile altrove nell'app. Stato vuoto semplice, senza azioni duplicate. |

## Git

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-018 | Q10, 2026-11-12, ambito approvato; Q14–Q15, 2026-11-13 | Riepilogo Git della Principale, esplicitamente identificata: branch effettivo e upstream, conteggi in arrivo/in uscita oppure Aggiornato, breve elenco dei commit da ricevere con titolo/hash. Nessun elenco worktree sotto: appartiene a Corsie/prototipi. |
| TPR-019 | Q13, 2026-11-13: «vedo sempre e solo il mio branch che ho selezionato»; Q14 `checkout`, Q15 approvata | Nome branch cliccabile, selettore degli altri branch. La scelta esegue un vero checkout della Principale, non una sola ispezione. La fonte del branch è Git stesso: chiudere/riaprire la card o Studio mostra il branch effettivo, senza una preferenza separata potenzialmente divergente. |
| TPR-020 | Q14, 2026-11-13, proposta di sicurezza approvata | Cambio branch non disponibile mentre l'agente della Principale lavora o è in corso una sincronizzazione. Branch occupato in un altro worktree non selezionabile; modifiche incompatibili/errori segnalati senza cambiare branch. Nessuno stash/reset automatico introdotto dal restyle. |
| TPR-021 | Q10 e Q14, proposta approvata | Scarica aggiornamenti usa il pull fast-forward esistente sul branch effettivo della Principale. Conservare blocchi per agente occupato, sincronizzazione, modifiche locali e commit locali da gestire; motivo leggibile. Stato in corso, esito ed errore nella card. Nessun commit/push o gestione conflitti aggiuntiva nel popover. |
| TPR-022 | Q10, proposta approvata | Distinguere caricamento, errore di lettura, nessun upstream e aggiornato. Dati mancanti non diventano Aggiornato. Il risultato asincrono di un progetto non modifica la vista di un altro progetto selezionato nel frattempo. |

## Corsie e prototipi

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-023 | Q16, 2026-11-13, proposta `open_and_closed` approvata | Nuovo worktree e Nuovo prototipo in alto. Riutilizzare i flussi esistenti, inclusa revisione del profilo tecnico quando richiesta e i requisiti Lab registrati in `laboratorio.md`. Nessun secondo form di creazione nel popover. |
| TPR-024 | Q16–Q18, 2026-11-13 | Sezioni Aperte e Chiuse nella stessa card. Aperte: nome, branch per worktree o indicazione Laboratorio, stato agente. Chiuse: nome, tipo/branch e data relativa. Apertura/riapertura sull'intera riga, selezionando progetto e corsia corretti. Stati vuoti distinti; scorrimento se necessario. |
| TPR-025 | Q17–Q18: «icona dei lab [...] quella dei lab» e rilievi su hover/divisori | Usare IconLab originale. Hover visibile e graduale su creazione, righe e azioni; padding coerente. Nessun divisore che sporga dal fondo hover arrotondato. Niente divisori tra righe; un solo separatore prima della preferenza finale. |
| TPR-026 | Q16 approvata; Q18, 2026-11-13 | Riprendi chat nelle nuove corsie conserva la preferenza esistente, con switch compatto, tooltip e label cliccabile. Non introduce un cambio di modello o una nuova sessione Lab estranea al flusso esistente. |
| TPR-027 | Q19–Q21, 2026-11-13: «sulla stessa riga [...] Sei sicuro? [...] bottom bar [...] dopo 5 secondi» | Il cestino delle chiuse trasforma la stessa riga: titolo nascosto, icona conservata, domanda, Elimina e Annulla; barra inferiore di 5 secondi. Nessun riquadro sotto né schermata separata. Alla scadenza annulla, non elimina, e ripristina animando. Annulla, Esc, chiusura del popover e cambio progetto interrompono la conferma. Nessuna variazione dell'altezza delle altre righe. |
| TPR-028 | Q20, 2026-11-13, scelta `inline_loss_details` | Per lavoro non integrato restare sulla stessa riga ma mostrare esplicitamente la perdita al posto del solo Sei sicuro?, ad esempio Perdi 2 commit. Il consenso è riferito alla corsia e ai dati correnti; conservare la rilettura/protezione esistente se il lavoro da perdere cambia. Mai interpretare un'ispezione fallita come assenza di lavoro. |
| TPR-029 | Q16 e Q20–Q21 | Eliminazione definitiva solo dopo conferma esplicita entro la finestra valida. Processi attivi, workspace bloccato o altri fallimenti mantengono la voce e mostrano l'esito; nessuna falsa eliminazione riuscita. Conservare le garanzie esistenti di rimozione worktree/branch e di prototipo/revisioni. |
| TPR-030 | Q21, 2026-11-13: «opzione per i branch aperti di chiuderli [...] finestra di merge [...] chiudendo i prototipi lab» | X sulle aperte: worktree apre la finestra esistente Revisiona e integra, senza merge o chiusura automatica; Lab chiude reversibilmente e compare tra le chiuse, senza eliminare lavoro/revisioni. Cestino delle chiuse separato dalla X delle aperte. |

## Riordino e chiusura progetto

| ID | Fonte | Requisito e scenario concreto |
|---|---|---|
| TPR-031 | Q2, 2026-11-12; Q23, 2026-11-13 | Frecce direttamente nel menu, senza sottovista. Disabilitare ai rispettivi estremi. Con ordinamento automatico non cambiare silenziosamente la preferenza: frecce disabilitate con spiegazione che serve ordine manuale. |
| TPR-032 | Q24–Q25, 2026-11-13: «resta fermo finché tengo il mouse [...] se vado [...] su un'altra voce [...] aspetti lì fermo» | Dopo riordino la card resta nella posizione corrente mentre il puntatore è nel popover, anche passando alle altre azioni/viste per interagire. Uscendo col mouse si riallinea subito al tab. Nessun timer. Click esterno o su altro tab chiude la vecchia card; un'apertura esplicita su un altro tab segue poi le regole normali. Focus/tastiera non devono produrre un inseguimento dei controlli. |
| TPR-033 | Q23, 2026-11-13, proposta `preserve` approvata | Chiudi progetto richiama il flusso centrale esistente, indipendente dalla durata del popover. Fermo senza coda: diretto. Coda: conserva/scarta/chiedi secondo preferenza. Agente al lavoro: conferma esplicita prima di interrompere. Automazioni attive: scelta esplicita di lasciarle proseguire, interromperle o annullare. Nessuna eliminazione dei file/worktree dalla semplice chiusura del progetto. |
| TPR-039 | 2026-11-13: «il movimento delle tab dei progetti in top bar quando si premono le frecce per spostare è da animare» | Spostando un progetto con le frecce del menu, le schede coinvolte scivolano dalla vecchia alla nuova posizione invece di saltare. Stessa animazione dopo il rilascio di un trascinamento. Durata e curva come il riordino della coda (210 ms, `revealEase`); con movimento ridotto (sistema o impostazioni di Studio) lo spostamento è immediato. |

## Cutover delle azioni e confini

| ID | Funzione attuale | Destinazione/esito concordato | Fonte |
|---|---|---|---|
| TPR-034 | Apri terminale / Apri editor esterno nel popover | Rimuovere le due scorciatoie da questo menu; non eliminare le capacità corrispondenti dell'app. | Q2, 2026-11-12: «le togliamo che non servono». Conferma dedicata Q26 del 2026-11-13: entrambe le rimozioni `yes`. |
| TPR-035 | Chiudi altri progetti nel popover | Rimuovere la voce e la relativa sottovista da questo menu. Non sostituirla con un'altra azione collettiva. | Q2, 2026-11-12: «lo rimuoviamo lasciamo solo chiudi progetto». Conferma dedicata Q26 del 2026-11-13: `remove_close_others: yes`. |
| TPR-036 | Nuovo task / Tutte le code nella vista Coda | Togliere questi collegamenti dalla sola vista interna: Nuovo task resta nel menu principale, coda aggregata nelle superfici/scorciatoie esistenti. | Q7, 2026-11-12; conferma dedicata Q26 del 2026-11-13: `remove_queue_duplicate_links: yes`. |
| TPR-037 | Colore sempre visibile / riordino e chiusura mescolati a molti comandi | Colore nella testata con espansione inline; frecce e Chiudi progetto diretti. | Q2, Q5–Q6, Q23. |
| TPR-038 | Stati speciali e flussi esistenti non riprodotti nella demo ordinaria | Conservare accesso alla richiesta agente in attesa, associazione di una bozza Lab al progetto e comportamento appropriato di Appunti, bozze Lab e file esterni. Non offrire comandi Git/coda/worktree dove non applicabili. Nessuna rimozione implicita di queste capacità dal refactoring. | Baseline: `ProjectPopover.svelte` (attentionReq, associate, isScratchpad, isDraft) e contratti correnti dei progetti; vincolo confermato nella specifica completa Q27 del 2026-11-13. |

### Decisioni sostituite (storia, non requisiti operativi)

- Il riepilogo worktree sotto Git, approvato in Q12, è sostituito da TPR-018/019 dopo la correzione esplicita Q13–Q15. Worktree in Corsie/prototipi, selettore Git come vero checkout.
- La conferma di eliminazione sotto la riga è sostituita da TPR-027/028 dopo la precisazione Q19–Q21.
- L'attesa di 2 secondi dopo il riordino è sostituita da TPR-032 con Q24–Q25. Non implementare il vecchio timer.

## Confini tecnici dell'implementazione

- Implementare nello stack Svelte 5 esistente; la pagina HTML esplorativa non sostituisce store, gate, dispatcher, scheduler o servizi nativi.
- Preservare un'unica superficie tra aggiornamenti del progetto selezionato: non crearne una per tab né forzare un remount per riprodurre l'animazione.
- Unificare proprietà dei menu figli, gestione del focus, chiusura esterna ed Esc; non duplicare controlli di programmazione, creazione, revisione/merge e chiusura progetto.
- Catturare progetto/corsia/branch destinatari prima delle operazioni asincrone; non aggiornare la card di un destinatario diverso né trasferire una conferma distruttiva ad altra voce.
- Checkbox di conferma, conteggi e limiti del prototipo non sono contratti nuovi: usare i dati e le garanzie reali. Nessun dato demo o esito simulato deve entrare nell'app.

### Integrazione

- `TopBar.svelte` governa anteprima e apertura esplicita; `ProjectPopover.svelte` mantiene la card e le viste senza rimontarla al cambio destinatario. `anchoredPopover.ts` accetta la posizione fissata fino all'uscita del puntatore.
- `ProjectQueueView.svelte`, `ProjectGitView.svelte` e `ProjectLanesView.svelte` usano gli store e i servizi esistenti. La rotta principale inoltra avvio/worktree al dispatcher e X worktree a `LaneReviewModal`; la chiusura progetto resta nel flusso centrale esistente.
- `ScheduleMenu.svelte` conserva il focus prima di sostituire la voce con il campo orario: `focusout` non deve interpretare la sostituzione come uscita dal menu. I tooltip delle azioni delle corsie sono laterali per non coprire il cestino della riga adiacente.
- La conferma distruttiva rilegge la perdita; un conteggio maggiore o una lettura non più verificabile richiedono nuovo consenso. Scadenza e annullamento non eliminano nulla; la scadenza ripristina il focus solo se era ancora nella riga.

## Registro delle verifiche

| Data | Scenario/prova | Risultato osservato | Limite |
|---|---|---|---|
| 2026-11-12/13 | Revisioni `studio_preview` di `proto/project-tabs-interaction.html`, catture di testata, Coda, Git e Corsie, sessione corrente | Anteprime renderizzate senza errori JavaScript dichiarati dallo strumento; osservate le catture restituite. Utente ha provato e approvato le interazioni con le correzioni registrate sopra. | Dati, sessioni, Git, filesystem e navigazioni nativi simulati. Non prova di checkout, pull, scheduling, avvio, merge o eliminazione reali. |
| 2026-11-13 | TPR-032, ultima revisione senza timer, approvazione Q25 | Utente approva esplicitamente la permanenza guidata dal puntatore. | Al momento di questa sola approvazione il componente di produzione non era implementato; vedere lo smoke successivo. |
| 2026-11-13 | `npm run check`, stato finale del codice | **0 errori, 7 warning** in AskCard, AutomationWizard e splitter preesistenti della rotta. Prova: `artifact://582`. | Controllo tipi, non verifica del runtime nativo. |
| 2026-11-13 | `npm test -- --prepared --file project-tab-metadata.test.ts --file schedule-reset.test.ts --file lanes-dispatch.test.ts --file lanes-cleanup.test.ts` | **61 test superati**, 24 suite, 0 falliti. Prova: `artifact://544`. | Regressioni mirate di metadati, scheduling, routing e cleanup; non l'intero desktop. |
| 2026-11-13 | TPR-001–006/007–011/031–032: componenti reali via Vite in Chromium, tre progetti fixture | Hover in sola lettura; tre puntini, click destro e Invio; medesima card DOM tra destinatari; sigla salvata e nome annullato con Esc; `~/alpha` e `~/gamma`; riordino mantiene posizione anche entrando in Coda e si riallinea uscendo. Catture IT/EN e chiaro/scuro osservate. | Scenari estesi di movimento ridotto, percorsi esterni alla radice e impostazioni desktop non eseguiti. Prova locale: `ricerca/tab-progetti-verifica-2026-11-13.json`. |
| 2026-11-13 | TPR-012–017: switch e `ScheduleMenu` reali, avvii registrati dall'harness | Label cliccabile; preset e orario **18:45** salvati senza chiudere la card; Esc chiude prima il figlio. Callback worktree: destinatario Alpha, background e Beta resta attivo; Ctrl+Avvia passa `follow: true` e chiude. | Nessun agente reale avviato: callback registrate. Non prova dell'intero TaskEditor o di un provider live. |
| 2026-11-13 | TPR-018–022: Git effettivo su repository isolati, con bridge IPC di prova | Checkout `feature/login`, `fix/export` senza upstream e ritorno a `main`; branch occupati dalle corsie disabilitati; pull fast-forward porta `behind` da **1 a 0**. | Git reale, ma non backend Rust/Tauri; gate agente attivo/dirty, errori remoti e riavvio desktop non eseguiti nella nuova vista. |
| 2026-11-13 | TPR-023–030: elenchi reali su fixture, switch, richiesta revisione, conferma e filesystem | Sole aperte/sole chiuse/entrambe; label ripresa chat cliccabile; X worktree emette revisione del destinatario corretto. Conferma nella stessa riga DOM: scade dopo **5064 ms**, conserva voce e ripristina focus. Nuovo commit richiede consenso aggiornato a **2 commit**; lettura fallita richiede consenso alla perdita non verificabile. Consenso esplicito rimuove worktree fixture e riga. | Il bridge esegue Git/filesystem solo nelle fixture. Revisione registrata senza montare la modale; creazione/riapertura e chiusura native Lab, processi attivi e merge non eseguiti. |
| 2026-11-13 | TPR-039: `TopBar.svelte` reale via Vite in Chromium, bridge Tauri di prova, quattro progetti fixture, «Move the tile right» su alpha | Posizioni campionate: alpha 126→156→177→178 px, beta 247→176→130→126 px a 60/110/260 ms; 2 animazioni attive durante il movimento, 0 al termine. `npm run check`: 0 errori. | Movimento ridotto e trascinamento non eseguiti nel browser; desktop nativo non avviato. |

## Scenari di accettazione estesi

La copertura parziale è descritta nel registro sopra; i seguenti insiemi **non sono tutti completati end-to-end**. Non chiudere i requisiti sulla sola base dei collegamenti o dei test di tipi. Separare verifica visuale, store e operazioni native; per le prove distruttive usare esclusivamente repository/worktree/task isolati.

1. TPR-001–006: attraversare tre tab con hover e con aperture esplicite; provare tre puntini, click destro e tastiera, menu figli, Esc e click fuori; osservare card unica, focus e assenza di scrollbar temporanee in entrambi i temi e con movimento ridotto.
2. TPR-007–011: rinominare/sigla con salvataggio e annullamento, scegliere colore automatico/consigliato/casuale/tinta; percorso dentro/fuori radice, copia e apertura cartella; Nuovo task e Automazioni sul progetto non attivo.
3. TPR-012–017: task con modello esplicito e di sessione, coda vuota/lunga, quattro azioni con mouse/tastiera, avvio normale/worktree in background e con Ctrl/Cmd, modifica sul progetto corretto, programmazione e suoi blocchi reali.
4. TPR-018–022: repository di prova con più branch, nessun upstream, ahead/behind, dirty, agente attivo e branch occupato in altro worktree. Checkout reale, riapertura/riavvio e pull devono riferirsi al branch effettivo; nessun effetto su branch/file incompatibili.
5. TPR-023–030: progetto con solo aperte, solo chiuse, entrambe, nessuna; Git e Lab; creazione dai flussi esistenti; apertura/riapertura; X worktree apre revisione senza integrare, X Lab chiude senza eliminare; conferma di eliminazione sulla stessa riga, timeout, Esc, cambio progetto, perdita nota/variata, processi attivi ed errore.
6. TPR-031–033: click rapidi ripetuti sulle frecce, passaggio ad altre voci senza movimento della card, uscita del puntatore, click esterno/altro tab, tastiera, estremi e ordine automatico. Chiusura con coda vuota/piena, preferenze diverse, agente/automazioni attivi e annullamento.
7. TPR-034–038: verificare il cutover delle sole azioni concordate e i casi richiesta agente, Appunti, bozza Lab associabile e file esterni, senza regressioni di capacità o comandi inapplicabili.
