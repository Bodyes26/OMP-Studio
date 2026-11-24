<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconRefresh, IconSearch, IconSettings } from '#lib/icons.ts';
	import { settingsStore, type SettingsSection } from '#lib/stores/settings.svelte.ts';
	import { modelSettingsStore } from '#lib/stores/modelSettings.svelte.ts';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
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
	import CommandsSection from './CommandsSection.svelte';
	import DevicesSection from './devices/DevicesSection.svelte';
	import PairRequestDialog from './devices/PairRequestDialog.svelte';
	import BackgroundJobsSection from './BackgroundJobsSection.svelte';
	import StatsSection from './StatsSection.svelte';
	import { doctorStore } from '#lib/stores/doctor.svelte.ts';
	import { studioUpdaterStore } from '#lib/stores/studioUpdater.svelte.ts';

	type ModelTab = typeof modelSettingsStore.activeTab;
	type NavItem = { id: SettingsSection | 'updates'; label: string; modelTab?: ModelTab };
	const NAV_GROUPS = $derived.by((): { label: string; items: NavItem[] }[] => [
		{ label: 'omp', items: [
			{ id: 'models', modelTab: 'catalog', label: m.settings_redo_models() },
			{ id: 'models', modelTab: 'roles', label: m.settings_models_tab_roles() },
			{ id: 'models', modelTab: 'providers', label: m.settings_models_tab_providers() },
			{ id: 'stats', label: m.settings_nav_stats() }
		] },
		{ label: 'Studio', items: [
			{ id: 'devices', label: m.devices_title() },
			{ id: 'updates', label: m.settings_redo_updates() },
			{ id: 'general', label: m.settings_nav_general() },
			{ id: 'appearance', label: m.settings_nav_appearance() },
			{ id: 'accessibility', label: m.settings_nav_accessibility() },
			{ id: 'notifications', label: m.settings_nav_notifications() },
			{ id: 'companion', label: m.settings_nav_companion() }
		] },
		{ label: m.settings_nav_workspace(), items: [
			{ id: 'workspace', label: m.settings_nav_workspace() },
			{ id: 'projectBar', label: m.settings_nav_project_bar() },
			{ id: 'tasks', label: m.settings_nav_tasks() },
			{ id: 'commands', label: m.settings_nav_commands() },
			{ id: 'suggestions', label: m.settings_nav_suggestions() },
			{ id: 'backgroundJobs', label: m.settings_nav_background_jobs() },
			{ id: 'github', label: 'GitHub' },
			{ id: 'doctor', label: m.settings_nav_doctor() }
		] }
	]);

	function selected(item: NavItem): boolean {
		return item.id === settingsStore.section &&
			(!item.modelTab || item.modelTab === modelSettingsStore.activeTab);
	}

	function select(item: NavItem): void {
		if (item.id === 'updates') {
			studioUpdaterStore.openModal();
			return;
		}
		if (item.modelTab) modelSettingsStore.activeTab = item.modelTab;
		settingsStore.section = item.id;
	}

	// Stato di una sezione letto da un numero, non da un puntino colorato: gli
	// avvisi in ambra (attention), gli aggiornamenti disponibili neutri.
	type NavCount = { value: number; attention: boolean; detail: string };

	const navCounts = $derived.by((): Partial<Record<SettingsSection, NavCount>> => {
		const counts: Partial<Record<SettingsSection, NavCount>> = {};
		const level = modelSettingsStore.attentionLevel;
		if (level !== 'none') {
			const warn = level === 'warn';
			counts.models = {
				value: modelSettingsStore.attentionCount,
				attention: warn,
				detail: modelSettingsStore.attentionTooltip || m.settings_models_attention_fallback()
			};
		}
		if (doctorStore.issuesCount > 0) {
			counts.doctor = {
				value: doctorStore.issuesCount,
				attention: true,
				detail: m.settings_doctor_issues_detected({ count: doctorStore.issuesCount })
			};
		}
		return counts;
	});

	let showDiscardConfirm = $state(false);

	const sectionLabel = $derived(NAV_GROUPS.flatMap((group) => group.items).find(selected)?.label ?? '');
	const blockingCount = $derived(modelSettingsStore.attentionLevel === 'warn' ? modelSettingsStore.attentionCount : 0);

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

			<Tooltip text={m.settings_models_restart_omp_tooltip()} placement="bottom">
				<button type="button" class="ui-button ui-button-secondary header-action" onclick={handleRestart}>
					<IconRefresh />
					<span>{m.settings_models_restart_omp()}</span>
				</button>
			</Tooltip>
		{/if}
	{/snippet}

	<div class="modal-layout">
		<!-- Nav di primo livello -->
		<nav class="section-nav" aria-label={m.ui_settingsmodal_sezioni_impostazioni_7e84()}>
			{#each NAV_GROUPS as group (group.label)}
				<div class="section-nav-group">
					<span class="section-nav-heading">{group.label}</span>
					{#each group.items as item (item.modelTab ?? item.id)}
						{@const count = item.id === 'updates' || (item.modelTab && item.modelTab !== 'catalog') ? undefined : navCounts[item.id]}
						<Tooltip text={count?.detail} placement="bottom" disabled={!count}>
							<button
								type="button"
								class="section-nav-item"
								class:active={selected(item)}
								aria-current={selected(item) ? 'page' : undefined}
								onclick={() => select(item)}
							>
								<span class="section-nav-label">{item.label}</span>
								{#if count}
									<span class="ui-count" class:attention={count.attention}>{count.value}</span>
								{/if}
							</button>
						</Tooltip>
					{/each}
				</div>
			{/each}
		</nav>

		<div class="section-content">
			{#if settingsStore.section === 'models'}
				<div class="modal-body">
					{#if modelSettingsStore.loading}
						<div class="loading-state">
							<StatusMark status="running" />
							<span>{m.ui_settingsmodal_caricamento_configurazione_modelli_omp_71c9()}</span>
						</div>
					{:else}
						<div class="tab-panel">
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
								<span>{m.settings_models_unsaved_changes()}</span>
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
								{m.settings_models_reset_draft()}
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
								{m.companion_status_saving()}
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
					{:else if settingsStore.section === 'commands'}
						<CommandsSection />
					{:else if settingsStore.section === 'backgroundJobs'}
						<BackgroundJobsSection />
					{:else if settingsStore.section === 'stats'}
						<StatsSection />
					{:else if settingsStore.section === 'github'}
						<GithubSection />
					{:else if settingsStore.section === 'doctor'}
						<DoctorSection />
					{:else if settingsStore.section === 'devices'}
						<DevicesSection />
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#snippet outside()}
		<!-- Dialoghi secondari nel top layer (referto di salute, conferma di scarto
		     e richieste di abbinamento in arrivo R-MI-54: queste ultime riguardano
		     tutta l'app, non solo la sezione Dispositivi). -->
		<ModelHealthModal />
		<PairRequestDialog />

		<Dialog
			open={showDiscardConfirm}
			title={m.settings_models_discard_title()}
			onClose={cancelDiscard}
			initialFocus=".discard-keep"
		>
			<p class="discard-text">{m.ui_settingsmodal_hai_apportato_modifiche_alla_configurazione_dei_modelli_171d()}</p>
			{#snippet footer()}
				<button type="button" class="ui-button ui-button-secondary discard-keep" onclick={cancelDiscard}>{m.settings_models_keep_editing()}</button>
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

	.section-nav-group {
		display: grid;
		gap: 2px;
	}

	.section-nav-group + .section-nav-group { margin-top: var(--space-3); }

	.section-nav-heading {
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.section-nav-group > :global(.tooltip-wrapper) { display: flex; }

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
