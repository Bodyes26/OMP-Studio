<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { createAsciiReveal, type AsciiRevealController } from 'ascii-reveal/core';

  // Tipi per i messaggi della chat e per le note visive
  type ChatMessage =
    | { kind: 'you'; text: string }
    | { kind: 'notes'; notes: { id: number; text: string }[] }
    | { kind: 'tool'; text: string; status: 'spinning' | 'done'; spinChar?: string }
    | { kind: 'agent'; text: string }
    | { kind: 'rev'; text: string };

  interface NoteItem {
    id: number;
    kind: 'el' | 'area';
    els: HTMLElement[];
    area?: { x: number; y: number; w: number; h: number };
    text: string;
    typed: boolean;
  }

  // Costanti per le scritte, suggerimenti e risposte preconfezionate
  const HINT = {
    point: 'Click: new note · Shift+click: add · Esc: exit',
    area: 'Drag a box over the elements · Esc: exit',
    none: 'Live preview. Choose Point or Area.'
  } as const;

  const SPIN = ['-', '\\', '|', '/'];

  // Mappa delle istruzioni automatiche associate a ciascun elemento del prototipo
  const ASK: Record<string, string> = {
    button: 'Make this button full width and dark.',
    Price: 'Make the price bigger.',
    PlanCard: 'Highlight this plan with a dark border.',
    h5: 'Make the plan name a bit larger.',
    ul: 'Use check marks for the features.',
    BillingToggle: 'Show the yearly discount next to the toggle.',
    Logo: 'Make the logo a bit bigger.',
    header: 'Separate the header with a thin line.'
  };
  const EMPTY_ASK = 'Give this part of the page more breathing room.';

  // Restituisce il testo della nota unendo le richieste dei singoli elementi
  function askFor(n: { els: HTMLElement[] }): string {
    return n.els.length
      ? [...new Set(n.els.map((el) => ASK[el.dataset.name || '']))].join(' ')
      : EMPTY_ASK;
  }

  // Riferimenti DOM
  let labEl = $state<HTMLElement | null>(null);
  let stageEl = $state<HTMLElement | null>(null);
  let frameEl = $state<HTMLElement | null>(null);
  let ppEl = $state<HTMLElement | null>(null);
  let dragEl = $state<HTMLElement | null>(null);
  let msgsEl = $state<HTMLElement | null>(null);
  let doneBtnEl = $state<HTMLButtonElement | null>(null);

  // Stato interattivo del componente
  let mode = $state<'none' | 'point' | 'area'>('none');
  let rev = $state(3);
  let busy = $state(false);
  let notes = $state<NoteItem[]>([]);
  let openNote = $state<NoteItem | null>(null);

  // Stato per la casella del testo digitato nel popover
  let popTypedText = $state('');
  let popPos = $state({ left: 0, top: 0 });

  // Coordinate delle scatole delle note sul canvas overlay
  let noteRects = $state<Map<number, { x: number; y: number; w: number; h: number }>>(new Map());

  // Stato per l'evidenziazione al passaggio del mouse in modalita Point
  let hovVisible = $state(false);
  let hovRect = $state({ x: 0, y: 0, w: 0, h: 0 });
  let hovTag = $state('');

  // Stato per il trascinamento dell'area
  let dragVisible = $state(false);
  let dragRect = $state({ x: 0, y: 0, w: 0, h: 0 });
  let dragStart: { x: number; y: number } | null = null;
  let activePointerId: number | null = null;

  // Classi ed effetti visivi applicati alla scheda prototipo
  let fxElements = $state<Set<string>>(new Set());
  let hasFxGap = $state(false);

  // Messaggi iniziali della chat dell'agente Lab
  let chatMessages = $state<ChatMessage[]>([
    {
      kind: 'you',
      text: 'Build the Team plan card for Acme: $12 per seat, a monthly and yearly toggle, three features and a trial button. Keep it light.'
    },
    {
      kind: 'tool',
      text: 'Edit  src/components/PlanCard.tsx  +34',
      status: 'done'
    },
    {
      kind: 'tool',
      text: 'Edit  src/components/BillingToggle.tsx  +18',
      status: 'done'
    },
    {
      kind: 'agent',
      text: 'The card is ready with the billing toggle. Point at anything you want changed.'
    },
    {
      kind: 'rev',
      text: 'Rev 3 saved'
    }
  ]);

  // Testo di suggerimento derivato dalla modalita attiva
  const hintText = $derived(HINT[mode]);

  // Testo riepilogativo di ciò che l'agente riceve (formato visual notes)
  const pkgText = $derived.by(() => {
    if (!notes.length) return 'Nothing yet.';
    const lines: string[] = [];
    for (const n of notes) {
      lines.push(
        n.kind === 'area' && n.area
          ? `${n.id}. area ${Math.round(n.area.w)}×${Math.round(n.area.h)} at ${Math.round(n.area.x)},${Math.round(n.area.y)}  elements: ${n.els.length}`
          : `${n.id}. ${n.els.length > 1 ? `elements: ${n.els.length}` : 'element'}`
      );
      for (const el of n.els) {
        const textContent = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
        lines.push(`   <${el.dataset.name}>  ${el.dataset.src}\n      text: "${textContent}"`);
      }
      lines.push(`   note: ${n.text}`);
    }
    lines.push('', 'Attached image: preview frame with boxes numbered like the notes.');
    return lines.join('\n');
  });

  // Funzioni geometriche per posizionare le scatole relative al riquadro dell'anteprima
  function relTo(
    node: HTMLElement,
    r: DOMRect | { left: number; top: number; width: number; height: number }
  ) {
    const f = node.getBoundingClientRect();
    return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
  }

  function rel(r: DOMRect | { left: number; top: number; width: number; height: number }) {
    if (!frameEl) return { x: 0, y: 0, w: 0, h: 0 };
    return relTo(frameEl, r);
  }

  function tag(el: HTMLElement) {
    const src = (el.dataset.src || '').replace('src/components/', '').replace('src/', '');
    return `<${el.dataset.name}> ${src}`;
  }

  function unionRect(els: HTMLElement[]) {
    if (!els.length || !frameEl) return { x: 0, y: 0, w: 0, h: 0 };
    const rs = els.map((e) => rel(e.getBoundingClientRect()));
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    return {
      x,
      y,
      w: Math.max(...rs.map((r) => r.x + r.w)) - x,
      h: Math.max(...rs.map((r) => r.y + r.h)) - y
    };
  }

  // Ricalcola le posizioni delle scatole numerate
  function updateNoteRects() {
    if (!frameEl) return;
    const map = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const n of notes) {
      if (n.kind === 'area' && n.area) {
        map.set(n.id, n.area);
      } else if (n.els.length) {
        map.set(n.id, unionRect(n.els));
      }
    }
    noteRects = map;
  }

  // Cambio modalita con tasti Point e Area
  function toggleMode(m: 'point' | 'area') {
    if (openNote) closePop();
    mode = mode === m ? 'none' : m;
    hovVisible = false;
  }

  // Gestione del popover di digitazione automatica
  let typingTimer: ReturnType<typeof setInterval> | null = null;
  let isVisible = true;
  let unmounted = false;
  let revealCtrl: AsciiRevealController | null = null;

  function closePop() {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (openNote && !openNote.typed) {
      // Se si chiude prima della fine del typing, completa il testo per non bloccare l'invio
      openNote.typed = true;
    }
    openNote = null;
  }

  function openPop(n: NoteItem) {
    closePop();
    openNote = n;
    if (!frameEl) return;
    const r = n.kind === 'area' && n.area ? n.area : unionRect(n.els);
    const f = frameEl.getBoundingClientRect();
    const left = Math.min(Math.max(-8, r.x), f.width - 232);
    const top = r.y + r.h + 8 + 120 > f.height ? Math.max(0, r.y - 122) : r.y + r.h + 8;
    popPos = { left, top };

    let i = 0;
    n.typed = false;
    popTypedText = '';

    const finish = async () => {
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
      }
      popTypedText = n.text;
      n.typed = true;
      await tick();
      doneBtnEl?.focus();
    };

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      finish();
    } else {
      typingTimer = setInterval(() => {
        // Mette in pausa l'avanzamento se il componente e fuori dallo schermo
        if (!isVisible) return;
        i += 1 + (Math.random() < 0.3 ? 1 : 0);
        popTypedText = n.text.slice(0, i);
        if (i >= n.text.length) {
          finish();
        }
      }, 32);
    }
  }

  // Rimozione della nota corrente dal popover
  function removeCurrentNote() {
    if (!openNote) return;
    const current = openNote;
    notes = notes.filter((m) => m !== current);
    notes.forEach((m, k) => {
      m.id = k + 1;
    });
    closePop();
    updateNoteRects();
  }

  // Cancellazione di tutte le note
  function clearNotes() {
    notes = [];
    closePop();
    updateNoteRects();
  }

  // Selezione per elemento (Point) o aggiunta a selezione esistente con Shift
  function pick(el: HTMLElement, add: boolean) {
    if (add && openNote && openNote.kind === 'el') {
      if (!openNote.els.includes(el)) {
        openNote.els.push(el);
      }
      openNote.text = askFor(openNote);
      updateNoteRects();
      openPop(openNote);
      return;
    }
    const n: NoteItem = {
      id: notes.length + 1,
      kind: 'el',
      els: [el],
      text: '',
      typed: false
    };
    n.text = askFor(n);
    notes = [...notes, n];
    updateNoteRects();
    openPop(n);
  }

  // Interazioni con la scheda del prototipo
  function onPpPointerMove(e: PointerEvent) {
    if (mode !== 'point' || !frameEl) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
    if (!el) {
      hovVisible = false;
      return;
    }
    hovRect = rel(el.getBoundingClientRect());
    hovTag = tag(el);
    hovVisible = true;
  }

  function onPpPointerLeave() {
    hovVisible = false;
  }

  function onPpClick(e: MouseEvent) {
    if (mode !== 'point') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
    if (el) {
      pick(el, e.shiftKey);
    }
  }

  function onPpKeyDown(e: KeyboardEvent) {
    if (mode === 'point' && e.key === 'Enter') {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
      if (el) {
        e.preventDefault();
        pick(el, e.shiftKey);
      }
    }
  }

  // Interazioni per il disegno del riquadro Area con pointer capture
  function onStagePointerDown(e: PointerEvent) {
    if (mode !== 'area' || (e.target as HTMLElement).closest('.pop')) return;
    e.preventDefault();
    closePop();
    if (!stageEl) return;
    const s = stageEl.getBoundingClientRect();
    dragStart = { x: e.clientX - s.left, y: e.clientY - s.top };
    dragRect = { ...dragStart, w: 0, h: 0 };
    dragVisible = true;
    activePointerId = e.pointerId;
    try {
      stageEl.setPointerCapture(e.pointerId);
    } catch {
      // Cattura del puntatore opzionale se non supportata
    }
  }

  function onStagePointerMove(e: PointerEvent) {
    if (!dragStart || !stageEl) return;
    const s = stageEl.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - s.left, 0), s.width);
    const y = Math.min(Math.max(e.clientY - s.top, 0), s.height);
    dragRect = {
      x: Math.min(x, dragStart.x),
      y: Math.min(y, dragStart.y),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y)
    };
  }

  function onStagePointerUp() {
    if (!dragStart || !dragEl || !frameEl || !ppEl) return;
    dragStart = null;
    const d = dragEl.getBoundingClientRect();
    dragVisible = false;
    if (activePointerId !== null && stageEl) {
      try {
        stageEl.releasePointerCapture(activePointerId);
      } catch {
        // Fallback rilascio cattura
      }
      activePointerId = null;
    }
    if (d.width < 4 || d.height < 4) return;
    const r = rel(d);
    const dataSrcEls = Array.from(ppEl.querySelectorAll<HTMLElement>('[data-src]'));
    const hits = dataSrcEls.filter((el) => {
      const b = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(b.right, d.right) - Math.max(b.left, d.left));
      const iy = Math.max(0, Math.min(b.bottom, d.bottom) - Math.max(b.top, d.top));
      return ix * iy >= 0.35 * Math.min(b.width * b.height, d.width * d.height);
    });
    // Tiene gli elementi piu interni: un contenitore entra solo se nessun figlio e stato preso
    const els = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    const n: NoteItem = {
      id: notes.length + 1,
      kind: 'area',
      els,
      area: r,
      text: '',
      typed: false
    };
    n.text = askFor(n);
    notes = [...notes, n];
    updateNoteRects();
    openPop(n);
  }

  function onStagePointerCancel() {
    if (dragStart) {
      dragStart = null;
      dragVisible = false;
      if (activePointerId !== null && stageEl) {
        try {
          stageEl.releasePointerCapture(activePointerId);
        } catch {
          // Fallback rilascio cattura
        }
        activePointerId = null;
      }
    }
  }

  // Flusso di invio delle note all'agente con simulazione passaggi, decodifica e revisione
  async function sendNotes() {
    if (!notes.length || busy) return;
    busy = true;
    closePop();
    if (mode !== 'none') {
      mode = 'none';
      hovVisible = false;
    }
    const sent = [...notes];

    // Aggiunge il messaggio utente con l'elenco delle note inserite
    chatMessages = [
      ...chatMessages,
      {
        kind: 'notes',
        notes: sent.map((n) => ({ id: n.id, text: n.text }))
      }
    ];

    const targets = sent.flatMap((n) => n.els);
    const files = [...new Set(targets.map((e) => e.dataset.src?.split(':')[0] || ''))].filter(Boolean);
    if (!files.length) files.push('src/App.tsx');

    notes = [];
    updateNoteRects();

    await tick();
    if (msgsEl) {
      msgsEl.scrollTop = msgsEl.scrollHeight;
      if (revealCtrl && msgsEl.lastElementChild) {
        revealCtrl.reveal({ within: msgsEl.lastElementChild as HTMLElement });
      }
    }

    const steps = [
      ...files.map((f) => `Read  ${f}`),
      ...files.map((f) => `Edit  ${f}  +${3 + f.length % 5} -${1 + f.length % 3}`),
      'Compiling…'
    ];

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const step of steps) {
      if (unmounted) return;
      const stepItem = {
        kind: 'tool' as const,
        text: step,
        status: 'spinning' as const,
        spinChar: '-'
      };
      chatMessages = [...chatMessages, stepItem];
      await tick();
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

      const ticksCount = reduced ? 1 : 7;
      for (let k = 0; k < ticksCount; k++) {
        if (unmounted) return;
        while (!isVisible && !unmounted) {
          await new Promise((r) => setTimeout(r, 100));
        }
        stepItem.spinChar = SPIN[k % 4];
        chatMessages = [...chatMessages];
        await new Promise((r) => setTimeout(r, 110));
      }
      stepItem.status = 'done';
      chatMessages = [...chatMessages];
      await tick();
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    if (unmounted) return;

    // Nasconde temporaneamente l'anteprima per applicare i cambiamenti grafici
    if (!reduced && revealCtrl && ppEl) {
      await revealCtrl.hide({ within: ppEl, speed: 2 });
    }

    for (const el of targets) {
      if (el.dataset.name) {
        fxElements.add(el.dataset.name);
      }
      el.classList.add('fx');
    }
    fxElements = new Set(fxElements);

    if (sent.some((n) => !n.els.length)) {
      hasFxGap = true;
      ppEl?.classList.add('fxgap');
    }

    rev++;
    busy = false;

    // Messaggi finali dell'agente con la revisione salvata
    chatMessages = [
      ...chatMessages,
      {
        kind: 'agent',
        text: `Done: ${sent.map((n) => n.text.replace(/\.$/, '').toLowerCase()).join('; ')}.`
      },
      {
        kind: 'rev',
        text: `Rev ${rev} saved · Rev ${rev - 1} is still there if you want it back`
      }
    ];

    await tick();
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    if (revealCtrl && ppEl) {
      await revealCtrl.reveal({ within: ppEl, origin: 'top-left' });
    }
  }

  // Ciclo di vita: inizializzazione di ascii-reveal, osservatore di visibilita ed eventi globali
  $effect(() => {
    let destroyed = false;

    // Inizializza ascii-reveal dopo che i font sono pronti
    (async () => {
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts.ready;
      }
      if (destroyed || !labEl) return;
      revealCtrl = createAsciiReveal(labEl, {
        preset: 'decode',
        duration: 'fast',
        lazy: false
      });
      untrack(() => updateNoteRects());
      revealCtrl.reveal({ origin: 'top-left' });
    })();

    // Mette in pausa le animazioni se il widget e fuori schermo
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && labEl) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            isVisible = entry.isIntersecting;
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(labEl);
    }

    // Gestione ridimensionamento della finestra per riposizionare le caselle
    const handleResize = () => {
      updateNoteRects();
    };
    window.addEventListener('resize', handleResize);

    // Gestione tasto Escape per uscire dalle modalita
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openNote) closePop();
        if (mode !== 'none') {
          mode = 'none';
          hovVisible = false;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Pulizia e rilascio risorse allo smontaggio
    return () => {
      destroyed = true;
      unmounted = true;
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
      }
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeyDown);
      revealCtrl?.destroy();
    };
  });
</script>

<div class="lab" id="lab" bind:this={labEl}>
  <div class="split">
    <div class="left">
      <div class="tb">
        <span class="name">plan-card</span><span class="rev" id="rev">Rev {rev}</span>
        <button
          class="tool"
          type="button"
          id="tPoint"
          aria-pressed={mode === 'point'}
          title="Point at an element. Shift+click adds it to the open selection"
          onclick={() => toggleMode('point')}
        >
          Point
        </button>
        <button
          class="tool"
          type="button"
          id="tArea"
          aria-pressed={mode === 'area'}
          title="Drag a box: collects the elements inside it"
          onclick={() => toggleMode('area')}
        >
          Area
        </button>
      </div>
      <div class="hintbar" id="hint" aria-live="polite">{hintText}</div>
      <div
        class="stagebox"
        id="stage"
        class:area={mode === 'area'}
        bind:this={stageEl}
        onpointerdown={onStagePointerDown}
        onpointermove={onStagePointerMove}
        onpointerup={onStagePointerUp}
        onpointercancel={onStagePointerCancel}
      >
        <div class="frame" id="frame" bind:this={frameEl}>
          <div
            class="pp"
            id="pp"
            class:inspect={mode === 'point'}
            class:fxgap={hasFxGap}
            bind:this={ppEl}
            onpointermove={onPpPointerMove}
            onpointerleave={onPpPointerLeave}
            onclick={onPpClick}
            onkeydown={onPpKeyDown}
          >
            <header
              data-src="src/App.tsx:14"
              data-name="header"
              tabindex={mode === 'point' ? 0 : undefined}
              class:fx={fxElements.has('header')}
            >
              <span
                class="logo"
                data-src="src/components/Logo.tsx:6"
                data-name="Logo"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('Logo')}
              >
                Acme
              </span>
              <span
                class="tog"
                data-src="src/components/BillingToggle.tsx:11"
                data-name="BillingToggle"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('BillingToggle')}
              >
                <span class="on">Monthly</span><span>Yearly</span>
              </span>
            </header>
            <div
              class="card"
              data-src="src/components/PlanCard.tsx:9"
              data-name="PlanCard"
              tabindex={mode === 'point' ? 0 : undefined}
              class:fx={fxElements.has('PlanCard')}
            >
              <h5
                data-src="src/components/PlanCard.tsx:12"
                data-name="h5"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('h5')}
              >
                Team
              </h5>
              <div
                class="price"
                data-src="src/components/PlanCard.tsx:15"
                data-name="Price"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('Price')}
              >
                $12 <small>/ seat / month</small>
              </div>
              <ul
                data-src="src/components/PlanCard.tsx:21"
                data-name="ul"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('ul')}
              >
                <li>Unlimited projects</li>
                <li>Shared billing</li>
                <li>Priority support</li>
              </ul>
              <span
                class="cta"
                data-src="src/components/PlanCard.tsx:28"
                data-name="button"
                tabindex={mode === 'point' ? 0 : undefined}
                class:fx={fxElements.has('button')}
              >
                Start trial
              </span>
            </div>
          </div>
          <div class="overlay" id="ov">
            {#each notes as n (n.id)}
              {@const r = noteRects.get(n.id)}
              {#if r}
                <div
                  class="box"
                  class:area={n.kind === 'area'}
                  style="left: {r.x}px; top: {r.y}px; width: {r.w}px; height: {r.h}px;"
                >
                  <b>{n.id}</b>
                </div>
              {/if}
            {/each}
            <div
              class="hov"
              id="hov"
              style:display={hovVisible ? 'block' : 'none'}
              style:left="{hovRect.x}px"
              style:top="{hovRect.y}px"
              style:width="{hovRect.w}px"
              style:height="{hovRect.h}px"
            >
              <span>{hovTag}</span>
            </div>
            {#if openNote}
              <div
                class="pop"
                role="dialog"
                aria-label={`Note ${openNote.id}`}
                style="left: {popPos.left}px; top: {popPos.top}px;"
              >
                <div class="lbl">
                  {openNote.kind === 'area'
                    ? `Area · elements: ${openNote.els.length}`
                    : `Elements: ${openNote.els.length}`}
                </div>
                <div class="typed" aria-label="Note text">
                  <span>{popTypedText}</span><span class="caret"></span>
                </div>
                <div class="row">
                  <button class="b" type="button" onclick={removeCurrentNote}>Remove</button>
                  <button
                    class="b p"
                    type="button"
                    disabled={!openNote.typed}
                    bind:this={doneBtnEl}
                    onclick={closePop}
                  >
                    Done
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </div>
        <div
          class="drag"
          id="drag"
          bind:this={dragEl}
          style:display={dragVisible ? 'block' : 'none'}
          style:left="{dragRect.x}px"
          style:top="{dragRect.y}px"
          style:width="{dragRect.w}px"
          style:height="{dragRect.h}px"
        ></div>
      </div>
    </div>
    <div class="chat">
      <div class="h">Lab agent</div>
      <div class="msgs" id="msgs" aria-live="polite" bind:this={msgsEl}>
        {#each chatMessages as msg}
          {#if msg.kind === 'you'}
            <div class="m-you">{msg.text}</div>
          {:else if msg.kind === 'notes'}
            <div class="m-you">
              {#each msg.notes as n (n.id)}
                <div class="n"><i>{n.id}</i><span>{n.text}</span></div>
              {/each}
              <div class="img">+ annotated frame of the preview</div>
            </div>
          {:else if msg.kind === 'tool'}
            <div class="m-tool">
              {#if msg.status === 'spinning'}
                <span class="live">{msg.spinChar}</span> {msg.text}
              {:else}
                · {msg.text}
              {/if}
            </div>
          {:else if msg.kind === 'agent'}
            <div class="m-agent">{msg.text}</div>
          {:else if msg.kind === 'rev'}
            <div class="m-rev">{msg.text}</div>
          {/if}
        {/each}
      </div>
      <div class="composer">
        <div class="t">
          <span id="ntitle">Visual notes: {notes.length}</span>
          <button type="button" id="clear" hidden={notes.length === 0} onclick={clearNotes}>
            Clear
          </button>
        </div>
        <div id="nlist">
          {#if notes.length === 0}
            <div class="muted">No notes yet.</div>
          {:else}
            {#each notes as n (n.id)}
              <div class="att"><i>{n.id}</i><span class="txt">{n.text}</span></div>
            {/each}
          {/if}
        </div>
        <details>
          <summary>What the agent receives</summary>
          <pre id="pkg">{pkgText}</pre>
        </details>
        <div class="sendrow">
          <button
            class="b p"
            type="button"
            id="send"
            disabled={notes.length === 0 || busy || notes.some((n) => !n.typed)}
            onclick={sendNotes}
          >
            Send notes
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .lab {
    container-type: inline-size;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--ground-2);
    font: 400 12.5px/1.6 var(--mono);
    overflow: hidden;
  }
  .split {
    display: grid;
    grid-template-columns: 288px minmax(0, 1fr);
  }
  .left {
    min-width: 0;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
  }
  .tb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
  }
  .tb .name {
    color: var(--stone);
    margin: 0 6px 0 4px;
  }
  .tb .rev {
    color: var(--faint);
    margin-right: auto;
  }
  .tool {
    all: unset;
    cursor: pointer;
    padding: 4px 9px;
    color: var(--slate);
    font: 500 12px var(--mono);
    border: 1px solid var(--line);
    border-radius: 3px;
  }
  .tool[aria-pressed='true'] {
    background: rgb(227 192 106 / 0.16);
    color: var(--ochre);
  }
  .tool:hover {
    color: var(--stone);
  }
  .tool:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: -2px;
  }
  .hintbar {
    padding: 4px 10px;
    font-size: 11px;
    color: var(--faint);
    border-bottom: 1px solid var(--line);
    min-height: 26px;
  }
  .stagebox {
    position: relative;
    flex: 1;
    background: #1b1b18;
    padding: 18px 16px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    touch-action: none;
  }
  .stagebox.area {
    cursor: crosshair;
  }
  .frame {
    position: relative;
    width: 100%;
    transition: width 0.45s var(--ease);
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .hov {
    position: absolute;
    border: 1.5px solid var(--ochre);
    background: rgb(227 192 106 / 0.08);
    border-radius: 2px;
    display: none;
  }
  .hov span {
    position: absolute;
    left: -1.5px;
    top: -20px;
    background: var(--ochre);
    color: var(--on-ochre);
    font: 600 10.5px/1 var(--mono);
    padding: 4px 5px;
    white-space: nowrap;
    border-radius: 2px 2px 0 0;
  }
  .box {
    position: absolute;
    border: 1.5px solid var(--ochre);
    border-radius: 2px;
  }
  .box.area {
    border-style: dashed;
  }
  .box b {
    position: absolute;
    left: -9px;
    top: -9px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ochre);
    color: var(--on-ochre);
    font: 700 10.5px/18px var(--mono);
    text-align: center;
  }
  .drag {
    position: absolute;
    border: 1.5px dashed var(--ochre);
    background: rgb(227 192 106 / 0.06);
    display: none;
    pointer-events: none;
    z-index: 2;
  }
  .pop {
    position: absolute;
    z-index: 3;
    width: 240px;
    background: #232320;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    padding: 8px;
    pointer-events: auto;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  }
  .pop .lbl {
    font-size: 11px;
    color: var(--faint);
    margin-bottom: 4px;
  }
  .pop .typed {
    min-height: 54px;
    font: 400 13px/1.4 var(--sans);
    background: var(--ground);
    color: var(--stone);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 6px;
  }
  .pop .typed .caret {
    display: inline-block;
    width: 1px;
    height: 1em;
    background: var(--ochre);
    vertical-align: -2px;
    margin-left: 1px;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .pop .row {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
  }
  .b {
    all: unset;
    cursor: pointer;
    font: 600 11.5px/1 var(--mono);
    padding: 6px 9px;
    border-radius: 2px;
    border: 1px solid var(--ochre);
    color: var(--ochre);
  }
  .b.p {
    background: var(--ochre);
    color: var(--on-ochre);
  }
  .b:focus-visible {
    outline: 2px solid var(--stone);
    outline-offset: 2px;
  }
  .b:disabled {
    opacity: 0.35;
    cursor: default;
  }
  /* Chat del Laboratorio a destra */
  .chat {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 420px;
  }
  .chat .h {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    color: var(--faint);
    font-size: 11px;
  }
  .msgs {
    flex: 1;
    overflow: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 300px;
  }
  .m-agent {
    font: 400 13.5px/1.45 var(--sans);
    color: var(--stone);
  }
  .m-tool {
    color: var(--faint);
    font-size: 11.5px;
  }
  .m-tool .live {
    color: var(--ochre);
  }
  .m-you {
    align-self: flex-end;
    max-width: 92%;
    background: rgb(242 240 234 / 0.06);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 7px 9px;
    font: 400 13px/1.45 var(--sans);
  }
  .m-you .n {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .m-you i,
  .att i {
    font-style: normal;
    color: var(--on-ochre);
    background: var(--ochre);
    border-radius: 50%;
    width: 16px;
    height: 16px;
    flex: none;
    display: grid;
    place-items: center;
    font: 700 10px var(--mono);
  }
  .m-you .img {
    margin-top: 4px;
    color: var(--faint);
    font: 400 11px var(--mono);
  }
  .m-rev {
    color: var(--ok);
    font-size: 11.5px;
  }
  .composer {
    border-top: 1px solid var(--line);
    padding: 10px 12px;
  }
  .composer .t {
    display: flex;
    justify-content: space-between;
    color: var(--faint);
    font-size: 11px;
    margin-bottom: 6px;
  }
  .composer .t button {
    all: unset;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .att {
    display: flex;
    gap: 6px;
    align-items: baseline;
    color: var(--slate);
    white-space: nowrap;
    overflow: hidden;
  }
  .att .txt {
    font-family: var(--sans);
    font-size: 12.5px;
    color: var(--stone);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .muted {
    color: var(--faint);
  }
  details {
    margin-top: 6px;
  }
  summary {
    cursor: pointer;
    color: var(--faint);
    font-size: 11px;
  }
  pre {
    margin-top: 6px;
    white-space: pre-wrap;
    font: 400 11px/1.5 var(--mono);
    color: var(--slate);
    background: var(--ground);
    border: 1px solid var(--line);
    padding: 8px;
    border-radius: 2px;
    max-height: 150px;
    overflow: auto;
  }
  .sendrow {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
  /* Il prototipo: una pagina React chiara, come quelle che produce il Laboratorio */
  .pp {
    background: #fafaf9;
    color: #1c1917;
    border-radius: 6px;
    font: 400 13px/1.45 system-ui, 'Segoe UI', sans-serif;
    padding: 12px;
    transition: padding 0.4s var(--ease);
  }
  .pp [data-src] {
    transition: all 0.4s var(--ease);
  }
  .pp.inspect [data-src] {
    cursor: crosshair;
  }
  .pp header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .pp .logo {
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .pp .tog {
    display: flex;
    background: #e7e5e4;
    border-radius: 999px;
    padding: 2px;
    font-size: 11.5px;
  }
  .pp .tog span {
    padding: 3px 9px;
    border-radius: 999px;
  }
  .pp .tog .on {
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
  }
  .pp .card {
    border: 1px solid #e7e5e4;
    border-radius: 8px;
    padding: 12px;
    background: #fff;
  }
  .pp .card h5 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  .pp .price {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 4px 0;
  }
  .pp .price small {
    font-size: 11.5px;
    font-weight: 400;
    color: #78716c;
  }
  .pp ul {
    margin: 6px 0 10px;
    padding-left: 16px;
    color: #57534e;
    font-size: 12px;
  }
  .pp .cta {
    display: inline-block;
    background: #7c3aed;
    color: #fff;
    border-radius: 6px;
    padding: 6px 12px;
    font-weight: 600;
    font-size: 12px;
  }
  /* Modifiche applicate dall'agente alla revisione successiva */
  .pp .cta.fx {
    display: block;
    text-align: center;
    background: #1c1917;
    color: #fff;
    padding: 8px 12px;
  }
  .pp .price.fx {
    font-size: 28px;
  }
  .pp .card.fx {
    border-color: #1c1917;
    box-shadow: 0 0 0 1px #1c1917;
  }
  .pp h5.fx {
    font-size: 15px;
  }
  .pp ul.fx {
    list-style: '✓  ';
    color: #1c1917;
  }
  .pp .tog.fx::after {
    content: 'Save 20%';
    margin-left: 6px;
    align-self: center;
    color: #15803d;
    font-weight: 600;
    padding-right: 6px;
  }
  .pp .logo.fx {
    font-size: 16px;
  }
  .pp header.fx {
    padding-bottom: 10px;
    border-bottom: 1px solid #e7e5e4;
  }
  .pp.fxgap {
    padding: 20px;
  }
  .pp.fxgap .card {
    padding: 18px;
  }

  @container (max-width: 560px) {
    .split {
      grid-template-columns: 1fr;
    }
    .left {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pop .typed .caret {
      animation: none;
    }
  }
</style>
