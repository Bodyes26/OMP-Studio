/**
 * quickTaskLocal.ts - Parser puramente locale e sincrono per i comandi rapidi del Companion.
 *
 * Questo modulo NON effettua chiamate di rete, non importa Tauri, non usa rune Svelte
 * ed e' compatibile con ambienti Node senza bundle (es. node --experimental-strip-types).
 *
 * Scopo architetturale:
 * Evitare l'avvio di processi esterni (come il CLI `omp`) mentre l'utente digita.
 * L'interpretazione dei token (#progetto, !ruolo, /direttiva) e' istantanea.
 * L'intervento dell'AI (parse_quick_task_ai) e' riservato solo alla fase di salvataggio
 * e solo quando il progetto non puo' essere determinato localmente in modo univoco (needsAi === true).
 */

import { findFileMentions } from '../agent/fileMentionSyntax.ts';

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
	role: string | null;
	modelSelector: string | null;
	directiveIds: string[];
	taskPrompt: string; // testo ripulito dai token riconosciuti (#, !, /)
	needsAi: boolean; // true se il progetto non e' determinabile localmente con percorso valido
}

export interface LocalParseInput {
	projects: LocalProjectRef[];
	directives: LocalDirectiveRef[];
	roles: string[];
	modelSelectors?: string[];
}

export type MentionKind = 'project' | 'directive' | 'role' | null;

export interface MentionState {
	kind: MentionKind;
	query: string;
	start: number;
	end: number;
}
export interface DisplayToken {
	text: string;
	kind?: 'project' | 'directive' | 'role' | 'file';
	label?: string;
}


/**
 * Normalizza una stringa eliminando maiuscole, spazi, trattini e underscore.
 *
 * PERCHE':
 * L'utente spesso digita token compatti come `#cruscottopsr` o `#portalinocdb`
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
 * Numero massimo di parole che un token `#progetto` puo' abbracciare.
 * I nomi progetto reali arrivano a due o tre parole ("Studio OMP",
 * "Cruscotto PSR", "Gestione Storni Quote"); oltre si tratta di prosa.
 */
const MAX_PROJECT_TOKEN_WORDS = 6;

/**
 * Un token `#progetto` individuato nel testo, con lo span esatto che occupa.
 * `project === null` significa token presente ma non risolvibile in modo univoco.
 */
export interface ProjectTokenMatch {
	start: number;
	end: number;
	project: LocalProjectRef | null;
}

/**
 * Risoluzione a cascata di una chiave normalizzata sui progetti noti:
 * 1. uguaglianza esatta su name o label
 * 2. prefisso su name o label
 * 3. sottostringa su name o label
 * Restituisce i candidati del primo livello non vuoto: chi chiama decide se
 * un singolo candidato basta (match univoco) o se c'e' ambiguita'.
 */
function resolveProjectCandidates(
	normToken: string,
	projects: LocalProjectRef[]
): LocalProjectRef[] {
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

	if (exactMatches.length > 0) return exactMatches;
	if (prefixMatches.length > 0) return prefixMatches;
	return substringMatches;
}

/**
 * Individua i token `#progetto` e lo span di testo che ciascuno occupa.
 *
 * PERCHE' MULTI-PAROLA:
 * il suggeritore inserisce il nome esatto del progetto, spazi inclusi
 * (`#Studio OMP `). Fermarsi al primo spazio spezzerebbe il token: la pillola
 * coprirebbe solo "#Studio" e "OMP" resterebbe nel prompt come parola di prosa.
 * Si prova quindi la sequenza di parole piu' lunga e si accorcia finche' un
 * solo progetto resta in gara; le parole successive al nome ("perche' anche
 * se...") non concatenano mai chiavi che assomigliano a un progetto noto.
 */
export function findProjectTokens(rawText: string, projects: LocalProjectRef[]): ProjectTokenMatch[] {
	// La corsa parte da '#' e prosegue su parole separate da spazi orizzontali:
	// mai a capo, mai oltre punteggiatura (che chiude naturalmente il nome).
	const runRegex = /(?:^|\s)(#([\w.\-]+(?:[ \t]+[\w.\-]+)*))/g;
	const matches: ProjectTokenMatch[] = [];
	let runMatch: RegExpExecArray | null;

	while ((runMatch = runRegex.exec(rawText)) !== null) {
		const fullToken = runMatch[1];
		const at = runMatch.index + runMatch[0].indexOf(fullToken);
		const runStart = at + 1;
		const run = runMatch[2];

		// Offset assoluti di fine di ogni parola della corsa
		const wordEnds: number[] = [];
		const wordRegex = /[\w.\-]+/g;
		let wordMatch: RegExpExecArray | null;
		while ((wordMatch = wordRegex.exec(run)) !== null) {
			wordEnds.push(runStart + wordMatch.index + wordMatch[0].length);
		}
		if (wordEnds.length === 0) continue;

		let resolved: ProjectTokenMatch | null = null;
		for (let words = Math.min(wordEnds.length, MAX_PROJECT_TOKEN_WORDS); words >= 1; words--) {
			const end = wordEnds[words - 1];
			const normToken = normalizeTokenKey(rawText.slice(runStart, end));
			if (!normToken) continue;
			const candidates = resolveProjectCandidates(normToken, projects);
			if (candidates.length === 1) {
				resolved = { start: at, end, project: candidates[0] };
				break;
			}
		}

		// Nessuna risoluzione univoca: il token resta, ma senza progetto. Lo span
		// si limita alla prima parola, cosi' il resto della frase non viene inghiottito.
		matches.push(resolved ?? { start: at, end: wordEnds[0], project: null });
	}

	return matches;
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
	// 2. Estrazione e matching della configurazione (!ruolo o !provider/modello)
	// --------------------------------------------------------------------------
	const roleRegex = /(?:^|\s)(!([\w.\-/:]+))/g;
	let parsedRole: string | null = null;
	let parsedModelSelector: string | null = null;
	const availableRoles = input.roles ?? [];
	const availableModelSelectors = input.modelSelectors ?? [];

	let roleMatch: RegExpExecArray | null;
	while ((roleMatch = roleRegex.exec(rawText)) !== null) {
		const fullToken = roleMatch[1];
		const tokenValue = roleMatch[2];
		const tokenStart = roleMatch.index + roleMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;

		const matchingRole = availableRoles.find(
			(role) => role.toLowerCase() === tokenValue.toLowerCase()
		);
		const matchingModel = availableModelSelectors.find(
			(selector) => selector.toLowerCase() === tokenValue.toLowerCase()
		);

		if (matchingRole) {
			// Ogni `!` rappresenta una sola configurazione: vince l'ultimo token riconosciuto.
			parsedRole = matchingRole.toLowerCase();
			parsedModelSelector = null;
			spansToRemove.push({ start: tokenStart, end: tokenEnd });
		} else if (matchingModel) {
			parsedRole = null;
			parsedModelSelector = matchingModel;
			spansToRemove.push({ start: tokenStart, end: tokenEnd });
		}
		// Un token sconosciuto resta nel prompt: non nascondiamo possibili istruzioni.
	}

	// --------------------------------------------------------------------------
	// 3. Estrazione e matching del progetto (#progetto o riconoscimento prudente)
	// --------------------------------------------------------------------------
	const projects = input.projects ?? [];
	const projectTokens = findProjectTokens(rawText, projects);
	let resolvedProject: LocalProjectRef | null = null;
	let projectResolutionFailed = false;

	if (projectTokens.length > 0) {
		// Abbiamo uno o piu' token espliciti con '#'
		for (const pt of projectTokens) {
			if (!pt.project) {
				// Zero match o match multiplo ambiguo allo stesso livello
				projectResolutionFailed = true;
				continue;
			}
			if (!resolvedProject) {
				resolvedProject = pt.project;
				spansToRemove.push({ start: pt.start, end: pt.end });
			} else if (resolvedProject.id === pt.project.id) {
				// Token ripetuto o coincidente, rimuoviamo anch'esso
				spansToRemove.push({ start: pt.start, end: pt.end });
			} else {
				// Piu' token che puntano a progetti differenti: conflitto/ambiguita'
				projectResolutionFailed = true;
			}
		}

		if (projectResolutionFailed) {
			resolvedProject = null;
		}
	} else {
		// Nessun token con '#': tentiamo un riconoscimento prudente su parola intera.
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
		modelSelector: parsedModelSelector,
		directiveIds: matchedDirectiveIds,
		taskPrompt,
		needsAi: !hasValidPath
	};
}

/**
 * Esamina il testo fino alla posizione del cursore per determinare se l'utente
 * sta digitando una menzione (# progetto, / direttiva, ! ruolo o modello).
 */
export function mentionStateAt(text: string, caret: number): MentionState {
	const safeText = text ?? '';
	const safeCaret = Math.max(0, Math.min(caret ?? 0, safeText.length));
	const textBeforeCaret = safeText.slice(0, safeCaret);

	// Riconoscimento menzione progetto: /(^|\s)#([\w.\-]*)$/
	const projectMatch = /(^|\s)#([\w.\-]*)$/.exec(textBeforeCaret);
 	if (projectMatch) {
 		const query = projectMatch[2];
		const start = textBeforeCaret.length - (query.length + 1); // Indice esatto del carattere '#'
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

	const roleMatch = /(^|\s)!([\w.\-/:]*)$/.exec(textBeforeCaret);
	if (roleMatch) {
		const query = roleMatch[2];
		const start = textBeforeCaret.length - (query.length + 1);
		return {
			kind: 'role',
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
	const prefix = state.kind === 'project' ? '#' : state.kind === 'directive' ? '/' : '!';
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

/**
 * Suddivide il testo sorgente in segmenti consecutivi (DisplayToken) per il rendering
 * nel backdrop del composer.
 *
 * INVARIANTE FONDAMENTALE:
 * La concatenazione di `tokens.map(t => t.text).join('')` e' sempre rigorosamente identica
 * al testo sorgente (preservando spazi, a capo, tabulazioni e posizioni assolute dei caratteri).
 * Solo i token espliciti (#progetto, /direttiva, !ruolo o !modello, menzioni @file) riconosciuti con successo
 * vengono contrassegnati con il rispettivo `kind`, permettendo il rendering come pillola
 * senza alterare la larghezza complessiva o disallineare il caret della textarea.
 */
export function tokenizeForDisplay(text: string, input: LocalParseInput): DisplayToken[] {
	const rawText = text ?? '';
	if (!rawText) return [];

	interface RecognizedSpan {
		start: number;
		end: number;
		kind: 'project' | 'directive' | 'role' | 'file';
		label?: string;
	}

	const spans: RecognizedSpan[] = [];

	// 1. Direttive (/tag)
	const directiveRegex = /(?:^|\s)(\/([\w.\-]+))/g;
	const activeDirectives = (input.directives ?? []).filter((d) => !d.hidden);
	let dirMatch: RegExpExecArray | null;
	while ((dirMatch = directiveRegex.exec(rawText)) !== null) {
		const fullToken = dirMatch[1];
		const tokenValue = dirMatch[2];
		const tokenStart = dirMatch.index + dirMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;
		const normToken = normalizeTokenKey(tokenValue);

		let matched = activeDirectives.find((d) => {
			if (!d.tag) return false;
			const cleanTag = d.tag.startsWith('/') ? d.tag.slice(1) : d.tag;
			return normalizeTokenKey(cleanTag) === normToken;
		});
		if (!matched) {
			matched = activeDirectives.find((d) => normalizeTokenKey(d.name) === normToken);
		}

		if (matched) {
			spans.push({
				start: tokenStart,
				end: tokenEnd,
				kind: 'directive',
				label: matched.name
			});
		}
	}

	// 2. Ruoli e modelli (!ruolo o !modello)
	const roleRegex = /(?:^|\s)(!([\w.\-/:]+))/g;
	const availableRoles = input.roles ?? [];
	const availableModelSelectors = input.modelSelectors ?? [];
	let roleMatch: RegExpExecArray | null;
	while ((roleMatch = roleRegex.exec(rawText)) !== null) {
		const fullToken = roleMatch[1];
		const tokenValue = roleMatch[2];
		const tokenStart = roleMatch.index + roleMatch[0].indexOf(fullToken);
		const tokenEnd = tokenStart + fullToken.length;

		const matchingRole = availableRoles.find(
			(r) => r.toLowerCase() === tokenValue.toLowerCase()
		);
		const matchingModel = availableModelSelectors.find(
			(s) => s.toLowerCase() === tokenValue.toLowerCase()
		);

		if (matchingRole || matchingModel) {
			spans.push({
				start: tokenStart,
				end: tokenEnd,
				kind: 'role',
				label: matchingRole ?? matchingModel
			});
		}
	}

	// 3. Progetti (#progetto)
	// La stessa risoluzione del parser: la pillola copre esattamente lo span che
	// il salvataggio consumera', nomi con spazi inclusi.
	for (const pt of findProjectTokens(rawText, input.projects ?? [])) {
		if (!pt.project) continue;
		spans.push({
			start: pt.start,
			end: pt.end,
			kind: 'project',
			label: pt.project.name
		});
	}

	// 4. Menzioni file (@percorso o @"percorso con spazi")
	for (const fm of findFileMentions(rawText)) {
		spans.push({
			start: fm.start,
			end: fm.end,
			kind: 'file',
			label: fm.path
		});
	}

	// Ordiniamo gli span crescenti per indice di inizio
	spans.sort((a, b) => a.start - b.start || b.end - a.end);

	// Filtriamo eventuali overlap difensivi
	const nonOverlapping: RecognizedSpan[] = [];
	let lastEnd = 0;
	for (const span of spans) {
		if (span.start >= lastEnd) {
			nonOverlapping.push(span);
			lastEnd = span.end;
		}
	}

	// Ricostruiamo la sequenza continua di token
	const tokens: DisplayToken[] = [];
	let cursor = 0;

	for (const span of nonOverlapping) {
		if (span.start > cursor) {
			tokens.push({
				text: rawText.slice(cursor, span.start)
			});
		}
		tokens.push({
			text: rawText.slice(span.start, span.end),
			kind: span.kind,
			label: span.label
		});
		cursor = span.end;
	}

	if (cursor < rawText.length) {
		tokens.push({
			text: rawText.slice(cursor)
		});
	}

	return tokens;
}
