<script lang="ts">
	// Conferma del routing della coda verso una corsia isolata (Gate R27 / PLAN W09)
	// e dell'arresto dei processi prima del cleanup (PLAN W11).
	//
	// Tre sole domande, tutte superabili:
	// 1. `Principale` e' al lavoro: avviare il task in una nuova corsia?
	// 2. Soft-cap: dal terzo agente simultaneo mostra modelli/provider impegnati
	//    e le corsie con un processo omp ancora vivo prima di confermare.
	// 3. Cleanup bloccato: la corsia ha processi vivi; l'unica via avanti e'
	//    arrestarli esplicitamente.
	import { m } from '$lib/paraglide/messages.js';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
	import { IconClose, IconWarning, IconPlus } from '$lib/icons';
	import type { ConcurrencyWarning } from '$lib/lanes/queueDispatch';
	import { describeLaneProcess, type LaneProcessInfo } from '$lib/lanes/processSupervisor';

	let {
		open = false,
		mode = 'busy-main',
		taskTitle = '',
		warning = null,
		laneTitle = '',
		processes = [],
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		mode?: 'busy-main' | 'concurrency' | 'processes';
		taskTitle?: string;
		warning?: ConcurrencyWarning | null;
		laneTitle?: string;
		processes?: LaneProcessInfo[];
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let primaryBtnEl = $state<HTMLButtonElement | null>(null);

	function handleKeydown(event: KeyboardEvent) {
		if (!open || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		onCancel();
	}

	$effect(() => {
		if (!open) return;
		const timer = setTimeout(() => primaryBtnEl?.focus(), 30);
		return () => clearTimeout(timer);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={onCancel} transition:fade={{ duration: 150 }}></div>

	<div
		class="modal-window"
		role="dialog"
		aria-modal="true"
		aria-labelledby="lane-dispatch-title"
		use:trapFocus
		transition:fly={{ y: -16, duration: 200, easing: cubicOut }}
	>
		<div class="modal-header">
			<div class="header-icon"><IconWarning /></div>
			<div class="header-text">
				<h3 id="lane-dispatch-title">
					{#if mode === 'busy-main'}
						{m.lane_dispatch_busy_title()}
					{:else if mode === 'processes'}
						{m.lane_dispatch_processes_title()}
					{:else}
						{m.lane_dispatch_concurrency_title()}
					{/if}
				</h3>
				<p class="subtitle">
					{#if mode === 'busy-main'}
						{m.lane_dispatch_busy_question()}
					{:else if mode === 'processes'}
						{m.lane_dispatch_processes_question({ title: laneTitle })}
					{:else}
						{m.lane_dispatch_concurrency_question({ count: (warning?.activeAgents ?? 0) + 1 })}
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="btn-close"
				onclick={onCancel}
				aria-label={m.lane_dispatch_cancel()}
			>
				<IconClose />
			</button>
		</div>

		<div class="modal-body">
			{#if taskTitle}
				<p class="task-line">
					<span class="label">{m.lane_dispatch_task_label()}</span>
					<span class="value">{taskTitle}</span>
				</p>
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
		</div>

		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={onCancel}>
				{m.lane_dispatch_cancel()}
			</button>
			<button type="button" class="btn btn-primary" bind:this={primaryBtnEl} onclick={onConfirm}>
				{#if mode === 'processes'}
					<IconClose />
					<span>{m.lane_dispatch_processes_confirm()}</span>
				{:else}
					<IconPlus />
					<span>{m.lane_dispatch_confirm()}</span>
				{/if}
			</button>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-base) 80%, black);
		backdrop-filter: blur(2px);
		z-index: var(--z-modal, 1000);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 480px;
		max-width: calc(100vw - 32px);
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg, 10px);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--line-strong);
		z-index: calc(var(--z-modal, 1000) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px) var(--space-4, 16px) var(--space-3, 12px);
		border-bottom: 1px solid var(--line);
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		border-radius: 50%;
		color: var(--warning, #d29922);
		background: color-mix(in srgb, var(--warning, #d29922) 14%, transparent);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.header-text h3 {
		margin: 0;
		font-size: var(--text-base, 14px);
		font-weight: 600;
		color: var(--fg-default);
	}

	.subtitle {
		margin: 2px 0 0;
		font-size: var(--text-sm, 12px);
		color: var(--fg-muted);
	}

	.btn-close {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--fg-default);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3, 12px);
		padding: var(--space-4, 16px);
	}

	.task-line {
		display: flex;
		gap: var(--space-2, 8px);
		align-items: baseline;
		margin: 0;
		min-width: 0;
	}

	.task-line .value {
		font-size: var(--text-sm, 12px);
		color: var(--fg-default);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.label {
		font-size: var(--text-xs, 11px);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-subtle, var(--fg-muted));
	}

	.lanes-box {
		display: flex;
		flex-direction: column;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px);
		border: 1px solid var(--line);
		border-radius: var(--radius-md, 6px);
		background: var(--bg-subtle, var(--bg-base));
	}

	.lanes-box ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lanes-box li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2, 8px);
		font-size: var(--text-sm, 12px);
		min-width: 0;
	}

	.lane-title {
		color: var(--fg-default);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-model {
		font-family: var(--font-mono);
		font-size: var(--text-xs, 11px);
		color: var(--fg-muted);
	}

	.lane-process {
		font-size: var(--text-xs, 11px);
		color: var(--accent, var(--fg-muted));
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm, 12px);
		color: var(--fg-muted);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2, 8px);
		padding: var(--space-3, 12px) var(--space-4, 16px);
		border-top: 1px solid var(--line);
		background: var(--bg-subtle, transparent);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: var(--radius-sm, 4px);
		border: 1px solid var(--line-strong);
		background: var(--bg-elevated, transparent);
		color: var(--fg-default);
		font-size: var(--text-sm, 12px);
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: var(--bg-hover);
	}

	.btn-primary {
		border-color: var(--accent, var(--line-strong));
		background: var(--accent, var(--bg-elevated));
		color: var(--accent-fg, #fff);
	}

	.btn-primary:hover {
		filter: brightness(1.08);
	}
</style>
