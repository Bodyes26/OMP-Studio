/**
 * Regressioni della sessione agente (fetta S4 del piano di polish).
 *
 * Ognuno di questi casi e' un difetto vero osservato nei log: insediamento che
 * salta lo storico per un comando accessorio, ricostruzione superata che scrive
 * nella sessione nuova, compattazione automatica che fa sparire il testo in
 * streaming, risposta a una domanda scaduta consegnata a quella nuova, Stop
 * seguito da un `agent_end` tardivo contato come turno concluso, task perso
 * quando la chat si chiude durante l'insediamento.
 *
 * Il tempo e' controllato: i timer della sessione sono finti (`mock.timers`) e
 * l'attesa e' su una condizione vera, mai su una durata indovinata.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { OmpRpcClient } from '../src/lib/agent/client.ts';
import type { AgentSessionEvent } from '../src/lib/agent/wire.ts';

register('./session-svelte-loader.mjs', import.meta.url);
// L'import statico precederebbe la registrazione del compilatore delle rune.
const { AgentSession } = await import('../src/lib/agent/session.svelte.ts');
const { SessionRegistry } = await import('../src/lib/agent/sessionRegistry.ts');
const { PromptBus } = await import('../src/lib/agent/promptBus.ts');
const { isExpectedTransportError } = await import('../src/lib/agent/transportErrors.ts');

if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
	Object.assign(globalThis, { window: globalThis });
}
Object.assign(globalThis, {
	dispatchEvent: (globalThis as { dispatchEvent?: unknown }).dispatchEvent ?? (() => true)
});

/** Lascia girare le promesse in sospeso senza attendere il tempo vero. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Attende che una condizione diverta vera: nessuna durata indovinata. */
async function until(predicate: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await flush();
	}
	assert.ok(predicate(), label);
}

function deferred<T>() {
	return Promise.withResolvers<T>();
}

/** Client finto: le risposte si decidono per comando, i frame si emettono a mano. */
class FakeClient {
	handler: ((event: AgentSessionEvent) => void) | null = null;
	epoch = 1;
	id = 7;
	isOpen = true;
	sent: string[] = [];
	pageResponder: () => Promise<{ messages?: unknown[]; totalMessages?: number }> = async () => ({ messages: [] });

	onEvent(handler: (event: AgentSessionEvent) => void): () => void {
		this.handler = handler;
		return () => {
			if (this.handler === handler) this.handler = null;
		};
	}

	emit(event: AgentSessionEvent) {
		this.handler?.(event);
	}

	async send<T>(command: { type: string }): Promise<T> {
		this.sent.push(command.type);
		if (command.type === 'get_messages_page') return (await this.pageResponder()) as T;
		if (command.type === 'get_state') return { sessionId: 'S', isStreaming: false } as T;
		return {} as T;
	}

	async respondUi() {}
	async abortAndRestoreQueue() {
		return null;
	}
	async abort() {}
	async forceKill() {}
	async close() {}
	markExited() {}
}

type Session = InstanceType<typeof AgentSession>;

function openSession(cwd: string): { session: Session; client: FakeClient } {
	const client = new FakeClient();
	const session = new AgentSession({ cwd, client: client as unknown as OmpRpcClient });
	return { session, client };
}

const userTexts = (session: Session) =>
	session.entries.filter((entry) => entry.kind === 'user').map((entry) => (entry as { content: string }).content);

const assistantTexts = (session: Session) =>
	session.entries
		.filter((entry) => entry.kind === 'assistant')
		.map((entry) => (entry as { blocks: { text: string }[] }).blocks.map((block) => block.text).join(''));

describe('Insediamento (S4-01, S1-rpc-04, S14-06)', () => {
	it('un comando accessorio fallito non salta la ricostruzione dello storico', async () => {
		const { session, client } = openSession('/tmp/attach-accessorio');
		const original = client.send.bind(client);
		client.send = async (command: { type: string }) => {
			if (command.type === 'set_subagent_subscription') {
				client.sent.push(command.type);
				const error = new Error('No response to "set_subagent_subscription" within 8s');
				Object.assign(error, { code: 'timeout' });
				throw error;
			}
			return original(command);
		};
		client.pageResponder = async () => ({ messages: [{ role: 'user', content: 'storico', timestamp: 1 }] });

		client.emit({ type: 'ready' });
		await until(() => session.isAttached && userTexts(session).length > 0, 'la sessione deve insediarsi con lo storico');

		assert.ok(client.sent.includes('get_messages_page'), 'lo storico deve essere stato chiesto comunque');
		assert.deepEqual(userTexts(session), ['storico']);
	});
});

describe('Ricostruzione del transcript (S4-04)', () => {
	it('una ricostruzione superata non scrive nella sessione nuova', async () => {
		const { session, client } = openSession('/tmp/rebuild-superata');
		// La prima lettura resta appesa finche' il test non la lascia andare:
		// e' la ricostruzione che verra' superata dal cambio di sessione.
		const firstPage = deferred<{ messages: unknown[] }>();
		let call = 0;
		client.pageResponder = () => {
			const mine = ++call;
			if (mine === 1) return firstPage.promise;
			return Promise.resolve({ messages: [{ role: 'user', content: 'NUOVA sessione', timestamp: 2 }] });
		};

		client.emit({ type: 'ready' });
		await until(() => call === 1, 'la prima ricostruzione deve aver chiesto la pagina');
		// Cambio di sessione deciso da un'altra finestra.
		client.emit({ type: 'studio_session_changed', requestId: 'altra-finestra' } as AgentSessionEvent);
		await until(() => userTexts(session).includes('NUOVA sessione'), 'la sessione nuova deve leggere il suo storico');
		// Ora arriva la pagina della chat precedente: la ricostruzione superata
		// deve uscire in silenzio.
		firstPage.resolve({ messages: [{ role: 'user', content: 'VECCHIA sessione', timestamp: 1 }] });
		await flush();
		await flush();

		const texts = userTexts(session);
		assert.ok(!texts.includes('VECCHIA sessione'), `il transcript della chat precedente non deve comparire: ${JSON.stringify(texts)}`);
		assert.deepEqual(texts, ['NUOVA sessione']);
	});
});

describe('Chiusura a meta ricostruzione (S4-04)', () => {
	it('non rimette il transcript precedente e non avvisa', async () => {
		const { session, client } = openSession('/tmp/rebuild-chiusa');
		// La pagina resta appesa: la ricostruzione e' certamente in volo quando
		// arriva la chiusura.
		const page = deferred<{ messages: unknown[] }>();
		client.pageResponder = () => page.promise;

		client.emit({ type: 'ready' });
		await until(() => client.sent.includes('get_messages_page'), 'la ricostruzione deve aver chiesto la pagina');
		await session.close();
		// La risposta arriva dopo la chiusura: la ricostruzione superata esce in
		// silenzio, senza rimettere il transcript di prima ne' avvisare.
		page.resolve({ messages: [{ role: 'user', content: 'vecchia', timestamp: 1 }] });
		await flush();
		await flush();

		assert.deepEqual(session.entries, []);
		assert.equal(session.isRebuildingTranscript, false);
	});
});

describe('Attesa della fine del turno (S4-13)', () => {
	it('considera il run vivo e si sblocca con false alla chiusura', async () => {
		const { session, client } = openSession('/tmp/wait-idle');
		client.emit({ type: 'ready' });
		await until(() => session.isAttached, 'la sessione deve insediarsi');
		assert.equal(await session.waitForIdle(1_000), true, 'a sessione ferma non c’e’ nulla da attendere');

		client.emit({ type: 'agent_start' });
		// Il run e' vivo: l'attesa resta appesa finche' la chat non si chiude.
		const waiting = session.waitForIdle(60_000);
		await flush();
		await session.close();

		assert.equal(await waiting, false, 'una sessione chiusa non vedra’ mai finire il turno');
	});
});

describe('Compattazione a run vivo (S4-05)', () => {
	it('non sostituisce il transcript mentre la risposta sta arrivando', async () => {
		const { session, client } = openSession('/tmp/compaction-run');
		client.emit({ type: 'ready' });
		await until(() => session.isAttached, 'la sessione deve insediarsi');

		// La ricostruzione post-compattazione resterebbe appesa: la risposta in
		// streaming non deve sparire mentre aspetta.
		const page = deferred<{ messages: unknown[] }>();
		client.pageResponder = () => page.promise;

		client.emit({ type: 'agent_start' });
		client.emit({ type: 'auto_compaction_start' });
		client.emit({ type: 'auto_compaction_end' });
		client.emit({ type: 'turn_start' });
		client.emit({ type: 'message_start', message: { role: 'assistant', timestamp: 5 } });
		client.emit({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: 'Risposta viva' });

		assert.equal(assistantTexts(session).length, 1, 'la risposta in streaming deve essere visibile');

		await flush();
		client.emit({ type: 'studio_delta', kind: 'text', contentIndex: 0, delta: ' e continua' });

		assert.ok(
			assistantTexts(session).some((text) => text.includes('Risposta viva')),
			`il testo in streaming non deve sparire: ${JSON.stringify(assistantTexts(session))}`
		);
		// A fine run la ricostruzione rinviata parte davvero.
		page.resolve({ messages: [{ role: 'user', content: 'prima', timestamp: 1 }] });
		client.emit({ type: 'agent_end', isTerminal: true } as AgentSessionEvent);
		await until(() => userTexts(session).includes('prima'), 'a fine run la ricostruzione rinviata deve leggere lo storico');
	});
});

describe('Risposta a una domanda scaduta (S4-07, ASK-009)', () => {
	it('con un requestId senza corrispondenza la risposta fallisce chiusa', async () => {
		const registry = new SessionRegistry<Record<string, unknown>>();
		let answered: string | undefined;
		const session = {
			cwd: '/tmp/ask-scaduta',
			scope: 'main',
			laneId: 'main',
			projectKey: 'p1',
			sessionKey: 'lane:p1:main',
			sessionId: 'sx',
			// La domanda aperta adesso e' B, quella a cui l'utente NON ha risposto.
			pendingUi: { kind: 'ask', requestId: 'req-B' },
			open: async () => {},
			close: async () => {},
			abort: async () => {},
			answerSelect: async (value: string) => {
				answered = value;
			}
		};
		registry.setLaneSession('p1', 'main', session as never);

		const routed = await registry.routeUiResponse({
			projectId: 'p1',
			laneId: 'main',
			requestId: 'req-A',
			response: { action: 'select', value: 'Si, cancella' }
		});

		assert.equal(routed, false, 'la risposta destinata ad A non deve essere consegnata');
		assert.equal(answered, undefined, 'la domanda B non deve ricevere la risposta di A');
	});
});

describe('Stop esplicito (S4-08, D2)', () => {
	it('un agent_end tardivo dopo lo Stop non conta come turno concluso', async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const { session, client } = openSession('/tmp/stop-tardivo');
		let turnEnds = 0;
		(session.suggestions as unknown as { notifyTurnEnd: () => void }).notifyTurnEnd = () => {
			turnEnds++;
		};

		client.emit({ type: 'ready' });
		await until(() => session.isAttached, 'la sessione deve insediarsi');
		client.emit({ type: 'agent_start' });
		client.emit({ type: 'message_start', message: { role: 'assistant', timestamp: 1 } });
		client.emit({
			type: 'message_update',
			assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Sto lavorando' }
		} as AgentSessionEvent);
		await session.abort();
		// Oltre la rete di sicurezza dell'interruzione: da qui un `agent_end`
		// e' quello del turno fermato, non di un turno concluso.
		t.mock.timers.tick(2_700);
		client.emit({ type: 'agent_end', isTerminal: true } as AgentSessionEvent);
		await flush();

		assert.equal(turnEnds, 0, 'un turno fermato dall’utente non deve chiudersi come normale');
	});

	it('lo Stop scarta il prompt in attesa dell’insediamento senza rimetterlo in coda', async () => {
		const { session } = openSession('/tmp/stop-startup');
		let requeued = 0;
		session.onStartupPromptsDropped = () => {
			requeued++;
		};
		session.setPreflightDeps({
			searchSource: async () => ({ literal: '', matches: [], omitted: 0 }),
			getGitStatus: async () => ({ statuses: {} }),
			timeoutMs: 1
		} as never);

		const delivery = await session.prompt('task dalla coda');
		assert.equal(delivery, 'deferred');
		assert.equal(session.hasPendingStartupPrompts, true);

		await session.abort();

		assert.equal(session.hasPendingStartupPrompts, false);
		assert.equal(requeued, 0, 'D2: lo Stop esplicito scarta il task, non lo rimette in coda');
	});

	it('la chiusura durante l’insediamento rimette il task in coda (S4-06)', async () => {
		const { session } = openSession('/tmp/chiusura-startup');
		let requeued = 0;
		session.onStartupPromptsDropped = () => {
			requeued++;
		};
		session.setPreflightDeps({
			searchSource: async () => ({ literal: '', matches: [], omitted: 0 }),
			getGitStatus: async () => ({ statuses: {} }),
			timeoutMs: 1
		} as never);

		const delivery = await session.prompt('task dalla coda');
		assert.equal(delivery, 'deferred');
		await session.close();

		assert.equal(session.hasPendingStartupPrompts, false);
		assert.equal(requeued, 1, 'il task deve tornare in coda una volta sola');
		assert.ok(
			!session.entries.some((entry) => entry.kind === 'user'),
			'la bolla ottimistica del prompt perduto deve sparire'
		);
	});
});

describe('Errori attesi del trasporto (S4-03, D1, C6)', () => {
	it('riconosce sessione chiusa, turno interrotto, comando accodato e macchina irraggiungibile', () => {
		assert.equal(isExpectedTransportError({ code: 'closed' }), true);
		assert.equal(isExpectedTransportError({ code: 'aborted' }), true);
		assert.equal(isExpectedTransportError({ code: 'transport' }), true);
		assert.equal(isExpectedTransportError({ code: 'busy' }), true);
		assert.equal(isExpectedTransportError(new Error('guasto vero')), false);
		assert.equal(isExpectedTransportError(null), false);
	});

	it('preferenze di coda non rimandate quando i valori non cambiano (S4-02)', async () => {
		const { session, client } = openSession('/tmp/queue-modes');
		client.emit({ type: 'ready' });
		await until(() => session.isAttached, 'la sessione deve insediarsi');
		await session.applyQueueModes();
		await session.applyQueueModes();
		const steering = client.sent.filter((type) => type === 'set_steering_mode').length;
		assert.equal(steering, 1, 'la seconda chiamata con gli stessi valori non deve rimandare i comandi');
	});

	it('la sottoscrizione ai subagenti passa a off a chat non visibile (C4, S14-04)', async () => {
		const { session, client } = openSession('/tmp/vista-subagenti');
		client.emit({ type: 'ready' });
		await until(() => session.isAttached, 'la sessione deve insediarsi');
		client.sent = [];
		session.setViewVisible(false);
		await flush();
		assert.deepEqual(
			client.sent.filter((type) => type === 'set_subagent_subscription'),
			['set_subagent_subscription'],
			'un solo comando al passaggio a non visibile'
		);
	});
});

describe('Bus delle domande (S4-10)', () => {
	it('la prima risposta vince anche dopo la potatura della voce', async () => {
		const bus = new PromptBus({ autoInit: false });
		let calls = 0;
		bus.registerRequest({
			requestId: 'req-potata',
			projectId: 'p1',
			title: 'Domanda',
			responder: async () => {
				calls++;
				return true;
			}
		});
		assert.equal(await bus.resolveRequest('req-potata', { action: 'select', value: 'A' }), true);
		// La voce resta tra le chiuse: una seconda risposta non passa.
		assert.equal(await bus.resolveRequest('req-potata', { action: 'select', value: 'B' }), false);
		assert.equal(calls, 1);
	});
});
