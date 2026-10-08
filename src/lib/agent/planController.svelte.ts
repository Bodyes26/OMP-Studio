// Modalita' Piano della chat GUI: stato reattivo e orchestrazione.
//
// Un controller per sessione (`session.plan`). La guardia, il prompt e la copia
// in `.omp/plans/` stanno nell'estensione `studio-plan.ts`; qui stanno la
// revisione (card del piano, scheda di approvazione) e il passaggio di compito,
// fatto con i comandi RPC che Studio usa gia': `new_session`, `compact`,
// `set_model`, `prompt`, e le corsie del `laneOrchestrator` per la strada worktree.

import { m as messages } from '$lib/paraglide/messages.js';
import { parseRoleSelector } from '$lib/stores/modelSettingsHelpers';
import type { AgentSession, PlanEntry, ToolEntry, UserEntry } from './session.svelte';
import type { ThinkingLevel } from './wire';
import {
	DEFAULT_PLAN_EXEC_MODE,
	DEFAULT_PLAN_EXEC_ROLE,
	PLAN_EXTENSION_COMMAND,
	buildApprovedPrompt,
	buildCompactInstructions,
	buildPlanOutline,
	buildRefineFeedback,
	composePlan,
	countComments,
	encodePlanDecision,
	headingsFromToolArgs,
	isPlanWriteTool,
	parsePlanStatus,
	planHandoffSteps,
	planSaveFileName,
	planWasEdited,
	splitPlanSections,
	type OutlineItem,
	type PlanDecision,
	type PlanDocument,
	type PlanExecMode,
	type PlanHandoffStepId,
	type PlanReviewRequest
} from './planMode';

/* ------------------------------------------------------------------- tipi */

export type PlanDocStatus = 'review' | 'refining' | 'approved' | 'saved' | 'closed';

export interface PlanDocState {
	id: string;
	request: PlanReviewRequest;
	doc: PlanDocument;
	comments: Record<string, string[]>;
	deleted: string[];
	bodies: Record<string, string>;
	status: PlanDocStatus;
}

export type PlanStepState = 'pending' | 'running' | 'done' | 'failed';

export interface PlanHandoffState {
	id: string;
	title: string;
	mode: PlanExecMode;
	role: string;
	fromModel: string;
	fromTokens: number | null;
	toTitle: string;
	toModel: string;
	steps: { id: PlanHandoffStepId; state: PlanStepState; detail: string }[];
	status: 'running' | 'done' | 'failed';
	error: string | null;
	/** Sessione di pianificazione, per «Torna alla sessione di pianificazione». */
	planningSessionId: string | null;
	savedPath: string | null;
}

/**
 * Ganci verso il guscio (+page.svelte): creare una corsia e riprendere una
 * sessione sono cose della pagina, non della sessione.
 */
export interface PlanHost {
	/** Crea una corsia worktree, la apre in GUI e restituisce la sua sessione pronta. */
	createLane?: (
		origin: AgentSession,
		options: { title: string }
	) => Promise<{ session: AgentSession; title: string; branch: string } | null>;
	/** Riapre una sessione della stessa corsia (sessione di pianificazione). */
	resumeSession?: (origin: AgentSession, sessionId: string) => void;
}

let host: PlanHost = {};

/** Ruoli configurati (impostazioni modelli): caricati alla prima richiesta. */
export interface PlanRoleSource {
	ensureLoaded(): Promise<void>;
	roles(): Record<string, string>;
	knownSelectors(): ReadonlySet<string> | undefined;
}

let roleSource: PlanRoleSource | null = null;

/** Per i test: una sorgente di ruoli senza lo store delle impostazioni (Tauri). */
export function setPlanRoleSource(source: PlanRoleSource | null): void {
	roleSource = source;
}

async function loadRoleSource(): Promise<PlanRoleSource | null> {
	if (roleSource) return roleSource;
	try {
		// Import differito: lo store delle impostazioni porta con se' Tauri e le icone.
		const { modelSettingsStore } = await import('$lib/stores/modelSettings.svelte');
		roleSource = {
			ensureLoaded: () => modelSettingsStore.ensureLoaded(),
			roles: () => modelSettingsStore.config?.modelRoles ?? modelSettingsStore.draftConfig?.modelRoles ?? {},
			knownSelectors: () => modelSettingsStore.knownSelectors
		};
	} catch {
		return null;
	}
	return roleSource;
}

/** Registrato da +page.svelte al montaggio; `{}` lo stacca. */
export function setPlanHost(next: PlanHost): void {
	host = next;
}

/**
 * Card condivise fra sessioni: la card del passaggio si vede sia nella sessione
 * di partenza sia in quella di arrivo (nuova sessione, corsia).
 */
export const planCards = $state<{ docs: Record<string, PlanDocState>; handoffs: Record<string, PlanHandoffState> }>({
	docs: {},
	handoffs: {}
});

let nextCardId = 1;
function cardId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${nextCardId++}`;
}

function modelLabel(session: AgentSession): string {
	return session.model?.name || session.model?.id || '';
}

/* ------------------------------------------------------------- controller */

export class PlanController {
	/** Modalita' Piano accesa (guardia dell'estensione attiva). */
	active = $state(false);
	/** `local://<slug>-plan.md` dell'ultimo piano proposto in questa sessione. */
	planFilePath = $state<string | null>(null);
	title = $state<string | null>(null);
	/** Richiesta `editor` di omp in attesa della decisione, con la sua card. */
	review = $state<{ requestId: string; docId: string; fromTurn: boolean } | null>(null);
	/** Passaggio in corso: la scheda di approvazione resta chiusa, il composer bloccato. */
	handingOff = $state(false);

	// Scelte della scheda di approvazione (restano fra un giro di revisione e l'altro).
	execMode = $state<PlanExecMode>(DEFAULT_PLAN_EXEC_MODE);
	execRole = $state(DEFAULT_PLAN_EXEC_ROLE);
	autosave = $state(true);
	laneTitle = $state('');

	/** Testi mandati in modalita' Piano: le bolle prendono il badge «Piano». */
	private planPrompts = $state<string[]>([]);
	/** Modello prima del Piano: torna all'uscita senza approvazione, come in omp. */
	private savedModel: { provider: string; modelId: string; thinking: ThinkingLevel | null } | null = null;
	private busy = false;

	private readonly session: AgentSession;

	constructor(session: AgentSession) {
		this.session = session;
	}

	/* -------------------------------------------------------- stato dal filo */

	/** `setStatus('studio-plan', json)` dell'estensione: fonte di verita' dopo un resume. */
	applyStatus(raw: unknown): void {
		const status = parsePlanStatus(raw);
		if (!status) return;
		this.active = status.enabled;
		this.planFilePath = status.planFilePath;
		this.title = status.title;
	}

	/** La sessione e' cambiata (nuova, ripresa): le card del client vanno via con lei. */
	onSessionReset(): void {
		if (this.review) {
			const doc = planCards.docs[this.review.docId];
			if (doc && doc.status === 'review') doc.status = 'closed';
		}
		this.review = null;
	}

	/* ------------------------------------------------------------- vassoio */

	/**
	 * Contorno del piano mentre l'agente lo scrive: le scritture su
	 * `local://*-plan.md` dall'ultima entrata o dall'ultima card del piano.
	 */
	get outline(): OutlineItem[] {
		const entries = this.session.entries;
		let start = 0;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.kind === 'plan' && (entry.variant === 'enter' || entry.variant === 'doc')) {
				start = index + 1;
				break;
			}
		}
		const written: string[] = [];
		const writing: string[] = [];
		for (let index = start; index < entries.length; index++) {
			const entry = entries[index];
			if (entry.kind !== 'tool' || !isPlanWriteTool(entry.toolName, entry.args)) continue;
			const headings = headingsFromToolArgs(entry.args);
			if (entry.running) writing.push(...headings);
			else if (!(entry as ToolEntry).result?.isError) written.push(...headings);
		}
		return buildPlanOutline(written, writing);
	}

	/** Il vassoio «Piano in costruzione» si vede mentre l'agente lavora in Piano. */
	get building(): boolean {
		return this.active && this.session.isStreaming && this.review === null && !this.handingOff;
	}

	/** Il composer lascia il posto alla scheda di approvazione. */
	get approvalOpen(): boolean {
		return this.review !== null && !this.handingOff;
	}

	get openDoc(): PlanDocState | null {
		return this.review ? (planCards.docs[this.review.docId] ?? null) : null;
	}

	isPlanPrompt(entry: UserEntry): boolean {
		const content = entry.content.trim();
		return this.planPrompts.some((text) => content === text || content.startsWith(`${text}\n`));
	}

	/* ------------------------------------------------------ entrata e uscita */

	/**
	 * `/plan [testo]` o la pillola: accende la guardia, passa al ruolo `plan`
	 * (se configurato) e, con un testo, lo manda come primo messaggio di Piano.
	 */
	async enter(text?: string): Promise<boolean> {
		const session = this.session;
		if (session.labConfig) {
			session.flashNotice('info', messages.plan_lab_unavailable());
			return false;
		}
		if (!this.active) {
			if (!(await this.sendCommand('on'))) return false;
			this.active = true;
			this.pushEntry('enter', '');
			this.savedModel =
				session.model?.id
					? { provider: session.model.provider ?? '', modelId: session.model.id, thinking: session.thinkingLevel }
					: null;
			await this.applyRole('plan', { quiet: true });
		}
		const trimmed = text?.trim();
		if (trimmed) return this.sendPrompt(trimmed);
		return true;
	}

	/** Testo mandato in Piano: la sua bolla prende il badge «Piano». */
	notePlanPrompt(text: string): void {
		const trimmed = text.trim();
		if (trimmed) this.planPrompts = [...this.planPrompts, trimmed];
	}

	/** Manda un messaggio in Piano: la bolla prende il badge. */
	async sendPrompt(text: string): Promise<boolean> {
		this.notePlanPrompt(text);
		const result = await this.session.prompt(text);
		return result === 'sent' || result === 'deferred';
	}

	/**
	 * Uscita senza approvare (pillola, `/plan` di nuovo): chiude la revisione
	 * aperta, spegne la guardia e rimette il modello di prima. Il piano resta
	 * nel file e si riapre con `/plan-review`.
	 */
	async exit(): Promise<void> {
		if (!this.active && !this.review) return;
		if (this.review) await this.respond({ action: 'cancel' }, 'closed');
		if (await this.sendCommand('off')) {
			this.active = false;
			this.pushEntry('exit', '');
			await this.restoreModel();
		}
	}

	async toggle(): Promise<void> {
		if (this.active) await this.exit();
		else await this.enter();
	}

	/** `/plan-review`: riapre la revisione dell'ultimo piano della sessione. */
	async reopenReview(): Promise<void> {
		const session = this.session;
		if (this.review) return;
		if (!this.planFilePath) {
			session.flashNotice('info', messages.plan_review_none());
			return;
		}
		if (session.isStreaming) {
			session.flashNotice('info', messages.plan_review_busy());
			return;
		}
		await this.sendCommand('review');
	}

	/* ------------------------------------------------------------ revisione */

	/** Richiesta `editor` con titolo `studio-plan-review:`: nasce la card del piano. */
	openReview(requestId: string, request: PlanReviewRequest): void {
		const id = cardId('plan');
		planCards.docs[id] = {
			id,
			request,
			doc: splitPlanSections(request.content),
			comments: {},
			deleted: [],
			bodies: {},
			status: 'review'
		};
		// Il giro precedente, se ancora aperto, e' superato da questo.
		if (this.review) {
			const previous = planCards.docs[this.review.docId];
			if (previous && previous.status === 'review') previous.status = 'closed';
		}
		this.review = { requestId, docId: id, fromTurn: this.session.isStreaming };
		this.planFilePath = request.planFilePath;
		this.title = request.title;
		this.active = true;
		if (!this.laneTitle || this.laneTitle === this.title) this.laneTitle = request.title;
		this.pushEntry('doc', id);
	}

	/** `cancel` di omp (turno interrotto): la scheda sparisce, la card resta. */
	closeReview(requestId: string): boolean {
		if (this.review?.requestId !== requestId) return false;
		const doc = planCards.docs[this.review.docId];
		if (doc && doc.status === 'review') doc.status = 'closed';
		this.review = null;
		return true;
	}

	addComment(docId: string, sectionId: string, text: string): void {
		const doc = planCards.docs[docId];
		const trimmed = text.trim();
		if (!doc || !trimmed) return;
		doc.comments[sectionId] = [...(doc.comments[sectionId] ?? []), trimmed];
	}

	removeComment(docId: string, sectionId: string, index: number): void {
		const doc = planCards.docs[docId];
		if (!doc?.comments[sectionId]) return;
		doc.comments[sectionId] = doc.comments[sectionId].filter((_, i) => i !== index);
	}

	toggleDeleted(docId: string, sectionId: string): void {
		const doc = planCards.docs[docId];
		if (!doc) return;
		doc.deleted = doc.deleted.includes(sectionId)
			? doc.deleted.filter((id) => id !== sectionId)
			: [...doc.deleted, sectionId];
	}

	saveSectionBody(docId: string, sectionId: string, body: string): void {
		const doc = planCards.docs[docId];
		if (!doc) return;
		doc.bodies[sectionId] = body;
	}

	commentCount(docId: string): number {
		const doc = planCards.docs[docId];
		return doc ? countComments(doc.comments) : 0;
	}

	private editedContent(doc: PlanDocState): string | undefined {
		const edits = { deleted: new Set(doc.deleted), bodies: doc.bodies };
		return planWasEdited(edits, doc.doc) ? composePlan(doc.doc, edits) : undefined;
	}

	/** Contenuto finale del piano (con modifiche ed eliminazioni). */
	finalContent(doc: PlanDocState): string {
		return this.editedContent(doc) ?? doc.request.content;
	}

	/** «Chiedi modifiche»: commenti ed eliminazioni tornano all'agente; resta in Piano. */
	async refine(): Promise<boolean> {
		const doc = this.openDoc;
		if (!doc) return false;
		const feedback = buildRefineFeedback(doc.doc, doc.comments, new Set(doc.deleted), {
			intro: messages.plan_refine_intro(),
			deleted: messages.plan_refine_deleted()
		});
		const content = this.editedContent(doc);
		if (!feedback && content === undefined) {
			this.session.flashNotice('info', messages.plan_refine_empty());
			return false;
		}
		const sent = await this.respond({ action: 'refine', feedback, content }, 'refining');
		// Con la sessione ferma (`/plan-review`) l'estensione manda il commento
		// come messaggio: la bolla prende il badge. Nel turno torna come
		// risultato dello strumento e la bolla non c'e'.
		if (sent && feedback) this.planPrompts = [...this.planPrompts, feedback];
		return sent;
	}

	/** «Salva ed esci»: copia in `.omp/plans/`, Piano spento, nuova sessione senza eseguire. */
	async saveAndQuit(): Promise<void> {
		const doc = this.openDoc;
		if (!doc || this.busy) return;
		this.busy = true;
		try {
			const fromTurn = this.review?.fromTurn ?? false;
			if (!(await this.respond({ action: 'save', content: this.editedContent(doc) }, 'saved'))) return;
			this.active = false;
			if (fromTurn) await this.session.waitForIdle(60_000);
			await this.restoreModel();
			const saved = this.savedPathFromTool() ?? `.omp/plans/${planSaveFileName(doc.request.title)}`;
			await this.session.newSession();
			this.session.flashNotice('info', messages.plan_saved_notice({ path: saved }));
		} finally {
			this.busy = false;
		}
	}

	/* ------------------------------------------------------------ passaggio */

	/** «Approva ed esegui» (Ctrl+Invio): passaggio di compito sulla strada scelta. */
	async approve(): Promise<void> {
		const doc = this.openDoc;
		if (!doc || this.busy) return;
		this.busy = true;
		this.handingOff = true;
		const session = this.session;
		const mode = this.execMode;
		const role = this.execRole;
		const autosave = this.autosave;
		const content = this.finalContent(doc);
		const handoffId = cardId('handoff');
		const toTitle =
			mode === 'lane' ? this.laneTitle.trim() || doc.request.title : doc.request.title;
		planCards.handoffs[handoffId] = {
			id: handoffId,
			title: doc.request.title,
			mode,
			role,
			fromModel: modelLabel(session),
			fromTokens: session.contextUsage?.tokens ?? null,
			toTitle,
			toModel: this.roleModelLabel(role),
			steps: planHandoffSteps(mode, autosave).map((id) => ({ id, state: 'pending', detail: '' })),
			status: 'running',
			error: null,
			planningSessionId: session.sessionId,
			savedPath: null
		};
		const card = planCards.handoffs[handoffId];
		const step = (id: PlanHandoffStepId, state: PlanStepState, detail?: string) => {
			const target = card.steps.find((candidate) => candidate.id === id);
			if (!target) return;
			target.state = state;
			if (detail !== undefined) target.detail = detail;
		};
		this.pushEntry('handoff', handoffId);

		try {
			const fromTurn = this.review?.fromTurn ?? false;
			step('save', 'running');
			step('exit', 'running');
			const sent = await this.respond(
				{ action: 'approve', mode, role, autosave, content: this.editedContent(doc) },
				'approved'
			);
			if (!sent) throw new Error(messages.plan_handoff_not_sent());
			this.active = false;
			// L'estensione salva e spegne la guardia dentro lo strumento: il turno
			// finisce con una frase breve, poi la strada scelta parte da sessione ferma.
			if (fromTurn) await session.waitForIdle(90_000);
			const savedPath = this.savedPathFromTool();
			card.savedPath = savedPath;
			// Il piano finale lo rilegge l'estensione (anche dopo «Apri nell'editor»).
			const fromDisk = fromTurn ? this.submitDetails()?.planContent : undefined;
			const planContent = typeof fromDisk === 'string' && fromDisk.trim() ? fromDisk : content;
			step('save', 'done', savedPath ?? `.omp/plans/${planSaveFileName(doc.request.title)}`);
			step('exit', 'done', messages.plan_step_exit_detail());

			// Il percorso che resta leggibile anche dopo un cambio di sessione.
			const durablePath =
				mode === 'fresh' || mode === 'lane' ? (savedPath ?? doc.request.planFilePath) : doc.request.planFilePath;
			let target: AgentSession = session;

			if (mode === 'fresh') {
				step('new-session', 'running');
				await session.newSession();
				// `new_session` svuota il transcript: la card del passaggio riparte in cima.
				this.pushEntry('handoff', handoffId);
				step('new-session', 'done', session.sessionId ? session.sessionId.slice(0, 8) : '');
			} else if (mode === 'compact') {
				step('compact', 'running');
				const ok = await session.compact(buildCompactInstructions(doc.request.planFilePath));
				if (!ok) throw new Error(messages.plan_handoff_compact_failed());
				const after = session.contextUsage?.tokens;
				step('compact', 'done', after ? messages.plan_step_tokens({ tokens: Math.round(after / 1000) }) : '');
			} else if (mode === 'lane') {
				step('create-lane', 'running');
				if (!host.createLane) throw new Error(messages.plan_handoff_lane_unavailable());
				const created = await host.createLane(session, { title: toTitle });
				if (!created) throw new Error(messages.plan_handoff_lane_unavailable());
				step('create-lane', 'done', created.branch);
				step('start-lane', 'running');
				target = created.session;
				target.plan.pushEntry('handoff', handoffId);
				step('start-lane', 'done', 'rpc-ui');
			}

			step('role', 'running');
			const model = await target.plan.applyRole(role, { quiet: true });
			card.toModel = model || modelLabel(target);
			step('role', 'done', card.toModel);

			step('deliver', 'running');
			const prompt = buildApprovedPrompt({
				planFilePath: durablePath,
				planContent,
				contextPreserved: mode === 'compact' || mode === 'keep'
			});
			const delivery = await target.prompt(prompt);
			if (delivery !== 'sent' && delivery !== 'deferred') throw new Error(messages.plan_handoff_not_sent());
			step('deliver', 'done', messages.plan_step_deliver_detail());
			card.status = 'done';
		} catch (error) {
			card.status = 'failed';
			card.error = error instanceof Error ? error.message : String(error);
			const running = card.steps.find((candidate) => candidate.state === 'running');
			if (running) running.state = 'failed';
			session.pushNotice('error', messages.plan_handoff_failed({ error: card.error }), 'studio');
		} finally {
			this.handingOff = false;
			this.busy = false;
		}
	}

	/** «Torna alla sessione di pianificazione» dalla card del passaggio. */
	returnToPlanning(handoffId: string): void {
		const card = planCards.handoffs[handoffId];
		if (!card?.planningSessionId || !host.resumeSession) return;
		host.resumeSession(this.session, card.planningSessionId);
	}

	/* ------------------------------------------------------------- utilita' */

	/**
	 * Risposta alla richiesta `editor` di omp. La card cambia stato solo se
	 * l'invio riesce: perderla lascerebbe l'agente in attesa per sempre.
	 */
	private async respond(decision: PlanDecision, nextStatus: PlanDocStatus): Promise<boolean> {
		const review = this.review;
		if (!review) return false;
		try {
			await this.session.client.respondUi({
				type: 'extension_ui_response',
				id: review.requestId,
				value: encodePlanDecision(decision)
			});
		} catch (error) {
			this.session.pushNotice(
				'error',
				messages.plan_response_failed({ error: error instanceof Error ? error.message : String(error) }),
				'studio'
			);
			return false;
		}
		const doc = planCards.docs[review.docId];
		if (doc) doc.status = nextStatus;
		this.review = null;
		this.session.settleAttention();
		return true;
	}

	/** `/studio-plan <op>` senza bolla nel transcript (comando dell'estensione). */
	private async sendCommand(op: 'on' | 'off' | 'review' | 'status'): Promise<boolean> {
		try {
			await this.session.client.send({ type: 'prompt', message: `${PLAN_EXTENSION_COMMAND} ${op}` });
			return true;
		} catch (error) {
			this.session.pushNotice(
				'error',
				messages.plan_command_failed({ error: error instanceof Error ? error.message : String(error) }),
				'studio'
			);
			return false;
		}
	}

	/** `details` dell'ultimo `studio_plan_submit` concluso (non vanno al modello). */
	private submitDetails(): Record<string, unknown> | null {
		const entries = this.session.entries;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry.kind !== 'tool' || entry.toolName !== 'studio_plan_submit' || !entry.result) continue;
			const details = entry.result.details;
			return details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
		}
		return null;
	}

	private savedPathFromTool(): string | null {
		const savedPath = this.submitDetails()?.savedPath;
		return typeof savedPath === 'string' ? savedPath : null;
	}

	private roleModelLabel(role: string): string {
		const selector = roleSource?.roles()[role];
		if (!selector) return role === 'default' ? modelLabel(this.session) : '';
		return parseRoleSelector(selector, roleSource?.knownSelectors()).modelId;
	}

	/**
	 * Passa al ruolo indicato con `set_model` (+ thinking), come `/role`.
	 * Un ruolo non configurato non e' un errore: si resta sul modello attuale.
	 */
	async applyRole(role: string, options: { quiet?: boolean } = {}): Promise<string> {
		const session = this.session;
		const source = await loadRoleSource();
		try {
			await source?.ensureLoaded();
		} catch {
			// Senza impostazioni si resta sul modello attuale.
		}
		const selector = source?.roles()[role];
		if (!source || !selector) return modelLabel(session);
		const { provider, modelId, thinking } = parseRoleSelector(selector, source.knownSelectors());
		try {
			await session.client.send({ type: 'set_model', provider: provider || session.model?.provider || '', modelId });
			if (thinking && thinking !== 'auto') {
				await session.client.send({ type: 'set_thinking_level', level: thinking as ThinkingLevel });
			}
			session.lastPickedRole = role;
			await session.refreshState();
		} catch (error) {
			if (!options.quiet) throw error;
			session.flashNotice(
				'warning',
				messages.plan_role_failed({ role, error: error instanceof Error ? error.message : String(error) })
			);
		}
		return modelLabel(session);
	}

	private async restoreModel(): Promise<void> {
		const saved = this.savedModel;
		this.savedModel = null;
		if (!saved) return;
		const session = this.session;
		try {
			await session.client.send({ type: 'set_model', provider: saved.provider, modelId: saved.modelId });
			if (saved.thinking) await session.client.send({ type: 'set_thinking_level', level: saved.thinking });
			session.lastPickedRole = null;
			await session.refreshState();
		} catch {
			// Il modello del Piano resta: l'utente lo cambia dal composer.
		}
	}

	/** Voce del solo client nel transcript (riga di stato, card del piano, passaggio). */
	pushEntry(variant: PlanEntry['variant'], refId: string): void {
		this.session.pushPlanEntry(variant, refId);
	}
}
