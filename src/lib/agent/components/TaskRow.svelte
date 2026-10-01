<script lang="ts">
	/**
	 * TaskRow.svelte
	 *
	 * Componente primitivo per il nuovo linguaggio UI TaskRows (fasi Todo, subagenti, job asincroni).
	 * Supporta Svelte 5 runes, markup disclosure accessibile, anello SVG 24px,
	 * pillola di stato terminale/bloccato, metrica tabulare e dettagli generici.
	 */
	import { getContext, onDestroy, type Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import {
		IconChevronRight,
		IconFile
	} from '$lib/icons';
	import StatusMark from '$lib/ui/StatusMark.svelte';
	import { Lingering } from '../motionState.svelte';
	import GitDiffBadge from '$lib/components/GitDiffBadge.svelte';
	import { gitDiffStore, hasGitChanges } from '$lib/stores/gitDiff.svelte';
	import {
		type TaskRowModel,
		type TaskRowStatus,
		isPillStatus,
		formatTokensMetric
	} from '../taskRow';
	interface Props {
		model: TaskRowModel;
		expanded?: boolean;
		onToggle?: (expanded: boolean) => void;
		onOpenTranscript?: () => void;
		action?: Snippet;
		children?: Snippet;
		class?: string;
	}

	let {
		model,
		expanded = undefined,
		onToggle = undefined,
		onOpenTranscript = undefined,
		action = undefined,
		children = undefined,
		class: className = ''
	}: Props = $props();

	let internalExpanded = $state(false);
	const isExpanded = $derived(expanded !== undefined ? expanded : internalExpanded);
	const getProjectPath = getContext<(() => string) | undefined>('git-diff-project-path');
	const gitDiff = $derived(getProjectPath ? gitDiffStore.forPath(getProjectPath()) : null);
	const showGitDiff = $derived(model.status === 'completed' && gitDiff && hasGitChanges(gitDiff));

	// ID univoco per il binding ARIA disclosure
	const uid = $props.id();
	const safeKey = $derived(model.key.replace(/[^a-zA-Z0-9_-]/g, '_'));
	const detailsId = $derived(`${uid}-details-${safeKey}`);

	function toggle() {
		if (!model.expandable) return;
		const next = !isExpanded;
		internalExpanded = next;
		onToggle?.(next);
	}

	function statusLabel(status: TaskRowStatus): string {
		switch (status) {
			case 'running':
				return m.task_row_status_running();
			case 'completed':
				return m.task_row_status_completed();
			case 'failed':
				return m.task_row_status_failed();
			case 'blocked':
				return m.task_row_status_blocked();
			case 'abandoned':
				return m.task_row_status_abandoned();
			case 'aborted':
				return m.task_row_status_aborted();
			case 'pending':
			default:
				return m.task_row_status_pending();
		}
	}

	function toStatusMarkStatus(status: TaskRowStatus) {
		if (status === 'abandoned') return 'aborted';
		return status;
	}

	const detailsLinger = new Lingering<boolean>();
	$effect(() => {
		detailsLinger.update((model.expandable && isExpanded) ? true : undefined);
	});
	onDestroy(() => {
		detailsLinger.dispose();
	});
</script>

{#snippet glyphSlot()}
	<div class="glyph-slot" aria-hidden="true">
		<StatusMark status={toStatusMarkStatus(model.status)} />
	</div>
{/snippet}

{#snippet rowMain()}
	<div class="row-main">
		<span class="row-label">
			{#if model.ringNumber !== undefined}
				<span class="phase-number">{model.ringNumber}</span>
			{/if}
			{model.label}
		</span>
		{#if model.subtitle}
			<span class="row-subtitle">{model.subtitle}</span>
		{/if}
		{#if !isPillStatus(model.status) || model.status === 'completed'}
			<span class="sr-only">{statusLabel(model.status)}</span>
		{/if}
	</div>
{/snippet}

<div
	class="task-row status-{model.status} {className}"
	class:is-expanded={isExpanded}
	class:is-expandable={model.expandable}
>
	<div class="row-header">
		{#if model.expandable}
			<button
				type="button"
				class="row-trigger"
				onclick={toggle}
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? detailsId : undefined}
			>
				{@render glyphSlot()}
				{@render rowMain()}

				{#if model.metric}
					<span class="row-metric">{model.metric}</span>
				{/if}

				{#if showGitDiff && gitDiff}
					<GitDiffBadge additions={gitDiff.additions} deletions={gitDiff.deletions} />
				{/if}

				{#if isPillStatus(model.status) && model.status !== 'completed'}
					<span class="status-pill status-{model.status}">
						{statusLabel(model.status)}
					</span>
				{/if}

				<span class="chevron" class:expanded={isExpanded} aria-hidden="true">
					<IconChevronRight />
				</span>
			</button>
		{:else}
			<div class="row-static">
				{@render glyphSlot()}
				{@render rowMain()}

				{#if model.metric}
					<span class="row-metric">{model.metric}</span>
				{/if}

				{#if showGitDiff && gitDiff}
					<GitDiffBadge additions={gitDiff.additions} deletions={gitDiff.deletions} />
				{/if}

				{#if isPillStatus(model.status) && model.status !== 'completed'}
					<span class="status-pill status-{model.status}">
						{statusLabel(model.status)}
					</span>
				{/if}
			</div>
		{/if}

		{#if action}
			<div class="action-slot">
				{@render action()}
			</div>
		{/if}
	</div>

	<!-- Sezione Dettagli espandibile -->
	{#if detailsLinger.shown !== undefined}
		<div class={detailsLinger.leaving ? 'tray-out' : 'tray-in'}>
			<div class="tray-fold-inner">
				<div id={detailsId} class="row-details">
					<!-- Descrizione testuale -->
					{#if model.details?.description}
						<p class="details-description">{model.details.description}</p>
					{/if}

					<!-- Lista task Todo figli -->
					{#if model.details?.items && model.details.items.length > 0}
						<ul class="task-items-list" role="list">
							{#each model.details.items as item, itemIdx (item.id ?? `${model.key}-item-${itemIdx}`)}
								<li class="task-item status-{item.status ?? 'pending'}" role="listitem">
									<span class="item-glyph" aria-hidden="true">
										<StatusMark status={toStatusMarkStatus(item.status ?? 'pending')} />
									</span>
									<span class="item-label">{item.label}</span>
									{#if item.blocker}
										<span class="item-blocker" title={item.blocker}>{item.blocker}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

			<!-- Griglia metadati per subagente / job -->
			{#if model.details?.model || (model.details?.tokens !== undefined && model.details.tokens > 0) || (model.details?.cost !== undefined && model.details.cost > 0)}
				<div class="details-meta-grid">
					{#if model.details?.model}
						<div class="meta-item">
							<span class="meta-label">{m.task_row_label_model()}</span>
							<span class="meta-value">{model.details.model}</span>
						</div>
					{/if}
					{#if model.details?.tokens !== undefined && model.details.tokens > 0}
						<div class="meta-item">
							<span class="meta-label">{m.task_row_label_tokens()}</span>
							<span class="meta-value">{formatTokensMetric(model.details.tokens)}</span>
						</div>
					{/if}
					{#if model.details?.cost !== undefined && model.details.cost > 0}
						<div class="meta-item">
							<span class="meta-label">{m.task_row_label_cost()}</span>
							<span class="meta-value">${model.details.cost.toFixed(4)}</span>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Ultimo intent o tool recenti -->
			{#if model.details?.lastIntent}
				<div class="details-intent">
					<span class="intent-text">{model.details.lastIntent}</span>
				</div>
			{/if}

			<!-- Azione Transcript se fornita -->
			{#if onOpenTranscript}
				<div class="details-actions">
					<button type="button" class="btn-transcript" onclick={onOpenTranscript}>
								<IconFile aria-hidden="true" />
						<span>{m.task_row_open_transcript()}</span>
					</button>
				</div>
			{/if}

			<!-- Indicazione terminale Alt+A se subagente -->
			{#if (model.status === 'running' || model.status === 'pending') && (model.details?.terminalHint || (!model.details?.items && model.details?.model))}
				<p class="terminal-guidance">
					{model.details?.terminalHint ?? m.task_row_terminal_hint()}
				</p>
			{/if}

			<!-- Slot generico figli per estendibilita' -->
			{#if children}
				<div class="details-custom">
					{@render children()}
				</div>
			{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.task-row {
		display: flex;
		flex-direction: column;
		width: 100%;
		border-radius: var(--radius-md, 6px);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-sm);
	}

	.row-header {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 36px;
		background: transparent;
		border-radius: var(--radius-md, 6px);
		color: inherit;
		font-size: inherit;
	}

	.row-trigger {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		flex: 1;
		min-width: 0;
		min-height: 36px;
		padding: 4px var(--space-2, 8px);
		border-radius: var(--radius-md, 6px);
		border: none;
		background: transparent;
		color: inherit;
		font-size: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}

	.row-trigger:hover {
		background: var(--bg-hover);
	}

	.row-trigger:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -1px;
	}

	.row-static {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
		flex: 1;
		min-width: 0;
		min-height: 36px;
		padding: 4px var(--space-2, 8px);
		border-radius: var(--radius-md, 6px);
		border: none;
		background: transparent;
		color: inherit;
		font-size: inherit;
		text-align: left;
		cursor: default;
	}

	.action-slot {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding-right: var(--space-2, 8px);
	}
	.glyph-slot {
		width: 24px;
		height: 24px;
		min-width: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.phase-number {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		margin-right: var(--space-1, 4px);
	}
	.row-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 1px;
	}

	.row-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-subtitle {
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-metric {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		padding: 0 4px;
		flex-shrink: 0;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		font-size: var(--text-meta);
		line-height: 1.3;
		font-weight: 500;
		flex-shrink: 0;
		background: transparent;
		border: none;
		padding: 0;
	}

	.status-pill.status-failed,
	.status-pill.status-blocked {
		color: var(--danger);
	}

	.status-pill.status-abandoned,
	.status-pill.status-aborted {
		color: var(--ink-muted);
	}

	.action-slot {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.chevron {
		--icon-size: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		transition: transform var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}
	/* Sezione Dettagli */
	.row-details {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 8px);
		padding: var(--space-1, 4px) var(--space-2, 8px) var(--space-2, 8px) 36px;
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		min-width: 0;
	}

	.details-description {
		margin: 0;
		color: var(--ink-muted);
		line-height: 1.4;
		word-break: break-word;
	}

	.task-items-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.task-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1, 4px) var(--space-2, 8px);
		padding: 2px 4px;
		border-radius: var(--radius-sm, 4px);
		color: var(--ink-muted);
	}

	.task-item.status-completed {
		color: var(--ink-muted);
	}

	.task-item.status-running {
		color: var(--ink);
		font-weight: 500;
	}

	.task-item.status-blocked {
		color: var(--warn);
	}

	.task-item.status-abandoned,
	.task-item.status-aborted {
		color: var(--ink-faint);
		text-decoration: line-through;
	}

	.task-item.status-failed {
		color: var(--danger);
	}

	.item-glyph {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.item-glyph :global(svg) {
		display: block;
	}
	.item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-blocker {
		font-size: var(--text-caption);
		line-height: 1.35;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		width: 100%;
		margin-left: 22px;
		box-sizing: border-box;
		word-break: break-word;
		white-space: pre-wrap;
	}

	.details-meta-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2, 8px) var(--space-3, 12px);
		padding: 4px 8px;
		background: color-mix(in srgb, var(--ink) 4%, transparent);
		border-radius: var(--radius-sm);
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-meta);
	}

	.meta-label {
		color: var(--ink-faint);
	}

	.meta-value {
		color: var(--ink);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.details-intent {
		font-size: var(--text-meta);
		color: var(--ink-muted);
		font-style: italic;
		word-break: break-word;
	}

	.details-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2, 8px);
	}

	.btn-transcript {
		--icon-size: 13px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--ink) 4%, var(--bg-raised));
		color: var(--ink-muted);
		font-size: var(--text-meta);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
	}
	.btn-transcript:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.terminal-guidance {
		margin: 0;
		font-size: var(--text-meta);
		color: var(--ink-faint);
		line-height: 1.3;
		word-break: break-word;
	}

	.details-custom {
		display: flex;
		flex-direction: column;
		gap: var(--space-1, 4px);
	}
</style>
