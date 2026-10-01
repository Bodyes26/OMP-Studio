<script lang="ts" generics="T extends SharedModelItem = SharedModelItem">
	import { m } from '$lib/paraglide/messages.js';
	import { IconContextWindow, IconRoleSlow, IconRoleVision, IconCheck } from '$lib/icons';
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
		<svg
			class="search-icon"
			viewBox="0 0 16 16"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			aria-hidden="true"
		>
			<circle cx="7" cy="7" r="4.5" />
			<path d="M10.5 10.5L14 14" stroke-linecap="round" />
		</svg>
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
				aria-label="Cancella testo"
				onclick={() => {
					searchQuery = '';
					highlightedIndex = 0;
					searchInputEl?.focus();
				}}
			>
				<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
				</svg>
			</button>
		{/if}
	</div>

	<div
		class="results-list"
		role="listbox"
		id="picker-listbox"
		aria-label="Elenco modelli disponibili"
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
										<span
											class="cap-chip ctx"
											role="img"
											title={`Finestra di contesto: ${formatContextTokens(model.contextWindow)} token`}
											aria-label={`Contesto ${formatContextTokens(model.contextWindow)} token`}
										>
											<IconContextWindow />
											<small>{formatContextTokens(model.contextWindow)}</small>
										</span>
									{/if}
									{#if modelSupportsVision(model)}
										<span
											class="cap-chip vision"
											role="img"
											title={m.chat_v2_composer_model_vision()}
											aria-label={m.chat_v2_composer_model_vision()}
										>
											<IconRoleVision />
										</span>
									{/if}
									{#if modelSupportsReasoning(model)}
										<span
											class="cap-chip thinking"
											role="img"
											title={thinkingTitle(model)}
											aria-label={thinkingTitle(model)}
										>
											<IconRoleSlow />
										</span>
									{/if}
									{#if model.isCustom}
										<span class="custom-chip">Custom</span>
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
	}

	.search-input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 24px 4px 26px;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.search-input:focus {
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
		width: 100%;
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

	.cap-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		background: var(--bg-base);
		color: var(--ink-muted);
		--icon-size: 11px;
	}

	.cap-chip small {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1;
	}

	.cap-chip.ctx {
		color: var(--ink-faint);
	}

	.cap-chip.vision,
	.cap-chip.thinking {
		border-color: var(--line);
		color: var(--ink-muted);
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
