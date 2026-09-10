/**
 * Smoke test del confronto "sciolto" usato dai filtri di ricerca dei modelli.
 * Difende il contratto osservabile: cercando un modello a memoria, senza
 * ricordarne la punteggiatura esatta, il modello deve comunque comparire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchesLooseQuery } from '../src/lib/looseSearch.ts';

const SOL = ['GPT-5.6 Sol', 'gpt-5.6-sol', 'codex-openai', 'codex-openai/gpt-5.6-sol'];
const OPUS = ['Claude Opus 5', 'claude-opus-5', 'anthropic', 'anthropic/claude-opus-5'];

test('Ricerca modelli: punteggiatura e spazi non contano', () => {
	for (const query of ['gpt 5.6', 'gpt 56', 'gpt-5.6', 'GPT5.6']) {
		assert.equal(matchesLooseQuery(query, ...SOL), true, query);
	}
	assert.equal(matchesLooseQuery('opus5', ...OPUS), true);
});

test('Ricerca modelli: token in qualsiasi ordine, anche su campi diversi', () => {
	assert.equal(matchesLooseQuery('gpt sol', ...SOL), true);
	assert.equal(matchesLooseQuery('sol gpt', ...SOL), true);
	assert.equal(matchesLooseQuery('codex sol', ...SOL), true);
});

test('Ricerca modelli: ogni token deve combaciare, niente lettere sparse', () => {
	assert.equal(matchesLooseQuery('gpt sol', ...OPUS), false);
	assert.equal(matchesLooseQuery('gpt 5.7', ...SOL), false);
	// "claudeopus5" contiene c-o-d-e-x in ordine sparso: non deve bastare.
	assert.equal(matchesLooseQuery('codex', ...OPUS), false);
});

test('Ricerca modelli: query vuota o di sola punteggiatura non filtra nulla', () => {
	for (const query of ['', '   ', '-/.']) {
		assert.equal(matchesLooseQuery(query, ...OPUS), true, JSON.stringify(query));
	}
	assert.equal(matchesLooseQuery('opus', null, undefined, ''), false);
});
