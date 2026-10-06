/**
 * Categorizzazione e sintesi delle chiamate ai tool (Gate R32 - C09).
 *
 * Mappa ogni tool registrato, i relativi alias e il fallback MCP in una delle
 * categorie visuali previste dal prototipo ('read', 'search', 'run', 'edit',
 * 'web', 'think', 'other', mantenendo 'task', 'todo', 'ask' come kind dedicati).
 *
 * Estrae dettagli concisi (percorso, comando, pattern, url), metadati (conteggio
 * match, righe, durata, codice di uscita), bilancio diff [+aggiunte, -rimosse]
 * dal formato omp riga-per-riga, ed eventuale motivo di errore.
 */

import type { AgentToolResult } from '../wire';
import { m as msg } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import {
	asRecord,
	extractToolErrorReason,
	formatDuration,
	num,
	str,
	strList
} from './types';

export type ToolCategory =
	| 'read'
	| 'search'
	| 'run'
	| 'edit'
	| 'web'
	| 'think'
	| 'other'
	| 'task'
	| 'todo'
	| 'ask';

export interface ToolSummary {
	category: ToolCategory;
	label: string;
	detail?: string;
	meta?: string;
	diff?: [number, number];
	fail?: boolean;
	errorReason?: string;
}

export interface CategorizeToolInput {
	toolName: string;
	args?: Record<string, unknown> | null;
	result?: AgentToolResult | null;
	running?: boolean;
}

/**
 * Mappatura degli alias noti ai rispettivi tool canonici registrati.
 */
const ALIASES: Record<string, string> = {
	astedit: 'ast_edit',
	'ast-edit': 'ast_edit',
	astgrep: 'ast_grep',
	'ast-grep': 'ast_grep',
	'generate-image': 'generate_image',
	generateimage: 'generate_image',
	'inspect-image': 'inspect_image',
	inspectimage: 'inspect_image',
	'web-search': 'web_search',
	websearch: 'web_search',
	'report-tool-issue': 'report_issue',
	report_tool_issue: 'report_issue',
	'memory-recall': 'recall',
	memory_recall: 'recall',
	'memory-reflect': 'reflect',
	memory_reflect: 'reflect',
	'memory-retain': 'retain',
	memory_retain: 'retain',
	propose: 'resolve',
	reject: 'resolve'
};

export function canonicalToolName(toolName: string): string {
	const lower = (toolName || '').toLowerCase().trim();
	return ALIASES[lower] ?? lower;
}

/**
 * Restituisce la categoria di appartenenza di un tool.
 */
export function categoryForTool(toolName: string): ToolCategory {
	const canonical = canonicalToolName(toolName);
	switch (canonical) {
		case 'read':
		case 'inspect_image':
		case 'recall':
			return 'read';

		case 'grep':
		case 'ast_grep':
		case 'glob':
		case 'lsp':
			return 'search';

		case 'bash':
		case 'eval':
		case 'job':
		case 'debug':
			return 'run';

		case 'edit':
		case 'write':
		case 'ast_edit':
		case 'retain':
			return 'edit';

		case 'web_search':
		case 'fetch':
		case 'browser':
			return 'web';

		case 'reflect':
		case 'think':
			return 'think';

		case 'task':
			return 'task';

		case 'todo':
			return 'todo';

		case 'ask':
			return 'ask';

		default:
			return 'other';
	}
}

/**
 * Parsa il formato diff di omp (<segno><numero>|<testo>) o fallback unificato,
 * restituendo il conteggio [aggiunte, rimosse].
 */
export function parseDiffStats(diffText?: string | null): [number, number] | undefined {
	if (!diffText || typeof diffText !== 'string') return undefined;

	let added = 0;
	let removed = 0;
	const LINE = /^([-+ ])(\d*)\|(.*)$/;

	for (const raw of diffText.split('\n')) {
		const match = LINE.exec(raw);
		if (match) {
			if (match[1] === '+') added++;
			else if (match[1] === '-') removed++;
		} else {
			if (raw.startsWith('+') && !raw.startsWith('+++')) added++;
			else if (raw.startsWith('-') && !raw.startsWith('---')) removed++;
		}
	}

	if (added === 0 && removed === 0) return undefined;
	return [added, removed];
}

/**
 * Formatta millisecondi come 'X,Y s' con il separatore decimale della lingua
 * dell'interfaccia (virgola in italiano, punto in inglese).
 */
export function formatDurationSecs(ms: number): string {
	const clamped = Math.max(0.1, ms / 1000);
	const value = new Intl.NumberFormat(getLocale(), {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
		useGrouping: false
	}).format(Math.round(clamped * 10) / 10);
	return `${value} s`;
}

function formatFileSize(bytes: number | undefined): string | undefined {
	if (bytes === undefined) return undefined;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function previewArgs(args: Record<string, unknown>): string | undefined {
	// Prova prima con proprietà note
	for (const key of ['query', 'path', 'file', 'command', 'cmd', 'url', 'target', 'prompt', 'sql', 'name', 'id']) {
		const val = str(args[key]);
		if (val) return val;
	}
	// Fallback sulla prima stringa trovata
	for (const val of Object.values(args)) {
		const s = str(val);
		if (s) return s;
	}
	// Fallback sul riassunto chiavi/valori
	const pairs = Object.entries(args)
		.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : typeof v === 'number' ? v : Array.isArray(v) ? `[${v.length}]` : '{…}'}`)
		.join(', ');
	return pairs || undefined;
}

/**
 * Sintetizza una chiamata tool (etichetta, dettaglio, meta, diff, errore)
 * per il gruppo di strumenti v2.
 */
export function categorizeTool(input: CategorizeToolInput): ToolSummary {
	const toolName = input.toolName || 'tool';
	const canonical = canonicalToolName(toolName);
	const category = categoryForTool(toolName);
	const args = input.args ?? {};
	const result = input.result;
	const details = asRecord(result?.details);

	const isError = result?.isError === true;
	let errorReason: string | undefined;
	if (isError) {
		errorReason = extractToolErrorReason({ args, result: result ?? undefined });
	}

	let label = toolName;
	let detail: string | undefined;
	let meta: string | undefined;
	let diff: [number, number] | undefined;

	switch (canonical) {
		case 'read': {
			label = msg.chat_v2_tool_label_read();
			const metaRec = asRecord(details?.meta);
			const source = asRecord(metaRec?.source);
			detail = str(source?.value) ?? str(args.path) ?? str(args.file) ?? str(args.uri);
			const totalLines = num(details?.totalLines);
			const fileSize = num(details?.fileSize);
			if (totalLines !== undefined) {
				meta = msg.chat_v2_tool_meta_lines({ count: totalLines });
			} else if (fileSize !== undefined) {
				meta = formatFileSize(fileSize);
			}
			break;
		}

		case 'inspect_image': {
			label = msg.chat_v2_tool_label_inspect_image();
			detail = str(args.path) ?? str(args.file);
			break;
		}

		case 'recall': {
			label = msg.chat_v2_tool_label_recall();
			detail = str(args.query) ?? str(args.key);
			break;
		}

		case 'grep': {
			label = msg.chat_v2_tool_label_grep();
			detail = str(args.pattern) ?? str(args.query);
			const matchCount = num(details?.matchCount);
			const fileCount = num(details?.fileCount);
			if (matchCount !== undefined && fileCount !== undefined) {
				meta = msg.chat_v2_tool_meta_matches_in_files({ matches: matchCount, files: fileCount });
			} else if (matchCount !== undefined) {
				meta = msg.chat_v2_tool_meta_results({ count: matchCount });
			} else if (fileCount !== undefined) {
				meta = msg.chat_v2_tool_meta_files({ count: fileCount });
			}
			break;
		}

		case 'ast_grep': {
			label = msg.chat_v2_tool_label_ast_grep();
			detail = str(args.pat) ?? str(args.pattern);
			const matchCount = num(details?.matchCount);
			const fileCount = num(details?.fileCount);
			if (matchCount !== undefined) {
				meta = msg.chat_v2_tool_meta_results({ count: matchCount });
			} else if (fileCount !== undefined) {
				meta = msg.chat_v2_tool_meta_files({ count: fileCount });
			}
			break;
		}

		case 'glob': {
			label = msg.chat_v2_tool_label_glob();
			detail = str(args.path) ?? str(args.pattern) ?? str(args.glob);
			const files = strList(details?.files);
			const fileCount = num(details?.fileCount) ?? (files.length > 0 ? files.length : undefined);
			if (fileCount !== undefined) {
				meta = msg.chat_v2_tool_meta_files({ count: fileCount });
			}
			break;
		}

		case 'lsp': {
			label = 'LSP';
			detail = str(args.action) ?? str(args.method) ?? str(args.query);
			break;
		}

		case 'bash': {
			label = msg.chat_v2_tool_label_bash();
			detail = str(args.command) ?? str(args.cmd);
			const exitCode = num(details?.exitCode) ?? num(details?.code);
			const wallTimeMs = num(details?.wallTimeMs);
			if (exitCode !== undefined && exitCode !== 0) {
				meta = `exit ${exitCode}`;
			} else if (wallTimeMs !== undefined) {
				meta = formatDuration(wallTimeMs);
			}
			break;
		}

		case 'eval': {
			label = msg.chat_v2_tool_label_eval();
			detail = str(args.title) ?? (typeof args.code === 'string' ? args.code.trim().split('\n')[0].slice(0, 80) : undefined);
			const wallTimeMs = num(details?.wallTimeMs) ?? num(details?.durationMs);
			const language = str(details?.language) ?? str(args.language);
			if (wallTimeMs !== undefined) {
				meta = formatDuration(wallTimeMs);
			} else if (language) {
				meta = language;
			}
			break;
		}

		case 'job': {
			label = msg.chat_v2_tool_label_job();
			detail = str(args.command) ?? str(args.cmd) ?? str(args.id);
			break;
		}

		case 'debug': {
			label = 'Debug';
			detail = str(args.command) ?? str(args.target);
			break;
		}

		case 'edit': {
			label = msg.chat_v2_tool_label_edit();
			const input = str(args.input);
			const inputPath = input ? /^\[([^#\]]+)/.exec(input)?.[1] : undefined;
			detail = str(details?.path) ?? str(args.path) ?? str(args.file) ?? inputPath;
			diff = parseDiffStats(str(details?.diff));
			const op = str(details?.op);
			const firstChangedLine = num(details?.firstChangedLine);
			if (op) {
				meta = op;
			} else if (firstChangedLine !== undefined) {
				meta = `L${firstChangedLine}`;
			}
			break;
		}

		case 'write': {
			label = msg.chat_v2_tool_label_write();
			detail = str(details?.resolvedPath) ?? str(args.path) ?? str(args.file);
			if (str(details?.diff)) {
				diff = parseDiffStats(str(details?.diff));
			} else if (typeof args.content === 'string') {
				const lines = args.content.length > 0 ? args.content.split('\n').length : 0;
				diff = [lines, 0];
			}
			if (args.content && typeof args.content === 'string') {
				const byteLen = new Blob([args.content]).size;
				meta = formatFileSize(byteLen);
			}
			break;
		}

		case 'ast_edit': {
			label = msg.chat_v2_tool_label_ast_edit();
			const paths = strList(args.paths);
			detail = str(details?.path) ?? (paths.length > 0 ? paths[0] : str(args.path));
			diff = parseDiffStats(str(details?.diff));
			const totalReplacements = num(details?.totalReplacements);
			if (totalReplacements !== undefined) {
				meta = msg.chat_v2_tool_meta_replacements({ count: totalReplacements });
			}
			break;
		}

		case 'retain': {
			label = msg.chat_v2_tool_label_retain();
			detail = str(args.title) ?? str(args.key);
			break;
		}

		case 'web_search': {
			label = msg.chat_v2_tool_label_web_search();
			detail = str(args.query);
			const sources = Array.isArray(details?.sources)
				? details.sources
				: Array.isArray(result?.details)
					? result.details
					: undefined;
			if (sources && sources.length > 0) {
				meta = msg.chat_v2_tool_meta_results({ count: sources.length });
			}
			break;
		}

		case 'fetch': {
			label = msg.chat_v2_tool_label_fetch();
			detail = str(details?.url) ?? str(args.url);
			const status = num(details?.status);
			if (status !== undefined) {
				meta = String(status);
			}
			break;
		}

		case 'browser': {
			label = 'Browser';
			detail = str(args.url) ?? str(args.action);
			break;
		}

		case 'reflect': {
			label = msg.chat_v2_tool_label_reflect();
			detail = str(args.topic) ?? str(args.note);
			break;
		}

		case 'task': {
			label = msg.chat_v2_tool_label_task();
			detail = str(args.task) ?? str(args.description);
			break;
		}

		case 'todo': {
			label = 'Todo';
			detail = str(args.content) ?? str(args.op);
			break;
		}

		case 'ask': {
			label = msg.chat_v2_tool_label_ask();
			detail = str(args.question) ?? str(args.prompt);
			break;
		}

		case 'github': {
			label = 'GitHub';
			detail = str(args.repo) ?? str(args.action);
			break;
		}

		case 'goal': {
			label = msg.chat_v2_tool_label_goal();
			detail = str(args.description) ?? str(args.goal);
			break;
		}

		case 'hub': {
			label = 'Hub';
			detail = str(args.op);
			break;
		}

		case 'irc': {
			label = 'IRC';
			detail = str(args.channel) ?? str(args.target);
			break;
		}

		case 'report_issue': {
			label = msg.chat_v2_tool_label_report_issue();
			detail = str(args.issue) ?? str(args.tool);
			break;
		}

		case 'resolve': {
			label = msg.chat_v2_tool_label_resolve();
			detail = str(args.resolution) ?? str(args.solution);
			break;
		}

		case 'yield': {
			label = msg.chat_v2_tool_label_yield();
			detail = str(args.summary);
			break;
		}

		case 'generate_image': {
			label = msg.chat_v2_tool_label_generate_image();
			detail = str(args.prompt);
			break;
		}

		default: {
			// MCP tool o fallback sconosciuto
			label = toolName;
			detail = previewArgs(args);
			break;
		}
	}

	return {
		category,
		label,
		detail,
		meta,
		diff,
		fail: isError || Boolean(errorReason),
		errorReason
	};
}

/**
 * Sintesi per un passaggio di solo ragionamento (thinking).
 */
export function summarizeThinking(text: string): ToolSummary {
	const trimmed = (text || '').trim();
	const firstLine = trimmed.split('\n', 1)[0] ?? '';
	return {
		category: 'think',
		label: msg.chat_v2_tool_label_thinking(),
		detail: firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || undefined
	};
}
