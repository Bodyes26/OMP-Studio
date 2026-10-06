<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Pannello di una tessera progetto: anteprima al passaggio del mouse e menu
	 * contestuale sul click destro, con lo stesso contenuto.
	 *
	 * Due modi, un componente:
	 * - **hover**: effimero, non prende il fuoco, si chiude quando il mouse va
	 *   via. Serve al colpo d'occhio (stato, coda, percorso).
	 * - **pinned** (`pinned = true`): nasce dal click destro o dal tasto Menu,
	 *   prende il fuoco sulla prima azione e si chiude solo con `Esc`, con un
	 *   click fuori o eseguendo un comando.
	 *
	 * Ruolo `dialog` non modale e non `tooltip`: le APG WAI-ARIA vietano i
	 * tooltip che contengono elementi attivabili, e qui dentro ci sono campi,
	 * bottoni e un selettore di tinta.
	 */
	import { projectStore, normalizeProjectPath, type Project } from '$lib/stores/projects.svelte';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { taskLabel as sharedTaskLabel } from '$lib/stores/taskTitle';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { companionStore } from '$lib/stores/companion.svelte';
	import { askQuestionText } from '$lib/agent/askTitle';
	import HuePicker from './HuePicker.svelte';
	import GitDiffBadge from './GitDiffBadge.svelte';
	import MentionText from './MentionText.svelte';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconAuto,
		IconCheck,
		IconClose,
		IconCloseOthers,
		IconCopy,
		IconEditor,
		IconFolderOpen,
		IconGhost,
		IconPlay,
		IconPlus,
		IconQueue,
		IconRename,
		IconTerminal,
		IconWarning,
		IconLab,
		IconChevronRight,
		IconGitBranch,
		IconTrash,
		IconDownload,
		IconArrowUp,
		IconRefresh
	} from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { laneStore } from '$lib/stores/lanes.svelte';
	import { sessionRegistry } from '$lib/agent/sessionRegistry';
	import { githubStore } from '$lib/stores/github.svelte';
	import { labApi } from '$lib/lab/api';
	import {
		openLabEntry,
		associateDraftToProject,
		startCreateWorktreeFlow,
		formatRelativeDate,
		reportLabDeleteFailure,
		reportLaneDeleteFailure
	} from '$lib/lanes/laneActions';
	import {
		listClosedLanes,
		reopenLane,
		deleteWorktreeLane,
		deleteLabPrototype,
		inspectUnintegratedWork,
		type ClosedLaneEntry,
		type LaneUnintegratedLoss
	} from '$lib/lanes/laneLifecycle';
	import { describeLaneProcess } from '$lib/lanes/processSupervisor';
	import { untrack } from 'svelte';
	import { MAIN_LANE_ID, type ProjectId } from '$lib/types/lanes';
	import { invoke } from '@tauri-apps/api/core';
	import { gitDiffStore, hasGitChanges, notifyGitStatusRefresh } from '$lib/stores/gitDiff.svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';

	interface Props {
		project: Project;
		anchor: HTMLElement | null;
		pinned?: boolean;
		/** Tinta che il tema assegnerebbe al progetto. */
		autoHue: number;
		otherProjectCount?: number;
		onClose: () => void;
		onHoverChange: (inside: boolean) => void;
		onRunTask?: (projectId: string, taskId: string, follow: boolean) => void;
		onEditTask?: (projectId: string, taskId: string) => void;
		onNewTask?: (projectId: string) => void;
		onQueueClick?: () => void;
		onRequestCloseProject?: (projectId: string) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
		/** Apre nell'editor un file menzionato (`@percorso`) in un task del progetto. */
		onOpenFile?: (projectId: string, relPath: string) => void;
	}

	let {
		project,
		anchor,
		pinned = false,
		autoHue,
		otherProjectCount = 0,
		onClose,
		onHoverChange,
		onRunTask,
		onEditTask,
		onNewTask,
		onQueueClick,
		onRequestCloseProject,
		canRunTask,
		runReason,
		onOpenFile
	}: Props = $props();

	type View = 'default' | 'rename' | 'close' | 'close-others' | 'associate' | 'delete-worktree';

	const AGENT_STATE_LABEL = $derived.by((): Record<Project['lane']['agentState'], string> => ({
		working: m.topbar_agent_state_working(),
		attention: m.topbar_agent_state_attention(),
		finished: m.topbar_agent_state_finished(),
		idle: m.topbar_agent_state_idle(),
		unknown: m.topbar_agent_state_unknown()
	}));

	const QUEUE_PEEK_LIMIT = 5;

	let panelEl = $state<HTMLElement | null>(null);
	let view = $state<View>('default');
	let flipped = $state(false);
	// Sottomenu laterale dei prototipi: vive come popover figlio nel DOM del
	// pannello, quindi il puntatore che ci entra resta "dentro" il pannello e
	// il pannello principale non si accorcia ne' si chiude.
	let protoRowEl = $state<HTMLElement | null>(null);
	let protoMenuEl = $state<HTMLElement | null>(null);
	let protoMenuOpen = $state(false);
	let protoMenuFlipped = $state(false);
	let protoFocusOnOpen = false;
	let nameDraft = $state('');
	let labelDraft = $state('');
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	const isScratchpad = $derived(!project.canonicalProjectPath);
	const isActive = $derived(projectStore.activeId === project.id);
	const ready = $derived(canRunTask?.(project.id) ?? false);
	const reason = $derived(runReason?.(project.id) ?? '');
	const queueTasks = $derived(
		project.canonicalProjectPath ? taskStore.tasksFor(project.canonicalProjectPath) : []
	);
	const attentionReq = $derived(companionStore.attentionRequests.find((r) => r.projectId === project.id));
	const gitDiff = $derived(
		project.lane.workspacePath ? gitDiffStore.forPath(project.lane.workspacePath) : null
	);
	const isDraft = $derived(Boolean(project.labDraft));
	const isGitRepo = $derived(
		Boolean(project.canonicalProjectPath && !project.labDraft) &&
		gitDiffStore.forPath(project.lane.workspacePath ?? project.canonicalProjectPath ?? '').isRepo !== false
	);
	const realProjects = $derived(
		projectStore.projects.filter((p) => p.canonicalProjectPath !== null && !p.labDraft)
	);

	const canonicalKey = $derived(
		project.canonicalProjectPath ? normalizeProjectPath(project.canonicalProjectPath).toLowerCase() : ''
	);
	const upstream = $derived(
		canonicalKey ? githubStore.upstreamByPath[canonicalKey] ?? null : null
	);
	const remoteError = $derived(
		canonicalKey ? githubStore.remoteErrorByPath[canonicalKey] ?? null : null
	);
	const isSyncing = $derived(
		canonicalKey ? Boolean(githubStore.isSyncingByPath[canonicalKey]) : false
	);
	const canonicalGitDiff = $derived(
		project.canonicalProjectPath ? gitDiffStore.forPath(project.canonicalProjectPath) : null
	);

	let lastProjectId = $state<string | null>(null);
	let pullError = $state<string | null>(null);
	let pullSuccess = $state<string | null>(null);
	let isPulling = $state(false);

	$effect(() => {
		if (project.id !== lastProjectId) {
			lastProjectId = project.id;
			pullError = null;
			pullSuccess = null;
		}
	});

	$effect(() => {
		const targetPath = project.canonicalProjectPath;
		if (targetPath && !project.labDraft) {
			void githubStore.loadUpstreamStatus(targetPath);
		}
	});

	const isMainAgentBusy = $derived.by(() => {
		const mainSession = sessionRegistry.getMainSession(project.id);
		if (mainSession && (mainSession.isStreaming || mainSession.isCompacting || mainSession.agentState === 'working')) {
			return true;
		}
		const mainLane = laneStore.lanesFor(project.id as ProjectId).find((l) => l.laneId === MAIN_LANE_ID);
		if (mainLane?.agentState === 'working') {
			return true;
		}
		return false;
	});

	const pullDisableReason = $derived.by(() => {
		if (!upstream?.isGit) return null;
		if (isSyncing || isPulling) return m.project_popover_git_disabled_syncing();
		if (isMainAgentBusy) return m.project_popover_git_disabled_working();
		if (upstream.hasUncommitted || (canonicalGitDiff && hasGitChanges(canonicalGitDiff))) {
			return m.project_popover_git_disabled_dirty();
		}
		if (upstream.ahead > 0) return m.project_popover_git_disabled_diverged();
		return null;
	});
	const isPullDisabled = $derived(Boolean(pullDisableReason));

	async function handlePull() {
		const targetProject = project;
		const targetPath = targetProject.canonicalProjectPath;
		if (!targetPath || isPullDisabled) return;

		isPulling = true;
		pullError = null;
		pullSuccess = null;
		try {
			await githubStore.syncRepo(targetPath, 'pull-ff');
			if (project?.id === targetProject.id) {
				pullSuccess = m.project_popover_git_pull_success();
			}
			notifyGitStatusRefresh(targetPath);
		} catch (err) {
			if (project?.id === targetProject.id) {
				pullError = String(err);
			}
		} finally {
			isPulling = false;
		}
	}

	let closedLanes = $state<ClosedLaneEntry[]>([]);
	let deleteConfirmTarget = $state<ClosedLaneEntry | null>(null);
	/** Commit mai integrati della corsia da eliminare, letti prima di chiedere conferma. */
	let deleteLoss = $state<LaneUnintegratedLoss | null>(null);

	// Firma delle sole proprieta' che cambiano l'elenco delle corsie chiuse.
	// L'effetto dipendeva da ogni campo di ogni corsia (stato dell'agente
	// compreso) e rileggeva l'indice Lab dal disco a ogni cambio.
	const closedLanesKey = $derived(
		laneStore
			.lanesFor(project.id as ProjectId)
			.map((lane) => `${lane.laneId}|${lane.status}|${lane.closedAt ?? ''}|${lane.title}`)
			.join('\n')
	);
	let closedLanesRequest = 0;

	$effect(() => {
		const canList = Boolean(project.canonicalProjectPath) && !project.labDraft;
		void closedLanesKey;
		void settingsStore.general.labAlphaEnabled;
		const request = ++closedLanesRequest;
		if (!canList) {
			closedLanes = [];
			return;
		}
		const target = untrack(() => project);
		void untrack(() => listClosedLanes(target))
			.then((list) => {
				if (request === closedLanesRequest) closedLanes = list;
			})
			.catch(() => {
				if (request === closedLanesRequest) closedLanes = [];
			});
	});

	// Il popover si chiude appena il puntatore esce o si clicca altrove: dopo un
	// `await` la prop `project` del componente smontato vale null. Le azioni
	// asincrone lavorano quindi sul progetto catturato al momento del clic.
	async function handleCreateWorktreeLane() {
		const target = project;
		if (!target.canonicalProjectPath) return;
		await startCreateWorktreeFlow(target);
		onClose();
	}

	async function handleCreateLabPrototype() {
		const target = project;
		if (!target.canonicalProjectPath) return;
		try {
			const entry = await labApi.createPrototype(target.canonicalProjectPath);
			await openLabEntry(target.id, entry);
			onClose();
		} catch (err) {
			console.error('Creazione prototipo Lab fallita:', err);
		}
	}

	function toggleProtoMenu(fromKeyboard: boolean) {
		protoFocusOnOpen = fromKeyboard && !protoMenuOpen;
		protoMenuOpen = !protoMenuOpen;
	}

	function closeProtoMenu(returnFocus: boolean) {
		protoMenuOpen = false;
		if (returnFocus) protoRowEl?.focus({ preventScroll: true });
	}

	function handleProtoRowKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowRight' || protoMenuOpen) return;
		event.preventDefault();
		toggleProtoMenu(true);
	}

	function handleProtoMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const items = [...(protoMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
			if (items.length === 0) return;
			const index = items.indexOf(document.activeElement as HTMLElement);
			const step = event.key === 'ArrowDown' ? 1 : -1;
			const next = index < 0 ? 0 : (index + step + items.length) % items.length;
			items[next].focus();
			return;
		}
		if (event.key === 'Escape' || event.key === 'ArrowLeft') {
			event.preventDefault();
			event.stopPropagation();
			closeProtoMenu(true);
		}
	}

	// Un click nel pannello fuori dal sottomenu lo chiude, come un menu nativo.
	function handlePanelPointerDown(event: PointerEvent) {
		if (!protoMenuOpen) return;
		const target = event.target as Node | null;
		if (target && (protoMenuEl?.contains(target) || protoRowEl?.contains(target))) return;
		protoMenuOpen = false;
	}

	async function handleReopenClosedLane(entry: ClosedLaneEntry) {
		await reopenLane(project, entry);
		onClose();
	}

	async function requestDeleteClosedLane(entry: ClosedLaneEntry) {
		protoMenuOpen = false;
		deleteLoss =
			entry.kind === 'git'
				? await inspectUnintegratedWork(entry.projectId, entry.laneId)
				: null;
		deleteConfirmTarget = entry;
		view = 'delete-worktree';
	}

	async function executeDeleteClosedLane() {
		const target = deleteConfirmTarget;
		const loss = deleteLoss;
		const owner = project;
		deleteConfirmTarget = null;
		deleteLoss = null;
		view = 'default';
		if (!target) return;
		try {
			if (target.kind === 'lab') {
				const outcome = await deleteLabPrototype(owner.id as ProjectId, target.prototypeId);
				if (outcome.kind === 'failed') await reportLabDeleteFailure(outcome.message);
			} else {
				const outcome = await deleteWorktreeLane(owner.id as ProjectId, target.laneId, {
					discardUnintegrated: loss !== null
				});
				if (outcome.kind === 'unintegrated') {
					// Commit comparsi dopo la richiesta: la conferma va ridata col conto aggiornato.
					deleteLoss = outcome.loss;
					deleteConfirmTarget = target;
					view = 'delete-worktree';
					return;
				}
				if (outcome.kind === 'processes-active') {
					await reportLaneDeleteFailure(
						outcome.processes.map(describeLaneProcess).join(', ') ||
							m.lanestrip_cleanup_pending()
					);
				} else if (outcome.kind === 'failed') {
					await reportLaneDeleteFailure(outcome.message);
				}
			}
			closedLanes = await listClosedLanes(owner).catch(() => []);
		} catch (err) {
			console.error('Eliminazione corsia chiusa fallita:', err);
		}
	}

	$effect(() => {
		if (!protoMenuEl || !protoFocusOnOpen) return;
		protoFocusOnOpen = false;
		protoMenuEl.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
	});

	async function handleAssociate(targetPath: string) {
		await associateDraftToProject(project, targetPath);
		onClose();
	}

	const canReorder = $derived(settingsStore.projectBar.order === 'fixed');
	const effectiveHue = $derived(project.colorMode === 'custom' ? project.hue : autoHue);

	function initials(name: string) {
		return name.slice(0, 2).toUpperCase();
	}

	// Il percorso si tronca al centro: la coda e' la parte che identifica la
	// cartella, la testa e' quasi sempre la stessa radice di lavoro.
	function truncateMiddle(path: string, max = 40) {
		if (path.length <= max) return path;
		const head = Math.ceil((max - 1) / 2);
		const tail = Math.floor((max - 1) / 2);
		return path.slice(0, head) + '…' + path.slice(path.length - tail);
	}

	function taskLabel(task: StudioTask): string {
		return (
			sharedTaskLabel(task) ||
			(task.images && task.images.length > 0 ? m.queue_drawer_title_only_images() : m.project_popover_new_task())
		);
	}

	function flash(message: string) {
		notice = message;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 2600);
	}

	function saveRename() {
		projectStore.renameProject(project.id, nameDraft);
		if (!isScratchpad) projectStore.setProjectLabel(project.id, labelDraft);
		view = 'default';
	}

	function handleRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			view = 'default';
		}
	}

	function select() {
		projectStore.setActive(project.id);
		onClose();
	}

	async function copyPath() {
		if (!project.canonicalProjectPath) return;
		try {
			await navigator.clipboard.writeText(project.canonicalProjectPath);
			flash(m.project_popover_toast_copied());
		} catch {
			flash(m.project_popover_toast_copy_failed());
		}
	}

	function reveal() {
		if (!project.canonicalProjectPath) return;
		void revealItemInDir(project.canonicalProjectPath);
		onClose();
	}

	async function openExternal(target: 'terminal' | 'editor') {
		if (!project.canonicalProjectPath) return;
		try {
			await invoke('open_project_external', {
				projectPath: project.canonicalProjectPath,
				target
			});
			onClose();
		} catch (error) {
			flash(typeof error === 'string' ? error : m.project_popover_toast_open_failed());
		}
	}

	function newTask() {
		onNewTask?.(project.id);
		onClose();
	}

	function openQueue() {
		onQueueClick?.();
		onClose();
	}

	function runTask(task: StudioTask, follow: boolean) {
		onRunTask?.(project.id, task.id, follow);
		onClose();
	}

	function editTask(task: StudioTask) {
		onEditTask?.(project.id, task.id);
		onClose();
	}
	function openMentionFile(path: string) {
		onOpenFile?.(project.id, path);
		onClose();
	}

	function shift(delta: number) {
		projectStore.shiftProject(project.id, delta);
	}

	/** La sorte della coda alla chiusura segue il modale o le impostazioni generali. */
	function requestClose() {
		if (onRequestCloseProject) {
			onRequestCloseProject(project.id);
			onClose();
			return;
		}
		const queued = project.canonicalProjectPath
			? taskStore.queuedCountFor(project.canonicalProjectPath)
			: 0;
		if (queued === 0 || settingsStore.general.closeWithQueuedTasks === 'keep') {
			closeProject(false);
			return;
		}
		if (settingsStore.general.closeWithQueuedTasks === 'discard') {
			closeProject(true);
			return;
		}
		view = 'close';
	}

	function closeProject(discardQueue: boolean) {
		if (discardQueue && project.canonicalProjectPath) {
			void taskStore.clearProject(project.canonicalProjectPath);
		}
		projectStore.closeProject(project.id);
		onClose();
	}

	function closeOthers() {
		for (const other of [...projectStore.projects]) {
			if (other.id === project.id) continue;
			if (other.canonicalProjectPath) {
				if (settingsStore.general.closeWithQueuedTasks === 'discard') {
					void taskStore.clearProject(other.canonicalProjectPath);
				} else if (other.lane.agentState === 'working') {
					void taskStore.resetDispatchingTasks(other.canonicalProjectPath);
				}
			}
			projectStore.closeProject(other.id);
		}
		projectStore.setActive(project.id);
		onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		if (protoMenuOpen) {
			closeProtoMenu(true);
			return;
		}
		if (view !== 'default') {
			view = 'default';
			return;
		}
		onClose();
	}

	// Click fuori: vale solo per il pannello fissato. In hover ci pensa il
	// mouse che se ne va, e un listener globale chiuderebbe il pannello al
	// primo click su qualsiasi cosa.
	$effect(() => {
		if (!pinned) return;
		function onPointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (!target) return;
			if (panelEl?.contains(target)) return;
			if (anchor?.contains(target)) return;
			onClose();
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	// Il pannello fissato prende il fuoco: da tastiera si arriva con il tasto
	// Menu e si deve poter scegliere subito, senza inseguire il pannello.
	$effect(() => {
		if (!pinned || !panelEl) return;
		const first = panelEl.querySelector<HTMLElement>('button:not(:disabled), [role="slider"], input');
		first?.focus({ preventScroll: true });
	});

	$effect(() => () => {
		if (noticeTimer) clearTimeout(noticeTimer);
	});
</script>

<div
	bind:this={panelEl}
	class="project-popover"
	class:pinned
	popover="manual"
	role="dialog"
	aria-modal="false"
	tabindex="-1"
	aria-label={m.project_popover_aria_label({ name: project.name })}
	class:flipped
	use:anchoredPopover={{ anchor, offset: 6, onFlip: (value) => (flipped = value), motion: true }}
	onpointerenter={() => onHoverChange(true)}
	onpointerleave={() => onHoverChange(false)}
	onpointerdown={handlePanelPointerDown}
	onkeydown={handleKeydown}
>
	{#if view === 'rename'}
		<form
			class="rename"
			onsubmit={(event) => {
				event.preventDefault();
				saveRename();
			}}
		>
			<label>
				<span>{m.project_popover_name_field()}</span>
				<input bind:value={nameDraft} aria-label={m.project_popover_name_aria()} onkeydown={handleRenameKeydown} />
			</label>
			{#if !isScratchpad}
				<label>
					<span>{m.project_popover_code_field()}</span>
					<input
						bind:value={labelDraft}
						aria-label={m.project_popover_code_aria()}
						placeholder={initials(project.name)}
						onkeydown={handleRenameKeydown}
					/>
				</label>
			{/if}
			<div class="rename-actions">
				<button type="button" class="btn-ghost" onclick={() => (view = 'default')}>{m.project_popover_btn_cancel()}</button>
				<button type="submit" class="btn-primary">{m.project_popover_btn_save()}</button>
			</div>
		</form>
	{:else}
		<header class="head">
			<span
				class="proj-chip"
				class:scratchpad={isScratchpad}
				style="--proj-hue: {effectiveHue}"
				title={project.label ? `Sigla: ${project.label}` : `Progetto: ${project.name}`}
				aria-hidden="true"
			>
				{#if project.labDraft}
					<IconLab />
				{:else if isScratchpad}
					<IconGhost />
				{:else}
					{project.label ?? initials(project.name)}
				{/if}
			</span>
			<span class="titles">
				<span class="name" title={project.name}>{project.name}</span>
				<span class="path-row">
					<span class="path" title={project.canonicalProjectPath ?? ''}>{project.labDraft ? m.lab_lane_draft_badge() : isScratchpad ? m.project_popover_badge_scratchpad() : truncateMiddle(project.canonicalProjectPath ?? '')}</span>
					{#if gitDiff && hasGitChanges(gitDiff)}
						<GitDiffBadge additions={gitDiff.additions} deletions={gitDiff.deletions} />
					{/if}
				</span>
			</span>
			<button
				type="button"
				class="icon-btn"
				onclick={() => {
					nameDraft = project.name;
					labelDraft = project.label ?? '';
					view = 'rename';
				}}
				aria-label={m.project_popover_edit_name_title()}
				title={m.project_popover_edit_name_title()}
			>
				<IconRename />
			</button>
		</header>

		<div class="state" class:working={project.lane.agentState === 'working'} class:attention={project.lane.agentState === 'attention'}>
			<StatusMark
				status={project.lane.agentState === 'working'
					? 'running'
					: project.lane.agentState === 'attention'
						? 'attention'
						: project.lane.agentState === 'finished'
							? 'completed'
							: 'pending'}
			/>
			<span>{AGENT_STATE_LABEL[project.lane.agentState]}</span>
		</div>
		{#if attentionReq}
			<div class="popover-quick-reply">
				<p class="quick-ask-prompt">{askQuestionText(attentionReq.pendingUi, m.project_popover_quick_ask_title())}</p>
				<button
					type="button"
					class="quick-composer-btn"
					onclick={() => {
						projectStore.setActive(project.id);
						onClose();
						setTimeout(() => {
							const composerEl = document.querySelector('.composer-editor') as HTMLElement | null;
							composerEl?.focus();
						}, 50);
					}}
				>
					<span>{m.project_popover_quick_reply_in_composer()}</span>
				</button>
			</div>
		{/if}
	{/if}

	{#if view === 'close'}
		<div class="confirm">
			<p>{m.project_popover_close_has_queue()}</p>
			<button type="button" class="row" onclick={() => closeProject(false)}>
				<IconCheck /> <span class="row-label">{m.project_popover_close_keep_queue()}</span>
			</button>
			<button type="button" class="row danger" onclick={() => closeProject(true)}>
				<IconClose /> <span class="row-label">{m.project_popover_close_discard_queue()}</span>
			</button>
			<button type="button" class="row" onclick={() => (view = 'default')}>
				<span class="row-label indent">{m.project_popover_btn_cancel()}</span>
			</button>
		</div>
	{:else if view === 'close-others'}
		<div class="confirm">
			<p>Chiudo gli altri {otherProjectCount} {m.ui_projectpopover_progetti_aperti_18ab()}</p>
			<button type="button" class="row danger" onclick={closeOthers}>
				<IconCloseOthers /> <span class="row-label">{m.ui_editor_chiudi_gli_altri_f1f6()} {otherProjectCount}</span>
			</button>
			<button type="button" class="row" onclick={() => (view = 'default')}>
				<span class="row-label indent">{m.project_popover_btn_cancel()}</span>
			</button>
		</div>
	{:else if view === 'associate'}
		<div class="confirm">
			<p>{m.lab_lane_associate_project()}</p>
			{#each realProjects as target (target.id)}
				<button type="button" class="row" onclick={() => void handleAssociate(target.canonicalProjectPath!)}>
					<IconFolderOpen /> <span class="row-label">{target.name}</span>
				</button>
			{/each}
			<button type="button" class="row" onclick={() => (view = 'default')}>
				<span class="row-label indent">{m.project_popover_btn_cancel()}</span>
			</button>
		</div>
	{:else if view === 'delete-worktree' && deleteConfirmTarget}
		<div class="confirm">
			<p>
				{deleteConfirmTarget.kind === 'lab'
					? m.lab_delete_dialog_message({ name: deleteConfirmTarget.title })
					: m.lanestrip_delete_dialog_message({ name: deleteConfirmTarget.title })}
			</p>
			{#if deleteConfirmTarget.kind === 'git' && deleteLoss}
				<p class="hint danger-hint" role="alert">
					<IconWarning />
					<span>{m.lane_delete_unintegrated_warning({ commits: deleteLoss.commits, files: deleteLoss.files })}</span>
				</p>
			{/if}
			<button type="button" class="row danger" onclick={() => void executeDeleteClosedLane()}>
				<IconTrash /> <span class="row-label">{m.lanestrip_delete_dialog_confirm()}</span>
			</button>
			<button type="button" class="row" onclick={() => { view = 'default'; deleteConfirmTarget = null; deleteLoss = null; }}>
				<span class="row-label indent">{m.lanestrip_delete_dialog_cancel()}</span>
			</button>
		</div>
	{:else if view === 'default'}
		{#if settingsStore.projectBar.showQueuePeek && !isScratchpad && queueTasks.length > 0}
			<section class="block">
				<h4>{m.project_popover_queue_header({ count: queueTasks.length })}</h4>
				{#if !ready && reason}
					<p class="hint"><IconWarning /> <span>{reason}</span></p>
				{/if}
				{#each queueTasks.slice(0, QUEUE_PEEK_LIMIT) as task (task.id)}
					<div class="task">
						<span class="task-label" title={taskLabel(task)}>
							<MentionText text={taskLabel(task)} onOpenFile={openMentionFile} />
						</span>
						<button
							type="button"
							class="icon-btn"
							disabled={!ready}
							onclick={(event) => runTask(task, event.ctrlKey || event.metaKey)}
							aria-label={m.project_popover_run_task_aria({ task: taskLabel(task) })}
							title={ready
								? m.ui_projectpopover_avvia_in_background_ctrl_click_avvia_e_6a02()
								: reason}
						>
							<IconPlay />
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => editTask(task)}
							aria-label={m.project_popover_edit_task_aria({ task: taskLabel(task) })}
							title={m.project_popover_edit_task_title()}
						>
							<IconRename />
						</button>
					</div>
				{/each}
				{#if queueTasks.length > QUEUE_PEEK_LIMIT}
					<button type="button" class="row subtle" onclick={openQueue}>
						<span class="row-label indent">+{queueTasks.length - QUEUE_PEEK_LIMIT} altri task</span>
					</button>
				{/if}
			</section>
		{/if}

		<section class="block">
			{#if !isActive}
				<button type="button" class="row" onclick={select}>
					<IconCheck /> <span class="row-label">{m.project_popover_select_project()}</span>
				</button>
			{/if}
			<button type="button" class="row" onclick={newTask}>
				<IconPlus /> <span class="row-label">{m.project_popover_new_task()}</span>
			</button>
			<button type="button" class="row" onclick={openQueue}>
				<IconQueue /> <span class="row-label">{m.project_popover_all_projects_queue()}</span>
				<kbd>Ctrl+Alt+T</kbd>
			</button>
			{#if !isScratchpad}
				<button
					type="button"
					class="row"
					onclick={() => projectStore.setAutoDispatch(project.id, !project.autoDispatch)}
					aria-pressed={project.autoDispatch}
				>
					<IconAuto /> <span class="row-label">{m.project_popover_auto_dispatch()}</span>
					<span class="row-state">{project.autoDispatch ? m.project_popover_auto_dispatch_on() : m.project_popover_auto_dispatch_off()}</span>
				</button>
			{/if}
		</section>

		{#if !isScratchpad && project.canonicalProjectPath && !project.labDraft && (upstream?.isGit || remoteError)}
			<section class="block git-section">
				<h4>{m.project_popover_git_upstream_title()}</h4>
				<div class="git-branch-row">
					<span class="git-branch-info">
						<IconGitBranch />
						<span class="branch-name" title={upstream?.branch}>{upstream?.branch ?? '—'}</span>
						{#if upstream?.upstream}
							<span class="upstream-target" title={upstream.upstream}>→ {upstream.upstream}</span>
						{:else if upstream?.isGit}
							<span class="no-upstream">({m.project_popover_git_no_upstream()})</span>
						{/if}
					</span>
					{#if upstream && upstream.isGit}
						<span class="git-badges">
							{#if upstream.behind > 0}
								<span class="git-pill behind" title={m.topbar_upstream_behind_tooltip({ count: upstream.behind })}>
									<IconDownload />
									<span>{upstream.behind}</span>
								</span>
							{/if}
							{#if upstream.ahead > 0}
								<span class="git-pill ahead" title={m.topbar_upstream_ahead_tooltip({ count: upstream.ahead })}>
									<IconArrowUp />
									<span>{upstream.ahead}</span>
								</span>
							{/if}
							{#if upstream.upstream && upstream.behind === 0 && upstream.ahead === 0}
								<span class="git-pill up-to-date" title={m.project_popover_git_up_to_date()}>
									<IconCheck />
									<span>{m.project_popover_git_up_to_date()}</span>
								</span>
							{/if}
						</span>
					{/if}
				</div>

				{#if pullError || remoteError}
					<div class="git-error-banner" role="alert">
						<IconWarning />
						<span>{pullError || remoteError}</span>
					</div>
				{/if}

				{#if pullSuccess}
					<div class="git-success-banner" role="status">
						<IconCheck />
						<span>{pullSuccess}</span>
					</div>
				{/if}

				{#if upstream && upstream.behind > 0}
					{#if upstream.incomingCommits && upstream.incomingCommits.length > 0}
						<div class="git-commits-preview">
							<span class="git-commits-label">{m.project_popover_git_incoming_commits({ count: upstream.behind })}</span>
							<ul class="git-commits-list">
								{#each upstream.incomingCommits.slice(0, 5) as commit (commit.hash || commit.shortHash)}
									<li class="git-commit-item" title={`${commit.shortHash} - ${commit.author} - ${commit.date}`}>
										<span class="git-commit-hash">{commit.shortHash}</span>
										<span class="git-commit-subject">{commit.subject}</span>
									</li>
								{/each}
							</ul>
							{#if upstream.incomingCommits.length > 5}
								<span class="git-commits-more">+{upstream.incomingCommits.length - 5} {m.project_popover_git_more_commits()}</span>
							{/if}
						</div>
					{/if}

					<div class="git-pull-action">
						<button
							type="button"
							class="row-btn git-pull-btn"
							disabled={isPullDisabled}
							title={pullDisableReason ?? m.project_popover_git_clean_requirement()}
							onclick={() => void handlePull()}
						>
							{#if isPulling || isSyncing}
								<IconRefresh class="spin" />
								<span>{m.project_popover_git_pulling()}</span>
							{:else}
								<IconDownload />
								<span>{m.project_popover_git_pull_button()}</span>
							{/if}
						</button>
						<p class="git-requirement-hint" class:warn={Boolean(pullDisableReason)}>
							{#if pullDisableReason}
								<IconWarning /> <span>{pullDisableReason}</span>
							{:else}
								<span>{m.project_popover_git_clean_requirement()}</span>
							{/if}
						</p>
					</div>
				{/if}
			</section>
		{/if}

		{#if project.labDraft}
			<section class="block">
				<button type="button" class="row" onclick={() => (view = 'associate')}>
					<IconFolderOpen /> <span class="row-label">{m.lab_lane_associate_project()}</span>
				</button>
			</section>
		{:else if !isScratchpad}
			<section class="block">
				<!-- Due bottoni affiancati compatti per creazione (Decisione 3) -->
				<div class="row-pair">
					<button
						type="button"
						class="row-btn"
						disabled={!isGitRepo}
						title={!isGitRepo ? m.lab_lane_new_worktree_disabled_no_git() : undefined}
						onclick={() => void handleCreateWorktreeLane()}
					>
						<IconPlus /> <span>{m.lanestrip_new_worktree()}</span>
					</button>
					{#if settingsStore.general.labAlphaEnabled}
						<button
							type="button"
							class="row-btn"
							onclick={() => void handleCreateLabPrototype()}
						>
							<IconLab /> <span>{m.lanestrip_new_prototype()}</span>
						</button>
					{/if}
				</div>

				{#if closedLanes.length > 0}
					<button
						bind:this={protoRowEl}
						type="button"
						class="row"
						class:open={protoMenuOpen}
						aria-haspopup="menu"
						aria-expanded={protoMenuOpen}
						onclick={(event) => toggleProtoMenu(event.detail === 0)}
						onkeydown={handleProtoRowKeydown}
					>
						<span class="row-label">{m.lanestrip_closed_lanes_count({ count: closedLanes.length })}</span>
						<IconChevronRight />
					</button>
					{#if protoMenuOpen}
						<div
							bind:this={protoMenuEl}
							class="proto-menu"
							class:flipped={protoMenuFlipped}
							popover="manual"
							role="menu"
							tabindex="-1"
							aria-label={m.lanestrip_closed_lanes_count({ count: closedLanes.length })}
							use:anchoredPopover={{
								anchor: panelEl,
								alignTo: protoRowEl,
								placement: 'right-start',
								offset: 2,
								onFlip: (value) => (protoMenuFlipped = value),
								motion: true
							}}
							onkeydown={handleProtoMenuKeydown}
						>
							{#each closedLanes as entry (entry.laneId)}
								<div class="proto-menu-row">
									<button
										type="button"
										class="row proto-item-btn"
										role="menuitem"
										onclick={() => void handleReopenClosedLane(entry)}
									>
										{#if entry.kind === 'lab'}
											<IconLab />
										{:else}
											<IconGitBranch />
										{/if}
										<span class="row-label" title={entry.title}>{entry.title}</span>
										<span class="row-date">{formatRelativeDate(entry.closedAt)}</span>
									</button>
									<button
										type="button"
										class="proto-delete-btn"
										title={entry.kind === 'lab'
											? m.lanestrip_action_delete_prototype()
											: m.lanestrip_action_delete_worktree()}
										aria-label={entry.kind === 'lab'
											? m.lanestrip_action_delete_prototype()
											: m.lanestrip_action_delete_worktree()}
										onclick={(e) => {
											e.stopPropagation();
											void requestDeleteClosedLane(entry);
										}}
									>
										<IconTrash />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				{#if isGitRepo}
					<button
						type="button"
						class="row"
						onclick={() => projectStore.setWorktreeResumeChat(project.id, !(project.worktreeResumeChat ?? true))}
						aria-pressed={project.worktreeResumeChat ?? true}
					>
						<IconGitBranch /> <span class="row-label">{m.lanestrip_resume_chat()}</span>
						<span class="row-state">{(project.worktreeResumeChat ?? true) ? m.lanestrip_resume_chat_yes() : m.lanestrip_resume_chat_no()}</span>
					</button>
				{/if}
			</section>
		{/if}

		{#if !isScratchpad}
			<section class="block">
				<button type="button" class="row" onclick={copyPath}>
					<IconCopy /> <span class="row-label">{m.project_popover_copy_path()}</span>
				</button>
				<button type="button" class="row" onclick={reveal}>
					<IconFolderOpen /> <span class="row-label">{m.project_popover_reveal_folder()}</span>
				</button>
				<button type="button" class="row" onclick={() => void openExternal('terminal')}>
					<IconTerminal /> <span class="row-label">{m.project_popover_open_terminal()}</span>
				</button>
				<button type="button" class="row" onclick={() => void openExternal('editor')}>
					<IconEditor /> <span class="row-label">{m.project_popover_open_editor()}</span>
				</button>
			</section>

			<section class="block">
				<h4>{m.project_popover_color_title()}</h4>
				<HuePicker
					hue={project.hue}
					mode={project.colorMode}
					{autoHue}
					onhue={(hue) => projectStore.setProjectHue(project.id, hue)}
					onauto={() => projectStore.useAutomaticProjectColor(project.id)}
				/>
			</section>
		{/if}

		<section class="block">
			{#if canReorder}
				<div class="row static">
					<span class="row-label indent">{m.project_popover_shift_tab()}</span>
					<span class="row-tools">
						<button
							type="button"
							class="icon-btn"
							onclick={() => shift(-1)}
							aria-label={m.project_popover_shift_left_aria()}
							title={m.project_popover_shift_left()}
						>
							<IconArrowLeft />
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => shift(1)}
							aria-label={m.project_popover_shift_right_aria()}
							title={m.project_popover_shift_right()}
						>
							<IconArrowRight />
						</button>
					</span>
				</div>
			{/if}
			<button type="button" class="row danger" onclick={requestClose}>
				<IconClose /> <span class="row-label">{m.project_popover_close_project()}</span>
			</button>
			{#if otherProjectCount > 0}
				<button type="button" class="row danger" onclick={() => (view = 'close-others')}>
					<IconCloseOthers /> <span class="row-label">{m.project_popover_close_others()}</span>
				</button>
			{/if}
		</section>
	{/if}

	<p class="notice" aria-live="polite">{notice}</p>
</div>

<style>
	.project-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		/* Larghezza fissa, non dettata dal contenuto: la riga di un task in
		   coda e' una riga di prompt e su una riga sola spingerebbe il pannello
		   oltre lo schermo. Qui il testo si taglia, il pannello non cresce. */
		width: 300px;
		max-width: calc(100vw - 2 * var(--space-2));
		max-height: calc(100vh - 64px);
		overflow-x: hidden;
		overflow-y: auto;
		box-sizing: border-box;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-3);
		color: var(--ink);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		--dur: var(--dur-menu, 150ms);
		--blur: 3px;
	}

	/* Ponte sopra lo stacco fra tessera e pannello: senza, il mouse che
	   attraversa i 6px di distacco fa scattare la chiusura. Il lato del ponte
	   segue il ribaltamento, altrimenti coprirebbe contenuto dell'app. */
	.project-popover::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -8px;
		height: 8px;
	}

	.project-popover.flipped::before {
		top: auto;
		bottom: -8px;
	}

	.project-popover.pinned {
		border-color: var(--line-strong);
		box-shadow: var(--shadow-overlay), inset 0 0 0 1px var(--line-strong);
	}

	.popover-quick-reply {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		margin-top: var(--space-1);
	}

	.quick-ask-prompt {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--ink);
		margin: 0;
		line-height: 1.4;
	}

	.quick-composer-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 12px;
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--brand-ink);
		font-size: var(--text-caption);
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		transition: background var(--dur-fast) var(--ease-out),
		            border-color var(--dur-fast) var(--ease-out),
		            color var(--dur-fast) var(--ease-out);
	}

	.quick-composer-btn:hover {
		background: var(--bg-active);
		border-color: var(--line-strong);
		color: var(--brand-ink);
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.proj-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 20px;
		min-width: 22px;
		max-width: 96px;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		color: var(--on-project);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.proj-chip.scratchpad {
		background: var(--bg-hover);
		color: var(--ink-muted);
		padding: 0 4px;
	}

	.titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 2px;
	}

	.name {
		font-size: var(--text-sm);
		font-weight: 600;
		line-height: 20px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.path-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: 0 var(--space-1);
	}

	.state.working {
		color: var(--brand-ink);
	}

	.state.attention {
		color: var(--warn);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 1px;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}

	h4 {
		margin: 0 0 2px;
		padding: 0 var(--space-2);
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		padding: 7px 8px;
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-label);
		text-align: left;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.row:hover:not(.static),
	.row:focus-visible {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.row.static {
		cursor: default;
	}

	.row.danger {
		color: var(--danger);
	}

	.row.danger:hover {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		color: var(--danger);
	}

	.row.subtle {
		color: var(--ink-faint);
	}

	.row.open {
		background: var(--bg-hover);
		color: var(--ink);
	}

	/* Sottomenu laterale: stessa pelle del pannello, piu' stretto. Il lato lo
	   decide `anchoredPopover` (`right-start`), che lo ribalta a sinistra
	   quando a destra non c'e' spazio. */
	.proto-menu {
		position: fixed;
		inset: auto;
		margin: 0;
		width: 260px;
		max-width: calc(100vw - 2 * var(--space-2));
		max-height: calc(100vh - 64px);
		overflow-x: hidden;
		overflow-y: auto;
		box-sizing: border-box;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-2);
		color: var(--ink);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		gap: 1px;
		--dur: var(--dur-menu, 150ms);
		--blur: 3px;
	}

	.row-pair {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
	}

	.row-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		flex: 1;
		min-width: 0;
		height: 26px;
		padding: 0 var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-family: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
		white-space: nowrap;
		transition: background-color var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
	}

	.row-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.row-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.row-btn :global(svg) {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	.proto-menu-row {
		display: flex;
		align-items: center;
		width: 100%;
		border-radius: var(--radius-md);
		position: relative;
	}

	.proto-menu-row .proto-item-btn {
		flex: 1;
		min-width: 0;
	}

	.row-date {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		white-space: nowrap;
		padding-left: var(--space-2);
	}

	.proto-delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		margin-right: 4px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color var(--dur-fast), color var(--dur-fast);
	}

	.proto-delete-btn:hover {
		background: color-mix(in srgb, var(--danger) 14%, var(--bg-raised));
		color: var(--danger);
	}

	.proto-delete-btn :global(svg) {
		width: 12px;
		height: 12px;
	}

	.row-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-label.indent {
		padding-left: calc(14px + var(--space-2));
	}

	.row-state {
		flex: none;
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-faint);
	}

	.row-tools {
		display: flex;
		gap: 2px;
		flex: none;
	}

	kbd {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.icon-btn {
		display: grid;
		place-items: center;
		flex: none;
		width: 22px;
		height: 22px;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: pointer;
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--line-strong);
		color: var(--ink);
	}

	.icon-btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.task {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 1px var(--space-2);
	}

	.task-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.hint {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 2px;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--warn);
	}

	.hint span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.danger-hint {
		align-items: flex-start;
		margin: var(--space-1) 0 var(--space-2);
		color: var(--danger);
	}

	.confirm {
		display: flex;
		flex-direction: column;
		gap: 1px;
		border-top: 1px solid var(--line);
		padding-top: var(--space-2);
	}

	.confirm p {
		margin: 0 0 var(--space-1);
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-muted);
	}

	.rename {
		display: grid;
		gap: var(--space-2);
	}

	.rename label {
		display: grid;
		gap: 2px;
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.rename input {
		width: 100%;
		box-sizing: border-box;
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		color: var(--ink);
		font: inherit;
		font-size: var(--text-sm);
		padding: var(--space-1) var(--space-2);
	}

	.rename-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.btn-ghost,
	.btn-primary {
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-2);
	}

	.btn-ghost:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.btn-primary {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
	}

	.notice {
		margin: 0;
		min-height: 0;
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
	}

	.notice:empty {
		display: none;
	}
	.git-branch-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 4px var(--space-2);
		font-size: var(--text-xs);
		min-width: 0;
	}

	.git-branch-info {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.git-branch-info :global(svg) {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--ink-muted);
	}

	.branch-name {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.upstream-target {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.no-upstream {
		font-size: var(--text-caption);
		color: var(--ink-faint);
		font-style: italic;
	}

	.git-badges {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.git-pill {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		line-height: 1;
		padding: 2px 5px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.git-pill :global(svg) {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
	}

	.git-pill.behind {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.git-pill.ahead {
		background: color-mix(in srgb, var(--brand) 15%, transparent);
		color: var(--brand);
		border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
	}

	.git-pill.up-to-date {
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		color: var(--ok);
		border: 1px solid color-mix(in srgb, var(--ok) 25%, transparent);
	}

	.git-error-banner {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 6px var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
		color: var(--danger);
		font-size: var(--text-xs);
		line-height: 1.3;
		margin: 2px var(--space-2);
	}

	.git-error-banner :global(svg) {
		width: 13px;
		height: 13px;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.git-success-banner {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--ok) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--ok) 25%, transparent);
		color: var(--ok);
		font-size: var(--text-xs);
		margin: 2px var(--space-2);
	}

	.git-success-banner :global(svg) {
		width: 13px;
		height: 13px;
		flex-shrink: 0;
	}

	.git-commits-preview {
		padding: 2px var(--space-2);
	}

	.git-commits-label {
		display: block;
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 3px;
	}

	.git-commits-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.git-commit-item {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 11px;
		color: var(--ink-muted);
		padding: 1px 0;
	}

	.git-commit-hash {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.git-commit-subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.git-commits-more {
		display: block;
		font-size: var(--text-caption);
		color: var(--ink-faint);
		margin-top: 2px;
		font-style: italic;
	}

	.git-pull-action {
		padding: 4px var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.git-pull-btn {
		width: 100%;
		height: 28px;
		background: color-mix(in srgb, var(--brand) 12%, transparent);
		color: var(--brand);
		border-color: color-mix(in srgb, var(--brand) 30%, transparent);
		font-weight: 500;
	}

	.git-pull-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 20%, transparent);
		color: var(--brand);
		border-color: color-mix(in srgb, var(--brand) 45%, transparent);
	}

	.git-pull-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: var(--bg-raised);
		color: var(--ink-faint);
		border-color: var(--line);
	}

	.git-requirement-hint {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.3;
		color: var(--ink-faint);
		display: flex;
		align-items: flex-start;
		gap: 4px;
	}

	.git-requirement-hint.warn {
		color: var(--warn);
	}

	.git-requirement-hint :global(svg) {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
		margin-top: 1px;
	}
</style>
