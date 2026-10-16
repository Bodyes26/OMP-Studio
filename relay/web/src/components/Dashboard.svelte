<!--
  Dashboard.svelte — Quadro principale di Studio Fleet Hub (Variante A).
  Navigazione tra Inbox unificata (Variante A), Cronologia sessioni storiche e Macchine/Progetti.
  Preserva al 100% tutte le funzionalità esistenti: quote, task, creazione progetti, macchine offline.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconMachine } from '../icons.ts';
	import HostSection from './HostSection.svelte';
	import InboxView from './inbox/InboxView.svelte';
	import HistoryView from './inbox/HistoryView.svelte';
	import NewChatModal from './inbox/NewChatModal.svelte';

	let { onOpenSettings } = $props<{ onOpenSettings: () => void }>();

	let activeTab = $state<'inbox' | 'history' | 'machines'>('inbox');
	let hostFilter = $state<string>('all');
	let showNewChat = $state(false);
	let newChatHostId = $state<string | undefined>(undefined);
	let newChatProjectId = $state<string | undefined>(undefined);

	function handleStartNewChat(hostId?: string, projectId?: string) {
		newChatHostId = hostId;
		newChatProjectId = projectId;
		showNewChat = true;
	}

	// Calcola se ci sono richieste di attenzione in sospeso
	const pendingAttentionCount = $derived.by(() => {
		let count = 0;
		for (const host of connection.hosts) {
			const state = connection.hostStates[host.id]?.state;
			if (!state?.projects) continue;
			for (const p of state.projects) {
				if (p.attention) count += p.attention.length;
			}
		}
		return count;
	});
</script>

<div class="dashboard-container">
	{#if connection.hosts.length > 0}
		<!-- Navigazione a schede: Inbox, Cronologia, Macchine -->
		<nav class="dashboard-tabs-bar" aria-label="Navigazione principale">
			<button
				type="button"
				class="dash-tab-btn"
				class:active={activeTab === 'inbox'}
				onclick={() => (activeTab = 'inbox')}
			>
				<span>{t('tabInbox')}</span>
				{#if pendingAttentionCount > 0}
					<span class="tab-badge attention font-mono">{pendingAttentionCount}</span>
				{/if}
			</button>

			<button
				type="button"
				class="dash-tab-btn"
				class:active={activeTab === 'history'}
				onclick={() => (activeTab = 'history')}
			>
				<span>{t('tabHistory')}</span>
			</button>

			<button
				type="button"
				class="dash-tab-btn"
				class:active={activeTab === 'machines'}
				onclick={() => (activeTab = 'machines')}
			>
				<span>{t('tabMachines')}</span>
			</button>
		</nav>

		<!-- Corpo della vista selezionata -->
		<div class="dashboard-view-body">
			{#if activeTab === 'inbox'}
				<InboxView
					bind:hostFilter
					onStartNewChat={handleStartNewChat}
				/>
			{:else if activeTab === 'history'}
				<HistoryView
					{hostFilter}
				/>
			{:else}
				<!-- Vista Macchine & Progetti (vista legacy completa preservata) -->
				<div class="machines-legacy-view safe-bottom">
					<div class="hosts-list">
						{#each connection.hosts as host (host.id)}
							<HostSection
								{host}
								snapshot={connection.hostStates[host.id]}
							/>
						{/each}
					</div>
				</div>
			{/if}
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

	{#if showNewChat}
		<NewChatModal
			initialHostId={newChatHostId}
			initialProjectId={newChatProjectId}
			onClose={() => {
				showNewChat = false;
				newChatHostId = undefined;
				newChatProjectId = undefined;
			}}
		/>
	{/if}
</div>

<style>
	.dashboard-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: var(--bg-sunken);
	}

	.dashboard-tabs-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.dash-tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: var(--radius-full);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-caption, 12px);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		user-select: none;
	}

	.dash-tab-btn:hover {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.dash-tab-btn.active {
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
		font-weight: 600;
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 5px;
		min-width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	.tab-badge.attention {
		background: var(--color-warn, #f59e0b);
		color: #ffffff;
	}

	.dashboard-view-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.machines-legacy-view {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4);
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
		margin: var(--space-6) var(--space-4);
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
