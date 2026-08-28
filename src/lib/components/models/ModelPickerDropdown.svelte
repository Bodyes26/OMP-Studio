<script lang="ts">
	import type { ModelDto } from '$lib/stores/modelSettings.svelte';
	import { fade } from 'svelte/transition';
	import { IconContextWindow, IconRoleSlow, IconRoleVision } from '$lib/icons';

	let {
		catalog = [],
		value = '',
		placeholder = 'Seleziona un modello...',
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
	let filterQuery = $state('');
	let highlightedIndex = $state(0);
	let dropdownRef = $state<HTMLDivElement | null>(null);
	let triggerRef = $state<HTMLButtonElement | null>(null);
	let inputRef = $state<HTMLInputElement | null>(null);

	// Estrai il selector pulito (senza :thinkingLevel)
	const cleanSelector = $derived(value ? value.split(':')[0] : '');

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

	const filteredModels = $derived.by(() => {
		const q = filterQuery.trim().toLowerCase();
		if (!q) return catalog as ModelDto[];
		return (catalog as ModelDto[]).filter((m: ModelDto) =>
			m.name.toLowerCase().includes(q) ||
			m.id.toLowerCase().includes(q) ||
			m.provider.toLowerCase().includes(q) ||
			m.selector.toLowerCase().includes(q)
		);
	});

	// Raggruppa per provider
	const groupedModels = $derived.by(() => {
		const map: Record<string, ModelDto[]> = {};
		for (const m of filteredModels) {
			if (!map[m.provider]) map[m.provider] = [];
			map[m.provider].push(m);
		}
		return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
	});

	function toggleOpen() {
		if (disabled) return;
		isOpen = !isOpen;
		if (isOpen) {
			filterQuery = '';
			highlightedIndex = 0;
			setTimeout(() => inputRef?.focus(), 50);
		}
	}

	function closeDropdown(restoreFocus = true) {
		isOpen = false;
		if (restoreFocus) {
			setTimeout(() => triggerRef?.focus(), 20);
		}
	}

	function handleSelect(m: ModelDto) {
		closeDropdown(true);
		onSelect?.(m.selector, m);
	}

	function formatContext(tokens?: number) {
		if (!tokens) return '';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
		return `${tokens}`;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'ArrowDown' || e.key === 'Enter') {
				e.preventDefault();
				toggleOpen();
			}
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			closeDropdown(true);
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (filteredModels.length > 0) {
				highlightedIndex = (highlightedIndex + 1) % filteredModels.length;
			}
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (filteredModels.length > 0) {
				highlightedIndex = (highlightedIndex - 1 + filteredModels.length) % filteredModels.length;
			}
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			if (filteredModels.length > 0 && highlightedIndex < filteredModels.length) {
				handleSelect(filteredModels[highlightedIndex]);
			}
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
				<span class="selection-capabilities" aria-label="Capacità del modello">
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
						<span class="capability-icon" title="Supporta immagini" aria-label="Supporta immagini">
							<IconRoleVision />
						</span>
					{/if}
					{#if selectedModel.reasoning}
						<span class="capability-icon" title="Supporta reasoning" aria-label="Supporta reasoning">
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
		<div class="picker-dropdown" transition:fade={{ duration: 120 }}>
			<div class="search-box">
				<svg class="search-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4">
					<circle cx="7" cy="7" r="4.5" />
					<path d="M10.5 10.5L14 14" stroke-linecap="round" />
				</svg>
				<input
					type="text"
					bind:this={inputRef}
					bind:value={filterQuery}
					placeholder="Cerca modello o provider..."
					aria-label="Filtra modelli disponibili"
					onclick={(e) => e.stopPropagation()}
					oninput={() => highlightedIndex = 0}
					onkeydown={handleKeydown}
				/>
				{#if filterQuery}
					<button type="button" class="clear-btn" aria-label="Cancella testo" onclick={() => { filterQuery = ''; highlightedIndex = 0; }}>
						<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
							<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
						</svg>
					</button>
				{/if}
			</div>

			<div class="results-list" role="listbox" id="picker-listbox" aria-label="Elenco modelli disponibili">
				{#if filteredModels.length === 0}
					<div class="empty-results">
						Nessun modello trovato per "{filterQuery}"
					</div>
				{:else}
					{#each groupedModels as [provider, models] (provider)}
						<div class="provider-group">
							<div class="group-header">
								<span class="group-provider-name">{provider}</span>
								<span class="group-count">{models.length}</span>
							</div>
							<div class="group-items">
								{#each models as m (m.selector)}
									{@const isHighlighted = filteredModels[highlightedIndex]?.selector === m.selector}
									<button
										type="button"
										role="option"
										aria-selected={m.selector === cleanSelector}
										class="model-option"
										class:selected={m.selector === cleanSelector}
										class:highlighted={isHighlighted}
										onclick={() => handleSelect(m)}
									>
										<div class="option-main">
											<span class="option-name">{m.name}</span>
											<span class="option-id">{m.id}</span>
										</div>
										<div class="option-badges">
											{#if m.contextWindow}
												<span class="ctx-chip">{formatContext(m.contextWindow)} ctx</span>
											{/if}
											{#if m.input?.includes('image')}
												<span class="cap-chip">Vision</span>
											{/if}
											{#if m.reasoning}
												<span class="cap-chip">Reasoning</span>
											{/if}
											{#if m.isCustom}
												<span class="custom-chip">Custom</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>
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

	.picker-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 320px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.search-box {
		display: flex;
		align-items: center;
		position: relative;
		padding: var(--space-2);
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
	}

	.search-icon {
		position: absolute;
		left: 14px;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.search-box input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 24px 4px 26px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
	}

	.search-box input:focus {
		border-color: var(--brand);
	}

	.clear-btn {
		position: absolute;
		right: 12px;
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
	}

	.results-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.provider-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 3px 6px;
		font-size: 10px;
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.group-items {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.model-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 5px 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.model-option:hover,
	.model-option.highlighted {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.model-option.selected {
		background: var(--bg-active);
		border-color: var(--brand);
	}

	.option-main {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.option-name {
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.option-id {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.option-badges {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.ctx-chip {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.cap-chip {
		font-size: 9px;
		font-weight: 500;
		color: var(--ink-muted);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.custom-chip {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 600;
		color: var(--brand-ink);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.empty-results {
		padding: var(--space-4) var(--space-2);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
</style>
