<!--
  ThinkingBlock.svelte — Blocco di ragionamento (thinking/chain of thought) dell'assistente.
  Stato vivo: shimmer 'Sto pensando...'; a riposo: fisarmonica richiudibile con conteggio righe.
  Fedele a src/lib/agent/components/ThinkingBlock.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import { lexMarkdown } from '../../chat/markdown.ts';
	import Markdown from './Markdown.svelte';
	import { IconChevronRight } from '../../icons.ts';

	let {
		text = '',
		streaming = false
	}: {
		text?: string;
		streaming?: boolean;
	} = $props();

	let expanded = $state(false);

	function toggleExpanded(): void {
		expanded = !expanded;
	}

	const lines = $derived(text ? text.split('\n') : []);
	const linesCount = $derived(lines.length);
	const label = $derived(
		linesCount > 0
			? t('chatThinkingLines', { count: linesCount })
			: t('chatThinkingLabel')
	);
	const markdownTokens = $derived(text ? lexMarkdown(text) : []);
</script>

{#if streaming}
	<div class="thinking-streaming rv-blur" role="status" aria-live="polite">
		<span class="text-shimmer">{t('chatThinkingStreaming')}</span>
	</div>
{:else if text}
	<div class="thinking-block rv-blur">
		<button
			type="button"
			class="header-btn"
			class:expanded
			aria-expanded={expanded}
			aria-label={`${label}. ${expanded ? 'Comprimi' : 'Espandi'}`}
			onclick={toggleExpanded}
			title={expanded ? 'Comprimi ragionamento' : 'Espandi ragionamento'}
		>
			<span class="chevron" class:expanded aria-hidden="true"><IconChevronRight /></span>
			<span class="label">{label}</span>
		</button>
		{#if expanded}
			<div class="thinking-body">
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
		--icon-size: 12px;
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
