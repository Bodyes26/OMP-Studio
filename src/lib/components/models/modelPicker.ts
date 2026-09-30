import { matchesLooseQuery } from '../../looseSearch.ts';

/**
 * Rappresentazione unificata di un modello usata da tutti i selettori
 * (TaskEditor, RolesTab, CycleDrawer, Composer).
 * Compatibile strutturalmente sia con ModelDto sia con ModelInfo.
 */
export interface SharedModelItem {
	id?: string;
	name?: string;
	provider?: string;
	selector?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinking?: boolean | string[] | { mode?: string; efforts?: string[] };
	input?: string[];
	cost?: { input?: number; output?: number };
	isCustom?: boolean;
}

export function getEffectiveSelector(model: SharedModelItem): string {
	if (model.selector) return model.selector;
	if (model.provider && model.id) return `${model.provider}/${model.id}`;
	return model.id || '';
}

export function getEffectiveProvider(model: SharedModelItem): string {
	if (model.provider) return model.provider;
	if (model.selector && model.selector.includes('/')) {
		return model.selector.split('/')[0];
	}
	return 'Altri';
}

export function isSameModel(a?: SharedModelItem | null, b?: SharedModelItem | null): boolean {
	if (!a || !b) return false;
	if (a.selector && b.selector) return a.selector === b.selector;
	const aProv = a.provider || (a.selector?.includes('/') ? a.selector.split('/')[0] : '');
	const bProv = b.provider || (b.selector?.includes('/') ? b.selector.split('/')[0] : '');
	const aId = a.id || a.selector;
	const bId = b.id || b.selector;
	if (aProv && bProv && aId && bId) {
		return aProv === bProv && aId === bId;
	}
	if (aId && bId) return aId === bId;
	return false;
}

export function modelSupportsVision(model?: SharedModelItem | null): boolean {
	return Boolean(model && Array.isArray(model.input) && model.input.includes('image'));
}

export function modelSupportsReasoning(model?: SharedModelItem | null): boolean {
	if (!model) return false;
	if (model.reasoning === true) return true;
	if (Array.isArray(model.thinking)) return model.thinking.length > 0;
	if (model.thinking && typeof model.thinking === 'object') {
		const t = model.thinking;
		const hasMode = 'mode' in t && Boolean(t.mode);
		const hasEfforts = 'efforts' in t && Array.isArray(t.efforts) && t.efforts.length > 0;
		return hasMode || hasEfforts;
	}
	return Boolean(model.thinking);
}

export function thinkingTitle(model: SharedModelItem): string {
	let efforts: string[] | null = null;
	if (Array.isArray(model.thinking)) {
		efforts = model.thinking;
	} else if (model.thinking && typeof model.thinking === 'object' && 'efforts' in model.thinking) {
		const raw = model.thinking.efforts;
		if (Array.isArray(raw) && raw.length > 0) {
			efforts = raw;
		}
	}
	return efforts && efforts.length > 0
		? `Thinking: ${efforts.join(' · ')}`
		: 'Thinking: supporta il ragionamento esteso';
}

export function formatContextTokens(tokens?: number): string {
	if (!tokens) return '';
	if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return `${tokens}`;
}

export interface GroupedModelsResult<T extends SharedModelItem = SharedModelItem> {
	groupedModels: Array<[string, T[]]>;
	visibleModels: T[];
}

/**
 * Filtra e raggruppa i modelli per provider in modo deterministico e uniforme
 * su tutte le superfici (Task, Roles, Cycle, Composer).
 *
 * 1. Filtro: fuzzy `matchesLooseQuery` su nome, id, provider e selector.
 *    La query 'gpt 6.1' individua 'gpt-6.1' indifferentemente dal campo.
 * 2. Raggruppamento: ordinamento alfabetico dei provider (con 'Altri' per quelli senza provider).
 * 3. Visible models: elenco piatto ordinato esattamente secondo i gruppi visibili a schermo.
 *    La navigazione con tastiera scorre in questo ordine senza salti visivi.
 */
export function filterAndGroupModels<T extends SharedModelItem>(
	catalog: T[],
	query: string
): GroupedModelsResult<T> {
	const q = query.trim();
	const filtered = q
		? catalog.filter((m) =>
				matchesLooseQuery(
					q,
					m.name,
					m.id,
					m.provider,
					m.selector || (m.provider && m.id ? `${m.provider}/${m.id}` : m.id)
				)
			)
		: catalog;

	const map = new Map<string, T[]>();
	for (const m of filtered) {
		const provider = getEffectiveProvider(m);
		const list = map.get(provider) ?? [];
		list.push(m);
		map.set(provider, list);
	}

	const groupedModels = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	const visibleModels = groupedModels.flatMap(([_, models]) => models);

	return { groupedModels, visibleModels };
}
