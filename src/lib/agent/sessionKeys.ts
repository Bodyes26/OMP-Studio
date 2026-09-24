function keySegment(value: string, name: string): string {
	const normalized = value.trim().toLowerCase();
	if (!normalized) throw new Error(`${name} non puo' essere vuoto`);
	return normalized;
}

export function laneSessionKey(projectKey: string, laneId: string): string {
	return `lane:${keySegment(projectKey, 'projectKey')}:${keySegment(laneId, 'laneId')}`;
}
export function mainSessionKey(projectKey: string): string {
	return laneSessionKey(projectKey, 'main');
}
