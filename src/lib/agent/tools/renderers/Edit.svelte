<!--
  Renderer per il tool `edit`.

  Nel corpo espanso mostra ToolFileHeader con il file modificato,
  il componente Diff a colonna singola e i dettagli dell'operazione.
  Se il diff non e' disponibile, ripiega su JsonBlock per gli argomenti
  e LiveNotice se l'operazione e' in corso.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Diff from '../parts/Diff.svelte';
	import JsonBlock from '../parts/JsonBlock.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import LiveNotice from '../parts/LiveNotice.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import ToolFileHeader from '../parts/ToolFileHeader.svelte';
	import { asRecord, num, resultText, str, type ToolRenderProps } from '../types';

	let { args, result, running = false }: ToolRenderProps = $props();

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

<div class="edit-body">
	{#if filePath}
		<ToolFileHeader path={filePath} />
	{/if}
	{#if diffText}
		<Diff diff={diffText} />
	{:else if running}
		<LiveNotice label={m.ui_edit_modifica_in_corso_0b2d()} />
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

<style>
	.edit-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
