/**
 * Convergenza delle richieste di attenzione del Companion.
 *
 * `+page.svelte` sincronizza il Companion dentro un `$effect` che rilegge
 * `companionStore.attentionRequests`. Se `upsert`/`remove` scrivono anche
 * quando nulla e' cambiato, l'effetto invalida la dipendenza appena letta e si
 * richiama fino a `effect_update_depth_exceeded`: la superficie principale non
 * finisce mai di caricare.
 *
 * Questi test difendono l'unico contratto che impedisce quel loop: `null`
 * quando l'elenco e' gia' nello stato richiesto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	removeAttentionRequest,
	sameAttentionRequest,
	upsertAttentionRequest
} from '../src/lib/stores/companionAttention.ts';
import type { AttentionRequest } from '../src/lib/stores/companion.svelte.ts';

/**
 * Ricostruisce la richiesta come fa l'effetto: array e oggetti nuovi a ogni
 * passata, quindi nessuna identita' di riferimento condivisa.
 */
function buildRequest(overrides: Partial<AttentionRequest> = {}): AttentionRequest {
	return {
		projectId: 'proj-1',
		projectName: 'Portalino',
		projectHue: 210,
		modelName: 'Claude Opus 5',
		recentMessages: [
			{ role: 'user', text: 'aggiorna le quote', timestamp: 1000 },
			{ role: 'assistant', text: 'quale zona?', timestamp: 2000 }
		],
		pendingUi: {
			kind: 'ask',
			requestId: 'req-9',
			title: 'Zona',
			message: 'Quale zona?',
			method: 'select',
			options: ['Cuneo', 'Alba'],
			questions: [{ id: 'zona', options: [{ label: 'Cuneo' }] }],
			questionIndex: 0,
			totalQuestions: 1
		},
		...overrides
	};
}

test('remove converge quando il progetto non ha richieste pendenti', () => {
	// E' il caso normale a ogni avvio: nessun progetto in attesa. Deve produrre
	// zero scritture, o l'effetto entra in loop e la UI resta in caricamento.
	assert.equal(removeAttentionRequest([], 'proj-1'), null);
	assert.equal(removeAttentionRequest([buildRequest()], 'proj-altro'), null);
});

test('remove restituisce un elenco nuovo solo quando rimuove davvero', () => {
	const list = [buildRequest(), buildRequest({ projectId: 'proj-2' })];
	const next = removeAttentionRequest(list, 'proj-1');

	assert.ok(next, 'la rimozione di una richiesta presente deve produrre un elenco nuovo');
	assert.equal(next.length, 1);
	assert.equal(next[0].projectId, 'proj-2');
	assert.equal(list.length, 2, 'l\'elenco di partenza non va mutato');
});

test('upsert converge su una richiesta ricostruita ma equivalente', () => {
	// L'effetto ricostruisce `recentMessages` e `pendingUi` a ogni passata:
	// l'uguaglianza deve essere sui contenuti, non sui riferimenti.
	const stored = buildRequest();
	const rebuilt = buildRequest();

	assert.notEqual(stored.recentMessages, rebuilt.recentMessages);
	assert.ok(sameAttentionRequest(stored, rebuilt));
	assert.equal(upsertAttentionRequest([stored], rebuilt), null);
});

test('upsert inserisce una richiesta per un progetto non ancora presente', () => {
	const next = upsertAttentionRequest([], buildRequest());

	assert.ok(next);
	assert.equal(next.length, 1);
	assert.equal(next[0].projectId, 'proj-1');
});

test('upsert scrive quando cambia il contenuto della domanda', () => {
	const stored = buildRequest();

	const differentMessage = upsertAttentionRequest(
		[stored],
		buildRequest({ pendingUi: { ...buildRequest().pendingUi, message: 'Quale provincia?' } })
	);
	assert.ok(differentMessage, 'un messaggio diverso e\' un cambio di stato reale');
	assert.equal(differentMessage.length, 1);
	assert.equal(differentMessage[0].pendingUi.message, 'Quale provincia?');

	const differentRequestId = upsertAttentionRequest(
		[stored],
		buildRequest({ pendingUi: { ...buildRequest().pendingUi, requestId: 'req-10' } })
	);
	assert.ok(differentRequestId, 'una nuova domanda ha un requestId diverso');
});

test('upsert distingue le domande annidate per struttura, non per riferimento', () => {
	const stored = buildRequest();

	const sameShape = upsertAttentionRequest(
		[stored],
		buildRequest({
			pendingUi: {
				...buildRequest().pendingUi,
				questions: [{ id: 'zona', options: [{ label: 'Cuneo' }] }]
			}
		})
	);
	assert.equal(sameShape, null, 'domande strutturalmente identiche non sono un cambio');

	const changedShape = upsertAttentionRequest(
		[stored],
		buildRequest({
			pendingUi: {
				...buildRequest().pendingUi,
				questions: [{ id: 'zona', options: [{ label: 'Alba' }] }]
			}
		})
	);
	assert.ok(changedShape, 'una domanda annidata diversa deve essere rilevata');
});

test('upsert scrive quando cambiano i messaggi recenti o il modello', () => {
	const stored = buildRequest();

	const extraMessage = upsertAttentionRequest(
		[stored],
		buildRequest({
			recentMessages: [
				...buildRequest().recentMessages,
				{ role: 'user', text: 'Cuneo', timestamp: 3000 }
			]
		})
	);
	assert.ok(extraMessage, 'un messaggio in piu\' e\' contesto nuovo per il Companion');

	const otherModel = upsertAttentionRequest([stored], buildRequest({ modelName: 'GPT-5.6 Sol' }));
	assert.ok(otherModel, 'il cambio di modello va propagato');
});
