<script lang="ts">
	import SessionList from './SessionList.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import EmptyState from './EmptyState.svelte';
	import { taskStore, type AgentView, type StudioTask } from '$lib/stores/tasks.svelte';
	import { rulesStore } from '$lib/stores/rules.svelte';

	let {
		projectPath,
		canAutomate,
		automationReason,
		actionError,
		currentSessionId,
		onCreateTask,
		onEditTask,
		onRunTask,
		onResumeSession,
		onOpenFile
	}: {
		projectPath: string;
		canAutomate: boolean;
		automationReason: string;
		actionError: string | null;
		currentSessionId: string | null;
		onCreateTask: () => void;
		onEditTask: (taskId: string) => void;
		onRunTask: (taskId: string) => void;
		onResumeSession: (sessionId: string) => void;
		onOpenFile: (relPath: string) => void;
	} = $props();

	const tasks = $derived(taskStore.tasksFor(projectPath));
	const view = $derived(taskStore.viewFor(projectPath));
	const frictionCount = $derived(rulesStore.suggestionsFor(projectPath).length);

	// L'analisi dell'attrito e' una singola query in sola lettura sullo storico:
	// gira al montaggio del pannello perche' il conteggio sulla scheda deve
	// esserci prima che l'utente pensi ad aprirla.
	$effect(() => {
		if (!projectPath) return;
		void rulesStore.analyzeFriction(projectPath);
	});

	let draggedId = $state<string | null>(null);

	function setView(next: AgentView) {
		taskStore.setView(projectPath, next);
	}

	function taskTitle(task: StudioTask) {
		return task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task';
	}

	function taskExcerpt(task: StudioTask) {
		const compact = task.prompt.replace(/\s+/g, ' ').trim();
		if (compact) return compact;
		if (task.images && task.images.length > 0) {
			return `${task.images.length} ${task.images.length === 1 ? 'immagine allegata' : 'immagini allegate'}`;
		}
		return 'Prompt ancora vuoto';
	}

	function dropOn(targetId: string) {
		if (draggedId) taskStore.moveTask(draggedId, targetId);
		draggedId = null;
	}

	function handleMoveKey(event: KeyboardEvent, taskId: string) {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		event.preventDefault();
		taskStore.moveTaskBy(taskId, event.key === 'ArrowUp' ? -1 : 1);
	}

	function roleBadge(role?: string): string | null {
		switch (role) {
			case 'smol': return 'smol';
			case 'slow': return 'slow';
			case 'plan': return 'plan';
			case 'custom': return 'custom';
			case 'default': return 'default';
			default: return null;
		}
	}
</script>

<div class="agent-panel">
	<div class="agent-tabs" role="tablist" aria-label="Pannello agente">
		<button
			type="button"
			role="tab"
			id="tab-agent-queue"
			aria-controls="panel-agent-queue"
			aria-selected={view === 'queue'}
			class:active={view === 'queue'}
			onclick={() => setView('queue')}
		>
			Coda
			{#if tasks.length > 0}<span class="count">{tasks.length}</span>{/if}
		</button>
		<button
			type="button"
			role="tab"
			id="tab-agent-sessions"
			aria-controls="panel-agent-sessions"
			aria-selected={view === 'sessions'}
			class:active={view === 'sessions'}
			onclick={() => setView('sessions')}
		>
			Sessioni
		</button>
		<button
			type="button"
			role="tab"
			id="tab-agent-rules"
			aria-controls="panel-agent-rules"
			aria-selected={view === 'rules'}
			class:active={view === 'rules'}
			onclick={() => setView('rules')}
		>
			Regole
			{#if frictionCount > 0}<span class="count alert">{frictionCount}</span>{/if}
		</button>
	</div>

	{#if actionError}
		<div class="action-error" role="alert" aria-live="assertive">{actionError}</div>
	{/if}

	{#if view === 'queue'}
		<div id="panel-agent-queue" role="tabpanel" aria-labelledby="tab-agent-queue" class="panel-tab-body">
			<div class="queue-toolbar">
				<button type="button" class="new-task" onclick={onCreateTask} aria-label="Crea nuovo task">
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
					Nuovo task
				</button>
				{#if !canAutomate && automationReason}
					<span class="automation-state" role="status" aria-live="polite" title={automationReason}>{automationReason}</span>
				{/if}
			</div>

			<ul class="queue-list" aria-label="Task in coda">
				{#if tasks.length === 0}
					<li class="empty-task-container">
						<EmptyState
							variant="no-tasks"
							compact={true}
							primaryAction={{
								label: 'Nuovo task',
								onClick: onCreateTask
							}}
							shortcuts={[
								{ key: 'Alt+E', label: 'Scrivi nel Composer' },
								{ key: 'Alt+Q', label: 'Opzioni coda' }
							]}
						/>
					</li>
				{:else}
					{#each tasks as task (task.id)}
						<li
							class="task-row"
							class:dispatching={task.status === 'dispatching'}
							draggable={task.status === 'queued'}
							ondragstart={() => draggedId = task.id}
							ondragend={() => draggedId = null}
							ondragover={(event) => event.preventDefault()}
							ondrop={() => dropOn(task.id)}
						>
							<button
								type="button"
								class="drag-handle"
								aria-label={`Riordina ${taskTitle(task)}. Alt più freccia su o giù.`}
								title="Trascina oppure usa Alt+freccia"
								onkeydown={(event) => handleMoveKey(event, task.id)}
							>
								<svg viewBox="0 0 12 16" aria-hidden="true">
									<circle cx="3" cy="4" r="1" /><circle cx="9" cy="4" r="1" />
									<circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" />
									<circle cx="3" cy="12" r="1" /><circle cx="9" cy="12" r="1" />
								</svg>
							</button>
							<button
								type="button"
								class="task-launch"
								disabled={!canAutomate || (!task.prompt.trim() && (!task.images || task.images.length === 0)) || task.status === 'dispatching'}
								title={canAutomate ? `Avvia: ${taskTitle(task)}` : automationReason}
								aria-label={`Avvia task: ${taskTitle(task)}`}
								onclick={() => onRunTask(task.id)}
							>
								<div class="task-title-row">
									<span class="task-title" class:completed-text={task.status === 'completed' || task.status === 'abandoned'}>{taskTitle(task)}</span>
									<div class="status-and-role">
										{#if task.status === 'in_progress'}
											<span class="task-chip status-chip in-progress">in corso</span>
										{:else if task.status === 'completed'}
											<span class="task-chip status-chip completed">fatto</span>
										{:else if task.status === 'abandoned'}
											<span class="task-chip status-chip abandoned">abbandonato</span>
										{/if}
										{#if task.options?.role}
											{@const badge = roleBadge(task.options.role)}
											{#if badge}
												<span class="task-chip role-chip">{badge}</span>
											{/if}
										{/if}
									</div>
								</div>
								<div class="task-meta-row">
									<span class="task-excerpt" role="status" aria-live={task.status === 'dispatching' ? 'polite' : 'off'}>{task.status === 'dispatching' ? 'Avvio della nuova sessione...' : taskExcerpt(task)}</span>
									<div class="task-chips">
										{#if task.options?.directives && task.options.directives.length > 0}
											{#each task.options.directives.slice(0, 2) as d (d.id)}
												<span class="task-chip mode-chip" title={d.name}>{d.tag || d.name}</span>
											{/each}
											{#if task.options.directives.length > 2}
												<span class="task-chip mode-chip" title={task.options.directives.slice(2).map((d) => d.name).join(', ')}>+{task.options.directives.length - 2}</span>
											{/if}
										{/if}
										{#if task.images && task.images.length > 0}
											<span class="task-chip img-chip">img {task.images.length}</span>
										{/if}
									</div>
								</div>
							</button>
							<button
								type="button"
								class="edit-task"
								onclick={() => onEditTask(task.id)}
								aria-label={`Modifica task: ${taskTitle(task)}`}
								title="Modifica task"
							>
								<svg viewBox="0 0 16 16" aria-hidden="true">
									<path d="m10.8 3.2 2 2-7.2 7.2-2.6.6.6-2.6 7.2-7.2ZM9.5 4.5l2 2" />
								</svg>
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		</div>
	{:else if view === 'sessions'}
		<div id="panel-agent-sessions" role="tabpanel" aria-labelledby="tab-agent-sessions" class="panel-tab-body">
			<SessionList
				{projectPath}
				{canAutomate}
				{automationReason}
				{currentSessionId}
				onResume={onResumeSession}
			/>
		</div>
	{:else}
		<div id="panel-agent-rules" role="tabpanel" aria-labelledby="tab-agent-rules" class="panel-tab-body">
			<RulesPanel {projectPath} {onOpenFile} />
		</div>
	{/if}
</div>

<style>
	.agent-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--bg-base);
	}

	.agent-tabs {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2) var(--space-2);
	}

	.agent-tabs button {
		height: 26px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.agent-tabs button:hover {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.agent-tabs button.active {
		background: var(--bg-active);
		color: var(--ink);
	}

	.count {
		min-width: 17px;
		height: 17px;
		padding: 0 var(--space-1);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	/* Attrito rilevato: ambra, l'unico segnale di attenzione della palette. */
	.count.alert {
		background: color-mix(in srgb, var(--warn) 22%, var(--bg-raised));
		color: var(--warn);
	}

	.action-error {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--danger-dim);
		color: var(--ink);
		font-size: var(--text-sm);
		line-height: 1.4;
	}

	.queue-toolbar {
		padding: 0 var(--space-2) var(--space-2);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.new-task {
		height: 28px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.new-task:hover {
		background: var(--bg-hover);
	}

	.new-task:active {
		background: var(--bg-active);
	}

	.new-task svg,
	.edit-task svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.automation-state {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.panel-tab-body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.queue-list {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--space-2) 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.empty-task-container {
		list-style: none;
		padding: 0;
		width: 100%;
	}


	.task-row {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 30px;
		align-items: stretch;
		min-height: 48px;
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
	}

	.task-row:hover {
		background: var(--bg-hover);
	}

	.task-row.dispatching {
		background: var(--bg-active);
	}

	.drag-handle,
	.edit-task,
	.task-launch {
		border: 0;
		background: transparent;
	}

	.drag-handle,
	.edit-task {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		cursor: grab;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.drag-handle svg {
		width: 10px;
		height: 14px;
		fill: currentColor;
	}

	.edit-task {
		cursor: pointer;
	}

	.drag-handle:hover,
	.edit-task:hover {
		color: var(--ink);
	}

	.task-launch {
		min-width: 0;
		padding: var(--space-1) var(--space-1);
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 0;
		text-align: left;
		cursor: pointer;
	}

	.task-launch:disabled {
		cursor: default;
	}

	.task-title-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1);
	}

	.task-meta-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-1);
	}

	.task-chips {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.status-and-role {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.status-chip.in-progress {
		background: var(--brand-dim);
		color: var(--brand-ink);
		font-weight: 600;
	}

	.status-chip.completed {
		background: var(--bg-sunken);
		color: var(--success, #22c55e);
	}

	.status-chip.abandoned {
		background: var(--bg-sunken);
		color: var(--ink-faint);
		opacity: 0.7;
	}

	.completed-text {
		text-decoration: line-through;
		color: var(--ink-faint);
	}

	.task-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		line-height: 1.2;
	}

	.task-chip.role-chip {
		background: var(--brand-dim);
		color: var(--ink);
		font-weight: 600;
		font-size: var(--text-xs);
	}

	.task-chip.mode-chip {
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
	}

	.task-chip.img-chip {
		background: var(--bg-sunken);
		color: var(--ink-faint);
	}

	.task-title,
	.task-excerpt {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.task-title {
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 500;
		flex: 1;
	}

	.task-excerpt {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		flex: 1;
	}

	.task-launch:disabled .task-title {
		color: var(--ink-muted);
	}
</style>
