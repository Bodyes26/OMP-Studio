import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	checkLabEventEnvelope,
	compareLabRevisions,
	envelopeMatchesObservedRevision,
	isNewerLabRevision,
	labPrototypeRelativePath,
	latestLabRevision,
	latestRenderableLabRevision,
	parseLabEventEnvelope,
	parseLabPrototypeLocation,
	parseLabPrototypeManifest,
	parseLabRendererCommand,
	parseLabRevision,
	rendererMessageMatchesRevision,
	sameLabRevision,
	sortLabRevisions,
	type LabEventKind,
	type LabRevision,
	type LabRevisionState
} from '../src/lib/lab/contracts.ts';

const BASE_ENVELOPE = {
	projectKey: 'C:/repos/omp-studio-app',
	prototypeId: 'tabella-pratiche',
	sessionId: 'lab-session-7',
	requestId: 'req-42'
};

function revision(
	id: string,
	sequence: number,
	options: { createdAt?: number; state?: LabRevisionState; prototypeId?: string } = {}
): LabRevision {
	return {
		id,
		prototypeId: options.prototypeId ?? 'tabella-pratiche',
		sequence,
		createdAt: options.createdAt ?? sequence * 1000,
		state: options.state ?? 'rendering-ready',
		requestId: `req-${sequence}`
	};
}

describe('Contratti del Laboratorio — involucro eventi', () => {
	it('rifiuta rendering, selezione e verifica senza revisionId', () => {
		for (const kind of ['rendering', 'selection', 'verification'] satisfies LabEventKind[]) {
			const checked = checkLabEventEnvelope({ ...BASE_ENVELOPE, kind });
			assert.equal(checked.ok, false, `l'evento '${kind}' senza revisione deve essere rifiutato`);
			if (!checked.ok) assert.equal(checked.code, 'missing-revision');
			assert.equal(parseLabEventEnvelope({ ...BASE_ENVELOPE, kind }), null);
		}
	});

	it('accetta gli stessi eventi quando indicano la revisione osservata', () => {
		const checked = checkLabEventEnvelope({ ...BASE_ENVELOPE, kind: 'selection', revisionId: 'rev-3' });
		assert.equal(checked.ok, true);
		if (checked.ok) {
			assert.equal(checked.value.revisionId, 'rev-3');
			assert.equal(checked.value.prototypeId, 'tabella-pratiche');
		}
	});

	it('non impone la revisione a chat, abort e contabilizzazione', () => {
		for (const kind of ['prompt', 'steering', 'abort', 'usage', 'transcript'] satisfies LabEventKind[]) {
			const parsed = parseLabEventEnvelope({ ...BASE_ENVELOPE, kind });
			assert.notEqual(parsed, null, `l'evento '${kind}' non deve richiedere una revisione`);
			assert.equal(parsed?.revisionId, undefined);
		}
	});

	it('rifiuta una revisione presente ma vuota invece di ignorarla', () => {
		const checked = checkLabEventEnvelope({ ...BASE_ENVELOPE, kind: 'rendering', revisionId: '' });
		assert.equal(checked.ok, false);
		if (!checked.ok) assert.equal(checked.code, 'invalid-revision');
	});

	it('richiede progetto, sessione e richiesta con motivo esplicito', () => {
		const cases: Array<[Record<string, unknown>, string]> = [
			[{ ...BASE_ENVELOPE, kind: 'prompt', projectKey: '' }, 'missing-project'],
			[{ ...BASE_ENVELOPE, kind: 'prompt', sessionId: undefined }, 'missing-session'],
			[{ ...BASE_ENVELOPE, kind: 'prompt', requestId: '' }, 'missing-request'],
			[{ ...BASE_ENVELOPE, kind: 'non-esiste' }, 'unknown-kind'],
			[{ ...BASE_ENVELOPE, kind: 'prompt', prototypeId: '../altro' }, 'invalid-prototype-id'],
			[{ ...BASE_ENVELOPE, kind: 'prompt', prototypeId: 'C:/temp/x' }, 'invalid-prototype-id'],
			[{ ...BASE_ENVELOPE, kind: 'prompt', prototypeId: 'con' }, 'invalid-prototype-id']
		];
		for (const [payload, expected] of cases) {
			const checked = checkLabEventEnvelope(payload);
			assert.equal(checked.ok, false, `atteso rifiuto per ${expected}`);
			if (!checked.ok) assert.equal(checked.code, expected);
		}
		assert.equal(checkLabEventEnvelope(null).ok, false);
		assert.equal(checkLabEventEnvelope([BASE_ENVELOPE]).ok, false);
	});

	it('scarta un evento di rendering arrivato dopo il cambio di revisione', () => {
		const stale = parseLabEventEnvelope({ ...BASE_ENVELOPE, kind: 'rendering', revisionId: 'rev-2' });
		const chat = parseLabEventEnvelope({ ...BASE_ENVELOPE, kind: 'prompt' });
		assert.notEqual(stale, null);
		assert.notEqual(chat, null);
		assert.equal(envelopeMatchesObservedRevision(stale!, 'rev-3'), false);
		assert.equal(envelopeMatchesObservedRevision(stale!, 'rev-2'), true);
		// La chat non e' legata all'anteprima: resta valida anche senza revisione osservata.
		assert.equal(envelopeMatchesObservedRevision(chat!, undefined), true);
	});
});

describe('Contratti del Laboratorio — revisioni', () => {
	it('distingue revisioni di prototipi diversi con lo stesso id', () => {
		const a = revision('rev-1', 1);
		const b = revision('rev-1', 1, { prototypeId: 'form-quote' });
		assert.equal(sameLabRevision(a, { ...a }), true);
		assert.equal(sameLabRevision(a, b), false);
		assert.equal(sameLabRevision(a, revision('rev-2', 2)), false);
	});

	it('ordina per sequenza, poi per istante, poi per id', () => {
		const first = revision('rev-a', 1);
		// Id in ordine inverso rispetto all'istante: cosi' il confronto passa
		// soltanto se `createdAt` viene davvero considerato prima dell'id.
		const earlier = revision('rev-z', 2, { createdAt: 5000 });
		const later = revision('rev-b', 2, { createdAt: 9000 });
		const sameInstant = revision('rev-c', 2, { createdAt: 9000 });
		// Sequenza piu' alta ma istante piu' vecchio: comanda la sequenza.
		const nextSequence = revision('rev-a2', 3, { createdAt: 1 });

		assert.ok(compareLabRevisions(first, earlier) < 0);
		assert.ok(compareLabRevisions(earlier, later) < 0);
		assert.ok(compareLabRevisions(later, earlier) > 0);
		assert.ok(compareLabRevisions(later, sameInstant) < 0);
		assert.ok(compareLabRevisions(later, nextSequence) < 0);
		assert.equal(compareLabRevisions(first, { ...first }), 0);
		assert.equal(isNewerLabRevision(earlier, first), true);
		assert.equal(isNewerLabRevision(first, earlier), false);
	});

	it('produce lo stesso ordine da qualsiasi permutazione e non muta l\'ingresso', () => {
		const source = [revision('rev-c', 3), revision('rev-a', 1), revision('rev-b', 2)];
		const shuffled = [source[1], source[0], source[2]];
		const sorted = sortLabRevisions(source);

		assert.deepEqual(
			sorted.map((r) => r.id),
			['rev-a', 'rev-b', 'rev-c']
		);
		assert.deepEqual(
			sortLabRevisions(shuffled).map((r) => r.id),
			sorted.map((r) => r.id)
		);
		assert.deepEqual(
			source.map((r) => r.id),
			['rev-c', 'rev-a', 'rev-b']
		);
	});

	it('separa l\'ultima revisione dall\'ultima anteprima valida', () => {
		const revisions = [
			revision('rev-1', 1, { state: 'verified' }),
			revision('rev-2', 2, { state: 'rendering-ready' }),
			revision('rev-3', 3, { state: 'failed' }),
			revision('rev-4', 4, { state: 'interrupted' })
		];
		assert.equal(latestLabRevision(revisions)?.id, 'rev-4');
		assert.equal(latestRenderableLabRevision(revisions)?.id, 'rev-2');
		assert.equal(latestLabRevision([]), null);
		assert.equal(latestRenderableLabRevision([revisions[2]]), null);
	});

	it('rifiuta revisioni senza ordine utilizzabile o con stato sconosciuto', () => {
		const valid = { ...revision('rev-1', 1), parentId: 'rev-0' };
		assert.deepEqual(parseLabRevision(valid), valid);
		assert.equal(parseLabRevision({ ...valid, sequence: 0 }), null);
		assert.equal(parseLabRevision({ ...valid, sequence: 1.5 }), null);
		assert.equal(parseLabRevision({ ...valid, state: 'in-corso' }), null);
		assert.equal(parseLabRevision({ ...valid, prototypeId: '../fuori' }), null);
	});
});

describe('Contratti del Laboratorio — collocazione, manifest e renderer', () => {
	it('confina il prototipo in proto/<id>', () => {
		assert.equal(labPrototypeRelativePath('tabella-pratiche'), 'proto/tabella-pratiche');
		assert.equal(labPrototypeRelativePath('../fuori'), null);
		assert.deepEqual(parseLabPrototypeLocation({ kind: 'project', projectKey: 'p', relativePath: 'proto/tab' }), {
			kind: 'project',
			projectKey: 'p',
			relativePath: 'proto/tab'
		});
		assert.equal(parseLabPrototypeLocation({ kind: 'project', projectKey: 'p', relativePath: 'src/lib' }), null);
		assert.equal(
			parseLabPrototypeLocation({ kind: 'project', projectKey: 'p', relativePath: 'proto/../src' }),
			null
		);
		assert.equal(parseLabPrototypeLocation({ kind: 'project', projectKey: 'p', relativePath: 'proto/a/b' }), null);
	});

	it('accetta solo dipendenze fissate a una versione esatta', () => {
		const manifest = {
			id: 'tabella-pratiche',
			title: 'Tabella pratiche',
			brief: 'Tre alternative di densita\'.',
			templateVersion: '1.0.0',
			dependencies: [{ name: 'react', version: '19.2.8' }]
		};
		assert.notEqual(parseLabPrototypeManifest(manifest), null);
		assert.equal(parseLabPrototypeManifest({ ...manifest, dependencies: [{ name: 'react', version: 'latest' }] }), null);
		assert.equal(parseLabPrototypeManifest({ ...manifest, dependencies: [{ name: 'react', version: '^19.2.8' }] }), null);
		assert.equal(
			parseLabPrototypeManifest({
				...manifest,
				dependencies: [
					{ name: 'react', version: '19.2.8' },
					{ name: 'react', version: '18.3.1' }
				]
			}),
			null
		);
	});

	it('lega ogni comando del renderer alla revisione osservata', () => {
		const command = parseLabRendererCommand({ type: 'inspect_point', revisionId: 'rev-3', x: 12, y: 40 });
		assert.notEqual(command, null);
		assert.equal(rendererMessageMatchesRevision(command!, 'rev-3'), true);
		assert.equal(rendererMessageMatchesRevision(command!, 'rev-4'), false);
		assert.equal(parseLabRendererCommand({ type: 'inspect_point', x: 12, y: 40 }), null);
	});

	it('rifiuta navigazioni fuori dal prototipo e politiche di rete ambigue', () => {
		assert.equal(parseLabRendererCommand({ type: 'navigate', revisionId: 'r', route: 'https://example.com' }), null);
		assert.equal(parseLabRendererCommand({ type: 'navigate', revisionId: 'r', route: '//example.com' }), null);
		assert.notEqual(parseLabRendererCommand({ type: 'navigate', revisionId: 'r', route: '/passo/2' }), null);
		assert.equal(
			parseLabRendererCommand({
				type: 'set_network_policy',
				revisionId: 'r',
				policy: { mode: 'blocked', allowedOrigins: ['https://example.com'] }
			}),
			null
		);
		assert.equal(
			parseLabRendererCommand({ type: 'capture', revisionId: 'r', target: 'element' }),
			null,
			'la cattura di un elemento senza selettore non e\' delimitata'
		);
	});
});
