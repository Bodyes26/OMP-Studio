<!--
  Renderer per il tool `github`.

  Forma attesa di `details`:
  `op` (string), `repo` (string), `branch` (string), `worktreePath` (string),
  `remote` (string), `remoteBranch` (string), `headSha` (string), `runId` (string),
  `status` (string), `conclusion` (string), `checkouts` (array), `items` (array).

  Comportamento quando `details` manca o e' incompleto:
  Mostra l'operazione (`op` o `action`) e il target (repo, PR, branch, query) nel sommario.
  Nel corpo mostra la tabella KeyValue con i parametri della chiamata, un elenco
  compatto per le liste di elementi (issue, PR, commit) se presenti in `details`,
  e l'output testuale in OutputBlock.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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

	const targetLabel = $derived.by(() => {
		let out = '';
		if (repo) out += repo;
		if (pr) out += ` #${pr}`;
		else if (prList.length > 0) out += ` #${prList.join(', #')}`;
		else if (branch) out += ` (${branch})`;
		else if (pathArg) out += ` · ${pathArg}`;
		else if (run) out += ` (run ${run})`;
		if (query) out += ` "${query}"`;
		return out.trim();
	});

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
</script>

{#if view === 'summary'}
	<div class="gh-summary">
		<span class="op-tag">{op}</span>
		{#if targetLabel}
			<span class="target-text">{targetLabel}</span>
		{/if}
	</div>
{:else}
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
							<a href={itemUrl} target="_blank" rel="noreferrer" class="item-link">apri ↗</a>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if text}
			<OutputBlock {text} label="risultato github" />
		{/if}
	</div>
{/if}

<style>
	.gh-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.op-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.target-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.gh-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px 0;
	}

	.item-card {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
	}

	.item-num {
		font-family: var(--font-mono);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	.item-title {
		color: var(--ink);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-state {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.item-link {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		text-decoration: none;
		white-space: nowrap;
	}

	.item-link:hover {
		color: var(--ink);
		text-decoration: underline;
	}
</style>
