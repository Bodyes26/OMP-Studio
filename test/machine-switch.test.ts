/**
 * R-MI-62 / R-MI-63 / D3: chat vuota istantanea, chat ferma spostata dopo
 * l'allineamento, turno in corso prenotato; un blocco dice cosa e dove.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	alignUntilSettled,
	alignVerdict,
	conflictFiles,
	decideSwitch,
	isBlocked,
	type AlignSide,
	type SwitchInput
} from '../src/lib/agent/machineSwitch.ts';

const free = (machine: string) => ({ machine, working: null, question: null, unsaved: [] });

function input(overrides: Partial<SwitchInput> = {}): SwitchInput {
	return {
		empty: false,
		working: false,
		question: false,
		from: free('MacBook'),
		to: free('PC'),
		conflict: null,
		...overrides
	};
}

describe('Cambiare macchina: cosa succede (R-MI-62, D3)', () => {
	it('una chat vuota passa subito, senza domande e senza spostare nulla', () => {
		assert.equal(decideSwitch(input({ empty: true })), 'instant');
	});

	it('una chat vuota passa subito anche con un agente al lavoro altrove', () => {
		const decision = decideSwitch(input({
			empty: true,
			from: { machine: 'MacBook', working: '/p', question: null, unsaved: [] }
		}));
		assert.equal(decision, 'instant', "la chat vuota non ha nulla da proteggere");
	});

	it('una chat ferma con le cartelle libere si sposta', () => {
		assert.equal(decideSwitch(input()), 'move');
	});

	it('se lavora l agente di questa chat lo spostamento si prenota', () => {
		assert.equal(decideSwitch(input({ working: true })), 'defer');
	});

	it('una domanda in attesa prenota lo spostamento invece di aspettare il turno', () => {
		assert.equal(decideSwitch(input({ question: true })), 'defer');
	});

	it('un agente al lavoro su un altra corsia blocca e dice quale macchina', () => {
		const decision = decideSwitch(input({
			from: { machine: 'MacBook', working: '/p/wt-1', question: null, unsaved: [] }
		}));
		assert.ok(isBlocked(decision));
		assert.equal(decision.blocked, 'agent');
		assert.equal(decision.machine, 'MacBook');
		assert.deepEqual(decision.files, ['/p/wt-1']);
	});

	it('una domanda pendente su una delle due copie blocca e nomina la cartella', () => {
		const decision = decideSwitch(input({
			to: { machine: 'PC', working: null, question: 'C:/p', unsaved: [] }
		}));
		assert.ok(isBlocked(decision));
		assert.equal(decision.blocked, 'question');
		assert.equal(decision.machine, 'PC');
		assert.deepEqual(decision.files, ['C:/p']);
	});

	it('file non salvati nell editor bloccano e nominano i file', () => {
		const decision = decideSwitch(input({
			from: { machine: 'MacBook', working: null, question: null, unsaved: ['/p/a.ts', '/p/b.ts'] }
		}));
		assert.ok(isBlocked(decision));
		assert.equal(decision.blocked, 'unsaved');
		assert.deepEqual(decision.files, ['/p/a.ts', '/p/b.ts']);
	});

	it('un conflitto git blocca solo se nessuno sta lavorando', () => {
		const conflict = { machine: 'MacBook', files: ['src/a.ts'] };
		const blocked = decideSwitch(input({ conflict }));
		assert.ok(isBlocked(blocked));
		assert.equal(blocked.blocked, 'conflict');
		assert.deepEqual(blocked.files, ['src/a.ts']);
		// Lavoro vero prima del conflitto: il messaggio deve dire quello.
		assert.equal(decideSwitch(input({ conflict, working: true })), 'defer');
	});

	it('un conflitto senza file non nomina nulla e non blocca', () => {
		assert.equal(decideSwitch(input({ conflict: { machine: 'MacBook', files: [] } })), 'move');
	});
});

const branch = (overrides: Partial<AlignSide['branches'][number]> = {}) => ({
	local: 'aaa',
	peer: 'bbb',
	state: 'equal',
	reason: null,
	...overrides
});

function side(machine: string, head: string | null, branches: AlignSide['branches'] = []): AlignSide {
	return { machine, head, branches };
}

describe('Allineamento prima dello spostamento (R-MI-61, R-MI-62)', () => {
	it('stesse cime: si procede', () => {
		assert.equal(alignVerdict({ from: side('MacBook', 'abc'), to: side('PC', 'abc'), merged: false }), 'aligned');
	});

	it('un unione appena fatta chiede un giro in piu anche con le cime diverse', () => {
		assert.equal(alignVerdict({ from: side('MacBook', 'mer'), to: side('PC', 'old'), merged: true }), 'again');
	});

	it('dopo il giro in piu le cime sono uguali: si procede', async () => {
		let round = 0;
		const verdict = await alignUntilSettled(async () => {
			round += 1;
			return round === 1 ? 'again' : 'aligned';
		});
		assert.equal(verdict, 'aligned');
		assert.equal(round, 2);
	});

	it('cessa i giri: non aspetta mai per sempre una copia che non recupera', async () => {
		let round = 0;
		const verdict = await alignUntilSettled(async () => {
			round += 1;
			return 'again';
		});
		assert.deepEqual(verdict, { blocked: 'commit' });
		assert.equal(round, 3, 'un giro piu due di recupero, poi si ferma');
	});

	it('una divergenza con conflitto nomina macchina e file', () => {
		const verdict = alignVerdict({
			from: side('MacBook', 'aaa'),
			to: side('PC', 'bbb', [branch({ state: 'diverged', reason: 'conflict:src/a.ts,src/b.ts' })]),
			merged: false
		});
		assert.deepEqual(verdict, { blocked: 'conflict', machine: 'PC', files: ['src/a.ts', 'src/b.ts'] });
	});

	it('un avanzamento bloccato riporta il motivo del backend', () => {
		const verdict = alignVerdict({
			from: side('MacBook', 'aaa', [branch({ state: 'pending', reason: 'busy' })]),
			to: side('PC', 'bbb'),
			merged: false
		});
		assert.deepEqual(verdict, { blocked: 'pending', machine: 'MacBook', detail: 'busy' });
	});

	it('la collisione per maiuscole resta un blocco, non un conflitto da unire', () => {
		const verdict = alignVerdict({
			from: side('MacBook', 'aaa'),
			to: side('PC', 'bbb', [branch({ state: 'caseConflict', reason: 'Feature' })]),
			merged: false
		});
		assert.equal(verdict && typeof verdict === 'object' ? verdict.blocked : verdict, 'pending');
	});

	it('cime diverse senza spiegazione del backend: non si sposta', () => {
		const verdict = alignVerdict({
			from: side('MacBook', 'aaa', [branch({ state: 'equal' })]),
			to: side('PC', 'bbb', [branch({ state: 'advanced' })]),
			merged: false
		});
		assert.deepEqual(verdict, { blocked: 'commit' });
	});

	it('i file del motivo conflict sono quelli nominati dal backend', () => {
		assert.deepEqual(conflictFiles('conflict:a.ts,b.ts'), ['a.ts', 'b.ts']);
		assert.deepEqual(conflictFiles('conflict:a.ts'), ['a.ts']);
		assert.deepEqual(conflictFiles('busy'), []);
		assert.deepEqual(conflictFiles(null), []);
	});
});
