import { projectStore, type Project } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { taskStore } from './tasks.svelte';

/**
 * Vista ordinata dei progetti secondo `settingsStore.projectBar.order`.
 *
 * Il modulo esiste per rompere un ciclo di import: `tasks.svelte.ts` importa
 * `projects.svelte.ts` per seminare i default dei task, quindi
 * `projects.svelte.ts` non puo' importare `tasks.svelte.ts` per leggere la
 * coda (serve all'ordinamento `priority`). Questo file sta sopra entrambi e
 * li combina solo per la vista: `fixed`/`mru` restano l'array cosi' com'e',
 * `priority`/`alpha` sono proiezioni che non toccano mai `projectStore.projects`,
 * cosi' tornando a `fixed` l'ordine manuale e' intatto.
 */
class ProjectOrder {
	get list(): Project[] {
		const order = settingsStore.projectBar.order;

		if (order === 'alpha') {
			return [...projectStore.projects].sort((a, b) => a.name.localeCompare(b.name, 'it'));
		}

		if (order === 'priority') {
			const entries = projectStore.projects.map((p, index) => {
				const queued = taskStore.queuedCountFor(p.path);
				let rank: number;
				if (p.agentState === 'attention') rank = 0;
				else if (queued > 0) rank = 1;
				else if (p.agentState === 'working') rank = 2;
				else rank = 3;
				return { p, index, rank, queued };
			});
			entries.sort((a, b) => {
				if (a.rank !== b.rank) return a.rank - b.rank;
				// A parita' di fascia, la coda piu' numerosa viene prima.
				if (a.rank === 1 && a.queued !== b.queued) return b.queued - a.queued;
				// A pari merito l'ordine manuale (indice originale) resta stabile.
				return a.index - b.index;
			});
			return entries.map((entry) => entry.p);
		}

		// 'fixed': l'ordine manuale e' l'unica verita'. 'mru': l'array e' gia'
		// mantenuto in ordine da `projectStore.setActive`.
		return projectStore.projects;
	}
}

export const projectOrder = new ProjectOrder();
