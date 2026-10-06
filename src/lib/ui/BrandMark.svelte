<!--
  BrandMark.svelte — Pi greco squadrato di omp in un solo colore.

  Prende `currentColor`, quindi segue il tema senza varianti per chiaro e scuro.
  Il quadrato in fondo alla gamba corta resta distinguibile per opacita'.
  Stessa geometria di `assets/logo/mono.svg` (scripts/generate-logo.mjs):
  tetto 6t x 1t, gamba corta 2.5t, gamba lunga 4t, con t = 16.
-->
<script lang="ts">
	let { class: className = '', title = 'OMP Studio' } = $props<{
		class?: string;
		title?: string;
	}>();
</script>

<svg class={className} viewBox="0 0 96 80" fill="currentColor" role="img" aria-label={title}>
	<rect x="0" y="0" width="96" height="16" rx="1.1" />
	<rect x="24" y="8" width="16" height="32" rx="1.1" />
	<rect x="56" y="8" width="16" height="72" rx="1.1" />
	<rect x="24" y="40" width="16" height="16" rx="1.1" opacity="0.45" />
</svg>
