import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import { restartOmpTerminals } from '../terminal/terminal';
import { settingsStore } from './settings.svelte';
import {
	IconRoleDefault,
	IconRolePlan,
	IconRoleSmol,
	IconRoleSlow,
	IconRoleVision,
	IconRoleTask,
	IconRoleCommit,
	IconRoleAdvisor
} from '../icons';
import type {
	ModelCost,
	ModelThinkingInfo,
	ModelDto,
	AuthAccount,
	ProviderSummary,
	ThinkingLevel
} from './modelSettingsHelpers';
import {
	mergeProviderIntoCatalog,
	isAuthAccountActive,
	getProviderEnvVarHint,
	resolveCatalogModel,
	sanitizeMaxDynamic,
	splitModelSelector
} from './modelSettingsHelpers';

export type {
	ModelCost,
	ModelThinkingInfo,
	ModelDto,
	AuthAccount,
	ProviderSummary,
	ThinkingLevel
};
export {
	mergeProviderIntoCatalog,
	isAuthAccountActive,
	getProviderEnvVarHint,
	resolveCatalogModel,
	sanitizeMaxDynamic,
	splitModelSelector
};
export interface CustomModelDef {
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: string[];
}

export interface CustomProviderDef {
	baseUrl: string;
	apiKey?: string;
	api?: string;
	models: CustomModelDef[];
}

export interface CustomProvidersFile {
	providers: Record<string, CustomProviderDef>;
}

export interface AuthProviderSummary {
	provider: string;
	credentialType: string;
	identityKey?: string;
	hasCredential: boolean;
	disabledCause?: string;
}


export interface ModelConfigDto {
	modelRoles: Record<string, string>;
	cycleOrder: string[];
	disabledProviders: string[];
	fallbackChains: Record<string, string[]>;
	defaultThinkingLevel?: string;
}

export interface ModelFinding {
	role: string;
	kind: 'primary' | 'fallback';
	index: number | null;
	currentSelector: string;
	currentModelId: string;
	currentProvider: string;
	currentThinking: string | null;
	severity: 'error' | 'warn' | 'info';
	code: 'removed' | 'not_offered' | 'provider_disabled' | 'provider_unconfigured' | 'upgrade';
	reason: string;
	suggestedSelector: string | null;
	suggestedModelName: string | null;
}

export interface ModelHealthReport {
	checkedAt: number;
	catalogAgeDays: number | null;
	catalogError: string | null;
	findings: ModelFinding[];
}

export interface ModelFixItem {
	role: string;
	kind: 'primary' | 'fallback';
	index: number | null;
	action: 'replace' | 'remove';
	newSelector: string | null;
}

/**
 * Calcola un fingerprint deterministico e compatto a partire dall'elenco di findings.
 * Concatena i campi identificativi ordinati per rilevare variazioni del referto.
 */
export function computeFindingsFingerprint(findings: ModelFinding[]): string {
	if (findings.length === 0) return '';
	const sorted = [...findings].sort((a, b) => {
		const keyA = `${a.code}|${a.role}|${a.kind}|${a.index ?? -1}|${a.currentSelector}`;
		const keyB = `${b.code}|${b.role}|${b.kind}|${b.index ?? -1}|${b.currentSelector}`;
		return keyA.localeCompare(keyB);
	});
	return sorted
		.map((f) => `${f.code}|${f.role}|${f.kind}|${f.index ?? -1}|${f.currentSelector}`)
		.join(';');
}

export const STANDARD_ROLES = [
	{ id: 'default', label: 'Default / Chat', icon: IconRoleDefault, abbr: 'CH', desc: 'Modello principale per conversazione e attivita generali' },
	{ id: 'plan', label: 'Architectural Plan', icon: IconRolePlan, abbr: 'PL', desc: 'Modello per pianificazione e analisi architetturale' },
	{ id: 'smol', label: 'Smol (Fast)', icon: IconRoleSmol, abbr: 'SM', desc: 'Modello ultra-rapido per compiti leggeri, esplorazione e scouting' },
	{ id: 'slow', label: 'Slow (Reasoning)', icon: IconRoleSlow, abbr: 'SL', desc: 'Modello per ragionamenti complessi e deduzioni approfondite' },
	{ id: 'vision', label: 'Vision / Images', icon: IconRoleVision, abbr: 'VI', desc: 'Modello multimodale per ispezione e comprensione immagini' },
	{ id: 'task', label: 'Task Subagents', icon: IconRoleTask, abbr: 'TS', desc: 'Modello delegato per subagenti ed esecuzioni parallele' },
	{ id: 'commit', label: 'Git Commit', icon: IconRoleCommit, abbr: 'CM', desc: 'Modello per generazione messaggi di commit e changelog' },
	{ id: 'advisor', label: 'Advisor (Reviewer)', icon: IconRoleAdvisor, abbr: 'AD', desc: 'Modello di revisione e controllo passivo di qualita' }
] as const;

export const THINKING_LEVELS = [
	{ id: 'auto', label: 'Auto', desc: 'Deciso dal modello' },
	{ id: 'off', label: 'Off', desc: 'Disabilitato' },
	{ id: 'minimal', label: 'Minimal', desc: 'Ragionamento minimo' },
	{ id: 'low', label: 'Low', desc: 'Ragionamento basso' },
	{ id: 'medium', label: 'Medium', desc: 'Ragionamento medio' },
	{ id: 'high', label: 'High', desc: 'Ragionamento alto' },
	{ id: 'xhigh', label: 'Extra High', desc: 'Ragionamento molto alto' },
	{ id: 'max', label: 'Max', desc: 'Ragionamento massimo' }
] as const;

export interface SuggestedModelItem {
	selector: string;
	reason: string;
	badge?: string;
	recommendedThinking?: string;
	arenaElo?: number;
	tokensPerSec?: number;
	isSubscription?: boolean;
	isFree?: boolean;
}
export interface RoleSuggestionsResponse {
	roleId: string;
	primary: SuggestedModelItem[];
	fallback: SuggestedModelItem[];
}


class ModelSettingsStore {
	/** Apertura/sezione hanno un'unica fonte: `settingsStore`. Nessun secondo flag da tenere allineato. */
	get isOpen() {
		return settingsStore.open && settingsStore.section === 'models';
	}
	activeTab = $state<'roles' | 'catalog' | 'providers'>('roles');
	
	loading = $state(false);
	saving = $state(false);
	isRefreshingCatalog = $state(false);
	isCheckingHealth = $state(false);
	config = $state<ModelConfigDto | null>(null);
	draftConfig = $state<ModelConfigDto | null>(null);
	catalog = $state<ModelDto[]>([]);
	availableCatalog = $state<ModelDto[]>([]);
	availableCatalogLoaded = $state(false);
	customProviders = $state<Record<string, CustomProviderDef>>({});
	draftCustomProviders = $state<Record<string, CustomProviderDef>>({});
	authProviders = $state<AuthProviderSummary[]>([]);
	providers = $state<ProviderSummary[]>([]);
	authAccounts = $state<AuthAccount[]>([]);
	selectedProviderId = $state<string | null>(null);
	catalogFilterProviderId = $state<string | null>(null);
	
	healthReport = $state<ModelHealthReport | null>(null);
	healthModalOpen = $state(false);
	lastCheckAt = $state<number>(0);
	dismissedFingerprint = $state<string>('');
	statusToast = $state<string | null>(null);
	private healthWatchInitialized = false;
	private healthIntervalTimer: number | null = null;
	private healthBootstrapTimer: number | null = null;
	private healthSettingsStore: Store | null = null;
	private loadProvidersPromise: Promise<void> | null = null;
	private ensureLoadedPromise: Promise<void> | null = null;
	private providersRequested = false;


	suggestionsCache = new Map<string, RoleSuggestionsResponse>();
	loadingSuggestionsRole = $state<string | null>(null);

	hasUnsavedChanges = $derived.by(() => {
		if (!this.config || !this.draftConfig) return false;
		const cfgChanged = JSON.stringify(this.config) !== JSON.stringify(this.draftConfig);
		const customChanged = JSON.stringify(this.customProviders) !== JSON.stringify(this.draftCustomProviders);
		return cfgChanged || customChanged;
	});

	knownSelectors = $derived.by<ReadonlySet<string>>(() => {
		const list = this.catalog ?? [];
		return new Set(list.map((m) => m.selector));
	});

	blockingFindings = $derived.by<ModelFinding[]>(() => {
		return (this.healthReport?.findings ?? []).filter((f) => f.code !== 'upgrade');
	});

	upgradeFindings = $derived.by<ModelFinding[]>(() => {
		return (this.healthReport?.findings ?? []).filter((f) => f.code === 'upgrade');
	});

	currentFingerprint = $derived.by<string>(() => {
		return computeFindingsFingerprint(this.healthReport?.findings ?? []);
	});

	attentionLevel = $derived.by<'none' | 'info' | 'warn'>(() => {
		const findings = this.healthReport?.findings ?? [];
		if (findings.length === 0) return 'none';
		if (this.currentFingerprint === this.dismissedFingerprint) return 'none';
		if (this.blockingFindings.length > 0) return 'warn';
		if (this.upgradeFindings.length > 0) return 'info';
		return 'none';
	});

	attentionTooltip = $derived.by<string>(() => {
		if (this.attentionLevel === 'none') return '';
		if (this.blockingFindings.length > 0) {
			const count = this.blockingFindings.length;
			const label =
				count === 1 ? '1 modello non piu utilizzabile' : `${count} modelli non piu utilizzabili`;
			const details = this.blockingFindings
				.map((f) => (f.kind === 'fallback' ? `${f.role} #${(f.index ?? 0) + 1}` : f.role))
				.join(', ');
			return `${label}: ${details}`;
		}
		if (this.upgradeFindings.length > 0) {
			const count = this.upgradeFindings.length;
			return count === 1
				? '1 aggiornamento modello disponibile'
				: `${count} aggiornamenti modello disponibili`;
		}
		return '';
	});

	/**
	 * Catalogo da usare in ogni selettore di assegnazione (ruoli, riserve,
	 * ciclo rapido, task): solo modelli raggiungibili con le credenziali che
	 * l'utente ha davvero. `catalog` e' l'elenco completo noto a OMP e serve
	 * alla scheda Catalogo e alle ricerche di metadati, non alla scelta.
	 *
	 * `availableCatalog` arriva da `omp models --json`. Se la CLI non risponde
	 * si ripiega sul catalogo completo filtrato per i provider marcati
	 * configurati e abilitati; se nemmeno quello e' noto si torna al catalogo
	 * intero, perche' un elenco largo e' comunque meglio di un elenco vuoto.
	 */
	assignableCatalog = $derived.by(() => {
		if (this.availableCatalog.length > 0) return this.availableCatalog;
		const usable = new Set(
			this.providers.filter((p) => p.configured && p.enabled).map((p) => p.id)
		);
		if (usable.size === 0) return this.catalog;
		const filtered = this.catalog.filter((m) => usable.has(m.provider));
		return filtered.length > 0 ? filtered : this.catalog;
	});

	openModal(tab: 'roles' | 'catalog' | 'providers' = 'roles', targetProvider?: string) {
		this.activeTab = tab;
		if (targetProvider) {
			if (tab === 'catalog') {
				this.catalogFilterProviderId = targetProvider;
			} else {
				this.selectedProviderId = targetProvider;
			}
		}
		settingsStore.openSection('models');
		void this.loadAll();
	}

	closeModal() {
		settingsStore.close();
	}

	showToast(msg: string, duration = 3500) {
		this.statusToast = msg;
		setTimeout(() => {
			if (this.statusToast === msg) {
				this.statusToast = null;
			}
		}, duration);
	}

	async loadAll() {
		this.loading = true;
		try {
			const [cfg, cat, available, custom, auth] = await Promise.all([
				invoke<ModelConfigDto>('get_model_config'),
				invoke<ModelDto[]>('get_models_catalog'),
				invoke<ModelDto[]>('get_available_models_catalog').catch((error) => {
					console.warn('Available models catalog:', error);
					return [];
				}),
				invoke<CustomProvidersFile>('get_custom_providers'),
				invoke<AuthProviderSummary[]>('get_auth_providers_summary'),
				this.loadProviders(),
				this.loadAccounts()
			]);

			this.config = cfg;
			this.draftConfig = JSON.parse(JSON.stringify(cfg));
			this.catalog = cat;
			this.availableCatalog = available;
			this.availableCatalogLoaded = true;
			this.customProviders = custom.providers || {};
			this.draftCustomProviders = JSON.parse(JSON.stringify(custom.providers || {}));
			this.authProviders = auth;
		} catch (e) {
			console.error('Failed to load model settings:', e);
			this.showToast(`Errore caricamento impostazioni: ${e}`);
		} finally {
			this.loading = false;
		}
	}

	/** Carica il catalogo provider dinamici (builtin, plugin, custom). Errori loggati, non bloccano `loadAll`. */
	async loadProviders() {
		if (this.loadProvidersPromise) return this.loadProvidersPromise;
		this.loadProvidersPromise = (async () => {
			try {
				this.providers = await invoke<ProviderSummary[]>('get_model_providers');
			} catch (e) {
				console.error('Failed to load model providers:', e);
				if (this.providers.length > 0) {
					this.providers = [];
				}
			} finally {
				this.loadProvidersPromise = null;
			}
		})();
		return this.loadProvidersPromise;
	}

	/** Carica gli account di autenticazione, opzionalmente filtrati per provider. */
	async loadAccounts(providerId?: string) {
		try {
			this.authAccounts = await invoke<AuthAccount[]>('get_auth_accounts', { providerId: providerId ?? null });
		} catch (e) {
			console.error('Failed to load auth accounts:', e);
			this.authAccounts = [];
		}
	}

	/** Rimuove un account di autenticazione e ricarica accounts/providers. */
	async removeAccount(provider: string, credentialId: number) {
		try {
			await invoke('remove_auth_account', { provider, credentialId });
			await Promise.all([this.loadAccounts(), this.loadProviders()]);
			this.showToast('Account rimosso');
		} catch (e) {
			console.error('Failed to remove auth account:', e);
			this.showToast(`Errore rimozione account: ${e}`);
		}
	}

	/** Imposta il provider attivo/selezionato nella tab Provider. */
	selectProvider(id: string | null) {
		this.selectedProviderId = id;
	}

	/** Imposta il filtro per provider nella tab Catalogo (`null` = tutti i modelli). */
	setCatalogFilter(id: string | null) {
		this.catalogFilterProviderId = id;
	}

	/** Carica la configurazione e i cataloghi in background senza mostrare toast o bloccare l'interfaccia. */
	async ensureLoaded() {
		// L'elenco provider serve a `assignableCatalog` quando `omp models`
		// non risponde: senza di esso il ripiego non saprebbe quali provider
		// hanno credenziali e mostrerebbe il catalogo intero.
		if (!this.providersRequested) {
			this.providersRequested = true;
			void this.loadProviders();
		}
		if (this.config && this.catalog.length > 0 && this.availableCatalogLoaded) return;
		if (this.ensureLoadedPromise) return this.ensureLoadedPromise;

		this.ensureLoadedPromise = (async () => {
			try {
				const [cfg, cat, available] = await Promise.all([
					invoke<ModelConfigDto>('get_model_config'),
					invoke<ModelDto[]>('get_models_catalog'),
					invoke<ModelDto[]>('get_available_models_catalog').catch((error) => {
						console.warn('Available models catalog:', error);
						return [];
					})
				]);
				if (!this.config) {
					this.config = cfg;
					this.draftConfig = JSON.parse(JSON.stringify(cfg));
				}
				if (this.catalog.length === 0) {
					this.catalog = cat;
				}
				this.availableCatalog = available;
				this.availableCatalogLoaded = true;
			} catch (e) {
				console.error('ensureLoaded failed:', e);
			} finally {
				this.ensureLoadedPromise = null;
			}
		})();

		return this.ensureLoadedPromise;
	}

	async saveConfig() {
		if (!this.draftConfig) return false;
		this.saving = true;
		try {
			const cfgChanged = JSON.stringify(this.config) !== JSON.stringify(this.draftConfig);
			const customChanged = JSON.stringify(this.customProviders) !== JSON.stringify(this.draftCustomProviders);

			if (cfgChanged) {
				await invoke('save_model_config', { config: this.draftConfig });
				this.config = JSON.parse(JSON.stringify(this.draftConfig));
			}

			if (customChanged) {
				await invoke('save_custom_providers', { data: { providers: this.draftCustomProviders } });
				this.customProviders = JSON.parse(JSON.stringify(this.draftCustomProviders));
			}

			if (customChanged || cfgChanged) {
				const cat = await invoke<ModelDto[]>('refresh_models_catalog');
				this.catalog = cat;
				this.availableCatalog = await invoke<ModelDto[]>('get_available_models_catalog');
				this.availableCatalogLoaded = true;
			}
			this.clearSuggestionsCache();
			this.showToast('Configurazione modelli salvata');
			return true;
		} catch (e) {
			console.error('Failed to save model config:', e);
			this.showToast(`Errore salvataggio: ${e}`);
			return false;
		} finally {
			this.saving = false;
		}
	}

	async refreshCatalog(providerId?: string) {
		this.isRefreshingCatalog = true;
		try {
			if (providerId) {
				const providerModels = await invoke<ModelDto[]>('refresh_model_provider', { providerId });
				// Ricarichiamo il catalogo completo o fondiamo per non troncare gli altri provider
				const fullCatalog = await invoke<ModelDto[]>('get_models_catalog').catch(() => []);
				this.catalog = fullCatalog.length > 0
					? fullCatalog
					: mergeProviderIntoCatalog(this.catalog, providerId, providerModels);
				this.availableCatalog = await invoke<ModelDto[]>('get_available_models_catalog').catch(() => []);
				this.availableCatalogLoaded = true;
				this.clearSuggestionsCache();
				void this.loadProviders();
				this.showToast(`Catalogo aggiornato per ${providerId} (${providerModels.length} modelli)`);
			} else {
				const cat = await invoke<ModelDto[]>('refresh_models_catalog');
				this.catalog = cat;
				this.availableCatalog = await invoke<ModelDto[]>('get_available_models_catalog').catch(() => []);
				this.availableCatalogLoaded = true;
				this.clearSuggestionsCache();
				void this.loadProviders();
				this.showToast(`Catalogo aggiornato (${cat.length} modelli)`);
			}
		} catch (e) {
			console.error('Failed to refresh models catalog:', e);
			this.showToast(`Errore aggiornamento catalogo: ${e}`);
		} finally {
			this.isRefreshingCatalog = false;
		}
	}

	// Metodi per modificare draftCustomProviders
	setDraftCustomProvider(name: string, def: CustomProviderDef) {
		this.draftCustomProviders = {
			...this.draftCustomProviders,
			[name]: JSON.parse(JSON.stringify(def))
		};
	}

	deleteDraftCustomProvider(name: string) {
		const updated = { ...this.draftCustomProviders };
		delete updated[name];
		this.draftCustomProviders = updated;
	}

	addDraftCustomModel(providerName: string, model: CustomModelDef) {
		const prov = this.draftCustomProviders[providerName];
		if (!prov) return;
		const updatedModels = [...prov.models, { ...model }];
		this.draftCustomProviders = {
			...this.draftCustomProviders,
			[providerName]: {
				...prov,
				models: updatedModels
			}
		};
	}

	deleteDraftCustomModel(providerName: string, modelIndex: number) {
		const prov = this.draftCustomProviders[providerName];
		if (!prov) return;
		const updatedModels = [...prov.models];
		updatedModels.splice(modelIndex, 1);
		this.draftCustomProviders = {
			...this.draftCustomProviders,
			[providerName]: {
				...prov,
				models: updatedModels
			}
		};
	}

	findingFor(
		role: string,
		kind: 'primary' | 'fallback',
		index?: number | null
	): ModelFinding | undefined {
		const findings = this.healthReport?.findings ?? [];
		return findings.find((f) => {
			if (f.role !== role || f.kind !== kind) return false;
			if (kind === 'fallback') {
				return f.index === (index ?? null);
			}
			return true;
		});
	}

	private async ensureHealthSettingsStore(): Promise<Store | null> {
		if (this.healthSettingsStore) return this.healthSettingsStore;
		try {
			this.healthSettingsStore = await load('settings.json', { autoSave: false });
			return this.healthSettingsStore;
		} catch (e) {
			console.error('Impossibile caricare store settings.json per modelHealth', e);
			return null;
		}
	}

	private async loadHealthSettings(): Promise<void> {
		try {
			const store = await this.ensureHealthSettingsStore();
			if (!store) return;
			const data = await store.get<{ lastCheckAt?: number; dismissedFingerprint?: string }>('modelHealth');
			if (data && typeof data === 'object') {
				if (typeof data.lastCheckAt === 'number' && Number.isFinite(data.lastCheckAt)) {
					this.lastCheckAt = data.lastCheckAt;
				}
				if (typeof data.dismissedFingerprint === 'string') {
					this.dismissedFingerprint = data.dismissedFingerprint;
				}
			}
		} catch (e) {
			console.error('Errore lettura impostazioni modelHealth da settings.json', e);
		}
	}

	private async saveHealthSettings(): Promise<void> {
		try {
			const store = await this.ensureHealthSettingsStore();
			if (!store) return;
			await store.set('modelHealth', {
				lastCheckAt: this.lastCheckAt,
				dismissedFingerprint: this.dismissedFingerprint
			});
			await store.save();
		} catch (e) {
			console.error('Errore salvataggio impostazioni modelHealth in settings.json', e);
		}
	}

	async checkHealth(opts: { refresh?: boolean; silent?: boolean } = {}): Promise<void> {
		const refresh = opts.refresh ?? true;
		const silent = opts.silent ?? false;
		this.isCheckingHealth = true;

		try {
			const currentRoles = this.draftConfig?.modelRoles ?? this.config?.modelRoles ?? null;
			const currentFallbacks =
				this.draftConfig?.fallbackChains ?? this.config?.fallbackChains ?? null;

			const report = await invoke<ModelHealthReport>('check_model_health', {
				roles: currentRoles,
				fallbackChains: currentFallbacks,
				refreshCatalog: refresh ? true : false,
				maxCatalogAgeHours: refresh ? null : 24
			});

			if (refresh) {
				const fullCatalog = await invoke<ModelDto[]>('get_models_catalog').catch(() => []);
				if (fullCatalog.length > 0) {
					this.catalog = fullCatalog;
				}
				this.availableCatalog = await invoke<ModelDto[]>('get_available_models_catalog').catch(() => []);
				this.availableCatalogLoaded = true;
			}

			this.healthReport = report;
			this.lastCheckAt = report.checkedAt || Date.now();

			const newFingerprint = computeFindingsFingerprint(report.findings || []);
			if (newFingerprint !== this.dismissedFingerprint) {
				// Referto con findings diversi da quelli ignorati: azzera il dismiss per riaccendere il badge
				this.dismissedFingerprint = '';
			}
			void this.saveHealthSettings();

			if (!silent) {
				if (report.findings && report.findings.length > 0) {
					this.healthModalOpen = true;
				} else {
					this.showToast('Modelli verificati: nessun problema rilevato');
				}
			}
		} catch (e) {
			if (!silent) {
				console.error('Failed to check model health:', e);
				this.showToast(`Errore verifica modelli: ${e}`);
			} else {
				console.error('Failed to check model health (silent):', e);
			}
		} finally {
			this.isCheckingHealth = false;
		}
	}

	async applyFixes(fixes: ModelFixItem[]): Promise<void> {
		if (fixes.length === 0) return;
		this.saving = true;
		try {
			await invoke('apply_model_fixes', { fixes });
			await this.loadAll();
			this.clearSuggestionsCache();
			this.healthModalOpen = false;
			await this.checkHealth({ refresh: false, silent: true });
			const count = fixes.length;
			this.showToast(
				count === 1
					? 'Correzione modello applicata'
					: `Applicate ${count} correzioni ai modelli`
			);
		} catch (e) {
			console.error('Failed to apply model fixes:', e);
			this.showToast(`Errore applicazione correzioni: ${e}`);
		} finally {
			this.saving = false;
		}
	}

	async dismissHealthFindings(): Promise<void> {
		this.dismissedFingerprint = this.currentFingerprint;
		await this.saveHealthSettings();
		this.healthModalOpen = false;
	}

	initHealthWatch(): void {
		if (this.healthWatchInitialized) return;
		this.healthWatchInitialized = true;

		void this.loadHealthSettings().then(() => {
			if (typeof window !== 'undefined') {
				const HEALTH_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
				const HEALTH_BOOTSTRAP_DELAY_MS = 20_000;

				this.healthBootstrapTimer = window.setTimeout(() => {
					this.healthBootstrapTimer = null;
					const elapsed = Date.now() - this.lastCheckAt;
					if (elapsed > HEALTH_CHECK_INTERVAL_MS) {
						void this.checkHealth({ refresh: false, silent: true });
					}
				}, HEALTH_BOOTSTRAP_DELAY_MS);

				this.healthIntervalTimer = window.setInterval(() => {
					void this.checkHealth({ refresh: false, silent: true });
				}, HEALTH_CHECK_INTERVAL_MS);
			}
		});
	}

	destroyHealthWatch(): void {
		if (typeof window !== 'undefined') {
			if (this.healthBootstrapTimer !== null) {
				clearTimeout(this.healthBootstrapTimer);
				this.healthBootstrapTimer = null;
			}
			if (this.healthIntervalTimer !== null) {
				clearInterval(this.healthIntervalTimer);
				this.healthIntervalTimer = null;
			}
		}
		this.healthWatchInitialized = false;
	}

	restartOmpSessions(targetCwd?: string) {
		restartOmpTerminals(targetCwd);
		this.showToast('Sessioni OMP riavviate');
	}

	// Utility di modifica draftConfig
	setRoleModel(role: string, modelSelector: string, thinkingLevel?: string) {
		if (!this.draftConfig) return;
		let val = modelSelector;
		if (thinkingLevel && thinkingLevel !== 'auto') {
			val = `${modelSelector}:${thinkingLevel}`;
		} else if (thinkingLevel === 'auto') {
			val = modelSelector;
		} else {
			// preserva eventuale livello di thinking esistente
			const current = this.draftConfig.modelRoles[role];
			if (current) {
				const { thinking } = splitModelSelector(current, this.knownSelectors);
				if (thinking) {
					val = `${modelSelector}:${thinking}`;
				}
			}
		}
		this.draftConfig.modelRoles = {
			...this.draftConfig.modelRoles,
			[role]: val
		};
	}

	setRoleThinking(role: string, thinkingLevel: string) {
		if (!this.draftConfig) return;
		const current = this.draftConfig.modelRoles[role];
		if (!current) return;
		const { base } = splitModelSelector(current, this.knownSelectors);
		const val = thinkingLevel === 'auto' ? base : `${base}:${thinkingLevel}`;
		this.draftConfig.modelRoles = {
			...this.draftConfig.modelRoles,
			[role]: val
		};
	}

	removeRole(role: string) {
		if (!this.draftConfig) return;
		const updated = { ...this.draftConfig.modelRoles };
		delete updated[role];
		this.draftConfig.modelRoles = updated;
	}

	addFallback(role: string, modelSelector: string) {
		if (!this.draftConfig) return;
		const list = this.draftConfig.fallbackChains[role] ? [...this.draftConfig.fallbackChains[role]] : [];
		if (!list.includes(modelSelector)) {
			list.push(modelSelector);
		}
		this.draftConfig.fallbackChains = {
			...this.draftConfig.fallbackChains,
			[role]: list
		};
	}

	removeFallback(role: string, index: number) {
		if (!this.draftConfig || !this.draftConfig.fallbackChains[role]) return;
		const list = [...this.draftConfig.fallbackChains[role]];
		list.splice(index, 1);
		this.draftConfig.fallbackChains = {
			...this.draftConfig.fallbackChains,
			[role]: list
		};
	}

	moveFallback(role: string, fromIndex: number, toIndex: number) {
		if (!this.draftConfig || !this.draftConfig.fallbackChains[role]) return;
		const list = [...this.draftConfig.fallbackChains[role]];
		if (toIndex < 0 || toIndex >= list.length) return;
		const [item] = list.splice(fromIndex, 1);
		list.splice(toIndex, 0, item);
		this.draftConfig.fallbackChains = {
			...this.draftConfig.fallbackChains,
			[role]: list
		};
	}

	toggleProviderDisabled(provider: string) {
		if (!this.draftConfig) return;
		const current = [...this.draftConfig.disabledProviders];
		const idx = current.indexOf(provider);
		if (idx >= 0) {
			current.splice(idx, 1);
		} else {
			current.push(provider);
		}
		this.draftConfig.disabledProviders = current;
	}

	setCycleOrder(order: string[]) {
		if (!this.draftConfig) return;
		this.draftConfig.cycleOrder = order;
	}
	addToCycle(selector: string) {
		if (!this.draftConfig) return;
		const current = [...(this.draftConfig.cycleOrder || [])];
		if (!current.includes(selector)) {
			current.push(selector);
			this.draftConfig.cycleOrder = current;
		}
	}

	removeFromCycle(index: number) {
		if (!this.draftConfig || !this.draftConfig.cycleOrder) return;
		const current = [...this.draftConfig.cycleOrder];
		current.splice(index, 1);
		this.draftConfig.cycleOrder = current;
	}

	moveCycleItem(fromIndex: number, toIndex: number) {
		if (!this.draftConfig || !this.draftConfig.cycleOrder) return;
		const order = [...this.draftConfig.cycleOrder];
		if (toIndex < 0 || toIndex >= order.length) return;
		const [item] = order.splice(fromIndex, 1);
		order.splice(toIndex, 0, item);
		this.draftConfig.cycleOrder = order;
	}

	resetDraft() {
		if (this.config) {
			this.draftConfig = JSON.parse(JSON.stringify(this.config));
		}
		if (this.customProviders) {
			this.draftCustomProviders = JSON.parse(JSON.stringify(this.customProviders));
		}
	}
	clearSuggestionsCache() {
		this.suggestionsCache.clear();
	}

	async getRoleSuggestions(
		roleId: string,
		currentPrimary?: string,
		currentFallbacks: string[] = [],
		forceRefresh = false
	): Promise<RoleSuggestionsResponse | null> {
		const primaryRaw = currentPrimary
			? splitModelSelector(currentPrimary, this.knownSelectors).base
			: '';
		const cacheKey = `${roleId}:${primaryRaw}`;

		if (!forceRefresh && this.suggestionsCache.has(cacheKey)) {
			return this.suggestionsCache.get(cacheKey)!;
		}
		this.loadingSuggestionsRole = roleId;
		try {
			const res = await invoke<RoleSuggestionsResponse>('get_role_suggestions', {
				roleId,
				currentPrimary: primaryRaw || null,
				currentFallbacks
			});
			this.suggestionsCache.set(cacheKey, res);
			return res;
		} catch (e) {
			console.error('Failed to fetch role suggestions:', e);
			return null;
		} finally {
			if (this.loadingSuggestionsRole === roleId) {
				this.loadingSuggestionsRole = null;
			}
		}
	}
}
export const modelSettingsStore = new ModelSettingsStore();
