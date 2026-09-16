/**
 * test/task-row.test.ts
 *
 * Test di unita' per il contratto osservabile degli adattatori TaskRow:
 * - mapping stati per TodoStatus e AgentProgress
 * - precedenza contrattuale fase (in_progress > blocked > pending > abandoned > completed)
 * - conteggio completed/total (solo completed al numeratore)
 * - gestione campi opzionali assenti e fallback
 * - stati blocked, abandoned, aborted
 * - adattatore job asincroni
 *
 * Non testa dettagli di implementazione CSS o markup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	mapTodoStatus,
	mapAgentStatus,
	resolvePhaseStatus,
	countPhaseCompleted,
	formatPhaseMetric,
	formatTokensMetric,
	isPillStatus,
	todoPhaseToTaskRow,
	agentProgressToTaskRow,
	asyncJobToTaskRow,
	aggregateTaskRowStats,
	type TaskRowStatus
} from '../src/lib/agent/taskRow.ts';
import type { TodoPhase, AgentProgress } from '../src/lib/agent/wire.ts';

describe('Adattatori TaskRow — Mapping stati', () => {
	it('mappa correttamente tutti i TodoStatus supportati', () => {
		assert.equal(mapTodoStatus('pending'), 'pending');
		assert.equal(mapTodoStatus('in_progress'), 'running');
		assert.equal(mapTodoStatus('completed'), 'completed');
		assert.equal(mapTodoStatus('blocked'), 'blocked');
		assert.equal(mapTodoStatus('abandoned'), 'abandoned');
		// Fallback su stato indefinito o sconosciuto
		assert.equal(mapTodoStatus(undefined), 'pending');
		assert.equal(mapTodoStatus('unknown_status'), 'pending');
	});

	it('mappa correttamente tutti gli AgentProgress status supportati', () => {
		assert.equal(mapAgentStatus('pending'), 'pending');
		assert.equal(mapAgentStatus('running'), 'running');
		assert.equal(mapAgentStatus('completed'), 'completed');
		assert.equal(mapAgentStatus('failed'), 'failed');
		assert.equal(mapAgentStatus('aborted'), 'aborted');
		assert.equal(mapAgentStatus('blocked'), 'blocked');
		assert.equal(mapAgentStatus('abandoned'), 'abandoned');
		// Fallback
		assert.equal(mapAgentStatus(undefined), 'pending');
		assert.equal(mapAgentStatus('custom_state'), 'pending');
	});

	it('riconosce gli stati che richiedono la pill (terminali e blocked)', () => {
		const pillStates: TaskRowStatus[] = ['completed', 'failed', 'blocked', 'abandoned', 'aborted'];
		const nonPillStates: TaskRowStatus[] = ['pending', 'running'];

		for (const s of pillStates) {
			assert.equal(isPillStatus(s), true, `Stato ${s} dovrebbe avere la pill`);
		}
		for (const s of nonPillStates) {
			assert.equal(isPillStatus(s), false, `Stato ${s} NON dovrebbe avere la pill`);
		}
	});
});

describe('Adattatori TaskRow — Precedenza di fase', () => {
	it('assegna priorita assoluta a in_progress su tutti gli altri stati', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'abandoned' },
			{ status: 'blocked' },
			{ status: 'pending' },
			{ status: 'in_progress' }
		];
		assert.equal(resolvePhaseStatus(tasks), 'running');
	});

	it('assegna priorita a blocked quando nessun task e in_progress', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'abandoned' },
			{ status: 'pending' },
			{ status: 'blocked' }
		];
		assert.equal(resolvePhaseStatus(tasks), 'blocked');
	});

	it('assegna priorita a pending quando non ci sono in_progress o blocked', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'abandoned' },
			{ status: 'pending' }
		];
		assert.equal(resolvePhaseStatus(tasks), 'pending');
	});

	it('assegna priorita ad abandoned quando ci sono solo abandoned e completed', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'abandoned' },
			{ status: 'completed' }
		];
		assert.equal(resolvePhaseStatus(tasks), 'abandoned');
	});

	it('risolve a completed solo se TUTTI i task sono completati', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'completed' },
			{ status: 'completed' }
		];
		assert.equal(resolvePhaseStatus(tasks), 'completed');
	});

	it('gestisce lista vuota o null/undefined ripiegando su pending', () => {
		assert.equal(resolvePhaseStatus([]), 'pending');
		assert.equal(resolvePhaseStatus(null), 'pending');
		assert.equal(resolvePhaseStatus(undefined), 'pending');
	});
});

describe('Adattatori TaskRow — Conteggio completed/total', () => {
	it('conta ESCLUSIVAMENTE i task completed al numeratore (mai abandoned o altri)', () => {
		const tasks = [
			{ status: 'completed' },
			{ status: 'completed' },
			{ status: 'abandoned' },
			{ status: 'blocked' },
			{ status: 'in_progress' },
			{ status: 'pending' }
		];
		const counts = countPhaseCompleted(tasks);
		assert.equal(counts.completed, 2, 'Il numeratore deve contare solo completed');
		assert.equal(counts.total, 6, 'Il denominatore deve essere il totale');
		assert.equal(formatPhaseMetric(counts.completed, counts.total), '2/6');
	});

	it('restituisce 0/0 per liste vuote', () => {
		const counts = countPhaseCompleted([]);
		assert.equal(counts.completed, 0);
		assert.equal(counts.total, 0);
	});
});

describe('Adattatori TaskRow — Formattazione metrica token', () => {
	it('formatta token in scala k e M', () => {
		assert.equal(formatTokensMetric(0), '0');
		assert.equal(formatTokensMetric(-10), '0');
		assert.equal(formatTokensMetric(undefined), '0');
		assert.equal(formatTokensMetric(450), '450');
		assert.equal(formatTokensMetric(1_500), '1.5k');
		assert.equal(formatTokensMetric(15_000), '15k');
		assert.equal(formatTokensMetric(1_200_000), '1.2M');
		assert.equal(formatTokensMetric(25_000_000), '25M');
	});

	it('promuove 1000k a 1.0M al confine di arrotondamento', () => {
		assert.equal(formatTokensMetric(999_950), '1.0M');
		assert.equal(formatTokensMetric(999_999), '1.0M');
		assert.equal(formatTokensMetric(1_000_000), '1.0M');
	});
});

describe('Adattatori TaskRow — todoPhaseToTaskRow', () => {
	it('trasforma una TodoPhase completa con task e blocker', () => {
		const phase: TodoPhase = {
			id: 'phase-prep',
			name: 'Preparazione ambiente',
			tasks: [
				{ id: 't1', content: 'Verifica dipendenze', status: 'completed' },
				{ id: 't2', content: 'Configurazione proxy', status: 'blocked', blocker: 'Porta 8080 occupata' },
				{ id: 't3', content: 'Avvio container', status: 'pending' }
			]
		};

		const row = todoPhaseToTaskRow(phase, 0);

		assert.equal(row.key, 'phase-prep');
		assert.equal(row.label, 'Preparazione ambiente');
		assert.equal(row.status, 'blocked');
		assert.equal(row.ringNumber, 1);
		assert.equal(row.metric, '1/3');
		assert.equal(row.expandable, true);
		assert.ok(row.details);
		assert.equal(row.details.items?.length, 3);
		assert.equal(row.details.items[1].status, 'blocked');
		assert.equal(row.details.items[1].blocker, 'Porta 8080 occupata');
	});

	it('gestisce TodoPhase priva di task rendendola non espandibile', () => {
		const phase: TodoPhase = {
			name: 'Fase vuota',
			tasks: []
		};

		const row = todoPhaseToTaskRow(phase);

		assert.equal(row.label, 'Fase vuota');
		assert.equal(row.status, 'pending');
		assert.equal(row.expandable, false);
		assert.equal(row.metric, undefined);
		assert.equal(row.details, undefined);
	});

	it('gestisce campi opzionali assenti senza sollevare eccezioni', () => {
		const phase: TodoPhase = {
			name: '',
			tasks: [
				{ content: 'Task anonimo', status: 'completed' }
			]
		};

		const row = todoPhaseToTaskRow(phase);
		assert.equal(row.label, 'Todo');
		assert.equal(row.status, 'completed');
		assert.equal(row.metric, '1/1');
		assert.equal(row.expandable, true);
	});

	it('genera chiavi deterministiche di fallback per task privi di id basate su fase e indice', () => {
		const phase: TodoPhase = {
			id: 'phase-review',
			name: 'Revisione',
			tasks: [
				{ content: 'Stesso testo', status: 'pending' },
				{ content: 'Stesso testo', status: 'completed' }
			]
		};

		const row = todoPhaseToTaskRow(phase, 2);
		assert.ok(row.details?.items);
		assert.equal(row.details.items[0].id, 'phase-review-task-0');
		assert.equal(row.details.items[1].id, 'phase-review-task-1');
		assert.notEqual(row.details.items[0].id, row.details.items[1].id);
	});
});

describe('Adattatori TaskRow — agentProgressToTaskRow', () => {
	it('trasforma un AgentProgress completo con metriche e dettagli', () => {
		const progress: AgentProgress = {
			id: 'agent-worker-1',
			agent: 'scout',
			status: 'running',
			index: 2,
			resolvedModel: 'claude-3-5-sonnet',
			task: 'Esplorazione repository',
			description: 'Scansione percorsi file',
			lastIntent: 'Lettura file di configurazione',
			tokens: 4500,
			cost: 0.0135,
			recentTools: [{ tool: 'read', endMs: 120 }]
		};

		const row = agentProgressToTaskRow(progress);

		assert.equal(row.key, 'agent-worker-1');
		assert.equal(row.label, 'agent-worker-1');
		assert.equal(row.subtitle, 'scout');
		assert.equal(row.status, 'running');
		assert.equal(row.ringNumber, 3);
		assert.equal(row.metric, '4.5k');
		assert.equal(row.expandable, true);
		assert.ok(row.details);
		assert.equal(row.details.model, 'claude-3-5-sonnet');
		assert.equal(row.details.tokens, 4500);
		assert.equal(row.details.cost, 0.0135);
		assert.equal(row.details.lastIntent, 'Lettura file di configurazione');
	});

	it('gestisce stati terminali e di fallimento come aborted e failed', () => {
		const failedProgress: AgentProgress = {
			id: 'agent-fail',
			status: 'failed',
			description: 'Connessione interrotta'
		};
		const abortedProgress: AgentProgress = {
			id: 'agent-abort',
			status: 'aborted',
			description: 'Annullato manualmente'
		};

		const rowFail = agentProgressToTaskRow(failedProgress);
		const rowAbort = agentProgressToTaskRow(abortedProgress);

		assert.equal(rowFail.status, 'failed');
		assert.equal(rowAbort.status, 'aborted');
	});

	it('gestisce campi opzionali assenti in AgentProgress minimale', () => {
		const minimal: AgentProgress = {};

		const row = agentProgressToTaskRow(minimal, 0);

		assert.equal(row.key, 'agent-0');
		assert.equal(row.label, 'subagent');
		assert.equal(row.subtitle, undefined);
		assert.equal(row.status, 'pending');
		assert.equal(row.expandable, false);
		assert.equal(row.details, undefined);
		assert.equal(row.metric, undefined);
	});
});

describe('Adattatori TaskRow — asyncJobToTaskRow', () => {
	it('adatta correttamente un job asincrono di background', () => {
		const job = {
			id: 'job-build-1',
			name: 'Build assets',
			status: 'completed',
			summary: 'Compilazione completata in 4.2s',
			durationMs: 4200
		};

		const row = asyncJobToTaskRow(job, 0);

		assert.equal(row.key, 'job-build-1');
		assert.equal(row.label, 'Build assets');
		assert.equal(row.status, 'completed');
		assert.equal(row.ringNumber, 1);
		assert.equal(row.expandable, true);
		assert.equal(row.details?.description, 'Compilazione completata in 4.2s');
		assert.equal(row.details?.durationMs, 4200);
	});

	it('mappa cancelled ad abandoned per coerenza col modello TaskRow', () => {
		const job = {
			id: 'job-cancelled',
			status: 'cancelled'
		};

		const row = asyncJobToTaskRow(job);
		assert.equal(row.status, 'abandoned');
		assert.equal(row.expandable, false);
	});
});

describe('Adattatori TaskRow — aggregateTaskRowStats', () => {
	it('calcola correttamente i totali per ogni stato', () => {
		const rows = [
			{ key: '1', label: '1', status: 'completed', expandable: false },
			{ key: '2', label: '2', status: 'completed', expandable: false },
			{ key: '3', label: '3', status: 'running', expandable: false },
			{ key: '4', label: '4', status: 'failed', expandable: false },
			{ key: '5', label: '5', status: 'blocked', expandable: false },
			{ key: '6', label: '6', status: 'abandoned', expandable: false },
			{ key: '7', label: '7', status: 'aborted', expandable: false },
			{ key: '8', label: '8', status: 'pending', expandable: false }
		];

		const stats = aggregateTaskRowStats(rows);

		assert.equal(stats.total, 8);
		assert.equal(stats.completed, 2);
		assert.equal(stats.running, 1);
		assert.equal(stats.failed, 1);
		assert.equal(stats.blocked, 1);
		assert.equal(stats.abandoned, 1);
		assert.equal(stats.aborted, 1);
		assert.equal(stats.pending, 1);
	});
});
