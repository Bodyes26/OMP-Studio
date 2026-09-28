import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	segmentsToWireText,
	parsePlainTextToSegments,
	serializeEditorDom,
	renderSegmentsToDom,
	NBSP,
	type ComposerSegment
} from '../src/lib/agent/composerDoc.ts';

describe('composerDoc: serializzazione, parsing e roundtrip', () => {
	it('roundtrip con percorsi con spazi tra virgolette', () => {
		const originalText = 'Esamina il modulo @"Cruscotto PSR/Pagina.aspx" e correggi il bug';
		const segs = parsePlainTextToSegments(originalText);

		assert.deepEqual(segs, [
			{ t: 'text', s: 'Esamina il modulo ' },
			{ t: 'file', path: 'Cruscotto PSR/Pagina.aspx' },
			{ t: 'text', s: ' e correggi il bug' }
		]);

		const wire = segmentsToWireText(segs);
		assert.equal(wire, originalText);
	});

	it('roundtrip con NBSP convertiti in spazi normali', () => {
		const textWithNbsp = `Prima${NBSP}riga con${NBSP}spazi fissi`;
		const segs = parsePlainTextToSegments(textWithNbsp);

		assert.deepEqual(segs, [{ t: 'text', s: 'Prima riga con spazi fissi' }]);

		const wire = segmentsToWireText(segs);
		assert.equal(wire, 'Prima riga con spazi fissi');
	});

	it('roundtrip con ritorni a capo (newlines)', () => {
		const multiline = 'Prima riga\nSeconda riga con @src/lib/auth.ts\nTerza riga';
		const segs = parsePlainTextToSegments(multiline);

		assert.deepEqual(segs, [
			{ t: 'text', s: 'Prima riga\nSeconda riga con ' },
			{ t: 'file', path: 'src/lib/auth.ts' },
			{ t: 'text', s: '\nTerza riga' }
		]);

		const wire = segmentsToWireText(segs);
		assert.equal(wire, multiline);
	});

	it('roundtrip con badge adiacenti', () => {
		const segs: ComposerSegment[] = [
			{ t: 'file', path: 'src/a.ts' },
			{ t: 'file', path: 'src/b.ts' },
			{ t: 'file', path: 'Documenti UMA/modulo.pdf' }
		];

		const wire = segmentsToWireText(segs);
		assert.equal(wire, '@src/a.ts @src/b.ts @"Documenti UMA/modulo.pdf"');

		const parsed = parsePlainTextToSegments(wire);
		assert.deepEqual(parsed, [
			{ t: 'file', path: 'src/a.ts' },
			{ t: 'text', s: ' ' },
			{ t: 'file', path: 'src/b.ts' },
			{ t: 'text', s: ' ' },
			{ t: 'file', path: 'Documenti UMA/modulo.pdf' }
		]);
	});

	it('roundtrip con comando a inizio messaggio', () => {
		const cmdText = '/compact';
		const segs = parsePlainTextToSegments(cmdText);
		assert.deepEqual(segs, [{ t: 'cmd', name: 'compact' }]);
		assert.equal(segmentsToWireText(segs), '/compact');
	});

	it('gestione delle skill: formattazione come /skill:nome su wire', () => {
		const isSkill = (name: string) => name === 'review' || name === 'deploy';

		const text = '/review arg1 arg2';
		const segs = parsePlainTextToSegments(text, isSkill);
		assert.deepEqual(segs, [
			{ t: 'cmd', name: 'review' },
			{ t: 'text', s: ' arg1 arg2' }
		]);

		const wire = segmentsToWireText(segs, isSkill);
		assert.equal(wire, '/skill:review arg1 arg2');

		const parsedFromWire = parsePlainTextToSegments(wire, isSkill);
		assert.deepEqual(parsedFromWire, [
			{ t: 'cmd', name: 'review' },
			{ t: 'text', s: ' arg1 arg2' }
		]);
	});
});

describe('composerDoc: serializzazione e rendering DOM', () => {
	class MockNode {
		nodeType: number;
		textContent: string | null = '';
		childNodes: MockNode[] = [];
		parentNode: MockNode | null = null;
		dataset: Record<string, string> = {};
		tagName = '';
		className = '';
		title = '';
		innerHTML = '';

		constructor(nodeType: number, textContent: string = '') {
			this.nodeType = nodeType;
			this.textContent = textContent;
		}

		appendChild(child: MockNode) {
			child.parentNode = this;
			this.childNodes.push(child);
			return child;
		}
	}

	const origDoc = globalThis.document;
	const origNode = globalThis.Node;
	const origEl = globalThis.HTMLElement;

	function setupDomMock() {
		const globalEnv = globalThis as unknown as {
			Node: unknown;
			HTMLElement: unknown;
			document: unknown;
		};

		globalEnv.Node = {
			TEXT_NODE: 3,
			ELEMENT_NODE: 1
		};
		globalEnv.HTMLElement = MockNode;
		globalEnv.document = {
			createElement: (tag: string) => {
				const el = new MockNode(1);
				el.tagName = tag.toUpperCase();
				return el;
			},
			createTextNode: (text: string) => new MockNode(3, text)
		};
	}

	function teardownDomMock() {
		globalThis.document = origDoc;
		globalThis.Node = origNode;
		globalThis.HTMLElement = origEl;
	}

	it('serializza DOM con testo, badge file e ritorni a capo', () => {
		setupDomMock();
		try {
			const container = document.createElement('div') as unknown as HTMLElement;

			const t1 = document.createTextNode(`Verifica${NBSP}`);
			container.appendChild(t1);

			const fileBadge = document.createElement('span') as unknown as HTMLElement;
			fileBadge.dataset.kind = 'file';
			fileBadge.dataset.value = 'src/app.ts';
			container.appendChild(fileBadge);

			const br = document.createElement('br') as unknown as HTMLElement;
			container.appendChild(br);

			const t2 = document.createTextNode('grazie');
			container.appendChild(t2);

			const segs = serializeEditorDom(container);
			assert.deepEqual(segs, [
				{ t: 'text', s: 'Verifica ' },
				{ t: 'file', path: 'src/app.ts' },
				{ t: 'text', s: '\ngrazie' }
			]);
		} finally {
			teardownDomMock();
		}
	});

	it('renderizza segmenti nel DOM e li riserializza identici', () => {
		setupDomMock();
		try {
			const container = document.createElement('div') as unknown as HTMLElement;
			const inputSegs: ComposerSegment[] = [
				{ t: 'cmd', name: 'review' },
				{ t: 'text', s: ' per ' },
				{ t: 'file', path: 'src/lib/index.ts' }
			];

			renderSegmentsToDom(inputSegs, container);
			const reserialized = serializeEditorDom(container);

			assert.deepEqual(reserialized, inputSegs);
		} finally {
			teardownDomMock();
		}
	});
});
