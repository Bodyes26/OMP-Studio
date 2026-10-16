// Studio e i client remoti leggono lo stesso risultato, identificato per sessione
// e completamento: una risposta tardiva non puo' consumare il turno successivo.
export interface SessionCompletion {
	id: string;
	at: number;
	seen: boolean;
}

const STORAGE_KEY = 'omp-studio.session-completions.v1';
const MAX_COMPLETIONS = 400;

function load(): Record<string, SessionCompletion> {
	try {
		const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const entries = Object.entries(parsed).filter((entry): entry is [string, SessionCompletion] => {
			const value = entry[1];
			return Boolean(value && typeof value === 'object' &&
				typeof value.id === 'string' && Number.isFinite(value.at) && typeof value.seen === 'boolean');
		});
		return Object.fromEntries(entries.slice(-MAX_COMPLETIONS));
	} catch {
		return {};
	}
}

export class SessionCompletionStore {
	private completions = $state<Record<string, SessionCompletion>>(load());

	get(sessionId: string | null | undefined): SessionCompletion | null {
		return sessionId ? this.completions[sessionId] ?? null : null;
	}

	complete(sessionId: string, id: string, at: number): void {
		const existing = this.completions[sessionId];
		if (existing?.id === id || (existing && existing.at > at)) return;
		// Reinserire la chiave mantiene l'ordine di recenza anche per sessioni lunghe.
		delete this.completions[sessionId];
		this.completions[sessionId] = { id, at, seen: false };
		const keys = Object.keys(this.completions);
		for (const key of keys.slice(0, Math.max(0, keys.length - MAX_COMPLETIONS))) delete this.completions[key];
		this.persist();
	}

	markSeen(sessionId: string, id: string): boolean {
		const current = this.completions[sessionId];
		if (!current || current.id !== id) return false;
		if (!current.seen) {
			this.completions[sessionId] = { ...current, seen: true };
			this.persist();
		}
		return true;
	}

	private persist(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.completions));
		} catch {
			// Storage non disponibile: la sincronizzazione resta valida per questa istanza host.
		}
	}
}

export const sessionCompletions = new SessionCompletionStore();
