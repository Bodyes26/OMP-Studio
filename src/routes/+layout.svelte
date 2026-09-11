<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { i18n } from '$lib/i18n/i18n.svelte';
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
	i18n.initialize();

	// La preferenza persistita governa Paraglide senza ricaricare la WebView:
	// cambiare lingua non deve interrompere RPC, terminali o sessioni in corso.
	$effect(() => {
		i18n.setPreference(settingsStore.general.language);
	});

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
	 * Le variabili `--quota-sem-*` costituiscono un namespace neutro sempre disponibile su :root;
	 * l'attivazione effettiva avviene per superficie tramite la classe `.quota-semantic`,
	 * che rimappa `--quota-*` su queste variabili. Senza tale classe, i componenti usano
	 * i colori del tema come fallback.
	 */
	const QUOTA_SEMANTIC_PALETTES = {
		light: {
			'--quota-sem-ok': 'oklch(0.58 0.16 145)',
			'--quota-sem-ok-fill': 'oklch(0.58 0.16 145 / 0.30)',
			'--quota-sem-warn': 'oklch(0.68 0.15 80)',
			'--quota-sem-warn-fill': 'oklch(0.68 0.15 80 / 0.32)',
			'--quota-sem-bad': 'oklch(0.55 0.20 25)',
			'--quota-sem-bad-fill': 'oklch(0.55 0.20 25 / 0.30)'
		},
		dark: {
			'--quota-sem-ok': 'oklch(0.74 0.18 145)',
			'--quota-sem-ok-fill': 'oklch(0.74 0.18 145 / 0.34)',
			'--quota-sem-warn': 'oklch(0.82 0.16 88)',
			'--quota-sem-warn-fill': 'oklch(0.82 0.16 88 / 0.36)',
			'--quota-sem-bad': 'oklch(0.66 0.21 25)',
			'--quota-sem-bad-fill': 'oklch(0.66 0.21 25 / 0.34)'
		}
	} as const;

	const QUOTA_CSS_VARIABLES = [
		'--quota-sem-ok',
		'--quota-sem-ok-fill',
		'--quota-sem-warn',
		'--quota-sem-warn-fill',
		'--quota-sem-bad',
		'--quota-sem-bad-fill'
	] as const;

	// Inietta le variabili semaforo neutrali della quota su :root in base al tema attivo.
	// L'attivazione effettiva avviene per superficie tramite la classe `.quota-semantic`.
	$effect(() => {
		if (typeof document === 'undefined') return;

		const style = document.documentElement.style;

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
