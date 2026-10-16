import type { RemoteSessionSnapshot } from '$remote-protocol';
import type { AgentSession } from '$lib/agent/session.svelte';
import { sessionRegistry } from '$lib/agent/sessionRegistry';
import { sessionCompletions } from '$lib/agent/completion.svelte';
import { RemoteCommandFailure } from './commands';
import { stripEditorContext } from '$lib/editor/editorContextParsing';

/** Lo snapshot non ricostruisce il transcript a ogni token: usa gli stati osservati. */
export function buildRemoteSessionSnapshot(session: AgentSession): RemoteSessionSnapshot {
	const items = session.todoPhases.flatMap((phase) => phase.tasks.map((task) => ({
		content: task.content,
		status: task.status
	})));
	const completion = sessionCompletions.get(session.sessionId);
	const firstUser = session.entries.find((entry) => entry.kind === 'user');
	const updatedAt = Math.max(session.activityLine?.at ?? 0, completion?.at ?? 0, firstUser?.messageTs ?? 0);
	return {
		id: session.sessionId,
		title: session.sessionName || (firstUser ? stripEditorContext(firstUser.content).trim().slice(0, 160) : null) || null,
		updatedAt: updatedAt || null,
		completion,
		progress: items.length ? { done: items.filter((task) => task.status === 'completed').length, total: items.length, items } : null,
		subagents: session.subagents.map((agent, index) => ({
			id: agent.id ?? agent.jobId ?? `subagent-${index}`,
			name: agent.agent ?? agent.id ?? 'task',
			task: agent.task ?? agent.assignment ?? agent.description ?? null,
			status: agent.status ?? 'pending'
		})),
		jobs: session.backgroundJobs
	};
}

export async function markRemoteSessionSeen(
	projectId: string,
	laneId: string | null,
	sessionId: string,
	completionId: string
): Promise<void> {
	const session = sessionRegistry.getLaneSession(projectId, laneId ?? 'main');
	if (!session || session.sessionId !== sessionId) {
		throw new RemoteCommandFailure('not_found', 'La conversazione non e piu quella aperta nella corsia.');
	}
	if (!sessionCompletions.markSeen(sessionId, completionId)) {
		throw new RemoteCommandFailure('rejected', 'Il risultato e cambiato: rileggi la risposta aggiornata.');
	}
}
