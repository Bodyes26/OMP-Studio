<script lang="ts">
	// Modale di ispezione e controllo qualita' delle icone Lucide (Design v2).
	// Usa la primitiva accessibile Dialog (APG modal con focus trap e rvLift)
	// e i controlli Segmented per categorie e scale.
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Segmented, { type SegmentedOption } from '$lib/ui/Segmented.svelte';
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
		IconLab,
		IconPrewalk
	} from '$lib/icons';

	let { open = false, onClose }: { open: boolean; onClose: () => void } = $props();

	type CategoryType = 'all' | 'ai' | 'affordance' | 'actions' | 'editor' | 'status' | 'audit';
	type SizeType = '14px' | '16px' | '20px' | '24px';

	let searchQuery = $state('');
	let selectedCategory = $state<CategoryType>('all');
	let previewSize = $state<SizeType>('16px');
	let copiedName = $state<string | null>(null);

	interface IconEntry {
		name: string;
		glyph: string;
		category: 'ai' | 'affordance' | 'actions' | 'editor' | 'status';
		component: any;
		description: string;
	}

	const ICONS_CATALOG: IconEntry[] = [
		// Intelligenza & Ruoli
		{ name: 'IconBrain', glyph: 'brain', category: 'ai', component: IconBrain, description: m.icon_inspector_desc_brain() },
		{ name: 'IconRoleDefault', glyph: 'message-circle', category: 'ai', component: IconRoleDefault, description: m.icon_inspector_desc_role_default() },
		{ name: 'IconRolePlan', glyph: 'diamond', category: 'ai', component: IconRolePlan, description: m.icon_inspector_desc_role_plan() },
		{ name: 'IconRoleSmol', glyph: 'zap', category: 'ai', component: IconRoleSmol, description: m.icon_inspector_desc_role_smol() },
		{ name: 'IconRoleSlow', glyph: 'infinity', category: 'ai', component: IconRoleSlow, description: m.icon_inspector_desc_role_slow() },
		{ name: 'IconRoleVision', glyph: 'eye', category: 'ai', component: IconRoleVision, description: m.icon_inspector_desc_role_vision() },
		{ name: 'IconRoleAdvisor', glyph: 'shield-check', category: 'ai', component: IconRoleAdvisor, description: m.icon_inspector_desc_role_advisor() },
		{ name: 'IconRoleTask', glyph: 'split', category: 'ai', component: IconRoleTask, description: m.icon_inspector_desc_role_task() },
		{ name: 'IconRoleCommit', glyph: 'git-commit-horizontal', category: 'ai', component: IconRoleCommit, description: m.icon_inspector_desc_role_commit() },
		{ name: 'IconContextWindow', glyph: 'scan-text', category: 'ai', component: IconContextWindow, description: m.icon_inspector_desc_context_window() },
		{ name: 'IconSubagents', glyph: 'split', category: 'ai', component: IconSubagents, description: m.icon_inspector_desc_subagents() },
		{ name: 'IconDiamond', glyph: 'diamond', category: 'ai', component: IconDiamond, description: m.icon_inspector_desc_diamond() },
		{ name: 'IconPrewalk', glyph: 'footprints', category: 'ai', component: IconPrewalk, description: m.icon_inspector_desc_prewalk() },
		// Affordance
		{ name: 'IconClose', glyph: 'x', category: 'affordance', component: IconClose, description: m.icon_inspector_desc_close() },
		{ name: 'IconCheck', glyph: 'check', category: 'affordance', component: IconCheck, description: m.icon_inspector_desc_check() },
		{ name: 'IconPlus', glyph: 'plus', category: 'affordance', component: IconPlus, description: m.icon_inspector_desc_plus() },
		{ name: 'IconChevronRight', glyph: 'chevron-right', category: 'affordance', component: IconChevronRight, description: m.icon_inspector_desc_chevron_right() },
		{ name: 'IconChevronLeft', glyph: 'chevron-left', category: 'affordance', component: IconChevronLeft, description: m.icon_inspector_desc_chevron_left() },
		{ name: 'IconChevronDown', glyph: 'chevron-down', category: 'affordance', component: IconChevronDown, description: m.icon_inspector_desc_chevron_down() },
		{ name: 'IconArrowRight', glyph: 'arrow-right', category: 'affordance', component: IconArrowRight, description: m.icon_inspector_desc_arrow_right() },
		{ name: 'IconArrowLeft', glyph: 'arrow-left', category: 'affordance', component: IconArrowLeft, description: m.icon_inspector_desc_arrow_left() },
		{ name: 'IconArrowDown', glyph: 'arrow-down', category: 'affordance', component: IconArrowDown, description: m.icon_inspector_desc_arrow_down() },
		{ name: 'IconArrowUp', glyph: 'arrow-up', category: 'affordance', component: IconArrowUp, description: m.icon_inspector_desc_arrow_up() },
		{ name: 'IconExternalLink', glyph: 'external-link', category: 'affordance', component: IconExternalLink, description: m.icon_inspector_desc_external_link() },
		{ name: 'IconRefresh', glyph: 'refresh-cw', category: 'affordance', component: IconRefresh, description: m.icon_inspector_desc_refresh() },
		{ name: 'IconLoop', glyph: 'rotate-ccw', category: 'affordance', component: IconLoop, description: m.icon_inspector_desc_loop() },
		{ name: 'IconZoomIn', glyph: 'zoom-in', category: 'affordance', component: IconZoomIn, description: m.icon_inspector_desc_zoom_in() },
		{ name: 'IconZoomOut', glyph: 'zoom-out', category: 'affordance', component: IconZoomOut, description: m.icon_inspector_desc_zoom_out() },
		{ name: 'IconSearch', glyph: 'search', category: 'affordance', component: IconSearch, description: m.icon_inspector_desc_search() },
		{ name: 'IconGlobe', glyph: 'globe', category: 'affordance', component: IconGlobe, description: m.icon_inspector_desc_globe() },
		{ name: 'IconLock', glyph: 'lock', category: 'affordance', component: IconLock, description: m.icon_inspector_desc_lock() },
		{ name: 'IconCamera', glyph: 'camera', category: 'affordance', component: IconCamera, description: m.icon_inspector_desc_camera() },
		{ name: 'IconAttach', glyph: 'paperclip', category: 'affordance', component: IconAttach, description: m.icon_inspector_desc_attach() },
		{ name: 'IconPin', glyph: 'pin', category: 'affordance', component: IconPin, description: m.icon_inspector_desc_pin() },
		{ name: 'IconPinned', glyph: 'pin-off', category: 'affordance', component: IconPinned, description: m.icon_inspector_desc_pinned() },
		{ name: 'IconSparkles', glyph: 'sparkles', category: 'affordance', component: IconSparkles, description: m.icon_inspector_desc_sparkles() },
		{ name: 'IconGrip', glyph: 'grip-vertical', category: 'affordance', component: IconGrip, description: m.icon_inspector_desc_grip() },
		// Azioni
		{ name: 'IconFolderOpen', glyph: 'folder-open', category: 'actions', component: IconFolderOpen, description: m.icon_inspector_desc_folder_open() },
		{ name: 'IconFile', glyph: 'file', category: 'actions', component: IconFile, description: m.icon_inspector_desc_file() },
		{ name: 'IconCopy', glyph: 'copy', category: 'actions', component: IconCopy, description: m.icon_inspector_desc_copy() },
		{ name: 'IconTerminal', glyph: 'square-terminal', category: 'actions', component: IconTerminal, description: m.icon_inspector_desc_terminal() },
		{ name: 'IconEditor', glyph: 'code', category: 'actions', component: IconEditor, description: m.icon_inspector_desc_editor() },
		{ name: 'IconRename', glyph: 'square-pen', category: 'actions', component: IconRename, description: m.icon_inspector_desc_rename() },
		{ name: 'IconPencil', glyph: 'pencil', category: 'actions', component: IconPencil, description: m.icon_inspector_desc_pencil() },
		{ name: 'IconPlay', glyph: 'play', category: 'actions', component: IconPlay, description: m.icon_inspector_desc_play() },
		{ name: 'IconQueue', glyph: 'list', category: 'actions', component: IconQueue, description: m.icon_inspector_desc_queue() },
		{ name: 'IconAuto', glyph: 'zap', category: 'actions', component: IconAuto, description: m.icon_inspector_desc_auto() },
		{ name: 'IconCloseOthers', glyph: 'square-x', category: 'actions', component: IconCloseOthers, description: m.icon_inspector_desc_close_others() },
		{ name: 'IconGitBranch', glyph: 'git-branch', category: 'actions', component: IconGitBranch, description: m.icon_inspector_desc_git_branch() },
		{ name: 'IconRule', glyph: 'scroll-text', category: 'actions', component: IconRule, description: m.icon_inspector_desc_rule() },
		{ name: 'IconSkill', glyph: 'wand-sparkles', category: 'actions', component: IconSkill, description: m.icon_inspector_desc_skill() },
		{ name: 'IconDownload', glyph: 'download', category: 'actions', component: IconDownload, description: m.icon_inspector_desc_download() },
		// Editor & Modifica
		{ name: 'IconViewCode', glyph: 'code', category: 'editor', component: IconViewCode, description: m.icon_inspector_desc_view_code() },
		{ name: 'IconViewSplit', glyph: 'columns-2', category: 'editor', component: IconViewSplit, description: m.icon_inspector_desc_view_split() },
		{ name: 'IconViewPreview', glyph: 'eye', category: 'editor', component: IconViewPreview, description: m.icon_inspector_desc_view_preview() },
		{ name: 'IconDiff', glyph: 'file-diff', category: 'editor', component: IconDiff, description: m.icon_inspector_desc_diff() },
		{ name: 'IconUndo', glyph: 'undo', category: 'editor', component: IconUndo, description: m.icon_inspector_desc_undo() },
		{ name: 'IconRedo', glyph: 'redo', category: 'editor', component: IconRedo, description: m.icon_inspector_desc_redo() },
		{ name: 'IconCut', glyph: 'scissors', category: 'editor', component: IconCut, description: m.icon_inspector_desc_cut() },
		{ name: 'IconPaste', glyph: 'clipboard-paste', category: 'editor', component: IconPaste, description: m.icon_inspector_desc_paste() },
		{ name: 'IconSelectAll', glyph: 'text-select', category: 'editor', component: IconSelectAll, description: m.icon_inspector_desc_select_all() },
		{ name: 'IconTrash', glyph: 'trash-2', category: 'editor', component: IconTrash, description: m.icon_inspector_desc_trash() },
		{ name: 'IconNewFile', glyph: 'file-plus', category: 'editor', component: IconNewFile, description: m.icon_inspector_desc_new_file() },
		{ name: 'IconNewFolder', glyph: 'folder-plus', category: 'editor', component: IconNewFolder, description: m.icon_inspector_desc_new_folder() },
		{ name: 'IconSave', glyph: 'save', category: 'editor', component: IconSave, description: m.icon_inspector_desc_save() },
		{ name: 'IconClear', glyph: 'eraser', category: 'editor', component: IconClear, description: m.icon_inspector_desc_clear() },
		// Stato
		{ name: 'IconStatusPending', glyph: 'circle', category: 'status', component: IconStatusPending, description: m.icon_inspector_desc_status_pending() },
		{ name: 'IconStatusRunning', glyph: 'circle-dot', category: 'status', component: IconStatusRunning, description: m.icon_inspector_desc_status_running() },
		{ name: 'IconStatusDone', glyph: 'check', category: 'status', component: IconStatusDone, description: m.icon_inspector_desc_status_done() },
		{ name: 'IconStatusFailed', glyph: 'circle-x', category: 'status', component: IconStatusFailed, description: m.icon_inspector_desc_status_failed() },
		{ name: 'IconCheckbox', glyph: 'square', category: 'status', component: IconCheckbox, description: m.icon_inspector_desc_checkbox() },
		{ name: 'IconCheckboxChecked', glyph: 'square-check', category: 'status', component: IconCheckboxChecked, description: m.icon_inspector_desc_checkbox_checked() },
		{ name: 'IconRadio', glyph: 'circle', category: 'status', component: IconRadio, description: m.icon_inspector_desc_radio() },
		{ name: 'IconRadioChecked', glyph: 'circle-dot', category: 'status', component: IconRadioChecked, description: m.icon_inspector_desc_radio_checked() },
		{ name: 'IconNote', glyph: 'notebook-pen', category: 'status', component: IconNote, description: m.icon_inspector_desc_note() }
	];

	// Elenco candidati raw inline SVG rilevati
	const RAW_SVG_CANDIDATES = [
		{ file: 'src/lib/components/TaskEditor.svelte', lines: [579, 596, 611, 628, 722], icons: ['IconTrash', 'IconPlay', 'IconCheck', 'IconClose', 'IconAttach'], note: m.icon_inspector_audit_note_task_editor() },
		{ file: 'src/lib/components/AgentPanel.svelte', lines: [156, 227, 282], icons: ['IconPlus', 'IconGrip', 'IconPencil'], note: m.icon_inspector_audit_note_agent_panel() },
		{ file: 'src/lib/components/models/ReasoningSlider.svelte', lines: [131], icons: ['IconBrain'], note: m.icon_inspector_audit_note_reasoning() },
		{ file: 'src/lib/components/models/RolesTab.svelte', lines: [187, 297, 417, 540, 571], icons: ['IconSearch', 'IconRefresh', 'IconChevronUp', 'IconWarning'], note: m.icon_inspector_audit_note_roles() },
		{ file: 'src/lib/components/models/CatalogTab.svelte', lines: [189, 332], icons: ['IconSearch', 'IconChevronDown'], note: m.icon_inspector_audit_note_catalog() }
	];

	const categoryOptions = $derived<SegmentedOption<CategoryType>[]>([
		{ value: 'all', label: m.icon_inspector_cat_all(), count: ICONS_CATALOG.length },
		{ value: 'ai', label: m.icon_inspector_cat_ai() },
		{ value: 'affordance', label: 'Affordance' },
		{ value: 'actions', label: m.icon_inspector_cat_actions() },
		{ value: 'editor', label: m.icon_inspector_cat_editor() },
		{ value: 'status', label: m.icon_inspector_cat_status() },
		{ value: 'audit', label: m.icon_inspector_cat_audit(), count: RAW_SVG_CANDIDATES.length, countTone: 'attention' }
	]);

	const sizeOptions: SegmentedOption<SizeType>[] = [
		{ value: '14px', label: '14px' },
		{ value: '16px', label: '16px' },
		{ value: '20px', label: '20px' },
		{ value: '24px', label: '24px' }
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
		void navigator.clipboard.writeText(snippet);
		copiedName = name;
		setTimeout(() => {
			if (copiedName === name) copiedName = null;
		}, 2000);
	}
</script>

<Dialog
	{open}
	{onClose}
	title={m.icon_inspector_title()}
	size="wide"
	flush
>
	{#snippet actions()}
		<span class="header-badge">
			<IconSparkles />
			<span>{m.icon_inspector_badge()}</span>
		</span>
	{/snippet}

	<div class="modal-layout">
		<div class="modal-subhead">
			<p class="header-desc">
				{m.icon_inspector_desc_before()}<code>src/lib/icons.ts</code>).
			</p>
		</div>

		<div class="modal-toolbar">
			<div class="search-box-wrap">
				<span class="search-icon" aria-hidden="true"><IconSearch /></span>
				<input
					type="search"
					class="ui-input search-input"
					bind:value={searchQuery}
					placeholder={m.icon_inspector_search_placeholder()}
					aria-label={m.icon_inspector_search_aria()}
				/>
				{#if searchQuery}
					<button
						type="button"
						class="clear-search"
						onclick={() => (searchQuery = '')}
						aria-label={m.icon_inspector_clear_search()}
					>
						<IconClose />
					</button>
				{/if}
			</div>

			<div class="toolbar-segmented-group">
				<Segmented
					options={categoryOptions}
					value={selectedCategory}
					onChange={(v) => (selectedCategory = v)}
					ariaLabel={m.icon_inspector_category_aria()}
				/>

				<div class="size-selector-wrap">
					<span class="size-label">{m.icon_inspector_scale_label()}</span>
					<Segmented
						options={sizeOptions}
						value={previewSize}
						onChange={(v) => (previewSize = v)}
						ariaLabel={m.icon_inspector_scale_aria()}
					/>
				</div>
			</div>
		</div>

		<div class="modal-body" style="--icon-size: {previewSize};">
			{#if selectedCategory === 'audit'}
				<div class="audit-section">
					<div class="audit-banner">
						<h4>{m.icon_inspector_audit_title()}</h4>
						<p>
							{m.icon_inspector_audit_desc_before()} <code>$lib/icons</code> {m.icon_inspector_audit_desc_after()}
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
									<strong>{m.icon_inspector_audit_fix()}</strong> {m.icon_inspector_audit_fix_import()}
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
										<span class="badge-updated">{m.icon_inspector_updated()}</span>
									{/if}
								</div>
								<span class="icon-glyph">{m.icon_inspector_glyph()} <code>{icon.glyph}</code></span>
								<span class="icon-desc">{icon.description}</span>
							</div>

							<button
								type="button"
								class="ui-button ui-button-secondary btn-copy-import"
								onclick={() => copyImport(icon.name)}
								aria-label={m.icon_inspector_copy_import_aria({ name: icon.name })}
							>
								{#if copiedName === icon.name}
									<IconCheck />
									<span>{m.icon_inspector_copied()}</span>
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
	</div>

	{#snippet footer()}
		<div class="footer-stats">
			<span><strong>{ICONS_CATALOG.length}</strong> {m.icon_inspector_registered()}</span>
			<span>·</span>
			<span><strong>100%</strong> {m.icon_inspector_lucide()}</span>
			<span>·</span>
			<span>{m.icon_inspector_auto_audit()} <code>npm run check:icons</code></span>
		</div>
		<button type="button" class="ui-button ui-button-primary" onclick={onClose}>{m.common_close()}</button>
	{/snippet}
</Dialog>

<style>
	.header-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--ink-muted);
		text-transform: none;
		letter-spacing: normal;
		--icon-size: 13px;
	}

	.modal-layout {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		flex: 1;
		background: var(--bg-base);
	}

	.modal-subhead {
		padding: var(--space-2) var(--space-4) 0;
	}

	.header-desc {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.header-desc code {
		font-family: var(--font-mono);
		color: var(--brand-ink);
	}

	.modal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
		background: var(--bg-sunken);
		flex-wrap: wrap;
	}

	.search-box-wrap {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 240px;
	}

	.search-icon {
		position: absolute;
		left: 8px;
		pointer-events: none;
		color: var(--ink-muted);
		--icon-size: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.search-input {
		width: 100%;
		padding-left: 28px;
		padding-right: 28px;
	}

	.clear-search {
		position: absolute;
		right: 6px;
		background: transparent;
		border: none;
		color: var(--ink-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: var(--radius-sm);
		--icon-size: 12px;
		transition: color var(--dur-fast) var(--ease-out);
	}

	.clear-search:hover {
		color: var(--ink);
	}

	.toolbar-segmented-group {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.size-selector-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.size-label {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		font-weight: 500;
	}

	.modal-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-4);
	}

	.icons-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
		gap: var(--space-3);
	}

	.icon-card {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition: border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
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
		font-size: var(--text-caption);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		background: var(--bg-base);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
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
		font-size: var(--text-label);
		color: var(--ink);
		font-weight: 600;
	}

	.badge-updated {
		font-size: var(--text-caption);
		background: var(--bg-sunken);
		color: var(--ink-muted);
		border: 1px solid var(--line);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		font-weight: 500;
	}

	.icon-glyph {
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.icon-glyph code {
		font-family: var(--font-mono);
	}

	.icon-desc {
		font-size: var(--text-caption);
		color: var(--ink-muted);
		line-height: 1.35;
		margin-top: 2px;
	}

	.btn-copy-import {
		margin-top: auto;
		font-size: var(--text-caption);
		padding: 4px 8px;
		--icon-size: 13px;
		gap: 6px;
	}

	.audit-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.audit-banner {
		background: color-mix(in oklab, var(--warn) 10%, var(--bg-sunken));
		border: 1px solid color-mix(in oklab, var(--warn) 30%, transparent);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}

	.audit-banner h4 {
		margin: 0 0 4px 0;
		color: var(--warn);
		font-size: var(--text-body);
		font-weight: 600;
	}

	.audit-banner p {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink);
		line-height: 1.4;
	}

	.audit-banner code {
		font-family: var(--font-mono);
		color: var(--brand-ink);
	}

	.audit-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.audit-card {
		background: var(--bg-raised);
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
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--ink);
	}

	.audit-badge {
		font-size: var(--text-caption);
		background: var(--bg-sunken);
		color: var(--brand-ink);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
		font-family: var(--font-mono);
	}

	.audit-note {
		margin: 0;
		font-size: var(--text-label);
		color: var(--ink-muted);
	}

	.audit-recs {
		font-size: var(--text-label);
		color: var(--ink);
		background: var(--bg-sunken);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.audit-recs code {
		display: block;
		font-family: var(--font-mono);
		color: var(--brand-ink);
		margin-top: 2px;
	}

	.footer-stats {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		margin-right: auto;
	}

	.footer-stats code {
		font-family: var(--font-mono);
	}
</style>
