# Anteprime dell'agente (`studio_preview`) — registro dei requisiti

Ambito: le anteprime HTML che l'agente crea e apre nel progetto con `studio_preview` (`proto/*.html`). Esclusi i prototipi del Laboratorio (`docs/requisiti/laboratorio.md`).

## Fonte e direzione approvata

2026-11-02, utente: «voglio impostare un minimo di linee guida di design quando l'agente crea un'anteprima» e «l'agente tende sempre a voler controllare l'anteprima quando l'ha fatta, possiamo fornire da studio qualcosa di utile per non fargli perdere tempo».

Evidenza raccolta: ContrattiImmobili 2026-10-22, dopo ogni anteprima l'agente ha letto la documentazione del browser, avviato `python -m http.server` e fatto screenshot desktop+mobile (una sola volta su tre ha trovato un errore reale: escape `\uXXXX` mostrati letterali nel JSX). GestioneStorni 2026-10-20, todo dedicato «Verificare switch, ricerca e selezione nel browser». ContrattiImmobili 2026-10-27, giudizio dell'utente sullo stile dell'anteprima: «tanto "ai slop"».

2026-11-02, utente, scelte sulla proposta:
- linee guida: «un file preview.md che si crea in automatico quando si apre un progetto e contiene le stesse regole di design.md e product.md di default, ricopiate pari pari. Mostrando quel file nella sezione agente/regole, l'utente se vuole delle regole diverse di design per le anteprime può farlo senza per forza modificare anche il suo design.md e product.md»;
- regole fisse: «la prima ok ma con questo file che abbiamo detto, la seconda ok, la terza ok ma non solo italiano dipende da lingua di sistema, la quarta dipende dalle regole del progetto non è detto, la quinta ok la sesta dipende dalla richiesta la settima ok la ottava ok»;
- verifica: «Esito + errori + screenshot a richiesta»;
- tecnologia: «HTML + token se c'è DESIGN.md».

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| ANT-001 | attivo, approvato | Studio crea in automatico `.omp/preview.md` all'apertura di un progetto, solo se manca. Contenuto iniziale: `DESIGN.md` e `PRODUCT.md` del progetto ricopiati alla lettera; se mancano entrambi, un modello minimo. Dopo la creazione il file è dell'utente: Studio non lo riscrive. | Progetto con `DESIGN.md` e `PRODUCT.md`: alla prima apertura compare `.omp/preview.md` con i due testi; modificandolo, una riapertura non lo sovrascrive. |
| ANT-002 | attivo, approvato | `.omp/preview.md` compare nella sezione Agente → Regole e si apre nell'editor per modificarlo. | L'utente cambia una regola delle anteprime senza toccare `DESIGN.md`. |
| ANT-003 | attivo, approvato | Prima della prima anteprima della sessione l'agente legge `.omp/preview.md` e ne applica token, font, icone e regole. | Anteprima in Cruscotto PSR con i colori e le icone del progetto, non la palette generica. |
| ANT-004 | attivo, approvato | Quando l'anteprima ridisegna una UI esistente, l'agente parte dal markup e CSS reali e mostra Attuale/Proposta affiancati o con un selettore. | Ridisegno di una card esistente confrontabile con l'originale. |
| ANT-005 | attivo, approvato | Dati dimostrativi realistici nella lingua dell'interfaccia di Studio, mai lorem ipsum. | Studio in inglese: nomi, date e importi dell'anteprima in inglese. |
| ANT-006 | attivo, approvato | Niente gradienti decorativi, glassmorphism, emoji, bordi laterali colorati, pulsanti a pillola, salvo che `.omp/preview.md` li preveda. | Anteprima senza decorazioni generiche. |
| ANT-007 | attivo, approvato | Caratteri reali (à, €) nel testo, non escape `\uXXXX`. | Il testo accentato appare corretto nell'anteprima. |
| ANT-008 | attivo, approvato | Dopo l'anteprima l'agente non apre browser, server o screenshot per controllarla: indica cosa guardare e chiede un parere. | Nessun `http.server` o `browser.open` dopo `studio_preview`. |
| ANT-009 | attivo, approvato | Lo strumento aspetta che Studio abbia davvero mostrato l'anteprima e restituisce l'esito con gli errori JavaScript (messaggio e posizione), anche per documenti HTML completi e anche se l'utente sta guardando un'altra superficie. Se Studio non conferma entro il limite, lo dice senza invitare a verificare nel browser. | Un errore di sintassi JSX torna nel risultato dello strumento e l'agente lo corregge senza aprire il browser. |
| ANT-010 | attivo, approvato | Parametro facoltativo `snapshot`: lo strumento restituisce anche un'immagine dell'anteprima renderizzata. | L'agente chiede `snapshot: true` per valutare un layout e riceve l'immagine nel risultato. |
| ANT-011 | attivo, approvato | Se `.omp/preview.md` contiene token di design, l'anteprima si scrive in HTML/CSS con quei token; altrimenti React + Tailwind è ammesso. | Progetto con `DESIGN.md`: anteprima HTML con le variabili CSS del progetto. |
| ANT-012 | attivo, approvato il 2026-11-05 | `Ctrl+Tab` cambia progetto anche con il focus dentro l'anteprima HTML, senza clic sul composer; il bridge mantiene anche `Ctrl+Shift+Tab` per la corsia e rispetta le guardie sui dialoghi del guscio. Fonte: utente, «devo cliccare sul composer o un'altra parte della finestra di studio per farglielo prendere è molto fastidioso». | Clic su un campo nell'anteprima, poi `Ctrl+Tab`: passa al progetto successivo senza clic intermedi. Lo stesso bridge è usato dall'anteprima del Laboratorio. |

Proposte non approvate come regole fisse (2026-11-02): densità e assenza di eyebrow/sottotitoli («dipende dalle regole del progetto»), numero massimo di varianti («dipende dalla richiesta»).

## Verifiche

| Data | Requisiti | Scenario e risultato | Prova |
|---|---|---|---|
| 2026-11-02 | ANT-001 | Test Rust `ensure_preview_rules_*`: copia letterale da radice e da `docs/`, modello quando mancano entrambi, nessuna sovrascrittura di un file esistente. Superato (20/20 in `previews` e `rules_ops`). | `cargo test --lib -- previews rules_ops`, sessione 01a19c54. |
| 2026-11-02 | ANT-003, 005…008, 011 | Estensione caricata con un `pi` simulato: la descrizione indica il percorso assoluto di `.omp/preview.md`, «Realistic demo data in Italian» con `OMP_STUDIO_LOCALE=it`, divieto di browser/server/screenshot. Superato. | Script temporaneo (rimosso), output nella sessione 01a19c54. |
| 2026-11-02 | ANT-009 | Strumento reale con ack simulato: esito positivo in 515 ms (testo + immagine), errori con `line 5:9` e `isError`, timeout a 8 s senza invito al browser; nessun file ack residuo. Superato. | Come sopra. |
| 2026-11-02 | ANT-009, ANT-010 | Harness reale in Chromium, iframe `sandbox="allow-scripts"` con la CSP di `preview_server.rs`: HTML completo con errore → riga 5 colonna 9 (riga vera del file); JSX con errore di sintassi → messaggio Babel con il punto esatto; HTML e React corretti → ok con snapshot PNG leggibile («Città €», «Totale 1 €»). Superato dopo due correzioni emerse dal test: `html2canvas` falliva nella sandbox a origine opaca (sostituito da `html-to-image`); l'iframe fuori schermo bloccava lo snapshot (ora nel viewport con `opacity: 0`). | Pagine temporanee in `ricerca/smoke-harness/`, screenshot nella sessione. |
| 2026-11-02 | tutti | `npm run check`: 0 errori. `npm test`: 1383 passati, 0 falliti. `npm run check:commands`: superato. | Sessione 01a19c54. |
| 2026-11-05 | ANT-012 | Chromium con iframe reale `sandbox="allow-scripts"`: prima del fix Ctrl+Tab lascia il progetto A; dopo il fix passa a B dal campo dell'anteprima, Ctrl+Shift+Tab passa alla corsia feature, il campo resta scrivibile e un messaggio contraffatto dalla finestra padre è ignorato. Anche il documento del generatore Laboratorio passa a B da un campo interno e resta scrivibile. Smoke sui generatori e sul bridge reali, gestore di cambio progetto/corsia simulato. `npm run check`: 0 errori, 6 avvisi in file non modificati. Nessuna seconda istanza desktop avviata. | Harness browser temporaneo in memoria e output di `npm run check`, sessione corrente. |

Limiti della verifica: nessuna istanza desktop avviata (regola del repo), quindi non sono stati osservati nell'app reale l'host di rendering montato in `+page.svelte`, la voce in Agente → Regole e la creazione all'attivazione del progetto. Restano da verificare alla prima build: ANT-001/002 aprendo un progetto senza `.omp/preview.md`, ANT-009 con l'utente su un'altra superficie, ANT-010 con Studio ridotto a icona (WebView2 può rallentare i timer: in quel caso lo strumento risponde «non confermato»).
