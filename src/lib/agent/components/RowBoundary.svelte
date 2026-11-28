<script lang="ts">
	// Boundary di riga del transcript: un renderer di tool, un parser di
	// intelligent-ui o una derived che lancia rovinano questa sola card, non
	// la chat. Il boundary esterno (`SurfaceBoundary name="chat"`) rimonta
	// l'intera superficie, e con lei il composer: la bozza non inviata e gli
	// allegati vivono nello stato del componente e andrebbero persi.
	//
	// Il fallback e' una riga, non un pannello: la riga rotta resta al suo
	// posto nella cronologia, con il tipo di contenuto e «Riprova». Il resto
	// del turno continua a leggersi, e la chat resta viva.
	import type { Snippet } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { describeError } from '#lib/diagnostics/logCore.ts';
	import { studioLog } from '#lib/diagnostics/studioLog.ts';

	let { name, children }: { name: string; children: Snippet } = $props();

	function onerror(error: unknown) {
		studioLog.error('ui', `errore di rendering nella riga ${name}: ${describeError(error)}`);
	}
</script>

<svelte:boundary {onerror}>
	{@render children()}

	{#snippet failed(_error, reset)}
		<div class="row-error" role="alert">
			<span class="row-error-text">{m.chat_row_render_error()}</span>
			<button type="button" class="row-error-retry" onclick={reset}>
				{m.chat_row_render_retry()}
			</button>
		</div>
	{/snippet}
</svelte:boundary>

<style>
	.row-error {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin: var(--space-2) 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-left: 2px solid var(--danger);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		min-width: 0;
	}

	.row-error-text {
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.row-error-retry {
		margin-left: auto;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--brand-ink);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.row-error-retry:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
</style>
