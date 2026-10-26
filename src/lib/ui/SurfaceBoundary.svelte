<script lang="ts">
	// Un errore lanciato da un effetto senza boundary risale fino alla radice:
	// Svelte abbandona il giro di aggiornamento e da quel momento l'intera
	// finestra resta disegnata ma non applica piu' nessun cambiamento. Il
	// boundary ferma l'errore a questa superficie: il resto di Studio continua
	// a funzionare e la superficie si rimonta con "Riprova".
	// Va messo solo attorno a superfici che si possono smontare senza effetti
	// collaterali (niente processi o terminali legati al loro ciclo di vita).
	import type { Snippet } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { describeError } from '#lib/diagnostics/logCore.ts';
	import { studioLog } from '#lib/diagnostics/studioLog.ts';

	let { name, children }: { name: string; children: Snippet } = $props();

	function onerror(error: unknown) {
		studioLog.error('ui', `errore contenuto nella superficie ${name}: ${describeError(error)}`);
	}
</script>

<svelte:boundary {onerror}>
	{@render children()}

	{#snippet failed(_error, reset)}
		<div class="surface-error" role="alert">
			<p class="surface-error-title">{m.surface_error_title()}</p>
			<p class="surface-error-desc">{m.surface_error_desc()}</p>
			<button type="button" class="ui-button ui-button-secondary" onclick={reset}>
				{m.surface_error_retry()}
			</button>
		</div>
	{/snippet}
</svelte:boundary>

<style>
	.surface-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: 100%;
		padding: var(--space-4);
		text-align: center;
	}

	.surface-error-title {
		margin: 0;
		font-size: var(--text-body);
		color: var(--ink);
	}

	.surface-error-desc {
		margin: 0;
		max-width: 36ch;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink-muted);
		text-wrap: pretty;
	}
</style>
