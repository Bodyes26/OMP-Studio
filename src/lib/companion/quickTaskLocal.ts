/**
 * quickTaskLocal.ts - Parser puramente locale e sincrono per i comandi rapidi del Companion.
 *
 * Questo modulo NON effettua chiamate di rete, non importa Tauri, non usa rune Svelte
 * ed e' compatibile con ambienti Node senza bundle (es. node --experimental-strip-types).
 *
 * Scopo architetturale:
 * Evitare l'avvio di processi esterni (come il CLI `omp`) mentre l'utente digita.
 * L'interpretazione dei token (@progetto, !ruolo, /direttiva) e' istantanea.
 * L'intervento dell'AI (parse_quick_task_ai) e' riservato solo alla fase di salvataggio
 * e solo quando il progetto non puo' essere determinato localmente in modo univoco (needsAi === true).
 */

export interface LocalProjectRef {
	id: string;
	name: string;
	label?: string;
	path?: string;
}

export interface LocalDirectiveRef {
	id: string;
	name: string;
	tag?: string;
	hidden?: boolean;
}

export interface LocalQuickTask {
	projectId: string | null;
	projectName: string | null;
	projectPath: string | null;
	role: string | null; // uno tra 'smol' | 'default' | 'slow' | 'plan'
	modelSelector: string | null;
	directiveIds: string[];
	taskPrompt: string; // testo ripulito dai token riconosciuti (@, !, /)
	needsAi: boolean; // true se il progetto non e' determinabile localmente con percorso valido
}

export interface LocalParseInput {
	projects: LocalProjectRef[];
	directives: LocalDirectiveRef[];
	roles: string[];
}

export type MentionKind = 'project' | 'directive' | null;

export interface MentionState {
	kind: MentionKind;
	query: string;
	start: number;
	end: number;
}

/**
 * Normalizza una stringa eliminando maiuscole, spazi, trattini e underscore.
 *
 * PERCHE':
 * L'utente spesso digita token compatti come `@cruscottopsr` o `@portalinocdb`
 * a fronte di nomi progetto registrati come "Cruscotto PSR" o "portalino_cdb".
 * Rimuovendo i separatori e uniformando a minuscolo, il confronto risulta
 * tollerante e naturale senza richiedere digitazione mnemonica esatta.
 */
function normalizeTokenKey(value: string): string {
	return value.toLowerCase().replace(/[\s\-_]+/g, '');
}

/**
 * Esegue l'escape di caratteri speciali per l'inclusione sicura in espressioni regolari.
 */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rappresenta un intervallo [start, end] di un token nel testo sorgente
 * identificato e consumato durante il parsing, da espungere dal prompt finale.
 */
interface ConsumedSpan {
	start: number;
	end: number;
}

/**
 * Analizza il testo del Quick Task in modo puramente deterministico e locale.
 */
export function parseQuickTaskLocal(text: string, input: LocalParseInput): LocalQuickTask {
	const rawText = text ?? '';
	const spansToRemove: ConsumedSpan[] = [];

	// --------------------------------------------------------------------------
	// 1. Estrazione e matching delle direttive (/tag)
	// --------------------------------------------------------------------------
	// Ammettiamo token che iniziano con '/' preceduti da inizio riga o spazio
	const directiveRegex = /(?:^|\s)(\/([\w.\-]+))/g;
	const matchedDirectiveIds: string[] = [];
	const seenDirectiveIds = new Set<string>();

	// Filtriamo preventivamente le direttive nascoste (hidden)
	const activeDirectives = (input.directives ?? []).filter((d) => !d.hidden);

	let dirMatch: RegExpExecArray | null;
	while ((dirMatch = directiveRegex.exec(rawText)) !== null) {
		const fullToken = dirMatch[1]; // es. "/piano"
		const tokenValue = dirMatch[2]; // es. "piano"
		const tokenStart = dirMatch.index + dirMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;
		const normToken = normalizeTokenKey(tokenValue);

		// Priorita' 1: match esatto sul tag dichiarato
		let matchedDirective = activeDirectives.find((d) => {
			if (!d.tag) return false;
			const cleanTag = d.tag.startsWith('/') ? d.tag.slice(1) : d.tag;
			return normalizeTokenKey(cleanTag) === normToken;
		});

		// Priorita' 2: match sul name normalizzato
		if (!matchedDirective) {
			matchedDirective = activeDirectives.find((d) => normalizeTokenKey(d.name) === normToken);
		}

		if (matchedDirective) {
			if (!seenDirectiveIds.has(matchedDirective.id)) {
				seenDirectiveIds.add(matchedDirective.id);
				matchedDirectiveIds.push(matchedDirective.id);
			}
			spansToRemove.push({ start: tokenStart, end: tokenEnd });
		}
	}

	// --------------------------------------------------------------------------
	// 2. Estrazione e matching del ruolo (!ruolo)
	// --------------------------------------------------------------------------
	const roleRegex = /(?:^|\s)(!([\w.\-]+))/g;
	let parsedRole: string | null = null;
	const availableRoles = input.roles ?? [];

	let roleMatch: RegExpExecArray | null;
	while ((roleMatch = roleRegex.exec(rawText)) !== null) {
		const fullToken = roleMatch[1]; // es. "!smol"
		const tokenValue = roleMatch[2]; // es. "smol"
		const tokenStart = roleMatch.index + roleMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;

		const matchingRole = availableRoles.find(
			(r) => r.toLowerCase() === tokenValue.toLowerCase()
		);

		if (matchingRole) {
			// Ruolo riconosciuto: memorizziamo il ruolo canonico e rimuoviamo il token
			parsedRole = matchingRole.toLowerCase();
			spansToRemove.push({ start: tokenStart, end: tokenEnd });
		}
		// Se il ruolo non e' riconosciuto, NON aggiungiamo lo span: il token
		// restera' nel testo del prompt come specificato nei requisiti.
	}

	// --------------------------------------------------------------------------
	// 3. Estrazione e matching del progetto (@progetto o riconoscimento prudente)
	// --------------------------------------------------------------------------
	const projectTokenRegex = /(?:^|\s)(@([\w.\-]+))/g;
	const projectTokens: Array<{
		fullToken: string;
		tokenValue: string;
		start: number;
		end: number;
	}> = [];

	let projMatch: RegExpExecArray | null;
	while ((projMatch = projectTokenRegex.exec(rawText)) !== null) {
		const fullToken = projMatch[1];
		const tokenValue = projMatch[2];
		const tokenStart = projMatch.index + projMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;
		projectTokens.push({ fullToken, tokenValue, start: tokenStart, end: tokenEnd });
	}

	const projects = input.projects ?? [];
	let resolvedProject: LocalProjectRef | null = null;
	let projectResolutionFailed = false;

	if (projectTokens.length > 0) {
		// Abbiamo uno o piu' token espliciti con '@'
		for (const pt of projectTokens) {
			const normToken = normalizeTokenKey(pt.tokenValue);
			if (!normToken) continue;

			// Risoluzione a cascata per livello di priorita':
			// 1. Uguaglianza esatta su label o name
			// 2. Prefisso su label o name
			// 3. Sottostringa su label o name
			const exactMatches: LocalProjectRef[] = [];
			const prefixMatches: LocalProjectRef[] = [];
			const substringMatches: LocalProjectRef[] = [];

			for (const p of projects) {
				const normName = normalizeTokenKey(p.name);
				const normLabel = p.label ? normalizeTokenKey(p.label) : '';

				if (normName === normToken || normLabel === normToken) {
					exactMatches.push(p);
				} else if (normName.startsWith(normToken) || (normLabel && normLabel.startsWith(normToken))) {
					prefixMatches.push(p);
				} else if (normName.includes(normToken) || (normLabel && normLabel.includes(normToken))) {
					substringMatches.push(p);
				}
			}

			let candidates: LocalProjectRef[] = [];
			if (exactMatches.length > 0) {
				candidates = exactMatches;
			} else if (prefixMatches.length > 0) {
				candidates = prefixMatches;
			} else if (substringMatches.length > 0) {
				candidates = substringMatches;
			}

			if (candidates.length === 1) {
				// Match univoco trovato per questo token
				if (!resolvedProject) {
					resolvedProject = candidates[0];
					spansToRemove.push({ start: pt.start, end: pt.end });
				} else if (resolvedProject.id === candidates[0].id) {
					// Token ripetuto o coincidente, rimuoviamo anch'esso
					spansToRemove.push({ start: pt.start, end: pt.end });
				} else {
					// Piu' token che puntano a progetti differenti: conflitto/ambiguita'
					projectResolutionFailed = true;
				}
			} else {
				// Zero match o match multiplo ambiguo allo stesso livello
				projectResolutionFailed = true;
			}
		}

		if (projectResolutionFailed) {
			resolvedProject = null;
		}
	} else {
		// Nessun token con '@': tentiamo un riconoscimento prudente su parola intera.
		// Solo se esattamente UN SOLO progetto noto compare nel testo, lo adottiamo;
		// altrimenti lasciamo che intervenga l'AI (needsAi = true).
		const matchedByWholeWord: LocalProjectRef[] = [];

		for (const p of projects) {
			const candidateNames: string[] = [];
			if (p.name && p.name.trim().length > 1) candidateNames.push(p.name.trim());
			if (p.label && p.label.trim().length > 1) candidateNames.push(p.label.trim());

			for (const nameCandidate of candidateNames) {
				// Confronto su parola intera con boundary non-alfanumerico
				const wordRegex = new RegExp(`(?:^|[^\\w])${escapeRegex(nameCandidate)}(?:$|[^\\w])`, 'i');
				if (wordRegex.test(rawText)) {
					if (!matchedByWholeWord.some((m) => m.id === p.id)) {
						matchedByWholeWord.push(p);
					}
					break;
				}
			}
		}

		if (matchedByWholeWord.length === 1) {
			resolvedProject = matchedByWholeWord[0];
		}
	}

	// Se il progetto e' stato identificato ma e' privo di percorso valido, non e' utilizzabile
	const hasValidPath = Boolean(resolvedProject?.path && resolvedProject.path.trim().length > 0);
	const finalProject = hasValidPath ? resolvedProject : null;

	// --------------------------------------------------------------------------
	// 4. Pulizia del taskPrompt rimuovendo solo gli span riconosciuti
	// --------------------------------------------------------------------------
	// Ordiniamo gli intervalli dal fondo per preservare gli indici
	const sortedSpans = [...spansToRemove].sort((a, b) => b.start - a.start);

	// Filtriamo eventuali overlap difensivi
	const nonOverlappingSpans: ConsumedSpan[] = [];
	let lastStart = Infinity;
	for (const span of sortedSpans) {
		if (span.end <= lastStart) {
			nonOverlappingSpans.push(span);
			lastStart = span.start;
		}
	}

	let cleanedText = rawText;
	for (const span of nonOverlappingSpans) {
		cleanedText = cleanedText.slice(0, span.start) + ' ' + cleanedText.slice(span.end);
	}

	// Collassiamo gli spazi bianchi e rimuoviamo i bordi
	const taskPrompt = cleanedText.replace(/\s+/g, ' ').trim();

	return {
		projectId: finalProject?.id ?? null,
		projectName: finalProject?.name ?? null,
		projectPath: finalProject?.path ?? null,
		role: parsedRole,
		modelSelector: null,
		directiveIds: matchedDirectiveIds,
		taskPrompt,
		needsAi: !hasValidPath
	};
}

/**
 * Esamina il testo fino alla posizione del cursore per determinare
 * se l'utente sta digitando una menzione (@ per progetti, / per direttive).
 */
export function mentionStateAt(text: string, caret: number): MentionState {
	const safeText = text ?? '';
	const safeCaret = Math.max(0, Math.min(caret ?? 0, safeText.length));
	const textBeforeCaret = safeText.slice(0, safeCaret);

	// Riconoscimento menzione progetto: /(^|\s)@([\w.\-]*)$/
	const projectMatch = /(^|\s)@([\w.\-]*)$/.exec(textBeforeCaret);
	if (projectMatch) {
		const query = projectMatch[2];
		const start = textBeforeCaret.length - (query.length + 1); // Indice esatto del carattere '@'
		return {
			kind: 'project',
			query,
			start,
			end: safeCaret
		};
	}

	// Riconoscimento menzione direttiva: /(^|\s)\/([\w.\-]*)$/
	const directiveMatch = /(^|\s)\/([\w.\-]*)$/.exec(textBeforeCaret);
	if (directiveMatch) {
		const query = directiveMatch[2];
		const start = textBeforeCaret.length - (query.length + 1); // Indice esatto del carattere '/'
		return {
			kind: 'directive',
			query,
			start,
			end: safeCaret
		};
	}

	return {
		kind: null,
		query: '',
		start: safeCaret,
		end: safeCaret
	};
}

/**
 * Applica la menzione selezionata sostituendo il frammento parziale digitato
 * con il valore completo, seguito da uno spazio per consentire la continuazione immediata della digitazione.
 */
export function applyMention(
	text: string,
	state: MentionState,
	value: string
): { text: string; caret: number } {
	if (state.kind === null) {
		return { text, caret: state.start };
	}

	const safeText = text ?? '';
	const prefix = state.kind === 'project' ? '@' : '/';
	const replacement = `${prefix}${value} `;

	const before = safeText.slice(0, state.start);
	const after = safeText.slice(state.end);

	const newText = `${before}${replacement}${after}`;
	const newCaret = state.start + replacement.length;

	return {
		text: newText,
		caret: newCaret
	};
}
