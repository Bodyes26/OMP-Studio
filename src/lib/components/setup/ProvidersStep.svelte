<script lang="ts">
	/**
	 * Passo Provider del setup (SET-011, SET-040).
	 *
	 * Tre gruppi, nell'ordine del prototipo approvato:
	 * 1. «Trovati su questo computer» — chi ha Claude Code, Codex CLI o Ollama
	 *    installati li vede per primi, con il nome dello strumento nella tessera
	 *    (`setup_detect_tools`, sola lettura del filesystem).
	 * 2. «Più usati» — le dodici tessere in evidenza.
	 * 3. «Altri provider» — riga che apre ricerca ed elenco compatto sull'elenco
	 *    completo che risponde `get_login_providers`: nessun elenco scritto a mano
	 *    qui, così non invecchia quando omp aggiunge un provider.
	 *
	 * Lo stato del login vive in `SetupLoginStore`: questo componente disegna e
	 * inoltra i clic. Gli id collegati escono da `onConnectedChange`.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '#lib/paraglide/messages.js';
	import { IconChevronDown, IconSearch } from '#lib/icons.ts';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import KeyLoginTerminal from './KeyLoginTerminal.svelte';
	import ProviderTile from './ProviderTile.svelte';
	import {
		FEATURED_PROVIDERS,
		NO_DETECTED_TOOLS,
		authLabel,
		detectedToolLabel,
		type DetectedTools,
		type SetupProviderDef
	} from './setupProviders.ts';
	import { SetupLoginStore } from './setupLogin.svelte.ts';

	let {
		onConnectedChange
	} = $props<{
		onConnectedChange?: (ids: string[]) => void;
	}>();

	const login = new SetupLoginStore();

	let othersOpen = $state(false);
	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);

	// Il fuoco va nella ricerca quando il pannello si apre: si fa qui e non con
	// `autofocus`, che il compilatore segnala e che ruba il fuoco anche quando il
	// nodo non è ancora visibile.
	$effect(() => {
		if (!othersOpen) return;
		const timer = setTimeout(() => searchInput?.focus(), 40);
		return () => clearTimeout(timer);
	});
	let detected = $state<DetectedTools>(NO_DETECTED_TOOLS);

	onMount(() => {
		void (async () => {
			// Il Motore ha già installato omp quando si arriva qui, ma non è una
			// garanzia: se il processo non parte il passo resta usabile e lo dice.
			await login.ensureOpen();
			await login.reloadAccounts();
		})();
		void invoke<DetectedTools>('setup_detect_tools')
			.then((tools) => (detected = { ...NO_DETECTED_TOOLS, ...tools }))
			.catch(() => (detected = NO_DETECTED_TOOLS));
	});

	onDestroy(() => {
		void login.close();
	});

	// Ogni cambio di provider collegati risale al guscio, che abilita «Continua».
	let lastEmitted = '';
	$effect(() => {
		const ids = login.connected;
		const key = ids.join(',');
		if (key === lastEmitted) return;
		lastEmitted = key;
		onConnectedChange?.(ids);
	});

	/** Provider davvero presenti nel processo, per non mostrare una tessera che
	 *  omp non sa far partire. */
	const available = $derived(new Set(login.providers.map((p) => p.id)));

	/** Id con cui avviare/riprovare: il primo di `def.ids` che omp conosce. */
	function activeIdOf(def: SetupProviderDef): string {
		return def.ids.find((id) => available.has(id)) ?? def.ids[0];
	}

	/** Nome vero della risorsa secondo omp (es. «ChatGPT Plus/Pro (Codex
	 *  Subscription)»), con il marchio come fallback prima che l'elenco arrivi. */
	function displayNameOf(def: SetupProviderDef): string {
		const id = activeIdOf(def);
		return login.providers.find((p) => p.id === id)?.name ?? def.name;
	}

	function accountOf(def: SetupProviderDef): string | null {
		const account =
			login.accountFor(activeIdOf(def)) ??
			def.ids.map((id) => login.accountFor(id)).find((a) => a !== null) ??
			null;
		if (!account) return null;
		// Email e piano insieme dicono più di uno solo: «maurizio@… · Pro».
		const who = account.email ?? account.accountId ?? account.identityKey ?? null;
		const plan = account.plan ?? null;
		if (who && plan) return `${who} · ${plan}`;
		return who ?? plan;
	}

	const featuredDetected = $derived(
		FEATURED_PROVIDERS.filter((def) => detectedToolLabel(def, detected) !== null)
	);
	const featuredRest = $derived(
		FEATURED_PROVIDERS.filter((def) => detectedToolLabel(def, detected) === null)
	);

	/** Altri provider: tutto l'elenco del processo tranne le tessere in evidenza. */
	const featuredIds = $derived(new Set(FEATURED_PROVIDERS.flatMap((def) => def.ids)));
	const others = $derived(login.providers.filter((p) => !featuredIds.has(p.id)));
	const othersShown = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return others;
		return others.filter(
			(p) => p.name.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle)
		);
	});
	const othersConnected = $derived(others.filter((p) => login.connected.includes(p.id)).length);

	const connectedCount = $derived(login.connected.length);
	const countLabel = $derived(
		connectedCount === 0
			? m.setup2_prov_count_none()
			: connectedCount === 1
				? m.setup2_prov_count_one()
				: m.setup2_prov_count_many({ count: String(connectedCount) })
	);

	function start(def: SetupProviderDef) {
		// Chiave e server locale non passano dall'RPC: la tessera si allarga e
		// mostra `omp login <id>` in un terminale vero.
		const fallback = def.auth === 'key' || def.auth === 'local' ? 'terminal' : null;
		void login.start(activeIdOf(def), fallback);
	}

	function startOther(providerId: string) {
		// Sugli altri non si sa in anticipo come si collegano: si prova l'RPC e,
		// se omp chiede input nascosto o prompt interattivi, si passa al terminale.
		void login.start(providerId, null);
	}
	/** Account di un provider fuori dalle tessere in evidenza. */
	function accountOfId(providerId: string): string | null {
		const account = login.accountFor(providerId);
		if (!account) return null;
		const who = account.email ?? account.accountId ?? account.identityKey ?? null;
		const plan = account.plan ?? null;
		if (who && plan) return `${who} · ${plan}`;
		return who ?? plan;
	}

	/** C'è un account cancellabile per la tessera? Un provider autenticato solo
	 *  da una variabile d'ambiente non ha credenziali nostre da rimuovere. */
	function hasRemovableAccount(def: SetupProviderDef): boolean {
		return def.ids.some((id) => login.accountFor(id) !== null);
	}

	/** Un provider fuori elenco non dice come si collega: si annuncia il caso più
	 *  frequente (browser) e sarà omp a smentirlo quando il login parte davvero. */
	function guessAuth(providerId: string): 'browser' | 'key' | 'local' {
		if (providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'llama.cpp' || providerId === 'vllm') {
			return 'local';
		}
		return 'browser';
	}
</script>

<div class="providers-step">
	{#if featuredDetected.length > 0}
		<section class="prov-block">
			<div class="prov-head">
				<span class="t-group">{m.setup2_prov_group_detected()}</span>
				<span class="prov-count" aria-live="polite">{countLabel}</span>
			</div>
			<div class="prov-grid">
				{#each featuredDetected as def (def.key)}
					<ProviderTile
						{def}
						loginState={login.stateOf(activeIdOf(def))}
						displayName={displayNameOf(def)}
						account={accountOf(def)}
						canDisconnect={hasRemovableAccount(def)}
						detected={detectedToolLabel(def, detected)}
						activeId={activeIdOf(def)}
						onStart={() => start(def)}
						onReopen={() => void login.reopen(activeIdOf(def))}
						onSubmitCode={(code) => void login.submitCode(activeIdOf(def), code)}
						onCancel={() => login.cancel(activeIdOf(def))}
						onDisconnect={() => void login.disconnect(activeIdOf(def))}
						onTerminalDone={() => void login.finishTerminal(activeIdOf(def))}
					/>
				{/each}
			</div>
		</section>
	{/if}

	<section class="prov-block">
		<div class="prov-head">
			<span class="t-group">{m.setup2_prov_group_popular()}</span>
			{#if featuredDetected.length === 0}
				<span class="prov-count" aria-live="polite">{countLabel}</span>
			{/if}
		</div>
		<div class="prov-grid">
			{#each featuredRest as def (def.key)}
				<ProviderTile
					{def}
					loginState={login.stateOf(activeIdOf(def))}
					displayName={displayNameOf(def)}
					account={accountOf(def)}
					canDisconnect={hasRemovableAccount(def)}
					activeId={activeIdOf(def)}
					onStart={() => start(def)}
					onReopen={() => void login.reopen(activeIdOf(def))}
					onSubmitCode={(code) => void login.submitCode(activeIdOf(def), code)}
					onCancel={() => login.cancel(activeIdOf(def))}
					onDisconnect={() => void login.disconnect(activeIdOf(def))}
					onTerminalDone={() => void login.finishTerminal(activeIdOf(def))}
				/>
			{/each}
		</div>
	</section>

	<section class="prov-block">
		<button
			type="button"
			class="prov-others-toggle"
			aria-expanded={othersOpen}
			onclick={() => (othersOpen = !othersOpen)}
		>
			<span class="t-group">{m.setup2_prov_group_others()}</span>
			<span class="prov-others-count">{others.length}</span>
			{#if othersConnected > 0}
				<span class="prov-others-count">· {m.setup2_prov_others_connected({ count: String(othersConnected) })}</span>
			{/if}
			<span class="prov-others-action">
				{othersOpen ? m.setup2_prov_others_close() : m.setup2_prov_others_open()}
				<span class="prov-others-chevron {othersOpen ? 'is-open' : ''}">
					<IconChevronDown />
				</span>
			</span>
		</button>

		{#if othersOpen}
			<div class="prov-others rv-lift" style="--dur: 210ms">
				<label class="prov-search">
					<span class="prov-search-icon"><IconSearch /></span>
					<input
						class="ui-input prov-search-input"
						bind:this={searchInput}
						bind:value={query}
						placeholder={m.setup2_prov_search_placeholder({ count: String(others.length) })}
					/>
				</label>
				<ul class="prov-others-list">
					{#each othersShown as provider (provider.id)}
						{@const isConnected = login.connected.includes(provider.id) || provider.authenticated}
						{@const state = login.stateOf(provider.id)}
						{@const live = state.status !== 'idle' && state.status !== 'connected'}
						<li class="prov-other-row" class:is-live={live}>
							<div class="prov-other-main">
								<ProviderLogo provider={provider.id} size={16} />
								<span class="prov-other-name">{provider.name}</span>
								<span class="prov-other-meta">
									{isConnected
										? (accountOfId(provider.id) ?? m.setup2_prov_connected())
										: authLabel(guessAuth(provider.id))}
								</span>
								{#if isConnected}
									<span class="prov-other-state">
										{#if login.accountFor(provider.id)}
											<button
												type="button"
												class="prov-other-link"
												onclick={() => void login.disconnect(provider.id)}
											>
												{m.setup2_prov_disconnect()}
											</button>
										{/if}
										<StatusMark status="completed" label={m.setup2_prov_connected()} />
									</span>
								{:else if !live}
									<button
										type="button"
										class="ui-button ui-button-ghost ui-button-sm"
										onclick={() => startOther(provider.id)}
									>
										{m.setup2_prov_connect()}
									</button>
								{/if}
							</div>
							{#if live}
								<div class="prov-other-flow">
									{#if state.status === 'terminal'}
										<!-- omp ha rifiutato il login RPC perché vuole prompt interattivi:
										     qui si apre il vero `omp login <id>`, non un avviso. -->
										<KeyLoginTerminal
											providerId={provider.id}
											providerName={provider.name}
											onDone={() => void login.finishTerminal(provider.id)}
										/>
									{:else if state.status === 'error' || state.status === 'cancelled'}
										<div class="prov-other-line">
											<span class="prov-other-note">
												{state.status === 'error'
													? m.setup2_prov_error()
													: m.setup2_prov_cancelled()}
											</span>
											<button
												type="button"
												class="ui-button ui-button-secondary ui-button-sm"
												onclick={() => startOther(provider.id)}
											>
												{m.setup2_prov_retry()}
											</button>
										</div>
									{:else}
										<div class="prov-other-line">
											<StatusMark status="running" />
											<span class="prov-other-note">{m.setup2_prov_waiting()}</span>
											{#if state.promptTitle}
												<form
													class="prov-other-form"
													onsubmit={(event) => {
														event.preventDefault();
														const input = event.currentTarget.elements.namedItem('code');
														if (input instanceof HTMLInputElement) {
															void login.submitCode(provider.id, input.value);
															input.value = '';
														}
													}}
												>
													<input
														name="code"
														class="ui-input prov-other-input"
														autocomplete="off"
														spellcheck="false"
														placeholder={state.promptPlaceholder ?? m.setup2_prov_paste_code()}
													/>
													<button type="submit" class="ui-button ui-button-primary ui-button-sm">
														{m.setup2_prov_confirm()}
													</button>
												</form>
											{/if}
											<button
												type="button"
												class="prov-other-link"
												onclick={() => login.cancel(provider.id)}
											>
												{m.setup2_prov_cancel()}
											</button>
										</div>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
					{#if othersShown.length === 0}
						<li class="prov-others-empty">
							{m.setup2_prov_no_results({ query })}
						</li>
					{/if}
				</ul>
			</div>
		{/if}
	</section>

	{#if login.openError}
		<p class="prov-warning">{m.setup2_prov_runtime_error({ error: login.openError })}</p>
	{/if}

	{#if connectedCount === 0}
		<div class="prov-require">
			<span class="prov-require-dot" aria-hidden="true"></span>
			<span>{m.setup2_prov_need_one()}</span>
		</div>
	{/if}
</div>

<style>
	.providers-step {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.prov-block {
		display: flex;
		flex-direction: column;
	}

	.prov-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.t-group {
		font-size: var(--text-group-label);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.prov-count {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.prov-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		align-items: start;
	}

	.prov-others-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 4px 0;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		color: var(--ink-faint);
	}

	.prov-others-toggle:hover {
		color: var(--ink);
	}

	.prov-others-count {
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}

	.prov-others-action {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.prov-others-chevron {
		display: inline-flex;
		transition: transform var(--dur-row) var(--ease-out);
	}

	.prov-others-chevron.is-open {
		transform: rotate(180deg);
	}

	.prov-others {
		animation: rv-lift-in var(--dur-row) var(--ease-reveal) backwards;
	}

	.prov-search {
		position: relative;
		display: block;
		margin-top: 8px;
	}

	.prov-search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.prov-search-input {
		width: 100%;
		padding-left: 32px;
	}

	.prov-others-list {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		max-height: 212px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.prov-other-row {
		padding: 6px 8px;
		border-bottom: 1px solid var(--line);
	}

	.prov-other-row:last-child {
		border-bottom: none;
	}

	.prov-other-row.is-live {
		background: var(--bg-hover);
	}

	.prov-other-main {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 28px;
	}

	.prov-other-name {
		font-size: 12.5px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prov-other-meta {
		flex: 1;
		min-width: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prov-other-state {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.prov-other-link {
		border: none;
		background: none;
		padding: 0;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		cursor: pointer;
	}

	.prov-other-link:hover {
		color: var(--ink);
	}

	.prov-other-flow {
		padding: 2px 0 4px 26px;
	}

	.prov-other-line {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-trace);
		color: var(--ink);
	}

	.prov-other-note {
		font-size: var(--text-trace);
		color: var(--ink-muted);
		margin: 0;
	}

	.prov-other-form {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.prov-other-input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-label);
	}

	.prov-others-empty {
		padding: 12px;
		font-size: var(--text-trace);
		color: var(--ink-faint);
	}

	.prov-warning {
		margin: 0;
		font-size: var(--text-trace);
		color: var(--ink-muted);
	}

	.prov-require {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 26px;
		font-size: var(--text-trace);
		color: var(--ink-muted);
	}

	.prov-require-dot {
		width: 9px;
		height: 9px;
		flex: none;
		border-radius: var(--radius-full);
		background: var(--warn);
	}

	@media (prefers-reduced-motion: reduce) {
		.prov-others,
		.prov-others-chevron {
			animation: none;
			transition: none;
		}
	}
</style>
