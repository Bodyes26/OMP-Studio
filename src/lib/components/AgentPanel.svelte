<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SessionList from './SessionList.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import EmptyState from './EmptyState.svelte';
	import { taskStore, type AgentView, type StudioTask } from '$lib/stores/tasks.svelte';
	import { rulesStore } from '$lib/stores/rules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

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
	const isCardView = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');

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
		return task.prompt.split(/\r?\n/).find((line) => line.trim())?.trim() || m.agent_panel_new_task_btn();
	}

	function taskExcerpt(task: StudioTask) {
		const compact = task.prompt.replace(/\s+/g, ' ').trim();
		if (compact) return compact;
		if (task.images && task.images.length > 0) {
			return `${task.images.length} ${task.images.length === 1 ? 'immagine allegata' : 'immagini allegate'}`;
		}
		return m.agent_panel_empty_prompt();
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
	<div class="agent-tabs" role="tablist" aria-label={m.page_tabs_agent_panel_label()}>
		<button
			type="button"
			role="tab"
			id="tab-agent-queue"
			aria-controls="panel-agent-queue"
			aria-selected={view === 'queue'}
			class:active={view === 'queue'}
			onclick={() => setView('queue')}
		>
			{m.agent_panel_tab_queue()}
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
			{m.agent_panel_tab_sessions()}
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
			{m.agent_panel_tab_rules()}
			{#if frictionCount > 0}<span class="count alert">{frictionCount}</span>{/if}
		</button>
	</div>

	{#if actionError}
		<div class="action-error" role="alert" aria-live="assertive">{actionError}</div>
	{/if}

	{#if view === 'queue'}
		<div id="panel-agent-queue" role="tabpanel" aria-labelledby="tab-agent-queue" class="panel-tab-body">
			<div class="queue-toolbar">
				<button type="button" class="new-task" onclick={onCreateTask} aria-label={m.ui_agentpanel_crea_nuovo_task_eca5()}>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
					{m.agent_panel_new_task_btn()}
				</button>
				{#if !canAutomate && automationReason}
					<span class="automation-state" role="status" aria-live="polite" title={automationReason}>{automationReason}</span>
				{/if}
			</div>

			<ul class="queue-list" class:queue-cards={isCardView} aria-label={m.queue_drawer_heading()}>
				{#if tasks.length === 0}
					<li class="empty-task-container">
						<EmptyState
							variant="no-tasks"
							compact={true}
							primaryAction={{
								label: m.agent_panel_new_task_btn(),
								onClick: onCreateTask
							}}
							shortcuts={[
								{ key: 'Alt+E', label: 'Scrivi nel Composer' }
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
								aria-label={m.agent_panel_reorder_handle_aria({ title: taskTitle(task) })}
								title={m.agent_panel_reorder_handle_title()}
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
								title={canAutomate ? m.ui_agentpanel_avvia_value1_18da({ value1: taskTitle(task) }) : automationReason}
								aria-label={m.ui_queuedrawer_avvia_task_value1_0055({ value1: taskTitle(task) })}
								onclick={() => onRunTask(task.id)}
							>
								<span class="task-title" class:completed-text={task.status === 'completed' || task.status === 'abandoned'}>{taskTitle(task)}</span>
								<span class="task-excerpt" role="status" aria-live={task.status === 'dispatching' ? 'polite' : 'off'}>{task.status === 'dispatching' ? m.agent_panel_dispatching_label() : taskExcerpt(task)}</span>
								<div class="task-chips">
									{#if task.status === 'in_progress'}
										<span class="task-chip status-chip in-progress">{m.queue_drawer_status_in_progress()}</span>
									{:else if task.status === 'completed'}
										<span class="task-chip status-chip completed">{m.queue_drawer_status_completed()}</span>
									{:else if task.status === 'abandoned'}
										<span class="task-chip status-chip abandoned">{m.queue_drawer_status_abandoned()}</span>
									{/if}
									{#if task.options?.role}
										{@const badge = roleBadge(task.options.role)}
										{#if badge}
											<span class="task-chip role-chip">{badge}</span>
										{/if}
									{/if}
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
							</button>
							<button
								type="button"
								class="edit-task"
								onclick={() => onEditTask(task.id)}
								aria-label={m.agent_panel_edit_task_aria({ title: taskTitle(task) })}
								title={m.queue_drawer_edit_btn_title()}
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

	.queue-list.queue-cards {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1) var(--space-2);
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
		min-height: 72px;
		padding: var(--space-1);
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
		padding: var(--space-1);
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: var(--space-1);
		text-align: left;
		cursor: pointer;
	}

	.task-launch:disabled {
		cursor: default;
	}

	.task-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-1);
	}

	.task-chips:empty {
		display: none;
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

	.task-title {
		display: block;
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		color: var(--ink);
		font-size: var(--text-base);
		font-weight: 600;
	}

	.task-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		width: 100%;
		min-width: 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.queue-list.queue-cards .task-row {
		min-height: 88px;
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-base);
	}

	.queue-list.queue-cards .task-row:hover {
		background: var(--bg-hover);
		border-color: var(--line-strong);
	}

	.queue-list.queue-cards .task-row.dispatching {
		border-color: var(--brand-dim);
	}

	.queue-list.queue-cards .task-title {
		white-space: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.queue-list.queue-cards .task-excerpt {
		-webkit-line-clamp: 3;
		line-clamp: 3;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.task-row,
		.task-launch,
		.task-chips {
			transition: none;
		}
	}

	.task-launch:disabled .task-title {
		color: var(--ink-muted);
	}
</style>
