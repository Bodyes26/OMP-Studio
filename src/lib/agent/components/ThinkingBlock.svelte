<script module lang="ts">
	// Preferenza di espansione condivisa per la sessione del pannello: l'ultima
	// scelta dell'utente (espandi/comprimi un blocco di ragionamento) diventa
	// il default dei blocchi successivi. Vive in memoria, non su disco.
	let lastExpandedPreference = $state(false);
</script>

<script lang="ts">
	// Blocco collassabile per il ragionamento (thinking/reasoning).
	import { countLabel } from '../tools/types';
	import { chatReveal } from '../motion';

	let {
		text = '',
		streaming = false
	}: {
		text?: string;
		streaming?: boolean;
	} = $props();

	let expanded = $state(lastExpandedPreference);

	function toggleExpanded() {
		expanded = !expanded;
		lastExpandedPreference = expanded;
	}
	const bodyId = `thinking-${Math.random().toString(36).slice(2, 9)}`;

	const lines = $derived(text ? text.split('\n') : []);
	const label = $derived(
		streaming
			? 'Sta pensando'
			: lines.length > 0
				? `Ragionamento · ${countLabel(lines.length, 'riga', 'righe')}`
				: 'Ragionamento'
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
			aria-label={`${label}. ${expanded ? 'Comprimi' : 'Espandi'} il ragionamento`}
			onclick={toggleExpanded}
			title={expanded ? 'Comprimi ragionamento' : 'Espandi ragionamento'}
		>
			<span class="chevron" class:expanded aria-hidden="true">▸</span>
			<span class="label">{label}</span>
			{#if streaming}
				<span class="streaming-dot" aria-hidden="true"></span>
			{/if}
		</button>
		{#if expanded}
			<div
				id={bodyId}
				class="body"
				transition:chatReveal={{ duration: 220, blur: 4, distance: -2 }}
			>
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
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
		user-select: none;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.header-btn:hover {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.header-btn.streaming {
		color: var(--ink-muted);
	}

	.chevron {
		font-size: var(--text-xs);
		line-height: 1;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.streaming-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
		margin-left: auto;
	}
	.label {
		font-family: var(--font-ui);
	}

	.body {
		/* Niente bordo/riempimento proprio: si distingue per indentazione e
		   separatore 1px, non per un secondo riquadro dentro la card. */
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-top: 1px solid var(--line);
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
