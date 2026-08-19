<script lang="ts">
	import type { ModelDto } from '$lib/stores/modelSettings.svelte';
	import { fade } from 'svelte/transition';

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
	let dropdownRef = $state<HTMLDivElement | null>(null);
	let inputRef = $state<HTMLInputElement | null>(null);

	// Estrai il selector pulito (senza :thinkingLevel)
	const cleanSelector = $derived(value ? value.split(':')[0] : '');

	const selectedModel = $derived.by(() => {
		if (!cleanSelector) return null;
		return (catalog as ModelDto[]).find((m: ModelDto) => m.selector === cleanSelector) || null;
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

	// Raggruppa per provider per una navigazione ordinata
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
			setTimeout(() => inputRef?.focus(), 50);
		}
	}

	function handleSelect(m: ModelDto) {
		isOpen = false;
		onSelect?.(m.selector, m);
	}

	function formatContext(tokens?: number) {
		if (!tokens) return '';
		if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M ctx`;
		if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`;
		return `${tokens} ctx`;
	}

	function handleDocClick(e: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleDocClick} />

<div class="picker-container" bind:this={dropdownRef}>
	<button
		type="button"
		class="picker-trigger"
		class:active={isOpen}
		class:has-value={!!selectedModel}
		{disabled}
		onclick={(e) => { e.stopPropagation(); toggleOpen(); }}
	>
		{#if selectedModel}
			<span class="trigger-content">
				<span class="provider-badge" data-provider={selectedModel.provider}>{selectedModel.provider}</span>
				<span class="model-name" title={selectedModel.selector}>{selectedModel.name}</span>
				{#if selectedModel.contextWindow}
					<span class="ctx-chip">{formatContext(selectedModel.contextWindow)}</span>
				{/if}
				{#if selectedModel.input?.includes('image')}
					<span class="cap-icon" title="Supporto Vision / Immagini">👁️</span>
				{/if}
				{#if selectedModel.reasoning}
					<span class="cap-icon" title="Supporto Reasoning / Thinking">🧠</span>
				{/if}
			</span>
		{:else if cleanSelector}
			<span class="trigger-content">
				<span class="provider-badge">custom</span>
				<span class="model-name">{cleanSelector}</span>
			</span>
		{:else}
			<span class="placeholder">{placeholder}</span>
		{/if}
		<span class="chevron" class:rotated={isOpen}>▾</span>
	</button>

	{#if isOpen}
		<div class="picker-dropdown" transition:fade={{ duration: 120 }}>
			<div class="search-box">
				<input
					type="text"
					bind:this={inputRef}
					bind:value={filterQuery}
					placeholder="Cerca modello o provider..."
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							isOpen = false;
						}
					}}
				/>
				{#if filterQuery}
					<button class="clear-btn" onclick={() => filterQuery = ''}>✕</button>
				{/if}
			</div>

			<div class="results-list">
				{#each groupedModels as [provider, models] (provider)}
					<div class="provider-group">
						<div class="group-header">
							<span class="provider-badge" data-provider={provider}>{provider}</span>
							<span class="group-count">{models.length}</span>
						</div>
						<div class="group-items">
							{#each models as m (m.selector)}
								<button
									type="button"
									class="model-option"
									class:selected={m.selector === cleanSelector}
									onclick={() => handleSelect(m)}
								>
									<div class="option-main">
										<span class="option-name">{m.name}</span>
										<span class="option-id">{m.id}</span>
									</div>
									<div class="option-badges">
										{#if m.contextWindow}
											<span class="ctx-chip">{formatContext(m.contextWindow)}</span>
										{/if}
										{#if m.input?.includes('image')}
											<span class="cap-icon" title="Vision">👁️</span>
										{/if}
										{#if m.reasoning}
											<span class="cap-icon" title="Reasoning">🧠</span>
										{/if}
										{#if m.isCustom}
											<span class="custom-chip">Custom</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div class="empty-results">
						Nessun modello trovato per "{filterQuery}"
					</div>
				{/each}
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
		padding: 6px 10px;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.picker-trigger:hover:not(:disabled) {
		border-color: var(--line-strong);
		background: var(--bg-hover);
	}

	.picker-trigger.active {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand);
	}

	.picker-trigger:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.trigger-content {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		flex: 1;
	}

	.placeholder {
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}

	.model-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink);
	}

	.provider-badge {
		font-size: 10px;
		font-family: var(--font-mono);
		font-weight: 600;
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		color: var(--ink-muted);
		text-transform: lowercase;
		flex-shrink: 0;
	}

	.provider-badge[data-provider="anthropic"] {
		background: rgba(217, 119, 87, 0.15);
		color: #e07a5f;
	}

	.provider-badge[data-provider="openai-codex"],
	.provider-badge[data-provider="openai"] {
		background: rgba(16, 163, 127, 0.15);
		color: #10a37f;
	}

	.provider-badge[data-provider="google-antigravity"],
	.provider-badge[data-provider="google-vertex"],
	.provider-badge[data-provider="google"] {
		background: rgba(66, 133, 244, 0.15);
		color: #4285f4;
	}

	.provider-badge[data-provider="opencode-go"],
	.provider-badge[data-provider="opencode-zen"] {
		background: rgba(139, 92, 246, 0.15);
		color: #8b5cf6;
	}

	.ctx-chip {
		font-size: 10px;
		font-family: var(--font-mono);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-base);
		border: 1px solid var(--line);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.custom-chip {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--brand-dim);
		color: var(--brand);
		flex-shrink: 0;
	}

	.cap-icon {
		font-size: 11px;
		opacity: 0.8;
		flex-shrink: 0;
	}

	.chevron {
		font-size: 12px;
		color: var(--ink-faint);
		transition: transform 0.15s ease;
		flex-shrink: 0;
	}

	.chevron.rotated {
		transform: rotate(180deg);
	}

	.picker-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 360px;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-dialog);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.search-box {
		padding: var(--space-2);
		border-bottom: 1px solid var(--line);
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-raised);
	}

	.search-box input {
		width: 100%;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 6px 10px;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--ink);
		outline: none;
	}

	.search-box input:focus {
		border-color: var(--brand);
	}

	.clear-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: 12px;
		padding: 4px;
	}

	.clear-btn:hover {
		color: var(--ink);
	}

	.results-list {
		flex: 1;
		overflow-y: auto;
		max-height: 300px;
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		gap: 6px;
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
		padding: 4px 8px;
		border-bottom: 1px solid var(--line);
		margin-bottom: 2px;
	}

	.group-count {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--ink-faint);
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
		padding: 6px 8px;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition: background 0.1s ease;
	}

	.model-option:hover {
		background: var(--bg-hover);
	}

	.model-option.selected {
		background: var(--bg-active);
	}

	.option-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.option-name {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.option-id {
		font-size: 10px;
		font-family: var(--font-mono);
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

	.empty-results {
		padding: var(--space-4);
		text-align: center;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
</style>
