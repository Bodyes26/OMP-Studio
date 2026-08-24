<script lang="ts">
	// Blocco collassabile per il ragionamento (thinking/reasoning).
	// Collassato per default, lo stato di espansione vive in memoria nel componente.
	import { countLabel } from '../tools/types';

	let {
		text = '',
		streaming = false
	}: {
		text?: string;
		streaming?: boolean;
	} = $props();

	let expanded = $state(false);
	const bodyId = `thinking-${Math.random().toString(36).slice(2, 9)}`;

	const lines = $derived(text ? text.split('\n') : []);
	const label = $derived(
		lines.length > 0 ? `Ragionamento · ${countLabel(lines.length, 'riga', 'righe')}` : 'Ragionamento'
	);
</script>

{#if text || streaming}
	<div class="thinking-block">
		<button
			type="button"
			class="header-btn"
			class:expanded
			class:streaming
			aria-expanded={expanded}
			aria-controls={bodyId}
			onclick={() => (expanded = !expanded)}
			title={expanded ? 'Comprimi ragionamento' : 'Espandi ragionamento'}
		>
			<span class="chevron">{expanded ? '▾' : '▸'}</span>
			<span class="label">{label}</span>
			{#if streaming}
				<span class="streaming-dot" title="In elaborazione..."></span>
			{/if}
		</button>
		{#if expanded}
			<div id={bodyId} class="body">
				<pre>{text}</pre>
			</div>
		{/if}
	</div>
{/if}

<style>
	.thinking-block {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin: var(--space-1) 0;
	}

	.header-btn {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
		user-select: none;
	}

	.header-btn:hover {
		color: var(--ink-muted);
		border-color: var(--line-strong);
	}

	.header-btn.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.chevron {
		font-size: 10px;
		line-height: 1;
	}


	.streaming-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
		margin-left: auto;
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}
	.label {
		font-family: var(--font-ui);
	}

	.body {
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-top: none;
		border-bottom-left-radius: var(--radius-sm);
		border-bottom-right-radius: var(--radius-sm);
		background: var(--bg-sunken);
		max-height: 360px;
		overflow-y: auto;
	}

	pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink-faint);
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}
</style>
