<!--
  Domanda della build Nightly distribuita (R-MI-37): l'altra macchina non è
  disponibile per la build all'avvio. Arriva da `npm run nightly` attraverso il bridge
  (`/v1/macchine/chiedi`) e la risposta torna allo script. Esc annulla la
  pubblicazione: nessuna delle tre scelte di pubblicazione parte da sola.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { invoke, isTauri, listen, LOCAL_MACHINE, routeErrorText } from '#lib/backend/ipc.ts';

	interface Ask {
		requestId: string;
		body: { macchina?: string; piattaforma?: string; locale?: string; motivo?: string };
	}

	let queue = $state<Ask[]>([]);
	/** Risposta non recapitata: la domanda resta in coda e lo dice (S3-link-front-31). */
	let error = $state<string | null>(null);
	let answering = $state(false);
	const current = $derived(queue[0] ?? null);

	$effect(() => {
		if (!isTauri()) return;
		const pending = listen<Ask>('link:exec-ask', (event) => { queue = [...queue, event.payload]; });
		return () => { void pending.then((unlisten) => unlisten()); };
	});

	function platformName(key: string | undefined): string {
		switch (key) {
			case 'windows': return 'Windows';
			case 'macos': return 'macOS';
			case 'linux': return 'Linux';
			default: return key ?? '';
		}
	}

	/**
	 * Toglie la domanda solo dopo l'esito (S3-link-front-31): prima spariva
	 * prima dell'invio e l'errore era ignorato, quindi una risposta persa
	 * lasciava lo script della Nightly in attesa senza che nessuno lo sapesse.
	 */
	async function answer(scelta: 'attendi' | 'cloud' | 'locale' | 'annulla'): Promise<void> {
		const ask = current;
		if (!ask || answering) return;
		answering = true;
		error = null;
		try {
			await invoke('lane_bridge_respond', { requestId: ask.requestId, response: { scelta } }, { machine: LOCAL_MACHINE });
			queue = queue.slice(1);
		} catch (reason) {
			error = routeErrorText(reason);
		} finally {
			answering = false;
		}
	}
</script>

{#if current}
	{@const other = platformName(current.body.piattaforma)}
	<Dialog open title={m.remote_build_ask_title({ platform: other })} onClose={() => void answer('annulla')} initialFocus="button.remote-build-wait">
		{#snippet body()}
			{#if current.body.macchina && current.body.motivo}
				<p>{m.remote_build_ask_not_ready({ name: current.body.macchina, platform: other, reason: current.body.motivo })}</p>
			{:else if current.body.macchina}
				<p>{m.remote_build_ask_named({ name: current.body.macchina, platform: other })}</p>
			{:else}
				<p>{m.remote_build_ask_unnamed({ platform: other })}</p>
			{/if}
			{#if error}<p role="alert">{m.remote_build_ask_failed({ error })}</p>{/if}
		{/snippet}
		{#snippet footer()}
			<button type="button" class="ui-button ui-button-ghost" onclick={() => void answer('annulla')}>{m.remote_build_ask_abort()}</button>
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void answer('locale')}>{m.remote_build_ask_local({ platform: platformName(current.body.locale) })}</button>
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void answer('cloud')}>{m.remote_build_ask_cloud({ platform: other })}</button>
			<button type="button" class="ui-button ui-button-primary remote-build-wait" onclick={() => void answer('attendi')}>{m.remote_build_ask_wait()}</button>
		{/snippet}
	</Dialog>
{/if}
