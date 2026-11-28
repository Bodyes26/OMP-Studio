/**
 * «Risolvi» e «Allinea tutto» della striscia delle copie (R-MI-61, R-MI-74).
 *
 * L'unione fra due copie la fa git quando non ci sono conflitti; quando ci
 * sono, il compito passa a un agente DI QUESTA MACCHINA con il testo gia'
 * scritto: branch, macchina gemella, ref da unire, file in conflitto,
 * istruzione di risolvere, eseguire i controlli del progetto e committare.
 *
 * «Allinea tutto» (R-MI-74) usa lo stesso meccanismo dopo aver committato le
 * modifiche in sospeso di tutte le copie: il compito dice all'agente di unire
 * tutte le versioni, non solo una gemella, e di committare solo alla fine.
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
function copyConflictPrompt(input: CopyConflictRequest): string {
	return m.copies_conflict_task({
		branch: input.branch,
		machine: machineName(input.machine),
		ref: `refs/studio/${input.machine}/heads/${input.branch}`,
		files: input.files.join(', ')
	});
}

/** Una branch ferma su conflitti veri: quella che l'agente deve unire. */
export interface CopyAlignConflict {
	branch: string;
	machine: string;
	files: string[];
}

/**
 * Testo del compito di «Allinea tutto» (R-MI-74): unire tutte le versioni,
 * risolvere i conflitti, eseguire le verifiche del progetto e committare. I
 * ref sono tutti quelli gia' ricevuti dalle gemelle: l'agente non inventa
 * branch, unisce quello che c'e'.
 */
function copyAlignPrompt(input: { project: Project; conflicts: CopyAlignConflict[] }): string {
	const refs = input.conflicts
		.map((conflict) => `refs/studio/${conflict.machine}/heads/${conflict.branch}`)
		.join(', ');
	const files = [...new Set(input.conflicts.flatMap((conflict) => conflict.files))];
	return m.copies_align_task({
		branch: [...new Set(input.conflicts.map((conflict) => conflict.branch))].join(', '),
		refs,
		files: files.join(', ')
	});
}

/** Crea il task del compito e lo avvia se la Principale e' libera. */
async function enqueueTask(project: Project, prompt: string): Promise<string | null> {
	const root = project.canonicalProjectPath;
	if (!root) return null;
	await taskStore.loadProject(root).catch(() => false);
	const task = taskStore.createTask(root);
	taskStore.updateTask(task.id, prompt);
	const busy = laneOrchestrator.laneAgentState(project, MAIN_LANE_ID);
	if (busy === 'working' || busy === 'attention') return task.id;
	// Lo stesso percorso del click sulla coda: eventuali conferme restano a
	// carico del dispatcher, che sa aprire il dialogo giusto.
	await emit('studio-run-task', { projectId: project.id, taskId: task.id, follow: false }).catch(() => undefined);
	return task.id;
}

/**
 * Crea il task con il compito pronto e lo avvia se la Principale e' libera.
 * Restituisce l'id del task: chi chiama non ha altro da fare.
 */
export async function requestCopyConflictResolution(input: CopyConflictRequest): Promise<string | null> {
	return enqueueTask(input.project, copyConflictPrompt(input));
}

/** Il compito di «Allinea tutto»: unire tutte le versioni e committare. */
export async function requestCopyAlignResolution(input: { project: Project; conflicts: CopyAlignConflict[] }): Promise<string | null> {
	return enqueueTask(input.project, copyAlignPrompt(input));
}
