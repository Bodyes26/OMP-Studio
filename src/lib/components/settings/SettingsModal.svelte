<script lang="ts">
	import { settingsStore, type SettingsSection } from '$lib/stores/settings.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import RolesTab from '../models/RolesTab.svelte';
	import CatalogTab from '../models/CatalogTab.svelte';
	import ProvidersTab from '../models/ProvidersTab.svelte';
	import UpgradeModal from '../models/UpgradeModal.svelte';
	import GeneralSection from './GeneralSection.svelte';
	import ProjectBarSection from './ProjectBarSection.svelte';
	import WorkspaceSection from './WorkspaceSection.svelte';
	import TasksSection from './TasksSection.svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	// Navigazione di primo livello: ogni voce apre una sezione del centro
	// impostazioni. "Modelli" e' l'unica con le tre schede orizzontali storiche.
	const NAV_SECTIONS: { id: SettingsSection; label: string }[] = [
		{ id: 'general', label: 'Generale' },
		{ id: 'projectBar', label: 'Barra progetti' },
		{ id: 'workspace', label: 'Editor & Terminale' },
		{ id: 'tasks', label: 'Task & Agenti' },
		{ id: 'models', label: 'Modelli' }
	];

	let showDiscardConfirm = $state(false);

	const sectionLabel = $derived(NAV_SECTIONS.find((s) => s.id === settingsStore.section)?.label ?? '');

	function requestClose() {
		if (modelSettingsStore.hasUnsavedChanges) {
			showDiscardConfirm = true;
		} else {
			forceClose();
		}
	}

	function forceClose() {
		showDiscardConfirm = false;
		modelSettingsStore.resetDraft();
		settingsStore.close();
	}

	function cancelDiscard() {
		showDiscardConfirm = false;
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
		if (!settingsStore.open) return;

		if (e.key === 'Escape') {
			if (modelSettingsStore.upgradeModalOpen) return;
			if (showDiscardConfirm) {
				showDiscardConfirm = false;
			} else {
				requestClose();
			}
		}
	}

	// Azione per intrappolare e gestire il fuoco dentro il dialogo modale
	function trapFocus(node: HTMLElement) {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

		// Sposta il fuoco sul primo elemento interattivo appena montato
		const first = node.querySelector<HTMLElement>(focusableSelector);
		if (first) {
			first.focus();
		}

		function onKeydown(e: KeyboardEvent) {
			if (e.key !== 'Tab') return;
			const focusables = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector));
			if (focusables.length === 0) return;
			const firstEl = focusables[0];
			const lastEl = focusables[focusables.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === firstEl) {
					e.preventDefault();
					lastEl.focus();
				}
			} else {
				if (document.activeElement === lastEl) {
					e.preventDefault();
					firstEl.focus();
				}
			}
		}

		node.addEventListener('keydown', onKeydown);

		return {
			destroy() {
				node.removeEventListener('keydown', onKeydown);
				// Ripristina il fuoco all'elemento che aveva aperto il modale
				if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
					previouslyFocused.focus();
				}
			}
		};
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if settingsStore.open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={requestClose} transition:fade={{ duration: 150 }}></div>

	<div
		class="modal-window"
		role="dialog"
		aria-modal="true"
		aria-labelledby="settings-title"
		use:trapFocus
		transition:fly={{ y: -16, duration: 220, easing: cubicOut }}
	>
		<!-- Header -->
		<div class="modal-header">
			<div class="header-main">
				<h3 id="settings-title" class="title-row">
					<svg class="header-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
						<circle cx="8" cy="8" r="2.5" />
						<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
					</svg>
					<span>Impostazioni</span>
					<span class="title-sep">·</span>
					<span class="title-section">{sectionLabel}</span>
				</h3>
			</div>

			<div class="header-actions">
				{#if settingsStore.section === 'models'}
					<button
						class="btn-header-action upgrade-action"
						class:spinning={modelSettingsStore.isCheckingUpgrades}
						disabled={modelSettingsStore.isCheckingUpgrades}
						onclick={handleCheckUpgrades}
						title="Verifica se sono disponibili nuove versioni per i modelli configurati"
					>
						<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">
							<circle cx="7" cy="7" r="4.5" />
							<path d="M10.5 10.5L14 14" stroke-linecap="round" />
						</svg>
						<span>{modelSettingsStore.isCheckingUpgrades ? 'Verifica...' : 'Verifica Versioni'}</span>
					</button>

					<button
						class="btn-header-action restart-action"
						onclick={handleRestart}
						title="Riavvia le sessioni OMP aperte per applicare le configurazioni"
					>
						<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">
							<path d="M2 8a6 6 0 1 1 1.8 4.2M2 8V4.5M2 8h3.5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<span>Riavvia OMP</span>
					</button>
				{/if}

				<button class="btn-close" onclick={requestClose} aria-label="Chiudi finestra">×</button>
			</div>
		</div>

		<div class="modal-layout">
			<!-- Nav di primo livello -->
			<nav class="section-nav" aria-label="Sezioni impostazioni">
				{#each NAV_SECTIONS as s (s.id)}
					<button
						type="button"
						class="section-nav-item"
						class:active={settingsStore.section === s.id}
						onclick={() => (settingsStore.section = s.id)}
					>
						{s.label}
					</button>
				{/each}
			</nav>

			<div class="section-content">
				{#if settingsStore.section === 'models'}
					<!-- Nav Tabs orizzontali: solo dentro la sezione Modelli -->
					<div class="modal-nav" role="tablist" aria-label="Sezioni impostazioni modelli">
						<button
							class="nav-tab"
							role="tab"
							aria-selected={modelSettingsStore.activeTab === 'roles'}
							aria-controls="panel-roles"
							id="tab-roles"
							class:active={modelSettingsStore.activeTab === 'roles'}
							onclick={() => modelSettingsStore.activeTab = 'roles'}
						>
							Ruoli & Fallback
						</button>
						<button
							class="nav-tab"
							role="tab"
							aria-selected={modelSettingsStore.activeTab === 'catalog'}
							aria-controls="panel-catalog"
							id="tab-catalog"
							class:active={modelSettingsStore.activeTab === 'catalog'}
							onclick={() => modelSettingsStore.activeTab = 'catalog'}
						>
							Catalogo ({modelSettingsStore.catalog.length})
						</button>
						<button
							class="nav-tab"
							role="tab"
							aria-selected={modelSettingsStore.activeTab === 'providers'}
							aria-controls="panel-providers"
							id="tab-providers"
							class:active={modelSettingsStore.activeTab === 'providers'}
							onclick={() => modelSettingsStore.activeTab = 'providers'}
						>
							Provider & Custom
						</button>
					</div>

					<!-- Content Body -->
					<div class="modal-body">
						{#if modelSettingsStore.loading}
							<div class="loading-state">
								<span class="spinner"></span>
								<span>Caricamento configurazione modelli OMP...</span>
							</div>
						{:else if modelSettingsStore.activeTab === 'roles'}
							<div id="panel-roles" role="tabpanel" aria-labelledby="tab-roles" class="tab-panel">
								<RolesTab />
							</div>
						{:else if modelSettingsStore.activeTab === 'catalog'}
							<div id="panel-catalog" role="tabpanel" aria-labelledby="tab-catalog" class="tab-panel">
								<CatalogTab />
							</div>
						{:else if modelSettingsStore.activeTab === 'providers'}
							<div id="panel-providers" role="tabpanel" aria-labelledby="tab-providers" class="tab-panel">
								<ProvidersTab />
							</div>
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
									<span class="unsaved-dot"></span>
									<span>Modifiche non salvate</span>
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
							<button class="btn btn-secondary" onclick={requestClose}>Chiudi</button>
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
				{:else if settingsStore.section === 'general'}
					<div class="modal-body">
						<GeneralSection />
					</div>
				{:else if settingsStore.section === 'projectBar'}
					<div class="modal-body">
						<ProjectBarSection />
					</div>
				{:else if settingsStore.section === 'workspace'}
					<div class="modal-body">
						<WorkspaceSection />
					</div>
				{:else if settingsStore.section === 'tasks'}
					<div class="modal-body">
						<TasksSection />
					</div>
				{/if}
			</div>
		</div>

		<!-- Dialog di conferma scarto modifiche -->
		{#if showDiscardConfirm}
			<div class="confirm-overlay" transition:fade={{ duration: 100 }}>
				<div class="confirm-box" transition:fly={{ y: -8, duration: 150 }}>
					<h4>Scartare le modifiche non salvate?</h4>
					<p>Hai apportato modifiche alla configurazione dei modelli che andranno perse se chiudi ora.</p>
					<div class="confirm-actions">
						<button class="btn btn-secondary" onclick={cancelDiscard}>Continua a modificare</button>
						<button class="btn btn-primary" onclick={forceClose}>Scarta e chiudi</button>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Modal secondario per approvazione version bump -->
	<UpgradeModal />
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		opacity: 0.75;
		z-index: var(--z-backdrop);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 1080px;
		max-width: 96vw;
		height: 86vh;
		max-height: 760px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-3);
		min-height: 48px;
	}

	.header-main {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.header-icon {
		color: var(--ink-muted);
		flex-shrink: 0;
	}

	.title-sep {
		color: var(--ink-faint);
		font-weight: 400;
	}

	.title-section {
		color: var(--ink-muted);
		font-weight: 500;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-header-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn-header-action:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.btn-header-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-header-action.spinning svg {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.btn-close {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		font-size: 18px;
		line-height: 1;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-layout {
		flex: 1;
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	.section-nav {
		width: 172px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		border-right: 1px solid var(--line);
		background: var(--bg-raised);
		overflow-y: auto;
	}

	.section-nav-item {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-sm);
		font-family: var(--font-ui);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.section-nav-item:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.section-nav-item.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
		box-shadow: inset 2px 0 0 var(--brand);
	}

	.section-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.modal-nav {
		display: flex;
		align-items: center;
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
		gap: var(--space-1);
	}

	.nav-tab {
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border: none;
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		position: relative;
		transition: color var(--dur-fast);
	}

	.nav-tab:hover {
		color: var(--ink);
	}

	.nav-tab.active {
		color: var(--ink);
		font-weight: 600;
	}

	.nav-tab.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: var(--space-3);
		right: var(--space-3);
		height: 2px;
		background: var(--brand);
	}

	.modal-body {
		flex: 1;
		overflow-y: auto;
		background: var(--bg-base);
		position: relative;
	}

	.tab-panel {
		height: 100%;
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		height: 100%;
		min-height: 240px;
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.spinner {
		width: 22px;
		height: 22px;
		border: 2px solid var(--line-strong);
		border-top-color: var(--brand);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
		min-height: 48px;
		gap: var(--space-3);
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.footer-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.unsaved-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.unsaved-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand);
	}

	.status-toast {
		font-size: var(--text-xs);
		color: var(--ink);
		background: var(--bg-hover);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: var(--font-ui);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-active);
		border-color: var(--line-strong);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.confirm-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 85%, black);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-overlay);
	}

	.confirm-box {
		width: 400px;
		max-width: 90%;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.confirm-box h4 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--ink);
	}

	.confirm-box p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
