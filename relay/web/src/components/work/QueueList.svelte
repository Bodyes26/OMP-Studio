<!--
  QueueList.svelte — Coda unica del progetto (R-REM-11, R-REM-19).
  Ogni lavoro compare una volta sola, anche se ogni macchina ne pubblica una
  copia (vince `updatedAt` più recente). Ogni riga mostra la macchina del
  lavoro o «dove è acceso l'auto-avvio», e il pannello del lavoro la cambia.
-->
<script lang="ts">
	import type { RemoteTask } from '../../../../src/protocol.ts';
	import { t } from '../../i18n.ts';
	import { formatScheduleLabel } from '../../schedule.ts';
	import { workSheet } from '../../work.svelte.ts';
	import { ROLE_HUES } from '#lib/agent/roleHues.ts';
	import ProviderLogo from '#lib/components/models/ProviderLogo.svelte';
	import ThinkingMeter from '#lib/agent/components/ThinkingMeter.svelte';
	import type { ThinkingLevel } from '#lib/agent/wire.ts';
	import { listReorder } from '../../motion.ts';
	import MachineGlyph from '../MachineGlyph.svelte';
	import type { MachineOption, ProjectGroup, TaskEntry } from '../../multiMachine.ts';

	let {
		group,
		tasks,
		machines = []
	}: {
		group: ProjectGroup;
		tasks: TaskEntry[];
		machines?: MachineOption[];
	} = $props();

	function machineLabel(task: RemoteTask): string {
		if (!task.machineId) return t('workMachineAutoDispatch');
		return machines.find((machine) => machine.id === task.machineId)?.name ?? t('queueTaskMachineUnknown');
	}

	function machineOnline(task: RemoteTask): boolean {
		if (!task.machineId) return group.reachable;
		return machines.find((machine) => machine.id === task.machineId)?.online ?? false;
	}

	function parseModelSelector(selector?: string | null): { provider: string | null; modelName: string | null } {
		if (!selector) return { provider: null, modelName: null };
		const slash = selector.indexOf('/');
		if (slash !== -1) {
			return {
				provider: selector.slice(0, slash),
				modelName: selector.slice(slash + 1)
			};
		}
		return { provider: null, modelName: selector };
	}
</script>

{#if tasks.length > 0}
	<div class="queue-section" data-testid="project-queue">
		<p class="group-label">
			{t('workQueueSection', { count: tasks.length })}
		</p>
		<div class="tasks-list" role="list" aria-label={t('workQueueSection', { count: tasks.length })}>
			{#each tasks as entry, i (entry.task.id)}
				{@const task = entry.task}
				{@const schedLabel = formatScheduleLabel(task.schedule)}
				{@const modelInfo = parseModelSelector(task.modelSelector)}
				{@const taskRole = task.role || 'default'}
				<button
					type="button"
					class="task-row"
					animate:listReorder
					data-testid="task-{task.id}"
					onclick={() => {
						void workSheet.openTask({
							hostId: entry.copy.hostId,
							projectId: entry.copy.project.id,
							taskId: task.id
						});
					}}
				>
					<span class="task-info">
						<span class="t">{task.title}</span>
						<span class="d">
							{#if i === 0 || task.next}
								<span class="next">{t('workNextBadge')}</span>
								<span class="sep" aria-hidden="true">·</span>
							{/if}

							<span
								class="machine-chip"
								class:unreachable={!machineOnline(task)}
								title={machineLabel(task)}
							>
								<MachineGlyph glyph={{ kind: machineOnline(task) ? 'remote' : 'offline' }} size={11} />
								<span class="machine-name">{machineLabel(task)}</span>
							</span>
							<span class="sep" aria-hidden="true">·</span>

							<span
								class="role-dot"
								class:has-hue={ROLE_HUES[taskRole] !== undefined}
								style={ROLE_HUES[taskRole] !== undefined ? `--role-h: ${ROLE_HUES[taskRole]}` : undefined}
							></span>
							<span class="font-mono">{taskRole}</span>

							{#if modelInfo.modelName}
								<span class="sep" aria-hidden="true">·</span>
								{#if modelInfo.provider}
									<ProviderLogo provider={modelInfo.provider} size={12} />
								{/if}
								<span class="model-name">{modelInfo.modelName}</span>
							{/if}

							{#if task.thinkingLevel}
								<ThinkingMeter level={task.thinkingLevel as ThinkingLevel} />
							{/if}

							{#if schedLabel}
								<span class="sep" aria-hidden="true">·</span>
								<span>{schedLabel}</span>
							{/if}

							{#if task.directives && task.directives.length > 0}
								<span class="sep" aria-hidden="true">·</span>
								<span>
									{task.directives.length === 1
										? t('workDirectiveSelectedSingle')
										: t('workDirectivesSelected', { count: task.directives.length })}
								</span>
							{/if}

							{#if task.imageCount && task.imageCount > 0}
								<span class="sep" aria-hidden="true">·</span>
								<span>
									{task.imageCount === 1
										? t('workImageCountSingle')
										: t('workImagesCount', { count: task.imageCount })}
								</span>
							{/if}
						</span>
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.queue-section {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.group-label {
		font-size: 13px;
		color: var(--muted, var(--ink-muted));
		margin: 16px 4px 6px;
		font-weight: 560;
		text-transform: none;
	}

	.tasks-list {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.task-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		text-align: left;
		width: 100%;
		padding: 10px 4px;
		border: none;
		border-bottom: 1px solid var(--line);
		background: transparent;
		color: var(--ink);
		min-height: 56px;
		cursor: pointer;
		font-family: inherit;
		outline: none;
		transition: background-color var(--dur-fast, 120ms) ease;
	}

	.task-row:last-child {
		border-bottom: 0;
	}

	.task-row:hover,
	.task-row:focus-visible {
		background: var(--bg-hover, rgba(0, 0, 0, 0.03));
	}

	.task-info {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.t {
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-weight: 560;
		font-size: 14.5px;
		line-height: 1.35;
		color: var(--ink);
	}

	.d {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 13px;
		color: var(--muted, var(--ink-muted));
	}

	.next {
		color: var(--accent, var(--brand-ink));
		font-weight: 600;
	}

	.machine-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--ink-muted);
		font-size: 12px;
		font-weight: 500;
	}

	.machine-chip.unreachable {
		color: var(--danger);
	}

	.machine-name {
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
		display: inline-block;
		flex-shrink: 0;
	}

	.role-dot.has-hue {
		background: hsl(var(--role-h) 70% 55%);
	}

	.model-name {
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sep {
		opacity: 0.6;
	}

	@media (pointer: coarse) {
		.task-row {
			min-height: 60px;
			padding: 12px 6px;
		}
	}
</style>
