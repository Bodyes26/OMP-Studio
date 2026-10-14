<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { remoteStore } from '$lib/remote/remoteStore.svelte';
	import { normalizePairingCode, formatPairingCode } from '$remote-protocol';
	import Switch from '$lib/ui/Switch.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';

	let relayUrlInput = $state(remoteStore.status.relayUrl ?? '');
	let machineNameInput = $state(remoteStore.status.machineName ?? '');
	let codeInput = $state('');
	let codeError = $state<string | null>(null);
	let confirmUnpairOpen = $state(false);

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
</script>

<div class="settings-section">
	<div class="section-header">
		<h4>{m.settings_remote_title()}</h4>
	</div>

	<p class="section-desc">{m.settings_remote_desc()}</p>

	<div class="section-group">
		<!-- 1. Interruttore abilitazione -->
		<div class="form-row">
			<div class="form-row-copy">
				<label for="settings-remote-enable" id="settings-remote-enable-label" class="form-row-label">
					{m.settings_remote_enable_title()}
				</label>
				<span id="settings-remote-enable-desc" class="form-row-desc">
					{m.settings_remote_enable_desc()}
				</span>
			</div>
			<div class="form-row-control">
				<Switch
					id="settings-remote-enable"
					checked={remoteStore.status.enabled}
					ariaLabelledBy="settings-remote-enable-label"
					onChange={(checked: boolean) => void remoteStore.setEnabled(checked)}
				/>
			</div>
		</div>

		{#if remoteStore.status.enabled}
			<!-- 2. Riga di stato connessione -->
			<div class="form-row status-summary-row">
				<div class="form-row-copy">
					<span class="form-row-label">Stato connessione</span>
					<div class="remote-status-detail">
						{#if remoteStore.status.connection === 'connected'}
							<div class="status-line ok">
								<StatusMark status="completed" />
								<span>
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
								<span>{m.settings_remote_status_waiting()}</span>
							</div>
						{:else if remoteStore.status.connection === 'revoked'}
							<div class="status-line error">
								<StatusMark status="failed" />
								<span>{m.settings_remote_status_revoked()}</span>
							</div>
						{:else if remoteStore.status.connection === 'incompatible'}
							<div class="status-line error">
								<StatusMark status="failed" />
								<span>{m.settings_remote_status_incompatible()}</span>
							</div>
						{:else if remoteStore.status.paired}
							<div class="status-line">
								<StatusMark status="pending" />
								<span>In collegamento...</span>
							</div>
						{:else}
							<div class="status-line">
								<StatusMark status="pending" />
								<span>{m.settings_remote_status_unpaired()}</span>
							</div>
						{/if}

						{#if remoteStore.status.relayVersion}
							<span class="relay-version-meta">
								{m.settings_remote_relay_version({ version: remoteStore.status.relayVersion })}
							</span>
						{/if}

						{#if remoteStore.status.updateNeeded === 'relay'}
							<p class="update-hint-box warn">
								{m.settings_remote_update_relay_hint()}
							</p>
						{:else if remoteStore.status.updateNeeded === 'studio'}
							<p class="update-hint-box warn">
								{m.settings_remote_update_studio_hint()}
							</p>
						{/if}

						{#if remoteStore.status.lastError}
							<span class="last-error-text">
								{m.settings_remote_last_error({ error: remoteStore.status.lastError })}
							</span>
						{/if}

						{#if remoteStore.actionError}
							<span class="last-error-text">{remoteStore.actionError}</span>
						{/if}
					</div>
				</div>
			</div>

			{#if remoteStore.status.paired}
				<!-- Stato Abbinato: Indirizzo e Nome Macchina -->
				<div class="form-row">
					<div class="form-row-copy">
						<label for="settings-remote-url" class="form-row-label">
							{m.settings_remote_relay_url_title()}
						</label>
						<span class="form-row-desc">{m.settings_remote_relay_url_desc()}</span>
					</div>
					<div class="form-row-control">
						<input
							id="settings-remote-url"
							type="text"
							class="ui-input"
							value={remoteStore.status.relayUrl ?? ''}
							readonly
							disabled
						/>
					</div>
				</div>

				<div class="form-row">
					<div class="form-row-copy">
						<label for="settings-remote-name" class="form-row-label">
							{m.settings_remote_machine_name_title()}
						</label>
						<span class="form-row-desc">{m.settings_remote_machine_name_desc()}</span>
					</div>
					<div class="form-row-control">
						<input
							id="settings-remote-name"
							type="text"
							class="ui-input"
							bind:value={machineNameInput}
							onblur={handleSaveMachineName}
						/>
					</div>
				</div>

				<div class="form-row action-row">
					<button
						type="button"
						class="ui-button ui-button-danger"
						disabled={remoteStore.loading}
						onclick={() => (confirmUnpairOpen = true)}
					>
						{m.settings_remote_forget_button()}
					</button>
				</div>
			{:else}
				<!-- Stato Non Abbinato: Modulo di configurazione e abbinamento -->
				<div class="form-row">
					<div class="form-row-copy">
						<label for="settings-remote-pair-url" class="form-row-label">
							{m.settings_remote_relay_url_title()}
						</label>
						<span class="form-row-desc">{m.settings_remote_relay_url_desc()}</span>
					</div>
					<div class="form-row-control">
						<input
							id="settings-remote-pair-url"
							type="text"
							class="ui-input"
							placeholder="https://relay.example.com"
							bind:value={relayUrlInput}
						/>
					</div>
				</div>

				<div class="form-row">
					<div class="form-row-copy">
						<label for="settings-remote-pair-name" class="form-row-label">
							{m.settings_remote_machine_name_title()}
						</label>
						<span class="form-row-desc">{m.settings_remote_machine_name_desc()}</span>
					</div>
					<div class="form-row-control">
						<input
							id="settings-remote-pair-name"
							type="text"
							class="ui-input"
							placeholder="OMP Studio"
							bind:value={machineNameInput}
						/>
					</div>
				</div>

				<div class="form-row">
					<div class="form-row-copy">
						<label for="settings-remote-pair-code" class="form-row-label">
							{m.settings_remote_pairing_code_title()}
						</label>
						<span class="form-row-desc">{m.settings_remote_pairing_code_desc()}</span>
					</div>
					<div class="form-row-control pair-code-control">
						<input
							id="settings-remote-pair-code"
							type="text"
							class="ui-input pair-code-input"
							placeholder="XXXX-XXXX"
							value={codeInput}
							oninput={handleCodeInput}
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
				</div>

				{#if codeError}
					<div class="form-row error-row">
						<span class="last-error-text">{codeError}</span>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
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
	.section-desc {
		margin: 0 0 var(--space-4) 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.5;
	}

	.status-summary-row {
		border-left: 2px solid var(--line-strong);
		padding-left: var(--space-3);
	}

	.remote-status-detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-1);
	}

	.status-line {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-body);
		color: var(--ink);
	}

	.status-line.ok {
		color: var(--ink);
	}

	.status-line.warn {
		color: var(--warn);
	}

	.status-line.error {
		color: var(--danger);
	}

	.relay-version-meta {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-family: var(--font-mono);
	}

	.update-hint-box {
		margin: var(--space-1) 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		font-size: var(--text-caption);
		line-height: 1.45;
	}

	.update-hint-box.warn {
		border-color: var(--warn-dim);
		color: var(--warn);
	}

	.last-error-text {
		font-size: var(--text-caption);
		color: var(--danger);
	}

	.pair-code-control {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.pair-code-input {
		font-family: var(--font-mono);
		font-weight: 600;
		letter-spacing: 0.1em;
		max-width: 160px;
		text-align: center;
	}

	.action-row {
		justify-content: flex-end;
		margin-top: var(--space-3);
	}

	.error-row {
		margin-top: var(--space-1);
	}
</style>
