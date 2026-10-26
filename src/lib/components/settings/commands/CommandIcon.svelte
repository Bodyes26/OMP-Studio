<!--
  CommandIcon.svelte — Risolve dinamicamente un'icona del catalogo comandi
  da quelle esportate in `#lib/icons.ts`.
-->
<script lang="ts">
	import * as icons from '#lib/icons.ts';
	import { IconTerminal } from '#lib/icons.ts';

	let {
		icon,
		class: className = ''
	}: {
		icon?: string;
		class?: string;
	} = $props();

	const ResolvedIcon = $derived.by(() => {
		if (icon && (icons as Record<string, any>)[icon]) {
			return (icons as Record<string, any>)[icon];
		}
		return IconTerminal;
	});
</script>

<ResolvedIcon class={className} />
