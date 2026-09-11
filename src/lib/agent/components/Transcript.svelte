<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { tick } from 'svelte';
	// Transcript: itera `entries` con chiavi stabili (`e.id`, contatore monotono
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
	import ToolCard from '../tools/ToolCard.svelte';
	import ToolGroup, { type ToolGroupEntry } from '../tools/ToolGroup.svelte';
	import AssistantText from './AssistantText.svelte';
	import CompactionRow from './CompactionRow.svelte';
	import NoticeRow from './NoticeRow.svelte';
	import RetryRow from './RetryRow.svelte';
	import TtsrRow from './TtsrRow.svelte';
	import UserMessage from './UserMessage.svelte';
	import SubagentResultCard from './SubagentResultCard.svelte';
	import IrcMessageCard from './IrcMessageCard.svelte';
	import SystemChip from './SystemChip.svelte';
	import NoticeGroup from './NoticeGroup.svelte';
	import AlertBanner from '$lib/components/AlertBanner.svelte';
	import { modelSettingsStore } from '$lib/stores/modelSettings.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	let { session } = $props<{ session: AgentSession }>();

	let recovering = $state(false);

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
	const showActivity = $derived(
		session.isStreaming && !activeAssistantHasContent && !hasRunningTool && !session.pendingUi
	);

	type DisplayItem =
		| { kind: 'single'; entry: TranscriptEntry }
		| { kind: 'tool-group'; id: number; entries: ToolGroupEntry[] }
		| { kind: 'system-group'; id: number; entries: (SystemChipEntry | NoticeEntry)[] };
	function hasResponseContent(entry: AssistantEntry): boolean {
		return entry.blocks.some(
			(b) => (b.type === 'text' && b.text.trim().length > 0) || b.type === 'image'
		);
	}

	function isIntermediateAssistantEntry(
		entry: AssistantEntry,
		index: number,
		entries: TranscriptEntry[]
	): boolean {
		// Se ha solo thinking o non ha testo/immagini, e' un blocco di ragionamento esecutivo.
		if (!hasResponseContent(entry)) return true;

		// Se ha testo/immagini (es. commento intermedio o CoT in chiaro di muse-spark/contributor),
		// e' un passaggio intermedio verso uno strumento se dopo di esso, nello stesso turno
		// prima del prossimo messaggio utente o compattazione, e' presente almeno una chiamata tool.
		for (let j = index + 1; j < entries.length; j++) {
			const next = entries[j];
			if (next.kind === 'tool') return true;
			if (next.kind === 'user' || next.kind === 'compaction') break;
		}
		return false;
	}

	function isExecutionEntry(
		entry: TranscriptEntry,
		index: number,
		entries: TranscriptEntry[]
	): boolean {
		if (entry.kind === 'tool') return true;
		if (entry.kind === 'assistant') {
			return isIntermediateAssistantEntry(entry, index, entries);
		}
		return false;
	}

	// Raggruppa chiamate tool e blocchi di ragionamento/commenti intermedi consecutivi
	// o alternati in un unico blocco. Se una sequenza di esecuzione contiene tool, viene
	// accorpata in un unico ToolGroup elegante, evitando frammentazioni con modelli
	// che emettono spiegazioni testuali prima di ogni tool (come muse-spark).
	const displayItems = $derived.by<DisplayItem[]>(() => {
		const items: DisplayItem[] = [];
		let currentSegment: ToolGroupEntry[] = [];
		const entries = session.visibleEntries;

		function flushSegment() {
			if (currentSegment.length === 0) return;
			const hasTools = currentSegment.some((e) => e.kind === 'tool');
			if (hasTools && currentSegment.length > 1) {
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

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (isExecutionEntry(entry, i, entries)) {
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

	function shouldShowAssistantFooter(index: number, items: DisplayItem[]): boolean {
		// Se il display item successivo e' anch'esso un messaggio dell'assistente,
		// omette il footer per evitare badge duplicati a cascata.
		const next = items[index + 1];
		if (next && next.kind === 'single' && next.entry.kind === 'assistant') {
			return false;
		}
		return true;
	}
	function entryKind(item: DisplayItem): 'user' | 'system' | 'content' {
		// Classifica l'item per il ritmo verticale: il confine di turno
		// (messaggio utente) merita piu' distacco dal turno precedente; le
		// righe di sistema consecutive (notice/system-chip/system-group/retry/ttsr/compaction)
		// restano ravvicinate perche' sono note a margine; le tessere di contenuto
		// (tool-group, subagent-result, irc) prendono il respiro pieno di --space-3.
		if (item.kind === 'tool-group') return 'content';
		if (item.kind === 'system-group') return 'system';
		const k = item.entry.kind;
		if (k === 'user') return 'user';
		if (k === 'notice' || k === 'system-chip' || k === 'compaction' || k === 'retry' || k === 'ttsr') return 'system';
		if (k === 'subagent-result' || k === 'irc') return 'content';
		return 'content';
	}

	let transcriptEl = $state<HTMLElement | null>(null);
	let disableAnimations = $state(false);

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
		<div class="empty-state">
			<div class="empty-header">
				<h2 class="project-title">{projectName}</h2>
				<p class="project-desc">
					{m.ui_transcript_spazio_di_lavoro_dell_agente_per_esplorare_6625()}
				</p>
			</div>

			<div class="shortcuts-row">
				<span class="shortcut"><kbd>/</kbd> comandi</span>
				<span class="shortcut"><kbd>Invio</kbd> {m.ui_transcript_invia_0fa2()}</span>
			</div>
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
				{:else if item.kind === 'system-group'}
					<NoticeGroup entries={item.entries} />
				{:else if item.entry.kind === 'user'}
					<UserMessage entry={item.entry} />
				{:else if item.entry.kind === 'assistant'}
					<AssistantText
						entry={item.entry}
						streaming={item.entry.id === session.activeAssistantId}
						showFooter={shouldShowAssistantFooter(i, displayItems)}
					/>
				{:else if item.entry.kind === 'tool'}
					<ToolCard entry={item.entry} />
				{:else if item.entry.kind === 'subagent-result'}
					<SubagentResultCard entry={item.entry} />
				{:else if item.entry.kind === 'irc'}
					<IrcMessageCard entry={item.entry} />
				{:else if item.entry.kind === 'system-chip'}
					<SystemChip entry={item.entry} />
				{:else if item.entry.kind === 'notice'}
					<NoticeRow entry={item.entry} />
				{:else if item.entry.kind === 'compaction'}
					<CompactionRow entry={item.entry} />
				{:else if item.entry.kind === 'retry'}
					<RetryRow entry={item.entry} />
				{:else if item.entry.kind === 'ttsr'}
					<TtsrRow entry={item.entry} />
				{/if}
			</div>
		{/each}
	{/if}

	{#if session.blockedQuotaState && !session.blockedQuotaState.dismissed}
		{@const bq = session.blockedQuotaState}
		{@const suggested = bq.suggestedModel}
		<div class="entry-row quota-blocked-row">
			<AlertBanner
				variant={bq.reasonKind === 'quota_exhausted' ? 'error' : 'warning'}
				title={bq.title}
				message={bq.message}
				diagnostic={bq.rawError}
				dismissible={true}
				onDismiss={() => session.dismissBlockedQuota()}
				actions={[
					...(suggested
						? [
								{
									label: `Passa a ${suggested.modelName} e riprendi`,
									onClick: async () => {
										if (recovering) return;
										recovering = true;
										try {
											await session.applyQuotaRecovery(suggested.selector, suggested.thinking);
										} finally {
											recovering = false;
										}
									},
									variant: 'primary' as const,
									loading: recovering
								}
						  ]
						: []),
					{
						label: m.ui_transcript_scegli_altro_modello_610f(),
						onClick: () => modelSettingsStore.openModal('catalog'),
						variant: 'secondary' as const
					}
				]}
			/>
		</div>
	{/if}

	{#if showActivity}
		<div
			class="agent-activity"
			role="status"
			aria-live="polite"
			transition:chatReveal={{ duration: 180, blur: 3, distance: 2 }}
		>
			<span class="activity-dot" aria-hidden="true"></span>
			<span>Sta pensando</span>
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
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	.activity-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
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
		border-radius: 50%;
		animation: spin-fast 600ms linear infinite;
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
		gap: var(--space-4);
		max-width: 480px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-4);
		text-align: center;
	}

	.empty-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.project-title {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--ink);
	}

	.project-desc {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		line-height: 1.4;
	}

	.shortcuts-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding-top: var(--space-1);
	}

	.shortcut {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.shortcut kbd {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-2);
		color: var(--ink-muted);
	}

	.earlier-bar {
		display: flex;
		justify-content: center;
		padding: var(--space-1) 0;
	}

	.earlier-btn {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
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
