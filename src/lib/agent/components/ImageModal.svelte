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

	// Blocca lo scorrimento del documento mentre la modale e' aperta.
	$effect(() => {
		const originalOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = originalOverflow;
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="image-backdrop"
	role="dialog"
	aria-modal="true"
	aria-label="Anteprima immagine"
	tabindex="-1"
	onclick={onClose}
>
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
