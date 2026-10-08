<script lang="ts">
	/**
	 * Striscia in cima alla chat durante la definizione dell'obiettivo: i cinque
	 * campi dell'intervista si spuntano man mano; un campo saltato o con un
	 * problema (criterio vago, tetto mancante) resta in giallo.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { IconCheck, IconWarning } from '$lib/icons';
	import { fieldStates, GOAL_FIELDS, type GoalFieldKey, type GoalInterview } from '../guidedGoal';

	let { interview } = $props<{ interview: GoalInterview }>();

	const states = $derived(fieldStates(interview));
	const done = $derived(
		interview.phase === 'asking' || interview.phase === 'idea' ? Math.min(interview.step, GOAL_FIELDS.length) : GOAL_FIELDS.length
	);

	function label(field: GoalFieldKey): string {
		switch (field) {
			case 'criteria':
				return m.guided_goal_strip_criteria();
			case 'verification':
				return m.guided_goal_strip_verification();
			case 'cap':
				return m.guided_goal_strip_cap();
			case 'boundaries':
				return m.guided_goal_strip_boundaries();
			case 'stop':
				return m.guided_goal_strip_stop();
		}
	}
</script>

<div class="ivstrip" role="status" aria-label={m.guided_goal_strip_title()}>
	<span class="iv-title">{m.guided_goal_strip_title()}</span>
	<ol class="iv-steps">
		{#each GOAL_FIELDS as field, i (field)}
			{@const state = states[field]}
			<li class="ivs {state}" title={interview.answers[field] ?? ''}>
				{#if state === 'done'}
					<span class="mark ok" aria-hidden="true"><IconCheck /></span>
				{:else if state === 'warn'}
					<span class="mark warn" aria-hidden="true"><IconWarning /></span>
				{:else}
					<span class="n" aria-hidden="true">{i + 1}</span>
				{/if}
				<span class="lbl">{label(field)}</span>
			</li>
		{/each}
	</ol>
	<span class="iv-count font-mono">{done}/{GOAL_FIELDS.length}</span>
</div>

<style>
	.ivstrip {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 8px var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		min-width: 0;
		overflow-x: auto;
	}
	.iv-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
	}
	.iv-steps {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
		min-width: 0;
	}
	.ivs {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}
	.ivs + .ivs::before {
		content: '';
		width: 18px;
		height: 1px;
		background: var(--line-strong);
		margin-right: 4px;
	}
	.ivs .n {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--line-strong);
		display: grid;
		place-items: center;
		font-size: 9.5px;
		font-family: var(--font-mono);
	}
	.mark {
		display: inline-flex;
		--icon-size: 12px;
	}
	.mark.ok {
		color: var(--success);
	}
	.mark.warn {
		color: var(--warn);
	}
	.ivs.done {
		color: var(--ink);
	}
	.ivs.warn {
		color: var(--warn);
	}
	.ivs.current {
		color: var(--ink);
		font-weight: 600;
	}
	.ivs.current .n {
		border-color: var(--brand);
		color: var(--brand-ink);
	}
	.iv-count {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}
</style>
