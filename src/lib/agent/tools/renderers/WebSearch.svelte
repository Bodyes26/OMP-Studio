<!--
  Renderer per `web_search` (ricerche sul web).

  Nel corpo espanso mostra la query in sans (Two Voices Rule), l'eventuale risposta
  diretta con MarkdownInline, l'elenco delle fonti con link al browser di sistema
  e snippet testuali separati da linea neutra (Anti-Nesting Rule).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { openExternalUrl } from '$lib/utils/openExternal';
	import MarkdownInline from '../../components/MarkdownInline.svelte';
	import { lexMarkdownInline } from '../../markdown';
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const query = $derived(str(args.query) ?? '');
	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));
	const resp = $derived(asRecord(details?.response));

	const answer = $derived(str(resp?.answer) ?? str(details?.answer));
	const answerTokens = $derived(answer ? lexMarkdownInline(answer) : []);
	const provider = $derived(str(resp?.provider) ?? str(details?.provider));

	interface SearchSource {
		title: string;
		url: string;
		snippet?: string;
		age?: string;
	}

	const rawSources = $derived.by(() => {
		if (resp?.sources) return recordList(resp.sources);
		if (details?.sources) return recordList(details.sources);
		if (Array.isArray(result?.details)) return recordList(result.details);
		return [];
	});

	const sources = $derived.by<SearchSource[]>(() => {
		const list: SearchSource[] = [];
		for (const rec of rawSources) {
			const link = str(rec.url) ?? str(rec.link);
			const title = str(rec.title) ?? link ?? 'Risultato web';
			if (link || title) {
				list.push({
					title,
					url: link ?? '',
					snippet: str(rec.snippet) ?? str(rec.text) ?? str(rec.description),
					age: str(rec.age) ?? str(rec.publishedDate)
				});
			}
		}
		return list;
	});

	function openLink(url: string) {
		if (url) {
			void openExternalUrl(url);
		}
	}
</script>

<div class="search-body">
	<div class="header-row">
		{#if query}
			<div class="query-box">
				<span class="query-label">{m.ui_websearch_cerca_6394()}:</span>
				<span class="query-text">{query}</span>
			</div>
		{/if}
		{#if provider}
			<CountBadge text={provider} />
		{/if}
	</div>

	{#if answer}
		<div class="answer-box">
			<span class="answer-label">Risposta diretta</span>
			<div class="answer-text">
				<MarkdownInline tokens={answerTokens} />
			</div>
		</div>
	{/if}

	{#if sources.length > 0}
		<ul class="sources-list">
			{#each sources as source, index (source.url || index)}
				<li class="source-item">
					<div class="source-header">
						{#if source.url}
							<button
								type="button"
								class="title-link"
								onclick={() => openLink(source.url)}
								title={m.chat_v2_tool_open_in_browser()}
							>
								{source.title}
							</button>
						{:else}
							<span class="title-plain">{source.title}</span>
						{/if}
						{#if source.age}
							<span class="source-age">{source.age}</span>
						{/if}
					</div>
					{#if source.url}
						<span class="source-url">{source.url}</span>
					{/if}
					{#if source.snippet}
						<p class="source-snippet">{source.snippet}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if text}
		<OutputBlock {text} label="risultati ricerca" />
	{/if}
</div>

<style>
	.search-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}

	.query-box {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
		min-width: 0;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.answer-box {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--brand);
	}

	.answer-label {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-faint);
	}

	.answer-text {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.45;
		user-select: text;
	}

	.sources-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.source-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1) var(--space-2);
		border-left: 2px solid var(--line);
	}

	.source-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}

	.title-link {
		background: transparent;
		border: none;
		padding: 0;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.title-link:hover {
		color: var(--brand-ink);
		text-decoration: underline;
	}

	.title-plain {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-age {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.source-url {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source-snippet {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.4;
		user-select: text;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
