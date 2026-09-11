<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { taskStore, type StudioTask } from '$lib/stores/tasks.svelte';
	import { projectOrder } from '$lib/stores/projectOrder.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { automaticProjectHue, THEMES } from '$lib/theme';
	import { trapFocus } from '$lib/focusTrap';
	import type { Project } from '$lib/stores/projects.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { IconClose } from '$lib/icons';
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
	// Stessa vista scelta in Aspetto per la Coda: compatta di default,
	// card ariose come opt-in. Stesse classi/regole di AgentPanel.
	const isCardView = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');
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
		if (task.images && task.images.length > 0) return m.queue_drawer_title_only_images();
		return m.queue_drawer_title_new_task();
	}

	function taskExcerpt(task: StudioTask): string {
		const compact = task.prompt.replace(/\s+/g, ' ').trim();
		if (compact) return compact;
		if (task.images && task.images.length > 0) {
			return `${task.images.length} ${task.images.length === 1 ? 'immagine allegata' : 'immagini allegate'}`;
		}
		return m.queue_drawer_excerpt_empty();
	}

	function roleBadge(role?: string): string | null {
		switch (role) {
			case 'smol': return 'smol';
			case 'slow': return 'slow';
			case 'plan': return 'plan';
			case 'custom': return 'custom';
			case 'default': return 'default';
			default: return null;
		}
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
	<button type="button" class="backdrop" onclick={onClose} aria-label={m.queue_drawer_close_aria()} tabindex="-1" transition:fade={{ duration: 180 }}></button>
	<div
		class="drawer"
		role="dialog"
		aria-modal="true"
		aria-label={m.queue_drawer_modal_aria()}
		use:trapFocus={{ onEscape: onClose }}
		transition:fly={{ y: -12, duration: 220, easing: cubicOut }}
	>
		<div class="header">
			<h3>{m.queue_drawer_heading()}</h3>
			<button type="button" class="close-btn" onclick={onClose} aria-label={m.queue_drawer_close_aria()}><IconClose /></button>
		</div>
		<div class="body" role="list" aria-label={m.queue_drawer_projects_list_aria()}>
			{#if groups.length === 0}
				<div class="empty-row">{m.queue_drawer_empty_state()}</div>
			{:else}
				{#each groups as group (group.project.id)}
					{@const reason = runReason?.(group.project.id) ?? ''}
					{@const blocked = !canRunTask?.(group.project.id)}
					<div class="group" role="listitem">
						<div class="group-header">
							<span
								class="group-chip"
								style="--proj-hue: {projectHue(group.project)}"
								title={group.project.label ? `Sigla: ${group.project.label}` : `Progetto: ${group.project.name}`}
							>
								{projectLabel(group.project)}
							</span>
							<div class="group-info">
								<div class="group-title-row">
									<span class="group-name" title={group.project.name}>{group.project.name}</span>
									<span class="group-count">{group.tasks.length}</span>
								</div>
								<div class="group-sub">
									<span class="group-reason" title={reason}>{reason}</span>
									<button
										type="button"
										class="run-first"
										disabled={blocked}
										title={blocked ? reason : m.queue_drawer_run_first_title({ title: taskTitle(group.tasks[0]) })}
										aria-label={m.queue_drawer_run_first_aria({ project: group.project.name })}
										onclick={(event) => runTask(event, group.project.id, group.tasks[0].id)}
									>
										{m.queue_drawer_run_first_btn()}
									</button>
								</div>
							</div>
						</div>
						<div class="task-list" class:queue-cards={isCardView} role="list" aria-label={`Task in coda per ${group.project.name}`}>
							{#each group.tasks as task (task.id)}
								<div class="task-row" role="listitem">
									<div class="task-main">
										<span class="task-title" class:completed-text={task.status === 'completed' || task.status === 'abandoned'}>{taskTitle(task)}</span>
										<span class="task-excerpt">{taskExcerpt(task)}</span>
										<div class="task-chips">
											{#if task.status === 'in_progress'}
												<span class="task-chip status-chip in-progress">{m.queue_drawer_status_in_progress()}</span>
											{:else if task.status === 'completed'}
												<span class="task-chip status-chip completed">{m.queue_drawer_status_completed()}</span>
											{:else if task.status === 'abandoned'}
												<span class="task-chip status-chip abandoned">{m.queue_drawer_status_abandoned()}</span>
											{/if}
											{#if task.options?.role}
												{@const badge = roleBadge(task.options.role)}
												{#if badge}
													<span class="task-chip role-chip">{badge}</span>
												{/if}
											{/if}
											{#if task.options?.directives && task.options.directives.length > 0}
												{#each task.options.directives.slice(0, 3) as d (d.id)}
													<span class="task-chip" title={d.name}>{d.tag || d.name}</span>
												{/each}
												{#if task.options.directives.length > 3}
													<span class="task-chip" title={task.options.directives.slice(3).map((d) => d.name).join(', ')}>+{task.options.directives.length - 3}</span>
												{/if}
											{/if}
											{#if task.images && task.images.length > 0}
												<span class="task-chip img-chip">img {task.images.length}</span>
											{/if}
										</div>
									</div>
									<div class="task-actions">
										<button
											type="button"
											class="task-run"
											disabled={blocked}
											title={blocked ? reason : m.queue_drawer_run_first_title({ title: taskTitle(task) })}
											aria-label={m.ui_queuedrawer_avvia_task_value1_0055({ value1: taskTitle(task) })}
											onclick={(event) => runTask(event, group.project.id, task.id)}
										>
											{m.queue_drawer_run_btn()}
										</button>
										<button
											type="button"
											class="task-edit"
											title={m.queue_drawer_edit_btn_title()}
											aria-label={m.ui_queuedrawer_modifica_task_value1_4d12({ value1: taskTitle(task) })}
											onclick={() => onEditTask?.(group.project.id, task.id)}
										>
											{m.queue_drawer_edit_btn()}
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
	/* Click-catcher a piena viewport: senza reset il <button> erediterebbe
	   `ButtonFace` e il bordo `outset` dello user agent, tingendo di grigio
	   tutta la finestra invece di restare invisibile. */
	.backdrop {
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		z-index: var(--z-backdrop);
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
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
		align-items: flex-start;
		gap: var(--space-2);
	}

	.group-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 20px;
		min-width: 22px;
		max-width: 96px;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		background: oklch(var(--proj-l-fill) var(--proj-c-fill) var(--proj-hue));
		color: var(--on-project);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.group-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.group-title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
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
		line-height: 20px;
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
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.group-reason {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 22px;
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

	.task-list.queue-cards {
		gap: var(--space-2);
	}

	.task-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		min-height: 72px;
	}

	.task-list.queue-cards .task-row {
		align-items: stretch;
		padding: var(--space-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		min-height: 88px;
	}

	.task-list.queue-cards .task-row:hover {
		border-color: var(--line-strong);
	}

	.task-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-1);
	}

	.task-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.task-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.task-list.queue-cards .task-title {
		white-space: normal;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.task-list.queue-cards .task-excerpt {
		-webkit-line-clamp: 3;
		line-clamp: 3;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.task-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-start;
		gap: 4px;
	}

	.task-chips:empty {
		display: none;
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

	.task-chip.role-chip {
		background: var(--brand-dim);
		border-color: transparent;
		color: var(--ink);
		font-weight: 600;
	}

	.task-chip.img-chip {
		color: var(--ink-faint);
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
