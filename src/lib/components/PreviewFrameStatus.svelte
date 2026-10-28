<!--
  PreviewFrameStatus — stato di un iframe di anteprima ricreato a ogni pubblicazione
  (Laboratorio e `studio_preview`).

  - Velo centrale finche' il documento nuovo non ha finito di caricare: l'iframe
    ricreato resta vuoto mentre scarica moduli, compila e monta il primo render.
    Il testo compare con un breve ritardo, cosi' i caricamenti istantanei non
    lampeggiano.
  - Pillola in basso a destra: lavoro in corso (`busyLabel`, es. compilazione)
    oppure, per qualche secondo dopo ogni `updatedSeq` nuovo, la conferma che
    l'anteprima e' stata aggiornata.

  Il genitore deve essere `position: relative` e coprire l'area dell'iframe.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import { IconCheck } from '#lib/icons.ts';

	const UPDATED_VISIBLE_MS = 2200;

	let {
		rendering,
		busyLabel = null,
		updatedSeq
	}: {
		/** L'iframe corrente non ha ancora emesso `load`. */
		rendering: boolean;
		/** Lavoro a monte del documento (compilazione): ha la precedenza sulla conferma. */
		busyLabel?: string | null;
		/** Cresce a ogni aggiornamento completato; il valore al montaggio non conta. */
		updatedSeq: number;
	} = $props();

	let updatedShown = $state(false);
	let updatedTimer: ReturnType<typeof setTimeout> | null = null;

	// Il primo giro registra solo il valore corrente: montare il pannello su
	// un'anteprima gia' pubblicata non e' un aggiornamento.
	let seenSeq: number | null = null;
	$effect(() => {
		const seq = updatedSeq;
		if (seenSeq !== null && seq !== seenSeq) {
			if (updatedTimer) clearTimeout(updatedTimer);
			updatedShown = true;
			updatedTimer = setTimeout(() => {
				updatedShown = false;
				updatedTimer = null;
			}, UPDATED_VISIBLE_MS);
		}
		seenSeq = seq;
	});

	onDestroy(() => {
		if (updatedTimer) clearTimeout(updatedTimer);
	});
</script>

{#if rendering}
	<div class="frame-veil" role="status" aria-live="polite">
		<StatusMark status="running" />
		<span>{m.preview_frame_rendering()}</span>
	</div>
{/if}

{#if busyLabel}
	<div class="frame-pill" role="status" aria-live="polite">
		<StatusMark status="running" />
		<span>{busyLabel}</span>
	</div>
{:else if updatedShown && !rendering}
	<div class="frame-pill is-updated" role="status" aria-live="polite">
		<span class="pill-check"><IconCheck /></span>
		<span>{m.preview_frame_updated()}</span>
	</div>
{/if}

<style>
	/* Trasparente: sotto c'e' lo sfondo del riquadro, l'iframe in caricamento e' nascosto. */
	.frame-veil {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		pointer-events: none;
		z-index: var(--z-sticky);
		opacity: 0;
		animation: veil-in var(--dur-fast) var(--ease-out) 180ms forwards;
	}

	.frame-pill {
		position: absolute;
		bottom: var(--space-3);
		right: var(--space-3);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		background-color: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-raise);
		font-size: var(--text-caption);
		pointer-events: none;
		z-index: var(--z-sticky);
		animation: pill-in var(--dur-fast) var(--ease-out);
	}

	.pill-check {
		display: inline-flex;
		color: var(--success);
		--icon-size: 12px;
	}

	@keyframes veil-in {
		to {
			opacity: 1;
		}
	}

	@keyframes pill-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	/* La soppressione globale delle animazioni (sistema o impostazione) lascerebbe
	   il velo a opacita' 0. */
	@media (prefers-reduced-motion: reduce) {
		.frame-veil {
			opacity: 1;
		}
	}

	:global(:root[data-animations='false']) .frame-veil {
		opacity: 1;
	}
</style>
