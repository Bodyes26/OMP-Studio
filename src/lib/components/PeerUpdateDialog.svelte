<!--
  Conferme dell'aggiornamento di un'altra macchina (R-MI-38): la versione
  viene detta prima di partire, anche quando non e' quella di questa macchina
  (l'ultima del canale), e «Aggiorna entrambe» a fine Nightly distribuita.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import { peerUpdate } from '#lib/backend/peerUpdate.svelte.ts';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { formatVersion } from '#lib/stores/studioUpdater.svelte.ts';

	$effect(() => { peerUpdate.start(); });

	const proposal = $derived(peerUpdate.proposal);
	const both = $derived(peerUpdate.bothProposal);
	const version = (value: string | null | undefined) => formatVersion(value, { prefix: true }) || value || '';

	function message(): string {
		if (!proposal) return '';
		const { machine, own, info } = proposal;
		if (!info.has_update || !info.asset) return m.peer_update_nothing({ name: machine.name, version: version(info.current_version) });
		if (info.latest_version === own) return m.peer_update_same({ name: machine.name, version: version(own) });
		return m.peer_update_other({ name: machine.name, version: version(info.latest_version), own: version(own) });
	}
	const bothNames = $derived(both ? both.machineIds.map((id) => linkStore.machineFor(id)?.name ?? id).join(', ') : '');
</script>

<ConfirmDialog
	open={proposal !== null}
	title={proposal ? m.peer_update_title({ name: proposal.machine.name }) : ''}
	message={message()}
	confirmLabel={m.peer_update_confirm()}
	confirmDisabled={!proposal?.info.has_update || !proposal?.info.asset}
	onConfirm={() => void peerUpdate.confirm()}
	onCancel={() => { peerUpdate.proposal = null; }}
/>

<ConfirmDialog
	open={both !== null && proposal === null}
	title={m.peer_update_both_title()}
	message={both ? m.peer_update_both_message({ version: version(both.version), names: bothNames }) : ''}
	confirmLabel={m.peer_update_both_confirm()}
	onConfirm={() => void peerUpdate.updateBoth()}
	onCancel={() => { peerUpdate.bothProposal = null; }}
/>
