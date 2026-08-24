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
- Le icone dell'applicazione si rigenerano dall'originale con un comando:
  `npx tauri icon assets/app-icon.png`. Genera anche icone iOS/Android/macOS che
  questa app (solo Windows) non usa: tenere in `src-tauri/icons/` **solo** i file
  elencati in `bundle.icon` di `tauri.conf.json`.

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
3. **Chiedi all'utente cosa fare della versione**, proponendo:
   - **A — Rilascia ora**: bump della versione indicata (per un fix: patch, es. `0.1.0 → 0.1.1`).
     Quando l'utente sceglie l'opzione di rilascio, **l'agente esegue autonomamente TUTTI i passaggi**:
     bump, commit, tag annotato e push. Il tag avvia `.github/workflows/release.yml`, che compila in
     parallelo l'installer Windows x64 e il DMG universale macOS e pubblica la release solo dopo il
     completamento di entrambi. L'agente attende il workflow e verifica gli asset della release.
   - **B — Parcheggia**: resta in `[Unreleased]`, si rilascia insieme al lavoro successivo.
   - **C — Versione specifica**: l'utente indica il numero (es. `0.2.0` per un blocco di lavori). Anche qui,
     alla conferma l'agente esegue l'intera pipeline fino alla verifica degli installer pubblicati.
   Includi sempre la proposta di default e la bozza della voce di changelog.
4. Non fare mai il bump di iniziativa propria: senza risposta, il default è **B (parcheggia)**.
### Criteri di numerazione (pre-1.0)

| Tipo di lavoro | Bump |
|---|---|
| Bugfix, correzione rendering, tuning | patch (`0.1.0 → 0.1.1`) |
| Nuova funzionalità, nuovo pannello/comando, cambio comportamento visibile | minor (`0.1.x → 0.2.0`) |
| Riscrittura o cambio di paradigma dell'app | minor, con nota in `DECISIONS.md` |
| Solo documentazione, tooling, script di build | nessun bump, nessuna voce di changelog |

`1.0.0` è riservato alla prima pubblicazione stabile su GitHub.

## 3. Rilascio

```
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

La release GitHub viene creata solo quando entrambi i build sono riusciti. L'agente attende il
workflow e controlla con `gh release view v0.2.0 --json assets,url` che i due installer siano presenti.
Per riparare una release già esistente, avvia manualmente lo stesso workflow indicando il tag:
il job ricompila entrambi i sistemi e carica gli asset con `--clobber`.
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
- Verifica prima di dichiarare fatto: `npx svelte-check --tsconfig ./tsconfig.json`
  per i tipi, e uno smoke test reale del percorso modificato.
