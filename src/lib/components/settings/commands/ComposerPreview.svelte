<!--
  ComposerPreview.svelte — Fake composer che riproduce fedelmente il composer reale
  di Studio:
  - Riquadro editor finto con placeholder e riga allegati/quote simulate;
  - Toolbar divisa in tre gruppi (sinistra, centro scorrevole, destra fissa con pulsante invio);
  - Riga inferiore statusLine sotto il composer;
  - Trascinamento dei comandi con pointer events, ghost visivo, anteprima a fessura (drop marker);
  - Animazioni flip e transizioni fade/scale per comparsa/scomparsa in tempo reale;
  - Rimozione tramite pulsante × o trascinamento all'esterno.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type {
		ComposerLayout,
		PinnedCommand,
		ComposerZone,
		ComposerForm,
		CommandManifestEntry
	} from '$lib/agent/commandCatalog/types';
	import {
		itemsInZone,
		partitionToolbar,
		suggestedPlacement,
		type Manifest
	} from '$lib/agent/commandCatalog/layout';
	import { resolveCommandText } from '$lib/agent/commandCatalog/text';
	import CommandIcon from './CommandIcon.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { motionReduced } from '$lib/agent/motionState.svelte';
	import {
		IconClose,
		IconLock,
		IconLoop,
		IconArrowUp,
		IconAttach,
		IconAt,
		IconPlan,
		IconAside,
		IconChevronUp,
		IconGrip
	} from '$lib/icons';

	let {
		layout,
		manifest,
		selectedId,
		activeDrag = null,
		onSelect,
		onRemovePin,
		onResetRequest,
		onStartPinDrag
	}: {
		layout: ComposerLayout;
		manifest: Manifest;
		selectedId: string | null;
		activeDrag?: { id: string; zone?: ComposerZone } | null;
		onSelect: (id: string) => void;
		onRemovePin: (id: string) => void;
		onResetRequest: () => void;
		onStartPinDrag: (pin: PinnedCommand, clientX: number, clientY: number) => void;
	} = $props();

	const entryMap = $derived.by(() => {
		const map = new Map<string, CommandManifestEntry>();
		for (const entry of manifest) {
			map.set(entry.id, entry);
		}
		return map;
	});

	const toolbarPins = $derived(itemsInZone(layout, 'toolbar'));
	const partitioned = $derived(partitionToolbar(toolbarPins));
	const toolbarLeft = $derived(partitioned.left);
	const toolbarCenter = $derived(partitioned.center);
	const toolbarRight = $derived(partitioned.right);

	const statusLinePins = $derived(itemsInZone(layout, 'statusLine'));

	function handlePointerDown(e: PointerEvent, pin: PinnedCommand) {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('.remove-x-btn')) return;
		onStartPinDrag(pin, e.clientX, e.clientY);
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

	<!-- Guscio del Fake Composer (identico al Composer.svelte reale) -->
	<div class="fake-composer-surface">
		<div class="fake-composer-shell" data-drop-zone="toolbar">
			<!-- Zona editor finta con placeholder -->
			<div class="fake-editor-area">
				<span class="fake-placeholder">{m.settings_commands_fake_placeholder()}</span>
			</div>

			<!-- Toolbar del composer: sinistra, centro, destra -->
			<div class="fake-toolbar">
				<!-- Gruppo sinistro (allegato, @) -->
				<div class="toolbar-group toolbar-left" data-drop-zone="toolbar-left">
					{#each toolbarLeft as pin (pin.id)}
						{@const entry = entryMap.get(pin.id)}
						{@const isSelected = selectedId === pin.id}
						{@const isLocked = entry?.locked ?? false}
						{@const isBeingDragged = activeDrag?.id === pin.id}

						<div
							class="pin-item-wrapper"
							animate:flip={{ duration: motionReduced() ? 0 : 180 }}
							in:scale={{ duration: motionReduced() ? 0 : 140, start: 0.85 }}
							out:scale={{ duration: motionReduced() ? 0 : 100, start: 0.85 }}
						>
							<div
								class="fake-pin-item form-{pin.form}"
								class:selected={isSelected}
								class:locked={isLocked}
								class:dragging-placeholder={isBeingDragged}
								data-pin-id={pin.id}
								role="button"
								tabindex="0"
								onclick={() => onSelect(pin.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelect(pin.id);
									}
								}}
								onpointerdown={(e) => handlePointerDown(e, pin)}
							>
								{#if pin.id === 'ctl.attach'}
									<IconAttach />
								{:else if pin.id === 'ctl.mention'}
									<IconAt />
								{:else}
									<CommandIcon icon={entry?.icon} />
									{#if pin.form === 'chip'}
										<span class="pin-label">{resolveCommandText(entry ?? { text: { it: { title: pin.id } } } as any).title}</span>
									{/if}
								{/if}

								{#if isLocked}
									<span class="pin-badge locked-badge" title={m.settings_commands_locked_badge()} aria-label={m.settings_commands_locked_badge()}>
										<IconLock />
									</span>
								{:else}
									<button
										type="button"
										class="remove-x-btn"
										aria-label={m.settings_commands_item_unpin()}
										title={m.settings_commands_item_unpin()}
										onclick={(e) => {
											e.stopPropagation();
											onRemovePin(pin.id);
										}}
									>
										<IconClose />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				{#if toolbarLeft.length > 0}
					<span class="fake-divider" aria-hidden="true"></span>
				{/if}

				<!-- Striscia centrale scorrevole (btw, plan, ruolo, modello, thinking, comandi custom) -->
				<div class="toolbar-group toolbar-center" data-drop-zone="toolbar-center">
					{#each toolbarCenter as pin (pin.id)}
						{@const entry = entryMap.get(pin.id)}
						{@const isSelected = selectedId === pin.id}
						{@const isLocked = entry?.locked ?? false}
						{@const isBeingDragged = activeDrag?.id === pin.id}

						<div
							class="pin-item-wrapper"
							animate:flip={{ duration: motionReduced() ? 0 : 180 }}
							in:scale={{ duration: motionReduced() ? 0 : 140, start: 0.85 }}
							out:scale={{ duration: motionReduced() ? 0 : 100, start: 0.85 }}
						>
							<div
								class="fake-pin-item form-{pin.form}"
								class:selected={isSelected}
								class:locked={isLocked}
								class:dragging-placeholder={isBeingDragged}
								data-pin-id={pin.id}
								role="button"
								tabindex="0"
								onclick={() => onSelect(pin.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelect(pin.id);
									}
								}}
								onpointerdown={(e) => handlePointerDown(e, pin)}
							>
								{#if pin.id === 'btw'}
									<IconAside />
									<span class="pin-label">{m.btw_title()}</span>
								{:else if pin.id === 'plan'}
									<IconPlan />
									<span class="pin-label">{m.plan_pill_label()}</span>
								{:else if pin.id === 'ctl.role'}
									<span class="fake-dot"></span>
									<span class="pin-label font-mono">default</span>
								{:else if pin.id === 'ctl.model'}
									<span class="pin-label">Claude 3.7 Sonnet</span>
									<IconChevronUp />
								{:else if pin.id === 'ctl.thinking'}
									<span class="fake-thinking-bar"></span>
									<span class="pin-label font-mono">off</span>
								{:else}
									<CommandIcon icon={entry?.icon} />
									{#if pin.form === 'chip'}
										<span class="pin-label">{resolveCommandText(entry ?? { text: { it: { title: pin.id } } } as any).title}</span>
									{/if}
								{/if}

								{#if isLocked}
									<span class="pin-badge locked-badge" title={m.settings_commands_locked_badge()} aria-label={m.settings_commands_locked_badge()}>
										<IconLock />
									</span>
								{:else}
									<button
										type="button"
										class="remove-x-btn"
										aria-label={m.settings_commands_item_unpin()}
										title={m.settings_commands_item_unpin()}
										onclick={(e) => {
											e.stopPropagation();
											onRemovePin(pin.id);
										}}
									>
										<IconClose />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<!-- Gruppo destro fisso (contesto e tasto Invio) -->
				<div class="toolbar-group toolbar-right" data-drop-zone="toolbar-right">
					{#each toolbarRight as pin (pin.id)}
						{@const entry = entryMap.get(pin.id)}
						{@const isSelected = selectedId === pin.id}
						{@const isLocked = entry?.locked ?? false}
						{@const isBeingDragged = activeDrag?.id === pin.id}

						<div
							class="pin-item-wrapper"
							animate:flip={{ duration: motionReduced() ? 0 : 180 }}
							in:scale={{ duration: motionReduced() ? 0 : 140, start: 0.85 }}
							out:scale={{ duration: motionReduced() ? 0 : 100, start: 0.85 }}
						>
							<div
								class="fake-pin-item form-{pin.form}"
								class:selected={isSelected}
								class:locked={isLocked}
								class:dragging-placeholder={isBeingDragged}
								data-pin-id={pin.id}
								role="button"
								tabindex="0"
								onclick={() => onSelect(pin.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onSelect(pin.id);
									}
								}}
								onpointerdown={(e) => handlePointerDown(e, pin)}
							>
								{#if pin.id === 'ctl.context'}
									<span class="fake-ring"></span>
									<span class="pin-label font-mono">12k/200k</span>
								{:else}
									<CommandIcon icon={entry?.icon} />
									{#if pin.form === 'chip'}
										<span class="pin-label">{resolveCommandText(entry ?? { text: { it: { title: pin.id } } } as any).title}</span>
									{/if}
								{/if}

								{#if isLocked}
									<span class="pin-badge locked-badge" title={m.settings_commands_locked_badge()} aria-label={m.settings_commands_locked_badge()}>
										<IconLock />
									</span>
								{:else}
									<button
										type="button"
										class="remove-x-btn"
										aria-label={m.settings_commands_item_unpin()}
										title={m.settings_commands_item_unpin()}
										onclick={(e) => {
											e.stopPropagation();
											onRemovePin(pin.id);
										}}
									>
										<IconClose />
									</button>
								{/if}
							</div>
						</div>
					{/each}

					<!-- Tasto Invio simulato -->
					<div class="fake-send-btn" aria-hidden="true">
						<IconArrowUp />
					</div>
				</div>
			</div>
		</div>

		<!-- StatusLine sotto il composer (seconda zona) -->
		<div class="fake-status-line" data-drop-zone="statusLine">
			{#if statusLinePins.length === 0}
				<span class="status-line-empty-hint">{m.settings_commands_zone_empty()}</span>
			{:else}
				{#each statusLinePins as pin (pin.id)}
					{@const entry = entryMap.get(pin.id)}
					{@const isSelected = selectedId === pin.id}
					{@const isLocked = entry?.locked ?? false}
					{@const isBeingDragged = activeDrag?.id === pin.id}

					<div
						class="pin-item-wrapper"
						animate:flip={{ duration: motionReduced() ? 0 : 180 }}
						in:scale={{ duration: motionReduced() ? 0 : 140, start: 0.85 }}
						out:scale={{ duration: motionReduced() ? 0 : 100, start: 0.85 }}
					>
						<div
							class="fake-status-pin form-{pin.form}"
							class:selected={isSelected}
							class:locked={isLocked}
							class:dragging-placeholder={isBeingDragged}
							data-pin-id={pin.id}
							role="button"
							tabindex="0"
							onclick={() => onSelect(pin.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelect(pin.id);
								}
							}}
							onpointerdown={(e) => handlePointerDown(e, pin)}
						>
							<CommandIcon icon={entry?.icon} />
							{#if pin.form === 'chip'}
								<span class="status-pin-label font-mono">
									{#if pin.id === 'ctl.cost'}
										$0.02
									{:else if pin.id === 'ctl.limit'}
										80% limit
									{:else}
										{resolveCommandText(entry ?? { text: { it: { title: pin.id } } } as any).title}
									{/if}
								</span>
							{/if}

							{#if isLocked}
								<span class="pin-badge locked-badge" title={m.settings_commands_locked_badge()} aria-label={m.settings_commands_locked_badge()}>
									<IconLock />
								</span>
							{:else}
								<button
									type="button"
									class="remove-x-btn"
									aria-label={m.settings_commands_item_unpin()}
									title={m.settings_commands_item_unpin()}
									onclick={(e) => {
										e.stopPropagation();
										onRemovePin(pin.id);
									}}
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
	}

	.preview-title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.preview-desc {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.45;
	}

	.reset-button {
		font-size: var(--text-xs);
		padding: 4px 10px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.fake-composer-surface {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--bg-base);
		padding: var(--space-3);
		border-radius: var(--radius-lg);
		border: 1px solid var(--line);
	}

	.fake-composer-shell {
		background: var(--bg-raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-height: 100px;
	}

	.fake-editor-area {
		padding: 12px 14px;
		flex: 1;
		min-height: 52px;
		user-select: none;
	}

	.fake-placeholder {
		color: var(--ink-faint);
		font-size: var(--text-body);
		font-style: italic;
	}

	.fake-toolbar {
		display: flex;
		align-items: center;
		padding: 6px 8px;
		gap: 4px;
		border-top: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg-sunken) 60%, transparent);
	}

	.toolbar-group {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.toolbar-left {
		flex-shrink: 0;
	}

	.toolbar-center {
		flex: 1;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.toolbar-center::-webkit-scrollbar {
		display: none;
	}

	.toolbar-right {
		flex-shrink: 0;
		margin-left: auto;
	}

	.fake-divider {
		width: 1px;
		height: 16px;
		background: var(--line);
		margin: 0 2px;
	}

	.pin-item-wrapper {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.fake-pin-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		height: 28px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: grab;
		position: relative;
		user-select: none;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}

	.fake-pin-item:active {
		cursor: grabbing;
	}

	.fake-pin-item.form-icon {
		width: 28px;
		padding: 0;
		justify-content: center;
	}

	.fake-pin-item.selected {
		border-color: var(--brand);
		background: var(--bg-active);
	}

	.fake-pin-item.dragging-placeholder {
		opacity: 0.3;
		border-style: dashed;
	}

	.pin-label {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.fake-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand-ink);
	}

	.fake-thinking-bar {
		width: 14px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-strong);
	}

	.fake-ring {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--brand);
	}

	.pin-badge {
		display: inline-flex;
		color: var(--ink-faint);
		font-size: 11px;
	}

	.remove-x-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: 2px;
		background: transparent;
		border: none;
		border-radius: 50%;
		color: var(--ink-faint);
		cursor: pointer;
		opacity: 0.7;
		transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.remove-x-btn:hover {
		opacity: 1;
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 15%, transparent);
	}

	.fake-send-btn {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		background: var(--ink);
		color: var(--bg-base);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: 4px;
	}

	.fake-status-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		padding: 4px 6px;
		min-height: 26px;
	}

	.status-line-empty-hint {
		font-size: 11px;
		color: var(--ink-faint);
		font-style: italic;
	}

	.fake-status-pin {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: grab;
		user-select: none;
	}

	.fake-status-pin:active {
		cursor: grabbing;
	}

	.fake-status-pin.selected {
		border-color: var(--brand);
		color: var(--ink);
	}

	.fake-status-pin.dragging-placeholder {
		opacity: 0.3;
		border-style: dashed;
	}

	.status-pin-label {
		font-size: 11px;
	}
</style>
