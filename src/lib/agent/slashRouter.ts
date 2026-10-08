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

/**
 * Modalita' Piano (Gate R3X-plan): `/plan [testo]` accende/spegne il Piano (con un
 * testo entra e lo manda), `/plan-review` riapre la revisione. Il `/plan` di omp
 * e' solo TUI: nella chat lo serve Studio con l'estensione `studio-plan`.
 */
export type PlanSlashAction = { kind: 'plan'; argument: string } | { kind: 'plan-review' };

export function routePlanSlash(raw: string): PlanSlashAction | null {
	const { lower, argument } = parseSlash(raw);
	if (lower === '/plan') return { kind: 'plan', argument };
	if (lower === '/plan-review') return { kind: 'plan-review' };
	return null;
}

/**
 * `/btw [domanda]`: domanda a margine nel riquadro sopra il composer. Senza
 * domanda apre il riquadro (con lo storico a portata, come il `/btw` della
 * TUI); con la domanda la manda subito. Studio la intercetta sempre: inoltrata
 * a omp come prompt arriverebbe al modello principale come testo normale,
 * perche' in RPC `/btw` e' solo un comando della TUI.
 */
export function routeBtwSlash(raw: string): { kind: 'btw'; question: string } | null {
	const { command, lower } = parseSlash(raw);
	if (lower !== '/btw') return null;
	// Il testo resta com'e' (a capo compresi): `parseSlash` lo ricompatta in una riga.
	return { kind: 'btw', question: raw.trim().slice(command.length).trim() };
}
