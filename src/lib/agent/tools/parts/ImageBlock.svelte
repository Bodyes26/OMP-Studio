<script lang="ts">
	// Miniature delle immagini nei blocchi `content`. Il clic apre il
	// visualizzatore esistente: nessun lightbox nuovo.
	import { agentUiHooks } from '../../ui-context';

	let { images } = $props<{ images: { data: string; mimeType: string }[] }>();

	const hooks = agentUiHooks();
</script>

{#if images.length > 0}
	<div class="strip">
		{#each images as image, index (index)}
			<button type="button" onclick={() => hooks.openImage(image.data, image.mimeType)} title="Apri immagine">
				<img src={`data:${image.mimeType};base64,${image.data}`} alt="Immagine prodotta dal tool" />
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
		border-radius: var(--radius-sm);
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
