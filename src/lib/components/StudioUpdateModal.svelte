<script lang="ts">
	import { studioUpdaterStore, formatBytes, formatSpeed } from '$lib/stores/studioUpdater.svelte';
	import { fade, fly } from 'svelte/transition';
	import { IconRefresh, IconClose, IconArrowRight, IconCheck, IconExternalLink } from '$lib/icons';

	let dialogEl = $state<HTMLDivElement | null>(null);
	let previousActiveElement: HTMLElement | null = null;

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget && !studioUpdaterStore.isDownloading) {
			studioUpdaterStore.closeModal();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!studioUpdaterStore.showModal) return;

		if (e.key === 'Escape') {
			if (!studioUpdaterStore.isDownloading) {
				studioUpdaterStore.closeModal();
			}
			return;
		}

		if (e.key === 'Tab' && dialogEl) {
			const focusableElements = dialogEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (focusableElements.length === 0) return;
			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === firstElement) {
					e.preventDefault();
					lastElement.focus();
				}
			} else {
				if (document.activeElement === lastElement) {
					e.preventDefault();
					firstElement.focus();
				}
			}
		}
	}

	$effect(() => {
		if (studioUpdaterStore.showModal) {
			previousActiveElement = document.activeElement as HTMLElement | null;
			// Spostiamo il focus nel dialogo al momento dell'apertura
			setTimeout(() => {
				if (dialogEl) {
					const firstFocusable = dialogEl.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]');
					firstFocusable?.focus();
				}
			}, 20);

			return () => {
				previousActiveElement?.focus();
			};
		}
	});

	function formatDate(dateStr?: string): string {
		if (!dateStr) return '';
		try {
			const d = new Date(dateStr);
			return d.toLocaleDateString('it-IT', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}
</script>
<svelte:window onkeydown={handleKeydown} />

{#if studioUpdaterStore.showModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleBackdropClick} transition:fade={{ duration: 150 }}>
		<div
			bind:this={dialogEl}
			class="modal-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="studio-update-title"
			transition:fly={{ y: 12, duration: 200 }}
		>
			<div class="modal-header">
				<div class="header-left">
					<h3 id="studio-update-title">
						{studioUpdaterStore.hasUpdate ? 'Aggiornamento OMP Studio' : 'OMP Studio è aggiornato'}
					</h3>
				</div>
				<div class="header-actions">
					{#if !studioUpdaterStore.isDownloading}
						<button
							class="refresh-icon-btn"
							disabled={studioUpdaterStore.isChecking}
							onclick={() => studioUpdaterStore.checkUpdate(true)}
							title="Verifica se ci sono versioni più recenti su GitHub"
							aria-label="Verifica aggiornamenti"
						>
							<span class="refresh-symbol"><IconRefresh /></span>
						</button>
						<button
							class="close-btn"
							onclick={() => studioUpdaterStore.closeModal()}
							title="Chiudi"
							aria-label="Chiudi"
						>
							<IconClose />
						</button>
					{/if}
				</div>
			</div>

			<div class="modal-body">
				<fieldset class="channel-picker" disabled={studioUpdaterStore.channelChangeDisabled}>
					<legend>Canale aggiornamenti</legend>
					<div class="channel-options">
						<label class:checked={studioUpdaterStore.channel === 'stable'} class="channel-option">
							<input
								type="radio"
								name="studio-update-channel"
								value="stable"
								checked={studioUpdaterStore.channel === 'stable'}
								onchange={() => void studioUpdaterStore.setChannel('stable')}
							/>
							<span class="channel-copy">
								<strong>Stabile</strong>
								<small>Release ufficiali verificate</small>
							</span>
						</label>
						<label class:checked={studioUpdaterStore.channel === 'nightly'} class="channel-option">
							<input
								type="radio"
								name="studio-update-channel"
								value="nightly"
								checked={studioUpdaterStore.channel === 'nightly'}
								onchange={() => void studioUpdaterStore.setChannel('nightly')}
							/>
							<span class="channel-copy">
								<strong>Nightly</strong>
								<small>Ultima build, può essere instabile</small>
							</span>
						</label>
					</div>
				</fieldset>

				<!-- Versione Corrente e Nuova -->
				<div class="version-banner">
					<div class="version-item">
						<span class="v-label">Installata</span>
						<span class="v-badge current">v{studioUpdaterStore.currentVersion || '...'}</span>
						{#if studioUpdaterStore.currentVersion?.includes('-nightly.')}
							<span class="channel-tag">Nightly</span>
						{/if}
					</div>
					{#if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo}
						<span class="v-arrow"><IconArrowRight /></span>
						<div class="version-item">
							<span class="v-label">Nuova</span>
							<span class="v-badge target">v{studioUpdaterStore.updateInfo.latest_version}</span>
						</div>
					{:else}
						<span class="up-to-date-tag"><IconCheck /> Ultima versione</span>
					{/if}
				</div>

				{#if studioUpdaterStore.updateInfo?.ahead_of_channel && studioUpdaterStore.channel === 'stable'}
					<div class="channel-waiting">
						La build installata è più recente dell’ultima stabile. Riceverai il prossimo rilascio stabile disponibile.
					</div>
				{/if}

				<!-- Dettagli Release -->
				{#if studioUpdaterStore.updateInfo}
					<div class="release-meta">
						<div class="meta-row">
							<span class="release-identity">
								<span class="release-title">{studioUpdaterStore.updateInfo.release_name}</span>
								{#if studioUpdaterStore.updateInfo.release_channel === 'nightly'}
									<span class="channel-tag">Nightly</span>
								{/if}
							</span>
							{#if studioUpdaterStore.updateInfo.published_at}
								<span class="release-date">{formatDate(studioUpdaterStore.updateInfo.published_at)}</span>
							{/if}
						</div>
					</div>

					{#if studioUpdaterStore.updateInfo.release_notes}
						<div class="notes-container">
							<div class="notes-heading">Novità e modifiche:</div>
							<pre class="release-notes">{studioUpdaterStore.updateInfo.release_notes}</pre>
						</div>
					{/if}

					<!-- Asset e Download Info -->
					{#if studioUpdaterStore.hasUpdate}
						{#if studioUpdaterStore.updateInfo.asset}
							<div class="asset-info">
								<div class="asset-text">
									<span class="asset-name">{studioUpdaterStore.updateInfo.asset.name}</span>
									<span class="asset-size">{formatBytes(studioUpdaterStore.updateInfo.asset.size)}</span>
								</div>
								{#if studioUpdaterStore.updateInfo.asset.sha256}
									<div class="sha-badge" title="SHA-256 verificato: {studioUpdaterStore.updateInfo.asset.sha256}">
										<span class="sha-label">SHA256:</span>
										<code class="sha-code">{studioUpdaterStore.updateInfo.asset.sha256.slice(0, 10)}…</code>
									</div>
								{/if}
							</div>
						{:else}
							<div class="no-asset-notice">
								<span>Nessun pacchetto binario pre-compilato allegato a questa release. Puoi scaricarla o consultarla su GitHub.</span>
							</div>
						{/if}
					{/if}
				{/if}

				<!-- Progresso Download -->
				{#if studioUpdaterStore.isDownloading && studioUpdaterStore.downloadProgress}
					<div class="progress-section" role="status" aria-live="polite">
						<div class="progress-header">
							<span class="progress-title">Scaricamento in corso...</span>
							<span class="progress-pct">{studioUpdaterStore.downloadProgress.percentage.toFixed(0)}%</span>
						</div>
						<div class="progress-bar-bg">
							<div
								class="progress-bar-fill"
								style="transform: scaleX({Math.max(0.04, studioUpdaterStore.downloadProgress.percentage / 100)});"
							></div>
						</div>
						<div class="progress-stats">
							<span>
								{formatBytes(studioUpdaterStore.downloadProgress.downloaded_bytes)} / {formatBytes(studioUpdaterStore.downloadProgress.total_bytes)}
							</span>
							{#if studioUpdaterStore.downloadProgress.speed_bytes_per_sec > 0}
								<span class="progress-speed">{formatSpeed(studioUpdaterStore.downloadProgress.speed_bytes_per_sec)}</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Messaggio di Download Completato -->
				{#if studioUpdaterStore.downloadProgress?.status === 'finished'}
					<div class="finished-banner" role="status" aria-live="polite">
						<div class="finished-text">
							<strong>Pacchetto scaricato con successo!</strong>
							<span>Clicca su "Riavvia e Installa" per completare l'aggiornamento e riaprire OMP Studio.</span>
						</div>
					</div>
				{/if}

				<!-- Messaggi di Errore -->
				{#if studioUpdaterStore.errorMessage}
					<div class="error-banner" role="alert" aria-live="assertive">
						<span class="error-text">{studioUpdaterStore.errorMessage}</span>
					</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button
					class="btn btn-link"
					onclick={() => studioUpdaterStore.openReleaseInBrowser()}
					title="Visualizza la release su GitHub"
				>
					Vedi su GitHub <IconExternalLink />
				</button>

				<div class="footer-actions">
					{#if studioUpdaterStore.isDownloading}
						<button class="btn btn-secondary" onclick={() => studioUpdaterStore.cancelDownload()}>
							Annulla download
						</button>
					{:else if studioUpdaterStore.downloadProgress?.status === 'finished'}
						<button class="btn btn-secondary" onclick={() => studioUpdaterStore.closeModal()}>
							Più tardi
						</button>
						<button
							class="btn btn-primary"
							disabled={studioUpdaterStore.isInstalling}
							onclick={() => studioUpdaterStore.installAndRestart()}
						>
							{#if studioUpdaterStore.isInstalling}
								Avvio installazione...
							{:else}
								Riavvia e Installa
							{/if}
						</button>
					{:else if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo?.asset}
						<button
							class="btn btn-secondary"
							onclick={() => studioUpdaterStore.checkUpdate(true)}
							disabled={studioUpdaterStore.isChecking}
							title="Controlla se è uscita una versione ancora più recente su GitHub"
						>
							<span class="refresh-symbol"><IconRefresh /></span>
							{studioUpdaterStore.isChecking ? 'Verifica...' : 'Ricontrolla'}
						</button>
						<button class="btn btn-secondary" onclick={() => studioUpdaterStore.closeModal()}>
							Annulla
						</button>
						<button class="btn btn-primary" onclick={() => studioUpdaterStore.startDownload()}>
							Scarica Aggiornamento
						</button>
					{:else}
						<button
							class="btn btn-secondary"
							onclick={() => studioUpdaterStore.checkUpdate(true)}
							disabled={studioUpdaterStore.isChecking}
						>
							<span class="refresh-symbol"><IconRefresh /></span>
							{#if studioUpdaterStore.isChecking}
								Verifica in corso...
							{:else}
								Controlla di nuovo
							{/if}
						</button>
						<button class="btn btn-primary" onclick={() => studioUpdaterStore.closeModal()}>
							Chiudi
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-backdrop);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-dialog {
		width: 480px;
		max-width: 92vw;
		max-height: 85vh;
		background: var(--bg-overlay);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}


	.modal-header h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.refresh-icon-btn {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-faint);
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.refresh-icon-btn:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--brand);
		background: var(--bg-hover);
	}

	.refresh-icon-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.refresh-symbol {
		display: inline-flex;
		align-items: center;
		line-height: 1;
	}


	.close-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
	}

	.close-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.modal-body {
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		overflow-y: auto;
		min-height: 0;
	}

	.channel-picker {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}

	.channel-picker legend {
		margin-bottom: var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.channel-options {
		display: flex;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
	}

	.channel-option {
		display: flex;
		flex: 1;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.channel-option + .channel-option {
		border-left: 1px solid var(--line);
	}

	.channel-option:hover {
		background: var(--bg-hover);
	}

	.channel-option.checked {
		background: var(--bg-active);
	}

	.channel-option input {
		margin: 0;
		accent-color: var(--brand);
	}

	.channel-copy {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.channel-copy strong {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.channel-copy small {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.3;
	}

	.channel-picker:disabled .channel-option {
		cursor: not-allowed;
		opacity: 0.65;
	}

	.channel-picker:disabled .channel-option:hover {
		background: transparent;
	}

	.channel-picker:disabled .channel-option.checked:hover {
		background: var(--bg-active);
	}

	.version-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-sunken);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.version-item {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.v-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.v-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.v-badge.current {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.v-badge.target {
		background: var(--brand);
		color: var(--on-brand);
	}

	.v-arrow {
		color: var(--ink-faint);
		font-weight: bold;
	}

	.up-to-date-tag {
		font-size: var(--text-xs);
		color: var(--brand);
		font-weight: 600;
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		--icon-size: 12px;
	}

	.channel-tag {
		display: inline-flex;
		align-items: center;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--warn) 14%, transparent);
		color: var(--warn);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.4;
	}

	.channel-waiting {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.release-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.meta-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.release-identity {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.release-title {
		font-weight: 600;
		color: var(--ink);
		font-size: var(--text-sm);
	}

	.release-date {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.notes-container {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.notes-heading {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-faint);
	}
	.release-notes {
		max-height: 140px;
		overflow-y: auto;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ink-muted);
		white-space: pre-wrap;
		margin: 0;
		line-height: 1.4;
	}

	.asset-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.sha-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--brand) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
		font-size: var(--text-xs);
		color: var(--brand);
		white-space: nowrap;
	}

	.sha-label {
		font-weight: 600;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.sha-code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.asset-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.asset-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.asset-size {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.no-asset-notice {
		background: var(--bg-sunken);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--warn);
	}

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--bg-sunken);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--text-xs);
	}

	.progress-title {
		font-weight: 600;
		color: var(--ink);
	}

	.progress-pct {
		font-family: var(--font-mono);
		font-weight: bold;
		color: var(--brand);
		font-variant-numeric: tabular-nums;
	}

	.progress-bar-bg {
		height: 8px;
		background: var(--bg-hover);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		width: 100%;
		background: var(--brand);
		border-radius: var(--radius-full);
		transform-origin: left;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.progress-stats {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.progress-speed {
		color: var(--ink-muted);
	}

	.finished-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--brand);
		padding: var(--space-3);
		border-radius: var(--radius-md);
	}


	.finished-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-xs);
	}

	.finished-text strong {
		color: var(--ink);
	}

	.finished-text span {
		color: var(--ink-muted);
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-sunken);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--danger);
	}
	.error-text {
		color: var(--danger);
		word-break: break-word;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
	}

	.footer-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-link {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		padding: 4px 8px;
		font-size: var(--text-xs);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		--icon-size: 12px;
	}

	.btn-link:hover {
		color: var(--brand);
		text-decoration: underline;
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--brand-ink);
	}
</style>
