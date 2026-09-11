<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Tessera per i risultati dei job eseguiti in background (task, bash, eval).
	// Permette di leggere lo stato, la durata e il sommario di ogni operazione
	// asincrona senza ingombrare la chat con blocchi XML o dump chilometrici.
	import { agentUiHooks } from '../ui-context';
	import type { SubagentResultEntry } from '../session.svelte';
	import type { JobResult } from '../notices';
	import { formatDuration } from '../tools/types';
	import OutputBlock from '../tools/parts/OutputBlock.svelte';
	import {
		IconStatusPending,
		IconStatusRunning,
		IconStatusDone,
		IconStatusFailed,
		IconChevronRight
	} from '$lib/icons';

	let { entry }: { entry: SubagentResultEntry } = $props();

	const hooks = agentUiHooks();

	// Mappa dello stato di espansione per singolo job
	let expandedJobs = $state<Record<string, boolean>>({});

	function toggleJob(key: string) {
		expandedJobs[key] = !expandedJobs[key];
	}

	const STATUS_ICON: Record<string, typeof IconStatusPending> = {
		completed: IconStatusDone,
		failed: IconStatusFailed,
		aborted: IconStatusFailed,
		running: IconStatusRunning,
		pending: IconStatusPending,
		unknown: IconStatusPending
	};

	function resolveStatusKind(job: JobResult): 'completed' | 'failed' | 'aborted' | 'unknown' {
		if (job.envelope?.statusKind) {
			return job.envelope.statusKind;
		}
		const statusText = job.envelope?.status?.toLowerCase() ?? '';
		if (statusText.includes('fail')) return 'failed';
		if (statusText.includes('abort') || statusText.includes('cancel')) return 'aborted';
		if (statusText.includes('complete')) return 'completed';
		return 'completed';
	}

	function resolveDuration(job: JobResult): string | undefined {
		if (job.envelope?.duration) {
			return job.envelope.duration;
		}
		if (job.durationMs !== undefined) {
			return formatDuration(job.durationMs);
		}
		return undefined;
	}

	function resolveMetaSize(lines?: number, size?: string): string | undefined {
		if (lines !== undefined && size) {
			return `${lines} righe · ${size}`;
		}
		if (lines !== undefined) {
			return `${lines} righe`;
		}
		if (size) {
			return size;
		}
		return undefined;
	}

	function resolveSummary(job: JobResult): string {
		if (job.envelope?.summaryLine) {
			return job.envelope.summaryLine;
		}
		if (job.raw) {
			const firstLine = job.raw.trim().split('\n')[0];
			if (firstLine) return firstLine;
		}
		return job.label ?? '';
	}

	function formatBody(rawText: string | undefined): string {
		if (!rawText) return '';
		const trimmed = rawText.trim();
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				const parsed = JSON.parse(trimmed);
				return JSON.stringify(parsed, null, 2);
			} catch {
				return rawText;
			}
		}
		return rawText;
	}
</script>

<div class="subagent-result-card">
	{#if entry.jobs.length > 1}
		<div class="group-header">
			<span class="group-title">{entry.jobs.length} risultati in background</span>
		</div>
	{/if}

	<div class="jobs-list">
		{#each entry.jobs as job, idx (job.jobId || job.envelope?.id || idx)}
			{@const key = job.jobId || job.envelope?.id || String(idx)}
			{@const isExpanded = Boolean(expandedJobs[key])}
			{@const statusKind = resolveStatusKind(job)}
			{@const StatusIcon = STATUS_ICON[statusKind] ?? IconStatusDone}
			{@const jobName = job.envelope?.id || job.jobId}
			{@const duration = resolveDuration(job)}
			{@const metaSize = resolveMetaSize(job.envelope?.lines, job.envelope?.size)}
			{@const summary = resolveSummary(job)}
			{@const bodyContent = job.envelope?.body || job.raw}

			<div class="job-row" class:failed={statusKind === 'failed' || statusKind === 'aborted'}>
				<div class="header-line">
					<button
						type="button"
						class="toggle-btn"
						aria-expanded={isExpanded}
						onclick={() => toggleJob(key)}
						title={isExpanded ? 'Comprimi dettagli job' : 'Espandi dettagli job'}
					>
						<span class="chevron" class:expanded={isExpanded} aria-hidden="true">
							<IconChevronRight />
						</span>
						<span class="glyph" class:failed={statusKind === 'failed' || statusKind === 'aborted'}>
							<StatusIcon />
						</span>
						<span class="name">{jobName}</span>
						{#if job.envelope?.agent}
							<span class="agent">[{job.envelope.agent}]</span>
						{/if}
						{#if duration}
							<span class="numbers">· {duration}</span>
						{/if}
						{#if metaSize}
							<span class="numbers">· {metaSize}</span>
						{/if}
						{#if summary}
							<span class="summary" title={summary}>{summary}</span>
						{/if}
					</button>

					<div class="actions">
						{#if job.jobType === 'task'}
							<button
								type="button"
								class="action-btn"
								onclick={() => hooks.openSubagent(job.envelope?.id ?? job.jobId)}
							>
								{m.ui_subagentresultcard_apri_transcript_e1cb()}
							</button>
						{:else if job.jobType === 'bash'}
							<button
								type="button"
								class="action-btn terminal-btn"
								onclick={() => hooks.switchToTerminal()}
							>
								{m.project_popover_open_terminal()}
							</button>
						{/if}
					</div>
				</div>

				{#if job.envelope?.abortReason}
					<div class="meta-row abort">
						<span class="meta-label">Interrotto:</span>
						<span class="meta-value">{job.envelope.abortReason}</span>
					</div>
				{/if}

				{#if job.envelope?.mergeSummary}
					<div class="meta-row merge">
						<span class="meta-label">Merge:</span>
						<span class="meta-value">{job.envelope.mergeSummary}</span>
					</div>
				{/if}

				{#if isExpanded}
					<div class="job-body">
						<OutputBlock text={formatBody(bodyContent)} label="risultato" />
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.subagent-result-card {
		width: 100%;
		border-top: 1px solid var(--line);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		line-height: 1.4;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.group-header {
		font-weight: 600;
		color: var(--ink-faint);
		padding: 2px var(--space-1);
	}

	.group-title {
		font-variant-numeric: tabular-nums;
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.job-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.header-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
		width: 100%;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
		background: transparent;
		border: none;
		padding: 2px var(--space-1);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		color: inherit;
	}

	.toggle-btn:hover {
		background: var(--bg-hover);
	}

	.chevron {
		--icon-size: 12px;
		color: var(--ink-faint);
		display: inline-flex;
		align-items: center;
		transition: transform var(--dur-fast) var(--ease-out);
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.glyph {
		--icon-size: 12px;
		display: inline-flex;
		align-items: center;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.glyph.failed {
		color: var(--danger);
	}

	.name {
		font-family: var(--font-mono);
		color: var(--ink);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.agent {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.numbers {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		min-width: 0;
		flex: 1;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.action-btn {
		background: var(--bg-hover);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		cursor: pointer;
		white-space: nowrap;
	}

	.action-btn:hover {
		color: var(--ink);
		border-color: var(--line-strong);
	}

	.terminal-btn {
		color: var(--brand-ink);
	}

	.meta-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		padding-left: calc(12px + var(--space-2));
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.meta-label {
		font-weight: 500;
		flex-shrink: 0;
	}

	.meta-row.abort .meta-label {
		color: var(--danger);
	}

	.meta-row.abort .meta-value {
		color: var(--danger);
	}

	.meta-row.merge .meta-label {
		color: var(--ink-faint);
	}

	.meta-row.merge .meta-value {
		color: var(--ink-muted);
	}

	.meta-value {
		word-break: break-word;
	}

	.job-body {
		padding-left: calc(12px + var(--space-2));
		padding-top: var(--space-1);
		padding-bottom: var(--space-1);
	}
</style>
