<script lang="ts">
	import { automationsStore } from '#lib/automations/store.svelte.ts';
	import { t, formatDateTime } from '#lib/automations/i18n.ts';
	import type { AutomationOccurrence } from '#lib/automations/types.ts';
	import AutomationOccurrenceDetail from './AutomationOccurrenceDetail.svelte';
	import { IconCheck, IconWarning, IconPlay, IconStop, IconChevronRight } from '#lib/icons.ts';

	interface Props {
		automationId?: string;
		selectedRunId?: string | null;
		onSelectRun?: (runId: string | null) => void;
		onOpenSession?: (sessionId: string) => void;
	}

	let { automationId, selectedRunId = null, onSelectRun, onOpenSession }: Props = $props();

	const allRuns = $derived(automationsStore.snapshot?.runs || []);

	const filteredRuns = $derived(
		automationId ? allRuns.filter((r) => r.automationId === automationId) : allRuns
	);

	const selectedOccurrence = $derived(
		selectedRunId ? filteredRuns.find((r) => r.id === selectedRunId) || null : null
	);

	function getExecutionsSummary(occ: AutomationOccurrence): { success: number; failed: number; total: number } {
		const total = occ.executions.length;
		const success = occ.executions.filter((e) => e.state === 'completed').length;
		const failed = occ.executions.filter(
			(e) => e.state === 'error' || e.state === 'timeout' || e.state === 'interrupted'
		).length;
		return { success, failed, total };
	}
</script>

<div class="automation-history">
	{#if selectedOccurrence}
		<AutomationOccurrenceDetail
			occurrence={selectedOccurrence}
			onClose={() => onSelectRun?.(null)}
			{onOpenSession}
		/>
	{:else if filteredRuns.length === 0}
		<div class="empty-history text-xs">
			<span>Nessuna esecuzione registrata nello storico.</span>
		</div>
	{:else}
		<div class="runs-table-wrap">
			<table class="runs-table">
				<thead>
					<tr>
						<th>Stato</th>
						<th>Data e ora</th>
						<th>Motivo</th>
						<th>Destinatari</th>
						<th>Revisione</th>
						<th class="text-right">Azioni</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredRuns as run (run.id)}
						{@const summary = getExecutionsSummary(run)}
						<tr
							class="run-row"
							class:selected={selectedRunId === run.id}
							tabindex="0"
							role="button"
							onclick={() => onSelectRun?.(run.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelectRun?.(run.id);
								}
							}}
						>
							<td>
								<span class="status-pill status-{run.state}">
									{t(`exec_${run.state}` as any) || run.state}
								</span>
							</td>
							<td class="font-mono text-xs">
								{formatDateTime(run.scheduledAt || run.createdAt)}
							</td>
							<td class="text-xs">
								{#if run.reasons && run.reasons.length > 0}
									<span class="reason-badge">
										{t(`trigger_${run.reasons[0].kind}` as any) || run.reasons[0].kind}
										{#if run.reasons.length > 1}
											+{run.reasons.length - 1}
										{/if}
									</span>
								{:else}
									<span class="text-muted">—</span>
								{/if}
							</td>
							<td class="text-xs">
								<span class="targets-count font-mono">
									{#if summary.failed > 0}
										<span class="text-danger">{summary.failed} err</span> / {summary.total}
									{:else}
										{summary.success}/{summary.total} ok
									{/if}
								</span>
							</td>
							<td class="text-xs font-mono text-muted">
								r{run.revision}
							</td>
							<td class="text-right">
								<div class="row-actions">
									{#if run.state === 'running' || run.state === 'needsInput' || run.executions.some(e => e.state === 'running' || e.state === 'needsInput')}
										<button
											type="button"
											class="ui-button ui-button-danger action-xs"
											onclick={(e) => { e.stopPropagation(); void automationsStore.cancel(run.id); }}
											title={t('popover_action_stop')}
										>
											<IconStop />
										</button>
									{:else if !run.acknowledged && !run.requiresReview && run.state !== 'unknown' && !run.executions.some(e => e.state === 'needsInput') && (run.state === 'error' || run.state === 'timeout' || run.state === 'completed' || run.state === 'skipped' || run.state === 'interrupted')}
										<button
											type="button"
											class="ui-button ui-button-secondary action-xs"
											onclick={(e) => { e.stopPropagation(); void automationsStore.acknowledge(run.id); }}
											title={t('occ_btn_acknowledge')}
										>
											<IconCheck />
										</button>
									{/if}
									<button
										type="button"
										class="ui-button ui-button-ghost action-xs"
										onclick={(e) => { e.stopPropagation(); onSelectRun?.(run.id); }}
										title={t('occ_details_btn')}
									>
										<IconChevronRight />
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.automation-history {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.empty-history {
		padding: 32px 16px;
		text-align: center;
		color: var(--ink-muted);
		background: var(--bg-base);
		border-radius: var(--radius-md);
		border: 1px dashed var(--line);
	}

	.runs-table-wrap {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	.runs-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 13px;
	}

	.runs-table th {
		padding: 10px 12px;
		background: var(--bg-sunken);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
		border-bottom: 1px solid var(--line);
	}

	.run-row {
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		transition: background var(--dur-fast, 120ms) ease;
	}

	.run-row:hover {
		background: var(--bg-hover);
	}

	.run-row.selected {
		background: color-mix(in srgb, var(--brand) 12%, transparent);
	}

	.runs-table td {
		padding: 10px 12px;
		vertical-align: middle;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		padding: 2px 7px;
		border-radius: var(--radius-full);
		font-size: 11px;
		font-weight: 600;
	}

	.status-pill.status-completed { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
	.status-pill.status-running { background: color-mix(in srgb, var(--brand) 18%, transparent); color: var(--brand-ink); }
	.status-pill.status-error,
	.status-pill.status-timeout { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
	.status-pill.status-needsInput { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
	.status-pill.status-waiting { background: color-mix(in srgb, var(--ink-muted) 15%, transparent); color: var(--ink-muted); }
	.status-pill.status-skipped,
	.status-pill.status-superseded { background: color-mix(in srgb, var(--ink-faint) 15%, transparent); color: var(--ink-faint); }

	.reason-badge {
		display: inline-block;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.targets-count {
		color: var(--ink-muted);
	}

	.text-danger {
		color: var(--danger);
		font-weight: 600;
	}

	.text-muted {
		color: var(--ink-faint);
	}

	.text-right {
		text-align: right;
	}

	.row-actions {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.action-xs {
		padding: 4px 6px;
		font-size: 11px;
		min-height: 24px;
	}
</style>
