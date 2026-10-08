<!--
	Card in chat dei tool `corsia_*` (tranne `corsia_proponi`, che ha la sua).
	Compatta: titolo per verbo, badge della corsia con l'icona del tipo
	(ramo per i worktree, beuta per i prototipi, come la LaneStrip), stato con
	gli stessi anelli della barra corsie e, dove serve, i pulsanti per aprire
	la corsia o la sua revisione. Legge solo `args` e `result.details`: nessun
	renderer lancia, un campo mancante e' una riga omessa.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		IconCheck,
		IconChevronDown,
		IconChevronRight,
		IconFile,
		IconGitBranch,
		IconLab,
		IconQueue,
		IconRefresh,
		IconWarning
	} from '$lib/icons';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
	import { agentLanes } from '$lib/lanes/agentLanes.svelte';
	import { corsiaVerboOf, type AgentLaneState } from '$lib/lanes/agentLaneRoutes';
	import type { LaneId, ProjectId } from '$lib/types/lanes';
	import { asRecord, num, recordList, resultText, str, strList, type ToolRenderProps } from '../types';

	let { name, args, result, running }: ToolRenderProps = $props();

	const verbo = $derived(corsiaVerboOf(name));
	const details = $derived(asRecord(result?.details) ?? {});
	const failed = $derived(result?.isError === true);
	const projectId = $derived(str(details.progetto) ?? projectStore.activeId ?? null);
	const laneId = $derived(str(details.corsia) ?? str(args.corsia) ?? null);
	const laneTitle = $derived(str(details.titolo) ?? laneId ?? '');
	const kind = $derived<'lab' | 'worktree'>(
		str(details.tipo) === 'lab' || verbo === 'consegna' || args.tipo === 'lab' ? 'lab' : 'worktree'
	);
	const outcome = $derived(str(details.stato) ?? str(details.esito) ?? str(details.kind) ?? null);

	let showMore = $state(false);

	const title = $derived.by(() => {
		switch (verbo) {
			case 'avvia':
				if (outcome === 'in_coda') return m.corsia_card_title_avvia_queued();
				if (outcome === 'consenso_utente') return m.corsia_card_title_avvia_consent();
				return m.corsia_card_title_avvia();
			case 'stato':
				return m.corsia_card_title_stato();
			case 'risultato':
				return m.corsia_card_title_risultato();
			case 'integra':
				return m.corsia_card_title_integra();
			case 'chiudi':
				return m.corsia_card_title_chiudi();
			case 'scarta':
				return outcome === 'conferma_utente' ? m.corsia_card_title_scarta_confirm() : m.corsia_card_title_scarta();
			case 'consegna':
				return m.corsia_card_title_consegna();
			case 'fatto':
				return m.corsia_card_title_fatto();
			default:
				return name;
		}
	});

	function stateLabel(state: string | undefined): string {
		switch (state as AgentLaneState | undefined) {
			case 'finita':
				return m.corsia_state_finita();
			case 'bloccata':
				return m.corsia_state_bloccata();
			case 'in_coda':
				return m.corsia_state_in_coda();
			case 'chiusa':
				return m.corsia_state_chiusa();
			default:
				return m.corsia_state_in_corso();
		}
	}

	const rows = $derived(recordList(details.corsie));
	const diffstat = $derived(asRecord(details.diffstat));
	const summary = $derived(str(details.riassunto) ?? (verbo === 'fatto' ? str(args.riassunto) : undefined));
	const conflictFiles = $derived(outcome === 'conflicts' ? strList(details.files) : []);
	const integratedFiles = $derived(outcome === 'integrated' ? strList(details.files) : []);
	const revision = $derived(asRecord(details.revisione));
	const packageText = $derived(verbo === 'consegna' && !failed ? resultText(result) : '');
	const errorText = $derived(failed ? resultText(result) : '');

	const canOpen = $derived(
		Boolean(projectId && laneId) &&
			!failed &&
			outcome !== 'scartata' &&
			outcome !== 'chiusa' &&
			outcome !== 'integrated' &&
			outcome !== 'already_integrated' &&
			(verbo === 'avvia' || verbo === 'risultato' || verbo === 'integra' || verbo === 'consegna')
	);
	const canReview = $derived(
		Boolean(projectId && laneId) &&
			kind === 'worktree' &&
			!failed &&
			(outcome === 'conflicts' || outcome === 'awaiting_confirm' || (verbo === 'risultato' && Boolean(diffstat)))
	);
	const canConfirmDelete = $derived(Boolean(projectId && laneId) && verbo === 'scarta' && outcome === 'conferma_utente');

	async function openLane() {
		if (!projectId || !laneId) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		await laneOrchestrator.switchLane(projectId as ProjectId, laneId as LaneId);
	}

	function openReview() {
		if (!projectId || !laneId) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		agentLanes.requestReview(projectId, laneId);
	}

	function confirmDelete() {
		if (!projectId || !laneId) return;
		if (projectStore.activeId !== projectId) projectStore.setActive(projectId);
		agentLanes.requestDelete(projectId, laneId);
	}
</script>

<div
	class="corsia-card"
	class:is-failed={failed}
	role="region"
	aria-label={m.corsia_card_aria({ title: laneTitle || title })}
>
	<div class="card-header">
		<span class="status-icon" aria-hidden="true">
			{#if running && !result}
				<span class="spin"><IconRefresh /></span>
			{:else if failed || outcome === 'conflicts' || outcome === 'conferma_utente'}
				<IconWarning />
			{:else if outcome === 'in_coda' || outcome === 'queued'}
				<IconQueue />
			{:else}
				<IconCheck />
			{/if}
		</span>
		<span class="status-title">{title}</span>
		{#if laneTitle && verbo !== 'stato'}
			<span class="badge" title={laneId ?? undefined}>
				{#if kind === 'lab'}<IconLab />{:else}<IconGitBranch />{/if}
				<span class="badge-text">{laneTitle}</span>
			</span>
		{/if}
	</div>

	<div class="card-body">
		{#if running && !result}
			<p class="muted">{m.corsia_card_running()}</p>
		{:else if failed}
			<p class="error-text">{errorText || m.corsia_card_failed()}</p>
		{:else if verbo === 'avvia'}
			{#if str(args.obiettivo)}
				<p class="goal">{str(args.obiettivo)}</p>
			{/if}
			<span class="state-badge" data-state={outcome === 'in_coda' ? 'in_coda' : 'in_corso'}>
				{stateLabel(outcome === 'in_coda' ? 'in_coda' : 'in_corso')}
			</span>
		{:else if verbo === 'stato'}
			{#if rows.length === 0}
				<p class="muted">{m.corsia_card_no_lanes()}</p>
			{:else}
				<ul class="lane-list" role="list">
					{#each rows as row (str(row.laneId))}
						{@const stat = asRecord(row.diffstat)}
						<li class="lane-row">
							<span class="row-icon" aria-hidden="true">
								{#if row.kind === 'lab'}<IconLab />{:else if row.kind === 'goal'}<IconQueue />{:else}<IconGitBranch />{/if}
							</span>
							<span class="row-title" title={str(row.laneId)}>{str(row.title) ?? str(row.laneId)}</span>
							<span class="state-badge" data-state={str(row.state)}>{stateLabel(str(row.state))}</span>
							{#if stat && (num(stat.files) ?? 0) > 0}
								<span class="row-diff">
									<span class="diff-add">+{num(stat.additions) ?? 0}</span>
									<span class="diff-del">−{num(stat.deletions) ?? 0}</span>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if verbo === 'risultato' || verbo === 'fatto'}
			{#if verbo === 'risultato'}
				<span class="state-badge" data-state={outcome ?? 'in_corso'}>{stateLabel(outcome ?? undefined)}</span>
			{/if}
			{#if summary}
				<p class="summary">{summary}</p>
			{:else}
				<p class="muted">{m.corsia_card_no_summary()}</p>
			{/if}
			{#if diffstat && (num(diffstat.files) ?? 0) > 0}
				<button type="button" class="toggle" onclick={() => (showMore = !showMore)}>
					{#if showMore}<IconChevronDown />{:else}<IconChevronRight />{/if}
					<span>{m.corsia_card_files({ count: num(diffstat.files) ?? 0 })}</span>
					<span class="diff-add">+{num(diffstat.additions) ?? 0}</span>
					<span class="diff-del">−{num(diffstat.deletions) ?? 0}</span>
				</button>
				{#if showMore}
					<ul class="file-list" role="list">
						{#each strList(diffstat.paths) as file (file)}
							<li><IconFile /><span>{file}</span></li>
						{/each}
					</ul>
				{/if}
			{/if}
			{#if revision && str(revision.sha)}
				<p class="meta">{m.corsia_card_revision({ sha: (str(revision.sha) ?? '').slice(0, 7) })} · {str(revision.message)}</p>
			{/if}
			{#if (num(details.erroriAnteprima) ?? 0) > 0}
				<p class="meta warn">{m.corsia_card_preview_errors({ count: num(details.erroriAnteprima) ?? 0 })}</p>
			{/if}
		{:else if verbo === 'integra'}
			{#if outcome === 'integrated' || outcome === 'already_integrated'}
				<p>
					{m.corsia_card_integra_integrated({ branch: str(details.targetBranch) ?? 'main' })}
					{#if str(details.commit)}<code>{(str(details.commit) ?? '').slice(0, 7)}</code>{/if}
				</p>
				{#if integratedFiles.length > 0}
					<p class="meta">{m.corsia_card_files({ count: integratedFiles.length })}</p>
				{/if}
			{:else if outcome === 'conflicts'}
				<p class="warn-text">{m.corsia_card_integra_conflicts({ count: conflictFiles.length })}</p>
				<ul class="file-list conflicts" role="list">
					{#each conflictFiles as file (file)}
						<li><IconFile /><span>{file}</span></li>
					{/each}
				</ul>
			{:else if outcome === 'queued'}
				<p class="muted">{m.corsia_card_integra_queued()}</p>
			{:else if outcome === 'awaiting_confirm'}
				<p class="warn-text">{m.corsia_card_integra_awaiting()}</p>
			{:else}
				<p class="muted">{m.corsia_card_integra_nothing()}</p>
			{/if}
		{:else if verbo === 'consegna'}
			{#if revision && str(revision.sha)}
				<p class="meta">{m.corsia_card_revision({ sha: (str(revision.sha) ?? '').slice(0, 7) })} · {str(revision.message)}</p>
			{/if}
			{#if packageText}
				<button type="button" class="toggle" onclick={() => (showMore = !showMore)}>
					{#if showMore}<IconChevronDown />{:else}<IconChevronRight />{/if}
					<span>{showMore ? m.corsia_card_hide_package() : m.corsia_card_show_package()}</span>
				</button>
				{#if showMore}
					<pre class="package">{packageText}</pre>
				{/if}
			{/if}
		{:else}
			<p class="muted">{resultText(result)}</p>
		{/if}

		{#if canOpen || canReview || canConfirmDelete}
			<div class="card-actions">
				{#if canConfirmDelete}
					<button type="button" class="ui-button ui-button-danger" onclick={confirmDelete}>
						{m.corsia_card_confirm_delete()}
					</button>
				{/if}
				{#if canReview}
					<button type="button" class="ui-button ui-button-primary" onclick={openReview}>
						{m.corsia_card_review()}
					</button>
				{/if}
				{#if canOpen}
					<button type="button" class="ui-button ui-button-secondary" onclick={() => void openLane()}>
						{m.corsia_card_open()}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.corsia-card {
		width: 100%;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		overflow: hidden;
		font-size: var(--text-trace);
		line-height: 1.5;
		margin: 6px 0;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		min-width: 0;
	}

	.status-icon {
		--icon-size: 14px;
		display: inline-flex;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--ink-muted);
	}

	.is-failed .status-icon {
		color: var(--danger);
	}

	.spin {
		display: inline-flex;
		animation: corsia-spin 1s linear infinite;
	}

	@keyframes corsia-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}

	.status-title {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		margin-left: auto;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-size: var(--text-caption);
	}

	.badge :global(svg) {
		--icon-size: 12px;
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	.badge-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 28ch;
	}

	.card-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px;
	}

	.card-body p {
		margin: 0;
	}

	.goal,
	.summary {
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.muted,
	.meta {
		color: var(--ink-muted);
	}

	.meta {
		font-size: var(--text-meta);
	}

	.warn,
	.warn-text {
		color: var(--warn);
	}

	.error-text {
		color: var(--danger);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* Stessi anelli della LaneStrip: ambra per "serve l'utente", neutro forte per "finita". */
	.state-badge {
		display: inline-flex;
		align-items: center;
		padding: 1px 8px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		color: var(--ink-muted);
		font-size: var(--text-caption);
		white-space: nowrap;
	}

	.state-badge[data-state='bloccata'] {
		color: var(--ink);
		box-shadow: inset 0 0 0 1.5px var(--warn);
	}

	.state-badge[data-state='finita'] {
		color: var(--ink);
		box-shadow: inset 0 0 0 1.5px var(--line-strong);
	}

	.state-badge[data-state='in_coda'],
	.state-badge[data-state='chiusa'] {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.lane-list,
	.file-list {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lane-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.row-icon {
		--icon-size: 12px;
		display: inline-flex;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.row-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
	}

	.row-diff {
		display: inline-flex;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.diff-add {
		color: var(--success);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.diff-del {
		color: var(--danger);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.file-list li {
		--icon-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.file-list.conflicts li {
		color: var(--ink);
	}

	.toggle {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--ink-muted);
		font: inherit;
		cursor: pointer;
	}

	.toggle:hover {
		color: var(--ink);
	}

	.toggle:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		margin-left: 6px;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.package {
		width: 100%;
		max-height: 320px;
		overflow: auto;
		margin: 0;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		white-space: pre-wrap;
		color: var(--ink);
	}

	.card-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 2px;
	}
</style>
