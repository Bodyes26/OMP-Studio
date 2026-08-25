<script lang="ts">
	// ToolGroup: raggruppa una sequenza di chiamate tool e blocchi di ragionamento
	// (thinking) consecutivi o alternati in un unico blocco compatto ed elegante.
	//
	// Mostra un'intestazione riassuntiva con conteggio operazioni, chip dei tool usati,
	// stato di esecuzione e durata totale. Il corpo è collassabile e resta chiuso
	// durante l'esecuzione per evitare flash e salti di layout, espandendosi solo su errore o clic manuale.
	import type { AssistantEntry, ToolEntry } from '../session.svelte';
	import { chatReveal } from '../motion';
	import ThinkingBlock from '../components/ThinkingBlock.svelte';
	import ToolCard from './ToolCard.svelte';
	import { formatDuration } from './types';

	export type ToolGroupEntry = ToolEntry | AssistantEntry;

	let {
		entries,
		activeAssistantId = null
	}: {
		entries: ToolGroupEntry[];
		activeAssistantId?: number | null;
	} = $props();

	// Filtra gli strumenti effettivi
	const toolEntries = $derived(entries.filter((e): e is ToolEntry => e.kind === 'tool'));
	const assistantEntries = $derived(entries.filter((e): e is AssistantEntry => e.kind === 'assistant'));

	// Stato aggregato
	const isToolRunning = $derived(toolEntries.some((e) => e.running));
	const isStreamingThinking = $derived(
		activeAssistantId != null && assistantEntries.some((e) => e.id === activeAssistantId)
	);
	const isRunning = $derived(isToolRunning || isStreamingThinking);
	const hasError = $derived(toolEntries.some((e) => e.result?.isError === true));

	// Cronometro: mentre almeno un tool è in esecuzione il totale si aggiorna
	// ogni secondo dal primo avvio; a esecuzione conclusa resta la durata finale.
	let now = $state(Date.now());
	$effect(() => {
		if (!isToolRunning) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const totalDuration = $derived.by(() => {
		if (toolEntries.length === 0) return undefined;
		const start = Math.min(...toolEntries.map((e) => e.startedAt));
		if (isToolRunning) {
			return now > start ? formatDuration(now - start) : undefined;
		}
		const finished = toolEntries.every((e) => e.endedAt);
		if (!finished) return undefined;
		const end = Math.max(...toolEntries.map((e) => e.endedAt ?? e.startedAt));
		return end > start ? formatDuration(end - start) : undefined;
	});

	// Strumenti unici utilizzati per i chip di anteprima nel badge/header
	const toolSummaryList = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const e of toolEntries) {
			counts.set(e.toolName, (counts.get(e.toolName) ?? 0) + 1);
		}
		return Array.from(counts.entries()).map(([name, count]) => ({
			name,
			count
		}));
	});

	// Ultimo tool attivo o fallito per il summary text
	const currentOrLastError = $derived.by(() => {
		const running = toolEntries.find((e) => e.running);
		if (running) return running;
		const error = toolEntries.find((e) => e.result?.isError);
		if (error) return error;
		return toolEntries[toolEntries.length - 1];
	});

	// Espansione manuale: di default resta collassato per evitare flash/salti fastidiosi,
	// tranne se c'è un errore o se l'utente clicca esplicitamente per aprirlo.
	let manualExpanded = $state<boolean | null>(null);
	const isExpanded = $derived(manualExpanded ?? hasError);

	// Quando il gruppo si apre da solo per un errore (nessuna scelta manuale),
	// mostriamo solo le operazioni fallite: aprire l'intera sequenza per farne
	// vedere una su venti sarebbe un muro di rumore. Un clic manuale mostra
	// invece sempre la sequenza completa.
	const autoExpandedByError = $derived(manualExpanded === null && hasError);
	const visibleEntries = $derived(
		autoExpandedByError ? entries.filter((e) => e.kind === 'tool' && e.result?.isError === true) : entries
	);

	const headerLabel = $derived.by(() => {
		const totalTools = toolEntries.length;
		const labelStep = totalTools === 1 ? '1 operazione' : `${totalTools} operazioni`;
		if (isRunning) {
			return `Esecuzione strumenti (${labelStep})`;
		}
		if (hasError) {
			return `Operazioni completate con errori (${labelStep})`;
		}
		return `Strumenti eseguiti (${labelStep})`;
	});
</script>

<div
	class="tool-group"
	class:running={isRunning}
	class:error={hasError}
	class:expanded={isExpanded}
>
	<button
		type="button"
		class="group-header"
		aria-expanded={isExpanded}
		onclick={() => (manualExpanded = !isExpanded)}
		title={isExpanded ? 'Comprimi passaggi' : 'Espandi passaggi'}
	>
		<div class="header-left">
			<span class="chevron" class:expanded={isExpanded} aria-hidden="true">▸</span>
			<span class="state-dot" aria-hidden="true"></span>
			<span class="title">{headerLabel}</span>

			<div class="tool-chips" aria-label="Strumenti usati">
				{#each toolSummaryList as item (item.name)}
					<span
						class="chip"
						in:chatReveal={{ duration: 160, blur: 3, distance: 1 }}
					>
						<span class="chip-name">{item.name}</span>
						{#if item.count > 1}
							<span
								class="chip-count"
								in:chatReveal={{ duration: 140, blur: 2, distance: 0 }}
							>
								×{item.count}
							</span>
						{/if}
					</span>
				{/each}
			</div>
		</div>

		<div class="header-right">
			{#if isRunning}
				{#if currentOrLastError?.intent}
					<span class="active-intent" title={currentOrLastError.intent}>
						{currentOrLastError.intent}
					</span>
				{:else if isStreamingThinking}
					<span class="active-intent">sta pensando...</span>
				{:else}
					<span class="status-tag running">{totalDuration ?? 'in corso'}</span>
				{/if}
			{:else if hasError}
				<span class="status-tag error">fallito</span>
			{:else if totalDuration}
				<span class="duration">{totalDuration}</span>
			{/if}
		</div>
	</button>

	{#if isExpanded}
		<div
			class="group-body"
			transition:chatReveal={{ duration: 240, blur: 4, distance: -3 }}
		>
			{#each visibleEntries as entry (entry.id)}
				<div
					class="group-entry"
					in:chatReveal={{ duration: 180, blur: 3, distance: 2 }}
				>
					{#if entry.kind === 'tool'}
						<ToolCard {entry} />
					{:else if entry.kind === 'assistant'}
						{#each entry.blocks as block, i (`${entry.id}-${block.type}-${i}`)}
							{#if block.type === 'thinking'}
								<ThinkingBlock
									text={block.text}
									streaming={entry.id === activeAssistantId && i === entry.blocks.length - 1}
								/>
							{/if}
						{/each}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tool-group {
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--bg-sunken) 70%, transparent);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
		min-width: 0;
	}

	.tool-group.running {
		border-color: color-mix(in srgb, var(--brand) 40%, var(--line));
		background: var(--bg-raised);
	}

	.tool-group.error {
		border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
	}

	.group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		user-select: none;
		min-width: 0;
	}

	.group-header:hover {
		background: var(--bg-hover);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		flex: 1;
	}

	.chevron {
		font-size: var(--text-xs);
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease-out);
		display: inline-block;
		width: var(--space-3);
		text-align: center;
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.state-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--ink-faint);
		flex-shrink: 0;
	}

	.running .state-dot {
		background: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.error .state-dot {
		background: var(--danger);
	}

	.title {
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.tool-chips {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		overflow: hidden;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.chip-count {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.active-intent {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-style: italic;
	}

	.status-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.status-tag.running {
		color: var(--brand-ink);
		background: color-mix(in srgb, var(--brand) 15%, transparent);
	}

	.status-tag.error {
		color: var(--danger);
	}

	.duration {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.group-body {
		display: flex;
		flex-direction: column;
		padding: var(--space-1) var(--space-2) var(--space-2) var(--space-2);
		border-top: 1px solid var(--line);
		gap: var(--space-1);
		background: var(--bg-sunken);
	}

	.group-entry {
		min-width: 0;
	}
</style>
