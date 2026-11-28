/**
 * R-MI-73: il commit di fine turno prende solo il lavoro del turno.
 *
 * I test usano le dipendenze iniettate: niente store, niente collegamenti,
 * niente Tauri. Quello che si difende e' la decisione (quando si committa,
 * con che messaggio, su quale macchina) e il fatto che un commit mancato
 * resti un fatto di log e non un errore in chat.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';
import {
	commitsOnOutcome,
	createTurnCommitDeps,
	createTurnTracker,
	isSharedProject,
	turnCommitMessage,
	type SnapshotEntry,
	type TurnCommitIpc,
	type TurnContext,
	type TurnCommitDeps,
	type TurnOutcome,
	type TurnTracker
} from '../src/lib/stores/turnCommit.ts';
import type { Project } from '../src/lib/stores/projects.svelte.ts';

/** Progetto minimo: bastano identita' e nessuna bozza di Laboratorio. */
function project(overrides: Partial<Project> = {}): Project {
	return {
		id: 'project-1',
		name: 'app',
		label: null,
		canonicalProjectPath: '/work/app',
		labDraft: null,
		...overrides
	} as Project;
}

function context(overrides: Partial<TurnContext> = {}): TurnContext {
	return {
		sessionKey: 'project-1:main',
		project: project(),
		cwd: '/work/app',
		machine: 'win',
		title: 'Sistemare il login',
		...overrides
	};
}

interface Recorded {
	snapshot: TurnContext[];
	commits: Array<{ context: TurnContext; baseline: SnapshotEntry[]; message: string }>;
	after: TurnContext[];
	logs: Array<{ level: 'info' | 'warn'; message: string }>;
}

function tracker(options: {
	active?: boolean;
	snapshot?: (context: TurnContext) => Promise<SnapshotEntry[]>;
	commit?: (context: TurnContext, baseline: SnapshotEntry[], message: string) => Promise<{ committed: string[]; commit: string | null; skipped: string | null }>;
} = {}): { tracker: TurnTracker; recorded: Recorded } {
	const recorded: Recorded = { snapshot: [], commits: [], after: [], logs: [] };
	const deps: TurnCommitDeps = {
		active: () => options.active ?? true,
		snapshot: async (ctx) => {
			recorded.snapshot.push(ctx);
			return options.snapshot ? options.snapshot(ctx) : [];
		},
		commit: async (ctx, baseline, message) => {
			recorded.commits.push({ context: ctx, baseline, message });
			return options.commit ? options.commit(ctx, baseline, message) : { committed: ['a.ts'], commit: 'abc1234', skipped: null };
		},
		machineName: (machine) => (machine === 'local' ? 'Questo computer' : 'Windows'),
		afterCommit: (ctx) => recorded.after.push(ctx),
		log: (level, message) => recorded.logs.push({ level, message })
	};
	return { tracker: createTurnTracker(deps), recorded };
}

describe('Commit di fine turno (R-MI-73)', () => {
	it('prende la baseline all inizio e committa solo alla fine, con il messaggio fisso', async () => {
		const baseline: SnapshotEntry[] = [{ path: 'a.ts', hash: 'prima' }];
		const { tracker: commit, recorded } = tracker({ snapshot: async () => baseline });
		const ctx = context();
		await commit.onTurnStart(ctx);
		assert.deepEqual(commit.baselineFor(ctx.sessionKey), baseline);
		assert.deepEqual(recorded.commits, []);

		await commit.onTurnEnd(ctx, 'normal');
		assert.equal(recorded.commits.length, 1);
		assert.deepEqual(recorded.commits[0].baseline, baseline);
		assert.equal(recorded.commits[0].message, 'Studio · Windows · Sistemare il login');
		// La macchina che esegue la sessione e' quella che committa.
		assert.equal(recorded.commits[0].context.machine, 'win');
		// Baseline consumata: un secondo `agent_end` non ricommitta.
		assert.equal(commit.baselineFor(ctx.sessionKey), null);
		assert.equal(recorded.after.length, 1);
	});

	it('senza titolo usa il ripiego localizzato, mai una stringa vuota', () => {
		overwriteGetLocale(() => 'it');
		assert.equal(turnCommitMessage('Windows', null), 'Studio · Windows · chat senza titolo');
		assert.equal(turnCommitMessage('Windows', '   '), 'Studio · Windows · chat senza titolo');
		overwriteGetLocale(() => 'en');
		assert.equal(turnCommitMessage('Mac', null), 'Studio · Mac · untitled chat');
	});

	it('non committa per un errore di omp ne per l uscita a meta turno', () => {
		assert.equal(commitsOnOutcome('normal'), true);
		// Dopo lo Stop dell'utente il lavoro fatto resta lavoro del turno.
		assert.equal(commitsOnOutcome('stop'), true);
		assert.equal(commitsOnOutcome('error'), false);
		assert.equal(commitsOnOutcome('exit'), false);
	});

	it('non tocca niente quando il turno e finito male', async () => {
		const { tracker: commit, recorded } = tracker({ snapshot: async () => [{ path: 'a.ts', hash: 'x' }] });
		const ctx = context();
		for (const outcome of ['error', 'exit'] as TurnOutcome[]) {
			await commit.onTurnStart(ctx);
			await commit.onTurnEnd(ctx, outcome);
			assert.deepEqual(recorded.commits, []);
			assert.equal(commit.baselineFor(ctx.sessionKey), null);
		}
	});

	it('in un progetto su una sola macchina non prende nemmeno la baseline', async () => {
		const { tracker: commit, recorded } = tracker({ active: false });
		const ctx = context();
		await commit.onTurnStart(ctx);
		assert.deepEqual(recorded.snapshot, []);
		assert.equal(commit.baselineFor(ctx.sessionKey), null);
		await commit.onTurnEnd(ctx, 'normal');
		assert.deepEqual(recorded.commits, []);
	});

	it('senza baseline non committa: non si sa cosa abbia toccato l agente', async () => {
		const { tracker: commit, recorded } = tracker();
		await commit.onTurnEnd(context(), 'normal');
		assert.deepEqual(recorded.commits, []);
	});

	it('un commit mancato resta nel log di Studio', async () => {
		const { tracker: commit, recorded } = tracker({
			commit: async () => {
				throw new Error('index.lock occupato');
			}
		});
		const ctx = context();
		await commit.onTurnStart(ctx);
		await commit.onTurnEnd(ctx, 'normal');
		assert.equal(recorded.after.length, 0);
		assert.equal(recorded.logs.at(-1)?.level, 'warn');
		assert.match(recorded.logs.at(-1)?.message ?? '', /index\.lock/);
	});

	it('un istantanea non riuscita non ferma il turno e non produce commit', async () => {
		const { tracker: commit, recorded } = tracker({
			snapshot: async () => {
				throw new Error('git assente');
			}
		});
		const ctx = context();
		await commit.onTurnStart(ctx);
		assert.equal(commit.baselineFor(ctx.sessionKey), null);
		await commit.onTurnEnd(ctx, 'normal');
		assert.deepEqual(recorded.commits, []);
		assert.equal(recorded.logs.at(-1)?.level, 'warn');
	});

	it('un turno nuovo non riusa la baseline di quello precedente rimasta appesa', async () => {
		let counter = 0;
		const { tracker: commit } = tracker({ snapshot: async () => [{ path: 'a.ts', hash: String(counter++) }] });
		const ctx = context();
		await commit.onTurnStart(ctx);
		await commit.onTurnStart(ctx);
		assert.deepEqual(commit.baselineFor(ctx.sessionKey), [{ path: 'a.ts', hash: '1' }]);
	});

	it('un istantanea che torna dopo la fine del turno non lascia una baseline al turno dopo', async () => {
		const pending: Array<(entries: SnapshotEntry[]) => void> = [];
		// Il segnale e' «snapshot e' stata chiamata», non un ritardo indovinato:
		// un `setTimeout(0)` legherebbe il test all'orologio e sotto carico
		// diventerebbe intermittente.
		const called = Promise.withResolvers<SnapshotEntry[]>();
		const { tracker: commit, recorded } = tracker({
			snapshot: () => {
				const next = Promise.withResolvers<SnapshotEntry[]>();
				pending.push(next.resolve);
				called.resolve([]);
				return next.promise;
			}
		});
		const ctx = context();
		const start = commit.onTurnStart(ctx);
		// L'istantanea e' in volo: la fine del turno arriva prima della risposta.
		await called.promise;
		assert.equal(pending.length, 1);
		await commit.onTurnEnd(ctx, 'normal');
		pending[0]([{ path: 'a.ts', hash: 'vecchia' }]);
		await start;
		// Nessuna baseline: il turno era finito, non si committa e soprattutto
		// quella risposta in ritardo non resta appesa per il turno dopo.
		assert.equal(commit.baselineFor(ctx.sessionKey), null);
		assert.deepEqual(recorded.commits, []);

		const second = commit.onTurnStart(ctx);
		// Stesso segnale: la seconda istantanea e' partita adesso.
		await called.promise;
		pending[1]([{ path: 'a.ts', hash: 'nuova' }]);
		await second;
		assert.deepEqual(commit.baselineFor(ctx.sessionKey), [{ path: 'a.ts', hash: 'nuova' }]);
	});

	it('una sessione senza cartella o senza progetto non prende istantanee', async () => {
		const { tracker: commit, recorded } = tracker();
		await commit.onTurnStart(context({ cwd: null }));
		await commit.onTurnStart(context({ project: null }));
		assert.deepEqual(recorded.snapshot, []);
	});

	it('un progetto che vive solo qui non e un progetto condiviso', () => {
		// Una copia sola, di questa macchina: niente commit di fine turno.
		assert.equal(isSharedProject(project(), [undefined], 'local'), false);
		assert.equal(isSharedProject(project(), ['local'], 'local'), false);
		// Una copia su un'altra macchina, accesa o spenta che sia: condiviso.
		assert.equal(isSharedProject(project(), ['local', 'win'], 'local'), true);
		assert.equal(isSharedProject(project(), ['win'], 'local'), true);
		// Un prototipo del Laboratorio non si committa mai, anche se ha copie.
		assert.equal(isSharedProject(project({ labDraft: { prototypeId: 'p1' } }), ['win'], 'local'), false);
		// Senza percorso canonico non c'e' un repository da committare.
		assert.equal(isSharedProject(project({ canonicalProjectPath: null }), ['win'], 'local'), false);
		assert.equal(isSharedProject(null, ['win'], 'local'), false);
	});

	it('il confine IPC vero manda al backend i comandi e gli argomenti attesi', async () => {
		overwriteGetLocale(() => 'it');
		const calls: Array<{ command: string; args: Record<string, unknown>; machine: string }> = [];
		const shared: string[] = [];
		const after: string[] = [];
		const entries: SnapshotEntry[] = [{ path: 'src/a.ts', hash: 'h1' }];
		const deps = createTurnCommitDeps({
			invoke: (async (command: string, args: Record<string, unknown>, machine: string) => {
				calls.push({ command, args, machine });
				if (command === 'git_turn_snapshot') return entries;
				return { committed: ['src/a.ts'], commit: 'deadbeef', skipped: null };
			}) as TurnCommitIpc['invoke'],
			isShared: (target) => {
				shared.push(target.id);
				return true;
			},
			machineName: (machine) => (machine === 'local' ? 'Mac Studio' : machine),
			afterCommit: (target) => after.push(target.id),
			log: () => undefined
		});
		const commit = createTurnTracker(deps);
		const ctx = context({ machine: 'local', cwd: '/work/app', title: null });
		await commit.onTurnStart(ctx);
		await commit.onTurnEnd(ctx, 'normal');

		assert.deepEqual(calls.map((call) => call.command), ['git_turn_snapshot', 'git_turn_commit']);
		assert.equal(calls[0].args.projectPath, '/work/app');
		assert.deepEqual(calls[1].args.baseline, entries);
		// Il titolo mancante diventa il ripiego localizzato, mai una stringa vuota.
		assert.equal(calls[1].args.message, 'Studio · Mac Studio · chat senza titolo');
		// Il commit va sulla macchina che esegue la sessione (R-MI-73), non qui.
		assert.deepEqual(calls.map((call) => call.machine), ['local', 'local']);
		assert.deepEqual(shared, ['project-1', 'project-1']);
		assert.deepEqual(after, ['project-1']);
	});

	it('il confine IPC vero non committa un progetto non condiviso', async () => {
		const calls: string[] = [];
		const deps = createTurnCommitDeps({
			invoke: (async (command: string) => {
				calls.push(command);
				return [];
			}) as TurnCommitIpc['invoke'],
			isShared: () => false,
			machineName: () => 'Mac',
			afterCommit: () => undefined,
			log: () => undefined
		});
		const commit = createTurnTracker(deps);
		const ctx = context();
		await commit.onTurnStart(ctx);
		await commit.onTurnEnd(ctx, 'normal');
		assert.deepEqual(calls, []);
	});

	/**
	 * Il contratto che il backend Rust si aspetta, nomi compresi (camelCase da
	 * entrambe le parti): `projectPath`, `baseline` con le voci `path`/`hash`,
	 * `message`. Una baseline vuota o con le chiavi sbagliate farebbe prendere
	 * al commit file che l'agente non ha toccato, che e' proprio l'errore che
	 * R-MI-73 vieta. E' il primo posto da guardare se la prima `cargo test`
	 * o la prima prova reale fallisce.
	 */
	it('manda al backend projectPath, baseline con path/hash e message, sulla macchina della sessione', async () => {
		const sent: Array<{ command: string; args: Record<string, unknown>; machine: string }> = [];
		const deps = createTurnCommitDeps({
			invoke: (async (command: string, args: Record<string, unknown>, machine: string) => {
				sent.push({ command, args, machine });
				return command === 'git_turn_snapshot' ? [{ path: 'a.ts', hash: 'h1' }] : { committed: ['a.ts'], commit: 'c0ffee', skipped: null };
			}) as TurnCommitIpc['invoke'],
			isShared: () => true,
			machineName: () => 'Windows',
			afterCommit: () => undefined,
			log: () => undefined
		});
		const commit = createTurnTracker(deps);
		const ctx = context({ cwd: '/work/app', machine: 'win' });
		await commit.onTurnStart(ctx);
		await commit.onTurnEnd(ctx, 'normal');

		assert.deepEqual(sent.map((call) => call.command), ['git_turn_snapshot', 'git_turn_commit']);
		// La macchina che esegue la sessione e' quella che committa.
		assert.deepEqual(sent.map((call) => call.machine), ['win', 'win']);
		assert.deepEqual(sent[0].args, { projectPath: '/work/app' });
		assert.deepEqual(sent[1].args, {
			projectPath: '/work/app',
			baseline: [{ path: 'a.ts', hash: 'h1' }],
			message: 'Studio · Windows · Sistemare il login'
		});
		// Le chiavi sono esattamente quelle che `SnapshotEntry` serializza: se
		// cambiassero, il backend riceverebbe voci senza impronta e
		// considererebbe cambiato ogni file.
		const baseline = sent[1].args.baseline as SnapshotEntry[];
		assert.deepEqual(Object.keys(baseline[0]).sort(), ['hash', 'path']);
	});
});
