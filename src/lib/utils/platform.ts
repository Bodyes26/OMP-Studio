/**
 * Piattaforma del guscio, dedotta una volta sola all'avvio.
 *
 * Serve dove la stessa interfaccia deve comportarsi in modo diverso su
 * sistemi diversi: i controlli finestra (su macOS li disegna il sistema, su
 * Windows li disegna Studio), il modificatore nelle scorciatoie e gli stack
 * di font del canvas.
 *
 * La deduzione passa da `navigator` perche' e' sincrona: un `invoke` verso
 * Rust arriverebbe dopo il primo rendering e la barra sfarfallerebbe con i
 * controlli sbagliati. La webview e' una sola per piattaforma (WKWebView su
 * macOS, WebView2 su Windows), quindi la stringa non e' ambigua.
 */

export type ShellPlatform = 'macos' | 'windows' | 'other';

/**
 * Funzione pura: e' quella che decide se compaiono i controlli finestra di
 * Windows, quindi va verificata sulle stringhe reali delle due webview.
 */
export function detectShellPlatform(userAgent: string, platform: string): ShellPlatform {
	const probe = `${platform} ${userAgent}`;
	if (/mac|iphone|ipad/i.test(probe)) return 'macos';
	if (/win/i.test(probe)) return 'windows';
	return 'other';
}

export const SHELL_PLATFORM: ShellPlatform =
	typeof navigator === 'undefined'
		? 'other'
		: detectShellPlatform(navigator.userAgent || '', navigator.platform || '');

export const IS_MAC = SHELL_PLATFORM === 'macos';

/** Il tasto modificatore mostrato nelle scorciatoie e nei menu contestuali. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
