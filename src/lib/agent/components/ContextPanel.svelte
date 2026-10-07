<script lang="ts">
	/**
	 * Pannello della finestra di contesto. Con il rapporto di `/context` mostra
	 * la stessa ripartizione di omp; senza, solo il totale di `get_state`.
	 */
	import type { ModelInfo, ContextUsage } from '$lib/agent/wire';
	import {
		applyDraftToContextReserve,
		categoryTokenSum,
		reportMatchesUsage,
		resolveContextWindow,
		type ContextReport
	} from '$lib/agent/contextReport';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	let {
		model = null,
		contextUsage = null,
		report = null,
		draftTokens = 0,
		sessionCost = null,
		subagentCost = 0,
		onCompact
	} = $props<{
		model?: ModelInfo | null;
		contextUsage?: ContextUsage | null;
		report?: ContextReport | null;
		draftTokens?: number;
		sessionCost?: number | null;
		subagentCost?: number;
		onCompact: () => void;
	}>();

	const fresh = $derived(reportMatchesUsage(report, contextUsage) ? report : null);
	const maxCtx = $derived(resolveContextWindow(fresh ?? contextUsage, model?.contextWindow));
	const accounted = $derived(fresh ? categoryTokenSum(fresh) : contextUsage?.tokens || 0);
	const totalUsed = $derived(accounted + draftTokens);
	const pct = $derived(maxCtx > 0 ? Math.min(100, Math.round((totalUsed / maxCtx) * 100)) : 0);

	const hasCost = $derived(sessionCost !== null || subagentCost > 0);
	const totalCost = $derived((sessionCost ?? 0) + subagentCost);

	const rows = $derived.by(() => {
		const list: { id: string; fallback: string; tokens: number }[] = [];
		if (fresh) {
			const known = ['systemPrompt', 'systemTools', 'systemContext', 'skills', 'messages'];
			for (const id of known) {
				const category = fresh.categories.find((row) => row.id === id);
				list.push({ id, fallback: category?.label ?? '', tokens: category?.tokens ?? 0 });
			}
			for (const category of fresh.categories) {
				if (known.includes(category.id) || category.tokens <= 0) continue;
				list.push({ id: category.id, fallback: category.label, tokens: category.tokens });
			}
		} else {
			list.push({
				id: 'used',
				fallback: '',
				tokens: contextUsage?.tokens || 0
			});
		}
		if (draftTokens > 0) {
			list.push({ id: 'draft', fallback: '', tokens: draftTokens });
		}
		const reserve = fresh
			? applyDraftToContextReserve(fresh.freeTokens, fresh.autoCompactBufferTokens, draftTokens)
			: { free: Math.max(0, maxCtx - totalUsed), buffer: 0 };
		if (reserve.buffer > 0) {
			list.push({ id: 'autoCompact', fallback: '', tokens: reserve.buffer });
		}
		list.push({ id: 'free', fallback: '', tokens: reserve.free });
		return list;
	});

	const segments = $derived.by(() => {
		const filled = rows.filter((row) => row.id !== 'free' && row.tokens > 0);
		const sum = filled.reduce((total, row) => total + row.tokens, 0);
		const scale = maxCtx > 0 && sum > maxCtx ? maxCtx / sum : 1;
		return filled.map((row) => ({
			id: row.id,
			width: maxCtx > 0 ? (row.tokens / maxCtx) * scale * 100 : 0
		}));
	});

	function categoryLabel(id: string, fallback: string): string {
		switch (id) {
			case 'systemPrompt':
				return m.chat_v2_composer_context_system_prompt();
			case 'systemTools':
				return m.chat_v2_composer_context_system_tools();
			case 'systemContext':
				return m.chat_v2_composer_context_system_context();
			case 'skills':
				return m.chat_v2_composer_context_skills();
			case 'messages':
				return m.chat_v2_composer_context_messages();
			case 'autoCompact':
				return m.chat_v2_composer_context_buffer();
			case 'draft':
				return m.chat_v2_composer_context_draft();
			case 'free':
				return m.chat_v2_composer_context_free();
			case 'used':
				return m.chat_v2_composer_context_used();
			default:
				return fallback || m.chat_v2_composer_context_used();
		}
	}
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

		{#if hasCost && totalCost > 0}
			<div class="session-cost-row">
				<div class="cost-headline">
					<span class="cost-label">{m.chat_v2_composer_context_cost_label()}</span>
					<span class="cost-value font-mono">${totalCost.toFixed(4)}</span>
				</div>
				{#if subagentCost > 0}
					<div class="cost-split font-mono">
						{m.chat_session_cost_split({
							own: `$${(sessionCost ?? 0).toFixed(4)}`,
							subagents: `$${subagentCost.toFixed(4)}`
						})}
					</div>
				{/if}
			</div>
		{/if}

		<div class="meter-track" aria-hidden="true">
			{#each segments as segment (segment.id)}
				<span class="meter-segment {segment.id}" style="width: {segment.width}%;"></span>
			{/each}
		</div>

		<div class="breakdown-list">
			{#each rows as row (row.id)}
				<div class="breakdown-row">
					<span class="dot {row.id}"></span>
					<span class="label">{categoryLabel(row.id, row.fallback)}</span>
					<span class="value">{formatTokens(row.tokens)}</span>
				</div>
			{/each}
		</div>

		{#if fresh && fresh.notes.length > 0}
			<p class="notes">{fresh.notes.join('\n')}</p>
		{/if}

		<p class="auto-compact-hint">
			{m.chat_v2_composer_context_auto_compact()}
		</p>

		<button type="button" class="compact-btn" onclick={onCompact}>
			{m.chat_v2_composer_context_compact_now()} <span class="cmd-pill">/compact</span>
		</button>
	</div>
</div>

<style>
	.session-cost-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--line);
	}
	.cost-headline {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.cost-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-weight: 500;
	}
	.cost-value {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}
	.cost-split {
		font-size: var(--text-meta);
		color: var(--ink-muted);
	}
	.context-panel {
		display: flex;
		flex-direction: column;
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

	.meter-segment.systemPrompt,
	.dot.systemPrompt,
	.meter-segment.used,
	.dot.used,
	.meter-segment.messages,
	.dot.messages {
		background: oklch(0.68 0.16 230);
	}

	.meter-segment.systemTools,
	.dot.systemTools {
		background: var(--warn);
	}

	.meter-segment.systemContext,
	.dot.systemContext {
		background: oklch(0.68 0.12 300);
	}

	.meter-segment.skills,
	.dot.skills {
		background: var(--success);
	}

	.meter-segment.draft,
	.dot.draft {
		background: oklch(0.72 0.16 55);
	}

	.meter-segment.autoCompact,
	.dot.autoCompact {
		background: color-mix(in srgb, var(--warn) 45%, var(--line));
	}

	.meter-segment.other,
	.dot.other {
		background: var(--ink-faint);
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

	.dot.free {
		background: var(--line);
	}

	.label {
		color: var(--ink-muted);
		flex: 1;
		min-width: 0;
	}

	.value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.notes,
	.auto-compact-hint {
		font-size: 11px;
		line-height: 1.35;
		color: var(--ink-faint);
		margin: 2px 0 0;
	}

	.notes {
		white-space: pre-line;
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
