<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Testo dell'assistente nel transcript (Gate R32 - C05).
	// Rivelazione per frasi (variante blur) con scheduler a 140ms,
	// ghost lines per testo in arrivo, lexing a 20fps con cache LRU.
	// Modalita' blur, stream e final secondo impostazioni;
	// resa statica (senza animazioni) per messaggi conclusi e storici.
	// Tipografia della prosa a 15px / 28px (DESIGN §7.14).
	import { onDestroy } from 'svelte';
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdown, lexMarkdownInline, type Token } from '../markdown';
	import type { AssistantEntry, Block } from '../session.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownInline from './MarkdownInline.svelte';
	import CodeBlock from './CodeBlock.svelte';
	import ThinkingBlock from './ThinkingBlock.svelte';
	import { RevealScheduler } from '../revealScheduler.svelte';

	let {
		entry,
		streaming = false
	}: {
		entry: AssistantEntry;
		streaming?: boolean;
	} = $props();

	const hooks = agentUiHooks();

	const lastBlockIndex = $derived(entry.blocks.length - 1);
	const lastBlock = $derived(entry.blocks[lastBlockIndex] as Block | undefined);
	const isStreamingLastText = $derived(
		streaming && lastBlock !== undefined && lastBlock.type === 'text'
	);
	const targetText = $derived(lastBlock?.type === 'text' ? lastBlock.text : '');

	// Lexing con limite di frequenza a ~20 fps (48ms) per evitare ricalcoli inutili
	const STREAM_PARSE_INTERVAL_MS = 48;
	let throttledText = $state('');
	let throttledTokens = $state<Token[] | null>(null);
	let lastParseTime = 0;
	let throttleTimer: number | null = null;

	const scheduler = new RevealScheduler();

	$effect(() => {
		if (!isStreamingLastText) {
			throttledText = targetText;
			throttledTokens = targetText ? lexMarkdown(targetText) : null;
			scheduler.update(`${entry.id}:${lastBlockIndex}`, targetText, false);
			return;
		}

		const now = performance.now();
		const elapsed = now - lastParseTime;

		if (elapsed >= STREAM_PARSE_INTERVAL_MS || !throttledTokens) {
			throttledText = targetText;
			throttledTokens = lexMarkdown(targetText);
			lastParseTime = now;
			scheduler.update(`${entry.id}:${lastBlockIndex}`, throttledText, true);
		} else {
			if (throttleTimer !== null) clearTimeout(throttleTimer);
			throttleTimer = window.setTimeout(() => {
				throttleTimer = null;
				throttledText = targetText;
				throttledTokens = lexMarkdown(targetText);
				lastParseTime = performance.now();
				scheduler.update(`${entry.id}:${lastBlockIndex}`, throttledText, isStreamingLastText);
			}, STREAM_PARSE_INTERVAL_MS - elapsed);
		}
	});

	onDestroy(() => {
		if (throttleTimer !== null) {
			clearTimeout(throttleTimer);
			throttleTimer = null;
		}
		scheduler.dispose();
	});

	const showGhost = $derived(
		isStreamingLastText
			&& scheduler.effectiveMode === 'blur'
			&& !scheduler.settled
			&& (scheduler.ghostLines.length > 0)
	);
</script>

<div class="assistant-entry" class:streaming>
	<div class="blocks">
		{#each entry.blocks as block, i (`${block.type}-${i}`)}
			{@const isLastBlock = i === lastBlockIndex}
			<div class="assistant-block">
				{#if block.type === 'text'}
					{#if isStreamingLastText && isLastBlock && !scheduler.settled}
						{#if scheduler.effectiveMode === 'final'}
							<div class="writing-label">{m.chat_v2_reveal_writing()}</div>
						{:else if scheduler.effectiveMode === 'stream'}
							<div class="markdown-wrap">
								<Markdown tokens={throttledTokens || lexMarkdown(block.text)} />
							</div>
						{:else if scheduler.parsed}
							<div class="markdown-wrap">
								{#each scheduler.parsed.blocks as b, bi (bi)}
									{#if b.kind === 'code'}
										{#if b.units[0].index < scheduler.revealedCount}
											<div class="rv-lift">
												<CodeBlock lang={b.lang} text={b.units[0].text} />
											</div>
										{/if}
									{:else if b.kind === 'table' || b.kind === 'blockquote'}
										{#if b.units[0].index < scheduler.revealedCount}
											<div class="rv-lift">
												<Markdown tokens={lexMarkdown(b.units[0].text)} />
											</div>
										{/if}
									{:else if b.kind === 'h'}
										{@const vis = b.units.filter((u) => u.index < scheduler.revealedCount)}
										{#if vis.length > 0}
											<svelte:element this={'h' + (b.depth || 3)} class="heading h{b.depth || 3}">
												{#each vis as u, ui (u.index)}
													{#if ui > 0}{' '}{/if}
													<span class="rv-blur"><MarkdownInline tokens={lexMarkdownInline(u.text)} /></span>
												{/each}
											</svelte:element>
										{/if}
									{:else if b.kind === 'li'}
										{@const vis = b.units.filter((u) => u.index < scheduler.revealedCount)}
										{#if vis.length > 0}
											<div class="reveal-li">
												<span class="reveal-bullet rv-blur"></span>
												<div class="reveal-li-content">
													{#each vis as u, ui (u.index)}
														{#if ui > 0}{' '}{/if}
														<span class="rv-blur"><MarkdownInline tokens={lexMarkdownInline(u.text)} /></span>
													{/each}
												</div>
											</div>
										{/if}
									{:else if b.kind === 'oli'}
										{@const vis = b.units.filter((u) => u.index < scheduler.revealedCount)}
										{#if vis.length > 0}
											<div class="reveal-oli">
												<span class="reveal-num rv-blur">{b.num}.</span>
												<div class="reveal-oli-content">
													{#each vis as u, ui (u.index)}
														{#if ui > 0}{' '}{/if}
														<span class="rv-blur"><MarkdownInline tokens={lexMarkdownInline(u.text)} /></span>
													{/each}
												</div>
											</div>
										{/if}
									{:else}
										{@const vis = b.units.filter((u) => u.index < scheduler.revealedCount)}
										{#if vis.length > 0}
											<p class="paragraph">
												{#each vis as u, ui (u.index)}
													{#if ui > 0}{' '}{/if}
													<span class="rv-blur"><MarkdownInline tokens={lexMarkdownInline(u.text)} /></span>
												{/each}
											</p>
										{/if}
									{/if}
								{/each}

								{#if showGhost}
									<div class="ghost-wrap" aria-hidden="true">
										{#each scheduler.ghostLines as line, li (li)}
											<div class="ghost-line" style="width: {line.width}%;"></div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					{:else}
						<div class="markdown-wrap">
							<Markdown tokens={lexMarkdown(block.text)} />
						</div>
					{/if}
				{:else if block.type === 'thinking'}
					<ThinkingBlock
						text={block.text}
						streaming={streaming && isLastBlock}
					/>
				{:else if block.type === 'image'}
					<div class="image-wrap">
						<button
							type="button"
							class="image-btn"
							onclick={() => hooks.openImage(block.data, block.mimeType)}
							title={m.ui_assistanttext_apri_immagine_f45c()}
						>
							<img
								src={`data:${block.mimeType};base64,${block.data}`}
								alt="Immagine generata dall'assistente"
							/>
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.assistant-entry {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		position: relative;
	}

	.blocks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.assistant-block {
		min-width: 0;
	}

	.markdown-wrap {
		min-width: 0;
		font-size: var(--text-prose);
		line-height: 28px;
		color: var(--ink);
	}

	.paragraph {
		margin: var(--space-2) 0;
	}

	.paragraph:first-child {
		margin-top: 0;
	}

	.paragraph:last-child {
		margin-bottom: 0;
	}

	.heading {
		color: var(--ink);
		margin: var(--space-3) 0 var(--space-1) 0;
	}

	.heading:first-child {
		margin-top: 0;
	}

	.heading.h1 { font-size: var(--text-prose-h1); font-weight: 600; line-height: 1.3; }
	.heading.h2 { font-size: var(--text-prose-h2); font-weight: 600; line-height: 1.35; }
	.heading.h3,
	.heading.h4,
	.heading.h5,
	.heading.h6 { font-size: var(--text-prose-h3); font-weight: 600; line-height: 28px; }
	.reveal-li,
	.reveal-oli {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin: var(--space-1) 0;
	}

	.reveal-bullet {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
		align-self: center;
	}

	.reveal-num {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--ink-faint);
		flex-shrink: 0;
		text-align: right;
		min-width: 1.5rem;
	}

	.reveal-li-content,
	.reveal-oli-content {
		flex: 1;
		min-width: 0;
	}

	.ghost-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.writing-label {
		color: var(--ink-muted);
		font-size: var(--text-prose);
		line-height: 28px;
		user-select: none;
	}

	.image-wrap {
		display: flex;
		margin: var(--space-1) 0;
	}

	.image-btn {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
	}

	.image-btn:hover {
		border-color: var(--line-strong);
	}

	.image-btn img {
		display: block;
		max-width: 240px;
		max-height: 180px;
		object-fit: contain;
	}
</style>
