/**
 * Copie dello stesso progetto su più macchine (R-MI-12, R-MI-19, R-MI-22).
 *
 * Regole pure, condivise da tessera, popover, selettore e striscia sopra il
 * composer: devono dare la stessa risposta ovunque, quindi non leggono store.
 */

import { pathKey } from '#lib/utils/paths.ts';

/** Stato di una copia nel glifo: in uso, in linea, spenta. */
export type CopyMark = 'use' | 'on' | 'off';

/**
 * La copia in uso è l'ultima usata (F18): è quella su cui nascono le nuove
 * chat e i task, e quella che la tessera rappresenta. A parità vince la prima,
 * così l'ordine della barra decide e la tessera non salta.
 */
export function inUseCopy<T extends { lastOpened: number }>(group: readonly T[]): T | undefined {
	let best: T | undefined;
	for (const copy of group) {
		if (!best || copy.lastOpened > best.lastOpened) best = copy;
	}
	return best;
}

/**
 * La copia che la tessera apre quando il progetto non è in primo piano
 * (R-MI-24): prima quella che aspetta una risposta, perché il lavoro da
 * riprendere è lì; fra più copie in attesa, e senza attese, l'ultima usata.
 */
export function tileCopy<T extends { lastOpened: number }>(
	group: readonly T[],
	waiting: (copy: T) => boolean
): T | undefined {
	return inUseCopy(group.filter(waiting)) ?? inUseCopy(group);
}

/**
 * La copia successiva (o precedente) raggiungibile, in giro (R-MI-25): le
 * macchine spente si saltano. `undefined` se non c'è un'altra copia in linea.
 */
export function nextOnlineCopy<T extends { online: boolean }>(
	copies: readonly T[],
	current: number,
	direction: 1 | -1
): T | undefined {
	const count = copies.length;
	for (let step = 1; step < count; step++) {
		const candidate = copies[(((current + direction * step) % count) + count) % count];
		if (candidate.online) return candidate;
	}
	return undefined;
}

/** Stato git di una copia, quanto basta per decidere se diverge. */
export interface CopyGitState {
	/** Branch corrente; `HEAD` se staccato. */
	branch: string;
	/** Commit corrente; `null` se non ancora letto o repository vuoto. */
	head: string | null;
	/** File con modifiche non committate (tracciati e non). */
	changedFiles: number;
}

export type DivergenceReason = 'commits' | 'uncommitted' | 'case';

/** Branch che differiscono solo per maiuscole fra le copie (R-MI-35). */
export interface CaseConflict {
	/** Nome sull'altra macchina. */
	branch: string;
	/** Nome che collide, sull'altra macchina o su questa. */
	other: string;
}

/**
 * Le copie divergono (R-MI-22, regola F25 del 2026-11-18) solo quando la
 * sincronizzazione non basta: una branch ha commit propri su entrambe le
 * copie (`divergedBranches`, dal confronto fatto con i commit dell'altra
 * macchina, R-MI-26), oppure almeno due copie hanno modifiche non committate.
 * Una copia soltanto indietro si aggiorna da sola; branch diverse sulle due
 * macchine sono una scelta, non una divergenza.
 */
export function divergenceReasons(
	copies: readonly CopyGitState[],
	divergedBranches: readonly string[],
	caseConflicts: readonly CaseConflict[] = []
): DivergenceReason[] {
	const reasons: DivergenceReason[] = [];
	if (divergedBranches.length > 0) reasons.push('commits');
	if (copies.filter((copy) => copy.changedFiles > 0).length >= 2) reasons.push('uncommitted');
	// Branch che collidono per maiuscole non si sincronizzano: restano
	// diverse finché l'utente non ne rinomina una (R-MI-35).
	if (caseConflicts.length > 0) reasons.push('case');
	return reasons;
}

/**
 * Cartelle occupate di una copia (R-MI-57, D1, D2).
 *
 * Una copia è occupata solo dove si lavora davvero: cartelle di QUESTO
 * progetto con un agente al lavoro o in attesa di risposta, e cartelle di
 * questo progetto con file non salvati nell'editor. Una chat aperta e ferma,
 * qui o sull'altra macchina, e i file non salvati di un altro progetto non
 * occupano niente: prima la radice del progetto bastava perché una sessione
 * qualsiasi fosse al lavoro, e l'intera finestra contava (D2).
 */
export interface BusyCopyInput {
	/** Cartelle del progetto: la principale e i worktree delle sue corsie. */
	folders: readonly string[];
	/** Cartelle con file non salvati nell'editor, di tutti i progetti aperti. */
	dirtyFolders: readonly string[];
	/** Cartelle in cui un agente di questa macchina lavora o aspetta. */
	workingFolders: readonly string[];
	/** Cartelle di corsie su cui lavora davvero un'altra macchina (D1). */
	remoteWorkingFolders: readonly string[];
}

export function busyCopyPaths(input: BusyCopyInput): string[] {
	// La forma originale vince: Rust confronta i percorsi con quelli dei
	// worktree che ha in mano, non con una chiave normalizzata.
	const byKey = new Map<string, string>();
	for (const folder of input.folders) {
		if (!folder) continue;
		const key = pathKey(folder);
		if (!byKey.has(key)) byKey.set(key, folder);
	}
	const paths = new Set<string>();
	for (const group of [input.dirtyFolders, input.workingFolders, input.remoteWorkingFolders]) {
		for (const folder of group) {
			if (!folder) continue;
			const known = byKey.get(pathKey(folder));
			if (known) paths.add(known);
		}
	}
	return [...paths];
}

/**
 * Impronta dello stato delle copie: «Più tardi» vale finché non cambia, poi
 * l'avviso torna (R-MI-22).
 */
export function divergenceSignature(
	copies: readonly CopyGitState[],
	divergedBranches: readonly string[],
	caseConflicts: readonly CaseConflict[] = []
): string {
	return [
		...copies.map((copy) => `${copy.branch}@${copy.head ?? '-'}+${copy.changedFiles}`),
		...[...divergedBranches].sort(),
		...caseConflicts.map((conflict) => `${conflict.branch}~${conflict.other}`).sort()
	].join('|');
}
