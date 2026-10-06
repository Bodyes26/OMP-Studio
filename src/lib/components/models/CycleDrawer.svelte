<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { modelSettingsStore, resolveCatalogModel, type ModelDto } from '$lib/stores/modelSettings.svelte';
	import {
		IconArrowRight,
		IconLoop,
		IconCycle,
		IconClose,
		IconArrowUp,
		IconArrowDown,
		IconTrash
	} from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import ModelField from './ModelField.svelte';

	let {
		open = true,
		returnFocus,
		onClose
	} = $props<{
		open?: boolean;
		returnFocus?: HTMLElement | null;
		onClose?: () => void;
	}>();

	let isAdding = $state(false);
	let drawerEl = $state<HTMLElement | null>(null);
	let closeBtnEl = $state<HTMLButtonElement | null>(null);

	const cycle = $derived(modelSettingsStore.draftConfig?.cycleOrder || []);

	function getModel(selector: string): ModelDto | undefined {
		return resolveCatalogModel(modelSettingsStore.catalog, selector);
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

	function handleClose() {
		onClose?.();
		returnFocus?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			e.preventDefault();
			handleClose();
		}
	}

	// Gestione del fuoco: all'apertura porta il fuoco sul pannello o sul primo controllo
	$effect(() => {
		if (open) {
			requestAnimationFrame(() => {
				if (closeBtnEl) {
					closeBtnEl.focus();
				} else if (drawerEl) {
					drawerEl.focus();
				}
			});
		}
	});
</script>

<aside
	class="cycle-drawer"
	class:open={open}
	bind:this={drawerEl}
	tabindex="-1"
	onkeydown={handleKeydown}
	aria-hidden={!open}
	inert={!open ? true : undefined}
>
	<div class="drawer-inner">
		<div class="drawer-header">
			<div class="drawer-title-row">
				<span class="cycle-icon"><IconCycle /></span>
				<span class="drawer-title">{m.cycle_drawer_title()}</span>
				<kbd class="ui-kbd">Ctrl+P</kbd>
			</div>

			<button
				type="button"
				class="btn-close-drawer"
				bind:this={closeBtnEl}
				onclick={handleClose}
				aria-label={m.ui_cycledrawer_chiudi_pannello_ciclo_a7be()}
			>
				<IconClose />
			</button>
		</div>

		<div class="drawer-content">
			<p class="drawer-desc">
				{m.ui_cycledrawer_premendo_la_scorciatoia_il_modello_attivo_avanza_8c15()}
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
							<Tooltip text={m.cycle_drawer_move_before()}>
								<button
									type="button"
									class="btn-action"
									disabled={i === 0}
									onclick={() => move(i, -1)}
									aria-label={m.cycle_drawer_move_before()}
								>
									<IconArrowUp />
								</button>
							</Tooltip>
							<Tooltip text={m.cycle_drawer_move_after()}>
								<button
									type="button"
									class="btn-action"
									disabled={i === cycle.length - 1}
									onclick={() => move(i, 1)}
									aria-label={m.cycle_drawer_move_after()}
								>
									<IconArrowDown />
								</button>
							</Tooltip>
							<Tooltip text={m.ui_cycledrawer_rimuovi_dal_ciclo_d1bc()}>
								<button
									type="button"
									class="btn-action delete"
									onclick={() => remove(i)}
									aria-label={m.ui_cycledrawer_rimuovi_dal_ciclo_d1bc()}
								>
									<IconTrash />
								</button>
							</Tooltip>
						</div>
					</div>
				{/each}

				{#if cycle.length === 0}
					<div class="empty-cycle">
						{m.ui_cycledrawer_nessun_modello_inserito_nel_ciclo_rapido_63e4()}
					</div>
				{/if}
			</div>

			<!-- Add Model to Cycle -->
			<div class="add-cycle-section">
				{#if isAdding}
					<div class="inline-picker">
						<ModelField
							catalog={modelSettingsStore.assignableCatalog}
							placeholder={m.models_cycle_placeholder()}
							ariaLabel={m.models_cycle_placeholder()}
							onSelect={(sel) => handleAddSelect(sel)}
						/>
						<button
							type="button"
							class="btn-cancel"
							onclick={() => isAdding = false}
						>
							{m.common_cancel()}
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="btn-add-cycle"
						onclick={() => isAdding = true}
					>
						{m.ui_cycledrawer_aggiungi_modello_al_ciclo_8323()}
					</button>
				{/if}
			</div>

			<!-- Preview flow -->
			{#if cycle.length > 0}
				<div class="preview-box">
					<div class="preview-label">{m.cycle_drawer_preview_label()}</div>
					<div class="preview-flow">
						{#each cycle as item, idx}
							{@const model = getModel(item)}
							<span class="preview-node" class:current-start={idx === 0}>
								{model?.name || item.split('/')[1] || item}
							</span>
							{#if idx < cycle.length - 1}
								<span class="preview-arrow"><IconArrowRight /></span>
							{/if}
						{/each}
						<Tooltip text={m.models_cycle_loop_title()}>
							<span class="preview-loop"><IconLoop /></span>
						</Tooltip>
					</div>
				</div>
			{/if}
		</div>
	</div>
</aside>

<style>
	/* Colonna che si piega in larghezza: deve restituire davvero lo spazio alla lista
	   dei ruoli, quindi si anima la larghezza (una trasformazione la sposterebbe senza
	   liberare la colonna; una traccia di griglia 0fr non si chiude in un contenitore
	   a larghezza intrinseca). La linea di separazione e' un'ombra interna, cosi' da
	   chiusa non occupa nemmeno un pixel. */
	.cycle-drawer {
		width: 0;
		flex-shrink: 0;
		box-shadow: inset 1px 0 0 transparent;
		background: color-mix(in srgb, var(--bg-sunken) 70%, var(--bg-base));
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		visibility: hidden;
		pointer-events: none;
		transition: width var(--dur-slow) var(--ease-reveal), box-shadow var(--dur-slow) var(--ease-reveal),
			visibility 0s var(--dur-slow);
	}

	.cycle-drawer.open {
		width: 270px;
		box-shadow: inset 1px 0 0 var(--line);
		visibility: visible;
		pointer-events: auto;
		transition: width var(--dur-slow) var(--ease-reveal), box-shadow var(--dur-slow) var(--ease-reveal),
			visibility 0s 0s;
	}

	.drawer-inner {
		width: 270px;
		min-width: 270px;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.cycle-drawer.open .drawer-inner {
		animation: cycle-drawer-reveal var(--dur-slow) var(--ease-reveal);
	}

	@keyframes cycle-drawer-reveal {
		from {
			filter: blur(3px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cycle-drawer {
			transition: none;
		}
		.cycle-drawer.open .drawer-inner {
			animation: none;
		}
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 32px;
		min-height: 32px;
		padding: 0 8px 0 10px;
		border-bottom: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg-base) 60%, transparent);
	}

	.drawer-title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cycle-icon {
		color: var(--ink-muted);
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.drawer-title {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.btn-close-drawer {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
		--icon-size: 14px;
	}

	.btn-close-drawer:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line);
	}

	.drawer-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.drawer-desc {
		font-size: var(--text-caption);
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
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.cycle-item.first-item {
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		background: color-mix(in srgb, var(--brand) 6%, var(--bg-base));
	}

	.item-order {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
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
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-provider {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		text-transform: capitalize;
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		opacity: 0.6;
		transition: opacity var(--dur-fast) var(--ease-out);
	}

	.cycle-item:hover .item-actions {
		opacity: 1;
	}

	.btn-action {
		width: 22px;
		height: 22px;
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-muted);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
		--icon-size: 11px;
	}

	.btn-action:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line);
		color: var(--ink);
	}

	.btn-action.delete:hover:not(:disabled) {
		color: var(--danger);
		background: color-mix(in oklab, var(--danger) 10%, transparent);
		border-color: color-mix(in oklab, var(--danger) 25%, transparent);
	}

	.btn-action:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.empty-cycle {
		padding: 12px;
		font-size: var(--text-caption);
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
		font-size: var(--text-caption);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
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
		font-size: var(--text-caption);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
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
		font-size: var(--text-caption);
		color: var(--ink-muted);
		margin-bottom: 6px;
		font-weight: 600;
	}

	.preview-flow {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
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
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
	}

	.preview-loop {
		color: var(--brand-ink);
		display: inline-flex;
		align-items: center;
		--icon-size: 12px;
	}
</style>
