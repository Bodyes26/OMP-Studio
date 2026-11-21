/**
 * Contratto fra la coda dei task e il collegamento fra istanze (F19).
 *
 * Perché un'interfaccia e non un import: `tasks.svelte.ts` è caricato anche nei
 * test Node e non deve trascinarsi dietro Tauri e iroh. Il guscio registra il
 * ponte quando il progetto è condiviso e lo toglie quando non lo è.
 */

import type { StudioTask } from './taskSerialization.ts';
import type { RemovedTasks } from './queueReplication.ts';

export interface QueueReplicationBridge {
	/**
	 * Manda la coda appena scritta alle altre copie, con le rimozioni note
	 * (task cancellati o avviati). Non attende: il salvataggio locale non deve
	 * dipendere dalla rete.
	 */
	publish(projectPath: string, tasks: readonly StudioTask[], removed: RemovedTasks): void;
}

/**
 * Consegna della coda di un progetto che vive su un'altra macchina (R-MI-15):
 * la finestra non ne ha il file, quindi le modifiche vanno all'host.
 */
export interface RemoteQueueBridge {
	/** L'host è raggiungibile adesso. */
	online(machine: string): boolean;
	/** Manda la coda (`{ tasks, removed }` in JSON) all'host, che la fonde per task. */
	send(machine: string, hostPath: string, payload: string): Promise<void>;
}
