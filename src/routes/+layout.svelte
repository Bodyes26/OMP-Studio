<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { THEMES, anchorsFor } from '$lib/theme';
	import { installContextMenuHandling } from '$lib/contextMenu.svelte';
	import ContextMenu from '$lib/components/ContextMenu.svelte';

	let { children } = $props();

	// Prima di qualunque pannello: il guscio deve nascere gia' del colore
	// giusto, senza un fotogramma con i token di default.
	themeStore.init();
	// Le personalizzazioni del guscio (barra, editor, terminale, default dei
	// task) vanno lette prima che i pannelli si disegnino: gli store che ne
	// dipendono attendono la stessa promessa memoizzata.
	void settingsStore.init();

	// Un unico listener sopprime il menu nativo della WebView e inoltra il
	// click alle superfici con menu tematizzato: input, Monaco, xterm e file tree.
	$effect(() => installContextMenuHandling());

	// Sincronizza l'attributo data-animations sull'elemento radice per il controllo globale CSS
	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.animations = settingsStore.accessibility.animations ? 'true' : 'false';
		}
	});

	/**
	 * Palette fissa OKLCh per i colori semaforo della quota (C4).
	 *
	 * Sono previste due varianti distinte per tema chiaro e tema scuro:
	 * la stessa tinta a luminosita' (L) diversa mantiene un contrasto WCAG
	 * sufficiente sia sul pozzo scuro che sullo sfondo chiaro.
	 * Le variabili `--quota-*` definiscono il colore pieno (testo, bordi, indicatori),
	 * mentre `--quota-*-fill` include l'alpha calibrata per la barra di riempimento.
	 */
	const QUOTA_SEMANTIC_PALETTES = {
		light: {
			'--quota-ok': 'oklch(0.58 0.16 145)',
			'--quota-ok-fill': 'oklch(0.58 0.16 145 / 0.30)',
			'--quota-warn': 'oklch(0.68 0.15 80)',
			'--quota-warn-fill': 'oklch(0.68 0.15 80 / 0.32)',
			'--quota-bad': 'oklch(0.55 0.20 25)',
			'--quota-bad-fill': 'oklch(0.55 0.20 25 / 0.30)'
		},
		dark: {
			'--quota-ok': 'oklch(0.74 0.18 145)',
			'--quota-ok-fill': 'oklch(0.74 0.18 145 / 0.34)',
			'--quota-warn': 'oklch(0.82 0.16 88)',
			'--quota-warn-fill': 'oklch(0.82 0.16 88 / 0.36)',
			'--quota-bad': 'oklch(0.66 0.21 25)',
			'--quota-bad-fill': 'oklch(0.66 0.21 25 / 0.34)'
		}
	} as const;

	const QUOTA_CSS_VARIABLES = [
		'--quota-ok',
		'--quota-ok-fill',
		'--quota-warn',
		'--quota-warn-fill',
		'--quota-bad',
		'--quota-bad-fill'
	] as const;

	// Sincronizza le variabili semaforo della quota su :root in base alle impostazioni e al tema attivo
	$effect(() => {
		if (typeof document === 'undefined') return;

		const style = document.documentElement.style;
		const enabled = settingsStore.appearance.quotaChip.semanticColors;

		if (!enabled) {
			for (const prop of QUOTA_CSS_VARIABLES) {
				style.removeProperty(prop);
			}
			return;
		}

		// Determina se il tema corrente e' chiaro: la lettura di themeStore.current
		// crea la dipendenza reattiva Svelte necessaria per ricalcolare la variante al cambio tema.
		const currentTheme = THEMES[themeStore.current];
		const isLight = currentTheme
			? anchorsFor(currentTheme).isLight
			: style.getPropertyValue('color-scheme') === 'light';

		const palette = isLight ? QUOTA_SEMANTIC_PALETTES.light : QUOTA_SEMANTIC_PALETTES.dark;
		for (const [prop, value] of Object.entries(palette)) {
			style.setProperty(prop, value);
		}

		return () => {
			for (const prop of QUOTA_CSS_VARIABLES) {
				style.removeProperty(prop);
			}
		};
	});
</script>

{@render children()}

<ContextMenu />
