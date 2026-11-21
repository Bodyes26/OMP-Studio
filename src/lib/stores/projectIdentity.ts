/**
 * Identità condivisa di un progetto presente su più macchine (R-MI-12, MI20).
 *
 * Regola approvata in F16 e ripristinata in F18: sono lo **stesso progetto** due
 * copie con lo stesso `origin` GitHub normalizzato (`owner/repo`), altrimenti
 * con lo stesso primo commit del repository. Senza nessuno dei due non c'è
 * identità, e le copie restano progetti distinti: meglio due tessere di troppo
 * che fondere due repository diversi per errore.
 *
 * Cosa NON fa: non sincronizza nulla. La fusione è di presentazione. I due
 * working tree possono divergere, e git resta l'unico ponte: lo dice la
 * funzione `copiesDiverge`, che serve all'avviso approvato in F17.
 *
 * Perché un file a parte: la fusione si calcola in `projectOrder` a ogni
 * render della barra, quindi deve essere pura e senza dipendenze da Tauri.
 */

/** Ciò che identifica una copia, ricavato dal suo stato git. */
export interface RepositoryIdentity {
	repoSlug?: string | null;
	rootCommit?: string | null;
	/**
	 * Nome attuale del repository su GitHub, se diverso da `repoSlug`: una
	 * copia con l'origin di prima di una rinomina resta lo stesso progetto
	 * (R-MI-32).
	 */
	canonicalSlug?: string | null;
	/**
	 * Solo per le copie senza origin: `false` finché l'utente non ha confermato
	 * che è lo stesso progetto delle altre con lo stesso primo commit. Due fork
	 * locali hanno la stessa radice: unirli da soli li confondeva (R-MI-32).
	 * Assente = regola precedente, il primo commit basta.
	 */
	rootConfirmed?: boolean;
}

/** Come si riconosce la seconda copia di un progetto. */
export type IdentityKind = 'origin' | 'root-commit';

export interface Identity {
	kind: IdentityKind;
	/** Valore normalizzato: `owner/repo` oppure lo sha del primo commit. */
	value: string;
}

/**
 * Identità di una copia, oppure `null` se non è un repository git con una
 * delle due ancore o se il primo commit non è ancora stato confermato.
 * L'origin vince sul primo commit: due fork con la stessa radice e origin
 * diversi restano progetti distinti.
 */
export function identityOf(copy: RepositoryIdentity | null | undefined): Identity | null {
	if (!copy) return null;
	const slugOf = (value: string | null | undefined) => typeof value === 'string' ? value.trim().toLowerCase() : '';
	const slug = slugOf(copy.canonicalSlug) || slugOf(copy.repoSlug);
	if (slug) return { kind: 'origin', value: slug };
	const root = typeof copy.rootCommit === 'string' ? copy.rootCommit.trim().toLowerCase() : '';
	if (!root || copy.rootConfirmed === false) return null;
	return { kind: 'root-commit', value: root };
}

/** Chiave di fusione: due copie con la stessa chiave sono lo stesso progetto. */
export function identityKey(identity: Identity | null): string | null {
	return identity ? `${identity.kind}:${identity.value}` : null;
}

/**
 * Le due copie sono divergenti? Confronta i branch quando entrambi sono noti;
 * un `null` (stato git non ancora letto) non è divergenza, altrimenti
 * l'avviso lampeggerebbe a ogni avvio.
 */
export function copiesDiverge(
	a: { branch?: string | null; ahead?: number | null } | null | undefined,
	b: { branch?: string | null; ahead?: number | null } | null | undefined
): boolean {
	if (!a || !b) return false;
	const left = (a.branch ?? '').trim();
	const right = (b.branch ?? '').trim();
	if (left && right && left !== right) return true;
	// Commit non ancora spinti: la copia che ne ha è avanti rispetto a git.
	if ((a.ahead ?? 0) > 0 && (b.ahead ?? 0) > 0) return true;
	return false;
}

/**
 * Raggruppa le copie per identità, nell'ordine in cui compaiono. Le copie
 * senza identità restano singole e nell'ordine d'ingresso: l'ordine della
 * barra non deve cambiare perché un progetto non è su git.
 *
 * Restituisce, per ogni gruppo, gli indici delle copie: il chiamante decide
 * come rappresentarle (una tessera per gruppo, con la macchina preferita).
 */
export function groupByRepository<T extends RepositoryIdentity>(
	copies: readonly T[]
): number[][] {
	const groups = new Map<string, number[]>();
	const singles: number[] = [];
	copies.forEach((copy, index) => {
		const key = identityKey(identityOf(copy));
		if (!key) {
			singles.push(index);
			return;
		}
		const group = groups.get(key);
		if (group) group.push(index);
		else groups.set(key, [index]);
	});
	// L'ordine finale segue la prima comparsa di ogni gruppo, così una tessera
	// non salta di posto quando arriva lo stato dell'altra macchina.
	const out: number[][] = [];
	const emitted = new Set<number>();
	for (let index = 0; index < copies.length; index++) {
		if (emitted.has(index)) continue;
		const key = identityKey(identityOf(copies[index]));
		const group = key ? groups.get(key) : undefined;
		if (!group) {
			out.push([index]);
			emitted.add(index);
			continue;
		}
		for (const member of group) emitted.add(member);
		out.push([...group]);
	}
	return out;
}
