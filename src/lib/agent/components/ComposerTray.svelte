<!--
  ComposerTray.svelte (Gate R32 — C13/C14).

  Vassoio sopra il composer: stato vivo del turno (todo, subagenti, coda, domanda ridotta).
  Una sola sezione aperta alla volta (priorita': subagenti > todo > coda); con domanda
  aperta le altre sezioni si compattano. La scelta manuale vale finche' la regola
  automatica non cambia (AutoOpen con sync). Uscita con chiusura in altezza
  (Lingering + classi .tray-in/.tray-out + .tray-fold-inner). Annunci aria-live mantenuti.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { AutoOpen, Lingering } from '../motionState.svelte';
	import type { AgentProgress, TodoItem, TodoPhase } from '../wire';
	import { describeSubagentActivity, formatTrayDuration } from '../subagentActivity';
	import {
		IconCheck,
		IconChevronRight,
		IconChevronUp,
		IconLoop,
		IconQueue,
		IconSubagents
	} from '$lib/icons';

	export interface QuestionMinimized {
		title: string;
		count?: number;
		from?: string;
		onOpen: () => void;
	}

	let {
		phases = [],
		reminder = null,
		subagents = [],
		queueCount = 0,
		queue,
		questionMinimized,
		questionOpen = false,
		onOpenSubagent
	} = $props<{
		phases?: TodoPhase[];
		reminder?: { attempt: number; max: number } | null;
		subagents?: AgentProgress[];
		queueCount?: number;
		queue?: Snippet;
		questionMinimized?: QuestionMinimized;
		questionOpen?: boolean;
		onOpenSubagent?: (id: string) => void;
	}>();

	// --- Statistiche Todo ---
	const allTasks = $derived(phases.flatMap((p: TodoPhase) => p.tasks ?? []));
	const completedCount = $derived(allTasks.filter((t: TodoItem) => t.status === 'completed').length);
	const totalCount = $derived(allTasks.length);
	const blockedList = $derived(allTasks.filter((t: TodoItem) => t.status === 'blocked'));
	const hasBlocked = $derived(blockedList.length > 0);
	const currentTodo = $derived.by(() => {
		const active = allTasks.find((t: TodoItem) => t.status === 'in_progress');
		if (active) return active.content;
		const blocked = allTasks.find((t: TodoItem) => t.status === 'blocked');
		if (blocked) return blocked.content;
		if (totalCount === 0) return m.chat_v2_tray_todo_ready();
		if (completedCount === totalCount && totalCount > 0) return m.chat_v2_tray_todo_all_done();
		return m.chat_v2_tray_todo_ready();
	});
	const ringValue = $derived(totalCount > 0 ? completedCount / totalCount : 0);
	const todoAnnounce = $derived(
		m.task_row_aggregate_announcement({
			completed: completedCount,
			blocked: blockedList.length,
			total: totalCount
		})
	);

	// --- Statistiche Subagenti ---
	const runningCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'running').length);
	const subDoneCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'completed').length);
	const failedCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'failed' || s.status === 'aborted').length);
	const waitingCount = $derived(subagents.filter((s: AgentProgress) => s.status === 'pending').length);
	const subLive = $derived(runningCount > 0 || subagents.some((s: AgentProgress) => s.status === 'pending'));
	const subCalls = $derived(subagents.reduce((n: number, s: AgentProgress) => n + (s.toolCount ?? (s.recentTools?.length ?? 0)), 0));
	const subTotalMs = $derived(subagents.reduce((n: number, s: AgentProgress) => n + (s.durationMs ?? 0), 0));
	const subagentsAnnounce = $derived(
		m.task_row_aggregate_subagents({
			running: runningCount,
			completed: subDoneCount,
			failed: failedCount,
			total: subagents.length
		})
	);

	function fmtDuration(ms: number | undefined): string {
		if (ms === undefined) return '';
		return formatTrayDuration(ms);
	}

	function currentActivity(s: AgentProgress): { tool?: string; args?: string; running: boolean } | null {
		const described = describeSubagentActivity(s);
		if (described.kind !== 'tool' || !described.tool) return null;
		return { tool: described.tool, args: described.args, running: described.running };
	}

	// --- Visibilita' sezioni (alive: gli incompleti restano visibili anche a idle) ---
	const hasTodo = $derived(phases.length > 0 && totalCount > 0);
	const hasSubs = $derived(subagents.length > 0);
	const hasQueue = $derived(queue !== undefined && queueCount > 0);
	const asking = $derived(questionOpen || questionMinimized !== undefined);

	// Priorita' automatica: subagenti > todo > coda
	const autoPriority: 'subagents' | 'todo' | 'queue' | null = $derived(
		hasSubs ? 'subagents' : hasTodo ? 'todo' : hasQueue ? 'queue' : null
	);

	// AutoOpen per sezione: la regola e' "sono la priorita' automatica E non c'e' domanda aperta"
	const subsOpen = new AutoOpen(false);
	const todoOpen = new AutoOpen(false);
	const queueOpen = new AutoOpen(false);

	$effect.pre(() => {
		subsOpen.sync(autoPriority === 'subagents' && !asking);
		todoOpen.sync(autoPriority === 'todo' && !asking);
		queueOpen.sync(autoPriority === 'queue' && !asking);
	});

	// Lingering per uscita con chiusura in altezza
	const todoLinger = new Lingering<TodoPhase[]>();
	const subsLinger = new Lingering<AgentProgress[]>();
	const queueLinger = new Lingering<number>();
	const askLinger = new Lingering<QuestionMinimized>();

	$effect(() => {
		todoLinger.update(hasTodo ? phases : undefined);
	});
	$effect(() => {
		subsLinger.update(hasSubs ? subagents : undefined);
	});
	$effect(() => {
		queueLinger.update(hasQueue ? queueCount : undefined);
	});
	$effect(() => {
		askLinger.update(questionMinimized);
	});
	onDestroy(() => {
		todoLinger.dispose();
		subsLinger.dispose();
		queueLinger.dispose();
		askLinger.dispose();
	});

	const anyShown = $derived(
		todoLinger.shown !== undefined ||
			subsLinger.shown !== undefined ||
			queueLinger.shown !== undefined ||
			askLinger.shown !== undefined
	);
	const allLeaving = $derived(
		anyShown &&
			(todoLinger.shown === undefined || todoLinger.leaving) &&
			(subsLinger.shown === undefined || subsLinger.leaving) &&
			(queueLinger.shown === undefined || queueLinger.leaving) &&
			(askLinger.shown === undefined || askLinger.leaving)
	);
</script>

{#if anyShown}
	<div class={allLeaving ? 'tray-out' : 'tray-in'}>
		<div class="tray-fold-inner">
			<div class="composer-tray" role="region" aria-label={m.chat_v2_tray_aria_label()}>
				<!-- Sezione Todo -->
				{#if todoLinger.shown !== undefined}
					<div class={todoLinger.leaving ? 'tray-out' : 'tray-in'}>
						<div class="tray-fold-inner">
							<section class="tray-section">
								<div class="sr-only" aria-live="polite" aria-atomic="true">{todoAnnounce}</div>
								<button
									type="button"
									class="tray-header"
									aria-expanded={todoOpen.open}
									onclick={() => todoOpen.toggle()}
								>
									<svg viewBox="0 0 18 18" class="ring" aria-hidden="true">
										<circle cx="9" cy="9" r="7" fill="none" class="ring-bg" />
										<circle
											cx="9"
											cy="9"
											r="7"
											fill="none"
											class="ring-fg"
											class:ring-done={ringValue >= 1}
											stroke-dasharray={2 * Math.PI * 7}
											stroke-dashoffset={2 * Math.PI * 7 * (1 - ringValue)}
										/>
									</svg>
									<span class="tray-title">{m.chat_v2_tray_todo_title()}</span>
									<span class="tray-count">{completedCount}/{totalCount}</span>
									{#if !todoOpen.open}
										<span class="tray-current">{currentTodo}</span>
									{/if}
									{#if hasBlocked}
										<span class="tray-badge-blocked" title={blockedList.map((t: TodoItem) => t.content).join('; ')}>
											{blockedList.length}
										</span>
									{/if}
									{#if reminder}
										<span
											class="tray-badge-reminder"
											class:stalled={reminder.attempt >= reminder.max}
											title={`Todo aperti: risvegliato ${reminder.attempt} volte su ${reminder.max}`}
										>
											<span aria-hidden="true"><IconLoop size={11} /></span>
											{reminder.attempt}/{reminder.max}
										</span>
									{/if}
									<span class="tray-chevron" class:open={todoOpen.open} aria-hidden="true">
										<IconChevronUp size={14} />
									</span>
								</button>
								{#if todoOpen.open}
									<div class="tray-body">
										{#each todoLinger.shown as phase, pIdx (phase.id ?? phase.name ?? pIdx)}
											<div class="todo-phase">
												<div class="todo-phase-name">{phase.name}</div>
												{#each phase.tasks ?? [] as task, tIdx (task.id ?? `${pIdx}-${tIdx}`)}
													<div
														class="todo-row"
														class:done={task.status === 'completed'}
														class:active={task.status === 'in_progress'}
														class:blocked={task.status === 'blocked'}
													>
														<span class="todo-mark" aria-hidden="true">
															{#if task.status === 'completed'}
																<span class="mark-done"><IconCheck size={10} /></span>
															{:else if task.status === 'in_progress'}
																<span class="mark-active"></span>
															{:else if task.status === 'blocked'}
																<span class="mark-blocked">!</span>
															{:else}
																<span class="mark-pending"></span>
															{/if}
														</span>
														<span class="todo-text">{task.content}</span>
														{#if task.status === 'blocked' && task.blocker}
															<span class="todo-blocker">{task.blocker}</span>
														{/if}
													</div>
												{/each}
											</div>
										{/each}
									</div>
								{/if}
							</section>
						</div>
					</div>
				{/if}

				<!-- Sezione Subagenti -->
				{#if subsLinger.shown !== undefined}
					<div class={subsLinger.leaving ? 'tray-out' : 'tray-in'}>
						<div class="tray-fold-inner">
							<section class="tray-section">
								<div class="sr-only" aria-live="polite" aria-atomic="true">{subagentsAnnounce}</div>
								<button
									type="button"
									class="tray-header"
									aria-expanded={subsOpen.open}
									onclick={() => subsOpen.toggle()}
								>
									<span class="tray-icon" aria-hidden="true"><IconSubagents size={18} /></span>
									<span class="tray-title">
										{#if subLive}
											<span class="text-shimmer">{m.chat_v2_tray_subagents_running()}</span>
										{:else}
											{m.chat_v2_tray_subagents_completed()}
										{/if}
									</span>
									<span class="tray-count">{subDoneCount}/{subsLinger.shown.length}</span>
									{#if waitingCount > 0}
										<span class="tray-badge-waiting">
											{m.chat_v2_tray_subagents_waiting({ count: waitingCount })}
										</span>
									{/if}
									<span class="tray-meta">{m.chat_v2_tray_subagents_calls({ calls: subCalls })}{#if subTotalMs > 0} · {fmtDuration(subTotalMs)}{/if}</span>
									<span class="tray-chevron" class:open={subsOpen.open} aria-hidden="true">
										<IconChevronUp size={14} />
									</span>
								</button>
								{#if subsOpen.open}
									<div class="tray-body tray-body-agents">
										{#each subsLinger.shown as sub, idx (sub.id ?? sub.index ?? idx)}
											{@const activity = currentActivity(sub)}
											<div class="agent-row" class:finished={sub.status === 'completed'}>
												<span class="agent-mark" aria-hidden="true">
													{#if sub.status === 'completed'}
														<span class="mark-done"><IconCheck size={10} /></span>
													{:else if sub.status === 'running'}
														<span class="mark-active"></span>
													{:else if sub.status === 'failed' || sub.status === 'aborted'}
														<span class="mark-failed">×</span>
													{:else}
														<span class="mark-pending"></span>
													{/if}
												</span>
												{#if sub.id && onOpenSubagent}
													<button
														type="button"
														class="agent-name agent-name-btn"
														title={sub.task ?? sub.assignment ?? sub.description ?? sub.id}
														onclick={() => sub.id && onOpenSubagent?.(sub.id)}
													>
														{sub.id}
													</button>
												{:else}
													<span class="agent-name" title={sub.task ?? sub.assignment ?? sub.description ?? ''}>
														{sub.id ?? sub.agent ?? 'subagent'}
													</span>
												{/if}
												<span class="agent-activity">
													{#if sub.status === 'completed'}
														<span class="agent-result">{sub.lastIntent ?? sub.task ?? ''}</span>
													{:else if activity?.tool}
														<span class="agent-tool" class:running={activity.running}>
															{activity.tool}
														</span>
														{#if activity.args}
															<span class="agent-args">{activity.args}</span>
														{/if}
													{:else if sub.lastIntent}
														<span class="agent-intent">{sub.lastIntent}</span>
													{:else}
														<span class="agent-idle">
															{sub.status === 'pending' ? 'In coda' : 'Avvio…'}
														</span>
													{/if}
												</span>
												{#if sub.durationMs !== undefined || (sub.toolCount ?? 0) > 0}
													<span class="agent-meta">
														{sub.toolCount ?? sub.recentTools?.length ?? 0}
														{#if sub.durationMs !== undefined} · {fmtDuration(sub.durationMs)}{/if}
													</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</section>
						</div>
					</div>
				{/if}

				<!-- Sezione Coda (slot riservato a C22) -->
				{#if queueLinger.shown !== undefined && queue}
					<div class={queueLinger.leaving ? 'tray-out' : 'tray-in'}>
						<div class="tray-fold-inner">
							<section class="tray-section">
								<button
									type="button"
									class="tray-header"
									aria-expanded={queueOpen.open}
									onclick={() => queueOpen.toggle()}
								>
									<span class="tray-icon" aria-hidden="true"><IconQueue size={16} /></span>
									<span class="tray-title">{m.chat_v2_tray_queue_title()}</span>
									<span class="tray-count">{queueLinger.shown}</span>
									<span class="tray-chevron" class:open={queueOpen.open} aria-hidden="true">
										<IconChevronUp size={14} />
									</span>
								</button>
								{#if queueOpen.open}
									<div class="tray-body">
										{@render queue()}
									</div>
								{/if}
							</section>
						</div>
					</div>
				{/if}

				<!-- Riga domanda ridotta -->
				{#if askLinger.shown !== undefined}
					<div class={askLinger.leaving ? 'tray-out' : 'tray-in'}>
						<div class="tray-fold-inner">
							<button
								type="button"
								class="ask-attention-row"
								title={askLinger.shown.title}
								onclick={() => askLinger.shown?.onOpen()}
							>
								<span class="ask-ping" aria-hidden="true"></span>
								<span class="ask-text">
									<strong>{askLinger.shown.from ?? 'L’agente'}</strong>
									{(askLinger.shown.count ?? 1) > 1
										? m.chat_v2_tray_ask_attention_plural()
										: m.chat_v2_tray_ask_attention_singular()}
								</span>
								<span class="ask-reply">
									{m.chat_v2_tray_ask_reply()}
									<IconChevronRight size={14} aria-hidden="true" />
								</span>
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.composer-tray {
		margin: 0 var(--space-3);
		border: 1px solid var(--line);
		border-bottom: 0;
		border-radius: 12px 12px 0 0;
		background: color-mix(in oklch, var(--bg-raised) 85%, transparent);
		backdrop-filter: blur(8px);
		overflow: hidden;
	}
	.tray-section + .tray-section,
	.tray-section {
		border-bottom: 1px solid var(--line);
	}
	.tray-section:last-child {
		border-bottom: 0;
	}
	.tray-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 0;
		cursor: pointer;
		text-align: left;
		color: var(--ink);
		font-family: var(--font-ui);
	}
	.tray-header:hover {
		background: var(--bg-hover);
	}
	.ring {
		width: 18px;
		height: 18px;
		transform: rotate(-90deg);
		flex-shrink: 0;
	}
	.ring-bg {
		stroke: var(--line-strong);
		stroke-width: 2.2;
	}
	.ring-fg {
		stroke: var(--ink);
		stroke-width: 2.2;
		stroke-linecap: round;
		transition:
			stroke-dashoffset 700ms var(--ease-reveal),
			stroke 500ms;
	}
	.ring-fg.ring-done {
		stroke: var(--success);
	}
	.tray-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}
	.tray-count {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.tray-current {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12.5px;
		color: var(--ink-muted);
	}
	.tray-meta {
		margin-left: auto;
		font-size: 11.5px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tray-icon {
		display: grid;
		place-items: center;
		color: var(--ink-muted);
		flex-shrink: 0;
	}
	.tray-chevron {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		transition: transform 200ms;
		flex-shrink: 0;
	}
	.tray-chevron.open {
		transform: rotate(180deg);
	}
	.tray-badge-blocked {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-full);
		background: var(--danger-dim);
		color: var(--danger);
		font-size: 11px;
		font-weight: 700;
	}
	.tray-badge-reminder {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		border-radius: var(--radius-full);
		background: var(--bg-hover);
		color: var(--ink-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.tray-badge-reminder.stalled {
		background: var(--warn-dim);
		color: var(--warn);
	}
	.tray-badge-waiting {
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--warn-dim);
		color: var(--warn);
		font-size: 11px;
		font-weight: 600;
	}
	.tray-body {
		max-height: 12rem;
		overflow-y: auto;
		padding: 0 var(--space-3) var(--space-2);
	}
	.tray-body-agents {
		padding-bottom: var(--space-1);
	}
	.todo-phase {
		padding: var(--space-1) 0;
	}
	.todo-phase + .todo-phase {
		border-top: 1px solid var(--line);
		margin-top: var(--space-1);
		padding-top: var(--space-2);
	}
	.todo-phase-name {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ink-faint);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: var(--space-1);
	}
	.todo-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: 3px 0;
		font-size: 13px;
		line-height: 1.4;
		color: var(--ink-muted);
	}
	.todo-row.active .todo-text {
		font-weight: 600;
		color: var(--ink);
	}
	.todo-row.done .todo-text {
		color: var(--ink-faint);
		text-decoration: line-through;
	}
	.todo-row.blocked .todo-text {
		color: var(--danger);
		font-weight: 500;
	}
	.todo-mark {
		display: grid;
		place-items: center;
		width: 16px;
		height: 20px;
		flex-shrink: 0;
	}
	.mark-done {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--ink);
		color: var(--bg-raised);
	}
	.mark-active {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		animation: tray-spin 1s linear infinite;
	}
	.mark-blocked {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--danger);
		color: white;
		font-size: 11px;
		font-weight: 700;
	}
	.mark-pending {
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		border: 1.5px solid var(--line-strong);
	}
	.mark-failed {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-full);
		background: var(--danger-dim);
		color: var(--danger);
		font-size: 12px;
		font-weight: 700;
	}
	.todo-blocker {
		display: block;
		width: 100%;
		font-size: 12px;
		color: var(--danger);
	}
	.agent-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		padding: 0 var(--space-1);
		border-radius: 6px;
	}
	.agent-row:hover {
		background: var(--bg-hover);
	}
	.agent-row.finished {
		opacity: 0.85;
	}
	.agent-mark {
		display: grid;
		place-items: center;
		width: 16px;
		flex-shrink: 0;
	}
	.agent-name {
		width: 8rem;
		flex-shrink: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
	}
	.agent-name-btn {
		background: transparent;
		border: 0;
		cursor: pointer;
		text-align: left;
		padding: 0;
	}
	.agent-name-btn:hover {
		text-decoration: underline;
	}
	.agent-activity {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 12.5px;
		color: var(--ink-muted);
	}
	.agent-tool,
	.agent-intent,
	.agent-result,
	.agent-args {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.agent-args {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--ink-faint);
	}
	.agent-idle {
		color: var(--ink-faint);
	}
	.agent-meta {
		flex-shrink: 0;
		font-size: 11.5px;
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.ask-attention-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--warn-dim);
		border: 0;
		border-top: 1px solid var(--line);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-ui);
		font-size: 12.5px;
		color: var(--ink);
	}
	.ask-attention-row:hover {
		filter: brightness(0.98);
	}
	.ask-ping {
		position: relative;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		background: var(--warn);
		flex-shrink: 0;
	}
	.ask-ping::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: var(--radius-full);
		background: var(--warn);
		opacity: 0.35;
		animation: tray-ping 1.6s ease-out infinite;
	}
	.ask-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ask-reply {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-weight: 600;
		flex-shrink: 0;
	}
	@keyframes tray-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes tray-ping {
		0% {
			transform: scale(0.6);
			opacity: 0.5;
		}
		80%,
		100% {
			transform: scale(1.2);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mark-active,
		.ask-ping::after {
			animation: none;
		}
		.ring-fg {
			transition: none;
		}
	}
	:root[data-animations='false'] .mark-active,
	:root[data-animations='false'] .ask-ping::after {
		animation: none;
	}
	:root[data-animations='false'] .ring-fg {
		transition: none;
	}
</style>
