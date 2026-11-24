/**
 * Cambiare macchina senza attese (R-MI-62, R-MI-63).
 *
 * Una chat vuota passa subito, senza spostare nulla (D3: prima passava dallo
 * spostamento completo e si fermava su «Le copie non sono sullo stesso
 * commit»); una chat ferma si sposta dopo aver allineato le copie; un agente
 * al lavoro o una domanda in attesa prenotano lo spostamento a fine turno.
 *
 * Le regole sono pure perche' le usano il flusso del cambio macchina e
 * l'indicatore sotto il composer, e devono dare la stessa risposta.
 */

/** Perche' il cambio non puo' partire adesso. */
export type SwitchBlock = 'agent' | 'question' | 'unsaved' | 'conflict';

/** Chi occupa una copia nella cartella che il cambio toccherebbe (R-MI-57). */
export interface CopyOccupation {
	/** Nome della macchina, gia' pronto per il messaggio. */
	machine: string;
	/** Cartella in cui un agente sta lavorando davvero; `null` se nessuno. */
	working: string | null;
	/** Cartella in cui una domanda aspetta risposta; `null` se nessuno. */
	question: string | null;
	/** Cartelle con file non salvati nell'editor. */
	unsaved: readonly string[];
}

export interface SwitchInput {
	/** La chat non ha nessuna voce di conversazione: non c'e' nulla da spostare. */
	empty: boolean;
	/** L'agente di questa chat sta lavorando: lo spostamento si prenota. */
	working: boolean;
	/** Questa chat aspetta una risposta: lo spostamento si prenota. */
	question: boolean;
	from: CopyOccupation;
	to: CopyOccupation;
	/** File che git non riesce a unire fra le due copie, se gia' noti. */
	conflict: { machine: string; files: readonly string[] } | null;
}

/** Un blocco dice cosa impedisce il cambio e dove (R-MI-62). */
export interface SwitchBlocked {
	blocked: SwitchBlock;
	machine: string;
	files: string[];
}

export type SwitchDecision = 'instant' | 'move' | 'defer' | SwitchBlocked;

export function isBlocked(decision: SwitchDecision): decision is SwitchBlocked {
	return typeof decision !== 'string';
}

/**
 * La decisione, nell'ordine in cui le condizioni contano:
 *
 * 1. chat vuota: si cambia copia, nessuno spostamento da proteggere;
 * 2. l'agente di questa chat o una sua domanda: si prenota, non si blocca;
 * 3. lavoro vero, domande o file non salvati nella cartella da lasciare o da
 *    prendere: si ferma e si dice dove; un conflitto infine, perche' e' git a
 *    doverlo risolvere.
 */
export function decideSwitch(input: SwitchInput): SwitchDecision {
	if (input.empty) return 'instant';
	if (input.working || input.question) return 'defer';
	for (const side of [input.from, input.to]) {
		if (side.working) return { blocked: 'agent', machine: side.machine, files: [side.working] };
		if (side.question) return { blocked: 'question', machine: side.machine, files: [side.question] };
		if (side.unsaved.length) return { blocked: 'unsaved', machine: side.machine, files: [...side.unsaved] };
	}
	if (input.conflict && input.conflict.files.length) {
		return { blocked: 'conflict', machine: input.conflict.machine, files: [...input.conflict.files] };
	}
	return 'move';
}

/** Una branch del riporto di `copy_sync` (contratto: `state` e' quello del backend). */
export interface AlignBranch {
	local: string | null;
	peer: string;
	state: string;
	reason: string | null;
}

export interface AlignSide {
	/** Nome della macchina, per il messaggio. */
	machine: string;
	/** Cima della cartella su quella copia: la branch che si sposta. */
	head: string | null;
	branches: readonly AlignBranch[];
}

export type AlignVerdict =
	| 'aligned'
	/** Qualcuno ha unito: l'altra copia e' rimasta indietro, un altro giro la raggiunge. */
	| 'again'
	| { blocked: 'conflict'; machine: string; files: string[] }
	| { blocked: 'pending'; machine: string; detail: string }
	/** Le cime restano diverse senza una spiegazione del backend. */
	| { blocked: 'commit' };

/** Esito finale dell'allineamento: `again` si consuma dentro `alignUntilSettled`. */
export type SettledVerdict = Exclude<AlignVerdict, 'again'>;
/** I file nominati in un motivo `conflict:<file>[,<file>...]`. */
export function conflictFiles(reason: string | null): string[] {
	if (!reason || !reason.startsWith('conflict:')) return [];
	return reason.slice('conflict:'.length).split(',').filter(Boolean);
}

/** La branch della cartella: quella la cui cima locale e' la cima della cartella. */
function branchAt(side: AlignSide): AlignBranch | undefined {
	const candidates = side.branches.filter((branch) =>
		branch.state !== 'equal' && branch.state !== 'ahead' && branch.state !== 'onlyPeer');
	return candidates.find((branch) => branch.local === side.head)
		?? (candidates.length === 1 ? candidates[0] : undefined);
}

/**
 * Dopo i giri di `copy_sync` le due copie sono sullo stesso commit?
 *
 * `merged` dice che una parte ha appena unito da sola (R-MI-61): la cima
 * dell'altra e' rimasta indietro di quel commit, quindi non e' ancora un
 * conflitto ma un giro in piu' (il contratto ne prevede uno).
 */
export function alignVerdict(input: { from: AlignSide; to: AlignSide; merged: boolean }): AlignVerdict {
	if (input.from.head && input.from.head === input.to.head) return 'aligned';
	if (input.merged) return 'again';
	// Il conflitto nasce dove si unisce, cioe' all'arrivo: si guarda prima li'.
	for (const side of [input.to, input.from]) {
		const branch = branchAt(side);
		if (!branch) continue;
		if (branch.state === 'diverged') {
			return { blocked: 'conflict', machine: side.machine, files: conflictFiles(branch.reason) };
		}
		if (branch.state === 'pending' || branch.state === 'caseConflict') {
			return { blocked: 'pending', machine: side.machine, detail: branch.reason ?? '' };
		}
	}
	return { blocked: 'commit' };
}

/** Giri concessi dopo un'unione: l'altra copia deve solo fare fast-forward. */
const ALIGN_EXTRA_ROUNDS = 2;

/**
 * Ripete i giri di allineamento finche' servono, e mai oltre: un'unione appena
 * fatta lascia l'altra copia indietro di quel commit, e due giri bastano a
 * raggiungerla. Se dopo restano diverse senza un motivo del backend, git ha
 * ancora qualcosa da dire e si dice.
 */
export async function alignUntilSettled(round: () => Promise<AlignVerdict>): Promise<SettledVerdict> {
	let verdict = await round();
	for (let extra = 0; extra < ALIGN_EXTRA_ROUNDS && verdict === 'again'; extra++) verdict = await round();
	return verdict === 'again' ? { blocked: 'commit' } : verdict;
}
