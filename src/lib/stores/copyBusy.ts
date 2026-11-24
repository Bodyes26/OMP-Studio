/**
 * Cartelle occupate di una copia locale (R-MI-57, D1, D2).
 *
 * Vive fuori da `copySync.svelte.ts` perche' la usa anche `githubStore`
 * (`git_fast_forward_upstream`, R-MI-58) e `githubStore` e' gia' importato da
 * `copySync`: tenerla qui evita un ciclo fra i due moduli. La funzione resta
 * esportata anche da `copySync.svelte.ts`, dove la cercano i chiamanti.
 */

import { linkStore } from '#lib/backend/link.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { getDirtyEditorPaths } from '#lib/editor/editorActivity.svelte.ts';
import type { ProjectId } from '#lib/types/lanes.ts';
import { laneStore } from './lanes.svelte';
import type { Project } from './projects.svelte';
import { busyCopyPaths } from './projectCopies.ts';

export function busyPaths(local: Project): string[] {
	const root = local.canonicalProjectPath;
	const folders: string[] = root ? [root] : [];
	const lanes = laneStore.lanesFor(local.id as ProjectId);
	for (const lane of lanes) if (lane.workspacePath) folders.push(lane.workspacePath);

	// Sessione al lavoro o in attesa: vale la SUA cartella, non la radice (D2).
	const workingFolders: string[] = [];
	for (const session of sessionRegistry.getSessionsForProject(local.id)) {
		if (session.agentState !== 'working' && !session.pendingUi) continue;
		if (session.cwd) workingFolders.push(session.cwd);
	}
	// La corsia al lavoro senza sessione GUI (terminale, task appena partito).
	for (const lane of lanes) {
		if (!lane.workspacePath) continue;
		if (lane.agentState === 'working' || lane.agentState === 'attention') {
			workingFolders.push(lane.workspacePath);
		}
	}

	// Una surface aperta e ferma su un'altra macchina non e' lavoro (D1).
	const remoteWorkingFolders: string[] = [];
	for (const lane of lanes) {
		if (!lane.workspacePath) continue;
		if (linkStore.laneWorkingRemotely(local.id, lane.laneId)) {
			remoteWorkingFolders.push(lane.workspacePath);
		}
	}

	return busyCopyPaths({
		folders,
		dirtyFolders: getDirtyEditorPaths(),
		workingFolders,
		remoteWorkingFolders
	});
}
