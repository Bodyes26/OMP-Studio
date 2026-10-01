<script lang="ts">
	interface SwitchProps {
		checked?: boolean;
		disabled?: boolean;
		id?: string;
		name?: string;
		label?: string;
		ariaLabel?: string;
		ariaLabelledBy?: string;
		ariaDescribedBy?: string;
		onChange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		disabled = false,
		id,
		name,
		label,
		ariaLabel,
		ariaLabelledBy,
		ariaDescribedBy,
		onChange
	}: SwitchProps = $props();

	function handleChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		checked = target.checked;
		onChange?.(target.checked);
	}
</script>

<label class="switch-root" class:disabled class:checked>
	<input
		type="checkbox"
		role="switch"
		{id}
		{name}
		{disabled}
		checked={checked}
		aria-checked={checked}
		aria-label={ariaLabel ?? label}
		aria-labelledby={ariaLabelledBy}
		aria-describedby={ariaDescribedBy}
		onchange={handleChange}
		class="switch-input"
	/>
	<span class="switch-track" aria-hidden="true">
		<span class="switch-thumb"></span>
	</span>
	{#if label}
		<span class="switch-label">{label}</span>
	{/if}
</label>

<style>
	.switch-root {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2, 8px);
		cursor: pointer;
		user-select: none;
	}

	.switch-root.disabled {
		opacity: 0.45;
		cursor: not-allowed;
		pointer-events: none;
	}

	.switch-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.switch-track {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-full);
		box-sizing: border-box;
		transition:
			background-color var(--dur-fast, 120ms) var(--ease-out),
			border-color var(--dur-fast, 120ms) var(--ease-out);
	}

	.switch-root:hover:not(.disabled) .switch-track {
		border-color: var(--ink-muted);
	}

	.switch-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: var(--radius-full);
		background: var(--ink);
		transition:
			transform var(--dur-fast, 120ms) var(--ease-out),
			background-color var(--dur-fast, 120ms) var(--ease-out);
	}

	.switch-root.checked .switch-track {
		background: var(--brand);
		border-color: var(--brand);
	}

	.switch-root.checked .switch-thumb {
		transform: translateX(14px);
		background: var(--on-brand);
	}

	.switch-input:focus-visible ~ .switch-track {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.switch-label {
		font-size: var(--text-label, 12px);
		color: var(--ink);
	}
</style>
