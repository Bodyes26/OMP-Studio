<!--
  InboxView.svelte — Implementazione confermata di Fleet Hub Inbox (Variante A).
  Inbox globale tra tutte le macchine, filtro macchina, switch "Per urgenza" / "Per progetto".
  Gruppi: "Ti aspettano", "In lavoro", "Finite da vedere", "Recenti".
  Conteggi macchine derivati da tutte le istantanee delle macchine abbinate.
-->
<script lang="ts">
	import type { FleetSessionItem, FleetSessionState } from '../../fleet.ts';
	import type { RemoteProject, RemoteLane } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import { navigation } from '../../navigation.svelte.ts';
	import MiniMachine from './MiniMachine.svelte';
	import SessionRow from './SessionRow.svelte';
	import ProjectIcon from './ProjectIcon.svelte';
	import MachineBadge from './MachineBadge.svelte';
	import { IconPlus, IconSparkles } from '../../icons.ts';

	let {
		hostFilter = $bindable('all'),
		onStartNewChat
	}: {
		hostFilter: string;
		onStartNewChat: (hostId?: string, projectId?: string) => void;
	} = $props();

	let groupMode = $state<'attention' | 'project'>('attention');

	const activeRouteKey = $derived.by(() => {
		const c = navigation.chat;
		if (!c || c.isHistory) return null;
		return `${c.hostId}:${c.projectId}:${c.laneId}`;
	});

	// Conteggio complessivo di sessioni in esecuzione su TUTTE le macchine (per il chip "Tutte")
	const totalWorkingAllHosts = $derived.by<number>(() => {
		let count = 0;
		for (const host of connection.hosts) {
			if (!host.online) continue;
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const p of state.projects) {
				for (const l of p.lanes) {
					if (l.agent.state === 'working' || l.agent.state === 'background') count++;
				}
			}
		}
		return count;
	});

	// Conteggio di sessioni in esecuzione per ciascuna singola macchina
	function countWorkingOnHost(hostId: string): number {
		const host = connection.hosts.find((h) => h.id === hostId);
		if (!host?.online) return 0;
		const state = connection.hostStates[hostId]?.state;
		if (!state?.projects) return 0;
		let count = 0;
		for (const p of state.projects) {
			for (const l of p.lanes) {
				if (l.agent.state === 'working' || l.agent.state === 'background') count++;
			}
		}
		return count;
	}

	// Sessioni aggregate tra le macchine (filtrate per macchina se richiesto)
	const allSessionItems = $derived.by<FleetSessionItem[]>(() => {
		const list: FleetSessionItem[] = [];
		for (const host of connection.hosts) {
			if (hostFilter !== 'all' && host.id !== hostFilter) continue;
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const project of state.projects) {
				for (const lane of project.lanes) {
					const att =
						project.attention?.find(
							(a) => a.laneId === lane.id || (!a.laneId && lane.id === 'main')
						) || null;

					const rawState = lane.agent.state;
					const session = lane.session;
					const hasUnseenCompletion = Boolean(session?.completion && !session.completion.seen);

					let stateValue: FleetSessionState = 'idle';
					if (rawState === 'error') {
						stateValue = 'error';
					} else if (att || rawState === 'attention') {
						stateValue = 'waiting';
					} else if (rawState === 'working' || rawState === 'background') {
						stateValue = 'working';
					} else if (hasUnseenCompletion) {
						stateValue = 'done';
					} else {
						stateValue = 'idle';
					}

					const title = session?.title || lane.title || (lane.kind === 'main' ? 'Principale' : lane.id);
					const preview =
						att?.questions?.[0]?.question ||
						att?.title ||
						att?.message ||
						lane.agent.headsUp ||
						lane.agent.activity?.text ||
						'';

					const updatedAt = session?.updatedAt || lane.agent.activity?.at || 0;
					const todo = session?.progress
						? { done: session.progress.done, total: session.progress.total }
						: undefined;
					const subagentsCount = session?.subagents?.length || 0;
					const jobsCount = session?.jobs?.length || 0;
					const tasksCount = project.tasks?.length || 0;

					list.push({
						id: `${host.id}:${project.id}:${lane.id}`,
						hostId: host.id,
						hostName: host.name,
						hostOnline: host.online,
						hostFeatures: host.features,
						project,
						lane,
						state: stateValue,
						title,
						preview,
						updatedAt,
						attention: att,
						todo,
						subagentsCount,
						jobsCount,
						tasksCount,
						unread: hasUnseenCompletion
					});
				}
			}
		}

		// Ordinamento per urgenza: waiting/error > working > done > idle; poi updatedAt desc
		return list.sort((a, b) => {
			const rank = (s: FleetSessionState) => {
				switch (s) {
					case 'waiting':
					case 'error':
						return 0;
					case 'working':
						return 1;
					case 'done':
						return 2;
					default:
						return 3;
				}
			};
			const rA = rank(a.state);
			const rB = rank(b.state);
			if (rA !== rB) return rA - rB;
			return b.updatedAt - a.updatedAt;
		});
	});

	// Gruppi per urgenza
	const waitingSessions = $derived(
		allSessionItems.filter((s) => s.state === 'waiting' || s.state === 'error')
	);
	const workingSessions = $derived(
		allSessionItems.filter((s) => s.state === 'working')
	);
	const doneSessions = $derived(
		allSessionItems.filter((s) => s.state === 'done')
	);
	const recentSessions = $derived(
		allSessionItems.filter((s) => s.state === 'idle')
	);

	// Progetti per la vista "Per progetto"
	interface ProjectGroup {
		key: string;
		project: RemoteProject;
		hostId: string;
		hostName: string;
		hostOnline: boolean;
		sessions: FleetSessionItem[];
	}

	const projectGroups = $derived.by<ProjectGroup[]>(() => {
		const groups: ProjectGroup[] = [];
		for (const host of connection.hosts) {
			if (hostFilter !== 'all' && host.id !== hostFilter) continue;
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const p of state.projects) {
				const projectSessions = allSessionItems.filter(
					(s) => s.hostId === host.id && s.project.id === p.id
				);
				groups.push({
					key: `${host.id}:${p.id}`,
					project: p,
					hostId: host.id,
					hostName: host.name,
					hostOnline: host.online,
					sessions: projectSessions
				});
			}
		}
		return groups;
	});
</script>

<div class="inbox-view">
	<!-- Barra superiore: Titolo e Switch gruppo -->
	<div class="inbox-top-bar">
		<div class="top-bar-row">
			<h1 class="inbox-title">{t('sessionsTitle')}</h1>

			<div class="group-switcher" role="radiogroup" aria-label={t('sessionsTitle')}>
				<button
					type="button"
					class="group-switch-btn"
					class:active={groupMode === 'attention'}
					onclick={() => (groupMode = 'attention')}
					role="radio"
					aria-checked={groupMode === 'attention'}
				>
					{t('groupUrgency')}
				</button>
				<button
					type="button"
					class="group-switch-btn"
					class:active={groupMode === 'project'}
					onclick={() => (groupMode = 'project')}
					role="radio"
					aria-checked={groupMode === 'project'}
				>
					{t('groupProject')}
				</button>
			</div>
		</div>

		<!-- Filtro macchine MiniMachine -->
		<div class="machines-filter-bar">
			<MiniMachine
				active={hostFilter === 'all'}
				workingCount={totalWorkingAllHosts}
				onclick={() => (hostFilter = 'all')}
			/>
			{#each connection.hosts as host (host.id)}
				<MiniMachine
					{host}
					active={hostFilter === host.id}
					workingCount={countWorkingOnHost(host.id)}
					onclick={() => (hostFilter = hostFilter === host.id ? 'all' : host.id)}
				/>
			{/each}
		</div>
	</div>

	<!-- Lista contenuti -->
	<div class="inbox-list-body">
		{#if groupMode === 'attention'}
			<!-- Gruppo: Ti aspettano -->
			{#if waitingSessions.length > 0}
				<section class="urgency-section waiting">
					<h2 class="section-heading tone-amber">
						<span>{t('sectionWaiting')}</span>
						<span class="count-tag font-mono">{waitingSessions.length}</span>
					</h2>
					<div class="sessions-stack">
						{#each waitingSessions as item (item.id)}
							<SessionRow
								{item}
								active={item.id === activeRouteKey}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Gruppo: In lavoro -->
			{#if workingSessions.length > 0}
				<section class="urgency-section working">
					<h2 class="section-heading tone-emerald">
						<span>{t('sectionWorking')}</span>
						<span class="count-tag font-mono">{workingSessions.length}</span>
					</h2>
					<div class="sessions-stack">
						{#each workingSessions as item (item.id)}
							<SessionRow
								{item}
								active={item.id === activeRouteKey}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Gruppo: Finite da vedere -->
			{#if doneSessions.length > 0}
				<section class="urgency-section done">
					<h2 class="section-heading tone-indigo">
						<span>{t('sectionDone')}</span>
						<span class="count-tag font-mono">{doneSessions.length}</span>
					</h2>
					<div class="sessions-stack">
						{#each doneSessions as item (item.id)}
							<SessionRow
								{item}
								active={item.id === activeRouteKey}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Gruppo: Recenti -->
			{#if recentSessions.length > 0}
				<section class="urgency-section recent">
					<h2 class="section-heading tone-muted">
						<span>{t('sectionRecent')}</span>
						<span class="count-tag font-mono">{recentSessions.length}</span>
					</h2>
					<div class="sessions-stack">
						{#each recentSessions as item (item.id)}
							<SessionRow
								{item}
								active={item.id === activeRouteKey}
							/>
						{/each}
					</div>
				</section>
			{/if}

			{#if allSessionItems.length === 0}
				<div class="empty-inbox-state">
					<p class="empty-hint">{t('noMessages')}</p>
					<button
						type="button"
						class="ui-button ui-button-primary"
						onclick={() => onStartNewChat()}
					>
						<IconSparkles />
						<span>{t('newChat')}</span>
					</button>
				</div>
			{/if}
		{:else}
			<!-- Vista: Per progetto -->
			{#if projectGroups.length === 0}
				<div class="empty-inbox-state">
					<p class="empty-hint">{t('noProjects')}</p>
				</div>
			{:else}
				<div class="projects-stack">
					{#each projectGroups as pg (pg.key)}
						<section class="project-section">
							<div class="project-section-header">
								<ProjectIcon project={pg.project} size="md" />
								<h2 class="project-title">{pg.project.name}</h2>
								<MachineBadge name={pg.hostName} online={pg.hostOnline} short />
								<button
									type="button"
									class="add-chat-btn"
									onclick={() => onStartNewChat(pg.hostId, pg.project.id)}
									title={t('newChat')}
									aria-label={t('newChat')}
								>
									<IconPlus />
								</button>
							</div>

							{#if pg.sessions.length === 0}
								<button
									type="button"
									class="empty-project-placeholder"
									onclick={() => onStartNewChat(pg.hostId, pg.project.id)}
								>
									{t('noSessionsProject')}
								</button>
							{:else}
								<div class="sessions-stack">
									{#each pg.sessions as item (item.id)}
										<SessionRow
											{item}
											showProject={false}
											active={item.id === activeRouteKey}
										/>
									{/each}
								</div>
							{/if}
						</section>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Pulsante galleggiante Nuova chat in basso -->
	<div class="inbox-bottom-bar safe-bottom">
		<button
			type="button"
			class="ui-button ui-button-primary floating-new-chat-btn"
			onclick={() => onStartNewChat()}
		>
			<IconPlus />
			<span>{t('newChat')}</span>
		</button>
	</div>
</div>

<style>
	.inbox-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-sunken);
		position: relative;
		overflow: hidden;
	}

	.inbox-top-bar {
		padding: 14px 16px 10px 16px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex-shrink: 0;
	}

	.top-bar-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.inbox-title {
		font-size: var(--text-title, 17px);
		font-weight: 700;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.02em;
	}

	.group-switcher {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--bg-sunken);
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
	}

	.group-switch-btn {
		padding: 4px 10px;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--ink-muted);
		font-weight: 500;
		cursor: pointer;
		transition: all var(--dur-fast, 0.15s) ease;
		user-select: none;
	}

	.group-switch-btn.active {
		background: var(--bg-base);
		color: var(--ink);
		font-weight: 600;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.machines-filter-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.inbox-list-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 16px calc(76px + env(safe-area-inset-bottom, 0px)) 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.urgency-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-heading {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-mini, 11px);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 2px 2px;
	}

	.tone-amber {
		color: var(--warn);
	}

	.tone-emerald {
		color: var(--success);
	}

	.tone-indigo {
		color: var(--brand);
	}

	.tone-muted {
		color: var(--ink-muted);
	}

	.count-tag {
		font-size: 10px;
		color: var(--ink-faint);
		font-weight: 500;
	}

	.sessions-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.projects-stack {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.project-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.project-section-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 2px;
	}

	.project-title {
		font-size: var(--text-label, 13px);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.add-chat-btn {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 13px;
	}

	.add-chat-btn:hover {
		background: var(--bg-raised);
		color: var(--ink);
	}

	.empty-project-placeholder {
		width: 100%;
		padding: 12px 14px;
		border-radius: var(--radius-xl);
		border: 1px dashed var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
		font-size: var(--text-caption, 12px);
		cursor: pointer;
		text-align: center;
	}

	.empty-project-placeholder:hover {
		border-color: var(--line-active, var(--line));
		color: var(--ink);
	}

	.empty-inbox-state {
		padding: 60px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		text-align: center;
	}

	.empty-hint {
		font-size: var(--text-caption, 13px);
		color: var(--ink-muted);
		margin: 0;
	}

	.inbox-bottom-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px;
		background: linear-gradient(to top, var(--bg-sunken) 70%, transparent 100%);
		pointer-events: none;
		z-index: 20;
	}

	.floating-new-chat-btn {
		pointer-events: auto;
		box-shadow: var(--shadow-dock);
		border-radius: var(--radius-full);
		padding: 10px 20px;
		font-size: var(--text-label, 13px);
		font-weight: 600;
	}
</style>
