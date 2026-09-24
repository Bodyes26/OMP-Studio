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
	isProjectCycleShortcut,
	type KeyboardEventLike
} from '../src/lib/shortcuts/shortcutMatch.ts';
import { shouldAutoFocusAskCard, isTypingSurface } from '../src/lib/agent/askFocus.ts';

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

	it('riconosce correttamente Ctrl+Tab, Ctrl+Shift+Tab e Cmd+Tab come cambio progetto', () => {
		const ctrlTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false };
		const ctrlShiftTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: true, metaKey: false, shiftKey: true };
		const cmdTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false };
		const cmdShiftTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: false, metaKey: true, shiftKey: true };

		assert.equal(isProjectCycleShortcut(ctrlTab), true);
		assert.equal(isProjectCycleShortcut(ctrlShiftTab), true);
		assert.equal(isProjectCycleShortcut(cmdTab), true);
		assert.equal(isProjectCycleShortcut(cmdShiftTab), true);
	});

	it('non confonde Tab ordinario o Alt+Tab con il cambio progetto', () => {
		const plainTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
		const plainShiftTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: false, metaKey: false, shiftKey: true };
		const altTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
		const ctrlAltTab: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false };

		assert.equal(isProjectCycleShortcut(plainTab), false);
		assert.equal(isProjectCycleShortcut(plainShiftTab), false);
		assert.equal(isProjectCycleShortcut(altTab), false);
		assert.equal(isProjectCycleShortcut(ctrlAltTab), false);
	});

	it('simula propagazione terminale -> window per Ctrl+Tab e ciclo progetti successivo/precedente', () => {
		const projects = ['proj-a', 'proj-b', 'proj-c'];
		let activeId = 'proj-a';

		function cycleProject(direction: 1 | -1) {
			if (projects.length < 2) return;
			const idx = projects.indexOf(activeId);
			const currentIdx = idx >= 0 ? idx : 0;
			const nextIdx = direction === 1
				? (currentIdx + 1) % projects.length
				: (currentIdx - 1 + projects.length) % projects.length;
			activeId = projects[nextIdx];
		}

		function terminalCustomKeyHandler(event: KeyboardEventLike): boolean {
			if (isShortcutsHelpKey(event)) return false;
			if (isGlobalShellShortcut(event)) return false;
			if (isProjectCycleShortcut(event)) return false;
			return true;
		}

		function windowKeyHandler(event: KeyboardEventLike): boolean {
			if (isProjectCycleShortcut(event)) {
				cycleProject(event.shiftKey ? -1 : 1);
				return true;
			}
			return false;
		}

		// 1. Pressione Ctrl+Tab mentre il terminale ha il focus
		const ctrlTabEvent: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false };
		assert.equal(terminalCustomKeyHandler(ctrlTabEvent), false, 'Il terminale deve cedere Ctrl+Tab al window handler');
		assert.equal(windowKeyHandler(ctrlTabEvent), true);
		assert.equal(activeId, 'proj-b', 'Deve passare al progetto successivo (B)');

		// 2. Altro Ctrl+Tab -> passa al terzo
		assert.equal(windowKeyHandler(ctrlTabEvent), true);
		assert.equal(activeId, 'proj-c', 'Deve passare al progetto successivo (C)');

		// 3. Altro Ctrl+Tab -> wrap-around ciclico al primo
		assert.equal(windowKeyHandler(ctrlTabEvent), true);
		assert.equal(activeId, 'proj-a', 'Deve tornare al primo progetto (A)');

		// 4. Ctrl+Shift+Tab -> ciclo all\'indietro
		const ctrlShiftTabEvent: KeyboardEventLike = { key: 'Tab', code: 'Tab', altKey: false, ctrlKey: true, metaKey: false, shiftKey: true };
		assert.equal(terminalCustomKeyHandler(ctrlShiftTabEvent), false, 'Il terminale deve cedere Ctrl+Shift+Tab');
		assert.equal(windowKeyHandler(ctrlShiftTabEvent), true);
		assert.equal(activeId, 'proj-c', 'Deve passare all\'ultimo progetto (C) con shift');
	});

	it('con ordinamento Attività recente (mru), Ctrl+Tab scorre tutti i progetti senza oscillare tra i primi due', () => {
		const projects = [
			{ id: 'proj-a', name: 'Alpha', agentState: 'idle' },
			{ id: 'proj-b', name: 'Beta', agentState: 'idle' },
			{ id: 'proj-c', name: 'Gamma', agentState: 'idle' }
		];
		let activeId = 'proj-a';
		const order = 'mru';

		function setActive(id: string) {
			const idx = projects.findIndex(p => p.id === id);
			if (idx === -1) return;
			// Con la nuova architettura: setActive imposta solo activeId e NON riordina l'array
			activeId = id;
		}

		function cycleProject(direction: 1 | -1) {
			if (projects.length < 2) return;
			const idx = projects.findIndex(p => p.id === activeId);
			const currentIdx = idx >= 0 ? idx : 0;
			const nextIdx = direction === 1
				? (currentIdx + 1) % projects.length
				: (currentIdx - 1 + projects.length) % projects.length;
			setActive(projects[nextIdx].id);
		}

		// Navigazione sequenziale con Ctrl+Tab
		cycleProject(1);
		assert.equal(activeId, 'proj-b', 'Primo Ctrl+Tab: da A a B');
		assert.deepEqual(projects.map(p => p.id), ['proj-a', 'proj-b', 'proj-c'], 'L\'ordine delle tessere resta intatto');

		cycleProject(1);
		assert.equal(activeId, 'proj-c', 'Secondo Ctrl+Tab: da B a C (non rimbalza su A)');
		assert.deepEqual(projects.map(p => p.id), ['proj-a', 'proj-b', 'proj-c'], 'L\'ordine delle tessere resta intatto');

		cycleProject(1);
		assert.equal(activeId, 'proj-a', 'Terzo Ctrl+Tab: da C a A');

		// Un agente si attiva nel progetto C -> passa in prima posizione
		function bringProjectToFront(id: string) {
			if (order !== 'mru') return;
			const idx = projects.findIndex(p => p.id === id);
			if (idx > 0) {
				const [proj] = projects.splice(idx, 1);
				projects.unshift(proj);
			}
		}

		function setAgentState(id: string, state: string) {
			const p = projects.find(proj => proj.id === id);
			if (!p) return;
			const prevState = p.agentState;
			p.agentState = state;
			if (state === 'working' && prevState !== 'working') {
				bringProjectToFront(id);
			}
		}

		setAgentState('proj-c', 'working');
		assert.equal(projects[0].id, 'proj-c', 'Progetto C al lavoro si sposta al primo posto a sinistra');
		assert.deepEqual(projects.map(p => p.id), ['proj-c', 'proj-a', 'proj-b']);
	});

	it('ProjectPicker esclude i progetti aperti dall\'elenco dei candidati locali', () => {
		const openProjects = [
			{ id: '1', canonicalProjectPath: 'C:/repos/proj-a' },
			{ id: '2', canonicalProjectPath: 'C:/repos/proj-b' }
		];
		const openKeys = new Set(openProjects.map(p => p.canonicalProjectPath.toLowerCase()));

		const candidates = [
			{ name: 'proj-a', path: 'C:/repos/proj-a' },
			{ name: 'proj-b', path: 'C:/repos/proj-b' },
			{ name: 'proj-c', path: 'C:/repos/proj-c' }
		];

		const unopened = candidates.filter(c => !openKeys.has(c.path.toLowerCase()));
		assert.equal(unopened.length, 1);
		assert.equal(unopened[0].name, 'proj-c');
	});
});

describe('Gestione Escape e abort: il tasto Escape non interrompe mai lo streaming dell\'agente', () => {
	it('Escape chiude i menu aperti senza invocare abort durante lo streaming', () => {
		let abortCalled = false;
		let menu: string | null = 'role';
		const session = {
			isStreaming: true,
			abort() { abortCalled = true; }
		};

		// Simula la logica aggiornata di handleWindowKeydown in Composer per Escape
		function handleEscape(isShortcutsOpen: boolean, activeMenu: string | null, paletteOpen: boolean) {
			if (isShortcutsOpen) {
				return { closed: 'shortcuts' };
			}
			if (activeMenu) {
				menu = null;
				return { closed: 'menu' };
			}
			if (paletteOpen) {
				return { closed: 'palette' };
			}
			// Nessun abort: Escape non tocca la sessione
			return { closed: null };
		}

		const res1 = handleEscape(false, menu, false);
		assert.equal(res1.closed, 'menu');
		assert.equal(menu, null);
		assert.equal(abortCalled, false, 'Escape con menu aperto non deve chiamare abort');

		// Pressione di Escape a vuoto dentro il progetto durante lo streaming
		const res2 = handleEscape(false, null, false);
		assert.equal(res2.closed, null);
		assert.equal(abortCalled, false, 'Escape a vuoto durante lo streaming NON deve interrompere l\'agente');

		// Solo il pulsante di stop (onclick esplicito) invoca session.abort()
		session.abort();
		assert.equal(abortCalled, true, 'Solo l\'azione di stop dedicata deve interrompere la sessione');
	});
});

describe('Focus delle richieste interattive', () => {
	it('non focalizza la AskCard quando Studio non e\' la finestra attiva', () => {
		const body = { tagName: 'BODY', isContentEditable: false };

		assert.equal(
			shouldAutoFocusAskCard(true, false, body, body, false),
			false,
			'Una domanda dell\'agente non deve riportare Studio in primo piano'
		);
	});
});

describe('Superfici di digitazione esterne al composer', () => {
	it('riconosce Monaco, terminale e campi nativi', () => {
		const monacoHost = {
			tagName: 'DIV',
			isContentEditable: false,
			className: 'monaco-editor',
			closest(selector: string) {
				return selector.includes('.monaco-editor') ? monacoHost : null;
			}
		};
		const monacoInner = {
			tagName: 'DIV',
			isContentEditable: false,
			closest(selector: string) {
				return selector.includes('.monaco-editor') ? monacoHost : null;
			}
		};
		const terminal = {
			tagName: 'DIV',
			isContentEditable: false,
			closest(selector: string) {
				return selector.includes('.xterm') ? terminal : null;
			}
		};
		const textarea = { tagName: 'TEXTAREA', isContentEditable: false };

		assert.equal(isTypingSurface(null), false);
		assert.equal(
			isTypingSurface(monacoInner as EventTarget),
			true,
			'Un click dentro Monaco deve bloccare il type-to-focus'
		);
		assert.equal(isTypingSurface(terminal as EventTarget), true);
		assert.equal(isTypingSurface(textarea as EventTarget), true);
	});
});
describe('Raggruppamento tool ed esecuzione nella timeline (Transcript grouping)', () => {
	function hasResponseContent(entry: { blocks?: Array<{ type: string; text?: string }> }): boolean {
		if (!entry.blocks || !Array.isArray(entry.blocks)) return false;
		return entry.blocks.some(
			(b) => (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0) || b.type === 'image'
		);
	}

	function isExecutionEntry(
		entry: { kind: string; toolName?: string; blocks?: Array<{ type: string; text?: string }> },
		isGroupableTool: (toolName: string) => boolean
	): boolean {
		if (entry.kind === 'tool') {
			return isGroupableTool(entry.toolName ?? '');
		}
		if (entry.kind === 'assistant') {
			return !hasResponseContent(entry);
		}
		return false;
	}

	function groupDisplayItems<T extends { id: number; kind: string; toolName?: string; blocks?: Array<{ type: string; text?: string }> }>(
		entries: T[],
		isGroupableTool: (toolName: string) => boolean = (t) => t !== 'ask'
	) {
		const items: Array<{ kind: 'single' | 'tool-group'; entry?: T; entries?: T[]; id?: number }> = [];
		let currentSegment: T[] = [];

		function flushSegment() {
			if (currentSegment.length === 0) return;
			const hasTools = currentSegment.some((e) => e.kind === 'tool');
			if (hasTools) {
				items.push({
					kind: 'tool-group',
					id: currentSegment[0].id,
					entries: [...currentSegment]
				});
			} else {
				for (const entry of currentSegment) {
					items.push({ kind: 'single', entry });
				}
			}
			currentSegment = [];
		}

		for (const entry of entries) {
			if (isExecutionEntry(entry, isGroupableTool)) {
				currentSegment.push(entry);
			} else {
				flushSegment();
				items.push({ kind: 'single', entry });
			}
		}

		flushSegment();
		return items;
	}

	function shouldShowAssistantFooter(
		index: number,
		items: Array<{ kind: string; entry?: { kind: string } }>
	): boolean {
		const next = items[index + 1];
		if (next && next.kind === 'single' && next.entry?.kind === 'assistant') {
			return false;
		}
		if (
			next &&
			(next.kind === 'tool-group' || (next.kind === 'single' && next.entry?.kind === 'tool'))
		) {
			return false;
		}
		return true;
	}

	it('raggruppa sequenza multi-step di tool operativi e thinking (scenario Gemini)', () => {
		// Simula la sequenza dallo screenshot: write, read, edit, read, edit, todo, write
		const entries = [
			{ id: 1, kind: 'assistant', blocks: [] },
			{ id: 2, kind: 'tool', toolName: 'write' },
			{ id: 3, kind: 'assistant', blocks: [] },
			{ id: 4, kind: 'tool', toolName: 'read' },
			{ id: 5, kind: 'assistant', blocks: [] },
			{ id: 6, kind: 'tool', toolName: 'edit' },
			{ id: 7, kind: 'assistant', blocks: [] },
			{ id: 8, kind: 'tool', toolName: 'read' },
			{ id: 9, kind: 'assistant', blocks: [] },
			{ id: 10, kind: 'tool', toolName: 'edit' },
			{ id: 11, kind: 'assistant', blocks: [{ type: 'thinking', text: 'aggiorno todo...' }] },
			{ id: 12, kind: 'tool', toolName: 'todo' },
			{ id: 13, kind: 'assistant', blocks: [{ type: 'thinking', text: 'scrivo tabelle...' }] },
			{ id: 14, kind: 'tool', toolName: 'write' },
			{ id: 15, kind: 'assistant', blocks: [{ type: 'text', text: 'Ho completato la configurazione.' }] }
		];

		const items = groupDisplayItems(entries);
		assert.equal(items.length, 2, 'Deve produrre esattamente 1 tool-group e 1 messaggio finale');
		assert.equal(items[0].kind, 'tool-group');
		assert.equal(items[0].entries?.length, 14, 'Tutti i 7 tool e relativi passaggi interni devono essere accorpati');
		assert.equal(items[1].kind, 'single');
		assert.equal(items[1].entry?.id, 15);
	});

	it('raggruppa anche una singola operazione operativa con thinking evitando badge isolati', () => {
		const entries = [
			{ id: 1, kind: 'assistant', blocks: [{ type: 'thinking', text: 'devo leggere...' }] },
			{ id: 2, kind: 'tool', toolName: 'read' },
			{ id: 3, kind: 'assistant', blocks: [{ type: 'text', text: 'Ecco il contenuto del file.' }] }
		];

		const items = groupDisplayItems(entries);
		assert.equal(items.length, 2);
		assert.equal(items[0].kind, 'tool-group');
		assert.equal(items[0].entries?.length, 2);
		assert.equal(items[1].kind, 'single');
	});

	it('preserva i commenti testuali dell\'agente nella timeline prima dei tool', () => {
		const entries = [
			{ id: 1, kind: 'assistant', blocks: [{ type: 'text', text: 'Ora modifico i parametri di configurazione.' }] },
			{ id: 2, kind: 'tool', toolName: 'edit' },
			{ id: 3, kind: 'assistant', blocks: [] },
			{ id: 4, kind: 'tool', toolName: 'bash' },
			{ id: 5, kind: 'assistant', blocks: [{ type: 'text', text: 'Configurazione completata con successo.' }] }
		];

		const items = groupDisplayItems(entries);
		assert.equal(items.length, 3);
		assert.equal(items[0].kind, 'single', 'Il commento narrativo iniziale resta nella timeline');
		assert.equal(items[0].entry?.id, 1);
		assert.equal(items[1].kind, 'tool-group', 'I tool intermedi vengono raggruppati');
		assert.equal(items[1].entries?.length, 3);
		assert.equal(items[2].kind, 'single', 'La risposta finale resta nella timeline');
		assert.equal(items[2].entry?.id, 5);
	});

	it('non raggruppa tool interattivi come ask che richiedono risposta utente', () => {
		const entries = [
			{ id: 1, kind: 'assistant', blocks: [] },
			{ id: 2, kind: 'tool', toolName: 'read' },
			{ id: 3, kind: 'assistant', blocks: [] },
			{ id: 4, kind: 'tool', toolName: 'ask' },
			{ id: 5, kind: 'user', text: 'Risposta utente' }
		];

		const items = groupDisplayItems(entries);
		assert.equal(items.length, 3);
		assert.equal(items[0].kind, 'tool-group', 'Il read precedente e nel gruppo');
		assert.equal(items[1].kind, 'single', 'ask resta standalone nella timeline per interazione');
		assert.equal(items[1].entry?.id, 4);
		assert.equal(items[2].kind, 'single', 'Il messaggio utente resta standalone');
	});

	it('deduplica il footer modello omettendolo prima di un tool-group o tool singolo e mostrandolo alla risposta finale', () => {
		const itemsWithGroup = [
			{ kind: 'single', entry: { kind: 'assistant' } },
			{ kind: 'tool-group' },
			{ kind: 'single', entry: { kind: 'assistant' } }
		];

		assert.equal(
			shouldShowAssistantFooter(0, itemsWithGroup),
			false,
			'Nessun footer prima di un tool-group'
		);
		assert.equal(
			shouldShowAssistantFooter(2, itemsWithGroup),
			true,
			'Footer mostrato sulla risposta finale'
		);

		const itemsWithSingleTool = [
			{ kind: 'single', entry: { kind: 'assistant' } },
			{ kind: 'single', entry: { kind: 'tool' } },
			{ kind: 'single', entry: { kind: 'assistant' } }
		];

		assert.equal(
			shouldShowAssistantFooter(0, itemsWithSingleTool),
			false,
			'Nessun footer prima di un tool singolo (come ask)'
		);
		assert.equal(
			shouldShowAssistantFooter(2, itemsWithSingleTool),
			true,
			'Footer mostrato sulla risposta finale dopo il tool'
		);
	});

	it('preserva l ordine cronologico intervallando testo e chiamate tool invece di accodare tutti i tool alla fine', () => {
		// Simula un messaggio assistant in arrivo dallo storico omp con 2 round di ask e testo finale
		const rawMessage = {
			role: 'assistant',
			model: 'cursor-grok-4.6',
			usage: { cost: { total: 0.05 } },
			content: [
				{ type: 'thinking', thinking: 'ragionamento round 1' },
				{ type: 'text', text: 'Ripeto le 4 domande:' },
				{ type: 'toolCall', id: 'call-1', name: 'ask' },
				{ type: 'thinking', thinking: 'ragionamento round 2' },
				{ type: 'text', text: 'Confermate: procediamo con round 2' },
				{ type: 'toolCall', id: 'call-2', name: 'ask' },
				{ type: 'thinking', thinking: 'ragionamento finale' },
				{ type: 'text', text: 'Frontier vuota: ecco il riepilogo finale.' }
			]
		};

		const entries: Array<{
			id: number;
			kind: string;
			toolName?: string;
			blocks?: Array<{ type: string; text?: string }>;
			usage?: unknown;
		}> = [];
		let currentBlocks: Array<{ type: string; text?: string }> = [];
		let nextId = 1;

		const flush = (isLast: boolean) => {
			if (currentBlocks.length === 0) return;
			entries.push({
				id: nextId++,
				kind: 'assistant',
				blocks: [...currentBlocks],
				usage: isLast ? rawMessage.usage : undefined
			});
			currentBlocks = [];
		};

		for (let i = 0; i < rawMessage.content.length; i++) {
			const b = rawMessage.content[i];
			if (b.type === 'text' || b.type === 'thinking') {
				currentBlocks.push(b);
			} else if (b.type === 'toolCall') {
				const hasSubsequent = rawMessage.content
					.slice(i + 1)
					.some((x) => x.type === 'text' || x.type === 'thinking');
				flush(!hasSubsequent);
				entries.push({
					id: nextId++,
					kind: 'tool',
					toolName: b.name
				});
			}
		}
		flush(true);

		// 1. Devono essere prodotte 5 entry ordinate cronologicamente
		assert.equal(entries.length, 5);
		assert.equal(entries[0].kind, 'assistant');
		assert.equal(entries[1].kind, 'tool');
		assert.equal(entries[1].toolName, 'ask');
		assert.equal(entries[2].kind, 'assistant');
		assert.equal(entries[3].kind, 'tool');
		assert.equal(entries[3].toolName, 'ask');
		assert.equal(entries[4].kind, 'assistant');

		// 2. Solo l'ultima risposta dell'assistente porta l'usage (costo/footer finale)
		assert.equal(entries[0].usage, undefined);
		assert.equal(entries[2].usage, undefined);
		assert.deepEqual(entries[4].usage, { cost: { total: 0.05 } });
	});
});
