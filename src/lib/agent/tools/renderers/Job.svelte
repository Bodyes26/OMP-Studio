<script lang="ts">
	// Renderer per `job` e operazioni sui processi/task asincroni.
	//
	// Cosa mostra:
	// - summary: operazione (`args.op` / `args.action`) e identificativo del
	//   job (`args.id`, `args.name` o lista `args.ids`).
	// - body: tabella `KeyValue` con i parametri della richiesta, elenco compatto
	//   dei job con stato, tipo, durata formattata (`formatDuration`) ed etichetta
	//   (se `details.jobs` e' presente), e blocco `OutputBlock` del risultato testuale.
	//
	// Comportamento quando `details` e' assente:
	// Il componente renderizza i parametri della richiesta da `args` e il testo
	// dell'esito da `resultText(result)`, omettendo la tabella strutturata dei job.

	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
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

	let { args, result, view }: ToolRenderProps = $props();

	const op = $derived(str(args.op) ?? str(args.action) ?? str(args.command) ?? '');
	const singleId = $derived(str(args.id) ?? str(args.jobId) ?? str(args.name) ?? '');
	const idsList = $derived(strList(args.ids));
	const targetIds = $derived(singleId ? [singleId] : idsList);

	const text = $derived(resultText(result));
	const details = $derived(asRecord(result?.details));

	interface JobEntry {
		id: string;
		status?: string;
		type?: string;
		label?: string;
		duration?: string;
		model?: string;
		jobText?: string;
	}

	const rawJobs = $derived.by(() => {
		if (details?.jobs) return recordList(details.jobs);
		if (Array.isArray(result?.details)) return recordList(result.details);
		return [];
	});

	const jobList = $derived.by<JobEntry[]>(() => {
		const out: JobEntry[] = [];
		for (const rec of rawJobs) {
			const jid = str(rec.id) ?? str(rec.jobId) ?? str(rec.name);
			if (!jid) continue;
			out.push({
				id: jid,
				status: str(rec.status) ?? str(rec.state),
				type: str(rec.type),
				label: str(rec.label) ?? str(rec.task),
				duration: formatDuration(num(rec.durationMs)),
				model: str(rec.resolvedModel) ?? str(rec.model),
				jobText: str(rec.resultText)
			});
		}
		return out;
	});

	const argRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (op) rows.push({ key: 'operazione', value: op });
		if (targetIds.length > 0) rows.push({ key: 'target', value: targetIds.join(', ') });
		const signal = str(args.signal);
		if (signal) rows.push({ key: 'segnale', value: signal });
		const timeout = num(args.timeout) ?? num(args.timeoutMs);
		if (timeout !== undefined) rows.push({ key: 'timeout', value: `${timeout}` });
		return rows;
	});
</script>

{#if view === 'summary'}
	<span class="summary-line">
		{#if op}
			<span class="op-badge">{op}</span>
		{/if}
		{#if targetIds.length > 0}
			<span class="job-id-preview">{targetIds.join(', ')}</span>
		{:else if jobList.length > 0}
			<span class="job-id-preview">{jobList.map((j) => j.id).join(', ')}</span>
		{:else if text}
			<span class="text-preview">{text.split('\n', 1)[0]}</span>
		{/if}
	</span>
{:else}
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
							<th>Stato</th>
							<th>Durata</th>
							<th>Dettagli</th>
						</tr>
					</thead>
					<tbody>
						{#each jobList as item (item.id)}
							<tr>
								<td class="id-cell">{item.id}</td>
								<td class="status-cell">
									{#if item.status}
										<span
											class="status-pill"
											class:completed={item.status === 'completed' || item.status === 'success'}
											class:failed={item.status === 'failed' || item.status === 'error'}
										>
											{item.status}
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
{/if}

<style>
	.summary-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}

	.op-badge {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-muted);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-1);
		flex-shrink: 0;
	}

	.job-id-preview {
		font-family: var(--font-mono);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.text-preview {
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.job-table-wrap {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.job-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
		font-family: var(--font-mono);
	}

	th {
		text-align: left;
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		color: var(--ink-faint);
		font-weight: normal;
		font-size: var(--text-xs);
		border-bottom: 1px solid var(--line);
	}

	td {
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--line);
		color: var(--ink-muted);
	}

	tr:last-child td {
		border-bottom: none;
	}

	.id-cell {
		color: var(--ink);
		font-weight: 500;
	}

	.status-pill {
		font-size: var(--text-xs);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink-muted);
	}

	.status-pill.completed {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.status-pill.failed {
		color: var(--brand);
		background: var(--brand-ink);
	}

	.status-faint {
		color: var(--ink-faint);
	}

	.dur-cell {
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.label-cell {
		color: var(--ink-muted);
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-model {
		color: var(--ink-faint);
		margin-left: var(--space-1);
		font-size: var(--text-xs);
	}
</style>
