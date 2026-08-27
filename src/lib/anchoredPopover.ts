/**
 * Ancoraggio di un pannello sospeso a un elemento della pagina.
 *
 * Due pezzi in uno, perche' in un guscio desktop vanno sempre insieme:
 *
 * 1. **Top layer.** Il pannello dichiara `popover="manual"` e l'azione lo apre
 *    con `showPopover()`. Nel top layer non viene tagliato da nessun
 *    `overflow` e non partecipa alla lotta degli `z-index`. `manual` e non
 *    `auto` perche' la chiusura la governa il componente: `auto` chiuderebbe
 *    ogni altro popover aperto e sparirebbe al primo click, comportamento
 *    sbagliato per un pannello che nasce al passaggio del mouse.
 * 2. **Piazzamento in JS.** CSS Anchor Positioning risolverebbe tutto in due
 *    righe ma non esiste su WKWebView prima di Safari 26, quindi su macOS 14 e
 *    15 il pannello finirebbe fuori posto. Le coordinate si calcolano qui:
 *    ribaltamento sull'asse verticale quando sotto non c'e' spazio, blocco
 *    dentro i bordi della finestra, e ricalcolo su scroll, resize e
 *    cambio di dimensione del pannello.
 */

export type AnchorPlacement = 'bottom-start' | 'bottom-end';

export interface AnchoredOptions {
	/** Elemento a cui agganciarsi. Se manca, il pannello resta dov'e'. */
	anchor?: HTMLElement | null;
	/** Distanza fra ancora e pannello. */
	offset?: number;
	/** Margine minimo dai bordi della finestra. */
	padding?: number;
	placement?: AnchorPlacement;
	/** Notifica il ribaltamento: serve al pannello per spostare il ponte del
	 *  mouse dal lato giusto. */
	onFlip?: (flipped: boolean) => void;
}

const DEFAULTS = { offset: 6, padding: 8, placement: 'bottom-start' as AnchorPlacement };

export function anchoredPopover(node: HTMLElement, options: AnchoredOptions = {}) {
	let current = { ...DEFAULTS, ...options };
	let frame = 0;
	let flipped = false;

	// Se la Popover API non c'e' (WebKit < 17), l'attributo `popover` terrebbe
	// il nodo a `display: none`: meglio togliere l'attributo e lasciare che il
	// pannello viva come elemento fisso con il suo z-index.
	const supportsPopover = typeof node.showPopover === 'function';
	if (supportsPopover) {
		try {
			node.showPopover();
		} catch {
			// Gia' aperto: nessun problema, si passa al piazzamento.
		}
	} else {
		node.removeAttribute('popover');
	}

	function place() {
		frame = 0;
		const anchor = current.anchor;
		if (!anchor?.isConnected) return;

		const rect = anchor.getBoundingClientRect();
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		const { offset, padding, placement } = current;

		const spaceBelow = window.innerHeight - rect.bottom - offset - padding;
		const spaceAbove = rect.top - offset - padding;
		// Si ribalta solo se sopra c'e' davvero piu' spazio: un pannello alto
		// che non entra da nessuna parte resta sotto l'ancora, dove l'utente
		// lo aspetta, e scorre al proprio interno.
		const flip = height > spaceBelow && spaceAbove > spaceBelow;

		const top = flip
			? Math.max(padding, rect.top - offset - height)
			: Math.min(rect.bottom + offset, window.innerHeight - padding - height);

		const preferredLeft = placement === 'bottom-end' ? rect.right - width : rect.left;
		const maxLeft = window.innerWidth - padding - width;
		const left = Math.max(padding, Math.min(preferredLeft, Math.max(padding, maxLeft)));

		node.style.left = `${Math.round(left)}px`;
		node.style.top = `${Math.round(Math.max(padding, top))}px`;
		if (flip !== flipped) {
			flipped = flip;
			current.onFlip?.(flip);
		}
	}

	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(place);
	}

	// `scroll` in fase di capture: la barra delle tessere scorre in orizzontale
	// e non fa bubbling dell'evento fino a window.
	window.addEventListener('scroll', schedule, true);
	window.addEventListener('resize', schedule);
	const observer = new ResizeObserver(schedule);
	observer.observe(node);
	place();

	return {
		update(next: AnchoredOptions) {
			current = { ...DEFAULTS, ...next };
			schedule();
		},
		destroy() {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
			observer.disconnect();
			if (supportsPopover && node.isConnected) {
				try {
					node.hidePopover();
				} catch {
					// Chiuso da altri: niente da fare.
				}
			}
		}
	};
}
