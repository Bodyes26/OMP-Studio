<!--
  ToolGroup.svelte — Gruppo compatto di chiamate a strumenti operativi.
  Testata riassuntiva espandibile con conteggi di categoria, bilancio diff e durata.
  Fedele a src/lib/agent/tools/ToolGroup.svelte di Studio.
-->
<script lang="ts">
	import { t, getLanguage } from '../../i18n.ts';
	import { formatDurationSecs } from '../../chat/merge.ts';
	import type { RemoteChatMessage, RemoteToolCategory, Feature } from '../../../../src/protocol.ts';
	import type { ToolGroupSummary } from '../../chat/types.ts';
	import ArtifactCard from './ArtifactCard.svelte';
	import CategoryIcon from './CategoryIcon.svelte';
	import Diff from '#lib/agent/tools/parts/Diff.svelte';
	import OutputBlock from '#lib/agent/tools/parts/OutputBlock.svelte';
	import ThinkingBlock from '#lib/agent/components/ThinkingBlock.svelte';
	import StatusMark from '../StatusMark.svelte';
	import { IconCheck, IconClose, IconChevronRight, IconWorkflow, IconImage, IconViewPreview } from '../../icons.ts';

	let {
		messages = [],
		summary,
		hostFeatures = [],
		hostId = '',
		projectId = '',
		laneId = null,
		isHistory = false
	}: {
		messages: RemoteChatMessage[];
		summary: ToolGroupSummary;
		hostFeatures?: Feature[];
		hostId?: string;
		projectId?: string;
		laneId?: string | null;
		isHistory?: boolean;
	} = $props();

	let isFullListOpen = $state(false);
	let expandedRows = $state<Record<string, boolean>>({});

	const CATEGORY_ORDER: RemoteToolCategory[] = [
		'read',
		'search',
		'run',
		'edit',
		'web',
		'think',
		'task',
		'todo',
		'ask',
		'other'
	];

	function toggleFullList(): void {
		isFullListOpen = !isFullListOpen;
	}

	function toggleRow(id: string): void {
		expandedRows = {
			...expandedRows,
			[id]: !expandedRows[id]
		};
	}

	const callsCountText = $derived(
		summary.totalCalls === 1
			? t('chatCallSingular')
			: t('chatCalls', { count: summary.totalCalls })
	);

	const durationLabel = $derived.by(() => {
		return formatDurationSecs(summary.durationMs, getLanguage());
	});

	const supportsArtifacts = $derived(hostFeatures.includes('artifacts'));
	const artifactMessages = $derived.by(() => {
		if (!supportsArtifacts) return [];
		return messages.filter((m) => m.tool?.artifact != null);
	});
</script>

<div class="tool-group" class:live={summary.hasRunning}>
	<button
		type="button"
		class="summary-btn"
		class:live={summary.hasRunning}
		aria-expanded={isFullListOpen}
		onclick={toggleFullList}
		title={isFullListOpen ? 'Comprimi strumenti' : 'Espandi strumenti'}
	>
		{#if summary.hasRunning}
			<span class="summary-lead">
				<span class="live-status text-shimmer">{t('chatToolsWorking')}</span>
				<span class="summary-text tabular-nums">{callsCountText} · {durationLabel}</span>
			</span>
		{:else}
			<span class="summary-lead">
				<span class="check-icon"><IconCheck /></span>
				<span class="summary-text tabular-nums">{callsCountText} · {durationLabel}</span>
			</span>

			<span class="summary-counts">
				{#each CATEGORY_ORDER as cat}
					{@const count = summary.counts[cat as keyof typeof summary.counts]}
					{#if count}
						<span class="cat-pill">
							<CategoryIcon category={cat} />
							<span class="tabular-nums">{count}</span>
						</span>
					{/if}
				{/each}
			</span>

			<span class="summary-tail">
				{#if summary.totalAdd > 0 || summary.totalDel > 0}
					<span class="summary-diff font-mono">
						{#if summary.totalAdd > 0}<span class="diff-add">+{summary.totalAdd}</span>{/if}
						{#if summary.totalDel > 0}<span class="diff-del">−{summary.totalDel}</span>{/if}
					</span>
				{/if}

				{#if summary.failedCount > 0}
					<span class="summary-failed">
						{summary.failedCount} {summary.failedCount === 1 ? 'errore' : 'errori'}
					</span>
				{/if}

				<span class="summary-chevron" class:expanded={isFullListOpen}>
					<IconChevronRight />
				</span>
			</span>
		{/if}

		{#if summary.hasRunning}
			<span class="summary-chevron" class:expanded={isFullListOpen}>
				<IconChevronRight />
			</span>
		{/if}
	</button>

	{#if artifactMessages.length > 0}
		<div class="tool-artifacts-tray">
			{#each artifactMessages as msg (msg.id)}
				{#if msg.tool?.artifact}
					<ArtifactCard
						artifact={msg.tool.artifact}
						messageId={msg.id}
						toolName={msg.toolName}
						{hostId}
						{projectId}
						{laneId}
						{isHistory}
					/>
				{/if}
			{/each}
		</div>
	{/if}

	{#if isFullListOpen}
		<div class="full-list-container">
			{#each messages as msg (msg.id)}
				{#if msg.role === 'assistant'}
					<ThinkingBlock text={(msg.blocks ?? []).filter((block) => block.type === 'thinking').map((block) => block.text).join('\n\n')} />
				{:else}
				{@const tool = msg.tool}
				{@const isRowOpen = Boolean(expandedRows[msg.id])}
				<div class="row-container">
					<button
						type="button"
						class="tool-row"
						aria-expanded={isRowOpen}
						onclick={() => toggleRow(msg.id)}
					>
						<span class="row-icon-slot">
							{#if tool?.status === 'running'}
								<span class="spinner" aria-label="In esecuzione"></span>
							{:else if tool?.status === 'error'}
								<span class="fail-icon"><IconClose /></span>
							{:else if tool?.artifact && supportsArtifacts}
								{#if tool.artifact.kind === 'mermaid'}
									<IconWorkflow class="cat-icon" />
								{:else if tool.artifact.kind === 'svg'}
									<IconImage class="cat-icon" />
								{:else}
									<IconViewPreview class="cat-icon" />
								{/if}
							{:else}
								<CategoryIcon category={tool?.category ?? 'other'} class="cat-icon" />
							{/if}
						</span>

						<span class="row-label" class:text-shimmer={tool?.status === 'running'}>
							{tool?.artifact?.title || tool?.label || msg.toolName || 'Strumento'}
						</span>

						{#if tool?.detail}
							<span class="row-detail" title={tool.detail}>{tool.detail}</span>
						{/if}

						{#if tool?.status !== 'running' && (tool?.meta || tool?.diffStats)}
							<span class="row-tail">
								{#if tool?.meta}
									<span class="row-meta" class:meta-fail={tool.status === 'error'}>{tool.meta}</span>
								{/if}
								{#if tool?.diffStats}
									<span class="row-diff">
										<span class="diff-add">+{tool.diffStats[0]}</span>
										<span class="diff-del">−{tool.diffStats[1]}</span>
									</span>
								{/if}
							</span>
						{/if}
					</button>

					{#if isRowOpen}
						<div class="inline-body">
							{#if tool?.artifact && supportsArtifacts}
								<div class="inline-artifact-slot">
									<ArtifactCard
										artifact={tool.artifact}
										messageId={msg.id}
										toolName={msg.toolName}
										{hostId}
										{projectId}
										{laneId}
										{isHistory}
									/>
								</div>
							{/if}
							{#if tool?.errorReason}
								<div class="error-reason-box">
									{tool.errorReason}
								</div>
							{/if}

							{#if tool?.diff}
								<Diff diff={tool.diff} />
							{/if}

							{#if tool?.output}
								<OutputBlock text={tool.output} />
							{/if}

							{#if tool?.todos && tool.todos.length > 0}
								<div class="todos-list">
									{#each tool.todos as item}
										<div class="todo-item-row">
											<StatusMark
												status={item.status === 'completed'
													? 'completed'
													: item.status === 'in_progress'
														? 'running'
														: item.status === 'abandoned'
															? 'failed'
															: 'pending'}
											/>
											<span class="todo-item-text">{item.text}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if !tool?.errorReason && !tool?.diff && !tool?.output && (!tool?.todos || tool.todos.length === 0)}
								<div class="fallback-detail font-mono">
									{tool?.detail ?? msg.text ?? ''}
								</div>
							{/if}
						</div>
					{/if}
				</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.tool-artifacts-tray {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 8px);
		margin-top: var(--space-2, 8px);
	}

	.inline-artifact-slot {
		margin-bottom: var(--space-2, 8px);
	}

	.tool-group {
		display: flex;
		flex-direction: column;
		margin: var(--space-2) 0;
		font-family: var(--font-ui);
		min-width: 0;
	}

	.summary-btn {
		display: flex;
		width: 100%;
		max-width: 100%;
		flex-wrap: nowrap;
		align-items: center;
		gap: var(--space-2);
		padding: 3px 2px;
		margin-left: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-size: 12.5px;
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}
	.summary-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.summary-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}

	.summary-lead {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-muted);
		font-weight: 500;
		flex-shrink: 0;
	}

	.live-status {
		font-weight: 600;
		color: var(--ink-muted);
	}

	.check-icon {
		display: inline-flex;
		align-items: center;
		--icon-size: 14px;
		color: var(--ink-muted);
	}

	.summary-counts {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--ink-faint);
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
	}

	.summary-tail {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
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

	.diff-add {
		color: var(--success);
	}

	.diff-del {
		color: var(--danger);
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
		border-left: 2px solid var(--line);
		padding-left: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.row-container {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.tool-row {
		display: flex;
		width: 100%;
		min-height: 28px;
		min-width: 0;
		align-items: center;
		gap: 10px;
		background: transparent;
		border: none;
		padding: 2px 6px;
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
		outline-offset: -2px;
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
		font-weight: 500;
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
		font-weight: 500;
	}

	.row-diff {
		display: flex;
		align-items: center;
		gap: 4px;
	}

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
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.error-reason-box {
		color: var(--danger);
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 2px 0;
	}

	.todos-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.todo-item-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.fallback-detail {
		font-size: var(--text-mono);
		color: var(--ink-muted);
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
