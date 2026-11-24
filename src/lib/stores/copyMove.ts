/**
 * Le modifiche non committate seguono il cambio di macchina (R-MI-28,
 * R-MI-63): nessuna domanda, nessuna scelta da fare. Cambiando macchina le
 * modifiche della copia di partenza arrivano su quella di arrivo; l'avviso
 * «Portate N modifiche da M» con «Annulla» le riporta indietro con lo stesso
 * procedimento.
 *
 * L'ordine conta: istantanea alla partenza, arrivo allineato ai commit,
 * applicazione, e solo dopo la conferma la partenza torna pulita (le
 * modifiche restano recuperabili dall'istantanea anche lì).
 */

import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { githubStore } from './github.svelte';

export interface WipSnapshot {
	id: string;
	commit: string;
	base: string;
	branch: string;
	files: number;
}

/** L'id con cui le altre macchine conoscono questa (o quella indicata). */
export function machineTrueId(machineId: string | undefined): string {
	return !machineId || machineId === LOCAL_MACHINE ? linkStore.status.machineId : machineId;
}

/**
 * Le due estremità di uno spostamento. I percorsi sono cartelle di lavoro:
 * la copia del progetto, oppure il worktree della corsia che si sposta.
 */
export interface WipMove {
	fromPath: string;
	toPath: string;
	/** Macchina che possiede la partenza; assente per questa. */
	fromMachine?: string;
	/** Macchina che possiede l'arrivo; assente per questa. */
	toMachine?: string;
	/**
	 * Cartelle occupate dell'arrivo, quando è questa macchina: le conosce solo
	 * la finestra che la possiede. Il backend dell'arrivo controlla comunque
	 * agenti e automazioni da sé.
	 */
	busyPaths?: string[];
}

/**
 * Le modifiche sono arrivate, ma la partenza non è stata ripulita: il
 * collegamento è caduto fra le due conferme. Su entrambe le copie ci sono le
 * stesse modifiche e l'istantanea resta recuperabile; va detto all'utente
 * invece di riprovare a spostarle (l'arrivo ora è sporco).
 */
export class MoveNotFinishedError extends Error {
	readonly snapshotId: string;

	constructor(snapshotId: string, cause: unknown) {
		super(String(cause));
		this.name = 'MoveNotFinishedError';
		this.snapshotId = snapshotId;
	}
}

/** Pause fra i tentativi dei passi ripetibili, quando il collegamento vacilla. */
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Ripete un passo idempotente: ricevere la stessa istantanea due volte o
 * ripulire una partenza già pulita non cambia nulla nel backend.
 */
async function retrying<T>(step: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		try {
			return await step();
		} catch (error) {
			lastError = error;
			const delay = RETRY_DELAYS_MS[attempt];
			if (delay === undefined) break;
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, delay);
			await promise;
		}
	}
	throw lastError;
}

/**
 * Istantanea delle modifiche non committate della partenza, oppure `null` se
 * la cartella è pulita. La partenza deve essere sul commit che l'arrivo
 * riceverà: altrimenti l'applicazione avverrebbe su un albero sbagliato.
 */
export async function snapshotChanges(move: Pick<WipMove, 'fromPath' | 'fromMachine'>, commit: string): Promise<WipSnapshot | null> {
	const snapshot = await invoke<WipSnapshot>('copy_wip_snapshot', { projectPath: move.fromPath }, { machine: move.fromMachine ?? LOCAL_MACHINE });
	if (!snapshot.files) return null;
	if (snapshot.base !== commit) throw new Error('copy_wip_base');
	return snapshot;
}

/**
 * L'arrivo riceve i commit della partenza e poi applica l'istantanea: deve
 * essere sul commit da cui l'istantanea è partita. Per una corsia il ricevimento
 * dei commit non serve — la branch dell'arrivo è già nata su quel commit — e
 * `sync` è falso.
 */
export async function receiveChanges(move: WipMove, snapshot: WipSnapshot, sync = true): Promise<void> {
	if (sync) {
		await invoke('copy_sync', {
			projectPath: move.toPath,
			machine: machineTrueId(move.fromMachine),
			peerPath: move.fromPath,
			busyPaths: move.busyPaths ?? []
		}, { machine: move.toMachine ?? LOCAL_MACHINE });
	}
	await retrying(() => invoke('copy_wip_receive', {
		projectPath: move.toPath,
		machine: machineTrueId(move.fromMachine),
		peerPath: move.fromPath,
		id: snapshot.id, base: snapshot.base, commit: snapshot.commit
	}, { machine: move.toMachine ?? LOCAL_MACHINE }));
}

/** L'arrivo ha confermato: la partenza torna pulita, l'istantanea resta. */
export async function finishChanges(move: Pick<WipMove, 'fromPath' | 'fromMachine' | 'toPath' | 'toMachine'>, snapshot: WipSnapshot): Promise<void> {
	try {
		await retrying(() => invoke('copy_wip_finish', { projectPath: move.fromPath, id: snapshot.id }, { machine: move.fromMachine ?? LOCAL_MACHINE }));
	} catch (error) {
		throw new MoveNotFinishedError(snapshot.id, error);
	} finally {
		void githubStore.loadUpstreamStatus(move.fromPath, true, move.fromMachine ?? LOCAL_MACHINE);
		void githubStore.loadUpstreamStatus(move.toPath, true, move.toMachine ?? LOCAL_MACHINE);
	}
}

/**
 * Lo spostamento intero: istantanea, arrivo, pulizia della partenza.
 * Restituisce quante modifiche sono arrivate (zero se non ce n'erano).
 */
export async function moveChangesBetween(move: WipMove): Promise<number> {
	const commit = await invoke<{ hash: string } | null>('git_last_commit', { projectPath: move.fromPath }, { machine: move.fromMachine ?? LOCAL_MACHINE });
	if (!commit) return 0;
	const snapshot = await snapshotChanges(move, commit.hash);
	if (!snapshot) return 0;
	await receiveChanges(move, snapshot);
	await finishChanges(move, snapshot);
	return snapshot.files;
}
