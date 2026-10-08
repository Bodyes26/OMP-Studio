/**
 * Domande a margine (`/btw`): modulo puro `btw.ts`, stato `SessionBtw` con un
 * `send` finto che riproduce l'ordine dei frame di omp 18.8 (docs/rpc.md,
 * «Side questions»), instradamento di `/btw` nel guscio.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	applyBtwDelta,
	btwLatestTurn,
	btwQuoteMarkdown,
	btwQuotePreview,
	btwTurns,
	btwWhen,
	isBtwRunning,
	isBtwUnsupportedError,
	parseBtwHistory,
	parseBtwRecord,
	upsertBtwRecord,
	withBtwQuote,
	type BtwRecord
} from '../src/lib/agent/btw.ts';
import { SessionBtw } from '../src/lib/agent/btwState.svelte.ts';
import { routeBtwSlash } from '../src/lib/agent/slashRouter.ts';
import { routeComposerSubmit } from '../src/lib/agent/composerSubmit.ts';

const T0 = 1_791_000_000_000;

function record(partial: Partial<BtwRecord> & { id: string }): BtwRecord {
	return {
		question: 'Perché quotaStore usa una Map?',
		answer: '',
		status: 'running',
		createdAt: T0,
		updatedAt: T0,
		leafId: 'a1b2c3d4',
		...partial
	};
}

describe('btw: record dal filo', () => {
	it('legge un record omp 18.8 con approfondimenti', () => {
		const parsed = parseBtwRecord({
			id: '1596abc',
			question: 'Perché?',
			answer: 'Perché sì.',
			status: 'complete',
			createdAt: T0,
			updatedAt: T0 + 5,
			leafId: null,
			followUps: [{ question: 'E poi?', answer: 'Poi no.', status: 'complete', createdAt: T0 + 10, updatedAt: T0 + 12 }]
		});
		assert.ok(parsed);
		assert.equal(parsed.followUps?.length, 1);
		assert.deepEqual(
			btwTurns(parsed).map((turn) => turn.question),
			['Perché?', 'E poi?']
		);
		assert.equal(btwLatestTurn(parsed).answer, 'Poi no.');
	});

	it('scarta i record senza id, domanda o stato noto', () => {
		assert.equal(parseBtwRecord({ question: 'x', status: 'complete' }), null);
		assert.equal(parseBtwRecord({ id: 'a', status: 'complete' }), null);
		assert.equal(parseBtwRecord({ id: 'a', question: 'x', status: 'boh' }), null);
		assert.equal(parseBtwRecord(null), null);
	});

	it('lo storico e\u0300 dal piu\u0300 recente e tollera voci rotte', () => {
		const list = parseBtwHistory({
			records: [
				record({ id: 'vecchio', createdAt: T0 - 1000, status: 'complete' }),
				{ rotto: true },
				record({ id: 'nuovo', createdAt: T0, status: 'interrupted' })
			]
		});
		assert.deepEqual(
			list.map((entry) => entry.id),
			['nuovo', 'vecchio']
		);
		assert.deepEqual(parseBtwHistory(undefined), []);
	});
});

describe('btw: streaming e cambi di stato', () => {
	it('i delta finiscono nell\u2019ultimo turno', () => {
		let list = [record({ id: 'r1' })];
		list = applyBtwDelta(list, 'r1', 'Le chiavi ');
		list = applyBtwDelta(list, 'r1', 'arrivano a runtime.');
		assert.equal(list[0].answer, 'Le chiavi arrivano a runtime.');
		const withFollowUp = [
			record({
				id: 'r2',
				status: 'complete',
				answer: 'Prima.',
				followUps: [{ question: 'E se?', answer: '', status: 'running', createdAt: T0, updatedAt: T0 }]
			})
		];
		const after = applyBtwDelta(withFollowUp, 'r2', 'Dopo.');
		assert.equal(after[0].answer, 'Prima.');
		assert.equal(btwLatestTurn(after[0]).answer, 'Dopo.');
		assert.equal(applyBtwDelta(list, 'ignoto', 'x'), list);
	});

	it('btw_record vince, ma un frame running in ritardo non accorcia la risposta', () => {
		let list = [record({ id: 'r1', answer: 'Le chiavi arrivano' })];
		list = upsertBtwRecord(list, record({ id: 'r1', answer: 'Le chiavi' }));
		assert.equal(list[0].answer, 'Le chiavi arrivano');
		list = upsertBtwRecord(list, record({ id: 'r1', answer: 'Finale.', status: 'complete' }));
		assert.equal(list[0].answer, 'Finale.');
		assert.equal(isBtwRunning(list[0]), false);
	});
});

describe('btw: omp senza domande a margine', () => {
	it('riconosce i rifiuti dei runtime vecchi', () => {
		assert.equal(isBtwUnsupportedError(Object.assign(new Error('Unknown command: btw'), { code: undefined })), true);
		assert.equal(isBtwUnsupportedError(Object.assign(new Error('x'), { code: 'uncorrelated' })), true);
		assert.equal(isBtwUnsupportedError(new Error('A /btw question is still running; cancel it first')), false);
		assert.equal(isBtwUnsupportedError(new Error('No active model available for /btw.')), false);
	});
});

describe('btw: citazione nel composer', () => {
	it('mette domanda e risposta in un blockquote in testa al messaggio', () => {
		const quote = btwQuoteMarkdown('A margine', 'Perché  una\nMap?', 'Riga uno.\n\nRiga due.');
		assert.equal(quote, '> **A margine** — «Perché una Map?»\n>\n> Riga uno.\n>\n> Riga due.');
		assert.equal(withBtwQuote(quote, 'Allora cambiala'), `${quote}\n\nAllora cambiala`);
		assert.equal(withBtwQuote(quote, '   '), quote);
		assert.equal(btwQuotePreview('usa una `Map` perché', 10), 'usa una Ma…');
	});

	it('quando: adesso, ora del giorno, data', () => {
		assert.equal(btwWhen(T0 - 10_000, T0, 'it', 'adesso'), 'adesso');
		assert.match(btwWhen(T0 - 2 * 3_600_000, T0, 'it', 'adesso'), /\d{2}[:.]\d{2}/);
		assert.equal(btwWhen(0, T0, 'it', 'adesso'), '');
	});
});

type Sent = { type: string; question?: string; recordId?: string };

function harness(reply: (command: Sent, emit: (frame: unknown) => void) => unknown) {
	const sent: Sent[] = [];
	const flashes: string[] = [];
	const notices: string[] = [];
	const btw: SessionBtw = new SessionBtw({
		send: async (command) => {
			sent.push(command);
			const result = reply(command, (frame) => btw.applyRecordFrame(frame));
			if (result instanceof Error) throw result;
			return result;
		},
		flash: (level, message) => flashes.push(`${level}:${message}`),
		notice: (level, message) => notices.push(`${level}:${message}`),
		copy: async () => {}
	});
	return { btw, sent, flashes, notices };
}

describe('SessionBtw', () => {
	it('domanda nuova: il btw_record arriva prima della risposta e seleziona l\u2019argomento', async () => {
		const { btw, sent } = harness((command, emit) => {
			if (command.type === 'get_btw_history') return { records: [] };
			const started = record({ id: 'r1', question: command.question ?? '' });
			emit(started); // omp scrive il frame di avvio prima della response
			return { record: started };
		});
		btw.setOpen(true);
		assert.equal(btw.open, true);
		const ok = await btw.ask('  Quanto manca?  ');
		assert.equal(ok, true);
		assert.deepEqual(sent.at(-1), { type: 'btw', question: 'Quanto manca?' });
		assert.equal(btw.selectedId, 'r1');
		assert.equal(btw.pending, null);
		assert.equal(btw.busy, true);
		btw.applyDeltaFrame('r1', 'Due passi.');
		btw.applyRecordFrame(record({ id: 'r1', question: 'Quanto manca?', answer: 'Due passi.', status: 'complete' }));
		assert.equal(btw.busy, false);
		assert.equal(btw.selected?.answer, 'Due passi.');
	});

	it('approfondimento nello stesso argomento con recordId', async () => {
		const { btw, sent } = harness(() => ({
			record: record({
				id: 'r1',
				status: 'complete',
				answer: 'A',
				followUps: [{ question: 'E poi?', answer: '', status: 'running', createdAt: T0, updatedAt: T0 }]
			})
		}));
		btw.records = [record({ id: 'r1', status: 'complete', answer: 'A' })];
		btw.selectTopic('r1');
		await btw.ask('E poi?');
		assert.deepEqual(sent.at(-1), { type: 'btw', question: 'E poi?', recordId: 'r1' });
		assert.equal(btw.selectedRunning, true);
	});

	it('una domanda alla volta: la seconda non parte', async () => {
		const { btw, sent, flashes } = harness(() => ({ record: record({ id: 'r1' }) }));
		btw.records = [record({ id: 'r1' })];
		const ok = await btw.ask('Altra domanda');
		assert.equal(ok, false);
		assert.equal(sent.length, 0);
		assert.equal(flashes.length, 1);
	});

	it('omp vecchio: la sonda spegne il pulsante e /btw lascia un avviso, mai il terminale', async () => {
		const { btw, notices } = harness(() => Object.assign(new Error('Unknown command: get_btw_history'), {}));
		await btw.loadHistory();
		assert.equal(btw.supported, false);
		btw.setOpen(true);
		assert.equal(btw.open, false);
		assert.equal(notices.length, 1);
		assert.doesNotMatch(notices[0], /terminal/i);
		assert.equal(await btw.ask('ciao'), false);
	});

	it('errore di invio: la domanda torna nel campo', async () => {
		const { btw, flashes } = harness(() => new Error('No active model available for /btw.'));
		await btw.ask('Perché?');
		assert.equal(btw.draft, 'Perché?');
		assert.equal(btw.pending, null);
		assert.match(flashes[0], /^error:/);
	});

	it('Esc lascia la riga nel vassoio; la X la toglie senza annullare', () => {
		const { btw, sent } = harness(() => ({}));
		btw.records = [record({ id: 'r1' })];
		btw.selectedId = 'r1';
		btw.open = true;
		assert.equal(btw.trayRecord, null);
		btw.setOpen(false);
		assert.equal(btw.trayRecord?.id, 'r1');
		btw.dismissTray();
		assert.equal(btw.trayRecord, null);
		assert.equal(btw.records.length, 1);
		assert.equal(sent.length, 0);
	});

	it('annulla solo l\u2019argomento che sta rispondendo', async () => {
		const { btw, sent } = harness(() => ({ cancelled: true }));
		btw.records = [record({ id: 'r1' })];
		btw.selectedId = 'r1';
		await btw.cancel();
		assert.deepEqual(sent, [{ type: 'btw_cancel', recordId: 'r1' }]);
	});

	it('«Usa nel messaggio» prepara la citazione e chiude il riquadro', () => {
		const { btw } = harness(() => ({}));
		btw.records = [
			record({
				id: 'r1',
				status: 'complete',
				answer: 'Prima risposta',
				followUps: [{ question: 'E se?', answer: 'Funzionerebbe.', status: 'complete', createdAt: T0, updatedAt: T0 }]
			})
		];
		btw.selectedId = 'r1';
		btw.open = true;
		assert.equal(btw.useInMessage(), true);
		assert.equal(btw.open, false);
		assert.equal(btw.quote?.answer, 'Funzionerebbe.');
		assert.match(btw.quote?.markdown ?? '', /^> \*\*.+\*\* — «Perché quotaStore usa una Map\?»/);
		btw.clearQuote();
		assert.equal(btw.quote, null);
	});

	it('cambio di sessione: storico e selezione si azzerano, la citazione resta', () => {
		const { btw } = harness(() => ({}));
		btw.records = [record({ id: 'r1', status: 'complete', answer: 'x' })];
		btw.selectedId = 'r1';
		btw.useInMessage();
		btw.resetForSession();
		assert.deepEqual(btw.records, []);
		assert.equal(btw.selectedId, null);
		assert.ok(btw.quote);
	});
});

describe('/btw nel guscio', () => {
	it('viene sempre intercettato, con o senza domanda', () => {
		assert.deepEqual(routeBtwSlash('/btw'), { kind: 'btw', question: '' });
		assert.deepEqual(routeBtwSlash('  /BTW  perché\n  la Map?  '), { kind: 'btw', question: 'perché\n  la Map?' });
		assert.equal(routeBtwSlash('/btwx ciao'), null);
		assert.equal(routeBtwSlash('/tree'), null);
		assert.deepEqual(routeComposerSubmit('/btw perché la Map?'), { kind: 'studio', raw: '/btw perché la Map?' });
	});
});
