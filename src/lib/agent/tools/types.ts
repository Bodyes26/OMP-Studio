// Contratto dei renderer di tool.
//
// Regola non negoziabile: **nessun renderer lancia**. `args` e `details`
// arrivano come JSON dal filo e in streaming sono incompleti — un campo
// mancante e' una riga omessa, non un errore. La forma reale di `details`
// per ogni tool sta in `ricerca/TOOL-DETAILS.md`, rilevata sul filo.

import type { Component } from 'svelte';
import type { ContentBlock } from '../wire';

export interface ToolRenderProps {
	name: string;
	/** `i` (l'intento) e' gia' stato rimosso: vive nell'intestazione. */
	args: Record<string, unknown>;
	result?: { content?: ContentBlock[]; details?: unknown; isError?: boolean };
	running?: boolean;
	/**
	 * `summary` = la riga sempre visibile accanto al nome del tool.
	 * `body` = il corpo espandibile.
	 *
	 * Un solo componente per tool con due viste, e non due componenti: le due
	 * viste leggono lo stesso `details` con la stessa logica, e separarle
	 * significherebbe duplicare quel parsing trenta volte.
	 */
	view: 'summary' | 'body';
}

export interface ToolRenderer {
	component: Component<ToolRenderProps>;
	/** `false` quando il tool non ha un corpo: la card non si apre. */
	expandable: boolean;
}

/* ------------------------------------------------- letture difensive ---- */

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

export function strList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function recordList(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	const out: Record<string, unknown>[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		if (record) out.push(record);
	}
	return out;
}

/** Testo dei blocchi `text` di un risultato, concatenato. */
export function resultText(result: ToolRenderProps['result']): string {
	if (!result?.content) return '';
	return result.content
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text ?? '')
		.join('\n');
}

/** Blocchi immagine di un risultato. */
export function resultImages(result: ToolRenderProps['result']): { data: string; mimeType: string }[] {
	if (!result?.content) return [];
	const images: { data: string; mimeType: string }[] = [];
	for (const block of result.content) {
		if (block.type !== 'image' || typeof block.data !== 'string') continue;
		images.push({ data: block.data, mimeType: block.mimeType ?? 'image/png' });
	}
	return images;
}

/** Ultimo segmento di un percorso, con separatori di entrambi i mondi. */
export function baseName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** Durata compatta: `840ms`, `2.4s`, `1m 12s`. */
export function formatDuration(ms: number | undefined): string | undefined {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Conteggio con plurale italiano: `1 file`, `3 file`, `1 riga`, `2 righe`. */
export function countLabel(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Estrae una breve descrizione dell'errore per il microcopy di fallimento.
 * Restituisce una sola riga concisa e pulita.
 */
export function extractToolErrorReason(tool: {
	args?: Record<string, unknown>;
	result?: { content?: ContentBlock[]; details?: unknown; isError?: boolean };
}): string {
	const result = tool.result;
	const details = asRecord(result?.details);

	// 1. Cerca prima messaggi strutturati in details
	if (typeof result?.details === 'string' && result.details.trim().length > 0) {
		return cleanErrorLine(result.details);
	}
	if (details) {
		const detailErr =
			str(details.error) ??
			str(details.message) ??
			str(details.reason) ??
			str(details.stderr) ??
			str(details.statusText);
		if (detailErr) {
			return cleanErrorLine(detailErr);
		}
	}

	// 2. Cerca in args (ad es. yield o report_issue con errore esplicito)
	if (tool.args) {
		const argErr = str(tool.args.error) ?? str(tool.args.reason);
		if (argErr) {
			return cleanErrorLine(argErr);
		}
	}

	// 3. Cerca nel testo dei blocchi di risultato
	const text = resultText(result);
	if (text.trim().length > 0) {
		const lines = text
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0);

		if (lines.length > 0) {
			const first = lines[0];
			if ((first.toLowerCase() === 'error:' || first.toLowerCase() === 'command failed:') && lines.length > 1) {
				return cleanErrorLine(`${first} ${lines[1]}`);
			}
			return cleanErrorLine(first);
		}
	}

	// 4. Ripiego generico
	return 'operazione non riuscita';
}

function cleanErrorLine(raw: string): string {
	let cleaned = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
	cleaned = cleaned.replace(/\s+/g, ' ').trim();
	if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
		cleaned = cleaned.slice(1, -1).trim();
	}
	const MAX_LEN = 140;
	if (cleaned.length > MAX_LEN) {
		return cleaned.slice(0, MAX_LEN - 3).trimEnd() + '...';
	}
	return cleaned || 'operazione non riuscita';
}
