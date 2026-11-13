# Requisiti — Browser Studio

Registro dei requisiti concordati con l'utente. Decisione e alternative scartate: `docs/DECISIONS.md`, «Gate R23 sospeso: Chromium posseduto da Studio». La specifica tecnica storica (S38-S47) è `docs/BROWSER-STUDIO.md`.

| ID | Requisito | Fonte | Scenario | Stato |
|---|---|---|---|---|
| BRW-001 | La pagina mostrata nella colonna centrale è nativa e interattiva (clic, tastiera, scorrimento, selezione, appunti, IME), non un'immagine trasmessa. | 2026-11-12: «a me di guardare un video invece di una pagina interattiva non potrà mai essere utile! serve assolutamente che sia tutto interagibile» | L'utente apre una pagina, seleziona testo, lo copia, scrive in un campo con accenti: tutto si comporta come in un browser. | attivo |
| BRW-002 | L'agente pilota la stessa pagina con pieno controllo e riceve il feedback del tool, come con il tool `browser` standard di `omp`. | 2026-11-12: «serve anche che l'agente abbia pieno controllo e ottenga feedback da strumento come fa col browser normale» | L'agente naviga, clicca, compila, legge console e screenshot della pagina che l'utente vede, senza finestre esterne. | attivo |
| BRW-003 | macOS ha lo stesso livello di funzione di Windows. | 2026-11-12: «almeno Mac mi interessa allo stesso livello» | Gli scenari BRW-001 e BRW-002 passano su Windows e su macOS. | attivo |
| BRW-004 | Anteprima (`studio_preview`), Laboratorio e siti veri usano un solo motore browser. | 2026-11-12: «perché dovremmo fare 3 interfacce e strumenti diversi di browser tra anteprima, prototipo lab e questo?»; scelta «tutto nel Chromium gestito» | Un prototipo del Lab e un'anteprima si aprono nella stessa superficie dei siti e l'agente li collauda con il tool `browser`. | attivo |
| BRW-005 | Nessuna modifica al runtime `omp`: si usa solo ciò che offre l'`omp` pubblico (es. `browser.cdpUrl`). | 2026-11-12: scelta «Studio avvia Chromium… il runtime non va toccato» | Con l'`omp` installato dall'utente, senza build personalizzate, BRW-002 funziona. | attivo |

## Verifiche

| Data | Scenario | Risultato | Prova |
|---|---|---|---|
| — | — | Nessuna verifica ancora eseguita: prova Tauri 3 + CEF da fare in corsia. | — |
