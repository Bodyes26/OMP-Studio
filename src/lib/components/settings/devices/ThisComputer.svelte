<!--
  «Questo computer» (R-MI-52, R-MI-56).

  Un solo nome per entrambi i canali — computer abbinati e Studio Remote —
  scritto da `devices_set_name`, e un solo indirizzo da digitare: il server di
  Studio Remote, dal quale Rust ricava il relay iroh. «Avanzate» resta per i
  server che non lo dichiarano: lì si toccano i due indirizzi e il token
  separati, più gli interruttori dei due collegamenti.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore, devicesSetName, devicesSetServer } from '#lib/backend/link.svelte.ts';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import Switch from '#lib/ui/Switch.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';

	let name = $state('');
	let server = $state('');
	let irohRelay = $state('');
	let relayToken = $state('');
	let removeToken = $state(false);
	let advancedOpen = $state(false);
	let hydrated = $state(false);
	let notice = $state('');
	let error = $state('');
	let confirmingForget = $state(false);

	// I due store arrivano con i rispettivi eventi: si riempiono i campi una
	// volta sola, poi l'utente è padrone di quello che scrive.
	$effect(() => {
		if (hydrated) return;
		const linkName = linkStore.status.name;
		if (!linkName && !linkStore.status.machineId && !remoteStore.status.machineName) return;
		name = linkName || remoteStore.status.machineName;
		server = remoteStore.status.relayUrl ?? '';
		irohRelay = linkStore.status.relayUrl;
		hydrated = true;
	});

	// Il server può cambiare da fuori (abbinamento, adozione di un codice): si
	// segue il valore dello store, non il campo vuoto, altrimenti cancellare il
	// testo per riscriverlo verrebbe annullato a ogni battitura.
	let seenRelayUrl = $state(remoteStore.status.relayUrl);
	$effect(() => {
		const current = remoteStore.status.relayUrl;
		if (current && current !== seenRelayUrl) {
			seenRelayUrl = current;
			server = current;
		}
		seenRelayUrl = current;
	});

	async function perform(action: () => Promise<void>): Promise<void> {
		error = '';
		notice = '';
		try {
			await action();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		}
	}

	function saveName(): void {
		const next = name.trim();
		if (!next || next === (linkStore.status.name || remoteStore.status.machineName)) return;
		void perform(async () => {
			await devicesSetName(next);
			await linkStore.refresh();
			notice = m.devices_saved();
		});
	}

	function saveServer(): void {
		const next = server.trim();
		if (!next) return;
		void perform(async () => {
			const result = await devicesSetServer(next);
			// Il server restituisce l'indirizzo normalizzato: è quello che vale,
			// non il testo digitato (può avere o no lo schema).
			server = result.remoteRelay;
			// Il server che non dichiara il relay iroh lascia «Avanzate» da compilare.
			if (!result.irohRelay) advancedOpen = true;
			irohRelay = result.irohRelay ?? linkStore.status.relayUrl;
			notice = result.irohRelay ? m.devices_saved() : m.devices_server_no_iroh();
		});
	}

	function saveAdvanced(): void {
		void perform(async () => {
			await linkStore.configure({
				enabled: linkStore.status.enabled,
				name: name.trim() || linkStore.status.name,
				relayUrl: irohRelay.trim(),
				relayToken: removeToken ? '' : relayToken || undefined
			});
			relayToken = '';
			removeToken = false;
			notice = m.devices_saved();
		});
	}

	function toggleLink(enabled: boolean): void {
		void perform(async () => {
			await linkStore.configure({
				enabled,
				name: name.trim() || linkStore.status.name,
				relayUrl: irohRelay.trim() || linkStore.status.relayUrl
			});
		});
	}

	// Etichette di stato: le stesse parole dell'elenco, cosi' il relay si legge
	// uguale in testa e in fondo alla sezione.
	function relayLabel(): string {
		switch (remoteStore.status.connection) {
			case 'connected': return m.devices_relay_connected();
			case 'waiting': return m.devices_relay_waiting();
			case 'revoked': return m.devices_relay_revoked();
			case 'incompatible': return m.devices_relay_incompatible();
			case 'connecting': return m.devices_relay_connecting();
			case 'disabled': return m.devices_relay_disabled();
			default: return m.devices_relay_unpaired();
		}
	}

	function linkRelayLabel(): string {
		const reachable = linkStore.status.relayReachable;
		if (reachable === true) return m.devices_link_relay_ok();
		if (reachable === false) return m.devices_link_relay_down();
		return m.devices_link_relay_checking();
	}

	function toggleRemote(enabled: boolean): void {
		void perform(async () => {
			if (!(await remoteStore.setEnabled(enabled))) {
				error = remoteStore.actionError ?? m.devices_generic_error();
			}
		});
	}
</script>

<section class="this-computer" aria-labelledby="devices-this-title">
	<h5 id="devices-this-title">{m.devices_this_computer()}</h5>

	<div class="field-row">
		<label class="field-label" for="devices-name">{m.devices_name_label()}</label>
		<input
			id="devices-name"
			class="ui-input"
			bind:value={name}
			maxlength="128"
			onblur={saveName}
			placeholder="OMP Studio"
		/>
		<span class="field-hint">{m.devices_name_hint()}</span>
	</div>

	<div class="field-row">
		<label class="field-label" for="devices-server">{m.devices_server_label()}</label>
		<div class="inline">
			<input
				id="devices-server"
				class="ui-input"
				type="url"
				bind:value={server}
				placeholder="https://studio.example.com"
				spellcheck="false"
				onkeydown={(event) => { if (event.key === 'Enter') saveServer(); }}
			/>
			<button type="button" class="ui-button ui-button-secondary" onclick={saveServer} disabled={!server.trim()}>
				{m.devices_save()}
			</button>
		</div>
		<span class="field-hint">{m.devices_server_hint()}</span>
	</div>

	<div class="status-lines">
		<span class="status-line">
			<StatusMark
				status={
					remoteStore.status.connection === 'connected'
						? 'completed'
						: remoteStore.status.connection === 'revoked' || remoteStore.status.connection === 'incompatible'
							? 'failed'
							: remoteStore.status.connection === 'disabled' || remoteStore.status.connection === 'unpaired'
								? 'pending'
								: 'running'
				}
			/>
			<span>{m.devices_relay_status()}: {relayLabel()}</span>
		</span>
		{#if linkStore.status.enabled}
			<span class="status-line">
				<StatusMark
					status={linkStore.status.relayReachable === true ? 'completed' : linkStore.status.relayReachable === false ? 'failed' : 'running'}
				/>
				<span>{m.devices_link_relay_status()}: {linkRelayLabel()}</span>
			</span>
		{/if}
	</div>

	<button type="button" class="ui-button ui-button-ghost advanced-toggle" aria-expanded={advancedOpen} onclick={() => (advancedOpen = !advancedOpen)}>
		{m.devices_advanced()}
	</button>

	{#if advancedOpen}
		<div class="advanced">
			<p class="field-hint">{m.devices_advanced_hint()}</p>

			<div class="field-row">
				<label class="field-label" for="devices-remote-relay">{m.devices_remote_relay_label()}</label>
				<input
					id="devices-remote-relay"
					class="ui-input"
					type="url"
					bind:value={server}
					spellcheck="false"
					placeholder="https://studio.example.com"
				/>
			</div>

			<div class="field-row">
				<label class="field-label" for="devices-iroh-relay">{m.devices_iroh_relay_label()}</label>
				<input
					id="devices-iroh-relay"
					class="ui-input"
					type="url"
					bind:value={irohRelay}
					spellcheck="false"
					placeholder="https://iroh-relay.example.com/"
				/>
			</div>

			<div class="field-row">
				<label class="field-label" for="devices-relay-token">{m.devices_relay_token_label()}</label>
				<input
					id="devices-relay-token"
					class="ui-input"
					type="password"
					bind:value={relayToken}
					autocomplete="off"
					spellcheck="false"
					disabled={removeToken}
					placeholder={linkStore.status.hasRelayToken ? m.devices_token_keep() : ''}
				/>
				{#if linkStore.status.hasRelayToken}
					<label class="check"><input class="ui-checkbox" type="checkbox" bind:checked={removeToken} />{m.devices_token_remove()}</label>
				{/if}
			</div>

			<div class="switches">
				<Switch
					label={m.devices_remote_enabled()}
					checked={remoteStore.status.enabled}
					disabled={remoteStore.loading}
					onChange={toggleRemote}
				/>
				<Switch
					label={m.devices_link_enabled()}
					checked={linkStore.status.enabled}
					disabled={linkStore.busy}
					onChange={toggleLink}
				/>
			</div>

			<div class="inline">
				<button type="button" class="ui-button ui-button-primary" disabled={linkStore.busy} onclick={saveAdvanced}>{m.devices_save()}</button>
			</div>
		</div>
	{/if}

	{#if remoteStore.status.paired}
		<!-- «Dimentica abbinamento»: la zona pericolosa di Controllo remoto
		     (R-MI-52), ora dentro la testata del computer. -->
		<div class="danger-row">
			<button type="button" class="ui-button ui-button-danger" disabled={remoteStore.loading} onclick={() => (confirmingForget = true)}>
				{m.devices_forget_pairing()}
			</button>
		</div>
	{/if}

	{#if error}
		<p class="field-error" role="alert">{error}</p>
	{:else if notice}
		<p class="notice" role="status" aria-live="polite">{notice}</p>
	{/if}
</section>


<ConfirmDialog
	open={confirmingForget}
	title={m.devices_forget_title()}
	message={m.devices_forget_message()}
	confirmLabel={m.devices_forget_pairing()}
	tone="danger"
	confirmDisabled={remoteStore.loading}
	onCancel={() => (confirmingForget = false)}
	onConfirm={() => {
		confirmingForget = false;
		void perform(async () => {
			if (!(await remoteStore.unpair())) throw new Error(remoteStore.actionError ?? m.devices_generic_error());
		});
	}}
/>

<style>
	.this-computer {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	h5 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.field-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.field-hint {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.inline .ui-input {
		flex: 1;
		min-width: 0;
	}

	.status-lines {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.status-line {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.advanced-toggle {
		align-self: flex-start;
	}

	.advanced {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.switches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.danger-row {
		display: flex;
		justify-content: flex-start;
		padding-top: var(--space-2);
		border-top: 1px solid var(--line);
	}

	.field-error {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}

	.notice {
		margin: 0;
		min-height: 1.4em;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}
</style>
