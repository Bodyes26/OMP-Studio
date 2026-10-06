import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AskStreamTracker, parsePartialAskStream, repairPartialJson, streamToAskQuestions } from '../src/lib/agent/askStream.ts';
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

describe('AskStreamTracker: anteprima da studio_delta di tipo toolcall', () => {
	type Frame = {
		type: string;
		kind?: string;
		contentIndex?: number;
		delta?: string;
		assistantMessageEvent?: {
			type: string;
			contentIndex?: number;
			delta?: string;
			toolCall?: { id?: string; name?: string; arguments?: unknown };
			partial?: { content?: Array<{ id?: string; name?: string; arguments?: unknown }> };
		};
	};

	/**
	 * Riscrive i `toolcall_delta` come li spedisce src-tauri/src/rpc/mod.rs
	 * (`{"type":"studio_delta","kind":"toolcall","contentIndex":n,"delta":...}`),
	 * spezzati in pezzi piccoli come farebbe la finestra di accorpamento.
	 */
	function asBackendFrames(lines: string[], chunk = 24): Frame[] {
		const out: Frame[] = [];
		for (const line of lines) {
			const frame = JSON.parse(line) as Frame;
			const inner = frame.assistantMessageEvent;
			if (frame.type === 'message_update' && inner?.type === 'toolcall_delta') {
				const text = inner.delta ?? '';
				for (let i = 0; i < text.length; i += chunk) {
					out.push({
						type: 'studio_delta',
						kind: 'toolcall',
						contentIndex: inner.contentIndex ?? 0,
						delta: text.slice(i, i + chunk)
					});
				}
				continue;
			}
			out.push(frame);
		}
		return out;
	}

	it('dai frame reali di ask-real.ndjson l\'anteprima riceve domande parziali prima della fine', () => {
		const lines = readFileSync(join(ROOT, 'fixtures', 'chat-v2', 'ask-real.ndjson'), 'utf8')
			.split('\n')
			.filter((l) => l.trim().length > 0);
		const tracker = new AskStreamTracker();
		const counts: number[] = [];
		let sawPartial = false;
		let finalCount = 0;
		for (const frame of asBackendFrames(lines)) {
			const inner = frame.assistantMessageEvent;
			if (frame.type === 'studio_delta' && frame.kind === 'toolcall') {
				// Come AgentSession.applyDelta: nessun nome di tool nel frame.
				if (tracker.delta(frame.contentIndex ?? 0, frame.delta ?? '')) {
					const state = tracker.current!.state;
					counts.push(state.questions.length);
					if (state.questions.length > 0 && !state.complete) sawPartial = true;
				}
			} else if (frame.type === 'message_update' && inner?.type === 'toolcall_start') {
				const index = inner.contentIndex ?? 0;
				tracker.start(index, inner.toolCall ?? inner.partial?.content?.[index]);
			} else if (frame.type === 'message_update' && inner?.type === 'toolcall_end') {
				const index = inner.contentIndex ?? 0;
				tracker.end(index, inner.toolCall ?? inner.partial?.content?.[index]);
				finalCount = tracker.current?.state.questions.length ?? 0;
			}
		}
		assert.ok(counts.length > 3, 'i delta del backend raggiungono l\'anteprima');
		assert.ok(sawPartial, 'domande parziali visibili durante lo streaming');
		assert.ok(counts.at(-1)! >= counts[0], 'le domande crescono con i delta');
		assert.equal(finalCount, 2);
		assert.equal(tracker.current?.toolCallId, 'call_817847');
	});

	it('i delta di un altro tool sullo stesso indice non entrano nell\'anteprima', () => {
		const tracker = new AskStreamTracker();
		assert.equal(tracker.start(0, { id: 'a', name: 'ask' }), true);
		tracker.delta(0, '{"questions":[{"question":"Uno"');
		tracker.end(0, { id: 'a', name: 'ask', arguments: { questions: [{ question: 'Uno', options: [] }] } });
		// Messaggio successivo: `read` riparte dall'indice 0.
		assert.equal(tracker.start(0, { id: 'b', name: 'read' }), false);
		assert.equal(tracker.delta(0, '{"path":"a.ts"}'), false);
		assert.equal(tracker.delta(1, '{"x":1}'), false);
	});
});
