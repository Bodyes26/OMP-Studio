<!--
  MachineGlyph.svelte — Dove vive un progetto, senza testo (R-MI-19, R-REM-17).

  Porta il disegno di Studio (`src/lib/ui/MachineGlyph.svelte`): lo schermo con
  le onde e' «un'altra macchina», barrato e' «non raggiungibile»; per un
  progetto su piu' macchine uno schermo per copia, pieno quella che la riga
  apre, contorno quella in linea, tratteggio quella spenta, collegati dalle
  frecce di andata e ritorno. Il nome delle macchine lo dicono l'etichetta
  accessibile e la riga.
-->
<script lang="ts">
	import type { GlyphSpec, MachineMark } from '../multiMachine.ts';

	let {
		glyph,
		size = 14
	}: {
		glyph: GlyphSpec;
		/** Altezza in px; la larghezza segue il disegno. */
		size?: number;
	} = $props();

	// Geometria su una griglia alta 16, come in Studio.
	const SCREEN = 9;
	const gap = 7;
	const marks = $derived<MachineMark[]>(glyph.copies ?? []);
	const width = $derived(
		glyph.kind === 'copies'
			? 2 + Math.max(1, marks.length) * SCREEN + Math.max(0, marks.length - 1) * gap
			: glyph.kind === 'remote'
				? 20
				: 16
	);
	const screens = $derived(marks.map((mark, index) => ({ mark, x: 1 + index * (SCREEN + gap) })));
	const links = $derived(
		screens.slice(0, -1).map((screen) => {
			const x1 = screen.x + SCREEN;
			return { x1, x2: x1 + gap, mid: x1 + gap / 2 };
		})
	);
</script>

<svg
	class="machine-glyph"
	viewBox="0 0 {width} 16"
	style:height="{size}px"
	style:width="{(size * width) / 16}px"
	aria-hidden="true"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#if glyph.kind === 'offline'}
		<rect x="1" y="3.5" width="14" height="9.5" rx="1.6" />
		<path d="M8 13v2.4M5.6 15.4h4.8" />
		<path d="M1.5 1.5 15 15" />
	{:else if glyph.kind === 'remote'}
		<rect x="1" y="6.5" width="12" height="7" rx="1.6" />
		<path d="M7 13.5v2.4M4.6 15.9h4.8" />
		<path d="M13 3.6a2.9 2.9 0 0 1 2.9 2.9M13 0.8a5.7 5.7 0 0 1 5.7 5.7" />
	{:else}
		{#each screens as screen, index (index)}
			<g class:off={screen.mark === 'off'}>
				<rect x={screen.x} y="4.5" width={SCREEN} height="7" rx="1.6" class:use={screen.mark === 'use'} />
				<path class="stand" d="M{screen.x + SCREEN / 2} 11.5v2.4M{screen.x + SCREEN / 2 - 2.4} 13.9h4.8" />
			</g>
		{/each}
		{#each links as link, index (index)}
			<path
				stroke-width="1.3"
				d="M{link.x1 + 1} 6.4H{link.x2 - 1}m-1.4-1.4 1.4 1.4-1.4 1.4M{link.x2 - 1} 9.8H{link.x1 + 1}m1.4-1.4-1.4 1.4 1.4 1.4"
			/>
		{/each}
	{/if}
</svg>

<style>
	.machine-glyph {
		display: block;
		flex: none;
		overflow: visible;
	}
	.use {
		fill: currentcolor;
		fill-opacity: 0.45;
	}
	.off {
		opacity: 0.55;
	}
	.off rect {
		stroke-dasharray: 1.8 1.6;
	}
</style>
