# Ordine delle colonne — registro dei requisiti

## Stato del documento

Requisiti approvati il 2026-11-08 nella stessa conversazione in cui sono stati implementati. La prova sull'app desktop è stata fatta dall'utente il 2026-11-09 («ho provato tutto funziona»).

Supera, per la sola posizione delle colonne, l'ordine fisso «file | editor | agente» dato per scontato in DECISIONS.md (W08) e DESIGN.md: i tre ruoli restano gli stessi, cambia solo dove stanno.

## Fonte

Utente, 2026-11-08: «Dobbiamo anche permettere di spostare le colonne di studio, cioè per esempio invertire la colonna con le chat con la colonna con l'editor.»

Scelte dell'utente nella stessa data, via `ask`: ordine libero delle 3 colonne; si cambia da un'impostazione (la palette comandi dell'app non esiste, quindi niente comando); l'ordine è globale, non per progetto.

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| COL-001 | attivo | Le tre colonne (barra laterale File/Git/Agente, editor, chat/terminale) si dispongono in uno qualsiasi dei 6 ordini. | Ordine «file \| chat \| editor»: la chat sta al centro, l'editor a destra. |
| COL-002 | attivo | L'ordine si sceglie in Impostazioni → Aspetto, spostando ogni colonna a sinistra o a destra, con ripristino dell'ordine predefinito. | Clic su «Sposta a sinistra» della chat con l'ordine predefinito: l'ordine diventa «file \| chat \| editor». |
| COL-003 | attivo | L'ordine è una preferenza globale: cambiare progetto, corsia o branch non sposta le colonne. | Con «chat al centro», passare a un altro progetto lascia la chat al centro. |
| COL-004 | attivo | Le misure seguono la colonna, non la posizione: dopo uno spostamento barra laterale ed editor mantengono larghezza (e in verticale l'editor la sua altezza). Le misure salvate prima della funzione restano valide. | Editor largo 700 px, poi scambio con la chat: l'editor resta largo 700 px a destra. |
| COL-005 | attivo | Ogni divisore ridimensiona la colonna a misura fissa accanto (barra laterale o editor) e si muove nel verso del trascinamento e delle frecce; la chat prende lo spazio restante. | Editor a destra: trascinare a sinistra il suo divisore allarga l'editor. |
| COL-006 | attivo | In modalità verticale la barra laterale sta a destra se è l'ultima nell'ordine, altrimenti a sinistra; editor e chat si impilano nell'ordine relativo scelto (il primo sopra). | Ordine «chat \| editor \| file» in verticale: file a destra, chat sopra, editor sotto. |
| COL-007 | attivo | Con la barra laterale a destra, la sua animazione di chiusura e l'icona del pulsante in alto seguono il lato destro. | Ordine «editor \| chat \| file»: il pulsante mostra l'icona del pannello destro. |
| COL-008 | attivo | La vista Automazioni mantiene la sua disposizione fissa, indipendente dall'ordine scelto. | Con chat al centro, aprire Automazioni mostra elenco a sinistra e sessione a destra come prima. |

Limite noto: l'ordine di tabulazione resta quello del DOM (barra laterale, editor, chat). Riordinare il DOM rimonterebbe Monaco e i terminali a ogni cambio.

## Verifiche

| Data | Requisiti | Scenario | Esito | Prova |
|---|---|---|---|---|
| 2026-11-08 | COL-001, COL-004, COL-005, COL-006 | Le 6 permutazioni in orizzontale e in verticale: 5 tracce senza sovrapposizioni, divisore accanto alla sua colonna sul lato della chat, segno del trascinamento, misure legate al ruolo, griglia predefinita identica a prima | superata | `test/panel-geometry.test.ts` («Ordine delle colonne»), `npm test` 1427/1427 |
| 2026-11-08 | COL-005 | Frecce invertite quando la colonna sta dall'altro lato del divisore | superata | `test/panel-geometry.test.ts`, `npm test` |
| 2026-11-08 | COL-001, COL-004, COL-006 | Resa reale in Chromium dell'output di `panelPlacement` per le 12 disposizioni: nessuna sovrapposizione, divisori adiacenti, editor sempre largo 120 px (orizzontale) e alto 50 px (verticale) | superata | banco di prova usa e getta nel browser; l'app in Vite non si apre per l'errore `rune_outside_svelte` in `src/lib/externalOpen.ts`, estraneo a questa modifica |
| 2026-11-09 | COL-002, COL-003, COL-007, COL-008 | Percorso reale nell'app desktop: Impostazioni → Aspetto, cambio progetto, icona e animazione della barra a destra, vista Automazioni | superata | Utente, 2026-11-09: «ho provato tutto funziona». |
