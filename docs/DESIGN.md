# Design System — OMP Studio

Sistema di design completo e verificato. Ogni valore di colore in questo documento è stato calcolato da OKLCH a sRGB e il contrasto misurato con la formula WCAG 2.x: le tabelle riportano numeri reali, non stime.

---

## 1. La scena

> Postazione desktop, luce artificiale, otto ore al giorno. Metà dello schermo è output ANSI di un agente che lavora; l'altra metà è codice. L'utente deve sapere in mezzo secondo: quale progetto è attivo, se l'agente sta lavorando o sta aspettando lui, quanta quota AI resta.

Questa scena obbliga tre decisioni, in quest'ordine:

1. **Tema scuro.** Non per estetica: la viewport dominante è un terminale, che è scuro per natura. Un guscio chiaro attorno a un terminale scuro produce uno stacco di luminanza che l'occhio paga per ore. Il tema è scuro perché il contenuto è scuro.

2. **Neutri a croma esattamente 0.000.** Qualsiasi tinta nel guscio sposta la percezione dei 16 colori ANSI adiacenti. Un grigio caldo fa sembrare il rosso ANSI più spento e il ciano più sporco. Il guscio è cromaticamente muto per una ragione funzionale.

3. **Strategia colore: Restrained.** Neutri + un accento sotto il 10% della superficie. Il terminale e l'editor contengono già decine di colori significativi; ogni colore aggiunto dal guscio è rumore che compete con il contenuto.

---

## 2. Colore

### 2.1 Ancora del brand

Seed: `oklch(0.470 0.173 354.8)` — cremisi/magenta. La tinta 355° è l'ancora; L e C sono scelti per la scena (accento su superficie quasi nera, deve leggersi senza brillare).

### 2.2 Superfici — neutri, croma 0.000

| Token | OKLCH | Hex | Uso |
|---|---|---|---|
| `--bg-sunken` | `oklch(0.155 0 0)` | `#0C0C0C` | Pozzo del terminale, pozzo dell'editor. Il livello più profondo. |
| `--bg-base` | `oklch(0.185 0 0)` | `#131313` | Sfondo dell'app, corpo delle colonne. |
| `--bg-raised` | `oklch(0.215 0 0)` | `#191919` | Barra progetti, header di colonna, barra di stato. |
| `--bg-overlay` | `oklch(0.250 0 0)` | `#222222` | Popover usage, menu, dialog. |
| `--bg-hover` | `oklch(0.285 0 0)` | `#2A2A2A` | Hover su riga/voce/controllo. |
| `--bg-active` | `oklch(0.325 0 0)` | `#343434` | Premuto, riga selezionata. |
| `--line` | `oklch(0.295 0 0)` | `#2C2C2C` | Separatori strutturali, bordi pannello. |
| `--line-strong` | `oklch(0.400 0 0)` | `#484848` | Splitter di colonna, bordo di elemento enfatizzato. |

Gerarchia di elevazione: `sunken → base → raised → overlay`. Ogni salto è percepibile (ratio adiacenti da 1.05 a 1.15) senza creare bande visibili. **Nessuna ombra viene usata per l'elevazione**: solo luminanza e un bordo `--line` da 1px. Vietato l'accoppiamento `border: 1px` + `box-shadow` largo.

### 2.3 Testo

| Token | OKLCH | Hex | Contrasto min. sulle 4 superfici | Uso |
|---|---|---|---|---|
| `--ink` | `oklch(0.970 0 0)` | `#F5F5F5` | **14.67:1** | Testo primario, nome progetto attivo, numeri usage. |
| `--ink-muted` | `oklch(0.760 0 0)` | `#B1B1B1` | **7.45:1** | Testo secondario, nomi file, label. |
| `--ink-faint` | `oklch(0.655 0 0)` | `#909090` | **5.04:1** | Metadati, timestamp, path, hint di shortcut. |

Tutti e tre superano 4.5:1 su `sunken`, `base`, `raised` e `overlay`. Non esiste un quarto livello più tenue: sotto `--ink-faint` si scende sotto la soglia e il grigio "elegante" illeggibile è il difetto numero uno delle UI generate.

### 2.4 Accento — cremisi

| Token | OKLCH | Hex | Contrasto min. | Uso consentito |
|---|---|---|---|---|
| `--brand` | `oklch(0.620 0.190 355)` | `#D8488C` | 3.97:1 | **Solo non-testo**: anello di fuoco, indicatore di tessera attiva, riempimenti, pulse. |
| `--brand-ink` | `oklch(0.720 0.170 355)` | `#F471AA` | **5.94:1** | **Testo** in accento (raro: link, valore critico). |
| `--brand-dim` | `oklch(0.440 0.140 355)` | `#892756` | — | Riempimento di superficie sotto testo `--ink` (7.71:1). |

**Regola dura:** `--brand` non è mai colore di testo. Sotto 4.5:1 su `raised` e `overlay`, quindi esiste `--brand-ink` per quel caso. Questa separazione tra "accento superficie" e "accento testo" non è opzionale.

### 2.5 Attenzione — ambra

| Token | OKLCH | Hex | Contrasto min. | Uso |
|---|---|---|---|---|
| `--warn` | `oklch(0.780 0.150 75)` | `#EFA831` | **7.83:1** | Testo e icona di soglia quota. |
| `--warn-dim` | `oklch(0.560 0.120 75)` | `#9D6800` | 3.37:1 | Riempimento barra quota in avviso. |

### 2.6 Cosa NON esiste nella palette

**Nessun verde-successo. Nessun rosso-errore.** Decisione deliberata: gli errori dell'agente appaiono dentro il terminale, con i colori ANSI, dove l'utente li legge già. Duplicarli nel guscio è rumore e crea ambiguità (un anello cremisi accanto a testo rosso ANSI: quale dei due è l'errore?). Il guscio segnala tre soli stati per progetto e nessuno di questi è "errore".

La severità della quota usa una scala di tre livelli che riusa la palette esistente invece di allargarla:

| Stato quota | Riempimento barra | Soglia |
|---|---|---|
| ok | `--ink-faint` (neutro, silenzioso) | `remainingFraction > 0.25` |
| avviso | `--warn-dim`, label `--warn` | `0.10 < remainingFraction <= 0.25` |
| critico | `--brand`, label `--brand-ink` | `remainingFraction <= 0.10` oppure `status != "ok"` |

L'accento del brand come allarme di quota esaurita è l'unico momento in cui l'app alza la voce, ed è coerente: è la sua informazione più importante.

### 2.7 Identità di progetto — rampa a 8 tinte

Colore funzionale: serve a riconoscere un progetto a colpo d'occhio, non a decorare. Tinta assegnata deterministicamente dall'hash del path del progetto, sovrascrivibile dall'utente.

L e C sono fissi per tinta-stato, così tutte le tessere hanno lo stesso peso visivo.

| Nome | Tinta | Idle `oklch(0.42 0.13 h)` | Hover `oklch(0.50 0.145 h)` | Attivo `oklch(0.68 0.16 h)` |
|---|---|---|---|---|
| crimson | 355 | `#802651` | — | `#E2699D` |
| rust | 25 | `#862726` | — | `#EA6A64` |
| ochre | 60 | `#7D3500` | — | `#DE7C00` |
| moss | 135 | `#295B00` | — | `#6AAD3E` |
| teal | 175 | `#006249` | — | `#00B793` |
| azure | 220 | `#005A7D` | — | `#00ADDC` |
| indigo | 265 | `#294793` | — | `#6793FA` |
| violet | 305 | `#5E3685` | — | `#B07BE6` |

**Colore della lettera sulla tessera:**

- idle e hover → lettera `--ink`. Contrasto minimo misurato: **6.77:1** (idle), **4.76:1** (hover). La tessera è volutamente in secondo piano: è la lettera a identificarla.
- attivo → lettera `--bg-sunken` (`#0C0C0C`) su riempimento chiaro. Contrasto minimo **6.26:1**, e la tessera stacca dalla barra a **5.61:1** minimo.

L'inversione della lettera sull'attivazione è intenzionale: la tessera "si accende". È anche l'unico modo per tenere il contrasto sopra soglia in entrambi gli stati, verificato su tutte le 8 tinte.

### 2.8 Il terminale non è nel sistema di colore

La palette ANSI dentro la viewport appartiene al tema di `omp`. OMP Studio imposta solo `background` (`--bg-sunken`) e `foreground` (`--ink`) del terminale, e non tocca i 16 colori. Nessun tema del guscio può riscrivere i colori del contenuto.

---

## 3. Tipografia

Coppia su asse di contrasto: **sans umanista + monospace**. Vietato accoppiare due sans simili.

| Ruolo | Famiglia | Fallback |
|---|---|---|
| UI | `Inter` variabile | `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` |
| Codice, terminale, path, numeri usage | `JetBrainsMono Nerd Font` | `"Cascadia Code", "Cascadia Mono", Consolas, monospace` |

`Cascadia Code` è già presente su Windows 11: è un fallback reale, non teorico.

### Scala UI

Base 13px, non 16px: è uno strumento denso, non un documento.

| Token | px | Peso | Uso |
|---|---|---|---|
| `--text-xs` | 11 | 500 | Metadati, timestamp, hint shortcut |
| `--text-sm` | 12 | 450 | Label, path, righe secondarie |
| `--text-base` | 13 | 450 | Corpo UI, voci di lista, menu |
| `--text-md` | 14 | 500 | Nome progetto attivo, header di sezione |
| `--text-lg` | 16 | 550 | Titolo popover, titolo dialog |
| `--text-xl` | 20 | 600 | Titolo schermata di benvenuto |

Nessun display type. Non c'è una hero: è un'app, non una landing. Il tetto è 20px.

Interlinea: 1.45 per il testo di UI, 1.2 per righe dense in lista, 1.0 per il codice (l'editor e il terminale gestiscono la propria).

### Regole

- Larghezza massima del testo in prosa (schermata di benvenuto, testi di stato vuoto): **65ch**.
- `font-variant-numeric: tabular-nums` obbligatorio su ogni numero che cambia nel tempo: percentuali di quota, token, costi, countdown. Senza questo i numeri "ballano" a ogni aggiornamento.
- `text-wrap: balance` sui titoli di popover e dialog.
- Path lunghi: troncamento **al centro** con ellissi (`C:\...\repos\MyProject`), non alla fine: la coda di un path è la parte informativa.
- Nessuna eyebrow uppercase tracciata. Nessun marcatore numerico `01 / 02 / 03`.

---

## 4. Spaziatura, raggi, tratti

### Spaziatura — scala a 4px

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` · `--space-5: 24px` · `--space-6: 32px` · `--space-8: 48px`

Ritmo, non uniformità: padding di riga `4px 8px`, padding di pannello `12px`, padding di popover `16px`, respiro tra gruppi in popover `24px`.

### Raggi

`--radius-sm: 4px` (controlli, badge) · `--radius-md: 6px` (tessera progetto, bottone, input) · `--radius-lg: 10px` (popover, dialog, pannello) · `--radius-full: 999px` (solo tag e pill di conteggio)

Tetto assoluto: **10px**. Un raggio a 16px+ su un pannello di uno strumento tecnico è un difetto, non uno stile.

### Tratti e ombre

- Bordi: sempre 1px. Mai bordi colorati laterali come accento (`border-left` spesso è vietato).
- Ombre: **una sola**, e solo per superfici che galleggiano davvero (popover, dialog): `--shadow-overlay: 0 8px 24px -8px oklch(0 0 0 / 0.7), 0 2px 6px -2px oklch(0 0 0 / 0.5)`.
- Nessuna ombra su tessere, righe, bottoni, pannelli. Nessuna ombra "morbida e larga" come decorazione.

---

## 5. Elevazione e z-index

Scala semantica, mai valori arbitrari:

```css
--z-base: 0;        /* colonne, contenuto */
--z-splitter: 10;   /* maniglie di ridimensionamento colonne */
--z-sticky: 20;     /* header di colonna, barra di stato */
--z-topbar: 30;     /* barra progetti */
--z-backdrop: 40;   /* velo sotto dialog */
--z-overlay: 50;    /* popover usage, menu contestuale */
--z-dialog: 60;     /* dialog nuovo progetto, impostazioni */
--z-toast: 70;      /* notifiche transitorie */
--z-tooltip: 80;    /* tooltip */
```

Popover e menu **non** vengono posizionati in `absolute` dentro colonne con `overflow`: verrebbero tagliati. Si usa l'API `popover` nativa o un portale a livello di root con `position: fixed`.

---

## 6. Movimento

### Durate

| Token | ms | Uso |
|---|---|---|
| `--dur-instant` | 0 | Switch di progetto (vedi sotto) |
| `--dur-fast` | 120 | Hover, pressione, cambio di stato di un controllo |
| `--dur-base` | 180 | Indicatore di tessera attiva, fade di riga |
| `--dur-slow` | 240 | Apertura/chiusura popover e dialog |
| `--dur-pulse` | 1800 | Ciclo del respiro "agente al lavoro" |

### Curve

```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);      /* out-quart: default per entrate */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);  /* out-expo: popover, pannelli */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* solo per cicli che tornano (pulse) */
```

Nessun bounce, nessun elastic, nessun overshoot.

### Le tre regole di movimento di questa app

1. **Lo switch di progetto non si anima.** Il contenuto delle tre colonne appare a `--dur-instant`. Si anima soltanto la traslazione dell'indicatore di tessera attiva (`--dur-base`, `--ease-out`). Motivo: cambiare progetto è cambiare stanza; una transizione aggiungerebbe 200ms di latenza percepita su un'azione fatta decine di volte al giorno.

2. **Il terminale non è mai il soggetto di un'animazione.** Niente fade in ingresso, niente slide, niente scale. La viewport appare già disegnata. Animarla causa reflow su un canvas che sta ridisegnando testo.

3. **Un solo movimento persistente in tutta l'app**: il respiro della tessera "agente al lavoro". Opacità `1 → 0.45 → 1` su un anello da 2px in `--brand`, 1800ms, `--ease-in-out`, infinito. È l'unica animazione in loop consentita, perché è l'unica informazione continua che l'app deve trasmettere.

### Reduced motion — obbligatorio

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  /* Il "respiro" degrada a un anello statico pieno: lo stato resta leggibile senza moto. */
  .tile[data-state="running"] { animation: none; outline: 2px solid var(--brand); }
}
```

Nessuna animazione deve essere l'unico veicolo di un'informazione. Lo stato "al lavoro" è leggibile anche fermo.

---

## 7. Componenti

### 7.1 Barra progetti (top bar)

Altezza 40px, sfondo `--bg-raised`, bordo inferiore 1px `--line`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [C] [A] [S] │ +        MyProject                  ⌁ 69%   [AV] ▾       │
└────────────────────────────────────────────────────────────────────────┘
  tessere      nuovo    progetto attivo (centro)   usage    profilo
```

- **Tessere**: 26×26px, `--radius-md`, lettera iniziale in mono 12px/600. Ordine = ordine di apertura, riordinabili per trascinamento.
- **Indicatore attivo**: barra da 2px in `--brand` sul bordo *inferiore* della barra, larga come la tessera, che trasla tra le tessere. Un solo elemento animato, non uno per tessera.
- **Stato sulla tessera** (leggibile anche per progetti non a schermo):
  - `idle` — riempimento idle, nessun segno.
  - `running` — anello 2px `--brand` che respira.
  - `attention` — punto 6px `--brand` in alto a destra, fisso, più anello statico 1px.
- **Nome del progetto attivo**: centrato, `--text-md`, `--ink`. Il path completo è nel tooltip.
- **Pulsante `+`**: apre il selettore progetto (recenti + sfoglia + crea).
- **Chip usage**: mostra solo il numero peggiore tra tutte le quote (`min(remainingFraction)`) e la sua icona. Click → popover. Colore per severità (§2.6). È l'unico elemento della barra che può essere colorato di ambra o cremisi.
- **Avatar/profilo**: iniziali dell'account, apre menu impostazioni.

Massimo consigliato: 8 tessere. Oltre, la barra scorre orizzontalmente senza scrollbar visibile. Non si comprimono le tessere.

### 7.2 Popover usage

Larghezza fissa 360px, `--bg-overlay`, `--radius-lg`, `--shadow-overlay`, padding 16px. Ancorato al chip, `position: fixed`, chiusura su `Esc` e click esterno, focus trap.

Struttura, dall'alto:

1. **Riga di sintesi** — la quota peggiore in evidenza: percentuale residua in mono `--text-lg` con `tabular-nums`, label del provider, countdown al reset (`resets_at` → "si azzera in 3h 42m").
2. **Elenco quote** — una riga per ogni `limits[]` di ogni provider: label, barra di avanzamento 4px con `--radius-full`, percentuale a destra. Raggruppate per provider, provider ordinati per severità decrescente.
3. **Sparkline** — trend di `used_fraction` delle ultime 24h dalla tabella `usage_history`, 32px di altezza, tratto 1.5px `--ink-faint`. Nessun asse, nessuna griglia, nessuna legenda.
4. **Piede** — costo sessione corrente e totale di oggi da `stats.db`, in mono, `--ink-muted`. `fetchedAt` come "aggiornato 12s fa" in `--text-xs`.

Il popover **non copre mai la viewport del terminale**: si apre ancorato in alto a destra sopra la barra e, se lo spazio verticale non basta, scrolla internamente.

Vietato: grafici a torta, KPI card, numeri giganti decorativi, gradienti nelle barre.

### 7.3 Colonna sinistra — albero e storico

Larghezza default 260px, min 180px, max 480px. Due sezioni con header sticky, commutabili:

- **FILE** — albero della cartella progetto. Righe 22px, indentazione 12px per livello, icona 14px, nome in `--text-base`. Cartelle prima, ordine alfabetico. Filtro incrementale in cima. Directory rumorose (`bin`, `obj`, `.vs`, `packages`, `node_modules`) collassate e in `--ink-faint` per default.
- **SESSIONI** — storico `omp` del progetto corrente. Ogni voce: primo prompt troncato su 2 righe come titolo (`--text-base`, `--ink`), sotto data relativa + modello + numero di messaggi (`--text-xs`, `--ink-faint`). Campo di ricerca full-text in cima. Click → riprende in un nuovo tab di terminale.

### 7.4 Colonna centrale — editor

`--bg-sunken`. Header: path troncato al centro, indicatore di modifica, pulsante chiudi. Monaco con tema derivato dai token qui sopra. Nessuna minimap per default (larghezza sprecata a questa densità), nessun breadcrumb, nessuna barra strumenti.

Stato vuoto: nessuna illustrazione. Una riga in `--ink-faint` centrata e il set di scorciatoie disponibili.

### 7.5 Colonna destra — terminale

`--bg-sunken`, padding 8px sui soli lati, 0 in alto e in basso (il terminale gestisce il proprio scroll). Header minimo: nome della sessione, modello attivo, pulsante nuovo tab.

**Vincolo tecnico che vincola il design:** un terminale nascosto con `display: none` misura 0 e rompe `FitAddon` ([xterm.js #3029](https://github.com/xtermjs/xterm.js/issues/3029)). I terminali dei progetti non attivi restano quindi montati e dimensionati, nascosti con `visibility: hidden` fuori dal flusso. Conseguenza di design: **non esistono transizioni di crossfade tra terminali di progetti diversi**, perché sono tutti presenti contemporaneamente. Coerente con la regola 1 del movimento.

### 7.6 Splitter di colonna

Maniglia da 1px visibile (`--line`), area di presa da 8px, `cursor: col-resize`. Hover → `--line-strong`. Trascinamento → `--brand`, larghezza 2px. Doppio click → ripristina la larghezza di default. Le larghezze sono per-progetto e persistono.

### 7.7 Fuoco e tastiera

```css
:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: inherit;
}
```

`--brand` su `--bg-base` misura 4.63:1, oltre il minimo di 3:1 per indicatori non testuali. Nessun elemento interattivo senza stato di fuoco visibile. Nessun `outline: none` senza sostituto.

Il set di scorciatoie dell'app è deliberatamente minimo e vive su `Ctrl+Alt`, che la TUI di `omp` non usa; ogni combinazione che `omp` intercetta va al terminale senza eccezioni.

---

## 8. Token CSS pronti

```css
:root {
  /* Superfici — croma 0.000 per non alterare i colori ANSI adiacenti */
  --bg-sunken:   oklch(0.155 0 0);
  --bg-base:     oklch(0.185 0 0);
  --bg-raised:   oklch(0.215 0 0);
  --bg-overlay:  oklch(0.250 0 0);
  --bg-hover:    oklch(0.285 0 0);
  --bg-active:   oklch(0.325 0 0);
  --line:        oklch(0.295 0 0);
  --line-strong: oklch(0.400 0 0);

  /* Testo */
  --ink:         oklch(0.970 0 0);
  --ink-muted:   oklch(0.760 0 0);
  --ink-faint:   oklch(0.655 0 0);

  /* Accento — brand non è mai colore di testo */
  --brand:       oklch(0.620 0.190 355);
  --brand-ink:   oklch(0.720 0.170 355);
  --brand-dim:   oklch(0.440 0.140 355);

  /* Attenzione */
  --warn:        oklch(0.780 0.150 75);
  --warn-dim:    oklch(0.560 0.120 75);

  /* Identità progetto: L/C fissi, tinta dall'hash del path */
  --proj-l-idle: 0.42;  --proj-c-idle: 0.130;
  --proj-l-hover: 0.50; --proj-c-hover: 0.145;
  --proj-l-active: 0.68; --proj-c-active: 0.160;

  /* Tipografia */
  --font-ui:   Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrainsMono Nerd Font", "Cascadia Code", "Cascadia Mono", Consolas, monospace;
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px;
  --text-md: 14px; --text-lg: 16px; --text-xl: 20px;

  /* Spazio */
  --space-1: 4px; --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-8: 48px;

  /* Raggi */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; --radius-full: 999px;

  /* Ombra — una sola, solo per superfici che galleggiano */
  --shadow-overlay: 0 8px 24px -8px oklch(0 0 0 / 0.7),
                    0 2px  6px -2px oklch(0 0 0 / 0.5);

  /* Movimento */
  --dur-instant: 0ms; --dur-fast: 120ms; --dur-base: 180ms;
  --dur-slow: 240ms;  --dur-pulse: 1800ms;
  --ease-out:      cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.30, 1);
  --ease-in-out:   cubic-bezier(0.65, 0, 0.35, 1);

  /* Z-index semantico */
  --z-base: 0;     --z-splitter: 10; --z-sticky: 20; --z-topbar: 30;
  --z-backdrop: 40; --z-overlay: 50; --z-dialog: 60; --z-toast: 70; --z-tooltip: 80;
}
```

---

## 9. Divieti — verificare prima di ogni commit di UI

- [ ] Nessun `border-left`/`border-right` colorato oltre 1px come accento.
- [ ] Nessun `background-clip: text` con gradiente.
- [ ] Nessun `backdrop-filter` decorativo.
- [ ] Nessun accoppiamento `border: 1px solid` + `box-shadow` con blur ≥ 16px sullo stesso elemento.
- [ ] Nessun `border-radius` ≥ 16px su pannelli, card o input.
- [ ] Nessun `repeating-linear-gradient` di sfondo, nessuna griglia decorativa.
- [ ] Nessuna eyebrow uppercase tracciata, nessun marcatore `01 / 02 / 03`.
- [ ] Nessuna card annidata dentro un'altra card.
- [ ] Nessuna illustrazione SVG disegnata a mano o "sketchy".
- [ ] Nessun `z-index` arbitrario (`999`, `9999`): solo la scala semantica.
- [ ] Nessun numero variabile senza `tabular-nums`.
- [ ] Nessuna animazione senza alternativa `prefers-reduced-motion`.
- [ ] Nessun testo con contrasto sotto 4.5:1, verificato e non stimato.
- [ ] Nessun colore hard-coded nel codice dei componenti: solo token.
