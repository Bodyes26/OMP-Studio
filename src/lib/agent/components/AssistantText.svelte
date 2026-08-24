<script lang="ts">
	// Rendering del messaggio dell'assistente: itera i blocchi (testo,
	// ragionamento, immagini).
	// Durante lo streaming il testo in coda e' reso grezzo e ri-parsato
	// con debounce di 120ms per evitare ricalcoli O(n^2).
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdown, type Token } from '../markdown';
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

	// Il protocollo puo' consegnare delta molto grandi. Il testo ricevuto resta
	// autorevole nello store; qui viene drenato su pochi frame per evitare che
	// interi paragrafi compaiano in un solo salto.
	const STREAM_PARSE_INTERVAL_MS = 48;
	let displayedText = $state('');
	let displayedBlockIndex = $state(-1);
	let throttledTokens = $state<Token[] | null>(null);
	let lastParseTime = 0;

	const lastBlockIndex = $derived(entry.blocks.length - 1);
	const lastBlock = $derived(entry.blocks[lastBlockIndex] as Block | undefined);
	const isStreamingLastText = $derived(
		streaming && lastBlock !== undefined && lastBlock.type === 'text'
	);
	const isPresentingLastText = $derived(
		lastBlock?.type === 'text'
			&& (
				isStreamingLastText
				|| (
					displayedBlockIndex === lastBlockIndex
					&& displayedText.length < lastBlock.text.length
				)
			)
	);

	$effect(() => {
		if (!lastBlock || lastBlock.type !== 'text') {
			displayedText = '';
			displayedBlockIndex = -1;
			return;
		}
		if (isStreamingLastText && displayedBlockIndex !== lastBlockIndex) {
			displayedBlockIndex = lastBlockIndex;
			displayedText = '';
			return;
		}
		if (!isPresentingLastText) {
			if (!streaming) {
				displayedText = '';
				displayedBlockIndex = -1;
			}
			return;
		}

		const target = lastBlock.text;
		if (!target.startsWith(displayedText)) {
			displayedText = target;
			return;
		}
		if (displayedText.length >= target.length) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			displayedText = target;
			return;
		}

		const backlog = target.length - displayedText.length;
		const frame = requestAnimationFrame(() => {
			const step = Math.min(backlog, Math.min(48, Math.max(2, Math.ceil(backlog / 10))));
			displayedText = target.slice(0, displayedText.length + step);
		});
		return () => cancelAnimationFrame(frame);
	});

	// Il markdown segue il testo presentato a 20 fps: abbastanza fluido per la
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
			{#if block.type === 'text'}
				{#if isPresentingLastText && i === lastBlockIndex}
					{#if throttledTokens}
						<div class="markdown-wrap">
							<Markdown tokens={throttledTokens} />
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
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
		user-select: none;
		padding-top: 2px;
	}

	.assistant-entry:hover .footer {
		opacity: 1;
	}

	.model {
		font-family: var(--font-mono);
	}

	.cost {
		font-family: var(--font-mono);
	}
</style>
