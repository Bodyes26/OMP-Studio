# Albero dei file — registro dei requisiti

| ID | Stato | Fonte | Scenario concreto |
|---|---|---|---|
| FT-001 | Attivo, approvato | 2026-11-24, utente: «va bene» alla proposta **Tratto** nell’anteprima `proto/filetree-delete-gestures.html`. | Cestina un file visibile dal menu dell’albero: solo dopo il successo il nome viene depennato in rosso e le righe sottostanti risalgono in 240 ms complessivi. La riga in uscita non è navigabile. Se il cestinamento fallisce non parte alcuna animazione. Con animazioni disattivate in Studio o movimento ridotto di sistema la rimozione resta istantanea. |

## Verifiche

| Data | ID | Esito e prova |
|---|---|---|
| 2026-11-24 | FT-001 | Smoke Chromium con `FileTree.svelte` e menu contestuale reali, IPC isolato: nessuna animazione prima della risposta; al successo il tratto è completo prima della risalita, la riga in uscita è inerte e poi rimossa. Al fallimento la riga resta e mostra l’errore. Rimozione istantanea con preferenza Studio e media query di sistema. `npm run check`: 0 errori, 7 avvisi in file non modificati. |
