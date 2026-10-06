<script lang="ts">
	// Miniature delle immagini nei blocchi `content`. Il clic apre il
	// visualizzatore esistente: nessun lightbox nuovo.
	import { agentUiHooks } from '../../ui-context';
	import { m } from '$lib/paraglide/messages.js';

	let { images } = $props<{ images: { data: string; mimeType: string }[] }>();

	const hooks = agentUiHooks();
</script>

{#if images.length > 0}
	<div class="strip">
		{#each images as image, index (index)}
			<button type="button" onclick={() => hooks.openImage(image.data, image.mimeType)} title={m.chat_v2_tool_image_open()}>
				<img src={`data:${image.mimeType};base64,${image.data}`} alt={m.chat_v2_tool_image_alt()} />
			</button>
		{/each}
	</div>
{/if}

<style>
	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	button {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: border-color var(--dur-fast) var(--ease-out);
		background: var(--bg-sunken);
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
	}

	button:hover {
		border-color: var(--line-strong);
	}

	img {
		display: block;
		max-width: 220px;
		max-height: 160px;
		object-fit: contain;
	}
</style>
