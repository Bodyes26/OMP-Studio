<!--
  ToolGroup.svelte v2 (Gate R32 - C10, C11).
  Raggruppa una sequenza di chiamate tool e passaggi di ragionamento (thinking).

  Dal vivo:
  - Intestazione 'Al lavoro · N chiamate · X,Y s' con shimmer sul testo.
  - Finestra scorrevole sulle ultime 5 righe avviate con riga '⋯ N chiamate precedenti' e maschera sfumata in alto.
  - Tratto verticale di 2px in --line-strong che raggruppa le chiamate parallele.
  - Riga compatta con icona 16px (spinner se running, icona categoria, x danger se fallita),
    etichetta con shimmer se running, dettaglio monospazio troncato, meta e +a −d a destra.

  A fine gruppo:
  - Riga riepilogo '✓ N chiamate · X,Y s' + conteggi per categoria + totali +a −d + errori, espandibile (max-height ~18rem).
  - Clic su qualsiasi riga (dal vivo o nel riepilogo) espande inline il corpo del renderer esistente.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { AssistantEntry, ToolEntry } from '../session.svelte';
	import { IconCheck, IconChevronRight, IconClose } from '$lib/icons';
	import { rendererFor } from './registry';
	import { stopwatchNow, subscribeStopwatch } from './stopwatch.svelte';
	import {
		categorizeTool,
		summarizeThinking,
		formatDurationSecs,
		type ToolCategory,
		type ToolSummary
	} from './categories';
	import CategoryIcon from './parts/CategoryIcon.svelte';

	export type ToolGroupEntry = ToolEntry | AssistantEntry;

	let {
		entries,
		activeAssistantId = null
	}: {
		entries: ToolGroupEntry[];
		activeAssistantId?: number | null;
	} = $props();

	// Identificazione degli elementi
	const toolEntries = $derived(entries.filter((e): e is ToolEntry => e.kind === 'tool'));
	const assistantEntries = $derived(entries.filter((e): e is AssistantEntry => e.kind === 'assistant'));

	// Stato di attività
	const isToolRunning = $derived(toolEntries.some((e) => e.running));
	const isStreamingThinking = $derived(
		activeAssistantId != null && assistantEntries.some((e) => e.id === activeAssistantId)
	);
	const isLive = $derived(isToolRunning || isStreamingThinking);

	// Cronometro condiviso: attivo mentre c'è attività in corso
	$effect(() => {
		if (!isLive) return;
		return subscribeStopwatch();
	});

	// Calcolo della durata complessiva
	const durationLabel = $derived.by(() => {
		if (entries.length === 0) return '0,1 s';
		const startTimes = toolEntries.map((e) => e.startedAt).filter((t) => typeof t === 'number' && t > 0);
		if (startTimes.length === 0) return '0,1 s';
		const start = Math.min(...startTimes);
		if (isLive) {
			const now = stopwatchNow();
			return formatDurationSecs(Math.max(0, now - start));
		}
		const endTimes = toolEntries
			.map((e) => e.endedAt ?? e.startedAt)
			.filter((t): t is number => typeof t === 'number' && t > 0);
		const end = endTimes.length > 0 ? Math.max(...endTimes) : start;
		return formatDurationSecs(Math.max(0, end - start));
	});

	// Estrazione testo dai blocchi thinking di un AssistantEntry
	function getThinkingText(entry: AssistantEntry): string {
		return entry.blocks
			.filter((b) => b.type === 'thinking')
			.map((b) => (b as { type: 'thinking'; text: string }).text)
			.join('\n\n');
	}

	interface RowItem {
		id: string | number;
		kind: 'tool' | 'think';
		entry: ToolGroupEntry;
		summary: ToolSummary;
		running: boolean;
		fail: boolean;
		par: boolean;
	}

	// Verifica se due chiamate consecutive appartengono allo stesso batch parallelo
	function isParallelWithPrevious(curr: ToolGroupEntry, prev: ToolGroupEntry): boolean {
		if (curr.kind !== 'tool' || prev.kind !== 'tool') return false;
		const currTool = curr as ToolEntry;
		const prevTool = prev as ToolEntry;

		// 1. Flag esplicito da argomenti o proprietà (es. mock/bench/scenari)
		const currArgs = currTool.args as Record<string, unknown> | undefined;
		if (currArgs?._par === true || (currTool as unknown as { par?: boolean }).par === true) {
			return true;
		}

		// 2. Stesso batchId esplicito
		const currBatch = (currTool as unknown as { batchId?: unknown }).batchId;
		const prevBatch = (prevTool as unknown as { batchId?: unknown }).batchId;
		if (currBatch !== undefined && currBatch !== null && currBatch === prevBatch) {
			return true;
		}

		// 3. Stesso timestamp di inizio non-zero (comune in turni con chiamate parallele dal medesimo messaggio)
		if (currTool.startedAt > 0 && currTool.startedAt === prevTool.startedAt) {
			return true;
		}

		// 4. Avvio strettamente concomitante durante streaming (< 200ms)
		if (currTool.startedAt > 0 && prevTool.startedAt > 0) {
			if (Math.abs(currTool.startedAt - prevTool.startedAt) < 200) {
				return true;
			}
			// Concorrenza viva: avviato prima della conclusione del precedente e ravvicinato (< 500ms)
			if (
				currTool.startedAt >= prevTool.startedAt &&
				currTool.startedAt <= (prevTool.endedAt ?? Infinity) &&
				currTool.startedAt - prevTool.startedAt < 500
			) {
				return true;
			}
		}
		return false;
	}

	// Costruzione dell'elenco normalizzato delle righe
	const rowItems = $derived.by<RowItem[]>(() => {
		const out: RowItem[] = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const prev = i > 0 ? entries[i - 1] : null;
			const par = prev ? isParallelWithPrevious(entry, prev) : false;

			if (entry.kind === 'tool') {
				const summary = categorizeTool({
					toolName: entry.toolName,
					args: entry.args,
					result: entry.result,
					running: entry.running
				});
				out.push({
					id: entry.id,
					kind: 'tool',
					entry,
					summary,
					running: entry.running,
					fail: summary.fail ?? false,
					par
				});
			} else if (entry.kind === 'assistant') {
				const thinkingText = getThinkingText(entry);
				const summary = summarizeThinking(thinkingText);
				const running = activeAssistantId != null && entry.id === activeAssistantId;
				out.push({
					id: entry.id,
					kind: 'think',
					entry,
					summary,
					running,
					fail: false,
					par: false
				});
			}
		}
		return out;
	});

	// Raggruppa gli indici/elementi in batch paralleli
	function makeBatches(items: RowItem[]): RowItem[][] {
		const batches: RowItem[][] = [];
		for (const item of items) {
			const cur = batches[batches.length - 1];
			if (cur && item.par) {
				cur.push(item);
			} else {
				batches.push([item]);
			}
		}
		return batches;
	}

	// Tutti gli elementi per la visualizzazione espansa a fine gruppo
	const fullBatches = $derived(makeBatches(rowItems));

	// Conteggi aggregati per il riepilogo finale
	const categoryOrder: ToolCategory[] = ['read', 'search', 'web', 'run', 'edit', 'think', 'other'];
	const summaryStats = $derived.by(() => {
		const counts: Partial<Record<ToolCategory, number>> = {};
		let totalAdd = 0;
		let totalDel = 0;
		let failedCount = 0;

		for (const item of rowItems) {
			counts[item.summary.category] = (counts[item.summary.category] ?? 0) + 1;
			if (item.summary.diff) {
				totalAdd += item.summary.diff[0];
				totalDel += item.summary.diff[1];
			}
			if (item.fail) {
				failedCount++;
			}
		}

		return { counts, totalAdd, totalDel, failedCount };
	});

	// Testi localizzati per conteggio chiamate
	const totalCallsCount = $derived(rowItems.length);
	const callsCountText = $derived(
		totalCallsCount === 1
			? m.chat_v2_tools_calls_one()
			: m.chat_v2_tools_calls_many({ count: totalCallsCount })
	);

	function categoryTooltip(cat: ToolCategory, count: number): string {
		switch (cat) {
			case 'read':
				return count === 1 ? m.chat_v2_tools_cat_read_one() : m.chat_v2_tools_cat_read_many();
			case 'search':
				return count === 1 ? m.chat_v2_tools_cat_search_one() : m.chat_v2_tools_cat_search_many();
			case 'run':
				return count === 1 ? m.chat_v2_tools_cat_run_one() : m.chat_v2_tools_cat_run_many();
			case 'edit':
				return count === 1 ? m.chat_v2_tools_cat_edit_one() : m.chat_v2_tools_cat_edit_many();
			case 'web':
				return count === 1 ? m.chat_v2_tools_cat_web_one() : m.chat_v2_tools_cat_web_many();
			case 'think':
				return count === 1 ? m.chat_v2_tools_cat_think_one() : m.chat_v2_tools_cat_think_many();
			default:
				return count === 1 ? m.chat_v2_tools_cat_other_one() : m.chat_v2_tools_cat_other_many();
		}
	}

	// Stato di apertura dell'elenco delle chiamate: aperto di default per specifica v2
	// (il blocco viene comunque smontato dal DOM se l'utente lo comprime manualmente).
	let isFullListOpen = $state(true);

	// Riferimento al contenitore scorrevole interno
	let scrollContainerEl = $state<HTMLDivElement | null>(null);

	// Flag di ancoraggio al fondo: attivo se l'utente si trova entro la soglia di tolleranza (~24px)
	let pinnedToBottom = $state(true);
	const SCROLL_THRESHOLD = 24;

	function handleListScroll() {
		if (!scrollContainerEl) return;
		const distance = scrollContainerEl.scrollHeight - scrollContainerEl.scrollTop - scrollContainerEl.clientHeight;
		// Se l'utente e' entro 24px dal fondo consideriamo attivo l'ancoraggio automatico
		pinnedToBottom = distance <= SCROLL_THRESHOLD;
	}

	function scrollToBottomIfPinned() {
		if (!scrollContainerEl || !pinnedToBottom) return;
		scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight;
	}

	function toggleOpen() {
		isFullListOpen = !isFullListOpen;
		if (isFullListOpen) {
			// Alla riapertura manuale riaggancia al fondo per mostrare le chiamate piu recenti
			pinnedToBottom = true;
		}
	}

	// Insieme delle righe espanse per mostrare il corpo inline (C11)
	let expandedRows = $state<Set<string | number>>(new Set());

	function toggleRow(id: string | number) {
		const next = new Set(expandedRows);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedRows = next;
	}

	// Segue le chiamate aggiunte (e lo scambio spinner -> icona a fine chiamata)
	// solo se il gruppo e' in esecuzione attiva (live) e l'utente e' in fondo all'elenco.
	$effect(() => {
		if (!scrollContainerEl || !isFullListOpen || !isLive) return;

		const observer = new MutationObserver(() => {
			scrollToBottomIfPinned();
		});

		observer.observe(scrollContainerEl, { childList: true });

		// Scroll iniziale al montaggio o all'apertura
		scrollToBottomIfPinned();

		return () => {
			observer.disconnect();
		};
	});
</script>

{#snippet renderRow(item: RowItem)}
	{@const isExpanded = expandedRows.has(item.id)}
	<div class="row-container" class:compact={!isExpanded && !item.running}>
		<button
			type="button"
			class="tool-row"
			aria-expanded={isExpanded}
			onclick={() => toggleRow(item.id)}
		>
			<span class="row-icon-slot">
				{#if item.running}
					<span class="spinner" aria-label={m.chat_v2_tools_running_aria()}></span>
				{:else if item.fail}
					<span class="fail-icon"><IconClose /></span>
				{:else}
					<CategoryIcon category={item.summary.category} class="cat-icon" />
				{/if}
			</span>

			<span class="row-label" class:text-shimmer={item.running}>{item.summary.label}</span>

			{#if item.summary.detail}
				<span class="row-detail" title={item.summary.detail}>{item.summary.detail}</span>
			{/if}

			{#if !item.running && (item.summary.meta || item.summary.diff)}
				<span class="row-tail">
					{#if item.summary.meta}
						<span class="row-meta" class:meta-fail={item.fail}>{item.summary.meta}</span>
					{/if}
					{#if item.summary.diff}
						<span class="row-diff">
							<span class="diff-add">+{item.summary.diff[0]}</span>
							<span class="diff-del">−{item.summary.diff[1]}</span>
						</span>
					{/if}
				</span>
			{/if}
		</button>

		{#if isExpanded}
			<div class="inline-body">
				{#if item.entry.kind === 'tool'}
					{@const renderer = rendererFor(item.entry.toolName)}
					<renderer.component
						name={item.entry.toolName}
						args={item.entry.args}
						result={item.entry.result}
						running={item.entry.running}
					/>
				{:else if item.entry.kind === 'assistant'}
					<div class="thinking-body">
						<pre class="thinking-text">{getThinkingText(item.entry)}</pre>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet renderBatches(batches: RowItem[][])}
	{#each batches as batch (batch[0].id)}
		{#if batch.length > 1}
			<div class="parallel-batch" title={m.chat_v2_tools_parallel_title()}>
				{#each batch as item (item.id)}
					{@render renderRow(item)}
				{/each}
			</div>
		{:else}
			{@render renderRow(batch[0])}
		{/if}
	{/each}
{/snippet}

<div class="tool-group" class:live={isLive}>
	<button
		type="button"
		class="summary-btn"
		class:live={isLive}
		aria-expanded={isFullListOpen}
		onclick={toggleOpen}
		title={isFullListOpen
			? m.chat_v2_tools_collapse()
			: m.chat_v2_tools_expand()}
	>
		{#if isLive}
			<span class="summary-lead">
				<span class="live-status text-shimmer">{m.chat_v2_tools_working()}</span>
				<span class="summary-text tabular-nums">{callsCountText} · {durationLabel}</span>
			</span>
		{:else}
			<span class="summary-lead">
				<span class="check-icon"><IconCheck /></span>
				<span class="summary-text tabular-nums">{callsCountText} · {durationLabel}</span>
			</span>

			<span class="summary-counts">
				{#each categoryOrder as cat}
					{#if summaryStats.counts[cat]}
						<span class="cat-pill" title="{summaryStats.counts[cat]} {categoryTooltip(cat, summaryStats.counts[cat]!)}">
							<CategoryIcon category={cat} />
							<span class="tabular-nums">{summaryStats.counts[cat]}</span>
						</span>
					{/if}
				{/each}

				{#if summaryStats.totalAdd > 0 || summaryStats.totalDel > 0}
					<span class="summary-diff font-mono">
						<span class="diff-add">+{summaryStats.totalAdd}</span>
						<span class="diff-del">−{summaryStats.totalDel}</span>
					</span>
				{/if}

				{#if summaryStats.failedCount > 0}
					<span class="summary-failed">
						{m.chat_v2_tools_failed_count({ count: summaryStats.failedCount })}
					</span>
				{/if}
			</span>
		{/if}

		<span class="summary-chevron" class:expanded={isFullListOpen}>
			<IconChevronRight />
		</span>
	</button>

	{#if isFullListOpen}
		<div
			class="full-list-container"
			bind:this={scrollContainerEl}
			onscroll={handleListScroll}
			onwheel={(e) => {
				// Blocca la propagazione della rotellina per non disancorare l'autoscroll
				// della chat esterna quando il puntatore si muove sopra l'elenco interno.
				e.stopPropagation();
			}}
		>
			{@render renderBatches(fullBatches)}
		</div>
	{/if}
</div>

<style>
	.tool-group {
		display: flex;
		flex-direction: column;
		margin: var(--space-3) 0;
		font-family: var(--font-ui);
		min-width: 0;
	}

	.live-status {
		font-weight: 500;
		color: var(--ink-muted);
	}

	/* ---------------------------------------------------- Batches paralleli */

	.parallel-batch {
		border-left: 2px solid var(--line-strong);
		margin-left: -13px;
		padding-left: 11px;
	}

	/* ------------------------------------------------------ Riga del tool */

	.row-container {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* Le righe collassate e non in esecuzione hanno altezza fissa esatta (26px).
	   content-visibility con contain-intrinsic-block-size previene layout e pittura
	   inutile fuori schermo per liste da 200+ chiamate senza alcuno scatto di scroll. */
	.row-container.compact {
		content-visibility: auto;
		contain-intrinsic-block-size: 26px;
	}

	.tool-row {
		display: flex;
		width: 100%;
		height: 26px;
		min-width: 0;
		align-items: center;
		gap: 10px;
		background: transparent;
		border: none;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: inherit;
		cursor: pointer;
		text-align: left;
		user-select: none;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.tool-row:hover {
		background: var(--bg-hover);
	}

	.tool-row:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.row-icon-slot {
		display: grid;
		width: 16px;
		height: 16px;
		place-items: center;
		flex-shrink: 0;
		color: var(--ink-faint);
	}

	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 9999px;
		border: 1.5px solid var(--line-strong);
		border-top-color: var(--ink);
		animation: spin 0.8s linear infinite;
	}


	.fail-icon {
		display: inline-flex;
		align-items: center;
		color: var(--danger);
		--icon-size: 14px;
	}

	.row-label {
		flex-shrink: 0;
		color: var(--ink-muted);
		font-weight: 400;
	}

	.row-detail {
		min-width: 0;
		flex-shrink: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-faint);
	}

	.row-tail {
		margin-left: auto;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		padding-left: var(--space-2);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.row-meta {
		color: var(--ink-faint);
	}

	.row-meta.meta-fail {
		color: var(--danger);
	}

	.row-diff {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.diff-add {
		color: var(--success);
	}

	.diff-del {
		color: var(--danger);
	}

	/* ------------------------------------------------ Corpo inline (C11) */

	.inline-body {
		margin: var(--space-1) 0 var(--space-2) 26px;
		padding: var(--space-2) var(--space-3);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		user-select: text;
		min-width: 0;
		overflow-x: auto;
	}

	.thinking-body {
		font-family: var(--font-ui);
		color: var(--ink-muted);
		line-height: 1.5;
	}

	.thinking-text {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--ink-muted);
	}

	/* ----------------------------------------------- Riepilogo concluso */


	.summary-btn {
		display: inline-flex;
		max-width: 100%;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: 2px 6px;
		margin-left: -4px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-size: 12.5px;
		cursor: pointer;
		text-align: left;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}

	.summary-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.summary-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.summary-lead {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
		font-weight: 500;
	}

	.check-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
	}

	.summary-counts {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--ink-faint);
	}

	.cat-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		--icon-size: 14px;
	}

	.summary-diff {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11.5px;
	}

	.summary-failed {
		color: var(--danger);
		font-weight: 500;
	}

	.summary-chevron {
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.summary-chevron.expanded {
		transform: rotate(90deg);
	}

	.full-list-container {
		margin-top: var(--space-1);
		max-height: 18rem;
		overflow-y: auto;
		border-left: 1px solid var(--line);
		padding-left: var(--space-3);
	}
</style>
