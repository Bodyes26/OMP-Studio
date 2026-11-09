// Generatore del documento HTML per l'anteprima isolata del Laboratorio prototipi.
//
// Invarianti del documento:
//  1. Import map per React locale (/_vendor/) ed esm.sh per dipendenze esterne;
//  2. Tailwind CSS v4 browser runtime (/_vendor/tailwind.js) con tag <style type="text/tailwindcss">;
//  3. Bundle dell'applicazione caricato come modulo ESM (./app.js);
//  4. Shim in memoria per localStorage e sessionStorage (iframe opaco bloccherebbe l'accesso);
//  5. Bridge per la segnalazione degli errori di runtime a Studio;
//  6. Ispettore «Indica e disegna» (modulo ES inline, prima di app.js): Punta, Riquadro,
//     marker numerati, riaggancio dopo la ricompilazione e cattura del fotogramma
//     (inspect/inspector-client.js, protocollo `inspect_*` v2, Gate R42).

import inspectorSource from './inspect/inspector-client.js?raw';
import { PREVIEW_SHORTCUT_SCRIPT } from '../shortcuts/previewShortcuts.ts';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';

/** Sorgente dell'ispettore pronto per un `<script type="module">` inline. */
export function buildInspectorModule(source: string = inspectorSource): string {
	// I messaggi della cattura nascono nell'iframe, dove Paraglide non arriva:
	// Studio li risolve qui, nella lingua attiva, e li passa come letterale.
	const strings = JSON.stringify({
		readFailed: m.l10n_lab_remote_capture_read_failed(),
		imageCorsFailed: m.l10n_lab_remote_capture_image_cors(),
		imageTimeout: m.l10n_lab_remote_capture_image_timeout(),
		fontTimeout: m.l10n_lab_remote_capture_font_timeout(),
		tooManyFonts: m.l10n_lab_remote_capture_too_many_fonts(),
		emptyDocument: m.l10n_lab_remote_capture_empty_document(),
		frameSvgInvalid: m.l10n_lab_remote_capture_frame_svg_invalid(),
		frameTimeout: m.l10n_lab_remote_capture_frame_timeout()
	});
	// Un `</script` letterale chiuderebbe il tag in anticipo.
	return (
		source.replace(/<\/script/gi, '<\\/script') +
		`\ninstallLabInspector(window, ${strings});\n`
	);
}

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
	const title = options.title ?? m.l10n_lab_remote_preview_default_title();
	const importMapJson = JSON.stringify({ imports: options.importMap }, null, 2);
	const css = options.compiledCss ?? '';
	const inspectorModule = buildInspectorModule();
	// Lo script inline dell'anteprima gira in un'altra origine: la lingua
	// attiva viaggia come letterale JS gia' risolto.
	const runtimeErrorText = JSON.stringify(m.l10n_lab_remote_preview_runtime_error());
	const unhandledRejectionText = JSON.stringify(m.l10n_lab_remote_preview_unhandled_rejection());

	return `<!doctype html>
<html lang="${escapeHtml(getLocale())}">
<head>
  ${PREVIEW_SHORTCUT_SCRIPT}
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
        message: event.message || ${runtimeErrorText},
        file: event.filename || null,
        line: event.lineno,
        column: event.colno
      });
    });

    window.addEventListener('unhandledrejection', function(event) {
      var reason = event.reason;
      var msg = (reason && (reason.stack || reason.message)) || String(reason || ${unhandledRejectionText});
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

  </script>
  <script type="module">
${inspectorModule}
  </script>
</head>
<body class="bg-white text-neutral-900 min-h-screen">
  <div id="root"></div>
  <script type="module" src="./app.js"></script>
</body>
</html>`;
}
