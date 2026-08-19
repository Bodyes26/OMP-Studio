<script lang="ts">
	import {
		modelSettingsStore,
		STANDARD_ROLES,
		type ModelUpgradeCandidate
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

	function getRoleMeta(roleId: string) {
		return STANDARD_ROLES.find(r => r.id === roleId) || {
			id: roleId,
			label: roleId,
			icon: '⚙️'
		};
	}
</script>

{#if modelSettingsStore.upgradeModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleClose} transition:fade={{ duration: 150 }}></div>
	<div class="upgrade-dialog" transition:fly={{ y: -16, duration: 220, easing: cubicOut }}>
		<div class="dialog-header">
			<div class="header-titles">
				<h3>🚀 Nuove Versioni Modelli Disponibili</h3>
				<p>OMP ha confrontato i ruoli configurati con il catalogo più recente e ha trovato versioni aggiornate.</p>
			</div>
			<button class="btn-close" onclick={handleClose}>×</button>
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
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleSelect(index)}
							/>
						</div>

						<div class="card-content">
							<div class="role-badge-row">
								<span class="role-icon">{roleMeta.icon}</span>
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

								<span class="diff-arrow">➔</span>

								<div class="model-box new">
									<span class="box-label">Nuova Versione</span>
									<span class="box-val">{cand.suggestedModelId}</span>
									{#if cand.currentThinking}
										<span class="thinking-tag">:{cand.currentThinking}</span>
									{/if}
								</div>
							</div>

							<div class="reason-note">
								{cand.reason}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="dialog-footer">
			<div class="footer-hint">
				I livelli di thinking e i ruoli operativi rimarranno invariati.
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
		background: var(--backdrop);
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
		border-radius: var(--radius-xl);
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
		padding: var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.header-titles h3 {
		margin: 0 0 4px 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.header-titles p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.btn-close {
		background: transparent;
		border: none;
		font-size: 20px;
		color: var(--ink-faint);
		cursor: pointer;
		line-height: 1;
		padding: 4px;
	}

	.btn-close:hover {
		color: var(--ink);
	}

	.dialog-body {
		padding: var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		flex: 1;
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
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.candidate-card:hover {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.candidate-card.selected {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 5%, var(--bg-base));
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

	.role-icon {
		font-size: 14px;
	}

	.role-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}

	.provider-tag {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-faint);
		text-transform: lowercase;
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
		gap: 2px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 8px;
		min-width: 0;
	}

	.model-box.old {
		opacity: 0.8;
	}

	.model-box.new {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-sunken));
	}

	.box-label {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		font-weight: 600;
	}

	.box-val {
		font-size: var(--text-xs);
		font-weight: 500;
		font-family: var(--font-mono);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thinking-tag {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--brand);
		font-weight: 600;
	}

	.diff-arrow {
		color: var(--brand);
		font-size: 14px;
		flex-shrink: 0;
	}

	.reason-note {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.footer-hint {
		font-size: 11px;
		color: var(--ink-faint);
	}

	.footer-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}

	.btn-secondary {
		background: transparent;
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
