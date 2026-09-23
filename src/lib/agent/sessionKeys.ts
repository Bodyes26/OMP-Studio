function keySegment(value: string, name: string): string {
	const normalized = value.trim().toLowerCase();
	if (!normalized) throw new Error(`${name} non puo' essere vuoto`);
	return normalized;
}

export function laneSessionKey(projectKey: string, laneId: string): string {
	return `lane:${keySegment(projectKey, 'projectKey')}:${keySegment(laneId, 'laneId')}`;
}

export function labSessionKey(projectKey: string, prototypeId: string): string {
	return `lab:${keySegment(projectKey, 'projectKey')}:${keySegment(prototypeId, 'prototypeId')}`;
}

export function mainSessionKey(projectKey: string): string {
	return laneSessionKey(projectKey, 'main');
}
