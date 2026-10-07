<!--
  ComposerPreview.svelte — Anteprima interattiva del composer con le due zone
  (toolbar e statusLine), drag & drop reorder, supporto tastiera accessibile
  e rispetto dei vincoli `supported` e `locked` del manifesto.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { ComposerLayout, PinnedCommand, ComposerZone, ComposerForm, CommandManifestEntry } from '$lib/agent/commandCatalog/types';
	import { itemsInZone, movePin, unpin, isSupported, type Manifest } from '$lib/agent/commandCatalog/layout';
	import { resolveCommandText } from '$lib/agent/commandCatalog/text';
	import CommandIcon from './CommandIcon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import {
		IconGrip,
		IconChevronLeft,
		IconChevronRight,
		IconClose,
		IconLock,
		IconLoop,
		IconWarning
	} from '$lib/icons';

	let {
		layout,
		manifest,
		selectedId,
		onSelect,
		onLayoutChange,
		onResetRequest
	}: {
		layout: ComposerLayout;
		manifest: Manifest;
		selectedId: string | null;
		onSelect: (id: string) => void;
		onLayoutChange: (newLayout: ComposerLayout) => void;
		onResetRequest: () => void;
	} = $props();

	const entryMap = $derived.by(() => {
		const map = new Map<string, CommandManifestEntry>();
		for (const entry of manifest) {
			map.set(entry.id, entry);
		}
		return map;
	});

	const toolbarItems = $derived(itemsInZone(layout, 'toolbar'));
	const statusLineItems = $derived(itemsInZone(layout, 'statusLine'));

	// Stato drag and drop
	let draggedPin = $state<PinnedCommand | null>(null);
	let dragOverZone = $state<ComposerZone | null>(null);
	let isDragValidForZone = $state(true);
	let dragOverIndex = $state<number | null>(null);
	let feedbackMessage = $state<string | null>(null);
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

	function showFeedback(text: string) {
		if (feedbackTimer) clearTimeout(feedbackTimer);
		feedbackMessage = text;
		feedbackTimer = setTimeout(() => {
			feedbackMessage = null;
			feedbackTimer = null;
		}, 3000);
	}

	function handleDragStart(pinItem: PinnedCommand, event: DragEvent) {
		draggedPin = pinItem;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', pinItem.id);
		}
	}

	function handleDragEnd() {
		draggedPin = null;
		dragOverZone = null;
		dragOverIndex = null;
		isDragValidForZone = true;
	}

	function handleZoneDragOver(zone: ComposerZone, event: DragEvent) {
		event.preventDefault();
		if (!draggedPin) return;

		const entry = entryMap.get(draggedPin.id);
		if (!entry) return;

		// Verifica se il comando supporta la zona di destinazione
		const canDropInZone = entry.supported.some((p) => p.zone === zone);
		dragOverZone = zone;
		isDragValidForZone = canDropInZone;

		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = canDropInZone ? 'move' : 'none';
		}
	}

	function handleZoneDragLeave(zone: ComposerZone, event: DragEvent) {
		// Se il cursore esce dalla zona
		const related = event.relatedTarget as HTMLElement | null;
		const currentTarget = event.currentTarget as HTMLElement | null;
		if (currentTarget && related && currentTarget.contains(related)) {
			return;
		}
		if (dragOverZone === zone) {
			dragOverZone = null;
			dragOverIndex = null;
			isDragValidForZone = true;
		}
	}

	function handleZoneDrop(zone: ComposerZone, event: DragEvent) {
		event.preventDefault();
		if (!draggedPin) return;

		const entry = entryMap.get(draggedPin.id);
		if (!entry) {
			handleDragEnd();
			return;
		}

		const supportedPlacement = entry.supported.find((p) => p.zone === zone);
		if (!supportedPlacement) {
			showFeedback(m.settings_commands_drag_invalid());
			handleDragEnd();
			return;
		}

		// Se nella zona di destinazione e' supportata la stessa forma attuale, conservala; altrimenti usa la prima supportata
		const chosenForm: ComposerForm = entry.supported.some((p) => p.zone === zone && p.form === draggedPin?.form)
			? draggedPin.form
			: supportedPlacement.form;

		const targetZoneItems = zone === 'toolbar' ? toolbarItems : statusLineItems;
		const targetIndex = dragOverIndex !== null ? dragOverIndex : targetZoneItems.length;

		const newLayout = movePin(
			layout,
			manifest,
			draggedPin.id,
			{ zone, form: chosenForm },
			targetIndex
		);
		onLayoutChange(newLayout);
		handleDragEnd();
	}

	function handleItemDragOver(zone: ComposerZone, index: number, event: DragEvent) {
		event.stopPropagation();
		event.preventDefault();
		handleZoneDragOver(zone, event);
		dragOverIndex = index;
	}

	function handleMoveStep(pinItem: PinnedCommand, delta: -1 | 1) {
		const zoneItems = pinItem.zone === 'toolbar' ? toolbarItems : statusLineItems;
		const currentIndex = zoneItems.findIndex((p) => p.id === pinItem.id);
		if (currentIndex === -1) return;

		const newIndex = currentIndex + delta;
		if (newIndex < 0 || newIndex >= zoneItems.length) return;

		const newLayout = movePin(
			layout,
			manifest,
			pinItem.id,
			{ zone: pinItem.zone, form: pinItem.form },
			newIndex
		);
		onLayoutChange(newLayout);
	}

	function handleUnpin(pinItem: PinnedCommand) {
		const entry = entryMap.get(pinItem.id);
		if (entry?.locked) return;
		const newLayout = unpin(layout, manifest, pinItem.id);
		onLayoutChange(newLayout);
	}

	function handleItemKeyDown(pinItem: PinnedCommand, event: KeyboardEvent) {
		if (event.altKey) {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				event.preventDefault();
				handleMoveStep(pinItem, -1);
			} else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				event.preventDefault();
				handleMoveStep(pinItem, 1);
			}
		}
	}
</script>

<div class="composer-preview-card">
	<div class="preview-header">
		<div class="preview-header-copy">
			<h4 class="preview-title">{m.settings_commands_preview_heading()}</h4>
			<p class="preview-desc">{m.settings_commands_preview_desc()}</p>
		</div>
		<button
			type="button"
			class="ui-button ui-button-secondary reset-button"
			onclick={onResetRequest}
		>
			<IconLoop />
			<span>{m.settings_commands_reset_button()}</span>
		</button>
	</div>

	{#if feedbackMessage}
		<div class="feedback-banner" role="alert">
			<IconWarning />
			<span>{feedbackMessage}</span>
		</div>
	{/if}

	<div class="preview-surface">
		<!-- Zona 1: Toolbar del composer -->
		<div
			class="preview-zone toolbar-zone"
			class:drag-over={dragOverZone === 'toolbar'}
			class:drag-invalid={dragOverZone === 'toolbar' && !isDragValidForZone}
			role="region"
			aria-label={m.settings_commands_zone_toolbar_title()}
			ondragover={(e) => handleZoneDragOver('toolbar', e)}
			ondragleave={(e) => handleZoneDragLeave('toolbar', e)}
			ondrop={(e) => handleZoneDrop('toolbar', e)}
		>
			<div class="zone-label-row">
				<span class="zone-tag">{m.settings_commands_zone_toolbar_title()}</span>
				<span class="zone-count">{toolbarItems.length}</span>
			</div>

			<div class="zone-items">
				{#if toolbarItems.length === 0}
					<div class="zone-empty-hint">{m.settings_commands_zone_empty()}</div>
				{:else}
					{#each toolbarItems as p, idx (p.id)}
						{@const entry = entryMap.get(p.id)}
						{@const text = entry ? resolveCommandText(entry) : null}
						{@const title = text?.title ?? p.id}
						{@const isLocked = entry?.locked ?? false}
						{@const isSelected = selectedId === p.id}

						<div
							class="preview-item form-{p.form}"
							class:selected={isSelected}
							class:locked={isLocked}
							class:dragging={draggedPin?.id === p.id}
							draggable="true"
							role="button"
							tabindex="0"
							aria-label={`${title} (${p.form === 'chip' ? m.settings_commands_form_chip() : m.settings_commands_form_icon()})`}
							onclick={() => onSelect(p.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelect(p.id);
								} else {
									handleItemKeyDown(p, e);
								}
							}}
							ondragstart={(e) => handleDragStart(p, e)}
							ondragend={handleDragEnd}
							ondragover={(e) => handleItemDragOver('toolbar', idx, e)}
						>
							<span class="drag-handle" aria-hidden="true">
								<IconGrip />
							</span>

							<div class="item-visual">
								<CommandIcon icon={entry?.icon} class="item-icon" />
								{#if p.form === 'chip'}
									<span class="item-label">{title}</span>
								{/if}
							</div>

							{#if isLocked}
								<Tooltip text={m.settings_commands_locked_badge()}>
									<span class="lock-indicator" aria-label={m.settings_commands_locked_badge()}>
										<IconLock />
									</span>
								</Tooltip>
							{/if}

							<div class="item-actions">
								<button
									type="button"
									class="item-btn"
									disabled={idx === 0}
									aria-label={m.settings_commands_item_move_left()}
									onclick={(e) => { e.stopPropagation(); handleMoveStep(p, -1); }}
								>
									<IconChevronLeft />
								</button>
								<button
									type="button"
									class="item-btn"
									disabled={idx === toolbarItems.length - 1}
									aria-label={m.settings_commands_item_move_right()}
									onclick={(e) => { e.stopPropagation(); handleMoveStep(p, 1); }}
								>
									<IconChevronRight />
								</button>
								{#if !isLocked}
									<button
										type="button"
										class="item-btn remove-btn"
										aria-label={m.settings_commands_item_unpin()}
										onclick={(e) => { e.stopPropagation(); handleUnpin(p); }}
									>
										<IconClose />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Zona 2: StatusLine sotto il composer -->
		<div
			class="preview-zone status-zone"
			class:drag-over={dragOverZone === 'statusLine'}
			class:drag-invalid={dragOverZone === 'statusLine' && !isDragValidForZone}
			role="region"
			aria-label={m.settings_commands_zone_status_title()}
			ondragover={(e) => handleZoneDragOver('statusLine', e)}
			ondragleave={(e) => handleZoneDragLeave('statusLine', e)}
			ondrop={(e) => handleZoneDrop('statusLine', e)}
		>
			<div class="zone-label-row">
				<span class="zone-tag">{m.settings_commands_zone_status_title()}</span>
				<span class="zone-count">{statusLineItems.length}</span>
			</div>

			<div class="zone-items">
				{#if statusLineItems.length === 0}
					<div class="zone-empty-hint">{m.settings_commands_zone_empty()}</div>
				{:else}
					{#each statusLineItems as p, idx (p.id)}
						{@const entry = entryMap.get(p.id)}
						{@const text = entry ? resolveCommandText(entry) : null}
						{@const title = text?.title ?? p.id}
						{@const isLocked = entry?.locked ?? false}
						{@const isSelected = selectedId === p.id}

						<div
							class="preview-item form-{p.form}"
							class:selected={isSelected}
							class:locked={isLocked}
							class:dragging={draggedPin?.id === p.id}
							draggable="true"
							role="button"
							tabindex="0"
							aria-label={`${title} (${p.form === 'chip' ? m.settings_commands_form_chip() : m.settings_commands_form_icon()})`}
							onclick={() => onSelect(p.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelect(p.id);
								} else {
									handleItemKeyDown(p, e);
								}
							}}
							ondragstart={(e) => handleDragStart(p, e)}
							ondragend={handleDragEnd}
							ondragover={(e) => handleItemDragOver('statusLine', idx, e)}
						>
							<span class="drag-handle" aria-hidden="true">
								<IconGrip />
							</span>

							<div class="item-visual">
								<CommandIcon icon={entry?.icon} class="item-icon" />
								{#if p.form === 'chip'}
									<span class="item-label">{title}</span>
								{/if}
							</div>

							{#if isLocked}
								<Tooltip text={m.settings_commands_locked_badge()}>
									<span class="lock-indicator" aria-label={m.settings_commands_locked_badge()}>
										<IconLock />
									</span>
								</Tooltip>
							{/if}

							<div class="item-actions">
								<button
									type="button"
									class="item-btn"
									disabled={idx === 0}
									aria-label={m.settings_commands_item_move_left()}
									onclick={(e) => { e.stopPropagation(); handleMoveStep(p, -1); }}
								>
									<IconChevronLeft />
								</button>
								<button
									type="button"
									class="item-btn"
									disabled={idx === statusLineItems.length - 1}
									aria-label={m.settings_commands_item_move_right()}
									onclick={(e) => { e.stopPropagation(); handleMoveStep(p, 1); }}
								>
									<IconChevronRight />
								</button>
								{#if !isLocked}
									<button
										type="button"
										class="item-btn remove-btn"
										aria-label={m.settings_commands_item_unpin()}
										onclick={(e) => { e.stopPropagation(); handleUnpin(p); }}
									>
										<IconClose />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.composer-preview-card {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.preview-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.preview-header-copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.preview-title {
		margin: 0;
		font-size: var(--text-body);
		font-weight: 600;
		color: var(--ink);
	}

	.preview-desc {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--ink-muted);
		max-width: 560px;
		line-height: 1.4;
	}

	.reset-button {
		font-size: var(--text-caption);
		padding: var(--space-1) var(--space-3);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}

	.feedback-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		border: 1px solid color-mix(in oklch, var(--warn) 30%, transparent);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-caption);
	}

	.preview-surface {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
	}

	.preview-zone {
		background: var(--bg-sunken);
		border: 1px dashed var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 52px;
		transition: border-color 0.15s ease, background-color 0.15s ease;
	}

	.preview-zone.drag-over {
		border-color: var(--brand);
		background: color-mix(in oklch, var(--brand) 8%, var(--bg-sunken));
	}

	.preview-zone.drag-invalid {
		border-color: var(--danger);
		background: color-mix(in oklch, var(--danger) 10%, var(--bg-sunken));
	}

	.zone-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		color: var(--ink-muted);
		font-weight: 500;
	}

	.zone-tag {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 10.5px;
	}

	.zone-count {
		font-feature-settings: 'tnum';
		opacity: 0.8;
	}

	.zone-items {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.zone-empty-hint {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		font-style: italic;
		padding: var(--space-1) 0;
	}

	.preview-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 3px 6px;
		color: var(--ink);
		font-size: var(--text-caption);
		cursor: grab;
		user-select: none;
		transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
	}

	.preview-item:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.preview-item:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.preview-item.selected {
		border-color: var(--brand);
		background: color-mix(in oklch, var(--brand) 12%, var(--bg-raised));
	}

	.preview-item.dragging {
		opacity: 0.45;
		cursor: grabbing;
	}

	.drag-handle {
		display: inline-flex;
		color: var(--ink-faint);
		cursor: grab;
	}

	.item-visual {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.item-label {
		font-weight: 500;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lock-indicator {
		display: inline-flex;
		color: var(--ink-muted);
		opacity: 0.8;
	}

	.item-actions {
		display: none;
		align-items: center;
		gap: 2px;
		margin-left: 2px;
	}

	.preview-item:hover .item-actions,
	.preview-item:focus-within .item-actions {
		display: inline-flex;
	}

	.item-btn {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
	}

	.item-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.item-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.item-btn.remove-btn:hover {
		color: var(--danger);
	}

	@media (prefers-reduced-motion: reduce) {
		.preview-item,
		.preview-zone {
			transition: none;
		}
	}
</style>
