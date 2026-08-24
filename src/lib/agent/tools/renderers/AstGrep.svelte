<!--
  Renderer per il tool `ast_grep`.

  Forma attesa di `details`:
  `matchCount` (number), `fileCount` (number), `filesSearched` (number),
  `limitReached` (boolean), `files` (string[]), `fileMatches` ({ path: string, count: number }[]),
  `parseErrors` (string[]), `displayContent` (string).

  Comportamento quando `details` manca o e' incompleto:
  Mostra il pattern cercato in `args.pat` e gli argomenti noti in KeyValue. I percorsi
  dei file trovati in `details.files` o `details.fileMatches` vengono resi con PathChip.
  L'output testuale viene mostrato in OutputBlock.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
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
	const pat = $derived(str(args.pat) ?? '');
	const pathArg = $derived(str(args.path));
	const skip = $derived(num(args.skip));

	const matchCount = $derived(num(details?.matchCount));
	const fileCount = $derived(num(details?.fileCount));
	const files = $derived(strList(details?.files));
	const fileMatches = $derived(recordList(details?.fileMatches));
	const text = $derived(resultText(result));
	const parseErrors = $derived(strList(details?.parseErrors));

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (pat) rows.push({ key: 'Pattern', value: pat });
		if (pathArg) rows.push({ key: 'Percorso', value: pathArg });
		if (skip !== undefined && skip > 0) rows.push({ key: 'Skip', value: String(skip) });
		if (fileCount !== undefined) {
			rows.push({ key: 'File controllati', value: String(fileCount) });
		}
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="ast-grep-summary">
		<span class="pattern-text">{pat || 'ast-grep'}</span>
		{#if matchCount !== undefined}
			<CountBadge text={countLabel(matchCount, 'occorrenza', 'occorrenze')} />
		{/if}
	</div>
{:else}
	<div class="ast-grep-body">
		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if fileMatches.length > 0}
			<div class="files-list">
				{#each fileMatches as fm, index (index)}
					{@const filePath = str(fm.path)}
					{@const count = num(fm.count)}
					{#if filePath}
						<div class="file-match-row">
							<PathChip path={filePath} />
							{#if count !== undefined}
								<CountBadge text={countLabel(count, 'risultato', 'risultati')} muted />
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{:else if files.length > 0}
			<div class="files-list">
				{#each files as f (f)}
					<PathChip path={f} />
				{/each}
			</div>
		{/if}

		{#if text}
			<OutputBlock {text} label="risultati ast-grep" />
		{/if}

		{#if parseErrors.length > 0}
			<OutputBlock text={parseErrors.join('\n')} label="errori di parsing" />
		{/if}
	</div>
{/if}

<style>
	.ast-grep-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pattern-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.ast-grep-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.files-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px 0;
	}

	.file-match-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
