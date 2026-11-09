import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	panelScope, panelMetrics, resizePanel, panelKeyValue, readPanelGeometries,
	panelPlacement, readColumnOrder, moveColumn, type ColumnRole
} from '../src/lib/panelGeometry.ts';
import { buildProjectMetadata, resolveProjectTabInfo } from '../src/lib/stores/projectTabHelpers.ts';

const initial = { left: 260, centerRatio: 0.5, topRatio: 0.5 };

describe('Geometria dei pannelli per branch e prototipo', () => {
	it('conserva profili indipendenti dopo chiusura e riapertura del progetto', () => {
		const main = panelScope('git', 'main');
		const feature = panelScope('git', 'feature/layout');
		const lab = panelScope('lab', 'main');
		const profiles = {
			[main]: resizePanel(initial, 'left', 320, 1400, 900, false, false),
			[feature]: resizePanel(initial, 'center', 700, 1400, 900, false, false),
			[lab]: resizePanel(initial, 'center', 500, 1400, 900, true, false)
		};
		const metadata = buildProjectMetadata({
			name: 'Panels', label: null, canonicalProjectPath: '/dev/panels', hue: 135, colorMode: 'auto',
			layout: { left: 260, center: 0.5, leftSection: 'files', editorOpen: true, panelGeometry: profiles }
		});
		const restored = resolveProjectTabInfo('/dev/panels', JSON.parse(JSON.stringify(metadata)), 135).layout.panelGeometry!;
		assert.equal(restored[main].left, 320);
		assert.equal(panelMetrics(restored[feature], 1400, 900, false, false).center, 700);
		assert.equal(panelMetrics(restored[lab], 1400, 900, true, false).top, 500);
		assert.equal(restored[feature].left, 260);
		assert.equal(restored[main].topRatio, 0.5);
	});

	it('una finestra stretta limita la resa ma non distrugge la preferenza salvata', () => {
		const saved = resizePanel(initial, 'left', 550, 1600, 900, false, false);
		const narrow = panelMetrics(saved, 620, 700, false, false);
		assert.equal(narrow.left, 288);
		assert.equal(narrow.center, 160);
		assert.equal(panelMetrics(saved, 1600, 900, false, false).left, 550);
		const vertical = panelMetrics(saved, 620, 700, true, false);
		assert.equal(vertical.left, 454);
	});

	it('frecce e limiti rispettano asse, passo e minimo dei pannelli', () => {
		assert.equal(panelKeyValue('ArrowRight', 300, 160, 900, false, false), 310);
		assert.equal(panelKeyValue('ArrowLeft', 180, 160, 900, false, true), 160);
		assert.equal(panelKeyValue('ArrowDown', 300, 120, 700, true, true), 340);
		assert.equal(panelKeyValue('ArrowRight', 300, 120, 700, true, false), null);
		assert.equal(panelKeyValue('Home', 300, 120, 700, true, false), 120);
		assert.equal(panelKeyValue('End', 300, 120, 700, true, false), 700);
	});

	it('non produce dimensioni negative su viewport minuscoli o sidebar chiusa', () => {
		for (const width of [0, 100, 330, 1000]) {
			for (const vertical of [true, false]) {
				const b = panelMetrics(initial, width, 80, vertical, true);
				assert.equal(b.left, 0);
				assert.ok(b.center >= 0 && b.center <= b.available);
				assert.ok(b.top >= 0 && b.top <= b.rows);
			}
		}
	});

	it('scarta profili corrotti senza perdere quelli utilizzabili', () => {
		const key = panelScope('git', 'main');
		const result = readPanelGeometries({
			[key]: initial, bad: { left: 300, centerRatio: Infinity, topRatio: 0.5 },
			negative: { left: -1, centerRatio: 0.5, topRatio: 0.5 }, null: null
		});
		assert.deepEqual(result, { [key]: initial });
	});
});

const ORDERS: ColumnRole[][] = [
	['files', 'editor', 'agent'], ['files', 'agent', 'editor'], ['editor', 'files', 'agent'],
	['editor', 'agent', 'files'], ['agent', 'files', 'editor'], ['agent', 'editor', 'files']
];

describe('Ordine delle colonne (COL-001, COL-004, COL-005, COL-006)', () => {
	it('in orizzontale ogni ordine occupa le 5 tracce senza sovrapposizioni, divisori accanto alla loro colonna', () => {
		for (const order of ORDERS) {
			const p = panelPlacement(order, false, 260, 6, 700);
			const columns = [p.files, p.filesSplit, p.editor, p.editorSplit, p.agent].map((s) => Number(s.column));
			assert.deepEqual([...columns].sort(), [1, 2, 3, 4, 5], order.join('|'));
			assert.deepEqual(order.map((role) => Number(p[role].column)), [1, 3, 5]);
			// Il divisore sta sul lato rivolto alla chat e il segno dice se trascinare a destra allarga.
			assert.equal(Number(p.filesSplit.column), Number(p.files.column) + p.filesSign);
			assert.equal(Number(p.editorSplit.column), Number(p.editor.column) + p.editorSign);
			assert.equal(p.filesSign, order.indexOf('agent') > order.indexOf('files') ? 1 : -1);
			// Le misure seguono il ruolo: la traccia dell'editor e' sempre 700px, la chat prende il resto.
			const tracks = p.columns.split(/ (?![^(]*\))/);
			assert.equal(tracks[Number(p.editor.column) - 1], '700px');
			assert.equal(tracks[Number(p.files.column) - 1], '260px');
			assert.equal(tracks[Number(p.agent.column) - 1], 'minmax(0, 1fr)');
		}
	});

	it('l\'ordine predefinito riproduce la griglia di prima', () => {
		const p = panelPlacement(['files', 'editor', 'agent'], false, 260, 6, 700);
		assert.equal(p.columns, '260px 6px 700px 6px minmax(0, 1fr)');
		assert.deepEqual([p.filesSign, p.editorSign], [1, 1]);
		const v = panelPlacement(['files', 'editor', 'agent'], true, 260, 6, 400);
		assert.equal(v.columns, '260px 6px minmax(0, 1fr)');
		assert.equal(v.rows, '400px 6px minmax(0, 1fr)');
	});

	it('in verticale la barra va a destra solo se ultima; editor e chat si impilano nell\'ordine relativo', () => {
		const v = panelPlacement(['agent', 'editor', 'files'], true, 260, 6, 400);
		assert.equal(v.files.column, '3');
		assert.equal(v.columns, 'minmax(0, 1fr) 6px 260px');
		assert.equal(v.filesSign, -1);
		assert.deepEqual([v.agent.row, v.editor.row], ['1', '3']);
		assert.equal(v.rows, 'minmax(0, 1fr) 6px 400px');
		assert.equal(v.editorSign, -1);
		assert.equal(panelPlacement(['editor', 'files', 'agent'], true, 260, 6, 400).files.column, '1');
	});

	it('le frecce muovono il divisore nel loro verso anche con la colonna dall\'altro lato', () => {
		assert.equal(panelKeyValue('ArrowLeft', 300, 160, 900, false, false, true), 310);
		assert.equal(panelKeyValue('ArrowRight', 300, 160, 900, false, false, true), 290);
		assert.equal(panelKeyValue('ArrowUp', 300, 120, 700, true, false, true), 310);
	});

	it('accetta dal disco solo permutazioni complete e sposta entro i bordi', () => {
		assert.deepEqual(readColumnOrder(['agent', 'files', 'editor']), ['agent', 'files', 'editor']);
		for (const bad of [['files', 'editor'], ['files', 'files', 'agent'], ['files', 'editor', 'chat'], 'files', null]) {
			assert.equal(readColumnOrder(bad), undefined);
		}
		assert.deepEqual(moveColumn(['files', 'editor', 'agent'], 'agent', -1), ['files', 'agent', 'editor']);
		assert.deepEqual(moveColumn(['files', 'editor', 'agent'], 'files', -1), ['files', 'editor', 'agent']);
	});
});
