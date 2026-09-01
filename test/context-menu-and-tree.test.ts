import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyTabRename,
	applyTabTrash,
	isPathUnder,
	remapPath,
	reorderItemsList,
	shiftItemList
} from '../src/lib/stores/projectTabHelpers.ts';

describe('Gestione tab e percorsi su rinomina/cestino (ProjectStore tab helpers)', () => {
	it('rinomina file singolo aperto aggiornando path e activeFile', () => {
		const open = ['src/a.ts', 'src/b.ts', 'README.md'];
		const active = 'src/b.ts';
		const res = applyTabRename(open, active, 'src/b.ts', 'src/c.ts', false);
		assert.deepEqual(res.openFiles, ['src/a.ts', 'src/c.ts', 'README.md']);
		assert.equal(res.activeFile, 'src/c.ts');
	});

	it('rinomina directory aggiornando tutti i tab discendenti e preservando ordine', () => {
		const open = ['src/components/A.svelte', 'src/components/B.svelte', 'src/index.ts'];
		const active = 'src/components/A.svelte';
		const res = applyTabRename(open, active, 'src/components', 'src/ui', true);
		assert.deepEqual(res.openFiles, ['src/ui/A.svelte', 'src/ui/B.svelte', 'src/index.ts']);
		assert.equal(res.activeFile, 'src/ui/A.svelte');
	});

	it('supporta percorsi case-insensitive su Windows', () => {
		const isWin = process.platform === 'win32';
		if (!isWin) {
			assert.equal(isPathUnder('src/A.ts', 'src/a.ts', false), false);
			return;
		}
		assert.equal(isPathUnder('src/A.ts', 'src/a.ts', false), true);
		assert.equal(remapPath('SRC/COMPONENTS/A.svelte', 'src/components', 'src/ui', true), 'src/ui/A.svelte');
	});

	it('cestino su file attivo seleziona la scheda adiacente a destra se disponibile', () => {
		const open = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
		const active = 'src/b.ts';
		const res = applyTabTrash(open, active, 'src/b.ts', false);
		assert.deepEqual(res.openFiles, ['src/a.ts', 'src/c.ts']);
		assert.equal(res.activeFile, 'src/c.ts');
	});

	it('cestino sull ultimo file attivo seleziona la scheda a sinistra', () => {
		const open = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
		const active = 'src/c.ts';
		const res = applyTabTrash(open, active, 'src/c.ts', false);
		assert.deepEqual(res.openFiles, ['src/a.ts', 'src/b.ts']);
		assert.equal(res.activeFile, 'src/b.ts');
	});

	it('cestino su directory elimina tutti i file aperti al suo interno', () => {
		const open = ['src/components/A.svelte', 'src/components/B.svelte', 'src/main.ts'];
		const active = 'src/components/B.svelte';
		const res = applyTabTrash(open, active, 'src/components', true);
		assert.deepEqual(res.openFiles, ['src/main.ts']);
		assert.equal(res.activeFile, 'src/main.ts');
	});
});

describe('Riordino progetti (manuale e drag&drop)', () => {
	it('moveProject riordina spostando il progetto trascinato nella posizione target', () => {
		const list = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
		const res = reorderItemsList(list, 'p3', 'p1');
		assert.deepEqual(
			res.map((p) => p.id),
			['p3', 'p1', 'p2', 'p4']
		);
	});

	it('moveProject gestisce spostamento da sinistra a destra', () => {
		const list = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
		const res = reorderItemsList(list, 'p1', 'p4');
		assert.deepEqual(
			res.map((p) => p.id),
			['p2', 'p3', 'p1', 'p4']
		);
	});

	it('moveProject ignora spostamenti su se stesso o id inesistenti', () => {
		const list = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
		const res1 = reorderItemsList([...list], 'p2', 'p2');
		assert.deepEqual(
			res1.map((p) => p.id),
			['p1', 'p2', 'p3']
		);

		const res2 = reorderItemsList([...list], 'pX', 'p2');
		assert.deepEqual(
			res2.map((p) => p.id),
			['p1', 'p2', 'p3']
		);
	});

	it('shiftProject sposta la scheda a sinistra o a destra rispettando i limiti', () => {
		const list = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

		const res1 = shiftItemList([...list], 'p2', -1);
		assert.deepEqual(
			res1.map((p) => p.id),
			['p2', 'p1', 'p3']
		);

		const res2 = shiftItemList([...list], 'p1', -1);
		assert.deepEqual(
			res2.map((p) => p.id),
			['p1', 'p2', 'p3']
		);

		const res3 = shiftItemList([...list], 'p2', +1);
		assert.deepEqual(
			res3.map((p) => p.id),
			['p1', 'p3', 'p2']
		);
	});
});
