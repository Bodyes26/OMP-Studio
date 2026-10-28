/// <reference types="node" />
/// <reference lib="es2020" />

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitAskContext } from '../src/lib/companion/askContext.ts';
import type { AssistantEntry, ToolEntry, TranscriptEntry, UserEntry } from '../src/lib/agent/session.svelte.ts';

const user = (id: number, content: string): UserEntry => ({ id, kind: 'user', content, images: [] });
const text = (id: number, value: string): AssistantEntry => ({ id, kind: 'assistant', blocks: [{ type: 'text', text: value }] });
const ask = (id: number, running: boolean): ToolEntry => ({
	id,
	kind: 'tool',
	toolCallId: `call-${id}`,
	toolName: 'ask',
	args: { questions: [{ id: 'q', question: 'Domanda?', options: [{ label: 'A' }] }] },
	running,
	startedAt: 0
});
const ids = (items: { entry: { id: number } }[]) => items.map((item) => item.entry.id);

describe('Companion: contesto della domanda in attesa', () => {
	it('dopo una domanda gia risposta il preambolo e solo il testo scritto dopo', () => {
		const entries: TranscriptEntry[] = [
			user(1, 'fai il piano'),
			text(2, 'Messaggio lungo con tabella e rischi'),
			ask(3, false),
			text(4, 'Sync oggi presenti nel codice'),
			ask(5, true)
		];
		const ctx = splitAskContext(entries);
		assert.deepEqual(ids(ctx.leadIn), [4]);
		assert.deepEqual(ids(ctx.prior), [1, 2, 3]);
	});

	it('una domanda subito dopo la risposta precedente non ha preambolo', () => {
		const entries: TranscriptEntry[] = [
			text(1, 'Messaggio lungo'),
			ask(2, false),
			{ id: 3, kind: 'assistant', blocks: [{ type: 'thinking', text: 'ragiono' }] } as AssistantEntry,
			ask(4, true)
		];
		const ctx = splitAskContext(entries);
		assert.deepEqual(ids(ctx.leadIn), []);
		assert.deepEqual(ids(ctx.prior), [1, 2]);
	});

	it('un messaggio dell utente chiude il preambolo del turno precedente', () => {
		const entries: TranscriptEntry[] = [text(1, 'dimmi quali sync'), user(2, 'tutti'), text(3, 'Ecco cosa ho trovato'), text(4, 'e poi')];
		const ctx = splitAskContext(entries);
		assert.deepEqual(ids(ctx.leadIn), [3, 4]);
		assert.deepEqual(ids(ctx.prior), [1, 2]);
	});
});
