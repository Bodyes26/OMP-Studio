/// <reference types="node" />
/// <reference lib="es2020" />
/**
 * Suite di test per PromptBus: architettura unificata e resiliente per interazioni utente pendenti.
 *
 * 1. Registrazione, arricchimento e consultazione delle richieste (`registerRequest`, `getPendings`).
 * 2. Risoluzione atomica con semantica First-Response-Wins (`resolveRequest`).
 * 3. Annullamento atomico (`cancelRequest`).
 * 4. Resilienza ai reload e crash della WebView tramite persistenza locale temporanea.
 * 5. Sincronizzazione inter-finestra tra Main e Companion (notifiche e first-response-wins cross-window).
 * 6. Apertura tardiva della Companion e recupero immediato dello stato pendente.
 * 7. Normalizzazione delle risposte utente (`normalizePromptAnswer`).
 * 8. Filtraggio per progetto, pulizia e gestione delle scadenze (deadline / TTL).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PromptBus, type PromptBusStorage } from '../src/lib/agent/promptBus.ts';
import { normalizePromptAnswer } from '../src/lib/agent/askAnswers.ts';

function createMockStorage(): PromptBusStorage {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, val: string) => map.set(key, val),
		removeItem: (key: string) => map.delete(key)
	};
}

interface MockBusChannel {
	broadcast: <T>(event: string, payload: T) => Promise<void>;
	listen: <T>(event: string, handler: (payload: T) => void) => Promise<(() => void) | null>;
	emitToListeners: <T>(event: string, payload: T) => void;
}

function createMockBusChannel(): MockBusChannel {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	return {
		broadcast: async <T>(event: string, payload: T) => {
			const set = listeners.get(event);
			if (set) {
				for (const handler of set) {
					handler(payload);
				}
			}
		},
		listen: async <T>(event: string, handler: (payload: T) => void) => {
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			const set = listeners.get(event)!;
			set.add(handler as (payload: unknown) => void);
			return () => {
				set.delete(handler as (payload: unknown) => void);
			};
		},
		emitToListeners: <T>(event: string, payload: T) => {
			const set = listeners.get(event);
			if (set) {
				for (const handler of set) {
					handler(payload);
				}
			}
		}
	};
}

describe('PromptBus: Architettura e Resilienza Input Pendenti', () => {
	let storage: PromptBusStorage;
	let channel: MockBusChannel;

	beforeEach(() => {
		storage = createMockStorage();
		channel = createMockBusChannel();
	});

	describe('1. Registrazione, arricchimento e interrogazione', () => {
		it('registra correttamente una nuova richiesta ask e la rende visibile in getPendings', () => {
			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });

			const req = bus.registerRequest({
				requestId: 'req-1',
				projectId: 'proj-areait',
				kind: 'ask',
				method: 'select',
				title: 'Quale zona aggiornare?',
				options: ['Cuneo', 'Alba', 'Bra']
			});

			assert.equal(req.requestId, 'req-1');
			assert.equal(req.projectId, 'proj-areait');
			assert.equal(req.status, 'pending');
			assert.equal(req.title, 'Quale zona aggiornare?');
			assert.deepEqual(req.options, ['Cuneo', 'Alba', 'Bra']);

			const pendings = bus.getPendings();
			assert.equal(pendings.length, 1);
			assert.equal(pendings[0].requestId, 'req-1');
			assert.equal(bus.hasPending('req-1'), true);
		});

		it('arricchisce una richiesta pendente se arrivano dettagli aggiuntivi senza duplicare o resettare', () => {
			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });

			bus.registerRequest({
				requestId: 'req-2',
				projectId: 'proj-flotta',
				title: 'Richiesta mezzo',
				method: 'select',
				options: ['Auto 1', 'Auto 2']
			});

			// Arriva l'arricchimento con le domande complete e toolCallId
			const enriched = bus.registerRequest({
				requestId: 'req-2',
				projectId: 'proj-flotta',
				title: 'Richiesta mezzo (1/2)',
				method: 'select',
				toolCallId: 'call-99',
				questions: [
					{ id: 'q1', question: 'Quale auto?', options: [{ label: 'Auto 1' }, { label: 'Auto 2' }] }
				],
				questionIndex: 0,
				totalQuestions: 2
			});

			assert.equal(enriched.requestId, 'req-2');
			assert.equal(enriched.toolCallId, 'call-99');
			assert.equal(enriched.totalQuestions, 2);
			assert.equal(enriched.status, 'pending');

			// Non devono esserci duplicati
			assert.equal(bus.getPendings().length, 1);
		});

		it('filtra per progetto in modo isolato tramite getPendingsForProject', () => {
			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });

			bus.registerRequest({ requestId: 'r1', projectId: 'proj-A', title: 'Domanda A' });
			bus.registerRequest({ requestId: 'r2', projectId: 'proj-B', title: 'Domanda B' });
			bus.registerRequest({ requestId: 'r3', projectId: 'proj-A', title: 'Domanda A2' });

			assert.equal(bus.getPendings().length, 3);
			assert.equal(bus.getPendingsForProject('proj-A').length, 2);
			assert.equal(bus.getPendingsForProject('proj-B').length, 1);
			assert.equal(bus.getPendingsForProject('proj-C').length, 0);
		});
	});

	describe('2. Semantica First-Response-Wins e Risoluzione Atomica', () => {
		it('risolve la richiesta al primo arrivo e rifiuta risposte concorrenti successive', async () => {
			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });
			let responderCalls = 0;
			let answeredValue = '';

			bus.registerRequest({
				requestId: 'req-atomic',
				projectId: 'proj-1',
				title: 'Confermi?',
				method: 'confirm',
				responder: async (ans) => {
					responderCalls++;
					if ('confirmed' in ans) answeredValue = String(ans.confirmed);
					return true;
				}
			});

			// Prima risposta: vince
			const first = await bus.resolveRequest('req-atomic', { action: 'confirm', confirmed: true });
			assert.equal(first, true, 'la prima risposta deve essere accettata con successo');
			assert.equal(responderCalls, 1);
			assert.equal(answeredValue, 'true');

			const reqAfter = bus.getRequest('req-atomic');
			assert.equal(reqAfter?.status, 'resolved');

			// Seconda risposta concorrente (es. utente ha cliccato contemporaneamente altrove)
			const second = await bus.resolveRequest('req-atomic', { action: 'confirm', confirmed: false });
			assert.equal(second, false, 'la seconda risposta deve essere scartata atomicamente');
			assert.equal(responderCalls, 1, 'il responder non deve essere invocato una seconda volta');

			// Tentativo di cancellazione su richiesta gia risolta
			const cancelAttempt = await bus.cancelRequest('req-atomic');
			assert.equal(cancelAttempt, false, 'non e possibile cancellare una richiesta gia risolta');
		});

		it('annulla la richiesta e rifiuta successive risoluzioni o cancellazioni', async () => {
			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });
			let cancelResponderCalled = false;

			bus.registerRequest({
				requestId: 'req-cancel-1',
				projectId: 'proj-1',
				title: 'Annulla test',
				responder: async (ans) => {
					if ('action' in ans && ans.action === 'cancel') {
						cancelResponderCalled = true;
					}
					return true;
				}
			});

			const cancelled = await bus.cancelRequest('req-cancel-1');
			assert.equal(cancelled, true);
			assert.equal(cancelResponderCalled, true);
			assert.equal(bus.getRequest('req-cancel-1')?.status, 'cancelled');

			// Tentativo ulteriore
			const secondCancel = await bus.cancelRequest('req-cancel-1');
			assert.equal(secondCancel, false);

			const resolveAfterCancel = await bus.resolveRequest('req-cancel-1', { action: 'select', value: 'X' });
			assert.equal(resolveAfterCancel, false);
		});
	});

	describe('3. Resilienza a Crash WebView e Ricaricamenti (Persistenza Temporanea)', () => {
		it('salva le richieste pendenti nello storage e le recupera dopo un reload simulato', () => {
			// Simulazione della webview pre-reload
			const busPreReload = new PromptBus({
				storage,
				broadcast: channel.broadcast,
				listen: channel.listen
			});

			busPreReload.registerRequest({
				requestId: 'req-survivor',
				projectId: 'proj-areait',
				kind: 'ask',
				method: 'select',
				title: 'Scegli la stampante',
				options: ['LaserJet 1', 'DeskJet 2'],
				questionIndex: 0,
				totalQuestions: 1
			});

			assert.equal(busPreReload.getPendings().length, 1);

			// Simulazione del reload della WebView2 (l'istanza JavaScript precedente muore completamente)
			busPreReload.destroy();

			// Nuova istanza creata dopo il reload con lo stesso storage
			const busPostReload = new PromptBus({
				storage,
				broadcast: channel.broadcast,
				listen: channel.listen
			});

			// Le richieste pendenti devono essere recuperate immediatamente
			const pendings = busPostReload.getPendings();
			assert.equal(pendings.length, 1, 'la richiesta deve sopravvivere al reload della WebView');
			assert.equal(pendings[0].requestId, 'req-survivor');
			assert.equal(pendings[0].title, 'Scegli la stampante');
			assert.deepEqual(pendings[0].options, ['LaserJet 1', 'DeskJet 2']);

			// Il responder puo essere riagganciato dalla nuova sessione riaperta
			let responderInvoked = false;
			const reattached = busPostReload.attachResponder('req-survivor', async () => {
				responderInvoked = true;
				return true;
			});
			assert.equal(reattached, true);

			// Risolvendo la richiesta dopo il reload, il responder viene eseguito e lo storage viene ripulito
			void busPostReload.resolveRequest('req-survivor', { action: 'select', value: 'LaserJet 1' });
			assert.equal(responderInvoked, true);
			assert.equal(busPostReload.getPendings().length, 0);

			// Un terzo avvio trovera lo storage pulito
			const busThird = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });
			assert.equal(busThird.getPendings().length, 0, 'le richieste risolte non devono persistere come pendenti');
		});

		it('scarta automaticamente richieste scadute oltre il TTL (24 ore)', () => {
			const staleTime = Date.now() - 25 * 60 * 60 * 1000;
			storage.setItem(
				'omp-studio-pending-prompts',
				JSON.stringify([
					{
						requestId: 'stale-1',
						projectId: 'proj-old',
						title: 'Vecchia domanda',
						createdAt: staleTime,
						options: []
					}
				])
			);

			const bus = new PromptBus({ storage, broadcast: channel.broadcast, listen: channel.listen });
			assert.equal(bus.getPendings().length, 0, 'le richieste stantie oltre 24h devono essere scartate');
		});
	});

	describe('4. Sincronizzazione atomica tra Finestra Principale e Companion', () => {
		it('trasmette la risoluzione da Companion a Finestra Principale e chiude su entrambe', async () => {
			// Simuliamo due finestre separate: Finestra Principale (A) e Companion (B)
			const channelAB = createMockBusChannel();

			const mainBus = new PromptBus({
				storage,
				broadcast: channelAB.broadcast,
				listen: channelAB.listen,
				autoInit: false
			});
			await mainBus.init();

			const companionBus = new PromptBus({
				storage,
				broadcast: channelAB.broadcast,
				listen: channelAB.listen,
				autoInit: false
			});
			await companionBus.init();

			let mainResponderAnswer = '';
			mainBus.registerRequest({
				requestId: 'req-cross',
				projectId: 'proj-shared',
				title: 'Conferma rilascio?',
				method: 'confirm',
				responder: async (ans) => {
					if ('confirmed' in ans) mainResponderAnswer = String(ans.confirmed);
					return true;
				}
			});

			// Companion vede la richiesta (tramite storage o registrazione remota)
			assert.equal(companionBus.hasPending('req-cross'), true);

			// L'utente risponde dalla Finestra Companion
			const resFromCompanion = await companionBus.resolveRequest('req-cross', {
				action: 'confirm',
				confirmed: true
			});
			assert.equal(resFromCompanion, true);

			// Attendi ciclo eventi per notifica su Main
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Main window deve aver ricevuto la risoluzione ed eseguito il suo responder verso OMP
			assert.equal(mainResponderAnswer, 'true', 'il responder della sessione principale deve essere stato eseguito');
			assert.equal(mainBus.getRequest('req-cross')?.status, 'resolved');
			assert.equal(mainBus.getPendings().length, 0);
			assert.equal(companionBus.getPendings().length, 0);

			// Se l'utente tenta di rispondere subito dopo da Main, la chiamata viene respinta
			const lateMainAnswer = await mainBus.resolveRequest('req-cross', { action: 'confirm', confirmed: false });
			assert.equal(lateMainAnswer, false, 'seconda risposta respinta atomicamente (first-response-wins)');
		});

		it('all\'apertura tardiva della Companion, le richieste pendenti vengono recuperate e sincronizzate', async () => {
			const channelLate = createMockBusChannel();

			// 1. Finestra Principale attiva
			const mainBus = new PromptBus({
				storage,
				broadcast: channelLate.broadcast,
				listen: channelLate.listen,
				autoInit: false
			});
			await mainBus.init();

			mainBus.registerRequest({
				requestId: 'req-late',
				projectId: 'proj-areait',
				title: 'Domanda prima dell\'apertura companion',
				method: 'select',
				options: ['Opzione 1', 'Opzione 2']
			});

			assert.equal(mainBus.getPendings().length, 1);

			// 2. Companion si apre successivamente
			const lateCompanionBus = new PromptBus({
				storage,
				broadcast: channelLate.broadcast,
				listen: channelLate.listen,
				autoInit: false
			});
			await lateCompanionBus.init();

			// La Companion deve possedere immediatamente la richiesta pendente
			const companionPendings = lateCompanionBus.getPendings();
			assert.equal(companionPendings.length, 1, 'la Companion deve acquisire la richiesta pendente');
			assert.equal(companionPendings[0].requestId, 'req-late');
			assert.equal(companionPendings[0].title, 'Domanda prima dell\'apertura companion');
		});
	});

	describe('5. Normalizzazione delle risposte utente (normalizePromptAnswer)', () => {
		it('normalizza formati ad azione esplicita e oggetti primitivi', () => {
			assert.deepEqual(normalizePromptAnswer({ action: 'select', value: 'Alba' }), {
				action: 'select',
				value: 'Alba'
			});

			assert.deepEqual(normalizePromptAnswer({ value: 'Cuneo' }), {
				action: 'select',
				value: 'Cuneo'
			});

			assert.deepEqual(normalizePromptAnswer({ confirmed: true }), {
				action: 'confirm',
				confirmed: true
			});

			assert.deepEqual(normalizePromptAnswer({ cancelled: true }), {
				action: 'cancel'
			});

			assert.deepEqual(normalizePromptAnswer({ action: 'cancel' }), {
				action: 'cancel'
			});
		});
	});
});
