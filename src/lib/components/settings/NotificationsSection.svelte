<script lang="ts">
	import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
	import { settingsStore, type NotificationStyle } from '$lib/stores/settings.svelte';
	import { notificationManager } from '$lib/stores/notifications.svelte';
	import AlertBanner from '$lib/components/AlertBanner.svelte';

	let permissionStatus = $state<'granted' | 'denied' | 'default' | 'unknown'>('unknown');
	let testResult = $state<{ ok: boolean; message: string; diagnostic?: string } | null>(null);
	let sendingTest = $state(false);

	const STYLE_OPTIONS: { id: NotificationStyle; label: string; desc: string }[] = [
		{
			id: 'brief',
			label: 'Sintetica',
			desc: 'OMP ha bisogno di te su [Nome Progetto]'
		},
		{
			id: 'detailed',
			label: 'Completa con messaggio',
			desc: 'Include la domanda specifica o la richiesta di conferma'
		}
	];

	async function checkPermission() {
		try {
			const granted = await isPermissionGranted();
			permissionStatus = granted ? 'granted' : 'default';
		} catch {
			permissionStatus = 'unknown';
		}
	}

	async function runTestNotification() {
		if (sendingTest) return;
		sendingTest = true;
		testResult = null;
		try {
			const res = await notificationManager.sendTestNotification();
			if (res.ok) {
				testResult = {
					ok: true,
					message: 'Notifica inviata con successo al sistema operativo. Se non la vedi, controlla la modalità Non Disturbare o Focus di Windows.'
				};
			} else {
				testResult = {
					ok: false,
					message: 'Impossibile recapitare la notifica di sistema.',
					diagnostic: res.error ?? 'Errore sconosciuto nel canale notifiche.'
				};
			}
			await checkPermission();
		} catch (e) {
			testResult = {
				ok: false,
				message: 'Errore durante l\'invio della notifica di prova.',
				diagnostic: String(e)
			};
		} finally {
			sendingTest = false;
		}
	}

	async function toggleSystemNotifications(enabled: boolean) {
		if (enabled) {
			try {
				let granted = await isPermissionGranted();
				if (!granted) {
					const res = await requestPermission();
					granted = res === 'granted';
					permissionStatus = res;
				} else {
					permissionStatus = 'granted';
				}

				if (granted) {
					settingsStore.patchNotifications({ enabled: true });
				} else {
					settingsStore.patchNotifications({ enabled: false });
				}
			} catch (e) {
				console.warn('Errore autorizzazione notifiche:', e);
				settingsStore.patchNotifications({ enabled: true });
			}
		} else {
			settingsStore.patchNotifications({ enabled: false });
		}
	}

	$effect(() => {
		void checkPermission();
	});
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>Notifiche e Alert</h4>
		<button type="button" class="btn btn-secondary" onclick={() => settingsStore.reset('notifications')}>Ripristina</button>
	</div>

	{#if permissionStatus === 'denied'}
		<AlertBanner
			variant="warning"
			title="Notifiche disabilitate dal sistema operativo"
			message="Il sistema operativo sta bloccando le notifiche per OMP Studio."
			diagnostic="Su Windows 11: apri Impostazioni > Sistema > Notifiche e assicurati che 'OMP Studio' sia impostato su 'Attivato'.&#10;Su macOS: apri Impostazioni di Sistema > Notifiche > OMP Studio > Consenti notifiche."
		/>
	{/if}

	{#if testResult}
		<AlertBanner
			variant={testResult.ok ? 'success' : 'error'}
			title={testResult.ok ? 'Test notifica completato' : 'Test notifica fallito'}
			message={testResult.message}
			diagnostic={testResult.diagnostic}
			dismissible={true}
			onDismiss={() => (testResult = null)}
			onRetry={!testResult.ok ? runTestNotification : undefined}
			retryLabel="Riprova test"
		/>
	{/if}

	<div class="section-block">
		<div class="block-head-row">
			<span class="block-title">Notifiche di sistema</span>
			<button
				type="button"
				class="btn btn-sm btn-test"
				onclick={runTestNotification}
				disabled={sendingTest || !settingsStore.notifications.enabled}
			>
				{sendingTest ? 'Invio in corso...' : 'Invia notifica di prova'}
			</button>
		</div>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Banner di notifica del sistema operativo</span>
					<span class="form-row-desc">Mostra un banner toast di Windows o macOS quando un agente ha bisogno di attenzione o input.</span>
					{#if permissionStatus === 'denied'}
						<span class="perm-warning">Permesso notifiche negato nelle impostazioni di sistema.</span>
					{/if}
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.notifications.enabled}
							onchange={(e) => void toggleSystemNotifications((e.currentTarget as HTMLInputElement).checked)}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Contenuto della notifica</span>
					<span class="form-row-desc">Scegli se mostrare solo il nome del progetto o l'anteprima completa della domanda.</span>
				</div>
				<div class="form-row-control">
					<select
						value={settingsStore.notifications.style}
						disabled={!settingsStore.notifications.enabled}
						onchange={(e) => settingsStore.patchNotifications({ style: (e.currentTarget as HTMLSelectElement).value as NotificationStyle })}
					>
						{#each STYLE_OPTIONS as opt (opt.id)}
							<option value={opt.id}>{opt.label} ({opt.desc})</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Segnale sonoro</span>
					<span class="form-row-desc">Riproduce il suono di sistema all'arrivo dell'avviso.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.notifications.sound}
							disabled={!settingsStore.notifications.enabled}
							onchange={(e) => settingsStore.patchNotifications({ sound: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>
	</div>
	<div class="section-block">
		<span class="block-title">Icona applicazione (Dock & Barra delle applicazioni)</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span class="form-row-label">Avviso visivo sull'icona</span>
					<span class="form-row-desc">Su Windows aggiunge il dot rosso (stile Teams/Outlook) nell'angolo dell'icona e lampeggia brevemente; su macOS mostra il badge numerico nel Dock e fa rimbalzare l'icona.</span>
				</div>
				<div class="form-row-control">
					<label class="switch">
						<input
							type="checkbox"
							checked={settingsStore.notifications.appBadge}
							onchange={(e) => settingsStore.patchNotifications({ appBadge: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="slider"></span>
					</label>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.section-group {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.form-row:last-child {
		border-bottom: none;
	}

	.form-row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.form-row-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.perm-warning {
		font-size: var(--text-xs);
		color: var(--danger, #ef4444);
		margin-top: 2px;
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	select {
		height: 30px;
		padding: 0 var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		outline: none;
		transition: border-color var(--dur-fast);
		min-width: 260px;
	}

	select:focus {
		border-color: var(--brand);
	}

	select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.block-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.btn-sm {
		padding: 3px 10px;
		font-size: var(--text-xs);
	}

	.btn-test {
		background: var(--bg-raised);
		color: var(--brand);
		border: 1px solid var(--line);
	}

	.btn-test:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.btn-test:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.switch {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
	}

	.switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		inset: 0;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.slider::before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 2px;
		bottom: 2px;
		background: var(--ink-muted);
		border-radius: 50%;
		transition: transform var(--dur-fast), background var(--dur-fast);
	}

	input:checked + .slider {
		background: var(--brand);
		border-color: var(--brand);
	}

	input:checked + .slider::before {
		transform: translateX(14px);
		background: var(--bg-sunken);
	}

	input:disabled + .slider {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
