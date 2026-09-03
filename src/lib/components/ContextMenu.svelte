<script lang="ts">
	import { contextMenu, type ContextMenuItem } from '$lib/contextMenu.svelte';

	let menuEl = $state<HTMLElement | null>(null);

	const hasAnyIcon = $derived(contextMenu.items.some((it) => it.kind === 'item' && it.icon));

	function getMenuItems(): HTMLButtonElement[] {
		if (!menuEl) return [];
		return Array.from(menuEl.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
	}

	function updatePosition(node: HTMLElement) {
		const PADDING = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Posiziona temporaneamente per misurare
		node.style.left = '0px';
		node.style.top = '0px';
		node.style.visibility = 'hidden';

		const menuWidth = node.offsetWidth;
		const menuHeight = node.offsetHeight;

		const targetX = contextMenu.x;
		const targetY = contextMenu.y;
		const invoker = contextMenu.invoker;
		const fromKeyboard = contextMenu.fromKeyboard;

		let left = targetX;
		let top = targetY;

		if (fromKeyboard && invoker) {
			const rect = invoker.getBoundingClientRect();
			left = rect.left;
			top = rect.bottom + 2;

			// Orizzontale da tastiera: se straborda a destra, allinea al bordo destro dell'invoker
			if (left + menuWidth > vw - PADDING) {
				left = rect.right - menuWidth;
			}
			if (left < PADDING) {
				left = PADDING;
			}

			// Verticale da tastiera: se straborda in basso, ribalta sopra l'invoker
			if (top + menuHeight > vh - PADDING) {
				top = rect.top - menuHeight - 2;
			}
			if (top < PADDING) {
				top = Math.max(PADDING, Math.min(vh - menuHeight - PADDING, top));
			}
		} else {
			// Posizionamento da puntatore
			// Orizzontale: se straborda a destra, ribalta a sinistra del cursore
			if (left + menuWidth > vw - PADDING) {
				left = targetX - menuWidth;
			}
			if (left < PADDING) {
				left = targetX;
			}

			// Verticale: se straborda in basso, ribalta sopra il cursore
			if (top + menuHeight > vh - PADDING) {
				top = targetY - menuHeight;
			}
			if (top < PADDING) {
				top = targetY;
			}
		}

		// Clamp finale rigoroso entro i margini della finestra
		left = Math.max(PADDING, Math.min(vw - menuWidth - PADDING, left));
		top = Math.max(PADDING, Math.min(vh - menuHeight - PADDING, top));

		node.style.left = `${Math.round(left)}px`;
		node.style.top = `${Math.round(top)}px`;
		node.style.visibility = 'visible';
	}

	function popoverAction(node: HTMLElement) {
		const supportsPopover =
			typeof HTMLElement !== 'undefined' &&
			typeof HTMLElement.prototype.showPopover === 'function';

		if (supportsPopover) {
			try {
				node.showPopover();
			} catch {}
		} else {
			node.removeAttribute('popover');
		}

		updatePosition(node);

		// Anche gli elementi disabilitati restano focalizzabili, come nei menu desktop.
		requestAnimationFrame(() => {
			const items = getMenuItems();
			if (items.length > 0) {
				items[0].focus();
			} else {
				node.focus();
			}
		});

		function onPointerDownOutside(event: PointerEvent) {
			if (!node.contains(event.target as Node)) {
				contextMenu.close();
			}
		}

		function onScrollOrResize() {
			contextMenu.close();
		}

		window.addEventListener('pointerdown', onPointerDownOutside, true);
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);

		return {
			destroy() {
				window.removeEventListener('pointerdown', onPointerDownOutside, true);
				window.removeEventListener('scroll', onScrollOrResize, true);
				window.removeEventListener('resize', onScrollOrResize);
				if (supportsPopover) {
					try {
						node.hidePopover();
					} catch {}
				}
			}
		};
	}

	async function runItem(item: ContextMenuItem) {
		if (item.disabled) return;
		const invoker = contextMenu.invoker;
		contextMenu.close();

		if (invoker && document.contains(invoker)) {
			try {
				invoker.focus();
			} catch {}
		}

		try {
			await item.run();
		} catch (err) {
			console.error('Errore durante l\'esecuzione dell\'azione del menu contestuale:', err);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!contextMenu.isOpen) return;

		const items = getMenuItems();
		const currentActive = document.activeElement as HTMLButtonElement | null;
		const currentIndex = items.indexOf(currentActive as HTMLButtonElement);

		switch (event.key) {
			case 'ArrowDown': {
				event.preventDefault();
				event.stopPropagation();
				if (items.length === 0) return;
				const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
				items[nextIndex]?.focus();
				break;
			}
			case 'ArrowUp': {
				event.preventDefault();
				event.stopPropagation();
				if (items.length === 0) return;
				const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
				items[prevIndex]?.focus();
				break;
			}
			case 'Home': {
				event.preventDefault();
				event.stopPropagation();
				items[0]?.focus();
				break;
			}
			case 'End': {
				event.preventDefault();
				event.stopPropagation();
				items[items.length - 1]?.focus();
				break;
			}
			case 'Escape': {
				event.preventDefault();
				event.stopPropagation();
				const invoker = contextMenu.invoker;
				contextMenu.close();
				if (invoker && document.contains(invoker)) {
					try {
						invoker.focus();
					} catch {}
				}
				break;
			}
			case 'Tab': {
				event.preventDefault();
				event.stopPropagation();
				const invoker = contextMenu.invoker;
				contextMenu.close();
				if (invoker && document.contains(invoker)) {
					try {
						invoker.focus();
					} catch {}
				}
				break;
			}
			case 'Enter':
			case ' ': {
				if (currentActive && currentActive !== menuEl) {
					// L'evento nativo click del pulsante gestira' l'attivazione.
					return;
				}
				if (items.length > 0) {
					event.preventDefault();
					event.stopPropagation();
					items[0].click();
				}
				break;
			}
		}
	}
</script>

{#if contextMenu.isOpen}
	{#key contextMenu.nonce}
		<div
			bind:this={menuEl}
			popover="manual"
			role="menu"
			aria-label={contextMenu.label || 'Menu contestuale'}
			tabindex="-1"
			class="context-menu"
			use:popoverAction
			onkeydown={handleKeydown}
		>
			{#each contextMenu.items as entry, i (i)}
				{#if entry.kind === 'separator'}
					<div role="separator" class="separator"></div>
				{:else}
					<button
						type="button"
						role="menuitem"
						class="item"
						class:danger={entry.danger}
						aria-disabled={entry.disabled ? 'true' : undefined}
						aria-label={entry.hint ? `${entry.label}. ${entry.hint}` : entry.label}
						title={entry.hint || undefined}
						onclick={() => runItem(entry)}
					>
						{#if hasAnyIcon}
							<span class="icon-slot">
								{#if entry.icon}
									{@const Icon = entry.icon}
									<Icon />
								{/if}
							</span>
						{/if}
						<span class="label">{entry.label}</span>
						{#if entry.shortcut}
							<kbd class="shortcut">{entry.shortcut}</kbd>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/key}
{/if}

<style>
	.context-menu {
		position: fixed;
		inset: unset;
		margin: 0;
		padding: var(--space-1);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		z-index: var(--z-overlay);
		width: min(240px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		overflow-x: hidden;
		display: flex;
		flex-direction: column;
		gap: 1px;
		outline: none;
		user-select: none;
		box-sizing: border-box;
	}

	.context-menu::backdrop {
		background: transparent;
	}

	.separator {
		height: 1px;
		background: var(--line);
		margin: 3px 0;
		border: none;
		flex-shrink: 0;
	}

	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 26px;
		padding: 4px var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		outline: none;
		white-space: nowrap;
		box-sizing: border-box;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.item:hover:not([aria-disabled='true']),
	.item:focus:not([aria-disabled='true']),
	.item:focus-visible:not([aria-disabled='true']) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.item[aria-disabled='true'] {
		opacity: 0.45;
		cursor: default;
	}

	.item[aria-disabled='true']:focus,
	.item[aria-disabled='true']:focus-visible {
		background: var(--bg-hover);
	}

	/* Stato danger solo su hover e focus */
	.item.danger {
		color: var(--ink-muted);
	}

	.item.danger:hover:not([aria-disabled='true']),
	.item.danger:focus:not([aria-disabled='true']),
	.item.danger:focus-visible:not([aria-disabled='true']) {
		background: color-mix(in srgb, var(--brand) 14%, var(--bg-raised));
		color: var(--brand-ink);
	}

	.icon-slot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex: 0 0 14px;
		color: inherit;
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item:focus-visible {
		box-shadow: inset 0 0 0 1.5px var(--focus);
	}

	.shortcut {
		margin-left: auto;
		padding-left: var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		background: transparent;
		border: none;
		font-weight: 400;
	}

	.item:hover:not([aria-disabled='true']) .shortcut,
	.item:focus:not([aria-disabled='true']) .shortcut,
	.item:focus-visible:not([aria-disabled='true']) .shortcut {
		color: var(--ink-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.item {
			transition: none !important;
		}
	}
</style>
