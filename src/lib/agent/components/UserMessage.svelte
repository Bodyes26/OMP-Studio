<script lang="ts">
	// Messaggio dell'utente nel transcript.
	// Evidenziato come blocco utente con indicatore 'Tu' / badge di attribuzione,
	// superficie `--bg-raised`, bordo discreto e MarkdownInline.
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdownInline } from '../markdown';
	import type { UserEntry } from '../session.svelte';
	import MarkdownInline from './MarkdownInline.svelte';

	let { entry }: { entry: UserEntry } = $props();

	const hooks = agentUiHooks();
	const isNonStandardAttribution = $derived(
		Boolean(entry.attribution && entry.attribution !== 'user')
	);
	const attributionLabel = $derived(
		isNonStandardAttribution ? entry.attribution : 'Tu'
	);
	const inlineTokens = $derived(entry.content ? lexMarkdownInline(entry.content) : []);
</script>

<div class="user-message">
	<div class="user-header">
		<span class="user-badge" class:custom-badge={isNonStandardAttribution}>
			<span class="user-glyph" aria-hidden="true">›</span>
			<span class="user-label">{attributionLabel}</span>
		</span>
	</div>

	{#if entry.images && entry.images.length > 0}
		<div class="images-strip">
			{#each entry.images as img, i (i)}
				<button
					type="button"
					class="image-chip"
					onclick={() => hooks.openImage(img.data, img.mimeType)}
					title="Apri immagine allegata"
				>
					<img src={`data:${img.mimeType};base64,${img.data}`} alt="Allegato utente" />
				</button>
			{/each}
		</div>
	{/if}

	{#if entry.content}
		<div class="content">
			<MarkdownInline tokens={inlineTokens} />
		</div>
	{/if}
</div>

<style>
	.user-message {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		width: 100%;
		align-items: flex-start;
		text-align: left;
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-left: 2px solid var(--ink-faint);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.user-message:hover {
		border-color: var(--line-strong);
		border-left-color: var(--ink-muted);
	}

	.user-header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		user-select: none;
	}

	.user-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-hover);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		line-height: 1.3;
	}

	.user-badge.custom-badge {
		color: var(--ink-faint);
		text-transform: lowercase;
	}

	.user-glyph {
		color: var(--brand-ink);
		font-weight: 600;
		font-size: 11px;
		line-height: 1;
	}

	.user-label {
		font-weight: 500;
	}
	.images-strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}

	.image-chip {
		width: 48px;
		height: 48px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		flex-shrink: 0;
	}

	.image-chip:hover {
		border-color: var(--line-strong);
	}

	.image-chip img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.content {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		line-height: 1.5;
		color: var(--ink);
		white-space: pre-wrap;
		word-break: break-word;
		user-select: text;
	}
</style>
