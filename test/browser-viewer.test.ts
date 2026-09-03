import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	mapClientToViewportCoords,
	mapWheelToViewportScroll,
	type BoundingBoxRect,
	type BrowserFrameMeta,
	type BrowserInputEvent,
	type ViewportPoint
} from '../src/lib/agent/browser-live.ts';

describe('S41 — BrowserViewer & Coordinate Mapping', () => {
	const sampleMeta: BrowserFrameMeta = {
		sequence: 42,
		browserSessionId: 'managed-test-proj',
		tabId: 'chat-123::main',
		timestampMs: 1725350000000,
		viewportWidth: 1280,
		viewportHeight: 800,
		deviceScaleFactor: 1.0,
		scrollX: 0,
		scrollY: 0,
		controlEpoch: 0,
		privacy: 'normal',
		mimeType: 'image/jpeg'
	};

	describe('mapClientToViewportCoords (CSS pixel projection)', () => {
		it('mappa con precisione 1:1 quando il rettangolo del canvas coincide col viewport nativo', () => {
			const rect: BoundingBoxRect = { left: 100, top: 50, width: 1280, height: 800 };
			// Click a coordinate client (100, 50) -> origine (0, 0)
			const ptOrigin = mapClientToViewportCoords(100, 50, rect, sampleMeta);
			assert.deepEqual(ptOrigin, { x: 0, y: 0 });

			// Click al centro (740, 450) -> (640, 400)
			const ptCenter = mapClientToViewportCoords(100 + 640, 50 + 400, rect, sampleMeta);
			assert.deepEqual(ptCenter, { x: 640, y: 400 });

			// Click all'angolo opposto (1380, 850) -> (1280, 800)
			const ptEnd = mapClientToViewportCoords(100 + 1280, 50 + 800, rect, sampleMeta);
			assert.deepEqual(ptEnd, { x: 1280, y: 800 });
		});

		it('scala proporzionalmente quando la finestra o colonna centrale viene ridimensionata', () => {
			// Container ridotto al 50% di larghezza (640x400)
			const rect: BoundingBoxRect = { left: 0, top: 0, width: 640, height: 400 };

			// Click a meta larghezza (320px) nel DOM -> deve mappare a 640px nel viewport Chromium
			const pt = mapClientToViewportCoords(320, 200, rect, sampleMeta);
			assert.deepEqual(pt, { x: 640, y: 400 });

			// Click a un quarto (160px, 100px) -> (320px, 200px)
			const ptQuarter = mapClientToViewportCoords(160, 100, rect, sampleMeta);
			assert.deepEqual(ptQuarter, { x: 320, y: 200 });
		});

		it('funziona correttamente con preset responsive tablet (768px) e mobile (390px)', () => {
			// Preset Tablet 768px con aspect ratio 16:10 (768x480)
			const tabletRect: BoundingBoxRect = { left: 200, top: 100, width: 768, height: 480 };
			const ptTablet = mapClientToViewportCoords(200 + 384, 100 + 240, tabletRect, sampleMeta);
			assert.deepEqual(ptTablet, { x: 640, y: 400 });

			// Preset Mobile 390px (390x243.75)
			const mobileRect: BoundingBoxRect = { left: 400, top: 150, width: 390, height: 243.75 };
			const ptMobile = mapClientToViewportCoords(400 + 195, 150 + 121.875, mobileRect, sampleMeta);
			assert.deepEqual(ptMobile, { x: 640, y: 400 });
		});

		it('e invariante rispetto allo zoom del browser e DPI scaling (DPI 1.25, 1.5, 2.0)', () => {
			// Con DPI 2.0 o zoom 200%, clientX e rect sono entrambi scalati nel sistema di coordinate DOM
			const dpi2Rect: BoundingBoxRect = { left: 200, top: 100, width: 2560, height: 1600 };
			const ptDpi = mapClientToViewportCoords(200 + 1280, 100 + 800, dpi2Rect, sampleMeta);
			assert.deepEqual(ptDpi, { x: 640, y: 400 });
		});

		it('esegue il clamping deterministico su eventi che sforano i confini visivi', () => {
			const rect: BoundingBoxRect = { left: 100, top: 100, width: 500, height: 300 };

			// Click prima del margine sinistro
			const ptLeft = mapClientToViewportCoords(50, 200, rect, sampleMeta);
			assert.equal(ptLeft?.x, 0);

			// Click oltre il margine destro
			const ptRight = mapClientToViewportCoords(700, 200, rect, sampleMeta);
			assert.equal(ptRight?.x, 1280);

			// Click sopra il margine superiore
			const ptTop = mapClientToViewportCoords(350, 20, rect, sampleMeta);
			assert.equal(ptTop?.y, 0);

			// Click sotto il margine inferiore
			const ptBottom = mapClientToViewportCoords(350, 500, rect, sampleMeta);
			assert.equal(ptBottom?.y, 800);
		});

		it('rifiuta dimensioni non valide o nulle restituendo null senza errori runtime', () => {
			assert.equal(mapClientToViewportCoords(10, 10, { left: 0, top: 0, width: 0, height: 100 }, sampleMeta), null);
			assert.equal(mapClientToViewportCoords(10, 10, { left: 0, top: 0, width: 100, height: 0 }, sampleMeta), null);
			assert.equal(mapClientToViewportCoords(10, 10, { left: 0, top: 0, width: -50, height: 100 }, sampleMeta), null);
			assert.equal(mapClientToViewportCoords(10, 10, { left: 0, top: 0, width: 100, height: 100 }, { viewportWidth: 0, viewportHeight: 800 }), null);
		});
	});

	describe('mapWheelToViewportScroll (normalizzazione delta rotellina)', () => {
		it('conserva i pixel invariati in modalita deltaMode = 0 (Pixel)', () => {
			const scroll = mapWheelToViewportScroll(15.5, -30.25, 0);
			assert.deepEqual(scroll, { deltaX: 15.5, deltaY: -30.25 });
		});

		it('converte le linee in pixel in modalita deltaMode = 1 (Linee, fattore 16)', () => {
			const scroll = mapWheelToViewportScroll(2, 3, 1);
			assert.deepEqual(scroll, { deltaX: 32, deltaY: 48 });
		});

		it('converte le pagine in pixel in modalita deltaMode = 2 (Pagine, fattore 400)', () => {
			const scroll = mapWheelToViewportScroll(0, 1, 2);
			assert.deepEqual(scroll, { deltaX: 0, deltaY: 400 });
		});
	});

	describe('contratto eventi input BrowserInputEvent', () => {
		it('rappresenta correttamente tutti i tipi di input necessari a S41/S42', () => {
			const moveEvent: BrowserInputEvent = { type: 'mouse_move', x: 100, y: 200, buttons: 1 };
			const downEvent: BrowserInputEvent = { type: 'mouse_down', x: 100, y: 200, button: 0, buttons: 1, clickCount: 1 };
			const wheelEvent: BrowserInputEvent = { type: 'wheel', x: 100, y: 200, deltaX: 0, deltaY: 50 };
			const dragEvent: BrowserInputEvent = { type: 'drag_start', x: 50, y: 60 };
			const keyEvent: BrowserInputEvent = {
				type: 'key_down',
				key: 'Enter',
				code: 'Enter',
				modifiers: { alt: false, ctrl: false, meta: false, shift: false }
			};

			assert.equal(moveEvent.type, 'mouse_move');
			assert.equal(downEvent.type, 'mouse_down');
			assert.equal(wheelEvent.type, 'wheel');
			assert.equal(dragEvent.type, 'drag_start');
			assert.equal(keyEvent.type, 'key_down');
		});
	});
});
