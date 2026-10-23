<script lang="ts">
	/**
	 * StudioUpdateModal — Dialogo di aggiornamento applicazione (Design v2).
	 * Layout piatto e tipografico: versione/stato in evidenza, changelog Markdown,
	 * dettagli installer in disclosure nativa, selettore canale compatto e footer responsive.
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
	import { lexMarkdown } from '$lib/agent/markdown';
	import Markdown from '$lib/agent/components/Markdown.svelte';
	import {
		IconRefresh,
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

	const releaseNotesMarkdown = $derived(
		studioUpdaterStore.updateInfo?.release_notes?.trim() ?? ''
	);

	const parsedReleaseNotes = $derived(
		releaseNotesMarkdown ? lexMarkdown(releaseNotesMarkdown) : []
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
		<!-- Intestazione di versione / stato -->
		<div class="update-header">
			{#if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo}
				<div class="version-row">
					<span class="version-target">v{formatVersion(studioUpdaterStore.updateInfo.latest_version)}</span>
					{#if studioUpdaterStore.updateInfo.release_channel === 'nightly'}
						<span class="channel-tag">{m.studio_update_channel_nightly()}</span>
					{/if}
				</div>
				{#if studioUpdaterStore.updateInfo.release_name && studioUpdaterStore.updateInfo.release_name !== `v${studioUpdaterStore.updateInfo.latest_version}`}
					<div class="release-name">{studioUpdaterStore.updateInfo.release_name}</div>
				{/if}
				<div class="version-secondary">
					<span>{m.studio_update_installed_label()}: v{formatVersion(studioUpdaterStore.currentVersion) || '...'}</span>
					{#if studioUpdaterStore.updateInfo.published_at}
						<span class="meta-dot" aria-hidden="true">•</span>
						<span>{formatDate(studioUpdaterStore.updateInfo.published_at)}</span>
					{/if}
				</div>
			{:else}
				<div class="version-row">
					{#if studioUpdaterStore.isChecking}
						<span class="checking-status">
							<span class="refresh-symbol spinning"><IconRefresh /></span>
							<span>{m.page_omp_update_status_checking()}</span>
						</span>
					{:else}
						<span class="up-to-date-status">
							<IconCircleCheck />
							<span>{m.studio_update_latest_tag()}</span>
						</span>
					{/if}
				</div>
				<div class="version-secondary">
					<span>{m.studio_update_installed_label()}: v{formatVersion(studioUpdaterStore.currentVersion) || '...'}</span>
					{#if studioUpdaterStore.updateInfo?.published_at}
						<span class="meta-dot" aria-hidden="true">•</span>
						<span>{formatDate(studioUpdaterStore.updateInfo.published_at)}</span>
					{/if}
				</div>
			{/if}
		</div>

		{#if studioUpdaterStore.updateInfo?.ahead_of_channel && studioUpdaterStore.channel === 'stable'}
			<p class="channel-waiting">
				{m.studio_update_ahead_message()}
			</p>
		{/if}

		<!-- Release notes renderizzate direttamente in Markdown -->
		{#if parsedReleaseNotes.length > 0}
			<div class="release-notes-content">
				<Markdown tokens={parsedReleaseNotes} />
			</div>
		{/if}

		<!-- Dettagli installer (File e SHA-256) in details nativo -->
		{#if studioUpdaterStore.hasUpdate && studioUpdaterStore.updateInfo?.asset}
			<details class="asset-details">
				<summary class="asset-summary">
					<span>{m.chat_v2_tray_quota_details()}</span>
				</summary>
				<div class="asset-body">
					<div class="asset-meta-row">
						<span class="asset-meta-label">{m.ui_filetree_file_8635()}</span>
						<span class="asset-meta-value mono" title={studioUpdaterStore.updateInfo.asset.name}>
							{studioUpdaterStore.updateInfo.asset.name}
						</span>
					</div>
					{#if studioUpdaterStore.updateInfo.asset.sha256}
						<div class="asset-meta-row">
							<span class="asset-meta-label">SHA-256</span>
							<Tooltip
								text={studioUpdaterStore.downloadProgress?.status === 'finished'
									? m.studio_update_sha_verified_tooltip({ sha: studioUpdaterStore.updateInfo.asset.sha256 })
									: m.studio_update_sha_expected_tooltip({ sha: studioUpdaterStore.updateInfo.asset.sha256 })}
							>
								<code class="asset-meta-value mono sha-code">
									{studioUpdaterStore.updateInfo.asset.sha256}
								</code>
							</Tooltip>
						</div>
					{/if}
				</div>
			</details>
		{:else if studioUpdaterStore.hasUpdate && !studioUpdaterStore.updateInfo?.asset}
			<p class="no-asset-notice">{m.studio_update_no_binary_notice()}</p>
		{/if}

		<!-- Selettore di canale compatto e piatto posizionato dopo il contenuto principale -->
		<fieldset class="channel-picker" disabled={studioUpdaterStore.channelChangeDisabled}>
			<legend class="channel-legend">{m.studio_update_channel_legend()}</legend>
			<div class="channel-options">
				<label class="channel-option">
					<input
						type="radio"
						name="studio-update-channel"
						value="stable"
						checked={studioUpdaterStore.channel === 'stable'}
						onchange={() => void studioUpdaterStore.setChannel('stable')}
					/>
					<div class="channel-content">
						<div class="channel-title">
							<span class="channel-name">{m.studio_update_channel_stable()}</span>
							<span class="channel-subtle-hint">({m.studio_update_channel_stable_recommended()})</span>
						</div>
						<div class="channel-desc">{m.studio_update_channel_stable_sub()}</div>
					</div>
				</label>
				<label class="channel-option">
					<input
						type="radio"
						name="studio-update-channel"
						value="nightly"
						checked={studioUpdaterStore.channel === 'nightly'}
						onchange={() => void studioUpdaterStore.setChannel('nightly')}
					/>
					<div class="channel-content">
						<div class="channel-title">
							<span class="channel-name">{m.studio_update_channel_nightly()}</span>
							<span class="channel-subtle-hint">({m.studio_update_channel_nightly_badge()})</span>
						</div>
						<div class="channel-desc">{m.studio_update_channel_nightly_sub()}</div>
					</div>
				</label>
			</div>
		</fieldset>

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

		<!-- Download completato -->
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

		<!-- Avvisi di installazione -->
		{#if studioUpdaterStore.installNotice}
			<div class="install-notice" role="status" aria-live="polite">
				{studioUpdaterStore.installNotice}
			</div>
		{/if}

		<!-- Errori -->
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
						<span>{m.studio_update_download_update()}</span>
						{#if studioUpdaterStore.updateInfo.asset.size}
							<span class="btn-size-label">({formatBytes(studioUpdaterStore.updateInfo.asset.size)})</span>
						{/if}
					</button>
				{:else}
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
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

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.modal-body-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* Intestazione di versione */
	.update-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.version-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.version-target {
		font-size: var(--text-prose-h2);
		font-weight: 600;
		color: var(--ink);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}

	.channel-tag {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.release-name {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
	}

	.version-secondary {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.meta-dot {
		color: var(--ink-faint);
		user-select: none;
	}

	.up-to-date-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-title);
		font-weight: 600;
		color: var(--ink);
		--icon-size: 20px;
	}

	.up-to-date-status :global(svg) {
		color: var(--success);
	}

	.checking-status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.channel-waiting {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
		margin: 0;
	}

	/* Release notes con Markdown */
	.release-notes-content {
		color: var(--ink);
		line-height: 1.6;
		padding-right: var(--space-1);
	}

	.release-notes-content :global(.heading.h1) {
		font-size: var(--text-title);
		margin: var(--space-2) 0 var(--space-1) 0;
	}

	.release-notes-content :global(.heading.h2) {
		font-size: var(--text-body);
		font-weight: 600;
		margin: var(--space-2) 0 var(--space-1) 0;
	}

	.release-notes-content :global(.heading.h3),
	.release-notes-content :global(.heading.h4) {
		font-size: var(--text-caption);
		font-weight: 600;
		margin: var(--space-2) 0 var(--space-1) 0;
	}

	.release-notes-content :global(.paragraph) {
		font-size: var(--text-body);
		line-height: 1.5;
		margin-bottom: var(--space-2);
	}

	.release-notes-content :global(.list) {
		font-size: var(--text-body);
		line-height: 1.5;
		padding-left: var(--space-4);
		margin-bottom: var(--space-2);
	}

	.release-notes-content :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	/* Asset details in disclosure nativo */
	.asset-details {
		border: none;
		margin: 0;
	}

	.asset-summary {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
		cursor: pointer;
		user-select: none;
		display: list-item;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.asset-summary:hover {
		color: var(--ink);
	}

	.asset-summary:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
		border-radius: var(--radius-xs);
	}

	.asset-body {
		padding-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.asset-meta-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-caption);
	}

	.asset-meta-label {
		color: var(--ink-faint);
		min-width: 54px;
		flex-shrink: 0;
	}

	.asset-meta-value {
		color: var(--ink-muted);
		word-break: break-all;
	}

	.asset-meta-value.mono {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.sha-code {
		font-family: var(--font-mono);
		color: var(--ink-muted);
		background: transparent;
		padding: 0;
	}

	.no-asset-notice {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
		margin: 0;
	}

	/* Selettore di canale compatto */
	.channel-picker {
		border: none;
		border-top: 1px solid var(--line);
		padding: var(--space-3) 0 0;
		margin: var(--space-1) 0 0;
	}

	.channel-legend {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		padding: 0;
		margin-bottom: var(--space-2);
	}

	.channel-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-3);
	}

	.channel-option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		cursor: pointer;
	}

	.channel-option input[type="radio"] {
		margin: 2px 0 0 0;
		accent-color: var(--brand);
		cursor: pointer;
		flex-shrink: 0;
	}

	.channel-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.channel-title {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-body);
		line-height: 1.3;
	}

	.channel-name {
		font-weight: 500;
		color: var(--ink);
	}

	.channel-subtle-hint {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.channel-desc {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.channel-picker:disabled {
		opacity: 0.6;
	}

	.channel-picker:disabled .channel-option,
	.channel-picker:disabled input[type="radio"] {
		cursor: not-allowed;
	}

	/* Progresso download */
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
		color: var(--ink);
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
		font-size: var(--text-caption);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.progress-speed {
		font-family: var(--font-mono);
	}

	/* Riga d'esito completamento */
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
		--icon-size: 20px;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.finished-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--text-body);
		color: var(--ink);
	}

	.finished-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.install-notice {
		font-size: var(--text-caption);
		color: var(--ink);
		white-space: pre-wrap;
		padding: var(--space-2) 0;
		border-top: 1px solid var(--line);
		line-height: 1.4;
	}

	.error-banner {
		color: var(--danger);
		font-size: var(--text-caption);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--danger);
		line-height: 1.4;
	}

	/* Footer responsive */
	.update-footer-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.btn-github {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-caption);
		padding: var(--space-1) var(--space-2);
		--icon-size: 13px;
	}

	.btn-github:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-left: auto;
	}

	.btn-size-label {
		font-size: var(--text-caption);
		font-weight: normal;
		opacity: 0.85;
		margin-left: 2px;
	}

	@media (max-width: 480px) {
		.update-footer-content {
			flex-direction: column-reverse;
			align-items: stretch;
		}

		.footer-actions {
			width: 100%;
			justify-content: flex-end;
		}

		.btn-github {
			justify-content: center;
		}
	}
</style>
