<!--
  CommandsSection.svelte — Voce Impostazioni > Comandi:
  1. Editor di layout con anteprima del fake composer e drag & drop continuo
     (pointer events con ghost fluttuante, riordino e rimozione tramite × o drag fuori).
  2. Palette dei comandi disponibili sotto il composer, con ricerca e drag verso l'alto.
  3. Pannello di dettaglio laterale con documentazione completa, esempi e selettore forma.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { projectStore } from '$lib/stores/projects.svelte';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import type { AgentSession } from '$lib/agent/session.svelte';
	import type { AvailableCommand } from '$lib/agent/wire';
	import { COMMAND_MANIFEST } from '$lib/agent/commandCatalog/manifest/index';
	import type {
		CommandManifestEntry,
		CommandPlacement,
		ComposerLayout,
		ComposerZone,
		PinnedCommand
	} from '$lib/agent/commandCatalog/types';
	import {
		resolveLayout,
		pin,
		unpin,
		movePin,
		placePin,
		layoutToSave,
		suggestedPlacement,
		itemsInZone
	} from '$lib/agent/commandCatalog/layout';
	import { resolveCommandText } from '$lib/agent/commandCatalog/text';
	import ComposerPreview from './commands/ComposerPreview.svelte';
	import CommandPalette from './commands/CommandPalette.svelte';
	import CommandDetail from './commands/CommandDetail.svelte';
	import CommandIcon from './commands/CommandIcon.svelte';
	import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
	import { IconLock, IconGrip } from '$lib/icons';

	// Stato ricerca e selezione
	let searchQuery = $state('');
	let selectedCommandId = $state<string | null>(null);
	let selectedNewCommand = $state<AvailableCommand | null>(null);
	let showResetConfirm = $state(false);

	// Layout risolto reattivo
	const resolvedLayout = $derived(
		resolveLayout(settingsStore.composerLayout, COMMAND_MANIFEST)
	);

	// Set di id fissati per evidenziazione rapida
	const pinnedIds = $derived(
		new Set(resolvedLayout.pinned.map((p) => p.id))
	);

	// Sessione attiva per comandi runtime nuovi
	const activeSession = $derived.by(() => {
		const project = projectStore.activeProject;
		if (project) {
			const s = sessionRegistry.getLaneSession(project.id, project.lane.laneId);
			if (s) return s as AgentSession;
		}
		const all = sessionRegistry.getAllSessions();
		const withCommands = all.find((s) => (s as AgentSession).availableCommands?.length > 0);
		return (withCommands ?? all[0] ?? null) as AgentSession | null;
	});

	// Comandi builtin esposti dal runtime omp ma assenti dal manifesto
	const uncataloguedBuiltinCommands = $derived.by(() => {
		if (!activeSession || !activeSession.availableCommands) return [];
		const manifestIds = new Set(COMMAND_MANIFEST.map((e) => e.id));
		return activeSession.availableCommands.filter((cmd) => {
			const isBuiltin = cmd.source === 'builtin';
			return isBuiltin && !manifestIds.has(cmd.name);
		});
	});

	// Mappa id -> entry del manifesto
	const entryMap = $derived(new Map(COMMAND_MANIFEST.map((e) => [e.id, e])));

	// Seleziona la prima voce se nulla e' selezionato
	$effect(() => {
		if (selectedCommandId === null && selectedNewCommand === null) {
			if (COMMAND_MANIFEST.length > 0) {
				selectedCommandId = COMMAND_MANIFEST[0].id;
			}
		}
	});

	const selectedEntry = $derived(
		selectedCommandId ? entryMap.get(selectedCommandId) ?? null : null
	);

	function selectEntry(id: string) {
		selectedCommandId = id;
		selectedNewCommand = null;
	}

	function selectNewCommand(cmd: AvailableCommand) {
		selectedNewCommand = cmd;
		selectedCommandId = null;
	}

	// Salvataggio reattivo del layout tramite layoutToSave
	function handleLayoutChange(newLayout: ComposerLayout) {
		const merged = layoutToSave(newLayout, settingsStore.composerLayout, COMMAND_MANIFEST);
		settingsStore.setComposerLayout(merged);
	}

	function handleTogglePin(id: string, pinAction: boolean) {
		if (pinAction) {
			const newLayout = pin(resolvedLayout, COMMAND_MANIFEST, id);
			handleLayoutChange(newLayout);
		} else {
			const newLayout = unpin(resolvedLayout, COMMAND_MANIFEST, id);
			handleLayoutChange(newLayout);
		}
	}

	function handleChangePlacement(id: string, placement: CommandPlacement) {
		const currentPin = resolvedLayout.pinned.find((p) => p.id === id);
		if (currentPin && currentPin.zone === placement.zone) {
			const zoneItems = itemsInZone(resolvedLayout, placement.zone);
			const idx = zoneItems.findIndex((p) => p.id === id);
			const newLayout = movePin(resolvedLayout, COMMAND_MANIFEST, id, placement, idx >= 0 ? idx : 0);
			handleLayoutChange(newLayout);
		} else {
			const newLayout = pin(resolvedLayout, COMMAND_MANIFEST, id, placement);
			handleLayoutChange(newLayout);
		}
	}

	function handleConfirmReset() {
		settingsStore.setComposerLayout(null);
		showResetConfirm = false;
	}

	function handleQuickPin(entry: CommandManifestEntry) {
		const placement = suggestedPlacement(entry);
		if (!placement) return;
		const newLayout = pin(resolvedLayout, COMMAND_MANIFEST, entry.id, placement);
		handleLayoutChange(newLayout);
		selectedCommandId = entry.id;
	}

	function handleRemovePin(id: string) {
		const entry = entryMap.get(id);
		if (entry?.locked) return;
		const newLayout = unpin(resolvedLayout, COMMAND_MANIFEST, id);
		handleLayoutChange(newLayout);
	}

	// -------------------------------------------------------------------------
	// Controller Drag & Drop globale basato su Pointer Events
	// -------------------------------------------------------------------------
	interface DragSession {
		id: string;
		entry: CommandManifestEntry;
		source: 'palette' | 'preview';
		originPin?: PinnedCommand;
		clientX: number;
		clientY: number;
	}

	let activeDrag = $state<DragSession | null>(null);

	function startDragFromPalette(entry: CommandManifestEntry, clientX: number, clientY: number) {
		activeDrag = {
			id: entry.id,
			entry,
			source: 'palette',
			clientX,
			clientY
		};
		selectedCommandId = entry.id;
		attachGlobalDragListeners();
	}

	function startDragFromPreview(pinItem: PinnedCommand, clientX: number, clientY: number) {
		const entry = entryMap.get(pinItem.id);
		if (!entry || entry.locked) return;
		activeDrag = {
			id: pinItem.id,
			entry,
			source: 'preview',
			originPin: pinItem,
			clientX,
			clientY
		};
		selectedCommandId = pinItem.id;
		attachGlobalDragListeners();
	}

	function handleGlobalPointerMove(e: PointerEvent) {
		if (!activeDrag) return;
		activeDrag.clientX = e.clientX;
		activeDrag.clientY = e.clientY;
	}

	function handleGlobalPointerUp(e: PointerEvent) {
		if (!activeDrag) return;
		const dropX = e.clientX;
		const dropY = e.clientY;

		// Rilevamento della drop zone sotto il cursore
		const elUnderPointer = document.elementFromPoint(dropX, dropY);
		const dropTarget = elUnderPointer?.closest('[data-drop-zone]') as HTMLElement | null;
		const dropZoneAttr = dropTarget?.dataset.dropZone;

		if (dropZoneAttr) {
			const targetZone: ComposerZone =
				dropZoneAttr.startsWith('toolbar') ? 'toolbar' : 'statusLine';

			const canDropInZone = activeDrag.entry.supported.some((p) => p.zone === targetZone);
			if (canDropInZone) {
				// Trova la forma preferita
				const preferredForm = activeDrag.originPin?.form ?? activeDrag.entry.supported.find((p) => p.zone === targetZone)!.form;

				// Calcolo della posizione target in base alla prossimità visiva dei pin esistenti
				const pinElements = Array.from(
					dropTarget.querySelectorAll<HTMLElement>('[data-pin-id]')
				);
				let targetIndex = pinElements.length;

				for (let i = 0; i < pinElements.length; i++) {
					const rect = pinElements[i].getBoundingClientRect();
					const midX = rect.left + rect.width / 2;
					if (dropX < midX) {
						targetIndex = i;
						break;
					}
				}

				const newLayout = placePin(
					resolvedLayout,
					COMMAND_MANIFEST,
					activeDrag.id,
					{ zone: targetZone, form: preferredForm },
					targetIndex
				);
				handleLayoutChange(newLayout);
			}
		} else if (activeDrag.source === 'preview') {
			// Se un pin del composer viene trascinato fuori dalle zone valide, viene rimosso
			handleRemovePin(activeDrag.id);
		}

		endDrag();
	}

	function handleGlobalKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			endDrag();
		}
	}

	function attachGlobalDragListeners() {
		window.addEventListener('pointermove', handleGlobalPointerMove);
		window.addEventListener('pointerup', handleGlobalPointerUp);
		window.addEventListener('keydown', handleGlobalKeyDown, true);
	}

	function endDrag() {
		activeDrag = null;
		window.removeEventListener('pointermove', handleGlobalPointerMove);
		window.removeEventListener('pointerup', handleGlobalPointerUp);
		window.removeEventListener('keydown', handleGlobalKeyDown, true);
	}
</script>

<div class="commands-section settings-section">
	<!-- Intestazione della sezione (allineata alla convenzione standard) -->
	<div class="section-header">
		<div class="section-header-copy">
			<h4>{m.settings_commands_title()}</h4>
			<p class="section-desc">{m.settings_commands_desc()}</p>
		</div>
	</div>

	<!-- Editor di layout: Fake Composer interattivo -->
	<ComposerPreview
		layout={resolvedLayout}
		manifest={COMMAND_MANIFEST}
		selectedId={selectedCommandId}
		activeDrag={activeDrag}
		onSelect={selectEntry}
		onRemovePin={handleRemovePin}
		onResetRequest={() => (showResetConfirm = true)}
		onStartPinDrag={startDragFromPreview}
	/>

	<!-- Dialogo di conferma ripristino fabbrica -->
	<ConfirmDialog
		open={showResetConfirm}
		title={m.settings_commands_reset_confirm_title()}
		message={m.settings_commands_reset_confirm_desc()}
		confirmLabel={m.settings_commands_reset_confirm_action()}
		tone="danger"
		onConfirm={handleConfirmReset}
		onCancel={() => (showResetConfirm = false)}
	/>

	<!-- Area inferiore: Palette comandi disponibili a sinistra + Dettaglio a destra -->
	<div class="lower-grid">
		<div class="grid-palette">
			<CommandPalette
				manifest={COMMAND_MANIFEST}
				{pinnedIds}
				bind:searchQuery
				selectedId={selectedCommandId}
				newCommands={uncataloguedBuiltinCommands}
				{selectedNewCommand}
				onSelect={selectEntry}
				onSelectNew={selectNewCommand}
				onQuickPin={handleQuickPin}
				onStartDrag={startDragFromPalette}
			/>
		</div>

		<div class="grid-detail">
			<CommandDetail
				entry={selectedEntry}
				newCommand={selectedNewCommand}
				layout={resolvedLayout}
				onTogglePin={handleTogglePin}
				onChangePlacement={handleChangePlacement}
			/>
		</div>
	</div>

	<!-- Fantasma di trascinamento (Drag Ghost) -->
	{#if activeDrag}
		<div
			class="drag-ghost"
			style="left: {activeDrag.clientX + 10}px; top: {activeDrag.clientY + 10}px;"
		>
			<CommandIcon icon={activeDrag.entry.icon} />
			<span class="ghost-title">{resolveCommandText(activeDrag.entry).title}</span>
		</div>
	{/if}
</div>

<style>
	.commands-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	.section-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--line);
	}

	.section-header h4 {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.section-desc {
		margin: 2px 0 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.lower-grid {
		display: grid;
		grid-template-columns: 1fr 340px;
		gap: var(--space-4);
		align-items: start;
	}

	.grid-palette {
		min-width: 0;
	}

	.grid-detail {
		min-width: 0;
	}

	/* Ghost visivo durante il trascinamento */
	.drag-ghost {
		position: fixed;
		z-index: 10000;
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		background: var(--bg-raised);
		color: var(--ink);
		border: 1px solid var(--brand);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		font-size: var(--text-xs);
		font-weight: 500;
		transform: translate3d(0, 0, 0);
	}

	.ghost-title {
		white-space: nowrap;
	}

	@media (max-width: 820px) {
		.lower-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
