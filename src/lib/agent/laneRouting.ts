// Risoluzione deterministica della corsia proprietaria per eventi
// (diagrammi Mermaid, anteprime UI, Browser Studio).
//
// Invarianti del Gate R27 / PLAN W06:
// 1. I worktree sono cartelle sorelle del progetto: nessuna assunzione
//    `cwd.startsWith(canonicalProjectPath)`.
// 2. Correlazione per `laneId`/`projectId` espliciti, per `sessionId`, oppure
//    risoluzione del `cwd` contro il registro delle root autorizzate delle corsie.
// 3. Un evento appartiene a una sola corsia: target incerto o ambiguo fallisce
//    chiuso e non sostituisce la superficie attiva.
// 4. Ripiego su legacy single-lane solo quando la corsia e' univoca nel sistema.

import { isWindows } from '$lib/utils/paths';

export interface LaneEventTarget {
	projectId?: string | null;
	laneId?: string | null;
	cwd?: string | null;
	sessionId?: string | null;
}

export interface LaneRootDescriptor {
	projectId: string;
	laneId: string;
	workspacePath: string | null;
}

export interface LaneResolutionContext {
	projects: Array<{
		id: string;
		canonicalProjectPath: string | null;
		lane?: { laneId: string; workspacePath: string | null };
	}>;
	lanes: LaneRootDescriptor[];
	sessions?: Array<{
		sessionId: string | null;
		projectKey: string;
		laneId?: string | null;
		cwd: string;
	}>;
	activeProjectId?: string | null;
	activeLaneId?: string | null;
}

export interface LaneResolutionResult {
	matched: boolean;
	projectId?: string;
	laneId?: string;
	isAmbiguous?: boolean;
	reason?: string;
}

/**
 * Normalizza un percorso per confronto multipiattaforma:
 * - converte separatori Windows in slash;
 * - rimuove slash finali;
 * - applica lowercase su Windows o in presenza di drive letter.
 */
export function normalizeRoutingPath(rawPath: string | null | undefined): string {
	if (!rawPath) return '';
	let normalized = rawPath.trim().replace(/\\/g, '/');
	while (normalized.length > 1 && normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	// Su Windows i percorsi sono case-insensitive
	if (/^[A-Za-z]:\//.test(normalized) || isWindows) {
		normalized = normalized.toLowerCase();
	}
	return normalized;
}

/**
 * Verifica se `candidate` coincide con `basePath` o e' una sua sottocartella,
 * rispettando i confini di segmento. Non usa startsWith ingenuo su nomi fratelli.
 */
export function isPathEqualOrSubpath(basePath: string | null | undefined, candidate: string | null | undefined): boolean {
	const base = normalizeRoutingPath(basePath);
	const target = normalizeRoutingPath(candidate);
	if (!base || !target) return false;
	if (base === target) return true;
	return target.startsWith(`${base}/`);
}

/**
 * Risolve la corsia proprietaria di un evento contro il registro delle root autorizzate.
 */
export function resolveTargetLane(
	event: LaneEventTarget,
	context: LaneResolutionContext
): LaneResolutionResult {
	// 1. Target esplicito con projectId e laneId
	if (event.projectId && event.laneId) {
		const targetProj = event.projectId.trim();
		const targetLane = event.laneId.trim();
		const exists = context.lanes.some(
			(l) => l.projectId === targetProj && l.laneId === targetLane
		) || context.projects.some(
			(p) => p.id === targetProj && (!p.lane || p.lane.laneId === targetLane)
		);
		if (exists || context.lanes.length === 0) {
			return { matched: true, projectId: targetProj, laneId: targetLane };
		}
	}

	// 2. Target esplicito con solo laneId
	if (event.laneId) {
		const targetLane = event.laneId.trim();
		const matchingLanes = context.lanes.filter((l) => l.laneId === targetLane);
		if (matchingLanes.length === 1) {
			return {
				matched: true,
				projectId: matchingLanes[0].projectId,
				laneId: matchingLanes[0].laneId
			};
		}
		if (matchingLanes.length > 1 && event.cwd) {
			const normCwd = normalizeRoutingPath(event.cwd);
			const cwdMatches = matchingLanes.filter((l) =>
				isPathEqualOrSubpath(l.workspacePath, normCwd)
			);
			if (cwdMatches.length === 1) {
				return {
					matched: true,
					projectId: cwdMatches[0].projectId,
					laneId: cwdMatches[0].laneId
				};
			}
		}
		if (matchingLanes.length > 1 && context.activeProjectId) {
			const activeMatch = matchingLanes.find((l) => l.projectId === context.activeProjectId);
			if (activeMatch) {
				return {
					matched: true,
					projectId: activeMatch.projectId,
					laneId: activeMatch.laneId
				};
			}
		}
	}

	// 3. Risoluzione tramite sessionId
	if (event.sessionId && context.sessions && context.sessions.length > 0) {
		const sessionMatch = context.sessions.find(
			(s) => s.sessionId && s.sessionId === event.sessionId
		);
		if (sessionMatch) {
			return {
				matched: true,
				projectId: sessionMatch.projectKey,
				laneId: sessionMatch.laneId ?? 'main'
			};
		}
	}

	// 4. Risoluzione tramite cwd contro il registro delle root autorizzate
	if (event.cwd) {
		const normCwd = normalizeRoutingPath(event.cwd);
		if (normCwd) {
			// Costruisci l'elenco delle root note (unione di context.lanes e context.projects)
			const roots: LaneRootDescriptor[] = [];
			const seenKeys = new Set<string>();

			for (const lane of context.lanes) {
				const key = `${lane.projectId}:${lane.laneId}`;
				if (!seenKeys.has(key)) {
					seenKeys.add(key);
					roots.push(lane);
				}
			}

			for (const project of context.projects) {
				const mainKey = `${project.id}:main`;
				if (!seenKeys.has(mainKey) && project.canonicalProjectPath) {
					seenKeys.add(mainKey);
					roots.push({
						projectId: project.id,
						laneId: 'main',
						workspacePath: project.canonicalProjectPath
					});
				}
			}

			// Priorita' 1: Corrispondenza esatta della radice del workspace
			const exactMatches = roots.filter(
				(r) => r.workspacePath && normalizeRoutingPath(r.workspacePath) === normCwd
			);
			if (exactMatches.length === 1) {
				return {
					matched: true,
					projectId: exactMatches[0].projectId,
					laneId: exactMatches[0].laneId
				};
			}

			// Priorita' 2: Sottocartella interna a una radice autorizzata
			const subpathMatches = roots.filter(
				(r) => r.workspacePath && isPathEqualOrSubpath(r.workspacePath, normCwd)
			);
			if (subpathMatches.length === 1) {
				return {
					matched: true,
					projectId: subpathMatches[0].projectId,
					laneId: subpathMatches[0].laneId
				};
			}

			if (exactMatches.length > 1 || subpathMatches.length > 1) {
				return {
					matched: false,
					isAmbiguous: true,
					reason: 'CWD corrisponde a piu corsie autorizzate'
				};
			}
		}
	}

	// 5. Ripiego su legacy single-lane se univoco nel sistema
	const allLanes = context.lanes.length > 0
		? context.lanes
		: context.projects.map((p) => ({
				projectId: p.id,
				laneId: p.lane?.laneId ?? 'main',
				workspacePath: p.lane?.workspacePath ?? p.canonicalProjectPath
		  }));

	if (allLanes.length === 1) {
		return {
			matched: true,
			projectId: allLanes[0].projectId,
			laneId: allLanes[0].laneId
		};
	}

	// Se ci sono piu corsie o progetti e il target e' incerto, rifiuta la sostituzione
	return {
		matched: false,
		isAmbiguous: true,
		reason: 'Target incerto con piu corsie attive: la superficie attiva e protetta'
	};
}
