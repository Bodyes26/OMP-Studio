<!--
  Renderer per il tool `ast_edit`.

  Forma attesa di `details`:
  `totalReplacements` (number), `filesTouched` (number), `filesSearched` (number),
  `applied` (boolean), `limitReached` (boolean), `diff` (string con formato
  `<segno><numero>|<testo>`), `parseErrors` (string[]).

  Comportamento quando `details` manca o e' incompleto:
  Mostra il conteggio e la lista delle operazioni da `args.ops` e i percorsi da
  `args.paths` con PathChip. Se `details.diff` e' presente lo renderizza con Diff,
  altrimenti mostra l'output testuale in OutputBlock.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import Diff from '../parts/Diff.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		countLabel,
		num,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const ops = $derived(recordList(args.ops));
	const paths = $derived(strList(args.paths));
	const diff = $derived(str(details?.diff));
	const totalReplacements = $derived(num(details?.totalReplacements));
	const text = $derived(resultText(result));
	const parseErrors = $derived(strList(details?.parseErrors));

	const opsCountLabel = $derived(countLabel(ops.length, 'operazione', 'operazioni'));
	const pathsCountLabel = $derived(countLabel(paths.length, 'percorso', 'percorsi'));
</script>

{#if view === 'summary'}
	<div class="ast-edit-summary">
		<span class="summary-text">
			{opsCountLabel} in {pathsCountLabel}
		</span>
		{#if totalReplacements !== undefined}
			<CountBadge text={countLabel(totalReplacements, 'sostituzione', 'sostituzioni')} />
		{/if}
	</div>
{:else}
	<div class="ast-edit-body">
		{#if ops.length > 0}
			<div class="ops-list">
				{#each ops as op, index (index)}
					{@const pat = str(op.pat) ?? ''}
					{@const out = typeof op.out === 'string' ? op.out : ''}
					<div class="op-card">
						<div class="op-row">
							<CountBadge text="pat" muted />
							<code>{pat}</code>
						</div>
						<div class="op-row">
							<CountBadge text="out" muted />
							<code>{out.length > 0 ? out : '(nodo rimosso)'}</code>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if paths.length > 0}
			<div class="paths-list">
				{#each paths as p (p)}
					<PathChip path={p} />
				{/each}
			</div>
		{/if}

		{#if diff}
			<Diff {diff} />
		{/if}

		{#if text}
			<OutputBlock {text} label="risultato ast-edit" />
		{/if}

		{#if parseErrors.length > 0}
			<OutputBlock text={parseErrors.join('\n')} label="errori di parsing" />
		{/if}
	</div>
{/if}

<style>
	.ast-edit-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.summary-text {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	.ast-edit-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.ops-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.op-card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.op-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	code {
		font-family: inherit;
		color: var(--ink-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	.paths-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		padding: 2px 0;
	}
</style>
