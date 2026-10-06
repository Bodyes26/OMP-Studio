import type { ModelInfo } from './wire';

export interface PrewalkState {
	state: 'off' | 'armed' | 'handedOff';
	target?: string;
	handedOffTo?: string;
}

export type PrewalkNotice =
	| { kind: 'armed'; target?: string }
	| { kind: 'disarmed' }
	| { kind: 'handedOff'; model: string }
	| { kind: 'error'; message: string }
	| { kind: 'unknown' };

/** La sorgente resta obbligatoria: altri avvisi possono citare il prewalk. */
export function parsePrewalkNotice(source: string | undefined, level: string | undefined, text: string): PrewalkNotice | null {
	if (source !== 'prewalk') return null;
	if (level === 'error' || level === 'warning' || level === 'warn') return { kind: 'error', message: text };
	if (/\bnothing to switch\b/i.test(text)) return { kind: 'error', message: text };
	const armed = /\b(?:already\s+)?armed\s+for\s+(.+?)(?=\s+[—–]|,\s*waiting|\s*\r?\n|$)/i.exec(text);
	if (armed) return { kind: 'armed', target: armed[1].trim() };
	if (/\bdisarmed\b/i.test(text)) return { kind: 'disarmed' };
	const switched = /\bswitched\s+to\s+(.+?)(?=\s+after\b|\s*\r?\n|$)/i.exec(text);
	if (switched) return { kind: 'handedOff', model: switched[1].trim() };
	// Il testo sconosciuto non deve inventare uno stato confermato.
	return { kind: 'unknown' };
}

export function reducePrewalkNotice(current: PrewalkState, notice: PrewalkNotice | null): PrewalkState {
	if (!notice) return current;
	if (notice.kind === 'armed') return { state: 'armed', target: notice.target ?? current.target };
	if (notice.kind === 'disarmed') return { state: 'off' };
	if (notice.kind === 'handedOff') return { state: 'handedOff', target: current.target, handedOffTo: notice.model };
	return current;
}

export function prewalkModelName(model: ModelInfo | string | undefined): string | undefined {
	if (typeof model === 'string') return model;
	return model?.name ?? model?.id;
}

export function handOffPrewalk(current: PrewalkState, model: ModelInfo | string | undefined): PrewalkState {
	if (current.state !== 'armed') return current;
	return { state: 'handedOff', target: current.target, handedOffTo: prewalkModelName(model) ?? current.target };
}
