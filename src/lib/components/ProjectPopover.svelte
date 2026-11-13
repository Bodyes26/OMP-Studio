<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { projectStore, normalizeProjectPath, isWindows, type Project } from '#lib/stores/projects.svelte.ts';
	import { projectOrder } from '#lib/stores/projectOrder.svelte.ts';
	import { taskStore } from '#lib/stores/tasks.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { companionStore } from '#lib/stores/companion.svelte.ts';
	import { githubStore } from '#lib/stores/github.svelte.ts';
	import { gitDiffStore } from '#lib/stores/gitDiff.svelte.ts';
	import { laneStore, type LaneRecord } from '#lib/stores/lanes.svelte.ts';
	import { MAIN_LANE_ID, type AgentLane, type ProjectId } from '#lib/types/lanes.ts';
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { askQuestionText } from '#lib/agent/askTitle.ts';
	import { anchoredPopover } from '#lib/anchoredPopover.ts';
	import { associateDraftToProject } from '#lib/lanes/laneActions.ts';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import HuePicker from './HuePicker.svelte';
	import ProjectQueueView from './ProjectQueueView.svelte';
	import ProjectGitView from './ProjectGitView.svelte';
	import ProjectLanesView from './ProjectLanesView.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import StatusMark from '#lib/ui/StatusMark.svelte';
	import IconAutomation from './automations/IconAutomation.svelte';
	import {
		IconArrowLeft, IconArrowRight, IconChevronLeft, IconChevronRight,
		IconClose, IconCopy, IconGhost, IconLab, IconGitBranch, IconPlus,
		IconQueue, IconFolderOpen
	} from '#lib/icons.ts';

	interface Props {
		project: Project;
		anchor: HTMLElement | null;
		pinned?: boolean;
		autoHue: number;
		onClose: () => void;
		onHoverChange: (inside: boolean) => void;
		onRunTask?: (projectId: string, taskId: string, follow: boolean, newWorktree?: boolean) => boolean | Promise<boolean>;
		onEditTask?: (projectId: string, taskId: string) => void;
		onNewTask?: (projectId: string) => void;
		onRequestCloseProject: (projectId: string) => void;
		onReviewLane: (lane: AgentLane | LaneRecord) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
	}
	let { project, anchor, pinned = false, autoHue, onClose, onHoverChange,
		onRunTask, onEditTask, onNewTask, onRequestCloseProject, onReviewLane,
		canRunTask, runReason }: Props = $props();

	type View = 'home' | 'queue' | 'git' | 'lanes' | 'associate';
	let panelEl = $state<HTMLElement | null>(null);
	let stageEl = $state<HTMLElement | null>(null);
	let bodyEl = $state<HTMLElement | null>(null);
	let fieldEl = $state<HTMLInputElement | null>(null);
	let view = $state<View>('home');
	let colorOpen = $state(false);
	let moving = $state(false);
	let fixedPosition = $state<{ left: number; top: number } | null>(null);
	let editing = $state<{ projectId: string; field: 'name' | 'label' } | null>(null);
	let fieldDraft = $state('');
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let navEpoch = 0;
	let lastProjectId: string | null = null;
	let contentEl = $state<HTMLElement | null>(null);
	let prePinned = untrack(() => pinned);
	let morphFrom: { width: number; height: number; clone: HTMLElement } | null = null;
	// Passaggio anteprima -> card fissata: e' lo stesso nodo, quindi la
	// cornice cambia misura e il vecchio contenuto sfuma sopra il nuovo.
	$effect.pre(() => {
		const next = pinned;
		if (next === prePinned) return;
		prePinned = next;
		if (!panelEl || !contentEl || reducedMotion()) return;
		const rect = panelEl.getBoundingClientRect();
		const clone = contentEl.cloneNode(true) as HTMLElement;
		clone.setAttribute('aria-hidden', 'true');
		clone.setAttribute('inert', '');
		clone.style.cssText = `position:absolute;left:0;top:0;width:${rect.width - 2}px;box-sizing:border-box;padding:${next ? 16 : 0}px;pointer-events:none;`;
		morphFrom = { width: rect.width, height: rect.height, clone };
	});
	$effect(() => {
		void pinned;
		const from = morphFrom;
		if (!from || !panelEl) return;
		morphFrom = null;
		const el = panelEl;
		const to = el.getBoundingClientRect();
		const easing = 'cubic-bezier(.22,.61,.36,1)';
		el.style.overflow = 'hidden';
		el.appendChild(from.clone);
		const done = [
			el.animate([{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }], { duration: 210, easing }).finished,
			from.clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'ease-out', fill: 'forwards' }).finished,
			contentEl?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: 210, easing }).finished
		];
		Promise.allSettled(done).then(() => {
			from.clone.remove();
			el.style.overflow = '';
		});
	});
	let lastPinned = false;

	const isDraft = $derived(Boolean(project.labDraft));
	const isScratchpad = $derived(!project.canonicalProjectPath && !isDraft);
	const hasWorkspace = $derived(Boolean(project.canonicalProjectPath) && !isDraft && !project.external);
	const canGit = $derived(hasWorkspace && gitDiffStore.forPath(project.canonicalProjectPath!).isRepo !== false);
	const hue = $derived(project.colorMode === 'custom' ? project.hue : autoHue);
	const queueCount = $derived(project.canonicalProjectPath ? taskStore.tasksFor(project.canonicalProjectPath).length : 0);
	const upstream = $derived(project.canonicalProjectPath ? githubStore.upstreamByPath[normalizeProjectPath(project.canonicalProjectPath).toLowerCase()] : null);
	const lanes = $derived(laneStore.lanesFor(project.id as ProjectId).filter(l => l.laneId !== MAIN_LANE_ID && l.status !== 'archived'));
	const attention = $derived(companionStore.attentionRequests.find(r => r.projectId === project.id));
	const realProjects = $derived(projectStore.projects.filter(p => p.canonicalProjectPath && !p.labDraft && !p.external));
	const position = $derived(projectOrder.list.findIndex(p => p.id === project.id));
	const manualOrder = $derived(settingsStore.projectBar.order === 'fixed');
	const stateLabel = $derived.by(() => {
		switch (project.lane.agentState) {
			case 'working': return m.topbar_agent_state_working();
			case 'attention': return m.topbar_agent_state_attention();
			case 'finished': return m.topbar_agent_state_finished();
			case 'unknown': return m.topbar_agent_state_unknown();
			default: return m.topbar_agent_state_idle();
		}
	});
	const title = $derived(view === 'queue' ? m.project_tabs_core_queue() : view === 'git' ? m.project_tabs_core_git() : view === 'lanes' ? m.project_tabs_core_lanes() : m.lab_lane_associate_project());
	const displayPath = $derived.by(() => {
		const path = project.canonicalProjectPath;
		if (!path) return '';
		const normalized = normalizeProjectPath(path).replaceAll('\\', '/');
		const root = normalizeProjectPath(projectStore.projectRoot).replaceAll('\\', '/');
		if (!root) return normalized;
		const key = isWindows ? normalized.toLowerCase() : normalized;
		const rootKey = isWindows ? root.toLowerCase() : root;
		if (key === rootKey) return '~';
		const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
		return key.startsWith(prefix) ? `~/${normalized.slice(prefix.length)}` : normalized;
	});

	function reducedMotion() {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.animations === 'false';
	}
	function flash(text: string) {
		notice = text;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => { notice = ''; }, 2600);
	}
	function beginEdit(field: 'name' | 'label') {
		finishEdit(true);
		editing = { projectId: project.id, field };
		fieldDraft = field === 'name' ? project.name : project.label ?? '';
	}
	function finishEdit(save: boolean) {
		const target = editing;
		if (!target) return;
		editing = null;
		if (!save || !projectStore.projects.some(p => p.id === target.projectId)) return;
		if (target.field === 'name') projectStore.renameProject(target.projectId, fieldDraft);
		else projectStore.setProjectLabel(target.projectId, fieldDraft);
	}
	function fieldKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		finishEdit(event.key === 'Enter');
	}
	$effect(() => {
		if (editing && fieldEl) {
			fieldEl.focus({ preventScroll: true });
			fieldEl.select();
		}
	});
	$effect(() => {
		const nextId = project.id;
		const nextPinned = pinned;
		const changedProject = nextId !== lastProjectId;
		if (changedProject) {
			untrack(() => finishEdit(true));
			lastProjectId = nextId;
			view = 'home';
			colorOpen = false;
			fixedPosition = null;
			notice = '';
			moving = false;
			navEpoch++;
		}
		if (nextPinned && (!lastPinned || changedProject)) {
			void tick().then(() => {
				if (project.id === nextId && pinned) panelEl?.focus({ preventScroll: true });
			});
		}
		lastPinned = nextPinned;
	});

	async function navigate(next: View) {
		finishEdit(true);
		if (next === view) return;
		const epoch = ++navEpoch;
		const sourceId = project.id;
		const height = stageEl?.getBoundingClientRect().height ?? 0;
		moving = true;
		if (bodyEl && !reducedMotion()) {
			await bodyEl.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${next === 'home' ? 8 : -8}px)` }], { duration: 90, easing: 'ease-out' }).finished.catch(() => {});
		}
		if (epoch !== navEpoch || sourceId !== project.id) return;
		view = next;
		colorOpen = false;
		await tick();
		if (epoch !== navEpoch || !stageEl) return;
		stageEl.scrollTop = 0;
		const targetHeight = stageEl.getBoundingClientRect().height;
		if (!reducedMotion()) {
			const animations: Animation[] = [];
			if (height && height !== targetHeight) animations.push(stageEl.animate([{ height: `${height}px` }, { height: `${targetHeight}px` }], { duration: 210, easing: 'cubic-bezier(.22,.61,.36,1)' }));
			if (bodyEl) animations.push(bodyEl.animate([{ opacity: 0, transform: `translateX(${next === 'home' ? -8 : 8}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 210, easing: 'cubic-bezier(.22,.61,.36,1)' }));
			await Promise.allSettled(animations.map(a => a.finished));
		}
		if (epoch !== navEpoch) return;
		moving = false;
		bodyEl?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus({ preventScroll: true });
	}
	async function shift(delta: number) {
		if (!manualOrder || !panelEl) return;
		const rect = panelEl.getBoundingClientRect();
		fixedPosition = { left: rect.left, top: rect.top };
		projectStore.shiftProject(project.id, delta);
	}
	function releasePosition() { fixedPosition = null; }
	function closePanel() { finishEdit(true); onClose(); }
	function requestCloseProject() {
		const id = project.id;
		closePanel();
		onRequestCloseProject(id);
	}
	function newTask() {
		const id = project.id;
		closePanel();
		onNewTask?.(id);
	}
	async function copyPath() {
		const target = project;
		if (!target.canonicalProjectPath) return;
		try {
			await navigator.clipboard.writeText(target.canonicalProjectPath);
			if (project.id === target.id) flash(m.project_popover_toast_copied());
		} catch {
			if (project.id === target.id) flash(m.project_popover_toast_copy_failed());
		}
	}
	async function reveal() {
		const target = project;
		if (!target.canonicalProjectPath) return;
		try { await revealItemInDir(target.canonicalProjectPath); }
		catch (error) { if (project.id === target.id) flash(String(error)); }
	}
	async function associate(target: Project) {
		const draft = project;
		if (!target.canonicalProjectPath) return;
		try {
			await associateDraftToProject(draft, target.canonicalProjectPath);
			if (project.id === draft.id) closePanel();
		} catch (error) { if (project.id === draft.id) flash(String(error)); }
	}
	function openAttention() {
		projectStore.setActive(project.id);
		closePanel();
		void tick().then(() => document.querySelector<HTMLElement>('.composer-editor')?.focus());
	}
	function keydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		if (editing) { finishEdit(false); return; }
		if (colorOpen) { colorOpen = false; return; }
		if (view !== 'home') { void navigate('home'); return; }
		closePanel();
	}
	$effect(() => {
		if (!pinned) return;
		function outside(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Element) || panelEl?.contains(target)) return;
			finishEdit(true);
			// Un altro trigger aggiorna la card esistente, senza smontarla al pointerdown.
			if (!fixedPosition && (target.closest('[data-project-menu-trigger]') || (event.button === 2 && target.closest('[data-tab-id]')))) return;
			closePanel();
		}
		function pointermove(event: PointerEvent) {
			if (fixedPosition && event.target instanceof Node && !panelEl?.contains(event.target)) releasePosition();
		}
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('pointermove', pointermove, { passive: true });
		document.documentElement.addEventListener('pointerleave', releasePosition);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('pointermove', pointermove);
			document.documentElement.removeEventListener('pointerleave', releasePosition);
		};
	});
	$effect(() => () => {
		finishEdit(true);
		clearTimeout(noticeTimer);
		navEpoch++;
	});
</script>

<div bind:this={panelEl} class="project-popover" class:preview={!pinned} popover="manual"
	role={pinned ? 'dialog' : 'tooltip'} aria-modal={pinned ? false : undefined}
	aria-label={m.project_popover_aria_label({ name: project.name })} tabindex="-1"
	use:anchoredPopover={{ anchor, offset: 6, constrainHeight: true, motion: true, fixedPosition }}
	onpointerenter={() => onHoverChange(true)} onpointerleave={() => onHoverChange(false)} onkeydown={keydown}
>
	<div class="popover-content" bind:this={contentEl}>
	{#if !pinned}
		<div class="peek-identity">
			<span class="identity-code" style="--proj-hue: {hue}">{#if isDraft}<IconLab />{:else if isScratchpad}<IconGhost />{:else}{project.label ?? project.name.slice(0, 2).toUpperCase()}{/if}</span>
			<strong>{project.name}</strong>
		</div>
		{#if displayPath}<p class="peek-path">{displayPath}</p>{/if}
		<div class="peek-status"><StatusMark status={project.lane.agentState === 'working' ? 'running' : project.lane.agentState === 'attention' ? 'attention' : project.lane.agentState === 'finished' ? 'completed' : 'pending'} /><span>{stateLabel}</span>{#if hasWorkspace}<span class="peek-count">{m.project_popover_queue_header({ count: queueCount })}</span>{/if}</div>
		{#if attention}<p class="peek-question">{askQuestionText(attention.pendingUi, m.project_popover_quick_ask_title())}</p>{/if}
	{:else}
		<div class="card-close"><Tooltip text={m.project_tabs_core_dismiss()} placement="bottom"><button class="close-card icon-button" aria-label={m.project_tabs_core_dismiss()} onclick={closePanel}><IconClose /></button></Tooltip></div>
		{#if view === 'home'}
			<header class="identity-header">
				<div class="identity-line">
					{#if !isScratchpad && !isDraft}<Tooltip text={m.project_popover_color_title()} placement="bottom"><button class="color-trigger icon-button" aria-label={m.project_popover_color_title()} aria-expanded={colorOpen} onclick={() => { finishEdit(true); colorOpen = !colorOpen; }}><span class="color-dot" style="--proj-hue: {hue}"></span></button></Tooltip>{/if}
					{#if isDraft || isScratchpad}<span class="identity-code">{#if isDraft}<IconLab />{:else}<IconGhost />{/if}</span>
					{:else if editing?.field === 'label'}<input class="identity-edit code-edit" bind:this={fieldEl} bind:value={fieldDraft} aria-label={m.project_popover_code_aria()} onblur={() => finishEdit(true)} onkeydown={fieldKeydown} />
					{:else}<button class="identity-code editable" style="--proj-hue: {hue}" aria-label={m.project_popover_code_aria()} onclick={() => beginEdit('label')}>{project.label ?? project.name.slice(0, 2).toUpperCase()}</button>{/if}
					{#if editing?.field === 'name'}<input class="identity-edit name-edit" bind:this={fieldEl} bind:value={fieldDraft} aria-label={m.project_popover_name_aria()} onblur={() => finishEdit(true)} onkeydown={fieldKeydown} />
					{:else}<button class="identity-name editable" aria-label={m.project_popover_edit_name_title()} onclick={() => beginEdit('name')}>{project.name}</button>{/if}
				</div>
				{#if displayPath}<div class="path-line"><Tooltip text={m.project_tabs_core_reveal()} placement="bottom"><button class="project-path" onclick={() => void reveal()}>{displayPath}</button></Tooltip><Tooltip text={m.project_popover_copy_path()} placement="bottom"><button class="icon-button copy-path" onclick={() => void copyPath()} aria-label={m.project_popover_copy_path()}><IconCopy /></button></Tooltip></div>
				{:else}<span class="project-kind">{isDraft ? m.lab_lane_draft_badge() : m.project_popover_badge_scratchpad()}</span>{/if}
			</header>
			<div class="color-fold" class:open={colorOpen}><div class="color-fold-inner" inert={!colorOpen}><div class="color-content"><HuePicker hue={project.hue} mode={project.colorMode} {autoHue} onhue={(next) => projectStore.setProjectHue(project.id, next)} onauto={() => projectStore.useAutomaticProjectColor(project.id)} /></div></div></div>
		{:else}
			<header class="detail-header"><button class="back-button" onclick={() => void navigate('home')}><IconChevronLeft /><span>{project.name}</span></button><h2>{title}</h2></header>
		{/if}
		<div class="view-stage" class:moving bind:this={stageEl}>
			<div class="view-body" bind:this={bodyEl}>
				{#if view === 'home'}
					<div class="home-actions">
						{#if attention}<button class="menu-row attention-row" onclick={openAttention}><StatusMark status="attention" /><span>{m.project_popover_quick_reply_in_composer()}</span></button>{/if}
						{#if onNewTask && !project.external}<button class="menu-row" onclick={newTask}><IconPlus /><span>{m.project_popover_new_task()}</span></button>{/if}
						{#if hasWorkspace}<button class="menu-row" onclick={() => void navigate('queue')}><IconQueue /><span>{m.project_tabs_core_queue()}</span><small>{queueCount}</small><IconChevronRight /></button>{/if}
						{#if hasWorkspace}<div class="divider"></div>{/if}
						{#if canGit}<button class="menu-row" onclick={() => void navigate('git')}><IconGitBranch /><span>{m.project_tabs_core_git()}</span>{#if upstream && (upstream.behind || upstream.ahead)}<small>{upstream.behind ? `↓ ${upstream.behind}` : ''} {upstream.ahead ? `↑ ${upstream.ahead}` : ''}</small>{/if}<IconChevronRight /></button>{/if}
						{#if hasWorkspace}<button class="menu-row" onclick={() => void navigate('lanes')}><IconLab /><span>{m.project_tabs_core_lanes()}</span>{#if lanes.length}<small>{lanes.length}</small>{/if}<IconChevronRight /></button><button class="menu-row" onclick={() => { const path = project.canonicalProjectPath; closePanel(); automationsStore.open(path ?? undefined); }}><IconAutomation /><span>{m.l10n_cmp_project_automations()}</span></button>{/if}
						{#if isDraft}<button class="menu-row" onclick={() => void navigate('associate')}><IconFolderOpen /><span>{m.lab_lane_associate_project()}</span><IconChevronRight /></button>{/if}
						<div class="divider"></div>
						<div class="reorder-row"><span>{m.project_tabs_core_order()}</span><Tooltip text={manualOrder ? m.project_popover_shift_left() : m.project_tabs_core_manual_order()}><button class="icon-button" disabled={!manualOrder || position <= 0} onclick={() => void shift(-1)} aria-label={m.project_popover_shift_left_aria()}><IconArrowLeft /></button></Tooltip><Tooltip text={manualOrder ? m.project_popover_shift_right() : m.project_tabs_core_manual_order()}><button class="icon-button" disabled={!manualOrder || position < 0 || position >= projectOrder.list.length - 1} onclick={() => void shift(1)} aria-label={m.project_popover_shift_right_aria()}><IconArrowRight /></button></Tooltip></div>
						<button class="menu-row danger" onclick={requestCloseProject}><IconClose /><span>{m.project_popover_close_project()}</span></button>
					</div>
				{:else if view === 'queue'}<div class="detail-content"><ProjectQueueView {project} {onRunTask} {onEditTask} {canRunTask} {runReason} onClose={closePanel} /></div>
				{:else if view === 'git'}<div class="detail-content"><ProjectGitView {project} /></div>
				{:else if view === 'lanes'}<div class="detail-content"><ProjectLanesView {project} onClose={closePanel} {onReviewLane} /></div>
				{:else}<div class="detail-content">{#each realProjects as target (target.id)}<button class="menu-row" onclick={() => void associate(target)}><IconFolderOpen /><span>{target.name}</span></button>{:else}<p class="empty">{m.project_tabs_core_no_projects()}</p>{/each}</div>{/if}
			</div>
		</div>
		{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{/if}
	</div>
</div>

<style>
	.project-popover { width: 306px; max-width: calc(100vw - 16px); max-height: min(82vh, var(--anchored-space, 82vh)); padding: 0; margin: 0; color: var(--ink); background: var(--bg-overlay); border: 1px solid var(--line-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-overlay); z-index: var(--z-overlay); overflow: visible; font: 450 var(--text-body, 13px)/1.45 var(--font-ui); transition: left var(--dur-menu) var(--ease-reveal), top var(--dur-menu) var(--ease-reveal); --icon-size: 15px; }
	.project-popover.preview { width: 286px; padding: 16px; }
	.peek-identity { display: flex; align-items: center; gap: 10px; }
	.peek-identity strong { font-size: var(--text-body, 13px); font-weight: 550; overflow-wrap: anywhere; }
	.peek-path { margin: 8px 0 0; color: var(--ink-faint); font: 11px/1.6 var(--font-mono); overflow-wrap: anywhere; }
	.peek-status { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: var(--text-label); color: var(--ink-muted); }
	.peek-count { margin-left: auto; font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
	.peek-question { margin: 12px 0 0; font-size: var(--text-label); color: var(--ink-muted); }
	.identity-header { padding: 14px 44px 12px 12px; border-bottom: 1px solid var(--line); }
	.identity-line { display: flex; align-items: center; gap: 6px; min-height: 30px; }
	.icon-button { width: 30px; height: 30px; padding: 6px; border: 0; background: transparent; color: var(--ink-muted); display: grid; place-items: center; border-radius: var(--radius-md); cursor: pointer; flex: none; transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
	.icon-button:hover:not(:disabled) { background: var(--bg-hover); color: var(--ink); }
	.icon-button:disabled { opacity: .4; cursor: default; }
	.card-close { position: absolute; top: 10px; right: 10px; z-index: 1; }
	.color-trigger { width: 25px; padding: 4px; }
	.color-dot { width: 15px; height: 15px; background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue)); border-radius: var(--radius-full); }
	.identity-code { display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: 38px; height: 30px; padding: 4px 6px; border: 1px solid transparent; border-radius: var(--radius-sm); font: 600 var(--text-label)/1 var(--font-ui); background: var(--bg-hover); color: var(--ink); text-align: center; }
	.identity-name { min-width: 0; flex: 1; font: 550 15px/1.35 var(--font-ui); color: var(--ink); padding: 4px; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.editable { cursor: text; transition: background var(--dur-fast), border-color var(--dur-fast); }
	.editable:hover { background: var(--bg-hover); border-color: var(--line); }
	.identity-edit { height: 30px; min-width: 0; padding: 3px 5px; background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); color: var(--ink); font: inherit; }
	.code-edit { width: 42px; text-align: center; flex: none; }
	.name-edit { width: 100%; flex: 1; font-size: 15px; }
	.path-line { display: flex; align-items: center; gap: 4px; margin-top: 5px; }
	.path-line :global(.tooltip-trigger) { min-width: 0; }
	.project-path { display: block; max-width: 208px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; background: transparent; border: 0; padding: 4px 0; color: var(--ink-muted); font: 11px/1.5 var(--font-mono); cursor: pointer; }
	.project-path:hover { color: var(--ink); background: transparent; }
	.copy-path { width: 26px; height: 26px; --icon-size: 13px; }
	.project-kind { display: block; font-size: var(--text-caption); color: var(--ink-faint); margin: 6px 4px 0; }
	.color-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-slow) var(--ease-reveal); }
	.color-fold.open { grid-template-rows: 1fr; }
	.color-fold-inner { min-height: 0; overflow: hidden; }
	.color-content { padding: 12px 16px; border-bottom: 1px solid var(--line); }
	.detail-header { padding: 10px 44px 12px 16px; border-bottom: 1px solid var(--line); }
	.back-button { display: flex; align-items: center; gap: 6px; min-height: 28px; max-width: 100%; margin: 0 0 6px -6px; padding: 4px 6px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-muted); font: inherit; font-size: var(--text-label); cursor: pointer; --icon-size: 14px; transition: background var(--dur-fast) var(--ease-out); }
	.back-button:hover { background: var(--bg-hover); }
	.back-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	h2 { margin: 0; font-size: 16px; font-weight: 550; line-height: 1.4; }
	.view-stage { overflow: auto; max-height: min(65vh, calc(var(--anchored-space, 82vh) - 104px)); scrollbar-width: thin; }
	.view-stage.moving { overflow: hidden; overflow: clip; }
	.home-actions { padding: 6px; }
	.menu-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 7px 8px; color: var(--ink); font: inherit; font-size: var(--text-body, 13px); text-align: left; background: transparent; border: 0; border-radius: var(--radius-md); cursor: pointer; transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
	.menu-row:hover { background: var(--bg-hover); }
	.menu-row > span { min-width: 0; flex: 1; }
	.menu-row small { color: var(--ink-faint); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
	.danger { color: var(--ink-muted); }
	.danger:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
	.attention-row { color: var(--ink); }
	.divider { height: 1px; background: var(--line); margin: 6px 4px; }
	.reorder-row { display: flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; font-size: var(--text-label); color: var(--ink-muted); }
	.reorder-row > span { flex: 1; }
	.detail-content { padding: 16px; }
	.empty { color: var(--ink-muted); font-size: var(--text-label); }
	.notice { margin: 0; padding: 8px 16px; border-top: 1px solid var(--line); font-size: var(--text-label); color: var(--ink-muted); overflow-wrap: anywhere; }
	@media (prefers-reduced-motion: reduce) { .project-popover, .color-fold { transition: none; } }
	:global(:root[data-animations='false']) .project-popover, :global(:root[data-animations='false']) .color-fold { transition: none; }
</style>
