<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { remoteStore } from '#lib/remote/remoteStore.svelte.ts';
	import { normalizePairingCode, formatPairingCode } from '$remote-protocol';
	import Switch from '#lib/ui/Switch.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import { IconRemote, IconCopy, IconExternalLink, IconWarning } from '#lib/icons.ts';

	let relayUrlInput = $state(remoteStore.status.relayUrl ?? '');
	let machineNameInput = $state(remoteStore.status.machineName ?? '');
	let codeInput = $state('');
	let codeError = $state<string | null>(null);
	let confirmUnpairOpen = $state(false);
	let copied: string | null = $state(null);

	$effect(() => {
		if (remoteStore.status.relayUrl && !relayUrlInput) {
			relayUrlInput = remoteStore.status.relayUrl;
		}
		if (remoteStore.status.machineName && !machineNameInput) {
			machineNameInput = remoteStore.status.machineName;
		}
	});

	function handleCodeInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		const raw = target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
		if (raw.length <= 4) {
			codeInput = raw;
		} else {
			codeInput = formatPairingCode(raw.slice(0, 8));
		}
		codeError = null;
	}

	async function handlePair() {
		const cleanCode = normalizePairingCode(codeInput);
		if (!cleanCode) {
			codeError = m.settings_remote_invalid_code();
			return;
		}
		if (!relayUrlInput.trim()) {
			codeError = m.settings_remote_relay_url_desc();
			return;
		}
		const ok = await remoteStore.pair(
			relayUrlInput.trim(),
			cleanCode,
			machineNameInput.trim() || 'OMP Studio'
		);
		if (ok) {
			codeInput = '';
			codeError = null;
		}
	}

	async function handleSaveMachineName() {
		if (machineNameInput.trim() && machineNameInput.trim() !== remoteStore.status.machineName) {
			await remoteStore.setMachineName(machineNameInput.trim());
		}
	}

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => { if (copied === key) copied = null; }, 1600);
		} catch {}
	}
</script>

<div class="settings-section remote-section">
	<div class="section-header">
		<h4>{m.settings_remote_title()}</h4>
		<span class="section-header-sub">{m.settings_remote_desc()}</span>
	</div>

	<!-- Abilitazione -->
	<div class="remote-card">
		<div class="card-head">
			<span class="card-title">{m.settings_remote_enable_title()}</span>
			<Switch
				id="settings-remote-enable"
				checked={remoteStore.status.enabled}
				ariaLabelledBy="settings-remote-enable-label"
				onChange={(checked: boolean) => void remoteStore.setEnabled(checked)}
			/>
		</div>
		<p id="settings-remote-enable-desc" class="card-desc">{m.settings_remote_enable_desc()}</p>
	</div>

	{#if remoteStore.status.enabled}
		<!-- Stato connessione -->
		<div class="remote-card">
			<div class="card-title-row">
				<span class="card-title">Stato connessione</span>
				{#if remoteStore.status.relayVersion}
					<span class="version-chip">relay {remoteStore.status.relayVersion}</span>
				{/if}
			</div>

			<div class="status-block">
				{#if remoteStore.status.connection === 'connected'}
					<div class="status-line ok">
						<StatusMark status="completed" />
						<span class="status-text">
							{#if remoteStore.status.clients.length > 0}
								{m.settings_remote_status_connected_with_devices({
									count: remoteStore.status.clients.length,
									devices: remoteStore.status.clients.map((c) => c.name).join(', ')
								})}
							{:else}
								{m.settings_remote_status_connected_no_devices()}
							{/if}
						</span>
					</div>
				{:else if remoteStore.status.connection === 'waiting'}
					<div class="status-line warn">
						<StatusMark status="running" />
						<span class="status-text">{m.settings_remote_status_waiting()}</span>
					</div>
				{:else if remoteStore.status.connection === 'revoked'}
					<div class="status-line error">
						<StatusMark status="failed" />
						<span class="status-text">{m.settings_remote_status_revoked()}</span>
					</div>
				{:else if remoteStore.status.connection === 'incompatible'}
					<div class="status-line error">
						<StatusMark status="failed" />
						<span class="status-text">{m.settings_remote_status_incompatible()}</span>
					</div>
				{:else if remoteStore.status.paired}
					<div class="status-line">
						<StatusMark status="pending" />
						<span class="status-text">In collegamento...</span>
					</div>
				{:else}
					<div class="status-line">
						<StatusMark status="pending" />
						<span class="status-text">{m.settings_remote_status_unpaired()}</span>
					</div>
				{/if}

				{#if remoteStore.status.updateNeeded === 'relay'}
					<div class="callout warn">
						<IconWarning />
						<span>{m.settings_remote_update_relay_hint()}</span>
					</div>
				{:else if remoteStore.status.updateNeeded === 'studio'}
					<div class="callout warn">
						<IconWarning />
						<span>{m.settings_remote_update_studio_hint()}</span>
					</div>
				{/if}

				{#if remoteStore.status.lastError}
					<span class="last-error-text">{m.settings_remote_last_error({ error: remoteStore.status.lastError })}</span>
				{/if}
				{#if remoteStore.actionError}
					<span class="last-error-text">{remoteStore.actionError}</span>
				{/if}
			</div>
		</div>

		{#if remoteStore.status.paired}
			<!-- Macchina -->
			<div class="remote-card">
				<div class="card-title-row">
					<span class="card-title">{m.settings_remote_machine_name_title()}</span>
				</div>
				<p class="card-desc">{m.settings_remote_machine_name_desc()}</p>
				<div class="field-row">
					<input
						id="settings-remote-name"
						type="text"
						class="ui-input"
						bind:value={machineNameInput}
						onblur={handleSaveMachineName}
						placeholder="OMP Studio"
					/>
				</div>

				<div class="field-row with-copy">
					<div class="field-label-col">
						<span class="field-label">{m.settings_remote_relay_url_title()}</span>
						<span class="field-hint">{m.settings_remote_relay_url_desc()}</span>
					</div>
					<div class="copy-field">
						<input type="text" class="ui-input" value={remoteStore.status.relayUrl ?? ''} readonly />
						<Tooltip text={copied === 'url' ? 'Copiato' : 'Copia'}>
							<button type="button" class="ui-button ui-button-ghost icon-btn" onclick={() => copy(remoteStore.status.relayUrl ?? '', 'url')} aria-label="Copia URL">
								<IconCopy />
							</button>
						</Tooltip>
					</div>
				</div>

				<div class="card-actions">
					<button type="button" class="ui-button ui-button-secondary" onclick={() => void remoteStore.openMachinesWindow()}>
						<IconRemote size={16} />
						<span>{m.settings_remote_open_machines()}</span>
						<IconExternalLink size={12} />
					</button>
				</div>
			</div>

			<!-- Zona pericolosa -->
			<div class="remote-card danger-card">
				<div class="card-title-row">
					<span class="card-title">Zona pericolosa</span>
				</div>
				<p class="card-desc">Rimuove l'abbinamento di questa macchina. Dovrai generare un nuovo codice dal relay.</p>
				<button type="button" class="ui-button ui-button-danger" disabled={remoteStore.loading} onclick={() => (confirmUnpairOpen = true)}>
					{m.settings_remote_forget_button()}
				</button>
			</div>
		{:else}
			<!-- Abbinamento -->
			<div class="remote-card">
				<div class="card-title-row">
					<span class="card-title">Abbina questa macchina</span>
				</div>
				<p class="card-desc">Incolla l'URL del tuo relay e il codice di abbinamento generato nella dashboard del relay.</p>

				<div class="field-stack">
					<label class="field-label" for="settings-remote-pair-url">{m.settings_remote_relay_url_title()}</label>
					<input id="settings-remote-pair-url" type="text" class="ui-input" placeholder="https://relay.example.com" bind:value={relayUrlInput} />
					<span class="field-hint">{m.settings_remote_relay_url_desc()}</span>

					<label class="field-label" for="settings-remote-pair-name">{m.settings_remote_machine_name_title()}</label>
					<input id="settings-remote-pair-name" type="text" class="ui-input" placeholder="OMP Studio" bind:value={machineNameInput} />
					<span class="field-hint">{m.settings_remote_machine_name_desc()}</span>

					<label class="field-label" for="settings-remote-pair-code">{m.settings_remote_pairing_code_title()}</label>
					<div class="pair-row">
						<input
							id="settings-remote-pair-code"
							type="text"
							class="ui-input pair-code-input"
							placeholder="XXXX-XXXX"
							value={codeInput}
							oninput={handleCodeInput}
							autocomplete="off"
							spellcheck={false}
						/>
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={remoteStore.loading || !codeInput.trim() || !relayUrlInput.trim()}
							onclick={handlePair}
						>
							{#if remoteStore.loading}
								{m.settings_remote_pairing_in_progress()}
							{:else}
								{m.settings_remote_pair_button()}
							{/if}
						</button>
					</div>
					<span class="field-hint">{m.settings_remote_pairing_code_desc()}</span>
					{#if codeError}
						<span class="field-error">{codeError}</span>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<ConfirmDialog
	open={confirmUnpairOpen}
	title={m.settings_remote_forget_confirm_title()}
	message={m.settings_remote_forget_confirm_message()}
	confirmLabel={m.settings_remote_forget_button()}
	tone="danger"
	onConfirm={() => {
		confirmUnpairOpen = false;
		void remoteStore.unpair();
	}}
	onCancel={() => {
		confirmUnpairOpen = false;
	}}
/>

<style>
	.remote-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-header {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--space-1);
	}

	.section-header h4 {
		margin: 0;
		font-size: var(--text-title);
		font-weight: 650;
	}

	.section-header-sub {
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.remote-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.danger-card {
		border-color: color-mix(in oklab, var(--danger) 22%, var(--line));
		background: color-mix(in oklab, var(--danger) 4%, var(--bg-base));
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.card-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.card-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.card-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.version-chip {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 1px 6px;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.status-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.status-line {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-body);
		color: var(--ink);
	}

	.status-line.ok { color: var(--ink); }
	.status-line.warn { color: var(--warn); }
	.status-line.error { color: var(--danger); }

	.status-text { line-height: 1.4; }

	.callout {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		font-size: var(--text-caption);
		line-height: 1.45;
		--icon-size: 14px;
	}

	.callout.warn {
		border-color: var(--warn-dim);
		color: var(--warn);
		background: color-mix(in oklab, var(--warn) 8%, var(--bg-raised));
	}

	.last-error-text {
		font-size: var(--text-caption);
		color: var(--danger);
		line-height: 1.4;
	}

	.field-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field-row.with-copy {
		gap: var(--space-2);
	}

	.field-label-col {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.field-label {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.field-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.field-error {
		font-size: var(--text-caption);
		color: var(--danger);
	}

	.copy-field {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.copy-field .ui-input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.icon-btn {
		width: 32px;
		height: 32px;
		padding: 0;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		--icon-size: 14px;
	}

	.card-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.field-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-stack .ui-input {
		width: 100%;
	}

	.pair-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.pair-code-input {
		font-family: var(--font-mono);
		font-weight: 600;
		letter-spacing: 0.12em;
		text-align: center;
		max-width: 180px;
		text-transform: uppercase;
	}
</style>
