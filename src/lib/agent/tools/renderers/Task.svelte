<!--
  Renderer per il tool `task`.

  Rappresenta il fan-out di subagent coordinati dal modello principale.
  Visualizza ogni subagent tramite AgentLink integrato con TaskRow (che espande
  la disclosure dei dettagli con azione per aprire il transcript),
  l'eventuale stato asincrono del job e i blocchi di testo dei risultati.
-->
<script lang="ts">
	import AgentLink from '../parts/AgentLink.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import {
		asRecord,
		num,
		recordList,
		resultText,
		str,
		type ToolRenderProps
	} from '../types';
	import type { AgentProgress } from '../../wire';

	let { args, result }: ToolRenderProps = $props();

	const details = $derived(asRecord(result?.details));

	const progressList = $derived.by<AgentProgress[]>(() => {
		const raw = recordList(details?.tasks);
		if (raw.length === 0) {
			const tasksArg = recordList(args.tasks);
			if (tasksArg.length > 0) {
				return tasksArg.map((t, idx) => ({
					id: str(t.id),
					agent: str(t.agent) ?? str(t.name) ?? `subagent-${idx + 1}`,
					status: 'running',
					index: idx
				}));
			}
			return [];
		}

		return raw.map((t, idx) => {
			const id = str(t.id);
			const agent = str(t.agent) ?? str(t.name) ?? (id ? `subagent-${id.slice(0, 8)}` : `subagent-${idx + 1}`);
			const status = (str(t.status) ?? 'completed') as AgentProgress['status'];
			const durationMs = num(t.durationMs) ?? num(t.duration);
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
			const tokens = num(t.tokens);
			const cost = num(t.cost);
			const modelRole = str(t.modelRole);
			const resolvedModel = str(t.resolvedModel);
			const lastIntent = str(t.lastIntent);

			return {
				id,
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
				index: num(t.index) ?? idx
			};
		});
	});

	const resultTexts = $derived.by<string[]>(() => {
		const raw = recordList(details?.tasks);
		const texts: string[] = [];
		for (const t of raw) {
			const out = str(t.output) ?? str(t.result);
			if (out) texts.push(out);
		}
		return texts;
	});

	const fallbackResult = $derived(resultText(result));
	const asyncState = $derived(str(details?.state) ?? str(args.state));
	const asyncJobId = $derived(str(details?.jobId) ?? str(args.jobId));
</script>

<div class="task-body">
	{#if asyncState || asyncJobId}
		<div class="async-banner">
			<span class="async-label">Job asincrono:</span>
			{#if asyncJobId}<span class="async-id">{asyncJobId}</span>{/if}
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
