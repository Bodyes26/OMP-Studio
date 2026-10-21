<script lang="ts">
	// Rendering a blocchi dell'albero di token di marked.
	// L'HTML non e' mai interpretato: viene reso come testo grezzo in <pre>.
	// L'unico {@html} ammesso in tutto il progetto e' il risultato di
	// `colorizeCode`, che produce markup generato da Monaco.
	import type { Token } from '../markdown';
	import CodeBlock from './CodeBlock.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownInline from './MarkdownInline.svelte';
	import SmartTable from '../intelligent-ui/SmartTable.svelte';
	import CalloutCard from '../intelligent-ui/CalloutCard.svelte';
	import MetricGrid from '../intelligent-ui/MetricGrid.svelte';
	import InteractiveTabs from '../intelligent-ui/InteractiveTabs.svelte';
	import AccordionCard from '../intelligent-ui/AccordionCard.svelte';
	import ProcessStepper from '../intelligent-ui/ProcessStepper.svelte';
	import CompareSlider from '../intelligent-ui/CompareSlider.svelte';
	import {
		parseCallout,
		parseMetricBlock,
		parseTabsBlock,
		parseStepsBlock,
		parseCompareBlock,
		parseAccordionBlock
	} from '../intelligent-ui/parsers';

	let {
		tokens = [],
		onOpenFile
	}: {
		tokens?: Token[];
		onOpenFile?: (path: string) => void;
	} = $props();
</script>

{#each tokens as token, i (`${i}:${token.type}`)}
	{#if token.type === 'heading'}
		{#if token.depth === 1}
			<h1 class="heading h1"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h1>
		{:else if token.depth === 2}
			<h2 class="heading h2"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h2>
		{:else if token.depth === 3}
			<h3 class="heading h3"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h3>
		{:else if token.depth === 4}
			<h4 class="heading h4"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h4>
		{:else if token.depth === 5}
			<h5 class="heading h5"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h5>
		{:else}
			<h6 class="heading h6"><MarkdownInline tokens={token.tokens} {onOpenFile} /></h6>
		{/if}
	{:else if token.type === 'paragraph'}
		<p class="paragraph"><MarkdownInline tokens={token.tokens} {onOpenFile} /></p>
	{:else if token.type === 'code'}
		{@const lang = (token.lang || '').trim().toLowerCase()}
		{#if lang === 'ui:metric' || lang === 'ui:stat'}
			{@const metrics = parseMetricBlock(token.text)}
			{#if metrics}
				<MetricGrid items={metrics} />
			{:else}
				<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
			{/if}
		{:else if lang === 'ui:tabs'}
			{@const tabs = parseTabsBlock(token.text)}
			{#if tabs}
				<InteractiveTabs {tabs} {onOpenFile} />
			{:else}
				<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
			{/if}
		{:else if lang === 'ui:steps'}
			{@const steps = parseStepsBlock(token.text)}
			{#if steps}
				<ProcessStepper {steps} />
			{:else}
				<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
			{/if}
		{:else if lang === 'ui:compare'}
			{@const comp = parseCompareBlock(token.text)}
			{#if comp}
				<CompareSlider {...comp} />
			{:else}
				<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
			{/if}
		{:else if lang === 'ui:accordion'}
			{@const acc = parseAccordionBlock(token.text)}
			{#if acc}
				<AccordionCard title={acc.title} badge={acc.badge}>
					<p class="paragraph">{acc.content}</p>
				</AccordionCard>
			{:else}
				<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
			{/if}
		{:else}
			<CodeBlock lang={token.lang} text={token.text} {onOpenFile} />
		{/if}
	{:else if token.type === 'blockquote'}
		{@const callout = parseCallout(token)}
		{#if callout}
			<CalloutCard kind={callout.kind} title={callout.title}>
				<Markdown tokens={callout.bodyTokens} {onOpenFile} />
			</CalloutCard>
		{:else}
			<blockquote class="blockquote">
				<Markdown tokens={token.tokens} {onOpenFile} />
			</blockquote>
		{/if}
	{:else if token.type === 'list'}
		{#if token.ordered}
			<ol start={typeof token.start === 'number' ? token.start : 1} class="list ordered">
				{#each token.items as item, itemIdx (`${itemIdx}:${item.task ? 'task' : 'item'}`)}
					<li class="list-item" class:task-item={item.task}>
						{#if item.task}
							<input type="checkbox" checked={item.checked} disabled class="task-checkbox" />
						{/if}
						<div class="item-content">
							<Markdown tokens={item.tokens} {onOpenFile} />
						</div>
					</li>
				{/each}
			</ol>
		{:else}
			<ul class="list unordered">
				{#each token.items as item, itemIdx (`${itemIdx}:${item.task ? 'task' : 'item'}`)}
					<li class="list-item" class:task-item={item.task}>
						{#if item.task}
							<input type="checkbox" checked={item.checked} disabled class="task-checkbox" />
						{/if}
						<div class="item-content">
							<Markdown tokens={item.tokens} {onOpenFile} />
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if token.type === 'table'}
		<SmartTable header={token.header} rows={token.rows} {onOpenFile} />
	{:else if token.type === 'hr'}
		<hr class="hr" />
	{:else if token.type === 'html'}
		<pre class="raw-html">{token.text}</pre>
	{:else if token.type === 'space'}
		<!-- Spazio vuoto ignorato -->
	{:else if token.type === 'text'}
		<div class="text-block">
			{#if 'tokens' in token && token.tokens && token.tokens.length > 0}
				<MarkdownInline tokens={token.tokens} {onOpenFile} />
			{:else}
				{token.text}
			{/if}
		</div>
	{:else if 'tokens' in token && token.tokens}
		<div class="generic-block">
			<MarkdownInline tokens={token.tokens} {onOpenFile} />
		</div>
	{:else if 'text' in token && typeof token.text === 'string'}
		<p class="paragraph">{token.text}</p>
	{/if}
{/each}

<style>
	.heading {
		color: var(--ink);
		margin: var(--space-3) 0 var(--space-1) 0;
	}

	.heading:first-child {
		margin-top: 0;
	}

	.heading.h1, .h1 {
		font-size: var(--text-prose-h1);
		font-weight: 600;
		line-height: 1.3;
	}

	.heading.h2, .h2 {
		font-size: var(--text-prose-h2);
		font-weight: 600;
		line-height: 1.35;
	}

	.heading.h3, .h3,
	.heading.h4, .h4,
	.heading.h5, .h5,
	.heading.h6, .h6 {
		font-size: var(--text-prose-h3);
		font-weight: 600;
		line-height: 28px;
	}
	.paragraph {
		margin: 0 0 var(--space-2) 0;
		line-height: inherit;
		color: var(--ink);
	}

	.paragraph:last-child {
		margin-bottom: 0;
	}

	.blockquote {
		margin: var(--space-2) 0;
		padding: var(--space-1) 0 var(--space-1) var(--space-3);
		border-left: 2px solid var(--line);
		color: var(--ink-muted);
	}

	.list {
		margin: 0 0 var(--space-2) 0;
		padding-left: var(--space-4);
		line-height: inherit;
	}

	.list:last-child {
		margin-bottom: 0;
	}

	.list-item {
		margin: var(--space-1) 0;
	}

	.list-item.task-item {
		list-style: none;
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-left: calc(-1 * var(--space-3));
	}

	.task-checkbox {
		margin: var(--space-1) 0 0 0;
		accent-color: var(--brand);
		cursor: default;
	}

	.item-content {
		flex: 1;
		min-width: 0;
	}


	.hr {
		border: none;
		border-top: 1px solid var(--line);
		margin: var(--space-3) 0;
	}

	.raw-html {
		margin: var(--space-1) 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-all;
		user-select: text;
	}

	.text-block,
	.generic-block {
		margin: 0 0 var(--space-1) 0;
		line-height: inherit;
	}
</style>
