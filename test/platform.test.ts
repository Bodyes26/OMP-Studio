import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectShellPlatform } from '../src/lib/utils/platform.ts';

// Stringhe reali delle due webview che Studio usa: da queste dipende se la
// barra disegna i controlli finestra di Windows o lascia spazio ai semafori
// nativi di macOS.
const WK_WEBVIEW_MACOS =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const WEBVIEW2_WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

describe('Piattaforma del guscio', () => {
	it('riconosce WKWebView su macOS', () => {
		assert.equal(detectShellPlatform(WK_WEBVIEW_MACOS, 'MacIntel'), 'macos');
		assert.equal(detectShellPlatform(WK_WEBVIEW_MACOS, ''), 'macos');
	});

	it('riconosce WebView2 su Windows', () => {
		assert.equal(detectShellPlatform(WEBVIEW2_WINDOWS, 'Win32'), 'windows');
		assert.equal(detectShellPlatform(WEBVIEW2_WINDOWS, ''), 'windows');
	});

	it('non confonde le due piattaforme', () => {
		assert.notEqual(detectShellPlatform(WK_WEBVIEW_MACOS, 'MacIntel'), 'windows');
		assert.notEqual(detectShellPlatform(WEBVIEW2_WINDOWS, 'Win32'), 'macos');
	});

	it('ripiega su other quando la stringa non dice niente', () => {
		assert.equal(detectShellPlatform('', ''), 'other');
		assert.equal(
			detectShellPlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Linux x86_64'),
			'other'
		);
	});
});
