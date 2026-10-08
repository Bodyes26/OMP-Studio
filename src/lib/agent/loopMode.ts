// /loop nella chat GUI (variante B del prototipo): decisioni pure, senza rune
// ne' DOM, cosi' i test girano con il solo type-stripping di Node.
//
// Il motore vive nell'estensione `extensions/studio-loop.ts` dentro omp; la
// GUI legge lo stato da `setStatus("studio.loop", json)` e comanda con righe
// `/loop …` e `/studio-loop …`. Parser e serializzazione sono gli stessi
// dell'estensione: una sola grammatica per composer, pillole e motore.

import {
	LOOP_CONTROL_COMMAND,
	LOOP_STATUS_KEY,
	formatLoopCommand,
	parseLoopArgs,
	type LoopBetween,
	type LoopGiro,
	type LoopProbe,
	type LoopSnapshot,
	type LoopState,
	type ParsedLoopArgs
} from '../../../extensions/studio-loop';

export type { LoopBetween, LoopGiro, LoopProbe, LoopSnapshot, LoopState, ParsedLoopArgs };
export { LOOP_CONTROL_COMMAND, LOOP_STATUS_KEY, formatLoopCommand, parseLoopArgs };

export type LoopLimitDraft =
	| { kind: 'iterations'; count: number }
	| { kind: 'duration'; spec: string }
	| { kind: 'none' };

export type LoopConditionMode = 'until' | 'while' | 'none';

/** Le pillole del composer in modalita' ripetizione. */
export interface LoopDraft {
	prompt: string;
	limit: LoopLimitDraft;
	condition: LoopConditionMode;
	command: string;
	between: LoopBetween;
}

export function defaultLoopDraft(): LoopDraft {
	return {
		prompt: '',
		limit: { kind: 'iterations', count: 6 },
		condition: 'none',
		command: 'npm test',
		between: 'prompt'
	};
}

/** Voci del menu del limite, come nel prototipo approvato. */
export const LOOP_LIMIT_PRESETS: readonly LoopLimitDraft[] = [
	{ kind: 'iterations', count: 3 },
	{ kind: 'iterations', count: 6 },
	{ kind: 'iterations', count: 10 },
	{ kind: 'duration', spec: '15m' },
	{ kind: 'duration', spec: '1h' },
	{ kind: 'none' }
];

export function sameLimit(a: LoopLimitDraft, b: LoopLimitDraft): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'iterations' && b.kind === 'iterations') return a.count === b.count;
	if (a.kind === 'duration' && b.kind === 'duration') return a.spec.trim().toLowerCase() === b.spec.trim().toLowerCase();
	return true;
}

/** Bozza -> argomenti del motore. Una stringa e' l'errore da mostrare. */
export function draftToArgs(draft: LoopDraft): ParsedLoopArgs | string {
	const args: ParsedLoopArgs = {};
	if (draft.limit.kind === 'iterations') {
		const n = Math.floor(draft.limit.count);
		if (!Number.isFinite(n) || n <= 0) return 'Loop count must be a positive integer.';
		args.limit = { kind: 'iterations', iterations: n };
	} else if (draft.limit.kind === 'duration') {
		const parsed = parseLoopArgs(draft.limit.spec.trim());
		if (typeof parsed === 'string') return parsed;
		if (parsed.limit?.kind !== 'duration' || parsed.prompt) return 'Use a duration such as 10m or 1h30m.';
		args.limit = parsed.limit;
	}
	if (draft.condition !== 'none') {
		const command = draft.command.trim();
		if (!command) return 'The stop condition needs a command.';
		args.condition = { command, until: draft.condition === 'until' };
	}
	if (draft.between !== 'prompt') args.between = draft.between;
	const prompt = draft.prompt.trim();
	if (prompt) args.prompt = prompt;
	return args;
}

/** La riga `/loop …` di anteprima (e da inviare) per la bozza; `null` se non valida. */
export function draftCommand(draft: LoopDraft): string | null {
	const args = draftToArgs(draft);
	return typeof args === 'string' ? null : formatLoopCommand(args);
}

function durationSpec(ms: number): string {
	return formatLoopCommand({ limit: { kind: 'duration', durationMs: ms } }).slice('/loop '.length);
}

export function draftFromArgs(args: ParsedLoopArgs, base: LoopDraft = defaultLoopDraft()): LoopDraft {
	return {
		prompt: args.prompt ?? base.prompt,
		limit: args.limit
			? args.limit.kind === 'iterations'
				? { kind: 'iterations', count: args.limit.iterations }
				: { kind: 'duration', spec: durationSpec(args.limit.durationMs) }
			: base.limit,
		condition: args.condition ? (args.condition.until ? 'until' : 'while') : base.condition,
		command: args.condition?.command ?? base.command,
		between: args.between ?? base.between
	};
}

/**
 * `/loop` scritto nel composer:
 * - senza argomenti apre le pillole (o ferma il loop attivo, come la TUI);
 * - con un prompt parte subito;
 * - con solo limite/condizione apre le pillole gia' impostate, perche' nella
 *   GUI il prompt si scrive nel composer di ripetizione.
 */
export type LoopSlashAction =
	| { kind: 'setup'; draft: LoopDraft }
	| { kind: 'start'; command: string }
	| { kind: 'stop' }
	| { kind: 'error'; message: string };

export function routeLoopSlash(argument: string, loopActive: boolean): LoopSlashAction {
	const trimmed = argument.trim();
	if (!trimmed) return loopActive ? { kind: 'stop' } : { kind: 'setup', draft: defaultLoopDraft() };
	const parsed = parseLoopArgs(trimmed);
	if (typeof parsed === 'string') return { kind: 'error', message: parsed };
	if (loopActive) return { kind: 'error', message: 'A loop is already active. Stop it first.' };
	if (!parsed.prompt) return { kind: 'setup', draft: draftFromArgs(parsed) };
	return { kind: 'start', command: formatLoopCommand(parsed) };
}

export function controlLine(op: 'pause' | 'resume' | 'stop' | 'dismiss' | 'status' | 'probe', arg = ''): string {
	return arg ? `${LOOP_CONTROL_COMMAND} ${op} ${arg}` : `${LOOP_CONTROL_COMMAND} ${op}`;
}

/** `setStatus("studio.loop", …)`: JSON dell'estensione, validato quanto basta. */
export function parseLoopSnapshot(text: unknown): LoopSnapshot | null {
	if (typeof text !== 'string' || !text.trim()) return null;
	try {
		const raw = JSON.parse(text) as Partial<LoopSnapshot>;
		if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
		const loop = raw.loop && typeof raw.loop === 'object' && typeof raw.loop.id === 'string' ? raw.loop : null;
		if (loop && !Array.isArray(loop.giri)) loop.giri = [];
		const probe = raw.probe && typeof raw.probe === 'object' && typeof raw.probe.command === 'string' ? raw.probe : null;
		return { v: 1, loop, probe };
	} catch {
		return null;
	}
}

/** Il loop tiene la sessione: anche in pausa (attivo) o armato. */
export function isLoopActive(loop: LoopState | null | undefined): boolean {
	return Boolean(loop) && loop!.status !== 'done' && loop!.status !== 'stopped' && loop!.status !== 'error';
}

/** Il loop sta facendo girare l'agente (non in pausa, non armato). */
export function isLoopRunning(loop: LoopState | null | undefined): boolean {
	return isLoopActive(loop) && loop!.status !== 'paused' && loop!.status !== 'armed';
}

export type SegmentState = 'done' | 'ok' | 'cur' | 'stop' | 'fail' | 'todo';

/**
 * Barra a segmenti: un segmento per giro. Con limite di giri il totale e'
 * noto; senza, la barra mostra i giri fatti piu' uno (minimo 4).
 */
export function loopSegments(loop: LoopState): SegmentState[] {
	const total =
		loop.limit?.kind === 'iterations' ? loop.limit.initial : Math.max(4, loop.giro + (isLoopActive(loop) ? 1 : 0));
	const out: SegmentState[] = [];
	const lastN = loop.giro;
	for (let n = 1; n <= total; n++) {
		const giro = loop.giri.find((g) => g.n === n);
		if (!giro) {
			out.push('todo');
			continue;
		}
		if (n === lastN && loop.status === 'stopped') out.push('stop');
		else if (n === lastN && loop.status === 'error') out.push('fail');
		else if (giro.endedAt === undefined && !giro.aborted) out.push('cur');
		else if (n === lastN && loop.status === 'done' && loop.end?.reason === 'condition') out.push('ok');
		else out.push('done');
	}
	return out;
}

/** `mm:ss` (o `h:mm:ss`) da `startedAt` a `endedAt`/adesso. */
export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(sec).padStart(2, '0');
	return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function giroDurationMs(giro: LoopGiro, now: number): number {
	return (giro.endedAt ?? now) - giro.startedAt;
}

/** Il giro e' chiuso e puo' ripiegarsi in una riga nel transcript. */
export function isGiroClosed(loop: LoopState, n: number): boolean {
	const giro = loop.giri.find((g) => g.n === n);
	if (!giro) return n < loop.giro || !isLoopActive(loop);
	return giro.endedAt !== undefined || Boolean(giro.aborted) || n < loop.giro || !isLoopActive(loop);
}

/** Prima riga leggibile del testo dell'assistente, per la riga ripiegata. */
export function giroHeadline(texts: readonly string[], max = 160): string {
	const joined = texts
		.join('\n')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[`*_#>]/g, '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const last = joined[joined.length - 1] ?? '';
	return last.length > max ? `${last.slice(0, max - 1)}\u2026` : last;
}

/** Il messaggio utente e' il prompt del loop ripetuto. */
export function isLoopPromptEcho(loop: LoopState | null | undefined, content: string): boolean {
	if (!loop?.prompt || !isLoopActive(loop)) return false;
	return content.trim() === loop.prompt.trim();
}

export type LoopFoldItem<T> =
	| { kind: 'item'; item: T }
	/** Riga di un giro chiuso: ripiegata (`open: false`) o intestazione del giro aperto. */
	| { kind: 'giro'; n: number; key: string; open: boolean; items: T[] }
	/** Separatore del giro in corso: «Giro n · prompt ripetuto». */
	| { kind: 'giro-sep'; n: number; key: string };

export interface LoopFoldProbe {
	/** L'elemento apre un turno utente (chiude il giro precedente). */
	user: boolean;
	/** Il messaggio utente e' il prompt del giro `n`. */
	giro?: number;
	key: string;
}

/**
 * Ripiega i giri nel transcript: ogni messaggio utente marcato come giro e
 * gli elementi che lo seguono (fino al prossimo messaggio utente) diventano
 * una riga; un giro aperto mostra l'intestazione e poi il contenuto. Il
 * messaggio del prompt ripetuto non si ridisegna: e' sempre lo stesso.
 */
export function foldLoopItems<T>(
	items: readonly T[],
	probe: (item: T) => LoopFoldProbe,
	isClosed: (n: number) => boolean,
	isOpen: (key: string) => boolean
): LoopFoldItem<T>[] {
	const out: LoopFoldItem<T>[] = [];
	let i = 0;
	while (i < items.length) {
		const info = probe(items[i]);
		if (!info.user || info.giro === undefined) {
			out.push({ kind: 'item', item: items[i] });
			i++;
			continue;
		}
		const n = info.giro;
		const body: T[] = [];
		let j = i + 1;
		while (j < items.length && !probe(items[j]).user) {
			body.push(items[j]);
			j++;
		}
		if (isClosed(n)) {
			const open = isOpen(info.key);
			out.push({ kind: 'giro', n, key: info.key, open, items: body });
			if (open) for (const item of body) out.push({ kind: 'item', item });
		} else {
			out.push({ kind: 'giro-sep', n, key: info.key });
			for (const item of body) out.push({ kind: 'item', item });
		}
		i = j;
	}
	return out;
}
