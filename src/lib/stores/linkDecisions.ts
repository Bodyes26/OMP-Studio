/**
 * Decisioni «stesso progetto / progetti diversi» condivise fra le macchine
 * (R-MI-44, precisa R-MI-32). Regole pure, provate senza finestra.
 *
 * Una copia si chiama `macchina::percorso`. In ogni finestra la propria
 * macchina e' `local`, quindi la stessa copia ha nomi diversi sul Mac e sul
 * PC: le decisioni viaggiano con l'id vero della macchina e si traducono
 * all'arrivo.
 */

export const LOCAL = 'local';

export interface LinkDecision {
	/** Le due copie, in forma portabile e in ordine. */
	a: string;
	b: string;
	/** Primo commit condiviso: serve a unire le copie nella stessa tessera. */
	root: string;
	same: boolean;
	/** Istante dell'orologio logico: vince la decisione piu' recente. */
	at: number;
}

function split(key: string): [string, string] {
	const at = key.indexOf('::');
	return at < 0 ? [key, ''] : [key.slice(0, at), key.slice(at + 2)];
}

/** `local::p` → `<id>::p`: la forma che capiscono le altre macchine. */
export function toPortable(key: string, ownId: string): string {
	const [machine, path] = split(key);
	return machine === LOCAL && ownId ? `${ownId}::${path}` : key;
}

/** `<id>::p` → `local::p` quando `<id>` e' questa macchina. */
export function toLocal(key: string, ownId: string): string {
	const [machine, path] = split(key);
	return ownId && machine === ownId ? `${LOCAL}::${path}` : key;
}

export function pairId(a: string, b: string): string {
	return [a, b].sort().join('|');
}

export function decide(a: string, b: string, root: string, same: boolean, at: number): LinkDecision {
	const [first, second] = [a, b].sort();
	return { a: first, b: second, root: root.toLowerCase(), same, at };
}

/**
 * Unisce le decisioni arrivate a quelle tenute qui: per ogni coppia vince la
 * piu' recente; a pari istante «diversi» vince su «stesso», per non unire due
 * progetti senza una conferma certa. Restituisce `null` se non cambia nulla.
 */
export function mergeDecisions(
	current: Readonly<Record<string, LinkDecision>>,
	incoming: readonly LinkDecision[]
): Record<string, LinkDecision> | null {
	let next: Record<string, LinkDecision> | null = null;
	for (const decision of incoming) {
		if (!decision || typeof decision.a !== 'string' || typeof decision.b !== 'string' || typeof decision.at !== 'number') continue;
		const id = pairId(decision.a, decision.b);
		const known = (next ?? current)[id];
		const newer = !known || decision.at > known.at || (decision.at === known.at && known.same && !decision.same);
		if (!newer) continue;
		next ??= { ...current };
		next[id] = { ...decision };
	}
	return next;
}

/** Copia confermata come parte del progetto con quel primo commit. */
export function isConfirmed(decisions: Readonly<Record<string, LinkDecision>>, root: string, portableKey: string): boolean {
	const needle = root.toLowerCase();
	return Object.values(decisions).some((decision) => decision.same && decision.root === needle && (decision.a === portableKey || decision.b === portableKey));
}

export function isRefused(decisions: Readonly<Record<string, LinkDecision>>, a: string, b: string): boolean {
	return decisions[pairId(a, b)]?.same === false;
}
