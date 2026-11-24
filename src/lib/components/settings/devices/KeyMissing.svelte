<!--
  Chiave della macchina sparita dal portachiavi (R-MI-43).

  Studio non crea un'identità nuova da solo: le altre macchine non la
  riconoscerebbero. Tre uscite, tutte esplicite — riprova, crea una nuova
  identità (con conferma), lascia spento il collegamento.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';

	let error = $state('');
	let confirming = $state(false);
	let dismissed = $state(false);

	async function perform(action: () => Promise<void>): Promise<void> {
		error = '';
		try {
			await action();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		}
	}
</script>

{#if !dismissed}
	<section class="key-missing" role="alert" aria-labelledby="devices-key-title">
		<h5 id="devices-key-title">{m.devices_key_missing_title()}</h5>
		<p>{m.devices_key_missing_description()}</p>
		<div class="actions">
			<button type="button" class="ui-button ui-button-secondary" disabled={linkStore.busy} onclick={() => void perform(() => linkStore.refresh())}>
				{m.devices_key_retry()}
			</button>
			<button type="button" class="ui-button ui-button-secondary" disabled={linkStore.busy} onclick={() => (confirming = true)}>
				{m.devices_key_new_identity()}
			</button>
			<button type="button" class="ui-button ui-button-ghost" onclick={() => (dismissed = true)}>
				{m.devices_key_leave_off()}
			</button>
		</div>
		{#if error}<p class="field-error" role="alert">{error}</p>{/if}
	</section>
{/if}

<ConfirmDialog
	open={confirming}
	title={m.devices_key_new_identity_title()}
	message={m.devices_key_new_identity_description()}
	confirmLabel={m.devices_key_new_identity()}
	tone="danger"
	confirmDisabled={linkStore.busy}
	onCancel={() => (confirming = false)}
	onConfirm={() => {
		confirming = false;
		void perform(() => linkStore.resetIdentity());
	}}
/>

<style>
	.key-missing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--warn);
		border-radius: var(--radius-md);
	}

	h5 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	p {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.field-error {
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}
</style>
