<!--
  PlanHandoffCard.svelte (Gate R36).

  Card del passaggio di compito: «Da» (pianificazione) → «A» (nuova sessione,
  corsia o stessa sessione) e i passi che Studio esegue uno dopo l'altro.
  Finito il passaggio, con la strada nuova sessione o corsia, offre il ritorno
  alla sessione di pianificazione.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconArrowLeft, IconArrowRight, IconCheck } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import type { PlanController, PlanHandoffState } from '../planController.svelte';
	import type { PlanHandoffStepId } from '../planMode';

	let { plan, card } = $props<{ plan: PlanController; card: PlanHandoffState }>();

	const statusLabel = $derived(
		card.status === 'done'
			? m.plan_handoff_done()
			: card.status === 'failed'
				? m.plan_handoff_failed_badge()
				: m.plan_handoff_running()
	);

	const toKind = $derived.by(() => {
		switch (card.mode) {
			case 'fresh':
				return m.plan_handoff_to_fresh();
			case 'lane':
				return m.plan_handoff_to_lane();
			case 'compact':
				return m.plan_handoff_to_compact();
			default:
				return m.plan_handoff_to_keep();
		}
	});

	function stepLabel(id: PlanHandoffStepId): string {
		switch (id) {
			case 'save':
				return m.plan_step_save();
			case 'exit':
				return m.plan_step_exit();
			case 'new-session':
				return m.plan_step_new_session();
			case 'compact':
				return m.plan_step_compact();
			case 'create-lane':
				return m.plan_step_create_lane();
			case 'start-lane':
				return m.plan_step_start_lane();
			case 'role':
				return m.plan_step_role({ role: card.role });
			case 'deliver':
				return m.plan_step_deliver();
		}
	}

	const canReturn = $derived(
		card.status === 'done' && (card.mode === 'fresh' || card.mode === 'lane') && Boolean(card.planningSessionId)
	);
</script>

<article class="handoff" aria-label={m.plan_handoff_title()}>
	<div class="ho-title">
		<span class="ho-arrow-icon" aria-hidden="true"><IconArrowRight /></span>
		<b>{m.plan_handoff_title()}</b>
		<span class="plan-badge" class:ok={card.status === 'done'} class:live={card.status === 'running'} class:err={card.status === 'failed'}>
			{statusLabel}
		</span>
	</div>
	<div class="ho-top">
		<div class="ho-box">
			<div class="ho-k">{m.plan_handoff_from()}</div>
			<div class="ho-v">{m.plan_handoff_from_title()}</div>
			<div class="ho-m font-mono">
				{[card.fromModel, 'plan', card.fromTokens ? `${formatTokens(card.fromTokens)} token` : null]
					.filter(Boolean)
					.join(' · ')}
			</div>
		</div>
		<div class="ho-arrow" aria-hidden="true"><IconArrowRight /></div>
		<div class="ho-box">
			<div class="ho-k">{toKind}</div>
			<div class="ho-v">{card.toTitle}</div>
			<div class="ho-m font-mono">{[card.toModel, card.role].filter(Boolean).join(' · ')}</div>
		</div>
	</div>
	<ol class="ho-steps">
		{#each card.steps as step (step.id)}
			<li class="ho-step {step.state}">
				<span class="ho-st" aria-hidden="true">
					{#if step.state === 'done'}<IconCheck />{/if}
				</span>
				{stepLabel(step.id)}
				{#if step.detail}<span class="ho-det font-mono">{step.detail}</span>{/if}
			</li>
		{/each}
	</ol>
	{#if card.error}
		<p class="ho-error">{card.error}</p>
	{/if}
	{#if canReturn}
		<button type="button" class="ui-button ui-button-secondary ho-back" onclick={() => plan.returnToPlanning(card.id)}>
			<IconArrowLeft aria-hidden="true" />
			{m.plan_handoff_back()}
		</button>
	{/if}
</article>

<style>
	.handoff {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-2xl);
		padding: 14px 16px;
		min-width: 0;
	}
	.ho-title {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--ink);
		font-size: var(--text-base);
	}
	.ho-arrow-icon {
		display: inline-flex;
		color: var(--ink-muted);
	}
	.ho-top {
		display: flex;
		align-items: stretch;
		gap: 10px;
		margin: 8px 0 14px;
	}
	.ho-box {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: 10px 12px;
		background: var(--bg-base);
	}
	.ho-k {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
	.ho-v {
		font-size: var(--text-base);
		font-weight: 600;
		margin-top: 2px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ho-m {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		margin-top: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ho-arrow {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		--icon-size: 18px;
	}
	.ho-steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ho-step {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: var(--text-base);
		padding: 5px 2px;
		color: var(--ink-faint);
	}
	.ho-st {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		display: grid;
		place-items: center;
		flex: none;
		--icon-size: 10px;
	}
	.ho-step.done,
	.ho-step.running {
		color: var(--ink);
	}
	.ho-step.done .ho-st {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg-raised);
	}
	.ho-step.running .ho-st {
		border-top-color: var(--ink);
		animation: ho-spin 0.9s linear infinite;
	}
	.ho-step.failed {
		color: var(--danger);
	}
	.ho-step.failed .ho-st {
		border-color: var(--danger);
	}
	.ho-det {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 50%;
	}
	.ho-error {
		margin: 8px 0 0;
		font-size: var(--text-sm);
		color: var(--danger);
	}
	.ho-back {
		margin-top: 10px;
		--icon-size: 12px;
	}
	.plan-badge {
		font-size: 10.5px;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line-strong);
		color: var(--ink-muted);
	}
	.plan-badge.live {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 45%, transparent);
	}
	.plan-badge.ok {
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 40%, transparent);
	}
	.plan-badge.err {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	@keyframes ho-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ho-step.running .ho-st {
			animation: none;
		}
	}
</style>
