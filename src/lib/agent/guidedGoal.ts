// Obiettivo guidato (`/guided-goal`) nella chat GUI: intervista, bozza e
// controlli, senza rune ne' Tauri.
//
// L'intervista e' di Studio e funziona da sola: cinque domande fisse (criteri,
// verifica, tetto, confini, stop) con risposte proposte e risposta libera. Se
// l'estensione `studio-goal` e' caricata, l'agente puo' proporre domande e
// risposte calate sul progetto con un turno a margine (`runEphemeralTurn`, non
// entra nel contesto): arrivano come `GoalAgentSuggestions` e sostituiscono le
// proposte delle domande non ancora risposte. Senza estensione, o se il turno
// fallisce, il flusso resta identico con le proposte fisse.
//
// omp riceve solo il risultato: `goal create` con l'obiettivo in markdown a
// sezioni fisse (come il prompt `guided-goal-interview.md` di omp) e il
// `token_budget`. Il tetto di tentativi non e' un campo di omp: sta nel testo
// («Stop after N attempts») e Studio lo fa rispettare mettendo in pausa
// l'obiettivo quando i tentativi lo raggiungono.

import { m } from '$lib/paraglide/messages.js';

export type GoalFieldKey = 'criteria' | 'verification' | 'cap' | 'boundaries' | 'stop';

/** Ordine delle domande e dei campi della striscia in cima alla chat. */
export const GOAL_FIELDS: readonly GoalFieldKey[] = ['criteria', 'verification', 'cap', 'boundaries', 'stop'];

export interface GoalDraft {
	objective: string;
	criteria: string[];
	verification: string[];
	/** Tentativi al massimo (contati da Studio). `null` = tetto mancante. */
	attempts: number | null;
	/** Budget di token passato a omp come `token_budget`. `null` = tetto mancante. */
	tokenBudget: number | null;
	allowed: string[];
	forbidden: string[];
	stop: string[];
}

/** Valore che una risposta scrive nella bozza. */
export type GoalAnswerValue =
	| { field: 'criteria'; items: string[] }
	| { field: 'verification'; items: string[] }
	| { field: 'cap'; attempts: number | null; tokenBudget: number | null }
	| { field: 'boundaries'; allowed: string[]; forbidden: string[] }
	| { field: 'stop'; items: string[] };

export interface GoalOption {
	label: string;
	description?: string;
	recommended?: boolean;
	value: GoalAnswerValue;
}

export interface GoalQuestion {
	field: GoalFieldKey;
	question: string;
	options: GoalOption[];
	/** Domanda e proposte arrivate dall'agente (turno a margine). */
	fromAgent?: boolean;
}

/** Comandi del progetto letti dall'estensione (es. script di package.json). */
export interface GoalProjectHints {
	testCommand?: string;
	checkCommand?: string;
	lintCommand?: string;
}

/** Proposte dell'agente, gia' validate da `parseAgentSuggestions`. */
export interface GoalAgentSuggestions {
	objective?: string;
	questions: GoalQuestion[];
	hints?: GoalProjectHints;
}

export type GoalInterviewPhase = 'idea' | 'asking' | 'draft' | 'starting' | 'started' | 'cancelled';

export type GoalAgentStatus = 'off' | 'pending' | 'ready' | 'failed';

export interface GoalInterview {
	/** Identifica l'intervista: le risposte dell'agente in ritardo per un'altra vengono scartate. */
	id: string;
	idea: string;
	phase: GoalInterviewPhase;
	/** Indice in `GOAL_FIELDS` della domanda corrente (fase `asking`). */
	step: number;
	questions: GoalQuestion[];
	/** Testo mostrato nella striscia per ogni campo gia' risposto. */
	answers: Partial<Record<GoalFieldKey, string>>;
	skipped: GoalFieldKey[];
	draft: GoalDraft;
	agent: GoalAgentStatus;
}

// ---------------------------------------------------------------------------
// Criteri vaghi
// ---------------------------------------------------------------------------

const VAGUE_WORDS =
	/(pi[uù] (veloce|rapid|reattiv|pulit|semplic|robust|chiar|leggibil|stabil)|meglio|miglior|ottimizz|veloce|rapido|pulito|elegante|faster|quicker|better|cleaner|nicer|improve|optimi[sz]e|snappier|more robust|simpler|smoother)/i;
/** Parole che rendono un criterio verificabile anche senza numeri. */
const BINARY_WORDS =
	/(`|\bexit\b|\bpass(a|ano|es|ing)?\b|\bverd[ei]\b|\bgreen\b|\bnessun[oa]?\b|\bzero\b|\bno (error|warning)|\bsenza errori\b|\bcompila\b|\bcompiles?\b)/i;

/**
 * Un criterio e' vago quando promette un miglioramento senza dire come si
 * misura: «più veloce» senza soglia non da' un sì o un no.
 */
export function isVagueCriterion(text: string): boolean {
	const value = text.trim();
	if (!value) return false;
	if (!VAGUE_WORDS.test(value)) return false;
	if (/\d/.test(value)) return false;
	return !BINARY_WORDS.test(value);
}

// ---------------------------------------------------------------------------
// Proposte fisse (flusso deterministico)
// ---------------------------------------------------------------------------

function verificationCommand(hints: GoalProjectHints | undefined): string {
	return hints?.testCommand ?? m.guided_goal_opt_verif_tests_generic();
}

/** Domande e proposte usate quando l'agente non propone nulla. */
export function defaultGoalQuestions(hints?: GoalProjectHints): GoalQuestion[] {
	const test = verificationCommand(hints);
	const extra = hints?.checkCommand ?? hints?.lintCommand;
	return [
		{
			field: 'criteria',
			question: m.guided_goal_q_criteria(),
			options: [
				{
					label: m.guided_goal_opt_crit_tests(),
					description: m.guided_goal_opt_crit_tests_desc(),
					recommended: true,
					value: { field: 'criteria', items: [m.guided_goal_opt_crit_tests()] }
				},
				{
					label: m.guided_goal_opt_crit_exit(),
					description: m.guided_goal_opt_crit_exit_desc(),
					value: { field: 'criteria', items: [m.guided_goal_opt_crit_exit()] }
				},
				{
					label: m.guided_goal_opt_crit_clean(),
					description: m.guided_goal_opt_crit_clean_desc(),
					value: { field: 'criteria', items: [m.guided_goal_opt_crit_clean()] }
				}
			]
		},
		{
			field: 'verification',
			question: m.guided_goal_q_verification(),
			options: [
				{
					label: extra ? `${test} · ${extra}` : test,
					description: m.guided_goal_opt_verif_both_desc(),
					recommended: true,
					value: { field: 'verification', items: extra ? [test, extra] : [test] }
				},
				{
					label: m.guided_goal_opt_verif_build(),
					description: m.guided_goal_opt_verif_build_desc(),
					value: { field: 'verification', items: [m.guided_goal_opt_verif_build()] }
				},
				{
					label: m.guided_goal_opt_verif_manual(),
					description: m.guided_goal_opt_verif_manual_desc(),
					value: { field: 'verification', items: [m.guided_goal_opt_verif_manual()] }
				}
			]
		},
		{
			field: 'cap',
			question: m.guided_goal_q_cap(),
			options: [
				capOption(5, 400_000, m.guided_goal_opt_cap_balanced(), true),
				capOption(3, 200_000, m.guided_goal_opt_cap_careful()),
				capOption(10, 800_000, m.guided_goal_opt_cap_long())
			]
		},
		{
			field: 'boundaries',
			question: m.guided_goal_q_boundaries(),
			options: [
				{
					label: m.guided_goal_opt_bounds_related(),
					description: m.guided_goal_opt_bounds_related_desc(),
					recommended: true,
					value: {
						field: 'boundaries',
						allowed: [m.guided_goal_opt_bounds_related_allowed()],
						forbidden: [m.guided_goal_opt_bounds_no_deps()]
					}
				},
				{
					label: m.guided_goal_opt_bounds_repo(),
					description: m.guided_goal_opt_bounds_repo_desc(),
					value: {
						field: 'boundaries',
						allowed: [m.guided_goal_opt_bounds_repo_allowed()],
						forbidden: [m.guided_goal_opt_bounds_no_deps()]
					}
				},
				{
					label: m.guided_goal_opt_bounds_any(),
					description: m.guided_goal_opt_bounds_any_desc(),
					value: { field: 'boundaries', allowed: [m.guided_goal_opt_bounds_any()], forbidden: [] }
				}
			]
		},
		{
			field: 'stop',
			question: m.guided_goal_q_stop(),
			options: [
				{
					label: m.guided_goal_opt_stop_no_progress(),
					description: m.guided_goal_opt_stop_no_progress_desc(),
					recommended: true,
					value: { field: 'stop', items: [m.guided_goal_opt_stop_no_progress()] }
				},
				{
					label: m.guided_goal_opt_stop_budget(),
					description: m.guided_goal_opt_stop_budget_desc(),
					value: { field: 'stop', items: [m.guided_goal_opt_stop_budget()] }
				},
				{
					label: m.guided_goal_opt_stop_structural(),
					description: m.guided_goal_opt_stop_structural_desc(),
					value: { field: 'stop', items: [m.guided_goal_opt_stop_structural()] }
				}
			]
		}
	];
}

function capOption(attempts: number, tokenBudget: number, description: string, recommended = false): GoalOption {
	return {
		label: formatCap(attempts, tokenBudget),
		description,
		recommended,
		value: { field: 'cap', attempts, tokenBudget }
	};
}

/** «5 tentativi · 400k token» */
export function formatCap(attempts: number | null, tokenBudget: number | null): string {
	const parts: string[] = [];
	if (attempts !== null) parts.push(m.guided_goal_cap_attempts({ count: attempts }));
	if (tokenBudget !== null) parts.push(m.guided_goal_cap_tokens({ tokens: formatTokenCount(tokenBudget) }));
	return parts.join(' · ');
}

export function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000 && tokens % 100_000 === 0) return `${tokens / 1_000_000}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return String(tokens);
}

// ---------------------------------------------------------------------------
// Risposte libere
// ---------------------------------------------------------------------------

/** Una riga per voce: a capo, `;` o elenco puntato. */
export function splitItems(text: string): string[] {
	return text
		.split(/\r?\n|;/)
		.map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
		.filter(Boolean);
}

/** Numero con suffisso `k`/`M` (o migliaia scritte per esteso). */
function parseTokenAmount(raw: string, suffix: string | undefined): number | null {
	const value = Number(raw.replace(/[.\s'](?=\d{3}\b)/g, '').replace(',', '.'));
	if (!Number.isFinite(value) || value <= 0) return null;
	const unit = suffix?.toLowerCase();
	const scaled = unit === 'k' ? value * 1000 : unit === 'm' ? value * 1_000_000 : value;
	return Math.round(scaled);
}

/**
 * Tetto da testo libero: «5 tentativi, 300k token», «10 attempts / 1M tokens»,
 * «3 · 200k». Il primo numero senza unita' di token sono i tentativi.
 */
export function parseCap(text: string): { attempts: number | null; tokenBudget: number | null } {
	const value = text.toLowerCase();
	let tokenBudget: number | null = null;
	const tokenMatch =
		/(\d+(?:[.,]\d+)?|\d{1,3}(?:[.\s']\d{3})+)\s*(k|m)?\s*(?:token|tok\b)/i.exec(value) ??
		/(\d+(?:[.,]\d+)?)\s*(k|m)\b/i.exec(value);
	if (tokenMatch) tokenBudget = parseTokenAmount(tokenMatch[1], tokenMatch[2]);
	const rest = tokenMatch ? value.replace(tokenMatch[0], ' ') : value;
	const attemptsMatch =
		/(\d+)\s*(?:tentativ\w*|attempts?|tries|try|giri|round)/i.exec(rest) ?? /\b(\d{1,3})\b/.exec(rest);
	const attempts = attemptsMatch ? Number(attemptsMatch[1]) : null;
	return {
		attempts: attempts !== null && attempts > 0 && attempts <= 1000 ? attempts : null,
		tokenBudget
	};
}

const FORBIDDEN_LEAD =
	/^(?:no|non|niente|mai|vietat[oaie]|senza|evita(?:re)?|never|don'?t|do not|not|without|avoid|forbidden)\b[\s:]*/i;
const ALLOWED_LEAD = /^(?:solo|soltanto|only|just|consentit[oaie]|allowed)\b[\s:]*/i;

/** «Solo src/lib, niente nuove dipendenze» → consentito / vietato. */
export function parseBoundaries(text: string): { allowed: string[]; forbidden: string[] } {
	const allowed: string[] = [];
	const forbidden: string[] = [];
	const segments = text
		.split(/\r?\n|;|\.(?:\s|$)|,(?=\s*(?:no|non|niente|mai|senza|never|not|without|don'?t|do not|avoid)\b)/i)
		.map((segment) => segment.trim())
		.filter(Boolean);
	for (const segment of segments) {
		if (FORBIDDEN_LEAD.test(segment)) {
			const cleaned = segment.replace(FORBIDDEN_LEAD, '').trim();
			if (cleaned) forbidden.push(cleaned);
		} else {
			const cleaned = segment.replace(ALLOWED_LEAD, '').trim();
			if (cleaned) allowed.push(cleaned);
		}
	}
	return { allowed, forbidden };
}

/** Risposta libera → valore del campo. `null` quando non se ne ricava nulla. */
export function parseFreeAnswer(field: GoalFieldKey, text: string): GoalAnswerValue | null {
	const value = text.trim();
	if (!value) return null;
	switch (field) {
		case 'criteria':
		case 'verification':
		case 'stop': {
			const items = splitItems(value);
			return items.length ? { field, items } : null;
		}
		case 'cap': {
			const cap = parseCap(value);
			return { field: 'cap', attempts: cap.attempts, tokenBudget: cap.tokenBudget };
		}
		case 'boundaries': {
			const bounds = parseBoundaries(value);
			return bounds.allowed.length || bounds.forbidden.length ? { field: 'boundaries', ...bounds } : null;
		}
	}
}

// ---------------------------------------------------------------------------
// Bozza e intervista
// ---------------------------------------------------------------------------

export function emptyDraft(objective = ''): GoalDraft {
	return {
		objective: objective.trim(),
		criteria: [],
		verification: [],
		attempts: null,
		tokenBudget: null,
		allowed: [],
		forbidden: [],
		stop: []
	};
}

export function applyAnswer(draft: GoalDraft, value: GoalAnswerValue): GoalDraft {
	switch (value.field) {
		case 'criteria':
			return { ...draft, criteria: [...value.items] };
		case 'verification':
			return { ...draft, verification: [...value.items] };
		case 'cap':
			return { ...draft, attempts: value.attempts, tokenBudget: value.tokenBudget };
		case 'boundaries':
			return { ...draft, allowed: [...value.allowed], forbidden: [...value.forbidden] };
		case 'stop':
			return { ...draft, stop: [...value.items] };
	}
}

/** Testo breve della risposta, per la bolla nel transcript e la striscia. */
export function describeAnswer(value: GoalAnswerValue): string {
	switch (value.field) {
		case 'criteria':
		case 'verification':
		case 'stop':
			return value.items.join('; ');
		case 'cap':
			return formatCap(value.attempts, value.tokenBudget) || m.guided_goal_cap_missing();
		case 'boundaries': {
			const allowed = value.allowed.join(', ');
			const forbidden = value.forbidden.length
				? m.guided_goal_bounds_forbidden_inline({ items: value.forbidden.join(', ') })
				: '';
			return [allowed, forbidden].filter(Boolean).join(' · ');
		}
	}
}

export function startInterview(id: string, idea: string, hints?: GoalProjectHints): GoalInterview {
	const objective = idea.trim();
	return {
		id,
		idea: objective,
		phase: objective ? 'asking' : 'idea',
		step: 0,
		questions: defaultGoalQuestions(hints),
		answers: {},
		skipped: [],
		draft: emptyDraft(objective),
		agent: 'off'
	};
}

export function currentQuestion(interview: GoalInterview): GoalQuestion | null {
	if (interview.phase !== 'asking') return null;
	return interview.questions[interview.step] ?? null;
}

/** Idea data alla domanda iniziale (quando `/guided-goal` arriva senza testo). */
export function setIdea(interview: GoalInterview, idea: string): GoalInterview {
	const objective = idea.trim();
	if (!objective || interview.phase !== 'idea') return interview;
	return { ...interview, idea: objective, phase: 'asking', draft: { ...interview.draft, objective } };
}

function advance(interview: GoalInterview): GoalInterview {
	const step = interview.step + 1;
	return step >= GOAL_FIELDS.length ? { ...interview, step, phase: 'draft' } : { ...interview, step };
}

export function answerCurrent(interview: GoalInterview, value: GoalAnswerValue): GoalInterview {
	const question = currentQuestion(interview);
	if (!question || question.field !== value.field) return interview;
	return advance({
		...interview,
		draft: applyAnswer(interview.draft, value),
		answers: { ...interview.answers, [value.field]: describeAnswer(value) },
		skipped: interview.skipped.filter((field) => field !== value.field)
	});
}

export function skipCurrent(interview: GoalInterview): GoalInterview {
	const question = currentQuestion(interview);
	if (!question) return interview;
	return advance({ ...interview, skipped: [...new Set([...interview.skipped, question.field])] });
}

/**
 * Proposte dell'agente: valgono solo per le domande non ancora risposte, cosi'
 * un turno lento non cambia sotto gli occhi una scelta gia' fatta.
 */
export function mergeAgentSuggestions(interview: GoalInterview, suggestions: GoalAgentSuggestions): GoalInterview {
	if (interview.phase !== 'idea' && interview.phase !== 'asking') return { ...interview, agent: 'ready' };
	const byField = new Map(suggestions.questions.map((question) => [question.field, question]));
	const base = suggestions.hints ? defaultGoalQuestions(suggestions.hints) : interview.questions;
	const questions = interview.questions.map((question, index) => {
		const answered = interview.phase === 'asking' && index < interview.step;
		if (answered) return question;
		const fromAgent = byField.get(question.field);
		if (fromAgent && fromAgent.options.length) return { ...fromAgent, fromAgent: true };
		return base[index] ?? question;
	});
	// Una riformulazione misurabile dell'idea diventa l'obiettivo della bozza
	// (resta modificabile); l'idea originale resta nel transcript.
	const objective =
		suggestions.objective && interview.draft.objective === interview.idea ? suggestions.objective : interview.draft.objective;
	return { ...interview, questions, draft: { ...interview.draft, objective }, agent: 'ready' };
}

// ---------------------------------------------------------------------------
// Controlli prima dell'avvio
// ---------------------------------------------------------------------------

export interface GoalDraftIssue {
	field: GoalFieldKey | 'objective';
	message: string;
	/** Blocca «Avvia». I non bloccanti sono consigli. */
	blocking: boolean;
}

export function draftIssues(draft: GoalDraft): GoalDraftIssue[] {
	const issues: GoalDraftIssue[] = [];
	if (!draft.objective.trim()) {
		issues.push({ field: 'objective', message: m.guided_goal_issue_objective(), blocking: true });
	}
	const criteria = draft.criteria.map((item) => item.trim()).filter(Boolean);
	if (!criteria.length) {
		issues.push({ field: 'criteria', message: m.guided_goal_issue_criteria_missing(), blocking: true });
	}
	for (const criterion of criteria) {
		if (isVagueCriterion(criterion)) {
			issues.push({ field: 'criteria', message: m.guided_goal_issue_criteria_vague({ text: criterion }), blocking: true });
		}
	}
	if (!draft.verification.some((item) => item.trim())) {
		issues.push({ field: 'verification', message: m.guided_goal_issue_verification_missing(), blocking: true });
	}
	if (draft.attempts === null || draft.tokenBudget === null) {
		issues.push({ field: 'cap', message: m.guided_goal_issue_cap_missing(), blocking: true });
	}
	if (!draft.allowed.length && !draft.forbidden.length) {
		issues.push({ field: 'boundaries', message: m.guided_goal_issue_bounds_missing(), blocking: false });
	}
	if (!draft.stop.some((item) => item.trim())) {
		issues.push({ field: 'stop', message: m.guided_goal_issue_stop_missing(), blocking: false });
	}
	return issues;
}

export function canLaunch(draft: GoalDraft): boolean {
	return !draftIssues(draft).some((issue) => issue.blocking);
}

/** Stato di un campo nella striscia: fatto, saltato, con un problema, da fare. */
export type GoalFieldState = 'done' | 'current' | 'warn' | 'todo';

export function fieldStates(interview: GoalInterview): Record<GoalFieldKey, GoalFieldState> {
	const issues = draftIssues(interview.draft);
	const states = {} as Record<GoalFieldKey, GoalFieldState>;
	GOAL_FIELDS.forEach((field, index) => {
		const answered = interview.phase !== 'asking' && interview.phase !== 'idea' ? true : index < interview.step;
		const hasBlocking = issues.some((issue) => issue.field === field && issue.blocking);
		if (interview.phase === 'asking' && index === interview.step) states[field] = 'current';
		else if (answered && (hasBlocking || interview.skipped.includes(field))) states[field] = 'warn';
		else if (answered) states[field] = 'done';
		else states[field] = 'todo';
	});
	return states;
}

// ---------------------------------------------------------------------------
// Markdown dell'obiettivo (per `goal create`)
// ---------------------------------------------------------------------------

const clean = (items: readonly string[]) => items.map((item) => item.trim()).filter(Boolean);

/** Riga che porta il tetto di tentativi dentro l'obiettivo: omp non ha un campo. */
export function attemptCapLine(attempts: number): string {
	return `Stop after ${attempts} attempts and ask the user how to proceed.`;
}

/**
 * Sezioni fisse come nel prompt di intervista di omp: il modello in goal mode
 * le riconosce. Il contenuto resta nella lingua dell'utente.
 */
export function goalMarkdown(draft: GoalDraft): string {
	const lines: string[] = ['## Objective', draft.objective.trim(), '', '## Success criteria'];
	for (const item of clean(draft.criteria)) lines.push(`- ${item}`);
	lines.push('', '## Verification');
	for (const item of clean(draft.verification)) lines.push(`- ${item}`);
	const allowed = clean(draft.allowed);
	const forbidden = clean(draft.forbidden);
	if (allowed.length || forbidden.length) {
		lines.push('', '## Boundaries');
		if (allowed.length) lines.push(`- Allowed: ${allowed.join('; ')}`);
		if (forbidden.length) lines.push(`- Forbidden: ${forbidden.join('; ')}`);
	}
	lines.push('', '## Stop conditions');
	for (const item of clean(draft.stop)) lines.push(`- ${item}`);
	if (draft.attempts !== null) lines.push(`- ${attemptCapLine(draft.attempts)}`);
	return lines.join('\n');
}

/** Tetto di tentativi scritto nell'obiettivo (anche dopo un riavvio di Studio). */
export function parseAttemptCap(objective: string): number | null {
	const match = /Stop after (\d+) attempts/i.exec(objective);
	return match ? Number(match[1]) : null;
}

/** Titolo per il banner: la prima riga sotto `## Objective`, altrimenti la prima riga. */
export function goalTitle(objective: string): string {
	const lines = objective.split(/\r?\n/).map((line) => line.trim());
	const heading = lines.findIndex((line) => /^#{1,3}\s*objective\b/i.test(line));
	if (heading >= 0) {
		const next = lines.slice(heading + 1).find((line) => line && !line.startsWith('#'));
		if (next) return next;
	}
	return lines.find((line) => line && !line.startsWith('#')) ?? objective.trim();
}

/** Criteri di successo letti dall'obiettivo (per i dettagli del banner). */
export function goalSection(objective: string, heading: string): string[] {
	const lines = objective.split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^#{1,3}\\s*${heading}\\b`, 'i').test(line.trim()));
	if (start < 0) return [];
	const out: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^#{1,3}\s/.test(line.trim())) break;
		const item = line.replace(/^\s*[-*]\s+/, '').trim();
		if (item) out.push(item);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tentativi e tetto
// ---------------------------------------------------------------------------

/**
 * Dopo la fine di un tentativo: va messo in pausa quando il tetto e' raggiunto
 * e l'obiettivo e' ancora attivo (omp altrimenti continuerebbe).
 */
export function shouldPauseForCap(attemptsDone: number, cap: number | null, status: string | undefined): boolean {
	return cap !== null && cap > 0 && status === 'active' && attemptsDone >= cap;
}

// ---------------------------------------------------------------------------
// Estensione `studio-goal`: richiesta e risposta
// ---------------------------------------------------------------------------

/** Chiave di `setStatus` con cui l'estensione risponde a Studio. */
export const STUDIO_GOAL_STATUS_KEY = 'studio.goal';
/** Comando registrato dall'estensione: la sua presenza abilita le proposte dell'agente. */
export const STUDIO_GOAL_COMMAND = 'studio-goal';

export function suggestCommand(requestId: string, idea: string, locale: string): string {
	return `/${STUDIO_GOAL_COMMAND} suggest ${JSON.stringify({ requestId, idea, locale })}`;
}

export type StudioGoalStatus =
	| { type: 'suggestions'; requestId: string; suggestions: GoalAgentSuggestions }
	| { type: 'error'; requestId: string; message: string };

const FIELD_SET = new Set<string>(GOAL_FIELDS);

function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((s) => s.trim()).filter(Boolean);
	if (typeof value === 'string') return splitItems(value);
	return [];
}

function optionFromAgent(field: GoalFieldKey, raw: unknown): GoalOption | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	const label = typeof record.label === 'string' ? record.label.trim() : '';
	if (!label) return null;
	const description = typeof record.description === 'string' ? record.description.trim() || undefined : undefined;
	const recommended = record.recommended === true;
	let value: GoalAnswerValue | null = null;
	if (field === 'cap') {
		const attempts = typeof record.attempts === 'number' && record.attempts > 0 ? Math.round(record.attempts) : null;
		const tokenBudget =
			typeof record.tokenBudget === 'number' && record.tokenBudget > 0 ? Math.round(record.tokenBudget) : null;
		value = attempts !== null || tokenBudget !== null ? { field, attempts, tokenBudget } : parseFreeAnswer(field, label);
	} else if (field === 'boundaries') {
		const allowed = stringList(record.allowed);
		const forbidden = stringList(record.forbidden);
		value = allowed.length || forbidden.length ? { field, allowed, forbidden } : parseFreeAnswer(field, label);
	} else {
		const items = stringList(record.items);
		value = { field, items: items.length ? items : [label] };
	}
	return value ? { label, description, recommended, value } : null;
}

/** Valida le proposte dell'agente: tutto cio' che non torna si scarta. */
export function parseAgentSuggestions(raw: unknown): GoalAgentSuggestions | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	const questions: GoalQuestion[] = [];
	if (Array.isArray(record.questions)) {
		for (const entry of record.questions) {
			if (!entry || typeof entry !== 'object') continue;
			const q = entry as Record<string, unknown>;
			const field = typeof q.field === 'string' && FIELD_SET.has(q.field) ? (q.field as GoalFieldKey) : null;
			const question = typeof q.question === 'string' ? q.question.trim() : '';
			if (!field || !question || questions.some((existing) => existing.field === field)) continue;
			const options = (Array.isArray(q.options) ? q.options : [])
				.map((option) => optionFromAgent(field, option))
				.filter((option): option is GoalOption => option !== null)
				.slice(0, 4);
			if (options.length) questions.push({ field, question, options });
		}
	}
	let hints: GoalProjectHints | undefined;
	if (record.hints && typeof record.hints === 'object') {
		const h = record.hints as Record<string, unknown>;
		const pick = (key: string) => (typeof h[key] === 'string' && (h[key] as string).trim() ? (h[key] as string).trim() : undefined);
		const parsed: GoalProjectHints = { testCommand: pick('testCommand'), checkCommand: pick('checkCommand'), lintCommand: pick('lintCommand') };
		if (parsed.testCommand || parsed.checkCommand || parsed.lintCommand) hints = parsed;
	}
	const objective = typeof record.objective === 'string' && record.objective.trim() ? record.objective.trim() : undefined;
	if (!questions.length && !hints) return null;
	return { objective, questions, hints };
}

/** Testo di `setStatus("studio.goal", …)` → esito, `null` se non e' per noi. */
export function parseStudioGoalStatus(text: string | undefined): StudioGoalStatus | null {
	if (!text) return null;
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		return null;
	}
	if (!payload || typeof payload !== 'object') return null;
	const record = payload as Record<string, unknown>;
	const requestId = typeof record.requestId === 'string' ? record.requestId : '';
	if (!requestId) return null;
	if (record.type === 'error') {
		return { type: 'error', requestId, message: typeof record.message === 'string' ? record.message : '' };
	}
	if (record.type === 'suggestions') {
		const suggestions = parseAgentSuggestions(record.suggestions);
		return suggestions
			? { type: 'suggestions', requestId, suggestions }
			: { type: 'error', requestId, message: 'invalid suggestions' };
	}
	return null;
}
