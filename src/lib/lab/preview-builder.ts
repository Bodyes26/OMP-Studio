// Generatore del documento HTML per l'anteprima isolata del Laboratorio prototipi.
//
// Invarianti del documento:
//  1. Import map per React locale (/_vendor/) ed esm.sh per dipendenze esterne;
//  2. Tailwind CSS v4 browser runtime (/_vendor/tailwind.js) con tag <style type="text/tailwindcss">;
//  3. Bundle dell'applicazione caricato come modulo ESM (./app.js);
//  4. Shim in memoria per localStorage e sessionStorage (iframe opaco bloccherebbe l'accesso);
//  5. Bridge per la segnalazione degli errori di runtime a Studio;
//  6. Bridge per l'ispezione e selezione degli elementi del DOM con selettori CSS univoci.

export interface LabPreviewHtmlOptions {
	title?: string;
	importMap: Record<string, string>;
	compiledCss?: string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function buildLabPreviewHtml(options: LabPreviewHtmlOptions): string {
	const title = options.title ?? 'Prototipo Laboratorio';
	const importMapJson = JSON.stringify({ imports: options.importMap }, null, 2);
	const css = options.compiledCss ?? '';

	return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script type="importmap">
${importMapJson}
  </script>
  <script src="/_vendor/tailwind.js"></script>
  <style type="text/tailwindcss">
${css}
  </style>
  <script>
  /* Shim in-memory per Storage (l'iframe opaco sandbox senza allow-same-origin lancia SecurityError) */
  (function() {
    function createShimStorage() {
      var store = new Map();
      return {
        getItem: function(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
        setItem: function(k, v) { store.set(String(k), String(v)); },
        removeItem: function(k) { store.delete(String(k)); },
        clear: function() { store.clear(); },
        key: function(i) { return Array.from(store.keys())[i] || null; },
        get length() { return store.size; }
      };
    }
    try {
      var test = window.localStorage;
      if (!test) throw new Error();
      test.getItem('__test_access');
    } catch (_) {
      try {
        var memLocal = createShimStorage();
        var memSession = createShimStorage();
        Object.defineProperty(window, 'localStorage', { value: memLocal, configurable: true, writable: false });
        Object.defineProperty(window, 'sessionStorage', { value: memSession, configurable: true, writable: false });
      } catch (err) {
        /* Fallback silenzioso se l'ambiente blocca defineProperty */
      }
    }
  })();

  /* Bridge di segnalazione errori di runtime verso la finestra principale */
  (function() {
    function notifyError(err) {
      try {
        window.parent.postMessage({
          source: 'lab-preview',
          type: 'runtime_error',
          error: {
            kind: 'runtime',
            message: err.message || String(err),
            file: err.file || null,
            line: err.line != null ? Number(err.line) : null,
            column: err.column != null ? Number(err.column) : null
          }
        }, '*');
      } catch (_) {}
    }

    window.addEventListener('error', function(event) {
      notifyError({
        message: event.message || 'Errore di runtime',
        file: event.filename || null,
        line: event.lineno,
        column: event.colno
      });
    });

    window.addEventListener('unhandledrejection', function(event) {
      var reason = event.reason;
      var msg = (reason && (reason.stack || reason.message)) || String(reason || 'Unhandled Promise Rejection');
      notifyError({ message: msg });
    });

    var origConsoleError = console.error;
    console.error = function() {
      try {
        origConsoleError.apply(console, arguments);
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (typeof a === 'string') parts.push(a);
          else if (a instanceof Error) parts.push(a.message + (a.stack ? '\\n' + a.stack : ''));
          else {
            try { parts.push(JSON.stringify(a)); } catch (_) { parts.push(String(a)); }
          }
        }
        var fullMessage = parts.join(' ');
        notifyError({ message: fullMessage });
      } catch (_) {}
    };
  })();

  /* Bridge per la selezione interattiva degli elementi DOM */
  (function() {
    var selectMode = false;
    var overlayEl = null;

    function getOverlay() {
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.id = '__lab_inspect_overlay';
        overlayEl.style.position = 'fixed';
        overlayEl.style.pointerEvents = 'none';
        overlayEl.style.border = '2px solid #2563eb';
        overlayEl.style.backgroundColor = 'rgba(37, 99, 235, 0.12)';
        overlayEl.style.zIndex = '2147483647';
        overlayEl.style.display = 'none';
        overlayEl.style.transition = 'all 0.05s ease-out';
        overlayEl.style.borderRadius = '3px';
        document.documentElement.appendChild(overlayEl);
      }
      return overlayEl;
    }

    function computeSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return 'body';
      if (el.id) {
        try {
          return '#' + CSS.escape(el.id);
        } catch (_) {
          return '#' + el.id;
        }
      }
      var steps = [];
      var cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        var tag = cur.tagName.toLowerCase();
        var parent = cur.parentElement;
        if (parent) {
          var sameTagSiblings = Array.from(parent.children).filter(function(sibling) {
            return sibling.tagName === cur.tagName;
          });
          if (sameTagSiblings.length > 1) {
            var idx = sameTagSiblings.indexOf(cur) + 1;
            tag += ':nth-of-type(' + idx + ')';
          }
        }
        steps.unshift(tag);
        cur = parent;
      }
      return steps.join(' > ');
    }

    function updateHighlight(target) {
      var overlay = getOverlay();
      if (!selectMode || !target || target === document.body || target === document.documentElement) {
        overlay.style.display = 'none';
        return;
      }
      var rect = target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    }

    document.addEventListener('mousemove', function(e) {
      if (!selectMode) return;
      var target = document.elementFromPoint(e.clientX, e.clientY);
      updateHighlight(target);
    }, true);

    document.addEventListener('click', function(e) {
      if (!selectMode) return;
      e.preventDefault();
      e.stopPropagation();

      var target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;

      var rect = target.getBoundingClientRect();
      var selector = computeSelector(target);
      var textSnippet = (target.innerText || target.textContent || '').trim().slice(0, 120);

      window.parent.postMessage({
        source: 'lab-preview',
        type: 'element_selected',
        selector: selector,
        tag: target.tagName.toLowerCase(),
        textSnippet: textSnippet,
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }, '*');
    }, true);

    window.addEventListener('message', function(e) {
      if (!e.data || e.data.source !== 'lab-parent') return;
      if (e.data.type === 'toggle_select_mode') {
        selectMode = !!e.data.enabled;
        if (!selectMode && overlayEl) {
          overlayEl.style.display = 'none';
        }
      }
    });
  })();
  </script>
</head>
<body class="bg-white text-neutral-900 min-h-screen">
  <div id="root"></div>
  <script type="module" src="./app.js"></script>
</body>
</html>`;
}
