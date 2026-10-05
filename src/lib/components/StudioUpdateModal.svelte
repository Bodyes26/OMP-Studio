<script lang="ts">
	/**
	 * StudioUpdateModal — Dialogo di aggiornamento applicazione (Design v2).
	 * Usa la primitiva Dialog accessibile con top-layer nativo, testata e Tooltip.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import {
		studioUpdaterStore,
		formatBytes,
		formatSpeed,
		formatVersion
	} from '$lib/stores/studioUpdater.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconRefresh,
		IconArrowRight,
		IconCheck,
		IconCircleCheck,
		IconExternalLink
	} from '$lib/icons';

	function formatDate(dateStr?: string): string {
		if (!dateStr) return '';
		try {
			return i18n.formatDate(dateStr, {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	const dialogTitle = $derived(
		studioUpdaterStore.hasUpdate
			? m.studio_update_title_update()
			: m.studio_update_title_up_to_date()
	);
</script>

<Dialog
	open={studioUpdaterStore.showModal}
	title={dialogTitle}
	onClose={() => {
		if (!studioUpdaterStore.isDownloading) {
			studioUpdaterStore.closeModal();
		}
	}}
	dismissible={!studioUpdaterStore.isDownloading}
>
	{#snippet actions()}
		{#if !studioUpdaterStore.isDownloading}
			<Tooltip text={m.studio_update_check_title()}>
				<button
					type="button"
					class="ui-button ui-button-ghost refresh-icon-btn"
					disabled={studioUpdaterStore.isChecking}
					onclick={() => studioUpdaterStore.checkUpdate(true)}
					aria-label={m.ui_studioupdatemodal_verifica_aggiornamenti_ef56()}
				>
					<span class="refresh-symbol" class:spinning={studioUpdaterStore.isChecking}>
						<IconRefresh />
					</span>
				</button>
			</Tooltip>
		{/if}
	{/snippet}

	<div class="modal-body-content">
		<fieldset class="channel-picker" disabled={studioUpdaterStore.channelChangeDisabled}>
			<legend>{m.studio_update_channel_legend()}</legend>
			<div class="channel-options">
				<label class="ui-choice channel-choice" class:selected={studioUpdaterStore.channel === 'stable'}>
					<div class="channel-radio-row">
						<input
							type="radio"
							class="ui-checkbox"
							name="studio-update-channel"
							value="stable"
							checked={studioUpdaterStore.channel === 'stable'}
							onchange={() => void studioUpdaterStore.setChannel('stable')}
						/>
						<span class="channel-title-row">
							<strong>{m.studio_update_channel_stable()}</strong>
							<span class="channel-badge stable">{m.studio_update_channel_stable_recommended()}</span>
						</span>
					</div>
					<small class="channel-desc">{m.studio_update_channel_stable_sub()}</small>
				</label>
				<label class="ui-choice channel-choice" class:selected={studioUpdaterStore.channel === 'nightly'}>
					<div class="channel-radio-row">
						<input
							type="radio"
							class="ui-checkbox"
							name="studio-update-channel"
							value="nightly"
							checked={studioUpdaterStore.channel === 'nightly'}
							onchange={() => void studioUpdaterStore.setChannel('nightly')}
						/>
						<span class="channel-title-row">
							<strong>{m.studio_update_channel_nightly()}</strong>
							<span class="channel-badge nightly">{m.studio_update_channel_nightly_badge()}</span>
						</span>
					</div>
					<small class="channel-desc">{m.studio_update_channel_nightly_sub()}</small>
				</label>
			</div>
		</fieldset>

		<!-- Versione Corrente e Nuova -->
		<div class="version-banner">
			<Tooltip text={studioUpdaterStore.currentVersion ? `v${studioUpdaterStore.currentVersion}` : ''}>
				<div class="version-item">
					<span class="v-label">{m.studio_update_installed_label()}</span>
					<span class="v-badge current">v{formatVersion(studioUpdaterStore.currentVersion) || '...'}</span>
					{#if studioUpdaterStore.currentVersion?.includes('-nightly.')}
						<span class="channel-tag">{m.studio_update_channel_nightly()}</span>
					{/if}
				</div>
			</Tooltip>
			{#if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo}
				<span class="v-arrow"><IconArrowRight /></span>
				<Tooltip text={`v${studioUpdaterStore.updateInfo.latest_version}`}>
					<div class="version-item">
						<span class="v-label">{m.studio_update_new_label()}</span>
						<span class="v-badge target">v{formatVersion(studioUpdaterStore.updateInfo.latest_version)}</span>
					</div>
				</Tooltip>
			{:else}
				<span class="up-to-date-tag"><IconCheck /> {m.studio_update_latest_tag()}</span>
			{/if}
		</div>

		{#if studioUpdaterStore.updateInfo?.ahead_of_channel && studioUpdaterStore.channel === 'stable'}
			<div class="channel-waiting">
				{m.studio_update_ahead_message()}
			</div>
		{/if}

		<!-- Dettagli Release -->
		{#if studioUpdaterStore.updateInfo}
			<div class="release-meta">
				<div class="meta-row">
					<span class="release-identity">
						<Tooltip text={studioUpdaterStore.updateInfo.release_name}>
							<span class="release-title">
								{studioUpdaterStore.updateInfo.release_name}
							</span>
						</Tooltip>
						{#if studioUpdaterStore.updateInfo.release_channel === 'nightly'}
							<span class="channel-tag">{m.studio_update_channel_nightly()}</span>
						{/if}
					</span>
					{#if studioUpdaterStore.updateInfo.published_at}
						<span class="release-date">{formatDate(studioUpdaterStore.updateInfo.published_at)}</span>
					{/if}
				</div>
			</div>

			{#if studioUpdaterStore.updateInfo.release_notes}
				<div class="notes-container">
					<div class="notes-heading">{m.studio_update_release_notes_heading()}</div>
					<pre class="release-notes">{studioUpdaterStore.updateInfo.release_notes}</pre>
				</div>
			{/if}

			<!-- Asset e Download Info -->
			{#if studioUpdaterStore.hasUpdate}
				{#if studioUpdaterStore.updateInfo.asset}
					<div class="asset-info">
						<div class="asset-text">
							<Tooltip text={studioUpdaterStore.updateInfo.asset.name}>
								<span class="asset-name">{studioUpdaterStore.updateInfo.asset.name}</span>
							</Tooltip>
							<span class="asset-size">{formatBytes(studioUpdaterStore.updateInfo.asset.size)}</span>
						</div>
						{#if studioUpdaterStore.updateInfo.asset.sha256}
							<Tooltip text={`SHA-256 verificato: ${studioUpdaterStore.updateInfo.asset.sha256}`}>
								<div class="sha-badge">
									<span class="sha-label">SHA-256</span>
									<code class="sha-code">{studioUpdaterStore.updateInfo.asset.sha256.slice(0, 10)}…</code>
								</div>
							</Tooltip>
						{/if}
					</div>
				{:else}
					<div class="no-asset-notice">
						<span>{m.studio_update_no_binary_notice()}</span>
					</div>
				{/if}
			{/if}
		{/if}

		<!-- Progresso Download -->
		{#if studioUpdaterStore.isDownloading && studioUpdaterStore.downloadProgress}
			<div class="progress-section" role="status" aria-live="polite">
				<div class="progress-header">
					<span class="progress-title">{m.studio_update_downloading()}</span>
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

		<!-- Messaggio di Download Completato: riga d'esito con IconCircleCheck --success + testo --ink -->
		{#if studioUpdaterStore.downloadProgress?.status === 'finished'}
			<div class="finished-row" role="status" aria-live="polite">
				<div class="finished-icon">
					<IconCircleCheck />
				</div>
				<div class="finished-text">
					<strong>{m.studio_update_finished_title()}</strong>
					<span class="finished-desc">{m.studio_update_finished_desc()}</span>
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

	{#snippet footer()}
		<div class="update-footer-content">
			<Tooltip text={m.studio_update_github_release_tooltip()}>
				<button
					type="button"
					class="ui-button ui-button-ghost btn-github"
					onclick={() => studioUpdaterStore.openReleaseInBrowser()}
				>
					<span>{m.studio_update_see_on_github()}</span>
					<IconExternalLink />
				</button>
			</Tooltip>

			<div class="footer-actions">
				{#if studioUpdaterStore.isDownloading}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => studioUpdaterStore.cancelDownload()}
					>
						{m.studio_update_cancel_download()}
					</button>
				{:else if studioUpdaterStore.downloadProgress?.status === 'finished'}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => studioUpdaterStore.closeModal()}
					>
						{m.studio_update_later()}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						disabled={studioUpdaterStore.isInstalling}
						onclick={() => studioUpdaterStore.installAndRestart()}
					>
						{#if studioUpdaterStore.isInstalling}
							{m.studio_update_starting_install()}
						{:else}
							{m.studio_update_restart_and_install()}
						{/if}
					</button>
				{:else if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo?.asset}
					<Tooltip text={m.ui_studioupdatemodal_controlla_se_e_uscita_una_versione_ancora_9917()}>
						<button
							type="button"
							class="ui-button ui-button-secondary"
							onclick={() => studioUpdaterStore.checkUpdate(true)}
							disabled={studioUpdaterStore.isChecking}
						>
							<span class="refresh-symbol" class:spinning={studioUpdaterStore.isChecking}>
								<IconRefresh />
							</span>
							{studioUpdaterStore.isChecking ? m.page_omp_update_status_checking() : m.studio_update_recheck()}
						</button>
					</Tooltip>
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => studioUpdaterStore.closeModal()}
					>
						{m.common_cancel()}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						onclick={() => studioUpdaterStore.startDownload()}
					>
						{m.studio_update_download_update()}
					</button>
				{:else}
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => studioUpdaterStore.checkUpdate(true)}
						disabled={studioUpdaterStore.isChecking}
					>
						<span class="refresh-symbol" class:spinning={studioUpdaterStore.isChecking}>
							<IconRefresh />
						</span>
						{#if studioUpdaterStore.isChecking}
							{m.ui_studioupdatemodal_verifica_in_corso_13da()}
						{:else}
							{m.ui_studioupdatemodal_controlla_di_nuovo_ec12()}
						{/if}
					</button>
					<button
						type="button"
						class="ui-button ui-button-primary"
						onclick={() => studioUpdaterStore.closeModal()}
					>
						{m.studio_update_close()}
					</button>
				{/if}
			</div>
		</div>
	{/snippet}
</Dialog>

<style>
	.refresh-icon-btn {
		width: 28px;
		height: 28px;
		padding: 0;
	}

	.refresh-symbol {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 14px;
	}

	.refresh-symbol.spinning {
		animation: spin 1s linear infinite;
	}

	.modal-body-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.channel-picker {
		border: none;
		padding: 0;
		margin: 0;
	}

	.channel-picker legend {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
		margin-bottom: var(--space-2);
	}

	.channel-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.channel-choice {
		padding: var(--space-2) var(--space-3);
		gap: 2px;
	}

	.channel-radio-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.channel-title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.channel-title-row strong {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
	}

	.channel-desc {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		line-height: 1.3;
		padding-left: calc(16px + var(--space-2));
	}

	.channel-badge {
		font-size: var(--text-caption);
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		line-height: 1.2;
		letter-spacing: 0.02em;
	}

	.channel-badge.stable {
		background: color-mix(in oklab, var(--success) 15%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in oklab, var(--success) 30%, transparent);
	}

	.channel-badge.nightly {
		background: color-mix(in oklab, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in oklab, var(--warn) 30%, transparent);
	}

	.channel-picker:disabled .channel-choice {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.version-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.version-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.v-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.v-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-variant-numeric: tabular-nums;
	}

	.v-badge.current {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink);
	}

	.v-badge.target {
		background: var(--brand);
		color: var(--on-brand);
	}

	.v-arrow {
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		--icon-size: 14px;
	}

	.channel-tag {
		font-size: var(--text-caption);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.up-to-date-tag {
		font-size: var(--text-label);
		color: var(--brand-ink);
		font-weight: 500;
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		--icon-size: 14px;
	}

	.channel-waiting {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		line-height: 1.4;
	}

	.release-meta {
		padding: var(--space-2) 0;
	}

	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}

	.release-identity {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.release-title {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.release-date {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.notes-container {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		max-height: 140px;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.notes-heading {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.release-notes {
		font-family: inherit;
		font-size: var(--text-caption);
		color: var(--ink);
		line-height: 1.4;
		margin: 0;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.asset-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		gap: var(--space-2);
	}

	.asset-text {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.asset-name {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.asset-size {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.sha-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--brand) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--brand) 25%, transparent);
		font-size: var(--text-caption);
		color: var(--brand-ink);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.sha-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
		letter-spacing: normal;
	}

	.sha-code {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.no-asset-notice {
		font-size: var(--text-caption);
		color: var(--warn);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) 0;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.progress-pct {
		font-weight: 600;
		color: var(--brand-ink);
		font-variant-numeric: tabular-nums;
	}

	.progress-bar-bg {
		width: 100%;
		height: 4px;
		background: var(--bg-sunken);
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
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.progress-speed {
		font-family: var(--font-mono);
	}

	/* Riga d'esito con IconCircleCheck --success + testo --ink (nessuna card colorata) */
	.finished-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		color: var(--ink);
	}

	.finished-icon {
		display: flex;
		align-items: center;
		color: var(--success);
		--icon-size: 18px;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.finished-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-body);
		color: var(--ink);
	}

	.finished-desc {
		font-size: var(--text-label);
		color: var(--ink-muted);
	}

	.error-banner {
		background: var(--bg-sunken);
		border: 1px solid var(--danger);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--danger);
		font-size: var(--text-caption);
	}

	.update-footer-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: var(--space-3);
	}

	.btn-github {
		gap: var(--space-1);
		color: var(--ink-muted);
		--icon-size: 14px;
	}

	.btn-github:hover {
		color: var(--brand-ink);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
