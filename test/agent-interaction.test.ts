/**
 * Test di unita' per l'interazione dell'agente:
 * 1. Rendering a finestre dello storico messaggi (299, 300, 301, 600, 601 entry).
 * 2. Contratti di clamping, slicing, hasEarlier e preservazione viewport.
 * 3. Unico owner globale delle scorciatoie Alt+H / Alt+K / F1 (un solo toggle per evento).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	RENDER_WINDOW,
	clampVisibleCount,
	sliceVisibleEntries,
	hasEarlierEntries,
	computeViewportScrollDelta
} from '../src/lib/agent/transcriptWindow.ts';
import {
	isShortcutsHelpKey,
	isGlobalShellShortcut,
	type KeyboardEventLike
} from '../src/lib/shortcuts/shortcutMatch.ts';

function makeMockEntries(count: number): Array<{ id: number; text: string }> {
	const result = new Array(count);
	for (let i = 0; i < count; i++) {
		result[i] = { id: i + 1, text: `Messaggio ${i + 1}` };
	}
	return result;
}

describe('Transcript Windowing: 299, 300, 301, 600, 601 entry', () => {
	it('con 299 entry mostra tutte le entry senza pulsante precedenti', () => {
		const entries = makeMockEntries(299);
		const initialVisibleCount = RENDER_WINDOW; // 300

		// Tutte le 299 entry sono visibili
		const visible = sliceVisibleEntries(entries, initialVisibleCount);
		assert.equal(visible.length, 299);
		assert.equal(visible[0].id, 1);
		assert.equal(visible[298].id, 299);

		// Non ci sono entry precedenti nascoste
		assert.equal(hasEarlierEntries(entries.length, initialVisibleCount), false);

		// Clamp non supera la lunghezza reale
		const clamped = clampVisibleCount(entries.length, initialVisibleCount, RENDER_WINDOW);
		assert.equal(clamped, 299);
	});

	it('con esattamente 300 entry (limite finestra) mostra tutto senza pulsante precedenti', () => {
		const entries = makeMockEntries(300);
		const initialVisibleCount = RENDER_WINDOW; // 300

		const visible = sliceVisibleEntries(entries, initialVisibleCount);
		assert.equal(visible.length, 300);
		assert.equal(visible[0].id, 1);
		assert.equal(visible[299].id, 300);

		// hasEarlier e' false al confine esatto di 300
		assert.equal(hasEarlierEntries(entries.length, initialVisibleCount), false);

		const clamped = clampVisibleCount(entries.length, initialVisibleCount, RENDER_WINDOW);
		assert.equal(clamped, 300);
	});

	it('con 301 entry mostra le ultime 300 e attiva hasEarlier; showEarlier scopre l\'entry nascosta con clamp a 301', () => {
		const entries = makeMockEntries(301);
		const initialVisibleCount = RENDER_WINDOW; // 300

		// Inizialmente mostra solo le ultime 300 (da id=2 a id=301)
		const visible1 = sliceVisibleEntries(entries, initialVisibleCount);
		assert.equal(visible1.length, 300);
		assert.equal(visible1[0].id, 2);
		assert.equal(visible1[299].id, 301);

		// 1 entry nascosta
		assert.equal(hasEarlierEntries(entries.length, initialVisibleCount), true);

		// Step 1 di showEarlier: clamp a 301 (non eccede la dimensione reale)
		const countAfterStep1 = clampVisibleCount(entries.length, initialVisibleCount, RENDER_WINDOW);
		assert.equal(countAfterStep1, 301);

		// Ora tutte le 301 entry sono visibili
		const visible2 = sliceVisibleEntries(entries, countAfterStep1);
		assert.equal(visible2.length, 301);
		assert.equal(visible2[0].id, 1);
		assert.equal(visible2[300].id, 301);

		// hasEarlier diventa false
		assert.equal(hasEarlierEntries(entries.length, countAfterStep1), false);
	});

	it('con 600 entry mostra le ultime 300; un click a showEarlier porta il conteggio a 600 e mostra tutto', () => {
		const entries = makeMockEntries(600);
		const initialVisibleCount = RENDER_WINDOW; // 300

		// Inizialmente ultime 300 (da id=301 a id=600)
		const visible1 = sliceVisibleEntries(entries, initialVisibleCount);
		assert.equal(visible1.length, 300);
		assert.equal(visible1[0].id, 301);
		assert.equal(visible1[299].id, 600);
		assert.equal(hasEarlierEntries(entries.length, initialVisibleCount), true);

		// Step 1: 300 -> 600
		const countAfterStep1 = clampVisibleCount(entries.length, initialVisibleCount, RENDER_WINDOW);
		assert.equal(countAfterStep1, 600);

		const visible2 = sliceVisibleEntries(entries, countAfterStep1);
		assert.equal(visible2.length, 600);
		assert.equal(visible2[0].id, 1);
		assert.equal(visible2[599].id, 600);

		// hasEarlier diventa false
		assert.equal(hasEarlierEntries(entries.length, countAfterStep1), false);
	});

	it('con 601 entry mostra 300, poi 600 al primo incremento, poi 601 al secondo', () => {
		const entries = makeMockEntries(601);
		const initialVisibleCount = RENDER_WINDOW; // 300

		// Stato iniziale (300 visibili, 301 nascoste)
		const visible1 = sliceVisibleEntries(entries, initialVisibleCount);
		assert.equal(visible1.length, 300);
		assert.equal(visible1[0].id, 302);
		assert.equal(visible1[299].id, 601);
		assert.equal(hasEarlierEntries(entries.length, initialVisibleCount), true);

		// Step 1: 300 -> 600 (600 visibili, 1 nascosta)
		const count1 = clampVisibleCount(entries.length, initialVisibleCount, RENDER_WINDOW);
		assert.equal(count1, 600);
		assert.equal(hasEarlierEntries(entries.length, count1), true);

		const visible2 = sliceVisibleEntries(entries, count1);
		assert.equal(visible2.length, 600);
		assert.equal(visible2[0].id, 2);
		assert.equal(visible2[599].id, 601);

		// Step 2: 600 -> 601 (tutte le 601 visibili, 0 nascoste)
		const count2 = clampVisibleCount(entries.length, count1, RENDER_WINDOW);
		assert.equal(count2, 601);
		assert.equal(hasEarlierEntries(entries.length, count2), false);

		const visible3 = sliceVisibleEntries(entries, count2);
		assert.equal(visible3.length, 601);
		assert.equal(visible3[0].id, 1);
		assert.equal(visible3[600].id, 601);
	});

	it('calcola correttamente il delta di scroll per preservare la viewport durante il prepend', () => {
		// Prima del caricamento: altezza totale 12000px
		// Dopo il caricamento: altezza totale 25000px (13000px aggiunti in cima)
		const delta = computeViewportScrollDelta(12000, 25000);
		assert.equal(delta, 13000);

		// Nessuna crescita: delta 0
		assert.equal(computeViewportScrollDelta(10000, 10000), 0);
		assert.equal(computeViewportScrollDelta(10000, 8000), 0);
	});
});

describe('Shortcuts: unico owner globale e prevenzione doppi toggle', () => {
	it('riconosce correttamente le scorciatoie di aiuto Alt+H, Alt+K, F1 e Ctrl+Alt+H', () => {
		const altH: KeyboardEventLike = { key: 'h', code: 'KeyH', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const altK: KeyboardEventLike = { key: 'k', code: 'KeyK', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const f1: KeyboardEventLike = { key: 'F1', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
		const ctrlAltH: KeyboardEventLike = { key: 'h', code: 'KeyH', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false };

		assert.equal(isShortcutsHelpKey(altH), true);
		assert.equal(isShortcutsHelpKey(altK), true);
		assert.equal(isShortcutsHelpKey(f1), true);
		assert.equal(isShortcutsHelpKey(ctrlAltH), true);
	});

	it('non confonde altre scorciatoie TUI con la guida di aiuto', () => {
		const altB: KeyboardEventLike = { key: 'b', code: 'KeyB', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const altF: KeyboardEventLike = { key: 'f', code: 'KeyF', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const ctrlC: KeyboardEventLike = { key: 'c', code: 'KeyC', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false };
		const shiftAltH: KeyboardEventLike = { key: 'H', code: 'KeyH', altKey: true, ctrlKey: false, metaKey: false, shiftKey: true };

		assert.equal(isShortcutsHelpKey(altB), false);
		assert.equal(isShortcutsHelpKey(altF), false);
		assert.equal(isShortcutsHelpKey(ctrlC), false);
		assert.equal(isShortcutsHelpKey(shiftAltH), false);
	});

	it('simula la propagazione terminale -> window garantendo esattamente 1 toggle per evento', () => {
		let toggleCount = 0;
		let prevented = false;

		// Mock del terminal custom key event handler
		function terminalCustomKeyHandler(event: KeyboardEventLike): boolean {
			if (isShortcutsHelpKey(event)) {
				// Il terminale NON deve piu' chiamare toggle() direttamente,
				// ma restituire false per lasciare che l'evento risalga al window listener
				return false;
			}
			if (isGlobalShellShortcut(event)) {
				return false;
			}
			return true;
		}

		// Mock del window handler in +page.svelte (unico owner)
		function windowKeyHandler(event: KeyboardEventLike) {
			if (isShortcutsHelpKey(event)) {
				prevented = true;
				toggleCount++;
				return;
			}
		}

		// Simulazione pressione Alt+H mentre il terminale ha il focus
		const altHEvent: KeyboardEventLike = { key: 'h', code: 'KeyH', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const handledByTerminal = terminalCustomKeyHandler(altHEvent);
		assert.equal(handledByTerminal, false, 'Il terminale deve cedere l\'evento al window handler');

		// L'evento risale al window
		windowKeyHandler(altHEvent);
		assert.equal(toggleCount, 1, 'Deve verificarsi esattamente UN toggle');
		assert.equal(prevented, true, 'preventDefault deve essere chiamato');

		// Simulazione tasto normale o scorciatoia TUI (es. Alt+B per muoversi tra parole in bash)
		prevented = false;
		const altBEvent: KeyboardEventLike = { key: 'b', code: 'KeyB', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const handledAltB = terminalCustomKeyHandler(altBEvent);
		assert.equal(handledAltB, true, 'Il terminale deve consumare Alt+B senza passarlo a Studio');
		assert.equal(toggleCount, 1, 'Il conteggio dei toggle non deve cambiare');
	});
});
