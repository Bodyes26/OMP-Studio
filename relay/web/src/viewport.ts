/**
 * Allinea il layout a fisso della PWA al viewport *visivo* del telefono.
 *
 * Su iOS la tastiera virtuale non ridimensiona il viewport di layout: copre il
 * fondo di tutto cio' che e' `position: fixed` (composer e domande) finche' il
 * layout non segue `visualViewport`. Pubblica su :root:
 * - `--app-height`: altezza visibile (barra di Safari e tastiera escluse);
 * - `--app-top`: scostamento del viewport visivo, per quando iOS scorre la pagina;
 * - `data-keyboard`: presente con la tastiera aperta, dove l'area sicura della
 *   barra home non c'e' piu' e non va sommata al padding del composer;
 * - `data-standalone`: app aperta dalla schermata Home, con
 *   `--app-layout-height`, l'altezza vera dello schermo per la shell.
 *
 * Nell'app installata con `viewport-fit=cover` WebKit riporta
 * `visualViewport.height` (e `100dvh`) *meno* le aree sicure (WebKit 254868):
 * usarlo cosi' lascia una fascia vuota sotto il composer, anche con la tastiera
 * aperta. Un elemento `position: fixed` con `top: 0; bottom: 0` misura invece
 * l'altezza vera, e la differenza a tastiera chiusa dice se il difetto c'e'.
 */

/** Sotto questa differenza e' la barra degli indirizzi che si muove, non la tastiera. */
const KEYBOARD_MIN_DELTA_PX = 120;

function isStandalone(): boolean {
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * Sonda invisibile alta quanto il viewport di layout. Larga 0: iOS colora la
 * barra di stato prendendo il fondo degli elementi fissi larghi in cima, e una
 * sonda a tutta larghezza (trasparente) rimetterebbe la sfocatura.
 */
function createProbe(): HTMLElement {
	const probe = document.createElement('div');
	probe.setAttribute('aria-hidden', 'true');
	probe.style.cssText =
		'position:fixed;top:0;bottom:0;left:0;width:0;box-sizing:border-box;' +
		'padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
	document.body.appendChild(probe);
	return probe;
}

export function initViewportSync(): void {
	const vv = window.visualViewport;
	if (!vv) return;
	const root = document.documentElement;
	const standalone = isStandalone();
	if (standalone) root.dataset.standalone = '';
	const probe = standalone ? createProbe() : null;
	// Quanto WebKit toglie a `visualViewport.height`, misurato a tastiera chiusa.
	let closedDeficit = 0;
	let frame = 0;

	const apply = () => {
		frame = 0;
		// Lo zoom volontario della pagina non e' la tastiera: il layout resta
		// stabile mentre Safari ingrandisce il contenuto per l'accessibilita'.
		if (vv.scale !== 1) return;
		const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_DELTA_PX;
		let height = vv.height;
		if (probe) {
			const layoutHeight = probe.getBoundingClientRect().height;
			root.style.setProperty('--app-layout-height', `${Math.round(layoutHeight)}px`);
			if (!keyboardOpen) {
				height = Math.max(vv.height, layoutHeight - vv.offsetTop);
				closedDeficit = height - vv.height;
			} else {
				// Con la tastiera WebKit continua a togliere l'area della barra home
				// (WebKit 217754). Correzione limitata al difetto osservato a tastiera
				// chiusa: se iOS lo risolve, `closedDeficit` vale 0 e non si corregge.
				const insetBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
				height = vv.height + Math.min(insetBottom, closedDeficit);
			}
		}
		root.style.setProperty('--app-height', `${Math.round(height)}px`);
		root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
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
