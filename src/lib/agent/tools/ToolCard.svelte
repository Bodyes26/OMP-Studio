<script lang="ts">
	// Cornice di una chiamata a tool: intestazione sempre visibile (stato,
	// nome, sommario del renderer, durata) e corpo espandibile.
	//
	// Di default resta chiusa anche se il tool fallisce: l'errore viene
	// segnalato con il tag 'fallito' e il microcopy sotto l'intestazione,
	// senza forzare l'apertura automatica del corpo.
	import type { ToolEntry } from '../session.svelte';
	import { chatReveal } from '../motion';
	import { rendererFor } from './registry';
	import { formatDuration, extractToolErrorReason } from './types';
	import { IconChevronRight } from '$lib/icons';
	let { entry } = $props<{ entry: ToolEntry }>();

	const renderer = $derived(rendererFor(entry.toolName));
	const isError = $derived(entry.result?.isError === true);

	// Cronometro: mentre il tool e' in esecuzione il tempo trascorso si
	// aggiorna ogni secondo; a esecuzione conclusa resta la durata finale.
	let now = $state(Date.now());
	$effect(() => {
		if (!entry.running) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const duration = $derived(
		entry.running
			? formatDuration(now - entry.startedAt)
			: entry.endedAt && entry.startedAt
				? formatDuration(entry.endedAt - entry.startedAt)
				: undefined
	);

	let open = $state(false);
	const canOpen = $derived(renderer.expandable);
</script>

<div class="card" class:running={entry.running} class:error={isError}>
	<div class="head">
		<button
			type="button"
			class="toggle"
			disabled={!canOpen}
			aria-expanded={open}
			onclick={() => canOpen && (open = !open)}
		>
			{#if canOpen}
				<span class="chevron" class:expanded={open} aria-hidden="true"><IconChevronRight /></span>
			{/if}
			<span class="state" aria-hidden="true"></span>
			<span class="name">{entry.toolName}</span>
			{#if isError}
				<span class="failed-tag">fallito</span>
			{/if}
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
		{#if duration}
			<span class="tail">{duration}</span>
		{/if}
	</div>
	{#if entry.intent}
		<div class="intent">{entry.intent}</div>
	{/if}
	{#if isError && !open}
		<div
			class="failure-microcopy"
			in:chatReveal={{ duration: 160, blur: 2, distance: -1 }}
		>
			<span class="failure-prefix">tool <strong class="failure-tool-name">{entry.toolName}</strong> fallito per:</span>
			<span class="failure-reason" title={extractToolErrorReason(entry)}>{extractToolErrorReason(entry)}</span>
		</div>
	{/if}
	{#if open && canOpen}
		<div
			class="body"
			transition:chatReveal={{ duration: 220, blur: 4, distance: -2 }}
		>
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
		padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
		min-width: 0;
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

	.chevron {
		--icon-size: 12px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--space-3);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.state {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		transform: translateY(-1px);
	}

	/* Il respiro (state-pulse) resta riservato al pallino del gruppo tool e
	   alla riga di attivita' del transcript: qui il pallino in esecuzione e'
	   statico, altrimenti due elementi respirerebbero insieme nello stesso turno. */
	.running .state {
		background: var(--brand);
	}

	.error .state {
		background: var(--danger);
	}

	.failed-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--danger);
		line-height: 1.4;
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
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.intent {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.failure-microcopy {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		margin-left: calc(var(--space-3) + var(--space-2));
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--danger) 7%, transparent);
		border-left: 2px solid var(--danger);
		font-size: var(--text-xs);
		line-height: 1.4;
		min-width: 0;
	}

	.failure-prefix {
		color: var(--danger);
		font-size: var(--text-xs);
		font-weight: 500;
		white-space: nowrap;
	}

	.failure-tool-name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--danger);
	}

	.failure-reason {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-1);
		min-width: 0;
	}
</style>
