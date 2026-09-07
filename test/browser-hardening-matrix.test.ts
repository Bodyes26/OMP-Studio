import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ConsoleRingBuffer,
	NetworkRingBuffer,
	ActionRingBuffer,
	extractOrigin,
	isLocalOrigin,
	redactSensitiveString,
	redactUrlCredentials,
	negotiateCapabilities,
	browserLiveFrom,
	STUDIO_BROWSER_LIVE_OFFER,
	checkTicket,
	type BrowserSessionIdentity
} from '../src/lib/agent/browser-live.ts';

describe('S47 — Hardening e Matrice End-to-End', () => {
	describe('Limiti di memoria e Ring Buffer (CPU & Memory Bounds)', () => {
		it('ConsoleRingBuffer mantiene rigidamente il tetto di 500 messaggi senza memory leak', () => {
			const buffer = new ConsoleRingBuffer(500);
			for (let i = 0; i < 1200; i++) {
				buffer.push({
					id: `log-${i}`,
					level: 'info',
					text: `Log entry ${i}`,
					timestamp: Date.now() + i
				});
			}
			assert.equal(buffer.items.length, 500);
			assert.equal(buffer.items[0].text, 'Log entry 700');
			assert.equal(buffer.items[499].text, 'Log entry 1199');
		});

		it('NetworkRingBuffer mantiene il tetto di 200 richieste e aggiorna in-place le risposte', () => {
			const buffer = new NetworkRingBuffer(200);
			for (let i = 0; i < 300; i++) {
				buffer.push({
					id: `req-${i}`,
					requestId: `r-${i}`,
					url: `https://api.test/item/${i}`,
					method: 'GET',
					resourceType: 'fetch',
					status: 0,
					durationMs: 0,
					timestamp: Date.now() + i,
					failed: false
				});
			}
			assert.equal(buffer.items.length, 200);
			assert.equal(buffer.items[0].requestId, 'r-100');

			// Aggiornamento in-place
			buffer.push({
				id: 'req-250-resp',
				requestId: 'r-250',
				url: 'https://api.test/item/250',
				method: 'GET',
				resourceType: 'fetch',
				status: 200,
				durationMs: 45,
				timestamp: Date.now() + 500,
				failed: false
			});
			assert.equal(buffer.items.length, 200);
			const updated = buffer.items.find((item) => item.requestId === 'r-250');
			assert.ok(updated);
			assert.equal(updated.status, 200);
			assert.equal(updated.durationMs, 45);
		});

		it('ActionRingBuffer limita la timeline delle azioni a 100 eventi', () => {
			const buffer = new ActionRingBuffer(100);
			for (let i = 0; i < 250; i++) {
				buffer.push({
					id: `act-${i}`,
					timestamp: Date.now() + i,
					kind: 'navigation',
					label: `Navigazione ${i}`
				});
			}
			assert.equal(buffer.items.length, 100);
			assert.equal(buffer.items[0].label, 'Navigazione 150');
			assert.equal(buffer.items[99].label, 'Navigazione 249');
		});
	});

	describe('Compatibilità e fallback (Old / New Protocol Compatibility)', () => {
		it('runtime precedente senza capabilities non attiva browser-live e ricade su fallback', () => {
			// capabilities assente
			const negotiated = negotiateCapabilities([], [STUDIO_BROWSER_LIVE_OFFER]);
			assert.deepEqual(negotiated, []);
			assert.equal(browserLiveFrom(negotiated), null);
		});

		it('runtime moderno negozia con successo tutte le feature supportate', () => {
			const advertised = [STUDIO_BROWSER_LIVE_OFFER];
			const negotiated = negotiateCapabilities(advertised, [STUDIO_BROWSER_LIVE_OFFER]);
			const live = browserLiveFrom(negotiated);
			assert.ok(live);
			assert.equal(live.version, 1);
			assert.ok(live.features.includes('binary-frames'));
			assert.ok(live.features.includes('control-epochs'));
			assert.ok(live.features.includes('private-takeover'));
			assert.ok(live.features.includes('inspector'));
			assert.ok(live.features.includes('chrome-relay'));
		});
	});

	describe('Redazione di sicurezza e protezione segreti (Redaction & Fail-closed)', () => {
		it('rimuove credenziali HTTP Basic Auth dagli URL di navigazione', () => {
			const clean = redactUrlCredentials('https://admin:SuperPassword99@service.internal/config');
			assert.equal(clean, 'https://[REDACTED]@service.internal/config');
		});

		it('maschera token Bearer, Basic e password nei messaggi di log o errore', () => {
			const sample = 'Errore richiesta: Bearer 1234567890abcdef. Token rifiutato.';
			const redacted = redactSensitiveString(sample);
			assert.ok(!redacted.includes('1234567890abcdef'));
			assert.ok(redacted.includes('Bearer [REDACTED]'));
		});

		it('checkTicket respinge endpoint remoti non loopback con fail-closed', () => {
			const identity: BrowserSessionIdentity = {
				projectId: 'p1',
				chatSessionId: 'c1',
				browserSessionId: 'managed-p1',
				tabId: 'c1::main'
			};
			const ticketRemote = {
				ticketId: 't1',
				token: 'secret',
				endpoint: 'ws://evil.attacker.com:9222/browser-live',
				transport: 'local-websocket',
				identity,
				runtimePid: 1234,
				issuedAtMs: Date.now(),
				expiresAtMs: Date.now() + 30000
			};
			const check = checkTicket(ticketRemote, identity);
			assert.equal(check.ok, false);
			if (!check.ok) {
				assert.equal(check.code, 'ENDPOINT_NOT_LOOPBACK');
			}
		});
	});

	describe('Policy origini top-level (Origin Classification)', () => {
		it('riconosce correttamente le origini locali loopback senza prompt', () => {
			assert.equal(isLocalOrigin('http://localhost:3000/app'), true);
			assert.equal(isLocalOrigin('http://127.0.0.1:8080/'), true);
			assert.equal(isLocalOrigin('http://[::1]:5173/'), true);
			assert.equal(isLocalOrigin('about:blank'), true);
		});

		it('identifica le origini remote che richiedono consenso preventivo', () => {
			assert.equal(isLocalOrigin('https://example.com/login'), false);
			assert.equal(isLocalOrigin('https://github.com/'), false);
			assert.equal(extractOrigin('https://example.com:8443/login?q=1'), 'https://example.com:8443');
		});
	});
});
