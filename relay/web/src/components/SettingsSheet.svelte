<script lang="ts">
	import type { DeviceListItem, HostSummary, CreateCodeResponse } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { formatHHMM } from '../schedule.ts';
	import { connection } from '../connection.svelte.ts';
	import CodeModal from './CodeModal.svelte';
	import PushNotificationToggle from './PushNotificationToggle.svelte';

	let { onClose } = $props<{ onClose: () => void }>();

	let devices = $state<DeviceListItem[]>([]);
	let loadingDevices = $state(true);
	let activeCode = $state<CreateCodeResponse | null>(null);

	let hostToRevoke = $state<HostSummary | null>(null);
	let deviceToRevoke = $state<DeviceListItem | null>(null);
	let isRevoking = $state(false);

	$effect(() => {
		loadData();
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
	class="settings-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="settings-sheet"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="sheet-header safe-top">
			<h2 class="sheet-title">{t('settingsTitle')}</h2>
			<button class="btn btn-ghost close-icon-btn" onclick={onClose} aria-label={t('close')}>
				✕
			</button>
		</div>

		<div class="sheet-body safe-bottom">
			<!-- Questo dispositivo -->
			<section class="settings-section">
				<h3 class="section-title">{t('thisDevice')}</h3>
				<div class="device-card current">
					<div class="device-info">
						<span class="device-name">{connection.device?.name || 'Questo dispositivo'}</span>
						<span class="device-badge">{t('currentDeviceBadge')}</span>
					</div>
					<button class="btn btn-danger logout-btn" onclick={handleLogout}>
						{t('logout')}
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
					<button class="btn btn-primary action-btn" onclick={handleAddDevice}>
						{t('addDeviceBtn')}
					</button>
					<button class="btn btn-secondary action-btn" onclick={handlePairHost}>
						{t('pairHostBtn')}
					</button>
				</div>
			</section>

			<!-- Macchine abbinate -->
			<section class="settings-section">
				<h3 class="section-title">{t('machinesList')}</h3>
				<div class="items-list">
					{#each connection.hosts as host (host.id)}
						<div class="item-row">
							<div class="item-meta">
								<span class="item-name">{host.name}</span>
								<span class="item-detail">
									{host.platform} · {host.online ? t('online') : (host.lastSeenAt ? formatHHMM(host.lastSeenAt) : t('offline'))}
								</span>
							</div>
							<button
								class="btn btn-danger btn-sm"
								onclick={() => (hostToRevoke = host)}
							>
								{t('revoke')}
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
				<h3 class="section-title">{t('devicesList')}</h3>
				<div class="items-list">
					{#each devices as dev (dev.id)}
						<div class="item-row" class:is-current={dev.current}>
							<div class="item-meta">
								<div class="name-with-badge">
									<span class="item-name">{dev.name}</span>
									{#if dev.current}
										<span class="badge-mini">{t('currentDeviceBadge')}</span>
									{/if}
								</div>
								<span class="item-detail">
									{dev.online ? t('online') : (dev.lastSeenAt ? formatHHMM(dev.lastSeenAt) : '')}
								</span>
							</div>
							{#if !dev.current}
								<button
									class="btn btn-danger btn-sm"
									onclick={() => (deviceToRevoke = dev)}
								>
									{t('revoke')}
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
	<div class="confirm-backdrop" role="presentation">
		<div class="confirm-box" role="dialog">
			<h4 class="confirm-title">{t('revokeMachine')}</h4>
			<p class="confirm-text">{t('revokeMachineConfirm', { name: hostToRevoke.name })}</p>
			<div class="confirm-buttons">
				<button class="btn btn-secondary" disabled={isRevoking} onclick={() => (hostToRevoke = null)}>
					{t('cancel')}
				</button>
				<button class="btn btn-danger" disabled={isRevoking} onclick={confirmRevokeHostAction}>
					{t('revoke')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal conferma revoca dispositivo -->
{#if deviceToRevoke}
	<div class="confirm-backdrop" role="presentation">
		<div class="confirm-box" role="dialog">
			<h4 class="confirm-title">{t('revoke')}</h4>
			<p class="confirm-text">{t('revokeConfirm')}</p>
			<div class="confirm-buttons">
				<button class="btn btn-secondary" disabled={isRevoking} onclick={() => (deviceToRevoke = null)}>
					{t('cancel')}
				</button>
				<button class="btn btn-danger" disabled={isRevoking} onclick={confirmRevokeDeviceAction}>
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
	.settings-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.65);
		backdrop-filter: blur(4px);
		display: flex;
		justify-content: flex-end;
		z-index: 150;
	}

	.settings-sheet {
		width: 100%;
		max-width: 480px;
		height: 100%;
		background: var(--bg-base);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		box-shadow: -4px 0 24px oklch(0 0 0 / 0.4);
	}

	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
	}

	.sheet-title {
		font-size: 17px;
		font-weight: 700;
		color: var(--ink);
	}

	.close-icon-btn {
		width: 36px;
		height: 36px;
		font-size: 16px;
	}

	.sheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.section-title {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--ink-faint);
	}

	.device-card {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 12px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.device-info {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.device-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
	}

	.device-badge, .badge-mini {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		background: var(--bg-active);
		color: var(--ink);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.logout-btn {
		min-height: 36px;
		padding: 6px 12px;
		font-size: 12px;
	}

	.relay-version-meta {
		font-size: 11px;
		color: var(--ink-faint);
		padding-left: 2px;
		font-family: var(--font-mono);
	}

	.actions-grid {
		display: flex;
		gap: 10px;
	}

	.action-btn {
		flex: 1;
		height: 44px;
		font-size: 13px;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.item-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}

	.item-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name-with-badge {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.item-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}

	.item-detail {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.btn-sm {
		min-height: 32px;
		padding: 4px 10px;
		font-size: 11px;
	}

	.empty-list {
		font-size: 13px;
		color: var(--ink-faint);
		padding: 12px 0;
	}

	/* Dialog di conferma */
	.confirm-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 220;
	}

	.confirm-box {
		width: 100%;
		max-width: 360px;
		background: var(--bg-base);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.confirm-title {
		font-size: 15px;
		font-weight: 700;
		color: var(--ink);
	}

	.confirm-text {
		font-size: 13px;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.confirm-buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
	}
</style>
