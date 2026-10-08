/**
 * Stato/widget delle estensioni, fine lavoro «vera» (`session_settled`) e
 * bilancio `+N −M` del turno.
 *
 * I moduli sono puri: la sessione (`session.svelte.ts`) tiene lo stato e li
 * chiama dal riduttore. Qui si provano con le fixture reali di omp e con
 * frame costruiti sulle forme di `docs/rpc.md` / `rpc-types.ts` di omp 18.8.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	emptyExtensionUi,
	normalizeWidgetLines,
	parseAnsiLine,
	reduceExtensionUi,
	statusEntries,
	stripAnsi,
	widgetsAt,
	MAX_WIDGET_LINES,
	type ExtensionUiState
} from '../src/lib/agent/extensionUi.ts';
import {
	INITIAL_SETTLE,
	isBackgroundPending,
	isBackgroundYield,
	promptResultError,
	settleFromState,
	settleOnAgentStart,
	settleOnPromptResult,
	settleOnSessionSettled,
	settleOnYield,
	type SettleState
} from '../src/lib/agent/settle.ts';
import { isLaneRoutable, resolveAutomationGate, type GuiGateSnapshot } from '../src/lib/agent/automationGate.ts';
import { turnDiffOf } from '../src/lib/agent/turnDiff.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): AgentSessionEvent[] {
	return readFileSync(join(ROOT, 'fixtures', 'chat-v2', name), 'utf8')
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as AgentSessionEvent);
}

function ui(state: ExtensionUiState, frame: Record<string, unknown>): ExtensionUiState {
	const next = reduceExtensionUi(state, { type: 'extension_ui_request', id: 'x', ...frame } as never);
	assert.ok(next, `frame non gestito: ${JSON.stringify(frame)}`);
	return next;
}

describe('estensioni: setStatus', () => {
	it('aggiunge, aggiorna e toglie le voci per statusKey', () => {
		let state = emptyExtensionUi();
		state = ui(state, { method: 'setStatus', statusKey: 'usage', statusText: '5h 42%' });
		state = ui(state, { method: 'setStatus', statusKey: 'review', statusText: 'Loading open pull requests…' });
		assert.deepEqual(statusEntries(state.status), [
			{ key: 'review', text: 'Loading open pull requests…' },
			{ key: 'usage', text: '5h 42%' }
		]);
		state = ui(state, { method: 'setStatus', statusKey: 'usage', statusText: '5h 43%' });
		assert.equal(state.status.usage, '5h 43%');
		// `statusText: undefined` arriva come chiave assente nel JSON.
		state = ui(state, { method: 'setStatus', statusKey: 'review' });
		assert.deepEqual(Object.keys(state.status), ['usage']);
	});

	it('testo vuoto, solo spazi o solo ANSI toglie la voce', () => {
		let state = ui(emptyExtensionUi(), { method: 'setStatus', statusKey: 'k', statusText: 'x' });
		state = ui(state, { method: 'setStatus', statusKey: 'k', statusText: '   ' });
		assert.equal('k' in state.status, false);
		state = ui(state, { method: 'setStatus', statusKey: 'k', statusText: 'x' });
		state = ui(state, { method: 'setStatus', statusKey: 'k', statusText: '\u001b[2m\u001b[0m' });
		assert.equal('k' in state.status, false);
	});

	it('ripulisce ANSI e a capo: la voce sta su una riga', () => {
		const state = ui(emptyExtensionUi(), {
			method: 'setStatus',
			statusKey: 'k',
			statusText: '\u001b[32m●\u001b[0m build\n  ok'
		});
		assert.equal(state.status.k, '● build ok');
	});

	it('ripiego sui frame vecchi con il testo in `message`', () => {
		const state = ui(emptyExtensionUi(), { method: 'setStatus', statusKey: 'k', message: 'vecchio' });
		assert.equal(state.status.k, 'vecchio');
	});

	it('non muta lo stato precedente e ignora i frame senza chiave', () => {
		const before = emptyExtensionUi();
		const after = ui(before, { method: 'setStatus', statusKey: 'k', statusText: 'v' });
		assert.deepEqual(before.status, {});
		assert.equal(ui(after, { method: 'setStatus', statusText: 'senza chiave' }), after);
	});

	it('restituisce null per i metodi che non sono stato o widget', () => {
		assert.equal(reduceExtensionUi(emptyExtensionUi(), { method: 'notify' } as never), null);
		assert.equal(reduceExtensionUi(emptyExtensionUi(), { method: 'setTitle' } as never), null);
	});
});

describe('estensioni: setWidget', () => {
	it('fixture reale tools-real.ndjson: autoresearch arriva solo come rimozione', () => {
		const frames = fixture('tools-real.ndjson').filter(
			(event) => event.type === 'extension_ui_request' && event.method === 'setWidget'
		);
		assert.equal(frames.length, 2);
		assert.ok(frames.every((frame) => frame.widgetKey === 'autoresearch' && !('widgetLines' in frame)));

		// Un widget presente (per esempio da un'estensione a righe) viene tolto dal frame reale.
		let state = ui(emptyExtensionUi(), {
			method: 'setWidget',
			widgetKey: 'autoresearch',
			widgetLines: ['run 3/10 · best 0.91']
		});
		assert.equal(widgetsAt(state.widgets, 'aboveEditor').length, 1);
		for (const frame of frames) {
			const next = reduceExtensionUi(state, frame);
			assert.ok(next);
			state = next;
		}
		assert.deepEqual(state.widgets, {});
	});

	it('placement: aboveEditor di default, belowEditor se richiesto', () => {
		let state = ui(emptyExtensionUi(), { method: 'setWidget', widgetKey: 'a', widgetLines: ['sopra'] });
		state = ui(state, {
			method: 'setWidget',
			widgetKey: 'b',
			widgetLines: ['sotto'],
			widgetPlacement: 'belowEditor'
		});
		assert.deepEqual(widgetsAt(state.widgets, 'aboveEditor'), [{ key: 'a', lines: ['sopra'] }]);
		assert.deepEqual(widgetsAt(state.widgets, 'belowEditor'), [{ key: 'b', lines: ['sotto'] }]);
	});

	it('righe vuote ai bordi, a capo interni, limite di righe', () => {
		assert.equal(normalizeWidgetLines(['', '   ']), null);
		assert.equal(normalizeWidgetLines('non un array'), null);
		assert.deepEqual(normalizeWidgetLines(['', 'a\nb', '', 'c', '']), ['a', 'b', '', 'c']);
		const many = Array.from({ length: MAX_WIDGET_LINES + 10 }, (_, i) => `riga ${i}`);
		assert.equal(normalizeWidgetLines(many)?.length, MAX_WIDGET_LINES);
	});

	it('tiene gli SGR per i colori e toglie cursore, OSC e controlli', () => {
		const lines = normalizeWidgetLines([
			'\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007 \u001b[31mrosso\u001b[0m\u001b[2K\u0007'
		]);
		assert.deepEqual(lines, ['link \u001b[31mrosso\u001b[0m']);
	});
});

describe('estensioni: colori ANSI', () => {
	it('mappa i colori base sui toni semantici', () => {
		assert.deepEqual(parseAnsiLine('\u001b[31merr\u001b[0m ok \u001b[1;32mpass\u001b[22m!'), [
			{ text: 'err', tone: 'danger' },
			{ text: ' ok ' },
			{ text: 'pass', tone: 'success', bold: true },
			{ text: '!', tone: 'success' }
		]);
		assert.deepEqual(parseAnsiLine('\u001b[93mwarn\u001b[39m'), [{ text: 'warn', tone: 'warn' }]);
		assert.deepEqual(parseAnsiLine('\u001b[90mdim\u001b[m'), [{ text: 'dim', tone: 'muted' }]);
	});

	it('256 colori e truecolor si riducono al tono piu\' vicino', () => {
		assert.equal(parseAnsiLine('\u001b[38;5;196mx')[0].tone, 'danger');
		assert.equal(parseAnsiLine('\u001b[38;5;46mx')[0].tone, 'success');
		assert.equal(parseAnsiLine('\u001b[38;2;240;200;40mx')[0].tone, 'warn');
		assert.equal(parseAnsiLine('\u001b[38;2;80;120;255mx')[0].tone, 'accent');
		assert.equal(parseAnsiLine('\u001b[38;5;240mx')[0].tone, 'muted');
		// Lo sfondo si ignora senza mangiare il colore del testo che segue.
		assert.deepEqual(parseAnsiLine('\u001b[48;5;21;31mx'), [{ text: 'x', tone: 'danger' }]);
	});

	it('testo senza ANSI resta un solo segmento; stripAnsi toglie tutto', () => {
		assert.deepEqual(parseAnsiLine('plain'), [{ text: 'plain' }]);
		assert.equal(stripAnsi('\u001b[1m\u001b[34mok\u001b[0m\u001b]0;titolo\u0007'), 'ok');
	});
});

describe('quiete della sessione (session_settled)', () => {
	const agentEnd = (extra: Partial<AgentSessionEvent> = {}): AgentSessionEvent => ({
		type: 'agent_end',
		...extra
	});

	it('omp vecchio (fixture reale senza isSettled): lo yield vale come fine', () => {
		let state: SettleState = { ...INITIAL_SETTLE };
		for (const event of fixture('tools-real.ndjson')) {
			if (event.type === 'agent_start') state = settleOnAgentStart(state);
			if (event.type === 'agent_end' && event.isTerminal !== false) state = settleOnYield(state);
		}
		assert.deepEqual(state, { aware: false, settled: true, running: false });
		assert.equal(isBackgroundPending(state, false), false);
	});

	it('get_state senza isSettled non cambia nulla (capability assente)', () => {
		assert.deepEqual(settleFromState(INITIAL_SETTLE, { hasPendingAsyncWork: false }), INITIAL_SETTLE);
		assert.deepEqual(settleFromState(INITIAL_SETTLE, null), INITIAL_SETTLE);
	});

	it('omp 18.8: dopo lo yield si aspetta session_settled', () => {
		let state = settleFromState(INITIAL_SETTLE, { isSettled: true, hasPendingAsyncWork: false });
		assert.deepEqual(state, { aware: true, settled: true, running: false });
		state = settleOnAgentStart(state);
		assert.equal(isBackgroundPending(state, true), false, 'durante lo streaming non e\' background');
		// Fra due giri di tool Studio spegne `isStreaming` su `turn_end`: il run e' vivo.
		assert.equal(isBackgroundPending(state, false), false, 'la pausa fra due giri non e\' background');
		state = settleOnYield(state);
		assert.equal(state.settled, false);
		assert.equal(isBackgroundPending(state, false), true);
		state = settleOnSessionSettled();
		assert.equal(isBackgroundPending(state, false), false);
	});

	it('chi si attacca a meta\' legge isSettled false con lavoro in background', () => {
		const state = settleFromState(INITIAL_SETTLE, {
			isSettled: false,
			hasPendingAsyncWork: true,
			isStreaming: false
		});
		assert.equal(isBackgroundPending(state, false), true);
		// Run ancora vivo: e' lavoro normale, non background.
		const live = settleFromState(INITIAL_SETTLE, { isSettled: false, isStreaming: true });
		assert.equal(isBackgroundPending(live, false), false);
	});

	it('session_settled visto per primo rende la sessione consapevole', () => {
		assert.deepEqual(settleOnSessionSettled(), { aware: true, settled: true, running: false });
	});

	it('prompt_result: solo sessionSettled true chiude; false segnala solo il supporto', () => {
		const running = settleOnAgentStart({ aware: true, settled: true, running: false });
		assert.deepEqual(
			settleOnPromptResult(running, { type: 'prompt_result', sessionSettled: true }),
			{ aware: true, settled: true, running: false }
		);
		assert.deepEqual(
			settleOnPromptResult(INITIAL_SETTLE, { type: 'prompt_result', sessionSettled: false }),
			{ aware: true, settled: true, running: false },
			'un prompt mai arrivato all\'agente non deve lasciare la sessione al lavoro'
		);
		assert.deepEqual(settleOnPromptResult(running, { type: 'prompt_result' }), running);
	});

	it('agent_end non terminale che aspetta un job: yield solo se omp riporta la quiete', () => {
		const waiting = agentEnd({ isTerminal: false, yielded: true, awaitingAsyncWork: true });
		assert.equal(isBackgroundYield({ aware: true, settled: false, running: false }, waiting), true);
		assert.equal(isBackgroundYield({ aware: false, settled: false, running: false }, waiting), false);
		// Retry, compattazione, reminder: l'agente continua da se'.
		assert.equal(
			isBackgroundYield({ aware: true, settled: false, running: false }, agentEnd({ isTerminal: false, yielded: false })),
			false
		);
		// Coda di follow-up: non terminale, yielded, ma senza awaitingAsyncWork.
		assert.equal(
			isBackgroundYield({ aware: true, settled: false, running: false }, agentEnd({ isTerminal: false, yielded: true })),
			false
		);
		assert.equal(isBackgroundYield({ aware: true, settled: false, running: false }, agentEnd()), false);
	});

	it('promptResultError: errore del provider pulito, solo se il prompt ha raggiunto l\'agente', () => {
		const frame = {
			type: 'prompt_result',
			id: 'req_1',
			agentInvoked: true,
			status: 'error',
			error: { message: 'Overloaded', provider: 'anthropic', httpStatus: 529, retryable: true },
			sessionSettled: true
		} as AgentSessionEvent;
		assert.deepEqual(promptResultError(frame), {
			message: 'Overloaded',
			provider: 'anthropic',
			model: undefined,
			httpStatus: 529,
			retryable: true
		});
		assert.equal(promptResultError({ ...frame, agentInvoked: false }), null);
		assert.equal(promptResultError({ ...frame, status: 'completed' }), null);
		assert.equal(promptResultError({ ...frame, status: 'aborted' }), null);
		assert.equal(promptResultError({ ...frame, error: { message: '  ' } } as AgentSessionEvent), null);
	});
});

describe('cancello della coda: lavoro in background', () => {
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

	it('blocca auto-avvio e click, ma la coda puo\' spostarsi di corsia', () => {
		const gate = resolveAutomationGate({ surface: 'gui', busy: false, session: gui({ backgroundWork: true }) });
		assert.equal(gate.block, 'background');
		assert.equal(gate.ready, false);
		assert.equal(gate.autoDispatchReady, false);
		assert.equal(isLaneRoutable(gate), true);
		assert.ok(gate.label.length > 0 && gate.detail.length > 0 && gate.hint.length > 0);
	});

	it('streaming, domanda e quota hanno la precedenza', () => {
		assert.equal(
			resolveAutomationGate({ surface: 'gui', busy: false, session: gui({ backgroundWork: true, streaming: true }) }).block,
			'working'
		);
		assert.equal(
			resolveAutomationGate({
				surface: 'gui',
				busy: false,
				session: gui({ backgroundWork: true, blockingQuestion: 'Procedo?' })
			}).block,
			'question'
		);
	});

	it('snapshot senza il campo (omp vecchio): resta pronto', () => {
		assert.equal(resolveAutomationGate({ surface: 'gui', busy: false, session: gui() }).block, 'ready');
	});
});

describe('piè di turno: bilancio +N −M', () => {
	it('fixture reale: la card edit del turno vale +1 −1 su sample.txt', () => {
		const starts = new Map<string, AgentSessionEvent>();
		const tools: Array<{ toolName: string; args?: Record<string, unknown>; result?: never; running: boolean }> = [];
		for (const event of fixture('tools-real.ndjson')) {
			if (event.type === 'tool_execution_start' && event.toolCallId) starts.set(event.toolCallId, event);
			if (event.type === 'tool_execution_end' && event.toolCallId) {
				const start = starts.get(event.toolCallId);
				tools.push({
					toolName: String(event.toolName),
					args: start?.args,
					result: event.result as never,
					running: false
				});
			}
		}
		const diff = turnDiffOf(tools);
		assert.ok(diff);
		assert.equal(diff.added, 1);
		assert.equal(diff.removed, 1);
		assert.equal(diff.files.length, 1);
		assert.match(diff.files[0], /sample\.txt$/);
	});

	it('somma edit e write, esclude errori, chiamate in corso e tool che non modificano', () => {
		const diff = turnDiffOf([
			{
				toolName: 'edit',
				args: { path: 'src/a.ts' },
				result: { content: [], details: { path: 'src/a.ts', diff: '+1|x\n+2|y\n-3|z' } }
			},
			{ toolName: 'write', args: { path: 'src/b.ts', content: 'uno\ndue\ntre' }, result: { content: [] } },
			{
				toolName: 'edit',
				args: { path: 'src/a.ts' },
				result: { content: [], details: { path: 'src/a.ts', diff: '-1|w' } }
			},
			{
				toolName: 'edit',
				args: { path: 'src/err.ts' },
				result: { content: [], isError: true, details: { diff: '+1|no' } }
			},
			{ toolName: 'write', args: { path: 'src/live.ts', content: 'a' }, running: true },
			{ toolName: 'bash', args: { command: 'echo +1' }, result: { content: [] } }
		]);
		assert.deepEqual(diff, { added: 5, removed: 2, files: ['src/a.ts', 'src/b.ts'] });
	});

	it('nessuna modifica: niente badge', () => {
		assert.equal(turnDiffOf([{ toolName: 'read', args: { path: 'a' } }]), null);
		assert.equal(turnDiffOf([]), null);
	});
});
