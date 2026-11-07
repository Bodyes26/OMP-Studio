<!--
  MachinesSheet.svelte — Foglio di selezione e gestione delle macchine (Gate R48, R-REM-01, R-REM-16).
  Elenca le macchine abbinate con stato online, numero di progetti aperti e richieste pendenti.
  Offre accesso rapido ad apertura/creazione progetti (ProjectSheet) e impostazioni globali (SettingsSheet).
-->
<script lang="ts">
	import type { HostSummary, HostState } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import {
		IconClose,
		IconCheck,
		IconSettings,
		IconFolder,
		IconLaptop,
		IconMachine
	} from '../icons.ts';
	import { getProjectStatus } from '../projectHelpers.ts';
	import { scrim, bottomSheet } from '../motion.ts';
	let {
		currentHostId,
		onSelectHost,
		onOpenProjectSheet,
		onOpenSettings,
		onClose
	}: {
		currentHostId: string;
		onSelectHost: (hostId: string) => void;
		onOpenProjectSheet: (host: HostSummary) => void;
		onOpenSettings: () => void;
		onClose: () => void;
	} = $props();

	interface HostDisplayItem {
		host: HostSummary;
		projectsCount: number;
		questionCount: number;
		isSelected: boolean;
	}

	const hostsList = $derived.by<HostDisplayItem[]>(() => {
		return connection.hosts.map((host) => {
			const state = connection.hostStates[host.id]?.state;
			const projects = state?.projects ?? [];
			const questionCount = projects.filter((p) => getProjectStatus(p) === 'question').length;
			return {
				host,
				projectsCount: projects.length,
				questionCount,
				isSelected: host.id === currentHostId
			};
		});
	});

	const currentHost = $derived(
		connection.hosts.find((h) => h.id === currentHostId) ?? connection.hosts[0]
	);
</script>

<div class="backdrop" transition:scrim onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
	<div class="sheet" transition:bottomSheet role="dialog" aria-modal="true" aria-label={t('machinesTitle')}>
		<div class="grip" aria-hidden="true"></div>

		<div class="sheet-head">
			<div class="head-titles">
				<h2>{t('machinesTitle')}</h2>
			</div>
			<button
				type="button"
				class="icon-btn"
				onclick={onClose}
				aria-label={t('close')}
				title={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="sheet-body">
			<div class="machines-list">
				{#each hostsList as item (item.host.id)}
					<button
						type="button"
						class="machine-item"
						class:selected={item.isSelected}
						onclick={() => {
							onSelectHost(item.host.id);
							onClose();
						}}
					>
						<span class="machine-icon" aria-hidden="true">
							{#if item.host.platform === 'macos'}
								<IconLaptop />
							{:else}
								<IconMachine />
							{/if}
						</span>

						<span class="machine-info">
							<span class="machine-title-row">
								<span class="machine-name">{item.host.name}</span>
								{#if !item.host.online}
									<span class="offline-tag">{t('offline')}</span>
								{/if}
							</span>

							<span class="machine-sub">
								{item.projectsCount === 1 ? t('openProjectsCountOne') : t('openProjectsCount', { count: item.projectsCount })}
								{#if item.questionCount > 0}
									<span class="question-count">
										· {item.questionCount === 1 ? t('machinePendingRequestsOne') : t('machinePendingRequests', { count: item.questionCount })}
									</span>
								{/if}
							</span>
						</span>

						{#if item.isSelected}
							<span class="check-icon" aria-label={t('machineSelected')}>
								<IconCheck />
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="sheet-foot">
			{#if currentHost && currentHost.features.includes('projects')}
				<button
					type="button"
					class="foot-btn"
					onclick={() => {
						onOpenProjectSheet(currentHost);
						onClose();
					}}
				>
					<IconFolder />
					<span>{t('openOrCreateProject')}</span>
				</button>
			{/if}

			<button
				type="button"
				class="foot-btn secondary"
				onclick={() => {
					onOpenSettings();
					onClose();
				}}
			>
				<IconSettings />
				<span>{t('settings')}</span>
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: color-mix(in oklch, var(--ink) 35%, transparent);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: min(88dvh, var(--app-h, 100dvh));
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border-radius: 18px 18px 0 0;
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		box-shadow: var(--shadow-overlay);
	}

	.grip {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--line-strong);
		margin: 0 auto 8px;
		flex-shrink: 0;
	}

	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.head-titles h2 {
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
		margin: 0;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		border-radius: 50%;
	}

	.sheet-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 0;
		-webkit-overflow-scrolling: touch;
	}

	.machines-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.machine-item {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		text-align: left;
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		cursor: pointer;
		min-height: 52px;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.machine-item:hover {
		background: var(--bg-hover);
	}

	.machine-item.selected {
		border-color: var(--brand);
		background: color-mix(in oklch, var(--brand) 8%, var(--bg-sunken));
	}

	.machine-icon {
		color: var(--ink-muted);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.machine-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.machine-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.machine-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.offline-tag {
		font-size: 11px;
		color: var(--danger);
		background: color-mix(in oklch, var(--danger) 12%, transparent);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.machine-sub {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.question-count {
		color: var(--warn);
		font-weight: 600;
	}

	.check-icon {
		color: var(--brand);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.sheet-foot {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	.foot-btn {
		width: 100%;
		min-height: 44px;
		padding: 0 16px;
		border-radius: var(--radius-md);
		background: var(--brand);
		color: var(--bg-base);
		font-size: var(--text-sm);
		font-weight: 600;
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.foot-btn.secondary {
		background: var(--bg-sunken);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.foot-btn:hover {
		opacity: 0.92;
	}

</style>
