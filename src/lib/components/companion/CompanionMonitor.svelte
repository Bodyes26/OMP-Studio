<script lang="ts">
	// Griglia delle card di progetto.
	//
	// Una colonna a 560px, due se la finestra viene allargata: la larghezza
	// minima di 300px e' quella sotto cui la riga di un task in coda (che e' la
	// prima riga di un prompt) non si legge piu' (DESIGN.md §7.8).
	//
	// L'ordine arriva gia' deciso dalla vista (attention, working, finished,
	// idle). Tutti i progetti sono sempre visibili.
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { THEMES, automaticProjectHue } from '$lib/theme';
	import CompanionProjectCard from './CompanionProjectCard.svelte';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import type { CompanionAskHandlers } from './companionAsk';

	let {
		projects,
		runtimes,
		attentionList,
		ask,
		onFocusProject,
		onNewTask,
		onRunTask,
		onToggleUsage
	} = $props<{
		projects: Project[];
		runtimes: CompanionProjectRuntime[];
		attentionList: AttentionRequest[];
		ask: CompanionAskHandlers;
		onFocusProject: (projectId: string) => void;
		onNewTask: (project: Project) => void;
		onRunTask: (projectId: string, taskId: string) => void;
		onToggleUsage?: () => void;
	}>();

	function runtimeFor(projectId: string) {
		return runtimes.find((r: CompanionProjectRuntime) => r.projectId === projectId);
	}

	function attentionFor(projectId: string) {
		return attentionList.find((a: AttentionRequest) => a.projectId === projectId) ?? null;
	}

	function hueFor(project: Project): number {
		if (!project.path || project.colorMode === 'custom') return project.hue;
		return automaticProjectHue(THEMES[themeStore.current] ?? THEMES['titanium'], project.path);
	}

	function queuedFor(project: Project) {
		if (!project.path) return [];
		return taskStore.tasksFor(project.path).filter((t) => t.status === 'queued');
	}
</script>

{#if projects.length > 0}
	<section class="project-cards" aria-label={m.companion_cards_aria()}>
		{#each projects as p (p.id)}
			<CompanionProjectCard
				project={p}
				hue={hueFor(p)}
				runtime={runtimeFor(p.id)}
				attention={attentionFor(p.id)}
				queued={queuedFor(p)}
				{ask}
				{onFocusProject}
				{onNewTask}
				{onRunTask}
				{onToggleUsage}
			/>
		{/each}
	</section>
{/if}
