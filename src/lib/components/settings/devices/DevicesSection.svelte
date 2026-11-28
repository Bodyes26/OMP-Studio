<!--
  Impostazioni › Dispositivi (R-MI-52).

  Una sola sezione al posto di «Controllo remoto» e «Altre istanze»: in testa
  questo computer (un nome solo, un server di collegamento solo), sotto
  l'elenco unico di computer e telefoni, e un percorso guidato per aggiungerne
  uno. Il dettaglio vive dentro la sezione, non in una finestra: si apre da una
  riga o dal chip di stato tramite `settingsStore.openDevice`.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore } from '#lib/backend/link.svelte.ts';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import { settingsStore, type DeviceTarget } from '#lib/stores/settings.svelte.ts';
	import { i18n } from '#lib/i18n/i18n.svelte.ts';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconChevronRight, IconMonitor, IconPhone } from '#lib/icons.ts';
	import ThisComputer from './ThisComputer.svelte';
	import ComputerDetail from './ComputerDetail.svelte';
	import PhoneDetail from './PhoneDetail.svelte';
	import AddDevice from './AddDevice.svelte';
	import KeyMissing from './KeyMissing.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import ConnectionMap from './ConnectionMap.svelte';

	let view = $state<'list' | 'detail' | 'add'>('list');
	let showMap = $state(false);
	let detail = $state<DeviceTarget | null>(null);
	// Nome dell'ultimo telefono aperto: quando si scollega il dettaglio resta
	// leggibile invece di diventare una riga senza titolo.
	let phoneName = $state('');
	let now = $state(Date.now());

	// L'elenco si aggiorna da sé («vista l'ultima volta» dipende dal tempo).
	$effect(() => {
		const timer = window.setInterval(() => { now = Date.now(); }, 60_000);
		return () => window.clearInterval(timer);
	});

	// Chip e pannello del progetto chiedono il dettaglio di una macchina precisa
	// (R-MI-49): `openDevice` scrive qui la destinazione, anche a finestra
	// impostazioni già aperta. È un ordine a una volta sola: consumarlo evita
	// che riaprendo le impostazioni dal menu ricompaia l'ultimo dettaglio.
	$effect(() => {
		const target = settingsStore.deviceTarget;
		if (!target) return;
		settingsStore.deviceTarget = null;
		openDetail(target);
	});

	$effect(() => {
		if (!settingsStore.connectionMapRequested) return;
		settingsStore.connectionMapRequested = false;
		backToList();
		showMap = true;
	});

	// R-MI-29: oltre un mese di silenzio una macchina va segnalata, non solo
	// elencata come «spenta» uguale alle altre.
	const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

	function lastSeenText(timestamp: number): string {
		const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
		const units: [number, Intl.RelativeTimeFormatUnit][] = [
			[31_536_000, 'year'],
			[2_592_000, 'month'],
			[86_400, 'day'],
			[3600, 'hour'],
			[60, 'minute'],
			[1, 'second']
		];
		const [size, unit] = units.find(([size]) => seconds >= size) ?? units[units.length - 1];
		return i18n.formatRelativeTime(-Math.floor(seconds / size), unit);
	}

	function stale(peer: (typeof linkStore.status.peers)[number]): boolean {
		return !peer.online && peer.lastSeen !== null && now - peer.lastSeen > STALE_AFTER_MS;
	}

	const computers = $derived(linkStore.status.peers);
	const phones = $derived(remoteStore.status.clients);
	const relayConnected = $derived(remoteStore.status.connection === 'connected');

	function openDetail(target: DeviceTarget) {
		detail = target;
		if (target.kind === 'phone') {
			phoneName = phones.find((client) => client.id === target.id)?.name ?? phoneName;
		}
		view = 'detail';
	}

	function backToList() {
		detail = null;
		settingsStore.deviceTarget = null;
		view = 'list';
		showMap = false;
	}

	function openAdd() {
		detail = null;
		settingsStore.deviceTarget = null;
		view = 'add';
	}

	// R-MI-29: una macchina con lo stesso nome si è riabbinata mentre la vecchia
	// è spenta — probabilmente una reinstallazione. La scelta è dell'utente.
	const replacement = $derived(linkStore.replacements[0] ?? null);

	const detailComputer = $derived(
		detail?.kind === 'computer' ? computers.find((peer) => peer.id === detail?.id) ?? null : null
	);
	const detailPhone = $derived(
		detail?.kind === 'phone' ? phones.find((client) => client.id === detail?.id) ?? null : null
	);

	/**
	 * Il dispositivo aperto nel dettaglio puo' sparire mentre lo si guarda
	 * (revocato da un'altra finestra o sostituito): senza questo la sezione
	 * restava su `detail` senza destinatario, cioe' un elenco vuoto con un
	 * «Indietro» e niente da leggere (S3-link-front-27).
	 */
	$effect(() => {
		if (view !== 'detail' || !detail) return;
		const alive = detail.kind === 'computer' ? detailComputer !== null : detailPhone !== null;
		if (!alive) backToList();
	});
</script>

<div class="settings-section devices-section">
	<div class="section-header">
		<h4>{m.devices_title()}</h4>
		{#if view === 'list'}
			<button type="button" class="ui-button ui-button-primary" onclick={openAdd}>{m.devices_add()}</button>
		{:else}
			<button type="button" class="ui-button ui-button-ghost" onclick={backToList}>{m.devices_back()}</button>
		{/if}
	</div>

	{#if view === 'list'}
		<div class="device-tabs" role="group" aria-label={m.devices_title()}>
			<button type="button" aria-pressed={!showMap} onclick={() => (showMap = false)}>{m.devices_overview()}</button>
			<button type="button" aria-pressed={showMap} onclick={() => (showMap = true)}>{m.devices_connection_map()}</button>
		</div>
	{/if}

	{#if view === 'detail' && detail?.kind === 'computer' && detailComputer}
		<ComputerDetail peer={detailComputer} onRevoked={backToList} />
	{:else if view === 'detail' && detail?.kind === 'phone'}
		<PhoneDetail client={detailPhone} name={detailPhone?.name ?? phoneName} />
	{:else if view === 'add'}
		<AddDevice onDone={backToList} />
	{:else if showMap}
		<ConnectionMap onOpen={openDetail} />
	{:else}

		<!-- «Questo computer» in testa (R-MI-52): il nome e il server di
		     collegamento di questa macchina vengono prima dell'elenco. -->
		<ThisComputer />

		<KeyMissing />

		<section class="device-group" aria-labelledby="devices-computers-title">
			<h5 id="devices-computers-title">{m.devices_computers()}</h5>
			{#if computers.length === 0}
				<p class="empty">{m.devices_computers_empty()}</p>
			{:else}
				<ul class="rows">
					{#each computers as peer (peer.id)}
						<li class:stale={stale(peer)}>
							<button type="button" class="device-row" onclick={() => openDetail({ kind: 'computer', id: peer.id })}>
								<span class="row-icon"><IconMonitor /></span>
								<span class="row-copy">
									<span class="row-name">{peer.name}</span>
									<span class="row-meta">
										<StatusMark
											status={!peer.online ? 'pending' : peer.compatible ? 'completed' : 'attention'}
										/>
										<span>
											{#if !peer.online}
												{linkStore.offlineReason(peer.id) === 'relay' ? m.devices_relay_unreachable() : m.devices_offline()}
											{:else if !peer.compatible}
												{m.devices_incompatible()}
											{:else}
												{m.devices_online()}
											{/if}
										</span>
										{#if peer.online && peer.route}
											<span class="row-detail">
												{peer.route === 'direct' ? m.devices_direct() : m.devices_via_relay()}{peer.latencyMs === null ? '' : ` · ${Math.round(peer.latencyMs)} ms`}
											</span>
										{/if}
										{#if !peer.online}
											<span class="row-detail">
												{peer.lastSeen === null ? m.devices_seen_unknown() : m.devices_last_seen({ time: lastSeenText(peer.lastSeen) })}
											</span>
										{/if}
									</span>
								</span>
								<span class="row-chevron"><IconChevronRight /></span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="device-group" aria-labelledby="devices-phones-title">
			<h5 id="devices-phones-title">{m.devices_phones()}</h5>
			{#if phones.length === 0}
				<p class="empty">{m.devices_phones_empty()}</p>
			{:else}
				<ul class="rows">
					{#each phones as client (client.id)}
						<li>
							<button type="button" class="device-row" onclick={() => openDetail({ kind: 'phone', id: client.id })}>
								<span class="row-icon"><IconPhone /></span>
								<span class="row-copy">
									<span class="row-name">{client.name}</span>
									<span class="row-meta">
										<StatusMark status={relayConnected ? 'completed' : 'pending'} />
										<span>{relayConnected ? m.devices_online() : m.devices_offline()}</span>
									</span>
								</span>
								<span class="row-chevron"><IconChevronRight /></span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

	{/if}
</div>

<ConfirmDialog
	open={replacement !== null}
	title={m.devices_replace_title()}
	message={m.devices_replace_message({ name: replacement?.name ?? '' })}
	confirmLabel={m.devices_replace_confirm()}
	tone="danger"
	confirmDisabled={linkStore.busy}
	onCancel={() => linkStore.dismissReplacement()}
	onConfirm={() => {
		const peer = replacement;
		if (!peer) return;
		void linkStore.revoke(peer.id).finally(() => linkStore.dismissReplacement());
	}}
/>

<style>
	.device-tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--line); }
	.device-tabs button {
		padding: var(--space-1) var(--space-2) var(--space-2);
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--ink-muted);
		font: inherit;
		cursor: pointer;
	}
	.device-tabs button[aria-pressed='true'] { color: var(--ink); border-color: var(--brand); }

	.devices-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		max-width: 760px;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.device-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.device-group h5 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.rows {
		display: flex;
		flex-direction: column;
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		overflow: hidden;
	}

	.rows li.stale .row-meta {
		color: var(--warn);
	}

	.rows li + li {
		border-top: 1px solid var(--line);
	}

	.device-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3);
		background: transparent;
		border: 0;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}

	.device-row:hover {
		background: var(--bg-hover);
	}

	.device-row:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.row-icon {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
	}

	.row-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.row-name {
		font-size: var(--text-label);
		font-weight: 500;
	}

	.row-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.row-detail {
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.row-chevron {
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.empty {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}
</style>
