<!--
  ModelPicker.svelte — Menu di selezione del modello per la corsia.
  Ricerca veloce e raggruppamento per provider, fedele a src/lib/components/models/ModelPickerList.svelte di Studio.
-->
<script lang="ts">
	import type { RemoteModelOption } from '../../../../src/protocol.ts';
	import { IconCheck, IconClose, IconSearch } from '../../icons.ts';
	import { t } from '../../i18n.ts';

	let {
		models = [],
		activeProvider = null,
		activeModelId = null,
		onSelect
	}: {
		models: RemoteModelOption[];
		activeProvider?: string | null;
		activeModelId?: string | null;
		onSelect: (provider: string, modelId: string) => void;
	} = $props();

	let searchQuery = $state('');
	let searchInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (searchInputEl) {
			searchInputEl.focus();
		}
	});

	const filteredModels = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return models;
		return models.filter(
			(m) =>
				m.name.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q)
		);
	});

	const groupedModels = $derived.by(() => {
		const groups: Record<string, RemoteModelOption[]> = {};
		for (const m of filteredModels) {
			if (!groups[m.provider]) {
				groups[m.provider] = [];
			}
			groups[m.provider].push(m);
		}
		return Object.entries(groups);
	});
</script>

<div class="model-picker-container">
	<!-- Casella di ricerca -->
	<div class="search-box">
		<span class="search-icon" aria-hidden="true">
			<IconSearch />
		</span>
		<input
			bind:this={searchInputEl}
			type="text"
			bind:value={searchQuery}
			placeholder={t('modelPickerSearch')}
			aria-label={t('modelPickerSearch')}
			class="search-input"
		/>
		{#if searchQuery}
			<button
				type="button"
				class="clear-btn"
				onclick={() => {
					searchQuery = '';
					searchInputEl?.focus();
				}}
				aria-label={t('close')}
			>
				<IconClose />
			</button>
		{/if}
	</div>

	<!-- Elenco modelli per provider -->
	<div class="model-list" role="listbox">
		{#if filteredModels.length === 0}
			<div class="empty-state">
				<span>{t('modelPickerEmpty')}</span>
			</div>
		{:else}
			{#each groupedModels as [provider, list] (provider)}
				<div class="provider-group">
					<div class="provider-header font-mono">
						{provider.toUpperCase()}
					</div>
					{#each list as item (item.provider + '/' + item.id)}
						{@const active =
							(activeProvider === item.provider && activeModelId === item.id) ||
							(!activeProvider && activeModelId === item.id)}
						<button
							type="button"
							role="option"
							aria-selected={active}
							class="model-row"
							class:active
							onclick={() => onSelect(item.provider, item.id)}
						>
							<div class="model-info">
								<span class="model-name">{item.name}</span>
								<span class="model-id font-mono">{item.id}</span>
							</div>

							{#if active}
								<span class="check-icon" aria-hidden="true">
									<IconCheck />
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.model-picker-container {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
	}

	.search-icon {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		--icon-size: 16px;
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.search-input::placeholder {
		color: var(--ink-faint);
	}

	.clear-btn {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		--icon-size: 14px;
	}

	.clear-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.model-list {
		padding: var(--space-1);
		max-height: 340px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.empty-state {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.provider-group {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.provider-header {
		padding: 4px 8px 2px;
		font-size: var(--text-group-label);
		font-weight: 600;
		color: var(--ink-faint);
		letter-spacing: 0.05em;
	}

	.model-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 7px 10px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--ink);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		width: 100%;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.model-row:hover,
	.model-row.active {
		background: var(--bg-hover);
	}

	.model-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.model-name {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-id {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.check-icon {
		display: grid;
		place-items: center;
		color: var(--brand-ink);
		--icon-size: 16px;
		flex-shrink: 0;
	}
</style>
