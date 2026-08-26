<!--
  Renderer per il tool `eval`.

  Rappresenta l'esecuzione di codice interattivo (Python, JavaScript, ecc.)
  in celle REPL. Nel sommario mostra il linguaggio, il titolo dell'ultima cella
  eseguita e l'esito complessivo. Nel corpo elenca ogni cella con codice sorgente
  in monospazio selezionabile, output prodotto, codice di uscita (exitCode),
  durata e marcatura speciale per le celle non completate con successo.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		formatDuration,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const language = $derived(
		str(details?.language) ?? str(args.language) ?? str(args.lang) ?? 'eval'
	);

	interface CellItem {
		index?: number;
		title: string;
		code: string;
		output?: string;
		status: string;
		exitCode?: number;
		durationMs?: number;
	}

	const cells = $derived.by<CellItem[]>(() => {
		const raw = recordList(details?.cells);
		if (raw.length === 0) {
			const code = str(args.code) ?? str(args.input);
			if (code) {
				return [
					{
						title: str(args.title) ?? 'Cella',
						code,
						output: resultText(result) || undefined,
						status: result?.isError ? 'error' : 'complete'
					}
				];
			}
			return [];
		}

		return raw.map((c, i) => {
			const idx = num(c.index) ?? i;
			return {
				index: idx,
				title: str(c.title) ?? `Cella ${idx + 1}`,
				code: str(c.code) ?? '',
				output: str(c.output),
				status: str(c.status) ?? 'complete',
				exitCode: num(c.exitCode),
				durationMs: num(c.durationMs)
			};
		});
	});

	const lastCell = $derived(cells.at(-1));

	const summaryOutcome = $derived.by(() => {
		if (cells.length === 0) return undefined;
		const hasError = cells.some(
			(c) => c.status !== 'complete' || (c.exitCode !== undefined && c.exitCode !== 0)
		);
		if (hasError) return 'errore';
		return 'completato';
	});

	const textFallback = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="eval-summary">
		<CountBadge text={language} />
		{#if lastCell?.title}
			<span class="last-title" title={lastCell.title}>{lastCell.title}</span>
		{/if}
		{#if summaryOutcome}
			<CountBadge text={summaryOutcome} muted={summaryOutcome === 'completato'} />
		{/if}
	</div>
{:else}
	<div class="eval-body">
		{#if cells.length > 0}
			<div class="cells-list">
				{#each cells as cell, i (cell.index ?? i)}
					<div class="cell-card" class:has-error={cell.status !== 'complete' || (cell.exitCode !== undefined && cell.exitCode !== 0)}>
						<div class="cell-head">
							<span class="cell-title">{cell.title}</span>
							<div class="cell-meta">
								{#if cell.status !== 'complete'}
									<span class="cell-status status-{cell.status}">{cell.status}</span>
								{/if}
								{#if cell.exitCode !== undefined && cell.exitCode !== 0}
									<span class="exit-code">exit: {cell.exitCode}</span>
								{/if}
								{#if cell.durationMs !== undefined}
									<span class="cell-dur">{formatDuration(cell.durationMs)}</span>
								{/if}
							</div>
						</div>
						{#if cell.code}
							<pre class="cell-code"><code>{cell.code}</code></pre>
						{/if}
						{#if cell.output}
							<OutputBlock text={cell.output} label="output cella" />
						{/if}
					</div>
				{/each}
			</div>
		{:else if textFallback}
			<OutputBlock text={textFallback} label="output eval" />
		{/if}
	</div>
{/if}

<style>
	.eval-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.last-title {
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.eval-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.cells-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.cell-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.cell-card.has-error {
		border-color: var(--danger);
	}

	.cell-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.cell-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.cell-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
	}

	.cell-status {
		font-weight: 500;
		color: var(--ink-faint);
	}

	.cell-status.status-running {
		color: var(--warn);
	}

	.cell-status.status-error {
		color: var(--danger);
	}

	.exit-code {
		font-family: var(--font-mono);
		color: var(--danger);
		font-variant-numeric: tabular-nums;
	}
	.cell-dur {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.cell-code {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}
</style>
