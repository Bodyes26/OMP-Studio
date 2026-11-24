<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
	import { IconMonitor, IconNetwork, IconPhone } from '#lib/icons.ts';
	import type { DeviceTarget } from '#lib/stores/settings.svelte.ts';
	import { machineFeedback } from '#lib/stores/machineFeedback.svelte.ts';

	let { onOpen }: { onOpen: (target: DeviceTarget) => void } = $props();

	const working = $derived.by(() => {
		const ids = new Set<string>();
		for (const session of sessionRegistry.getAllSessions()) {
			if (session.machineId && (session.isStreaming || session.agentState === 'working')) ids.add(session.machineId);
		}
		for (const lane of linkStore.activity.lanes) {
			if (!lane.working || !lane.peerIds) continue;
			for (const id of lane.peerIds) ids.add(id);
		}
		for (const peer of linkStore.status.peers) {
			if (machineFeedback.activeFor(peer.id).length > 0) ids.add(peer.id);
		}
		return ids;
	});
	const home = $derived(linkStore.status.name || remoteStore.status.machineName || m.devices_this_computer());
	const gateway = $derived(remoteStore.status.connection);
	const relay = $derived(linkStore.status.relayReachable);
	const peers = $derived(linkStore.status.peers);
	const phones = $derived(remoteStore.status.clients);
</script>

<section class="connection-map" aria-label={m.devices_connection_map()}>
	<p>{m.devices_connection_map_hint()}</p>
	<div class="map">
		<div class="node local"><IconMonitor /><span><strong>{home}</strong><small>{m.devices_this_computer()}</small></span></div>
		<div class="branches">
			{#each peers as peer (peer.id)}
				{@const active = peer.online && peer.compatible && working.has(peer.id)}
				<div class="branch" class:active class:down={!peer.online}>
					{#if peer.online && peer.route === 'relay'}
						<div class="node bridge"><IconNetwork /><span><strong>{m.devices_iroh_relay_label()}</strong><small>{m.devices_via_relay()}</small></span></div>
					{:else}
						<span class="bridge label">{peer.online && peer.route === 'direct' ? m.devices_direct() : m.devices_map_route_unknown()}</span>
					{/if}
					<button type="button" class="node" onclick={() => onOpen({ kind: 'computer', id: peer.id })}>
						<IconMonitor /><span><strong>{peer.name}</strong><small>{!peer.online ? m.devices_map_unreachable() : !peer.compatible ? m.devices_incompatible() : active ? m.devices_map_working() : m.devices_map_idle()}</small></span>
					</button>
				</div>
			{/each}
			{#if linkStore.status.relayUrl && !peers.some((peer) => peer.online && peer.route === 'relay')}
				<div class="branch" class:down={relay !== true}>
					<div class="node bridge"><IconNetwork /><span><strong>{m.devices_iroh_relay_label()}</strong><small>{relay === true ? m.devices_link_relay_ok() : relay === false ? m.devices_link_relay_down() : m.devices_map_unknown()}</small></span></div>
				</div>
			{/if}
			{#if remoteStore.status.relayUrl}
				<div class="branch" class:down={gateway !== 'connected'}>
					<div class="node bridge"><IconNetwork /><span><strong>{m.devices_remote_relay_label()}</strong><small>{gateway === 'connected' ? m.devices_relay_connected() : gateway === 'connecting' ? m.devices_relay_connecting() : m.devices_relay_not_connected()}</small></span></div>
					{#if gateway === 'connected' && phones.length > 0}
						<div class="terminals">
							{#each phones as phone (phone.id)}
								<button type="button" class="node" onclick={() => onOpen({ kind: 'phone', id: phone.id })}>
									<IconPhone /><span><strong>{phone.name}</strong><small>{m.devices_map_pwa()}</small></span>
								</button>
							{/each}
						</div>
					{:else}
						<span class="node"><IconPhone /><span><strong>{m.devices_map_pwa()}</strong><small>{gateway === 'connected' ? m.devices_map_no_phones() : m.devices_map_unknown()}</small></span></span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.connection-map { display: grid; gap: var(--space-3); }
	p { margin: 0; color: var(--ink-muted); }
	.map {
		display: grid;
		grid-template-columns: minmax(112px, 1fr) minmax(0, 3fr);
		align-items: start;
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		container-type: inline-size;
	}
	.node {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: 48px;
		padding: var(--space-2);
		text-align: left;
		color: var(--ink);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		font: inherit;
		--icon-size: 15px;
	}
	button.node { width: 100%; cursor: pointer; }
	button.node:hover { border-color: var(--ink-faint); }
	.node > span { min-width: 0; overflow-wrap: anywhere; }
	.node :global(svg) { flex: none; }
	strong, small { display: block; }
	small, .label { color: var(--ink-muted); font-size: var(--text-caption); }
	.branches { display: grid; gap: var(--space-2); padding-left: var(--space-3); }
	.branch {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: start;
		gap: var(--space-3);
		--edge: var(--ink-faint);
		--edge-style: solid;
	}
	.branch.active { --edge: var(--brand-ink); }
	.branch.down { --edge-style: dashed; }
	.branch::before {
		content: '';
		position: absolute;
		inset: 24px 0 auto calc(-1 * var(--space-3));
		border-top: 1px var(--edge-style) var(--edge);
	}
	.branch.active::before { border-top-width: 2px; }
	.branch + .branch::after {
		content: '';
		position: absolute;
		top: calc(-24px - var(--space-2));
		bottom: calc(100% - 24px);
		left: calc(-1 * var(--space-3));
		border-left: 1px solid var(--ink-faint);
	}
	.label { z-index: 1; justify-self: center; margin-top: 15px; padding: 2px 5px; background: var(--bg-sunken); }
	.terminals { display: grid; gap: var(--space-1); }
	@container (max-width: 440px) {
		.branches { padding-left: var(--space-2); }
		.branch { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); }
		.branch::before, .branch + .branch::after { left: calc(-1 * var(--space-2)); }
		.label { margin-top: 0; justify-self: start; }
	}
</style>
