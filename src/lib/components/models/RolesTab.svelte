<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		THINKING_LEVELS,
		type ModelDto
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
</script>

<div class="roles-tab">
	<div class="section-intro">
		<div class="intro-text">
			<h4>Assegnazione Ruoli e Fallback</h4>
			<p>Configura il modello primario, il livello di reasoning e la catena di emergenza per ciascun ruolo operativo di OMP.</p>
		</div>
	</div>

	<div class="roles-grid">
		{#each STANDARD_ROLES as role (role.id)}
			{@const currentSelector = getRoleSelector(role.id)}
			{@const rawModel = getRoleModelRaw(role.id)}
			{@const currentThinking = getRoleThinking(role.id)}
			{@const fallbacks = getFallbacks(role.id)}
			{@const isExpanded = expandedFallbacks[role.id]}
			{@const modelObj = modelSettingsStore.catalog.find(m => m.selector === rawModel)}

			<div class="role-card" class:unconfigured={!currentSelector}>
				<div class="role-header">
					<div class="role-info">
						<span class="role-icon">{role.icon}</span>
						<div class="role-titles">
							<div class="role-name-row">
								<span class="role-name">{role.label}</span>
								<span class="role-id-badge">role: {role.id}</span>
							</div>
							<span class="role-desc">{role.desc}</span>
						</div>
					</div>
					{#if currentSelector}
						<button
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
							<span class="control-label">Modello Principale</span>
							<ModelPickerDropdown
								catalog={modelSettingsStore.catalog}
								value={rawModel}
								placeholder="Seleziona modello per {role.label}..."
								onSelect={(sel) => handleModelChange(role.id, sel)}
							/>
						</div>

						<div class="thinking-wrapper">
							<span class="control-label">Reasoning / Thinking</span>
							<select
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
							<span class="fb-toggle-icon" class:rotated={isExpanded}>▶</span>
							<span class="fb-toggle-label">
								Catena di Fallback
								<span class="fb-count-badge">{fallbacks.length}</span>
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
							<div class="fallback-content" transition:slide={{ duration: 180 }}>
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
														class="fb-action-btn"
														disabled={idx === 0}
														onclick={() => modelSettingsStore.moveFallback(role.id, idx, idx - 1)}
														title="Sposta prima"
													>
														▲
													</button>
													<button
														class="fb-action-btn"
														disabled={idx === fallbacks.length - 1}
														onclick={() => modelSettingsStore.moveFallback(role.id, idx, idx + 1)}
														title="Sposta dopo"
													>
														▼
													</button>
													<button
														class="fb-action-btn delete"
														onclick={() => modelSettingsStore.removeFallback(role.id, idx)}
														title="Elimina fallback"
													>
														✕
													</button>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<div class="empty-fallback-hint">
										Nessun modello di riserva configurato. Se il provider principale va in rate-limit, la richiesta fallirà.
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
											<button class="btn-cancel-add" onclick={() => addingFallbackForRole = null}>Annulla</button>
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
				<span class="cycle-title">🔄 Sequenza di Ciclo Rapido (Ctrl+P)</span>
				<span class="cycle-subtitle">Ordine con cui OMP alterna i ruoli alla pressione di Ctrl+P nel terminale</span>
			</div>
			<div class="cycle-list">
				{#each modelSettingsStore.draftConfig.cycleOrder as roleName, idx (roleName)}
					{@const roleMeta = STANDARD_ROLES.find(r => r.id === roleName)}
					<div class="cycle-item">
						<span class="cycle-num">{idx + 1}</span>
						<span class="cycle-icon">{roleMeta?.icon || '•'}</span>
						<span class="cycle-name">{roleMeta?.label || roleName}</span>
						<div class="cycle-arrows">
							<button
								class="cycle-btn"
								disabled={idx === 0}
								onclick={() => moveCycleItem(idx, idx - 1)}
								title="Sposta prima"
							>
								◀
							</button>
							<button
								class="cycle-btn"
								disabled={idx === (modelSettingsStore.draftConfig?.cycleOrder.length || 0) - 1}
								onclick={() => moveCycleItem(idx, idx + 1)}
								title="Sposta dopo"
							>
								▶
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
		padding: var(--space-2) 0;
	}

	.section-intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--line);
		padding-bottom: var(--space-3);
	}

	.intro-text h4 {
		margin: 0 0 2px 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.intro-text p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
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
		transition: border-color 0.15s ease;
	}

	.role-card:hover {
		border-color: var(--line-strong);
	}

	.role-card.unconfigured {
		opacity: 0.85;
		border-style: dashed;
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
		flex: 1;
	}

	.role-icon {
		font-size: 18px;
		line-height: 1.2;
	}

	.role-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.role-name-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.role-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.role-id-badge {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 0 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.role-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.clear-role-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: 11px;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.clear-role-btn:hover {
		color: var(--danger, #ef4444);
		background: var(--bg-hover);
	}

	.role-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.control-row {
		display: flex;
		gap: var(--space-2);
	}

	.picker-wrapper {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.thinking-wrapper {
		width: 140px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.control-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.thinking-select {
		width: 100%;
		height: 33px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 4px 8px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
		cursor: pointer;
	}

	.thinking-select:focus {
		border-color: var(--brand);
	}

	.fallback-section {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.fallback-toggle-btn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px 10px;
		background: transparent;
		border: none;
		color: var(--ink);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		text-align: left;
	}

	.fallback-toggle-btn:hover {
		background: var(--bg-hover);
	}

	.fb-toggle-icon {
		font-size: 9px;
		color: var(--ink-faint);
		transition: transform 0.15s ease;
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
		font-size: 10px;
		font-family: var(--font-mono);
		background: var(--bg-base);
		border: 1px solid var(--line);
		padding: 0 5px;
		border-radius: 99px;
		color: var(--ink-muted);
	}

	.fb-preview-chips {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
	}

	.fb-preview-chip {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		color: var(--ink-faint);
	}

	.fallback-content {
		padding: var(--space-2) var(--space-3) var(--space-3) var(--space-3);
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.fallback-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.fallback-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 4px 8px;
	}

	.fb-order {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
		font-weight: 600;
	}

	.fb-model-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}

	.fb-provider {
		font-size: 9px;
		font-family: var(--font-mono);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-faint);
		text-transform: lowercase;
	}

	.fb-name {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.fb-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.fb-action-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 10px;
		padding: 3px 5px;
		border-radius: var(--radius-sm);
	}

	.fb-action-btn:hover:not(:disabled) {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.fb-action-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.fb-action-btn.delete:hover {
		color: var(--danger, #ef4444);
	}

	.empty-fallback-hint {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
		padding: 4px 0;
	}

	.add-fallback-wrapper {
		margin-top: 2px;
	}

	.btn-add-fallback {
		width: 100%;
		background: transparent;
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		padding: 5px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-add-fallback:hover {
		border-color: var(--brand);
		color: var(--ink);
		background: var(--bg-hover);
	}

	.inline-picker-box {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-cancel-add {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		padding: 6px 10px;
		cursor: pointer;
		white-space: nowrap;
	}

	.cycle-order-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	.cycle-header {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.cycle-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.cycle-subtitle {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.cycle-list {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.cycle-item {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 4px 8px;
		font-size: var(--text-xs);
	}

	.cycle-num {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--ink-faint);
		font-size: 10px;
	}

	.cycle-icon {
		font-size: 13px;
	}

	.cycle-name {
		font-weight: 500;
		color: var(--ink);
	}

	.cycle-arrows {
		display: flex;
		align-items: center;
		gap: 1px;
		margin-left: 4px;
	}

	.cycle-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		font-size: 9px;
		padding: 2px 4px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.cycle-btn:hover:not(:disabled) {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.cycle-btn:disabled {
		opacity: 0.2;
		cursor: not-allowed;
	}
</style>
