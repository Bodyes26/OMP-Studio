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

import {
	filterAndGroupModels,
	isSameModel,
	getEffectiveSelector,
	type SharedModelItem
} from '../src/lib/components/models/modelPicker.ts';

const SAMPLE_MODELS: SharedModelItem[] = [
	{ id: 'gpt-6.1', name: 'GPT-6.1 Preview', provider: 'openai', selector: 'openai/gpt-6.1' },
	{ id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'anthropic', selector: 'anthropic/claude-3-7-sonnet' },
	{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', selector: 'google/gemini-2.5-flash' },
	{ id: 'custom-local', name: 'Custom Local' }
];

test("filterAndGroupModels: fuzzy query 'gpt 6.1' trova il modello con id 'gpt-6.1'", () => {
	for (const q of ['gpt 6.1', 'gpt-6.1', 'gpt 61', 'GPT6.1']) {
		const { visibleModels } = filterAndGroupModels(SAMPLE_MODELS, q);
		assert.equal(visibleModels.length, 1, `Query: ${q}`);
		assert.equal(visibleModels[0].id, 'gpt-6.1');
	}
});

test('filterAndGroupModels: corrispondenze cross-field e assenza di falsi positivi', () => {
	const resOpenAi = filterAndGroupModels(SAMPLE_MODELS, 'openai gpt');
	assert.equal(resOpenAi.visibleModels.length, 1);
	assert.equal(resOpenAi.visibleModels[0].id, 'gpt-6.1');

	const resAnthropic = filterAndGroupModels(SAMPLE_MODELS, 'anthropic sonnet');
	assert.equal(resAnthropic.visibleModels.length, 1);
	assert.equal(resAnthropic.visibleModels[0].id, 'claude-3-7-sonnet');

	const resNone = filterAndGroupModels(SAMPLE_MODELS, 'gpt 5.7');
	assert.equal(resNone.visibleModels.length, 0);
});

test('filterAndGroupModels: ordinamento provider alfabetico e visibleModels per tastiera', () => {
	const { groupedModels, visibleModels } = filterAndGroupModels(SAMPLE_MODELS, '');
	const providerOrder = groupedModels.map(([provider]) => provider);
	assert.deepEqual(providerOrder, ['Altri', 'anthropic', 'google', 'openai']);

	// visibleModels deve seguire rigorosamente l'ordine visivo a gruppi:
	// 'Altri' -> 'anthropic' -> 'google' -> 'openai'
	const visibleIds = visibleModels.map((m) => m.id);
	assert.deepEqual(visibleIds, ['custom-local', 'claude-3-7-sonnet', 'gemini-2.5-flash', 'gpt-6.1']);
});

test('isSameModel e getEffectiveSelector: preservano identita provider e selettore', () => {
	const m1: SharedModelItem = { id: 'gpt-4o', provider: 'openai', selector: 'openai/gpt-4o' };
	const m2: SharedModelItem = { id: 'gpt-4o', provider: 'openai' };
	const m3: SharedModelItem = { id: 'gpt-4o', provider: 'azure' };

	assert.equal(isSameModel(m1, m2), true);
	assert.equal(isSameModel(m1, m3), false);
	assert.equal(getEffectiveSelector(m1), 'openai/gpt-4o');
	assert.equal(getEffectiveSelector(m2), 'openai/gpt-4o');
	assert.equal(getEffectiveSelector({ id: 'bare' }), 'bare');
});
