/**
 * Sincronizzazione delle copie dello stesso progetto su più macchine
 * (R-MI-26, R-MI-27). Ogni finestra si occupa solo delle proprie copie: legge
 * i commit delle gemelle in linea e avanza con un fast-forward quando la
 * cartella è libera. Chi possiede la copia è anche l'unico che sa se l'editor
 * ha file non salvati o un agente sta scrivendo lì.
 */

import { untrack } from 'svelte';
import { invoke, isTauri, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { m } from '#lib/paraglide/messages.js';
import { githubStore } from './github.svelte';
import { busyPaths } from './copyBusy.ts';
import { machineAlertFeed } from './machineAlertFeed.svelte.ts';
import { normalizeProjectPath, projectStore, type Project } from './projects.svelte';
import { projectOrder } from './projectOrder.svelte';
import type { CaseConflict } from './projectCopies.ts';
import {
	emptySyncRetry,
	recordSyncFailure,
	recordSyncSuccess,
	syncDue,
	syncRetryDelay,
	type SyncRetryState
} from './copySyncRetry.ts';

export type BranchSyncState =
	| 'equal'
	| 'ahead'
	/** Commit propri su entrambe le copie e l'unione ha conflitti (R-MI-61). */
	| 'diverged'
	/** Commit arrivati e copia avanzata (R-MI-27): `behind` e' quanti. */
	| 'advanced'
	/** Era divergente, nessun conflitto: la copia e' sul commit di unione (R-MI-61). */
	| 'merged'
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
	 * Per `pending`: `busy` (agente/editor/automazione), `detached` (HEAD
	 * staccato), `conflict:<file>[,<file>…]` (modifiche locali che non si
	 * riapplicano, R-MI-47), altrimenti il messaggio di git. Per `diverged`:
	 * `conflict:<file>[,<file>…]` con i file che git non unisce da solo
	 * (R-MI-61). Per `merged`: `journal` quando le modifiche delle due parti
	 * stavano solo in `docs/diario/`, altrimenti `null`.
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
	/** Commit arrivati (`advanced` e `merged`, il loro `behind`). */
	advanced: number;
	/** Questa macchina ha unito una branch divergente senza conflitti (R-MI-61). */
	merged: boolean;
	/** L'unione riguardava solo il diario: l'avviso dice «Diario unito» (R-MI-48). */
	journalOnly: boolean;
	/** Avanzamenti rimasti indietro con il motivo, uno per branch. */
	blocked: Array<{ branch: string; reason: string; behind: number }>;
	/** Cima della copia locale dopo il giro: distingue commit nuovi da un conteggio uguale. */
	head: string | null;
}

/** Ogni quanto si rilegge l'altra macchina anche senza segnali di cambio. */
const SYNC_INTERVAL_MS = 60_000;
/** Con la finestra visibile le cime delle gemelle si rileggono spesso (R-MI-57). */
const HEAD_REFRESH_VISIBLE_MS = 10_000;
/** Da nascosta basta un minuto: nessuno sta guardando la tessera. */
const HEAD_REFRESH_HIDDEN_MS = 60_000;
/** Ogni quanto si guarda se il progetto attivo o le macchine in linea sono cambiati. */
const TRANSITION_POLL_MS = 2_000;

function isLocal(project: Project): boolean {
	return !project.machineId || project.machineId === LOCAL_MACHINE;
}

function reportKey(localId: string, machine: string): string {
	return `${localId}|${machine}`;
}

/**
 * Cartelle della copia locale che non si toccano (R-MI-57, D1, D2). La regola
 * sta in `copyBusy.ts`, che `githubStore` usa senza cicli; qui resta
 * esportata perche' e' da qui che la cercano i chiamanti (contratto di
 * `copy_sync`).
 */
export { busyPaths } from './copyBusy.ts';

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
	/** Fallimenti e attese per coppia (R-MI-57). */
	private retryHistory = new Map<string, SyncRetryState>();
	private retryTimers = new Map<string, number>();
	/** Pulizia di `start()`: la pagina la chiama una volta sola. */
	private stopper: (() => void) | null = null;

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

	/**
	 * Giro di tutti i pari. Chi ha appena fallito aspetta la sua attesa
	 * crescente: ci pensa il timer di `scheduleRetry`, non il minuto, o si
	 * tenterebbe a ogni giro vanificando il ritento lento (R-MI-57).
	 */
	syncAll(): void {
		const now = Date.now();
		for (const pair of this.pairs()) {
			if (!syncDue(this.retryHistory.get(pair.key) ?? emptySyncRetry(), now)) continue;
			void this.sync(pair);
		}
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
			this.retryHistory.set(pair.key, recordSyncSuccess());
			const moved = report.branches.filter((branch) =>
				branch.state === 'advanced' || branch.state === 'merged');
			const merged = report.branches.filter((branch) => branch.state === 'merged');
			this.outcomes[pair.key] = {
				at: Date.now(),
				machine: pair.remote.machineId ?? '',
				advanced: moved.reduce((count, branch) => count + branch.behind, 0),
				merged: merged.length > 0,
				journalOnly: merged.some((branch) => branch.reason === 'journal'),
				blocked: report.branches
					.filter((branch) => branch.state === 'pending' && branch.reason)
					.map((branch) => ({ branch: branch.name, reason: branch.reason ?? '', behind: branch.behind })),
				head: report.branches.find((branch) => branch.local)?.local ?? null
			};
			this.lastSyncAt[pair.key] = Date.now();
			if (moved.length > 0 && pair.local.canonicalProjectPath) {
				// Dopo un avanzamento la barra (stato git, divergenza) deve vederlo
				// subito e origin va riletto: i commit gia' pubblicati dall'altra
				// macchina non devono risultare «da pubblicare» (R-MI-58).
				void githubStore.loadUpstreamStatus(pair.local.canonicalProjectPath, true);
				void githubStore.checkRemote(pair.local.canonicalProjectPath, true);
			}
			return report;
		} catch (error) {
			// Un giro gia' in corso nel backend non e' un errore da mostrare.
			const text = String(error);
			if (text.includes('sync already running')) return null;
			this.errors[pair.key] = text;
			this.failed(pair, text);
			return null;
		} finally {
			this.inFlight.delete(pair.key);
			delete this.active[pair.key];
		}
	}

	/**
	 * Un giro fallito (R-MI-57): si ritenta con attesa crescente e, dopo tre
	 * fallimenti di fila, l'avviso delle macchine lo dice una volta sola. Gli
	 * errori non restano piu' solo nel pannello.
	 */
	private failed(pair: SyncPair, reason: string): void {
		const previous = this.retryHistory.get(pair.key) ?? emptySyncRetry();
		const { state, alertReason } = recordSyncFailure(previous, reason, Date.now());
		this.retryHistory.set(pair.key, state);
		if (alertReason !== null) {
			const machine = pair.remote.machineId ?? '';
			const name = linkStore.machineFor(machine)?.name ?? machine;
			machineAlertFeed.announce(m.copies_sync_error({ machine: name, error: alertReason }));
		}
		this.scheduleRetry(pair, syncRetryDelay(state.failures));
	}

	private scheduleRetry(pair: SyncPair, delay: number): void {
		window.clearTimeout(this.retryTimers.get(pair.key));
		this.retryTimers.set(pair.key, window.setTimeout(() => {
			this.retryTimers.delete(pair.key);
			void this.sync(pair);
		}, delay));
	}

	/**
	 * Rilegge la cima delle copie delle gemelle: e' l'unico modo perche' un
	 * commit dell'altra macchina si veda entro dieci secondi (R-MI-57). Solo
	 * con la finestra visibile si paga questo giro; da nascosta resta il
	 * minuto di `syncAll`.
	 */
	private refreshPeerHeads(): void {
		for (const pair of this.pairs()) {
			const path = pair.remote.canonicalProjectPath;
			if (!path) continue;
			void githubStore.loadUpstreamStatus(path, true, pair.remote.machineId);
		}
	}

	/**
	 * Avvia i giri automatici (R-MI-57): un giro quando cambia un'impronta
	 * (effetto della pagina), il ritmo breve sulle cime delle gemelle, e i
	 * segnali che dicono «sei tornato»: fuoco o visibilita' della finestra,
	 * progetto attivato, macchina tornata in linea. Il minuto resta come rete
	 * di sicurezza. Restituisce la pulizia.
	 */
	start(): () => void {
		if (this.stopper !== null) return this.stopper;
		const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
		const timer = setInterval(() => this.syncAll(), SYNC_INTERVAL_MS);
		// Visibile si legge ogni dieci secondi; da nascosta basta un tick su sei.
		let ticks = 0;
		const heads = setInterval(() => {
			ticks += 1;
			if (visible() || ticks % (HEAD_REFRESH_HIDDEN_MS / HEAD_REFRESH_VISIBLE_MS) === 0) {
				this.refreshPeerHeads();
			}
		}, HEAD_REFRESH_VISIBLE_MS);
		const wake = () => {
			this.refreshPeerHeads();
			this.syncAll();
		};
		// Solo al ritorno: nascondere la finestra non e' un segnale per rileggere.
		const onVisibility = () => {
			if (visible()) wake();
		};

		// Progetto attivato e macchina tornata in linea sono transizioni, non
		// valori: si guardano da un giro leggero invece che da un effetto, cosi'
		// `start()` resta chiamabile da qualunque punto (lo fa la pagina dentro
		// un `$effect`) senza creare una radice di effetti annidata.
		let activeId = untrack(() => projectStore.activeId);
		let online = untrack(() => this.onlineSignature());
		const transitions = setInterval(() => {
			const nextActive = projectStore.activeId;
			const nextOnline = this.onlineSignature();
			const peerBack = nextOnline !== online && linkStore.status.peers.some((peer) => peer.online);
			const projectChanged = nextActive !== activeId;
			activeId = nextActive;
			online = nextOnline;
			if (peerBack || projectChanged) wake();
		}, TRANSITION_POLL_MS);

		if (typeof window !== 'undefined') {
			window.addEventListener('focus', wake);
			document.addEventListener('visibilitychange', onVisibility);
		}
		this.stopper = () => {
			clearInterval(timer);
			clearInterval(heads);
			clearInterval(transitions);
			if (typeof window !== 'undefined') {
				window.removeEventListener('focus', wake);
				document.removeEventListener('visibilitychange', onVisibility);
			}
			for (const id of this.retryTimers.values()) window.clearTimeout(id);
			this.retryTimers.clear();
			this.stopper = null;
		};
		return this.stopper;
	}

	/** Chi e' in linea adesso: la forma cambia solo quando cambia la presenza. */
	private onlineSignature(): string {
		return linkStore.status.peers.map((peer) => `${peer.id}:${peer.online}`).join('|');
	}

	/**
	 * Branch divergenti con la gemella che li ha causati e i file in conflitto
	 * (R-MI-61): serve a «Risolvi», che deve sapere quale ref unire.
	 */
	divergedDetails(local: Project): Array<{ branch: BranchSync; machine: string }> {
		const prefix = `${local.id}|`;
		const seen = new Set<string>();
		const result: Array<{ branch: BranchSync; machine: string }> = [];
		for (const [key, report] of Object.entries(this.reports)) {
			if (!key.startsWith(prefix)) continue;
			const machine = key.slice(prefix.length);
			if (!this.reachable(machine)) continue;
			for (const branch of report.branches) {
				if (branch.state !== 'diverged' || seen.has(branch.name)) continue;
				seen.add(branch.name);
				result.push({ branch, machine });
			}
		}
		return result;
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
