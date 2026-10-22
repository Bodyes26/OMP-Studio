<!--
  AccordionCard.svelte — Intelligent UI: Sezione collassabile per approfondimenti o dettagli tecnici.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { IconChevronRight } from '../../icons';

	let {
		title = 'Dettagli',
		badge,
		open = false,
		children
	}: {
		title?: string;
		badge?: string;
		open?: boolean;
		children?: Snippet;
	} = $props();

	let isOpen = $state(false);
	$effect(() => {
		isOpen = open;
	});
</script>

<div class="accordion-card" class:open={isOpen}>
	<button
		type="button"
		class="accordion-trigger"
		onclick={() => (isOpen = !isOpen)}
		aria-expanded={isOpen}
	>
		<span class="chevron" class:expanded={isOpen} aria-hidden="true">
			<IconChevronRight />
		</span>
		<span class="accordion-title">{title}</span>
		{#if badge}
			<span class="accordion-badge">{badge}</span>
		{/if}
	</button>

	{#if isOpen}
		<div class="accordion-content">
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</div>

<style>
	.accordion-card {
		margin: var(--space-2) 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out);
		/* Container query per adattare le dimensioni di tocco dell'intestazione */
		container-type: inline-size;
	}

	.accordion-card:hover {
		border-color: var(--line-strong);
	}

	.accordion-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 8px 12px;
		background: var(--bg-raised);
		border: none;
		cursor: pointer;
		color: var(--ink);
		font-size: var(--text-label);
		font-weight: 500;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.accordion-trigger:hover {
		background: var(--bg-hover);
	}

	.chevron {
		display: inline-grid;
		place-items: center;
		--icon-size: 13px;
		color: var(--ink-muted);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.accordion-title {
		flex: 1;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.accordion-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-muted);
		background: var(--bg-overlay);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.accordion-content {
		padding: var(--space-3);
		background: var(--bg-base);
		border-top: 1px solid var(--line);
		font-size: var(--text-body);
		line-height: 1.5;
	}

	/* Intestazione >=44px su schermi touch o colonne strette per accessibilita' tocco */
	@media (pointer: coarse) {
		.accordion-trigger {
			min-height: 44px;
			padding: 10px 12px;
		}
	}

	@container (max-width: 520px) {
		.accordion-trigger {
			min-height: 44px;
			padding: 10px 12px;
		}
	}
</style>
