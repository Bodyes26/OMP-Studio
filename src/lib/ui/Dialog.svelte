<!--
  Dialog.svelte — Finestra modale accessibile e isolata (Design v2).

  Caratteristiche:
  - Isolamento modale APG con trapFocus e ripristino del fuoco
  - Ingresso e uscita tramite rvLift(duration=240) senza conflitti di centratura (positioner separato)
  - Superficie fluida con token --bg-overlay, --line-strong, --radius-lg, --shadow-overlay
  - Titolo bilanciato (--text-title, 550, text-wrap: balance)
  - Chiusura controllata via Escape, click su backdrop o pulsante di chiusura
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { trapFocus, type FocusTrapOptions } from '$lib/focusTrap';
	import { rvLift } from '$lib/agent/motion';
	import { IconClose } from '$lib/icons';
	import { m } from '$lib/paraglide/messages.js';

	export interface DialogProps {
		open?: boolean;
		title?: string;
		onClose?: () => void;
		dismissible?: boolean;
		initialFocus?: string | HTMLElement;
		ariaLabel?: string;
		ariaLabelledBy?: string;
		ariaDescribedBy?: string;
		children?: Snippet;
		header?: Snippet;
		body?: Snippet;
		footer?: Snippet;
		icon?: Snippet;
		/** Azioni nella testata predefinita, prima della chiusura. */
		actions?: Snippet;
		/** Strati dentro il `<dialog>` ma fuori dalla superficie: restano nel top layer
		 *  senza ereditare overflow e trasformazioni della superficie. */
		outside?: Snippet;
		/** `wide`: finestre di lavoro (impostazioni), 1080 px x 86vh.
		 *  `full`: revisioni che vivono di spazio (diff della corsia), viewport meno 32 px per lato. */
		size?: 'default' | 'wide' | 'full';
		/** Corpo senza padding ne' limite di altezza: il layout interno lo decide il consumatore. */
		flush?: boolean;
		class?: string;
	}

	let {
		open = false,
		title,
		onClose,
		dismissible = true,
		initialFocus,
		ariaLabel,
		ariaLabelledBy,
		ariaDescribedBy,
		children,
		header,
		body,
		footer,
		icon,
		actions,
		outside,
		size = 'default',
		flush = false,
		class: customClass = ''
	}: DialogProps = $props();

	const titleId = $props.id();

	function handleDismiss() {
		if (dismissible && onClose) {
			onClose();
		}
	}

	function modalDialog(node: HTMLDialogElement, options: FocusTrapOptions) {
		// Il browser isola sfondo e dialoghi annidati senza un host o uno stack di inert.
		const focus = trapFocus(node, options);
		node.showModal();
		return {
			update: focus.update,
			destroy() {
				node.close();
				focus.destroy();
			}
		};
	}
</script>

{#if open}
	<dialog
		class="dialog-scaffold"
		aria-label={ariaLabel}
		aria-labelledby={ariaLabelledBy ?? (title && !header ? titleId : undefined)}
		aria-describedby={ariaDescribedBy}
		use:modalDialog={{ onEscape: handleDismiss, initialFocus, restoreFocus: true }}
		oncancel={(event) => { event.preventDefault(); handleDismiss(); }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="dialog-backdrop"
			onclick={handleDismiss}
		></div>

		<div class="dialog-positioner">
			<div
				class={['dialog-surface', size === 'wide' && 'dialog-wide', size === 'full' && 'dialog-full', customClass].filter(Boolean).join(' ')}
				transition:rvLift={{ duration: 240 }}
			>
				{#if header}
					{@render header()}
				{:else if title}
					<header class="dialog-header">
						{#if icon}
							<div class="dialog-icon">
								{@render icon()}
							</div>
						{/if}
						<h2 id={titleId} class="dialog-title">{title}</h2>
						{#if actions}
							<div class="dialog-actions">
								{@render actions()}
							</div>
						{/if}
						{#if dismissible && onClose}
							<button
								type="button"
								class="dialog-close-btn"
								onclick={handleDismiss}
								aria-label={m.common_close()}
							>
								<IconClose />
							</button>
						{/if}
					</header>
				{/if}

				{#if body}
					<div class="dialog-body" class:flush>
						{@render body()}
					</div>
				{:else if children}
					<div class="dialog-body" class:flush>
						{@render children()}
					</div>
				{/if}

				{#if footer}
					<footer class="dialog-footer">
						{@render footer()}
					</footer>
				{/if}
			</div>
		</div>
		{#if outside}
			{@render outside()}
		{/if}
	</dialog>
{/if}

<style>
	.dialog-scaffold {
		position: fixed;
		inset: 0;
		z-index: var(--z-dialog);
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--ink);
		pointer-events: auto;
	}

	.dialog-scaffold::backdrop {
		background: transparent;
	}

	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
	}

	.dialog-positioner {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: var(--space-4, 16px);
		pointer-events: none;
	}

	.dialog-surface {
		pointer-events: auto;
		width: 100%;
		max-width: 520px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dialog-surface.dialog-wide {
		max-width: min(1080px, 96vw);
		height: min(86vh, 760px);
	}

	.dialog-surface.dialog-full {
		max-width: none;
		width: calc(100vw - 64px);
		height: calc(100vh - 64px);
	}

	.dialog-header {
		display: flex;
		align-items: center;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px) var(--space-4, 16px) var(--space-3, 12px);
		border-bottom: 1px solid var(--line);
	}

	.dialog-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--ink-muted);
	}

	.dialog-title {
		margin: 0;
		flex: 1;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: var(--text-title);
		font-weight: 550;
		line-height: 1.3;
		text-wrap: balance;
		color: var(--ink);
	}

	.dialog-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.dialog-close-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		padding: 6px;
		border-radius: var(--radius-md);
		--icon-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background var(--dur-fast, 120ms) var(--ease-out, ease),
			color var(--dur-fast, 120ms) var(--ease-out, ease);
	}

	.dialog-close-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.dialog-body {
		padding: var(--space-4, 16px);
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
		max-height: 65vh;
		overflow-y: auto;
	}

	.dialog-body.flush {
		padding: 0;
		gap: 0;
		flex: 1;
		min-height: 0;
		max-height: none;
		overflow: hidden;
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px) var(--space-4, 16px);
		background: var(--bg-base);
		border-top: 1px solid var(--line);
	}
</style>
