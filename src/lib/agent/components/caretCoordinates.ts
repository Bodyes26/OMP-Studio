/**
 * Calcolo preciso delle coordinate (top, left, altezza) del cursore
 * all'interno di una textarea o input HTML, utilizzando un elemento specchio.
 *
 * Supporta a capo automatico, ritorni a capo manuali, scroll interno e font variabili.
 */

const CSS_PROPERTIES_TO_COPY = [
	'direction',
	'box-sizing',
	'width',
	'overflow-x',
	'overflow-y',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-top-style',
	'border-right-style',
	'border-bottom-style',
	'border-left-style',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'font-style',
	'font-variant',
	'font-weight',
	'font-stretch',
	'font-size',
	'font-size-adjust',
	'line-height',
	'font-family',
	'text-align',
	'text-transform',
	'text-indent',
	'text-decoration',
	'letter-spacing',
	'word-spacing',
	'tab-size',
	'-moz-tab-size',
	'word-break',
	'word-wrap',
	'overflow-wrap',
	'white-space'
] as const;

export interface CaretCoordinates {
	top: number;
	left: number;
	height: number;
	lineHeight: number;
}

let mirrorDiv: HTMLDivElement | null = null;

function getMirrorDiv(): HTMLDivElement | null {
	if (typeof document === 'undefined') return null;
	if (!mirrorDiv) {
		mirrorDiv = document.createElement('div');
		mirrorDiv.id = '__textarea_caret_mirror__';
		mirrorDiv.setAttribute('aria-hidden', 'true');
		document.body.appendChild(mirrorDiv);
	}
	return mirrorDiv;
}

/**
 * Restituisce le coordinate relative al container interno della textarea
 * sottraendo lo scroll corrente.
 */
export function getCaretCoordinates(
	element: HTMLTextAreaElement | HTMLInputElement,
	position: number
): CaretCoordinates {
	const mirror = getMirrorDiv();
	if (!mirror || typeof window === 'undefined') {
		return { top: 0, left: 0, height: 18, lineHeight: 18 };
	}

	const style = mirror.style;
	const computed = window.getComputedStyle(element);
	const isInput = element.nodeName === 'INPUT';

	// Reset base styles per nascondere il mirror fuori dallo schermo
	style.position = 'absolute';
	style.visibility = 'hidden';
	style.pointerEvents = 'none';
	style.top = '-9999px';
	style.left = '-9999px';
	style.overflow = 'hidden';
	style.whiteSpace = isInput ? 'nowrap' : 'pre-wrap';
	style.wordWrap = isInput ? 'normal' : 'break-word';
	style.overflowWrap = isInput ? 'normal' : 'break-word';

	// Copia degli stili computati
	for (const prop of CSS_PROPERTIES_TO_COPY) {
		const val = computed.getPropertyValue(prop);
		if (val) {
			style.setProperty(prop, val);
		}
	}

	const isBorderBox = computed.boxSizing === 'border-box';
	const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
	const borderRight = Number.parseFloat(computed.borderRightWidth) || 0;

	// clientWidth esclude la scrollbar verticale nativa
	if (isBorderBox) {
		style.width = `${element.clientWidth + borderLeft + borderRight}px`;
	} else {
		style.width = `${element.clientWidth}px`;
	}

	const text = element.value ?? '';
	const clampedPos = Math.max(0, Math.min(position, text.length));
	const textBefore = text.slice(0, clampedPos);
	const textAfter = text.slice(clampedPos);

	mirror.textContent = textBefore;

	const span = document.createElement('span');
	if (textAfter.length > 0 && textAfter[0] !== '\n') {
		span.textContent = textAfter[0];
	} else {
		span.textContent = '\u200b';
	}
	mirror.appendChild(span);

	const fontSize = Number.parseFloat(computed.fontSize) || 13;
	const parsedLineHeight = Number.parseFloat(computed.lineHeight);
	const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
		? parsedLineHeight
		: fontSize * 1.45;

	const spanHeight = span.offsetHeight;
	const height = spanHeight > 0 ? spanHeight : lineHeight;

	// Coordinate relative alla vista interna della textarea (sottraendo lo scroll)
	const top = span.offsetTop - element.scrollTop;
	const left = span.offsetLeft - element.scrollLeft;

	return {
		top,
		left,
		height: Math.min(height, lineHeight * 1.25),
		lineHeight
	};
}
export function cleanupCaretMirror() {
	if (mirrorDiv) {
		if (typeof mirrorDiv.remove === 'function') {
			mirrorDiv.remove();
		} else if (mirrorDiv.parentNode && typeof mirrorDiv.parentNode.removeChild === 'function') {
			mirrorDiv.parentNode.removeChild(mirrorDiv);
		}
		mirrorDiv = null;
	}
}
