import { invoke } from '@tauri-apps/api/core';
import { restartOmpTerminals } from '$lib/terminal/terminal';

export interface ModelCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ModelThinkingInfo {
	mode?: string;
	efforts?: string[];
}

export interface ModelDto {
	id: string;
	name: string;
	provider: string;
	selector: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinking?: ModelThinkingInfo;
	input?: string[];
	cost?: ModelCost;
	isCustom: boolean;
}

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

export interface ModelUpgradeCandidate {
	role: string;
	currentSelector: string;
	currentModelId: string;
	currentProvider: string;
	currentThinking?: string;
	suggestedSelector: string;
	suggestedModelId: string;
	suggestedModelName: string;
	reason: string;
}

export const STANDARD_ROLES = [
	{ id: 'default', label: 'Default / Chat', desc: 'Modello principale per conversazione e attivita generali' },
	{ id: 'plan', label: 'Architectural Plan', desc: 'Modello per pianificazione e analisi architetturale' },
	{ id: 'smol', label: 'Smol (Fast)', desc: 'Modello ultra-rapido per compiti leggeri, esplorazione e scouting' },
	{ id: 'slow', label: 'Slow (Reasoning)', desc: 'Modello per ragionamenti complessi e deduzioni approfondite' },
	{ id: 'vision', label: 'Vision / Images', desc: 'Modello multimodale per ispezione e comprensione immagini' },
	{ id: 'task', label: 'Task Subagents', desc: 'Modello delegato per subagenti ed esecuzioni parallele' },
	{ id: 'commit', label: 'Git Commit', desc: 'Modello per generazione messaggi di commit e changelog' },
	{ id: 'advisor', label: 'Advisor (Reviewer)', desc: 'Modello di revisione e controllo passivo di qualita' }
] as const;

export const THINKING_LEVELS = [
	{ id: 'auto', label: 'Auto (Predefinito)' },
	{ id: 'minimal', label: 'Minimal (1k)' },
	{ id: 'low', label: 'Low (2k)' },
	{ id: 'medium', label: 'Medium (8k)' },
	{ id: 'high', label: 'High (16k)' },
	{ id: 'xhigh', label: 'Extra High (32k)' },
	{ id: 'max', label: 'Max (Consentito)' },
	{ id: 'off', label: 'Off (Disabilitato)' }
] as const;

class ModelSettingsStore {
	isOpen = $state(false);
	activeTab = $state<'roles' | 'catalog' | 'providers'>('roles');
	
	loading = $state(false);
	saving = $state(false);
	isRefreshingCatalog = $state(false);
	isCheckingUpgrades = $state(false);

	config = $state<ModelConfigDto | null>(null);
	draftConfig = $state<ModelConfigDto | null>(null);
	catalog = $state<ModelDto[]>([]);
	customProviders = $state<Record<string, CustomProviderDef>>({});
	draftCustomProviders = $state<Record<string, CustomProviderDef>>({});
	authProviders = $state<AuthProviderSummary[]>([]);
	
	upgradeCandidates = $state<ModelUpgradeCandidate[]>([]);
	upgradeModalOpen = $state(false);
	lastUpgradeCheckMessage = $state<string | null>(null);
	statusToast = $state<string | null>(null);

	hasUnsavedChanges = $derived.by(() => {
		if (!this.config || !this.draftConfig) return false;
		const cfgChanged = JSON.stringify(this.config) !== JSON.stringify(this.draftConfig);
		const customChanged = JSON.stringify(this.customProviders) !== JSON.stringify(this.draftCustomProviders);
		return cfgChanged || customChanged;
	});

	openModal(tab: 'roles' | 'catalog' | 'providers' = 'roles') {
		this.activeTab = tab;
		this.isOpen = true;
		void this.loadAll();
	}

	closeModal() {
		this.isOpen = false;
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
			const [cfg, cat, custom, auth] = await Promise.all([
				invoke<ModelConfigDto>('get_model_config'),
				invoke<ModelDto[]>('get_models_catalog'),
				invoke<CustomProvidersFile>('get_custom_providers'),
				invoke<AuthProviderSummary[]>('get_auth_providers_summary')
			]);

			this.config = cfg;
			this.draftConfig = JSON.parse(JSON.stringify(cfg));
			this.catalog = cat;
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
			}

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

	async refreshCatalog() {
		this.isRefreshingCatalog = true;
		try {
			const cat = await invoke<ModelDto[]>('refresh_models_catalog');
			this.catalog = cat;
			this.showToast(`Catalogo aggiornato (${cat.length} modelli)`);
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

	async checkUpgrades() {
		this.isCheckingUpgrades = true;
		this.lastUpgradeCheckMessage = null;
		try {
			const candidates = await invoke<ModelUpgradeCandidate[]>('check_model_upgrades');
			this.upgradeCandidates = candidates;
			if (candidates.length > 0) {
				this.upgradeModalOpen = true;
			} else {
				this.showToast('I modelli utilizzati sono aggiornati alla versione piu recente');
			}
			return candidates;
		} catch (e) {
			console.error('Failed to check model upgrades:', e);
			this.showToast(`Errore verifica versioni: ${e}`);
			return [];
		} finally {
			this.isCheckingUpgrades = false;
		}
	}

	async applyUpgrades(selectedCandidates: ModelUpgradeCandidate[]) {
		if (selectedCandidates.length === 0) return;
		this.saving = true;
		try {
			const updates = selectedCandidates.map(c => ({
				role: c.role,
				newSelector: c.suggestedSelector
			}));

			await invoke('apply_model_upgrades', { updates });
			await this.loadAll();
			this.upgradeModalOpen = false;
			this.showToast(`Aggiornati ${updates.length} ruoli alla versione suggerita`);
		} catch (e) {
			console.error('Failed to apply model upgrades:', e);
			this.showToast(`Errore applicazione aggiornamenti: ${e}`);
		} finally {
			this.saving = false;
		}
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
		} else {
			// preserva eventuale livello di thinking esistente
			const current = this.draftConfig.modelRoles[role];
			if (current && current.includes(':')) {
				const parts = current.split(':');
				val = `${modelSelector}:${parts[1]}`;
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
		const rawSelector = current.split(':')[0];
		const val = thinkingLevel === 'auto' ? rawSelector : `${rawSelector}:${thinkingLevel}`;
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

	resetDraft() {
		if (this.config) {
			this.draftConfig = JSON.parse(JSON.stringify(this.config));
		}
		if (this.customProviders) {
			this.draftCustomProviders = JSON.parse(JSON.stringify(this.customProviders));
		}
	}
}

export const modelSettingsStore = new ModelSettingsStore();
