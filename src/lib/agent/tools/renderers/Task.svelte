<!--
  Renderer per il tool `task`.

  Rappresenta il fan-out di subagent coordinati dal modello principale.
  Visualizza ogni subagent tramite AgentLink integrato con TaskRow (che espande
  la disclosure dei dettagli con azione per aprire il transcript),
  l'eventuale stato asincrono del job e i blocchi di testo dei risultati.
-->
<script lang="ts">
	import { agentUiHooks } from '../../ui-context';
	import StatusMark, { type StatusMarkType } from '$lib/ui/StatusMark.svelte';
	import AgentLink from '../parts/AgentLink.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		bool,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';
	import type { AgentProgress } from '../../wire';

	let { args, result }: ToolRenderProps = $props();

	const hooks = agentUiHooks();
	const details = $derived(asRecord(result?.details));
	const asyncMeta = $derived(asRecord(details?.async));

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
			case 'aborted':
			case 'cancelled':
				return 'aborted';
			default:
				return 'pending';
		}
	}

	const progressList = $derived.by<AgentProgress[]>(() => {
		const progressRaw = recordList(details?.progress);
		const resultsRaw = recordList(details?.results);
		const legacyTasks = recordList(details?.tasks);
		const raw =
			progressRaw.length > 0
				? progressRaw
				: resultsRaw.length > 0
					? resultsRaw
					: legacyTasks;

		if (raw.length === 0) {
			const tasksArg = recordList(args.tasks);
			if (tasksArg.length > 0) {
				return tasksArg.map((t, idx) => ({
					id: str(t.id) ?? str(t.name),
					agent: str(t.agent) ?? str(t.name) ?? `subagent-${idx + 1}`,
					status: 'running',
					task: str(t.task),
					index: idx
				}));
			}
			if (str(args.task) || str(args.name)) {
				return [
					{
						id: str(args.name),
						agent: str(args.agent) ?? str(args.name) ?? 'task',
						status: 'running',
						task: str(args.task),
						index: 0
					}
				];
			}
			return [];
		}

		return raw.map((t, idx) => {
			const id = str(t.agentId) ?? str(t.id);
			const jobId = str(t.jobId);
			const matchedResult =
				resultsRaw.find((r) => (id && str(r.id) === id) || num(r.index) === (num(t.index) ?? idx)) ??
				undefined;
			const agent =
				str(t.agent) ??
				str(matchedResult?.agent) ??
				str(t.name) ??
				(id ? `subagent-${id.slice(0, 8)}` : `subagent-${idx + 1}`);

			const explicitStatus = str(t.status);
			let status: AgentProgress['status'] = 'completed';
			if (
				explicitStatus === 'pending' ||
				explicitStatus === 'running' ||
				explicitStatus === 'completed' ||
				explicitStatus === 'failed' ||
				explicitStatus === 'aborted'
			) {
				status = explicitStatus;
			} else if (explicitStatus === 'cancelled') {
				status = 'aborted';
			} else {
				const resRec = matchedResult ?? t;
				const aborted = bool(resRec.aborted) === true;
				const exitCode = num(resRec.exitCode);
				const hasError = Boolean(str(resRec.error));
				status = aborted
					? 'aborted'
					: (exitCode !== undefined && exitCode !== 0) || hasError
						? 'failed'
						: 'completed';
			}

			const durationMs =
				num(t.durationMs) ?? num(t.duration) ?? num(matchedResult?.durationMs);
			const toolCount = num(t.toolCount);
			let recentTools: { tool?: string; args?: string; endMs?: number }[] | undefined;
			if (Array.isArray(t.recentTools)) {
				recentTools = [];
				for (const item of t.recentTools) {
					if (typeof item === 'string') {
						recentTools.push({ tool: item });
					} else {
						const rec = asRecord(item);
						if (rec) {
							recentTools.push({
								tool: str(rec.tool),
								args: str(rec.args),
								endMs: num(rec.endMs)
							});
						}
					}
				}
			}
			const tokens = num(t.tokens) ?? num(matchedResult?.tokens);
			const usageCost = num(asRecord(asRecord(t.usage ?? matchedResult?.usage)?.cost)?.total);
			const cost = num(t.cost) ?? usageCost;
			const modelRole = str(t.modelRole) ?? str(matchedResult?.modelRole);
			const resolvedModel = str(t.resolvedModel) ?? str(matchedResult?.resolvedModel);
			const lastIntent = str(t.lastIntent) ?? str(matchedResult?.lastIntent);
			const task = str(t.task) ?? str(matchedResult?.task);
			const assignment = str(t.assignment) ?? str(matchedResult?.assignment);
			const description = str(t.description) ?? str(matchedResult?.description);

			return {
				id,
				jobId,
				agent,
				status,
				durationMs,
				toolCount,
				recentTools,
				tokens,
				cost,
				modelRole,
				resolvedModel,
				lastIntent,
				task,
				assignment,
				description,
				index: num(t.index) ?? idx
			};
		});
	});

	const resultTexts = $derived.by<string[]>(() => {
		const resultsRaw = recordList(details?.results);
		const raw = resultsRaw.length > 0 ? resultsRaw : recordList(details?.tasks);
		const texts: string[] = [];
		for (const t of raw) {
			const out = str(t.output) ?? str(t.result) ?? str(t.error);
			if (out) texts.push(out);
		}
		return texts;
	});

	const fallbackResult = $derived(resultText(result));
	const asyncState = $derived(
		str(asyncMeta?.state) ?? str(details?.state) ?? str(args.state)
	);
	const asyncJobId = $derived(
		str(asyncMeta?.jobId) ?? str(details?.jobId) ?? str(args.jobId)
	);
	const asyncAgentId = $derived(
		str(asyncMeta?.agentId) ??
			str(details?.agentId) ??
			progressList.find((p) => asyncJobId && (p.jobId === asyncJobId || p.id === asyncJobId))?.id ??
			(progressList.length === 1 ? progressList[0].id : undefined) ??
			asyncJobId
	);
</script>

<div class="task-body">
	{#if asyncState || asyncJobId}
		<div class="async-banner">
			{#if asyncState}
				<StatusMark status={toStatusMarkStatus(asyncState)} />
			{/if}
			<span class="async-label">Job asincrono:</span>
			{#if asyncAgentId}
				<button
					type="button"
					class="async-link-btn"
					onclick={() => hooks.openSubagent(asyncAgentId)}
				>
					{asyncAgentId}
				</button>
				{#if asyncJobId && asyncJobId !== asyncAgentId}
					<span class="async-id">({asyncJobId})</span>
				{/if}
			{:else if asyncJobId}
				<span class="async-id">{asyncJobId}</span>
			{/if}
			{#if asyncState}<span class="async-state">({asyncState})</span>{/if}
		</div>
	{/if}

	{#if progressList.length > 0}
		<div class="agent-list" role="list">
			{#each progressList as agentProgress, idx (agentProgress.id ?? agentProgress.index ?? idx)}
				<div
					class="agent-item"
					role="listitem"
					style:--stagger-delay={`${Math.min(idx, 8) * 30}ms`}
				>
					<AgentLink progress={agentProgress} index={idx + 1} />
				</div>
			{/each}
		</div>
	{/if}

	{#if resultTexts.length > 0}
		<div class="results-section">
			{#each resultTexts as textItem, idx (idx)}
				<OutputBlock text={textItem} label={`risultato subagent ${idx + 1}`} maxLines={12} />
			{/each}
		</div>
	{:else if fallbackResult && progressList.length === 0}
		<OutputBlock text={fallbackResult} label="risultato task" />
	{/if}
</div>

<style>
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
		font-size: var(--text-caption);
		color: var(--ink-faint);
		padding: 2px var(--space-1);
		border-left: 2px solid var(--line);
	}

	.async-label {
		color: var(--ink-muted);
	}

	.async-id {
		font-family: var(--font-mono);
		color: var(--ink);
	}

	.async-link-btn {
		background: none;
		border: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: inherit;
		color: var(--ink);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: var(--line);
		text-underline-offset: 2px;
	}

	.async-link-btn:hover {
		color: var(--accent, var(--ink));
		text-decoration-color: currentColor;
	}

	.agent-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}

	.agent-item {
		animation: task-stagger var(--dur-row) var(--ease-reveal) var(--stagger-delay, 0ms) both;
	}

	.agent-item + .agent-item {
		border-top: 1px solid var(--line);
	}

	@keyframes task-stagger {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.agent-item {
			animation: none;
		}
	}

	:root[data-animations="false"] .agent-item {
		animation: none;
	}

	.results-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
</style>
