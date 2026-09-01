import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	ensureProjectOmpDir,
	loadProjectTasks,
	saveProjectTasks,
	composeTaskPrompt,
	type ProjectTask,
	type TaskDirectiveSnapshot
} from '../extensions/studio-tasks.ts';

describe('Estensione studio-tasks: I/O atomico e gestione task', () => {
	let tempProjectDir: string;

	before(() => {
		tempProjectDir = mkdtempSync(join(tmpdir(), 'omp-studio-tasks-test-'));
	});

	after(() => {
		try {
			rmSync(tempProjectDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}
	});

	it('crea la cartella .omp e imposta .gitignore con tasks.json', () => {
		const ompDir = ensureProjectOmpDir(tempProjectDir);
		assert.ok(existsSync(ompDir));

		const gitignorePath = join(ompDir, '.gitignore');
		assert.ok(existsSync(gitignorePath));
		const content = readFileSync(gitignorePath, 'utf8');
		assert.ok(content.includes('tasks.json'));
	});

	it('salva e ricarica i task migrando i flag legacy in snapshot di direttive', () => {
		const sampleTasks: ProjectTask[] = [
			{
				id: 't-1',
				prompt: 'Primo task di test',
				position: 0,
				status: 'queued',
				createdAt: 1000,
				updatedAt: 1000,
				options: { role: 'smol', planMode: true }
			},
			{
				id: 't-2',
				prompt: 'Secondo task con discussione',
				position: 1,
				status: 'in_progress',
				createdAt: 2000,
				updatedAt: 2500,
				options: { discussionMode: true }
			}
		];

		saveProjectTasks(tempProjectDir, sampleTasks);

		const loaded = loadProjectTasks(tempProjectDir);
		assert.equal(loaded.length, 2);
		assert.equal(loaded[0].id, 't-1');
		assert.equal(loaded[0].prompt, 'Primo task di test');
		assert.equal(loaded[0].options?.role, 'smol');
		assert.equal(loaded[0].options?.directives?.length, 1);
		assert.equal(loaded[0].options?.directives?.[0].factoryKey, 'plan');
		assert.equal(loaded[0].options?.directives?.[0].id, 'dir_factory_plan');
		assert.equal(loaded[1].id, 't-2');
		assert.equal(loaded[1].status, 'in_progress');
		assert.equal(loaded[1].options?.directives?.length, 1);
		assert.equal(loaded[1].options?.directives?.[0].factoryKey, 'discussion');
	});

	it('gestisce task vuoti o file inesistenti ritornando array vuoto', () => {
		const nonExistent = join(tempProjectDir, 'does-not-exist');
		const tasks = loadProjectTasks(nonExistent);
		assert.deepEqual(tasks, []);
	});

	it('salva in modo atomico riassegnando le posizioni corrette', () => {
		const tasks: ProjectTask[] = [
			{
				id: 't-b',
				prompt: 'Task B',
				position: 10,
				status: 'completed',
				createdAt: 1000,
				updatedAt: 1000
			},
			{
				id: 't-a',
				prompt: 'Task A',
				position: 5,
				status: 'queued',
				createdAt: 2000,
				updatedAt: 2000
			}
		];

		saveProjectTasks(tempProjectDir, tasks);

		const reloaded = loadProjectTasks(tempProjectDir);
		assert.equal(reloaded.length, 2);
		assert.equal(reloaded[0].position, 0);
		assert.equal(reloaded[1].position, 1);
	});

	it('salva e ricarica i task con snapshot di direttive personalizzate', () => {
		const snap: TaskDirectiveSnapshot = {
			id: 'dir-custom-1',
			name: 'Test Rigorosi',
			tag: 'test',
			prompt: '[Direttiva: Test rigorosi]',
			placement: 'before',
			order: 10,
			revision: 1
		};
		const tasks: ProjectTask[] = [
			{
				id: 't-snap',
				prompt: 'Task con snapshot',
				position: 0,
				status: 'queued',
				createdAt: 1000,
				updatedAt: 1000,
				options: {
					role: 'default',
					directives: [snap]
				}
			}
		];
		saveProjectTasks(tempProjectDir, tasks);
		const loaded = loadProjectTasks(tempProjectDir);
		assert.equal(loaded.length, 1);
		assert.equal(loaded[0].options?.directives?.length, 1);
		assert.equal(loaded[0].options?.directives?.[0].id, 'dir-custom-1');
		assert.equal(loaded[0].options?.directives?.[0].prompt, '[Direttiva: Test rigorosi]');
	});

	it('composeTaskPrompt compone le direttive prima e dopo nell\'ordine corretto', () => {
		const snapBefore: TaskDirectiveSnapshot = {
			id: 'b',
			name: 'B',
			tag: 'b',
			prompt: '[Before]',
			placement: 'before',
			order: 10,
			revision: 1
		};
		const snapAfter: TaskDirectiveSnapshot = {
			id: 'a',
			name: 'A',
			tag: 'a',
			prompt: '[After]',
			placement: 'after',
			order: 20,
			revision: 1
		};

		const composed = composeTaskPrompt('Mio prompt', {
			directives: [snapAfter, snapBefore]
		});
		assert.equal(composed, '[Before]\n\nMio prompt\n\n[After]');
	});

	it('composeTaskPrompt gestisce opzioni miste (snapshot + flag legacy) senza ignorare alcun flag', () => {
		const customSnap: TaskDirectiveSnapshot = {
			id: 'custom-security',
			name: 'Security Check',
			tag: 'sec',
			prompt: '[Direttiva Sicurezza]',
			placement: 'before',
			order: 5,
			revision: 1
		};

		// Task misto: direttiva personalizzata (order 5) + planMode (order 10) + researchMode (order 40, placement after)
		const composed = composeTaskPrompt('Implementa autenticazione', {
			directives: [customSnap],
			planMode: true,
			researchMode: true
		});

		assert.ok(composed.startsWith('[Direttiva Sicurezza]\n\n[Modalita Piano:'));
		assert.ok(composed.includes('\n\nImplementa autenticazione\n\n'));
		assert.ok(
			composed.endsWith(
				"[Direttiva Ricerca Online: Dopo aver analizzato al completo la richiesta e tutto il codice collegato nel progetto, effettua ricerche online approfondite sull'ambito e sulla richiesta (documentazione, riferimenti, librerie e best practice) prima di procedere con l'implementazione o le modifiche.]"
			)
		);
	});

	it('composeTaskPrompt non duplica direttive di fabbrica se gia presenti negli snapshot', () => {
		const planSnap: TaskDirectiveSnapshot = {
			id: 'dir_factory_plan',
			factoryKey: 'plan',
			name: 'Modalità Piano Custom',
			tag: '/plan',
			prompt: '[Piano Personalizzato]',
			placement: 'before',
			order: 10,
			revision: 2
		};

		const composed = composeTaskPrompt('Mio task', {
			directives: [planSnap],
			planMode: true
		});

		assert.equal(composed, '[Piano Personalizzato]\n\nMio task');
	});
});
