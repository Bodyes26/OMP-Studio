/**
 * Comandi remoti per la creazione di corsie worktree isolate (Gate R44 / Fleet).
 *
 * Implementa create_lane garantendo:
 * - Creazione effettiva del worktree Git tramite laneOrchestrator.createNewLane;
 * - Consegna del prompt iniziale alla nuova corsia;
 * - Nessun cambio di fuoco o attivazione visiva sulla GUI desktop (activate: false);
 * - Rispetto rigoroso dei vincoli di concorrenza (soft-cap) e consenso profilo;
 * - Rollback pulito con archiviazione e rimozione in caso di mancata consegna.
 */

import { projectStore } from '#lib/stores/projects.svelte.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { reviewProjectProfile } from '#lib/lanes/laneProfile.ts';
import { activeLanes, shouldWarnConcurrency } from '#lib/lanes/queueDispatch.ts';
import { RemoteCommandFailure } from './commands';
import type { ProjectId } from '#lib/types/lanes.ts';
import type { LaneRecord } from '#lib/stores/lanes.svelte.ts';

export async function createRemoteLane(
	projectId: string,
	title: string,
	prompt: string
): Promise<{ laneId: string }> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	if (!project.canonicalProjectPath) {
		throw new RemoteCommandFailure('unsupported', 'I worktree Git non sono supportati per questo progetto');
	}

	// Verifica vincoli di concorrenza
	const lanes = laneOrchestrator.laneDispatchSnapshots(project);
	const active = activeLanes(lanes);
	if (shouldWarnConcurrency(active.length)) {
		throw new RemoteCommandFailure(
			'rejected',
			'Limite di agenti simultanei raggiunto. Conferma richiesta sulla macchina.'
		);
	}

	// Verifica profilo del worktree (consenso preventivo)
	let review;
	try {
		review = await reviewProjectProfile(project);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', `Verifica profilo worktree fallita: ${msg}`);
	}
	if (review?.needsConsent) {
		throw new RemoteCommandFailure(
			'rejected',
			'Consenso del profilo worktree richiesto sulla macchina.'
		);
	}
	let created: LaneRecord;
	try {
		created = await laneOrchestrator.createNewLane(project, {
			origin: 'manual',
			surface: 'gui',
			title: title?.trim() || undefined,
			activate: false // NESSUN cambio di focus sul desktop
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new RemoteCommandFailure('failed', `Creazione corsia fallita: ${msg}`);
	}

	try {
		const session = laneOrchestrator.getOrCreateAgentSession(project, created);
		await session.ensureOpen();
		const outcome = await session.prompt(prompt);
		if (outcome === 'failed' || outcome === 'empty') {
			throw new Error(
				outcome === 'empty'
					? 'Prompt vuoto non inviato alla sessione'
					: 'Invio del prompt alla sessione fallito'
			);
		}
	} catch (err) {
		const ownerProjectId = project.id as ProjectId;
		const session = sessionRegistry.getLaneSession(project.id, created.laneId);
		if (session) await sessionRegistry.disposeSession(session).catch(() => undefined);
		await laneOrchestrator.archiveLane(ownerProjectId, created.laneId, 'rejected', {
			stopProcesses: true
		}).catch(() => undefined);
		const msg = err instanceof Error ? err.message : String(err);
		throw new RemoteCommandFailure('failed', `Invio prompt fallito: ${msg}`);
	}

	return { laneId: created.laneId };
}
