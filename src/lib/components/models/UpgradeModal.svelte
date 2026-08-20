<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES
	} from '$lib/stores/modelSettings.svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let selectedIndices = $state<number[]>([]);

	$effect(() => {
		if (modelSettingsStore.upgradeModalOpen) {
			// Seleziona tutti per default
			selectedIndices = modelSettingsStore.upgradeCandidates.map((_, i) => i);
		}
	});

	function toggleSelect(index: number) {
		if (selectedIndices.includes(index)) {
			selectedIndices = selectedIndices.filter(i => i !== index);
		} else {
			selectedIndices = [...selectedIndices, index];
		}
	}

	function toggleSelectAll() {
		if (selectedIndices.length === modelSettingsStore.upgradeCandidates.length) {
			selectedIndices = [];
		} else {
			selectedIndices = modelSettingsStore.upgradeCandidates.map((_, i) => i);
		}
	}

	async function handleApply() {
		const chosen = selectedIndices.map(i => modelSettingsStore.upgradeCandidates[i]);
		await modelSettingsStore.applyUpgrades(chosen);
	}

	function handleClose() {
		modelSettingsStore.upgradeModalOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && modelSettingsStore.upgradeModalOpen) {
			e.stopPropagation();
			handleClose();
		}
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

	function getRoleMeta(roleId: string) {
		return STANDARD_ROLES.find(r => r.id === roleId) || {
			id: roleId,
			label: roleId,
			desc: ''
		};
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if modelSettingsStore.upgradeModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleClose} transition:fade={{ duration: 150 }}></div>

	<div
		class="upgrade-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="upgrade-dialog-title"
		transition:fly={{ y: -16, duration: 220, easing: cubicOut }}
	>
		<div class="dialog-header">
			<div class="header-titles">
				<h3 id="upgrade-dialog-title">Nuove Versioni Modelli Disponibili</h3>
				<p>OMP ha individuato versioni aggiornate per i modelli assegnati ai ruoli operativi.</p>
			</div>
			<button class="btn-close" aria-label="Chiudi finestra" onclick={handleClose}>×</button>
		</div>

		<div class="dialog-body">
			<div class="selection-bar">
				<label class="select-all-label">
					<input
						type="checkbox"
						checked={selectedIndices.length > 0 && selectedIndices.length === modelSettingsStore.upgradeCandidates.length}
						indeterminate={selectedIndices.length > 0 && selectedIndices.length < modelSettingsStore.upgradeCandidates.length}
						onchange={toggleSelectAll}
					/>
					<span>Seleziona tutti ({selectedIndices.length}/{modelSettingsStore.upgradeCandidates.length})</span>
				</label>
			</div>

			<div class="candidates-list">
				{#each modelSettingsStore.upgradeCandidates as cand, index (cand.role + cand.suggestedSelector)}
					{@const roleMeta = getRoleMeta(cand.role)}
					{@const isSelected = selectedIndices.includes(index)}

					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="candidate-card"
						class:selected={isSelected}
						onclick={() => toggleSelect(index)}
					>
						<div class="card-left">
							<input
								type="checkbox"
								checked={isSelected}
								aria-label="Aggiorna modello per ruolo {roleMeta.label}"
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleSelect(index)}
							/>
						</div>

						<div class="card-content">
							<div class="role-badge-row">
								<span class="role-abbr-badge">{getRoleAbbr(cand.role)}</span>
								<span class="role-name">{roleMeta.label}</span>
								<span class="provider-tag">{cand.currentProvider}</span>
							</div>

							<div class="diff-row">
								<div class="model-box old">
									<span class="box-label">Attuale</span>
									<span class="box-val">{cand.currentModelId}</span>
									{#if cand.currentThinking}
										<span class="thinking-tag">:{cand.currentThinking}</span>
									{/if}
								</div>

								<span class="diff-arrow">→</span>

								<div class="model-box new">
									<span class="box-label">Suggerito</span>
									<span class="box-val">{cand.suggestedModelId}</span>
									{#if cand.currentThinking}
										<span class="thinking-tag">:{cand.currentThinking}</span>
									{/if}
								</div>
							</div>

							{#if cand.reason}
								<div class="reason-note">
									{cand.reason}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="dialog-footer">
			<div class="footer-hint">
				I livelli di reasoning e la catena di fallback rimarranno invariati.
			</div>
			<div class="footer-actions">
				<button class="btn btn-secondary" onclick={handleClose}>Annulla</button>
				<button
					class="btn btn-primary"
					disabled={selectedIndices.length === 0 || modelSettingsStore.saving}
					onclick={handleApply}
				>
					{#if modelSettingsStore.saving}
						Applicazione...
					{:else}
						Applica {selectedIndices.length} Aggiornamenti
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		opacity: 0.75;
		z-index: calc(var(--z-dialog) + 10);
	}

	.upgrade-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 600px;
		max-width: 92vw;
		max-height: 85vh;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: calc(var(--z-dialog) + 11);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.header-titles h3 {
		margin: 0 0 2px 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.header-titles p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.btn-close {
		width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		font-size: 18px;
		color: var(--ink-muted);
		cursor: pointer;
		line-height: 1;
		border-radius: var(--radius-sm);
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.dialog-body {
		padding: var(--space-3) var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 1;
		background: var(--bg-base);
	}

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
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

	.card-left {
		padding-top: 2px;
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
	}

	.role-abbr-badge {
		font-family: var(--font-mono);
		font-size: 10px;
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

	.provider-tag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
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
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
		min-width: 0;
	}

	.model-box.new {
		border-color: var(--brand-dim);
	}

	.box-label {
		font-size: 9px;
		font-weight: 500;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.box-val {
		font-family: var(--font-mono);
		font-size: 11px;
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
		font-size: 10px;
	}

	.diff-arrow {
		color: var(--ink-faint);
		font-size: 13px;
		flex-shrink: 0;
	}

	.reason-note {
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.35;
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-3);
		min-height: 48px;
	}

	.footer-hint {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 12px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-project, #ffffff);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
