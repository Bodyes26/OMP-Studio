<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Tabellone delle anteprime della scheda domanda (prototipo Lab
	// «QuestionView Lab», variante «sopra la domanda»). Sta sopra la card, a
	// tutta larghezza, su una superficie in negativo rispetto al tema: chiaro
	// sui temi scuri, scuro su quelli chiari, con l'accento del tema.
	// Cambiando opzione girano solo i caratteri diversi dal disegno di prima,
	// come le palette di un tabellone delle partenze; il disegno non va mai a
	// capo e rimpicciolisce fino a stare nella larghezza.

	let {
		text,
		index,
		label,
		fitCols,
		minLines
	} = $props<{
		text: string;
		/** Posizione dell'opzione mostrata (0-based). */
		index: number;
		label: string;
		/** Colonne comuni alla domanda: passando da un'opzione all'altra la scala resta la stessa. */
		fitCols?: number;
		/** Righe comuni alla domanda: l'altezza del tabellone non cambia e la card sotto resta ferma. */
		minLines?: number;
	}>();

	// Avanzamento dei mono dello stack (JetBrains, Cascadia, Consolas) in
	// frazione del corpo: 0.6 e' il piu' largo, quindi il disegno calcolato
	// sta sempre nella larghezza, al massimo con un po' di margine.
	const CELL = 0.6;
	const LINE = 1.5;
	// Corsa piu' lunga di caratteri che gira come una sola palette.
	const TILE = 6;
	const MAX = 13;
	// Sotto i 7,5 px il disegno non si legge piu': meglio scorrere di lato.
	const MIN = 7.5;

	interface Run {
		text: string;
		col: number;
		flip: boolean;
	}

	function toRuns(line: string, from: string | null): Run[] {
		const before = from === null ? null : [...from];
		const out: Run[] = [];
		[...line].forEach((ch, col) => {
			const flip = before !== null && ch !== ' ' && before[col] !== ch;
			const last = out[out.length - 1];
			if (last && last.flip === flip && !(flip && last.text.length >= TILE)) last.text += ch;
			else out.push({ text: ch, col, flip });
		});
		return out;
	}

	let width = $state(0);
	let natural = $state(false);

	// Disegno mostrato prima di quello attuale; '' alla prima comparsa, cosi'
	// l'intero disegno gira una volta entrando.
	let history: { text: string | undefined; from: string } = { text: undefined, from: '' };
	const from = $derived.by(() => {
		if (history.text !== text) history = { text, from: history.text ?? '' };
		return history.from;
	});

	// Finito il giro le righe tornano testo semplice: un ridisegno successivo
	// (ridimensionamento, 100%) non deve far ripartire le palette.
	let settled = $state<string | null>(null);
	$effect(() => {
		const shown = text;
		const timer = setTimeout(() => (settled = shown), 900);
		return () => clearTimeout(timer);
	});

	const lines = $derived(text.split('\n'));
	const cols = $derived(Math.max(1, fitCols ?? 0, ...lines.map((l: string) => [...l].length)));
	const ideal = $derived(width > 0 ? (width - 1) / (cols * CELL) : MAX);
	const size = $derived(natural ? MAX : Math.max(MIN, Math.min(MAX, ideal)));
	const shrunk = $derived(width > 0 && ideal < MAX);
	const tooWide = $derived(!natural && width > 0 && ideal < MIN);
	const rows = $derived.by(() => {
		const before = settled !== text ? from.split('\n') : null;
		return lines.map((line: string, i: number) => toRuns(line, before ? (before[i] ?? '') : null));
	});
</script>

<section class="board" aria-label={m.chat_v2_ask_preview()}>
	<div class="board-head">
		<span class="board-cap">{m.chat_v2_ask_preview()}</span>
		<span class="board-num">{index + 1}</span>
		<span class="board-label" title={label}>{label}</span>
		{#if shrunk || natural}
			<button
				type="button"
				class="board-toggle"
				aria-pressed={natural}
				title={m.chat_v2_ask_preview_actual()}
				onclick={() => (natural = !natural)}
			>
				100%
			</button>
		{/if}
	</div>
	<div class="board-body">
		<div class="board-scroll" bind:clientWidth={width}>
			{#key text}
				<pre
					class="board-lines"
					style:font-size="{size}px"
					style:line-height={LINE}
					style:min-height={minLines ? `${minLines * LINE}em` : undefined}>{#each rows as runs, i}{#if i > 0}{'\n'}{/if}{#each runs as r}{#if r.flip}<span class="flap" style:--d="{Math.min(i * 18 + r.col * 4, 480)}ms">{r.text}</span>{:else}{r.text}{/if}{/each}{/each}</pre>
			{/key}
		</div>
		{#if tooWide}
			<p class="board-note">{m.chat_v2_ask_preview_wide()}</p>
		{/if}
	</div>
</section>

<style>
	/* Superficie in negativo: il fondo e' l'inchiostro del tema velato
	   dall'accento, il testo e' la base del tema. L'accento dei caratteri che
	   girano e' --brand-ink con la luminanza ribaltata (0.72 <-> 0.40), cioe'
	   quella che il tema userebbe sulla superficie opposta. */
	.board {
		--board-bg: color-mix(in oklab, var(--ink) 94%, var(--brand));
		--board-ink: var(--bg-base);
		--board-mute: color-mix(in oklab, var(--bg-base) 68%, var(--ink));
		--board-line: color-mix(in srgb, var(--bg-base) 12%, transparent);
		--board-flap: oklch(calc(1.12 - var(--brand-ink-l)) calc(var(--brand-c) * 0.895) var(--brand-h));
		--ease-flap: cubic-bezier(0.2, 0.7, 0.2, 1);
		flex-shrink: 0;
		min-width: 0;
		overflow: hidden;
		background: var(--board-bg);
		color: var(--board-ink);
		border-radius: var(--radius-2xl);
		box-shadow: var(--shadow-raise);
		animation: board-rise 260ms var(--ease-flap) both;
	}

	.board-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 32px;
		padding: 4px var(--space-2) 4px var(--space-4);
		border-bottom: 1px solid var(--board-line);
		font-size: var(--text-xs);
	}
	.board-cap {
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--board-mute);
		white-space: nowrap;
	}
	.board-num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--board-mute);
	}
	.board-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.board-toggle {
		flex-shrink: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		padding: 2px 8px;
		font: inherit;
		font-variant-numeric: tabular-nums;
		color: var(--board-mute);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}
	.board-toggle:hover,
	.board-toggle[aria-pressed='true'] {
		color: var(--board-ink);
	}
	.board-toggle[aria-pressed='true'] {
		background: color-mix(in srgb, var(--board-ink) 12%, transparent);
	}
	.board-toggle:focus-visible {
		outline: 2px solid var(--board-flap);
		outline-offset: 1px;
	}

	.board-body {
		max-height: 34vh;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4) 14px;
	}
	.board-scroll {
		overflow-x: auto;
		overscroll-behavior-x: contain;
	}

	/* La riga di divisione di ogni palette, alta quanto l'interlinea (1.5em). */
	.board-lines {
		width: max-content;
		margin: 0;
		font-family: var(--font-mono);
		color: var(--board-ink);
		background-image: linear-gradient(
			to bottom,
			transparent calc(50% - 0.5px),
			color-mix(in srgb, var(--board-ink) 6%, transparent) calc(50% - 0.5px),
			color-mix(in srgb, var(--board-ink) 6%, transparent) calc(50% + 0.5px),
			transparent calc(50% + 0.5px)
		);
		background-size: 100% 1.5em;
	}

	.board-note {
		margin: var(--space-2) 0 0;
		font-size: var(--text-meta);
		color: var(--board-mute);
	}

	/* Firma: solo i caratteri diversi dal disegno precedente girano entrando. */
	.flap {
		display: inline-block;
		transform-origin: 50% 0;
		animation: flap 280ms var(--ease-flap) both;
		animation-delay: var(--d, 0ms);
	}
	@keyframes flap {
		from {
			transform: perspective(240px) rotateX(-90deg);
			color: var(--board-flap);
		}
		55% {
			color: var(--board-flap);
		}
		to {
			transform: none;
		}
	}
	@keyframes flap-still {
		from,
		40% {
			color: var(--board-flap);
		}
	}
	@keyframes board-rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	/* Movimento ridotto: niente giro, i caratteri cambiati restano accesi un secondo. */
	@media (prefers-reduced-motion: reduce) {
		.board {
			animation: none;
		}
		.flap {
			transform: none;
			animation: flap-still 1200ms linear both;
			animation-delay: 0ms;
		}
	}
</style>
