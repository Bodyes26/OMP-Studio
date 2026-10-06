/**
 * Rapporto testuale di `/context` (omp `buildContextReportText`).
 *
 * `get_state.contextUsage` porta solo il totale ancorato al provider.
 * La ripartizione (prompt di sistema, strumenti, contesto, skill, messaggi,
 * riserva di compattazione, libero) esiste solo in quel comando, che in RPC
 * risponde in locale con un frame `command_output` e non chiama il modello.
 */

const ANSI = /\u001b\[[0-9;]*m/g;

const HEADER = /^Context window:\s+(\d+)\s+tokens\s+\((\d+)%\s+used\)\s*$/;
const TOKEN_LINE = /^ {2}(.+?)\s+(\d+) tokens\s*$/;

const LABEL_IDS: Record<string, string> = {
	'System prompt': 'systemPrompt',
	'System tools': 'systemTools',
	'System context': 'systemContext',
	Skills: 'skills',
	Messages: 'messages',
	'Auto-compact buf': 'autoCompact',
	Free: 'free'
};

export interface ContextReportRow {
	id: string;
	/** Etichetta inglese emessa da omp, utile se l'id non e' noto. */
	label: string;
	tokens: number;
}

export interface ContextReport {
	contextWindow: number;
	usedPercent: number;
	/** Categorie che occupano la finestra, senza riserva ne' spazio libero. */
	categories: ContextReportRow[];
	autoCompactBufferTokens: number;
	freeTokens: number;
	notes: string[];
}

export function stripAnsi(text: string): string {
	return text.replace(ANSI, '');
}

/** True se il testo e' l'output di `/context`, anche nel formato di riserva senza categorie. */
export function isContextReportText(text: string): boolean {
	const trimmed = stripAnsi(text).replace(/^\uFEFF/, '').trimStart();
	return (
		trimmed.startsWith('Context window:') ||
		trimmed.startsWith('Context usage is unavailable') ||
		/^Context\r?\n/.test(trimmed)
	);
}

export function parseContextReport(text: string): ContextReport | null {
	const raw = stripAnsi(text).replace(/\r\n/g, '\n').trim();
	const lines = raw.split('\n');
	const header = lines[0]?.match(HEADER);
	if (!header) return null;
	const contextWindow = Number(header[1]);
	const usedPercent = Number(header[2]);
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
	if (!Number.isFinite(usedPercent)) return null;

	const categories: ContextReportRow[] = [];
	let autoCompactBufferTokens = 0;
	let freeTokens = 0;
	const notes: string[] = [];
	let inTable = true;

	for (const line of lines.slice(1)) {
		if (!inTable || !line.trim()) {
			inTable = false;
			if (line.trim()) notes.push(line.trim());
			continue;
		}
		const match = line.match(TOKEN_LINE);
		if (!match) {
			inTable = false;
			notes.push(line.trim());
			continue;
		}
		const head = match[1] ?? '';
		const bracket = head.indexOf('[');
		const label = (bracket === -1 ? head : head.slice(0, bracket)).trim();
		const tokens = Number(match[2]);
		if (!label || !Number.isFinite(tokens)) continue;
		const id = LABEL_IDS[label] ?? 'other';
		if (id === 'autoCompact') autoCompactBufferTokens = tokens;
		else if (id === 'free') freeTokens = tokens;
		else categories.push({ id, label, tokens });
	}

	return {
		contextWindow,
		usedPercent,
		categories,
		autoCompactBufferTokens,
		freeTokens,
		notes
	};
}

export function categoryTokenSum(report: ContextReport): number {
	return report.categories.reduce((total, row) => total + row.tokens, 0);
}

/**
 * Il rapporto e' ancora quello di `contextUsage`: stessa finestra e stesso
 * totale. Un turno nuovo cambia i token e il rapporto precedente non va
 * mostrato come se fosse aggiornato.
 */
export function reportMatchesUsage(
	report: ContextReport | null | undefined,
	usage: { tokens?: number; contextWindow?: number } | null | undefined
): report is ContextReport {
	if (!report) return false;
	if (
		typeof usage?.contextWindow === 'number' &&
		usage.contextWindow > 0 &&
		usage.contextWindow !== report.contextWindow
	) {
		return false;
	}
	if (typeof usage?.tokens === 'number' && categoryTokenSum(report) !== usage.tokens) return false;
	return true;
}

export function resolveContextWindow(
	usage: { contextWindow?: number } | null | undefined,
	modelWindow?: number
): number {
	if (typeof usage?.contextWindow === 'number' && usage.contextWindow > 0) return usage.contextWindow;
	if (typeof modelWindow === 'number' && modelWindow > 0) return modelWindow;
	return 128_000;
}

/**
 * Il messaggio in scrittura non e' ancora nel rapporto di omp: scala prima
 * lo spazio libero, poi la riserva di compattazione.
 */
export function applyDraftToContextReserve(
	free: number,
	buffer: number,
	draft: number
): { free: number; buffer: number } {
	let left = Math.max(0, draft);
	const takeFree = Math.min(Math.max(0, free), left);
	const freeAfter = Math.max(0, free) - takeFree;
	left -= takeFree;
	const takeBuffer = Math.min(Math.max(0, buffer), left);
	return { free: freeAfter, buffer: Math.max(0, buffer) - takeBuffer };
}
