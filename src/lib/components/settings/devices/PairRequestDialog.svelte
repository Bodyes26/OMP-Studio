<!--
  Richiesta di abbinamento in arrivo (R-MI-54).

  L'altra macchina ha scelto questa dall'elenco della rete locale: qui compaiono
  le stesse 6 cifre del suo schermo, da confrontare a voce. Senza «Accetta»
  l'abbinamento non si completa; rifiutando non resta nulla. Il dialogo si apre
  da sé sulla prima richiesta in coda e non blocca le altre superfici.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import Dialog from '#lib/ui/Dialog.svelte';

	// Sola andata in coda: `answerPairRequest` toglie la richiesta dall'elenco,
	// quindi la vista non deve tenere un secondo stato da sincronizzare.
	const incoming = $derived(linkStore.pairRequests.find((request) => request.direction === 'incoming') ?? null);

	let error = $state('');

	async function answer(accept: boolean): Promise<void> {
		const request = incoming;
		if (!request) return;
		error = '';
		try {
			await linkStore.answerPairRequest(request.requestId, accept);
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		}
	}
</script>

<Dialog
	open={incoming !== null}
	title={m.devices_request_title()}
	onClose={() => void answer(false)}
	initialFocus=".pair-request-accept"
>
	{#snippet body()}
		<div class="request">
			<p>{m.devices_request_body({ name: incoming?.name ?? '' })}</p>
			<p class="sas" aria-label={m.devices_request_sas_aria()}>{incoming?.sas}</p>
			<p class="hint">{m.devices_request_hint()}</p>
			{#if error}<p class="field-error" role="alert">{error}</p>{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<button type="button" class="ui-button ui-button-ghost" onclick={() => void answer(false)}>{m.devices_request_decline()}</button>
		<button type="button" class="ui-button ui-button-primary pair-request-accept" onclick={() => void answer(true)}>
			{m.devices_request_accept()}
		</button>
	{/snippet}
</Dialog>

<style>
	.request {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	p {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.sas {
		font-family: var(--font-mono);
		font-size: 32px;
		letter-spacing: 0.16em;
		color: var(--ink);
		text-align: center;
		padding: var(--space-3) 0;
	}

	.hint {
		font-size: var(--text-caption);
	}

	.field-error {
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}
</style>
