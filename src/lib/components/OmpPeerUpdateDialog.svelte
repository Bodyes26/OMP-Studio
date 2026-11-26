<!--
  Domanda di allineamento di omp fra le macchine abbinate (R-MI-68): compare
  sulla macchina da cui si guarda, verso la versione piu' nuova. Resta in coda
  mentre e' aperta un'altra conferma di aggiornamento (`paused`).
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import { ompPeerUpdate } from '#lib/backend/ompPeerUpdate.svelte.ts';

	let { paused = false }: { paused?: boolean } = $props();

	$effect(() => { ompPeerUpdate.start(); });

	const proposal = $derived(ompPeerUpdate.proposal);
	const args = $derived(proposal ? { name: proposal.machine.name, version: proposal.peerVersion, own: proposal.own } : null);
</script>

<ConfirmDialog
	open={proposal !== null && !paused}
	title={proposal?.where === 'here' ? m.omp_peer_update_here_title() : args ? m.omp_peer_update_title(args) : ''}
	message={!args ? '' : proposal?.where === 'here' ? m.omp_peer_update_here_message(args) : m.omp_peer_update_message(args)}
	confirmLabel={m.peer_update_confirm()}
	cancelLabel={m.omp_peer_update_later()}
	onConfirm={() => void ompPeerUpdate.confirm()}
	onCancel={() => ompPeerUpdate.dismiss()}
/>
