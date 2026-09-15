<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEMES, automaticProjectHue } from '$lib/theme';
	import { computeQuotaInfo } from '$lib/quota/projectQuota';
	import QuotaChip from '$lib/components/quota/QuotaChip.svelte';
	import CompanionProjectQueue from './CompanionProjectQueue.svelte';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import {
		IconCheck,
		IconStatusPending,
		IconStatusRunning,
		IconWarning
	} from '$lib/icons';

	let {
		projects,
		runtimes,
		attentionList,
		variant = 'list',
		isPinned = false,
		selectedProjectId = null,
		onSelectProject,
		onRunTask,
		onToggleUsage,
		onTogglePin
	} = $props<{
		projects: Project[];
		runtimes: CompanionProjectRuntime[];
		attentionList: AttentionRequest[];
		variant?: 'list' | 'dense';
		isPinned?: boolean;
		selectedProjectId?: string | null;
		/** Espande o chiude la coda del progetto: ogni layout la offre. */
		onSelectProject: (projectId: string | null) => void;
		onRunTask?: (projectId: string, taskId: string) => void;
		onToggleUsage?: () => void;
		onTogglePin?: () => void;
	}>();

	/**
	 * Quanti progetti stanno nella finestra effimera prima dell'invito a
	 * fissarla. Da fissata si mostrano tutti: la finestra e' ridimensionabile e
	 * troncare avrebbe proposto di fissare cio' che e' gia' fissato.
	 */
	const SPOTLIGHT_LIMITS: Record<string, number> = {
		list: 5,
		dense: 3
	};

	const visibleProjects = $derived(
		isPinned ? projects : projects.slice(0, SPOTLIGHT_LIMITS[variant] ?? 3)
	);
	const hiddenProjectsCount = $derived(projects.length - visibleProjects.length);

	function runtimeFor(projectId: string) {
		return runtimes.find((r: CompanionProjectRuntime) => r.projectId === projectId);
	}

	function hueFor(project: Project): number {
		if (!project.path || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current] ?? THEMES['titanium'], project.path);
	}

	function stateLabel(state: string, projectId?: string): string {
		if (state === 'attention') {
			const bq = attentionList.find((a: AttentionRequest) => a.projectId === projectId && a.pendingUi.kind === 'quota_blocked');
			if (bq) {
				return bq.pendingUi.blockedQuota?.reasonKind === 'quota_exhausted'
					? m.companion_state_quota_exhausted()
					: m.companion_state_provider_error();
			}
			return m.ui_companionview_chiede_risposta_de18();
		}
		if (state === 'working') return m.companion_state_working();
		if (state === 'finished') return m.page_agent_state_finished();
		if (state === 'idle') return m.companion_state_idle();
		return m.companion_state_unknown();
	}

	function queuedTasksFor(project: Project) {
		if (!project.path) return [];
		return taskStore.tasksFor(project.path).filter((t) => t.status === 'queued');
	}

	function hasAttention(projectId: string): boolean {
		return attentionList.some((a: AttentionRequest) => a.projectId === projectId);
	}

	function shouldShowQueue(project: Project): boolean {
		if (queuedTasksFor(project).length === 0) return false;
		if (selectedProjectId === project.id) return true;
		return hasAttention(project.id);
	}

	function handleRowClick(project: Project) {
		onSelectProject(selectedProjectId === project.id ? null : project.id);
	}

</script>

{#if projects.length > 0}
	<section class="live-monitor-section variant-{variant}">
		{#if variant === 'dense'}
			<div class="section-title">
				<IconStatusRunning />
				<span>{m.ui_companionview_progetti_9979()}{projects.length})</span>
			</div>
		{/if}

		<div class="projects-list">
			{#each visibleProjects as p (p.id)}
				{@const rt = runtimeFor(p.id)}
				{@const busy = p.agentState === 'working' || p.agentState === 'attention'}
				{@const queued = queuedTasksFor(p)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="project-row"
					class:busy
					class:attention={p.agentState === 'attention'}
					class:finished={p.agentState === 'finished'}
					class:selected={selectedProjectId === p.id}
					style="--proj-hue: {hueFor(p)}"
					role="button"
					tabindex="0"
					aria-expanded={selectedProjectId === p.id}
					onclick={() => handleRowClick(p)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							handleRowClick(p);
						}
					}}
				>
					<!-- Stesso vocabolario della barra progetti (DESIGN.md §7.1): punto
					     identita' pieno quando un agente c'e', anello ambra inset che
					     respira quando aspetta te. Il punto non si anima mai. -->
					<span class="p-dot" class:lit={busy}></span>
					<span class="p-name">{p.label?.trim() || p.name}</span>

					{#if queued.length > 0}
						<span class="p-queue-count" title={m.companion_queue_count({ count: queued.length })}>
							{queued.length}
						</span>
					{/if}

					{#if busy && rt?.provider}
						{@const info = computeQuotaInfo(rt.provider, rt.modelId, rt.credentialPin)}
						<QuotaChip
							variant="ringHalo"
							showProvider={true}
							alwaysShowPct={true}
							semanticColors={true}
							status={info.status}
							remainingPct={info.remainingPct}
							usedPct={info.usedPct}
							shortName={rt.modelLabel ?? info.shortName}
							hasLimits={info.hasLimits}
							title={info.tooltip}
							ariaLabel={info.tooltip}
							longWindowAlert={info.longWindowAlert}
							accountEmail={info.accountEmail}
							onclick={(e) => {
								e.stopPropagation();
								onToggleUsage?.();
							}}
						/>
					{/if}

					<span class="p-state state-{p.agentState}">
						{#if p.agentState === 'working'}
							<IconStatusRunning /> {stateLabel(p.agentState, p.id)}
						{:else if p.agentState === 'attention'}
							<IconWarning /> {stateLabel(p.agentState, p.id)}
						{:else if p.agentState === 'finished'}
							<IconCheck /> {stateLabel(p.agentState, p.id)}
						{:else}
							<IconStatusPending /> {stateLabel(p.agentState, p.id)}
						{/if}
					</span>
				</div>

				{#if shouldShowQueue(p)}
					<CompanionProjectQueue
						projectName={p.label?.trim() || p.name}
						tasks={queued}
						disabled={rt?.canRunTask !== true}
						disabledReason={rt?.runBlockReason}
						onRunNext={(taskId) => onRunTask?.(p.id, taskId)}
					/>
				{/if}
			{/each}

			{#if hiddenProjectsCount > 0}
				<button
					type="button"
					class="more-projects"
					title={m.companion_more_projects_title()}
					onclick={() => onTogglePin?.()}
				>
					{m.companion_more_projects({ count: hiddenProjectsCount })}
				</button>
			{/if}
		</div>
	</section>
{/if}
