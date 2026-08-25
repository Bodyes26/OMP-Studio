<!--
  Renderer per il tool `edit`.

  Mostra il file modificato e il bilancio di righe aggiunte/rimosse nel
  sommario (+n / -n). Nel corpo espanso mostra il componente Diff a colonna
  singola e i dettagli dell'operazione (op, prima riga modificata). Se il
  diff non e' disponibile nei dettagli, ripiega su JsonBlock per gli argomenti.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import Diff from '../parts/Diff.svelte';
	import JsonBlock from '../parts/JsonBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import { asRecord, num, resultText, str, type ToolRenderProps } from '../types';

	let { args, result, running = false, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	// Mentre e' in corso omp non manda ancora `path`/`file`: solo `args.input`
	// nella forma `[percorso#tag]...` (intestazione del blocco letto). E' l'unico
	// indizio disponibile del file toccato finche' il risultato non arriva.
	const inputPath = $derived.by(() => {
		const input = str(args.input);
		if (!input) return undefined;
		return /^\[([^#\]]+)/.exec(input)?.[1];
	});
	const filePath = $derived(str(details?.path) ?? str(args.path) ?? str(args.file) ?? inputPath ?? '');
	const diffText = $derived(str(details?.diff));
	const op = $derived(str(details?.op));
	const firstChangedLine = $derived(num(details?.firstChangedLine));

	const diffStats = $derived.by(() => {
		if (!diffText) return null;
		let added = 0;
		let removed = 0;
		for (const line of diffText.split('\n')) {
			if (line.startsWith('+')) added++;
			else if (line.startsWith('-')) removed++;
		}
		if (added === 0 && removed === 0) return null;
		return `+${added} −${removed}`;
	});

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (op) {
			rows.push({ key: 'Operazione', value: op });
		}
		if (firstChangedLine !== undefined) {
			rows.push({ key: 'Prima riga', value: String(firstChangedLine) });
		}
		return rows;
	});

	const fallbackText = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="edit-summary">
		{#if filePath}
			<PathChip path={filePath} />
		{/if}
		{#if diffStats}
			<CountBadge text={diffStats} />
		{/if}
	</div>
{:else}
	<div class="edit-body">
		{#if filePath}
			<div class="file-header">
				<PathChip path={filePath} full />
			</div>
		{/if}
		{#if diffText}
			<Diff diff={diffText} />
		{:else if running}
			<div class="running-indicator">Modifica in corso...</div>
		{:else}
			<JsonBlock value={args} label="argomenti edit" />
			{#if fallbackText}
				<OutputBlock text={fallbackText} label="risultato" />
			{/if}
		{/if}
		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}
	</div>
{/if}

<style>
	.edit-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.edit-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.file-header {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.running-indicator {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
