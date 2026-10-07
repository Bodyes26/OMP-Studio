<script lang="ts">
	/**
	 * GoalTray.svelte — Sezione vassoio per l'obiettivo (Goal) attivo della sessione.
	 * Mostra l'obiettivo bloccato a due righe, il badge di stato, i token,
	 * il tempo trascorso e i controlli Pausa / Riprendi / Elimina con conferma inline.
	 */
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconTarget,
		IconPause,
		IconPlay,
		IconTrash,
		IconCheck,
		IconClose
	} from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { formatTrayDuration } from '../subagentActivity';
	import { m } from '$lib/paraglide/messages.js';
	import type { Goal } from '../wire';

	let {
		goal,
		onPause,
		onResume,
		onDrop
	} = $props<{
		goal: Goal;
		onPause?: () => void;
		onResume?: () => void;
		onDrop?: () => void;
	}>();

	let confirmingDrop = $state(false);

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

	const tokensLabel = $derived.by(() => {
		if (goal.tokenBudget !== undefined && goal.tokenBudget > 0) {
			return m.chat_v2_tray_goal_tokens_budget({
				used: formatTokens(goal.tokensUsed),
				budget: formatTokens(goal.tokenBudget)
			});
		}
		return m.chat_v2_tray_goal_tokens({
			used: formatTokens(goal.tokensUsed)
		});
	});

	const durationLabel = $derived.by(() => {
		const formatted = formatTrayDuration(goal.timeUsedSeconds * 1000);
		return m.chat_v2_tray_goal_elapsed({
			time: formatted || '0s'
		});
	});

	function handleDropConfirm() {
		confirmingDrop = false;
		onDrop?.();
	}

	function handleDropCancel() {
		confirmingDrop = false;
	}
</script>

<section class="tray-section goal-tray-section" aria-label={m.chat_v2_tray_goal_title()}>
	<div class="goal-tray-content">
		<div class="goal-main-row">
			<div class="goal-header-left">
				<span class="goal-icon" aria-hidden="true"><IconTarget /></span>
				<span class="goal-title">{m.chat_v2_tray_goal_title()}</span>
				<span
					class="goal-status-badge"
					class:active={goal.status === 'active'}
					class:paused={goal.status === 'paused'}
					class:budget={goal.status === 'budget-limited'}
					class:complete={goal.status === 'complete'}
				>
					{statusLabel}
				</span>
			</div>

			<div class="goal-meta">
				<span class="goal-tokens font-mono">{tokensLabel}</span>
				<span class="goal-sep" aria-hidden="true">·</span>
				<span class="goal-duration font-mono">{durationLabel}</span>
			</div>

			<div class="goal-actions">
				{#if confirmingDrop}
					<div class="goal-confirm-inline" role="alert">
						<span class="confirm-prompt">{m.chat_v2_tray_goal_drop_confirm()}</span>
						<button
							type="button"
							class="goal-btn confirm-yes"
							onclick={handleDropConfirm}
							title={m.chat_v2_tray_goal_drop_confirm_yes()}
							aria-label={m.chat_v2_tray_goal_drop_confirm_yes()}
						>
							<IconCheck />
							<span>{m.chat_v2_tray_goal_drop_confirm_yes()}</span>
						</button>
						<button
							type="button"
							class="goal-btn confirm-no"
							onclick={handleDropCancel}
							title={m.chat_v2_tray_goal_drop_confirm_no()}
							aria-label={m.chat_v2_tray_goal_drop_confirm_no()}
						>
							<IconClose />
							<span>{m.chat_v2_tray_goal_drop_confirm_no()}</span>
						</button>
					</div>
				{:else}
					{#if goal.status === 'active'}
						<button
							type="button"
							class="goal-btn action-pause"
							onclick={() => onPause?.()}
							title={m.chat_v2_tray_goal_action_pause()}
						>
							<span class="action-icon"><IconPause /></span>
							<span>{m.chat_v2_tray_goal_action_pause()}</span>
						</button>
					{:else if goal.status === 'paused' || goal.status === 'budget-limited'}
						<button
							type="button"
							class="goal-btn action-resume"
							onclick={() => onResume?.()}
							title={m.chat_v2_tray_goal_action_resume()}
						>
							<span class="action-icon"><IconPlay /></span>
							<span>{m.chat_v2_tray_goal_action_resume()}</span>
						</button>
					{/if}

					<button
						type="button"
						class="goal-btn action-drop"
						onclick={() => (confirmingDrop = true)}
						title={m.chat_v2_tray_goal_action_drop()}
						aria-label={m.chat_v2_tray_goal_action_drop()}
					>
						<span class="action-icon"><IconTrash /></span>
						<span>{m.chat_v2_tray_goal_action_drop()}</span>
					</button>
				{/if}
			</div>
		</div>

		<Tooltip text={goal.objective} placement="top" offset={6}>
			<div class="goal-objective">
				{goal.objective}
			</div>
		</Tooltip>
	</div>
</section>

<style>
	.goal-tray-section {
		border-bottom: 1px solid var(--line);
		background: color-mix(in oklch, var(--bg-raised) 70%, transparent);
	}

	.goal-tray-content {
		padding: var(--space-2, 8px) var(--space-3, 12px);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.goal-main-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2, 8px);
		flex-wrap: wrap;
	}

	.goal-header-left {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.goal-icon {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
		--icon-size: 15px;
	}

	.goal-title {
		font-size: var(--text-sm, 13px);
		font-weight: 600;
		color: var(--ink);
	}

	.goal-status-badge {
		font-size: 11px;
		font-weight: 500;
		padding: 1px 7px;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line);
		background: var(--bg-surface, rgba(255, 255, 255, 0.05));
		color: var(--ink-secondary);
	}

	.goal-status-badge.active {
		border-color: color-mix(in oklch, var(--success, #22c55e) 40%, transparent);
		background: color-mix(in oklch, var(--success, #22c55e) 12%, transparent);
		color: var(--success, #22c55e);
	}

	.goal-status-badge.paused {
		border-color: color-mix(in oklch, var(--warn, #eab308) 35%, transparent);
		background: color-mix(in oklch, var(--warn, #eab308) 10%, transparent);
		color: var(--warn, #eab308);
	}

	.goal-status-badge.budget {
		border-color: color-mix(in oklch, var(--warn, #eab308) 45%, transparent);
		background: color-mix(in oklch, var(--warn, #eab308) 15%, transparent);
		color: var(--warn, #eab308);
	}

	.goal-status-badge.complete {
		border-color: color-mix(in oklch, var(--ink) 25%, transparent);
		background: color-mix(in oklch, var(--ink) 10%, transparent);
		color: var(--ink);
	}

	.goal-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs, 12px);
		color: var(--ink-muted);
	}

	.goal-sep {
		opacity: 0.5;
	}

	.goal-objective {
		font-size: var(--text-xs, 12px);
		line-height: 1.4;
		color: var(--ink-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		cursor: default;
	}

	.goal-objective:focus-visible {
		outline: 1px solid var(--accent);
		border-radius: var(--radius-xs, 2px);
	}

	.goal-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}

	.goal-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		height: 24px;
		font-size: 11px;
		font-weight: 500;
		font-family: var(--font-ui);
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line);
		background: var(--bg-surface, rgba(255, 255, 255, 0.05));
		color: var(--ink);
		cursor: pointer;
		transition: background var(--dur-fast, 120ms) ease, border-color var(--dur-fast, 120ms) ease;
	}

	.goal-btn:hover {
		background: var(--bg-hover, rgba(255, 255, 255, 0.1));
		border-color: var(--line-strong, rgba(255, 255, 255, 0.15));
	}

	.goal-btn .action-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
	}

	.goal-btn.action-drop {
		color: var(--ink-muted);
	}

	.goal-btn.action-drop:hover {
		color: var(--danger, #ef4444);
		border-color: color-mix(in oklch, var(--danger, #ef4444) 30%, transparent);
		background: color-mix(in oklch, var(--danger, #ef4444) 10%, transparent);
	}

	.goal-confirm-inline {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}

	.confirm-prompt {
		color: var(--warn, #eab308);
		font-weight: 500;
	}

	.goal-btn.confirm-yes {
		background: color-mix(in oklch, var(--danger, #ef4444) 18%, transparent);
		border-color: var(--danger, #ef4444);
		color: var(--danger, #ef4444);
	}

	.goal-btn.confirm-yes:hover {
		background: color-mix(in oklch, var(--danger, #ef4444) 28%, transparent);
	}

	.goal-btn.confirm-no {
		color: var(--ink-muted);
	}
</style>
