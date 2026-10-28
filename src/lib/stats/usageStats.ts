// Tipi e calcoli puri della sezione Impostazioni > Statistiche.
// I dati arrivano da `stats_summary` (src-tauri/src/stats_ops.rs), che legge
// `~/.omp/stats.db` in sola lettura.

export interface StatsTotals {
	requests: number;
	failed: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	cost: number;
	unpriced: number;
	cacheRate: number;
	cacheSavings: number;
	avgTtftMs: number | null;
	avgTokensPerSecond: number | null;
	lastActivity: number | null;
}

export interface StatsHour {
	start: number;
	requests: number;
	failed: number;
	tokens: number;
	cost: number;
}

export interface StatsModel extends StatsTotals {
	model: string;
	provider: string;
}

export interface StatsFolder extends StatsTotals {
	folder: string;
	projectPath: string | null;
}

export interface StatsAgent extends StatsTotals {
	agentType: string;
}

export interface StatsSummary {
	from: number;
	to: number;
	totals: StatsTotals;
	hours: StatsHour[];
	models: StatsModel[];
	folders: StatsFolder[];
	agents: StatsAgent[];
}

export type StatsRange = '24h' | '7d' | '30d';
export type StatsMetric = 'requests' | 'tokens' | 'cost';

export const RANGE_HOURS: Record<StatsRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

export interface StatsBucket {
	start: number;
	requests: number;
	failed: number;
	tokens: number;
	cost: number;
}

function localDayStart(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * Barre del grafico: ore per le 24 ore, giorni locali per 7 e 30 giorni.
 * Il giorno si calcola nel fuso dell'utente (non UTC) perche' «ieri» deve
 * essere il suo ieri; anche i giorni senza attivita' hanno la loro barra.
 */
export function bucketize(hours: StatsHour[], range: StatsRange): StatsBucket[] {
	if (range === '24h') return hours.map((h) => ({ ...h }));
	if (hours.length === 0) return [];
	const byDay = new Map<number, StatsBucket>();
	const first = localDayStart(hours[0].start);
	const last = localDayStart(hours[hours.length - 1].start);
	for (let day = first; day <= last; ) {
		byDay.set(day, { start: day, requests: 0, failed: 0, tokens: 0, cost: 0 });
		const next = new Date(day);
		next.setDate(next.getDate() + 1);
		day = next.getTime();
	}
	for (const h of hours) {
		const bucket = byDay.get(localDayStart(h.start));
		if (!bucket) continue;
		bucket.requests += h.requests;
		bucket.failed += h.failed;
		bucket.tokens += h.tokens;
		bucket.cost += h.cost;
	}
	return [...byDay.values()];
}

export function share(part: number, total: number): number {
	return total > 0 ? part / total : 0;
}

/** Etichetta leggibile di una cartella di sessioni senza progetto noto. */
export function folderLabel(folder: string): string {
	return folder.replace(/^-+|-+$/g, '') || folder;
}

export interface StatsFormatters {
	count: (n: number) => string;
	tokens: (n: number) => string;
	percent: (n: number) => string;
	cost: (n: number) => string;
	seconds: (ms: number | null) => string;
	rate: (n: number | null) => string;
	hour: (ms: number) => string;
	day: (ms: number) => string;
	dayHour: (ms: number) => string;
}

export function createFormatters(locale: string): StatsFormatters {
	const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
	const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
	const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 });
	const usdSmall = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 3, minimumFractionDigits: 3 });
	const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
	const hour = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
	const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
	const dayHour = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	return {
		count: (n: number) => (n >= 10_000 ? compact.format(n) : integer.format(n)),
		tokens: (n: number) => compact.format(n),
		percent: (n: number) => percent.format(n),
		cost: (n: number) => (n > 0 && n < 1 ? usdSmall.format(n) : usd.format(n)),
		seconds: (ms: number | null) => (ms === null ? '—' : `${oneDecimal.format(ms / 1000)} s`),
		rate: (n: number | null) => (n === null ? '—' : oneDecimal.format(n)),
		hour: (ms: number) => hour.format(ms),
		day: (ms: number) => day.format(ms),
		dayHour: (ms: number) => dayHour.format(ms)
	};
}

export function metricValue(bucket: StatsBucket, metric: StatsMetric): number {
	return metric === 'requests' ? bucket.requests : metric === 'tokens' ? bucket.tokens : bucket.cost;
}

export function formatMetric(f: StatsFormatters, metric: StatsMetric, value: number): string {
	return metric === 'requests' ? f.count(value) : metric === 'tokens' ? f.tokens(value) : f.cost(value);
}
