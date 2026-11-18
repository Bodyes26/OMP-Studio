/**
 * Sincronizzazione delle copie dello stesso progetto su più macchine
 * (R-MI-26, R-MI-27). Ogni finestra si occupa solo delle proprie copie: legge
 * i commit delle gemelle in linea e avanza con un fast-forward quando la
 * cartella è libera. Chi possiede la copia è anche l'unico che sa se l'editor
 * ha file non salvati o un agente sta scrivendo lì.
 */

import { invoke, isTauri, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { sessionRegistry } from '#lib/agent/sessionRegistry.ts';
import { getDirtyEditorPaths } from '#lib/editor/editorActivity.svelte.ts';
import type { ProjectId } from '#lib/types/lanes.ts';
import { githubStore } from './github.svelte';
import { laneStore } from './lanes.svelte';
import { normalizeProjectPath, type Project } from './projects.svelte';
import { projectOrder } from './projectOrder.svelte';

export type BranchSyncState = 'equal' | 'ahead' | 'diverged' | 'advanced' | 'pending' | 'onlyPeer';

export interface BranchSync {
	name: string;
	local: string | null;
	peer: string;
	ahead: number;
	behind: number;
	state: BranchSyncState;
	/** Per `pending`: `busy`, `dirty` o il messaggio di git. */
	reason: string | null;
}

export interface CopySyncReport {
	machine: string;
	branches: BranchSync[];
}

/** Ogni quanto si rilegge l'altra macchina anche senza segnali di cambio. */
const SYNC_INTERVAL_MS = 60_000;

function isLocal(project: Project): boolean {
	return !project.machineId || project.machineId === LOCAL_MACHINE;
}

function reportKey(localId: string, machine: string): string {
	return `${localId}|${machine}`;
}

/**
 * Cartelle della copia locale che non si toccano: corsie con un agente al
 * lavoro o in attesa (anche guidato da un'altra macchina, R-MI-18) e file non
 * salvati nell'editor. Rust le confronta con la cartella di ogni branch.
 */
function busyPaths(local: Project): string[] {
	const paths = new Set(getDirtyEditorPaths());
	const sessionsBusy = sessionRegistry.getSessionsForProject(local.id)
		.some((session) => session.agentState === 'working' || session.pendingUi);
	for (const lane of laneStore.lanesFor(local.id as ProjectId)) {
		const path = lane.workspacePath;
		if (!path) continue;
		const busy = lane.agentState === 'working' || lane.agentState === 'attention'
			|| linkStore.laneBusyRemotely(local.id, lane.laneId);
		if (busy) paths.add(path);
	}
	// Una sessione aperta senza corsia nota occupa la cartella principale.
	if (sessionsBusy && local.canonicalProjectPath) paths.add(local.canonicalProjectPath);
	return [...paths];
}

interface SyncPair {
	key: string;
	local: Project;
	remote: Project;
}

class CopySyncStore {
	reports = $state<Record<string, CopySyncReport>>({});
	/** Ultimo errore per coppia: si mostra nel pannello, non blocca nulla. */
	errors = $state<Record<string, string>>({});
	private running = new Set<string>();
	private signatures = new Map<string, string>();

	reportFor(localId: string, machine: string): CopySyncReport | null {
		return this.reports[reportKey(localId, machine)] ?? null;
	}

	/** Coppie (copia di questa macchina, gemella in linea e compatibile). */
	pairs(): SyncPair[] {
		const result: SyncPair[] = [];
		for (const group of projectOrder.groups) {
			const local = group.find(isLocal);
			if (!local?.canonicalProjectPath) continue;
			for (const remote of group) {
				if (remote === local || !remote.machineId || !remote.canonicalProjectPath) continue;
				const machine = linkStore.machineFor(remote.machineId);
				if (!machine?.online || !machine.compatible) continue;
				result.push({ key: reportKey(local.id, remote.machineId), local, remote });
			}
		}
		return result;
	}

	/**
	 * Impronta di ciò che può cambiare l'esito: cime note delle due copie e
	 * cartelle occupate. Letta dentro un `$effect`, rilancia il giro quando
	 * l'altra macchina committa o la corsia si libera.
	 */
	signature(pair: SyncPair): string {
		const head = (path: string | null | undefined) =>
			path ? githubStore.upstreamByPath[normalizeProjectPath(path).toLowerCase()]?.headCommit ?? '-' : '-';
		return [head(pair.remote.canonicalProjectPath), head(pair.local.canonicalProjectPath), ...busyPaths(pair.local).sort()].join('|');
	}

	/** Giro solo se l'impronta è cambiata dall'ultimo. */
	syncIfChanged(pair: SyncPair, signature: string): void {
		if (this.signatures.get(pair.key) === signature) return;
		this.signatures.set(pair.key, signature);
		void this.sync(pair);
	}

	syncAll(): void {
		for (const pair of this.pairs()) void this.sync(pair);
	}

	async sync(pair: SyncPair): Promise<CopySyncReport | null> {
		if (!isTauri() || this.running.has(pair.key)) return null;
		this.running.add(pair.key);
		try {
			const report = await invoke<CopySyncReport>('copy_sync', {
				projectPath: pair.local.canonicalProjectPath,
				machine: pair.remote.machineId,
				peerPath: pair.remote.canonicalProjectPath,
				busyPaths: busyPaths(pair.local)
			});
			this.reports[pair.key] = report;
			delete this.errors[pair.key];
			// Dopo un avanzamento la barra (stato git, divergenza) deve vederlo subito.
			if (report.branches.some((branch) => branch.state === 'advanced') && pair.local.canonicalProjectPath) {
				void githubStore.loadUpstreamStatus(pair.local.canonicalProjectPath, true);
			}
			return report;
		} catch (error) {
			// Un giro gia' in corso nel backend non e' un errore da mostrare.
			const text = String(error);
			if (!text.includes('sync already running')) this.errors[pair.key] = text;
			return null;
		} finally {
			this.running.delete(pair.key);
		}
	}

	/**
	 * Avvia i giri automatici: subito quando cambia un'impronta, comunque ogni
	 * minuto per le branch che la barra non osserva. Restituisce la pulizia.
	 */
	start(): () => void {
		const timer = setInterval(() => this.syncAll(), SYNC_INTERVAL_MS);
		return () => clearInterval(timer);
	}

	/** Branch della copia locale di questo gruppo che divergono da una gemella. */
	divergedBranches(local: Project): string[] {
		return this.branchesIn(local, 'diverged');
	}

	/** Branch indietro che aspettano la cartella libera («da aggiornare»). */
	pendingBranches(local: Project): BranchSync[] {
		const seen = new Set<string>();
		const result: BranchSync[] = [];
		for (const [key, report] of Object.entries(this.reports)) {
			if (!key.startsWith(`${local.id}|`)) continue;
			for (const branch of report.branches) {
				if (branch.state === 'pending' && !seen.has(branch.name)) {
					seen.add(branch.name);
					result.push(branch);
				}
			}
		}
		return result;
	}

	private branchesIn(local: Project, state: BranchSyncState): string[] {
		const names = new Set<string>();
		for (const [key, report] of Object.entries(this.reports)) {
			if (!key.startsWith(`${local.id}|`)) continue;
			for (const branch of report.branches) if (branch.state === state) names.add(branch.name);
		}
		return [...names];
	}
}

export const copySyncStore = new CopySyncStore();
