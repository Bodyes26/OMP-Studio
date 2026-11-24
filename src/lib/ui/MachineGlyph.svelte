<!--
  Dove vive un progetto, senza testo (R-MI-19).

  Glifi disegnati per Studio e approvati in anteprima (F21): lo schermo
  semplice e' «questo computer», con le onde dall'angolo e' «un'altra
  macchina», barrato e' «non raggiungibile». Per un progetto su piu'
  macchine uno schermo per copia: pieno la copia in uso, contorno in linea,
  tratteggio spenta; fra le copie le frecce di andata e ritorno, oppure il
  segno ≠ in ambra quando le copie divergono (R-MI-22). Un punto sopra le
  frecce dice che questa copia ha commit da ricevere e aspetta la cartella
  libera (R-MI-27). Il nome delle
  macchine non sta qui: lo dicono l'etichetta accessibile e il popover.
-->
<script lang="ts">
	import type { CopyMark } from '#lib/stores/projectCopies.ts';
	import { motionReduced } from '#lib/agent/motionState.svelte.ts';

	let {
		kind,
		copies = [],
		diverge = false,
		pending = false,
		syncing = false,
		size = 14
	}: {
		kind: 'here' | 'remote' | 'offline' | 'copies';
		/** Solo per `copies`: una voce per macchina, nell'ordine da mostrare. */
		copies?: CopyMark[];
		diverge?: boolean;
		/** Commit da ricevere in attesa della cartella libera («da aggiornare»). */
		pending?: boolean;
		/** Giro di sincronizzazione in corso: le frecce si muovono (R-MI-50). */
		syncing?: boolean;
		/** Altezza in px; la larghezza segue il disegno. */
		size?: number;
	} = $props();

	// Le frecce si animano solo con almeno una coppia di copie e senza
	// movimento ridotto: il movimento racconta il giro, non decora.
	const animate = $derived(syncing && !diverge && copies.length > 1 && !motionReduced());

	// Geometria su una griglia alta 16: gli schermi delle copie sono larghi 9,
	// distanziati 7 (9 con il ≠, che ha bisogno di aria per leggersi).
	const SCREEN = 9;
	const gap = $derived(diverge ? 9 : 7);
	const width = $derived(
		kind === 'copies'
			? 2 + copies.length * SCREEN + Math.max(0, copies.length - 1) * gap
			: kind === 'remote'
				? 20
				: 16
	);
	const screens = $derived(copies.map((mark, index) => ({ mark, x: 1 + index * (SCREEN + gap) })));
	const links = $derived(
		screens.slice(0, -1).map((screen, index) => {
			const x1 = screen.x + SCREEN;
			return { x1, x2: x1 + gap, mid: x1 + gap / 2, diverge: diverge && index === 0 };
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
	{#if kind === 'here' || kind === 'offline'}
		<rect x="1" y="3.5" width="14" height="9.5" rx="1.6" />
		<path d="M8 13v2.4M5.6 15.4h4.8" />
		{#if kind === 'offline'}<path d="M1.5 1.5 15 15" />{/if}
	{:else if kind === 'remote'}
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
			{#if link.diverge}
				<path class="diverge" d="M{link.mid - 2.2} 6.7h4.4M{link.mid - 2.2} 9.3h4.4M{link.mid + 1.3} 5l-2.6 6" />
			{:else}
				<path
					stroke-width="1.3"
					d="M{link.x1 + 1} 6.4H{link.x2 - 1}m-1.4-1.4 1.4 1.4-1.4 1.4M{link.x2 - 1} 9.8H{link.x1 + 1}m1.4-1.4-1.4 1.4 1.4 1.4"
					class:syncing={animate}
				/>
			{/if}
			{#if pending && !link.diverge && index === 0}
				<circle class="pending" cx={link.mid} cy="2.2" r="1.3" />
			{/if}
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
		fill: currentColor;
		fill-opacity: 0.45;
	}
	.off {
		opacity: 0.55;
	}
	.off rect {
		stroke-dasharray: 1.8 1.6;
	}
	.diverge {
		stroke: var(--warn-glyph);
	}
	.pending {
		fill: currentColor;
		stroke: none;
	}
	/* Giro in corso (R-MI-50): le frecce scorrono piano, andata e ritorno. Il
	   segno e' gia' quello di sempre; il movimento dice solo «sta parlando».
	   Durata lunga: un lampeggio a ogni giro sembrerebbe un errore. */
	.syncing {
		animation: arrows-flow 1400ms var(--ease-in-out) infinite alternate;
	}
	@keyframes arrows-flow {
		from { transform: translateX(-0.7px); }
		to { transform: translateX(0.7px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.syncing { animation: none; }
	}
</style>
