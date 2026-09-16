<script lang="ts">
	// Indicatore di attivita dell'agente con griglia di pixel animata,
	// label testuale con effetto shimmer e cronometro del tempo trascorso.
	import { m } from '$lib/paraglide/messages.js';
	import PixelGrid from './PixelGrid.svelte';
	import { formatElapsed } from '../tools/types';

	let { startedAt = null }: { startedAt?: number | null } = $props();

	let now = $state(Date.now());
	const elapsed = $derived(startedAt != null ? Math.max(0, now - startedAt) : 0);

	// Mostra il timer numerico solo dopo 1.5 secondi di attesa
	// per evitare sfarfallii sgradevoli durante turni istantanei.
	const showTimer = $derived(startedAt != null && elapsed >= 1500);

	// Il ciclo si riprogramma da solo invece di usare setInterval con periodo
	// derivato: l'effect legge unicamente 'startedAt', mentre la cadenza viene
	// decisa dentro la callback, fuori dallo scope tracciato. Se il periodo
	// dipendesse da un $derived calcolato su 'now', ogni tick rimetterebbe in
	// discussione le dipendenze dell'effect che 'now' lo scrive: catena fragile,
	// a un passo dal ricreare il timer a ogni frame.
	$effect(() => {
		const anchor = startedAt;
		if (anchor == null) return;

		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;

		const tick = () => {
			if (stopped) return;
			const stamp = Date.now();
			now = stamp;
			// Sotto il minuto il decimo di secondo e leggibile e vale il costo;
			// oltre, il decimale non porta informazione e basta un tick al secondo.
			timer = setTimeout(tick, stamp - anchor < 60_000 ? 100 : 1000);
		};

		timer = setTimeout(tick, 100);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
</script>

<div class="activity" role="status" aria-live="polite">
	<PixelGrid size="md" state="running" />
	<span class="label text-shimmer">{m.ui_activity_sta_pensando()}</span>
	{#if showTimer}<span class="elapsed" aria-hidden="true">{formatElapsed(elapsed)}</span>{/if}
</div>

<style>
	.activity {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: fit-content;
	}

	.label {
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.elapsed {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}
</style>
