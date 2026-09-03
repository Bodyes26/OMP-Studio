import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	type BrowserFrameMeta,
	type BrowserInputEvent,
	type BrowserLiveClientMessage,
	type BrowserLiveServerMessage,
	type BrowserSessionIdentity,
	type BrowserTabState,
	parseBrowserInputEvent,
	parseBrowserLiveClientMessage,
	parseBrowserLiveServerMessage,
	parseBrowserTabState,
	startBrowserLiveWebSocketStream,
	type BrowserLiveStreamHandle
} from '../src/lib/agent/browser-live.ts';

describe('S42 — Control Epochs, Takeover e Private Mode', () => {
	const mockIdentity: BrowserSessionIdentity = {
		projectId: 'proj-1f3a',
		chatSessionId: 'chat-001',
		browserSessionId: 'managed-proj-1f3a',
		tabId: 'chat-001::main'
	};

	const baseTabState: BrowserTabState = {
		...mockIdentity,
		mode: 'managed',
		controller: 'agent',
		controlEpoch: 0,
		url: 'https://example.test/app',
		title: 'Test App',
		loading: false,
		originPermission: 'local',
		viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
		streamState: 'live'
	};

	describe('parsing eventi input (parseBrowserInputEvent)', () => {
		it('parsa correttamente eventi mouse (move, down, up, click, dblclick)', () => {
			const move = parseBrowserInputEvent({ type: 'mouse_move', x: 150.5, y: 300, buttons: 1 });
			assert.deepEqual(move, { type: 'mouse_move', x: 150.5, y: 300, buttons: 1 });

			const down = parseBrowserInputEvent({ type: 'mouse_down', x: 200, y: 400, button: 0, buttons: 1, clickCount: 1 });
			assert.deepEqual(down, { type: 'mouse_down', x: 200, y: 400, button: 0, buttons: 1, clickCount: 1 });

			const up = parseBrowserInputEvent({ type: 'mouse_up', x: 200, y: 400, button: 0, buttons: 0 });
			assert.deepEqual(up, { type: 'mouse_up', x: 200, y: 400, button: 0, buttons: 0 });

			const click = parseBrowserInputEvent({ type: 'click', x: 100, y: 200, button: 0, detail: 1 });
			assert.deepEqual(click, { type: 'click', x: 100, y: 200, button: 0, detail: 1 });

			const dbl = parseBrowserInputEvent({ type: 'double_click', x: 100, y: 200 });
			assert.deepEqual(dbl, { type: 'double_click', x: 100, y: 200 });
		});

		it('parsa correttamente eventi wheel e drag', () => {
			const wheel = parseBrowserInputEvent({ type: 'wheel', x: 50, y: 60, deltaX: 0, deltaY: 100 });
			assert.deepEqual(wheel, { type: 'wheel', x: 50, y: 60, deltaX: 0, deltaY: 100 });

			const dragStart = parseBrowserInputEvent({ type: 'drag_start', x: 10, y: 20 });
			assert.deepEqual(dragStart, { type: 'drag_start', x: 10, y: 20 });

			const dragMove = parseBrowserInputEvent({ type: 'drag_move', x: 30, y: 40 });
			assert.deepEqual(dragMove, { type: 'drag_move', x: 30, y: 40 });

			const dragEnd = parseBrowserInputEvent({ type: 'drag_end', x: 50, y: 60 });
			assert.deepEqual(dragEnd, { type: 'drag_end', x: 50, y: 60 });
		});

		it('parsa correttamente eventi tastiera con modificatori booleani', () => {
			const key = parseBrowserInputEvent({
				type: 'key_down',
				key: 'Enter',
				code: 'Enter',
				modifiers: { alt: false, ctrl: true, meta: false, shift: false }
			});
			assert.deepEqual(key, {
				type: 'key_down',
				key: 'Enter',
				code: 'Enter',
				modifiers: { alt: false, ctrl: true, meta: false, shift: false }
			});

			const keyUp = parseBrowserInputEvent({
				type: 'key_up',
				key: 'a',
				code: 'KeyA',
				modifiers: {}
			});
			assert.deepEqual(keyUp, {
				type: 'key_up',
				key: 'a',
				code: 'KeyA',
				modifiers: { alt: false, ctrl: false, meta: false, shift: false }
			});
		});

		it('rifiuta eventi con coordinate NaN, infinite o tipi non validi', () => {
			assert.equal(parseBrowserInputEvent({ type: 'mouse_move', x: NaN, y: 10, buttons: 1 }), null);
			assert.equal(parseBrowserInputEvent({ type: 'mouse_move', x: 10, y: Infinity, buttons: 1 }), null);
			assert.equal(parseBrowserInputEvent({ type: 'mouse_down', x: 10, y: 10, button: 'left' }), null);
			assert.equal(parseBrowserInputEvent({ type: 'unknown_event' }), null);
			assert.equal(parseBrowserInputEvent(null), null);
			assert.equal(parseBrowserInputEvent('string'), null);
		});
	});

	describe('messaggi client di controllo (parseBrowserLiveClientMessage)', () => {
		it('parsa messaggio takeover con expectedEpoch e input opzionale', () => {
			const msgWithInput = parseBrowserLiveClientMessage({
				type: 'takeover',
				expectedEpoch: 0,
				input: { type: 'click', x: 100, y: 200, button: 0, detail: 1 }
			});
			assert.ok(msgWithInput && msgWithInput.type === 'takeover');
			assert.equal(msgWithInput.expectedEpoch, 0);
			assert.deepEqual(msgWithInput.input, { type: 'click', x: 100, y: 200, button: 0, detail: 1 });

			const msgWithoutInput = parseBrowserLiveClientMessage({
				type: 'takeover',
				expectedEpoch: 3
			});
			assert.ok(msgWithoutInput && msgWithoutInput.type === 'takeover');
			assert.equal(msgWithoutInput.expectedEpoch, 3);
			assert.equal(msgWithoutInput.input, undefined);
		});

		it('parsa messaggio input con epoch di verifica e payload evento', () => {
			const msg = parseBrowserLiveClientMessage({
				type: 'input',
				epoch: 1,
				input: { type: 'mouse_move', x: 50, y: 60, buttons: 0 }
			});
			assert.ok(msg && msg.type === 'input');
			assert.equal(msg.epoch, 1);
			assert.deepEqual(msg.input, { type: 'mouse_move', x: 50, y: 60, buttons: 0 });
		});

		it('parsa messaggio return_control con epoch di sincronizzazione', () => {
			const msg = parseBrowserLiveClientMessage({
				type: 'return_control',
				epoch: 2
			});
			assert.ok(msg && msg.type === 'return_control');
			assert.equal(msg.epoch, 2);
		});

		it('parsa messaggio set_privacy normal e private', () => {
			const priv = parseBrowserLiveClientMessage({ type: 'set_privacy', privacy: 'private' });
			assert.ok(priv && priv.type === 'set_privacy' && priv.privacy === 'private');

			const norm = parseBrowserLiveClientMessage({ type: 'set_privacy', privacy: 'normal' });
			assert.ok(norm && norm.type === 'set_privacy' && norm.privacy === 'normal');

			assert.equal(parseBrowserLiveClientMessage({ type: 'set_privacy', privacy: 'invalid' }), null);
		});

		it('rifiuta messaggi con epoch negativi, non interi o tipi sconosciuti', () => {
			assert.equal(parseBrowserLiveClientMessage({ type: 'takeover', expectedEpoch: -1 }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'takeover', expectedEpoch: 1.5 }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'input', epoch: 'one', input: { type: 'click', x: 0, y: 0, button: 0 } }), null);
			assert.equal(parseBrowserLiveClientMessage({ type: 'return_control', epoch: -2 }), null);
		});
	});

	describe('messaggi server di controllo e interruzione (parseBrowserLiveServerMessage)', () => {
		it('parsa control_interrupted con epoch e motivo strutturato', () => {
			const msg = parseBrowserLiveServerMessage({
				type: 'control_interrupted',
				epoch: 1,
				reason: 'User took over control of tab'
			});
			assert.ok(msg && msg.type === 'control_interrupted');
			assert.equal(msg.epoch, 1);
			assert.equal(msg.reason, 'User took over control of tab');
		});

		it('parsa snapshot semantico prodotto al ritorno di controllo', () => {
			const msg = parseBrowserLiveServerMessage({
				type: 'snapshot',
				epoch: 2,
				snapshot: { root: 'page', children: [{ role: 'button', name: 'Submit' }] }
			});
			assert.ok(msg && msg.type === 'snapshot');
			assert.equal(msg.epoch, 2);
			assert.deepEqual(msg.snapshot, { root: 'page', children: [{ role: 'button', name: 'Submit' }] });
		});

		it('parsa codici errore strutturati CONTROL_INTERRUPTED e PRIVATE_TAKEOVER_ACTIVE', () => {
			const errCtrl = parseBrowserLiveServerMessage({
				type: 'error',
				code: 'CONTROL_INTERRUPTED',
				message: 'Epoch mismatch'
			});
			assert.ok(errCtrl && errCtrl.type === 'error' && errCtrl.code === 'CONTROL_INTERRUPTED');

			const errPriv = parseBrowserLiveServerMessage({
				type: 'error',
				code: 'PRIVATE_TAKEOVER_ACTIVE',
				message: 'Tab in private mode'
			});
			assert.ok(errPriv && errPriv.type === 'error' && errPriv.code === 'PRIVATE_TAKEOVER_ACTIVE');
		});
	});

	describe('transizioni di stato tab e controller (BrowserTabState)', () => {
		it('accetta controller agent, user e private-user con epoch crescenti', () => {
			const agentState = parseBrowserTabState({ ...baseTabState, controller: 'agent', controlEpoch: 0 });
			assert.ok(agentState && agentState.controller === 'agent' && agentState.controlEpoch === 0);

			const userState = parseBrowserTabState({ ...baseTabState, controller: 'user', controlEpoch: 1 });
			assert.ok(userState && userState.controller === 'user' && userState.controlEpoch === 1);

			const privState = parseBrowserTabState({ ...baseTabState, controller: 'private-user', controlEpoch: 2 });
			assert.ok(privState && privState.controller === 'private-user' && privState.controlEpoch === 2);
		});

		it('scarta controller sconosciuti o epoch non validi', () => {
			assert.equal(parseBrowserTabState({ ...baseTabState, controller: 'admin' }), null);
			assert.equal(parseBrowserTabState({ ...baseTabState, controlEpoch: -1 }), null);
			assert.equal(parseBrowserTabState({ ...baseTabState, controlEpoch: 'zero' }), null);
		});
	});

	describe('stream handle bidirezionale e invio comandi', () => {
		it('restituisce un handle invocabile come funzione e dotato di metodi di controllo', async () => {
			const mockTicket = {
				ticketId: 't-123',
				token: 'tok-secret',
				endpoint: 'ws://127.0.0.1:9999/browser-live',
				transport: 'local-websocket' as const,
				identity: mockIdentity,
				runtimePid: 1234,
				issuedAtMs: Date.now(),
				expiresAtMs: Date.now() + 30000
			};

			const handle = await startBrowserLiveWebSocketStream(mockTicket, () => {});
			assert.equal(typeof handle, 'function');
			assert.equal(typeof handle.disconnect, 'function');
			assert.equal(typeof handle.sendTakeover, 'function');
			assert.equal(typeof handle.sendInput, 'function');
			assert.equal(typeof handle.returnControl, 'function');
			assert.equal(typeof handle.setPrivacy, 'function');
			assert.equal(typeof handle.sendMessage, 'function');

			// Cleanup
			handle.disconnect();
		});
	});
});
