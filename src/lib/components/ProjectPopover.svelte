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
	import { projectStore, type Project } from '$lib/stores/projects.svelte';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { anchoredPopover } from '$lib/anchoredPopover';
	import { companionStore } from '$lib/stores/companion.svelte';
	import { askQuestionText } from '$lib/agent/askTitle';
	import HuePicker from './HuePicker.svelte';
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
		IconStatusPending,
		IconStatusRunning,
		IconTerminal,
		IconWarning
	} from '$lib/icons';
	import { invoke } from '@tauri-apps/api/core';
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
		runReason
	}: Props = $props();

	type View = 'default' | 'rename' | 'close' | 'close-others';

	const AGENT_STATE_LABEL: Record<Project['agentState'], string> = {
		working: m.ui_projectpopover_agente_al_lavoro_200b(),
		attention: m.ui_projectpopover_attende_una_risposta_b102(),
		finished: 'Ha finito il lavoro',
		idle: m.ui_projectpopover_in_attesa_di_istruzioni_eca6(),
		unknown: m.ui_projectpopover_nessuna_sessione_aperta_18f8()
	};

	const QUEUE_PEEK_LIMIT = 5;

	let panelEl = $state<HTMLElement | null>(null);
	let view = $state<View>('default');
	let flipped = $state(false);
	let nameDraft = $state('');
	let labelDraft = $state('');
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	const isScratchpad = $derived(!project.path);
	const isActive = $derived(projectStore.activeId === project.id);
	const ready = $derived(canRunTask?.(project.id) ?? false);
	const reason = $derived(runReason?.(project.id) ?? '');
	const queueTasks = $derived(project.path ? taskStore.tasksFor(project.path) : []);
	const attentionReq = $derived(companionStore.attentionRequests.find((r) => r.projectId === project.id));

	async function handleQuickReplySelect(value: string) {
		await companionStore.respondUi(project.id, { action: 'select', value });
		onClose();
	}

	async function handleQuickReplyConfirm(confirmed: boolean) {
		await companionStore.respondUi(project.id, { action: 'confirm', confirmed });
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
		const line = task.prompt.split(/\r?\n/).find((entry) => entry.trim())?.trim();
		if (line) return line;
		if (task.images && task.images.length > 0) return '(solo immagini)';
		return m.project_popover_new_task();
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
		try {
			await navigator.clipboard.writeText(project.path);
			flash(m.project_popover_toast_copied());
		} catch {
			flash(m.project_popover_toast_copy_failed());
		}
	}

	function reveal() {
		void revealItemInDir(project.path);
		onClose();
	}

	async function openExternal(target: 'terminal' | 'editor') {
		try {
			await invoke('open_project_external', { projectPath: project.path, target });
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
		const queued = project.path ? taskStore.queuedCountFor(project.path) : 0;
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
		if (discardQueue && project.path) taskStore.clearProject(project.path);
		projectStore.closeProject(project.id);
		onClose();
	}

	function closeOthers() {
		for (const other of [...projectStore.projects]) {
			if (other.id === project.id) continue;
			if (other.path) {
				if (settingsStore.general.closeWithQueuedTasks === 'discard') {
					taskStore.clearProject(other.path);
				} else if (other.agentState === 'working') {
					void taskStore.requeueInterruptedTask(other.path);
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
	use:anchoredPopover={{ anchor, offset: 6, onFlip: (value) => (flipped = value) }}
	onpointerenter={() => onHoverChange(true)}
	onpointerleave={() => onHoverChange(false)}
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
					<span>Sigla</span>
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
				{#if isScratchpad}
					<IconGhost />
				{:else}
					{project.label ?? initials(project.name)}
				{/if}
			</span>
			<span class="titles">
				<span class="name" title={project.name}>{project.name}</span>
				<span class="path" title={project.path}>{isScratchpad ? m.project_popover_badge_scratchpad() : truncateMiddle(project.path)}</span>
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

		<div class="state" class:working={project.agentState === 'working'} class:attention={project.agentState === 'attention'}>
			{#if project.agentState === 'working'}
				<IconStatusRunning />
			{:else if project.agentState === 'attention'}
				<IconWarning />
			{:else if project.agentState === 'finished'}
				<IconCheck />
			{:else}
				<IconStatusPending />
			{/if}
			<span>{AGENT_STATE_LABEL[project.agentState]}</span>
		</div>
		{#if attentionReq}
			<div class="popover-quick-reply">
				{#if attentionReq.recentMessages && attentionReq.recentMessages.length > 0}
					<div class="quick-context">
						{#each attentionReq.recentMessages.slice(-2) as msg, i (i)}
							<div class="context-item {msg.role}">
								<strong>{msg.role === 'user' ? m.project_popover_speaker_you() : m.project_popover_speaker_agent()}:</strong>
								<span>{msg.text}</span>
							</div>
						{/each}
					</div>
				{/if}

				<p class="quick-ask-prompt">{askQuestionText(attentionReq.pendingUi, m.project_popover_quick_ask_title())}</p>

				{#if attentionReq.pendingUi.options && attentionReq.pendingUi.options.length > 0}
					<div class="quick-options">
						{#each attentionReq.pendingUi.options as opt, idx (opt)}
							<button
								type="button"
								class="quick-opt-btn"
								onclick={() => void handleQuickReplySelect(opt)}
							>
								<span class="q-num">{idx + 1}</span>
								<span>{opt}</span>
							</button>
						{/each}
					</div>
				{:else if attentionReq.pendingUi.method === 'confirm'}
					<div class="quick-confirm-btns">
						<button
							type="button"
							class="quick-action-btn confirm"
							onclick={() => void handleQuickReplyConfirm(true)}
						>
							<IconCheck /> {m.project_popover_btn_confirm_yes()}
						</button>
						<button
							type="button"
							class="quick-action-btn cancel"
							onclick={() => void handleQuickReplyConfirm(false)}
						>
							<IconClose /> {m.project_popover_btn_confirm_no()}
						</button>
					</div>
				{/if}
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
	{:else if view === 'default'}
		{#if settingsStore.projectBar.showQueuePeek && !isScratchpad && queueTasks.length > 0}
			<section class="block">
				<h4>Coda ({queueTasks.length})</h4>
				{#if !ready && reason}
					<p class="hint"><IconWarning /> <span>{reason}</span></p>
				{/if}
				{#each queueTasks.slice(0, QUEUE_PEEK_LIMIT) as task (task.id)}
					<div class="task">
						<span class="task-label" title={taskLabel(task)}>{taskLabel(task)}</span>
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
							aria-label="Sposta la tessera a sinistra"
							title={m.project_popover_shift_left()}
						>
							<IconArrowLeft />
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => shift(1)}
							aria-label="Sposta la tessera a destra"
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
		animation: popover-in var(--dur-slow) var(--ease-out-expo);
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
		border-color: var(--brand);
	}

	.popover-quick-reply {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		margin-top: var(--space-1);
	}

	.quick-context {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 6px;
		max-height: 120px;
		overflow-y: auto;
	}

	.context-item {
		font-size: var(--text-xs);
		line-height: 1.3;
	}

	.context-item strong {
		color: var(--brand);
		margin-right: 4px;
	}

	.context-item.assistant strong {
		color: var(--ink-muted);
	}

	.context-item span {
		color: var(--ink-muted);
		word-break: break-word;
	}

	.quick-ask-prompt {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.quick-options {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.quick-opt-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
		text-align: left;
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.quick-opt-btn:hover {
		background: var(--bg-hover);
		border-color: var(--brand);
	}

	.q-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		background: var(--bg-sunken);
		border-radius: 2px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-muted);
	}

	.quick-confirm-btns {
		display: flex;
		gap: var(--space-2);
	}

	.quick-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		font-size: var(--text-xs);
		font-weight: 500;
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: 1px solid var(--line);
	}

	.quick-action-btn.confirm {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--brand);
	}

	.quick-action-btn.cancel {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}
	@keyframes popover-in {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
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
		font-size: 10px;
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

	.path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		line-height: 1.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
		padding: 5px var(--space-2);
		color: var(--ink-muted);
		font: inherit;
		font-size: var(--text-xs);
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

	.row.danger:hover {
		color: var(--brand-ink);
	}

	.row.subtle {
		color: var(--ink-faint);
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
		font-size: 10px;
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
		font-size: 10px;
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
		border-radius: var(--radius-sm);
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
</style>
