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
	import type { Token, Tokens } from '$lib/agent/markdown';
	import MarkdownInline from '$lib/agent/components/MarkdownInline.svelte';
	import CompanionMarkdown from './CompanionMarkdown.svelte';

	let { tokens }: { tokens: Token[] } = $props();
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
		<pre class="cmd-code">{token.text}</pre>
	{:else if token.type === 'blockquote'}
		<blockquote class="cmd-quote">
			<CompanionMarkdown tokens={token.tokens ?? []} />
		</blockquote>
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
