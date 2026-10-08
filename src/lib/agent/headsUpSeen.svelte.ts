/**
 * Heads-up gia' visti (Gate R40).
 *
 * Machine-local e minimo: un elenco di chiavi `sessione|hash della frase` in
 * localStorage, tagliato alle ultime 400. Non entra in `~/.omp` ne' nel repo:
 * «l'ho visto» riguarda chi guarda, non il progetto. La chiave non usa gli id
 * delle voci del transcript, che cambiano a ogni ricostruzione.
 */
import { headsUpSeenKey } from './turnHeadsUp';

const STORAGE_KEY = 'omp-studio.headsup-seen.v1';
const MAX_KEYS = 400;

function load(): string[] {
	try {
		if (typeof localStorage === 'undefined') return [];
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
	} catch {
		return [];
	}
}

class HeadsUpSeenStore {
	private keys: string[] = load();
	private set = new Set(this.keys);
	/** Contatore reattivo: chi legge `isSeen` si riaggiorna al «Visto». */
	version = $state(0);

	isSeen(sessionId: string | null | undefined, text: string): boolean {
		void this.version;
		return this.set.has(headsUpSeenKey(sessionId, text));
	}

	markSeen(sessionId: string | null | undefined, text: string) {
		const key = headsUpSeenKey(sessionId, text);
		if (this.set.has(key)) return;
		this.keys.push(key);
		this.set.add(key);
		if (this.keys.length > MAX_KEYS) {
			for (const old of this.keys.splice(0, this.keys.length - MAX_KEYS)) this.set.delete(old);
		}
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keys));
		} catch {
			// Quota piena o storage assente: il «visto» vale per questa finestra.
		}
		this.version += 1;
	}
}

export const headsUpSeen = new HeadsUpSeenStore();
