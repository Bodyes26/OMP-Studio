<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Visualizzatore a schermo intero per immagini prodotte dai tool o incollate.
	import { IconClose } from '$lib/icons';
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
		<button type="button" class="btn-close" onclick={onClose} aria-label={m.page_modal_restart_btn_close()}><IconClose /></button>
	</div>
</div>

<style>
	.image-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		backdrop-filter: blur(8px);
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
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 8px;
		box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	img {
		max-width: 85vw;
		max-height: 85vh;
		object-fit: contain;
		border-radius: var(--radius-md);
		display: block;
	}

	.btn-close {
		position: absolute;
		top: -12px;
		right: -12px;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		background: var(--bg-overlay);
		border: 1px solid var(--line);
		color: var(--ink);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		--icon-size: 14px;
		transition: background-color var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
	}

	.btn-close:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--brand-ink);
	}
</style>
