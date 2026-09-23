/**
 * W09 Contract Test: routing deterministico della coda e slot automatico.
 *
 * Difende le invarianti del Gate R27 / PLAN W09:
 * 1. Click su un task: `Principale` libera -> `Principale`; `Principale` al
 *    lavoro -> prompt; `Shift` + click -> nuova corsia senza dialog.
 * 2. La corsia visibile non riceve task che non le sono stati assegnati.
 * 3. Auto-dispatch: un solo slot worktree automatico per progetto, occupato
 *    fino ad archiviazione; le corsie manuali sospendono l'auto-avvio.
 * 4. Soft-cap dal terzo agente simultaneo, con modelli e processi attivi.
 * 5. La coda resta ancorata alla radice canonica anche quando la spedizione
 *    avviene dentro un worktree.
 * 6. Lo storico distingue i lanci `main` dai lanci `worktree`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildConcurrencyWarning,
	decideAutoDispatch,
	decideQueueRoute,
	resolveQueueRoot,
	shouldWarnConcurrency,
	type LaneDispatchSnapshot
} from '../src/lib/lanes/queueDispatch.ts';
import {
	isTaskSessionOrigin,
	taskRunFromOrigin,
	type TaskSessionOrigin
} from '../src/lib/stores/taskSerialization.ts';
import {
	laneRecordFromAgentLane,
	parseLaneStoreDocument,
	serializeLaneStoreDocument,
	type LaneRecord
} from '../src/lib/stores/lanePersistence.ts';
import {
	canonicalProjectPath,
	createMainLane,
	laneId,
	projectId,
	workspacePath
} from '../src/lib/types/lanes.ts';

const PROJECT_ID = projectId('project-1');
const CANONICAL = 'C:/Users/dev/repos/app';

function mainLane(overrides: Partial<LaneDispatchSnapshot> = {}): LaneDispatchSnapshot {
	return {
		laneId: 'main',
		title: 'Principale',
		origin: 'main',
		status: 'active',
		busy: false,
		...overrides
	};
}

function workLane(
	id: string,
	overrides: Partial<LaneDispatchSnapshot> = {}
): LaneDispatchSnapshot {
	return {
		laneId: id,
		title: `Worktree ${id}`,
		origin: 'manual',
		status: 'active',
		busy: true,
		...overrides
	};
}

describe('W09 — Routing della coda verso le corsie', () => {
	describe('1. Click e Shift+click', () => {
		it('manda il task a Principale quando Principale e\' libera', () => {
			const route = decideQueueRoute({
				lanes: [mainLane()],
				worktreeCapable: true
			});
			assert.deepEqual(route, { kind: 'main' });
		});

		it('chiede conferma quando Principale sta lavorando', () => {
			const route = decideQueueRoute({
				lanes: [mainLane({ busy: true })],
				worktreeCapable: true
			});
			assert.equal(route.kind, 'prompt');
		});

		it('con Shift crea subito una corsia, anche a Principale libera', () => {
			const route = decideQueueRoute({
				shiftKey: true,
				lanes: [mainLane()],
				worktreeCapable: true
			});
			assert.deepEqual(route, { kind: 'new-lane', confirmConcurrency: false });
		});

		it('non puo\' isolare un progetto senza radice canonica', () => {
			const busy = decideQueueRoute({
				lanes: [mainLane({ busy: true })],
				worktreeCapable: false
			});
			assert.deepEqual(busy, { kind: 'blocked', reason: 'no-worktree-support' });
			const forced = decideQueueRoute({
				shiftKey: true,
				lanes: [mainLane()],
				worktreeCapable: false
			});
			assert.deepEqual(forced, { kind: 'blocked', reason: 'no-worktree-support' });
		});
	});

	describe('2. La corsia visibile non cattura i task', () => {
		it('con Principale libera il task va a Principale anche con corsie aperte', () => {
			const route = decideQueueRoute({
				lanes: [mainLane(), workLane('wt-1', { busy: false }), workLane('wt-2')],
				worktreeCapable: true
			});
			assert.deepEqual(route, { kind: 'main' });
		});

		it('con Principale occupata nasce una corsia nuova, non si riusa una esistente', () => {
			const route = decideQueueRoute({
				shiftKey: true,
				lanes: [mainLane({ busy: true }), workLane('wt-1', { busy: false })],
				worktreeCapable: true
			});
			assert.equal(route.kind, 'new-lane');
		});
	});

	describe('3. Slot unico dell\'auto-dispatch', () => {
		it('usa Principale quando e\' libera', () => {
			const decision = decideAutoDispatch({
				lanes: [mainLane()],
				worktreeCapable: true
			});
			assert.deepEqual(decision, { kind: 'main' });
		});

		it('apre una sola corsia automatica con Principale occupata', () => {
			const first = decideAutoDispatch({
				lanes: [mainLane({ busy: true })],
				worktreeCapable: true
			});
			assert.deepEqual(first, { kind: 'new-lane' });

			const second = decideAutoDispatch({
				lanes: [mainLane({ busy: true }), workLane('wt-1', { origin: 'auto' })],
				worktreeCapable: true
			});
			assert.deepEqual(second, { kind: 'wait', reason: 'auto-slot-busy' });
		});

		it('tiene lo slot occupato anche a corsia automatica ferma o in revisione', () => {
			for (const lane of [
				workLane('wt-1', { origin: 'auto', busy: false }),
				workLane('wt-1', { origin: 'auto', busy: false, status: 'review_ready' }),
				workLane('wt-1', { origin: 'auto', busy: false, status: 'conflict' })
			]) {
				const decision = decideAutoDispatch({
					lanes: [mainLane({ busy: true }), lane],
					worktreeCapable: true
				});
				assert.deepEqual(decision, { kind: 'wait', reason: 'auto-slot-busy' });
			}
		});

		it('libera lo slot solo dopo merge o rifiuto (corsia archiviata)', () => {
			const decision = decideAutoDispatch({
				lanes: [
					mainLane({ busy: true }),
					workLane('wt-1', { origin: 'auto', busy: false, status: 'archived' })
				],
				worktreeCapable: true
			});
			assert.deepEqual(decision, { kind: 'new-lane' });
		});

		it('le corsie manuali sospendono l\'auto-avvio', () => {
			const decision = decideAutoDispatch({
				lanes: [mainLane({ busy: true }), workLane('wt-1', { origin: 'manual', busy: false })],
				worktreeCapable: true
			});
			assert.deepEqual(decision, { kind: 'wait', reason: 'manual-lanes-active' });
		});

		it('5 task con Principale occupata generano una sola corsia automatica', () => {
			const lanes: LaneDispatchSnapshot[] = [mainLane({ busy: true })];
			let created = 0;
			let dispatchedOnMain = 0;
			for (let task = 0; task < 5; task++) {
				const decision = decideAutoDispatch({ lanes, worktreeCapable: true });
				if (decision.kind === 'new-lane') {
					created += 1;
					lanes.push(workLane(`auto-${created}`, { origin: 'auto' }));
				} else if (decision.kind === 'main') {
					dispatchedOnMain += 1;
				}
			}
			assert.equal(created, 1);
			assert.equal(dispatchedOnMain, 0);
			assert.equal(lanes.filter((lane) => lane.origin === 'auto').length, 1);
		});

		it('il rollback di un task non duplica la corsia automatica', () => {
			// Il task torna in coda dopo un fallimento di consegna: la corsia
			// automatica e' ancora viva, quindi lo slot resta suo.
			const lanes = [mainLane({ busy: true }), workLane('auto-1', { origin: 'auto' })];
			const retry = decideAutoDispatch({ lanes, worktreeCapable: true });
			assert.deepEqual(retry, { kind: 'wait', reason: 'auto-slot-busy' });

			// La corsia creata e mai usata viene archiviata come 'rifiutata':
			// solo allora l'auto-dispatch puo' riprovare, una volta sola.
			const afterCleanup: LaneDispatchSnapshot[] = [
				mainLane({ busy: true }),
				workLane('auto-1', { origin: 'auto', busy: false, status: 'archived' })
			];
			const second = decideAutoDispatch({ lanes: afterCleanup, worktreeCapable: true });
			assert.deepEqual(second, { kind: 'new-lane' });
			afterCleanup.push(workLane('auto-2', { origin: 'auto' }));
			assert.deepEqual(decideAutoDispatch({ lanes: afterCleanup, worktreeCapable: true }), {
				kind: 'wait',
				reason: 'auto-slot-busy'
			});
		});
	});

	describe('4. Soft-cap dal terzo agente', () => {
		it('scatta solo dal terzo agente simultaneo', () => {
			assert.equal(shouldWarnConcurrency(1), false);
			assert.equal(shouldWarnConcurrency(2), true);
		});

		it('il click chiede conferma quando la corsia sarebbe la terza', () => {
			const lanes = [mainLane({ busy: true }), workLane('wt-1')];
			const route = decideQueueRoute({ shiftKey: true, lanes, worktreeCapable: true });
			assert.deepEqual(route, { kind: 'new-lane', confirmConcurrency: true });
		});

		it('il riepilogo elenca modelli, provider e processi attivi', () => {
			const warning = buildConcurrencyWarning([
				mainLane({ busy: true, liveProcess: true, model: { provider: 'anthropic', id: 'opus' } }),
				workLane('wt-1', { model: { provider: 'openai', id: 'gpt-5' }, liveProcess: false }),
				workLane('wt-2', { status: 'archived' })
			]);
			assert.equal(warning.activeAgents, 2);
			assert.deepEqual(warning.lanes, [
				{ title: 'Principale', model: 'anthropic/opus', liveProcess: true },
				{ title: 'Worktree wt-1', model: 'openai/gpt-5', liveProcess: false }
			]);
		});
	});

	describe('5. Coda ancorata alla radice canonica', () => {
		it('il workspace di una corsia non diventa mai la chiave della coda', () => {
			const resolved = resolveQueueRoot(
				{ canonicalProjectPath: CANONICAL },
				'C:/Users/dev/repos/.omp-wt-app-wt-1'
			);
			assert.equal(resolved.path, CANONICAL);
			assert.equal(resolved.redirected, true);
		});

		it('la Principale non risulta reindirizzata', () => {
			const resolved = resolveQueueRoot({ canonicalProjectPath: CANONICAL }, CANONICAL);
			assert.equal(resolved.path, CANONICAL);
			assert.equal(resolved.redirected, false);
		});

		it('senza radice canonica non esiste coda da scrivere', () => {
			assert.deepEqual(resolveQueueRoot({ canonicalProjectPath: null }, '/tmp/wt'), {
				path: null,
				redirected: false
			});
		});
	});

	describe('6. Storico: main e worktree restano distinguibili', () => {
		const base: TaskSessionOrigin = {
			projectPath: CANONICAL.toLowerCase(),
			sessionId: 'session-9',
			taskId: 'task-9',
			title: 'Aggiorna il changelog',
			launchedAt: 1_700_000_000_000
		};

		it('un lancio in worktree conserva corsia, branch e workspace', () => {
			const origin: TaskSessionOrigin = {
				...base,
				laneId: 'wt-1',
				laneTitle: 'Aggiorna il changelog',
				laneKind: 'worktree',
				workspacePath: 'C:/Users/dev/repos/.omp-wt-app-wt-1',
				branch: 'omp/lane-wt-1',
				targetBranch: 'main'
			};
			assert.equal(isTaskSessionOrigin(origin), true);
			const run = taskRunFromOrigin(origin, PROJECT_ID);
			assert.equal(run.laneKind, 'worktree');
			assert.equal(run.laneId, 'wt-1');
			assert.equal(run.branch, 'omp/lane-wt-1');
			assert.equal(run.targetBranch, 'main');
			// `workspacePath` normalizza i separatori per la piattaforma corrente:
			// il confronto passa dalla stessa normalizzazione, non da una stringa fissa.
			assert.equal(run.workspacePath, workspacePath('C:/Users/dev/repos/.omp-wt-app-wt-1'));
		});

		it('i lanci precedenti alle corsie valgono come Principale', () => {
			const run = taskRunFromOrigin(base, PROJECT_ID);
			assert.equal(run.laneKind, 'main');
			assert.equal(run.laneId, 'main');
			assert.equal(run.workspacePath, workspacePath(base.projectPath));
		});

		it('rifiuta un tipo di corsia sconosciuto', () => {
			assert.equal(isTaskSessionOrigin({ ...base, laneKind: 'lane' }), false);
		});
	});

	describe('7. Provenienza della corsia persistita', () => {
		it('sopravvive al round-trip di lanes.json', () => {
			const main = laneRecordFromAgentLane(
				createMainLane(PROJECT_ID, canonicalProjectPath(CANONICAL), 'gui')
			);
			const auto: LaneRecord = {
				...main,
				laneId: laneId('wt-1'),
				title: 'Worktree 1',
				origin: 'auto',
				workspacePath: workspacePath('C:/Users/dev/repos/.omp-wt-app-wt-1'),
				branch: 'omp/lane-wt-1'
			};
			const parsed = parseLaneStoreDocument(serializeLaneStoreDocument([main, auto], [], 3));
			assert.ok(parsed);
			assert.deepEqual(
				parsed.lanes.map((lane) => lane.origin),
				['main', 'auto']
			);
		});

		it('un registro scritto prima di W09 non perde le corsie', () => {
			const main = laneRecordFromAgentLane(
				createMainLane(PROJECT_ID, canonicalProjectPath(CANONICAL), 'gui')
			);
			const document = serializeLaneStoreDocument(
				[main, { ...main, laneId: laneId('wt-1'), title: 'Worktree 1', origin: 'auto' }],
				[],
				1
			);
			for (const lane of document.lanes) {
				delete (lane as Partial<{ origin: unknown }>).origin;
			}
			const parsed = parseLaneStoreDocument(document);
			assert.ok(parsed);
			// Provenienza ignota = manuale: l'auto-dispatch resta in pausa invece
			// di rivendicare uno slot che non sa di avere gia' speso.
			assert.deepEqual(
				parsed.lanes.map((lane) => lane.origin),
				['main', 'manual']
			);
		});
	});
});
