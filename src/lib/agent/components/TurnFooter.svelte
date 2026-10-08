<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Piè del turno dell'agente (Gate R32 - C07).
	// Mostrato a turno concluso (da messaggio utente ad agent_end):
	// Copia testo dell'assistente, N chiamate tool, durata, modello, costo totale.
	import { IconCopy, IconCheck, IconFork } from '$lib/icons';
	import { agentUiHooks } from '../ui-context';
	import Tooltip from '$lib/ui/Tooltip.svelte';

	export interface TurnFooterData {
		assistantText: string;
		toolCallsCount: number;
		durationMs: number;
		model?: string;
		cost?: number;
		subagentCost?: number;
		/** Messaggio utente che apre il turno (id del transcript), se c'e'. */
		userTranscriptId?: number | null;
		/** `messageTs` dell'ultima risposta del turno: lega il turno al file di omp. */
		assistantTs?: number | null;
	}

	let { data }: { data: TurnFooterData } = $props();

	const branch = agentUiHooks().branch;
	const canBranch = $derived(branch ? branch.canBranch() : false);
	const branchTooltip = $derived(
		branch && !canBranch ? (branch.blockedReason() ?? m.branch_action_fork_after_hint()) : m.branch_action_fork_after_hint()
	);

	function forkAfterTurn() {
		if (!branch || !canBranch) return;
		branch.afterTurn({ userTranscriptId: data.userTranscriptId ?? null, assistantTs: data.assistantTs ?? null });
	}

	let copied = $state(false);
	let copyTimer: number | null = null;

	async function copyTurnText() {
		if (!data.assistantText) return;
		try {
			await navigator.clipboard.writeText(data.assistantText);
			copied = true;
			if (copyTimer !== null) clearTimeout(copyTimer);
			copyTimer = window.setTimeout(() => {
				copied = false;
				copyTimer = null;
			}, 1500);
		} catch {
			// fallimento copia ignorato
		}
	}

	function formatDuration(ms: number): string {
		const totalSec = Math.max(1, Math.round(ms / 1000));
		if (totalSec < 60) {
			return `${totalSec} s`;
		}
		const mins = Math.floor(totalSec / 60);
		const secs = totalSec % 60;
		return `${mins}m ${secs}s`;
	}

	function formatCost(cost: number | undefined): string | null {
		if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return null;
		return `$${cost.toFixed(4)}`;
	}

	const durationLabel = $derived(data.durationMs > 0 ? formatDuration(data.durationMs) : null);
	const ownCost = $derived(data.cost ?? 0);
	const subCost = $derived(data.subagentCost ?? 0);
	const totalCost = $derived(ownCost + subCost);
	const costLabel = $derived(formatCost(totalCost > 0 ? totalCost : data.cost));
	const costTooltip = $derived(
		subCost > 0
			? m.chat_session_cost_split({
					own: `$${ownCost.toFixed(4)}`,
					subagents: `$${subCost.toFixed(4)}`
				})
			: undefined
	);
	const toolCallsLabel = $derived(
		data.toolCallsCount > 0
			? (data.toolCallsCount === 1
				? m.chat_v2_turn_call_singular()
				: m.chat_v2_turn_calls_count({ count: data.toolCallsCount }))
			: null
	);
</script>

<div class="turn-footer rv-blur" style="--dur: 400ms; --blur: 4px;">
	{#if data.assistantText}
		<button
			type="button"
			class="copy-btn"
			onclick={copyTurnText}
			title={copied ? m.chat_v2_turn_copied() : m.chat_v2_turn_copy()}
		>
			<span class="icon" aria-hidden="true">
				{#if copied}
					<IconCheck />
				{:else}
					<IconCopy />
				{/if}
			</span>
			<span>{copied ? m.chat_v2_turn_copied() : m.chat_v2_turn_copy()}</span>
		</button>
	{/if}

	{#if branch}
		<Tooltip text={branchTooltip} placement="top" offset={4}>
			<button
				type="button"
				class="copy-btn"
				onclick={forkAfterTurn}
				aria-disabled={canBranch ? undefined : 'true'}
				class:is-disabled={!canBranch}
			>
				<span class="icon" aria-hidden="true"><IconFork /></span>
				<span>{m.branch_action_fork_here()}</span>
			</button>
		</Tooltip>
	{/if}

	<div class="meta-row">
		{#if toolCallsLabel}
			<span class="meta-item">{toolCallsLabel}</span>
		{/if}
		{#if durationLabel}
			{#if toolCallsLabel}<span class="sep">·</span>{/if}
			<span class="meta-item">{durationLabel}</span>
		{/if}
		{#if data.model}
			{#if toolCallsLabel || durationLabel}<span class="sep">·</span>{/if}
			<span class="meta-item model">{data.model}</span>
		{/if}
		{#if costLabel}
			{#if toolCallsLabel || durationLabel || data.model}<span class="sep">·</span>{/if}
			<span class="meta-item cost" title={costTooltip}>{costLabel}</span>
		{/if}
	</div>
</div>

<style>
	.turn-footer {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		padding: var(--space-1) 0;
		font-size: var(--text-xs);
		color: var(--ink-faint);
		user-select: none;
	}

	.copy-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.copy-btn:hover {
		background: var(--bg-hover);
		color: var(--ink-muted);
	}

	.copy-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.copy-btn.is-disabled {
		opacity: 0.5;
		cursor: default;
	}

	.copy-btn.is-disabled:hover {
		background: transparent;
		color: var(--ink-faint);
	}

	.copy-btn .icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
	}

	.meta-row {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--ink-faint);
		font-variant-numeric: tabular-nums;
	}

	.sep {
		opacity: 0.5;
	}

	.model {
		font-family: var(--font-mono);
	}

	.cost {
		font-family: var(--font-mono);
	}
</style>
