<script lang="ts">
	import type { HostSummary, HostState } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { sortProjects } from '../projectSort.ts';
	import QuotaCard from './QuotaCard.svelte';
	import ProjectCard from './ProjectCard.svelte';

	let {
		host,
		snapshot
	} = $props<{
		host: HostSummary;
		snapshot?: { seq: number; receivedAt: number; state: HostState };
	}>();

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
</script>

<section class="host-section" class:is-offline={!host.online}>
	<div class="host-header">
		<div class="host-identity">
			<span class="platform-icon" title={host.platform}>
				{#if host.platform === 'macos'}
					
				{:else if host.platform === 'windows'}
					⊞
				{:else}
					🐧
				{/if}
			</span>
			<h2 class="host-name">{host.name}</h2>
		</div>

		<div class="host-status">
			<span class="status-dot" class:online={host.online}></span>
			<span class="status-label">{statusText}</span>
		</div>
	</div>

	<!-- Quote per macchina -->
	{#if snapshot?.state.quota}
		<QuotaCard quota={snapshot.state.quota} />
	{/if}

	<!-- Progetti della macchina -->
	<div class="projects-container">
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
				<p>{t('noProjects')}</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.host-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: 16px;
		transition: opacity var(--dur-base);
	}

	.host-section.is-offline {
		opacity: 0.72;
		filter: grayscale(0.2);
	}

	.host-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line);
	}

	.host-identity {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.platform-icon {
		font-size: 16px;
		color: var(--ink-muted);
	}

	.host-name {
		font-size: 16px;
		font-weight: 700;
		color: var(--ink);
	}

	.host-status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--ink-faint);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
	}
	.status-dot.online {
		background: var(--success);
	}

	.projects-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.empty-projects {
		padding: 24px 16px;
		text-align: center;
		color: var(--ink-faint);
		font-size: 13px;
	}
</style>
