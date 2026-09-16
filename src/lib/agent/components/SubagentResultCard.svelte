<script lang="ts">
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	// Tessera per i risultati dei job eseguiti in background (task, bash, eval).
	// Permette di leggere lo stato, la durata e il sommario di ogni operazione
	// asincrona tramite il primitivo unificato TaskRow.
	import { agentUiHooks } from '../ui-context';
	import type { SubagentResultEntry } from '../session.svelte';
	import type { JobResult } from '../notices';
	import { formatDuration } from '../tools/types';
	import OutputBlock from '../tools/parts/OutputBlock.svelte';
	import TaskRow from './TaskRow.svelte';
	import {
		asyncJobToTaskRow,
		type AsyncJobData,
		type TaskRowModel
	} from '../taskRow';
	import { IconFile, IconTerminal } from '$lib/icons';

	let { entry }: { entry: SubagentResultEntry } = $props();

	const hooks = agentUiHooks();

	function resolveStatusKind(
		job: JobResult
	): 'completed' | 'failed' | 'aborted' | 'running' | 'pending' {
		if (job.envelope?.statusKind) {
			const sk = job.envelope.statusKind;
			if (sk === 'completed' || sk === 'failed' || sk === 'aborted') return sk;
		}
		const statusText = job.envelope?.status?.toLowerCase() ?? '';
		if (statusText.includes('fail')) return 'failed';
		if (statusText.includes('abort') || statusText.includes('cancel')) return 'aborted';
		if (statusText.includes('running')) return 'running';
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

	function buildTaskRowModel(job: JobResult, idx: number): TaskRowModel {
		const key = job.jobId || job.envelope?.id || String(idx);
		const jobName = job.envelope?.id || job.jobId || `job-${idx + 1}`;
		const statusKind = resolveStatusKind(job);
		const duration = resolveDuration(job);
		const summary = resolveSummary(job);
		const bodyContent = job.envelope?.body || job.raw;
		const metaSize = resolveMetaSize(job.envelope?.lines, job.envelope?.size);

		const asyncData: AsyncJobData = {
			id: key,
			name: jobName,
			status: statusKind,
			summary,
			durationMs: job.durationMs
		};

		const base = asyncJobToTaskRow(asyncData, idx);

		// Controlla se esistono dettagli da mostrare nella disclosure
		const hasDetails = Boolean(
			bodyContent ||
				job.envelope?.abortReason ||
				job.envelope?.mergeSummary ||
				job.jobType === 'task' ||
				job.jobType === 'bash' ||
				metaSize
		);

		const subtitle = job.envelope?.agent ? `[${job.envelope.agent}]` : undefined;

		return {
			...base,
			key,
			label: jobName,
			subtitle,
			ringNumber: idx + 1,
			metric: duration,
			expandable: hasDetails,
			details: {
				...base.details,
				description: summary || undefined,
				durationMs: job.durationMs
			}
		};
	}
</script>

<div class="subagent-result-card">
	{#if entry.jobs.length > 1}
		<div class="group-header">
			<span class="group-title">{entry.jobs.length} risultati in background</span>
		</div>
	{/if}

	<div class="jobs-list" role="list">
		{#each entry.jobs as job, idx (job.jobId || job.envelope?.id || idx)}
			{@const model = buildTaskRowModel(job, idx)}
			{@const bodyContent = job.envelope?.body || job.raw}
			{@const metaSize = resolveMetaSize(job.envelope?.lines, job.envelope?.size)}
			<div
				animate:flip={{ duration: 200 }}
				class="job-item"
				role="listitem"
				style="--stagger-delay: {idx * 30}ms"
			>
				<TaskRow {model}>
					{#if metaSize}
						<div class="meta-row size">
							<span class="meta-label">Dimensione:</span>
							<span class="meta-value">{metaSize}</span>
						</div>
					{/if}

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

					{#if job.jobType === 'task' || job.jobType === 'bash'}
						<div class="job-actions">
							{#if job.jobType === 'task'}
								<button
									type="button"
									class="action-btn"
									onclick={() => hooks.openSubagent(job.envelope?.id ?? job.jobId)}
								>
									<IconFile size={13} aria-hidden="true" />
									<span>{m.ui_subagentresultcard_apri_transcript_e1cb()}</span>
								</button>
							{:else if job.jobType === 'bash'}
								<button
									type="button"
									class="action-btn terminal-btn"
									onclick={() => hooks.switchToTerminal()}
								>
									<IconTerminal size={13} aria-hidden="true" />
									<span>{m.project_popover_open_terminal()}</span>
								</button>
							{/if}
						</div>
					{/if}

					{#if bodyContent}
						<div class="job-output">
							<OutputBlock text={formatBody(bodyContent)} label="risultato" />
						</div>
					{/if}
				</TaskRow>
			</div>
		{/each}
	</div>
</div>

<style>
	.subagent-result-card {
		width: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.group-header {
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-weight: 500;
	}

	.group-title {
		letter-spacing: 0.02em;
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}

	.job-item {
		animation: job-stagger 200ms ease-out var(--stagger-delay, 0ms) both;
	}

	.job-item + .job-item {
		border-top: 1px solid var(--line);
	}

	@keyframes job-stagger {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.job-item {
			animation: none;
		}
	}

	:root[data-animations="false"] .job-item {
		animation: none;
	}

	.meta-row {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-xs);
		margin-top: var(--space-1);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
	}

	.meta-row.size {
		color: var(--ink-faint);
		background: transparent;
	}

	.meta-row.abort {
		background: var(--bg-sunken);
		color: var(--danger);
		border: 1px solid var(--line);
	}

	.meta-row.merge {
		background: var(--bg-sunken);
		color: var(--brand-ink);
		border: 1px solid var(--line);
	}

	.meta-label {
		font-weight: 500;
		flex-shrink: 0;
	}

	.meta-value {
		overflow-wrap: anywhere;
	}

	.job-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 3px var(--space-2);
		font-size: var(--text-xs);
		font-family: inherit;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--bg-raised);
		color: var(--ink-muted);
		cursor: pointer;
		line-height: 1.2;
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}

	.action-btn:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.terminal-btn:hover {
		color: var(--brand-ink);
		border-color: var(--brand-line);
	}

	.job-output {
		margin-top: var(--space-2);
	}
</style>
