<!--
  «Aggiorna Studio su M» (R-MI-38, R-MI-64): l'altra macchina ha una versione
  diversa. L'avviso compare solo quando la base e' incompatibile (D5): due
  Nightly della stessa base sono un aggiornamento in corso o in attesa, e lo
  dicono con lo stato, non con «diverso da qui». Usato nelle Impostazioni e nel
  pannello del progetto.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { needsUpdate, peerBehind, peerUpdate, type WaitReason } from '#lib/backend/peerUpdate.svelte.ts';
	import { studioUpdaterStore, formatVersion } from '#lib/stores/studioUpdater.svelte.ts';

	let { machineId, compact = false, targetVersion }: { machineId: string; compact?: boolean; targetVersion?: string } = $props();

	const machine = $derived(linkStore.machineFor(machineId));
	const status = $derived(peerUpdate.statusFor(machineId));
	const own = $derived(studioUpdaterStore.currentVersion);
	const incompatible = $derived(machine ? needsUpdate(machine, own) : false);
	const behind = $derived(machine ? peerBehind(machine, own) : false);

	const reasonLabel: Record<WaitReason, () => string> = {
		agents: () => m.peer_update_reason_agents(),
		questions: () => m.peer_update_reason_questions(),
		jobs: () => m.peer_update_reason_jobs(),
		unsaved: () => m.peer_update_reason_unsaved()
	};

	const text = $derived.by(() => {
		if (!machine) return '';
		const name = machine.name;
		switch (status?.phase) {
			case 'starting':
			case 'downloading': return m.peer_update_downloading({ name });
			case 'waiting': return m.peer_update_waiting({ name, reasons: status.waitingFor.map((reason) => reasonLabel[reason]()).join(', ') });
			case 'installing': return m.peer_update_installing({ name });
			case 'failed': return m.peer_update_failed({ name, error: status.error ?? '' });
		}
		// Solo una base incompatibile e' un avviso (D5).
		return incompatible ? m.peer_update_needed({ name, version: formatVersion(machine.version, { prefix: true }) || machine.version || '' }) : '';
	});
	const targetAvailable = $derived(Boolean(machine?.online && targetVersion && machine.version !== targetVersion));
	const canStart = $derived((incompatible || behind || targetAvailable) && (!status || status.phase === 'failed'));
</script>

{#if text || canStart}
	<div class="peer-update" class:compact role="status">
		{#if text}<span>{text}</span>{/if}
		{#if canStart && machine}
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void peerUpdate.request(machineId, targetVersion)}>{m.peer_update_button({ name: machine.name })}</button>
		{/if}
	</div>
	{#if peerUpdate.error && canStart}<p class="peer-update-error" role="alert">{peerUpdate.error}</p>{/if}
{/if}

<style>
	.peer-update { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--warn); }
	.peer-update.compact { font-size: 11px; }
	.peer-update-error { margin: 0; font-size: 12px; color: var(--danger); overflow-wrap: anywhere; }
</style>
