<script lang="ts">
	// Guscio della finestra companion. Fissata ha la testata da 32 px della
	// cornice con la puntina attiva; a scomparsa resta solo la maniglia di
	// trascinamento e la puntina, sempre a vista.
	import { m } from '$lib/paraglide/messages.js';
	import { IconClose, IconPin } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import type { Snippet } from 'svelte';

	let {
		isPinned,
		isLightTheme,
		attentionCount,
		justOpened = false,
		leaving = false,
		onOpenEnd,
		onTogglePin,
		onClose,
		children
	} = $props<{
		isPinned: boolean;
		isLightTheme: boolean;
		attentionCount: number;
		justOpened?: boolean;
		/** Uscita breve in corso, prima che Rust nasconda la finestra. */
		leaving?: boolean;
		onOpenEnd: () => void;
		onTogglePin: () => void;
		onClose: () => void;
		children: Snippet;
	}>();
</script>

{#snippet pinButton()}
	<Tooltip text={isPinned ? m.companion_unpin_title() : m.companion_pin_title()} placement="bottom">
		<button
			type="button"
			class="composer-icon-btn pin-btn"
			aria-pressed={isPinned}
			aria-label={isPinned ? m.companion_unpin_window() : m.companion_pin_window()}
			onclick={onTogglePin}
		>
			<IconPin />
		</button>
	</Tooltip>
{/snippet}

<div
	class="companion-shell"
	class:pinned={isPinned}
	class:just-opened={justOpened}
	class:leaving
	onanimationend={(e) => {
		if (e.target === e.currentTarget && justOpened) onOpenEnd();
	}}
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
					<span class="attention-counter">
						<span class="attention-dot" aria-hidden="true"></span>
						{attentionCount} {m.ui_companionview_in_attesa_e1a0()}
					</span>
				{/if}
			</div>

			<div class="header-right">
				{@render pinButton()}
				<button
					type="button"
					class="composer-icon-btn"
					aria-label={m.settings_close_window()}
					onclick={onClose}
				>
					<IconClose />
				</button>
			</div>
		</header>
	{:else}
		<div class="spotlight-drag-region" data-tauri-drag-region></div>
		<div class="floating-controls">
			{@render pinButton()}
		</div>
	{/if}

	{@render children()}
</div>
