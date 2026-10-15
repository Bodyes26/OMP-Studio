<!--
  PairingView.svelte — Schermata di abbinamento dispositivo.
  Linguaggio Studio: BrandMark in currentColor, card su bg-base bordata,
  controlli .ui-input e pulsanti .ui-button-*, zero classi legacy.
-->
<script lang="ts">
	import { t } from '../i18n.ts';
	import { normalizePairingCode } from '../../../src/protocol.ts';
	import { detectDefaultDeviceName } from '../deviceDetect.ts';
	import { connection } from '../connection.svelte.ts';
	import BrandMark from './BrandMark.svelte';

	let deviceName = $state(detectDefaultDeviceName());
	let useSecret = $state(false);
	let pairingCodeRaw = $state('');
	let adminToken = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	function formatCodeInput(val: string): string {
		const clean = val.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
		if (clean.length > 4) {
			return `${clean.slice(0, 4)}-${clean.slice(4)}`;
		}
		return clean;
	}

	function handleCodeInput(e: Event): void {
		const target = e.target as HTMLInputElement;
		const formatted = formatCodeInput(target.value);
		pairingCodeRaw = formatted;
		target.value = formatted;
	}

	const normalizedCode = $derived(normalizePairingCode(pairingCodeRaw));
	const isFormValid = $derived(
		deviceName.trim().length > 0 &&
		(useSecret ? adminToken.trim().length > 0 : normalizedCode != null)
	);

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		if (!isFormValid || isSubmitting) return;

		isSubmitting = true;
		errorMessage = null;

		const res = await connection.pairDevice(
			deviceName.trim(),
			useSecret ? undefined : normalizedCode ?? undefined,
			useSecret ? adminToken.trim() : undefined
		);

		isSubmitting = false;

		if (!res.ok) {
			if (res.status === 401) {
				errorMessage = useSecret ? t('errInvalidSecret') : t('errInvalidCode');
			} else if (res.status === 429) {
				errorMessage = t('errRateLimited');
			} else {
				errorMessage = res.error || t('errNetwork');
			}
		}
	}
</script>

<div class="pairing-container safe-top safe-bottom">
	<div class="pairing-card">
		<div class="logo-slot" aria-hidden="true">
			<BrandMark class="brand-logo" />
		</div>
		<h2 class="title">{t('pairTitle')}</h2>
		<p class="subtitle">{t('pairSubtitle')}</p>

		{#if errorMessage}
			<div class="error-banner" role="alert">
				{errorMessage}
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="form">
			<div class="field">
				<label for="device-name">{t('deviceName')}</label>
				<input
					id="device-name"
					type="text"
					class="ui-input"
					placeholder={t('deviceNamePlaceholder')}
					bind:value={deviceName}
					required
				/>
			</div>

			{#if !useSecret}
				<div class="field">
					<label for="pairing-code">{t('pairingCode')}</label>
					<input
						id="pairing-code"
						type="text"
						class="ui-input code-input"
						placeholder={t('pairingCodePlaceholder')}
						value={pairingCodeRaw}
						oninput={handleCodeInput}
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
					/>
				</div>
			{:else}
				<div class="field">
					<label for="admin-token">{t('useAdminSecret')}</label>
					<input
						id="admin-token"
						type="password"
						class="ui-input"
						placeholder={t('adminSecretPlaceholder')}
						bind:value={adminToken}
						autocomplete="current-password"
					/>
				</div>
			{/if}

			<button
				type="button"
				class="ui-button ui-button-ghost toggle-mode-btn"
				onclick={() => {
					useSecret = !useSecret;
					errorMessage = null;
				}}
			>
				{useSecret ? t('usePairingCode') : t('useAdminSecret')}
			</button>

			<button
				type="submit"
				class="ui-button ui-button-primary submit-btn"
				disabled={!isFormValid || isSubmitting}
			>
				{isSubmitting ? t('pairingInProgress') : t('pairButton')}
			</button>
		</form>
	</div>
</div>

<style>
	.pairing-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: calc(100vh - 80px);
		padding: var(--space-6) var(--space-4);
	}

	.pairing-card {
		width: 100%;
		max-width: 400px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-dock);
		padding: var(--space-6) var(--space-5);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.logo-slot {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		display: grid;
		place-items: center;
		margin-bottom: var(--space-4);
		color: var(--ink);
	}

	:global(.logo-slot .brand-logo) {
		width: 26px;
		height: 22px;
	}

	.title {
		font-size: var(--text-heading);
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 var(--space-2) 0;
		letter-spacing: -0.015em;
	}

	.subtitle {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0 0 var(--space-5) 0;
		line-height: 1.5;
	}

	.error-banner {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 12px;
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--danger) 30%, transparent);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: var(--text-caption);
		margin-bottom: var(--space-4);
		text-align: left;
	}

	.form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		text-align: left;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label {
		font-size: var(--text-meta);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.field :global(.ui-input) {
		width: 100%;
	}

	.code-input {
		font-family: var(--font-mono);
		font-size: 16px;
		letter-spacing: 2px;
		text-align: center;
		font-weight: 600;
	}

	.toggle-mode-btn {
		font-size: var(--text-caption);
		align-self: center;
		height: 28px;
		padding: 0 var(--space-2);
	}

	.submit-btn {
		margin-top: var(--space-2);
		width: 100%;
		height: 38px;
	}
</style>
