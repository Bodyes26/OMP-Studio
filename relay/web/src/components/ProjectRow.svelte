<!--
  ProjectRow.svelte — Una riga per progetto, anche su più macchine (R-REM-17…R-REM-22).
  Lo stato unisce quello delle copie (una richiesta su una copia mette la riga in
  cima, R-REM-02) e il glifo dice su quali macchine vive. Nell'espansione i rami
  di tutte le copie stanno insieme, ognuno con la macchina, poi la coda unica
  (R-REM-19) e i lavori in attesa di una macchina spenta (R-REM-22).
-->
<script lang="ts">
	import type { RemoteQuotaProvider } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import {
		getLaneSummary,
		getQuotaLevel,
		getWorstQuotaWindow,
		getWorkingProviders,
		laneLabel,
		normalizeProvider,
		providerDisplayName,
		queuedTaskCount
	} from '../projectHelpers.ts';
	import {
		decideGroupOpenTarget,
		deferredForGroup,
		mergedLanes,
		mergedTasks,
		machineOptions,
		type GlyphSpec,
		type ProjectGroup
	} from '../multiMachine.ts';
	import QueueList from './work/QueueList.svelte';
	import MachineGlyph from './MachineGlyph.svelte';
	import { accordionFold } from '../motion.ts';

	let {
		group,
		glyph,
		isExpanded = false,
		onToggleExpand,
		onOpenBranch,
		onNewWork,
		onOpenHistory
	}: {
		group: ProjectGroup;
		glyph: GlyphSpec;
		isExpanded?: boolean;
		onToggleExpand: () => void;
		onOpenBranch: (hostId: string, projectId: string, laneId: string) => void;
		onNewWork: () => void;
		onOpenHistory: () => void;
	} = $props();

	const lanes = $derived(mergedLanes(group));
	const tasks = $derived(mergedTasks(group));
	const deferred = $derived(deferredForGroup(group, connection.hosts));
	const machines = $derived(machineOptions(group));
	const isExpandable = $derived(lanes.length > 1 || tasks.length > 0 || deferred.length > 0);
	const status = $derived(group.status);

	// Riga meta: stato, contesto, coda e macchine, come R-REM-02.
	const contextText = $derived.by(() => {
		const waiting = lanes.find((entry) => entry.status === 'question');
		if (waiting) {
			const summary = getLaneSummary(waiting.copy.project, waiting.lane);
			return group.isShared
				? `${laneLabel(waiting.lane)} · ${summary} · ${waiting.copy.hostName}`
				: `${laneLabel(waiting.lane)} · ${summary}`;
		}
		const working = lanes.filter((entry) => entry.status === 'working');
		if (working.length > 1) return t('branchesWorking', { count: working.length });
		const first = working[0] ?? lanes[0];
		return first ? getLaneSummary(first.copy.project, first.lane) : '';
	});

	const statusLabel = $derived(
		status === 'question'
			? t('projectStatusQuestion')
			: status === 'working'
				? t('projectStatusWorking')
				: t('projectStatusIdle')
	);

	const queuedCount = $derived(
		group.copies.reduce((sum, copy) => sum + queuedTaskCount(copy.project), 0)
	);

	// Percentuali dei provider in uso, ognuna presa dalla macchina che la pubblica (R-REM-23).
	const providerTokens = $derived.by(() => {
		if (status === 'idle') return [];
		const tokens: Array<{ providerId: string; name: string; pct: string; tone: string }> = [];
		const seen = new Set<string>();
		for (const copy of group.copies) {
			const providers: RemoteQuotaProvider[] = connection.hostStates[copy.hostId]?.state.quota?.providers ?? [];
			if (providers.length === 0) continue;
			for (const providerId of getWorkingProviders(copy.project)) {
				if (seen.has(providerId)) continue;
				const quotaProvider = providers.find(
					(candidate) => normalizeProvider(candidate.provider) === providerId
				);
				const worst = quotaProvider ? getWorstQuotaWindow(quotaProvider) : null;
				const fraction = worst?.usedFraction;
				if (!quotaProvider || fraction == null) continue;
				seen.add(providerId);
				tokens.push({
					providerId,
					name: providerDisplayName(quotaProvider.provider),
					pct: `${Math.round(fraction * 100)}%`,
					tone: getQuotaLevel(fraction, quotaProvider.status)
				});
			}
		}
		return tokens;
	});
</script>

<li class="project-li">
	<button
		type="button"
		class="row-btn"
		class:expanded={isExpanded}
		onclick={() => {
			if (isExpanded) {
				onToggleExpand();
				return;
			}
			const target = decideGroupOpenTarget(group);
			if (target.action === 'chat') {
				onOpenBranch(target.hostId, target.projectId, target.laneId);
			} else {
				onToggleExpand();
			}
		}}
		data-testid={`project-${group.key}`}
		aria-expanded={isExpandable ? isExpanded : undefined}
	>
		<span class="status-dot {status}" aria-hidden="true"></span>

		<span class="row-content">
			<span class="row-title-line">
				<span class="row-title">{group.primary.project.name}</span>
				<span class="row-glyph" title={group.isShared ? t('machineSharedAria') : undefined}>
					<MachineGlyph {glyph} size={13} />
				</span>
			</span>
			<span class="row-meta">
				<span class="meta-status {status}-text">{statusLabel}</span>
				<span class="meta-sep">·</span>
				<span class="meta-ctx">{contextText}</span>
				{#if queuedCount > 0}
					<span class="meta-sep">·</span>
					<span class="meta-queue">{t('queuedWorkCount', { count: queuedCount })}</span>
				{/if}
				{#if deferred.length > 0}
					<span class="meta-sep">·</span>
					<span class="meta-deferred">{t('deferredPendingCount', { count: deferred.length })}</span>
				{/if}
				{#if providerTokens.length > 0}
					<span class="meta-sep">·</span>
					<span class="meta-providers">
						{#each providerTokens as tok, i (tok.providerId)}
							{#if i > 0}, {/if}
							<span class="prov-token tone-{tok.tone}">{tok.name} {tok.pct}</span>
						{/each}
					</span>
				{/if}
				{#if !group.reachable}
					<span class="meta-sep">·</span>
					<span class="meta-offline">{t('offline')}</span>
				{/if}
			</span>
		</span>

		<span class="chev" class:rot={isExpanded} aria-hidden="true">›</span>
	</button>

	{#if isExpandable && isExpanded}
		<div class="expand-pane" transition:accordionFold>
			<!-- Rami di tutte le copie, ognuno con la sua macchina (R-REM-18) -->
			<div class="branches-list">
				{#each lanes as entry (entry.copy.hostId + ':' + entry.lane.id)}
					<button
						type="button"
						class="branch-item"
						onclick={() => onOpenBranch(entry.copy.hostId, entry.copy.project.id, entry.lane.id)}
						data-testid={`branch-${entry.copy.hostId}-${entry.lane.id}`}
					>
						<span class="branch-lead">
							<span class="branch-name-line">
								<span class="branch-name">{laneLabel(entry.lane)}</span>
								{#if group.isShared}
									<span class="branch-machine">
										<MachineGlyph glyph={{ kind: entry.copy.online ? 'remote' : 'offline' }} size={11} />
										<span class="branch-machine-name">{entry.copy.hostName}</span>
									</span>
								{/if}
							</span>
							<span class="branch-meta">
								<span class="status-dot-mini {entry.status}" aria-hidden="true"></span>
								<span class="meta-status {entry.status}-text">
									{entry.status === 'question'
										? t('projectStatusQuestion')
										: entry.status === 'working'
											? t('projectStatusWorking')
											: t('laneStatusReady')}
								</span>
								<span class="meta-sep">·</span>
								<span class="meta-summary">{getLaneSummary(entry.copy.project, entry.lane)}</span>
							</span>
						</span>
						<span class="chev" aria-hidden="true">›</span>
					</button>
				{/each}
			</div>

			<!-- Coda unica del progetto (R-REM-19) -->
			<QueueList {group} {tasks} machines={machines} />

			<!-- Lavori che aspettano il ritorno di una macchina spenta (R-REM-22) -->
			{#if deferred.length > 0}
				<div class="deferred-section" data-testid="deferred-list">
					{#each deferred as entry (entry.commandId)}
						<div class="deferred-row">
							<span class="deferred-text">
								<span class="deferred-title">{entry.prompt || group.primary.project.name}</span>
								<span class="deferred-sub">{t('deferredWaitingItem', { machine: entry.hostName })}</span>
							</span>
							<button
								type="button"
								class="deferred-cancel"
								onclick={() => void connection.cancelDeferred(entry.hostId, entry.commandId)}
								data-testid={`deferred-cancel-${entry.commandId}`}
							>
								{t('deferredCancel')}
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="expand-actions">
				<button type="button" class="expand-action-btn" onclick={onNewWork} data-testid="new-work-project">
					{t('projectActionNewWork')}
				</button>
				<button type="button" class="expand-action-btn" onclick={onOpenHistory} data-testid="history-project">
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

	.row-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.row-title-line {
		display: flex;
		align-items: center;
		gap: 6px;
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

	.row-glyph {
		display: inline-flex;
		color: var(--ink-muted);
		flex-shrink: 0;
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

	.meta-sep {
		margin: 0 2px;
		opacity: 0.6;
	}

	.meta-queue,
	.meta-deferred {
		font-weight: 500;
		color: var(--ink);
	}

	.meta-deferred {
		color: var(--warn);
	}

	.meta-offline {
		color: var(--danger);
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

	.branch-name-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.branch-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.branch-machine {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--ink-muted);
		font-size: 11px;
		font-weight: 500;
	}

	.branch-machine-name {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	.deferred-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.deferred-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 6px;
		border-radius: var(--radius-md);
		background: color-mix(in oklch, var(--warn) 8%, transparent);
	}

	.deferred-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.deferred-title {
		font-size: var(--text-sm);
		font-weight: 550;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.deferred-sub {
		font-size: var(--text-xs);
		color: var(--warn);
	}

	.deferred-cancel {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		padding: 6px 10px;
		min-height: 36px;
		cursor: pointer;
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
