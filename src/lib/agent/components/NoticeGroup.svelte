<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Accorpamento di righe di sistema consecutive (SystemChip e NoticeRow).
	// Raggruppa comunicazioni e avvisi di sistema contigui in un unico blocco
	// compatto e collassabile, evitando che notifiche multiple disperdano la lettura.
	import type { SystemChipEntry, NoticeEntry } from '../session.svelte';
	import SystemChip from './SystemChip.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import { IconChevronRight } from '$lib/icons';

	let { entries }: { entries: (SystemChipEntry | NoticeEntry)[] } = $props();

	let expanded = $state(false);

	const previewTitles = $derived(
		entries
			.slice(0, 2)
			.map((e) => (e.kind === 'system-chip' ? e.title : e.message))
			.filter(Boolean)
	);
	const previewText = $derived(previewTitles.join(' · '));
</script>

<div class="notice-group">
	<button
		type="button"
		class="group-toggle"
		aria-expanded={expanded}
		onclick={() => (expanded = !expanded)}
		title={expanded ? 'Comprimi messaggi di sistema' : 'Espandi messaggi di sistema'}
	>
		<span class="chevron" class:expanded aria-hidden="true">
			<IconChevronRight />
		</span>
		<span class="label">
			<span class="count">{entries.length}</span>
			{entries.length === 1 ? m.ui_noticegroup_messaggio_di_sistema_e0ee() : 'messaggi di sistema'}
		</span>
		{#if !expanded && previewText}
			<span class="preview" title={previewText}>· {previewText}</span>
		{/if}
	</button>

	{#if expanded}
		<div class="children">
			{#each entries as child (child.id)}
				{#if child.kind === 'system-chip'}
					<SystemChip entry={child} />
				{:else if child.kind === 'notice'}
					<NoticeRow entry={child} />
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.notice-group {
		width: 100%;
		border-top: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.group-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		background: transparent;
		border: none;
		padding: 2px var(--space-1);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		width: 100%;
		min-width: 0;
	}

	.group-toggle:hover {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.chevron {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.label {
		flex-shrink: 0;
		white-space: nowrap;
	}

	.count {
		font-variant-numeric: tabular-nums;
	}

	.preview {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
		color: var(--ink-faint);
	}

	.children {
		display: flex;
		flex-direction: column;
		padding-left: calc(12px + var(--space-2));
	}
</style>
