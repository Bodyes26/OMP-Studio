/**
 * Giro delle copie in corso, senza importare lo store (S3-04).
 *
 * `git_fast_forward_upstream` e `copy_sync` prendono lo stesso `SyncGuard`:
 * quando il fast-forward trova la cartella occupata deve aspettare la fine del
 * giro delle copie, non un tempo fisso. `copySync` importa `githubStore`, quindi
 * il conteggio vive qui: chi lo guarda non crea un ciclo di import.
 */

let running = 0;
let waiters: Array<() => void> = [];

/** Un giro delle copie e' partito. */
export function beginCopyRound(): void {
	running += 1;
}

/** Un giro delle copie e' finito (anche con errore): chi aspetta riparte. */
export function endCopyRound(): void {
	running = Math.max(0, running - 1);
	if (running > 0) return;
	const ready = waiters;
	waiters = [];
	for (const resolve of ready) resolve();
}

/** C'e' un giro delle copie in corso adesso? */
export function copyRoundRunning(): boolean {
	return running > 0;
}

/**
 * Si risolve quando nessun giro delle copie e' in corso, o al tetto: chi
 * aspetta deve comunque riprovare, perche' la cartella puo' restare occupata
 * da altro (agente, editor). Il tetto e' quello del fast-forward: oltre, si
 * riporta l'esito che c'e' invece di tenere fermo il controllo remoto.
 */
export function copyRoundIdle(timeoutMs: number): Promise<void> {
	if (running === 0) return Promise.resolve();
	const { promise, resolve } = Promise.withResolvers<void>();
	let settled = false;
	const done = () => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		waiters = waiters.filter((candidate) => candidate !== done);
		resolve();
	};
	// `setTimeout` globale: il modulo si carica anche nei test, senza finestra.
	const timer = setTimeout(done, timeoutMs);
	waiters.push(done);
	return promise;
}
