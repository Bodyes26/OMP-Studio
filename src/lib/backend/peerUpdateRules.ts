/**
 * Regole pure dell'aggiornamento di un'altra macchina (R-MI-38, R-MI-64) e
 * dell'allineamento di omp fra le macchine (R-MI-68), separate dai negozi per
 * provarle senza finestra.
 */

export type WaitReason = 'agents' | 'questions' | 'jobs' | 'unsaved';

/** Canale di chi chiede: una Nightly porta l'altra macchina sulla Nightly. */
export function channelOf(version: string): 'stable' | 'nightly' {
	return version.includes('-nightly') ? 'nightly' : 'stable';
}

export interface StudioVersion {
	/** `major.minor.patch`; `null` quando la stringa non si legge. */
	base: [number, number, number] | null;
	/** Numero di build dopo `-nightly`; `null` per una stabile. */
	nightly: number | null;
}

export function parseStudioVersion(version: string | null | undefined): StudioVersion {
	const clean = (version ?? '').trim().replace(/^v/i, '');
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/.exec(clean);
	if (!match) return { base: null, nightly: null };
	return {
		base: [Number(match[1]), Number(match[2]), Number(match[3])],
		nightly: match[4] === undefined ? null : Number(match[4])
	};
}

/**
 * Ordine totale fra due versioni di Studio (R-MI-64, D5).
 *
 * La base semver decide; a parita' di base la stabile viene dopo ogni Nightly e
 * due Nightly si ordinano per numero di build. Serve perché confrontare le
 * stringhe intere fa sembrare «diverse» due build della stessa base, che il
 * collegamento considera compatibili (`stable_version` in `link/mod.rs`): la
 * macchina riceveva un avviso invece dell'aggiornamento in corso.
 *
 * `0` anche quando una delle due non si legge: senza un ordine non si chiede e
 * non si avvisa nulla, che e' il ripiego sicuro.
 */
export function compareStudioVersions(a: string | null | undefined, b: string | null | undefined): number {
	const left = parseStudioVersion(a);
	const right = parseStudioVersion(b);
	if (!left.base || !right.base) return 0;
	for (let index = 0; index < 3; index++) {
		const delta = left.base[index] - right.base[index];
		if (delta !== 0) return delta > 0 ? 1 : -1;
	}
	if (left.nightly === right.nightly) return 0;
	// Stabile e Nightly della stessa base sono lo stesso codice: la stabile e'
	// la build distribuita, quindi viene dopo.
	if (left.nightly === null) return 1;
	if (right.nightly === null) return -1;
	return left.nightly > right.nightly ? 1 : -1;
}

/** Quel che serve per decidere se l'altra macchina va portata a questa versione. */
export interface PeerVersion {
	online: boolean;
	version: string | null;
	/** Base diversa: le due istanze non si capiscono (R-MI-10). */
	compatible?: boolean;
}

/**
 * L'avviso «versione diversa» (D5, R-MI-64): solo quando la base non coincide,
 * cioe' quando le due istanze davvero non si capiscono (R-MI-10). Due Nightly
 * della stessa base non sono un avviso ma un aggiornamento in corso o in
 * attesa, che si legge dallo stato di `peerUpdate`.
 */
export function needsUpdate(peer: PeerVersion, own: string | null): boolean {
	if (!peer.online || !peer.version || !own) return false;
	return peer.compatible === false;
}

/**
 * L'altra macchina esegue una versione piu' vecchia di questa e va portata
 * alla stessa: e' il caso di R-MI-64, che chiede l'aggiornamento da soli.
 * Mai verso una versione piu' nuova.
 */
export function peerBehind(peer: PeerVersion, own: string | null): boolean {
	if (!peer.online || !peer.version || !own) return false;
	// Canali diversi non si portano l'uno sull'altro: chi usa le Nightly non
	// vede la sua macchina tornare alla stabile solo perche' l'altra la usa.
	// R-MI-64 nasce da due Nightly della stessa base (D5).
	if (channelOf(peer.version) !== channelOf(own)) return false;
	return compareStudioVersions(peer.version, own) < 0;
}

/** Chiave di «gia' chiesto»: una richiesta sola per (macchina, versione di questa). */
export function autoUpdateKey(machineId: string, version: string): string {
	return `${machineId}@${version}`;
}

export interface AutoUpdateInput {
	peer: { id: string; online: boolean; version: string | null };
	own: string | null;
	/** Chiavi gia' chieste in questa esecuzione dell'app. */
	asked: ReadonlySet<string>;
	/** Costruzione di sviluppo: non comanda aggiornamenti alle altre macchine. */
	dev: boolean;
}

/**
 * Se chiedere da soli l'aggiornamento di quella macchina (R-MI-64).
 *
 * Solo verso una versione piu' vecchia: mai a una piu' nuova, che non ha nulla
 * da ricevere. Una volta per (macchina, versione di questa): un rifiuto o un
 * errore non si ripete finche' l'app resta aperta.
 */
export function shouldRequestAutoUpdate(input: AutoUpdateInput): boolean {
	if (input.dev) return false;
	const { peer, own } = input;
	if (!own || !peerBehind(peer, own)) return false;
	return !input.asked.has(autoUpdateKey(peer.id, own));
}

/**
 * La riga di una macchina nel modale di aggiornamento (R-MI-64): una sola
 * parola che dica a che punto e', senza aprire nient'altro.
 *
 * - `updated`: alla stessa versione di questa;
 * - `updating`: un aggiornamento e' gia' partito (scaricamento, attesa o
 *   riavvio in corso);
 * - `waiting`: aggiornamento chiesto e in attesa che la macchina sia libera;
 * - `offline`: spenta, non raggiungibile adesso;
 * - `unknown`: in linea ma la versione non e' ancora arrivata (prima del
 *   primo riepilogo, D8): non si dice nulla di sbagliato;
 * - `outdated`: piu' vecchia, si puo' aggiornare con «Aggiorna».
 */
export type MachineUpdateState = 'updated' | 'updating' | 'waiting' | 'offline' | 'unknown' | 'outdated';

export function machineUpdateState(input: {
	online: boolean;
	version: string | null;
	own: string | null;
	/** Fase dell'aggiornamento gia' chiesto, se c'e'. */
	phase?: 'starting' | 'downloading' | 'waiting' | 'installing' | 'failed' | null;
}): MachineUpdateState {
	if (!input.online) return 'offline';
	if (input.phase === 'waiting') return 'waiting';
	if (input.phase && input.phase !== 'failed') return 'updating';
	if (!input.version || !input.own) return 'unknown';
	// «Aggiornata» vale anche per una macchina piu' nuova: non c'e' nulla da
	// mandarle e, per R-MI-64, a una piu' nuova non si chiede mai nulla.
	if (input.version && input.own && compareStudioVersions(input.version, input.own) >= 0) return 'updated';
	return 'outdated';
}

/**
 * Cosa tiene occupata questa macchina prima di installare e riavviare:
 * agenti al lavoro (anche automazioni), domande in attesa, job chiesti da
 * altre macchine, file non salvati.
 */
export function waitReasons(input: {
	workingAgents: number;
	pendingQuestions: number;
	activeJobs: number;
	incomingJobs: number;
	unsavedProjects: number;
}): WaitReason[] {
	const reasons: WaitReason[] = [];
	if (input.workingAgents > 0 || input.activeJobs > 0) reasons.push('agents');
	if (input.pendingQuestions > 0) reasons.push('questions');
	if (input.incomingJobs > 0) reasons.push('jobs');
	if (input.unsavedProjects > 0) reasons.push('unsaved');
	return reasons;
}

/**
 * Ordine fra due versioni di omp (`major.minor.patch`, anche dentro un testo
 * come `omp 18.18.3`). `0` quando una delle due non si legge: senza un ordine
 * non si propone nulla (R-MI-68).
 */
export function compareOmpVersions(a: string | null | undefined, b: string | null | undefined): number {
	const parse = (value: string | null | undefined) => {
		const match = /(\d+)\.(\d+)\.(\d+)/.exec(value ?? '');
		return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
	};
	const left = parse(a);
	const right = parse(b);
	if (!left || !right) return 0;
	for (let index = 0; index < 3; index++) {
		const delta = left[index] - right[index];
		if (delta !== 0) return delta > 0 ? 1 : -1;
	}
	return 0;
}

/**
 * Dove serve `omp update` perche' le due macchine abbiano lo stesso omp
 * (R-MI-68): `peer` se l'altra e' indietro, `here` se e' indietro questa,
 * `null` se sono pari o una versione manca. Sempre verso la piu' nuova.
 */
export function ompAlignment(peer: string | null | undefined, own: string | null | undefined): 'peer' | 'here' | null {
	const order = compareOmpVersions(peer, own);
	if (order < 0) return 'peer';
	if (order > 0) return 'here';
	return null;
}

/**
 * Un errore di aggiornamento ha smesso di essere vero (R-MI-38, R-MI-68).
 *
 * Capita davvero: l'aggiornamento fallisce qui, poi la macchina si allinea da
 * sola, o l'utente la aggiorna dall'altro lato. Lo stato `failed` resta
 * nell'elenco perche' nessuno lo sostituisce, e la tessera ripete un errore che
 * non esiste piu' — senza modo di chiuderlo. Quando la versione letta e' alla
 * destinazione o piu' avanti, la riga va tolta.
 */
export function updateFailureObsolete(
	target: string | null | undefined,
	current: string | null | undefined,
	compare: (a: string, b: string) => number
): boolean {
	if (!target || !current) return false;
	return compare(current, target) >= 0;
}

/** Una domanda sola per (macchina, versione di la', versione di qui) (R-MI-68). */
export function ompAskKey(machineId: string, peer: string, own: string): string {
	return `${machineId}@${peer}>${own}`;
}
