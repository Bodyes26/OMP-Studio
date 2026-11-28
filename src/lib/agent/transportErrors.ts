// Errori attesi del trasporto della sessione agente.
//
// Sessione chiusa, turno interrotto, collegamento perso, macchina
// irraggiungibile: sono esiti normali della vita di una sessione, non guasti
// da raccontare nel transcript. Chi li riceve li scrive nel registro di
// Studio e, dove ha senso, ritenta in silenzio; l'utente vede un avviso solo
// per i guasti veri (decisione D1 del piano di polish).
//
// Il riconoscimento sta qui e non nei chiamanti perche' la stessa classe di
// errore arriva da tre punti diversi: il client RPC (`code`), il confine IPC
// (`BackendRouteError`) e il riduttore (cambio di generazione).

import { BackendRouteError } from '#lib/backend/ipc.ts';

/** Codici con cui il client RPC segnala un esito atteso, non un guasto.
 *  `busy` e' il timeout di un comando arrivato mentre omp scriveva: la
 *  risposta e' in coda, non persa (S14). */
const EXPECTED_CODES = new Set(['closed', 'aborted', 'transport', 'busy']);

export function isExpectedTransportError(error: unknown): boolean {
	if (error instanceof BackendRouteError) {
		// La macchina spenta e la versione incompatibile si risolvono da sole
		// (ritorno in linea, aggiornamento): non sono errori della chat.
		return error.reason === 'machine_unreachable' || error.reason === 'incompatible_version';
	}
	if (!error || typeof error !== 'object') return false;
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' && EXPECTED_CODES.has(code);
}