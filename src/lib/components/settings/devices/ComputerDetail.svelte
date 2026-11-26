<!--
  Dettaglio di un computer abbinato (R-MI-52).

  Tutto quello che prima stava sparso nella sezione «Altre istanze»: stato e
  via, gli ambiti di permesso, l'aggiornamento di Studio (R-MI-38), i job
  (R-MI-36), la sincronizzazione di omp (R-MI-42), il registro attività
  (R-MI-39) e la revoca. Le sezioni si aprono in sequenza, non tutte insieme:
  una riga di stato si legge, i pannelli pesanti si chiedono.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore, type LinkedMachine, type MachinePermissions } from '#lib/backend/link.svelte.ts';
	import Switch from '#lib/ui/Switch.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import PeerUpdateNotice from '#lib/components/PeerUpdateNotice.svelte';
	import OmpPeerUpdateNotice from '#lib/components/OmpPeerUpdateNotice.svelte';
	import MachineJobs from './MachineJobs.svelte';
	import MachineActivity from './MachineActivity.svelte';
	import OmpSyncSettings from './OmpSyncSettings.svelte';

	let { peer, onRevoked }: { peer: LinkedMachine; onRevoked: () => void } = $props();

	let revoking = $state(false);
	let activityOpen = $state(false);
	let error = $state('');

	const deviceState = $derived.by(() => {
		if (!peer.online) {
			const why = linkStore.offlineReason(peer.id);
			return {
				mark: why === 'relay' ? ('failed' as const) : ('pending' as const),
				text: why === 'relay' ? m.devices_relay_unreachable() : m.devices_offline()
			};
		}
		if (!peer.compatible) return { mark: 'attention' as const, text: m.devices_incompatible() };
		return { mark: 'completed' as const, text: m.devices_online() };
	});

	function permission(key: keyof MachinePermissions, value: boolean): void {
		error = '';
		void linkStore
			.permissions(peer.id, { ...peer.permissions, [key]: value })
			.catch((reason: unknown) => { error = reason instanceof Error ? reason.message : String(reason); });
	}

	function revoke(everywhere: boolean): void {
		error = '';
		linkStore
			.revoke(peer.id, everywhere)
			.then(() => {
				revoking = false;
				onRevoked();
			})
			.catch((reason: unknown) => { error = reason instanceof Error ? reason.message : String(reason); });
	}
</script>

<div class="device-detail">
	<div class="detail-head">
		<h5>{peer.name}</h5>
		<div class="head-actions">
			<!-- La finestra con la PWA del relay: prima era «Altre macchine» in
			     Controllo remoto (R-MI-52, tabella di cutover). -->
			<button type="button" class="ui-button ui-button-secondary" onclick={() => void remoteStore.openMachinesWindow()}>
				{m.devices_open_machines()}
			</button>
			<button type="button" class="ui-button ui-button-danger" disabled={linkStore.busy} onclick={() => (revoking = true)}>
				{m.devices_revoke()}
			</button>
		</div>
	</div>

	<div class="status-lines">
		<span class="status-line">
			<StatusMark status={deviceState.mark} />
			<span>{deviceState.text}</span>
		</span>
		{#if peer.online && peer.route}
			<span class="status-line">
				<span class="fact">{m.devices_route()}</span>
				<span>{peer.route === 'direct' ? m.devices_direct() : m.devices_via_relay()}</span>
				{#if peer.latencyMs !== null}
					<span class="fact">{Math.round(peer.latencyMs)} ms</span>
				{/if}
			</span>
		{/if}
		{#if peer.version}
			<span class="status-line">
				<span class="fact">{m.devices_version()}</span>
				<span>{peer.version}</span>
			</span>
		{/if}
		{#if !peer.online && peer.lastSeen !== null}
			<span class="status-line">
				<span class="fact">{m.devices_last_seen({ time: new Date(peer.lastSeen).toLocaleString() })}</span>
			</span>
		{/if}
	</div>

	<fieldset class="permissions" disabled={linkStore.busy}>
		<legend>{m.devices_access_to_this_machine()}</legend>
		<div class="permission-grid">
			<Switch label={m.devices_perm_read()} checked disabled />
			<Switch label={m.devices_perm_agents()} checked={peer.permissions.agents} onChange={(value) => permission('agents', value)} />
			<Switch label={m.devices_perm_files()} checked={peer.permissions.files} onChange={(value) => permission('files', value)} />
			<Switch label={m.devices_perm_terminal()} checked={peer.permissions.terminal} onChange={(value) => permission('terminal', value)} />
		</div>
	</fieldset>

	<PeerUpdateNotice machineId={peer.id} />
	<OmpPeerUpdateNotice machineId={peer.id} />
	<MachineJobs {peer} />
	<OmpSyncSettings {peer} />

	<button type="button" class="ui-button ui-button-ghost activity-toggle" aria-expanded={activityOpen} onclick={() => (activityOpen = !activityOpen)}>
		{m.devices_activity()}
	</button>
	{#if activityOpen}
		<MachineActivity {peer} />
	{/if}

	{#if error}<p class="field-error" role="alert">{error}</p>{/if}
</div>

<ConfirmDialog
	open={revoking}
	title={m.devices_revoke_title()}
	message={m.devices_revoke_message()}
	confirmLabel={m.devices_revoke_here()}
	secondaryLabel={m.devices_revoke_everywhere()}
	tone="danger"
	confirmDisabled={linkStore.busy}
	onCancel={() => (revoking = false)}
	onConfirm={() => revoke(false)}
	onSecondary={() => revoke(true)}
/>

<style>
	.device-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.head-actions {
		display: flex;
		gap: var(--space-2);
	}

	.detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
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
		font-variant-numeric: tabular-nums;
	}

	.fact {
		color: var(--ink-faint);
	}

	.permissions {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.permissions legend {
		padding: 0;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.permission-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.activity-toggle {
		align-self: flex-start;
	}

	.field-error {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}
</style>
