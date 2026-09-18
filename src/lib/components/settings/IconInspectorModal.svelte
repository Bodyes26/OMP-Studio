<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		IconClose,
		IconSearch,
		IconCheck,
		IconCopy,
		IconSparkles,
		IconBrain,
		IconGrip,
		IconPencil,
		// Affordance
		IconPlus,
		IconChevronRight,
		IconChevronLeft,
		IconChevronDown,
		IconArrowRight,
		IconArrowLeft,
		IconArrowDown,
		IconArrowUp,
		IconExternalLink,
		IconRefresh,
		IconLoop,
		IconZoomIn,
		IconZoomOut,
		IconGlobe,
		IconLock,
		IconCamera,
		IconAttach,
		IconPin,
		IconPinned,
		// Barra progetti & guscio
		IconGhost,
		IconNewChat,
		IconSettings,
		IconWarning,
		IconQuota,
		IconKeyboard,
		// Azioni
		IconFolderOpen,
		IconFile,
		IconTerminal,
		IconEditor,
		IconRename,
		IconPlay,
		IconQueue,
		IconAuto,
		IconCloseOthers,
		IconGitBranch,
		IconRule,
		IconSkill,
		IconDownload,
		// Editor
		IconViewCode,
		IconViewSplit,
		IconViewPreview,
		IconDiff,
		IconUndo,
		IconRedo,
		IconCut,
		IconPaste,
		IconSelectAll,
		IconTrash,
		IconNewFile,
		IconNewFolder,
		IconSave,
		IconClear,
		// Stato
		IconStatusPending,
		IconStatusRunning,
		IconStatusDone,
		IconStatusFailed,
		// Controlli
		IconCheckbox,
		IconCheckboxChecked,
		IconRadio,
		IconRadioChecked,
		IconNote,
		// Ruoli & AI
		IconRoleDefault,
		IconRolePlan,
		IconRoleSmol,
		IconRoleSlow,
		IconRoleVision,
		IconContextWindow,
		IconRoleTask,
		IconRoleCommit,
		IconRoleAdvisor,
		IconDiamond,
		IconSubagents,
		// Inspector & Lab
		IconInspect,
		IconNetwork,
		IconHistory,
		IconSend,
		IconColumns3,
		IconRows2,
		IconPanelLeft,
		IconPanelLeftClose,
		IconLab
	} from '$lib/icons';

	let { open = false, onClose }: { open: boolean; onClose: () => void } = $props();

	let searchQuery = $state('');
	let selectedCategory = $state<'all' | 'ai' | 'affordance' | 'actions' | 'editor' | 'status' | 'audit'>('all');
	let previewSize = $state<'14px' | '16px' | '20px' | '24px'>('16px');
	let copiedName = $state<string | null>(null);

	interface IconEntry {
		name: string;
		glyph: string;
		category: 'ai' | 'affordance' | 'actions' | 'editor' | 'status' | 'layout';
		component: any;
		description: string;
	}

	const ICONS_CATALOG: IconEntry[] = [
		// Intelligenza & Ruoli
		{ name: 'IconBrain', glyph: 'brain', category: 'ai', component: IconBrain, description: 'Thinking effort e reasoning slider' },
		{ name: 'IconRoleDefault', glyph: 'message-circle', category: 'ai', component: IconRoleDefault, description: 'Ruolo default per chat generica' },
		{ name: 'IconRolePlan', glyph: 'diamond', category: 'ai', component: IconRolePlan, description: 'Ruolo plan per architettura e scomposizione' },
		{ name: 'IconRoleSmol', glyph: 'zap', category: 'ai', component: IconRoleSmol, description: 'Ruolo smol per task rapidi o meccanici' },
		{ name: 'IconRoleSlow', glyph: 'infinity', category: 'ai', component: IconRoleSlow, description: 'Ruolo slow per modelli ad alto ragionamento' },
		{ name: 'IconRoleVision', glyph: 'eye', category: 'ai', component: IconRoleVision, description: 'Ruolo vision per modelli multimodali' },
		{ name: 'IconRoleAdvisor', glyph: 'shield-check', category: 'ai', component: IconRoleAdvisor, description: 'Ruolo advisor per revisioni e sicurezza' },
		{ name: 'IconRoleTask', glyph: 'split', category: 'ai', component: IconRoleTask, description: 'Ruolo task per deleghe operative' },
		{ name: 'IconRoleCommit', glyph: 'git-commit-horizontal', category: 'ai', component: IconRoleCommit, description: 'Ruolo commit per messaggi git' },
		{ name: 'IconContextWindow', glyph: 'scan-text', category: 'ai', component: IconContextWindow, description: 'Indicatore finestra di contesto del modello' },
		{ name: 'IconSubagents', glyph: 'split', category: 'ai', component: IconSubagents, description: 'Scomposizione e subagenti concorrenti' },
		{ name: 'IconDiamond', glyph: 'diamond', category: 'ai', component: IconDiamond, description: 'Simbolo di qualita o piano' },
		// Affordance
		{ name: 'IconClose', glyph: 'x', category: 'affordance', component: IconClose, description: 'Chiusura modali, schede e notifiche' },
		{ name: 'IconCheck', glyph: 'check', category: 'affordance', component: IconCheck, description: 'Conferma, salvataggio e spunta completato' },
		{ name: 'IconPlus', glyph: 'plus', category: 'affordance', component: IconPlus, description: 'Nuovo elemento, nuovo task, nuovo file' },
		{ name: 'IconChevronRight', glyph: 'chevron-right', category: 'affordance', component: IconChevronRight, description: 'Freccia espansione verso destra' },
		{ name: 'IconChevronLeft', glyph: 'chevron-left', category: 'affordance', component: IconChevronLeft, description: 'Freccia collasso verso sinistra' },
		{ name: 'IconChevronDown', glyph: 'chevron-down', category: 'affordance', component: IconChevronDown, description: 'Menu a tendina o accordion aperto' },
		{ name: 'IconArrowRight', glyph: 'arrow-right', category: 'affordance', component: IconArrowRight, description: 'Avanzamento o navigazione avanti' },
		{ name: 'IconArrowLeft', glyph: 'arrow-left', category: 'affordance', component: IconArrowLeft, description: 'Ritorno o navigazione indietro' },
		{ name: 'IconArrowDown', glyph: 'arrow-down', category: 'affordance', component: IconArrowDown, description: 'Download o scorrimento verso il basso' },
		{ name: 'IconArrowUp', glyph: 'arrow-up', category: 'affordance', component: IconArrowUp, description: 'Invio rapido o scorrimento verso l alto' },
		{ name: 'IconExternalLink', glyph: 'external-link', category: 'affordance', component: IconExternalLink, description: 'Apertura link esterno nel browser' },
		{ name: 'IconRefresh', glyph: 'refresh-cw', category: 'affordance', component: IconRefresh, description: 'Ricaricamento o sincronizzazione' },
		{ name: 'IconLoop', glyph: 'rotate-ccw', category: 'affordance', component: IconLoop, description: 'Ripristino o esecuzione ciclica' },
		{ name: 'IconZoomIn', glyph: 'zoom-in', category: 'affordance', component: IconZoomIn, description: 'Ingrandimento o zoom avanti' },
		{ name: 'IconZoomOut', glyph: 'zoom-out', category: 'affordance', component: IconZoomOut, description: 'Riduzione o zoom indietro' },
		{ name: 'IconSearch', glyph: 'search', category: 'affordance', component: IconSearch, description: 'Ricerca in file, comandi o modelli' },
		{ name: 'IconGlobe', glyph: 'globe', category: 'affordance', component: IconGlobe, description: 'Web, origini remote o rete' },
		{ name: 'IconLock', glyph: 'lock', category: 'affordance', component: IconLock, description: 'Sicurezza, permessi o lock' },
		{ name: 'IconCamera', glyph: 'camera', category: 'affordance', component: IconCamera, description: 'Cattura schermata o snapshot visivo' },
		{ name: 'IconAttach', glyph: 'paperclip', category: 'affordance', component: IconAttach, description: 'Allegato immagini o file nel task' },
		{ name: 'IconPin', glyph: 'pin', category: 'affordance', component: IconPin, description: 'Fissa in cima o barra' },
		{ name: 'IconPinned', glyph: 'pin-off', category: 'affordance', component: IconPinned, description: 'Sblocca elemento fissato' },
		{ name: 'IconSparkles', glyph: 'sparkles', category: 'affordance', component: IconSparkles, description: 'Funzionalita AI o suggerimenti' },
		{ name: 'IconGrip', glyph: 'grip-vertical', category: 'affordance', component: IconGrip, description: 'Maniglia di trascinamento e riordino D&D' },
		// Azioni
		{ name: 'IconFolderOpen', glyph: 'folder-open', category: 'actions', component: IconFolderOpen, description: 'Apertura cartella o progetto' },
		{ name: 'IconFile', glyph: 'file', category: 'actions', component: IconFile, description: 'File generico' },
		{ name: 'IconCopy', glyph: 'copy', category: 'actions', component: IconCopy, description: 'Copia negli appunti' },
		{ name: 'IconTerminal', glyph: 'square-terminal', category: 'actions', component: IconTerminal, description: 'Terminale integrato OMP' },
		{ name: 'IconEditor', glyph: 'code', category: 'actions', component: IconEditor, description: 'Editor di codice Monaco' },
		{ name: 'IconRename', glyph: 'square-pen', category: 'actions', component: IconRename, description: 'Rinomina file o progetto' },
		{ name: 'IconPencil', glyph: 'pencil', category: 'actions', component: IconPencil, description: 'Modifica testuale o disegno' },
		{ name: 'IconPlay', glyph: 'play', category: 'actions', component: IconPlay, description: 'Avvia task o esegui comando' },
		{ name: 'IconQueue', glyph: 'list', category: 'actions', component: IconQueue, description: 'Coda task del progetto' },
		{ name: 'IconAuto', glyph: 'zap', category: 'actions', component: IconAuto, description: 'Esecuzione automatica' },
		{ name: 'IconCloseOthers', glyph: 'square-x', category: 'actions', component: IconCloseOthers, description: 'Chiudi altre schede' },
		{ name: 'IconGitBranch', glyph: 'git-branch', category: 'actions', component: IconGitBranch, description: 'Ramo Git corrente' },
		{ name: 'IconRule', glyph: 'scroll-text', category: 'actions', component: IconRule, description: 'Regola di contesto o guida' },
		{ name: 'IconSkill', glyph: 'wand-sparkles', category: 'actions', component: IconSkill, description: 'Skill dell agente' },
		{ name: 'IconDownload', glyph: 'download', category: 'actions', component: IconDownload, description: 'Scarica aggiornamento o installer' },
		// Editor & Modifica
		{ name: 'IconViewCode', glyph: 'code', category: 'editor', component: IconViewCode, description: 'Vista codice sorgente' },
		{ name: 'IconViewSplit', glyph: 'columns-2', category: 'editor', component: IconViewSplit, description: 'Vista affiancata split' },
		{ name: 'IconViewPreview', glyph: 'eye', category: 'editor', component: IconViewPreview, description: 'Anteprima visiva' },
		{ name: 'IconDiff', glyph: 'file-diff', category: 'editor', component: IconDiff, description: 'Diff delle modifiche Git' },
		{ name: 'IconUndo', glyph: 'undo', category: 'editor', component: IconUndo, description: 'Annulla ultima operazione' },
		{ name: 'IconRedo', glyph: 'redo', category: 'editor', component: IconRedo, description: 'Ripristina operazione annullata' },
		{ name: 'IconCut', glyph: 'scissors', category: 'editor', component: IconCut, description: 'Taglia selezione' },
		{ name: 'IconPaste', glyph: 'clipboard-paste', category: 'editor', component: IconPaste, description: 'Incolla dagli appunti' },
		{ name: 'IconSelectAll', glyph: 'text-select', category: 'editor', component: IconSelectAll, description: 'Seleziona tutto il testo' },
		{ name: 'IconTrash', glyph: 'trash-2', category: 'editor', component: IconTrash, description: 'Elimina task, file o sessione' },
		{ name: 'IconNewFile', glyph: 'file-plus', category: 'editor', component: IconNewFile, description: 'Crea nuovo file' },
		{ name: 'IconNewFolder', glyph: 'folder-plus', category: 'editor', component: IconNewFolder, description: 'Crea nuova cartella' },
		{ name: 'IconSave', glyph: 'save', category: 'editor', component: IconSave, description: 'Salva file su disco' },
		{ name: 'IconClear', glyph: 'eraser', category: 'editor', component: IconClear, description: 'Pulisci terminale o storico' },
		// Stato
		{ name: 'IconStatusPending', glyph: 'circle', category: 'status', component: IconStatusPending, description: 'Task o job in attesa' },
		{ name: 'IconStatusRunning', glyph: 'circle-dot', category: 'status', component: IconStatusRunning, description: 'Task o job in esecuzione' },
		{ name: 'IconStatusDone', glyph: 'check', category: 'status', component: IconStatusDone, description: 'Task completato con successo' },
		{ name: 'IconStatusFailed', glyph: 'circle-x', category: 'status', component: IconStatusFailed, description: 'Task o job fallito o interrotto' },
		{ name: 'IconCheckbox', glyph: 'square', category: 'status', component: IconCheckbox, description: 'Casella non spuntata' },
		{ name: 'IconCheckboxChecked', glyph: 'square-check', category: 'status', component: IconCheckboxChecked, description: 'Casella spuntata' },
		{ name: 'IconRadio', glyph: 'circle', category: 'status', component: IconRadio, description: 'Opzione radio non selezionata' },
		{ name: 'IconRadioChecked', glyph: 'circle-dot', category: 'status', component: IconRadioChecked, description: 'Opzione radio attiva' },
		{ name: 'IconNote', glyph: 'notebook-pen', category: 'status', component: IconNote, description: 'Note o promemoria' }
	];

	// Elenco canditati raw inline SVG rilevati da scripts/check-icons.mjs
	const RAW_SVG_CANDIDATES = [
		{ file: 'src/lib/components/TaskEditor.svelte', lines: [579, 596, 611, 628, 722], icons: ['IconTrash', 'IconPlay', 'IconCheck', 'IconClose', 'IconAttach'], note: 'Pulsanti Elimina, Avvia, Salva, Chiudi e Allega usavano SVG inline.' },
		{ file: 'src/lib/components/AgentPanel.svelte', lines: [156, 227, 282], icons: ['IconPlus', 'IconGrip', 'IconPencil'], note: 'Pulsanti Nuovo task, Maniglia D&D e Modifica task.' },
		{ file: 'src/lib/components/models/ReasoningSlider.svelte', lines: [131], icons: ['IconBrain'], note: 'AGGIORNATO: L icona cervello grezza e stata sostituita con IconBrain da Lucide.' },
		{ file: 'src/lib/components/models/RolesTab.svelte', lines: [187, 297, 417, 540, 571], icons: ['IconSearch', 'IconRefresh', 'IconChevronUp', 'IconWarning'], note: 'Campi ricerca e pulsanti azione.' },
		{ file: 'src/lib/components/models/CatalogTab.svelte', lines: [189, 332], icons: ['IconSearch', 'IconChevronDown'], note: 'Filtro catalogo modelli e dropdown.' }
	];

	const filteredIcons = $derived(
		ICONS_CATALOG.filter((item) => {
			const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
			const q = searchQuery.trim().toLowerCase();
			const matchesQuery = !q || item.name.toLowerCase().includes(q) || item.glyph.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
			return matchesCategory && matchesQuery;
		})
	);

	function copyImport(name: string) {
		const snippet = `import { ${name} } from '$lib/icons';`;
		navigator.clipboard.writeText(snippet);
		copiedName = name;
		setTimeout(() => {
			if (copiedName === name) copiedName = null;
		}, 2000);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="modal-window"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="icon-inspector-title"
			onclick={(e) => e.stopPropagation()}
			transition:fly={{ y: 20, duration: 200, easing: cubicOut }}
		>
			<header class="modal-header">
				<div class="header-title-block">
					<div class="header-badge">
						<IconSparkles />
						<span>Standard Qualità Icone</span>
					</div>
					<h3 id="icon-inspector-title">Registro & Controllo Qualità Icone Studio</h3>
					<p class="header-desc">
						Controllo visivo di coerenza, rendering a tutte le scale e conformità agli standard Lucide (<code>src/lib/icons.ts</code>).
					</p>
				</div>
				<button type="button" class="btn-close" onclick={onClose} aria-label="Chiudi finestra">
					<IconClose />
				</button>
			</header>

			<div class="modal-toolbar">
				<div class="search-box">
					<IconSearch />
					<input
						type="search"
						bind:value={searchQuery}
						placeholder="Cerca per nome, glifo o utilizzo (es. brain, check, play)..."
						aria-label="Cerca icone"
					/>
					{#if searchQuery}
						<button type="button" class="clear-search" onclick={() => (searchQuery = '')}>
							<IconClose />
						</button>
					{/if}
				</div>

				<div class="category-tabs" role="tablist">
					<button type="button" class:active={selectedCategory === 'all'} onclick={() => selectedCategory = 'all'}>Tutte ({ICONS_CATALOG.length})</button>
					<button type="button" class:active={selectedCategory === 'ai'} onclick={() => selectedCategory = 'ai'}>AI & Ruoli</button>
					<button type="button" class:active={selectedCategory === 'affordance'} onclick={() => selectedCategory = 'affordance'}>Affordance</button>
					<button type="button" class:active={selectedCategory === 'actions'} onclick={() => selectedCategory = 'actions'}>Azioni</button>
					<button type="button" class:active={selectedCategory === 'editor'} onclick={() => selectedCategory = 'editor'}>Editor</button>
					<button type="button" class:active={selectedCategory === 'status'} onclick={() => selectedCategory = 'status'}>Stato</button>
					<button type="button" class="tab-audit" class:active={selectedCategory === 'audit'} onclick={() => selectedCategory = 'audit'}>Audit Inline SVG</button>
				</div>

				<div class="size-selector">
					<span class="size-label">Scala:</span>
					{#each ['14px', '16px', '20px', '24px'] as sz}
						<button
							type="button"
							class="btn-size"
							class:active={previewSize === sz}
							onclick={() => (previewSize = sz as any)}
						>
							{sz}
						</button>
					{/each}
				</div>
			</div>

			<div class="modal-body" style="--icon-size: {previewSize};">
				{#if selectedCategory === 'audit'}
					<div class="audit-section">
						<div class="audit-banner">
							<h4>Rapporto Audit: SVG Inline da Migrare</h4>
							<p>
								Per mantenere la massima coerenza visiva e rispettare la regola architetturale di Studio, ogni affordance o icona d'azione deve provenire dal registro centrale <code>$lib/icons</code> invece di usare SVG inline codificati a mano con spessori disallineati.
							</p>
						</div>

						<div class="audit-list">
							{#each RAW_SVG_CANDIDATES as item}
								<div class="audit-card">
									<div class="audit-card-header">
										<span class="audit-file">{item.file}</span>
										<span class="audit-badge">{item.icons.join(', ')}</span>
									</div>
									<p class="audit-note">{item.note}</p>
									<div class="audit-recs">
										<strong>Soluzione consigliata:</strong> importa dal registro:
										<code>import &#123; {item.icons.join(', ')} &#125; from '$lib/icons';</code>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="icons-grid">
						{#each filteredIcons as icon (icon.name)}
							{@const Comp = icon.component}
							<div class="icon-card">
								<div class="icon-preview-box">
									<div class="preview-stage">
										<Comp />
									</div>
									<span class="size-tag">{previewSize}</span>
								</div>

								<div class="icon-meta">
									<div class="icon-name-row">
										<strong class="icon-name">{icon.name}</strong>
										{#if icon.name === 'IconBrain'}
											<span class="badge-updated">Aggiornata</span>
										{/if}
									</div>
									<span class="icon-glyph">glifo: <code>{icon.glyph}</code></span>
									<span class="icon-desc">{icon.description}</span>
								</div>

								<button
									type="button"
									class="btn-copy-import"
									onclick={() => copyImport(icon.name)}
									title="Copia import snippet"
									aria-label={`Copia import per ${icon.name}`}
								>
									{#if copiedName === icon.name}
										<IconCheck />
										<span>Copiato!</span>
									{:else}
										<IconCopy />
										<span>Import</span>
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<footer class="modal-footer">
				<div class="footer-stats">
					<span><strong>89</strong> icone registrate</span>
					<span>·</span>
					<span><strong>100%</strong> Lucide compatibili</span>
					<span>·</span>
					<span>Audit automatico: <code>npm run check:icons</code></span>
				</div>
				<button type="button" class="btn-primary" onclick={onClose}>Chiudi</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.modal-window {
		width: 100%;
		max-width: 960px;
		height: 85vh;
		max-height: 800px;
		background: var(--bg-surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--line);
		background: var(--bg-base);
	}

	.header-title-block {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.header-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--brand);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.modal-header h3 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--ink);
	}

	.header-desc {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.btn-close {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		padding: 6px;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
		flex-wrap: wrap;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 4px 10px;
		flex: 1;
		min-width: 240px;
		color: var(--ink-muted);
	}

	.search-box input {
		border: none;
		background: transparent;
		color: var(--ink);
		font-size: var(--text-sm);
		width: 100%;
		outline: none;
	}

	.clear-search {
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		display: flex;
	}

	.category-tabs {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.category-tabs button {
		background: transparent;
		border: none;
		font-size: var(--text-xs);
		padding: 5px 10px;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		cursor: pointer;
		font-weight: 500;
	}

	.category-tabs button.active {
		background: var(--bg-base);
		color: var(--ink);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		font-weight: 600;
	}

	.category-tabs button.tab-audit {
		color: #eab308;
	}

	.category-tabs button.tab-audit.active {
		background: rgba(234, 179, 8, 0.15);
		color: #eab308;
	}

	.size-selector {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.size-label {
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.btn-size {
		background: transparent;
		border: 1px solid var(--line);
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		color: var(--ink-muted);
		cursor: pointer;
	}

	.btn-size.active {
		background: var(--brand);
		color: var(--brand-ink);
		border-color: var(--brand);
		font-weight: 600;
	}

	.modal-body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-4) var(--space-5);
	}

	.icons-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
		gap: var(--space-3);
	}

	.icon-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition: border-color 0.15s, transform 0.15s;
	}

	.icon-card:hover {
		border-color: var(--brand);
		transform: translateY(-1px);
	}

	.icon-preview-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
		padding: 12px;
	}

	.preview-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink);
	}

	.size-tag {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--ink-muted);
		background: var(--bg-base);
		padding: 1px 5px;
		border-radius: 3px;
		border: 1px solid var(--line);
	}

	.icon-meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.icon-name-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
	}

	.icon-name {
		font-size: var(--text-xs);
		color: var(--ink);
		font-weight: 600;
	}

	.badge-updated {
		font-size: 9px;
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
		padding: 1px 5px;
		border-radius: 3px;
		font-weight: 600;
	}

	.icon-glyph {
		font-size: 11px;
		color: var(--ink-muted);
	}

	.icon-glyph code {
		font-family: var(--font-mono);
	}

	.icon-desc {
		font-size: 11px;
		color: var(--ink-muted);
		line-height: 1.3;
		margin-top: 2px;
	}

	.btn-copy-import {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		font-size: 11px;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-copy-import:hover {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--ink-muted);
	}

	.audit-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.audit-banner {
		background: rgba(234, 179, 8, 0.1);
		border: 1px solid rgba(234, 179, 8, 0.3);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}

	.audit-banner h4 {
		margin: 0 0 4px 0;
		color: #eab308;
		font-size: var(--text-sm);
		font-weight: 700;
	}

	.audit-banner p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink);
		line-height: 1.4;
	}

	.audit-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.audit-card {
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.audit-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.audit-file {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
	}

	.audit-badge {
		font-size: 10px;
		background: var(--bg-sunken);
		color: var(--brand);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid var(--line);
		font-family: var(--font-mono);
	}

	.audit-note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.audit-recs {
		font-size: var(--text-xs);
		color: var(--ink);
		background: var(--bg-sunken);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.audit-recs code {
		display: block;
		font-family: var(--font-mono);
		color: var(--brand);
		margin-top: 2px;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--line);
		background: var(--bg-base);
	}

	.footer-stats {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.btn-primary {
		background: var(--brand);
		color: var(--brand-ink);
		border: none;
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 6px 16px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.btn-primary:hover {
		opacity: 0.9;
	}
</style>
