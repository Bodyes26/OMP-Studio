<script lang="ts">
	/**
	 * PromptBlock.svelte
	 *
	 * Visualizza prompt, obiettivi e domande nel registro "voce" (15/24),
	 * conforme alla Two Voices Rule (Gate R32 - C10).
	 * Struttura: bolla su fondo `--bg-base`, bordo `--line`, raggio `--radius-xl` (12px).
	 */
	let {
		text,
		label = undefined
	}: {
		text: string;
		label?: string;
	} = $props();
</script>

{#if text}
	<div class="prompt-block">
		{#if label}
			<span class="prompt-label">{label}</span>
		{/if}
		<div class="prompt-text">{text}</div>
	</div>
{/if}

<style>
	.prompt-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-xl);
		padding: 10px 14px;
		user-select: text;
		min-width: 0;
	}

	.prompt-label {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		letter-spacing: 0.02em;
	}

	.prompt-text {
		font-family: var(--font-prose);
		font-size: var(--text-chat);
		line-height: var(--line-height-chat);
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
