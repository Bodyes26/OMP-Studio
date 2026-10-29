<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime, formatDuration } from '#lib/automations/i18n.ts';
	import type { AutomationDefinition, AutomationState } from '#lib/automations/types.ts';
	import AutomationHistory from './AutomationHistory.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import {
		IconPlay,
		IconPencil,
		IconStop,
		IconPause,
		IconTrash,
		IconRefresh,
		IconSchedule,
		IconTerminal,
		IconFileCode,
		IconKey,
		IconRule,
		IconPlus,
		IconLock,
		IconCheck,
		IconWarning
	} from '#lib/icons.ts';

	interface Props {
		definition: AutomationDefinition;
		selectedRunId?: string | null;
		onSelectRun?: (runId: string | null) => void;
		onOpenSession?: (sessionId: string) => void;
	}

	let { definition, selectedRunId = null, onSelectRun, onOpenSession }: Props = $props();

	let activeDetailTab = $state<'config' | 'history' | 'secrets'>('config');
	let isRunningNow = $state(false);
	let showDeleteDialog = $state(false);
	let deleteHistory = $state(false);

	// Secret management state
	let newSecretKey = $state('');
	let newSecretValue = $state('');
	let secretSaving = $state(false);
	let secretSuccessMsg = $state<string | null>(null);

	const nextRunMs = $derived(
		automationsStore.snapshot?.nextRuns?.[definition.id] ?? null
	);

	const secretRefsEntries = $derived(
		definition.action.kind === 'command' ? Object.entries(definition.action.secretRefs || {}) : []
	);

	async function handleRunNow() {
		if (isRunningNow) return;
		isRunningNow = true;
		try {
			await automationsStore.runNow(definition.id);
		} catch (err) {
			console.error('Failed to run now:', err);
		} finally {
			isRunningNow = false;
		}
	}

	async function handleToggleState() {
		const nextState: AutomationState = definition.state === 'enabled' ? 'disabled' : 'enabled';
		try {
			await automationsStore.setState(definition.id, nextState);
		} catch (err) {
			console.error('Failed to change state:', err);
		}
	}

	async function handleArchive() {
		try {
			await automationsStore.setState(definition.id, 'archived');
		} catch (err) {
			console.error('Failed to archive:', err);
		}
	}

	async function confirmDelete() {
		try {
			await automationsStore.remove(definition.id, deleteHistory);
			showDeleteDialog = false;
		} catch (err) {
			console.error('Failed to delete automation:', err);
		}
	}

	async function saveSecret() {
		if (!newSecretKey.trim() || !newSecretValue) return;
		secretSaving = true;
		secretSuccessMsg = null;
		try {
			await automationsStore.putSecret(newSecretKey.trim(), newSecretValue);
			newSecretKey = '';
			newSecretValue = '';
			secretSuccessMsg = 'Segreto salvato nel portachiavi di sistema.';
			setTimeout(() => { secretSuccessMsg = null; }, 3000);
		} catch (err) {
			console.error('Failed to save secret:', err);
		} finally {
			secretSaving = false;
		}
	}

	async function removeSecret(id: string) {
		try {
			await automationsStore.deleteSecret(id);
		} catch (err) {
			console.error('Failed to remove secret:', err);
		}
	}
</script>

<div class="automation-detail-container">
	<!-- Testata dettaglio con azioni -->
	<div class="detail-header">
		<div class="title-and-status">
			<div class="status-badge-row">
				<span class="state-pill state-{definition.state}">
					{t(`state_${definition.state}` as any) || definition.state}
				</span>
				<span class="action-kind-pill">
					{#if definition.action.kind === 'prompt'}
						<IconTerminal /> Prompt AI
					{:else}
						<IconFileCode /> Comando ({definition.action.mode})
					{/if}
				</span>
				<span class="revision-pill font-mono">Rev. {definition.revision}</span>
			</div>
			<h2 class="def-title">{definition.name || 'Automazione senza nome'}</h2>
			{#if definition.description}
				<p class="def-description">{definition.description}</p>
			{/if}
			<div class="next-run-banner text-xs">
				<IconSchedule />
				{#if nextRunMs}
					<span>{t('detail_next_run', { time: formatDateTime(nextRunMs) })}</span>
				{:else}
					<span>{t('detail_no_next_run')}</span>
				{/if}
			</div>
		</div>

		<!-- Azioni principali sulla regola -->
		<div class="header-action-buttons">
			<button
				type="button"
				class="ui-button ui-button-primary text-xs"
				onclick={handleRunNow}
				disabled={isRunningNow || definition.state === 'archived'}
				title="Avvia un'occorrenza manuale con gli stessi controlli e target"
			>
				<IconPlay />
				<span>{t('detail_action_run_now')}</span>
			</button>

			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={() => automationsStore.edit(definition)}
				title="Apri una bozza di modifica (la versione attiva resta invariata fino a conferma)"
			>
				<IconPencil />
				<span>{t('detail_action_edit')}</span>
			</button>

			{#if definition.state === 'enabled'}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleToggleState}
					title="Disattiva programmazioni future senza annullare esecuzioni in corso"
				>
					<IconPause />
					<span>{t('detail_action_disable')}</span>
				</button>
			{:else if definition.state === 'disabled' || definition.state === 'suspended'}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleToggleState}
					title="Riattiva la regola"
				>
					<IconPlay />
					<span>{t('detail_action_enable')}</span>
				</button>
			{/if}

			{#if definition.state !== 'archived'}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleArchive}
					title="Archivia la regola (disattivata e conservata)"
				>
					<span>{t('detail_action_archive')}</span>
				</button>
			{/if}

			<button
				type="button"
				class="ui-button ui-button-danger text-xs"
				onclick={() => { showDeleteDialog = true; }}
				title="Elimina definitivamente la regola"
			>
				<IconTrash />
				<span>{t('detail_action_delete')}</span>
			</button>
		</div>
	</div>

	<!-- Schede di navigazione interna -->
	<div class="tabs-nav">
		<button
			type="button"
			class="tab-btn"
			class:active={activeDetailTab === 'config'}
			onclick={() => { activeDetailTab = 'config'; }}
		>
			<IconRule />
			<span>{t('detail_tab_config')}</span>
		</button>
		<button
			type="button"
			class="tab-btn"
			class:active={activeDetailTab === 'history'}
			onclick={() => { activeDetailTab = 'history'; }}
		>
			<IconSchedule />
			<span>{t('detail_tab_history')}</span>
		</button>
		{#if definition.action.kind === 'command'}
			<button
				type="button"
				class="tab-btn"
				class:active={activeDetailTab === 'secrets'}
				onclick={() => { activeDetailTab = 'secrets'; }}
			>
				<IconKey />
				<span>{t('detail_tab_vault')}</span>
			</button>
		{/if}
	</div>

	<!-- Contenuto tab -->
	<div class="tab-content">
		{#if activeDetailTab === 'config'}
			<div class="config-sections">
				<!-- Azione -->
				<section class="info-card">
					<h4 class="card-title">Azione da eseguire</h4>
					{#if definition.action.kind === 'prompt'}
						<div class="field-item">
							<span class="field-label">Istruzioni Prompt:</span>
							<pre class="prompt-box">{definition.action.prompt}</pre>
						</div>
						<div class="field-grid text-xs">
							<div>
								<span class="field-label">Modello / Ruolo:</span>
								<span class="field-value font-mono">{definition.action.modelMode === 'role' ? `Ruolo "${definition.action.model}"` : definition.action.model}</span>
							</div>
							<div>
								<span class="field-label">Consumo Pay-as-you-go:</span>
								<span class="field-value">{definition.action.allowPayAsYouGo ? 'Consentito' : 'Vietato (solo abbonamenti)'}</span>
							</div>
							{#if definition.action.maxCostUsd}
								<div>
									<span class="field-label">Tetto costo:</span>
									<span class="field-value font-mono">${definition.action.maxCostUsd} USD</span>
								</div>
							{/if}
						</div>
					{:else}
						<div class="field-item">
							<span class="field-label">Comando:</span>
							<code class="code-box">{definition.action.command || '—'}</code>
						</div>
						{#if definition.action.args && definition.action.args.length > 0}
							<div class="field-item">
								<span class="field-label">Argomenti:</span>
								<div class="tags-row">
									{#each definition.action.args as arg}
										<span class="tag-pill font-mono">{arg}</span>
									{/each}
								</div>
							</div>
						{/if}
						<div class="field-grid text-xs">
							<div>
								<span class="field-label">Interprete:</span>
								<span class="field-value font-mono">{definition.action.interpreter || 'cmd.exe / /bin/sh'}</span>
							</div>
							<div>
								<span class="field-label">Piattaforme:</span>
								<span class="field-value">{definition.action.platforms.join(', ')}</span>
							</div>
							<div>
								<span class="field-label">Politica script:</span>
								<span class="field-value">{definition.action.scriptPolicy === 'review' ? 'Richiedi approvazione a ogni modifica' : 'Segui file (follow)'}</span>
							</div>
						</div>
					{/if}
				</section>

				<!-- Destinatari -->
				<section class="info-card">
					<h4 class="card-title">Destinatari e cartella di lavoro</h4>
					<div class="field-grid text-xs">
						<div>
							<span class="field-label">Origine:</span>
							<span class="field-value">{definition.targets.source}</span>
						</div>
						<div>
							<span class="field-label">Modalità esecuzione:</span>
							<span class="field-value">{definition.targets.mode === 'each' ? 'Per ciascun destinatario' : 'Unica sull’insieme'}</span>
						</div>
						<div>
							<span class="field-label">Cartella CWD:</span>
							<span class="field-value font-mono">{definition.targets.cwd || 'Radice del progetto'}</span>
						</div>
					</div>
					{#if definition.targets.projectPaths && definition.targets.projectPaths.length > 0}
						<div class="field-item text-xs">
							<span class="field-label">Progetti inclusi:</span>
							<div class="tags-row">
								{#each definition.targets.projectPaths as p}
									<span class="tag-pill font-mono">{p}</span>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				<!-- Trigger e pianificazioni -->
				<section class="info-card">
					<h4 class="card-title">Programmazione ed eventi ({definition.triggers.length})</h4>
					<div class="triggers-list">
						{#each definition.triggers as trig}
							<div class="trigger-row text-xs">
								<span class="trigger-kind font-semibold">{t(`trigger_${trig.kind}` as any) || trig.kind}</span>
								{#if trig.time}
									<span class="trigger-detail">Orario: {trig.time}</span>
								{/if}
								{#if trig.weekdays && trig.weekdays.length > 0}
									<span class="trigger-detail">Giorni: {trig.weekdays.map(d => t(`weekday_${['sun','mon','tue','wed','thu','fri','sat'][d]}` as any)).join(', ')}</span>
								{/if}
								{#if trig.intervalMinutes}
									<span class="trigger-detail">Ogni {formatDuration(trig.intervalMinutes)}</span>
								{/if}
								{#if trig.includePatterns && trig.includePatterns.length > 0}
									<span class="trigger-detail font-mono">in: {trig.includePatterns.join(', ')}</span>
								{/if}
								{#if trig.branches && trig.branches.length > 0}
									<span class="trigger-detail font-mono">branch: {trig.branches.join(', ')}</span>
								{/if}
							</div>
						{/each}
					</div>
					<div class="field-item text-xs" style="margin-top: 8px;">
						<span class="field-label">Fuso orario configurato:</span>
						<span class="field-value font-mono">{definition.policy.timezone}</span>
					</div>
				</section>

				<!-- Politiche operative (Policy) -->
				<section class="info-card">
					<h4 class="card-title">Condizioni e limiti (Policy)</h4>
					<div class="field-grid text-xs">
						<div>
							<span class="field-label">Timeout esecuzione:</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.timeoutMinutes)}</span>
						</div>
						<div>
							<span class="field-label">Attesa se occupato:</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.maxWaitMinutes)}</span>
						</div>
						<div>
							<span class="field-label">Attesa risposta umana:</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.humanWaitMinutes)}</span>
						</div>
						<div>
							<span class="field-label">Scadenze perse:</span>
							<span class="field-value">{definition.policy.missed === 'notify' ? 'Segnala senza avviare' : definition.policy.missed === 'recover' ? `Recupera (max ${definition.policy.recoveryMinutes}m)` : 'Ignora'}</span>
						</div>
						<div>
							<span class="field-label">Sovrapposizioni:</span>
							<span class="field-value">{definition.policy.overlap === 'coalesce' ? 'Raggruppa successiva (coalesce)' : 'Salta (skip)'}</span>
						</div>
						<div>
							<span class="field-label">Riserva quote personali:</span>
							<span class="field-value font-mono">{definition.policy.quota.shortPct}% breve / {definition.policy.quota.weeklyPct}% sett.</span>
						</div>
					</div>
				</section>
			</div>
		{:else if activeDetailTab === 'history'}
			<AutomationHistory
				automationId={definition.id}
				{selectedRunId}
				{onSelectRun}
				{onOpenSession}
			/>
		{:else if activeDetailTab === 'secrets'}
			<div class="secrets-management-panel">
				<p class="secrets-intro text-xs">
					I riferimenti a segreti consentono ai comandi di accedere a chiavi private o token conservati nel portachiavi nativo del sistema operativo (Windows Credential Manager / macOS Keychain / Linux Secret Service). I valori non vengono mai inclusi nelle definizioni o negli export.
				</p>

				{#if secretRefsEntries.length > 0}
					<div class="vault-list">
						<h5 class="vault-heading text-xs">Segreti referenziati da questa automazione</h5>
						{#each secretRefsEntries as [envName, vaultId]}
							<div class="vault-row">
								<div class="vault-info font-mono text-xs">
									<span class="env-name">{envName}</span>
									<span class="arrow">→</span>
									<span class="vault-id">vault://{vaultId}</span>
								</div>
								<button
									type="button"
									class="ui-button ui-button-ghost action-xs"
									onclick={() => removeSecret(vaultId)}
									title="Rimuovi dal portachiavi di sistema"
								>
									<IconTrash />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Aggiungi / Aggiorna valore nel vault -->
				<div class="add-secret-box">
					<h5 class="vault-heading text-xs">Registra o aggiorna un segreto nel Vault di sistema</h5>
					<div class="secret-inputs">
						<input
							type="text"
							class="ui-input text-xs font-mono"
							placeholder="ID segreto (es. GITHUB_TOKEN)"
							bind:value={newSecretKey}
						/>
						<input
							type="password"
							class="ui-input text-xs font-mono"
							placeholder="Valore segreto"
							bind:value={newSecretValue}
						/>
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={saveSecret}
							disabled={secretSaving || !newSecretKey.trim() || !newSecretValue}
						>
							<IconLock />
							<span>Salva nel Vault</span>
						</button>
					</div>
					{#if secretSuccessMsg}
						<div class="secret-success text-xs">
							<IconCheck />
							<span>{secretSuccessMsg}</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Modal di conferma eliminazione -->
{#if showDeleteDialog}
	<ConfirmDialog
		title={t('detail_delete_confirm_title')}
		message={t('detail_delete_confirm_message', { name: definition.name })}
		confirmLabel={t('detail_action_delete')}
		cancelLabel={t('btn_cancel')}
		tone="danger"
		onConfirm={confirmDelete}
		onCancel={() => { showDeleteDialog = false; }}
	>
		<div class="delete-options-row">
			<label class="checkbox-label text-xs">
				<input type="checkbox" bind:checked={deleteHistory} />
				<span>{t('detail_delete_all')}</span>
			</label>
		</div>
	</ConfirmDialog>
{/if}

<style>
	.automation-detail-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		padding: 20px;
		gap: 16px;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--line);
	}

	.title-and-status {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
	}

	.status-badge-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.state-pill {
		display: inline-flex;
		align-items: center;
		padding: 3px 8px;
		border-radius: var(--radius-full);
		font-size: 11px;
		font-weight: 600;
	}

	.state-pill.state-enabled { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
	.state-pill.state-disabled { background: color-mix(in srgb, var(--ink-faint) 15%, transparent); color: var(--ink-faint); }
	.state-pill.state-suspended { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
	.state-pill.state-draft { background: color-mix(in srgb, var(--brand) 18%, transparent); color: var(--brand-ink); }
	.state-pill.state-archived { background: color-mix(in srgb, var(--ink-faint) 20%, transparent); color: var(--ink-faint); }

	.action-kind-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--ink-muted);
		background: var(--bg-sunken);
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.revision-pill {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.def-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.def-description {
		margin: 0;
		font-size: 13px;
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.next-run-banner {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
		margin-top: 4px;
	}

	.header-action-buttons {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		flex-shrink: 0;
	}

	.tabs-nav {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--line);
	}

	.tab-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 500;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: all var(--dur-fast, 120ms) ease;
	}

	.tab-btn:hover {
		color: var(--ink);
	}

	.tab-btn.active {
		color: var(--brand-ink);
		border-bottom-color: var(--brand);
	}

	.tab-content {
		flex: 1;
	}

	.config-sections {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.info-card {
		padding: 14px 16px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-raised);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.card-title {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	.field-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field-label {
		color: var(--ink-muted);
		font-size: 12px;
	}

	.field-value {
		color: var(--ink);
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 10px 16px;
	}

	.prompt-box {
		margin: 0;
		padding: 10px 12px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: 13px;
		line-height: 1.5;
		white-space: pre-wrap;
		color: var(--ink);
		font-family: inherit;
	}

	.code-box {
		padding: 8px 12px;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: 13px;
		color: var(--ink);
	}

	.tags-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-pill {
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink);
	}

	.triggers-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.trigger-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.trigger-kind {
		color: var(--ink);
	}

	.trigger-detail {
		color: var(--ink-muted);
	}

	.secrets-management-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: var(--bg-raised);
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
	}

	.secrets-intro {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.5;
	}

	.vault-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.vault-heading {
		margin: 0;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--ink-muted);
	}

	.vault-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
	}

	.vault-info {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.env-name {
		font-weight: 600;
		color: var(--brand-ink);
	}

	.vault-id {
		color: var(--ink-muted);
	}

	.add-secret-box {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}

	.secret-inputs {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.secret-inputs input {
		flex: 1;
		min-width: 180px;
	}

	.secret-success {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--success);
	}

	.delete-options-row {
		margin-top: 12px;
	}

	.checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		user-select: none;
		color: var(--ink);
	}
</style>
