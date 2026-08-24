<script lang="ts">
	// Messaggio dell'utente nel transcript.
	// Allineato a sinistra: nessuna bolla di chat, nessun avatar.
	// Usa MarkdownInline per rendere percorsi e frammenti di codice leggibili.
	import { agentUiHooks } from '../ui-context';
	import { lexMarkdownInline } from '../markdown';
	import type { UserEntry } from '../session.svelte';
	import MarkdownInline from './MarkdownInline.svelte';

	let { entry }: { entry: UserEntry } = $props();

	const hooks = agentUiHooks();
	const isNonStandardAttribution = $derived(
		Boolean(entry.attribution && entry.attribution !== 'user')
	);
	const inlineTokens = $derived(entry.content ? lexMarkdownInline(entry.content) : []);
</script>

<div class="user-message">
	{#if isNonStandardAttribution}
		<div class="attribution-row">
			<span class="attribution-badge">{entry.attribution}</span>
		</div>
	{/if}

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
		gap: var(--space-1);
		min-width: 0;
		align-items: flex-start;
		text-align: left;
	}

	.attribution-row {
		display: flex;
		align-items: center;
	}

	.attribution-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		background: var(--bg-hover);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		text-transform: lowercase;
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
