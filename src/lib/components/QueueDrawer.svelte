<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEMES } from '$lib/theme';
	import { trapFocus } from '$lib/focusTrap';
	import type { Project } from '$lib/stores/projects.svelte';
	let {
		open = false,
		onClose,
		onRunTask,
		onEditTask,
		canRunTask,
		runReason
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		onRunTask?: (projectId: string, taskId: string, follow: boolean) => void;
		onEditTask?: (projectId: string, taskId: string) => void;
		canRunTask?: (projectId: string) => boolean;
		runReason?: (projectId: string) => string;
	}>();

	// Un gruppo per progetto reale (gli scratchpad hanno path vuoto e non
	// hanno coda) con almeno un task in attesa. L'ordine segue projectOrder,
	// cosi' il drawer rispetta la stessa disposizione scelta dall'utente
	// per la barra in alto.
	const groups = $derived(
		projectOrder.list
			.filter((p: Project) => p.path)
			.map((p: Project) => ({ project: p, tasks: taskStore.tasksFor(p.path) }))
			.filter((g: { project: Project; tasks: StudioTask[] }) => g.tasks.length > 0)
	);

	// Stessa logica di TopBar.svelte: la tinta segue il tema del progetto
	// finche' l'utente non sceglie un colore personalizzato.
	function projectHue(project: Project): number {
		if (!project.path || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current], project.path);
	}

	function projectLabel(project: Project): string {
		return project.label ?? project.name.slice(0, 2).toUpperCase();
	}

	function taskTitle(task: StudioTask): string {
		const line = task.prompt.split(/\r?\n/).find((l) => l.trim())?.trim();
		if (line) return line;
		if (task.images && task.images.length > 0) return '(solo immagini)';
		return 'Nuovo task';
	}

	// Ctrl+click porta il focus sul progetto dopo l'avvio; il click semplice
	// lancia in background, come deciso per tutti i punti di avvio condivisi.
	function runTask(event: MouseEvent, projectId: string, taskId: string) {
		onRunTask?.(projectId, taskId, event.ctrlKey);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			onClose?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<button type="button" class="backdrop" onclick={onClose} aria-label="Chiudi cassetto coda" tabindex="-1" transition:fade={{ duration: 180 }}></button>
	<div
		class="drawer"
		role="dialog"
		aria-modal="true"
		aria-label="Coda di tutti i progetti"
		use:trapFocus={{ onEscape: onClose }}
		transition:fly={{ y: -12, duration: 220, easing: cubicOut }}
	>
		<div class="header">
			<h3>Task in coda</h3>
			<button type="button" class="close-btn" onclick={onClose} aria-label="Chiudi cassetto coda">×</button>
		</div>
		<div class="body" role="list" aria-label="Progetti con task in coda">
			{#if groups.length === 0}
				<div class="empty-row">Nessun task in attesa</div>
			{:else}
				{#each groups as group (group.project.id)}
					{@const reason = runReason?.(group.project.id) ?? ''}
					{@const blocked = !canRunTask?.(group.project.id)}
					<div class="group" role="listitem">
						<div class="group-header">
							<span class="group-dot" style="--proj-hue: {projectHue(group.project)}">{projectLabel(group.project)}</span>
							<span class="group-name" title={group.project.name}>{group.project.name}</span>
							<span class="group-count">{group.tasks.length}</span>
						</div>
						<div class="group-sub">
							<span class="group-reason" title={reason}>{reason}</span>
							<button
								type="button"
								class="run-first"
								disabled={blocked}
								title={blocked ? reason : `Avvia: ${taskTitle(group.tasks[0])}`}
								aria-label={`Avvia il primo task in coda per ${group.project.name}`}
								onclick={(event) => runTask(event, group.project.id, group.tasks[0].id)}
							>
								Avvia il primo
							</button>
						</div>
						<div class="task-list" role="list" aria-label={`Task in coda per ${group.project.name}`}>
							{#each group.tasks as task (task.id)}
								<div class="task-row" role="listitem">
									<div class="task-main">
										<span class="task-title" class:completed-text={task.status === 'completed' || task.status === 'abandoned'}>{taskTitle(task)}</span>
										<div class="task-chips">
											{#if task.status === 'in_progress'}
												<span class="task-chip status-chip in-progress">in corso</span>
											{:else if task.status === 'completed'}
												<span class="task-chip status-chip completed">fatto</span>
											{:else if task.status === 'abandoned'}
												<span class="task-chip status-chip abandoned">abbandonato</span>
											{/if}
											{#if task.options?.discussionMode}<span class="task-chip">Discussione</span>{/if}
											{#if task.options?.planMode}<span class="task-chip">Piano</span>{/if}
											{#if task.options?.minimalMode}<span class="task-chip">Minimale</span>{/if}
											{#if task.options?.researchMode}<span class="task-chip">Ricerca</span>{/if}
										</div>
									</div>
									<div class="task-actions">
										<button
											type="button"
											class="task-run"
											disabled={blocked}
											title={blocked ? reason : `Avvia: ${taskTitle(task)}`}
											aria-label={`Avvia task: ${taskTitle(task)}`}
											onclick={(event) => runTask(event, group.project.id, task.id)}
										>
											Avvia
										</button>
										<button
											type="button"
											class="task-edit"
											title="Modifica task"
											aria-label={`Modifica task: ${taskTitle(task)}`}
											onclick={() => onEditTask?.(group.project.id, task.id)}
										>
											Modifica
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		z-index: var(--z-backdrop);
	}

	.drawer {
		position: fixed;
		top: 48px;
		right: var(--space-2);
		width: 420px;
		max-height: 70vh;
		background: var(--bg-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-overlay);
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		color: var(--ink);
		overflow: hidden;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.header h3 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--ink);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--ink-faint);
		cursor: pointer;
		font-size: var(--text-lg);
		padding: 4px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.close-btn:hover {
		color: var(--ink);
		background: var(--bg-hover);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.empty-row {
		padding: var(--space-4) var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-sm);
		text-align: center;
	}

	.group {
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--line);
	}

	.group:last-child {
		padding-bottom: 0;
		border-bottom: 0;
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.group-dot {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		color: var(--on-project);
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
	}

	.group-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.group-count {
		flex-shrink: 0;
		min-width: 17px;
		height: 17px;
		padding: 0 var(--space-1);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-full);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	.group-sub {
		margin-top: var(--space-1);
		padding-left: 28px;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.group-reason {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.run-first {
		flex-shrink: 0;
		height: 22px;
		padding: 0 var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-muted);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.run-first:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.run-first:disabled {
		color: var(--ink-faint);
		cursor: default;
	}

	.task-list {
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.task-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1);
		border-radius: var(--radius-sm);
		/* Le righe con le pillole di modalita' sarebbero piu' alte delle altre:
		   un elenco che si muove a scatti si legge peggio di uno regolare. */
		min-height: 40px;
	}

	.task-row:hover {
		background: var(--bg-hover);
	}

	.task-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.task-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.task-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.task-chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		line-height: 1.2;
		white-space: nowrap;
	}

	.task-actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.task-run,
	.task-edit {
		height: 24px;
		padding: 0 var(--space-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.task-run:hover:not(:disabled),
	.task-edit:hover {
		background: var(--bg-hover);
	}

	.task-run:disabled {
		color: var(--ink-faint);
		border-color: var(--line);
		cursor: default;
	}
	.status-chip.in-progress {
		background: var(--brand-dim);
		color: var(--brand-ink);
		font-weight: 600;
	}

	.status-chip.completed {
		background: var(--bg-sunken);
		color: var(--success, #22c55e);
	}

	.status-chip.abandoned {
		background: var(--bg-sunken);
		color: var(--ink-faint);
		opacity: 0.7;
	}

	.completed-text {
		text-decoration: line-through;
		color: var(--ink-faint);
	}

	.task-edit {
		border-color: var(--line);
		color: var(--ink-muted);
	}
</style>
