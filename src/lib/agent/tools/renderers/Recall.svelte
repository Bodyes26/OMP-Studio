<!--
  Renderer per `recall` (ricerca nella memoria a lungo termine).

  Nel corpo espanso mostra la query in sans (Two Voices Rule), l'elenco dei ricordi
  con metadati e score tabulari allineati, oppure l'output testuale.
-->
<script lang="ts">
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const query = $derived(str(args.query) ?? '');
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	interface MemoryItem {
		text: string;
		score?: number;
		id?: string;
		source?: string;
		date?: string;
	}

	const rawList = $derived.by(() => {
		if (details?.memories) return recordList(details.memories);
		if (details?.results) return recordList(details.results);
		if (details?.items) return recordList(details.items);
		if (Array.isArray(result?.details)) return recordList(result.details);
		return [];
	});

	const memoryList = $derived.by<MemoryItem[]>(() => {
		const out: MemoryItem[] = [];
		for (const rec of rawList) {
			const content = str(rec.text) ?? str(rec.content) ?? str(rec.memory);
			if (!content) continue;
			out.push({
				text: content,
				score: num(rec.score),
				id: str(rec.id),
				source: str(rec.source) ?? str(rec.type),
				date: str(rec.mentioned_at) ?? str(rec.date)
			});
		}
		return out;
	});
</script>

<div class="recall-body">
	{#if query}
		<div class="query-box">
			<span class="query-label">Query:</span>
			<span class="query-text">{query}</span>
		</div>
	{/if}

	{#if memoryList.length > 0}
		<ul class="memory-list">
			{#each memoryList as item, index (item.id ?? index)}
				<li class="memory-item">
					<div class="memory-main">
						<p class="memory-text">{item.text}</p>
						<div class="memory-meta">
							{#if item.id}
								<span class="meta-id">#{item.id}</span>
							{/if}
							{#if item.source}
								<span class="meta-source">{item.source}</span>
							{/if}
							{#if item.date}
								<span class="meta-date">{item.date}</span>
							{/if}
						</div>
					</div>
					{#if item.score !== undefined}
						<span class="memory-score" title={`Score: ${item.score}`}>
							{item.score.toFixed(2)}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if text}
		<OutputBlock {text} label="risultati recall" />
	{/if}
</div>

<style>
	.recall-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.query-box {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.query-label {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.query-text {
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		user-select: text;
	}

	.memory-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.memory-item {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--line);
	}

	.memory-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.memory-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.45;
		user-select: text;
		overflow-wrap: anywhere;
	}

	.memory-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		color: var(--ink-faint);
	}

	.meta-id {
		color: var(--ink-faint);
	}

	.meta-source {
		padding: 0 4px;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
	}

	.memory-score {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
