/**
 * Laboratorio «Indica e disegna» (Gate R42):
 * - mappa sorgente: esbuild `jsxDev` + shim `react/jsx-dev-runtime` -> `data-lab-loc`;
 * - raggruppamento del Riquadro per componente e file:riga;
 * - geometria della regione catturata e delle annotazioni;
 * - formato del pacchetto `<lab-notes>` per l'agente.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileLabPrototype } from '../src/lib/lab/compiler.ts';
import { LAB_JSX_DEV_SHIM, labLocFromSource } from '../src/lib/lab/inspect/jsxDevShim.ts';
import {
	computeCaptureRegion,
	groupAreaElements,
	isMostlyInside,
	unionRects
} from '../src/lib/lab/inspect/inspector-client.js';
import {
	annotationShapes,
	appendLabNotes,
	formatLabNotesBlock,
	shortTargetLabel,
	type LabNote,
	type LabNotesLabels,
	type LabTarget
} from '../src/lib/lab/visualNotes.ts';

const LABELS: LabNotesLabels = {
	element: 'elemento',
	elements: (c) => `elementi: ${c}`,
	area: (w, h, x, y) => `riquadro ${w}×${h} in ${x},${y}`,
	areaCount: (c, g) => `elementi: ${c}, gruppi: ${g}`,
	note: 'nota',
	noNote: 'nessuna nota',
	stale: 'superata',
	missing: 'non trovato',
	callsite: 'punto di chiamata',
	ancestor: 'antenato più vicino',
	noSource: 'sorgente non trovata',
	instance: (i, c) => `istanza ${i} di ${c}`,
	moreGroups: (c) => `… altri gruppi: ${c}`,
	selector: 'selettore',
	classes: 'classi',
	text: 'testo',
	frame: 'Immagine allegata: fotogramma.'
};

function target(partial: Partial<LabTarget>): LabTarget {
	return {
		tag: 'div',
		loc: null,
		locKind: null,
		component: null,
		selector: 'div',
		classes: '',
		text: '',
		instance: { index: 0, count: 1 },
		rect: { x: 0, y: 0, width: 10, height: 10 },
		...partial
	};
}

describe('Lab Indica: mappa sorgente (jsxDev + data-lab-loc)', () => {
	it('labLocFromSource toglie il namespace del VFS', () => {
		assert.equal(labLocFromSource('vfs:/src/App.tsx', 12, 5), 'src/App.tsx:12:5');
		assert.equal(labLocFromSource('/src/a/B.tsx', 1, 0), 'src/a/B.tsx:1:0');
	});

	it('il bundle marca gli elementi host con file:riga:colonna e registra i punti di chiamata', async () => {
		const files = [
			{
				path: 'src/main.tsx',
				content: [
					"import { Card } from './Card';",
					'export const tree = (',
					'  <main className="p-4">',
					'    <Card title="Zaino" />',
					'  </main>',
					');'
				].join('\n')
			},
			{
				path: 'src/Card.tsx',
				content: 'export function Card(p: { title: string }) {\n  return <h3 className="text-lg">{p.title}</h3>;\n}\n'
			}
		];
		const result = await compileLabPrototype(files);
		assert.equal(result.ok, true, JSON.stringify(result.errors));
		assert.match(result.compiledJs, /jsxDEV\(/);
		assert.match(result.compiledJs, /data-lab-loc/);
		assert.equal(result.importMap['react/jsx-runtime'], '/_vendor/react-jsx-runtime.js');

		// Esegue il bundle con un runtime JSX finto per leggere le props risultanti.
		const dir = mkdtempSync(join(tmpdir(), 'lab-indica-'));
		try {
			writeFileSync(
				join(dir, 'jsx-runtime.mjs'),
				'export const Fragment = Symbol("f");\n' +
					'export function jsx(type, props, key) { return { type, props, key }; }\n' +
					'export const jsxs = jsx;\n'
			);
			const code = result.compiledJs.replace(
				/from\s+["']react\/jsx-runtime["']/g,
				`from ${JSON.stringify(pathToFileURL(join(dir, 'jsx-runtime.mjs')).href)}`
			);
			writeFileSync(join(dir, 'bundle.mjs'), code);
			const mod = await import(pathToFileURL(join(dir, 'bundle.mjs')).href);
			const tree = mod.tree as { type: unknown; props: Record<string, any> };
			assert.equal(tree.type, 'main');
			assert.equal(tree.props['data-lab-loc'], 'src/main.tsx:3:3');
			assert.equal(tree.props.className, 'p-4');
			const card = tree.props.children as { type: unknown; props: Record<string, unknown> };
			assert.equal(typeof card.type, 'function');
			assert.equal(card.props['data-lab-loc'], undefined, 'i componenti non ricevono attributi DOM');
			const callSites = (globalThis as any).__labInspect.callSites as WeakMap<object, string>;
			assert.equal(callSites.get(card.props), 'src/main.tsx:4:5');
			// Il componente, renderizzato, produce un host con la riga del suo file.
			const h3 = (card.type as (p: any) => { props: Record<string, unknown> })(card.props);
			assert.equal(h3.props['data-lab-loc'], 'src/Card.tsx:2:10');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('lo shim non tocca i sorgenti esportati: vive solo nel compilatore', () => {
		assert.match(LAB_JSX_DEV_SHIM, /from 'react\/jsx-runtime'/);
		assert.match(LAB_JSX_DEV_SHIM, /export function jsxDEV/);
	});
});

describe('Lab Indica: Riquadro', () => {
	it('isMostlyInside richiede che la maggior parte dell’elemento cada nell’area', () => {
		const area = { x: 0, y: 0, width: 100, height: 100 };
		assert.equal(isMostlyInside({ x: 10, y: 10, width: 20, height: 20 }, area), true);
		assert.equal(isMostlyInside({ x: 90, y: 10, width: 40, height: 20 }, area), false);
		assert.equal(isMostlyInside({ x: -10, y: -10, width: 300, height: 300 }, area), false, 'il contenitore non entra');
		assert.equal(isMostlyInside({ x: 0, y: 0, width: 0, height: 10 }, area), false);
	});

	it('raggruppa per componente e file:riga contando le istanze, in ordine di documento', () => {
		const items = [
			{ tag: 'article', loc: 'src/Card.tsx:3:5', locKind: 'jsx', component: 'Card', selector: 'article:nth-of-type(1)', classes: 'p-4', text: 'Zaino', rect: { x: 0, y: 0, width: 10, height: 10 } },
			{ tag: 'h3', loc: 'src/Card.tsx:4:7', locKind: 'jsx', component: 'Card', selector: 'a > h3', classes: 'text-lg', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
			{ tag: 'article', loc: 'src/Card.tsx:3:5', locKind: 'jsx', component: 'Card', selector: 'article:nth-of-type(2)', classes: 'p-4', text: 'Borraccia', rect: { x: 0, y: 0, width: 10, height: 10 } },
			{ tag: 'h3', loc: 'src/Card.tsx:4:7', locKind: 'jsx', component: 'Card', selector: 'b > h3', classes: 'text-lg', text: 'Borraccia', rect: { x: 0, y: 0, width: 10, height: 10 } },
			{ tag: 'svg', loc: 'src/Card.tsx:9:9', locKind: 'callsite', component: 'Star', selector: 'svg', classes: '', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
			{ tag: 'span', loc: null, locKind: null, component: 'Badge', anchorLoc: 'src/Card.tsx:8:3', selector: 'span', classes: '', text: 'Nuovo', rect: { x: 0, y: 0, width: 10, height: 10 } }
		];
		const out = groupAreaElements(items, 12);
		assert.equal(out.total, 6);
		assert.equal(out.omitted, 0);
		assert.deepEqual(
			out.groups.map((g: LabTarget) => [g.tag, g.loc, g.count]),
			[
				['article', 'src/Card.tsx:3:5', 2],
				['h3', 'src/Card.tsx:4:7', 2],
				['svg', 'src/Card.tsx:9:9', 1],
				['span', null, 1]
			]
		);
		// Il primo testo non vuoto del gruppo rappresenta il gruppo.
		assert.equal(out.groups[1].text, 'Borraccia');
		assert.equal(out.groups[0].selector, 'article:nth-of-type(1)');
	});

	it('limita i gruppi e conta quelli omessi', () => {
		const items = Array.from({ length: 20 }, (_, i) => ({
			tag: 'li', loc: `src/List.tsx:${i + 1}:1`, locKind: 'jsx', component: 'List', selector: `li:nth-of-type(${i + 1})`, classes: '', text: '', rect: { x: 0, y: 0, width: 1, height: 1 }
		}));
		const out = groupAreaElements(items, 12);
		assert.equal(out.groups.length, 12);
		assert.equal(out.omitted, 8);
	});
});

describe('Lab Indica: regione catturata e annotazioni', () => {
	const viewport = { scrollX: 0, scrollY: 400, width: 800, height: 600 };
	const doc = { width: 800, height: 3000 };

	it('senza note cattura il viewport corrente', () => {
		assert.deepEqual(computeCaptureRegion([], viewport, doc), { x: 0, y: 400, width: 800, height: 600 });
	});

	it('copre tutte le note anche fuori dal viewport, limitata al documento', () => {
		const r = computeCaptureRegion(
			[
				{ x: 100, y: 100, width: 200, height: 50 },
				{ x: 100, y: 1500, width: 200, height: 50 }
			],
			viewport,
			doc
		);
		assert.equal(r.x, 0);
		assert.equal(r.width, 800);
		assert.ok(r.y <= 100 - 32 + 1 && r.y >= 0);
		assert.ok(r.y + r.height >= 1550 + 32 - 1);
		assert.ok(r.y + r.height <= 3000);
		assert.deepEqual(unionRects([{ x: 1, y: 2, width: 3, height: 4 }]), { x: 1, y: 2, width: 3, height: 4 });
	});

	it('annotationShapes porta i rettangoli pagina nei pixel del fotogramma e salta le note superate', () => {
		const notes: LabNote[] = [
			{ id: 'a', n: 1, kind: 'point', targets: [target({})], text: '', stale: false },
			{ id: 'b', n: 2, kind: 'area', targets: [], rect: { x: 0, y: 0, width: 1, height: 1 }, text: '', stale: false },
			{ id: 'c', n: 3, kind: 'point', targets: [target({})], text: '', stale: true }
		];
		const shapes = annotationShapes(
			{
				region: { x: 0, y: 400, width: 800, height: 600 },
				scale: 2,
				width: 1600,
				height: 1200,
				rects: {
					a: [{ x: 10, y: 410, width: 100, height: 20 }],
					b: [{ x: 0, y: 2000, width: 50, height: 50 }],
					c: [{ x: 10, y: 410, width: 100, height: 20 }]
				}
			},
			notes
		);
		assert.equal(shapes.length, 1, 'la nota fuori regione e quella superata non si disegnano');
		assert.deepEqual(shapes[0].boxes[0], { x: 20, y: 20, width: 200, height: 40 });
		assert.equal(shapes[0].n, 1);
		assert.deepEqual(shapes[0].badge, { x: 20, y: 20 });
	});
});

describe('Lab Indica: pacchetto per l’agente', () => {
	const point: LabNote = {
		id: 'n1',
		n: 1,
		kind: 'point',
		text: 'più grande,\ncome il prezzo',
		stale: false,
		targets: [
			target({
				tag: 'h3',
				loc: 'src/components/ProductCard.tsx:15:9',
				locKind: 'jsx',
				component: 'ProductCard',
				selector: 'main > article:nth-of-type(1) > h3',
				classes: 'text-lg font-semibold',
				text: 'Zaino "Trail" 28L',
				instance: { index: 0, count: 3 }
			})
		]
	};
	const area: LabNote = {
		id: 'n2',
		n: 2,
		kind: 'area',
		text: '',
		stale: false,
		rect: { x: 96.4, y: 320, width: 412, height: 180 },
		total: 7,
		omitted: 1,
		targets: [
			target({ tag: 'span', loc: 'src/components/ProductCard.tsx:18:9', locKind: 'jsx', component: 'ProductCard', selector: 'span.price', count: 3, text: '€ 89' }),
			target({ tag: 'svg', loc: 'src/components/Rating.tsx:4:40', locKind: 'callsite', component: 'Star', selector: 'svg' })
		]
	};
	const stale: LabNote = {
		id: 'n3',
		n: 3,
		kind: 'point',
		text: '',
		stale: true,
		targets: [target({ tag: 'button', loc: null, selector: 'button', missing: true })]
	};

	it('produce un blocco compatto con file:riga, componente, selettore, classi, testo e nota', () => {
		const block = formatLabNotesBlock([area, point, stale], {
			labels: LABELS,
			viewport: 'desktop 1180×760',
			imageAttached: true
		});
		assert.equal(
			block,
			[
				'<lab-notes viewport="desktop 1180×760" frame="1">',
				'[1] elemento — nota: "più grande, come il prezzo"',
				'  - <h3> · ProductCard · src/components/ProductCard.tsx:15:9 · istanza 1 di 3',
				'    selettore: main > article:nth-of-type(1) > h3 | classi: text-lg font-semibold | testo: "Zaino \\"Trail\\" 28L"',
				'[2] riquadro 412×180 in 96,320 · elementi: 7, gruppi: 3 — nessuna nota',
				'  - <span> · ProductCard · src/components/ProductCard.tsx:18:9 · ×3',
				'    selettore: span.price | testo: "€ 89"',
				'  - <svg> · Star · src/components/Rating.tsx:4:40 (punto di chiamata)',
				'    selettore: svg',
				'  … altri gruppi: 1',
				'[3] elemento (superata) — nessuna nota',
				'  - <button> · sorgente non trovata · (non trovato)',
				'    selettore: button',
				'</lab-notes>',
				'Immagine allegata: fotogramma.'
			].join('\n')
		);
	});

	it('senza immagine non cita il fotogramma; senza note non aggiunge nulla', () => {
		const block = formatLabNotesBlock([point], { labels: LABELS, imageAttached: false });
		assert.ok(block.startsWith('<lab-notes>\n[1]'));
		assert.ok(!block.includes('fotogramma'));
		assert.equal(formatLabNotesBlock([], { labels: LABELS, imageAttached: true }), '');
		assert.equal(appendLabNotes('Rendi la card più ariosa.', block), `Rendi la card più ariosa.\n\n${block}`);
		assert.equal(appendLabNotes('  ', block), block);
		assert.equal(appendLabNotes('testo', ''), 'testo');
	});

	it('etichetta breve per chip e popover', () => {
		assert.equal(shortTargetLabel(point.targets[0]), '<h3> ProductCard ProductCard.tsx:15');
		assert.equal(shortTargetLabel(target({ tag: 'p' })), '<p>');
	});
});
