import { getLocale } from '#lib/paraglide/runtime.js';
import { projectStore, normalizeProjectPath, type Project } from './projects.svelte';
import { settingsStore } from './settings.svelte';
import { taskStore } from './tasks.svelte';
import { githubStore } from './github.svelte';
import { groupByRepository, type RepositoryIdentity } from './projectIdentity.ts';

/**
 * Identità git di una copia. Lo stato upstream è già letto e in cache per ogni
 * progetto mostrato in barra (`upstreamByPath`), quindi non serve una seconda
 * interrogazione: se non c'è ancora, la copia resta senza identità e non si
 * fonde per sbaglio.
 */
function identityOfCopy(project: Project): RepositoryIdentity {
	const path = project.canonicalProjectPath;
	if (!path) return {};
	const key = normalizeProjectPath(path).toLowerCase();
	const status = githubStore.upstreamByPath[key];
	return { repoSlug: status?.repoSlug ?? null, rootCommit: status?.rootCommit ?? null };
}

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
	/**
	 * Le copie dello stesso repository raggruppate per identità (R-MI-12).
	 * La barra mostra una tessera per gruppo tramite `unified`; `list` resta
	 * l'elenco piatto perché molti chiamanti conoscono una sola copia e non
	 * devono cambiare.
	 */
	get groups(): Project[][] {
		// Si parte da `list`, non dall'array grezzo: la barra itera `unified` e
		// l'ordinamento scelto (alfabetico, priorità, recenti) deve valere anche lì.
		const projects = this.list;
		return groupByRepository(projects.map((p) => identityOfCopy(p))).map((indices) =>
			indices.map((index) => projects[index])
		);
	}

	/**
	 * Un progetto per repository. Rappresentante: la copia che si sta
	 * guardando — l'ultima usata, che è anche la macchina proposta per una
	 * nuova chat (F16, ripristinata in F18) — altrimenti la prima nell'ordine.
	 */
	get unified(): Project[] {
		return this.groups.map((group) => {
			if (group.length === 1) return group[0];
			return group.find((p) => p.id === projectStore.activeId) ?? group[0];
		});
	}

	/** Le altre copie dello stesso progetto, per il segno nella tessera. */
	copiesOf(project: Project): Project[] {
		const groups = this.groups;
		const group = groups.find((members) => members.some((p) => p.id === project.id));
		return group ? group.filter((p) => p.id !== project.id) : [];
	}

	get list(): Project[] {
		const projects = projectStore.projects.filter((p) => !p.external);
		const order = settingsStore.projectBar.order;

		if (order === 'alpha') {
			return [...projects].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
		}

		if (order === 'priority') {
			const entries = projects.map((p, index) => {
				const queued = p.canonicalProjectPath
					? taskStore.queuedCountFor(p.canonicalProjectPath)
					: 0;
				let rank: number;
				if (p.lane.agentState === 'attention') rank = 0;
				else if (queued > 0) rank = 1;
				else if (p.lane.agentState === 'working') rank = 2;
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
		return projects;
	}
}

export const projectOrder = new ProjectOrder();
