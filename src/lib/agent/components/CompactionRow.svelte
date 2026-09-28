<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Riga di compattazione della sessione.
	// Linguaggio v2: traccia leggera (12.5px, --ink-muted, icona 14px).
	// Stato vivo: 'Compattazione…' con shimmer; a conclusione: riepilogo token liberati ed espansione.
	import type { CompactionEntry } from '../session.svelte';
	import { formatTokens } from '$lib/utils/format';
	import { IconContextWindow, IconChevronRight, IconRefresh } from '$lib/icons';

	let { entry, fresh = false }: { entry: CompactionEntry; fresh?: boolean } = $props();
	let expanded = $state(false);

	const freedTokens = $derived.by(() => {
		if (typeof entry.tokensBefore === 'number' && typeof entry.tokensAfter === 'number') {
			const diff = entry.tokensBefore - entry.tokensAfter;
			return diff > 0 ? diff : null;
		}
		const match = entry.message?.match(/-([0-9.,]+[kM]?)/);
		return match ? match[1] : null;
	});

	const compactedLabel = $derived.by(() => {
		if (freedTokens) {
			const tokensStr = typeof freedTokens === 'number' ? formatTokens(freedTokens) : String(freedTokens);
			return m.chat_v2_compaction_freed({ tokens: tokensStr });
		}
		return m.chat_v2_compaction_done();
	});
</script>

<div
	class="compaction-row"
	class:running={entry.running}
	class:rv-blur={fresh}
	style={fresh ? '--dur: 400ms; --blur: 4px;' : undefined}
>
	<div class="main-line">
		<span class="row-icon" aria-hidden="true">
			{#if entry.running}
				<IconRefresh />
			{:else}
				<IconContextWindow />
			{/if}
		</span>

		{#if entry.running}
			<div class="message-static">
				<span class="message text-shimmer">{m.chat_v2_compaction_running()}</span>
			</div>
		{:else if entry.summary}
			<button
				type="button"
				class="message-btn"
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				title={expanded ? m.chat_v2_compaction_hide_summary() : m.chat_v2_compaction_show_summary()}
			>
				<span class="message">{compactedLabel}</span>
				<span class="chevron" class:expanded aria-hidden="true">
					<IconChevronRight />
				</span>
			</button>
		{:else}
			<div class="message-static">
				<span class="message">{compactedLabel}</span>
			</div>
		{/if}
	</div>

	{#if expanded && entry.summary}
		<div class="summary-body rv-blur" style="--dur: 200ms; --blur: 2px;">
			<div class="summary-header">{m.chat_v2_compaction_show_summary()}</div>
			<div class="summary-text">{entry.summary}</div>
		</div>
	{/if}
</div>

<style>
	.compaction-row {
		width: 100%;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.main-line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.row-icon {
		--icon-size: 14px;
		width: 14px;
		height: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.compaction-row.running .row-icon {
		color: var(--brand);
		animation: spin 2s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.message-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 2px 4px;
		margin-left: -4px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-muted);
		min-width: 0;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.message-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.message-static {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--ink-muted);
		min-width: 0;
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

	.message-btn:hover .chevron {
		color: var(--ink-muted);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.message {
		user-select: text;
		word-break: break-word;
	}

	.summary-body {
		margin-top: 2px;
		border-left: 1px solid var(--line);
		margin-left: 3px;
		padding-left: 10px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.summary-header {
		font-weight: 500;
		color: var(--ink-faint);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.05em;
	}

	.summary-text {
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 240px;
		overflow-y: auto;
		font-size: 12px;
		line-height: 1.45;
		padding: 4px 8px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		user-select: text;
	}
</style>
