<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconRefresh, IconSearch, IconSettings } from '$lib/icons';
	import { settingsStore, type SettingsSection } from '$lib/stores/settings.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import ColumnTabs from '$lib/ui/ColumnTabs.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import RolesTab from '../models/RolesTab.svelte';
	import CatalogTab from '../models/CatalogTab.svelte';
	import ProvidersTab from '../models/ProvidersTab.svelte';
	import ModelHealthModal from '../models/ModelHealthModal.svelte';
	import GeneralSection from './GeneralSection.svelte';
	import AppearanceSection from './AppearanceSection.svelte';
	import NotificationsSection from './NotificationsSection.svelte';
	import ProjectBarSection from './ProjectBarSection.svelte';
	import WorkspaceSection from './WorkspaceSection.svelte';
	import TasksSection from './TasksSection.svelte';
	import SuggestionsSection from './SuggestionsSection.svelte';
	import AccessibilitySection from './AccessibilitySection.svelte';
	import CompanionSection from './CompanionSection.svelte';
	import GithubSection from './GithubSection.svelte';
	import DoctorSection from './DoctorSection.svelte';
	import { doctorStore } from '$lib/stores/doctor.svelte';

	// Navigazione di primo livello: ogni voce apre una sezione del centro
	// impostazioni. "Modelli" e' l'unica con le tre schede orizzontali storiche.
	const NAV_SECTIONS = $derived.by((): { id: SettingsSection; label: string }[] => [
		{ id: 'general', label: m.settings_nav_general() },
		{ id: 'appearance', label: m.settings_nav_appearance() },
		{ id: 'companion', label: m.settings_nav_companion() },
		{ id: 'accessibility', label: m.settings_nav_accessibility() },
		{ id: 'notifications', label: m.settings_nav_notifications() },
		{ id: 'projectBar', label: m.settings_nav_project_bar() },
		{ id: 'workspace', label: m.settings_nav_workspace() },
		{ id: 'tasks', label: m.settings_nav_tasks() },
		{ id: 'suggestions', label: m.settings_nav_suggestions() },
		{ id: 'models', label: m.settings_nav_models() },
		{ id: 'github', label: 'GitHub' },
		{ id: 'doctor', label: m.settings_nav_doctor() }
	]);

	const MODEL_TABS = $derived([
		{ id: 'roles', label: 'Ruoli & Fallback' },
		{ id: 'catalog', label: `Catalogo (${modelSettingsStore.catalog.length})` },
		{ id: 'providers', label: 'Provider & Custom' }
	]);

	// Stato di una sezione letto da un numero, non da un puntino colorato: gli
	// avvisi in ambra (attention), gli aggiornamenti disponibili neutri.
	type NavCount = { value: number; attention: boolean; detail: string };

	const navCounts = $derived.by((): Partial<Record<SettingsSection, NavCount>> => {
		const counts: Partial<Record<SettingsSection, NavCount>> = {};
		const level = modelSettingsStore.attentionLevel;
		if (level !== 'none') {
			const warn = level === 'warn';
			counts.models = {
				value: warn ? modelSettingsStore.blockingFindings.length : modelSettingsStore.upgradeFindings.length,
				attention: warn,
				detail: modelSettingsStore.attentionTooltip || 'Avvisi sui modelli'
			};
		}
		if (doctorStore.issuesCount > 0) {
			counts.doctor = {
				value: doctorStore.issuesCount,
				attention: true,
				detail: `${doctorStore.issuesCount} anomalie rilevate`
			};
		}
		return counts;
	});

	let showDiscardConfirm = $state(false);

	const sectionLabel = $derived(NAV_SECTIONS.find((s) => s.id === settingsStore.section)?.label ?? '');
	const blockingCount = $derived(modelSettingsStore.healthReport ? (modelSettingsStore.blockingFindings?.length ?? 0) : 0);

	function requestClose() {
		// Esc arriva al dialogo anche col referto salute aperto sopra: chiude solo quello.
		if (modelSettingsStore.healthModalOpen) {
			modelSettingsStore.healthModalOpen = false;
			return;
		}
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

	function handleCheckHealth() {
		void modelSettingsStore.checkHealth({ refresh: true });
	}

	// La sezione Modelli e' raggiungibile anche senza passare da `openModal()`
	// (voce di navigazione, chip Impostazioni con avviso): senza questo
	// caricamento i ruoli risulterebbero tutti "Non configurato".
	$effect(() => {
		if (settingsStore.open && settingsStore.section === 'models') {
			void modelSettingsStore.ensureLoaded();
		}
	});
</script>

<Dialog
	open={settingsStore.open}
	title={`${m.ui_settingsmodal_impostazioni_d713()} · ${sectionLabel}`}
	onClose={requestClose}
	size="wide"
	flush
	initialFocus=".section-nav-item.active"
>
	{#snippet icon()}
		<IconSettings />
	{/snippet}

	{#snippet actions()}
		{#if settingsStore.section === 'models'}
			<Tooltip text={m.ui_settingsmodal_verifica_disponibilita_e_versioni_dei_modelli_configurati_02ef()} placement="bottom">
				<button
					type="button"
					class="ui-button ui-button-secondary header-action"
					class:loading={modelSettingsStore.isCheckingHealth}
					disabled={modelSettingsStore.isCheckingHealth}
					onclick={handleCheckHealth}
				>
					{#if modelSettingsStore.isCheckingHealth}
						<StatusMark status="running" />
					{:else}
						<IconSearch />
					{/if}
					<span>{modelSettingsStore.isCheckingHealth ? m.page_omp_update_status_checking() : m.ui_settingsmodal_verifica_modelli_3b0a()}</span>
					{#if blockingCount > 0}
						<span class="ui-count attention">{blockingCount}</span>
					{/if}
				</button>
			</Tooltip>

			<Tooltip text="Riavvia le sessioni OMP aperte per applicare le configurazioni" placement="bottom">
				<button type="button" class="ui-button ui-button-secondary header-action" onclick={handleRestart}>
					<IconRefresh />
					<span>Riavvia OMP</span>
				</button>
			</Tooltip>
		{/if}
	{/snippet}

	<div class="modal-layout">
		<!-- Nav di primo livello -->
		<nav class="section-nav" aria-label={m.ui_settingsmodal_sezioni_impostazioni_7e84()}>
			{#each NAV_SECTIONS as s (s.id)}
				{@const count = navCounts[s.id]}
				<Tooltip text={count?.detail} placement="bottom" disabled={!count}>
					<button
						type="button"
						class="section-nav-item"
						class:active={settingsStore.section === s.id}
						aria-current={settingsStore.section === s.id ? 'page' : undefined}
						onclick={() => (settingsStore.section = s.id)}
					>
						<span class="section-nav-label">{s.label}</span>
						{#if count}
							<span class="ui-count" class:attention={count.attention}>{count.value}</span>
						{/if}
					</button>
				</Tooltip>
			{/each}
		</nav>

		<div class="section-content">
			{#if settingsStore.section === 'models'}
				<div class="models-tabs">
					<ColumnTabs
						tabs={MODEL_TABS}
						selected={modelSettingsStore.activeTab}
						onChange={(id) => (modelSettingsStore.activeTab = id as typeof modelSettingsStore.activeTab)}
						ariaLabel={m.ui_settingsmodal_sezioni_impostazioni_modelli_b9dd()}
						tabIdPrefix="settings-models-tab-"
						panelIdPrefix="settings-models-panel-"
					/>
				</div>

				<div class="modal-body">
					{#if modelSettingsStore.loading}
						<div class="loading-state">
							<StatusMark status="running" />
							<span>{m.ui_settingsmodal_caricamento_configurazione_modelli_omp_71c9()}</span>
						</div>
					{:else}
						<div
							id={`settings-models-panel-${modelSettingsStore.activeTab}`}
							role="tabpanel"
							aria-labelledby={`settings-models-tab-${modelSettingsStore.activeTab}`}
							class="tab-panel"
						>
							{#if modelSettingsStore.activeTab === 'roles'}
								<RolesTab />
							{:else if modelSettingsStore.activeTab === 'catalog'}
								<CatalogTab />
							{:else if modelSettingsStore.activeTab === 'providers'}
								<ProvidersTab />
							{/if}
						</div>
					{/if}
				</div>

				<div class="modal-footer">
					<div class="footer-left">
						{#if modelSettingsStore.statusToast}
							<span class="status-toast rv-blur">{modelSettingsStore.statusToast}</span>
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
								type="button"
								class="ui-button ui-button-secondary"
								disabled={modelSettingsStore.saving}
								onclick={() => modelSettingsStore.resetDraft()}
							>
								Reimposta
							</button>
						{/if}
						<button type="button" class="ui-button ui-button-secondary" onclick={requestClose}>{m.page_modal_restart_btn_close()}</button>
						<button
							type="button"
							class="ui-button ui-button-primary"
							disabled={!modelSettingsStore.hasUnsavedChanges || modelSettingsStore.saving}
							onclick={handleSave}
						>
							{#if modelSettingsStore.saving}
								Salvataggio...
							{:else}
								{m.ui_settingsmodal_salva_modifiche_891d()}
							{/if}
						</button>
					</div>
				</div>
			{:else}
				<div class="modal-body">
					{#if settingsStore.section === 'general'}
						<GeneralSection />
					{:else if settingsStore.section === 'appearance'}
						<AppearanceSection />
					{:else if settingsStore.section === 'companion'}
						<CompanionSection />
					{:else if settingsStore.section === 'accessibility'}
						<AccessibilitySection />
					{:else if settingsStore.section === 'notifications'}
						<NotificationsSection />
					{:else if settingsStore.section === 'projectBar'}
						<ProjectBarSection />
					{:else if settingsStore.section === 'workspace'}
						<WorkspaceSection />
					{:else if settingsStore.section === 'tasks'}
						<TasksSection />
					{:else if settingsStore.section === 'suggestions'}
						<SuggestionsSection />
					{:else if settingsStore.section === 'github'}
						<GithubSection />
					{:else if settingsStore.section === 'doctor'}
						<DoctorSection />
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#snippet outside()}
		<!-- Dentro il <dialog>: fuori dal top layer il referto e la conferma sarebbero inerti. -->
		<ModelHealthModal />

		<Dialog
			open={showDiscardConfirm}
			title="Scartare le modifiche non salvate?"
			onClose={cancelDiscard}
			initialFocus=".discard-keep"
		>
			<p class="discard-text">{m.ui_settingsmodal_hai_apportato_modifiche_alla_configurazione_dei_modelli_171d()}</p>
			{#snippet footer()}
				<button type="button" class="ui-button ui-button-secondary discard-keep" onclick={cancelDiscard}>Continua a modificare</button>
				<button type="button" class="ui-button ui-button-danger" onclick={forceClose}>{m.ui_settingsmodal_scarta_e_chiudi_3a7c()}</button>
			{/snippet}
		</Dialog>
	{/snippet}
</Dialog>

<style>
	.header-action.loading:disabled {
		opacity: 0.85;
		cursor: wait;
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

	/* Il Tooltip avvolge ogni voce: l'involucro deve occupare la riga intera. */
	.section-nav > :global(.tooltip-wrapper) {
		display: flex;
	}

	.section-nav-item {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-label);
		font-family: var(--font-ui);
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.section-nav-item:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.section-nav-item.active {
		background: var(--bg-active);
		color: var(--ink);
	}

	.section-nav-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.section-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.models-tabs {
		flex-shrink: 0;
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-raised);
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
		font-size: var(--text-label);
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
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
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.unsaved-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
	}

	.status-toast {
		--dur: var(--dur-menu);
		font-size: var(--text-caption);
		color: var(--ink);
		background: var(--bg-hover);
		padding: 3px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.discard-text {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink-muted);
		line-height: 1.45;
	}
</style>
