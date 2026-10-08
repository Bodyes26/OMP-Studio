<script lang="ts">
	/**
	 * Reset (o orario) passato mentre Studio era chiuso: i task programmati non
	 * partono in blocco all'apertura, mai, nemmeno con l'auto-avvio acceso.
	 * L'utente sceglie: «Avvia ora» li rimette nel percorso dell'auto-avvio
	 * (uno alla volta, con lock e corsie come sempre), «Lasciali in coda»
	 * toglie la programmazione e li lascia come task normali.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { missedTasks } from '$lib/quota/scheduleQueue';
	import StatusMark from '$lib/ui/StatusMark.svelte';

	let { tasks, compact = false }: { tasks: StudioTask[]; compact?: boolean } = $props();

	const missed = $derived(missedTasks(tasks));
</script>

{#if missed.length > 0}
	<div class="missed-banner" class:compact role="status">
		<p class="text">
			<StatusMark status="attention" active={false} />
			<span>{m.schedule_missed_banner({ count: missed.length })}</span>
		</p>
		<div class="actions">
			<button
				type="button"
				class="ui-button ui-button-primary"
				onclick={() => taskStore.setScheduleMissed(missed.map((task) => task.id), false)}
			>
				{m.schedule_missed_run()}
			</button>
			<button
				type="button"
				class="ui-button ui-button-ghost"
				onclick={() => taskStore.clearSchedules(missed.map((task) => task.id))}
			>
				{m.schedule_missed_keep()}
			</button>
		</div>
	</div>
{/if}

<style>
	.missed-banner {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-1) 0 var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.missed-banner.compact {
		margin: 0;
		font-size: var(--text-xs);
	}

	.text {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
</style>
