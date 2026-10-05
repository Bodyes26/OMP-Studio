<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import { untrack } from 'svelte';
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelFinding,
		type ModelFixItem
	} from '$lib/stores/modelSettings.svelte';
	import { IconArrowRight, IconWarning } from '$lib/icons';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let selectedKeys = $state<string[]>([]);

	function getFindingKey(f: ModelFinding): string {
		return `${f.role}:${f.kind}:${f.index ?? 'p'}:${f.code}:${f.currentSelector}`;
	}

	function isActionable(finding: ModelFinding): boolean {
		return Boolean(finding.suggestedSelector) || finding.kind === 'fallback';
	}

	function createFixItem(finding: ModelFinding): ModelFixItem | null {
		if (finding.suggestedSelector) {
			return {
				role: finding.role,
				kind: finding.kind,
				index: finding.index ?? null,
				action: 'replace',
				newSelector: finding.suggestedSelector
			};
		}
		if (finding.kind === 'fallback') {
			return {
				role: finding.role,
				kind: finding.kind,
				index: finding.index ?? null,
				action: 'remove',
				newSelector: null
			};
		}
		return null;
	}

	const allActionableFindings = $derived(
		[
			...(modelSettingsStore.blockingFindings ?? []),
			...(modelSettingsStore.upgradeFindings ?? [])
		].filter(isActionable)
	);

	const allSelected = $derived(
		allActionableFindings.length > 0 && selectedKeys.length === allActionableFindings.length
	);

	const someSelected = $derived(
		selectedKeys.length > 0 && selectedKeys.length < allActionableFindings.length
	);

	$effect(() => {
		if (modelSettingsStore.healthModalOpen) {
			// Seleziona tutti i finding correggibili per default solo all'apertura del modale
			const actionable = untrack(() => [
				...(modelSettingsStore.blockingFindings ?? []),
				...(modelSettingsStore.upgradeFindings ?? [])
			]).filter(isActionable);
			selectedKeys = actionable.map(getFindingKey);
		}
	});

	function toggleSelect(key: string) {
		if (selectedKeys.includes(key)) {
			selectedKeys = selectedKeys.filter((k) => k !== key);
		} else {
			selectedKeys = [...selectedKeys, key];
		}
	}

	function toggleSelectAll() {
		if (allSelected) {
			selectedKeys = [];
		} else {
			selectedKeys = allActionableFindings.map(getFindingKey);
		}
	}

	async function handleApply() {
		const chosenFixes: ModelFixItem[] = [];
		for (const f of allActionableFindings) {
			if (selectedKeys.includes(getFindingKey(f))) {
				const fix = createFixItem(f);
				if (fix) chosenFixes.push(fix);
			}
		}
		if (chosenFixes.length === 0) return;
		await modelSettingsStore.applyFixes(chosenFixes);
	}

	async function handleDismiss() {
		await modelSettingsStore.dismissHealthFindings();
		modelSettingsStore.healthModalOpen = false;
	}

	function handleClose() {
		modelSettingsStore.healthModalOpen = false;
	}

	function getRoleMeta(roleId: string) {
		return (
			STANDARD_ROLES.find((r) => r.id === roleId) || {
				id: roleId,
				label: roleId,
				abbr: roleId.slice(0, 2).toUpperCase(),
				desc: ''
			}
		);
	}

	function getSlotLabel(kind: string, index: number | null): string {
		if (kind === 'primary') return m.model_health_slot_primary();
		const n = (index ?? 0) + 1;
		return m.model_health_slot_fallback({ n });
	}

	function formatCheckDate(ts: number): string {
		return i18n.formatDate(ts, {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatCatalogAge(days: number): string {
		if (days < 0.1) return i18n.formatRelativeTime(-2, 'hour');
		if (days < 1) return i18n.formatRelativeTime(-Math.round(days * 24), 'hour');
		return i18n.formatRelativeTime(-Math.round(days), 'day');
	}
</script>

<Dialog
	open={modelSettingsStore.healthModalOpen}
	title={m.model_health_modal_title()}
	onClose={handleClose}
	class="health-dialog-modal"
>
	<div class="health-meta-header">
		{#if modelSettingsStore.healthReport}
			<p>
				{m.ui_modelhealthmodal_ultima_verifica_aab9()} {formatCheckDate(modelSettingsStore.healthReport.checkedAt)}
				{#if modelSettingsStore.healthReport.catalogAgeDays != null}
					· {m.model_health_catalog_updated({ age: formatCatalogAge(modelSettingsStore.healthReport.catalogAgeDays) })}
				{/if}
			</p>
		{:else}
			<p>{m.model_health_report_desc()}</p>
		{/if}
	</div>

	{#if modelSettingsStore.healthReport?.catalogError}
		<AlertBanner
			variant="warning"
			title={m.models_health_incomplete_title()}
			message={m.model_health_remote_catalog_error({ error: modelSettingsStore.healthReport.catalogError })}
		/>
	{/if}

	{#if allActionableFindings.length > 0}
		<div class="selection-bar">
			<label class="select-all-label">
				<input
					type="checkbox"
					class="ui-checkbox"
					checked={allSelected}
					indeterminate={someSelected}
					onchange={toggleSelectAll}
				/>
				<span>{m.model_health_select_all({ selected: selectedKeys.length, total: allActionableFindings.length })}</span>
			</label>
		</div>
	{/if}

	{#if modelSettingsStore.blockingFindings && modelSettingsStore.blockingFindings.length > 0}
		<div class="findings-group">
			<h4 class="group-title blocking">
				<span class="group-dot blocking"></span>
				<span>{m.model_health_group_blocking()}</span>
				<span class="group-count">({modelSettingsStore.blockingFindings.length})</span>
			</h4>
			<div class="candidates-list">
				{#each modelSettingsStore.blockingFindings as finding (getFindingKey(finding))}
					{@const roleMeta = getRoleMeta(finding.role)}
					{@const slotLabel = getSlotLabel(finding.kind, finding.index)}
					{@const key = getFindingKey(finding)}
					{@const actionable = isActionable(finding)}
					{@const isSelected = selectedKeys.includes(key)}

					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="candidate-card blocking-card"
						class:selected={isSelected}
						class:non-actionable={!actionable}
						onclick={() => {
							if (actionable) toggleSelect(key);
						}}
					>
						<div class="card-left">
							{#if actionable}
								<input
									type="checkbox"
									class="ui-checkbox"
									checked={isSelected}
									aria-label={m.model_health_select_fix_aria({ role: roleMeta.label, slot: slotLabel })}
									onclick={(e) => e.stopPropagation()}
									onchange={() => toggleSelect(key)}
								/>
							{:else}
								<Tooltip text={m.model_health_manual_config_required()}>
									<span class="no-action-indicator" aria-hidden="true">
										<IconWarning />
									</span>
								</Tooltip>
							{/if}
						</div>

						<div class="card-content">
							<div class="role-badge-row">
								<span class="role-abbr-badge">{roleMeta.abbr}</span>
								<span class="role-name">{roleMeta.label}</span>
								<span class="blocking-warn-icon" aria-hidden="true">
									<IconWarning />
								</span>
								<span class="slot-badge" class:fallback={finding.kind === 'fallback'}>{slotLabel}</span>
								<span class="provider-tag">{finding.currentProvider}</span>
								<span
									class="action-tag"
									class:replace={Boolean(finding.suggestedSelector)}
									class:remove={!finding.suggestedSelector && finding.kind === 'fallback'}
									class:manual={!actionable}
								>
									{#if finding.suggestedSelector}
										{m.model_health_action_replace()}
									{:else if finding.kind === 'fallback'}
										{m.ui_modelhealthmodal_rimuovi_riserva_447f()}
									{:else}
										{m.model_health_action_manual()}
									{/if}
								</span>
							</div>

							{#if finding.suggestedSelector}
								<div class="diff-row">
									<div class="model-box old">
										<span class="box-label">{m.model_health_box_current()}</span>
										<span class="box-val">{finding.currentModelId}</span>
										{#if finding.currentThinking}
											<span class="thinking-tag">:{finding.currentThinking}</span>
										{/if}
									</div>

									<span class="diff-arrow"><IconArrowRight /></span>

									<div class="model-box new">
										<span class="box-label">{m.model_health_box_suggested()}</span>
										<span class="box-val">{finding.suggestedModelName || finding.suggestedSelector}</span>
										{#if finding.currentThinking}
											<span class="thinking-tag">:{finding.currentThinking}</span>
										{/if}
									</div>
								</div>
							{:else if finding.kind === 'fallback'}
								<div class="diff-row single">
									<div class="model-box old remove-target">
										<span class="box-label">{m.model_health_box_remove_target()}</span>
										<span class="box-val">{finding.currentSelector}</span>
									</div>
								</div>
							{:else}
								<div class="diff-row single">
									<div class="model-box old invalid-target">
										<span class="box-label">{m.ui_modelhealthmodal_modello_attuale_non_valido_10a2()}</span>
										<span class="box-val">{finding.currentSelector}</span>
									</div>
								</div>
							{/if}

							<div class="reason-note">
								<span class="reason-text">{finding.reason}</span>
								{#if !actionable && finding.kind === 'primary'}
									<span class="manual-hint">{m.ui_modelhealthmodal_scegli_un_modello_attivo_nella_scheda_ruoli_9727()}</span>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if modelSettingsStore.upgradeFindings && modelSettingsStore.upgradeFindings.length > 0}
		<div class="findings-group">
			<h4 class="group-title upgrade">
				<span class="group-dot upgrade"></span>
				<span>{m.model_health_group_upgrades()}</span>
				<span class="group-count">({modelSettingsStore.upgradeFindings.length})</span>
			</h4>
			<div class="candidates-list">
				{#each modelSettingsStore.upgradeFindings as finding (getFindingKey(finding))}
					{@const roleMeta = getRoleMeta(finding.role)}
					{@const slotLabel = getSlotLabel(finding.kind, finding.index)}
					{@const key = getFindingKey(finding)}
					{@const actionable = isActionable(finding)}
					{@const isSelected = selectedKeys.includes(key)}

					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="candidate-card"
						class:selected={isSelected}
						class:non-actionable={!actionable}
						onclick={() => {
							if (actionable) toggleSelect(key);
						}}
					>
						<div class="card-left">
							{#if actionable}
								<input
									type="checkbox"
									class="ui-checkbox"
									checked={isSelected}
									aria-label={m.model_health_select_upgrade_aria({ role: roleMeta.label, slot: slotLabel })}
									onclick={(e) => e.stopPropagation()}
									onchange={() => toggleSelect(key)}
								/>
							{/if}
						</div>

						<div class="card-content">
							<div class="role-badge-row">
								<span class="role-abbr-badge">{roleMeta.abbr}</span>
								<span class="role-name">{roleMeta.label}</span>
								<span class="slot-badge" class:fallback={finding.kind === 'fallback'}>{slotLabel}</span>
								<span class="provider-tag">{finding.currentProvider}</span>
								<span class="action-tag replace">{m.model_health_action_upgrade()}</span>
							</div>

							<div class="diff-row">
								<div class="model-box old">
									<span class="box-label">{m.model_health_box_current()}</span>
									<span class="box-val">{finding.currentModelId}</span>
									{#if finding.currentThinking}
										<span class="thinking-tag">:{finding.currentThinking}</span>
									{/if}
								</div>

								<span class="diff-arrow"><IconArrowRight /></span>

								<div class="model-box new">
									<span class="box-label">{m.model_health_box_suggested()}</span>
									<span class="box-val">{finding.suggestedModelName || finding.suggestedSelector}</span>
									{#if finding.currentThinking}
										<span class="thinking-tag">:{finding.currentThinking}</span>
									{/if}
								</div>
							</div>

							{#if finding.reason}
								<div class="reason-note">
									<span class="reason-text">{finding.reason}</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if (!modelSettingsStore.blockingFindings || modelSettingsStore.blockingFindings.length === 0) && (!modelSettingsStore.upgradeFindings || modelSettingsStore.upgradeFindings.length === 0)}
		<div class="empty-state">
			<p>{m.model_health_no_issues()}</p>
		</div>
	{/if}

	{#snippet footer()}
		<div class="footer-hint">
			{m.model_health_reasoning_preserved_hint()}
		</div>
		<div class="footer-actions">
			<button type="button" class="ui-button ui-button-secondary" onclick={handleClose}>{m.common_cancel()}</button>
			<Tooltip text={m.ui_modelhealthmodal_nasconde_gli_avvisi_fino_alla_prossima_verifica_3dbb()}>
				<button
					type="button"
					class="ui-button ui-button-secondary"
					disabled={modelSettingsStore.saving}
					onclick={handleDismiss}
				>
					{m.models_health_dismiss_btn()}
				</button>
			</Tooltip>
			<button
				type="button"
				class="ui-button ui-button-primary"
				disabled={selectedKeys.length === 0 || modelSettingsStore.saving}
				onclick={handleApply}
			>
				{#if modelSettingsStore.saving}
					{m.model_health_applying()}
				{:else if selectedKeys.length === 1}
					{m.model_health_apply_single_fix()}
				{:else}
					{m.model_health_apply_fixes({ count: selectedKeys.length })}
				{/if}
			</button>
		</div>
	{/snippet}
</Dialog>

<style>
	:global(.health-dialog-modal) {
		max-width: min(680px, 94vw);
	}

	.health-meta-header {
		padding-bottom: var(--space-1);
	}

	.health-meta-header p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
	}

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 2px;
	}

	.select-all-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		cursor: pointer;
		user-select: none;
	}

	.findings-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.group-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: var(--text-label);
		font-weight: 600;
	}

	.group-title.blocking {
		color: var(--warn);
	}

	.group-title.upgrade {
		color: var(--brand-ink);
	}

	.group-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.group-dot.blocking {
		background: var(--warn);
	}

	.group-dot.upgrade {
		background: var(--brand);
	}

	.group-count {
		font-weight: 500;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.candidates-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.candidate-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.candidate-card:hover {
		border-color: var(--line-strong);
	}

	.candidate-card.selected {
		border-color: var(--brand);
		background: var(--bg-base);
	}

	.candidate-card.blocking-card {
		border: 1px solid var(--line);
	}

	.candidate-card.non-actionable {
		cursor: default;
	}

	.card-left {
		padding-top: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.no-action-indicator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--warn);
		--icon-size: 14px;
	}

	.card-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.role-badge-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.role-abbr-badge {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.role-name {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.blocking-warn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--warn);
		--icon-size: 14px;
	}

	.slot-badge {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.slot-badge.fallback {
		color: var(--ink-faint);
	}

	.provider-tag {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.action-tag {
		font-size: var(--text-caption);
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-md);
		margin-left: auto;
	}

	.action-tag.replace {
		background: color-mix(in oklab, var(--brand) 12%, transparent);
		color: var(--brand-ink);
		border: 1px solid color-mix(in oklab, var(--brand) 25%, transparent);
	}

	.action-tag.remove {
		background: color-mix(in oklab, var(--warn) 12%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in oklab, var(--warn) 25%, transparent);
	}

	.action-tag.manual {
		background: color-mix(in oklab, var(--danger) 12%, transparent);
		color: var(--danger);
		border: 1px solid color-mix(in oklab, var(--danger) 25%, transparent);
	}

	.diff-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.model-box {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 4px 8px;
		border-radius: var(--radius-md);
		background: var(--bg-base);
		border: 1px solid var(--line);
		min-width: 0;
	}

	.model-box.new {
		border-color: var(--brand-dim);
	}

	.model-box.remove-target {
		border-color: color-mix(in oklab, var(--warn) 35%, transparent);
		background: color-mix(in oklab, var(--warn) 6%, var(--bg-base));
	}

	.model-box.invalid-target {
		border-color: color-mix(in oklab, var(--danger) 35%, transparent);
		background: color-mix(in oklab, var(--danger) 6%, var(--bg-base));
	}

	.box-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.box-val {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-box.new .box-val {
		color: var(--brand-ink);
		font-weight: 600;
	}

	.thinking-tag {
		color: var(--ink-faint);
		font-size: var(--text-caption);
	}

	.diff-arrow {
		color: var(--ink-faint);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		--icon-size: 14px;
	}

	.reason-note {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.manual-hint {
		color: var(--warn);
		font-weight: 500;
	}

	.empty-state {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.footer-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin-right: auto;
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}
</style>
