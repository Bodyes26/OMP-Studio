<script lang="ts">
	/**
	 * Tessera di un provider nel passo Provider.
	 *
	 * Tre forme, come nel prototipo approvato:
	 * - a riposo: logo, nome, piano; al passaggio del mouse appare il tipo di
	 *   accesso (browser/chiave/locale), che dice in anticipo cosa succederà;
	 * - collegata: sfondo `--bg-hover`, spunta neutra e account, con «Scollega»
	 *   che compare solo col fuoco o col passaggio del mouse;
	 * - in corso: la tessera occupa due colonne e mostra il flusso vivo (attesa
	 *   browser, codice, errore) o il terminale per i provider a chiave.
	 *
	 * Essendo un controllo e non un pannello, non ha card annidata: il corpo del
	 * flusso sta nella stessa superficie, separato da una riga.
	 */
	import { m } from '#lib/paraglide/messages.js';
	import {
		IconCopy,
		IconExternalLink,
		IconKey,
		IconLoop,
		IconTerminal
	} from '#lib/icons.ts';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import KeyLoginTerminal from './KeyLoginTerminal.svelte';
	import {
		authLabel,
		type SetupProviderDef
	} from './setupProviders.ts';
	import {
		copyToClipboard,
		MIN_CODE_LENGTH,
		type LoginState
	} from './setupLogin.svelte.ts';

	let {
		def,
		loginState,
		/** Nome vero della risorsa che omp incontrerà (ChatGPT Plus/Pro…). */
		displayName,
		/** Account collegato, se c'è: email o piano, secondo `get_auth_accounts`. */
		account,
		/** C'è una credenziale rimovibile: senza (es. variabile d'ambiente) il
		 *  pulsante «Scollega» non avrebbe niente da fare e resterebbe muto. */
		canDisconnect = true,
		/** Etichetta dello strumento trovato sul computer (gruppo in testa). */
		detected = null,
		/** Id con cui si è collegato: può differire da `def.ids[0]` (alias). */
		activeId,
		onStart,
		onReopen,
		onSubmitCode,
		onCancel,
		onDisconnect,
		onTerminalDone
	} = $props<{
		def: SetupProviderDef;
		loginState: LoginState;
		displayName: string;
		account: string | null;
		canDisconnect?: boolean;
		detected?: string | null;
		activeId: string;
		onStart: () => void;
		onReopen: () => void;
		onSubmitCode: (code: string) => void;
		onCancel: () => void;
		onDisconnect: () => void;
		onTerminalDone: () => void;
	}>();

	let code = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const live = $derived(loginState.status !== 'idle' && loginState.status !== 'connected');
	const canSubmit = $derived(code.trim().length >= MIN_CODE_LENGTH);
	/** I provider che chiedono un valore singolo in RPC mostrano il campo codice. */
	const wantsPrompt = $derived(loginState.status === 'waiting' && loginState.promptTitle !== null);

	$effect(() => () => {
		if (copyTimer) clearTimeout(copyTimer);
	});

	async function copyDeviceCode() {
		if (!loginState.deviceCode) return;
		if (await copyToClipboard(loginState.deviceCode)) {
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1400);
		}
	}

	function submit() {
		if (!canSubmit) return;
		onSubmitCode(code.trim());
		code = '';
	}

	const AccessIcon = $derived(
		def.auth === 'key' ? IconKey : def.auth === 'local' ? IconTerminal : IconExternalLink
	);
</script>

{#if loginState.status === 'connected'}
	<div class="tile tile-connected" aria-label={m.setup2_prov_connected_aria({ name: displayName })}>
		<div class="tile-top">
			<ProviderLogo provider={def.logo} size={22} />
			<StatusMark status="completed" label={m.setup2_prov_connected()} />
		</div>
		<div class="tile-bottom">
			<span class="tile-name">{displayName}</span>
			<div class="tile-account-row">
				<span class="tile-meta">{account ?? m.setup2_prov_connected()}</span>
				{#if canDisconnect}
					<button type="button" class="tile-unlink" onclick={onDisconnect}>
						{m.setup2_prov_disconnect()}
					</button>
				{/if}
			</div>
		</div>
	</div>
{:else if !live}
	<button
		type="button"
		class="tile tile-idle"
		aria-label={m.setup2_prov_connect_aria({ name: displayName })}
		onclick={onStart}
	>
		<span class="tile-top">
			<ProviderLogo provider={def.logo} size={22} />
			<span class="tile-access-icon" aria-hidden="true"><AccessIcon /></span>
		</span>
		<span class="tile-bottom">
			<span class="tile-name">{displayName}</span>
			<span class="tile-meta" class:tile-detected={!!detected}>
				{detected ?? def.plan()}
			</span>
		</span>
	</button>
{:else}
	<div class="tile tile-live">
		<div class="tile-live-head">
			<ProviderLogo provider={def.logo} size={22} />
			<div class="tile-live-title">
				<span class="tile-name">{displayName}</span>
				<span class="tile-meta">{authLabel(def.auth)}</span>
			</div>
		</div>

		{#if loginState.status === 'terminal'}
			<KeyLoginTerminal providerId={activeId} providerName={displayName} onDone={onTerminalDone} />
		{:else if loginState.status === 'error' || loginState.status === 'cancelled'}
			<div class="tile-row">
				{#if loginState.status === 'error'}
					<StatusMark status="failed" label={m.setup2_prov_failed()} />
					<span class="tile-trace">{m.setup2_prov_error()}</span>
				{:else}
					<StatusMark status="pending" />
					<span class="tile-trace">{m.setup2_prov_cancelled()}</span>
				{/if}
				<button type="button" class="ui-button ui-button-secondary ui-button-sm" onclick={onStart}>
					<IconLoop />
					{m.setup2_prov_retry()}
				</button>
			</div>
			{#if loginState.status === 'error' && loginState.error}
				<p class="tile-detail">{loginState.error}</p>
			{/if}
		{:else}
			<div class="tile-row">
				<StatusMark status="running" label={m.setup2_prov_in_progress()} />
				<span class="tile-trace">
					{loginState.status === 'linking' ? m.setup2_prov_linking() : m.setup2_prov_waiting()}
				</span>
			</div>

			{#if loginState.deviceCode}
				<div class="tile-row tile-row-tight">
					<span class="tile-meta">{m.setup2_prov_device_code()}</span>
					<code class="tile-code">{loginState.deviceCode}</code>
					<button type="button" class="ui-button ui-button-ghost ui-button-sm" onclick={copyDeviceCode}>
						<IconCopy />
						{copied ? m.setup2_prov_copied() : m.setup2_prov_copy()}
					</button>
				</div>
			{/if}

			{#if wantsPrompt}
				<form
					class="tile-code-form"
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<input
						class="ui-input tile-code-input"
						autocomplete="off"
						spellcheck="false"
						aria-label={loginState.promptTitle ?? m.setup2_prov_paste_code()}
						placeholder={loginState.promptPlaceholder ?? m.setup2_prov_paste_code()}
						bind:value={code}
					/>
					<button type="submit" class="ui-button ui-button-primary" disabled={!canSubmit}>
						{m.setup2_prov_confirm()}
					</button>
				</form>
			{/if}

			<div class="tile-foot">
				<span class="tile-foot-hint">
					{loginState.url
						? m.setup2_prov_browser_opened({ url: loginState.url })
						: def.auth === 'local'
							? m.setup2_prov_search_server()
							: m.setup2_prov_browser_pending()}
				</span>
				<span class="tile-foot-actions">
					{#if loginState.url}
						<button type="button" class="tile-link" onclick={onReopen}>
							{m.setup2_prov_reopen()}
						</button>
					{/if}
					<button type="button" class="tile-link tile-link-quiet" onclick={onCancel}>
						{m.setup2_prov_cancel()}
					</button>
				</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.tile {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 84px;
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		font-family: var(--font-ui);
		color: var(--ink);
		transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
	}

	.tile-idle {
		cursor: pointer;
	}

	.tile-idle:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.tile-idle:focus-visible {
		outline: none;
		border-color: var(--brand);
		box-shadow: var(--focus-inset);
	}

	.tile-connected {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.tile-live {
		/* Occupa due colonne: il flusso ha bisogno di respiro, e così la griglia
		   si stringe attorno alla tessera attiva invece di allungarla. */
		grid-column: span 2;
		border-color: var(--line-strong);
		background: var(--bg-hover);
		animation: rv-lift-in var(--dur-row) var(--ease-reveal) backwards;
	}

	.tile-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
	}

	.tile-access-icon {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.tile-idle:hover .tile-access-icon,
	.tile-idle:focus-visible .tile-access-icon {
		opacity: 1;
	}

	.tile-bottom {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		margin-top: auto;
	}

	.tile-name {
		font-size: 12.5px;
		font-weight: 550;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tile-meta {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tile-meta.tile-detected {
		color: var(--ink-muted);
	}

	.tile-account-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.tile-unlink {
		margin-left: auto;
		flex: none;
		border: none;
		background: none;
		padding: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.tile-connected:hover .tile-unlink,
	.tile-unlink:focus-visible {
		opacity: 1;
	}

	.tile-unlink:hover {
		color: var(--ink);
	}

	.tile-live-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.tile-live-title {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.tile-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.tile-row-tight {
		gap: 6px;
	}

	.tile-trace {
		flex: 1;
		min-width: 0;
		font-size: var(--text-trace);
		color: var(--ink);
	}

	.tile-detail {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.tile-code {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.tile-code-form {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.tile-code-input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-label);
	}

	.tile-foot {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.tile-foot-hint {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tile-foot-actions {
		display: flex;
		gap: 10px;
		margin-left: auto;
		flex: none;
	}

	.tile-link {
		border: none;
		background: none;
		padding: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		cursor: pointer;
	}

	.tile-link:hover {
		color: var(--ink);
	}

	.tile-link-quiet {
		color: var(--ink-faint);
	}

	@media (prefers-reduced-motion: reduce) {
		.tile-live {
			animation: none;
		}
	}
</style>
