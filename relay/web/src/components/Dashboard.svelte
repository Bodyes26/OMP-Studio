<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import HostSection from './HostSection.svelte';

	let { onOpenSettings } = $props<{ onOpenSettings: () => void }>();
</script>

<div class="dashboard safe-bottom">
	{#if connection.hosts.length > 0}
		<div class="hosts-grid">
			{#each connection.hosts as host (host.id)}
				<HostSection
					{host}
					snapshot={connection.hostStates[host.id]}
				/>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<div class="empty-icon">🖥</div>
			<h2 class="empty-title">{t('noMachines')}</h2>
			<p class="empty-hint">{t('noMachinesHint')}</p>
			<button class="btn btn-primary" onclick={onOpenSettings}>
				{t('pairHostBtn')}
			</button>
		</div>
	{/if}
</div>

<style>
	.dashboard {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 900px;
		margin: 0 auto;
		width: 100%;
	}

	.hosts-grid {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 60px 20px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		gap: 12px;
	}

	.empty-icon {
		font-size: 36px;
		margin-bottom: 4px;
	}

	.empty-title {
		font-size: 16px;
		font-weight: 650;
		color: var(--ink);
	}

	.empty-hint {
		font-size: 13px;
		color: var(--ink-muted);
		max-width: 320px;
		margin-bottom: 8px;
	}
</style>
