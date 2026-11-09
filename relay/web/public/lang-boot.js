// Lingua del documento prima del primo paint: la CSP non ammette script inline.
// Stessa regola di `i18n.ts` (`?lang=` in URL, poi navigator.language, inglese
// se nulla lo dice) cosi' l'attributo `lang` non parte mai da una lingua
// sbagliata; `i18n.ts` lo riallinea poi alla lingua attiva.
(function () {
	try {
		var lang = null;
		try {
			var param = new URLSearchParams(window.location.search).get('lang');
			if (param && /^(it|en)$/i.test(param)) lang = param.toLowerCase();
		} catch (e) {
			// URL non leggibile: si passa a navigator
		}
		if (!lang && typeof navigator !== 'undefined' && navigator.language) {
			lang = navigator.language.toLowerCase().indexOf('it') === 0 ? 'it' : 'en';
		}
		document.documentElement.lang = lang || 'en';
	} catch (e) {
		// Documento non disponibile: resta il valore dell'HTML.
	}
})();
