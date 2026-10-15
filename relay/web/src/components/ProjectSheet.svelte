<!--
  ProjectSheet.svelte — Foglio di apertura o creazione progetto su una macchina.
  Presentazione dialog Studio / bottom sheet su telefoni: superficie bg-overlay,
  ombra overlay, raggio xl, controlli .ui-* e icone Lucide (zero emoji).
-->
<script lang="ts">
	import type { HostSummary, RemoteFolder, RemoteFolderList, CommandError } from '../../../src/protocol.ts';
	import { t } from '../i18n.ts';
	import { connection } from '../connection.svelte.ts';
	import { IconClose, IconFolder, IconGitBranch, IconChevronRight, IconRefresh } from '../icons.ts';
	import StatusMark from './StatusMark.svelte';

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
		class="sheet-surface rv-lift"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="sheet-header">
			<div class="header-main">
				<h2 class="sheet-title">{t('projectSheetTitle', { machine: host.name })}</h2>
				{#if folderList?.root}
					<span class="root-hint" title={folderList.root}>{folderList.root}</span>
				{:else if !loading && folderList && !folderList.root}
					<span class="root-hint warning">{t('projectsRootUnset')}</span>
				{/if}
			</div>

			<button
				type="button"
				class="ui-button ui-button-ghost close-btn"
				onclick={onClose}
				aria-label={t('close')}
			>
				<IconClose />
			</button>
		</div>

		{#if actionError}
			<div class="error-banner" role="alert">
				<span class="error-text">{actionError}</span>
				<button
					type="button"
					class="ui-button ui-button-ghost dismiss-btn"
					onclick={() => (actionError = null)}
				>
					<IconClose />
				</button>
			</div>
		{/if}

		<div class="sheet-body">
			<!-- Elenco cartelle nella radice -->
			<section class="section">
				<div class="section-header">
					<h3 class="section-title">{t('foldersSectionTitle')}</h3>
					{#if folderList}
						<span class="ui-count">{folderList.folders.length}</span>
					{/if}
				</div>

				{#if loading}
					<div class="loading-state">
						<StatusMark status="running" />
						<span class="text-shimmer">{t('openingProject')}</span>
					</div>
				{:else if fetchError}
					<div class="error-box">
						<p class="error-text">{fetchError}</p>
						<button type="button" class="ui-button ui-button-secondary" onclick={loadFolders}>
							<IconRefresh />
							<span>Riprova</span>
						</button>
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
									<span class="folder-icon" aria-hidden="true"><IconFolder /></span>
									<span class="folder-name">{folder.name}</span>
								</div>
								<div class="folder-badges">
									{#if folder.git}
										<span class="ui-chip git-chip">
											<IconGitBranch />
											<span>{t('folderIsGit')}</span>
										</span>
									{/if}
									{#if folder.openProjectId}
										<span class="ui-chip open-chip">{t('folderAlreadyOpen')}</span>
									{:else if openingPath === folder.path}
										<span class="ui-chip loading-chip">
											<StatusMark status="running" />
											<span>{t('openingProject')}</span>
										</span>
									{:else}
										<span class="open-action">
											<span>{t('openFolderAction')}</span>
											<IconChevronRight />
										</span>
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
							class="ui-input"
							placeholder={t('projectNamePlaceholder')}
							bind:value={newName}
							disabled={isCreating || Boolean(openingPath)}
							required
						/>
					</div>

					<div class="field">
						<span class="field-label">{t('githubVisibilityLabel')}</span>
						<div class="radio-group">
							<label class="ui-choice radio-option" class:active={visibility === 'local'}>
								<div class="choice-row">
									<input
										type="radio"
										name="visibility"
										value="local"
										bind:group={visibility}
										disabled={isCreating}
									/>
									<span>{t('githubVisibilityNone')}</span>
								</div>
							</label>

							<label
								class="ui-choice radio-option"
								class:active={visibility === 'private'}
								class:disabled={folderList !== null && !folderList.githubAvailable}
							>
								<div class="choice-row">
									<input
										type="radio"
										name="visibility"
										value="private"
										bind:group={visibility}
										disabled={isCreating || (folderList !== null && !folderList.githubAvailable)}
									/>
									<span>{t('githubVisibilityPrivate')}</span>
								</div>
							</label>

							<label
								class="ui-choice radio-option"
								class:active={visibility === 'public'}
								class:disabled={folderList !== null && !folderList.githubAvailable}
							>
								<div class="choice-row">
									<input
										type="radio"
										name="visibility"
										value="public"
										bind:group={visibility}
										disabled={isCreating || (folderList !== null && !folderList.githubAvailable)}
									/>
									<span>{t('githubVisibilityPublic')}</span>
								</div>
							</label>
						</div>
						{#if folderList !== null && !folderList.githubAvailable}
							<span class="field-hint warning">{t('githubUnavailableHint')}</span>
						{/if}
					</div>

					<button
						type="submit"
						class="ui-button ui-button-primary submit-btn"
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
		background: var(--backdrop);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 200;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0;
	}

	@media (min-width: 640px) {
		.sheet-backdrop {
			align-items: center;
			padding: var(--space-4);
		}
	}

	.sheet-surface {
		width: 100%;
		max-width: 580px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		overflow: hidden;
	}

	@media (min-width: 640px) {
		.sheet-surface {
			border-radius: var(--radius-xl);
		}
	}

	.sheet-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-4) var(--space-4) var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		gap: var(--space-2);
	}

	.header-main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.sheet-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.root-hint {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.root-hint.warning {
		color: var(--warn);
	}

	.close-btn {
		width: 32px;
		height: 32px;
		--icon-size: 16px;
		flex-shrink: 0;
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		border-bottom: 1px solid color-mix(in oklab, var(--danger) 30%, transparent);
		color: var(--danger);
		font-size: var(--text-caption);
	}

	.dismiss-btn {
		width: 24px;
		height: 24px;
		--icon-size: 14px;
	}

	.sheet-body {
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		overflow-y: auto;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.section-title {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0;
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: var(--space-5);
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.error-box {
		padding: var(--space-3);
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}

	.empty-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin: 0;
		padding: var(--space-2) 0;
	}

	.folder-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		background: var(--bg-sunken);
		overflow: hidden;
		max-height: 260px;
		overflow-y: auto;
	}

	.folder-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out);
		gap: var(--space-2);
	}

	.folder-item:last-child {
		border-bottom: none;
	}

	.folder-item:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.folder-item:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.folder-info {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.folder-icon {
		color: var(--ink-muted);
		--icon-size: 16px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.folder-name {
		font-size: var(--text-caption);
		font-weight: 500;
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

	.git-chip {
		height: 20px;
		padding: 0 6px;
		font-size: var(--text-meta);
		--icon-size: 11px;
	}

	.open-chip {
		height: 20px;
		padding: 0 6px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
	}

	.loading-chip {
		height: 20px;
		padding: 0 6px;
		font-size: var(--text-meta);
	}

	.open-action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-meta);
		color: var(--ink-muted);
		--icon-size: 13px;
	}

	.create-section {
		border-top: 1px solid var(--line);
		padding-top: var(--space-4);
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field label,
	.field-label {
		font-size: var(--text-meta);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.radio-option {
		padding: 8px 10px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-sunken);
		cursor: pointer;
	}

	.choice-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-caption);
		color: var(--ink);
	}

	.radio-option.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.field-hint.warning {
		font-size: var(--text-meta);
		color: var(--warn);
	}

	.submit-btn {
		margin-top: 4px;
		width: 100%;
		height: 38px;
	}
</style>
