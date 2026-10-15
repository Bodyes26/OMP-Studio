<!--
  TurnFooter.svelte — Piè del turno dell'assistente con metadati e pulsante copia.
  Fedele a src/lib/agent/components/TurnFooter.svelte di Studio.
-->
<script lang="ts">
	import { t, getLanguage } from '../../i18n.ts';
	import { formatDurationSecs } from '../../chat/merge.ts';
	import type { TurnFooterData } from '../../chat/types.ts';
	import { IconCopy, IconCheck } from '../../icons.ts';

	let { data }: { data: TurnFooterData } = $props();

	let copied = $state(false);

	async function copyTurnText(): Promise<void> {
		if (!data.assistantText) return;
		try {
			await navigator.clipboard.writeText(data.assistantText);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			// Clipboard non accessibile
		}
	}

	const durationLabel = $derived.by(() => {
		if (!data.durationMs || data.durationMs <= 0) return null;
		return formatDurationSecs(data.durationMs, getLanguage());
	});

	const toolCallsLabel = $derived.by(() => {
		if (!data.toolCallsCount || data.toolCallsCount <= 0) return null;
		return data.toolCallsCount === 1
			? t('chatCallSingular')
			: t('chatCalls', { count: data.toolCallsCount });
	});
</script>

<div class="turn-footer rv-blur">
	{#if data.assistantText}
		<button
			type="button"
			class="copy-btn"
			onclick={copyTurnText}
			title={copied ? t('chatCopied') : t('chatCopyTurn')}
		>
			<span class="icon" aria-hidden="true">
				{#if copied}
					<IconCheck />
				{:else}
					<IconCopy />
				{/if}
			</span>
			<span>{copied ? t('chatCopied') : t('chatCopyTurn')}</span>
		</button>
	{/if}

	<div class="meta-row">
		{#if data.diff && (data.diff.added > 0 || data.diff.removed > 0)}
			<span class="diff-badge font-mono">
				{#if data.diff.added > 0}<span class="diff-add">+{data.diff.added}</span>{/if}
				{#if data.diff.removed > 0}<span class="diff-del">−{data.diff.removed}</span>{/if}
			</span>
		{/if}

		{#if toolCallsLabel}
			{#if data.diff && (data.diff.added > 0 || data.diff.removed > 0)}<span class="sep">·</span>{/if}
			<span class="meta-item">{toolCallsLabel}</span>
		{/if}

		{#if durationLabel}
			{#if toolCallsLabel || (data.diff && (data.diff.added > 0 || data.diff.removed > 0))}<span class="sep">·</span>{/if}
			<span class="meta-item">{durationLabel}</span>
		{/if}

		{#if data.model}
			{#if toolCallsLabel || durationLabel || (data.diff && (data.diff.added > 0 || data.diff.removed > 0))}<span class="sep">·</span>{/if}
			<span class="meta-item model">{data.model}</span>
		{/if}
	</div>
</div>

<style>
	.turn-footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.copy-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		--icon-size: 13px;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.copy-btn:hover {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.copy-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.copy-btn .icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.meta-row {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.sep {
		opacity: 0.5;
	}

	.diff-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.diff-add {
		color: var(--success);
	}

	.diff-del {
		color: var(--danger);
	}

	.meta-item.model {
		color: var(--ink-muted);
	}
</style>
