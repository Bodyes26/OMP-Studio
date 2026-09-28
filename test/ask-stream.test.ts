import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePartialAskStream, repairPartialJson, streamToAskQuestions } from '../src/lib/agent/askStream.ts';
import type { StreamAskState } from '../src/lib/agent/askStream.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

describe('AskStream: parser tollerante per argomenti ask parziali', () => {
	const realAskPayload =
		'{"questions":[{"question":"Select your preferred fruit","id":"preferred_fruit","recommended":0,"options":[{"label":"Apple"},{"label":"Banana"},{"label":"Orange"}]},{"question":"Select toppings","id":"toppings","multi":true,"options":[{"label":"Chocolate"},{"label":"Sprinkles"},{"label":"Caramel"}]}],"i":"Asking user preferences"}';

	it('non lancia mai eccezioni con input vuoto o nullo', () => {
		assert.deepEqual(parsePartialAskStream(null), { questions: [], complete: false });
		assert.deepEqual(parsePartialAskStream(undefined), { questions: [], complete: false });
		assert.deepEqual(parsePartialAskStream(''), { questions: [], complete: false });
		assert.deepEqual(parsePartialAskStream('   '), { questions: [], complete: false });
		assert.deepEqual(parsePartialAskStream(12345), {
			questions: [],
			complete: false,
			raw: undefined
		});
	});

	it('gestisce JSON troncato a OGNI singolo punto senza mai crashare', () => {
		for (let i = 0; i <= realAskPayload.length; i++) {
			const slice = realAskPayload.slice(0, i);
			let state: StreamAskState;
			assert.doesNotThrow(() => {
				state = parsePartialAskStream(slice);
			}, `Crash con troncamento a indice ${i}: "${slice}"`);

			assert.ok(Array.isArray(state!.questions), `questions non e un array a indice ${i}`);
			if (i < realAskPayload.length) {
				assert.equal(
					state!.complete,
					false,
					`complete non puo essere true su un prefisso parziale (indice ${i})`
				);
			}
		}

		// A stringa intera complete e true
		const finalState = parsePartialAskStream(realAskPayload);
		assert.equal(finalState.complete, true);
		assert.equal(finalState.questions.length, 2);
		assert.equal(finalState.questions[0].options.length, 3);
		assert.equal(finalState.questions[1].options.length, 3);
	});

	it('rileva progressivamente la comparsa di domande e opzioni', () => {
		const prefix1 = '{"questions":[{"question":"Select fruit';
		const state1 = parsePartialAskStream(prefix1);
		assert.equal(state1.questions.length, 1);
		assert.equal(state1.questions[0].question, 'Select fruit');
		assert.equal(state1.questions[0].textComplete, false);
		assert.equal(state1.questions[0].options.length, 0);

		const prefix2 = '{"questions":[{"question":"Select fruit","options":[{"label":"Apple"}';
		const state2 = parsePartialAskStream(prefix2);
		assert.equal(state2.questions.length, 1);
		assert.equal(state2.questions[0].textComplete, true);
		assert.equal(state2.questions[0].options.length, 1);
		assert.equal(state2.questions[0].options[0].label, 'Apple');
		assert.equal(state2.questions[0].optionsComplete, false);

		const prefix3 =
			'{"questions":[{"question":"Select fruit","options":[{"label":"Apple"},{"label":"Banana"}]}';
		const state3 = parsePartialAskStream(prefix3);
		assert.equal(state3.questions[0].options.length, 2);
		assert.equal(state3.questions[0].optionsComplete, true);
	});

	it('accetta oggetti gia deserializzati', () => {
		const obj = {
			questions: [
				{
					id: 'q1',
					question: 'Test?',
					options: [{ label: 'Si' }, { label: 'No' }]
				}
			]
		};
		const state = parsePartialAskStream(obj);
		assert.equal(state.complete, true);
		assert.equal(state.questions.length, 1);
		assert.equal(state.questions[0].id, 'q1');
		assert.equal(state.questions[0].options.length, 2);
	});

	it('ripara chiavi sospese e contenitori non bilanciati', () => {
		assert.deepEqual(repairPartialJson('{"questions": [{"id":'), { questions: [{ id: null }] });
		assert.deepEqual(repairPartialJson('{"questions": ["a", "b",'), { questions: ['a', 'b'] });
		assert.deepEqual(repairPartialJson('{"questions": [{"options": [{"label": "opt'), {
			questions: [{ options: [{ label: 'opt' }] }]
		});
	});

	it('converte le domande streaming in AskQuestion[]', () => {
		const parsed = parsePartialAskStream(realAskPayload);
		const askQuestions = streamToAskQuestions(parsed.questions);
		assert.equal(askQuestions.length, 2);
		assert.equal(askQuestions[0].id, 'preferred_fruit');
		assert.equal(askQuestions[0].question, 'Select your preferred fruit');
		assert.equal(askQuestions[0].recommended, 0);
		assert.deepEqual(
			askQuestions[0].options.map((o) => o.label),
			['Apple', 'Banana', 'Orange']
		);
		assert.equal(askQuestions[1].id, 'toppings');
		assert.equal(askQuestions[1].multi, true);
		assert.deepEqual(
			askQuestions[1].options.map((o) => o.label),
			['Chocolate', 'Sprinkles', 'Caramel']
		);
	});

	it('riproduce la sequenza reale da test/fixtures/chat-v2/ask-real.ndjson', () => {
		const fixturePath = join(ROOT, 'fixtures', 'chat-v2', 'ask-real.ndjson');
		const content = readFileSync(fixturePath, 'utf8');
		const lines = content.split('\n').filter((l) => l.trim().length > 0);

		let streamedArgs = '';
		let foundDelta = false;
		let sawComplete = false;

		for (const line of lines) {
			const frame = JSON.parse(line);
			if (frame.type === 'message_update' && frame.assistantMessageEvent?.type === 'toolcall_delta') {
				foundDelta = true;
				streamedArgs += frame.assistantMessageEvent.delta ?? '';
				const partial = parsePartialAskStream(streamedArgs);
				assert.ok(partial.questions.length > 0);
			} else if (
				frame.type === 'message_update' &&
				frame.assistantMessageEvent?.type === 'toolcall_end'
			) {
				const finalArgs = frame.assistantMessageEvent.toolCall?.arguments;
				const full = parsePartialAskStream(finalArgs);
				assert.equal(full.complete, true);
				assert.equal(full.questions.length, 2);
				sawComplete = true;
			}
		}

		assert.ok(foundDelta, 'Dovrebbe aver trovato almeno un toolcall_delta nella fixture');
		assert.ok(sawComplete, 'Dovrebbe aver completato il toolcall con successo');
	});
});
