/**
 * Controllo della sessione da remoto (Gate R44, R5): interrompere il turno e
 * scrivere alla sessione di una corsia.
 */

import { projectStore } from '$lib/stores/projects.svelte';
import { laneOrchestrator } from '$lib/lanes/laneOrchestrator.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { RemoteCommandFailure } from './commands';

/**
 * Interrompe il turno della corsia remota come farebbe il pulsante Stop di Studio.
 */
export async function abortRemoteLane(projectId: string, laneId: string | null): Promise<void> {
	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"L'interruzione remota non e' disponibile per corsie su terminale."
		);
	}

	const session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (session) {
		await session.abort();
	}
}

/**
 * Invia un prompt alla sessione: a sessione ferma avvia un nuovo turno; se impegnata
 * accoda il messaggio con la modalita' scelta ('steer' o 'follow_up').
 */
export async function sendRemotePrompt(
	projectId: string,
	laneId: string | null,
	text: string,
	whileBusy: 'steer' | 'follow_up'
): Promise<void> {
	const trimmed = (text ?? '').trim();
	if (!trimmed) {
		throw new RemoteCommandFailure('rejected', "Il testo del messaggio non puo' essere vuoto");
	}
	if (trimmed.length > 20_000) {
		throw new RemoteCommandFailure('rejected', 'Il testo del messaggio supera il limite di 20.000 caratteri');
	}

	const project = projectStore.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new RemoteCommandFailure('not_found', `Progetto "${projectId}" non trovato`);
	}

	const isMain = !laneId || laneId === 'main';
	const effectiveLaneId = isMain ? 'main' : laneId;

	const lane = laneOrchestrator.laneRecord(project, effectiveLaneId);
	if (!lane && !isMain) {
		throw new RemoteCommandFailure('not_found', `Corsia "${laneId}" non trovata nel progetto "${projectId}"`);
	}

	const surface = (project.lane.laneId === effectiveLaneId)
		? project.lane.surface
		: (lane?.surface ?? 'gui');

	if (surface === 'terminal') {
		throw new RemoteCommandFailure(
			'unsupported',
			"L'invio di messaggi non e' disponibile per corsie su terminale."
		);
	}

	// Sicurezza Lab: se e' una corsia Lab, non deve mai essere aperta senza confinamento Lab
	if (lane?.kind === 'lab' && !lane.labPrototypeId) {
		throw new RemoteCommandFailure(
			'rejected',
			"La corsia Laboratorio non ha un prototipo associato valido."
		);
	}

	let session = isMain
		? sessionRegistry.getMainSession(projectId)
		: sessionRegistry.getLaneSession(projectId, effectiveLaneId);

	if (!session) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				"La corsia Laboratorio deve essere aperta in Studio prima di potervi inviare messaggi."
			);
		}
		if (!lane) {
			throw new RemoteCommandFailure('not_found', `Corsia "${effectiveLaneId}" non trovata`);
		}
		session = laneOrchestrator.getOrCreateAgentSession(project, lane);
	}

	if (!session.isOpen) {
		if (lane?.kind === 'lab') {
			throw new RemoteCommandFailure(
				'rejected',
				"La sessione Laboratorio non e' aperta in Studio."
			);
		}
		await session.open(null);
	}

	const behavior = whileBusy === 'follow_up' ? 'followUp' : 'steer';
	const result = await session.prompt(trimmed, [], behavior);
	if (result === 'failed') {
		throw new RemoteCommandFailure('failed', 'Impossibile inviare il messaggio alla sessione');
	}
}
