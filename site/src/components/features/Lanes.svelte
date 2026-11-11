<script lang="ts">
	import { tick } from 'svelte';
	import { createAsciiReveal, type AsciiRevealController } from 'ascii-reveal/core';

	// Definizione degli obiettivi di lavoro assegnabili a una corsia
	interface GoalDef {
		id: string;
		goal: string;
		steps: string[];
		done: string;
		files: [string, string, number, number][];
		commit: string;
	}

	// Stato runtime di una corsia con il suo worktree e log
	interface Lane extends GoalDef {
		state: 'working' | 'ready';
		log: string[];
		step: number;
		landed: boolean;
	}

	const GOALS: GoalDef[] = [
		{
			id: 'deps',
			goal: 'Upgrade dependencies',
			steps: [
				'Read  package.json',
				'Run   npm outdated  7 packages',
				'Edit  package.json  +7 -7',
				'Run   npm install',
				'Run   npm test  128 passed'
			],
			done: 'Done. Seven packages upgraded, tests green.',
			files: [
				['M', 'package.json', 7, 7],
				['M', 'package-lock.json', 412, 380]
			],
			commit: 'Upgrade dependencies'
		},
		{
			id: 'inv',
			goal: 'Write tests for invoices',
			steps: [
				'Read  src/billing/invoice.ts',
				'Edit  tests/invoice.test.ts  +96',
				'Run   npm test  12 new, all passed'
			],
			done: 'Done. Totals, taxes and rounding are covered.',
			files: [['A', 'tests/invoice.test.ts', 96, 0]],
			commit: 'Write tests for invoices'
		},
		{
			id: 'login',
			goal: 'Fix the flaky login test',
			steps: [
				'Read  tests/login.test.ts',
				'Run   npm test -- login  x20  3 failed',
				'Edit  tests/login.test.ts  +4 -1',
				'Run   npm test -- login  x20  all passed'
			],
			done: 'Done. The test now waits for the session cookie.',
			files: [['M', 'tests/login.test.ts', 4, 1]],
			commit: 'Fix the flaky login test'
		}
	];

	const MAX = 2;
	const YOURS = ['src/editor/toolbar.ts', 'src/editor/shortcuts.ts'];
	const LINE = "groups.push({ id: 'format', items })";
	const SPIN = ['-', '\\', '|', '/'];

	// Stato reattivo con le rune di Svelte 5
	let lanes = $state<Lane[]>([]);
	let history = $state<string[]>(['Group toolbar buttons', 'Fix tooltip delay']);
	let view = $state<string>('main');
	let reviewing = $state<Lane | null>(null);
	let landedNote = $state<boolean>(false);
	let frame = $state<number>(0);
	let typed = $state<number>(0);
	let commitInput = $state<string>('');
	let reduced = $state<boolean>(false);
	let swapping = $state<boolean>(false);

	// Riferimenti DOM per ascii-reveal e aggiornamenti mirati
	let rootEl = $state<HTMLElement | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let laneColEl = $state<HTMLElement | null>(null);

	let reveal: AsciiRevealController | null = null;

	// Corsie non ancora integrate nel branch principale
	const openLanes = $derived(lanes.filter((l) => !l.landed));
	// Corsia attualmente visualizzata nella colonna di destra
	const activeLane = $derived(openLanes.find((l) => l.id === view));
	// Ultimi tre commit su main in ordine cronologico inverso
	const latestCommits = $derived(history.slice(-3).reverse());

	// Transizione del corpo con ascii-reveal: nasconde, aggiorna lo stato, rivela
	async function swap(fn: () => void) {
		if (swapping) return;
		swapping = true;
		try {
			if (!reduced && reveal && bodyEl) {
				await reveal.hide({ within: bodyEl, speed: 2 });
			}
			fn();
			await tick();
			if (!reduced && reveal && bodyEl) {
				reveal.reveal({ within: bodyEl, origin: 'top-left' });
			}
		} finally {
			swapping = false;
		}
	}

	// Selezione della scheda nella barra superiore
	function selectTab(v: string) {
		if (v === view && !reviewing) return;
		swap(() => {
			reviewing = null;
			view = v;
		});
	}

	// Apertura del pannello di revisione prima dell'integrazione
	function startIntegrate(l: Lane) {
		swap(() => {
			reviewing = l;
			commitInput = l.commit;
			view = l.id;
		});
	}

	// Ritorno alla corsia senza applicare l'integrazione
	function returnToLane() {
		swap(() => {
			reviewing = null;
		});
	}

	// Applicazione delle modifiche della corsia su main con un unico commit squash
	function integrateIntoMain() {
		if (!reviewing) return;
		const l = reviewing;
		const msg = commitInput.trim() || l.commit;
		swap(() => {
			l.landed = true;
			history.push(msg);
			landedNote = true;
			reviewing = null;
			view = 'main';
		});
	}

	// Avvio di una nuova corsia nel suo worktree isolato
	async function startLane(def: GoalDef) {
		if (lanes.some((l) => l.id === def.id) || openLanes.length >= MAX) return;

		if (reduced) {
			// Se il movimento e ridotto mostriamo i passaggi gia completati
			lanes.push({
				...def,
				state: 'ready',
				log: [...def.steps],
				step: def.steps.length,
				landed: false
			});
		} else {
			lanes.push({
				...def,
				state: 'working',
				log: [],
				step: 0,
				landed: false
			});
		}

		view = def.id;
		landedNote = false;
		reviewing = null;

		await tick();
		if (!reduced && reveal && laneColEl) {
			reveal.reveal({ within: laneColEl, origin: 'top-left' });
		}
	}

	// Navigazione accessibile tra le schede con le frecce della tastiera
	function handleToolbarKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const tabIds = ['main', ...openLanes.map((l) => l.id)];
		const currentIndex = tabIds.indexOf(view);
		if (currentIndex === -1) return;
		e.preventDefault();
		const nextIndex =
			e.key === 'ArrowRight'
				? (currentIndex + 1) % tabIds.length
				: (currentIndex - 1 + tabIds.length) % tabIds.length;
		const nextId = tabIds[nextIndex];
		selectTab(nextId);
		tick().then(() => {
			const btn = rootEl?.querySelector<HTMLButtonElement>(`button[data-v="${nextId}"]`);
			btn?.focus();
		});
	}

	// Scorciatoie tastiera per la revisione: Invio conferma, Esc torna indietro
	function handleCommitKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			integrateIntoMain();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			returnToLane();
		}
	}

	// Inizializzazione di ascii-reveal una volta caricati i font di sistema
	$effect(() => {
		if (!rootEl) return;
		let active = true;

		async function initReveal() {
			await document.fonts.ready;
			if (!active || !rootEl) return;
			reveal = createAsciiReveal(rootEl, {
				preset: 'decode',
				duration: 'fast',
				lazy: false
			});
			reveal.reveal({ origin: 'top-left' });
		}

		initReveal();

		return () => {
			active = false;
			reveal?.destroy();
			reveal = null;
		};
	});

	// Ciclo unico di animazione sincrono a 140ms; si sospende quando il widget e fuori schermo
	$effect(() => {
		if (!rootEl) return;

		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mql.matches;
		if (reduced) {
			typed = LINE.length;
		}

		const handleMotionChange = (e: MediaQueryListEvent) => {
			reduced = e.matches;
			if (reduced) {
				typed = LINE.length;
				if (rafId) {
					cancelAnimationFrame(rafId);
					rafId = null;
				}
			} else if (isVisible && !rafId) {
				last = performance.now();
				rafId = requestAnimationFrame(loop);
			}
		};
		mql.addEventListener('change', handleMotionChange);

		let isVisible = true;
		let rafId: number | null = null;
		let last = 0;

		function loop(now: number) {
			if (!isVisible) {
				rafId = null;
				return;
			}
			rafId = requestAnimationFrame(loop);
			if (reduced || now - last < 140) return;
			last = now;
			frame++;

			// Animazione di digitazione nel pannello Main ogni 3 frame (~420ms)
			if (frame % 3 === 0) {
				typed = (typed + 1) % (LINE.length + 10);
			}

			// Avanzamento delle corsie attive ogni 16 frame (~2.2s)
			if (frame % 16 === 0) {
				let activeUpdated = false;
				for (const l of lanes) {
					if (l.landed || l.state !== 'working') continue;
					if (l.step < l.steps.length) {
						l.log.push(l.steps[l.step++]);
					} else {
						l.state = 'ready';
					}
					if (view === l.id && !reviewing) {
						activeUpdated = true;
					}
				}
				if (activeUpdated) {
					tick().then(() => {
						if (!reduced && reveal && laneColEl?.lastElementChild) {
							reveal.reveal({ within: laneColEl.lastElementChild as HTMLElement });
						}
					});
				}
			}
		}

		// Osservatore di visibilita per mettere in pausa il loop quando il widget non e visibile
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					isVisible = entry.isIntersecting;
					if (isVisible && !reduced && !rafId) {
						last = performance.now();
						rafId = requestAnimationFrame(loop);
					}
				}
			},
			{ threshold: 0.1 }
		);

		observer.observe(rootEl);

		if (!reduced) {
			rafId = requestAnimationFrame(loop);
		}

		return () => {
			mql.removeEventListener('change', handleMotionChange);
			observer.disconnect();
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		};
	});
</script>

<div class="ln" bind:this={rootEl}>
	<div
		class="row"
		role="toolbar"
		aria-label="Lanes"
		onkeydown={handleToolbarKeydown}
	>
		<button
			class="tab"
			type="button"
			data-v="main"
			aria-pressed={view === 'main'}
			onclick={() => selectTab('main')}
		>
			Main
		</button>
		{#each openLanes as l (l.id)}
			<button
				class="tab"
				type="button"
				data-v={l.id}
				aria-pressed={view === l.id}
				aria-label="Lane: {l.goal}, {l.state === 'working' ? 'working' : 'ready'}"
				onclick={() => selectTab(l.id)}
			>
				{#if l.state === 'working'}
					<span class="st working" aria-hidden="true">{SPIN[frame % 4]}</span>
				{:else}
					<span class="st ready" aria-hidden="true">!</span>
				{/if}
				<span class="t">{l.goal}</span>
			</button>
			{#if l.state === 'ready'}
				<button
					class="integ"
					type="button"
					data-integrate={l.id}
					onclick={() => startIntegrate(l)}
				>
					Integrate
				</button>
			{/if}
		{/each}
	</div>

	<div id="body" bind:this={bodyEl}>
		{#if reviewing}
			<div class="review">
				<h4>Review and integrate: {reviewing.goal}</h4>
				<div class="head">Changed files ({reviewing.files.length})</div>
				<div class="files">
					{#each reviewing.files as [k, f, a, d]}
						<div>
							<span class={k === 'A' ? 'a' : 'mm'}>{k}</span>
							<span>{f}</span>
							<span class="n">+{a}{#if d}<i>-{d}</i>{/if}</span>
						</div>
					{/each}
				</div>
				<div class="msg">
					<label for="cm">Commit message</label>
					<input
						id="cm"
						bind:value={commitInput}
						onkeydown={handleCommitKeydown}
					/>
				</div>
			</div>
		{:else}
			<div class="cols" id="cols">
				<div class="col" id="mainCol" aria-live="polite">
					<div class="head">Main  your working tree</div>
					{#each YOURS as f}
						<div class="m"><b>M</b> {f}</div>
					{/each}
					<div class="tool" style="margin-top:8px">{YOURS[0]}</div>
					<div class="you" id="typing">{LINE.slice(0, typed)}<span class="caret"></span></div>
					<div class="head" style="margin-top:12px">Commits on main</div>
					{#each latestCommits as c, i}
						{#if i === 0 && landedNote}
							<div class="commit"><i>●</i> {c}</div>
						{:else}
							<div class="tool">● {c}</div>
						{/if}
					{/each}
					{#if landedNote}
						<div class="note">One commit from the lane. Your two modified files were not touched.</div>
					{/if}
				</div>

				<div class="col" id="laneCol" aria-live="polite" bind:this={laneColEl}>
					{#if activeLane}
						<div class="head">Lane  own worktree</div>
						<div class="you">&gt; {activeLane.goal}</div>
						{#each activeLane.log as t}
							<div class="tool">{'  ' + t}</div>
						{/each}
						{#if activeLane.state === 'working'}
							<div class="tool live" style="color:var(--ochre)">{'  ' + SPIN[frame % 4] + ' working'}</div>
						{:else}
							<div class="say">{activeLane.done}</div>
						{/if}
					{:else}
						<div class="head">Lanes</div>
						<div class="note">Start a lane below. It gets its own worktree and branch, so main stays yours.</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<div class="goals" id="goals">
		{#if reviewing}
			<button class="btn" type="button" id="back" onclick={returnToLane}>
				Return to lane
			</button>
			<button class="btn primary" type="button" id="land" onclick={integrateIntoMain}>
				Integrate into main
			</button>
		{:else}
			<span>New lane:</span>
			{#each GOALS as g (g.id)}
				<button
					class="btn"
					type="button"
					data-goal={g.id}
					disabled={lanes.some((l) => l.id === g.id) || openLanes.length >= MAX}
					onclick={() => startLane(g)}
				>
					{g.goal}
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.ln {
		container-type: inline-size;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--ground-2);
		font: 400 12.5px/1.6 var(--mono);
		overflow: hidden;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
	}

	.tab {
		all: unset;
		cursor: pointer;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 7px 10px;
		border-radius: 2px;
		color: var(--slate);
		white-space: nowrap;
		position: relative;
	}

	.tab:hover {
		color: var(--stone);
		background: rgb(242 240 234 / 0.04);
	}

	.tab[aria-pressed='true'] {
		color: var(--stone);
		background: rgb(242 240 234 / 0.07);
	}

	.tab[aria-pressed='true']::after {
		content: '';
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 0;
		height: 1px;
		background: var(--ochre);
	}

	.tab:focus-visible {
		outline-offset: -2px;
	}

	.tab .t {
		max-width: 22ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.st {
		width: 1ch;
		text-align: center;
		color: var(--faint);
	}

	.st.working {
		color: var(--ochre);
	}

	.st.ready {
		color: var(--on-ochre);
		background: var(--ochre);
		border-radius: 1px;
		font-weight: 700;
	}

	.integ {
		all: unset;
		cursor: pointer;
		font: 600 11.5px/1 var(--mono);
		color: var(--ochre);
		border: 1px solid var(--ochre);
		padding: 5px 8px;
		border-radius: 2px;
		margin: 0 6px 0 -2px;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.integ:hover {
		background: var(--ochre);
		color: var(--on-ochre);
	}

	.integ:focus-visible {
		outline: 2px solid var(--ochre);
		outline-offset: 2px;
	}

	.cols {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		min-height: 208px;
	}

	.col {
		padding: 12px 14px;
		min-width: 0;
	}

	.col + .col {
		border-left: 1px solid var(--line);
	}

	.head {
		font-size: 11px;
		color: var(--faint);
		margin-bottom: 8px;
	}

	.col div {
		white-space: pre-wrap;
	}

	.m {
		color: var(--slate);
	}

	.m b {
		font-weight: 400;
		color: var(--ochre);
	}

	.caret {
		display: inline-block;
		width: 0.6ch;
		background: var(--stone);
		animation: blink 1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.tool {
		color: var(--faint);
	}

	.you {
		color: var(--stone);
	}

	.say {
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.45;
		color: var(--stone);
		margin-top: 6px;
	}

	.commit {
		color: var(--stone);
	}

	.commit i {
		font-style: normal;
		color: var(--ochre);
	}

	.note {
		font-family: var(--sans);
		font-size: 14px;
		line-height: 1.45;
		color: var(--slate);
		margin-top: 8px;
	}

	.goals {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 10px 14px;
		border-top: 1px solid var(--line);
		align-items: center;
	}

	.goals span {
		color: var(--faint);
		margin-right: 4px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font: 600 12px/1 var(--mono);
		border: 1px solid var(--ochre);
		background: transparent;
		color: var(--ochre);
		padding: 8px 10px;
		border-radius: 2px;
		cursor: pointer;
		transition:
			translate 0.25s var(--ease),
			background 0.2s,
			color 0.2s;
	}

	.btn:hover {
		translate: 0 -1px;
	}

	.btn.primary {
		background: var(--ochre);
		color: var(--on-ochre);
	}

	.btn:disabled {
		opacity: 0.35;
		cursor: default;
		translate: none;
	}

	.review {
		padding: 12px 14px;
		min-height: 208px;
	}

	.review h4 {
		font: 400 20px/1.2 var(--serif);
		letter-spacing: -0.01em;
		margin-bottom: 10px;
	}

	.files div {
		display: flex;
		gap: 10px;
		color: var(--slate);
	}

	.files .a {
		color: var(--ok, #8fc27a);
	}

	.files .mm {
		color: var(--ochre);
	}

	.files .n {
		margin-left: auto;
		color: var(--ok, #8fc27a);
	}

	.files .n i {
		font-style: normal;
		color: #e08a7a;
		margin-left: 6px;
	}

	.msg {
		margin-top: 12px;
	}

	.msg label {
		display: block;
		font-size: 11px;
		color: var(--faint);
		margin-bottom: 4px;
	}

	.msg input {
		width: 100%;
		font: 400 12.5px var(--mono);
		background: var(--ground);
		color: var(--stone);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		padding: 8px;
	}

	.msg input:focus {
		outline: none;
		border-color: var(--ochre);
	}

	@container (max-width: 600px) {
		.cols {
			grid-template-columns: 1fr;
		}
		.col + .col {
			border-left: 0;
			border-top: 1px solid var(--line);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
		.btn {
			transition: none;
		}
	}
</style>
