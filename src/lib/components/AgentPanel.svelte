<script lang="ts">
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import SessionList from './SessionList.svelte';
	import RulesPanel from './RulesPanel.svelte';
	import ProjectDocsPanel from './ProjectDocsPanel.svelte';
	import EmptyState from './EmptyState.svelte';
	import { taskStore, type AgentView } from '$lib/stores/tasks.svelte';
	import { rulesStore } from '$lib/stores/rules.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { isLaneRoutable, type AutomationBlock, type AutomationGate } from '$lib/agent/automationGate';
	import QueueTaskItem from './QueueTaskItem.svelte';
	import MissedScheduleBanner from './schedule/MissedScheduleBanner.svelte';
	import { chatReveal, revealEase } from '$lib/agent/motion';
	import { motionReduced, Lingering } from '$lib/agent/motionState.svelte';
	import { IconPlus } from '$lib/icons';
	import Segmented, { type SegmentedOption } from '$lib/ui/Segmented.svelte';
	import StatusMark from '$lib/ui/StatusMark.svelte';

	let {
		projectPath,
		gate,
		actionError,
		currentSessionId,
		onCreateTask,
		onEditTask,
		onRunTask,
		onResumeSession,
		onOpenFile,
		agentBusy = false,
		onInitJournal
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
		/** L'agente principale del progetto sta lavorando (la scheda Progetto rilegge a fine lavoro). */
		agentBusy?: boolean;
		/** Avvia `/diario init` come task del progetto. */
		onInitJournal: (storage: 'repo' | 'local') => void;
	} = $props();

	const tasks = $derived(taskStore.tasksFor(projectPath).filter((t) => t.status !== 'dispatching'));
	const view = $derived(taskStore.viewFor(projectPath));
	const frictionCount = $derived(rulesStore.suggestionsFor(projectPath).length);
	const isCardView = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');

	const tabOptions = $derived<SegmentedOption<AgentView>[]>([
		{
			value: 'queue',
			label: m.agent_panel_tab_queue(),
			count: tasks.length
		},
		{
			value: 'sessions',
			label: m.agent_panel_tab_sessions()
		},
		{
			value: 'rules',
			label: m.agent_panel_tab_rules(),
			count: frictionCount,
			countTone: 'attention'
		},
		{
			value: 'project',
			label: m.agent_panel_tab_project()
		}
	]);
	/**
	 * Blocco di cui si sta mostrando la spiegazione. Si confronta con quello
	 * corrente invece di tenere un booleano: se il motivo cambia o si scioglie
	 * mentre il riquadro e' aperto, il riquadro non resta a spiegare un blocco
	 * che non esiste piu'.
	 */
	let explained = $state<AutomationBlock | null>(null);
	const gateAttention = $derived(gate.block === 'question' || gate.block === 'quota');
	const noticeOpen = $derived(!isLaneRoutable(gate) && explained === gate.block);

	type GateNoticeContent =
		| { kind: 'notice'; detail: string; hint?: string; attention: boolean }
		| { kind: 'note'; note: string };

	const noticeLinger = new Lingering<GateNoticeContent>();

	$effect(() => {
		const current: GateNoticeContent | undefined = noticeOpen
			? { kind: 'notice', detail: gate.detail, hint: gate.hint, attention: gateAttention }
			: gate.note
				? { kind: 'note', note: gate.note }
				: undefined;
		noticeLinger.update(current);
	});

	$effect(() => () => noticeLinger.dispose());
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
	<div class="agent-tabs">
		<Segmented
			mode="tablist"
			fill
			tabIdPrefix="tab-agent-"
			panelIdPrefix="panel-agent-"
			value={view}
			options={tabOptions}
			ariaLabel={m.page_tabs_agent_panel_label()}
			onChange={setView}
		/>
	</div>

	{#if actionError}
		<div class="action-error" role="alert" aria-live="assertive">{actionError}</div>
	{/if}

	{#if view === 'queue'}
		<div id="panel-agent-queue" role="tabpanel" aria-labelledby="tab-agent-queue" class="panel-tab-body">
			<div class="queue-toolbar">
				<button type="button" class="new-task" onclick={onCreateTask} aria-label={m.ui_agentpanel_crea_nuovo_task_eca5()}>
					<IconPlus />
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
						onclick={() => explained = noticeOpen ? null : gate.block}
					>
						<StatusMark status={gateAttention ? 'attention' : 'pending'} active={gateAttention} />
						<span class="state-label">{gate.label}</span>
					</button>
				{/if}
			</div>

			<div role="status" aria-live="polite">
				{#if noticeLinger.shown !== undefined}
					<div class={noticeLinger.leaving ? 'tray-out' : 'tray-in'}>
						<div class="tray-fold-inner">
							{#if noticeLinger.shown.kind === 'notice'}
								<div id="agent-queue-gate-notice" class="automation-notice" class:attention={noticeLinger.shown.attention}>
									<strong>{m.gate_notice_title()}</strong>
									<span>{noticeLinger.shown.detail}</span>
									{#if noticeLinger.shown.hint}<span class="automation-hint">{noticeLinger.shown.hint}</span>{/if}
									<button
										type="button"
										class="ui-button ui-button-secondary"
										onclick={() => explained = null}
									>
										{m.gate_notice_dismiss()}
									</button>
								</div>
							{:else if noticeLinger.shown.kind === 'note'}
								<div class="automation-note">{noticeLinger.shown.note}</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<!-- Reset passato a Studio chiuso: i task programmati aspettano una scelta. -->
			<MissedScheduleBanner {tasks} />

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
						/>
					</li>
				{:else}
					{#each tasks as task (task.id)}
						<li
							class="task-row"
							draggable={task.status === 'queued'}
							transition:chatReveal
							animate:flip={{ duration: motionReduced() ? 0 : 210, easing: revealEase }}
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
	{:else if view === 'rules'}
		<div id="panel-agent-rules" role="tabpanel" aria-labelledby="tab-agent-rules" class="panel-tab-body">
			<RulesPanel {projectPath} {onOpenFile} />
		</div>
	{:else}
		<div id="panel-agent-project" role="tabpanel" aria-labelledby="tab-agent-project" class="panel-tab-body">
			<ProjectDocsPanel {projectPath} {agentBusy} {onOpenFile} {onInitJournal} />
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
		padding: var(--space-1) var(--space-2) var(--space-2);
	}

	.action-error {
		margin: 0 var(--space-2) var(--space-2);
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--danger-dim);
		color: var(--ink);
		font-size: var(--text-label);
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
		font-size: var(--text-label);
		font-weight: 500;
		--icon-size: 14px;
		white-space: nowrap;
		cursor: pointer;
	}

	.new-task:hover {
		background: var(--bg-hover);
	}

	.new-task:active {
		background: var(--bg-active);
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
		border-radius: var(--radius-md);
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
		opacity: 0;
		animation: task-flash var(--dur-flash) var(--ease-reveal) both;
		z-index: 1;
	}

	@keyframes task-flash {
		from {
			opacity: 0.85;
		}
	}
</style>
