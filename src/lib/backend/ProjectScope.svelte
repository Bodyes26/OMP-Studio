<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { LOCAL_MACHINE } from './ipc.ts';
	import { provideProjectBackend } from './projectScope.ts';

	let { machine = LOCAL_MACHINE, children } = $props<{ machine?: string; children: Snippet }>();
	// Il chiamante usa una key di progetto: anche il lavoro asincrono conserva
	// la destinazione originale quando si passa a un'altra scheda.
	provideProjectBackend(untrack(() => machine));
</script>

{@render children()}
