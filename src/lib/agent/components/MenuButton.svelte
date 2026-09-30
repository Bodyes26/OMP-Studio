<script lang="ts">
	/**
	 * Pulsante della barra del composer con menu a comparsa verso l'alto.
	 * Si chiude con click all'esterno o premendo Escape.
	 */
	import type { Snippet } from 'svelte';

	let {
		open = false,
		title,
		width = '320px',
		align = 'left',
		className = '',
		disabled = false,
		onToggle,
		onClose,
		trigger,
		children
	} = $props<{
		open: boolean;
		title: string;
		width?: string;
		align?: 'left' | 'right';
		className?: string;
		disabled?: boolean;
		onToggle: () => void;
		onClose: () => void;
		trigger: Snippet;
		children: Snippet;
	}>();

	let containerEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!open) return;

		const handleMouseDown = (e: MouseEvent) => {
			if (containerEl && !containerEl.contains(e.target as Node)) {
				onClose();
			}
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		};

		document.addEventListener('mousedown', handleMouseDown, true);
		document.addEventListener('keydown', handleKeyDown, true);

		return () => {
			document.removeEventListener('mousedown', handleMouseDown, true);
			document.removeEventListener('keydown', handleKeyDown, true);
		};
	});
</script>

<div class="menu-button-container" bind:this={containerEl}>
	<button
		type="button"
		class="menu-button {className}"
		class:active={open}
		{disabled}
		{title}
		aria-expanded={open}
		aria-haspopup="true"
		onclick={(e) => {
			e.stopPropagation();
			onToggle();
		}}
	>
		{@render trigger()}
	</button>

	{#if open}
		<div
			class="menu-popover rv-lift"
			class:align-right={align === 'right'}
			style="width: {width};"
			role="menu"
			tabindex="-1"
		>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.menu-button-container {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.menu-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.menu-button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.menu-button.active {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.menu-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.menu-popover {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		z-index: var(--z-overlay);
		max-width: calc(100vw - 24px);
		max-height: 380px;
		/* overflow-y: auto da solo rende scorrevole anche l'asse x: un contenuto
		   largo un pixel in piu' faceva comparire la barra orizzontale. */
		overflow-x: hidden;
		overflow-y: auto;
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		color: var(--ink);
		font-family: var(--font-ui);
		outline: none;
		/* Menu aperti a comando: comparsa rapida, non la rivelazione lenta della chat. */
		--dur: 150ms;
		--blur: 3px;
	}

	.menu-popover.align-right {
		left: auto;
		right: 0;
	}
</style>
