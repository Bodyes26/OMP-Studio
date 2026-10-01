<!--
  Renderer per `report_issue` (segnalazione anomalie su tool).

  Nel corpo espanso mostra la descrizione completa dell'anomalia tramite PromptBlock (Two Voices Rule),
  la tabella KeyValue con i metadati (tool, categoria, severita') e l'eventuale riscontro in OutputBlock.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PromptBlock from '../parts/PromptBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const rawTool = $derived(str(args.tool) ?? str(args.target) ?? str(args.name));
	const rawDesc = $derived(
		str(args.description) ?? str(args.issue) ?? str(args.message) ?? str(args.content) ?? str(args.text)
	);

	// Se il payload e' una riga unica del tipo `<tool>: <descrizione>` (convenzione xd://report_issue)
	const parsed = $derived.by(() => {
		if (!rawTool && rawDesc) {
			const match = /^([^:\n]+):\s*([\s\S]+)$/.exec(rawDesc);
			if (match && match[1] && match[2]) {
				return { tool: match[1].trim(), desc: match[2].trim() };
			}
		}
		return { tool: rawTool ?? '', desc: rawDesc ?? '' };
	});

	const toolName = $derived(parsed.tool);
	const description = $derived(parsed.desc);
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	const argRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (toolName) rows.push({ key: 'Tool', value: toolName });
		const category = str(args.category) ?? str(details?.category);
		if (category) rows.push({ key: 'Categoria', value: category });
		const severity = str(args.severity) ?? str(details?.severity);
		if (severity) rows.push({ key: 'Severità', value: severity });
		return rows;
	});
</script>

<div class="report-body">
	{#if description}
		<PromptBlock text={description} label="Segnalazione anomalia" />
	{/if}

	{#if argRows.length > 0}
		<KeyValue rows={argRows} />
	{/if}

	{#if text && text !== description}
		<OutputBlock {text} label="riscontro" />
	{/if}
</div>

<style>
	.report-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
</style>
