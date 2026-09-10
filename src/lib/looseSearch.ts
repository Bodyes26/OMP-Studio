/**
 * Confronto "sciolto" per i filtri di ricerca dei modelli.
 *
 * I selettori dei modelli sono pieni di separatori (`codex-openai/gpt-5.6-sol`)
 * che l'utente non digita: cercando "gpt 5.6", "gpt 56" o "gpt sol" un semplice
 * `includes()` non trova nulla. Qui separatori e punteggiatura spariscono da
 * entrambi i lati del confronto e la query viene spezzata in token, cosi' che
 * ogni token possa combaciare con una parte qualsiasi del testo, in qualsiasi
 * ordine. Niente subsequence matching: "gpt sol" deve trovare gpt-5.6-sol, non
 * qualunque modello che contenga quelle lettere sparse.
 */

/** Tutto cio' che non e' alfanumerico sparisce: "GPT-5.6" -> "gpt56". */
const NON_ALNUM = /[^a-z0-9]+/g;

/**
 * Vero se ogni token della query compare in almeno uno dei campi indicati.
 * Query vuota (o fatta di sola punteggiatura) = nessun filtro, passa tutto.
 */
export function matchesLooseQuery(
	query: string,
	...fields: (string | null | undefined)[]
): boolean {
	const tokens = query
		.toLowerCase()
		.split(/\s+/)
		.map((token) => token.replace(NON_ALNUM, ''))
		.filter(Boolean);
	if (tokens.length === 0) return true;
	const haystacks: string[] = [];
	for (const field of fields) {
		if (!field) continue;
		const normalized = field.toLowerCase().replace(NON_ALNUM, '');
		if (normalized) haystacks.push(normalized);
	}
	return tokens.every((token) => haystacks.some((hay) => hay.includes(token)));
}
