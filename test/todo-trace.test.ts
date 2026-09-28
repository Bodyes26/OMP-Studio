import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	deriveTodoTraces,
	TodoTraceTracker,
	extractPhasesFromCall,
	type TodoCallInput
} from '../src/lib/agent/todoTrace';
import type { TodoPhase } from '../src/lib/agent/wire';

describe('todoTrace — estrazione e tracciamento eventi todo (Gate R32 - C12)', () => {
	it('estrae fasi sia da payload details che da args.list', () => {
		const callFromDetails: TodoCallInput = {
			result: {
				details: {
					op: 'update',
					phases: [
						{
							name: 'Fase 1',
							tasks: [
								{ content: 'Compito 1', status: 'completed' },
								{ content: 'Compito 2', status: 'in_progress' }
							]
						}
					]
				}
			}
		};

		const extracted = extractPhasesFromCall(callFromDetails);
		assert.equal(extracted.op, 'update');
		assert.equal(extracted.phases.length, 1);
		assert.equal(extracted.phases[0].tasks.length, 2);
		assert.equal(extracted.phases[0].tasks[1].status, 'in_progress');

		const callFromArgs: TodoCallInput = {
			args: {
				op: 'init',
				list: [
					{
						name: 'Fase Unica',
						tasks: [{ content: 'Inizializza repo', status: 'pending' }]
					}
				]
			}
		};

		const fromArgs = extractPhasesFromCall(callFromArgs);
		assert.equal(fromArgs.op, 'init');
		assert.equal(fromArgs.phases[0].tasks[0].content, 'Inizializza repo');
	});

	it('genera traccia creazione e marcatore nuovo attivo al primo step', () => {
		const tracker = new TodoTraceTracker();

		const initialPhases: TodoPhase[] = [
			{
				id: 'p1',
				name: 'Implementazione',
				tasks: [
					{ id: 't1', content: 'Scrivere test', status: 'in_progress' },
					{ id: 't2', content: 'Implementare logica', status: 'pending' },
					{ id: 't3', content: 'Rifinire stili', status: 'pending' }
				]
			}
		];

		const traces = tracker.process({ phases: initialPhases, op: 'init' });

		// Deve generare la creazione iniziale e il primo step marker attivo
		assert.equal(traces.length, 2);
		assert.equal(traces[0].type, 'creation');
		if (traces[0].type === 'creation') {
			assert.equal(traces[0].total, 3);
			assert.equal(traces[0].completed, 0);
		}

		assert.equal(traces[1].type, 'step');
		if (traces[1].type === 'step') {
			assert.equal(traces[1].globalIndex, 1);
			assert.equal(traces[1].total, 3);
			assert.equal(traces[1].title, 'Scrivere test');
			assert.equal(traces[1].status, 'in_progress');
		}
	});

	it('genera marcatore quando il todo attivo avanza (nuovo attivo)', () => {
		const tracker = new TodoTraceTracker();

		const step1Phases: TodoPhase[] = [
			{
				name: 'Lavoro',
				tasks: [
					{ id: 't1', content: 'Task 1', status: 'in_progress' },
					{ id: 't2', content: 'Task 2', status: 'pending' }
				]
			}
		];

		const step2Phases: TodoPhase[] = [
			{
				name: 'Lavoro',
				tasks: [
					{ id: 't1', content: 'Task 1', status: 'completed' },
					{ id: 't2', content: 'Task 2', status: 'in_progress' }
				]
			}
		];

		tracker.process({ phases: step1Phases });
		const step2Traces = tracker.process({ phases: step2Phases });

		assert.equal(step2Traces.length, 1);
		assert.equal(step2Traces[0].type, 'step');
		if (step2Traces[0].type === 'step') {
			assert.equal(step2Traces[0].globalIndex, 2);
			assert.equal(step2Traces[0].total, 2);
			assert.equal(step2Traces[0].title, 'Task 2');
			assert.equal(step2Traces[0].status, 'in_progress');
		}
	});

	it('ignora aggiornamenti che non cambiano il todo attivo', () => {
		const tracker = new TodoTraceTracker();

		const phaseA: TodoPhase[] = [
			{
				name: 'Lavoro',
				tasks: [
					{ id: 't1', content: 'Task 1', status: 'in_progress' },
					{ id: 't2', content: 'Task 2', status: 'pending' }
				]
			}
		];

		// Chiamata 1: attiva t1
		tracker.process({ phases: phaseA });

		// Chiamata 2: heartbeat o metadata senza cambio di task attivo
		const repeatTraces = tracker.process({
			phases: [
				{
					name: 'Lavoro',
					tasks: [
						{ id: 't1', content: 'Task 1', status: 'in_progress' },
						{ id: 't2', content: 'Task 2', status: 'pending' }
					]
				}
			]
		});

		assert.equal(repeatTraces.length, 0, 'Nessuna riga deve essere generata se attivo non cambia');
	});

	it('genera intestazione di fase e marcatore al cambio di fase (>1 fase)', () => {
		const tracker = new TodoTraceTracker();

		const multiPhasesStart: TodoPhase[] = [
			{
				name: 'Fase Prep',
				tasks: [{ id: 't1', content: 'Setup env', status: 'in_progress' }]
			},
			{
				name: 'Fase Build',
				tasks: [{ id: 't2', content: 'Compilazione', status: 'pending' }]
			}
		];

		const initTraces = tracker.process({ phases: multiPhasesStart });
		// Include creazione + phase_header(Fase Prep) + step(Setup env)
		assert.equal(initTraces.length, 3);
		assert.equal(initTraces[0].type, 'creation');
		assert.equal(initTraces[1].type, 'phase_header');
		if (initTraces[1].type === 'phase_header') {
			assert.equal(initTraces[1].phaseName, 'Fase Prep');
		}
		assert.equal(initTraces[2].type, 'step');

		// Ora passa a Fase Build
		const multiPhasesNext: TodoPhase[] = [
			{
				name: 'Fase Prep',
				tasks: [{ id: 't1', content: 'Setup env', status: 'completed' }]
			},
			{
				name: 'Fase Build',
				tasks: [{ id: 't2', content: 'Compilazione', status: 'in_progress' }]
			}
		];

		const nextTraces = tracker.process({ phases: multiPhasesNext });
		assert.equal(nextTraces.length, 2);
		assert.equal(nextTraces[0].type, 'phase_header');
		if (nextTraces[0].type === 'phase_header') {
			assert.equal(nextTraces[0].phaseName, 'Fase Build');
		}
		assert.equal(nextTraces[1].type, 'step');
		if (nextTraces[1].type === 'step') {
			assert.equal(nextTraces[1].globalIndex, 2);
			assert.equal(nextTraces[1].total, 2);
			assert.equal(nextTraces[1].title, 'Compilazione');
		}
	});

	it('produce un marcatore per todo bloccato con motivo blocker', () => {
		const tracker = new TodoTraceTracker();

		const phasesRunning: TodoPhase[] = [
			{
				name: 'Lavoro',
				tasks: [
					{ id: 't1', content: 'Connessione DB', status: 'in_progress' },
					{ id: 't2', content: 'Query', status: 'pending' }
				]
			}
		];

		tracker.process({ phases: phasesRunning });

		const phasesBlocked: TodoPhase[] = [
			{
				name: 'Lavoro',
				tasks: [
					{
						id: 't1',
						content: 'Connessione DB',
						status: 'blocked',
						blocker: 'Credenziali mancanti in Parametri.ini'
					},
					{ id: 't2', content: 'Query', status: 'pending' }
				]
			}
		];

		const blockedTraces = tracker.process({ phases: phasesBlocked });
		assert.equal(blockedTraces.length, 1);
		assert.equal(blockedTraces[0].type, 'step');
		if (blockedTraces[0].type === 'step') {
			assert.equal(blockedTraces[0].status, 'blocked');
			assert.equal(blockedTraces[0].blocker, 'Credenziali mancanti in Parametri.ini');
			assert.equal(blockedTraces[0].title, 'Connessione DB');
		}
	});

	it('produce evento di completamento finale quando tutti i todo sono completati', () => {
		const tracker = new TodoTraceTracker();

		const step1: TodoPhase[] = [
			{
				name: 'Unica',
				tasks: [{ id: 't1', content: 'Solo compito', status: 'in_progress' }]
			}
		];

		tracker.process({ phases: step1 });

		const step2: TodoPhase[] = [
			{
				name: 'Unica',
				tasks: [{ id: 't1', content: 'Solo compito', status: 'completed' }]
			}
		];

		const doneTraces = tracker.process({ phases: step2 });
		assert.equal(doneTraces.length, 1);
		assert.equal(doneTraces[0].type, 'completion');
		if (doneTraces[0].type === 'completion') {
			assert.equal(doneTraces[0].total, 1);
			assert.equal(doneTraces[0].completed, 1);
		}

		// Ulteriori chiamate con stato tutto completato non duplicano la riga di completamento
		const repeatDone = tracker.process({ phases: step2 });
		assert.equal(repeatDone.length, 0);
	});

	it('rileva lista ricreata e reimposta il tracciamento', () => {
		const tracker = new TodoTraceTracker();

		const firstPlan: TodoPhase[] = [
			{
				name: 'Piano A',
				tasks: [{ id: 'a1', content: 'Task A', status: 'completed' }]
			}
		];

		tracker.process({ phases: firstPlan });

		// Nuova lista con op: 'init'
		const secondPlan: TodoPhase[] = [
			{
				name: 'Piano B',
				tasks: [
					{ id: 'b1', content: 'Task B1', status: 'in_progress' },
					{ id: 'b2', content: 'Task B2', status: 'pending' }
				]
			}
		];

		const recreatedTraces = tracker.process({ phases: secondPlan, op: 'init' });
		assert.equal(recreatedTraces.length, 2);
		assert.equal(recreatedTraces[0].type, 'creation');
		if (recreatedTraces[0].type === 'creation') {
			assert.equal(recreatedTraces[0].total, 2);
			assert.equal(recreatedTraces[0].completed, 0);
		}
		assert.equal(recreatedTraces[1].type, 'step');
		if (recreatedTraces[1].type === 'step') {
			assert.equal(recreatedTraces[1].title, 'Task B1');
			assert.equal(recreatedTraces[1].globalIndex, 1);
			assert.equal(recreatedTraces[1].total, 2);
		}
	});

	it('funzione pura deriveTodoTraces elabora sequenza completa correttamente', () => {
		const calls: TodoCallInput[] = [
			{
				phases: [
					{
						name: 'Fase',
						tasks: [
							{ id: '1', content: 'A', status: 'in_progress' },
							{ id: '2', content: 'B', status: 'pending' }
						]
					}
				]
			},
			{
				phases: [
					{
						name: 'Fase',
						tasks: [
							{ id: '1', content: 'A', status: 'completed' },
							{ id: '2', content: 'B', status: 'in_progress' }
						]
					}
				]
			},
			{
				phases: [
					{
						name: 'Fase',
						tasks: [
							{ id: '1', content: 'A', status: 'completed' },
							{ id: '2', content: 'B', status: 'completed' }
						]
					}
				]
			}
		];

		const traces = deriveTodoTraces(calls);
		// 1: creation + step(1/2 A)
		// 2: step(2/2 B)
		// 3: completion(2 di 2)
		assert.equal(traces.length, 4);
		assert.equal(traces[0].type, 'creation');
		assert.equal(traces[1].type, 'step');
		assert.equal(traces[2].type, 'step');
		assert.equal(traces[3].type, 'completion');
	});
});
