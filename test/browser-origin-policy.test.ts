import test from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyOrigin,
	extractOrigin,
	isLocalOrigin,
	redactSensitiveHeaders,
	redactSensitiveString,
	redactUrlCredentials,
	checkTicket,
	type BrowserSessionIdentity
} from '../src/lib/agent/browser-live.ts';
test('S43 — Origin policies, capability e redazione dati', async (t) => {
	await t.test('isLocalOrigin identifica correttamente ambienti locali e loopback', () => {
		assert.equal(isLocalOrigin('http://localhost:3000'), true);
		assert.equal(isLocalOrigin('http://127.0.0.1:8080/test'), true);
		assert.equal(isLocalOrigin('http://[::1]:5173/'), true);
		assert.equal(isLocalOrigin('about:blank'), true);
		assert.equal(isLocalOrigin('data:text/html,hello'), true);
		assert.equal(isLocalOrigin('blob:http://localhost:3000/xyz'), true);

		// Origini remote
		assert.equal(isLocalOrigin('https://example.com'), false);
		assert.equal(isLocalOrigin('https://partner.coldiretti.it/api'), false);
		assert.equal(isLocalOrigin('http://192.168.1.100:8080'), false);
	});

	await t.test('extractOrigin normalizza schema, host e porta opzionale', () => {
		assert.equal(extractOrigin('http://localhost:3000/subpath?query=1'), 'http://localhost:3000');
		assert.equal(extractOrigin('https://API.Example.com:8443/v1/auth'), 'https://api.example.com:8443');
		assert.equal(extractOrigin('https://coldiretti.it/index.html'), 'https://coldiretti.it');
		assert.equal(extractOrigin('about:blank'), 'about:blank');
		assert.equal(extractOrigin('invalid-url-string'), null);
	});

	await t.test('classifyOrigin categorizza in local, remote e special', () => {
		assert.deepEqual(classifyOrigin('http://localhost:3000/app'), {
			type: 'local',
			origin: 'http://localhost:3000'
		});
		assert.deepEqual(classifyOrigin('https://partner.coldiretti.it/api'), {
			type: 'remote',
			origin: 'https://partner.coldiretti.it'
		});
		assert.deepEqual(classifyOrigin('about:blank'), {
			type: 'special',
			origin: 'about:blank'
		});
	});

	await t.test('redactUrlCredentials rimuove credenziali basic auth da URL', () => {
		const rawUrl = 'https://admin:SuperSecretPassword123@example.com/login?token=abc';
		const clean = redactUrlCredentials(rawUrl);
		assert.equal(clean.includes('SuperSecretPassword123'), false);
		assert.equal(clean.includes('admin'), false);
		assert.equal(clean.includes('[REDACTED]'), true);
		assert.equal(clean.includes('example.com/login?token=abc'), true);

		// URL senza credenziali non alterati
		const normalUrl = 'https://example.com/public';
		assert.equal(redactUrlCredentials(normalUrl), normalUrl);
	});

	await t.test('redactSensitiveHeaders maschera Authorization, Cookie, Set-Cookie e token', () => {
		const headers = {
			'Content-Type': 'application/json',
			Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
			Cookie: 'session_id=123456; token=abcdef',
			'Set-Cookie': 'auth=token-val; Path=/',
			'X-API-Key': 'key-98765',
			Accept: '*/*'
		};
		const redacted = redactSensitiveHeaders(headers);
		assert.equal(redacted['Content-Type'], 'application/json');
		assert.equal(redacted.Authorization, '[REDACTED]');
		assert.equal(redacted.Cookie, '[REDACTED]');
		assert.equal(redacted['Set-Cookie'], '[REDACTED]');
		assert.equal(redacted['X-API-Key'], '[REDACTED]');
		assert.equal(redacted.Accept, '*/*');
	});

	await t.test('redactSensitiveString maschera token Bearer e password nei log ed errori', () => {
		const log = 'Errore richiesta: Bearer sk-ant-api03-abcdef1234567890 fallita per password: "mySecretPassword!"';
		const safe = redactSensitiveString(log);
		assert.equal(safe.includes('sk-ant-api03-abcdef1234567890'), false);
		assert.equal(safe.includes('mySecretPassword!'), false);
		assert.equal(safe.includes('Bearer [REDACTED]'), true);
	});

	await t.test('checkTicket rifiuta fail-closed endpoint non loopback, ticket scaduti e identita errate', () => {
		const expectedIdentity: BrowserSessionIdentity = {
			projectId: 'proj-1',
			chatSessionId: 'chat-1',
			browserSessionId: 'managed-proj-1',
			tabId: 'chat-1::main'
		};

		const validTicket = {
			ticketId: 't-1',
			token: 'secret-tok-1',
			endpoint: 'ws://127.0.0.1:54321/browser-live',
			transport: 'local-websocket',
			identity: expectedIdentity,
			runtimePid: 1234,
			issuedAtMs: 1000,
			expiresAtMs: 31000
		};

		// 1. Ticket integro e valido
		const resValid = checkTicket(validTicket, expectedIdentity, 15000);
		assert.equal(resValid.ok, true);

		// 2. Rifiuto endpoint remoto non loopback (fail-closed)
		const remoteTicket = { ...validTicket, endpoint: 'ws://example.com:54321/browser-live' };
		const resRemote = checkTicket(remoteTicket, expectedIdentity, 15000);
		assert.equal(resRemote.ok, false);
		if (!resRemote.ok) {
			assert.equal(resRemote.code, 'ENDPOINT_NOT_LOOPBACK');
		}

		// 3. Rifiuto ticket scaduto (>30s)
		const resExpired = checkTicket(validTicket, expectedIdentity, 32000);
		assert.equal(resExpired.ok, false);
		if (!resExpired.ok) {
			assert.equal(resExpired.code, 'TICKET_EXPIRED');
		}

		// 4. Rifiuto identita mismatch
		const otherIdentity: BrowserSessionIdentity = {
			projectId: 'proj-2',
			chatSessionId: 'chat-2',
			browserSessionId: 'managed-proj-2',
			tabId: 'chat-2::main'
		};
		const resMismatch = checkTicket(validTicket, otherIdentity, 15000);
		assert.equal(resMismatch.ok, false);
		if (!resMismatch.ok) {
			assert.equal(resMismatch.code, 'TICKET_IDENTITY_MISMATCH');
		}
	});
});
