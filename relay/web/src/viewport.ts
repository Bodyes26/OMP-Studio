/**
 * Allinea il layout a fisso della PWA al viewport *visivo* del telefono.
 *
 * Su iOS la tastiera virtuale non ridimensiona il viewport di layout: copre il
 * fondo di tutto cio' che e' `position: fixed` (composer e domande) finche' il
 * layout non segue `visualViewport`. Pubblica tre cose su :root:
 * - `--app-height`: altezza visibile (barra di Safari e tastiera escluse);
 * - `--app-top`: scostamento del viewport visivo, per quando iOS scorre la pagina;
 * - `data-keyboard`: presente con la tastiera aperta, dove l'area sicura della
 *   barra home non c'e' piu' e non va sommata al padding del composer.
 */

/** Sotto questa differenza e' la barra degli indirizzi che si muove, non la tastiera. */
const KEYBOARD_MIN_DELTA_PX = 120;

export function initViewportSync(): void {
	const vv = window.visualViewport;
	if (!vv) return;
	const root = document.documentElement;
	let frame = 0;

	const apply = () => {
		frame = 0;
		// Lo zoom volontario della pagina non e' la tastiera: il layout resta
		// stabile mentre Safari ingrandisce il contenuto per l'accessibilita'.
		if (vv.scale !== 1) return;
		root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
		root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
		const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_DELTA_PX;
		if (keyboardOpen) root.dataset.keyboard = '';
		else delete root.dataset.keyboard;
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(apply);
	};

	vv.addEventListener('resize', schedule);
	vv.addEventListener('scroll', schedule);
	apply();
}
