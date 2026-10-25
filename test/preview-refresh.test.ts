import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	LaneSurfaceManager,
	type LanePreviewPayload
} from '../src/lib/agent/laneSurfaces.ts';
import type { LaneResolutionContext } from '../src/lib/agent/laneRouting.ts';
import { wrapPrototypeCode } from '../src/lib/prototype/wrapper.ts';

describe('Ciclo di aggiornamento anteprima: refresh automatico, revisioni e robustezza sorgenti', () => {
	let surfaceStore: LaneSurfaceManager;

	beforeEach(() => {
		surfaceStore = new LaneSurfaceManager();
	});

	describe('1. Tracciamento reattivo di previewRevision in laneSurfaces', () => {
		const context: LaneResolutionContext = {
			projects: [
				{
					id: 'proj-1',
					canonicalProjectPath: '/repos/proj1',
					lane: { laneId: 'main', workspacePath: '/repos/proj1' }
				}
			],
			lanes: [
				{
					projectId: 'proj-1',
					laneId: 'main',
					workspacePath: '/repos/proj1'
				}
			],
			activeProjectId: 'proj-1',
			activeLaneId: 'main'
		};

		it('setLanePreview incrementa previewRevision a ogni invocazione, anche per lo stesso file', () => {
			surfaceStore.setLanePreview('proj-1', 'main', 'proto/card.html');
			const state1 = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(state1.surface, 'preview');
			assert.equal(state1.previewFile, 'proto/card.html');
			assert.equal(state1.previewRevision, 1);

			// Seconda invocazione con lo stesso identico percorso (es. agente che reitera studio_preview)
			surfaceStore.setLanePreview('proj-1', 'main', 'proto/card.html');
			const state2 = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(state2.surface, 'preview');
			assert.equal(state2.previewFile, 'proto/card.html');
			assert.equal(state2.previewRevision, 2);
		});

		it('routePreviewEvent aggiorna previewRevision per chiamate consecutive', () => {
			const payload1: LanePreviewPayload = {
				id: 'rev-1',
				title: 'Card Prototipo',
				file_path: 'proto/card.html',
				cwd: '/repos/proj1',
				session_id: 'sess-1'
			};
			const res1 = surfaceStore.routePreviewEvent(payload1, context);
			assert.equal(res1.handled, true);
			const state1 = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(state1.previewRevision, 1);

			const payload2: LanePreviewPayload = {
				id: 'rev-2',
				title: 'Card Prototipo v2',
				file_path: 'proto/card.html',
				cwd: '/repos/proj1',
				session_id: 'sess-1'
			};
			const res2 = surfaceStore.routePreviewEvent(payload2, context);
			assert.equal(res2.handled, true);
			const state2 = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(state2.previewRevision, 2);
		});

		it('chiusura della superficie preserva l\'ultimo contatore revisione', () => {
			surfaceStore.setLanePreview('proj-1', 'main', 'proto/card.html');
			assert.equal(surfaceStore.getLaneSurface('proj-1', 'main').previewRevision, 1);

			surfaceStore.closeLaneSurface('proj-1', 'main');
			const closed = surfaceStore.getLaneSurface('proj-1', 'main');
			assert.equal(closed.surface, 'editor');
			assert.equal(closed.previewRevision, 1);
		});
	});

	describe('2. Pass-through fedele documenti HTML in wrapPrototypeCode', () => {
		it('preserva intatti documenti HTML con doctype minuscolo (<!doctype html>)', () => {
			const fullHtml = '<!doctype html><html><head><title>Test</title></head><body><h1>Web Page</h1></body></html>';
			const wrapped = wrapPrototypeCode('Test Title', fullHtml);
			assert.equal(wrapped, fullHtml);
		});

		it('preserva intatti documenti HTML con tag <html lang="it"> senza doctype', () => {
			const htmlWithoutDoctype = '<html lang="it"><head><title>Page</title></head><body>Content</body></html>';
			const wrapped = wrapPrototypeCode('Page Title', htmlWithoutDoctype);
			assert.equal(wrapped, htmlWithoutDoctype);
		});
	});
});
