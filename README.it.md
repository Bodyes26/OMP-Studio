<div align="center">

<img src="assets/app-icon.png" alt="OMP Studio Logo" width="96" height="96" />

# OMP Studio

*Italiano: questo file · English: [README.md](README.md)*

**Il banco di lavoro desktop ad alte prestazioni per l'agente di coding `omp`.**
Workspace multi-progetto, doppia superficie Terminale / Chat GUI, editor Monaco con Git diff, sandbox visuali, orchestrazione dei task e monitoraggio in tempo reale delle quote AI.

[![GitHub Release](https://img.shields.io/github/v/release/Bodyes26/OMP-Studio?style=flat-square&color=crimson)](https://github.com/Bodyes26/OMP-Studio/releases)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/Bodyes26/OMP-Studio/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

<br />

<img src="assets/screenshots/screen_hero.png" alt="OMP Studio Workspace Overview" width="100%" />

<br /><br />

[Download](#-download-e-installazione) • [Funzionalità principali](#-funzionalità-principali) • [Screenshot](#-panoramica-visiva) • [Scorciatoie](#-scorciatoie-da-tastiera) • [Creato con OMP](#-creato-con-e-per-omp) • [Sviluppo](#-sviluppo-locale) • [Documentazione](docs/PRODUCT.md)

</div>

---

## 🎯 Panoramica

**OMP Studio** è un banco di lavoro desktop focalizzato e privo di distrazioni, progettato attorno all'agente di coding AI [`omp`](https://github.com/...).

Invece di imporre un singolo paradigma o avvolgere l'agente in livelli ridondanti, OMP Studio offre una **Doppia Superficie** cooperativa:

1. **Terminale nativo ad alte prestazioni**: Renderer Canvas `@xterm/xterm` con precisione al singolo pixel basato su ConPTY (Windows) e PTY POSIX (macOS), con Truecolor a 24 bit, legature Nerd Font integrate e streaming di byte a conversione zero.
2. **Chat GUI nativa**: Creata con Svelte 5 e trasporto RPC Rust (`omp --mode rpc-ui`), con alberi di ragionamento comprimibili, oltre 30 schede strumento strutturate, wizard interattivi di richiesta input (`ask`), percorsi file cliccabili, allegati immagine e un cursore di digitazione fluido.

Passa istantaneamente dal Terminale alla Chat GUI con **`Ctrl+Alt+A`** sulla **stessa identica sessione in esecuzione** senza alcuna perdita di stato.

---

## ✨ Funzionalità principali

- 🗂️ **Barra multi-progetto a zero attrito**: Passa da un repository aperto all'altro a latenza zero. I processi in background dell'agente continuano a funzionare senza interruzioni. Le tessere dei progetti riflettono in tempo reale lo stato dell'agente (spinner di lavoro, anello ambra di attesa input, inattivo) e il conteggio della coda task.
- ⚡ **Doppia superficie per l'agente (`TERMINAL | GUI`)**: Usa l'autentica TUI da terminale o la ricca GUI in Svelte 5. Pieno supporto per lo streaming markdown, l'incollo di immagini (`Ctrl+V`), i comandi slash (`/`) e l'ispezione dei sub-agenti.
- 📝 **Editor Monaco integrato e diff affiancato**: Ispeziona, modifica e verifica il codice toccato dall'agente. Pannello Git integrato con cambio branch, visualizzazione dei diff non committati e cronologia temporale delle sessioni.
- 📋 **Orchestrazione dei task di progetto (`.omp/tasks.json`)**: Code di task locali e persistenti condivise in tempo reale tra Studio e il comando `/tasks` da terminale. Include preset per i ruoli operativi (`plan`, `smol`, `default`, `slow`, `advisor`), cursore per il livello di ragionamento (thinking effort), allegati visivi ed esecuzione automatica dei task.
- 🎨 **Prototipazione visuale e whiteboard**:
  - **Sandbox UI (`studio_preview`)**: Rendering live istantaneo per componenti React/TSX e HTML con cambio reattivo del viewport (Desktop, Tablet, Mobile).
  - **Whiteboard Mermaid (`studio_diagram`)**: Diagrammi visuali di architettura zoomabili renderizzati direttamente nella colonna centrale.
- 📊 **Quote AI in tempo reale e intelligenza dei modelli**: Monitoraggio live delle quote su tutti i provider (`Ctrl+Alt+U`), sparkline con i trend delle ultime 24 ore, countdown al reset e un gestore integrato di Modelli e Ruoli (`Ctrl+Alt+M`) con catene di fallback automatiche.
- 📜 **Regole di contesto e motore anti-attrito**: Scheda Regole dedicata con l'elenco dei file di contesto del progetto (`AGENTS.md`, `.omp/rules/`, `CLAUDE.md`) e delle skill installate. Analizza le correzioni ricorrenti dell'utente per proporre regole mirate di progetto applicabili con un singolo click.
- 🔔 **Notifiche desktop native**: Notifiche toast di Windows 10/11 (con AUMID registrato e lampeggio nella barra delle applicazioni) e notifiche macOS (con rimbalzo nel dock e contatore badge) quando l'agente richiede input o completa un task.
- 🛡️ **Privato, leggero e sicuro**: App desktop locale al 100% offline basata su Tauri 2. Si collega direttamente ai database SQLite locali in modalità rigorosamente di sola lettura (`PRAGMA query_only = ON`).

---

## 📸 Panoramica visiva

### Doppia superficie per l'agente: Chat GUI e Terminale nativo
Passa dalla ricca chat GUI in Svelte 5 al terminale ANSI perfetto al singolo pixel sulla stessa sessione usando `Ctrl+Alt+A`:

<p align="center">
  <img src="assets/screenshots/screen_gui.png" width="49%" alt="Native Chat GUI" />
  <img src="assets/screenshots/screen_tui.png" width="49%" alt="Native Terminal TUI" />
</p>

### Editor Monaco e Git Diff
Ispeziona le modifiche, confronta i diff Git affiancati, visualizza in anteprima gli SVG e modifica i file direttamente accanto all'agente:

<p align="center">
  <img src="assets/screenshots/screen_editor.png" width="100%" alt="Monaco Code Editor and Diff Viewer" />
</p>

### Orchestrazione dei task e intelligenza dei modelli
Accoda prompt, calibra il thinking effort e i ruoli, allega screenshot e monitora le quote di token tra i vari provider:

<p align="center">
  <img src="assets/screenshots/screen_task.png" width="100%" alt="Task Editor and Model Configuration" />
</p>

---

## 🤖 Creato con e per `omp`

L'intera applicazione è **sviluppata, mantenuta ed evoluta iterativamente usando `omp` stesso**.

- **Documentazione AI-First**: Linee guida come [`AGENTS.md`](AGENTS.md), progetti di architettura in [`docs/`](docs/) e contratti di workflow sono scritti esplicitamente affinché gli agenti di coding AI possano ispezionarli, ragionarci sopra e agire senza alcuna ambiguità.
- **Contesto bilingue**: Mentre l'interfaccia pubblica e questo README sono in inglese, i documenti di progettazione interni, la cronologia dei commit e i dialoghi dei prompt dell'agente sono mantenuti in **italiano** (la lingua madre dell'autore).
- **Invarianti rigorosi**: La base di codice è progettata per resistere alle modifiche apportate dall'AI, con script di rilascio automatizzati, controlli di configurazione basati su un'unica fonte di verità e convalida automatica dei tipi.

---

## 📥 Download e installazione

I rilasci precompilati sono disponibili per Windows, macOS e Linux (x86_64).

### Windows (10 / 11 a 64 bit)
Scarica l'installer leggero NSIS (`.exe`) dalle **[Release](https://github.com/Bodyes26/OMP-Studio/releases/latest)**.
- Installazione per singolo utente (senza privilegi di amministratore / UAC richiesti).
- Aggiornamenti in-app silenziosi e in background.

### macOS (Apple Silicon e Intel)
Scarica il file DMG universale (`.dmg`) dalle **[Release](https://github.com/Bodyes26/OMP-Studio/releases/latest)**.
- Binario universale (`aarch64` Apple Silicon + `x86_64` Intel).
- Rendering nativo WebKit e notifiche di sistema.

### Linux (x86_64)
Scarica il pacchetto Debian (`.deb`) o l'AppImage portabile (`.AppImage`) dalle **[Release](https://github.com/Bodyes26/OMP-Studio/releases/latest)**.
- Rendering nativo GTK3 / WebKitGTK con notifiche desktop.
- Compatibile con Ubuntu, Debian, Fedora, Arch e le principali distribuzioni.
*Nota: se `omp` non è installato nel sistema, la **Procedura guidata di configurazione** integrata in Studio proporrà automaticamente di scaricarlo, verificarlo e configurarlo al primo avvio.*

---

## ⌨️ Scorciatoie da tastiera

Tutte le combinazioni di tasti del terminale vengono inoltrate direttamente al PTY. Le azioni globali di Studio utilizzano il modificatore dedicato **`Ctrl+Alt`**:

| Scorciatoia | Ambito | Azione |
|---|---|---|
| `Ctrl+Alt+A` | Globale | Passa tra le superfici **TERMINAL** e **GUI** (stessa sessione) |
| `Ctrl+Alt+N` | Globale | Apre / Aggiunge un nuovo workspace di progetto |
| `Ctrl+Alt+T` | Globale | Apre il cassetto della Coda task globale multi-progetto |
| `Ctrl+Alt+U` | Globale | Mostra/nasconde il popover di monitoraggio delle quote AI e dei token |
| `Ctrl+Alt+M` | Globale | Apre il gestore di configurazione di Modelli e Ruoli |
| `Ctrl+Alt+,` | Globale | Apre il Centro impostazioni unificato |
| `Ctrl+Alt+S` | Globale | Apre la chat temporanea Scratchpad (`--no-session`) |
| `Ctrl+Alt+→` / `←` | Globale | Passa al progetto aperto successivo / precedente |
| `Ctrl+P` / `Alt+R` | GUI | Cicla rapidamente / seleziona i ruoli operativi dell'agente (`default`, `plan`, `smol`...) |
| `Ctrl+S` | Editor | Salva il file corrente nell'editor Monaco |
| `Ctrl+W` / `Ctrl+F4` | Editor | Chiude la scheda del file attivo nell'editor |
| `Esc` | Globale | Chiude la finestra di dialogo o il popover attivo, o annulla la risposta in streaming |

*Consulta [`docs/SHORTCUTS.md`](docs/SHORTCUTS.md) per il riferimento completo a tutte le scorciatoie da tastiera.*

---

## 🛠️ Sviluppo locale

### Prerequisiti
- Node.js (v18+) o [Bun](https://bun.sh/)
- Toolchain Rust (`stable`)
- Strumenti di compilazione C++ della piattaforma (Visual Studio C++ su Windows / Strumenti da riga di comando Xcode su macOS)

### Guida introduttiva
```bash
# 1. Clona il repository
git clone https://github.com/Bodyes26/OMP-Studio.git
cd OMP-Studio

# 2. Installa le dipendenze
npm install

# 3. Esegui l'app desktop in modalità di sviluppo
npm run tauri -- dev

# 4. Esegui il controllo dei tipi Svelte / TypeScript
npm run check

# 5. Esegui la suite di test automatizzati
npm test
```

---

## 📦 Controllo versione e flusso di rilascio

L'avanzamento di versione è sincronizzato tra `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` e `src-tauri/tauri.conf.json` tramite la pipeline di rilascio automatizzata:

```bash
npm run release -- 1.2.0            # Avanzamento di versione + chiude [Unreleased] in CHANGELOG.md
node scripts/release.mjs --notes    # Genera note di rilascio pulite per le GitHub Releases
```

Per le regole dettagliate di rilascio e i protocolli dell'agente, consulta [`AGENTS.md`](AGENTS.md).

---

## 📐 Filosofia e architettura

1. **La sessione dell'agente è il contenuto, l'app è la cornice**: I viewport non vengono mai rallentati da decoratori grafici pesanti. La cornice dell'interfaccia utilizza palette neutre a croma 0 in modo che i colori ANSI e i temi del codice rimangano inalterati.
2. **Cambio progetto istantaneo**: Il passaggio tra progetti è immediato e non ricarica mai il DOM né interrompe i processi PTY.
3. **Doppia superficie per progettazione**: La chat GUI è un compagno ergonomico che comunica tramite `omp --mode rpc-ui`; non sostituisce mai il terminale nativo né crea fork del motore dell'agente.
4. **Resilienza e privacy**: Tutti i database dell'agente vengono aperti in sola lettura (`PRAGMA query_only = ON`). Nessuna telemetria remota né vincoli proprietari verso il cloud.

Progetti architetturali dettagliati:
- [PRODUCT.md](docs/PRODUCT.md) — Visione di prodotto, problemi risolti e non-obiettivi
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Streaming ConPTY/POSIX PTY, trasporto RPC Svelte 5 e modello di threading
- [DESIGN.md](docs/DESIGN.md) — Design token, sistema dei colori e regole di stato dell'interfaccia utente
- [DECISIONS.md](docs/DECISIONS.md) — Architecture Decision Records (ADR)
- [SHORTCUTS.md](docs/SHORTCUTS.md) — Riferimento completo alle scorciatoie da tastiera

---

## 📄 Licenza e contributi

Distribuito con **[Licenza MIT](LICENSE)**.

*Questo è un progetto personale pubblicato in sola lettura. Le pull request vengono chiuse automaticamente, ma sei il benvenuto a effettuarne il fork e adattarlo al tuo flusso di lavoro.*
