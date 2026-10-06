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
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import {
		IconChevronRight,
		IconChevronUp,
		IconClose,
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
	export interface QuotaTrayInfo {
		kind: 'exhausted' | 'limit';
		title: string;
		message?: string;
		diagnostic?: string;
		switchLabel?: string;
		switching: boolean;
		onSwitch?: () => void;
		onChooseModel: () => void;
		onDismiss: () => void;
	}


	let {
		phases = [],
		reminder = null,
		subagents = [],
		queueCount = 0,
		queue,
		questionMinimized,
		questionOpen = false,
		onOpenSubagent,
		quota
	} = $props<{
		phases?: TodoPhase[];
		reminder?: { attempt: number; max: number } | null;
		subagents?: AgentProgress[];
		queueCount?: number;
		queue?: Snippet;
		questionMinimized?: QuestionMinimized;
		questionOpen?: boolean;
		onOpenSubagent?: (id: string) => void;
		quota?: QuotaTrayInfo;
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
	let quotaDetailsOpen = $state(false);
	const hasSections = $derived(hasTodo || hasSubs || hasQueue);
	// Compatto solo a scheda aperta: ridotta, la domanda e' gia' una riga
	// d'attenzione e le sezioni tornano consultabili.
	const compactForAsk = $derived(questionOpen && questionMinimized === undefined && hasSections);
	const compactSummaryText = $derived.by(() => {
		const parts: string[] = [];
		if (hasSubs) {
			const label = subLive ? m.chat_v2_tray_subagents_running() : m.chat_v2_tray_subagents_completed();
			parts.push(`${label} ${subDoneCount}/${subagents.length}`);
		}
		if (hasTodo) {
			parts.push(`${m.chat_v2_tray_todo_title()} ${completedCount}/${totalCount}`);
		}
		if (hasQueue) {
			parts.push(`${m.chat_v2_tray_queue_title()} ${queueCount}`);
		}
		return parts.join(' · ');
	});

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
		quota !== undefined ||
			compactForAsk ||
			todoLinger.shown !== undefined ||
			subsLinger.shown !== undefined ||
			queueLinger.shown !== undefined ||
			askLinger.shown !== undefined
	);
	const allLeaving = $derived(
		anyShown &&
			!quota &&
			!compactForAsk &&
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
				<!-- Riga attenzione quota -->
				{#if quota}
					<div class="tray-in">
						<div class="tray-fold-inner">
							<div class="quota-attention-row" role="region" aria-label={quota.title}>
								<div class="sr-only" aria-live="polite">{quota.title}</div>
								<div class="quota-main-bar">
									<span class="quota-mark" aria-hidden="true">
										<StatusMark
											status={quota.kind === 'exhausted' ? 'failed' : 'attention'}
											active={true}
										/>
									</span>
									<span class="quota-title" title={quota.title}>{quota.title}</span>
									<div class="quota-actions">
										{#if quota.onSwitch && quota.switchLabel}
											<button
												type="button"
												class="ui-button ui-button-primary"
												disabled={quota.switching}
												onclick={quota.onSwitch}
											>
												{quota.switchLabel}
											</button>
										{/if}
										<button
											type="button"
											class="ui-button ui-button-secondary"
											onclick={quota.onChooseModel}
										>
											{m.ui_transcript_scegli_altro_modello_610f()}
										</button>
										{#if quota.message || quota.diagnostic}
											<button
												type="button"
												class="quota-details-toggle ui-button ui-button-secondary"
												aria-expanded={quotaDetailsOpen}
												onclick={() => (quotaDetailsOpen = !quotaDetailsOpen)}
											>
												{m.chat_v2_tray_quota_details()}
												<span class="tray-chevron" class:open={quotaDetailsOpen} aria-hidden="true">
													<IconChevronUp />
												</span>
											</button>
										{/if}
										<button
											type="button"
											class="quota-dismiss-btn"
											aria-label={m.chat_v2_tray_quota_dismiss()}
											onclick={quota.onDismiss}
										>
											<IconClose aria-hidden="true" />
										</button>
									</div>
								</div>
								{#if quotaDetailsOpen && (quota.message || quota.diagnostic)}
									<div class="tray-in">
										<div class="tray-fold-inner">
											<div class="quota-details-body">
												{#if quota.message}
													<p class="quota-details-message">{quota.message}</p>
												{/if}
												{#if quota.diagnostic}
													<pre class="quota-details-diag">{quota.diagnostic}</pre>
												{/if}
											</div>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}

				{#if compactForAsk}
					<!-- Riga traccia compatta quando la scheda domanda e' aperta (non ridotta) -->
					<div class="tray-in">
						<div class="tray-fold-inner">
							<section class="tray-section">
								<div class="compact-trace-row" role="status" aria-label={compactSummaryText}>
									{#if hasTodo}
										<div class="sr-only" aria-live="polite" aria-atomic="true">{todoAnnounce}</div>
									{/if}
									{#if hasSubs}
										<div class="sr-only" aria-live="polite" aria-atomic="true">{subagentsAnnounce}</div>
									{/if}
									{#if hasSubs}
										<span class="compact-part">
											{#if subLive}
												<span class="text-shimmer">{m.chat_v2_tray_subagents_running()}</span>
											{:else}
												<span>{m.chat_v2_tray_subagents_completed()}</span>
											{/if}
											<span class="compact-count">{subDoneCount}/{subagents.length}</span>
										</span>
									{/if}
									{#if hasSubs && hasTodo}
										<span class="compact-sep" aria-hidden="true">·</span>
									{/if}
									{#if hasTodo}
										<span class="compact-part">
											<span>{m.chat_v2_tray_todo_title()}</span>
											<span class="compact-count">{completedCount}/{totalCount}</span>
										</span>
									{/if}
									{#if (hasSubs || hasTodo) && hasQueue}
										<span class="compact-sep" aria-hidden="true">·</span>
									{/if}
									{#if hasQueue}
										<span class="compact-part">
											<span>{m.chat_v2_tray_queue_title()}</span>
											<span class="compact-count">{queueCount}</span>
										</span>
									{/if}
								</div>
							</section>
						</div>
					</div>
				{:else}
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
											title={m.chat_v2_tray_reminder_title({ attempt: reminder.attempt, max: reminder.max })}
										>
											<span class="tray-reminder-icon" aria-hidden="true"><IconLoop /></span>
											{reminder.attempt}/{reminder.max}
										</span>
									{/if}
									<span class="tray-chevron" class:open={todoOpen.open} aria-hidden="true">
										<IconChevronUp />
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
															<StatusMark
																status={task.status === 'abandoned' ? 'failed' : task.status}
																active={!todoLinger.leaving && !allLeaving}
															/>
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
									<span class="tray-icon" aria-hidden="true"><IconSubagents /></span>
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
										<IconChevronUp />
									</span>
								</button>
								{#if subsOpen.open}
									<div class="tray-body tray-body-agents">
										{#each subsLinger.shown as sub, idx (sub.id ?? sub.index ?? idx)}
											{@const activity = currentActivity(sub)}
											<div class="agent-row" class:finished={sub.status === 'completed'}>
												<span class="agent-mark" aria-hidden="true">
													<StatusMark
														status={sub.status ?? 'pending'}
														active={!subsLinger.leaving && !allLeaving}
													/>
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
															{sub.status === 'pending' ? m.chat_v2_tray_subagent_queued() : m.chat_v2_tray_subagent_starting()}
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
									<span class="tray-icon tray-icon-queue" aria-hidden="true"><IconQueue /></span>
									<span class="tray-title">{m.chat_v2_tray_queue_title()}</span>
									<span class="tray-count">{queueLinger.shown}</span>
									<span class="tray-chevron" class:open={queueOpen.open} aria-hidden="true">
										<IconChevronUp />
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
								<StatusMark status="attention" active={!askLinger.leaving && !allLeaving} />
								<span class="ask-text">
									<strong>{askLinger.shown.from ?? m.chat_v2_tray_ask_from_agent()}</strong>
									{(askLinger.shown.count ?? 1) > 1
										? m.chat_v2_tray_ask_attention_plural()
										: m.chat_v2_tray_ask_attention_singular()}
								</span>
								<span class="ask-reply">
									{m.chat_v2_tray_ask_reply()}
									<IconChevronRight aria-hidden="true" />
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
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		background: color-mix(in oklch, var(--bg-raised) 85%, transparent);
		backdrop-filter: blur(8px);
		overflow: hidden;
	}
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
		/* Completato resta --ink: l'anello chiuso basta, il verde e' solo per gli esiti (D1). */
		transition: stroke-dashoffset 700ms var(--ease-reveal);
	}
	.tray-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--ink);
	}
	.tray-count {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.tray-current {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-trace);
		color: var(--ink-muted);
	}
	.tray-meta {
		margin-left: auto;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tray-icon {
		display: grid;
		place-items: center;
		color: var(--ink-muted);
		flex-shrink: 0;
		--icon-size: 18px;
	}
	.tray-icon-queue {
		--icon-size: 16px;
	}
	.tray-reminder-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 11px;
	}
	.tray-chevron {
		display: grid;
		place-items: center;
		color: var(--ink-faint);
		--icon-size: 14px;
		transition: transform var(--dur-fast) var(--ease-out);
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
		font-size: var(--text-caption);
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
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
	}
	.tray-badge-reminder.stalled {
		background: var(--warn-dim);
		color: var(--warn);
	}
	.tray-badge-waiting {
		padding: 1px 6px;
		border-radius: var(--radius-md);
		background: var(--warn-dim);
		color: var(--warn);
		font-size: var(--text-caption);
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
		font-size: var(--text-meta);
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
		font-size: var(--text-body);
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
	/* I segni di stato sono gestiti dal componente StatusMark */
	.todo-blocker {
		display: block;
		width: 100%;
		font-size: var(--text-mono);
		color: var(--danger);
	}
	.agent-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2rem;
		padding: 0 var(--space-1);
		border-radius: var(--radius-md);
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
		font-size: var(--text-mono);
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
		font-size: var(--text-trace);
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
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}
	.agent-idle {
		color: var(--ink-faint);
	}
	.agent-meta {
		flex-shrink: 0;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}
	.quota-attention-row {
		border-bottom: 1px solid var(--line);
		padding: var(--space-2) var(--space-3);
		background: transparent;
		color: var(--ink);
		font-family: var(--font-ui);
	}
	/* Su colonne strette le azioni vanno a capo invece di schiacciare il
	   titolo: il blocco quota deve restare leggibile per intero. */
	.quota-main-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.quota-mark {
		display: grid;
		place-items: center;
		width: 16px;
		flex-shrink: 0;
	}
	.quota-title {
		flex: 1 1 14rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-trace);
		color: var(--ink);
		font-weight: 500;
	}
	.quota-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		margin-left: auto;
	}
	.quota-details-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.quota-dismiss-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--ink-faint);
		cursor: pointer;
		padding: 4px;
		--icon-size: 14px;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.quota-dismiss-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}
	.quota-details-body {
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.quota-details-message {
		margin: 0;
		font-size: var(--text-trace);
		color: var(--ink-muted);
		line-height: 1.45;
	}
	.quota-details-diag {
		margin: 0;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-base);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 8rem;
		overflow-y: auto;
	}
	.compact-trace-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-trace);
		color: var(--ink-muted);
		user-select: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.compact-part {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.compact-count {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
	}
	.compact-sep {
		color: var(--ink-faint);
		user-select: none;
	}
	.ask-attention-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: color-mix(in oklch, var(--warn) 15%, transparent);
		border: 0;
		border-top: 1px solid var(--line);
		cursor: pointer;
		text-align: left;
		font-family: var(--font-ui);
		font-size: var(--text-trace);
		color: var(--ink);
	}
	.ask-attention-row:hover {
		background: color-mix(in oklch, var(--warn) 22%, transparent);
	}
	/* ask-ping sostituito da StatusMark */
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
		--icon-size: 14px;
	}
	@media (prefers-reduced-motion: reduce) {
		.ring-fg {
			transition: none;
		}
	}
	:root[data-animations='false'] .ring-fg {
		transition: none;
	}
</style>
