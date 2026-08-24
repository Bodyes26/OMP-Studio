<script lang="ts">
	// Renderer per `report_issue` (segnalazione anomalie su tool).
	//
	// Cosa mostra:
	// - summary: nome del tool segnalato in un badge e descrizione sintetica
	//   dell'anomalia.
	// - body: tabella `KeyValue` con i dettagli della segnalazione (tool,
	//   categoria, severita'), descrizione completa dell'anomalia e riscontro
	//   del sistema tramite `OutputBlock`.
	//
	// Comportamento quando `details` e' assente:
	// Il componente estrae le informazioni direttamente da `args` (gestendo
	// sia campi strutturati sia la sintassi testuale `<tool>: <descrizione>`)
	// e dal testo in `resultText(result)`, senza dipendere da `details`.

	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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
		if (toolName) rows.push({ key: 'tool', value: toolName });
		const category = str(args.category) ?? str(details?.category);
		if (category) rows.push({ key: 'categoria', value: category });
		const severity = str(args.severity) ?? str(details?.severity);
		if (severity) rows.push({ key: 'severita', value: severity });
		return rows;
	});

	const firstDescLine = $derived(description.split('\n', 1)[0] ?? '');
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if toolName}
			<span class="tool-badge">{toolName}</span>
		{/if}
		{#if firstDescLine}
			<span class="desc-preview">{firstDescLine}</span>
		{:else if text}
			<span class="fallback-preview">{text.split('\n', 1)[0]}</span>
		{/if}
	</span>
{:else}
	<div class="report-body">
		{#if argRows.length > 0}
			<KeyValue rows={argRows} />
		{/if}

		{#if description}
			<div class="desc-section">
				<span class="desc-label">Segnalazione</span>
				<p class="desc-text">{description}</p>
			</div>
		{/if}

		{#if text && text !== description}
			<OutputBlock {text} label="riscontro" />
		{/if}
	</div>
{/if}

<style>
	.summary-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.tool-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--warn);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		flex-shrink: 0;
	}

	.desc-preview {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fallback-preview {
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.report-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.desc-section {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.desc-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.desc-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
