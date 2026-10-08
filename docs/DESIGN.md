---
name: OMP Studio
description: Il guscio desktop attorno a omp. La conversazione con l'agente è la voce; tutto il resto è l'officina che la accompagna.
colors:
  brand: "oklch(0.620 0.190 355)"
  brand-ink: "oklch(0.720 0.170 355)"
  brand-dim: "oklch(0.440 0.140 355)"
  bg-sunken: "oklch(0.155 0 0)"
  bg-base: "oklch(0.185 0 0)"
  bg-raised: "oklch(0.216 0 0)"
  bg-overlay: "oklch(0.248 0 0)"
  bg-hover: "oklch(0.970 0 0 / 0.10)"
  bg-active: "oklch(0.970 0 0 / 0.15)"
  line: "oklch(0.970 0 0 / 0.11)"
  line-strong: "oklch(0.970 0 0 / 0.23)"
  ink: "oklch(0.970 0 0)"
  ink-muted: "oklch(0.760 0 0)"
  ink-faint: "oklch(0.655 0 0)"
  warn: "oklch(0.780 0.150 75)"
  warn-dim: "oklch(0.560 0.120 75)"
  success: "oklch(0.740 0.180 145)"
  danger: "oklch(0.680 0.185 27)"
  danger-dim: "oklch(0.380 0.148 27)"
typography:
  prose:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "28px"
  prose-h1:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  prose-h2:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  prose-h3:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "28px"
  chat:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  trace:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 550
    lineHeight: 1.3
  body:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: 1.45
  label:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 450
    lineHeight: 1.4
  meta:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  caption:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
  group-label:
    fontFamily: "Inter Variable, Inter, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  mono:
    fontFamily: "JetBrainsMono Nerd Font, JetBrains Mono, Cascadia Code, Cascadia Mono, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "8": "48px"
components:
  composer:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "{rounded.2xl}"
    padding: "10px 14px 8px"
  composer-tray:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.trace}"
    rounded: "12px 12px 0 0"
  tray-attention-row:
    backgroundColor: "color-mix(in oklch, oklch(0.780 0.150 75) 15%, transparent)"
    textColor: "{colors.ink}"
    typography: "{typography.trace}"
  user-bubble:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "16px 16px 6px 16px"
    padding: "10px 14px"
  ask-card:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "12px 16px 0"
  ask-option:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  ask-option-selected:
    backgroundColor: "color-mix(in oklab, oklch(0.620 0.190 355) 7%, transparent)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  send-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg-base}"
    rounded: "{rounded.full}"
    size: "28px"
  stop-button:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.bg-sunken}"
    rounded: "{rounded.full}"
    size: "28px"
  primary-action:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.bg-sunken}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  toolbar-trigger:
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 8px"
  toolbar-trigger-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "28px"
  menu:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px"
  menu-row-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
  badge-file:
    backgroundColor: "color-mix(in oklch, oklch(0.620 0.190 355) 12%, transparent)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 6px"
  badge-command:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg-base}"
    rounded: "{rounded.md}"
    padding: "0 6px"
  badge-identity:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 6px"
  suggestion-chip:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  trace-row:
    textColor: "{colors.ink-muted}"
    typography: "{typography.trace}"
    height: "26px"
    padding: "0 4px"
  scroll-button:
    backgroundColor: "{colors.bg-overlay}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "28px"
  status-mark-completed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg-raised}"
    rounded: "{rounded.full}"
    size: "16px"
  status-mark-running:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "14px"
  status-mark-pending:
    rounded: "{rounded.full}"
    size: "14px"
  status-mark-blocked:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.bg-sunken}"
    rounded: "{rounded.full}"
    size: "16px"
  status-mark-failed:
    backgroundColor: "{colors.danger-dim}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    size: "16px"
  status-mark-attention:
    backgroundColor: "{colors.warn}"
    rounded: "{rounded.full}"
    size: "10px"
  column-tabs-track:
    backgroundColor: "transparent"
    height: "32px"
  column-tab-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    typography: "{typography.label}"
    padding: "0 8px"
    height: "32px"
  column-tab-btn-selected:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 8px"
    height: "32px"
  tooltip:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  dialog:
    backgroundColor: "{colors.bg-overlay}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  dialog-header:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "16px 16px 12px"
  ui-input:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  ui-select:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  ui-button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  ui-button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  ui-button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.bg-sunken}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  ui-button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.bg-sunken}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: "5px 14px"
  switch-track:
    backgroundColor: "{colors.bg-sunken}"
    rounded: "{rounded.full}"
    width: "32px"
    height: "18px"
  switch-thumb:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "12px"
  slider-track:
    backgroundColor: "{colors.bg-sunken}"
    rounded: "{rounded.full}"
    height: "20px"
  slider-thumb:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "22px"
  segmented-group:
    backgroundColor: "{colors.bg-sunken}"
    rounded: "{rounded.md}"
  segmented-button:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    padding: "5px 12px"
  segmented-button-active:
    backgroundColor: "{colors.bg-active}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "5px 12px"
  ui-count:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    height: "16px"
    padding: "0 5px"
  ui-choice:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  prompt-block:
    backgroundColor: "{colors.bg-base}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  ui-checkbox:
    backgroundColor: "{colors.bg-sunken}"
    borderColor: "{colors.ink-faint}"
    rounded: "{rounded.sm}"
    size: "16px"
  ui-kbd:
    textColor: "{colors.ink-faint}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "0 5px"
  ui-cap:
    backgroundColor: "{colors.bg-base}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "1px 4px"
  model-field:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  confirm-dialog:
    backgroundColor: "{colors.bg-overlay}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
---

# Design System: OMP Studio

Fonte visiva: la GUI Chat v2 e il suo composer (Gate R32), nati dal prototipo Lab
**CodeAgent Flow** (`p-20260925-dyyhe6`). Il sistema precedente è archiviato in
[`DESIGN-legacy.md`](DESIGN-legacy.md) e descrive com'è fatto oggi il resto di Studio:
questo documento è il riferimento a cui il resto viene allineato. I token del
frontmatter sono normativi; i valori sono quelli del tema scuro di default, e ogni tema
di `omp` li ricalcola (§ Colors).

## Overview

**Creative North Star: "Officina silenziosa, voce chiara"**

Studio parla con due registri. La **voce** è la conversazione con l'agente: una
superficie di lettura calma, a 15/28 px in una colonna da 720 px, dove il testo
dell'agente non ha contenitore, l'utente ha una bolla in rilievo e il lavoro tecnico
scorre come una traccia leggera da 12,5 px. L'**officina** è tutto il resto: barra
progetti, colonne di file e Git, editor, impostazioni, popover. È densa (13 px di
base), cromaticamente muta e precisa, e accompagna la voce senza competere.

Muta non vuol dire immobile. La cornice tace di colore, non di movimento: pannelli,
popover, righe e sezioni che si aprono parlano con la stessa grammatica fluida della
chat (sfocatura che si dissolve, altezza che si piega, una sola curva). Restano fermi
solo due oggetti, per ragioni di prodotto: la viewport del terminale e il contenuto
delle colonne durante lo switch di progetto.

La scelta strutturale che regge tutto viene dal prototipo: **lo stato vivo sta vicino
al punto d'azione, la storia resta leggera.** Todo, subagenti, coda e domande vivono
nel vassoio agganciato al composer, mentre nel transcript ne resta una riga. La stessa
regola vale nel resto di Studio: ciò che sta accadendo adesso si guarda dove si agisce,
non in mezzo al racconto.

**Key Characteristics:**

- Due registri tipografici: voce a 15 px per leggere e scrivere, officina a 13 px per operare.
- Elevazione per luminanza prima che per ombra; tre ombre a token, nessuna decorativa.
- Raggio proporzionale al ruolo: 16 px per le superfici della conversazione, 10 px per ciò che galleggia, 6 px per i controlli.
- Una curva sola (`--ease-reveal`) per tutto ciò che entra; keyframe definiti solo dal lato `from`.
- Colore del tema per fuoco e selezione; verde, rosso e ambra solo per esiti e stati, sempre con testo o icona.
- Si muove soltanto ciò che è vivo e visibile.

### Grammatica del movimento

| Token | Valore | Uso |
|---|---|---|
| `--ease-reveal` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Ogni ingresso: frasi, blocchi, righe, menu, vassoio, dialoghi modali. Default anche per la cornice. |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Micro-interazioni: hover, pressione, colore di bordo, movimento thumb switch/slider. |
| `--dur-fast` | 120 ms | Hover, pressione, bordo a fuoco, scatto controlli. |
| `--dur-menu` | 150 ms | Menu, palette `@`/`/`, popover: `rv-lift` con `--blur: 3px`. |
| `--dur-row` | 210 ms | Righe che entrano in una lista (`chatReveal`: blur 5 px, 3 px di corsa, altezza da 0, curva `--ease-reveal`). Piegatura delle cartelle dell'albero file (`tray-in`/`tray-out` con `--dur-tray` ridotto a `--dur-row`). |
| `--dur-slow` | 240 ms | Pannelli e finestre modali (`Dialog` tramite `rvLift` con blur 3 px). |
| `--dur-tray` | 420 ms | Sezioni che si piegano in altezza (`tray-in`/`tray-out`, blur 6 px). |
| `--dur-reveal` | 700 ms | Unità di testo dell'agente (`rv-blur`, blur 10 px). |

Le primitive vivono in `src/app.css` e nei moduli di motion dedicati:

- `.rv-blur` dissolve la sfocatura.
- `.rv-lift` aggiunge 8 px di salita (`rvLift` Svelte transition in `src/lib/agent/motion.ts`, usata per popover a 150 ms e finestre modali `Dialog` a 240 ms con blur 3 px). Con il parametro `x` la corsa diventa orizzontale: il pannello del subagente entra da destra con 12 px, 240 ms, blur 3 px.
- `.tray-in`/`.tray-out` piegano l'altezza con `grid-template-rows` da `0fr` a `1fr`.
- `trayFold` (`src/lib/agent/motion.ts`) è la gemella JS di `.tray-in`/`.tray-out` per i blocchi che il genitore rimuove: piega l'altezza a `--dur-tray` con blur 6 px. La usa il Companion, la cui finestra segue l'altezza del contenuto.
- `.text-shimmer` fa luccicare un'etichetta viva.
- `.ghost-line` annuncia il testo in arrivo.
- Keyframe globale `spin` in `src/app.css` (rotazione lineare continua a 360°): unifica e sostituisce 19 definizioni locali duplicate (`16spin`, `tray-spin`, `tab-spin`, `ring-spin`).
- Popover top-layer: `anchoredPopover` in `src/lib/anchoredPopover.ts` governa l'ancoraggio fixed nel top layer nativo (`popover="manual"`) a 8 px dal trigger (`top`, `top-start`, `top-end`, `bottom`) con ribaltamento automatico.

Ogni durata si regola per elemento con `--dur` e `--blur`. Helper a rune in
`src/lib/agent/motionState.svelte.ts`: `AutoOpen` (apertura automatica con scelta
manuale che vale finché la regola non cambia) e `Lingering` (tiene in vita un valore
per il tempo dell'uscita).

La rivelazione del testo procede per frasi:

- **Cadenza:** 140 ms fra unità, che scendono a 70 ms quando l'arretrato supera due frasi.
- **Assestamento:** a stream concluso, dopo 760 ms il DOM diventa statico, senza filtri.
- **Testo in arrivo:** fino a tre ghost line da 0,55 rem (95 caratteri ciascuna), sfocate di 2,5 px.
- **Analisi del markdown:** ogni 48 ms.

**The From-Only Rule.** I keyframe d'ingresso dichiarano solo lo stato di partenza. Lo
stato finale è quello naturale dell'elemento, quindi con le animazioni azzerate
(`prefers-reduced-motion` o `:root[data-animations="false"]`) la regola applicata è
`animation: none` (senza loop persistenti da 1 ms) e il contenuto è subito leggibile.

**The Alive-and-Visible Rule.** Il movimento persistente è ammesso solo mentre lo stato
è vivo e il contenitore è aperto davanti all'utente:

- luccichio delle etichette di lavoro;
- ghost line;
- spinner nelle righe aperte, nei segni di stato e nel vassoio;
- ping della domanda in attesa;
- respiro ambra della tessera che aspetta.
- respiro della quota **solo esaurita**, come interruzione ammessa dalla decisione D3.

Riepiloghi chiusi, sezioni collassate e stati conclusi sono fermi.

**The Still-Room Rule.** Non si animano mai la viewport del terminale né il contenuto
delle colonne durante lo switch di progetto. Il terminale viene disegnato già pronto;
cambiare progetto è cambiare stanza.

## Colors

Neutri derivati da due ancore del tema, un accento che arriva da `omp`, tre tinte
semantiche riservate agli esiti.

### Identità di progetto e stato operativo (D1)

L'identità dei singoli progetti conserva la propria tinta di personalità (`export.cardBg`,
colore iconico e accento specifico) per differenziare l'ambiente di lavoro dell'officina.
Al contrario, lo **stato operativo dell'esecuzione** (todo, subagenti, chiamate tool, stato
dei file Git) è rigorosamente **neutro e condiviso**: il completamento è un disco neutro
(`--ink` pieno con spunta `--bg-raised`), non verde (§ Components: StatusMark).

Gli altri punti d'identità seguono la stessa rampa delle tessere: i pallini dei ruoli nel
menu del composer sono `oklch(var(--proj-l-ink) var(--proj-c-ink) <tinta>)`, con una tinta
fissa per ruolo (plan 230, smol 140, slow 300, vision 80, task 35, commit 180, advisor 320)
e luminanza e croma che arrivano dal tema; `default` resta `--brand-ink`. Misurati su
`--bg-raised`: 7,9–8,6:1 su scuro, 6,6–7,9:1 su chiaro. Le capacità dei modelli (vision,
thinking, contesto) non sono identità: chip neutre `.ui-cap` (`--ink-muted`, bordo `--line`,
fondo `--bg-base`, 4 px), e l'icona porta il significato. Lo stato «connesso» o «configurato»
di un provider o di un ruolo non è un esito: `StatusMark` completato neutro con testo, mai
verde. Un prezzo «Gratis» è un'informazione, non un esito: testo `--ink-muted`.

### Primary

- **Accento del tema** (`--brand`, default cremisi `oklch(0.620 0.190 355)`): anello di
  fuoco, bordo e anello inset dell'opzione scelta, tinta dei badge `@file` (12% di
  fondo, 28% di anello), barre del misuratore di thinking, riempimento dell'azione
  primaria e indicatore delle schede orizzontali (`ColumnTabs`). Tinta e croma vengono da
  `colors.accent` del tema di `omp`; la croma è tagliata a 0.190, mai inventata.
- **Accento per testo** (`--brand-ink`): l'unica forma dell'accento ammessa come testo
  (link, conteggi accentati, pallino del ruolo attivo). 6,48:1 su `--bg-raised`.
- **Accento profondo** (`--brand-dim`): riempimenti sotto testo `--ink`.

### Neutral

| Token | Ruolo |
|---|---|
| `--bg-sunken` | Il pozzo: tela della chat e della finestra companion, terminale, editor, blocchi di codice, campi di input (`.ui-input`, `.ui-select`), traccia slider e segmented. |
| `--bg-base` | Corpo delle colonne, piedi dei menu, chip di contesto, badge `/comando` in negativo, piè di dialoghi. |
| `--bg-raised` | Superfici della conversazione: composer, bolla utente, scheda domanda, menu, tooltip. |
| `--bg-overlay` | Ciò che galleggia sopra la conversazione: pillola «in fondo», popover, finestre modali (`Dialog`). |
| `--bg-hover` / `--bg-active` | Stati di riga e controllo; traslucidi, funzionano su ogni superficie. `--bg-active` governa anche lo stato attivo neutro del `Segmented`. |
| `--line` / `--line-strong` | Separatori da 1 px; `--line-strong` per bordi a fuoco, menu, scheda domanda e dialoghi modali. |
| `--ink` / `--ink-muted` / `--ink-faint` | Testo primario, secondario (righe di traccia, descrizioni), metadati e scorciatoie. |

### Mappa normativa dei token approvata

Per eliminare ambiguità e allineare il codice esistente alle definizioni normative di Design v2:

| Token precedente / alias | Token normativo | Ruolo e applicazione |
|---|---|---|
| `accent` | `--brand-ink` (testo), `--brand` (fuoco/selezione), `--ink` (spin) | Testo ad alto contrasto, contorni di fuoco, rotazione neutra dello spinner. |
| `accent-dim`, `brand-subtle`, `brand-tint` | `color-mix(..., var(--brand) 12%, transparent)` | Sfondo badge `@file` (12%) o sfondo opzione selezionata della domanda (7%). |
| `brand-line` | `color-mix(..., var(--brand) 28%, transparent)` | Anello inset dei badge al 28%; anello di selezione. |
| `bg-surface`, `bg-card`, `bg-panel`, `bg`, `surface1..3` | `--bg-sunken`, `--bg-base`, `--bg-raised`, `--bg-overlay` | Suddivisione semantica rigorosa per ruolo e livello di elevazione. |
| `bg-surface-elevated` | `--bg-raised` | Superfici rialzate. |
| `err`, `danger-ink` | `--danger` | Tinta unica per esiti negativi, cancellazioni e interruzioni. |
| `err-dim` | `--danger-dim` | Riservato unicamente al cerchio del segno di stato fallito (`failed`). |
| `warn-ink`, `amber-fg` | `--warn` | Attenzione e attesa; nessuna rotaia decorativa colorata. |
| `text-muted` | `--ink-muted` | Testo secondario a contrasto garantito. |
| `line-dim`, `border-subtle` | `--line` | Separatori e bordi standard da 1 px. |
| `brand-contrast` | `--on-brand` | Testo leggibile sopra riempimenti pieni `--brand`. |
| `radius-xs` | `--radius-md` (6 px) / `--radius-sm` (4 px) | 6 px per controlli compatti; 4 px per elementi in linea. |
| `shadow-md` | `--shadow-overlay` | Ammessa solo per elementi galleggianti; rimossa da superfici fisse. |
| `z-modal` | `--z-dialog` o `--z-backdrop` | Il token `z-modal` è vietato; la scala usa `--z-dialog: 60`. |
| `transition-fast`, `duration-fast` | `--dur-fast` (120 ms) + `--ease-out` | Micro-interazioni rapide. |
| `text2xs` | `--text-meta` (numeri tabulari) / `--text-caption` (copia) | 11,5 px per conteggi e metadati; 11 px per didascalie. |
| Spaziature intermedie 6 px e 10 px | Derivate locali (`6px`, `10px`) | Nessun token globale generico inventato. |
`--bg-raised` e `--bg-overlay` sono **opachi** (`color-mix(in oklab, var(--bg-base) 96% / 92%, var(--ink))`):
una superficie copre. Gli stati e le linee sono **traslucidi** (`color-mix(in srgb, var(--ink) N%, transparent)`):
lo stesso hover funziona sulla tela, dentro il composer e dentro un menu.

Contrasti misurati sul tema scuro di default (WCAG 2.x, calcolati da OKLCH):

| Testo | su `sunken` | su `raised` | su `overlay` |
|---|---|---|---|
| `--ink` | 17,92 | 16,01 | 14,76 |
| `--ink-muted` | 9,10 | 8,13 | 7,50 |
| `--ink-faint` | 6,16 | 5,50 | 5,08 |
| `--brand-ink` | 7,25 | 6,48 | 5,98 |
| `--warn` | 9,56 | 8,54 | 7,87 |
| `--success` | 9,05 | 8,08 | 7,45 |
| `--danger` | 6,24 | 5,58 | 5,14 |

Altre coppie misurate:

- Badge `@file`, `--ink` sul fondo accentato: 14,20.
- Badge `/comando`, `--bg-base` su `--ink`: 17,09.
- Etichetta «Consigliata», `--success` sul proprio 14%: 6,28.
- Glifo di Stop, `--on-danger` (`--bg-sunken`) su `--danger`: 6,24.
- Testo dell'azione primaria, `--on-brand` su `--brand`: 4,85 (4,53 su Alabaster, dove `--on-brand` è `--ink`).
- Riga di attenzione del vassoio, `--ink` su `--warn` al 15%: 12,0:1 sia sul tema scuro di default sia su Alabaster; il punto `--warn` sullo stesso fondo 6,2:1. Il vecchio `--ink` su `--warn-dim` dava 4,36:1, e `--bg-sunken` su `--warn-dim` 4,11 su scuro e 1,41 su chiaro.
- Durata del video sulla miniatura, `--ink` su `--bg-sunken` al 75%: 12,1–12,6:1 su un fotogramma medio.

### Semantici

- **Ambra** (`--warn`, `--warn-dim`): attenzione. Domanda in attesa (riga del vassoio a fondo `--warn` 15%, ping), quota al limite, contesto oltre il 60%, avviso di visione, scadenza della domanda, evidenziazione delle lettere trovate nella palette.
- **Verde** (`--success`): esito positivo esplicito. Righe aggiunte di un diff (`+N`), passo di domanda completato, etichetta «Consigliata».
- **Rosso** (`--danger`): esito negativo o azione che interrompe. Righe rimosse (`−N`), chiamata fallita, todo bloccato, quota esaurita, contesto oltre l'85%, pulsante Stop. Negli esiti di riga è testo meta senza fondo («fallito», «bloccato»), mai una pillola piena.

**The Theme Is the Scene Rule.** Studio non ha una palette propria: le ancore `--bg-sunken` e `--bg-base`, l'accento e l'ambra arrivano dal tema di `omp` (`export.pageBg`, `export.cardBg`, `colors.accent`, `colors.warning`), e guscio e TUI cambiano sempre insieme. Nei temi chiari la rampa del testo si inverte (`--ink` 0.240, `--ink-muted` 0.430, `--ink-faint` 0.520).

**The Outcome-Only Color Rule.** Verde, rosso e ambra dicono come è andata o cosa
richiede attenzione, mai «questa parte è importante». Accompagnano sempre un testo o
un'icona, e non diventano mai il colore di un'area. Un todo completato non è verde: è
un disco neutro con la spunta.
Eccezione deliberata per la quota: con l'opzione «Colori semaforo» attiva, lo stato
sano può usare `--success`, derivato dal tema. Senza l'opzione resta neutro.
Le opzioni della chip e del popover sono indipendenti; quota bassa e critica/esaurita
usano sempre `--warn` e `--danger`, mai il brand né una palette parallela.

**The Mix-Don't-Paint Rule.** Ogni tinta è un `color-mix` di un token. Niente
`white`, `black`, `rgba()` od `oklch()` letterali nei componenti; il testo sopra un
riempimento pieno usa le coppie `--on-brand`, `--on-success` e `--on-danger`.

**The Sacred Terminal Rule.** I sedici colori ANSI appartengono al tema di `omp`.
Studio imposta solo fondo (`--bg-sunken`) e testo (`--ink`) del terminale.

**The Clear-Viewport Rule.** Niente dell'app si sovrappone alla viewport del
terminale: né controlli, né banner, né veli. Lo Stop sta nella testata della colonna
(D6). Gli errori del provider, quota compresa, li mostra la TUI di `omp`: passando
dalla GUI al terminale il blocco quota della sessione GUI si archivia, perché la TUI
lo riprende con `--resume` e il recupero passa da `Ctrl+P` e `/retry`. La viewport ha
8 px di margine sui soli lati, 0 in alto e in basso.

## Typography

**Font UI:** Inter Variable (con Segoe UI Variable Text, Segoe UI, system-ui)
**Font mono:** JetBrainsMono Nerd Font (con Cascadia Code, Cascadia Mono, Consolas)

**Carattere:** sans umanista per leggere, monospace per tutto ciò che è un nome
macchina: path, comandi, modelli, token, costi, codice. Il contrasto fra i due assi
porta l'informazione: nella stessa riga di traccia «Lettura» è in sans e
`src/api/orders.ts` in mono.

### Gerarchia — la voce (conversazione)

- **Prosa** (400, 15/28 px): testo dell'agente, senza contenitore, larghezza massima 720 px.
- **Titoli in prosa**: h1 20 px/600 (1.3), h2 17 px/600 (1.35), h3–h6 15 px/600 (28 px), tutti `--ink`, dai token `--text-prose-h1/h2/h3`. La stessa scala vale in rivelazione (`AssistantText`) e nel testo assestato (`Markdown`), che usa token assoluti anche nel ragionamento e nell'anteprima: al termine dello stream non salta niente. Paragrafi ed elenchi di `Markdown` ereditano l'interlinea dal contenitore (28 px in prosa, 24 nella voce chat, 22 nel ragionamento). Il titolo non scende mai sotto il corpo.
- **Chat** (400, 15/24 px): bolla dell'utente, editor del composer, testo della domanda (peso 500), corpo dei messaggi tra agenti (`IrcMessageCard`). Quello che scrivi ha la misura di quello che leggerai.
- **Traccia** (400, 12,5 px/1.5): righe dei tool, riepiloghi, avvisi di sistema, righe del vassoio, «Sto pensando…» (13,5 px).
- **Ragionamento** (13/22 px, `--ink-muted`): corpo del blocco di thinking aperto.
- **Meta** (11,5 px, `tabular-nums`): conteggi, durate, righe modificate, costi.

### Gerarchia — l'officina (cornice e controlli)

- **Titolo** (550, 16 px): titoli di popover e finestre modali (`Dialog`), `text-wrap: balance`.
- **Corpo** (450, 13 px/1.45): voci di lista, menu, contenuto dei pannelli, controlli form opt-in (`.ui-input`, `.ui-select`).
- **Etichetta** (450 o 500, 12 px): label, path secondari, opzioni della domanda, schede orizzontali (`ColumnTabs`, peso 500, `letter-spacing: normal`, senza maiuscolo spaziato).
- **Didascalia** (500, 11 px): trigger della barra del composer, controlli form `.ui-button`, chip, scorciatoie, tooltip (`Tooltip`), piè di turno.
- **Etichetta di gruppo** (600, 11 px, maiuscolo, `0.05em`, `--ink-faint`): solo per raggruppare voci dentro un menu o una lista (provider nel selettore modelli, sezioni della palette).
- **Mono** (12 px/1.5): blocchi di codice, dettagli dei tool, badge (`0.84em` del testo che li circonda).
**The Two Voices Rule.** Leggere e scrivere un prompt completo usano la voce (15/24);
operare usa l'officina (13 px e meno). Una superficie che contiene un prompt da
scrivere o rileggere parla con la voce anche fuori dalla chat. Tre eccezioni:
il pannello laterale del singolo subagente (`SubagentDrawer`) è un ispettore e mostra
il transcript in traccia (12,5/1.5) con markdown, come il riquadro di contesto sopra una
domanda nel Companion; i task in coda restano densi, 11 px in
vista compatta e 12 px in vista card, **anche nel dettaglio espanso** («Leggi tutto»
allunga il blocco, non ingrandisce il testo); i titoli di sessione troncati a una
riga nelle liste (sessioni recenti del pannello Git, storico del pannello Agente) sono
etichette di navigazione e restano nel corpo dell'officina (13/450 `--ink`, tempo in
meta tabulare). Il prompt di un task in coda si legge in Markdown denso: titoli alla
stessa misura del corpo con peso 600, codice a 0,92 em, menzioni `@file` a 0,84 em.

**The Heading-Above-Body Rule.** Dentro la prosa un titolo è sempre almeno grande
quanto il corpo e più pesante; la gerarchia sale, non scende.

**The Tabular Rule.** Ogni numero che cambia nel tempo (token, percentuali, durate,
costi, contatori) usa `tabular-nums`.

## Layout

- **Colonna di lettura.** Modalità `readable` (default): 720 px centrati, applicati
  insieme al transcript e al piede con il composer. Modalità `full`: tutta la colonna.
  Padding del transcript 12 px.
- **Ritmo verticale del transcript.** Niente `gap` uniforme: 12 px fra voci, 32 px al
  confine di turno, 16 px fra la bolla dell'utente e la risposta, 4 px fra righe di
  sistema consecutive.
- **Piede.** Composer e vassoio stanno in un piede appiccicato al fondo. Quando sotto
  c'è altro contenuto, una dissolvenza di 28 px (`--bg-sunken` → trasparente) separa il
  testo che scorre dal piede senza bisogno di una linea.
- **Vassoio.** Rientra di 12 px per lato rispetto al composer e ne poggia sul bordo
  superiore. Una sola sezione aperta per volta (priorità: subagenti, poi todo, poi
  coda); una domanda in attesa compatta tutto: a scheda domanda aperta il vassoio è una
  sola riga in traccia `--ink-muted` (es. «Subagenti al lavoro 1/3 · Todo 3/7 · Coda 2»),
  senza ombra propria; con la domanda ridotta tornano le sezioni e la riga di attenzione.
  Corpo massimo 12 rem, poi scorre.
- **Righe dei tool.** Alte 26 px, gap 10 px, `content-visibility: auto`. Elenco aperto
  fino a 18 rem con una linea guida da 1 px a sinistra.
- **Composer.** Editor con padding `10px 14px 4px` (altezza da 24 a 240 px), barra
  `2px 8px 8px` con gap 2 px; il gruppo di destra (contesto e invio) è spinto a fine riga.
- **Officina.** Le tre colonne, la barra progetti e le larghezze per progetto restano
  quelle di `PRODUCT.md`. Il ritmo resta sulla scala a 4 px: righe `4px 8px`,
  pannelli 12 px, popover 16 px, gruppi in popover 24 px.
**The Fused-Header Rule (D7).** Le testate delle viste della colonna centrale (Editor, TaskEditor, PreviewViewer, DiagramViewer) sono alte 32 px, sul pozzo (`--bg-sunken`), con bordo inferiore da 1 px (`--line`) e trigger/pulsanti a 28 px. Non si impilano sopra un `.col-header`: prendono il suo posto e allineano la fascia superiore dell'app alle colonne laterali (`ColumnTabs` e switch TERMINAL/GUI a 32 px). Nelle corsie Laboratorio resta una testata da 32 px dedicata allo switch Anteprima/Editor con `Segmented` in modalità `tablist`.
**The Action-Point Rule.** Ciò che è vivo adesso sta dove l'utente agisce. Il racconto
ne conserva una riga sola, espandibile su richiesta.

## Elevation & Depth

Profondità ibrida, con la luminanza al primo posto. La scala
`sunken → base → raised → overlay` e un bordo da 1 px reggono la gerarchia da sole.
Le ombre servono a dire «questo è agganciato» o «questo galleggia», e sui temi scuri
sono quasi invisibili per costruzione: contano davvero nei temi chiari.

### Shadow Vocabulary

- **Aggancio** (`--shadow-dock: 0 2px 10px -2px oklch(0 0 0 / 0.15)`): il composer, superficie fissa sopra la tela che scorre.
- **Sollevamento** (`--shadow-raise: 0 8px 30px -10px oklch(0 0 0 / 0.20)`): la scheda domanda quando sostituisce il composer, cioè quando la superficie chiede una decisione.
- **Galleggiamento** (`--shadow-overlay: 0 8px 24px -8px oklch(0 0 0 / 0.7), 0 2px 6px -2px oklch(0 0 0 / 0.5)`): menu, palette `@`/`/`, popover, pulsante «in fondo».

### Sfocatura

La sfocatura ha due usi soli:

- **Movimento:** ingressi `rv-blur` e `rv-lift`, ghost line.
- **Vetro funzionale:** solo dove il contenuto scorre davvero sotto la superficie. Il vassoio usa `--bg-raised` all'85% con `backdrop-filter: blur(8px)`; la dissolvenza del piede usa 2 px.

**The Luminance-First Rule.** Se una gerarchia si legge solo grazie a un'ombra, la
superficie sbaglia gradino di luminanza.

**The Dock Shadow Rule.** Bordo da 1 px più ombra sullo stesso elemento è ammesso solo
con i tre token qui sopra; nessuna ombra su righe, bolle, chip o pulsanti in linea.

**The Flat-By-Default Rule.** Superfici e controlli a riposo sono piatti. Lo Slider
(traccia e cursore), lo Switch, i pulsanti nativi (`.ui-button`), le schede
(`ColumnTabs`) e i campi di input non hanno ombre (`box-shadow: none`). Le ombre
intervengono solo come risposta a uno stato di galleggiamento effettivo
(`--shadow-overlay`), aggancio (`--shadow-dock`) o sollevamento decisionale
(`--shadow-raise`).

Z-index solo semantico: `--z-base 0`, `--z-splitter 10`, `--z-sticky 20`,
`--z-topbar 30`, `--z-backdrop 40`, `--z-overlay 50`, `--z-dialog 60`,
`--z-toast 70`, `--z-tooltip 80`. (Il token `z-modal` è formalmente vietato;
le finestre modali usano `--z-dialog: 60` o il backdrop `--z-backdrop: 40`).

## Shapes

Il raggio dice il ruolo della superficie:

| Raggio | Token | Dove |
|---|---|---|
| 16 px | `--radius-2xl` | Superfici della conversazione: composer, scheda domanda (che ne prende il posto e la sagoma) e la sua anteprima in arrivo, bolla utente, overlay di trascinamento. |
| 12 px | `--radius-xl` | Lastre agganciate: angoli superiori del vassoio (inferiori a 0, poggia sul composer). |
| 10 px | `--radius-lg` | Ciò che galleggia: menu, palette, popover, finestre modali (`Dialog`); schede di esito nel transcript (integrazione della corsia). |
| 6 px | `--radius-md` | Controlli: pulsanti (`.ui-button`), trigger, righe di menu, opzioni, campi (`.ui-input`, `.ui-select`), miniature, bottoni del selettore segmentato (`Segmented`), bolla del tooltip (`Tooltip`), badge `@file` e `/comando`. |
| 4 px | `--radius-sm` | Piccoli elementi in linea: codice in linea, `kbd`, tag di contesto, corpo espanso di un tool, blocco di codice. |
| pieno | `--radius-full` | Traccia e cursore dello slider (`Slider`), traccia e cursore dello switch (`Switch`), chip di suggerimento, invio e Stop, pulsante «in fondo», segni di stato (`StatusMark`), ghost line. |

La scala è derivata da `--radius: 10px` (`sm` e `md` per sottrazione); `xl` e `2xl` si aggiungono a quella costante.

**The Tail Rule.** La bolla dell'utente ha tre angoli a 16 px e quello in basso a
destra a 6 px: la coda indica chi parla. Nessun'altra superficie ha angoli asimmetrici.

**The Concentric Rule.** Una superficie annidata o agganciata ha un raggio minore di
quella che la contiene: il vassoio (12) sul composer (16), l'opzione (6) dentro la
scheda (16), la riga (6) dentro il menu (10).

**The Neutral Rail Rule.** Tutti i bordi sono da 1 px. L'unica linea verticale da 2 px
è una guida neutra di raggruppamento: chiamate parallele (`--line-strong`), corpo del
ragionamento (`--line`). Non porta mai un colore.

## Components

### Composer

Strumento di scrittura e cruscotto della sessione in una sola superficie.

- **Contenitore:** `--bg-raised`, bordo `--line`, `--radius-2xl`, `--shadow-dock`. A fuoco il bordo passa a `--line-strong` (`--dur-fast`). Trascinando file: bordo `--brand-ink`, anello di 2 px con `--brand` al 25%, overlay `--radius-2xl` con etichetta. La sagoma è condivisa da ogni editor di prompt a badge (chat e Task Editor) tramite le classi globali `.composer-shell`, `.composer-toolbar`, `.composer-icon-btn` e `.composer-drop-overlay` in `src/app.css`; l'overlay è l'ultimo figlio e copre senza `z-index`.
- **Editor:** `contenteditable` in voce chat (15/24), placeholder `--ink-faint` sulla stessa interlinea perché il layout non salti. `Invio` invia nella modalità di default, `Alt+Invio` in quella alternativa, `Maiusc+Invio`/`Ctrl+Invio` vanno a capo. L'incolla porta solo testo; i file diventano allegati. Dove si scrive un testo ponderato (`submitWithModifier`, Task Editor) `Invio` va a capo e `Ctrl+Invio` conferma; l'altezza si regola con `--editor-min-height`/`--editor-max-height` (chat 24–240 px, task 140–460 px).
- **Badge:** `@file` ha fondo accento al 12%, anello inset al 28% (45% in hover), testo `--ink`, glifo file a 12 px con opacità 0,7. `/comando` è in negativo: fondo `--ink`, testo `--bg-base`. Nel Companion si aggiungono `#progetto` e `!ruolo`: fondo `--bg-hover`, anello `--line`, testo `--ink` e pallino d'identità da 7 px (§ Finestra companion). In comune: mono `0.84em`, `--radius-md`, massimo 260 px con ellissi, `contenteditable=false`, identici nell'editor e nel transcript.
- **Strisce sopra l'editor:** anteprima comando (`--bg-base`, `--radius-md`, 11 px, `rv-blur` 200 ms/4 px), allegati (miniature 56 px `--radius-md`; file 190×56 con estensione accentata), avviso di visione in ambra con l'azione «cambia modello».
- **Barra:** allegati, `@`, divisore 1×16 px, ruolo (pallino 7 px + nome mono), modello (nome con ellissi a 130 px), thinking (misuratore a 5 barre + livello in mono, apre lo slider), poi a destra contesto e invio. Trigger alti 28 px, `--radius-md`, didascalia `--ink-muted` → hover `--bg-hover`/`--ink`.
- **Anello del contesto:** SVG 18 px, raggio 7, tratto 2,2, terminali arrotondati; `--ink`, poi `--warn` oltre il 60%, poi `--danger` oltre l'85%; accanto `usato/massimo` in mono tabulare. Durante il riscaldamento della cache un pallino `--warn` da 7 px pulsa in alto a destra; esito, costo e motivo dell'arresto dell'ultimo riscaldamento stanno nel pannello del contesto, sotto la ripartizione.
- **Riga di stato (`ComposerStatusLine`):** fuori dal contenitore, sotto il bordo; mono 11 px `--ink-faint`, voci separate da `·` in `--line-strong`, costo della sessione spinto a destra. Contiene velocità (rapida e lenta, alternative: accenderne una spegne l'altra), prewalk con «ripeti» e limite d'uso in `--warn`. Voce attiva `--ink` con glifo `--brand-ink`; rapida accesa ma in pausa sul modello attuale in `--warn`. Una voce compare solo se può agire: rapida e lenta solo se il modello le supporta, prewalk solo con `@smol` configurato e ruolo diverso da smol (resta dopo il passaggio, per «ripeti»). Niente controlli disattivati o barrati; senza voci la riga sparisce.
- **Misuratore di thinking:** cinque barre larghe 3 px, altezze da 6 a 12 px, inattive `--line-strong`, attive `--brand-ink`.

### Invio e Stop

- **A riposo:** cerchio da 28 px, fondo `--ink`, freccia `--bg-base`; disabilitato a opacità 0,35.
- **Durante il turno:** Stop è un cerchio separato in `--danger` con glifo `--on-danger`. L'invio diventa uno split button a pillola: azione primaria nella modalità di default (steer o follow-up), caret per scegliere l'altra (menu da 240 px). Stop non disabilita mai l'invio.
- **Nel terminale (D6):** lo stesso cerchio da 28 px compare a destra nella testata della colonna mentre l'agente lavora, con `Tooltip`; il primo clic manda Ctrl+C. Per 2 s il cerchio diventa una pillola «Forza arresto» (didascalia 11/600, stessa campitura) e un secondo clic forza l'arresto; l'attesa si annuncia con `aria-live`. Nessun bagliore né animazione: il testo dice cosa farà il clic.

### Menu e popover del composer (MenuButton)

Un'unica primitiva condivisa (`MenuButton` in `src/lib/ui/MenuButton.svelte`, che
sostituisce integralmente la vecchia implementazione locale rimossa senza shim) per
allegati (260 px), ruolo (420 px), modello (400 px), thinking (320 px) e contesto (300 px):

- **Superficie:** si apre verso l'alto a 8 px dal trigger tramite `anchoredPopover` (`src/lib/anchoredPopover.ts`) ancorato nel top-layer nativo (`popover="manual"`), con ribaltamento automatico verso il basso se manca spazio; `--bg-raised`, bordo `--line-strong`, `--radius-lg`, `--shadow-overlay`, altezza massima 380 px.
- **Ingresso:** transizione condivisa `rv-lift` con `--dur-menu` (150 ms) e blur 3 px.
- **Accessibilità e chiusura:** adotta `Tooltip` accessibile sul trigger (nessun `title` nativo nel DOM); chiusura su click esterno (in fase di cattura) ed `Esc` con ripristino del focus; Tab non è intrappolato (esce naturalmente e chiude il menu); frecce e Home/End navigano le voci senza interferire con campi input/ricerca.
- **Righe:** `7px 8px`, `--radius-md`, hover `--bg-hover`, scelta indicata da una spunta `--brand-ink`.
- **Intestazioni e piedi:** intestazioni in etichetta di gruppo; piedi in didascalia `--ink-faint` su `--bg-base`.
- **Primi consumatori:** `Composer` con menu allegati (`AttachMenu`, menuitem), popover del thinking (dialog con lo slider, si chiude solo con click esterno o `Esc` perché ogni passo si applica subito) e split button invio (menuitemradio).
- **Menu contestuale (`ContextMenu`):** stessa superficie, stesse righe (`7px 8px`, corpo 13/450, `--radius-md`), stesso `rv-lift` e stesso motore di piazzamento. `anchoredPopover` accetta un'ancora a punto (`point: {x, y}`): il menu nasce al puntatore e si ribalta a sinistra o in alto come un menu nativo; aperto da tastiera si aggancia sotto l'elemento che lo invoca. Larghezza dal contenuto fra 260 e 320 px, poi ellissi. «Pericolo» a riposo resta `--ink-muted`; in hover e a fuoco fondo `--danger` al 10% e testo `--danger` (4,62–4,70:1 sui temi scuri misurati, 7,0:1 su Alabaster; al 14% scendeva a 4,39:1). Fuoco con l'anello globale all'interno (`outline-offset: -2px`), mai un `box-shadow`.
### Palette `@` e `/`

- **Superficie e posizione:** larga 440 px, ancorata al cursore, stessa superficie dei menu. Si apre sopra la riga in cui si scrive; quando sopra non c'è spazio nella vista (editor in cima alla colonna, come nel Task Editor) si apre sotto, come un menu ribaltato. Le voci e i tasti vengono da `src/lib/agent/suggestItems.ts`, condiviso dai due editor.
- **Righe:** in didascalia. Il nome file va in peso 500 con la cartella in mono `--ink-faint`; il comando va in mono 600 con l'argomento suggerito e la descrizione, che si espande sulla riga attiva.
- **Lettere trovate:** sottolineate in `--warn` (2 px), testo in peso 700.
- **Piede:** scorciatoie in `kbd`.

### Schermata nuovo task (TaskEditor)

Scrivere un task è un gesto ponderato, non una battuta: tutte le opzioni sono visibili
senza clic in più, e il prompt si scrive nella stessa sagoma e nella stessa voce del composer.

- **Testata:** prende il posto di quella della colonna, alta 32 px: titolo del task in etichetta 12/500 `--ink`, «Salvato» in meta `--ink-faint`, a destra Elimina e Chiudi (`Esc`) iconici da 28 px con `Tooltip`. Elimina è a doppia azione in linea: il primo clic lo trasforma per 4 s in «Conferma eliminazione» `.ui-button-danger`. Lo stato del task (in coda, in corso…) non si mostra: chi scrive un task lo ha sempre in coda.
- **Colonna:** 720 px centrati come il transcript, `16px 12px 32px`, sezioni a 24 px. Ingresso `rvLift` a 240 ms solo all'apertura: rimontare lo stesso task cambiando progetto non anima (Still-Room Rule).
- **Prompt:** `ComposerEditor` in `.composer-shell`, editor 140–460 px, badge `@file` e `/comando` identici alla chat, palette `SuggestPanel`. Allegati con `AttachmentThumb` (56 px, il clic apre l'immagine). Barra: allegati e `@` a sinistra; a destra lo split «Salva» `.ui-button-primary` con `Ctrl+↵` in `kbd`, e un caret che apre «Avvia ora» e «Avvia in nuova corsia» (menu da 260 px). Salvare è l'azione principale; avviare è sempre una scelta esplicita (Read-Before-Run Rule). Niente anello del contesto né ruolo e modello nella barra.
- **Esecuzione:** titolo di sezione 12/600 `--ink` in frase. Ruolo con `Segmented` (smol · default · slow · plan · custom) e descrizione del ruolo in etichetta `--ink-muted`; modello in un campo con la sagoma di `.ui-select` che apre `ModelPickerList` in `MenuButton` (400 px), con quota o costo in meta tabulare e «In uso altrove» in `--warn`; «Usati spesso» come `.ui-chip` sotto il modello; thinking con lo slider (Thinking-Slider Rule) e «Auto» come primo passo; «Includi il contesto dell'editor» con `Switch`, separato da una linea `--line`.
- **Direttive:** `.ui-chip` con il solo nome e la spunta quando attive; descrizione e posizione («inserita dopo il prompt») nel `Tooltip`. I tag di catalogo (`/plan`, `/grill-me`…) non si mostrano: sembrerebbero comandi inviati a `omp`. Una direttiva con versione nuova ha una riga con `StatusMark` `attention` fermo e «Aggiorna» `.ui-button-ghost`; una rimossa dal catalogo una riga in etichetta `--ink-muted`. «Gestisci direttive» è `.ui-button-ghost`.
- **Tastiera:** `Invio` va a capo, `Ctrl+Invio` salva e chiude, `Esc` chiude quando nessuna palette o menu è aperto.

### Vassoio

Lo stato vivo del turno, agganciato sopra il composer.

- **Superficie:** rientro di 12 px, bordo `--line` senza lato inferiore, `12px 12px 0 0`, vetro funzionale (§ Elevation). Sezioni separate da 1 px; apertura e chiusura `tray-in`/`tray-out` con `--dur-tray`.
- **Intestazione di sezione:** pulsante a tutta larghezza `8px 12px`, titolo 12 px/600, conteggio mono 11,5 px tabulare, chevron che ruota di 180°. A sezione chiusa mostra l'attività corrente in traccia; un subagente al lavoro ha il titolo in `.text-shimmer`.
- **Riga di attenzione:** fondo `color-mix(in oklch, var(--warn) 15%, transparent)` (22% in hover), testo `--ink`, punto `--warn` da 10 px con ping, testo su una riga e «Rispondi ›».
- **Riga della quota:** il blocco per quota esaurita o limite raggiunto vive qui, non nel transcript (Action-Point Rule). Fondo neutro, `StatusMark` `failed` (esaurita) o `attention` (limite), titolo in traccia `--ink` su una riga; a destra l'azione primaria `.ui-button-primary` («Passa a X e riprendi»), la secondaria `.ui-button-secondary` («Scegli altro modello…»), «Dettagli» e chiudi con `Tooltip`. Su colonne strette le azioni vanno a capo invece di troncare il titolo. Messaggio e diagnostica stanno in un dettaglio `tray-in` su `--bg-sunken`, bordo `--line`, `--radius-sm`, diagnostica in mono. Sta sopra la riga di attenzione della domanda.
- **Avanzamento dei todo:** anello da 18 px `--ink` su `--line-strong`; a lista completata resta `--ink` chiuso, mai verde.
- **Annunci:** una sola regione `aria-live="polite"` per sezione che riassume, mai un annuncio per riga.

### Segni di stato operativi (StatusMark e GitStatusMark)

Vocabolario semantico unificato per todo, subagenti, chiamate tool e stato versioni Git,
valido nel vassoio, nel transcript e nelle viste di dettaglio.

**StatusMark (`src/lib/ui/StatusMark.svelte` — D1):**
- **Completato** (`completed` / `done`): disco pieno da 16 px in `--ink` con spunta da 10 px in `--bg-raised`. Rigorosamente neutro, mai verde: l'esito completato è un fatto, non una celebrazione.
- **In corso** (`running` / `in_progress`): anello da 14 px, tratto 1,5 px `--line-strong` con il quarto superiore in `--ink` che ruota con il keyframe globale `spin`. Si anima solo se `active && visible && onScreen && pageVisible && !motionReduced()`. Con animazioni ridotte è statico.
- **In attesa** (`pending`): anello vuoto da 14 px, tratto 1,5 px `--line-strong`.
- **Bloccato** (`blocked`): cerchio pieno da 16 px in `--danger` con icona SVG punto esclamativo da 10 px in `--on-danger` (grafica vettoriale esplicita, non glifo Unicode).
- **Fallito** (`failed` / `aborted`): cerchio pieno da 16 px in `--danger-dim` con icona SVG croce da 10 px in `--danger`.
- **Contrasto del fallito (decisione verificata):** `--danger-dim-l` vale 0,380 in scuro, 0,880 in chiaro. La croce conserva `--danger`: 3,43:1 su Titanium scuro, sopra il minimo AA di 3:1 per icone. Il precedente 0,480 produceva 2,25:1.
- **Attenzione** (`attention`): punto da 10 px in `--warn` con anello ping a espansione da 1,6 s.
- **Primi consumatori:** `ComposerTray` (todo, subagenti, domande in attesa) e `CloseConfirmModal` (lavoro dell'agente in corso).

**GitStatusMark (`src/lib/ui/GitStatusMark.svelte`):**
- Mappa fedelmente gli stati reali del repository: `A` (aggiunto, `--success`), `M` (modificato, `--warn`), `D` (eliminato, `--danger`), `C` (conflitto/copia, `--danger`), `R` (rinominato, `--ink-muted`), `U` o `?` (non tracciato, `--success`), `!` (ignorato, `--ink-faint`).
- Lettera mono in meta (11,5 px, peso 700) a destra della riga. Con `dot` mostra un pallino al posto della lettera: le cartelle del `FileTree` segnalano così che contengono modifiche. Il file eliminato aggiunge il nome barrato, che non dipende dal colore.
- Accessibilità APG: il glifo compatto ha `aria-hidden="true"`, mentre la descrizione estesa per screen reader è incapsulata con la classe globale `.sr-only`. La prop `description` la sostituisce quando il contesto la cambia: una cartella dice «contiene modifiche», non «modificata».
- **Consumatori:** `GitPanel` (modifiche, file dei commit) e `FileTree` (righe, cartelle e risultati di ricerca). Non esistono token `--git-*`: i colori vengono dai semantici del tema, anche nel gutter di Monaco. Nel `FileTree` il nome prende lo stesso colore della lettera, come le decorazioni Git di VS Code (`M` `--warn`; `A`/`U` `--success`; `D`/`C` `--danger`; `R` resta `--ink`); la riga radice resta `--ink`.

### Colonna sinistra (FileTree e GitPanel)

- **Righe:** corpo 13 px, meta 11,5 px tabulare. L'anello di fuoco globale si disegna all'interno (`outline-offset: -2px`) perché le righe stanno in contenitori che tagliano; il campo di rinomina alto 18 px usa `outline-offset: 0`.
- **Icone dei file (modello VS Code):** forma Lucide per famiglia e tinta per linguaggio. Forme: `IconFileCode` per sorgenti e markup, `IconFileBraces` per JSON, `IconFileText` per testo, Markdown e PDF, `IconFileCog` per configurazioni e progetti (`toml`, `yaml`, `.env`, `csproj`, `.gitignore`), `IconFileTerminal` per script, `IconFileLock` per i lockfile, `IconFileImage`, `IconFileMusic`, `IconFileVideo`, `IconFileArchive`, `IconFileSpreadsheet`, `IconDatabase` per SQL, `IconFile` di default. La tinta è `oklch(var(--proj-l-ink) var(--proj-c-ink) <hue>)`: la rampa d'inchiostro dei progetti, abbassata sui temi chiari da `applyAnchors`, quindi stessa leggibilità per ogni linguaggio (TS 245, JS 95, JSON 90, Svelte 35, Rust 55, HTML 50, CSS 215…). File senza tinta e cartelle: `--ink-muted`.
- **Struttura:** i file hanno uno spazio vuoto largo quanto la freccia, così il loro nome si allinea a quello delle cartelle sorelle. Sotto la freccia di ogni cartella aperta (radice esclusa) una guida verticale da 1 px in `--line-strong` mostra fin dove arriva il contenuto; diventa `--ink-faint` quando puntatore o fuoco stanno su un figlio diretto.
- **Esclusi da Git:** `project_git_ignored` (`git ls-files --others --ignored --exclude-standard --directory`) restituisce i percorsi ignorati, con le cartelle ignorate per intero ridotte a una voce; un nodo è escluso se lo è lui o un antenato. Righe escluse e cartelle rumorose (`bin`, `obj`, `node_modules`) hanno il nome `--ink-faint` e l'icona a opacità 0,55.
- **Cartelle:** si aprono con `tray-in`/`tray-out` a `--dur-row`; la radice che nasce aperta e il cambio di progetto restano fermi (Still-Room Rule).
- **Ricerca:** lettere trovate sottolineate in `--warn` da 2 px, peso 700, testo `--ink`; l'anello da 2 px lo porta l'involucro del campo.
- **Pannello Git:** etichette di sezione in frase (etichetta 12/500 `--ink-muted`, conteggio in meta tabulare); menu branch su `MenuButton`; scheda di sincronizzazione neutra (bordo `--line`, 6 px). Pull, Push e Sync sono `.ui-button-primary` solo quando c'è lavoro da fare, Fetch è `.ui-button-secondary`; i conteggi ↓/↑ sono pillole neutre con `IconArrowDown`/`IconArrowUp`. L'esito CI è icona più testo meta senza fondo (`--success`, `--danger`; in corso con `StatusMark`). Le righe entrano con `chatReveal` solo quando la loro chiave è nuova rispetto alla lettura precedente: montaggio, cambio di scheda e polling non le rianimano.
- **`GitDiffBadge`:** `+N` in `--success`, `−N` (U+2212) in `--danger`; meta 11,5 px (alto 18 px), compatto in didascalia 11 px (alto 16 px).

### Colonna sinistra (pannello Agente)

- **Sottoschede Coda / Sessioni / Regole:** `Segmented` in modalità `tablist` a tutta larghezza, con conteggi (coda neutra, attrito delle regole in ambra con testo `--ink`). Sotto la testata FILE / GIT / AGENTE, già una `ColumnTabs` sottolineata, un secondo livello sottolineato non si distinguerebbe.
- **Barra della coda:** «Nuovo task» con `IconPlus`; il chip del cancello porta `StatusMark` (`attention` per domanda e quota, `pending` negli altri blocchi) e il dettaglio in `Tooltip`. La spiegazione del blocco si piega con `tray-in`/`tray-out`; la regione `aria-live` resta una sola.
- **Righe della coda:** entrano con `chatReveal` e si riordinano con `flip` a 210 ms sulla curva `--ease-reveal`; il lampo del rollback è un keyframe solo `from` (opacità 0,85 → 0).
- **Prompt in coda:** Markdown denso alla misura dell'anteprima; da chiuso al massimo tre righe con dissolvenza in fondo, «Leggi tutto» solo se il testo eccede, e l'apertura si piega in altezza.
- **Storico sessioni:** titolo 13/450 su una riga, filtro corsie su `Segmented`, ricerca con `IconSearch`, errori su `--danger-dim`, caricamento con `StatusMark`; le righe nuove entrano con `chatReveal` come nel pannello Git.
- **Proposta di regola:** scheda neutra come quella d'integrazione della corsia (`--bg-raised`, bordo `--line`, `--radius-lg`, nessuna ombra); l'ambra sta solo nello `StatusMark` `attention` accanto al titolo `--ink`. «Applica» è `.ui-button-primary`, «Modifica» e «Ignora» sono `.ui-button-ghost`. Anteprima in mono 12/1.5 su `--bg-sunken`.
- **Stato vuoto (`EmptyState`):** icona Lucide neutra `--ink-faint` senza tessera (24 px, 20 in compatta), azioni `.ui-button-primary` / `.ui-button-secondary`, avviso di configurazione con lo schema della riga di attenzione (`--warn` al 15%, testo `--ink`, icona `--warn`), etichetta «Scorciatoie» in frase 12/500, pillole `kbd` a `--radius-full`; ingresso `rv-lift` a 240 ms.
- **Banner della chat vuota (`OmpWelcome`):** lockup del π di omp (griglia di `PI_LOGO`, 64 px) con la scritta `omp` in Inter 60/560 e la versione di `omp` in mono `--ink-faint`, sopra la riga guida `--ink-muted`. Intro di ~2,25 s ricalcata sul banner di Tern: contorno disegnato, scritta, riempimento con il gradiente diagonale della TUI (`#f84fcc → #9362f4 → #00dbe4`) che scorre, approdo su `--ink` del tema (la tacca resta al 45%). L'intro si vede **una volta per avvio della finestra**, sulla prima chat vuota visibile; le successive mostrano il fotogramma finale con `rv-blur`. Fotogramma finale = stato naturale (From-Only Rule).
  - **Caricamento** (avvio di omp, ripresa dallo storico; sostituisce gli skeleton del transcript): stesso lockup in fil di ferro, contorno del π e `-webkit-text-stroke` della scritta a 1 px, riempimenti spenti, riga «Caricamento sessione in corso...» al posto della guida nella stessa cella di griglia (nessun salto di altezza). Una maschera diagonale a 110°, larga il triplo del lockup, lo porta al 40% tranne una banda piena: giro lineare di 2,4 s, di cui 1,7 s di corsa (la banda è sul lockup per circa metà) e 0,7 s fermi fuori campo; con il movimento ridotto il contorno resta fermo in `--ink-muted`. A caricamento finito, se l'intro non è ancora stata vista, riparte dal contorno già tracciato (sequenza anticipata di 270 ms: contorno a gradiente che si spegne, riempimento, scritta che si riempie); altrimenti `rv-blur` sul fotogramma finale. Una sessione ripresa con messaggi sostituisce il banner con il transcript.

### Schede orizzontali (ColumnTabs)

Primitiva condivisa per la navigazione a schede delle colonne (`src/lib/ui/ColumnTabs.svelte` — D2).

- **Indicatore visivo:** linea singola da 2 px in `--brand` posizionata sul bordo inferiore O superiore (`indicatorPosition: 'top' | 'bottom'`), senza barre multiple né sfondi colorati.
- **Etichetta testuale:** font sans in etichetta da 12 px (peso 500, `letter-spacing: normal`, `text-transform: none`). È rigorosamente vietato il maiuscolo spaziato.
- **Attivazione manuale (The Manual-Activation Rule):** la navigazione con frecce (roving tabindex, salta le schede disabilitate) sposta solo il fuoco; la scheda si attiva esclusivamente su `Invio`, `Spazio` o click del mouse. Questa decisione architetturale evita il montaggio e il ricalcolo inutile dei pannelli pesanti sottostanti (terminali xterm, istanze Monaco Editor, grafici).
- **Connessione semantica:** attributi `id` e `aria-controls` accoppiati esplicitamente con i pannelli (`tabIdPrefix`, `panelIdPrefix`); la colonna o barra laterale collassata viene marcata con l'attributo nativo `inert`.

**The Single-Indicator Rule.** Le schede orizzontali mostrano un solo indicatore lineare da 2 px in `--brand` (sul bordo superiore o inferiore) e un'etichetta testuale non spaziata; niente doppie linee né sfondi colorati.

- **Descrizione (`tooltip`):** ogni scheda può portare un `Tooltip` (D8) per ciò che l'etichetta non dice, come la scorciatoia; l'etichetta resta il nome accessibile.
- **Consumatori:** testata sinistra «File · Git · Agente» e switch «Terminale · GUI» della colonna destra (`+page.svelte`), con etichette in frase; schede dell'inspector di Browser Studio.

### Tooltip accessibile (Tooltip)

Componente condiviso per etichette a scomparsa conforme a WCAG 2.1 SC 1.4.13 (`src/lib/ui/Tooltip.svelte` — D8).

- **Comportamento bidirezionale:** si apre sia su hover del mouse (`pointerenter`) sia su ricezione del focus da tastiera (`focusin`).
- **Persistente e hoverable:** il tooltip non scompare se il puntatore si sposta dalla sorgente sopra la bolla del tooltip stesso, e rimane visibile finché il trigger conserva il focus da tastiera.
- **Chiusura con Escape:** la pressione del tasto `Escape` ovunque chiude immediatamente il tooltip senza alterare la posizione del focus sul trigger.
- **Nessuna trappola:** non contiene elementi focalizzabili.
- **Accessibilità:** il testo descrittivo espone `role="tooltip"` e associa il trigger tramite `aria-describedby`; il controllo riceve separatamente il nome accessibile con `aria-label` o testo visibile. Non si applica un blanket purge dei vecchi `title`, ma una migrazione mirata ai controlli iconici.
- **Superficie:** fondo `--bg-raised`, bordo `--line`, raggio 6 px (`--radius-md`), ombra `--shadow-overlay`, didascalia da 11 px, z-index `--z-tooltip: 80`.

**The Accessible-Tooltip Rule.** I controlli iconici privi di testo visibile adottano `Tooltip` con `role="tooltip"` e `aria-describedby`/`aria-label`, con apertura bidirezionale hover/focus, persistenza sulla bolla ed `Escape` immediato.

- **Primi consumatori:** trigger iconici della barra del composer integrati in `MenuButton`.

### Finestra modale (Dialog)

Architettura modale nativa e accessibile per dialoghi e conferme (`src/lib/ui/Dialog.svelte`).

- **Architettura `<dialog>.showModal()`:** sfrutta le funzionalità native del browser; il dialogo viene promosso nel top layer con isolamento e rende automaticamente `inert` lo sfondo e i layer sottostanti, eliminando la necessità di un modal host o della gestione manuale dello stack di inert.
- **Trap focus integrato (`trapFocus` in `$lib/focusTrap.ts`):** gestisce la trappola ciclica del fuoco da tastiera, escludendo elementi nascosti, disabilitati o con `tabindex="-1"`. Supporta dialoghi annidati (solo il dialogo in cima gestisce la trappola), gestisce in sicurezza radici senza elementi focalizzabili e garantisce il ripristino sicuro del focus precedente alla chiusura (`restoreFocus: true`).
- **Accessibilità:** attributi `ariaLabel`, `ariaLabelledBy`, `ariaDescribedBy`; titolo semantico `<h2>`.
- **API:** titolo testuale `title`; snippet `header`, `body`, `footer`, `icon`, `children`, `actions` (azioni nella testata standard), `outside` (strati dentro il dialogo ma fuori dalla superficie); controllo con `open`, `onClose`, `dismissible`, `initialFocus`. `size="wide"` limita le finestre di lavoro a `min(1080px, 96vw)` × `min(86vh, 760px)`; `size="full"` lascia 32 px per lato alle revisioni che vivono di spazio (diff della corsia); `flush` lascia al consumatore padding, altezza e scorrimento del corpo.
- **Superficie e transizione:** fondo `--bg-overlay`, bordo `--line-strong`, raggio 10 px (`--radius-lg`), ombra `--shadow-overlay`. Titolo a 16 px / peso 550 (`Inter Variable`) con `text-wrap: balance`. Corpo `--bg-overlay`, piede `--bg-base`. Transizione d'ingresso e uscita con `rvLift` (240 ms, blur 3 px) applicata alla superficie dentro un positioner separato per non interferire con la centratura a griglia.

**The Top-Layer Dialog Rule.** Le finestre modali usano `<dialog>.showModal()` nativo del browser per garantire top-layer e isolamento inert automatico; nessun modal host personalizzato né gestione manuale dello stack.

- **Conferma (`ConfirmDialog`, `src/lib/ui/ConfirmDialog.svelte`):** una domanda, un testo o uno snippet di corpo e due azioni nel piede: annulla `.ui-button-ghost`, conferma `.ui-button-primary` o `.ui-button-danger` (`tone="danger"` per ciò che distrugge o interrompe) con il fuoco iniziale. Serve le conferme semplici: aggiornamento e riavvio di `omp`, rimozioni nei Provider.
- **Avvisi dentro un dialogo:** righe di traccia (12,5 px, testo `--ink`) con l'icona Lucide o lo `StatusMark` nel colore dell'esito, senza card né fondo tinto: una card dentro la superficie del dialogo sarebbe una superficie annidata. `AlertBanner` resta per gli errori che portano diagnostica o azioni.
- **Consumatori:** `CloseConfirmModal`, centro impostazioni con la conferma annidata di scarto, inspector delle icone, Model Health (dialogo annidato sopra le Impostazioni: il browser gestisce lo stack), dialoghi delle corsie (`LaneReviewModal` a `size="full"`, `LaneDispatchDialog`, `LaneProfileDialog`), guida scorciatoie, anteprima immagine (titolo = nome del file), aggiornamento di Studio, conferme di `+page.svelte` e Provider.
- **Eccezione documentata: Setup.** La finestra di primo avvio resta una struttura propria con gli stessi token (velo `--backdrop`, `--bg-overlay`, `--line-strong`, 10 px, titolo 16/550) perché ospita la TUI di `omp setup`: l'Esc nativo di `<dialog>` la chiuderebbe mentre la TUI lo usa, e un ingresso animato muoverebbe la viewport del terminale (Still-Room Rule). Entra con `rvLift` solo quando si apre su un passo senza terminale.

### Controlli form nativi opt-in (ui-input, ui-select, ui-button)

Classi CSS opt-in definite a livello globale in `src/app.css` per i controlli dell'officina:

- **Approccio opt-in:** nessuna regola distruttiva o reset universale sui tag `<input>`, `<select>` o `<button>`, garantendo che i controlli integrati in Monaco Editor, xterm.js o i canvas non vengano alterati.
- **Campi `.ui-input` e `.ui-select`:** altezza 30 px, padding orizzontale 8 px (`--space-2`), font UI da 13 px (`--text-body`, peso 450), fondo `--bg-sunken`, bordo `--line`, raggio 6 px (`--radius-md`), caret `--ink`. In hover passano a bordo `--line-strong`; a fuoco contorno/bordo `--brand`.
- **Pulsanti `.ui-button`:** altezza dal contenuto, padding 5 px 14 px, font UI da 11 px (`--text-caption`, peso 500), raggio 6 px (`--radius-md`), gap 8 px. Quattro varianti cromatiche:
  - `.ui-button-secondary`: fondo trasparente, bordo `--line`, testo `--ink`. Hover: fondo `--bg-hover`, bordo `--line-strong`.
  - `.ui-button-ghost`: fondo e bordo trasparenti, testo `--ink-muted`. Hover: fondo `--bg-hover`, testo `--ink`. È la secondaria accanto a una primaria piena (piede della scheda domanda, proposta di regola).
  - `.ui-button-primary`: fondo pieno `--brand`, bordo trasparente, testo `--on-brand`, peso 600. Hover: bordo `--on-brand`.
  - `.ui-button-danger`: fondo pieno `--danger`, bordo trasparente, testo `--on-danger`, peso 600. Hover: bordo `--on-danger`.
- **Chip `.ui-chip`:** pillola `3px 10px`, `--radius-full`, `--bg-raised`, bordo `--line`, didascalia 11/500 `--ink-muted`; hover `--bg-hover`/`--line-strong`/`--ink`. Lo stato scelto (`aria-pressed="true"`) è neutro: `--bg-active`, bordo `--line-strong`, testo `--ink` e una spunta da 12 px nel contenuto, mai un fondo brand.
- **Casella `.ui-checkbox`:** checkbox nativo (tastiera e `indeterminate` dal browser) da 16 px, `--radius-sm`, bordo `--ink-faint` su `--bg-sunken` (hover `--ink-muted`); scelto o indeterminato fondo e bordo `--brand` con spunta o trattino `--on-brand`. Il bordo a riposo è `--ink-faint` perché il contorno di un controllo vuoto deve reggere 3:1: misurato 4,79:1 su Titanium e 5,97:1 su Alabaster, contro 2,06 e 1,61 di `--line-strong`. Spunta `--on-brand` su `--brand` 5,41 / 4,53. Serve la selezione multipla dentro una lista (file da copiare in una corsia, correzioni del Model Health); una preferenza binaria resta uno `Switch`.
- **Tasto `.ui-kbd`:** piatto (Flat-By-Default Rule), mono 11 px tabulare, bordo `--line`, `--radius-sm`, padding `0 5px`, testo `--ink-faint`. Dove il tasto è il contenuto (guida scorciatoie) il testo sale a `--ink-muted`; nessun bordo inferiore spesso né ombra «3D». Lo usano scheda domanda, guida scorciatoie e testata del ciclo modelli.
- **Capacità `.ui-cap`:** chip in linea da 4 px, `--bg-base`, bordo `--line`, testo `--ink-muted`, icona da 11 px; il contesto (`.ctx`) in `--ink-faint` con il valore in mono tabulare. La descrizione sta nel `Tooltip`.
- **Primi consumatori:** `.ui-select` in `GeneralSection`; `.ui-button` (tutte e 3 le varianti) in `CloseConfirmModal`; `.ui-input` in `ShortcutsHelpModal`; `.ui-chip` in `SuggestionChips` e nel Task Editor («Usati spesso», direttive); `.ui-checkbox` in `LaneProfileDialog` e `ModelHealthModal`; `.ui-cap` in `ModelPickerList`, Ruoli e Catalogo.

### Gestione modelli nei form (ModelField, CycleDrawer)

- **Campo modello (`ModelField`, `src/lib/components/models/ModelField.svelte`):** trigger a sagoma `.ui-select` (30 px, `--bg-sunken`, raggio 6 px `--radius-md`, bordo `--line`, hover `--line-strong`), nome del modello in mono `--ink` con ellissi, provider in meta `--ink-faint` (11 px), chevron Lucide `IconChevronDown` a destra. Apre `MenuButton` da 400 px ancorato a 8 px con `ModelPickerList` dentro. Sostituisce `ModelPickerDropdown` (eliminato) e le copie locali nel Task Editor, nei Ruoli (modello primario e catena di riserva) e nel ciclo Ctrl+P.
- **Ciclo rapido (`CycleDrawer`, `src/lib/components/models/CycleDrawer.svelte`):** colonna da 270 px che si piega in larghezza nel layout di RolesTab con `--ease-reveal` a 240 ms (`--dur-slow`) e dissolvenza della sfocatura a 3 px (`rvLift` From-Only Rule). Testata 32 px con `IconCycle` neutra `--ink-muted`, titolo in etichetta 12/600 in frase, scorciatoia `Ctrl+P` in `<kbd class="ui-kbd">`, chiusura iconica da 28 px con `Tooltip`. All'apertura porta il fuoco all'interno; Esc chiude senza propagarsi al dialogo padre; alla chiusura restituisce il fuoco al trigger nei Ruoli. Niente colori `--warn` sulle rimozioni: pulsante cestino con hover `--danger`.

### Conteggi e card di scelta (ui-count, ui-choice)

- **Conteggi `.ui-count`:** pillole meta tabulari da 16 px con padding `0 5px`, raggio pieno, fondo `--bg-hover` e colore ereditato. La variante `.attention` usa `--warn` al 22% sopra la superficie e testo `--ink`; la navigazione delle impostazioni associa un `Tooltip` che spiega il numero. Nessun punto colorato senza significato leggibile.
- **Card `.ui-choice`:** una `<label>` contiene il radio nativo e l'anteprima, con padding 12 px, bordo `--line` e `--radius-md`. Condivide hover e selezione con `.ask-opt`: fondo `--bg-hover` in hover, bordo e anello interno `--brand` più fondo al 7% quando scelta. Il testo rimane `--ink`.
- **Anteprime:** componenti reali per quote e righe di limite, perché non producono azioni; schemi tokenizzati per disposizione delle colonne, coda e temi, senza montare sessioni, terminali o editor.

### Campo prompt fuori dalla chat (PromptField)

- **Registro:** `ComposerEditor` nella sagoma `.composer-shell`, font UI 15/24, fuoco visibile da 2 px `--brand`; minimo 96 px e massimo 280 px con scorrimento.
- **Testo semplice:** nessuna palette o ricostruzione dei badge nelle impostazioni globali. `@file` e `/skill:...` restano letterali anche quando si riapre una bozza o arriva testo generato dall'AI.
- **Tastiera:** Invio va a capo; Ctrl/⌘+Invio conferma; Esc annulla il modulo, non il dialogo padre. L'azione `escapeDismiss` consuma Esc in capture prima dei listener nativi del focus trap; il `ComposerEditor` abilitato espone `tabindex="0"`.
- **Consumatori:** testo delle direttive, istruzioni per generarle o affinarle e prompt dei suggerimenti.


### Interruttore (Switch)

Primitiva accessibile per preferenze binarie (`src/lib/ui/Switch.svelte`).

- **Geometria:** traccia da 32×18 px con raggio completo (`--radius-full`), cursore circolare (thumb) da 12×12 px con corsa di 14 px.
- **Colori:** a riposo traccia `--bg-sunken` con bordo `--line-strong` e cursore `--ink`. Quando attivo (`checked`), traccia e bordo passano a `--brand` e cursore a `--on-brand`.
- **Stato di fuoco:** anello visibile di contorno da 2 px in `--brand` con offset di 2 px.
- **Accessibilità:** implementato con `<input type="checkbox" role="switch">` nativo, etichetta testuale opzionale cliccabile, supporto tastiera con Spazio.
- **Primi consumatori:** `GeneralSection` e `ProjectBarSection`.

### Selettore segmentato (Segmented)

Primitiva per la selezione mutualmente esclusiva di viste o modalità (`src/lib/ui/Segmented.svelte`).

- **Stato attivo neutro (The Neutral-Active Rule):** il pulsante attivo prende fondo `--bg-active`, testo `--ink` e peso 600. Non usa mai il colore `--brand`, preservando l'accento unicamente per azioni primarie, focus e indicatori attivi.
- **Contenitore:** fondo `--bg-sunken`, bordo perimetrale da 1 px in `--line`, raggio 6 px (`--radius-md`), divisori interni da 1 px `--line`.
- **Navigazione da tastiera:** roving tabindex con frecce direzionali (Orizzontali e Verticali) che saltano automaticamente le opzioni disabilitate; selezione immediata con `Spazio` o `Invio`. Fuoco con contorno da 2 px `--brand` e offset -2 px.
- **Modalità `tablist`:** le opzioni diventano `role="tab"` con `aria-controls` verso i pannelli (`tabIdPrefix`, `panelIdPrefix`); serve alle sottoschede dentro una colonna che ha già una `ColumnTabs`. Con `fill` occupa tutta la larghezza a opzioni di pari misura.
- **Conteggi:** `count` opzionale per opzione, pillola condivisa `.ui-count` meta tabulare con colore ereditato su `--bg-hover`; con `countTone: 'attention'` fondo `--warn` al 22% e testo `--ink`.
- **Opzioni iconiche:** un'opzione può definire un'icona Lucide (`icon`) che sostituisce l'etichetta; l'etichetta testuale rimane come nome accessibile (`aria-label`) e testo del `Tooltip` conforme a WCAG (D8). Pulsante iconico da 28 px con altezza 26 px e `--icon-size: 14px`, divisori da 1 px preservati.
- **Primi consumatori:** `ProjectBarSection`, sottoschede del pannello Agente, filtro corsie dello storico sessioni, selettore vista file nell'Editor (`code`/`split`/`preview`), switch Anteprima/Editor del Laboratorio, modalità e dispositivo in `PreviewViewer`.

### Cursore a passi (Slider)

Primitiva per valori numerici discreti e continui (`src/lib/ui/Slider.svelte`).

- **Geometria di default:** traccia alta 20 px a raggio completo (`--radius-full`) con fondo `--bg-sunken` e bordo da 1 px `--line`. Cursore circolare da 22×22 px in `--ink` che sporge dalla traccia, con un anello di 2 px nel colore della superficie che lo ospita (`--slider-ring`, default `--bg-raised`): lo stacca dal riempimento senza ombra.
- **Passi discreti e magnetismo:** fino a 30 passi visualizza punti da 4 px dentro la traccia (`--on-brand` al 60% sul riempimento, `--ink-faint` oltre); i punti vicini al cursore si ingrandiscono a 1.5x (magnetismo) prima dell'aggancio allo scatto. Nessuna etichetta sotto i passi.
- **Flat-by-default:** né la traccia né il cursore possiedono ombre (`box-shadow: none`), in stretta conformità alla regola Flat-By-Default.
- **Stato di fuoco e trascinamento:** contorno da 2 px in `--brand` con offset di 2 px sulla traccia; durante il drag il cursore si espande a scala 1.06x.
- **Riempimento:** barra `--brand` a raggio completo dal bordo sinistro fino al centro del cursore.
- **Accessibilità:** `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext`, supporto per frecce (passo singolo), Pagina Su/Giù (passi multipli) e Home/End.
- **Slider del thinking (`ReasoningSlider`):** sopra la traccia solo il nome del livello, centrato, in titolo 16/550 `--brand-ink` (6,48:1 su `--bg-raised`). La descrizione del livello sta nel valore accessibile (`aria-valuetext`), non a schermo. Il consumatore sceglie i livelli offerti: la chat non ha «Auto», che vale per task e ruoli.
- **Consumatori:** `ReasoningSlider` nel popover del thinking del composer (320 px, padding `12px 16px 16px`), nella sezione Esecuzione del Task Editor e nei Ruoli.

**The Thinking-Slider Rule.** Il livello di thinking si sceglie sempre con lo slider
(`ReasoningSlider`), ovunque: inline dove si configura (Task Editor, Ruoli), in un popover
da 320 px aperto dal trigger con il misuratore a 5 barre nel composer della chat. Non
esistono menu a elenco dei livelli: un livello è un punto su una scala, non una voce fra tante.

### Scheda domanda

Sostituisce il composer quando l'agente chiede, e ne prende la sagoma.

- **Superficie:** `--bg-raised`, bordo `--line-strong`, `--radius-2xl`, `--shadow-raise`, padding `12px 16px 0`, altezza massima 58vh con scorrimento interno e piede appiccicato.
- **Domanda:** voce chat a peso 500 (15 px/1.45); dettaglio in etichetta `--ink-muted`. Sopra una domanda singola non c'è etichetta: l'intestazione breve inviata dall'agente compare solo come nome dei passi nelle domande multiple.
- **Passi:** tab compatte in didascalia; la corrente è in negativo, quelle completate hanno la spunta `--success`. Il contatore «N/M» (meta tabulare `--ink-faint`, senza maiuscolo) compare solo con più di una domanda, anche quando il titolo di omp porta «1/1».
- **Anteprima in arrivo** (`AskStreamPreview`): nel flusso del transcript, stessa sagoma a `--radius-2xl` senza ombra.
- **Opzioni:** righe `9px 12px`, `--radius-md`, bordo `--line`. Hover `--bg-hover` al 60% con bordo `--line-strong`. La scelta prende bordo `--brand`, anello inset da 1 px e fondo accento al 7%. Radio 16 px (punto 6 px) o casella con raggio 5 px; scorciatoia `1–9` in `kbd`.
- **Consigliata:** pillola con fondo `--success` al 14%, testo `--success`, anello inset al 25%.
- **Piede:** «Decidi tu», suggerimenti di tastiera, azioni a destra. L'azione primaria è in `--brand` con testo `--on-brand` e peso 600; quella secondaria è un pulsante fantasma.
- **Parti condivise:** domanda, dettaglio, contatore, opzioni e «Consigliata» sono classi globali in `src/app.css` (`.ask-text`, `.ask-detail`, `.ask-counter`, `.ask-options`, `.ask-opt`, `.ask-opt-body/-label/-desc`, `.ask-rec`), i tasti usano `.ui-kbd`: `AskCard` e il Companion le usano identiche.

### Finestra companion

Una piccola Studio sempre in primo piano: voce per scrivere e leggere, officina per card e coda.

- **Superficie (D4):** opaca, tela `--bg-sunken`, bordo `--line-strong`, `--radius-lg`. Nessuna trasparenza sopra il desktop.
- **Modalità:** a scomparsa la finestra adatta l'altezza al contenuto e la puntina resta sempre a vista (`--ink-faint`, 28 px, `Tooltip`); fissata compare la testata da 32 px della cornice con logo, contatore d'attenzione (schema della riga di attenzione, meta tabulare) e la puntina attiva neutra (`aria-pressed`, `--bg-active`/`--ink`). Il bordo non cambia: la modalità la dice la puntina.
- **Movimento:** evocazione `rv-lift` 240 ms con blur 3 px; uscita di 120 ms (`opacity` e blur 3 px) prima di `hide()`, per Esc, blur, auto-hide, chiusura, focus progetto e scorciatoia globale; con il movimento ridotto si nasconde subito. Le sezioni interne si piegano con `trayFold` a `--dur-tray`, e la finestra segue l'altezza del contenuto a ogni fotogramma.
- **Composer:** la sagoma del composer ridotta: `ComposerEditor` 15/24, allegati e `@`, suggerimenti `#` `/` `!` in `.ui-chip`, invio `.composer-send-btn`; niente modello né thinking (il ruolo si sceglie con `!`). Badge `#progetto` e `!ruolo` neutri (`--bg-hover`, anello `--line`) con pallino d'identità da 7 px (progetto dalla rampa di riempimento, ruolo da quella d'inchiostro, `default` `--brand-ink`); un modello non ha pallino. Stato, esiti ed errori sono righe di traccia sotto la sagoma con il solo colore sull'icona.
- **Card:** lastra `--bg-base`, bordo `--line`, `--radius-lg`; con una domanda aperta prende la sagoma della scheda domanda (`--bg-raised`, `--line-strong`, `--radius-2xl`, `--shadow-raise`) e respira in ambra. Stato con `StatusMark`; il colore del progetto resta nel punto d'identità (D1). Entrano con `chatReveal` e si riordinano con `flip` a 210 ms.
- **Coda:** titolo inerte e «Avvia» iconico sempre visibile (Read-Before-Run Rule), indice in meta tabulare, il prossimo in `--brand-ink`.
- **Domanda:** parti condivise di `AskCard`; le opzioni inviano al click, quindi niente radio e indice in meta (non una scorciatoia); contesto in traccia 12,5/1.5 con Markdown denso.

### Bolla dell'utente

- **Bolla:** a destra, larga al massimo l'80%, `--bg-raised`, bordo `--line`, `16px 16px 6px 16px`, padding `10px 14px`, voce chat. Entra con `rv-lift`.
- **Allegati:** miniature da 56 px sopra la bolla.
- **Contesto dell'editor:** tag `--bg-base` in didascalia sotto la bolla; il file attivo ha bordo accento al 40%.
- **Azioni del messaggio:** pulsante «…» da 24×20 px sotto la bolla, allineato a destra, `--ink-faint` (hover `--bg-hover`/`--ink-muted`), visibile solo al passaggio o con il fuoco nel messaggio, come il piè del turno. Apre il `ContextMenu` con «Dirama da qui», «Modifica e riprova» e «Copia testo»; lo stesso menu si apre col tasto destro sulla bolla, tranne quando c'è una selezione (vince «Copia»). Le voci di ramo non spariscono a metà turno: restano disabilitate con il motivo nel suggerimento.
- **Piè del turno:** accanto a «Copia» compare «Dirama da qui» con `IconFork`, stessa didascalia; disabilitato al 50% con il motivo nel `Tooltip`.

### Pannello «Rami»

- **Superficie:** la stessa del cassetto dei subagenti: dialog laterale a destra sopra la chat (85%, massimo 520 px), `--bg-overlay`, `--shadow-overlay`, fondale `--backdrop`, `rv-lift` 240 ms con blur 3 px, Esc chiude e il fuoco torna al composer. Testata 13 px con `IconGitBranch` `--brand-ink`, titolo in etichetta 12/600, conteggio dei punti di diramazione in `.ui-count`, Aggiorna e Chiudi iconici da 28 px con `Tooltip`.
- **Righe:** traccia 12,5/1.45 (è un ispettore, come `SubagentDrawer`), padding `6px 8px`, `--radius-md`, hover `--bg-hover`. Un nodo per messaggio utente: punto da 9 px vuoto (`--ink-faint`) fuori dal ramo attivo, pieno `--brand` sul ramo attivo; «sei qui» in `--brand-ink` e fondo `--bg-active` sull'ultimo nodo del ramo attivo. Ora in meta tabulare a destra, label di omp in chip mono `--bg-hover`.
- **Rami:** il ramo attivo è una rotaia verticale dritta da 1 px (`--brand` al 55% su `--line`); i rami alternativi rientrano di 16 px e si staccano con un gomito arrotondato in `--line`. Nessun colore per ramo: la posizione dice il ramo, il riempimento dice quello attivo.
- **Interazione:** `role="tree"` con roving tabindex (frecce, Home/End, `Shift+F10` o tasto menu per le azioni). Clic su un ramo inattivo = lo apre come nuova sessione; sul ramo attivo apre il menu delle azioni; «…» per riga al passaggio. Piede `--bg-surface` con la nota in meta che aprire un ramo crea una sessione nuova e «Passa al Terminale» `.ui-button-ghost`.

### Testo dell'agente

- **Prosa:** senza contenitore, rivelata per frasi (§ Grammatica del movimento); blocchi interi (codice, tabelle, citazioni) con `rv-lift`.
- **Elenchi:** punti da 5 px in `--ink-faint`, numeri in mono `--ink-faint` allineati a destra.
- **Citazioni:** rotaia neutra da 2 px e testo `--ink-muted`.
- **Codice in linea:** mono su `--bg-hover`, `--radius-sm`.
- **Blocchi di codice:** su `--bg-sunken` con bordo `--line`, intestazione dei file e copia con conferma.

### Righe di traccia e gruppi di tool

La memoria leggera del turno.

- **Dal vivo:** l'intestazione «Al lavoro» è in `.text-shimmer`, con conteggio e durata che scorrono; le righe attive hanno spinner da 12 px ed etichetta che luccica; lo scorrimento resta agganciato al fondo entro 24 px.
- **Concluso:** una riga riassuntiva in traccia, che si apre su click e mai da sola. Contiene spunta, «N chiamate · durata», icone per categoria con conteggio (lettura, ricerca, comando, modifica, web, ragionamento), `+N`/`−N` e «N con errori».
- **Riga:** icona di categoria 14 px, verbo in sans `--ink-muted`, argomento in mono `--ink-faint`, esito in meta allineato a destra.
- **Chiamate parallele:** raggruppate dalla rotaia neutra da 2 px.
- **Corpo espanso:** `--bg-sunken`, bordo `--line`, `--radius-sm`, rientro di 26 px.
- **Avvisi di sistema** (compattazione, nuovo tentativo, regole, errori): stessa riga di traccia, con un'icona da 14 px e il dettaglio espandibile.

### Righe di stato nel racconto

Todo, subagenti e job in background lasciano nel transcript righe di traccia
(`TodoTraceRow`, `SubagentTrace`, `TaskRow`, `SubagentResultCard`) con lo stesso
vocabolario del vassoio.

- **Segni:** sempre `StatusMark`, mai glifi Unicode; l'elenco dei todo usa `IconQueue`. I passi già raccontati restano fermi (`active={false}`): lo stato vivo sta nel vassoio.
- **Numero di fase:** testo meta mono `--ink-faint` tabulare prima dell'etichetta.
- **Esito:** il completato non ha testo, lo dice il disco neutro (resta l'etichetta `sr-only`); fallito e bloccato in meta `--danger` senza fondo; annullato in meta `--ink-muted`.
- **Apertura:** elenchi e dettagli si piegano con `tray-in`/`tray-out`; chevron con `--dur-fast`/`--ease-out`.
- **Avvio della sessione:** `StatusMark` `running` accanto all'etichetta `.text-shimmer` a 13,5 px; cronometro in meta tabulare.

### Pannello del subagente

Pannello laterale a tutta altezza, aperto dal nome di un subagente nel vassoio o nel transcript.

- **Superficie:** `--bg-overlay`, angoli vivi sul bordo destro, velo a `--z-backdrop`, pannello a `--z-dialog`.
- **Contenuto:** transcript in traccia 12,5/1.5 con `Markdown` (eccezione documentata alla Two Voices Rule), ruoli in meta mono, chiamate ai tool in traccia.
- **Movimento e tastiera:** entra ed esce da destra con `rvLift` (`x: 12`, 240 ms, blur 3 px); `trapFocus` tiene Tab dentro, Esc chiude e il fuoco torna a chi l'ha aperto.


### Colonna centrale e visualizzatori (Editor, ImageViewer, PreviewViewer, DiagramViewer)

Superfici di officina per la consultazione e modifica del codice, delle immagini e degli schemi.

- **Testata fusa (D7):** una sola barra da 32 px sul pozzo (`--bg-sunken`) con bordo inferiore `--line`, presente anche a editor vuoto per non far saltare la fascia superiore dell'app; controlli e trigger iconici a 28 px con `--radius-md`.
- **Schede dell'editor:** 12 px (`--text-label`), inattive `--ink-muted`, hover `--bg-hover`, attiva `--ink` con indicatore lineare singolo da 2 px `--brand` sul bordo superiore (D2). Pulsante di chiusura X da 12 px a comparsa con `Tooltip` e raggio 6 px.
- **Modifiche non salvate:** punto pieno da 6 px in ambra (`--warn`) a raggio completo posizionato nella cella fissa della X (larghezza della scheda immutata) accompagnato da etichetta in corsivo e testo per screen reader (`.sr-only`), mai affidato al solo colore.
- **Splitter dell'editor:** divisore orizzontale da 6 px invisibile a riposo con linea centrale da 1 px `--line`. In hover e durante il trascinamento (`isResizing`) si colora unicamente la linea interna da 1 px in `--brand`, mai tutta la fascia. Gestione pointer events con pointer capture nativo.
- **Anteprima Markdown nell'editor:** lettura in voce di prosa a 15/28 px (`--text-prose`) in una colonna centrata da 720 px, come da Two Voices Rule, senza forzare scale dense d'officina.
- **Visualizzatore immagini (`ImageViewer`):** solo tela interattiva; nome file, dimensioni, peso e zoom vivono nella barra dell'editor (32 px, azioni a destra). Sequenza controlli zoom unificata (`Adatta`, `−`, `%`, `+`) con cifre tabulari. Errore di caricamento su card `--radius-lg` con titolo `--danger`. Panning continuo senza transizione, zoom animato a `--dur-fast`.
- **Anteprima sandbox (`PreviewViewer`):** barra fusa da 32 px con titolo in etichetta 12/500, commutatore vista (anteprima/codice) e dispositivo (desktop/tablet/mobile) su `Segmented`, pulsanti copia e ricarica fantasma, X con `Tooltip`. La vista codice adotta l'evidenziazione Monaco tramite `colorizeCode` in mono 12/1.5 (`--text-mono`) a piena altezza, senza l'accordion della chat.
- **Whiteboard Mermaid (`DiagramViewer`):** toolbar fusa da 32 px con titolo, `Adatta` fantasma, zoom iconici e chiusura. I colori di Mermaid passano da `tokenHex()` di `theme.ts` per garantire esadecimali validi al parser `khroma` (sfondo trasparente, testi `--ink`, bordi `--brand`, nodi `--bg-raised`/`--bg-overlay`), eliminando ogni crash da `oklch()`. Re-render reattivo su `onThemeChange`. Etichette SVG pure con `htmlLabels: false` per superare la sanitizzazione DOMPurify. Stato di caricamento con `StatusMark` `running`.

### Browser Studio e Laboratorio

- **Cornice:** toolbar da 32 px sul pozzo con controlli da 28 px; Browser e Lab seguono il tema di `omp`. La pagina remota e il canvas dei prototipi restano indipendenti.
- **Inspector (D5):** riquadri sopra la pagina con bordo `--brand` e fondo `color-mix(in srgb, var(--brand) 18%, transparent)`; etichette su superficie opaca `--bg-raised`, testo accentato solo `--brand-ink`. Il bordo da 2 px identifica la selezione di un elemento della pagina, non una rotaia decorativa.
- **Esiti:** permessi, stati HTTP ed etichette console mantengono colore semantico più testo su fondo neutro. Metodi HTTP, tipi di azione e componenti non sono esiti e restano neutri.
- **Registrazione:** punto `--danger` con ping soltanto mentre registra, è nello schermo e nel documento attivo, con animazioni abilitate. Arresto in corso e registrazione conclusa restano fermi. Il takeover è neutro con icona e testo, senza campiture semaforiche.
- **Laboratorio:** la revisione storica usa una riga neutra con icona `--warn`, «Ripristina» secondaria e «Torna alla corrente» fantasma. Gli errori di build/runtime usano `AlertBanner` con «Chiedi di correggere» primaria e lista diagnostica pieghevole a 210 ms.
- **Primitive:** revisioni e permessi su `MenuButton`; finestre modali su `Dialog`; schede dell'inspector su `ColumnTabs`; caricamento e compilazione su `StatusMark`; suggerimenti iconici su `Tooltip`.

### Banner diagnostico (AlertBanner)

Superficie condivisa per segnalazioni di sistema, configurazione e diagnostica (`SetupModal`, `ModelHealthModal`, `NotificationsSection`).

- **Superficie e colore:** neutra su `--bg-raised`, bordo da 1 px `--line`, raggio 10 px (`--radius-lg`). Il colore semantico appartiene esclusivamente all'icona Lucide (`IconCircleAlert` `--danger`, `IconWarning` `--warn`, `IconCircleCheck` `--success`, `IconInfo` `--ink-muted`), conformemente alla Outcome-Only Color Rule. Nessuna campitura pastello o tinta di fondo su tutto il riquadro.
- **Tipografia:** titolo in corpo 13/600 `--ink`, messaggio in etichetta 12 px `--ink-muted`, etichetta diagnostica in didascalia 11/500 `--ink-faint` in frase.
- **Azioni e pulsanti:** varianti `.ui-button` native a 28 px (`.ui-button-primary`, `.ui-button-secondary`, `.ui-button-danger`), chiusura con `Tooltip` e `--icon-size: 14px`. Feedback di copia normalizzato a 1500 ms.
- **Movimento:** entra ed esce piegando l'altezza tramite `chatReveal` (JS-driven per assecondare la rimozione dal genitore con blur 6 px e distanza 0). Il dettaglio diagnostico si piega con `tray-in`/`tray-out` e `Lingering` a `--dur-row` (210 ms).
### Schede di esito nel transcript

La scheda d'integrazione della corsia (`LaneLandingCard`) è una superficie neutra: bordo
`--line`, `--radius-lg`, nessuna ombra né vetro. L'esito colora solo icona e testo di stato;
le azioni usano `.ui-button-primary` (`--on-brand` su `--brand`) e `.ui-button-secondary`.

### Ragionamento e piè di turno

- **Ragionamento dal vivo:** «Sto pensando…» in `.text-shimmer` a 13,5 px.
- **Ragionamento concluso:** «N righe di ragionamento» in didascalia, che si apre su un corpo 13/22 `--ink-muted` con la rotaia neutra. L'ultima scelta (aperto o chiuso) diventa il default della sessione.
- **Piè di turno:** didascalia `--ink-faint`, `rv-blur` 400 ms/4 px. A sinistra «Copia» (con «Copiato» per 1,5 s), a destra in meta tabulare chiamate · durata · modello in mono · costo in mono, con separatori a opacità 0,5.

### Chip di suggerimento e coda

- **Suggerimenti:** solo a composer vuoto, fermo, senza allegati e con la palette chiusa. Pillole `3px 10px` su `--bg-raised` con bordo `--line`, didascalia `--ink-muted`, indice `Alt+N` in `kbd`. Il click precompila e non invia mai. Si naviga con roving tabindex.
- **Coda:** chip della coda di omp (steer prima, follow-up poi). Ogni chip ha «Modifica» (torna nell'editor con le sue immagini), «Rimuovi» e, sui follow-up, «Steer ora» (`promote_queued_message`). Il testo del chip è opaco: si mostra così com'è e si rimanda identico a omp.

### Pulsante «in fondo»

Compare quando l'utente risale: cerchio da 28 px, `--bg-overlay`, bordo `--line`,
`--radius-full`, `--shadow-overlay`, freccia da 16 px. Nessun testo: il nome accessibile
e il `Tooltip` dicono «In fondo».

### Quota, tutte le code e barre superiore e inferiore

- **Quota:** una sola chip ad anello, trigger `--radius-md` (6 px), didascalia e percentuale mono tabulare. Le righe di limite sono lineari e sobrie, con label sans e valori mono tabulari; niente menisco, onde, rigature decorative o varianti selezionabili.
- **Barra superiore:** Impostazioni, Companion, Coda e Quota sono alti 28 px, con padding orizzontale da 8 px e contenuto centrato. L'allineamento di Quota è locale a `TopBar`: la chip del Companion conserva la propria altezza compatta e l'anello resta da 15 px.
- **Controlli finestra Windows:** sagome Rounded da 16 px, tratto uniforme da 1,8 px con terminali e giunzioni arrotondati; quadrato Massimizza con raggio 2,4 px e finestre sovrapposte Ripristina con raggio 2 px. Sono SVG locali per riprodurre le sagome scelte, non nuove icone globali. Aree cliccabili da 44 × 48 px e hover Chiudi in `--danger` invariati; su macOS e Linux restano le decorazioni native.
- **Colori:** quota sana neutra, oppure `--success` solo con l'opzione semaforo; quota bassa `--warn`, critica/esaurita `--danger`. Il segnale cromatico è accompagnato da testo o descrizione accessibile. Nessuna palette quota cablata nel layout.
- **Popover quota e code:** superfici non modali nel top-layer nativo tramite `anchoredPopover`, `--bg-overlay`, bordo `--line-strong`, raggio 10 px e `--shadow-overlay`; ancoraggio `bottom-end` a 8 px dal trigger, larghezze 380 e 420 px, fallback in alto a destra per apertura da scorciatoia o Companion. Titoli 16/550 bilanciati; ingresso `rvLift` a 150 ms e blur 3 px.
- **Tastiera:** niente velo, `aria-modal` o trap di Tab. Click esterno e Tab fuori chiudono senza rubare il nuovo focus; Escape e chiusura esplicita restituiscono il focus al trigger. I controlli iconici usano `Tooltip`; il caricamento usa `StatusMark`.
- **Task in coda:** cliccare il testo apre o chiude la lettura, mai l'avvio. «Avvia», «Nuova corsia» e «Modifica» sono sempre visibili anche in vista compatta. Shift su «Avvia» forza la corsia isolata; Ctrl mantiene il seguito sul progetto. La stessa riga `QueueTaskItem` serve il pannello Agente e tutte le code. Il prompt si rende in Markdown denso alla misura dell'anteprima, chiuso e aperto (§ Colonna sinistra, pannello Agente).
- **Barra inferiore:** 26 px, sole versioni Studio/OMP e `StatusMark` con etichetta breve; niente duplicazione del progetto né prefisso «Stato:». Lavoro/caricamento in corso con spinner condiviso, completato neutro, attenzione ambra. Un aggiornamento riuscito è un esito positivo (`--success` / `--on-success`).

**The Exhausted-Quota Interrupt Rule.** D3 ammette il respiro solo per una quota
esaurita, visibile, nello schermo, nel documento attivo e con animazioni abilitate
senza `prefers-reduced-motion`. Il respiro varia bordo e fondo, non l'opacità del
testo: il contrasto rimane AA per tutto il ciclo. Critica non esaurita e indicatori
della finestra lunga sono statici; niente bobbing o aloni pulsanti.

**The Read-Before-Run Rule.** Nelle code un gesto sul prompt serve a leggere.
L'esecuzione richiede sempre un'azione esplicita «Avvia» o «Nuova corsia»; selezione
del testo e link/menzioni conservano la propria interazione.

### Icone

Solo Lucide, passando da `src/lib/icons.ts` con nomi di funzione. La misura appartiene
al contenitore (`--icon-size`, default 14 px; 15–16 px per le azioni primarie del
composer; 12 px per le spunte in linea). Mai la prop `size`, mai una `class` passata a
un'icona, mai un'emoji.

## Do's and Don'ts

### Do:

- **Do** scrivere e rileggere un prompt completo nella voce chat (15/24); mantenere densi solo i task in coda (anteprima e dettaglio) e i titoli di sessione nelle liste, come da Two Voices Rule.
- **Do** mettere lo stato vivo nel punto d'azione e lasciarne nel racconto una sola riga espandibile.
- **Do** far entrare ogni elemento nuovo con `--ease-reveal` e keyframe solo `from`, anche nella cornice: menu a 150 ms, righe a 210 ms, pannelli e dialog a 240 ms, sezioni che si piegano a 420 ms.
- **Do** derivare ogni tinta con `color-mix` da un token, e usare `--on-*` per il testo sui riempimenti pieni.
- **Do** accompagnare verde, rosso e ambra con un testo o un'icona.
- **Do** usare `tabular-nums` su ogni numero che cambia.
- **Do** scegliere il raggio dal ruolo della superficie (16 conversazione, 12 agganciato, 10 galleggiante/dialog, 6 controllo, 4 in linea).
- **Do** annunciare i cambi di stato con una sola regione `aria-live="polite"` aggregata.
- **Do** mantenere un fuoco visibile su ogni controllo: contorno da 2 px `--brand`, distanza 2 px.
- **Do** usare un disco neutro (`--ink`) con spunta `--bg-raised` da 10 px per lo stato completato (D1).
- **Do** animare spinner e segni di stato solo se visibili, attivi, nello schermo e nel documento attivo (The Alive-and-Visible Rule).
- **Do** usare un indicatore lineare singolo da 2 px `--brand` sul bordo superiore o inferiore per le schede orizzontali senza maiuscolo spaziato (D2).
- **Do** richiedere attivazione manuale (Invio, Spazio o click) sulle schede con pannelli complessi (`ColumnTabs`).
- **Do** adottare `Tooltip` accessibile conforme a WCAG 2.1 SC 1.4.13 sui controlli iconici privi di etichetta testuale (D8).
- **Do** usare l'elemento nativo `<dialog>.showModal()` del browser con isolamento top-layer e trap focus per le finestre modali (`Dialog`).
- **Do** usare le classi opt-in `.ui-input`, `.ui-select`, `.ui-button` per non alterare Monaco Editor o xterm.
- **Do** mantenere lo stato attivo del selettore segmentato (`Segmented`) neutro (`--bg-active`), senza tinte brand.
- **Do** unificare l'altezza delle toolbar della colonna centrale a 32 px fondendo l'header di colonna nella vista attiva (D7).
- **Do** mostrare lo stato non salvato con punto CSS da 6 px in ambra ed etichetta in corsivo, senza affidarlo al solo colore.
- **Do** colorare solo la linea interna da 1 px in hover e drag sullo splitter dell'editor, mai tutta la fascia.
- **Do** risolvere i colori del tema in esadecimale tramite `tokenHex()` per canvas e parser esterni (Mermaid/khroma).
- **Do** mantenere lo Slider privo di ombre (`box-shadow: none`) con traccia 20 px e cursore 22 px che sporge, staccato da un anello nel colore della superficie.
- **Do** scegliere il thinking sempre con lo slider (Thinking-Slider Rule), inline o nel popover del composer.
- **Do** scegliere un modello in un form con `ModelField` (sagoma `.ui-select`, `MenuButton` da 400 px, `ModelPickerList`), lo stesso nel Task Editor, nei Ruoli e nel ciclo Ctrl+P.
- **Do** usare `ConfirmDialog` per ogni conferma semplice e una riga di traccia, non una card, per un avviso dentro un dialogo.

### Don't:

- **Don't** animare la viewport del terminale né il contenuto delle colonne durante lo switch di progetto.
- **Don't** sovrapporre controlli, banner o veli alla viewport del terminale: lo Stop sta nella testata, gli errori del provider li mostra la TUI (Clear-Viewport Rule).
- **Don't** lasciare in movimento qualcosa che non è più vivo o che sta in un contenitore chiuso.
- **Don't** usare loop infiniti da 1 ms per reduced-motion: usare `animation: none`.
- **Don't** usare `white`, `black`, `rgba()` od `oklch()` letterali nei componenti.
- **Don't** mettere strisce laterali colorate come accento: l'unica linea verticale spessa è la rotaia neutra da 2 px.
- **Don't** usare `backdrop-filter` su una superficie sotto cui non scorre niente.
- **Don't** usare il gradient text fuori da `.text-shimmer` su un'etichetta viva.
- **Don't** mettere ombre su slider, switch, controlli form, righe, bolle, chip o pulsanti in linea, né ombre fuori dai tre token.
- **Don't** colorare di verde un'area o un elemento completato: il completato è neutro.
- **Don't** usare il maiuscolo spaziato nelle schede orizzontali o come eyebrow sopra le sezioni, né un'etichetta sopra una domanda singola.
- **Don't** aprire da solo un dettaglio (tool, ragionamento, subagente): si apre solo su click.
- **Don't** usare un titolo in prosa più piccolo del corpo.
- **Don't** usare `z-index` arbitrari, token vietati come `z-modal` o emoji come icone.
- **Don't** introdurre attributi `title` nativi sui trigger dei menu o della barra: adottare `Tooltip`.
- **Don't** creare modal host manuali o stack personalizzati di inert quando il browser supporta `<dialog>.showModal()`.
- **Don't** impilare l'header di colonna (`.col-header`) sopra la toolbar della vista figlia, creando doppie o triple barre.
- **Don't** tingere l'intero fondo di un banner col colore semantico dell'esito: il riquadro resta neutro e solo l'icona porta il colore.
- **Don't** passare stringhe `oklch()` o `color-mix()` non risolte a motori di rendering SVG che richiedono formati colore legacy.
- **Don't** usare il repertorio dell'«AI slop»: glassmorphism decorativo, card con bordo sottile e ombra larga, raggi oltre 16 px, eyebrow maiuscole sopra le sezioni, marcatori `01 / 02 / 03`, sfondi a griglia, illustrazioni SVG «sketchy».

## Debito di allineamento

### A. Fondazioni completate (Task 1)

Le fondazioni normative e le primitive condivise di Design v2 sono state implementate
e consolidate nel codice di produzione al 2026-10-01:

1. **Primitive condivise unificate (`src/lib/ui`):** `StatusMark`, `GitStatusMark`, `ColumnTabs`, `Tooltip`, `MenuButton`, `Dialog`, `Switch`, `Segmented`, `Slider`.
2. **Rimozione del legacy MenuButton:** la vecchia implementazione locale in `agent/components/MenuButton.svelte` è stata completamente rimossa e tutti gli import sono stati migrati alla primitiva unificata `$lib/ui/MenuButton.svelte` senza shim intermedi.
3. **Controlli form opt-in (`src/app.css`):** `.ui-input`, `.ui-select`, `.ui-button` (nelle tre varianti `.ui-button-secondary`, `.ui-button-primary`, `.ui-button-danger`) attivi senza reset globali distruttivi.
4. **Keyframe globale `spin` (`src/app.css`):** unifica e sostituisce 19 definizioni locali duplicate (`16spin`, `tray-spin`, `tab-spin`, `ring-spin`). Rispetta `prefers-reduced-motion` con `animation: none` anziché loop da 1 ms.
5. **Transizioni condivise (`src/lib/agent/motion.ts`):** `rvLift` standardizzata per popover (150 ms) e modali (240 ms); `chatReveal` normata a 210 ms con curva `cubic-bezier(.22, .61, .36, 1)`.
6. **Ancoraggio popover (`src/lib/anchoredPopover.ts`):** posizionamento top-layer fixed con offset 8 px verso l'alto e ribaltamento automatico (`top`, `top-start`, `top-end`, `bottom`).
7. **Mappa token approvata:** mapping rigoroso da vecchi token/alias a token normativi, eliminazione di token vietati come `z-modal` e `text-title-size`.

### B. Mappa per allineare il resto di Studio

| Regola v1 (`DESIGN-legacy.md`) | Regola attuale v2 |
|---|---|
| Raggio massimo 10 px | Raggio per ruolo; pannelli e dialog a 10 px (`--radius-lg`), controlli a 6 px (`--radius-md`), superfici prompt a 16 px (`--radius-2xl`). |
| Una sola ombra, solo per ciò che galleggia | Tre token normativi: aggancio (`--shadow-dock`), sollevamento (`--shadow-raise`), galleggiamento (`--shadow-overlay`). Nessuna ombra su slider o form. |
| Nessun `backdrop-filter`, nessun gradient text | Vetro solo dove il contenuto scorre sotto; gradient text solo in `.text-shimmer` su un'etichetta viva. |
| Unico movimento persistente: l'anello ambra | Regola del vivo e visibile; segni di stato con IntersectionObserver e visibilitychange. |
| Popover a 240 ms con `--ease-out-expo` | Menu e popover a 150 ms con `rv-lift` e `--ease-reveal`; dialog a 240 ms, sezioni a 420 ms. |
| Task Rows (v1 §7.12): pillole verdi e rosse, arco SVG al 28% | Segni di stato condivisi `StatusMark`: completato neutro (disco `--ink` 16 px con spunta), spinner a due toni con spin globale. |
| Nessun verde, nessun rosso nel guscio | Colore semantico solo per gli esiti (`GitStatusMark`, badge), sempre con testo o icona. |
| Schede orizzontali con maiuscolo spaziato | `ColumnTabs`: indicatore singolo 2 px `--brand`, etichetta 12 px normale senza maiuscolo, attivazione manuale. |
| Finestre modali con overlay manuale | `Dialog`: elemento nativo `<dialog>.showModal()` con trap focus APG e isolamento top-layer. |
| Testo dei prompt a 13 px nella cornice | Voce chat 15/24 per scrittura e lettura completa; task in coda densi a 11/12 px anche espansi, in Markdown denso. |

Restano validi senza modifiche, finché non vengono rivisti nei task successivi: identità di
progetto e tessere (v1 §2.7, §7.1), riga delle corsie (§7.13) e splitter (§7.6). Le
regole del terminale (v1 §2.8, §7.5) sono ora la Sacred Terminal Rule e la
Clear-Viewport Rule (Task 11).
Quota, code e barra inferiore sono ora normate nei Components (Task 5), non più
nel popover usage legacy (§7.2).

### C. Chat fuori dal nucleo (Task 2)

Allineati al 2026-10-01 i componenti della chat fuori dal nucleo e le correzioni A.1–A.11:

1. **Prosa:** una sola scala dei titoli (20/17/15, token assoluti) in rivelazione e in `Markdown`; interlinea ereditata dal contesto; editor del composer a 15/24; messaggi tra agenti in voce chat.
2. **Scheda domanda e vassoio:** scheda a 16 px con `--shadow-raise`; niente etichetta sopra la domanda singola né «1/1»; vassoio compatto a una riga con la scheda aperta; riga di attenzione `--warn` al 15%; blocco quota spostato dal transcript al vassoio; anello dei todo completati neutro.
3. **Superfici e colori:** ombre solo dai tre token (via quella della bolla); Stop e caret di invio senza `white`/`black`; pallini dei ruoli dalla rampa d'identità; capacità dei modelli neutre; scheda d'integrazione della corsia neutra a 10 px con `--on-brand`.
4. **Stato e movimento:** `TaskRow`, `TodoTraceRow`, `SubagentTrace` e l'avvio della sessione su `StatusMark` (`PixelGrid` rimosso); aperture con `tray-in`/`tray-out`; pannello del subagente con `rvLift` laterale e `trapFocus`.
5. **Igiene:** misure, raggi e icone a token (`--icon-size`, niente prop `size`/`class`); stringhe residue tradotte; pulsante «in fondo» tondo con `Tooltip`.

`FileMentionPalette` è stato eliminato con il Task 12 (il Companion usa `SuggestPanel`). `CommandPalette` è stato eliminato con il Task 8.

### D. Tool renderer e parti condivise (Task 3)

Allineati al 2026-10-01 i 29 renderer dei tool, il fallback `Generic.svelte` e le parti condivise:

1. **Primitive condivise dei renderer:** `PromptBlock` (bolla in voce chat 15/24 su fondo `--bg-base`, raggio 12 px `--radius-xl`, padding 10px 14px), `ToolFileHeader` (incapsula `PathChip` con azione e metadati tabulari a destra), `LiveNotice` (spinner `StatusMark` e testo `.text-shimmer` conforme alla Alive-and-Visible Rule), `EmptyNotice` (testo neutro in `--text-caption`).
2. **Superfici e Anti-Nesting:** eliminati tutti i box sunken annidati con bordo dentro `.inline-body` (`AstEdit`, `Eval`, `Hub`, `WebSearch`, `Github`, `Irc`, `Goal`, `Retain`, `Recall`), sostituiti da separatori puliti o rotaia neutra da 2 px.
3. **Two Voices Rule:** prompt di generazione immagini (`GenerateImage`), obiettivi (`Goal`), domande utente (`InspectImage`), motivazioni (`Resolve`), query di ricerca web (`WebSearch`) e messaggi (`Irc`) migrati dalla visualizzazione monospazio da 12 px alla voce chat o sans leggibile.
4. **Stato e Outcome-Only Color Rule:** diff allineato unicamente a `--success` e `--danger` (rimossi fallback legacy `--git-added/deleted`); `Job` e `Hub` migrati alla primitiva `StatusMark`; rimossi i bordi interamente rossi in `Eval` e `Yield`.
5. **Movimento From-Only e igiene:** keyframe `task-stagger` e `todo-stagger` allineati alla From-Only Rule con `--dur-row` (210 ms) e curva `--ease-reveal`; raggio 6 px (`--radius-md`) per `PathChip` e `ImageBlock`; cifre tabulari obbligatorie su tutte le metriche e numeri di riga; dead code `view === 'summary'` e prop `view` rimossi da tutti i 30 componenti.

### E. Colonna sinistra: chrome, file tree e Git (Task 6)

Allineati al 2026-10-02 il chrome della colonna sinistra, `FileTree`, `GitPanel` e `GitDiffBadge`:

1. **Chrome:** collasso con `--ease-reveal`; maschera di dissolvenza senza `black`; via il maiuscolo spaziato residuo da `.col-header`; solo `inert` sulla colonna collassata.
2. **Stato Git:** `GitStatusMark` ovunque (righe, cartelle, risultati, file dei commit), nome sempre `--ink`; token `--git-*` e `--icon-*` in `oklch` fisso eliminati e consumatori migrati ai semantici del tema.
3. **Fuoco e campi:** nessun `outline: none` sulle righe; campo di rinomina su `--bg-sunken` con anello globale; ricerca con anello da 2 px.
4. **Icone e movimento:** 16 SVG fatti a mano sostituiti da forme Lucide neutre; emoji e glifi del pannello Git sostituiti da Lucide; spinner su `StatusMark`; cartelle a `--dur-row`; righe Git nuove con `chatReveal`.
5. **Colore e tipografia:** niente `rgba`, `#ffffff`, `--accent` né fallback hex; testo accento solo `--brand-ink`; misure a token (13 / 11,5 / 11 px).

### F. Colonna sinistra: pannello Agente, menu contestuale e stati vuoti (Task 7)

Allineati al 2026-10-02 `AgentPanel`, `QueueTaskItem`, `SessionList`, `RulesPanel`, `ContextMenu`, `EmptyState` e `FileMentionChip`:

1. **Primitive:** `Segmented` con modalità `tablist`, `fill` e conteggi; `.ui-button-ghost`; ancora a punto in `anchoredPopover`; icone `IconFolderPlus`, `IconListTodo`, `IconCircleAlert`.
2. **Coda:** sottoschede su `Segmented`; `IconPlus`, `IconGrip`, niente `:global(svg)`; `chatReveal` e `flip` a 210 ms; lampo del rollback solo `from`; spiegazione del cancello che si piega; prompt in Markdown denso con «Leggi tutto» alla stessa misura.
3. **Storico e regole:** titoli di sessione 13/450 su una riga; errori su `--danger-dim`; spinner su `StatusMark`; scheda di proposta neutra con primaria piena e azioni fantasma; anteprima mono 12 px; raggi a 6 px.
4. **Menu contestuale:** un solo motore di piazzamento con `MenuButton`; `--bg-raised`, righe `7px 8px` a 13 px, `rv-lift`, «pericolo» in `--danger`, anello di fuoco globale; via `--radius-xs` e i fuochi in `box-shadow`.
5. **Stati vuoti:** via `#ffffff`, `#000`, il fallback `#f59e0b44`, l'ombra e il `brightness` sul pulsante; testo del pulsante primario su `--on-brand` (prima `--brand-ink` su `--brand`, circa 1,6:1).

### G. Schermata nuovo task (Task 8)

Allineata al 2026-10-02 la schermata nuovo task (`TaskEditor`):

1. **Prompt nella sagoma del composer:** `ComposerEditor` a 15/24 con badge, `SuggestPanel` al posto di `CommandPalette` (eliminato) e `FileMentionPalette`, `AttachmentThumb` da 56 px, overlay di trascinamento; sagoma condivisa con la chat tramite `.composer-shell` e affini in `app.css`; voci e tasti della palette in `suggestItems.ts`.
2. **Azioni:** «Salva» primaria con split verso «Avvia ora» e «Avvia in nuova corsia»; testata fusa in quella della colonna con Elimina a doppia azione e Chiudi; via lo stato del task e il pulsante verde `#22c55e`.
3. **Esecuzione e direttive:** ruolo su `Segmented`, modello in un campo `.ui-select` con `ModelPickerList`, «Usati spesso» e direttive su `.ui-chip` (nuova classe condivisa, anche in `SuggestionChips`), contesto dell'editor su `Switch`; tag `/plan`, `/grill-me`… tolti anche dalle chip della coda.
4. **Thinking:** nuova Thinking-Slider Rule; `Slider` a traccia 20 px con cursore che sporge e anello di superficie; `ReasoningSlider` con il solo livello in `--brand-ink`; `ThinkingMenu` eliminato e sostituito nel composer della chat da un popover con lo slider.
5. **Igiene:** icone Lucide e `Tooltip` al posto di SVG a mano e `title`; via eyebrow maiuscole, misure da 9–10 px, raggi da 4 px, `transition: all`, `z-index` letterali, fondi `--brand-dim` (l'«in corso» misurava 3,12:1) e la regione `aria-live` che diceva sempre «Salvato»; testi in i18n; ingresso `rvLift` 240 ms.


### H. Colonna centrale e visualizzatori (Task 9)

Allineati al 2026-10-02 l'header di colonna, l'editor con schede e splitter, `ImageViewer`, `SvgPreview`, `PreviewViewer`, `DiagramViewer` e `AlertBanner`:

1. **Testata fusa e D7:** unificate tutte le toolbar di officina a 32 px con bordo inferiore `--line` sul pozzo (`--bg-sunken`). Eliminato `.col-header` ridondante con titolo maiuscolo; la testata appartiene alla vista figlia. Switch del Laboratorio preservato su `Segmented` `tablist` da 32 px senza `--bg` orfano né ombre `rgba`.
2. **Editor Monaco e schede:** scheda attiva con indicatore singolo 2 px `--brand` sul bordo superiore (D2); «non salvato» con punto CSS da 6 px `--warn` e corsivo accessibile; selettore codice/split/anteprima migrato a `Segmented` con opzioni iconiche e `Tooltip`; toggle diff con stato attivo neutro (`--bg-active`); pulsante «Salva» primario `.ui-button-primary`; splitter orizzontale con riga 1 px `--brand` in hover/drag e pointer capture; anteprima Markdown in prosa 15/28 px centrata a 720 px (Two Voices Rule); overlay di caricamento su `StatusMark` `running`.
3. **Visualizzatore immagini:** toolbar rimossa da `ImageViewer` e controlli di zoom/metadati integrati direttamente nella barra dell'editor a destra (`Adatta`, `−`, `%`, `+` con cifre tabulari); canvas con pan fluido privo di ritardo transizione; card d'errore a 10 px con titolo `--danger`.
4. **Anteprima sandbox (`PreviewViewer`):** barra fusa a 32 px; rimossa eyebrow maiuscola «PROTO»/«SVG»; commutatori su `Segmented`; vista codice migrata a `colorizeCode` in mono 12/1.5 a piena pagina; pulsanti fantasma con icone Lucide e feedback copia a 1500 ms.
5. **Whiteboard Mermaid (`DiagramViewer`):** risolto P0 di rendering tramite `tokenHex()` da `theme.ts` (esadecimali puliti al posto di `oklch()` rifiutati da `khroma`); `htmlLabels: false` per etichette SVG native compatibili con DOMPurify; ri-render reattivo su cambio tema; barra fusa a 32 px con sequenza zoom unificata; stato vuoto coerente.
6. **Banner diagnostico (`AlertBanner`):** superficie 100% neutra a 10 px con icona semantica Lucide (Outcome-Only Color Rule); rimossi 4 SVG manuali e tutti i fallback HEX/RGBA; pulsanti conformi a `.ui-button`; ingresso/uscita con `chatReveal` e piegatura diagnostica con `tray-in`/`tray-out` a 210 ms.
7. **Igiene ed estensioni:** introdotta estensione iconica per `Segmented`; aggiunta icona `IconCircleCheck`; eliminati tutti i `title` nativi dai controlli iconici in favore di `Tooltip`; tutte le stringhe migrate su `messages/it.json` ed `en.json`.
`ModelPickerDropdown` è stato sostituito da `ModelField` e `CycleDrawer` è stato allineato nel Task 14. `FileMentionPalette` è stato eliminato con il Task 12.

### I. Browser Studio e Laboratorio (Task 10)

Allineati al 2026-10-02 `BrowserViewer` e `LabPreview`. D5 approvata: riquadri dell'inspector in `--brand` con fondo al 18%. Cornici a token e toolbar a 32 px; schede inspector su `ColumnTabs` con attivazione manuale e pannello collegato; permessi e revisioni su `MenuButton`; dialoghi della pagina e Chrome Relay su `Dialog`; diagnostica Lab su `AlertBanner`; spinner su `StatusMark`. Registrazione ferma se nascosta, in arresto o con movimento ridotto. `+page.svelte` resta invariata: il suo switch Lab e i livelli semantici erano già allineati nel Task 9. Nessuna modifica agli stili dei prototipi.

### J. Colonna destra: switch e terminale (Task 11)

Allineati al 2026-10-05 lo switch della colonna destra e la cornice di `Terminal`:

1. **Switch:** «Terminale · GUI» su `ColumnTabs` (D2) con pannello collegato, attivazione manuale e la scorciatoia nel nuovo `tooltip` per scheda (D8); prima i pulsanti erano rimasti senza stile dal Task 1. Anche la testata sinistra passa a «File · Git · Agente» in frase. «Nuova chat» a 28 px, `--radius-md`, `Tooltip`.
2. **Stop (D6):** fuori dalla viewport, nella testata, con la sagoma del composer; stato armato come pillola «Forza arresto» statica. Via `backdrop-filter`, ombra `rgba`, `stop-armed-pulse` e `z-index` letterali. Stato a due tempi condiviso con il menu contestuale in `TerminalStopControl`.
3. **Banner quota:** eliminato. La TUI mostra già l'errore; al passaggio al terminale il blocco della sessione GUI si archivia (Clear-Viewport Rule). Spariscono la striscia laterale, i fallback esadecimali e i token inesistenti.
4. **Cornice:** viewport con 8 px sui soli lati; voci del menu contestuale in i18n e `IconStop` su «Interrompi».

### K. Finestra companion: a scomparsa e fissata (Task 12)

Allineata al 2026-10-05 la finestra companion (`CompanionShell`, `CompanionView`, `CompanionComposer`, `CompanionAskBody`, `CompanionMarkdown`, `CompanionProjectCard`, `CompanionProjectQueue`, `CompanionMonitor`, `companion.css`). Decisioni:

1. **D4 — superficie:** finestra opaca, tela `--bg-sunken` come la chat (via il fondo al 94% e il vetro Mica che lasciava passare); composer `--bg-raised`, card `--bg-base`.
2. **Composer ridotto su `ComposerEditor`:** sagoma `.composer-shell`, editor 15/24, `SuggestPanel` esteso a progetti, direttive, ruoli e modelli; `FileMentionPalette` e `FileMentionController` eliminati. Badge `#progetto` e `!ruolo` d'identità neutri con pallino, `/direttiva` in negativo come `/comando`; invio sul cerchio condiviso `.composer-send-btn`, salvataggio come riga di traccia con `StatusMark`.
3. **Scheda domanda:** parti di `AskCard` (`.ask-text`, `.ask-detail`, `.ask-opt`, `.ask-rec`, `.ask-kbd`) promosse a classi globali in `app.css` e condivise; «Consigliata» in `--success`, hover neutro, opzioni a 6 px, contatore solo con più domande, contesto in traccia 12,5/1.5, risposta libera in voce chat.
4. **Modalità fissata e movimento:** testata da 32 px con puntina attiva neutra (`aria-pressed`, `--bg-active`); a scomparsa puntina sempre visibile in `--ink-faint` (prima 2,12:1). Evocazione `rvLift` 240 ms; uscita da 120 ms prima di `hide()` per ogni percorso, scorciatoia globale compresa (`companion-dismiss`); sezioni con `trayFold` e altezza della finestra che segue il contenuto per fotogramma.
5. **Card e coda (D1):** stato con `StatusMark` neutro (via l'anello `--brand` su «finito»), card con domanda nella sagoma della scheda domanda, coda con titolo inerte e «Avvia» sempre visibile, ingressi `chatReveal` e riordino `flip` a 210 ms; token inesistenti, glifi `✎ ← →`, `title` sui controlli iconici e stringhe cablate eliminati.

### L. Centro impostazioni e sezioni (Task 13)

Allineati al 2026-10-05 il guscio `SettingsModal` e le sezioni Generale, Aspetto, Companion, Accessibilità, Notifiche, Barra Progetti, Area di Lavoro, Task & Direttive, Suggerimenti, GitHub e Studio Doctor, oltre all'inspector delle icone:

1. **Guscio e navigazione:** `Dialog` nativo largo, corpo `flush`, conteggi leggibili al posto dei punti, sottoschede Modelli su `ColumnTabs`; scarto bozze in `Dialog` annidato, azione distruttiva esplicita e ripristino del fuoco.
2. **Form:** `.ui-input`, `.ui-select`, `.ui-button`, `Switch` 32×18 e `Segmented`; preferenze binarie e direttive attive di default su interruttori, scelte con anteprima su radio nativi `.ui-choice`. Numeri e tempi in meta tabulare, nessun font mono per fingere una misura.
3. **Prompt:** `PromptField` in voce 15/24 senza palette; selezione della direttiva modificata su `.ui-selected`, senza striscia laterale. Generazione e affinamento mantengono testo, focus e scorciatoie; attrito AI su superficie neutra con `StatusMark` di attenzione statico.
4. **Esiti e igiene:** Doctor con `StatusMark` e testo per Superato/Avviso/Errore; account GitHub con completamento neutro. Token semantici, miscele `oklab`, icone Lucide e `Tooltip`; rimossi switch locali, SVG decorativi, spinner paralleli, ombre e colori letterali nelle sezioni.
5. **Confine:** RolesTab, CatalogTab, ProvidersTab, CycleDrawer, ModelHealthModal e picker dei modelli sono allineati nel Task 14.


### M. Gestione modelli e dialoghi (Task 14)

Allineati al 2026-10-05 l'intera area Modelli (`ProvidersTab`, `RolesTab`, `CatalogTab`, `CycleDrawer`, `ModelHealthModal`, `ModelField`, `ModelPickerList`) e tutti i dialoghi di sistema (`LaneReviewModal`, `LaneDispatchDialog`, `LaneProfileDialog`, `ShortcutsHelpModal`, `ImageModal`, `CloseConfirmModal`, `AlertBanner`, `SetupModal`, `+page.svelte` modali inline e banner d'errore):

1. **Dialoghi su `Dialog` nativo:** `LaneReviewModal` (con nuova variante `size="full"` a 32 px dai bordi e diff a tutta altezza), `LaneDispatchDialog`, `LaneProfileDialog`, `ShortcutsHelpModal` (size `wide`), `ImageModal` (con testata standard, nome file e sagoma proporzionata all'immagine) e `ModelHealthModal` (dialogo annidato sopra le Impostazioni: il browser gestisce lo stack di inert) migrati alla primitiva unificata. Eliminati veli manuali (`black`, `oklch`), `backdrop-filter` decorativo, token inesistenti `--z-modal`, `calc(z+1)`, centratura `translate(-50%)`, transizioni `fly`/`fade`/`cubicOut` sparse e focus trap locali.
2. **Conferme semplici (`ConfirmDialog`):** creata la specializzazione `src/lib/ui/ConfirmDialog.svelte` sopra `Dialog` (titolo, messaggio o snippet di corpo, annulla fantasma, conferma primaria o di pericolo con fuoco iniziale). Adottata per l'aggiornamento e il riavvio di `omp` in `+page.svelte` (eliminato markup duplicato e autofocus nativo sbilanciato) e per le rimozioni di provider/account in `ProvidersTab`.
3. **Avvisi e righe di traccia:** gli avvisi dentro i dialoghi (`CloseConfirmModal`, `LaneProfileDialog`, `SetupModal`) sono righe di traccia (12,5 px, testo `--ink`) con icona Lucide o `StatusMark` nel colore dell'esito, senza card né fondi colorati (Neutral Rail Rule e Outcome-Only Color Rule). Banner galleggiante d'errore caricamento progetti in `+page.svelte` normalizzato a `--z-toast`, superficie `--bg-overlay` 10 px con `--shadow-overlay`, icona `IconCircleAlert` `--danger`, `rvLift` 150 ms e chiusura con `Tooltip`.
4. **Controlli e tasti:** introdotte le classi globali `.ui-checkbox` (16 px, bordo `--ink-faint` 4,79:1 su Titanium e 5,97:1 su Alabaster, hover `--ink-muted`, spunta/trattino `--on-brand` su `--brand`) per selezioni multiple in `LaneProfileDialog` e `ModelHealthModal`; `.ui-kbd` piatto (mono 11 px tabulare, bordo `--line`, 4 px, `--ink-faint`, elevato a `--ink-muted` nella guida scorciatoie; eliminato il vecchio `.ask-kbd` 3D); `.ui-cap` per le capacità dei modelli (chip neutro 4 px `--bg-base`, bordo `--line`, testo `--ink-muted`, icona 11 px, contesto in `--ink-faint`).
5. **Gestione modelli:** `ModelPickerDropdown` eliminato e sostituito dal componente unico `ModelField` (trigger `.ui-select` 30 px con nome mono, provider faint, chevron Lucide + `MenuButton` 400 px con `ModelPickerList`), condiviso da Task Editor, Ruoli e ciclo; `CycleDrawer` colonna pieghevole a 240 ms con gestione fuoco ed Esc; `ModelHealthModal` privo di strisce colorate da 3 px e checkbox allineati; `CatalogTab` con «Gratis» neutro `--ink-muted` e popover assegnazione su `MenuButton`; `ProvidersTab` con switch su primitiva, select/input su classi opt-in, login su `Dialog` e menu aggiungi su `MenuButton`.
6. **Igiene ed estensioni:** eliminati oltre 30 SVG inline a favore di Lucide centralizzate in `src/lib/icons.ts` (aggiunte `IconCycle`, `IconAccount`, `IconKey`, `IconModels`, `IconPlug`); rimossi tutti i `title` nativi sui controlli iconici in favore di `Tooltip`; tutte le stringhe migrate su `messages/it.json` ed `en.json` via Paraglide; rimossi fallback esadecimali, `rgba()`, `white`/`black` e token inesistenti. Involucro vuoto `SetupWizard.svelte` eliminato.
