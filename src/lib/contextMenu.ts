/**
 * Soppressione del menu contestuale della WebView.
 *
 * Perche' serve: `wry` lascia `default_context_menus = true` anche nelle build
 * di release (in release cade solo "Ispeziona elemento"), quindi il click destro
 * su un pannello di Studio offrirebbe Ricarica / Indietro / Stampa, voci che in
 * un guscio desktop non significano niente.
 *
 * Il blocco non e' cieco: dove il menu nativo e' l'unico modo per tagliare,
 * copiare e incollare resta al suo posto. Il click destro con del testo
 * selezionato resta nativo per la stessa ragione.
 *
 * Un componente che ha un menu proprio chiama `preventDefault()` sul suo
 * gestore: l'evento arriva qui con `defaultPrevented` a vero e non viene
 * toccato di nuovo.
 */

/** Campi in cui il menu nativo di modifica testo e' l'unica alternativa. */
const TEXT_ENTRY_SELECTOR = [
	'input:not([type="button"]):not([type="submit"]):not([type="reset"])',
	'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])',
	'textarea',
	'[contenteditable="true"]',
	'[contenteditable=""]'
].join(', ');

/** Superfici con un menu contestuale proprio o con clipboard nativa. */
const NATIVE_MENU_HOSTS = ['.monaco-editor', '.xterm'];

export function suppressWebviewContextMenu(): () => void {
	function onContextMenu(event: MouseEvent) {
		if (event.defaultPrevented) return;

		const target = event.target as HTMLElement | null;
		if (target) {
			if (target.closest(TEXT_ENTRY_SELECTOR)) return;
			if (NATIVE_MENU_HOSTS.some((host) => target.closest(host))) return;
		}
		if (window.getSelection()?.toString().trim()) return;

		event.preventDefault();
	}

	document.addEventListener('contextmenu', onContextMenu);
	return () => document.removeEventListener('contextmenu', onContextMenu);
}
