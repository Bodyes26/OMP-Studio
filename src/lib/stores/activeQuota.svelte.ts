import { computeQuotaInfo, type QuotaInfo } from '../quota/projectQuota';

/**
 * Tiene il modello e il provider del progetto ATTIVO, per la chip della topbar.
 * Il calcolo vero e proprio vive in `src/lib/quota/projectQuota.ts`, condiviso
 * con le righe per-progetto della finestra companion.
 */
class ActiveQuotaStore {
	activeProvider = $state<string | undefined>(undefined);
	activeModelId = $state<string | undefined>(undefined);
	activeCredentialPin = $state<string | undefined>(undefined);

	setActiveModel(provider: string | undefined, modelId: string | undefined, credentialPin?: string) {
		this.activeProvider = provider;
		this.activeModelId = modelId;
		this.activeCredentialPin = credentialPin;
	}

	info = $derived.by<QuotaInfo>(() =>
		computeQuotaInfo(this.activeProvider, this.activeModelId, this.activeCredentialPin)
	);
}

export const activeQuotaStore = new ActiveQuotaStore();
