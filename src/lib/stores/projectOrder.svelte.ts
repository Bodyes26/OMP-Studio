import { getLocale } from '#lib/paraglide/runtime.js';
import { projectStore, type Project } from './projects.svelte';
import { LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { settingsStore } from './settings.svelte';
import { taskStore } from './tasks.svelte';
import { githubStore } from './github.svelte';
import { groupByRepository, type RepositoryIdentity } from './projectIdentity.ts';
import { repositoryIdentityOf } from './projectCopyIdentity.ts';
import { copyKeyOf, projectLinks } from './projectLinks.svelte.ts';
import { tileCopy } from './projectCopies.ts';
import { copyNeedsAttention } from './projectActivity.ts';

/**
 * Identità di una copia per la barra (R-MI-45). Prima lo stato git fresco di
 * *quella* macchina, che conferma o corregge; se non c'è ancora, l'ultima
 * identità nota (snapshot dell'host o record salvato), così la tessera è unita
 * dal primo disegno senza aspettare git e senza un clic.
 */
function identityOfCopy(project: Project, multiMachine: boolean): RepositoryIdentity {
	const path = project.canonicalProjectPath;
	if (!path) return {};
	void projectLinks.init();
	// `upstreamFor` distingue la macchina: due copie con lo stesso percorso su
	// macchine diverse non devono leggere la stessa riga di `upstreamByPath`.
	// La corsia può essere un worktree: la lettura git usa quella cartella,
	// l'identità resta del progetto, quindi si guardano entrambe le chiavi.
	const lanePath: string | null = project.lane.workspacePath ?? null;
	const status = githubStore.upstreamFor(project.machineId, path)
		?? (lanePath && lanePath !== (path as string)
			? githubStore.upstreamFor(project.machineId, lanePath)
			: null);
	const known = projectStore.knownIdentityOf(project);
	const repoSlug = status?.repoSlug ?? known?.repoSlug ?? null;
	const rootCommit = status?.rootCommit ?? known?.rootCommit ?? null;
	// La regola vive in `projectCopyIdentity.ts`: la usa anche la proiezione
	// verso il relay, e barra e telefono devono fondere le stesse copie.
	return repositoryIdentityOf({
		canonicalProjectPath: path,
		upstream: { repoSlug, rootCommit },
		// Nome attuale su GitHub: unisce la copia rimasta col nome di prima
		// di una rinomina (R-MI-32). Solo con progetti di altre macchine in
		// barra: su una macchina sola non c'è nulla da unire.
		canonicalSlug: repoSlug && multiMachine ? projectLinks.canonicalSlug(repoSlug) : null,
		multiMachine
	});
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
		const multiMachine = projects.some((p) => Boolean(p.machineId && p.machineId !== LOCAL_MACHINE));
		const identities = projects.map((p) => identityOfCopy(p, multiMachine));
		const groups = groupByRepository(identities);
		const edges: Array<{ a: number; b: number; at: number }> = [];
		const keys = projects.map(copyKeyOf);
		for (let a = 0; a < projects.length; a++) {
			const root = identities[a].rootCommit;
			if (!root || identities[a].repoSlug) continue;
			for (let b = a + 1; b < projects.length; b++) {
				if (identities[b].repoSlug || identities[b].rootCommit !== root) continue;
				const decision = projectLinks.decisionFor(keys[a], keys[b]);
				if (decision?.same && decision.root === root.toLowerCase()) edges.push({ a, b, at: decision.at });
			}
		}
		// Il primo commit da solo non collega due coppie di fork.
		edges.sort((a, b) => b.at - a.at || keys[a.a].localeCompare(keys[b.a]) || keys[a.b].localeCompare(keys[b.b]));
		for (const { a, b } of edges) {
			const left = groups.find((group) => group.includes(a))!;
			const right = groups.find((group) => group.includes(b))!;
			if (left === right || left.some((i) => right.some((j) => projectLinks.isRefused(keys[i], keys[j])))) continue;
			left.push(...right);
			left.sort((i, j) => i - j);
			groups.splice(groups.indexOf(right), 1);
		}
		return groups.sort((a, b) => a[0] - b[0]).map((indices) => indices.map((index) => projects[index]));
	}

	/**
	 * Un progetto per repository. Se una copia del gruppo è quella mostrata,
	 * è lei; altrimenti quella che aspetta una risposta, poi l'ultima usata
	 * (R-MI-24, F18). Clic, Ctrl+Tab e Ctrl+N aprono quindi il lavoro da
	 * riprendere invece di una sessione vuota su un'altra macchina.
	 */
	get unified(): Project[] {
		return this.groups.map((group) => group.length === 1
			? group[0]
			: group.find((p) => p.id === projectStore.activeId) ?? tileCopy(group, copyNeedsAttention) ?? group[0]
		);
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
