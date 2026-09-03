import { quotaStore, providersMatch, type QuotaReport, type QuotaLimit } from './quota.svelte';
import {
	modelFamilyFor,
	familyLimits,
	shortestWindowLimit,
	remainingFractionOf,
	formatResetCountdown
} from '../quota/resolve';

export type QuotaSemanticStatus = 'ok' | 'warn' | 'critical' | 'exhausted' | 'unconfigured' | 'offline';

export interface QuotaLongWindowAlert {
	label: string; // es. "Claude 7 Day"
	remainingPct: number;
	status: 'warn' | 'critical' | 'exhausted';
}

export interface ActiveQuotaInfo {
	provider?: string;
	shortName: string;
	status: QuotaSemanticStatus;
	remainingPct: number | null; // residuo della finestra PIU' BREVE
	usedPct: number; // 100 - remainingPct
	hasLimits: boolean;
	label?: string; // label della finestra piu' breve
	resetsAt?: number;
	tooltip: string;
	accountEmail?: string; // account risolto, undefined se non risolvibile
	longWindowAlert?: QuotaLongWindowAlert | null; // finestra lunga critica mentre la breve e' ok
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
	activeCredentialPin = $state<string | undefined>(undefined);

	setActiveModel(provider: string | undefined, modelId: string | undefined, credentialPin?: string) {
		this.activeProvider = provider;
		this.activeModelId = modelId;
		this.activeCredentialPin = credentialPin;
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
				tooltip: `Provider AI o rete non raggiungibili${quotaStore.error ? `: ${quotaStore.error}` : ''}. Clicca per dettagli (Ctrl+Alt+U)`,
				accountEmail: undefined,
				longWindowAlert: null
			};
		}

		const provider = this.activeProvider;
		const reports = quotaStore.reports;

		// Se abbiamo un provider attivo identificato
		if (provider) {
			const shortName = formatProviderShortName(provider);
			const family = modelFamilyFor(this.activeModelId);

			// Selezione del report:
			// 1. Prima cerca per pin credenziale attivo (se noto)
			// 2. Se non trovato o pin assente, fallback al ranking per quota: sceglie il report
			//    con residuo MASSIMO sulla finestra breve dei limiti filtrati per famiglia. A parita', il primo.
			let matchingReport: QuotaReport | undefined;
			if (this.activeCredentialPin) {
				matchingReport = quotaStore.findReportByPin(provider, this.activeCredentialPin);
			}

			if (!matchingReport) {
				const candidates = reports.filter((r) => providersMatch(r.provider, provider));
				if (candidates.length === 1) {
					matchingReport = candidates[0];
				} else if (candidates.length > 1) {
					let bestReport = candidates[0];
					let maxRemaining = -1;
					for (const candidate of candidates) {
						const cLimits = familyLimits(candidate.limits ?? [], family);
						const shortest = shortestWindowLimit(cLimits);
						const rem = shortest ? remainingFractionOf(shortest) : 0;
						// A parita' vince il primo in ordine di report
						if (rem > maxRemaining) {
							maxRemaining = rem;
							bestReport = candidate;
						}
					}
					matchingReport = bestReport;
				}
			}

			const accountEmail = matchingReport?.metadata?.email;
			const rawLimits = matchingReport?.limits ?? [];
			// Filtra i limiti per famiglia di modello (es. claude-opus-5 su google-antigravity considera i limiti anthropic)
			const limits = familyLimits(rawLimits, family);

			if (matchingReport && limits.length > 0) {
				// Barra e percentuale: finestra piu' breve dei limiti filtrati
				const shortestLimit = shortestWindowLimit(limits);
				const remainingFrac = shortestLimit ? remainingFractionOf(shortestLimit) : 1;
				const remainingPct = Math.round(remainingFrac * 100);
				const usedPct = Math.max(0, Math.min(100, 100 - remainingPct));
				const limitLabel = shortestLimit?.label || shortestLimit?.window?.label || 'Quota';
				const resetsAt = shortestLimit?.window?.resetsAt ?? shortestLimit?.resetsAt;

				// Stato:
				// Regola dello zero sui limiti filtrati per famiglia: un limite esaurito su un altro counter
				// non deve bloccare la famiglia corrente, perche' OMP isola i counter per famiglia.
				let hasExhaustedLimit = false;
				for (const limit of limits) {
					const rem = remainingFractionOf(limit);
					if (limit.status === 'exhausted' || rem <= 0.001) {
						hasExhaustedLimit = true;
						break;
					}
				}

				let status: QuotaSemanticStatus = 'ok';
				if (hasExhaustedLimit || remainingPct <= 0) {
					status = 'exhausted';
				} else if (remainingPct <= 10) {
					status = 'critical';
				} else if (remainingPct <= 30) {
					status = 'warn';
				} else {
					status = 'ok';
				}

				// longWindowAlert: fra i limiti filtrati con durationMs maggiore di quello mostrato,
				// individua quello con residuo minimo. Valorizzato SOLO se residuo <= 10% e lo stato complessivo e' 'ok' o 'warn'.
				let longWindowAlert: QuotaLongWindowAlert | null = null;
				if (status === 'ok' || status === 'warn') {
					const shortestDuration = shortestLimit?.window?.durationMs ?? Infinity;
					let worstLongLimit: QuotaLimit | null = null;
					let minLongRem = Infinity;

					for (const limit of limits) {
						const dur = limit.window?.durationMs ?? 0;
						if (dur > shortestDuration) {
							const rem = remainingFractionOf(limit);
							if (rem < minLongRem) {
								minLongRem = rem;
								worstLongLimit = limit;
							}
						}
					}

					if (worstLongLimit) {
						const longPct = Math.round(minLongRem * 100);
						if (longPct <= 10) {
							longWindowAlert = {
								label: worstLongLimit.label || worstLongLimit.window?.label || 'Finestra estesa',
								remainingPct: longPct,
								status:
									worstLongLimit.status === 'exhausted' || minLongRem <= 0.001 || longPct <= 0
										? 'exhausted'
										: longPct <= 10
											? 'critical'
											: 'warn'
							};
						}
					}
				}

				// Costruzione del tooltip multilinea in italiano:
				// Prima riga: finestra breve con residuo e reset;
				// Seconda riga (se presente): finestra lunga critica;
				// Terza riga (se presente): account email;
				// Ultima riga: suffisso con scorciatoia tastiera.
				const lines: string[] = [];
				let line1 =
					status === 'exhausted'
						? `Quota esaurita per ${shortName} (${limitLabel}): ${remainingPct}% rimanente`
						: `Quota ${shortName} (${limitLabel}): ${remainingPct}% rimanente`;
				if (resetsAt) {
					const countdown = formatResetCountdown(resetsAt);
					if (countdown) {
						line1 += ` (reset ${countdown})`;
					}
				}
				lines.push(line1);

				if (longWindowAlert) {
					lines.push(`Attenzione ${longWindowAlert.label}: ${longWindowAlert.remainingPct}% rimanente`);
				}

				if (accountEmail) {
					lines.push(`Account: ${accountEmail}`);
				}

				lines.push('Clicca per dettagli (Ctrl+Alt+U)');

				return {
					provider,
					shortName,
					status,
					remainingPct,
					usedPct,
					hasLimits: true,
					label: limitLabel,
					resetsAt,
					tooltip: lines.join('\n'),
					accountEmail,
					longWindowAlert
				};
			}

			// Se il provider attivo non ha quote API (es. Ollama o locale),
			// mantieni il contesto del provider in stile neutro/ok.
			return {
				provider,
				shortName,
				status: 'ok',
				remainingPct: null,
				usedPct: 0,
				hasLimits: false,
				tooltip: `Provider attivo: ${shortName} (nessun limite API registrato). Clicca per dettagli (Ctrl+Alt+U)`,
				accountEmail,
				longWindowAlert: null
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
				tooltip: 'Nessun provider AI configurato con credenziali attive. Clicca per configurare (Ctrl+Alt+U)',
				accountEmail: undefined,
				longWindowAlert: null
			};
		}

		if (quotaStore.status === 'exhausted') {
			return {
				shortName: '',
				status: 'exhausted',
				remainingPct: quotaStore.lowestRemainingPercent ?? 0,
				usedPct: 100 - (quotaStore.lowestRemainingPercent ?? 0),
				hasLimits: true,
				tooltip: 'Limite di quota raggiunto su uno o più provider. Clicca per dettagli (Ctrl+Alt+U)',
				accountEmail: undefined,
				longWindowAlert: null
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
				tooltip: `Quota in esaurimento (${rem}% rimanente). Clicca per dettagli (Ctrl+Alt+U)`,
				accountEmail: undefined,
				longWindowAlert: null
			};
		}

		return {
			shortName: '',
			status: 'ok',
			remainingPct: quotaStore.lowestRemainingPercent,
			usedPct: quotaStore.lowestRemainingPercent !== null ? 100 - quotaStore.lowestRemainingPercent : 0,
			hasLimits: quotaStore.lowestRemainingPercent !== null,
			tooltip: quotaStore.chipTooltip,
			accountEmail: undefined,
			longWindowAlert: null
		};
	});
}

export const activeQuotaStore = new ActiveQuotaStore();
