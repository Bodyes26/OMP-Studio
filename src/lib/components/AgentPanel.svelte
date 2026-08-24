<script lang="ts">
	import SessionList from './SessionList.svelte';
	import { taskStore, type AgentView, type StudioTask } from '$lib/stores/tasks.svelte';

	let {
		projectPath,
		canAutomate,
		automationReason,
		actionError,
		currentSessionId,
		onCreateTask,
		onEditTask,
		onRunTask,
		onResumeSession
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
	} = $props();

	const tasks = $derived(taskStore.tasksFor(projectPath));
	const view = $derived(taskStore.viewFor(projectPath));
	let draggedId = $state<string | null>(null);

	function setView(next: AgentView) {
		taskStore.setView(projectPath, next);
	}

	function taskTitle(task: StudioTask) {
		return task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Nuovo task';
	}

	function taskExcerpt(task: StudioTask) {
		const compact = task.prompt.replace(/\s+/g, ' ').trim();
		return compact || 'Prompt ancora vuoto';
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
</script>

<div class="agent-panel">
	<div class="agent-tabs" role="tablist" aria-label="Pannello agente">
		<button
			type="button"
			role="tab"
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
			aria-selected={view === 'sessions'}
			class:active={view === 'sessions'}
			onclick={() => setView('sessions')}
		>
			Sessioni
		</button>
	</div>

	{#if actionError}
		<div class="action-error" role="alert">{actionError}</div>
	{/if}

	{#if view === 'queue'}
		<div class="queue-toolbar">
			<button type="button" class="new-task" onclick={onCreateTask}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
				Nuovo task
			</button>
			{#if !canAutomate && automationReason}
				<span class="automation-state" title={automationReason}>{automationReason}</span>
			{/if}
		</div>

		<div class="queue-list" role="list" aria-label="Task in coda">
			{#if tasks.length === 0}
				<div class="empty-state">
					<strong>Nessun task in coda</strong>
					<span>Scrivi il prossimo prompt da eseguire per questo progetto.</span>
				</div>
			{:else}
				{#each tasks as task (task.id)}
					<div
						class="task-row"
						role="listitem"
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
							onkeydown={(event) => handleMoveKey(event, task.id)}
							aria-label={`Riordina ${taskTitle(task)}. Alt più freccia su o giù.`}
							title="Trascina oppure usa Alt+freccia"
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
							disabled={!canAutomate || !task.prompt.trim() || task.status === 'dispatching'}
							title={canAutomate ? `Avvia: ${taskTitle(task)}` : automationReason}
							onclick={() => onRunTask(task.id)}
						>
							<span class="task-title">{taskTitle(task)}</span>
							<span class="task-excerpt">{task.status === 'dispatching' ? 'Avvio della nuova sessione...' : taskExcerpt(task)}</span>
						</button>
						<button
							type="button"
							class="edit-task"
							onclick={() => onEditTask(task.id)}
							aria-label={`Modifica ${taskTitle(task)}`}
							title="Modifica task"
						>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="m10.8 3.2 2 2-7.2 7.2-2.6.6.6-2.6 7.2-7.2ZM9.5 4.5l2 2" />
							</svg>
						</button>
					</div>
				{/each}
			{/if}
		</div>
	{:else}
		<SessionList
			{projectPath}
			{canAutomate}
			{automationReason}
			{currentSessionId}
			onResume={onResumeSession}
		/>
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

	.action-error {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--brand-dim);
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

	.queue-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: var(--space-2);
	}

	.empty-state {
		padding: var(--space-4) var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.empty-state strong {
		color: var(--ink-muted);
		font-size: var(--text-base);
		font-weight: 500;
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

	.task-title,
	.task-excerpt {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.task-title {
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 500;
	}

	.task-excerpt {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.task-launch:disabled .task-title {
		color: var(--ink-muted);
	}
</style>
