// Decisioni pure sulla pulizia delle corsie Git: cosa si perde eliminando un
// branch di corsia e in che stato riportare una corsia rimasta a meta'
// integrazione. Il trasporto (invoke di Tauri) arriva come parametro, cosi'
// gli smoke test lo sostituiscono con un mock senza caricare il runtime.

import { m } from '$lib/paraglide/messages.js';

export type LaneCommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Risposta di `worktree_lane_unintegrated_summary`. */
export interface LaneUnintegratedSummary {
	branchExists: boolean;
	integrated: boolean;
	commits: number;
	files: number;
}

/** Risposta di `worktree_lane_integration_state`. */
export interface LaneIntegrationState {
	branchExists: boolean;
	integrated: boolean;
}

/** Lavoro che l'eliminazione cancellerebbe per sempre. */
export interface LaneUnintegratedLoss {
	commits: number;
	files: number;
}

/**
 * Messaggio leggibile di un errore dei comandi worktree. Il backend serializza
 * `{ code, message, detail }`: trattarlo come `Error` o stringa faceva vedere
 * solo il testo di ripiego e perdeva, per esempio, il messaggio di `GitTooOld`.
 */
export function worktreeErrorMessage(error: unknown, fallback: string): string {
	if (typeof error === 'object' && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message;
	}
	if (typeof error === 'string' && error.trim()) return error;
	return fallback;
}

/** Codice dell'errore nativo (`confirmation_required`, `git_too_old`, ...), se presente. */
export function worktreeErrorCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' && code ? code : null;
}

/**
 * Il backend ha rifiutato di cancellare il branch perche' non riconosce il
 * lavoro come integrato, anche se il riepilogo diceva il contrario (per
 * esempio una ricevuta rimasta dopo un reset del target): serve il consenso.
 */
export function needsDiscardConsent(error: unknown): boolean {
	const code = worktreeErrorCode(error);
	return code === 'confirmation_required' || code === 'lane_diverged_after_integrate';
}

/** Perdita di entita' sconosciuta: il backend rifiuta ma non si sa quanto. */
export const UNKNOWN_LOSS: LaneUnintegratedLoss = { commits: 0, files: 0 };

/** Testo dell'avviso nel dialogo di eliminazione. */
export function unintegratedWarning(loss: LaneUnintegratedLoss): string {
	return loss.commits > 0
		? m.lane_delete_unintegrated_warning({ commits: loss.commits, files: loss.files })
		: m.lane_delete_unintegrated_warning_unknown();
}

/**
 * Solo un branch esistente, mai integrato e con commit propri porta con se'
 * lavoro irrecuperabile. Un branch senza commit propri si elimina senza avviso.
 */
export function unintegratedLoss(summary: LaneUnintegratedSummary | null): LaneUnintegratedLoss | null {
	if (!summary || !summary.branchExists || summary.integrated) return null;
	if (!Number.isFinite(summary.commits) || summary.commits <= 0) return null;
	return {
		commits: summary.commits,
		files: Number.isFinite(summary.files) && summary.files > 0 ? summary.files : 0
	};
}

/**
 * Legge il riepilogo del lavoro non integrato. `null` quando non e' leggibile:
 * in quel caso la conferma resta quella normale e la protezione la fa il
 * backend, che rifiuta di cancellare commit mai integrati senza consenso.
 */
export async function fetchUnintegratedLoss(
	invoke: LaneCommandInvoker,
	projectPath: string,
	laneId: string
): Promise<LaneUnintegratedLoss | null> {
	try {
		const summary = await invoke<LaneUnintegratedSummary>('worktree_lane_unintegrated_summary', {
			args: { projectPath, laneId }
		});
		return unintegratedLoss(summary);
	} catch {
		return null;
	}
}

/** Argomenti di `worktree_delete_lane_branch`: il consenso alla perdita c'e' solo se dato. */
export function laneBranchDeleteArgs(
	projectPath: string,
	laneId: string,
	discardUnintegrated: boolean
): Record<string, unknown> {
	const args: Record<string, unknown> = { projectPath, laneId, confirm: true };
	if (discardUnintegrated) args.discardUnintegrated = true;
	return { args };
}

export type StuckIntegrationResolution = 'integrated' | 'review_ready';

/**
 * Una corsia trovata in `integrating` all'avvio e' rimasta a meta': Studio e'
 * stato chiuso fra la scrittura dello stato e l'esito di `worktree_land`, o la
 * pulizia successiva non e' riuscita. Git dice se il merge c'e' stato; senza
 * risposta la corsia torna rivedibile, mai bloccata.
 */
export async function resolveStuckIntegration(
	invoke: LaneCommandInvoker,
	projectPath: string | null,
	laneId: string
): Promise<StuckIntegrationResolution> {
	if (!projectPath) return 'review_ready';
	try {
		const state = await invoke<LaneIntegrationState>('worktree_lane_integration_state', {
			args: { projectPath, laneId }
		});
		return state?.integrated === true ? 'integrated' : 'review_ready';
	} catch {
		return 'review_ready';
	}
}

export interface InterruptedIntegration {
	projectId: string;
	laneId: string;
}

interface IntegratingLaneLike {
	projectId: string;
	laneId: string;
	status: string;
	kind?: 'git' | 'lab';
}

/**
 * Ripara all'avvio le corsie rimaste in `integrating`. Tutte tornano a
 * `review_ready` (cosi' restano rivedibili anche se la pulizia fallisce);
 * quelle che Git da' per integrate vanno poi chiuse come dopo un'integrazione
 * riuscita (archiviazione 'integrated' e cancellazione del branch), compito
 * che resta a chi chiama perche' tocca il disco.
 */
export async function recoverInterruptedIntegrations<L extends IntegratingLaneLike>(
	lanes: readonly L[],
	projectPathOf: (projectId: string) => string | null,
	invoke: LaneCommandInvoker
): Promise<{ lanes: L[]; changed: boolean; integrated: InterruptedIntegration[] }> {
	const integrated: InterruptedIntegration[] = [];
	let changed = false;
	const next: L[] = [];
	for (const lane of lanes) {
		if (lane.status !== 'integrating' || lane.kind === 'lab') {
			next.push(lane);
			continue;
		}
		const resolution = await resolveStuckIntegration(
			invoke,
			projectPathOf(lane.projectId),
			lane.laneId
		);
		if (resolution === 'integrated') {
			integrated.push({ projectId: lane.projectId, laneId: lane.laneId });
		}
		next.push({ ...lane, status: 'review_ready' });
		changed = true;
	}
	return { lanes: next, changed, integrated };
}
