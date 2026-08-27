<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { suppressWebviewContextMenu } from '$lib/contextMenu';

	let { children } = $props();

	// Prima di qualunque pannello: il guscio deve nascere gia' del colore
	// giusto, senza un fotogramma con i token di default.
	themeStore.init();
	// Le personalizzazioni del guscio (barra, editor, terminale, default dei
	// task) vanno lette prima che i pannelli si disegnino: gli store che ne
	// dipendono attendono la stessa promessa memoizzata.
	void settingsStore.init();

	// Il menu contestuale della WebView (Ricarica / Indietro / Stampa) non ha
	// nulla da offrire in un'app desktop: resta solo dove serve davvero, cioe'
	// nei campi di testo, nell'editor e nel terminale.
	$effect(() => suppressWebviewContextMenu());
</script>

{@render children()}
