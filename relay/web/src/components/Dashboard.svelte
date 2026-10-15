<!--
  Dashboard.svelte — Quadro principale con le sezioni delle macchine.
  Linguaggio Studio: layout piatto a righe, nessuna card annidata.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconMachine } from '../icons.ts';
	import HostSection from './HostSection.svelte';

	let { onOpenSettings } = $props<{ onOpenSettings: () => void }>();
</script>

<div class="dashboard safe-bottom">
	{#if connection.hosts.length > 0}
		<div class="hosts-list">
			{#each connection.hosts as host (host.id)}
				<HostSection
					{host}
					snapshot={connection.hostStates[host.id]}
				/>
			{/each}
		</div>
	{:else}
		<div class="empty-state rv-lift">
			<div class="empty-icon-slot" aria-hidden="true">
				<IconMachine />
			</div>
			<h2 class="empty-title">{t('noMachines')}</h2>
			<p class="empty-hint">{t('noMachinesHint')}</p>
			<button type="button" class="ui-button ui-button-primary" onclick={onOpenSettings}>
				{t('pairHostBtn')}
			</button>
		</div>
	{/if}
</div>

<style>
	.dashboard {
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		max-width: 760px;
		margin: 0 auto;
		width: 100%;
		box-sizing: border-box;
	}

	.hosts-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: var(--space-8) var(--space-4);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-dock);
		gap: var(--space-3);
		margin-top: var(--space-6);
	}

	.empty-icon-slot {
		color: var(--ink-faint);
		--icon-size: 28px;
		display: grid;
		place-items: center;
		margin-bottom: var(--space-1);
	}

	.empty-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.empty-hint {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		max-width: 320px;
		line-height: 1.5;
		margin: 0 0 var(--space-2) 0;
	}
</style>
