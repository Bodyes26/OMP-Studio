<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { createAsciiReveal, type AsciiRevealController } from 'ascii-reveal/core';

  // Costanti per spinner e intestazioni di stato
  const SPIN = ['-', '\\', '|', '/'];
  const STATE = {
    question: 'Waiting for answer',
    read: 'Answer ready',
    working: 'Working',
    idle: 'Idle'
  } as const;

  const SUGG = [
    '#mobile-app add haptic feedback to the save button',
    '#billing-api log every failed webhook with its payload'
  ];

  type ProjectState = 'question' | 'read' | 'working' | 'idle';
  type MsgTuple = [role: 'you' | 'tool' | 'agent', text: string];

  interface AskData {
    q: string;
    opts: string[];
    rec: number;
  }

  interface ProjectData {
    state: ProjectState;
    line: string;
    msgs: MsgTuple[];
    ask?: AskData;
    left?: number;
    result?: string;
  }

  interface QueueTask {
    p: string;
    t: string;
  }

  // Modello dei progetti: identico al prototipo approvato
  let projects = $state<Record<string, ProjectData>>({
    'docs-site': {
      state: 'question',
      line: 'Keep the old /news address as a redirect?',
      msgs: [
        ['you', 'Move the changelog to its own page'],
        ['tool', 'Edit  src/pages/changelog.astro  +88'],
        ['tool', 'Edit  astro.config.mjs  +3']
      ],
      ask: {
        q: 'Keep the old /news address as a redirect to /changelog?',
        opts: ['Yes, redirect it', 'No, drop it'],
        rec: 0
      }
    },
    'mobile-app': {
      state: 'read',
      line: 'Dark mode now follows the system setting.',
      msgs: [
        ['you', 'Follow the system dark mode'],
        ['tool', 'Edit  app/theme/colors.ts  +31 -6'],
        ['agent', 'Done. Dark mode now follows the system setting; three screens updated and the toggle in Settings is gone.']
      ]
    },
    'billing-api': {
      state: 'working',
      line: 'Retry failed Stripe webhooks with backoff',
      msgs: [
        ['you', 'Retry failed Stripe webhooks with backoff'],
        ['tool', 'Read  src/webhooks/stripe.ts'],
        ['tool', 'Edit  src/webhooks/retry.ts  +24 -3']
      ],
      left: 9,
      result: 'Done. Failed webhooks retry five times with exponential backoff; 43 tests pass.'
    },
    'infra': {
      state: 'idle',
      line: 'Added the www record.',
      msgs: [
        ['you', 'Add the www record'],
        ['agent', 'Added in dns.tf. The plan shows one resource to create.']
      ]
    }
  });

  // Coda globale delle attivita da avviare
  let queue = $state<QueueTask[]>([
    { p: 'infra', t: 'Rotate the staging TLS certificate' }
  ]);

  // Stato dell'interfaccia utente
  let current = $state('docs-site');
  let frame = $state(0);
  const fresh = new SvelteSet<string>();

  let opened = $state(false);
  let visible = $state(false);
  let keysDown = $state(false);
  let k1 = $state('Alt');
  let reduced = $state(false);

  // Campi di input e stato delle note di cattura
  let capValue = $state('');
  let repValue = $state('');
  type CapNoteState =
    | { type: 'suggestions' }
    | { type: 'interpreting' }
    | { type: 'added'; target: string };
  let capNoteState = $state<CapNoteState>({ type: 'suggestions' });

  // Riferimenti ai nodi DOM principali
  let deskEl: HTMLElement | undefined = $state();
  let cpEl: HTMLElement | undefined = $state();
  let msgsEl: HTMLElement | undefined = $state();
  let railEl: HTMLElement | undefined = $state();
  let capInEl: HTMLInputElement | undefined = $state();
  let keysBtnEl: HTMLButtonElement | undefined = $state();

  // Istanza di ascii-reveal
  let reveal: AsciiRevealController | null = null;

  // Gestione timer con pulizia allo smontaggio per prevenire memory leak
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      activeTimeouts.delete(id);
      fn();
    }, ms);
    activeTimeouts.add(id);
    return id;
  }

  // Evidenziazione temporanea delle novita nella barra laterale
  function markFresh(name: string) {
    fresh.add(name);
    safeTimeout(() => {
      fresh.delete(name);
    }, 1600);
  }

  // Carattere spinner calcolato per l'indicatore di lavoro
  let spinChar = $derived(SPIN[frame % 4]);

  // Liste derivate per le quattro sezioni della barra laterale
  let questionProjects = $derived(Object.keys(projects).filter((n) => projects[n].state === 'question'));
  let readProjects = $derived(Object.keys(projects).filter((n) => projects[n].state === 'read'));
  let workingProjects = $derived(Object.keys(projects).filter((n) => projects[n].state === 'working'));
  let idleProjects = $derived(Object.keys(projects).filter((n) => projects[n].state === 'idle'));
  let currentProject = $derived(projects[current]);

  // Apertura e chiusura della finestra flottante Companion
  async function toggle() {
    opened = !opened;
    if (opened) {
      if (reveal && cpEl) {
        await reveal.hide({ within: cpEl, instant: true });
        reveal.reveal({ within: cpEl, origin: 'top-left' });
      }
      capInEl?.focus({ preventScroll: true });
    } else {
      keysBtnEl?.focus({ preventScroll: true });
    }
  }

  async function close() {
    if (!opened) return;
    await toggle();
  }

  // Selezione di un progetto dalla barra destra con animazione reveal
  async function selectProject(name: string) {
    if (name === current) return;
    if (!reduced && reveal && msgsEl) {
      await reveal.hide({ within: msgsEl, speed: 2 });
    }
    current = name;
    await tick();
    if (msgsEl) {
      msgsEl.scrollTop = msgsEl.scrollHeight;
      reveal?.reveal({ within: msgsEl, origin: 'top-left' });
    }
  }

  // Avvio di un task in coda: passa il progetto corrispondente allo stato working
  async function startQueueItem(index: number) {
    const [q] = queue.splice(index, 1);
    if (!q) return;
    const p = projects[q.p];
    if (!p) return;
    p.state = 'working';
    p.line = q.t;
    p.msgs = [['you', q.t]];
    p.left = 7;
    p.result = 'Done. The new certificate is live on staging and expires in 90 days.';
    await tick();
    if (current === q.p && msgsEl) {
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  // Ripresa del lavoro con messaggio dell'utente (risposta a domanda o chiarimento)
  async function resume(name: string, text: string) {
    const p = projects[name];
    if (!p) return;
    p.msgs.push(['you', text]);
    p.state = 'working';
    p.line = text;
    p.left = 5;
    if (!p.result) p.result = 'Done.';
    if (name === 'docs-site') {
      p.result = text.startsWith('Yes')
        ? 'Done. /news now redirects to /changelog with a 301.'
        : 'Done. /news is gone; the sitemap no longer lists it.';
    }
    await tick();
    if (msgsEl) {
      msgsEl.scrollTop = msgsEl.scrollHeight;
      if (msgsEl.lastElementChild) {
        reveal?.reveal({ within: msgsEl.lastElementChild });
      }
    }
  }

  // Invio della risposta nella conversazione
  async function sendReply() {
    const t = repValue.trim();
    if (!t) return;
    repValue = '';
    await resume(current, t);
  }

  // Inserimento rapido del suggerimento nel campo prompt
  function pickSuggestion(s: string) {
    capValue = s;
    capInEl?.focus();
  }

  // Cattura di una nuova richiesta in alto con instradamento su progetto via #tag
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  async function capture() {
    const raw = capValue.trim();
    if (!raw) return;
    capValue = '';
    const m = raw.match(/#([\w-]+)/);
    const name = m && projects[m[1]] ? m[1] : current;
    const text = raw.replace(/#[\w-]+\s*/, '').replace(/^./, (c) => c.toUpperCase());

    capNoteState = { type: 'interpreting' };
    await new Promise((r) => safeTimeout(r as () => void, reduced ? 50 : 900));

    queue.push({ p: name, t: text });
    markFresh(name);
    capNoteState = { type: 'added', target: name };

    await tick();
    const lastRow = railEl?.querySelector('.qrow:last-of-type') || railEl;
    if (lastRow) {
      reveal?.reveal({ within: lastRow });
    }

    if (hintTimer) {
      clearTimeout(hintTimer);
      activeTimeouts.delete(hintTimer);
    }
    hintTimer = safeTimeout(() => {
      capNoteState = { type: 'suggestions' };
    }, 2600);
  }

  // Inizializzazione di ascii-reveal al caricamento dei font
  $effect(() => {
    let destroyed = false;
    async function initReveal() {
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts.ready;
      }
      if (destroyed || !cpEl) return;
      reveal = createAsciiReveal(cpEl, {
        preset: 'decode',
        duration: 'fast',
        lazy: false
      });
    }

    initReveal();

    return () => {
      destroyed = true;
      reveal?.destroy();
      reveal = null;
    };
  });

  // Rilevamento piattaforma Mac e preferenze di accessibilita del browser
  $effect(() => {
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
      k1 = '⌥';
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = mq.matches;
      const onChange = (e: MediaQueryListEvent) => {
        reduced = e.matches;
      };
      mq.addEventListener('change', onChange);
      return () => {
        mq.removeEventListener('change', onChange);
      };
    }
  });

  // Osservatore di visibilita per mettere in pausa quando il componente e fuori schermo
  $effect(() => {
    if (!deskEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.3 }
    );
    observer.observe(deskEl);

    return () => {
      observer.disconnect();
    };
  });

  // Scorciatoia globale: Alt+Spazio (o Ctrl+Alt+Spazio) per attivare se visibile, Esc per chiudere
  $effect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.code === 'Space' || e.key === ' ') && e.altKey && visible) {
        e.preventDefault();
        keysDown = true;
        safeTimeout(() => {
          keysDown = false;
        }, 160);
        toggle();
      } else if (e.key === 'Escape' && opened) {
        close();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  // Ciclo unico di clock: requestAnimationFrame attivo solo a finestra aperta e visibile
  $effect(() => {
    let animId: number;
    let last = 0;

    function loop(now: number) {
      animId = requestAnimationFrame(loop);
      if (reduced || !opened || !visible) return;
      if (now - last < 140) return;
      last = now;
      frame++;

      // Ogni 10 frame (circa 1.4s) avanza il lavoro degli agenti attivi
      if (frame % 10 === 0) {
        for (const [name, p] of Object.entries(projects)) {
          if (p.state !== 'working') continue;
          if (p.left === undefined) p.left = 0;
          p.left--;
          if (p.left > 0) continue;

          // L'agente ha finito: il risultato va in To read senza alterare la conversazione aperta
          p.state = 'read';
          p.msgs.push(['agent', p.result || 'Done.']);
          p.line = (p.result || 'Done.').replace(/^Done\.\s*/, '');
          markFresh(name);

          // Se e il progetto attualmente visualizzato, aggiorna anche la vista centrale
          if (name === current) {
            tick().then(() => {
              if (msgsEl) {
                msgsEl.scrollTop = msgsEl.scrollHeight;
                if (msgsEl.lastElementChild) {
                  reveal?.reveal({ within: msgsEl.lastElementChild });
                }
              }
            });
          }
        }
      }
    }

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      for (const id of activeTimeouts) {
        clearTimeout(id);
      }
      activeTimeouts.clear();
    };
  });
</script>

<div class="desk" class:open={opened} bind:this={deskEl}>
  <div class="helper">
    <div>
      <button
        class="keys"
        class:down={keysDown}
        type="button"
        bind:this={keysBtnEl}
        aria-label="Open Companion"
        onclick={toggle}
      >
        <kbd>{k1}</kbd><span class="plus" aria-hidden="true">+</span><kbd>Space</kbd>
      </button>
      <p>Companion stays out of the way until you call it, from any app. Press the shortcut to bring it up.</p>
      <small>Or click the keys.</small>
    </div>
  </div>

  <div class="cp" bind:this={cpEl} role="dialog" aria-label="Companion">
    <div class="cap">
      <input
        bind:this={capInEl}
        bind:value={capValue}
        aria-label="Natural language task prompt"
        placeholder="What needs to be done?"
        onkeydown={(e) => {
          if (e.key === 'Enter') capture();
        }}
      />
      <button
        class="b p"
        type="button"
        disabled={!capValue.trim()}
        onclick={capture}
      >
        Add to queue
      </button>
      <button
        class="close"
        type="button"
        title="Hide (same shortcut)"
        onclick={close}
      >
        Hide
      </button>
    </div>

    <div class="capnote">
      {#if capNoteState.type === 'suggestions'}
        {#each SUGG as s}
          <button type="button" onclick={() => pickSuggestion(s)}>{s}</button>
        {/each}
      {:else if capNoteState.type === 'interpreting'}
        Interpreting with AI…
      {:else if capNoteState.type === 'added'}
        Task added to {capNoteState.target}
      {/if}
    </div>

    <div class="cols">
      <div class="conv">
        <div class="h">
          <b>{current}</b>
          <span>{STATE[currentProject?.state ?? 'idle']}</span>
        </div>

        <div class="msgs" bind:this={msgsEl} aria-live="polite">
          {#if currentProject}
            {#each currentProject.msgs as [k, t]}
              {#if k === 'you'}
                <div class="you">{t}</div>
              {:else if k === 'tool'}
                <div class="tool">· {t}</div>
              {:else}
                <div class="agent">{t}</div>
              {/if}
            {/each}

            {#if currentProject.state === 'question' && currentProject.ask}
              <div class="q">
                <p>{currentProject.ask.q}</p>
                {#each currentProject.ask.opts as opt, i}
                  <button class="opt" type="button" onclick={() => resume(current, opt)}>
                    <span>{opt}</span>
                    {#if i === currentProject.ask.rec}
                      <small>Recommended</small>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}

            {#if currentProject.state === 'working'}
              <div class="tool live" style="color:var(--ochre)">{spinChar} working</div>
            {/if}
          {/if}
        </div>

        <div class="reply">
          <input
            bind:value={repValue}
            aria-label="Reply to agent"
            placeholder="Proceed, provide clarification, or a / command…"
            onkeydown={(e) => {
              if (e.key === 'Enter') sendReply();
            }}
          />
          <button
            class="b"
            type="button"
            disabled={!repValue.trim()}
            onclick={sendReply}
          >
            Reply
          </button>
        </div>

        <div class="scope">In conversation, not in queue</div>
      </div>

      <nav class="rail" bind:this={railEl} aria-label="Projects">
        <!-- Sezione Questions -->
        <div class="sec">
          <div class="t">
            <span>Questions</span>
            <span>{questionProjects.length || ''}</span>
          </div>
          {#if questionProjects.length > 0}
            {#each questionProjects as name (name)}
              <button
                class="it"
                class:new={fresh.has(name)}
                type="button"
                aria-current={name === current ? 'true' : undefined}
                onclick={() => selectProject(name)}
              >
                <span class="p">
                  <span class="mark q" aria-hidden="true">?</span>
                  {name}
                </span>
                <span class="s">{projects[name].line}</span>
              </button>
            {/each}
          {:else}
            <div class="empty">Nothing here</div>
          {/if}
        </div>

        <!-- Sezione To read -->
        <div class="sec">
          <div class="t">
            <span>To read</span>
            <span>{readProjects.length || ''}</span>
          </div>
          {#if readProjects.length > 0}
            {#each readProjects as name (name)}
              <button
                class="it"
                class:new={fresh.has(name)}
                type="button"
                aria-current={name === current ? 'true' : undefined}
                onclick={() => selectProject(name)}
              >
                <span class="p">
                  <span class="mark r" aria-hidden="true">●</span>
                  {name}
                </span>
                <span class="s">{projects[name].line}</span>
              </button>
            {/each}
          {:else}
            <div class="empty">Nothing here</div>
          {/if}
        </div>

        <!-- Sezione Working -->
        <div class="sec">
          <div class="t">
            <span>Working</span>
            <span>{workingProjects.length || ''}</span>
          </div>
          {#if workingProjects.length > 0}
            {#each workingProjects as name (name)}
              <button
                class="it"
                class:new={fresh.has(name)}
                type="button"
                aria-current={name === current ? 'true' : undefined}
                onclick={() => selectProject(name)}
              >
                <span class="p">
                  <span class="mark w" aria-hidden="true">{spinChar}</span>
                  {name}
                </span>
                <span class="s">{projects[name].line}</span>
              </button>
            {/each}
          {:else}
            <div class="empty">Nothing here</div>
          {/if}
        </div>

        <!-- Sezione Global queue -->
        <div class="sec">
          <div class="t">
            <span>Global queue</span>
            <span>{queue.length || ''}</span>
          </div>
          {#if queue.length > 0}
            {#each queue as item, i (i + '-' + item.p + '-' + item.t)}
              {@const isBusy = projects[item.p]?.state === 'working' || projects[item.p]?.state === 'question'}
              <div class="qrow">
                <span class="s">
                  <b>{item.p}</b>
                  {item.t}
                </span>
                <button
                  class="mini"
                  type="button"
                  disabled={isBusy}
                  title={isBusy ? 'Agent already working' : undefined}
                  onclick={() => startQueueItem(i)}
                >
                  Start
                </button>
              </div>
            {/each}
          {:else}
            <div class="empty">No tasks in queue</div>
          {/if}
        </div>

        <!-- Sezione Idle -->
        <div class="sec">
          <div class="t">
            <span>Idle</span>
            <span>{idleProjects.length || ''}</span>
          </div>
          {#if idleProjects.length > 0}
            {#each idleProjects as name (name)}
              <button
                class="it"
                class:new={fresh.has(name)}
                type="button"
                aria-current={name === current ? 'true' : undefined}
                onclick={() => selectProject(name)}
              >
                <span class="p">
                  <span class="mark i" aria-hidden="true">·</span>
                  {name}
                </span>
                <span class="s">{projects[name].line}</span>
              </button>
            {/each}
          {:else}
            <div class="empty">Nothing here</div>
          {/if}
        </div>
      </nav>
    </div>
  </div>
</div>

<style>
  .desk {
    position: relative;
    min-height: 540px;
    border: 1px dashed var(--line);
    border-radius: 2px;
    background: repeating-linear-gradient(0deg, transparent 0 23px, rgb(242 240 234 / 0.025) 23px 24px);
    container-type: inline-size;
  }

  .helper {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 24px;
  }

  .helper p {
    font: 400 15px/1.5 var(--sans);
    color: var(--slate);
    max-width: 34ch;
    margin: 14px auto 0;
  }

  .keys {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    padding: 6px;
    border-radius: 4px;
  }

  .keys:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: 4px;
  }

  .keys kbd {
    font: 600 15px/1 var(--mono);
    color: var(--stone);
    background: #1d1d1a;
    border: 1px solid var(--line-strong);
    border-bottom-width: 3px;
    border-radius: 5px;
    padding: 10px 14px;
    min-width: 20px;
    transition: translate 0.12s, border-bottom-width 0.12s, color 0.2s, border-color 0.2s;
  }

  .keys .plus {
    color: var(--faint);
  }

  .keys:hover kbd {
    border-color: var(--ochre);
    color: var(--ochre);
  }

  .keys.down kbd {
    translate: 0 2px;
    border-bottom-width: 1px;
    border-color: var(--ochre);
    color: var(--ochre);
  }

  .helper small {
    display: block;
    margin-top: 10px;
    font: 400 12px var(--mono);
    color: var(--faint);
  }

  .cp {
    position: absolute;
    inset: 14px;
    opacity: 0;
    transform: translateY(10px) scale(0.985);
    pointer-events: none;
    transition: opacity 0.35s var(--ease), transform 0.45s var(--ease);
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.55);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--ground-2);
    font: 400 12.5px/1.6 var(--mono);
    overflow: hidden;
  }

  .desk.open .cp {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }

  .desk.open .helper {
    visibility: hidden;
  }

  .close {
    all: unset;
    cursor: pointer;
    color: var(--faint);
    padding: 2px 8px;
    font: 500 12px var(--mono);
    border: 1px solid var(--line);
    border-radius: 3px;
    white-space: nowrap;
  }

  .close:hover {
    color: var(--stone);
  }

  .close:focus-visible {
    outline: 2px solid var(--ochre);
  }

  .cap {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
  }

  .cap input {
    flex: 1;
    min-width: 0;
    font: 400 13.5px var(--sans);
    background: var(--ground);
    color: var(--stone);
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    padding: 7px 9px;
  }

  .cap input:focus {
    outline: none;
    border-color: var(--ochre);
  }

  .cap input::placeholder {
    color: var(--faint);
  }

  .b {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    font: 600 11.5px/1 var(--mono);
    padding: 7px 9px;
    border-radius: 2px;
    border: 1px solid var(--ochre);
    color: var(--ochre);
    white-space: nowrap;
    transition: background 0.2s, color 0.2s;
  }

  .b.p {
    background: var(--ochre);
    color: var(--on-ochre);
  }

  .b:hover {
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
    background: transparent;
    color: var(--ochre);
  }

  .b.p:disabled {
    opacity: 0.35;
    cursor: default;
    background: var(--ochre);
    color: var(--on-ochre);
  }

  .capnote {
    padding: 0 10px 6px;
    font-size: 11px;
    color: var(--faint);
    min-height: 18px;
    border-bottom: 1px solid var(--line);
  }

  .capnote button {
    all: unset;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    margin-right: 10px;
  }

  .capnote button:hover {
    color: var(--stone);
  }

  .capnote button:focus-visible {
    outline: 1px solid var(--ochre);
    outline-offset: 2px;
  }

  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 210px;
  }

  .conv {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid var(--line);
  }

  .conv .h {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    color: var(--faint);
    font-size: 11px;
  }

  .conv .h b {
    font-weight: 500;
    color: var(--stone);
  }

  .msgs {
    flex: 1;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    max-height: 300px;
    scrollbar-width: thin;
    scrollbar-color: rgb(242 240 234 / 0.2) transparent;
  }

  .you {
    align-self: flex-end;
    max-width: 90%;
    background: rgb(242 240 234 / 0.06);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 6px 9px;
    font: 400 13px/1.45 var(--sans);
  }

  .agent {
    font: 400 13.5px/1.5 var(--sans);
    color: var(--stone);
  }

  .tool {
    color: var(--faint);
    font-size: 11.5px;
  }

  .q {
    border: 1px solid var(--ochre);
    border-radius: 3px;
    padding: 9px;
  }

  .q p {
    font: 400 13.5px/1.45 var(--sans);
    margin-bottom: 8px;
  }

  .opt {
    all: unset;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    margin-top: 4px;
    border: 1px solid var(--line);
    border-radius: 3px;
    font: 400 13px var(--sans);
    color: var(--stone);
  }

  .opt:hover {
    border-color: var(--ochre);
  }

  .opt:focus-visible {
    outline: 2px solid var(--ochre);
  }

  .opt small {
    font: 500 10.5px var(--mono);
    color: var(--ochre);
  }

  .reply {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--line);
  }

  .reply input {
    flex: 1;
    min-width: 0;
    font: 400 13px var(--sans);
    background: var(--ground);
    color: var(--stone);
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    padding: 6px 8px;
  }

  .reply input:focus {
    outline: none;
    border-color: var(--ochre);
  }

  .reply input::placeholder {
    color: var(--faint);
  }

  .scope {
    padding: 0 12px 8px;
    color: var(--faint);
    font-size: 11px;
  }

  .rail {
    padding: 8px 0;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: rgb(242 240 234 / 0.2) transparent;
  }

  .sec {
    padding: 4px 10px 6px;
  }

  .sec .t {
    font-size: 10.5px;
    color: var(--faint);
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .it {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: block;
    width: 100%;
    padding: 5px 7px;
    border-radius: 3px;
    border: 1px solid transparent;
    transition: background 0.2s, border-color 0.2s;
  }

  .it:hover {
    background: rgb(242 240 234 / 0.05);
  }

  .it:focus-visible {
    outline: 2px solid var(--ochre);
    outline-offset: -2px;
  }

  .it[aria-current='true'] {
    border-color: var(--line-strong);
    background: rgb(242 240 234 / 0.07);
  }

  .it .p {
    color: var(--stone);
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .it .s {
    font: 400 12px/1.35 var(--sans);
    color: var(--slate);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .mark {
    width: 1ch;
    text-align: center;
  }

  .mark.q {
    color: var(--on-ochre);
    background: var(--ochre);
    border-radius: 1px;
    font-weight: 700;
    padding: 0;
    border: 0;
  }

  .mark.w {
    color: var(--ochre);
  }

  .mark.r {
    color: #8fb7e0;
  }

  .mark.i {
    color: var(--faint);
  }

  .new {
    animation: arrive 1.6s var(--ease);
  }

  @keyframes arrive {
    0% {
      background: rgb(227 192 106 / 0.25);
    }
    100% {
      background: transparent;
    }
  }

  .qrow {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 4px 7px;
  }

  .qrow .s {
    flex: 1;
    font: 400 12px/1.35 var(--sans);
    color: var(--slate);
  }

  .qrow .s b {
    font: 500 11px var(--mono);
    color: var(--stone);
    display: block;
  }

  .mini {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    font: 600 10.5px/1 var(--mono);
    padding: 4px 6px;
    border: 1px solid rgb(227 192 106 / 0.5);
    border-radius: 2px;
    color: var(--ochre);
  }

  .mini:hover {
    background: var(--ochre);
    color: var(--on-ochre);
  }

  .mini:focus-visible {
    outline: 2px solid var(--ochre);
  }

  .mini:disabled {
    opacity: 0.35;
    cursor: default;
    background: transparent;
    color: var(--ochre);
  }

  .empty {
    color: var(--faint);
    font: 400 12px var(--sans);
    padding: 2px 7px;
  }

  @container (max-width: 560px) {
    .cols {
      grid-template-columns: 1fr;
    }
    .conv {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }
</style>
