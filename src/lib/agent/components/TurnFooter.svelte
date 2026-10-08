<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Piè del turno dell'agente (Gate R32 - C07).
	// Mostrato a turno concluso (da messaggio utente ad agent_end):
	// Copia testo dell'assistente, N chiamate tool, durata, modello, costo totale.
	// Con modifiche ai file, il bilancio `+N −M` del turno: il clic apre il
	// diff del primo file toccato (lo stesso diff con HEAD del pannello Git).
	import { IconCopy, IconCheck, IconFork } from '$lib/icons';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { agentUiHooks } from '../ui-context';
	import type { TurnDiffStats } from '../turnDiff';

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
		/** Righe aggiunte/rimosse dalle card edit/write del turno. */
		diff?: TurnDiffStats;
	}

	let { data }: { data: TurnFooterData } = $props();

	const hooks = agentUiHooks();
	const branch = hooks.branch;
	const canBranch = $derived(branch ? branch.canBranch() : false);
	const branchTooltip = $derived(
		branch && !canBranch ? (branch.blockedReason() ?? m.branch_action_fork_after_hint()) : m.branch_action_fork_after_hint()
	);

	function forkAfterTurn() {
		if (!branch || !canBranch) return;
		branch.afterTurn({ userTranscriptId: data.userTranscriptId ?? null, assistantTs: data.assistantTs ?? null });
	}

	const firstFile = $derived(data.diff?.files[0] ?? null);
	const firstFileName = $derived(firstFile ? (firstFile.split(/[\\/]/).pop() ?? firstFile) : '');

	function openTurnDiff() {
		if (!firstFile) return;
		if (hooks.openDiff) hooks.openDiff(firstFile);
		else hooks.openFile(firstFile);
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
		{#if data.diff}
			{#if firstFile}
				<Tooltip text={m.chat_v2_turn_diff_tooltip({ file: firstFileName })} placement="top" offset={6}>
					<button
						type="button"
						class="diff-badge"
						aria-label={m.chat_v2_turn_diff_aria({
							added: data.diff.added,
							removed: data.diff.removed,
							files: data.diff.files.length,
							file: firstFileName
						})}
						onclick={openTurnDiff}
					>
						<span class="diff-add">+{data.diff.added}</span>
						<span class="diff-del">−{data.diff.removed}</span>
					</button>
				</Tooltip>
			{:else}
				<span class="diff-badge static">
					<span class="diff-add">+{data.diff.added}</span>
					<span class="diff-del">−{data.diff.removed}</span>
				</span>
			{/if}
			{#if toolCallsLabel || durationLabel || data.model || costLabel}<span class="sep">·</span>{/if}
		{/if}
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

	/* Bilancio del turno: stessi colori del `+N/−N` delle righe di traccia,
	   mono tabulare; come pulsante solo un fondo in hover, niente pillola. */
	.diff-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 4px;
		margin: 0 -2px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.diff-badge.static {
		cursor: default;
	}

	button.diff-badge:hover {
		background: var(--bg-hover);
	}

	button.diff-badge:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}

	.diff-add {
		color: var(--success);
	}

	.diff-del {
		color: var(--danger);
	}

	.model {
		font-family: var(--font-mono);
	}

	.cost {
		font-family: var(--font-mono);
	}
</style>
