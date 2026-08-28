<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
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
</script>

{@render children()}

<ContextMenu />
