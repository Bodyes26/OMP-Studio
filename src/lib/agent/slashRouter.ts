// Instradamento dei comandi slash di sessione gestiti da Studio nella GUI.
//
// Primo pezzo estratto da `handleGuiSlashCommand` (routes/+page.svelte): solo
// i comandi che toccano sessioni e rami, cosi' gli alias e gli argomenti sono
// coperti da test puri senza montare la pagina. Gli altri comandi restano
// nella pagina finche' un lavoro non li tocca.

export interface ParsedSlash {
	/** Comando come digitato, con la barra (`/Resume`). */
	command: string;
	/** Comando in minuscolo, con la barra (`/resume`). */
	lower: string;
	/** Resto della riga, spazi ai bordi rimossi. */
	argument: string;
}

export function parseSlash(raw: string): ParsedSlash {
	const trimmed = raw.trim();
	const [command = '', ...rest] = trimmed.split(/\s+/);
	return { command, lower: command.toLowerCase(), argument: rest.join(' ').trim() };
}

/**
 * Azione di sessione richiesta da un comando:
 * - `sessions`: elenco delle sessioni del progetto nella barra laterale;
 * - `resume`: ripresa diretta della sessione indicata;
 * - `branches`: pannello «Rami» della sessione aperta (albero di `get_tree`);
 * - `fork`: copia della sessione intera in una nuova sessione (`fork` di omp).
 */
export type SessionSlashAction =
	| { kind: 'sessions' }
	| { kind: 'resume'; sessionId: string }
	| { kind: 'branches' }
	| { kind: 'fork' };

/**
 * `/resume` e `/sessions` restano l'elenco delle sessioni; `/tree` non ne e'
 * piu' un alias e apre l'albero dei rami, come il `/tree` di omp. `null` per
 * ogni altro comando: la pagina prosegue con la sua catena.
 */
export function routeSessionSlash(raw: string): SessionSlashAction | null {
	const { lower, argument } = parseSlash(raw);
	switch (lower) {
		case '/resume':
			return argument ? { kind: 'resume', sessionId: argument } : { kind: 'sessions' };
		case '/sessions':
			return { kind: 'sessions' };
		case '/tree':
			return { kind: 'branches' };
		case '/fork':
			return { kind: 'fork' };
		default:
			return null;
	}
}
