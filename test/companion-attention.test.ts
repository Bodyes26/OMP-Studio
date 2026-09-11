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
	buildAttentionRequest,
	removeAttentionRequest,
	sameAttentionRequest,
	upsertAttentionRequest
} from '../src/lib/stores/companionAttention.ts';
import { askQuestionText, parseAskTitle, sanitizeAskDetail } from '../src/lib/agent/askTitle.ts';
import { cleanOptionLabel, isOtherOption } from '../src/lib/agent/askAnswers.ts';
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

test('buildAttentionRequest pubblica la domanda anche senza `message`', () => {
	// La regressione che ha reso muta la companion: il testo della domanda sta
	// in `title` e `message` e' facoltativo. Pretenderlo lasciava il progetto
	// con il solo stato "chiede risposta" e nessuna domanda da leggere.
	const request = buildAttentionRequest(
		{ id: 'proj-1', name: 'AreaIT', hue: 210 },
		{
			pendingUi: {
				kind: 'ask',
				requestId: 'req-1',
				title: 'Quale zona sistemare? (1/2)',
				method: 'select',
				options: ['Cuneo', 'Alba']
			},
			model: { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
			recentMessages: []
		}
	);

	assert.ok(request, 'una richiesta senza `message` deve arrivare alla companion');
	assert.equal(request.projectName, 'AreaIT');
	assert.equal(request.modelName, 'GPT-5.6 Sol');
	assert.deepEqual(request.pendingUi.options, ['Cuneo', 'Alba']);
	assert.equal(askQuestionText(request.pendingUi), 'Quale zona sistemare?');
});

test('buildAttentionRequest non pubblica nulla senza richiesta interattiva', () => {
	const base = { id: 'proj-1', name: 'AreaIT', hue: 210 };
	assert.equal(buildAttentionRequest(base, { pendingUi: null, recentMessages: [] }), null);
	assert.equal(
		buildAttentionRequest(base, {
			pendingUi: { kind: 'notify', requestId: 'req-2' },
			recentMessages: []
		}),
		null,
		'solo le richieste `ask` vogliono una risposta'
	);
});

test('il titolo perde i marcatori di posizione, non la domanda', () => {
	assert.deepEqual(parseAskTitle('Procedo con il rilascio? (2/3)'), {
		counter: '2/3',
		text: 'Procedo con il rilascio?'
	});
	assert.deepEqual(parseAskTitle('(1 selected) Quali zone includere? (1/2)'), {
		counter: '1 selected',
		text: 'Quali zone includere?'
	});
	assert.deepEqual(parseAskTitle(undefined), { counter: null, text: '' });

	// Senza titolo si mostra il dettaglio; senza nulla, un testo onesto.
	assert.equal(askQuestionText({ message: 'Serve la conferma' }), 'Serve la conferma');
	assert.equal(askQuestionText({}), 'Richiesta di risposta');
});

test('sanitizeAskDetail pulisce artefatti CLI da fallback terminale', () => {
	const cliDump = `▮ Contestuale (Recommended)
Sempre badge/tab e card Companion; notifica desktop solo se il prog...
▮ Sempre evidente
Badge/tab, card Companion, apertura Spotlight e notifica desktop in...
▮ Solo dentro Studio
Badge/tab, banner e card Companion senza notifica desktop né apertu...
▮ Other (type your own)

Enter your response:`;

	assert.equal(sanitizeAskDetail(cliDump), null, 'un dump intero di opzioni CLI non deve sporcare il dettaglio');

	const promptOnly = 'Enter your response:';
	assert.equal(sanitizeAskDetail(promptOnly), null);

	const genuineNote = 'Attenzione: questa modifica riavvierà il servizio.';
	assert.equal(sanitizeAskDetail(genuineNote), genuineNote);

	const noteWithDump = `Nota introduttiva legittima.

▮ Scelta 1
▮ Scelta 2

Enter your response:`;
	assert.equal(sanitizeAskDetail(noteWithDump), 'Nota introduttiva legittima.');
});

test('askQuestionText non usa dump CLI come titolo se manca il titolo', () => {
	const cliDump = `▮ Option 1
▮ Other (type your own)

Enter your response:`;

	assert.equal(
		askQuestionText({ message: cliDump }),
		'Richiesta di risposta',
		'se il messaggio e solo un dump CLI e manca il titolo, deve scattare il fallback'
	);
});

test('gestione opzioni Altro e Consigliata per la companion', () => {
	assert.equal(isOtherOption('Other (type your own)'), true);
	assert.equal(isOtherOption('other (custom)'), true);
	assert.equal(isOtherOption('Altro (scrivi la tua risposta)'), true);
	assert.equal(isOtherOption('Normale opzione'), false);

	assert.equal(cleanOptionLabel('Contestuale (Recommended)'), 'Contestuale');
	assert.equal(cleanOptionLabel('Sempre evidente'), 'Sempre evidente');
});

test('buildAttentionRequest pubblica richiesta per inferredAttention quando manca ask formale', () => {
	const base = { id: 'proj-1', name: 'Studio OMP', hue: 195 };
	const request = buildAttentionRequest(base, {
		pendingUi: null,
		inferredAttention: {
			question: 'Confermi e procedo dalla Fase 1?',
			suggestions: ['Procedi pure', 'Spiega la scelta']
		},
		model: { name: 'Claude Opus 5' },
		recentMessages: []
	});

	assert.ok(request, 'deve pubblicare la richiesta di attenzione');
	assert.equal(request.pendingUi.kind, 'inferred_input');
	assert.equal(request.pendingUi.title, 'Confermi e procedo dalla Fase 1?');
	assert.deepEqual(request.pendingUi.options, ['Procedi pure', 'Spiega la scelta']);
	assert.equal(askQuestionText(request.pendingUi), 'Confermi e procedo dalla Fase 1?');
});
