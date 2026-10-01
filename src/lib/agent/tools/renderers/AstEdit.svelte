<!--
  Renderer per il tool `ast_edit`.

  Nel corpo espanso mostra la lista delle operazioni AST (pattern e sostituzioni),
  i percorsi dei file toccati con PathChip, l'eventuale diff unificato
  e gli errori di parsing se presenti.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import Diff from '../parts/Diff.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const ops = $derived(recordList(args.ops));
	const paths = $derived(strList(args.paths));
	const diff = $derived(str(details?.diff));
	const text = $derived(resultText(result));
	const parseErrors = $derived(strList(details?.parseErrors));
</script>

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

<style>
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
		border-left: 2px solid var(--line);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.op-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
	}

	code {
		font-family: inherit;
		font-size: var(--text-sm);
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
