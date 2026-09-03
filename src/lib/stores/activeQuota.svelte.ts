import { quotaStore, providersMatch, type QuotaReport, type QuotaLimit } from './quota.svelte';

export type QuotaSemanticStatus = 'ok' | 'warn' | 'critical' | 'exhausted' | 'unconfigured' | 'offline';

export interface ActiveQuotaInfo {
	provider?: string;
	shortName: string;
	status: QuotaSemanticStatus;
	remainingPct: number | null;
	usedPct: number;
	hasLimits: boolean;
	label?: string;
	resetsAt?: number;
	tooltip: string;
}

export function formatProviderShortName(providerId: string | undefined): string {
	if (!providerId) return '';
	const p = providerId.trim().toLowerCase();
	if (p === 'google' || p === 'google-antigravity') return 'Google';
	if (p === 'anthropic') return 'Anthropic';
	if (p === 'openai' || p === 'openai-codex') return 'OpenAI';
	if (p === 'copilot' || p === 'github-copilot') return 'Copilot';
	if (p === 'ollama' || p === 'ollama-cloud') return 'Ollama';
	return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

class ActiveQuotaStore {
	activeProvider = $state<string | undefined>(undefined);
	activeModelId = $state<string | undefined>(undefined);

	setActiveModel(provider: string | undefined, modelId: string | undefined) {
		this.activeProvider = provider;
		this.activeModelId = modelId;
	}

	info = $derived.by<ActiveQuotaInfo>(() => {
		// Se la rete o il servizio sono offline
		if (quotaStore.status === 'offline') {
			return {
				provider: this.activeProvider,
				shortName: formatProviderShortName(this.activeProvider) || 'AI',
				status: 'offline',
				remainingPct: null,
				usedPct: 0,
				hasLimits: false,
				tooltip: `Provider AI o rete non raggiungibili${quotaStore.error ? `: ${quotaStore.error}` : ''}. Clicca per dettagli (Ctrl+Alt+U)`
			};
		}

		const provider = this.activeProvider;
		const reports = quotaStore.reports;

		// Se abbiamo un provider attivo identificato
		if (provider) {
			const shortName = formatProviderShortName(provider);
			const matchingReport = reports.find((r) => providersMatch(r.provider, provider));

			if (matchingReport && matchingReport.limits && matchingReport.limits.length > 0) {
				let minRemainingFrac = 1;
				let mostConstrainingLimit: QuotaLimit | null = null;
				let isExhausted = false;

				for (const limit of matchingReport.limits) {
					const rawUsed = typeof limit.amount?.usedFraction === 'number' ? limit.amount.usedFraction : null;
					const rawRem = typeof limit.amount?.remainingFraction === 'number' ? limit.amount.remainingFraction : null;
					const usedFrac = Math.max(0, Math.min(1, rawUsed ?? (rawRem !== null ? 1 - rawRem : 0)));
					const remainingFrac = Math.max(0, Math.min(1, rawRem ?? (1 - usedFrac)));

					if (remainingFrac <= minRemainingFrac) {
						minRemainingFrac = remainingFrac;
						mostConstrainingLimit = limit;
					}

					if (limit.status === 'exhausted' || remainingFrac <= 0.001) {
						isExhausted = true;
					}
				}

				const remainingPct = Math.round(minRemainingFrac * 100);
				const usedPct = Math.max(0, Math.min(100, 100 - remainingPct));

				let status: QuotaSemanticStatus = 'ok';
				if (isExhausted || remainingPct <= 0) {
					status = 'exhausted';
				} else if (remainingPct <= 10) {
					status = 'critical';
				} else if (remainingPct <= 25) {
					status = 'warn';
				}

				const limitLabel = mostConstrainingLimit?.label || 'Quota';
				const tooltip = isExhausted
					? `Quota esaurita per ${shortName} (${limitLabel}). Clicca per dettagli (Ctrl+Alt+U)`
					: status === 'critical'
						? `Quota critica per ${shortName}: ${remainingPct}% rimanente (${limitLabel}). Clicca per dettagli (Ctrl+Alt+U)`
						: status === 'warn'
							? `Quota in esaurimento per ${shortName}: ${remainingPct}% rimanente (${limitLabel}). Clicca per dettagli (Ctrl+Alt+U)`
							: `Quota ${shortName}: ${remainingPct}% rimanente. Clicca per dettagli (Ctrl+Alt+U)`;

				return {
					provider,
					shortName,
					status,
					remainingPct,
					usedPct,
					hasLimits: true,
					label: limitLabel,
					resetsAt: mostConstrainingLimit?.window?.resetsAt ?? mostConstrainingLimit?.resetsAt,
					tooltip
				};
			}

			// Opzione 1 concordata: se il provider attivo non ha quote API (es. Ollama o locale),
			// mantieni il contesto del provider in stile neutro/ok.
			return {
				provider,
				shortName,
				status: 'ok',
				remainingPct: null,
				usedPct: 0,
				hasLimits: false,
				tooltip: `Provider attivo: ${shortName} (nessun limite API registrato). Clicca per dettagli (Ctrl+Alt+U)`
			};
		}

		// Fallback: nessun provider attivo o rilevato, prendi lo stato generale di quotaStore
		if (quotaStore.status === 'unconfigured') {
			return {
				shortName: '',
				status: 'unconfigured',
				remainingPct: null,
				usedPct: 0,
				hasLimits: false,
				tooltip: 'Nessun provider AI configurato con credenziali attive. Clicca per configurare (Ctrl+Alt+U)'
			};
		}

		if (quotaStore.status === 'exhausted') {
			return {
				shortName: '',
				status: 'exhausted',
				remainingPct: quotaStore.lowestRemainingPercent ?? 0,
				usedPct: 100 - (quotaStore.lowestRemainingPercent ?? 0),
				hasLimits: true,
				tooltip: 'Limite di quota raggiunto su uno o più provider. Clicca per dettagli (Ctrl+Alt+U)'
			};
		}

		if (quotaStore.status === 'warning') {
			const rem = quotaStore.lowestRemainingPercent ?? 15;
			return {
				shortName: '',
				status: 'warn',
				remainingPct: rem,
				usedPct: 100 - rem,
				hasLimits: true,
				tooltip: `Quota in esaurimento (${rem}% rimanente). Clicca per dettagli (Ctrl+Alt+U)`
			};
		}

		return {
			shortName: '',
			status: 'ok',
			remainingPct: quotaStore.lowestRemainingPercent,
			usedPct: quotaStore.lowestRemainingPercent !== null ? 100 - quotaStore.lowestRemainingPercent : 0,
			hasLimits: quotaStore.lowestRemainingPercent !== null,
			tooltip: quotaStore.chipTooltip
		};
	});
}

export const activeQuotaStore = new ActiveQuotaStore();
