<!--
  PushNotificationToggle.svelte — Controllo sottoscrizione notifiche push.
  Linguaggio Studio: chip di stato semantico (.ui-chip),
  testo in --ink-muted, pulsante azione .ui-button-*.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconBell, IconBellOff, IconRefresh } from '../icons.ts';
	import StatusMark from './StatusMark.svelte';

	type PushState = 'checking' | 'active' | 'inactive' | 'denied' | 'unsupported' | 'unregistered';

	let pushState = $state<PushState>('checking');
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);

	const isIos = typeof navigator !== 'undefined' && (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);

	const isStandalone = typeof window !== 'undefined' && (
		window.matchMedia('(display-mode: standalone)').matches ||
		('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone === true)
	);

	const isSupported = typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window;

	$effect(() => {
		void checkPushStatus();
	});

	async function checkPushStatus(): Promise<void> {
		if (!isSupported) {
			pushState = 'unsupported';
			return;
		}

		if (Notification.permission === 'denied') {
			pushState = 'denied';
			return;
		}

		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (!sub) {
				pushState = 'inactive';
				return;
			}
			try {
				await connection.savePushSubscription(sub, navigator.userAgent);
				pushState = 'active';
			} catch {
				pushState = 'unregistered';
				errorMessage = t('notificationsSyncError');
			}
		} catch {
			pushState = 'inactive';
		}
	}

	function urlBase64ToUint8Array(base64String: string): Uint8Array {
		const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	async function handleEnablePush(): Promise<void> {
		loading = true;
		errorMessage = null;
		try {
			const permission = await Notification.requestPermission();
			if (permission === 'denied') {
				pushState = 'denied';
				return;
			}
			if (permission !== 'granted') {
				pushState = 'inactive';
				return;
			}

			const reg = await navigator.serviceWorker.ready;
			const vapidKey = await connection.fetchVapidPublicKey();
			const appServerKey = urlBase64ToUint8Array(vapidKey);

			let sub = await reg.pushManager.getSubscription();
			if (!sub) {
				sub = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: appServerKey.buffer as ArrayBuffer
				});
			}

			try {
				await connection.savePushSubscription(sub, navigator.userAgent);
				pushState = 'active';
			} catch (saveErr) {
				pushState = 'unregistered';
				errorMessage = (saveErr as Error).message || t('notificationsSyncError');
				return;
			}
		} catch (err) {
			errorMessage = (err as Error).message || 'Errore durante la registrazione push';
			await checkPushStatus();
		} finally {
			loading = false;
		}
	}

	async function handleDisablePush(): Promise<void> {
		loading = true;
		errorMessage = null;
		try {
			const reg = await navigator.serviceWorker.ready;
			const sub = await reg.pushManager.getSubscription();
			if (sub) {
				await connection.deletePushSubscription(sub.endpoint).catch(() => {});
				await sub.unsubscribe();
			}
			pushState = 'inactive';
		} catch (err) {
			errorMessage = (err as Error).message || 'Errore durante la disattivazione';
		} finally {
			loading = false;
		}
	}
</script>

<div class="push-section">
	<div class="push-header">
		<div class="push-title-row">
			<span class="push-title">{t('notificationsTitle')}</span>
			{#if pushState === 'active'}
				<span class="ui-chip status-active">
					<StatusMark status="completed" />
					<span>{t('notificationsActive')}</span>
				</span>
			{:else if pushState === 'unregistered'}
				<span class="ui-chip status-warn">
					<StatusMark status="attention" />
					<span>{t('notificationsUnregistered')}</span>
				</span>
			{:else if pushState === 'denied'}
				<span class="ui-chip status-denied">
					<StatusMark status="failed" />
					<span>{t('notificationsDenied')}</span>
				</span>
			{:else if pushState === 'unsupported'}
				<span class="ui-chip status-unsupported">{t('notificationsUnsupported')}</span>
			{/if}
		</div>
		<p class="push-desc">{t('notificationsDesc')}</p>
	</div>

	{#if errorMessage}
		<div class="push-error" role="alert">{errorMessage}</div>
	{/if}

	{#if isIos && !isStandalone && pushState === 'unsupported'}
		<div class="ios-hint">
			<p>{t('notificationsIosHint')}</p>
		</div>
	{:else if pushState === 'active'}
		<button
			type="button"
			class="ui-button ui-button-secondary push-action-btn"
			onclick={handleDisablePush}
			disabled={loading}
		>
			<IconBellOff />
			<span>{loading ? t('notificationsEnabling') : t('disableNotifications')}</span>
		</button>
	{:else if pushState === 'unregistered'}
		<button
			type="button"
			class="ui-button ui-button-primary push-action-btn"
			onclick={handleEnablePush}
			disabled={loading}
		>
			<IconRefresh />
			<span>{loading ? t('notificationsEnabling') : t('retrySync')}</span>
		</button>
	{:else if pushState === 'inactive'}
		<button
			type="button"
			class="ui-button ui-button-primary push-action-btn"
			onclick={handleEnablePush}
			disabled={loading}
		>
			<IconBell />
			<span>{loading ? t('notificationsEnabling') : t('enableNotifications')}</span>
		</button>
	{/if}
</div>

<style>
	.push-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
	}

	.push-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.push-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.push-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.push-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
		margin: 0;
	}

	.push-error {
		padding: 6px 10px;
		background: color-mix(in oklab, var(--danger) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: var(--text-caption);
	}

	.ios-hint {
		padding: 8px 10px;
		background: var(--bg-base);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.ios-hint p {
		margin: 0;
	}

	.push-action-btn {
		align-self: flex-start;
		height: 32px;
		padding: 0 12px;
		font-size: var(--text-caption);
		gap: 6px;
		--icon-size: 14px;
	}

	.status-active,
	.status-warn,
	.status-denied,
	.status-unsupported {
		height: 22px;
		padding: 0 8px;
		font-size: var(--text-meta);
	}

	.status-warn {
		color: var(--warn);
	}

	.status-denied {
		color: var(--danger);
	}

	.status-unsupported {
		color: var(--ink-faint);
	}
</style>
