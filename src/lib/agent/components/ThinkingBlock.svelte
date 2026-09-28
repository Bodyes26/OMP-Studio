<script module lang="ts">
	// Preferenza di espansione condivisa per la sessione: l'ultima
	// scelta dell'utente diventa il default per i blocchi successivi (Gate R32 - C06).
	let lastExpandedPreference = $state(false);
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { lexMarkdown } from '../markdown';
	import Markdown from './Markdown.svelte';
	import { IconChevronRight } from '$lib/icons';

	let {
		text = '',
		streaming = false
	}: {
		text?: string;
		streaming?: boolean;
	} = $props();

	let expanded = $state(lastExpandedPreference);

	function toggleExpanded() {
		expanded = !expanded;
		lastExpandedPreference = expanded;
	}

	const bodyId = `thinking-${Math.random().toString(36).slice(2, 9)}`;
	const lines = $derived(text ? text.split('\n') : []);
	const linesCount = $derived(lines.length);
	const lineUnit = $derived(
		linesCount === 1
			? m.chat_v2_thinking_line_singular()
			: m.chat_v2_thinking_line_plural()
	);
	const label = $derived(
		linesCount > 0
			? m.chat_v2_thinking_lines({ count: linesCount, unit: lineUnit })
			: m.chat_v2_thinking_label()
	);
	const markdownTokens = $derived(text ? lexMarkdown(text) : []);
</script>

{#if streaming}
	<div class="thinking-streaming rv-blur" role="status" aria-live="polite">
		<span class="text-shimmer">{m.chat_v2_thinking_streaming()}</span>
	</div>
{:else if text}
	<div class="thinking-block rv-blur">
		<button
			type="button"
			class="header-btn"
			class:expanded
			aria-expanded={expanded}
			aria-controls={bodyId}
			aria-label={`${label}. ${expanded ? 'Comprimi' : 'Espandi'} il ragionamento`}
			onclick={toggleExpanded}
			title={expanded ? 'Comprimi ragionamento' : 'Espandi ragionamento'}
		>
			<span class="chevron" class:expanded aria-hidden="true"><IconChevronRight /></span>
			<span class="label">{label}</span>
		</button>
		{#if expanded}
			<div id={bodyId} class="thinking-body">
				<Markdown tokens={markdownTokens} />
			</div>
		{/if}
	</div>
{/if}

<style>
	.thinking-streaming {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) 0;
		font-size: 13.5px;
		user-select: none;
	}

	.thinking-block {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin: var(--space-1) 0;
	}

	.header-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
		user-select: none;
		width: fit-content;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.header-btn:hover {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.header-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.chevron {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.label {
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.thinking-body {
		margin-top: var(--space-2);
		padding-left: var(--space-3);
		border-left: 2px solid var(--line);
		color: var(--ink-muted);
		font-size: 13px;
		line-height: 22px;
	}
</style>
