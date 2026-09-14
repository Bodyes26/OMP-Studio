<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconClose, IconPin, IconPinned } from '$lib/icons';
	import type { Snippet } from 'svelte';

	let {
		isPinned,
		isLightTheme,
		attentionCount,
		justOpened = false,
		onTogglePin,
		onClose,
		children
	} = $props<{
		isPinned: boolean;
		isLightTheme: boolean;
		attentionCount: number;
		justOpened?: boolean;
		onTogglePin: () => void;
		onClose: () => void;
		children: Snippet;
	}>();
</script>

<div
	class="companion-shell"
	class:pinned={isPinned}
	class:just-opened={justOpened}
>
	{#if isPinned}
		<header class="companion-header" data-tauri-drag-region="deep">
			<div class="header-left" data-tauri-drag-region="deep">
				<img
					src={isLightTheme ? '/logo-topbar-light.png' : '/logo-topbar.png'}
					alt="OMP Studio"
					class="brand-logo-img"
					draggable="false"
				/>
				{#if attentionCount > 0}
					<span class="attention-counter">{attentionCount} {m.ui_companionview_in_attesa_e1a0()}</span>
				{/if}
			</div>

			<div class="header-right">
				<button
					type="button"
					class="icon-btn active"
					onclick={onTogglePin}
					title={m.companion_unpin_title()}
					aria-label="Sblocca finestra"
				>
					<IconPinned />
				</button>

				<button
					type="button"
					class="icon-btn close-btn"
					onclick={onClose}
					title={m.ui_shortcutshelpmodal_chiudi_esc_0e80()}
					aria-label={m.settings_close_window()}
				>
					<IconClose />
				</button>
			</div>
		</header>
	{:else}
		<div class="spotlight-drag-region" data-tauri-drag-region></div>
		<div class="floating-controls">
			<button
				type="button"
				class="icon-btn"
				onclick={onTogglePin}
				title={m.companion_pin_title()}
				aria-label="Fissa finestra"
			>
				<IconPin />
			</button>
		</div>
	{/if}

	{@render children()}
</div>
