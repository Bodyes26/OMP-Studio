<script lang="ts">
  import { tick } from 'svelte';
  import { createAsciiReveal, type AsciiRevealController } from 'ascii-reveal/core';

  // Tipi per i task e per il task in corso
  interface QueueTask {
    id: number;
    title: string;
    prompt: string;
    d: string[];
    model: string | null;
  }

  interface CurrentWork {
    t: string;
    left: number;
  }

  // Costanti dal catalogo e dal prototipo
  const SPIN = ['-', '\\', '|', '/'];
  const DIRS = ['Plan Mode', 'Discussion & Requirements', 'Minimal Solution', 'Online Web Research'];
  const SUGG = [
    'Add rate limiting to the public API',
    'Log every failed webhook with its payload',
    'Explain why invoice totals drift by a cent'
  ];

  // Generatore del titolo breve (simula l'elaborazione del modello leggero)
  function shortTitle(p: string): string {
    const w = p.replace(/[.,:;].*$/, '').split(/\s+/);
    return w.slice(0, 5).join(' ');
  }

  // Stato reattivo del componente con le rune di Svelte 5
  let queue = $state<QueueTask[]>([
    {
      id: 1,
      title: 'Rename Customer to Account',
      prompt: 'Rename the Customer model to Account across the API, the database migrations and the OpenAPI schema. Keep the old JSON field names as aliases for one release.',
      d: ['Plan Mode'],
      model: 'Sonnet 5.5'
    },
    {
      id: 2,
      title: 'Remove unused v1 endpoints',
      prompt: 'Find the v1 endpoints that no client has called in the last 90 days according to the access logs, and remove them with their tests.',
      d: [],
      model: null
    }
  ]);

  let nextId = 3;
  let editing = $state<number | null>(null);
  let done = $state<string[]>([]);
  let current = $state<CurrentWork | null>({ t: 'Retry failed Stripe webhooks', left: 22 });
  let auto = $state(false);
  let frame = $state(0);
  let picked = $state<string[]>([]);
  let askFor = $state<number | null>(null);
  let lanes = $state(0);
  let promptText = $state('');
  let dragId = $state<number | null>(null);
  let dragOverId = $state<number | null>(null);

  // Riferimenti agli elementi DOM per le animazioni e il focus
  let rootEl: HTMLDivElement | null = null;
  let queueEl: HTMLOListElement | null = null;
  let agentEl: HTMLSpanElement | null = null;
  let doneEl: HTMLDivElement | null = null;
  let promptEl: HTMLTextAreaElement | null = null;

  // Istanza di ascii-reveal
  let reveal: AsciiRevealController | null = null;

  // Registro dei timer attivi per evitare leak alla distruzione del componente
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  function schedule(fn: () => void, delay: number) {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      fn();
    }, delay);
    pendingTimers.add(timer);
    return timer;
  }

  // Reset dei campi di input del task
  function resetEditor() {
    promptText = '';
    picked = [];
    editing = null;
  }

  // Tasto suggerimento: popola il prompt e mette a fuoco l'area di testo
  function applySuggestion(s: string) {
    promptText = s;
    promptEl?.focus();
  }

  // Toggle di una direttiva nella creazione del task
  function toggleDir(d: string) {
    if (picked.includes(d)) {
      picked = picked.filter((x) => x !== d);
    } else {
      picked = [...picked, d];
    }
  }

  // Modifica di un task esistente: carica il prompt e le direttive nell'editor
  function editTask(q: QueueTask) {
    editing = q.id;
    promptText = q.prompt;
    picked = [...q.d];
    promptEl?.focus();
  }

  // Invio del task (aggiunta nuova o salvataggio di una modifica)
  async function submitTask() {
    const t = promptText.trim();
    if (!t) return;

    if (editing !== null) {
      const editId = editing;
      const q = queue.find((x) => x.id === editId);
      if (q) {
        q.prompt = t;
        q.d = [...picked];
        queue = [...queue];
      }
      resetEditor();
      await tick();
      const el = rootEl?.querySelector(`[data-id="${editId}"]`);
      if (el && reveal) {
        reveal.reveal({ within: el });
      }
      return;
    }

    const q: QueueTask = {
      id: nextId++,
      title: '',
      prompt: t,
      d: [...picked],
      model: null
    };

    queue = [...queue, q];
    resetEditor();
    await tick();

    if (reveal && queueEl) {
      const lastEl = queueEl.lastElementChild;
      if (lastEl) {
        reveal.reveal({ within: lastEl });
      }
    }

    // Il titolo sintetico arriva circa 1.2s dopo, simulando il modello leggero
    schedule(async () => {
      q.title = shortTitle(q.prompt);
      queue = [...queue];
      await tick();
      const titleEl = rootEl?.querySelector(`[data-id="${q.id}"] .t`);
      if (titleEl && reveal) {
        reveal.reveal({ within: titleEl });
      }
    }, 1200);
  }

  // Avvia un task sul main oppure in una nuova corsia isolata
  async function start(id: number, lane: boolean) {
    const i = queue.findIndex((q) => q.id === id);
    if (i < 0) return;
    const [q] = queue.splice(i, 1);
    queue = [...queue];
    askFor = null;

    if (editing === id) {
      resetEditor();
    }

    const title = q.title || shortTitle(q.prompt);
    if (lane) {
      lanes++;
      done = [...done, `${title}  started in a new lane`];
    } else {
      current = { t: title, left: 18 + (q.prompt.length % 7) };
    }

    await tick();
    if (reveal) {
      if (lane && doneEl) {
        reveal.reveal({ within: doneEl });
      } else if (agentEl) {
        reveal.reveal({ within: agentEl });
      }
    }
  }

  // Click su Run: se il main e occupato chiede dove eseguirlo, altrimenti parte subito
  async function handleRun(id: number) {
    if (current) {
      askFor = id;
      await tick();
      const askEl = rootEl?.querySelector(`[data-id="${id}"] .ask`);
      if (askEl && reveal) {
        reveal.reveal({ within: askEl });
      }
    } else {
      start(id, false);
    }
  }

  // Attivazione o disattivazione dell'avvio automatico
  function toggleAuto() {
    auto = !auto;
    if (auto && !current && queue.length > 0) {
      start(queue[0].id, false);
    }
  }

  // Scorciatoie tastiera dentro la textarea: Ctrl/Cmd+Enter invia, Escape annulla modifica
  function handleTextareaKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (promptText.trim()) {
        submitTask();
      }
    } else if (e.key === 'Escape' && editing !== null) {
      e.preventDefault();
      resetEditor();
    }
  }

  // Riordino con le frecce su/giu dalla maniglia del task
  async function handleGripKeyDown(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= queue.length) return;

    const next = [...queue];
    [next[i], next[j]] = [next[j], next[i]];
    queue = next;

    await tick();
    const targetGrip = rootEl?.querySelector<HTMLButtonElement>(`[data-grip="${j}"]`);
    targetGrip?.focus();
  }

  // Drag and drop per il riordino delle righe
  function handleDragStart(e: DragEvent, id: number) {
    dragId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(id));
    }
  }

  function handleDragOver(e: DragEvent, id: number) {
    if (dragId === null) return;
    e.preventDefault();
    if (dragOverId !== id) {
      dragOverId = id;
    }
  }

  function handleDrop(e: DragEvent, targetId: number) {
    e.preventDefault();
    if (dragId === null) return;
    const from = queue.findIndex((q) => q.id === dragId);
    const to = queue.findIndex((q) => q.id === targetId);
    if (from >= 0 && to >= 0 && from !== to) {
      const next = [...queue];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      queue = next;
    }
    dragId = null;
    dragOverId = null;
  }

  function handleDragEnd() {
    dragId = null;
    dragOverId = null;
  }

  // Effetto Svelte 5 per inizializzare il loop di animazione, l'IntersectionObserver e ascii-reveal
  $effect(() => {
    let destroyed = false;
    let animId = 0;
    let last = 0;
    let isVisible = true;

    // Rileva preferenza movimento ridotto
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mediaQuery.matches;

    const onMediaChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced && animId) {
        cancelAnimationFrame(animId);
        animId = 0;
      } else if (!reduced && !animId && isVisible) {
        animId = requestAnimationFrame(loop);
      }
    };
    mediaQuery.addEventListener('change', onMediaChange);

    // IntersectionObserver per mettere in pausa il loop quando fuori schermo
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isVisible = entry.isIntersecting;
        if (isVisible && !reduced && !animId) {
          animId = requestAnimationFrame(loop);
        } else if (!isVisible && animId) {
          cancelAnimationFrame(animId);
          animId = 0;
        }
      }
    });

    if (rootEl) {
      observer.observe(rootEl);
    }

    // Inizializza ascii-reveal dopo che i font sono pronti
    (async () => {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await document.fonts.ready;
      }
      if (destroyed || !rootEl) return;
      reveal = createAsciiReveal(rootEl, {
        preset: 'decode',
        duration: 'fast',
        lazy: false
      });
      reveal.reveal({ origin: 'top-left' });
    })();

    // Loop unico di animazione a 140ms
    function loop(now: number) {
      animId = requestAnimationFrame(loop);
      if (!isVisible || reduced || now - last < 140) return;
      last = now;
      frame++;

      if (!current || frame % 8 !== 0) return;
      if (--current.left > 0) return;

      // Task completato
      const finished = current.t;
      current = null;
      done = [...done, finished];

      if (auto && queue.length > 0) {
        start(queue[0].id, false);
        return;
      }

      tick().then(() => {
        if (reveal && agentEl) {
          reveal.reveal({ within: agentEl });
        }
      });
    }

    if (!reduced) {
      animId = requestAnimationFrame(loop);
    }

    // Pulizia completa di animazioni, timer e observer
    return () => {
      destroyed = true;
      mediaQuery.removeEventListener('change', onMediaChange);
      if (animId) cancelAnimationFrame(animId);
      observer.disconnect();
      for (const timer of pendingTimers) {
        clearTimeout(timer);
      }
      pendingTimers.clear();
      if (reveal) {
        reveal.destroy();
        reveal = null;
      }
    };
  });
</script>

<div class="qc" bind:this={rootEl}>
  <!-- Barra superiore con progetto, stato agente e interruttore auto-start -->
  <div class="top">
    <span class="name">billing-api</span>
    <span
      class="st"
      class:working={current !== null}
      style:visibility={current ? 'visible' : 'hidden'}
      aria-hidden="true"
    >
      {SPIN[frame % 4]}
    </span>
    <span class="agent" bind:this={agentEl} aria-live="polite">
      {#if current}
        working on: {current.t}
      {:else if queue.length > 0}
        free, waiting for you
      {:else}
        free, queue empty
      {/if}
    </span>
    <button
      class="switch"
      type="button"
      role="switch"
      aria-checked={auto}
      onclick={toggleAuto}
    >
      <span class="knob" aria-hidden="true"></span>Auto-start tasks
    </button>
  </div>

  <div class="grid">
    <!-- Colonna sinistra: task in coda e storico completati -->
    <div class="pane">
      <div class="head">
        <span>Queued tasks</span>
        <span>{queue.length ? String(queue.length) : ''}</span>
      </div>

      <ol bind:this={queueEl} aria-live="polite">
        {#if queue.length === 0}
          <li class="empty">No waiting tasks</li>
        {:else}
          {#each queue as q, i (q.id)}
            <li
              class="qt"
              class:dragging={dragId === q.id}
              class:over={dragOverId === q.id && dragId !== q.id}
              draggable="true"
              data-id={q.id}
              role="group"
              aria-label={q.title || q.prompt}
              ondragstart={(e) => handleDragStart(e, q.id)}
              ondragover={(e) => handleDragOver(e, q.id)}
              ondrop={(e) => handleDrop(e, q.id)}
              ondragend={handleDragEnd}
            >
              <div class="side">
                <button
                  type="button"
                  class="ib grip"
                  aria-label="Reorder: {q.title || q.prompt}. Use the arrow keys"
                  data-grip={i}
                  onkeydown={(e) => handleGripKeyDown(e, i)}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="6" cy="4" r="1.2" />
                    <circle cx="10" cy="4" r="1.2" />
                    <circle cx="6" cy="8" r="1.2" />
                    <circle cx="10" cy="8" r="1.2" />
                    <circle cx="6" cy="12" r="1.2" />
                    <circle cx="10" cy="12" r="1.2" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="ib"
                  aria-label="Edit task"
                  data-edit={q.id}
                  onclick={() => editTask(q)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
                  </svg>
                </button>
              </div>

              <div class="ct">
                <div class="hl">
                  <span class="t" class:pending={!q.title}>
                    {q.title || 'Untitled'}
                  </span>
                  <span class="chip model" class:session={!q.model}>
                    {q.model || 'Session model'}
                  </span>
                </div>
                <div class="body">{q.prompt}</div>
                {#if q.d.length > 0}
                  <div class="chips">
                    {#each q.d as d}
                      <span class="chip mode">{d}</span>
                    {/each}
                  </div>
                {/if}
                <div class="acts">
                  <button type="button" class="act run" onclick={() => handleRun(q.id)}>
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4 2.5v11l9-5.5z" />
                    </svg>
                    <span>Run</span>
                  </button>
                  <button
                    type="button"
                    class="act"
                    onclick={() => start(q.id, true)}
                    title="Run in a new isolated lane"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                      <circle cx="4" cy="3.5" r="1.5" />
                      <circle cx="4" cy="12.5" r="1.5" />
                      <circle cx="12" cy="5" r="1.5" />
                      <path d="M4 5v6M12 6.5c0 3-8 2-8 4.5" />
                    </svg>
                    <span>New lane</span>
                  </button>
                </div>
              </div>

              {#if askFor === q.id}
                <div class="ask">
                  Main is busy. Where should it run?
                  <div class="acts">
                    <button type="button" class="act" onclick={() => { askFor = null; }}>
                      Wait in the queue
                    </button>
                    <button type="button" class="act" onclick={() => start(q.id, true)}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                        <circle cx="4" cy="3.5" r="1.5" />
                        <circle cx="4" cy="12.5" r="1.5" />
                        <circle cx="12" cy="5" r="1.5" />
                        <path d="M4 5v6M12 6.5c0 3-8 2-8 4.5" />
                      </svg>
                      <span>New lane</span>
                    </button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        {/if}
      </ol>

      <div class="done" bind:this={doneEl}>
        {#each done.slice(-2).reverse() as t}
          <div><b>✓</b> {t}</div>
        {/each}
      </div>
    </div>

    <!-- Colonna destra: creazione o modifica di un task -->
    <div class="pane">
      <div class="head"><span>New task</span></div>
      <label for="task-prompt" class="sr-only">Task prompt</label>
      <textarea
        id="task-prompt"
        bind:this={promptEl}
        bind:value={promptText}
        placeholder="Describe what the agent should do..."
        onkeydown={handleTextareaKeyDown}
      ></textarea>

      <div class="sugg">
        {#each SUGG as s}
          <button type="button" onclick={() => applySuggestion(s)}>
            {s}
          </button>
        {/each}
      </div>

      <div class="head"><span>Directives</span></div>
      <div class="dirs">
        {#each DIRS as d}
          <button
            class="dir-toggle"
            type="button"
            aria-pressed={picked.includes(d)}
            onclick={() => toggleDir(d)}
          >
            {d}
          </button>
        {/each}
      </div>

      <button
        class="btn"
        type="button"
        disabled={!promptText.trim()}
        onclick={submitTask}
      >
        {editing !== null ? 'Save' : 'Add to queue'}
      </button>
      <button
        class="btn ghost"
        type="button"
        hidden={editing === null}
        style="margin-left:6px"
        onclick={resetEditor}
      >
        Cancel
      </button>
    </div>
  </div>
</div>

<style>
  .qc {
    container-type: inline-size;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--ground-2);
    font: 400 12.5px/1.6 var(--mono);
    overflow: hidden;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  .top .name {
    color: var(--stone);
  }
  .st {
    width: 1ch;
    text-align: center;
    color: var(--faint);
  }
  .st.working {
    color: var(--ochre);
  }
  .agent {
    color: var(--slate);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .switch {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--slate);
    white-space: nowrap;
  }
  .switch:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: 3px;
  }
  .knob {
    width: 28px;
    height: 14px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    position: relative;
    transition: background 0.2s, border-color 0.2s;
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--slate);
    transition: translate 0.25s var(--ease), background 0.2s;
  }
  .switch[aria-checked='true'] .knob {
    border-color: var(--ochre);
    background: rgb(227 192 106 / 0.18);
  }
  .switch[aria-checked='true'] .knob::after {
    translate: 14px 0;
    background: var(--ochre);
  }
  .grid {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    min-height: 270px;
  }
  .pane {
    padding: 12px 14px;
    min-width: 0;
  }
  .pane + .pane {
    border-left: 1px solid var(--line);
  }
  .head {
    font-size: 11px;
    color: var(--faint);
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }
  textarea {
    width: 100%;
    height: 84px;
    resize: none;
    font: 400 13.5px/1.45 var(--sans);
    background: var(--ground);
    color: var(--stone);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 8px;
  }
  textarea:focus {
    outline: none;
    border-color: var(--ochre);
  }
  textarea::placeholder {
    color: var(--faint);
  }
  .sugg {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0 10px;
  }
  .sugg button {
    all: unset;
    cursor: pointer;
    color: var(--faint);
    font-size: 11.5px;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--line-strong);
  }
  .sugg button:hover {
    color: var(--stone);
  }
  .sugg button:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: 2px;
  }
  .dirs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  /* Pulsanti toggle per le direttive con classe dedicata per evitare collisioni con .chip */
  .dir-toggle {
    all: unset;
    cursor: pointer;
    font-size: 11.5px;
    padding: 3px 7px;
    border: 1px solid var(--line);
    border-radius: 2px;
    color: var(--slate);
    transition: border-color 0.2s, color 0.2s;
  }
  .dir-toggle[aria-pressed='true'] {
    border-color: var(--ochre);
    color: var(--ochre);
  }
  .dir-toggle:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: 2px;
  }
  .btn {
    font: 600 12px/1 var(--mono);
    border: 1px solid var(--ochre);
    background: var(--ochre);
    color: var(--on-ochre);
    padding: 8px 10px;
    border-radius: 2px;
    cursor: pointer;
    margin-top: 10px;
    transition: translate 0.25s var(--ease);
  }
  .btn:hover {
    translate: 0 -1px;
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: default;
    translate: none;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ochre);
  }
  ol {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  /* Riga del task ricalcata su QueueTaskItem */
  .qt {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 3px;
    background: var(--ground-2);
    transition: border-color 0.2s, background 0.2s;
  }
  .qt:hover,
  .qt:focus-within {
    border-color: var(--line-strong);
    background: #1a1a17;
  }
  .qt.dragging {
    opacity: 0.4;
  }
  .qt.over {
    border-color: var(--ochre);
  }
  .side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .ib {
    all: unset;
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    border-radius: 3px;
    color: var(--faint);
    cursor: pointer;
  }
  .ib.grip {
    cursor: grab;
  }
  .ib:hover {
    color: var(--stone);
    background: rgb(242 240 234 / 0.06);
  }
  .ib:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: -2px;
  }
  .ib svg {
    width: 13px;
    height: 13px;
  }
  .ct {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hl {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .hl .t {
    flex: 1;
    min-width: 0;
    font: 600 13px/1.35 var(--sans);
    color: var(--stone);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
  .hl .t.pending {
    color: var(--faint);
    font-weight: 400;
    font-style: italic;
  }
  .chip {
    font: 400 11px/1.2 var(--mono);
    padding: 1px 4px;
    border-radius: 2px;
    background: var(--ground);
    color: var(--slate);
    white-space: nowrap;
  }
  .chip.model {
    font-family: var(--sans);
    font-weight: 500;
    background: rgb(242 240 234 / 0.07);
  }
  .chip.model.session {
    color: var(--faint);
    background: var(--ground);
    font-weight: 400;
  }
  .chip.mode {
    border: 1px solid var(--line);
  }
  .body {
    font: 400 12.5px/1.5 var(--sans);
    color: var(--slate);
    max-height: 3em;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 1.2em), transparent);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .acts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin-top: 2px;
  }
  .act {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid var(--line);
    border-radius: 3px;
    color: var(--slate);
    font: 500 11.5px var(--sans);
    transition: background 0.2s, border-color 0.2s, color 0.2s;
  }
  .act svg {
    width: 11px;
    height: 11px;
  }
  .act:hover {
    background: rgb(242 240 234 / 0.06);
    color: var(--stone);
    border-color: var(--line-strong);
  }
  .act.run {
    border-color: rgb(227 192 106 / 0.45);
    background: rgb(227 192 106 / 0.14);
    color: var(--stone);
  }
  .act.run:hover {
    border-color: var(--ochre);
  }
  .act:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: -2px;
  }
  .ask {
    grid-column: 2;
    font: 400 12.5px/1.45 var(--sans);
    color: var(--stone);
    border-top: 1px solid var(--line);
    padding-top: 6px;
    margin-top: 2px;
  }
  .ask .acts {
    margin-top: 6px;
  }
  .empty {
    color: var(--faint);
    font-family: var(--sans);
    font-size: 14px;
  }
  .done {
    margin-top: 12px;
    color: var(--faint);
    font-size: 11.5px;
  }
  .done div {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .done b {
    font-weight: 400;
    color: var(--ok);
  }
  @container (max-width: 620px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .pane + .pane {
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
</style>
