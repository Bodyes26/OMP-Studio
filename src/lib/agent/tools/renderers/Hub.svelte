<!--
  Renderer per il tool `hub`.

  Forma attesa di `details` (da `ricerca/TOOL-DETAILS.md`):
  `op` (string), `jobs` (array di oggetti con `id`, `type`, `status`, `label`,
  `durationMs`, `resolvedModel`, `resultText`).
  Per operazioni di messaggistica: `receipts`, `waited`, `inbox`, `peers`.
  Per operazioni di processo: `daemon`, `daemons`, `state`, `cursor`.

  Comportamento quando `details` manca o e' incompleto:
  Mostra `details.op` o `args.op` nel sommario, assieme al conteggio dei job per stato
  o ai destinatari del messaggio. Nel corpo mostra le righe dei singoli job con stato,
  modello e durata (piu' OutputBlock per il resultText del job), oppure la tabella
  KeyValue degli argomenti e l'output testuale in OutputBlock per messaggi e processi.
-->
<script lang="ts">
	import CountBadge from '../parts/CountBadge.svelte';
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		countLabel,
		formatDuration,
		num,
		recordList,
		resultText,
		str,
		strList,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const op = $derived(str(details?.op) ?? str(args.op) ?? 'hub');
	const jobs = $derived(recordList(details?.jobs));
	const text = $derived(resultText(result));

	const to = $derived(str(args.to) ?? str(details?.to));
	const from = $derived(str(args.from) ?? str(details?.from));
	const message = $derived(str(args.message));
	const name = $derived(str(args.name));
	const ids = $derived(strList(args.ids));
	const stdinText = $derived(str(args.text));
	const signal = $derived(str(args.signal));
	const keys = $derived(strList(args.keys));

	const STATUS_GLYPH: Record<string, string> = {
		pending: '○',
		running: '●',
		completed: '✓',
		failed: '✗',
		aborted: '⊘'
	};

	const jobCounts = $derived.by(() => {
		let completed = 0;
		let running = 0;
		let failed = 0;
		for (const j of jobs) {
			const s = str(j.status);
			if (s === 'completed') completed++;
			else if (s === 'running' || s === 'pending') running++;
			else if (s === 'failed' || s === 'aborted') failed++;
		}
		return { completed, running, failed, total: jobs.length };
	});

	const summaryJobLabel = $derived.by(() => {
		if (jobCounts.total === 0) return undefined;
		const parts: string[] = [];
		if (jobCounts.completed > 0) {
			parts.push(countLabel(jobCounts.completed, 'completato', 'completati'));
		}
		if (jobCounts.running > 0) {
			parts.push(countLabel(jobCounts.running, 'in corso', 'in corso'));
		}
		if (jobCounts.failed > 0) {
			parts.push(countLabel(jobCounts.failed, 'fallito', 'falliti'));
		}
		return parts.length > 0 ? parts.join(', ') : countLabel(jobCounts.total, 'job', 'job');
	});

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		rows.push({ key: 'Operazione', value: op });
		if (to) rows.push({ key: 'Destinatario', value: to });
		if (from) rows.push({ key: 'Mittente', value: from });
		if (name) rows.push({ key: 'Processo', value: name });
		if (ids.length > 0) rows.push({ key: 'Job IDs', value: ids.join(', ') });
		if (message) rows.push({ key: 'Messaggio', value: message });
		if (stdinText) rows.push({ key: 'Testo stdin', value: stdinText });
		if (signal) rows.push({ key: 'Segnale', value: signal });
		if (keys.length > 0) rows.push({ key: 'Tasti', value: keys.join(', ') });
		return rows;
	});
</script>

{#if view === 'summary'}
	<div class="hub-summary">
		<span class="op-tag">{op}</span>
		{#if summaryJobLabel}
			<CountBadge text={summaryJobLabel} />
		{:else if to}
			<span class="target-text">a {to}{message ? ` · ${message}` : ''}</span>
		{:else if name}
			<span class="target-text">processo: {name}</span>
		{/if}
	</div>
{:else}
	<div class="hub-body">
		{#if jobs.length > 0}
			<div class="jobs-list">
				{#each jobs as job, index (index)}
					{@const jobId = str(job.id) ?? `job-${index}`}
					{@const jobType = str(job.type) ?? 'task'}
					{@const jobStatus = str(job.status) ?? 'pending'}
					{@const glyph = STATUS_GLYPH[jobStatus] ?? '○'}
					{@const model = str(job.resolvedModel)}
					{@const dur = formatDuration(num(job.durationMs))}
					{@const jobResText = str(job.resultText)}

					<div class="job-card" class:failed={jobStatus === 'failed' || jobStatus === 'aborted'} class:running={jobStatus === 'running'}>
						<div class="job-header">
							<span class="glyph">{glyph}</span>
							<span class="job-id">{jobId}</span>
							<span class="job-type">{jobType}</span>
							{#if model}
								<span class="job-model">{model}</span>
							{/if}
							{#if dur}
								<span class="job-duration">{dur}</span>
							{/if}
						</div>
						{#if jobResText}
							<div class="job-output">
								<OutputBlock text={jobResText} label={`risultato ${jobId}`} maxLines={8} />
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if argsRows.length > 0}
			<KeyValue rows={argsRows} />
		{/if}

		{#if text}
			<OutputBlock {text} label="risultato hub" />
		{/if}
	</div>
{/if}

<style>
	.hub-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.op-tag {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.target-text {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		user-select: text;
	}

	.hub-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.job-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
	}

	.job-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.glyph {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.running .glyph {
		color: var(--brand);
		animation: state-pulse var(--dur-pulse) var(--ease-in-out) infinite;
	}

	.failed .glyph {
		color: var(--brand-ink);
	}

	.job-id {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.job-type,
	.job-model,
	.job-duration {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	.job-duration {
		margin-left: auto;
		font-family: var(--font-mono);
	}

	.job-output {
		margin-top: 2px;
	}
</style>
