# Catalogo Comandi di Studio e Allineamento OMP

Questo documento descrive l'architettura del catalogo dei comandi, il layout personalizzabile del composer e il protocollo operativo per gli agenti quando una nuova release di `omp` introduce comandi nuovi o rimuove comandi esistenti.

---

## 1. Architettura del Catalogo

Il catalogo comandi e' la fonte di verita' per:
1. La schermata **Impostazioni > Comandi**: documentazione consultabile, ricerca e personalizzazione dei pin nel composer.
2. Il menu di autocompletamento slash (`/`) del composer.
3. I pulsanti e i chip fissati (pin) nelle barre del composer.
4. Il gate automatico di pubblicazione (`npm run check:commands`).

### Struttura del Manifesto

Il manifesto risiede in `src/lib/agent/commandCatalog/manifest/` ed e' suddiviso in file tematici aggregati da `index.ts`:

- `controls.ts`: controlli nativi del composer con id `ctl.*` (allegato, ruolo, modello, thinking, contesto, costo, limite, menzione). Origin: `'control'`.
- `omp-modes.ts`: modalita' operative, modelli ed esecuzione di `omp` (es. `fast`, `slow`, `prewalk`, `ratchet`, `advisor`, `effort`, `model`). Origin: `'omp'`.
- `omp-session.ts`: gestione sessione, strumenti, contesto e utilita' di `omp` (es. `compact`, `handoff`, `session`, `mcp`, `ssh`, `tools`). Origin: `'omp'`.
- `studio.ts`: comandi esclusivi del guscio Studio (es. `/tasks`, `/lanes`, `/lab`). Origin: `'studio'`. Se un comando esiste gia' come builtin di omp, la voce e' unica ed e' gestita nei file `omp-*.ts`.
  `fork` e `tree` sono voci Studio anche se omp ha comandi con lo stesso nome: in omp sono solo-TUI (non arrivano da `get_available_commands`), nella GUI Studio li serve con i comandi RPC `fork` e `get_tree` (Gate R33). `/sessions` e' alias di `/resume`; l'instradamento di questi comandi sta in `src/lib/agent/slashRouter.ts`.
  Anche `plan` e `plan-review` sono voci Studio: in omp sono solo-TUI, nella GUI li serve l'estensione `studio-plan` (Gate R3X-plan). Il comando di trasporto `/studio-plan` e' nascosto dalla palette (`HIDDEN_EXTENSION_COMMANDS` in `commands.ts`) e non ha voce nel catalogo.
  `btw` e' una voce Studio per lo stesso motivo: in omp `/btw` e' solo-TUI e in RPC il testo arriverebbe al modello principale come prompt; nella GUI Studio la serve con i comandi RPC `btw`, `btw_cancel` e `get_btw_history` (Gate R3X-btw). Il pulsante «A margine» del composer e' fisso (non e' un pin del layout) e compare solo se omp risponde a `get_btw_history`; la voce del catalogo si puo' fissare sotto il composer.

Ogni voce rispetta il tipo `CommandManifestEntry`:
- `id`: nome dello slash senza barra per i comandi (es. `prewalk`); prefisso `ctl.*` per i controlli del composer.
- `origin`: `'omp' | 'studio' | 'control'`.
- `category`: categoria funzionale (`modes`, `models`, `context`, `session`, `workspace`, `tools`, `extensions`, `info`, `security`, `app`).
- `icon`: nome di un'icona esportata da `src/lib/icons.ts` (es. `IconFast`, `IconShield`). Vietato importare direttamente da `@lucide/svelte`.
- `control`: modalita' di interazione (`toggle`, `picker`, `action`, `panel`, `readout`, `none`).
- `supported`: array di posizioni permesse (`zone`: `'toolbar' | 'statusLine'`, `form`: `'icon' | 'chip'`).
- `defaultPlacement`: posizione predefinita di fabbrica (deve appartenere a `supported`) oppure `null` per non fissato.
- `locked`: `true` esclusivamente per i controlli essenziali (`ctl.attach`, `ctl.role`, `ctl.model`, `ctl.thinking`) che l'utente non puo' rimuovere.
- `text`: testi bilingui in-line (`{ it: CommandText, en: CommandText }`) con titolo leggibile, sommario, vantaggi puntati, esempi con comando digitato e nota esplicativa, e nota opzionale `whenToUse`.

### Layout e Zone del Composer

Il layout del composer comprende due zone:
- `toolbar`: la barra interna del campo di testo del composer (`.composer-toolbar`).
- `statusLine`: la riga informativa inferiore (`ComposerStatusLine.svelte`).

Il modulo puro `src/lib/agent/commandCatalog/layout.ts` gestisce il layout:
- `resolveLayout(saved, manifest)`: calcola il layout effettivo da disegnare scartando id sconosciuti e posizioni non supportate, garantendo che i controlli `locked` siano sempre presenti.
- **Preservazione orfani**: il layout salvato nelle impostazioni conserva anche gli id sconosciuti (comandi di una versione piu' recente o dismessi). In questo modo, se un comando riappare o se l'utente apre un profilo condiviso, nessun pin viene distrutto accidentalmente.
- Le azioni `action` fissate nel composer eseguono lo slash command tramite la stessa pipeline di digitazione manuale (`routeComposerSubmit`).

---

## 2. Rilevamento Automatico dei Comandi (`npm run check:commands`)

Ad ogni pubblicazione locale (Nightly) o rilascio di una versione stabile, viene eseguito:

```bash
npm run check:commands
```

Lo script `scripts/check-commands.mjs`:
1. Individua il binario `omp` (`--bin`, `OMP_BIN`, o lookup nei percorsi standard `~/.bun/bin/omp`, `$HOME/.omp/bin/omp`, PATH).
2. Spawna `omp --mode rpc --no-session` e invia su `stdin` la richiesta NDJSON:
   ```json
   {"type":"get_available_commands","id":"1"}
   ```
3. Legge la risposta entro un timeout di sicurezza (20s) e termina pulitamente il processo figlio senza lasciare processi orfani.
4. Filtra i comandi con `source: "builtin"`.
5. Carica tutte le voci con `origin: 'omp'` dal manifesto (`src/lib/agent/commandCatalog/manifest/index.ts`).
6. Identifica:
   - **Nuovi**: comandi builtin di `omp` senza corrispondente voce nel manifesto.
   - **Spariti**: voci con `origin: 'omp'` nel manifesto che `omp` non espone piu'.
7. Se allineato: termina con codice `0`.
8. Se disallineato: termina con codice `1`, stampa un riepilogo nel terminale e scrive il report completo in `ricerca/commands-pending.json`.

---

## 3. Procedura per l'Agente quando il Controllo Fallisce

Quando `npm run check:commands` (o il gate in `publish-nightly.mjs` / `release.mjs`) fallisce, la pubblicazione viene immediatamente interrotta.

L'agente deve seguire tassativamente i seguenti passaggi:

### Passo A — Lettura del report pendente
Leggi il file generato:
```bash
ricerca/commands-pending.json
```
Esamina l'elenco dei comandi in `newCommands` e `missingCommands` insieme alla versione `ompVersion`.

### Passo B — Raccolta documentazione
Per ogni nuovo comando identificato:
1. Esamina il record grezzo (`name`, `description`, `input.hint`, `subcommands`).
2. Consulta la documentazione interna di `omp` (`read omp://...`, consultando i file elencati da `omp://`), i file di CHANGELOG di `omp` o le note di rilascio ufficiali.
3. Se necessario, effettua ricerche mirate senza inventare comportamenti: se il comando ha dettagli limitati, mantieni la descrizione fedele a quella ufficiale di `omp`.

### Passo C — Bozza della voce `CommandManifestEntry`
Costruisci la voce completa:
- Scegli la categoria adatta (`modes`, `models`, `context`, `session`, `workspace`, `tools`, `extensions`, `info`, `security`).
- Scegli un'icona gia' presente in `src/lib/icons.ts` (es. `IconShield`, `IconTerminal`, `IconSparkles`). Se serve una nuova icona, selezionala da `@lucide/svelte` e registrala in `src/lib/icons.ts`.
- Scegli `control`: solitamente `'action'` per comandi lanciabili una tantum, `'toggle'` per opzioni on/off con stato, `'none'` se solo da menu slash.
- Definisci `supported`: es. `[{ zone: 'statusLine', form: 'chip' }]` o vuoto `[]` se solo catalogo.
- `defaultPlacement`: `null` per quasi tutti i comandi (solo pochissimi controlli chiave hanno pin di fabbrica).
- Testi bilingui completi (`it` ed `en`) per ogni campo:
  - `title`: nome chiaro di 2-3 parole.
  - `summary`: frase concisa che spiega lo scopo.
  - `benefits`: 1-3 vantaggi concreti.
  - `examples`: 1-3 esempi reali con `{ command: '/...', note: '...' }`.
  - `whenToUse`: indicazione pratica su quando usarlo.

### Passo D — Presentazione all'utente con il tool `ask`
Presenta la proposta all'utente usando il tool `ask` per ottenere la conferma:
- Mostra il riepilogo dei comandi nuovi e spariti.
- Riassumi le posizioni proposte (`supported` e `defaultPlacement`) e l'esempio principale.
- Chiedi conferma esplicita prima di modificare il codice sorgente del manifesto.

### Passo E — Aggiornamento del manifesto
Dopo aver ricevuto l'ok:
1. Se sono state aggiunte nuove icone, registrale in `src/lib/icons.ts` ed esegui `npm run check:icons`.
2. Aggiungi le voci nel file corretto:
   - `src/lib/agent/commandCatalog/manifest/omp-modes.ts` per modalita' e modelli;
   - `src/lib/agent/commandCatalog/manifest/omp-session.ts` per sessione, strumenti e contesto.
3. Per i comandi **spariti**: rimuovi la voce dal manifesto. Avvisa l'utente che eventuali layout salvati manterranno l'id come orfano ma non verra' disegnato.

### Passo F — Riesecuzione del controllo e ripresa della pubblicazione
1. Riesegui il controllo:
   ```bash
   npm run check:commands
   ```
2. Assicurati che termini con codice `0` (`[PASS]`).
3. Riprendi la procedura di pubblicazione (Nightly o Release) dal punto in cui era stata sospesa.

---

## 4. Testi copiati da omp da ricontrollare a ogni release

Alcune funzioni della GUI replicano un flusso che omp offre solo nella TUI e ne copiano i prompt. Il gate dei comandi non li vede: a ogni release (o nightly) che aggiorna la versione di riferimento di omp, confronta questi file con il sorgente upstream e riallinea le copie.

| Copia in Studio | Originale in oh-my-pi (`packages/coding-agent/src/`) | Versione copiata |
| --- | --- | --- |
| `PLAN_MODE_ACTIVE_PROMPT` in `extensions/studio-plan.ts` | `prompts/system/plan-mode-active.md` (adattato: `resolve { action: "apply" }` → `studio_plan_submit`) | 18.8.4 |
| `PLAN_MODE_SUBAGENT_PROMPT` in `extensions/studio-plan.ts` | `prompts/system/plan-mode-subagent.md` | 18.8.4 |
| prompt d'esecuzione e istruzioni di compattazione in `src/lib/agent/planMode.ts` | `prompts/system/plan-mode-approved.md`, `plan-mode-compact-instructions.md` | 18.8.4 |
| `planSaveFileName` (estensione e `planMode.ts`), `normalizePlanSlug` e `resolveLocalRoot` (estensione) | `plan-mode/plan-autosave.ts`, `plan-mode/plan-files.ts`, radice di `local://` | 18.8.4 |

Procedura: `git diff` dei file upstream tra la versione copiata e quella nuova; se cambiano, aggiorna la copia mantenendo l'adattamento, aggiorna la colonna «Versione copiata» qui e nell'intestazione dei file, rilancia `test/plan-mode.test.ts`. Se omp introduce un comando RPC `plan` (o una richiesta UI `plan_review`), apri invece una decisione per sostituire l'estensione.

## 5. Flag di Emergenza (`--skip-command-check`)

In casi straordinari in cui e' necessario pubblicare immediatamente una fix critica senza aggiornare contestualmente il catalogo, sia `publish-nightly.mjs` che `release.mjs` accettano il flag:

```bash
node scripts/publish-nightly.mjs --skip-command-check
npm run release -- <versione> --skip-command-check
```

L'uso di questo flag emette un avviso visibile nel terminale e non deve essere usato come prassi ordinaria.
