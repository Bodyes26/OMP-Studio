// Harness di monitoraggio e reporting per le anteprime dei prototipi UI (ANT-009, ANT-010).
//
// Inietta uno script leggero prima di qualsiasi altro script nel documento HTML servito:
// - Intercetta window 'error' e 'unhandledrejection' catturando messaggio, riga e colonna.
// - Ispeziona #error-boundary per intercettare errori di montaggio React.
// - Attende la stabilizzazione del DOM (MutationObserver con debounce ~400ms o max 3s, font pronti).
// - Misura le dimensioni reali del documento (scrollWidth/scrollHeight).
// - Se snapshot e' richiesto, carica html-to-image da unpkg e cattura document.body
//   (html2canvas non funziona: clona la pagina in un iframe, vietato dall'origine opaca della sandbox).
// - Invia l'esito a Studio con window.parent.postMessage.

// Lo script viene ridotto a una sola riga e iniettato senza a capo: cosi' le righe degli
// errori riportati all'agente coincidono con quelle del suo file in proto/.
// Per questo il corpo non deve contenere commenti `//`.
// In fase di cattura arrivano anche i fallimenti di caricamento di img/script/link: non sono
// ErrorEvent e String(event) darebbe solo "[object Event]", quindi si riporta l'URL.
// Gli errori arrivati dopo l'invio dell'esito (es. caricamento della libreria di snapshot)
// non riguardano il codice dell'agente e vengono ignorati.
export function buildPreviewHarnessScript(id: string, snapshot: boolean): string {
	const safeId = JSON.stringify(id);
	const snapshotBool = snapshot ? 'true' : 'false';
	return `<script>
(function() {
  var previewId = ${safeId};
  var snapshotRequested = ${snapshotBool};
  var errors = [];
  var finished = false;

  function pushError(err) {
    if (!err || finished) return;
    errors.push(err);
  }

  window.addEventListener('error', function(event) {
    var target = event.target;
    if (target && target !== window && target.tagName) {
      var url = target.src || target.href || '';
      pushError({ message: 'Failed to load ' + target.tagName.toLowerCase() + (url ? ' ' + url : '') });
      return;
    }
    var msg = event.message || (event.error && event.error.message) || 'Unknown error';
    pushError({
      message: msg,
      source: event.filename || undefined,
      line: typeof event.lineno === 'number' ? event.lineno : undefined,
      column: typeof event.colno === 'number' ? event.colno : undefined
    });
  }, true);

  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var msg = (reason && reason.message) || String(reason || 'Unhandled rejection');
    pushError({
      message: 'Unhandled rejection: ' + msg
    });
  }, true);

  function checkErrorBoundary() {
    try {
      var eb = document.getElementById('error-boundary');
      if (eb) {
        var text = (eb.textContent || '').trim();
        var isVisible = !eb.classList.contains('hidden') && eb.style.display !== 'none';
        if (text && (isVisible || text.indexOf('Errore') !== -1 || text.indexOf('Error') !== -1)) {
          var exists = errors.some(function(e) { return e.message.indexOf(text) !== -1; });
          if (!exists) {
            pushError({ message: text });
          }
        }
      }
    } catch {}
  }

  function finishAck() {
    if (finished) return;
    checkErrorBoundary();
    finished = true;

    var width = Math.max(
      document.documentElement ? document.documentElement.scrollWidth : 0,
      document.body ? document.body.scrollWidth : 0,
      window.innerWidth || 1280
    );
    var height = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0,
      window.innerHeight || 800
    );

    function sendAck(snapshotData, snapshotError) {
      var payload = {
        type: 'studio-preview-ack',
        version: 1,
        id: previewId,
        ok: errors.length === 0,
        errors: errors,
        width: width,
        height: height
      };
      if (snapshotData) payload.snapshot = snapshotData;
      if (snapshotError) payload.snapshotError = snapshotError;
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, '*');
        }
      } catch (err) {
        console.error('Failed to postMessage preview ack', err);
      }
    }

    if (!snapshotRequested) {
      sendAck(null, null);
      return;
    }

    function capture() {
      try {
        var lib = window.htmlToImage;
        if (!lib || !document.body) {
          sendAck(null, 'html-to-image unavailable or document.body missing');
          return;
        }
        var shotWidth = Math.min(width, 1280);
        var shotHeight = Math.min(height, 2400);
        var bg = getComputedStyle(document.body).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.documentElement).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = '#ffffff';
        lib.toCanvas(document.body, {
          width: shotWidth,
          height: shotHeight,
          pixelRatio: 1,
          skipFonts: true,
          backgroundColor: bg,
          imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
        }).then(function(canvas) {
          var dataUrl = canvas.toDataURL('image/png');
          var mimeType = 'image/png';
          if (dataUrl.length > 500000) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            mimeType = 'image/jpeg';
          }
          var commaIdx = dataUrl.indexOf(',');
          sendAck({ mimeType: mimeType, data: commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl }, null);
        }).catch(function(err) {
          sendAck(null, 'Snapshot capture error: ' + ((err && err.message) || String(err)));
        });
      } catch (e) {
        sendAck(null, 'Snapshot exception: ' + ((e && e.message) || String(e)));
      }
    }

    if (window.htmlToImage) {
      capture();
    } else {
      var script = document.createElement('script');
      script.src = 'https://unpkg.com/html-to-image@1.11.13/dist/html-to-image.js';
      script.onload = capture;
      script.onerror = function() {
        sendAck(null, 'Failed to load html-to-image from unpkg');
      };
      (document.head || document.documentElement).appendChild(script);
    }
  }

  function startSettle() {
    var settleTimer = null;
    var maxTimeout = null;
    var observer = null;

    function resetTimer() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(done, 400);
    }

    function done() {
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimeout) clearTimeout(maxTimeout);
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      finishAck();
    }

    maxTimeout = setTimeout(done, 3000);

    if (typeof MutationObserver !== 'undefined' && (document.body || document.documentElement)) {
      try {
        observer = new MutationObserver(function() {
          resetTimer();
        });
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      } catch {}
    }

    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(function() {
        resetTimer();
      }).catch(function() {
        resetTimer();
      });
    }

    resetTimer();
  }

  if (document.readyState === 'complete') {
    startSettle();
  } else {
    window.addEventListener('load', function() {
      startSettle();
    }, { once: true });
  }
})();
</script>`.replace(/\n\s*/g, ' ');
}

/**
 * Inietta lo script harness come primissimo elemento in `<head>` (o subito dopo `<html>` / `<!DOCTYPE>`),
 * senza a capo aggiuntivi per non spostare i numeri di riga del documento.
 */
export function injectPreviewHarness(html: string, harnessScript: string): string {
	const headMatch = /<head(?:\s+[^>]*)?>/i.exec(html);
	if (headMatch) {
		const insertIndex = headMatch.index + headMatch[0].length;
		return html.slice(0, insertIndex) + harnessScript + html.slice(insertIndex);
	}
	const htmlMatch = /<html(?:\s+[^>]*)?>/i.exec(html);
	if (htmlMatch) {
		const insertIndex = htmlMatch.index + htmlMatch[0].length;
		return html.slice(0, insertIndex) + '<head>' + harnessScript + '</head>' + html.slice(insertIndex);
	}
	const docMatch = /<!doctype(?:\s+[^>]*)?>/i.exec(html);
	if (docMatch) {
		const insertIndex = docMatch.index + docMatch[0].length;
		return html.slice(0, insertIndex) + harnessScript + html.slice(insertIndex);
	}
	return harnessScript + html;
}
