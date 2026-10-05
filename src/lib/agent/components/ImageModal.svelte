<script lang="ts">
	/**
	 * ImageModal — Visualizzatore modale per immagini (Design v2).
	 * Usa la primitiva Dialog accessibile con testata, rvLift e top-layer nativo.
	 */
	import Dialog from '$lib/ui/Dialog.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		data,
		mimeType = 'image/png',
		fileName,
		onClose
	} = $props<{
		data: string;
		mimeType?: string;
		fileName?: string;
		onClose: () => void;
	}>();

	const title = $derived(fileName || m.image_modal_title());
	const ariaLabel = $derived(m.image_modal_preview_aria());
</script>

<Dialog
	open={true}
	{title}
	{onClose}
	ariaLabel={title}
	class="image-dialog"
	flush
>
	<div class="image-stage">
		<img
			src={`data:${mimeType};base64,${data}`}
			alt={ariaLabel}
			class="image-content"
		/>
	</div>
</Dialog>

<style>
	/* La finestra segue l'immagine: una miniatura non apre un riquadro da 1080 px. */
	:global(.dialog-surface.image-dialog) {
		width: fit-content;
		min-width: 320px;
		max-width: min(1080px, 96vw);
	}

	.image-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: var(--bg-sunken);
		border-radius: var(--radius-md);
		margin: var(--space-4);
	}

	.image-content {
		max-width: 100%;
		max-height: calc(86vh - 120px);
		object-fit: contain;
		border-radius: var(--radius-md);
		display: block;
	}
</style>
