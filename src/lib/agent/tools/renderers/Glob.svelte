<!--
  Renderer per il tool `glob`.

  Nel corpo espanso elenca i percorsi trovati tramite PathChip cliccabili, con un
  limite iniziale di 60 elementi e un pulsante per mostrare i restanti.
  Segnala se l'elenco e' stato troncato a monte dal server tramite EmptyNotice.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import EmptyNotice from '../parts/EmptyNotice.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		bool,
		resultText,
		strList,
		type ToolRenderProps
	} from '../types';

	let { result }: ToolRenderProps = $props();

	const MAX_VISIBLE = 60;
	let expanded = $state(false);

	const details = $derived(asRecord(result?.details));
	const files = $derived(strList(details?.files));
	const truncated = $derived(bool(details?.truncated) === true);

	const visibleFiles = $derived(expanded ? files : files.slice(0, MAX_VISIBLE));
	const hiddenCount = $derived(Math.max(0, files.length - MAX_VISIBLE));

	const textFallback = $derived(resultText(result));
</script>

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
				{expanded ? 'Comprimi elenco' : m.ui_glob_mostra_altri_value1_file_5cf9({ value1: hiddenCount })}
			</button>
		{/if}
	{:else if textFallback}
		<OutputBlock text={textFallback} label="risultato glob" />
	{/if}
	{#if truncated}
		<EmptyNotice text="Elenco file troncato dal server." />
	{/if}
</div>

<style>
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
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.toggle-button:hover {
		color: var(--ink);
	}
</style>
