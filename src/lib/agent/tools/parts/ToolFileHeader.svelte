<script lang="ts">
	/**
	 * ToolFileHeader.svelte
	 *
	 * Intestazione standard unica per i percorsi file nei tool (Edit, Write, Read, AstEdit, Debug, InspectImage).
	 * Incapsula PathChip con etichetta opzionale e metadati tabulari a destra.
	 */
	import PathChip from './PathChip.svelte';

	let {
		path,
		line = null,
		action = undefined,
		meta = undefined,
		full = true
	}: {
		path: string;
		line?: number | null;
		action?: string;
		meta?: string;
		full?: boolean;
	} = $props();
</script>

{#if path}
	<div class="tool-file-header">
		<div class="file-main">
			{#if action}
				<span class="file-action">{action}</span>
			{/if}
			<PathChip {path} {line} {full} />
		</div>
		{#if meta}
			<span class="file-meta">{meta}</span>
		{/if}
	</div>
{/if}

<style>
	.tool-file-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
	}

	.file-main {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.file-action {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.file-meta {
		font-family: var(--font-ui);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
