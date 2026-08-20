<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		THINKING_LEVELS
	} from '$lib/stores/modelSettings.svelte';
	import ModelPickerDropdown from './ModelPickerDropdown.svelte';
	import { slide } from 'svelte/transition';

	let expandedFallbacks = $state<Record<string, boolean>>({});
	let addingFallbackForRole = $state<string | null>(null);

	function toggleFallbackExpand(roleId: string) {
		expandedFallbacks[roleId] = !expandedFallbacks[roleId];
	}

	function getRoleSelector(roleId: string): string {
		return modelSettingsStore.draftConfig?.modelRoles[roleId] || '';
	}

	function getRoleModelRaw(roleId: string): string {
		const full = getRoleSelector(roleId);
		return full.split(':')[0] || '';
	}

	function getRoleThinking(roleId: string): string {
		const full = getRoleSelector(roleId);
		if (full.includes(':')) {
			return full.split(':')[1];
		}
		return 'auto';
	}

	function getFallbacks(roleId: string): string[] {
		return modelSettingsStore.draftConfig?.fallbackChains[roleId] || [];
	}

	function handleModelChange(roleId: string, selector: string) {
		modelSettingsStore.setRoleModel(roleId, selector);
	}

	function handleThinkingChange(roleId: string, level: string) {
		modelSettingsStore.setRoleThinking(roleId, level);
	}

	function handleAddFallbackSelect(roleId: string, selector: string) {
		modelSettingsStore.addFallback(roleId, selector);
		addingFallbackForRole = null;
	}

	function moveCycleItem(fromIndex: number, toIndex: number) {
		if (!modelSettingsStore.draftConfig) return;
		const order = [...modelSettingsStore.draftConfig.cycleOrder];
		if (toIndex < 0 || toIndex >= order.length) return;
		const [item] = order.splice(fromIndex, 1);
		order.splice(toIndex, 0, item);
		modelSettingsStore.setCycleOrder(order);
	}

	function getRoleAbbr(id: string): string {
		switch (id) {
			case 'default': return 'CH';
			case 'plan': return 'PL';
			case 'smol': return 'SM';
			case 'slow': return 'SL';
			case 'vision': return 'VI';
			case 'task': return 'TS';
			case 'commit': return 'CM';
			case 'advisor': return 'AD';
			default: return id.slice(0, 2).toUpperCase();
		}
	}
</script>

<div class="roles-tab">
	<div class="roles-grid">
		{#each STANDARD_ROLES as role (role.id)}
			{@const currentSelector = getRoleSelector(role.id)}
			{@const rawModel = getRoleModelRaw(role.id)}
			{@const currentThinking = getRoleThinking(role.id)}
			{@const fallbacks = getFallbacks(role.id)}
			{@const isExpanded = expandedFallbacks[role.id]}

			<div class="role-card" class:unconfigured={!currentSelector}>
				<div class="role-header">
					<div class="role-info">
						<span class="role-badge">{getRoleAbbr(role.id)}</span>
						<div class="role-titles">
							<div class="role-name-row">
								<span class="role-name">{role.label}</span>
								<span class="role-id-badge">{role.id}</span>
							</div>
							<span class="role-desc">{role.desc}</span>
						</div>
					</div>
					{#if currentSelector}
						<button
							type="button"
							class="clear-role-btn"
							onclick={() => modelSettingsStore.removeRole(role.id)}
							title="Rimuovi configurazione per questo ruolo"
						>
							Rimuovi
						</button>
					{/if}
				</div>

				<div class="role-body">
					<div class="control-row">
						<div class="picker-wrapper">
							<label class="control-label" for="picker-{role.id}">Modello Principale</label>
							<ModelPickerDropdown
								catalog={modelSettingsStore.catalog}
								value={rawModel}
								placeholder="Seleziona modello per {role.label}..."
								onSelect={(sel) => handleModelChange(role.id, sel)}
							/>
						</div>

						<div class="thinking-wrapper">
							<label class="control-label" for="thinking-{role.id}">Reasoning</label>
							<select
								id="thinking-{role.id}"
								class="thinking-select"
								value={currentThinking}
								onchange={(e) => handleThinkingChange(role.id, e.currentTarget.value)}
							>
								{#each THINKING_LEVELS as lvl}
									<option value={lvl.id}>{lvl.label}</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- Fallback Chains -->
					<div class="fallback-section">
						<button
							type="button"
							class="fallback-toggle-btn"
							onclick={() => toggleFallbackExpand(role.id)}
						>
							<svg
								class="fb-toggle-icon"
								class:rotated={isExpanded}
								viewBox="0 0 16 16"
								width="11"
								height="11"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
							>
								<path d="M6 3.5l4.5 4.5-4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span class="fb-toggle-label">
								Catena di Fallback
								{#if fallbacks.length > 0}
									<span class="fb-count-badge">{fallbacks.length}</span>
								{/if}
							</span>
							{#if fallbacks.length > 0 && !isExpanded}
								<span class="fb-preview-chips">
									{#each fallbacks.slice(0, 2) as fb}
										<span class="fb-preview-chip">{fb.split('/')[1] || fb}</span>
									{/each}
									{#if fallbacks.length > 2}
										<span class="fb-preview-chip">+{fallbacks.length - 2}</span>
									{/if}
								</span>
							{/if}
						</button>

						{#if isExpanded}
							<div class="fallback-content" transition:slide={{ duration: 160 }}>
								{#if fallbacks.length > 0}
									<div class="fallback-list">
										{#each fallbacks as fb, idx (fb + idx)}
											<div class="fallback-row">
												<span class="fb-order">#{idx + 1}</span>
												<div class="fb-model-badge">
													<span class="fb-provider">{fb.split('/')[0]}</span>
													<span class="fb-name">{fb.split('/')[1] || fb}</span>
												</div>
												<div class="fb-actions">
													<button
														type="button"
														class="fb-action-btn"
														disabled={idx === 0}
														onclick={() => modelSettingsStore.moveFallback(role.id, idx, idx - 1)}
														title="Sposta prima"
													>
														<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
															<path d="M3.5 10L8 5.5l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
														</svg>
													</button>
													<button
														type="button"
														class="fb-action-btn"
														disabled={idx === fallbacks.length - 1}
														onclick={() => modelSettingsStore.moveFallback(role.id, idx, idx + 1)}
														title="Sposta dopo"
													>
														<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
															<path d="M3.5 6L8 10.5l4.5-4.5" stroke-linecap="round" stroke-linejoin="round" />
														</svg>
													</button>
													<button
														type="button"
														class="fb-action-btn delete"
														onclick={() => modelSettingsStore.removeFallback(role.id, idx)}
														title="Elimina fallback"
													>
														<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
															<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
														</svg>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<div class="empty-fallback-hint">
										Nessun modello di riserva. Se il provider principale va in rate-limit, la richiesta fallirà.
									</div>
								{/if}

								<div class="add-fallback-wrapper">
									{#if addingFallbackForRole === role.id}
										<div class="inline-picker-box">
											<ModelPickerDropdown
												catalog={modelSettingsStore.catalog}
												placeholder="Scegli modello di riserva..."
												onSelect={(sel) => handleAddFallbackSelect(role.id, sel)}
											/>
											<button type="button" class="btn-cancel-add" onclick={() => addingFallbackForRole = null}>Annulla</button>
										</div>
									{:else}
										<button
											type="button"
											class="btn-add-fallback"
											onclick={() => addingFallbackForRole = role.id}
										>
											+ Aggiungi Modello di Riserva
										</button>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Cycle Order -->
	{#if modelSettingsStore.draftConfig?.cycleOrder}
		<div class="cycle-order-card">
			<div class="cycle-header">
				<div class="cycle-title-row">
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
						<path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2" stroke-linecap="round" />
						<path d="M12.5 1v3h-3M3.5 15v-3h3" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span class="cycle-title">Sequenza Ciclo Rapido (Ctrl+P)</span>
				</div>
				<span class="cycle-subtitle">Ordine di alternanza dei ruoli nel terminale</span>
			</div>
			<div class="cycle-list">
				{#each modelSettingsStore.draftConfig.cycleOrder as roleName, idx (roleName)}
					{@const roleMeta = STANDARD_ROLES.find(r => r.id === roleName)}
					<div class="cycle-item">
						<span class="cycle-num">{idx + 1}</span>
						<span class="cycle-badge">{getRoleAbbr(roleName)}</span>
						<span class="cycle-name">{roleMeta?.label || roleName}</span>
						<div class="cycle-arrows">
							<button
								type="button"
								class="cycle-btn"
								disabled={idx === 0}
								onclick={() => moveCycleItem(idx, idx - 1)}
								title="Sposta prima"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
									<path d="M10 3.5L5.5 8l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</button>
							<button
								type="button"
								class="cycle-btn"
								disabled={idx === (modelSettingsStore.draftConfig?.cycleOrder.length || 0) - 1}
								onclick={() => moveCycleItem(idx, idx + 1)}
								title="Sposta dopo"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
									<path d="M6 3.5L10.5 8 6 12.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.roles-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.roles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
		gap: var(--space-3);
	}

	.role-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		transition: border-color var(--dur-fast);
	}

	.role-card:hover {
		border-color: var(--line-strong);
	}

	.role-card.unconfigured {
		opacity: 0.85;
	}

	.role-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.role-info {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}

	.role-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}

	.role-titles {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.role-name-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.role-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.role-id-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		color: var(--ink-faint);
		border: 1px solid var(--line);
	}

	.role-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.clear-role-btn {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.clear-role-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.role-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.control-row {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
	}

	.picker-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.thinking-wrapper {
		width: 140px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex-shrink: 0;
	}

	.control-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.thinking-select {
		width: 100%;
		height: 32px;
		padding: 0 var(--space-2);
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		outline: none;
		transition: border-color var(--dur-fast);
	}

	.thinking-select:focus {
		border-color: var(--brand);
	}

	.fallback-section {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
		margin-top: 2px;
	}

	.fallback-toggle-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		padding: 4px 0;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
		transition: color var(--dur-fast);
	}

	.fallback-toggle-btn:hover {
		color: var(--ink);
	}

	.fb-toggle-icon {
		transition: transform var(--dur-fast);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.fb-toggle-icon.rotated {
		transform: rotate(90deg);
	}

	.fb-toggle-label {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.fb-count-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		background: var(--bg-hover);
		padding: 0 5px;
		border-radius: var(--radius-full);
		border: 1px solid var(--line);
		color: var(--ink);
	}

	.fb-preview-chips {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		overflow: hidden;
	}

	.fb-preview-chip {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
		max-width: 110px;
	}

	.fallback-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
	}

	.fallback-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.fallback-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-hover);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: var(--text-xs);
	}

	.fb-order {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		width: 18px;
		flex-shrink: 0;
	}

	.fb-model-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.fb-provider {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		flex-shrink: 0;
	}

	.fb-name {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink);
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.fb-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.fb-action-btn {
		width: 20px;
		height: 20px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.fb-action-btn:hover:not(:disabled) {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--line);
	}

	.fb-action-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.fb-action-btn.delete:hover {
		background: var(--bg-active);
		color: var(--brand-ink);
		border-color: var(--line-strong);
	}

	.empty-fallback-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
		padding: 4px 0;
	}

	.add-fallback-wrapper {
		margin-top: 2px;
	}

	.btn-add-fallback {
		width: 100%;
		padding: 5px;
		background: transparent;
		border: 1px dashed var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-add-fallback:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.inline-picker-box {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-cancel-add {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--ink-muted);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.cycle-order-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.cycle-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.cycle-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ink);
	}

	.cycle-title {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.cycle-subtitle {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.cycle-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.cycle-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--bg-hover);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-size: var(--text-xs);
	}

	.cycle-num {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		width: 14px;
	}

	.cycle-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--ink);
		background: var(--bg-base);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.cycle-name {
		font-size: var(--text-xs);
		color: var(--ink);
		flex: 1;
	}

	.cycle-arrows {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.cycle-btn {
		width: 20px;
		height: 20px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid transparent;
		color: var(--ink-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.cycle-btn:hover:not(:disabled) {
		background: var(--bg-active);
		color: var(--ink);
		border-color: var(--line);
	}

	.cycle-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
</style>
