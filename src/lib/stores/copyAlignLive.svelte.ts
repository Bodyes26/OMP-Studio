/**
 * Dipendenze reali di «Allinea tutto», in un modulo a parte (R-MI-74).
 *
 * Sta fuori da `copyAlign.svelte.ts` perche' quello lo importano i test e la
 * striscia: la catena degli store (`copySync` -> `githubStore` -> Tauri) non si
 * carica in Node. La costruzione delle dipendenze sta invece in
 * `createAlignDeps`, cosi' i test provano lo stesso codice che gira nella
 * finestra, con un `invoke` finto al posto del confine IPC.
 */

import { invoke, LOCAL_MACHINE, routeErrorText } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { studioLog } from '#lib/diagnostics/studioLog.ts';
import { requestCopyAlignResolution } from './copyConflictTask.ts';
import { CopyAlign, createAlignDeps, type AlignCopy, type AlignIpc } from './copyAlign.svelte.ts';
import { copySyncStore } from './copySync.svelte.ts';
import { machineName, provenance } from './projectMachines.svelte.ts';
import type { Project } from './projects.svelte';

/** Le copie del progetto, con la forma che serve al giro. */
function copiesOf(project: Project): AlignCopy[] {
	return provenance(project).copies.map((copy) => ({
		machine: copy.machineId,
		name: copy.name,
		path: copy.project.canonicalProjectPath ?? '',
		online: copy.online,
		local: copy.local
	}));
}

/** La copia di questa macchina: e' lei che unisce e che fa partire l'agente. */
function localCopy(project: Project): Project {
	return provenance(project).copies.find((copy) => copy.local)?.project ?? project;
}

/**
 * Nome della macchina per il messaggio fisso: quello configurato, non «Questo
 * computer». Il messaggio lo legge l'altra macchina (R-MI-74, come R-MI-73).
 */
function commitMachineName(machine: string): string {
	const own = machine === LOCAL_MACHINE ? linkStore.status.name?.trim() : '';
	return own ? own : machineName(machine);
}

const ipc: AlignIpc = {
	invoke: (command, args, machine) => invoke(command, args, { machine }),
	copies: copiesOf,
	async sync(project) {
		const local = localCopy(project);
		const pairs = copySyncStore.pairs().filter((pair) => pair.local.id === local.id);
		await Promise.all(pairs.map((pair) => copySyncStore.sync(pair)));
		// I rapporti si rileggono dallo store: un giro che ha gia' trovato la
		// guardia occupata torna `null`, e senza questa lettura un conflitto
		// gia' noto dal giro precedente sembrerebbe sparito.
		return pairs
			.map((pair) => (pair.remote.machineId ? copySyncStore.reportFor(pair.local.id, pair.remote.machineId) : null))
			.filter((report): report is NonNullable<typeof report> => report !== null);
	},
	async startAgent(project, conflicts) {
		// L'unione la fa un agente DI QUESTA MACCHINA: il compito va alla copia
		// locale, anche quando la chat aperta e' quella dell'altra (R-MI-74).
		return requestCopyAlignResolution({ project: localCopy(project), conflicts });
	},
	machineName: commitMachineName,
	// C5: un rifiuto di instradamento diventa «Mac non raggiungibile», non
	// l'inglese del trasporto con l'id della macchina.
	errorText: (error) => routeErrorText(error),
	log(level, message) {
		if (level === 'warn') studioLog.warn('copies', message);
		else studioLog.info('copies', message);
	}
};

export const copyAlign = new CopyAlign(createAlignDeps(ipc));
