<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { m } from '#lib/paraglide/messages.js';
	import {
		modelSettingsStore,
		resolveCatalogModel,
		splitModelSelector
	} from '#lib/stores/modelSettings.svelte.ts';
	import { IconWarning, IconCheck } from '#lib/icons.ts';

	interface SubagentModelSettings {
		perCallModel: 'off' | 'eval' | 'on';
		perCallModelAllow: string[];
		maxEffort: string;
	}

	interface ApprovedModelItem {
		selector: string;
		name: string;
		roles: string[];
	}

	let loading = $state(true);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);

	let perCallModel = $state<'off' | 'eval' | 'on'>('off');
	let perCallModelAllow = $state<string[]>([]);
	let maxEffort = $state<string>('max');
	// Agenti con `task.agentModelOverrides`: per loro omp rifiuta il modello per chiamata.
	let overrides = $state<{ agent: string; model: string }[]>([]);
	// Rimozione in due passi: la config e' dell'utente, nulla cambia senza conferma.
	let confirmAgent = $state<string | null>(null);

	async function removeOverride(agent: string) {
		saving = true;
		errorMessage = null;
		try {
			await invoke('remove_agent_model_override', { agent });
			overrides = await invoke<{ agent: string; model: string }[]>('get_agent_model_overrides');
			confirmAgent = null;
		} catch (err) {
			errorMessage = String(err);
		} finally {
			saving = false;
		}
	}

	const isDisabled = $derived(loading || saving);

	// Ruoli non-chat da escludere dalla lista di modelli approvati
	const NON_CHAT_ROLES = new Set(['image', 'web', 'speech', 'dictation', 'judge']);

	// Modelli approvati derivati da modelSettingsStore.config.modelRoles
	const approvedModels = $derived.by<ApprovedModelItem[]>(() => {
		const rolesMap = modelSettingsStore.config?.modelRoles ?? {};
		const knownSelectors = modelSettingsStore.knownSelectors;
		const map = new Map<string, { selector: string; name: string; roles: string[] }>();

		for (const [role, rawSelector] of Object.entries(rolesMap)) {
			if (NON_CHAT_ROLES.has(role.toLowerCase())) continue;
			const trimmed = (rawSelector ?? '').trim();
			if (!trimmed || trimmed.startsWith('@') || trimmed.startsWith('*') || !trimmed.includes('/')) {
				continue;
			}

			const base = splitModelSelector(trimmed, knownSelectors).base;
			if (!base || !base.includes('/')) continue;

			if (!map.has(base)) {
				const catalogModel = resolveCatalogModel(modelSettingsStore.catalog, base);
				map.set(base, {
					selector: base,
					name: catalogModel?.name || base,
					roles: [role]
				});
			} else {
				const item = map.get(base)!;
				if (!item.roles.includes(role)) {
					item.roles.push(role);
				}
			}
		}

		// Include anche eventuali modelli presenti nell'allowlist ma non nei ruoli attuali
		for (const allowSelector of perCallModelAllow) {
			if (!map.has(allowSelector)) {
				const catalogModel = resolveCatalogModel(modelSettingsStore.catalog, allowSelector);
				map.set(allowSelector, {
					selector: allowSelector,
					name: catalogModel?.name || allowSelector,
					roles: []
				});
			}
		}

		return Array.from(map.values());
	});

	async function loadSettings() {
		loading = true;
		errorMessage = null;
		try {
			const [res, overrideList] = await Promise.all([
				invoke<SubagentModelSettings>('get_subagent_model_settings'),
				invoke<{ agent: string; model: string }[]>('get_agent_model_overrides')
			]);
			perCallModel = res.perCallModel ?? 'off';
			perCallModelAllow = res.perCallModelAllow ?? [];
			maxEffort = res.maxEffort ?? 'max';
			overrides = overrideList;
		} catch (err) {
			errorMessage = String(err);
		} finally {
			loading = false;
		}
	}

	async function persist(patch: {
		perCallModel?: 'off' | 'eval' | 'on';
		perCallModelAllow?: string[];
		maxEffort?: string;
	}) {
		const nextPerCallModel = patch.perCallModel ?? perCallModel;
		const nextAllow = patch.perCallModelAllow ?? perCallModelAllow;
		const nextEffort = patch.maxEffort ?? maxEffort;

		saving = true;
		errorMessage = null;
		try {
			await invoke('set_subagent_model_settings', {
				settings: {
					perCallModel: nextPerCallModel,
					perCallModelAllow: nextAllow,
					maxEffort: nextEffort
				}
			});
			perCallModel = nextPerCallModel;
			perCallModelAllow = nextAllow;
			maxEffort = nextEffort;
		} catch (err) {
			errorMessage = String(err);
		} finally {
			saving = false;
		}
	}

	function handleModeChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const next = target.value as 'off' | 'eval' | 'on';
		void persist({ perCallModel: next });
	}

	function handleEffortChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const next = target.value;
		void persist({ maxEffort: next });
	}

	function toggleModel(selector: string) {
		let next: string[];
		if (perCallModelAllow.includes(selector)) {
			next = perCallModelAllow.filter((s) => s !== selector);
		} else {
			next = [...perCallModelAllow, selector];
		}
		void persist({ perCallModelAllow: next });
	}

	function handleClearAllowlist() {
		void persist({ perCallModelAllow: [] });
	}

	onMount(() => {
		void loadSettings();
	});
</script>

<div class="subagent-card">
	<div class="subagent-header">
		<div class="subagent-title-row">
			<label for="subagent-per-call-mode-select" class="subagent-title">
				{m.subagent_model_card_title()}
			</label>
			<div class="subagent-status-badges">
				{#if saving}
					<span class="subagent-saving-indicator">{m.subagent_model_saving()}</span>
				{:else if loading}
					<span class="subagent-saving-indicator">{m.subagent_model_loading()}</span>
				{:else}
					<span class="status-pill" class:active={perCallModel !== 'off'}>
						{#if perCallModel === 'on'}
							{m.subagent_model_mode_on()}
						{:else if perCallModel === 'eval'}
							{m.subagent_model_mode_eval()}
						{:else}
							{m.subagent_model_mode_off()}
						{/if}
					</span>
				{/if}
			</div>
		</div>
		<span class="subagent-desc">
			{m.subagent_model_card_desc()}
		</span>
	</div>

	{#if errorMessage}
		<div class="subagent-error-banner" role="alert">
			<IconWarning />
			<span>{errorMessage}</span>
		</div>
	{/if}

	{#if perCallModel !== 'off' && overrides.length > 0}
		<div class="subagent-warning-banner" role="note">
			<IconWarning />
			<div class="override-body">
				<span>{m.subagent_model_overrides_warning()}</span>
				<ul class="override-list">
					{#each overrides as entry (entry.agent)}
						<li class="override-row">
							<span class="override-agent">{entry.agent}</span>
							<span class="override-model">{entry.model}</span>
							{#if confirmAgent === entry.agent}
								<span class="override-confirm">{m.subagent_model_override_confirm({ agent: entry.agent })}</span>
								<button
									type="button"
									class="ui-button ui-button-primary override-btn"
									disabled={isDisabled}
									onclick={() => void removeOverride(entry.agent)}
								>
									{m.subagent_model_override_confirm_yes()}
								</button>
								<button type="button" class="ui-button ui-button-ghost override-btn" onclick={() => (confirmAgent = null)}>
									{m.common_cancel()}
								</button>
							{:else}
								<button
									type="button"
									class="ui-button ui-button-ghost override-btn"
									disabled={isDisabled}
									onclick={() => (confirmAgent = entry.agent)}
								>
									{m.subagent_model_override_remove()}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	<div class="subagent-controls-grid">
		<!-- Modalita perCallModel -->
		<div class="subagent-control-box">
			<label for="subagent-per-call-mode-select" class="subagent-control-label">
				{m.subagent_model_mode_label()}
			</label>
			<select
				id="subagent-per-call-mode-select"
				class="ui-select"
				value={perCallModel}
				disabled={isDisabled}
				onchange={handleModeChange}
			>
				<option value="off">{m.subagent_model_mode_off()}</option>
				<option value="eval">{m.subagent_model_mode_eval()}</option>
				<option value="on">{m.subagent_model_mode_on()}</option>
			</select>
			<span class="subagent-control-hint">
				{#if perCallModel === 'on'}
					{m.subagent_model_mode_on_desc()}
				{:else if perCallModel === 'eval'}
					{m.subagent_model_mode_eval_desc()}
				{:else}
					{m.subagent_model_mode_off_desc()}
				{/if}
			</span>
		</div>

		<!-- Tetto massimo di reasoning (maxEffort) -->
		<div class="subagent-control-box">
			<label for="subagent-max-effort-select" class="subagent-control-label">
				{m.subagent_model_max_effort_label()}
			</label>
			<select
				id="subagent-max-effort-select"
				class="ui-select"
				value={maxEffort}
				disabled={isDisabled}
				onchange={handleEffortChange}
			>
				<option value="minimal">Minimal</option>
				<option value="low">Low</option>
				<option value="medium">Medium</option>
				<option value="high">High</option>
				<option value="xhigh">Extra High</option>
				<option value="max">Max</option>
			</select>
			<span class="subagent-control-hint">
				{m.subagent_model_max_effort_desc()}
			</span>
		</div>
	</div>

	<!-- Sezione modelli approvati e allowlist -->
	<div class="allowlist-section">
		<div class="allowlist-header">
			<div class="allowlist-header-left">
				<span class="allowlist-title">{m.subagent_model_allowlist_title()}</span>
				<span class="allowlist-hint">
					{#if perCallModelAllow.length === 0}
						{m.subagent_model_allowlist_empty_hint()}
					{:else}
						{m.subagent_model_allowlist_filtered_hint({ count: perCallModelAllow.length })}
					{/if}
				</span>
			</div>
			{#if perCallModelAllow.length > 0}
				<button
					type="button"
					class="allowlist-clear-btn"
					disabled={isDisabled}
					onclick={handleClearAllowlist}
				>
					{m.subagent_model_allowlist_clear()}
				</button>
			{/if}
		</div>

		{#if approvedModels.length === 0}
			<div class="allowlist-empty-box">
				{m.subagent_model_no_approved_models()}
			</div>
		{:else}
			<div class="allowlist-models-list">
				{#each approvedModels as model (model.selector)}
					{@const isExplicitlyAllowed = perCallModelAllow.includes(model.selector)}
					{@const isAllowed = perCallModelAllow.length === 0 || isExplicitlyAllowed}
					<div class="allowlist-model-item" class:dimmed={!isAllowed}>
						<div class="allowlist-model-left">
							<input
								type="checkbox"
								id="allow-model-{model.selector}"
								class="allowlist-checkbox"
								checked={isExplicitlyAllowed}
								disabled={isDisabled}
								onchange={() => toggleModel(model.selector)}
							/>
							<label for="allow-model-{model.selector}" class="allowlist-model-info">
								<span class="allowlist-model-name">{model.name}</span>
								<span class="allowlist-model-selector">{model.selector}</span>
								{#each model.roles as role}
									<span class="role-pill">{m.subagent_model_role_badge({ role })}</span>
								{/each}
								{#if model.roles.length === 0}
									<span class="role-pill unassigned">{m.subagent_model_unassigned_badge()}</span>
								{/if}
							</label>
						</div>
						<div class="allowlist-model-right">
							{#if perCallModelAllow.length === 0}
								<span class="status-badge status-allowed-all">
									<IconCheck />
									{m.subagent_model_status_allowed_all()}
								</span>
							{:else if isExplicitlyAllowed}
								<span class="status-badge status-allowed">
									<IconCheck />
									{m.subagent_model_status_allowed()}
								</span>
							{:else}
								<span class="status-badge status-excluded">
									{m.subagent_model_status_excluded()}
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.subagent-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px 14px;
		margin-top: 10px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.subagent-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.subagent-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.subagent-title {
		font-size: var(--text-meta);
		font-weight: 600;
		color: var(--ink);
	}

	.subagent-status-badges {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.subagent-saving-indicator {
		font-size: 11px;
		color: var(--ink-faint);
		font-style: italic;
	}

	.subagent-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.subagent-controls-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	@media (max-width: 600px) {
		.subagent-controls-grid {
			grid-template-columns: 1fr;
		}
	}

	.subagent-control-box {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.subagent-control-label {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
	}

	.subagent-control-hint {
		font-size: 11px;
		color: var(--ink-faint);
		min-height: 16px;
	}

	.allowlist-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--line-subtle, var(--line));
		padding-top: 10px;
	}

	.allowlist-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.allowlist-header-left {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.allowlist-title {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
	}

	.allowlist-hint {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.allowlist-clear-btn {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-surface);
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.allowlist-clear-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.allowlist-clear-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.allowlist-empty-box {
		padding: 8px 12px;
		background: var(--bg-surface);
		border: 1px dashed var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.allowlist-models-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.allowlist-model-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		border: 1px solid var(--line-subtle, var(--line));
		transition: opacity 0.15s ease;
	}

	.allowlist-model-item.dimmed {
		opacity: 0.65;
	}

	.allowlist-model-left {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}

	.allowlist-checkbox {
		cursor: pointer;
		accent-color: var(--accent);
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.allowlist-model-info {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		cursor: pointer;
		user-select: none;
	}

	.allowlist-model-name {
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink);
	}

	.allowlist-model-selector {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-muted);
	}

	.role-pill {
		font-size: 10px;
		padding: 1px 5px;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--ink-muted);
		border: 1px solid var(--line);
	}

	.role-pill.unassigned {
		border-style: dashed;
		color: var(--ink-faint);
	}

	.allowlist-model-right {
		flex-shrink: 0;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		padding: 2px 6px;
		border-radius: var(--radius-xs);
		white-space: nowrap;
		--icon-size: 11px;
	}

	.status-allowed {
		background: rgba(16, 185, 129, 0.12);
		color: #10b981;
	}

	.status-allowed-all {
		background: rgba(59, 130, 246, 0.12);
		color: #3b82f6;
	}

	.status-excluded {
		background: var(--bg-hover);
		color: var(--ink-faint);
	}

	.subagent-error-banner {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-caption);
		--icon-size: 14px;
	}

	.subagent-warning-banner {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid color-mix(in oklab, var(--warn) 35%, var(--line));
		background: color-mix(in oklab, var(--warn) 8%, transparent);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-caption);
		line-height: 1.45;
		--icon-size: 14px;
	}

	.subagent-warning-banner :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--warn);
	}

	.override-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.override-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.override-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.override-agent {
		font-weight: 600;
	}

	.override-model {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.override-confirm {
		color: var(--ink-muted);
	}

	.override-btn {
		padding: 2px 10px;
	}

	.status-pill {
		font-size: 11px;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-surface);
		color: var(--ink-muted);
	}

	.status-pill.active {
		border-color: #10b981;
		color: #10b981;
	}
</style>
