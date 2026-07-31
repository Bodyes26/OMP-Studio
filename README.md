# omp-studio-app

Shell desktop multi-progetto per l'agente `omp`: terminale integrato, albero dei file,
editor Monaco con diff Git, elenco sessioni e pannello consumi.
Costruita con Tauri 2, SvelteKit e TypeScript.

## Sviluppo

```
npm install
npm run tauri dev     # app desktop
npm run dev           # solo frontend (le invoke Tauri non rispondono)
npm run check         # typecheck Svelte/TS
npm run tauri:cdp     # app desktop + DevTools remoti su 127.0.0.1:9222
```

`tauri:cdp` serve solo a ispezionare la webview da fuori: apre un canale di controllo
locale non autenticato, quindi la porta non è nella configurazione spedita e vive solo
in quel comando, come variabile d'ambiente di WebView2.

## Versionamento e release

La versione vive in `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`
e va cambiata solo tramite lo script, che li allinea tutti e chiude la sezione
`[Unreleased]` del [CHANGELOG](CHANGELOG.md):

```
npm run release -- 0.2.0            # bump + voce di changelog datata
node scripts/release.mjs --notes    # note dell'ultima versione, per gh release
```

Le regole di lavoro (controllo git obbligatorio, protocollo di bump della versione,
convenzioni di codice) sono in [AGENTS.md](AGENTS.md).

## Documentazione

`docs/`: [PRODUCT](docs/PRODUCT.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[DESIGN](docs/DESIGN.md) · [PLAN](docs/PLAN.md) · [IDEAS](docs/IDEAS.md) ·
[DECISIONS](docs/DECISIONS.md) · [SHORTCUTS](docs/SHORTCUTS.md)

## IDE

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Contributi

Nessuno: è un progetto personale, pubblicato in sola lettura. Le pull request
vengono chiuse in automatico. Il codice è MIT, quindi il fork è la strada giusta —
prendilo e portalo dove vuoi.

## Licenza

[MIT](LICENSE).
