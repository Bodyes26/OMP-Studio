<!--
  Renderer per il tool `github`.

  Nel corpo espanso mostra la tabella KeyValue con i parametri della chiamata,
  l'elenco degli elementi (issue, PR, checkouts) con link al browser di sistema
  separati da linea neutra (Anti-Nesting Rule), e l'output testuale in OutputBlock.
-->
<script lang="ts">
	import { openExternalUrl } from '$lib/utils/openExternal';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import { IconExternalLink } from '$lib/icons';
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
	const op = $derived(str(details?.op) ?? str(args.op) ?? str(args.action) ?? 'github');
	const repo = $derived(str(details?.repo) ?? str(args.repo));
	const pr = $derived(str(args.pr));
	const prList = $derived(strList(args.pr));
	const branch = $derived(str(details?.branch) ?? str(args.branch));
	const pathArg = $derived(str(args.path));
	const query = $derived(str(args.query));
	const run = $derived(str(args.run));
	const title = $derived(str(args.title));
	const text = $derived(resultText(result));

	const items = $derived.by(() => {
		if (!details) return [];
		const raw = details.items ?? details.checkouts ?? details.prs ?? details.issues;
		return recordList(raw);
	});

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Operazione', value: op });
		if (repo) rows.push({ key: 'Repository', value: repo });
		if (branch) rows.push({ key: 'Branch', value: branch });
		if (pr) rows.push({ key: 'PR', value: pr });
		if (prList.length > 0) rows.push({ key: 'PRs', value: prList.join(', ') });
		if (pathArg) rows.push({ key: 'Percorso', value: pathArg });
		if (query) rows.push({ key: 'Query', value: query });
		if (title) rows.push({ key: 'Titolo', value: title });
		if (run) rows.push({ key: 'Run ID', value: run });
		return rows;
	});

	function openLink(url: string) {
		if (url) {
			void openExternalUrl(url);
		}
	}
</script>

<div class="gh-body">
	{#if argsRows.length > 0}
		<KeyValue rows={argsRows} />
	{/if}

	{#if items.length > 0}
		<div class="items-list">
			{#each items as item, index (index)}
				{@const itemNum = str(item.number) ?? (typeof item.number === 'number' ? String(item.number) : undefined)}
				{@const itemTitle = str(item.title) ?? str(item.name)}
				{@const itemUrl = str(item.url) ?? str(item.html_url)}
				{@const itemState = str(item.state) ?? str(item.status)}
				<div class="item-card">
					{#if itemNum}
						<span class="item-num">#{itemNum}</span>
					{/if}
					{#if itemTitle}
						<span class="item-title">{itemTitle}</span>
					{/if}
					{#if itemState}
						<span class="item-state">{itemState}</span>
					{/if}
					{#if itemUrl}
						<button
							type="button"
							class="item-link"
							onclick={() => openLink(itemUrl)}
							title="Apri nel browser"
						>
							apri <span class="link-icon"><IconExternalLink /></span>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if text}
		<OutputBlock {text} label="risultato github" />
	{/if}
</div>

<style>
	.gh-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.item-card {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--line);
		font-size: var(--text-sm);
	}

	.item-num {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.item-title {
		font-family: var(--font-ui);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-state {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.item-link {
		margin-left: auto;
		background: transparent;
		border: none;
		padding: 0;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
		gap: 2px;
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.item-link:hover {
		color: var(--brand-ink);
	}

	.link-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
	}
</style>
