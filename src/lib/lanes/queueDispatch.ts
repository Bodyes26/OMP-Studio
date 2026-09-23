// Routing deterministico della coda task verso le corsie (Gate R27 / PLAN W09).
//
// Decisioni pure, senza rune ne' Tauri: la coda deve poter essere verificata
// dagli smoke test con il solo type-stripping di Node.
//
// Invarianti difese qui:
// 1. La coda `.omp/tasks.json` vive soltanto nella radice canonica del
//    progetto: nessuna corsia worktree legge o scrive una coda locale.
// 2. Click su un task: `Principale` libera -> `Principale`; `Principale` al
//    lavoro -> prompt esplicito. `Shift` + click -> nuova corsia senza dialog.
// 3. La corsia visibile non riceve task per osmosi: il bersaglio e' sempre
//    `Principale` oppure una corsia creata apposta per quel task.
// 4. Auto-dispatch: un solo slot worktree automatico per progetto, occupato
//    fino ad archiviazione (integrazione o rifiuto). Corsie manuali attive
//    mettono in pausa l'auto-avvio.
// 5. Soft-cap: dal terzo agente simultaneo la creazione richiede conferma.

import { normalizeProjectPath } from '$lib/utils/paths';
import { MAIN_LANE_ID, type LaneOrigin, type LaneStatus } from '$lib/types/lanes';

/** Agenti simultanei oltre i quali la creazione chiede conferma esplicita. */
export const CONCURRENCY_SOFT_CAP = 2;

export interface LaneDispatchSnapshot {
	laneId: string;
	title: string;
	origin: LaneOrigin;
	status: LaneStatus;
	/** L'agente della corsia sta lavorando o attende una risposta. */
	busy: boolean;
	/** Un processo omp e' vivo in questa corsia (PTY o RPC). */
	liveProcess?: boolean;
	model?: { provider?: string | null; id?: string | null } | null;
}

export interface QueueRouteInput {
	/** `Shift` + click: nuova corsia isolata senza passare dal dialog. */
	shiftKey?: boolean;
	lanes: readonly LaneDispatchSnapshot[];
	/** Il progetto ha una radice canonica su cui creare worktree. */
	worktreeCapable: boolean;
}

export type QueueRoute =
	| { kind: 'main' }
	| { kind: 'new-lane'; confirmConcurrency: boolean }
	| { kind: 'prompt'; confirmConcurrency: boolean }
	| { kind: 'blocked'; reason: 'no-worktree-support' };

export type AutoDispatchHold =
	| 'auto-slot-busy'
	| 'manual-lanes-active'
	| 'no-worktree-support';

export type AutoDispatchDecision =
	| { kind: 'main' }
	| { kind: 'new-lane' }
	| { kind: 'wait'; reason: AutoDispatchHold };

export interface ConcurrencyWarning {
	/** Agenti gia' attivi, quello in arrivo escluso. */
	activeAgents: number;
	lanes: Array<{ title: string; model: string | null; liveProcess: boolean }>;
}

export interface QueueRootResolution {
	path: string | null;
	/** La richiesta puntava a un workspace diverso dalla radice canonica. */
	redirected: boolean;
}

function isLaneActive(lane: LaneDispatchSnapshot): boolean {
	return lane.status !== 'archived';
}

/** Corsie che tengono impegnato un agente: le archiviate non contano. */
export function activeLanes(
	lanes: readonly LaneDispatchSnapshot[]
): LaneDispatchSnapshot[] {
	return lanes.filter(isLaneActive);
}

export function isMainBusy(lanes: readonly LaneDispatchSnapshot[]): boolean {
	const main = lanes.find((lane) => lane.laneId === MAIN_LANE_ID);
	return main?.busy === true;
}

/**
 * La coda e' una proprieta' del progetto, non della corsia. Il percorso di un
 * worktree non puo' diventare la chiave della coda: sarebbe un secondo
 * `.omp/tasks.json` dentro la cartella sorella, invisibile alla Principale.
 */
export function resolveQueueRoot(
	project: { canonicalProjectPath: string | null },
	requestedPath?: string | null
): QueueRootResolution {
	const canonical = project.canonicalProjectPath?.trim() ? project.canonicalProjectPath : null;
	if (!canonical) return { path: null, redirected: false };
	if (!requestedPath || !requestedPath.trim()) return { path: canonical, redirected: false };
	const redirected =
		normalizeProjectPath(requestedPath).toLowerCase() !==
		normalizeProjectPath(canonical).toLowerCase();
	return { path: canonical, redirected };
}

/** Vero quando l'agente in arrivo sarebbe il terzo (o oltre) del progetto. */
export function shouldWarnConcurrency(activeAgentCount: number): boolean {
	return activeAgentCount >= CONCURRENCY_SOFT_CAP;
}

function formatModel(lane: LaneDispatchSnapshot): string | null {
	const provider = lane.model?.provider?.trim() || '';
	const id = lane.model?.id?.trim() || '';
	if (provider && id) return `${provider}/${id}`;
	return id || provider || null;
}

/**
 * Riepilogo mostrato prima di superare il soft-cap: modelli/provider impegnati
 * e corsie con un processo omp ancora vivo.
 */
export function buildConcurrencyWarning(
	lanes: readonly LaneDispatchSnapshot[]
): ConcurrencyWarning {
	const active = activeLanes(lanes);
	return {
		activeAgents: active.length,
		lanes: active.map((lane) => ({
			title: lane.title,
			model: formatModel(lane),
			liveProcess: lane.liveProcess === true
		}))
	};
}

/**
 * Click (o `Shift` + click) su un task in coda.
 *
 * Il bersaglio non dipende mai dalla corsia visibile: o `Principale`, o una
 * corsia nuova. Una corsia secondaria gia' aperta non riceve un task che
 * l'utente non le ha assegnato esplicitamente.
 */
export function decideQueueRoute(input: QueueRouteInput): QueueRoute {
	const active = activeLanes(input.lanes);
	const confirmConcurrency = shouldWarnConcurrency(active.length);

	if (input.shiftKey) {
		if (!input.worktreeCapable) return { kind: 'blocked', reason: 'no-worktree-support' };
		return { kind: 'new-lane', confirmConcurrency };
	}
	if (!isMainBusy(active)) return { kind: 'main' };
	if (!input.worktreeCapable) return { kind: 'blocked', reason: 'no-worktree-support' };
	return { kind: 'prompt', confirmConcurrency };
}

/**
 * Auto-dispatch del primo task in coda.
 *
 * Con `Principale` occupata nasce al massimo **una** corsia worktree
 * automatica: finche' quella corsia non viene archiviata (integrata o
 * rifiutata) i task restanti aspettano. Le corsie create a mano sospendono
 * del tutto l'auto-avvio: l'utente sta gia' governando la concorrenza.
 */
export function decideAutoDispatch(input: QueueRouteInput): AutoDispatchDecision {
	const active = activeLanes(input.lanes);
	if (!isMainBusy(active)) return { kind: 'main' };
	if (!input.worktreeCapable) return { kind: 'wait', reason: 'no-worktree-support' };

	const secondary = active.filter((lane) => lane.laneId !== MAIN_LANE_ID);
	if (secondary.some((lane) => lane.origin === 'manual')) {
		return { kind: 'wait', reason: 'manual-lanes-active' };
	}
	if (secondary.some((lane) => lane.origin === 'auto')) {
		return { kind: 'wait', reason: 'auto-slot-busy' };
	}
	return { kind: 'new-lane' };
}
