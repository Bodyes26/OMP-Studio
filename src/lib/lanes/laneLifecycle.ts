// Ciclo di vita delle corsie: chiusura (reversibile), riapertura, eliminazione
// definitiva del worktree e listing unificato delle corsie chiuse (Git e Lab).
// Invarianti:
// 1. Chiusura (closeLane): arresta sessione e processi, imposta status 'closed'
//    e closedAt, torna a Principale se attiva; per Lab sincronizza l'indice.
// 2. Riapertura (reopenLane): riporta lo status ad 'active', azzera closedAt e fa lo switch.
// 3. Eliminazione (deleteWorktreeLane): rimuove worktree e branch; archivia solo
//    se entrambi hanno successo, altrimenti lascia la corsia recuperabile (cleanup_pending).
//    Commit mai integrati si cancellano solo col consenso esplicito (discardUnintegrated).
// 4. Eliminazione prototipo (deleteLabPrototype): chiude la corsia o la tessera bozza,
//    poi cancella workspace e voce d'indice; se il workspace resta bloccato la voce resta.

import { invoke } from '@tauri-apps/api/core';
import {
	MAIN_LANE_ID,
	createMainLane,
	laneId,
	type LaneId,
	type ProjectId
} from '$lib/types/lanes';
import { laneStore } from '$lib/stores/lanes.svelte';
import type { LaneRecord } from '$lib/stores/lanePersistence';
import { projectStore, type Project } from '$lib/stores/projects.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { laneOrchestrator } from './laneOrchestrator.svelte';
import { openLabEntry } from './laneActions';
import { labApi } from '$lib/lab/api';
import { settingsStore } from '$lib/stores/settings.svelte';
import { m } from '$lib/paraglide/messages.js';
import {
	fetchUnintegratedLoss,
	laneBranchDeleteArgs,
	needsDiscardConsent,
	UNKNOWN_LOSS,
	worktreeErrorMessage,
	type LaneUnintegratedLoss
} from './laneCleanup';
import {
	classifyWorktreeRemovalError,
	laneProcessesFor,
	listLaneProcesses,
	stopLaneProcesses,
	type LaneProcessInfo
} from './processSupervisor';

export type ClosedLaneEntry =
	| { kind: 'git'; projectId: ProjectId; laneId: LaneId; title: string; closedAt: number }
	| { kind: 'lab'; projectId: ProjectId; laneId: LaneId; prototypeId: string; title: string; closedAt: number };

export type CloseLaneOutcome = { kind: 'closed' } | { kind: 'failed'; message: string };

export type DeleteLaneOutcome =
	| { kind: 'deleted' }
	| { kind: 'processes-active'; processes: LaneProcessInfo[] }
	/** Il branch ha commit mai integrati e manca il consenso a perderli: nulla e' stato toccato. */
	| { kind: 'unintegrated'; loss: LaneUnintegratedLoss }
	| { kind: 'failed'; message: string };

export type { LaneUnintegratedLoss };

export type DeleteLabOutcome = { kind: 'deleted' } | { kind: 'failed'; message: string };

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Elenca le corsie chiuse (Git e Lab) ordinate per data di chiusura decrescente.
 * Le corsie Lab compaiono solo se labAlphaEnabled e' attivo e il progetto ha radice canonica.
 * I prototipi gia' aperti come tab (status non closed/archived) sono esclusi.
 */
export async function listClosedLanes(project: Project): Promise<ClosedLaneEntry[]> {
	const results: ClosedLaneEntry[] = [];
	const ownerProjectId = project.id as ProjectId;
	const projectLanes = laneStore.lanesFor(ownerProjectId);

	// 1. Corsie Git chiuse
	for (const lane of projectLanes) {
		if (lane.kind !== 'lab' && lane.status === 'closed' && lane.laneId !== MAIN_LANE_ID) {
			results.push({
				kind: 'git',
				projectId: ownerProjectId,
				laneId: lane.laneId,
				title: lane.title,
				closedAt: lane.closedAt ?? lane.createdAt ?? 0
			});
		}
	}

	// 2. Corsie Lab chiuse / non ancora aperte
	if (settingsStore.general.labAlphaEnabled && project.canonicalProjectPath) {
		try {
			const indexEntries = await labApi.listIndex(project.canonicalProjectPath);
			for (const entry of indexEntries) {
				// Verifica se esiste gia' una corsia aperta per questo prototipo
				const openLane = projectLanes.find(
					(l) =>
						l.kind === 'lab' &&
						(l.labPrototypeId === entry.id || l.laneId === `lab-${entry.id}`) &&
						l.status !== 'closed' &&
						l.status !== 'archived'
				);
				if (openLane) {
					// Gia' aperto come tab: non elencare
					continue;
				}

				const matchingLane = projectLanes.find(
					(l) =>
						l.kind === 'lab' &&
						(l.labPrototypeId === entry.id || l.laneId === `lab-${entry.id}`)
				);

				const closedAtMs =
					matchingLane?.closedAt ??
					(Date.parse(entry.closedAt ?? '') ||
						Date.parse(entry.updatedAt) ||
						Date.parse(entry.createdAt) ||
						0);

				results.push({
					kind: 'lab',
					projectId: ownerProjectId,
					laneId: matchingLane?.laneId ?? laneId(`lab-${entry.id}`),
					prototypeId: entry.id,
					title: matchingLane?.title ?? entry.title,
					closedAt: closedAtMs
				});
			}
		} catch (err) {
			console.warn('[listClosedLanes] Lettura indice Lab fallita:', err);
		}
	}

	// Ordina decrescente per closedAt (il piu' recente in cima)
	results.sort((a, b) => b.closedAt - a.closedAt);
	return results;
}

/**
 * Chiude ordinatamente una corsia (reversibile):
 * - arresta la sessione omp attiva (abort se in streaming);
 * - arresta i processi della corsia tramite il supervisore;
 * - imposta lo status 'closed' e closedAt;
 * - se attiva, riporta il progetto alla Principale;
 * - per corsie Lab, aggiorna anche lo status 'closed' nell'indice.
 */
export async function closeLane(
	projectId: ProjectId,
	targetLaneId: LaneId
): Promise<CloseLaneOutcome> {
	if (targetLaneId === MAIN_LANE_ID) {
		return { kind: 'failed', message: m.lane_error_close_main() };
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	const lane = laneStore.lanesFor(projectId).find((l) => l.laneId === targetLaneId);
	if (!lane) {
		return { kind: 'failed', message: m.lane_error_not_found() };
	}

	// 1. Dispone la sessione omp se presente
	const session = sessionRegistry.getLaneSession(projectId, targetLaneId);
	if (session) {
		if (session.isStreaming) {
			await session.abort().catch(() => undefined);
		}
		await sessionRegistry.disposeSession(session).catch(() => undefined);
	}

	// 2. Arresta i processi registrati della corsia
	try {
		await stopLaneProcesses(projectId, targetLaneId);
	} catch (err) {
		console.warn('[closeLane] Arresto processi fallito:', err);
	}

	// 3. Per le corsie Lab, aggiorna lo stato nell'indice
	if (lane.kind === 'lab' && lane.labPrototypeId && project?.canonicalProjectPath) {
		try {
			await labApi.updateIndex(project.canonicalProjectPath, lane.labPrototypeId, {
				status: 'closed'
			});
		} catch (err) {
			console.warn('[closeLane] Aggiornamento indice Lab fallito:', err);
		}
	}

	// 4. Aggiorna lo stato della corsia a 'closed'
	const now = Date.now();
	await laneStore.updateLane(projectId, targetLaneId, {
		status: 'closed',
		closedAt: now,
		agentState: 'idle'
	});

	// 5. Se la corsia chiusa era quella attiva, torna a Principale
	if (project && project.lane.laneId === targetLaneId) {
		const main = laneStore.lanesFor(projectId).find((l) => l.laneId === MAIN_LANE_ID);
		projectStore.setProjectLane(
			projectId,
			main ?? createMainLane(projectId, project.canonicalProjectPath, project.lane.surface)
		);
	}

	return { kind: 'closed' };
}

/**
 * Riapre una corsia precedentemente chiusa e la rende attiva:
 * - Git: status 'active', closedAt null, switch;
 * - Lab: aggiorna l'indice e usa openLabEntry.
 */
export async function reopenLane(project: Project, entry: ClosedLaneEntry): Promise<void> {
	if (entry.kind === 'git') {
		await laneStore.updateLane(entry.projectId, entry.laneId, {
			status: 'active',
			closedAt: null
		});
		await laneOrchestrator.switchLane(entry.projectId, entry.laneId);
		return;
	}

	// Corsia Lab: la voce viene dall'indice appena letto da listClosedLanes; se
	// nel frattempo e' sparita non c'e' nessun workspace da riaprire.
	if (!project.canonicalProjectPath) return;
	const list = await labApi.listIndex(project.canonicalProjectPath);
	const labEntry = list.find((item) => item.id === entry.prototypeId);
	if (!labEntry) return;
	await openLabEntry(project.id, labEntry);
}

/**
 * Lavoro che l'eliminazione della corsia cancellerebbe per sempre: commit del
 * branch mai integrati. Il dialogo di conferma lo legge prima di chiedere,
 * cosi' l'utente sa cosa perde. `null` = nulla da perdere o non verificabile.
 */
export async function inspectUnintegratedWork(
	ownerProjectId: ProjectId,
	targetLaneId: LaneId
): Promise<LaneUnintegratedLoss | null> {
	if (!isTauri() || targetLaneId === MAIN_LANE_ID) return null;
	const project = projectStore.projects.find((p) => p.id === ownerProjectId);
	if (!project?.canonicalProjectPath) return null;
	return await fetchUnintegratedLoss(
		(command, args) => invoke(command, args),
		project.canonicalProjectPath,
		targetLaneId
	);
}

/**
 * Elimina definitivamente un worktree secondario (aperto o chiuso):
 * 0. Senza `discardUnintegrated`, se il branch ha commit mai integrati non
 *    tocca nulla e restituisce `unintegrated`: il chiamante chiede il consenso;
 * 1. Rimozione cartella worktree (fallisce se processi attivi; idempotente se gia' sparita);
 * 2. Rimozione branch associato (confirm: true, discardUnintegrated se consentito);
 * 3. Archiviazione con reason 'rejected' solo al successo di entrambi;
 * Se uno dei passaggi fallisce, la corsia resta viva e recuperabile (cleanup_pending):
 * un nuovo tentativo riparte dal punto 1.
 */
export async function deleteWorktreeLane(
	ownerProjectId: ProjectId,
	targetLaneId: LaneId,
	options: { stopProcesses?: boolean; discardUnintegrated?: boolean } = {}
): Promise<DeleteLaneOutcome> {
	if (targetLaneId === MAIN_LANE_ID) {
		return { kind: 'failed', message: m.lane_error_delete_main() };
	}

	const lane = laneStore.lanesFor(ownerProjectId).find((l) => l.laneId === targetLaneId);
	if (!lane) {
		return { kind: 'failed', message: m.lane_error_not_found() };
	}

	const project = projectStore.projects.find((p) => p.id === ownerProjectId);
	const discardUnintegrated = options.discardUnintegrated === true;

	// 0. Il controllo precede la rimozione del worktree: rifiutare dopo,
	//    al momento del branch, lascerebbe una corsia senza cartella.
	if (!discardUnintegrated) {
		const loss = await inspectUnintegratedWork(ownerProjectId, targetLaneId);
		if (loss) return { kind: 'unintegrated', loss };
	}

	// 1. Rimuovi la cartella del worktree su disco
	if (isTauri() && project?.canonicalProjectPath && lane.workspacePath) {
		try {
			await invoke('worktree_remove', {
				args: {
					projectPath: project.canonicalProjectPath,
					worktreePath: lane.workspacePath,
					stopProcesses: options.stopProcesses === true
				}
			});
		} catch (error) {
			const diagnosis = classifyWorktreeRemovalError(error);
			if (diagnosis.failure === 'processes-active') {
				const processes = await listLaneProcesses()
					.then((list) => laneProcessesFor(list, ownerProjectId, targetLaneId))
					.catch(() => [] as LaneProcessInfo[]);
				return { kind: 'processes-active', processes };
			}
			if (lane.recoveryState !== 'cleanup_pending') {
				await laneStore.updateLane(ownerProjectId, targetLaneId, {
					recoveryState: 'cleanup_pending'
				});
			}
			return { kind: 'failed', message: diagnosis.message };
		}
	}

	// 2. Rimuovi il branch Git di corsia
	if (isTauri() && project?.canonicalProjectPath) {
		try {
			await invoke(
				'worktree_delete_lane_branch',
				laneBranchDeleteArgs(project.canonicalProjectPath, targetLaneId, discardUnintegrated)
			);
		} catch (err) {
			const errorMsg = worktreeErrorMessage(err, m.lane_error_branch_delete_failed());
			if (lane.recoveryState !== 'cleanup_pending') {
				await laneStore.updateLane(ownerProjectId, targetLaneId, {
					recoveryState: 'cleanup_pending'
				});
			}
			// Il riepilogo non aveva visto lavoro da perdere ma il backend si':
			// si chiede il consenso invece di lasciare la corsia bloccata.
			if (!discardUnintegrated && needsDiscardConsent(err)) {
				return { kind: 'unintegrated', loss: UNKNOWN_LOSS };
			}
			return { kind: 'failed', message: errorMsg };
		}
	}

	// 3. Dispone la sessione omp se ancora presente
	const session = sessionRegistry.getLaneSession(ownerProjectId, targetLaneId);
	if (session) {
		await sessionRegistry.disposeSession(session).catch(() => undefined);
	}

	// 4. Archiviazione con esito 'rejected'
	const now = Date.now();
	await laneStore.updateLane(ownerProjectId, targetLaneId, {
		status: 'archived',
		archiveReason: 'rejected',
		archivedAt: now,
		recoveryState: 'registered'
	});

	// 5. Se la corsia eliminata era attiva, torna a Principale
	if (project && project.lane.laneId === targetLaneId) {
		const main = laneStore.lanesFor(ownerProjectId).find((l) => l.laneId === MAIN_LANE_ID);
		projectStore.setProjectLane(
			ownerProjectId,
			main ?? createMainLane(ownerProjectId, project.canonicalProjectPath, project.lane.surface)
		);
	}

	return { kind: 'deleted' };
}

/**
 * Ferma runtime e watcher dell'anteprima di una corsia Lab e ne attende la
 * fine. La chiave e' la stessa del runtime: lo stop diretto copre anche il
 * caso in cui il runtime sia gia' stato smontato con lo stop ancora in volo.
 */
async function stopLabWatch(ownerProjectId: string, targetLaneId: string): Promise<void> {
	// Caricamento dinamico: evita che l'albero di TopBar.svelte trascini
	// il runtime del Laboratorio prima dell'uso effettivo di una corsia Lab.
	const { disposeLabRuntime } = await import('$lib/lab/runtime.svelte');
	await disposeLabRuntime(ownerProjectId, targetLaneId).catch(() => undefined);
	await labApi.watchStop(`${ownerProjectId}:${targetLaneId}`).catch(() => undefined);
}

/**
 * Elimina definitivamente un prototipo Lab, aperto o chiuso:
 * 1. Progetto: chiude la corsia se aperta (sessione, processi, ritorno a Principale);
 *    bozza libera (ownerProjectId null): chiude la tessera se aperta.
 * 2. Rimuove l'anteprima pubblicata e cancella workspace + voce d'indice.
 * 3. Archivia il record di corsia, cosi' non torna fra le corsie chiuse.
 */
export async function deleteLabPrototype(
	ownerProjectId: ProjectId | null,
	prototypeId: string
): Promise<DeleteLabOutcome> {
	let indexPath: string | null = null;
	let lane: LaneRecord | undefined;

	if (ownerProjectId) {
		const project = projectStore.projects.find((p) => p.id === ownerProjectId);
		if (!project?.canonicalProjectPath) {
			return { kind: 'failed', message: m.lab_error_owner_unavailable() };
		}
		indexPath = project.canonicalProjectPath;
		lane = laneStore
			.lanesFor(ownerProjectId)
			.find(
				(l) =>
					l.kind === 'lab' && (l.labPrototypeId === prototypeId || l.laneId === `lab-${prototypeId}`)
			);
		if (lane && lane.status !== 'closed' && lane.status !== 'archived') {
			const closed = await closeLane(ownerProjectId, lane.laneId);
			if (closed.kind === 'failed') return closed;
		}
		if (lane) await stopLabWatch(ownerProjectId, lane.laneId);
	} else {
		const draftTile = projectStore.projects.find((p) => p.labDraft?.prototypeId === prototypeId);
		if (draftTile) {
			// La chiusura della tessera annuncia la dispose delle sessioni ma non
			// la attende: il processo omp e il watcher terrebbero aperti file del
			// workspace mentre removeFromIndex lo cancella (su Windows: lock).
			await sessionRegistry.disposeProjectSessions(draftTile.id).catch(() => undefined);
			await stopLabWatch(draftTile.id, draftTile.lane.laneId);
			projectStore.closeProject(draftTile.id);
		}
	}

	await labApi.unpublish(prototypeId).catch(() => undefined);
	try {
		await labApi.removeFromIndex(indexPath, prototypeId, true);
	} catch (err) {
		return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
	}

	if (ownerProjectId && lane) {
		await laneStore.updateLane(ownerProjectId, lane.laneId, {
			status: 'archived',
			archiveReason: 'rejected',
			archivedAt: Date.now(),
			recoveryState: 'registered'
		});
	}
	return { kind: 'deleted' };
}
