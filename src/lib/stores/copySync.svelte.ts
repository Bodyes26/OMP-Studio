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
import type { CaseConflict } from './projectCopies.ts';

export type BranchSyncState =
	| 'equal'
	| 'ahead'
	| 'diverged'
	/** Commit arrivati e copia avanzata (R-MI-27): `behind` e' quanti. */
	| 'advanced'
	/** La branch divergeva solo sul diario e questa macchina ha unito (R-MI-48). */
	| 'mergedJournal'
	| 'pending'
	| 'onlyPeer'
	| 'caseConflict';

export interface BranchSync {
	name: string;
	local: string | null;
	peer: string;
	ahead: number;
	behind: number;
	state: BranchSyncState;
	/**
	 * Per `pending`: `busy` (agente/editor/automazione), `journalPeer` (diario
	 * divergente, unisce l'altra macchina), `detached` (HEAD staccato),
	 * `conflict:<file>[,<file>…]` (modifiche locali che non si riapplicano,
	 * R-MI-47), altrimenti il messaggio di git.
	 */
	reason: string | null;
}

export interface CopySyncReport {
	machine: string;
	branches: BranchSync[];
}

/**
 * Esito riassunto di un giro, quello che serve alla barra e agli avvisi
 * (R-MI-49, R-MI-50, R-MI-51): quanti commit sono arrivati, se il diario e'
 * stato unito, cosa resta bloccato e perche'.
 */
export interface SyncOutcome {
	at: number;
	machine: string;
	/** Commit arrivati (`advanced` e `mergedJournal`, il loro `behind`). */
	advanced: number;
	mergedJournal: boolean;
	/** Avanzamenti rimasti indietro con il motivo, uno per branch. */
	blocked: Array<{ branch: string; reason: string; behind: number }>;
	/** Cima della copia locale dopo il giro: distingue commit nuovi da un conteggio uguale. */
	head: string | null;
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
export function busyPaths(local: Project): string[] {
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
	/**
	 * Coppie con un giro in corso: la tessera anima le frecce e il chip della
	 * barra mostra l'indicatore finche' c'e' almeno una chiave (R-MI-49,
	 * R-MI-50). Reattivo, a differenza del Set che serve solo a non sovrapporre
	 * due giri della stessa coppia.
	 */
	active = $state<Record<string, true>>({});
	/** Esito dell'ultimo giro concluso per coppia, per barra e avvisi (R-MI-51). */
	outcomes = $state<Record<string, SyncOutcome>>({});
	/** Ultimo giro concluso per coppia, in ms epoch (R-MI-50). */
	lastSyncAt = $state<Record<string, number>>({});
	private inFlight = new Set<string>();
	private signatures = new Map<string, string>();

	reportFor(localId: string, machine: string): CopySyncReport | null {
		if (!this.reachable(machine)) return null;
		return this.reports[reportKey(localId, machine)] ?? null;
	}

	/** Un giro che riguarda questa copia locale e' in corso? */
	runningFor(localId: string): boolean {
		const prefix = `${localId}|`;
		return Object.keys(this.active).some((key) => key.startsWith(prefix));
	}

	/** Almeno un giro in corso in tutta la finestra: anima il chip «Macchine». */
	get anyRunning(): boolean {
		return Object.keys(this.active).length > 0;
	}

	/** Ultima sincronizzazione di questa copia, tutte le gemelle: la piu' recente. */
	lastSyncFor(localId: string): number | null {
		const prefix = `${localId}|`;
		let latest: number | null = null;
		for (const [key, at] of Object.entries(this.lastSyncAt)) {
			if (!key.startsWith(prefix)) continue;
			if (latest === null || at > latest) latest = at;
		}
		return latest;
	}

	/** Esito dell'ultimo giro con una gemella raggiungibile. */
	outcomeFor(localId: string, machine: string): SyncOutcome | null {
		if (!this.reachable(machine)) return null;
		return this.outcomes[reportKey(localId, machine)] ?? null;
	}

	private reachable(machineId: string): boolean {
		const machine = linkStore.machineFor(machineId);
		return Boolean(machine?.online && machine.compatible);
	}

	/** Coppie (copia di questa macchina, gemella in linea e compatibile). */
	pairs(): SyncPair[] {
		const result: SyncPair[] = [];
		for (const group of projectOrder.groups) {
			const local = group.find(isLocal);
			if (!local?.canonicalProjectPath) continue;
			for (const remote of group) {
				if (remote === local || !remote.machineId || !remote.canonicalProjectPath) continue;
				if (!this.reachable(remote.machineId)) {
					// Al ritorno in linea il giro deve ripartire subito, anche se
					// cime e cartelle occupate sono le stesse di prima.
					this.signatures.delete(reportKey(local.id, remote.machineId));
					continue;
				}
				result.push({ key: reportKey(local.id, remote.machineId), local, remote });
			}
		}
		return result;
	}

	/**
	 * Impronta di ciò che può cambiare l'esito: cime note delle due copie,
	 * numero di file modificati e cartelle occupate. Letta dentro un `$effect`,
	 * rilancia il giro quando l'altra macchina committa, quando l'editor salva
	 * o cambia i file aperti (R-MI-47: un file sporco che i commit non toccano
	 * non blocca piu', ma se tocca bisogna riprovare) o quando la corsia si libera.
	 */
	signature(pair: SyncPair): string {
		const remoteKey = pair.remote.canonicalProjectPath ? normalizeProjectPath(pair.remote.canonicalProjectPath).toLowerCase() : '';
		const localKey = pair.local.canonicalProjectPath ? normalizeProjectPath(pair.local.canonicalProjectPath).toLowerCase() : '';
		const remoteGit = remoteKey ? githubStore.upstreamByPath[remoteKey] : undefined;
		const localGit = localKey ? githubStore.upstreamByPath[localKey] : undefined;
		return [
			remoteGit?.headCommit ?? '-',
			localGit?.headCommit ?? '-',
			localGit ? String(localGit.changedFiles ?? (localGit.hasUncommitted ? 1 : 0)) : '-',
			...busyPaths(pair.local).sort()
		].join('|');
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
		if (!isTauri() || this.inFlight.has(pair.key)) return null;
		this.inFlight.add(pair.key);
		this.active[pair.key] = true;
		try {
			const report = await invoke<CopySyncReport>('copy_sync', {
				projectPath: pair.local.canonicalProjectPath,
				machine: pair.remote.machineId,
				peerPath: pair.remote.canonicalProjectPath,
				busyPaths: busyPaths(pair.local)
			});
			this.reports[pair.key] = report;
			delete this.errors[pair.key];
			const moved = report.branches.filter((branch) =>
				branch.state === 'advanced' || branch.state === 'mergedJournal');
			this.outcomes[pair.key] = {
				at: Date.now(),
				machine: pair.remote.machineId ?? '',
				advanced: moved.reduce((count, branch) => count + branch.behind, 0),
				mergedJournal: report.branches.some((branch) => branch.state === 'mergedJournal'),
				blocked: report.branches
					.filter((branch) => branch.state === 'pending' && branch.reason)
					.map((branch) => ({ branch: branch.name, reason: branch.reason ?? '', behind: branch.behind })),
				head: report.branches.find((branch) => branch.local)?.local ?? null
			};
			this.lastSyncAt[pair.key] = Date.now();
			// Dopo un avanzamento la barra (stato git, divergenza) deve vederlo subito.
			if (moved.length > 0 && pair.local.canonicalProjectPath) {
				void githubStore.loadUpstreamStatus(pair.local.canonicalProjectPath, true);
			}
			return report;
		} catch (error) {
			// Un giro gia' in corso nel backend non e' un errore da mostrare.
			const text = String(error);
			if (!text.includes('sync already running')) this.errors[pair.key] = text;
			return null;
		} finally {
			this.inFlight.delete(pair.key);
			delete this.active[pair.key];
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

	/** Branch che collidono per maiuscole con una gemella in linea (R-MI-35). */
	caseConflicts(local: Project): CaseConflict[] {
		const seen = new Set<string>();
		const result: CaseConflict[] = [];
		for (const report of this.liveReports(local)) {
			for (const branch of report.branches) {
				if (branch.state !== 'caseConflict' || seen.has(branch.name)) continue;
				seen.add(branch.name);
				result.push({ branch: branch.name, other: branch.reason ?? '' });
			}
		}
		return result;
	}

	/** Branch indietro che aspettano la cartella libera («da aggiornare»). */
	pendingBranches(local: Project): BranchSync[] {
		const seen = new Set<string>();
		const result: BranchSync[] = [];
		for (const report of this.liveReports(local)) {
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
		for (const report of this.liveReports(local)) {
			for (const branch of report.branches) if (branch.state === state) names.add(branch.name);
		}
		return [...names];
	}

	/**
	 * Esiti delle gemelle ancora raggiungibili. Quello di una macchina spenta
	 * descrive com'era al suo ultimo giro: lasciava accesi «≠» e «da
	 * aggiornare» per ore, finché la macchina non tornava (M9).
	 */
	private liveReports(local: Project): CopySyncReport[] {
		const result: CopySyncReport[] = [];
		const prefix = `${local.id}|`;
		for (const [key, report] of Object.entries(this.reports)) {
			if (!key.startsWith(prefix)) continue;
			if (this.reachable(key.slice(prefix.length))) result.push(report);
		}
		return result;
	}
}

export const copySyncStore = new CopySyncStore();
