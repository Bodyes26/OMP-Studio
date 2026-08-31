import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parsePersistedState,
	sanitizeLoadedTasks,
	applyTaskModeDirectives,
	isStudioTask,
	isTaskSessionOrigin,
	serializeTaskState,
	parseProjectTasksFile,
	serializeProjectTasksFile,
	rankFrequentTaskModelConfigurations,
	type StudioTask,
	type PersistedTaskState
} from '../src/lib/stores/taskSerialization.ts';
import {
	type TaskDirective,
	type TaskDirectiveSnapshot,
	FACTORY_DIRECTIVES,
	createDirectiveSnapshot,
	compareDirectiveRevision,
	sanitizeDirectivesCatalog,
	applyTaskDirectives
} from '../src/lib/stores/taskDirectives.ts';

describe('Store tasks.json: validazione e parsing', () => {
	const validTask: StudioTask = {
		id: 'task-1',
		projectPath: 'C:\\Projects\\App',
		prompt: 'Implementa feature X',
		position: 0,
		createdAt: 1700000000000,
		updatedAt: 1700000001000,
		status: 'queued'
	};

	describe('isStudioTask', () => {
		it('riconosce un task valido', () => {
			assert.equal(isStudioTask(validTask), true);
		});

		it('accetta task con immagini e opzioni', () => {
			const richTask = {
				...validTask,
				images: [{ type: 'image', data: 'abcd', mimeType: 'image/png' }],
				options: { discussionMode: true, planMode: true }
			};
			assert.equal(isStudioTask(richTask), true);
		});

		it('rifiuta oggetti mancanti di campi obbligatori o con tipi non validi', () => {
			assert.equal(isStudioTask(null), false);
			assert.equal(isStudioTask({}), false);
			assert.equal(isStudioTask({ ...validTask, id: 123 }), false);
			assert.equal(isStudioTask({ ...validTask, position: 'zero' }), false);
			assert.equal(isStudioTask({ ...validTask, status: 'unknown_status' }), false);
		});
	});

	describe('isTaskSessionOrigin', () => {
		it('riconosce una origine valida con configurazione modello', () => {
			const origin = {
				projectPath: 'C:\\Projects\\App',
				sessionId: 'sess-123',
				taskId: 'task-1',
				title: 'Task Session 1',
				launchedAt: 1700000000000,
				modelSelector: 'openai-codex/gpt-5.6',
				thinkingLevel: 'high'
			};
			assert.equal(isTaskSessionOrigin(origin), true);
		});

		it('rifiuta origini incomplete', () => {
			assert.equal(isTaskSessionOrigin(null), false);
			assert.equal(isTaskSessionOrigin({ sessionId: '123' }), false);
		});
	});

	describe('rankFrequentTaskModelConfigurations', () => {
		it('ordina per frequenza nella finestra recente e usa la recenza come spareggio', () => {
			const base = {
				projectPath: 'C:\\Projects\\App',
				taskId: 'task-1',
				title: 'Task',
				thinkingLevel: 'high'
			};
			const ranked = rankFrequentTaskModelConfigurations([
				{ ...base, sessionId: 's1', launchedAt: 100, modelSelector: 'anthropic/claude-opus' },
				{ ...base, sessionId: 's2', launchedAt: 200, modelSelector: 'openai-codex/gpt-5.6' },
				{ ...base, sessionId: 's3', launchedAt: 300, modelSelector: 'anthropic/claude-opus' },
				{ ...base, sessionId: 's4', launchedAt: 400, modelSelector: 'openai-codex/gpt-5.6' },
				{ ...base, sessionId: 's5', launchedAt: 500, modelSelector: 'google/gemini-pro', thinkingLevel: 'auto' }
			], 4, 4);

			assert.deepEqual(ranked.map((item) => [item.modelSelector, item.count]), [
				['openai-codex/gpt-5.6', 2],
				['google/gemini-pro', 1],
				['anthropic/claude-opus', 1]
			]);
			assert.equal(ranked[1].thinkingLevel, 'auto');
		});

		it('ignora lo storico precedente privo di modello', () => {
			const ranked = rankFrequentTaskModelConfigurations([
				{
					projectPath: 'C:\\Projects\\App',
					sessionId: 'legacy',
					taskId: 'task-1',
					title: 'Task precedente',
					launchedAt: 100
				}
			]);
			assert.deepEqual(ranked, []);
		});
	});

	describe('parsePersistedState', () => {
		it('deserializza uno stato completo e conforme', () => {
			const rawState = {
				tasks: [validTask],
				origins: [
					{
						projectPath: 'C:\\Projects\\App',
						sessionId: 'sess-1',
						taskId: 'task-1',
						title: 'Origine 1',
						launchedAt: 1700000000000
					}
				],
				views: {
					'c:\\projects\\app': 'queue'
				}
			};

			const parsed = parsePersistedState(rawState);
			assert.ok(parsed);
			assert.equal(parsed.tasks.length, 1);
			assert.equal(parsed.tasks[0].id, 'task-1');
			assert.equal(parsed.origins.length, 1);
			assert.equal(parsed.views['c:\\projects\\app'], 'queue');
		});

		it('restituisce null per valori non validi o primitivi', () => {
			assert.equal(parsePersistedState(null), null);
			assert.equal(parsePersistedState(undefined), null);
			assert.equal(parsePersistedState('string'), null);
			assert.equal(parsePersistedState(123), null);
			assert.equal(parsePersistedState({}), null);
			assert.equal(parsePersistedState({ tasks: [] }), null); // origins e views assenti
		});

		it('filtra task o origini corrotte mantenendo quelle valide', () => {
			const mixed = {
				tasks: [
					validTask,
					{ id: 'corrupt-task', prompt: 42 }, // non valido
					null
				],
				origins: [
					{
						projectPath: 'C:\\Projects\\App',
						sessionId: 'sess-ok',
						taskId: 'task-1',
						title: 'OK',
						launchedAt: 1000
					},
					{ invalid: true }
				],
				views: {
					proj1: 'queue',
					proj2: 'invalid_view', // vista non valida
					proj3: 'sessions',
					proj4: 'rules'
				}
			};

			const parsed = parsePersistedState(mixed);
			assert.ok(parsed);
			assert.equal(parsed.tasks.length, 1);
			assert.equal(parsed.tasks[0].id, 'task-1');
			assert.equal(parsed.origins.length, 1);
			assert.equal(parsed.views.proj1, 'queue');
			assert.equal(parsed.views.proj3, 'sessions');
			assert.equal(parsed.views.proj2, undefined);
			assert.equal(parsed.views.proj4, 'rules');
		});
	});

	describe('sanitizeLoadedTasks', () => {
		it('rimuove i task vuoti senza prompt né immagini', () => {
			const tasks: StudioTask[] = [
				validTask,
				{ ...validTask, id: 'empty-1', prompt: '   ' },
				{ ...validTask, id: 'with-img', prompt: '   ', images: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }
			];

			const cleaned = sanitizeLoadedTasks(tasks);
			assert.equal(cleaned.length, 2);
			assert.equal(cleaned[0].id, 'task-1');
			assert.equal(cleaned[1].id, 'with-img');
		});

		it('ripristina lo stato queued per i task rimasti in dispatching', () => {
			const tasks: StudioTask[] = [
				{ ...validTask, id: 'stuck-task', status: 'dispatching' }
			];

			const cleaned = sanitizeLoadedTasks(tasks);
			assert.equal(cleaned[0].status, 'queued');
		});
		it('migra i campi booleani legacy in snapshot di direttive congelati', () => {
			const legacyTasks: StudioTask[] = [
				{
					...validTask,
					id: 'legacy-1',
					options: {
						role: 'smol',
						planMode: true,
						discussionMode: true,
						minimalMode: true,
						researchMode: true
					}
				}
			];

			const cleaned = sanitizeLoadedTasks(legacyTasks);
			const opts = cleaned[0].options;
			assert.ok(opts?.directives);
			assert.equal(opts.directives.length, 4);
			assert.equal(opts.directives[0].factoryKey, 'plan');
			assert.equal(opts.directives[1].factoryKey, 'discussion');
			assert.equal(opts.directives[2].factoryKey, 'minimal');
			assert.equal(opts.directives[3].factoryKey, 'research');
		});
	});

	describe('Catalogo direttive e snapshot (taskDirectives.ts)', () => {
		it('sanitizeDirectivesCatalog include sempre tutti i 4 preset di fabbrica', () => {
			const catalog = sanitizeDirectivesCatalog([]);
			assert.equal(catalog.length, 4);
			assert.ok(catalog.some((d) => d.factoryKey === 'plan'));
			assert.ok(catalog.some((d) => d.factoryKey === 'discussion'));
			assert.ok(catalog.some((d) => d.factoryKey === 'minimal'));
			assert.ok(catalog.some((d) => d.factoryKey === 'research'));
		});

		it('preserva le direttive personalizzate e ordina correttamente', () => {
			const custom: TaskDirective = {
				id: 'dir_custom_1',
				name: 'Test First',
				description: 'Desc',
				tag: '/test',
				prompt: '[Direttiva: Test]',
				placement: 'before',
				order: 5,
				revision: 1
			};
			const catalog = sanitizeDirectivesCatalog([custom]);
			assert.equal(catalog.length, 5);
			assert.equal(catalog[0].id, 'dir_custom_1'); // order: 5 viene prima di order: 10
		});

		it('compareDirectiveRevision riconosce up_to_date, upgrade_available e orphan', () => {
			const catalog: TaskDirective[] = [
				{ ...FACTORY_DIRECTIVES[0], revision: 3 }
			];
			const upToDateSnap = createDirectiveSnapshot({ ...FACTORY_DIRECTIVES[0], revision: 3 });
			const oldSnap = createDirectiveSnapshot({ ...FACTORY_DIRECTIVES[0], revision: 1 });
			const orphanSnap: TaskDirectiveSnapshot = {
				id: 'non_existent',
				name: 'Deleted',
				tag: 'del',
				prompt: 'p',
				placement: 'before',
				order: 1,
				revision: 1
			};

			assert.equal(compareDirectiveRevision(upToDateSnap, catalog), 'up_to_date');
			assert.equal(compareDirectiveRevision(oldSnap, catalog), 'upgrade_available');
			assert.equal(compareDirectiveRevision(orphanSnap, catalog), 'orphan');
		});

		it('applyTaskDirectives compone deterministica prima -> prompt -> dopo', () => {
			const dBefore1: TaskDirectiveSnapshot = {
				id: 'b1',
				name: 'B1',
				tag: 'b1',
				prompt: '[Before 1]',
				placement: 'before',
				order: 10,
				revision: 1
			};
			const dBefore2: TaskDirectiveSnapshot = {
				id: 'b2',
				name: 'B2',
				tag: 'b2',
				prompt: '[Before 2]',
				placement: 'before',
				order: 20,
				revision: 1
			};
			const dAfter: TaskDirectiveSnapshot = {
				id: 'a1',
				name: 'A1',
				tag: 'a1',
				prompt: '[After 1]',
				placement: 'after',
				order: 30,
				revision: 1
			};

			const result = applyTaskDirectives('Corpo del task', [dAfter, dBefore2, dBefore1]);
			assert.equal(
				result,
				'[Before 1]\n\n[Before 2]\n\nCorpo del task\n\n[After 1]'
			);
		});
	});

	describe('applyTaskModeDirectives', () => {
		it('preserva prompt semplice senza opzioni', () => {
			assert.equal(applyTaskModeDirectives('Mio prompt'), 'Mio prompt');
		});

		it('premette le direttive speciali nell\'ordine stabilito', () => {
			const formatted = applyTaskModeDirectives('Fai X', {
				discussionMode: true,
				planMode: true,
				minimalMode: true
			});

			assert.ok(formatted.includes('[Modalita Discussione:'));
			assert.ok(formatted.includes('[Modalita Piano:'));
			assert.ok(formatted.includes('[Modalita Minimale:'));
			assert.ok(formatted.endsWith('Fai X'));
		});

		it('appende la direttiva di ricerca online', () => {
			const formatted = applyTaskModeDirectives('Fai Y', {
				researchMode: true
			});

			assert.ok(formatted.includes('[Direttiva Ricerca Online:'));
			assert.ok(formatted.startsWith('Fai Y'));
		});
	});

	describe('serializeTaskState', () => {
		it('produce un JSON valido e re-parsabile', () => {
			const state: PersistedTaskState = {
				tasks: [validTask],
				origins: [],
				views: { app: 'queue' }
			};

			const json = serializeTaskState(state);
			const reParsed = parsePersistedState(JSON.parse(json));
			assert.ok(reParsed);
			assert.equal(reParsed.tasks.length, 1);
		});
	});

	describe('parseProjectTasksFile & serializeProjectTasksFile', () => {
		it('serializza e ri-parsa correttamente i task di un progetto', () => {
			const sampleTasks: StudioTask[] = [
				{ ...validTask, id: 't1', status: 'queued', position: 0 },
				{ ...validTask, id: 't2', status: 'in_progress', position: 1 },
				{ ...validTask, id: 't3', status: 'completed', position: 2 },
				{ ...validTask, id: 't4', status: 'abandoned', position: 3 },
				{ ...validTask, id: 't5', status: 'dispatching', position: 4 }
			];

			const serialized = serializeProjectTasksFile(sampleTasks);
			const parsed = parseProjectTasksFile(serialized, 'C:\\Projects\\App');

			assert.equal(parsed.length, 5);
			assert.equal(parsed[0].status, 'queued');
			assert.equal(parsed[1].status, 'in_progress');
			assert.equal(parsed[2].status, 'completed');
			assert.equal(parsed[3].status, 'abandoned');
			// 'dispatching' viene sanitizzato a 'queued'
			assert.equal(parsed[4].status, 'queued');
			assert.equal(parsed[0].projectPath, 'C:\\Projects\\App');
		});

		it('gestisce stringhe vuote o JSON malformati ritornando array vuoto', () => {
			assert.deepEqual(parseProjectTasksFile(''), []);
			assert.deepEqual(parseProjectTasksFile('   '), []);
			assert.deepEqual(parseProjectTasksFile('{ not json }'), []);
		});
	});
});
