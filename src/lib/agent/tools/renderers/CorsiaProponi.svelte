<!--
	Card di `corsia_proponi`: l'agente chiede se spostare un'operazione
	rischiosa in un worktree. Non e' la domanda generica di `ask`: titolo
	fisso, il motivo dell'agente e due sole pillole. Il tool resta bloccato
	nel bridge finche' l'utente non clicca; dopo il clic la card mostra la
	scelta (anche quando il risultato del tool e' ormai arrivato).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconCheck, IconGitBranch, IconRefresh, IconWarning } from '$lib/icons';
	import { agentLanes } from '$lib/lanes/agentLanes.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
	import type { LaneId, ProjectId } from '$lib/types/lanes';
	import { asRecord, resultText, str, type ToolRenderProps } from '../types';

	let { args, result, running, toolCallId }: ToolRenderProps = $props();

	const motivo = $derived(str(args.motivo) ?? '');
	const obiettivo = $derived(str(args.obiettivo) ?? '');
	const pending = $derived(toolCallId ? agentLanes.proposals[toolCallId] : undefined);
	const resolved = $derived(toolCallId ? agentLanes.resolvedProposals[toolCallId] : undefined);
	const details = $derived(asRecord(result?.details) ?? {});

	// Dopo un riavvio la memoria delle scelte e' vuota: l'esito si rilegge dal risultato del tool.
	const choice = $derived<'main' | 'worktree' | null>(
		resolved?.choice ?? (str(details.scelta) === 'main' ? 'main' : str(details.scelta) === 'worktree' ? 'worktree' : null)
	);
	const createdLaneId = $derived(resolved?.laneId ?? str(details.corsia) ?? null);
	const createdTitle = $derived(resolved?.laneTitle ?? str(details.titolo) ?? createdLaneId ?? '');
	const errorText = $derived(resolved?.error ?? str(details.errore) ?? null);
	const projectId = $derived(str(details.progetto) ?? pending?.projectId ?? projectStore.activeId ?? null);
	// Con il risultato gia' arrivato (agente fermato, attesa scaduta) nessuno
	// ascolta piu' il clic: le pillole sparirebbero comunque al primo tentativo.
	const waiting = $derived(Boolean(pending) && !choice && !result);
	const busy = $derived(pending?.resolving === true);
	const closed = $derived(!waiting && !choice && (Boolean(result) || !running));

	function choose(value: 'main' | 'worktree') {
		if (!toolCallId || busy) return;
		void agentLanes.resolveProposal(toolCallId, value);
	}

	async function openLane() {
		if (!projectId || !createdLaneId) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		await laneOrchestrator.switchLane(projectId as ProjectId, createdLaneId as LaneId);
	}
</script>

<div
	class="proposal-card"
	class:is-waiting={waiting}
	role="group"
	aria-label={m.corsia_proposal_aria()}
>
	<div class="card-header">
		<span class="status-icon" aria-hidden="true"><IconWarning /></span>
		<span class="status-title">{m.corsia_proposal_title()}</span>
	</div>

	<div class="card-body">
		{#if motivo}
			<p class="reason">{motivo}</p>
		{/if}
		{#if obiettivo}
			<p class="goal"><span class="goal-label">{m.corsia_proposal_goal()}:</span> {obiettivo}</p>
		{/if}

		{#if waiting}
			<div class="pills">
				<button
					type="button"
					class="ui-button ui-button-secondary pill"
					disabled={busy}
					onclick={() => choose('main')}
				>
					{m.corsia_proposal_stay()}
				</button>
				<button
					type="button"
					class="ui-button ui-button-primary pill"
					disabled={busy}
					onclick={() => choose('worktree')}
				>
					{#if busy}<span class="spin" aria-hidden="true"><IconRefresh /></span>{:else}<IconGitBranch />{/if}
					{m.corsia_proposal_create()}
				</button>
			</div>
			<p class="hint" role="status">{m.corsia_proposal_waiting()}</p>
		{:else if choice === 'main'}
			<p class="chosen"><IconCheck />{m.corsia_proposal_chosen_main()}</p>
		{:else if choice === 'worktree' && errorText && !createdLaneId}
			<p class="chosen error"><IconWarning />{m.corsia_proposal_error({ error: errorText })}</p>
		{:else if choice === 'worktree'}
			<div class="chosen-row">
				<p class="chosen"><IconCheck />{m.corsia_proposal_chosen_worktree({ title: createdTitle })}</p>
				{#if createdLaneId && projectId}
					<button type="button" class="ui-button ui-button-secondary pill" onclick={() => void openLane()}>
						{m.corsia_card_open()}
					</button>
				{/if}
			</div>
			{#if errorText}
				<p class="hint">{errorText}</p>
			{/if}
		{:else if closed}
			<p class="hint">{result?.isError ? resultText(result) || m.corsia_proposal_closed() : m.corsia_proposal_closed()}</p>
		{/if}
	</div>
</div>

<style>
	.proposal-card {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		font-size: var(--text-trace);
		line-height: 1.5;
		margin: 6px 0;
		overflow: hidden;
	}

	/* In attesa: stesso anello ambra della corsia che chiede attenzione. */
	.proposal-card.is-waiting {
		box-shadow: inset 0 0 0 1.5px var(--warn);
		border-color: transparent;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
	}

	.status-icon {
		--icon-size: 14px;
		display: inline-flex;
		color: var(--warn);
	}

	.status-title {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
	}

	.card-body p {
		margin: 0;
	}

	.reason {
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.goal {
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.goal-label {
		color: var(--ink-muted);
		font-weight: 500;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.pill {
		--icon-size: 14px;
		gap: 6px;
		border-radius: var(--radius-full);
		padding-inline: 14px;
	}

	.hint {
		color: var(--ink-muted);
		font-size: var(--text-meta);
	}

	.chosen-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}

	.chosen {
		--icon-size: 14px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink);
	}

	.chosen :global(svg) {
		color: var(--success);
		flex-shrink: 0;
	}

	.chosen.error {
		color: var(--danger);
	}

	.chosen.error :global(svg) {
		color: var(--danger);
	}

	.spin {
		display: inline-flex;
		animation: proposal-spin 1s linear infinite;
	}

	@keyframes proposal-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
