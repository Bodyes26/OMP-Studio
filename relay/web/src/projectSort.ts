import type { RemoteProject } from '../../src/protocol.ts';

export function getProjectPriority(project: RemoteProject): number {
	const hasAttention = (project.attention && project.attention.length > 0) ||
		project.lanes.some((l) => l.agent.state === 'attention');
	if (hasAttention) {
		return 0;
	}
	const isWorking = project.lanes.some(
		(l) => l.agent.state === 'working' || l.agent.state === 'background'
	);
	if (isWorking) {
		return 1;
	}
	return 2;
}

/**
 * Ordina i progetti secondo la gerarchia canonica di OMP Studio:
 * 1. Progetti che richiedono attenzione (richieste in attesa o corsie in attention)
 * 2. Progetti al lavoro (in working o in background)
 * 3. Resto dei progetti (inattivi/idle o offline)
 *
 * A parita' di livello, il progetto attivo in primo piano viene mostrato per primo,
 * seguito dal numero di elementi di attenzione decrescente e dal nome alfabetico.
 */
export function sortProjects(projects: readonly RemoteProject[]): RemoteProject[] {
	return [...projects].sort((a, b) => {
		const prioA = getProjectPriority(a);
		const prioB = getProjectPriority(b);
		if (prioA !== prioB) {
			return prioA - prioB;
		}
		if (a.active !== b.active) {
			return a.active ? -1 : 1;
		}
		const attA = a.attention?.length ?? 0;
		const attB = b.attention?.length ?? 0;
		if (attA !== attB) {
			return attB - attA;
		}
		return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
	});
}
