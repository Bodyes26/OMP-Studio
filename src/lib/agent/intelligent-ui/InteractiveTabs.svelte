<!--
  InteractiveTabs.svelte — Intelligent UI: Schede a tab commutabili all'interno della chat.
-->
<script lang="ts">
	import type { Token } from '../markdown';
	import MarkdownInline from '../components/MarkdownInline.svelte';
	import CodeBlock from '../components/CodeBlock.svelte';

	export interface TabItem {
		id?: string;
		title: string;
		lang?: string;
		content: string;
	}

	let {
		tabs = [],
		onOpenFile
	}: {
		tabs: TabItem[];
		onOpenFile?: (path: string) => void;
	} = $props();

	let activeIndex = $state(0);
	const activeTab = $derived(tabs[activeIndex] || tabs[0]);
</script>

<div class="interactive-tabs-card">
	<div class="tabs-header" role="tablist">
		{#each tabs as tab, idx (idx)}
			<button
				type="button"
				role="tab"
				class="tab-btn"
				class:active={idx === activeIndex}
				aria-selected={idx === activeIndex}
				onclick={() => (activeIndex = idx)}
			>
				{tab.title}
			</button>
		{/each}
	</div>

	<div class="tab-panel" role="tabpanel">
		{#if activeTab}
			{#if activeTab.lang}
				<CodeBlock lang={activeTab.lang} text={activeTab.content} {onOpenFile} />
			{:else}
				<div class="tab-prose">
					{activeTab.content}
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.interactive-tabs-card {
		margin: var(--space-3) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-base);
		overflow: hidden;
		/* Container query per adattare i pulsanti e lo scorrimento dei tab */
		container-type: inline-size;
	}

	.tabs-header {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px 6px 0;
		background: var(--bg-raised);
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
		/* Scorrimento orizzontale fluido con snap per non troncare o mandare a capo i tab */
		scroll-snap-type: x mandatory;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
	}

	.tab-btn {
		flex-shrink: 0;
		scroll-snap-align: start;
		padding: 6px 12px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: all var(--dur-fast) var(--ease-out);
	}

	.tab-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
	}

	.tab-btn.active {
		color: var(--brand-ink);
		font-weight: 600;
		border-bottom-color: var(--brand);
		background: var(--bg-base);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
	}

	.tab-panel {
		padding: var(--space-2);
		background: var(--bg-base);
	}

	.tab-prose {
		padding: var(--space-2);
		font-size: var(--text-body);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
	}

	/* Su touch screen e contenitori stretti altezza tocco >=40px */
	@media (pointer: coarse) {
		.tab-btn {
			min-height: 40px;
			padding: 8px 14px;
		}
	}

	@container (max-width: 480px) {
		.tab-btn {
			min-height: 40px;
			padding: 8px 12px;
		}
	}
</style>
