<!--
  AssistantText.svelte — Testo e blocchi emessi dall'assistente (thinking + markdown).
  Fedele a src/lib/agent/components/AssistantText.svelte di Studio.
-->
<script lang="ts">
	import type { RemoteChatMessage } from '../../../../src/protocol.ts';
	import { lexMarkdown } from '$lib/agent/markdown';
	import Markdown from '$lib/agent/components/Markdown.svelte';
	import ThinkingBlock from '$lib/agent/components/ThinkingBlock.svelte';

	let {
		message,
		streaming = false
	}: {
		message: RemoteChatMessage;
		streaming?: boolean;
	} = $props();

	const blocks = $derived(
		message.blocks && message.blocks.length > 0
			? message.blocks
			: [{ type: 'text' as const, text: message.text }]
	);
	const lastIndex = $derived(blocks.length - 1);
</script>

<div class="assistant-entry" class:streaming>
	<div class="blocks">
		{#each blocks as block, i (`${block.type}-${i}`)}
			{@const isLastBlock = i === lastIndex}
			<div class="assistant-block">
				{#if block.type === 'thinking'}
					<ThinkingBlock text={block.text} streaming={streaming && isLastBlock} />
				{:else if block.type === 'text'}
					<div class="markdown-wrap">
						<Markdown tokens={lexMarkdown(block.text)} />
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
		min-width: 0;
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
		font-size: var(--text-chat);
		line-height: 28px;
		color: var(--ink);
	}
</style>
