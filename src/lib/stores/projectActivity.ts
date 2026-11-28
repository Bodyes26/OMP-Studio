import type { Project } from './projects.svelte';
import { laneStore } from './lanes.svelte';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import type { ProjectId } from '#lib/types/lanes.ts';

type AgentState = Project['lane']['agentState'];

/** Priorita' degli stati: la tessera mostra il piu' urgente. */
const URGENCY: AgentState[] = ['attention', 'working', 'finished', 'idle'];

/**
 * Stato di una copia: la corsia mostrata, le altre corsie (un conflitto
 * aspetta l'utente) e le sessioni aperte, comprese le domande pendenti.
 * Le corsie delle copie remote arrivano dallo snapshot dell'host tramite
 * `laneStore.lanesFor`.
 */
function copyAgentState(p: Project): AgentState {
	const candidates: AgentState[] = [];
	if (p.lane.agentState && p.lane.agentState !== 'unknown') candidates.push(p.lane.agentState);

	for (const lane of laneStore.lanesFor(p.id as ProjectId)) {
		if (lane.status === 'archived' || lane.status === 'closed') continue;
		if (lane.status === 'conflict') candidates.push('attention');
		if (lane.agentState && lane.agentState !== 'unknown') candidates.push(lane.agentState);
	}

	for (const session of sessionRegistry.getSessionsForProject(p.id)) {
		if (session.agentState && session.agentState !== 'unknown') candidates.push(session.agentState);
		if (session.pendingUi) candidates.push('attention');
	}

	return URGENCY.find((state) => candidates.includes(state)) ?? p.lane.agentState ?? 'unknown';
}

/**
 * Stato della tessera di un progetto su piu' macchine (R-MI-24): una domanda
 * in attesa sul Mac deve vedersi anche se la tessera rappresenta la copia
 * di Windows.
 */
export function groupAgentState(copies: readonly Project[]): AgentState {
	const states = copies.map(copyAgentState);
	return URGENCY.find((state) => states.includes(state)) ?? states[0] ?? 'unknown';
}

/** La copia aspetta una risposta dall'utente. */
export function copyNeedsAttention(p: Project): boolean {
	return copyAgentState(p) === 'attention';
}
