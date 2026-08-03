<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';

	let { children } = $props();

	// Prima di qualunque pannello: il guscio deve nascere gia' del colore
	// giusto, senza un fotogramma con i token di default.
	themeStore.init();
</script>

{@render children()}