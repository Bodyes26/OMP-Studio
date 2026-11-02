<!--
  ProjectRow.svelte — Riga di un singolo progetto aperto (Gate R48, R-REM-02, R-REM-03, R-REM-11).
  Ogni progetto compare una sola volta indipendentemente da rami e sessioni.
  Mostra pallino di stato, nome, riga «stato · contesto» con percentuali dei provider in uso.
  Toccando la riga si espande (se ha più rami o compiti in coda) o apre la chat.
  Nell'espansione mostra rami, compiti in coda (<QueueList>) e azioni Nuovo lavoro / Storico.
-->
<script lang="ts">
	import type { RemoteProject, RemoteQuota, Feature } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import {
		getProjectMeta,
		getLaneStatus,
		getLaneSummary,
		decideProjectOpenTarget,
		laneLabel,
		queuedTaskCount
	} from '../projectHelpers.ts';
	import QueueList from './work/QueueList.svelte';

	let {
		hostId,
		project,
		quota = null,
		features = [],
		isExpanded = false,
		onToggleExpand,
		onOpenBranch,
		onNewWork,
		onOpenHistory
	}: {
		hostId: string;
		project: RemoteProject;
		quota?: RemoteQuota | null;
		features?: Feature[];
		isExpanded?: boolean;
		onToggleExpand: () => void;
		onOpenBranch: (laneId: string) => void;
		onNewWork: () => void;
		onOpenHistory: () => void;
	} = $props();

	const meta = $derived(getProjectMeta(project, quota));
	const isExpandable = $derived(
		project.lanes.length > 1 || queuedTaskCount(project) > 0
	);

	function handleRowClick() {
		if (isExpanded) {
			onToggleExpand();
			return;
		}
		const target = decideProjectOpenTarget(project);
		if (target.action === 'chat') {
			onOpenBranch(target.laneId);
		} else {
			onToggleExpand();
		}
	}
</script>

<li class="project-li">
	<button
		type="button"
		class="row-btn"
		class:expanded={isExpanded}
		onclick={handleRowClick}
		data-testid={`project-${project.id}`}
		aria-expanded={isExpandable ? isExpanded : undefined}
	>
		<span class="status-dot {meta.status}" aria-hidden="true"></span>

		<span class="row-content">
			<span class="row-title">{project.name}</span>
			<span class="row-meta">
				<span class="meta-status {meta.status}-text">{meta.statusLabel}</span>
				<span class="meta-sep">·</span>
				<span class="meta-ctx">{meta.contextText}</span>
				{#if meta.queuedCount > 0}
					<span class="meta-sep">·</span>
					<span class="meta-queue">{t('queuedWorkCount', { count: meta.queuedCount })}</span>
				{/if}
				{#if meta.providerTokens.length > 0}
					<span class="meta-sep">·</span>
					<span class="meta-providers">
						{#each meta.providerTokens as tok, i}
							{#if i > 0}, {/if}
							<span class="prov-token tone-{tok.tone}">{tok.name} {tok.pct}</span>
						{/each}
					</span>
				{/if}
			</span>
		</span>

		<span class="chev" class:rot={isExpanded} aria-hidden="true">›</span>
	</button>

	{#if isExpandable && isExpanded}
		<div class="expand-pane">
			<!-- Elenco dei rami (Principale, worktree, Lab) -->
			<div class="branches-list">
				{#each project.lanes as lane (lane.id)}
					{@const lStatus = getLaneStatus(project, lane)}
					{@const lSummary = getLaneSummary(project, lane)}
					<button
						type="button"
						class="branch-item"
						onclick={() => onOpenBranch(lane.id)}
						data-testid={`branch-${lane.id}`}
					>
						<span class="branch-lead">
							<span class="branch-name">{laneLabel(lane)}</span>
							<span class="branch-meta">
								<span class="status-dot-mini {lStatus}" aria-hidden="true"></span>
								<span class="meta-status {lStatus}-text">
									{lStatus === 'question'
										? t('projectStatusQuestion')
										: lStatus === 'working'
											? t('projectStatusWorking')
											: t('laneStatusReady')}
								</span>
								<span class="meta-sep">·</span>
								<span class="meta-summary">{lSummary}</span>
							</span>
						</span>
						<span class="chev" aria-hidden="true">›</span>
					</button>
				{/each}
			</div>

			<!-- Coda del progetto (Gate R48, R-REM-11) -->
			<QueueList {hostId} {project} {features} />

			<!-- Azioni in fondo all'espansione -->
			<div class="expand-actions">
				<button
					type="button"
					class="expand-action-btn"
					onclick={onNewWork}
					data-testid="new-work-project"
				>
					{t('projectActionNewWork')}
				</button>
				<button
					type="button"
					class="expand-action-btn"
					onclick={onOpenHistory}
					data-testid="history-project"
				>
					{t('projectActionHistory')}
				</button>
			</div>
		</div>
	{/if}
</li>

<style>
	.project-li {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row-btn {
		display: grid;
		grid-template-columns: 8px minmax(0, 1fr) auto;
		column-gap: 12px;
		width: 100%;
		text-align: left;
		padding: 12px 12px 12px 16px;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
		align-items: start;
		cursor: pointer;
		min-height: 52px;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.row-btn:active {
		background: var(--bg-sunken);
	}

	.row-btn.expanded {
		background: var(--bg-sunken);
		border-bottom-color: transparent;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 6px;
		flex-shrink: 0;
		background: var(--ink-faint);
	}

	.status-dot.question {
		background: var(--warn);
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--warn) 25%, transparent);
	}

	.status-dot.working {
		background: var(--brand);
		animation: pulseDot 2s infinite ease-in-out;
	}

	.status-dot.idle {
		background: var(--ink-faint);
	}

	.row-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.row-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-meta {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta-status.question-text {
		color: var(--warn);
		font-weight: 600;
	}

	.meta-status.working-text {
		color: var(--brand);
		font-weight: 500;
	}

	.meta-status.idle-text {
		color: var(--ink-muted);
	}

	.meta-sep {
		margin: 0 2px;
		opacity: 0.6;
	}

	.meta-queue {
		font-weight: 500;
		color: var(--ink);
	}

	.prov-token.tone-warning {
		color: var(--warn);
		font-weight: 500;
	}

	.prov-token.tone-exhausted {
		color: var(--danger);
		font-weight: 600;
	}

	.chev {
		font-size: 18px;
		color: var(--ink-muted);
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-block;
		margin-top: 2px;
	}

	.chev.rot {
		transform: rotate(90deg);
	}

	.expand-pane {
		padding: 0 12px 10px 32px;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.branches-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.branch-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 8px 6px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		cursor: pointer;
		min-height: 44px;
	}

	.branch-item:hover {
		background: var(--bg-hover);
	}

	.branch-lead {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.branch-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.branch-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-dot-mini {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.status-dot-mini.question {
		background: var(--warn);
	}

	.status-dot-mini.working {
		background: var(--brand);
	}

	.status-dot-mini.idle {
		background: var(--ink-faint);
	}

	.expand-actions {
		display: flex;
		align-items: center;
		gap: 16px;
		padding-top: 6px;
	}

	.expand-action-btn {
		background: transparent;
		border: none;
		color: var(--brand);
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 4px 0;
		cursor: pointer;
		min-height: 36px;
	}

	.expand-action-btn:hover {
		text-decoration: underline;
	}

	@keyframes pulseDot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.45; }
	}
</style>
