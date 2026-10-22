<!--
  SettingsSheet.svelte — Centro impostazioni della PWA.
  Presentazione dialog Studio / bottom sheet su telefoni: superficie bg-overlay,
  ombra overlay, sezioni allineate a Studio Settings, controlli .ui-* e icone Lucide.
-->
<script lang="ts">
	import type { DeviceListItem, HostSummary, CreateCodeResponse } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconClose, IconPlus, IconLogout, IconTrash, IconLaptop, IconMachine, IconPhone } from '../icons.ts';
	import CodeModal from './CodeModal.svelte';
	import PushNotificationToggle from './PushNotificationToggle.svelte';
	import StatusMark from './StatusMark.svelte';

	let { onClose } = $props<{ onClose: () => void }>();

	let devices = $state<DeviceListItem[]>([]);
	let loadingDevices = $state(true);
	let activeCode = $state<CreateCodeResponse | null>(null);

	let hostToRevoke = $state<HostSummary | null>(null);
	let deviceToRevoke = $state<DeviceListItem | null>(null);
	let isRevoking = $state(false);

	$effect(() => {
		void loadData();
	});

	async function loadData(): Promise<void> {
		loadingDevices = true;
		try {
			devices = await connection.fetchDevices();
		} catch {
			// ignora errori transitori
		} finally {
			loadingDevices = false;
		}
	}

	async function handleAddDevice(): Promise<void> {
		try {
			activeCode = await connection.createPairingCode('device');
		} catch (err) {
			alert('Errore generazione codice: ' + (err as Error).message);
		}
	}

	async function handlePairHost(): Promise<void> {
		try {
			activeCode = await connection.createPairingCode('host');
		} catch (err) {
			alert('Errore generazione codice: ' + (err as Error).message);
		}
	}

	async function handleLogout(): Promise<void> {
		await connection.logout();
		onClose();
	}

	async function confirmRevokeHostAction(): Promise<void> {
		if (!hostToRevoke || isRevoking) return;
		isRevoking = true;
		try {
			await connection.revokeHost(hostToRevoke.id);
			hostToRevoke = null;
		} catch (err) {
			alert('Errore revoca: ' + (err as Error).message);
		} finally {
			isRevoking = false;
		}
	}

	async function confirmRevokeDeviceAction(): Promise<void> {
		if (!deviceToRevoke || isRevoking) return;
		isRevoking = true;
		try {
			await connection.revokeDevice(deviceToRevoke.id);
			deviceToRevoke = null;
			await loadData();
		} catch (err) {
			alert('Errore revoca: ' + (err as Error).message);
		} finally {
			isRevoking = false;
		}
	}
</script>

<div
	class="sheet-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="sheet-surface rv-lift"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } else { e.stopPropagation(); } }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="sheet-header safe-top">
			<h2 class="sheet-title">{t('settingsTitle')}</h2>
			<button
				type="button"
				class="ui-button ui-button-ghost close-icon-btn"
				onclick={onClose}
				aria-label={t('close')}
			>
				<IconClose />
			</button>
		</div>

		<div class="sheet-body safe-bottom">
			<!-- Questo dispositivo -->
			<section class="settings-section">
				<h3 class="section-title">{t('thisDevice')}</h3>
				<div class="device-card">
					<div class="device-info">
						<span class="device-name">{connection.device?.name || 'Questo dispositivo'}</span>
						<span class="ui-chip current-chip">{t('currentDeviceBadge')}</span>
					</div>
					<button
						type="button"
						class="ui-button ui-button-danger logout-btn"
						onclick={handleLogout}
					>
						<IconLogout />
						<span>{t('logout')}</span>
					</button>
				</div>
				{#if connection.relayInfo?.version}
					<div class="relay-version-meta">
						{t('relayVersion', { version: connection.relayInfo.version })}
					</div>
				{/if}
			</section>

			<!-- Notifiche push -->
			<section class="settings-section">
				<PushNotificationToggle />
			</section>

			<!-- Azioni di abbinamento -->
			<section class="settings-section">
				<div class="actions-grid">
					<button
						type="button"
						class="ui-button ui-button-primary action-btn"
						onclick={handleAddDevice}
					>
						<IconPlus />
						<span>{t('addDeviceBtn')}</span>
					</button>
					<button
						type="button"
						class="ui-button ui-button-secondary action-btn"
						onclick={handlePairHost}
					>
						<IconPlus />
						<span>{t('pairHostBtn')}</span>
					</button>
				</div>
			</section>

			<!-- Macchine abbinate -->
			<section class="settings-section">
				<div class="section-title-row">
					<h3 class="section-title">{t('machinesList')}</h3>
					<span class="ui-count">{connection.hosts.length}</span>
				</div>

				<div class="items-list">
					{#each connection.hosts as host (host.id)}
						<div class="item-row">
							<div class="item-meta">
								<div class="name-line">
									<span class="platform-icon" aria-hidden="true">
										{#if host.platform === 'macos'}
											<IconLaptop />
										{:else}
											<IconMachine />
										{/if}
									</span>
									<span class="item-name">{host.name}</span>
								</div>
								<div class="item-status-line">
									<StatusMark status={host.online ? 'completed' : 'pending'} active={false} />
									<span class="status-desc">
										{host.platform} · {host.online ? t('online') : (host.lastSeenAt ? formatHHMM(host.lastSeenAt) : t('offline'))}
									</span>
								</div>
							</div>
							<button
								type="button"
								class="ui-button ui-button-ghost revoke-btn"
								onclick={() => (hostToRevoke = host)}
							>
								<IconTrash />
								<span>{t('revoke')}</span>
							</button>
						</div>
					{/each}
					{#if connection.hosts.length === 0}
						<div class="empty-list">{t('noMachines')}</div>
					{/if}
				</div>
			</section>

			<!-- Dispositivi autorizzati -->
			<section class="settings-section">
				<div class="section-title-row">
					<h3 class="section-title">{t('devicesList')}</h3>
					<span class="ui-count">{devices.length}</span>
				</div>

				<div class="items-list">
					{#each devices as dev (dev.id)}
						<div class="item-row" class:is-current={dev.current}>
							<div class="item-meta">
								<div class="name-line">
									<span class="item-name">{dev.name}</span>
									{#if dev.current}
										<span class="ui-chip current-chip">{t('currentDeviceBadge')}</span>
									{/if}
								</div>
								<span class="item-detail">
									{dev.online ? t('online') : (dev.lastSeenAt ? formatHHMM(dev.lastSeenAt) : '')}
								</span>
							</div>
							{#if !dev.current}
								<button
									type="button"
									class="ui-button ui-button-ghost revoke-btn"
									onclick={() => (deviceToRevoke = dev)}
								>
									<IconTrash />
									<span>{t('revoke')}</span>
								</button>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		</div>
	</div>
</div>

<!-- Modal conferma revoca macchina -->
{#if hostToRevoke}
	<div class="sheet-backdrop confirm-backdrop" role="presentation">
		<div class="confirm-surface rv-lift" role="dialog" aria-modal="true">
			<h4 class="confirm-title">{t('revokeMachine')}</h4>
			<p class="confirm-text">{t('revokeMachineConfirm', { name: hostToRevoke.name })}</p>
			<div class="confirm-buttons">
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={isRevoking}
					onclick={() => (hostToRevoke = null)}
				>
					{t('cancel')}
				</button>
				<button
					type="button"
					class="ui-button ui-button-danger"
					disabled={isRevoking}
					onclick={confirmRevokeHostAction}
				>
					{t('revoke')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal conferma revoca dispositivo -->
{#if deviceToRevoke}
	<div class="sheet-backdrop confirm-backdrop" role="presentation">
		<div class="confirm-surface rv-lift" role="dialog" aria-modal="true">
			<h4 class="confirm-title">{t('revoke')}</h4>
			<p class="confirm-text">{t('revokeConfirm')}</p>
			<div class="confirm-buttons">
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={isRevoking}
					onclick={() => (deviceToRevoke = null)}
				>
					{t('cancel')}
				</button>
				<button
					type="button"
					class="ui-button ui-button-danger"
					disabled={isRevoking}
					onclick={confirmRevokeDeviceAction}
				>
					{t('revoke')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal visualizzazione codice abbinamento -->
{#if activeCode}
	<CodeModal codeData={activeCode} onClose={() => (activeCode = null)} />
{/if}

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 200;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0;
	}

	@media (min-width: 640px) {
		.sheet-backdrop {
			align-items: center;
			padding: var(--space-4);
		}
	}

	.sheet-surface {
		width: 100%;
		max-width: 580px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		max-height: 90dvh;
		overflow: hidden;
	}

	@media (min-width: 640px) {
		.sheet-surface {
			border-radius: var(--radius-xl);
		}
	}

	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-4);
		border-bottom: 1px solid var(--line);
	}

	.sheet-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.close-icon-btn {
		width: 32px;
		height: 32px;
		--icon-size: 16px;
	}

	.sheet-body {
		padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		overflow-y: auto;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.section-title {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0;
	}

	.device-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
	}

	.device-info {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.device-name {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
	}

	.current-chip {
		height: 18px;
		padding: 0 6px;
		font-size: var(--text-meta);
	}

	.logout-btn {
		height: 28px;
		padding: 0 10px;
		font-size: var(--text-meta);
		gap: 4px;
		--icon-size: 12px;
	}

	.relay-version-meta {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		padding: 0 var(--space-1);
	}

	.actions-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.action-btn {
		height: 36px;
		font-size: var(--text-caption);
		gap: 6px;
		--icon-size: 14px;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		overflow: hidden;
	}

	.item-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
		gap: var(--space-2);
	}

	.item-row:last-child {
		border-bottom: none;
	}

	.item-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.name-line {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.platform-icon {
		color: var(--ink-muted);
		--icon-size: 14px;
		display: grid;
		place-items: center;
	}

	.item-name {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-status-line {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.status-desc,
	.item-detail {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.revoke-btn {
		height: 26px;
		padding: 0 8px;
		font-size: var(--text-meta);
		color: var(--danger);
		gap: 4px;
		--icon-size: 12px;
	}

	.revoke-btn:hover {
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
	}

	.empty-list {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.confirm-backdrop {
		z-index: 220;
		align-items: center;
		padding: var(--space-4);
	}

	.confirm-surface {
		width: 100%;
		max-width: 400px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-xl);
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.confirm-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.confirm-text {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
		margin: 0;
	}

	.confirm-buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
