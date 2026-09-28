// DSL per la costruzione di scenari di test per la chat v2 (chat-bench).
// Produce eventi conformi al protocollo wire RPC di omp (studio_delta, tool_execution_*, ecc.)
// con tempistiche e dati realistici.

import type { TodoPhase, TodoStatus } from '../wire';

export type ToolKind = 'read' | 'grep' | 'glob' | 'run' | 'edit' | 'write' | 'web' | 'think';

export interface BenchToolOptions {
	par?: boolean;
	ms?: number;
	fail?: boolean;
	partial?: string;
	diff?: string | [number, number];
	totalLines?: number;
	fileSize?: number;
	matches?: number;
	files?: string[];
	content?: string;
}

export interface BenchTool {
	kind: ToolKind;
	name: string;
	label: string;
	detail?: string;
	meta?: string;
	args: Record<string, unknown>;
	intent?: string;
	par?: boolean;
	ms: number;
	fail?: boolean;
	partial?: string;
	resultData?: {
		content?: string;
		details?: unknown;
	};
}

export interface BenchOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface BenchQuestion {
	id: string;
	header?: string;
	question: string;
	multi?: boolean;
	recommended?: number;
	options: BenchOption[];
}

export interface BenchAnswer {
	choices: number[];
	other?: string;
	note?: string;
	skipped?: boolean;
}

export type BenchAnswers = Record<string, BenchAnswer>;

export interface BenchSubAgent {
	name: string;
	task: string;
	result: string;
	tools: BenchTool[];
	ask?: {
		after: number;
		questions: BenchQuestion[];
	};
}

export type BenchPart =
	| { type: 'tools'; tools: BenchTool[] }
	| { type: 'text'; text: string | ((answers: BenchAnswers) => string) }
	| { type: 'thinking'; text: string; ms?: number }
	| { type: 'ask'; questions: BenchQuestion[] }
	| { type: 'plan'; items: string[] }
	| { type: 'step'; index: number }
	| { type: 'agents'; agents: BenchSubAgent[] }
	| { type: 'compaction' }
	| { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string; source?: string };

export interface BenchScenario {
	key: string;
	name: string;
	hint: string;
	prompt: string;
	parts: BenchPart[];
	/** Opzionale: precarica uno storico prima di avviare il turno attivo */
	preloadHistoryCount?: number;
	/** Opzionale: stringa NDJSON grezza registrata dal canale RPC reale */
	ndjsonRaw?: string;
}

/* ------------------------------------------------------------- tool helpers */

export function readTool(path: string, o: BenchToolOptions = {}): BenchTool {
	const lines = o.totalLines ?? 85;
	const size = o.fileSize ?? 2450;
	return {
		kind: 'read',
		name: 'read',
		label: 'Lettura',
		detail: path,
		args: { path },
		intent: `Lettura ${path}`,
		ms: o.ms ?? 380,
		par: o.par,
		resultData: {
			content: o.content ?? `// Contenuto simulato di ${path}\nexport const ready = true;`,
			details: {
				totalLines: lines,
				fileSize: size,
				meta: { source: { type: 'path', value: path } }
			}
		}
	};
}

export function grepTool(query: string, meta: string, o: BenchToolOptions = {}): BenchTool {
	const matches = o.matches ?? 18;
	const files = o.files ?? [meta.split(' ')[0] || 'src/index.ts'];
	return {
		kind: 'grep',
		name: 'grep',
		label: `Ricerca “${query}”`,
		detail: query,
		meta,
		args: { pattern: query },
		intent: `Ricerca "${query}"`,
		ms: o.ms ?? 450,
		par: o.par,
		resultData: {
			content: `# Risultati per "${query}" in ${meta}`,
			details: {
				scopePath: '.',
				matchCount: matches,
				fileCount: files.length,
				files,
				displayContent: `# ${meta}\n*1│export const ${query} = true;\n 2│function handle() {}`
			}
		}
	};
}

export function globTool(pattern: string, o: BenchToolOptions = {}): BenchTool {
	const files = o.files ?? ['src/index.ts', 'src/types.ts', 'src/utils.ts'];
	return {
		kind: 'glob',
		name: 'glob',
		label: `Esplora “${pattern}”`,
		detail: pattern,
		args: { path: pattern },
		intent: `Elenco file in ${pattern}`,
		ms: o.ms ?? 350,
		par: o.par,
		resultData: {
			content: files.join('\n'),
			details: {
				scopePath: '.',
				fileCount: files.length,
				files,
				truncated: false
			}
		}
	};
}

export function runTool(cmd: string, meta?: string, o: BenchToolOptions = {}): BenchTool {
	return {
		kind: 'run',
		name: 'bash',
		label: 'Esecuzione',
		detail: cmd,
		meta,
		args: { command: cmd },
		intent: `Esecuzione: ${cmd}`,
		fail: o.fail,
		partial: o.partial,
		ms: o.ms ?? 900,
		par: o.par,
		resultData: {
			content: o.fail ? `Errore esecuzione:\nCommand failed: ${cmd}` : meta ?? 'Completato con successo',
			details: {
				timeoutSeconds: 300,
				wallTimeMs: o.ms ?? 900
			}
		}
	};
}

function formatOmpDiff(path: string, diff: string | [number, number] | undefined): string {
	if (typeof diff === 'string') return diff;
	const added = diff ? diff[0] : 4;
	const removed = diff ? diff[1] : 2;
	const rows: string[] = [
		` 1|// Modifica a ${path}`,
		'-2|export const deprecato = false;'
	];
	for (let i = 0; i < added; i++) {
		rows.push(`+${2 + i}|export const implementazioneNuova_${i + 1} = true;`);
	}
	if (removed > 1) {
		rows.push(`-3|export const vecchioRiferimento = null;`);
	}
	rows.push(` ${2 + added}|// Fine modifica`);
	return rows.join('\n');
}

export function editTool(path: string, diff: string | [number, number], o: BenchToolOptions = {}): BenchTool {
	const diffStr = formatOmpDiff(path, diff);
	return {
		kind: 'edit',
		name: 'edit',
		label: 'Modifica',
		detail: path,
		args: { path },
		intent: `Modifica ${path}`,
		ms: o.ms ?? 520,
		par: o.par,
		resultData: {
			content: `Applicata patch su ${path}`,
			details: {
				path,
				diff: diffStr,
				op: 'update'
			}
		}
	};
}

export function writeTool(path: string, content = 'export default {}', o: BenchToolOptions = {}): BenchTool {
	return {
		kind: 'write',
		name: 'write',
		label: 'Scrittura',
		detail: path,
		args: { path, content },
		intent: `Scrittura ${path}`,
		ms: o.ms ?? 400,
		par: o.par,
		resultData: {
			content: `Creato file ${path} (${content.length} byte)`,
			details: { resolvedPath: path }
		}
	};
}

export function webTool(url: string, o: BenchToolOptions = {}): BenchTool {
	return {
		kind: 'web',
		name: 'web',
		label: 'Pagina web',
		detail: url,
		args: { url },
		intent: `Consultazione documentazione ${url}`,
		ms: o.ms ?? 700,
		par: o.par,
		resultData: {
			content: `Contenuto letto da ${url} (HTTP 200 OK)`
		}
	};
}

export function thinkTool(label: string, ms = 800): BenchTool {
	return {
		kind: 'think',
		name: 'think',
		label,
		args: { thought: label },
		intent: label,
		ms
	};
}

/* ------------------------------------------------------------- todo helpers */

export function buildTodoPhases(items: string[], activeIndex = 0): TodoPhase[] {
	return [
		{
			id: 'phase-main',
			name: 'Piano di lavoro',
			tasks: items.map((content, idx) => {
				let status: TodoStatus = 'pending';
				if (idx < activeIndex) status = 'completed';
				else if (idx === activeIndex) status = activeIndex >= items.length ? 'completed' : 'in_progress';
				return {
					id: `task-${idx + 1}`,
					content,
					status
				};
			})
		}
	];
}
