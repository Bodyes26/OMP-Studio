<!--
  Dettaglio di un telefono (R-MI-52): stato e disconnessione.

  I telefoni si collegano al relay, non direttamente a questa macchina: quello
  che Studio sa è se il relay è raggiungibile e se il dispositivo è in linea.
  «Disconnetti» passa dall'host abbinato al relay (`remote_revoke_device`), che
  revoca solo i telefoni legati a questo computer.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import type { DeviceInfo } from '$remote-protocol';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';

	let { client, name }: { client: DeviceInfo | null; name: string } = $props();

	const relayConnected = $derived(remoteStore.status.connection === 'connected');
	const present = $derived(client !== null);

	let confirming = $state(false);
	let error = $state('');

	async function disconnect(): Promise<void> {
		const device = client;
		if (!device) {
			confirming = false;
			return;
		}
		error = '';
		const ok = await remoteStore.revokeDevice(device.id);
		confirming = false;
		// Lo store rilegge lo stato: se il telefono è sparito dai client la vista
		// resta su questa riga (con «non in linea»), non su un dettaglio vuoto.
		if (!ok) error = remoteStore.actionError ?? m.devices_generic_error();
	}
</script>

<div class="device-detail">
	<h5>{name || m.devices_phone()}</h5>

	<div class="status-lines">
		<span class="status-line">
			<StatusMark status={present && relayConnected ? 'completed' : 'pending'} />
			<span>{present && relayConnected ? m.devices_online() : m.devices_offline()}</span>
		</span>
		<span class="status-line">
			<span class="fact">{m.devices_relay_status()}</span>
			<span>{relayConnected ? m.devices_relay_connected() : m.devices_relay_not_connected()}</span>
		</span>
		{#if remoteStore.status.relayUrl}
			<span class="status-line">
				<span class="fact">{m.devices_server_label()}</span>
				<span class="mono">{remoteStore.status.relayUrl}</span>
			</span>
		{/if}
	</div>

	<div class="actions">
		{#if present}
			<button type="button" class="ui-button ui-button-danger" onclick={() => (confirming = true)}>
				{m.devices_disconnect()}
			</button>
		{/if}
		<button type="button" class="ui-button ui-button-secondary" onclick={() => void remoteStore.openMachinesWindow()}>
			{m.devices_open_machines()}
		</button>
	</div>

	{#if error}
		<p class="field-error" role="alert">{error}</p>
	{:else if !present}
		<p class="hint">{m.devices_phone_gone()}</p>
	{/if}
</div>

<ConfirmDialog
	open={confirming}
	title={m.devices_disconnect_title()}
	message={m.devices_disconnect_message({ name: name || m.devices_phone() })}
	confirmLabel={m.devices_disconnect()}
	tone="danger"
	onCancel={() => (confirming = false)}
	onConfirm={() => void disconnect()}
/>

<style>
	.device-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h5 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
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

	.fact {
		color: var(--ink-faint);
	}

	.mono {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.hint {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.field-error {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}
</style>
