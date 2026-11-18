/**
 * R-MI-22 / Q5: quando due copie dello stesso progetto divergono. L'avviso
 * sopra il composer dipende da questa regola: un falso positivo lo mostra a
 * chi sta solo lavorando, un falso negativo nasconde due codici diversi.
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

describe('Copie divergenti (Q5)', () => {
	it('allineate: stesso branch, stesso commit, nessuna modifica', () => {
		assert.deepEqual(divergenceReasons([copy(), copy()]), []);
	});

	it('una sola copia con modifiche non committate non basta', () => {
		assert.deepEqual(divergenceReasons([copy({ changedFiles: 4 }), copy()]), []);
		assert.deepEqual(divergenceReasons([copy(), copy({ changedFiles: 2 })]), []);
	});

	it('modifiche non committate su entrambe', () => {
		assert.deepEqual(divergenceReasons([copy({ changedFiles: 4 }), copy({ changedFiles: 1 })]), ['uncommitted']);
	});

	it('branch diversi, anche con lo stesso commit', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ branch: 'redesign' })]), ['branch']);
	});

	it('stesso branch con commit diversi', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ head: 'b2' })]), ['commits']);
	});

	it('un commit non ancora letto non fa scattare l avviso', () => {
		assert.deepEqual(divergenceReasons([copy(), copy({ head: null })]), []);
	});

	it('con tre copie confronta ognuna con quella in uso', () => {
		assert.deepEqual(
			divergenceReasons([copy({ changedFiles: 1 }), copy(), copy({ branch: 'x', changedFiles: 3 })]).sort(),
			['branch', 'uncommitted']
		);
	});

	it('l impronta cambia quando cambia lo stato di una copia', () => {
		const before = divergenceSignature([copy(), copy({ branch: 'redesign' })]);
		assert.equal(before, divergenceSignature([copy(), copy({ branch: 'redesign' })]));
		assert.notEqual(before, divergenceSignature([copy(), copy({ branch: 'redesign', head: 'c3' })]));
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
