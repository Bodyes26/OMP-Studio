// Modalita' Piano della chat GUI: parte pura (niente rune, niente Tauri), cosi'
// parser, composizione del piano, decisione e ordine del passaggio sono coperti
// da test senza montare la pagina.
//
// Il trasporto e' l'estensione `extensions/studio-plan.ts`: la revisione arriva
// come `extension_ui_request` di tipo `editor` con il titolo che inizia con
// `studio-plan-review:` (meta JSON) e il piano come testo precompilato; la
// risposta e' la decisione JSON. Testi dei prompt di esecuzione adattati da
// oh-my-pi 18.8.4 (MIT): prompts/system/plan-mode-approved.md e
// plan-mode-compact-instructions.md.

export const PLAN_REVIEW_TITLE_PREFIX = 'studio-plan-review:';
export const PLAN_STATUS_KEY = 'studio-plan';
/** Comando dell'estensione: nel Terminale resta il `/plan` nativo. */
export const PLAN_EXTENSION_COMMAND = '/studio-plan';

/* ------------------------------------------------------------------ strade */

/** Strade di esecuzione nell'ordine dei tasti 1–4. La prima e' la predefinita. */
export type PlanExecMode = 'fresh' | 'lane' | 'compact' | 'keep';
export const PLAN_EXEC_MODES: readonly PlanExecMode[] = ['fresh', 'lane', 'compact', 'keep'];
export const DEFAULT_PLAN_EXEC_MODE: PlanExecMode = 'fresh';

/** Ruoli proposti per l'esecuzione, come lo slider della revisione di omp. */
export const PLAN_EXEC_ROLES: readonly string[] = ['smol', 'default', 'slow', 'task'];
export const DEFAULT_PLAN_EXEC_ROLE = 'default';

/** Ruoli mostrati: quelli configurati, `default` sempre presente. */
export function availableExecRoles(roles: Record<string, string | undefined>): string[] {
	return PLAN_EXEC_ROLES.filter((role) => role === 'default' || Boolean(roles[role]?.trim()));
}

/** Tasto 1–4 → strada; `null` per ogni altro tasto. */
export function execModeForKey(key: string): PlanExecMode | null {
	const index = Number.parseInt(key, 10);
	if (!Number.isInteger(index) || String(index) !== key) return null;
	return PLAN_EXEC_MODES[index - 1] ?? null;
}

/* ------------------------------------------------------ richiesta di revisione */

export interface PlanReviewRequest {
	slug: string;
	title: string;
	/** `local://<slug>-plan.md`. */
	planFilePath: string;
	/** Percorso assoluto su disco del file del piano (radice di `local://`). */
	localPath: string | null;
	content: string;
}

/** `null` se la richiesta non e' una revisione del Piano di Studio. */
export function parsePlanReviewRequest(title: unknown, prefill: unknown): PlanReviewRequest | null {
	if (typeof title !== 'string' || !title.startsWith(PLAN_REVIEW_TITLE_PREFIX)) return null;
	let meta: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(title.slice(PLAN_REVIEW_TITLE_PREFIX.length));
		if (!parsed || typeof parsed !== 'object') return null;
		meta = parsed as Record<string, unknown>;
	} catch {
		return null;
	}
	const slug = typeof meta.slug === 'string' ? meta.slug : '';
	const planFilePath = typeof meta.planFilePath === 'string' ? meta.planFilePath : slug ? `local://${slug}-plan.md` : '';
	if (!planFilePath) return null;
	return {
		slug,
		title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : slug || planFilePath,
		planFilePath,
		localPath: typeof meta.localPath === 'string' ? meta.localPath : null,
		content: typeof prefill === 'string' ? prefill : ''
	};
}

/** Stato pubblicato dall'estensione con `setStatus('studio-plan', json)`. */
export interface PlanStatus {
	enabled: boolean;
	planFilePath: string | null;
	title: string | null;
}

export function parsePlanStatus(raw: unknown): PlanStatus | null {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<PlanStatus>;
		return {
			enabled: parsed.enabled === true,
			planFilePath: typeof parsed.planFilePath === 'string' ? parsed.planFilePath : null,
			title: typeof parsed.title === 'string' ? parsed.title : null
		};
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ sezioni */

export interface PlanSection {
	/** Stabile entro un piano: `s<indice>-<slug del titolo>`. */
	id: string;
	heading: string;
	/** Livello del titolo (`##` = 2). */
	level: number;
	/** Testo sotto il titolo, senza la riga del titolo. */
	body: string;
}

export interface PlanDocument {
	/** Testo prima della prima sezione (di solito il `# Titolo`). */
	preamble: string;
	sections: PlanSection[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function headingSlug(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'sezione'
	);
}

/**
 * Divide il piano in sezioni al livello di titolo piu' alto che compare almeno
 * due volte (di solito `##`; un piano con un solo `#` e tanti `##` si divide
 * sui `##`). I blocchi di codice non contano: un `#` dentro ``` non e' un titolo.
 */
export function splitPlanSections(markdown: string): PlanDocument {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const headings: { line: number; level: number; text: string }[] = [];
	let inFence = false;
	lines.forEach((line, index) => {
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			return;
		}
		if (inFence) return;
		const match = HEADING_RE.exec(line);
		if (match) headings.push({ line: index, level: match[1].length, text: match[2] });
	});
	const counts = new Map<number, number>();
	for (const heading of headings) counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1);
	const levels = [...counts.keys()].sort((a, b) => a - b);
	const splitLevel = levels.find((level) => (counts.get(level) ?? 0) >= 2) ?? levels[levels.length - 1];
	const cuts = splitLevel === undefined ? [] : headings.filter((heading) => heading.level === splitLevel);
	if (cuts.length === 0) return { preamble: markdown, sections: [] };

	const preamble = lines.slice(0, cuts[0].line).join('\n');
	const sections: PlanSection[] = cuts.map((cut, index) => {
		const end = index + 1 < cuts.length ? cuts[index + 1].line : lines.length;
		const body = lines
			.slice(cut.line + 1, end)
			.join('\n')
			.replace(/^\n+|\n+$/g, '');
		return { id: `s${index}-${headingSlug(cut.text)}`, heading: cut.text, level: cut.level, body };
	});
	return { preamble, sections };
}

/** Titolo `# ...` del preambolo, se c'e'. */
export function planHeadingTitle(doc: PlanDocument): string | null {
	for (const line of doc.preamble.split('\n')) {
		const match = /^#\s+(.+?)\s*$/.exec(line);
		if (match) return match[1];
	}
	return null;
}

export interface PlanEdits {
	deleted: ReadonlySet<string>;
	/** Corpo riscritto per sezione. */
	bodies: Readonly<Record<string, string>>;
}

/** Piano dopo le modifiche della revisione, nello stesso formato markdown. */
export function composePlan(doc: PlanDocument, edits: PlanEdits): string {
	const parts: string[] = [];
	const preamble = doc.preamble.replace(/\n+$/g, '');
	if (preamble.trim()) parts.push(preamble);
	for (const section of doc.sections) {
		if (edits.deleted.has(section.id)) continue;
		const body = (edits.bodies[section.id] ?? section.body).replace(/^\n+|\n+$/g, '');
		parts.push(`${'#'.repeat(section.level)} ${section.heading}${body ? `\n\n${body}` : ''}`);
	}
	return `${parts.join('\n\n')}\n`;
}

export function planWasEdited(edits: PlanEdits, doc: PlanDocument): boolean {
	if (edits.deleted.size > 0) return true;
	return doc.sections.some((section) => {
		const body = edits.bodies[section.id];
		return body !== undefined && body.trim() !== section.body.trim();
	});
}

export function countComments(comments: Readonly<Record<string, readonly string[]>>): number {
	return Object.values(comments).reduce((total, list) => total + list.length, 0);
}

export interface RefineLabels {
	/** Riga d'apertura ("Modifica il piano:"). */
	intro: string;
	/** Nota per una sezione eliminata ("sezione eliminata"). */
	deleted: string;
}

/** Commenti → testo per l'agente: una riga per commento, con la sezione. */
export function buildRefineFeedback(
	doc: PlanDocument,
	comments: Readonly<Record<string, readonly string[]>>,
	deleted: ReadonlySet<string>,
	labels: RefineLabels
): string {
	const lines: string[] = [];
	for (const section of doc.sections) {
		for (const comment of comments[section.id] ?? []) {
			const trimmed = comment.trim();
			if (trimmed) lines.push(`· ${section.heading}: ${trimmed}`);
		}
		if (deleted.has(section.id)) lines.push(`· ${section.heading}: ${labels.deleted}`);
	}
	return lines.length > 0 ? `${labels.intro}\n${lines.join('\n')}` : '';
}

/* ---------------------------------------------------------------- decisione */

export interface PlanDecision {
	action: 'approve' | 'refine' | 'save' | 'cancel';
	mode?: PlanExecMode;
	role?: string;
	autosave?: boolean;
	feedback?: string;
	/** Solo se la revisione ha cambiato il piano: l'estensione lo riscrive su disco. */
	content?: string;
}

export function encodePlanDecision(decision: PlanDecision): string {
	const out: PlanDecision = { action: decision.action };
	if (decision.mode) out.mode = decision.mode;
	if (decision.role) out.role = decision.role;
	if (decision.autosave !== undefined) out.autosave = decision.autosave;
	if (decision.feedback) out.feedback = decision.feedback;
	if (decision.content !== undefined) out.content = decision.content;
	return JSON.stringify(out);
}

/* ---------------------------------------------------------------- passaggio */

export type PlanHandoffStepId =
	| 'save'
	| 'exit'
	| 'new-session'
	| 'compact'
	| 'create-lane'
	| 'start-lane'
	| 'role'
	| 'deliver';

/**
 * Passi del passaggio nell'ordine in cui Studio li esegue (la card «Da → A» li
 * mostra cosi'). La copia in `.omp/plans/` la fa l'estensione all'approvazione,
 * prima che Studio cambi sessione: `local://` e' per sessione e non segue.
 */
export function planHandoffSteps(mode: PlanExecMode, autosave: boolean): PlanHandoffStepId[] {
	const steps: PlanHandoffStepId[] = [];
	if (autosave) steps.push('save');
	steps.push('exit');
	if (mode === 'fresh') steps.push('new-session');
	if (mode === 'compact') steps.push('compact');
	if (mode === 'lane') steps.push('create-lane', 'start-lane');
	steps.push('role', 'deliver');
	return steps;
}

/** Nome della copia in `.omp/plans/`: stessa regola di `planSaveFileName` di omp. */
export function planSaveFileName(title: string): string {
	let stem = title
		.normalize('NFC')
		.replace(/[^\p{L}\p{N}]+/gu, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toUpperCase();
	if (stem.length > 32) {
		const cut = stem.lastIndexOf('_', 32);
		stem = cut > 0 ? stem.slice(0, cut) : stem.slice(0, 32);
	}
	if (!stem || stem === 'PLAN') return 'PLAN.md';
	return `${stem.endsWith('_PLAN') ? stem : `${stem}_PLAN`}.md`;
}

/**
 * Primo messaggio dell'esecuzione, adattato da `plan-mode-approved.md`: il piano
 * e' incollato per intero, il percorso serve ai subagenti e al recupero dopo una
 * compattazione. Con la strada `fresh`/`lane` il percorso utile e' la copia in
 * `.omp/plans/` (il `local://` della sessione di pianificazione non segue).
 */
export function buildApprovedPrompt(input: {
	planFilePath: string;
	planContent: string;
	contextPreserved: boolean;
}): string {
	const lines = ['Plan approved.'];
	if (input.contextPreserved) {
		lines.push('- History usable; the plan below authoritative if it conflicts with earlier exploration.');
	}
	lines.push(
		'',
		'<instruction>',
		`Full plan inlined below; durable copy at \`${input.planFilePath}\` (identical content).`,
		'Execute plan step-by-step with full tool access; MUST verify each step before next.',
		`NEVER re-read \`${input.planFilePath}\` while the inline plan is intact; the path is for subagent handoff and recovery only.`,
		'Before execution: initialize todo tracking with `todo`. After each completed step: immediately update `todo`.',
		'</instruction>',
		'',
		`<plan path="${input.planFilePath}">`,
		input.planContent.replace(/\n+$/g, ''),
		'</plan>',
		'',
		'<critical>',
		`Inline plan compressed, expired, or unrecoverable: NEVER stop; read \`${input.planFilePath}\`.`,
		'Read failure: report exact path and error; NEVER guess.',
		'MUST continue until complete.',
		'</critical>'
	);
	return lines.join('\n');
}

/** Istruzioni di compattazione per «compatta e continua» (`plan-mode-compact-instructions.md`). */
export function buildCompactInstructions(planFilePath: string): string {
	return [
		'Prepare to execute approved plan.',
		'',
		'MUST distill plan-mode discussion.',
		'Preserve:',
		'- Plan rationale; explicitly rejected alternatives.',
		'- Key decisions; driving constraints.',
		'- Discovered files, symbols, code paths executor needs.',
		'- User preferences expressed during planning.',
		'',
		'Drop:',
		'- Tool-call noise (file reads, searches) if result captured in plan or plan-mode discussion.',
		'- Superseded plan drafts.',
		'- Context restated in plan file.',
		'',
		`Approved plan file: \`${planFilePath}\`; authoritative source of truth. MUST preserve this durable path; the plan body is re-inlined for the executor after compaction, so NEVER restate it in the summary.`
	].join('\n');
}

/* -------------------------------------------------- voci client nel transcript */

/**
 * Le card del Piano sono voci del solo client: `get_messages_page` non le
 * conosce e una ricostruzione del transcript (compattazione, riattacco) le
 * perderebbe. Ognuna ricorda il `messageTs` dell'ultimo messaggio omp che la
 * precedeva; dopo la ricostruzione torna subito dopo quel messaggio, oppure in
 * cima se ne non aveva, oppure in fondo se il messaggio non c'e' piu'.
 */
export interface AnchoredEntry {
	anchorTs: number | null;
}

export function reanchorEntries<E extends object, C extends AnchoredEntry & E>(
	rebuilt: readonly E[],
	clientEntries: readonly C[]
): E[] {
	if (clientEntries.length === 0) return [...rebuilt];
	const tsOf = (entry: E | undefined): number | undefined => {
		const value = (entry as { messageTs?: unknown } | undefined)?.messageTs;
		return typeof value === 'number' ? value : undefined;
	};
	const out: E[] = [];
	const byAnchor = new Map<number | null, C[]>();
	for (const entry of clientEntries) {
		const list = byAnchor.get(entry.anchorTs) ?? [];
		list.push(entry);
		byAnchor.set(entry.anchorTs, list);
	}
	out.push(...(byAnchor.get(null) ?? []));
	byAnchor.delete(null);
	for (let index = 0; index < rebuilt.length; index++) {
		const entry = rebuilt[index];
		out.push(entry);
		const ts = tsOf(entry);
		if (ts === undefined) continue;
		// I pezzi di uno stesso messaggio condividono il ts: si attacca dopo l'ultimo.
		if (tsOf(rebuilt[index + 1]) === ts) continue;
		const attached = byAnchor.get(ts);
		if (attached) {
			out.push(...attached);
			byAnchor.delete(ts);
		}
	}
	for (const list of byAnchor.values()) out.push(...list);
	return out;
}

/* ----------------------------------------------------- vassoio in costruzione */

/** Le cinque sezioni del formato fisso del Piano (prompt di omp, adattato). */
export type ExpectedSectionId = 'context' | 'approach' | 'files' | 'verification' | 'assumptions';
const EXPECTED_SECTIONS: readonly { id: ExpectedSectionId; match: RegExp }[] = [
	{ id: 'context', match: /context|contesto/i },
	{ id: 'approach', match: /approach|approccio|steps|passi/i },
	{ id: 'files', match: /critical|file|anchor|ancore/i },
	{ id: 'verification', match: /verif|test/i },
	{ id: 'assumptions', match: /assum|ipotes|contingen/i }
];

export interface OutlineItem {
	/** Sezione attesa (etichetta tradotta dalla UI) o titolo scritto dall'agente. */
	expected: ExpectedSectionId | null;
	heading: string | null;
	state: 'done' | 'writing' | 'pending';
}

/** True se lo strumento scrive il file del piano (`local://<slug>-plan.md`). */
export function isPlanWriteTool(toolName: string, args: Record<string, unknown>): boolean {
	if (toolName !== 'write' && toolName !== 'edit') return false;
	const path = typeof args.path === 'string' ? args.path : '';
	if (/^\[?local:\/\/.+-plan\.md/i.test(path)) return true;
	return /local:\/\/[^\s"']+-plan\.md/i.test(JSON.stringify(args));
}

/** Titoli `##` presenti negli argomenti di una scrittura (contenuto o modifiche). */
export function headingsFromToolArgs(args: unknown): string[] {
	const found: string[] = [];
	const visit = (value: unknown) => {
		if (typeof value === 'string') {
			let inFence = false;
			for (const line of value.split(/\r?\n/)) {
				if (FENCE_RE.test(line)) inFence = !inFence;
				if (inFence) continue;
				// Il formato hashline antepone `+`/`N:` alle righe: si toglie.
				const match = /^(?:[+>]|\d+[:|]\s?)?\s*##\s+(.+?)\s*#*\s*$/.exec(line);
				if (match) found.push(match[1]);
			}
		} else if (Array.isArray(value)) {
			for (const item of value) visit(item);
		} else if (value && typeof value === 'object') {
			for (const item of Object.values(value)) visit(item);
		}
	};
	visit(args);
	return found;
}

/**
 * Contorno del vassoio: le cinque sezioni attese, segnate fatte quando un
 * titolo scritto le richiama, piu' i titoli extra in coda. `writing` e' il
 * titolo della scrittura in corso.
 */
export function buildPlanOutline(written: readonly string[], writing: readonly string[]): OutlineItem[] {
	const items: OutlineItem[] = EXPECTED_SECTIONS.map((section) => ({
		expected: section.id,
		heading: null,
		state: 'pending' as const
	}));
	const place = (heading: string, state: 'done' | 'writing') => {
		const index = EXPECTED_SECTIONS.findIndex((section) => section.match.test(heading));
		if (index >= 0) {
			const item = items[index];
			if (item.state !== 'done') items[index] = { ...item, heading, state };
			return;
		}
		const existing = items.find((item) => item.expected === null && item.heading === heading);
		if (existing) {
			if (existing.state !== 'done') existing.state = state;
			return;
		}
		items.push({ expected: null, heading, state });
	};
	for (const heading of written) place(heading, 'done');
	for (const heading of writing) place(heading, 'writing');
	return items;
}

/* ----------------------------------------------------- piano approvato in chat */

export interface ApprovedPlanMessage {
	planFilePath: string;
	content: string;
	title: string | null;
	sectionCount: number;
}

/**
 * Riconosce il primo messaggio dell'esecuzione (`buildApprovedPrompt`) per
 * disegnarlo come card «Piano approvato» invece di una bolla con tutto il piano.
 * Vale anche dopo una ricostruzione: legge il testo, non uno stato del client.
 */
export function parseApprovedPlanMessage(content: string): ApprovedPlanMessage | null {
	if (!/^Plan approved\.\s*\n/.test(content)) return null;
	const match = /<plan path="([^"]*)">\n([\s\S]*?)\n<\/plan>/.exec(content);
	if (!match) return null;
	const doc = splitPlanSections(match[2]);
	return {
		planFilePath: match[1],
		content: match[2],
		title: planHeadingTitle(doc),
		sectionCount: doc.sections.length
	};
}
