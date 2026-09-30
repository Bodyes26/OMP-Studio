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
	import { isLaneRoutable, type AutomationGate } from '$lib/agent/automationGate';
	import { taskLabel } from '$lib/stores/taskTitle';
	import QueueTaskItem from './QueueTaskItem.svelte';
	let {
		open = false,
		onClose,
		onRunTask,
		onEditTask,
		onOpenProject,
		gateFor,
		onOpenFile
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		onRunTask?: (
			projectId: string,
			taskId: string,
			options: { follow: boolean; shiftKey: boolean }
		) => void;
		onEditTask?: (projectId: string, taskId: string) => void;
		onOpenProject?: (projectId: string) => void;
		gateFor: (projectId: string) => AutomationGate;
		onOpenFile?: (projectId: string, relPath: string) => void;
	}>();

	let explainedProjectId = $state<string | null>(null);

	// Un gruppo per progetto reale (gli scratchpad hanno path vuoto e non
	// hanno coda) con almeno un task in attesa. L'ordine segue projectOrder,
	// cosi' il drawer rispetta la stessa disposizione scelta dall'utente
	// per la barra in alto.
	const groups = $derived(
		projectOrder.list
			.flatMap((p: Project) =>
				p.canonicalProjectPath
					? [{ project: p, tasks: taskStore.tasksFor(p.canonicalProjectPath).filter((t) => t.status !== 'dispatching') }]
					: []
			)
			.filter((g: { project: Project; tasks: StudioTask[] }) => g.tasks.length > 0)
	);
	// Stessa vista scelta in Aspetto per la Coda: compatta di default,
	// card ariose come opt-in. La riga e' la stessa `QueueTaskItem` del pannello.
	const isCardView = $derived((settingsStore.appearance.queueView ?? 'compact') === 'cards');
	// Stessa logica di TopBar.svelte: la tinta segue il tema del progetto
	// finche' l'utente non sceglie un colore personalizzato.
	function projectHue(project: Project): number {
		if (!project.canonicalProjectPath || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current], project.canonicalProjectPath);
	}

	function projectLabel(project: Project): string {
		return project.label ?? project.name.slice(0, 2).toUpperCase();
	}

	function firstTaskLabel(task: StudioTask): string {
		return taskLabel(task) || (task.images?.length ? m.queue_drawer_title_only_images() : m.queue_drawer_title_new_task());
	}
	// Ctrl+click porta il focus sul progetto dopo l'avvio; il click semplice
	// lancia in background, come deciso per tutti i punti di avvio condivisi.
	// Shift+click forza una corsia isolata nuova (Gate R27 / W09).
	// Un task bloccato resta cliccabile: il click apre la spiegazione invece di
	// sparire dentro un <button disabled>, che per contratto non emette eventi.
	// Un agente semplicemente occupato non e' un blocco: il routing della coda
	// decide se il task va in `Principale` o in una nuova corsia.
	function runTask(
		projectId: string,
		taskId: string,
		gate: AutomationGate,
		keys: { shiftKey: boolean; ctrlKey: boolean }
	) {
		if (!keys.shiftKey && !isLaneRoutable(gate)) {
			explainedProjectId = projectId;
			return;
		}
		onRunTask?.(projectId, taskId, { follow: keys.ctrlKey, shiftKey: keys.shiftKey });
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
					{@const gate = gateFor(group.project.id)}
					{@const blocked = !isLaneRoutable(gate)}
					{@const attention = gate.block === 'question' || gate.block === 'quota'}
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
									{#if blocked}
										<button
											type="button"
											class="group-reason blocked"
											aria-expanded={explainedProjectId === group.project.id}
											aria-controls={`queue-gate-${group.project.id}`}
											aria-label={m.gate_state_aria({ label: gate.label })}
											class:attention
											title={`${gate.detail} ${gate.hint}`.trim()}
											onclick={() => explainedProjectId = explainedProjectId === group.project.id ? null : group.project.id}
										>
											<span class="state-dot" aria-hidden="true"></span>
											{gate.label}
										</button>
									{:else}
										<span class="group-reason">{gate.label}</span>
									{/if}
									<button
										type="button"
										class="run-first"
										class:blocked
										class:attention
										aria-expanded={blocked ? explainedProjectId === group.project.id : undefined}
										aria-controls={blocked ? `queue-gate-${group.project.id}` : undefined}
										title={blocked ? `${gate.detail} ${gate.hint}`.trim() : m.queue_drawer_run_first_title({ title: firstTaskLabel(group.tasks[0]) })}
										aria-label={blocked
											? m.gate_explain_first_aria({ project: group.project.name })
											: m.queue_drawer_run_first_aria({ project: group.project.name })}
										onclick={(event) => runTask(group.project.id, group.tasks[0].id, gate, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey })}
									>
										{m.queue_drawer_run_first_btn()}
									</button>
								</div>
							</div>
						</div>
						{#if blocked && explainedProjectId === group.project.id}
							<div id={`queue-gate-${group.project.id}`} class="gate-notice" class:attention role="status" aria-live="polite">
								<strong>{m.gate_notice_title()}</strong>
								<span>{gate.detail}</span>
								{#if gate.hint}<span class="gate-hint">{gate.hint}</span>{/if}
								<div class="gate-actions">
									<button type="button" onclick={() => onOpenProject?.(group.project.id)}>
										{m.gate_notice_open_project()}
									</button>
									<button type="button" onclick={() => explainedProjectId = null}>
										{m.gate_notice_dismiss()}
									</button>
								</div>
							</div>
						{:else if gate.note}
							<div class="gate-note" role="status">{gate.note}</div>
						{/if}
						<div class="task-list" class:queue-cards={isCardView} role="list" aria-label={`Task in coda per ${group.project.name}`}>
							{#each group.tasks as task (task.id)}
								<div class="task-row" role="listitem">
									<QueueTaskItem
										{task}
										{blocked}
										{attention}
										blockedTitle={`${gate.detail} ${gate.hint}`.trim()}
										explainId={`queue-gate-${group.project.id}`}
										explainOpen={explainedProjectId === group.project.id}
										maxDirectives={3}
										onLaunch={(keys) => runTask(group.project.id, task.id, gate, keys)}
										onEdit={() => onEditTask?.(group.project.id, task.id)}
										onOpenFile={(path) => onOpenFile?.(group.project.id, path)}
									/>
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
		/* Sfondo opaco su cui `QueueTaskItem` compone hover e barra azioni. */
		--queue-task-surface: var(--bg-overlay);
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
		min-width: 0;
		flex-shrink: 0;
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
		padding: 0;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		overflow: hidden;
		border: 0;
		background: transparent;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 22px;
		text-align: left;
	}

	button.group-reason.blocked {
		color: var(--ink-faint);
		cursor: pointer;
	}

	button.group-reason.blocked.attention {
		color: var(--warn);
	}

	.state-dot {
		width: 6px;
		height: 6px;
		flex: 0 0 auto;
		border-radius: var(--radius-full);
		background: currentColor;
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

	.run-first:hover:not(.blocked) {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.run-first.blocked {
		color: var(--ink-faint);
		border-color: var(--line);
		cursor: help;
	}

	.run-first.blocked:hover {
		background: var(--bg-hover);
		color: var(--ink);
	}

	.run-first.blocked.attention:hover {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		color: var(--warn);
	}

	.gate-notice,
	.gate-note {
		margin: var(--space-2) 0 0 30px;
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--bg-raised);
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.gate-notice.attention {
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 8%, var(--bg-raised));
	}

	.gate-notice strong,
	.gate-hint {
		color: var(--ink);
	}

	.gate-actions {
		margin-top: var(--space-1);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.gate-actions button {
		height: 24px;
		padding: 0 var(--space-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-xs);
		cursor: pointer;
	}

	.gate-actions button:hover {
		background: var(--bg-hover);
	}

	.gate-note {
		border-color: var(--line);
		background: var(--bg-raised);
		color: var(--ink-faint);
	}

	.task-list {
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
	}

	.task-list.queue-cards {
		gap: var(--space-2);
	}

	.task-row {
		flex-shrink: 0;
	}
</style>
