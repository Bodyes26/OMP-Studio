<script lang="ts">
	import { t } from '../i18n.ts';
	import { normalizePairingCode } from '../../../src/protocol.ts';
	import { detectDefaultDeviceName } from '../deviceDetect.ts';
	import { connection } from '../connection.svelte.ts';

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
	<div class="card pairing-card">
		<div class="logo-circle">π</div>
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
					class="input-field"
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
						class="input-field code-input"
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
						class="input-field"
						placeholder={t('adminSecretPlaceholder')}
						bind:value={adminToken}
						autocomplete="current-password"
					/>
				</div>
			{/if}

			<button
				type="button"
				class="toggle-mode-btn btn btn-ghost"
				onclick={() => {
					useSecret = !useSecret;
					errorMessage = null;
				}}
			>
				{useSecret ? t('usePairingCode') : t('useAdminSecret')}
			</button>

			<button
				type="submit"
				class="btn btn-primary submit-btn"
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
		padding: 24px 16px;
	}

	.pairing-card {
		width: 100%;
		max-width: 420px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: 28px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.logo-circle {
		width: 52px;
		height: 52px;
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 26px;
		font-weight: 700;
		color: var(--brand);
		margin-bottom: 16px;
	}

	.title {
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
		margin-bottom: 8px;
	}

	.subtitle {
		font-size: 13px;
		color: var(--ink-muted);
		margin-bottom: 20px;
		line-height: 1.4;
	}

	.error-banner {
		width: 100%;
		padding: 10px 14px;
		background: var(--danger-bg);
		border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: 13px;
		margin-bottom: 16px;
		text-align: left;
	}

	.form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
		text-align: left;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-muted);
	}

	.code-input {
		font-family: var(--font-mono);
		font-size: 18px;
		letter-spacing: 2px;
		text-align: center;
		font-weight: 600;
	}

	.toggle-mode-btn {
		font-size: 12px;
		align-self: center;
		padding: 4px 8px;
	}

	.submit-btn {
		margin-top: 8px;
		width: 100%;
		height: 44px;
	}
</style>
