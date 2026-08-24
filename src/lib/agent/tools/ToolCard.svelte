<script lang="ts">
	// Cornice di una chiamata a tool: intestazione sempre visibile (stato,
	// nome, sommario del renderer, durata) e corpo espandibile.
	//
	// L'espansione automatica scatta **solo** sugli errori: aprire da soli
	// anche le card riuscite trasformerebbe un turno di venti tool in un muro
	// di testo.
	import type { ToolEntry } from '../session.svelte';
	import { rendererFor } from './registry';
	import { formatDuration } from './types';

	let { entry } = $props<{ entry: ToolEntry }>();

	const renderer = $derived(rendererFor(entry.toolName));
	const isError = $derived(entry.result?.isError === true);
	const duration = $derived(
		entry.endedAt && entry.startedAt ? formatDuration(entry.endedAt - entry.startedAt) : undefined
	);

	let manual = $state<boolean | null>(null);
	const open = $derived(manual ?? isError);
	const canOpen = $derived(renderer.expandable);
</script>

<div class="card" class:running={entry.running} class:error={isError}>
	<div class="head">
		<button
			type="button"
			class="toggle"
			disabled={!canOpen}
			aria-expanded={open}
			onclick={() => canOpen && (manual = !open)}
		>
			<span class="state" aria-hidden="true"></span>
			<span class="name">{entry.toolName}</span>
		</button>
		<span class="summary">
			<renderer.component
				name={entry.toolName}
				args={entry.args}
				result={entry.result}
				running={entry.running}
				view="summary"
			/>
		</span>
		{#if entry.running}
			<span class="tail">in corso</span>
		{:else if duration}
			<span class="tail">{duration}</span>
		{/if}
	</div>
	{#if entry.intent}
		<div class="intent">{entry.intent}</div>
	{/if}
	{#if open && canOpen}
		<div class="body">
			<renderer.component
				name={entry.toolName}
				args={entry.args}
				result={entry.result}
				running={entry.running}
				view="body"
			/>
		</div>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-left: 2px solid var(--line);
		min-width: 0;
	}

	.card.error {
		border-left-color: var(--brand);
	}

	.head {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr) max-content;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	.toggle {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--ink);
	}

	.toggle:disabled {
		cursor: default;
	}

	.state {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
		transform: translateY(-1px);
	}

	/* Una sola animazione in loop in tutta l'app: si riusa `state-pulse`,
	   non se ne aggiunge una seconda (docs/DESIGN.md). */
	.running .state {
		background: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.error .state {
		background: var(--brand);
	}

	.name {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.summary {
		min-width: 0;
		overflow: hidden;
	}

	.tail {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.intent {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-1);
		min-width: 0;
	}
</style>
