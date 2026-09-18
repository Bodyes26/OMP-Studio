<script lang="ts">
	/**
	 * TaskRow.svelte
	 *
	 * Componente primitivo per il nuovo linguaggio UI TaskRows (fasi Todo, subagenti, job asincroni).
	 * Supporta Svelte 5 runes, markup disclosure accessibile, anello SVG 24px,
	 * pillola di stato terminale/bloccato, metrica tabulare e dettagli generici.
	 */
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { m } from '$lib/paraglide/messages.js';
	import {
		IconCheck,
		IconClose,
		IconWarning,
		IconChevronRight,
		IconFile
	} from '$lib/icons';
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
</script>

{#snippet glyphSlot()}
	<div class="glyph-slot" aria-hidden="true">
		{#if model.status === 'running'}
			<div class="ring running">
				<svg class="ring-svg" viewBox="0 0 24 24" width="24" height="24">
					<circle class="ring-track" cx="12" cy="12" r="9" />
					<circle
						class="ring-arc"
						cx="12"
						cy="12"
						r="9"
						stroke-dasharray="15.83 40.72"
					/>
					{#if model.ringNumber !== undefined}
						<text class="ring-text" x="12" y="12">{model.ringNumber}</text>
					{/if}
				</svg>
			</div>
		{:else if model.status === 'completed'}
			<div class="ring completed">
				<IconCheck size={13} />
			</div>
		{:else if model.status === 'failed'}
			<div class="ring failed">
				<IconClose size={13} />
			</div>
		{:else if model.status === 'blocked'}
			<div class="ring blocked">
				<IconWarning size={13} />
			</div>
		{:else if model.status === 'abandoned' || model.status === 'aborted'}
			<div class="ring abandoned">
				<IconClose size={13} />
			</div>
		{:else}
			<!-- pending -->
			<div class="ring pending">
				{#if model.ringNumber !== undefined}
					<span class="ring-number">{model.ringNumber}</span>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet rowMain()}
	<div class="row-main">
		<span class="row-label">{model.label}</span>
		{#if model.subtitle}
			<span class="row-subtitle">{model.subtitle}</span>
		{/if}
		{#if !isPillStatus(model.status)}
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

				{#if isPillStatus(model.status)}
					<span class="status-pill status-{model.status}">
						{statusLabel(model.status)}
					</span>
				{/if}

				<span class="chevron" class:expanded={isExpanded} aria-hidden="true">
					<IconChevronRight size={14} />
				</span>
			</button>
		{:else}
			<div class="row-static">
				{@render glyphSlot()}
				{@render rowMain()}

				{#if model.metric}
					<span class="row-metric">{model.metric}</span>
				{/if}

				{#if isPillStatus(model.status)}
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
	{#if model.expandable && isExpanded}
		<div id={detailsId} class="row-details" transition:slide={{ duration: 180 }}>
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
								{#if item.status === 'completed'}
									<IconCheck size={12} />
								{:else if item.status === 'running'}
									<span class="mini-running-dot"></span>
								{:else if item.status === 'blocked'}
									<IconWarning size={12} />
								{:else if item.status === 'abandoned' || item.status === 'aborted'}
									<IconClose size={12} />
								{:else if item.status === 'failed'}
									<IconClose size={12} />
								{:else}
									<span class="mini-pending-dot"></span>
								{/if}
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
						<IconFile size={13} aria-hidden="true" />
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
		transition: background-color 140ms ease;
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

	.ring {
		width: 24px;
		height: 24px;
		min-width: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		box-sizing: border-box;
	}

	.ring.pending {
		border: 1.5px solid var(--line);
		color: var(--ink-faint);
		background: transparent;
	}

	.ring-number {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--ink-muted);
	}

	.ring.running {
		position: relative;
	}

	.ring-svg {
		display: block;
		transform-origin: center;
	}

	.ring-track {
		stroke: color-mix(in srgb, var(--brand) 18%, transparent);
		stroke-width: 2;
		fill: none;
	}

	.ring-arc {
		stroke: var(--brand);
		stroke-width: 2;
		stroke-linecap: round;
		fill: none;
		transform-origin: center;
		animation: ring-spin 1.2s linear infinite;
	}

	.ring-text {
		fill: var(--ink-muted);
		font-size: 10px;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		text-anchor: middle;
		dominant-baseline: central;
	}

	@keyframes ring-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Reduced motion: degradare a cerchio intero statico */
	@media (prefers-reduced-motion: reduce) {
		.ring-arc {
			animation: none;
			stroke-dasharray: none;
		}
	}

	:global(:root[data-animations="false"]) .ring-arc {
		animation: none;
		stroke-dasharray: none;
	}

	.ring.completed {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
	}

	.ring.failed {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.ring.blocked {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		color: var(--warn);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
	}

	.ring.abandoned {
		background: color-mix(in srgb, var(--ink-faint) 15%, transparent);
		color: var(--ink-muted);
		border: 1px solid color-mix(in srgb, var(--ink-faint) 30%, transparent);
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
		padding: 1px 6px;
		border-radius: 4px;
		font-size: var(--text-xs);
		line-height: 1.3;
		font-weight: 500;
		flex-shrink: 0;
	}

	.status-pill.status-completed {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
		color: var(--success);
	}

	.status-pill.status-failed {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		color: var(--danger);
	}

	.status-pill.status-blocked {
		background: color-mix(in srgb, var(--warn) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		color: var(--warn);
	}

	.status-pill.status-abandoned,
	.status-pill.status-aborted {
		background: color-mix(in srgb, var(--ink-faint) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--ink-faint) 30%, transparent);
		color: var(--ink-muted);
	}

	.action-slot {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.chevron {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink-muted);
		transition: transform 160ms ease;
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
		color: var(--danger, #ef4444);
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

	.task-item.status-completed .item-glyph {
		color: var(--success);
	}

	.task-item.status-blocked .item-glyph {
		color: var(--warn);
	}

	.task-item.status-abandoned .item-glyph,
	.task-item.status-aborted .item-glyph {
		color: var(--ink-faint);
	}

	.task-item.status-failed .item-glyph {
		color: var(--danger, #ef4444);
	}

	.mini-running-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand);
	}

	.mini-pending-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1px solid var(--line);
	}

	.item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-blocker {
		font-size: 10px;
		line-height: 1.35;
		padding: 2px 6px;
		border-radius: 3px;
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
		border-radius: var(--radius-sm, 4px);
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
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
		font-size: 11px;
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
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm, 4px);
		background: color-mix(in srgb, var(--ink) 4%, var(--bg-raised));
		color: var(--ink-muted);
		font-size: 11px;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.btn-transcript:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.terminal-guidance {
		margin: 0;
		font-size: 11px;
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
