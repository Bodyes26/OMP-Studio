/**
 * S6-01 / S6-10: le scorciatoie globali del guscio si sospendono quando una
 * superficie modale e' aperta. La decisione sta in `anyModalSurfaceOpen()`,
 * che legge il DOM invece di un elenco di stati da tenere allineato a mano.
 *
 * Il test usa un finto `document`: le tre fonti (stack di focusTrap, dialog
 * nativo, popover nel top layer) sono le uniche cose che contano.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { anyModalSurfaceOpen, trapFocus } from '../src/lib/focusTrap.ts';

interface FakeElement {
	role?: string;
	open: boolean;
	popoverOpen?: boolean;
	closest(selector: string): FakeElement | null;
	hasAttribute(name: string): boolean;
	getAttribute(name: string): string | null;
	matches(selector: string): boolean;
	addEventListener(): void;
	removeEventListener(): void;
	querySelectorAll(): never[];
	querySelector(): null;
	focus(): void;
	isConnected: boolean;
	checkVisibility?: () => boolean;
	className?: string;
	tagName?: string;
	tabIndex?: number;
}

function fakeElement(patch: Partial<FakeElement> = {}): FakeElement {
	const el: FakeElement = {
		open: false,
		closest: () => null,
		hasAttribute: () => false,
		getAttribute: (name) => (name === 'role' ? (el.role ?? null) : null),
		matches: (selector) => selector === ':popover-open' && el.popoverOpen === true,
		addEventListener: () => {},
		removeEventListener: () => {},
		querySelectorAll: () => [],
		querySelector: () => null,
		focus: () => {},
		isConnected: true,
		...patch
	};
	return el;
}

/** Finto documento con le sole letture usate da `anyModalSurfaceOpen`. */
function installDocument(options: { dialogsOpen?: boolean; popovers?: FakeElement[] } = {}) {
	const popovers = options.popovers ?? [];
	const fakeDocument = {
		hasFocus: () => false,
		querySelector: (selector: string) => (selector === 'dialog[open]' && options.dialogsOpen ? fakeElement() : null),
		querySelectorAll: (selector: string) => (selector === '[popover]' ? popovers : [])
	};
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true, writable: true });
	const previousActive = Object.getOwnPropertyDescriptor(globalThis, 'window');
	// Nessun timer reale: `trapFocus` ne arma uno solo per il fuoco iniziale,
	// che in questo test non deve mai scattare (il finto documento non ha fuoco).
	Object.defineProperty(globalThis, 'window', {
		value: { setTimeout: () => 0, getComputedStyle: () => ({ display: 'flex' }) },
		configurable: true,
		writable: true
	});
	return () => {
		if (previous) Object.defineProperty(globalThis, 'document', previous);
		else Reflect.deleteProperty(globalThis, 'document');
		if (previousActive) Object.defineProperty(globalThis, 'window', previousActive);
		else Reflect.deleteProperty(globalThis, 'window');
	};
}

describe('Superfici modali e scorciatoie del guscio (S6-01, S6-10)', () => {
	const cleanups: Array<() => void> = [];
	after(() => {
		for (const cleanup of cleanups) cleanup();
	});

	it('senza dialoghi aperti nessuna modale blocca le scorciatoie', () => {
		cleanups.push(installDocument());
		assert.equal(anyModalSurfaceOpen(), false);
	});

	it('un dialog nativo aperto sospende le scorciatoie anche se lo stato non e elencato', () => {
		cleanups.push(installDocument({ dialogsOpen: true }));
		assert.equal(anyModalSurfaceOpen(), true);
	});

	it('un popover che si comporta da superficie conta, un tooltip no', () => {
		const surface = fakeElement({ role: 'dialog', popoverOpen: true });
		cleanups.push(installDocument({ popovers: [surface] }));
		assert.equal(anyModalSurfaceOpen(), true);

		const tooltip = fakeElement({ role: 'tooltip', popoverOpen: true });
		cleanups.push(installDocument({ popovers: [tooltip] }));
		assert.equal(anyModalSurfaceOpen(), false);
	});

	it('lo stack di focusTrap conta anche quando il nodo non e un dialog', () => {
		cleanups.push(installDocument());
		// Il finto elemento espone solo cio' che `trapFocus` legge: il cast e'
		// dichiarato una volta qui, non ripetuto dentro il codice in prova.
		const palette = fakeElement({ role: 'dialog' }) as unknown as HTMLElement;
		const trap = trapFocus(palette);
		assert.equal(anyModalSurfaceOpen(), true);
		trap.destroy();
		assert.equal(anyModalSurfaceOpen(), false);
	});
});
