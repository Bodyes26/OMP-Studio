/**
 * Contratto della coda task: solo uno stato che impedisce davvero a omp di
 * ricevere un nuovo comando puo' bloccare il click. La distinzione piu'
 * importante e' tra `pendingUi` (il tool ask sospende il processo) e una
 * domanda dedotta dal testo finale (il processo e' gia' libero). L'auto-run
 * resta piu' prudente e aspetta il verdetto post-turno.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	resolveAutomationGate,
	type GuiGateSnapshot
} from '../src/lib/agent/automationGate.ts';

function gui(overrides: Partial<GuiGateSnapshot> = {}): GuiGateSnapshot {
	return {
		ready: true,
		attached: true,
		streaming: false,
		compacting: false,
		blockingQuestion: null,
		quotaBlock: null,
		inferencePending: false,
		inferredQuestion: null,
		...overrides
	};
}

describe('blocco della coda task', () => {
	it('blocca su una richiesta ask e mostra la domanda reale della chat', () => {
		const gate = resolveAutomationGate({
			surface: 'gui',
			busy: false,
			session: gui({
				streaming: true,
				blockingQuestion: 'Quale ambiente vuoi pubblicare?'
			})
		});

		assert.equal(gate.ready, false);
		assert.equal(gate.block, 'question');
		assert.equal(gate.needsAnswer, true);
		assert.match(gate.detail, /Quale ambiente vuoi pubblicare\?/);
	});

	it('lascia la scelta manuale su una domanda dedotta ma sospende l auto-run', () => {
		const gate = resolveAutomationGate({
			surface: 'gui',
			busy: false,
			session: gui({
				inferredQuestion: 'Vuoi che cambi anche il nome del contributor?'
			})
		});

		assert.equal(gate.ready, true);
		assert.equal(gate.autoDispatchReady, false);
		assert.equal(gate.block, 'ready');
		assert.match(gate.note ?? '', /nome del contributor/);
	});

	it('non fa partire l auto-run mentre la classificazione post-turno e in corso', () => {
		const gate = resolveAutomationGate({
			surface: 'gui',
			busy: false,
			session: gui({ inferencePending: true })
		});

		assert.equal(gate.ready, true);
		assert.equal(gate.autoDispatchReady, false);
		assert.equal(gate.note, null);
	});

	it('considera pronto un terminale che ha finito mentre era in background', () => {
		const gate = resolveAutomationGate({
			surface: 'terminal',
			busy: false,
			inputPending: false,
			agentState: 'finished'
		});

		assert.equal(gate.ready, true);
		assert.equal(gate.block, 'ready');
	});

	it('spiega separatamente avvio, lavoro e testo terminale non inviato', () => {
		assert.equal(
			resolveAutomationGate({ surface: 'gui', busy: false, session: gui({ attached: false }) }).block,
			'starting'
		);
		assert.equal(
			resolveAutomationGate({ surface: 'gui', busy: false, session: gui({ streaming: true }) }).block,
			'working'
		);
		assert.equal(
			resolveAutomationGate({ surface: 'terminal', busy: false, inputPending: true, agentState: 'idle' }).block,
			'terminal-input'
		);
	});
});
