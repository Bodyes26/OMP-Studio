<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Accorpamento di righe di sistema consecutive (SystemChip e NoticeRow).
	// Linguaggio v2: traccia leggera (12.5px, --ink-muted, icona 14px, chevron espandibile).
	import type { SystemChipEntry, NoticeEntry } from '../session.svelte';
	import SystemChip from './SystemChip.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import { IconChevronRight } from '$lib/icons';

	let { entries, fresh = false }: { entries: (SystemChipEntry | NoticeEntry)[]; fresh?: boolean } = $props();

	let expanded = $state(false);

	const previewTitles = $derived(
		entries
			.slice(0, 2)
			.map((e) => (e.kind === 'system-chip' ? e.title : e.message))
			.filter(Boolean)
	);
	const previewText = $derived(previewTitles.join(' · '));
</script>

<div
	class="notice-group"
	class:rv-blur={fresh}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
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
			{entries.length === 1 ? m.ui_noticegroup_messaggio_di_sistema_e0ee() : m.ui_noticegroup_messaggi_di_sistema()}
		</span>
		{#if !expanded && previewText}
			<span class="preview" title={previewText}>· {previewText}</span>
		{/if}
	</button>

	{#if expanded}
		<div class="children rv-blur" style="--dur: 200ms; --blur: 2px;">
			{#each entries as child (child.id)}
				{#if child.kind === 'system-chip'}
					<SystemChip entry={child} fresh={false} />
				{:else if child.kind === 'notice'}
					<NoticeRow entry={child} fresh={false} />
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.notice-group {
		width: 100%;
		padding: 2px 0;
		font-size: var(--text-trace);
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.group-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 2px 4px;
		margin-left: -4px;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		font-size: var(--text-trace);
		line-height: 1.4;
		color: var(--ink-muted);
		width: 100%;
		min-width: 0;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.group-toggle:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.chevron {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: transform var(--dur-fast) var(--ease-out);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.group-toggle:hover .chevron {
		color: var(--ink-muted);
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
		gap: 3px;
		margin-top: 2px;
		border-left: 1px solid var(--line);
		margin-left: 3px;
		padding-left: 10px;
	}
</style>
