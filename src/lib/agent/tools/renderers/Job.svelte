<!--
  Renderer per `job` e operazioni sui processi/task asincroni.

  Nel corpo espanso mostra la tabella KeyValue con i parametri della richiesta,
  l'elenco dei job con StatusMark condiviso (Outcome-Only Color Rule),
  durata formattata tabulare ed etichetta, e il blocco OutputBlock del risultato testuale.
-->
<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { agentUiHooks } from '../../ui-context';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import StatusMark, { type StatusMarkType } from '#lib/ui/StatusMark.svelte';
	import {
		asRecord,
		formatDuration,
		num,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result }: ToolRenderProps = $props();

	const hooks = agentUiHooks();
	const op = $derived(
		str(args.op) ?? str(args.action) ?? str(args.command) ?? str(asRecord(result?.details)?.op) ?? ''
	);
	const singleId = $derived(str(args.id) ?? str(args.jobId) ?? str(args.name) ?? '');
	const idsList = $derived(strList(args.ids));
	const targetIds = $derived(singleId ? [singleId] : idsList);

	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	interface JobEntry {
		id: string;
		agentId?: string;
		status?: string;
		type?: string;
		label?: string;
		duration?: string;
		model?: string;
		jobText?: string;
	}

	const rawJobs = $derived.by(() => {
		if (details?.jobs) return recordList(details.jobs);
		const proc = asRecord(details?.proc);
		if (proc?.jobs) return recordList(proc.jobs);
		if (proc?.job) {
			const single = asRecord(proc.job);
			if (single) return [single];
		}
		if (Array.isArray(result?.details)) return recordList(result.details);
		return [];
	});

	const jobList = $derived.by<JobEntry[]>(() => {
		const out: JobEntry[] = [];
		for (const rec of rawJobs) {
			const jid = str(rec.id) ?? str(rec.jobId) ?? str(rec.name);
			if (!jid) continue;
			const type = str(rec.type);
			// omp >= 18.9 espone `agentId` (nei dettagli async-result / snapshot)
			// o `agentUrlId` (negli snapshot di wait/jobs/proc); per i job `task`
			// legacy ripiega sull'ID del job.
			const explicitAgentId = str(rec.agentId) ?? str(rec.agentUrlId);
			const agentId = explicitAgentId ?? (type === 'task' ? jid : undefined);
			out.push({
				id: jid,
				agentId,
				status: str(rec.status) ?? str(rec.state),
				type,
				label: str(rec.label) ?? str(rec.task),
				duration: formatDuration(num(rec.durationMs)),
				model: str(rec.resolvedModel) ?? str(rec.model),
				jobText: str(rec.resultText) ?? str(rec.errorText)
			});
		}
		return out;
	});

	function toStatusMarkStatus(status?: string): StatusMarkType {
		switch (status?.toLowerCase()) {
			case 'completed':
			case 'success':
			case 'done':
				return 'completed';
			case 'failed':
			case 'error':
				return 'failed';
			case 'running':
			case 'in_progress':
				return 'running';
			case 'blocked':
				return 'blocked';
			case 'aborted':
			case 'cancelled':
			case 'abandoned':
				return 'aborted';
			default:
				return 'pending';
		}
	}

	const argRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (op) rows.push({ key: 'Operazione', value: op });
		if (targetIds.length > 0) rows.push({ key: 'Target', value: targetIds.join(', ') });
		const signal = str(args.signal);
		if (signal) rows.push({ key: 'Segnale', value: signal });
		const timeout = num(args.timeout) ?? num(args.timeoutMs);
		if (timeout !== undefined) rows.push({ key: 'Timeout', value: `${timeout}` });
		return rows;
	});
</script>

<div class="job-body">
	{#if argRows.length > 0}
		<KeyValue rows={argRows} />
	{/if}

	{#if jobList.length > 0}
		<div class="job-table-wrap">
			<table class="job-table">
				<thead>
					<tr>
						<th>ID</th>
						<th>{m.ui_goal_stato_89af()}</th>
						<th>Durata</th>
						<th>Dettagli</th>
					</tr>
				</thead>
				<tbody>
					{#each jobList as item (item.id)}
						<tr>
							<td class="id-cell">
								{#if item.agentId}
									<button
										type="button"
										class="agent-id-btn"
										onclick={() => hooks.openSubagent(item.agentId!)}
									>
										{item.agentId}
									</button>
									{#if item.id !== item.agentId}
										<span class="job-id-sub">({item.id})</span>
									{/if}
								{:else}
									{item.id}
								{/if}
							</td>
							<td class="status-cell">
								{#if item.status}
									<span class="status-wrap" title={item.status}>
										<StatusMark status={toStatusMarkStatus(item.status)} />
										<span class="status-text">{item.status}</span>
									</span>
								{:else}
									<span class="status-faint">-</span>
								{/if}
							</td>
							<td class="dur-cell">{item.duration ?? '-'}</td>
							<td class="label-cell">
								{#if item.label}
									<span class="item-label">{item.label}</span>
								{/if}
								{#if item.model}
									<span class="item-model">[{item.model}]</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if text}
		<OutputBlock {text} label="risultato" />
	{/if}
</div>

<style>
	.job-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.job-table-wrap {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow-x: auto;
	}

	.job-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.job-table th {
		text-align: left;
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
		border-bottom: 1px solid var(--line);
		font-weight: 500;
	}

	.job-table td {
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	.job-table tr:last-child td {
		border-bottom: none;
	}

	.id-cell {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.agent-id-btn {
		background: none;
		border: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: var(--line);
		text-underline-offset: 2px;
	}

	.agent-id-btn:hover {
		color: var(--accent, var(--ink));
		text-decoration-color: currentColor;
	}

	.job-id-sub {
		margin-left: var(--space-1);
		color: var(--ink-faint);
	}

	.status-wrap {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.status-text {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-muted);
	}

	.status-faint {
		color: var(--ink-faint);
	}

	.dur-cell {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.label-cell {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.item-label {
		color: var(--ink-muted);
	}

	.item-model {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}
</style>
