<script lang="ts">
	// Conferma del routing della coda verso una corsia isolata (Gate R27 / PLAN W09)
	// e dell'arresto dei processi prima del cleanup (PLAN W11).
	//
	// Tre sole domande, tutte superabili:
	// 1. `Principale` e' al lavoro: avviare il task in una nuova corsia, oppure
	//    forzarlo nella corsia aperta quando per l'utente l'agente ha finito.
	// 2. Soft-cap: dal terzo agente simultaneo mostra modelli/provider impegnati
	//    e le corsie con un processo omp ancora vivo prima di confermare.
	// 3. Cleanup bloccato: la corsia ha processi vivi; l'unica via avanti e'
	//    arrestarli esplicitamente.
	import { m } from '$lib/paraglide/messages.js';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Tooltip from '$lib/ui/Tooltip.svelte';
	import { IconClose, IconWarning, IconPlus, IconGitBranch } from '$lib/icons';
	import type { ConcurrencyWarning } from '$lib/lanes/queueDispatch';
	import { describeLaneProcess, type LaneProcessInfo } from '$lib/lanes/processSupervisor';

	let {
		open = false,
		mode = 'busy-main',
		taskTitle = '',
		warning = null,
		laneTitle = '',
		processes = [],
		forceLaneTitle = '',
		onConfirm,
		onForce,
		onCancel
	}: {
		open?: boolean;
		mode?: 'busy-main' | 'concurrency' | 'processes';
		taskTitle?: string;
		warning?: ConcurrencyWarning | null;
		laneTitle?: string;
		processes?: LaneProcessInfo[];
		/** Corsia aperta a schermo, bersaglio dell'avvio forzato. */
		forceLaneTitle?: string;
		onConfirm: () => void;
		/** Presente solo quando l'avvio forzato ha senso (`busy-main`). */
		onForce?: () => void;
		onCancel: () => void;
	} = $props();

	let forceBtnTextEl = $state<HTMLElement | null>(null);
	let isForceTruncated = $state(false);

	const dialogTitle = $derived(
		mode === 'busy-main'
			? m.lane_dispatch_busy_title()
			: mode === 'processes'
				? m.lane_dispatch_processes_title()
				: m.lane_dispatch_concurrency_title()
	);

	const forceLabel = $derived(
		forceLaneTitle ? m.lane_dispatch_force({ lane: forceLaneTitle }) : ''
	);

	$effect(() => {
		if (open && forceLabel && forceBtnTextEl) {
			isForceTruncated = forceBtnTextEl.scrollWidth > forceBtnTextEl.clientWidth;
		} else {
			isForceTruncated = false;
		}
	});
</script>

<Dialog
	{open}
	title={dialogTitle}
	onClose={onCancel}
	initialFocus="[data-dialog-primary]"
>
	{#snippet icon()}
		<span class="dialog-icon-wrap" class:warn={mode !== 'busy-main'}>
			{#if mode === 'busy-main'}
				<IconGitBranch />
			{:else}
				<IconWarning />
			{/if}
		</span>
	{/snippet}

	{#snippet body()}
		<p class="dialog-question">
			{#if mode === 'busy-main'}
				{m.lane_dispatch_busy_question()}
			{:else if mode === 'processes'}
				{m.lane_dispatch_processes_question({ title: laneTitle })}
			{:else}
				{m.lane_dispatch_concurrency_question({ count: (warning?.activeAgents ?? 0) + 1 })}
			{/if}
		</p>

		{#if taskTitle}
			<div class="task-row">
				<span class="task-label">{m.lane_dispatch_task_label()}</span>
				<Tooltip text={taskTitle} placement="bottom">
					<span class="task-title">{taskTitle}</span>
				</Tooltip>
			</div>
		{/if}

		{#if warning}
			<div class="lanes-box">
				<span class="label">{m.lane_dispatch_active_agents({ count: warning.activeAgents })}</span>
				<ul>
					{#each warning.lanes as lane (lane.title)}
						<li>
							<span class="lane-title">{lane.title}</span>
							<span class="lane-model">{lane.model ?? m.lane_dispatch_model_unknown()}</span>
							{#if lane.liveProcess}
								<span class="lane-process">{m.lane_dispatch_live_process()}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if mode === 'processes'}
			<div class="lanes-box">
				<span class="label">{m.lane_dispatch_processes_count({ count: processes.length })}</span>
				<ul>
					{#each processes as process (`${process.kind}-${process.ownerId}`)}
						<li>
							<span class="lane-title">{describeLaneProcess(process)}</span>
							<span class="lane-model">{process.workspaceRoot}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<p class="hint">
			{mode === 'processes'
				? m.lane_dispatch_processes_hint()
				: m.lane_dispatch_isolation_hint()}
		</p>
		{#if mode === 'busy-main' && onForce}
			<p class="hint">{m.lane_dispatch_force_hint({ lane: forceLaneTitle })}</p>
		{/if}
	{/snippet}

	{#snippet footer()}
		<button type="button" class="ui-button ui-button-secondary" onclick={onCancel}>
			{m.lane_dispatch_cancel()}
		</button>
		{#if mode === 'busy-main' && onForce}
			<Tooltip text={forceLabel} disabled={!isForceTruncated} placement="top">
				<button
					type="button"
					class="ui-button ui-button-secondary btn-force"
					onclick={onForce}
				>
					<span bind:this={forceBtnTextEl}>{forceLabel}</span>
				</button>
			</Tooltip>
		{/if}
		<button
			type="button"
			class="ui-button ui-button-primary"
			data-dialog-primary
			onclick={onConfirm}
		>
			{#if mode === 'processes'}
				<IconClose />
				<span>{m.lane_dispatch_processes_confirm()}</span>
			{:else}
				<IconPlus />
				<span>{m.lane_dispatch_confirm()}</span>
			{/if}
		</button>
	{/snippet}
</Dialog>

<style>
	.dialog-icon-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		--icon-size: 16px;
		color: var(--ink-muted);
	}

	.dialog-icon-wrap.warn {
		color: var(--warn);
	}

	.dialog-question {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.4;
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.task-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		min-width: 0;
	}

	.task-row :global(.tooltip-wrapper) {
		min-width: 0;
		flex: 1;
		overflow: hidden;
	}

	.task-label {
		flex-shrink: 0;
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
	}

	.task-title {
		display: block;
		font-size: var(--text-body);
		font-weight: 450;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		width: 100%;
	}

	.label {
		font-size: var(--text-label);
		font-weight: 500;
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
	}

	.lanes-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	.lanes-box ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.lanes-box li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-body);
		min-width: 0;
	}

	.lane-title {
		min-width: 0;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-model {
		margin-left: auto;
		flex: 0 0 auto;
		max-width: 50%;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-process {
		flex: 0 0 auto;
		font-size: var(--text-caption);
		color: var(--warn);
	}

	.hint {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--ink-muted);
	}

	.btn-force {
		min-width: 0;
		max-width: 180px;
	}

	.btn-force span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}
</style>
