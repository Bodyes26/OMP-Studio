<script lang="ts" generics="T extends SharedModelItem = SharedModelItem">
	import { m } from '$lib/paraglide/messages.js';
	import { IconContextWindow, IconRoleSlow, IconRoleVision, IconCheck, IconSearch, IconClose } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		type SharedModelItem,
		getEffectiveSelector,
		isSameModel,
		modelSupportsVision,
		modelSupportsReasoning,
		thinkingTitle,
		formatContextTokens,
		filterAndGroupModels
	} from './modelPicker';

	let {
		catalog = [],
		value = '',
		placeholder = m.models_picker_search_placeholder(),
		autoFocus = true,
		showFooter = false,
		onSelect,
		onClose
	} = $props<{
		catalog: T[];
		value?: string;
		placeholder?: string;
		autoFocus?: boolean;
		showFooter?: boolean;
		onSelect?: (selector: string, model: T) => void;
		onClose?: () => void;
	}>();

	let searchQuery = $state('');
	let highlightedIndex = $state(0);
	let searchInputEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (autoFocus) {
			const timer = setTimeout(() => searchInputEl?.focus(), 40);
			return () => clearTimeout(timer);
		}
	});

	const groupedResult = $derived(filterAndGroupModels<T>(catalog, searchQuery));
	const groupedModels = $derived(groupedResult.groupedModels);
	const visibleModels = $derived(groupedResult.visibleModels);

	// Scorrimento automatico per rivelare la voce attiva nella lista
	$effect(() => {
		if (!listEl) return;
		const index = highlightedIndex;
		if (index < 0 || visibleModels.length === 0) return;
		const targetOption = listEl.querySelector<HTMLElement>(`[data-index="${index}"]`);
		if (targetOption && typeof targetOption.scrollIntoView === 'function') {
			targetOption.scrollIntoView({ block: 'nearest' });
		}
	});

	function cleanSelectorValue(raw: string): string {
		if (!raw) return '';
		const lastColon = raw.lastIndexOf(':');
		if (lastColon !== -1) {
			const candidate = raw.slice(lastColon + 1);
			if (['off', 'low', 'medium', 'high', 'max', 'auto'].includes(candidate)) {
				return raw.slice(0, lastColon);
			}
		}
		return raw;
	}

	function isSelected(model: T): boolean {
		if (!value) return false;
		const clean = cleanSelectorValue(value);
		const sel = model.selector || '';
		const id = model.id || '';
		const combined = model.provider && id ? `${model.provider}/${id}` : '';

		// Se il valore include il provider (es. "openai/gpt-6.1"), rispetta l'identità del provider
		if (clean.includes('/')) {
			return sel === clean || combined === clean || sel === value || combined === value;
		}

		return Boolean((sel && (sel === value || sel === clean)) || (id && (id === value || id === clean)));
	}

	function chooseModel(model: T) {
		const selector = getEffectiveSelector(model);
		onSelect?.(selector, model);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onClose?.();
			return;
		}

		if (visibleModels.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			highlightedIndex = (highlightedIndex + 1) % visibleModels.length;
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			highlightedIndex = (highlightedIndex - 1 + visibleModels.length) % visibleModels.length;
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (highlightedIndex >= 0 && highlightedIndex < visibleModels.length) {
				chooseModel(visibleModels[highlightedIndex]);
			}
		}
	}
</script>

<div class="model-picker-list" data-testid="model-picker-list">
	<div class="search-box">
		<span class="search-icon" aria-hidden="true">
			<IconSearch />
		</span>
		<input
			bind:this={searchInputEl}
			type="text"
			bind:value={searchQuery}
			{placeholder}
			aria-label={placeholder}
			class="search-input"
			onclick={(e) => e.stopPropagation()}
			oninput={() => (highlightedIndex = 0)}
			onkeydown={handleKeydown}
		/>
		{#if searchQuery}
			<button
				type="button"
				class="clear-btn"
				aria-label={m.model_picker_list_clear_search()}
				onclick={() => {
					searchQuery = '';
					highlightedIndex = 0;
					searchInputEl?.focus();
				}}
			>
				<IconClose />
			</button>
		{/if}
	</div>

	<div
		class="results-list"
		role="listbox"
		id="picker-listbox"
		aria-label={m.model_picker_list_available_models()}
		bind:this={listEl}
	>
		{#if visibleModels.length === 0}
			<div class="empty-results">
				{m.chat_v2_composer_model_empty()}
			</div>
		{:else}
			{#each groupedModels as [provider, models] (provider)}
				<div class="provider-group">
					<div class="group-header">
						<span class="group-provider-name">{provider}</span>
						<span class="group-count">{models.length}</span>
					</div>
					<div class="group-items">
						{#each models as model (getEffectiveSelector(model))}
							{@const selected = isSelected(model)}
							{@const idx = visibleModels.findIndex((x) => isSameModel(x, model))}
							{@const isHighlighted = highlightedIndex === idx}
							<button
								type="button"
								role="option"
								data-index={idx}
								aria-selected={selected}
								class="model-option"
								class:selected
								class:highlighted={isHighlighted}
								onclick={() => chooseModel(model)}
								onmouseenter={() => {
									if (idx !== -1) highlightedIndex = idx;
								}}
							>
								<div class="option-main">
									<span class="option-name">{model.name || model.id}</span>
									{#if model.id && model.name && model.id !== model.name}
										<span class="option-id">{model.id}</span>
									{:else if model.selector && model.selector !== model.name}
										<span class="option-id">{model.selector}</span>
									{/if}
								</div>

								<div class="option-badges">
									{#if model.contextWindow}
										<Tooltip text={m.model_picker_list_context_tooltip({ tokens: formatContextTokens(model.contextWindow) })} placement="top">
											<span
												class="ui-cap ctx"
												role="img"
												aria-label={m.model_picker_list_context_aria({ tokens: formatContextTokens(model.contextWindow) })}
											>
												<IconContextWindow />
												<small>{formatContextTokens(model.contextWindow)}</small>
											</span>
										</Tooltip>
									{/if}
									{#if modelSupportsVision(model)}
										<Tooltip text={m.chat_v2_composer_model_vision()} placement="top">
											<span
												class="ui-cap"
												role="img"
												aria-label={m.chat_v2_composer_model_vision()}
											>
												<IconRoleVision />
											</span>
										</Tooltip>
									{/if}
									{#if modelSupportsReasoning(model)}
										<Tooltip text={thinkingTitle(model)} placement="top">
											<span
												class="ui-cap"
												role="img"
												aria-label={thinkingTitle(model)}
											>
												<IconRoleSlow />
											</span>
										</Tooltip>
									{/if}
									{#if model.isCustom}
										<span class="custom-chip">{m.model_picker_list_custom_badge()}</span>
									{/if}
									{#if selected}
										<span class="check-icon" aria-hidden="true">
											<IconCheck />
										</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	{#if showFooter}
		<div class="menu-footer">
			<span class="legend-item"><IconRoleVision /> {m.chat_v2_composer_model_vision()}</span>
			<span class="legend-item"><IconRoleSlow /> {m.chat_v2_composer_model_reasoning()}</span>
			<span class="legend-item">· {m.chat_v2_composer_model_context()}</span>
		</div>
	{/if}
</div>

<style>
	.model-picker-list {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
		color: var(--ink);
		background: transparent;
	}

	.search-box {
		flex-shrink: 0;
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
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
	}

	.search-input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 4px 24px 4px 26px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.search-input:focus-visible {
		border-color: var(--brand);
		outline: 2px solid var(--brand);
		outline-offset: -1px;
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
		--icon-size: 10px;
	}
	.results-list {
		flex: 1;
		min-height: 0;
		max-height: 280px;
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
		font-size: var(--text-group-label);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
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
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		font-family: var(--font-ui);
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}
	.model-option:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}


	.model-option:hover,
	.model-option.highlighted {
		background: var(--bg-hover);
		border-color: var(--line);
	}

	.model-option.selected {
		background: var(--bg-active);
		border-color: var(--brand);
		font-weight: 500;
	}

	.option-main {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
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
		font-size: var(--text-caption);
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

	.custom-chip {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--brand-ink);
		background: var(--bg-base);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}

	.check-icon {
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.empty-results {
		padding: var(--space-4) var(--space-2);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.menu-footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-md);
		border-bottom-right-radius: var(--radius-md);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		--icon-size: 12px;
	}
</style>
