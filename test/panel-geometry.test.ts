import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { panelScope, panelMetrics, resizePanel, panelKeyValue, readPanelGeometries } from '../src/lib/panelGeometry.ts';
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
