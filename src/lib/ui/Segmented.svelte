<script lang="ts" generics="T extends string = string">
	export interface SegmentedOption<O extends string = string> {
		value: O;
		label: string;
		disabled?: boolean;
		ariaLabel?: string;
	}

	interface SegmentedProps<P extends string = string> {
		options: SegmentedOption<P>[];
		value?: P;
		disabled?: boolean;
		name?: string;
		ariaLabel?: string;
		ariaLabelledBy?: string;
		ariaDescribedBy?: string;
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
		onChange
	}: SegmentedProps<T> = $props();

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
	role="radiogroup"
	class="segmented-group"
	class:disabled
	aria-label={ariaLabel}
	aria-labelledby={ariaLabelledBy}
	aria-describedby={ariaDescribedBy}
	aria-disabled={disabled}
>
	{#each options as opt, i (opt.value)}
		{@const isSelected = value === opt.value}
		{@const isDisabled = disabled || opt.disabled}
		{@const isFocusable = opt.value === focusedValue}
		<button
			bind:this={buttonEls[i]}
			type="button"
			role="radio"
			class="segmented-button"
			class:active={isSelected}
			aria-checked={isSelected}
			aria-label={opt.ariaLabel ?? opt.label}
			disabled={isDisabled}
			tabindex={isDisabled ? -1 : isFocusable ? 0 : -1}
			onclick={() => selectValue(opt.value)}
			onkeydown={(e) => handleKeyDown(e, i)}
		>
			{opt.label}
		</button>
	{/each}
</div>

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

	.segmented-button {
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

	.segmented-button + .segmented-button {
		border-left: 1px solid var(--line);
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
