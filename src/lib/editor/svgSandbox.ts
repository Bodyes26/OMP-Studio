// Isolamento e sanitizzazione delle anteprime SVG per prevenire attacchi XSS nel contesto privilegiato di Tauri.
//
// L'approccio adotta una strategia di difesa a piu' livelli (defense-in-depth):
// 1. Sanitizzazione primaria con DOMPurify (profilo SVG restrittivo, rimozione di <script>, <foreignObject>, <iframe>, <object>, <embed>, attributi on* e URI pericolosi).
// 2. Sanitizzazione secondaria euristica di sicurezza (rimozione dichiarazioni XXE/DOCTYPE malevole, tag script ed handler residui in qualsiasi contesto).
// 3. Incapsulamento in documento HTML5 completo con Content-Security-Policy ermetica:
//    - default-src 'none' (blocca ogni script, fetch, connessione di rete, worker, frame ed oggetto)
//    - style-src 'unsafe-inline' (consente solo gli stili inline necessari al rendering vettoriale)
//    - img-src data: blob: (consente solo immagini incorporate legittime)
// 4. Rendering all'interno di un <iframe> con sandbox="" (senza 'allow-scripts' e senza 'allow-same-origin'):
//    - Il motore del browser disabilita l'esecuzione di qualsiasi codice JavaScript a livello fondamentale.
//    - L'origine dell'iframe e' 'null' (completamente disaccoppiata dall'origine dell'app).
//    - Nessun accesso a window.parent, window.top, localStorage o alle API IPC privilegiate di Tauri (window.__TAURI__, invoke, etc.).

import DOMPurify from 'dompurify';

/**
 * Rimuove costrutti pericolosi dal markup SVG tramite filtri strutturali euristici
 * per garantire protezione anche qualora il parser DOM del browser non fosse attivo.
 */
function sanitizeSvgFallback(svg: string): string {
	if (!svg || typeof svg !== 'string') return '';
	return svg
		// Rimuove istruzioni XML e fogli di stile esterni
		.replace(/<\?xml-stylesheet\b[\s\S]*?\?>/gi, '')
		.replace(/<\?xml\b[\s\S]*?\?>/gi, '')
		// Rimuove dichiarazioni DOCTYPE (inclusi sottoinsiemi DTD tra parentesi quadre) ed ENTITY (protezione XXE)
		.replace(/<!DOCTYPE\b(?:\s+[^>[\]]*(?:\[[\s\S]*?\])?\s*)?>/gi, '')
		.replace(/<!ENTITY\b[\s\S]*?>/gi, '')
		// Rimuove tag script e foreignObject con tutto il loro contenuto
		.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
		.replace(/<script\b[^>]*\/?>/gi, '')
		.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
		.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '')
		.replace(/<object\b[\s\S]*?<\/object\s*>/gi, '')
		.replace(/<embed\b[^>]*\/?>/gi, '')
		// Rimuove tutti i gestori di eventi on* (es. onload, onerror, onclick, onbegin, etc.)
		.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		// Rimuove schemi javascript: e vbscript: negli attributi href/xlink:href/src/action
		.replace(/(?:href|xlink:href|src|action)\s*=\s*["']\s*(?:javascript|vbscript|data:\s*text\/html):[^"']*["']/gi, '')
		.replace(/(?:href|xlink:href|src|action)\s*=\s*(?:javascript|vbscript|data:\s*text\/html):[^\s>]+/gi, '');
}

/**
 * Ottiene un'istanza funzionante di DOMPurify nel contesto corrente.
 */
function getDOMPurifyInstance() {
	if (typeof window !== 'undefined') {
		if (DOMPurify && DOMPurify.isSupported && typeof DOMPurify.sanitize === 'function') {
			return DOMPurify;
		}
		if (typeof DOMPurify === 'function') {
			try {
				const instance = (DOMPurify as unknown as (w: Window) => typeof DOMPurify)(window);
				if (instance && typeof instance.sanitize === 'function') {
					return instance;
				}
			} catch {
				// Fallback sotto
			}
		}
	}
	return DOMPurify;
}

/**
 * Sanitizza una stringa SVG rimuovendo tag ed attributi eseguibili.
 */
export function sanitizeSvg(svg: string): string {
	if (!svg || typeof svg !== 'string') return '';

	let sanitized = svg;
	const purifier = getDOMPurifyInstance();

	if (purifier && purifier.isSupported && typeof purifier.sanitize === 'function') {
		try {
			sanitized = purifier.sanitize(svg, {
				USE_PROFILES: { svg: true, svgFilters: true },
				FORBID_TAGS: [
					'script',
					'foreignObject',
					'iframe',
					'frame',
					'frameset',
					'object',
					'embed',
					'applet',
					'base',
					'meta',
					'link',
					'form',
					'input',
					'button',
					'textarea',
					'select',
					'audio',
					'video'
				],
				FORBID_ATTR: [
					'onload',
					'onerror',
					'onclick',
					'onmouseover',
					'onfocus',
					'onblur',
					'onbegin',
					'onend',
					'onrepeat',
					'onloadend',
					'onloadstart',
					'onabort',
					'onresize',
					'onscroll',
					'onunload',
					'oncontextmenu',
					'ondblclick',
					'onmousedown',
					'onmouseenter',
					'onmouseleave',
					'onmousemove',
					'onmouseout',
					'onmouseup',
					'onkeydown',
					'onkeypress',
					'onkeyup'
				],
				ALLOW_DATA_ATTR: false
			});
		} catch {
			sanitized = sanitizeSvgFallback(svg);
		}
	}

	// Applica sempre la sanitizzazione strutturale di secondo livello
	return sanitizeSvgFallback(sanitized);
}

/**
 * Genera il markup HTML completo per un iframe sandboxed isolato.
 * Include CSP restrittiva che impedisce connessioni di rete, script e accessi IPC.
 */
export function buildSandboxedSvgDocument(svgContent: string): string {
	const clean = sanitizeSvg(svgContent);
	const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;";

	return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      background: transparent;
    }
    svg {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      display: block;
      object-fit: contain;
    }
  </style>
</head>
<body>
  ${clean}
</body>
</html>`;
}

/**
 * Verifica se un percorso file ha estensione SVG.
 */
export function isSvgFileName(path: string | null | undefined): boolean {
	if (!path) return false;
	const clean = path.split('?')[0].split('#')[0];
	const ext = clean.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
	return ext === 'svg';
}

/**
 * Verifica se il contenuto testuale inizia o contiene markup SVG.
 */
export function isSvgContent(content: string | null | undefined): boolean {
	if (!content || typeof content !== 'string') return false;
	const trimmed = content.trim();
	return trimmed.startsWith('<svg') || (trimmed.startsWith('<?xml') && trimmed.includes('<svg'));
}
