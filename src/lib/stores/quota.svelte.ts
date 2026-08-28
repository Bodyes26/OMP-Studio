import { invoke } from '@tauri-apps/api/core';

export type ProviderHost = {
	provider: string;
	model: string;
	host: string;
	project: string;
	project_path?: string;
	last_active_ms: number;
};

const PROVIDER_FAMILY_BY_ID: Record<string, string> = {
	openai: 'openai',
	'openai-codex': 'openai',
	google: 'google',
	'google-antigravity': 'google',
	copilot: 'copilot',
	'github-copilot': 'copilot',
	ollama: 'ollama',
	'ollama-cloud': 'ollama'
};

export function providersMatch(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	const first = left.trim().toLowerCase();
	const second = right.trim().toLowerCase();
	return (PROVIDER_FAMILY_BY_ID[first] ?? first) === (PROVIDER_FAMILY_BY_ID[second] ?? second);
}

export type QuotaStatus = 'idle' | 'loading' | 'ok' | 'warning' | 'exhausted' | 'unconfigured' | 'offline';

export interface QuotaLimit {
	id: string;
	label: string;
	scope?: {
		provider?: string;
		projectId?: string;
		windowId?: string;
		shared?: boolean;
	};
	window?: {
		id?: string;
		label?: string;
		durationMs?: number;
		resetsAt?: number;
	};
	resetsAt?: number;
	amount?: {
		unit?: string;
		remainingFraction?: number;
		usedFraction?: number;
		remaining?: number;
		used?: number;
		limit?: number;
	};
	status?: string;
}

export interface QuotaReport {
	provider: string;
	fetchedAt?: number;
	limits?: QuotaLimit[];
	metadata?: {
		endpoint?: string;
		projectId?: string;
		email?: string;
		planType?: string;
		allowed?: boolean;
		limitReached?: boolean;
		orgId?: string;
		orgName?: string;
	};
	notes?: string[];
	resetCredits?: {
		availableCount?: number;
		credits?: Array<{
			grantedAt?: string;
			expiresAt?: string;
			status?: string;
		}>;
	};
}

export interface DisabledCredential {
	id: number;
	provider: string;
	type: string;
	cause: string;
	email?: string;
	accountId?: string;
	disabledAtMs?: number;
}

export interface AccountWithoutUsage {
	provider: string;
	type: string;
}
export interface QuotaSnapshotRaw {
	generatedAt?: number;
	reports?: QuotaReport[];
	disabledCredentials?: DisabledCredential[];
	accountsWithoutUsage?: AccountWithoutUsage[];
	capacity?: Record<string, unknown>;
	[key: string]: unknown;
}

class QuotaStore {
	status = $state<QuotaStatus>('idle');
	loading = $state(false);
	error = $state<string | null>(null);
	rawJson = $state<QuotaSnapshotRaw | null>(null);
	providerHosts = $state<ProviderHost[]>([]);
	lastFetchedAt = $state<number | null>(null);
	lowestRemainingPercent = $state<number | null>(null);

	reports = $derived<QuotaReport[]>(this.rawJson?.reports ?? []);
	disabledCredentials = $derived<DisabledCredential[]>(this.rawJson?.disabledCredentials ?? []);
	accountsWithoutUsage = $derived<AccountWithoutUsage[]>(this.rawJson?.accountsWithoutUsage ?? []);

	// Testo senza glifi: l'icona la mette il chip nella barra (IconQuota),
	// cosi' l'etichetta resta leggibile anche dentro un aria-label.
	chipLabel = $derived.by(() => {
		switch (this.status) {
			case 'offline':
				return 'Offline';
			case 'unconfigured':
				return 'Quota: non config.';
			case 'exhausted':
				return 'Quota esaurita';
			case 'warning':
				return this.lowestRemainingPercent !== null
					? `Quota ${this.lowestRemainingPercent}%`
					: 'Quota bassa';
			case 'loading':
				return this.rawJson ? 'Quota...' : 'Quota';
			default:
				return 'Quota';
		}
	});

	chipTooltip = $derived.by(() => {
		switch (this.status) {
			case 'offline':
				return `Provider AI o rete non raggiungibili${this.error ? `: ${this.error}` : ''}. Clicca per dettagli e riprova (Ctrl+Alt+U)`;
			case 'unconfigured':
				return 'Nessun provider AI configurato con credenziali attive. Clicca per impostare i modelli (Ctrl+Alt+U)';
			case 'exhausted':
				return 'Limite di quota raggiunto su uno o più provider. Clicca per dettagli (Ctrl+Alt+U)';
			case 'warning':
				return `Quota in esaurimento (${this.lowestRemainingPercent ?? '< 15'}% rimanente). Clicca per dettagli (Ctrl+Alt+U)`;
			default:
				return 'Visualizza quote e consumi API OMP (Ctrl+Alt+U)';
		}
	});

	private timer: number | null = null;
	private initialized = false;

	init() {
		if (this.initialized) return;
		this.initialized = true;
		void this.refresh(false);

		if (typeof window !== 'undefined') {
			this.timer = window.setInterval(() => {
				void this.refresh(false);
			}, 90_000);
		}
	}

	destroy() {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.initialized = false;
	}

	async refresh(force = false): Promise<void> {
		this.loading = true;
		try {
			const [usage, hosts] = await Promise.all([
				invoke<{ raw_json: QuotaSnapshotRaw }>('usage_snapshot', { force }),
				invoke<ProviderHost[]>('provider_hosts').catch(() => [] as ProviderHost[])
			]);

			this.rawJson = usage.raw_json;
			this.providerHosts = hosts || [];
			this.lastFetchedAt = Date.now();
			this.error = null;

			this.evaluateStatus();
		} catch (err) {
			// Resilienza totale: non rilanciamo mai l'errore per evitare crash del renderer UI
			this.error = String(err);
			this.status = 'offline';
		} finally {
			this.loading = false;
		}
	}

	private evaluateStatus() {
		const reports = this.reports;
		let totalLimitsCount = 0;
		let hasExhausted = false;
		let minRemainingFraction = 1;

		for (const report of reports) {
			if (!report.limits || report.limits.length === 0) continue;
			for (const limit of report.limits) {
				totalLimitsCount++;
				const usedFrac = limit.amount?.usedFraction ?? (1 - (limit.amount?.remainingFraction ?? 1));
				const remainingFrac = limit.amount?.remainingFraction ?? (1 - usedFrac);

				if (remainingFrac < minRemainingFraction) {
					minRemainingFraction = remainingFrac;
				}

				if (limit.status === 'exhausted' || remainingFrac <= 0.001) {
					hasExhausted = true;
				}
			}
		}

		if (totalLimitsCount === 0) {
			this.lowestRemainingPercent = null;
			this.status = 'unconfigured';
			return;
		}

		this.lowestRemainingPercent = Math.round(minRemainingFraction * 100);

		if (hasExhausted) {
			this.status = 'exhausted';
		} else if (minRemainingFraction <= 0.15) {
			this.status = 'warning';
		} else {
			this.status = 'ok';
		}
	}
}

export const quotaStore = new QuotaStore();
