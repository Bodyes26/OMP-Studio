<script lang="ts">
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import SessionList from './SessionList.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import EmptyState from './EmptyState.svelte';
	import { taskStore, type AgentView } from '$lib/stores/tasks.svelte';
	import { rulesStore } from '$lib/stores/rules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { isLaneRoutable, type AutomationBlock, type AutomationGate } from '$lib/agent/automationGate';
	import QueueTaskItem from './QueueTaskItem.svelte';

	let {
		projectPath,
		gate,
		actionError,
		currentSessionId,
		onCreateTask,
		onEditTask,
		onRunTask,
		onResumeSession,
		onOpenFile
	}: {
		projectPath: string;
		gate: AutomationGate;
		actionError: string | null;
		currentSessionId: string | null;
		onCreateTask: () => void;
		onEditTask: (taskId: string) => void;
		onRunTask: (taskId: string, shiftKey: boolean) => void;
		onResumeSession: (sessionId: string) => void;
		onOpenFile: (relPath: string) => void;
	} = $props();

	const disableAnimations = $derived(!settingsStore.accessibility.animations);
	const tasks = $derived(taskStore.tasksFor(projectPath).filter((t) => t.status !== 'dispatching'));
	const view = $derived(taskStore.viewFor(projectPath));
	const frictionCount = $derived(rulesStore.suggestionsFor(projectPath).length);
	const isCardView = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');

	/**
	 * Blocco di cui si sta mostrando la spiegazione. Si confronta con quello
	 * corrente invece di tenere un booleano: se il motivo cambia o si scioglie
	 * mentre il riquadro e' aperto, il riquadro non resta a spiegare un blocco
	 * che non esiste piu'.
	 */
	let explained = $state<AutomationBlock | null>(null);
	const gateAttention = $derived(gate.block === 'question' || gate.block === 'quota');
	const noticeOpen = $derived(!isLaneRoutable(gate) && explained === gate.block);

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

	/**
	 * Un agente occupato non blocca piu' la coda: il routing (W09) decide se il
	 * task parte su `Principale` o in una corsia isolata. `Shift` salta anche
	 * la spiegazione: l'utente ha gia' chiesto una corsia nuova.
	 */
	function runOrExplain(taskId: string, shiftKey: boolean) {
		if (!shiftKey && !isLaneRoutable(gate)) {
			explained = gate.block;
			return;
		}
		onRunTask(taskId, shiftKey);
	}

	function dropOn(targetId: string) {
		if (draggedId) taskStore.moveTask(draggedId, targetId);
		draggedId = null;
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
				{#if !gate.ready}
					<button
						type="button"
						class="automation-state"
						class:attention={gateAttention}
						class:active={noticeOpen}
						aria-expanded={noticeOpen}
						aria-controls="agent-queue-gate-notice"
						aria-label={m.gate_state_aria({ label: gate.label })}
						title={`${gate.detail} ${gate.hint}`.trim()}
						onclick={() => explained = noticeOpen ? null : gate.block}
					>
						<span class="state-dot" aria-hidden="true"></span>
						<span class="state-label">{gate.label}</span>
					</button>
				{/if}
			</div>

			{#if noticeOpen}
				<div id="agent-queue-gate-notice" class="automation-notice" class:attention={gateAttention} role="status" aria-live="polite">
					<strong>{m.gate_notice_title()}</strong>
					<span>{gate.detail}</span>
					{#if gate.hint}<span class="automation-hint">{gate.hint}</span>{/if}
					<button type="button" onclick={() => explained = null}>{m.gate_notice_dismiss()}</button>
				</div>
			{:else if gate.note}
				<div class="automation-note" role="status" aria-live="polite">{gate.note}</div>
			{/if}

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
							draggable={task.status === 'queued'}
							transition:slide={{ duration: disableAnimations ? 0 : 180 }}
							animate:flip={{ duration: disableAnimations ? 0 : 180 }}
							ondragstart={() => draggedId = task.id}
							ondragend={() => draggedId = null}
							ondragover={(event) => event.preventDefault()}
							ondrop={() => dropOn(task.id)}
						>
							{#if taskStore.rollbackSeq[task.id]}
								{#key taskStore.rollbackSeq[task.id]}
									<span class="task-flash" aria-hidden="true"></span>
								{/key}
							{/if}
							<QueueTaskItem
								{task}
								blocked={!isLaneRoutable(gate)}
								attention={gateAttention}
								blockedTitle={`${gate.detail} ${gate.hint}`.trim()}
								explainId="agent-queue-gate-notice"
								explainOpen={noticeOpen}
								reorderable
								onLaunch={({ shiftKey }) => runOrExplain(task.id, shiftKey)}
								onEdit={() => onEditTask(task.id)}
								{onOpenFile}
							/>
						</li>
					{/each}
				{/if}
			</ul>
		</div>
	{:else if view === 'sessions'}
		<div id="panel-agent-sessions" role="tabpanel" aria-labelledby="tab-agent-sessions" class="panel-tab-body">
			<SessionList
				{projectPath}
				canAutomate={gate.ready}
				automationReason={gate.label}
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

	/* Due righe: il pannello Agente e' una colonna strettissima e affiancare
	   "Nuovo task" al chip di stato spezzava l'etichetta del pulsante su due
	   righe. Pulsante a piena larghezza, stato sotto, entrambi centrati. */
	.queue-toolbar {
		padding: 0 var(--space-2) var(--space-2);
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-1);
	}

	.new-task {
		width: 100%;
		height: 28px;
		padding: 0 var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}

	.new-task:hover {
		background: var(--bg-hover);
	}

	.new-task:active {
		background: var(--bg-active);
	}

	.new-task svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.automation-state {
		width: 100%;
		min-width: 0;
		min-height: 22px;
		padding: 3px var(--space-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	/* L'ellissi vive sull'etichetta: su un contenitore flex non si applica. */
	.state-label {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.automation-state:hover,
	.automation-state.active {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.automation-state.attention {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		color: var(--warn);
	}

	.automation-state.attention:hover,
	.automation-state.attention.active {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
	}

	.state-dot {
		width: 6px;
		height: 6px;
		flex: 0 0 auto;
		border-radius: var(--radius-full);
		background: currentColor;
	}

	.automation-notice,
	.automation-note {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}


	.automation-notice.attention {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, var(--bg-raised));
	}
	.automation-notice strong {
		color: var(--ink);
	}

	.automation-hint {
		color: var(--ink);
	}

	.automation-notice button {
		margin-top: var(--space-1);
		padding: 2px var(--space-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.automation-note {
		border-color: var(--line);
		background: var(--bg-raised);
		color: var(--ink-faint);
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

	/* La riga visibile e' `QueueTaskItem`: il `<li>` porta solo trascinamento,
	   animazioni di lista e il lampo del rollback. */
	.task-row {
		position: relative;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
	}

	.queue-list.queue-cards .task-row {
		border-radius: var(--radius-md);
	}

	.task-flash {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		background: color-mix(in srgb, var(--brand) 35%, transparent);
		animation: task-flash var(--dur-flash) var(--ease-out) forwards;
		z-index: 1;
	}

	@keyframes task-flash {
		0% { opacity: 0; }
		25% { opacity: 0.85; }
		100% { opacity: 0; }
	}
</style>
