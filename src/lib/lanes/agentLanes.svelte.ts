// Servizio delle corsie guidate dall'agente (tool `corsia_*`).
//
// Riceve le richieste del bridge loopback (`lane-bridge://request`, una per
// verbo) e le esegue riusando i flussi della GUI: creazione e spedizione del
// task nella corsia (+page.svelte, registrato come host), integrazione
// (`laneLanding`), chiusura ed eliminazione (`laneLifecycle`), Laboratorio
// (`labApi`). Ogni richiesta riceve SEMPRE una risposta con
// `lane_bridge_respond`, tranne `proponi`, che resta aperta finche' l'utente
// non clicca una delle due scelte sulla card in chat.
//
// Decisioni (DECISIONS.md, Gate R33):
// - l'agente non tocca mai git: nessun percorso di worktree o comando nei testi;
// - integrazione pulita automatica; con conflitti la corsia passa all'utente
//   (revisione aperta), l'agente non risolve nulla;
// - oltre il soft-cap `corsia_avvia` mette l'obiettivo nella coda del progetto
//   e lo avvia quando si libera un posto;
// - scartare lavoro mai integrato chiede sempre conferma nella finestra della GUI.

import { invoke } from '@tauri-apps/api/core';
import { laneStore, type LaneRecord } from '$lib/stores/lanes.svelte';
import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { taskStore } from '$lib/stores/tasks.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelSettingsStore, STANDARD_ROLES } from '$lib/stores/modelSettings.svelte';
import { roleConfigFromSelector } from '$lib/components/taskRoleConfig';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { laneOrchestrator } from './laneOrchestrator.svelte';
import { laneLanding, type LandCaller } from './laneLanding.svelte';
import { closeLane, deleteWorktreeLane, inspectUnintegratedWork } from './laneLifecycle';
import { activeLanes, shouldWarnConcurrency } from './queueDispatch';
import { labApi } from '$lib/lab/api';
import type { LabIndexEntry } from '$lib/lab/types';
import { peekLabRuntime } from '$lib/lab/runtime.svelte';
import { laneId as toLaneId, workspacePath, MAIN_LANE_ID, type LaneId, type ProjectId } from '$lib/types/lanes';
import {
	buildLabHandoffPackage,
	callerIsMain,
	classifyAgentLane,
	computeDiffstat,
	describeLaneChoices,
	formatDiffstat,
	formatStatoText,
	listPaths,
	parseCorsiaVerbo,
	proposalAgentText,
	resolveLaneRef,
	verboAllowedForCaller,
	type AgentLaneRow,
	type CorsiaVerbo,
	type Diffstat,
	type ProposalChoice
} from './agentLaneRoutes';

/** Evento `lane-bridge://request` emesso da `lane_bridge.rs`. */
export interface CorsieBridgePayload {
	requestId: string;
	/** Assente solo se il frontend parla con un backend precedente al router. */
	route?: string;
	ownerKind: 'agent' | 'terminal';
	ownerId: number;
	projectId: string | null;
	callerLaneId: string | null;
	cwd: string;
	laneId: string | null;
	message: string;
	body?: Record<string, unknown>;
}

interface BridgeResponse {
	ok: boolean;
	text: string;
	details?: Record<string, unknown>;
}

/** Esito della spedizione di un task in una corsia nuova (host: +page.svelte). */
export type AgentLaneDispatchOutcome =
	| { kind: 'started'; lane: LaneRecord }
	| { kind: 'awaiting-consent' }
	| { kind: 'failed'; message: string };

/**
 * La spedizione vive in +page.svelte (dialoghi, stato del terminale, errori
 * per corsia): la pagina la registra qui all'avvio, cosi' l'agente passa per
 * esattamente lo stesso percorso del click con `Shift`.
 */
export interface AgentLaneHost {
	dispatchTaskInNewLane(
		project: Project,
		taskId: string,
		options: { follow?: boolean }
	): Promise<AgentLaneDispatchOutcome>;
}

/** Obiettivo in attesa di un posto libero (oltre il soft-cap). */
export interface QueuedAgentGoal {
	id: string;
	projectId: string;
	taskId: string;
	obiettivo: string;
	queuedAt: number;
}

export interface PendingLaneProposal {
	/** Chiave della card: `toolCallId` della chiamata, o `requestId` se manca. */
	key: string;
	requestId: string;
	projectId: string;
	motivo: string;
	obiettivo: string | null;
	createdAt: number;
	resolving: boolean;
}

export interface ResolvedLaneProposal {
	key: string;
	choice: ProposalChoice;
	laneId?: string;
	laneTitle?: string;
	error?: string;
}

/** Richiesta alla GUI di aprire un dialogo esistente su una corsia. */
export interface LaneUiRequest {
	projectId: string;
	laneId: string;
	nonce: number;
}

const QUEUE_STORAGE_KEY = 'omp-studio.agentLaneQueue';
const QUEUE_TICK_MS = 10_000;

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
		return (error as { message: string }).message;
	}
	return String(error);
}

interface ReviewInspection {
	files: Array<{ path: string; additions: number; deletions: number }>;
	targetBranch: string;
	hasUnresolvedConflicts: boolean;
}

class AgentLaneService {
	/** Proposte in attesa del clic, per chiave della card. */
	proposals = $state<Record<string, PendingLaneProposal>>({});
	/** Scelte gia' fatte: la card mostra l'esito anche dopo la risposta. */
	resolvedProposals = $state<Record<string, ResolvedLaneProposal>>({});
	/** Obiettivi di `corsia_avvia` oltre il soft-cap. */
	queue = $state<QueuedAgentGoal[]>([]);
	/** La pagina apre `LaneReviewModal` su questa corsia (conflitti da `corsia_integra`). */
	reviewRequest = $state<LaneUiRequest | null>(null);
	/** La `LaneStrip` del progetto apre il suo dialogo di eliminazione (`corsia_scarta`). */
	deleteRequest = $state<LaneUiRequest | null>(null);

	private host: AgentLaneHost | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private draining = false;
	private nonce = 0;

	init(): void {
		if (this.timer !== null) return;
		this.loadQueue();
		this.timer = setInterval(() => void this.processQueue(), QUEUE_TICK_MS);
	}

	dispose(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}

	setHost(host: AgentLaneHost | null): void {
		this.host = host;
	}

	requestReview(projectId: string, laneId: string): void {
		this.reviewRequest = { projectId, laneId, nonce: ++this.nonce };
	}

	requestDelete(projectId: string, laneId: string): void {
		this.deleteRequest = { projectId, laneId, nonce: ++this.nonce };
	}

	queuedFor(projectId: string): QueuedAgentGoal[] {
		return this.queue.filter((goal) => goal.projectId === projectId);
	}

	/* ------------------------------------------------------- router --- */

	async handleBridgeRequest(payload: CorsieBridgePayload): Promise<void> {
		// Un backend senza router manda solo l'integrazione storica.
		const verbo: CorsiaVerbo | null = payload.route === undefined ? 'integra' : parseCorsiaVerbo(payload.route);
		const body: Record<string, unknown> = payload.body ?? {
			corsia: payload.laneId,
			messaggio: payload.message
		};
		try {
			if (!verbo) {
				await this.respond(payload.requestId, { ok: false, text: `Verbo '${payload.route}' sconosciuto.` });
				return;
			}
			// Il token nasce solo con un projectId: indovinare il progetto
			// rischierebbe di agire sulla corsia sbagliata.
			const project = payload.projectId
				? projectStore.projects.find((p) => p.id === payload.projectId)
				: undefined;
			if (!project) {
				await this.respond(payload.requestId, { ok: false, text: 'Progetto non trovato.' });
				return;
			}
			if (!verboAllowedForCaller(verbo, payload.callerLaneId)) {
				await this.respond(payload.requestId, {
					ok: false,
					text:
						verbo === 'fatto'
							? 'corsia_fatto si usa solo dentro una corsia.'
							: 'Dentro una corsia sono ammessi solo corsia_fatto e corsia_stato.'
				});
				return;
			}
			// `proponi` risponde solo al clic dell'utente.
			if (verbo === 'proponi') {
				this.openProposal(project, payload, body);
				return;
			}
			const response = await this.dispatch(verbo, project, payload, body);
			// La card in chat ha bisogno del progetto per "Apri" e "Revisiona".
			response.details = { ...(response.details ?? {}), progetto: project.id };
			await this.respond(payload.requestId, response);
		} catch (error) {
			await this.respond(payload.requestId, {
				ok: false,
				text: `Errore imprevisto in corsia_${verbo ?? payload.route}: ${errorMessage(error)}`
			});
		}
	}

	private async respond(requestId: string, response: BridgeResponse): Promise<boolean> {
		try {
			await invoke('lane_bridge_respond', { requestId, response });
			return true;
		} catch (error) {
			console.warn('[agentLanes] Risposta al bridge non consegnata:', error);
			return false;
		}
	}

	private dispatch(
		verbo: Exclude<CorsiaVerbo, 'proponi'>,
		project: Project,
		payload: CorsieBridgePayload,
		body: Record<string, unknown>
	): Promise<BridgeResponse> {
		switch (verbo) {
			case 'avvia':
				return this.avvia(project, body);
			case 'stato':
				return this.stato(project);
			case 'risultato':
				return this.risultato(project, text(body.corsia));
			case 'integra':
				return this.integra(project, payload, body);
			case 'chiudi':
				return this.chiudi(project, text(body.corsia));
			case 'scarta':
				return this.scarta(project, text(body.corsia));
			case 'consegna':
				return this.consegna(project, text(body.prototipo));
			case 'fatto':
				return this.fatto(project, payload.callerLaneId, text(body.riassunto));
		}
	}

	private lanes(project: Project): LaneRecord[] {
		return laneStore.lanesFor(project.id as ProjectId);
	}

	private resolve(project: Project, ref: string | null): { lane: LaneRecord } | { error: BridgeResponse } {
		const lanes = this.lanes(project);
		const found = resolveLaneRef(lanes, ref);
		if (found.kind === 'found') return { lane: found.lane };
		if (found.kind === 'ambiguous') {
			return {
				error: {
					ok: false,
					text: `Piu' corsie si chiamano "${ref}": usa l'id.\n${found.matches.map((l) => `- ${l.laneId}: ${l.title}`).join('\n')}`
				}
			};
		}
		return { error: { ok: false, text: `Corsia "${ref ?? ''}" non trovata. ${describeLaneChoices(lanes)}` } };
	}

	/* -------------------------------------------------------- avvia --- */

	private async avvia(project: Project, body: Record<string, unknown>): Promise<BridgeResponse> {
		const obiettivo = text(body.obiettivo);
		if (!obiettivo) return { ok: false, text: "Il campo 'obiettivo' e' obbligatorio." };
		const profilo = text(body.profilo);
		if (body.tipo === 'lab') return this.avviaLab(project, obiettivo, profilo);

		if (!project.canonicalProjectPath) {
			return { ok: false, text: 'Il progetto non ha una cartella Git: niente worktree.' };
		}
		const created = await this.createGoalTask(project, obiettivo, profilo);
		if ('error' in created) return { ok: false, text: created.error };

		if (this.overSoftCap(project)) {
			const goal: QueuedAgentGoal = {
				id: `coda-${crypto.randomUUID().slice(0, 8)}`,
				projectId: project.id,
				taskId: created.taskId,
				obiettivo,
				queuedAt: Date.now()
			};
			this.queue = [...this.queue, goal];
			this.saveQueue();
			return {
				ok: true,
				text: `In coda: ci sono gia' troppi agenti al lavoro in questo progetto. L'obiettivo (${goal.id}) e' nella coda del progetto e parte da solo appena si libera un posto. Non ritentare.`,
				details: { stato: 'in_coda', obiettivoId: goal.id, taskId: created.taskId }
			};
		}
		return this.startGoal(project, created.taskId, { follow: false });
	}

	/** Oltre il soft-cap la GUI chiede conferma; l'agente invece mette in coda. */
	private overSoftCap(project: Project): boolean {
		const snapshots = laneOrchestrator.laneDispatchSnapshots(project);
		return shouldWarnConcurrency(activeLanes(snapshots).length);
	}

	/** Il profilo e' un ruolo modello di Studio: ne eredita modello e thinking. */
	private async createGoalTask(
		project: Project,
		obiettivo: string,
		profilo: string | null
	): Promise<{ taskId: string } | { error: string }> {
		const root = project.canonicalProjectPath;
		if (!root) return { error: 'Il progetto non ha una cartella.' };
		let roleOptions: { role: string; modelSelector?: string; thinkingLevel?: string } | null = null;
		if (profilo) {
			const role = STANDARD_ROLES.find((candidate) => candidate.id === profilo.toLowerCase());
			if (!role) {
				return {
					error: `Profilo "${profilo}" sconosciuto. Profili disponibili: ${STANDARD_ROLES.map((r) => r.id).join(', ')}.`
				};
			}
			const roles = modelSettingsStore.config?.modelRoles ?? {};
			const { model, thinking } = roleConfigFromSelector(roles[role.id] ?? '', modelSettingsStore.knownSelectors);
			roleOptions = { role: role.id, modelSelector: model || undefined, thinkingLevel: model ? thinking : undefined };
		}
		await taskStore.loadProject(root).catch(() => false);
		const task = taskStore.createTask(root);
		taskStore.updateTask(task.id, obiettivo, [], { ...(task.options ?? {}), ...(roleOptions ?? {}) });
		return { taskId: task.id };
	}

	private async startGoal(
		project: Project,
		taskId: string,
		options: { follow?: boolean }
	): Promise<BridgeResponse> {
		if (!this.host) {
			return { ok: false, text: "Studio non e' pronto a creare corsie: riprova tra qualche secondo." };
		}
		const outcome = await this.host.dispatchTaskInNewLane(project, taskId, options);
		if (outcome.kind === 'started') {
			return {
				ok: true,
				text: `Corsia ${outcome.lane.laneId} ("${outcome.lane.title}") avviata: l'agente della corsia sta lavorando sull'obiettivo. Usa corsia_stato e corsia_risultato per seguirla.`,
				details: { stato: 'in_corso', corsia: outcome.lane.laneId, titolo: outcome.lane.title, tipo: 'worktree' }
			};
		}
		if (outcome.kind === 'awaiting-consent') {
			return {
				ok: true,
				text: "Studio chiede all'utente quali file locali copiare nel nuovo worktree: la corsia parte dopo la sua scelta. Non ritentare.",
				details: { stato: 'consenso_utente', taskId }
			};
		}
		return { ok: false, text: `Corsia non avviata: ${outcome.message}`, details: { taskId } };
	}

	private async avviaLab(project: Project, obiettivo: string, profilo: string | null): Promise<BridgeResponse> {
		if (!settingsStore.general?.labAlphaEnabled) {
			return { ok: false, text: "Il Laboratorio e' disattivato nelle Impostazioni di Studio: chiedi all'utente di attivarlo." };
		}
		if (!project.canonicalProjectPath) return { ok: false, text: 'Il progetto non ha una cartella.' };
		if (profilo) {
			// Il Laboratorio ha la sua configurazione confinata: il ruolo non si applica.
			console.info('[agentLanes] Profilo ignorato per il Laboratorio:', profilo);
		}
		const title = obiettivo.length > 48 ? `${obiettivo.slice(0, 47)}\u2026` : obiettivo;
		const entry = await labApi.createPrototype(project.canonicalProjectPath, title);
		const record = labLaneRecord(project, entry);
		await laneStore.upsertLane(record);
		try {
			const session = laneOrchestrator.getOrCreateAgentSession(project, record);
			await session.ensureOpen(null);
			const delivery = await session.prompt(obiettivo, [], 'steer');
			if (delivery === 'failed' || delivery === 'empty') throw new Error('prompt non consegnato');
		} catch (error) {
			return {
				ok: false,
				text: `Prototipo ${entry.id} creato ma l'agente del Laboratorio non e' partito: ${errorMessage(error)}`,
				details: { corsia: record.laneId, prototipo: entry.id }
			};
		}
		return {
			ok: true,
			text: `Prototipo ${entry.id} avviato nella corsia ${record.laneId}: l'agente del Laboratorio sta lavorando. Usa corsia_risultato e poi corsia_consegna.`,
			details: { stato: 'in_corso', corsia: record.laneId, titolo: record.title, tipo: 'lab', prototipo: entry.id }
		};
	}

	/* -------------------------------------------------------- stato --- */

	private async inspect(project: Project, lane: LaneRecord): Promise<ReviewInspection | null> {
		if (!project.canonicalProjectPath || !lane.workspacePath || lane.kind === 'lab') return null;
		try {
			return await invoke<ReviewInspection>('worktree_review_inspect', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					targetBranch: lane.targetBranch ?? undefined
				}
			});
		} catch {
			return null;
		}
	}

	private async labIndex(project: Project): Promise<LabIndexEntry[]> {
		if (!project.canonicalProjectPath) return [];
		return labApi.listIndex(project.canonicalProjectPath).catch(() => [] as LabIndexEntry[]);
	}

	private async stato(project: Project): Promise<BridgeResponse> {
		const lanes = this.lanes(project).filter(
			(lane) => lane.laneId !== MAIN_LANE_ID && lane.status !== 'archived' && lane.status !== 'closed'
		);
		const index = lanes.some((lane) => lane.kind === 'lab') ? await this.labIndex(project) : [];
		const rows: AgentLaneRow[] = await Promise.all(
			lanes.map(async (lane) => {
				const state = classifyAgentLane({
					status: lane.status,
					agentState: laneOrchestrator.laneAgentState(project, lane.laneId),
					agentSummaryAt: lane.agentSummaryAt,
					recoveryState: lane.recoveryState
				});
				if (lane.kind === 'lab') {
					const entry = index.find((item) => item.id === lane.labPrototypeId);
					return {
						laneId: lane.laneId,
						title: lane.title,
						kind: 'lab' as const,
						state,
						revision: entry?.lastRevision?.message ?? null,
						summary: lane.agentSummary ?? null
					};
				}
				const inspection = await this.inspect(project, lane);
				return {
					laneId: lane.laneId,
					title: lane.title,
					kind: 'git' as const,
					state,
					diffstat: inspection ? computeDiffstat(inspection.files) : null,
					summary: lane.agentSummary ?? null
				};
			})
		);
		for (const goal of this.queuedFor(project.id)) {
			rows.push({ laneId: goal.id, title: goal.obiettivo.slice(0, 60), kind: 'goal', state: 'in_coda' });
		}
		return { ok: true, text: formatStatoText(rows), details: { corsie: rows } };
	}

	/* ---------------------------------------------------- risultato --- */

	private async risultato(project: Project, ref: string | null): Promise<BridgeResponse> {
		const found = this.resolve(project, ref);
		if ('error' in found) return found.error;
		const lane = found.lane;
		const state = classifyAgentLane({
			status: lane.status,
			agentState: laneOrchestrator.laneAgentState(project, lane.laneId),
			agentSummaryAt: lane.agentSummaryAt,
			recoveryState: lane.recoveryState
		});
		const summary = lane.agentSummary?.trim() || null;
		const header = `Corsia ${lane.laneId} ("${lane.title}"): ${state.replace('_', ' ')}.`;
		const summaryText = summary
			? `Riassunto dell'agente della corsia:\n${summary}`
			: "L'agente della corsia non ha ancora lasciato un riassunto con corsia_fatto.";

		if (lane.kind === 'lab') {
			const entry = (await this.labIndex(project)).find((item) => item.id === lane.labPrototypeId) ?? null;
			const runtime = peekLabRuntime(project.id, lane.laneId);
			const revision = entry?.lastRevision ?? null;
			const lines = [header, summaryText];
			if (entry?.summary) lines.push(`Riepilogo del prototipo: ${entry.summary}`);
			lines.push(
				revision
					? `Ultima revisione: ${revision.sha.slice(0, 7)} "${revision.message}" (${revision.date}).`
					: 'Nessuna revisione registrata.'
			);
			if (runtime?.url) {
				lines.push(
					`Anteprima: ${runtime.url}${runtime.errors > 0 ? ` (${runtime.errors} errori aperti)` : ' (nessun errore)'}.`
				);
			} else {
				lines.push("Anteprima non ancora compilata in questa sessione di Studio.");
			}
			return {
				ok: true,
				text: lines.join('\n'),
				details: {
					corsia: lane.laneId,
					titolo: lane.title,
					tipo: 'lab',
					stato: state,
					riassunto: summary,
					prototipo: lane.labPrototypeId,
					revisione: revision,
					anteprima: runtime?.url ?? null,
					erroriAnteprima: runtime?.errors ?? 0
				}
			};
		}

		const inspection = await this.inspect(project, lane);
		const stat: Diffstat | null = inspection ? computeDiffstat(inspection.files) : null;
		const lines = [header, summaryText, `Modifiche rispetto a ${inspection?.targetBranch ?? lane.targetBranch ?? 'main'}: ${formatDiffstat(stat)}.`];
		const paths = listPaths(stat?.paths ?? [], 30);
		if (paths) lines.push(`File: ${paths}`);
		return {
			ok: true,
			text: lines.join('\n'),
			details: {
				corsia: lane.laneId,
				titolo: lane.title,
				tipo: 'worktree',
				stato: state,
				riassunto: summary,
				diffstat: stat,
				targetBranch: inspection?.targetBranch ?? lane.targetBranch ?? null
			}
		};
	}

	/* ------------------------------------------------------ integra --- */

	private async integra(
		project: Project,
		payload: CorsieBridgePayload,
		body: Record<string, unknown>
	): Promise<BridgeResponse> {
		const messaggio = text(body.messaggio);
		if (!messaggio) return { ok: false, text: "Il campo 'messaggio' e' obbligatorio." };
		const ref = text(body.corsia);
		let lane: LaneRecord;
		if (ref) {
			const found = this.resolve(project, ref);
			if ('error' in found) return found.error;
			lane = found.lane;
		} else {
			// Senza nome si integra solo se la scelta e' univoca.
			const open = this.lanes(project).filter(
				(l) => l.laneId !== MAIN_LANE_ID && l.kind !== 'lab' && l.status !== 'archived' && l.status !== 'closed'
			);
			if (open.length !== 1) {
				return {
					ok: false,
					text: open.length === 0 ? 'Nessuna corsia worktree aperta da integrare.' : `Specifica la corsia. ${describeLaneChoices(open)}`
				};
			}
			lane = open[0];
		}
		if (lane.kind === 'lab') {
			return { ok: false, text: 'Un prototipo del Laboratorio non si integra: usa corsia_consegna.' };
		}
		const caller: LandCaller = {
			kind: payload.ownerKind,
			ownerId: payload.ownerId,
			callerLaneId: callerIsMain(payload.callerLaneId) ? 'main' : payload.callerLaneId
		};
		const result = await laneLanding.land(project, lane.laneId, { message: messaggio, caller });
		if (result.kind === 'conflicts') {
			// La corsia passa all'utente: revisione aperta, nessuna istruzione git all'agente.
			this.requestReview(project.id, lane.laneId);
		}
		return {
			ok: result.kind !== 'error',
			text: result.agentText,
			details: { ...result, corsia: lane.laneId, titolo: lane.title }
		};
	}

	/* ------------------------------------------------ chiudi/scarta --- */

	private async chiudi(project: Project, ref: string | null): Promise<BridgeResponse> {
		const found = this.resolve(project, ref);
		if ('error' in found) return found.error;
		const lane = found.lane;
		if (lane.status === 'closed') {
			return { ok: true, text: `La corsia ${lane.laneId} e' gia' chiusa.`, details: { corsia: lane.laneId, titolo: lane.title, esito: 'chiusa' } };
		}
		const outcome = await closeLane(project.id as ProjectId, lane.laneId);
		if (outcome.kind === 'failed') return { ok: false, text: `Chiusura non riuscita: ${outcome.message}` };
		return {
			ok: true,
			text: `Corsia ${lane.laneId} ("${lane.title}") chiusa. Branch e cartella restano: l'utente puo' riaprirla dalla barra delle corsie.`,
			details: { corsia: lane.laneId, titolo: lane.title, tipo: lane.kind === 'lab' ? 'lab' : 'worktree', esito: 'chiusa' }
		};
	}

	private async scarta(project: Project, ref: string | null): Promise<BridgeResponse> {
		const found = this.resolve(project, ref);
		if ('error' in found) return found.error;
		const lane = found.lane;
		const base = { corsia: lane.laneId, titolo: lane.title, tipo: lane.kind === 'lab' ? 'lab' : 'worktree' };

		if (lane.kind === 'lab') {
			// Un prototipo eliminato perde tutte le revisioni: decide sempre l'utente.
			this.requestDelete(project.id, lane.laneId);
			return {
				ok: true,
				text: `Eliminare il prototipo ${lane.labPrototypeId ?? lane.laneId} cancella tutte le sue revisioni: Studio ha chiesto conferma all'utente. Non ritentare.`,
				details: { ...base, esito: 'conferma_utente' }
			};
		}

		const loss = await inspectUnintegratedWork(project.id as ProjectId, lane.laneId);
		if (loss) {
			this.requestDelete(project.id, lane.laneId);
			return {
				ok: true,
				text: `Attenzione: la corsia ${lane.laneId} contiene lavoro mai integrato. Studio non ha cancellato nulla e ha chiesto conferma all'utente nella sua finestra. Non ritentare.`,
				details: { ...base, esito: 'conferma_utente', perdita: loss }
			};
		}
		const outcome = await deleteWorktreeLane(project.id as ProjectId, lane.laneId);
		if (outcome.kind === 'deleted') {
			return { ok: true, text: `Corsia ${lane.laneId} ("${lane.title}") scartata: worktree e branch rimossi.`, details: { ...base, esito: 'scartata' } };
		}
		if (outcome.kind === 'unintegrated' || outcome.kind === 'processes-active') {
			// Commit arrivati nel frattempo o processi vivi: decide l'utente nello stesso dialogo della GUI.
			this.requestDelete(project.id, lane.laneId);
			return {
				ok: true,
				text:
					outcome.kind === 'unintegrated'
						? `La corsia ${lane.laneId} contiene lavoro mai integrato: Studio ha chiesto conferma all'utente. Non ritentare.`
						: `Nella corsia ${lane.laneId} ci sono processi ancora vivi: Studio ha chiesto all'utente se fermarli. Non ritentare.`,
				details: { ...base, esito: 'conferma_utente' }
			};
		}
		return { ok: false, text: `Eliminazione non riuscita: ${outcome.message}`, details: { ...base, esito: 'errore' } };
	}

	/* ----------------------------------------------------- consegna --- */

	private async consegna(project: Project, ref: string | null): Promise<BridgeResponse> {
		if (!project.canonicalProjectPath) return { ok: false, text: 'Il progetto non ha una cartella.' };
		const index = await this.labIndex(project);
		const lanes = this.lanes(project).filter((lane) => lane.kind === 'lab');
		const byLane = resolveLaneRef(lanes, ref);
		const wanted = (ref ?? '').trim().toLowerCase();
		const entry =
			(byLane.kind === 'found' ? index.find((item) => item.id === byLane.lane.labPrototypeId) : undefined) ??
			index.find((item) => item.id === ref?.trim()) ??
			index.find((item) => item.title.trim().toLowerCase() === wanted);
		if (!entry) {
			const list = index.map((item) => `- ${item.id}: ${item.title}`).join('\n');
			return { ok: false, text: `Prototipo "${ref ?? ''}" non trovato.${list ? `\nPrototipi del progetto:\n${list}` : ''}` };
		}
		const exists = await labApi.workspaceExists(entry.workspacePath).catch(() => false);
		if (!exists) {
			return { ok: false, text: `La cartella del prototipo ${entry.id} non esiste su questa macchina.` };
		}
		const [files, log] = await Promise.all([
			labApi.snapshot(entry.workspacePath).catch(() => []),
			labApi.log(entry.workspacePath, 1).catch(() => [])
		]);
		const revision = log[0] ?? entry.lastRevision ?? null;
		const lane = lanes.find((candidate) => candidate.labPrototypeId === entry.id);
		const runtime = lane ? peekLabRuntime(project.id, lane.laneId) : null;
		const pacchetto = buildLabHandoffPackage({
			prototypeId: entry.id,
			title: entry.title,
			summary: lane?.agentSummary?.trim() || entry.summary,
			workspacePath: entry.workspacePath,
			revision,
			files: files.map((file) => file.path),
			previewUrl: runtime?.url ?? null,
			previewErrors: runtime?.errors ?? 0
		});
		return {
			ok: true,
			text: pacchetto,
			details: {
				prototipo: entry.id,
				titolo: entry.title,
				corsia: lane?.laneId ?? null,
				revisione: revision,
				file: files.length
			}
		};
	}

	/* -------------------------------------------------------- fatto --- */

	private async fatto(project: Project, callerLaneId: string | null, riassunto: string | null): Promise<BridgeResponse> {
		if (!riassunto) return { ok: false, text: "Il campo 'riassunto' e' obbligatorio." };
		if (callerIsMain(callerLaneId)) return { ok: false, text: 'corsia_fatto si usa solo dentro una corsia.' };
		const lane = this.lanes(project).find((candidate) => candidate.laneId === callerLaneId);
		if (!lane) return { ok: false, text: 'Studio non trova la corsia di questa sessione.' };
		await laneStore.updateLane(project.id as ProjectId, lane.laneId, {
			agentSummary: riassunto,
			agentSummaryAt: Date.now(),
			// Un worktree finito e' pronto per la revisione: l'anello della barra lo dice.
			...(lane.kind === 'git' && lane.status === 'active' ? { status: 'review_ready' as const } : {})
		});
		const main = sessionRegistry.getMainSession(project.id);
		const first = riassunto.split('\n', 1)[0] ?? riassunto;
		main?.pushNotice('info', `Corsia "${lane.title}" finita: ${first.length > 140 ? `${first.slice(0, 139)}\u2026` : first}`, 'studio');
		return {
			ok: true,
			text: "Riassunto registrato: la Principale e l'utente lo leggono da Studio. Non integrare e non fare commit: decide l'utente.",
			details: { corsia: lane.laneId, titolo: lane.title, riassunto }
		};
	}

	/* ------------------------------------------------------ proponi --- */

	private openProposal(project: Project, payload: CorsieBridgePayload, body: Record<string, unknown>): void {
		const key = text(body.toolCallId) ?? payload.requestId;
		this.proposals = {
			...this.proposals,
			[key]: {
				key,
				requestId: payload.requestId,
				projectId: project.id,
				motivo: text(body.motivo) ?? '',
				obiettivo: text(body.obiettivo),
				createdAt: Date.now(),
				resolving: false
			}
		};
	}

	/** Clic su una delle due pillole della card di proposta. */
	async resolveProposal(key: string, choice: ProposalChoice): Promise<void> {
		const proposal = this.proposals[key];
		if (!proposal || proposal.resolving) return;
		this.proposals = { ...this.proposals, [key]: { ...proposal, resolving: true } };

		let resolved: ResolvedLaneProposal = { key, choice };
		let response: BridgeResponse;
		if (choice === 'main') {
			response = { ok: true, text: proposalAgentText('main'), details: { scelta: 'main' } };
		} else {
			const project = projectStore.projects.find((p) => p.id === proposal.projectId);
			const outcome = project
				? await this.createProposedLane(project, proposal)
				: { error: 'progetto non piu\' aperto' };
			if ('error' in outcome) {
				resolved = { ...resolved, error: outcome.error };
				response = { ok: true, text: proposalAgentText('worktree', outcome), details: { scelta: 'worktree', errore: outcome.error } };
			} else {
				resolved = { ...resolved, laneId: outcome.laneId, laneTitle: outcome.title };
				response = {
					ok: true,
					text: proposalAgentText('worktree', outcome),
					details: { scelta: 'worktree', corsia: outcome.laneId, titolo: outcome.title, affidato: outcome.dispatched }
				};
			}
		}
		response.details = { ...(response.details ?? {}), progetto: proposal.projectId };
		const delivered = await this.respond(proposal.requestId, response);
		if (!delivered && !resolved.error) {
			// Il bridge ha gia' chiuso la richiesta (attesa scaduta o agente fermato):
			// la scelta resta visibile, ma l'agente non la ricevera'.
			resolved = { ...resolved, error: "l'agente non era piu' in attesa della risposta" };
		}
		const { [key]: _done, ...rest } = this.proposals;
		this.proposals = rest;
		this.resolvedProposals = { ...this.resolvedProposals, [key]: resolved };
	}

	private async createProposedLane(
		project: Project,
		proposal: PendingLaneProposal
	): Promise<{ laneId: string; title: string; dispatched: boolean } | { error: string }> {
		if (!project.canonicalProjectPath) return { error: 'il progetto non ha una cartella Git' };
		try {
			if (proposal.obiettivo) {
				// Il clic dell'utente e' gia' la conferma: niente soft-cap ne' coda.
				const created = await this.createGoalTask(project, proposal.obiettivo, null);
				if ('error' in created) return { error: created.error };
				if (!this.host) return { error: "Studio non e' pronto a creare corsie" };
				const outcome = await this.host.dispatchTaskInNewLane(project, created.taskId, { follow: false });
				if (outcome.kind === 'started') {
					return { laneId: outcome.lane.laneId, title: outcome.lane.title, dispatched: true };
				}
				if (outcome.kind === 'awaiting-consent') {
					return { error: "serve prima la scelta dell'utente sui file locali da copiare (dialogo aperto)" };
				}
				return { error: outcome.message };
			}
			const title = proposal.motivo.length > 48 ? `${proposal.motivo.slice(0, 47)}\u2026` : proposal.motivo;
			const lane = await laneOrchestrator.createNewLane(project, {
				origin: 'manual',
				surface: 'gui',
				title: title || undefined,
				activate: true
			});
			if (projectStore.activeId !== project.id) projectStore.setActive(project.id);
			await laneOrchestrator.switchLane(project.id as ProjectId, lane.laneId);
			return { laneId: lane.laneId, title: lane.title, dispatched: false };
		} catch (error) {
			return { error: errorMessage(error) };
		}
	}

	/* --------------------------------------------- coda obiettivi --- */

	/** Avvia gli obiettivi in coda quando il progetto torna sotto il soft-cap. */
	async processQueue(): Promise<void> {
		if (this.draining || this.queue.length === 0 || !this.host) return;
		this.draining = true;
		try {
			for (const goal of [...this.queue]) {
				const project = projectStore.projects.find((p) => p.id === goal.projectId);
				if (!project) continue;
				const task = taskStore.taskById(goal.taskId);
				// Spedito a mano, cancellato o modificato in "in corso": non e' piu' nostro.
				if (!task || task.status !== 'queued') {
					this.dropGoal(goal.id);
					continue;
				}
				if (this.overSoftCap(project)) continue;
				this.dropGoal(goal.id);
				const response = await this.startGoal(project, goal.taskId, { follow: false });
				sessionRegistry
					.getMainSession(project.id)
					?.pushNotice(response.ok ? 'info' : 'warning', `Obiettivo in coda: ${response.text}`, 'studio');
			}
		} finally {
			this.draining = false;
		}
	}

	private dropGoal(goalId: string): void {
		this.queue = this.queue.filter((goal) => goal.id !== goalId);
		this.saveQueue();
	}

	private loadQueue(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
			const parsed: unknown = raw ? JSON.parse(raw) : [];
			if (!Array.isArray(parsed)) return;
			this.queue = parsed.filter(
				(item): item is QueuedAgentGoal =>
					item && typeof item === 'object' && typeof item.id === 'string' && typeof item.taskId === 'string' && typeof item.projectId === 'string'
			);
		} catch (error) {
			console.warn('[agentLanes] Coda obiettivi illeggibile:', error);
		}
	}

	private saveQueue(): void {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
		} catch (error) {
			console.warn('[agentLanes] Salvataggio coda obiettivi fallito:', error);
		}
	}
}

/**
 * Record della corsia Lab di progetto per un prototipo appena creato: stessa
 * forma di `openLabEntry`, ma senza spostare la vista dell'utente.
 */
export function labLaneRecord(project: Project, entry: LabIndexEntry): LaneRecord {
	return {
		projectId: project.id as ProjectId,
		laneId: toLaneId(`lab-${entry.id}`) as LaneId,
		title: entry.title,
		workspacePath: workspacePath(entry.workspacePath),
		branch: null,
		baseCommit: null,
		headCommit: null,
		targetBranch: null,
		createdAt: Date.now(),
		status: 'active',
		origin: 'manual',
		agentState: 'idle',
		openFiles: [],
		activeFile: null,
		surface: 'gui',
		sessionId: null,
		recoveryState: 'registered',
		archiveReason: null,
		archivedAt: null,
		recoveredAt: null,
		kind: 'lab',
		labPrototypeId: entry.id,
		closedAt: null,
		titleLocked: false,
		agentSummary: null,
		agentSummaryAt: null
	};
}

export const agentLanes = new AgentLaneService();
