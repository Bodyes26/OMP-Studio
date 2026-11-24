/**
 * «Risolvi» della striscia delle copie (R-MI-61).
 *
 * L'unione fra due copie la fa git quando non ci sono conflitti; quando ci
 * sono, il compito passa a un agente DI QUESTA MACCHINA con il testo gia'
 * scritto: branch, macchina gemella, ref da unire, file in conflitto,
 * istruzione di risolvere, eseguire i controlli del progetto e committare.
 *
 * Il compito nasce come task in coda, cosi' resta leggibile e ripetibile. Se
 * la Principale e' ferma parte subito; se un agente sta lavorando o aspetta
 * una risposta il task resta in coda invece di interromperlo (R-MI-15).
 */

import { emit } from '#lib/backend/ipc.ts';
import { laneOrchestrator } from '#lib/lanes/laneOrchestrator.svelte.ts';
import { MAIN_LANE_ID } from '#lib/types/lanes.ts';
import { m } from '#lib/paraglide/messages.js';
import { machineName } from './projectMachines.svelte.ts';
import type { Project } from './projects.svelte';
import { taskStore } from './tasks.svelte.ts';

export interface CopyConflictRequest {
	project: Project;
	branch: string;
	/** Macchina che ha i commit da unire. */
	machine: string;
	files: string[];
}

/**
 * Testo del compito. Il ref e' quello che questa macchina riceve dall'altra
 * (`refs/studio/<machineId>/heads/<branch>`): e' il nome che git ha davvero.
 */
export function copyConflictPrompt(input: CopyConflictRequest): string {
	return m.copies_conflict_task({
		branch: input.branch,
		machine: machineName(input.machine),
		ref: `refs/studio/${input.machine}/heads/${input.branch}`,
		files: input.files.join(', ')
	});
}

/**
 * Crea il task con il compito pronto e lo avvia se la Principale e' libera.
 * Restituisce l'id del task: chi chiama non ha altro da fare.
 */
export async function requestCopyConflictResolution(input: CopyConflictRequest): Promise<string | null> {
	const root = input.project.canonicalProjectPath;
	if (!root) return null;
	await taskStore.loadProject(root).catch(() => false);
	const task = taskStore.createTask(root);
	taskStore.updateTask(task.id, copyConflictPrompt(input));
	const busy = laneOrchestrator.laneAgentState(input.project, MAIN_LANE_ID);
	if (busy === 'working' || busy === 'attention') return task.id;
	// Lo stesso percorso del click sulla coda: eventuali conferme restano a
	// carico del dispatcher, che sa aprire il dialogo giusto.
	await emit('studio-run-task', { projectId: input.project.id, taskId: task.id, follow: false }).catch(() => undefined);
	return task.id;
}
