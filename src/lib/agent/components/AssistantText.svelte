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

	// Stato debounce per lo streaming dell'ultimo blocco di testo.
	let debouncedTokens = $state<Token[] | null>(null);
	let debouncedText = $state<string>('');

	const lastBlockIndex = $derived(entry.blocks.length - 1);
	const lastBlock = $derived(entry.blocks[lastBlockIndex] as Block | undefined);
	const isStreamingLastText = $derived(
		streaming && lastBlock !== undefined && lastBlock.type === 'text'
	);

	$effect(() => {
		if (!isStreamingLastText || !lastBlock || lastBlock.type !== 'text') {
			debouncedTokens = null;
			debouncedText = '';
			return;
		}

		const currentText = lastBlock.text;
		const timer = setTimeout(() => {
			debouncedTokens = lexMarkdown(currentText);
			debouncedText = currentText;
		}, 120);

		return () => {
			clearTimeout(timer);
		};
	});

	function formatCost(total: number | undefined): string | undefined {
		if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return undefined;
		return `$${total.toFixed(4)}`;
	}

	const formattedCost = $derived(formatCost(entry.usage?.cost?.total));
	const hasFooter = $derived(Boolean(entry.model || formattedCost));
</script>

<div class="assistant-entry">
	<div class="blocks">
		{#each entry.blocks as block, i (i)}
			{#if block.type === 'text'}
				{#if isStreamingLastText && i === lastBlockIndex}
					{#if debouncedTokens && debouncedText === block.text}
						<div class="markdown-wrap">
							<Markdown tokens={debouncedTokens} />
						</div>
					{:else}
						<pre class="streaming">{block.text}</pre>
					{/if}
				{:else}
					<div class="markdown-wrap">
						<Markdown tokens={lexMarkdown(block.text)} />
					</div>
				{/if}
			{:else if block.type === 'thinking'}
				<ThinkingBlock text={block.text} />
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

	pre.streaming {
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
