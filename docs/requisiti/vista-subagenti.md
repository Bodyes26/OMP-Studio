# Vista dei subagenti — registro dei requisiti

## Stato del documento

Requisiti approvati il 2026-11-28 (risposta dell'utente via `ask`) e implementati lo stesso giorno contro omp 18.x, che nel `progress` di ogni subagente invia `resolvedModel` (selettore `provider/modello`), `resolvedThinkingLevel`, `resolvedModelIsFallback`, `contextTokens`/`contextWindow`, `cost` e `retryState`.

## Fonte

Utente, 2026-11-28: «dobbiamo rivedere la vista subagenti per renderla più informativa, va bene il nome e cosa sta facendo, serve però vedere almeno sicuro provider e modello in uso per ogni subagente, poi non so se altro».
Scelte nel modulo `ask` dello stesso giorno: livello di ragionamento, avviso di ripiego, tipo di agente, occupazione del contesto, costo, stato di retry; provider con nome leggibile; applicazione a vassoio, traccia in chat e cassetto. Scartati: ruolo modello, token consumati, avanzamento dichiarato.

## Requisiti

| ID | Stato | Requisito | Scenario concreto |
|---|---|---|---|
| VSUB-001 | approvato / implementato | Ogni riga di subagente mantiene nome e attività corrente e aggiunge una riga di metadati con provider (nome leggibile, es. «Anthropic», «ChatGPT») e modello effettivamente in uso (`resolvedModel`). Prima che omp risolva il modello la riga non inventa valori. | Un subagente `ReviewAuth` su `anthropic/claude-sonnet-4-5` mostra sotto il nome «Anthropic · claude-sonnet-4-5». |
| VSUB-002 | approvato / implementato | La riga di metadati mostra il livello di ragionamento (`resolvedThinkingLevel`) quando noto. | Subagente con effort `high` → «… · high». |
| VSUB-003 | approvato / implementato | Se omp segnala che il modello è un ripiego (`resolvedModelIsFallback`), la riga lo evidenzia con un'etichetta di avviso. | Il modello richiesto non è disponibile e omp usa un fallback: compare «ripiego». |
| VSUB-004 | approvato / implementato | Il tipo di agente (`agent`: task, scout, reviewer…) compare quando è diverso dal nome mostrato. | Subagente `ReviewAuth` di tipo `reviewer` → «reviewer» fra i metadati; un subagente chiamato `scout` di tipo `scout` non lo ripete. |
| VSUB-005 | approvato / implementato | Occupazione del contesto in percentuale (`contextTokens / contextWindow`) con i valori assoluti nel tooltip. | 76.000 token su 200.000 → «38% contesto». |
| VSUB-006 | approvato / implementato | Costo del singolo subagente quando maggiore di zero. | «$0.21». |
| VSUB-007 | approvato / implementato | Durante un retry automatico (`retryState`) la riga mostra «riprova N/M» con l'errore nel tooltip; a retry concluso l'etichetta sparisce. | Errore 529 del provider: «riprova 2/3»; al successo l'etichetta non resta appesa. |
| VSUB-008 | approvato / implementato | Le stesse informazioni compaiono nel vassoio sopra il composer, nella traccia espandibile dei subagenti in chat e nell'intestazione del cassetto del transcript. Nella traccia il nome mostrato è l'identità del subagente, come nel vassoio, e il tipo passa fra i metadati. | Aprendo il cassetto di `ReviewAuth` l'intestazione mostra provider, modello e gli altri metadati sotto il nome. |

## Verifiche

| Data | Requisiti | Scenario | Esito | Prova |
|---|---|---|---|---|
| 2026-11-28 | VSUB-001…007 | Derivazione dei metadati da `AgentProgress` (selettore con slash annidati, ripiego, contesto, costo, retry solo in esecuzione, tipo uguale al nome) | superata | `npm test` (`test/subagent-model.test.ts`) |
| — | VSUB-001…008 | Subagenti reali nell'app desktop: vassoio, traccia e cassetto | da verificare dall'utente | — |
