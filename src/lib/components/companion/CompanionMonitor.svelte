<script lang="ts">
	// Griglia delle card di progetto.
	//
	// Una colonna a 560px, due se la finestra viene allargata: la larghezza
	// minima di 300px e' quella sotto cui la riga di un task in coda (che e' la
	// prima riga di un prompt) non si legge piu'.
	//
	// L'ordine arriva gia' deciso dalla vista (attention, working, finished,
	// idle). Tutti i progetti sono sempre visibili. Una card che cambia posto
	// scorre con `flip`, una nuova entra con `chatReveal`; al montaggio e al
	// summon non si muove niente.
	import { flip } from 'svelte/animate';
	import { m } from '$lib/paraglide/messages.js';
	import { taskStore } from '$lib/stores/tasks.svelte';
	import { chatReveal, revealEase } from '$lib/agent/motion';
	import { motionReduced, ROW_EXIT_MS } from '$lib/agent/motionState.svelte';
	import CompanionProjectCard from './CompanionProjectCard.svelte';
	import type { Project } from '$lib/stores/projects.svelte';
	import type { AttentionRequest, CompanionProjectRuntime } from '$lib/stores/companion.svelte';
	import type { CompanionAskHandlers } from './companionAsk';

	let {
		projects,
		hues,
		runtimes,
		attentionList,
		ask,
		onFocusProject,
		onNewTask,
		onRunTask,
		onToggleUsage
	} = $props<{
		projects: Project[];
		/** Tinta d'identita' per progetto, calcolata dalla vista. */
		hues: Map<string, number>;
		runtimes: CompanionProjectRuntime[];
		attentionList: AttentionRequest[];
		ask: CompanionAskHandlers;
		onFocusProject: (projectId: string) => void;
		onNewTask: (project: Project) => void;
		onRunTask: (projectId: string, taskId: string) => void;
		onToggleUsage?: () => void;
	}>();

	function attentionsFor(projectId: string): AttentionRequest[] {
		return attentionList.filter(
			(a: AttentionRequest) => a.projectId.toLowerCase() === projectId.toLowerCase()
		);
	}

	function queuedFor(project: Project) {
		if (!project.canonicalProjectPath) return [];
		return taskStore.tasksFor(project.canonicalProjectPath).filter((t) => t.status === 'queued');
	}
</script>

{#if projects.length > 0}
	<section class="project-cards" aria-label={m.companion_cards_aria()}>
		{#each projects as p (p.id)}
			{@const attentions = attentionsFor(p.id)}
			<!-- La card con una domanda aperta prende tutta la riga: lo spazio
			     serve alle opzioni da premere, e le altre scendono sotto. -->
			<div
				class="project-card-slot"
				class:wide={attentions.length > 0}
				transition:chatReveal
				animate:flip={{ duration: motionReduced() ? 0 : ROW_EXIT_MS, easing: revealEase }}
			>
				<CompanionProjectCard
					project={p}
					hue={hues.get(p.id) ?? p.hue}
					runtime={runtimes.find((r: CompanionProjectRuntime) => r.projectId === p.id)}
					attention={attentions[0] ?? null}
					{attentions}
					queued={queuedFor(p)}
					{ask}
					{onFocusProject}
					{onNewTask}
					{onRunTask}
					{onToggleUsage}
				/>
			</div>
		{/each}
	</section>
{/if}
