<script lang="ts">
	import { studioUpdaterStore, formatBytes, formatSpeed } from '$lib/stores/studioUpdater.svelte';
	import { fade, fly } from 'svelte/transition';

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget && !studioUpdaterStore.isDownloading) {
			studioUpdaterStore.closeModal();
		}
	}

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

{#if studioUpdaterStore.showModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleBackdropClick} transition:fade={{ duration: 150 }}>
		<div
			class="modal-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="studio-update-title"
			transition:fly={{ y: 12, duration: 200 }}
		>
			<div class="modal-header">
				<div class="header-left">
					<span class="header-icon">🚀</span>
					<h3 id="studio-update-title">
						{studioUpdaterStore.hasUpdate ? 'Aggiornamento OMP Studio' : 'OMP Studio è aggiornato'}
					</h3>
				</div>
				{#if !studioUpdaterStore.isDownloading}
					<button
						class="close-btn"
						onclick={() => studioUpdaterStore.closeModal()}
						title="Chiudi"
						aria-label="Chiudi"
					>
						✕
					</button>
				{/if}
			</div>

			<div class="modal-body">
				<!-- Versione Corrente e Nuova -->
				<div class="version-banner">
					<div class="version-item">
						<span class="v-label">Installata</span>
						<span class="v-badge current">v{studioUpdaterStore.currentVersion || '...'}</span>
					</div>
					{#if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo}
						<span class="v-arrow">→</span>
						<div class="version-item">
							<span class="v-label">Nuova</span>
							<span class="v-badge target">v{studioUpdaterStore.updateInfo.latest_version}</span>
						</div>
					{:else}
						<span class="up-to-date-tag">✓ Ultima versione</span>
					{/if}
				</div>

				<!-- Dettagli Release -->
				{#if studioUpdaterStore.updateInfo}
					<div class="release-meta">
						<div class="meta-row">
							<span class="release-title">{studioUpdaterStore.updateInfo.release_name}</span>
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
								<span class="asset-icon">📦</span>
								<div class="asset-text">
									<span class="asset-name">{studioUpdaterStore.updateInfo.asset.name}</span>
									<span class="asset-size">{formatBytes(studioUpdaterStore.updateInfo.asset.size)}</span>
								</div>
							</div>
						{:else}
							<div class="no-asset-notice">
								<span>⚠️ Nessun pacchetto binario pre-compilato allegato a questa release. Puoi scaricarla o consultarla su GitHub.</span>
							</div>
						{/if}
					{/if}
				{/if}

				<!-- Progresso Download -->
				{#if studioUpdaterStore.isDownloading && studioUpdaterStore.downloadProgress}
					<div class="progress-section">
						<div class="progress-header">
							<span class="progress-title">Scaricamento in corso...</span>
							<span class="progress-pct">{studioUpdaterStore.downloadProgress.percentage.toFixed(0)}%</span>
						</div>
						<div class="progress-bar-bg">
							<div
								class="progress-bar-fill"
								style="width: {Math.max(4, studioUpdaterStore.downloadProgress.percentage)}%"
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
					<div class="finished-banner">
						<span class="finished-icon">✅</span>
						<div class="finished-text">
							<strong>Pacchetto scaricato con successo!</strong>
							<span>Clicca su "Riavvia e Installa" per completare l'aggiornamento e riaprire OMP Studio.</span>
						</div>
					</div>
				{/if}

				<!-- Messaggi di Errore -->
				{#if studioUpdaterStore.errorMessage}
					<div class="error-banner">
						<span class="error-icon">❌</span>
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
					Vedi su GitHub ↗
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
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
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

	.header-icon {
		font-size: 1.25rem;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		transition: all 0.15s ease;
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
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.release-notes {
		max-height: 140px;
		overflow-y: auto;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--ink-muted);
		white-space: pre-wrap;
		margin: 0;
		line-height: 1.4;
	}

	.asset-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-base);
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
	}

	.asset-icon {
		font-size: 1.1rem;
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
		font-size: 10px;
		color: var(--ink-faint);
	}

	.no-asset-notice {
		background: var(--bg-sunken);
		border-left: 3px solid var(--warn);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--ink-muted);
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
	}

	.progress-bar-bg {
		height: 8px;
		background: var(--bg-hover);
		border-radius: 99px;
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		background: var(--brand);
		border-radius: 99px;
		transition: width 0.2s ease;
	}

	.progress-stats {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		font-family: var(--font-mono);
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

	.finished-icon {
		font-size: 1.25rem;
		line-height: 1;
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
		border-left: 3px solid var(--danger, #e53935);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.error-icon {
		font-size: 1rem;
	}

	.error-text {
		color: var(--danger, #e53935);
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
		transition: all 0.15s ease;
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
		filter: brightness(1.1);
	}
</style>
