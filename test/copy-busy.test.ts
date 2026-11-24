/**
 * R-MI-57, D1, D2: una copia e' occupata solo dove si lavora davvero.
 *
 * Tre casi del difetto reale: un file non salvato in un ALTRO progetto,
 * una corsia solo aperta ma ferma sull'altra macchina, e una sessione al
 * lavoro che deve occupare la sua cartella e non la radice del progetto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { busyCopyPaths } from '../src/lib/stores/projectCopies.ts';

const root = '/Users/me/dev/omp';
const lane = '/Users/me/dev/omp-worktrees/wt-1';

describe('Cartelle occupate di una copia (R-MI-57, D1, D2)', () => {
	it('i file non salvati di un altro progetto non occupano questa copia', () => {
		assert.deepEqual(
			busyCopyPaths({
				folders: [root, lane],
				dirtyFolders: ['/Users/me/dev/altro-progetto'],
				workingFolders: [],
				remoteWorkingFolders: []
			}),
			[],
			'un editor aperto su un altro progetto non blocca niente'
		);
	});

	it('i file non salvati di questa cartella la occupano', () => {
		assert.deepEqual(
			busyCopyPaths({ folders: [root, lane], dirtyFolders: [root], workingFolders: [], remoteWorkingFolders: [] }),
			[root]
		);
	});

	it('una sessione al lavoro occupa la sua cartella, non la radice (D2)', () => {
		assert.deepEqual(
			busyCopyPaths({ folders: [root, lane], dirtyFolders: [], workingFolders: [lane], remoteWorkingFolders: [] }),
			[lane],
			'la radice resta libera: nessuno sta scrivendo li'
		);
	});

	it('una corsia solo aperta e ferma sull altra macchina non occupa (D1)', () => {
		assert.deepEqual(
			busyCopyPaths({ folders: [root, lane], dirtyFolders: [], workingFolders: [], remoteWorkingFolders: [] }),
			[],
			'la presenza di una surface remota non e lavoro'
		);
	});

	it('una corsia su cui l altra macchina lavora davvero la occupa (D1)', () => {
		assert.deepEqual(
			busyCopyPaths({ folders: [root, lane], dirtyFolders: [], workingFolders: [], remoteWorkingFolders: [lane] }),
			[lane]
		);
	});

	it('le cartelle sono riportate nella forma originale, una volta sola', () => {
		const paths = busyCopyPaths({
			folders: [root, lane],
			dirtyFolders: [root],
			workingFolders: [root],
			// Stessa cartella scritta con la barra finale: e' quella del progetto.
			remoteWorkingFolders: [`${root}/`]
		});
		assert.deepEqual(paths, [root], 'la stessa cartella per tre motivi resta una');
	});

	it('un percorso che non appartiene al progetto viene scartato', () => {
		assert.deepEqual(
			busyCopyPaths({ folders: [root], dirtyFolders: ['/tmp/altrove'], workingFolders: [], remoteWorkingFolders: [] }),
			[]
		);
	});
});
