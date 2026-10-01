<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	import { perfMark } from '$lib/perf';
	// assegnato all'inserimento, mai l'indice). Delega il rendering per `kind`.
	//
	// Rendering a finestre: se ci sono piu' di 300 entry mostra le ultime 300
	// e un bottone «Carica precedenti» in cima che ne scopre altre 300 preservando la viewport.
	import { projectStore } from '../../stores/projects.svelte';
	import type {
		AgentSession,
		AssistantEntry,
		Block,
		NoticeEntry,
		SystemChipEntry,
		ToolEntry,
		TranscriptEntry
	} from '../session.svelte';
	import { chatReveal } from '../motion';
	import ToolGroup, { type ToolGroupEntry } from '../tools/ToolGroup.svelte';
	import { groupsInExecution } from '../tools/registry';
	import { categoryForTool } from '../tools/categories';
	import { TodoTraceTracker, type TodoTraceItem } from '../todoTrace';
	import AssistantText from './AssistantText.svelte';
	import TurnFooter, { type TurnFooterData } from './TurnFooter.svelte';
	import CompactionRow from './CompactionRow.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import RetryRow from './RetryRow.svelte';
	import TtsrRow from './TtsrRow.svelte';
	import UserMessage from './UserMessage.svelte';
	import SubagentResultCard from './SubagentResultCard.svelte';
	import TodoTraceRow from './TodoTraceRow.svelte';
	import SubagentTrace from './SubagentTrace.svelte';
	import AskTrace from './AskTrace.svelte';
	import IrcMessageCard from './IrcMessageCard.svelte';
	import LaneLandingCard from './LaneLandingCard.svelte';
	import SystemChip from './SystemChip.svelte';
	import NoticeGroup from './NoticeGroup.svelte';
	import ActivityIndicator from './ActivityIndicator.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	let { session } = $props<{ session: AgentSession }>();


	const projectName = $derived(
		projectStore.activeProject?.name ?? session.sessionName ?? 'Progetto'
	);
	const activeAssistant = $derived(
		session.visibleEntries.find(
			(entry: TranscriptEntry) => entry.kind === 'assistant' && entry.id === session.activeAssistantId
		)
	);
	const activeAssistantHasContent = $derived(
		activeAssistant?.kind === 'assistant'
			&& activeAssistant.blocks.some((block: Block) => block.type !== 'text' || block.text.length > 0)
	);
	const hasRunningTool = $derived(
		session.visibleEntries.some((entry: TranscriptEntry) => entry.kind === 'tool' && entry.running)
	);
	// Timer adattivo di 400ms: se l'avvio della sessione omp richiede tempo (spawn/handshake),
	// mostra l'indicatore di attivita' con il testo di avvio senza fliccherii nei casi rapidi.
	let showStartupIndicator = $state(false);
	$effect(() => {
		if (session.startupPhase === 'starting') {
			const timer = setTimeout(() => {
				showStartupIndicator = true;
			}, 400);
			return () => {
				clearTimeout(timer);
				showStartupIndicator = false;
			};
		} else {
			showStartupIndicator = false;
		}
	});

	// Indicatore di attesa in-turn: compare nelle pause oltre 450ms durante lo streaming
	// quando nessun testo sta arrivando e nessun tool e' in esecuzione (Gate R32 - C06).
	let showInTurnIdle = $state(false);
	$effect(() => {
		const isIdle = session.isStreaming
			&& session.startupPhase !== 'starting'
			&& !activeAssistantHasContent
			&& !hasRunningTool
			&& !session.pendingUi;

		if (isIdle) {
			const timer = setTimeout(() => {
				showInTurnIdle = true;
			}, 450);
			return () => {
				clearTimeout(timer);
				showInTurnIdle = false;
			};
		} else {
			showInTurnIdle = false;
		}
	});

	type DisplayItem =
		| { kind: 'single'; entry: TranscriptEntry }
		| { kind: 'tool-group'; id: number; entries: ToolGroupEntry[] }
		| { kind: 'system-group'; id: number; entries: (SystemChipEntry | NoticeEntry)[] }
		| { kind: 'todo-trace'; id: string; entry: ToolEntry; trace: TodoTraceItem; countTool: boolean }
		| { kind: 'subagent-trace'; id: number; entry: ToolEntry }
		| { kind: 'ask-trace'; id: number; entry: ToolEntry };
	function hasResponseContent(entry: AssistantEntry): boolean {
		return entry.blocks.some(
			(b) => (b.type === 'text' && b.text.trim().length > 0) || b.type === 'image'
		);
	}

	function isExecutionEntry(entry: TranscriptEntry): boolean {
		if (entry.kind === 'tool') {
			return groupsInExecution(entry.toolName);
		}
		if (entry.kind === 'assistant') {
			// Se l'assistente non ha emesso testo per l'utente ne immagini,
			// si tratta di un passaggio di ragionamento interno (thinking) o
			// dell'invocazione di uno strumento operativo: appartiene al flusso di esecuzione.
			// I commenti testuali e le spiegazioni restano invece nella timeline principale.
			return !hasResponseContent(entry);
		}
		return false;
	}

	// Raggruppa chiamate tool operativi e relativi passaggi di ragionamento interno
	// (thinking / turni intermedi senza testo) in un blocco compatto. Messaggi narrativi
	// dell'assistente e interazioni utente (come `ask`) restano nella timeline principale.
	const displayItems = $derived.by<DisplayItem[]>(() => {
		const items: DisplayItem[] = [];
		let currentSegment: ToolGroupEntry[] = [];
		const tracker = new TodoTraceTracker();
		const todoTraces = new Map<number, TodoTraceItem[]>();
		for (const entry of session.entries) {
			if (entry.kind === 'tool' && entry.toolName === 'todo') {
				todoTraces.set(entry.id, tracker.process({ args: entry.args, result: entry.result }));
			}
		}
		const entries = session.visibleEntries;

		function flushSegment() {
			if (currentSegment.length === 0) return;
			const hasTools = currentSegment.some((e) => e.kind === 'tool');
			if (hasTools) {
				items.push({
					kind: 'tool-group',
					id: currentSegment[0].id,
					entries: [...currentSegment]
				});
			} else {
				for (const entry of currentSegment) {
					items.push({ kind: 'single', entry });
				}
			}
			currentSegment = [];
		}

		for (const entry of entries) {
			if (entry.kind === 'tool' && entry.toolName === 'todo') {
				flushSegment();
				const traces = todoTraces.get(entry.id) ?? [];
				if (traces.length === 0 && entry.result?.isError) items.push({ kind: 'single', entry });
				for (const [index, trace] of traces.entries()) {
					items.push({ kind: 'todo-trace', id: `${entry.id}-${trace.id}`, entry, trace, countTool: index === 0 });
				}
				continue;
			}
			if (entry.kind === 'tool' && entry.toolName === 'task') {
				flushSegment();
				items.push({ kind: 'subagent-trace', id: entry.id, entry });
				continue;
			}
			// Una domanda all'utente e' contenuto primario, non un passo di esecuzione:
			// nascosta dentro un gruppo tool non si vedrebbe a cosa si e' risposto.
			if (entry.kind === 'tool' && categoryForTool(entry.toolName) === 'ask') {
				flushSegment();
				items.push({ kind: 'ask-trace', id: entry.id, entry });
				continue;
			}
			if (isExecutionEntry(entry)) {
				currentSegment.push(entry as ToolGroupEntry);
			} else {
				flushSegment();
				items.push({ kind: 'single', entry });
			}
		}

		flushSegment();

		// Secondo passaggio:
		// 1. Scarta le entry `system-chip` con `internal === true` quando l'impostazione
		//    diagnostica `showInternalAgentMessages` e' disattivata.
		// 2. Accorpa le righe di sistema consecutive in un `system-group` quando sono
		//    3 o piu'. Con 1 o 2 restano `single`. Contano come riga di sistema solo
		//    `system-chip` e `notice`. Tessere come `subagent-result` e `irc` non
		//    entrano nel gruppo: sono contenuto primario e interrompono la sequenza.
		const showInternal = Boolean(settingsStore.general?.showInternalAgentMessages);
		const filteredItems: DisplayItem[] = [];
		for (const item of items) {
			if (
				item.kind === 'single' &&
				item.entry.kind === 'system-chip' &&
				item.entry.internal &&
				!showInternal
			) {
				continue;
			}
			filteredItems.push(item);
		}

		const finalItems: DisplayItem[] = [];
		let systemSegment: (SystemChipEntry | NoticeEntry)[] = [];

		function flushSystemSegment() {
			if (systemSegment.length === 0) return;
			if (systemSegment.length >= 3) {
				finalItems.push({
					kind: 'system-group',
					id: systemSegment[0].id,
					entries: [...systemSegment]
				});
			} else {
				for (const entry of systemSegment) {
					finalItems.push({ kind: 'single', entry });
				}
			}
			systemSegment = [];
		}

		for (const item of filteredItems) {
			if (
				item.kind === 'single' &&
				(item.entry.kind === 'system-chip' || item.entry.kind === 'notice')
			) {
				systemSegment.push(item.entry as SystemChipEntry | NoticeEntry);
			} else {
				flushSystemSegment();
				finalItems.push(item);
			}
		}

		flushSystemSegment();
		return finalItems;
	});

	// Piè del turno dell'agente: calcola i metadati di ogni turno concluso (Gate R32 - C07).
	const turnFootersByIndex = $derived.by<Map<number, TurnFooterData>>(() => {
		const map = new Map<number, TurnFooterData>();
		if (displayItems.length === 0) return map;

		let currentTurnStartIndex = -1;
		let currentTurnAssistantTexts: string[] = [];
		let currentTurnToolCalls = 0;
		let currentTurnCost = 0;
		let currentTurnModel: string | undefined;
		let currentTurnStartMs = 0;
		let currentTurnEndMs = 0;

		function recordEntries(entries: TranscriptEntry[]) {
			for (const entry of entries) {
				if (entry.kind === 'assistant') {
					for (const block of entry.blocks) {
						if (block.type === 'text' && block.text.trim()) {
							currentTurnAssistantTexts.push(block.text.trim());
						}
					}
					if (entry.usage?.cost?.total) {
						currentTurnCost += entry.usage.cost.total;
					}
					if (entry.model) {
						currentTurnModel = entry.model;
					}
				} else if (entry.kind === 'tool') {
					currentTurnToolCalls += 1;
					if (entry.startedAt && (!currentTurnStartMs || entry.startedAt < currentTurnStartMs)) {
						currentTurnStartMs = entry.startedAt;
					}
					if (entry.endedAt && entry.endedAt > currentTurnEndMs) {
						currentTurnEndMs = entry.endedAt;
					}
				}
			}
		}

		for (let i = 0; i < displayItems.length; i++) {
			const item = displayItems[i];
			const isUser = item.kind === 'single' && item.entry.kind === 'user';

			if (isUser) {
				if (currentTurnStartIndex >= 0 && (currentTurnAssistantTexts.length > 0 || currentTurnToolCalls > 0)) {
					const duration = currentTurnEndMs > currentTurnStartMs ? currentTurnEndMs - currentTurnStartMs : 0;
					map.set(i - 1, {
						assistantText: currentTurnAssistantTexts.join('\n\n'),
						toolCallsCount: currentTurnToolCalls,
						durationMs: duration,
						model: currentTurnModel,
						cost: currentTurnCost > 0 ? currentTurnCost : undefined
					});
				}
				currentTurnStartIndex = i;
				currentTurnAssistantTexts = [];
				currentTurnToolCalls = 0;
				currentTurnCost = 0;
				currentTurnModel = undefined;
				currentTurnStartMs = 0;
				currentTurnEndMs = 0;
			} else {
				if (currentTurnStartIndex === -1) {
					currentTurnStartIndex = i;
				}
				if (item.kind === 'single') {
					recordEntries([item.entry]);
				} else if (item.kind === 'tool-group' || item.kind === 'system-group') {
					recordEntries(item.entries as unknown as TranscriptEntry[]);
				} else if ((item.kind === 'todo-trace' && item.countTool) || item.kind === 'subagent-trace' || item.kind === 'ask-trace') {
					recordEntries([item.entry]);
				}
			}
		}

		if (
			currentTurnStartIndex >= 0
			&& !session.isStreaming
			&& !hasRunningTool
			&& (currentTurnAssistantTexts.length > 0 || currentTurnToolCalls > 0)
		) {
			const duration = currentTurnEndMs > currentTurnStartMs ? currentTurnEndMs - currentTurnStartMs : 0;
			map.set(displayItems.length - 1, {
				assistantText: currentTurnAssistantTexts.join('\n\n'),
				toolCallsCount: currentTurnToolCalls,
				durationMs: duration,
				model: currentTurnModel,
				cost: currentTurnCost > 0 ? currentTurnCost : undefined
			});
		}

		return map;
	});
	function entryKind(item: DisplayItem): 'user' | 'system' | 'content' {
		// Classifica l'item per il ritmo verticale: il confine di turno
		// (messaggio utente) merita piu' distacco dal turno precedente; le
		// righe di sistema consecutive (notice/system-chip/system-group/retry/ttsr/compaction)
		// restano ravvicinate perche' sono note a margine; le tessere di contenuto
		// (tool-group, subagent-result, irc) prendono il respiro pieno di --space-3.
		if (item.kind === 'tool-group') return 'content';
		if (item.kind === 'system-group') return 'system';
		if (item.kind === 'todo-trace' || item.kind === 'subagent-trace' || item.kind === 'ask-trace') return 'content';
		const k = item.entry.kind;
		if (k === 'user') return 'user';
		if (k === 'notice' || k === 'system-chip' || k === 'compaction' || k === 'retry' || k === 'ttsr') return 'system';
		if (k === 'subagent-result' || k === 'irc') return 'content';
		return 'content';
	}

	let transcriptEl = $state<HTMLElement | null>(null);
	let disableAnimations = $state(false);

	let lastRenderedSessionId = $state<string | null>(null);
	let prevEntriesCount = $state(0);

	/**
	 * Disabilita le animazioni di ingresso (chatReveal) durante i caricamenti massivi:
	 * cambio sessione iniziale, ripresa da storico (resume) o ricostruzione transcript.
	 * Mantiene le animazioni fluide per i singoli messaggi nuovi che arrivano in tempo reale.
	 * Registra un perf mark quando il rendering massivo e' terminato nel DOM.
	 */
	$effect(() => {
		const currentSessionId = session.sessionId ?? null;
		const currentCount = session.entries.length;
		const isRebuilding = session.isRebuildingTranscript;
		const isAttaching = session.isAttaching;
		const isResuming = session.isResuming;

		const isNewSession = currentSessionId !== lastRenderedSessionId;
		const countDelta = currentCount - prevEntriesCount;
		const isBulk = isNewSession || isRebuilding || isAttaching || isResuming || countDelta > 2;

		if (isBulk && currentCount > 0) {
			disableAnimations = true;
			void tick().then(() => {
				perfMark('session', `transcript rendered ${currentCount} entries`);
				requestAnimationFrame(() => {
					disableAnimations = false;
				});
			});
		}

		lastRenderedSessionId = currentSessionId;
		prevEntriesCount = currentCount;
	});
	async function handleShowEarlier() {
		if (!transcriptEl) {
			session.showEarlier();
			return;
		}

		const scrollContainer = (transcriptEl.closest('.scroll-area') || transcriptEl.parentElement || document.scrollingElement) as HTMLElement | null;
		const firstRow = transcriptEl.querySelector('.entry-row') as HTMLElement | null;
		const topOffsetBefore = firstRow ? firstRow.getBoundingClientRect().top : null;
		const prevScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
		const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

		disableAnimations = true;
		session.showEarlier();
		await tick();

		if (firstRow && scrollContainer && topOffsetBefore !== null) {
			const topOffsetAfter = firstRow.getBoundingClientRect().top;
			const diff = topOffsetAfter - topOffsetBefore;
			if (Math.abs(diff) > 0) {
				scrollContainer.scrollTop = prevScrollTop + diff;
			}
		} else if (scrollContainer && prevScrollHeight > 0) {
			const delta = scrollContainer.scrollHeight - prevScrollHeight;
			if (delta > 0) {
				scrollContainer.scrollTop = prevScrollTop + delta;
			}
		}

		requestAnimationFrame(() => {
			disableAnimations = false;
		});
	}
</script>

<div
	bind:this={transcriptEl}
	class="transcript"
	class:is-empty={session.visibleEntries.length === 0}
	aria-busy={session.isStreaming}
>
	{#if session.hasEarlier}
		<div class="earlier-bar">
			<button type="button" class="earlier-btn" onclick={handleShowEarlier}>
				Carica precedenti ({session.entries.length - session.visibleCount} nascoste)
			</button>
		</div>
	{/if}

	{#if session.isLoading && session.visibleEntries.length === 0}
		<div class="resume-loading-state" aria-live="polite" aria-busy="true">
			<div class="resume-header">
				<div class="resume-spinner" aria-hidden="true"></div>
				<span class="resume-title">{m.ui_transcript_caricamento_sessione_in_corso_d8f1()}</span>
			</div>
			<div class="skeleton-stream">
				<div class="skeleton-card skeleton-user">
					<div class="skeleton-line w-40"></div>
					<div class="skeleton-line w-75"></div>
				</div>
				<div class="skeleton-card skeleton-assistant">
					<div class="skeleton-line w-90"></div>
					<div class="skeleton-line w-60"></div>
					<div class="skeleton-line w-80"></div>
				</div>
				<div class="skeleton-card skeleton-tool">
					<div class="skeleton-line w-50"></div>
				</div>
				<div class="skeleton-card skeleton-assistant">
					<div class="skeleton-line w-85"></div>
					<div class="skeleton-line w-70"></div>
				</div>
			</div>
		</div>
	{:else if session.visibleEntries.length === 0}
		<div class="empty-state rv-blur" style="--dur: 400ms;">
			<p class="empty-state-text">{m.chat_v2_empty_state()}</p>
		</div>
	{:else}
		{#each displayItems as item, i (item.kind === 'single' ? item.entry.id : `${item.kind}-${item.id}`)}
			{@const kind = entryKind(item)}
			{@const prevKind = i > 0 ? entryKind(displayItems[i - 1]) : null}
			<div
				class="entry-row"
				class:turn-boundary={kind === 'user' && i > 0}
				class:after-user={prevKind === 'user'}
				class:system-tight={kind === 'system' && prevKind === 'system'}
				transition:chatReveal={{ duration: disableAnimations ? 0 : 210 }}
			>
				{#if item.kind === 'tool-group'}
					<ToolGroup entries={item.entries} activeAssistantId={session.activeAssistantId} />
				{:else if item.kind === 'todo-trace'}
					<TodoTraceRow trace={item.trace} />
				{:else if item.kind === 'subagent-trace'}
					<SubagentTrace entry={item.entry} subagents={session.subagents} />
				{:else if item.kind === 'ask-trace'}
					<AskTrace entry={item.entry} />
				{:else if item.kind === 'system-group'}
					<NoticeGroup entries={item.entries} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'user'}
					<UserMessage entry={item.entry} />
				{:else if item.entry.kind === 'assistant'}
					<AssistantText
						entry={item.entry}
						streaming={item.entry.id === session.activeAssistantId}
					/>
				{:else if item.entry.kind === 'tool'}
					<ToolGroup entries={[item.entry]} activeAssistantId={session.activeAssistantId} />
				{:else if item.entry.kind === 'subagent-result'}
					<SubagentResultCard entry={item.entry} />
				{:else if item.entry.kind === 'irc'}
					<IrcMessageCard entry={item.entry} />
				{:else if item.entry.kind === 'system-chip'}
					<SystemChip entry={item.entry} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'notice'}
					<NoticeRow entry={item.entry} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'compaction'}
					<CompactionRow entry={item.entry} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'retry'}
					<RetryRow entry={item.entry} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'ttsr'}
					<TtsrRow entry={item.entry} fresh={!disableAnimations} />
				{:else if item.entry.kind === 'lane-landing'}
					<LaneLandingCard entry={item.entry} />
				{/if}
			</div>
			{#if turnFootersByIndex.get(i)}
				<TurnFooter data={turnFootersByIndex.get(i)!} />
			{/if}
		{/each}
	{/if}


	{#if showStartupIndicator}
		<div
			class="agent-activity"
			transition:chatReveal={{ duration: 180, blur: 3, distance: 2 }}
		>
			<ActivityIndicator
				startedAt={session.seededPrompt?.createdAt}
				label={m.chat_session_starting_label()}
			/>
		</div>
	{:else if showInTurnIdle}
		<div class="agent-activity in-turn-idle rv-blur" role="status" aria-live="polite">
			<span class="text-shimmer">{m.chat_v2_thinking_streaming()}</span>
		</div>
	{/if}
</div>

<style>
	.transcript {
		display: flex;
		flex-direction: column;
		padding: var(--space-3);
		min-width: 0;
	}

	/* Ritmo verticale: niente gap uniforme. Ogni entry porta il proprio
	   margin-top, cosi' il confine di turno (utente) puo' distanziarsi di
	   piu' delle righe di sistema consecutive fra loro. */
	.entry-row {
		margin-top: var(--space-3);
		min-width: 0;
	}

	.entry-row:first-child {
		margin-top: 0;
	}

	.entry-row.turn-boundary {
		margin-top: var(--space-6);
	}

	.entry-row.after-user {
		margin-top: var(--space-4);
	}

	.entry-row.system-tight {
		margin-top: var(--space-1);
	}

	.agent-activity {
		margin-top: var(--space-3);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: fit-content;
		padding: var(--space-1) var(--space-2);
	}

	.agent-activity.in-turn-idle {
		font-size: 13.5px;
		color: var(--ink-muted);
		user-select: none;
	}


	.transcript.is-empty {
		flex: 1;
		justify-content: center;
	}
	.resume-loading-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 640px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-4) var(--space-2);
		animation: slide-fade-in var(--dur-slow) var(--ease-out) both;
	}

	.resume-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	.resume-spinner {
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--brand);
		border-radius: var(--radius-full);
		animation: spin 600ms linear infinite;
		flex: 0 0 auto;
	}

	.skeleton-stream {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
	}

	.skeleton-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		animation: shimmer-pulse 1.8s ease-in-out infinite;
	}

	.skeleton-card.skeleton-user {
		align-self: flex-end;
		width: 65%;
		background: color-mix(in srgb, var(--brand-dim) 25%, var(--bg-raised));
		border-color: color-mix(in srgb, var(--brand-dim) 50%, var(--line));
	}

	.skeleton-card.skeleton-assistant {
		align-self: flex-start;
		width: 85%;
	}

	.skeleton-card.skeleton-tool {
		align-self: flex-start;
		width: 50%;
		background: var(--bg-sunken);
		border-style: dashed;
	}

	.skeleton-line {
		height: 10px;
		border-radius: var(--radius-sm);
		background: var(--line-strong);
	}

	.w-40 { width: 40%; }
	.w-50 { width: 50%; }
	.w-60 { width: 60%; }
	.w-70 { width: 70%; }
	.w-75 { width: 75%; }
	.w-80 { width: 80%; }
	.w-85 { width: 85%; }
	.w-90 { width: 90%; }


	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		max-width: 520px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-6) var(--space-4);
		text-align: center;
	}

	.empty-state-text {
		font-size: var(--text-chat);
		line-height: 24px;
		color: var(--ink-muted);
		margin: 0;
	}

	.earlier-bar {
		display: flex;
		justify-content: center;
		padding: var(--space-1) 0;
	}

	.earlier-btn {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.earlier-btn:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

</style>
