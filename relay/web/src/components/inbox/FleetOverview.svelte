<!--
  FleetOverview.svelte — Vista riepilogo macchine a destra su desktop quando non c'è una chat aperta.
  Mostra stato reale di salute delle macchine, quote e pulsanti di avvio rapido.
-->
<script lang="ts">
	import type { HostSummary } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { connection } from '../../connection.svelte.ts';
	import QuotaCard from '../QuotaCard.svelte';
	import ProjectSheet from '../ProjectSheet.svelte';
	import { IconMachine, IconLaptop, IconSparkles, IconFolder } from '../../icons.ts';

	let {
		onStartNewChat
	}: {
		onStartNewChat: (hostId?: string, projectId?: string) => void;
	} = $props();

	let activeProjectSheetHost = $state<HostSummary | null>(null);

	function countWorkingSessions(hostId: string): number {
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

	function countQueuedTasks(hostId: string): number {
		const state = connection.hostStates[hostId]?.state;
		if (!state?.projects) return 0;
		let count = 0;
		for (const p of state.projects) {
			if (p.tasks) count += p.tasks.length;
		}
		return count;
	}
</script>

<div class="fleet-overview">
	<div class="overview-content readable">
		<header class="overview-header">
			<h2 class="overview-title">{t('noActiveSession')}</h2>
			<p class="overview-hint">{t('noActiveSessionHint')}</p>
		</header>

		<div class="machines-grid">
			{#each connection.hosts as host (host.id)}
				{@const snapshot = connection.hostStates[host.id]}
				{@const workingCount = countWorkingSessions(host.id)}
				{@const queuedCount = countQueuedTasks(host.id)}

				<div class="machine-card" class:is-offline={!host.online}>
					<div class="machine-card-lead">
						<span class="platform-icon" aria-hidden="true">
							{#if host.platform === 'macos'}
								<IconLaptop />
							{:else}
								<IconMachine />
							{/if}
						</span>

						<div class="machine-info">
							<div class="machine-title-line">
								<span class="machine-name">{host.name}</span>
								<span class="status-dot" class:online={host.online} aria-hidden="true"></span>
							</div>
							<div class="machine-meta font-mono">
								{host.platform || 'remote'}
								{#if host.online}
									· {t('online')}
								{:else}
									· {t('offline')}
								{/if}
							</div>
						</div>

						<div class="machine-stats">
							{#if workingCount > 0}
								<div class="stat-working">{workingCount} {t('stateWorking')}</div>
							{/if}
							{#if queuedCount > 0}
								<div class="stat-queued">{t('queuedCountSuffix', { count: queuedCount })}</div>
							{/if}
						</div>
					</div>

					<!-- Quote della macchina se disponibili -->
					{#if snapshot?.state?.quota}
						<div class="machine-quota-wrap">
							<QuotaCard quota={snapshot.state.quota} />
						</div>
					{/if}

					<!-- Azioni rapide della macchina -->
					{#if host.online && host.features.includes('projects')}
						<div class="machine-actions">
							<button
								type="button"
								class="ui-button ui-button-ghost btn-sm"
								onclick={() => (activeProjectSheetHost = host)}
							>
								<IconFolder />
								<span>{t('openOrCreateProject')}</span>
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="overview-actions">
			<button
				type="button"
				class="ui-button ui-button-primary btn-large"
				onclick={() => onStartNewChat()}
			>
				<IconSparkles />
				<span>{t('newChat')}</span>
			</button>
		</div>
	</div>

	{#if activeProjectSheetHost}
		<ProjectSheet
			host={activeProjectSheetHost}
			onClose={() => (activeProjectSheetHost = null)}
		/>
	{/if}
</div>

<style>
	.fleet-overview {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		background: var(--bg-sunken);
		padding: 32px 24px;
	}

	.overview-content {
		max-width: 680px;
		margin: 0 auto;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.overview-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.overview-title {
		font-size: var(--text-title, 18px);
		font-weight: 700;
		color: var(--ink);
		margin: 0;
	}

	.overview-hint {
		font-size: var(--text-caption, 13px);
		color: var(--ink-muted);
		margin: 0;
		line-height: 1.5;
	}

	.machines-grid {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.machine-card {
		padding: 16px;
		border-radius: var(--radius-xl);
		background: var(--bg-base);
		border: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.machine-card.is-offline {
		opacity: 0.75;
	}

	.machine-card-lead {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.platform-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		flex-shrink: 0;
		--icon-size: 18px;
	}

	.machine-info {
		flex: 1;
		min-width: 0;
	}

	.machine-title-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.machine-name {
		font-size: var(--text-label, 14px);
		font-weight: 600;
		color: var(--ink);
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.status-dot.online {
		background: var(--color-success, var(--brand));
	}

	.machine-meta {
		font-size: var(--text-mini, 11px);
		color: var(--ink-muted);
		margin-top: 2px;
	}

	.machine-stats {
		text-align: right;
		font-size: var(--text-mini, 11px);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-working {
		color: var(--color-success, var(--brand));
		font-weight: 600;
	}

	.stat-queued {
		color: var(--ink-muted);
	}

	.machine-quota-wrap {
		border-top: 1px solid var(--line);
		padding-top: 10px;
	}

	.machine-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		border-top: 1px solid var(--line);
		padding-top: 10px;
	}

	.btn-sm {
		padding: 4px 10px;
		font-size: var(--text-caption, 12px);
		height: auto;
		min-height: 28px;
	}

	.overview-actions {
		display: flex;
		justify-content: flex-start;
		padding-top: 8px;
	}

	.btn-large {
		padding: 10px 20px;
		font-size: var(--text-label, 14px);
		border-radius: var(--radius-xl);
	}
</style>
