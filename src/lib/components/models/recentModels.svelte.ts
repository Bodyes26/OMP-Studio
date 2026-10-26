import { type SharedModelItem, getEffectiveSelector } from './modelPicker';

const STORAGE_KEY = 'omp-studio-recent-models';
const MAX_RECENT = 6;

function loadStored(): string[] {
	try {
		if (typeof localStorage === 'undefined') return [];
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
	} catch {
		return [];
	}
}

class RecentModelsManager {
	private _selectors = $state<string[]>(loadStored());

	get selectors(): string[] {
		return this._selectors;
	}

	record(selectorOrModel: string | SharedModelItem) {
		if (!selectorOrModel) return;
		const sel = typeof selectorOrModel === 'string'
			? selectorOrModel.trim()
			: getEffectiveSelector(selectorOrModel).trim();
		if (!sel) return;

		const clean = sel.toLowerCase();
		const without = this._selectors.filter((s) => s.trim().toLowerCase() !== clean);
		this._selectors = [sel, ...without].slice(0, MAX_RECENT);

		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this._selectors));
			}
		} catch {
			// ignore storage errors
		}
	}
}

export const recentModelsStore = new RecentModelsManager();

/**
 * Risolve i modelli recenti a partire da un catalogo e dalla lista ordinata di selettori.
 * Preserva l'ordine temporale di recentModels (il piu recente per primo).
 */
export function resolveRecentModels<T extends SharedModelItem>(
	catalog: T[],
	recentSelectors: string[]
): T[] {
	if (!catalog || catalog.length === 0 || !recentSelectors || recentSelectors.length === 0) {
		return [];
	}

	const out: T[] = [];
	const seen = new Set<string>();

	for (const rawSel of recentSelectors) {
		const sel = rawSel.trim().toLowerCase();
		if (!sel) continue;

		// Cerca per selector esatto, per provider/id, o per id
		const match = catalog.find((m) => {
			const mSel = getEffectiveSelector(m).toLowerCase();
			const mId = (m.id || '').toLowerCase();
			const mComb = (m.provider && m.id ? `${m.provider}/${m.id}` : '').toLowerCase();
			return mSel === sel || mComb === sel || mId === sel;
		});

		if (match) {
			const eff = getEffectiveSelector(match).toLowerCase();
			if (!seen.has(eff)) {
				seen.add(eff);
				out.push(match);
			}
		}
	}

	return out;
}
