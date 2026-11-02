<!--
  HomeView.svelte — Schermata principale a macchina singola (Gate R48, R-REM-01, R-REM-02, R-REM-03, R-REM-16).
  Mostra una sola macchina alla volta, la striscia quote dei soli provider in uso,
  l'elenco ordinato dei progetti e il pulsante «+ Nuovo» per avviare o accodare lavori.
  L'indicatore «● N richieste su <macchina>» segnala richieste pendenti su altri host connessi.
-->
<script lang="ts">
	import type { RemoteProject, HostSummary } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { navigation } from '../navigation.svelte.ts';
	import { workSheet } from '../work.svelte.ts';
	import { machineSelection } from '../machine.svelte.ts';
	import {
		sortProjects,
		getOtherMachinePendingRequests
	} from '../projectHelpers.ts';
	import QuotaStrip from './QuotaStrip.svelte';
	import ProjectRow from './ProjectRow.svelte';
	import MachinesSheet from './MachinesSheet.svelte';
	import QuotaSheet from './QuotaSheet.svelte';
	import ProjectHistorySheet from './ProjectHistorySheet.svelte';
	import ProjectSheet from './ProjectSheet.svelte';

	let {
		onOpenSettings
	}: {
		onOpenSettings: () => void;
	} = $props();

	let expandedProjectId = $state<string | null>(null);

	// Fogli modali aperti
	let showMachinesSheet = $state(false);
	let showQuotaSheet = $state(false);
	let historyProject = $state<RemoteProject | null>(null);
	let projectSheetHost = $state<HostSummary | null>(null);

	// Macchina scelta se esiste ancora, altrimenti la prima online o la prima disponibile.
	const currentHost = $derived.by<HostSummary | null>(() => {
		const hosts = connection.hosts;
		if (hosts.length === 0) return null;
		const chosen = machineSelection.id ? hosts.find((h) => h.id === machineSelection.id) : undefined;
		if (chosen) return chosen;
		const firstOnline = hosts.find((h) => h.online);
		return firstOnline ?? hosts[0];
	});

	const currentHostId = $derived(currentHost?.id ?? '');
	const currentHostState = $derived(
		currentHostId ? connection.hostStates[currentHostId]?.state : null
	);
	const currentProjects = $derived<RemoteProject[]>(
		currentHostState?.projects ?? []
	);
	const currentQuota = $derived(currentHostState?.quota ?? null);
	const sortedProjects = $derived(sortProjects(currentProjects));

	// Indicatore di richieste in attesa su altre macchine connesse (R-REM-01)
	const otherPending = $derived.by(() => {
		if (!currentHostId) return null;
		return getOtherMachinePendingRequests(
			currentHostId,
			connection.hosts,
			connection.hostStates
		);
	});

	function handleSelectHost(hostId: string): void {
		machineSelection.select(hostId);
		expandedProjectId = null;
	}

	function handleOpenBranch(projectId: string, laneId: string): void {
		if (!currentHostId) return;
		navigation.openChat({
			hostId: currentHostId,
			projectId,
			laneId
		});
	}
</script>

<main class="home" aria-label={t('projects')}>
	<div class="home-head">
		<!-- Riga superiore: titolo «Progetti» e «+ Nuovo» -->
		<div class="home-top">
			<h1 class="home-title">{t('projects')}</h1>
			<button
				type="button"
				class="new-work-btn"
				onclick={() => {
					if (currentHostId) {
						workSheet.openNew({ hostId: currentHostId });
					}
				}}
				data-act="newWork"
				data-testid="new-work"
				aria-label={t('homeNewWork')}
			>
				{t('homeNewWork')}
			</button>
		</div>

		<!-- Riga macchina con selettore e indicatore richieste altrove -->
		<div class="machine-bar">
			{#if currentHost}
				<button
					type="button"
					class="machine-selector-btn"
					onclick={() => (showMachinesSheet = true)}
					data-act="machines"
					data-testid="machine"
					aria-label={t('machinePickAria', { machine: currentHost.name })}
				>
					<span class="machine-name">{currentHost.name}</span>
					<span class="machine-arrow" aria-hidden="true">▾</span>
				</button>
			{/if}

			{#if otherPending}
				<button
					type="button"
					class="elsewhere-btn"
					onclick={() => (showMachinesSheet = true)}
					data-act="machines"
					aria-label={otherPending.count === 1
						? t('machinesElsewhereSingular', { count: 1, machine: otherPending.name })
						: t('machinesElsewherePlural', { count: otherPending.count, machine: otherPending.name })}
				>
					{otherPending.count === 1
						? t('machinesElsewhereSingular', { count: 1, machine: otherPending.name })
						: t('machinesElsewherePlural', { count: otherPending.count, machine: otherPending.name })}
				</button>
			{/if}
		</div>

		<!-- Striscia compatta dei provider in uso (R-REM-08) -->
		<QuotaStrip
			quota={currentQuota}
			projects={currentProjects}
			onOpenQuotaSheet={() => (showQuotaSheet = true)}
		/>
	</div>

	<!-- Elenco dei progetti ordinati per stato (richieste > lavoro > fermi) -->
	{#if sortedProjects.length > 0}
		<ul class="rows" role="list">
			{#each sortedProjects as project (project.id)}
				<ProjectRow
					hostId={currentHostId}
					{project}
					quota={currentQuota}
					features={currentHost?.features ?? []}
					isExpanded={expandedProjectId === project.id}
					onToggleExpand={() => {
						expandedProjectId = expandedProjectId === project.id ? null : project.id;
					}}
					onOpenBranch={(laneId) => handleOpenBranch(project.id, laneId)}
					onNewWork={() => {
						workSheet.openNew({ hostId: currentHostId, projectId: project.id });
					}}
					onOpenHistory={() => {
						historyProject = project;
					}}
				/>
			{/each}
		</ul>
	{:else if currentHost}
		<p class="empty-state">
			{t('emptyProjectsHome', { machine: currentHost.name })}
		</p>
	{/if}
</main>

<!-- Fogli a comparsa gestiti dalla Home -->
{#if showMachinesSheet}
	<MachinesSheet
		{currentHostId}
		onSelectHost={handleSelectHost}
		onOpenProjectSheet={(host) => {
			projectSheetHost = host;
		}}
		{onOpenSettings}
		onClose={() => (showMachinesSheet = false)}
	/>
{/if}

{#if showQuotaSheet && currentHost}
	<QuotaSheet
		hostId={currentHost.id}
		hostName={currentHost.name}
		features={currentHost.features}
		quota={currentQuota}
		projects={currentProjects}
		onClose={() => (showQuotaSheet = false)}
	/>
{/if}

{#if historyProject && currentHost}
	<ProjectHistorySheet
		hostId={currentHost.id}
		project={historyProject}
		onClose={() => (historyProject = null)}
	/>
{/if}

{#if projectSheetHost}
	<ProjectSheet
		host={projectSheetHost}
		onClose={() => (projectSheetHost = null)}
	/>
{/if}

<style>
	.home {
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--bg-sunken);
		-webkit-overflow-scrolling: touch;
	}

	.home-head {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--bg-raised);
		padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 6px;
		border-bottom: 1px solid var(--line);
		box-shadow: var(--shadow-sm);
	}

	.home-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 44px;
	}

	.home-title {
		font-size: 26px;
		line-height: 1.2;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--ink);
		margin: 0;
	}

	.new-work-btn {
		background: transparent;
		border: none;
		color: var(--brand-ink);
		font-weight: 650;
		font-size: 15px;
		padding: 8px 12px;
		min-height: 44px;
		min-width: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.new-work-btn:hover {
		background: var(--bg-hover);
	}

	.machine-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		padding: 2px 0 6px;
	}

	.machine-selector-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		padding: 6px 0;
		min-height: 44px;
		font-size: 14px;
		font-weight: 550;
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast);
	}

	.machine-selector-btn:hover {
		color: var(--ink);
	}

	.machine-arrow {
		font-size: 11px;
		opacity: 0.7;
	}

	.elsewhere-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		padding: 6px 4px;
		min-height: 44px;
		font-size: 13px;
		font-weight: 550;
		color: var(--warn);
		cursor: pointer;
		animation: pulse-soft 2s infinite ease-in-out;
	}

	@keyframes pulse-soft {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.75; }
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 4px 0 calc(72px + env(safe-area-inset-bottom, 0px));
		background: var(--bg-sunken);
	}

	.empty-state {
		padding: 40px 24px;
		color: var(--ink-muted);
		text-align: center;
		font-size: var(--text-body);
		line-height: 1.5;
	}

	@media (prefers-reduced-motion: reduce) {
		.elsewhere-btn {
			animation: none;
		}
	}
</style>
