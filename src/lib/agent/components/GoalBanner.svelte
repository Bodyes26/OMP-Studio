<script lang="ts">
	/**
	 * Banner fisso in cima alla chat per l'obiettivo della sessione (goal mode):
	 * titolo, stato, avanzamento dei tentativi contro il tetto, budget di token,
	 * tempo e Pausa / Riprendi / Stop. Vale per ogni obiettivo, creato con
	 * l'intervista, con `/goal` o dall'agente con lo strumento `goal`.
	 *
	 * Sostituisce il vecchio riquadro nel vassoio del composer: l'obiettivo non
	 * e' una cosa da fare adesso ma la cornice di tutta la sessione.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { IconTarget, IconPause, IconPlay, IconStop, IconCheck, IconClose, IconChevronDown, IconChevronUp } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { formatTrayDuration } from '../subagentActivity';
	import type { Goal } from '../wire';
	import { goalSection, goalTitle } from '../guidedGoal';
	import { lexMarkdownInline } from '../markdown';
	import MarkdownInline from './MarkdownInline.svelte';

	let {
		goal,
		attempts = 0,
		cap = null,
		busy = false,
		onPause,
		onResume,
		onDrop,
		onDismiss
	} = $props<{
		goal: Goal;
		attempts?: number;
		cap?: number | null;
		/** Un'operazione sul goal e' in volo: i pulsanti aspettano. */
		busy?: boolean;
		onPause?: () => void;
		onResume?: () => void;
		onDrop?: () => void;
		/** Solo per l'obiettivo completato: toglie il banner. */
		onDismiss?: () => void;
	}>();

	let confirmingStop = $state(false);
	let details = $state(false);

	const title = $derived(goalTitle(goal.objective));
	const criteria = $derived(goalSection(goal.objective, 'success criteria'));
	const verification = $derived(goalSection(goal.objective, 'verification'));
	const complete = $derived(goal.status === 'complete');
	const statusLabel = $derived.by(() => {
		switch (goal.status) {
			case 'active':
				return m.chat_v2_tray_goal_status_active();
			case 'paused':
				return m.chat_v2_tray_goal_status_paused();
			case 'budget-limited':
				return m.chat_v2_tray_goal_status_budget_limited();
			case 'complete':
				return m.chat_v2_tray_goal_status_complete();
			default:
				return goal.status;
		}
	});
	const budgetPct = $derived(
		goal.tokenBudget && goal.tokenBudget > 0 ? Math.min(100, (goal.tokensUsed / goal.tokenBudget) * 100) : null
	);
	const segments = $derived(cap && cap > 0 && cap <= 20 ? Array.from({ length: cap }, (_, i) => i) : []);
	const elapsed = $derived(formatTrayDuration(goal.timeUsedSeconds * 1000) || '0s');
</script>

<section
	class="gbanner"
	class:complete
	class:paused={goal.status === 'paused' || goal.status === 'budget-limited'}
	aria-label={m.chat_v2_tray_goal_title()}
>
	<div class="gb-row">
		<span class="gb-icon" aria-hidden="true">{#if complete}<IconCheck />{:else}<IconTarget />{/if}</span>
		<b class="gb-title" title={title}>{title}</b>
		<span
			class="gb-badge"
			class:live={goal.status === 'active'}
			class:ok={complete}
			class:warn={goal.status === 'paused' || goal.status === 'budget-limited'}>{statusLabel}</span
		>
		<span class="gb-sp"></span>
		{#if confirmingStop}
			<span class="gb-confirm" role="alert">{m.goal_banner_stop_confirm()}</span>
			<button type="button" class="gb-btn danger" disabled={busy} onclick={() => { confirmingStop = false; onDrop?.(); }}>
				<IconStop aria-hidden="true" /> {m.goal_banner_stop()}
			</button>
			<button type="button" class="gb-btn" onclick={() => (confirmingStop = false)}>{m.chat_v2_tray_goal_drop_confirm_no()}</button>
		{:else if complete}
			{#if onDismiss}
				<button type="button" class="gb-btn icon" aria-label={m.goal_banner_dismiss()} title={m.goal_banner_dismiss()} onclick={() => onDismiss?.()}>
					<IconClose aria-hidden="true" />
				</button>
			{/if}
		{:else}
			{#if goal.status === 'active'}
				<button type="button" class="gb-btn" disabled={busy} onclick={() => onPause?.()}>
					<IconPause aria-hidden="true" /> {m.chat_v2_tray_goal_action_pause()}
				</button>
			{:else}
				<button type="button" class="gb-btn" disabled={busy} onclick={() => onResume?.()}>
					<IconPlay aria-hidden="true" /> {m.chat_v2_tray_goal_action_resume()}
				</button>
			{/if}
			<button type="button" class="gb-btn" disabled={busy} onclick={() => (confirmingStop = true)}>
				<IconStop aria-hidden="true" /> {m.goal_banner_stop()}
			</button>
		{/if}
		<button
			type="button"
			class="gb-btn icon"
			aria-expanded={details}
			aria-label={details ? m.goal_banner_hide_details() : m.goal_banner_details()}
			title={details ? m.goal_banner_hide_details() : m.goal_banner_details()}
			onclick={() => (details = !details)}
		>
			{#if details}<IconChevronUp aria-hidden="true" />{:else}<IconChevronDown aria-hidden="true" />{/if}
		</button>
	</div>

	<div class="gb-stats">
		<div class="gstat">
			<span class="gs-k">{m.goal_banner_attempt()}</span>
			<b class="font-mono">{attempts}{#if cap}<span class="faint">/{cap}</span>{/if}</b>
		</div>
		{#if segments.length}
			<div class="gb-segs" aria-label={m.goal_banner_progress({ done: attempts, total: cap ?? 0 })}>
				{#each segments as i (i)}
					<i class:done={i < attempts - (goal.status === 'active' && !complete ? 1 : 0)} class:cur={goal.status === 'active' && i === attempts - 1}></i>
				{/each}
			</div>
		{/if}
		<div class="gstat grow">
			<span class="gs-k">
				{#if goal.tokenBudget}
					{m.chat_v2_tray_goal_tokens_budget({ used: formatTokens(goal.tokensUsed), budget: formatTokens(goal.tokenBudget) })}
				{:else}
					{m.chat_v2_tray_goal_tokens({ used: formatTokens(goal.tokensUsed) })}
				{/if}
			</span>
			{#if budgetPct !== null}
				<div class="bbar" class:hot={budgetPct >= 85}><i style:width="{budgetPct}%"></i></div>
			{/if}
		</div>
		<div class="gstat">
			<span class="gs-k">{m.goal_banner_time()}</span>
			<b class="font-mono">{elapsed}</b>
		</div>
	</div>

	{#if details}
		<div class="gb-details">
			{#if criteria.length}
				<div class="gk">{m.guided_goal_field_criteria()}</div>
				<ul>
					{#each criteria as item, i (i)}
						<li class:ok={complete}><MarkdownInline tokens={lexMarkdownInline(item)} /></li>
					{/each}
				</ul>
			{/if}
			{#if verification.length}
				<div class="gk">{m.guided_goal_field_verification()}</div>
				<ul>
					{#each verification as item, i (i)}
						<li><MarkdownInline tokens={lexMarkdownInline(item)} /></li>
					{/each}
				</ul>
			{/if}
			{#if !criteria.length && !verification.length}
				<p class="gb-objective">{goal.objective}</p>
			{/if}
		</div>
	{/if}
</section>

<style>
	.gbanner {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px var(--space-4);
		border-bottom: 1px solid color-mix(in oklab, var(--brand) 40%, var(--line));
		background: color-mix(in oklab, var(--brand) 6%, var(--bg-raised));
		min-width: 0;
		z-index: var(--z-sticky);
	}
	.gbanner.paused {
		border-bottom-color: color-mix(in oklab, var(--warn) 40%, var(--line));
		background: color-mix(in oklab, var(--warn) 5%, var(--bg-raised));
	}
	.gbanner.complete {
		border-bottom-color: color-mix(in oklab, var(--success) 45%, var(--line));
		background: color-mix(in oklab, var(--success) 6%, var(--bg-raised));
	}
	.gb-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.gb-icon {
		display: inline-flex;
		color: var(--brand-ink);
		--icon-size: 15px;
	}
	.gbanner.complete .gb-icon {
		color: var(--success);
	}
	.gb-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gb-badge {
		flex: none;
		font-size: var(--text-caption);
		font-weight: 500;
		padding: 1px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}
	.gb-badge.live {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 45%, transparent);
	}
	.gb-badge.warn {
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 45%, transparent);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
	}
	.gb-badge.ok {
		color: var(--success);
		border-color: color-mix(in oklab, var(--success) 45%, transparent);
	}
	.gb-sp {
		flex: 1;
	}
	.gb-confirm {
		font-size: var(--text-xs);
		color: var(--warn);
		font-weight: 500;
		white-space: nowrap;
	}
	.gb-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 9px;
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		color: var(--ink);
		cursor: pointer;
		--icon-size: 12px;
	}
	.gb-btn.icon {
		width: 24px;
		padding: 0;
		justify-content: center;
		color: var(--ink-muted);
	}
	.gb-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}
	.gb-btn.danger {
		color: var(--danger);
		border-color: color-mix(in oklab, var(--danger) 45%, transparent);
	}
	.gb-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.gb-stats {
		display: flex;
		align-items: flex-end;
		gap: var(--space-4);
		min-width: 0;
		flex-wrap: wrap;
	}
	.gstat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.gstat b {
		font-size: var(--text-sm);
		color: var(--ink);
	}
	.gstat.grow {
		flex: 1;
		min-width: 140px;
	}
	.gs-k {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
	}
	.faint {
		color: var(--ink-faint);
	}
	.gb-segs {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		padding-bottom: 4px;
	}
	.gb-segs i {
		display: block;
		width: 14px;
		height: 6px;
		border-radius: 2px;
		background: var(--line);
	}
	.gb-segs i.done {
		background: var(--brand);
	}
	.gb-segs i.cur {
		background: color-mix(in oklab, var(--brand) 55%, var(--line));
		animation: gb-pulse 1.6s ease-in-out infinite;
	}
	@keyframes gb-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.gb-segs i.cur {
			animation: none;
		}
	}
	.bbar {
		height: 5px;
		background: var(--line);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 4px;
	}
	.bbar i {
		display: block;
		height: 100%;
		background: var(--brand);
		transition: width 0.4s var(--ease-out);
	}
	.bbar.hot i {
		background: var(--warn);
	}
	.gb-details {
		border-top: 1px solid var(--line);
		padding-top: 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		max-height: 30vh;
		overflow-y: auto;
	}
	.gb-details ul {
		margin: 2px 0 6px;
		padding-left: 18px;
	}
	.gb-details li.ok {
		color: var(--ink);
	}
	.gk {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.gb-objective {
		margin: 0;
		white-space: pre-wrap;
	}
</style>
