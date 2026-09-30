<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { modelSettingsStore, type ModelDto } from '$lib/stores/modelSettings.svelte';
	import { splitModelSelector } from '$lib/stores/modelSettingsHelpers';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { IconContextWindow, IconRoleSlow, IconRoleVision } from '$lib/icons';
	import ModelPickerList from './ModelPickerList.svelte';
	let {
		catalog = [],
		value = '',
		placeholder = m.ui_modelpickerdropdown_seleziona_un_modello_fc75(),
		disabled = false,
		onSelect
	} = $props<{
		catalog: ModelDto[];
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		onSelect?: (selector: string, model: ModelDto) => void;
	}>();

	let isOpen = $state(false);
	let dropdownRef = $state<HTMLDivElement | null>(null);
	let triggerRef = $state<HTMLButtonElement | null>(null);


	// Estrai il selector pulito (senza :thinkingLevel)
	const cleanSelector = $derived(
		value ? splitModelSelector(value, modelSettingsStore.knownSelectors).base : ''
	);

	const selectedModel = $derived.by(() => {
		if (!cleanSelector) return null;
		return (catalog as ModelDto[]).find((model: ModelDto) => model.selector === cleanSelector) || null;
	});
	const fallbackSelection = $derived.by(() => {
		const separator = cleanSelector.indexOf('/');
		return {
			provider: separator >= 0 ? cleanSelector.slice(0, separator) : 'custom',
			name: separator >= 0 ? cleanSelector.slice(separator + 1) : cleanSelector
		};
	});

	function toggleOpen() {
		if (disabled) return;
		isOpen = !isOpen;
	}

	function closeDropdown(restoreFocus = true) {
		isOpen = false;
		if (restoreFocus) {
			setTimeout(() => triggerRef?.focus(), 20);
		}
	}

	function handleSelect(selector: string, m: ModelDto) {
		closeDropdown(true);
		onSelect?.(selector, m);
	}

	function formatContext(tokens?: number) {
		if (!tokens) return '';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
		return `${tokens}`;
	}
	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
			e.preventDefault();
			toggleOpen();
		}
	}
	function handleDocClick(e: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
			closeDropdown(false);
		}
	}
</script>

<svelte:window onclick={handleDocClick} />

<div class="picker-container" bind:this={dropdownRef}>
	<button
		type="button"
		bind:this={triggerRef}
		class="picker-trigger"
		class:active={isOpen}
		class:has-value={!!selectedModel}
		{disabled}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		onclick={(e) => { e.stopPropagation(); toggleOpen(); }}
		onkeydown={handleKeydown}
	>
		{#if selectedModel}
			<span class="trigger-content">
				<span class="selection-copy">
					<span class="provider-line">{selectedModel.provider}</span>
					<span class="model-name" title={selectedModel.selector}>{selectedModel.name}</span>
				</span>
				<span class="selection-capabilities" aria-label={m.models_picker_capabilities_label()}>
					{#if selectedModel.contextWindow}
						<span
							class="capability-icon context-capability"
							title={`Contesto: ${formatContext(selectedModel.contextWindow)} token`}
							aria-label={`Contesto: ${formatContext(selectedModel.contextWindow)} token`}
						>
							<IconContextWindow />
							<small>{formatContext(selectedModel.contextWindow)}</small>
						</span>
					{/if}
					{#if selectedModel.input?.includes('image')}
						<span class="capability-icon" title={m.models_picker_vision_cap()} aria-label={m.models_picker_vision_cap()}>
							<IconRoleVision />
						</span>
					{/if}
					{#if selectedModel.reasoning}
						<span class="capability-icon" title={m.models_picker_reasoning_cap()} aria-label={m.models_picker_reasoning_cap()}>
							<IconRoleSlow />
						</span>
					{/if}
				</span>
			</span>
		{:else if cleanSelector}
			<span class="trigger-content">
				<span class="selection-copy">
					<span class="provider-line">{fallbackSelection.provider}</span>
					<span class="model-name" title={cleanSelector}>{fallbackSelection.name}</span>
				</span>
			</span>
		{:else}
			<span class="placeholder">{placeholder}</span>
		{/if}
		<svg
			class="chevron"
			class:rotated={isOpen}
			viewBox="0 0 16 16"
			width="11"
			height="11"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
		>
			<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>

	{#if isOpen}
		<div
			class="picker-dropdown"
			popover="manual"
			use:anchoredPopover={{ anchor: triggerRef, offset: 4, matchWidth: true, constrainHeight: true }}
		>
			<ModelPickerList
				catalog={catalog}
				value={cleanSelector}
				placeholder={m.models_picker_search_placeholder()}
				onSelect={handleSelect}
				onClose={() => closeDropdown(true)}
			/>
		</div>
	{/if}
</div>

<style>
	.picker-container {
		position: relative;
		width: 100%;
		min-width: 0;
	}

	.picker-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 5px 8px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		cursor: pointer;
		outline: none;
		min-height: 32px;
		transition: border-color var(--dur-fast), background var(--dur-fast);
	}

	.picker-trigger.has-value {
		min-height: 44px;
		padding-block: 6px;
	}

	.picker-trigger:hover:not(:disabled) {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.picker-trigger:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.picker-trigger.active {
		border-color: var(--brand);
	}

	.picker-trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.trigger-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 0;
		overflow: hidden;
		text-align: left;
	}

	.selection-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		overflow: hidden;
	}

	.provider-line {
		color: var(--ink-muted);
		font-size: 9px;
		line-height: 1.1;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.model-name {
		overflow: hidden;
		color: var(--ink);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selection-capabilities {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.capability-icon {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		--icon-size: 12px;
	}

	.capability-icon small {
		font-family: var(--font-mono);
		font-size: 9px;
		line-height: 1;
	}

	.placeholder {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chevron {
		color: var(--ink-faint);
		flex-shrink: 0;
		transition: transform var(--dur-fast);
	}

	.chevron.rotated {
		transform: rotate(180deg);
	}

	/* Nel top layer (`popover`) il pannello non lo taglia nessun `overflow`
	   degli antenati: dentro l'editor task o un pannello di impostazioni un
	   menu `absolute` perdeva le ultime voci. Le coordinate le calcola
	   `anchoredPopover`, che ribalta e pubblica lo spazio disponibile. */
	.picker-dropdown {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		min-width: 240px;
		max-height: min(320px, var(--anchored-space, 320px));
		animation: picker-in var(--dur-fast) var(--ease-out);
		background: var(--bg-overlay);
		/* Lo stile UA di `[popover]` impone `color: CanvasText`: senza questa
		   riga il testo non erediterebbe il tema. */
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@keyframes picker-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}


</style>
