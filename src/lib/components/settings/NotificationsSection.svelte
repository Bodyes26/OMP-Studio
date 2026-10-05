<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
	import { settingsStore, type NotificationStyle } from '$lib/stores/settings.svelte';
	import { notificationManager } from '$lib/stores/notifications.svelte';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import Switch from '$lib/ui/Switch.svelte';

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
			label: m.ui_notificationssection_completa_con_messaggio_1bd6(),
			desc: m.ui_notificationssection_include_la_domanda_specifica_o_la_richiesta_bb4d()
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
					message: m.ui_notificationssection_notifica_inviata_con_successo_al_sistema_operativo_f0fb()
				};
			} else {
				testResult = {
					ok: false,
					message: 'Impossibile recapitare la notifica di sistema.',
					diagnostic: res.error ?? m.ui_notificationssection_errore_sconosciuto_nel_canale_notifiche_247a()
				};
			}
			await checkPermission();
		} catch (e) {
			testResult = {
				ok: false,
				message: m.ui_notificationssection_errore_durante_l_invio_della_notifica_di_ebdc(),
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
				console.warn(m.ui_notificationssection_errore_autorizzazione_notifiche_0900(), e);
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
		<button type="button" class="ui-button ui-button-secondary" onclick={() => settingsStore.reset('notifications')}>Ripristina</button>
	</div>

	{#if permissionStatus === 'denied'}
		<AlertBanner
			variant="warning"
			title="Notifiche disabilitate dal sistema operativo"
			message="Il sistema operativo sta bloccando le notifiche per OMP Studio."
			diagnostic={m.ui_notificationssection_su_windows_11_apri_impostazioni_sistema_notifiche_acaa()}
		/>
	{/if}

	{#if testResult}
		<AlertBanner
			variant={testResult.ok ? 'success' : 'error'}
			title={testResult.ok ? m.ui_notificationssection_test_notifica_completato_365b() : m.ui_notificationssection_test_notifica_fallito_9b03()}
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
				class="ui-button ui-button-secondary"
				onclick={runTestNotification}
				disabled={sendingTest || !settingsStore.notifications.enabled}
			>
				{sendingTest ? m.ui_notificationssection_invio_in_corso_d2e7() : m.ui_notificationssection_invia_notifica_di_prova_3ac9()}
			</button>
		</div>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-notif-os-label" class="form-row-label">Banner di notifica del sistema operativo</span>
					<span id="settings-notif-os-desc" class="form-row-desc">{m.ui_notificationssection_mostra_un_banner_toast_di_windows_o_bcfb()}</span>
					{#if permissionStatus === 'denied'}
						<span class="perm-warning">{m.ui_notificationssection_permesso_notifiche_negato_nelle_impostazioni_di_sistema_01bd()}</span>
					{/if}
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-notif-os"
						checked={settingsStore.notifications.enabled}
						ariaLabelledBy="settings-notif-os-label"
						ariaDescribedBy="settings-notif-os-desc"
						onChange={(checked) => void toggleSystemNotifications(checked)}
					/>
				</div>
			</div>

			<div class="form-row">
				<div class="form-row-copy">
					<label for="settings-notif-style" id="settings-notif-style-label" class="form-row-label">Contenuto della notifica</label>
					<span id="settings-notif-style-desc" class="form-row-desc">Scegli se mostrare solo il nome del progetto o l'anteprima completa della domanda.</span>
				</div>
				<div class="form-row-control">
					<select
						id="settings-notif-style"
						class="ui-select"
						value={settingsStore.notifications.style}
						disabled={!settingsStore.notifications.enabled}
						aria-labelledby="settings-notif-style-label"
						aria-describedby="settings-notif-style-desc"
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
					<span id="settings-notif-sound-label" class="form-row-label">Segnale sonoro</span>
					<span id="settings-notif-sound-desc" class="form-row-desc">Riproduce il suono di sistema all'arrivo dell'avviso.</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-notif-sound"
						checked={settingsStore.notifications.sound}
						disabled={!settingsStore.notifications.enabled}
						ariaLabelledBy="settings-notif-sound-label"
						ariaDescribedBy="settings-notif-sound-desc"
						onChange={(checked) => settingsStore.patchNotifications({ sound: checked })}
					/>
				</div>
			</div>
		</div>
	</div>
	<div class="section-block">
		<span class="block-title">Icona applicazione (Dock & Barra delle applicazioni)</span>
		<div class="section-group">
			<div class="form-row">
				<div class="form-row-copy">
					<span id="settings-notif-appbadge-label" class="form-row-label">Avviso visivo sull'icona</span>
					<span id="settings-notif-appbadge-desc" class="form-row-desc">{m.ui_notificationssection_su_windows_aggiunge_il_dot_rosso_stile_856b()}</span>
				</div>
				<div class="form-row-control">
					<Switch
						id="settings-notif-appbadge"
						checked={settingsStore.notifications.appBadge}
						ariaLabelledBy="settings-notif-appbadge-label"
						ariaDescribedBy="settings-notif-appbadge-desc"
						onChange={(checked) => settingsStore.patchNotifications({ appBadge: checked })}
					/>
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
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		text-transform: none;
		letter-spacing: normal;
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
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.form-row-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.perm-warning {
		font-size: var(--text-caption);
		color: var(--danger);
		margin-top: 2px;
	}

	.form-row-control {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.form-row-control select {
		min-width: 260px;
	}
	.block-head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

</style>
