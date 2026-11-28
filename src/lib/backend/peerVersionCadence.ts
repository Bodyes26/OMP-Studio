/**
 * Cadenza della lettura di `get_omp_version` sulle altre macchine (R-MI-67,
 * S3-link-front-02).
 *
 * Prima la versione si rileggeva a ogni `link:status`, cioe' ogni ~5 s per
 * macchina: 22.450 richieste in 30 h e il 99% di `studio.log`. R-MI-67 chiede
 * la lettura al rientro della macchina, al cambio di versione e ogni dieci
 * minuti come ripiego; una sola richiesta in volo per macchina.
 *
 * Le regole stanno qui, senza finestra, cosi' i test possono provarle con un
 * orologio finto: chi le usa (il negozio) fa solo le chiamate.
 */

/** Ripiego: oltre questo tempo si rilegge anche senza segnali (R-MI-67). */
export const PEER_VERSION_REFRESH_MS = 10 * 60_000;

/** Una macchina in linea e compatibile, come la vede il collegamento. */
export interface VersionPeer {
	id: string;
	online: boolean;
	compatible: boolean;
	version: string | null;
}

/**
 * Chiave primitiva delle macchine di cui leggere la versione di omp: cambia
 * quando una macchina rientra o cambia versione di Studio, non a ogni battito
 * del collegamento. E' cio' che fa ripartire l'effetto del negozio.
 */
export function ompPeersKey(peers: readonly VersionPeer[]): string {
	return peers
		.filter((peer) => peer.online && peer.compatible)
		.map((peer) => `${peer.id}@${peer.version ?? ''}`)
		.sort()
		.join('|');
}

/**
 * Decide quando una macchina va riletta: al primo giro, quando la chiave e'
 * cambiata (rientro o nuova versione di Studio) e ogni dieci minuti. Non
 * rilegge mai mentre una richiesta per la stessa macchina e' in volo.
 */
export class PeerVersionCadence {
	private readonly readAt = new Map<string, number>();
	private readonly inFlight = new Set<string>();
	private lastKey: string | null = null;

	/**
	 * Macchine da rileggere adesso. `key` e' `ompPeersKey`; `force` ignora la
	 * cadenza (giro di ripiego del negozio, che poi chiama comunque `due`).
	 */
	due(peers: readonly VersionPeer[], key: string, now: number, force = false): string[] {
		const keyChanged = this.lastKey !== key;
		this.lastKey = key;
		const result: string[] = [];
		for (const peer of peers) {
			if (!peer.online || !peer.compatible) {
				// Spenta: la prossima volta che torna e' una lettura nuova.
				this.readAt.delete(peer.id);
				continue;
			}
			if (this.inFlight.has(peer.id)) continue;
			const last = this.readAt.get(peer.id) ?? 0;
			if (force || keyChanged || now - last >= PEER_VERSION_REFRESH_MS) result.push(peer.id);
		}
		return result;
	}

	/** La lettura e' partita: una seconda richiesta per la stessa macchina non serve. */
	begin(machineId: string): void {
		this.inFlight.add(machineId);
	}

	/** La lettura e' finita (anche con errore): si potra' rifare al prossimo giro. */
	end(machineId: string, now: number): void {
		this.inFlight.delete(machineId);
		this.readAt.set(machineId, now);
	}
}
