<script lang="ts">
	// Rendering a blocchi dell'albero di token di marked.
	// L'HTML non e' mai interpretato: viene reso come testo grezzo in <pre>.
	// L'unico {@html} ammesso in tutto il progetto e' il risultato di
	// `colorizeCode`, che produce markup generato da Monaco.
	import type { StreamFade, Token } from '../markdown';
	import CodeBlock from './CodeBlock.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownInline from './MarkdownInline.svelte';
	import StreamTail from './StreamTail.svelte';

	// `fade` non nullo significa "l'ultimo blocco e' la coda del testo in
	// arrivo": scende solo lungo la catena degli ultimi figli.
	let { tokens = [], fade = null }: { tokens?: Token[]; fade?: StreamFade | null } = $props();
</script>

{#each tokens as token, i (i)}
	{@const tail = fade && i === tokens.length - 1 ? fade : null}
	{#if token.type === 'heading'}
		{#if token.depth === 1}
			<h1 class="heading h1"><MarkdownInline tokens={token.tokens} fade={tail} /></h1>
		{:else if token.depth === 2}
			<h2 class="heading h2"><MarkdownInline tokens={token.tokens} fade={tail} /></h2>
		{:else if token.depth === 3}
			<h3 class="heading h3"><MarkdownInline tokens={token.tokens} fade={tail} /></h3>
		{:else if token.depth === 4}
			<h4 class="heading h4"><MarkdownInline tokens={token.tokens} fade={tail} /></h4>
		{:else if token.depth === 5}
			<h5 class="heading h5"><MarkdownInline tokens={token.tokens} fade={tail} /></h5>
		{:else}
			<h6 class="heading h6"><MarkdownInline tokens={token.tokens} fade={tail} /></h6>
		{/if}
	{:else if token.type === 'paragraph'}
		<p class="paragraph"><MarkdownInline tokens={token.tokens} fade={tail} /></p>
	{:else if token.type === 'code'}
		<CodeBlock lang={token.lang} text={token.text} fade={tail} />
	{:else if token.type === 'blockquote'}
		<blockquote class="blockquote">
			<Markdown tokens={token.tokens} fade={tail} />
		</blockquote>
	{:else if token.type === 'list'}
		{#if token.ordered}
			<ol start={typeof token.start === 'number' ? token.start : 1} class="list ordered">
				{#each token.items as item, itemIdx (itemIdx)}
					<li class="list-item" class:task-item={item.task}>
						{#if item.task}
							<input type="checkbox" checked={item.checked} disabled class="task-checkbox" />
						{/if}
						<div class="item-content">
							<Markdown tokens={item.tokens} fade={itemIdx === token.items.length - 1 ? tail : null} />
						</div>
					</li>
				{/each}
			</ol>
		{:else}
			<ul class="list unordered">
				{#each token.items as item, itemIdx (itemIdx)}
					<li class="list-item" class:task-item={item.task}>
						{#if item.task}
							<input type="checkbox" checked={item.checked} disabled class="task-checkbox" />
						{/if}
						<div class="item-content">
							<Markdown tokens={item.tokens} fade={itemIdx === token.items.length - 1 ? tail : null} />
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if token.type === 'table'}
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						{#each token.header as cell, ci (ci)}
							<th style={cell.align ? `text-align: ${cell.align}` : undefined}>
								<MarkdownInline tokens={cell.tokens} />
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each token.rows as row, ri (ri)}
						<tr>
							{#each row as cell, ci (ci)}
								<td style={cell.align ? `text-align: ${cell.align}` : undefined}>
									<MarkdownInline tokens={cell.tokens} />
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if token.type === 'hr'}
		<hr class="hr" />
	{:else if token.type === 'html'}
		<pre class="raw-html">{token.text}</pre>
	{:else if token.type === 'space'}
		<!-- Spazio vuoto ignorato -->
	{:else if token.type === 'text'}
		<div class="text-block">
			{#if 'tokens' in token && token.tokens && token.tokens.length > 0}
				<MarkdownInline tokens={token.tokens} fade={tail} />
			{:else if tail}
				<StreamTail text={token.text} fade={tail} />
			{:else}
				{token.text}
			{/if}
		</div>
	{:else if 'tokens' in token && token.tokens}
		<div class="generic-block">
			<MarkdownInline tokens={token.tokens} fade={tail} />
		</div>
	{:else if 'text' in token && typeof token.text === 'string'}
		<p class="paragraph">{#if tail}<StreamTail text={token.text} fade={tail} />{:else}{token.text}{/if}</p>
	{/if}
{/each}

<style>
	.heading {
		color: var(--ink);
		line-height: 1.3;
		margin: var(--space-3) 0 var(--space-1) 0;
	}

	.heading:first-child {
		margin-top: 0;
	}

	.h1 {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.h2 {
		font-size: var(--text-md);
		font-weight: 600;
	}

	.h3 {
		font-size: var(--text-base);
		font-weight: 600;
	}

	.h4 {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.h5 {
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.h6 {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink-muted);
	}

	.paragraph {
		margin: 0 0 var(--space-2) 0;
		line-height: 1.5;
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
		line-height: 1.5;
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
		margin: 3px 0 0 0;
		accent-color: var(--brand);
		cursor: default;
	}

	.item-content {
		flex: 1;
		min-width: 0;
	}


	.table-wrap {
		overflow-x: auto;
		margin: var(--space-2) 0;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
		line-height: 1.4;
	}

	.table th {
		text-align: left;
		padding: var(--space-1) var(--space-2);
		color: var(--ink-faint);
		font-weight: 500;
		border-bottom: 1px solid var(--line-strong);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	.table td {
		padding: var(--space-1) var(--space-2);
		color: var(--ink);
		border-bottom: 1px solid var(--line);
	}

	.table tr:hover td {
		background: var(--bg-hover);
	}

	.hr {
		border: none;
		border-top: 1px solid var(--line);
		margin: var(--space-3) 0;
	}

	.raw-html {
		margin: var(--space-1) 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-all;
		user-select: text;
	}

	.text-block,
	.generic-block {
		margin: 0 0 var(--space-1) 0;
		line-height: 1.5;
	}
</style>
