/**
 * Controllo «manca un commit da origin» prima di avviare un lavoro (IMP-007).
 *
 * La domanda dell'utente era esplicita: il controllo riguarda tutte le copie
 * del progetto, non solo quella che eseguirà il lavoro («su tutte, sì
 * ovviamente deve essere forzabile»). Ogni copia in linea viene riletta da
 * git sulla macchina che la possiede, con un fetch prima di leggere (i ref di
 * tracking da soli possono essere vecchi); una copia spenta o non aggiornata
 * con successo viene dichiarata «non verificata», senza bloccare l'avvio su un
 * sospetto.
 *
 * Il risultato non decide nulla: l'avviso elenca le copie indietro e l'utente
 * sceglie se aggiornare prima o partire comunque. Nessuna politica di retry
 * nuova: l'aggiornamento è lo stesso pull fast-forward delle superfici Git.
 */

import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { githubStore } from './github.svelte';
import { machineName, projectGroup } from './projectMachines.svelte';
import { type Project } from './projects.svelte';

/** Una copia del progetto indietro rispetto al suo upstream. */
export interface BehindCopy {
	project: Project;
	/** Nome leggibile della macchina che possiede la copia. */
	machine: string;
	machineId: string;
	branch: string;
	/** Commit mancanti da origin. */
	behind: number;
	upstream: string | null;
}

export interface OriginCheck {
	behind: BehindCopy[];
	/** Copie non interrogabili: macchina spenta, incompatibile o senza git. */
	unchecked: Array<{ project: Project; machine: string; machineId: string }>;
}

export interface UpdateOutcome {
	updated: string[];
	failed: Array<{ machine: string; error: string }>;
}

/**
 * Rilegge da git tutte le copie in linea, con un fetch vero prima di leggere:
 * i ref di tracking possono essere vecchi, e dire «a posto» su un `origin` che
 * non si aggiorna da giorni sarebbe la risposta sbagliata. Il fetch è lo stesso
 * `git_sync_repo` delle superfici Git, senza pull: non tocca il checkout.
 * Una copia di cui il fetch non riesce non è dichiarata aggiornata.
 */
export async function checkOriginBehind(project: Project): Promise<OriginCheck> {
	const behind: BehindCopy[] = [];
	const unchecked: OriginCheck['unchecked'] = [];
	for (const copy of projectGroup(project)) {
		const path = copy.canonicalProjectPath;
		const machineId = copy.machineId ?? LOCAL_MACHINE;
		const peer = machineId === LOCAL_MACHINE ? null : linkStore.machineFor(machineId);
		if (!path || (machineId !== LOCAL_MACHINE && !(peer?.online && peer.compatible))) {
			unchecked.push({ project: copy, machine: machineName(machineId), machineId });
			continue;
		}
		let fetched = true;
		try {
			await invoke<string>('git_sync_repo', { projectPath: path, action: 'fetch' }, { machine: machineId });
		} catch {
			fetched = false;
		}
		const status = await githubStore.loadUpstreamStatus(path, true, machineId).catch(() => null);
		if (!status?.isGit) {
			unchecked.push({ project: copy, machine: machineName(machineId), machineId });
			continue;
		}
		if (status.behind > 0) {
			behind.push({
				project: copy,
				machine: machineName(machineId),
				machineId,
				branch: status.branch,
				behind: status.behind,
				upstream: status.upstream
			});
			continue;
		}
		// «Aggiornata» si può dire solo dopo un fetch riuscito: senza, i ref di
		// tracking non provano nulla.
		if (!fetched) unchecked.push({ project: copy, machine: machineName(machineId), machineId });
	}
	return { behind, unchecked };
}

/**
 * Aggiorna le copie indietro con un pull fast-forward, ognuna sulla propria
 * macchina. Un errore non nasconde gli altri: ogni copia riporta il suo esito.
 */
export async function updateBehindCopies(copies: readonly BehindCopy[]): Promise<UpdateOutcome> {
	const updated: string[] = [];
	const failed: UpdateOutcome['failed'] = [];
	for (const copy of copies) {
		const path = copy.project.canonicalProjectPath;
		if (!path) continue;
		try {
			await invoke<string>('git_sync_repo', { projectPath: path, action: 'pull-ff' }, {
				machine: copy.machineId
			});
			// Il pannello Git legge per percorso: la copia appena mossa va riletta.
			await githubStore.loadUpstreamStatus(path, true, copy.machineId);
			updated.push(copy.machine);
		} catch (error) {
			failed.push({ machine: copy.machine, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { updated, failed };
}
