<!--
  RuinBackdrop.svelte — sfondo del setup: la rovina del sito in caratteri ASCII.

  Non è il velo scuro dell'app (SET-002): al primo avvio dietro non c'è niente da
  mostrare, quindi lo sfondo è l'immagine hero con grana e vignettatura. Il canvas
  resta scuro anche col tema chiaro: è una fotografia, non una superficie del guscio.

  L'ingresso lo governa `ruin.ts`; qui ci sono solo le sovrapposizioni (vignettatura
  che si stringe, grana) e la dissolvenza quando lo sfondo passa dietro lo Studio.
-->
<script lang="ts">
	import { mountRuin, type RuinHandle } from './ruin.ts';

	let {
		reduced = false,
		intro = false,
		onReady,
		onSkipHandle,
		dimmed = false
	}: {
		reduced?: boolean;
		intro?: boolean;
		onReady?: () => void;
		/** Riceve la funzione che salta l'ingresso: la chiamano clic e tasti. */
		onSkipHandle?: (skip: () => void) => void;
		dimmed?: boolean;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let grain = $state<HTMLCanvasElement | null>(null);

	// Callback in variabili non reattive: un riferimento nuovo non deve rimontare
	// la scena, e l'effect qui sotto tiene le due sempre aggiornate.
	let readyCallback: (() => void) | undefined;
	let skipCallback: ((skip: () => void) => void) | undefined;
	$effect(() => {
		readyCallback = onReady;
		skipCallback = onSkipHandle;
	});

	// Grana: rumore generato a runtime in un canvas 160×160 che il CSS stira a tutto
	// schermo. Un PNG nel bundle costerebbe un asset per la stessa texture.
	$effect(() => {
		const node = grain;
		if (!node) return;
		const ctx = node.getContext('2d');
		if (!ctx) return;
		const size = 160;
		const img = ctx.createImageData(size, size);
		for (let i = 0; i < size * size; i++) {
			const v = (Math.random() * 255) | 0;
			img.data[i * 4] = v;
			img.data[i * 4 + 1] = v;
			img.data[i * 4 + 2] = v;
			img.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
	});

	// Il montaggio segue i due soli ingressi che cambiano la scena: movimento e
	// modalità. Rimontare a ogni render ricostruirebbe le maschere per niente.
	$effect(() => {
		void reduced;
		void intro;
		const node = canvas;
		if (!node) return;
		const handle: RuinHandle = mountRuin(node, { reduced, intro, onReady: () => readyCallback?.() });
		skipCallback?.(() => handle.skip());
		return () => handle.dispose();
	});
</script>

<div class="ruin-backdrop" style:--dimmed={dimmed ? 1 : 0}>
	<canvas bind:this={canvas} class="ruin-canvas" aria-hidden="true"></canvas>
	<div class="ruin-vignette" class:animate={intro && !reduced} aria-hidden="true"></div>
	<canvas bind:this={grain} class="ruin-grain" width="160" height="160" aria-hidden="true"></canvas>
</div>

<style>
	.ruin-backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: #0e0e0c;
	}

	.ruin-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transition:
			opacity 900ms var(--ease-reveal),
			filter 900ms var(--ease-reveal),
			transform 1400ms var(--ease-reveal);
		opacity: calc(1 - var(--dimmed) * 0.82);
		filter: blur(calc(var(--dimmed) * 6px));
		transform: scale(calc(1 + var(--dimmed) * 0.03));
	}

	/* Vignettatura radiale: si stringe durante l'ingresso e tiene il bordo scuro
	   anche a riposo, così la finestra resta la cosa più chiara dello schermo. */
	.ruin-vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 75% 70% at 50% 46%,
			transparent 35%,
			rgb(8 8 7 / 0.55) 75%,
			rgb(6 6 5 / 0.92) 100%
		);
	}

	.ruin-vignette.animate {
		animation: ruin-vignette-in 2600ms var(--ease-reveal) both;
	}

	.ruin-grain {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		mix-blend-mode: overlay;
		opacity: 0.09;
		image-rendering: pixelated;
	}

	@keyframes ruin-vignette-in {
		from {
			opacity: 0.35;
		}
	}

	/* DESIGN.md § Movimento: con movimento ridotto `animation: none`, non un loop
	   da un millisecondo. */
	@media (prefers-reduced-motion: reduce) {
		.ruin-vignette.animate {
			animation: none;
		}
	}

	:global(:root[data-animations='false']) .ruin-vignette.animate {
		animation: none;
	}
</style>
