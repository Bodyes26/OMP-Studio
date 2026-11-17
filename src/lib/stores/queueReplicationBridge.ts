/**
 * Contratto fra la coda dei task e il collegamento fra istanze (F19).
 *
 * Perché un'interfaccia e non un import: `tasks.svelte.ts` è caricato anche nei
 * test Node e non deve trascinarsi dietro Tauri e iroh. Il guscio registra il
 * ponte quando il progetto è condiviso e lo toglie quando non lo è.
 */

import type { StudioTask } from './taskSerialization.ts';

export interface QueueReplicationBridge {
	/**
	 * Manda la coda appena scritta alle altre copie. Non attende: il salvataggio
	 * locale non deve dipendere dalla rete.
	 */
	publish(projectPath: string, tasks: readonly StudioTask[]): void;
}
