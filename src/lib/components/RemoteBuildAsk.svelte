<!--
  Domanda della build Nightly distribuita (R-MI-37): l'altra macchina non e'
  raggiungibile all'avvio. Arriva da `npm run nightly` attraverso il bridge
  (`/v1/macchine/chiedi`) e la risposta torna allo script. Esc annulla la
  pubblicazione: nessuna delle tre scelte di pubblicazione parte da sola.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { invoke, isTauri, listen, LOCAL_MACHINE } from '#lib/backend/ipc.ts';

	interface Ask {
		requestId: string;
		body: { macchina?: string; piattaforma?: string; locale?: string };
	}

	let queue = $state<Ask[]>([]);
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

	async function answer(scelta: 'attendi' | 'cloud' | 'locale' | 'annulla'): Promise<void> {
		const ask = current;
		if (!ask) return;
		queue = queue.slice(1);
		await invoke('lane_bridge_respond', { requestId: ask.requestId, response: { scelta } }, { machine: LOCAL_MACHINE }).catch(() => {});
	}
</script>

{#if current}
	{@const other = platformName(current.body.piattaforma)}
	<Dialog open title={m.remote_build_ask_title({ platform: other })} onClose={() => void answer('annulla')} initialFocus="button.remote-build-wait">
		{#snippet body()}
			<p>{current.body.macchina ? m.remote_build_ask_named({ name: current.body.macchina, platform: other }) : m.remote_build_ask_unnamed({ platform: other })}</p>
		{/snippet}
		{#snippet footer()}
			<button type="button" class="ui-button ui-button-ghost" onclick={() => void answer('annulla')}>{m.remote_build_ask_abort()}</button>
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void answer('locale')}>{m.remote_build_ask_local({ platform: platformName(current.body.locale) })}</button>
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void answer('cloud')}>{m.remote_build_ask_cloud({ platform: other })}</button>
			<button type="button" class="ui-button ui-button-primary remote-build-wait" onclick={() => void answer('attendi')}>{m.remote_build_ask_wait()}</button>
		{/snippet}
	</Dialog>
{/if}
