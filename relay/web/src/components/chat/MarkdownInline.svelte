<!--
  MarkdownInline.svelte — Rendering inline ricorsivo dei token di marked.
  L'HTML non e' mai interpretato: viene reso come testo.
  I link aprono una nuova scheda con target="_blank" e rel="noopener noreferrer".
-->
<script lang="ts">
	import type { Token } from 'marked';
	import MarkdownInline from './MarkdownInline.svelte';

	let { tokens = [] }: { tokens?: Token[] } = $props();
</script>

{#each tokens as token}
	{#if token.type === 'text'}
		{#if 'tokens' in token && token.tokens && token.tokens.length > 0}
			<MarkdownInline tokens={token.tokens} />
		{:else}
			{token.text}
		{/if}
	{:else if token.type === 'strong'}
		<strong><MarkdownInline tokens={token.tokens} /></strong>
	{:else if token.type === 'em'}
		<em><MarkdownInline tokens={token.tokens} /></em>
	{:else if token.type === 'del'}
		<del><MarkdownInline tokens={token.tokens} /></del>
	{:else if token.type === 'codespan'}
		<code class="codespan">{token.text}</code>
	{:else if token.type === 'link'}
		<a
			href={token.href}
			target="_blank"
			rel="noopener noreferrer"
			class="link"
			title={token.title ?? undefined}
		>
			<MarkdownInline tokens={token.tokens} />
		</a>
	{:else if token.type === 'image'}
		<img src={token.href} alt={token.text} title={token.title ?? undefined} class="inline-img" />
	{:else if token.type === 'br'}
		<br />
	{:else if token.type === 'escape'}
		{token.text}
	{:else if token.type === 'html' || token.type === 'tag'}
		{token.text}
	{:else if 'tokens' in token && token.tokens && token.tokens.length > 0}
		<MarkdownInline tokens={token.tokens} />
	{:else if 'text' in token && typeof token.text === 'string'}
		{token.text}
	{:else if 'raw' in token && typeof token.raw === 'string'}
		{token.raw}
	{/if}
{/each}

<style>
	.codespan {
		font-family: var(--font-mono);
		font-size: 0.9em;
		padding: 1px 5px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		word-break: break-word;
	}

	.link {
		color: var(--brand-ink);
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: opacity var(--dur-fast);
	}

	.link:hover {
		opacity: 0.85;
	}

	.inline-img {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-md);
	}
</style>
