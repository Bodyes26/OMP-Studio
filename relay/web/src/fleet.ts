/**
 * Tipi specifici per la vista aggregata Fleet Hub Inbox (Variante A).
 */

import type { RemoteLane, RemoteProject, RemoteAttention, Feature } from '../../src/protocol.ts';

export type FleetSessionState = 'waiting' | 'error' | 'working' | 'done' | 'idle';

export interface FleetSessionItem {
	id: string; // chiave univoca: hostId:projectId:laneId
	hostId: string;
	hostName: string;
	hostOnline: boolean;
	hostFeatures: Feature[];
	project: RemoteProject;
	lane: RemoteLane;
	state: FleetSessionState;
	title: string;
	preview: string;
	updatedAt: number;
	attention: RemoteAttention | null;
	todo?: { done: number; total: number };
	subagentsCount: number;
	jobsCount: number;
	tasksCount: number;
	unread: boolean;
}
