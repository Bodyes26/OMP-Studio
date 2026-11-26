// Il caricatore immagini del form `ask` e' dentro `extensions/studio-ask.ts`
// dal 19.2, quando OMP ha ritirato i moduli `pi-tui/media` e
// `pi-tui/html-form/media`: qui si verifica che il sostituto legga i file del
// progetto, accetti le data URI e rifiuti tutto cio' che sta fuori dal progetto.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { imageSource, loadFormImage } from '../extensions/studio-ask.ts';

/** PNG 1x1 trasparente: un raster valido senza dipendenze. */
const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

const roots: string[] = [];
function project(): { cwd: string; outside: string } {
	const base = mkdtempSync(join(tmpdir(), 'studio-ask-media-'));
	roots.push(base);
	const cwd = join(base, 'project');
	const outside = join(base, 'outside');
	mkdirSync(cwd);
	mkdirSync(outside);
	return { cwd, outside };
}

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('immagini del modulo ask senza i moduli media di OMP', () => {
	it('legge un file dentro il progetto e ne ricava il MIME', async () => {
		const { cwd } = project();
		writeFileSync(join(cwd, 'chart.png'), PNG_1X1);
		const loaded = await loadFormImage('chart.png', { cwd });
		assert.equal(loaded.mime, 'image/png');
		assert.deepEqual(Buffer.from(loaded.bytes), PNG_1X1);
	});

	it('legge un file assoluto confinato e nega il symlink che esce dal progetto', async () => {
		const { cwd, outside } = project();
		writeFileSync(join(outside, 'secret.png'), PNG_1X1);
		writeFileSync(join(cwd, 'inside.png'), PNG_1X1);
		await assert.doesNotReject(loadFormImage(join(cwd, 'inside.png'), { cwd }));
		await assert.rejects(loadFormImage('../outside/secret.png', { cwd }), /fuori dalla cartella|outside the project/i);
		// Giunzione di cartella: su Windows non chiede privilegi (un symlink di
		// file si', EPERM senza modalita' sviluppatore); su POSIX e' un symlink.
		symlinkSync(outside, join(cwd, 'linked'), 'junction');
		assert.throws(() => imageSource(join('linked', 'secret.png'), cwd), /fuori dalla cartella|outside the project/i);
	});

	it('accetta data URI base64 e percent-encoded senza toccare il disco', async () => {
		const { cwd } = project();
		const base64 = await loadFormImage(`data:image/png;base64,${PNG_1X1.toString('base64')}`, { cwd });
		assert.equal(base64.mime, 'image/png');
		assert.deepEqual(Buffer.from(base64.bytes).subarray(0, 8), PNG_1X1.subarray(0, 8));
		const svg = await loadFormImage(
			`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 10 20"><rect/></svg>')}`,
			{ cwd }
		);
		assert.equal(svg.mime, 'image/svg+xml');
		const markup = new TextDecoder().decode(svg.bytes);
		assert.match(markup, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		assert.match(markup, /width="10"/);
		assert.match(markup, /height="20"/);
	});

	it('rifiuta un file che non e un immagine', async () => {
		const { cwd } = project();
		writeFileSync(join(cwd, 'notes.txt'), 'solo testo');
		await assert.rejects(loadFormImage('notes.txt', { cwd }), /PNG, JPEG, GIF, WebP o SVG|Not a PNG/);
	});
});
