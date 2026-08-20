<script lang="ts">
	import { modelSettingsStore, type ModelDto } from '$lib/stores/modelSettings.svelte';
	import ModelPickerDropdown from './ModelPickerDropdown.svelte';
	import { slide } from 'svelte/transition';

	let {
		open = true,
		onClose
	} = $props<{
		open?: boolean;
		onClose?: () => void;
	}>();

	let isAdding = $state(false);

	const cycle = $derived(modelSettingsStore.draftConfig?.cycleOrder || []);

	function getModel(selector: string): ModelDto | undefined {
		const raw = selector.split(':')[0];
		return modelSettingsStore.catalog.find((m) => m.selector === raw || m.id === raw);
	}

	function handleAddSelect(selector: string) {
		modelSettingsStore.addToCycle(selector);
		isAdding = false;
	}

	function move(index: number, delta: number) {
		const toIndex = index + delta;
		modelSettingsStore.moveCycleItem(index, toIndex);
	}

	function remove(index: number) {
		modelSettingsStore.removeFromCycle(index);
	}
</script>

{#if open}
	<aside class="cycle-drawer" transition:slide={{ duration: 180, axis: 'x' }}>
		<div class="drawer-header">
			<div class="drawer-title-row">
				<svg class="cycle-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
					<path d="M2 8a6 6 0 0 1 10.2-4.2M14 8a6 6 0 0 1-10.2 4.2" stroke-linecap="round" />
					<path d="M12.5 1v3h-3M3.5 15v-3h3" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span class="drawer-title">Ciclo Rapido</span>
				<kbd class="shortcut-badge">Ctrl+P</kbd>
			</div>

			<button
				type="button"
				class="btn-close-drawer"
				onclick={onClose}
				aria-label="Chiudi pannello ciclo"
				title="Chiudi pannello ciclo rapido"
			>
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
					<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
				</svg>
			</button>
		</div>

		<div class="drawer-content">
			<p class="drawer-desc">
				Premendo la scorciatoia, il modello attivo avanza sequenzialmente in questa lista circolare senza aprire il catalogo.
			</p>

			<!-- Cycle Items List -->
			<div class="cycle-list">
				{#each cycle as item, i (item + i)}
					{@const model = getModel(item)}
					<div class="cycle-item" class:first-item={i === 0}>
						<span class="item-order">#{i + 1}</span>
						
						<div class="item-info">
							<span class="item-name">{model?.name || item.split('/')[1] || item}</span>
							{#if model}
								<span class="item-provider">{model.provider}</span>
							{/if}
						</div>

						<div class="item-actions">
							<button
								type="button"
								class="btn-action"
								disabled={i === 0}
								onclick={() => move(i, -1)}
								title="Sposta prima"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
									<path d="M3.5 10L8 5.5l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</button>
							<button
								type="button"
								class="btn-action"
								disabled={i === cycle.length - 1}
								onclick={() => move(i, 1)}
								title="Sposta dopo"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
									<path d="M3.5 6L8 10.5l4.5-4.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</button>
							<button
								type="button"
								class="btn-action delete"
								onclick={() => remove(i)}
								title="Rimuovi dal ciclo"
							>
								<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6">
									<path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" />
								</svg>
							</button>
						</div>
					</div>
				{/each}

				{#if cycle.length === 0}
					<div class="empty-cycle">
						Nessun modello inserito nel ciclo rapido.
					</div>
				{/if}
			</div>

			<!-- Add Model to Cycle -->
			<div class="add-cycle-section">
				{#if isAdding}
					<div class="inline-picker">
						<ModelPickerDropdown
							catalog={modelSettingsStore.catalog}
							placeholder="Scegli modello per ciclo..."
							onSelect={(sel) => handleAddSelect(sel)}
						/>
						<button
							type="button"
							class="btn-cancel"
							onclick={() => isAdding = false}
						>
							Annulla
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="btn-add-cycle"
						onclick={() => isAdding = true}
					>
						+ Aggiungi Modello al Ciclo
					</button>
				{/if}
			</div>

			<!-- Preview flow -->
			{#if cycle.length > 0}
				<div class="preview-box">
					<div class="preview-label">Anteprima Sequenza</div>
					<div class="preview-flow">
						{#each cycle as item, idx}
							{@const model = getModel(item)}
							<span class="preview-node" class:current-start={idx === 0}>
								{model?.name || item.split('/')[1] || item}
							</span>
							{#if idx < cycle.length - 1}
								<span class="preview-arrow">→</span>
							{/if}
						{/each}
						<span class="preview-loop" title="Ciclo continuo">↺</span>
					</div>
				</div>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.cycle-drawer {
		width: 270px;
		flex-shrink: 0;
		border-left: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg-sunken) 70%, var(--bg-base));
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg-base) 60%, transparent);
	}

	.drawer-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cycle-icon {
		color: var(--brand-ink);
	}

	.drawer-title {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.shortcut-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		color: var(--ink-muted);
	}

	.btn-close-drawer {
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.btn-close-drawer:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.drawer-content {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.drawer-desc {
		font-size: 11px;
		color: var(--ink-faint);
		line-height: 1.45;
		margin: 0;
	}

	.cycle-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.cycle-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		transition: border-color 120ms ease;
	}

	.cycle-item.first-item {
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-base));
	}

	.item-order {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--brand-ink);
		font-weight: 600;
		width: 18px;
		flex-shrink: 0;
	}

	.item-info {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.item-name {
		font-size: 11.5px;
		font-family: var(--font-mono);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-provider {
		font-size: 10px;
		color: var(--ink-faint);
		text-transform: capitalize;
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0.6;
		transition: opacity 120ms ease;
	}

	.cycle-item:hover .item-actions {
		opacity: 1;
	}

	.btn-action {
		width: 20px;
		height: 20px;
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		transition: all 120ms ease;
	}

	.btn-action:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-action.delete:hover:not(:disabled) {
		color: var(--warn);
	}

	.btn-action:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.empty-cycle {
		padding: 12px;
		font-size: 11px;
		color: var(--ink-faint);
		text-align: center;
		background: var(--bg-base);
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
	}

	.add-cycle-section {
		display: flex;
		flex-direction: column;
	}

	.btn-add-cycle {
		padding: 6px 10px;
		background: transparent;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		font-size: 11px;
		cursor: pointer;
		transition: all 120ms ease;
		text-align: center;
	}

	.btn-add-cycle:hover {
		border-color: var(--brand-ink);
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 6%, transparent);
	}

	.inline-picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.btn-cancel {
		align-self: flex-end;
		padding: 3px 8px;
		font-size: 11px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
	}

	.btn-cancel:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.preview-box {
		padding: 8px 10px;
		background: color-mix(in srgb, var(--bg-base) 80%, var(--bg-sunken));
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}

	.preview-label {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
		margin-bottom: 6px;
		font-weight: 600;
	}

	.preview-flow {
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}

	.preview-node {
		color: var(--ink-muted);
	}

	.preview-node.current-start {
		color: var(--brand-ink);
		font-weight: 600;
	}

	.preview-arrow {
		color: var(--ink-faint);
	}

	.preview-loop {
		color: var(--brand-ink);
		font-size: 12px;
	}
</style>
