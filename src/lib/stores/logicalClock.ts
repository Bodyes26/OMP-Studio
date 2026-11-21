/**
 * Orologio per i confronti fra macchine (R-MI-12, R-MI-13).
 *
 * `Date.now()` di due computer non e' confrontabile: con il Mac avanti di
 * qualche minuto, una modifica fatta dopo sul PC risultava piu' vecchia e
 * perdeva («vince l'ultima modifica» diventava «vince l'orologio avanti»).
 *
 * Qui ogni istante emesso e' maggiore di tutti quelli gia' visti, locali o
 * arrivati da un'altra macchina: un'azione fatta dopo aver visto lo stato
 * dell'altra lo supera sempre, qualunque sia lo sfasamento. Le modifiche
 * davvero concorrenti restano ordinate in modo deterministico, ma senza
 * pretesa di sapere quale sia «venuta prima».
 *
 * I valori restano millisecondi epoch quando gli orologi sono allineati, cosi'
 * i file gia' scritti e la UI che mostra le date non cambiano significato.
 */

/**
 * Oltre questo anticipo un istante ricevuto non viene assorbito: un valore
 * corrotto (o un orologio impostato a un altro anno) spingerebbe per sempre
 * nel futuro tutti gli istanti emessi qui.
 */
export const MAX_OBSERVED_SKEW_MS = 24 * 60 * 60 * 1000;

export class LogicalClock {
	private last = 0;

	private readonly wall: () => number;

	constructor(wall: () => number = () => Date.now()) {
		this.wall = wall;
	}

	/** Registra un istante visto (file, altra macchina). */
	observe(at: number | null | undefined): void {
		if (typeof at !== 'number' || !Number.isFinite(at)) return;
		if (at > this.wall() + MAX_OBSERVED_SKEW_MS) return;
		if (at > this.last) this.last = at;
	}

	/** Istante per una modifica fatta adesso su questa macchina. */
	now(): number {
		const at = Math.max(this.wall(), this.last + 1);
		this.last = at;
		return at;
	}
}

export const logicalClock = new LogicalClock();
