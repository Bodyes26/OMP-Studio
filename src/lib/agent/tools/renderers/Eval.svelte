<!--
  Renderer per il tool `eval`.

  Rappresenta l'esecuzione di codice interattivo (Python, JavaScript, ecc.)
  in celle REPL. Elenca ogni cella con codice sorgente in monospazio a 12px,
  output prodotto, codice di uscita, durata e stato di errore mirato.
-->
<script lang="ts">
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

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));

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

	const textFallback = $derived(resultText(result));
</script>

<div class="eval-body">
	{#if cells.length > 0}
		<div class="cells-list">
			{#each cells as cell, i (cell.index ?? i)}
				<div class="cell-card">
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

<style>
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
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--line);
	}

	.cell-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.cell-title {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink);
	}

	.cell-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.cell-status {
		font-weight: 500;
		color: var(--ink-faint);
	}

	.cell-status.status-running {
		color: var(--ink-muted);
	}

	.cell-status.status-error {
		color: var(--danger);
	}

	.exit-code {
		font-family: var(--font-mono);
		color: var(--danger);
	}

	.cell-dur {
		color: var(--ink-faint);
	}

	.cell-code {
		margin: 0;
		padding: var(--space-1) var(--space-2);
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	code {
		font-family: inherit;
		font-size: inherit;
	}
</style>
