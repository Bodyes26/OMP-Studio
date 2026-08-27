# Design System — OMP Studio

Sistema di design completo e verificato. Ogni valore di colore in questo documento è stato calcolato da OKLCH a sRGB e il contrasto misurato con la formula WCAG 2.x: le tabelle riportano numeri reali, non stime.

---

## 1. La scena

> Postazione desktop, luce artificiale, otto ore al giorno. Metà dello schermo è output ANSI di un agente che lavora; l'altra metà è codice. L'utente deve sapere in mezzo secondo: quale progetto è attivo, se l'agente sta lavorando o sta aspettando lui, quanta quota AI resta.

Questa scena obbliga tre decisioni, in quest'ordine:

1. **Tema coerente con la TUI.** Il tema puo' essere scuro o chiaro: la
   superficie della cornice, l'editor e il terminale seguono sempre lo stesso
   tema di `omp`. La scelta non e' una modalita' cosmetica, ma una sola scena di
   lavoro che resta leggibile per tutta la giornata.

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

**Come sono definiti.** Solo `--bg-sunken` e `--bg-base` sono valori scelti a mano: sono le due ancore. Tutto il resto è derivato in `src/app.css` mescolando `--ink` nell'ancora, e i valori esadecimali della tabella sono ciò che la mescolanza produce sopra `--bg-base`.

- `--bg-raised` e `--bg-overlay` sono **opachi** (`color-mix(in oklab, var(--bg-base) N%, var(--ink))`): sono superfici, e una superficie deve coprire.
- `--bg-hover`, `--bg-active`, `--line` e `--line-strong` sono **traslucidi** (`color-mix(in srgb, var(--ink) N%, transparent)`): sono stati e separatori, e devono funzionare identici sopra `base`, `sunken` e `overlay` senza un valore per superficie. È il motivo per cui una riga selezionata nell'albero e una riga selezionata dentro un popover non richiedono due token diversi.

La croma resta 0.000 in entrambi i casi: si mescola grigio in grigio.

### 2.3 Testo

| Token | OKLCH | Hex | Contrasto min. sulle 4 superfici | Uso |
|---|---|---|---|---|
| `--ink` | `oklch(0.970 0 0)` | `#F5F5F5` | **14.67:1** | Testo primario, nome progetto attivo, numeri usage. |
| `--ink-muted` | `oklch(0.760 0 0)` | `#B1B1B1` | **7.45:1** | Testo secondario, nomi file, label. |
| `--ink-faint` | `oklch(0.655 0 0)` | `#909090` | **5.04:1** | Metadati, timestamp, path, hint di shortcut. |

Tutti e tre superano 4.5:1 su `sunken`, `base`, `raised` e `overlay`. Non esiste un quarto livello più tenue: sotto `--ink-faint` si scende sotto la soglia e il grigio "elegante" illeggibile è il difetto numero uno delle UI generate.
Per i temi chiari `applyAnchors` sostituisce la rampa con
`--ink: oklch(0.240 0 0)`, `--ink-muted: oklch(0.430 0 0)` e
`--ink-faint: oklch(0.520 0 0)`: il guscio mantiene testo scuro e rapporti
leggibili anche quando le superfici arrivano da `export.pageBg` e
`export.cardBg` di `omp`.

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

Colore funzionale: serve a riconoscere un progetto a colpo d'occhio, non a decorare. La tinta automatica nasce deterministicamente dall'hash del path, ma usa le tinte semantiche del tema `omp` attivo. La scelta manuale resta fissa finche' l'utente non ripristina la palette del tema.

L e C sono fissi per tinta-stato e cambiano con la luminanza del tema, cosi' tutte le tessere hanno lo stesso peso visivo sia sui temi chiari sia su quelli scuri.

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

La rampa qui sopra e' il fallback per i temi quasi monocromatici e la palette esplicita del selettore manuale. Per gli altri temi, Studio estrae accento, avviso, stati e colori sintattici: se non bastano a distinguere i progetti, completa la rampa ruotando le tinte gia' presenti senza introdurre una palette estranea.

**Dove il colore del progetto compare davvero:**

- **Punto identità** sulla tessera (8px, `--proj-l-fill` / `--proj-c-fill`):
  pieno quando un agente è aperto sul progetto, neutro `--ink-faint` al 50%
  quando non lo è. È l'uso principale, e l'unico sempre presente.
- **Arco di lavoro** e **contatore dei task pronti** sulla tessera aperta.
- **Lampo di transizione** (§6), al 35% e per 600ms.
- **Tessera del pannello di progetto** (§7.8): l'unico riempimento pieno che
  resta, ed è dentro un pannello, non in cima allo schermo.

La sigla sulla tessera è **neutra** (`--ink`, oppure `--ink-faint` senza
agente): con il punto accanto, tingere anche il testo raddoppierebbe lo stesso
segnale a scapito del contrasto. Per la stessa ragione la tessera aperta non è
più un riempimento saturo ma un fondo neutro all'8%: il colore che identifica
resta al suo posto e non c'è nessun blocco pieno in cima allo schermo.

### 2.8 Il terminale non è nel sistema di colore

La palette ANSI dentro la viewport appartiene al tema di `omp`. OMP Studio imposta solo `background` (`--bg-sunken`) e `foreground` (`--ink`) del terminale, e non tocca i 16 colori. Nessun tema del guscio può riscrivere i colori del contenuto.

### 2.9 Il tema arriva da `omp`

I valori fissi delle §2.2–2.5 sono il **default**, non l'unica possibilità: il
selettore in barra sostituisce le ancore del tema, e tutto il resto continua a
derivare da quelle.

| Token | Origine nel tema di `omp` |
|---|---|
| `--bg-base` | la superficie con luminanza maggiore fra `export.pageBg` e `export.cardBg` |
| `--bg-sunken` | la superficie con luminanza minore fra `export.pageBg` e `export.cardBg` |
| `--brand-h` / `--brand-c` | tinta e croma di `colors.accent` |
| `--warn-h` / `--warn-c` | tinta e croma di `colors.warning` |
| modo chiaro/scuro | luminanza di `export.pageBg` |

Tre conseguenze volute:

- **La rampa di testo segue la luminanza.** I temi scuri usano testo chiaro e
  i temi chiari testo scuro; `--on-brand` e `--on-project` cambiano insieme per
  non mettere testo chiaro su una superficie chiara.
- **La croma si taglia, non si inventa.** `--brand-c` è il minimo fra la croma
  dell'accento del tema e 0.190: un tema monocromatico resta monocromatico.
- **I 16 colori ANSI restano di `omp`** (§2.8). Il guscio e la TUI combaciano
  perché usano lo *stesso* tema, non perché il guscio ridipinga il contenuto.
- **Il catalogo e' diviso in due tab persistenti per luminanza, non per prefisso.** I 100 temi builtin
  incorporati (52 scuri e 48 chiari) finiscono nella tab corrispondente anche
  quando il nome del tema non contiene `dark` o `light`.

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

Definiti da una sola costante: `--radius: 10px`, e `sm`/`md` derivati con `calc()`. Cambiare il carattere dei bordi dell'app è una riga sola.

Tetto assoluto: **10px**. Un raggio a 16px+ su un pannello di uno strumento tecnico è un difetto, non uno stile.

### Tratti e ombre

- Bordi: sempre 1px. Mai bordi colorati laterali come accento (`border-left` spesso è vietato).
- Ombre: **una sola**, e solo per superfici che galleggiano davvero (popover, dialog): `--shadow-overlay: 0 8px 24px -8px oklch(0 0 0 / 0.7), 0 2px 6px -2px oklch(0 0 0 / 0.5)`.
- Nessuna ombra su tessere, righe, bottoni, pannelli. Nessuna ombra "morbida e larga" come decorazione.

### Icone — un set solo

Le icone sono **Lucide** (`@lucide/svelte`), e non esiste una seconda sorgente.

- **Un registro, non trentasette import.** I componenti importano da
  `src/lib/icons.ts`, che riesporta solo le icone in uso con un nome che dice a
  cosa servono (`IconFolderOpen`, `IconRename`, `IconStatusRunning`). Cambiare
  il glifo di un'azione è una riga in quel file. Nei componenti l'import diretto
  da `@lucide/svelte` è vietato: il barrel del pacchetto contiene 1777 moduli e
  in dev li servirebbe tutti.
- **Una misura.** `svg.lucide` in `app.css` legge `--icon-size` (default 14px).
  Chi ha bisogno di un'altra misura la imposta sul **contenitore**, e tutte le
  icone dentro la seguono. La prop `size` non si usa: la dimensione è una
  proprietà del posto, non della chiamata.
- **Tratto nativo.** Lucide disegna su griglia 24 con tratto 2: a 14px sono
  1,17px ottici, coerenti con gli hairline da 1px del resto del guscio.
- **La classe non si passa a un'icona.** Lo scoping CSS di Svelte non raggiunge
  la radice di un componente figlio: `<IconChevronRight class="chevron" />`
  perde ogni regola `.chevron`. L'icona si avvolge nell'elemento che ha già la
  classe, e rotazioni, colori e transizioni continuano a funzionare.
- **Nessuna emoji come icona.** Il font emoji del sistema porta il suo colore,
  ignora la palette (§2) e cambia disegno fra Windows e macOS: tre motivi che
  bastano da soli.
- **Cosa non è un'icona** e resta testo: le legende dei tasti (`↑ ↓ ↵`), il
  segno di moltiplicazione (`1024 × 768`, `×3`), i separatori in prosa, i
  puntini di stato disegnati in CSS e i tre glifi dei controlli finestra, che
  seguono la convenzione del sistema operativo e non il set.

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
| `--dur-base` | 180 | Fade di riga |
| `--dur-slow` | 240 | Popover e dialog; larghezza delle tessere di progetto |
| `--dur-calm` | 480 | Colore e opacità di un cambio di stato dell'agente |
| `--dur-flash` | 600 | Lampo di transizione sulla tessera |
| `--dur-pulse` | 1800 | Ciclo del respiro «l'agente aspetta te» |

Le due durate lunghe esistono solo per la barra progetti, e solo perché lì il
movimento porta un'informazione invece di accompagnare un'azione: un cambio di
stato a 120ms è uno scatto che l'occhio legge come un errore di rendering.

### Curve

```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);      /* out-quart: default per entrate */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);  /* out-expo: popover, pannelli */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* solo per cicli che tornano (pulse) */
```

Nessun bounce, nessun elastic, nessun overshoot.

### Le tre regole di movimento di questa app

1. **Lo switch di progetto non si anima.** Il contenuto delle tre colonne appare a `--dur-instant`. Si anima soltanto la tessera: quella che si apre allarga la propria larghezza per fare posto al nome del progetto, quella che si chiude la restituisce (`--dur-slow`, `--ease-out`). Motivo: cambiare progetto è cambiare stanza; animare le colonne aggiungerebbe 200ms di latenza percepita su un'azione fatta decine di volte al giorno, mentre la tessera che cresce è l'indicatore di posizione, non una transizione di contenuto.

   La larghezza si anima passando `grid-template-columns` da `0fr` a `1fr` su un contenitore in `overflow: hidden`: è l'unico modo di animare una larghezza *automatica* senza cablare un `max-width` che poi taglierebbe i nomi lunghi.

2. **Il terminale non è mai il soggetto di un'animazione.** Niente fade in ingresso, niente slide, niente scale. La viewport appare già disegnata. Animarla causa reflow su un canvas che sta ridisegnando testo.

3. **Un solo movimento persistente in tutta l'app**: il respiro dell'anello ambra sulla tessera di un progetto che **aspetta una risposta**. Opacità `1 → 0.35 → 1` su un anello inset da 1.5px in `--warn`, 1800ms, `--ease-in-out`, infinito. Il movimento serve a chiamare qualcuno: lo stato che ha bisogno dell'utente è il solo che ha diritto di muoversi, mentre «sta lavorando» non chiede niente a nessuno e si accontenta di un punto pieno.

   L'arco che gira sulla tessera **aperta** in `working` non è un'eccezione a questa regola: è un'animazione locale a un solo elemento visibile solo sul progetto che si sta già guardando, e scompare quando la tessera si chiude.

Il respiro è a **duty-cycle**: due plateau (opacità 1 e 0.35) collegati da rampe `steps(6)`. Il compositor aggiorna 12 frame discreti per ciclo invece di uno per vsync — su GPU integrata è la differenza tra un'animazione gratuita e un costo fisso a riposo. Il keyframe è `state-pulse`, globale in `src/app.css`; `tab-spin` e `tab-flash` vivono dentro `TopBar.svelte`, dove sono usati.

### Reduced motion — obbligatorio

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  /* L'arco che gira degrada a un anello intero: fermo a un angolo qualsiasi
     sembrerebbe un anello rotto, non uno stato. */
  .tab-spin { border-color: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue)); }
}
```

Nessuna animazione deve essere l'unico veicolo di un'informazione: «aspetta te» resta leggibile dall'anello ambra anche fermo, «al lavoro» dal punto pieno e dalla sigla accesa.

---

## 7. Componenti

### 7.1 Barra progetti (top bar)

Altezza 48px, sfondo `--bg-raised`. Nessun bordo inferiore: la separazione dal corpo è la differenza di luminanza con `--bg-base`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▣ │ ●OM Omnipulse ◔ 3  ●CA  ○PU  ●GE                ⌁ 69%  [tema] ▾    │
└────────────────────────────────────────────────────────────────────────┘
  logo  tessera aperta      tessere chiuse          usage    controlli
```

- **Tessera**: altezza 30px, `--radius-md`, gap 2px. Anatomia fissa, da sinistra:
  punto identità 8px · sigla in mono `--text-sm`/600 · nome del progetto ·
  arco di lavoro · contatore della coda. Gli ultimi tre non esistono a riposo:
  compaiono **animando la propria larghezza** (§6).
- **Il colore vive nel punto, non nel riempimento.** Otto progetti aperti sono
  otto punti da 8px, non otto blocchi saturi: il colore per progetto resta
  sempre visibile senza mai competere con il contenuto delle colonne. La sigla
  è neutra (`--ink`), non tinta.
- **Tessera aperta**: fondo `color-mix(in srgb, var(--ink) 8%, transparent)` e
  nome del progetto rivelato accanto alla sigla. È l'unica tessera che porta un
  nome, ed è il motivo per cui la barra non ha più un titolo al centro: il nome
  del progetto attivo è scritto una volta sola, dove sta la sua tessera.
- **Stato sulla tessera.** Due segnali indipendenti, perché rispondono a due
  domande diverse — «c'è un agente?» e «mi sta chiamando?»:
  - `working` — punto pieno nel colore del progetto, sigla `--ink`. Sulla
    tessera aperta, in più, un arco da 12px che gira in 900ms.
  - `idle` e `unknown` — punto neutro `--ink-faint` al 50%, sigla
    `--ink-faint`. La tessera si ritira senza sparire. Una tessera **aperta**
    non si spegne mai: la sua sigla resta `--ink` anche senza agente.
  - `attention` — anello 1.5px `--warn` inset sull'intera tessera, che pulsa
    con `state-pulse`. **È il solo elemento animato in modo persistente
    dell'app**: il movimento serve a chiamare qualcuno, e "sta lavorando" non
    chiama nessuno.
  - `finished` — anello fermo 1px `--brand`. Ha finito, nessuna urgenza.

  Nessun alone, nessuna ombra: solo anelli inset. I due anelli si spengono
  insieme con l'impostazione «Segno di stato agente».
- **Contatore della coda**: mono 10px/700 `tabular-nums`, dentro la tessera
  aperta. `--ink-faint` quando i task non possono partire, tinta del progetto
  quando sono pronti. Le tessere chiuse restano mute: il conto complessivo di
  tutti i progetti sta nel chip «Coda» a destra.
- **Lampo di transizione**: a ogni cambio di stato dell'agente la tessera
  lampeggia una volta nella tinta del progetto al 35% (§6). Rende percepibile
  un evento che altrimenti sarebbe solo un'opacità diversa.
- La tessera non porta `title`: nome, percorso e stato stanno nel pannello
  (§7.8), e l'`aria-label` porta già nome e stato per chi legge con la voce.
- **Pulsante `+`**: apre il selettore progetto (recenti + sfoglia + crea).
- **Chip usage**: mostra solo il numero peggiore tra tutte le quote (`min(remainingFraction)`) e la sua icona. Click → popover. Colore per severità (§2.6). È l'unico elemento della barra che può essere colorato di ambra o cremisi.
- **Scratchpad**: nessun punto e nessuna sigla, solo l'icona fantasma su bordo
  tratteggiato. Non è un progetto e non deve sembrarlo.

Massimo consigliato: 8 tessere. Oltre, la barra scorre orizzontalmente senza scrollbar visibile. Non si comprimono le tessere: si stringono da sole, perché solo la tessera aperta porta il nome.

### 7.2 Popover usage

Larghezza fissa 360px, `--bg-overlay`, `--radius-lg`, `--shadow-overlay`, padding 16px. Ancorato al chip, `position: fixed`, chiusura su `Esc` e click esterno, focus trap.

Struttura, dall'alto:

1. **Riga di sintesi** — la quota peggiore in evidenza: percentuale residua in mono `--text-lg` con `tabular-nums`, label del provider, countdown al reset (`resets_at` → "si azzera in 3h 42m").
2. **Elenco quote** — una riga per ogni `limits[]` di ogni provider: label, barra di avanzamento 4px con `--radius-full`, percentuale a destra. Raggruppate per provider, provider ordinati per severità decrescente.
3. **Sparkline** — trend di `used_fraction` delle ultime 24h dalla tabella `usage_history`, 32px di altezza, tratto 1.5px `--ink-faint`. Nessun asse, nessuna griglia, nessuna legenda.
4. **Piede** — costo sessione corrente e totale di oggi da `stats.db`, in mono, `--ink-muted`. `fetchedAt` come "aggiornato 12s fa" in `--text-xs`.

Il popover **non copre mai la viewport del terminale**: si apre ancorato in alto a destra sopra la barra e, se lo spazio verticale non basta, scrolla internamente.

Vietato: grafici a torta, KPI card, numeri giganti decorativi, gradienti nelle barre.

### 7.3 Colonna sinistra — file, git e agente

Larghezza default 260px, min 180px, max 480px. Tre sezioni con header sticky,
commutabili: **FILE**, **GIT**, **AGENTE**.

- **FILE** — albero della cartella progetto. Righe 22px, indentazione 12px per livello, icona 14px, nome in `--text-base`. Cartelle prima, ordine alfabetico. Filtro incrementale in cima. Directory rumorose (`bin`, `obj`, `.vs`, `packages`, `node_modules`) collassate e in `--ink-faint` per default.
- **GIT** — stato di lavoro, ultimo commit, branch e sessioni recenti collegate al lavoro.
- **AGENTE** — due viste secondarie, **Coda** e **Sessioni**. La Coda usa righe dense senza card: maniglia di riordino, titolo derivato dalla prima riga, estratto e modifica. Il click sul testo avvia solo quando `omp` è `idle` e l'input del terminale è vuoto. Sessioni mostra il primo prompt su due righe, data relativa e badge neutro `TASK` per le sessioni nate dalla coda. Il click invia `/resume <id>` nella TUI corrente.

Il prompt completo si modifica nella colonna centrale: textarea a tutta altezza,
salvataggio automatico, eliminazione a doppia azione inline. Dopo un invio riuscito
AGENTE passa a Sessioni e marca la sessione nuova come attiva.

### 7.4 Colonna centrale — editor e task

`--bg-sunken`. I file aperti vivono in tab per progetto: ciascuno espone nome, indicatore di modifica, diff e chiusura; il modello Monaco resta vivo finche' la tab non viene chiusa. Il salvataggio resta nel solo file attivo. Nessuna minimap per default (larghezza sprecata a questa densita'), nessun breadcrumb, nessuna barra strumenti.

Quando si crea o modifica un task, il composer sostituisce temporaneamente l'editor
senza chiuderne i modelli. Chiudendo il composer torna la superficie precedente.

Stato vuoto: nessuna illustrazione. Una riga in `--ink-faint` centrata e il set di scorciatoie disponibili.

### 7.5 Colonna destra — terminale

`--bg-sunken`, padding 8px sui soli lati, 0 in alto e in basso (il terminale gestisce il proprio scroll). Task e storico pilotano questa stessa TUI con `/new` e `/resume`: non aprono tab aggiuntivi e non riavviano il PTY.

**Vincolo tecnico che vincola il design:** un terminale nascosto con `display: none` misura 0 e rompe `FitAddon` ([xterm.js #3029](https://github.com/xtermjs/xterm.js/issues/3029)). I terminali dei progetti non attivi restano quindi montati e dimensionati, nascosti con `visibility: hidden` fuori dal flusso. Conseguenza di design: **non esistono transizioni di crossfade tra terminali di progetti diversi**, perché sono tutti presenti contemporaneamente. Coerente con la regola 1 del movimento.

### 7.6 Splitter di colonna

Nessuna maniglia visibile a riposo: le colonne si separano per luminanza (`--bg-base` a sinistra, `--bg-sunken` al centro e a destra), non per riga. Area di presa da 6px, `cursor: col-resize`. Hover e trascinamento → una linea da 1px in `--brand` al centro dell'area. Doppio click → ripristina la larghezza di default. Le larghezze sono per-progetto e persistono.

Vale per tutta l'app: **nessun bordo verticale nel corpo**, e nessun bordo sotto gli header di colonna. Il contenuto scorrevole è mascherato in cima (`mask-image`, 10px) così le righe svaniscono passando sotto l'header invece di essere tagliate da una linea.

### 7.7 Fuoco e tastiera

```css
:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: inherit;
}
```

`--brand` su `--bg-base` misura 4.63:1, oltre il minimo di 3:1 per indicatori non testuali. Nessun elemento interattivo senza stato di fuoco visibile. Nessun `outline: none` senza sostituto.

Le scorciatoie globali vivono su `Ctrl+Alt`, che la TUI di `omp` non usa. Nell'editor Monaco, `Ctrl+S`, `Ctrl+W` e `Ctrl+F4` agiscono solo quando il fuoco e' nel codice; il terminale continua a ricevere senza eccezioni le proprie combinazioni.

### 7.8 Pannello della tessera progetto

Un solo pannello, due modi di aprirlo. Al **passaggio del mouse** (280ms di
attesa, 160ms di grazia all'uscita) è un'anteprima effimera che non prende il
fuoco. Col **click destro** — e col tasto `Menu` o `Shift+F10`, che nella
WebView generano lo stesso evento — è fissato: prende il fuoco sulla prima
azione, si segna con il bordo in `--brand` e si chiude solo con `Esc`, con un
click fuori o eseguendo un comando. Il menu contestuale della WebView è
soppresso: «Ricarica / Indietro / Stampa» non significano niente qui.

- `role="dialog"` con `aria-modal="false"`, **non** `role="tooltip"`: le APG
  WAI-ARIA vietano i tooltip che contengono elementi attivabili, e qui dentro
  ci sono campi di testo, bottoni e un selettore di tinta. La tessera dichiara
  `aria-haspopup="dialog"` e `aria-expanded`.
- **Larghezza fissa 300px.** Non è una preferenza estetica: la riga di un task
  in coda è la prima riga di un prompt, e su una riga sola dettava la larghezza
  del pannello fino a mandarlo fuori dallo schermo. Il testo si taglia con
  l'ellissi, il pannello non cresce.
- **Top layer.** `popover="manual"` e apertura da JS: il pannello non viene
  tagliato dall'`overflow` della barra e non litiga con gli `z-index`. Il
  piazzamento resta in JavaScript (`src/lib/anchoredPopover.ts`): CSS Anchor
  Positioning non esiste su WKWebView prima di Safari 26, quindi su macOS 14 e
  15 il pannello finirebbe fuori posto. L'azione ribalta sull'asse verticale
  quando sotto non c'è spazio, blocca il pannello dentro i bordi della finestra
  e ricalcola su scroll, resize e cambio di dimensione del pannello.
- **Ponte del mouse.** Uno pseudo-elemento da 8px copre lo stacco fra tessera e
  pannello, sul lato giusto rispetto al ribaltamento: senza, il cursore che
  attraversa i 6px di distacco farebbe scattare la chiusura.
- Struttura, dall'alto: identità (tessera, nome, percorso troncato al centro,
  rinomina) · stato dell'agente in una riga · coda del progetto con avvio e
  modifica per riga, e il motivo quando l'avvio non è possibile · azioni del
  progetto · **Colore** · chiusura, con la conferma che appare dentro il
  pannello e non in un dialogo.
- **Il selettore di tinta** mostra solo tinte che il sistema sa produrre: la
  striscia e i pallini sono resi con `--proj-l-fill` e `--proj-c-fill`, quindi
  ogni colore visibile è esattamente quello che prenderà la tessera. Niente
  selettore RGB del browser: il modello dati conserva una tinta, non un colore,
  e un selettore a sedici milioni di colori che ne consegna trecentosessanta
  mente all'utente.

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
  --dur-calm: 480ms;  --dur-flash: 600ms;
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
- [ ] Nessuna emoji usata come icona: solo il set di §4 via `src/lib/icons.ts`.
- [ ] Nessuna `class` passata a un componente icona: si avvolge, non si decora.
- [ ] Nessun `title` che ripete un'informazione già visibile accanto.
- [ ] Nessun pannello sospeso la cui larghezza dipenda dal contenuto.
