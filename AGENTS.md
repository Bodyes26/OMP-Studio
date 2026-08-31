# Regole di progetto — omp-studio-app

Valgono per ogni agente e per ogni modifica al codice di questo repository.

## Struttura

- **Tutto** vive in questo repo: codice (`src/`, `src-tauri/`) e documentazione (`docs/`).
  Non creare cartelle di progetto fuori dal repo. L'unica cartella dentro il repo che
  resta fuori da git è `ricerca/`, e serve esattamente a questo: tenere in locale gli
  appunti che non devono diventare pubblici.
- `docs/`: `PRODUCT.md`, `ARCHITECTURE.md`, `DESIGN.md`, `PLAN.md`, `IDEAS.md`,
  `DECISIONS.md`, `SHORTCUTS.md`.
- `ricerca/`: appunti di ricerca, documentazione di indagini e script di lavoro.
  **Non versionata** (`.gitignore`): resta in locale e non finisce nel repo pubblico.
- `assets/`: **sorgenti** degli asset, non spediti nell'app. `app-icon.png` e
  `app-icon-dark.png` sono gli originali da cui si generano le icone;
  `logo-topbar.svg` è il vettoriale originale del logo.
- `static/`: solo asset **spediti** nell'app, alla dimensione in cui servono.
  Niente originali qui: `static/` finisce dentro il bundle.

### Asset: regole

- Prima di aggiungere un'immagine a `static/`, guarda a quale dimensione viene
  mostrata e generala a quella dimensione (con un margine 3x per il DPI scaling).
  Il logo della barra superiore si mostra a 22–28px: `static/logo-topbar.png` è un
  raster 96px da 3 KB, non l'SVG originale da 1,7 MB (356 tracciati, ~30.000
  segmenti bézier, ognuno più piccolo di 1/2000 di pixel a quella dimensione).
- Le icone dell'applicazione si rigenerano dall'originale con il comando npm:
  `npm run tauri -- icon assets/app-icon.png`. Genera anche icone mobili iOS/Android che
  questa app desktop non usa: tenere in `src-tauri/icons/` **solo** i file
  elencati in `bundle.icon` di `tauri.conf.json` (inclusi `icon.ico` per Windows e `icon.icns` per macOS).

## 1. Ogni modifica va controllata con git

Prima di toccare un file:

```
git status --short <percorsi che toccherai>
git diff -- <percorsi che toccherai>
```

Il working tree contiene **spesso modifiche non committate dell'utente**. Regole:

- NON usare `git stash`, `git checkout --`, `git restore`, `git reset` su file con
  modifiche non committate: cancellano lavoro dell'utente. Se serve confrontare col
  passato, usa `git show HEAD:<file>` e leggilo, senza toccare il working tree.
- NON committare né taggare senza richiesta esplicita, e mai `git add -A`/`git commit -a`:
  metterebbero dentro lavoro in corso dell'utente. Se committi, elenca i percorsi
  esatti (`git add <file1> <file2>`).
- A fine lavoro mostra `git status --short` e `git diff --stat` dei soli file toccati,
  così la modifica è ispezionabile.

## 2. Versioning: chiedere sempre a fine modifica

La versione è in **quattro file** che devono restare allineati:
`package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.
Non modificarli a mano: usa `npm run release -- <versione>`.

Il changelog è `CHANGELOG.md` (formato *Keep a Changelog*, versioning *SemVer*).
La sezione `## [Unreleased]` è il **parcheggio**: ogni lavoro finito ma non ancora
rilasciato si annota lì subito, con la sua voce.

### Protocollo obbligatorio a fine di ogni modifica al codice

1. Verifica che la modifica funzioni (smoke test / test mirato).
2. Aggiungi la voce sotto `## [Unreleased]` nella categoria giusta
   (`Added`, `Changed`, `Fixed`, `Removed`).
3. **Chiedi all'utente cosa pubblicare usando sempre il tool `ask`** (MAI solo come testo in chat), proponendo le opzioni nell'ordine:
   - **A — Pubblica Nightly (predefinita)** (`recommended: 0`): non cambia la versione stabile e
     lascia il changelog in `[Unreleased]`. L'agente committa i soli percorsi
     del lavoro, esegue il push su `main`, esegue `npm run nightly` (build locale
     rapida per l'OS in uso) e verifica la prerelease `nightly` con installer e
     `nightly.json`.
   - **B — Rilascia stabile ora**: bump della versione indicata (per un fix:
     patch, es. `1.1.0 → 1.1.1`). L'agente esegue autonomamente bump, commit,
     tag annotato, push e verifica degli installer pubblicati.
   - **C — Parcheggia**: resta in `[Unreleased]`, senza commit o pubblicazione.
   - **D — Versione stabile specifica**: l'utente indica il numero (o tramite opzione libera del tool `ask`); alla
     conferma l'agente esegue l'intera pipeline fino alla verifica degli
     installer pubblicati.
   Includi sempre la proposta predefinita **A** (`recommended: 0`), la bozza della voce di
   changelog e l'indicazione che Nightly non chiude `[Unreleased]`.
4. Non fare mai commit, push o bump senza risposta esplicita. Se l'utente non
   risponde, il lavoro resta parcheggiato.
### Criteri di numerazione (pre-1.0)

| Tipo di lavoro | Bump |
|---|---|
| Bugfix, correzione rendering, tuning | patch (`0.1.0 → 0.1.1`) |
| Nuova funzionalità, nuovo pannello/comando, cambio comportamento visibile | minor (`0.1.x → 0.2.0`) |
| Riscrittura o cambio di paradigma dell'app | minor, con nota in `DECISIONS.md` |
| Solo documentazione, tooling, script di build | nessun bump, nessuna voce di changelog |

`1.0.0` è riservato alla prima pubblicazione stabile su GitHub.

## 3. Pubblicazione

### Nightly (predefinita)

La Nightly pubblica il commit corrente di `main` senza modificare i quattro file
di versione e senza chiudere `[Unreleased]`. La compilazione avviene in locale
per il sistema operativo in uso, sfruttando la cache di Cargo e Vite ed evitando
i tempi di attesa della doppia build in cloud:

```powershell
# 1. Commit dei soli percorsi del lavoro
git add <file1> <file2>
git commit -m "descrizione concisa"

# 2. Push su main
git push origin main

# 3. Build locale e aggiornamento prerelease GitHub
npm run nightly

# 4. Verifica
gh release view nightly --json assets,isPrerelease,name,tagName,url
```

La verifica è completa quando la prerelease `nightly` contiene l'installer del sistema
operativo in uso (es. `.exe` su Windows) e `nightly.json`. Per compilare la matrice
multipiattaforma completa in cloud è sempre possibile avviare manualmente
`gh workflow run nightly.yml --ref main`.
### Release stabile

```
npm run release -- --check          # valida allineamento perfetto dei 4 file di versione
npm run release -- 0.2.0            # bump dei 4 file + chiude [Unreleased] con data
node scripts/release.mjs --notes    # note dell'ultima versione rilasciata
```

Quando l'utente richiede o conferma il rilascio, l'agente esegue la pipeline:

```powershell
# 1. Bump versioni e chiusura changelog
npm run release -- 0.2.0

# 2. Estrazione note di release
{ echo v0.2.0; echo; node scripts/release.mjs --notes; } > .release-notes.md

# 3. Commit e tag; il push avvia il workflow multipiattaforma
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -F .release-notes.md
git push --follow-tags
```

`.github/workflows/release.yml` compila su runner separati:

- NSIS `.exe` per Windows x64;
- DMG universale (`aarch64` + `x86_64`) per macOS.

### Promozione da Release Candidate (RC) a Stabile

Per evitare discrepanze tra codice testato e codice pubblicato, se esiste una Release
Candidate (es. `v1.2.0-rc.1`), il workflow `release.yml` supporta la promozione diretta
degli installer compilati e firmati:

1. **Verifica di consistenza commit**: il job `resolve` controlla che il commit del
   tag stabile coincida esattamente con il commit della candidate. Se divergono,
   il workflow fallisce bloccando il rilascio.
2. **Riutilizzo artefatti**: con commit coincidente, gli installer (`.exe` e `.dmg`)
   vengono scaricati dalla candidate, rinominati alla versione stabile e verificati
   con generazione di `SHA256SUMS.txt`, senza rischiare ricompilazioni disallineate.
3. In assenza di candidate (o con `force_rebuild: true`), il workflow compila normalmente.

La release GitHub viene creata solo quando entrambi gli installer sono pronti (compilati o
promossi). L'agente attende il workflow e controlla con `gh release view v0.2.0 --json assets,url`
che i due installer siano presenti.
Per riparare una release già esistente, avvia manualmente lo stesso workflow indicando il tag:
il job ricompila o ri-promuove e carica gli asset con `--clobber`.
Le note si estraggono con `node scripts/release.mjs --notes`, **non** con
`npm run release -- --notes`: npm aggiunge il proprio banner allo stdout e finirebbe
dentro il messaggio del tag.
Le voci di changelog sono **rivolte all'utente finale**: cosa cambia per chi usa
l'app, non quali file sono stati toccati. Una riga per cambiamento, in italiano,
all'imperativo/indicativo presente.

## 4. Convenzioni di codice

- Commenti in italiano, senza accenti nei file `.ts`/`.rs` già esistenti che li evitano;
  spiegano il **perché**, non il cosa.
- Svelte 5 con rune (`$state`, `$derived`, `$effect`, `$props`). Niente `onMount` per
  agganciare nodi DOM condizionali: usa un `$effect` sul nodo (vedi `src/lib/editor/Editor.svelte`).
- Stack di font per canvas (xterm, Monaco) sempre **letterali**: `var(--font-mono)`
  non viene risolto in `ctx.font`.
- Verifica prima di dichiarare fatto: `npm run check` per i tipi, `cargo check --manifest-path src-tauri/Cargo.toml` per il backend Rust se modificato, e uno smoke test reale del percorso modificato.

## 5. Comandi canonici di build, verifica e ambiente (usare npm)

Tutti i comandi bash devono rispettare l'ambiente Windows della workstation (usare forward slash `/` nei percorsi, evitare variabili `%VAR%` o comandi interni CMD come `dir /s`):

- **Frontend — Controllo tipi**:
  `npm run check` (esegue automaticamente `svelte-kit sync` prima di `svelte-check`; non usare `npx svelte-check` isolato).
- **Frontend — Compilazione produzione**:
  `npm run build` (esegue Vite con la corretta allocazione di memoria Node).
- **Smoke test e unit test**:
  `npm test` (oppure `npm run test:smoke`: esegue la suite automatizzata su protocollo wire, parsing/serializzazione task store, percorsi Windows/POSIX; non invocare `node --test` direttamente sui file `.ts`).
- **Backend Rust**:
  `cargo check --manifest-path src-tauri/Cargo.toml` per verificare la compilazione.
  `cargo test --manifest-path src-tauri/Cargo.toml` per i test unitari.
  **Non eseguire `cargo fmt --check` globale**: il workspace `src-tauri` contiene file preesistenti con stili disallineati; eseguire rustfmt solo sui file specifici modificati.
- **Tauri CLI**:
  Usare sempre lo script npm delegato: `npm run tauri -- <comando>` (es. `npm run tauri -- icon assets/app-icon.png`, `npm run tauri -- dev`). Non usare `npx tauri` (fallisce in ambiente Windows/Bun con `could not determine executable`).
- **File locking Windows**:
  Non tentare di eliminare o sovrascrivere file `.exe` o artefatti di build mentre l'applicazione OMP Studio o altri processi correlati sono in esecuzione.

## 6. Esplorazione e ricerca: delega Subagent-First

Per preservare le quote dei modelli primari (es. Claude Opus, GPT-5.6 Sol) durante le fasi di discussione, analisi e pianificazione:

- **Mai esplorazioni massive sul modello principale**: quando l'indagine richiede di esaminare più di 2 file o effettuare ricerche `grep` diffuse, delegare l'indagine a uno o più subagenti `scout` tramite il tool `task`.
- Lo scout effettua le letture e restituisce un estratto compatto. Il modello principale effettua la sintesi decisionale e formula il piano in 1–2 turni compatti.
- In modalità discussione/pianificazione architetturale, non eseguire script di documentazione grafica (`impeccable`, `ui-ux-pro-max`) se non espressamente richiesto.
