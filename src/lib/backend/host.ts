import type { HostState } from '$remote-protocol';
import type { Project } from '#lib/stores/projects.svelte.ts';
import type { StudioTask } from '#lib/stores/taskSerialization.ts';
import type { LaneRecord } from '#lib/stores/lanePersistence.ts';

/** Solo lo stato della macchina proprietaria, mai le copie osservate da altri host. */
export interface DesktopHostSnapshot {
	version: 1;
	platform: string;
	projectRoot: string;
	projects: Project[];
	lanes: LaneRecord[];
	tasks: StudioTask[];
	sessions: Array<{ projectId: string; laneId: string; rpcId: number | null; sessionId: string | null }>;
	state: HostState;
}
