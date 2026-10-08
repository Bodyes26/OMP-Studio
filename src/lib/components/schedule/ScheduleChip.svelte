<script lang="ts">
	/**
	 * Chip «orologio» di un task programmato: «Al reset · Anthropic · 14:05
	 * tra 1h 12m», «Non prima delle 19:00», «Pronto: reset avvenuto». Testo
	 * neutro e conto alla rovescia tabulare: e' un'informazione, non un allarme.
	 */
	import type { StudioTask } from '$lib/stores/tasks.svelte';
	import { scheduleStore } from '$lib/stores/schedule.svelte';
	import { IconSchedule } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let { task }: { task: Pick<StudioTask, 'options' | 'schedule' | 'resume'> } = $props();

	const label = $derived(scheduleStore.labelFor(task));
</script>

{#if label}
	<Tooltip text={label.tooltip} placement="top" offset={6}>
		<span class="schedule-chip" class:ready={label.ready} class:missed={task.schedule?.missed}>
			<IconSchedule aria-hidden="true" />
			<span class="text">{label.text}</span>
			{#if label.countdown}<span class="countdown">{label.countdown}</span>{/if}
			<span class="sr-only">{label.tooltip}</span>
		</span>
	</Tooltip>
{/if}

<style>
	.schedule-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		min-width: 0;
		padding: 1px 5px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		line-height: 1.3;
		white-space: nowrap;
		--icon-size: 11px;
	}

	.text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.countdown {
		color: var(--ink-faint);
	}

	.schedule-chip.ready {
		color: var(--ink);
	}

	.schedule-chip.missed {
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
