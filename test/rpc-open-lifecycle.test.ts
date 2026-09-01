/**
 * Ciclo di vita delle aperture del canale RPC.
 *
 * Il difetto da difendere e' la ripresa di una chat cliccata mentre il
 * processo del progetto sta ancora partendo: `close()` non aveva niente da
 * chiudere (l'`rpcId` non esisteva ancora), il processo nasceva comunque e
 * restavano **due** omp vivi sullo stesso progetto, entrambi a spingere i
 * propri frame nello stesso riduttore. L'insediamento si faceva sul primo
 * `ready` (la sessione nuova e vuota), i prompt andavano all'altro e la chat
 * ripresa restava senza messaggi a schermo.
 *
 * Qui gira il client di produzione: `Channel` e `invoke` sono quelli veri di
 * Tauri, sopra un `__TAURI_INTERNALS__` finto. Nessuna attesa a tempo: si
 * risolvono a mano le promise di `rpc_open` e si consegnano i frame.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Channel } from '@tauri-apps/api/core';
import { OmpRpcClient } from '../src/lib/agent/client.ts';

interface InvokeCall {
	cmd: string;
	args: Record<string, unknown>;
}

let calls: InvokeCall[] = [];
let opens: { resolve: (rpcId: number) => void; channelId: number }[] = [];
let callbacks = new Map<number, (raw: unknown) => void>();
let nextCallbackId = 1;

function installTauriInternals() {
	calls = [];
	opens = [];
	callbacks = new Map();
	nextCallbackId = 1;

	const internals = {
		transformCallback(callback: (raw: unknown) => void): number {
			const id = nextCallbackId++;
			callbacks.set(id, callback);
			return id;
		},
		unregisterCallback(id: number) {
			callbacks.delete(id);
		},
		invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
			calls.push({ cmd, args });
			if (cmd !== 'rpc_open') return Promise.resolve(undefined);
			// `onEvent` e' il `Channel` costruito dal client: la sua identita'
			// e' nota per costruzione, non e' un dato esterno da validare.
			const channel = args.onEvent as Channel<string>;
			return new Promise<unknown>((resolve) => {
				opens.push({ resolve, channelId: channel.id });
			});
		}
	};

	// Sostituto minimo di `window` per il client: i timer servono solo a
	// `send()` (timeout delle richieste) e nessun test li lascia scadere.
	(globalThis as { window?: unknown }).window = {
		setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
		clearTimeout: (id: number) => clearTimeout(id),
		__TAURI_INTERNALS__: internals
	};
}

/** Consegna un frame sul canale dell'apertura `index`, come farebbe Rust. */
function emit(index: number, line: string, messageIndex = 0) {
	const open = opens[index];
	assert.ok(open, `apertura ${index} inesistente`);
	const callback = callbacks.get(open.channelId);
	assert.ok(callback, `canale ${open.channelId} senza callback`);
	callback({ index: messageIndex, message: line });
}

describe('Canale RPC: aperture concorrenti e processi orfani', () => {
	beforeEach(() => installTauriInternals());

	it('un open piu recente chiude il processo superato e ne ignora i frame', async () => {
		const client = new OmpRpcClient();
		const events: string[] = [];
		client.onEvent((event) => events.push(String(event.type)));

		// Avvio automatico della superficie, ancora in volo...
		const bootstrap = client.open('C:/proj', null);
		// ...e ripresa della chat scelta dall'utente, che deve vincere.
		const resume = client.open('C:/proj', 'sessione-A');

		assert.equal(opens.length, 2, 'due processi avviati: e la situazione da governare');

		// Il processo superato nasce comunque, ed e' il primo a essere pronto.
		opens[0].resolve(11);
		opens[1].resolve(22);
		await Promise.all([bootstrap, resume]);

		assert.deepEqual(
			calls.filter((c) => c.cmd === 'rpc_close').map((c) => c.args.rpcId),
			[11],
			'il processo superato va chiuso, non lasciato vivo'
		);
		assert.equal(client.id, 22, 'i comandi vanno al processo richiesto per ultimo');

		// Il `ready` del processo superato non deve arrivare al riduttore: era
		// lui a far insediare la superficie sulla sessione sbagliata.
		emit(0, JSON.stringify({ type: 'ready' }));
		assert.deepEqual(events, []);

		// Quello del processo giusto invece si.
		emit(1, JSON.stringify({ type: 'ready' }));
		assert.deepEqual(events, ['ready']);
	});

	it('close chiude anche il processo che stava nascendo', async () => {
		const client = new OmpRpcClient();
		const events: string[] = [];
		client.onEvent((event) => events.push(String(event.type)));

		const opening = client.open('C:/proj', null);
		// `close()` arriva prima che `rpc_open` abbia restituito l'id.
		await client.close();
		opens[0].resolve(31);
		await opening;

		assert.deepEqual(
			calls.filter((c) => c.cmd === 'rpc_close').map((c) => c.args.rpcId),
			[31],
			'nessun omp orfano dopo la chiusura'
		);
		assert.equal(client.id, null);
		assert.equal(client.isOpen, false);

		emit(0, JSON.stringify({ type: 'ready' }));
		assert.deepEqual(events, [], 'un processo chiuso non insedia niente');
	});

	it('l apertura sopravvissuta resta operativa e correla le risposte', async () => {
		const client = new OmpRpcClient();
		const superata = client.open('C:/proj', null);
		const buona = client.open('C:/proj', 'sessione-A');
		opens[0].resolve(11);
		opens[1].resolve(22);
		await Promise.all([superata, buona]);

		const pending = client.send<{ messages: unknown[] }>({ type: 'get_messages_page', limit: 256 });
		const sent = calls.filter((c) => c.cmd === 'rpc_send');
		assert.equal(sent.length, 1);
		assert.equal(sent[0].args.rpcId, 22, 'i comandi non finiscono sul processo superato');

		const line = sent[0].args.line;
		assert.equal(typeof line, 'string');
		const frame: unknown = JSON.parse(String(line));
		assert.ok(frame && typeof frame === 'object' && 'id' in frame && typeof frame.id === 'string');
		emit(
			1,
			JSON.stringify({
				id: frame.id,
				type: 'response',
				command: 'get_messages_page',
				success: true,
				data: { messages: [{ role: 'user' }] }
			})
		);
		const data = await pending;
		assert.equal(data.messages.length, 1);
	});
});
