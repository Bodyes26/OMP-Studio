<script lang="ts">
	// Rendering inline dei token di marked. Ricorsivo su se stesso.
	// L'HTML non e' mai interpretato: viene reso come testo grezzo.
	// I link aprono il browser esterno via Tauri, mai navigazione interna.
	import { openUrl } from '@tauri-apps/plugin-opener';
	import type { Token } from '../markdown';
	import MarkdownInline from './MarkdownInline.svelte';

	let { tokens = [] }: { tokens?: Token[] } = $props();

	function handleLink(e: MouseEvent, href: string) {
		e.preventDefault();
		if (!href) return;
		openUrl(href).catch(() => {});
	}
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
			title={token.title ?? undefined}
			onclick={(e) => handleLink(e, token.href)}
			class="link"
		>
			{#if token.tokens && token.tokens.length > 0}
				<MarkdownInline tokens={token.tokens} />
			{:else}
				{token.text}
			{/if}
		</a>
	{:else if token.type === 'image'}
		<img src={token.href} alt={token.text} title={token.title ?? undefined} class="inline-img" />
	{:else if token.type === 'br'}
		<br />
	{:else if token.type === 'escape'}
		{token.text}
	{:else if token.type === 'html' || token.type === 'tag'}
		{token.text}
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
		background: var(--bg-hover);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		user-select: text;
	}

	.link {
		color: var(--brand-ink);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.link:hover {
		color: var(--ink);
	}

	.inline-img {
		max-width: 100%;
		vertical-align: middle;
		border-radius: var(--radius-sm);
	}
</style>
