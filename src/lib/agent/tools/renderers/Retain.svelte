<script lang="ts">
	// Renderer per `retain` (memorizzazione di fatti duraturi).
	//
	// Cosa mostra:
	// - summary: prima riga del primo fatto memorizzato, eventuale tag/categoria
	//   e badge con il conteggio degli elementi.
	// - body: elenco strutturato dei fatti da memorizzare (`args.items` o
	//   `args.content`) con relativo contesto, metadati (`KeyValue`) e
	//   riscontro testuale dal backend (`OutputBlock`).
	//
	// Comportamento quando `details` e' assente:
	// Il componente legge la lista degli elementi o il contenuto direttamente
	// da `args` e il testo di conferma da `resultText(result)`, senza dipendere
	// da campi specifici di `details`.

	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		num,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	interface RetainItem {
		content: string;
		context?: string;
	}

	// `recordList` scarta le stringhe (non sono record): `args.items` puo'
	// contenere sia oggetti `{content}` sia semplici stringhe di fatto.
	const rawItems = $derived(Array.isArray(args.items) ? args.items : []);
	const singleContent = $derived(str(args.content));
	const tag = $derived(str(args.tag) ?? str(args.category));
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	const items = $derived.by<RetainItem[]>(() => {
		const list: RetainItem[] = [];
		for (const raw of rawItems) {
			if (typeof raw === 'string') {
				if (raw) list.push({ content: raw });
				continue;
			}
			const rec = asRecord(raw);
			const c = str(rec?.content) ?? str(rec?.text);
			if (c) {
				list.push({ content: c, context: str(rec?.context) });
			}
		}
		if (list.length === 0 && singleContent) {
			list.push({ content: singleContent, context: str(args.context) });
		}
		return list;
	});

	const firstItemText = $derived.by(() => {
		if (items.length > 0 && items[0]) {
			return items[0].content.split('\n', 1)[0] ?? '';
		}
		if (text) {
			return text.split('\n', 1)[0] ?? '';
		}
		return '';
	});

	const count = $derived(items.length > 0 ? items.length : num(details?.count));

	const countBadgeText = $derived(
		count !== undefined && count > 1 ? countLabel(count, 'elemento', 'elementi') : undefined
	);

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (tag) rows.push({ key: 'tag', value: tag });
		const bank = str(details?.bank) ?? str(details?.bankId);
		if (bank) rows.push({ key: 'banca', value: bank });
		return rows;
	});
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if tag}
			<span class="tag-badge">{tag}</span>
		{/if}
		{#if firstItemText}
			<span class="content-preview">{firstItemText}</span>
		{/if}
		{#if countBadgeText}
			<CountBadge text={countBadgeText} />
		{/if}
	</span>
{:else}
	<div class="retain-body">
		{#if metaRows.length > 0}
			<KeyValue rows={metaRows} />
		{/if}

		{#if items.length > 0}
			<ul class="items-list">
				{#each items as item, index (index)}
					<li class="item-card">
						<p class="item-content">{item.content}</p>
						{#if item.context}
							<div class="item-context">
								<span class="context-label">Contesto:</span>
								<span class="context-text">{item.context}</span>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if text}
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

	.tag-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		flex-shrink: 0;
	}

	.content-preview {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.retain-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item-card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.item-content {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
		user-select: text;
		overflow-wrap: anywhere;
	}

	.item-context {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.context-label {
		flex-shrink: 0;
	}

	.context-text {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		user-select: text;
	}
</style>
