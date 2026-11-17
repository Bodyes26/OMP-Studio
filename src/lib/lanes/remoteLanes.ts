/**
 * Corsie di un progetto di un'altra macchina (R-MI-06). Worktree e registro
 * delle corsie stanno sul disco della macchina che possiede il progetto: da
 * qui si chiede a lei di crearle, adottarle o archiviarle, e il record che
 * restituisce entra subito nella proiezione locale.
 */
import { LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { projectStore, type Project } from '#lib/stores/projects.svelte.ts';
import type { LaneRecord } from '#lib/stores/lanePersistence.ts';
import type { LaneArchiveOutcome } from '#lib/stores/lanes.svelte.ts';
import type { RemoteCommandData, RemoteLaneAction } from '$remote-protocol';

async function send(project: Project, action: RemoteLaneAction): Promise<RemoteCommandData['lane_action']> {
	return linkStore.command<RemoteCommandData['lane_action']>(project.machineId ?? LOCAL_MACHINE, {
		kind: 'lane_action',
		projectId: project.hostProjectId ?? '',
		action
	});
}

/** Crea o adotta la corsia sull'host e la restituisce con l'id della tessera locale. */
export async function requestRemoteLane(
	project: Project,
	action: Extract<RemoteLaneAction, { op: 'create' | 'open_branch' }>,
	activate: boolean
): Promise<LaneRecord> {
	const data = await send(project, action);
	if (!data?.lane) throw new Error('The other machine did not return the lane');
	const lane = projectStore.adoptRemoteLane(project, data.lane as unknown as LaneRecord);
	if (activate) projectStore.setProjectLane(project.id, lane);
	return lane;
}

export async function archiveRemoteLane(
	project: Project,
	action: Extract<RemoteLaneAction, { op: 'archive' }>
): Promise<LaneArchiveOutcome> {
	const data = await send(project, action);
	return data?.outcome as unknown as LaneArchiveOutcome;
}
