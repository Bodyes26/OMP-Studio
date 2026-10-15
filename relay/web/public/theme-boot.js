// Tema dell'ultima macchina seguita, prima del primo paint: la CSP non ammette
// script inline, quindi la copia di `theme.ts` si rilegge da qui.
(function () {
	try {
		var css = localStorage.getItem('omp-remote-theme-css');
		if (!css) return;
		var root = document.documentElement;
		root.style.cssText = css;
		root.dataset.theme = /color-scheme:light/.test(css) ? 'light' : 'dark';
	} catch (e) {
		// Storage non disponibile: tema del sistema.
	}
})();
