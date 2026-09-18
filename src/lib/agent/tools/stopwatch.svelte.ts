// Orologio condiviso dei cronometri dei tool.
//
// Un solo intervallo a 100ms per tutta la chat, con conteggio dei
// sottoscrittori: una sessione con centinaia di chiamate non moltiplica i
// timer, e quando nessun tool e' in esecuzione l'intervallo non esiste
// affatto (zero lavoro fra un turno e l'altro). Il rilascio e' idempotente,
// cosi' lo smontaggio di una ToolCard non puo' lasciare indietro un timer.
//
// Il tempo e' monotono: `EPOCH_ORIGIN + performance.now()` e' l'istante di
// epoca ricostruito da un orologio che non torna indietro. Resta quindi
// confrontabile con `startedAt`/`endedAt` delle ToolEntry (millisecondi di
// epoca) senza poter arretrare se l'orologio di sistema viene corretto
// mentre un comando lungo e' in esecuzione.

import { formatElapsed } from './types';

const TICK_MS = 100;
const EPOCH_ORIGIN = Date.now() - performance.now();

let current = $state(EPOCH_ORIGIN + performance.now());
let subscribers = 0;
let timer: number | null = null;

/**
 * Tempo corrente in millisecondi di epoca, monotono.
 * Letto dentro un `$derived` rende il calcolo reattivo al tick.
 */
export function stopwatchNow(): number {
	return current;
}

/**
 * Tiene vivo l'orologio finche' serve. Va restituito da un `$effect`:
 * Svelte invoca la funzione di rilascio allo smontaggio del componente o alla
 * prima rivalutazione (fine dell'esecuzione), e l'ultimo rilascio spegne
 * l'intervallo.
 */
export function subscribeStopwatch(): () => void {
	subscribers += 1;
	if (timer === null) {
		// Senza sottoscrittori il valore resta fermo: va riallineato prima del
		// primo tick, altrimenti il cronometro partirebbe dal passato.
		current = EPOCH_ORIGIN + performance.now();
		timer = window.setInterval(() => {
			current = EPOCH_ORIGIN + performance.now();
		}, TICK_MS);
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		subscribers -= 1;
		if (subscribers === 0 && timer !== null) {
			window.clearInterval(timer);
			timer = null;
		}
	};
}

/**
 * Etichetta del cronometro di una chiamata: scorre finche' il tool e' in
 * esecuzione, poi resta ferma sulla differenza reale fra `tool_call` e
 * `tool_result`. Restituisce `undefined` quando non c'e' nulla da mostrare
 * (chiamata senza avvio noto, o conclusa senza istante di fine).
 */
export function stopwatchLabel(
	startedAt: number,
	endedAt: number | undefined,
	running: boolean
): string | undefined {
	if (!startedAt) return undefined;
	if (running) return formatElapsed(Math.max(0, stopwatchNow() - startedAt));
	if (endedAt === undefined) return undefined;
	return formatElapsed(Math.max(0, endedAt - startedAt));
}
