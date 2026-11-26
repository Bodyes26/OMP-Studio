/**
 * Riscontro delle operazioni verso un'altra macchina (IMP-006).
 *
 * Regola che conta: un'operazione è «confermata» solo quando la destinazione
 * ha risposto. Un invio partito, una scrittura locale o un messaggio mostrato
 * qui non valgono: si registra l'attesa quando la richiesta parte e la si
 * chiude con l'esito che torna dal collegamento (`prompt`, `file_write`,
 * `session_title_save`, `write_queue`, `git_sync_repo`).
 *
 * La coda dei progetti remoti ha una conferma più lenta ma più vera: l'host
 * conferma una modifica quando il suo riepilogo la mostra (`tasks.ts` toglie
 * l'id da `awaitingDelivery`). Finché l'id resta lì, lo stato è «in attesa»,
 * anche se l'invio è già riuscito.
 *
 * Le conferme non sono uno storico: restano leggibili per poco, il tempo di
 * vederle, poi si consumano da sole. La presa in carico del prompt sparisce
 * anche prima, appena il run parte davvero (`dismiss` da `agent_start`): da li'
 * in poi e' il transcript a dire che la macchina sta lavorando.
 */

export type MachineOpKind = 'prompt' | 'files' | 'session' | 'queue' | 'git';
export type MachineOpPhase = 'waiting' | 'confirmed' | 'failed';

export interface MachineOp {
	/** Cambia a ogni operazione: la vista non deve riusare la riga precedente. */
	id: number;
	kind: MachineOpKind;
	phase: MachineOpPhase;
	machineId: string;
	/** Progetto dell'operazione, quando si conosce (id locale). */
	projectId: string | null;
	/** Testo della destinazione o dell'errore; `null` mentre si aspetta. */
	detail: string | null;
	at: number;
}

/**
 * Quanto resta visibile una conferma prima di consumarsi, per tipo.
 *
 * La presa in carico del prompt vale pochi secondi: e' un cenno, non uno
 * stato. Se il run parte la riga sparisce prima (`release`), ma nemmeno una
 * conferma che nessuno ritira deve restare sopra il composer. Gli altri
 * riscontri restano il minuto di sempre.
 */
const CONFIRMED_TTL_MS: Record<MachineOpKind, number> = {
	prompt: 10_000,
	files: 60_000,
	session: 60_000,
	queue: 60_000,
	git: 60_000
};
/** Tetto delle operazioni tenute in memoria: è un riscontro, non un registro. */
const MAX_ENTRIES = 40;

export interface FeedbackStart {
	kind: MachineOpKind;
	machineId: string;
	projectId?: string | null;
}

interface QueuePending {
	machineId: string;
	projectId: string | null;
}

export class MachineFeedbackStore {
	private entries = $state<MachineOp[]>([]);
	private sequence = 0;
	/** Id del task in coda → operazione aperta che aspetta la conferma dell'host. */
	private queueOps = new Map<string, number>();
	/**
	 * Sveglia che consuma le conferme scadute. Senza, il filtro per tempo di
	 * `live()` non avrebbe chi lo fa rieseguire: la riga resterebbe finche'
	 * un'altra operazione non cambia `entries`.
	 */
	private expiryTimer: number | undefined = undefined;
	/** Istante a cui la sveglia corrente e' armata: serve a non allungarla. */
	private expiryArmedFor: number | null = null;

	/** Apre un'operazione in attesa: la richiesta sta partendo. */
	begin(input: FeedbackStart): number {
		const id = ++this.sequence;
		this.entries = [
			...this.entries.slice(-(MAX_ENTRIES - 1)),
			{
				id,
				kind: input.kind,
				phase: 'waiting',
				machineId: input.machineId,
				projectId: input.projectId ?? null,
				detail: null,
				at: Date.now()
			}
		];
		return id;
	}

	/** La destinazione ha risposto. `detail` è la sua conferma, non la nostra. */
	confirm(id: number, detail: string | null = null): void {
		this.patch(id, (op) => ({ ...op, phase: 'confirmed', detail, at: Date.now() }));
	}

	/** L'operazione non è riuscita: il testo è quello che la destinazione o il trasporto hanno dato. */
	fail(id: number, error: string): void {
		this.patch(id, (op) => ({ ...op, phase: 'failed', detail: error, at: Date.now() }));
	}

	/**
	 * Il riscontro ha esaurito il suo compito prima della scadenza: la presa in
	 * carico del prompt sparisce appena il run parte davvero sulla
	 * destinazione, perche' da li' in poi e' il transcript a dire che si sta
	 * lavorando. Non tocca gli altri riscontri.
	 */
	release(id: number): void {
		const kept = this.entries.filter((op) => op.id !== id);
		if (kept.length === this.entries.length) return;
		this.entries = kept;
		this.scheduleExpiry();
	}

	/**
	 * Ritira la presa in carico del prompt perche' la macchina ha cominciato a
	 * lavorare. Toglie solo una riga gia' confermata: una ancora in attesa
	 * resta, cosi' un errore arrivato dopo puo' ancora comparire.
	 *
	 * Chi tiene gli id appesi smette di seguirli con qualunque esito diverso da
	 * `waiting`: una riga ancora in attesa puo' diventare un errore da
	 * mostrare, una gia' chiusa (o sparita) non ha piu' niente da dire.
	 */
	settlePrompt(id: number): 'released' | 'waiting' | 'done' {
		const op = this.entries.find((candidate) => candidate.id === id);
		if (!op) return 'done';
		if (op.phase !== 'confirmed') return op.phase === 'waiting' ? 'waiting' : 'done';
		this.release(id);
		return 'released';
	}

	/**
	 * Specchio della coda remota. `pending` sono i task che l'host non ha
	 * ancora confermato, `acks` gli istanti in cui l'host li ha pubblicati
	 * dopo una modifica fatta qui (`tasks.deliveredAcks`).
	 *
	 * Un id che sparisce da `pending` diventa «confermato» solo se esiste un
	 * ack successivo all'apertura dell'operazione: è la prova che l'host l'ha
	 * ricevuto. Se non c'è — task cancellato qui, progetto chiuso, macchina
	 * revocata — l'operazione si toglie, senza fingere una consegna.
	 */
	setQueuePending(pending: Record<string, QueuePending>, acks: Record<string, number> = {}): void {
		let entries = this.entries;
		const next = new Map<string, number>();
		for (const [taskId, target] of Object.entries(pending)) {
			const existing = this.queueOps.get(taskId);
			if (existing !== undefined && entries.some((op) => op.id === existing)) {
				next.set(taskId, existing);
				continue;
			}
			const id = ++this.sequence;
			entries = [
				...entries.slice(-(MAX_ENTRIES - 1)),
				{
					id,
					kind: 'queue',
					phase: 'waiting',
					machineId: target.machineId,
					projectId: target.projectId,
					detail: null,
					at: Date.now()
				}
			];
			next.set(taskId, id);
		}
		const confirmedIds = new Set<number>();
		const droppedIds = new Set<number>();
		for (const [taskId, id] of this.queueOps) {
			if (next.has(taskId)) continue;
			const op = entries.find((candidate) => candidate.id === id);
			if (!op) continue;
			const ack = acks[taskId];
			if (typeof ack === 'number' && ack >= op.at && op.phase === 'waiting') confirmedIds.add(id);
			else if (op.phase !== 'confirmed') droppedIds.add(id);
		}
		if (confirmedIds.size > 0 || droppedIds.size > 0) {
			entries = entries
				.filter((op) => !droppedIds.has(op.id))
				.map((op) => confirmedIds.has(op.id) ? { ...op, phase: 'confirmed', at: Date.now() } : op);
		}
		this.queueOps = next;
		this.entries = entries;
		// Anche queste conferme devono consumarsi da sole: senza sveglia
		// resterebbero finche' un'altra operazione non cambia l'elenco.
		if (confirmedIds.size > 0) this.scheduleExpiry();
	}

	/** Ultima operazione di una macchina: il riscontro da mostrare (IMP-006). */
	latestFor(machineId: string): MachineOp | null {
		const ops = this.live().filter((op) => op.machineId === machineId);
		return ops.length > 0 ? ops[ops.length - 1] : null;
	}

	/**
	 * Ultima operazione del lavoro aperto: quelle del progetto, più quelle
	 * senza progetto eseguite sulla macchina che lo ospita (salvataggio del
	 * file e sync Git). Sono il riscontro accanto al composer.
	 */
	latestForWork(projectId: string, machineId: string): MachineOp | null {
		const ops = this.live();
		for (let index = ops.length - 1; index >= 0; index--) {
			const op = ops[index];
			if (op.machineId !== machineId) continue;
			if (op.projectId === projectId || (op.projectId === null && (op.kind === 'files' || op.kind === 'git'))) return op;
		}
		return null;
	}

	/** Operazioni ancora in attesa per una macchina. */
	activeFor(machineId: string): MachineOp[] {
		return this.live().filter((op) => op.machineId === machineId && op.phase === 'waiting');
	}

	private patch(id: number, change: (op: MachineOp) => MachineOp): void {
		let touched = false;
		this.entries = this.entries.map((op) => {
			if (op.id !== id) return op;
			touched = true;
			return change(op);
		});
		if (!touched) return;
		this.scheduleExpiry();
	}

	/**
	 * Arma una sola sveglia alla prossima conferma in scadenza. Allo scadere
	 * toglie davvero le righe da `entries`, cosi' la vista si aggiorna senza
	 * aspettare un'altra operazione; poi riarma, se ne restano.
	 */
	private scheduleExpiry(): void {
		let next: number | null = null;
		for (const op of this.entries) {
			if (op.phase !== 'confirmed') continue;
			const at = op.at + CONFIRMED_TTL_MS[op.kind];
			if (next === null || at < next) next = at;
		}
		if (next === null) {
			clearTimeout(this.expiryTimer);
			this.expiryTimer = undefined;
			this.expiryArmedFor = null;
			return;
		}
		// Se la sveglia corrente scade gia' non dopo quella riga, va bene cosi':
		// riarmarla piu' tardi rimanderebbe la riga che le sta davanti.
		if (this.expiryTimer !== undefined && this.expiryArmedFor !== null && this.expiryArmedFor <= next) return;
		clearTimeout(this.expiryTimer);
		this.expiryTimer = setTimeout(() => {
			this.expiryTimer = undefined;
			this.expiryArmedFor = null;
			this.pruneExpired();
		}, Math.max(0, next - Date.now()));
		this.expiryArmedFor = next;
	}

	/** Toglie le conferme scadute e riarma sulla prossima. */
	private pruneExpired(): void {
		const now = Date.now();
		const kept = this.entries.filter((op) => op.phase !== 'confirmed' || now - op.at < CONFIRMED_TTL_MS[op.kind]);
		if (kept.length !== this.entries.length) this.entries = kept;
		this.scheduleExpiry();
	}

	/** Le conferme scadono; le attese e gli errori restano finché non cambiano. */
	private live(): MachineOp[] {
		const now = Date.now();
		return this.entries.filter((op) => op.phase !== 'confirmed' || now - op.at < CONFIRMED_TTL_MS[op.kind]);
	}
}

export const machineFeedback = new MachineFeedbackStore();
