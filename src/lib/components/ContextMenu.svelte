<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { contextMenu, type ContextMenuItem } from '$lib/contextMenu.svelte';
	import { anchoredPopover, type AnchoredOptions } from '$lib/anchoredPopover';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	let menuEl = $state<HTMLElement | null>(null);

	const hasAnyIcon = $derived(contextMenu.items.some((it) => it.kind === 'item' && it.icon));

	const useInvoker = $derived(
		Boolean(contextMenu.fromKeyboard && contextMenu.invoker?.isConnected)
	);

	const popoverOptions = $derived<AnchoredOptions>(
		useInvoker
			? {
					anchor: contextMenu.invoker,
					placement: 'bottom-start',
					offset: 2,
					padding: 8,
					motion: true
			  }
			: {
					point: { x: contextMenu.x, y: contextMenu.y },
					padding: 8,
					motion: true
			  }
	);

	function getMenuItems(): HTMLButtonElement[] {
		if (!menuEl) return [];
		return Array.from(menuEl.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
	}

	function contextMenuEvents(node: HTMLElement) {
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
			console.error(m.ui_contextmenu_errore_durante_l_esecuzione_dell_azione_del_15b3(), err);
		}
	}
	async function runSecondaryAction(action: NonNullable<ContextMenuItem['secondaryAction']>) {
		const invoker = contextMenu.invoker;
		contextMenu.close();

		if (invoker && document.contains(invoker)) {
			try {
				invoker.focus();
			} catch {}
		}

		try {
			await action.run();
		} catch (err) {
			console.error(m.ui_contextmenu_errore_durante_l_esecuzione_dell_azione_del_15b3(), err);
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
			aria-label={contextMenu.label || m.context_menu_default_label()}
			tabindex="-1"
			class="context-menu"
			use:anchoredPopover={popoverOptions}
			use:contextMenuEvents
			onkeydown={handleKeydown}
		>
			{#each contextMenu.items as entry, i (i)}
				{#if entry.kind === 'separator'}
					<div role="separator" class="separator"></div>
				{:else if entry.kind === 'header'}
					<div role="presentation" class="menu-header">{entry.label}</div>
				{:else}
					<div class="item-row" class:has-secondary={Boolean(entry.secondaryAction)}>
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
							{#if entry.detail}
								<span class="detail">{entry.detail}</span>
							{/if}
							{#if entry.shortcut}
								<kbd class="shortcut">{entry.shortcut}</kbd>
							{/if}
						</button>
						{#if entry.secondaryAction}
							{@const sec = entry.secondaryAction}
							{@const SecIcon = sec.icon}
							<Tooltip text={sec.label} placement="top" offset={4}>
								<button
									type="button"
									class="secondary-action-btn"
									aria-label={sec.label}
									onclick={(e) => {
										e.stopPropagation();
										void runSecondaryAction(sec);
									}}
								>
									<SecIcon />
								</button>
							</Tooltip>
						{/if}
					</div>
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
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-base);
		z-index: var(--z-overlay);
		min-width: 260px;
		width: max-content;
		max-width: min(320px, calc(100vw - 16px));
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
	.menu-header {
		font-size: var(--text-group-label);
		font-weight: 600;
		color: var(--ink-faint);
		padding: 6px var(--space-2) 2px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		pointer-events: none;
		user-select: none;
	}

	.item-row {
		display: flex;
		align-items: center;
		width: 100%;
		border-radius: var(--radius-md);
		position: relative;
	}

	.item-row .item {
		flex: 1;
		min-width: 0;
	}

	.item-row :global(.tooltip-wrapper) {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
	}

	.detail {
		margin-left: auto;
		padding-left: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.item:hover:not([aria-disabled='true']) .detail,
	.item:focus:not([aria-disabled='true']) .detail {
		color: var(--ink-muted);
	}

	.secondary-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-left: 2px;
		padding: 0;
		border: none;
		border-radius: var(--radius-md);
		--icon-size: 12px;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.secondary-action-btn:hover {
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-raised));
		color: var(--danger);
	}

	.secondary-action-btn:focus-visible {
		outline-offset: -2px;
	}


	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 7px 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-muted);
		font-family: var(--font-ui);
		font-size: var(--text-body);
		font-weight: 450;
		text-align: left;
		cursor: pointer;
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
		/* 10% e non 14%: su alcuni temi scuri il 14% portava il testo --danger
		   sotto 4,5:1. */
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-raised));
		color: var(--danger);
	}

	.icon-slot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex: 0 0 14px;
		--icon-size: 14px;
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
		outline-offset: -2px;
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

	:global(:root[data-animations='false']) .item,
	:global(:root[data-animations='false']) .secondary-action-btn {
		transition: none !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.item,
		.secondary-action-btn {
			transition: none !important;
		}
	}
</style>
