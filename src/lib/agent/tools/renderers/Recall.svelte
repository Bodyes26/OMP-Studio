<script lang="ts">
	// Renderer per `recall` (ricerca nella memoria a lungo termine).
	//
	// Cosa mostra:
	// - summary: query di ricerca (`args.query`) troncata e badge con il numero
	//   di ricordi trovati (da `details` o dedotto dal testo).
	// - body: se `details` contiene una lista di ricordi strutturati (`text`/`content`,
	//   `score`, `id`, `source`, `date`), renderizza un elenco con punteggio di
	//   rilevanza allineato a destra; altrimenti mostra l'output testuale completo
	//   tramite `OutputBlock`.
	//
	// Comportamento quando `details` e' assente:
	// Il componente mostra la query e il testo formattato del risultato tramite
	// `OutputBlock`, provando a dedurre il conteggio dei ricordi dal testo
	// restituito per il summary.

	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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

	const deducedCount = $derived.by<number | undefined>(() => {
		if (memoryList.length > 0) return memoryList.length;
		if (num(details?.count) !== undefined) return num(details?.count);
		const match = /Found (\d+) relevant memor/i.exec(text);
		if (match && match[1]) {
			const parsed = parseInt(match[1], 10);
			if (Number.isFinite(parsed)) return parsed;
		}
		if (/No relevant memories found/i.test(text)) return 0;
		return undefined;
	});

	const countBadgeText = $derived(
		deducedCount !== undefined ? countLabel(deducedCount, 'ricordo', 'ricordi') : undefined
	);
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if query}
			<span class="query-preview">{query}</span>
		{:else if text}
			<span class="fallback-preview">{text.split('\n', 1)[0]}</span>
		{/if}
		{#if countBadgeText}
			<CountBadge text={countBadgeText} muted={deducedCount === 0} />
		{/if}
	</span>
{:else}
	<div class="recall-body">
		{#if query}
			<div class="query-box">
				<span class="query-label">Query</span>
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

	.query-preview {
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
		font-size: var(--text-xs);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.query-text {
		color: var(--ink);
		font-family: var(--font-mono);
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
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.memory-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.memory-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
		user-select: text;
		overflow-wrap: anywhere;
	}

	.memory-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
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
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
