// Generatore del documento HTML per l'anteprima isolata del Laboratorio prototipi.
//
// Invarianti garantiti:
//  1. Il tema della cornice di Studio NON impone il tema del prototipo:
//     il documento ha il proprio reset, font-stack e superficie;
//  2. Carica vendor.js fidato (React 19, Radix, Recharts, Lucide, Motion)
//     e tailwind.js (@tailwindcss/browser v4);
//  3. Script di ispezione visuale per la selezione bidirezionale degli elementi
//     (modalita' 'select' vs 'interact') compatibile con LabVisualTools.

export interface LabPreviewBuildOptions {
	readonly title?: string;
	readonly js: string;
	readonly css?: string;
	readonly canvasBackground?: 'light' | 'dark' | 'neutral';
	readonly vendorUrl?: string;
	readonly tailwindUrl?: string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function buildLabPreviewHtml(options: LabPreviewBuildOptions): string {
	const title = options.title ?? 'Prototipo Laboratorio';
	const js = options.js;
	const css = options.css ?? '';
	const vendorUrl = options.vendorUrl ?? '/lab/vendor.js';
	const tailwindUrl = options.tailwindUrl ?? '/lab/tailwind.js';

	const bgClass =
		options.canvasBackground === 'dark'
			? 'bg-neutral-900 text-neutral-100'
			: options.canvasBackground === 'neutral'
				? 'bg-neutral-100 text-neutral-800'
				: 'bg-white text-neutral-900';

	// Script di bridge leggero per consentire la selezione e ispezione degli elementi
	// senza esporre eval ne' privilege escalation.
	const inspectorBridgeScript = `
(function() {
  var currentMode = 'interact';
  var hoveredEl = null;

  var overlay = document.createElement('div');
  overlay.id = '__lab_inspect_overlay';
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.border = '2px solid #d8488c';
  overlay.style.backgroundColor = 'rgba(216, 72, 140, 0.12)';
  overlay.style.zIndex = '999999';
  overlay.style.display = 'none';
  overlay.style.transition = 'all 0.05s ease-out';
  overlay.style.borderRadius = '3px';

  var badge = document.createElement('div');
  badge.style.position = 'absolute';
  badge.style.bottom = '100%';
  badge.style.left = '0';
  badge.style.backgroundColor = '#d8488c';
  badge.style.color = '#ffffff';
  badge.style.fontFamily = 'monospace';
  badge.style.fontSize = '11px';
  badge.style.padding = '1px 5px';
  badge.style.borderRadius = '3px 3px 0 0';
  badge.style.whiteSpace = 'nowrap';
  overlay.appendChild(badge);

  document.addEventListener('DOMContentLoaded', function() {
    document.body.appendChild(overlay);
  });

  function getUniqueSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-variant')) return '[data-variant="' + el.getAttribute('data-variant') + '"]';
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';

    var path = [];
    var cur = el;
    while (cur && cur !== document.body && path.length < 4) {
      var tag = cur.tagName.toLowerCase();
      if (cur.className && typeof cur.className === 'string') {
        var cls = cur.className.split(/\\s+/).filter(function(c) {
          return c && !c.includes(':') && !c.includes('[') && !c.includes('/');
        }).slice(0, 2);
        if (cls.length > 0) tag += '.' + cls.join('.');
      }
      path.unshift(tag);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  function updateOverlay(el) {
    if (!el || currentMode !== 'select') {
      overlay.style.display = 'none';
      return;
    }
    var rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    badge.textContent = '<' + el.tagName.toLowerCase() + '> ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
  }

  document.addEventListener('mousemove', function(e) {
    if (currentMode !== 'select') return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (target && target !== overlay && !overlay.contains(target) && target !== hoveredEl) {
      hoveredEl = target;
      updateOverlay(hoveredEl);
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (currentMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();

    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    var rect = target.getBoundingClientRect();
    var selector = getUniqueSelector(target);
    var textContent = (target.innerText || target.textContent || '').trim().slice(0, 100);

    window.parent.postMessage({
      source: 'lab-renderer-bridge',
      type: 'element_selected',
      element: {
        tagName: target.tagName.toLowerCase(),
        id: target.id || undefined,
        selector: selector,
        textContent: textContent,
        box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        attributes: {
          role: target.getAttribute('role') || undefined,
          'aria-label': target.getAttribute('aria-label') || undefined
        }
      }
    }, '*');
  }, true);

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.source !== 'lab-parent-bridge') return;
    if (e.data.type === 'set_mode') {
      currentMode = e.data.mode;
      if (currentMode !== 'select') {
        overlay.style.display = 'none';
        hoveredEl = null;
      }
    }
  });
})();
`;

	return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script src="${escapeHtml(vendorUrl)}"><\/script>
  <script src="${escapeHtml(tailwindUrl)}"><\/script>
  <style>
    /* Reset essenziale isolato */
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    ${css}
  </style>
</head>
<body class="${bgClass}">
  <div id="root"></div>
  <script>
    ${inspectorBridgeScript}
  <\/script>
  <script>
    ${js}
  <\/script>
</body>
</html>`;
}
