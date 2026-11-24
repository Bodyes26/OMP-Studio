<!--
  «Aggiungi dispositivo» (R-MI-52): un percorso, tre canali.

  - Computer in rete locale (R-MI-54): la scoperta mDNS gira solo mentre questo
    percorso è aperto — scelta una macchina, entrambe gli schermi mostrano le
    stesse 6 cifre e l'altra deve accettare.
  - Computer con codice (R-MI-53, R-MI-55): qui si mostra il codice — corto se
    il server di Studio Remote è configurato, completo sempre — oppure si
    incolla quello dell'altra macchina.
  - Telefono (R-REM-25): il codice lo genera questo computer, che è già
    abbinato al relay; la PWA lo inserisce.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { linkStore, type PairingCode } from '#lib/backend/link.svelte.ts';
	import { remoteStore, type PhoneCode } from '#lib/remote/remoteStore.svelte.ts';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconCopy } from '#lib/icons.ts';
	import Countdown from './Countdown.svelte';

	let { onDone }: { onDone: () => void } = $props();

	type Channel = 'lan' | 'code' | 'phone';
	let channel = $state<Channel>('code');

	let error = $state('');
	let notice = $state('');

	// --- rete locale -------------------------------------------------------
	let pairingWith = $state<string | null>(null);

	// Le stesse 6 cifre che l'altra macchina mostra nella sua richiesta
	// (R-MI-54): arrivano come richiesta in uscita mentre si aspetta.
	const waitingSas = $derived.by(() => {
		if (!pairingWith) return null;
		const request = linkStore.pairRequests.find(
			(candidate) => candidate.peerId === pairingWith && candidate.direction === 'outgoing'
		);
		return request?.sas ?? null;
	});

	// La scoperta si accende con il percorso e si spegne sempre all'uscita:
	// annunciarsi in rete quando nessuno sta abbinando è vietato (R-MI-54).
	$effect(() => {
		if (channel !== 'lan') return;
		// Il contratto D1 non promette un tipo di ritorno per queste due: si
		// accetta sia `void` sia una Promise, senza lasciare rifiuti orfani.
		Promise.resolve(linkStore.startDiscovery()).catch((reason: unknown) => {
			error = reason instanceof Error ? reason.message : String(reason);
		});
		return () => { Promise.resolve(linkStore.stopDiscovery()).catch(() => {}); };
	});

	async function chooseComputer(id: string): Promise<void> {
		error = '';
		notice = '';
		pairingWith = id;
		try {
			// La promessa si chiude quando l'altra macchina risponde; intanto le
			// stesse 6 cifre arrivano su entrambi gli schermi come richiesta.
			await linkStore.pairLan(id);
			notice = m.devices_paired_ok();
			onDone();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		} finally {
			pairingWith = null;
		}
	}

	// --- codice ------------------------------------------------------------
	let generated = $state<PairingCode | null>(null);
	let pasted = $state('');
	let codeServer = $state('');
	const needsCodeServer = $derived(!remoteStore.status.relayUrl && !!pasted.trim() && !pasted.trim().startsWith('studio1:'));
	let mismatchUrl = $state<string | null>(null);
	let copied = $state<'short' | 'full' | null>(null);
	let codeRole = $state<'receive' | 'send'>('receive');
	let pairProgress = $state<'starting' | 'server' | 'configuration' | 'peer' | null>(null);
	let generating = $state(false);
	let peersBeforeCode = $state<ReadonlySet<string>>(new Set());
	const pairedFromCode = $derived(generated !== null && linkStore.status.peers.some((peer) => peer.online && !peersBeforeCode.has(peer.id)));

	const progressLabel = $derived(
		pairProgress === 'server' ? m.devices_pair_progress_server() :
		pairProgress === 'configuration' ? m.devices_pair_progress_config() :
		pairProgress === 'peer' ? m.devices_pair_progress_peer() :
		m.devices_pair_progress_start()
	);

	async function generateCode(): Promise<void> {
		error = '';
		peersBeforeCode = new Set(linkStore.status.peers.map((peer) => peer.id));
		generated = null;
		generating = true;
		try {
			generated = await linkStore.pairingCode();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		} finally {
			generating = false;
		}
	}

	async function pairWithCode(adoptRelay: boolean): Promise<void> {
		error = '';
		notice = '';
		pairProgress = 'starting';
		try {
			await linkStore.pair(pasted.trim(), {
				adoptRelay,
				server: needsCodeServer ? codeServer.trim() : undefined,
				onProgress: (stage) => { pairProgress = stage; }
			});
			pasted = '';
			mismatchUrl = null;
			notice = m.devices_paired_ok();
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			// Relay diverso: la scelta spetta all'utente (R-MI-53).
			if (message.startsWith('relay_mismatch:')) {
				mismatchUrl = message.slice('relay_mismatch:'.length);
			} else {
				error = message;
			}
		} finally {
			pairProgress = null;
		}
	}

	async function copy(text: string, which: 'short' | 'full'): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			setTimeout(() => { if (copied === which) copied = null; }, 1600);
		} catch {
			error = m.devices_copy_failed();
		}
	}

	// --- telefono ----------------------------------------------------------
	let phoneCode = $state<PhoneCode | null>(null);
	let creatingPhone = $state(false);

	async function createPhone(): Promise<void> {
		if (creatingPhone) return;
		creatingPhone = true;
		error = '';
		phoneCode = null;
		try {
			const created = await remoteStore.createPhoneCode();
			// Lo store restituisce null con `actionError` compilato: il codice non
			// è un successo senza corpo.
			if (created) phoneCode = created;
			else error = remoteStore.actionError ?? m.devices_generic_error();
		} finally {
			creatingPhone = false;
		}
	}
</script>

<div class="add-device">
	<!-- Tre strade, una scelta: chip premuti (nessuna scheda senza pannello). -->
	<div class="channels" role="group" aria-label={m.devices_add()}>
		<button
			type="button"
			class="ui-chip"
			aria-pressed={channel === 'lan'}
			disabled={linkStore.busy}
			onclick={() => { channel = 'lan'; error = ''; }}
		>{m.devices_channel_lan()}</button>
		<button
			type="button"
			class="ui-chip"
			aria-pressed={channel === 'code'}
			disabled={linkStore.busy}
			onclick={() => { channel = 'code'; error = ''; }}
		>{m.devices_channel_code()}</button>
		<button
			type="button"
			class="ui-chip"
			aria-pressed={channel === 'phone'}
			disabled={linkStore.busy}
			onclick={() => { channel = 'phone'; error = ''; void createPhone(); }}
		>{m.devices_channel_phone()}</button>
	</div>

	{#if channel === 'lan'}
		<section class="channel" aria-labelledby="devices-lan-title">
			<h5 id="devices-lan-title">{m.devices_lan_title()}</h5>
			<p class="hint">{m.devices_lan_hint()}</p>
			{#if linkStore.discovery.length === 0}
				<p class="waiting"><StatusMark status="running" /><span>{m.devices_lan_searching()}</span></p>
			{:else}
				<ul class="found">
					{#each linkStore.discovery as machine (machine.id)}
						<li>
							<span class="found-copy">
								<span class="found-name">{machine.name}</span>
								<span class="found-meta">{machine.platform}</span>
							</span>
							{#if pairingWith === machine.id}
								<span class="found-wait">
									<StatusMark status="running" />
									<span>{waitingSas ? m.devices_sas_short({ code: waitingSas }) : m.devices_lan_waiting()}</span>
								</span>
							{:else}
								<button
									type="button"
									class="ui-button ui-button-secondary"
									disabled={pairingWith !== null}
									onclick={() => void chooseComputer(machine.id)}
								>{m.devices_lan_choose()}</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else if channel === 'code'}
		<section class="channel" aria-labelledby="devices-code-title">
			<h5 id="devices-code-title">{m.devices_code_title()}</h5>
			<div class="inline" role="group" aria-label={m.devices_code_title()}>
				<button type="button" class="ui-button ui-button-secondary" aria-pressed={codeRole === 'receive'} disabled={linkStore.busy} onclick={() => { codeRole = 'receive'; error = ''; notice = ''; }}>{m.devices_code_receive()}</button>
				<button type="button" class="ui-button ui-button-secondary" aria-pressed={codeRole === 'send'} disabled={linkStore.busy} onclick={() => { codeRole = 'send'; error = ''; notice = ''; }}>{m.devices_code_show()}</button>
			</div>
			{#if codeRole === 'send'}

			<div class="block">
				<p class="hint">{m.devices_code_share_hint()}</p>
				{#if pairedFromCode}
					<p class="notice" role="status">{m.devices_paired_ok()}</p>
					<button type="button" class="ui-button ui-button-secondary" onclick={onDone}>{m.devices_back()}</button>
				{:else if generated}
					{@const code = generated}
					{#if code.shortCode}
						<div class="short-code">
							<span class="digits">{code.shortCode}</span>
							<Countdown expiresAt={code.expiresAt} />
							{#if remoteStore.status.relayUrl}<span class="hint">{remoteStore.status.relayUrl}</span>{/if}
						</div>
						<button type="button" class="ui-button ui-button-secondary" onclick={() => void copy(code.shortCode ?? '', 'short')}>
							<IconCopy />
							<span>{copied === 'short' ? m.devices_copied() : m.devices_copy_short()}</span>
						</button>
					{:else}
						<p class="hint">{m.devices_code_short_unavailable()}</p>
						<Countdown expiresAt={code.expiresAt} />
					{/if}
					<details>
						<summary>{m.devices_copy_full()}</summary>
						<button type="button" class="ui-button ui-button-ghost" onclick={() => void copy(code.code, 'full')}>
							<IconCopy />
							<span>{copied === 'full' ? m.devices_copied() : m.devices_copy_full()}</span>
						</button>
					</details>
				{/if}
				<button type="button" class="ui-button ui-button-primary" disabled={linkStore.busy} onclick={generateCode}>{generating ? m.devices_generating() : generated ? m.devices_pair_code_regenerate() : m.devices_generate_code()}</button>
			</div>
			{:else}
			<form class="block" onsubmit={(event) => {
				event.preventDefault();
				if (pasted.trim() && (!needsCodeServer || codeServer.trim()) && !linkStore.busy) void pairWithCode(false);
			}}>
				<p class="hint">{m.devices_code_receive_hint()}</p>
				<label class="field-label" for="devices-paste-code">{m.devices_code_enter()}</label>
				<textarea
					id="devices-paste-code"
					class="ui-input code-input"
					rows="2"
					bind:value={pasted}
					spellcheck="false"
					disabled={linkStore.busy}
					placeholder={m.devices_code_placeholder()}
				></textarea>
				{#if needsCodeServer}
					<label class="field-label" for="devices-code-server">{m.devices_server_label()}</label>
					<input id="devices-code-server" class="ui-input" type="url" bind:value={codeServer} required disabled={linkStore.busy} />
					<p class="hint">{m.devices_code_server_hint()}</p>
				{/if}
				<div class="inline">
					<button type="submit" class="ui-button ui-button-primary" disabled={!pasted.trim() || (needsCodeServer && !codeServer.trim()) || linkStore.busy}>
						{m.devices_pair()}
					</button>
				</div>
			</form>
			{#if pairProgress}
				<p class="notice inline" role="status"><StatusMark status="running" />{progressLabel}</p>
			{:else if notice}
				<button type="button" class="ui-button ui-button-secondary" onclick={onDone}>{m.devices_back()}</button>
			{/if}
			{/if}
		</section>
	{:else}
		<section class="channel" aria-labelledby="devices-phone-title">
			<h5 id="devices-phone-title">{m.devices_phone_title()}</h5>
			<p class="hint">{m.devices_phone_hint()}</p>
			{#if phoneCode}
				{@const code = phoneCode}
				<div class="phone-code">
					<span class="digits">{code.code}</span>
					<Countdown expiresAt={code.expiresAt} />
					<span class="mono">{code.url}</span>
				</div>
				<div class="inline">
					<button type="button" class="ui-button ui-button-secondary" onclick={() => void copy(`${code.url}\n${code.code}`, 'short')}>
						<IconCopy />
						<span>{copied === 'short' ? m.devices_copied() : m.devices_copy_code_and_url()}</span>
					</button>
					<button type="button" class="ui-button ui-button-ghost" disabled={creatingPhone} onclick={() => void createPhone()}>{m.devices_regenerate()}</button>
				</div>
			{:else if remoteStore.status.paired}
				<button type="button" class="ui-button ui-button-primary" disabled={creatingPhone} onclick={() => void createPhone()}>
					{creatingPhone ? m.devices_generating() : m.devices_generate_code()}
				</button>
			{:else}
				<p class="hint">{m.devices_phone_needs_relay()}</p>
			{/if}
		</section>
	{/if}

	{#if error}<p class="field-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status" aria-live="polite">{notice}</p>{/if}
</div>

<ConfirmDialog
	open={mismatchUrl !== null}
	title={m.devices_mismatch_title()}
	message={m.devices_mismatch_message({ url: mismatchUrl ?? '' })}
	confirmLabel={m.devices_mismatch_adopt()}
	tone="primary"
	onCancel={() => (mismatchUrl = null)}
	onConfirm={() => {
		mismatchUrl = null;
		void pairWithCode(true);
	}}
/>

<style>
	.add-device {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.channels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.channel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h5 {
		margin: 0;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.hint {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.found li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	.found li + li {
		border-top: 1px solid var(--line);
	}

	.found-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.found-name {
		font-size: var(--text-label);
		font-weight: 500;
	}

	.found-meta {
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.found-wait,
	.waiting {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	.short-code,
	.phone-code {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.digits {
		font-family: var(--font-mono);
		font-size: 24px;
		letter-spacing: 0.08em;
		color: var(--ink);
	}

	.mono {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.code-input {
		width: 100%;
		resize: vertical;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink);
	}

	.field-error {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--danger);
		overflow-wrap: anywhere;
	}

	.notice {
		margin: 0;
		min-height: 1.4em;
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}
</style>
