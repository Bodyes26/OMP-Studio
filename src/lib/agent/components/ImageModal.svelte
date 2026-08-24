<script lang="ts">
	// Visualizzatore a schermo intero per immagini prodotte dai tool o incollate.
	let {
		data,
		mimeType = 'image/png',
		onClose
	} = $props<{
		data: string;
		mimeType?: string;
		onClose: () => void;
	}>();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="image-backdrop" onclick={onClose}>
	<div class="image-container" onclick={(e) => e.stopPropagation()}>
		<img src={`data:${mimeType};base64,${data}`} alt="Anteprima immagine" />
		<button type="button" class="btn-close" onclick={onClose} aria-label="Chiudi">×</button>
	</div>
</div>

<style>
	.image-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-dialog);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.image-container {
		position: relative;
		max-width: 90vw;
		max-height: 90vh;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-2);
		box-shadow: var(--shadow-overlay);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	img {
		max-width: 85vw;
		max-height: 85vh;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}

	.btn-close {
		position: absolute;
		top: -12px;
		right: -12px;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		color: var(--ink);
		font-size: var(--text-md);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-overlay);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--brand-ink);
	}
</style>
