<script lang="ts">
	// Sezione GitHub (collegamento account, preferenze sincronizzazione e repository locali, Design v2).
	// Conforme alle regole di sistema: token semantici, Switch per le preferenze,
	// bottoni .ui-button, select .ui-select, input .ui-input e StatusMark per gli stati.
	import { onMount } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { m } from '$lib/paraglide/messages.js';
	import { githubStore } from '$lib/stores/github.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import {
		IconGithub,
		IconRefresh,
		IconExternalLink,
		IconFolderOpen
	} from '$lib/icons';
	import Switch from '$lib/ui/Switch.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import { IS_MAC, IS_WINDOWS } from '$lib/utils/platform';

	let tokenInput = $state('');
	let tokenError = $state<string | null>(null);
	let isSavingToken = $state(false);
	let installMessage = $state<string | null>(null);
	// L'URL dell'avatar puo' non caricarsi (rete, CSP): si ripiega sull'icona
	// invece di lasciare l'immagine rotta. Si azzera quando cambia l'URL.
	let avatarFailedUrl = $state<string | null>(null);
	let confirmLogoutOpen = $state(false);
	let isLoggingOut = $state(false);
	// winget e Homebrew coprono Windows e macOS; su Linux l'installazione
	// passa dal gestore pacchetti della distribuzione, che Studio non guida.
	const canInstallCli = IS_WINDOWS || IS_MAC;

	onMount(() => {
		void githubStore.loadStatus();
		void githubStore.detectLocalRemotes();
	});

	async function handleSaveToken() {
		if (!tokenInput.trim()) return;
		isSavingToken = true;
		tokenError = null;
		try {
			const res = await githubStore.setToken(tokenInput.trim());
			if (res.authenticated) {
				tokenInput = '';
			} else if (res.error) {
				tokenError = res.error;
			}
		} catch (e) {
			tokenError = String(e);
		} finally {
			isSavingToken = false;
		}
	}

	function requestLogout() {
		// Con gh la sessione e' condivisa con terminale e altri strumenti:
		// si chiede se uscire anche da li'. Con il PAT basta scollegare Studio.
		if (githubStore.status.method === 'gh_cli') {
			confirmLogoutOpen = true;
		} else {
			void handleLogout(false);
		}
	}

	async function handleLogout(alsoGhCli: boolean) {
		isLoggingOut = true;
		try {
			await githubStore.logout({ alsoGhCli });
		} finally {
			isLoggingOut = false;
			confirmLogoutOpen = false;
		}
		tokenError = null;
		tokenInput = '';
	}

	async function handleInstallCli() {
		installMessage = null;
		try {
			const res = await githubStore.installCli();
			installMessage = res;
		} catch (e) {
			installMessage = m.settings_github_install_error({ error: String(e) });
		}
	}

	function openExternal(url: string) {
		void openUrl(url);
	}
</script>

<div class="settings-section github-settings">
	<!-- 1. Stato Account & Connessione -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_github_account_title()}</h4>
				<span class="block-desc">{m.settings_github_account_desc()}</span>
			</div>
			<Tooltip text={m.setup_github_refresh_tooltip()} placement="bottom">
				<button
					type="button"
					class="ui-button ui-button-secondary btn-icon-only"
					onclick={() => { void githubStore.loadStatus(); void githubStore.detectLocalRemotes(); }}
					disabled={githubStore.isLoadingStatus}
					aria-label={m.setup_github_refresh_tooltip()}
				>
					{#if githubStore.isLoadingStatus}
						<StatusMark status="running" label={m.settings_github_refreshing()} />
					{:else}
						<IconRefresh />
					{/if}
				</button>
			</Tooltip>
		</div>

		{#if githubStore.status.authenticated}
			<div class="account-card">
				<div class="account-avatar">
					{#if githubStore.status.avatarUrl && avatarFailedUrl !== githubStore.status.avatarUrl}
						<img
							src={githubStore.status.avatarUrl}
							alt={githubStore.status.username ?? m.settings_github_avatar_alt()}
							onerror={() => (avatarFailedUrl = githubStore.status.avatarUrl)}
						/>
					{:else}
						<div class="avatar-fallback"><IconGithub /></div>
					{/if}
				</div>
				<div class="account-details">
					<div class="account-name-row">
						<span class="account-username">@{githubStore.status.username}</span>
						{#if githubStore.status.name}
							<span class="account-realname">({githubStore.status.name})</span>
						{/if}
						<span class="status-badge connected">
							<StatusMark status="completed" label={m.settings_github_status_connected()} />
							<span>{m.settings_github_status_connected()}</span>
						</span>
						<span class="method-pill" class:cli={githubStore.status.method === 'gh_cli'}>
							{githubStore.status.method === 'gh_cli' ? m.settings_github_method_cli() : m.settings_github_method_token()}
						</span>
					</div>
					<div class="account-meta">
						<span>{m.settings_github_active_protocol()} <strong>{githubStore.status.protocol.toUpperCase()}</strong></span>
					</div>
				</div>
				<div class="account-actions">
					<button
						type="button"
						class="ui-button ui-button-secondary"
						onclick={() => openExternal(`https://github.com/${githubStore.status.username}`)}
					>
						<span>{m.settings_github_open_profile()}</span>
						<IconExternalLink />
					</button>
					<button
						type="button"
						class="ui-button ui-button-ghost btn-danger-action"
						onclick={requestLogout}
						disabled={isLoggingOut}
					>
						{m.settings_github_disconnect()}
					</button>
				</div>
			</div>
		{:else}
			<div class="unconnected-card">
				<div class="unconnected-head">
					<div class="unconnected-icon"><IconGithub /></div>
					<div class="unconnected-copy">
						<h5>{m.settings_github_unconnected_title()}</h5>
						<p class="unconnected-desc">{m.settings_github_unconnected_desc()}</p>
					</div>
				</div>

				<div class="auth-methods-grid">
					<!-- Metodo 1: GitHub CLI -->
					<div class="method-box">
						<div class="method-box-header">
							<h6>{m.settings_github_method1_title()}</h6>
							{#if githubStore.status.installed}
								<span class="badge-tag present">{m.settings_github_cli_installed()}</span>
							{:else}
								<span class="badge-tag missing">{m.settings_github_cli_missing()}</span>
							{/if}
						</div>
						<p class="method-box-desc">
							{#if githubStore.status.installed}
								{m.settings_github_cli_present_before()} <code>gh</code> {m.settings_github_cli_present_middle()} <code>gh auth login</code>{m.settings_github_cli_present_after()}
							{:else}
								{m.settings_github_cli_install_desc()}
							{/if}
						</p>
						<div class="method-box-actions">
							{#if githubStore.status.installed}
								<button
									type="button"
									class="ui-button ui-button-primary"
									onclick={() => githubStore.useGhCli()}
									disabled={githubStore.isLoadingStatus}
								>
									{m.settings_github_cli_verify_login()}
								</button>
							{:else if canInstallCli}
								<button
									type="button"
									class="ui-button ui-button-primary"
									onclick={handleInstallCli}
									disabled={githubStore.isInstallingCli}
								>
									{#if githubStore.isInstallingCli}
										<StatusMark status="running" label={m.setup_btn_installing()} />
										<span>{m.setup_btn_installing()}</span>
									{:else}
										<span>{IS_MAC ? m.settings_github_cli_install_brew() : m.settings_github_cli_install_winget()}</span>
									{/if}
								</button>
							{:else}
								<button
									type="button"
									class="btn-link"
									onclick={() => openExternal('https://cli.github.com')}
								>
									<span>{m.settings_github_cli_install_link()}</span>
									<IconExternalLink />
								</button>
							{/if}
						</div>
						{#if installMessage}
							<div class="install-feedback">{installMessage}</div>
						{/if}
					</div>

					<!-- Metodo 2: Personal Access Token -->
					<div class="method-box">
						<div class="method-box-header">
							<h6>{m.settings_github_method2_title()}</h6>
							<span class="badge-tag">{m.settings_github_no_install_badge()}</span>
						</div>
						<p class="method-box-desc">
							{m.settings_github_token_desc_before()} <code>repo</code> {m.settings_github_token_desc_after()}
						</p>
						<div class="token-input-row">
							<input
								type="password"
								class="ui-input token-input"
								placeholder={m.settings_github_token_placeholder()}
								bind:value={tokenInput}
								onkeydown={(e) => { if (e.key === 'Enter') void handleSaveToken(); }}
								aria-label={m.settings_github_token_aria()}
							/>
							<button
								type="button"
								class="ui-button ui-button-primary"
								onclick={handleSaveToken}
								disabled={isSavingToken || !tokenInput.trim()}
							>
								{#if isSavingToken}
									<StatusMark status="running" label={m.settings_github_token_verifying_label()} />
									<span>{m.settings_github_token_verifying()}</span>
								{:else}
									<span>{m.settings_github_token_connect()}</span>
								{/if}
							</button>
						</div>
						{#if tokenError}
							<div class="error-feedback">{tokenError}</div>
						{/if}
						<div class="method-box-actions">
							<button
								type="button"
								class="btn-link"
								onclick={() => openExternal('https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=OMP+Studio')}
							>
								<span>{m.settings_github_token_generate()}</span>
								<IconExternalLink />
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- 2. Preferenze di sincronizzazione -->
	<div class="section-block">
		<div class="block-head-row">
			<div class="block-titles">
				<h4>{m.settings_github_prefs_title()}</h4>
				<span class="block-desc">{m.settings_github_prefs_desc()}</span>
			</div>
		</div>

		<div class="options-list">
			<div class="option-row">
				<div class="option-info">
					<span class="option-title">{m.settings_github_clone_protocol_title()}</span>
					<span class="option-desc">{m.settings_github_clone_protocol_desc()}</span>
				</div>
				<div class="option-control">
					<select
						class="ui-select protocol-select"
						value={settingsStore.github.cloneProtocol}
						onchange={(e) => settingsStore.patchGithub({ cloneProtocol: (e.target as HTMLSelectElement).value as 'https' | 'ssh' })}
						aria-label={m.settings_github_clone_protocol_title()}
					>
						<option value="https">HTTPS</option>
						<option value="ssh">SSH</option>
					</select>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span id="github-autofetch-title" class="option-title">{m.settings_github_auto_fetch_title()}</span>
					<span id="github-autofetch-desc" class="option-desc">{m.settings_github_auto_fetch_desc()}</span>
				</div>
				<div class="option-control">
					<Switch
						id="github-autofetch"
						ariaLabelledBy="github-autofetch-title"
						ariaDescribedBy="github-autofetch-desc"
						checked={settingsStore.github.autoFetch}
						onChange={(val) => settingsStore.patchGithub({ autoFetch: val })}
					/>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span id="github-upstream-badges-title" class="option-title">{m.settings_github_upstream_badges_title()}</span>
					<span id="github-upstream-badges-desc" class="option-desc">{m.settings_github_upstream_badges_desc()}</span>
				</div>
				<div class="option-control">
					<Switch
						id="github-upstream-badges"
						ariaLabelledBy="github-upstream-badges-title"
						ariaDescribedBy="github-upstream-badges-desc"
						checked={settingsStore.github.showUpstreamBadges}
						onChange={(val) => settingsStore.patchGithub({ showUpstreamBadges: val })}
					/>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span id="github-actions-notify-title" class="option-title">{m.settings_github_actions_notify_title()}</span>
					<span id="github-actions-notify-desc" class="option-desc">{m.settings_github_actions_notify_desc()}</span>
				</div>
				<div class="option-control">
					<Switch
						id="github-actions-notify"
						ariaLabelledBy="github-actions-notify-title"
						ariaDescribedBy="github-actions-notify-desc"
						checked={settingsStore.github.notifyActionsFailure}
						onChange={(val) => settingsStore.patchGithub({ notifyActionsFailure: val })}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- 3. Repository locali collegati a GitHub -->
	{#if githubStore.localRemotes.length > 0}
		<div class="section-block">
			<div class="block-head-row">
				<div class="block-titles">
					<h4>{m.settings_github_local_title()} <span class="count-badge">({githubStore.localRemotes.length})</span></h4>
					<span class="block-desc">{m.settings_github_local_desc({ root: projectStore.projectRoot })}</span>
				</div>
			</div>

			<div class="remotes-table">
				{#each githubStore.localRemotes as remote (remote.path)}
					<div class="remote-row">
						<div class="remote-main">
							<span class="remote-folder">
								<span class="folder-icon" aria-hidden="true"><IconFolderOpen /></span>
								<span>{remote.folderName}</span>
							</span>
							<span class="remote-slug">
								<span class="slug-icon" aria-hidden="true"><IconGithub /></span>
								<span>{remote.fullName}</span>
							</span>
						</div>
						<div class="remote-actions">
							<Tooltip text={m.settings_github_open_repo_tooltip()} placement="top">
								<button
									type="button"
									class="ui-button ui-button-secondary btn-subtle"
									onclick={() => openExternal(`https://github.com/${remote.fullName}`)}
									aria-label={m.settings_github_open_repo_aria({ name: remote.fullName })}
								>
									<span>GitHub</span>
									<IconExternalLink />
								</button>
							</Tooltip>
							<Tooltip text={m.settings_github_open_in_studio_tooltip()} placement="top">
								<button
									type="button"
									class="ui-button ui-button-secondary btn-subtle btn-open"
									onclick={() => projectStore.openProject(remote.path)}
									aria-label={m.settings_github_open_in_studio_aria({ name: remote.folderName })}
								>
									<span>{m.settings_github_open_in_studio()}</span>
								</button>
							</Tooltip>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={confirmLogoutOpen}
	title={m.settings_github_logout_cli_title()}
	message={m.settings_github_logout_cli_message()}
	cancelLabel={m.common_cancel()}
	secondaryLabel={m.settings_github_logout_studio_only()}
	confirmLabel={m.settings_github_logout_also_cli()}
	tone="danger"
	confirmDisabled={isLoggingOut}
	onSecondary={() => void handleLogout(false)}
	onConfirm={() => void handleLogout(true)}
	onCancel={() => (confirmLogoutOpen = false)}
/>

<style>
	.github-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		color: var(--ink);
	}

	.section-block {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.block-head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.block-titles {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.block-titles h4 {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 600;
		line-height: 1.3;
		color: var(--ink);
	}

	.block-desc {
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.btn-icon-only {
		width: 30px;
		height: 30px;
		padding: 0;
		--icon-size: 14px;
	}

	/* Account card */
	.account-card {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.account-avatar img,
	.avatar-fallback {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 1px solid var(--line);
	}

	.avatar-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-base);
		color: var(--ink);
		--icon-size: 20px;
	}

	.account-details {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.account-name-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.account-username {
		font-weight: 600;
		font-size: var(--text-body);
		color: var(--ink);
	}

	.account-realname {
		color: var(--ink-muted);
		font-size: var(--text-label);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
	}

	.method-pill {
		font-size: var(--text-caption);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		background: var(--bg-base);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.method-pill.cli {
		background: color-mix(in oklab, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border-color: color-mix(in oklab, var(--brand) 25%, transparent);
	}

	.account-meta {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.account-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		--icon-size: 13px;
	}

	.btn-danger-action {
		color: var(--danger);
	}

	.btn-danger-action:hover:not(:disabled) {
		background: color-mix(in oklab, var(--danger) 10%, transparent);
		color: var(--danger);
	}

	/* Unconnected */
	.unconnected-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.unconnected-head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.unconnected-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.unconnected-icon {
		width: 40px;
		height: 40px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		--icon-size: 20px;
	}

	.unconnected-head h5 {
		margin: 0;
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
	}

	.unconnected-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.auth-methods-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.method-box {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.method-box-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.method-box-header h6 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.badge-tag {
		font-size: var(--text-caption);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.badge-tag.present {
		background: color-mix(in oklab, var(--success) 15%, transparent);
		color: var(--success);
		border-color: color-mix(in oklab, var(--success) 30%, transparent);
	}

	.badge-tag.missing {
		background: color-mix(in oklab, var(--warn) 15%, transparent);
		color: var(--warn);
		border-color: color-mix(in oklab, var(--warn) 30%, transparent);
	}

	.method-box-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin: 0;
		line-height: 1.4;
	}

	.method-box-desc code {
		background: var(--bg-base);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--brand-ink);
	}

	.method-box-actions {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.token-input-row {
		display: flex;
		gap: var(--space-2);
	}

	.token-input {
		flex: 1;
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--brand-ink);
		font-size: var(--text-caption);
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		--icon-size: 12px;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.btn-link:hover {
		text-decoration: underline;
	}

	.error-feedback {
		font-size: var(--text-caption);
		color: var(--danger);
	}

	.install-feedback {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	/* Preferenze */
	.options-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.option-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--line);
	}

	.option-row:last-child {
		border-bottom: none;
	}

	.option-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.option-title {
		font-size: var(--text-body);
		font-weight: 500;
		color: var(--ink);
	}

	.option-desc {
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.protocol-select {
		min-width: 110px;
	}

	/* Remotes table */
	.count-badge {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		font-weight: 400;
	}

	.remotes-table {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.remote-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.remote-main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.remote-folder {
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.folder-icon {
		--icon-size: 13px;
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
	}

	.remote-slug {
		font-size: var(--text-label);
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.slug-icon {
		--icon-size: 13px;
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
	}

	.remote-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		--icon-size: 13px;
	}

	.btn-subtle {
		padding: 4px 10px;
		font-size: var(--text-caption);
	}

	.btn-subtle.btn-open {
		color: var(--brand-ink);
	}
</style>
