<!--
  PlanEntryView.svelte (Gate R3X-plan).

  Voce del Piano nel transcript: riga d'entrata/uscita, card del piano,
  card del passaggio di compito. Lo stato vive in `planCards`.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconLock, IconPlan } from '$lib/icons';
	import type { AgentSession, PlanEntry } from '../session.svelte';
	import { planCards } from '../planController.svelte';
	import PlanDocCard from './PlanDocCard.svelte';
	import PlanHandoffCard from './PlanHandoffCard.svelte';

	let { session, entry } = $props<{ session: AgentSession; entry: PlanEntry }>();

	const doc = $derived(entry.variant === 'doc' ? planCards.docs[entry.refId] : undefined);
	const handoff = $derived(entry.variant === 'handoff' ? planCards.handoffs[entry.refId] : undefined);
</script>

{#if entry.variant === 'enter'}
	<div class="plan-sysrow" role="status">
		<span class="plan-sysrow-icon" aria-hidden="true"><IconLock /></span>
		<span><b>{m.plan_mode_on_title()}</b> {m.plan_mode_on_desc()}</span>
	</div>
{:else if entry.variant === 'exit'}
	<div class="plan-sysrow muted" role="status">
		<span class="plan-sysrow-icon" aria-hidden="true"><IconPlan /></span>
		<span><b>{m.plan_mode_off_title()}</b> {m.plan_mode_off_desc()}</span>
	</div>
{:else if doc}
	<PlanDocCard plan={session.plan} {doc} />
{:else if handoff}
	<PlanHandoffCard plan={session.plan} card={handoff} />
{/if}

<style>
	.plan-sysrow {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		padding: 6px 10px;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-lg);
	}
	.plan-sysrow b {
		color: var(--ink);
		font-weight: 600;
	}
	.plan-sysrow-icon {
		display: inline-flex;
		color: var(--brand-ink);
		flex: none;
	}
	.plan-sysrow.muted .plan-sysrow-icon {
		color: var(--ink-faint);
	}
</style>
