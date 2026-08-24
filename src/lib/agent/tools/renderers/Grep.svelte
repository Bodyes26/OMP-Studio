<!--
  Renderer per il tool `grep`.

  Mostra il pattern cercato e il conteggio di occorrenze e file coinvolti
  nel sommario. Nel corpo elenca i file con il rispettivo conteggio di match,
  il blocco di output formattato con i numeri di riga e l'eventuale avviso di
  troncamento se i risultati superano i limiti del server.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		bool,
		countLabel,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const pattern = $derived(str(args.pattern) ?? str(args.query) ?? '');
	const matchCount = $derived(num(details?.matchCount));
	const fileCount = $derived(num(details?.fileCount));
	const truncated = $derived(bool(details?.truncated) === true);

	const summaryBadge = $derived.by(() => {
		if (matchCount !== undefined && fileCount !== undefined) {
			return `${countLabel(matchCount, 'occorrenza', 'occorrenze')} in ${countLabel(fileCount, 'file', 'file')}`;
		}
		if (matchCount !== undefined) {
			return countLabel(matchCount, 'occorrenza', 'occorrenze');
		}
		if (fileCount !== undefined) {
			return countLabel(fileCount, 'file', 'file');
		}
		return undefined;
	});

	interface FileMatchItem {
		path: string;
		count?: number;
	}

	const fileMatches = $derived.by<FileMatchItem[]>(() => {
		const raw = recordList(details?.fileMatches);
		const list: FileMatchItem[] = [];
		for (const entry of raw) {
			const p = str(entry.path);
			if (p) {
				list.push({ path: p, count: num(entry.count) });
			}
		}
		return list;
	});

	const displayContent = $derived(str(details?.displayContent) ?? resultText(result));
</script>

{#if view === 'summary'}
	<div class="grep-summary">
		{#if pattern}
			<span class="pattern" title={pattern}>{pattern}</span>
		{/if}
		{#if summaryBadge}
			<CountBadge text={summaryBadge} />
		{/if}
	</div>
{:else}
	<div class="grep-body">
		{#if fileMatches.length > 0}
			<div class="file-matches">
				{#each fileMatches as item (item.path)}
					<div class="match-row">
						<PathChip path={item.path} />
						{#if item.count !== undefined}
							<CountBadge text={countLabel(item.count, 'match', 'match')} muted />
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if displayContent}
			<OutputBlock text={displayContent} label="risultati grep" />
		{/if}
		{#if truncated}
			<div class="truncated-notice">Risultati troncati per superamento del limite.</div>
		{/if}
	</div>
{/if}

<style>
	.grep-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pattern {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.grep-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.file-matches {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.match-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.truncated-notice {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-style: italic;
	}
</style>
