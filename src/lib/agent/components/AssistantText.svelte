<script lang="ts">
	// Rendering del messaggio dell'assistente: itera i blocchi (testo,
	// ragionamento, immagini).
	// Durante lo streaming il testo in coda e' drenato con un ritardo
	// obiettivo di mezzo secondo e ri-parsato a 20 fps per evitare
	// ricalcoli O(n^2).
	import { onDestroy } from 'svelte';
	import { agentUiHooks } from '../ui-context';
	import { chatReveal } from '../motion';
	import { lexMarkdown, type StreamFade, type Token } from '../markdown';
	import type { AssistantEntry, Block } from '../session.svelte';
	import Markdown from './Markdown.svelte';
	import ThinkingBlock from './ThinkingBlock.svelte';

	let {
		entry,
		streaming = false
	}: {
		entry: AssistantEntry;
		streaming?: boolean;
	} = $props();

	const hooks = agentUiHooks();

	// Comparsa dei caratteri. Il testo ricevuto resta autorevole nello store;
	// qui una testa di lettura lo scopre a velocita' continua, tenendosi mezzo
	// secondo dietro al dato: i delta grossi non fanno piu' comparire interi
	// paragrafi in un salto. Gli ultimi caratteri scoperti salgono di opacita'
	// (vedi StreamTail): la comparsa e' una rampa, non uno scatto.
	const REVEAL_LAG_MS = 500; // ritardo obiettivo rispetto al dato arrivato
	const FLUSH_LAG_MS = 200; // a stream chiuso la coda si svuota piu' in fretta
	const MIN_RATE = 0.02; // caratteri/ms: sotto questa soglia non si scende
	const RATE_INERTIA_MS = 140; // smorza gli scatti di velocita' sui delta grossi
	const SNAP_BACKLOG = 4000; // consegne in blocco (ricariche): niente animazione
	const FADE_MS = 260; // quanto dura la comparsa di un singolo carattere
	const MIN_FADE_CHARS = 6;
	const MAX_FADE_CHARS = 36;
	const STREAM_PARSE_INTERVAL_MS = 48;

	// Uscite reattive dell'animazione.
	let displayedLen = $state(0);
	let displayedBlockIndex = $state(-1);
	let fadeOver = $state(Number.POSITIVE_INFINITY);
	let fadeWindow = $state(MIN_FADE_CHARS);
	let throttledTokens = $state<Token[] | null>(null);

	// Integratore dell'animazione: fuori dal grafo reattivo, lo tocca solo il rAF.
	let cursor = 0; // testa di lettura, in caratteri frazionari
	let over = 0; // caratteri di avanzamento oltre la fine, chiude la dissolvenza
	let rate = 0; // velocita' corrente in caratteri/ms
	let lastTs = 0;
	let raf = 0;
	let blockKey = -1;
	let lastParseTime = 0;

	const prefersReducedMotion =
		typeof window !== 'undefined'
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const lastBlockIndex = $derived(entry.blocks.length - 1);
	const lastBlock = $derived(entry.blocks[lastBlockIndex] as Block | undefined);
	const isStreamingLastText = $derived(
		streaming && lastBlock !== undefined && lastBlock.type === 'text'
	);
	const targetText = $derived(lastBlock?.type === 'text' ? lastBlock.text : '');
	const displayedText = $derived(targetText.slice(0, displayedLen));
	const isPresentingLastText = $derived(
		lastBlock?.type === 'text'
			&& (
				isStreamingLastText
				|| (
					displayedBlockIndex === lastBlockIndex
					&& (displayedLen < targetText.length || fadeOver < fadeWindow)
				)
			)
	);
	const fade: StreamFade | null = $derived(
		isPresentingLastText && fadeOver < fadeWindow
			? { over: fadeOver, window: fadeWindow }
			: null
	);

	function stopLoop() {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
	}

	function startLoop() {
		if (raf) return;
		lastTs = performance.now();
		raf = requestAnimationFrame(tick);
	}

	/** Tutto mostrato, nessuna dissolvenza in corso. */
	function settle(len: number, blockIndex: number) {
		stopLoop();
		cursor = len;
		over = 0;
		rate = 0;
		displayedLen = len;
		displayedBlockIndex = blockIndex;
		fadeOver = Number.POSITIVE_INFINITY;
	}

	/** Nuovo blocco in arrivo: la testa di lettura riparte da zero. */
	function rewind(blockIndex: number) {
		cursor = 0;
		over = 0;
		rate = 0;
		displayedLen = 0;
		displayedBlockIndex = blockIndex;
		fadeOver = 0;
	}

	function tick(now: number) {
		raf = 0;
		const dt = Math.min(Math.max(now - lastTs, 0), 120);
		lastTs = now;

		// Letture in un callback: fuori da un contesto reattivo, non tracciano.
		const total = targetText.length;
		if (cursor > total) cursor = total; // testo riscritto: mai tornare indietro
		const backlog = total - cursor;

		// Velocita' proporzionale all'arretrato: all'equilibrio la testa scopre
		// esattamente al ritmo di arrivo, restando `lag` millisecondi dietro.
		if (backlog > 0) {
			const lag = streaming ? REVEAL_LAG_MS : FLUSH_LAG_MS;
			const desired = Math.max(backlog / lag, MIN_RATE);
			rate = rate > 0 ? rate + (desired - rate) * Math.min(1, dt / RATE_INERTIA_MS) : desired;
		}

		// La rampa di opacita' e' larga quanto i caratteri scoperti in FADE_MS:
		// la dissolvenza dura sempre lo stesso tempo, a qualsiasi velocita'.
		const win = Math.min(MAX_FADE_CHARS, Math.max(MIN_FADE_CHARS, rate * FADE_MS));
		fadeWindow = win;

		if (backlog > 0) {
			over = 0;
			cursor = Math.min(total, cursor + rate * dt);
		} else {
			// Niente in coda: la testa continua oltre la fine per chiudere la
			// dissolvenza degli ultimi caratteri.
			over += Math.max(rate, win / FADE_MS) * dt;
		}

		const shown = Math.floor(cursor);
		displayedLen = shown;
		fadeOver = cursor - shown + over;

		if (backlog <= 0 && over >= win) {
			// Raggiunto il dato e dissolvenza finita: il ciclo si spegne, il
			// prossimo delta lo riaccende dall'effetto.
			fadeOver = Number.POSITIVE_INFINITY;
			rate = 0;
			return;
		}
		raf = requestAnimationFrame(tick);
	}

	$effect(() => {
		const isText = lastBlock?.type === 'text';
		const total = targetText.length;
		const blockIndex = lastBlockIndex;
		const live = streaming;

		if (!isText) {
			blockKey = -1;
			settle(0, -1);
			return;
		}

		if (blockKey !== blockIndex) {
			blockKey = blockIndex;
			// Blocco gia' completo (entry storica): niente da animare.
			if (!live) {
				settle(total, -1);
				return;
			}
			rewind(blockIndex);
		}

		if (prefersReducedMotion || total - cursor > SNAP_BACKLOG) {
			settle(total, blockIndex);
			return;
		}

		startLoop();
	});

	onDestroy(stopLoop);

	// Il markdown segue il testo scoperto a 20 fps: abbastanza fluido per la
	// lettura, senza riparsare l'intera risposta a ogni frame del compositor.
	$effect(() => {
		if (!isPresentingLastText) {
			throttledTokens = null;
			lastParseTime = 0;
			return;
		}

		const currentText = displayedText;
		const now = Date.now();
		const elapsed = now - lastParseTime;
		let timer: number | null = null;

		if (elapsed >= STREAM_PARSE_INTERVAL_MS || !throttledTokens) {
			throttledTokens = lexMarkdown(currentText);
			lastParseTime = now;
		} else {
			timer = window.setTimeout(() => {
				throttledTokens = lexMarkdown(displayedText);
				lastParseTime = Date.now();
			}, STREAM_PARSE_INTERVAL_MS - elapsed);
		}

		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	});

	function formatCost(total: number | undefined): string | undefined {
		if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return undefined;
		return `$${total.toFixed(4)}`;
	}

	const formattedCost = $derived(formatCost(entry.usage?.cost?.total));
	const hasFooter = $derived(Boolean(entry.model || formattedCost));
</script>

<div class="assistant-entry" class:streaming={streaming || isPresentingLastText}>
	<div class="blocks">
		{#each entry.blocks as block, i (`${block.type}-${i}`)}
			<div
				class="assistant-block"
				in:chatReveal={{
					duration: block.type === 'text' ? 140 : 210,
					blur: block.type === 'text' ? 2 : 5,
					distance: block.type === 'thinking' ? 2 : 3
				}}
			>
				{#if block.type === 'text'}
					{#if isPresentingLastText && i === lastBlockIndex}
						{#if throttledTokens}
							<div class="markdown-wrap">
								<Markdown tokens={throttledTokens} {fade} />
							</div>
						{:else}
							<pre class="streaming-text">{displayedText}</pre>
						{/if}
					{:else}
						<div class="markdown-wrap">
							<Markdown tokens={lexMarkdown(block.text)} />
						</div>
					{/if}
				{:else if block.type === 'thinking'}
					<ThinkingBlock
						text={block.text}
						streaming={streaming && i === lastBlockIndex}
					/>
				{:else if block.type === 'image'}
					<div class="image-wrap">
						<button
							type="button"
							class="image-btn"
							onclick={() => hooks.openImage(block.data, block.mimeType)}
							title="Apri immagine"
						>
							<img
								src={`data:${block.mimeType};base64,${block.data}`}
								alt="Immagine generata dall'assistente"
							/>
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if hasFooter}
		<div class="footer">
			{#if entry.model}
				<span class="model">{entry.model}</span>
			{/if}
			{#if formattedCost}
				<span class="cost">{formattedCost}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.assistant-entry {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		position: relative;
	}

	.assistant-entry.streaming {
		transition:
			opacity var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}

	@starting-style {
		.assistant-entry.streaming {
			opacity: 0;
			transform: translateY(2px);
		}
	}

	.blocks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.assistant-block {
		min-width: 0;
	}

	.markdown-wrap {
		min-width: 0;
		line-height: 1.5;
	}

	pre.streaming-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}

	.image-wrap {
		display: flex;
		margin: var(--space-1) 0;
	}

	.image-btn {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
	}

	.image-btn:hover {
		border-color: var(--line-strong);
	}

	.image-btn img {
		display: block;
		max-width: 240px;
		max-height: 180px;
		object-fit: contain;
	}

	.footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
		padding-top: var(--space-1);
	}

	.model {
		font-family: var(--font-mono);
	}

	.cost {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
</style>
