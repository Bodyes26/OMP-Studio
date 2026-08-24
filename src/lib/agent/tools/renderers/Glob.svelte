<!--
  Renderer per il tool `glob`.

  Nel sommario mostra il pattern cercato e il numero di file trovati.
  Nel corpo elenca i percorsi trovati tramite PathChip cliccabili, con un
  limite iniziale di 60 elementi e un pulsante per mostrare i restanti.
  Segnala se l'elenco e' stato troncato a monte dal server.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		bool,
		countLabel,
		num,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const MAX_VISIBLE = 60;
	let expanded = $state(false);

	const details = $derived(asRecord(result?.details));
	const pattern = $derived(str(args.path) ?? str(args.pattern) ?? str(args.glob) ?? '*');
	const files = $derived(strList(details?.files));
	const fileCount = $derived(num(details?.fileCount) ?? files.length);
	const truncated = $derived(bool(details?.truncated) === true);

	const visibleFiles = $derived(expanded ? files : files.slice(0, MAX_VISIBLE));
	const hiddenCount = $derived(Math.max(0, files.length - MAX_VISIBLE));

	const textFallback = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="glob-summary">
		<span class="pattern" title={pattern}>{pattern}</span>
		<CountBadge text={countLabel(fileCount, 'file', 'file')} />
	</div>
{:else}
	<div class="glob-body">
		{#if files.length > 0}
			<div class="file-list">
				{#each visibleFiles as file (file)}
					<div class="file-item">
						<PathChip path={file} />
					</div>
				{/each}
			</div>
			{#if hiddenCount > 0}
				<button
					type="button"
					class="toggle-button"
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? 'Comprimi elenco' : `Mostra altri ${hiddenCount} file`}
				</button>
			{/if}
		{:else if textFallback}
			<OutputBlock text={textFallback} label="risultato glob" />
		{/if}
		{#if truncated}
			<div class="truncated-notice">Elenco file troncato dal server.</div>
		{/if}
	</div>
{/if}

<style>
	.glob-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pattern {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.glob-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.file-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.file-item {
		display: flex;
		align-items: center;
	}

	.toggle-button {
		align-self: flex-start;
		background: transparent;
		border: none;
		padding: 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.toggle-button:hover {
		color: var(--ink);
	}

	.truncated-notice {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
