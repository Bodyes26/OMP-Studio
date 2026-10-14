<script lang="ts">
	import type { HostSummary, RemoteFolder, RemoteFolderList, CommandError } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';

	let {
		host,
		onClose
	} = $props<{
		host: HostSummary;
		onClose: () => void;
	}>();

	let loading = $state(true);
	let folderList = $state<RemoteFolderList | null>(null);
	let fetchError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let openingPath = $state<string | null>(null);

	// Form creazione progetto
	let newName = $state('');
	let visibility = $state<'local' | 'private' | 'public'>('local');
	let isCreating = $state(false);

	$effect(() => {
		void loadFolders();
	});

	function getErrorMessage(err: unknown): string {
		if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
			return (err as CommandError).message;
		}
		return String(err);
	}

	async function loadFolders(): Promise<void> {
		loading = true;
		fetchError = null;
		try {
			const res = (await connection.sendCommand(host.id, {
				kind: 'list_project_folders'
			})) as RemoteFolderList;
			folderList = res;
		} catch (err) {
			fetchError = getErrorMessage(err);
		} finally {
			loading = false;
		}
	}

	async function handleOpen(folder: RemoteFolder): Promise<void> {
		if (folder.openProjectId || openingPath || isCreating) return;
		openingPath = folder.path;
		actionError = null;
		try {
			await connection.sendCommand(host.id, {
				kind: 'open_project',
				path: folder.path
			});
			onClose();
		} catch (err) {
			actionError = getErrorMessage(err);
			openingPath = null;
		}
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		const trimmed = newName.trim();
		if (!trimmed || isCreating || openingPath) return;

		isCreating = true;
		actionError = null;
		try {
			const github = visibility === 'local' ? null : { visibility };
			await connection.sendCommand(host.id, {
				kind: 'create_project',
				name: trimmed,
				github
			});
			onClose();
		} catch (err) {
			actionError = getErrorMessage(err);
			isCreating = false;
		}
	}
</script>

<div
	class="sheet-backdrop"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
	role="presentation"
>
	<div
		class="sheet-card"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="sheet-header">
			<div class="header-title-wrap">
				<h2 class="sheet-title">{t('projectSheetTitle', { machine: host.name })}</h2>
				{#if folderList?.root}
					<span class="root-hint" title={folderList.root}>{folderList.root}</span>
				{:else if !loading && folderList && !folderList.root}
					<span class="root-hint warning">{t('projectsRootUnset')}</span>
				{/if}
			</div>
			<button class="btn btn-ghost close-btn" onclick={onClose} aria-label={t('close')}>
				✕
			</button>
		</div>

		{#if actionError}
			<div class="error-banner" role="alert">
				<span class="error-text">{actionError}</span>
				<button class="dismiss-btn" onclick={() => (actionError = null)}>✕</button>
			</div>
		{/if}

		<div class="sheet-body">
			<!-- Elenco cartelle nella radice -->
			<section class="section">
				<div class="section-header">
					<h3 class="section-title">{t('foldersSectionTitle')}</h3>
					{#if folderList}
						<span class="count-badge">{folderList.folders.length}</span>
					{/if}
				</div>

				{#if loading}
					<div class="loading-state">
						<span class="spinner"></span>
					</div>
				{:else if fetchError}
					<div class="error-box">
						<p>{fetchError}</p>
						<button class="btn btn-secondary btn-sm" onclick={loadFolders}>Riprova</button>
					</div>
				{:else if !folderList?.root}
					<p class="empty-hint">{t('projectsRootUnset')}</p>
				{:else if folderList.folders.length === 0}
					<p class="empty-hint">{t('noFoldersInRoot')}</p>
				{:else}
					<div class="folder-list">
						{#each folderList.folders as folder (folder.path)}
							<button
								type="button"
								class="folder-item"
								class:is-open={Boolean(folder.openProjectId)}
								class:is-opening={openingPath === folder.path}
								disabled={Boolean(folder.openProjectId) || Boolean(openingPath) || isCreating}
								onclick={() => handleOpen(folder)}
							>
								<div class="folder-info">
									<span class="folder-icon">📁</span>
									<span class="folder-name">{folder.name}</span>
								</div>
								<div class="folder-badges">
									{#if folder.git}
										<span class="badge git-badge">{t('folderIsGit')}</span>
									{/if}
									{#if folder.openProjectId}
										<span class="badge open-badge">{t('folderAlreadyOpen')}</span>
									{:else if openingPath === folder.path}
										<span class="badge loading-badge">{t('openingProject')}</span>
									{:else}
										<span class="open-action">{t('openFolderAction')} →</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Form creazione nuovo progetto -->
			<section class="section create-section">
				<h3 class="section-title">{t('createProjectSectionTitle')}</h3>
				<form class="create-form" onsubmit={handleCreate}>
					<div class="field">
						<label for="new-project-name">{t('projectNameLabel')}</label>
						<input
							id="new-project-name"
							type="text"
							class="input-field"
							placeholder={t('projectNamePlaceholder')}
							bind:value={newName}
							disabled={isCreating || Boolean(openingPath)}
							required
						/>
					</div>

					<div class="field">
						<span class="field-label">{t('githubVisibilityLabel')}</span>
						<div class="radio-group">
							<label class="radio-option" class:active={visibility === 'local'}>
								<input
									type="radio"
									name="visibility"
									value="local"
									bind:group={visibility}
									disabled={isCreating}
								/>
								<span>{t('githubVisibilityNone')}</span>
							</label>

							<label
								class="radio-option"
								class:active={visibility === 'private'}
								class:disabled={folderList !== null && !folderList.githubAvailable}
							>
								<input
									type="radio"
									name="visibility"
									value="private"
									bind:group={visibility}
									disabled={isCreating || (folderList !== null && !folderList.githubAvailable)}
								/>
								<span>{t('githubVisibilityPrivate')}</span>
							</label>

							<label
								class="radio-option"
								class:active={visibility === 'public'}
								class:disabled={folderList !== null && !folderList.githubAvailable}
							>
								<input
									type="radio"
									name="visibility"
									value="public"
									bind:group={visibility}
									disabled={isCreating || (folderList !== null && !folderList.githubAvailable)}
								/>
								<span>{t('githubVisibilityPublic')}</span>
							</label>
						</div>
						{#if folderList !== null && !folderList.githubAvailable}
							<span class="field-hint warning">{t('githubUnavailableHint')}</span>
						{/if}
					</div>

					<button
						type="submit"
						class="btn btn-primary submit-btn"
						disabled={!newName.trim() || isCreating || Boolean(openingPath)}
					>
						{#if isCreating}
							{t('creatingProject')}
						{:else}
							{t('createProjectBtn')}
						{/if}
					</button>
				</form>
			</section>
		</div>
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.65);
		backdrop-filter: blur(4px);
		display: flex;
		justify-content: flex-end;
		z-index: 150;
	}

	.sheet-card {
		width: 100%;
		max-width: 480px;
		height: 100%;
		background: var(--bg-base);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		box-shadow: -4px 0 24px oklch(0 0 0 / 0.4);
	}

	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
		gap: 12px;
	}

	.header-title-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow: hidden;
	}

	.sheet-title {
		font-size: 16px;
		font-weight: 700;
		color: var(--ink);
	}

	.root-hint {
		font-size: 11px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: monospace;
	}

	.root-hint.warning {
		color: var(--brand);
	}

	.close-btn {
		width: 36px;
		height: 36px;
		font-size: 16px;
		flex-shrink: 0;
	}

	.error-banner {
		background: var(--danger-bg);
		border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		padding: 10px 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.error-text {
		color: var(--danger);
		font-size: 13px;
		line-height: 1.4;
	}

	.dismiss-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 14px;
		padding: 2px 6px;
	}

	.sheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.section-title {
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.count-badge {
		font-size: 11px;
		font-weight: 600;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		padding: 2px 7px;
		border-radius: var(--radius-full);
		color: var(--ink-muted);
	}

	.loading-state {
		display: flex;
		justify-content: center;
		padding: 24px;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--ink);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-hint {
		font-size: 13px;
		color: var(--ink-faint);
		padding: 12px 0;
	}

	.folder-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 260px;
		overflow-y: auto;
	}

	.folder-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-base), border-color var(--dur-base);
		gap: 8px;
	}

	.folder-item:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong, var(--ink-faint));
	}

	.folder-item.is-open {
		cursor: default;
		opacity: 0.75;
		border-color: var(--line);
	}

	.folder-item:disabled:not(.is-open) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.folder-info {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}

	.folder-icon {
		font-size: 16px;
		flex-shrink: 0;
	}

	.folder-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.folder-badges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.git-badge {
		color: var(--ink-muted);
		background: var(--bg-base);
		border: 1px solid var(--line);
	}

	.open-badge {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	.loading-badge {
		background: var(--bg-base);
		color: var(--ink-faint);
	}

	.open-action {
		font-size: 12px;
		color: var(--brand);
		font-weight: 600;
	}

	.create-section {
		border-top: 1px solid var(--line);
		padding-top: 20px;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label,
	.field-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-muted);
	}

	.field-hint {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.field-hint.warning {
		color: var(--brand);
	}

	.input-field {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 10px 12px;
		color: var(--ink);
		font-size: 14px;
		outline: none;
		transition: border-color var(--dur-base);
	}

	.input-field:focus {
		border-color: var(--ink-muted);
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.radio-option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: 13px;
		color: var(--ink);
		transition: background var(--dur-base), border-color var(--dur-base);
	}

	.radio-option.active {
		border-color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.radio-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-btn {
		margin-top: 4px;
		padding: 12px;
		font-weight: 600;
		font-size: 14px;
	}
</style>
