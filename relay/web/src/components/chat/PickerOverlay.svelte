<!--
  PickerOverlay.svelte — Contenitore per i selettori della barra del composer.
  Su schermi larghi (desktop >= 640px) e' un popover ancorato sopra il chip trigger;
  su schermi stretti (smartphone < 640px) si presenta come bottom sheet secondo il design system di Studio.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { IconClose } from '../../icons.ts';
	import { t } from '../../i18n.ts';

	let {
		open = false,
		title = '',
		triggerEl = null,
		width = '380px',
		onClose,
		children
	}: {
		open: boolean;
		title?: string;
		triggerEl?: HTMLElement | null;
		width?: string;
		onClose: () => void;
		children: Snippet;
	} = $props();

	let isDesktop = $state(false);
	let popoverStyle = $state('');

	function updateLayout(): void {
		if (typeof window === 'undefined') return;
		const wide = window.innerWidth >= 640;
		isDesktop = wide;

		if (wide && triggerEl) {
			const rect = triggerEl.getBoundingClientRect();
			const numWidth = parseInt(width, 10) || 380;
			const maxLeft = window.innerWidth - numWidth - 16;
			const targetLeft = Math.max(16, Math.min(rect.left, maxLeft));
			const bottom = window.innerHeight - rect.top + 8;
			popoverStyle = `left: ${targetLeft}px; bottom: ${bottom}px; width: ${numWidth}px;`;
		} else {
			popoverStyle = '';
		}
	}

	$effect(() => {
		if (open) {
			updateLayout();
			const onResize = () => updateLayout();
			window.addEventListener('resize', onResize);
			return () => window.removeEventListener('resize', onResize);
		}
	});

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

{#if open}
	<div
		class="overlay-backdrop"
		class:desktop-mode={isDesktop}
		onclick={onClose}
		onkeydown={handleKeydown}
		role="presentation"
	>
		<div
			class="overlay-surface"
			class:popover={isDesktop}
			class:bottom-sheet={!isDesktop}
			style={isDesktop ? popoverStyle : undefined}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="overlay-header">
				{#if !isDesktop}
					<span class="sheet-handle" aria-hidden="true"></span>
				{/if}
				<div class="header-row">
					<span class="overlay-title">{title}</span>
					<button
						type="button"
						class="close-btn"
						onclick={onClose}
						aria-label={t('close')}
						title={t('close')}
					>
						<IconClose />
					</button>
				</div>
			</div>

			<div class="overlay-content">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-overlay, 150);
		background: var(--backdrop);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.overlay-backdrop.desktop-mode {
		background: transparent;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		display: block;
	}

	.overlay-surface {
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.overlay-surface.bottom-sheet {
		width: 100%;
		max-height: 85vh;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		animation: slide-up 180ms var(--ease-out);
	}

	.overlay-surface.popover {
		position: fixed;
		max-height: 480px;
		border-radius: var(--radius-lg);
		animation: pop-fade 140ms var(--ease-out);
	}

	.overlay-header {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.sheet-handle {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--line-strong);
		align-self: center;
		margin: 8px auto 2px;
	}

	.header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
	}

	.overlay-title {
		font-size: var(--text-group-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.close-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 15px;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.overlay-content {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		min-height: 0;
	}

	@keyframes slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes pop-fade {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
