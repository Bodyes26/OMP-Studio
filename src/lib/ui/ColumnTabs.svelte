<script lang="ts">
	export interface ColumnTabItem {
		id: string;
		label: string;
		ariaLabel?: string;
		disabled?: boolean;
	}

	interface ColumnTabsProps {
		tabs: ColumnTabItem[];
		selected: string;
		onChange?: (id: string) => void;
		ariaLabel?: string;
		tabIdPrefix?: string;
		panelIdPrefix?: string;
		indicatorPosition?: 'top' | 'bottom';
	}

	let {
		tabs = [],
		selected,
		onChange,
		ariaLabel,
		tabIdPrefix = 'tab-',
		panelIdPrefix = 'panel-',
		indicatorPosition = 'bottom'
	}: ColumnTabsProps = $props();

	let tabEls = $state<(HTMLButtonElement | null)[]>([]);
	let rovingId = $state<string | null>(null);

	// La scheda Agent scompare nelle corsie Lab: il fuoco resta su una scheda disponibile.
	$effect(() => {
		const exists = tabs.some((t) => t.id === rovingId && !t.disabled);
		if (!exists) {
			rovingId = null;
		}
	});

	const effectiveFocusedId = $derived.by(() => {
		if (rovingId && tabs.some((t) => t.id === rovingId && !t.disabled)) {
			return rovingId;
		}
		if (selected && tabs.some((t) => t.id === selected && !t.disabled)) {
			return selected;
		}
		const firstEnabled = tabs.find((t) => !t.disabled);
		return firstEnabled?.id ?? null;
	});

	function selectTab(id: string) {
		const tab = tabs.find((t) => t.id === id);
		if (!tab || tab.disabled) return;
		rovingId = id;
		if (id !== selected) {
			onChange?.(id);
		}
	}

	function handleKeyDown(event: KeyboardEvent, index: number) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

		const enabledIndices = tabs
			.map((t, i) => (!t.disabled ? i : -1))
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
				const target = tabs[index];
				if (target && !target.disabled) {
					selectTab(target.id);
				}
				return;
			}
			default:
				return;
		}

		event.preventDefault();
		const nextIndex = enabledIndices[targetPos];
		const nextTab = tabs[nextIndex];
		if (nextTab) {
			rovingId = nextTab.id;
			tabEls[nextIndex]?.focus();
		}
	}
</script>

<div
	role="tablist"
	class="column-tabs-track"
	class:indicator-top={indicatorPosition === 'top'}
	aria-label={ariaLabel}
>
	{#each tabs as tab, i (tab.id)}
		{@const isSelected = selected === tab.id}
		{@const isDisabled = !!tab.disabled}
		{@const isFocusable = tab.id === effectiveFocusedId}
		<button
			bind:this={tabEls[i]}
			type="button"
			role="tab"
			id={`${tabIdPrefix}${tab.id}`}
			aria-controls={`${panelIdPrefix}${tab.id}`}
			aria-selected={isSelected}
			aria-label={tab.ariaLabel}
			disabled={isDisabled}
			tabindex={isDisabled ? -1 : isFocusable ? 0 : -1}
			class="column-tab-btn"
			class:selected={isSelected}
			onclick={() => selectTab(tab.id)}
			onkeydown={(e) => handleKeyDown(e, i)}
		>
			<span class="column-tab-label">{tab.label}</span>
		</button>
	{/each}
</div>

<style>
	.column-tabs-track {
		display: flex;
		align-items: center;
		height: 32px;
		padding: 0;
		gap: 0;
		background: transparent;
		box-sizing: border-box;
		user-select: none;
	}

	.column-tab-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 100%;
		padding: 0 var(--space-2, 8px);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--ink-faint);
		cursor: pointer;
		outline: none;
		box-sizing: border-box;
		transition:
			color var(--dur-fast, 120ms) var(--ease-out),
			border-color var(--dur-fast, 120ms) var(--ease-out),
			background-color var(--dur-fast, 120ms) var(--ease-out);
	}

	.indicator-top .column-tab-btn {
		border-bottom: none;
		border-top: 2px solid transparent;
	}

	.column-tab-label {
		font-size: var(--text-label, 12px);
		font-weight: 500;
		letter-spacing: normal;
		text-transform: none;
		line-height: 1.4;
	}

	.column-tab-btn:hover:not(:disabled) {
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.column-tab-btn.selected {
		color: var(--ink);
		border-bottom-color: var(--brand);
	}

	.indicator-top .column-tab-btn.selected {
		border-top-color: var(--brand);
	}

	.column-tab-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.column-tab-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
