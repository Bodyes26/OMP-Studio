/**
 * «Porta qui le modifiche» (R-MI-28): le modifiche non committate di una copia
 * passano a quella di un'altra macchina solo quando si cambia macchina, mai da
 * sole. L'ordine conta: istantanea alla partenza, arrivo allineato ai commit,
 * applicazione, e solo dopo la conferma la partenza torna pulita (le modifiche
 * restano recuperabili dall'istantanea anche lì).
 */

import { invoke, LOCAL_MACHINE } from '#lib/backend/ipc.ts';
import { linkStore } from '#lib/backend/link.svelte.ts';
import { busyPaths } from './copySync.svelte';
import { githubStore } from './github.svelte';
import type { Project } from './projects.svelte';

interface WipSnapshot {
	id: string;
	commit: string;
	base: string;
	branch: string;
	files: number;
}

function machineOf(project: Project): string {
	return project.machineId ?? LOCAL_MACHINE;
}

/** Con quale id la macchina di `target` conosce quella di `source`. */
function peerSeenBy(source: Project): string {
	return machineOf(source) === LOCAL_MACHINE ? linkStore.status.machineId : machineOf(source);
}

/** Le due copie stanno su macchine diverse: solo allora c'è qualcosa da spostare. */
export function canMoveChanges(from: Project, to: Project): boolean {
	return machineOf(from) !== machineOf(to) && Boolean(from.canonicalProjectPath && to.canonicalProjectPath);
}

/** Quanto pesano le modifiche da portare (R-MI-33). */
export interface MoveEstimate {
	files: number;
	bytes: number;
}

/**
 * Stima dello spostamento letta sulla macchina di partenza, senza creare
 * l'istantanea: la domanda dice prima quanto si sta per trasferire.
 */
export function estimateMove(from: Project): Promise<MoveEstimate> {
	return invoke<MoveEstimate>('copy_wip_estimate', { projectPath: from.canonicalProjectPath }, { machine: machineOf(from) });
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

export async function moveChanges(from: Project, to: Project): Promise<void> {
	const fromPath = from.canonicalProjectPath!;
	const toPath = to.canonicalProjectPath!;
	const peer = peerSeenBy(from);
	const snapshot = await invoke<WipSnapshot>('copy_wip_snapshot', { projectPath: fromPath }, { machine: machineOf(from) });
	// L'arrivo deve essere sul commit da cui è partita l'istantanea: prima
	// riceve i commit della partenza. Le cartelle occupate dell'arrivo le
	// conosce solo la finestra che lo possiede: se è questa, le passa; il
	// backend dell'arrivo controlla comunque agenti e automazioni da sé.
	const targetBusy = machineOf(to) === LOCAL_MACHINE ? busyPaths(to) : [];
	await invoke('copy_sync', { projectPath: toPath, machine: peer, peerPath: fromPath, busyPaths: targetBusy }, { machine: machineOf(to) });
	await retrying(() => invoke('copy_wip_receive', {
		projectPath: toPath, machine: peer, peerPath: fromPath,
		id: snapshot.id, base: snapshot.base, commit: snapshot.commit
	}, { machine: machineOf(to) }));
	try {
		await retrying(() => invoke('copy_wip_finish', { projectPath: fromPath, id: snapshot.id }, { machine: machineOf(from) }));
	} catch (error) {
		throw new MoveNotFinishedError(snapshot.id, error);
	} finally {
		void githubStore.loadUpstreamStatus(fromPath, true);
		void githubStore.loadUpstreamStatus(toPath, true);
	}
}
