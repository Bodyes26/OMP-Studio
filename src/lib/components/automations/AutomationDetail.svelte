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
			secretSuccessMsg = t('detail_secret_saved');
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
						<IconTerminal /> {t('view_action_kind_prompt')}
					{:else}
						<IconFileCode /> {t('detail_command_with_mode', { mode: definition.action.mode })}
					{/if}
				</span>
				<span class="revision-pill font-mono">{t('occ_revision_short', { rev: definition.revision })}</span>
			</div>
			<h2 class="def-title">{definition.name || t('automation_untitled')}</h2>
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
				title={t('detail_title_run_now')}
			>
				<IconPlay />
				<span>{t('detail_action_run_now')}</span>
			</button>

			<button
				type="button"
				class="ui-button ui-button-secondary text-xs"
				onclick={() => automationsStore.edit(definition)}
				title={t('detail_title_edit')}
			>
				<IconPencil />
				<span>{t('detail_action_edit')}</span>
			</button>

			{#if definition.state === 'enabled'}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleToggleState}
					title={t('detail_title_disable')}
				>
					<IconPause />
					<span>{t('detail_action_disable')}</span>
				</button>
			{:else if definition.state === 'disabled' || definition.state === 'suspended'}
				<button
					type="button"
					class="ui-button ui-button-secondary text-xs"
					onclick={handleToggleState}
					title={t('detail_title_enable')}
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
					title={t('detail_title_archive')}
				>
					<span>{t('detail_action_archive')}</span>
				</button>
			{/if}

			<button
				type="button"
				class="ui-button ui-button-danger text-xs"
				onclick={() => { showDeleteDialog = true; }}
				title={t('detail_title_delete')}
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
					<h4 class="card-title">{t('detail_section_action')}</h4>
					{#if definition.action.kind === 'prompt'}
						<div class="field-item">
							<span class="field-label">{t('detail_field_prompt')}</span>
							<pre class="prompt-box">{definition.action.prompt}</pre>
						</div>
						<div class="field-grid text-xs">
							<div>
								<span class="field-label">{t('detail_field_model_role')}</span>
								<span class="field-value font-mono">{definition.action.modelMode === 'role' ? t('detail_role_value', { model: definition.action.model }) : definition.action.model}</span>
							</div>
							<div>
								<span class="field-label">{t('detail_field_payg')}</span>
								<span class="field-value">{definition.action.allowPayAsYouGo ? t('detail_payg_allowed') : t('detail_payg_denied')}</span>
							</div>
							{#if definition.action.maxCostUsd}
								<div>
									<span class="field-label">{t('detail_field_max_cost')}</span>
									<span class="field-value font-mono">${definition.action.maxCostUsd} USD</span>
								</div>
							{/if}
						</div>
					{:else}
						<div class="field-item">
							<span class="field-label">{t('detail_field_command')}</span>
							<code class="code-box">{definition.action.command || '—'}</code>
						</div>
						{#if definition.action.args && definition.action.args.length > 0}
							<div class="field-item">
								<span class="field-label">{t('detail_field_args')}</span>
								<div class="tags-row">
									{#each definition.action.args as arg}
										<span class="tag-pill font-mono">{arg}</span>
									{/each}
								</div>
							</div>
						{/if}
						<div class="field-grid text-xs">
							<div>
								<span class="field-label">{t('detail_field_interpreter')}</span>
								<span class="field-value font-mono">{definition.action.interpreter || 'cmd.exe / /bin/sh'}</span>
							</div>
							<div>
								<span class="field-label">{t('detail_field_platforms')}</span>
								<span class="field-value">{definition.action.platforms.map((p) => t(`platform_${p}` as any)).join(', ')}</span>
							</div>
							<div>
								<span class="field-label">{t('detail_field_script_policy')}</span>
								<span class="field-value">{definition.action.scriptPolicy === 'review' ? t('script_policy_review') : t('script_policy_follow')}</span>
							</div>
						</div>
					{/if}
				</section>

				<!-- Destinatari -->
				<section class="info-card">
					<h4 class="card-title">{t('detail_section_targets')}</h4>
					<div class="field-grid text-xs">
						<div>
							<span class="field-label">{t('detail_field_source')}</span>
							<span class="field-value">{t(`targets_source_${definition.targets.source}` as any)}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_mode')}</span>
							<span class="field-value">{definition.targets.mode === 'each' ? t('targets_mode_each') : t('targets_mode_aggregate')}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_cwd')}</span>
							<span class="field-value font-mono">{definition.targets.cwd || t('detail_cwd_project_root')}</span>
						</div>
					</div>
					{#if definition.targets.projectPaths && definition.targets.projectPaths.length > 0}
						<div class="field-item text-xs">
							<span class="field-label">{t('detail_field_included_projects')}</span>
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
					<h4 class="card-title">{t('detail_section_triggers', { count: definition.triggers.length })}</h4>
					<div class="triggers-list">
						{#each definition.triggers as trig}
							<div class="trigger-row text-xs">
								<span class="trigger-kind font-semibold">{t(`trigger_${trig.kind}` as any) || trig.kind}</span>
								{#if trig.time}
									<span class="trigger-detail">{t('detail_trigger_time', { time: trig.time })}</span>
								{/if}
								{#if trig.weekdays && trig.weekdays.length > 0}
									<span class="trigger-detail">{t('detail_trigger_days', { days: trig.weekdays.map(d => t(`weekday_${['sun','mon','tue','wed','thu','fri','sat'][d]}` as any)).join(', ') })}</span>
								{/if}
								{#if trig.intervalMinutes}
									<span class="trigger-detail">{t('detail_trigger_every', { duration: formatDuration(trig.intervalMinutes) })}</span>
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
						<span class="field-label">{t('detail_field_timezone')}</span>
						<span class="field-value font-mono">{definition.policy.timezone}</span>
					</div>
				</section>

				<!-- Politiche operative (Policy) -->
				<section class="info-card">
					<h4 class="card-title">{t('detail_section_policy')}</h4>
					<div class="field-grid text-xs">
						<div>
							<span class="field-label">{t('detail_field_timeout')}</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.timeoutMinutes)}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_max_wait')}</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.maxWaitMinutes)}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_human_wait')}</span>
							<span class="field-value font-mono">{formatDuration(definition.policy.humanWaitMinutes)}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_missed')}</span>
							<span class="field-value">{definition.policy.missed === 'notify' ? t('detail_missed_notify') : definition.policy.missed === 'recover' ? t('detail_missed_recover', { minutes: definition.policy.recoveryMinutes }) : t('detail_missed_ignore')}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_overlap')}</span>
							<span class="field-value">{definition.policy.overlap === 'coalesce' ? t('detail_overlap_coalesce') : t('detail_overlap_skip')}</span>
						</div>
						<div>
							<span class="field-label">{t('detail_field_quota')}</span>
							<span class="field-value font-mono">{t('detail_quota_value', { short: definition.policy.quota.shortPct, weekly: definition.policy.quota.weeklyPct })}</span>
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
					{t('detail_secrets_intro')}
				</p>

				{#if secretRefsEntries.length > 0}
					<div class="vault-list">
						<h5 class="vault-heading text-xs">{t('detail_secrets_list_heading')}</h5>
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
									title={t('detail_secret_remove_title')}
								>
									<IconTrash />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Aggiungi / Aggiorna valore nel vault -->
				<div class="add-secret-box">
					<h5 class="vault-heading text-xs">{t('detail_secrets_add_heading')}</h5>
					<div class="secret-inputs">
						<input
							type="text"
							class="ui-input text-xs font-mono"
							placeholder={t('detail_secret_key_placeholder')}
							bind:value={newSecretKey}
						/>
						<input
							type="password"
							class="ui-input text-xs font-mono"
							placeholder={t('detail_secret_value_placeholder')}
							bind:value={newSecretValue}
						/>
						<button
							type="button"
							class="ui-button ui-button-secondary text-xs"
							onclick={saveSecret}
							disabled={secretSaving || !newSecretKey.trim() || !newSecretValue}
						>
							<IconLock />
							<span>{t('detail_secret_save')}</span>
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
