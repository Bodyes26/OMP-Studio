import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	type InspectedElementData,
	type ConsoleEntry,
	type NetworkEntry,
	type ActionEntry,
	BoundedRingBuffer,
	ConsoleRingBuffer,
	NetworkRingBuffer,
	ActionRingBuffer,
	parseInspectedElementData,
	parseConsoleEntry,
	parseNetworkEntry,
	parseActionEntry,
	parseBrowserLiveClientMessage,
	parseBrowserLiveServerMessage,
	formatElementContextForPrompt,
	formatConsoleErrorsForPrompt,
	formatFailedRequestsForPrompt,
	formatInspectorContextForPrompt,
	redactSensitiveString,
	redactUrlCredentials,
	redactSensitiveHeaders
} from '../src/lib/agent/browser-live.ts';

describe('S44 — Inspector Mirato (Ring Buffer, Deduplica, Redazione, Element Picker, Actions)', () => {
	describe('BoundedRingBuffer e gestione limiti di memoria', () => {
		it('rispetta rigorosamente la capacità massima e scarta gli elementi obsoleti FIFO', () => {
			const buf = new BoundedRingBuffer<number>(3);
			assert.equal(buf.length, 0);

			buf.push(1);
			buf.push(2);
			buf.push(3);
			assert.deepEqual(buf.items, [1, 2, 3]);

			buf.push(4);
			assert.deepEqual(buf.items, [2, 3, 4]);

			buf.push(5);
			buf.push(6);
			assert.deepEqual(buf.items, [4, 5, 6]);
			assert.equal(buf.length, 3);
		});

		it('svuota correttamente il buffer alla chiamata clear()', () => {
			const buf = new BoundedRingBuffer<string>(5);
			buf.push('a');
			buf.push('b');
			assert.equal(buf.length, 2);
			buf.clear();
			assert.equal(buf.length, 0);
			assert.deepEqual(buf.items, []);
		});
	});

	describe('ConsoleRingBuffer (bounded 500, deduplicazione e redazione)', () => {
		it('deduplica messaggi consecutivi identici incrementando il count e aggiornando il timestamp', () => {
			const cbuf = new ConsoleRingBuffer(500);

			cbuf.push({
				id: 'c1',
				level: 'error',
				text: 'Uncaught TypeError: cannot read property of undefined',
				timestamp: 1000,
				count: 1,
				url: 'http://localhost:5173/app.js',
				line: 42
			});

			assert.equal(cbuf.length, 1);
			assert.equal(cbuf.items[0].count, 1);
			assert.equal(cbuf.items[0].timestamp, 1000);

			// Secondo errore identico consecutivo
			cbuf.push({
				id: 'c2',
				level: 'error',
				text: 'Uncaught TypeError: cannot read property of undefined',
				timestamp: 1050,
				count: 1,
				url: 'http://localhost:5173/app.js',
				line: 42
			});

			// Deve essere deduplicato nella stessa voce
			assert.equal(cbuf.length, 1);
			assert.equal(cbuf.items[0].count, 2);
			assert.equal(cbuf.items[0].timestamp, 1050);

			// Messaggio diverso -> nuova voce
			cbuf.push({
				id: 'c3',
				level: 'warn',
				text: 'Warning: Deprecated API',
				timestamp: 1100,
				count: 1
			});
			assert.equal(cbuf.length, 2);
		});

		it('applica la redazione di credenziali URL e token Bearer/password nei messaggi console', () => {
			const cbuf = new ConsoleRingBuffer(500);

			cbuf.push({
				id: 'c1',
				level: 'error',
				text: 'Failed auth request with Bearer secret-access-token-9988 at server',
				timestamp: 1000,
				count: 1,
				url: 'https://admin:SuperSecret123@api.mycoldiretti.it/v1/auth',
				line: 12,
				stackTrace: 'Error at https://admin:SuperSecret123@api.mycoldiretti.it/v1/auth:12'
			});

			const item = cbuf.items[0];
			assert.ok(!item.text.includes('secret-access-token-9988'));
			assert.ok(item.text.includes('Bearer [REDACTED]'));
			assert.ok(!item.url?.includes('SuperSecret123'));
			assert.ok(item.url?.includes('[REDACTED]@api.mycoldiretti.it'));
			assert.ok(!item.stackTrace?.includes('SuperSecret123'));
		});

		it('non supera la capacità massima prefissata di 500 item', () => {
			const cbuf = new ConsoleRingBuffer(10);
			for (let i = 0; i < 25; i++) {
				cbuf.push({
					id: `c-${i}`,
					level: 'log',
					text: `Log message ${i}`,
					timestamp: 1000 + i,
					count: 1
				});
			}
			assert.equal(cbuf.length, 10);
			assert.equal(cbuf.items[0].text, 'Log message 15');
			assert.equal(cbuf.items[9].text, 'Log message 24');
		});
	});

	describe('NetworkRingBuffer (bounded 200, aggiornamento in place e redazione header/URL)', () => {
		it('aggiorna in place le richieste esistenti per requestId quando arriva la risposta', () => {
			const nbuf = new NetworkRingBuffer(200);

			// Inizio richiesta
			nbuf.push({
				id: 'n1',
				requestId: 'req-101',
				url: 'https://user:pwd@api.coldiretti.it/v1/items',
				method: 'GET',
				status: 0,
				statusText: '',
				mimeType: '',
				resourceType: 'fetch',
				durationMs: 0,
				timestamp: 2000,
				failed: false,
				headers: {
					Authorization: 'Bearer token-12345',
					'X-API-Key': 'secret-key-6789',
					Accept: 'application/json'
				}
			});

			assert.equal(nbuf.length, 1);
			assert.equal(nbuf.items[0].status, 0);
			assert.equal(nbuf.items[0].url, 'https://[REDACTED]@api.coldiretti.it/v1/items');
			assert.equal(nbuf.items[0].headers?.Authorization, '[REDACTED]');
			assert.equal(nbuf.items[0].headers?.['X-API-Key'], '[REDACTED]');
			assert.equal(nbuf.items[0].headers?.Accept, 'application/json');

			// Completamento risposta per lo stesso requestId
			nbuf.push({
				id: 'n1-res',
				requestId: 'req-101',
				url: 'https://user:pwd@api.coldiretti.it/v1/items',
				method: 'GET',
				status: 200,
				statusText: 'OK',
				mimeType: 'application/json',
				resourceType: 'fetch',
				durationMs: 84.5,
				timestamp: 2084,
				failed: false,
				hasBody: true
			});

			assert.equal(nbuf.length, 1);
			assert.equal(nbuf.items[0].status, 200);
			assert.equal(nbuf.items[0].statusText, 'OK');
			assert.equal(nbuf.items[0].durationMs, 84.5);
			assert.equal(nbuf.items[0].hasBody, true);
		});

		it('consente l’inserimento e la redazione del corpo risposta on-demand', () => {
			const nbuf = new NetworkRingBuffer(200);
			nbuf.push({
				id: 'n2',
				requestId: 'req-202',
				url: 'https://app.test/api/user',
				method: 'POST',
				status: 201,
				statusText: 'Created',
				mimeType: 'application/json',
				resourceType: 'fetch',
				durationMs: 120,
				timestamp: 3000,
				failed: false
			});

			nbuf.setBody('req-202', '{"token": "Bearer secret-token-abcdef", "user": "m.actis"}');
			assert.equal(nbuf.items[0].hasBody, true);
			assert.ok(!nbuf.items[0].body?.includes('secret-token-abcdef'));
			assert.ok(nbuf.items[0].body?.includes('Bearer [REDACTED]'));
		});

		it('non supera la capacità massima prefissata di 200 item', () => {
			const nbuf = new NetworkRingBuffer(5);
			for (let i = 0; i < 15; i++) {
				nbuf.push({
					id: `net-${i}`,
					requestId: `req-${i}`,
					url: `https://test.local/api/${i}`,
					method: 'GET',
					status: 200,
					statusText: 'OK',
					mimeType: 'application/json',
					resourceType: 'fetch',
					durationMs: 50,
					timestamp: 1000 + i,
					failed: false
				});
			}
			assert.equal(nbuf.length, 5);
			assert.equal(nbuf.items[0].requestId, 'req-10');
			assert.equal(nbuf.items[4].requestId, 'req-14');
		});
	});

	describe('ActionRingBuffer (bounded 100, timeline azioni)', () => {
		it('registra eventi timeline mantenendo la sequenza temporale e redigendo i dettagli', () => {
			const abuf = new ActionRingBuffer(100);

			abuf.push({
				id: 'a1',
				timestamp: 1000,
				kind: 'navigation',
				label: 'Navigazione verso https://admin:pwd@coldiretti.it/dashboard',
				details: 'Bearer token-session-123'
			});

			abuf.push({
				id: 'a2',
				timestamp: 1050,
				kind: 'takeover',
				label: 'Takeover utente'
			});

			assert.equal(abuf.length, 2);
			assert.ok(!abuf.items[0].label.includes('pwd@'));
			assert.ok(abuf.items[0].label.includes('[REDACTED]@coldiretti.it'));
			assert.ok(abuf.items[0].details?.includes('Bearer [REDACTED]'));
			assert.equal(abuf.items[1].kind, 'takeover');
		});
	});

	describe('Parser strutture dati Inspector (Element, Console, Network, Actions)', () => {
		it('parseInspectedElementData estrae fedelmente tag, role, selector, boundingBox, styles e component', () => {
			const raw = {
				tag: 'button',
				role: 'button',
				accessibleName: 'Conferma Ordine',
				text: 'Invia richiesta',
				selector: '#checkout-form > button.btn-primary',
				boundingBox: { x: 120, y: 340, width: 140, height: 44 },
				computedStyles: {
					display: 'flex',
					'background-color': 'rgb(22, 101, 52)',
					color: 'rgb(255, 255, 255)',
					'font-size': '14px'
				},
				component: 'CheckoutSubmitButton',
				screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
			};

			const parsed = parseInspectedElementData(raw);
			assert.ok(parsed !== null);
			assert.equal(parsed?.tag, 'button');
			assert.equal(parsed?.role, 'button');
			assert.equal(parsed?.accessibleName, 'Conferma Ordine');
			assert.equal(parsed?.selector, '#checkout-form > button.btn-primary');
			assert.deepEqual(parsed?.boundingBox, { x: 120, y: 340, width: 140, height: 44 });
			assert.equal(parsed?.component, 'CheckoutSubmitButton');
			assert.equal(parsed?.computedStyles['background-color'], 'rgb(22, 101, 52)');
			assert.ok(parsed?.screenshotBase64 !== undefined);
		});

		it('parseInspectedElementData rifiuta oggetti privi di tag, selector o boundingBox valido', () => {
			assert.equal(parseInspectedElementData(null), null);
			assert.equal(parseInspectedElementData({ tag: '' }), null);
			assert.equal(parseInspectedElementData({ tag: 'div', selector: '' }), null);
			assert.equal(parseInspectedElementData({ tag: 'div', selector: 'div', boundingBox: { x: 'invalid' } }), null);
		});

		it('parseConsoleEntry e parseNetworkEntry validano i campi obbligatori', () => {
			assert.ok(parseConsoleEntry({ id: 'c1', level: 'warn', text: 'test', timestamp: 100 }) !== null);
			assert.equal(parseConsoleEntry({ id: '', level: 'warn', text: 'test', timestamp: 100 }), null);
			assert.equal(parseConsoleEntry({ id: 'c1', level: 'unknown_level', text: 'test', timestamp: 100 }), null);

			assert.ok(parseNetworkEntry({ id: 'n1', requestId: 'r1', url: 'http://test', method: 'GET' }) !== null);
			assert.equal(parseNetworkEntry({ id: '', requestId: 'r1', url: 'http://test', method: 'GET' }), null);
		});
	});

	describe('Parser messaggi di controllo Inspector (Client e Server)', () => {
		it('parseBrowserLiveClientMessage riconosce inspect_point, inspect_element, set_inspector, request_network_body e clear_buffer', () => {
			assert.deepEqual(parseBrowserLiveClientMessage({ type: 'inspect_point', x: 250, y: 400 }), {
				type: 'inspect_point',
				x: 250,
				y: 400
			});

			assert.deepEqual(
				parseBrowserLiveClientMessage({ type: 'inspect_element', selector: '#main-btn', point: { x: 10, y: 20 } }),
				{ type: 'inspect_element', selector: '#main-btn', point: { x: 10, y: 20 } }
			);

			assert.deepEqual(
				parseBrowserLiveClientMessage({ type: 'set_inspector', enabled: true, console: true, network: true }),
				{ type: 'set_inspector', enabled: true, console: true, network: true }
			);

			assert.deepEqual(
				parseBrowserLiveClientMessage({ type: 'request_network_body', requestId: 'req-42' }),
				{ type: 'request_network_body', requestId: 'req-42' }
			);

			assert.deepEqual(
				parseBrowserLiveClientMessage({ type: 'clear_buffer', target: 'console' }),
				{ type: 'clear_buffer', target: 'console' }
			);
		});

		it('parseBrowserLiveServerMessage riconosce inspected_element, console_entry, network_entry, network_body_response e action_entry', () => {
			const elMsg = parseBrowserLiveServerMessage({
				type: 'inspected_element',
				element: {
					tag: 'a',
					selector: 'nav > a.active',
					boundingBox: { x: 10, y: 20, width: 80, height: 24 }
				}
			});
			assert.ok(elMsg?.type === 'inspected_element');
			assert.equal(elMsg.element.tag, 'a');

			const consMsg = parseBrowserLiveServerMessage({
				type: 'console_entry',
				entry: { id: 'c1', level: 'error', text: 'Error in app', timestamp: 500 }
			});
			assert.ok(consMsg?.type === 'console_entry');
			assert.equal(consMsg.entry.level, 'error');

			const netMsg = parseBrowserLiveServerMessage({
				type: 'network_entry',
				entry: { id: 'n1', requestId: 'r1', url: 'http://test', method: 'GET' }
			});
			assert.ok(netMsg?.type === 'network_entry');
			assert.equal(netMsg.entry.method, 'GET');

			const bodyMsg = parseBrowserLiveServerMessage({
				type: 'network_body_response',
				requestId: 'r1',
				body: '{"status":"ok"}'
			});
			assert.ok(bodyMsg?.type === 'network_body_response');
			assert.equal(bodyMsg.body, '{"status":"ok"}');

			const actMsg = parseBrowserLiveServerMessage({
				type: 'action_entry',
				entry: { id: 'a1', timestamp: 100, kind: 'privacy', label: 'Privacy attivata' }
			});
			assert.ok(actMsg?.type === 'action_entry');
			assert.equal(actMsg.entry.kind, 'privacy');
		});
	});

	describe('Formattazione contesto per invio selettivo al Prompt (S44)', () => {
		const sampleElement: InspectedElementData = {
			tag: 'button',
			role: 'button',
			accessibleName: 'Salva bozza',
			text: 'Salva modifiche',
			selector: '#draft-form > button.save-btn',
			boundingBox: { x: 200, y: 500, width: 120, height: 36 },
			computedStyles: {
				display: 'inline-flex',
				'background-color': '#16a34a',
				color: '#ffffff'
			},
			component: 'SaveDraftButton'
		};

		const sampleConsole: ConsoleEntry[] = [
			{
				id: 'c1',
				level: 'error',
				text: 'Uncaught TypeError: form.submit is not a function',
				timestamp: 1000,
				count: 2,
				url: 'http://localhost:5173/bundle.js',
				line: 142,
				stackTrace: 'Error at submitForm (bundle.js:142)\n at HTMLButtonElement.onclick (index.html:50)'
			},
			{
				id: 'c2',
				level: 'warn',
				text: 'Source map not found for vendor.js',
				timestamp: 1050,
				count: 1
			}
		];

		const sampleNetwork: NetworkEntry[] = [
			{
				id: 'n1',
				requestId: 'r1',
				url: 'https://api.coldiretti.it/v1/drafts',
				method: 'POST',
				status: 422,
				statusText: 'Unprocessable Entity',
				mimeType: 'application/json',
				resourceType: 'fetch',
				durationMs: 145.2,
				timestamp: 2000,
				failed: true,
				errorText: 'Validation failed: title is required'
			},
			{
				id: 'n2',
				requestId: 'r2',
				url: 'https://api.coldiretti.it/v1/ping',
				method: 'GET',
				status: 200,
				statusText: 'OK',
				mimeType: 'application/json',
				resourceType: 'fetch',
				durationMs: 15.0,
				timestamp: 2100,
				failed: false
			}
		];

		it('formatElementContextForPrompt produce un Markdown chiaro e strutturato', () => {
			const md = formatElementContextForPrompt(sampleElement);
			assert.ok(md.includes('### Contesto Elemento Ispezionato'));
			assert.ok(md.includes('<button>'));
			assert.ok(md.includes('#draft-form > button.save-btn'));
			assert.ok(md.includes('Salva bozza'));
			assert.ok(md.includes('<SaveDraftButton>'));
			assert.ok(md.includes('120x36 a (200, 500)'));
			assert.ok(md.includes('background-color: #16a34a'));
		});

		it('formatConsoleErrorsForPrompt include solo errori/warning e traccia le ripetizioni', () => {
			const md = formatConsoleErrorsForPrompt(sampleConsole);
			assert.ok(md.includes('### Errori/Avvisi Console (2)'));
			assert.ok(md.includes('Uncaught TypeError: form.submit is not a function'));
			assert.ok(md.includes('(x2)'));
			assert.ok(md.includes('bundle.js:142'));
			assert.ok(md.includes('Source map not found'));
		});

		it('formatFailedRequestsForPrompt include solo richieste fallite o 4xx/5xx', () => {
			const md = formatFailedRequestsForPrompt(sampleNetwork);
			assert.ok(md.includes('### Richieste di Rete Fallite (1)'));
			assert.ok(md.includes('POST https://api.coldiretti.it/v1/drafts'));
			assert.ok(md.includes('Status 422 Unprocessable Entity'));
			assert.ok(md.includes('145.2ms'));
			assert.ok(md.includes('Validation failed: title is required'));
			// La richiesta 200 OK non deve comparire
			assert.ok(!md.includes('/ping'));
		});

		it('formatInspectorContextForPrompt aggrega selettivamente le sezioni disponibili', () => {
			const combined = formatInspectorContextForPrompt({
				element: sampleElement,
				consoleEntries: sampleConsole,
				networkEntries: sampleNetwork
			});

			assert.ok(combined.includes('Contesto Elemento Ispezionato'));
			assert.ok(combined.includes('Errori/Avvisi Console'));
			assert.ok(combined.includes('Richieste di Rete Fallite'));
		});
	});
});
