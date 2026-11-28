/**
 * Aggancio reale del commit di fine turno (R-MI-73).
 *
 * Sta fuori da `turnCommit.ts` perche' quello lo importano i test, e la catena
 * degli store (`projectOrder` -> `githubStore` -> Tauri) non si carica in Node.
 * La costruzione delle dipendenze sta invece in `createTurnCommitDeps`: cosi'
 * i test provano lo stesso codice che gira nella finestra, con un `invoke`
 * finto al posto del confine IPC.
 */

import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { studioLog } from '#lib/diagnostics/studioLog.ts';
import { copySyncStore } from './copySync.svelte.ts';
import { machineName } from './projectMachines.svelte.ts';
import { projectOrder } from './projectOrder.svelte.ts';
import type { Project } from './projects.svelte';
import { createTurnCommitDeps, createTurnTracker, isSharedProject, type TurnCommitIpc } from './turnCommit.ts';

/** Il gruppo di copie del progetto: questa macchina e le gemelle. */
function groupOf(project: Project): Project[] {
	return projectOrder.groups.find((members) => members.some((copy) => copy.id === project.id)) ?? [];
}

/**
 * Nome della macchina per il messaggio fisso: quello configurato, non «Questo
 * computer». Il messaggio lo legge l'altra macchina, dove «Questo computer»
 * non dice nulla (R-MI-73).
 */
function commitMachineName(machine: string): string {
	const own = machine === LOCAL_MACHINE ? linkStore.status.name?.trim() : '';
	return own ? own : machineName(machine);
}

const ipc: TurnCommitIpc = {
	invoke: (command, args, machine) => invoke(command, args, { machine }),
	isShared: (project) =>
		isSharedProject(project, groupOf(project).map((copy) => copy.machineId), LOCAL_MACHINE),
	machineName: commitMachineName,
	afterCommit(project) {
		// Il giro delle copie deve partire subito, non al minuto successivo: il
		// lavoro dell'agente arriva all'altra macchina entro un giro (R-MI-73).
		// Si chiama `sync` e non `syncAll` perche' `syncAll` salta la coppia
		// sincronizzata poco fa con la stessa impronta, e l'impronta contiene la
		// cima letta prima di questo commit: con `syncAll` il commit appena
		// fatto non partirebbe.
		const local = groupOf(project).find((copy) => !copy.machineId || copy.machineId === LOCAL_MACHINE);
		if (!local) return;
		for (const pair of copySyncStore.pairs()) {
			if (pair.local.id === local.id) void copySyncStore.sync(pair);
		}
	},
	log(level, message) {
		if (level === 'warn') studioLog.warn('copies', message);
		else studioLog.info('copies', message);
	}
};

export const turnCommit = createTurnTracker(createTurnCommitDeps(ipc));
