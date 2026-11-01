<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatusMark, { type StatusMarkType } from '#lib/ui/StatusMark.svelte';
	import AgentLink from '../parts/AgentLink.svelte';
	import JsonBlock from '../parts/JsonBlock.svelte';
	import OutputBlock from '../parts/OutputBlock.svelte';
	import { formatDuration, resultText, type ToolRenderProps } from '../types';
	import { waitActivities, waitMessage } from '../wait';

	let { result, running = false, waitContext }: ToolRenderProps = $props();
	const items = $derived(waitActivities(result?.details, waitContext));
	const message = $derived(waitMessage(result?.details));
	const text = $derived(resultText(result));

	function statusMark(status: string): StatusMarkType {
		switch (status) {
			case 'running': case 'in_progress': case 'starting': return 'running';
			case 'completed': return 'completed';
			case 'failed': return 'failed';
			case 'cancelled': case 'aborted': return 'aborted';
			default: return 'pending';
		}
	}
	function statusLabel(status: string): string {
		switch (status) {
			case 'running': case 'in_progress': case 'starting': return m.task_row_status_running();
			case 'completed': return m.task_row_status_completed();
			case 'failed': return m.task_row_status_failed();
			case 'cancelled': case 'aborted': return m.task_row_status_aborted();
			case 'pending': return m.task_row_status_pending();
			default: return m.tool_wait_status_unknown();
		}
	}
</script>

<div class="wait-body">
	<p class="wait-note">{m.tool_wait_first_completion_note()}</p>
	{#if message}
		<section>
			<h4>{m.tool_wait_status_peer_message({ from: message.from })}</h4>
			{#if message.body}<pre class="message-text">{message.body}</pre>{/if}
		</section>
	{/if}
	{#if items.some((item) => !item.observed)}
		<p class="wait-note">{m.tool_wait_context_note()}</p>
	{/if}
	{#each ['agent', 'job'] as kind}
		{@const group = items.filter((item) => item.kind === kind)}
		{#if group.length > 0}
			<section>
				<h4>{kind === 'agent' ? m.tool_wait_section_subagents() : m.tool_wait_section_jobs()}</h4>
				{#each group as item (item.id)}
					{#if item.progress}
						<AgentLink progress={item.progress} />
					{:else}
						<div class="activity-row">
							<StatusMark status={statusMark(item.status)} label={statusLabel(item.status)} active={running} />
							<span class="activity-label">{item.label}</span>
							<span class="activity-meta">{statusLabel(item.status)}{#if item.durationMs !== undefined} · {formatDuration(item.durationMs)}{/if}</span>
						</div>
					{/if}
					{#if item.activity}<p class="activity-detail">{item.activity}</p>{/if}
					{#if item.error}<p class="activity-error">{item.error}</p>{/if}
					{#if item.exitCode !== undefined && item.exitCode !== 0}<p class="activity-error">exit {item.exitCode}</p>{/if}
					{#if item.output}<OutputBlock text={item.output} />{/if}
				{/each}
			</section>
		{/if}
	{/each}
	{#if result?.isError}<p class="activity-error" role="status">{m.tool_wait_status_error()}</p>{/if}
	{#if text}<OutputBlock {text} />{/if}
	{#if result?.details}
		<details>
			<summary>{m.tool_wait_section_output()}</summary>
			<JsonBlock value={result.details} />
		</details>
	{/if}
</div>

<style>
	.wait-body, section { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
	.wait-body { gap: var(--space-3); }
	.wait-note { margin: 0; color: var(--ink-muted); font-size: var(--text-caption); }
	h4 { margin: 0; font-size: var(--text-sm); font-weight: 500; color: var(--ink); }
	.activity-row { display: flex; gap: var(--space-2); align-items: center; min-width: 0; }
	.activity-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.activity-meta { color: var(--ink-faint); font-size: var(--text-caption); font-variant-numeric: tabular-nums; }
	.activity-detail { margin: 0; color: var(--ink-muted); overflow-wrap: anywhere; }
	.activity-error { margin: 0; color: var(--danger); overflow-wrap: anywhere; }
	.message-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-ui); }
	details { color: var(--ink-muted); }
	summary { cursor: pointer; font-size: var(--text-caption); }
</style>
