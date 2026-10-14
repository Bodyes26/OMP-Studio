<script lang="ts">
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';

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
		checkPushStatus();
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
			// Riconcilia la sottoscrizione esistente del browser con il relay (re-POST)
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
				<span class="status-badge badge-active">{t('notificationsActive')}</span>
			{:else if pushState === 'unregistered'}
				<span class="status-badge badge-unregistered">{t('notificationsUnregistered')}</span>
			{:else if pushState === 'denied'}
				<span class="status-badge badge-denied">{t('notificationsDenied')}</span>
			{:else if pushState === 'unsupported'}
				<span class="status-badge badge-unsupported">{t('notificationsUnsupported')}</span>
			{/if}
		</div>
		<p class="push-desc">{t('notificationsDesc')}</p>
	</div>

	{#if errorMessage}
		<div class="push-error">{errorMessage}</div>
	{/if}

	{#if isIos && !isStandalone && pushState === 'unsupported'}
		<div class="ios-hint">
			<p>{t('notificationsIosHint')}</p>
		</div>
	{:else if pushState === 'active'}
		<button
			class="btn btn-secondary btn-sm push-action-btn"
			onclick={handleDisablePush}
			disabled={loading}
		>
			{loading ? t('notificationsEnabling') : t('disableNotifications')}
		</button>
	{:else if pushState === 'unregistered'}
		<button
			class="btn btn-primary btn-sm push-action-btn"
			onclick={handleEnablePush}
			disabled={loading}
		>
			{loading ? t('notificationsEnabling') : t('retrySync')}
		</button>
	{:else if pushState === 'inactive'}
		<button
			class="btn btn-primary btn-sm push-action-btn"
			onclick={handleEnablePush}
			disabled={loading}
		>
			{loading ? t('notificationsEnabling') : t('enableNotifications')}
		</button>
	{/if}
</div>

<style>
	.push-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--bg-sunken);
		border-radius: 0.625rem;
		border: 1px solid var(--line);
	}

	.push-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.push-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.push-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--ink);
	}

	.push-desc {
		font-size: 0.8125rem;
		color: var(--ink-faint);
		line-height: 1.35;
		margin: 0;
	}

	.status-badge {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
	}

	.badge-active {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
	}

	.badge-unregistered {
		background: var(--warn-bg);
		color: var(--warn);
	}

	.badge-denied {
		background: var(--danger-bg);
		color: var(--danger);
	}

	.badge-unsupported {
		background: var(--bg-hover);
		color: var(--ink-faint);
	}

	.ios-hint {
		padding: 0.625rem 0.75rem;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--ink-muted);
		line-height: 1.35;
	}

	.ios-hint p {
		margin: 0;
	}

	.push-action-btn {
		align-self: flex-start;
		margin-top: 0.25rem;
	}

	.push-error {
		font-size: 0.8125rem;
		color: var(--danger);
		padding: 0.375rem 0.5rem;
		background: var(--danger-bg);
		border-radius: 0.375rem;
	}
</style>
