import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCaretCoordinates, cleanupCaretMirror } from '../src/lib/agent/components/caretCoordinates.ts';

describe('Smooth cursor & Caret coordinates', () => {
	it('restituisce coordinate di fallback sicure se eseguito fuori dal DOM', () => {
		const coords = getCaretCoordinates(null as unknown as HTMLTextAreaElement, 0);
		assert.equal(typeof coords.top, 'number');
		assert.equal(typeof coords.left, 'number');
		assert.equal(typeof coords.height, 'number');
		assert.equal(typeof coords.lineHeight, 'number');
		assert.ok(coords.height > 0);
	});

	it('gestisce mock di elemento textarea e calcola correttamente i layout', () => {
		// Mock essenziale di window, document e getComputedStyle per ambiente node:test
		const originalWindow = globalThis.window;
		const originalDocument = globalThis.document;

		interface MockSpan {
			textContent: string;
			offsetLeft: number;
			offsetTop: number;
			offsetHeight: number;
		}

		interface MockDiv {
			id: string;
			style: {
				setProperty: (k: string, v: string) => void;
			};
			setAttribute: (k: string, v: string) => void;
			textContent: string;
			appendChild: (child: MockSpan) => void;
			_child: MockSpan | null;
			parentNode: { removeChild: (node: unknown) => void } | null;
			remove: () => void;
		}

		const mockMirrorDiv: MockDiv = {
			id: '',
			style: {
				setProperty: () => {}
			},
			setAttribute: () => {},
			textContent: '',
			_child: null,
			parentNode: null,
			appendChild(child: MockSpan) {
				this._child = child;
			},
			remove() {
				if (this.parentNode) {
					this.parentNode.removeChild(this);
				}
			}
		};

		const mockBody = {
			appendChild(node: { parentNode: unknown }) {
				node.parentNode = mockBody;
				return node;
			},
			removeChild(node: { parentNode: unknown }) {
				node.parentNode = null;
				return node;
			}
		};

		const globalEnv = globalThis as unknown as {
			document: unknown;
			window: unknown;
		};

		try {
			globalEnv.document = {
				createElement(tag: string) {
					if (tag === 'div') return mockMirrorDiv;
					if (tag === 'span') {
						return {
							textContent: '',
							offsetLeft: 42,
							offsetTop: 10,
							offsetHeight: 19
						};
					}
					return {};
				},
				body: mockBody
			};

			globalEnv.window = {
				getComputedStyle: () => ({
					boxSizing: 'border-box',
					fontSize: '13px',
					lineHeight: '18.85px',
					borderLeftWidth: '0px',
					borderRightWidth: '0px',
					getPropertyValue: () => ''
				})
			};

			const mockTextarea = {
				nodeName: 'TEXTAREA',
				value: 'Ciao mondo!\nSeconda riga',
				clientWidth: 400,
				offsetWidth: 400,
				scrollTop: 0,
				scrollLeft: 0
			} as unknown as HTMLTextAreaElement;

			const coords = getCaretCoordinates(mockTextarea, 5);

			assert.equal(coords.left, 42);
			assert.equal(coords.top, 10);
			assert.equal(coords.height, 19);
			assert.equal(mockMirrorDiv.textContent, 'Ciao ');
			assert.equal(mockMirrorDiv._child?.textContent, 'm');

			// Test posizione oltre il limite del testo (clamped)
			const coordsClamped = getCaretCoordinates(mockTextarea, 999);
			assert.equal(mockMirrorDiv.textContent, 'Ciao mondo!\nSeconda riga');
			assert.equal(mockMirrorDiv._child?.textContent, '\u200b');
			assert.ok(coordsClamped.height > 0);

			cleanupCaretMirror();
		} finally {
			globalEnv.window = originalWindow;
			globalEnv.document = originalDocument;
		}
	});
});
