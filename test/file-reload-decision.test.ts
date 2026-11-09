import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFileReload } from '../src/lib/editor/fileReloadDecision.ts';

test('EXT-011: baseline uguale al contenuto su disco -> ignora', () => {
	// Caso file pulito: baseline e disco identici
	const resClean = decideFileReload({
		diskContent: 'const a = 1;\n',
		baselineContent: 'const a = 1;\n',
		currentContent: 'const a = 1;\n'
	});
	assert.deepEqual(resClean, { action: 'ignore' });

	// Caso file con modifiche locali non salvate, ma il disco non e' cambiato rispetto alla baseline
	// (es. evento di filesystem ritardato o tocco di mtime senza modifiche di contenuto)
	const resDirty = decideFileReload({
		diskContent: 'baseline',
		baselineContent: 'baseline',
		currentContent: 'baseline con modifiche'
	});
	assert.deepEqual(resDirty, { action: 'ignore' });
});

test('EXT-011: file pulito con disco modificato -> ricarica automatica', () => {
	const res = decideFileReload({
		diskContent: 'nuovo testo dal blocco note\n',
		baselineContent: 'vecchio testo\n',
		currentContent: 'vecchio testo\n'
	});
	assert.deepEqual(res, {
		action: 'reload',
		content: 'nuovo testo dal blocco note\n'
	});
});

test('EXT-011: file sporco con disco modificato -> conflitto e avviso', () => {
	const res = decideFileReload({
		diskContent: 'modifica esterna su disco',
		baselineContent: 'testo originale',
		currentContent: 'modifica locale non salvata'
	});
	assert.deepEqual(res, {
		action: 'conflict',
		diskContent: 'modifica esterna su disco'
	});
});

test('EXT-011: file sporco ma contenuto su disco identico alle modifiche locali -> ricarica/allinea', () => {
	const res = decideFileReload({
		diskContent: 'stesso testo',
		baselineContent: 'testo precedente',
		currentContent: 'stesso testo'
	});
	assert.deepEqual(res, {
		action: 'reload',
		content: 'stesso testo'
	});
});

test('EXT-011: file cancellato sul disco -> stato deleted', () => {
	// File pulito cancellato
	const resClean = decideFileReload({
		diskContent: null,
		baselineContent: 'testo',
		currentContent: 'testo'
	});
	assert.deepEqual(resClean, { action: 'deleted' });

	// File sporco cancellato
	const resDirty = decideFileReload({
		diskContent: null,
		baselineContent: 'testo',
		currentContent: 'testo modificato'
	});
	assert.deepEqual(resDirty, { action: 'deleted' });
});

test('EXT-011: attivazione tab in cache / rientro su progetto con disco modificato', () => {
	// File in cache rimasto pulito: il disco e' stato modificato mentre il progetto/tab non era attivo
	const resClean = decideFileReload({
		diskContent: 'aggiornato da git pull mentre ero su un altro progetto',
		baselineContent: 'vecchia versione in cache',
		currentContent: 'vecchia versione in cache'
	});
	assert.deepEqual(resClean, {
		action: 'reload',
		content: 'aggiornato da git pull mentre ero su un altro progetto'
	});

	// File in cache con modifiche non salvate: il disco e' stato modificato esternamente nel frattempo
	const resDirty = decideFileReload({
		diskContent: 'aggiornato esternamente',
		baselineContent: 'baseline originale',
		currentContent: 'modifiche locali non salvate'
	});
	assert.deepEqual(resDirty, {
		action: 'conflict',
		diskContent: 'aggiornato esternamente'
	});
});
