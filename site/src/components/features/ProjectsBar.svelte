<script lang="ts">
	import { tick } from 'svelte';
	import { createAsciiReveal } from 'ascii-reveal/core';

	// Tipi per i progetti e le sessioni simulate
	interface Ask {
		q: string;
		a: string[];
	}

	interface Project {
		id: string;
		state: 'working' | 'waiting' | 'idle';
		queue: number;
		tree: string[];
		code: string[];
		chat: [string, string][];
		working: string[];
		ask: Ask | null;
		step?: number;
		asked?: boolean;
	}

	// Quattro progetti con stato, coda e sessione propri, identici al prototipo
	const INITIAL_PROJECTS: Project[] = [
		{
			id: 'billing-api',
			state: 'working',
			queue: 2,
			tree: ['src/', '  webhooks/', '    stripe.ts', '*   retry.ts', '  server.ts', 'tests/', '  retry.test.ts'],
			code: [
				'export async function retry(',
				'  job: Job, attempt = 0',
				') {',
				'  const wait = 2 ** attempt * 500;',
				'  await sleep(wait);',
				'  return send(job);',
				'}'
			],
			chat: [
				['you', 'Retry failed Stripe webhooks with backoff'],
				['tool', 'Read  src/webhooks/stripe.ts'],
				['tool', 'Edit  src/webhooks/retry.ts  +24 -3'],
				['tool', 'Run   npm test']
			],
			working: ['41 passed', 'Edit  tests/retry.test.ts  +18', 'Run   npm test', '43 passed'],
			ask: {
				q: 'Five retries max, or keep going until the job expires?',
				a: ['Five max', 'Until it expires']
			}
		},
		{
			id: 'docs-site',
			state: 'waiting',
			queue: 0,
			tree: ['src/', '  pages/', '    index.astro', '*   changelog.astro', 'astro.config.mjs'],
			code: ['export default defineConfig({', '  redirects: {', "    '/news': '/changelog',", '  },', '});'],
			chat: [
				['you', 'Move the changelog to its own page'],
				['tool', 'Edit  src/pages/changelog.astro  +88'],
				['tool', 'Edit  astro.config.mjs  +3']
			],
			working: ['Build  12 pages', 'Done'],
			ask: {
				q: 'Keep the old /news address as a redirect?',
				a: ['Yes, redirect', 'No, drop it']
			},
			asked: true
		},
		{
			id: 'mobile-app',
			state: 'idle',
			queue: 1,
			tree: ['app/', '  theme/', '*   colors.ts', '  screens/', '    Settings.tsx'],
			code: ['const scheme = useColorScheme();', 'export const colors =', "  scheme === 'dark'", '    ? dark : light;'],
			chat: [
				['you', 'Follow the system dark mode'],
				['tool', 'Edit  app/theme/colors.ts  +31 -6'],
				['say', 'Done. Dark mode now follows the system setting; three screens updated.']
			],
			working: [],
			ask: null
		},
		{
			id: 'infra',
			state: 'idle',
			queue: 0,
			tree: ['terraform/', '  main.tf', '  dns.tf', 'README.md'],
			code: ['resource "aws_route53_record" "www" {', '  name = "www"', '  type = "CNAME"', '}'],
			chat: [['you', 'Add the www record'], ['say', 'Added in dns.tf. Plan shows one resource to create.']],
			working: [],
			ask: null
		}
	];

	const SPIN = ['-', '\\', '|', '/'] as const;
	const label = {
		working: 'agent working',
		waiting: 'agent waiting for you',
		idle: 'agent idle'
	} as const;

	// Stato reattivo principale Svelte 5
	let projects = $state<Project[]>(INITIAL_PROJECTS);
	let active = $state(0);
	let renderedActive = $state(0);
	let frame = $state(0);
	const spinChar = $derived(SPIN[frame % 4]);

	// Progetto correntemente visualizzato nelle colonne
	const currentProject = $derived(projects[renderedActive]);
	const activeTreeFile = $derived.by(() => {
		const p = projects[renderedActive];
		return p.tree.find((l) => l.startsWith('*'))?.slice(1).trim() || p.tree[p.tree.length - 1].trim();
	});

	// Riferimenti agli elementi DOM
	let rootEl: HTMLElement | undefined = $state();
	let colsEl: HTMLElement | undefined = $state();
	let chatEl: HTMLElement | undefined = $state();
	let tileButtons: HTMLButtonElement[] = $state([]);

	// Istanza controller ascii-reveal
	let reveal: ReturnType<typeof createAsciiReveal> | null = null;
	let switching = false;

	// Gestione selezione progetto con transizione di decodifica
	async function select(i: number) {
		if (i === active || switching) return;
		switching = true;
		active = i;
		tileButtons[i]?.focus();

		// Se ridotto non nasconde con l'effetto ascii, ma aggiorna direttamente
		if (!reduced && reveal && colsEl) {
			await reveal.hide({ within: colsEl, speed: 2 });
		}

		renderedActive = i;
		await tick();

		if (reveal && colsEl) {
			await reveal.reveal({ within: colsEl, origin: 'top-left' });
		}
		switching = false;
	}

	// Navigazione tastiera tra i tile della toolbar (frecce destra/sinistra)
	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		const next = (active + (e.key === 'ArrowRight' ? 1 : projects.length - 1)) % projects.length;
		select(next);
	}

	// Rispondere alla domanda rimette l'agente al lavoro
	async function handleAnswer(answer: string) {
		const p = projects[renderedActive];
		p.chat.push(['you', answer]);
		p.state = 'working';
		p.step = 0;
		p.asked = true;
		await tick();
		if (chatEl?.lastElementChild && reveal) {
			reveal.reveal({ within: chatEl.lastElementChild });
		}
	}

	// Variabili di controllo per il ciclo temporale unico
	let animId: number | null = null;
	let last = 0;
	let isVisible = false;
	let reduced = false;

	// Passo del clock: ogni 140 ms avanza il frame; ogni 18 tick (~2,5 s) un passo dell'agente
	async function tickClock() {
		frame++;

		if (frame % 18 !== 0) return;

		let activeNeedsReveal = false;
		for (const [i, p] of projects.entries()) {
			if (p.state !== 'working') continue;
			p.step = p.step || 0;
			if (p.step < p.working.length) {
				const nextStep = p.working[p.step];
				p.chat.push([nextStep.startsWith('Done') ? 'say' : 'tool', nextStep]);
				p.step++;
			} else if (p.ask && !p.asked) {
				p.state = 'waiting';
				p.asked = true;
			} else {
				p.state = 'idle';
				if (p.queue) {
					p.queue--;
				}
			}
			if (i === renderedActive) {
				activeNeedsReveal = true;
			}
		}

		// Un progetto fermo con task in coda riparte da solo ogni 54 tick (~7,5 s)
		const idle = projects.find((p, i) => p.state === 'idle' && p.queue && i !== renderedActive);
		if (idle && frame % 54 === 0) {
			idle.queue--;
			idle.state = 'working';
			idle.step = 0;
			idle.chat = [['you', 'Next task from the queue']];
			idle.working = ['Read  app/screens/Settings.tsx', 'Edit  app/screens/Settings.tsx  +9', 'Done'];
		}

		if (activeNeedsReveal && !switching) {
			await tick();
			if (chatEl?.lastElementChild && reveal && !switching) {
				reveal.reveal({ within: chatEl.lastElementChild });
			}
		}
	}

	function loop(now: number) {
		animId = requestAnimationFrame(loop);
		if (reduced || !isVisible || now - last < 140) return;
		last = now;
		tickClock();
	}

	function startLoop() {
		if (animId !== null || reduced || !isVisible) return;
		last = performance.now();
		animId = requestAnimationFrame(loop);
	}

	function stopLoop() {
		if (animId !== null) {
			cancelAnimationFrame(animId);
			animId = null;
		}
	}

	// Montaggio ed effetti: fonts, ascii-reveal, observer e animazione
	$effect(() => {
		if (typeof window === 'undefined') return;

		let disposed = false;
		let revealInstance: ReturnType<typeof createAsciiReveal> | null = null;

		// Rispetto impostazione prefers-reduced-motion
		const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = reducedMotionMedia.matches;

		const onMotionChange = (e: MediaQueryListEvent) => {
			reduced = e.matches;
			if (reduced) {
				stopLoop();
			} else if (isVisible) {
				startLoop();
			}
		};
		reducedMotionMedia.addEventListener('change', onMotionChange);

		// IntersectionObserver mette in pausa il ciclo quando il componente e' fuori schermo
		const observer = new IntersectionObserver(
			([entry]) => {
				isVisible = entry?.isIntersecting ?? false;
				if (isVisible && !reduced) {
					startLoop();
				} else {
					stopLoop();
				}
			},
			{ threshold: 0.05 }
		);

		if (rootEl) {
			observer.observe(rootEl);
		}

		// Inizializzazione ascii-reveal al completamento dei font
		(async () => {
			try {
				if (typeof document !== 'undefined' && document.fonts) {
					await document.fonts.ready;
				}
				if (disposed || !colsEl) return;
				revealInstance = createAsciiReveal(colsEl, {
					preset: 'decode',
					duration: 'fast',
					lazy: false
				});
				reveal = revealInstance;
				await tick();
				if (!disposed) {
					await revealInstance.reveal({ origin: 'top-left' });
				}
			} catch {
				// Ignora se smontato prima della conclusione
			}
		})();

		return () => {
			disposed = true;
			stopLoop();
			observer.disconnect();
			reducedMotionMedia.removeEventListener('change', onMotionChange);
			revealInstance?.destroy();
			reveal = null;
		};
	});
</script>

<div class="pb" bind:this={rootEl}>
	<div class="bar" role="toolbar" aria-label="Projects" tabindex="-1" onkeydown={handleKeydown}>
		{#each projects as p, i}
			<button
				class="tile"
				type="button"
				aria-pressed={i === active}
				aria-label="{p.id}, {label[p.state]}{p.queue ? ', ' + p.queue + ' queued' : ''}"
				data-i={i}
				bind:this={tileButtons[i]}
				onclick={() => select(i)}
			>
				{#if p.state === 'working'}
					<span class="st working" aria-hidden="true">{spinChar}</span>
				{:else if p.state === 'waiting'}
					<span class="st waiting" aria-hidden="true">?</span>
				{:else}
					<span class="st" aria-hidden="true">·</span>
				{/if}
				<span>{p.id}</span>
				{#if p.queue}
					<span class="q" aria-hidden="true">{p.queue}</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="cols" bind:this={colsEl} aria-live="polite">
		<div class="col tree">
			<div class="head">Files</div>
			{#each currentProject.tree as line}
				{#if line.startsWith('*')}
					<div class="mod">{line.slice(1).padStart(line.length - 1)}</div>
				{:else}
					<div class:dir={line.trim().endsWith('/')}>{line}</div>
				{/if}
			{/each}
		</div>

		<div class="col code">
			<div class="head">{activeTreeFile}</div>
			{#each currentProject.code as line, i}
				<div><span class="ln">{i + 1}</span>{line}</div>
			{/each}
		</div>

		<div class="col chat" bind:this={chatEl}>
			<div class="head">Agent</div>
			{#each currentProject.chat as [kind, text]}
				{#if kind === 'you'}
					<div class="you">&gt; {text}</div>
				{:else if kind === 'tool'}
					<div class="tool">{'  '}{text}</div>
				{:else}
					<div class="say">{text}</div>
				{/if}
			{/each}
			{#if currentProject.state === 'working'}
				<div class="tool live">{'  '}{spinChar} working</div>
			{/if}
			{#if currentProject.state === 'waiting' && currentProject.ask}
				<div class="ask">
					<p>{currentProject.ask.q}</p>
					{#each currentProject.ask.a as answer}
						<button type="button" onclick={() => handleAnswer(answer)}>{answer}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.pb {
		container-type: inline-size;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--ground-2);
		font: 400 12.5px/1.6 var(--mono);
		overflow: hidden;
	}
	.bar {
		display: flex;
		gap: 2px;
		padding: 6px;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
	}
	.tile {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 2px;
		color: var(--slate);
		white-space: nowrap;
		position: relative;
		transition:
			color 0.2s,
			background 0.2s;
	}
	.tile:hover {
		color: var(--stone);
		background: rgb(242 240 234 / 0.04);
	}
	.tile[aria-pressed='true'] {
		color: var(--stone);
		background: rgb(242 240 234 / 0.07);
	}
	.tile[aria-pressed='true']::after {
		content: '';
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 0;
		height: 1px;
		background: var(--ochre);
	}
	.tile:focus-visible {
		outline-offset: -2px;
	}
	.st {
		width: 1ch;
		text-align: center;
		color: var(--faint);
	}
	.st.working {
		color: var(--ochre);
	}
	.st.waiting {
		color: var(--on-ochre);
		background: var(--ochre);
		border-radius: 1px;
		font-weight: 700;
		animation: call 1.4s var(--ease) infinite;
	}
	@keyframes call {
		50% {
			opacity: 0.45;
		}
	}
	.q {
		font-size: 11px;
		color: var(--faint);
		border: 1px solid var(--line);
		padding: 0 5px;
		border-radius: 2px;
	}
	.cols {
		display: grid;
		grid-template-columns: 150px 1fr 1.25fr;
		min-height: 262px;
	}
	.col {
		padding: 12px 14px;
		border-right: 1px solid var(--line);
		min-width: 0;
	}
	.col:last-child {
		border-right: 0;
	}
	.head {
		font-size: 11px;
		color: var(--faint);
		margin-bottom: 8px;
	}
	.tree div,
	.code div {
		white-space: pre;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tree .dir {
		color: var(--slate);
	}
	.tree .mod {
		color: var(--ochre);
	}
	.code {
		color: var(--slate);
	}
	.code :global(.k) {
		color: var(--stone);
	}
	.ln {
		color: var(--faint);
		display: inline-block;
		width: 2.5ch;
	}
	.chat div {
		white-space: pre-wrap;
	}
	.chat .you {
		color: var(--stone);
	}
	.chat .tool {
		color: var(--faint);
	}
	.chat .tool :global(b) {
		font-weight: 400;
		color: var(--slate);
	}
	.chat .say {
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.45;
		color: var(--stone);
		margin-top: 6px;
	}
	.ask {
		margin-top: 10px;
		border: 1px solid var(--ochre);
		padding: 10px;
		border-radius: 2px;
	}
	.ask p {
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.45;
		margin-bottom: 8px;
	}
	.ask button {
		font: 600 12px/1 var(--mono);
		border: 1px solid var(--ochre);
		background: var(--ochre);
		color: var(--on-ochre);
		padding: 7px 10px;
		border-radius: 2px;
		cursor: pointer;
		margin-right: 6px;
		transition: translate 0.25s var(--ease);
	}
	.ask button + button {
		background: transparent;
		color: var(--ochre);
	}
	.ask button:hover {
		translate: 0 -1px;
	}
	.live {
		color: var(--ochre);
	}
	@container (max-width: 620px) {
		.cols {
			grid-template-columns: 1fr 1.3fr;
		}
		.col.code {
			display: none;
		}
	}
	@media (max-width: 760px) {
		.cols {
			grid-template-columns: 1fr 1.3fr;
		}
		.col.code {
			display: none;
		}
	}
</style>
