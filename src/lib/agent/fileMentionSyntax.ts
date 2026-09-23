// Sintassi delle menzioni file (@percorso) condivisa da tutte le superfici:
// composer della chat, editor dei task, companion, bolle e anteprime.
// Modulo puro (niente Tauri) perche' lo usano anche il lexer markdown e il
// parser del companion, che girano nei test senza backend.
//
// Forme accettate:
//   @src/lib/file.ts            percorso senza spazi
//   @"Cruscotto PSR/Pagina.aspx" percorso con spazi, tra virgolette
// La @ vale solo a inizio testo o dopo uno spazio: cosi' le email e i
// decoratori (`foo@bar.it`, `x@Input`) restano testo.

export interface FileMentionSpan {
	/** Indice della @ nel testo. */
	start: number;
	/** Indice subito dopo la menzione (virgoletta finale inclusa). */
	end: number;
	/** Percorso senza @ e senza virgolette, con separatori `/`. */
	path: string;
	/** Testo originale della menzione. */
	raw: string;
}

const QUOTED_RE = /^@"([^"\r\n]+)"/;
// Esclude i caratteri che nel testo chiudono la menzione o sono markdown
// (`*` enfasi, `` ` `` codespan): `**@a.ts**` deve dare `a.ts`.
const BARE_RE = /^@([^\s"'`<>|*]+)/;
// Punteggiatura di fine frase che segue un percorso: "vedi @a.ts." -> a.ts
const TRAILING_PUNCT_RE = /[.,;:!?)\]}]+$/;
// L'estensione deve contenere una lettera: `@1.5` o `@v1.2.3` non sono file.
const EXTENSION_RE = /\.[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Un token e' un file se contiene un separatore di cartella o termina con
 * un'estensione. `@Main` e `@utente` restano testo.
 */
export function isFileMentionPath(path: string): boolean {
	if (!path || path.includes('://')) return false;
	if (/[\\/]/.test(path)) return /[A-Za-z0-9_]/.test(path);
	return EXTENSION_RE.test(path);
}

/** Testo da inserire per menzionare `path`: virgolette solo se servono. */
export function formatFileMention(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	return /\s/.test(normalized) ? `@"${normalized}"` : `@${normalized}`;
}

/**
 * Riconosce una menzione che inizia esattamente a `src[0]`. Non controlla il
 * carattere precedente: e' compito del chiamante.
 */
export function matchFileMentionAt(src: string): { raw: string; path: string } | null {
	if (src.charCodeAt(0) !== 64 /* @ */) return null;
	const quoted = QUOTED_RE.exec(src);
	if (quoted) {
		const path = quoted[1].trim().replace(/\\/g, '/');
		return isFileMentionPath(path) ? { raw: quoted[0], path } : null;
	}
	const bare = BARE_RE.exec(src);
	if (!bare) return null;
	const path = bare[1].replace(TRAILING_PUNCT_RE, '');
	if (!isFileMentionPath(path)) return null;
	return { raw: `@${path}`, path: path.replace(/\\/g, '/') };
}

/** Tutte le menzioni file del testo, in ordine. */
export function findFileMentions(text: string): FileMentionSpan[] {
	const spans: FileMentionSpan[] = [];
	let index = text.indexOf('@');
	while (index !== -1) {
		if (index === 0 || /\s/.test(text[index - 1])) {
			const match = matchFileMentionAt(text.slice(index));
			if (match) {
				spans.push({ start: index, end: index + match.raw.length, path: match.path, raw: match.raw });
				index = text.indexOf('@', index + match.raw.length);
				continue;
			}
		}
		index = text.indexOf('@', index + 1);
	}
	return spans;
}
