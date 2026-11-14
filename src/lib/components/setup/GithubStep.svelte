<!--
  GithubStep.svelte — passo GitHub (SET-016), facoltativo.

  Forma compatta della sezione GitHub delle Impostazioni: stesso store, stesso
  stato, nessuna logica nuova. Se `gh` è già autenticato basta un clic; altrimenti
  si può incollare un token. «Salta» non è un errore: GitHub si collega anche
  dopo, dalle Impostazioni.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconGithub, IconKey, IconRefresh } from '#lib/icons.ts';
	import { githubStore } from '#lib/stores/github.svelte.ts';

	let token = $state('');
	let tokenError = $state<string | null>(null);
	let saving = $state(false);
	let showToken = $state(false);

	const status = $derived(githubStore.status);

	async function connectWithGh() {
		tokenError = null;
		await githubStore.useGhCli();
	}

	async function connectWithToken() {
		const trimmed = token.trim();
		if (!trimmed || saving) return;
		saving = true;
		tokenError = null;
		try {
			const res = await githubStore.setToken(trimmed);
			if (res.authenticated) {
				token = '';
				showToken = false;
			} else {
				tokenError = res.error ?? m.setup2_github_token_failed();
			}
		} catch (e) {
			tokenError = String(e);
		} finally {
			saving = false;
		}
	}

	async function disconnect() {
		// Solo Studio: l'account di `gh` è condiviso con il terminale.
		await githubStore.logout();
	}
</script>

<div class="github">
	<div class="head">
		<div class="badge" aria-hidden="true"><IconGithub /></div>
		<div class="intro">
			{#if status.authenticated}
				<div class="title-row">
					<StatusMark status="completed" />
					<span class="title">{m.setup2_github_connected_as({ user: status.username ?? '' })}</span>
				</div>
				<p class="su-label desc">{m.setup2_github_connected_desc()}</p>
				<button type="button" class="ui-button ui-button-ghost small" onclick={() => void disconnect()}>
					{m.setup2_github_disconnect()}
				</button>
			{:else}
				<div class="title-row">
					<span class="title">{m.setup2_github_title()}</span>
				</div>
				<p class="su-label desc">{m.setup2_github_desc()}</p>
			{/if}
		</div>
	</div>

	{#if !status.authenticated}
		<div class="actions-row">
			{#if status.installed}
				<button
					type="button"
					class="ui-button ui-button-primary"
					disabled={githubStore.isLoadingStatus}
					onclick={() => void connectWithGh()}
				>
					{#if githubStore.isLoadingStatus}
						<StatusMark status="running" />
					{:else}
						<IconGithub />
					{/if}
					{m.setup2_github_use_cli()}
				</button>
			{/if}
			<button type="button" class="ui-button ui-button-secondary" onclick={() => (showToken = !showToken)}>
				<IconKey /> {showToken ? m.setup2_github_hide_token() : m.setup2_github_use_token()}
			</button>
			{#if !status.installed && !showToken}
				<p class="su-meta note">{m.setup2_github_cli_missing()}</p>
			{/if}
		</div>

		{#if showToken}
			<div class="token-row">
				<input
					class="ui-input token"
					type="password"
					autocomplete="off"
					spellcheck="false"
					placeholder={m.setup2_github_token_placeholder()}
					aria-label={m.setup2_github_token_aria()}
					bind:value={token}
					onkeydown={(e) => {
						if (e.key === 'Enter') void connectWithToken();
					}}
				/>
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={saving || !token.trim()}
					onclick={() => void connectWithToken()}
				>
					{#if saving}
						<StatusMark status="running" label={m.setup2_github_verifying()} />
						{m.setup2_github_verifying()}
					{:else}
						{m.setup2_github_connect_token()}
					{/if}
				</button>
			</div>
			{#if tokenError}
				<p class="su-meta error" role="alert">{tokenError}</p>
			{/if}
		{/if}
	{:else}
		<button type="button" class="ui-link quiet su-meta refresh" onclick={() => void githubStore.loadStatus()}>
			<IconRefresh /> {m.setup2_github_refresh()}
		</button>
	{/if}
</div>

<style>
	.github {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.badge {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex: none;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		color: var(--ink);
		--icon-size: 22px;
	}

	.intro {
		min-width: 0;
		flex: 1;
		padding-top: 2px;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.title {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--ink);
	}

	.desc {
		margin: 2px 0 0;
		color: var(--ink-muted);
	}

	.small {
		margin-top: 8px;
	}

	.actions-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.note {
		margin: 0;
		color: var(--ink-faint);
	}

	.token-row {
		display: flex;
		gap: var(--space-2);
	}

	.token {
		flex: 1;
		font-family: var(--font-mono);
	}

	.error {
		margin: 0;
		color: var(--danger);
	}

	.refresh {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		background: none;
		border: 0;
		padding: 0;
		--icon-size: 12px;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.quiet:hover {
		color: var(--ink-muted);
	}
</style>
