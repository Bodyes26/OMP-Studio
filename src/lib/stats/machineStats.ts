// Statistiche per macchina e aggregate (IMP-010).
//
// Ogni macchina ha il suo `~/.omp/stats.db`: questa finestra chiede a ciascuna
// (`stats_summary`, comando `routed`) la stessa finestra temporale e mostra i
// numeri divisi per macchina e uniti. L'unione avviene qui, sui fatti additivi
// restituiti dal backend; una macchina che non risponde non contribuisce e non
// viene sostituita da zeri.

import type { StatsFolder, StatsHour, StatsModel, StatsSamples, StatsSummary, StatsTotals } from './usageStats.ts';

/** Esito della lettura delle statistiche di una macchina. */
export type MachineStatsState =
	| 'loading'
	| 'ok'
	| 'unreachable'
	| 'incompatible'
	| 'missing'
	| 'schema'
	| 'error';

/** Macchina a cui si possono chiedere le statistiche, in questo contesto. */
export interface MachineTarget {
	id: string;
	name: string;
	local: boolean;
	online: boolean;
	compatible: boolean;
}

/** Macchina con l'esito e, quando c'è, il suo riepilogo. */
export interface MachineStats extends MachineTarget {
	state: MachineStatsState;
	detail: string;
	summary: StatsSummary | null;
}

function total(pick: (totals: StatsTotals) => number, list: readonly StatsTotals[]): number {
	let sum = 0;
	for (const entry of list) sum += pick(entry);
	return sum;
}

function combineSamples(list: readonly StatsTotals[]): StatsSamples | undefined {
	const result: StatsSamples = { ttftSum: 0, ttftCount: 0, tpsSum: 0, tpsCount: 0, noCacheInputCost: 0, cachedPromptCost: 0 };
	for (const { samples } of list) {
		// Le build precedenti non inviavano i denominatori: non stimare una media
		// mettendo sullo stesso piano richieste con e senza misurazione.
		if (!samples) return undefined;
		result.ttftSum += samples.ttftSum;
		result.ttftCount += samples.ttftCount;
		result.tpsSum += samples.tpsSum;
		result.tpsCount += samples.tpsCount;
		result.noCacheInputCost += samples.noCacheInputCost;
		result.cachedPromptCost += samples.cachedPromptCost;
	}
	return result;
}

/** Somma dei fatti di più macchine; i rapporti si ricalcolano, non si sommano. */
function combineTotals(list: readonly StatsTotals[]): StatsTotals {
	if (list.length === 1) return list[0];
	const samples = combineSamples(list);
	const inputTokens = total((x) => x.inputTokens, list);
	const cacheReadTokens = total((x) => x.cacheReadTokens, list);
	const prompt = inputTokens + cacheReadTokens;
	let lastActivity: number | null = null;
	for (const entry of list) {
		if (entry.lastActivity === null) continue;
		if (lastActivity === null || entry.lastActivity > lastActivity) lastActivity = entry.lastActivity;
	}
	return {
		requests: total((x) => x.requests, list),
		failed: total((x) => x.failed, list),
		inputTokens,
		outputTokens: total((x) => x.outputTokens, list),
		cacheReadTokens,
		cacheWriteTokens: total((x) => x.cacheWriteTokens, list),
		totalTokens: total((x) => x.totalTokens, list),
		cost: total((x) => x.cost, list),
		unpriced: total((x) => x.unpriced, list),
		cacheRate: prompt > 0 ? cacheReadTokens / prompt : 0,
		cacheSavings: samples ? (samples.noCacheInputCost > 0
			? (samples.noCacheInputCost - samples.cachedPromptCost) / samples.noCacheInputCost : 0) : null,
		avgTtftMs: samples && samples.ttftCount > 0 ? samples.ttftSum / samples.ttftCount : null,
		avgTokensPerSecond: samples && samples.tpsCount > 0 ? samples.tpsSum / samples.tpsCount : null,
		samples,
		lastActivity
	};
}

/**
 * Unione dei riepiloghi delle macchine che hanno risposto; chi manca resta
 * fuori. Le ore sono allineate all'ora UTC, quindi si sommano per inizio;
 * modelli, cartelle e tipi di agente si uniscono per chiave. Nessun
 * riepilogo: `null`.
 */
export function mergeSummaries(machines: readonly MachineStats[]): StatsSummary | null {
	const list: StatsSummary[] = [];
	for (const machine of machines) {
		if (machine.state === 'ok' && machine.summary) list.push(machine.summary);
	}
	if (list.length === 0) return null;

	const hours = new Map<number, StatsHour>();
	for (const summary of list) {
		for (const hour of summary.hours) {
			const bucket = hours.get(hour.start);
			if (!bucket) {
				hours.set(hour.start, { ...hour });
				continue;
			}
			bucket.requests += hour.requests;
			bucket.failed += hour.failed;
			bucket.tokens += hour.tokens;
			bucket.cost += hour.cost;
		}
	}

	const models = new Map<string, { model: string; provider: string; totals: StatsTotals[] }>();
	const folders = new Map<string, { folder: string; projectPath: string | null; totals: StatsTotals[] }>();
	const agents = new Map<string, { agentType: string; totals: StatsTotals[] }>();
	for (const summary of list) {
		for (const entry of summary.models) {
			const key = `${entry.provider}\u0000${entry.model}`;
			const group = models.get(key);
			if (group) group.totals.push(entry);
			else models.set(key, { model: entry.model, provider: entry.provider, totals: [entry] });
		}
		for (const entry of summary.folders) {
			const group = folders.get(entry.folder);
			if (!group) {
				folders.set(entry.folder, { folder: entry.folder, projectPath: entry.projectPath, totals: [entry] });
				continue;
			}
			group.totals.push(entry);
			group.projectPath ??= entry.projectPath;
		}
		for (const entry of summary.agents) {
			const group = agents.get(entry.agentType);
			if (group) group.totals.push(entry);
			else agents.set(entry.agentType, { agentType: entry.agentType, totals: [entry] });
		}
	}

	const mergedModels: StatsModel[] = [...models.values()]
		.map((group) => ({ model: group.model, provider: group.provider, ...combineTotals(group.totals) }))
		.sort((a, b) => b.requests - a.requests || b.cost - a.cost);
	const mergedFolders: StatsFolder[] = [...folders.values()]
		.map((group) => ({ folder: group.folder, projectPath: group.projectPath, ...combineTotals(group.totals) }))
		.sort((a, b) => b.requests - a.requests || b.cost - a.cost);
	const mergedAgents = [...agents.values()]
		.map((group) => ({ agentType: group.agentType, ...combineTotals(group.totals) }))
		.sort((a, b) => b.requests - a.requests || b.cost - a.cost);

	return {
		from: Math.min(...list.map((summary) => summary.from)),
		to: Math.max(...list.map((summary) => summary.to)),
		totals: combineTotals(list.map((summary) => summary.totals)),
		hours: [...hours.values()].sort((a, b) => a.start - b.start),
		models: mergedModels,
		folders: mergedFolders,
		agents: mergedAgents
	};
}
