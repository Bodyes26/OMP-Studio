import { m as msg } from '#lib/paraglide/messages.js';

function keySegment(value: string, name: string): string {
	const normalized = value.trim().toLowerCase();
	if (!normalized) throw new Error(msg.l10n_agent_session_key_empty({ name }));
	return normalized;
}

export function laneSessionKey(projectKey: string, laneId: string): string {
	return `lane:${keySegment(projectKey, 'projectKey')}:${keySegment(laneId, 'laneId')}`;
}
export function mainSessionKey(projectKey: string): string {
	return laneSessionKey(projectKey, 'main');
}
