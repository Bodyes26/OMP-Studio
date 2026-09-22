<script lang="ts">
	import { githubStore } from '$lib/stores/github.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { IconGithub, IconRefresh, IconCheck, IconExternalLink } from '$lib/icons';
	import { onMount } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let tokenInput = $state('');
	let tokenError = $state<string | null>(null);
	let isSavingToken = $state(false);
	let installMessage = $state<string | null>(null);

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

	async function handleLogout() {
		await githubStore.logout();
		tokenError = null;
		tokenInput = '';
	}

	async function handleInstallCli() {
		installMessage = null;
		try {
			const res = await githubStore.installCli();
			installMessage = res;
		} catch (e) {
			installMessage = `Errore: ${String(e)}`;
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
				<h4>Account GitHub</h4>
				<span class="block-desc">
					Sincronizza repository, monitora la CI delle build e clona i tuoi progetti con un clic.
				</span>
			</div>
			<button
				type="button"
				class="btn-refresh"
				onclick={() => { void githubStore.loadStatus(); void githubStore.detectLocalRemotes(); }}
				disabled={githubStore.isLoadingStatus}
				title="Ricarica stato GitHub"
				aria-label="Ricarica stato GitHub"
			>
				<span class="icon" class:spin={githubStore.isLoadingStatus}><IconRefresh /></span>
			</button>
		</div>

		{#if githubStore.status.authenticated}
			<div class="account-card">
				<div class="account-avatar">
					{#if githubStore.status.avatarUrl}
						<img src={githubStore.status.avatarUrl} alt={githubStore.status.username ?? 'Avatar'} />
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
						<span class="status-pill connected"><IconCheck /> Connesso</span>
						<span class="method-pill" class:cli={githubStore.status.method === 'gh_cli'}>
							{githubStore.status.method === 'gh_cli' ? 'GitHub CLI' : 'Personal Token'}
						</span>
					</div>
					<div class="account-meta">
						<span>Protocollo attivo: <strong>{githubStore.status.protocol.toUpperCase()}</strong></span>
					</div>
				</div>
				<div class="account-actions">
					<button
						type="button"
						class="btn-action"
						onclick={() => openExternal(`https://github.com/${githubStore.status.username}`)}
					>
						Apri profilo <IconExternalLink />
					</button>
					<button type="button" class="btn-action btn-danger" onclick={handleLogout}>
						Disconnetti
					</button>
				</div>
			</div>
		{:else}
			<div class="unconnected-card">
				<div class="unconnected-head">
					<div class="unconnected-icon"><IconGithub /></div>
					<div>
						<h5>Nessun account GitHub collegato</h5>
						<p class="unconnected-desc">
							Collega GitHub tramite GitHub CLI (consigliato per sviluppo locale) oppure incollando un Personal Access Token.
						</p>
					</div>
				</div>

				<div class="auth-methods-grid">
					<!-- Metodo 1: GitHub CLI -->
					<div class="method-box">
						<div class="method-box-header">
							<h6>Metodo 1 — GitHub CLI (gh)</h6>
							{#if githubStore.status.installed}
								<span class="badge-tag present">Installata</span>
							{:else}
								<span class="badge-tag missing">Non trovata</span>
							{/if}
						</div>
						<p class="method-box-desc">
							{#if githubStore.status.installed}
								La CLI <code>gh</code> è presente. Apri il terminale ed esegui <code>gh auth login</code>, poi clicca Ricarica.
							{:else}
								Installa GitHub CLI sul computer per gestire login, credenziali e clone in modo trasparente.
							{/if}
						</p>
						<div class="method-box-actions">
							{#if githubStore.status.installed}
								<button
									type="button"
									class="btn-primary"
									onclick={() => githubStore.loadStatus()}
									disabled={githubStore.isLoadingStatus}
								>
									Verifica login CLI
								</button>
							{:else}
								<button
									type="button"
									class="btn-primary"
									onclick={handleInstallCli}
									disabled={githubStore.isInstallingCli}
								>
									{#if githubStore.isInstallingCli}
										Installazione in corso...
									{:else}
										Installa con winget (1-click)
									{/if}
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
							<h6>Metodo 2 — Personal Access Token</h6>
							<span class="badge-tag">Senza installazioni</span>
						</div>
						<p class="method-box-desc">
							Genera un token su GitHub con permessi <code>repo</code> e incollalo qui per collegare Studio istantaneamente.
						</p>
						<div class="token-input-row">
							<input
								type="password"
								placeholder="ghp_... o github_pat_..."
								bind:value={tokenInput}
								onkeydown={(e) => { if (e.key === 'Enter') void handleSaveToken(); }}
								aria-label="GitHub Personal Access Token"
							/>
							<button
								type="button"
								class="btn-primary"
								onclick={handleSaveToken}
								disabled={isSavingToken || !tokenInput.trim()}
							>
								{isSavingToken ? 'Verifica...' : 'Collega'}
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
								Genera token con permessi corretti <IconExternalLink />
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
				<h4>Preferenze e Sincronizzazione</h4>
				<span class="block-desc">
					Comportamento di clonazione, controllo automatico aggiornamenti e badge.
				</span>
			</div>
		</div>

		<div class="options-list">
			<div class="option-row">
				<div class="option-info">
					<span class="option-title">Protocollo di clonazione predefinito</span>
					<span class="option-desc">Scegli tra HTTPS (semplice con token/CLI) o SSH (con chiave SSH configurata).</span>
				</div>
				<div class="option-control">
					<select
						value={settingsStore.github.cloneProtocol}
						onchange={(e) => settingsStore.patchGithub({ cloneProtocol: (e.target as HTMLSelectElement).value as 'https' | 'ssh' })}
						aria-label="Protocollo di clonazione predefinito"
					>
						<option value="https">HTTPS</option>
						<option value="ssh">SSH</option>
					</select>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span class="option-title">Controllo automatico remoto (Auto-fetch)</span>
					<span class="option-desc">Controlla se ci sono nuovi commit su GitHub quando Studio torna in primo piano.</span>
				</div>
				<div class="option-control">
					<input
						type="checkbox"
						checked={settingsStore.github.autoFetch}
						onchange={(e) => settingsStore.patchGithub({ autoFetch: (e.target as HTMLInputElement).checked })}
						aria-label="Controllo automatico remoto"
					/>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span class="option-title">Badge commit nella barra dei progetti (↑/↓)</span>
					<span class="option-desc">Mostra quanti commit sono in attesa di essere inviati o scaricati da GitHub.</span>
				</div>
				<div class="option-control">
					<input
						type="checkbox"
						checked={settingsStore.github.showUpstreamBadges}
						onchange={(e) => settingsStore.patchGithub({ showUpstreamBadges: (e.target as HTMLInputElement).checked })}
						aria-label="Badge commit nella barra dei progetti"
					/>
				</div>
			</div>

			<div class="option-row">
				<div class="option-info">
					<span class="option-title">Notifiche per build fallite (GitHub Actions)</span>
					<span class="option-desc">Mostra un avviso toast di sistema se la CI su GitHub fallisce dopo un push.</span>
				</div>
				<div class="option-control">
					<input
						type="checkbox"
						checked={settingsStore.github.notifyActionsFailure}
						onchange={(e) => settingsStore.patchGithub({ notifyActionsFailure: (e.target as HTMLInputElement).checked })}
						aria-label="Notifiche per build fallite"
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
					<h4>Progetti locali collegati a GitHub ({githubStore.localRemotes.length})</h4>
					<span class="block-desc">
						Cartelle trovate in {projectStore.projectRoot} associate a un repository GitHub remoto.
					</span>
				</div>
			</div>

			<div class="remotes-table">
				{#each githubStore.localRemotes as remote (remote.path)}
					<div class="remote-row">
						<div class="remote-main">
							<span class="remote-folder">📁 {remote.folderName}</span>
							<span class="remote-slug">
								<IconGithub /> {remote.fullName}
							</span>
						</div>
						<div class="remote-actions">
							<button
								type="button"
								class="btn-subtle"
								onclick={() => openExternal(`https://github.com/${remote.fullName}`)}
								title="Apri su GitHub"
							>
								GitHub <IconExternalLink />
							</button>
							<button
								type="button"
								class="btn-subtle btn-open"
								onclick={() => projectStore.openProject(remote.path)}
								title="Apri in Studio"
							>
								Apri in Studio
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.github-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
	}

	.section-block {
		background: var(--surface-1);
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

	.block-titles h4 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
	}

	.block-desc {
		font-size: 0.82rem;
		color: var(--ink-muted);
		margin-top: 2px;
		display: block;
	}

	.btn-refresh {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 6px;
		color: var(--ink-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.btn-refresh:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.icon.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* Account card */
	.account-card {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.account-avatar img,
	.avatar-fallback {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--brand);
	}

	.avatar-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-3);
		color: var(--ink);
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
		font-weight: 700;
		font-size: 1rem;
		color: var(--ink);
	}

	.account-realname {
		color: var(--ink-muted);
		font-size: 0.9rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--success, #2ecc71) 15%, transparent);
		color: var(--success, #2ecc71);
		font-weight: 600;
	}

	.method-pill {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.method-pill.cli {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.account-meta {
		font-size: 0.8rem;
		color: var(--ink-muted);
	}

	.account-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn-action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 6px 12px;
		font-size: 0.82rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-1);
		color: var(--ink);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-action:hover {
		background: var(--bg-hover);
	}

	.btn-action.btn-danger {
		color: var(--danger, #e74c3c);
		border-color: color-mix(in srgb, var(--danger, #e74c3c) 30%, transparent);
	}

	.btn-action.btn-danger:hover {
		background: color-mix(in srgb, var(--danger, #e74c3c) 15%, transparent);
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

	.unconnected-icon {
		padding: 10px;
		background: var(--surface-2);
		border-radius: 50%;
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.unconnected-head h5 {
		margin: 0 0 4px 0;
		font-size: 0.95rem;
		color: var(--ink);
	}

	.unconnected-desc {
		margin: 0;
		font-size: 0.82rem;
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
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.method-box-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.method-box-header h6 {
		margin: 0;
		font-size: 0.88rem;
		color: var(--ink);
	}

	.badge-tag {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--surface-3);
		color: var(--ink-muted);
	}

	.badge-tag.present {
		background: color-mix(in srgb, var(--success, #2ecc71) 15%, transparent);
		color: var(--success, #2ecc71);
	}

	.badge-tag.missing {
		background: color-mix(in srgb, var(--warn, #f39c12) 15%, transparent);
		color: var(--warn, #f39c12);
	}

	.method-box-desc {
		font-size: 0.78rem;
		color: var(--ink-muted);
		margin: 0;
		line-height: 1.4;
	}

	.method-box-desc code {
		background: var(--surface-3);
		padding: 1px 4px;
		border-radius: 3px;
		font-family: var(--font-mono);
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

	.token-input-row input {
		flex: 1;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-1);
		color: var(--ink);
		font-size: 0.82rem;
	}

	.btn-primary {
		padding: 6px 12px;
		background: var(--brand);
		color: #ffffff;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.15s ease;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-link {
		background: none;
		border: none;
		color: var(--brand);
		font-size: 0.76rem;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		text-decoration: underline;
	}

	.error-feedback {
		font-size: 0.76rem;
		color: var(--danger, #e74c3c);
	}

	.install-feedback {
		font-size: 0.76rem;
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
		padding: var(--space-2) 0;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
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
		font-size: 0.86rem;
		font-weight: 500;
		color: var(--ink);
	}

	.option-desc {
		font-size: 0.78rem;
		color: var(--ink-muted);
	}

	.option-control select {
		padding: 4px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--ink);
		font-size: 0.82rem;
	}

	/* Remotes table */
	.remotes-table {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.remote-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.remote-main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.remote-folder {
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--ink);
	}

	.remote-slug {
		font-size: 0.8rem;
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.remote-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn-subtle {
		padding: 4px 8px;
		font-size: 0.76rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-1);
		color: var(--ink-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.btn-subtle:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btn-subtle.btn-open {
		color: var(--brand);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
	}
</style>
