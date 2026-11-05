<script lang="ts">
	/**
	 * Primitiva riusabile per numeri animati (KPI, tabelle, grafici, dettagli).
	 *
	 * Utilizza Tween di Svelte 5 con curva `--ease-reveal` per scorrere
	 * i numeri in modo incrementale quando cambiano i dati o l'intervallo.
	 *
	 * - Primo caricamento: entrata diretta al valore iniziale, senza conteggio lungo da 0.
	 * - Accessibilità: gli screen reader leggono esclusivamente il valore target finale
	 *   tramite `.sr-only`, mentre il visuale animato resta `aria-hidden="true"`.
	 *   Con `prefers-reduced-motion` o animazioni disattivate lo scorrimento e' istantaneo.
	 * - Geometria: numeri sempre formattati con `font-variant-numeric: tabular-nums`
	 *   per evitare sobbalzi di layout.
	 * - Prestazioni: un IntersectionObserver interrompe i tween quando il componente
	 *   non e' visibile a schermo.
	 */
	import { untrack, type Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { revealEase } from '#lib/agent/motion.ts';
	import { motionReduced } from '#lib/agent/motionState.svelte.ts';

	/** Durata allineata a --dur-calm (480ms) in app.css, entro i 400-700ms richiesti. */
	const DEFAULT_DURATION = 480;

	let {
		value = null,
		format,
		fallback = '—',
		duration = DEFAULT_DURATION,
		class: className = '',
		inline = false,
		initial = 'skip',
		children
	}: {
		value: number | null | undefined;
		format?: (n: number) => string;
		fallback?: string;
		duration?: number;
		class?: string;
		inline?: boolean;
		initial?: 'skip' | 'animate';
		children?: Snippet<[number]>;
	} = $props();

	let hostEl = $state<HTMLElement | null>(null);
	let isVisible = $state(true);

	// Se l'elemento e' fuori vista (es. scrollato via), non sprechiamo cicli di animazione.
	$effect(() => {
		if (!hostEl || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) => {
			isVisible = entry.isIntersecting;
		});
		observer.observe(hostEl);
		return () => observer.disconnect();
	});

	// Il tween parte dal valore iniziale se disponibile: evita il conteggio esteso da zero.
	const initialValue = untrack(() => value ?? 0);
	const initialDuration = untrack(() => duration);
	const tween = new Tween(initialValue, {
		duration: initialDuration,
		easing: revealEase
	});
	let hasInitialized = $state(false);

	$effect(() => {
		const target = value;
		if (target === null || target === undefined) {
			// Se il dato torna nullo, resettiamo lo stato d'inizializzazione cosi' il prossimo
			// arrivo di dati non scattera' un tween da 0.
			hasInitialized = false;
			return;
		}

		if (!hasInitialized) {
			hasInitialized = true;
			if (initial === 'skip') {
				// Al primo arrivo di un valore valido saltiamo direttamente al target.
				untrack(() => void tween.set(target, { duration: 0 }));
				return;
			}
		}

		// Se le animazioni sono disattivate o l'elemento non e' visibile, durata zero.
		const animDuration = motionReduced() || !isVisible ? 0 : duration;
		untrack(() => void tween.set(target, { duration: animDuration, easing: revealEase }));
	});

	function formatValue(v: number | null | undefined): string {
		if (v === null || v === undefined) return fallback;
		if (format) return format(v);
		return String(Math.round(v));
	}

	const formattedTarget = $derived(formatValue(value));
	const formattedCurrent = $derived(
		value === null || value === undefined ? fallback : formatValue(tween.current)
	);
</script>

<span
	bind:this={hostEl}
	class={`animated-num ${className}`}
	class:inline-display={inline}
>
	<!-- Accessibilita': lo screen reader riceve subito il valore finale, senza churn a ogni fotogramma. -->
	<span class="sr-only">
		{#if value === null || value === undefined}
			{fallback}
		{:else if children}
			{@render children(value)}
		{:else}
			{formattedTarget}
		{/if}
	</span>

	<!-- Visualizzazione grafica a larghezza fissa per non muovere i caratteri vicini durante il tween. -->
	<span aria-hidden="true">
		{#if value === null || value === undefined}
			{fallback}
		{:else if children}
			{@render children(tween.current)}
		{:else}
			{formattedCurrent}
		{/if}
	</span>
</span>

<style>
	.animated-num {
		display: inline-block;
		font-variant-numeric: tabular-nums;
	}

	.animated-num.inline-display {
		display: inline;
	}
</style>
