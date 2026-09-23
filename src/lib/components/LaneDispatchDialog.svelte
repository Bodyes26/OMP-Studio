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
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { trapFocus } from '$lib/focusTrap';
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
			<div class="header-icon" class:warn={mode !== 'busy-main'}>
				{#if mode === 'busy-main'}
					<IconGitBranch />
				{:else}
					<IconWarning />
				{/if}
			</div>
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
				<div class="task-card">
					<span class="label">{m.lane_dispatch_task_label()}</span>
					<p class="task-title" title={taskTitle}>{taskTitle}</p>
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
		</div>

		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={onCancel}>
				{m.lane_dispatch_cancel()}
			</button>
			{#if mode === 'busy-main' && onForce}
				<button
					type="button"
					class="btn btn-secondary btn-force"
					title={m.lane_dispatch_force({ lane: forceLaneTitle })}
					onclick={onForce}
				>
					<span>{m.lane_dispatch_force({ lane: forceLaneTitle })}</span>
				</button>
			{/if}
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
	/* Stessi token dei dialoghi di sistema (`app.css`): `--backdrop` e'
	   traslucido, cosi' l'app resta leggibile dietro la conferma anche sui
	   temi chiari, dove un grigio pieno la cancellava del tutto. */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		backdrop-filter: blur(2px);
		z-index: var(--z-modal, 1000);
	}

	.modal-window {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 460px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 64px);
		background: var(--bg-overlay);
		color: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: calc(var(--z-modal, 1000) + 1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) 0;
	}

	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		border-radius: 50%;
		color: var(--ink-muted);
		background: var(--bg-hover);
	}

	.header-icon.warn {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 16%, transparent);
	}

	.header-text {
		flex: 1;
		min-width: 0;
		padding-top: 1px;
	}

	.header-text h3 {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
		line-height: 1.3;
		color: var(--ink);
	}

	.subtitle {
		margin: 3px 0 0;
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--ink-muted);
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
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-faint);
		cursor: pointer;
	}

	.btn-close:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.modal-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		overflow-y: auto;
	}

	.task-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-left: 2px solid var(--brand);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
	}

	/* Il titolo del task e' spesso il prompt intero: due righe bastano per
	   riconoscerlo, il resto e' nel tooltip. */
	.task-title {
		margin: 0;
		font-size: var(--text-base);
		line-height: 1.4;
		color: var(--ink);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.label {
		font-size: var(--text-xs);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
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
		font-size: var(--text-sm);
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
		font-size: var(--text-xs);
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-process {
		flex: 0 0 auto;
		font-size: var(--text-xs);
		color: var(--warn);
	}

	.hint {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--ink-muted);
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--line);
		background: var(--bg-raised);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--bg-hover);
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			filter var(--dur-fast) var(--ease-out);
	}

	.btn :global(svg) {
		width: 14px;
		height: 14px;
	}

	.btn-secondary:hover {
		background: var(--bg-active);
	}

	/* Il titolo di una corsia e' spesso il prompt del task: nel footer ne
	   basta l'inizio, il resto e' nel tooltip. */
	.btn-force {
		min-width: 0;
		max-width: 180px;
	}

	.btn-force span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* `--brand` non e' mai colore di testo: sopra usa `--on-brand`. */
	.btn-primary {
		border-color: var(--brand);
		background: var(--brand);
		color: var(--on-brand);
	}

	.btn-primary:hover {
		filter: brightness(1.08);
	}

	.btn:focus-visible,
	.btn-close:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
</style>
