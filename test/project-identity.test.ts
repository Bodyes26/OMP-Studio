/**
 * R-MI-12 (MI20): lo stesso progetto su due macchine compare una volta sola.
 * L'identità è l'origin GitHub normalizzato, altrimenti il primo commit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	copiesDiverge,
	groupByRepository,
	identityKey,
	identityOf
} from '../src/lib/stores/projectIdentity.ts';

describe('Identita del progetto fra macchine (R-MI-12)', () => {
	it('due copie con lo stesso origin sono lo stesso progetto', () => {
		const mac = identityOf({ repoSlug: 'bodyes26/omp-studio' });
		const pc = identityOf({ repoSlug: 'Bodyes26/OMP-Studio' });
		assert.equal(identityKey(mac), identityKey(pc), 'il confronto ignora maiuscole');
		assert.deepEqual(mac, { kind: 'origin', value: 'bodyes26/omp-studio' });
	});

	it('origin diversi restano progetti diversi', () => {
		const a = identityKey(identityOf({ repoSlug: 'bodyes26/una' }));
		const b = identityKey(identityOf({ repoSlug: 'bodyes26/altra' }));
		assert.notEqual(a, b);
	});

	it("l'origin vince sul primo commit, cosi due fork non si fondono", () => {
		const fork = identityOf({ repoSlug: 'altro/fork', rootCommit: 'abc123' });
		assert.deepEqual(fork, { kind: 'origin', value: 'altro/fork' });
		assert.notEqual(
			identityKey(fork),
			identityKey(identityOf({ rootCommit: 'abc123' })),
			'un fork con la stessa radice non e il progetto originale'
		);
	});

	it('senza origin vale il primo commit', () => {
		assert.deepEqual(identityOf({ rootCommit: 'ABC123' }), { kind: 'root-commit', value: 'abc123' });
	});

	it('senza ancore non c e identita e le copie restano separate', () => {
		assert.equal(identityOf(null), null);
		assert.equal(identityOf({}), null);
		assert.equal(identityOf({ repoSlug: '  ', rootCommit: '' }), null);
	});

	it('raggruppa le copie dello stesso repository', () => {
		const copies = [
			{ repoSlug: 'bodyes26/omp-studio', name: 'Mac' },
			{ repoSlug: 'bodyes26/altro', name: 'Altro' },
			{ repoSlug: 'bodyes26/omp-studio', name: 'PC' }
		];
		assert.deepEqual(groupByRepository(copies), [[0, 2], [1]]);
	});

	it('le copie senza identita restano singole', () => {
		const copies = [{ name: 'a' }, { name: 'b' }];
		assert.deepEqual(groupByRepository(copies), [[0], [1]]);
	});

	it('un progetto locale e uno remoto omonimo senza git restano distinti', () => {
		assert.deepEqual(groupByRepository([{ name: 'x' }, { name: 'x' }]), [[0], [1]]);
	});

	it("l'ordine dei gruppi segue la prima comparsa", () => {
		const copies = [
			{ repoSlug: 'a/uno' },
			{ repoSlug: 'a/due' },
			{ repoSlug: 'a/uno' }
		];
		assert.deepEqual(groupByRepository(copies), [[0, 2], [1]]);
	});

	it('branch diversi sono divergenza', () => {
		assert.equal(copiesDiverge({ branch: 'main', ahead: 0 }, { branch: 'feat', ahead: 0 }), true);
	});

	it('commit non spinti su entrambe le copie sono divergenza', () => {
		assert.equal(copiesDiverge({ branch: 'main', ahead: 2 }, { branch: 'main', ahead: 1 }), true);
	});

	it('stato git non letto non e divergenza', () => {
		assert.equal(copiesDiverge(null, { branch: 'main' }), false);
		assert.equal(copiesDiverge({ branch: 'main' }, { branch: null }), false);
		assert.equal(copiesDiverge({ branch: 'main', ahead: 0 }, { branch: 'main', ahead: 0 }), false);
	});
});
