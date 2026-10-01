<!--
  Renderer per `retain` (memorizzazione di fatti duraturi).

  Nel corpo espanso mostra l'elenco dei fatti da memorizzare con eventuale contesto,
  la tabella KeyValue con i metadati e il riscontro in OutputBlock.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	interface RetainItem {
		content: string;
		context?: string;
	}

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

	const metaRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (tag) rows.push({ key: 'Tag', value: tag });
		const bank = str(details?.bank) ?? str(details?.bankId);
		if (bank) rows.push({ key: 'Banca', value: bank });
		return rows;
	});
</script>

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

<style>
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
		border-left: 2px solid var(--line);
	}

	.item-content {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.45;
		user-select: text;
		overflow-wrap: anywhere;
	}

	.item-context {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
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
