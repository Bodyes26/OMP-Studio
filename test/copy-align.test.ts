/**
 * R-MI-74: «Allinea tutto» orchestrazione.
 *
 * I test coprono le tre decisioni che il giro deve prendere bene:
 * - una copia occupata da un agente si aspetta e si nomina, non si forza;
 * - se non ci sono modifiche in sospeso non si committa niente;
 * - l'agente parte solo quando git lascia un conflitto vero.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';
import { m } from '../src/lib/paraglide/messages.js';
import {
	CopyAlign,
	alignPhaseText,
	alignWaitingText,
	copyStripAction,
	conflictFilesIn,
	conflictsFrom,
	createAlignDeps,
	type AlignCopy,
	type AlignDeps,
	type AlignIpc,
	type SyncReportLike
} from '../src/lib/stores/copyAlign.svelte.ts';
import type { Project } from '../src/lib/stores/projects.svelte.ts';

const PROJECT = { id: 'project-1', name: 'app', canonicalProjectPath: '/work/app' } as Project;

function copy(machine: string, overrides: Partial<AlignCopy> = {}): AlignCopy {
	return {
		machine,
		name: machine === 'local' ? 'Questo computer' : machine,
		path: `/work/${machine}`,
		online: true,
		local: machine === 'local',
		...overrides
	};
}

interface Recorded {
	committed: Array<{ path: string; message: string }>;
	agents: Array<{ project: Project; conflicts: unknown }>;
	sleeps: number;
	logs: string[];
}

function align(options: {
	copies?: AlignCopy[];
	pending?: Record<string, number>;
	busy?: (path: string) => boolean;
	/** La copia resta occupata anche dopo le attese: si nomina e si va avanti. */
	stayBusy?: boolean;
	reports?: SyncReportLike[];
} = {}): { align: CopyAlign; recorded: Recorded } {
	const recorded: Recorded = { committed: [], agents: [], sleeps: 0, logs: [] };
	const copies = options.copies ?? [copy('local'), copy('win')];
	const pending = options.pending ?? {};
	let busyLeft = new Set(copies.filter((entry) => options.busy?.(entry.path)).map((entry) => entry.path));
	const deps: AlignDeps = {
		copies: async () => copies,
		pendingFiles: async (entry) => pending[entry.path] ?? 0,
		commitPending: async (entry, message) => {
			if (busyLeft.has(entry.path)) return { commit: null, skipped: 'busy' };
			recorded.committed.push({ path: entry.path, message });
			return { commit: 'abc1234', skipped: null };
		},
		sync: async () => options.reports ?? [],
		startAgent: async (project, conflicts) => {
			recorded.agents.push({ project, conflicts });
		},
		machineName: (machine) => (machine === 'local' ? 'Questo computer' : 'Windows'),
		sleep: async () => {
			// L'attesa fra un tentativo e l'altro non deve durare davvero: al
			// tentativo successivo la copia si libera.
			recorded.sleeps += 1;
			if (!options.stayBusy) busyLeft = new Set();
		},
		log: (_level, message) => recorded.logs.push(message)
	};
	return { align: new CopyAlign(deps), recorded };
}

describe('Allinea tutto (R-MI-74)', () => {
	it('committa solo le copie in linea con qualcosa in sospeso', async () => {
		const { align: run, recorded } = align({
			pending: { '/work/local': 2, '/work/win': 0 }
		});
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.committed, [
			{ path: '/work/local', message: m.copies_align_commit_message({ machine: 'Questo computer' }) }
		]);
		assert.equal(run.phase, 'done');
		assert.equal(run.running, false);
	});

	it('senza modifiche in sospeso non committa niente e non avvia l agente', async () => {
		const { align: run, recorded } = align({ pending: {} });
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.committed, []);
		assert.deepEqual(recorded.agents, []);
		assert.equal(run.phase, 'done');
	});

	it('una copia occupata si aspetta e si riprova, senza forzarla', async () => {
		const { align: run, recorded } = align({
			pending: { '/work/local': 1, '/work/win': 1 },
			// La copia di Windows ha un agente al lavoro al primo giro.
			busy: (path) => path === '/work/win'
		});
		await run.allinea(PROJECT);
		assert.equal(recorded.sleeps, 1);
		assert.deepEqual(recorded.committed.map((entry) => entry.path).sort(), ['/work/local', '/work/win']);
		assert.deepEqual(run.waiting, []);
	});

	it('una copia spenta viene nominata e non toccata', async () => {
		const { align: run, recorded } = align({
			copies: [copy('local'), copy('win', { online: false })],
			pending: { '/work/local': 1 }
		});
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.committed.map((entry) => entry.path), ['/work/local']);
		assert.deepEqual(run.waiting, ['win']);
	});

	it('una copia che resta occupata si nomina e il giro va avanti lo stesso', async () => {
		const { align: run, recorded } = align({
			pending: { '/work/local': 0, '/work/win': 3 },
			busy: (path) => path === '/work/win',
			stayBusy: true
		});
		await run.allinea(PROJECT);
		// Tre tentativi in tutto: il primo subito, poi due attese.
		assert.equal(recorded.sleeps, 2);
		assert.deepEqual(recorded.committed, []);
		assert.deepEqual(run.waiting, ['win']);
		assert.equal(run.phase, 'done');
	});

	it('l agente parte solo su un conflitto vero', async () => {
		const { align: run, recorded } = align({
			pending: {},
			reports: [
				{ machine: 'win', branches: [{ name: 'main', state: 'advanced', reason: null }] }
			]
		});
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.agents, []);
		assert.equal(run.phase, 'done');

		const second = align({
			reports: [
				{
					machine: 'win',
					branches: [{ name: 'main', state: 'diverged', reason: 'conflict:src/a.ts,src/b.ts' }]
				}
			]
		});
		await second.align.allinea(PROJECT);
		assert.equal(second.recorded.agents.length, 1);
		assert.deepEqual(second.recorded.agents[0].conflicts, [
			{ branch: 'main', machine: 'win', files: ['src/a.ts', 'src/b.ts'] }
		]);
		assert.equal(second.align.phase, 'done');
	});

	it('un errore del giro resta osservabile e non lascia il giro appeso', async () => {
		const failing = new CopyAlign({
			copies: async () => {
				throw new Error('collegamento assente');
			},
			pendingFiles: async () => 0,
			commitPending: async () => ({ commit: null, skipped: null }),
			sync: async () => [],
			startAgent: async () => undefined,
			machineName: (machine) => machine,
			sleep: async () => undefined,
			log: () => undefined
		});
		await failing.allinea(PROJECT);
		assert.equal(failing.phase, 'error');
		assert.match(failing.error ?? '', /collegamento assente/);
		assert.equal(failing.running, false);
	});

	it('legge i file dal motivo del conflitto', () => {
		assert.deepEqual(conflictFilesIn('conflict:src/a.ts, src/b.ts'), ['src/a.ts', 'src/b.ts']);
		assert.deepEqual(conflictFilesIn('busy'), []);
		assert.deepEqual(conflictFilesIn(null), []);
	});

	it('non consegna all agente una branch solo indietro', () => {
		const reports: SyncReportLike[] = [
			{ machine: 'win', branches: [{ name: 'main', state: 'pending', reason: 'busy' }] },
			{ machine: 'mac', branches: [{ name: 'main', state: 'pending', reason: 'conflict:src/a.ts' }] }
		];
		assert.deepEqual(conflictsFrom(reports), [{ branch: 'main', machine: 'mac', files: ['src/a.ts'] }]);
	});

	it('il messaggio del commit di allineamento nomina la macchina', () => {
		overwriteGetLocale(() => 'it');
		assert.equal(m.copies_align_commit_message({ machine: 'Windows' }), 'Studio · Windows · allineamento');
		overwriteGetLocale(() => 'en');
		assert.equal(m.copies_align_commit_message({ machine: 'Windows' }), 'Studio · Windows · aligning');
	});

	it('si offre solo quando il giro automatico non basta', () => {
		// Nessun conflitto, niente in sospeso, nessuna copia sporca: niente da fare.
		assert.equal(copyStripAction({ conflicts: 0, pending: [], otherCopiesDirty: false }), null);
		// Un conflitto solo: il compito stretto di R-MI-61.
		assert.equal(copyStripAction({ conflicts: 1, pending: [], otherCopiesDirty: false }), 'resolve');
		// Qualunque altra cosa che il giro automatico non copre: allineamento.
		assert.equal(copyStripAction({ conflicts: 1, pending: ['main'], otherCopiesDirty: false }), 'align');
		assert.equal(copyStripAction({ conflicts: 1, pending: [], otherCopiesDirty: true }), 'align');
		assert.equal(copyStripAction({ conflicts: 2, pending: [], otherCopiesDirty: false }), 'align');
		assert.equal(copyStripAction({ conflicts: 0, pending: ['main'], otherCopiesDirty: false }), 'align');
		assert.equal(copyStripAction({ conflicts: 0, pending: [], otherCopiesDirty: true }), 'align');
	});

	it('racconta la fase corrente, con le macchine in attesa', () => {
		overwriteGetLocale(() => 'it');
		assert.equal(alignPhaseText({ phase: 'idle', waiting: [], error: null }), null);
		assert.equal(alignPhaseText({ phase: 'syncing', waiting: [], error: null }), 'Scambio le copie');
		assert.equal(alignPhaseText({ phase: 'error', waiting: [], error: 'rete' }), 'Allineamento non riuscito: rete');
		assert.equal(alignWaitingText([]), null);
		assert.equal(alignWaitingText(['Windows', 'Mac']), 'In attesa di Windows, Mac');
	});

	it('le attese hanno un tetto: una copia occupata non tiene fermo il giro per sempre', async () => {
		// Una copia con un agente al lavoro: si riprova BUSY_ATTEMPTS volte, poi
		// si nomina e il giro prosegue — non si resta appesi alla sua liberazione.
		const { align: run, recorded } = align({
			pending: { '/work/local': 1, '/work/win': 1 },
			busy: (path) => path === '/work/win',
			stayBusy: true
		});
		await run.allinea(PROJECT);
		assert.equal(recorded.sleeps, 2);
		// Il primo tentativo ha committato la copia libera; quella occupata
		// resta nominata e il giro finisce comunque.
		assert.deepEqual(recorded.committed.map((entry) => entry.path), ['/work/local']);
		assert.deepEqual(run.waiting, ['win']);
		assert.equal(run.phase, 'done');
		assert.equal(run.running, false);
	});

	it('un secondo clic durante il giro non ne avvia un altro', async () => {
		const { align: run, recorded } = align({ pending: { '/work/local': 1 } });
		const [first, second] = await Promise.all([run.allinea(PROJECT), run.allinea(PROJECT)]);
		assert.equal(first, undefined);
		assert.equal(second, undefined);
		assert.deepEqual(recorded.committed, [
			{ path: '/work/local', message: m.copies_align_commit_message({ machine: 'Questo computer' }) }
		]);
	});

	it('un errore su una copia non ferma le altre e resta nel log', async () => {
		const copies = [copy('local'), copy('win')];
		const committed: string[] = [];
		const logs: string[] = [];
		const run = new CopyAlign({
			copies: async () => copies,
			pendingFiles: async (entry) => (entry.path === '/work/win' ? 2 : 1),
			commitPending: async (entry) => {
				// «skipped» con un motivo non-occupato: la copia non ha nulla da
				// committare, e non si riprova piu'.
				if (entry.path === '/work/win') throw new Error('remote unreachable');
				committed.push(entry.path);
				return { commit: 'abc', skipped: null };
			},
			sync: async () => [],
			startAgent: async () => undefined,
			machineName: (machine) => machine,
			sleep: async () => undefined,
			log: (_level, message) => logs.push(message)
		});
		await run.allinea(PROJECT);
		assert.deepEqual(committed, ['/work/local']);
		assert.ok(logs.some((line) => line.includes('remote unreachable')));
		assert.equal(run.phase, 'done');
		assert.deepEqual(run.waiting, []);
	});

	it('un giro senza copie con percorso non tocca niente', async () => {
		const { align: run, recorded } = align({
			copies: [copy('local', { path: '' }), copy('win', { path: '' })]
		});
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.committed, []);
		assert.deepEqual(recorded.agents, []);
		assert.equal(run.phase, 'done');
	});

	it('un conflitto senza file nominati non basta per un agente', async () => {
		const { align: run, recorded } = align({
			reports: [
				{ machine: 'win', branches: [{ name: 'main', state: 'diverged', reason: 'busy' }] }
			]
		});
		await run.allinea(PROJECT);
		assert.deepEqual(recorded.agents, []);
		assert.equal(run.phase, 'done');
	});

	it('il confine IPC vero committa ogni copia sulla sua macchina con il messaggio fisso', async () => {
		overwriteGetLocale(() => 'it');
		const calls: Array<{ command: string; args: Record<string, unknown>; machine: string }> = [];
		const copies = [copy('local'), copy('win')];
		const deps = createAlignDeps({
			invoke: (async (command: string, args: Record<string, unknown>, machine: string) => {
				calls.push({ command, args, machine });
				if (command === 'copy_wip_estimate') return { files: 1 };
				return { commit: 'abc1234', skipped: null };
			}) as AlignIpc['invoke'],
			copies: () => copies,
			sync: async () => [],
			startAgent: async () => undefined,
			machineName: (machine) => (machine === 'local' ? 'Mac Studio' : 'Windows'),
			errorText: (error) => String(error),
			log: () => undefined
		});
		await new CopyAlign(deps).allinea(PROJECT);

		assert.deepEqual(calls.map((call) => call.command), [
			'copy_wip_estimate',
			'copy_wip_estimate',
			'copy_commit_pending',
			'copy_commit_pending'
		]);
		// Ogni copia si committa sulla propria macchina, con il percorso di
		// quella copia: mai tutte su questa (R-MI-74).
		assert.deepEqual(
			calls.filter((call) => call.command === 'copy_commit_pending').map((call) => [call.machine, call.args.projectPath]),
			[
				['local', '/work/local'],
				['win', '/work/win']
			]
		);
		assert.deepEqual(
			calls.filter((call) => call.command === 'copy_commit_pending').map((call) => call.args.message),
			[m.copies_align_commit_message({ machine: 'Mac Studio' }), m.copies_align_commit_message({ machine: 'Windows' })]
		);
	});

	it('un rifiuto di instradamento arriva alla striscia con la frase della finestra', async () => {
		const deps = createAlignDeps({
			invoke: (async () => []) as AlignIpc['invoke'],
			copies: () => [copy('local')],
			// Il giro di rete e' quello che puo' rifiutare l'instradamento verso
			// una macchina spenta: la frase mostrata dev'essere quella della
			// finestra (C5), non il testo grezzo del trasporto.
			sync: async () => {
				throw new Error('BackendRouteError: machine_unreachable');
			},
			startAgent: async () => undefined,
			machineName: (machine) => machine,
			errorText: () => 'Windows non raggiungibile',
			log: () => undefined
		});
		const run = new CopyAlign(deps);
		await run.allinea(PROJECT);
		assert.equal(run.phase, 'error');
		assert.equal(run.error, 'Windows non raggiungibile');
		assert.equal(run.running, false);
	});
});
