<script lang="ts">
	// Renderer per `web_search` (ricerche sul web).
	//
	// Cosa mostra:
	// - summary: query di ricerca (`args.query`) troncata e badge con il numero
	//   di sorgenti/risultati trovati.
	// - body: eventuale risposta sintetica (`details.response.answer`), elenco delle
	//   fonti con titolo cliccabile (apre l'URL nel browser di sistema tramite
	//   `openUrl`), URL secondario in colore attenuato e snippet del testo. Se
	//   non ci sono fonti strutturate in `details`, mostra l'output formattato
	//   completo tramite `OutputBlock`.
	//
	// Comportamento quando `details` e' assente:
	// Il componente renderizza la query da `args` e il testo completo dal risultato
	// `resultText(result)` tramite `OutputBlock`, senza sollevare errori.

	import { openUrl } from '@tauri-apps/plugin-opener';
	import MarkdownInline from '../../components/MarkdownInline.svelte';
	import { lexMarkdownInline } from '../../markdown';
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

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

	const countBadgeText = $derived(
		sources.length > 0 ? countLabel(sources.length, 'risultato', 'risultati') : undefined
	);

	function openLink(url: string) {
		if (url) {
			void openUrl(url);
		}
	}
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if query}
			<span class="query-preview">{query}</span>
		{:else if text}
			<span class="fallback-preview">{text.split('\n', 1)[0]}</span>
		{/if}
		{#if countBadgeText}
			<CountBadge text={countBadgeText} />
		{/if}
	</span>
{:else}
	<div class="search-body">
		<div class="header-row">
			{#if query}
				<div class="query-box">
					<span class="query-label">Cerca:</span>
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
									title="Apri nel browser"
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
		gap: var(--space-1);
		font-size: var(--text-sm);
		min-width: 0;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}



	.answer-box {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}

	.answer-label {
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.answer-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink);
		line-height: 1.4;
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
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
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
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		line-height: 1.3;
		user-select: text;
	}

	.title-link:hover {
		text-decoration: underline;
		color: var(--brand-ink);
	}

	.title-plain {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
	}

	.source-age {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.source-url {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.source-snippet {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
		line-height: 1.4;
		user-select: text;
		overflow-wrap: anywhere;
	}
</style>
