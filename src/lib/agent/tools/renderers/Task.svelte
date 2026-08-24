<!--
  Renderer per il tool `task`.

  Rappresenta il fan-out di subagent coordinati dal modello principale.
  Nel sommario mostra il conteggio dei subagent per stato. Nel corpo
  visualizza ogni subagent tramite AgentLink cliccabile (che apre il
  cassetto del transcript corrispondente), l'eventuale stato asincrono del job
  e i blocchi di testo dei risultati prodotti al completamento.
-->
<script lang="ts">
	import AgentLink from '../parts/AgentLink.svelte';
	import CountBadge from '../parts/CountBadge.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import type { AgentProgress } from '../../wire';
	import {
		asRecord,
		countLabel,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';

	let { args, result, view }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));
	const asyncObj = $derived(asRecord(details?.async));
	const asyncState = $derived(str(asyncObj?.state));
	const asyncJobId = $derived(str(asyncObj?.jobId));

	const progressList = $derived.by<AgentProgress[]>(() => {
		const raw = recordList(details?.progress);
		return raw.map((entry) => {
			const rawStatus = str(entry.status);
			let status: AgentProgress['status'] = undefined;
			if (
				rawStatus === 'pending' ||
				rawStatus === 'running' ||
				rawStatus === 'completed' ||
				rawStatus === 'failed' ||
				rawStatus === 'aborted'
			) {
				status = rawStatus;
			}
			return {
				index: num(entry.index),
				id: str(entry.id),
				agent: str(entry.agent),
				agentSource: str(entry.agentSource),
				modelRole: str(entry.modelRole),
				resolvedModel: str(entry.resolvedModel),
				status,
				task: str(entry.task),
				assignment: str(entry.assignment),
				description: str(entry.description),
				lastIntent: str(entry.lastIntent),
				toolCount: num(entry.toolCount),
				requests: num(entry.requests),
				tokens: num(entry.tokens),
				cost: num(entry.cost),
				durationMs: num(entry.durationMs)
			};
		});
	});

	const stats = $derived.by(() => {
		let total = progressList.length;
		let running = 0;
		let completed = 0;
		let failed = 0;
		let pending = 0;
		for (const p of progressList) {
			if (p.status === 'running') running++;
			else if (p.status === 'completed') completed++;
			else if (p.status === 'failed' || p.status === 'aborted') failed++;
			else pending++;
		}
		return { total, running, completed, failed, pending };
	});

	const summaryBadge = $derived.by(() => {
		if (stats.total === 0) {
			// `args.tasks` e' la forma normale, ma il tool accetta anche `args.subagents`
			// e la forma singola `args.task`/`args.agent` senza wrapper array.
			const rawList = Array.isArray(args.tasks)
				? args.tasks
				: Array.isArray(args.subagents)
					? args.subagents
					: undefined;
			if (rawList !== undefined) {
				return countLabel(rawList.length, 'subagent assegnato', 'subagent assegnati');
			}
			if (str(args.task) || str(args.agent)) {
				return countLabel(1, 'subagent assegnato', 'subagent assegnati');
			}
			return undefined;
		}
		const parts: string[] = [];
		parts.push(countLabel(stats.total, 'subagent', 'subagent'));
		if (stats.running > 0) parts.push(`${stats.running} in corso`);
		if (stats.completed > 0) parts.push(`${stats.completed} completati`);
		if (stats.failed > 0) parts.push(`${stats.failed} falliti`);
		return parts.join(' · ');
	});

	const resultTexts = $derived.by<string[]>(() => {
		const rawResults = details?.results;
		if (!Array.isArray(rawResults)) return [];
		const texts: string[] = [];
		for (const item of rawResults) {
			if (typeof item === 'string' && item.length > 0) {
				texts.push(item);
			} else {
				const rec = asRecord(item);
				const t = str(rec?.text) ?? str(rec?.output) ?? str(rec?.result);
				if (t) texts.push(t);
			}
		}
		return texts;
	});

	const fallbackResult = $derived(resultText(result));
</script>

{#if view === 'summary'}
	<div class="task-summary">
		{#if summaryBadge}
			<CountBadge text={summaryBadge} />
		{/if}
		{#if asyncState}
			<CountBadge text={`async: ${asyncState}`} muted />
		{/if}
	</div>
{:else}
	<div class="task-body">
		{#if asyncState || asyncJobId}
			<div class="async-banner">
				<span class="async-label">Job asincrono:</span>
				{#if asyncJobId}<span class="async-id">{asyncJobId}</span>{/if}
				{#if asyncState}<span class="async-state">({asyncState})</span>{/if}
			</div>
		{/if}

		{#if progressList.length > 0}
			<div class="agent-list">
				{#each progressList as agentProgress, idx (agentProgress.id ?? idx)}
					<AgentLink progress={agentProgress} />
				{/each}
			</div>
		{/if}

		{#if resultTexts.length > 0}
			<div class="results-section">
				{#each resultTexts as resText, resIdx (resIdx)}
					<OutputBlock text={resText} label={`risultato ${resIdx + 1}`} />
				{/each}
			</div>
		{:else if fallbackResult && progressList.length === 0}
			<OutputBlock text={fallbackResult} label="risultato task" />
		{/if}
	</div>
{/if}

<style>
	.task-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.task-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.async-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		padding: 2px var(--space-1);
		background: var(--bg-sunken);
		border-radius: var(--radius-sm);
	}

	.async-label {
		color: var(--ink-muted);
	}

	.async-id {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.agent-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.results-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
