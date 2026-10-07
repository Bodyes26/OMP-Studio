<script lang="ts">
	/**
	 * Menu a tendina per le voci della riga di stato (statusLine) che traboccano
	 * rispetto alla larghezza orizzontale disponibile nel composer.
	 *
	 * Adotta il componente unificato MenuButton (popover fixed nel top-layer)
	 * con trigger monospazio compatto con ellissi («…»).
	 */
	import type { Snippet } from 'svelte';
	import MenuButton from '$lib/ui/MenuButton.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		open = false,
		onToggle,
		onClose,
		children
	} = $props<{
		open: boolean;
		onToggle: () => void;
		onClose: () => void;
		children: Snippet;
	}>();
</script>

<div class="overflow-menu-wrapper">
	<MenuButton
		{open}
		title={m.chat_v2_composer_status_overflow()}
		ariaLabel={m.chat_v2_composer_status_overflow()}
		hasPopup="menu"
		width="260px"
		align="right"
		className="status-overflow-trigger"
		{onToggle}
		{onClose}
	>
		{#snippet trigger()}
			<span class="overflow-dots font-mono" aria-hidden="true">…</span>
		{/snippet}
		{#snippet children()}
			<div class="overflow-items-list" role="menu">
				{@render children()}
			</div>
		{/snippet}
	</MenuButton>
</div>

<style>
	.overflow-menu-wrapper {
		display: inline-flex;
		align-items: center;
	}

	:global(.menu-button.status-overflow-trigger) {
		height: auto;
		padding: 2px 6px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		border-radius: var(--radius-sm);
		border: 0;
		background: transparent;
		--icon-size: 11px;
	}

	:global(.menu-button.status-overflow-trigger:hover:not(:disabled)),
	:global(.menu-button.status-overflow-trigger.active) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.overflow-dots {
		font-weight: 700;
		letter-spacing: -0.5px;
		line-height: 1;
	}

	.overflow-items-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-1);
	}
</style>
