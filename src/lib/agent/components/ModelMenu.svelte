<script lang="ts">
	/**
	 * Menu di selezione modello con ricerca, raggruppamento per provider
	 * e indicazione delle capacita (immagini, reasoning, finestra di contesto).
	 */
	import type { ModelInfo } from '$lib/agent/wire';
	import { modelSupportsImages, modelSupportsReasoning } from '$lib/agent/wire';
	import { IconSearch, IconCheck, IconViewPreview, IconBrain } from '$lib/icons';
	import { formatTokens } from '$lib/utils/format';
	import { m } from '$lib/paraglide/messages.js';

	let {
		models = [],
		currentModelId = '',
		onPick
	} = $props<{
		models: ModelInfo[];
		currentModelId?: string;
		onPick: (model: ModelInfo) => void;
	}>();

	let searchQuery = $state('');
	let selectedIndex = $state(0);
	let searchInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		searchInputEl?.focus();
	});

	// Filtro e ordinamento dei modelli
	const filteredModels = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return models;
		return models.filter((mm: ModelInfo) => {
			const mName = (mm.name || '').toLowerCase();
			const mId = (mm.id || '').toLowerCase();
			const mProv = (mm.provider || '').toLowerCase();
			return mName.includes(q) || mId.includes(q) || mProv.includes(q);
		});
	});

	// Raggruppamento per provider
	const groupedByProvider = $derived.by(() => {
		const groups = new Map<string, ModelInfo[]>();
		for (const model of filteredModels) {
			const provider = model.provider || 'Altri';
			const list = groups.get(provider) ?? [];
			list.push(model);
			groups.set(provider, list);
		}
		return groups;
	});

	const flatList = $derived(filteredModels);

	function handleKeyDown(e: KeyboardEvent) {
		if (flatList.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(flatList.length - 1, selectedIndex + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(0, selectedIndex - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const target = flatList[selectedIndex];
			if (target) onPick(target);
		}
	}
</script>

<div class="model-menu-container">
	<div class="search-box">
		<IconSearch size={14} class="search-icon" />
		<input
			bind:this={searchInputEl}
			type="text"
			bind:value={searchQuery}
			onkeydown={handleKeyDown}
			placeholder={m.chat_v2_composer_model_search()}
			class="search-input"
		/>
	</div>

	<div class="model-list" role="listbox">
		{#if groupedByProvider.size === 0}
			<div class="empty-notice">
				{m.chat_v2_composer_model_empty()}
			</div>
		{:else}
			{#each [...groupedByProvider.entries()] as [provider, providerModels]}
				<div class="provider-section">
					<div class="provider-header">{provider}</div>
					{#each providerModels as model}
						{@const isSelected = model.id === currentModelId}
						{@const isFocused = flatList[selectedIndex]?.id === model.id}
						<button
							type="button"
							role="option"
							aria-selected={isSelected}
							class="model-item"
							class:active={isSelected}
							class:focused={isFocused}
							onclick={() => onPick(model)}
							onmouseenter={() => {
								const idx = flatList.findIndex((x: ModelInfo) => x.id === model.id);
								if (idx !== -1) selectedIndex = idx;
							}}
						>
							<div class="model-info">
								<span class="model-name">{model.name || model.id}</span>
								{#if model.id && model.name && model.id !== model.name}
									<span class="model-id">{model.id}</span>
								{/if}
							</div>

							<div class="model-meta">
								{#if modelSupportsImages(model)}
									<span class="meta-icon" title={m.chat_v2_composer_model_vision()}>
										<IconViewPreview size={13} />
									</span>
								{/if}
								{#if modelSupportsReasoning(model)}
									<span class="meta-icon" title={m.chat_v2_composer_model_reasoning()}>
										<IconBrain size={13} />
									</span>
								{/if}
								{#if model.contextWindow}
									<span class="context-pill">
										{formatTokens(model.contextWindow)}
									</span>
								{/if}
								{#if isSelected}
									<span class="check-icon"><IconCheck size={14} /></span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/each}
		{/if}
	</div>

	<div class="menu-footer">
		<span class="legend-item"><IconViewPreview size={12} /> {m.chat_v2_composer_model_vision()}</span>
		<span class="legend-item"><IconBrain size={12} /> {m.chat_v2_composer_model_reasoning()}</span>
		<span class="legend-item">· {m.chat_v2_composer_model_context()}</span>
	</div>
</div>

<style>
	.model-menu-container {
		display: flex;
		flex-direction: column;
		width: 340px;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--line);
		color: var(--ink-faint);
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--ink);
	}

	.model-list {
		padding: var(--space-1);
		max-height: 280px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.provider-section {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.provider-header {
		padding: var(--space-1) var(--space-2) 2px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.model-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.model-item:hover,
	.model-item.focused {
		background: var(--bg-hover);
	}

	.model-item.active {
		background: var(--bg-hover);
		font-weight: 500;
	}

	.model-info {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.model-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink);
	}

	.model-id {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.meta-icon {
		color: var(--ink-faint);
		display: inline-flex;
		align-items: center;
	}

	.context-pill {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-muted);
		padding: 1px 4px;
		background: var(--bg-base);
		border-radius: var(--radius-sm);
	}

	.check-icon {
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
	}

	.empty-notice {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.menu-footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
		font-size: 11px;
		color: var(--ink-faint);
		border-bottom-left-radius: var(--radius-lg);
		border-bottom-right-radius: var(--radius-lg);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
</style>
