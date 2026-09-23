/**
 * W06 Contract Test: Isolamento Browser Studio, diagrammi e preview per corsia
 *
 * Difende le invarianti del Gate R27 / PLAN W06:
 * 1. I worktree sono fratelli: rimossa ogni assunzione `cwd.startsWith(canonicalProjectPath)`.
 * 2. Risoluzione della corsia per target esplicito (projectId/laneId), per sessionId o
 *    risoluzione del cwd contro il registro delle root autorizzate delle corsie.
 * 3. Un evento appartiene a una sola corsia; target incerto non sostituisce la superficie attiva.
 * 4. Legacy single-lane funziona se univoco (fallback autorizzato solo con una sola corsia).
 * 5. Isolamento delle superfici tra corsie: diagrammi, preview e browser di una corsia
 *    in background non alterano la corsia Principale o attiva.
 * 6. Commutando sulla corsia secondaria il diagramma compare immediatamente con il suo payload.
 * 7. Isolamento Browser Live per corsia senza perdite di stato o interferenze.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	normalizeRoutingPath,
	isPathEqualOrSubpath,
	resolveTargetLane,
	type LaneResolutionContext
} from '../src/lib/agent/laneRouting.ts';
import {
	LaneSurfaceManager,
	type LaneDiagramPayload,
	type LanePreviewPayload
} from '../src/lib/agent/laneSurfaces.ts';

describe('W06 — Isolamento Browser, diagrammi e anteprime per corsia', () => {
	let surfaceStore: LaneSurfaceManager;

	beforeEach(() => {
		surfaceStore = new LaneSurfaceManager();
	});

	describe('1. Normalizzazione percorsi e confronto radici sorelle', () => {
		it('normalizza separatori Windows e rimuove trailing slashes', () => {
			assert.equal(
				normalizeRoutingPath('C:\\Users\\Coldiretti\\repos\\portalino\\'),
				normalizeRoutingPath('c:/users/coldiretti/repos/portalino')
			);
		});

		it('riconosce che un worktree fratello NON e sottocartella del progetto principale', () => {
			const canonical = 'C:/repos/portalino';
			const siblingWorktree = 'C:/repos/.omp-wt-portalino-lane-auth';
			// Il vecchio startsWith ingenuo avrebbe potuto fallire o matchare prefissi comuni errati
			assert.equal(isPathEqualOrSubpath(canonical, siblingWorktree), false);
			assert.equal(isPathEqualOrSubpath(siblingWorktree, canonical), false);
		});

		it('riconosce correttamente sottocartelle legittime del worktree', () => {
			const worktree = 'C:/repos/.omp-wt-portalino-lane-auth';
			const subfolder = 'C:/repos/.omp-wt-portalino-lane-auth/src/components';
			assert.equal(isPathEqualOrSubpath(worktree, subfolder), true);
		});
	});

	describe('2. Risoluzione deterministica della corsia proprietaria', () => {
		const context: LaneResolutionContext = {
			projects: [
				{
					id: 'proj-portalino',
					canonicalProjectPath: 'C:/repos/portalino',
					lane: { laneId: 'main', workspacePath: 'C:/repos/portalino' }
				}
			],
			lanes: [
				{
					projectId: 'proj-portalino',
					laneId: 'main',
					workspacePath: 'C:/repos/portalino'
				},
				{
					projectId: 'proj-portalino',
					laneId: 'lane-auth',
					workspacePath: 'C:/repos/.omp-wt-portalino-lane-auth'
				},
				{
					projectId: 'proj-portalino',
					laneId: 'lane-tarature',
					workspacePath: 'C:/repos/.omp-wt-portalino-lane-tarature'
				}
			],
			sessions: [
				{
					sessionId: 'sess-main-1',
					projectKey: 'proj-portalino',
					laneId: 'main',
					cwd: 'C:/repos/portalino'
				},
				{
					sessionId: 'sess-auth-2',
					projectKey: 'proj-portalino',
					laneId: 'lane-auth',
					cwd: 'C:/repos/.omp-wt-portalino-lane-auth'
				}
			],
			activeProjectId: 'proj-portalino',
			activeLaneId: 'main'
		};

		it('risolve corsia per target esplicito projectId + laneId', () => {
			const res = resolveTargetLane(
				{
					projectId: 'proj-portalino',
					laneId: 'lane-auth'
				},
				context
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-portalino');
			assert.equal(res.laneId, 'lane-auth');
		});

		it('risolve corsia per sessionId registrato', () => {
			const res = resolveTargetLane(
				{
					sessionId: 'sess-auth-2'
				},
				context
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-portalino');
			assert.equal(res.laneId, 'lane-auth');
		});

		it('risolve corsia secondaria worktree tramite cwd sorella', () => {
			const res = resolveTargetLane(
				{
					cwd: 'C:\\repos\\.omp-wt-portalino-lane-auth'
				},
				context
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-portalino');
			assert.equal(res.laneId, 'lane-auth');
		});

		it('risolve corsia secondaria worktree tramite sottocartella del worktree', () => {
			const res = resolveTargetLane(
				{
					cwd: 'C:/repos/.omp-wt-portalino-lane-auth/src/views'
				},
				context
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-portalino');
			assert.equal(res.laneId, 'lane-auth');
		});

		it('risolve corsia Principale tramite il suo cwd', () => {
			const res = resolveTargetLane(
				{
					cwd: 'C:/repos/portalino/submodule'
				},
				context
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-portalino');
			assert.equal(res.laneId, 'main');
		});

		it('rifiuta la sostituzione con target incerto quando esistono piu corsie', () => {
			// CWD sconosciuto e nessun identificatore di sessione o corsia
			const res = resolveTargetLane(
				{
					cwd: 'D:/unrelated/path'
				},
				context
			);
			assert.equal(res.matched, false);
			assert.equal(res.isAmbiguous, true);
		});
	});

	describe('3. Legacy single-lane fallback (funziona se univoco)', () => {
		it('risolve automaticamente su single-lane quando esiste solo una corsia', () => {
			const singleContext: LaneResolutionContext = {
				projects: [
					{
						id: 'proj-single',
						canonicalProjectPath: 'C:/repos/single',
						lane: { laneId: 'main', workspacePath: 'C:/repos/single' }
					}
				],
				lanes: [
					{
						projectId: 'proj-single',
						laneId: 'main',
						workspacePath: 'C:/repos/single'
					}
				],
				activeProjectId: 'proj-single',
				activeLaneId: 'main'
			};

			const res = resolveTargetLane(
				{
					cwd: '' // payload legacy senza cwd o con cwd vuoto
				},
				singleContext
			);
			assert.equal(res.matched, true);
			assert.equal(res.projectId, 'proj-single');
			assert.equal(res.laneId, 'main');
		});

		it('rifiuta il fallback legacy se esistono piu corsie registrate', () => {
			const multiContext: LaneResolutionContext = {
				projects: [
					{
						id: 'proj-1',
						canonicalProjectPath: 'C:/repos/proj1',
						lane: { laneId: 'main', workspacePath: 'C:/repos/proj1' }
					}
				],
				lanes: [
					{
						projectId: 'proj-1',
						laneId: 'main',
						workspacePath: 'C:/repos/proj1'
					},
					{
						projectId: 'proj-1',
						laneId: 'lane-2',
						workspacePath: 'C:/repos/.omp-wt-proj1-lane2'
					}
				],
				activeProjectId: 'proj-1',
				activeLaneId: 'main'
			};

			const res = resolveTargetLane({}, multiContext);
			assert.equal(res.matched, false);
			assert.equal(res.isAmbiguous, true);
		});
	});

	describe('4. Isolamento superfici: diagrammi e anteprime tra corsie', () => {
		const context: LaneResolutionContext = {
			projects: [
				{
					id: 'proj-1',
					canonicalProjectPath: 'C:/repos/proj1',
					lane: { laneId: 'main', workspacePath: 'C:/repos/proj1' }
				}
			],
			lanes: [
				{
					projectId: 'proj-1',
					laneId: 'main',
					workspacePath: 'C:/repos/proj1'
				},
				{
					projectId: 'proj-1',
					laneId: 'lane-feature',
					workspacePath: 'C:/repos/.omp-wt-proj1-lane-feature'
				}
			],
			activeProjectId: 'proj-1',
			activeLaneId: 'main'
		};

		it('diagramma generato da worktree non altera la superficie della corsia Principale', () => {
			// Corsia principale inizia in stato editor
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'main').surface, 'editor');

			const diagramEvent: LaneDiagramPayload = {
				id: 'diag-feature-1',
				title: 'Diagramma Feature Worktree',
				mermaid: 'graph TD\nA-->B',
				cwd: 'C:/repos/.omp-wt-proj1-lane-feature',
				session_id: 'sess-feat-1'
			};

			const routeRes = surfaceStore.routeDiagramEvent(diagramEvent, context);
			assert.equal(routeRes.handled, true);
			assert.equal(routeRes.targetLaneId, 'lane-feature');

			// La corsia Principale deve rimanere intatta su 'editor'!
			const mainSurface = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(mainSurface.surface, 'editor');
			assert.equal(mainSurface.diagramPayload, null);

			// La corsia feature ha il diagramma pronto per la visualizzazione immediata!
			const featureSurface = surfaceStore.getLaneSurface('proj-1', 'lane-feature');
			assert.equal(featureSurface.surface, 'diagram');
			assert.equal(featureSurface.diagramPayload?.id, 'diag-feature-1');
			assert.equal(featureSurface.diagramPayload?.title, 'Diagramma Feature Worktree');
		});

		it('anteprima generata da worktree compare solo nella corsia secondaria', () => {
			const previewEvent: LanePreviewPayload = {
				id: 'prev-1',
				title: 'Card Prototipo',
				file_path: 'proto/card.html',
				cwd: 'C:/repos/.omp-wt-proj1-lane-feature',
				session_id: 'sess-feat-1'
			};

			const routeRes = surfaceStore.routePreviewEvent(previewEvent, context);
			assert.equal(routeRes.handled, true);
			assert.equal(routeRes.targetLaneId, 'lane-feature');

			// Principale non cambia
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'main').surface, 'editor');

			// Feature ha l'anteprima
			const featureSurface = surfaceStore.getLaneSurface('proj-1', 'lane-feature');
			assert.equal(featureSurface.surface, 'preview');
			assert.equal(featureSurface.previewFile, 'proto/card.html');
		});

		it('commutando tra corsie lo stato superficie e indipendente e istantaneo', () => {
			// Imposta Principale su diagramma
			surfaceStore.setLaneDiagram('proj-1', 'main', {
				id: 'diag-main',
				title: 'Diagramma Principale',
				mermaid: 'sequenceDiagram\nA->>B: Ping',
				cwd: 'C:/repos/proj1',
				session_id: 'sess-main'
			});

			// Imposta lane-feature su preview
			surfaceStore.setLanePreview('proj-1', 'lane-feature', 'proto/feature.html');

			// Verifica che la lettura per corsia dia esattamente il proprio stato
			const mainState = surfaceStore.getLaneSurface('proj-1', 'main');
			const featureState = surfaceStore.getLaneSurface('proj-1', 'lane-feature');

			assert.equal(mainState.surface, 'diagram');
			assert.equal(mainState.diagramPayload?.id, 'diag-main');

			assert.equal(featureState.surface, 'preview');
			assert.equal(featureState.previewFile, 'proto/feature.html');

			// Chiusura di una superficie su feature torna a 'editor' senza toccare Principale
			surfaceStore.closeLaneSurface('proj-1', 'lane-feature');
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'lane-feature').surface, 'editor');
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'main').surface, 'diagram');
		});
	});

	describe('5. Rilevamento tab Browser Live per corsia', () => {
		it('apertura tab su corsia A non altera la superficie di corsia B', () => {
			// Corsia A rileva tab passando da 0 a 1 -> apre browser
			surfaceStore.syncBrowserTabCount('proj-1', 'lane-a', 1, false);
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'lane-a').surface, 'browser');

			// Corsia B era su editor e resta su editor
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'lane-b').surface, 'editor');

			// Chiusura browser su corsia A
			surfaceStore.closeLaneSurface('proj-1', 'lane-a');
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'lane-a').surface, 'editor');
		});
	});
});
