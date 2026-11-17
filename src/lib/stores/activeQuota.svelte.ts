import { computeQuotaInfo, type QuotaInfo } from '../quota/projectQuota';
import { quotaStore, quotaStoreFor, type QuotaStore } from './quota.svelte';
import type { MachineId } from '#lib/backend/ipc.ts';

/**
 * Tiene il modello e il provider del progetto ATTIVO, per la chip della topbar.
 * Il calcolo vero e proprio vive in `src/lib/quota/projectQuota.ts`, condiviso
 * con le righe per-progetto della finestra companion. Le quote sono quelle
 * della macchina che esegue il progetto attivo (R-MI-06).
 */
class ActiveQuotaStore {
	activeProvider = $state<string | undefined>(undefined);
	activeModelId = $state<string | undefined>(undefined);
	activeCredentialPin = $state<string | undefined>(undefined);
	/** Quote della macchina del progetto attivo; la chip e la finestra Quote leggono queste. */
	store = $state.raw<QuotaStore>(quotaStore);

	/**
	 * Va chiamata da un effetto, non da un `$derived`: la prima richiesta per
	 * una macchina crea il suo store e ne avvia la lettura.
	 */
	setActiveModel(provider: string | undefined, modelId: string | undefined, credentialPin?: string, machine?: MachineId) {
		this.activeProvider = provider;
		this.activeModelId = modelId;
		this.activeCredentialPin = credentialPin;
		this.store = quotaStoreFor(machine);
	}

	info = $derived.by<QuotaInfo>(() =>
		computeQuotaInfo(this.activeProvider, this.activeModelId, this.activeCredentialPin, this.store)
	);
}

export const activeQuotaStore = new ActiveQuotaStore();
