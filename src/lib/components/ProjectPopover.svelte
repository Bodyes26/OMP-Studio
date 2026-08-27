<script lang="ts">
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
		canRunTask,
		runReason
	}: Props = $props();

	type View = 'default' | 'rename' | 'close' | 'close-others';

	const AGENT_STATE_LABEL: Record<Project['agentState'], string> = {
		working: 'Agente al lavoro',
		attention: 'Attende una risposta',
		finished: 'Ha finito il lavoro',
		idle: 'In attesa di istruzioni',
		unknown: 'Nessuna sessione aperta'
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
	const canReorder = $derived(settingsStore.projectBar.order === 'fixed');

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
		return 'Nuovo task';
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
			flash('Percorso copiato negli appunti');
		} catch {
			flash('Copia negli appunti non riuscita');
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
			flash(typeof error === 'string' ? error : 'Apertura non riuscita');
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

	/** La sorte della coda alla chiusura segue le impostazioni generali. */
	function requestClose() {
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
			if (other.path && settingsStore.general.closeWithQueuedTasks === 'discard') {
				taskStore.clearProject(other.path);
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
	aria-label={`Progetto ${project.name}: dettagli e azioni`}
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
				<span>Nome</span>
				<input bind:value={nameDraft} aria-label="Nome progetto" onkeydown={handleRenameKeydown} />
			</label>
			{#if !isScratchpad}
				<label>
					<span>Sigla</span>
					<input
						bind:value={labelDraft}
						aria-label="Sigla progetto"
						placeholder={initials(project.name)}
						onkeydown={handleRenameKeydown}
					/>
				</label>
			{/if}
			<div class="rename-actions">
				<button type="button" class="btn-ghost" onclick={() => (view = 'default')}>Annulla</button>
				<button type="submit" class="btn-primary">Salva</button>
			</div>
		</form>
	{:else}
		<header class="head">
			<span class="tile" class:scratchpad={isScratchpad} style="--tile-hue: {autoHue}" aria-hidden="true">
				{#if isScratchpad}
					<IconGhost />
				{:else}
					{project.label ?? initials(project.name)}
				{/if}
			</span>
			<span class="titles">
				<span class="name">{project.name}</span>
				<span class="path">{isScratchpad ? 'Chat temporanea' : truncateMiddle(project.path)}</span>
			</span>
			<button
				type="button"
				class="icon-btn"
				onclick={() => {
					nameDraft = project.name;
					labelDraft = project.label ?? '';
					view = 'rename';
				}}
				aria-label="Modifica nome e sigla"
				title="Modifica nome e sigla"
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
	{/if}

	{#if view === 'close'}
		<div class="confirm">
			<p>Ci sono task in coda su questo progetto.</p>
			<button type="button" class="row" onclick={() => closeProject(false)}>
				<IconCheck /> <span class="row-label">Chiudi e conserva la coda</span>
			</button>
			<button type="button" class="row danger" onclick={() => closeProject(true)}>
				<IconClose /> <span class="row-label">Chiudi ed elimina i task</span>
			</button>
			<button type="button" class="row" onclick={() => (view = 'default')}>
				<span class="row-label indent">Annulla</span>
			</button>
		</div>
	{:else if view === 'close-others'}
		<div class="confirm">
			<p>Chiudo gli altri {otherProjectCount} progetti aperti?</p>
			<button type="button" class="row danger" onclick={closeOthers}>
				<IconCloseOthers /> <span class="row-label">Chiudi gli altri {otherProjectCount}</span>
			</button>
			<button type="button" class="row" onclick={() => (view = 'default')}>
				<span class="row-label indent">Annulla</span>
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
							aria-label={`Avvia task: ${taskLabel(task)}`}
							title={ready
								? 'Avvia in background. Ctrl+click: avvia e passa al progetto.'
								: reason}
						>
							<IconPlay />
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => editTask(task)}
							aria-label={`Modifica task: ${taskLabel(task)}`}
							title="Modifica il task"
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
					<IconCheck /> <span class="row-label">Seleziona progetto</span>
				</button>
			{/if}
			<button type="button" class="row" onclick={newTask}>
				<IconPlus /> <span class="row-label">Nuovo task</span>
			</button>
			<button type="button" class="row" onclick={openQueue}>
				<IconQueue /> <span class="row-label">Coda di tutti i progetti</span>
				<kbd>Ctrl+Alt+T</kbd>
			</button>
			{#if !isScratchpad}
				<button
					type="button"
					class="row"
					onclick={() => projectStore.setAutoDispatch(project.id, !project.autoDispatch)}
					aria-pressed={project.autoDispatch}
				>
					<IconAuto /> <span class="row-label">Avvio automatico dei task</span>
					<span class="row-state">{project.autoDispatch ? 'attivo' : 'spento'}</span>
				</button>
			{/if}
		</section>

		{#if !isScratchpad}
			<section class="block">
				<button type="button" class="row" onclick={copyPath}>
					<IconCopy /> <span class="row-label">Copia percorso</span>
				</button>
				<button type="button" class="row" onclick={reveal}>
					<IconFolderOpen /> <span class="row-label">Mostra nella cartella</span>
				</button>
				<button type="button" class="row" onclick={() => void openExternal('terminal')}>
					<IconTerminal /> <span class="row-label">Apri nel terminale</span>
				</button>
				<button type="button" class="row" onclick={() => void openExternal('editor')}>
					<IconEditor /> <span class="row-label">Apri nell'editor esterno</span>
				</button>
			</section>

			<section class="block">
				<h4>Colore</h4>
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
					<span class="row-label indent">Sposta tessera</span>
					<span class="row-tools">
						<button
							type="button"
							class="icon-btn"
							onclick={() => shift(-1)}
							aria-label="Sposta la tessera a sinistra"
							title="Sposta a sinistra (Ctrl+Alt+Shift+←)"
						>
							<IconArrowLeft />
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={() => shift(1)}
							aria-label="Sposta la tessera a destra"
							title="Sposta a destra (Ctrl+Alt+Shift+→)"
						>
							<IconArrowRight />
						</button>
					</span>
				</div>
			{/if}
			<button type="button" class="row danger" onclick={requestClose}>
				<IconClose /> <span class="row-label">Chiudi progetto</span>
			</button>
			{#if otherProjectCount > 0}
				<button type="button" class="row danger" onclick={() => (view = 'close-others')}>
					<IconCloseOthers /> <span class="row-label">Chiudi gli altri progetti</span>
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

	.tile {
		display: grid;
		place-items: center;
		flex: none;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--tile-hue));
		color: var(--on-project);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
	}

	.tile.scratchpad {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.name {
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.path {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
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
