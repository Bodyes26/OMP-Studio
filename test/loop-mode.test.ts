import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	defaultLoopDraft,
	draftCommand,
	draftFromArgs,
	draftToArgs,
	foldLoopItems,
	formatElapsed,
	giroHeadline,
	isGiroClosed,
	isLoopActive,
	isLoopPromptEcho,
	isLoopRunning,
	loopSegments,
	parseLoopArgs,
	parseLoopSnapshot,
	routeLoopSlash,
	controlLine,
	type LoopState
} from '../src/lib/agent/loopMode.ts';
import { routeComposerSubmit } from '../src/lib/agent/composerSubmit.ts';
import { resolveAutomationGate, isLaneRoutable } from '../src/lib/agent/automationGate.ts';
import { COMMAND_MANIFEST } from '../src/lib/agent/commandCatalog/manifest/index.ts';
import { defaultLayout } from '../src/lib/agent/commandCatalog/layout.ts';

function state(patch: Partial<LoopState> = {}): LoopState {
	return {
		id: 'l1',
		prompt: 'correggi',
		limit: { kind: 'iterations', initial: 6, remaining: 4 },
		condition: { command: 'npm test', until: true },
		between: 'prompt',
		status: 'running',
		pauseRequested: false,
		giro: 2,
		startedAt: 0,
		giri: [
			{ n: 1, startedAt: 0, endedAt: 5000, check: { exit: 1, out: '2 falliti', at: 6000 } },
			{ n: 2, startedAt: 7000 }
		],
		...patch
	};
}

describe('loopMode: pillole e riga /loop', () => {
	it('la bozza diventa la riga del prototipo', () => {
		const draft = { ...defaultLoopDraft(), prompt: 'Lancia npm test e correggi', condition: 'until' as const };
		assert.equal(draftCommand(draft), "/loop 6 --until 'npm test' Lancia npm test e correggi");
		assert.equal(
			draftCommand({ ...draft, limit: { kind: 'duration', spec: '15m' }, condition: 'none', between: 'compact' }),
			'/loop 15m --between compact Lancia npm test e correggi'
		);
		assert.equal(draftCommand({ ...draft, limit: { kind: 'none' }, condition: 'while', command: 'git diff --quiet' }), "/loop --while 'git diff --quiet' Lancia npm test e correggi");
	});

	it('errori della bozza: durata illeggibile, comando vuoto', () => {
		assert.equal(typeof draftToArgs({ ...defaultLoopDraft(), limit: { kind: 'duration', spec: 'boh' } }), 'string');
		assert.equal(typeof draftToArgs({ ...defaultLoopDraft(), condition: 'until', command: '  ' }), 'string');
		assert.equal(typeof draftToArgs({ ...defaultLoopDraft(), limit: { kind: 'iterations', count: 0 } }), 'string');
		assert.equal(draftCommand({ ...defaultLoopDraft(), limit: { kind: 'duration', spec: 'x' } }), null);
	});

	it('andata e ritorno bozza -> argomenti -> bozza', () => {
		const parsed = parseLoopArgs("90m --while 'make check' --between reset rifinisci");
		assert.ok(typeof parsed !== 'string');
		const draft = draftFromArgs(parsed);
		assert.deepEqual(draft.limit, { kind: 'duration', spec: '1h30m' });
		assert.equal(draft.condition, 'while');
		assert.equal(draft.command, 'make check');
		assert.equal(draft.between, 'reset');
		assert.deepEqual(draftToArgs(draft), parsed);
	});
});

describe('loopMode: /loop scritto nel composer', () => {
	it('passa dal guscio di Studio, con o senza argomenti', () => {
		assert.deepEqual(routeComposerSubmit('/loop'), { kind: 'studio', raw: '/loop' });
		assert.equal(routeComposerSubmit("/loop 6 --until 'npm test' correggi").kind, 'studio');
	});

	it('senza argomenti apre le pillole; con loop attivo lo ferma come la TUI', () => {
		assert.equal(routeLoopSlash('', false).kind, 'setup');
		assert.equal(routeLoopSlash('', true).kind, 'stop');
	});

	it('con il prompt parte subito, senza apre le pillole gia\' impostate', () => {
		assert.deepEqual(routeLoopSlash("6 --until 'npm test' correggi", false), {
			kind: 'start',
			command: "/loop 6 --until 'npm test' correggi"
		});
		const setup = routeLoopSlash('10m --until "bun test"', false);
		assert.equal(setup.kind, 'setup');
		if (setup.kind === 'setup') {
			assert.deepEqual(setup.draft.limit, { kind: 'duration', spec: '10m' });
			assert.equal(setup.draft.condition, 'until');
			assert.equal(setup.draft.command, 'bun test');
		}
		assert.equal(routeLoopSlash('--bogus x', false).kind, 'error');
		assert.equal(routeLoopSlash('3 altro', true).kind, 'error');
	});

	it('righe di controllo verso l\'estensione', () => {
		assert.equal(controlLine('pause'), '/studio-loop pause');
		assert.equal(controlLine('probe', 'npm test'), '/studio-loop probe npm test');
	});
});

describe('loopMode: stato dal setStatus', () => {
	it('legge lo snapshot e scarta il resto', () => {
		const snap = parseLoopSnapshot(JSON.stringify({ v: 1, loop: state(), probe: null }));
		assert.equal(snap?.loop?.giro, 2);
		assert.equal(parseLoopSnapshot(undefined), null);
		assert.equal(parseLoopSnapshot('{rotto'), null);
		assert.equal(parseLoopSnapshot(JSON.stringify({ v: 2 })), null);
		assert.deepEqual(parseLoopSnapshot(JSON.stringify({ v: 1, loop: null, probe: null })), { v: 1, loop: null, probe: null });
	});

	it('attivo anche in pausa, in corsa solo quando gira', () => {
		assert.equal(isLoopActive(state({ status: 'paused' })), true);
		assert.equal(isLoopRunning(state({ status: 'paused' })), false);
		assert.equal(isLoopActive(state({ status: 'done' })), false);
		assert.equal(isLoopActive(null), false);
	});

	it('barra a segmenti: fatti, in corso, futuri', () => {
		assert.deepEqual(loopSegments(state()), ['done', 'cur', 'todo', 'todo', 'todo', 'todo']);
		const done = state({
			status: 'done',
			giro: 3,
			end: { reason: 'condition', exit: 0 },
			giri: [
				{ n: 1, startedAt: 0, endedAt: 1 },
				{ n: 2, startedAt: 2, endedAt: 3 },
				{ n: 3, startedAt: 4, endedAt: 5 }
			]
		});
		assert.deepEqual(loopSegments(done), ['done', 'done', 'ok', 'todo', 'todo', 'todo']);
		const stopped = state({ status: 'stopped', giro: 1, giri: [{ n: 1, startedAt: 0, endedAt: 2, aborted: true }] });
		assert.equal(loopSegments(stopped)[0], 'stop');
		assert.equal(loopSegments(state({ limit: undefined, giro: 1, giri: [{ n: 1, startedAt: 0 }] })).length, 4);
	});

	it('giri chiusi e prompt ripetuto', () => {
		const loop = state();
		assert.equal(isGiroClosed(loop, 1), true);
		assert.equal(isGiroClosed(loop, 2), false);
		assert.equal(isGiroClosed(state({ status: 'stopped' }), 2), true);
		assert.equal(isLoopPromptEcho(loop, '  correggi '), true);
		assert.equal(isLoopPromptEcho(loop, 'altro'), false);
		assert.equal(isLoopPromptEcho(state({ status: 'done' }), 'correggi'), false);
	});

	it('tempo e titolo della riga ripiegata', () => {
		assert.equal(formatElapsed(24_000), '00:24');
		assert.equal(formatElapsed(3_725_000), '1:02:05');
		assert.equal(giroHeadline(['Ho letto il file.', '**Corretto** `x.ts`: resta 1 test.']), 'Corretto x.ts: resta 1 test.');
		assert.equal(giroHeadline([]), '');
	});
});

describe('loopMode: ripiegamento nel transcript', () => {
	type Row = { user?: boolean; giro?: number; id: string };
	const probe = (row: Row) => ({ user: Boolean(row.user), giro: row.giro, key: row.id });
	const rows: Row[] = [
		{ id: 'start', user: true },
		{ id: 'u1', user: true, giro: 1 },
		{ id: 'a1' },
		{ id: 't1' },
		{ id: 'u2', user: true, giro: 2 },
		{ id: 'a2' }
	];

	it('giro chiuso in una riga, giro in corso con separatore', () => {
		const out = foldLoopItems(rows, probe, (n) => n < 2, () => false);
		assert.deepEqual(
			out.map((p) => (p.kind === 'item' ? p.item.id : `${p.kind}:${p.n}`)),
			['start', 'giro:1', 'giro-sep:2', 'a2']
		);
		const first = out[1];
		assert.ok(first.kind === 'giro' && first.items.length === 2);
	});

	it('un giro aperto mostra intestazione e contenuto', () => {
		const out = foldLoopItems(rows, probe, () => true, (key) => key === 'u1');
		assert.deepEqual(
			out.map((p) => (p.kind === 'item' ? p.item.id : `${p.kind}:${p.n}`)),
			['start', 'giro:1', 'a1', 't1', 'giro:2']
		);
	});

	it('senza giri marcati non cambia nulla', () => {
		const plain: Row[] = [{ id: 'u', user: true }, { id: 'a' }];
		assert.deepEqual(foldLoopItems(plain, probe, () => true, () => false).map((p) => p.kind), ['item', 'item']);
	});
});

describe('loopMode: coda e Companion', () => {
	const base = {
		ready: true,
		attached: true,
		streaming: false,
		compacting: false,
		blockingQuestion: null,
		quotaBlock: null,
		inferencePending: false,
		inferredQuestion: null
	};
	it('un loop attivo occupa la sessione anche fra due giri', () => {
		const gate = resolveAutomationGate({ surface: 'gui', busy: false, session: { ...base, loopActive: true } });
		assert.equal(gate.ready, false);
		assert.equal(gate.autoDispatchReady, false);
		assert.equal(gate.block, 'loop');
		// Il click instrada il task su un'altra corsia invece di fermarsi.
		assert.equal(isLaneRoutable(gate), true);
		assert.equal(resolveAutomationGate({ surface: 'gui', busy: false, session: { ...base, loopActive: false } }).ready, true);
	});
});

describe('loopMode: pillola «Ripeti» nel composer', () => {
	it('di fabbrica subito dopo allegato e @', () => {
		const toolbar = defaultLayout(COMMAND_MANIFEST).pinned.filter((p) => p.zone === 'toolbar').map((p) => p.id);
		assert.deepEqual(toolbar.slice(0, 3), ['ctl.attach', 'ctl.mention', 'loop']);
		const entry = COMMAND_MANIFEST.find((e) => e.id === 'loop');
		assert.equal(entry?.origin, 'studio');
		// Nessun argomento obbligatorio: il clic apre la modalita' ripetizione.
		assert.ok(!/<[^>]+>/.test(entry?.argsHint ?? ''));
	});
});
