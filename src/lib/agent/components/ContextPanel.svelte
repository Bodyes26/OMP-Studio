<script lang="ts">
	/**
	 * Pannello dettagliato della finestra di contesto del modello attivo.
	 */
	import type { ModelInfo, ContextUsage } from '$lib/agent/wire';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	let {
		model = null,
		contextUsage = null,
		draftTokens = 0,
		onCompact
	} = $props<{
		model?: ModelInfo | null;
		contextUsage?: ContextUsage | null;
		draftTokens?: number;
		onCompact: () => void;
	}>();

	const maxCtx = $derived(model?.contextWindow || 128_000);
	const convTokens = $derived(contextUsage?.tokens || 0);
	const totalUsed = $derived(convTokens + draftTokens);
	const pct = $derived(Math.min(100, Math.round((totalUsed / maxCtx) * 100)));
	const convPct = $derived(Math.min(100, (convTokens / maxCtx) * 100));
	const draftPct = $derived(Math.min(100 - convPct, (draftTokens / maxCtx) * 100));
	const freeTokens = $derived(Math.max(0, maxCtx - totalUsed));
</script>

<div class="context-panel">
	<div class="panel-header">
		<span>{m.chat_v2_composer_context_title()}</span>
	</div>

	<div class="panel-body">
		<div class="total-row">
			<span class="tokens-used">{formatTokens(totalUsed)}</span>
			<span class="tokens-total">
				{m.chat_v2_composer_context_of({ total: formatTokens(maxCtx), percent: String(pct) })}
			</span>
		</div>

		<div class="model-name">
			{model?.name || model?.id || 'Modello attivo'}
		</div>

		<!-- Barra segmentata -->
		<div class="meter-track" aria-hidden="true">
			<span class="meter-segment conv" style="width: {convPct}%;"></span>
			<span class="meter-segment draft" style="width: {draftPct}%;"></span>
		</div>

		<!-- Dettaglio delle sezioni -->
		<div class="breakdown-list">
			<div class="breakdown-row">
				<span class="dot conv"></span>
				<span class="label">{m.chat_v2_composer_context_conversation()}</span>
				<span class="value">{formatTokens(convTokens)}</span>
			</div>
			<div class="breakdown-row">
				<span class="dot draft"></span>
				<span class="label">{m.chat_v2_composer_context_draft()}</span>
				<span class="value">{formatTokens(draftTokens)}</span>
			</div>
			<div class="breakdown-row">
				<span class="dot free"></span>
				<span class="label">{m.chat_v2_composer_context_free()}</span>
				<span class="value">{formatTokens(freeTokens)}</span>
			</div>
		</div>

		<p class="auto-compact-hint">
			{m.chat_v2_composer_context_auto_compact()}
		</p>

		<button type="button" class="compact-btn" onclick={onCompact}>
			{m.chat_v2_composer_context_compact_now()} <span class="cmd-pill">/compact</span>
		</button>
	</div>
</div>

<style>
	.context-panel {
		display: flex;
		flex-direction: column;
		width: 300px;
	}

	.panel-header {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
	}

	.panel-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.total-row {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.tokens-used {
		font-size: var(--text-lg);
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.tokens-total {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.model-name {
		font-size: 11.5px;
		color: var(--ink-faint);
	}

	.meter-track {
		display: flex;
		height: 6px;
		width: 100%;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin: 4px 0 2px;
	}

	.meter-segment {
		height: 100%;
		transition: width var(--dur-base) var(--ease-out);
	}

	.meter-segment.conv {
		background: oklch(0.68 0.16 230);
	}

	.meter-segment.draft {
		background: var(--warn);
	}

	.breakdown-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: var(--space-1);
	}

	.breakdown-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 11.5px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.dot.conv {
		background: oklch(0.68 0.16 230);
	}

	.dot.draft {
		background: var(--warn);
	}

	.dot.free {
		background: var(--line);
	}

	.label {
		color: var(--ink-muted);
		flex: 1;
	}

	.value {
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.auto-compact-hint {
		font-size: 11px;
		line-height: 1.35;
		color: var(--ink-faint);
		margin: 2px 0 0;
	}

	.compact-btn {
		margin-top: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		padding: 6px 12px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.compact-btn:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.cmd-pill {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-faint);
	}
</style>
