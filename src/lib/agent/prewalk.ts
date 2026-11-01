import type { ModelInfo } from './wire';

export interface PrewalkState {
	state: 'off' | 'armed' | 'handedOff';
	target?: string;
	handedOffTo?: string;
}

/**
 * `prewalk.into` (destinazione al primo edit) e `prewalk.from` (modello a cui
 * torna «Ripeti»): un ruolo `@nome` o un selettore `provider/id[:thinking]`.
 */
export interface PrewalkTargets {
	into: string;
	from: string;
}

/** Valori predefiniti di omp (18.14.0+) quando `config.yml` non li imposta. */
export const DEFAULT_PREWALK_TARGETS: Readonly<PrewalkTargets> = { into: '@smol', from: '@default' };

export function normalizePrewalkTargets(raw: Partial<PrewalkTargets> | null | undefined): PrewalkTargets {
	return {
		into: raw?.into?.trim() || DEFAULT_PREWALK_TARGETS.into,
		from: raw?.from?.trim() || DEFAULT_PREWALK_TARGETS.from
	};
}

/** Ruolo indicato da un selettore `@ruolo`, altrimenti null (modello esplicito). */
export function prewalkTargetRole(selector: string): string | null {
	const trimmed = selector.trim();
	return trimmed.startsWith('@') && trimmed.length > 1 ? trimmed.slice(1) : null;
}

export type PrewalkSlashAction =
	| { kind: 'open' }
	| { kind: 'arm'; into: string }
	| { kind: 'off' }
	| { kind: 'restart'; from?: string; into?: string }
	| { kind: 'usage' };

/**
 * Stessa grammatica del `/prewalk` di omp: `[into] | restart [from] [into] | off`.
 * Senza argomenti la chat apre la scheda (e arma, come omp).
 */
export function routePrewalkSlash(argument: string): PrewalkSlashAction {
	const [verb, ...rest] = argument.trim().split(/\s+/).filter(Boolean);
	if (!verb) return { kind: 'open' };
	const keyword = verb.toLowerCase();
	if (keyword === 'off') return rest.length === 0 ? { kind: 'off' } : { kind: 'usage' };
	if (keyword === 'restart') {
		if (rest.length > 2) return { kind: 'usage' };
		return { kind: 'restart', from: rest[0], into: rest[1] };
	}
	return rest.length === 0 ? { kind: 'arm', into: verb } : { kind: 'usage' };
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

/**
 * Un cambio di modello e' il passaggio del prewalk solo se porta sul modello
 * bersaglio: con il prewalk armato l'utente puo' ancora cambiare modello a
 * mano, e scambiarlo per il passaggio spegnerebbe il prewalk senza motivo.
 */
export function isPrewalkHandOff(current: PrewalkState, model: ModelInfo | null | undefined): boolean {
	if (current.state !== 'armed' || !current.target || !model?.id) return false;
	const target = current.target.trim().toLowerCase();
	const id = model.id.toLowerCase();
	const selector = model.provider ? `${model.provider.toLowerCase()}/${id}` : id;
	return target === selector || target === id;
}
