/**
 * «Porta qui le modifiche» (R-MI-28): le modifiche non committate di una copia
 * passano a quella di un'altra macchina solo quando si cambia macchina, mai da
 * sole. L'ordine conta: istantanea alla partenza, arrivo allineato ai commit,
 * applicazione, e solo dopo la conferma la partenza torna pulita (le modifiche
 * restano nello stash anche lì).
 */

import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { githubStore } from './github.svelte';
import type { Project } from './projects.svelte';

interface WipSnapshot {
	id: string;
	commit: string;
	base: string;
	branch: string;
	files: number;
}

function machineOf(project: Project): string {
	return project.machineId ?? LOCAL_MACHINE;
}

/** Con quale id la macchina di `target` conosce quella di `source`. */
function peerSeenBy(source: Project): string {
	return machineOf(source) === LOCAL_MACHINE ? linkStore.status.machineId : machineOf(source);
}

/** Le due copie stanno su macchine diverse: solo allora c'è qualcosa da spostare. */
export function canMoveChanges(from: Project, to: Project): boolean {
	return machineOf(from) !== machineOf(to) && Boolean(from.canonicalProjectPath && to.canonicalProjectPath);
}

export async function moveChanges(from: Project, to: Project): Promise<void> {
	const fromPath = from.canonicalProjectPath!;
	const toPath = to.canonicalProjectPath!;
	const peer = peerSeenBy(from);
	const snapshot = await invoke<WipSnapshot>('copy_wip_snapshot', { projectPath: fromPath }, { machine: machineOf(from) });
	// L'arrivo deve essere sul commit da cui è partita l'istantanea: prima
	// riceve i commit della partenza. Le cartelle sono già state verificate
	// libere da chi chiede lo spostamento.
	await invoke('copy_sync', { projectPath: toPath, machine: peer, peerPath: fromPath, busyPaths: [] }, { machine: machineOf(to) });
	await invoke('copy_wip_receive', {
		projectPath: toPath, machine: peer, peerPath: fromPath,
		id: snapshot.id, base: snapshot.base, commit: snapshot.commit
	}, { machine: machineOf(to) });
	await invoke('copy_wip_finish', { projectPath: fromPath, id: snapshot.id }, { machine: machineOf(from) });
	void githubStore.loadUpstreamStatus(fromPath, true);
	void githubStore.loadUpstreamStatus(toPath, true);
}
