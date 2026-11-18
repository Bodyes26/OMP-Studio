/**
 * R-MI-22, regola F25: quando due copie dello stesso progetto divergono.
 * L'avviso sopra il composer dipende da questa regola: un falso positivo lo
 * mostra a chi ha solo una copia da aggiornare, un falso negativo nasconde due
 * codici diversi.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { divergenceReasons, divergenceSignature, inUseCopy, nextOnlineCopy, tileCopy, type CopyGitState } from '../src/lib/stores/projectCopies.ts';

const copy = (over: Partial<CopyGitState> = {}): CopyGitState => ({
	branch: 'main',
	head: 'a1',
	changedFiles: 0,
	...over
});

describe('Copie divergenti (F25)', () => {
	it('una copia soltanto indietro non diverge: si sincronizza', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ head: 'b2' })], []), []);
	});

	it('branch diverse sulle due macchine non sono una divergenza', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ branch: 'redesign' })], []), []);
	});

	it('commit propri su entrambe le copie', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ head: 'b2' })], ['main']), ['commits']);
	});

	it('una sola copia con modifiche non committate non basta', () => {
		assert.deepEqual(divergenceReasons([copy({ changedFiles: 4 }), copy()], []), []);
	});

	it('modifiche non committate su due copie, anche se non quella in uso', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ changedFiles: 1 }), copy({ changedFiles: 3 })], []), ['uncommitted']);
	});

	it('l impronta cambia quando cambia lo stato di una copia o una branch diverge', () => {
		const before = divergenceSignature([copy(), copy({ changedFiles: 2 })], []);
		assert.equal(before, divergenceSignature([copy(), copy({ changedFiles: 2 })], []));
		assert.notEqual(before, divergenceSignature([copy(), copy({ changedFiles: 3 })], []));
		assert.notEqual(before, divergenceSignature([copy(), copy({ changedFiles: 2 })], ['main']));
	});
});

describe('Copia in uso (F18)', () => {
	it('è l ultima usata; a parità resta la prima', () => {
		const a = { id: 'a', lastOpened: 5 };
		const b = { id: 'b', lastOpened: 9 };
		const c = { id: 'c', lastOpened: 9 };
		assert.equal(inUseCopy([a, b, c])?.id, 'b');
		assert.equal(inUseCopy([]), undefined);
	});
});

describe('Copia aperta dalla tessera (R-MI-24)', () => {
	const windows = { id: 'win', lastOpened: 9, waiting: false };
	const mac = { id: 'mac', lastOpened: 5, waiting: true };
	const linux = { id: 'linux', lastOpened: 7, waiting: true };
	const waiting = (copy: { waiting: boolean }) => copy.waiting;

	it('la copia che aspetta una risposta vince sull ultima usata', () => {
		assert.equal(tileCopy([windows, mac], waiting)?.id, 'mac');
	});

	it('fra più copie in attesa, l ultima usata', () => {
		assert.equal(tileCopy([windows, mac, linux], waiting)?.id, 'linux');
	});

	it('senza attese, l ultima usata (F18)', () => {
		assert.equal(tileCopy([windows, { ...mac, waiting: false }], waiting)?.id, 'win');
	});
});

describe('Cambio macchina da tastiera (R-MI-25)', () => {
	const copies = [
		{ id: 'win', online: true },
		{ id: 'mac', online: false },
		{ id: 'linux', online: true }
	];

	it('salta le macchine spente in entrambe le direzioni, in giro', () => {
		assert.equal(nextOnlineCopy(copies, 0, 1)?.id, 'linux');
		assert.equal(nextOnlineCopy(copies, 2, 1)?.id, 'win');
		assert.equal(nextOnlineCopy(copies, 0, -1)?.id, 'linux');
	});

	it('nessun cambio se non c è un altra copia in linea', () => {
		assert.equal(nextOnlineCopy(copies.slice(0, 2), 0, 1), undefined);
		assert.equal(nextOnlineCopy(copies.slice(0, 1), 0, 1), undefined);
	});
});
