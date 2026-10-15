<script lang="ts">
	/**
	 * Pannello della finestra di contesto e della prompt cache.
	 *
	 * Mostra il totale ancorato al provider (`get_state.contextUsage` + bozza),
	 * la valutazione pre-invio della prompt cache basata su osservazioni reali
	 * e TTL nominale stimato, lo stato del riscaldamento cache, la ripartizione
	 * dettagliata di `/context` (con indicazione esplicita quando la somma locale
	 * differisce dal totale del provider, o stato di caricamento/riprova) e
	 * l'azione manuale di compattazione con spiegazione del compromesso.
	 */
	import { untrack } from 'svelte';
	import type { ContextPanelSession } from '$lib/agent/contextPanelState';
	import type { CacheWarmingMode, CacheWarmingOutcome } from '$lib/agent/wire';
	import {
		applyDraftToContextReserve,
		categoryTokenSum,
		resolveContextWindow,
		type ContextReport
	} from '$lib/agent/contextReport';
	import { assessPromptCache, type PromptCacheReason } from '$lib/agent/promptCache';
	import { formatRelativeTime } from '$lib/agent/sessionModes';
	import { formatTokens } from '$lib/utils/format';
	import { IconFlame, IconRefresh, IconWarning } from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		session,
		draftTokens = 0,
		onCompact,
		cacheWarmingMode = 'off'
	} = $props<{
		session: ContextPanelSession;
		draftTokens?: number;
		onCompact: () => void;
		cacheWarmingMode?: CacheWarmingMode;
	}>();

	let now = $state(Date.now());

	// Aggiorna l'orologio relativo solo mentre il pannello e' montato e il documento e' visibile.
	$effect(() => {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		let intervalId: number | null = null;

		const stopTimer = () => {
			if (intervalId !== null) {
				window.clearInterval(intervalId);
				intervalId = null;
			}
		};

		const startTimer = () => {
			stopTimer();
			if (document.visibilityState === 'hidden') return;
			now = Date.now();
			intervalId = window.setInterval(() => {
				if (document.visibilityState === 'hidden') {
					stopTimer();
					return;
				}
				now = Date.now();
			}, 1000);
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				stopTimer();
			} else {
				startTimer();
			}
		};

		startTimer();
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			stopTimer();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	// Richiede il rapporto `/context` mentre il pannello e' aperto, indipendentemente
	// dal fatto che il trigger viva nella toolbar o nella riga di stato.
	$effect(() => {
		void session.isReady;
		void session.isAttached;
		void session.isStreaming;
		void session.isCompacting;
		void session.isContextBusy;
		void session.sessionId;
		void session.model?.id;
		void session.model?.provider;
		void session.contextUsage?.tokens;
		void session.contextUsage?.contextWindow;
		void session.availableCommands;
		void session.contextReportVersion;
		untrack(() => void session.refreshContextReport());
	});

	const model = $derived(session.model);
	const contextUsage = $derived(session.contextUsage);
	const report: ContextReport | null = $derived(session.currentContextReport ?? null);
	const reportStatus = $derived(session.contextReportStatus ?? 'idle');
	const isBusy = $derived(session.isContextBusy);
	const canInteract = $derived(session.isReady && session.isAttached && !isBusy);

	const maxCtx = $derived(resolveContextWindow(contextUsage ?? report, model?.contextWindow));
	const reportCategorySum = $derived(report ? categoryTokenSum(report) : 0);
	const providerTokens = $derived(
		typeof contextUsage?.tokens === 'number' ? contextUsage.tokens : reportCategorySum
	);
	const totalUsed = $derived(providerTokens + draftTokens);
	const pct = $derived(maxCtx > 0 ? Math.min(100, Math.round((totalUsed / maxCtx) * 100)) : 0);
	const categoriesAreEstimated = $derived(
		Boolean(report && typeof contextUsage?.tokens === 'number' && reportCategorySum !== contextUsage.tokens)
	);

	const modelLabel = $derived(model?.name || model?.id || m.chat_v2_composer_context_model_fallback());
	const providerLabel = $derived(model?.provider || '');

	const sessionCost = $derived(session.sessionCost);
	const subagentCost = $derived(session.subagentCost);
	const hasCost = $derived(sessionCost !== null || subagentCost > 0);
	const totalCost = $derived((sessionCost ?? 0) + subagentCost);

	const observation = $derived(session.promptCacheObservation ?? null);
	const contextChanged = $derived(Boolean(session.promptCacheContextChanged));
	const cacheWarmingInFlight = $derived(session.cacheWarmingInFlight);
	const cacheWarmingLast = $derived(session.cacheWarmingLast);
	const warmingMode = $derived(cacheWarmingMode);

	const cacheAssessment = $derived(
		assessPromptCache({
			model,
			observation,
			warming: cacheWarmingLast,
			contextChanged,
			now
		})
	);

	const observedIdentityLabel = $derived.by(() => {
		if (!observation) return '';
		const parts = [observation.model, observation.provider].filter(Boolean);
		return parts.join(' · ');
	});

	const rows = $derived.by(() => {
		const list: { id: string; fallback: string; tokens: number }[] = [];
		if (report) {
			const known = ['systemPrompt', 'systemTools', 'systemContext', 'skills', 'messages'];
			for (const id of known) {
				const category = report.categories.find((row) => row.id === id);
				list.push({ id, fallback: category?.label ?? '', tokens: category?.tokens ?? 0 });
			}
			for (const category of report.categories) {
				if (known.includes(category.id) || category.tokens <= 0) continue;
				list.push({ id: category.id, fallback: category.label, tokens: category.tokens });
			}
		} else {
			list.push({
				id: 'used',
				fallback: '',
				tokens: providerTokens
			});
		}
		if (draftTokens > 0) {
			list.push({ id: 'draft', fallback: '', tokens: draftTokens });
		}
		const reserve = report
			? applyDraftToContextReserve(report.freeTokens, report.autoCompactBufferTokens, draftTokens)
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
				return m.chat_v2_composer_context_used_provider();
			default:
				return fallback || m.chat_v2_composer_context_used();
		}
	}

	function cacheStateLabel(state: typeof cacheAssessment.state): string {
		switch (state) {
			case 'likely-valid':
				return m.chat_v2_composer_context_cache_state_likely_valid();
			case 'possibly-expired':
				return m.chat_v2_composer_context_cache_state_possibly_expired();
			case 'context-changed':
				return m.chat_v2_composer_context_cache_state_context_changed();
			case 'unknown':
				return m.chat_v2_composer_context_cache_state_unknown();
		}
	}

	function cacheReasonText(reason: PromptCacheReason): string {
		switch (reason) {
			case 'no-request':
				return m.chat_v2_composer_context_cache_reason_no_request();
			case 'no-cache-observed':
				return m.chat_v2_composer_context_cache_reason_no_cache_observed();
			case 'identity-unknown':
				return m.chat_v2_composer_context_cache_reason_identity_unknown();
			case 'lifetime-unknown':
				return m.chat_v2_composer_context_cache_reason_lifetime_unknown();
			case 'within-ttl':
				return m.chat_v2_composer_context_cache_reason_within_ttl();
			case 'warmed-within-ttl':
				return m.chat_v2_composer_context_cache_reason_warmed_within_ttl();
			case 'ttl-elapsed':
				return m.chat_v2_composer_context_cache_reason_ttl_elapsed();
			case 'warming-missed':
				return m.chat_v2_composer_context_cache_reason_warming_missed();
			case 'context-compacted':
				return m.chat_v2_composer_context_cache_reason_context_compacted();
			case 'model-changed':
				return m.chat_v2_composer_context_cache_reason_model_changed({
					observed: observedIdentityLabel || '—'
				});
			default:
				return String(reason);
		}
	}

	function formatRemainingTtl(remainingMs: number): string {
		const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
		if (totalSec < 60) return `~${totalSec}s`;
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		if (min < 60) {
			return sec > 0 ? `~${min}m ${String(sec).padStart(2, '0')}s` : `~${min}m`;
		}
		const hours = Math.floor(min / 60);
		const remMin = min % 60;
		return remMin > 0 ? `~${hours}h ${remMin}m` : `~${hours}h`;
	}

	function warmingModeLabel(mode: CacheWarmingMode): string {
		switch (mode) {
			case 'off':
				return m.chat_v2_composer_context_warming_mode_off();
			case 'streaming':
				return m.chat_v2_composer_context_warming_mode_streaming();
			case 'idle':
				return m.chat_v2_composer_context_warming_mode_idle();
		}
	}

	function warmingOutcomeLabel(outcome: CacheWarmingOutcome): string {
		switch (outcome) {
			case 'hit':
				return m.chat_v2_composer_modes_cache_outcome_hit();
			case 'miss':
				return m.chat_v2_composer_modes_cache_outcome_miss();
			case 'error':
				return m.chat_v2_composer_modes_cache_outcome_error();
			case 'aborted':
				return m.chat_v2_composer_modes_cache_outcome_aborted();
		}
	}

	function handleRetryReport() {
		if (!canInteract) return;
		void session.refreshContextReport(true);
	}
</script>

<div class="context-panel">
	<section class="panel-section top-section" aria-labelledby="ctx-panel-title">
		<div class="title-row">
			<h2 id="ctx-panel-title" class="section-heading">{m.chat_v2_composer_context_title()}</h2>
			<div class="model-identity">
				<span class="model-name">{modelLabel}</span>
				{#if providerLabel}
					<span class="model-sep" aria-hidden="true">·</span>
					<span class="model-provider">{providerLabel}</span>
				{/if}
			</div>
		</div>

		<div class="total-row">
			<span class="tokens-used">{formatTokens(totalUsed)}</span>
			<span class="tokens-total">
				{m.chat_v2_composer_context_of({ total: formatTokens(maxCtx), percent: String(pct) })}
			</span>
		</div>

		<div
			class="meter-track"
			role="img"
			aria-label={m.chat_v2_composer_context_meter_aria({
				used: formatTokens(totalUsed),
				total: formatTokens(maxCtx),
				percent: String(pct)
			})}
		>
			{#each segments as segment (segment.id)}
				<span class="meter-segment {segment.id}" style="width: {segment.width}%;"></span>
			{/each}
		</div>

		{#if hasCost && totalCost > 0}
			<div class="session-cost-row">
				<div class="cost-headline">
					<span class="meta-label">{m.chat_v2_composer_context_cost_label()}</span>
					<span class="cost-value">${totalCost.toFixed(4)}</span>
				</div>
				{#if subagentCost > 0}
					<div class="cost-split">
						{m.chat_session_cost_split({
							own: `$${(sessionCost ?? 0).toFixed(4)}`,
							subagents: `$${subagentCost.toFixed(4)}`
						})}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<section class="panel-section" aria-labelledby="ctx-cache-heading">
		<div class="section-header-row">
			<h3 id="ctx-cache-heading" class="section-heading">
				{m.chat_v2_composer_context_cache_heading()}
			</h3>
			<span
				class="cache-state-tag"
				class:warn={cacheAssessment.state === 'possibly-expired' || cacheAssessment.state === 'context-changed'}
				class:muted={cacheAssessment.state === 'unknown'}
			>
				{#if cacheAssessment.state === 'possibly-expired' || cacheAssessment.state === 'context-changed'}
					<span class="state-icon" aria-hidden="true"><IconWarning /></span>
				{/if}
				{cacheStateLabel(cacheAssessment.state)}
			</span>
		</div>

		<p class="section-note">{cacheReasonText(cacheAssessment.reason)}</p>

		{#if cacheAssessment.lastRequestAt !== null}
			<div class="kv-list">
				<div class="kv-row">
					<span class="kv-label">{m.chat_v2_composer_context_cache_last_request_label()}</span>
					<span class="kv-value">{formatRelativeTime(cacheAssessment.lastRequestAt, now)}</span>
				</div>
				{#if cacheAssessment.lastTouchAt !== null && cacheAssessment.lastTouchAt > cacheAssessment.lastRequestAt}
					<div class="kv-row">
						<span class="kv-label">{m.chat_v2_composer_context_cache_last_touch_label()}</span>
						<span class="kv-value">{formatRelativeTime(cacheAssessment.lastTouchAt, now)}</span>
					</div>
				{/if}
				<div class="kv-row">
					<span class="kv-label">{m.chat_v2_composer_context_cache_input_cached_label()}</span>
					<span class="kv-value">
						{m.chat_v2_composer_context_cache_input_cached_value({
							percent: String(cacheAssessment.cachedPercent ?? 0),
							cached: formatTokens(cacheAssessment.cachedTokens),
							input: formatTokens(cacheAssessment.inputTokens)
						})}
					</span>
				</div>
				{#if cacheAssessment.expiresAt !== null}
					<div class="kv-row">
						<span class="kv-label">{m.chat_v2_composer_context_cache_ttl_remaining_label()}</span>
						<span class="kv-value" class:warn-text={cacheAssessment.expiresAt <= now}>
							{#if cacheAssessment.expiresAt > now}
								{formatRemainingTtl(cacheAssessment.expiresAt - now)}
							{:else}
								{m.chat_v2_composer_context_cache_ttl_elapsed_value({
									ago: formatRelativeTime(cacheAssessment.expiresAt, now)
								})}
							{/if}
						</span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="warming-block">
			<div class="warming-header">
				<span class="warming-title">
					<span class="cache-icon" aria-hidden="true"><IconFlame /></span>
					<span>{m.chat_v2_composer_modes_cache_title()}</span>
				</span>
				<span class="warming-mode">
					{m.chat_v2_composer_context_warming_mode_label()}: {warmingModeLabel(warmingMode)}
				</span>
			</div>

			{#if cacheWarmingInFlight}
				<div class="cache-detail warming">
					{m.chat_v2_composer_modes_cache_in_flight({ phase: cacheWarmingInFlight.phase })}
				</div>
			{:else if cacheWarmingLast}
				{@const outcome = cacheWarmingLast.outcome}
				<div class="cache-detail">
					<span
						class="warming-outcome"
						class:miss={outcome === 'miss' || outcome === 'aborted'}
						class:err={outcome === 'error'}
					>
						{m.chat_v2_composer_modes_cache_last_outcome({
							outcome: warmingOutcomeLabel(outcome)
						})}
					</span>
					<span> · {formatRelativeTime(cacheWarmingLast.at, now)}</span>
					{#if cacheWarmingLast.cost !== undefined}
						<span class="mono-inline">
							· {m.chat_v2_composer_modes_cache_cost({ cost: `$${cacheWarmingLast.cost.toFixed(4)}` })}
						</span>
					{/if}
				</div>
				{#if cacheWarmingLast.warmingStopReason}
					<div class="cache-detail">
						{m.chat_v2_composer_modes_cache_stop_reason({ reason: cacheWarmingLast.warmingStopReason })}
					</div>
				{/if}
			{:else}
				<div class="cache-detail">{m.chat_v2_composer_context_warming_none_yet()}</div>
			{/if}

			<p class="schedule-note">{m.chat_v2_composer_context_warming_schedule_unavailable()}</p>
		</div>
	</section>

	<section class="panel-section" aria-labelledby="ctx-breakdown-heading">
		<div class="section-header-row">
			<h3 id="ctx-breakdown-heading" class="section-heading">
				{m.chat_v2_composer_context_breakdown_heading()}
			</h3>
			{#if categoriesAreEstimated}
				<span class="estimate-tag">
					{m.chat_v2_composer_context_breakdown_estimated_badge({
						tokens: formatTokens(reportCategorySum)
					})}
				</span>
			{/if}
		</div>

		{#if categoriesAreEstimated}
			<p class="section-note">
				{m.chat_v2_composer_context_breakdown_estimated_note({
					estimated: formatTokens(reportCategorySum),
					total: formatTokens(providerTokens)
				})}
			</p>
		{/if}

		<div class="breakdown-list">
			{#each rows as row (row.id)}
				<div class="breakdown-row">
					<span class="dot {row.id}" aria-hidden="true"></span>
					<span class="label">{categoryLabel(row.id, row.fallback)}</span>
					<span class="value">{formatTokens(row.tokens)}</span>
				</div>
			{/each}
		</div>

		{#if !report}
			<div class="report-status-row" role="status" aria-live="polite">
				{#if reportStatus === 'loading'}
					<StatusMark status="running" />
					<span class="status-copy">{m.chat_v2_composer_context_report_loading()}</span>
				{:else if isBusy}
					<span class="status-copy">{m.chat_v2_composer_context_report_busy()}</span>
				{:else if !session.isReady || !session.isAttached}
					<span class="status-copy">{m.chat_v2_composer_context_report_not_ready()}</span>
				{:else}
					<span class="status-copy" class:err-text={reportStatus === 'error'}>
						{reportStatus === 'error'
							? m.chat_v2_composer_context_report_error()
							: m.chat_v2_composer_context_report_unavailable()}
					</span>
					<button
						type="button"
						class="ui-button ui-button-secondary retry-btn"
						disabled={!canInteract}
						onclick={handleRetryReport}
					>
						<span class="retry-icon" aria-hidden="true"><IconRefresh /></span>
						<span>{m.chat_v2_composer_context_report_retry()}</span>
					</button>
				{/if}
			</div>
		{/if}

		{#if report && report.notes.length > 0}
			<p class="notes">{report.notes.join('\n')}</p>
		{/if}
	</section>

	<section class="panel-section" aria-labelledby="ctx-compact-heading">
		<h3 id="ctx-compact-heading" class="section-heading">
			{m.chat_v2_composer_context_compact_heading()}
		</h3>
		<p class="section-note">{m.chat_v2_composer_context_auto_compact()}</p>
		<p class="section-note">{m.chat_v2_composer_context_compact_tradeoff()}</p>

		<button
			type="button"
			class="compact-btn"
			disabled={!canInteract}
			onclick={onCompact}
		>
			<span>{m.chat_v2_composer_context_compact_now()}</span>
			<span class="cmd-pill">/compact</span>
		</button>
	</section>
</div>

<style>
	.context-panel {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: var(--space-3);
		border-top: 1px solid var(--line);
		min-width: 0;
	}

	.panel-section.top-section {
		border-top: none;
	}

	.title-row {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		min-width: 0;
	}

	.section-header-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
	}

	.section-heading {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		line-height: 1.35;
		color: var(--ink);
		text-wrap: balance;
	}

	.model-identity {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-wrap: wrap;
	}

	.model-name {
		font-family: var(--font-mono);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.model-provider,
	.model-sep {
		flex-shrink: 0;
	}

	.total-row {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-variant-numeric: tabular-nums;
	}

	.tokens-used {
		font-size: var(--text-lg);
		font-weight: 600;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.tokens-total {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.meter-track {
		display: flex;
		height: 6px;
		width: 100%;
		background: var(--bg-sunken);
		border-radius: var(--radius-full);
		overflow: hidden;
		margin: 2px 0;
	}

	.meter-segment {
		height: 100%;
	}

	.meter-segment.systemPrompt,
	.dot.systemPrompt,
	.meter-segment.used,
	.dot.used,
	.meter-segment.messages,
	.dot.messages {
		background: var(--brand-ink);
	}

	.meter-segment.systemTools,
	.dot.systemTools {
		background: var(--warn);
	}

	.meter-segment.systemContext,
	.dot.systemContext {
		background: color-mix(in oklab, var(--brand-ink) 55%, var(--ink-muted));
	}

	.meter-segment.skills,
	.dot.skills {
		background: var(--success);
	}

	.meter-segment.draft,
	.dot.draft {
		background: color-mix(in oklab, var(--warn) 70%, var(--brand-ink));
	}

	.meter-segment.autoCompact,
	.dot.autoCompact {
		background: color-mix(in srgb, var(--warn) 45%, var(--line));
	}

	.meter-segment.other,
	.dot.other {
		background: var(--ink-faint);
	}

	.session-cost-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: var(--space-1);
	}

	.cost-headline {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}

	.meta-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-weight: 500;
	}

	.cost-value {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.cost-split {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.cache-state-tag,
	.estimate-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		white-space: nowrap;
	}

	.cache-state-tag.warn {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 35%, var(--line));
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}

	.cache-state-tag.muted,
	.estimate-tag {
		color: var(--ink-muted);
	}

	.state-icon {
		display: inline-flex;
		--icon-size: 11px;
	}

	.section-note,
	.notes,
	.schedule-note {
		margin: 0;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.notes {
		white-space: pre-line;
		color: var(--ink-faint);
	}

	.schedule-note {
		color: var(--ink-faint);
	}

	.kv-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.kv-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-meta);
		min-width: 0;
	}

	.kv-label {
		color: var(--ink-muted);
		min-width: 0;
	}

	.kv-value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		text-align: right;
		flex-shrink: 0;
	}

	.kv-value.warn-text {
		color: var(--warn);
	}

	.warming-block {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding-top: 6px;
		border-top: 1px solid var(--line);
	}

	.warming-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-caption);
	}

	.warming-title {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-weight: 500;
		color: var(--ink-muted);
	}

	.cache-icon {
		display: inline-flex;
		color: var(--ink-faint);
		--icon-size: 12px;
	}

	.warming-mode {
		color: var(--ink-faint);
	}

	.cache-detail {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
	}

	.cache-detail.warming {
		color: var(--warn);
	}

	.warming-outcome {
		color: var(--ink);
		font-weight: 500;
	}

	.warming-outcome.miss {
		color: var(--warn);
	}

	.warming-outcome.err {
		color: var(--danger);
	}

	.mono-inline {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.breakdown-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.breakdown-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-meta);
		min-width: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.dot.free {
		background: var(--line-strong);
	}

	.label {
		color: var(--ink-muted);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		flex-shrink: 0;
	}

	.report-status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: 4px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.status-copy {
		flex: 1;
		min-width: 0;
		line-height: 1.35;
	}

	.status-copy.err-text {
		color: var(--danger);
	}

	.retry-btn {
		flex-shrink: 0;
		padding: 3px 8px;
		gap: 4px;
		--icon-size: 12px;
	}

	.retry-icon {
		display: inline-flex;
	}

	.compact-btn {
		margin-top: 2px;
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
		font-weight: 500;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out);
	}

	.compact-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.compact-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.cmd-pill {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}
</style>
