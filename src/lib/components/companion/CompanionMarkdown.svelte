<script lang="ts">
	// Markdown della finestra companion: struttura a blocchi, niente Monaco.
	//
	// La chat principale rende i blocchi di codice con `CodeBlock`, che importa
	// Monaco per colorarli (~4 MB). La companion e' una **seconda webview**:
	// quello che carica qui e' memoria in piu', non condivisa. I blocchi di
	// codice restano percio' testo a spaziatura fissa, non colorato.
	//
	// L'inline (grassetto, corsivo, `code`, link) lo rende `MarkdownInline`
	// della chat: e' lo stesso vocabolario visivo e i suoi ganci hanno
	// ripieghi innocui fuori dal transcript (`agentUiHooks`).
	import type { Token, Tokens } from '#lib/agent/markdown.ts';
	import MarkdownInline from '#lib/agent/components/MarkdownInline.svelte';
	import SmartTable from '#lib/agent/intelligent-ui/SmartTable.svelte';
	import CalloutCard from '#lib/agent/intelligent-ui/CalloutCard.svelte';
	import MetricGrid from '#lib/agent/intelligent-ui/MetricGrid.svelte';
	import InteractiveTabs from '#lib/agent/intelligent-ui/InteractiveTabs.svelte';
	import AccordionCard from '#lib/agent/intelligent-ui/AccordionCard.svelte';
	import ProcessStepper from '#lib/agent/intelligent-ui/ProcessStepper.svelte';
	import CompareSlider from '#lib/agent/intelligent-ui/CompareSlider.svelte';
	import {
		parseCallout,
		parseMetricBlock,
		parseTabsBlock,
		parseStepsBlock,
		parseCompareBlock,
		parseAccordionBlock
	} from '#lib/agent/intelligent-ui/parsers.ts';
	import CompanionMarkdown from './CompanionMarkdown.svelte';

	let {
		tokens = [],
		onOpenFile
	}: {
		tokens?: Token[];
		onOpenFile?: (path: string) => void;
	} = $props();
</script>
{#each tokens as token, idx (idx)}
	{#if token.type === 'heading'}
		<p class="cmd-heading">
			<MarkdownInline tokens={token.tokens ?? []} />
		</p>
	{:else if token.type === 'paragraph'}
		<p class="cmd-paragraph">
			<MarkdownInline tokens={token.tokens ?? []} />
		</p>
	{:else if token.type === 'code'}
		{@const lang = (token.lang || '').trim().toLowerCase()}
		{#if lang === 'ui:metric' || lang === 'ui:stat'}
			{@const metrics = parseMetricBlock(token.text)}
			{#if metrics}
				<MetricGrid items={metrics} />
			{:else}
				<pre class="cmd-code">{token.text}</pre>
			{/if}
		{:else if lang === 'ui:tabs'}
			{@const tabs = parseTabsBlock(token.text)}
			{#if tabs}
				<InteractiveTabs {tabs} {onOpenFile} />
			{:else}
				<pre class="cmd-code">{token.text}</pre>
			{/if}
		{:else if lang === 'ui:steps'}
			{@const steps = parseStepsBlock(token.text)}
			{#if steps}
				<ProcessStepper {steps} />
			{:else}
				<pre class="cmd-code">{token.text}</pre>
			{/if}
		{:else if lang === 'ui:compare'}
			{@const comp = parseCompareBlock(token.text)}
			{#if comp}
				<CompareSlider {...comp} />
			{:else}
				<pre class="cmd-code">{token.text}</pre>
			{/if}
		{:else if lang === 'ui:accordion'}
			{@const acc = parseAccordionBlock(token.text)}
			{#if acc}
				<AccordionCard title={acc.title} badge={acc.badge}>
					<p class="cmd-paragraph">{acc.content}</p>
				</AccordionCard>
			{:else}
				<pre class="cmd-code">{token.text}</pre>
			{/if}
		{:else}
			<pre class="cmd-code">{token.text}</pre>
		{/if}
	{:else if token.type === 'blockquote'}
		{@const callout = parseCallout(token)}
		{#if callout}
			<CalloutCard kind={callout.kind} title={callout.title}>
				<CompanionMarkdown tokens={callout.bodyTokens} {onOpenFile} />
			</CalloutCard>
		{:else}
			<blockquote class="cmd-quote">
				<CompanionMarkdown tokens={token.tokens ?? []} {onOpenFile} />
			</blockquote>
		{/if}
	{:else if token.type === 'list'}
		{@const list = token as Tokens.List}
		{#if list.ordered}
			<ol class="cmd-list" start={typeof list.start === 'number' ? list.start : 1}>
				{#each list.items as item, itemIdx (itemIdx)}
					<li><CompanionMarkdown tokens={item.tokens ?? []} /></li>
				{/each}
			</ol>
		{:else}
			<ul class="cmd-list">
				{#each list.items as item, itemIdx (itemIdx)}
					<li><CompanionMarkdown tokens={item.tokens ?? []} /></li>
				{/each}
			</ul>
		{/if}
	{:else if token.type === 'table'}
		{@const table = token as Tokens.Table}
		<SmartTable header={table.header} rows={table.rows} {onOpenFile} />
	{:else if token.type === 'hr'}
		<hr class="cmd-rule" />
	{:else if token.type === 'space'}
		<!-- Le righe vuote le rende il margine dei blocchi. -->
	{:else if 'tokens' in token && token.tokens && token.tokens.length > 0}
		<p class="cmd-paragraph"><MarkdownInline tokens={token.tokens} /></p>
	{:else if 'text' in token && typeof token.text === 'string'}
		<p class="cmd-paragraph">{token.text}</p>
	{/if}
{/each}
