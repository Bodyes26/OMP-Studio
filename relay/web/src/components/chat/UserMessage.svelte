<!--
  UserMessage.svelte — Bolla del messaggio inviato dall'utente.
  Allineata a destra, sfondo --bg-raised, raggio --radius-2xl, max 80% larghezza.
  Fedele a src/lib/agent/components/UserMessage.svelte di Studio.
-->
<script lang="ts">
	import { t } from '../../i18n.ts';
	import type { RemoteChatMessage } from '../../../../src/protocol.ts';
	import { lexMarkdownInline } from '../../chat/markdown.ts';
	import MarkdownInline from './MarkdownInline.svelte';
	import { IconImage } from '../../icons.ts';

	let { message }: { message: RemoteChatMessage } = $props();

	const tokens = $derived(lexMarkdownInline(message.text));
	const imageCount = $derived(message.images ?? 0);
	const imageLabel = $derived(
		imageCount === 1
			? t('chatImageCountSingular')
			: t('chatImagesCount', { count: imageCount })
	);
</script>

<div class="user-message-container">
	{#if imageCount > 0}
		<div class="images-strip">
			<span class="image-chip" title={imageLabel}>
				<IconImage aria-hidden="true" />
				<span class="font-mono">{imageCount}</span>
			</span>
		</div>
	{/if}

	<div class="user-bubble rv-lift">
		<div class="content">
			<MarkdownInline {tokens} />
		</div>
	</div>
</div>

<style>
	.user-message-container {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: auto;
		max-width: 80%;
		gap: var(--space-1);
		min-width: 0;
	}

	.images-strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: flex-end;
	}

	.image-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		--icon-size: 13px;
	}

	.user-bubble {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-2xl) var(--radius-2xl) var(--radius-md) var(--radius-2xl);
		padding: 10px 14px;
		color: var(--ink);
		user-select: text;
		word-break: break-word;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: fit-content;
		min-width: 0;
		box-shadow: var(--shadow-dock);
	}

	.content {
		font-size: var(--text-chat);
		line-height: 24px;
		color: var(--ink);
	}
</style>
