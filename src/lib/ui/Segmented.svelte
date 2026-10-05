<script lang="ts" generics="T extends string = string">
	import type { Component } from 'svelte';
	import Tooltip from './Tooltip.svelte';

	export interface SegmentedOption<O extends string = string> {
		value: O;
		label: string;
		disabled?: boolean;
		ariaLabel?: string;
		/** Conteggio opzionale accanto all'etichetta (meta tabulare). */
		count?: number;
		/** `attention`: il conteggio segnala qualcosa che aspetta (ambra). */
		countTone?: 'neutral' | 'attention';
		/** Opzione iconica: l'icona prende il posto dell'etichetta, che resta
		 *  il nome accessibile e il testo del `Tooltip` (D8). */
		icon?: Component;
		/** Testo del `Tooltip` se diverso dall'etichetta (es. con la scorciatoia). */
		tooltip?: string;
	}

	interface SegmentedProps<P extends string = string> {
		options: SegmentedOption<P>[];
		value?: P;
		disabled?: boolean;
		name?: string;
		ariaLabel?: string;
		ariaLabelledBy?: string;
		ariaDescribedBy?: string;
		/** `tablist`: le opzioni comandano pannelli (`role="tab"` con
		 *  `aria-controls`); `radiogroup` resta il default per le modalita'. */
		mode?: 'radiogroup' | 'tablist';
		tabIdPrefix?: string;
		panelIdPrefix?: string;
		/** Occupa tutta la larghezza con opzioni di pari misura (colonne strette). */
		fill?: boolean;
		onChange?: (val: P) => void;
	}

	let {
		options,
		value,
		disabled = false,
		name,
		ariaLabel,
		ariaLabelledBy,
		ariaDescribedBy,
		mode = 'radiogroup',
		tabIdPrefix = 'tab-',
		panelIdPrefix = 'panel-',
		fill = false,
		onChange
	}: SegmentedProps<T> = $props();

	const isTabs = $derived(mode === 'tablist');

	let buttonEls = $state<(HTMLButtonElement | null)[]>([]);
	const focusedValue = $derived(
		(options.find((option) => !option.disabled && option.value === value) ??
			options.find((option) => !option.disabled))?.value
	);

	function selectValue(val: T) {
		if (disabled) return;
		if (val !== value) {
			onChange?.(val);
		}
	}

	function handleKeyDown(event: KeyboardEvent, index: number) {
		if (disabled) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

		const enabledIndices = options
			.map((opt, i) => (!opt.disabled ? i : -1))
			.filter((i) => i >= 0);

		if (enabledIndices.length === 0) return;

		const currentPos = enabledIndices.indexOf(index);
		let targetPos = -1;

		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				targetPos = (currentPos + 1) % enabledIndices.length;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				targetPos = (currentPos - 1 + enabledIndices.length) % enabledIndices.length;
				break;
			case 'Home':
				targetPos = 0;
				break;
			case 'End':
				targetPos = enabledIndices.length - 1;
				break;
			case ' ':
			case 'Enter': {
				event.preventDefault();
				const opt = options[index];
				if (opt && !opt.disabled) {
					selectValue(opt.value);
				}
				return;
			}
			default:
				return;
		}

		event.preventDefault();
		const nextIndex = enabledIndices[targetPos];
		const nextOpt = options[nextIndex];
		if (nextOpt) {
			buttonEls[nextIndex]?.focus();
			selectValue(nextOpt.value);
		}
	}
</script>

<div
	role={isTabs ? 'tablist' : 'radiogroup'}
	class="segmented-group"
	class:disabled
	class:fill
	aria-label={ariaLabel}
	aria-labelledby={ariaLabelledBy}
	aria-describedby={ariaDescribedBy}
	aria-disabled={disabled}
>
	{#each options as opt, i (opt.value)}
		{#if opt.icon}
			<Tooltip text={opt.tooltip ?? opt.label}>
				{@render option(opt, i)}
			</Tooltip>
		{:else}
			{@render option(opt, i)}
		{/if}
	{/each}
</div>

{#snippet option(opt: SegmentedOption<T>, i: number)}
	{@const isSelected = value === opt.value}
	{@const isDisabled = disabled || opt.disabled}
	{@const isFocusable = opt.value === focusedValue}
	<button
		bind:this={buttonEls[i]}
		type="button"
		role={isTabs ? 'tab' : 'radio'}
		id={isTabs ? `${tabIdPrefix}${opt.value}` : undefined}
		aria-controls={isTabs ? `${panelIdPrefix}${opt.value}` : undefined}
		class="segmented-button"
		class:active={isSelected}
		class:icon={!!opt.icon}
		aria-checked={isTabs ? undefined : isSelected}
		aria-selected={isTabs ? isSelected : undefined}
		aria-label={opt.ariaLabel ?? (opt.count ? undefined : opt.label)}
		disabled={isDisabled}
		tabindex={isDisabled ? -1 : isFocusable ? 0 : -1}
		onclick={() => selectValue(opt.value)}
		onkeydown={(e) => handleKeyDown(e, i)}
	>
		{#if opt.icon}
			<opt.icon />
		{:else}
			{opt.label}
		{/if}
		{#if opt.count}
			<span class="segmented-count" class:attention={opt.countTone === 'attention'}>{opt.count}</span>
		{/if}
	</button>
{/snippet}

<style>
	.segmented-group {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-sunken);
		overflow: hidden;
		box-sizing: border-box;
		user-select: none;
	}

	.segmented-group.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.segmented-group.fill {
		display: flex;
		width: 100%;
	}

	.segmented-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 5px var(--space-3, 12px);
		border: none;
		background: var(--bg-sunken);
		color: var(--ink-muted);
		font-size: var(--text-xs, 12px);
		font-family: var(--font-ui, inherit);
		cursor: pointer;
		outline: none;
		transition:
			background-color var(--dur-fast, 120ms) var(--ease-out),
			color var(--dur-fast, 120ms) var(--ease-out);
	}

	.fill .segmented-button {
		flex: 1 1 0;
		min-width: 0;
		padding-inline: var(--space-2);
	}

	.segmented-count {
		min-width: 16px;
		height: 16px;
		padding: 0 5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		/* Eredita dal pulsante: --ink-muted a riposo, --ink sull'attivo. Un
		   --ink-muted fisso sul fondo attivo scendeva a 4,29:1. */
		color: inherit;
		font-size: var(--text-meta);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	/* Attesa: tinta ambra derivata, testo --ink per restare AA su ogni tema. */
	.segmented-count.attention {
		background: color-mix(in srgb, var(--warn) 22%, transparent);
		color: var(--ink);
	}

	/* I divisori stanno sul figlio diretto: il pulsante, oppure l'involucro
	   del Tooltip quando l'opzione e' iconica. */
	.segmented-group > :global(:not(:first-child)) {
		border-left: 1px solid var(--line);
	}

	/* Opzione iconica: 28 px con il bordo del gruppo, la misura dei trigger. */
	.segmented-button.icon {
		width: 28px;
		height: 26px;
		padding: 0;
		--icon-size: 14px;
	}

	.segmented-button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.segmented-button.active {
		background: var(--bg-active);
		color: var(--ink);
		font-weight: 600;
	}

	.segmented-button:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.segmented-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
