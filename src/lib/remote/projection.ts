/**
 * Proiezione pura dello stato di Studio in HostState ($remote-protocol, Gate R44).
 *
 * Mappa le strutture interne di Studio (progetti, corsie, sessioni, richieste di
 * attenzione, task e quote) nel contratto condiviso con relay e PWA.
 * Modulo puro: nessun effetto collaterale o chiamata a store reattivi.
 */

import type {
	HostState,
	RemoteProject,
	RemoteLane,
	RemoteAgent,
	RemoteAttention,
	RemoteAskQuestion,
	RemoteChatLine,
	RemoteTask,
	RemoteTaskSchedule,
	RemoteTaskStatus,
	RemoteQuota,
	RemoteQuotaProvider,
	RemoteQuotaWindow,
	RemoteAgentState,
	RemoteTheme,
	RemoteSessionSnapshot
} from '$remote-protocol';
import { resolveActiveRole } from '$lib/stores/modelSettingsHelpers';
import { taskLabel } from '$lib/stores/taskTitle';
import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
import type { StudioTask } from '$lib/stores/tasks.svelte';
import type { QuotaReport, QuotaLimit } from '$lib/stores/quota.svelte';

export interface ProjectInput {
	id: string;
	name: string;
	canonicalProjectPath?: string | null;
	hue?: number;
	autoDispatch?: boolean;
}

export interface LaneInput {
	projectId: string;
	laneId: string;
	title?: string;
	surface?: 'gui' | 'terminal';
	kind?: 'main' | 'worktree' | 'lab' | 'git';
	agentState?: RemoteAgentState | string;
}

export interface SessionInput {
	isOpen?: boolean;
	exited?: boolean;
	backgroundPending?: boolean;
	agentState?: string;
	surface?: 'gui' | 'terminal' | null;
	model?: { provider?: string; id?: string; name?: string } | null;
	activityLine?: { text: string; at: number; kind: 'intent' | 'assistant' } | null;
	activity?: { text: string; at: number; kind: 'intent' | 'assistant' } | null;
	headsUp?: { text: string } | string | null;
	thinkingLevel?: string | null;
	lastPickedRole?: string | null;
	role?: string | null;
	context?: RemoteAgent['context'];
	session?: RemoteSessionSnapshot | null;
}
export interface ScheduleTargetOutput {
	dueAt?: number;
	provider?: string;
}

export interface BuildHostStateInput {
	projects: ProjectInput[];
	activeProjectId?: string | null;
	lanes?: LaneInput[];
	lanesForProject?: (projectId: string) => LaneInput[];
	sessions?:
		| Map<string, SessionInput>
		| ((projectId: string, laneId: string) => SessionInput | undefined);
	runtimes?: CompanionProjectRuntime[];
	attentionRequests?: AttentionRequest[];
	tasks?: StudioTask[];
	tasksForProject?: (project: ProjectInput) => StudioTask[];
	resolveScheduleTarget?: (task: StudioTask) => ScheduleTargetOutput | undefined;
	scheduleTargets?: Map<string, ScheduleTargetOutput>;
	candidateTaskIdForProject?: (projectId: string) => string | null | undefined;
	nextCandidateTaskIds?: Set<string> | Map<string, string>;
	quotaReports?: QuotaReport[];
	quotaFetchedAt?: number | null;
	theme?: RemoteTheme | null;
	rolesMap?: Readonly<Record<string, string>>;
	knownSelectors?: ReadonlySet<string>;
}
export function mapAgentState(session?: SessionInput | null): RemoteAgentState {
	if (!session || session.isOpen === false || session.exited === true) {
		return 'offline';
	}
	if (session.backgroundPending) {
		return 'background';
	}
	switch (session.agentState) {
		case 'attention':
			return 'attention';
		case 'working':
			return 'working';
		case 'idle':
			return 'idle';
		case 'error':
			return 'error';
		case 'offline':
			return 'offline';
		default:
			return 'idle';
	}
}

function resolveSession(
	inputSessions: BuildHostStateInput['sessions'],
	projectId: string,
	laneId: string
): SessionInput | undefined {
	if (!inputSessions) return undefined;
	if (typeof inputSessions === 'function') {
		return inputSessions(projectId, laneId);
	}
	return inputSessions.get(`${projectId}:${laneId}`);
}

function resolveLanes(input: BuildHostStateInput, projectId: string): LaneInput[] {
	if (input.lanesForProject) {
		return input.lanesForProject(projectId);
	}
	if (input.lanes) {
		return input.lanes.filter((l) => l.projectId === projectId);
	}
	return [];
}

function mapLanes(
	project: ProjectInput,
	lanes: LaneInput[],
	inputSessions: BuildHostStateInput['sessions'],
	runtime?: CompanionProjectRuntime,
	rolesMap?: Readonly<Record<string, string>>,
	knownSelectors?: ReadonlySet<string>
): RemoteLane[] {
	// Assicura che esista almeno la corsia principale
	const hasMain = lanes.some((l) => l.laneId === 'main');
	const allLanes: LaneInput[] = hasMain
		? [...lanes]
		: [{ projectId: project.id, laneId: 'main', kind: 'main', title: 'Principale' }, ...lanes];

	// Ordina mettendo la Principale per prima
	allLanes.sort((a, b) => {
		if (a.laneId === 'main') return -1;
		if (b.laneId === 'main') return 1;
		return 0;
	});

	return allLanes.map((lane): RemoteLane => {
		const isMain = lane.laneId === 'main';
		const id = isMain ? 'main' : lane.laneId;
		const kind: 'main' | 'worktree' | 'lab' = isMain
			? 'main'
			: lane.kind === 'lab'
				? 'lab'
				: 'worktree';
		const title = isMain
			? lane.title || 'Principale'
			: lane.title || lane.laneId;

		const session = resolveSession(inputSessions, project.id, lane.laneId);
		let agentState = mapAgentState(session);
		// Se non c'e' una sessione GUI ma la corsia e' su terminale, usa lo stato runtime terminale
		if (agentState === 'offline' && lane.surface === 'terminal' && lane.agentState && lane.agentState !== 'unknown') {
			agentState = mapAgentState({
				isOpen: lane.agentState !== 'offline',
				agentState: lane.agentState,
				surface: 'terminal'
			});
		}
		// Provider, modello, attivita' e headsUp
		let provider: string | null = null;
		let modelId: string | null = null;
		let modelLabel: string | null = null;
		let activity: { text: string; at: number; kind: 'intent' | 'assistant' } | null = null;
		let headsUp: string | null = null;

		if (isMain) {
			provider = runtime?.provider ?? session?.model?.provider ?? null;
			modelId = runtime?.modelId ?? session?.model?.id ?? null;
			modelLabel = runtime?.modelLabel ?? session?.model?.name ?? null;
			if (runtime?.activity) {
				activity = {
					text: runtime.activity.text,
					at: runtime.activity.at,
					kind: runtime.activity.kind
				};
			} else if (session?.activityLine) {
				activity = {
					text: session.activityLine.text,
					at: session.activityLine.at,
					kind: session.activityLine.kind
				};
			} else if (session?.activity) {
				activity = {
					text: session.activity.text,
					at: session.activity.at,
					kind: session.activity.kind
				};
			}
			if (runtime?.headsUp) {
				headsUp = runtime.headsUp;
			} else if (session?.headsUp) {
				headsUp = typeof session.headsUp === 'string' ? session.headsUp : session.headsUp.text;
			}
		} else {
			provider = session?.model?.provider ?? null;
			modelId = session?.model?.id ?? null;
			modelLabel = session?.model?.name ?? session?.model?.id ?? null;
			if (session?.activityLine) {
				activity = {
					text: session.activityLine.text,
					at: session.activityLine.at,
					kind: session.activityLine.kind
				};
			} else if (session?.activity) {
				activity = {
					text: session.activity.text,
					at: session.activity.at,
					kind: session.activity.kind
				};
			}
			if (session?.headsUp) {
				headsUp = typeof session.headsUp === 'string' ? session.headsUp : session.headsUp.text;
			}
		}

		const surface = lane.surface ?? (session?.surface ?? null);
		const isTerminal = surface === 'terminal';
		let role: string | null = null;
		let thinkingLevel: string | null = null;

		if (!isTerminal) {
			if (session?.role !== undefined) {
				role = session.role;
			} else if (rolesMap) {
				const effectiveModel =
					session?.model ??
					(modelId ? { provider: provider ?? undefined, id: modelId } : null);
				role = resolveActiveRole(
					rolesMap,
					effectiveModel,
					session?.thinkingLevel,
					session?.lastPickedRole,
					knownSelectors
				);
			}
			thinkingLevel = session?.thinkingLevel ?? null;
		}

		const agent: RemoteAgent = {
			state: agentState,
			surface,
			provider,
			modelId,
			modelLabel,
			activity,
			headsUp,
			role,
			thinkingLevel,
			context: isTerminal ? null : session?.context ?? null
		};
		return {
			id,
			title,
			kind,
			agent,
			...(session && 'session' in session ? { session: session.session } : {})
		};
	});
}

function mapAttention(requests: AttentionRequest[], projectId: string): RemoteAttention[] {
	const projectRequests = requests.filter((r) => r.projectId === projectId);
	return projectRequests.map((req): RemoteAttention => {
		const pending = req.pendingUi;
		let method: 'ask' | 'select' | 'confirm' | 'input' | 'editor' = 'select';
		if (pending.method) {
			method = pending.method;
		} else if (pending.blockedQuota) {
			method = 'confirm';
		} else if (Array.isArray(pending.questions) && pending.questions.length > 0) {
			method = 'ask';
		}

		const options = Array.isArray(pending.options)
			? pending.options.map((label, idx) => ({
					label: String(label),
					description: pending.optionDetails?.[idx]?.description ?? null
				}))
			: [];

		const questions: RemoteAskQuestion[] = Array.isArray(pending.questions)
			? pending.questions.map((q: unknown) => {
					const obj = q && typeof q === 'object' ? (q as Record<string, unknown>) : {};
					const rawOptions = Array.isArray(obj.options) ? obj.options : [];
					return {
						id: String(obj.id ?? ''),
						question: String(obj.question ?? ''),
						header: typeof obj.header === 'string' ? obj.header : null,
						options: rawOptions.map((opt: unknown) => {
							if (typeof opt === 'string') return { label: opt, description: null };
							const optObj = opt && typeof opt === 'object' ? (opt as Record<string, unknown>) : {};
							return {
								label: String(optObj.label ?? ''),
								description: typeof optObj.description === 'string' ? optObj.description : null
							};
						}),
						multi: Boolean(obj.multi),
						recommended: typeof obj.recommended === 'number' ? obj.recommended : null
					};
				})
			: [];

		const quotaBlocked = pending.blockedQuota
			? {
					reason:
						pending.blockedQuota.reasonKind === 'provider_error'
							? ('provider_error' as const)
							: ('quota_exhausted' as const),
					provider: pending.blockedQuota.failedProvider ?? null,
					modelId: pending.blockedQuota.failedModelId ?? null
				}
			: null;

		const recentMessages: RemoteChatLine[] = Array.isArray(req.recentMessages)
			? req.recentMessages.map((m) => ({
					role: m.role,
					text: m.text,
					timestamp: typeof m.timestamp === 'number' ? m.timestamp : null
				}))
			: [];

		return {
			requestId: pending.requestId,
			laneId: req.laneId ?? null,
			laneTitle: req.laneTitle ?? null,
			method,
			title: pending.title ?? '',
			message: pending.message ?? null,
			options,
			placeholder: pending.placeholder ?? null,
			prefill: pending.prefill ?? null,
			questions,
			deadline: typeof pending.deadline === 'number' ? pending.deadline : null,
			quotaBlocked,
			recentMessages
		};
	});
}

function resolveTasks(input: BuildHostStateInput, project: ProjectInput): StudioTask[] {
	if (input.tasksForProject) {
		return input.tasksForProject(project);
	}
	if (!input.tasks) return [];
	const norm = (project.canonicalProjectPath ?? '').replace(/\\/g, '/').toLowerCase();
	return input.tasks.filter((t) => {
		const tNorm = (t.projectPath ?? '').replace(/\\/g, '/').toLowerCase();
		return tNorm === norm || t.projectPath === project.id;
	});
}

function resolveNextCandidateTaskId(
	input: BuildHostStateInput,
	projectId: string
): string | null {
	if (input.candidateTaskIdForProject) {
		return input.candidateTaskIdForProject(projectId) ?? null;
	}
	if (input.nextCandidateTaskIds instanceof Set) {
		// Non indicizzato per progetto, ma potremmo cercarlo
		return null;
	}
	if (input.nextCandidateTaskIds instanceof Map) {
		return input.nextCandidateTaskIds.get(projectId) ?? null;
	}
	return null;
}


function mapTasks(
	projectTasks: StudioTask[],
	input: BuildHostStateInput,
	projectId: string
): RemoteTask[] {
	// Filtra solo task attivi: queued, dispatching, in_progress
	const activeTasks = projectTasks.filter(
		(t) => t.status === 'queued' || t.status === 'dispatching' || t.status === 'in_progress'
	);

	// Ordina per coda
	activeTasks.sort(
		(a, b) => a.position - b.position || (a.createdAt ?? 0) - (b.createdAt ?? 0)
	);

	const nextCandidateTaskId = resolveNextCandidateTaskId(input, projectId);

	return activeTasks.map((t): RemoteTask => {
		const rawTitle = taskLabel(t) || '';
		const prompt = t.prompt.length > 4000 ? t.prompt.slice(0, 4000) : t.prompt;
		const status = t.status as RemoteTaskStatus;
		const resume = Boolean(t.resume);
		const next = nextCandidateTaskId
			? t.id === nextCandidateTaskId
			: input.nextCandidateTaskIds instanceof Set
				? input.nextCandidateTaskIds.has(t.id)
				: false;

		let schedule: RemoteTaskSchedule | null = null;
		if (t.schedule) {
			const target = input.resolveScheduleTarget
				? input.resolveScheduleTarget(t)
				: input.scheduleTargets?.get(t.id);

			schedule = {
				kind: t.schedule.kind,
				provider: target?.provider ?? t.schedule.provider ?? null,
				notBefore: target?.dueAt ?? t.schedule.notBefore ?? null,
				missed: Boolean(t.schedule.missed)
			};
		}

		return {
			id: t.id,
			title: rawTitle,
			prompt,
			status,
			position: t.position,
			schedule,
			resume,
			next
		};
	});
}

function mapQuotaLimit(limit: QuotaLimit): RemoteQuotaWindow {
	let usedFraction: number | null = null;
	if (typeof limit.amount?.usedFraction === 'number' && Number.isFinite(limit.amount.usedFraction)) {
		usedFraction = Math.max(0, Math.min(1, limit.amount.usedFraction));
	} else if (
		typeof limit.amount?.remainingFraction === 'number' &&
		Number.isFinite(limit.amount.remainingFraction)
	) {
		usedFraction = Math.max(0, Math.min(1, 1 - limit.amount.remainingFraction));
	}

	const resetsAt = limit.window?.resetsAt ?? limit.resetsAt ?? null;

	return {
		id: limit.id,
		label: limit.label || limit.id,
		usedFraction,
		resetsAt
	};
}

function mapQuota(reports?: QuotaReport[], fetchedAt?: number | null): RemoteQuota | null {
	if (!reports || reports.length === 0) return null;

	const providers: RemoteQuotaProvider[] = reports.map((report) => {
		const windows = (report.limits || []).map(mapQuotaLimit);
		let status: 'ok' | 'warning' | 'exhausted' | 'unknown' = 'unknown';

		if (windows.length > 0) {
			const hasExhausted = (report.limits || []).some((l) => {
				if (l.status === 'exhausted') return true;
				const used =
					typeof l.amount?.usedFraction === 'number'
						? l.amount.usedFraction
						: typeof l.amount?.remainingFraction === 'number'
							? 1 - l.amount.remainingFraction
							: null;
				return used !== null && used >= 0.999;
			});

			if (hasExhausted) {
				status = 'exhausted';
			} else {
				const hasWarning = (report.limits || []).some((l) => {
					if (l.status === 'warning') return true;
					const used =
						typeof l.amount?.usedFraction === 'number'
							? l.amount.usedFraction
							: typeof l.amount?.remainingFraction === 'number'
								? 1 - l.amount.remainingFraction
								: null;
					return used !== null && used >= 0.7;
				});
				status = hasWarning ? 'warning' : 'ok';
			}
		}

		const meta = report.metadata;
		const account =
			[meta?.email, meta?.orgName, meta?.accountId].find(
				(value): value is string => typeof value === 'string' && value.trim() !== ''
			) ?? null;

		return {
			provider: report.provider,
			account,
			status,
			windows
		};
	});

	return {
		fetchedAt: typeof fetchedAt === 'number' ? fetchedAt : null,
		providers
	};
}

/**
 * Costruisce l'istantanea pura HostState per il relay da tutti i dati disponibili.
 */
export function buildHostState(input: BuildHostStateInput): HostState {
	const projects: RemoteProject[] = input.projects.map((p) => {
		const runtime = input.runtimes?.find((r) => r.projectId === p.id);
		const lanes = resolveLanes(input, p.id);
		const remoteLanes = mapLanes(
			p,
			lanes,
			input.sessions,
			runtime,
			input.rolesMap,
			input.knownSelectors
		);
		const attention = mapAttention(input.attentionRequests || [], p.id);
		const tasks = mapTasks(resolveTasks(input, p), input, p.id);

		return {
			id: p.id,
			name: p.name,
			hue: typeof p.hue === 'number' ? p.hue : 0,
			active: Boolean(input.activeProjectId && p.id === input.activeProjectId),
			lanes: remoteLanes,
			attention,
			tasks,
			autoDispatch: Boolean(p.autoDispatch),
			canRunTask: runtime?.canRunTask ?? false,
			runBlockReason: runtime?.runBlockReason ?? null
		};
	});

	const quota = mapQuota(input.quotaReports, input.quotaFetchedAt);

	return {
		projects,
		quota,
		theme: input.theme ?? null
	};
}
