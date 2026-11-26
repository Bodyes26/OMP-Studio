<!--
  omp sull'altra macchina (R-MI-67, R-MI-69): versione, stato dell'aggiornamento
  chiesto da qui e «Aggiorna omp su M» quando e' indietro.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { ompPeerUpdate } from '#lib/backend/ompPeerUpdate.svelte.ts';
	import { ompAlignment, type WaitReason } from '#lib/backend/peerUpdateRules.ts';
	import { ompVersionStore } from '#lib/stores/ompVersion.svelte.ts';

	let { machineId }: { machineId: string } = $props();

	const machine = $derived(linkStore.machineFor(machineId));
	const status = $derived(ompPeerUpdate.statusFor(machineId));
	const peerVersion = $derived(ompPeerUpdate.peerVersions[machineId] ?? null);
	const behind = $derived(ompAlignment(peerVersion, ompVersionStore.current) === 'peer');

	const reasonLabel: Record<WaitReason, () => string> = {
		agents: () => m.peer_update_reason_agents(),
		questions: () => m.peer_update_reason_questions(),
		jobs: () => m.peer_update_reason_jobs(),
		unsaved: () => m.peer_update_reason_unsaved()
	};

	const text = $derived.by(() => {
		if (!machine?.online || !peerVersion) return '';
		const name = machine.name;
		switch (status?.phase) {
			case 'starting':
			case 'updating': return m.omp_peer_update_updating({ name });
			case 'waiting': return m.omp_peer_update_waiting({ name, reasons: status.waitingFor.map((reason) => reasonLabel[reason]()).join(', ') });
			case 'restarting': return m.omp_peer_update_restarting({ name });
			case 'failed': return m.omp_peer_update_failed({ name, error: status.error ?? '' });
		}
		return m.omp_peer_update_version({ version: peerVersion });
	});
	const canStart = $derived(behind && (!status || status.phase === 'failed'));
</script>

{#if text}
	<div class="omp-peer-update" class:behind={canStart} role="status">
		<span>{text}</span>
		{#if canStart && machine}
			<button type="button" class="ui-button ui-button-secondary" onclick={() => ompPeerUpdate.request(machineId)}>{m.omp_peer_update_button({ name: machine.name })}</button>
		{/if}
	</div>
{/if}

<style>
	.omp-peer-update { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--ink-muted); }
	.omp-peer-update.behind { color: var(--warn); }
</style>
