<!--
  Renderer per il tool `grep`.

  Nel corpo elenca i file con il rispettivo conteggio di match tramite PathChip e CountBadge,
  il blocco di output formattato e l'eventuale EmptyNotice se i risultati superano i limiti.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import CountBadge from '../parts/CountBadge.svelte';
	import EmptyNotice from '../parts/EmptyNotice.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import PathChip from '../parts/PathChip.svelte';
	import {
		asRecord,
		bool,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const truncated = $derived(bool(details?.truncated) === true);

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

<div class="grep-body">
	{#if fileMatches.length > 0}
		<div class="file-matches">
			{#each fileMatches as item (item.path)}
				<div class="match-row">
					<PathChip path={item.path} />
					{#if item.count !== undefined}
						<CountBadge text={m.chat_matches_count({ count: item.count })} muted />
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if displayContent}
		<OutputBlock text={displayContent} label="risultati grep" />
	{/if}
	{#if truncated}
		<EmptyNotice text="Risultati troncati per superamento del limite." />
	{/if}
</div>

<style>
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
</style>
