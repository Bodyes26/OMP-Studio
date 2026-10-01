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
    height: "26px"
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
  prompt-block:
    backgroundColor: "{colors.bg-base}"
    textColor: "{colors.ink}"
    typography: "{typography.chat}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
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
| `--dur-row` | 210 ms | Righe che entrano in una lista (`chatReveal`: blur 5 px, 3 px di corsa, altezza da 0, curva `--ease-reveal`). |
| `--dur-slow` | 240 ms | Pannelli e finestre modali (`Dialog` tramite `rvLift` con blur 3 px). |
| `--dur-tray` | 420 ms | Sezioni che si piegano in altezza (`tray-in`/`tray-out`, blur 6 px). |
| `--dur-reveal` | 700 ms | Unità di testo dell'agente (`rv-blur`, blur 10 px). |

Le primitive vivono in `src/app.css` e nei moduli di motion dedicati:

- `.rv-blur` dissolve la sfocatura.
- `.rv-lift` aggiunge 8 px di salita (`rvLift` Svelte transition in `src/lib/agent/motion.ts`, usata per popover a 150 ms e finestre modali `Dialog` a 240 ms con blur 3 px). Con il parametro `x` la corsa diventa orizzontale: il pannello del subagente entra da destra con 12 px, 240 ms, blur 3 px.
- `.tray-in`/`.tray-out` piegano l'altezza con `grid-template-rows` da `0fr` a `1fr`.
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
thinking) non sono identità: chip neutri `--ink-muted` con bordo `--line`, e l'icona porta
il significato.

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
| `--bg-sunken` | Il pozzo: tela della chat, terminale, editor, blocchi di codice, campi di input (`.ui-input`, `.ui-select`), traccia slider e segmented. |
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
| `bg-surface-elevated` | `--bg-raised` | Superfici rialzate, banner terminale. |
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
scrivere o rileggere parla con la voce anche fuori dalla chat. Due eccezioni:
il pannello laterale del singolo subagente (`SubagentDrawer`) è un ispettore e mostra
il transcript in traccia (12,5/1.5) con markdown; le anteprime dei task in coda restano
dense, 11 px in vista compatta e 12 px in vista card. Il dettaglio espanso di un task
mostra sempre il prompt completo a 15/24, inclusa la prima riga.

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

- **Contenitore:** `--bg-raised`, bordo `--line`, `--radius-2xl`, `--shadow-dock`. A fuoco il bordo passa a `--line-strong` (`--dur-fast`). Trascinando file: bordo `--brand-ink`, anello di 2 px con `--brand` al 25%, overlay `--radius-2xl` con etichetta.
- **Editor:** `contenteditable` in voce chat (15/24), placeholder `--ink-faint` sulla stessa interlinea perché il layout non salti. `Invio` invia nella modalità di default, `Alt+Invio` in quella alternativa, `Maiusc+Invio`/`Ctrl+Invio` vanno a capo. L'incolla porta solo testo; i file diventano allegati.
- **Badge:** `@file` ha fondo accento al 12%, anello inset al 28% (45% in hover), testo `--ink`, glifo file a 12 px con opacità 0,7. `/comando` è in negativo: fondo `--ink`, testo `--bg-base`. In comune: mono `0.84em`, `--radius-md`, massimo 260 px con ellissi, `contenteditable=false`, identici nell'editor e nel transcript.
- **Strisce sopra l'editor:** anteprima comando (`--bg-base`, `--radius-md`, 11 px, `rv-blur` 200 ms/4 px), allegati (miniature 56 px `--radius-md`; file 190×56 con estensione accentata), avviso di visione in ambra con l'azione «cambia modello».
- **Barra:** allegati, `@`, divisore 1×16 px, ruolo (pallino 7 px + nome mono), modello (nome con ellissi a 130 px), thinking (misuratore a 5 barre), poi a destra contesto e invio. Trigger alti 28 px, `--radius-md`, didascalia `--ink-muted` → hover `--bg-hover`/`--ink`.
- **Anello del contesto:** SVG 18 px, raggio 7, tratto 2,2, terminali arrotondati; `--ink`, poi `--warn` oltre il 60%, poi `--danger` oltre l'85%; accanto `usato/massimo` in mono tabulare.
- **Misuratore di thinking:** cinque barre larghe 3 px, altezze da 6 a 12 px, inattive `--line-strong`, attive `--brand-ink`.

### Invio e Stop

- **A riposo:** cerchio da 28 px, fondo `--ink`, freccia `--bg-base`; disabilitato a opacità 0,35.
- **Durante il turno:** Stop è un cerchio separato in `--danger` con glifo `--on-danger`. L'invio diventa uno split button a pillola: azione primaria nella modalità di default (steer o follow-up), caret per scegliere l'altra (menu da 240 px). Stop non disabilita mai l'invio.

### Menu e popover del composer (MenuButton)

Un'unica primitiva condivisa (`MenuButton` in `src/lib/ui/MenuButton.svelte`, che
sostituisce integralmente la vecchia implementazione locale rimossa senza shim) per
allegati (260 px), ruolo (420 px), modello (400 px), thinking (320 px) e contesto (300 px):

- **Superficie:** si apre verso l'alto a 8 px dal trigger tramite `anchoredPopover` (`src/lib/anchoredPopover.ts`) ancorato nel top-layer nativo (`popover="manual"`), con ribaltamento automatico verso il basso se manca spazio; `--bg-raised`, bordo `--line-strong`, `--radius-lg`, `--shadow-overlay`, altezza massima 380 px.
- **Ingresso:** transizione condivisa `rv-lift` con `--dur-menu` (150 ms) e blur 3 px.
- **Accessibilità e chiusura:** adotta `Tooltip` accessibile sul trigger (nessun `title` nativo nel DOM); chiusura su click esterno (in fase di cattura) ed `Esc` con ripristino del focus; Tab non è intrappolato (esce naturalmente e chiude il menu); frecce e Home/End navigano le voci senza interferire con campi input/ricerca.
- **Righe:** `7px 8px`, `--radius-md`, hover `--bg-hover`, scelta indicata da una spunta `--brand-ink`.
- **Intestazioni e piedi:** intestazioni in etichetta di gruppo; piedi in didascalia `--ink-faint` su `--bg-base`.
- **Primi consumatori:** `Composer` con menu allegati (`AttachMenu`, menuitem) e split button invio (menuitemradio).
### Palette `@` e `/`

- **Superficie e posizione:** larga 440 px, ancorata al cursore, stessa superficie dei menu.
- **Righe:** in didascalia. Il nome file va in peso 500 con la cartella in mono `--ink-faint`; il comando va in mono 600 con l'argomento suggerito e la descrizione, che si espande sulla riga attiva.
- **Lettere trovate:** sottolineate in `--warn` (2 px), testo in peso 700.
- **Piede:** scorciatoie in `kbd`.

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
- Accessibilità APG: il glifo compatto ha `aria-hidden="true"`, mentre la descrizione estesa per screen reader è incapsulata con la classe globale `.sr-only`.
- **Primi consumatori:** `GitPanel` (modifiche nell'albero di lavoro).

### Schede orizzontali (ColumnTabs)

Primitiva condivisa per la navigazione a schede delle colonne (`src/lib/ui/ColumnTabs.svelte` — D2).

- **Indicatore visivo:** linea singola da 2 px in `--brand` posizionata sul bordo inferiore O superiore (`indicatorPosition: 'top' | 'bottom'`), senza barre multiple né sfondi colorati.
- **Etichetta testuale:** font sans in etichetta da 12 px (peso 500, `letter-spacing: normal`, `text-transform: none`). È rigorosamente vietato il maiuscolo spaziato.
- **Attivazione manuale (The Manual-Activation Rule):** la navigazione con frecce (roving tabindex, salta le schede disabilitate) sposta solo il fuoco; la scheda si attiva esclusivamente su `Invio`, `Spazio` o click del mouse. Questa decisione architetturale evita il montaggio e il ricalcolo inutile dei pannelli pesanti sottostanti (terminali xterm, istanze Monaco Editor, grafici).
- **Connessione semantica:** attributi `id` e `aria-controls` accoppiati esplicitamente con i pannelli (`tabIdPrefix`, `panelIdPrefix`); la colonna o barra laterale collassata viene marcata con l'attributo nativo `inert`.

**The Single-Indicator Rule.** Le schede orizzontali mostrano un solo indicatore lineare da 2 px in `--brand` (sul bordo superiore o inferiore) e un'etichetta testuale non spaziata; niente doppie linee né sfondi colorati.

- **Primi consumatori:** testata sinistra di navigazione colonne (`+page.svelte`).

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
- **API:** titolo testuale `title`; snippet `header`, `body`, `footer`, `icon`, `children`; controllo con `open`, `onClose`, `dismissible`, `initialFocus`.
- **Superficie e transizione:** fondo `--bg-overlay`, bordo `--line-strong`, raggio 10 px (`--radius-lg`), ombra `--shadow-overlay`. Titolo a 16 px / peso 550 (`Inter Variable`) con `text-wrap: balance`. Corpo `--bg-overlay`, piede `--bg-base`. Transizione d'ingresso e uscita con `rvLift` (240 ms, blur 3 px) applicata alla superficie dentro un positioner separato per non interferire con la centratura a griglia.

**The Top-Layer Dialog Rule.** Le finestre modali usano `<dialog>.showModal()` nativo del browser per garantire top-layer e isolamento inert automatico; nessun modal host personalizzato né gestione manuale dello stack.

- **Primi consumatori:** `CloseConfirmModal` con tre varianti di pulsante nativo `.ui-button` e intestazione esplicitamente etichettata.

### Controlli form nativi opt-in (ui-input, ui-select, ui-button)

Classi CSS opt-in definite a livello globale in `src/app.css` per i controlli dell'officina:

- **Approccio opt-in:** nessuna regola distruttiva o reset universale sui tag `<input>`, `<select>` o `<button>`, garantendo che i controlli integrati in Monaco Editor, xterm.js o i canvas non vengano alterati.
- **Campi `.ui-input` e `.ui-select`:** altezza 30 px, padding orizzontale 8 px (`--space-2`), font UI da 13 px (`--text-body`, peso 450), fondo `--bg-sunken`, bordo `--line`, raggio 6 px (`--radius-md`), caret `--ink`. In hover passano a bordo `--line-strong`; a fuoco contorno/bordo `--brand`.
- **Pulsanti `.ui-button`:** altezza dal contenuto, padding 5 px 14 px, font UI da 11 px (`--text-caption`, peso 500), raggio 6 px (`--radius-md`), gap 8 px. Tre varianti cromatiche:
  - `.ui-button-secondary`: fondo trasparente, bordo `--line`, testo `--ink`. Hover: fondo `--bg-hover`, bordo `--line-strong`.
  - `.ui-button-primary`: fondo pieno `--brand`, bordo trasparente, testo `--on-brand`, peso 600. Hover: bordo `--on-brand`.
  - `.ui-button-danger`: fondo pieno `--danger`, bordo trasparente, testo `--on-danger`, peso 600. Hover: bordo `--on-danger`.
- **Primi consumatori:** `.ui-select` in `GeneralSection`; `.ui-button` (tutte e 3 le varianti) in `CloseConfirmModal`; `.ui-input` in `ShortcutsHelpModal`.

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
- **Primi consumatori:** `ProjectBarSection`.

### Cursore a passi (Slider)

Primitiva per valori numerici discreti e continui (`src/lib/ui/Slider.svelte`).

- **Geometria di default:** traccia alta 26 px a raggio completo (`--radius-full`) con fondo `--bg-sunken` e bordo da 1 px `--line-strong`. Cursore circolare (thumb) da 22×22 px in `--ink` con bordo `--line-strong`.
- **Passi discreti e magnetismo:** fino a 30 passi visualizza punti guida da 4 px lungo la traccia; i punti vicini al cursore subiscono un ingrandimento magnetico (scala 1.5x) per fornire feedback tattile visivo prima dell'aggancio allo scatto.
- **Flat-by-default:** né la traccia né il cursore possiedono ombre (`box-shadow: none`), in stretta conformità alla regola Flat-By-Default.
- **Stato di fuoco e trascinamento:** contorno da 2 px in `--brand` con offset di 2 px sulla traccia; durante il drag il cursore si espande a scala 1.06x.
- **Riempimento:** barra `--brand` a raggio completo che segue la percentuale del cursore.
- **Accessibilità:** `role="slider"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext`, supporto per frecce (passo singolo), Pagina Su/Giù (passi multipli) e Home/End.
- **Primi consumatori:** `ReasoningSlider` (regolazione del budget di thinking).
### Scheda domanda

Sostituisce il composer quando l'agente chiede, e ne prende la sagoma.

- **Superficie:** `--bg-raised`, bordo `--line-strong`, `--radius-2xl`, `--shadow-raise`, padding `12px 16px 0`, altezza massima 58vh con scorrimento interno e piede appiccicato.
- **Domanda:** voce chat a peso 500 (15 px/1.45); dettaglio in etichetta `--ink-muted`. Sopra una domanda singola non c'è etichetta: l'intestazione breve inviata dall'agente compare solo come nome dei passi nelle domande multiple.
- **Passi:** tab compatte in didascalia; la corrente è in negativo, quelle completate hanno la spunta `--success`. Il contatore «N/M» (meta tabulare `--ink-faint`, senza maiuscolo) compare solo con più di una domanda, anche quando il titolo di omp porta «1/1».
- **Anteprima in arrivo** (`AskStreamPreview`): nel flusso del transcript, stessa sagoma a `--radius-2xl` senza ombra.
- **Opzioni:** righe `9px 12px`, `--radius-md`, bordo `--line`. Hover `--bg-hover` al 60% con bordo `--line-strong`. La scelta prende bordo `--brand`, anello inset da 1 px e fondo accento al 7%. Radio 16 px (punto 6 px) o casella con raggio 5 px; scorciatoia `1–9` in `kbd`.
- **Consigliata:** pillola con fondo `--success` al 14%, testo `--success`, anello inset al 25%.
- **Piede:** «Decidi tu», suggerimenti di tastiera, azioni a destra. L'azione primaria è in `--brand` con testo `--on-brand` e peso 600; quella secondaria è un pulsante fantasma.

### Bolla dell'utente

- **Bolla:** a destra, larga al massimo l'80%, `--bg-raised`, bordo `--line`, `16px 16px 6px 16px`, padding `10px 14px`, voce chat. Entra con `rv-lift`.
- **Allegati:** miniature da 56 px sopra la bolla.
- **Contesto dell'editor:** tag `--bg-base` in didascalia sotto la bolla; il file attivo ha bordo accento al 40%.

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
- **Coda:** i follow-up locali hanno «Modifica» e «Rimuovi»; gli steer già partiti sono di sola lettura a opacità 0,7.

### Pulsante «in fondo»

Compare quando l'utente risale: cerchio da 28 px, `--bg-overlay`, bordo `--line`,
`--radius-full`, `--shadow-overlay`, freccia da 16 px. Nessun testo: il nome accessibile
e il `Tooltip` dicono «In fondo».

### Quota, tutte le code e barra inferiore

- **Quota:** una sola chip ad anello, trigger `--radius-md` (6 px), didascalia e percentuale mono tabulare. Le righe di limite sono lineari e sobrie, con label sans e valori mono tabulari; niente menisco, onde, rigature decorative o varianti selezionabili.
- **Colori:** quota sana neutra, oppure `--success` solo con l'opzione semaforo; quota bassa `--warn`, critica/esaurita `--danger`. Il segnale cromatico è accompagnato da testo o descrizione accessibile. Nessuna palette quota cablata nel layout.
- **Popover quota e code:** superfici non modali nel top-layer nativo tramite `anchoredPopover`, `--bg-overlay`, bordo `--line-strong`, raggio 10 px e `--shadow-overlay`; ancoraggio `bottom-end` a 8 px dal trigger, larghezze 380 e 420 px, fallback in alto a destra per apertura da scorciatoia o Companion. Titoli 16/550 bilanciati; ingresso `rvLift` a 150 ms e blur 3 px.
- **Tastiera:** niente velo, `aria-modal` o trap di Tab. Click esterno e Tab fuori chiudono senza rubare il nuovo focus; Escape e chiusura esplicita restituiscono il focus al trigger. I controlli iconici usano `Tooltip`; il caricamento usa `StatusMark`.
- **Task in coda:** cliccare il testo apre o chiude la lettura, mai l'avvio. «Avvia», «Nuova corsia» e «Modifica» sono sempre visibili anche in vista compatta. Shift su «Avvia» forza la corsia isolata; Ctrl mantiene il seguito sul progetto. La stessa riga `QueueTaskItem` serve il pannello Agente e tutte le code.
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

- **Do** scrivere e rileggere un prompt completo nella voce chat (15/24); mantenere dense solo le anteprime di coda documentate nella Two Voices Rule.
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
- **Do** mantenere lo Slider privo di ombre (`box-shadow: none`) con traccia 26 px e cursore 22 px.

### Don't:

- **Don't** animare la viewport del terminale né il contenuto delle colonne durante lo switch di progetto.
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
| Testo dei prompt a 13 px nella cornice | Voce chat 15/24 per scrittura e lettura completa; anteprime di coda 11/12 px, dettaglio espanso 15/24. |

Restano validi senza modifiche, finché non vengono rivisti nei task successivi: identità di
progetto e tessere (v1 §2.7, §7.1), riga delle corsie (§7.13), regole
del terminale (§2.8, §7.5) e splitter (§7.6).
Quota, code e barra inferiore sono ora normate nei Components (Task 5), non più
nel popover usage legacy (§7.2).

### C. Chat fuori dal nucleo (Task 2)

Allineati al 2026-10-01 i componenti della chat fuori dal nucleo e le correzioni A.1–A.11:

1. **Prosa:** una sola scala dei titoli (20/17/15, token assoluti) in rivelazione e in `Markdown`; interlinea ereditata dal contesto; editor del composer a 15/24; messaggi tra agenti in voce chat.
2. **Scheda domanda e vassoio:** scheda a 16 px con `--shadow-raise`; niente etichetta sopra la domanda singola né «1/1»; vassoio compatto a una riga con la scheda aperta; riga di attenzione `--warn` al 15%; blocco quota spostato dal transcript al vassoio; anello dei todo completati neutro.
3. **Superfici e colori:** ombre solo dai tre token (via quella della bolla); Stop e caret di invio senza `white`/`black`; pallini dei ruoli dalla rampa d'identità; capacità dei modelli neutre; scheda d'integrazione della corsia neutra a 10 px con `--on-brand`.
4. **Stato e movimento:** `TaskRow`, `TodoTraceRow`, `SubagentTrace` e l'avvio della sessione su `StatusMark` (`PixelGrid` rimosso); aperture con `tray-in`/`tray-out`; pannello del subagente con `rvLift` laterale e `trapFocus`.
5. **Igiene:** misure, raggi e icone a token (`--icon-size`, niente prop `size`/`class`); stringhe residue tradotte; pulsante «in fondo» tondo con `Tooltip`.

Restano ai task successivi: `CommandPalette` e `FileMentionPalette`, ancora usati da Task Editor e Companion, che non sono ancora passati a `SuggestPanel` (task 8 e 12).

### D. Tool renderer e parti condivise (Task 3)

Allineati al 2026-10-01 i 29 renderer dei tool, il fallback `Generic.svelte` e le parti condivise:

1. **Primitive condivise dei renderer:** `PromptBlock` (bolla in voce chat 15/24 su fondo `--bg-base`, raggio 12 px `--radius-xl`, padding 10px 14px), `ToolFileHeader` (incapsula `PathChip` con azione e metadati tabulari a destra), `LiveNotice` (spinner `StatusMark` e testo `.text-shimmer` conforme alla Alive-and-Visible Rule), `EmptyNotice` (testo neutro in `--text-caption`).
2. **Superfici e Anti-Nesting:** eliminati tutti i box sunken annidati con bordo dentro `.inline-body` (`AstEdit`, `Eval`, `Hub`, `WebSearch`, `Github`, `Irc`, `Goal`, `Retain`, `Recall`), sostituiti da separatori puliti o rotaia neutra da 2 px.
3. **Two Voices Rule:** prompt di generazione immagini (`GenerateImage`), obiettivi (`Goal`), domande utente (`InspectImage`), motivazioni (`Resolve`), query di ricerca web (`WebSearch`) e messaggi (`Irc`) migrati dalla visualizzazione monospazio da 12 px alla voce chat o sans leggibile.
4. **Stato e Outcome-Only Color Rule:** diff allineato unicamente a `--success` e `--danger` (rimossi fallback legacy `--git-added/deleted`); `Job` e `Hub` migrati alla primitiva `StatusMark`; rimossi i bordi interamente rossi in `Eval` e `Yield`.
5. **Movimento From-Only e igiene:** keyframe `task-stagger` e `todo-stagger` allineati alla From-Only Rule con `--dur-row` (210 ms) e curva `--ease-reveal`; raggio 6 px (`--radius-md`) per `PathChip` e `ImageBlock`; cifre tabulari obbligatorie su tutte le metriche e numeri di riga; dead code `view === 'summary'` e prop `view` rimossi da tutti i 30 componenti.
