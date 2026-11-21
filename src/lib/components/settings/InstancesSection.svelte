<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore, type LinkedMachine, type MachinePermissions } from '#lib/backend/link.svelte.ts';
	import Switch from '#lib/ui/Switch.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import MachineActivity from './MachineActivity.svelte';
	import MachineJobs from './MachineJobs.svelte';
	import PeerUpdateNotice from '#lib/components/PeerUpdateNotice.svelte';
	import OmpSyncSettings from './OmpSyncSettings.svelte';
	import { i18n } from '#lib/i18n/i18n.svelte.ts';

	let enabled = $state(false);
	let machineName = $state('');
	let relayUrl = $state('');
	let relayToken = $state('');
	let removeToken = $state(false);
	let hydrated = $state(false);
	let pairingCode = $state('');
	let otherCode = $state('');
	let notice = $state('');
	let error = $state('');
	let revoking = $state<LinkedMachine | null>(null);
	let now = $state(Date.now());
	// Registro delle azioni remote (R-MI-39): caricato solo quando lo si apre.
	let activityOpen = $state<Record<string, boolean>>({});
	const replacement = $derived(linkStore.replacements[0] ?? null);
	const staleAfter = 30 * 24 * 60 * 60 * 1000;

	$effect(() => {
		const timer = window.setInterval(() => { now = Date.now(); }, 60_000);
		return () => window.clearInterval(timer);
	});

	function lastSeen(timestamp: number | null): string {
		if (timestamp === null) return m.instances_edge_seen_unknown();
		const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
		const units: [number, Intl.RelativeTimeFormatUnit][] = [
			[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']
		];
		const [size, unit] = units.find(([size]) => seconds >= size) ?? units[units.length - 1];
		return m.instances_edge_last_seen({ time: i18n.formatRelativeTime(-Math.floor(seconds / size), unit) });
	}

	function revoke(everywhere: boolean): void {
		const peer = revoking;
		if (peer) void perform(async () => {
			await linkStore.revoke(peer.id, everywhere);
			revoking = null;
		});
	}

	$effect(() => {
		if (!hydrated && linkStore.status.machineId) {
			enabled = linkStore.status.enabled;
			machineName = linkStore.status.name;
			relayUrl = linkStore.status.relayUrl;
			hydrated = true;
		}
	});
	$effect(() => {
		if (!pairingCode) return;
		const timeout = window.setTimeout(() => { pairingCode = ''; }, 300_000);
		return () => window.clearTimeout(timeout);
	});

	async function perform(action: () => Promise<unknown>): Promise<void> {
		error = '';
		notice = '';
		try { await action(); }
		catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
	}

	function save(event: SubmitEvent): void {
		event.preventDefault();
		void perform(async () => {
			await linkStore.configure({ enabled, name: machineName, relayUrl,
				relayToken: removeToken ? '' : relayToken || undefined });
			relayToken = '';
			removeToken = false;
			pairingCode = '';
			notice = m.instances_saved();
		});
	}

	function permission(peer: LinkedMachine, key: keyof MachinePermissions, value: boolean): void {
		void perform(() => linkStore.permissions(peer.id, { ...peer.permissions, [key]: value }));
	}

	// Chiave sparita dal portachiavi (R-MI-43): tre uscite, nessuna automatica.
	let keyWarningDismissed = $state(false);
	let confirmingReset = $state(false);
</script>

<div class="settings-section instances-section">
	<header class="section-header">
		<h4>{m.instances_title()}</h4>
		<p>{m.instances_description()}</p>
	</header>

	{#if linkStore.status.keyMissing && !keyWarningDismissed}
		<section class="key-missing" role="alert" aria-labelledby="instances-key-title">
			<h4 id="instances-key-title">{m.instances_key_missing_title()}</h4>
			<p>{m.instances_key_missing_description()}</p>
			<div class="actions">
				<button type="button" class="ui-button ui-button-secondary" disabled={linkStore.busy} onclick={() => void perform(() => linkStore.refresh())}>{m.instances_key_retry()}</button>
				<button type="button" class="ui-button ui-button-secondary" disabled={linkStore.busy} onclick={() => { confirmingReset = true; }}>{m.instances_key_new_identity()}</button>
				<button type="button" class="ui-button ui-button-ghost" onclick={() => { keyWarningDismissed = true; }}>{m.instances_key_leave_off()}</button>
			</div>
		</section>
	{/if}

	<form class="configuration" onsubmit={save}>
		<Switch id="instances-enabled" label={m.instances_enable()} bind:checked={enabled} disabled={linkStore.busy || linkStore.loading} />
		<div class="status-line">
			<StatusMark status={linkStore.status.enabled ? 'completed' : 'pending'} />
			<span>{linkStore.status.enabled ? m.instances_enabled() : m.instances_disabled()}</span>
		</div>
		{#if linkStore.status.enabled}
			<div class="status-line" role="status">
				<StatusMark status={linkStore.status.relayReachable === true ? 'completed' : linkStore.status.relayReachable === false ? 'failed' : 'pending'} />
				<span>{linkStore.status.relayReachable === true ? m.instances_edge_relay_ok() : linkStore.status.relayReachable === false ? m.instances_edge_relay_down() : m.instances_edge_relay_checking()}</span>
			</div>
		{/if}
		<label for="instances-name">{m.instances_machine_name()}</label>
		<input id="instances-name" name="machineName" class="ui-input" bind:value={machineName} required maxlength="128" disabled={linkStore.busy} />
		<label for="instances-relay">{m.instances_relay_url()}</label>
		<input id="instances-relay" name="relayUrl" class="ui-input" type="url" bind:value={relayUrl} placeholder="https://iroh-relay.example.com/" required={enabled} disabled={linkStore.busy} />
		<label for="instances-token">{m.instances_relay_token()}</label>
		<input id="instances-token" name="relayToken" class="ui-input" type="password" bind:value={relayToken} autocomplete="off" spellcheck="false" placeholder={linkStore.status.hasRelayToken ? m.instances_token_keep() : ''} disabled={linkStore.busy || removeToken} />
		{#if linkStore.status.hasRelayToken}
			<label class="check-label"><input name="removeToken" type="checkbox" bind:checked={removeToken} disabled={linkStore.busy} />{m.instances_token_remove()}</label>
		{/if}
		<div class="actions"><button type="submit" class="ui-button ui-button-primary" disabled={linkStore.busy || linkStore.loading}>{m.instances_save()}</button></div>
	</form>

	{#if linkStore.status.enabled}
		<section class="pairing" aria-labelledby="instances-pairing-title">
			<h4 id="instances-pairing-title">{m.instances_pairing()}</h4>
			<p>{m.instances_pairing_description()}</p>
			<p class="warning">{m.instances_access_warning()}</p>
			<div class="actions"><button type="button" class="ui-button ui-button-secondary" disabled={linkStore.busy} onclick={() => void perform(async () => { pairingCode = await linkStore.pairingCode(); })}>{m.instances_generate_code()}</button></div>
			{#if pairingCode}
				<label for="instances-generated-code">{m.instances_generated_code()}</label>
				<textarea id="instances-generated-code" name="generatedCode" class="ui-input code" value={pairingCode} readonly rows="3"></textarea>
				<div class="actions"><button type="button" class="ui-button ui-button-secondary" onclick={() => void perform(async () => { await navigator.clipboard.writeText(pairingCode); notice = m.instances_copied(); })}>{m.instances_copy_code()}</button></div>
			{/if}
			<form onsubmit={(event) => { event.preventDefault(); void perform(async () => { await linkStore.pair(otherCode); otherCode = ''; }); }}>
				<label for="instances-other-code">{m.instances_enter_code()}</label>
				<textarea id="instances-other-code" name="pairingCode" class="ui-input code" bind:value={otherCode} rows="3" required maxlength="16384" spellcheck="false" disabled={linkStore.busy}></textarea>
				<div class="actions"><button type="submit" class="ui-button ui-button-secondary" disabled={linkStore.busy || !otherCode.trim()}>{m.instances_pair()}</button></div>
			</form>
		</section>
	{/if}

	<section class="machines" aria-labelledby="instances-machines-title">
		<h4 id="instances-machines-title">{m.instances_paired_machines()}</h4>
		{#if linkStore.status.peers.length === 0}
			<p>{m.instances_empty()}</p>
		{:else}
			<ul>
				{#each linkStore.status.peers as peer (peer.id)}
					<li class:stale={!peer.online && peer.lastSeen !== null && now - peer.lastSeen > staleAfter}>
						<div class="machine-heading"><strong>{peer.name}</strong><button type="button" class="ui-button ui-button-ghost" disabled={linkStore.busy} onclick={() => { revoking = peer; }}>{m.instances_revoke()}</button></div>
						<div class="status-line">
							<StatusMark status={peer.online ? peer.compatible ? 'completed' : 'attention' : 'pending'} />
							<span>{!peer.online ? linkStore.offlineReason(peer.id) === 'relay' ? m.instances_edge_relay_down() : m.instances_offline() : !peer.compatible ? m.instances_incompatible() : m.instances_online()}</span>
							{#if peer.online && peer.route}<span class="connection-detail">{peer.route === 'direct' ? m.instances_direct() : m.instances_relay()}{peer.latencyMs === null ? '' : ` · ${Math.round(peer.latencyMs)} ms`}</span>{/if}
							{#if peer.version}<span class="connection-detail">{peer.version}</span>{/if}
						</div>
						{#if !peer.online}
							<p class="last-seen">{lastSeen(peer.lastSeen)}</p>
						{/if}
						<fieldset disabled={linkStore.busy}>
							<legend>{m.instances_access_to_this_machine()}</legend>
							<div class="permissions">
								<Switch label={m.instances_read()} checked disabled />
								<Switch label={m.instances_agents()} checked={peer.permissions.agents} onChange={(value) => permission(peer, 'agents', value)} />
								<Switch label={m.instances_files()} checked={peer.permissions.files} onChange={(value) => permission(peer, 'files', value)} />
								<Switch label={m.instances_terminal()} checked={peer.permissions.terminal} onChange={(value) => permission(peer, 'terminal', value)} />
							</div>
						</fieldset>
						<PeerUpdateNotice machineId={peer.id} />
						<MachineJobs {peer} />
						<OmpSyncSettings {peer} />
						<details class="activity" bind:open={activityOpen[peer.id]}>
							<summary>{m.instances_activity()}</summary>
							{#if activityOpen[peer.id]}<MachineActivity {peer} />{/if}
						</details>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	{#if error || linkStore.error}<p class="error" role="alert">{error || linkStore.error}</p>{/if}
	<p class="notice" role="status" aria-live="polite">{notice}</p>
</div>

<ConfirmDialog open={confirmingReset} title={m.instances_key_new_identity_title()} message={m.instances_key_new_identity_description()} confirmLabel={m.instances_key_new_identity()} tone="danger" confirmDisabled={linkStore.busy} onCancel={() => { confirmingReset = false; }} onConfirm={() => void perform(async () => { await linkStore.resetIdentity(); confirmingReset = false; })} />

<ConfirmDialog open={revoking !== null} title={m.instances_revoke_title()} message={m.instances_edge_revoke_description()} confirmLabel={m.instances_edge_revoke_here()} secondaryLabel={m.instances_edge_revoke_everywhere()} tone="danger" confirmDisabled={linkStore.busy} onCancel={() => { revoking = null; }} onConfirm={() => revoke(false)} onSecondary={() => revoke(true)} />

<ConfirmDialog open={replacement !== null && revoking === null} title={m.instances_edge_replace_title()} message={m.instances_edge_replace_description({ name: replacement?.name ?? '' })} confirmLabel={m.instances_edge_replace_confirm()} tone="danger" confirmDisabled={linkStore.busy} onCancel={() => linkStore.dismissReplacement()} onConfirm={() => { const peer = replacement; if (peer) void perform(async () => { await linkStore.revoke(peer.id); linkStore.dismissReplacement(); }); }} />

<style>
	.instances-section { display: flex; flex-direction: column; gap: 24px; max-width: 720px; }
	header, section, form { display: flex; flex-direction: column; gap: 12px; }
	h4, p { margin: 0; }
	p { color: var(--ink-muted); line-height: 1.55; max-width: 70ch; }
	h4 { font-size: 14px; font-weight: 600; color: var(--ink); }
	label, legend { color: var(--ink-muted); font-size: 12px; }
	.configuration > label { margin-bottom: -6px; }
	.configuration, .pairing { padding-bottom: 24px; border-bottom: 1px solid var(--line); }
	.actions, .status-line, .machine-heading, .check-label { display: flex; align-items: center; gap: 8px; }
	.machine-heading { justify-content: space-between; }
	.status-line { flex-wrap: wrap; color: var(--ink-muted); font-size: 12px; }
	.connection-detail { color: var(--ink-faint); font-variant-numeric: tabular-nums; }
	.warning { color: var(--warn); font-size: 12px; }
	.error { color: var(--danger); overflow-wrap: anywhere; }
	.notice { min-height: 1.5em; font-size: 12px; }
	.code { width: 100%; resize: vertical; font-family: var(--font-mono); font-size: 11px; overflow-wrap: anywhere; }
	ul { list-style: none; padding: 0; margin: 0; }
	li { padding: 16px 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }
	li:first-child { padding-top: 0; }
	li.stale { background: color-mix(in oklch, var(--warn) 10%, transparent); }
	.last-seen { font-size: 12px; }
	li.stale .last-seen { color: var(--warn); }
	fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
	legend { margin-bottom: 12px; }
	.permissions { display: flex; flex-wrap: wrap; gap: 16px; }
	.key-missing { padding: 12px; border: 1px solid var(--warn); border-radius: var(--radius-md); }
	.activity summary { cursor: pointer; color: var(--ink-muted); font-size: 12px; }
	.activity[open] summary { margin-bottom: 8px; }
</style>
