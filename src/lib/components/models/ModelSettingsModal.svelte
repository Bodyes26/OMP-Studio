<script lang="ts">
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import RolesTab from './RolesTab.svelte';
	import CatalogTab from './CatalogTab.svelte';
	import ProvidersTab from './ProvidersTab.svelte';
	import UpgradeModal from './UpgradeModal.svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	function handleClose() {
		modelSettingsStore.closeModal();
	}

	async function handleSave() {
		await modelSettingsStore.saveConfig();
	}

	function handleRestart() {
		modelSettingsStore.restartOmpSessions();
	}

	function handleCheckUpgrades() {
		void modelSettingsStore.checkUpgrades();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && modelSettingsStore.isOpen && !modelSettingsStore.upgradeModalOpen) {
			handleClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if modelSettingsStore.isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={handleClose} transition:fade={{ duration: 150 }}></div>
	<div class="modal-window" transition:fly={{ y: -16, duration: 220, easing: cubicOut }}>
		<!-- Header -->
		<div class="modal-header">
			<div class="header-main">
				<div class="title-row">
					<span class="header-icon">⚙️</span>
					<h3>Modelli e Ruoli OMP</h3>
				</div>
				<span class="header-desc">Configurazione dei ruoli operativi, catene di fallback, catalogo e provider</span>
			</div>

			<div class="header-actions">
				<button
					class="btn-header-action upgrade-action"
					class:spinning={modelSettingsStore.isCheckingUpgrades}
					disabled={modelSettingsStore.isCheckingUpgrades}
					onclick={handleCheckUpgrades}
					title="Verifica se sono disponibili nuove versioni dei modelli per i ruoli utilizzati"
				>
					<span>{modelSettingsStore.isCheckingUpgrades ? 'Verifica...' : '🔍 Controlla Nuove Versioni'}</span>
				</button>

				<button
					class="btn-header-action restart-action"
					onclick={handleRestart}
					title="Riavvia le sessioni OMP nei progetti aperti per applicare le modifiche ai ruoli"
				>
					<span>⚡ Riavvia OMP</span>
				</button>

				<button class="btn-close" onclick={handleClose}>×</button>
			</div>
		</div>

		<!-- Nav Tabs -->
		<div class="modal-nav">
			<button
				class="nav-tab"
				class:active={modelSettingsStore.activeTab === 'roles'}
				onclick={() => modelSettingsStore.activeTab = 'roles'}
			>
				<span>🎯</span> Ruoli & Fallback
			</button>
			<button
				class="nav-tab"
				class:active={modelSettingsStore.activeTab === 'catalog'}
				onclick={() => modelSettingsStore.activeTab = 'catalog'}
			>
				<span>📚</span> Catalogo ({modelSettingsStore.catalog.length})
			</button>
			<button
				class="nav-tab"
				class:active={modelSettingsStore.activeTab === 'providers'}
				onclick={() => modelSettingsStore.activeTab = 'providers'}
			>
				<span>🔌</span> Provider & Custom
			</button>
		</div>

		<!-- Content -->
		<div class="modal-body">
			{#if modelSettingsStore.loading}
				<div class="loading-state">
					<span class="spinner"></span>
					<span>Caricamento configurazione modelli OMP...</span>
				</div>
			{:else if modelSettingsStore.activeTab === 'roles'}
				<RolesTab />
			{:else if modelSettingsStore.activeTab === 'catalog'}
				<CatalogTab />
			{:else if modelSettingsStore.activeTab === 'providers'}
				<ProvidersTab />
			{/if}
		</div>

		<!-- Footer -->
		<div class="modal-footer">
			<div class="footer-left">
				{#if modelSettingsStore.statusToast}
					<span class="status-toast" transition:fade={{ duration: 150 }}>
						{modelSettingsStore.statusToast}
					</span>
				{:else if modelSettingsStore.hasUnsavedChanges}
					<span class="unsaved-badge">
						● Modifiche non salvate
					</span>
				{/if}
			</div>

			<div class="footer-right">
				{#if modelSettingsStore.hasUnsavedChanges}
					<button
						class="btn btn-secondary"
						disabled={modelSettingsStore.saving}
						onclick={() => modelSettingsStore.resetDraft()}
					>
						Reimposta
					</button>
				{/if}
				<button class="btn btn-secondary" onclick={handleClose}>Chiudi</button>
				<button
					class="btn btn-primary"
					disabled={!modelSettingsStore.hasUnsavedChanges || modelSettingsStore.saving}
					onclick={handleSave}
				>
					{#if modelSettingsStore.saving}
						Salvataggio...
					{:else}
						Salva Modifiche
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Modal secondario per approvazione version bump -->
	<UpgradeModal />
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-dialog);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 900px;
		max-width: 95vw;
		height: 85vh;
		max-height: 720px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-overlay);
		z-index: calc(var(--z-dialog) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-3);
	}

	.header-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.header-icon {
		font-size: 16px;
	}

	.title-row h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.header-desc {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.btn-header-action {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 5px 10px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: all 0.15s ease;
	}

	.btn-header-action:hover:not(:disabled) {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.btn-header-action.upgrade-action {
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		color: var(--brand-ink);
	}

	.btn-header-action.upgrade-action:hover:not(:disabled) {
		border-color: var(--brand);
		background: var(--brand-dim);
	}

	.btn-header-action.restart-action:hover {
		border-color: var(--warn, #f59e0b);
		color: var(--warn, #f59e0b);
	}

	.btn-header-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-close {
		background: transparent;
		border: none;
		font-size: 20px;
		color: var(--ink-faint);
		cursor: pointer;
		line-height: 1;
		padding: 4px 6px;
		border-radius: var(--radius-sm);
	}

	.btn-close:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.modal-nav {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.nav-tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 8px var(--space-3);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}

	.nav-tab:hover {
		color: var(--ink-muted);
	}

	.nav-tab.active {
		color: var(--ink);
		border-bottom-color: var(--brand);
	}

	.modal-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 var(--space-4);
		background: var(--bg-overlay);
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-8) 0;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--line);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-3);
	}

	.footer-left {
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 1;
	}

	.status-toast {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--brand-ink);
		background: var(--brand-dim);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.unsaved-badge {
		font-size: var(--text-xs);
		color: var(--warn, #f59e0b);
		font-weight: 500;
	}

	.footer-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
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
		background: var(--bg-sunken);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
