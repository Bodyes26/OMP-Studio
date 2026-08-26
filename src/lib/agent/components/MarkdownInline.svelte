<script lang="ts">
	// Rendering inline dei token di marked. Ricorsivo su se stesso.
	// L'HTML non e' mai interpretato: viene reso come testo grezzo.
	// I link web aprono il browser esterno via Tauri; se il link o codespan
	// e' un percorso di file valido del progetto, viene aperto nell'editor.
	import { openUrl } from '@tauri-apps/plugin-opener';
	import type { StreamFade, Token } from '../markdown';
	import { agentUiHooks } from '../ui-context';
	import MarkdownInline from './MarkdownInline.svelte';
	import StreamTail from './StreamTail.svelte';

	// `fade` non nullo significa "questo e' l'ultimo frammento del testo in
	// arrivo": scende solo lungo la catena degli ultimi figli.
	let { tokens = [], fade = null }: { tokens?: Token[]; fade?: StreamFade | null } = $props();

	const hooks = agentUiHooks();

	function handleLink(e: MouseEvent, href: string) {
		e.preventDefault();
		if (!href) return;
		if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
			openUrl(href).catch(() => {});
		} else {
			hooks.openFile(href, null);
		}
	}

	function handleCodespanClick(text: string) {
		if (!text) return;
		const trimmed = text.trim();
		// Se sembra un percorso o nome file (es. con estensione o slash), tenta la risoluzione nell'editor
		if (trimmed.includes('/') || trimmed.includes('\\') || /\.[a-zA-Z0-9_-]+(?::\d+)?$/.test(trimmed)) {
			hooks.openFile(trimmed, null);
		}
	}
</script>

{#each tokens as token, i}
	{@const tail = fade && i === tokens.length - 1 ? fade : null}
	{#if token.type === 'text'}
		{#if 'tokens' in token && token.tokens && token.tokens.length > 0}
			<MarkdownInline tokens={token.tokens} fade={tail} />
		{:else if tail}
			<StreamTail text={token.text} fade={tail} />
		{:else}
			{token.text}
		{/if}
	{:else if token.type === 'strong'}
		<strong><MarkdownInline tokens={token.tokens} fade={tail} /></strong>
	{:else if token.type === 'em'}
		<em><MarkdownInline tokens={token.tokens} fade={tail} /></em>
	{:else if token.type === 'del'}
		<del><MarkdownInline tokens={token.tokens} fade={tail} /></del>
	{:else if token.type === 'codespan'}
		{@const isFileLike = token.text.includes('/') || token.text.includes('\\') || /\.[a-zA-Z0-9_-]+(?::\d+)?$/.test(token.text.trim())}
		{#if isFileLike}
			<button
				type="button"
				class="codespan-btn"
				title={`Apri ${token.text} nell'editor`}
				onclick={() => handleCodespanClick(token.text)}
			>
				<code>{token.text}</code>
			</button>
		{:else}
			<code class="codespan">{token.text}</code>
		{/if}
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
		{#if tail}<StreamTail text={token.text} fade={tail} />{:else}{token.text}{/if}
	{:else if 'raw' in token && typeof token.raw === 'string'}
		{token.raw}
	{/if}
{/each}

<style>
	.codespan {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--bg-hover);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		user-select: text;
	}

	.codespan-btn {
		display: inline;
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}

	.codespan-btn code {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		background: var(--bg-hover);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		color: var(--ink);
		border-bottom: 1px solid transparent;
		transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.codespan-btn:hover code {
		color: var(--brand-ink);
		border-bottom-color: var(--brand);
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
