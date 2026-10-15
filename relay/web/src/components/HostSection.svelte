<!--
  HostSection.svelte — Sezione piatta di una macchina remota.
  Intestazione sticky su mobile, stato connessione con pallino neutro,
  macchina offline compressa di default con chevron di espansione,
  elenco progetti e corsie piatto separato da --line.
-->
<script lang="ts">
	import type { HostSummary, HostState } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { sortProjects } from '../projectSort.ts';
	import { IconLaptop, IconMachine, IconPlus, IconFolder, IconChevronDown, IconChevronRight } from '../icons.ts';
	import QuotaCard from './QuotaCard.svelte';
	import ProjectCard from './ProjectCard.svelte';
	import ProjectSheet from './ProjectSheet.svelte';

	let {
		host,
		snapshot
	} = $props<{
		host: HostSummary;
		snapshot?: { seq: number; receivedAt: number; state: HostState };
	}>();

	let showProjectSheet = $state(false);
	let userCollapsed = $state<boolean | null>(null);
	const isCollapsed = $derived(userCollapsed ?? !host.online);

	const sortedProjects = $derived.by(() => {
		if (!snapshot?.state.projects) return [];
		return sortProjects(snapshot.state.projects);
	});

	const statusText = $derived.by(() => {
		if (host.online) return t('online');
		if (snapshot?.receivedAt) {
			return t('lastStateAt', { time: formatHHMM(snapshot.receivedAt) });
		}
		if (host.lastSeenAt) {
			return t('offlineSince', { time: formatHHMM(host.lastSeenAt) });
		}
		return t('offline');
	});

	let resetFailedBoundary: (() => void) | null = null;
	$effect(() => {
		void snapshot?.receivedAt;
		const reset = resetFailedBoundary;
		resetFailedBoundary = null;
		reset?.();
	});
</script>

<section class="host-section" id={`host-${host.id}`} class:is-offline={!host.online}>
	<!-- Intestazione macchina: sticky su mobile, pulita e piatta -->
	<header class="host-header">
		<button
			type="button"
			class="host-toggle-btn"
			onclick={() => (userCollapsed = !isCollapsed)}
			aria-expanded={!isCollapsed}
		>
			<span class="platform-icon" aria-hidden="true">
				{#if host.platform === 'macos'}
					<IconLaptop />
				{:else}
					<IconMachine />
				{/if}
			</span>

			<h2 class="host-name">{host.name}</h2>

			<div class="host-status">
				<span class="status-dot" class:online={host.online} aria-hidden="true"></span>
				<span class="status-label">{statusText}</span>
			</div>

			<span class="collapse-chevron" aria-hidden="true">
				{#if isCollapsed}
					<IconChevronRight />
				{:else}
					<IconChevronDown />
				{/if}
			</span>
		</button>

		{#if host.online && host.features.includes('projects')}
			<button
				type="button"
				class="ui-button ui-button-ghost add-project-btn"
				onclick={() => (showProjectSheet = true)}
				title={t('openOrCreateProject')}
				aria-label={t('openOrCreateProject')}
			>
				<IconPlus />
				<span class="btn-label">{t('openOrCreateProject')}</span>
			</button>
		{/if}
	</header>

	{#if !isCollapsed}
		<div class="host-content" class:offline-content={!host.online}>
			<svelte:boundary
				onerror={(error, reset) => {
					console.error('[host]', host.name, error);
					resetFailedBoundary = reset;
				}}
			>
				<!-- Quota compatta -->
				{#if snapshot?.state.quota}
					<div class="host-quota-wrap">
						<QuotaCard quota={snapshot.state.quota} />
					</div>
				{/if}

				<!-- Elenco progetti e corsie piatto -->
				<div class="projects-flat-list">
					{#if sortedProjects.length > 0}
						{#each sortedProjects as project (project.id)}
							<ProjectCard
								{project}
								hostId={host.id}
								hostName={host.name}
								hostFeatures={host.features}
							/>
						{/each}
					{:else}
						<div class="empty-projects">
							<div class="empty-icon" aria-hidden="true"><IconFolder /></div>
							<p class="empty-text">{t('noProjects')}</p>
							{#if host.online && host.features.includes('projects')}
								<button
									type="button"
									class="ui-button ui-button-secondary empty-create-btn"
									onclick={() => (showProjectSheet = true)}
								>
									<IconPlus />
									<span>{t('openOrCreateProject')}</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>

				{#snippet failed()}
					<div class="empty-projects">
						<p class="empty-text">{t('hostRenderError')}</p>
					</div>
				{/snippet}
			</svelte:boundary>
		</div>
	{/if}

	{#if showProjectSheet}
		<ProjectSheet {host} onClose={() => (showProjectSheet = false)} />
	{/if}
</section>

<style>
	.host-section {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--space-4);
	}

	.host-section:last-child {
		border-bottom: none;
	}

	.host-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		position: sticky;
		top: 44px;
		z-index: 10;
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--line);
		padding: 6px var(--space-2);
		gap: var(--space-2);
	}

	.host-toggle-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		border: none;
		color: var(--ink);
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		padding: 4px 6px;
		border-radius: var(--radius-md);
		min-width: 0;
		flex: 1;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.host-toggle-btn:hover {
		background: var(--bg-hover);
	}

	.platform-icon {
		color: var(--ink-muted);
		--icon-size: 15px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.host-name {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.host-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: 4px;
		flex-shrink: 0;
	}

	/* Punto neutro per stato online/offline (Outcome-only color rule) */
	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}

	.status-dot.online {
		background: var(--ink-muted);
	}

	.status-label {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.collapse-chevron {
		color: var(--ink-faint);
		--icon-size: 13px;
		display: grid;
		place-items: center;
		margin-left: 2px;
		flex-shrink: 0;
	}

	.add-project-btn {
		height: 26px;
		padding: 0 8px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 12px;
		flex-shrink: 0;
	}

	/* Container query: la sezione e' stretta sia sul telefono sia nella barra
	   laterale del desktop, dove la viewport e' larga. */
	.host-section {
		container-type: inline-size;
	}

	@container (max-width: 500px) {
		.add-project-btn .btn-label {
			display: none;
		}
	}

	.host-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-3);
	}

	.offline-content {
		opacity: 0.65;
	}

	.host-quota-wrap {
		padding: 0 var(--space-2);
	}

	.projects-flat-list {
		display: flex;
		flex-direction: column;
		padding: 0 var(--space-1);
	}

	.empty-projects {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-5) var(--space-4);
		text-align: center;
		gap: var(--space-2);
	}

	.empty-icon {
		color: var(--ink-faint);
		--icon-size: 20px;
		display: grid;
		place-items: center;
	}

	.empty-text {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0;
	}

	.empty-create-btn {
		height: 26px;
		padding: 0 8px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 11px;
	}
</style>
