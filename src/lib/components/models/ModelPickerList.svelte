<script lang="ts" generics="T extends SharedModelItem = SharedModelItem">
	import { m } from '#lib/paraglide/messages.js';
	import { IconContextWindow, IconRoleSlow, IconRoleVision, IconCheck, IconSearch, IconClose, IconChevronDown, IconHistory } from '#lib/icons.ts';
	import ProviderLogo from './ProviderLogo.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
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
	import { recentModelsStore, resolveRecentModels } from './recentModels.svelte';
	import { matchesLooseQuery } from '../../looseSearch.ts';

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
	let collapsedProviders = $state<Record<string, boolean>>({});
	let isRecentCollapsed = $state(false);

	$effect(() => {
		if (value && recentModelsStore.selectors.length === 0) {
			recentModelsStore.record(value);
		}
	});

	$effect(() => {
		if (autoFocus) {
			const timer = setTimeout(() => searchInputEl?.focus(), 40);
			return () => clearTimeout(timer);
		}
	});

	const q = $derived(searchQuery.trim());
	const resolvedRecent = $derived(resolveRecentModels<T>(catalog, recentModelsStore.selectors));

	// Modelli recenti che corrispondono alla query
	const matchingRecent = $derived.by(() => {
		if (resolvedRecent.length === 0) return [];
		if (!q) return resolvedRecent;
		return resolvedRecent.filter((m) =>
			matchesLooseQuery(
				q,
				m.name,
				m.id,
				m.provider,
				m.selector || (m.provider && m.id ? `${m.provider}/${m.id}` : m.id)
			)
		);
	});

	// Se stiamo cercando, escludiamo dai provider gli elementi gia mostrati nei recenti
	const catalogForProviders = $derived.by(() => {
		if (!q || matchingRecent.length === 0) return catalog;
		return catalog.filter((m: T) => !matchingRecent.some((r: T) => isSameModel(r, m)));
	});

	const groupedResult = $derived(filterAndGroupModels<T>(catalogForProviders, q));
	const groupedModels = $derived(groupedResult.groupedModels);

	// Modelli effettivamente visibili a schermo per navigazione con frecce
	const visibleModels = $derived.by(() => {
		const result: T[] = [];
		if (matchingRecent.length > 0 && (!isRecentCollapsed || q)) {
			result.push(...matchingRecent);
		}
		for (const [provider, models] of groupedModels) {
			const isCollapsed = Boolean(collapsedProviders[provider]) && !q;
			if (!isCollapsed) {
				result.push(...models);
			}
		}
		return result;
	});

	// Mappa indice opzione -> indice in visibleModels per keyboard & scroll
	const modelIndexMap = $derived.by(() => {
		const map = new Map<string, number>();
		let idx = 0;
		if (matchingRecent.length > 0 && (!isRecentCollapsed || q)) {
			for (const m of matchingRecent) {
				map.set(`recent:${getEffectiveSelector(m)}`, idx++);
			}
		}
		for (const [provider, models] of groupedModels) {
			const isCollapsed = Boolean(collapsedProviders[provider]) && !q;
			if (!isCollapsed) {
				for (const m of models) {
					map.set(`${provider}:${getEffectiveSelector(m)}`, idx++);
				}
			}
		}
		return map;
	});
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
		recentModelsStore.record(model);
		onSelect?.(selector, model);
	}

	function toggleProvider(provider: string) {
		collapsedProviders[provider] = !collapsedProviders[provider];
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
			{#if matchingRecent.length > 0}
				{@const isCollapsed = isRecentCollapsed && !q}
				<div class="provider-group recent-group">
					<button
						type="button"
						class="group-header"
						onclick={() => (isRecentCollapsed = !isRecentCollapsed)}
						aria-expanded={!isCollapsed}
					>
						<span class="group-provider-title">
							<span class="group-collapse-icon" class:collapsed={isCollapsed}>
								<IconChevronDown />
							</span>
							<span class="recent-icon"><IconHistory /></span>
							<span class="group-provider-name">{m.chat_v2_composer_model_recent()}</span>
						</span>
						<span class="group-count">{matchingRecent.length}</span>
					</button>
					{#if !isCollapsed}
						<div class="group-items">
							{#each matchingRecent as model (getEffectiveSelector(model))}
								{@const idx = modelIndexMap.get(`recent:${getEffectiveSelector(model)}`) ?? -1}
								{@render modelOption(model, idx, true)}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#each groupedModels as [provider, models] (provider)}
				{@const isCollapsed = Boolean(collapsedProviders[provider]) && !q}
				<div class="provider-group">
					<button
						type="button"
						class="group-header"
						onclick={() => toggleProvider(provider)}
						aria-expanded={!isCollapsed}
					>
						<span class="group-provider-title">
							<span class="group-collapse-icon" class:collapsed={isCollapsed}>
								<IconChevronDown />
							</span>
							<ProviderLogo {provider} size={13} />
							<span class="group-provider-name">{provider}</span>
						</span>
						<span class="group-count">{models.length}</span>
					</button>
					{#if !isCollapsed}
						<div class="group-items">
							{#each models as model (getEffectiveSelector(model))}
								{@const idx = modelIndexMap.get(`${provider}:${getEffectiveSelector(model)}`) ?? -1}
								{@render modelOption(model, idx, false)}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	{#if showFooter}
		<div class="menu-footer">
			<span class="legend-item"><IconRoleVision /> {m.chat_v2_composer_model_vision()}</span>
			<span class="legend-item"><IconRoleSlow /> {m.chat_v2_composer_model_reasoning()}</span>
			<span class="legend-item"><IconContextWindow /> {m.chat_v2_composer_model_context()}</span>
		</div>
	{/if}
</div>
{#snippet modelOption(model: T, idx: number, isRecent: boolean)}
	{@const selected = isSelected(model)}
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
			<span class="option-name">
				{#if isRecent && model.provider}
					<ProviderLogo provider={model.provider} size={12} />
				{/if}
				<span>{model.name || model.id}</span>
			</span>
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
{/snippet}


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
		height: 38px;
		padding: 0 10px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--ink-faint);
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		--icon-size: 13px;
	}

	.search-input {
		width: 100%;
		height: 100%;
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 0 28px 0 28px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
		outline: none;
	}

	.search-input:focus,
	.search-input:focus-visible {
		outline: none;
		box-shadow: none;
		border: none;
	}

	.clear-btn {
		position: absolute;
		right: 10px;
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
		max-height: 360px;
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
		padding: 4px 6px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--text-group-label);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.group-header:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.group-collapse-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 11px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.group-collapse-icon.collapsed {
		transform: rotate(-90deg);
	}

	.recent-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		--icon-size: 13px;
		color: var(--brand-ink);
	}

	.group-provider-title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
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
		display: inline-flex;
		align-items: center;
		gap: 5px;
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
