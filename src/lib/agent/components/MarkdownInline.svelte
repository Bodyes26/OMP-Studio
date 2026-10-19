<script lang="ts">
	// Rendering inline dei token di marked. Ricorsivo su se stesso.
	// L'HTML non e' mai interpretato: viene reso come testo grezzo.
	// I link web aprono il browser esterno via Tauri; se il link o codespan
	// e' un percorso di file valido del progetto, viene aperto nell'editor.
	import { isAllowedExternalUrl } from '$lib/utils/externalUrl';
	import { openExternalUrl } from '$lib/utils/openExternal';
	import type { Token } from '../markdown';
	import { agentUiHooks, hasAgentUiHooks } from '../ui-context';
	import MarkdownInline from './MarkdownInline.svelte';
	import FileMentionChip from './FileMentionChip.svelte';

	// `fade` non nullo significa "questo e' l'ultimo frammento del testo in
	// arrivo": scende solo lungo la catena degli ultimi figli.
	// `onOpenFile` sostituisce i ganci dell'agente fuori dal transcript
	// (anteprime dei task); nel transcript resta vuoto.
	let {
		tokens = [],
		onOpenFile
	}: { tokens?: Token[]; onOpenFile?: (path: string) => void } = $props();

	const hooks = agentUiHooks();
	const hasFileActions = hasAgentUiHooks();

	// Gli agenti scrivono i link markdown con il percorso codificato come URL
	// (`%5B` per `[`, `%20` per lo spazio): il file su disco ha il nome in chiaro.
	function decodeFileHref(href: string): string {
		try {
			return decodeURIComponent(href);
		} catch {
			return href;
		}
	}

	function handleLink(e: MouseEvent, href: string) {
		e.preventDefault();
		if (!href) return;
		if (isAllowedExternalUrl(href)) {
			void openExternalUrl(href);
			return;
		}
		const path = decodeFileHref(href);
		if (onOpenFile) {
			onOpenFile(path);
		} else {
			hooks.openFile(path, null);
		}
	}

	function handleCodespanClick(text: string) {
		if (!text) return;
		const trimmed = text.trim();
		// Se sembra un percorso o nome file (es. con estensione o slash), tenta la risoluzione nell'editor
		if (trimmed.includes('/') || trimmed.includes('\\') || /\.[a-zA-Z0-9_-]+(?::\d+)?$/.test(trimmed)) {
			if (onOpenFile) {
				onOpenFile(trimmed);
			} else {
				hooks.openFile(trimmed, null);
			}
		}
	}
</script>

{#each tokens as token}
	{#if token.type === 'text'}
		{#if 'tokens' in token && token.tokens && token.tokens.length > 0}
			<MarkdownInline tokens={token.tokens} {onOpenFile} />
		{:else}
			{token.text}
		{/if}
	{:else if token.type === 'strong'}
		<strong><MarkdownInline tokens={token.tokens} {onOpenFile} /></strong>
	{:else if token.type === 'em'}
		<em><MarkdownInline tokens={token.tokens} {onOpenFile} /></em>
	{:else if token.type === 'del'}
		<del><MarkdownInline tokens={token.tokens} {onOpenFile} /></del>
	{:else if token.type === 'fileMention'}
		{#if onOpenFile || hasFileActions}
			<FileMentionChip path={token.path} onOpen={onOpenFile} />
		{:else}
			<code class="codespan">{token.path}</code>
		{/if}
	{:else if token.type === 'commandMention'}
		<span class="chat-badge chat-badge--cmd">/{token.name}</span>
	{:else if token.type === 'codespan'}
		{@const isFileLike = token.text.includes('/') || token.text.includes('\\') || /\.[a-zA-Z0-9_-]+(?::\d+)?$/.test(token.text.trim())}
		{#if isFileLike && (onOpenFile || hasFileActions)}
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
		{#if isAllowedExternalUrl(token.href) || onOpenFile || hasFileActions}
		<a
			href={token.href}
			title={token.title ?? undefined}
			onclick={(e) => handleLink(e, token.href)}
			class="link"
		>
			{#if token.tokens && token.tokens.length > 0}
				<MarkdownInline tokens={token.tokens} {onOpenFile} />
			{:else}
				{token.text}
			{/if}
		</a>
		{:else}
			{token.text}
		{/if}
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
