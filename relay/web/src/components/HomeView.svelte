<!--
  HomeView.svelte — Schermata principale con un elenco solo (R-REM-17…R-REM-23).
  I progetti di tutte le macchine abbinate stanno in un elenco unico: le copie
  dello stesso progetto (stessa `RemoteProject.identity`) occupano una riga
  sola con il glifo delle macchine. Niente selettore della macchina: il foglio
  Macchine resta per stato, apertura/creazione progetti e impostazioni.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { navigation } from '../navigation.svelte.ts';
	import { workSheet } from '../work.svelte.ts';
	import { groupProjects, quotaSections as quotaSectionsOf, type ProjectGroup } from '../multiMachine.ts';
	import QuotaStrip from './QuotaStrip.svelte';
	import ProjectRow from './ProjectRow.svelte';
	import MachinesSheet from './MachinesSheet.svelte';
	import QuotaSheet from './QuotaSheet.svelte';
	import ProjectHistorySheet from './ProjectHistorySheet.svelte';
	import ProjectSheet from './ProjectSheet.svelte';
	import MachineGlyph from './MachineGlyph.svelte';
	import { groupGlyph } from '../multiMachine.ts';
	import { IconMachine } from '../icons.ts';

	let {
		onOpenSettings
	}: {
		onOpenSettings: () => void;
	} = $props();

	let expandedKey = $state<string | null>(null);

	// Fogli modali aperti
	let showMachinesSheet = $state(false);
	let showQuotaSheet = $state(false);
	let historyGroup = $state<ProjectGroup | null>(null);
	let projectSheetHostId = $state<string | null>(null);

	// Un elenco solo, ordine di Studio (R-REM-02) sull'unione delle copie.
	const groups = $derived(groupProjects(connection.hosts, connection.hostStates));

	// La striscia delle quote elenca le macchine con i loro provider in uso
	// (R-REM-23): i colori restano quelli della prima macchina in linea, cosi'
	// la striscia non cambia tinta a ogni aggiornamento.
	const quotaSections = $derived(quotaSectionsOf(connection.hosts, connection.hostStates));
	const stripHost = $derived(
		connection.hosts.find((host) => host.online && connection.hostStates[host.id]) ??
			connection.hosts.find((host) => connection.hostStates[host.id])
	);
	const stripProjects = $derived(
		stripHost ? (connection.hostStates[stripHost.id]?.state.projects ?? []) : []
	);

	// "+ Nuovo" senza un progetto scelto: il foglio propone il primo progetto
	// della macchina usata per ultima.
	const newWorkHostId = $derived(connection.hosts.find((host) => host.online)?.id ?? connection.hosts[0]?.id ?? '');

	function handleOpenBranch(hostId: string, projectId: string, laneId: string): void {
		navigation.openChat({ hostId, projectId, laneId });
	}

	function openNewWork(group: ProjectGroup): void {
		const copy = group.primary;
		workSheet.openNew({ hostId: copy.hostId, projectId: copy.project.id });
	}
</script>

<main class="home" aria-label={t('projects')}>
	<div class="home-head">
		<div class="home-top">
			<h1 class="home-title">{t('projects')}</h1>
			<button
				type="button"
				class="new-work-btn"
				onclick={() => {
					if (newWorkHostId) workSheet.openNew({ hostId: newWorkHostId });
				}}
				data-act="newWork"
				data-testid="new-work"
				aria-label={t('homeNewWork')}
			>
				{t('homeNewWork')}
			</button>
		</div>

		<!-- Il foglio Macchine resta la porta per stato, progetti e impostazioni -->
		<div class="machine-bar">
			<button
				type="button"
				class="machines-btn"
				onclick={() => (showMachinesSheet = true)}
				data-act="machines"
				data-testid="machines"
				aria-label={t('machinesTitle')}
			>
				<IconMachine />
				<span>{t('machinesTitle')}</span>
			</button>
		</div>

		<!-- Striscia compatta dei provider in uso (R-REM-08, R-REM-23) -->
		<QuotaStrip
			quota={stripHost ? (connection.hostStates[stripHost.id]?.state.quota ?? null) : null}
			projects={stripProjects}
			onOpenQuotaSheet={() => (showQuotaSheet = true)}
		/>
	</div>

	{#if groups.length > 0}
		<ul class="rows" role="list">
			{#each groups as group (group.key)}
				{@const glyph = groupGlyph(group)}
				<ProjectRow
					{group}
					glyph={glyph}
					isExpanded={expandedKey === group.key}
					onToggleExpand={() => {
						expandedKey = expandedKey === group.key ? null : group.key;
					}}
					onOpenBranch={(hostId, projectId, laneId) => handleOpenBranch(hostId, projectId, laneId)}
					onNewWork={() => openNewWork(group)}
					onOpenHistory={() => {
						historyGroup = group;
					}}
				/>
			{/each}
		</ul>
	{:else}
		<p class="empty-state">{t('emptyProjectsOpen')}</p>
	{/if}
</main>

<!-- Fogli a comparsa gestiti dalla Home -->
{#if showMachinesSheet}
	<MachinesSheet
		onOpenProjectSheet={(host) => {
			projectSheetHostId = host.id;
		}}
		{onOpenSettings}
		onClose={() => (showMachinesSheet = false)}
	/>
{/if}

{#if showQuotaSheet}
	<QuotaSheet sections={quotaSections} onClose={() => (showQuotaSheet = false)} />
{/if}

{#if historyGroup}
	<ProjectHistorySheet group={historyGroup} onClose={() => (historyGroup = null)} />
{/if}

{#if projectSheetHostId}
	{@const host = connection.hosts.find((candidate) => candidate.id === projectSheetHostId)}
	{#if host}
		<ProjectSheet {host} onClose={() => (projectSheetHostId = null)} />
	{/if}
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

	.machines-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
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

	.machines-btn:hover {
		color: var(--ink);
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
</style>
