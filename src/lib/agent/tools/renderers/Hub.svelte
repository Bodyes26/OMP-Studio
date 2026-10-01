<!--
  Renderer per il tool `hub`.

  Nel corpo espanso mostra le righe dei singoli job con StatusMark condiviso (Outcome-Only Color Rule),
  modello e durata tabulari, la tabella KeyValue degli argomenti e l'output testuale in OutputBlock.
-->
<script lang="ts">
	import KeyValue from '../parts/KeyValue.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import StatusMark, { type StatusMarkType } from '$lib/ui/StatusMark.svelte';
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

	const argsRows = $derived.by(() => {
		const rows: { key: string; value: string }[] = [];
		if (op) rows.push({ key: 'Operazione', value: op });
		if (name) rows.push({ key: 'Nome', value: name });
		if (to) rows.push({ key: 'A', value: to });
		if (from) rows.push({ key: 'Da', value: from });
		if (message) rows.push({ key: 'Messaggio', value: message });
		if (ids.length > 0) rows.push({ key: 'ID', value: ids.join(', ') });
		if (signal) rows.push({ key: 'Segnale', value: signal });
		if (keys.length > 0) rows.push({ key: 'Chiavi', value: keys.join(', ') });
		if (stdinText) rows.push({ key: 'Stdin', value: stdinText });
		return rows;
	});
</script>

<div class="hub-body">
	{#if jobs.length > 0}
		<div class="jobs-list">
			{#each jobs as job, index (index)}
				{@const jobId = str(job.id) ?? `job-${index}`}
				{@const jobType = str(job.type) ?? 'task'}
				{@const jobStatus = str(job.status) ?? 'pending'}
				{@const model = str(job.resolvedModel)}
				{@const dur = formatDuration(num(job.durationMs))}
				{@const jobResText = str(job.resultText)}

				<div class="job-card">
					<div class="job-header">
						<span class="glyph"><StatusMark status={toStatusMarkStatus(jobStatus)} /></span>
						<span class="job-id">{jobId}</span>
						<span class="job-type">{jobType}</span>
						{#if model}
							<span class="job-model">[{model}]</span>
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

<style>
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
		border-left: 2px solid var(--line);
	}

	.job-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.job-id {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.job-type {
		font-family: var(--font-ui);
		font-size: var(--text-caption);
		color: var(--ink-faint);
	}

	.job-model {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
	}

	.job-duration {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.job-output {
		padding-left: var(--space-3);
	}
</style>
