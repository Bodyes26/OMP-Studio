<!--
  Renderer per il tool `lsp`.

  Rappresenta le operazioni del Language Server Protocol (navigazione a
  definizione, riferimenti, rinomina, simboli, hover, ecc.).
  Nel corpo mostra il risultato testuale tramite OutputBlock, gli argomenti
  chiave in KeyValue e, se presenti posizioni strutturate nei dettagli,
  una lista di PathChip cliccabili.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));

	const action = $derived(str(args.action) ?? str(args.op) ?? 'lsp');
	const file = $derived(str(args.file) ?? str(args.path));
	const line = $derived(num(args.line));
	const symbol = $derived(str(args.symbol) ?? str(args.name));
	const query = $derived(str(args.query));
	const newName = $derived(str(args.new_name) ?? str(args.newName));

	interface LocationItem {
		path: string;
		line?: number;
	}

	const locations = $derived.by<LocationItem[]>(() => {
		const rawDetails = result?.details;
		let rawItems: unknown[] = [];
		if (Array.isArray(rawDetails)) {
			rawItems = rawDetails;
		} else if (details) {
			if (Array.isArray(details.locations)) rawItems = details.locations;
			else if (Array.isArray(details.references)) rawItems = details.references;
			else if (Array.isArray(details.definitions)) rawItems = details.definitions;
			else if (Array.isArray(details.symbols)) rawItems = details.symbols;
			else if (Array.isArray(details.items)) rawItems = details.items;
		}

		const list: LocationItem[] = [];
		for (const item of rawItems) {
			const rec = asRecord(item);
			if (rec) {
				const p = str(rec.path) ?? str(rec.file) ?? str(rec.uri);
				if (p) {
					list.push({
						path: p,
						line: num(rec.line) ?? num(rec.lineNumber)
					});
				}
			}
		}
		return list;
	});

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (action) rows.push({ key: 'Azione', value: action });
		if (file) rows.push({ key: 'File', value: line ? `${file}:${line}` : file });
		if (symbol) rows.push({ key: 'Simbolo', value: symbol });
		if (query) rows.push({ key: 'Query', value: query });
		if (newName) rows.push({ key: 'Nuovo nome', value: newName });
		return rows;
	});

	const text = $derived(resultText(result));
</script>

<div class="lsp-body">
	{#if metaRows.length > 0}
		<KeyValue rows={metaRows} />
	{/if}
	{#if locations.length > 0}
		<div class="locations-list">
			{#each locations as loc, i (`${loc.path}:${loc.line ?? i}`)}
				<div class="loc-row">
					<PathChip path={loc.path} line={loc.line} />
				</div>
			{/each}
		</div>
	{/if}
	{#if text}
		<OutputBlock {text} label="risultato lsp" />
	{/if}
</div>

<style>
	.lsp-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.locations-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.loc-row {
		display: flex;
		align-items: center;
	}
</style>
