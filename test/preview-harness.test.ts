import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviewHarnessScript, injectPreviewHarness } from '../src/lib/prototype/harness.ts';

const HARNESS = '<script>/* HARNESS */</script>';
const lineCount = (s: string) => s.split('\n').length;

describe('iniezione dell\'harness delle anteprime (ANT-009)', () => {
	it('precede ogni altro script dentro <head>', () => {
		const doc = '<!DOCTYPE html>\n<html>\n<head>\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body></body>\n</html>';
		const result = injectPreviewHarness(doc, HARNESS);
		assert.ok(result.indexOf(HARNESS) > result.indexOf('<head>'));
		assert.ok(result.indexOf(HARNESS) < result.indexOf('cdn.tailwindcss.com'));
	});

	it('riconosce <head> con attributi e maiuscole, ma non <header>', () => {
		const doc = '<html><body><header>x</header></body></html>';
		const result = injectPreviewHarness(doc, HARNESS);
		assert.ok(result.startsWith('<html><head>' + HARNESS + '</head>'), 'senza <head> lo crea dopo <html>');

		const upper = '<!DOCTYPE html><html><HEAD class="t"><title>T</title></HEAD><body></body></html>';
		const injected = injectPreviewHarness(upper, HARNESS);
		assert.ok(injected.indexOf(HARNESS) > injected.indexOf('<HEAD class="t">'));
		assert.ok(injected.indexOf(HARNESS) < injected.indexOf('<title>'));
	});

	it('gestisce documenti con solo <!DOCTYPE> e frammenti nudi', () => {
		const onlyDoctype = injectPreviewHarness('<!DOCTYPE html><body><p>x</p></body>', HARNESS);
		assert.ok(onlyDoctype.indexOf(HARNESS) < onlyDoctype.indexOf('<body>'));
		assert.ok(injectPreviewHarness('<div>x</div>', HARNESS).startsWith(HARNESS));
	});

	it('non sposta i numeri di riga riportati all\'agente', () => {
		const harness = buildPreviewHarnessScript('id-1', true);
		assert.equal(lineCount(harness), 1, 'lo script reale deve stare su una riga');
		for (const doc of [
			'<!doctype html>\n<html>\n<head>\n</head>\n<body>\n<script>boom()</script>\n</body>\n</html>',
			'<!doctype html>\n<html lang="it">\n<body>\n</body>\n</html>',
			'<!doctype html>\n<body>\n</body>',
			'<div>\n</div>'
		]) {
			assert.equal(lineCount(injectPreviewHarness(doc, harness)), lineCount(doc));
		}
	});

	it('produce uno script sintatticamente valido', () => {
		for (const snapshot of [true, false]) {
			const body = buildPreviewHarnessScript('id-"quoted"', snapshot).replace(/^<script>|<\/script>$/g, '');
			assert.doesNotThrow(() => new Function(body));
		}
	});
});
