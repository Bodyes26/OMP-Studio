/**
 * Bilancio delle righe di un turno (`+N −M`) per il piè di turno.
 *
 * Si calcola dalle stesse card `edit`/`write`/`ast_edit` che il transcript gia'
 * disegna, con la stessa lettura del diff (`categorizeTool`): il numero del
 * piè coincide con la somma dei `+N/−N` delle righe di traccia del turno.
 * Contano solo le chiamate concluse senza errore; un `write` senza diff vale
 * come file nuovo (tutte righe aggiunte), come nella riga di traccia.
 */

import { categorizeTool, categoryForTool } from './tools/categories';
import type { AgentToolResult } from './wire';

export interface TurnDiffStats {
	added: number;
	removed: number;
	/** Percorsi toccati, nell'ordine della prima modifica, senza doppioni. */
	files: string[];
}

/** Il minimo di una `ToolEntry` che serve qui (evita di importare la sessione). */
export interface TurnDiffToolInput {
	toolName: string;
	args?: Record<string, unknown> | null;
	result?: AgentToolResult | null;
	running?: boolean;
}

export function emptyTurnDiff(): TurnDiffStats {
	return { added: 0, removed: 0, files: [] };
}

type ToolDiff = { added: number; removed: number; path?: string } | null;

/**
 * Il piè di turno si ricalcola a ogni delta dello streaming: rileggere il diff
 * di ogni card `edit` del transcript ogni volta costerebbe. Il risultato di
 * una chiamata conclusa non cambia piu' (omp sostituisce l'oggetto, non lo
 * muta), quindi lo si memorizza per oggetto `result`.
 */
const diffCache = new WeakMap<object, ToolDiff>();

function toolDiff(entry: TurnDiffToolInput): ToolDiff {
	const cached = entry.result ? diffCache.get(entry.result) : undefined;
	if (cached !== undefined) return cached;
	const summary = categorizeTool({
		toolName: entry.toolName,
		args: entry.args ?? undefined,
		result: entry.result ?? undefined,
		running: false
	});
	const value: ToolDiff =
		summary.diff && (summary.diff[0] > 0 || summary.diff[1] > 0)
			? { added: summary.diff[0], removed: summary.diff[1], path: summary.detail?.trim() || undefined }
			: null;
	if (entry.result) diffCache.set(entry.result, value);
	return value;
}

/** Aggiunge una chiamata al bilancio. Restituisce `true` se ha contato. */
export function addToolToTurnDiff(stats: TurnDiffStats, entry: TurnDiffToolInput): boolean {
	if (entry.running) return false;
	if (categoryForTool(entry.toolName) !== 'edit') return false;
	if (entry.result?.isError === true) return false;
	const diff = toolDiff(entry);
	if (!diff) return false;
	stats.added += diff.added;
	stats.removed += diff.removed;
	if (diff.path && !stats.files.includes(diff.path)) stats.files.push(diff.path);
	return true;
}

/** Bilancio di un elenco di chiamate; `null` se nessuna ha cambiato righe. */
export function turnDiffOf(entries: readonly TurnDiffToolInput[]): TurnDiffStats | null {
	const stats = emptyTurnDiff();
	let counted = false;
	for (const entry of entries) counted = addToolToTurnDiff(stats, entry) || counted;
	return counted ? stats : null;
}
